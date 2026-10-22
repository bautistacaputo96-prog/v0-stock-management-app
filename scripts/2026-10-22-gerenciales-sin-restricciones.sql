-- Gerenciales sin restricciones: permisos = {} ("todo"). Rama loop/formulas (22/10/2026).
-- Spec: docs/migracion-loop/formulas-rediseno.md, "Permisos: gerencial todo salvo lo que se le saque".
--
-- Por qué: desde esta rama, a un gerencial solo lo frena un false explícito en app_users.permisos, y se guarda solo
-- lo que se le saca a mano. Hoy los 3 gerenciales tienen guardada la matriz completa de la plantilla vieja, con
-- false en acciones que no existen (carga.borrar, despacho.editar/borrar, usuarios.cargar/editar/borrar,
-- recuentos.ver/editar/borrar, mantenimiento.editar). Esas no cuentan, pero si mañana alguna acción pasa a existir
-- les quedaría sacada sin que nadie la destildara. Con {} no pierden nada: tienen todo, como hoy.
--
-- Orden:
--   1. Publicar la rama (o antes: con la regla vieja un gerencial no mira la matriz, así que {} no cambia nada).
--   2. Correr este script.
--   3. Recién después, Bautista entra a Usuarios y le destilda a Fernando Fórmulas · cargar, editar y borrar.
--      (Si se corre después del paso 3, le devuelve Fórmulas a Fernando.)
--
-- Paso 1 (solo mirar): los gerenciales y lo que tienen guardado.
SELECT id, name, active, permisos
FROM public.app_users
WHERE tipo = 'gerencial'
ORDER BY name;

-- Paso 2: dejar {} y asentarlo en Actividad (todo o nada).
BEGIN;

INSERT INTO public.activity_log (user_name, action, entity, entity_id, reference, plant_id, details)
SELECT 'Script 22/10/2026', 'editar', 'usuario', u.id::text, u.name, NULL,
       jsonb_build_object('Permisos', 'matriz completa → todo (gerencial sin restricciones)',
                          'Motivo', 'Gerencial: se guarda solo lo que se le saca a mano')
FROM public.app_users u
WHERE u.tipo = 'gerencial' AND u.permisos IS DISTINCT FROM '{}'::jsonb;

UPDATE public.app_users
SET permisos = '{}'::jsonb,
    permisos_actualizados_at = now(),
    permisos_actualizados_por = 'Script 22/10/2026'
WHERE tipo = 'gerencial' AND permisos IS DISTINCT FROM '{}'::jsonb;

COMMIT;

-- Paso 3 (mirar): tienen que quedar todos en {}.
SELECT name, permisos FROM public.app_users WHERE tipo = 'gerencial' ORDER BY name;
