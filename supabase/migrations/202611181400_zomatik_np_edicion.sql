-- Zomatik · editar la NP cuando el pedido cambia de m³ (antes de terminar) — SIN APLICAR (la corre Bautista después de
-- que el revisor apruebe). Va DESPUÉS de 202611061200_zomatik_np_ajuste.sql. Se puede correr dos veces.
--
-- Especificación: docs/specs/2026-11-18-editar-np-al-cambiar-pedido.md (sección 4; la 14 manda sobre la 12).
-- CORRERLA FUERA DE HORARIO y ANTES de publicar el código: candados cortos sobre zomatik_np_config y zomatik_np_ajustes.
-- Va entera en una transacción (BEGIN … COMMIT): para probarla antes, cambiar el COMMIT del final por ROLLBACK.
--
-- Qué cambia (se agrega; no se borra ningún dato):
--   zomatik_np_config.editar_activo  LLAVE PROPIA de la edición por planta, APAGADA por defecto. Requiere la de la NP
--                         (activo). No requiere remitir ni el ajuste al finalizar. Apagada: todo como hoy.
--   zomatik_np_config.editar_desde   de registro: cuándo se prendió.
--   zomatik_np_ajustes.origen        'finalizar' (el ajuste al finalizar, todo lo de hoy) o 'pedido' (la edición por un
--                         cambio del pedido). Por defecto 'finalizar'.
--   zomatik_np_ajustes.m3_uso_objetivo  la reserva del pedido en la NP después de editarla (solo 'pedido').
--   UNIQUE (np_id, scheduled_dispatch_id) → dos índices únicos parciales: lo mismo de hoy para 'finalizar', y UNA sola
--                         edición abierta (pendiente, generando, revisar, error) por NP para 'pedido'.
--   zomatik_np_edicion_aplicar (nueva)  con la fila y la NP bloqueadas: la NP en m3_objetivo y la reserva del pedido en
--                         m3_uso_objetivo, juntas, solo si son las que grabó el robot en Zomatik (p_m3_objetivo,
--                         p_m3_uso) y la reserva entra en la NP. No cierra el saldo ni toca saldo_desde. Idempotente.
--   zomatik_ajuste_aplicar  igual que antes, con un control más al principio: solo acepta filas 'finalizar'.
--
-- Qué pasa con los datos ya cargados:
--   zomatik_np_ajustes: todas las filas quedan origen = 'finalizar' (el default) y m3_uso_objetivo nulo. El índice
--               parcial nuevo de 'finalizar' protege exactamente lo mismo que el UNIQUE de hoy (todas son 'finalizar'):
--               ninguna fila choca al crearlo.
--   zomatik_np_config: editar_activo = false y editar_desde nulo en Canning y Hudson. Con la llave apagada no se crea
--               ninguna fila 'pedido' y todo sigue como hoy.
--   zomatik_np, zomatik_np_uso, zomatik_remitos, zomatik_remito_despachos, zomatik_np_pedido, scheduled_dispatches,
--   dispatches: no se tocan. Las NP adicionales que ya existen (Cordones 0001-00001197) quedan como están.
--   Al prender la llave no se edita nada solo: la edición nace solo de un cambio del pedido.
--   Con el código de main (que no lee `origen`) no cambia nada: todo lo que escribe queda 'finalizar'.

SET lock_timeout = '3s';
SET statement_timeout = '60s';

BEGIN;

ALTER TABLE public.zomatik_np_config ADD COLUMN IF NOT EXISTS editar_activo boolean NOT NULL DEFAULT false;
ALTER TABLE public.zomatik_np_config ADD COLUMN IF NOT EXISTS editar_desde timestamptz;
COMMENT ON COLUMN public.zomatik_np_config.editar_activo IS 'Zomatik: llave de la edición de la NP cuando el pedido cambia de m³ (spec 2026-11-18). false (por defecto) = NP adicional o saldo, como antes. Requiere activo.';
COMMENT ON COLUMN public.zomatik_np_config.editar_desde IS 'Zomatik: cuándo se prendió la edición de la NP (de registro).';

ALTER TABLE public.zomatik_np_ajustes ADD COLUMN IF NOT EXISTS origen text NOT NULL DEFAULT 'finalizar';
ALTER TABLE public.zomatik_np_ajustes ADD COLUMN IF NOT EXISTS m3_uso_objetivo numeric(10,3);
-- El CHECK aparte y con nombre: al correrla dos veces no se duplica (un CHECK dentro de ADD COLUMN IF NOT EXISTS
-- depende de la versión de Postgres)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'zomatik_np_ajustes_origen_check' AND conrelid = 'public.zomatik_np_ajustes'::regclass) THEN
    ALTER TABLE public.zomatik_np_ajustes ADD CONSTRAINT zomatik_np_ajustes_origen_check CHECK (origen IN ('finalizar', 'pedido'));
  END IF;
END;
$$;
COMMENT ON COLUMN public.zomatik_np_ajustes.origen IS 'Zomatik: finalizar = ajuste a lo despachado al finalizar el pedido; pedido = edición de la NP por un cambio de m³ del pedido.';
COMMENT ON COLUMN public.zomatik_np_ajustes.m3_uso_objetivo IS 'Zomatik (solo origen pedido): la reserva del pedido en la NP después de editarla.';

