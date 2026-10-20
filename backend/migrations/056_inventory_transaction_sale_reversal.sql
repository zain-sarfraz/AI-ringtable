-- 056: Add sale_reversal to inventory_transaction_type enum

DO $$
BEGIN
    ALTER TYPE inventory_transaction_type ADD VALUE IF NOT EXISTS 'sale_reversal';
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
