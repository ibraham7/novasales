-- Automation, step 1 (run ONCE, before the automation worker is ever switched on): marks the events that
-- have been waiting more than 6 hours as «skipped before automation». Nobody processed them, and the worker
-- ignores events that old anyway, so this only keeps the list tidy and the counts honest.
-- Nothing is deleted: the rows stay, with a note saying why they were not run. Safe to run twice.
update public.domain_events
   set workflow_status = 'done',
       workflow_error = 'تخطّي قبل تفعيل الأتمتة'
 where workflow_status = 'pending'
   and created_at < now() - interval '6 hours';
