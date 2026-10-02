create table public.billing_invoices (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),subscription_id uuid references public.billing_subscriptions(id),
 number text not null unique,amount numeric not null check(amount>=0),currency text not null check(currency ~ '^[A-Z]{3}$'),status text not null default 'open' check(status in ('open','paid','void')),
 provider text not null default 'manual',issued_at timestamptz not null default now(),due_at timestamptz,paid_at timestamptz,notes text,period_start timestamptz,period_end timestamptz,
 check(period_end is null or period_start is null or period_end>=period_start)
);
create table public.billing_usage_counters (
 organization_id uuid not null references public.organizations(id) on delete cascade,period text not null check(period ~ '^\d{4}-\d{2}$'),counter_key text not null,value bigint not null default 0 check(value>=0),updated_at timestamptz not null default now(),primary key(organization_id,period,counter_key)
);
create table public.billing_subscription_overrides (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
 feature_key text references public.billing_features(key),is_enabled boolean,limit_key text,limit_value integer check(limit_value>=-1),reason text,expires_at timestamptz,created_at timestamptz not null default now(),
 check((feature_key is not null and is_enabled is not null and limit_key is null and limit_value is null) or (limit_key is not null and limit_value is not null and feature_key is null and is_enabled is null))
);
create table public.billing_plan_requests (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,plan_id uuid not null references public.billing_plans(id),requested_by uuid not null,
 status text not null default 'pending' check(status in ('pending','resolved')),created_at timestamptz not null default now()
);
create unique index billing_request_once on public.billing_plan_requests(organization_id,plan_id) where status='pending';
create index billing_invoice_org on public.billing_invoices(organization_id,issued_at);
create index billing_invoice_sub on public.billing_invoices(subscription_id);
create index billing_override_org on public.billing_subscription_overrides(organization_id,created_at);
create index billing_override_feature on public.billing_subscription_overrides(feature_key);
create index billing_request_plan on public.billing_plan_requests(plan_id);
create function public.billing_get_effective_features(_org_id uuid) returns table(feature_key text,is_enabled boolean) language sql stable security invoker set search_path=public as $$
 select f.key,coalesce((select o.is_enabled from billing_subscription_overrides o where o.organization_id=_org_id and o.feature_key=f.key and (o.expires_at is null or o.expires_at>now()) order by o.created_at desc,o.id desc limit 1),
 (select pf.is_enabled from billing_plan_features pf join billing_subscriptions s on s.plan_id=pf.plan_id where s.organization_id=_org_id and pf.feature_key=f.key and s.status in ('active','trialing') and (s.current_period_end is null or s.current_period_end>now()) and (s.status!='trialing' or s.trial_ends_at>now())),false)
 from billing_features f where f.is_active;
$$;
create function public.billing_get_effective_limits(_org_id uuid) returns table(limit_key text,limit_value integer) language sql stable security invoker set search_path=public as $$
 with base as (select pl.limit_key,pl.limit_value from billing_plan_limits pl join billing_subscriptions s on s.plan_id=pl.plan_id where s.organization_id=_org_id and s.status in ('active','trialing') and (s.current_period_end is null or s.current_period_end>now()) and (s.status!='trialing' or s.trial_ends_at>now())), overrides as (select distinct on(o.limit_key) o.limit_key,o.limit_value from billing_subscription_overrides o where o.organization_id=_org_id and o.limit_key is not null and (o.expires_at is null or o.expires_at>now()) order by o.limit_key,o.created_at desc,o.id desc)
 select coalesce(o.limit_key,b.limit_key),coalesce(o.limit_value,b.limit_value) from base b full join overrides o on o.limit_key=b.limit_key;
$$;
create function public.billing_increment_counter(_org_id uuid,_period text,_key text,_amount integer) returns void language plpgsql security invoker set search_path=public as $$
begin
 if _amount<0 then raise exception 'negative counter';end if;
 insert into billing_usage_counters(organization_id,period,counter_key,value) values(_org_id,_period,_key,_amount) on conflict(organization_id,period,counter_key) do update set value=billing_usage_counters.value+excluded.value,updated_at=now();
end $$;
create function public.billing_storage_mb(_org_id uuid) returns numeric language sql stable security invoker set search_path=public,storage as $$
 select coalesce(sum(case when (metadata->>'size') ~ '^\d+$' then (metadata->>'size')::numeric else 0 end),0)/1048576 from storage.objects where bucket_id='crm-files' and (name like 'chat-media/'||_org_id::text||'/%' or name like _org_id::text||'/%');
