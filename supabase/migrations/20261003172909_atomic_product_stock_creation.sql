-- A single RPC transaction: product, variants, lots and stock movements all commit or roll back.
create function public.create_sales_product_with_stock(_organization_id uuid,_created_by uuid,_product jsonb,_variants jsonb default '[]') returns jsonb
language plpgsql security invoker set search_path=public as $$
declare p sales_products%rowtype; v jsonb; b jsonb; vid uuid; attrs jsonb; quantity numeric;
begin
 if jsonb_typeof(_product)<>'object' or jsonb_typeof(_variants)<>'array' or jsonb_array_length(_variants)>100 then raise exception 'بيانات المنتج أو التركيبات غير صالحة';end if;
 insert into sales_products(organization_id,name,sku,description,price,currency,images,videos,attributes,is_active,created_by)
 values(_organization_id,trim(_product->>'name'),nullif(_product->>'sku',''),nullif(_product->>'description',''),(_product->>'price')::numeric,_product->>'currency',coalesce(_product->'images','[]'),coalesce(_product->'videos','[]'),coalesce(_product->'attributes','{}'),coalesce((_product->>'is_active')::boolean,true),_created_by) returning * into p;
 insert into sales_inventory(product_id,organization_id,quantity) values(p.id,_organization_id,0);
 if jsonb_array_length(_variants)=0 then
  insert into sales_product_variants(organization_id,product_id,label,is_default) values(_organization_id,p.id,'أساسي',true);
 else
  for v in select value from jsonb_array_elements(_variants) loop
   attrs:=coalesce(v->'attributes','{}');
   if jsonb_typeof(attrs)<>'object' or jsonb_typeof(v->'batches')<>'array' or jsonb_array_length(v->'batches')>100 then raise exception 'بيانات التركيبة أو الدفعات غير صالحة';end if;
   insert into sales_product_variants(organization_id,product_id,label,attributes,is_default) values(_organization_id,p.id,trim(v->>'label'),attrs,attrs='{}'::jsonb) returning id into vid;
   for b in select value from jsonb_array_elements(v->'batches') loop
    quantity:=(b->>'quantity')::numeric;
    if quantity is null or quantity::text in ('NaN','Infinity','-Infinity') or quantity<=0 or quantity<>round(quantity,3) then raise exception 'كمية الدفعة غير صالحة';end if;
    perform create_sales_stock_batch(_organization_id,p.id,vid,trim(b->>'batchCode'),nullif(b->>'expiresOn','')::date,quantity,_created_by);
   end loop;
  end loop;
 end if;
 return to_jsonb(p);
end $$;
revoke all on function public.create_sales_product_with_stock(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.create_sales_product_with_stock(uuid,uuid,jsonb,jsonb) to service_role;
