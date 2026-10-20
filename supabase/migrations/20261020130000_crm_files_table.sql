-- Records the files attached to CRM records (opportunity, contact, lead…). The code and generated
-- types have always used this table, and the crm-files bucket exists, but the table was never
-- created in this project, so every upload from an opportunity failed when it was registered.
-- Columns match src/integrations/supabase/types.ts. Only the server (service role) reads and writes;
-- the app checks the user's access to the record before listing, adding or deleting its files.

create table if not exists public.crm_files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  storage_bucket text not null default 'crm-files',
  storage_path text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists crm_files_entity_idx
  on public.crm_files (organization_id, entity_type, entity_id, created_at desc);

alter table public.crm_files enable row level security;
revoke all on table public.crm_files from anon, authenticated;
grant all on table public.crm_files to service_role;
