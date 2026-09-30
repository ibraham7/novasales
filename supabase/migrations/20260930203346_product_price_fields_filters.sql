alter table public.sales_product_attributes drop constraint sales_product_attributes_kind_check;
alter table public.sales_product_attributes
  add constraint sales_product_attributes_kind_check check(kind in ('text','select','multiselect','number','date','money')),
  add column scope text not null default 'variant' check(scope in ('product','variant')),
  add column is_price_floor boolean not null default false,
  add constraint sales_attribute_money_scope check(kind <> 'money' or scope='product'),
  add constraint sales_attribute_floor_kind check(not is_price_floor or (kind='money' and scope='product'));
alter table public.sales_products add column attributes jsonb not null default '{}'::jsonb check(jsonb_typeof(attributes)='object');
alter table public.sales_order_items add column minimum_unit_price numeric not null default 0 check(minimum_unit_price>=0);

create function public.sales_price_floor(_organization_id uuid,_attributes jsonb) returns numeric
language sql stable security invoker set search_path=public as $$
  select coalesce(max((_attributes->>a.id::text)::numeric),0)
  from sales_product_attributes a
  where a.organization_id=_organization_id and a.scope='product' and a.kind='money' and a.is_price_floor
    and jsonb_typeof(_attributes->a.id::text)='number';
$$;

create function public.validate_sales_product_fields() returns trigger
language plpgsql security invoker set search_path=public as $$
declare pair record; def sales_product_attributes%rowtype; valid boolean; begin
  if jsonb_typeof(new.attributes)<>'object' then raise exception 'حقول المنتج غير صالحة'; end if;
  for pair in select * from jsonb_each(new.attributes) loop
    select * into def from sales_product_attributes where id::text=pair.key and organization_id=new.organization_id and scope='product';
    if not found then raise exception 'خاصية المنتج لا تنتمي لهذه المؤسسة'; end if;
    valid:=false;
    case def.kind
      when 'number' then valid:=jsonb_typeof(pair.value)='number';
      when 'money' then valid:=jsonb_typeof(pair.value)='number'; if valid then valid:=(pair.value#>>'{}')::numeric>=0; end if;
      when 'text' then valid:=jsonb_typeof(pair.value)='string' and length(trim(pair.value#>>'{}'))>0;
      when 'date' then
        if jsonb_typeof(pair.value)='string' and (pair.value#>>'{}')~'^\d{4}-\d{2}-\d{2}$' then
          begin valid:=to_char((pair.value#>>'{}')::date,'YYYY-MM-DD')=(pair.value#>>'{}'); exception when others then valid:=false; end;
        end if;
      when 'select' then valid:=jsonb_typeof(pair.value)='string' and def.options ? (pair.value#>>'{}');
      when 'multiselect' then
        if jsonb_typeof(pair.value)='array' and jsonb_array_length(pair.value)>0 then
          valid:=not exists(select 1 from jsonb_array_elements(pair.value) v where jsonb_typeof(v)<>'string' or not(def.options ? (v#>>'{}')))
            and (select count(distinct v) from jsonb_array_elements(pair.value) v)=jsonb_array_length(pair.value);
        end if;
    end case;
    if not valid then raise exception 'قيمة غير صالحة للخاصية: %',def.name; end if;
  end loop;
  if new.price::text in ('NaN','Infinity','-Infinity') or new.price<sales_price_floor(new.organization_id,new.attributes) then
    raise exception 'سعر المبيع أقل من الحد الأدنى المحدد للتكلفة';
  end if;
  return new;
end $$;
create trigger sales_product_fields_check before insert or update of attributes,price,currency on public.sales_products
for each row execute function public.validate_sales_product_fields();

create function public.validate_sales_line_price() returns trigger
language plpgsql security invoker set search_path=public as $$
declare p sales_products%rowtype; o sales_orders%rowtype; begin
  select * into o from sales_orders where id=new.order_id and organization_id=new.organization_id;
  if not found then raise exception 'Order not found'; end if;
  select * into p from sales_products where id=new.product_id and organization_id=new.organization_id for share;
  if not found then raise exception 'Product not found'; end if;
  if p.currency<>o.currency then raise exception 'عملة المنتج تختلف عن الطلب'; end if;
  new.minimum_unit_price:=greatest(new.minimum_unit_price,sales_price_floor(new.organization_id,p.attributes));
  if new.sold_unit_price::text in ('NaN','Infinity','-Infinity') or new.sold_unit_price<new.minimum_unit_price then raise exception 'لا يمكن البيع بأقل من الحد الأدنى %',new.minimum_unit_price; end if;
  if new.sold_unit_price>new.list_unit_price then raise exception 'سعر البيع يتجاوز السعر الأساسي'; end if;
  return new;
end $$;
create trigger sales_line_price_check before insert or update of sold_unit_price,list_unit_price,minimum_unit_price,product_id,organization_id,order_id on public.sales_order_items
for each row execute function public.validate_sales_line_price();

revoke all on function public.sales_price_floor(uuid,jsonb),public.validate_sales_product_fields(),public.validate_sales_line_price() from public,anon,authenticated;
grant execute on function public.sales_price_floor(uuid,jsonb),public.validate_sales_product_fields(),public.validate_sales_line_price() to service_role;

-- Recheck current and snapshotted cost when confirming; keep stock deduction atomic.
create or replace function public.confirm_sales_order(_organization_id uuid,_order_id uuid,_confirmed_by uuid default null) returns void
language plpgsql security invoker set search_path=public as $$
declare _order sales_orders%rowtype; _item record; _batch sales_stock_batches%rowtype; _next numeric; _bid uuid; _floor numeric; _product sales_products%rowtype; begin
 select * into _order from sales_orders where id=_order_id and organization_id=_organization_id for update;
 if not found then raise exception 'Order not found'; end if;
 if _order.status<>'draft' then raise exception 'Only draft orders can be confirmed'; end if;
 if not exists(select 1 from sales_order_items where order_id=_order_id) then raise exception 'Order has no items'; end if;
 perform 1 from sales_products where organization_id=_organization_id and id in(select product_id from sales_order_items where order_id=_order_id) order by id for share;
 -- Stable lock ordering also handles duplicate lines and concurrent orders.
 perform 1 from sales_inventory where organization_id=_organization_id and product_id in(select product_id from sales_order_items where order_id=_order_id) order by product_id for update;
 for _item in select * from sales_order_items where order_id=_order_id order by product_id,batch_id,id loop
  if _item.organization_id<>_organization_id or not exists(select 1 from sales_products where id=_item.product_id and organization_id=_organization_id and is_active) then raise exception 'Invalid or inactive product'; end if;
  select * into _product from sales_products where id=_item.product_id and organization_id=_organization_id;
  if _product.currency<>_order.currency then raise exception 'عملة المنتج تغيرت؛ أعد إنشاء الطلب'; end if;
  _floor:=greatest(_item.minimum_unit_price,sales_price_floor(_organization_id,_product.attributes));
  if _item.sold_unit_price<_floor then raise exception 'لا يمكن البيع بأقل من الحد الأدنى %',_floor; end if;
  if _item.sold_unit_price>_item.list_unit_price then raise exception 'سعر البيع يتجاوز السعر الأساسي'; end if;
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
