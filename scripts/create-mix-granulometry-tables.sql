-- Tabla para ensayos de granulometría de mezcla (arena + piedra)
-- Para optimización de curva Fuller en caños de hormigón

-- Ensayos de granulometría por árido individual
CREATE TABLE IF NOT EXISTS mix_granulometry_tests (
  id SERIAL PRIMARY KEY,
  test_date DATE NOT NULL DEFAULT CURRENT_DATE,
  plant VARCHAR(50) NOT NULL, -- 'mercedes', 'villa_rosa', 'ranchos'
  material_type VARCHAR(50) NOT NULL, -- 'arena', 'piedra'
  supplier_id INTEGER REFERENCES suppliers(id),
  supplier_name TEXT,
  
  -- Pesos de muestra
  wet_weight_g NUMERIC(10,2), -- Peso húmedo
  dry_weight_g NUMERIC(10,2), -- Peso seco
  humidity_percent NUMERIC(5,2), -- Calculado: (PH-PS)/PS*100
  
  -- Masas retenidas por tamiz (en gramos)
  sieve_19000 NUMERIC(10,2) DEFAULT 0, -- 19 mm
  sieve_12500 NUMERIC(10,2) DEFAULT 0, -- 12.5 mm
  sieve_9500 NUMERIC(10,2) DEFAULT 0,  -- 9.5 mm
  sieve_4750 NUMERIC(10,2) DEFAULT 0,  -- 4.75 mm
  sieve_2360 NUMERIC(10,2) DEFAULT 0,  -- 2.36 mm
  sieve_1180 NUMERIC(10,2) DEFAULT 0,  -- 1.18 mm
  sieve_600 NUMERIC(10,2) DEFAULT 0,   -- 0.60 mm
  sieve_300 NUMERIC(10,2) DEFAULT 0,   -- 0.30 mm
  sieve_150 NUMERIC(10,2) DEFAULT 0,   -- 0.15 mm
  sieve_pan NUMERIC(10,2) DEFAULT 0,   -- Fondo
  
  -- Calculados
  fineness_modulus NUMERIC(5,2), -- Módulo de finura (solo arena)
  
  -- Metadatos
  remito_number TEXT,
  tested_by TEXT,
  observations TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla para análisis de mezcla (combina arena + piedra)
CREATE TABLE IF NOT EXISTS mix_analysis (
  id SERIAL PRIMARY KEY,
  analysis_date DATE NOT NULL DEFAULT CURRENT_DATE,
  plant VARCHAR(50) NOT NULL,
  
  -- Referencias a ensayos individuales
  sand_test_id INTEGER REFERENCES mix_granulometry_tests(id),
  stone_test_id INTEGER REFERENCES mix_granulometry_tests(id),
  
  -- Proporciones de mezcla actual
  sand_proportion NUMERIC(5,2) NOT NULL, -- % de arena (0-100)
  stone_proportion NUMERIC(5,2) NOT NULL, -- % de piedra (0-100)
  
  -- TMA según planta (9.5 mm para Mercedes/Silke, 19 mm para Villa Rosa)
  tma_mm NUMERIC(5,2) NOT NULL,
  
  -- Resultados calculados
  rms_current NUMERIC(6,3), -- RMS de mezcla actual vs Fuller
  rms_optimal NUMERIC(6,3), -- RMS de mezcla óptima vs Fuller
  optimal_sand_proportion NUMERIC(5,2), -- Proporción óptima sugerida
  optimal_stone_proportion NUMERIC(5,2),
  
  -- Clasificación
  classification VARCHAR(20), -- 'optimo', 'aceptable', 'fuera_rango'
  
  -- Indicadores
  sand_mf_status VARCHAR(20), -- 'rojo', 'naranja', 'amarillo', 'verde'
  stone_fines_status VARCHAR(20), -- 'verde', 'amarillo', 'rojo'
  
  -- Análisis técnico automático (texto generado)
  technical_analysis TEXT,
  
  observations TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para búsquedas frecuentes
CREATE INDEX IF NOT EXISTS idx_mix_gran_plant_date ON mix_granulometry_tests(plant, test_date DESC);
CREATE INDEX IF NOT EXISTS idx_mix_gran_supplier ON mix_granulometry_tests(supplier_id);
CREATE INDEX IF NOT EXISTS idx_mix_analysis_plant_date ON mix_analysis(plant, analysis_date DESC);
