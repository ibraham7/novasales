-- Delete only unused products; preserve sales and inventory history.
create or replace function public.delete_unused_sales_product(_organization_id uuid, _product_id uuid)
returns void language plpgsql security invoker set search_path = public as $$
begin
  -- Stock operations lock the inventory balance first.
  perform 1 from sales_inventory where product_id = _product_id and organization_id = _organization_id for update;
  perform 1 from sales_products where id = _product_id and organization_id = _organization_id for update;
  if not found then raise exception 'المنتج غير موجود في مؤسستك'; end if;
  if exists(select 1 from sales_order_items where product_id = _product_id)
     or exists(select 1 from sales_inventory_movements where product_id = _product_id) then
    raise exception 'لا يمكن حذف منتج مرتبط بمبيعات أو حركات مخزون؛ يمكنك تعطيله من تعديل المنتج';
  end if;
  if exists(select 1 from sales_inventory where product_id = _product_id and quantity <> 0)
     or exists(select 1 from sales_stock_batches where product_id = _product_id and quantity <> 0) then
    raise exception 'لا يمكن حذف منتج له كمية في المخزون؛ يمكنك تعطيله من تعديل المنتج';
  end if;
  delete from sales_stock_batches where product_id = _product_id and organization_id = _organization_id;
  delete from sales_product_variants where product_id = _product_id and organization_id = _organization_id;
  delete from sales_inventory where product_id = _product_id and organization_id = _organization_id;
  delete from sales_products where id = _product_id and organization_id = _organization_id;
end $$;
revoke all on function public.delete_unused_sales_product(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_unused_sales_product(uuid, uuid) to service_role;
