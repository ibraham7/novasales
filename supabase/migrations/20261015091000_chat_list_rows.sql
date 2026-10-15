-- Chat list in one round trip: sessions with their linked opportunity, contact, department and owner.
-- Access scoping stays in the server function; this only replaces five sequential reads.
create index if not exists msg_sessions_org_last_message_idx
 on public.msg_sessions(organization_id, last_message_at desc nulls last);

create or replace function public.list_chat_rows(_organization_id uuid, _limit int)
returns table(
 id uuid, peer_identifier text, channel_account_id uuid, last_message_preview text,
 last_message_at timestamptz, unread_count int,
 opportunity_id uuid, contact_id uuid, stage text, source text, priority int,
 department_id uuid, owner_agent_id uuid,
 contact_name text, department_name text, owner_name text
)
language sql stable security invoker set search_path=public as $$
 select s.id, s.peer_identifier, s.channel_account_id, s.last_message_preview,
  s.last_message_at, coalesce(s.unread_count,0)::int,
  o.id, o.contact_id, o.stage::text, o.source, coalesce(o.priority,0)::int,
  o.department_id, o.owner_agent_id,
  coalesce(c.display_name, c.full_name), d.name, p.full_name
 from (
  select * from msg_sessions
  where organization_id=_organization_id
  order by last_message_at desc nulls last
  limit least(greatest(_limit,1),3000)
 ) s
 left join crm_opportunity_sessions l on l.organization_id=s.organization_id and l.session_ref=s.id::text
 left join opp_opportunities o on o.id=l.opportunity_id and o.organization_id=s.organization_id
 left join crm_contacts c on c.id=o.contact_id and c.organization_id=s.organization_id
 left join org_departments d on d.id=o.department_id
 left join profiles p on p.id=o.owner_agent_id
 order by s.last_message_at desc nulls last
$$;
revoke all on function public.list_chat_rows(uuid,int) from public, anon, authenticated;
grant execute on function public.list_chat_rows(uuid,int) to service_role;