ALTER TABLE public.zomatik_np_ajustes DROP CONSTRAINT IF EXISTS zomatik_np_ajustes_np_pedido_key;
CREATE UNIQUE INDEX IF NOT EXISTS zomatik_np_ajustes_finalizar_key ON public.zomatik_np_ajustes (np_id, scheduled_dispatch_id) WHERE origen = 'finalizar';
CREATE UNIQUE INDEX IF NOT EXISTS zomatik_np_ajustes_edicion_abierta_key ON public.zomatik_np_ajustes (np_id) WHERE origen = 'pedido' AND estado IN ('pendiente', 'generando', 'revisar', 'error');

-- Pasar a la base una edición que Zomatik ya tiene (la NP en m3_objetivo): con la fila y la NP bloqueadas (no se pisa
-- con una reserva al mismo tiempo), la NP y la reserva del pedido cambian juntas. p_m3_objetivo / p_m3_uso: lo que el
-- robot grabó en Zomatik y la reserva que decidió; si la fila dice otra cosa, no se aplica nada (nunca una NP de 9 con
-- una reserva de 10). Si el pedido ya no usa la NP (uso inactivo), solo la NP. No cierra el saldo ni toca saldo_desde (el
-- pedido sigue activo). Idempotente: si ya se aplicó, solo la deja 'ok'. Devuelve {ok} o {error}.
-- Las dos firmas posibles de antes (de un parámetro, o de tres con DEFAULT: CREATE OR REPLACE no le puede sacar los
-- DEFAULT), así se puede correr dos veces
DROP FUNCTION IF EXISTS public.zomatik_np_edicion_aplicar(uuid);
DROP FUNCTION IF EXISTS public.zomatik_np_edicion_aplicar(uuid, numeric, numeric);
CREATE FUNCTION public.zomatik_np_edicion_aplicar(p_id uuid, p_m3_objetivo numeric, p_m3_uso numeric)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_a  zomatik_np_ajustes;
  v_np zomatik_np;
BEGIN
  SELECT * INTO v_a FROM zomatik_np_ajustes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'La edición no existe.');
  END IF;
  IF v_a.origen IS DISTINCT FROM 'pedido' THEN
    RETURN jsonb_build_object('error', 'No es una edición de la NP por un cambio del pedido.');
  END IF;
  IF v_a.aplicado_at IS NOT NULL THEN
    UPDATE zomatik_np_ajustes SET estado = 'ok', paso = 'ok', en_curso_desde = NULL, proximo_intento = NULL, ok_at = coalesce(ok_at, now()), updated_at = now()
     WHERE id = p_id AND estado = 'generando';
    RETURN jsonb_build_object('ok', true, 'ya', true);
  END IF;
  IF v_a.estado <> 'generando' THEN
    RETURN jsonb_build_object('error', 'La edición cambió mientras se trabajaba.');
  END IF;
  IF v_a.m3_objetivo IS NULL OR v_a.m3_objetivo <= 0 OR v_a.m3_uso_objetivo IS NULL OR v_a.m3_uso_objetivo < 0 THEN
    RETURN jsonb_build_object('error', 'A la edición le faltan los m³.');
  END IF;
  IF p_m3_objetivo IS NULL OR p_m3_uso IS NULL OR abs(v_a.m3_objetivo - p_m3_objetivo) > 0.001 OR abs(v_a.m3_uso_objetivo - p_m3_uso) > 0.001 THEN
    RETURN jsonb_build_object('error', 'La edición cambió mientras se trabajaba.');
  END IF;
  IF v_a.m3_uso_objetivo > v_a.m3_objetivo + 0.001 THEN
    RETURN jsonb_build_object('error', 'La reserva del pedido no entra en la NP.');
  END IF;
  SELECT * INTO v_np FROM zomatik_np WHERE id = v_a.np_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'La NP no existe.');
  END IF;
  UPDATE zomatik_np SET m3_original = coalesce(m3_original, m3), m3 = v_a.m3_objetivo, updated_at = now() WHERE id = v_np.id;
  UPDATE zomatik_np_uso SET m3 = v_a.m3_uso_objetivo, updated_at = now()
   WHERE np_id = v_a.np_id AND scheduled_dispatch_id = v_a.scheduled_dispatch_id AND activo;
  UPDATE zomatik_np_ajustes
     SET estado = 'ok', paso = 'ok', aplicado_at = now(), ok_at = now(), en_curso_desde = NULL, proximo_intento = NULL, mensaje = NULL, updated_at = now()
   WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.zomatik_np_edicion_aplicar(uuid, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zomatik_np_edicion_aplicar(uuid, numeric, numeric) TO service_role;

-- La misma función de 202611061200_zomatik_np_ajuste.sql con UN control más al principio: solo filas 'finalizar' (una
-- edición por cambio del pedido no deja la reserva en lo despachado ni cierra el saldo).
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
  IF v_a.origen <> 'finalizar' THEN
    RETURN jsonb_build_object('error', 'No es un ajuste al finalizar.');
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

COMMIT;

RESET lock_timeout;
RESET statement_timeout;
