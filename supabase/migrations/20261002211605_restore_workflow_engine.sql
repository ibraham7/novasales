create table public.domain_events (
 id uuid primary key default gen_random_uuid(), organization_id uuid references public.organizations(id) on delete cascade,
 event_type text not null, aggregate_type text, aggregate_id uuid, actor_user_id uuid,
 payload jsonb not null default '{}', created_at timestamptz not null default now(),
 workflow_status text not null default 'pending' check(workflow_status in ('pending','processing','done','failed')), workflow_error text
);
create table public.wf_workflows (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
 name text not null check(length(trim(name)) between 1 and 200),description text,is_active boolean not null default false,is_system boolean not null default false,
 trigger_type text not null check(trigger_type in ('event','manual')),trigger_config jsonb not null default '{}',definition jsonb not null,
 created_by uuid,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(id,organization_id)
);
create table public.wf_runs (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,workflow_id uuid not null,
 status text not null default 'running' check(status in ('running','waiting','completed','failed','cancelled')),
 trigger_event_id uuid,context jsonb not null default '{}',definition jsonb not null,step_count integer not null default 0,next_step_id text,
 error text,started_at timestamptz not null default now(),finished_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(id,organization_id),foreign key(workflow_id,organization_id) references public.wf_workflows(id,organization_id) on delete cascade
);
create unique index wf_event_once on public.wf_runs(workflow_id,trigger_event_id) where trigger_event_id is not null;
create table public.wf_run_steps (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,run_id uuid not null,step_id text not null,step_index integer not null,step_type text not null,
 action text,status text not null check(status in ('ok','failed','waiting')),input jsonb not null default '{}',output jsonb not null default '{}',error text,created_at timestamptz not null default now(),
 foreign key(run_id,organization_id) references public.wf_runs(id,organization_id) on delete cascade
);
create table public.wf_jobs (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,run_id uuid not null,
 wait_kind text not null check(wait_kind in ('delay','event')),wait_match jsonb not null default '{}',resume_step_id text,timeout_step_id text,resume_at timestamptz not null,
 status text not null default 'pending' check(status in ('pending','processing','done','failed')),claimed_at timestamptz,error text,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),foreign key(run_id,organization_id) references public.wf_runs(id,organization_id) on delete cascade
);
create index wf_workflows_org on public.wf_workflows(organization_id,updated_at,id);
create index wf_runs_org on public.wf_runs(organization_id,workflow_id,started_at,id);
create index wf_steps_org on public.wf_run_steps(organization_id,run_id,step_index);
create index wf_jobs_due on public.wf_jobs(status,resume_at,id);
create index domain_events_pending on public.domain_events(workflow_status,created_at,id);
create function public.wf_touch_updated_at() returns trigger language plpgsql security invoker set search_path=public as $$ begin new.updated_at=now();return new;end $$;
create trigger wf_touch_workflow before update on public.wf_workflows for each row execute function public.wf_touch_updated_at();
create trigger wf_touch_run before update on public.wf_runs for each row execute function public.wf_touch_updated_at();
create trigger wf_touch_job before update on public.wf_jobs for each row execute function public.wf_touch_updated_at();
alter table public.domain_events enable row level security;
alter table public.wf_workflows enable row level security;
alter table public.wf_runs enable row level security;
alter table public.wf_run_steps enable row level security;
alter table public.wf_jobs enable row level security;
revoke all on public.domain_events,public.wf_workflows,public.wf_runs,public.wf_run_steps,public.wf_jobs from public,anon,authenticated;
grant all on public.domain_events,public.wf_workflows,public.wf_runs,public.wf_run_steps,public.wf_jobs to service_role;
revoke all on function public.wf_touch_updated_at() from public,anon,authenticated;
grant execute on function public.wf_touch_updated_at() to service_role;
-- Lead creation and the queued event commit together.
create function public.wf_lead_created_event() returns trigger language plpgsql security invoker set search_path=public as $$
begin
 insert into public.domain_events(organization_id,event_type,aggregate_type,aggregate_id,payload)
 values(new.organization_id,'crm.lead.created','lead',new.id,jsonb_build_object('lead_id',new.id,'contact_id',new.contact_id));
 return new;
end $$;
create trigger wf_lead_created after insert on public.crm_leads for each row execute function public.wf_lead_created_event();
revoke all on function public.wf_lead_created_event() from public,anon,authenticated;
grant execute on function public.wf_lead_created_event() to service_role;
