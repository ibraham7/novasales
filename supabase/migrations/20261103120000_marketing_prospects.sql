-- Marketing / outbound discovery: searches run against an external source (Google Places) and the
-- businesses they found, kept apart from CRM contacts and leads until a person approves and a
-- conversation starts. Server-only tables.
--
-- Data from Google is a cache: place_id is kept, the other fields carry fetched_at / expires_at
-- (30 days) so they can be refreshed or removed. Nothing here is sent anywhere.

create table if not exists public.ob_searches (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 created_by uuid references auth.users(id) on delete set null,
 provider text not null default 'google_places',
 params jsonb not null default '{}',
 status text not null default 'running' check(status in ('running','done','failed')),
 requests_count integer not null default 0,
 estimated_cost_usd numeric(10,4) not null default 0,
 results_count integer not null default 0,
 new_count integer not null default 0,
 error text check(length(error) <= 500),
 created_at timestamptz not null default now(),
 finished_at timestamptz
);
create index if not exists ob_searches_org_idx on public.ob_searches(organization_id,created_at desc);

create table if not exists public.ob_prospects (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 provider text not null default 'google_places',
 external_id text not null check(length(external_id) between 1 and 300),
 search_id uuid references public.ob_searches(id) on delete set null,
 name text not null check(length(name) between 1 and 200),
 category text,
 address text,
 city text,
 country text,
 lat double precision,
 lng double precision,
 phone_raw text,
 phone_e164 text,
 phone_kind text not null default 'unknown' check(phone_kind in ('mobile','landline','unknown')),
 website text,
 maps_url text,
 rating numeric(2,1),
 ratings_count integer,
 business_status text,
 status text not null default 'new' check(status in ('new','review','qualified','excluded','approved','contacted','replied','interested','not_interested','converted','opted_out','invalid')),
 notes text check(length(notes) <= 2000),
 fetched_at timestamptz not null default now(),
 expires_at timestamptz not null default (now() + interval '30 days'),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(organization_id,provider,external_id)
);
create index if not exists ob_prospects_status_idx on public.ob_prospects(organization_id,status,created_at desc);
create index if not exists ob_prospects_phone_idx on public.ob_prospects(organization_id,phone_e164) where phone_e164 is not null;
create index if not exists ob_prospects_search_idx on public.ob_prospects(search_id) where search_id is not null;

do $$ declare t text; begin
 foreach t in array array['ob_searches','ob_prospects'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
