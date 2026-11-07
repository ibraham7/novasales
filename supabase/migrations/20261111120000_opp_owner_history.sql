-- Who had each ticket, so redistributing the abandoned tickets can send a customer through every
-- sales agent before anyone gets them a second time. Per ticket (most tickets have no lead).
-- Server-only table.
create table if not exists public.opp_owner_history (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 opportunity_id uuid not null references public.opp_opportunities(id) on delete cascade,
 from_user_id uuid references auth.users(id) on delete set null,
 to_user_id uuid references auth.users(id) on delete set null,
 reason text check(length(reason) <= 200),
 assigned_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now()
);
create index if not exists opp_owner_history_ticket on public.opp_owner_history(organization_id,opportunity_id,created_at);
alter table public.opp_owner_history enable row level security;
revoke all on public.opp_owner_history from anon,authenticated;
grant all on public.opp_owner_history to service_role;
