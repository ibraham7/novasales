-- Outbound campaigns on top of the existing campaign engine, the «do not send» list, an audit log
-- and per-organization outbound settings. Server-only tables.
--
-- ONE existing constraint is relaxed: cmp_recipients.contact_id may now be empty. An outbound
-- recipient is a discovered business that is not a CRM contact yet (it becomes one only when it
-- replies), so it carries ob_prospect_id instead. Existing rows and existing code are unaffected.

alter table public.cmp_recipients alter column contact_id drop not null;
alter table public.cmp_recipients
 add column if not exists ob_prospect_id uuid references public.ob_prospects(id) on delete set null,
 add column if not exists replied_at timestamptz;
create index if not exists cmp_recipients_prospect_phone on public.cmp_recipients(organization_id,phone) where ob_prospect_id is not null;

alter table public.cmp_campaigns
 add column if not exists kind text not null default 'retention' check(kind in ('retention','outbound')),
 add column if not exists approved_by uuid references auth.users(id) on delete set null,
 add column if not exists approved_at timestamptz,
 add column if not exists compliance_snapshot jsonb;

alter table public.ob_prospects
 add column if not exists promoted_contact_id uuid references public.crm_contacts(id) on delete set null;

-- Numbers that must never be messaged by any campaign of the organization.
create table if not exists public.ob_suppressions (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 channel text not null default 'whatsapp' check(channel in ('whatsapp','email','instagram')),
 identifier text not null check(length(identifier) between 3 and 200),
 reason text check(length(reason) <= 200),
 source text not null default 'manual' check(source in ('manual','keyword','import')),
 created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 unique(organization_id,channel,identifier)
);

-- What happened and who did it: searches, approvals, opt-outs, setting changes.
create table if not exists public.ob_events (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 actor_user_id uuid references auth.users(id) on delete set null,
 event_type text not null check(length(event_type) <= 60),
 entity_type text,
 entity_id text,
 detail jsonb not null default '{}',
 created_at timestamptz not null default now()
);
create index if not exists ob_events_org_idx on public.ob_events(organization_id,created_at desc);

create table if not exists public.ob_org_settings (
 organization_id uuid primary key references public.organizations(id) on delete cascade,
 -- Unofficial WhatsApp numbers (QR link) can be banned for cold messages: off until an owner accepts the risk.
 allow_unofficial boolean not null default false,
 unofficial_accepted_by uuid references auth.users(id) on delete set null,
 unofficial_accepted_at timestamptz,
 optout_footer text not null default 'لإيقاف الرسائل أرسل كلمة: إيقاف' check(length(optout_footer) between 5 and 200),
 updated_at timestamptz not null default now()
);

do $$ declare t text; begin
 foreach t in array array['ob_suppressions','ob_events','ob_org_settings'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
