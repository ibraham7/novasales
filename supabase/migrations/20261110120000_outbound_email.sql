-- Outbound email: campaigns and one row per recipient. Server-only tables (RLS on, no client access).
-- A recipient keeps a private token for the unsubscribe link; bounces and complaints put the address
-- on the existing do-not-send list (channel 'email').

create table if not exists public.ob_email_campaigns (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 name text not null check(length(trim(name)) between 1 and 200),
 subject text not null check(length(trim(subject)) between 1 and 200),
 body text not null check(length(body) between 1 and 5000),
 status text not null default 'scheduled' check(status in ('scheduled','running','paused','completed','cancelled','failed')),
 scheduled_at timestamptz not null default now(),
 started_at timestamptz,
 finished_at timestamptz,
 throttle_per_minute integer not null default 10 check(throttle_per_minute between 1 and 60),
 created_by uuid references auth.users(id) on delete set null,
 approved_by uuid references auth.users(id) on delete set null,
 approved_at timestamptz,
 compliance_snapshot jsonb,
 error text,
 created_at timestamptz not null default now()
);
create index if not exists ob_email_campaigns_org on public.ob_email_campaigns(organization_id,created_at desc);
create index if not exists ob_email_campaigns_due on public.ob_email_campaigns(status,scheduled_at);

create table if not exists public.ob_email_messages (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 campaign_id uuid not null references public.ob_email_campaigns(id) on delete cascade,
 ob_prospect_id uuid references public.ob_prospects(id) on delete set null,
 email text not null check(length(email) between 5 and 254),
 name text,
 status text not null default 'queued' check(status in ('queued','sending','sent','delivered','bounced','complained','failed','skipped')),
 stop_token text not null,
 provider_message_id text,
 error text,
 claimed_at timestamptz,
 sent_at timestamptz,
 delivered_at timestamptz,
 replied_at timestamptz,
 created_at timestamptz not null default now(),
 unique(campaign_id,email)
);
create unique index if not exists ob_email_messages_stop_token on public.ob_email_messages(stop_token);
create index if not exists ob_email_messages_campaign on public.ob_email_messages(organization_id,campaign_id,status);
create index if not exists ob_email_messages_provider on public.ob_email_messages(provider_message_id) where provider_message_id is not null;
create index if not exists ob_email_messages_sent on public.ob_email_messages(organization_id,sent_at) where sent_at is not null;

do $$ declare t text; begin
 foreach t in array array['ob_email_campaigns','ob_email_messages'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
