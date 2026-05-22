INSERT INTO maintenance_inventory (plant, category_id, name, current_stock, minimum_stock) VALUES
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Compresores' LIMIT 1), 'Filtro Separador ETR 60 c', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Compresores' LIMIT 1), 'Filtro Separador NK-60-20', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Compresores' LIMIT 1), 'Visita y Rep. Sullair TSE D CE (Ranchos)', 0, 0)
ON CONFLICT DO NOTHING;