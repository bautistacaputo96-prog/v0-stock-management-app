-- Ingresos de materia prima desde Zomatik (docs/specs/2026-11-05-ingresos-mp-desde-zomatik.md, 5.1, con las respuestas de
-- Bautista del 05/11; ficha: docs/ingresos-mp-zomatik.md).
-- SIN APLICAR. Bautista la aprueba antes de correrla, fuera de horario. Se puede correr dos veces. Vuelta atrás al final.
--
-- Qué agrega o cambia:
--   stock_entries.origen          'manual' | 'zomatik' | NULL (NULL = como hasta hoy: cargado a mano). Columna nueva, nula.
--   stock_entries.anulado_at      cuándo se anuló (Zomatik lo anuló, o un gerencial eliminó un manual desde F). Un
--                                 ingreso anulado queda con cantidad 0: no se borra (conserva humedad, ensayo y excedente).
--   stock_movements.movement_type suma 'correccion_ingreso' (el asiento de cada corrección o anulación de un ingreso; el
--                                 control de stock no lo cuenta en el período: el ingreso ya tiene la cantidad nueva).
--   zomatik_ingresos_mp           una fila por remito de Zomatik (clave = número completo + artículo), con su ingreso.
--   control_mp_corridas.origen    suma 'pasada' (la lectura cada 30 min y la de la noche).
--   control_mp_registrar()        'pasada': una cada 20 min como mínimo y nunca dos corridas a la vez.
--   mp_zomatik_aplicar(jsonb)     aplica el plan de una pasada (altas, emparejados, correcciones, anulaciones, cambios de
--                                 planta, pendientes). Cada acción en su bloque: una que falla no frena las otras.
--   mp_ingreso_editar(jsonb)      la edición a mano del historial, ahora con asiento (antes cambiaba el stock sin asiento).
--   mp_ingreso_anular(jsonb)      "Eliminar" un ingreso a mano desde F que no está en Zomatik: lo anula con asiento.
--   Todo lo nuevo lo usa solo el servidor (service_role). El navegador no ve zomatik_ingresos_mp ni las funciones.
--
-- Qué pasa con los datos ya cargados:
--   - stock_entries: las filas existentes quedan con origen y anulado_at nulos: se ven y suman igual que hoy. No se
--     modifica ninguna fila. El CHECK nuevo de origen lo cumplen todas (son nulas).
--   - stock_movements: no se toca ninguna fila; el CHECK nuevo acepta los 4 tipos de siempre más 'correccion_ingreso'.
--   - materials, granulometria_tests, humidity_excess_log, control_mp_diferencias, zomatik_remitos_compra: no se tocan.
--   - control_mp_corridas: las corridas viejas ('cron', 'manual') cumplen el CHECK nuevo.
--   - La importación arranca APAGADA: sin la fila 'mp_ingresos_zomatik' en integraciones la pasada lee Zomatik y no
--     planea nada. Con modo 'sombra' calcula el plan sin escribir; recién con modo 'real' (y desde la fecha F) el robot
--     suma ingresos y corrige cantidades con asiento. Nunca cambia la cantidad de ingresos con fecha anterior a F.
--
-- Bloqueos: los ALTER de stock_entries y stock_movements toman un candado corto (columnas nulas sin default: no
-- reescriben la tabla). El CHECK nuevo de stock_movements se valida en la misma transacción: recorre la tabla una vez
-- (unos segundos como mucho) con el candado tomado. Si no consigue el candado en 3 s, la migración entera no hace nada.

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- stock_entries: origen y anulación
-- ---------------------------------------------------------------------------
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS origen text;
ALTER TABLE public.stock_entries ADD COLUMN IF NOT EXISTS anulado_at timestamptz;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_entries_origen_check') THEN
    ALTER TABLE public.stock_entries ADD CONSTRAINT stock_entries_origen_check CHECK (origen IS NULL OR origen IN ('manual', 'zomatik'));
  END IF;
END $$;
COMMENT ON COLUMN public.stock_entries.origen IS 'Ingresos MP desde Zomatik: manual | zomatik | NULL (= cargado a mano, antes de la importación)';
COMMENT ON COLUMN public.stock_entries.anulado_at IS 'Ingresos MP desde Zomatik: anulado (cantidad 0, con asiento correccion_ingreso). No se borra.';

