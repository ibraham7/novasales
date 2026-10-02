create table public.cmp_templates (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,
 name text not null check(length(trim(name)) between 1 and 200),body text not null check(length(trim(body))>0),media_url text,variables jsonb not null default '[]',version integer not null default 1,
 created_by uuid,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(id,organization_id)
);
create table public.cmp_template_versions (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,template_id uuid not null,version integer not null,body text not null,media_url text,variables jsonb not null default '[]',created_at timestamptz not null default now(),
 unique(template_id,version,organization_id),foreign key(template_id,organization_id) references public.cmp_templates(id,organization_id) on delete cascade
);
create table public.cmp_campaigns (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id) on delete cascade,name text not null check(length(trim(name)) between 1 and 200),
 channel_account_id uuid not null references public.msg_channel_accounts(id),template_id uuid not null,template_version integer not null,
 audience_filter jsonb not null default '{}',throttle_per_minute integer not null default 20 check(throttle_per_minute between 1 and 1000),
 status text not null default 'draft' check(status in ('draft','scheduled','running','paused','completed','cancelled','failed')),scheduled_at timestamptz,started_at timestamptz,finished_at timestamptz,
 audience_ready boolean not null default false,stats jsonb not null default '{}',created_by uuid,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 lease_until timestamptz,lease_token uuid,next_batch_at timestamptz,error text,unique(id,organization_id),foreign key(template_id,organization_id) references public.cmp_templates(id,organization_id)
);
create table public.cmp_recipients (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,campaign_id uuid not null,contact_id uuid not null references public.crm_contacts(id),phone text not null,
 variables jsonb not null default '{}',status text not null default 'queued' check(status in ('queued','sending','sent','delivered','read','failed','skipped')),external_message_id text,error text,
 created_at timestamptz not null default now(),claimed_at timestamptz,sent_at timestamptz,delivered_at timestamptz,read_at timestamptz,failed_at timestamptz,
 unique(campaign_id,phone),foreign key(campaign_id,organization_id) references public.cmp_campaigns(id,organization_id) on delete cascade
);
create index cmp_templates_org on public.cmp_templates(organization_id,updated_at);
create index cmp_versions_org on public.cmp_template_versions(organization_id,template_id);
create index cmp_campaigns_org on public.cmp_campaigns(organization_id,created_at);
create index cmp_campaigns_due on public.cmp_campaigns(status,scheduled_at);
create index cmp_recipients_org on public.cmp_recipients(organization_id,campaign_id,status,created_at);
create index cmp_recipients_external on public.cmp_recipients(organization_id,external_message_id);
create function public.cmp_template_before() returns trigger language plpgsql security invoker set search_path=public as $$
begin
 if TG_OP='INSERT' then new.version=1; else
 new.version=old.version+case when (new.body,new.media_url,new.variables) is distinct from (old.body,old.media_url,old.variables) then 1 else 0 end;
 end if;
 new.updated_at=now();return new;
end $$;
create function public.cmp_template_snapshot() returns trigger language plpgsql security invoker set search_path=public as $$
begin
 insert into public.cmp_template_versions(organization_id,template_id,version,body,media_url,variables) values(new.organization_id,new.id,new.version,new.body,new.media_url,new.variables) on conflict do nothing;
 return new;
end $$;
create trigger cmp_template_before before insert or update on public.cmp_templates for each row execute function public.cmp_template_before();
create trigger cmp_template_snapshot after insert or update on public.cmp_templates for each row execute function public.cmp_template_snapshot();
create function public.cmp_refresh_stats() returns trigger language plpgsql security invoker set search_path=public as $$
begin
 update public.cmp_campaigns set stats=(select jsonb_build_object('total',count(*),'queued',count(*) filter(where status='queued'),'sending',count(*) filter(where status='sending'),'sent',count(*) filter(where status in ('sent','delivered','read')),'delivered',count(*) filter(where status in ('delivered','read')),'read',count(*) filter(where status='read'),'failed',count(*) filter(where status='failed'),'skipped',count(*) filter(where status='skipped')) from public.cmp_recipients where campaign_id=new.campaign_id and organization_id=new.organization_id),updated_at=now() where id=new.campaign_id and organization_id=new.organization_id;
 return new;
end $$;
create trigger cmp_refresh_stats after insert or update on public.cmp_recipients for each row execute function public.cmp_refresh_stats();
-- A lease prevents two workers from expanding or sending the same campaign.
create function public.cmp_claim_campaign(p_id uuid,p_org uuid,p_token uuid) returns boolean language plpgsql security invoker set search_path=public as $$
begin
 update public.cmp_campaigns set lease_token=p_token,lease_until=now()+interval '10 minutes',next_batch_at=now()+interval '1 minute' where id=p_id and organization_id=p_org and status='running' and (lease_until is null or lease_until<now()) and (next_batch_at is null or next_batch_at<=now());
 return found;
end $$;
create function public.cmp_claim_recipients(p_id uuid,p_org uuid,p_token uuid,p_limit integer) returns setof public.cmp_recipients language plpgsql security invoker set search_path=public as $$
begin
 perform 1 from public.cmp_campaigns where id=p_id and organization_id=p_org and lease_token=p_token and lease_until>now() and status='running' for update;
 if not found then return;end if;
 return query update public.cmp_recipients set status='sending',claimed_at=now() where id in (select id from public.cmp_recipients where campaign_id=p_id and organization_id=p_org and status='queued' order by created_at,id for update skip locked limit greatest(1,least(p_limit,1000))) returning *;
end $$;
alter table public.cmp_templates enable row level security;
alter table public.cmp_template_versions enable row level security;
alter table public.cmp_campaigns enable row level security;
alter table public.cmp_recipients enable row level security;
revoke all on public.cmp_templates,public.cmp_template_versions,public.cmp_campaigns,public.cmp_recipients from public,anon,authenticated;
grant all on public.cmp_templates,public.cmp_template_versions,public.cmp_campaigns,public.cmp_recipients to service_role;
revoke all on function public.cmp_template_before(),public.cmp_template_snapshot(),public.cmp_refresh_stats(),public.cmp_claim_campaign(uuid,uuid,uuid),public.cmp_claim_recipients(uuid,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.cmp_template_before(),public.cmp_template_snapshot(),public.cmp_refresh_stats(),public.cmp_claim_campaign(uuid,uuid,uuid),public.cmp_claim_recipients(uuid,uuid,uuid,integer) to service_role;
-- Validate references without granting clients privileged database access.
create function public.cmp_tenant_refs() returns trigger language plpgsql security invoker set search_path=public as $$
begin
 if TG_TABLE_NAME='cmp_campaigns' then
 if not exists(select 1 from public.msg_channel_accounts where id=new.channel_account_id and organization_id=new.organization_id) then raise exception 'foreign channel account';end if;
 else
 if not exists(select 1 from public.crm_contacts where id=new.contact_id and organization_id=new.organization_id) then raise exception 'foreign contact';end if;
 end if;
 return new;
end $$;
create trigger cmp_campaign_tenant before insert or update on public.cmp_campaigns for each row execute function public.cmp_tenant_refs();
create trigger cmp_recipient_tenant before insert or update on public.cmp_recipients for each row execute function public.cmp_tenant_refs();
revoke all on function public.cmp_tenant_refs() from public,anon,authenticated;
grant execute on function public.cmp_tenant_refs() to service_role;
