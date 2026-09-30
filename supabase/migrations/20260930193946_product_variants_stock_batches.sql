-- Flexible organization-specific attributes, product variants and separately tracked lots.
create table public.sales_product_attributes (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 name text not null check(length(trim(name)) between 1 and 80),
 kind text not null check(kind in ('text','select','multiselect','number','date')),
 options jsonb not null default '[]' check(jsonb_typeof(options)='array'),
 created_at timestamptz not null default now(),
 unique(organization_id,name), unique(organization_id,id)
);
create table public.sales_product_variants (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 product_id uuid not null references public.sales_products(id),
 label text not null check(length(trim(label)) between 1 and 200),
 attributes jsonb not null default '{}' check(jsonb_typeof(attributes)='object'),
 is_default boolean not null default false,
 created_at timestamptz not null default now(),
 unique(organization_id,product_id,id)
);
create unique index sales_variants_default_idx on public.sales_product_variants(product_id) where is_default;
create unique index sales_variants_values_idx on public.sales_product_variants(organization_id,product_id,attributes) where not is_default;
create index sales_variants_org_idx on public.sales_product_variants(organization_id,product_id);
create table public.sales_stock_batches (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 product_id uuid not null references public.sales_products(id),
 variant_id uuid not null,
 batch_code text not null check(length(trim(batch_code)) between 1 and 100),
 expires_on date,
 quantity numeric(14,3) not null default 0 check(quantity>=0),
 is_legacy boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 foreign key(organization_id,product_id,variant_id) references public.sales_product_variants(organization_id,product_id,id),
 unique(organization_id,product_id,id), unique(organization_id,product_id,batch_code)
);
create index sales_batches_available_idx on public.sales_stock_batches(organization_id,product_id,expires_on,id);
create index sales_batches_variant_idx on public.sales_stock_batches(variant_id);
create unique index sales_batches_legacy_idx on public.sales_stock_batches(product_id) where is_legacy;
alter table public.sales_order_items add column batch_id uuid references public.sales_stock_batches(id), add column variant_label text, add column attributes_snapshot jsonb, add column batch_code text, add column expires_on date;
create index sales_order_items_batch_idx on public.sales_order_items(batch_id);
alter table public.sales_inventory_movements add column batch_id uuid references public.sales_stock_batches(id);
create index sales_inventory_movements_batch_idx on public.sales_inventory_movements(batch_id);
-- Preserve every existing balance as an unspecified legacy lot; never infer its expiry.
insert into public.sales_product_variants(organization_id,product_id,label,is_default)
 select organization_id,id,'أساسي — خصائص غير محددة',true from public.sales_products;
insert into public.sales_stock_batches(organization_id,product_id,variant_id,batch_code,quantity,is_legacy)
 select p.organization_id,p.id,v.id,'LEGACY',coalesce(i.quantity,0),true from public.sales_products p join public.sales_product_variants v on v.product_id=p.id and v.is_default left join public.sales_inventory i on i.product_id=p.id;
