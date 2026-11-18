-- Remito repetido: solo contra los despachos de los últimos 180 días (18/11/2026)
--
-- Por qué: los talonarios repiten números. El remito X 3331 de Regazzoni (17/11/2026) chocaba con "N°3331" del
-- 29/07/2025 y no se podía despachar ("Ya hay un remito X 3331 en Canning"). Del 29/07 al 09/09/2025 hay 20 remitos
-- de Canning entre 3331 y 3958 que iban a frenar los próximos X. La pantalla ya controla solo los últimos 30 días.
--
-- Qué cambia: `_remito_repetido` (la usan registrar_despacho y la edición de despachos) mira solo despachos con
-- fecha de los últimos 180 días. Nada más.
-- Qué pasa con los datos cargados: nada (no se toca ninguna fila).

CREATE OR REPLACE FUNCTION public._remito_repetido(p_plant_id uuid, p_remito text, p_tipo text, p_excluir uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM dispatches d
     WHERE d.plant_id = p_plant_id
       AND d.dispatch_date > now() - interval '180 days'
       AND (p_excluir IS NULL OR d.id <> p_excluir)
       AND CASE WHEN public._remito_digitos(p_remito) IS NOT NULL
                THEN public._remito_digitos(d.remito) = public._remito_digitos(p_remito)
                ELSE btrim(d.remito) = btrim(p_remito) END
       AND (p_tipo IS NULL
            OR coalesce(d.remito_tipo, public._remito_tipo_de_numero(d.remito)) IS NULL
            OR coalesce(d.remito_tipo, public._remito_tipo_de_numero(d.remito)) = p_tipo))
$function$;
