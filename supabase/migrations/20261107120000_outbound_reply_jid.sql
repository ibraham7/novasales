-- WhatsApp may deliver a reply from a hidden id (@lid) instead of the phone number. The id learned
-- for a recipient is kept so later messages (e.g. a stop request) reach the same business.
alter table public.cmp_recipients add column if not exists reply_jid text;
create index if not exists cmp_recipients_reply_jid on public.cmp_recipients(organization_id,reply_jid) where reply_jid is not null;
