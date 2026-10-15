import "dotenv/config";
import pg from "pg";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

await client.query(`
  ALTER TABLE public.discounts 
    ADD COLUMN IF NOT EXISTS discount_value NUMERIC(10,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS max_uses INTEGER,
    ADD COLUMN IF NOT EXISTS used_count INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS starts_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS ends_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

  ALTER TABLE public.discounts DROP CONSTRAINT IF EXISTS discounts_code_key;
  DO $$ BEGIN
    ALTER TABLE public.discounts ADD CONSTRAINT discounts_restaurant_code_unique UNIQUE (restaurant_id, code);
  EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
  END $$;

const r = await client.query(`
  SELECT column_name FROM information_schema.columns 
  WHERE table_name = 'discounts' ORDER BY ordinal_position
`);
console.log("Discounts columns now:", r.rows.map(x => x.column_name));
console.log("Discounts table fixed!");

await client.end();
