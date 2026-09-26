-- NovaSales commerce core: products, inventory and sales orders.
-- Implementation choices:
-- 1) One inventory balance per product for now (multi-warehouse is intentionally deferred).
-- 2) A confirmed sales_order is the sale transaction; no duplicate "sales" table.
-- 3) Order items snapshot product name/SKU/prices so historical sales do not change when products change.

create table if not exists public.sales_products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  sku text,
  description text,
  price numeric(14,2) not null default 0 check (price >= 0),
  currency text not null default 'USD',
  images jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, sku)
);

create index if not exists sales_products_org_active_idx
  on public.sales_products(organization_id, is_active);

create table if not exists public.sales_inventory (
  product_id uuid primary key references public.sales_products(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  quantity numeric(14,3) not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now()
);

create index if not exists sales_inventory_org_idx
  on public.sales_inventory(organization_id);

create table if not exists public.sales_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.crm_contacts(id),
  lead_id uuid references public.crm_leads(id),
  opportunity_id uuid references public.opp_opportunities(id),
  sales_rep_user_id uuid,
  department_id uuid,
  status text not null default 'draft' check (status in ('draft','confirmed','cancelled')),
  currency text not null default 'USD',
  subtotal numeric(14,2) not null default 0 check (subtotal >= 0),
  discount_total numeric(14,2) not null default 0 check (discount_total >= 0),
  total numeric(14,2) not null default 0 check (total >= 0),
  notes text,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sales_orders_org_status_idx
  on public.sales_orders(organization_id, status, created_at desc);
create index if not exists sales_orders_contact_idx on public.sales_orders(contact_id);
create index if not exists sales_orders_rep_idx on public.sales_orders(sales_rep_user_id, created_at desc);
create index if not exists sales_orders_opportunity_idx on public.sales_orders(opportunity_id);

create table if not exists public.sales_order_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_id uuid not null references public.sales_orders(id) on delete cascade,
  product_id uuid not null references public.sales_products(id),
  product_name text not null,
  sku text,
  quantity numeric(14,3) not null check (quantity > 0),
  list_unit_price numeric(14,2) not null check (list_unit_price >= 0),
  sold_unit_price numeric(14,2) not null check (sold_unit_price >= 0),
  line_total numeric(14,2) not null check (line_total >= 0),
  created_at timestamptz not null default now()
);

create index if not exists sales_order_items_order_idx on public.sales_order_items(order_id);
create index if not exists sales_order_items_product_idx on public.sales_order_items(product_id);

create table if not exists public.sales_inventory_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null references public.sales_products(id),
  order_id uuid references public.sales_orders(id),
  movement_type text not null check (movement_type in ('adjustment','sale','sale_cancel')),
  quantity_delta numeric(14,3) not null check (quantity_delta <> 0),
  quantity_after numeric(14,3) not null check (quantity_after >= 0),
  reason text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists sales_inventory_movements_product_idx
  on public.sales_inventory_movements(product_id, created_at desc);

-- Commerce permissions integrate with the existing RBAC model.
insert into public.rbac_permissions(key, description) values
  ('products.view', 'عرض المنتجات'),
  ('products.manage', 'إدارة المنتجات'),
  ('inventory.view', 'عرض المخزون'),
  ('inventory.manage', 'إدارة المخزون'),
  ('sales.orders.create', 'إنشاء عمليات البيع'),
  ('sales.orders.view', 'عرض عمليات البيع'),
  ('sales.orders.manage', 'إدارة عمليات البيع'),
  ('sales.reports.view', 'عرض تقارير المبيعات')
on conflict (key) do nothing;

-- Owner/supervisor: full commerce access.
insert into public.rbac_role_permissions(role_id, permission_key)
select r.id, p.key
from public.rbac_roles r
join public.rbac_permissions p on p.key in (
  'products.view','products.manage','inventory.view','inventory.manage',
  'sales.orders.create','sales.orders.view','sales.orders.manage','sales.reports.view'
)
where r.key in ('owner','supervisor')
on conflict do nothing;

