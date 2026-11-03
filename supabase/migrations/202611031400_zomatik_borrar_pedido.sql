-- Zomatik · Borrar un pedido con NP en Zomatik (03/11/2026) — SIN APLICAR (avisar a Bautista antes)
-- Va después de 202610231000_zomatik_np_saldo.sql (aplicada). Spec: docs/migracion-loop/zomatik.md, sección 28.
--
-- Qué cambia:
--   zomatik_np_no_borrar_pedido()  el trigger que frena borrar un pedido con NP en Zomatik ahora deja borrarlo si sus
--                                  NP quedaron VACIADAS (o anuladas): el sistema primero vacía la NP en Zomatik y
--                                  recién después borra el pedido. Todo lo demás, igual (con una NP viva en Zomatik
--                                  sigue diciendo "Cancelalo").
--   zomatik_pedido_borrar          pedidos que se pidió eliminar y esperan que el robot vacíe su NP: el motivo, quién y
--                                  una copia del pedido (para Actividad y el mail). Solo el servidor (service_role).
--
-- Qué pasa con los datos ya cargados: nada. La tabla nueva queda vacía y el trigger solo agrega un caso permitido
-- (NP vaciada). Ningún pedido ni NP cambia.
-- Candado corto sobre scheduled_dispatches (CREATE OR REPLACE de la función del trigger): correrla fuera de horario.

SET lock_timeout = '3s';
SET statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.zomatik_pedido_borrar (
  scheduled_dispatch_id  uuid PRIMARY KEY REFERENCES public.scheduled_dispatches(id) ON DELETE CASCADE,
  motivo                 text,
  pedido                 jsonb,                 -- copia del pedido (cliente, obra, fórmula, m³, llegada…)
  pedido_por             text NOT NULL,         -- quién pidió eliminarlo
  created_at             timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.zomatik_pedido_borrar IS 'Zomatik: pedidos que se pidió eliminar y esperan que el robot vacíe su NP. Se borra con el pedido.';
REVOKE ALL ON TABLE public.zomatik_pedido_borrar FROM anon, authenticated;
GRANT ALL ON TABLE public.zomatik_pedido_borrar TO service_role;

-- Igual que en 202610231000, más: una NP VACIADA en Zomatik no frena el borrado
CREATE OR REPLACE FUNCTION public.zomatik_np_no_borrar_pedido()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM zomatik_np_uso u JOIN zomatik_np n ON n.id = u.np_id
    WHERE u.scheduled_dispatch_id = OLD.id AND n.estado NOT IN ('anulada', 'vaciada')
      AND NOT (n.estado IN ('pendiente', 'error') AND coalesce(n.paso, '') NOT IN ('grabar', 'verificar', 'grabar_cortado', 'buscar_marca'))
  ) THEN
    RAISE EXCEPTION 'El pedido tiene nota de pedido en Zomatik: no se puede eliminar. Cancelalo (la NP queda pendiente en Programación).';
  END IF;
  UPDATE zomatik_np n SET estado = 'anulada', mensaje = 'El pedido se eliminó antes de generarla', proximo_intento = NULL, updated_at = now()
  WHERE n.estado IN ('pendiente', 'error')
    AND n.id IN (SELECT u.np_id FROM zomatik_np_uso u WHERE u.scheduled_dispatch_id = OLD.id);
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.zomatik_np_no_borrar_pedido() FROM PUBLIC, anon, authenticated;

RESET lock_timeout;
RESET statement_timeout;
