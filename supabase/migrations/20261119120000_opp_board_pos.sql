-- Manual order of tickets inside a pipeline column: the agent drags a card up or down and the order is
-- kept. One position per ticket (smaller = higher); tickets never ordered by hand (null) go last, newest first.
alter table public.opp_opportunities add column if not exists board_pos double precision;
create index if not exists opp_opportunities_board_pos on public.opp_opportunities(organization_id,stage_id,board_pos);

-- Writes a column's whole order in ONE statement: _ids is the column from top to bottom.
create or replace function public.opp_set_board_order(_org uuid,_stage uuid,_ids uuid[]) returns void
language sql security invoker set search_path=public as $$
 update public.opp_opportunities o
    set board_pos = t.ord * 1000
   from unnest(_ids) with ordinality as t(id, ord)
  where o.id = t.id and o.organization_id = _org and o.stage_id = _stage and o.deleted_at is null;
$$;
revoke all on function public.opp_set_board_order(uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.opp_set_board_order(uuid,uuid,uuid[]) to service_role;
