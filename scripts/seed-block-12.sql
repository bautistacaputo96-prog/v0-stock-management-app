INSERT INTO maintenance_inventory (plant, category_id, name, current_stock, minimum_stock) VALUES
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Moldes Aros' LIMIT 1), 'Cuchillas Esplitadora', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Moldes Aros' LIMIT 1), 'Molde B13', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Moldes Aros' LIMIT 1), 'Molde B20P', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Moldes Aros' LIMIT 1), 'Molde B20T', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Moldes Aros' LIMIT 1), 'Molde BU20', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Moldes Aros' LIMIT 1), 'Molde H6 (Concretus S.A.)', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Moldes Aros' LIMIT 1), 'Molde H8 (Concretus S.A.)', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Moldes Aros' LIMIT 1), 'Piezas Varias B20T', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Moldes Aros' LIMIT 1), 'Suplemento T 20 ME S/P R1-2201-10S2-0-40', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Moldes Aros' LIMIT 1), 'Suplemento T 20 S/P R1-2201-10S1-0-40', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Moldes Aros' LIMIT 1), 'Aro Caño 300 (Concretus-Rauzi)', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Moldes Aros' LIMIT 1), 'Aro Caño 400 (Concretus-Rauzi)', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Moldes Aros' LIMIT 1), 'Aro Caño 600 (Concretus-Rauzi)', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Moldes Aros' LIMIT 1), 'Aro Caño 800 (Concretus-Rauzi)', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Moldes Aros' LIMIT 1), 'Aro Caño 1000 (Concretus-Rauzi)', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Moldes Aros' LIMIT 1), 'Aro Caño 1200 (Concretus-Rauzi)', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Moldes Aros' LIMIT 1), 'Buje Moldes Separadores (del B13)', 0, 0)
ON CONFLICT DO NOTHING;