-- Execute against a migrated test database. All fixtures roll back.
begin;
do $$
declare o uuid; other_o uuid; p uuid; v uuid; b1 uuid; b2 uuid; expired uuid; c uuid; ord uuid; q numeric; failed boolean;
begin
 insert into organizations(name,slug) values('Stock test','stock-test-'||gen_random_uuid()) returning id into o;
 insert into organizations(name,slug) values('Other stock test','stock-other-'||gen_random_uuid()) returning id into other_o;
 insert into sales_products(organization_id,name,price) values(o,'Stock test product',20) returning id into p;
 insert into sales_product_variants(organization_id,product_id,label,attributes) values(o,p,'Test variant','{}') returning id into v;
 b1:=create_sales_stock_batch(o,p,v,'EARLY',current_date+7,20,null);
 b2:=create_sales_stock_batch(o,p,v,'LATE',current_date+60,20,null);
 if (select quantity from sales_inventory where product_id=p)<>40 then raise exception 'aggregate failed'; end if;
 insert into crm_contacts(organization_id,full_name) values(o,'Test buyer') returning id into c;
 insert into sales_orders(organization_id,contact_id,total) values(o,c,100) returning id into ord;
 insert into sales_order_items(organization_id,order_id,product_id,batch_id,product_name,quantity,list_unit_price,sold_unit_price,line_total) values(o,ord,p,b1,'Test',5,20,20,100);
 perform confirm_sales_order(o,ord,null);
 if (select quantity from sales_stock_batches where id=b1)<>15 or (select quantity from sales_stock_batches where id=b2)<>20 then raise exception 'separate batch deduction failed'; end if;
 if (select quantity from sales_inventory where product_id=p)<>35 then raise exception 'total deduction failed'; end if;
 if not exists(select 1 from sales_order_items where order_id=ord and batch_code='EARLY' and expires_on=current_date+7 and variant_label='Test variant') then raise exception 'snapshot failed'; end if;
 failed:=false;
 begin perform confirm_sales_order(o,ord,null); exception when others then failed:=true; end;
 if not failed then raise exception 'double confirmation allowed'; end if;
 failed:=false;
 begin perform adjust_sales_stock_batch(o,p,b1,-16,'test',null); exception when others then failed:=true; end;
 if not failed then raise exception 'negative stock allowed'; end if;
 -- Multiple lines exceeding one batch must fail atomically (no partial decrement).
 insert into sales_orders(organization_id,contact_id) values(o,c) returning id into ord;
 insert into sales_order_items(organization_id,order_id,product_id,batch_id,product_name,quantity,list_unit_price,sold_unit_price,line_total) values(o,ord,p,b1,'Test',10,20,20,200),(o,ord,p,b1,'Test',10,20,20,200);
 failed:=false;
 begin perform confirm_sales_order(o,ord,null); exception when others then failed:=true; end;
 if not failed or (select quantity from sales_stock_batches where id=b1)<>15 or (select status from sales_orders where id=ord)<>'draft' then raise exception 'atomic rollback failed'; end if;
 expired:=create_sales_stock_batch(o,p,v,'EXPIRED',current_date-1,2,null);
 insert into sales_orders(organization_id,contact_id) values(o,c) returning id into ord;
 insert into sales_order_items(organization_id,order_id,product_id,batch_id,product_name,quantity,list_unit_price,sold_unit_price,line_total) values(o,ord,p,expired,'Test',1,20,20,20);
 failed:=false;
 begin perform confirm_sales_order(o,ord,null); exception when others then failed:=true; end;
 if not failed or (select quantity from sales_stock_batches where id=expired)<>2 then raise exception 'expired sale allowed'; end if;
 failed:=false;
 begin perform adjust_sales_stock_batch(other_o,p,b2,-1,'test',null); exception when others then failed:=true; end;
 if not failed then raise exception 'cross org stock adjustment allowed'; end if;
 failed:=false;
 begin insert into sales_product_variants(organization_id,product_id,label) values(other_o,p,'Invalid'); exception when foreign_key_violation then failed:=true; end;
 if not failed then raise exception 'cross org parent allowed'; end if;
 if has_function_privilege('authenticated','public.confirm_sales_order(uuid,uuid,uuid)','execute') or has_function_privilege('anon','public.create_sales_stock_batch(uuid,uuid,uuid,text,date,numeric,uuid)','execute') then raise exception 'stock RPC exposed'; end if;
end $$;
select 'batch isolation, snapshots, expiry, duplicate confirmation, atomic rollback, tenant checks: PASS' result;
rollback;
