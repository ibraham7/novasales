-- A campaign can send slowly over the hours of each day: {dailyLimit, windowStart, windowEnd, timezone, ramp}.
-- Empty means the campaign sends at its per-minute limit, as before. Additive and nullable.
alter table public.cmp_campaigns add column if not exists send_schedule jsonb;
