-- Archive for discovered businesses: a business can be put away without deleting it. An archived
-- business keeps its status and notes, is hidden from the working list, and is left out of every
-- campaign audience; it can be restored at any time.
-- Adds one nullable column and one index; nothing existing changes. Safe to run again.
--
-- Run this BEFORE deploying the matching code: the list reads this column.
-- Rollback: alter table public.ob_prospects drop column if exists archived_at;

alter table public.ob_prospects add column if not exists archived_at timestamptz;
create index if not exists ob_prospects_archived_idx on public.ob_prospects(organization_id, archived_at);
