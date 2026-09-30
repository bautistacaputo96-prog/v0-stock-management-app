-- Fase 0b · Materiales con tipo en vez de reglas por nombre
--
-- Agrega a materials:
--   tipo             arido_fino | arido_grueso | cemento | agua | aditivo_planta | aditivo_obra | fibra | otro
--   descuenta_stock  false = el despacho lo registra pero no mueve el stock (Agua, Sikament 33S)
--   corrige_humedad  true  = al despachar se descuenta seco × (1 + humedad del acopio / 100)
--
-- Decisión (Bautista, 29/09/2026): la humedad se mide y corrige SOLO en la Arena Fina.
-- La Arena Trituración 0/6 es árido fino (tipo arido_fino) pero corrige_humedad = false.
-- Se eligió una marca aparte (corrige_humedad) en vez de clasificar la 0/6 como árido grueso:
-- el tipo dice qué es el material y la marca dice qué regla se le aplica.
--
-- Compatible con el front actual: columnas nuevas con valor por defecto; un material nuevo
-- dado de alta desde la pantalla vieja (sin tipo) se clasifica solo por su nombre (trigger).
-- La columna vieja requires_humidity_control no se toca (la usa el recuento de stock).

-- Única regla por nombre que queda: clasificar un material al darlo de alta.
-- corrige_humedad: nombres que empiezan con "Arena Fina" (Arena Fina, "Arena Fina Lavada"…);
-- la Arena Trituración 0/6 queda afuera.
CREATE OR REPLACE FUNCTION public.clasificar_material(p_nombre text)
RETURNS TABLE (tipo text, descuenta_stock boolean, corrige_humedad boolean)
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    CASE
      WHEN n LIKE 'arena%'               THEN 'arido_fino'
      WHEN n LIKE 'piedra%'              THEN 'arido_grueso'
      WHEN n LIKE 'cpc%' OR n LIKE 'cemento%' THEN 'cemento'
      WHEN n = 'agua' OR n LIKE 'agua %' THEN 'agua'
      WHEN n LIKE 'sikament 33%'         THEN 'aditivo_obra'
      WHEN n LIKE 'superfluidificante%'  THEN 'aditivo_obra'
      WHEN n LIKE 'sikament%'            THEN 'aditivo_planta'
      WHEN n LIKE 'fibra%'               THEN 'fibra'
      ELSE 'otro'
    END,
    NOT (n = 'agua' OR n LIKE 'agua %' OR n LIKE 'sikament 33%'),
    n LIKE 'arena fina%'
  FROM (SELECT lower(btrim(coalesce(p_nombre, ''))) AS n) x
$$;

ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS tipo text;
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS descuenta_stock boolean NOT NULL DEFAULT true;
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS corrige_humedad boolean NOT NULL DEFAULT false;

UPDATE public.materials m
   SET (tipo, descuenta_stock, corrige_humedad) =
       (SELECT c.tipo, c.descuenta_stock, c.corrige_humedad FROM public.clasificar_material(m.name) c)
 WHERE m.tipo IS NULL;

ALTER TABLE public.materials ALTER COLUMN tipo SET NOT NULL;
ALTER TABLE public.materials DROP CONSTRAINT IF EXISTS materials_tipo_check;
ALTER TABLE public.materials ADD CONSTRAINT materials_tipo_check
  CHECK (tipo IN ('arido_fino','arido_grueso','cemento','agua','aditivo_planta','aditivo_obra','fibra','otro'));

COMMENT ON COLUMN public.materials.tipo IS 'Fase 0b: arido_fino, arido_grueso, cemento, agua, aditivo_planta, aditivo_obra, fibra, otro';
COMMENT ON COLUMN public.materials.descuenta_stock IS 'Fase 0b: false = se registra en el despacho pero no descuenta stock (Agua, Sikament 33S)';
COMMENT ON COLUMN public.materials.corrige_humedad IS 'Fase 0b: true = el despacho descuenta seco x (1 + stockpile_humidity/100). Solo Arena Fina';

-- Alta sin tipo (pantallas viejas): se completa por el nombre.
-- Renombrar (pantallas viejas, que no mandan tipo): se reclasifica por el nombre nuevo, salvo
-- los campos que el mismo UPDATE cambió a propósito (tipo, descuenta_stock, corrige_humedad).
CREATE OR REPLACE FUNCTION public.materials_tipo_por_defecto()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE c record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.tipo IS NULL THEN
      SELECT * INTO c FROM public.clasificar_material(NEW.name);
      NEW.tipo := c.tipo;
      NEW.descuenta_stock := c.descuenta_stock;
      NEW.corrige_humedad := c.corrige_humedad;
    END IF;
  ELSIF NEW.name IS DISTINCT FROM OLD.name THEN
    SELECT * INTO c FROM public.clasificar_material(NEW.name);
    IF NEW.tipo IS NOT DISTINCT FROM OLD.tipo THEN
      NEW.tipo := c.tipo;
    END IF;
    IF NEW.descuenta_stock IS NOT DISTINCT FROM OLD.descuenta_stock THEN
      NEW.descuenta_stock := c.descuenta_stock;
    END IF;
    IF NEW.corrige_humedad IS NOT DISTINCT FROM OLD.corrige_humedad THEN
      NEW.corrige_humedad := c.corrige_humedad;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_materials_tipo_por_defecto ON public.materials;
CREATE TRIGGER trg_materials_tipo_por_defecto
  BEFORE INSERT OR UPDATE OF name ON public.materials
  FOR EACH ROW EXECUTE FUNCTION public.materials_tipo_por_defecto();
