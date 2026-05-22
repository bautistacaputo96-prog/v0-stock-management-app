INSERT INTO maintenance_inventory (plant, category_id, name, current_stock, minimum_stock) VALUES
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Hidraúlica' LIMIT 1), 'Cil. 1 Hidra-Nova 78mm Ranchos', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Hidraúlica' LIMIT 1), 'Cil. 2 Hidra-Nova 64 mm Ranchos', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Hidraúlica' LIMIT 1), 'Cilindro 63 MP2C080A0150', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Hidraúlica' LIMIT 1), 'Manguera Hidraúlica de 1/2 x 1,4 m', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Hidraúlica' LIMIT 1), 'Manguera Hidraúlica de Bloquera', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Hidraúlica' LIMIT 1), 'Manguera Oil - S 12 10 Mpa', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Hidraúlica' LIMIT 1), 'Manómetro (Ariel Parolo)', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Hidraúlica' LIMIT 1), 'Caudalímetro para gasoil', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Hidraúlica' LIMIT 1), 'Caudalímetro Agua Exion', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Hidraúlica' LIMIT 1), 'Mangueras Varias', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Hidraúlica' LIMIT 1), 'Motor Orbital Brida Red,Eje Recto 25 mm (Paletizadora)', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Hidraúlica' LIMIT 1), 'Filtro Aceite Bloquera', 0, 0)
ON CONFLICT DO NOTHING;