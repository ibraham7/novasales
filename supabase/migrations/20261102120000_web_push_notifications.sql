-- Web Push notifications: one subscription per browser/device, per-user choices of what to receive,
-- a log of every notification (with what the push service and the device reported) and the manual
-- broadcasts sent by managers. Server-only tables: the browser never reads or writes them directly.

create table if not exists public.push_subscriptions (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 endpoint text not null check(length(endpoint) between 20 and 2000),
 p256dh text not null check(length(p256dh) between 20 and 200),
 auth text not null check(length(auth) between 10 and 100),
 user_agent text check(length(user_agent) <= 300),
 device_label text check(length(device_label) <= 80),
 created_at timestamptz not null default now(),
 last_seen_at timestamptz not null default now(),
 last_success_at timestamptz,
 last_error text,
 failure_count integer not null default 0,
 unique(endpoint)
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(organization_id,user_id);

create table if not exists public.push_preferences (
 organization_id uuid not null references public.organizations(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 disabled_types text[] not null default '{}',
 updated_at timestamptz not null default now(),
 primary key(organization_id,user_id)
);

create table if not exists public.push_broadcasts (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 created_by uuid references auth.users(id) on delete set null,
 title text not null check(length(title) between 1 and 120),
 body text not null check(length(body) <= 500),
 url text check(length(url) <= 300),
 audience jsonb not null default '{}',
 recipients_count integer not null default 0,
 created_at timestamptz not null default now()
);
create index if not exists push_broadcasts_org_idx on public.push_broadcasts(organization_id,created_at desc);

create table if not exists public.push_messages (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 recipient_user_id uuid not null references auth.users(id) on delete cascade,
 type text not null,
 title text not null,
 body text,
 url text,
 dedupe_key text,
 broadcast_id uuid references public.push_broadcasts(id) on delete set null,
 -- queued → accepted (a push service took it) | failed | no_device. shown_at/clicked_at come from the device itself.
 status text not null default 'queued' check(status in ('queued','accepted','failed','no_device')),
 devices_total integer not null default 0,
 devices_accepted integer not null default 0,
 devices_failed integer not null default 0,
 error text,
 created_at timestamptz not null default now(),
 shown_at timestamptz,
 clicked_at timestamptz,
 unique(recipient_user_id,dedupe_key)
);
create index if not exists push_messages_org_idx on public.push_messages(organization_id,created_at desc);
create index if not exists push_messages_broadcast_idx on public.push_messages(broadcast_id) where broadcast_id is not null;

do $$ declare t text; begin
 foreach t in array array['push_subscriptions','push_preferences','push_broadcasts','push_messages'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
