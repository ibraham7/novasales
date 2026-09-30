-- Use the same database RBAC predicate as the server. org_memberships is
-- server-only and cannot be queried inside a client RLS policy.
alter policy organization_catalog_read on public.sales_product_attributes using(public.has_permission((select auth.uid()),organization_id,'products.view'));
alter policy organization_catalog_read on public.sales_product_variants using(public.has_permission((select auth.uid()),organization_id,'products.view'));
alter policy organization_catalog_read on public.sales_stock_batches using(public.has_permission((select auth.uid()),organization_id,'products.view'));
-- Database enforcement of parent tenant/product integrity, independently of UI validation.
alter table public.sales_products add constraint sales_products_org_id_unique unique(organization_id,id);
alter table public.sales_product_variants add constraint sales_variants_product_scope_fk foreign key(organization_id,product_id) references public.sales_products(organization_id,id);
alter table public.sales_order_items add constraint sales_order_items_batch_scope_fk foreign key(organization_id,product_id,batch_id) references public.sales_stock_batches(organization_id,product_id,id);
alter table public.sales_inventory_movements add constraint sales_movements_batch_scope_fk foreign key(organization_id,product_id,batch_id) references public.sales_stock_batches(organization_id,product_id,id);