do $$ declare t text; begin
 foreach t in array array['sales_product_attributes','sales_product_variants','sales_stock_batches'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon, authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 execute format('create policy organization_catalog_read on public.%I for select to authenticated using (public.has_permission((select auth.uid()),organization_id,''products.view'') and exists(select 1 from public.org_memberships m where m.user_id=(select auth.uid()) and m.organization_id=%I.organization_id and m.is_active))',t,t);
 end loop;
end $$;
-- Trusted server RPCs. Product balance is locked first in every stock operation.
create function public.create_sales_stock_batch(_organization_id uuid,_product_id uuid,_variant_id uuid,_batch_code text,_expires_on date,_quantity numeric,_created_by uuid) returns uuid
language plpgsql security invoker set search_path=public as $$
declare _id uuid; _total numeric; begin
 if _quantity<=0 or _quantity is null then raise exception 'Quantity must be positive'; end if;
 if not exists(select 1 from sales_products where id=_product_id and organization_id=_organization_id) then raise exception 'Product not found'; end if;
 if not exists(select 1 from sales_product_variants where id=_variant_id and organization_id=_organization_id and product_id=_product_id) then raise exception 'Variant not found'; end if;
 insert into sales_inventory(product_id,organization_id,quantity) values(_product_id,_organization_id,0) on conflict(product_id) do nothing;
 perform 1 from sales_inventory where product_id=_product_id and organization_id=_organization_id for update;
 insert into sales_stock_batches(organization_id,product_id,variant_id,batch_code,expires_on,quantity) values(_organization_id,_product_id,_variant_id,_batch_code,_expires_on,_quantity) returning id into _id;
 update sales_inventory set quantity=quantity+_quantity,updated_at=now() where product_id=_product_id and organization_id=_organization_id returning quantity into _total;
 insert into sales_inventory_movements(organization_id,product_id,batch_id,movement_type,quantity_delta,quantity_after,reason,created_by) values(_organization_id,_product_id,_id,'adjustment',_quantity,_total,'استلام دفعة مخزون',_created_by);
 return _id;
end $$;
create function public.adjust_sales_stock_batch(_organization_id uuid,_product_id uuid,_batch_id uuid,_quantity_delta numeric,_reason text,_created_by uuid) returns numeric
language plpgsql security invoker set search_path=public as $$
declare _q numeric; _total numeric; begin
 if _quantity_delta is null or _quantity_delta=0 then raise exception 'Invalid adjustment'; end if;
 perform 1 from sales_inventory where product_id=_product_id and organization_id=_organization_id for update;
 if not found then raise exception 'Inventory not found'; end if;
 select quantity into _q from sales_stock_batches where id=_batch_id and product_id=_product_id and organization_id=_organization_id for update;
 if not found then raise exception 'Batch not found'; end if;
 if _q+_quantity_delta<0 then raise exception 'Insufficient batch stock'; end if;
 update sales_stock_batches set quantity=quantity+_quantity_delta,updated_at=now() where id=_batch_id;
 update sales_inventory set quantity=quantity+_quantity_delta,updated_at=now() where product_id=_product_id and organization_id=_organization_id returning quantity into _total;
 insert into sales_inventory_movements(organization_id,product_id,batch_id,movement_type,quantity_delta,quantity_after,reason,created_by) values(_organization_id,_product_id,_batch_id,'adjustment',_quantity_delta,_total,_reason,_created_by);
 return _q+_quantity_delta;
end $$;
-- Old clients only adjust the basic, undated legacy lot, never a combined balance.
create or replace function public.adjust_sales_inventory(_organization_id uuid,_product_id uuid,_quantity_delta numeric,_reason text default null,_created_by uuid default null) returns numeric
language plpgsql security invoker set search_path=public as $$
declare _v uuid; _b uuid; begin
 if not exists(select 1 from sales_products where id=_product_id and organization_id=_organization_id) then raise exception 'Product not found'; end if;
 insert into sales_inventory(product_id,organization_id,quantity) values(_product_id,_organization_id,0) on conflict(product_id) do nothing;
 perform 1 from sales_inventory where product_id=_product_id and organization_id=_organization_id for update;
 select id into _v from sales_product_variants where product_id=_product_id and organization_id=_organization_id and is_default;
 if _v is null then insert into sales_product_variants(organization_id,product_id,label,is_default) values(_organization_id,_product_id,'أساسي — خصائص غير محددة',true) returning id into _v; end if;
 select id into _b from sales_stock_batches where product_id=_product_id and organization_id=_organization_id and is_legacy;
 if _b is null then insert into sales_stock_batches(organization_id,product_id,variant_id,batch_code,is_legacy) values(_organization_id,_product_id,_v,'LEGACY',true) returning id into _b; end if;
 perform adjust_sales_stock_batch(_organization_id,_product_id,_b,_quantity_delta,_reason,_created_by);
 return (select quantity from sales_inventory where product_id=_product_id);
end $$;
create or replace function public.confirm_sales_order(_organization_id uuid,_order_id uuid,_confirmed_by uuid default null) returns void
language plpgsql security invoker set search_path=public as $$
declare _order sales_orders%rowtype; _item record; _batch sales_stock_batches%rowtype; _next numeric; _bid uuid; begin
 select * into _order from sales_orders where id=_order_id and organization_id=_organization_id for update;
 if not found then raise exception 'Order not found'; end if;
 if _order.status<>'draft' then raise exception 'Only draft orders can be confirmed'; end if;
 if not exists(select 1 from sales_order_items where order_id=_order_id) then raise exception 'Order has no items'; end if;
 -- Stable lock ordering also handles duplicate lines and concurrent orders.
 perform 1 from sales_inventory where organization_id=_organization_id and product_id in(select product_id from sales_order_items where order_id=_order_id) order by product_id for update;
 for _item in select * from sales_order_items where order_id=_order_id order by product_id,batch_id,id loop
  if _item.organization_id<>_organization_id or not exists(select 1 from sales_products where id=_item.product_id and organization_id=_organization_id and is_active) then raise exception 'Invalid or inactive product'; end if;
  _bid:=_item.batch_id;
  if _bid is null then select id into _bid from sales_stock_batches where product_id=_item.product_id and organization_id=_organization_id and is_legacy; end if;
  select * into _batch from sales_stock_batches where id=_bid and product_id=_item.product_id and organization_id=_organization_id for update;
  if not found or _batch.quantity<_item.quantity then raise exception 'Insufficient batch stock for %',_item.product_name; end if;
  if _batch.expires_on<current_date then raise exception 'Cannot sell an expired batch'; end if;
  update sales_stock_batches set quantity=quantity-_item.quantity,updated_at=now() where id=_bid;
  update sales_inventory set quantity=quantity-_item.quantity,updated_at=now() where product_id=_item.product_id and organization_id=_organization_id returning quantity into _next;
  update sales_order_items set batch_id=_bid,variant_label=(select label from sales_product_variants where id=_batch.variant_id),attributes_snapshot=(select attributes from sales_product_variants where id=_batch.variant_id),batch_code=_batch.batch_code,expires_on=_batch.expires_on where id=_item.id;
  insert into sales_inventory_movements(organization_id,product_id,batch_id,order_id,movement_type,quantity_delta,quantity_after,reason,created_by) values(_organization_id,_item.product_id,_bid,_order_id,'sale',-_item.quantity,_next,'Order confirmed',_confirmed_by);
 end loop;
 update sales_orders set status='confirmed',confirmed_at=now(),updated_at=now() where id=_order_id;
 update crm_contacts set lifecycle_stage='customer',last_activity_at=now(),updated_at=now() where id=_order.contact_id and organization_id=_organization_id;
 if _order.opportunity_id is not null then
 update opp_opportunities o set stage='won',stage_id=coalesce((select s.id from crm_pipeline_stages s where s.pipeline_id=o.pipeline_id and s.is_won order by s.ord limit 1),o.stage_id),probability=100,outcome='won',value=_order.total,currency=_order.currency,closed_at=now(),updated_at=now() where o.id=_order.opportunity_id and o.organization_id=_organization_id;
 end if;
end $$;
revoke all on function public.create_sales_stock_batch(uuid,uuid,uuid,text,date,numeric,uuid), public.adjust_sales_stock_batch(uuid,uuid,uuid,numeric,text,uuid), public.adjust_sales_inventory(uuid,uuid,numeric,text,uuid), public.confirm_sales_order(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.create_sales_stock_batch(uuid,uuid,uuid,text,date,numeric,uuid), public.adjust_sales_stock_batch(uuid,uuid,uuid,numeric,text,uuid), public.adjust_sales_inventory(uuid,uuid,numeric,text,uuid), public.confirm_sales_order(uuid,uuid,uuid) to service_role;
