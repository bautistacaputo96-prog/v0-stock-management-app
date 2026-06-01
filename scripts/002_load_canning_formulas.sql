-- Load all Canning formulas from the PDF
-- First, get the Canning plant_id
DO $$
DECLARE
  canning_plant_id UUID;
  
  -- Material IDs (we'll need to reference these)
  mat_cpc40 UUID;
  mat_arena_fina UUID;
  mat_arena_triturada UUID;
  mat_piedra_620 UUID;
  mat_piedra_612 UUID;
  mat_piedra_1030 UUID;
  mat_agua UUID;
  mat_sikament90e UUID;
  mat_sikament33s UUID;
  mat_daraset282 UUID;
  mat_espumigeno UUID;
  mat_perlitas UUID;
  
  -- Formula IDs
  formula_id UUID;
BEGIN
  -- Get Canning plant ID
  SELECT id INTO canning_plant_id FROM plants WHERE code = 'CAN';
  
  -- Get or create materials for Canning plant
  INSERT INTO materials (name, unit, plant_id, current_stock, min_stock) VALUES
    ('CPC 40', 'kg', canning_plant_id, 0, 5000)
  ON CONFLICT DO NOTHING
  RETURNING id INTO mat_cpc40;
  IF mat_cpc40 IS NULL THEN SELECT id INTO mat_cpc40 FROM materials WHERE name = 'CPC 40' AND plant_id = canning_plant_id; END IF;
  
  INSERT INTO materials (name, unit, plant_id, current_stock, min_stock) VALUES
    ('Arena Fina', 'kg', canning_plant_id, 0, 10000)
  ON CONFLICT DO NOTHING
  RETURNING id INTO mat_arena_fina;
  IF mat_arena_fina IS NULL THEN SELECT id INTO mat_arena_fina FROM materials WHERE name = 'Arena Fina' AND plant_id = canning_plant_id; END IF;
  
  INSERT INTO materials (name, unit, plant_id, current_stock, min_stock) VALUES
    ('Arena Trituración 0/6', 'kg', canning_plant_id, 0, 10000)
  ON CONFLICT DO NOTHING
  RETURNING id INTO mat_arena_triturada;
  IF mat_arena_triturada IS NULL THEN SELECT id INTO mat_arena_triturada FROM materials WHERE name = 'Arena Trituración 0/6' AND plant_id = canning_plant_id; END IF;
  
  INSERT INTO materials (name, unit, plant_id, current_stock, min_stock) VALUES
    ('Piedra Partida 6/20', 'kg', canning_plant_id, 0, 15000)
  ON CONFLICT DO NOTHING
  RETURNING id INTO mat_piedra_620;
  IF mat_piedra_620 IS NULL THEN SELECT id INTO mat_piedra_620 FROM materials WHERE name = 'Piedra Partida 6/20' AND plant_id = canning_plant_id; END IF;
  
  INSERT INTO materials (name, unit, plant_id, current_stock, min_stock) VALUES
    ('Piedra Partida 6/12', 'kg', canning_plant_id, 0, 15000)
  ON CONFLICT DO NOTHING
  RETURNING id INTO mat_piedra_612;
  IF mat_piedra_612 IS NULL THEN SELECT id INTO mat_piedra_612 FROM materials WHERE name = 'Piedra Partida 6/12' AND plant_id = canning_plant_id; END IF;
  
  INSERT INTO materials (name, unit, plant_id, current_stock, min_stock) VALUES
    ('Piedra Partida 10/30', 'kg', canning_plant_id, 0, 15000)
  ON CONFLICT DO NOTHING
  RETURNING id INTO mat_piedra_1030;
  IF mat_piedra_1030 IS NULL THEN SELECT id INTO mat_piedra_1030 FROM materials WHERE name = 'Piedra Partida 10/30' AND plant_id = canning_plant_id; END IF;
  
  INSERT INTO materials (name, unit, plant_id, current_stock, min_stock) VALUES
    ('Agua', 'kg', canning_plant_id, 0, 5000)
  ON CONFLICT DO NOTHING
  RETURNING id INTO mat_agua;
  IF mat_agua IS NULL THEN SELECT id INTO mat_agua FROM materials WHERE name = 'Agua' AND plant_id = canning_plant_id; END IF;
  
  INSERT INTO materials (name, unit, plant_id, current_stock, min_stock) VALUES
    ('Sikament 90E', 'kg', canning_plant_id, 0, 500)
  ON CONFLICT DO NOTHING
  RETURNING id INTO mat_sikament90e;
  IF mat_sikament90e IS NULL THEN SELECT id INTO mat_sikament90e FROM materials WHERE name = 'Sikament 90E' AND plant_id = canning_plant_id; END IF;
  
  INSERT INTO materials (name, unit, plant_id, current_stock, min_stock) VALUES
    ('Sikament 33S', 'kg', canning_plant_id, 0, 500)
  ON CONFLICT DO NOTHING
  RETURNING id INTO mat_sikament33s;
  IF mat_sikament33s IS NULL THEN SELECT id INTO mat_sikament33s FROM materials WHERE name = 'Sikament 33S' AND plant_id = canning_plant_id; END IF;
  
  INSERT INTO materials (name, unit, plant_id, current_stock, min_stock) VALUES
    ('Daraset 282', 'kg', canning_plant_id, 0, 200)
  ON CONFLICT DO NOTHING
  RETURNING id INTO mat_daraset282;
  IF mat_daraset282 IS NULL THEN SELECT id INTO mat_daraset282 FROM materials WHERE name = 'Daraset 282' AND plant_id = canning_plant_id; END IF;
  
  INSERT INTO materials (name, unit, plant_id, current_stock, min_stock) VALUES
    ('Espumigeno', 'kg', canning_plant_id, 0, 100)
  ON CONFLICT DO NOTHING
  RETURNING id INTO mat_espumigeno;
  IF mat_espumigeno IS NULL THEN SELECT id INTO mat_espumigeno FROM materials WHERE name = 'Espumigeno' AND plant_id = canning_plant_id; END IF;
  
  INSERT INTO materials (name, unit, plant_id, current_stock, min_stock) VALUES
    ('Perlitas EPS', 'bolsas', canning_plant_id, 0, 50)
  ON CONFLICT DO NOTHING
  RETURNING id INTO mat_perlitas;
  IF mat_perlitas IS NULL THEN SELECT id INTO mat_perlitas FROM materials WHERE name = 'Perlitas EPS' AND plant_id = canning_plant_id; END IF;
  
  -- H13-620-10 C
  INSERT INTO formulas (code, name, description, plant_id, yield_m3) VALUES
    ('H13-620-10 C', 'H13-6/20-10 C', 'Hormigón H13 para estructuras simples, descarga directa', canning_plant_id, 1.0)
  ON CONFLICT DO NOTHING
  RETURNING id INTO formula_id;
  IF formula_id IS NULL THEN SELECT id INTO formula_id FROM formulas WHERE code = 'H13-620-10 C' AND plant_id = canning_plant_id; END IF;
  
  INSERT INTO formula_materials (formula_id, material_id, quantity) VALUES
    (formula_id, mat_cpc40, 210),
    (formula_id, mat_arena_fina, 739),
    (formula_id, mat_arena_triturada, 246),
    (formula_id, mat_piedra_620, 995),
    (formula_id, mat_agua, 165),
    (formula_id, mat_sikament90e, 1.79),
    (formula_id, mat_sikament33s, 0.63)
  ON CONFLICT DO NOTHING;
  
  -- H17-620-10 C
  INSERT INTO formulas (code, name, description, plant_id, yield_m3) VALUES
    ('H17-620-10 C', 'H17-6/20-10 C', 'Hormigón H17 para estructuras simples, descarga directa', canning_plant_id, 1.0)
  ON CONFLICT DO NOTHING
  RETURNING id INTO formula_id;
  IF formula_id IS NULL THEN SELECT id INTO formula_id FROM formulas WHERE code = 'H17-620-10 C' AND plant_id = canning_plant_id; END IF;
  
  INSERT INTO formula_materials (formula_id, material_id, quantity) VALUES
    (formula_id, mat_cpc40, 245),
    (formula_id, mat_arena_fina, 728),
    (formula_id, mat_arena_triturada, 243),
    (formula_id, mat_piedra_620, 975),
    (formula_id, mat_agua, 168),
    (formula_id, mat_sikament90e, 2.08),
    (formula_id, mat_sikament33s, 0.74)
  ON CONFLICT DO NOTHING;
  
  -- H21-620-10 C
  INSERT INTO formulas (code, name, description, plant_id, yield_m3) VALUES
    ('H21-620-10 C', 'H21-6/20-10 C', 'Hormigón H21 para estructuras simples, descarga directa', canning_plant_id, 1.0)
  ON CONFLICT DO NOTHING
  RETURNING id INTO formula_id;
  IF formula_id IS NULL THEN SELECT id INTO formula_id FROM formulas WHERE code = 'H21-620-10 C' AND plant_id = canning_plant_id; END IF;
  
  INSERT INTO formula_materials (formula_id, material_id, quantity) VALUES
    (formula_id, mat_cpc40, 245),
    (formula_id, mat_arena_fina, 735),
    (formula_id, mat_arena_triturada, 245),
    (formula_id, mat_piedra_620, 990),
    (formula_id, mat_agua, 160),
    (formula_id, mat_sikament90e, 2.08),
    (formula_id, mat_sikament33s, 0.74)
  ON CONFLICT DO NOTHING;
  
  -- H21-620-15 B
  INSERT INTO formulas (code, name, description, plant_id, yield_m3) VALUES
    ('H21-620-15 B', 'H21-6/20-15 B', 'Hormigón H21 para bombear', canning_plant_id, 1.0)
  ON CONFLICT DO NOTHING
  RETURNING id INTO formula_id;
  IF formula_id IS NULL THEN SELECT id INTO formula_id FROM formulas WHERE code = 'H21-620-15 B' AND plant_id = canning_plant_id; END IF;
  
  INSERT INTO formula_materials (formula_id, material_id, quantity) VALUES
    (formula_id, mat_cpc40, 265),
    (formula_id, mat_arena_fina, 720),
    (formula_id, mat_arena_triturada, 240),
    (formula_id, mat_piedra_620, 970),
    (formula_id, mat_agua, 170),
    (formula_id, mat_sikament90e, 2.25),
    (formula_id, mat_sikament33s, 0.80)
  ON CONFLICT DO NOTHING;
  
  -- H21-612-10 C
  INSERT INTO formulas (code, name, description, plant_id, yield_m3) VALUES
    ('H21-612-10 C', 'H21-6/12-10 C', 'Hormigón H21 para estructuras simples, descarga directa. Piedra chica', canning_plant_id, 1.0)
  ON CONFLICT DO NOTHING
  RETURNING id INTO formula_id;
  IF formula_id IS NULL THEN SELECT id INTO formula_id FROM formulas WHERE code = 'H21-612-10 C' AND plant_id = canning_plant_id; END IF;
  
  INSERT INTO formula_materials (formula_id, material_id, quantity) VALUES
    (formula_id, mat_cpc40, 255),
    (formula_id, mat_arena_fina, 686),
    (formula_id, mat_arena_triturada, 294),
    (formula_id, mat_piedra_612, 970),
    (formula_id, mat_agua, 165),
    (formula_id, mat_sikament90e, 2.17),
    (formula_id, mat_sikament33s, 0.77)
  ON CONFLICT DO NOTHING;
  
  -- H21-612-15 B
  INSERT INTO formulas (code, name, description, plant_id, yield_m3) VALUES
    ('H21-612-15 B', 'H21-6/12-15 B', 'Hormigón H21 para bombear piedra 6/12', canning_plant_id, 1.0)
  ON CONFLICT DO NOTHING
  RETURNING id INTO formula_id;
  IF formula_id IS NULL THEN SELECT id INTO formula_id FROM formulas WHERE code = 'H21-612-15 B' AND plant_id = canning_plant_id; END IF;
  
  INSERT INTO formula_materials (formula_id, material_id, quantity) VALUES
    (formula_id, mat_cpc40, 275),
    (formula_id, mat_arena_fina, 716.3),
    (formula_id, mat_arena_triturada, 238.8),
    (formula_id, mat_piedra_612, 965),
    (formula_id, mat_agua, 170),
    (formula_id, mat_sikament90e, 2.34),
    (formula_id, mat_sikament33s, 0.83)
  ON CONFLICT DO NOTHING;
  
  -- H25-620-10 C
  INSERT INTO formulas (code, name, description, plant_id, yield_m3) VALUES
    ('H25-620-10 C', 'H25-6/20-10 C', 'Hormigón H25 para estructuras simples, descarga directa', canning_plant_id, 1.0)
  ON CONFLICT DO NOTHING
  RETURNING id INTO formula_id;
  IF formula_id IS NULL THEN SELECT id INTO formula_id FROM formulas WHERE code = 'H25-620-10 C' AND plant_id = canning_plant_id; END IF;
  
  INSERT INTO formula_materials (formula_id, material_id, quantity) VALUES
    (formula_id, mat_cpc40, 275),
    (formula_id, mat_arena_fina, 739.5),
    (formula_id, mat_arena_triturada, 246.5),
    (formula_id, mat_piedra_620, 960),
    (formula_id, mat_agua, 160),
    (formula_id, mat_sikament90e, 2.34),
    (formula_id, mat_sikament33s, 0.83)
  ON CONFLICT DO NOTHING;
  
  -- H25-620-15 B
  INSERT INTO formulas (code, name, description, plant_id, yield_m3) VALUES
    ('H25-620-15 B', 'H25-6/20-15 B', 'Hormigón H25 para bombeo', canning_plant_id, 1.0)
  ON CONFLICT DO NOTHING
  RETURNING id INTO formula_id;
  IF formula_id IS NULL THEN SELECT id INTO formula_id FROM formulas WHERE code = 'H25-620-15 B' AND plant_id = canning_plant_id; END IF;
  
  INSERT INTO formula_materials (formula_id, material_id, quantity) VALUES
    (formula_id, mat_cpc40, 275),
    (formula_id, mat_arena_fina, 720),
    (formula_id, mat_arena_triturada, 240),
    (formula_id, mat_piedra_620, 960),
    (formula_id, mat_agua, 170),
    (formula_id, mat_sikament90e, 2.34),
    (formula_id, mat_sikament33s, 0.83)
  ON CONFLICT DO NOTHING;
  
  -- H25-612-10 C
  INSERT INTO formulas (code, name, description, plant_id, yield_m3) VALUES
    ('H25-612-10 C', 'H25-6/12-10 C', 'Hormigón H25 para estructuras simples, descarga directa', canning_plant_id, 1.0)
  ON CONFLICT DO NOTHING
  RETURNING id INTO formula_id;
  IF formula_id IS NULL THEN SELECT id INTO formula_id FROM formulas WHERE code = 'H25-612-10 C' AND plant_id = canning_plant_id; END IF;
  
  INSERT INTO formula_materials (formula_id, material_id, quantity) VALUES
    (formula_id, mat_cpc40, 290),
    (formula_id, mat_arena_fina, 716.3),
    (formula_id, mat_arena_triturada, 238.8),
    (formula_id, mat_piedra_612, 965),
    (formula_id, mat_agua, 165),
    (formula_id, mat_sikament90e, 2.47),
    (formula_id, mat_sikament33s, 0.87)
  ON CONFLICT DO NOTHING;
  
  -- H25-612-15 B
  INSERT INTO formulas (code, name, description, plant_id, yield_m3) VALUES
    ('H25-612-15 B', 'H25-6/12-15 B', 'Hormigón H25 para bombeo', canning_plant_id, 1.0)
  ON CONFLICT DO NOTHING
  RETURNING id INTO formula_id;
  IF formula_id IS NULL THEN SELECT id INTO formula_id FROM formulas WHERE code = 'H25-612-15 B' AND plant_id = canning_plant_id; END IF;
  
  INSERT INTO formula_materials (formula_id, material_id, quantity) VALUES
    (formula_id, mat_cpc40, 300),
    (formula_id, mat_arena_fina, 710.3),
    (formula_id, mat_arena_triturada, 236.8),
    (formula_id, mat_piedra_612, 950),
    (formula_id, mat_agua, 170),
    (formula_id, mat_sikament90e, 2.55),
    (formula_id, mat_sikament33s, 0.90)
  ON CONFLICT DO NOTHING;
  
  -- H30-620-10 C
  INSERT INTO formulas (code, name, description, plant_id, yield_m3) VALUES
    ('H30-620-10 C', 'H30-6/20-10 C', 'Hormigón H30 para estructuras simples, descarga directa', canning_plant_id, 1.0)
  ON CONFLICT DO NOTHING
  RETURNING id INTO formula_id;
  IF formula_id IS NULL THEN SELECT id INTO formula_id FROM formulas WHERE code = 'H30-620-10 C' AND plant_id = canning_plant_id; END IF;
  
  INSERT INTO formula_materials (formula_id, material_id, quantity) VALUES
    (formula_id, mat_cpc40, 310),
    (formula_id, mat_arena_fina, 705),
    (formula_id, mat_arena_triturada, 235),
    (formula_id, mat_piedra_620, 970),
    (formula_id, mat_agua, 165),
    (formula_id, mat_sikament90e, 2.64),
    (formula_id, mat_sikament33s, 0.93)
  ON CONFLICT DO NOTHING;
  
  -- H30-620-15 B
  INSERT INTO formulas (code, name, description, plant_id, yield_m3) VALUES
    ('H30-620-15 B', 'H30-6/20-15 B', 'Hormigón H30 para bombeo', canning_plant_id, 1.0)
  ON CONFLICT DO NOTHING
  RETURNING id INTO formula_id;
  IF formula_id IS NULL THEN SELECT id INTO formula_id FROM formulas WHERE code = 'H30-620-15 B' AND plant_id = canning_plant_id; END IF;
  
  INSERT INTO formula_materials (formula_id, material_id, quantity) VALUES
    (formula_id, mat_cpc40, 320),
    (formula_id, mat_arena_fina, 694),
    (formula_id, mat_arena_triturada, 231),
    (formula_id, mat_piedra_620, 950),
    (formula_id, mat_agua, 168),
    (formula_id, mat_sikament90e, 2.72),
    (formula_id, mat_sikament33s, 0.96)
  ON CONFLICT DO NOTHING;
  
  -- H30-612-10 C
  INSERT INTO formulas (code, name, description, plant_id, yield_m3) VALUES
    ('H30-612-10 C', 'H30-6/12-10 C', 'Hormigón H30 para estructuras simples, descarga directa', canning_plant_id, 1.0)
  ON CONFLICT DO NOTHING
  RETURNING id INTO formula_id;
  IF formula_id IS NULL THEN SELECT id INTO formula_id FROM formulas WHERE code = 'H30-612-10 C' AND plant_id = canning_plant_id; END IF;
  
  INSERT INTO formula_materials (formula_id, material_id, quantity) VALUES
    (formula_id, mat_cpc40, 320),
    (formula_id, mat_arena_fina, 705),
    (formula_id, mat_arena_triturada, 228),
    (formula_id, mat_piedra_612, 960),
    (formula_id, mat_agua, 165),
    (formula_id, mat_sikament90e, 2.72),
    (formula_id, mat_sikament33s, 0.96)
  ON CONFLICT DO NOTHING;
  
  -- H30-612-15 B
  INSERT INTO formulas (code, name, description, plant_id, yield_m3) VALUES
    ('H30-612-15 B', 'H30-6/12-15 B', 'Hormigón H30 para bombeo', canning_plant_id, 1.0)
  ON CONFLICT DO NOTHING
  RETURNING id INTO formula_id;
  IF formula_id IS NULL THEN SELECT id INTO formula_id FROM formulas WHERE code = 'H30-612-15 B' AND plant_id = canning_plant_id; END IF;
  
  INSERT INTO formula_materials (formula_id, material_id, quantity) VALUES
    (formula_id, mat_cpc40, 330),
    (formula_id, mat_arena_fina, 694),
    (formula_id, mat_arena_triturada, 231),
    (formula_id, mat_piedra_612, 950),
    (formula_id, mat_agua, 168),
    (formula_id, mat_sikament90e, 2.81),
    (formula_id, mat_sikament33s, 0.99)
  ON CONFLICT DO NOTHING;
  
  -- H40-620-10 C
  INSERT INTO formulas (code, name, description, plant_id, yield_m3) VALUES
    ('H40-620-10 C', 'H40-6/20-10 C', 'Hormigón H40 para estructuras simples, descarga directa', canning_plant_id, 1.0)
  ON CONFLICT DO NOTHING
  RETURNING id INTO formula_id;
  IF formula_id IS NULL THEN SELECT id INTO formula_id FROM formulas WHERE code = 'H40-620-10 C' AND plant_id = canning_plant_id; END IF;
  
  INSERT INTO formula_materials (formula_id, material_id, quantity) VALUES
    (formula_id, mat_cpc40, 380),
    (formula_id, mat_arena_fina, 645),
    (formula_id, mat_arena_triturada, 215),
    (formula_id, mat_piedra_620, 975),
    (formula_id, mat_agua, 168),
    (formula_id, mat_sikament90e, 3.23),
    (formula_id, mat_sikament33s, 1.14)
  ON CONFLICT DO NOTHING;
  
  -- H40-620-15 B
  INSERT INTO formulas (code, name, description, plant_id, yield_m3) VALUES
    ('H40-620-15 B', 'H40-6/20-15 B', 'Hormigón H40 para descarga directa o bombeado', canning_plant_id, 1.0)
  ON CONFLICT DO NOTHING
  RETURNING id INTO formula_id;
  IF formula_id IS NULL THEN SELECT id INTO formula_id FROM formulas WHERE code = 'H40-620-15 B' AND plant_id = canning_plant_id; END IF;
  
  INSERT INTO formula_materials (formula_id, material_id, quantity) VALUES
    (formula_id, mat_cpc40, 390),
    (formula_id, mat_arena_fina, 640),
    (formula_id, mat_arena_triturada, 215),
    (formula_id, mat_piedra_620, 965),
    (formula_id, mat_agua, 170),
    (formula_id, mat_sikament90e, 3.32),
    (formula_id, mat_sikament33s, 1.17)
  ON CONFLICT DO NOTHING;
  
  -- H30-GUN (Gunitado)
  INSERT INTO formulas (code, name, description, plant_id, yield_m3) VALUES
    ('H30-GUN', 'H30-GUN', 'Hormigón para gunitado', canning_plant_id, 1.0)
  ON CONFLICT DO NOTHING
  RETURNING id INTO formula_id;
  IF formula_id IS NULL THEN SELECT id INTO formula_id FROM formulas WHERE code = 'H30-GUN' AND plant_id = canning_plant_id; END IF;
  
  INSERT INTO formula_materials (formula_id, material_id, quantity) VALUES
    (formula_id, mat_cpc40, 400),
    (formula_id, mat_arena_fina, 1008),
    (formula_id, mat_arena_triturada, 112),
    (formula_id, mat_piedra_612, 690),
    (formula_id, mat_agua, 170),
    (formula_id, mat_sikament90e, 3.40),
    (formula_id, mat_sikament33s, 1.20)
  ON CONFLICT DO NOTHING;
  
  -- RDC-200
  INSERT INTO formulas (code, name, description, plant_id, yield_m3) VALUES
    ('RDC-200', 'RDC-200', 'Relleno densidad controlada - 200', canning_plant_id, 1.0)
  ON CONFLICT DO NOTHING
  RETURNING id INTO formula_id;
  IF formula_id IS NULL THEN SELECT id INTO formula_id FROM formulas WHERE code = 'RDC-200' AND plant_id = canning_plant_id; END IF;
  
  INSERT INTO formula_materials (formula_id, material_id, quantity) VALUES
    (formula_id, mat_cpc40, 200),
    (formula_id, mat_arena_fina, 1400),
    (formula_id, mat_agua, 170),
    (formula_id, mat_espumigeno, 0.60)
  ON CONFLICT DO NOTHING;
  
  -- RDC-300
  INSERT INTO formulas (code, name, description, plant_id, yield_m3) VALUES
    ('RDC-300', 'RDC-300', 'Relleno densidad controlada - 300', canning_plant_id, 1.0)
  ON CONFLICT DO NOTHING
  RETURNING id INTO formula_id;
  IF formula_id IS NULL THEN SELECT id INTO formula_id FROM formulas WHERE code = 'RDC-300' AND plant_id = canning_plant_id; END IF;
  
  INSERT INTO formula_materials (formula_id, material_id, quantity) VALUES
    (formula_id, mat_cpc40, 300),
    (formula_id, mat_arena_fina, 1320),
    (formula_id, mat_agua, 170),
    (formula_id, mat_espumigeno, 0.60)
  ON CONFLICT DO NOTHING;
  
END $$;
