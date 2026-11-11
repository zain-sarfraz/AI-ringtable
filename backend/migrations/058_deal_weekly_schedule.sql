-- Weekly day + daily time window for deals (in addition to starts_at / ends_at campaign dates).
-- available_days: JSON array of weekday ints 0=Sunday … 6=Saturday. Empty / null = every day.
-- available_start_time / available_end_time: local daily window. Null = all day.
ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS available_days jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS available_start_time time without time zone,
  ADD COLUMN IF NOT EXISTS available_end_time time without time zone;

COMMENT ON COLUMN public.deals.available_days IS 'Weekdays when deal is offered: 0=Sun … 6=Sat. Empty array = all days.';
COMMENT ON COLUMN public.deals.available_start_time IS 'Daily start time (local). Null = from midnight.';
COMMENT ON COLUMN public.deals.available_end_time IS 'Daily end time (local). Null = until end of day. If end < start, window crosses midnight.';
