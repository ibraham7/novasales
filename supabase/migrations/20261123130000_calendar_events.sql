-- التقويم (المرحلة 6): أحداث الاجتماعات للأتمتة. كل إنشاء/إعادة جدولة/تأكيد/إنهاء/إلغاء/عدم حضور يسجّله قاعدة البيانات نفسها
-- في domain_events (مهما كان مصدر التغيير). الأحداث تنتظر هناك ولا يلتقطها إلا عامل الأتمتة (مطفأ افتراضياً)،
-- والأحداث القديمة تُهمل (حارس 6 ساعات). لا ملاحظات ولا أرقام هواتف في الحمولة. لا يرسل هذا الملف شيئاً.
-- يحتاج 20261123120000_calendar_core.sql. آمن لإعادة التشغيل.
create or replace function public.cal_meeting_events() returns trigger
language plpgsql security definer set search_path = public as $$
declare _kind text; _type text; _payload jsonb;
begin
  if TG_OP = 'INSERT' then _kind := 'calendar.meeting.created';
  elsif NEW.status is distinct from OLD.status then
    _kind := case NEW.status when 'confirmed' then 'calendar.meeting.confirmed' when 'completed' then 'calendar.meeting.completed'
      when 'cancelled' then 'calendar.meeting.cancelled' when 'no_show' then 'calendar.meeting.no_show' else null end;
  elsif NEW.status in ('booked','confirmed','in_progress') and (NEW.starts_at is distinct from OLD.starts_at or NEW.ends_at is distinct from OLD.ends_at or NEW.owner_user_id is distinct from OLD.owner_user_id) then
    _kind := 'calendar.meeting.rescheduled';
  end if;
  if _kind is null then return null; end if;
  select name into _type from public.cal_meeting_types where id = NEW.meeting_type_id;
  _payload := jsonb_build_object('meeting_id', NEW.id, 'owner_user_id', NEW.owner_user_id, 'contact_id', NEW.contact_id, 'lead_id', NEW.lead_id,
    'opportunity_id', NEW.opportunity_id, 'starts_at', NEW.starts_at, 'ends_at', NEW.ends_at, 'meeting_type', _type, 'channel', NEW.channel,
    'status', NEW.status, 'outcome', NEW.outcome, 'location', case when NEW.channel in ('link','in_person') then NEW.location else null end);
  insert into public.domain_events (organization_id, event_type, aggregate_type, aggregate_id, payload)
  values (NEW.organization_id, _kind, 'cal_meeting', NEW.id, _payload);
  return null;
end $$;
revoke all on function public.cal_meeting_events() from public, anon, authenticated;
grant execute on function public.cal_meeting_events() to service_role;

drop trigger if exists cal_meetings_events on public.cal_meetings;
create trigger cal_meetings_events after insert or update on public.cal_meetings for each row execute function public.cal_meeting_events();
