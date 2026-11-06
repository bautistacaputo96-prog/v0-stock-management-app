-- Zomatik · ajustar la NP a lo despachado al finalizar el pedido (fase 1: editar la cantidad) — SIN APLICAR
-- (avisar a Bautista antes). Va DESPUÉS de 202610291000_zomatik_z1_remitos.sql.
--
-- Especificación: docs/specs/2026-11-06-ajustar-np-al-finalizar.md (sección 10; decisiones de la 15).
-- CORRERLA FUERA DE HORARIO: candados cortos sobre zomatik_np_config y zomatik_np. Probarla antes en BEGIN … ROLLBACK.
--
-- Qué agrega (todo se agrega; no se borra nada de lo cargado):
--   zomatik_np_config.ajustar_activo  LLAVE PROPIA del ajuste por planta, APAGADA por defecto. Requiere la NP y la de
--                         remitir prendidas. Apagada: Finalizar, remitir, el saldo y "NP con saldo" quedan como hoy.
--   zomatik_np_config.ajustar_desde   desde cuándo: solo se ajustan los pedidos con algún despacho creado después.
--   zomatik_np.m3_original los m³ con que se creó la NP. `m3` pasa a ser lo vigente en Zomatik (después de editarla).
--   zomatik_np_ajustes    un ajuste por pedido y NP: qué cantidad tiene que quedar, qué se leyó en Zomatik, estado,
--                         paso y reintento (igual que zomatik_remitos). Solo la escribe el servidor.
--   zomatik_ajuste_tomar  toma un ajuste para el robot en una sola sentencia (copia de zomatik_remito_tomar).
--   zomatik_ajuste_aplicar  con la NP bloqueada: zomatik_np.m3 = objetivo, el uso del pedido = lo despachado y, si a
--                         la NP no le queda libre ni pedido activo, saldo_decision = 'cerrada'. Idempotente. Con
--                         p_resuelto_por: "Ya hice la devolución" (NP con factura, DEVOL a mano): lo mismo y queda 'a_mano'.
--   zomatik_remitos.sin_control_pendiente  un gerencial liberó ESA fila del control del pendiente ("Remitir igual"):
--                         el remito sale sin comparar lo que trae Zomatik. false por defecto.
--
-- Qué pasa con los datos ya cargados:
--   zomatik_np: m3_original = m3 en todas las filas (copia; m3 no cambia). Las NP nuevas lo toman al aplicar el primer
--               ajuste (coalesce), porque zomatik_np.m3 no cambia nunca antes de eso.
--   zomatik_np_config: la llave nueva nace apagada en Canning y Hudson.
--   zomatik_remitos: columna nueva sin_control_pendiente = false en todas las filas (no cambia nada de lo cargado).
--   zomatik_np_uso, zomatik_remito_despachos, zomatik_np_pedido, dispatches, scheduled_dispatches: no se tocan. Los pedidos finalizados antes de prender la llave no se ajustan solos.

SET lock_timeout = '3s';
SET statement_timeout = '60s';

ALTER TABLE public.zomatik_np_config ADD COLUMN IF NOT EXISTS ajustar_activo boolean NOT NULL DEFAULT false;
ALTER TABLE public.zomatik_np_config ADD COLUMN IF NOT EXISTS ajustar_desde timestamptz;
COMMENT ON COLUMN public.zomatik_np_config.ajustar_activo IS 'Zomatik: llave del ajuste de la NP a lo despachado al finalizar. false (por defecto) = la NP no se toca (como hoy). Requiere activo y remitir_activo.';
COMMENT ON COLUMN public.zomatik_np_config.ajustar_desde IS 'Zomatik: cuándo se prendió el ajuste: solo los pedidos con algún despacho creado después.';

ALTER TABLE public.zomatik_np ADD COLUMN IF NOT EXISTS m3_original numeric(10,3);
COMMENT ON COLUMN public.zomatik_np.m3_original IS 'Los m³ con que se creó la NP. m3 = lo vigente en Zomatik (después de un ajuste).';
UPDATE public.zomatik_np SET m3_original = m3 WHERE m3_original IS NULL;

ALTER TABLE public.zomatik_remitos ADD COLUMN IF NOT EXISTS sin_control_pendiente boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.zomatik_remitos.sin_control_pendiente IS 'Zomatik: un gerencial liberó este remito del control del pendiente de la NP ("Remitir igual"). Queda en Actividad con el motivo.';

