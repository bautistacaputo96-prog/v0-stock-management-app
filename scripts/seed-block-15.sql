INSERT INTO maintenance_inventory (plant, category_id, name, current_stock, minimum_stock) VALUES
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Bandas Mangas Cepillos' LIMIT 1), 'Banda o Cinta Transportadora 2300 x 500 x', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Bandas Mangas Cepillos' LIMIT 1), 'Cepillo de Giratabla', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Bandas Mangas Cepillos' LIMIT 1), 'Cinta Esbel 3440 x 500 x 2,5 grampas acero 2,5 mm', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Bandas Mangas Cepillos' LIMIT 1), 'Gancho Cinta Tranp. Tipo BYM de 6,4 a 9mm', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Bandas Mangas Cepillos' LIMIT 1), 'Manga para Cemento 55 cm x 1 metro', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Bandas Mangas Cepillos' LIMIT 1), 'Manga para Cemento 70 cm x 1/2 metro', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Bandas Mangas Cepillos' LIMIT 1), 'Manga para Cemento 77 cm x 1 metro', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='Bandas Mangas Cepillos' LIMIT 1), 'Cepillo 930 mm, Diam 150 mm, núcleo 70x25 Nylon 0,50', 0, 0)
ON CONFLICT DO NOTHING;