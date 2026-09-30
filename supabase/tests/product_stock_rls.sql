begin;
do $$ declare o uuid; other_o uuid; u uuid; r uuid; begin
 select ur.user_id into u from rbac_user_roles ur where not public.has_role(ur.user_id,'admin') limit 1;
 if u is null then raise exception 'Non-admin test user required'; end if;
 insert into organizations(name,slug) values('RLS fixture','rls-test-'||gen_random_uuid()) returning id into o;
 insert into organizations(name,slug) values('Other RLS fixture','rls-other-'||gen_random_uuid()) returning id into other_o;
 insert into rbac_roles(organization_id,key,name) values(o,'stock_test','Stock test') returning id into r;
 insert into rbac_role_permissions(role_id,permission_key) values(r,'products.view');
 insert into rbac_user_roles(organization_id,user_id,role_id) values(o,u,r);
 insert into sales_product_attributes(organization_id,name,kind) values(o,'Allowed','text'),(other_o,'Hidden','text');
 perform set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true);
 perform set_config('stock_test.org',o::text,true);
 perform set_config('stock_test.other_org',other_o::text,true);
end $$;
set local role authenticated;
do $$ declare t text; visible integer; begin
 select count(*) into visible from sales_product_attributes where organization_id=current_setting('stock_test.org')::uuid;
 if visible<>1 then raise exception 'Own org read denied'; end if;
 foreach t in array array['sales_product_attributes','sales_product_variants','sales_stock_batches'] loop
 execute format('select count(*) from public.%I where organization_id=$1',t) into visible using current_setting('stock_test.other_org')::uuid;
 if visible<>0 then raise exception 'Cross org rows visible'; end if;
 if has_table_privilege('anon','public.'||t,'select') or has_table_privilege('authenticated','public.'||t,'insert') or has_table_privilege('authenticated','public.'||t,'update') or has_table_privilege('authenticated','public.'||t,'delete') then raise exception 'Unexpected client write access'; end if;
 end loop;
end $$;
reset role;
select 'RLS own-org read, other-org isolation, client writes and anonymous reads denied: PASS' result;
rollback;
