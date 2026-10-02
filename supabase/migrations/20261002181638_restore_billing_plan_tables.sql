-- Stage after deploying the billing admin authorization guards.
create table public.billing_features (
 key text primary key, label text not null, description text, category text not null default 'general',
 is_active boolean not null default true, sort_order integer not null default 0,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.billing_plans (
 id uuid primary key default gen_random_uuid(), code text not null unique check(code ~ '^[a-z0-9_-]{2,60}$'),
 name text not null check(length(trim(name)) between 1 and 120), description text,
 status text not null default 'draft' check(status in ('draft','published','archived')),
 price_monthly numeric not null default 0 check(price_monthly>=0),
 price_quarterly numeric not null default 0 check(price_quarterly>=0),
 price_yearly numeric not null default 0 check(price_yearly>=0),
 currency text not null default 'USD', trial_days integer not null default 0 check(trial_days>=0),
 is_public boolean not null default true, sort_order integer not null default 0,
 created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.billing_plan_features (
 plan_id uuid not null references public.billing_plans(id) on delete cascade,
 feature_key text not null references public.billing_features(key), is_enabled boolean not null default true,
 primary key(plan_id,feature_key)
);
create table public.billing_plan_limits (
 plan_id uuid not null references public.billing_plans(id) on delete cascade,
 limit_key text not null, limit_value integer not null check(limit_value>=-1), primary key(plan_id,limit_key)
);
create table public.billing_subscriptions (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null unique references public.organizations(id),
 plan_id uuid not null references public.billing_plans(id), provider text not null default 'manual',
 provider_customer_id text, provider_subscription_id text,
 status text not null default 'active' check(status in ('active','trialing','canceled','suspended','past_due','unpaid','incomplete','expired')),
 billing_period text not null default 'monthly' check(billing_period in ('monthly','quarterly','yearly')),
 current_period_start timestamptz not null default now(), current_period_end timestamptz, trial_ends_at timestamptz,
 cancel_at_period_end boolean not null default false, canceled_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index billing_subscriptions_plan_id_idx on public.billing_subscriptions(plan_id);
create index billing_plan_features_feature_key_idx on public.billing_plan_features(feature_key);
alter table public.billing_features enable row level security;
alter table public.billing_plans enable row level security;
alter table public.billing_plan_features enable row level security;
alter table public.billing_plan_limits enable row level security;
alter table public.billing_subscriptions enable row level security;
revoke all on public.billing_features,public.billing_plans,public.billing_plan_features,public.billing_plan_limits,public.billing_subscriptions from public,anon,authenticated;
grant all on public.billing_features,public.billing_plans,public.billing_plan_features,public.billing_plan_limits,public.billing_subscriptions to service_role;
-- Restrict API access to authorized server functions. No client-side grants.
create function public.billing_save_plan(_plan jsonb,_features jsonb,_limits jsonb) returns uuid
language plpgsql security invoker set search_path=public as $$
declare pid uuid := nullif(_plan->>'id','')::uuid; begin
 if pid is null then
  insert into billing_plans(code,name,description,status,price_monthly,price_quarterly,price_yearly,currency,trial_days,is_public,sort_order)
  values(_plan->>'code',_plan->>'name',_plan->>'description',_plan->>'status',(_plan->>'price_monthly')::numeric,(_plan->>'price_quarterly')::numeric,(_plan->>'price_yearly')::numeric,_plan->>'currency',(_plan->>'trial_days')::integer,(_plan->>'is_public')::boolean,(_plan->>'sort_order')::integer) returning id into pid;
 else
  update billing_plans set code=_plan->>'code',name=_plan->>'name',description=_plan->>'description',status=_plan->>'status',price_monthly=(_plan->>'price_monthly')::numeric,price_quarterly=(_plan->>'price_quarterly')::numeric,price_yearly=(_plan->>'price_yearly')::numeric,currency=_plan->>'currency',trial_days=(_plan->>'trial_days')::integer,is_public=(_plan->>'is_public')::boolean,sort_order=(_plan->>'sort_order')::integer,updated_at=now() where id=pid;
  if not found then raise exception 'الخطة غير موجودة'; end if;
 end if;
 delete from billing_plan_features where plan_id=pid;
 insert into billing_plan_features select pid,x.feature_key,x.is_enabled from jsonb_to_recordset(_features) as x(feature_key text,is_enabled boolean);
 delete from billing_plan_limits where plan_id=pid;
 insert into billing_plan_limits select pid,x.limit_key,x.limit_value from jsonb_to_recordset(_limits) as x(limit_key text,limit_value integer);
 return pid;
end $$;
revoke all on function public.billing_save_plan(jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.billing_save_plan(jsonb,jsonb,jsonb) to service_role;
notify pgrst,'reload schema';
