-- Zomatik · Borrar un pedido con NP en Zomatik y despachos borrados ya remitidos (03/11/2026) — SIN APLICAR
-- (avisar a Bautista antes). Va después de 202610231000_zomatik_np_saldo.sql y 202610291000_zomatik_z1_remitos.sql
-- (las dos aplicadas). Spec: docs/migracion-loop/zomatik.md, sección 28. Es repetible: se puede correr dos veces.
--
-- Qué cambia:
--   zomatik_np_no_borrar_pedido()  el trigger que frena borrar un pedido con NP en Zomatik ahora deja borrarlo si sus
--                                  NP quedaron VACIADAS (o anuladas): el sistema primero vacía la NP en Zomatik y
--                                  recién después borra el pedido. Con una NP viva en Zomatik sigue diciendo "Cancelalo".
--   zomatik_pedido_borrar          pedidos que se pidió eliminar: modo 'vaciar' (esperan que el robot vacíe su NP) o
--                                  'remitos' (tenían remitos o despachos: quedan cancelados y se avisa a Juan). Guarda
--                                  el motivo, quién, una copia del pedido y cuándo salió el mail (no se repite).
--                                  Solo el servidor (service_role).
--   zomatik_remito_despachos.borrado_aviso_at  cuándo salió el mail "Anular en Zomatik" por un despacho borrado que
--                                  ya estaba en Zomatik (un despacho = un mail).
--
-- Qué pasa con los datos ya cargados: nada. La tabla nueva queda vacía, la columna nueva queda vacía y el trigger solo
-- agrega un caso permitido (NP vaciada). Ningún pedido, NP ni remito cambia.
--
-- Candados (cortos, igual conviene correrla fuera de horario):
--   - crear zomatik_pedido_borrar con su FK a scheduled_dispatches pide SHARE ROW EXCLUSIVE sobre scheduled_dispatches
--     (frena las escrituras de pedidos un instante, no las lecturas);
--   - el ADD COLUMN sin default pide ACCESS EXCLUSIVE sobre zomatik_remito_despachos (un instante);
--   - el CREATE OR REPLACE de la función del trigger no bloquea tablas.
-- Si algún candado no se consigue en 3 s, falla entera (BEGIN/COMMIT) y no queda nada a medias.

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.zomatik_pedido_borrar (
  scheduled_dispatch_id  uuid PRIMARY KEY REFERENCES public.scheduled_dispatches(id) ON DELETE CASCADE,
  modo                   text NOT NULL DEFAULT 'vaciar' CHECK (modo IN ('vaciar', 'remitos')),
  motivo                 text,
  pedido                 jsonb,                 -- copia del pedido (cliente, obra, fórmula, m³, llegada…)
  pedido_por             text NOT NULL,         -- quién pidió eliminarlo
  aviso_at               timestamptz,           -- cuándo salió el mail "Anular en Zomatik" a Juan (modo 'remitos')
  created_at             timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.zomatik_pedido_borrar IS 'Zomatik: pedidos que se pidió eliminar (vaciar su NP o, con remitos, cancelado + mail a Juan). Se borra con el pedido.';
REVOKE ALL ON TABLE public.zomatik_pedido_borrar FROM anon, authenticated;
GRANT ALL ON TABLE public.zomatik_pedido_borrar TO service_role;

ALTER TABLE public.zomatik_remito_despachos ADD COLUMN IF NOT EXISTS borrado_aviso_at timestamptz;
COMMENT ON COLUMN public.zomatik_remito_despachos.borrado_aviso_at IS 'Zomatik Z1: cuándo salió el mail "Anular en Zomatik" porque se borró este despacho (ya estaba en Zomatik).';

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

COMMIT;
