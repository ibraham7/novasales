-- Health tables are accessed only by authorized server functions.
create table public.wa_number_health_events (
 channel_account_id uuid not null references public.msg_channel_accounts(id) on delete cascade,
 created_at timestamptz not null default now(),
 detail jsonb not null default '{}'::jsonb,
 event_type text not null,
 id uuid primary key not null default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade
);
alter table public.wa_number_health_events enable row level security;
revoke all on public.wa_number_health_events from public,anon,authenticated;
grant all on public.wa_number_health_events to service_role;
create table public.wa_number_restrictions (
 channel_account_id uuid not null references public.msg_channel_accounts(id) on delete cascade,
 created_at timestamptz not null default now(),
 created_by uuid,
 detected_at timestamptz not null default now(),
 detection_source text not null default 'manual',
 duration_minutes integer,
 ended_at timestamptz,
 id uuid primary key not null default gen_random_uuid(),
 notes text,
 organization_id uuid not null references public.organizations(id) on delete cascade,
 reason text,
 snapshot jsonb not null default '{}'::jsonb,
 updated_at timestamptz not null default now()
);
alter table public.wa_number_restrictions enable row level security;
revoke all on public.wa_number_restrictions from public,anon,authenticated;
grant all on public.wa_number_restrictions to service_role;
create table public.wa_risk_rules (
 created_at timestamptz not null default now(),
 is_enabled boolean not null default true,
 key text primary key not null,
 label text not null,
 sort_order integer not null default 0,
 threshold integer,
 updated_at timestamptz not null default now(),
 weight integer not null default 0
);
alter table public.wa_risk_rules enable row level security;
revoke all on public.wa_risk_rules from public,anon,authenticated;
grant all on public.wa_risk_rules to service_role;
create table public.wa_send_decisions (
 allowed boolean not null,
 channel_account_id uuid references public.msg_channel_accounts(id) on delete cascade,
 created_at timestamptz not null default now(),
 failed_rules text[] not null default '{}'::text[],
 id uuid primary key not null default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 passed_rules text[] not null default '{}'::text[],
 peer text,
 source text not null
);
alter table public.wa_send_decisions enable row level security;
revoke all on public.wa_send_decisions from public,anon,authenticated;
grant all on public.wa_send_decisions to service_role;
create table public.wa_send_quotas (
 bucket text not null,
 bucket_key text not null,
 channel_account_id uuid not null references public.msg_channel_accounts(id) on delete cascade,
 created_at timestamptz not null default now(),
 id uuid primary key not null default gen_random_uuid(),
 messages integer not null default 0,
 new_conversations integer not null default 0,
 organization_id uuid not null references public.organizations(id) on delete cascade,
 updated_at timestamptz not null default now()
);
alter table public.wa_send_quotas enable row level security;
revoke all on public.wa_send_quotas from public,anon,authenticated;
grant all on public.wa_send_quotas to service_role;
create table public.platform_audit_log (
 action text not null,
 actor_user_id uuid,
 created_at timestamptz not null default now(),
 id uuid primary key not null default gen_random_uuid(),
 ip text,
 metadata jsonb not null default '{}'::jsonb,
 organization_id uuid references public.organizations(id) on delete cascade,
 target_id text,
 target_type text,
 user_agent text
);
alter table public.platform_audit_log enable row level security;
revoke all on public.platform_audit_log from public,anon,authenticated;
grant all on public.platform_audit_log to service_role;
alter table public.wa_risk_rules add check(weight between 0 and 100);
alter table public.wa_send_quotas add check(bucket in ('hour','day')), add check(messages>=0 and new_conversations>=0), add unique(channel_account_id,bucket,bucket_key);
alter table public.wa_number_restrictions add check(detection_source in ('automatic','manual')), add check(ended_at is null or ended_at>=detected_at);
create unique index wa_one_open_restriction on public.wa_number_restrictions(channel_account_id) where ended_at is null;
create index wa_number_health_events_org_idx on public.wa_number_health_events(organization_id);
create index wa_number_health_events_account_time_idx on public.wa_number_health_events(channel_account_id,created_at desc);
create index wa_number_restrictions_org_idx on public.wa_number_restrictions(organization_id);
create index wa_number_restrictions_account_time_idx on public.wa_number_restrictions(channel_account_id,created_at desc);
create index wa_send_decisions_org_idx on public.wa_send_decisions(organization_id);
create index wa_send_decisions_account_time_idx on public.wa_send_decisions(channel_account_id,created_at desc);
create index wa_send_quotas_org_idx on public.wa_send_quotas(organization_id);
create index wa_send_quotas_account_time_idx on public.wa_send_quotas(channel_account_id,created_at desc);
create index platform_audit_log_org_idx on public.platform_audit_log(organization_id);
insert into public.wa_risk_rules(key,label,threshold,weight,sort_order) values
 ('first_outbound_under_minutes','أول رسالة خلال نصف ساعة',30,10,1),
 ('first_outbound_under_hours','أول رسالة خلال ساعتين',2,5,2),
 ('first_message_is_new_conversation','أول رسالة بدء محادثة',null,5,3),
 ('first_message_from_phone','أول رسالة من الجوال',null,5,4),
 ('zero_inbound','صادر دون رسائل واردة',null,10,5),
 ('new_conversation_ratio_over','ارتفاع بدء المحادثات',20,10,6),
 ('link_age_under_hours','رقم حديث الربط',48,5,7),
 ('reply_rate_under','انخفاض نسبة الردود',30,10,8),
 ('relinked_within_hours','إعادة ربط حديثة',24,10,9),
 ('previous_restriction_single','تقييد سابق واحد',null,15,10),
 ('previous_restriction_multiple','تقييدات سابقة متعددة',null,25,11);
