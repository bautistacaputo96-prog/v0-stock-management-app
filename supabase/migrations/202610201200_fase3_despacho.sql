-- Fase 3 · Despacho diario en tres columnas (Viajes · Camiones · Pedidos) y remito R / X
--
-- Especificación: docs/migracion-loop/fase-3.md (puntos 7, 13 y 14; los puntos 13 y 14 mandan).
--
-- Todo se agrega, nada se borra. Compatible con el front de main: main no lee las columnas ni la tabla
-- nuevas, las firmas de registrar_despacho y editar_despacho no cambian y todo lo nuevo del jsonb es
-- OPCIONAL. La pantalla de siempre despacha igual: si no manda el tipo de remito, la base lo resuelve
-- (pedido > obra > cliente > respuesta del día) o lo deduce del número. Se puede aplicar antes de publicar
-- el front. Se puede correr más de una vez.
--
--   mixers.estado_desde               desde cuándo el camión está en su estado ("libre hace 24 min").
--                                     Lo pone solo el trigger trg_mixers_estado_desde al cambiar status.
--   scheduled_dispatches.suspendido_* suspender (lluvia) sin tocar status: para Semana, Historial, Informes
--                                     y los triggers de viajes el pedido sigue siendo el mismo.
--   scheduled_dispatches.cierre_*     motivo estructurado de finalizar y cancelar (para contarlo después).
--   *.remito_tipo                     R (con factura) / X (sin factura) en el pedido, la obra y el cliente
--                                     (nulo = no definido) y en el despacho (con su origen).
--   remito_tipo_dia                   la respuesta "con o sin factura" de un cliente para todo el día.
--   remito_tipo_para                  resuelve el tipo: pedido > obra > cliente > respuesta del día.
--   suspender_pedido / reabrir_pedido / finalizar_pedido / camion_volvio   acciones del día, con
--                                     dispatch_status_log y Actividad, todo en la base.
--   registrar_despacho                además: no despacha un pedido suspendido; resuelve y valida el tipo de
--                                     remito (y graba la respuesta del día en la misma transacción); el
--                                     remito repetido pasa a ser por PLANTA y TIPO comparando los dígitos.
--   editar_despacho                   además: acepta remito_tipo y vuelve a controlar el repetido por planta
--                                     y tipo cuando cambian el remito, la planta o el tipo.
--   trg_dispatches_created_at_fijo    la hora real en que se cargó el despacho no se puede cambiar.
--
-- Qué pasa con los datos ya cargados:
--   - mixers.estado_desde se completa con updated_at (o ahora). Nada más cambia en los camiones.
--   - Las columnas nuevas de pedidos, obras, clientes y despachos quedan nulas: ningún pedido queda
--     suspendido, nada queda "definido" como R o X. Los despachos viejos se clasifican aparte, con el script
--     scripts/fase3-clasificar-remitos.sql (con el OK de Bautista). Mientras tanto, para el control de
--     repetido, un despacho sin tipo vale lo que dice su número (2201 en adelante = X, el resto = R).
--   - No se reescribe ningún remito (el "755 HUDSON" queda como se tipeó). Solo se compara por los dígitos.
--   - Los pares que ya chocarían por planta y dígitos no frenan nada: el control es solo al cargar o editar.
--
-- Permisos como el resto de las tablas (sin RLS; la seguridad fuerte llega con la 0c-2).

-- ---------------------------------------------------------------------------
-- Camión: desde cuándo está en su estado
-- ---------------------------------------------------------------------------
ALTER TABLE public.mixers ADD COLUMN IF NOT EXISTS estado_desde timestamptz;
UPDATE public.mixers SET estado_desde = coalesce(updated_at, now()) WHERE estado_desde IS NULL;
ALTER TABLE public.mixers ALTER COLUMN estado_desde SET DEFAULT now();

CREATE OR REPLACE FUNCTION public._mixers_estado_desde()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.estado_desde := now();
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_mixers_estado_desde ON public.mixers;
CREATE TRIGGER trg_mixers_estado_desde
  BEFORE UPDATE OF status ON public.mixers
  FOR EACH ROW EXECUTE FUNCTION public._mixers_estado_desde();

-- ---------------------------------------------------------------------------
-- Pedido: suspensión, motivo de cierre y tipo de remito
-- ---------------------------------------------------------------------------
ALTER TABLE public.scheduled_dispatches
  ADD COLUMN IF NOT EXISTS suspendido_at timestamptz,
  ADD COLUMN IF NOT EXISTS suspendido_por text,
  ADD COLUMN IF NOT EXISTS suspendido_motivo_tipo text,
  ADD COLUMN IF NOT EXISTS suspendido_motivo text,
  ADD COLUMN IF NOT EXISTS cierre_motivo_tipo text,
  ADD COLUMN IF NOT EXISTS cierre_motivo text,
  ADD COLUMN IF NOT EXISTS remito_tipo text;

-- Motivos estructurados (los mismos para suspender, finalizar y cancelar, para poder contarlos)
ALTER TABLE public.scheduled_dispatches DROP CONSTRAINT IF EXISTS scheduled_dispatches_suspendido_motivo_tipo_check;
ALTER TABLE public.scheduled_dispatches ADD CONSTRAINT scheduled_dispatches_suspendido_motivo_tipo_check CHECK (
  suspendido_motivo_tipo IS NULL OR suspendido_motivo_tipo IN
    ('lluvia', 'obra_no_lista', 'falla_bomba', 'falla_camion', 'falta_material', 'pedido_cliente', 'obra_pidio_menos', 'otro'));
ALTER TABLE public.scheduled_dispatches DROP CONSTRAINT IF EXISTS scheduled_dispatches_cierre_motivo_tipo_check;
ALTER TABLE public.scheduled_dispatches ADD CONSTRAINT scheduled_dispatches_cierre_motivo_tipo_check CHECK (
  cierre_motivo_tipo IS NULL OR cierre_motivo_tipo IN
    ('lluvia', 'obra_no_lista', 'falla_bomba', 'falla_camion', 'falta_material', 'pedido_cliente', 'obra_pidio_menos', 'otro'));
ALTER TABLE public.scheduled_dispatches DROP CONSTRAINT IF EXISTS scheduled_dispatches_remito_tipo_check;
ALTER TABLE public.scheduled_dispatches ADD CONSTRAINT scheduled_dispatches_remito_tipo_check CHECK (
  remito_tipo IS NULL OR remito_tipo IN ('R', 'X'));

-- ---------------------------------------------------------------------------
-- Obra y cliente: "siempre con factura" / "siempre sin factura" (nulo = se decide en cada pedido)
-- ---------------------------------------------------------------------------
ALTER TABLE public.construction_sites ADD COLUMN IF NOT EXISTS remito_tipo text;
ALTER TABLE public.construction_sites DROP CONSTRAINT IF EXISTS construction_sites_remito_tipo_check;
ALTER TABLE public.construction_sites ADD CONSTRAINT construction_sites_remito_tipo_check CHECK (
  remito_tipo IS NULL OR remito_tipo IN ('R', 'X'));

ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS remito_tipo text;
ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_remito_tipo_check;
ALTER TABLE public.clients ADD CONSTRAINT clients_remito_tipo_check CHECK (
  remito_tipo IS NULL OR remito_tipo IN ('R', 'X'));

-- ---------------------------------------------------------------------------
-- Despacho: tipo de remito y de dónde salió
-- ---------------------------------------------------------------------------
ALTER TABLE public.dispatches
  ADD COLUMN IF NOT EXISTS remito_tipo text,
  ADD COLUMN IF NOT EXISTS remito_tipo_origen text;
ALTER TABLE public.dispatches DROP CONSTRAINT IF EXISTS dispatches_remito_tipo_check;
ALTER TABLE public.dispatches ADD CONSTRAINT dispatches_remito_tipo_check CHECK (
  remito_tipo IS NULL OR remito_tipo IN ('R', 'X'));
ALTER TABLE public.dispatches DROP CONSTRAINT IF EXISTS dispatches_remito_tipo_origen_check;
ALTER TABLE public.dispatches ADD CONSTRAINT dispatches_remito_tipo_origen_check CHECK (
  remito_tipo_origen IS NULL OR remito_tipo_origen IN ('pedido', 'obra', 'cliente', 'dia', 'pregunta', 'manual', 'numero', 'script'));

-- Para el control de repetido por planta
CREATE INDEX IF NOT EXISTS dispatches_plant_id_idx ON public.dispatches (plant_id);

