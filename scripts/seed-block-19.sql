INSERT INTO maintenance_inventory (plant, category_id, name, current_stock, minimum_stock) VALUES
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='OTROS' LIMIT 1), 'enchufe macho trifasico 3P+T 16a SCAME', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='OTROS' LIMIT 1), 'DEPOSITO DE INODORO A MOCHILA PLASTICO A BOTON . CON CARGA Y DESCARGA', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='OTROS' LIMIT 1), 'FLOR DE DUCHA LLUVIA', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='OTROS' LIMIT 1), 'LUCES DE EMERGENCIA', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='OTROS' LIMIT 1), 'LUCES DE EMERGENCIA TIPO MICKEY', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='OTROS' LIMIT 1), 'electrovalvula  Rpe 1 pulgada normal abierta ( VALVULA DE RIEGO)', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='OTROS' LIMIT 1), 'bomba trasvase palanca EMHY2515 (PARA TACHOS DE ACEITE DE 200 LTS )', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='OTROS' LIMIT 1), 'Caudalimetro medidor gasoil combustible', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='OTROS' LIMIT 1), 'pilas A27', 0, 0),
('silke', (SELECT id FROM maintenance_categories WHERE plant='silke' AND name='OTROS' LIMIT 1), 'tubo cilindro de atal', 0, 0)
ON CONFLICT DO NOTHING;