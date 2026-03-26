-- Verify paver product types exist (already seeded in 030)
INSERT INTO paver_product_types (product_code, description)
VALUES 
  ('H6', 'Adoquin H6'),
  ('H8', 'Adoquin H8')
ON CONFLICT (product_code) DO NOTHING;
