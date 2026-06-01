-- Insert common concrete materials
INSERT INTO materials (name, unit, current_stock, min_stock) VALUES
('Cemento', 'kg', 0, 500),
('Arena', 'kg', 0, 1000),
('Grava', 'kg', 0, 1000),
('Agua', 'L', 0, 200),
('Aditivo Plastificante', 'L', 0, 50)
ON CONFLICT (name) DO NOTHING;

-- Insert common concrete formulas
INSERT INTO formulas (code, name, description, yield_m3) VALUES
('H-17', 'Hormigón H-17', 'Hormigón de resistencia 170 kg/cm²', 1.0),
('H-21', 'Hormigón H-21', 'Hormigón de resistencia 210 kg/cm²', 1.0),
('H-30', 'Hormigón H-30', 'Hormigón de resistencia 300 kg/cm²', 1.0)
ON CONFLICT (code) DO NOTHING;

-- Get material IDs for formula compositions
DO $$
DECLARE
  cemento_id UUID;
  arena_id UUID;
  grava_id UUID;
  agua_id UUID;
  aditivo_id UUID;
  h17_id UUID;
  h21_id UUID;
  h30_id UUID;
BEGIN
  -- Get material IDs
  SELECT id INTO cemento_id FROM materials WHERE name = 'Cemento';
  SELECT id INTO arena_id FROM materials WHERE name = 'Arena';
  SELECT id INTO grava_id FROM materials WHERE name = 'Grava';
  SELECT id INTO agua_id FROM materials WHERE name = 'Agua';
  SELECT id INTO aditivo_id FROM materials WHERE name = 'Aditivo Plastificante';
  
  -- Get formula IDs
  SELECT id INTO h17_id FROM formulas WHERE code = 'H-17';
  SELECT id INTO h21_id FROM formulas WHERE code = 'H-21';
  SELECT id INTO h30_id FROM formulas WHERE code = 'H-30';
  
  -- Insert formula compositions for H-17 (per 1 m3)
  INSERT INTO formula_materials (formula_id, material_id, quantity) VALUES
  (h17_id, cemento_id, 280),
  (h17_id, arena_id, 850),
  (h17_id, grava_id, 950),
  (h17_id, agua_id, 180),
  (h17_id, aditivo_id, 2.5)
  ON CONFLICT (formula_id, material_id) DO NOTHING;
  
  -- Insert formula compositions for H-21 (per 1 m3)
  INSERT INTO formula_materials (formula_id, material_id, quantity) VALUES
  (h21_id, cemento_id, 340),
  (h21_id, arena_id, 800),
  (h21_id, grava_id, 950),
  (h21_id, agua_id, 185),
  (h21_id, aditivo_id, 3.0)
  ON CONFLICT (formula_id, material_id) DO NOTHING;
  
  -- Insert formula compositions for H-30 (per 1 m3)
  INSERT INTO formula_materials (formula_id, material_id, quantity) VALUES
  (h30_id, cemento_id, 420),
  (h30_id, arena_id, 750),
  (h30_id, grava_id, 950),
  (h30_id, agua_id, 190),
  (h30_id, aditivo_id, 4.0)
  ON CONFLICT (formula_id, material_id) DO NOTHING;
END $$;
