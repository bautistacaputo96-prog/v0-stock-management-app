-- Update pipe_production table to match the PDF form structure
-- Adding missing columns for production details

-- Add CC300 units column (missing from current schema)
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS cc300_units INTEGER DEFAULT 0;

-- Add production breakdown columns (Simples, Rotura, Armado, Rotura Armado) for each size
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS cc300_simples INTEGER DEFAULT 0;
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS cc300_rotura INTEGER DEFAULT 0;
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS cc300_armado INTEGER DEFAULT 0;
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS cc300_rotura_armado INTEGER DEFAULT 0;

ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS cc400_simples INTEGER DEFAULT 0;
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS cc400_rotura INTEGER DEFAULT 0;
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS cc400_armado INTEGER DEFAULT 0;
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS cc400_rotura_armado INTEGER DEFAULT 0;

ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS cc500_simples INTEGER DEFAULT 0;
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS cc500_rotura INTEGER DEFAULT 0;
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS cc500_armado INTEGER DEFAULT 0;
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS cc500_rotura_armado INTEGER DEFAULT 0;

ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS cc600_simples INTEGER DEFAULT 0;
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS cc600_rotura INTEGER DEFAULT 0;
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS cc600_armado INTEGER DEFAULT 0;
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS cc600_rotura_armado INTEGER DEFAULT 0;

ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS cc800_simples INTEGER DEFAULT 0;
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS cc800_rotura INTEGER DEFAULT 0;
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS cc800_armado INTEGER DEFAULT 0;
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS cc800_rotura_armado INTEGER DEFAULT 0;

ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS cc1000_simples INTEGER DEFAULT 0;
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS cc1000_rotura INTEGER DEFAULT 0;
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS cc1000_armado INTEGER DEFAULT 0;
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS cc1000_rotura_armado INTEGER DEFAULT 0;

ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS cc1200_simples INTEGER DEFAULT 0;
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS cc1200_rotura INTEGER DEFAULT 0;
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS cc1200_armado INTEGER DEFAULT 0;
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS cc1200_rotura_armado INTEGER DEFAULT 0;

-- Transport to yard columns (Transporte a Playa)
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS transport_cc300_simples INTEGER DEFAULT 0;
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS transport_cc300_rotura INTEGER DEFAULT 0;
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS transport_cc300_armado INTEGER DEFAULT 0;
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS transport_cc300_rotura_armado INTEGER DEFAULT 0;

ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS transport_cc400_simples INTEGER DEFAULT 0;
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS transport_cc400_rotura INTEGER DEFAULT 0;
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS transport_cc400_armado INTEGER DEFAULT 0;
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS transport_cc400_rotura_armado INTEGER DEFAULT 0;

ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS transport_cc500_simples INTEGER DEFAULT 0;
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS transport_cc500_rotura INTEGER DEFAULT 0;
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS transport_cc500_armado INTEGER DEFAULT 0;
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS transport_cc500_rotura_armado INTEGER DEFAULT 0;

ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS transport_cc600_simples INTEGER DEFAULT 0;
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS transport_cc600_rotura INTEGER DEFAULT 0;
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS transport_cc600_armado INTEGER DEFAULT 0;
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS transport_cc600_rotura_armado INTEGER DEFAULT 0;

ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS transport_cc800_simples INTEGER DEFAULT 0;
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS transport_cc800_rotura INTEGER DEFAULT 0;
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS transport_cc800_armado INTEGER DEFAULT 0;
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS transport_cc800_rotura_armado INTEGER DEFAULT 0;

ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS transport_cc1000_simples INTEGER DEFAULT 0;
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS transport_cc1000_rotura INTEGER DEFAULT 0;
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS transport_cc1000_armado INTEGER DEFAULT 0;
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS transport_cc1000_rotura_armado INTEGER DEFAULT 0;

ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS transport_cc1200_simples INTEGER DEFAULT 0;
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS transport_cc1200_rotura INTEGER DEFAULT 0;
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS transport_cc1200_armado INTEGER DEFAULT 0;
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS transport_cc1200_rotura_armado INTEGER DEFAULT 0;

-- Dosification columns
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS additive_1_kg NUMERIC(10,2) DEFAULT 0;
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS additive_2_kg NUMERIC(10,2) DEFAULT 0;

-- Additional fields from PDF
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS cleaning_minutes INTEGER DEFAULT 0;
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS tpr_minutes INTEGER DEFAULT 0;
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS cement_final_shift_tn NUMERIC(10,2);
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS scrap_percentage NUMERIC(5,2) DEFAULT 0;
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS observations TEXT;

-- Operators
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS palletizer_2 TEXT;

-- Add minutes column to pipe_downtime if not exists
ALTER TABLE pipe_downtime ADD COLUMN IF NOT EXISTS minutes INTEGER DEFAULT 0;