-- ---------------------------------------------------------------------------
-- stock_movements: el asiento de las correcciones de ingresos
-- ---------------------------------------------------------------------------
ALTER TABLE public.stock_movements DROP CONSTRAINT IF EXISTS stock_movements_movement_type_check;
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_movement_type_check
  CHECK ((movement_type)::text = ANY (ARRAY['ingreso', 'consumo', 'ajuste', 'transferencia', 'correccion_ingreso']::text[])) NOT VALID;
ALTER TABLE public.stock_movements VALIDATE CONSTRAINT stock_movements_movement_type_check;

-- ---------------------------------------------------------------------------
-- Vínculo de cada remito de Zomatik con su ingreso
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.zomatik_ingresos_mp (
  id                   bigserial PRIMARY KEY,
  clave                text NOT NULL UNIQUE,            -- "2-318903|10000004" (número completo + artículo); "#2" = repetido
  estado               text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('importado', 'emparejado', 'pendiente', 'anulado', 'descartado')),
  motivo               text,                            -- por qué está pendiente (o qué no se pudo actualizar)
  motivo_codigo        text,                            -- sin_numero, repetido, sin_deposito, material, cantidad, unidad, densidad, dudoso, borrado…
  stock_entry_id       uuid REFERENCES public.stock_entries(id) ON DELETE SET NULL,
  fecha                date,
  remito               text,
  remito_norm          text,
  orden_compra         text,
  proveedor            text,
  codigo_articulo      text,
  articulo             text,
  cantidad_t           numeric,                         -- toneladas (áridos y cemento)
  cantidad_zomatik     numeric,                         -- la cantidad tal como viene de Zomatik
  unidad_zomatik       text,                            -- t | kg | l | tacho
  deposito             integer,
  plant_id             uuid REFERENCES public.plants(id) ON DELETE SET NULL,
  material_id          uuid REFERENCES public.materials(id) ON DELETE SET NULL,
  transportista        text,
  kg_asentado          numeric,                         -- la cantidad del ingreso que vio el robot (unidad del material)
  proveedor_por_robot  boolean NOT NULL DEFAULT false,  -- true = proveedor y flete los eligió el robot (los puede actualizar)
  era_manual           boolean NOT NULL DEFAULT false,  -- el ingreso lo había cargado una persona (emparejado)
  datos                jsonb,                           -- el renglón del export sin precios
  candidato_id         uuid REFERENCES public.stock_entries(id) ON DELETE SET NULL,  -- "¿mismo camión que…?"
  rechazados           uuid[] NOT NULL DEFAULT '{}',    -- ingresos a mano que "son distintos" (no se vuelven a proponer)
  resolucion           text CHECK (resolucion IS NULL OR resolucion IN ('mismo', 'distintos', 'descartar')),
  resuelto_por         text,
  resuelto_at          timestamptz,
  nota                 text,
  primera_vez_at       timestamptz NOT NULL DEFAULT now(),
  visto_at             timestamptz NOT NULL DEFAULT now(),
  falta_desde          timestamptz,                     -- no está en Zomatik desde (se anula 2 h después)
  anulado_at           timestamptz,
  aviso_humedad_at     timestamptz,                     -- ya se avisó que la Arena Fina sigue sin humedad (una vez)
  actualizado_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS zomatik_ingresos_mp_estado_idx ON public.zomatik_ingresos_mp (estado);
CREATE INDEX IF NOT EXISTS zomatik_ingresos_mp_fecha_idx ON public.zomatik_ingresos_mp (fecha);
-- Un ingreso tiene a lo sumo un remito de Zomatik
CREATE UNIQUE INDEX IF NOT EXISTS zomatik_ingresos_mp_stock_entry_key ON public.zomatik_ingresos_mp (stock_entry_id) WHERE stock_entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS zomatik_ingresos_mp_candidato_idx ON public.zomatik_ingresos_mp (candidato_id) WHERE candidato_id IS NOT NULL;
COMMENT ON TABLE public.zomatik_ingresos_mp IS 'Ingresos MP desde Zomatik: un remito de Zomatik (número + artículo) y su stock_entries. Solo servidor.';

ALTER TABLE public.zomatik_ingresos_mp ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.zomatik_ingresos_mp FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.zomatik_ingresos_mp_id_seq FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.zomatik_ingresos_mp TO service_role;
GRANT ALL ON SEQUENCE public.zomatik_ingresos_mp_id_seq TO service_role;

-- ---------------------------------------------------------------------------
-- Corridas: la pasada
-- ---------------------------------------------------------------------------
ALTER TABLE public.control_mp_corridas DROP CONSTRAINT IF EXISTS control_mp_corridas_origen_check;
ALTER TABLE public.control_mp_corridas ADD CONSTRAINT control_mp_corridas_origen_check CHECK (origen IN ('cron', 'manual', 'pasada'));