-- Atomic operations lock the number, retain its tenant, and audit the action.
create function public.wa_open_restriction(_org uuid,_account uuid,_source text,_reason text,_notes text,_actor uuid,_snapshot jsonb) returns uuid
language plpgsql security invoker set search_path=public as $$
declare rid uuid; begin
 perform 1 from msg_channel_accounts where id=_account and organization_id=_org for update;
 if not found then raise exception 'الرقم غير موجود في المؤسسة'; end if;
 select id into rid from wa_number_restrictions where channel_account_id=_account and ended_at is null;
 if rid is not null then return rid; end if;
 insert into wa_number_restrictions(organization_id,channel_account_id,detection_source,reason,notes,created_by,snapshot) values(_org,_account,_source,_reason,_notes,_actor,_snapshot) returning id into rid;
 insert into wa_number_health_events(organization_id,channel_account_id,event_type,detail) values(_org,_account,'restricted',jsonb_build_object('source',_source,'reason',_reason));
 update msg_channel_accounts set restriction_count=restriction_count+1,last_restricted_at=now(),send_paused_at=coalesce(send_paused_at,now()),risk_score=least(100,risk_score+45),health_state='high_risk' where id=_account;
 insert into platform_audit_log(action,actor_user_id,organization_id,target_type,target_id,metadata) values('wa_number.restricted',_actor,_org,'channel_account',_account::text,jsonb_build_object('restriction_id',rid));
 return rid;
end $$;
create function public.wa_close_restriction(_account uuid) returns boolean
language plpgsql security invoker set search_path=public as $$
declare rid uuid; began timestamptz; begin
 perform 1 from msg_channel_accounts where id=_account for update;
 if not found then raise exception 'الرقم غير موجود'; end if;
 select id,detected_at into rid,began from wa_number_restrictions where channel_account_id=_account and ended_at is null;
 if rid is null then return false; end if;
 update wa_number_restrictions set ended_at=now(),updated_at=now(),duration_minutes=greatest(0,round(extract(epoch from(now()-began))/60)) where id=rid;
 return true;
