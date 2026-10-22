-- Carga de planta (dosificadora Indumix de Canning) · etapa SIMULADA
--
-- Especificación: docs/migracion-loop/carga-planta.md (puntos 8, 18.6, 19.9; los puntos 18 a 21 mandan).
--
-- Qué agrega (todo nuevo; ninguna tabla existente cambia de columnas):
--   puestos_carga        una fila por dosificadora. Se crea UNA: "Canning · simulador" (sistema = 'simulador'),
--                        APAGADA (etapa 'apagado'): Despachar no manda órdenes hasta que Bautista la prenda desde
--                        Carga de planta › Recetas de la planta › Etapa.
--                        Las columnas del puente real (credencial, secreto de arranque, latido, versión, deriva del
--                        reloj) quedan para después del jueves 23/10: no sirven para el simulador.
--   puesto_salidas       qué material hay en cada tolva, rosca, aditivo y agua, con historia (la Tolva 1 cambia
--                        entre 6/12 y 6/20). Se carga el mapa de la spec (6.3) para el puesto simulado.
--   recetas_planta       cada versión leída de cada receta de la planta (nunca se pisa la anterior) + la vista
--                        recetas_planta_actual (la última leída por número).
--   puesto_recetas       qué fórmula va en cada número (1 a 20).
--   cargas               una por carga (la pida el sistema, se haga desde Indumix o sea de prueba).
--   cargas_materiales    teórico, humedad, teórico corregido y real por salida.
--   cargas_eventos       la línea de tiempo de cada carga (con id de pedido para no grabar dos veces).
--   cargas_agua_extra    el agua extra de Indumix (19.5).
--   alertas_carga        receta que no coincide, receta cambiada, Tolva 1, carga desde Indumix, etc.
--   cargas_tiempos       vista: inicio, fin, tiempo de carga, salida de planta por GPS y esperas (19.6).
--   armar_recetas_puesto "Armar las 20 recetas del simulador": qué fórmula va en cada número y las recetas, todo junto
--                        (o nada).
--   ajustar_stock_carga  el ajuste de stock con los kilos reales (18.5), PROGRAMADO Y APAGADO: no hace nada con
--                        una carga simulada (da error), ni con un puesto con usa_kilos_reales = false (el único
--                        puesto es el simulador, que no lo puede prender: lo impide un CHECK). Lo prende Bautista
--                        cuando exista el puente real.
--   trg_stock_movements_carga_simulada   red de seguridad: ningún movimiento de stock puede apuntar a una carga
--                        simulada (solo mira las filas con reference_type = 'carga', que hoy no existen).
--
-- Cargas simuladas: `cargas.simulada = true`. Toda carga del puesto simulador es simulada (trigger). Una carga
-- simulada nunca mueve el stock (CHECK + función + trigger) y nunca toca el despacho real (eso lo respeta el código:
-- lib/carga/cierre.ts).
--
-- Qué pasa con los datos ya cargados:
--   - Ninguna tabla existente cambia de columnas. El único trigger nuevo sobre una tabla existente
--     (stock_movements) solo actúa con reference_type = 'carga', que hoy no usa nadie.
--   - app_users.permisos: se suma la sección "carga" a quienes no la tienen. Gerenciales: todo (igual, gerencial
--     puede todo sin mirar la matriz). Operarios y consulta: "ver", como la plantilla (lib/permisos.ts), y además
--     "cargar" para Titan Concretus y David Herrera. Ninguna otra casilla cambia, no se toca
--     permisos_actualizados_at y no se cierra ninguna sesión. Igual, la pantalla solo la ven quienes tienen el
--     interruptor de funciones nuevas (hoy Bautista y Juan).
--
-- Compatible con main: main no lee nada de esto. Se puede aplicar antes de publicar el front.
-- Se puede correr más de una vez (IF NOT EXISTS, CREATE OR REPLACE, ON CONFLICT, WHERE NOT EXISTS).
--
-- Permisos de la base: el navegador (anon) solo LEE estas tablas (RLS prendido, con una política de SELECT); se
-- escriben desde las rutas /api/carga/* con la sesión de la persona (fase 0c-1) y la clave de servicio, que controlan
-- los permisos. Las vistas leen con los permisos de quien consulta (security_invoker).

-- ---------------------------------------------------------------------------
-- Puestos de carga
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.puestos_carga (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id         uuid NOT NULL REFERENCES public.plants(id),
  nombre           text NOT NULL,
  sistema          text NOT NULL CHECK (sistema IN ('indumix', 'simulador')),
  -- lectura (A) · orden (B) · arranque (C) · apagado. Con orden o arranque, Despachar manda la orden a la cola.
  etapa            text NOT NULL DEFAULT 'apagado' CHECK (etapa IN ('lectura', 'orden', 'arranque', 'apagado')),
  max_recetas      int NOT NULL DEFAULT 20 CHECK (max_recetas BETWEEN 1 AND 99),
  m3_max_ciclo     numeric NOT NULL DEFAULT 1.5 CHECK (m3_max_ciclo > 0),
  -- 6.2. receta: {grupo: {rel, abs}}; pesaje: {grupo: rel}. Aditivo en kg/m³.
  tolerancias      jsonb NOT NULL DEFAULT '{"receta":{"cemento":{"rel":0.01,"abs":2},"agua":{"rel":0.02,"abs":3},"arido":{"rel":0.01,"abs":5},"aditivo":{"rel":0.02,"abs":0.02}},"pesaje":{"cemento":0.01,"arido":0.02,"agua":0.03,"aditivo":0.03}}'::jsonb,
  -- 18.5: ajustar el stock con los kilos reales. Apagado. El simulador no lo puede prender.
  usa_kilos_reales boolean NOT NULL DEFAULT false,
  activo           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT puestos_carga_planta_sistema_key UNIQUE (plant_id, sistema),
  CONSTRAINT puestos_carga_simulador_sin_kilos_reales CHECK (NOT (sistema = 'simulador' AND usa_kilos_reales))
);
COMMENT ON TABLE public.puestos_carga IS 'Dosificadoras conectadas al sistema (carga-planta.md 8.1). Hoy solo el simulador de Canning.';

-- ---------------------------------------------------------------------------
-- Mapa de salidas (qué material hay en cada tolva), con historia
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.puesto_salidas (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  puesto_id               uuid NOT NULL REFERENCES public.puestos_carga(id) ON DELETE CASCADE,
  salida                  text NOT NULL CHECK (salida IN ('arido_1', 'arido_2', 'arido_3', 'arido_4', 'cemento_1', 'cemento_2', 'aditivo_1', 'aditivo_2', 'agua')),
  nombre_planta           text,
  material_id             uuid REFERENCES public.materials(id) ON DELETE SET NULL,
  unidad_planta           text NOT NULL CHECK (unidad_planta IN ('kg', 'g', 'L')),
  factor_a_unidad_sistema numeric NOT NULL DEFAULT 1 CHECK (factor_a_unidad_sistema > 0),
  -- materiales que puede tener (la Tolva 1: Piedra 6/12 o 6/20). Nulo = siempre el mismo.
  alternativas            uuid[],
  vigente_desde           timestamptz NOT NULL DEFAULT now(),
  vigente_hasta           timestamptz,
  cambiado_por            text
);
CREATE UNIQUE INDEX IF NOT EXISTS puesto_salidas_vigente_key ON public.puesto_salidas (puesto_id, salida) WHERE vigente_hasta IS NULL;

-- ---------------------------------------------------------------------------
-- Recetas leídas de la planta (historia completa) y qué fórmula va en cada número
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.recetas_planta (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  puesto_id          uuid NOT NULL REFERENCES public.puestos_carga(id) ON DELETE CASCADE,
  numero             int NOT NULL CHECK (numero BETWEEN 1 AND 99),
  nombre             text NOT NULL DEFAULT '',
  habilitada         boolean NOT NULL DEFAULT true,
  -- [{salida, nombre_planta, valor, unidad, orden?}] en la unidad de Indumix
  valores            jsonb NOT NULL,
  huella             text NOT NULL,
  primera_lectura_at timestamptz NOT NULL DEFAULT now(),
  ultima_lectura_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recetas_planta_version_key UNIQUE (puesto_id, numero, huella)
);
CREATE INDEX IF NOT EXISTS recetas_planta_actual_idx ON public.recetas_planta (puesto_id, numero, ultima_lectura_at DESC);

CREATE OR REPLACE VIEW public.recetas_planta_actual WITH (security_invoker = true) AS
  SELECT DISTINCT ON (puesto_id, numero) *
    FROM public.recetas_planta
   ORDER BY puesto_id, numero, ultima_lectura_at DESC, primera_lectura_at DESC;

CREATE TABLE IF NOT EXISTS public.puesto_recetas (
  puesto_id    uuid NOT NULL REFERENCES public.puestos_carga(id) ON DELETE CASCADE,
  numero       int NOT NULL CHECK (numero BETWEEN 1 AND 99),
  formula_id   uuid REFERENCES public.formulas(id) ON DELETE SET NULL,
  tipo         text NOT NULL DEFAULT 'fija' CHECK (tipo IN ('fija', 'rotativa')),
  asignada_por text,
  asignada_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (puesto_id, numero),
  CONSTRAINT puesto_recetas_formula_key UNIQUE (puesto_id, formula_id)
);

-- ---------------------------------------------------------------------------
-- Cargas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cargas (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  puesto_id             uuid NOT NULL REFERENCES public.puestos_carga(id),
  plant_id              uuid NOT NULL REFERENCES public.plants(id),
  estado                text NOT NULL DEFAULT 'pendiente' CHECK (estado IN (
                          'pendiente', 'bloqueada', 'lista', 'preparada', 'en_curso', 'suspendida', 'terminada', 'parada',
                          'cancelada', 'anulada', 'leida', 'ya_cargada_indumix')),
  origen                text NOT NULL DEFAULT 'sistema' CHECK (origen IN ('sistema', 'indumix', 'prueba')),
  -- Simulada: nunca mueve el stock ni toca el despacho real
  simulada              boolean NOT NULL DEFAULT false,
  -- Sin clave foránea a propósito: borrar o anular un despacho (Historial) no tiene que frenarse por una carga.
  dispatch_id           uuid,
  pedido_id             uuid,
  viaje_id              uuid,
  -- Segunda carga del mismo despacho ("completar con otra carga", 18.3)
  completa_carga_id     uuid REFERENCES public.cargas(id),
  remito                text,
  remito_tipo           text CHECK (remito_tipo IS NULL OR remito_tipo IN ('R', 'X')),
  mixer_id              uuid REFERENCES public.mixers(id) ON DELETE SET NULL,
  patente_planta        text,
  cliente_planta        text,
  observacion_planta    text,
  formula_id            uuid REFERENCES public.formulas(id) ON DELETE SET NULL,
  receta_numero         int,
  receta_planta_id      uuid REFERENCES public.recetas_planta(id) ON DELETE SET NULL,
  m3                    numeric CHECK (m3 IS NULL OR m3 > 0),
  ciclos                int,
  m3_ciclo              numeric,
  ciclo_actual          int,
  m3_cargados           numeric,
  -- control de receta al mandar / recalcular: {frena, motivo, items}. agua_distinta: resalta, no frena (19.4)
  bloqueo               jsonb,
  agua_distinta         boolean NOT NULL DEFAULT false,
  -- "autorizar solo esta carga" (formulas.editar): {por, motivo, at, alerta_id}
  autorizacion          jsonb,
  -- "La carga va a quedar frenada en la planta… ¿Despachar igual?" (20.1)
  frenada_confirmada_por text,
  camion_abajo_por      text,
  camion_abajo_at       timestamptz,
  arrancada_por         text,
  -- horas del puente (la PC); las del PLC se guardan crudas, solo como dato (punto 10)
  bajada_at             timestamptz,
  inicio_at             timestamptz,
  fin_at                timestamptz,
  parada_at             timestamptz,
  inicio_plc            text,
  fin_plc               text,
  dia_planta            date,
  contador_planta       int,
  hora_estimada         boolean NOT NULL DEFAULT false,
  sin_internet          boolean NOT NULL DEFAULT false,
  -- cómo terminó una parada o una cancelación: {modo, motivo, por, at, efecto}
  resolucion            jsonb,
  -- unión carga ↔ remito: 'por id' | 'por remito (Observación)' | 'por camión y hora' | 'a mano'
  union_remito          text,
  estado_auditoria      text CHECK (estado_auditoria IS NULL OR estado_auditoria IN ('ok', 'con_desvios', 'revisada')),
  revisada_por          text,
  revisada_at           timestamptz,
  nota                  text,
  -- cuándo se ajustó el stock con los kilos reales (ajustar_stock_carga). Nunca en una simulada.
  stock_ajustado_at     timestamptz,
  created_by            text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cargas_sistema_con_despacho CHECK (origen <> 'sistema' OR dispatch_id IS NOT NULL),
  CONSTRAINT cargas_prueba_simulada CHECK (origen <> 'prueba' OR simulada),
  CONSTRAINT cargas_simulada_sin_stock CHECK (NOT (simulada AND stock_ajustado_at IS NOT NULL))
);
COMMENT ON COLUMN public.cargas.simulada IS 'Carga del simulador: nunca mueve el stock ni corrige el despacho real.';
-- Una sola carga "principal" viva por despacho (la segunda de "completar" lleva completa_carga_id)
CREATE UNIQUE INDEX IF NOT EXISTS cargas_despacho_principal_key ON public.cargas (dispatch_id)
  WHERE dispatch_id IS NOT NULL AND completa_carga_id IS NULL AND estado NOT IN ('cancelada', 'anulada');
-- El mismo reporte de Indumix leído dos veces no duplica la carga (punto 10)
CREATE UNIQUE INDEX IF NOT EXISTS cargas_reporte_planta_key ON public.cargas (puesto_id, dia_planta, contador_planta, inicio_plc)
  WHERE contador_planta IS NOT NULL;
-- Una sola carga en la planta a la vez por puesto (dos CARGAR al mismo tiempo no pasan los dos)
CREATE UNIQUE INDEX IF NOT EXISTS cargas_una_en_planta_key ON public.cargas (puesto_id) WHERE estado IN ('en_curso', 'suspendida');
CREATE INDEX IF NOT EXISTS cargas_puesto_estado_idx ON public.cargas (puesto_id, estado, created_at);
CREATE INDEX IF NOT EXISTS cargas_plant_created_idx ON public.cargas (plant_id, created_at);
CREATE INDEX IF NOT EXISTS cargas_mixer_idx ON public.cargas (mixer_id, created_at);

-- Toda carga de un puesto simulador es simulada, y updated_at al día
CREATE OR REPLACE FUNCTION public._cargas_simulada()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM puestos_carga p WHERE p.id = NEW.puesto_id AND p.sistema = 'simulador') THEN
    NEW.simulada := true;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.simulada AND NOT NEW.simulada THEN
    RAISE EXCEPTION 'Una carga simulada no puede pasar a real.';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_cargas_simulada ON public.cargas;
CREATE TRIGGER trg_cargas_simulada BEFORE INSERT OR UPDATE ON public.cargas
  FOR EACH ROW EXECUTE FUNCTION public._cargas_simulada();

CREATE TABLE IF NOT EXISTS public.cargas_materiales (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carga_id          uuid NOT NULL REFERENCES public.cargas(id) ON DELETE CASCADE,
  -- 0 = total de la carga; 1…N = cada ciclo, si el puente lo vio en vivo
  ciclo             int NOT NULL DEFAULT 0,
  salida            text NOT NULL,
  material_id       uuid REFERENCES public.materials(id) ON DELETE SET NULL,
  receta_por_m3     numeric,
  formula_por_m3    numeric,
  teorico           numeric,
  humedad_pct       numeric,
  teorico_corregido numeric,
  "real"            numeric,
  extra             numeric NOT NULL DEFAULT 0,
  unidad            text,
  CONSTRAINT cargas_materiales_key UNIQUE (carga_id, ciclo, salida)
);

CREATE TABLE IF NOT EXISTS public.cargas_eventos (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carga_id   uuid REFERENCES public.cargas(id) ON DELETE CASCADE,
  puesto_id  uuid NOT NULL REFERENCES public.puestos_carga(id) ON DELETE CASCADE,
  -- hora del puente
  at         timestamptz NOT NULL DEFAULT now(),
  tipo       text NOT NULL,
  detalle    jsonb,
  usuario    text,
  -- id del pedido de la pantalla: el mismo evento subido dos veces (sin internet) no se graba dos veces
  pedido     text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cargas_eventos_pedido_key ON public.cargas_eventos (pedido) WHERE pedido IS NOT NULL;
CREATE INDEX IF NOT EXISTS cargas_eventos_carga_idx ON public.cargas_eventos (carga_id, at);

CREATE TABLE IF NOT EXISTS public.cargas_agua_extra (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carga_id            uuid NOT NULL REFERENCES public.cargas(id) ON DELETE CASCADE,
  dispatch_id         uuid,
  at                  timestamptz NOT NULL,
  litros              numeric NOT NULL CHECK (litros > 0 AND litros <= 500),
  despues_de_terminar boolean NOT NULL DEFAULT false,
  usuario             text,
  origen              text NOT NULL DEFAULT 'sistema' CHECK (origen IN ('sistema', 'indumix_reporte', 'indumix_vivo')),
  pedido              text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cargas_agua_extra_pedido_key ON public.cargas_agua_extra (pedido) WHERE pedido IS NOT NULL;
CREATE INDEX IF NOT EXISTS cargas_agua_extra_carga_idx ON public.cargas_agua_extra (carga_id);

CREATE TABLE IF NOT EXISTS public.alertas_carga (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  puesto_id           uuid NOT NULL REFERENCES public.puestos_carga(id) ON DELETE CASCADE,
  tipo                text NOT NULL CHECK (tipo IN ('receta_no_coincide', 'receta_cambiada', 'receta_nueva', 'receta_faltante',
                        'tolva_material', 'humedad', 'carga_desde_indumix', 'puente_caido', 'reloj', 'despacho_frenado',
                        'orden_cancelada_cargada')),
  carga_id            uuid REFERENCES public.cargas(id) ON DELETE SET NULL,
  formula_id          uuid REFERENCES public.formulas(id) ON DELETE SET NULL,
  receta_numero       int,
  receta_planta_id    uuid REFERENCES public.recetas_planta(id) ON DELETE SET NULL,
  titulo              text NOT NULL,
  detalle             jsonb,
  estado              text NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'esperando_planta', 'resuelta', 'cerrada_sola')),
  resolucion          text CHECK (resolucion IS NULL OR resolucion IN ('corregir_planta', 'autorizar_una_vez', 'corregir_formula', 'descartar')),
  agua_confirmada_por text,
  resuelta_por        text,
  resuelta_at         timestamptz,
  motivo              text,
  avisado_a           jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
-- Una sola alerta abierta por receta y fórmula (no una por lectura)
CREATE UNIQUE INDEX IF NOT EXISTS alertas_carga_receta_abierta_key ON public.alertas_carga (puesto_id, receta_numero, formula_id)
  WHERE tipo = 'receta_no_coincide' AND estado IN ('abierta', 'esperando_planta');
CREATE INDEX IF NOT EXISTS alertas_carga_puesto_idx ON public.alertas_carga (puesto_id, estado, created_at DESC);

-- ---------------------------------------------------------------------------
-- Tiempos de planta (19.6): une cargas, despachos y GPS por dispatch_id. Solo lectura.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.cargas_tiempos WITH (security_invoker = true) AS
  SELECT c.id AS carga_id,
         c.dispatch_id,
         c.puesto_id,
         c.plant_id,
         c.simulada,
         c.origen,
         g.llegada_planta_previa AS llegada_planta,
         d.created_at            AS despachado_at,
         d.dispatch_date         AS salio_a_las,
         c.bajada_at,
         c.inicio_at,
         c.fin_at,
         round(extract(epoch FROM (c.fin_at - c.inicio_at)) / 60.0, 1)                  AS min_carga,
         g.salida_planta,
         round(extract(epoch FROM (g.salida_planta - c.fin_at)) / 60.0, 1)              AS min_espera_salida,
         round(extract(epoch FROM (c.inicio_at - g.llegada_planta_previa)) / 60.0, 1)   AS min_espera_antes
    FROM public.cargas c
    LEFT JOIN public.dispatches d ON d.id = c.dispatch_id
    LEFT JOIN public.viajes_gps g ON g.dispatch_id = c.dispatch_id
   WHERE c.completa_carga_id IS NULL;

-- ---------------------------------------------------------------------------
-- Stock con kilos reales (18.5): PROGRAMADO Y APAGADO
-- ---------------------------------------------------------------------------
-- Un movimiento por material = real − teórico del despacho (áridos en seco con la humedad de Indumix; el agua no
-- descuenta), con la misma convención que _aplicar_neto: movement_type 'consumo', positivo = se consumió más (baja el
-- stock), negativo = se devuelve. Respeta el ancla de recuento como _aplicar_neto. Se graba una sola vez por carga.
-- ANTES DE PRENDERLO: definir con Bautista si se compara húmedo o seco (spec, "Hecho").
CREATE OR REPLACE FUNCTION public.ajustar_stock_carga(p_carga_id uuid, p_usuario text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET timezone TO 'America/Argentina/Buenos_Aires'
AS $$
DECLARE
  v_c     public.cargas;
  v_p     public.puestos_carga;
  v_d     public.dispatches;
  v_dia   date := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
  v_mover jsonb := '{}'::jsonb;
  v_n     int := 0;
  v_ancla timestamptz;
  r       record;
BEGIN
  SELECT * INTO v_c FROM cargas WHERE id = p_carga_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La carga no existe.'; END IF;
  IF v_c.simulada THEN RAISE EXCEPTION 'Carga simulada: no mueve el stock.'; END IF;
  SELECT * INTO v_p FROM puestos_carga WHERE id = v_c.puesto_id;
  IF v_p.sistema = 'simulador' THEN RAISE EXCEPTION 'Puesto simulado: no mueve el stock.'; END IF;
  IF NOT v_p.usa_kilos_reales THEN
    RETURN jsonb_build_object('aplicado', false, 'motivo', 'El ajuste con kilos reales está apagado en este puesto.');
  END IF;
  IF v_c.stock_ajustado_at IS NOT NULL THEN
    RETURN jsonb_build_object('aplicado', false, 'motivo', 'Ya se ajustó.');
  END IF;
  IF v_c.estado NOT IN ('terminada', 'parada', 'leida', 'ya_cargada_indumix') THEN
    RAISE EXCEPTION 'La carga todavía no terminó.';
  END IF;
  SELECT * INTO v_d FROM dispatches WHERE id = v_c.dispatch_id;

  FOR r IN
    WITH reales AS (
      SELECT cm.material_id,
             sum(CASE WHEN cm.salida LIKE 'arido_%' THEN cm."real" * coalesce(s.factor_a_unidad_sistema, 1) / (1 + coalesce(cm.humedad_pct, 0) / 100.0)
                      ELSE cm."real" * coalesce(s.factor_a_unidad_sistema, 1) END) AS kg
        FROM cargas_materiales cm
        LEFT JOIN puesto_salidas s ON s.puesto_id = v_c.puesto_id AND s.salida = cm.salida
             AND s.vigente_desde <= coalesce(v_c.inicio_at, v_c.created_at)
             AND (s.vigente_hasta IS NULL OR s.vigente_hasta > coalesce(v_c.inicio_at, v_c.created_at))
       WHERE cm.carga_id = p_carga_id AND cm.ciclo = 0 AND cm.salida <> 'agua' AND cm.material_id IS NOT NULL
       GROUP BY cm.material_id
    ), teoricos AS (
      SELECT dm.material_id, sum(coalesce(dm.dry_quantity, dm.quantity)) AS kg
        FROM dispatch_materials dm WHERE dm.dispatch_id = v_c.dispatch_id GROUP BY dm.material_id
    )
    SELECT re.material_id AS mid, round(re.kg - coalesce(t.kg, 0), 3) AS aj, m.descuenta_stock, m.name
      FROM reales re
      JOIN materials m ON m.id = re.material_id
      LEFT JOIN teoricos t ON t.material_id = re.material_id
     ORDER BY re.material_id
  LOOP
    CONTINUE WHEN r.aj = 0;
    v_ancla := public._ancla_stock(r.mid, coalesce(v_d.created_at, v_c.created_at));
    IF v_ancla IS NOT NULL THEN
      INSERT INTO stock_movements (material_id, movement_type, quantity_kg, reference_type, reference_id, movement_date, notes)
      VALUES (r.mid, 'consumo', 0, 'carga', p_carga_id, v_dia,
              'Kilos reales de la carga · ' || abs(r.aj) || ' kg sin mover: recuento posterior');
    ELSE
      INSERT INTO stock_movements (material_id, movement_type, quantity_kg, reference_type, reference_id, movement_date, notes)
      VALUES (r.mid, 'consumo', r.aj, 'carga', p_carga_id, v_dia,
              'Kilos reales de la carga (real − teórico) · remito ' || coalesce(v_c.remito, 's/n'));
      IF r.descuenta_stock THEN v_mover := v_mover || jsonb_build_object(r.mid::text, r.aj); END IF;
    END IF;
    v_n := v_n + 1;
  END LOOP;
  PERFORM public._mover_stock(v_mover);
  UPDATE cargas SET stock_ajustado_at = now() WHERE id = p_carga_id;
  INSERT INTO activity_log (user_name, action, entity, entity_id, reference, plant_id, details)
  VALUES (coalesce(nullif(btrim(coalesce(p_usuario, '')), ''), 'Sistema'), 'editar', 'carga', p_carga_id::text, v_c.remito, v_c.plant_id,
          jsonb_build_object('Ajuste de stock con kilos reales', v_n || ' materiales'));
  RETURN jsonb_build_object('aplicado', true, 'materiales', v_n);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.ajustar_stock_carga(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ajustar_stock_carga(uuid, text) TO service_role;

-- "Armar las 20 recetas" (o reasignar fórmulas a números): el mapeo y las recetas en una sola transacción.
-- p_mapeo: [{numero, formula_id, tipo}] · p_recetas: [{numero, nombre, habilitada, salidas, huella}]
CREATE OR REPLACE FUNCTION public.armar_recetas_puesto(p_puesto uuid, p_mapeo jsonb, p_recetas jsonb, p_usuario text, p_leida timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_max int;
  v_n   int := 0;
  v_r   int := 0;
BEGIN
  SELECT max_recetas INTO v_max FROM puestos_carga WHERE id = p_puesto FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El puesto de carga no existe.'; END IF;
  DELETE FROM puesto_recetas WHERE puesto_id = p_puesto;
  INSERT INTO puesto_recetas (puesto_id, numero, formula_id, tipo, asignada_por, asignada_at)
  SELECT p_puesto, (m->>'numero')::int, nullif(m->>'formula_id', '')::uuid,
         CASE WHEN m->>'tipo' = 'rotativa' THEN 'rotativa' ELSE 'fija' END, p_usuario, coalesce(p_leida, now())
    FROM jsonb_array_elements(coalesce(p_mapeo, '[]'::jsonb)) m
   WHERE (m->>'numero')::int BETWEEN 1 AND v_max;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO recetas_planta (puesto_id, numero, nombre, habilitada, valores, huella, primera_lectura_at, ultima_lectura_at)
  SELECT p_puesto, (x->>'numero')::int, coalesce(x->>'nombre', ''), coalesce((x->>'habilitada')::boolean, true),
         coalesce(x->'salidas', '[]'::jsonb), x->>'huella', coalesce(p_leida, now()), coalesce(p_leida, now())
    FROM jsonb_array_elements(coalesce(p_recetas, '[]'::jsonb)) x
   WHERE (x->>'numero')::int BETWEEN 1 AND v_max AND nullif(x->>'huella', '') IS NOT NULL
  ON CONFLICT (puesto_id, numero, huella) DO UPDATE SET ultima_lectura_at = EXCLUDED.ultima_lectura_at;
  GET DIAGNOSTICS v_r = ROW_COUNT;
  RETURN jsonb_build_object('asignadas', v_n, 'recetas', v_r);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.armar_recetas_puesto(uuid, jsonb, jsonb, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.armar_recetas_puesto(uuid, jsonb, jsonb, text, timestamptz) TO service_role;

-- Red de seguridad: ningún movimiento de stock apunta a una carga simulada
CREATE OR REPLACE FUNCTION public._stock_movements_carga_simulada()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM cargas c WHERE c.id = NEW.reference_id AND c.simulada) THEN
    RAISE EXCEPTION 'Carga simulada: no mueve el stock.';
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_stock_movements_carga_simulada ON public.stock_movements;
CREATE TRIGGER trg_stock_movements_carga_simulada BEFORE INSERT OR UPDATE ON public.stock_movements
  FOR EACH ROW WHEN (NEW.reference_type = 'carga') EXECUTE FUNCTION public._stock_movements_carga_simulada();

-- ---------------------------------------------------------------------------
-- Permisos de la base: el navegador lee; se escribe por /api/carga/* (clave de servicio)
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.puestos_carga, public.puesto_salidas, public.recetas_planta, public.puesto_recetas, public.cargas,
  public.cargas_materiales, public.cargas_eventos, public.cargas_agua_extra, public.alertas_carga FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.puestos_carga, public.puesto_salidas, public.recetas_planta, public.puesto_recetas, public.cargas,
  public.cargas_materiales, public.cargas_eventos, public.cargas_agua_extra, public.alertas_carga TO anon, authenticated;
GRANT ALL ON TABLE public.puestos_carga, public.puesto_salidas, public.recetas_planta, public.puesto_recetas, public.cargas,
  public.cargas_materiales, public.cargas_eventos, public.cargas_agua_extra, public.alertas_carga TO service_role;
-- RLS prendido (como alertas_stock), con una política que deja LEER al navegador. Nadie más que el servidor escribe.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['puestos_carga', 'puesto_salidas', 'recetas_planta', 'puesto_recetas', 'cargas', 'cargas_materiales',
                           'cargas_eventos', 'cargas_agua_extra', 'alertas_carga'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_leer', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO anon, authenticated USING (true)', t || '_leer', t);
  END LOOP;
END $$;
REVOKE ALL ON TABLE public.recetas_planta_actual, public.cargas_tiempos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.recetas_planta_actual, public.cargas_tiempos TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Datos iniciales: el puesto simulado de Canning y su mapa de salidas (6.3)
-- ---------------------------------------------------------------------------
INSERT INTO public.puestos_carga (plant_id, nombre, sistema, etapa)
SELECT p.id, 'Canning · simulador', 'simulador', 'apagado'
  FROM public.plants p WHERE p.name = 'Canning'
ON CONFLICT (plant_id, sistema) DO NOTHING;

WITH pu AS (
  SELECT pc.id, pc.plant_id FROM public.puestos_carga pc JOIN public.plants p ON p.id = pc.plant_id
   WHERE p.name = 'Canning' AND pc.sistema = 'simulador'
), mat AS (
  SELECT m.name, m.id FROM public.materials m JOIN pu ON m.plant_id = pu.plant_id
), mapa (salida, nombre_planta, material, unidad, factor, alt) AS (
  VALUES
    ('arido_1',   'PIE 6/20 O 6/12', 'Piedra Partida 6/12',   'kg', 1::numeric,     ARRAY['Piedra Partida 6/12', 'Piedra Partida 6/20']),
    ('arido_2',   'piedra 06',       'Arena Trituración 0/6', 'kg', 1::numeric,     NULL::text[]),
    ('arido_3',   'ARENA',           'Arena Fina',            'kg', 1::numeric,     NULL::text[]),
    ('arido_4',   'PIE 6/20',        'Piedra Partida 6/20',   'kg', 1::numeric,     NULL::text[]),
    ('cemento_1', 'CP 40',           'CPC 40',                'kg', 1::numeric,     NULL::text[]),
    ('cemento_2', 'CP 40',           'CPC 40',                'kg', 1::numeric,     NULL::text[]),
    ('aditivo_1', 'PLASTIF',         'Sikament 90E',          'g',  0.001::numeric, NULL::text[]),
    ('aditivo_2', '(vacío)',         NULL,                    'g',  0.001::numeric, NULL::text[]),
    ('agua',      'Agua',            'Agua',                  'L',  1::numeric,     NULL::text[])
)
INSERT INTO public.puesto_salidas (puesto_id, salida, nombre_planta, material_id, unidad_planta, factor_a_unidad_sistema, alternativas, cambiado_por)
SELECT pu.id, mapa.salida, mapa.nombre_planta, (SELECT mat.id FROM mat WHERE mat.name = mapa.material), mapa.unidad, mapa.factor,
       CASE WHEN mapa.alt IS NULL THEN NULL ELSE ARRAY(SELECT mat.id FROM mat WHERE mat.name = ANY (mapa.alt) ORDER BY mat.name) END,
       'Migración (mapa de la spec 6.3)'
  FROM pu CROSS JOIN mapa
 WHERE NOT EXISTS (SELECT 1 FROM public.puesto_salidas s WHERE s.puesto_id = pu.id AND s.salida = mapa.salida AND s.vigente_hasta IS NULL);

-- ---------------------------------------------------------------------------
-- Permisos por persona: sección "carga" (lib/permisos.ts). Solo a quien todavía no la tiene.
-- ---------------------------------------------------------------------------
UPDATE public.app_users u
   SET permisos = coalesce(u.permisos, '{}'::jsonb) || jsonb_build_object('carga', jsonb_build_object(
         'ver', u.tipo IN ('gerencial', 'operario', 'consulta'),
         'cargar', u.tipo = 'gerencial' OR lower(btrim(u.name)) IN ('titan concretus', 'david herrera'),
         'editar', u.tipo = 'gerencial',
         'borrar', false))
 WHERE NOT (coalesce(u.permisos, '{}'::jsonb) ? 'carga');

-- Que la API (PostgREST) vea las tablas nuevas sin esperar
NOTIFY pgrst, 'reload schema';
