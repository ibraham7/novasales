-- Enrichment now also reads the phone numbers a business shows on its own website (tel: links,
-- schema.org telephone, numbers written after «Tel / GSM / WhatsApp / هاتف»). They are kept apart from
-- the number Google gave, as digits with the country code. Adds one column with an empty default;
-- nothing existing changes. Safe to run again.
--
-- Run this BEFORE deploying the matching code: the list reads this column.
-- Rollback: alter table public.ob_prospects drop column if exists site_phones;

alter table public.ob_prospects add column if not exists site_phones text[] not null default '{}';
