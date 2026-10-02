-- Server-only CRM records. Workspace authorization is enforced by server functions.
create table public.crm_activities (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 entity_type text not null check(entity_type in ('lead','opportunity','contact')), entity_id uuid not null,
 activity_type text not null check(activity_type in ('call','meeting','message','email','note','system','custom')),
 actor_user_id uuid, actor_type text not null default 'user', subject text, body text,
 direction text check(direction in ('inbound','outbound')), channel text, occurred_at timestamptz not null default now(),
 duration_seconds integer check(duration_seconds>=0), metadata jsonb not null default '{}', created_at timestamptz not null default now()
);
create table public.crm_tasks (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 entity_type text check(entity_type in ('lead','opportunity','contact')), entity_id uuid,
 title text not null check(length(trim(title))>0), description text,
 status text not null default 'open' check(status in ('open','in_progress','done','cancelled')),
 priority text not null default 'normal' check(priority in ('low','normal','high','urgent')),
 due_at timestamptz, assignee_user_id uuid, created_by uuid, completed_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check((entity_type is null)=(entity_id is null))
);
create table public.crm_timeline (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 entity_type text not null check(entity_type in ('lead','opportunity','contact')), entity_id uuid not null,
 event_kind text not null, title text not null, description text, actor_user_id uuid,
 occurred_at timestamptz not null default now(), ref_type text, ref_id uuid, metadata jsonb not null default '{}'
);
create index crm_activities_org_time on public.crm_activities(organization_id,occurred_at,id);
create index crm_activities_entity on public.crm_activities(organization_id,entity_type,entity_id);
create index crm_tasks_org_due on public.crm_tasks(organization_id,due_at,id);
create index crm_tasks_entity on public.crm_tasks(organization_id,entity_type,entity_id);
create index crm_timeline_org_time on public.crm_timeline(organization_id,occurred_at,id);
create index crm_timeline_entity on public.crm_timeline(organization_id,entity_type,entity_id);
alter table public.crm_activities enable row level security;
alter table public.crm_tasks enable row level security;
alter table public.crm_timeline enable row level security;
revoke all on public.crm_activities,public.crm_tasks,public.crm_timeline from public,anon,authenticated;
grant all on public.crm_activities,public.crm_tasks,public.crm_timeline to service_role;
