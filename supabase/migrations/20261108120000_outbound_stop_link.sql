-- A private stop link per outbound recipient, and «link» as a source of a do-not-send number.
alter table public.cmp_recipients add column if not exists stop_token text;
create unique index if not exists cmp_recipients_stop_token on public.cmp_recipients(stop_token) where stop_token is not null;

alter table public.ob_suppressions drop constraint if exists ob_suppressions_source_check;
alter table public.ob_suppressions add constraint ob_suppressions_source_check check(source in ('manual','keyword','import','link'));
