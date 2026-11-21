-- Automation, step 3: the master switch for staff alerts, next to the one for customer messages.
-- OFF for every organization until someone turns it on, so no automatic alert reaches anyone by itself.
-- Needs 20261121130000_automation_send_log.sql first. Safe to run twice; sends nothing.
alter table public.wf_settings add column if not exists alerts_enabled boolean not null default false;
