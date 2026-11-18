-- «Discover accounts»: for a business Google lists without a website or social pages, the platform can
-- search the web for them. What is proven (the business's own phone number appears in the result) is added
-- at once; what only looks right is kept in `discovered` for a person to accept or ignore.
--   discovered     {"website": {"url", "confidence"}, "socials": {"instagram": {"url", "confidence"}}}
--   discovered_at  when the last search ran
-- Adds two columns with empty defaults; nothing existing changes. Safe to run again.
--
-- Run this BEFORE deploying the matching code: the list reads these columns.
-- Rollback: alter table public.ob_prospects drop column if exists discovered, drop column if exists discovered_at;

alter table public.ob_prospects add column if not exists discovered jsonb not null default '{}';
alter table public.ob_prospects add column if not exists discovered_at timestamptz;
