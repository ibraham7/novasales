-- Lead filters: what the site reader learns about a business (technologies, language), and saved searches.
alter table public.ob_prospects
 add column if not exists tech text[] not null default '{}',
 add column if not exists site_lang text;
create index if not exists ob_prospects_tech_idx on public.ob_prospects using gin(tech);
create index if not exists ob_prospects_country_idx on public.ob_prospects(organization_id,country);

create table if not exists public.ob_saved_searches (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 name text not null check(length(trim(name)) between 1 and 100),
 kind text not null default 'companies' check(kind in ('companies','people')),
 filters jsonb not null default '{}',
 created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 unique(organization_id,kind,name)
);
alter table public.ob_saved_searches enable row level security;
revoke all on public.ob_saved_searches from anon,authenticated;
grant all on public.ob_saved_searches to service_role;
