-- Deleting a sales order (waiting or confirmed) takes it off the sales list, stats, buyers and reports
-- while keeping the row as a record of what was deleted, by whom and when. Any stock the order took
-- (a confirmed sale, or a waiting order that holds its stock) goes back to its batch, logged as a
-- sale_cancel movement. Who may delete what is checked by the app before calling this.

alter table public.sales_orders
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid;

create index if not exists sales_orders_live_idx
  on public.sales_orders (organization_id, created_at desc)
  where deleted_at is null;

create or replace function public.delete_sales_order(_organization_id uuid, _order_id uuid, _deleted_by uuid default null)
 returns void
 language plpgsql
 set search_path to 'public'
as $function$
declare _order sales_orders%rowtype; _item record; _next numeric; _bid uuid; _reason text; begin
 select * into _order from sales_orders where id=_order_id and organization_id=_organization_id for update;
 if not found then raise exception 'Order not found'; end if;
 if _order.deleted_at is not null then return; end if;
 if _order.status='confirmed' or (_order.status='draft' and _order.stock_reserved_at is not null) then
  _reason := case when _order.status='confirmed' then 'حذف بيع مؤكد' else 'حذف طلب بانتظار التأكيد' end;
  -- Same lock order as confirm_sales_order, so concurrent orders for one product queue up.
  perform 1 from sales_inventory where organization_id=_organization_id and product_id in(select product_id from sales_order_items where order_id=_order_id) order by product_id for update;
  for _item in select * from sales_order_items where order_id=_order_id order by product_id,batch_id,id loop
   _bid := _item.batch_id;
   if _bid is null then select id into _bid from sales_stock_batches where product_id=_item.product_id and organization_id=_organization_id and is_legacy; end if;
   if _bid is null then continue; end if;
   update sales_stock_batches set quantity=quantity+_item.quantity,updated_at=now() where id=_bid and organization_id=_organization_id;
   update sales_inventory set quantity=quantity+_item.quantity,updated_at=now() where product_id=_item.product_id and organization_id=_organization_id returning quantity into _next;
   insert into sales_inventory_movements(organization_id,product_id,batch_id,order_id,movement_type,quantity_delta,quantity_after,reason,created_by) values(_organization_id,_item.product_id,_bid,_order_id,'sale_cancel',_item.quantity,_next,_reason,_deleted_by);
  end loop;
 end if;
 update sales_orders set deleted_at=now(), deleted_by=_deleted_by, stock_reserved_at=null, updated_at=now() where id=_order_id;
end $function$;

-- Like the other stock functions, only the server (service role) may call it.
revoke all on function public.delete_sales_order(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_sales_order(uuid, uuid, uuid) to service_role;
