create table if not exists public.platform_settings (
 key text primary key, value jsonb not null default '{}'::jsonb,
 updated_at timestamptz not null default now(), updated_by uuid
);
alter table public.platform_settings enable row level security;
revoke all on public.platform_settings from public,anon,authenticated;
grant all on public.platform_settings to service_role;
insert into public.platform_settings(key,value) values ('general','{"platform_name":"NovaSales","login_description":"منصة إدارة عمليات المبيعات","support_email":"","default_currency":"USD"}') on conflict(key) do nothing;
create or replace function public.platform_save_general_settings(_value jsonb,_actor uuid) returns void
language plpgsql security invoker set search_path=public as $$
begin
 if not exists(select 1 from user_roles where user_id=_actor and role='admin') then raise exception 'Administrator required'; end if;
 insert into platform_settings(key,value,updated_by,updated_at) values('general',_value,_actor,now())
 on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
 insert into platform_audit_log(action,actor_user_id,target_type,target_id,metadata)
 values('setting.updated',_actor,'setting','general',jsonb_build_object('value',_value));
end $$;
revoke all on function public.platform_save_general_settings(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.platform_save_general_settings(jsonb,uuid) to service_role;
