-- التقويم (المرحلة 1/ب): قواعد قاعدة البيانات: الدوام والاستراحة والإجازة ومنع التضارب وحارس الحالات والسجل.
-- يحتاج 20261123120000_calendar_core.sql أولاً. آمن لإعادة التشغيل. لا يرسل شيئاً ولا يغيّر بيانات موجودة.
-- رسائل الأخطاء رموز عامة (CAL_*) بلا أي تفاصيل عن مؤسسة أو موعد آخر.

-- منطقة التوقيت المعتمدة للمندوب: تخصيصه، ثم منطقة المؤسسة، ثم إسطنبول.
create or replace function public.cal_effective_tz(_org uuid, _user uuid) returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.timezone from public.cal_agent_prefs p where p.organization_id = _org and p.user_id = _user),
    (select s.timezone from public.cal_settings s where s.organization_id = _org),
    'Europe/Istanbul')
$$;
revoke execute on function public.cal_effective_tz(uuid, uuid) from public, anon, authenticated;

-- اسم المنطقة الزمنية يجب أن يكون معروفاً.
create or replace function public.cal_check_timezone() returns trigger language plpgsql set search_path = public as $$
begin
  if NEW.timezone is not null and not exists (select 1 from pg_timezone_names where name = NEW.timezone) then
    raise exception 'CAL_BAD_TIMEZONE';
  end if;
  return NEW;
end $$;
drop trigger if exists cal_settings_tz on public.cal_settings;
create trigger cal_settings_tz before insert or update on public.cal_settings for each row execute function public.cal_check_timezone();
drop trigger if exists cal_agent_prefs_tz on public.cal_agent_prefs;
create trigger cal_agent_prefs_tz before insert or update on public.cal_agent_prefs for each row execute function public.cal_check_timezone();

-- تفعيل التقويم لمؤسسة: يُنشئ البذور (أنواع الاجتماعات) مرة واحدة فقط عند أول تفعيل. للخادم فقط.
create or replace function public.cal_enable(_org uuid, _actor uuid) returns void language plpgsql security definer set search_path = public as $$
declare _seeded timestamptz;
begin
  insert into public.cal_settings (organization_id, cal_enabled, updated_by) values (_org, true, _actor)
  on conflict (organization_id) do update set cal_enabled = true, updated_by = _actor, updated_at = now();
  select seeded_at into _seeded from public.cal_settings where organization_id = _org;
  if _seeded is null then
    if not exists (select 1 from public.cal_meeting_types where organization_id = _org) then
      insert into public.cal_meeting_types (organization_id, name, duration_minutes, color, sort_order) values
        (_org, 'مكالمة تعريفية', 15, '#3b82f6', 1), (_org, 'عرض توضيحي', 30, '#8b5cf6', 2),
        (_org, 'اجتماع متابعة', 45, '#10b981', 3), (_org, 'زيارة ميدانية', 60, '#f59e0b', 4);
    end if;
    update public.cal_settings set seeded_at = now() where organization_id = _org;
  end if;
end $$;
revoke execute on function public.cal_enable(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cal_enable(uuid, uuid) to service_role;

-- القواعد قبل الكتابة.
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

-- السجل: مرة واحدة لكل حدث (لا تكرار عند التعديل المتكرر)، بدون ملاحظات ولا أرقام هاتف.
create unique index if not exists crm_timeline_cal_meeting_once on public.crm_timeline (ref_id, event_kind, (metadata->>'sig')) where ref_type = 'meeting';
create unique index if not exists crm_activities_cal_meeting_once on public.crm_activities ((metadata->>'cal_meeting_id')) where metadata ? 'cal_meeting_id';

create or replace function public.cal_meetings_after_write() returns trigger language plpgsql security definer set search_path = public as $$
declare _etype text; _eid uuid; _tname text; _kind text; _title text; _sig text; _labels jsonb := '{"booked":"محجوز","confirmed":"مؤكد","in_progress":"جارٍ","completed":"مكتمل","cancelled":"ملغى","no_show":"لم يحضر"}';
begin
  select case when NEW.opportunity_id is not null then 'opportunity' when NEW.lead_id is not null then 'lead' when NEW.contact_id is not null then 'contact' end,
         coalesce(NEW.opportunity_id, NEW.lead_id, NEW.contact_id) into _etype, _eid;
  if _etype is null then return null; end if;
  select name into _tname from public.cal_meeting_types where id = NEW.meeting_type_id;
  if TG_OP = 'INSERT' then
    _kind := 'meeting.created'; _title := 'تم حجز اجتماع'; _sig := 'created';
  elsif NEW.status is distinct from OLD.status then
    _kind := 'meeting.status'; _title := 'حالة الاجتماع: ' || coalesce(_labels->>NEW.status, NEW.status); _sig := NEW.status;
  elsif NEW.starts_at is distinct from OLD.starts_at or NEW.ends_at is distinct from OLD.ends_at then
    _kind := 'meeting.rescheduled'; _title := 'تمت إعادة جدولة الاجتماع'; _sig := to_char(NEW.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI');
  end if;
  if _kind is not null then
    insert into public.crm_timeline (organization_id, entity_type, entity_id, event_kind, title, description, actor_user_id, occurred_at, ref_type, ref_id, metadata)
    values (NEW.organization_id, _etype, _eid, _kind, _title, _tname, coalesce(NEW.updated_by, NEW.created_by), now(), 'meeting', NEW.id, jsonb_build_object('sig', _sig, 'status', NEW.status))
    on conflict (ref_id, event_kind, (metadata->>'sig')) where ref_type = 'meeting' do nothing;
  end if;
  if NEW.status = 'completed' and (TG_OP = 'INSERT' or OLD.status <> 'completed') then
    insert into public.crm_activities (organization_id, entity_type, entity_id, activity_type, actor_user_id, subject, occurred_at, duration_seconds, metadata)
    values (NEW.organization_id, _etype, _eid, 'meeting', NEW.owner_user_id, _tname, NEW.starts_at, extract(epoch from (NEW.ends_at - NEW.starts_at))::int, jsonb_build_object('cal_meeting_id', NEW.id::text))
    on conflict ((metadata->>'cal_meeting_id')) where metadata ? 'cal_meeting_id' do nothing;
  end if;
  return null;
end $$;
drop trigger if exists cal_meetings_after_write on public.cal_meetings;
create trigger cal_meetings_after_write after insert or update on public.cal_meetings for each row execute function public.cal_meetings_after_write();
