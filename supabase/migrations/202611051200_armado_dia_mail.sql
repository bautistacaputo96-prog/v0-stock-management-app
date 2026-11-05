-- Mail del armado del día y dónde amanecen los camiones (docs/specs/2026-11-05-dia-unificado-y-mail.md, 5.1)
-- SIN APLICAR: avisar a Bautista antes. Va después de 202611041900_reparto_camiones.sql. El job de pg_cron va aparte
-- (202611051210_armado_dia_cron.sql, después de publicar).
--
-- Qué agrega:
--   amanecer_camiones     dónde arranca cada camión un día, según la toma del GPS (17:00, 20:00 y cada mail): planta,
--                         por qué (fuente), estado del GPS, posición y la línea del mail. Una fila por fecha y camión.
--   armado_mail           estado del mail de cada fecha armada: toma del GPS, envíos, huella enviada y vista
--                         (antirrebote), reserva para que no salgan dos a la vez, a quién salió y el último error.
--   armado_mail_tomar()   reserva la fecha unos segundos (la pasada del cron y "Enviar ahora" no mandan dos a la vez).
--   guardar_reparto_dia() misma firma y mismo resultado; para contar el traslado de la mañana, "dónde durmió" pasa a ser
--                         la toma del GPS si hay y, si no, el reparto del día anterior (como hasta ahora).
--
-- Qué pasa con lo cargado: nada. Ningún pedido, viaje, despacho, reparto ni camión cambia. Las dos tablas arrancan
-- vacías; mientras amanecer_camiones esté vacía, guardar_reparto_dia da exactamente lo mismo que antes.
--
-- Permisos: las dos tablas las lee el navegador (SELECT a anon y authenticated) y las escribe solo el servidor (clave de
-- servicio). Sin RLS, como el resto (0c-2 pendiente, ver docs/migracion-loop/fase-0c.md). Se puede correr dos veces.

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.amanecer_camiones (
  fecha        date NOT NULL,
  mixer_id     uuid NOT NULL REFERENCES public.mixers(id) ON DELETE CASCADE,
  plant_id     uuid REFERENCES public.plants(id) ON DELETE SET NULL,
  fuente       text NOT NULL CHECK (fuente IN ('reparto_noche', 'gps_planta', 'ultimo_viaje', 'cercana', 'reparto', 'sin_dato')),
  estado_gps   text,
  lat          numeric,
  lng          numeric,
  km_planta    numeric(6,1),
  posicion_at  timestamptz,
  texto        text NOT NULL,
  tomado_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fecha, mixer_id)
);
COMMENT ON TABLE public.amanecer_camiones IS 'Dónde arranca cada camión un día según la toma del GPS (mail del armado). La escribe solo el servidor.';
GRANT SELECT ON TABLE public.amanecer_camiones TO anon, authenticated;
GRANT ALL ON TABLE public.amanecer_camiones TO service_role;

CREATE TABLE IF NOT EXISTS public.armado_mail (
  fecha              date PRIMARY KEY,
  toma_gps_at        timestamptz,
  toma_gps_2_at      timestamptz,
  primer_envio_at    timestamptz,
  ultimo_envio_at    timestamptz,
  envios             integer NOT NULL DEFAULT 0,
  huella_enviada     text,
  contenido_enviado  jsonb,
  huella_vista       text,
  vista_desde        timestamptz,
  enviando_hasta     timestamptz,
  enviando_por       text,
  a                  text[],
  ultimo_error       text,
  updated_at         timestamptz NOT NULL DEFAULT now()
);
-- Por si la tabla ya existía de una versión anterior de esta migración
ALTER TABLE public.armado_mail ADD COLUMN IF NOT EXISTS toma_gps_2_at timestamptz;
COMMENT ON TABLE public.armado_mail IS 'Estado del mail del armado de cada fecha (envíos, huella, antirrebote, reserva). La escribe solo el servidor.';
GRANT SELECT ON TABLE public.armado_mail TO anon, authenticated;
GRANT ALL ON TABLE public.armado_mail TO service_role;

