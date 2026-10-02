-- Definitions used by the existing custom-field editor and lead validator.
create table public.crm_field_defs (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 entity_type text not null, key text not null, label text not null,
 field_type text not null check(field_type in ('text','number','date','select','multiselect','boolean','phone','email')),
 field_group text not null default 'General', options jsonb not null default '[]', default_value jsonb,
 validation jsonb not null default '{}', visibility text not null default 'everyone' check(visibility in ('everyone','agent','supervisor','admin','owner')),
 is_required boolean not null default false, read_only boolean not null default false, system_field boolean not null default false,
 is_searchable boolean not null default false,is_filterable boolean not null default false,is_active boolean not null default true,
 ord integer not null default 0, created_by uuid,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(organization_id,entity_type,key)
);
alter table public.crm_field_defs enable row level security;
revoke all on public.crm_field_defs from public,anon,authenticated;
grant all on public.crm_field_defs to service_role;
create index crm_field_defs_lookup on public.crm_field_defs(organization_id,entity_type,is_active,ord);
create index crm_leads_org_opened on public.crm_leads(organization_id,opened_at desc,id);
create index opp_lead_lookup on public.opp_opportunities(organization_id,lead_id) where lead_id is not null;

-- Caller identity comes from a verified server session, never browser metadata.
create function public.crm_lead_scope_allowed(_org uuid,_actor uuid,_owner uuid,_department uuid) returns boolean
language plpgsql security invoker set search_path=public as $$
declare a jsonb;
begin
 a:=get_workspace_access_fast(_actor,_org);
 if coalesce((a->>'isSuperAdmin')::boolean,false) or (a->'roleKeys') ?| array['admin','owner','org_owner','supervisor'] then return true; end if;
 if (a->'roleKeys') ? 'department_supervisor' or (a->'permissions') ?| array['opportunities.view_department','reports.view_department'] then return coalesce((a->'departmentIds') ? _department::text,false); end if;
 return coalesce(_owner=_actor,false);
end $$;

