-- Tabla de configuración de productos (Bloques y Caños)
-- Incluye tiempo de ciclo, peso y fórmula del pastón

CREATE TABLE IF NOT EXISTS product_config (
  id SERIAL PRIMARY KEY,
  
  -- Identificación del producto
  line_type TEXT NOT NULL CHECK (line_type IN ('bloques', 'caños')),
  product_code TEXT NOT NULL,
  product_name TEXT NOT NULL,
  description TEXT,
  
  -- Parámetros de producción
  cycle_time_seconds INTEGER NOT NULL DEFAULT 0,  -- Tiempo de ciclo ideal en segundos
  piece_weight_kg NUMERIC(10,3) DEFAULT 0,        -- Peso de la pieza en kg
  units_per_cycle INTEGER DEFAULT 1,              -- Unidades por ciclo (para bloques puede ser múltiple)
  
  -- Fórmula del pastón (cantidades por batch/ciclo en kg)
  formula_cement_kg NUMERIC(10,3) DEFAULT 0,
  formula_sand_kg NUMERIC(10,3) DEFAULT 0,
  formula_stone_0_10_kg NUMERIC(10,3) DEFAULT 0,
  formula_stone_0_20_kg NUMERIC(10,3) DEFAULT 0,
  formula_water_kg NUMERIC(10,3) DEFAULT 0,
  formula_additive_mark_v_kg NUMERIC(10,4) DEFAULT 0,
  formula_additive_drasell_kg NUMERIC(10,4) DEFAULT 0,
  formula_additive_1_kg NUMERIC(10,4) DEFAULT 0,
  formula_additive_2_kg NUMERIC(10,4) DEFAULT 0,
  
  -- Estado
  is_active BOOLEAN DEFAULT true,
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- Unique constraint para evitar duplicados
  UNIQUE(line_type, product_code)
);

-- Insertar productos de bloques existentes
INSERT INTO product_config (line_type, product_code, product_name, cycle_time_seconds, units_per_cycle) VALUES
  ('bloques', 'B20T', 'Bloque 20 Tradicional', 17, 5),
  ('bloques', 'B20E', 'Bloque 20 Estructural', 17, 5),
  ('bloques', 'B13', 'Bloque 13', 15, 6),
  ('bloques', 'B10', 'Bloque 10', 14, 8),
  ('bloques', 'ADQ', 'Adoquín', 16, 12)
ON CONFLICT (line_type, product_code) DO NOTHING;

-- Insertar productos de caños
INSERT INTO product_config (line_type, product_code, product_name, cycle_time_seconds, units_per_cycle) VALUES
  ('caños', 'CC300', 'Caño Ø300mm', 300, 1),
  ('caños', 'CC400', 'Caño Ø400mm', 360, 1),
  ('caños', 'CC500', 'Caño Ø500mm', 420, 1),
  ('caños', 'CC600', 'Caño Ø600mm', 480, 1),
  ('caños', 'CC800', 'Caño Ø800mm', 600, 1),
  ('caños', 'CC1000', 'Caño Ø1000mm', 720, 1),
  ('caños', 'CC1200', 'Caño Ø1200mm', 840, 1)
ON CONFLICT (line_type, product_code) DO NOTHING;

-- Índices para búsquedas frecuentes
CREATE INDEX IF NOT EXISTS idx_product_config_line_type ON product_config(line_type);
CREATE INDEX IF NOT EXISTS idx_product_config_active ON product_config(is_active);
