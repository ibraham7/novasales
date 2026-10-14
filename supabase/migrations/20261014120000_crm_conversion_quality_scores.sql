-- Lead-quality scores per stage (very bad 0 / average 3 / good 6 / excellent 10), kept next to the
-- existing classification. Still an internal ledger: no provider connection or external delivery.
alter table public.crm_conversion_stage_rules
 add column quality_level text check(quality_level in ('very_bad','average','good','excellent'));
alter table public.crm_conversion_events
 add column quality_level text check(quality_level in ('very_bad','average','good','excellent')),
 add column quality_score smallint,
 add column is_quality_signal boolean not null default false,
 add column contact_phone text;
create unique index crm_conversion_first_quality_idx on public.crm_conversion_events(organization_id,opportunity_id,quality_level) where is_quality_signal;

create function public.crm_quality_score(_level text) returns smallint
language sql immutable set search_path=public as $$
 select case _level when 'very_bad' then 0 when 'average' then 3 when 'good' then 6 when 'excellent' then 10 end::smallint
$$;

-- Each quality level sits on at most one stage per pipeline.
create function public.validate_crm_quality_level_scope(_organization_id uuid) returns void
language plpgsql security invoker set search_path=public as $$
begin
 if exists(select 1 from crm_conversion_stage_rules r join crm_pipeline_stages s on s.id=r.stage_id
   where r.organization_id=_organization_id and r.quality_level is not null
   group by s.pipeline_id,r.quality_level having count(*)>1) then
  raise exception 'تقييم الجودة مستخدم لأكثر من مرحلة في القمع نفسه';
 end if;
end $$;

create or replace function public.save_crm_conversion_configuration(_organization_id uuid,_goal text,_enabled boolean,_rules jsonb)
returns void language plpgsql security invoker set search_path=public as $$
declare r jsonb; begin
 -- Serialize configuration changes for one organization; replace as a single transaction.
 perform 1 from organizations where id=_organization_id for update;
 if not found then raise exception 'المؤسسة غير موجودة'; end if;
 if jsonb_typeof(_rules)<>'array' or _rules is null or jsonb_array_length(_rules)>500 then
  raise exception 'قائمة تصنيف المراحل غير صحيحة';
 end if;
 if exists(select 1 from jsonb_array_elements(_rules) x group by x->>'stageId' having count(*)>1) then
  raise exception 'المرحلة مكررة في الإعدادات';
 end if;
 insert into crm_conversion_settings(organization_id,primary_goal,recording_enabled) values(_organization_id,_goal,_enabled)
 on conflict(organization_id) do update set primary_goal=excluded.primary_goal,recording_enabled=excluded.recording_enabled,updated_at=now();
 delete from crm_conversion_stage_rules where organization_id=_organization_id;
 for r in select * from jsonb_array_elements(_rules) loop
  insert into crm_conversion_stage_rules(stage_id,organization_id,classification,quality_level)
  values((r->>'stageId')::uuid,_organization_id,r->>'classification',nullif(r->>'qualityLevel',''));
 end loop;
 perform validate_crm_quality_level_scope(_organization_id);
end $$;

-- Place one quality level on a stage from the board; the level moves off any other stage of that pipeline.
create function public.set_crm_stage_quality_level(_organization_id uuid,_stage_id uuid,_level text)
returns void language plpgsql security invoker set search_path=public as $$
declare pipe uuid; begin
 perform 1 from organizations where id=_organization_id for update;
 if not found then raise exception 'المؤسسة غير موجودة'; end if;
 select s.pipeline_id into pipe from crm_pipeline_stages s join crm_pipelines p on p.id=s.pipeline_id
  where s.id=_stage_id and p.organization_id=_organization_id;
 if pipe is null then raise exception 'المرحلة ليست ضمن مؤسستك'; end if;
 if _level is not null then
  update crm_conversion_stage_rules r set quality_level=null,updated_at=now()
   from crm_pipeline_stages s where s.id=r.stage_id and s.pipeline_id=pipe
   and r.organization_id=_organization_id and r.quality_level=_level and r.stage_id<>_stage_id;
 end if;
 insert into crm_conversion_stage_rules(stage_id,organization_id,classification,quality_level)
 values(_stage_id,_organization_id,'none',_level)
 on conflict(stage_id) do update set quality_level=excluded.quality_level,updated_at=now();
 -- Placing a score from the board opts the organization into recording with the default goal.
 insert into crm_conversion_settings(organization_id) values(_organization_id) on conflict(organization_id) do nothing;
