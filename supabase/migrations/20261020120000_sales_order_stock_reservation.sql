-- A new sales order holds its stock at once, so the same piece cannot be sold to someone else
-- while the order waits for confirmation. Confirming no longer takes stock a second time, and
-- cancelling a waiting order puts its held stock back.
-- Orders created before this change hold nothing (stock_reserved_at is null) and keep the old
-- behaviour: stock is taken when they are confirmed, and cancelling them returns nothing.

alter table public.sales_orders add column if not exists stock_reserved_at timestamptz;

create or replace function public.reserve_sales_order_stock(_organization_id uuid, _order_id uuid, _reserved_by uuid default null)
 returns void
 language plpgsql
 set search_path to 'public'
as $function$
declare _order sales_orders%rowtype; _item record; _batch sales_stock_batches%rowtype; _next numeric; _bid uuid; begin
 select * into _order from sales_orders where id=_order_id and organization_id=_organization_id for update;
 if not found then raise exception 'Order not found'; end if;
 if _order.status<>'draft' then raise exception 'Only waiting orders can hold stock'; end if;
 if _order.stock_reserved_at is not null then return; end if;
 if not exists(select 1 from sales_order_items where order_id=_order_id) then raise exception 'Order has no items'; end if;
 -- Same lock order as confirm_sales_order, so concurrent orders for one product queue up.
 perform 1 from sales_inventory where organization_id=_organization_id and product_id in(select product_id from sales_order_items where order_id=_order_id) order by product_id for update;
 for _item in select * from sales_order_items where order_id=_order_id order by product_id,batch_id,id loop
  _bid:=_item.batch_id;
  if _bid is null then select id into _bid from sales_stock_batches where product_id=_item.product_id and organization_id=_organization_id and is_legacy; end if;
  select * into _batch from sales_stock_batches where id=_bid and product_id=_item.product_id and organization_id=_organization_id for update;
  if not found or _batch.quantity<_item.quantity then raise exception 'الكمية غير كافية للدفعة %', coalesce(_batch.batch_code, _item.product_name); end if;
  if _batch.expires_on<current_date then raise exception 'Cannot sell an expired batch'; end if;
  update sales_stock_batches set quantity=quantity-_item.quantity,updated_at=now() where id=_bid;
  update sales_inventory set quantity=quantity-_item.quantity,updated_at=now() where product_id=_item.product_id and organization_id=_organization_id returning quantity into _next;
  update sales_order_items set batch_id=_bid where id=_item.id and batch_id is null;
  insert into sales_inventory_movements(organization_id,product_id,batch_id,order_id,movement_type,quantity_delta,quantity_after,reason,created_by) values(_organization_id,_item.product_id,_bid,_order_id,'sale',-_item.quantity,_next,'حجز لطلب بانتظار التأكيد',_reserved_by);
 end loop;
 update sales_orders set stock_reserved_at=now(),updated_at=now() where id=_order_id;
end $function$;

-- Unchanged from the live definition except that an order whose stock is already held does not
-- take it again.
create or replace function public.confirm_sales_order(_organization_id uuid, _order_id uuid, _confirmed_by uuid default null)
 returns void
 language plpgsql
 set search_path to 'public'
as $function$
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
  if _order.stock_reserved_at is null then
   select * into _batch from sales_stock_batches where id=_bid and product_id=_item.product_id and organization_id=_organization_id for update;
   if not found or _batch.quantity<_item.quantity then raise exception 'Insufficient batch stock for %',_item.product_name; end if;
   if _batch.expires_on<current_date then raise exception 'Cannot sell an expired batch'; end if;
   update sales_stock_batches set quantity=quantity-_item.quantity,updated_at=now() where id=_bid;
   update sales_inventory set quantity=quantity-_item.quantity,updated_at=now() where product_id=_item.product_id and organization_id=_organization_id returning quantity into _next;
   insert into sales_inventory_movements(organization_id,product_id,batch_id,order_id,movement_type,quantity_delta,quantity_after,reason,created_by) values(_organization_id,_item.product_id,_bid,_order_id,'sale',-_item.quantity,_next,'Order confirmed',_confirmed_by);
  else
   select * into _batch from sales_stock_batches where id=_bid and product_id=_item.product_id and organization_id=_organization_id;
  end if;
  update sales_order_items set batch_id=_bid,variant_label=(select label from sales_product_variants where id=_batch.variant_id),attributes_snapshot=(select attributes from sales_product_variants where id=_batch.variant_id),batch_code=_batch.batch_code,expires_on=_batch.expires_on where id=_item.id;
 end loop;
 update sales_orders set status='confirmed',confirmed_at=now(),updated_at=now() where id=_order_id;
 update crm_contacts set lifecycle_stage='customer',last_activity_at=now(),updated_at=now() where id=_order.contact_id and organization_id=_organization_id;
 if _order.opportunity_id is not null then
 update opp_opportunities o set stage='won',stage_id=coalesce((select s.id from crm_pipeline_stages s where s.pipeline_id=o.pipeline_id and s.is_won order by s.ord limit 1),o.stage_id),probability=100,outcome='won',value=_order.total,currency=_order.currency,closed_at=now(),updated_at=now() where o.id=_order.opportunity_id and o.organization_id=_organization_id;
 end if;
end $function$;

-- Cancels an order that still waits for confirmation and returns any stock it holds.
create or replace function public.cancel_sales_order(_organization_id uuid, _order_id uuid, _cancelled_by uuid default null)
 returns void
 language plpgsql
 set search_path to 'public'
as $function$
declare _order sales_orders%rowtype; _item record; _next numeric; begin
 select * into _order from sales_orders where id=_order_id and organization_id=_organization_id for update;
 if not found then raise exception 'Order not found'; end if;
 if _order.status<>'draft' then raise exception 'لا يمكن إلغاء إلا الطلبات بانتظار التأكيد'; end if;
 if _order.stock_reserved_at is not null then
  perform 1 from sales_inventory where organization_id=_organization_id and product_id in(select product_id from sales_order_items where order_id=_order_id) order by product_id for update;
  for _item in select * from sales_order_items where order_id=_order_id order by product_id,batch_id,id loop
   update sales_stock_batches set quantity=quantity+_item.quantity,updated_at=now() where id=_item.batch_id and organization_id=_organization_id;
   update sales_inventory set quantity=quantity+_item.quantity,updated_at=now() where product_id=_item.product_id and organization_id=_organization_id returning quantity into _next;
   insert into sales_inventory_movements(organization_id,product_id,batch_id,order_id,movement_type,quantity_delta,quantity_after,reason,created_by) values(_organization_id,_item.product_id,_item.batch_id,_order_id,'sale_cancel',_item.quantity,_next,'إلغاء طلب بانتظار التأكيد',_cancelled_by);
  end loop;
 end if;
 update sales_orders set status='cancelled',stock_reserved_at=null,updated_at=now() where id=_order_id;
end $function$;

-- Like the other stock functions, only the server (service role) may call these.
revoke all on function public.reserve_sales_order_stock(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.cancel_sales_order(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.reserve_sales_order_stock(uuid, uuid, uuid) to service_role;
grant execute on function public.cancel_sales_order(uuid, uuid, uuid) to service_role;
