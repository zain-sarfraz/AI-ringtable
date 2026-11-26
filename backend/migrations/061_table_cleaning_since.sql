-- 061: Add cleaning_since to restaurant_tables
-- Tracks when a table was last marked for cleaning by reception.
-- NULL = not cleaning. IS NOT NULL = currently being cleaned.
-- No change to is_active or any existing column.

ALTER TABLE public.restaurant_tables
  ADD COLUMN IF NOT EXISTS cleaning_since timestamptz NULL;
