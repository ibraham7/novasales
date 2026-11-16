-- Trello-style labels for sales tickets: the organization defines coloured labels once, then puts any
-- number of them on a ticket. Server-only tables.
create table if not exists public.opp_labels (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 name text not null check(length(name) between 1 and 40),
 color text not null check(color ~ '^#[0-9a-fA-F]{6}$'),
 created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now()
);
create unique index if not exists opp_labels_name on public.opp_labels(organization_id,lower(name));
create table if not exists public.opp_label_links (
 opportunity_id uuid not null references public.opp_opportunities(id) on delete cascade,
 label_id uuid not null references public.opp_labels(id) on delete cascade,
 organization_id uuid not null references public.organizations(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(opportunity_id,label_id)
);
create index if not exists opp_label_links_label on public.opp_label_links(label_id);
alter table public.opp_labels enable row level security;
alter table public.opp_label_links enable row level security;
revoke all on public.opp_labels,public.opp_label_links from anon,authenticated;
grant all on public.opp_labels,public.opp_label_links to service_role;