end $$;
create function public.wa_apply_control(_account uuid,_action text,_hours integer,_actor uuid) returns void
language plpgsql security invoker set search_path=public as $$
declare a msg_channel_accounts%rowtype; score integer; begin
 select * into a from msg_channel_accounts where id=_account for update;
 if not found then raise exception 'الرقم غير موجود'; end if;
 if _hours is not null and _hours not between 1 and 720 then raise exception 'مدة المراقبة غير صالحة'; end if;
 case _action
 when 'start_observation' then a.observation_started_at:=now(); a.observation_hours:=coalesce(_hours,48); a.observation_source:='manual';
 when 'extend_observation' then
  if a.observation_started_at is null or a.observation_started_at+a.observation_hours*interval '1 hour'<=now() then raise exception 'المراقبة غير نشطة؛ ابدأ مراقبة جديدة'; end if;
  a.observation_hours:=a.observation_hours+coalesce(_hours,24); a.observation_source:='manual';
 when 'end_observation' then a.observation_started_at:=null;
 when 'pause_sending' then a.send_paused_at:=now();
 when 'resume_sending' then a.send_paused_at:=null;
 when 'reset_score' then
  -- Keep event history for auditing; only reset the score.
  a.risk_score:=0; a.send_paused_at:=null;
 else raise exception 'إجراء غير صالح';
 end case;
 a.health_state:=case when a.send_paused_at is not null or a.risk_score>=40 then 'high_risk' when a.observation_started_at+a.observation_hours*interval '1 hour'>now() then 'observation' when a.risk_score>=15 then 'watch' else 'stable' end;
 update msg_channel_accounts set risk_score=a.risk_score,send_paused_at=a.send_paused_at,observation_started_at=a.observation_started_at,observation_hours=a.observation_hours,observation_source=a.observation_source,health_state=a.health_state,updated_at=now() where id=_account;
 insert into platform_audit_log(action,actor_user_id,organization_id,target_type,target_id,metadata) values('wa_number.'||_action,_actor,a.organization_id,'channel_account',_account::text,jsonb_build_object('hours',_hours));
end $$;
create function public.wa_count_outbound(_org uuid,_account uuid,_new boolean,_origin text) returns void
language plpgsql security invoker set search_path=public as $$
begin
 perform 1 from msg_channel_accounts where id=_account and organization_id=_org for update;
 if not found then raise exception 'الرقم غير موجود في المؤسسة'; end if;
 insert into wa_send_quotas(organization_id,channel_account_id,bucket,bucket_key,messages,new_conversations)
 values(_org,_account,'hour',to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24'),1,case when _new then 1 else 0 end),(_org,_account,'day',to_char(now() at time zone 'UTC','YYYY-MM-DD'),1,case when _new then 1 else 0 end)
 on conflict(channel_account_id,bucket,bucket_key) do update set messages=wa_send_quotas.messages+1,new_conversations=wa_send_quotas.new_conversations+excluded.new_conversations,updated_at=now();
 update msg_channel_accounts set last_outbound_at=now(),first_outbound_source=case when first_outbound_at is null then _origin else first_outbound_source end,first_outbound_kind=case when first_outbound_at is null then case when _new then 'new_conversation' else 'reply' end else first_outbound_kind end,first_outbound_at=coalesce(first_outbound_at,now()) where id=_account;
end $$;
revoke all on function public.wa_open_restriction(uuid,uuid,text,text,text,uuid,jsonb),public.wa_close_restriction(uuid),public.wa_apply_control(uuid,text,integer,uuid),public.wa_count_outbound(uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.wa_open_restriction(uuid,uuid,text,text,text,uuid,jsonb),public.wa_close_restriction(uuid),public.wa_apply_control(uuid,text,integer,uuid),public.wa_count_outbound(uuid,uuid,boolean,text) to service_role;
notify pgrst,'reload schema';
