-- Instagram channel: each organization links its own Instagram professional accounts through
-- Instagram's official login (the app never sees a password). Everything here is reached only by the
-- server (service role); the browser has no access to these tables.
--
--   plugin_instagram_accounts  one row per linked Instagram account: its id at Instagram, the
--                              encrypted access token and when it expires. The account row itself
--                              (owner, department, status) lives in msg_channel_accounts as for
--                              WhatsApp numbers.
--   channel_oauth_states       a one-time value that ties the return from Instagram's login page to
--                              the organization and user who started it (stops forged returns).
--
-- An Instagram account can belong to ONE organization only: the unique index on ig_user_id is what
-- keeps one customer's messages from ever landing in another customer's inbox.
-- Safe to run again.
--
-- Rollback: drop table if exists public.plugin_instagram_accounts, public.channel_oauth_states;

create table if not exists public.plugin_instagram_accounts (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 channel_account_id uuid not null references public.msg_channel_accounts(id) on delete cascade,
 ig_user_id text not null check(length(ig_user_id) between 3 and 64),
 username text,
 access_token_cipher text,
 token_expires_at timestamptz,
 token_refreshed_at timestamptz,
 status text not null default 'connected' check(status in ('connected','needs_reconnect','disconnected')),
 last_error text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create unique index if not exists plugin_instagram_accounts_ig_user_key on public.plugin_instagram_accounts(ig_user_id);
create unique index if not exists plugin_instagram_accounts_channel_account_key on public.plugin_instagram_accounts(channel_account_id);
create index if not exists plugin_instagram_accounts_org on public.plugin_instagram_accounts(organization_id);
create index if not exists plugin_instagram_accounts_refresh on public.plugin_instagram_accounts(token_expires_at) where status = 'connected';

create table if not exists public.channel_oauth_states (
 state text primary key,
 organization_id uuid not null references public.organizations(id) on delete cascade,
 user_id uuid not null,
 channel text not null check(channel in ('instagram')),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 used_at timestamptz
);
create index if not exists channel_oauth_states_expiry on public.channel_oauth_states(expires_at);

alter table public.plugin_instagram_accounts enable row level security;
alter table public.channel_oauth_states enable row level security;
revoke all on public.plugin_instagram_accounts, public.channel_oauth_states from public, anon, authenticated;
grant all on public.plugin_instagram_accounts, public.channel_oauth_states to service_role;
