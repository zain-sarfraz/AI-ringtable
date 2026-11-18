-- Migration: 060_inventory_restaurant_id.sql
-- Ensure restaurant_id exists on all inventory tables for multi-tenant data isolation

ALTER TABLE inventory_categories 
  ADD COLUMN IF NOT EXISTS restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_inventory_categories_restaurant_id 
  ON inventory_categories(restaurant_id);

ALTER TABLE inventory_items 
  ADD COLUMN IF NOT EXISTS restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_inventory_items_restaurant_id 
  ON inventory_items(restaurant_id);

ALTER TABLE suppliers 
  ADD COLUMN IF NOT EXISTS restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_suppliers_restaurant_id 
  ON suppliers(restaurant_id);

ALTER TABLE purchases 
  ADD COLUMN IF NOT EXISTS restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_purchases_restaurant_id 
  ON purchases(restaurant_id);

ALTER TABLE recipes 
  ADD COLUMN IF NOT EXISTS restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_recipes_restaurant_id 
  ON recipes(restaurant_id);

ALTER TABLE stock_adjustments 
  ADD COLUMN IF NOT EXISTS restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_stock_adjustments_restaurant_id 
  ON stock_adjustments(restaurant_id);
