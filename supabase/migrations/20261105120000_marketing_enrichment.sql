-- Contact details found on a business's own public website (emails, social pages, WhatsApp link).
-- Additive only: new nullable/defaulted columns on ob_prospects.
alter table public.ob_prospects
  add column if not exists emails text[] not null default '{}',
  add column if not exists socials jsonb not null default '{}'::jsonb,
  add column if not exists site_whatsapp text,
  add column if not exists enrich_status text check (enrich_status in ('done','failed','no_website')),
  add column if not exists enriched_at timestamptz,
  add column if not exists enrich_error text;
