alter table public.sales_product_attributes drop constraint sales_product_attributes_kind_check;
alter table public.sales_product_attributes add constraint sales_product_attributes_kind_check check(kind in ('text','select','multiselect','number','date','money','boolean','url','file'));
create or replace function public.validate_sales_product_fields() returns trigger
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
      when 'boolean' then valid:=jsonb_typeof(pair.value)='boolean';
      when 'url','file' then valid:=jsonb_typeof(pair.value)='string' and (pair.value#>>'{}') ~ '^https?://[^[:space:]/]+([/?#][^[:space:]]*)?$';
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
create or replace function public.validate_sales_variant_fields() returns trigger
language plpgsql security invoker set search_path=public as $$
declare pair record; def sales_product_attributes%rowtype; valid boolean; begin
  if jsonb_typeof(new.attributes)<>'object' then raise exception 'حقول المنتج غير صالحة'; end if;
  for pair in select * from jsonb_each(new.attributes) loop
    select * into def from sales_product_attributes where id::text=pair.key and organization_id=new.organization_id and scope='variant';
    if not found then raise exception 'خاصية المنتج لا تنتمي لهذه المؤسسة'; end if;
    valid:=false;
    case def.kind
      when 'number' then valid:=jsonb_typeof(pair.value)='number';
      when 'money' then valid:=jsonb_typeof(pair.value)='number'; if valid then valid:=(pair.value#>>'{}')::numeric>=0; end if;
      when 'boolean' then valid:=jsonb_typeof(pair.value)='boolean';
      when 'url','file' then valid:=jsonb_typeof(pair.value)='string' and (pair.value#>>'{}') ~ '^https?://[^[:space:]/]+([/?#][^[:space:]]*)?$';
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
  return new;
end $$;

create trigger sales_variant_fields_check before insert or update of attributes,organization_id on public.sales_product_variants for each row execute function public.validate_sales_variant_fields();
revoke all on function public.validate_sales_product_fields(),public.validate_sales_variant_fields() from public,anon,authenticated;
grant execute on function public.validate_sales_product_fields(),public.validate_sales_variant_fields() to service_role;
