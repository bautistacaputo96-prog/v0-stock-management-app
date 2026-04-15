-- Tabla para fórmula de pastón (por planta)
CREATE TABLE IF NOT EXISTS paston_formulas (
  id SERIAL PRIMARY KEY,
  plant TEXT NOT NULL, -- 'silke', 'mercedes', 'villa-rosa'
  
  -- Arena y piedra con proveedores
  sand_kg NUMERIC NOT NULL DEFAULT 0,
  sand_supplier TEXT,
  stone_kg NUMERIC NOT NULL DEFAULT 0,
  stone_supplier TEXT,
  
  -- Cemento
  cement_kg NUMERIC NOT NULL DEFAULT 0,
  
  -- Aditivos (tanque de 1000 litros diluido con agua)
  tank_capacity_liters NUMERIC NOT NULL DEFAULT 1000,
  additive_1_kg NUMERIC NOT NULL DEFAULT 0, -- Mark V
  additive_1_name TEXT DEFAULT 'Mark V',
  additive_2_kg NUMERIC NOT NULL DEFAULT 0, -- Darasell
  additive_2_name TEXT DEFAULT 'Darasell',
  water_in_tank_liters NUMERIC NOT NULL DEFAULT 0, -- Agua en el tanque
  
  -- Litros de aditivo diluido por pastón
  diluted_additive_per_paston_liters NUMERIC NOT NULL DEFAULT 0,
  
  -- Metadata
  modified_by TEXT NOT NULL,
  modified_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE,
  
  UNIQUE(plant, is_active) -- Solo una fórmula activa por planta
);

-- Historial de cambios en fórmulas de pastón
CREATE TABLE IF NOT EXISTS paston_formulas_history (
  id SERIAL PRIMARY KEY,
  paston_formula_id INTEGER REFERENCES paston_formulas(id),
  plant TEXT NOT NULL,
  
  -- Valores anteriores (JSONB para flexibilidad)
  previous_values JSONB,
  new_values JSONB,
  
  -- Metadata
  modified_by TEXT NOT NULL,
  modified_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  change_reason TEXT
);

-- Actualizar tabla pipe_mix_designs para agregar campos faltantes
ALTER TABLE pipe_mix_designs 
ADD COLUMN IF NOT EXISTS paston_formula_id INTEGER REFERENCES paston_formulas(id),
ADD COLUMN IF NOT EXISTS sand_supplier TEXT,
ADD COLUMN IF NOT EXISTS stone_supplier TEXT,
ADD COLUMN IF NOT EXISTS additive_1_name TEXT DEFAULT 'Mark V',
ADD COLUMN IF NOT EXISTS additive_1_kg NUMERIC,
ADD COLUMN IF NOT EXISTS additive_2_name TEXT DEFAULT 'Darasell',
ADD COLUMN IF NOT EXISTS additive_2_kg NUMERIC;

-- Crear índices
CREATE INDEX IF NOT EXISTS idx_paston_formulas_plant ON paston_formulas(plant);
CREATE INDEX IF NOT EXISTS idx_paston_formulas_active ON paston_formulas(is_active);
CREATE INDEX IF NOT EXISTS idx_pipe_mix_designs_plant ON pipe_mix_designs(plant);

-- Insertar operarios predefinidos si no existe la tabla
CREATE TABLE IF NOT EXISTS formuleo_operators (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insertar operarios iniciales
INSERT INTO formuleo_operators (name) VALUES 
  ('Emanuel Perez'),
  ('Bautista Caputo')
ON CONFLICT (name) DO NOTHING;
