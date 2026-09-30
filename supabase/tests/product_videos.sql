begin;
do $$
declare product_id uuid; old_images jsonb; result jsonb;
begin
  select id,images into product_id,old_images from public.sales_products limit 1;
  if product_id is null then raise exception 'A fixture product is required'; end if;
  update public.sales_products set videos='["https://example.com/a.mp4","https://example.com/b.webm"]'::jsonb where id=product_id;
  select images into result from public.sales_products where id=product_id;
  if result is distinct from old_images then raise exception 'Images were altered by video update'; end if;
  begin
    update public.sales_products set videos='{}'::jsonb where id=product_id;
    raise exception 'Invalid video type was accepted';
  exception when check_violation then null;
  end;
  begin
    update public.sales_products set videos='["a","b","c","d","e"]'::jsonb where id=product_id;
    raise exception 'Too many videos were accepted';
  exception when check_violation then null;
  end;
end $$;
select 'Video persistence, image preservation and array constraints: PASS' as result;
rollback;
