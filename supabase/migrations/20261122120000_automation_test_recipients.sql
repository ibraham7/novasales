-- Automation, safety: an optional list of the ONLY numbers / emails automatic messages may go to («وضع التجربة»).
-- Empty (the default) = no restriction. When it has entries, every other recipient is skipped with a reason.
-- Needs 20261121130000_automation_send_log.sql first. Safe to run twice; sends nothing.
alter table public.wf_settings add column if not exists test_recipients text[] not null default '{}';
