-- التقويم: مشاركون من الفريق في الموعد (موعد مع المدير مثلاً).
-- يظهر الموعد في تقويم المشارك ويمنع حجز موعد آخر له بنفس الوقت. آمن لإعادة التشغيل. يُشغَّل بعد ملفات التقويم الثلاثة.

create table if not exists public.cal_meeting_attendees (
  meeting_id uuid not null references public.cal_meetings(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (meeting_id, user_id)
);
create index if not exists cal_meeting_attendees_user on public.cal_meeting_attendees (organization_id, user_id);
alter table public.cal_meeting_attendees enable row level security;

-- هل الشخص مشغول في هذه الفترة، كمالك لموعد أو كمشارك فيه؟ (يستثني موعداً بعينه)
create or replace function public.cal_person_busy(_user uuid, _from timestamptz, _to timestamptz, _except uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.cal_meetings m
    where m.id is distinct from _except
      and m.status in ('booked','confirmed','in_progress','completed')
      and tstzrange(m.starts_at, m.ends_at) && tstzrange(_from, _to)
      and (m.owner_user_id = _user or exists (select 1 from public.cal_meeting_attendees a where a.meeting_id = m.id and a.user_id = _user))
  );
$$;
revoke execute on function public.cal_person_busy(uuid, timestamptz, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.cal_person_busy(uuid, timestamptz, timestamptz, uuid) to service_role;

-- قبل إضافة مشارك: عضو فعّال في نفس المؤسسة، ليس صاحب الموعد، ومتاح بوقت الموعد.
create or replace function public.cal_attendees_before_write() returns trigger language plpgsql security definer set search_path = public as $$
declare _m public.cal_meetings%rowtype;
begin
  select * into _m from public.cal_meetings where id = NEW.meeting_id;
  if not found then raise exception 'CAL_CROSS_ORG'; end if;
  NEW.organization_id := _m.organization_id;
  if NEW.user_id = _m.owner_user_id then raise exception 'CAL_BAD_ATTENDEE'; end if;
  if not exists (select 1 from public.org_memberships where organization_id = _m.organization_id and user_id = NEW.user_id and is_active) then
    raise exception 'CAL_BAD_ATTENDEE';
  end if;
  if _m.status in ('booked','confirmed','in_progress') and public.cal_person_busy(NEW.user_id, _m.starts_at, _m.ends_at, _m.id) then
    raise exception 'CAL_ATTENDEE_BUSY';
  end if;
  return NEW;
end $$;
drop trigger if exists cal_attendees_before_write on public.cal_meeting_attendees;
create trigger cal_attendees_before_write before insert on public.cal_meeting_attendees for each row execute function public.cal_attendees_before_write();

-- القواعد قبل كتابة الموعد: كما كانت، مع فحص المشاركين.
create or replace function public.cal_meetings_before_write() returns trigger language plpgsql security definer set search_path = public as $$
declare
  _enabled boolean; _tz text; _ls timestamp; _le timestamp; _dow int; _si interval; _ei interval; _from interval; _to interval;
  _has boolean; _time_changed boolean; _final boolean;
begin
  if TG_OP = 'INSERT' then
    select cal_enabled into _enabled from public.cal_settings where organization_id = NEW.organization_id;
    if _enabled is not true then raise exception 'CAL_DISABLED'; end if;
    if NEW.status not in ('booked','confirmed') then raise exception 'CAL_BAD_STATUS'; end if;
    _time_changed := true;
  else
    NEW.organization_id := OLD.organization_id; NEW.created_by := OLD.created_by; NEW.created_at := OLD.created_at;
    NEW.updated_at := now();
    _final := OLD.status in ('completed','cancelled','no_show');
    _time_changed := NEW.starts_at <> OLD.starts_at or NEW.ends_at <> OLD.ends_at or NEW.owner_user_id <> OLD.owner_user_id;
    if NEW.status is distinct from OLD.status and not (
      (OLD.status = 'booked' and NEW.status in ('confirmed','in_progress','completed','cancelled','no_show')) or
      (OLD.status = 'confirmed' and NEW.status in ('booked','in_progress','completed','cancelled','no_show')) or
      (OLD.status = 'in_progress' and NEW.status in ('completed','cancelled'))) then
      raise exception 'CAL_BAD_TRANSITION';
    end if;
    if _final and (_time_changed or NEW.meeting_type_id is distinct from OLD.meeting_type_id) then raise exception 'CAL_FINAL_STATUS'; end if;
  end if;
  if NEW.status = 'completed' and (TG_OP = 'INSERT' or OLD.status <> 'completed') then NEW.completed_at := now(); end if;

  -- كل الروابط تتبع نفس المؤسسة.
  if NEW.contact_id is not null and (TG_OP = 'INSERT' or NEW.contact_id is distinct from OLD.contact_id)
     and not exists (select 1 from public.crm_contacts where id = NEW.contact_id and organization_id = NEW.organization_id) then raise exception 'CAL_CROSS_ORG'; end if;
  if NEW.lead_id is not null and (TG_OP = 'INSERT' or NEW.lead_id is distinct from OLD.lead_id)
     and not exists (select 1 from public.crm_leads where id = NEW.lead_id and organization_id = NEW.organization_id) then raise exception 'CAL_CROSS_ORG'; end if;
  if NEW.opportunity_id is not null and (TG_OP = 'INSERT' or NEW.opportunity_id is distinct from OLD.opportunity_id)
     and not exists (select 1 from public.opp_opportunities where id = NEW.opportunity_id and organization_id = NEW.organization_id) then raise exception 'CAL_CROSS_ORG'; end if;
  if NEW.meeting_type_id is not null and (TG_OP = 'INSERT' or NEW.meeting_type_id is distinct from OLD.meeting_type_id)
     and not exists (select 1 from public.cal_meeting_types where id = NEW.meeting_type_id and organization_id = NEW.organization_id) then raise exception 'CAL_CROSS_ORG'; end if;

  if NEW.status in ('cancelled','no_show','completed') then return NEW; end if;
  if TG_OP = 'UPDATE' and not _time_changed and OLD.status in ('booked','confirmed','in_progress') then return NEW; end if;

  -- المندوب عضو فعّال في المؤسسة.
  if not exists (select 1 from public.org_memberships where organization_id = NEW.organization_id and user_id = NEW.owner_user_id and is_active) then
    raise exception 'CAL_BAD_OWNER';
  end if;
  -- لا موعدين متداخلين للشخص نفسه عبر كل المؤسسات (الرسالة عامة). القيد cal_meetings_owner_no_overlap شبكة أمان للسباقات.
  if exists (select 1 from public.cal_meetings m where m.owner_user_id = NEW.owner_user_id and m.id is distinct from NEW.id
             and m.status in ('booked','confirmed','in_progress','completed') and tstzrange(m.starts_at, m.ends_at) && tstzrange(NEW.starts_at, NEW.ends_at)) then
    raise exception 'CAL_OWNER_BUSY';
  end if;
  -- المندوب مشارك في موعد آخر بنفس الوقت (موعد مع المدير مثلاً).
  if exists (select 1 from public.cal_meeting_attendees a join public.cal_meetings m on m.id = a.meeting_id
             where a.user_id = NEW.owner_user_id and m.id is distinct from NEW.id
               and m.status in ('booked','confirmed','in_progress','completed') and tstzrange(m.starts_at, m.ends_at) && tstzrange(NEW.starts_at, NEW.ends_at)) then
    raise exception 'CAL_OWNER_BUSY';
  end if;
  -- عند تغيير الوقت: كل مشارك في هذا الموعد يجب أن يكون متاحاً.
  if TG_OP = 'UPDATE' and exists (select 1 from public.cal_meeting_attendees a where a.meeting_id = NEW.id
                                  and public.cal_person_busy(a.user_id, NEW.starts_at, NEW.ends_at, NEW.id)) then
    raise exception 'CAL_ATTENDEE_BUSY';
  end if;

  -- الدوام والاستراحة والإجازة بتوقيت المندوب/المؤسسة.
  _tz := public.cal_effective_tz(NEW.organization_id, NEW.owner_user_id);
  _ls := NEW.starts_at at time zone _tz; _le := NEW.ends_at at time zone _tz;
  if _le::date > _ls::date and not (_le::date = _ls::date + 1 and _le::time = '00:00') then raise exception 'CAL_OUTSIDE_HOURS'; end if;
  _dow := extract(dow from _ls)::int;
  _si := _ls::time - time '00:00';
  _ei := case when _le::date > _ls::date then interval '24 hours' else _le::time - time '00:00' end;
  if exists (select 1 from public.cal_time_off t where t.organization_id = NEW.organization_id and t.user_id = NEW.owner_user_id and _ls::date between t.starts_on and t.ends_on) then
    raise exception 'CAL_TIME_OFF';
  end if;
  select exists (select 1 from public.cal_availability a where a.organization_id = NEW.organization_id and a.user_id = NEW.owner_user_id) into _has;
  if _has then
    select a.start_time - time '00:00', case when a.end_time = '00:00' then interval '24 hours' else a.end_time - time '00:00' end into _from, _to
      from public.cal_availability a where a.organization_id = NEW.organization_id and a.user_id = NEW.owner_user_id and a.weekday = _dow;
    if _from is null then raise exception 'CAL_OFF_DAY'; end if;
  else
    select s.work_start - time '00:00', case when s.work_end = '00:00' then interval '24 hours' else s.work_end - time '00:00' end into _from, _to
      from public.cal_settings s where s.organization_id = NEW.organization_id and _dow = any (s.working_days);
    if _from is null then raise exception 'CAL_CLOSED_DAY'; end if;
  end if;
  if _si < _from or _ei > _to then raise exception 'CAL_OUTSIDE_HOURS'; end if;
  if exists (select 1 from public.cal_breaks b where b.organization_id = NEW.organization_id and b.user_id = NEW.owner_user_id and b.weekday = _dow
             and (b.start_time - time '00:00') < _ei and (b.end_time - time '00:00') > _si) then
    raise exception 'CAL_ON_BREAK';
  end if;
  return NEW;
end $$;

drop trigger if exists cal_meetings_before_write on public.cal_meetings;
create trigger cal_meetings_before_write before insert or update on public.cal_meetings for each row execute function public.cal_meetings_before_write();
