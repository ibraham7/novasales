-- Follow-up counter on a sales ticket: each press of the counter button on the board card adds one.
-- The log keeps WHO pressed and when (to see how many follow-ups each agent made); followup_count on the
-- ticket is the total, kept in step by the two functions below so the board reads it without counting.
-- Server-only table.
alter table public.opp_opportunities add column if not exists followup_count integer not null default 0 check(followup_count >= 0);

create table if not exists public.opp_followups (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 opportunity_id uuid not null references public.opp_opportunities(id) on delete cascade,
 user_id uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now()
);
create index if not exists opp_followups_ticket on public.opp_followups(organization_id,opportunity_id,created_at desc);
create index if not exists opp_followups_agent on public.opp_followups(organization_id,user_id,created_at desc);
alter table public.opp_followups enable row level security;
revoke all on public.opp_followups from anon,authenticated;
grant all on public.opp_followups to service_role;

-- +1: logs the follow-up and returns the ticket's new total, in one transaction.
create or replace function public.opp_add_followup(_org uuid,_opp uuid,_user uuid) returns integer
language plpgsql security invoker set search_path=public as $$
declare n integer;
begin
 update public.opp_opportunities set followup_count = followup_count + 1
  where id=_opp and organization_id=_org and deleted_at is null returning followup_count into n;
 if n is null then raise exception 'ticket not found'; end if;
 insert into public.opp_followups(organization_id,opportunity_id,user_id) values(_org,_opp,_user);
 return n;
end $$;

-- Undo: removes the caller's latest follow-up on the ticket and returns the new total (unchanged if there is none).
create or replace function public.opp_undo_followup(_org uuid,_opp uuid,_user uuid) returns integer
language plpgsql security invoker set search_path=public as $$
declare last_id uuid; n integer;
begin
 select id into last_id from public.opp_followups
  where organization_id=_org and opportunity_id=_opp and user_id is not distinct from _user
  order by created_at desc limit 1;
 if last_id is not null then
  delete from public.opp_followups where id=last_id;
  update public.opp_opportunities set followup_count = greatest(followup_count - 1, 0)
   where id=_opp and organization_id=_org returning followup_count into n;
 else
  select followup_count into n from public.opp_opportunities where id=_opp and organization_id=_org;
 end if;
 if n is null then raise exception 'ticket not found'; end if;
 return n;
end $$;

revoke all on function public.opp_add_followup(uuid,uuid,uuid),public.opp_undo_followup(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.opp_add_followup(uuid,uuid,uuid),public.opp_undo_followup(uuid,uuid,uuid) to service_role;
