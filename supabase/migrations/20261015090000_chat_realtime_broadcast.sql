-- Live chat updates. The browser has no table access to messages, so postgres_changes never fired.
-- Instead the database broadcasts a minimal "this chat changed" signal on a private per-organization
-- topic; clients refetch through the server functions, which keep applying department scoping.
create or replace function public.broadcast_chat_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare row_data record; session_id uuid;
begin
 row_data := case when tg_op='DELETE' then old else new end;
 if tg_table_name='msg_sessions' then
  -- Opening a chat resets unread_count; only broadcast real activity so viewers do not refetch in a loop.
  if tg_op='UPDATE' and new.last_message_at is not distinct from old.last_message_at
     and coalesce(new.unread_count,0) <= coalesce(old.unread_count,0) then
   return null;
  end if;
  session_id := row_data.id;
 else
  session_id := row_data.session_id;
 end if;
 perform realtime.send(
  jsonb_build_object('session_id', session_id, 'table', tg_table_name, 'op', tg_op),
  'chat_changed',
  'org:' || row_data.organization_id || ':chats',
  true
 );
 return null;
end $$;
revoke all on function public.broadcast_chat_change() from public, anon, authenticated;

create trigger msg_messages_broadcast after insert or update or delete on public.msg_messages
for each row execute function public.broadcast_chat_change();
create trigger msg_sessions_broadcast after insert or update on public.msg_sessions
for each row execute function public.broadcast_chat_change();

-- Only active members of the organization may join its private chats topic. The browser role cannot read
-- org_memberships, so the check lives in a non-API schema and only answers for the calling user.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
create or replace function private.can_join_chat_topic(_topic text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists (
  select 1 from public.org_memberships m
  where m.user_id = (select auth.uid()) and m.is_active
   and _topic = 'org:' || m.organization_id || ':chats'
 )
$$;
revoke all on function private.can_join_chat_topic(text) from public, anon;
grant execute on function private.can_join_chat_topic(text) to authenticated;

create policy "org members receive chat signals" on realtime.messages
for select to authenticated
using (
 realtime.messages.extension = 'broadcast'
 and (select private.can_join_chat_topic((select realtime.topic())))
);