-- ---------------------------------------------------------------------------
-- La hora real en que se cargó el despacho (created_at) no se pisa desde ningún lado
-- ("Salió a las" va a dispatch_date y se puede corregir; created_at queda para auditoría y el ancla del stock)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._dispatches_created_at_fijo()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  NEW.created_at := OLD.created_at;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_dispatches_created_at_fijo ON public.dispatches;
CREATE TRIGGER trg_dispatches_created_at_fijo
  BEFORE UPDATE ON public.dispatches
  FOR EACH ROW EXECUTE FUNCTION public._dispatches_created_at_fijo();

-- ---------------------------------------------------------------------------
-- Respuesta del día: "¿con o sin factura?" vale para todos los despachos de ese cliente ese día
-- (en las dos plantas). Se graba en la misma transacción del despacho que la contestó.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.remito_tipo_dia (
  fecha          date NOT NULL,
  client_id      uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  remito_tipo    text NOT NULL CHECK (remito_tipo IN ('R', 'X')),
  respondido_por text,
  respondido_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fecha, client_id)
);
GRANT ALL ON TABLE public.remito_tipo_dia TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Auxiliares del remito (solo para comparar, sugerir y clasificar: el texto tipeado no se toca)
-- ---------------------------------------------------------------------------
-- "755 HUDSON" → "755", "0841" → "841" (sin los ceros de adelante); sin dígitos → nulo
CREATE OR REPLACE FUNCTION public._remito_digitos(p_remito text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE WHEN d = '' THEN NULL ELSE coalesce(nullif(ltrim(d, '0'), ''), '0') END
    FROM (SELECT regexp_replace(coalesce(p_remito, ''), '\D', '', 'g') AS d) s
$function$;

-- Tipo que dice el número (para los despachos sin tipo): 2201 en adelante = X (talonarios de imprenta
-- 00002-00002201…00008200), el resto = R. Más de 5 dígitos (dos números juntos) o sin dígitos: nulo.
CREATE OR REPLACE FUNCTION public._remito_tipo_de_numero(p_remito text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE
           WHEN d IS NULL OR length(d) > 5 THEN NULL
           WHEN d::int >= 2201 THEN 'X'
           ELSE 'R'
         END
    FROM (SELECT public._remito_digitos(p_remito) AS d) s
$function$;

-- ¿Ya hay otro despacho de la misma planta con ese remito y ese tipo? Se comparan los dígitos ("755" choca
-- con "755 HUDSON"); sin dígitos, el texto como antes. Un despacho viejo sin tipo vale lo que dice su
-- número; si no se sabe el tipo (de uno o del otro), choca igual (por las dudas).
CREATE OR REPLACE FUNCTION public._remito_repetido(p_plant_id uuid, p_remito text, p_tipo text, p_excluir uuid DEFAULT NULL)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM dispatches d
     WHERE d.plant_id = p_plant_id
       AND (p_excluir IS NULL OR d.id <> p_excluir)
       AND CASE WHEN public._remito_digitos(p_remito) IS NOT NULL
                THEN public._remito_digitos(d.remito) = public._remito_digitos(p_remito)
                ELSE btrim(d.remito) = btrim(p_remito) END
       AND (p_tipo IS NULL
            OR coalesce(d.remito_tipo, public._remito_tipo_de_numero(d.remito)) IS NULL
            OR coalesce(d.remito_tipo, public._remito_tipo_de_numero(d.remito)) = p_tipo))
$function$;

-- Texto de los motivos (Actividad y log)
CREATE OR REPLACE FUNCTION public._motivo_texto(p_tipo text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE p_tipo
           WHEN 'lluvia' THEN 'Lluvia'
           WHEN 'obra_no_lista' THEN 'Obra no está lista'
           WHEN 'falla_bomba' THEN 'Falla de bomba'
           WHEN 'falla_camion' THEN 'Falla de camión'
           WHEN 'falta_material' THEN 'Falta material'
           WHEN 'pedido_cliente' THEN 'Pedido del cliente'
           WHEN 'obra_pidio_menos' THEN 'La obra pidió menos'
           WHEN 'otro' THEN 'Otro'
           ELSE coalesce(p_tipo, '-')
         END
$function$;

-- ---------------------------------------------------------------------------
-- remito_tipo_para: de dónde sale el tipo de un despacho. Prioridad: pedido > obra > cliente > respuesta del
-- día de ese cliente. Devuelve {"tipo": "R"|"X"|null, "origen": "pedido"|"obra"|"cliente"|"dia"|null}.
-- La usan la pantalla (para mostrarlo) y registrar_despacho (para validarlo).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remito_tipo_para(p_pedido_id uuid DEFAULT NULL, p_client_id uuid DEFAULT NULL, p_site_id uuid DEFAULT NULL, p_fecha date DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
DECLARE
  v_tipo   text;
  v_client uuid := p_client_id;
  v_site   uuid := p_site_id;
  v_fecha  date := coalesce(p_fecha, (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date);
BEGIN
  IF p_pedido_id IS NOT NULL THEN
    SELECT remito_tipo, coalesce(v_client, client_id), coalesce(v_site, construction_site_id)
      INTO v_tipo, v_client, v_site
      FROM scheduled_dispatches WHERE id = p_pedido_id;
    IF v_tipo IS NOT NULL THEN
      RETURN jsonb_build_object('tipo', v_tipo, 'origen', 'pedido');
    END IF;
  END IF;
  IF v_site IS NOT NULL THEN
    SELECT remito_tipo INTO v_tipo FROM construction_sites WHERE id = v_site;
    IF v_tipo IS NOT NULL THEN
      RETURN jsonb_build_object('tipo', v_tipo, 'origen', 'obra');
    END IF;
  END IF;
  IF v_client IS NOT NULL THEN
    SELECT remito_tipo INTO v_tipo FROM clients WHERE id = v_client;
    IF v_tipo IS NOT NULL THEN
      RETURN jsonb_build_object('tipo', v_tipo, 'origen', 'cliente');
    END IF;
    SELECT remito_tipo INTO v_tipo FROM remito_tipo_dia WHERE fecha = v_fecha AND client_id = v_client;
    IF v_tipo IS NOT NULL THEN
      RETURN jsonb_build_object('tipo', v_tipo, 'origen', 'dia');
    END IF;
  END IF;
  RETURN jsonb_build_object('tipo', NULL, 'origen', NULL);
END;
$function$;

-- ---------------------------------------------------------------------------
-- suspender_pedido: lluvia, obra que no está lista, etc. No toca status ni borra nada: los viajes pendientes
-- quedan en pausa (la pantalla los esconde) y registrar_despacho no lo deja despachar hasta reabrirlo.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.suspender_pedido(p_id uuid, p_tipo text, p_motivo text DEFAULT NULL, p_usuario text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
DECLARE
  v_usuario text := coalesce(nullif(btrim(coalesce(p_usuario, '')), ''), 'Sistema');
  v_motivo  text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_p       public.scheduled_dispatches;
  v_falta   numeric;
  v_viajes  int;
  v_ref     text;
BEGIN
  -- Mismo orden de bloqueo que el despacho: primero el pedido
  SELECT * INTO v_p FROM scheduled_dispatches WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El pedido no existe (puede haber sido borrado). Actualizá la pantalla.';
  END IF;
  IF v_p.status IN ('cancelled', 'completed') THEN
    RAISE EXCEPTION 'El pedido ya está cerrado (completo, finalizado o cancelado): no se puede suspender.';
  END IF;
  IF v_p.suspendido_at IS NOT NULL THEN
    RAISE EXCEPTION 'El pedido ya está suspendido.';
  END IF;
  IF p_tipo IS NULL OR p_tipo NOT IN ('lluvia', 'obra_no_lista', 'falla_bomba', 'falla_camion', 'falta_material', 'pedido_cliente', 'otro') THEN
    RAISE EXCEPTION 'Elegí por qué se suspende el pedido.';
  END IF;
  IF p_tipo = 'otro' AND v_motivo IS NULL THEN
    RAISE EXCEPTION 'Contá brevemente el motivo.';
  END IF;

  UPDATE scheduled_dispatches
     SET suspendido_at = now(), suspendido_por = v_usuario,
         suspendido_motivo_tipo = p_tipo, suspendido_motivo = v_motivo, updated_at = now()
   WHERE id = p_id;

  v_falta := greatest(0, v_p.quantity_m3 - coalesce(v_p.dispatched_m3, 0));
  SELECT count(*) INTO v_viajes FROM viajes WHERE pedido_id = p_id AND estado = 'planificado';
  SELECT coalesce(c.name, '-') || ' · ' || coalesce(s.name, '-') INTO v_ref
    FROM scheduled_dispatches sd LEFT JOIN clients c ON c.id = sd.client_id LEFT JOIN construction_sites s ON s.id = sd.construction_site_id
   WHERE sd.id = p_id;

  INSERT INTO dispatch_status_log (scheduled_dispatch_id, previous_status, new_status, changed_by, notes)
  VALUES (p_id, v_p.status, v_p.status, v_usuario,
          'Suspendido · ' || public._motivo_texto(p_tipo) || coalesce(' — ' || v_motivo, ''));

  INSERT INTO activity_log (user_name, action, entity, entity_id, reference, plant_id, details)
  VALUES (v_usuario, 'editar', 'pedido', p_id::text, v_ref, v_p.plant_id,
          jsonb_build_object('Estado', 'Suspendido', 'Motivo', public._motivo_texto(p_tipo),
                             'm³ en pausa', round(v_falta, 2), 'Viajes en pausa', v_viajes)
          || CASE WHEN v_motivo IS NOT NULL THEN jsonb_build_object('Detalle', v_motivo) ELSE '{}'::jsonb END);

  RETURN jsonb_build_object('id', p_id, 'viajes_en_pausa', v_viajes, 'falta', round(v_falta, 2));
END;
$function$;

-- ---------------------------------------------------------------------------
-- reabrir_pedido: limpia la suspensión. No toca los viajes: si se elige "Correr los viajes", los corre la
-- pantalla con el gerenciador (lib/viajes, ajustarAHora + guardar_viajes_pedido).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reabrir_pedido(p_id uuid, p_usuario text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
DECLARE
  v_usuario text := coalesce(nullif(btrim(coalesce(p_usuario, '')), ''), 'Sistema');
  v_p       public.scheduled_dispatches;
  v_ref     text;
  v_antes   text;
BEGIN
  SELECT * INTO v_p FROM scheduled_dispatches WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El pedido no existe (puede haber sido borrado). Actualizá la pantalla.';
  END IF;
  IF v_p.suspendido_at IS NULL THEN
    RAISE EXCEPTION 'El pedido no está suspendido. Actualizá la pantalla.';
  END IF;

  UPDATE scheduled_dispatches
     SET suspendido_at = NULL, suspendido_por = NULL, suspendido_motivo_tipo = NULL, suspendido_motivo = NULL,
         updated_at = now()
   WHERE id = p_id;

  v_antes := public._motivo_texto(v_p.suspendido_motivo_tipo) || ' desde las ' || to_char(v_p.suspendido_at, 'HH24:MI')
             || coalesce(' (' || v_p.suspendido_por || ')', '');
  SELECT coalesce(c.name, '-') || ' · ' || coalesce(s.name, '-') INTO v_ref
    FROM scheduled_dispatches sd LEFT JOIN clients c ON c.id = sd.client_id LEFT JOIN construction_sites s ON s.id = sd.construction_site_id
   WHERE sd.id = p_id;

  INSERT INTO dispatch_status_log (scheduled_dispatch_id, previous_status, new_status, changed_by, notes)
  VALUES (p_id, v_p.status, v_p.status, v_usuario, 'Reabierto (estaba suspendido: ' || v_antes || ')');

  INSERT INTO activity_log (user_name, action, entity, entity_id, reference, plant_id, details)
  VALUES (v_usuario, 'editar', 'pedido', p_id::text, v_ref, v_p.plant_id,
          jsonb_build_object('Estado', 'Suspendido → activo', 'Estaba suspendido', v_antes));

  RETURN jsonb_build_object('id', p_id);
END;
$function$;

-- ---------------------------------------------------------------------------
-- finalizar_pedido: lo que hacía el front (completo + la nota en observaciones) más el motivo, todo junto.
-- El trigger de la fase 2 cancela los viajes pendientes. La pantalla de siempre puede seguir con su update.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalizar_pedido(p_id uuid, p_tipo text, p_motivo text DEFAULT NULL, p_usuario text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
DECLARE
  v_usuario   text := coalesce(nullif(btrim(coalesce(p_usuario, '')), ''), 'Sistema');
  v_motivo    text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_p         public.scheduled_dispatches;
  v_desp      numeric;
  v_pend      numeric;
  v_nota      text;
  v_ref       text;
BEGIN
  SELECT * INTO v_p FROM scheduled_dispatches WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El pedido no existe (puede haber sido borrado). Actualizá la pantalla.';
  END IF;
  IF v_p.status = 'cancelled' THEN
    RAISE EXCEPTION 'El pedido está cancelado: no se puede finalizar.';
  END IF;
  IF v_p.status = 'completed' THEN
    RAISE EXCEPTION 'El pedido ya está completo o finalizado. Actualizá la pantalla.';
  END IF;
  IF p_tipo IS NULL OR p_tipo NOT IN ('lluvia', 'obra_no_lista', 'falla_bomba', 'falla_camion', 'falta_material', 'pedido_cliente', 'obra_pidio_menos', 'otro') THEN
    RAISE EXCEPTION 'Elegí por qué se cierra el pedido.';
  END IF;
  IF p_tipo = 'otro' AND v_motivo IS NULL THEN
    RAISE EXCEPTION 'Contá brevemente el motivo.';
  END IF;

  v_desp := coalesce(v_p.dispatched_m3, 0);
  v_pend := greatest(0, v_p.quantity_m3 - v_desp);
  -- La misma nota que escribía la pantalla de siempre
  v_nota := CASE WHEN v_pend > 0
                 THEN 'Cerrado con ' || to_char(v_desp, 'FM999990.0') || ' de ' || trim_scale(v_p.quantity_m3) || ' m3 ('
                      || to_char(v_pend, 'FM999990.0') || ' m3 sin despachar)'
                 ELSE 'Cerrado con ' || to_char(v_desp, 'FM999990.0') || ' m3' END;

  UPDATE scheduled_dispatches
     SET status = 'completed',
         observations = CASE WHEN observations IS NOT NULL AND observations <> '' THEN observations || ' · ' || v_nota ELSE v_nota END,
         cierre_motivo_tipo = p_tipo, cierre_motivo = v_motivo,
         suspendido_at = NULL, suspendido_por = NULL, suspendido_motivo_tipo = NULL, suspendido_motivo = NULL,
         updated_at = now()
   WHERE id = p_id;

  SELECT coalesce(c.name, '-') || ' · ' || coalesce(s.name, '-') INTO v_ref
    FROM scheduled_dispatches sd LEFT JOIN clients c ON c.id = sd.client_id LEFT JOIN construction_sites s ON s.id = sd.construction_site_id
   WHERE sd.id = p_id;

  INSERT INTO dispatch_status_log (scheduled_dispatch_id, previous_status, new_status, changed_by, notes)
  VALUES (p_id, v_p.status, 'completed', v_usuario,
          'Finalizado · ' || public._motivo_texto(p_tipo) || coalesce(' — ' || v_motivo, '') || ' · ' || v_nota);

  INSERT INTO activity_log (user_name, action, entity, entity_id, reference, plant_id, details)
  VALUES (v_usuario, 'editar', 'pedido', p_id::text, v_ref, v_p.plant_id,
          jsonb_build_object('Estado', '→ completado',
                             'Finalizado', 'con ' || to_char(v_desp, 'FM999990.0') || ' de ' || trim_scale(v_p.quantity_m3) || ' m³',
                             'Motivo', public._motivo_texto(p_tipo))
          || CASE WHEN v_motivo IS NOT NULL THEN jsonb_build_object('Detalle', v_motivo) ELSE '{}'::jsonb END
          || CASE WHEN v_p.suspendido_at IS NOT NULL THEN jsonb_build_object('Estaba suspendido', public._motivo_texto(v_p.suspendido_motivo_tipo)) ELSE '{}'::jsonb END);

  RETURN jsonb_build_object('id', p_id, 'nota', v_nota, 'sin_enviar', round(v_pend, 2));
END;
$function$;

-- ---------------------------------------------------------------------------
-- camion_volvio: el camión en ruta vuelve a quedar libre ("Volvió a planta"), a mano o porque el GPS lo vio
-- entrar a la planta. Es el "Entregado" de siempre más la hora y la fuente. No hace nada si el camión no
-- estaba en ruta (ya libre, en taller o fuera de servicio). Con el GPS, además, solo si salió con un
-- despacho de hoy hace al menos 15 minutos (que no lo libere un camión que pasa al lado de la planta).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.camion_volvio(p_mixer_id uuid, p_fuente text DEFAULT 'manual', p_usuario text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
DECLARE
  v_usuario text := coalesce(nullif(btrim(coalesce(p_usuario, '')), ''), 'Sistema');
  v_fuente  text := coalesce(nullif(btrim(coalesce(p_fuente, '')), ''), 'manual');
  v_m       public.mixers;
  v_salida  timestamptz;
  v_plant   uuid;
BEGIN
  IF v_fuente NOT IN ('manual', 'gps') THEN
    RAISE EXCEPTION 'Fuente no válida para "Volvió a planta": %', v_fuente;
  END IF;
  SELECT * INTO v_m FROM mixers WHERE id = p_mixer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El camión no existe. Actualizá la pantalla.';
  END IF;
  IF v_m.status IS DISTINCT FROM 'in_transit' THEN
    RETURN jsonb_build_object('cambiado', false, 'status', v_m.status);
  END IF;

  SELECT dispatch_date, plant_id INTO v_salida, v_plant
    FROM dispatches
   WHERE mixer_id = p_mixer_id
     AND dispatch_date >= date_trunc('day', now())
     AND dispatch_date <= now()
   ORDER BY dispatch_date DESC
   LIMIT 1;
  IF v_fuente = 'gps' AND (v_salida IS NULL OR v_salida > now() - interval '15 minutes') THEN
    RETURN jsonb_build_object('cambiado', false, 'status', v_m.status, 'motivo', 'sin viaje de hoy de al menos 15 min');
  END IF;

  UPDATE mixers SET status = 'available', updated_at = now() WHERE id = p_mixer_id;

  INSERT INTO activity_log (user_name, action, entity, entity_id, reference, plant_id, details)
  VALUES (CASE WHEN v_fuente = 'gps' THEN v_usuario || ' (GPS)' ELSE v_usuario END,
          'editar', 'camion', p_mixer_id::text, v_m.license_plate, coalesce(v_plant, v_m.plant_id),
          jsonb_build_object('Estado', 'en ruta → disponible',
                             'Volvió a planta', CASE WHEN v_fuente = 'gps' THEN 'fuente GPS' ELSE 'a mano' END)
          || CASE WHEN v_salida IS NOT NULL THEN jsonb_build_object('Salió', to_char(v_salida, 'HH24:MI')) ELSE '{}'::jsonb END);

  RETURN jsonb_build_object('cambiado', true, 'status', 'available');
END;
$function$;

-- ---------------------------------------------------------------------------
-- registrar_despacho: definición de producción del 20/10/2026 (pg_get_functiondef, = fase 2 + 0c-1).
-- Diff:
--   - pedido suspendido: no se despacha;
--   - tipo de remito (remito_tipo + remito_tipo_origen, opcionales): se resuelve con remito_tipo_para y se
--     valida; con origen "pregunta" se graba la respuesta del día en esta misma transacción; si no viene
--     (pantalla de siempre, despacho manual viejo), lo que resuelva la base o, si nadie lo definió, el número;
--   - remito repetido por PLANTA y TIPO comparando dígitos (antes: el texto en todo el sistema);
--   - Actividad: tipo de remito, aviso de remito aceptado (aviso_remito, opcional) y "Salió a las" corregida.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.registrar_despacho(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
DECLARE
  v_created_by text := nullif(btrim(coalesce(p->>'created_by', '')), '');
  v_usuario    text := coalesce(nullif(btrim(coalesce(p->>'usuario', '')), ''), v_created_by, 'Sistema');
  v_pedido_id  uuid := nullif(p->>'scheduled_dispatch_id', '')::uuid;
  v_pedido     public.scheduled_dispatches;
  v_plant_id   uuid := nullif(p->>'plant_id', '')::uuid;
  v_plant_name text;
  v_formula_id uuid := nullif(p->>'formula_id', '')::uuid;
  v_formula_code text;
  v_client_id  uuid := nullif(p->>'client_id', '')::uuid;
  v_site_id    uuid := nullif(p->>'construction_site_id', '')::uuid;
  v_mixer_id   uuid := nullif(p->>'mixer_id', '')::uuid;
  v_chofer_id  uuid := nullif(p->>'chofer_id', '')::uuid;  -- fase 1 (opcional)
  v_chofer_nombre text;
  v_m3         numeric := nullif(p->>'quantity_m3', '')::numeric;
  v_remito     text := nullif(btrim(coalesce(p->>'remito', '')), '');
  v_es_prueba  boolean := coalesce(nullif(p->>'is_test_dispatch', '')::boolean, false);
  v_fecha      timestamptz := coalesce(nullif(p->>'dispatch_date', '')::timestamptz, now());
  v_dia        date;
  v_fibra_m3   numeric := coalesce(nullif(p->>'fiber_kg_per_m3', '')::numeric, 0);
  v_muestra    boolean := coalesce(nullif(p->>'sample_taken', '')::boolean, false);
  v_sample     text := nullif(btrim(coalesce(p->>'sample_number', '')), '');
  v_notes      text := nullif(btrim(coalesce(p->>'notes', '')), '');
  v_manual     jsonb := p->'materiales_manuales';
  v_en_ruta    boolean;
  v_restante   numeric;
  v_nuevo      numeric;
  v_estado     text;
  v_id         uuid;
  v_n          int := 0;
  v_probetas   int := 0;
  v_total      numeric;
  v_mover      jsonb := '{}'::jsonb;
  v_m          public.materials;
  r            record;
  v_viaje_pedido uuid := nullif(p->>'viaje_id', '')::uuid;  -- fase 2 (opcional): el viaje que se elige
  v_viaje_id   uuid;
  v_viaje_n    int;
  v_viaje_tot  int;
  v_viaje_plan numeric;
  -- Fase 3 (todo opcional)
  v_tipo_in    text := nullif(btrim(coalesce(p->>'remito_tipo', '')), '');
  v_origen_in  text := nullif(btrim(coalesce(p->>'remito_tipo_origen', '')), '');
  v_aviso      text := nullif(btrim(coalesce(p->>'aviso_remito', '')), '');
  v_tipo       text;
  v_tipo_origen text;
  v_res        jsonb;
  v_tipo_dia   text;
  v_dig        text;
BEGIN
  v_dia := (v_fecha AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;

  -- Pedido (si viene de Despacho diario): se bloquea la fila hasta terminar
  IF v_pedido_id IS NOT NULL THEN
    SELECT * INTO v_pedido FROM scheduled_dispatches WHERE id = v_pedido_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El pedido no existe (puede haber sido borrado). Actualizá la pantalla.';
    END IF;
    IF v_pedido.status = 'cancelled' THEN
      RAISE EXCEPTION 'El pedido está cancelado: no se puede despachar.';
    END IF;
    IF v_pedido.status = 'completed' THEN
      RAISE EXCEPTION 'El pedido ya está completo o finalizado: no se puede despachar más. Actualizá la pantalla.';
    END IF;
    -- Fase 3: suspendido (lluvia, etc.), también desde la pantalla de siempre
    IF v_pedido.suspendido_at IS NOT NULL THEN
      RAISE EXCEPTION 'El pedido está suspendido: reabrilo para despachar.';
    END IF;
    v_plant_id   := coalesce(v_plant_id, v_pedido.plant_id);
    v_formula_id := coalesce(v_formula_id, v_pedido.formula_id);
    v_client_id  := coalesce(v_client_id, v_pedido.client_id);
    v_site_id    := coalesce(v_site_id, v_pedido.construction_site_id);
  END IF;

  IF v_plant_id IS NULL THEN
    RAISE EXCEPTION 'Falta la planta del despacho';
  END IF;
  SELECT name INTO v_plant_name FROM plants WHERE id = v_plant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La planta elegida no existe';
  END IF;

  -- Despacho por árido con ingreso manual: salida de materiales sin despacho (igual que hoy)
  IF v_manual IS NOT NULL AND jsonb_typeof(v_manual) = 'array' AND jsonb_array_length(v_manual) > 0 THEN
    IF v_notes IS NULL THEN
      RAISE EXCEPTION 'Las observaciones son obligatorias para el despacho por árido';
    END IF;
    INSERT INTO manual_material_withdrawals (withdrawal_date, plant_id, observations)
    VALUES (v_dia, v_plant_id, v_notes)
    RETURNING id INTO v_id;
    FOR r IN
      SELECT nullif(e->>'material_id', '')::uuid AS mid, nullif(e->>'quantity_kg', '')::numeric AS q
        FROM jsonb_array_elements(v_manual) e
    LOOP
      IF r.mid IS NULL THEN
        RAISE EXCEPTION 'Elegí el material de cada fila';
      END IF;
      IF r.q IS NULL OR r.q <= 0 THEN
        RAISE EXCEPTION 'La cantidad de cada material debe ser mayor a 0';
      END IF;
      v_m := public._material_en_planta(r.mid, v_plant_id);
      INSERT INTO manual_withdrawal_items (withdrawal_id, material_id, quantity_kg)
      VALUES (v_id, v_m.id, r.q);
      IF v_m.descuenta_stock THEN
        v_mover := public._sumar_kg(v_mover, v_m.id, r.q);
      END IF;
      INSERT INTO stock_movements (material_id, movement_type, quantity_kg, reference_type, reference_id, movement_date, notes)
      VALUES (v_m.id, 'consumo', r.q, 'manual_withdrawal', v_id, v_dia, 'Descarga manual: ' || v_notes);
      v_n := v_n + 1;
    END LOOP;
    PERFORM public._mover_stock(v_mover);
    INSERT INTO activity_log (user_name, action, entity, entity_id, reference, plant_id, details)
    VALUES (v_usuario, 'crear', 'despacho', v_id::text, 'Descarga manual', v_plant_id,
            jsonb_build_object('Tipo', 'Despacho por árido (ingreso manual)', 'Materiales', v_n, 'Observaciones', v_notes));
    RETURN jsonb_build_object('withdrawal_id', v_id, 'materiales', v_n);
  END IF;

  -- Validaciones del despacho
  IF v_formula_id IS NULL THEN
    RAISE EXCEPTION 'Debe seleccionar una fórmula';
  END IF;
  SELECT code INTO v_formula_code FROM formulas WHERE id = v_formula_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La fórmula elegida no existe (actualizá la pantalla)';
  END IF;
  IF v_m3 IS NULL OR v_m3 <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor a 0';
  END IF;
  IF NOT v_es_prueba THEN
    IF v_remito IS NULL THEN
      RAISE EXCEPTION 'El numero de remito es obligatorio';
    END IF;
    IF v_client_id IS NULL THEN
      RAISE EXCEPTION 'Debe seleccionar un cliente';
    END IF;
    IF v_site_id IS NULL THEN
      RAISE EXCEPTION 'Debe seleccionar una obra';
    END IF;
  ELSIF v_notes IS NULL THEN
    RAISE EXCEPTION 'Las observaciones son obligatorias para el despacho por árido';
  END IF;
  IF v_muestra AND v_sample IS NULL THEN
    RAISE EXCEPTION 'Debe ingresar el número de muestra';
  END IF;
  IF v_fibra_m3 < 0 THEN
    RAISE EXCEPTION 'La fibra (kg por m³) no puede ser negativa';
  END IF;
  IF v_chofer_id IS NOT NULL THEN
    SELECT nombre INTO v_chofer_nombre FROM choferes WHERE id = v_chofer_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El chofer elegido no existe (actualizá la pantalla)';
    END IF;
  END IF;

  -- Fase 2: el viaje elegido tiene que ser un viaje pendiente de este pedido
  IF v_viaje_pedido IS NOT NULL THEN
    IF v_pedido_id IS NULL THEN
      RAISE EXCEPTION 'El viaje elegido no corresponde a un pedido. Actualizá la pantalla.';
    END IF;
    PERFORM 1 FROM viajes WHERE id = v_viaje_pedido AND pedido_id = v_pedido_id AND estado = 'planificado' FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El viaje elegido ya se despachó o no es de este pedido. Actualizá la pantalla.';
    END IF;
  END IF;

  -- Fase 3: tipo de remito (R con factura / X sin factura). El despacho por árido o de prueba no lleva tipo.
  IF NOT v_es_prueba THEN
    IF v_tipo_in IS NOT NULL AND v_tipo_in NOT IN ('R', 'X') THEN
      RAISE EXCEPTION 'El tipo de remito tiene que ser R (con factura) o X (sin factura).';
    END IF;
    v_res := public.remito_tipo_para(v_pedido_id, v_client_id, v_site_id, v_dia);
    IF v_tipo_in IS NULL THEN
      -- Pantalla de siempre: lo que diga la base o, si nadie lo definió, el número (2201 en adelante = X)
      v_tipo := v_res->>'tipo';
      v_tipo_origen := v_res->>'origen';
      IF v_tipo IS NULL THEN
        v_tipo := public._remito_tipo_de_numero(v_remito);
        v_tipo_origen := CASE WHEN v_tipo IS NOT NULL THEN 'numero' END;
      END IF;
    ELSIF v_origen_in IN ('pedido', 'obra', 'cliente', 'dia') THEN
      IF (v_res->>'tipo') IS DISTINCT FROM v_tipo_in THEN
        RAISE EXCEPTION 'El tipo de remito cambió (ahora es %). Actualizá la pantalla.',
          CASE v_res->>'tipo' WHEN 'R' THEN 'Con factura' WHEN 'X' THEN 'Sin factura' ELSE 'sin definir' END;
      END IF;
      v_tipo := v_tipo_in;
      v_tipo_origen := v_res->>'origen';
    ELSIF v_origen_in = 'pregunta' THEN
      IF (v_res->>'tipo') IS NOT NULL THEN
        -- Alguien lo definió mientras tanto
        IF v_res->>'tipo' <> v_tipo_in THEN
          IF v_res->>'origen' = 'dia' THEN
            RAISE EXCEPTION 'Hoy ya se respondió % para este cliente. Actualizá la pantalla.',
              CASE v_res->>'tipo' WHEN 'R' THEN 'Con factura' ELSE 'Sin factura' END;
          END IF;
          RAISE EXCEPTION 'El tipo de remito cambió (ahora es %). Actualizá la pantalla.',
            CASE v_res->>'tipo' WHEN 'R' THEN 'Con factura' ELSE 'Sin factura' END;
        END IF;
        v_tipo := v_tipo_in;
        v_tipo_origen := v_res->>'origen';
      ELSE
        -- La respuesta vale para todo el día de ese cliente (en las dos plantas). Si este despacho falla,
        -- no queda grabada (misma transacción).
        INSERT INTO remito_tipo_dia (fecha, client_id, remito_tipo, respondido_por)
        VALUES (v_dia, v_client_id, v_tipo_in, v_usuario)
        ON CONFLICT (fecha, client_id) DO NOTHING;
        IF FOUND THEN
          v_tipo_origen := 'pregunta';
        ELSE
          SELECT remito_tipo INTO v_tipo_dia FROM remito_tipo_dia WHERE fecha = v_dia AND client_id = v_client_id;
          IF v_tipo_dia IS DISTINCT FROM v_tipo_in THEN
            RAISE EXCEPTION 'Hoy ya se respondió % para este cliente. Actualizá la pantalla.',
              CASE v_tipo_dia WHEN 'R' THEN 'Con factura' ELSE 'Sin factura' END;
          END IF;
          v_tipo_origen := 'dia';
        END IF;
        v_tipo := v_tipo_in;
      END IF;
    ELSIF v_origen_in = 'manual' THEN
      -- "Cambiar solo en este remito" (la pantalla lo deja solo con programacion.editar)
      v_tipo := v_tipo_in;
      v_tipo_origen := 'manual';
    ELSE
      RAISE EXCEPTION 'Falta de dónde sale el tipo de remito. Actualizá la pantalla.';
    END IF;
  END IF;

  -- Remito repetido: por planta y tipo, comparando los dígitos ("755" choca con "755 HUDSON" de la misma
  -- planta y no con el 755 de la otra). El lock evita que dos pantallas carguen el mismo número a la vez.
  IF v_remito IS NOT NULL THEN
    v_dig := public._remito_digitos(v_remito);
    PERFORM pg_advisory_xact_lock(hashtext('remito:' || v_plant_id || ':' || coalesce(v_tipo, '?') || ':' || coalesce(v_dig, v_remito)));
    IF public._remito_repetido(v_plant_id, v_remito, v_tipo, NULL) THEN
      RAISE EXCEPTION 'Ya hay un remito % en %. No se puede cargar dos veces.',
        coalesce(v_tipo || ' ', '') || coalesce(v_dig, v_remito), v_plant_name;
    END IF;
  END IF;

  -- m³: no superar el restante del pedido + 0,5
  IF v_pedido_id IS NOT NULL THEN
    v_restante := v_pedido.quantity_m3 - coalesce(v_pedido.dispatched_m3, 0);
    IF v_m3 > v_restante + 0.5 THEN
      RAISE EXCEPTION 'Supera el restante (% m3)', round(v_restante, 1);
    END IF;
  END IF;

  -- 1. Despacho (el trigger crea las 3 probetas si sample_taken)
  INSERT INTO dispatches (
    formula_id, quantity_m3, dispatch_date, remito, client_id, construction_site_id, mixer_id,
    extra_water_liters, sand_stockpile_humidity, sample_taken, sample_number, actual_slump_cm,
    notes, is_test_dispatch, created_by, scheduled_dispatch_id, plant_id, chofer_id,
    remito_tipo, remito_tipo_origen
  ) VALUES (
    v_formula_id, v_m3, v_fecha, v_remito,
    CASE WHEN v_es_prueba THEN NULL ELSE v_client_id END,
    CASE WHEN v_es_prueba THEN NULL ELSE v_site_id END,
    v_mixer_id,
    nullif(p->>'extra_water_liters', '')::numeric,
    nullif(p->>'sand_stockpile_humidity', '')::numeric,
    v_muestra,
    CASE WHEN v_muestra THEN v_sample ELSE NULL END,
    CASE WHEN v_muestra THEN nullif(p->>'actual_slump_cm', '')::numeric ELSE NULL END,
    v_notes, v_es_prueba, coalesce(v_created_by, v_usuario), v_pedido_id, v_plant_id, v_chofer_id,
    v_tipo, v_tipo_origen
  )
  RETURNING id INTO v_id;

  -- 2. Materiales de la fórmula, en la planta que despacha
  FOR r IN SELECT * FROM public._consumo_formula(v_formula_id, v_plant_id, v_m3) LOOP
    INSERT INTO dispatch_materials (dispatch_id, material_id, quantity, dry_quantity, wet_quantity, humidity_at_dispatch)
    VALUES (v_id, r.mat_id, r.kg_humedo, r.kg_seco, r.kg_humedo, r.humedad_pct);
    IF r.descuenta THEN
      v_mover := public._sumar_kg(v_mover, r.mat_id, r.kg_humedo);
    END IF;
    INSERT INTO stock_movements (material_id, movement_type, quantity_kg, reference_type, reference_id, movement_date, notes)
    VALUES (r.mat_id, 'consumo', r.kg_humedo, 'dispatch', v_id, v_dia, 'Despacho remito ' || coalesce(v_remito, 'N/A'));
    v_n := v_n + 1;
  END LOOP;

  -- 3. Fibra agregada al camión (kg/m³ × m³), material tipo fibra de la planta
  IF v_fibra_m3 > 0 THEN
    SELECT * INTO v_m FROM materials WHERE plant_id = v_plant_id AND tipo = 'fibra' ORDER BY name LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'No se encontró el material Fibra en la planta %', v_plant_name;
    END IF;
    v_total := round(v_fibra_m3 * v_m3, 3);
    INSERT INTO dispatch_materials (dispatch_id, material_id, quantity, dry_quantity, wet_quantity, humidity_at_dispatch)
    VALUES (v_id, v_m.id, v_total, v_total, v_total, 0);
    IF v_m.descuenta_stock THEN
      v_mover := public._sumar_kg(v_mover, v_m.id, v_total);
    END IF;
    INSERT INTO stock_movements (material_id, movement_type, quantity_kg, reference_type, reference_id, movement_date, notes)
    VALUES (v_m.id, 'consumo', v_total, 'dispatch', v_id, v_dia,
            'Fibra ' || v_fibra_m3 || ' kg/m³ × ' || v_m3 || ' m³ — remito ' || coalesce(v_remito, 'N/A'));
    v_n := v_n + 1;
  END IF;

  -- Stock: todos los materiales juntos, en orden de id
  PERFORM public._mover_stock(v_mover);

  -- Fase 2 (antes de tocar el pedido: si este camión lo completa, el trigger cancela los viajes que sobran)
  IF v_pedido_id IS NOT NULL THEN
    -- Fase 2: el viaje elegido o, si no se eligió, el primer viaje pendiente del pedido queda despachado.
    -- Si el pedido no tiene viajes no pasa nada (igual que antes).
    UPDATE viajes
       SET estado = 'despachado', dispatch_id = v_id, m3_planificado = m3, m3 = v_m3,  -- m³ reales del camión
           actualizado_por = v_usuario, updated_at = now()
     WHERE id = coalesce(v_viaje_pedido,
                         (SELECT id FROM viajes
                           WHERE pedido_id = v_pedido_id AND estado = 'planificado'
                           ORDER BY n LIMIT 1))
       AND estado = 'planificado'
     RETURNING id, n, m3_planificado INTO v_viaje_id, v_viaje_n, v_viaje_plan;
    IF v_viaje_id IS NOT NULL THEN
      SELECT count(*) INTO v_viaje_tot FROM viajes WHERE pedido_id = v_pedido_id AND estado <> 'cancelado';
    END IF;
  END IF;

  -- 4. Pedido: acumulado atómico y completo si se llegó al total
  IF v_pedido_id IS NOT NULL THEN
    UPDATE scheduled_dispatches
       SET dispatched_m3 = coalesce(dispatched_m3, 0) + v_m3,
           status = CASE WHEN coalesce(dispatched_m3, 0) + v_m3 >= quantity_m3 - 0.01 THEN 'completed' ELSE status END,
           updated_at = now()
     WHERE id = v_pedido_id
     RETURNING dispatched_m3, status INTO v_nuevo, v_estado;
    INSERT INTO dispatch_status_log (scheduled_dispatch_id, previous_status, new_status, changed_by, notes)
    VALUES (v_pedido_id, v_pedido.status, v_estado, v_usuario, 'Despacho remito ' || coalesce(v_remito, 'N/A') || ' · ' || v_m3 || ' m3');

  END IF;

  -- 5. Camión en ruta (por defecto solo cuando sale de un pedido, como hoy)
  v_en_ruta := coalesce(nullif(p->>'mixer_en_ruta', '')::boolean, v_pedido_id IS NOT NULL);
  IF v_mixer_id IS NOT NULL AND v_en_ruta THEN
    UPDATE mixers SET status = 'in_transit', updated_at = now() WHERE id = v_mixer_id;
  END IF;

  -- 6. Actividad
  INSERT INTO activity_log (user_name, action, entity, entity_id, reference, plant_id, details)
  VALUES (v_usuario, 'crear', 'despacho', v_id::text, v_remito, v_plant_id,
          jsonb_build_object(
            'Remito', coalesce(v_remito, '-'),
            'm3', v_m3,
            'Formula', v_formula_code,
            'Origen', CASE WHEN v_pedido_id IS NOT NULL THEN 'Pedido' WHEN v_es_prueba THEN 'Por árido' ELSE 'Manual' END)
          || CASE WHEN v_chofer_nombre IS NOT NULL THEN jsonb_build_object('Chofer', v_chofer_nombre) ELSE '{}'::jsonb END
          || CASE WHEN v_viaje_id IS NOT NULL THEN jsonb_build_object('Viaje', v_viaje_n || '/' || v_viaje_tot) ELSE '{}'::jsonb END
          -- Fase 3
          || CASE WHEN v_tipo IS NOT NULL THEN jsonb_build_object('Tipo de remito',
               v_tipo || CASE v_tipo WHEN 'R' THEN ' (con factura)' ELSE ' (sin factura)' END
               || ' · ' || CASE v_tipo_origen
                             WHEN 'pedido' THEN 'lo dice el pedido'
                             WHEN 'obra' THEN 'lo dice la obra'
                             WHEN 'cliente' THEN 'lo dice el cliente'
                             WHEN 'dia' THEN 'respuesta del día'
                             WHEN 'pregunta' THEN 'respondido al despachar (vale para todo el día del cliente)'
                             WHEN 'manual' THEN 'cambiado solo en este remito'
                             WHEN 'numero' THEN 'deducido del número'
                             ELSE coalesce(v_tipo_origen, '-') END) ELSE '{}'::jsonb END
          || CASE WHEN v_aviso IS NOT NULL THEN jsonb_build_object('Aviso de remito aceptado', v_aviso) ELSE '{}'::jsonb END
          || CASE WHEN v_pedido_id IS NOT NULL AND p ? 'dispatch_date' AND abs(extract(epoch FROM (now() - v_fecha))) > 600
                  THEN jsonb_build_object('Salió a las', to_char(v_fecha, 'HH24:MI') || ' (corregida; cargado ' || to_char(now(), 'HH24:MI') || ')')
                  ELSE '{}'::jsonb END);

  SELECT count(*) INTO v_probetas FROM test_cylinders WHERE dispatch_id = v_id;

  RETURN jsonb_build_object(
    'id', v_id,
    'remito', v_remito,
    'm3', v_m3,
    'restante', CASE WHEN v_pedido_id IS NOT NULL THEN greatest(0, v_pedido.quantity_m3 - v_nuevo) END,
    'completo', coalesce(v_estado = 'completed', false),
    'probetas', v_probetas,
    'materiales', v_n)
    || CASE WHEN v_viaje_id IS NOT NULL THEN jsonb_build_object('viaje_id', v_viaje_id, 'viaje_n', v_viaje_n, 'viaje_m3_planificado', v_viaje_plan) ELSE '{}'::jsonb END
    || jsonb_build_object('remito_tipo', v_tipo, 'remito_tipo_origen', v_tipo_origen);
END;
$function$;

-- ---------------------------------------------------------------------------
-- editar_despacho: definición de producción del 20/10/2026 (pg_get_functiondef, = 0c-1). Diff:
--   - acepta remito_tipo (R / X; nulo = sin tipo). Si cambia, el origen pasa a "manual";
--   - el control de repetido es por planta y tipo comparando dígitos, y se hace cuando cambian el remito,
--     la planta o el tipo (excluyendo al propio despacho, como antes);
--   - Actividad: "Tipo de remito R → X".
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.editar_despacho(p_id uuid, p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
DECLARE
  v_usuario  text := coalesce(nullif(btrim(coalesce(p->>'usuario', '')), ''), 'Sistema');
  v_d        public.dispatches;
  v_m3       numeric;
  v_formula  uuid;
  v_plant    uuid;
  v_calc_plant uuid;
  v_remito   text;
  v_old_rem  text;
  v_client   uuid;
  v_site     uuid;
  v_mixer    uuid;
  v_chofer   uuid;  -- fase 1
  v_agua     numeric;
  v_notes    text;
  v_fecha    timestamptz;
  v_recalc   boolean;
  v_ratio    numeric;
  v_q        numeric;
  v_fibra_m3 numeric;
  v_neto     jsonb := '{}'::jsonb;
  v_res      jsonb;
  v_cambios  jsonb := '{}'::jsonb;
  v_nota     text;
  v_m        public.materials;
  v_motivo   text := nullif(btrim(coalesce(p->>'motivo', '')), '');  -- fase 0c-1 (opcional)
  r          record;
  -- Fase 3
  v_tipo     text;
  v_tipo_ef  text;
  v_dig      text;
BEGIN
  -- Orden de bloqueos: despacho -> pedido -> materiales
  SELECT * INTO v_d FROM dispatches WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El despacho no existe (puede que se haya borrado). Actualizá la pantalla.';
  END IF;
  IF v_d.scheduled_dispatch_id IS NOT NULL THEN
    PERFORM 1 FROM scheduled_dispatches WHERE id = v_d.scheduled_dispatch_id FOR UPDATE;
  END IF;

  v_m3      := CASE WHEN p ? 'quantity_m3' THEN nullif(p->>'quantity_m3', '')::numeric ELSE v_d.quantity_m3 END;
  v_formula := coalesce(CASE WHEN p ? 'formula_id' THEN nullif(p->>'formula_id', '')::uuid END, v_d.formula_id);
  v_plant   := coalesce(CASE WHEN p ? 'plant_id' THEN nullif(p->>'plant_id', '')::uuid END, v_d.plant_id);
  v_remito  := CASE WHEN p ? 'remito' THEN nullif(btrim(coalesce(p->>'remito', '')), '') ELSE v_d.remito END;
  v_client  := CASE WHEN p ? 'client_id' THEN nullif(p->>'client_id', '')::uuid ELSE v_d.client_id END;
  v_site    := CASE WHEN p ? 'construction_site_id' THEN nullif(p->>'construction_site_id', '')::uuid ELSE v_d.construction_site_id END;
  v_mixer   := CASE WHEN p ? 'mixer_id' THEN nullif(p->>'mixer_id', '')::uuid ELSE v_d.mixer_id END;
  v_chofer  := CASE WHEN p ? 'chofer_id' THEN nullif(p->>'chofer_id', '')::uuid ELSE v_d.chofer_id END;
  v_agua    := CASE WHEN p ? 'extra_water_liters' THEN nullif(p->>'extra_water_liters', '')::numeric ELSE v_d.extra_water_liters END;
  v_notes   := CASE WHEN p ? 'notes' THEN nullif(btrim(coalesce(p->>'notes', '')), '') ELSE v_d.notes END;
  v_fecha   := coalesce(CASE WHEN p ? 'dispatch_date' THEN nullif(p->>'dispatch_date', '')::timestamptz END, v_d.dispatch_date);
  v_tipo    := CASE WHEN p ? 'remito_tipo' THEN nullif(btrim(coalesce(p->>'remito_tipo', '')), '') ELSE v_d.remito_tipo END;

  IF v_m3 IS NULL OR v_m3 <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor a 0';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM formulas WHERE id = v_formula) THEN
    RAISE EXCEPTION 'La fórmula elegida no existe (actualizá la pantalla)';
  END IF;
  IF v_chofer IS DISTINCT FROM v_d.chofer_id AND v_chofer IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM choferes WHERE id = v_chofer) THEN
    RAISE EXCEPTION 'El chofer elegido no existe (actualizá la pantalla)';
  END IF;
  IF v_tipo IS NOT NULL AND v_tipo NOT IN ('R', 'X') THEN
    RAISE EXCEPTION 'El tipo de remito tiene que ser R (con factura) o X (sin factura).';
  END IF;

  -- Remito: si cambia el remito, la planta o el tipo, no puede repetir otro de la misma planta y tipo
  v_old_rem := nullif(btrim(coalesce(v_d.remito, '')), '');
  IF v_remito IS NOT NULL
     AND (public._remito_digitos(v_remito) IS DISTINCT FROM public._remito_digitos(v_old_rem)
          OR (public._remito_digitos(v_remito) IS NULL AND v_remito IS DISTINCT FROM v_old_rem)
          OR v_plant IS DISTINCT FROM v_d.plant_id
          OR v_tipo IS DISTINCT FROM v_d.remito_tipo) THEN
    v_dig := public._remito_digitos(v_remito);
    v_tipo_ef := coalesce(v_tipo, public._remito_tipo_de_numero(v_remito));
    PERFORM pg_advisory_xact_lock(hashtext('remito:' || v_plant || ':' || coalesce(v_tipo_ef, '?') || ':' || coalesce(v_dig, v_remito)));
    IF public._remito_repetido(v_plant, v_remito, v_tipo_ef, p_id) THEN
      RAISE EXCEPTION 'Ya hay un remito % en %. No se puede cargar dos veces.',
        coalesce(v_tipo_ef || ' ', '') || coalesce(v_dig, v_remito), coalesce((SELECT name FROM plants WHERE id = v_plant), 'esa planta');
    END IF;
  END IF;

  v_recalc := v_m3 <> v_d.quantity_m3 OR v_formula <> v_d.formula_id OR v_plant IS DISTINCT FROM v_d.plant_id;
  v_nota := 'Edición remito ' || coalesce(v_remito, 's/n') || coalesce(' · ' || v_motivo, '') || ' (' || v_usuario || ')';

  IF v_recalc THEN
    IF v_formula = v_d.formula_id AND v_plant IS NOT DISTINCT FROM v_d.plant_id AND v_d.quantity_m3 > 0 THEN
      -- Solo cambian los m³: se escalan fórmula y fibra; lo que ya no está en la fórmula se quita
      v_ratio := v_m3 / v_d.quantity_m3;
      v_nota := v_nota || ': ' || v_d.quantity_m3 || ' → ' || v_m3 || ' m3';
      FOR r IN
        SELECT dm.id, dm.material_id, dm.quantity, dm.dry_quantity,
               (m.tipo = 'fibra' OR EXISTS (
                  SELECT 1 FROM formula_materials fm JOIN materials fmm ON fmm.id = fm.material_id
                   WHERE fm.formula_id = v_d.formula_id
                     AND lower(btrim(fmm.name)) = lower(btrim(m.name)) AND fmm.tipo = m.tipo)) AS por_m3
          FROM dispatch_materials dm JOIN materials m ON m.id = dm.material_id
         WHERE dm.dispatch_id = p_id
           AND NOT (m.tipo = 'aditivo_obra' AND m.name ILIKE '%superfluidificante%')
         ORDER BY dm.material_id, dm.id
      LOOP
        IF r.por_m3 THEN
          v_q := round(r.quantity * v_ratio, 3);
          UPDATE dispatch_materials
             SET quantity = v_q,
                 wet_quantity = v_q,
                 dry_quantity = CASE WHEN r.dry_quantity IS NULL THEN NULL ELSE round(r.dry_quantity * v_ratio, 3) END
           WHERE id = r.id;
          v_neto := public._sumar_kg(v_neto, r.material_id, v_q - r.quantity);
        ELSE
          DELETE FROM dispatch_materials WHERE id = r.id;
          v_neto := public._sumar_kg(v_neto, r.material_id, -r.quantity);
        END IF;
      END LOOP;
    ELSE
      -- Cambia la fórmula o la planta: se sacan todas las filas (menos superfluidificante) y se recalculan
      v_calc_plant := coalesce(v_plant, (SELECT plant_id FROM formulas WHERE id = v_formula));
      v_nota := v_nota || ': recálculo por cambio de fórmula/planta';
      SELECT coalesce(sum(dm.quantity), 0) / nullif(v_d.quantity_m3, 0) INTO v_fibra_m3
        FROM dispatch_materials dm JOIN materials m ON m.id = dm.material_id
       WHERE dm.dispatch_id = p_id AND m.tipo = 'fibra';
      FOR r IN
        SELECT dm.id, dm.material_id, dm.quantity
          FROM dispatch_materials dm JOIN materials m ON m.id = dm.material_id
         WHERE dm.dispatch_id = p_id
           AND NOT (m.tipo = 'aditivo_obra' AND m.name ILIKE '%superfluidificante%')
         ORDER BY dm.material_id, dm.id
      LOOP
        DELETE FROM dispatch_materials WHERE id = r.id;
        v_neto := public._sumar_kg(v_neto, r.material_id, -r.quantity);
      END LOOP;
      FOR r IN SELECT * FROM public._consumo_formula(v_formula, v_calc_plant, v_m3) LOOP
        INSERT INTO dispatch_materials (dispatch_id, material_id, quantity, dry_quantity, wet_quantity, humidity_at_dispatch)
        VALUES (p_id, r.mat_id, r.kg_humedo, r.kg_seco, r.kg_humedo, r.humedad_pct);
        v_neto := public._sumar_kg(v_neto, r.mat_id, r.kg_humedo);
      END LOOP;
      IF coalesce(v_fibra_m3, 0) > 0 THEN
        SELECT * INTO v_m FROM materials WHERE plant_id = v_calc_plant AND tipo = 'fibra' ORDER BY name LIMIT 1;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'No se encontró el material Fibra en la planta del despacho';
        END IF;
        v_q := round(v_fibra_m3 * v_m3, 3);
        INSERT INTO dispatch_materials (dispatch_id, material_id, quantity, dry_quantity, wet_quantity, humidity_at_dispatch)
        VALUES (p_id, v_m.id, v_q, v_q, v_q, 0);
        v_neto := public._sumar_kg(v_neto, v_m.id, v_q);
      END IF;
    END IF;

    -- Stock por diferencia neta (orden de id; ancla de stock respetada)
    v_res := public._aplicar_neto(p_id, v_d.created_at, v_neto, v_nota);

    -- Pedido
    PERFORM public._ajustar_pedido(v_d.scheduled_dispatch_id, v_m3 - v_d.quantity_m3, v_usuario,
                                   'Edición remito ' || coalesce(v_remito, 's/n') || ': ' || v_d.quantity_m3 || ' → ' || v_m3 || ' m3');
  END IF;

  -- Registro de lo anterior y lo nuevo (solo lo que cambió)
  IF v_m3 <> v_d.quantity_m3 THEN
    v_cambios := v_cambios || jsonb_build_object('m3', v_d.quantity_m3 || ' → ' || v_m3);
  END IF;
  IF v_formula <> v_d.formula_id THEN
    v_cambios := v_cambios || jsonb_build_object('Formula',
      (SELECT code FROM formulas WHERE id = v_d.formula_id) || ' → ' || (SELECT code FROM formulas WHERE id = v_formula));
  END IF;
  IF v_plant IS DISTINCT FROM v_d.plant_id THEN
    v_cambios := v_cambios || jsonb_build_object('Planta',
      coalesce((SELECT name FROM plants WHERE id = v_d.plant_id), '-') || ' → ' || coalesce((SELECT name FROM plants WHERE id = v_plant), '-'));
  END IF;
  IF v_remito IS DISTINCT FROM v_d.remito THEN
    v_cambios := v_cambios || jsonb_build_object('Remito', coalesce(v_d.remito, '-') || ' → ' || coalesce(v_remito, '-'));
  END IF;
  IF v_tipo IS DISTINCT FROM v_d.remito_tipo THEN
    v_cambios := v_cambios || jsonb_build_object('Tipo de remito', coalesce(v_d.remito_tipo, 'sin tipo') || ' → ' || coalesce(v_tipo, 'sin tipo'));
  END IF;
  IF v_client IS DISTINCT FROM v_d.client_id THEN
    v_cambios := v_cambios || jsonb_build_object('Cliente',
      coalesce((SELECT name FROM clients WHERE id = v_d.client_id), '-') || ' → ' || coalesce((SELECT name FROM clients WHERE id = v_client), '-'));
  END IF;
  IF v_site IS DISTINCT FROM v_d.construction_site_id THEN
    v_cambios := v_cambios || jsonb_build_object('Obra',
      coalesce((SELECT name FROM construction_sites WHERE id = v_d.construction_site_id), '-') || ' → ' || coalesce((SELECT name FROM construction_sites WHERE id = v_site), '-'));
  END IF;
  IF v_mixer IS DISTINCT FROM v_d.mixer_id THEN
    v_cambios := v_cambios || jsonb_build_object('Camion',
      coalesce((SELECT license_plate FROM mixers WHERE id = v_d.mixer_id), '-') || ' → ' || coalesce((SELECT license_plate FROM mixers WHERE id = v_mixer), '-'));
  END IF;
  IF v_chofer IS DISTINCT FROM v_d.chofer_id THEN
    v_cambios := v_cambios || jsonb_build_object('Chofer',
      coalesce((SELECT nombre FROM choferes WHERE id = v_d.chofer_id), '-') || ' → ' || coalesce((SELECT nombre FROM choferes WHERE id = v_chofer), '-'));
  END IF;
  IF v_agua IS DISTINCT FROM v_d.extra_water_liters THEN
    v_cambios := v_cambios || jsonb_build_object('Agua extra (L)', coalesce(v_d.extra_water_liters::text, '-') || ' → ' || coalesce(v_agua::text, '-'));
  END IF;
  IF v_notes IS DISTINCT FROM v_d.notes THEN
    v_cambios := v_cambios || jsonb_build_object('Observaciones', coalesce(v_d.notes, '-') || ' → ' || coalesce(v_notes, '-'));
  END IF;
  IF v_fecha IS DISTINCT FROM v_d.dispatch_date THEN
    v_cambios := v_cambios || jsonb_build_object('Fecha', to_char(v_d.dispatch_date, 'DD/MM/YYYY HH24:MI') || ' → ' || to_char(v_fecha, 'DD/MM/YYYY HH24:MI'));
  END IF;

  UPDATE dispatches
     SET quantity_m3 = v_m3, formula_id = v_formula, plant_id = v_plant, remito = v_remito,
         client_id = v_client, construction_site_id = v_site, mixer_id = v_mixer, chofer_id = v_chofer,
         extra_water_liters = v_agua, notes = v_notes, dispatch_date = v_fecha,
         remito_tipo = v_tipo,
         remito_tipo_origen = CASE WHEN v_tipo IS DISTINCT FROM v_d.remito_tipo
                                   THEN CASE WHEN v_tipo IS NULL THEN NULL ELSE 'manual' END
                                   ELSE v_d.remito_tipo_origen END
   WHERE id = p_id;

  -- Fase 2: los m³ del viaje despachado son los reales del camión
  IF v_m3 <> v_d.quantity_m3 THEN
    UPDATE viajes SET m3 = v_m3, actualizado_por = v_usuario, updated_at = now() WHERE dispatch_id = p_id;
  END IF;

  IF v_cambios <> '{}'::jsonb THEN
    INSERT INTO activity_log (user_name, action, entity, entity_id, reference, plant_id, details)
    VALUES (v_usuario, 'editar', 'despacho', p_id::text, v_remito, v_plant,
            v_cambios
            || CASE WHEN v_motivo IS NOT NULL THEN jsonb_build_object('Motivo', v_motivo) ELSE '{}'::jsonb END
            || jsonb_build_object('Stock',
              CASE WHEN NOT v_recalc THEN 'sin cambios'
                   WHEN (v_res->>'sin_mover_por_recuento')::int > 0
                     THEN 'recalculado (' || (v_res->>'sin_mover_por_recuento') || ' materiales sin mover por recuento posterior)'
                   ELSE 'recalculado' END));
  END IF;

  RETURN jsonb_build_object('id', p_id, 'recalculado', v_recalc, 'cambios', v_cambios,
                            'sin_mover_por_recuento', coalesce((v_res->>'sin_mover_por_recuento')::int, 0));
END;
$function$;

-- ---------------------------------------------------------------------------
-- Permisos (mismo patrón que la fase 2: el permiso fino lo pone la pantalla hasta la 0c-2)
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.registrar_despacho(jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.editar_despacho(uuid, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.remito_tipo_para(uuid, uuid, uuid, date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.suspender_pedido(uuid, text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reabrir_pedido(uuid, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finalizar_pedido(uuid, text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.camion_volvio(uuid, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._remito_digitos(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._remito_tipo_de_numero(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._remito_repetido(uuid, text, text, uuid) TO anon, authenticated, service_role;
