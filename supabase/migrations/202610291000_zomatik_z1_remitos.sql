-- Zomatik · Z1: "Finalizar pedido" → OF + remito en Zomatik — SIN APLICAR (avisar a Bautista antes)
-- Va DESPUÉS de 202610222200_zomatik_np.sql y 202610231000_zomatik_np_saldo.sql (las dos aplicadas).
--
-- Especificación: docs/migracion-loop/zomatik.md, sección 26.
-- CORRERLA FUERA DE HORARIO: candado corto sobre zomatik_np_config.
--
-- Qué agrega (todo se agrega; no se borra ni se cambia nada de lo cargado):
--   zomatik_np_config.remitir_activo  LLAVE PROPIA de Z1 por planta, APAGADA por defecto e independiente de la de la NP:
--                         con la NP prendida y esta apagada, el sistema no hace OF ni remitos (se cargan a mano, como
--                         hoy). Requiere la NP prendida (sin NP no hay contra qué remitir).
--   zomatik_remitos       tipo 'pedido': un remito por pedido, día y NP (17.1, confirmado el 29/10), con SU OF
--                         antes (16.3 A). tipo 'suelto': despacho manual sin pedido ni NP: solo la OF (el remito, a
--                         mano). Estado del par (pendiente, generando, ok, revisar, error), estado de la OF y del
--                         remito por separado (el remito puede quedar 'a_mano'), números, códigos, mensaje, paso y
--                         reintento, igual que zomatik_np.
--   zomatik_remito_despachos  qué despachos quedaron en qué remito. UNIQUE por despacho: un despacho nunca entra en
--                         dos remitos (no se puede duplicar).
--   zomatik_remito_tomar  toma una fila para el robot en una sola sentencia (como zomatik_np_tomar).
--
-- Qué pasa con los datos ya cargados: nada. Tablas nuevas vacías; la llave nueva queda apagada en las dos plantas.

SET lock_timeout = '3s';
SET statement_timeout = '60s';

ALTER TABLE public.zomatik_np_config ADD COLUMN IF NOT EXISTS remitir_activo boolean NOT NULL DEFAULT false;
ALTER TABLE public.zomatik_np_config ADD COLUMN IF NOT EXISTS remitir_desde timestamptz;
COMMENT ON COLUMN public.zomatik_np_config.remitir_activo IS 'Zomatik Z1: llave de OF + remito automáticos. false (por defecto) = se cargan a mano en Zomatik.';
COMMENT ON COLUMN public.zomatik_np_config.remitir_desde IS 'Zomatik Z1: cuándo se prendió: solo se remiten los despachos de ese momento en adelante.';