create function public.crm_save_lead_atomic(_org uuid,_actor uuid,_lead uuid,_input jsonb) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare l crm_leads; c uuid; department uuid; owner_id uuid; point_id uuid; kind text; point_value text; permission text;
begin
 permission:=case when _lead is null then 'crm.leads.create' else 'crm.leads.update' end;
 if not has_permission(_actor,_org,permission) then raise exception 'لا تملك صلاحية حفظ العميل المحتمل'; end if;
 if _lead is not null then
  select * into l from crm_leads where id=_lead and organization_id=_org for update;
  if not found or not crm_lead_scope_allowed(_org,_actor,l.owner_user_id,l.department_id) then raise exception 'العميل خارج نطاق صلاحياتك'; end if;
  c:=l.contact_id;
 else c:=nullif(_input->>'contactId','')::uuid; end if;
 department:=case when _input ? 'departmentId' then nullif(_input->>'departmentId','')::uuid else l.department_id end;
 owner_id:=case when _input ? 'ownerUserId' then nullif(_input->>'ownerUserId','')::uuid when _lead is null then _actor else l.owner_user_id end;
 if department is not null and not exists(select 1 from org_departments where id=department and organization_id=_org) then raise exception 'القسم لا يتبع هذه المؤسسة'; end if;
 if owner_id is not null and not exists(select 1 from org_memberships where organization_id=_org and user_id=owner_id and is_active) then raise exception 'المندوب ليس عضوًا فعالًا في المؤسسة'; end if;
 if owner_id is not null and department is not null and owner_id<>_actor and not exists(select 1 from org_department_members where organization_id=_org and user_id=owner_id and department_id=department and is_active) then raise exception 'المندوب غير مسجل في القسم المحدد'; end if;
 if not crm_lead_scope_allowed(_org,_actor,owner_id,department) then raise exception 'التعيين خارج نطاق صلاحياتك'; end if;
 if ((_lead is not null and (owner_id is distinct from l.owner_user_id or department is distinct from l.department_id)) or (_lead is null and owner_id is distinct from _actor)) and not (has_permission(_actor,_org,'crm.leads.assign') or has_permission(_actor,_org,'org.manage')) then raise exception 'تغيير القسم أو المندوب يتطلب صلاحية تعيين العملاء'; end if;
 if _input->>'status'='converted' and (_lead is null or l.status<>'converted') then raise exception 'استخدم التحويل إلى فرصة'; end if;
 if l.status='converted' and _input ? 'status' and _input->>'status'<>'converted' then raise exception 'لا يمكن تغيير حالة عميل تم تحويله إلى فرصة'; end if;
 if c is null then
  if nullif(trim(_input->>'contactName'),'') is null then raise exception 'اسم العميل إلزامي'; end if;
  insert into crm_contacts(organization_id,display_name,full_name,lifecycle_stage) values(_org,trim(_input->>'contactName'),trim(_input->>'contactName'),'lead') returning id into c;
 else
  perform 1 from crm_contacts where id=c and organization_id=_org for update;
  if not found then raise exception 'جهة الاتصال لا تتبع المؤسسة'; end if;
  if _lead is null and not crm_lead_scope_allowed(_org,_actor,null,null) and not exists(select 1 from crm_leads where contact_id=c and organization_id=_org and crm_lead_scope_allowed(_org,_actor,owner_user_id,department_id)) and not exists(select 1 from opp_opportunities where contact_id=c and organization_id=_org and deleted_at is null and crm_lead_scope_allowed(_org,_actor,owner_agent_id,department_id)) then raise exception 'جهة الاتصال خارج نطاق صلاحياتك'; end if;
  if _input ? 'contactName' then
   if nullif(trim(_input->>'contactName'),'') is null then raise exception 'اسم العميل إلزامي'; end if;
   update crm_contacts set display_name=trim(_input->>'contactName'),full_name=trim(_input->>'contactName') where id=c;
  end if;
 end if;
 foreach kind in array array['phone','email'] loop
  if not _input ? kind then continue; end if;
  point_value:=nullif(trim(_input->>kind),'');
  select id into point_id from crm_contact_points where organization_id=_org and contact_id=c and ((kind='phone' and channel_type::text in ('whatsapp','phone','sms')) or (kind='email' and channel_type::text='email')) order by (channel_type::text='whatsapp') desc,is_primary desc,id limit 1 for update;
  if point_value is null then
   if point_id is not null then delete from crm_contact_points where id=point_id; end if;
  elsif point_id is not null then update crm_contact_points set identifier=point_value where id=point_id;
  else insert into crm_contact_points(organization_id,contact_id,channel_type,identifier,is_primary) values(_org,c,case when kind='phone' then 'whatsapp' else 'email' end,point_value,true); end if;
 end loop;
 if _lead is null then
  insert into crm_leads(organization_id,contact_id,department_id,owner_user_id,source,status,notes,custom_fields)
  values(_org,c,department,owner_id,_input->>'source',coalesce(_input->>'status','new'),_input->>'notes',coalesce(_input->'customFields','{}')) returning * into l;
 else
  update crm_leads set department_id=department,owner_user_id=owner_id,source=case when _input ? 'source' then _input->>'source' else source end,
  status=coalesce(_input->>'status',status),notes=case when _input ? 'notes' then _input->>'notes' else notes end,
  score=case when _input ? 'score' then (_input->>'score')::integer else score end,custom_fields=coalesce(_input->'customFields',custom_fields),updated_at=now()
  where id=_lead returning * into l;
 end if;
 insert into crm_timeline(organization_id,entity_type,entity_id,event_kind,title,actor_user_id) values(_org,'lead',l.id,case when _lead is null then 'lead.created' else 'lead.updated' end,case when _lead is null then 'تم إنشاء العميل المحتمل' else 'تم تعديل العميل المحتمل' end,_actor);
 return to_jsonb(l);
end $$;

