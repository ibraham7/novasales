-- Automation, step 2: the send settings of each organization and the log of every automatic message.
-- Server-only tables. Nothing is sent by this file. Safe to run twice.
--
-- wf_settings.sending_enabled is the master switch and is OFF for every organization until someone turns it on:
-- until then every automatic message is logged as «skipped» (and never sent), so a test organization can
-- never message a real customer.
create table if not exists public.wf_settings (
 organization_id uuid primary key references public.organizations(id) on delete cascade,
 sending_enabled boolean not null default false,
 timezone text not null default 'Europe/Istanbul' check(length(timezone) between 3 and 64),
 send_window_start text not null default '09:00' check(send_window_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
 send_window_end text not null default '20:00' check(send_window_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
 daily_limit integer not null default 100 check(daily_limit between 1 and 2000),
 gap_min_seconds integer not null default 45 check(gap_min_seconds between 0 and 3600),
 gap_max_seconds integer not null default 180 check(gap_max_seconds between 0 and 3600),
 defer_ttl_minutes integer not null default 720 check(defer_ttl_minutes between 5 and 10080),
 updated_by uuid references auth.users(id) on delete set null,
 updated_at timestamptz not null default now()
);

create table if not exists public.wf_message_log (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 workflow_id uuid,
 run_id uuid,
 step_id text,
 opportunity_id uuid,
 contact_id uuid,
 channel text not null check(channel in ('whatsapp','email')),
 kind text not null check(kind in ('service','promo')),
 to_address text,
 account_id uuid,
 subject text check(length(subject) <= 300),
 body text check(length(body) <= 4000),
 dedupe_key text check(length(dedupe_key) <= 300),
 allow_first_contact boolean not null default false,
 status text not null check(status in ('sending','sent','skipped','deferred','failed')),
 reason_code text check(length(reason_code) <= 60),
 reason text check(length(reason) <= 500),
 attempts integer not null default 0,
 not_before timestamptz,
 expires_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 sent_at timestamptz
);
-- The same message for the same event can be sent or waiting only once. A skipped or failed one frees the key.
create unique index if not exists wf_message_once on public.wf_message_log(organization_id,dedupe_key)
 where dedupe_key is not null and status in ('sending','sent','deferred');
create index if not exists wf_message_log_recent on public.wf_message_log(organization_id,created_at desc);
create index if not exists wf_message_log_held on public.wf_message_log(status,not_before) where status in ('deferred','sending');
create index if not exists wf_message_log_sent on public.wf_message_log(organization_id,channel,account_id,sent_at desc) where status='sent';
create index if not exists wf_message_log_ticket on public.wf_message_log(organization_id,opportunity_id,created_at desc);

alter table public.wf_settings enable row level security;
alter table public.wf_message_log enable row level security;
revoke all on public.wf_settings,public.wf_message_log from anon,authenticated;
grant all on public.wf_settings,public.wf_message_log to service_role;
