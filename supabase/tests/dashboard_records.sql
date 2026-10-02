begin;
do $$
declare org uuid; entity uuid:=gen_random_uuid(); rowid uuid; n integer;
begin
 select id into org from public.organizations limit 1;
 if org is null then raise exception 'Missing organization fixture'; end if;
 insert into public.crm_activities(organization_id,entity_type,entity_id,activity_type,subject,direction) values(org,'contact',entity,'call','Dashboard test','outbound') returning id into rowid;
 if not exists(select 1 from public.crm_activities where id=rowid and occurred_at is not null) then raise exception 'Activity write/read failed'; end if;
 insert into public.crm_tasks(organization_id,entity_type,entity_id,title,due_at) values(org,'contact',entity,'Dashboard test',now()) returning id into rowid;
 update public.crm_tasks set status='done',completed_at=now() where id=rowid;
 if not exists(select 1 from public.crm_tasks where id=rowid and status='done' and completed_at is not null) then raise exception 'Task completion failed'; end if;
 begin update public.crm_tasks set status='invalid' where id=rowid; raise exception 'Invalid status accepted'; exception when check_violation then null; end;
 insert into public.crm_timeline(organization_id,entity_type,entity_id,event_kind,title) values(org,'contact',entity,'test','Dashboard test') returning id into rowid;
 if not exists(select 1 from public.crm_timeline where id=rowid and occurred_at is not null) then raise exception 'Timeline write/read failed'; end if;
 select count(*) into n from pg_tables where schemaname='public' and tablename in ('crm_activities','crm_tasks','crm_timeline') and rowsecurity;
 if n<>3 then raise exception 'Missing RLS'; end if;
 if has_table_privilege('anon','public.crm_activities','SELECT') or has_table_privilege('authenticated','public.crm_tasks','UPDATE') or has_table_privilege('authenticated','public.crm_timeline','SELECT') then raise exception 'Unexpected client grants'; end if;
end $$;
rollback;
