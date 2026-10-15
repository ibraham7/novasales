-- Delivery/read status updates and the webhook duplicate check look messages up by WhatsApp id.
create index if not exists msg_messages_external_id_idx on public.msg_messages(external_id) where external_id is not null;
