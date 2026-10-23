-- Social/ad platform connections per organization: a pixel (or tag) id per platform and, for Meta,
-- an encrypted Conversions API token. Each row belongs to one organization only; the server sends
-- that organization's CRM conversion events to its own pixel and nobody else's.
create table if not exists public.org_marketing_pixels (
 organization_id uuid not null references public.organizations(id) on delete cascade,
 platform text not null check(platform in ('facebook','instagram','tiktok','snapchat','x','linkedin','google')),
 pixel_id text not null check(length(pixel_id) between 2 and 120),
 access_token text,
 test_event_code text,
 connected_via text not null default 'manual' check(connected_via in ('manual','oauth')),
 connected_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 primary key(organization_id,platform)
);
alter table public.org_marketing_pixels enable row level security;
revoke all on public.org_marketing_pixels from anon,authenticated;
grant all on public.org_marketing_pixels to service_role;

-- Delivery of conversion events to the organization's own ad platform.
alter table public.crm_conversion_events drop constraint if exists crm_conversion_events_delivery_state_check;
alter table public.crm_conversion_events
 add constraint crm_conversion_events_delivery_state_check
 check(delivery_state in ('awaiting_connection','internal_only','sent','failed','skipped'));
alter table public.crm_conversion_events
 add column if not exists delivered_at timestamptz,
 add column if not exists delivery_error text,
 add column if not exists delivery_attempts smallint not null default 0;
create index if not exists crm_conversion_events_pending_idx
 on public.crm_conversion_events(organization_id,occurred_at) where delivery_state='awaiting_connection';