CREATE TABLE IF NOT EXISTS public.zomatik_remitos (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scheduled_dispatch_id  uuid REFERENCES public.scheduled_dispatches(id) ON DELETE SET NULL,
  tipo                   text NOT NULL DEFAULT 'pedido' CHECK (tipo IN ('pedido', 'suelto')),  -- suelto: despacho manual, solo OF
  np_id                  uuid REFERENCES public.zomatik_np(id),
  fecha                  date NOT NULL,                          -- día de los despachos (Argentina)
  plant_id               uuid NOT NULL,
  marca                  text NOT NULL UNIQUE,                   -- "Sistema Rebucret - pedido 1a2b3c4d - 2026-10-29 - NP 1" (no se duplica)
  comprobante            text CHECK (comprobante IN ('7', '19')),   -- 7 RM (con NP) · 19 RM2 (con NP2) · nulo en 'suelto'
  m3                     numeric(10,3) NOT NULL CHECK (m3 > 0),
  formula_id             uuid,
  patente                text,                                   -- la del primer camión (17.1)
  patentes               text,                                   -- todas, para observaciones
  remitos_papel          text,                                   -- números del papel (884, 885…)
  -- Estado del par (lo que se muestra)
  estado                 text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'generando', 'ok', 'revisar', 'error', 'anulado')),
  -- La OF (va antes: el remito exige stock, 16.3)
  of_estado              text NOT NULL DEFAULT 'pendiente' CHECK (of_estado IN ('pendiente', 'ok', 'revisar', 'error')),
  of_numero              text,
  of_codigo              integer,
  of_foto                text[],                                 -- OF del depósito que había antes de grabar (verifica un corte)
  -- El remito
  remito_estado          text NOT NULL DEFAULT 'pendiente' CHECK (remito_estado IN ('pendiente', 'ok', 'revisar', 'error', 'a_mano')),
  remito_numero          text,                                   -- "RM2 0099-00002746": el número usado (se ve en el pedido); antes de grabar, el elegido (verifica un corte)
  remito_codigo          integer,
  paso                   text,
  mensaje                text,
  intentos               integer NOT NULL DEFAULT 0,
  proximo_intento        timestamptz,
  en_curso_desde         timestamptz,
  created_by             text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  ok_at                  timestamptz,
  CONSTRAINT zomatik_remitos_tipo_datos_check CHECK (tipo = 'suelto' OR (np_id IS NOT NULL AND comprobante IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS zomatik_remitos_trabajo_idx ON public.zomatik_remitos (estado, proximo_intento) WHERE estado IN ('pendiente', 'generando', 'error', 'revisar');
COMMENT ON TABLE public.zomatik_remitos IS 'Zomatik Z1: OF + remito de un pedido, un día y una NP. La escribe solo el servidor; el navegador lee el estado.';

REVOKE ALL ON TABLE public.zomatik_remitos FROM anon, authenticated;
GRANT SELECT ON TABLE public.zomatik_remitos TO anon, authenticated;
GRANT ALL ON TABLE public.zomatik_remitos TO service_role;

CREATE TABLE IF NOT EXISTS public.zomatik_remito_despachos (
  remito_id    uuid NOT NULL REFERENCES public.zomatik_remitos(id) ON DELETE CASCADE,
  dispatch_id  uuid NOT NULL UNIQUE,                             -- un despacho, un solo remito
  m3           numeric(10,3) NOT NULL,
  PRIMARY KEY (remito_id, dispatch_id)
);
COMMENT ON TABLE public.zomatik_remito_despachos IS 'Zomatik Z1: despachos de cada remito. Un despacho nunca entra en dos remitos.';

REVOKE ALL ON TABLE public.zomatik_remito_despachos FROM anon, authenticated;
GRANT ALL ON TABLE public.zomatik_remito_despachos TO service_role;

CREATE OR REPLACE FUNCTION public.zomatik_remito_tomar(p_id uuid, p_desde text[])
RETURNS TABLE (remito_id uuid, estado_anterior text, paso_anterior text)
LANGUAGE plpgsql
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH previa AS (
    SELECT r.id, r.estado, r.paso FROM zomatik_remitos r WHERE r.id = p_id FOR UPDATE SKIP LOCKED
  ), tomada AS (
    UPDATE zomatik_remitos r
       SET estado = 'generando', en_curso_desde = now(), intentos = r.intentos + 1, updated_at = now()
      FROM previa
     WHERE r.id = previa.id
       AND (previa.estado = ANY (p_desde) OR (previa.estado = 'generando' AND r.en_curso_desde < now() - interval '3 minutes'))
    RETURNING r.id, previa.estado, previa.paso
  )
  SELECT tomada.id, tomada.estado, tomada.paso FROM tomada;
END;
$$;

REVOKE ALL ON FUNCTION public.zomatik_remito_tomar(uuid, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zomatik_remito_tomar(uuid, text[]) TO service_role;

-- Crear el remito (pendiente) y sus despachos en una sola transacción. Si algún despacho ya está en otro remito (UNIQUE)
-- o ya existe un remito con esa marca, no crea nada y devuelve nulo: nunca se duplica.
CREATE OR REPLACE FUNCTION public.zomatik_remito_crear(p jsonb)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO zomatik_remitos (tipo, scheduled_dispatch_id, np_id, fecha, plant_id, marca, comprobante, m3, formula_id, patente, patentes, remitos_papel, remito_estado, proximo_intento, created_by)
  VALUES (coalesce(p->>'tipo', 'pedido'), nullif(p->>'scheduled_dispatch_id', '')::uuid, nullif(p->>'np_id', '')::uuid, (p->>'fecha')::date, (p->>'plant_id')::uuid, p->>'marca',
          nullif(p->>'comprobante', ''), (p->>'m3')::numeric, nullif(p->>'formula_id', '')::uuid, p->>'patente', p->>'patentes', p->>'remitos_papel',
          CASE WHEN p->>'tipo' = 'suelto' THEN 'a_mano' ELSE 'pendiente' END, now(), p->>'created_by')
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;
  BEGIN
    INSERT INTO zomatik_remito_despachos (remito_id, dispatch_id, m3)
    SELECT v_id, (x->>'id')::uuid, (x->>'m3')::numeric FROM jsonb_array_elements(p->'despachos') x;
  EXCEPTION WHEN unique_violation THEN
    DELETE FROM zomatik_remitos WHERE id = v_id;     -- un despacho ya estaba en otro remito: no se crea
    RETURN NULL;
  END;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.zomatik_remito_crear(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zomatik_remito_crear(jsonb) TO service_role;

RESET lock_timeout;
RESET statement_timeout;
