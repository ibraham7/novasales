-- Automation, step 1: events that carry what an automation needs. Every move of a ticket to another stage
-- and every change of its owner is recorded by the database itself, so ALL paths (board, chat, workflows,
-- imports) are covered, with the previous and new stage (id and name), the customer, the owner and the source.
-- Safe to run twice. Nothing is sent by this file; events only wait in domain_events until the automation
-- worker (off by default) picks them up.
alter table public.opp_opportunities add column if not exists stage_entered_at timestamptz;
-- New tickets start their stage now; existing ones stay empty (readers fall back to updated_at).
alter table public.opp_opportunities alter column stage_entered_at set default now();

create or replace function public.wf_opportunity_events() returns trigger
language plpgsql security invoker set search_path=public as $$
declare from_name text; to_name text;
begin
 if new.stage_id is distinct from old.stage_id then
  new.stage_entered_at := now();
  select name into from_name from public.crm_pipeline_stages where id = old.stage_id;
  select name into to_name from public.crm_pipeline_stages where id = new.stage_id;
  insert into public.domain_events(organization_id,event_type,aggregate_type,aggregate_id,payload)
  values(new.organization_id,'crm.opportunity.stage_changed','opportunity',new.id,jsonb_build_object(
   'opportunity_id',new.id,'contact_id',new.contact_id,'lead_id',new.lead_id,'owner_user_id',new.owner_agent_id,
   'pipeline_id',new.pipeline_id,'stage_id',new.stage_id,'to_stage_id',new.stage_id,'from_stage_id',old.stage_id,
   'to_stage_name',to_name,'from_stage_name',from_name,'source',new.source,'value',new.value,'currency',new.currency));
 end if;
 if new.owner_agent_id is distinct from old.owner_agent_id and new.owner_agent_id is not null then
  insert into public.domain_events(organization_id,event_type,aggregate_type,aggregate_id,payload)
  values(new.organization_id,'crm.opportunity.assigned','opportunity',new.id,jsonb_build_object(
   'opportunity_id',new.id,'contact_id',new.contact_id,'lead_id',new.lead_id,'from_user_id',old.owner_agent_id,
   'to_user_id',new.owner_agent_id,'owner_user_id',new.owner_agent_id,'stage_id',new.stage_id,'source',new.source));
 end if;
 return new;
end $$;

drop trigger if exists wf_opportunity_events on public.opp_opportunities;
create trigger wf_opportunity_events before update of stage_id, owner_agent_id on public.opp_opportunities
 for each row execute function public.wf_opportunity_events();
revoke all on function public.wf_opportunity_events() from public,anon,authenticated;
grant execute on function public.wf_opportunity_events() to service_role;
