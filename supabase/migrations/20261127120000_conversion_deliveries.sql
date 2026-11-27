-- تسليم أحداث التحويل لكل منصة إعلانية على حدة (جوجل GA4 الآن، ثم تيك توك وسناب).
-- ميتا تبقى على أعمدة التسليم بجدول crm_conversion_events كما هي. آمن لإعادة التشغيل.
create table if not exists public.crm_conversion_deliveries (
  event_id uuid not null references public.crm_conversion_events(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  platform text not null check (platform in ('google', 'tiktok', 'snapchat')),
  state text not null check (state in ('sent', 'failed', 'skipped')),
  attempts smallint not null default 1,
  error text,
  delivered_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (event_id, platform)
);
create index if not exists crm_conversion_deliveries_org_idx
  on public.crm_conversion_deliveries (organization_id, platform, state);
alter table public.crm_conversion_deliveries enable row level security;
revoke all on public.crm_conversion_deliveries from anon, authenticated;
grant all on public.crm_conversion_deliveries to service_role;
