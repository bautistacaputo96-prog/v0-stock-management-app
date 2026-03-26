-- Add dosage and operator fields to block_production table
ALTER TABLE block_production
ADD COLUMN IF NOT EXISTS cement_kg DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS sand_kg DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS stone_0_10_kg DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS stone_0_20_kg DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS water_kg DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS fresh_racks INTEGER,
ADD COLUMN IF NOT EXISTS machine_operator TEXT,
ADD COLUMN IF NOT EXISTS internal_driver TEXT,
ADD COLUMN IF NOT EXISTS palletizer_1 TEXT;

-- Add minutes field to block_downtime table for tracking downtime duration per reason
ALTER TABLE block_downtime
ADD COLUMN IF NOT EXISTS minutes INTEGER DEFAULT 0;

-- Add dosage and operator fields to pipe_production table
ALTER TABLE pipe_production
ADD COLUMN IF NOT EXISTS cement_kg DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS sand_kg DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS stone_0_10_kg DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS stone_0_20_kg DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS water_kg DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS fresh_racks INTEGER,
ADD COLUMN IF NOT EXISTS machine_operator TEXT,
ADD COLUMN IF NOT EXISTS internal_driver TEXT,
ADD COLUMN IF NOT EXISTS palletizer_1 TEXT;

-- Add minutes field to pipe_downtime table
ALTER TABLE pipe_downtime
ADD COLUMN IF NOT EXISTS minutes INTEGER DEFAULT 0;
