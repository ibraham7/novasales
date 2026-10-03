import {readFile} from 'node:fs/promises';import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.LEAD_DB_MODULE);const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role;
create table organizations(id uuid primary key);
create table sales_products(id uuid primary key default gen_random_uuid(),organization_id uuid,name text,sku text,description text,price numeric,currency text,images jsonb,videos jsonb,attributes jsonb,is_active boolean,created_by uuid);
create table sales_inventory(product_id uuid primary key,organization_id uuid,quantity numeric,updated_at timestamptz);
create table sales_inventory_movements(organization_id uuid,product_id uuid,batch_id uuid,movement_type text,quantity_delta numeric,quantity_after numeric,reason text,created_by uuid);
create function sales_price_floor(uuid,jsonb) returns numeric language sql as 'select 0::numeric';
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

alter table sales_product_attributes add column scope text default 'variant',add column is_price_floor boolean default false;
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
`);
await db.exec(await readFile(new URL('../migrations/20261003170146_extend_generic_product_properties.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../migrations/20261003172909_atomic_product_stock_creation.sql',import.meta.url),'utf8'));
const org='11111111-1111-1111-1111-111111111111';await db.query('insert into organizations values($1)',[org]);
const {rows:[def]}=await db.query(`insert into sales_product_attributes(organization_id,name,kind,options) values($1,'المقاس','select','["M","L"]') returning id`,[org]);
const product={name:'test',price:10,currency:'USD',attributes:{},images:[],videos:[]};
const variants=[{label:'M',attributes:{[def.id]:'M'},batches:[{batchCode:'first',quantity:20,expiresOn:'2026-10-10'},{batchCode:'second',quantity:20,expiresOn:'2026-12-10'}]}];
const {rows:[created]}=await db.query('select create_sales_product_with_stock($1,null,$2,$3) as product',[org,JSON.stringify(product),JSON.stringify(variants)]);
const id=created.product.id;const lots=(await db.query('select quantity,expires_on from sales_stock_batches where product_id=$1 order by expires_on',[id])).rows;
assert.equal(lots.length,2);assert.deepEqual(lots.map(b=>Number(b.quantity)),[20,20]);assert.equal(Number((await db.query('select quantity from sales_inventory where product_id=$1',[id])).rows[0].quantity),40);
const count=Number((await db.query('select count(*) from sales_products')).rows[0].count);
await assert.rejects(db.query('select create_sales_product_with_stock($1,null,$2,$3)',[org,JSON.stringify(product),JSON.stringify([{...variants[0],batches:[variants[0].batches[0],variants[0].batches[0]]}])]));
assert.equal(Number((await db.query('select count(*) from sales_products')).rows[0].count),count);
assert.equal(Number((await db.query('select count(*) from sales_inventory_movements')).rows[0].count),2);
await assert.rejects(db.query('select create_sales_product_with_stock($1,null,$2,$3)',[org,JSON.stringify(product),JSON.stringify([{...variants[0],attributes:{[def.id]:'XXL'}}])]));
assert.equal(Number((await db.query('select count(*) from sales_products')).rows[0].count),count);
assert.equal((await db.query("select has_function_privilege('authenticated','create_sales_product_with_stock(uuid,uuid,jsonb,jsonb)','execute') as ok")).rows[0].ok,false);
console.log('Atomic product creation passed: separate lots, exact stock, invalid variants and full rollback including movements');await db.close();