end $$;

create or replace function public.record_crm_conversion_transition() returns trigger
language plpgsql security invoker set search_path=public as $$
declare s record; rule record; classification text; quality text; goal text; enabled boolean;
 first_goal boolean; first_quality boolean; attrs jsonb; previous uuid; phone text;
begin
 if tg_op='UPDATE' then
  if new.stage_id is not distinct from old.stage_id and new.pipeline_id is not distinct from old.pipeline_id then return new; end if;
  previous=old.stage_id;
  if new.organization_id is distinct from old.organization_id then raise exception 'لا يمكن نقل الفرصة إلى مؤسسة أخرى'; end if;
 end if;
 if new.stage_id is null or new.deleted_at is not null then return new; end if;
 select st.name,p.organization_id,st.pipeline_id into s from crm_pipeline_stages st join crm_pipelines p on p.id=st.pipeline_id where st.id=new.stage_id;
 if not found or s.organization_id<>new.organization_id or s.pipeline_id is distinct from new.pipeline_id then
  raise exception 'المرحلة أو القمع ليس ضمن مؤسسة الفرصة';
 end if;
 select primary_goal,recording_enabled into goal,enabled from crm_conversion_settings where organization_id=new.organization_id;
 if goal is null or not enabled then return new; end if;
 select r.classification,r.quality_level into rule from crm_conversion_stage_rules r where r.organization_id=new.organization_id and r.stage_id=new.stage_id;
 classification=coalesce(rule.classification,'none');
 quality=rule.quality_level;
 select ad_attribution into attrs from crm_leads where id=new.lead_id and organization_id=new.organization_id;
 select identifier into phone from crm_contact_points
  where organization_id=new.organization_id and contact_id=new.contact_id and channel_type::text in ('whatsapp','phone','sms')
  order by (channel_type::text='whatsapp') desc,is_primary desc,id limit 1;
 -- The opportunity row is locked by this transition, so these checks cannot race for the same opportunity.
 -- Re-entry is history, not a second advertising signal for this opportunity and goal or quality level.
 first_goal=classification in ('qualified_lead','booking','purchase') and not exists(select 1 from crm_conversion_events e
  where e.organization_id=new.organization_id and e.opportunity_id=new.id and e.event_kind=classification and e.is_first_for_goal);
 first_quality=quality is not null and not exists(select 1 from crm_conversion_events e
  where e.organization_id=new.organization_id and e.opportunity_id=new.id and e.quality_level=quality and e.is_quality_signal);
 insert into crm_conversion_events(organization_id,opportunity_id,contact_id,lead_id,pipeline_id,from_stage_id,to_stage_id,stage_name,event_kind,primary_goal,is_first_for_goal,value,currency,source,attribution,delivery_state,quality_level,quality_score,is_quality_signal,contact_phone)
 values(new.organization_id,new.id,new.contact_id,new.lead_id,new.pipeline_id,previous,new.stage_id,s.name,classification,goal,first_goal,new.value,new.currency,new.source,coalesce(attrs,'{}'),
  case when first_goal or first_quality then 'awaiting_connection' else 'internal_only' end,quality,crm_quality_score(quality),first_quality,phone);
 return new;
end $$;

revoke all on function public.crm_quality_score(text) from public,anon,authenticated;
revoke all on function public.validate_crm_quality_level_scope(uuid) from public,anon,authenticated;
revoke all on function public.set_crm_stage_quality_level(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.crm_quality_score(text),public.validate_crm_quality_level_scope(uuid),public.set_crm_stage_quality_level(uuid,uuid,text) to service_role;
