-- =============================================
-- SEED DATA - Materials, Formulas, Clients, Mixers, Dispatches
-- =============================================

DO $$
DECLARE
  canning_id UUID;
  hudson_id UUID;
  -- Canning materials
  mat_cpc40 UUID;
  mat_arena_fina UUID;
  mat_arena_triturada UUID;
  mat_piedra_620 UUID;
  mat_piedra_612 UUID;
  mat_piedra_1030 UUID;
  mat_agua UUID;
  mat_sikament90e UUID;
  mat_sikament33s UUID;
  -- Formula IDs
  formula_id UUID;
  -- Clients
  client1_id UUID;
  client2_id UUID;
  client3_id UUID;
  -- Sites
  site1_id UUID;
  site2_id UUID;
  site3_id UUID;
  site4_id UUID;
  site5_id UUID;
  -- Mixers
  mixer1_id UUID;
  mixer2_id UUID;
  mixer3_id UUID;
  -- Dispatch helpers
  v_formulas UUID[];
  v_clients UUID[];
  v_sites UUID[];
  v_mixers UUID[];
  v_f_idx INT;
  v_c_idx INT;
  v_s_idx INT;
  v_m_idx INT;
BEGIN
  -- Get plant IDs
  SELECT id INTO canning_id FROM plants WHERE code = 'CAN';
  SELECT id INTO hudson_id FROM plants WHERE code = 'HUD';

  -- =============================================
  -- MATERIALS for Canning
  -- =============================================
  INSERT INTO materials (name, unit, plant_id, current_stock, min_stock) VALUES
    ('CPC 40', 'kg', canning_id, 50000, 5000) RETURNING id INTO mat_cpc40;
  INSERT INTO materials (name, unit, plant_id, current_stock, min_stock) VALUES
    ('Arena Fina', 'kg', canning_id, 100000, 10000) RETURNING id INTO mat_arena_fina;
  INSERT INTO materials (name, unit, plant_id, current_stock, min_stock) VALUES
    ('Arena Trituración 0/6', 'kg', canning_id, 80000, 10000) RETURNING id INTO mat_arena_triturada;
  INSERT INTO materials (name, unit, plant_id, current_stock, min_stock) VALUES
    ('Piedra Partida 6/20', 'kg', canning_id, 120000, 15000) RETURNING id INTO mat_piedra_620;
  INSERT INTO materials (name, unit, plant_id, current_stock, min_stock) VALUES
    ('Piedra Partida 6/12', 'kg', canning_id, 100000, 15000) RETURNING id INTO mat_piedra_612;
  INSERT INTO materials (name, unit, plant_id, current_stock, min_stock) VALUES
    ('Piedra Partida 10/30', 'kg', canning_id, 90000, 15000) RETURNING id INTO mat_piedra_1030;
  INSERT INTO materials (name, unit, plant_id, current_stock, min_stock) VALUES
    ('Agua', 'kg', canning_id, 999999, 5000) RETURNING id INTO mat_agua;
  INSERT INTO materials (name, unit, plant_id, current_stock, min_stock) VALUES
    ('Sikament 90E', 'kg', canning_id, 5000, 500) RETURNING id INTO mat_sikament90e;
  INSERT INTO materials (name, unit, plant_id, current_stock, min_stock) VALUES
    ('Sikament 33S', 'kg', canning_id, 3000, 500) RETURNING id INTO mat_sikament33s;

  -- =============================================
  -- FORMULAS for Canning (name = first 3 chars of code)
  -- =============================================
  INSERT INTO formulas (code, name, description, plant_id, yield_m3) VALUES
    ('H13-620-10 C', 'H13', 'Hormigón H13 descarga directa', canning_id, 1.0);
  INSERT INTO formula_materials (formula_id, material_id, quantity)
    SELECT f.id, m.id, v.qty FROM formulas f,
    (VALUES (mat_cpc40, 210), (mat_arena_fina, 739), (mat_arena_triturada, 246), (mat_piedra_620, 995), (mat_agua, 165), (mat_sikament90e, 1.79), (mat_sikament33s, 0.63)) AS v(id, qty),
    materials m WHERE f.code = 'H13-620-10 C' AND m.id = v.id;

  INSERT INTO formulas (code, name, description, plant_id, yield_m3) VALUES
    ('H17-620-10 C', 'H17', 'Hormigón H17 descarga directa', canning_id, 1.0);
  INSERT INTO formula_materials (formula_id, material_id, quantity)
    SELECT f.id, m.id, v.qty FROM formulas f,
    (VALUES (mat_cpc40, 245), (mat_arena_fina, 728), (mat_arena_triturada, 243), (mat_piedra_620, 975), (mat_agua, 168), (mat_sikament90e, 2.08), (mat_sikament33s, 0.74)) AS v(id, qty),
    materials m WHERE f.code = 'H17-620-10 C' AND m.id = v.id;

  INSERT INTO formulas (code, name, description, plant_id, yield_m3) VALUES
    ('H21-620-10 C', 'H21', 'Hormigón H21 descarga directa', canning_id, 1.0);
  INSERT INTO formula_materials (formula_id, material_id, quantity)
    SELECT f.id, m.id, v.qty FROM formulas f,
    (VALUES (mat_cpc40, 245), (mat_arena_fina, 735), (mat_arena_triturada, 245), (mat_piedra_620, 990), (mat_agua, 160), (mat_sikament90e, 2.08), (mat_sikament33s, 0.74)) AS v(id, qty),
    materials m WHERE f.code = 'H21-620-10 C' AND m.id = v.id;

  INSERT INTO formulas (code, name, description, plant_id, yield_m3) VALUES
    ('H21-620-15 B', 'H21', 'Hormigón H21 para bombear', canning_id, 1.0);
  INSERT INTO formulas (code, name, description, plant_id, yield_m3) VALUES
    ('H21-612-10 C', 'H21', 'Hormigón H21 piedra chica descarga directa', canning_id, 1.0);
  INSERT INTO formulas (code, name, description, plant_id, yield_m3) VALUES
    ('H21-612-15 B', 'H21', 'Hormigón H21 piedra chica bombeo', canning_id, 1.0);
  INSERT INTO formulas (code, name, description, plant_id, yield_m3) VALUES
    ('H25-620-10 C', 'H25', 'Hormigón H25 descarga directa', canning_id, 1.0);
  INSERT INTO formulas (code, name, description, plant_id, yield_m3) VALUES
    ('H25-620-15 B', 'H25', 'Hormigón H25 bombeo', canning_id, 1.0);
  INSERT INTO formulas (code, name, description, plant_id, yield_m3) VALUES
    ('H25-612-10 C', 'H25', 'Hormigón H25 piedra chica descarga directa', canning_id, 1.0);
  INSERT INTO formulas (code, name, description, plant_id, yield_m3) VALUES
    ('H25-612-15 B', 'H25', 'Hormigón H25 piedra chica bombeo', canning_id, 1.0);
  INSERT INTO formulas (code, name, description, plant_id, yield_m3) VALUES
    ('H30-620-10 C', 'H30', 'Hormigón H30 descarga directa', canning_id, 1.0);
  INSERT INTO formulas (code, name, description, plant_id, yield_m3) VALUES
    ('H30-620-15 B', 'H30', 'Hormigón H30 bombeo', canning_id, 1.0);
  INSERT INTO formulas (code, name, description, plant_id, yield_m3) VALUES
    ('H30-612-10 C', 'H30', 'Hormigón H30 piedra chica descarga directa', canning_id, 1.0);
  INSERT INTO formulas (code, name, description, plant_id, yield_m3) VALUES
    ('H30-612-15 B', 'H30', 'Hormigón H30 piedra chica bombeo', canning_id, 1.0);
  INSERT INTO formulas (code, name, description, plant_id, yield_m3) VALUES
    ('H40-620-10 C', 'H40', 'Hormigón H40 descarga directa', canning_id, 1.0);
  INSERT INTO formulas (code, name, description, plant_id, yield_m3) VALUES
    ('H40-620-15 B', 'H40', 'Hormigón H40 bombeo', canning_id, 1.0);

  -- =============================================
  -- CLIENTS (for Canning plant)
  -- =============================================
  INSERT INTO clients (name, contact, phone, plant_id) VALUES
    ('Constructora Del Sur', 'Carlos Gómez', '1155443322', canning_id) RETURNING id INTO client1_id;
  INSERT INTO clients (name, contact, phone, plant_id) VALUES
    ('Ingeniería ABC', 'María López', '1166554433', canning_id) RETURNING id INTO client2_id;
  INSERT INTO clients (name, contact, phone, plant_id) VALUES
    ('Obras Públicas BA', 'Roberto Pérez', '1177665544', canning_id) RETURNING id INTO client3_id;

  -- =============================================
  -- CONSTRUCTION SITES
  -- =============================================
  INSERT INTO construction_sites (name, address, client_id) VALUES
    ('Edificio Torres', 'Av. San Martín 1234, Canning', client1_id) RETURNING id INTO site1_id;
  INSERT INTO construction_sites (name, address, client_id) VALUES
    ('Centro Comercial Sur', 'Ruta 58 km 12, Canning', client1_id) RETURNING id INTO site2_id;
  INSERT INTO construction_sites (name, address, client_id) VALUES
    ('Complejo Residencial', 'Calle 25 de Mayo 567, Hudson', client2_id) RETURNING id INTO site3_id;
  INSERT INTO construction_sites (name, address, client_id) VALUES
    ('Puente Autopista', 'Autopista Buenos Aires km 45', client3_id) RETURNING id INTO site4_id;
  INSERT INTO construction_sites (name, address, client_id) VALUES
    ('Planta Industrial', 'Parque Industrial Canning Lote 15', client3_id) RETURNING id INTO site5_id;

  -- =============================================
  -- MIXERS
  -- =============================================
  INSERT INTO mixers (license_plate, brand, plant_id) VALUES
    ('AB123CD', 'Mercedes-Benz', canning_id) RETURNING id INTO mixer1_id;
  INSERT INTO mixers (license_plate, brand, plant_id) VALUES
    ('EF456GH', 'Iveco', canning_id) RETURNING id INTO mixer2_id;
  INSERT INTO mixers (license_plate, brand, plant_id) VALUES
    ('IJ789KL', 'Scania', canning_id) RETURNING id INTO mixer3_id;

  -- =============================================
  -- 100 RANDOM DISPATCHES (Canning plant)
  -- =============================================
  SELECT array_agg(id) INTO v_formulas FROM formulas WHERE plant_id = canning_id;
  v_clients := ARRAY[client1_id, client2_id, client3_id];
  v_sites := ARRAY[site1_id, site2_id, site3_id, site4_id, site5_id];
  v_mixers := ARRAY[mixer1_id, mixer2_id, mixer3_id];

  FOR i IN 1..100 LOOP
    v_f_idx := 1 + (random() * (array_length(v_formulas, 1) - 1))::INT;
    v_c_idx := 1 + (random() * (array_length(v_clients, 1) - 1))::INT;
    v_s_idx := 1 + (random() * (array_length(v_sites, 1) - 1))::INT;
    v_m_idx := 1 + (random() * (array_length(v_mixers, 1) - 1))::INT;

    INSERT INTO dispatches (
      dispatch_date, formula_id, quantity_m3, mixer_id,
      client_id, construction_site_id, sample_taken, remito
    ) VALUES (
      (CURRENT_DATE - (random() * 180)::INT)::DATE::TIMESTAMPTZ,
      v_formulas[v_f_idx],
      ROUND((4 + random() * 4)::NUMERIC, 2),
      v_mixers[v_m_idx],
      v_clients[v_c_idx],
      v_sites[v_s_idx],
      false,
      'DESP-' || (10000 + i)
    );
  END LOOP;

END $$;