-- Reserva la fecha p_segundos (crea la fila si no está). true = es tuya; false = otra pasada la tiene.
-- Se suelta poniendo enviando_hasta = null al terminar.
CREATE OR REPLACE FUNCTION public.armado_mail_tomar(p_fecha date, p_quien text, p_segundos integer DEFAULT 120)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_n int;
BEGIN
  INSERT INTO armado_mail (fecha) VALUES (p_fecha) ON CONFLICT (fecha) DO NOTHING;
  UPDATE armado_mail
     SET enviando_hasta = now() + make_interval(secs => greatest(1, coalesce(p_segundos, 120))),
         enviando_por = coalesce(p_quien, 'pasada'), updated_at = now()
   WHERE fecha = p_fecha AND (enviando_hasta IS NULL OR enviando_hasta < now());
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n = 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.armado_mail_tomar(date, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.armado_mail_tomar(date, text, integer) TO service_role;

-- Ajuste de guardar_reparto_dia (misma firma, mismo resultado): "dónde durmió" con la toma del GPS
CREATE OR REPLACE FUNCTION public.guardar_reparto_dia(p_fecha date, p_filas jsonb, p_usuario text DEFAULT NULL, p_borrar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'America/Argentina/Buenos_Aires'
AS $function$
DECLARE
  v_usuario   text := coalesce(nullif(btrim(coalesce(p_usuario, '')), ''), 'Sistema');
  v_vistos    uuid[] := '{}';
  v_detalle   jsonb := '{}'::jsonb;
  v_dia       int := 0;
  v_noche     int := 0;
  v_filas     int := 0;
  v_todas_sug boolean := true;
  e           jsonb;
  t           jsonb;
  v_mixer     uuid;
  v_patente   text;
  v_sale      boolean;
  v_tramos    jsonb;
  v_duerme    uuid;
  v_origen    text;
  v_plant     uuid;
  v_plant_ant uuid;
  v_desde     text;
  v_min       int;
  v_min_ant   int;
  v_i         int;
  v_texto     text;
  v_amanece   uuid;
BEGIN
  IF p_fecha IS NULL THEN
    RAISE EXCEPTION 'Falta la fecha del reparto';
  END IF;
  IF p_filas IS NULL OR jsonb_typeof(p_filas) <> 'array' THEN
    RAISE EXCEPTION 'El reparto tiene que venir como una lista de camiones';
  END IF;
  IF jsonb_array_length(p_filas) = 0 AND NOT coalesce(p_borrar, false) THEN
    RAISE EXCEPTION 'El reparto viene vacío: no se guardó nada. Para borrar el reparto del día hay que pedirlo explícitamente.';
  END IF;
  IF jsonb_array_length(p_filas) > 0 AND coalesce(p_borrar, false) THEN
    RAISE EXCEPTION 'Para borrar el reparto del día la lista tiene que venir vacía.';
  END IF;
  -- Dos personas guardando el mismo día: gana la última (una por vez)
  PERFORM pg_advisory_xact_lock(hashtext('reparto_camiones'), (p_fecha - DATE '2000-01-01'));

  DELETE FROM reparto_camiones WHERE fecha = p_fecha;

  IF coalesce(p_borrar, false) THEN
    INSERT INTO activity_log (user_name, action, entity, entity_id, reference, plant_id, details)
    VALUES (v_usuario, 'borrar', 'reparto', p_fecha::text, to_char(p_fecha, 'DD/MM/YYYY'), NULL,
            jsonb_build_object('Reparto', 'borrado: el día vuelve a planificarse con todos los camiones'));
    RETURN jsonb_build_object('fecha', p_fecha, 'camiones', 0, 'borrado', true);
  END IF;

  FOR e IN SELECT * FROM jsonb_array_elements(p_filas) LOOP
    v_mixer := nullif(e->>'mixer_id', '')::uuid;
    IF v_mixer IS NULL THEN
      RAISE EXCEPTION 'Falta el camión en una fila del reparto';
    END IF;
    IF v_mixer = ANY (v_vistos) THEN
      RAISE EXCEPTION 'Un camión está repetido en el reparto';
    END IF;
    v_vistos := v_vistos || v_mixer;
    SELECT license_plate INTO v_patente FROM mixers WHERE id = v_mixer AND coalesce(active, true);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El camión % no existe o no está activo. Actualizá la pantalla.', v_mixer;
    END IF;
    v_sale   := coalesce((e->>'sale')::boolean, true);
    v_tramos := coalesce(e->'tramos', '[]'::jsonb);
    v_duerme := nullif(e->>'duerme_plant_id', '')::uuid;
    v_origen := coalesce(nullif(e->>'origen', ''), 'a_mano');
    IF v_origen NOT IN ('sugerido', 'a_mano') THEN
      RAISE EXCEPTION 'Origen del reparto desconocido: %', v_origen;
    END IF;
    IF v_origen <> 'sugerido' THEN v_todas_sug := false; END IF;
    IF jsonb_typeof(v_tramos) <> 'array' THEN
      RAISE EXCEPTION '%: los tramos tienen que venir como una lista', v_patente;
    END IF;
    IF NOT v_sale THEN v_tramos := '[]'::jsonb; END IF;
    IF v_duerme IS NOT NULL AND NOT EXISTS (SELECT 1 FROM plants WHERE id = v_duerme) THEN
      RAISE EXCEPTION '%: la planta donde duerme no existe', v_patente;
    END IF;

    v_i := 0; v_plant_ant := NULL; v_min_ant := NULL; v_texto := NULL;
    FOR t IN SELECT * FROM jsonb_array_elements(v_tramos) LOOP
      v_plant := nullif(t->>'plant_id', '')::uuid;
      IF v_plant IS NULL OR NOT EXISTS (SELECT 1 FROM plants WHERE id = v_plant) THEN
        RAISE EXCEPTION '%: una planta del reparto no existe', v_patente;
      END IF;
      v_desde := nullif(t->>'desde', '');
      IF v_desde IS NULL THEN
        IF v_i > 0 THEN
          RAISE EXCEPTION '%: cada cambio de planta necesita su hora', v_patente;
        END IF;
        v_min := NULL;
      ELSE
        IF v_desde !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
          RAISE EXCEPTION '%: la hora % no es válida (HH:MM)', v_patente, v_desde;
        END IF;
        v_min := split_part(v_desde, ':', 1)::int * 60 + split_part(v_desde, ':', 2)::int;
        IF v_min_ant IS NOT NULL AND v_min <= v_min_ant THEN
          RAISE EXCEPTION '%: las horas de los cambios de planta tienen que ir en orden', v_patente;
        END IF;
      END IF;
      IF v_plant_ant IS NOT NULL AND v_plant = v_plant_ant THEN
        RAISE EXCEPTION '%: dos tramos seguidos en la misma planta', v_patente;
      END IF;
      v_texto := CASE WHEN v_texto IS NULL THEN (SELECT name FROM plants WHERE id = v_plant)
                      ELSE v_texto || ' → ' || (SELECT name FROM plants WHERE id = v_plant) || ' ' || v_desde END;
      IF v_i > 0 THEN v_dia := v_dia + 1; END IF;
      v_plant_ant := v_plant;
      v_min_ant := coalesce(v_min, v_min_ant);
      v_i := v_i + 1;
    END LOOP;

    -- Arranca en otra planta que donde durmió (reparto del día anterior): un traslado a primera hora
    -- Dónde durmió: la toma del GPS (amanecer_camiones) y, si no hay, el reparto del día anterior
    v_amanece := coalesce(
      (SELECT plant_id FROM amanecer_camiones WHERE fecha = p_fecha AND mixer_id = v_mixer),
      (SELECT duerme_plant_id FROM reparto_camiones WHERE fecha = p_fecha - 1 AND mixer_id = v_mixer));
    IF v_amanece IS NOT NULL AND jsonb_array_length(v_tramos) > 0
       AND v_amanece <> nullif(v_tramos->0->>'plant_id', '')::uuid THEN
      v_dia := v_dia + 1;
    END IF;
    -- Duerme en otra planta que donde termina: un traslado a la noche
    IF v_duerme IS NOT NULL AND coalesce(v_plant_ant, v_amanece) IS NOT NULL AND v_duerme <> coalesce(v_plant_ant, v_amanece) THEN
      v_noche := v_noche + 1;
    END IF;

    INSERT INTO reparto_camiones (fecha, mixer_id, sale, tramos, duerme_plant_id, origen, actualizado_por, updated_at)
    VALUES (p_fecha, v_mixer, v_sale, v_tramos, v_duerme, v_origen, v_usuario, now());
    v_filas := v_filas + 1;

    v_detalle := v_detalle || jsonb_build_object(v_patente,
      CASE WHEN NOT v_sale THEN 'no sale'
           ELSE coalesce(v_texto, 'sin planta') END
      || CASE WHEN v_duerme IS NOT NULL THEN ' · duerme en ' || (SELECT name FROM plants WHERE id = v_duerme) ELSE '' END);
  END LOOP;

  v_detalle := v_detalle || jsonb_build_object(
    'Traslados', v_dia || ' en el día · ' || v_noche || ' a la noche',
    'Origen', CASE WHEN v_todas_sug THEN 'sugerencia' ELSE 'a mano' END);

  INSERT INTO activity_log (user_name, action, entity, entity_id, reference, plant_id, details)
  VALUES (v_usuario, 'editar', 'reparto', p_fecha::text, to_char(p_fecha, 'DD/MM/YYYY'), NULL, v_detalle);

  RETURN jsonb_build_object('fecha', p_fecha, 'camiones', v_filas, 'traslados_dia', v_dia, 'traslados_noche', v_noche);
END;
$function$;

REVOKE ALL ON FUNCTION public.guardar_reparto_dia(date, jsonb, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guardar_reparto_dia(date, jsonb, text, boolean) TO anon, authenticated, service_role;

COMMIT;
