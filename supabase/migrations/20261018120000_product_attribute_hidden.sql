-- Lets an organization hide a product property that products still use instead of deleting it.
alter table public.sales_product_attributes add column if not exists is_archived boolean not null default false;
