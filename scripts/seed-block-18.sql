INSERT INTO maintenance_inventory (plant, category_id, name, current_stock, minimum_stock) VALUES
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Electrónica y Similar' LIMIT 1), 'Cargador de Celular Tipo "C"', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Electrónica y Similar' LIMIT 1), 'Cable RJ 45 con fichas (1m)', 0, 0)
ON CONFLICT DO NOTHING;