CREATE TABLE IF NOT EXISTS public.zomatik_np_ajustes (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  np_id                  uuid NOT NULL REFERENCES public.zomatik_np(id),
  scheduled_dispatch_id  uuid REFERENCES public.scheduled_dispatches(id) ON DELETE SET NULL,
  plant_id               uuid NOT NULL,
  marca                  text NOT NULL UNIQUE,                   -- "Sistema Rebucret - pedido 1a2b3c4d - ajuste NP2 0001-00002090" (ASCII)
  -- Qué se hace: editar la cantidad, DEVOL (con factura), vaciar, NP adicional, nada. Nulo: para que lo mire una persona
  tipo                   text CHECK (tipo IS NULL OR tipo IN ('editar', 'devol', 'vaciar', 'adicional', 'nada')),
  m3_np                  numeric(10,3),                          -- la cantidad del renglón leída en Zomatik (o la de la base al armarlo)
  m3_objetivo            numeric(10,3),                          -- la que tiene que quedar
  m3_despachado          numeric(10,3),                          -- lo despachado del pedido que le toca a esta NP (queda en el uso)
  m3_devuelto            numeric(10,3),                          -- DEVOL (fase 2)
  con_factura            boolean,                                -- nulo = no se leyó
  factura_texto          text,                                   -- por qué se decidió que tiene factura (o lo que dijo Zomatik)
  devol_numero           text,                                   -- fase 2
  devol_codigo           integer,                                -- fase 2
  estado                 text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'generando', 'ok', 'nada', 'revisar', 'error', 'a_mano', 'anulado')),
  paso                   text,
  mensaje                text,
  intentos               integer NOT NULL DEFAULT 0,
  proximo_intento        timestamptz,
  en_curso_desde         timestamptz,
  aplicado_at            timestamptz,                            -- ya se pasó a la base (zomatik_ajuste_aplicar)
  aviso_juan_at          timestamptz,                            -- ya se mandó el mail de "la NP tiene factura"
  resuelto_por           text,                                   -- a_mano: quién
  resuelto_motivo        text,                                   -- a_mano: cómo
  created_by             text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  ok_at                  timestamptz,
  CONSTRAINT zomatik_np_ajustes_np_pedido_key UNIQUE (np_id, scheduled_dispatch_id)
);
CREATE INDEX IF NOT EXISTS zomatik_np_ajustes_pedido_idx ON public.zomatik_np_ajustes (scheduled_dispatch_id);
CREATE INDEX IF NOT EXISTS zomatik_np_ajustes_trabajo_idx ON public.zomatik_np_ajustes (estado, proximo_intento) WHERE estado IN ('pendiente', 'generando', 'error', 'revisar');
COMMENT ON TABLE public.zomatik_np_ajustes IS 'Zomatik: ajuste de la NP a lo despachado al finalizar el pedido (antes de la OF y el remito). Solo la escribe y la lee el servidor; el navegador la ve por la API.';

REVOKE ALL ON TABLE public.zomatik_np_ajustes FROM anon, authenticated;
GRANT ALL ON TABLE public.zomatik_np_ajustes TO service_role;

CREATE OR REPLACE FUNCTION public.zomatik_ajuste_tomar(p_id uuid, p_desde text[])
RETURNS TABLE (ajuste_id uuid, estado_anterior text, paso_anterior text)
LANGUAGE plpgsql
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH previa AS (
    SELECT a.id, a.estado, a.paso FROM zomatik_np_ajustes a WHERE a.id = p_id FOR UPDATE SKIP LOCKED
  ), tomada AS (
    UPDATE zomatik_np_ajustes a
       SET estado = 'generando', en_curso_desde = now(), intentos = a.intentos + 1, updated_at = now()
      FROM previa
     WHERE a.id = previa.id
       AND (previa.estado = ANY (p_desde) OR (previa.estado = 'generando' AND a.en_curso_desde < now() - interval '3 minutes'))
    RETURNING a.id, previa.estado, previa.paso
  )
  SELECT tomada.id, tomada.estado, tomada.paso FROM tomada;
END;
$$;

