-- Internal CRM conversion ledger. No provider connection or external delivery.
create table public.crm_conversion_settings (
 organization_id uuid primary key references public.organizations(id) on delete cascade,
 primary_goal text not null default 'qualified_lead' check(primary_goal in ('qualified_lead','booking','purchase')),
 recording_enabled boolean not null default true,
 updated_at timestamptz not null default now()
);
create table public.crm_conversion_stage_rules (
 stage_id uuid primary key references public.crm_pipeline_stages(id) on delete cascade,
 organization_id uuid not null references public.organizations(id) on delete cascade,
 classification text not null check(classification in ('none','new_lead','qualified_lead','booking','purchase','lost')),
 updated_at timestamptz not null default now()
);
create index crm_conversion_rules_org_idx on public.crm_conversion_stage_rules(organization_id);
alter table public.crm_leads add column ad_attribution jsonb not null default '{}' check(jsonb_typeof(ad_attribution)='object');
create table public.crm_conversion_events (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 opportunity_id uuid not null,
 contact_id uuid,
 lead_id uuid,
 pipeline_id uuid,
 from_stage_id uuid,
 to_stage_id uuid,
 stage_name text not null,
 event_kind text not null check(event_kind in ('none','new_lead','qualified_lead','booking','purchase','lost')),
 primary_goal text not null check(primary_goal in ('qualified_lead','booking','purchase')),
 is_first_for_goal boolean not null default false,
 value numeric,
 currency text,
 source text,
 attribution jsonb not null default '{}',
 delivery_state text not null default 'awaiting_connection' check(delivery_state in ('awaiting_connection','internal_only')),
 occurred_at timestamptz not null default now()
);
create index crm_conversion_events_org_time_idx on public.crm_conversion_events(organization_id,occurred_at desc,id);
create unique index crm_conversion_first_goal_idx on public.crm_conversion_events(organization_id,opportunity_id,event_kind) where is_first_for_goal;
-- Keep immutable snapshots when an opportunity or a stage is subsequently removed.
do $$ declare t text; begin
 foreach t in array array['crm_conversion_settings','crm_conversion_stage_rules','crm_conversion_events'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;

create function public.validate_crm_conversion_rule() returns trigger
language plpgsql security invoker set search_path=public as $$
begin
 if not exists(select 1 from crm_pipeline_stages s join crm_pipelines p on p.id=s.pipeline_id
   where s.id=new.stage_id and p.organization_id=new.organization_id) then
  raise exception 'المرحلة ليست ضمن مؤسستك';
 end if;
 return new;
end $$;
create trigger crm_conversion_rule_scope before insert or update on public.crm_conversion_stage_rules
for each row execute function public.validate_crm_conversion_rule();

create function public.save_crm_conversion_configuration(_organization_id uuid,_goal text,_enabled boolean,_rules jsonb)
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
  insert into crm_conversion_stage_rules(stage_id,organization_id,classification)
  values((r->>'stageId')::uuid,_organization_id,r->>'classification');
 end loop;
end $$;

create function public.record_crm_conversion_transition() returns trigger
language plpgsql security invoker set search_path=public as $$
declare s record; classification text; goal text; enabled boolean; first_goal boolean; attrs jsonb; previous uuid; inserted_id uuid;
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
 select r.classification into classification from crm_conversion_stage_rules r where r.organization_id=new.organization_id and r.stage_id=new.stage_id;
 classification=coalesce(classification,'none');
 select ad_attribution into attrs from crm_leads where id=new.lead_id and organization_id=new.organization_id;
 first_goal=classification in ('qualified_lead','booking','purchase');
 insert into crm_conversion_events(organization_id,opportunity_id,contact_id,lead_id,pipeline_id,from_stage_id,to_stage_id,stage_name,event_kind,primary_goal,is_first_for_goal,value,currency,source,attribution,delivery_state)
 values(new.organization_id,new.id,new.contact_id,new.lead_id,new.pipeline_id,previous,new.stage_id,s.name,classification,goal,first_goal,new.value,new.currency,new.source,coalesce(attrs,'{}'),case when first_goal then 'awaiting_connection' else 'internal_only' end)
 on conflict(organization_id,opportunity_id,event_kind) where is_first_for_goal do nothing returning id into inserted_id;
 if inserted_id is null then
  -- Re-entry is history, not a second advertising conversion for this opportunity and goal.
  insert into crm_conversion_events(organization_id,opportunity_id,contact_id,lead_id,pipeline_id,from_stage_id,to_stage_id,stage_name,event_kind,primary_goal,is_first_for_goal,value,currency,source,attribution,delivery_state)
  values(new.organization_id,new.id,new.contact_id,new.lead_id,new.pipeline_id,previous,new.stage_id,s.name,classification,goal,false,new.value,new.currency,new.source,coalesce(attrs,'{}'),'internal_only');
 end if;
 return new;
end $$;
create trigger crm_conversion_capture after insert or update of stage_id,pipeline_id on public.opp_opportunities
for each row execute function public.record_crm_conversion_transition();
revoke all on function public.validate_crm_conversion_rule() from public,anon,authenticated;
revoke all on function public.record_crm_conversion_transition() from public,anon,authenticated;
revoke all on function public.save_crm_conversion_configuration(uuid,text,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.validate_crm_conversion_rule(),public.record_crm_conversion_transition(),public.save_crm_conversion_configuration(uuid,text,boolean,jsonb) to service_role;
