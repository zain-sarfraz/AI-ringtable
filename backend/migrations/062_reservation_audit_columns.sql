-- 062: Reservation audit columns + source extension
-- Adds nullable audit timestamps and cancel tracking.
-- source column has no CHECK constraint (confirmed from migration 040), so walk_in is already safe.

ALTER TABLE public.table_reservations
  ADD COLUMN IF NOT EXISTS seated_at      timestamptz NULL,
  ADD COLUMN IF NOT EXISTS completed_at   timestamptz NULL,
  ADD COLUMN IF NOT EXISTS cancelled_at   timestamptz NULL,
  ADD COLUMN IF NOT EXISTS cancelled_by   uuid        NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS no_show_reason text        NULL;

-- Ensure walk_in is a valid source (no constraint to drop, just safe to use from now on).
-- Ensure online and phone sources still work (they were the original defaults).
-- No action needed: source column is plain text with no CHECK constraint.