CREATE OR REPLACE FUNCTION public.control_mp_registrar(p_origen text, p_usuario text)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_origen NOT IN ('cron', 'manual', 'pasada') THEN
    RETURN jsonb_build_object('motivo', 'Origen inválido');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('control_mp_registrar'));
  IF EXISTS (SELECT 1 FROM control_mp_corridas WHERE fin IS NULL AND inicio > now() - interval '6 minutes') THEN
    RETURN jsonb_build_object('motivo', 'Ya se está controlando. Esperá un minuto.');
  END IF;
  IF p_origen = 'manual' AND EXISTS (SELECT 1 FROM control_mp_corridas WHERE inicio > now() - interval '2 minutes') THEN
    RETURN jsonb_build_object('motivo', 'Se controló hace menos de 2 min. Esperá un rato.');
  END IF;
  IF p_origen = 'cron' AND EXISTS (SELECT 1 FROM control_mp_corridas WHERE origen = 'cron' AND inicio > now() - interval '60 minutes') THEN
    RETURN jsonb_build_object('motivo', 'El control diario ya corrió hace menos de una hora.');
  END IF;
  IF p_origen = 'pasada' AND EXISTS (SELECT 1 FROM control_mp_corridas WHERE origen = 'pasada' AND inicio > now() - interval '20 minutes') THEN
    RETURN jsonb_build_object('motivo', 'La pasada ya corrió hace menos de 20 min.');
  END IF;
  INSERT INTO control_mp_corridas (origen, usuario) VALUES (p_origen, nullif(trim(coalesce(p_usuario, '')), '')) RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.control_mp_registrar(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.control_mp_registrar(text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- Cambiar la cantidad de un ingreso con asiento (corrección, anulación, edición a mano)
--   quantity = original_quantity = kg nuevo; dry_quantity con la humedad del ingreso;
--   materials.current_stock += diferencia (SIN GREATEST(0, …)); dry_stock si el material corrige humedad;
--   stock_movements 'correccion_ingreso' con la diferencia. El excedente de humedad no acreditado sigue a la cantidad.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._mp_cambiar_cantidad(p_entry_id uuid, p_kg numeric, p_ref text, p_nota text, p_anular boolean, p_desanular boolean)
RETURNS numeric
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  e          stock_entries;
  m          materials;
  v_kg       numeric := round(coalesce(p_kg, 0), 2);
  v_diff     numeric;
  v_seco_v   numeric;
  v_seco_n   numeric;
  v_dia      date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
BEGIN
  IF v_kg < 0 THEN
    RAISE EXCEPTION 'Cantidad inválida';
  END IF;
  SELECT * INTO e FROM stock_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El ingreso ya no existe';
  END IF;
  SELECT * INTO m FROM materials WHERE id = e.material_id FOR UPDATE;
  v_diff := round(v_kg - coalesce(e.quantity, 0), 2);
  v_seco_v := coalesce(e.dry_quantity, e.quantity, 0);
  v_seco_n := CASE WHEN coalesce(e.humidity_percentage, 0) > 0 THEN round(v_kg / (1 + e.humidity_percentage / 100), 2) ELSE v_kg END;
  UPDATE stock_entries
     SET quantity = v_kg,
         original_quantity = v_kg,
         dry_quantity = v_seco_n,
         anulado_at = CASE WHEN p_anular THEN now() WHEN p_desanular THEN NULL ELSE anulado_at END
   WHERE id = e.id;
  IF v_diff <> 0 THEN
    UPDATE materials SET current_stock = coalesce(current_stock, 0) + v_diff, updated_at = now() WHERE id = m.id;
    INSERT INTO stock_movements (material_id, movement_type, quantity_kg, reference_type, reference_id, movement_date, notes)
    VALUES (m.id, 'correccion_ingreso', v_diff, p_ref, e.id, v_dia, left(coalesce(p_nota, ''), 500));
  END IF;
  IF coalesce(m.corrige_humedad, false) AND v_seco_n <> v_seco_v THEN
    UPDATE materials SET dry_stock = coalesce(dry_stock, 0) + (v_seco_n - v_seco_v) WHERE id = m.id;
  END IF;
  IF NOT coalesce(p_anular, false) AND v_kg > 0 THEN
    UPDATE humidity_excess_log
       SET original_quantity_kg = v_kg,
           excess_quantity_kg = round(v_kg * excess_humidity_percentage / 100, 2),
           excess_quantity_tn = round(v_kg * excess_humidity_percentage / 100 / 1000, 4)
     WHERE stock_entry_id = e.id AND NOT coalesce(credited, false);
  END IF;
  RETURN v_diff;
END;
$$;

-- Ingreso nuevo de Zomatik: el INSERT lo suma al stock (trigger update_stock_after_entry); el stock seco, acá.
CREATE OR REPLACE FUNCTION public._mp_insertar_ingreso(p jsonb)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id  uuid;
  v_kg  numeric := round((p->>'quantity')::numeric, 2);
BEGIN
  IF v_kg IS NULL OR v_kg <= 0 THEN
    RAISE EXCEPTION 'Cantidad inválida';
  END IF;
  INSERT INTO stock_entries (material_id, quantity, original_quantity, dry_quantity, supplier_id, supplier, carrier_id, remito, entry_date, created_by, origen, sample_taken_granulometry)
  VALUES ((p->>'material_id')::uuid, v_kg, v_kg, v_kg, nullif(p->>'supplier_id', '')::uuid, nullif(p->>'supplier', ''), nullif(p->>'carrier_id', '')::uuid,
          nullif(p->>'remito', ''), (p->>'entry_date')::timestamptz, 'Zomatik', 'zomatik', false)
  RETURNING id INTO v_id;
  UPDATE materials SET dry_stock = coalesce(dry_stock, 0) + v_kg WHERE id = (p->>'material_id')::uuid AND coalesce(corrige_humedad, false);
  RETURN v_id;
END;
$$;

-- Columnas del vínculo que trae la acción (solo las que vienen). falta_desde: 'ahora' = now() si no estaba.
CREATE OR REPLACE FUNCTION public._mp_vinculo_set(p_id bigint, p jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  p := coalesce(p, '{}'::jsonb);
  UPDATE zomatik_ingresos_mp SET
    fecha            = CASE WHEN p ? 'fecha' THEN (p->>'fecha')::date ELSE fecha END,
    remito           = CASE WHEN p ? 'remito' THEN p->>'remito' ELSE remito END,
    remito_norm      = CASE WHEN p ? 'remito_norm' THEN p->>'remito_norm' ELSE remito_norm END,
    orden_compra     = CASE WHEN p ? 'orden_compra' THEN p->>'orden_compra' ELSE orden_compra END,
    proveedor        = CASE WHEN p ? 'proveedor' THEN p->>'proveedor' ELSE proveedor END,
    codigo_articulo  = CASE WHEN p ? 'codigo_articulo' THEN p->>'codigo_articulo' ELSE codigo_articulo END,
    articulo         = CASE WHEN p ? 'articulo' THEN p->>'articulo' ELSE articulo END,
    cantidad_t       = CASE WHEN p ? 'cantidad_t' THEN (p->>'cantidad_t')::numeric ELSE cantidad_t END,
    cantidad_zomatik = CASE WHEN p ? 'cantidad_zomatik' THEN (p->>'cantidad_zomatik')::numeric ELSE cantidad_zomatik END,
    unidad_zomatik   = CASE WHEN p ? 'unidad_zomatik' THEN p->>'unidad_zomatik' ELSE unidad_zomatik END,
    deposito         = CASE WHEN p ? 'deposito' THEN (p->>'deposito')::integer ELSE deposito END,
    plant_id         = CASE WHEN p ? 'plant_id' THEN nullif(p->>'plant_id', '')::uuid ELSE plant_id END,
    material_id      = CASE WHEN p ? 'material_id' THEN nullif(p->>'material_id', '')::uuid ELSE material_id END,
    transportista    = CASE WHEN p ? 'transportista' THEN p->>'transportista' ELSE transportista END,
    datos            = CASE WHEN p ? 'datos' THEN CASE WHEN jsonb_typeof(p->'datos') = 'null' THEN NULL ELSE p->'datos' END ELSE datos END,
    motivo           = CASE WHEN p ? 'motivo' THEN p->>'motivo' ELSE motivo END,
    motivo_codigo    = CASE WHEN p ? 'motivo_codigo' THEN p->>'motivo_codigo' ELSE motivo_codigo END,
    candidato_id     = CASE WHEN p ? 'candidato_id' THEN nullif(p->>'candidato_id', '')::uuid ELSE candidato_id END,
    falta_desde      = CASE WHEN p ? 'falta_desde' THEN CASE WHEN p->>'falta_desde' = 'ahora' THEN coalesce(falta_desde, now()) ELSE (p->>'falta_desde')::timestamptz END ELSE falta_desde END,
    visto_at         = now(),
    actualizado_at   = now()
  WHERE id = p_id;
END;
$$;

-- Una acción del plan. Lo que no corresponde (otra pasada ya lo hizo, el ingreso cambió) se saltea sin escribir.
CREATE OR REPLACE FUNCTION public._mp_aplicar_una(a jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  t      text := a->>'tipo';
  c      text := a->>'clave';
  vin    jsonb := coalesce(a->'vinculo', '{}'::jsonb);
  ing    jsonb := a->'ingreso';
  v      zomatik_ingresos_mp;
  e      stock_entries;
  v_id   uuid;
  v_reem boolean;
BEGIN
  IF c IS NULL OR c = '' THEN
    RAISE EXCEPTION 'Falta la clave';
  END IF;
  IF t IN ('alta', 'emparejar', 'pendiente') THEN
    INSERT INTO zomatik_ingresos_mp (clave, estado) VALUES (c, 'pendiente') ON CONFLICT (clave) DO NOTHING;
  END IF;
  SELECT * INTO v FROM zomatik_ingresos_mp WHERE clave = c FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'No existe el vínculo');
  END IF;

  IF t = 'alta' THEN
    IF v.estado <> 'pendiente' OR v.stock_entry_id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'motivo', 'Ya estaba');
    END IF;
    v_id := public._mp_insertar_ingreso(ing);
    PERFORM public._mp_vinculo_set(v.id, vin);
    UPDATE zomatik_ingresos_mp
       SET estado = 'importado', stock_entry_id = v_id, kg_asentado = round((ing->>'quantity')::numeric, 2), proveedor_por_robot = true,
           motivo = NULL, motivo_codigo = NULL, candidato_id = NULL, falta_desde = NULL, anulado_at = NULL
     WHERE id = v.id;
    RETURN jsonb_build_object('ok', true, 'stock_entry_id', v_id);

  ELSIF t = 'emparejar' THEN
    IF v.estado <> 'pendiente' OR v.stock_entry_id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'motivo', 'Ya estaba');
    END IF;
    SELECT * INTO e FROM stock_entries WHERE id = (a->>'entry_id')::uuid FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'motivo', 'El ingreso a mano ya no existe');
    END IF;
    IF e.anulado_at IS NOT NULL OR coalesce(e.origen, 'manual') <> 'manual' THEN
      RETURN jsonb_build_object('ok', false, 'motivo', 'El ingreso a mano está anulado o ya es de Zomatik');
    END IF;
    IF EXISTS (SELECT 1 FROM zomatik_ingresos_mp WHERE stock_entry_id = e.id) THEN
      RETURN jsonb_build_object('ok', false, 'motivo', 'El ingreso a mano ya está emparejado');
    END IF;
    IF round(coalesce(e.quantity, 0), 2) <> round((a->>'kg_manual_visto')::numeric, 2) THEN
      RETURN jsonb_build_object('ok', false, 'motivo', 'El ingreso a mano cambió');
    END IF;
    v_reem := coalesce((a->>'reemplazar')::boolean, false);
    IF v_reem THEN
      -- Desde F el manual pasa a ser el importado (mismo id: sus muestras quedan), con la cantidad de Zomatik
      UPDATE stock_entries SET origen = 'zomatik' WHERE id = e.id;
      IF a->>'kg_nuevo' IS NOT NULL THEN
        PERFORM public._mp_cambiar_cantidad(e.id, (a->>'kg_nuevo')::numeric, 'zomatik', a->>'nota', false, false);
      END IF;
    END IF;
    PERFORM public._mp_vinculo_set(v.id, vin);
    UPDATE zomatik_ingresos_mp
       SET estado = CASE WHEN v_reem THEN 'importado' ELSE 'emparejado' END,
           stock_entry_id = e.id,
           kg_asentado = (SELECT quantity FROM stock_entries WHERE id = e.id),
           era_manual = true, proveedor_por_robot = false, candidato_id = NULL, falta_desde = NULL
     WHERE id = v.id;
    RETURN jsonb_build_object('ok', true, 'stock_entry_id', e.id);

  ELSIF t IN ('corregir', 'anular', 'mover') THEN
    IF v.stock_entry_id IS NULL OR v.stock_entry_id <> (a->>'entry_id')::uuid THEN
      RETURN jsonb_build_object('ok', false, 'motivo', 'El vínculo apunta a otro ingreso');
    END IF;
    IF round(coalesce(v.kg_asentado, 0), 2) <> round((a->>'kg_visto')::numeric, 2) THEN
      RETURN jsonb_build_object('ok', false, 'motivo', 'Otra pasada ya lo cambió');
    END IF;
    IF t = 'corregir' THEN
      IF v.estado <> CASE WHEN coalesce((a->>'desanular')::boolean, false) THEN 'anulado' ELSE 'importado' END THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'Cambió el estado');
      END IF;
      PERFORM public._mp_cambiar_cantidad(v.stock_entry_id, (a->>'kg_nuevo')::numeric, 'zomatik', a->>'nota', false, coalesce((a->>'desanular')::boolean, false));
      PERFORM public._mp_vinculo_set(v.id, vin);
      UPDATE zomatik_ingresos_mp SET estado = 'importado', kg_asentado = round((a->>'kg_nuevo')::numeric, 2), falta_desde = NULL, anulado_at = NULL WHERE id = v.id;
      RETURN jsonb_build_object('ok', true, 'stock_entry_id', v.stock_entry_id);
    ELSIF t = 'anular' THEN
      IF v.estado <> 'importado' THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'Cambió el estado');
      END IF;
      PERFORM public._mp_cambiar_cantidad(v.stock_entry_id, 0, 'zomatik', a->>'nota', true, false);
      UPDATE zomatik_ingresos_mp SET estado = 'anulado', kg_asentado = 0, falta_desde = NULL, anulado_at = now(), actualizado_at = now() WHERE id = v.id;
      RETURN jsonb_build_object('ok', true, 'stock_entry_id', v.stock_entry_id);
    ELSE
      IF v.estado NOT IN ('importado', 'anulado') THEN
        RETURN jsonb_build_object('ok', false, 'motivo', 'Cambió el estado');
      END IF;
      -- Cambio de planta: anula en la vieja y da de alta en la nueva, en la misma transacción
      IF coalesce((a->>'anular_viejo')::boolean, false) AND (SELECT anulado_at FROM stock_entries WHERE id = v.stock_entry_id) IS NULL THEN
        PERFORM public._mp_cambiar_cantidad(v.stock_entry_id, 0, 'zomatik', a->>'nota', true, false);
      END IF;
      v_id := public._mp_insertar_ingreso(ing);
      PERFORM public._mp_vinculo_set(v.id, vin);
      UPDATE zomatik_ingresos_mp
         SET estado = 'importado', stock_entry_id = v_id, kg_asentado = round((ing->>'quantity')::numeric, 2), proveedor_por_robot = true,
             falta_desde = NULL, anulado_at = NULL, motivo = NULL, motivo_codigo = NULL
       WHERE id = v.id;
      RETURN jsonb_build_object('ok', true, 'stock_entry_id', v_id);
    END IF;

  ELSIF t = 'pendiente' THEN
    IF NOT ((v.estado = 'pendiente' AND v.stock_entry_id IS NULL) OR (v.estado = 'importado' AND v.stock_entry_id IS NULL)) THEN
      RETURN jsonb_build_object('ok', false, 'motivo', 'Ya estaba');
    END IF;
    PERFORM public._mp_vinculo_set(v.id, vin);
    UPDATE zomatik_ingresos_mp
       SET estado = 'pendiente',
           resolucion = CASE WHEN coalesce((vin->>'limpiar_resolucion')::boolean, false) THEN NULL ELSE resolucion END,
           resuelto_por = CASE WHEN coalesce((vin->>'limpiar_resolucion')::boolean, false) THEN NULL ELSE resuelto_por END,
           resuelto_at = CASE WHEN coalesce((vin->>'limpiar_resolucion')::boolean, false) THEN NULL ELSE resuelto_at END
     WHERE id = v.id;
    RETURN jsonb_build_object('ok', true);

  ELSIF t = 'descartar' THEN
    IF v.estado <> 'pendiente' THEN
      RETURN jsonb_build_object('ok', false, 'motivo', 'Ya estaba');
    END IF;
    UPDATE zomatik_ingresos_mp SET estado = 'descartado', motivo = coalesce(a->>'motivo', motivo), actualizado_at = now() WHERE id = v.id;
    RETURN jsonb_build_object('ok', true);

  ELSIF t = 'actualizar' THEN
    PERFORM public._mp_vinculo_set(v.id, vin);
    -- Fecha, proveedor y flete del ingreso: solo si es del robot (origen zomatik). Sin efecto en el stock.
    IF ing IS NOT NULL AND jsonb_typeof(ing) = 'object' AND v.estado = 'importado' AND v.stock_entry_id IS NOT NULL THEN
      UPDATE stock_entries
         SET entry_date  = CASE WHEN ing ? 'entry_date' THEN (ing->>'entry_date')::timestamptz ELSE entry_date END,
             supplier_id = CASE WHEN ing ? 'supplier_id' THEN nullif(ing->>'supplier_id', '')::uuid ELSE supplier_id END,
             supplier    = CASE WHEN ing ? 'supplier' THEN nullif(ing->>'supplier', '') ELSE supplier END,
             carrier_id  = CASE WHEN ing ? 'carrier_id' THEN nullif(ing->>'carrier_id', '')::uuid ELSE carrier_id END
       WHERE id = v.stock_entry_id AND origen = 'zomatik';
    END IF;
    RETURN jsonb_build_object('ok', true);
  END IF;
  RETURN jsonb_build_object('ok', false, 'motivo', 'Acción desconocida');
