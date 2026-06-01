-- Function to update material stock (for dispatches and other operations)
CREATE OR REPLACE FUNCTION update_material_stock(
  p_material_id UUID,
  p_quantity_change NUMERIC
)
RETURNS void AS $$
BEGIN
  UPDATE materials 
  SET current_stock = COALESCE(current_stock, 0) + p_quantity_change,
      updated_at = NOW()
  WHERE id = p_material_id;
END;
$$ LANGUAGE plpgsql;
