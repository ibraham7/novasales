-- «فلاتر جاهزة»: the ready-made templates come with the app; an organization can remove the ones it does
-- not want. One row hides one template (by its id in the app) for that organization only. Reached only by
-- the server (service role). Adds one table; nothing existing changes. Safe to run again.
--
-- Rollback: drop table if exists public.ob_hidden_presets;

create table if not exists public.ob_hidden_presets (
 organization_id uuid not null references public.organizations(id) on delete cascade,
 preset_id text not null check(length(preset_id) between 1 and 60),
 hidden_by uuid references auth.users(id) on delete set null,
 hidden_at timestamptz not null default now(),
 primary key(organization_id, preset_id)
);
alter table public.ob_hidden_presets enable row level security;
revoke all on public.ob_hidden_presets from anon, authenticated;
grant all on public.ob_hidden_presets to service_role;