create function public.crm_convert_lead_atomic(_org uuid,_actor uuid,_lead uuid,_input jsonb) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare l crm_leads; o opp_opportunities; p uuid; s crm_pipeline_stages; contact_name text;
begin
 if not has_permission(_actor,_org,'crm.leads.update') or not has_permission(_actor,_org,'crm.opportunities.create') then raise exception 'لا تملك صلاحية تحويل العملاء إلى فرص'; end if;
 select * into l from crm_leads where id=_lead and organization_id=_org for update;
 if not found or not crm_lead_scope_allowed(_org,_actor,l.owner_user_id,l.department_id) then raise exception 'العميل خارج نطاق صلاحياتك'; end if;
 select * into o from opp_opportunities where lead_id=_lead and organization_id=_org order by opened_at,id limit 1;
 if found then
  if o.deleted_at is not null then raise exception 'الفرصة المرتبطة موجودة في المهملات؛ استعدها بدل تكرار التحويل'; end if;
  update crm_leads set status='converted',converted_at=coalesce(converted_at,now()),updated_at=now() where id=_lead;
  return to_jsonb(o);
 end if;
 if l.status='converted' then raise exception 'العميل محوّل بالفعل؛ راجع الفرص المرتبطة'; end if;
 select id into p from crm_pipelines where organization_id=_org order by is_default desc,created_at,id limit 1;
 if p is null then raise exception 'أضف مسار مبيعات ومرحلة قبل تحويل العميل'; end if;
 select * into s from crm_pipeline_stages where pipeline_id=p and not is_won and not is_lost order by ord,id limit 1;
 if not found then raise exception 'مسار المبيعات لا يحتوي على مرحلة مفتوحة'; end if;
 select coalesce(display_name,full_name,'فرصة مبيعات') into contact_name from crm_contacts where id=l.contact_id and organization_id=_org;
 insert into opp_opportunities(organization_id,contact_id,lead_id,department_id,owner_agent_id,pipeline_id,stage_id,stage,title,source,value,currency,expected_close_date,probability)
 values(_org,l.contact_id,l.id,l.department_id,l.owner_user_id,p,s.id,'new',coalesce(nullif(_input->>'title',''),contact_name),l.source,coalesce((_input->>'amount')::numeric,0),coalesce(_input->>'currency','USD'),nullif(_input->>'expectedCloseDate','')::date,s.probability) returning * into o;
 update crm_leads set status='converted',converted_at=now(),updated_at=now() where id=_lead;
 insert into crm_timeline(organization_id,entity_type,entity_id,event_kind,title,actor_user_id) values(_org,'lead',_lead,'lead.converted','تم تحويل العميل إلى فرصة',_actor);
 return to_jsonb(o);
end $$;
create function public.crm_delete_lead_atomic(_org uuid,_actor uuid,_lead uuid) returns void
language plpgsql security invoker set search_path=public as $$
declare l crm_leads;
begin
 if not has_permission(_actor,_org,'crm.leads.delete') then raise exception 'لا تملك صلاحية حذف العميل'; end if;
 select * into l from crm_leads where id=_lead and organization_id=_org for update;
 if not found or not crm_lead_scope_allowed(_org,_actor,l.owner_user_id,l.department_id) then raise exception 'العميل خارج نطاق صلاحياتك'; end if;
 if exists(select 1 from opp_opportunities where lead_id=_lead and organization_id=_org) then raise exception 'لا يمكن حذف عميل مرتبط بفرصة؛ احتفظ بسجل التحويل'; end if;
 delete from crm_tasks where organization_id=_org and entity_type='lead' and entity_id=_lead;
 delete from crm_activities where organization_id=_org and entity_type='lead' and entity_id=_lead;
 delete from crm_timeline where organization_id=_org and entity_type='lead' and entity_id=_lead;
 delete from crm_leads where id=_lead;
 -- The shared contact and its communication points are intentionally retained.
end $$;
revoke all on function public.crm_lead_scope_allowed(uuid,uuid,uuid,uuid),public.crm_save_lead_atomic(uuid,uuid,uuid,jsonb),public.crm_convert_lead_atomic(uuid,uuid,uuid,jsonb),public.crm_delete_lead_atomic(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.crm_lead_scope_allowed(uuid,uuid,uuid,uuid),public.crm_save_lead_atomic(uuid,uuid,uuid,jsonb),public.crm_convert_lead_atomic(uuid,uuid,uuid,jsonb),public.crm_delete_lead_atomic(uuid,uuid,uuid) to service_role;