END;
$$;

CREATE OR REPLACE FUNCTION public.mp_zomatik_aplicar(p_acciones jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  a    jsonb;
  i    integer := 0;
  r    jsonb;
  v_out  jsonb := '[]'::jsonb;
BEGIN
  IF jsonb_typeof(p_acciones) <> 'array' THEN
    RAISE EXCEPTION 'p_acciones tiene que ser una lista';
  END IF;
  FOR a IN SELECT value FROM jsonb_array_elements(p_acciones) LOOP
    i := i + 1;
    BEGIN
      r := public._mp_aplicar_una(a);
    EXCEPTION WHEN OTHERS THEN
      r := jsonb_build_object('ok', false, 'error', true, 'motivo', SQLERRM);
    END;
    v_out := v_out || jsonb_build_array(r || jsonb_build_object('i', i, 'clave', a->>'clave', 'tipo', a->>'tipo'));
  END LOOP;
  RETURN v_out;
END;
$$;

-- ---------------------------------------------------------------------------
-- Edición a mano desde el historial (con asiento) y "Eliminar" un manual desde F (lo anula con asiento)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mp_ingreso_editar(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  e       stock_entries;
  v_kg    numeric := round((p->>'kg_nuevo')::numeric, 2);
  v_diff  numeric := 0;
BEGIN
  SELECT * INTO e FROM stock_entries WHERE id = (p->>'id')::uuid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El ingreso ya no existe';
  END IF;
  IF e.origen = 'zomatik' THEN
    RAISE EXCEPTION 'Viene de Zomatik: cantidad, fecha y remito se corrigen allá';
  END IF;
  IF e.anulado_at IS NOT NULL THEN
    RAISE EXCEPTION 'El ingreso está anulado';
  END IF;
  IF round(coalesce(e.quantity, 0), 2) <> round((p->>'kg_visto')::numeric, 2) THEN
    RAISE EXCEPTION 'El ingreso cambió: actualizá la pantalla';
  END IF;
  IF v_kg IS NULL OR v_kg <= 0 THEN
    RAISE EXCEPTION 'Cantidad inválida';
  END IF;
  IF v_kg <> round(e.quantity, 2) THEN
    v_diff := public._mp_cambiar_cantidad(e.id, v_kg, 'manual',
      'Corregido a mano por ' || coalesce(nullif(p->>'usuario', ''), '-') || ': ' || e.quantity || ' → ' || v_kg || '. Motivo: ' || coalesce(p->>'motivo', '-'), false, false);
  END IF;
  UPDATE stock_entries
     SET remito = CASE WHEN p ? 'remito' THEN nullif(p->>'remito', '') ELSE remito END,
         notes = CASE WHEN p ? 'notas' THEN nullif(p->>'notas', '') ELSE notes END,
         entry_date = CASE WHEN nullif(p->>'fecha', '') IS NOT NULL THEN ((p->>'fecha') || 'T12:00:00Z')::timestamptz ELSE entry_date END
   WHERE id = e.id;
  RETURN jsonb_build_object('ok', true, 'diff', v_diff);
END;
$$;

CREATE OR REPLACE FUNCTION public.mp_ingreso_anular(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  e       stock_entries;
  v_diff  numeric;
BEGIN
  SELECT * INTO e FROM stock_entries WHERE id = (p->>'id')::uuid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El ingreso ya no existe';
  END IF;
  IF coalesce(e.origen, 'manual') <> 'manual' THEN
    RAISE EXCEPTION 'Viene de Zomatik: se anula allá';
  END IF;
  IF e.anulado_at IS NOT NULL THEN
    RAISE EXCEPTION 'Ya estaba anulado';
  END IF;
  IF EXISTS (SELECT 1 FROM zomatik_ingresos_mp WHERE stock_entry_id = e.id) THEN
    RAISE EXCEPTION 'Está emparejado con un remito de Zomatik';
  END IF;
  IF round(coalesce(e.quantity, 0), 2) <> round((p->>'kg_visto')::numeric, 2) THEN
    RAISE EXCEPTION 'El ingreso cambió: actualizá la pantalla';
  END IF;
  v_diff := public._mp_cambiar_cantidad(e.id, 0, 'manual',
    'Eliminado por ' || coalesce(nullif(p->>'usuario', ''), '-') || ' (cargado a mano, no está en Zomatik): ' || e.quantity || ' → 0. Motivo: ' || coalesce(p->>'motivo', '-'), true, false);
  RETURN jsonb_build_object('ok', true, 'diff', v_diff);
END;
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public._mp_cambiar_cantidad(uuid, numeric, text, text, boolean, boolean)',
    'public._mp_insertar_ingreso(jsonb)',
    'public._mp_vinculo_set(bigint, jsonb)',
    'public._mp_aplicar_una(jsonb)',
    'public.mp_zomatik_aplicar(jsonb)',
    'public.mp_ingreso_editar(jsonb)',
    'public.mp_ingreso_anular(jsonb)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;

COMMIT;

-- ---------------------------------------------------------------------------
-- Interruptor (NO lo prende esta migración; lo corre Bautista cuando quiera):
--   Sombra desde el 09/11:  INSERT INTO integraciones (clave, valor, conectado_por) VALUES ('mp_ingresos_zomatik', '{"modo":"sombra","desde":"2026-11-09"}', 'Bautista')
--                           ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado = now();
--   Real desde F = 16/11:   UPDATE integraciones SET valor = '{"modo":"real","desde":"2026-11-16"}', actualizado = now() WHERE clave = 'mp_ingresos_zomatik';
--   Apagar:                 DELETE FROM integraciones WHERE clave = 'mp_ingresos_zomatik';
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Vuelta atrás (solo si todavía no se prendió el modo real; si ya importó, primero apagar y revisar con Bautista:
-- los ingresos con origen 'zomatik' y los asientos 'correccion_ingreso' son stock real):
--
-- BEGIN;
-- SET LOCAL lock_timeout = '3s';
-- DELETE FROM integraciones WHERE clave IN ('mp_ingresos_zomatik', 'mp_densidades', 'mp_ingresos_aviso');
-- DROP FUNCTION IF EXISTS public.mp_ingreso_anular(jsonb);
-- DROP FUNCTION IF EXISTS public.mp_ingreso_editar(jsonb);
-- DROP FUNCTION IF EXISTS public.mp_zomatik_aplicar(jsonb);
-- DROP FUNCTION IF EXISTS public._mp_aplicar_una(jsonb);
-- DROP FUNCTION IF EXISTS public._mp_vinculo_set(bigint, jsonb);
-- DROP FUNCTION IF EXISTS public._mp_insertar_ingreso(jsonb);
-- DROP FUNCTION IF EXISTS public._mp_cambiar_cantidad(uuid, numeric, text, text, boolean, boolean);
-- DROP TABLE IF EXISTS public.zomatik_ingresos_mp;
-- DELETE FROM control_mp_corridas WHERE origen = 'pasada';
-- ALTER TABLE public.control_mp_corridas DROP CONSTRAINT IF EXISTS control_mp_corridas_origen_check;
-- ALTER TABLE public.control_mp_corridas ADD CONSTRAINT control_mp_corridas_origen_check CHECK (origen IN ('cron', 'manual'));
-- -- control_mp_registrar: volver a la versión de 202610271900_control_ingresos_mp.sql (sin 'pasada')
-- -- Solo si no hay asientos nuevos (SELECT count(*) FROM stock_movements WHERE movement_type = 'correccion_ingreso' = 0):
-- ALTER TABLE public.stock_movements DROP CONSTRAINT IF EXISTS stock_movements_movement_type_check;
-- ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_movement_type_check
--   CHECK ((movement_type)::text = ANY (ARRAY['ingreso', 'consumo', 'ajuste', 'transferencia']::text[]));
-- ALTER TABLE public.stock_entries DROP CONSTRAINT IF EXISTS stock_entries_origen_check;
-- ALTER TABLE public.stock_entries DROP COLUMN IF EXISTS anulado_at;
-- ALTER TABLE public.stock_entries DROP COLUMN IF EXISTS origen;
-- COMMIT;
-- ---------------------------------------------------------------------------
