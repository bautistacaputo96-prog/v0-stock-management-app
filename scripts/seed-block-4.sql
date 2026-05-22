INSERT INTO maintenance_inventory (plant, category_id, name, current_stock, minimum_stock) VALUES
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Combustibles Aceites' LIMIT 1), 'Aceite 10W 40 1 litro Elaión', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Combustibles Aceites' LIMIT 1), 'Aceite 10W 40 4 l. Elaión', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Combustibles Aceites' LIMIT 1), 'Aceite 15W 40 Barril 180 l. Total', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Combustibles Aceites' LIMIT 1), 'Aceite 15W 40 Total 20l.', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Combustibles Aceites' LIMIT 1), 'Aceite 46 Sintético', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Combustibles Aceites' LIMIT 1), 'Aceite ATF Elfmatic 20 l.', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Combustibles Aceites' LIMIT 1), 'Aceite ATF Valquiria 20 l. (+Económico)', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Combustibles Aceites' LIMIT 1), 'Aceite Hidraúlico Valdar 68 20l.', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Combustibles Aceites' LIMIT 1), 'Aceite Hidraúlico Valdar 68 4l.', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Combustibles Aceites' LIMIT 1), 'Aceite Hidraúlico Valdar 68 Barril', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Combustibles Aceites' LIMIT 1), 'Aceite Onella 80W 90 para transm. 20 l.', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Combustibles Aceites' LIMIT 1), 'Aceite Onella 80W 90 para transm. Barril', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Combustibles Aceites' LIMIT 1), 'Gasoil Común Barril', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Combustibles Aceites' LIMIT 1), 'Gasoil Común Batán', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Combustibles Aceites' LIMIT 1), 'Grasa Ep2 Litio 20 Kg.', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Combustibles Aceites' LIMIT 1), 'Grasa Ep2 Litio Barril 180 l.', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Combustibles Aceites' LIMIT 1), 'Nafta Bidón 20 l.', 0, 0)
ON CONFLICT DO NOTHING;