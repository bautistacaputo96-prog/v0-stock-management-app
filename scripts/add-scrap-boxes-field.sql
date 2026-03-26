-- Add scrap_boxes field to pipe_production
ALTER TABLE pipe_production 
ADD COLUMN IF NOT EXISTS scrap_boxes integer DEFAULT 0;

-- Add Cajón Desperdicio product to product_config (peso tabulado por cajón)
-- El usuario puede ajustar el peso en configuración después
INSERT INTO product_config (product_code, product_name, piece_weight_kg, line_type)
SELECT 'CAJON-DESP', 'Cajón Desperdicio Caños', 150, 'caños'
WHERE NOT EXISTS (SELECT 1 FROM product_config WHERE product_code = 'CAJON-DESP');
