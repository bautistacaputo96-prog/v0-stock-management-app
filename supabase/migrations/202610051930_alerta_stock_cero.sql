-- Aviso por mail cuando un material queda en 0 o en negativo (pedido de Bautista, 05/10/2026).
-- No bloquea ningún despacho: solo avisa a los supervisores con mail (hoy Bautista y Juan).
--
-- Cómo funciona:
--  1. Un trigger en `materials` detecta cuando `current_stock` pasa de positivo a 0 o menos
--     (por un despacho, una transferencia, una edición, lo que sea) y deja una alerta pendiente.
--  2. En la misma transacción encola (pg_net, asíncrono: si el despacho se revierte, el pedido
--     también) un llamado a /api/alertas/stock-cero, que manda el mail y marca la alerta como enviada.
--  3. Cuando el stock vuelve a ser positivo (un ingreso, un recuento), la alerta se cierra sola y
--     la próxima vez que llegue a 0 vuelve a avisar.
--  4. Un cron diario manda lo que haya quedado pendiente (por si el llamado falló).
-- Solo cuentan los materiales que descuentan stock y se usan: los que están en alguna fórmula,
-- la fibra y los aditivos de obra. Así no avisa por la Piedra 10/30, que no se usa.

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.alertas_stock (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id      uuid NOT NULL REFERENCES public.materials(id) ON DELETE CASCADE,
  plant_id         uuid,
  stock_al_alertar numeric,
  creado_at        timestamptz NOT NULL DEFAULT now(),
  enviado_at       timestamptz,
  resuelto_at      timestamptz
);
-- A lo sumo una alerta abierta por material
CREATE UNIQUE INDEX IF NOT EXISTS alertas_stock_abierta_key ON public.alertas_stock (material_id) WHERE resuelto_at IS NULL;

-- Solo la lee el servidor (como `integraciones`)
ALTER TABLE public.alertas_stock ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.alertas_stock FROM anon, authenticated;
GRANT ALL ON TABLE public.alertas_stock TO service_role;

CREATE OR REPLACE FUNCTION public._material_controla_stock(p_material_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT coalesce(m.descuenta_stock, true)
     AND (m.tipo IN ('fibra', 'aditivo_obra')
          OR EXISTS (SELECT 1 FROM public.formula_materials fm WHERE fm.material_id = m.id))
  FROM public.materials m WHERE m.id = p_material_id
$$;
REVOKE EXECUTE ON FUNCTION public._material_controla_stock(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_alerta_stock_cero()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.current_stock IS NOT DISTINCT FROM OLD.current_stock THEN
    RETURN NEW;
  END IF;

  IF NEW.current_stock <= 0 AND coalesce(OLD.current_stock, 1) > 0 AND public._material_controla_stock(NEW.id) THEN
    INSERT INTO public.alertas_stock (material_id, plant_id, stock_al_alertar)
    VALUES (NEW.id, NEW.plant_id, NEW.current_stock)
    ON CONFLICT (material_id) WHERE resuelto_at IS NULL DO NOTHING;
    -- El mail sale aparte; si el llamado falla, lo manda el cron diario. Nunca frena el despacho.
    BEGIN
      PERFORM net.http_post(
        url := 'https://www.produccionrebucret.com/api/alertas/stock-cero',
        body := '{}'::jsonb,
        headers := '{"Content-Type": "application/json"}'::jsonb
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  ELSIF NEW.current_stock > 0 THEN
    UPDATE public.alertas_stock SET resuelto_at = now()
    WHERE material_id = NEW.id AND resuelto_at IS NULL;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.trg_alerta_stock_cero() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_alerta_stock_cero ON public.materials;
CREATE TRIGGER trg_alerta_stock_cero
  AFTER UPDATE OF current_stock ON public.materials
  FOR EACH ROW EXECUTE FUNCTION public.trg_alerta_stock_cero();

-- Situación de arranque: los materiales que ya están en 0 o negativo van en el primer mail.
INSERT INTO public.alertas_stock (material_id, plant_id, stock_al_alertar)
SELECT m.id, m.plant_id, m.current_stock
FROM public.materials m
WHERE m.current_stock <= 0 AND public._material_controla_stock(m.id)
ON CONFLICT (material_id) WHERE resuelto_at IS NULL DO NOTHING;
