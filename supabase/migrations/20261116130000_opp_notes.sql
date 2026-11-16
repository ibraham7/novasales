-- Ticket notes. The table is read and written by the ticket page and the add-ticket dialog but was
-- missing from the new database. Safe to run twice. Server-only table.
create table if not exists public.opp_notes (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 opportunity_id uuid not null references public.opp_opportunities(id) on delete cascade,
 author_id uuid references auth.users(id) on delete set null,
 body text not null check(length(body) between 1 and 5000),
 created_at timestamptz not null default now()
);
create index if not exists opp_notes_ticket on public.opp_notes(organization_id,opportunity_id,created_at desc);
alter table public.opp_notes enable row level security;
revoke all on public.opp_notes from anon,authenticated;
grant all on public.opp_notes to service_role;
