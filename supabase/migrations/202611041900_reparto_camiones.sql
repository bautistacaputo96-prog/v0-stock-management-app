-- Reparto de camiones por planta (docs/specs/2026-11-04-camiones-por-planta.md, punto 5)
-- SIN APLICAR: avisar a Bautista antes. Va después de 202610291000.
--
-- Qué agrega (todo nuevo; no cambia ninguna tabla ni función existente):
--   traslados_plantas     una fila por par de plantas (hoy, Canning ↔ Hudson): minutos del traslado de un mixer vacío
--                         y, opcionales, km y litros. Arranca VACÍA: mientras no se cargue, la programación usa la ruta
--                         del mapa o 60 min con la marca "a confirmar". Se carga en Programación › Tiempos y camiones.
--   reparto_camiones      una fila por camión y día: si sale, sus tramos ([{plant_id, desde "HH:MM"}], el primero con
--                         desde null = desde que arranca el día; cada tramo dura hasta el siguiente − traslado), dónde
--                         duerme (el "amanece en" del día siguiente) y si se guardó la sugerencia tal cual o a mano.
--   guardar_reparto_dia() reemplaza el reparto de una fecha entera (todo o nada), valida y deja la línea en Actividad.
--
-- Qué pasa con los datos ya cargados: nada. Ningún pedido, viaje, despacho ni camión cambia. mixers.plant_id sigue en
-- null (los camiones siguen siendo compartidos). Un día sin reparto guardado se planifica como hasta ahora (todos los
-- camiones disponibles en las dos plantas). Los camiones elegidos en el navegador quedan para quien no tiene el
-- interruptor de funciones nuevas.
--
-- Permisos: como el resto (sin RLS; la 0c-2 lo cierra, ver docs/migracion-loop/fase-0c.md). traslados_plantas se
-- escribe desde la pantalla (gerencial, con motivo); reparto_camiones solo se lee desde el navegador y se escribe con
-- guardar_reparto_dia. Se puede correr dos veces.

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- Traslado entre plantas (sirve para los dos sentidos: plant_a < plant_b)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.traslados_plantas (
  plant_a          uuid NOT NULL REFERENCES public.plants(id) ON DELETE CASCADE,
  plant_b          uuid NOT NULL REFERENCES public.plants(id) ON DELETE CASCADE,
  minutos          integer NOT NULL CHECK (minutos > 0),
  km               numeric(6,1) CHECK (km IS NULL OR km > 0),
  litros           numeric(6,1) CHECK (litros IS NULL OR litros > 0),
  actualizado_por  text,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (plant_a, plant_b),
  CONSTRAINT traslados_plantas_orden CHECK (plant_a < plant_b)
);
COMMENT ON TABLE public.traslados_plantas IS 'Reparto de camiones: minutos (y km/litros opcionales) del traslado de un mixer vacío entre dos plantas. plant_a < plant_b.';

GRANT SELECT, INSERT, UPDATE ON TABLE public.traslados_plantas TO anon, authenticated;
GRANT ALL ON TABLE public.traslados_plantas TO service_role;

-- ---------------------------------------------------------------------------
-- Reparto del día: una fila por camión y fecha (día argentino)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reparto_camiones (
  fecha            date NOT NULL,
  mixer_id         uuid NOT NULL REFERENCES public.mixers(id) ON DELETE CASCADE,
  sale             boolean NOT NULL DEFAULT true,
  tramos           jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(tramos) = 'array'),
  duerme_plant_id  uuid REFERENCES public.plants(id) ON DELETE SET NULL,
  origen           text NOT NULL DEFAULT 'a_mano' CHECK (origen IN ('sugerido', 'a_mano')),
  actualizado_por  text,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fecha, mixer_id)
);
COMMENT ON TABLE public.reparto_camiones IS 'Reparto de camiones por planta y hora de cada día. Se escribe solo con guardar_reparto_dia.';

GRANT SELECT ON TABLE public.reparto_camiones TO anon, authenticated;
GRANT ALL ON TABLE public.reparto_camiones TO service_role;

-- ---------------------------------------------------------------------------
-- Guardar el reparto de una fecha (todo o nada)
-- p_filas: [{ mixer_id, sale, tramos: [{ plant_id, desde: "HH:MM" | null }], duerme_plant_id, origen }]
-- Reemplaza todas las filas de esa fecha. Una lista vacía se rechaza (borraría el reparto del día sin querer), salvo
-- que venga p_borrar = true: entonces se borra el reparto de esa fecha y queda en Actividad. Valida: camión activo y sin repetir, plantas que existen, horas HH:MM
-- crecientes (solo el primer tramo puede ir sin hora), dos tramos seguidos de distinta planta. Los avisos (un camión
-- que no llega, un traslado corto) son de la pantalla y no frenan.
-- ---------------------------------------------------------------------------
-- Versión anterior de esta misma migración (sin p_borrar), por si se llegó a correr: se reemplaza
DROP FUNCTION IF EXISTS public.guardar_reparto_dia(date, jsonb, text);

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
    SELECT duerme_plant_id INTO v_amanece FROM reparto_camiones WHERE fecha = p_fecha - 1 AND mixer_id = v_mixer;
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
