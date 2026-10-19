-- Each organization's own ready value lists (its colours, sizes…) offered when adding a property.
create table if not exists public.sales_ready_value_lists (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  label text not null check (length(trim(label)) between 1 and 60),
  stock boolean not null default true,
  "values" jsonb not null default '[]' check (jsonb_typeof("values") = 'array'),
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists sales_ready_value_lists_org_idx on public.sales_ready_value_lists(organization_id, position);
alter table public.sales_ready_value_lists enable row level security;
revoke all on public.sales_ready_value_lists from public, anon, authenticated;
grant all on public.sales_ready_value_lists to service_role;
