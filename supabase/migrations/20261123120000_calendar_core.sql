-- التقويم والمواعيد (المرحلة 1/أ): الجداول والقيود والصلاحيات. لا تغيّر ولا تحذف أي بيانات موجودة.
-- الميزة مطفأة لكل المؤسسات حتى يُفعَّل التقويم (cal_settings.cal_enabled)، ولا تُنشأ بذور لأي مؤسسة قبل ذلك.
-- آمن لإعادة التشغيل. يحتاج إضافة btree_gist (إن لم تكن متاحة يفشل الملف كله بدون أن يغيّر شيئاً).
create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;

-- إعدادات التقويم لكل مؤسسة: مطفأ افتراضياً، المنطقة الزمنية ودوام المؤسسة الافتراضي.
create table if not exists public.cal_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  cal_enabled boolean not null default false,
  timezone text not null default 'Europe/Istanbul' check (length(timezone) between 3 and 64),
  working_days smallint[] not null default '{1,2,3,4,5}',
  work_start time not null default '09:00',
  work_end time not null default '18:00',
  seeded_at timestamptz,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  check (work_end > work_start or work_end = '00:00')
);

-- منطقة زمنية خاصة بمندوب (اختيارية). بدونها تُستعمل منطقة المؤسسة.
create table if not exists public.cal_agent_prefs (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  timezone text check (timezone is null or length(timezone) between 3 and 64),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table if not exists public.cal_meeting_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  duration_minutes integer not null default 30 check (duration_minutes between 5 and 600),
  color text not null default '#3b82f6' check (color ~ '^#[0-9a-fA-F]{6}$'),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists cal_meeting_types_org on public.cal_meeting_types (organization_id, sort_order);

-- دوام المندوب: صف لكل يوم عمل. إن كان للمندوب أي صف يُستعمل جدوله، وإلا دوام المؤسسة.
create table if not exists public.cal_availability (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  unique (organization_id, user_id, weekday),
  check (end_time > start_time or end_time = '00:00')
);
create table if not exists public.cal_breaks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  check (end_time > start_time)
);
create index if not exists cal_breaks_user on public.cal_breaks (organization_id, user_id, weekday);
create table if not exists public.cal_time_off (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  reason text,
  check (ends_on >= starts_on)
);
create index if not exists cal_time_off_user on public.cal_time_off (organization_id, user_id, starts_on);

-- الاجتماع. الأوقات UTC (timestamptz). الحالة: booked, confirmed, in_progress, completed, cancelled, no_show.
-- النتيجة (outcome) منفصلة وتُسجَّل فقط بعد completed.
create table if not exists public.cal_meetings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  contact_id uuid references public.crm_contacts(id) on delete set null,
  lead_id uuid references public.crm_leads(id) on delete set null,
  opportunity_id uuid references public.opp_opportunities(id) on delete set null,
  meeting_type_id uuid references public.cal_meeting_types(id) on delete restrict,
  title text check (title is null or length(title) <= 200),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  channel text not null default 'call' check (channel in ('call','whatsapp','link','in_person')),
  location text check (location is null or length(location) <= 500),
  status text not null default 'booked' check (status in ('booked','confirmed','in_progress','completed','cancelled','no_show')),
  outcome text check (outcome in ('advanced','needs_followup','lost')),
  outcome_note text check (outcome_note is null or length(outcome_note) <= 2000),
  internal_notes text check (internal_notes is null or length(internal_notes) <= 4000),
  cancellation_reason text check (cancellation_reason is null or length(cancellation_reason) <= 500),
  completed_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cal_meetings_time_order check (ends_at > starts_at and ends_at - starts_at <= interval '24 hours'),
  constraint cal_meetings_outcome_after_completed check (outcome is null or status = 'completed')
);
-- المندوب (الشخص) لا يكون في مكانين: القيد على الشخص عبر كل المؤسسات، لا على المؤسسة.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cal_meetings_owner_no_overlap') then
    alter table public.cal_meetings add constraint cal_meetings_owner_no_overlap
      exclude using gist (owner_user_id with =, tstzrange(starts_at, ends_at) with &&)
      where (status in ('booked','confirmed','in_progress','completed'));
  end if;
end $$;
create index if not exists cal_meetings_range on public.cal_meetings (organization_id, owner_user_id, starts_at);
create index if not exists cal_meetings_org_time on public.cal_meetings (organization_id, starts_at);
create index if not exists cal_meetings_opp on public.cal_meetings (organization_id, opportunity_id) where opportunity_id is not null;
create index if not exists cal_meetings_contact on public.cal_meetings (organization_id, contact_id) where contact_id is not null;
create index if not exists cal_meetings_lead on public.cal_meetings (organization_id, lead_id) where lead_id is not null;

-- مغلقة عن المتصفح كبقية جداول CRM: الخادم فقط، والصلاحية وعزل المؤسسات في دوال الخادم.
alter table public.cal_settings enable row level security;
alter table public.cal_agent_prefs enable row level security;
alter table public.cal_meeting_types enable row level security;
alter table public.cal_availability enable row level security;
alter table public.cal_breaks enable row level security;
alter table public.cal_time_off enable row level security;
alter table public.cal_meetings enable row level security;
revoke all on public.cal_settings, public.cal_agent_prefs, public.cal_meeting_types, public.cal_availability, public.cal_breaks, public.cal_time_off, public.cal_meetings from public, anon, authenticated;
grant all on public.cal_settings, public.cal_agent_prefs, public.cal_meeting_types, public.cal_availability, public.cal_breaks, public.cal_time_off, public.cal_meetings to service_role;

-- صلاحيات جديدة (لا تظهر لأحد فعلياً قبل تفعيل الميزة).
insert into public.rbac_permissions(key, description) values
 ('calendar.view','عرض مواعيدي'),('calendar.view_all','عرض مواعيد الفريق'),('calendar.book','حجز وتعديل المواعيد'),('calendar.manage','إدارة إعدادات التقويم')
on conflict (key) do nothing;
insert into public.rbac_role_permissions(role_id, permission_key)
select r.id, p.key from public.rbac_roles r
join (values ('owner','calendar.view'),('owner','calendar.view_all'),('owner','calendar.book'),('owner','calendar.manage'),
            ('supervisor','calendar.view'),('supervisor','calendar.view_all'),('supervisor','calendar.book'),('supervisor','calendar.manage'),
            ('department_supervisor','calendar.view'),('department_supervisor','calendar.view_all'),('department_supervisor','calendar.book'),
            ('sales','calendar.view'),('sales','calendar.book')) as p(role_key, key) on p.role_key = r.key
on conflict do nothing;
