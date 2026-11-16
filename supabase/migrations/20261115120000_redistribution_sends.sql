-- Messages the sales agents send to their new customers right after «إعادة توزيع العملاء».
-- One row per ticket; a minute-by-minute worker sends them slowly, only inside the working hours
-- chosen when the button was pressed (so nobody gets a reply while the agents sleep).
-- Server-only table.
create table if not exists public.crm_redistribution_sends (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 opportunity_id uuid not null references public.opp_opportunities(id) on delete cascade,
 contact_id uuid references public.crm_contacts(id) on delete cascade,
 to_user_id uuid not null references auth.users(id) on delete cascade,
 body text not null check(length(body) between 1 and 1500),
 schedule jsonb not null,
 status text not null default 'pending' check(status in ('pending','sending','sent','failed','skipped')),
 reason text check(length(reason) <= 200),
 run_after timestamptz not null default now(),
 created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 sent_at timestamptz
);
create index if not exists crm_redistribution_sends_due on public.crm_redistribution_sends(status,run_after);
create index if not exists crm_redistribution_sends_agent on public.crm_redistribution_sends(organization_id,to_user_id,status,sent_at);
alter table public.crm_redistribution_sends enable row level security;
revoke all on public.crm_redistribution_sends from anon,authenticated;
grant all on public.crm_redistribution_sends to service_role;