REVOKE ALL ON FUNCTION public.zomatik_ajuste_tomar(uuid, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zomatik_ajuste_tomar(uuid, text[]) TO service_role;

-- Pasar a la base un ajuste que Zomatik ya tiene (la NP en m3_objetivo). Con la NP bloqueada (no se pisa con una
-- reserva al mismo tiempo). Idempotente: si ya se aplicó, solo deja el ajuste en 'ok'. Devuelve {ok, libre} o {error}.
-- Con p_resuelto_por ("Ya hice la devolución": la NP tiene factura y un gerencial hizo la DEVOL de cant - objetivo a
-- mano): el ajuste tiene que estar en 'revisar' o 'error' con paso 'devol_a_mano', y queda 'a_mano' con el motivo.
CREATE OR REPLACE FUNCTION public.zomatik_ajuste_aplicar(p_id uuid, p_resuelto_por text DEFAULT NULL, p_motivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_a  zomatik_np_ajustes;
  v_np zomatik_np;
  v_s  record;
BEGIN
  SELECT * INTO v_a FROM zomatik_np_ajustes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'El ajuste no existe.');
  END IF;
  IF v_a.aplicado_at IS NOT NULL THEN
    UPDATE zomatik_np_ajustes SET estado = 'ok', paso = 'ok', en_curso_desde = NULL, proximo_intento = NULL, ok_at = coalesce(ok_at, now()), updated_at = now()
     WHERE id = p_id AND estado = 'generando';
    RETURN jsonb_build_object('ok', true, 'ya', true);
  END IF;
  IF p_resuelto_por IS NULL AND v_a.estado <> 'generando' THEN
    RETURN jsonb_build_object('error', 'El ajuste cambió mientras se trabajaba.');
  END IF;
  IF p_resuelto_por IS NOT NULL AND (v_a.estado NOT IN ('revisar', 'error') OR v_a.paso IS DISTINCT FROM 'devol_a_mano') THEN
    RETURN jsonb_build_object('error', 'El ajuste no está esperando la devolución. Actualizá la pantalla.');
  END IF;
  IF v_a.m3_objetivo IS NULL OR v_a.m3_objetivo <= 0 OR v_a.m3_despachado IS NULL THEN
    RETURN jsonb_build_object('error', 'Al ajuste le faltan los m³.');
  END IF;
  SELECT * INTO v_np FROM zomatik_np WHERE id = v_a.np_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'La NP no existe.');
  END IF;
  UPDATE zomatik_np SET m3_original = coalesce(m3_original, m3), m3 = v_a.m3_objetivo, updated_at = now() WHERE id = v_np.id;
  UPDATE zomatik_np_uso SET m3 = v_a.m3_despachado, updated_at = now()
   WHERE np_id = v_a.np_id AND scheduled_dispatch_id = v_a.scheduled_dispatch_id AND activo;
  SELECT * INTO v_s FROM zomatik_np_saldo(v_a.np_id);
  IF v_s.libre <= 0.001 AND NOT v_s.con_pedido_activo THEN
    UPDATE zomatik_np
       SET saldo_decision = 'cerrada', saldo_decision_por = 'Sistema', saldo_decision_at = now(), saldo_desde = NULL,
           saldo_mensaje = format('Ajustada a lo despachado (%s m³) al finalizar el pedido.', trim_scale(v_a.m3_objetivo)), updated_at = now()
     WHERE id = v_a.np_id;
  END IF;
  IF p_resuelto_por IS NOT NULL THEN
    UPDATE zomatik_np_ajustes
       SET estado = 'a_mano', paso = 'a_mano', aplicado_at = now(), m3_devuelto = round(coalesce(m3_np, v_np.m3) - m3_objetivo, 3), resuelto_por = p_resuelto_por,
           resuelto_motivo = p_motivo, mensaje = format('Devolución hecha a mano por %s: %s', p_resuelto_por, coalesce(p_motivo, '')), en_curso_desde = NULL, proximo_intento = NULL, updated_at = now()
     WHERE id = p_id;
  ELSE
    UPDATE zomatik_np_ajustes
       SET estado = 'ok', paso = 'ok', aplicado_at = now(), ok_at = now(), en_curso_desde = NULL, proximo_intento = NULL, mensaje = NULL, updated_at = now()
     WHERE id = p_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'libre', v_s.libre);
END;
$$;

REVOKE ALL ON FUNCTION public.zomatik_ajuste_aplicar(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zomatik_ajuste_aplicar(uuid, text, text) TO service_role;

RESET lock_timeout;
RESET statement_timeout;