-- Department supervisor: operational visibility without product/stock administration.
insert into public.rbac_role_permissions(role_id, permission_key)
select r.id, p.key
from public.rbac_roles r
join public.rbac_permissions p on p.key in (
  'products.view','inventory.view','sales.orders.create','sales.orders.view','sales.reports.view'
)
where r.key = 'department_supervisor'
on conflict do nothing;

-- Sales rep: catalog is available to the chat flow and orders are scoped in server code to the rep.
insert into public.rbac_role_permissions(role_id, permission_key)
select r.id, p.key
from public.rbac_roles r
join public.rbac_permissions p on p.key in ('products.view','inventory.view','sales.orders.create','sales.orders.view')
where r.key = 'sales'
on conflict do nothing;

-- Atomic stock adjustment used by product administration.
create or replace function public.adjust_sales_inventory(
  _organization_id uuid,
  _product_id uuid,
  _quantity_delta numeric,
  _reason text default null,
  _created_by uuid default null
) returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  _current numeric;
  _next numeric;
begin
  if _quantity_delta = 0 then raise exception 'Quantity delta cannot be zero'; end if;
  if not exists (
    select 1 from public.sales_products
    where id = _product_id and organization_id = _organization_id
  ) then raise exception 'Product not found'; end if;

  insert into public.sales_inventory(product_id, organization_id, quantity)
  values (_product_id, _organization_id, 0)
  on conflict (product_id) do nothing;

  select quantity into _current
  from public.sales_inventory
  where product_id = _product_id and organization_id = _organization_id
  for update;

  _next := _current + _quantity_delta;
  if _next < 0 then raise exception 'Insufficient stock'; end if;

  update public.sales_inventory set quantity = _next, updated_at = now()
  where product_id = _product_id and organization_id = _organization_id;

  insert into public.sales_inventory_movements(
    organization_id, product_id, movement_type, quantity_delta, quantity_after, reason, created_by
  ) values (
    _organization_id, _product_id, 'adjustment', _quantity_delta, _next, _reason, _created_by
  );
  return _next;
end;
$$;

-- Confirm an order and decrement all stock atomically.
create or replace function public.confirm_sales_order(
  _organization_id uuid,
  _order_id uuid,
  _confirmed_by uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _order public.sales_orders%rowtype;
  _item record;
  _current numeric;
  _next numeric;
begin
  select * into _order from public.sales_orders
  where id = _order_id and organization_id = _organization_id
  for update;

  if not found then raise exception 'Order not found'; end if;
  if _order.status <> 'draft' then raise exception 'Only draft orders can be confirmed'; end if;
  if not exists (select 1 from public.sales_order_items where order_id = _order_id) then
    raise exception 'Order has no items';
  end if;

  for _item in
    select * from public.sales_order_items where order_id = _order_id order by product_id
  loop
    select quantity into _current
    from public.sales_inventory
    where product_id = _item.product_id and organization_id = _organization_id
    for update;

    if _current is null or _current < _item.quantity then
      raise exception 'Insufficient stock for product %', _item.product_name;
    end if;

    _next := _current - _item.quantity;
    update public.sales_inventory set quantity = _next, updated_at = now()
    where product_id = _item.product_id and organization_id = _organization_id;

    insert into public.sales_inventory_movements(
      organization_id, product_id, order_id, movement_type,
      quantity_delta, quantity_after, reason, created_by
    ) values (
      _organization_id, _item.product_id, _order_id, 'sale',
      -_item.quantity, _next, 'Order confirmed', _confirmed_by
    );
  end loop;

  update public.sales_orders
  set status = 'confirmed', confirmed_at = now(), updated_at = now()
  where id = _order_id and organization_id = _organization_id;
end;
$$;

-- These RPCs mutate stock and must only be called by the trusted server client.
revoke all on function public.adjust_sales_inventory(uuid, uuid, numeric, text, uuid) from public, anon, authenticated;
revoke all on function public.confirm_sales_order(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.adjust_sales_inventory(uuid, uuid, numeric, text, uuid) to service_role;
grant execute on function public.confirm_sales_order(uuid, uuid, uuid) to service_role;
