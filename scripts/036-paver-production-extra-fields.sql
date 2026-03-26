-- Add daily tables count, wet piece weight, and palletizing fields to paver_production
ALTER TABLE paver_production ADD COLUMN IF NOT EXISTS tables_produced integer DEFAULT 0;
ALTER TABLE paver_production ADD COLUMN IF NOT EXISTS wet_piece_weight_kg numeric(8,3) DEFAULT NULL;
ALTER TABLE paver_production ADD COLUMN IF NOT EXISTS palletized_first integer DEFAULT 0;
ALTER TABLE paver_production ADD COLUMN IF NOT EXISTS palletized_second integer DEFAULT 0;
