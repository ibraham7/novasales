-- Serena: the AI sales assistant. One settings row per organization and a log of every conversation turn
-- (in the app and on WhatsApp). Only server functions (service role) read or write these tables.
create table public.serena_settings (
 organization_id uuid primary key references public.organizations(id) on delete cascade,
 provider text not null default 'google' check(provider in ('google')),
 model text check(model is null or length(model) between 3 and 120),
 api_key_cipher text,                 -- AES-GCM, key derived from SERENA_ENCRYPTION_KEY (or the service role key)
 api_key_hint text check(api_key_hint is null or length(api_key_hint)<=8),
 cost_attribute_id uuid,              -- the product (or variant) money property that holds the purchase cost
 whatsapp_enabled boolean not null default false,
 whatsapp_numbers text[] not null default '{}' check(cardinality(whatsapp_numbers)<=10),
 updated_by uuid,
 updated_at timestamptz not null default now()
);

create table public.serena_messages (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 channel text not null check(channel in ('app','whatsapp')),
 user_ref text not null,              -- the user id in the app, or the phone digits on WhatsApp
 role text not null check(role in ('user','assistant')),
 content text not null check(length(content) <= 20000),
 external_id text,                    -- WhatsApp message id, so a redelivered webhook is answered once
 created_at timestamptz not null default now()
);
create index serena_messages_thread_idx on public.serena_messages(organization_id, channel, user_ref, created_at desc);
create unique index serena_messages_external_idx on public.serena_messages(organization_id, external_id) where external_id is not null;

alter table public.serena_settings enable row level security;
alter table public.serena_messages enable row level security;
revoke all on public.serena_settings, public.serena_messages from public, anon, authenticated;
grant all on public.serena_settings, public.serena_messages to service_role;
