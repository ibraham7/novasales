-- Each organization sends outbound email from its own mailbox (SMTP), and reads replies/bounces over IMAP.
-- Passwords are stored encrypted by the server (AES-GCM). Server-only table.
create table if not exists public.ob_mailboxes (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 label text not null check(length(trim(label)) between 1 and 100),
 from_email text not null check(length(from_email) between 5 and 254),
 from_name text check(length(from_name) <= 100),
 smtp_host text not null, smtp_port integer not null check(smtp_port between 1 and 65535),
 smtp_security text not null default 'ssl' check(smtp_security in ('ssl','starttls','none')),
 smtp_user text not null, smtp_pass_enc text not null,
 imap_host text, imap_port integer, imap_security text check(imap_security in ('ssl','starttls','none')),
 imap_user text, imap_pass_enc text, imap_last_uid bigint,
 daily_limit integer not null default 50 check(daily_limit between 1 and 2000),
 status text not null default 'active' check(status in ('active','disabled','error')),
 last_error text, last_checked_at timestamptz,
 created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 unique(organization_id,from_email)
);
alter table public.ob_email_campaigns add column if not exists mailbox_id uuid references public.ob_mailboxes(id) on delete set null;
alter table public.ob_email_messages add column if not exists message_id text;
create index if not exists ob_email_messages_msgid on public.ob_email_messages(message_id) where message_id is not null;
alter table public.ob_mailboxes enable row level security;
revoke all on public.ob_mailboxes from anon,authenticated;
grant all on public.ob_mailboxes to service_role;
