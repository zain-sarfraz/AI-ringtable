-- Add currency column to restaurants and backfill from restaurant_settings
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS currency text DEFAULT 'USD';

UPDATE restaurants r 
SET currency = COALESCE(s.currency, 'USD') 
FROM restaurant_settings s 
WHERE s.restaurant_id = r.id AND (r.currency IS NULL OR r.currency = 'USD');