$$;
alter table public.billing_invoices enable row level security;
alter table public.billing_usage_counters enable row level security;
alter table public.billing_subscription_overrides enable row level security;
alter table public.billing_plan_requests enable row level security;
revoke all on public.billing_invoices,public.billing_usage_counters,public.billing_subscription_overrides,public.billing_plan_requests from public,anon,authenticated;
grant all on public.billing_invoices,public.billing_usage_counters,public.billing_subscription_overrides,public.billing_plan_requests to service_role;
revoke all on function public.billing_get_effective_features(uuid),public.billing_get_effective_limits(uuid),public.billing_increment_counter(uuid,text,text,integer),public.billing_storage_mb(uuid) from public,anon,authenticated;
grant execute on function public.billing_get_effective_features(uuid),public.billing_get_effective_limits(uuid),public.billing_increment_counter(uuid,text,text,integer),public.billing_storage_mb(uuid) to service_role;
-- Serialize quota checks with the row mutation, so concurrent inserts cannot bypass limits.
create function public.billing_check_row_limit() returns trigger language plpgsql security invoker set search_path=public as $$
declare k text;max_value integer;current_value bigint;new_active boolean:=true;old_active boolean:=false;s record;
begin
 case TG_TABLE_NAME
 when 'org_memberships' then k='seats';new_active=new.is_active;if TG_OP='UPDATE' then old_active=old.is_active;end if;
 when 'wf_workflows' then k='active_workflows';new_active=new.is_active;if TG_OP='UPDATE' then old_active=old.is_active;end if;
 when 'cmp_campaigns' then k='active_campaigns';new_active=new.status in ('scheduled','running');if TG_OP='UPDATE' then old_active=old.status in ('scheduled','running');end if;
 when 'msg_channel_accounts' then k='whatsapp_accounts';old_active=TG_OP='UPDATE';
 when 'crm_leads' then k='leads';old_active=TG_OP='UPDATE';
 when 'crm_contacts' then k='contacts';old_active=TG_OP='UPDATE';
 when 'opp_opportunities' then k='opportunities';old_active=TG_OP='UPDATE';
 end case;
 if not new_active or old_active then return new;end if;
 perform pg_advisory_xact_lock(hashtextextended(new.organization_id::text,0));
 select * into s from billing_subscriptions where organization_id=new.organization_id;
 if found and (s.status not in ('active','trialing') or (s.current_period_end is not null and s.current_period_end<=now()) or (s.status='trialing' and (s.trial_ends_at is null or s.trial_ends_at<=now()))) then raise exception 'اشتراك المؤسسة غير فعّال؛ تواصل مع الإدارة';end if;
 select limit_value into max_value from billing_get_effective_limits(new.organization_id) where limit_key=k;
 if max_value is null or max_value=-1 then return new;end if;
 if TG_TABLE_NAME in ('org_memberships','wf_workflows') then execute format('select count(*) from public.%I where organization_id=$1 and is_active',TG_TABLE_NAME) into current_value using new.organization_id;
 elsif TG_TABLE_NAME='cmp_campaigns' then select count(*) into current_value from cmp_campaigns where organization_id=new.organization_id and status in ('scheduled','running');
 else execute format('select count(*) from public.%I where organization_id=$1',TG_TABLE_NAME) into current_value using new.organization_id;end if;
 if current_value>=max_value then raise exception 'تم الوصول إلى الحد الأقصى للاشتراك: %',k;end if;
 return new;
end $$;
create trigger billing_quota_seats before insert or update on public.org_memberships for each row execute function public.billing_check_row_limit();
create trigger billing_quota_workflows before insert or update on public.wf_workflows for each row execute function public.billing_check_row_limit();
create trigger billing_quota_campaigns before insert or update on public.cmp_campaigns for each row execute function public.billing_check_row_limit();
create trigger billing_quota_accounts before insert on public.msg_channel_accounts for each row execute function public.billing_check_row_limit();
create trigger billing_quota_leads before insert on public.crm_leads for each row execute function public.billing_check_row_limit();
create trigger billing_quota_contacts before insert on public.crm_contacts for each row execute function public.billing_check_row_limit();
create trigger billing_quota_opportunities before insert on public.opp_opportunities for each row execute function public.billing_check_row_limit();
revoke all on function public.billing_check_row_limit() from public,anon,authenticated;
grant execute on function public.billing_check_row_limit() to service_role;
