INSERT INTO maintenance_inventory (plant, category_id, name, current_stock, minimum_stock) VALUES
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Insumos' LIMIT 1), 'Acelerante Daracel Contenedor (at. Tiene Cloruro)', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Insumos' LIMIT 1), 'Acelerante Daracel Tambor 200 kg.  (at. Tiene Cloruro)', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Insumos' LIMIT 1), 'Acelerante Daraset 282 0824 Contenedor (Sin Cloruro)', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Insumos' LIMIT 1), 'Aditivo Desmoldante Contenedor', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Insumos' LIMIT 1), 'Aditivo Monotop 620 Sika (Calera- J.D.Perón 27173 - Merlo', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Insumos' LIMIT 1), 'Bobina de Film Stretch', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Insumos' LIMIT 1), 'Carga de gas YPF', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Insumos' LIMIT 1), 'Equipo de Cemento', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Insumos' LIMIT 1), 'Equipo Pallets 1000 x 1000', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Insumos' LIMIT 1), 'Equipo Pallets 1000 x 1200', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Insumos' LIMIT 1), 'Garrafa de 10 kg', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Insumos' LIMIT 1), 'Gas Carga Mínima', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Insumos' LIMIT 1), 'Gas Completo', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Insumos' LIMIT 1), 'Recargar tubo de gas Mig', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Insumos' LIMIT 1), 'Aditivo Mark V (de GCP)', 0, 0)
ON CONFLICT DO NOTHING;