-- Borrar un ingreso de materia prima (auditoría de stock e ingresos MP, 23/11/2026).
-- SIN APLICAR. Bautista la aprueba antes de correrla. Se puede correr dos veces. Vuelta atrás al final.
--
-- Qué cambia: solo la función del trigger trigger_decrease_stock_on_entry_delete (AFTER DELETE ON stock_entries).
-- El trigger en sí no se toca. Tres arreglos:
--
--   1. Recuento posterior: si el ingreso se cargó ANTES de un recuento de ese material (stock_movements con
--      reference_type = 'recuento' y created_at posterior al created_at del ingreso), borrarlo ya no resta: el recuento
--      fijó el stock contando lo que había de verdad en la playa, con o sin ese camión. Antes restaba igual y el stock
--      quedaba por debajo de lo contado, sin asiento (el control de stock lo veía como "ajuste sin registro").
--      Es el mismo criterio que ya usan los despachos (_ancla_stock en 202609291810_motor_despacho.sql).
--   2. Sin piso en 0: antes era GREATEST(0, stock − cantidad). Con el stock en 10.000 kg, borrar un ingreso de
--      30.000 lo dejaba en 0 en vez de −20.000 (se perdían 20.000 kg sin asiento). El stock puede ser negativo (hay
--      recuentos negativos y el aviso de stock en 0 lo contempla) y _mp_cambiar_cantidad ya resta sin piso.
--   3. Stock seco: antes solo se restaba si el seco del ingreso era distinto de la cantidad (humedad > 0). Pero al
--      cargar se suma siempre (diálogo: Arena Fina aunque la humedad sea 0; robot de Zomatik: materiales con
--      corrige_humedad, con seco = cantidad hasta que se carga la humedad). Ahora se resta también cuando el material
--      corrige humedad, con el seco del ingreso (o la cantidad si no tiene).
--
-- Qué pasa con los datos ya cargados: nada. No se modifica ninguna fila de ninguna tabla ni se recalcula ningún
-- stock. Solo cambia lo que pasa con los ingresos que se borren de acá en adelante. Lo que se restó de más en borrados
-- anteriores queda como está (si hace falta, se corrige con un recuento).
--
-- Bloqueos: CREATE OR REPLACE FUNCTION no bloquea stock_entries ni materials.

BEGIN;
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.decrease_stock_after_entry_delete()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_corrige boolean;
BEGIN
  -- 1. Recuento del material cargado después del ingreso: el stock ya está contado, no se toca
  IF EXISTS (
    SELECT 1 FROM stock_movements
     WHERE material_id = OLD.material_id
       AND reference_type = 'recuento'
       AND created_at > coalesce(OLD.created_at, OLD.entry_date)
  ) THEN
    RETURN OLD;
  END IF;

  -- 2. Sin piso en 0
  UPDATE materials
     SET current_stock = coalesce(current_stock, 0) - coalesce(OLD.quantity, 0),
         updated_at = now()
   WHERE id = OLD.material_id
  RETURNING coalesce(corrige_humedad, false) INTO v_corrige;

  -- 3. Stock seco: con humedad (seco distinto de la cantidad) o si el material corrige humedad (se sumó al cargar)
  IF (OLD.dry_quantity IS NOT NULL AND abs(OLD.dry_quantity - coalesce(OLD.quantity, 0)) > 0.001) OR coalesce(v_corrige, false) THEN
    UPDATE materials
       SET dry_stock = coalesce(dry_stock, 0) - coalesce(OLD.dry_quantity, OLD.quantity, 0)
     WHERE id = OLD.material_id;
  END IF;

  RETURN OLD;
END;
$function$;

COMMIT;

-- ---------------------------------------------------------------------------
-- Vuelta atrás (la versión anterior, de 000000000000_esquema_base.sql):
--
-- CREATE OR REPLACE FUNCTION public.decrease_stock_after_entry_delete()
--  RETURNS trigger
--  LANGUAGE plpgsql
-- AS $function$
--     BEGIN
--       UPDATE materials
--       SET current_stock = GREATEST(0, COALESCE(current_stock, 0) - OLD.quantity),
--           updated_at = NOW()
--       WHERE id = OLD.material_id;
--       IF OLD.dry_quantity IS NOT NULL AND ABS(COALESCE(OLD.dry_quantity, OLD.quantity) - OLD.quantity) > 0.001 THEN
--         UPDATE materials
--         SET dry_stock = GREATEST(0, COALESCE(dry_stock, 0) - OLD.dry_quantity)
--         WHERE id = OLD.material_id;
--       END IF;
--       RETURN OLD;
--     END;
--     $function$;
-- ---------------------------------------------------------------------------
