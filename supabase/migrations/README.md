# Migraciones de la base (Rebucret)

Desde la fase 0d (30/09/2026) **todo cambio de esquema de la base vive en esta carpeta**. Los scripts de
`scripts/legacy/` son la historia vieja: no reconstruyen la base actual (faltan tablas, columnas, triggers e
índices que se crearon a mano) y no se vuelven a correr.

## Qué hay

| Archivo | Qué es |
|---|---|
| `000000000000_esquema_base.sql` | **Foto** del esquema `public` de producción al 30/09/2026 (después de la fase 0b), generada con `scripts/volcar-esquema.mjs`. Tablas, columnas, secuencias, funciones con su código, PK/UNIQUE/CHECK, índices, claves foráneas, triggers, RLS, comentarios y permisos de `anon`/`authenticated`/`service_role`. Sin datos. Al final, como comentario, el bucket de storage (`mantenimiento`) y sus políticas. |
| `202609291800_materiales_tipo.sql` | Fase 0b: `materials.tipo`, `descuenta_stock`, `corrige_humedad`. **Ya está incluida en la foto.** |
| `202609291810_motor_despacho.sql` | Fase 0b: funciones `registrar_despacho`, `editar_despacho`, `anular_despacho`, `ajustar_material_despacho` y auxiliares. **Ya está incluida en la foto.** |

### El orden

Los archivos se ordenan por nombre. La foto se llama `000000000000_…` para quedar primera, pero se sacó
**después** de aplicar las dos migraciones del 29/09: ya las contiene. Las dos del 29/09 quedan en la carpeta
como historia (qué se cambió y por qué) y se pueden volver a correr sobre la foto sin efecto (se probaron
aplicándolas dos veces). Toda migración nueva lleva una fecha posterior a `202609291810` y se aplica encima de
la foto.

## Reconstruir la base desde cero

En un proyecto Supabase nuevo, como el rol `postgres` (SQL editor o `psql`):

1. `000000000000_esquema_base.sql`
2. Las migraciones con fecha posterior a `202609291810`, en orden.

Después hay que cargar los datos (la foto no los tiene) y crear a mano el bucket `mantenimiento` (público) con
las dos políticas que figuran comentadas al final del archivo.

## Hacer un cambio de esquema

1. Crear `supabase/migrations/AAAAMMDDHHMM_descripcion.sql` (fecha y hora de cuando se escribe). Que se pueda
   correr dos veces sin romper nada (`if not exists`, `create or replace`, `on conflict`).
2. Probarla contra la base dentro de `BEGIN … ROLLBACK` (ver `docs/migracion-loop/fase-0.md`, "Reglas").
3. Aplicarla en producción **solo con el OK de Bautista**, junto con el deploy que la necesita.
4. Regenerar los tipos (abajo) y commitear `types/database.ts` junto con la migración.

## Tipos TypeScript (`types/database.ts`)

Generados del catálogo de la base con `scripts/generar-tipos.mjs`, con la misma forma que
`supabase gen types typescript` (`Database["public"]["Tables"][tabla]["Row" | "Insert" | "Update"]`,
`Functions`, y los atajos `Tables<"materials">`, `TablesInsert<…>`, `TablesUpdate<…>`, `FunctionArgs<…>`,
`FunctionReturns<…>`). Se usan en código nuevo:

```ts
import type { Tables, FunctionArgs } from "@/types/database"
type Material = Tables<"materials">
const args: FunctionArgs<"anular_despacho"> = { p_id: id, p_usuario: usuario, p_motivo: motivo }
```

Los clientes de `lib/supabase/` todavía no se tipan con `createClient<Database>()`: hacerlo marcaría errores en
pantallas viejas que usan columnas a mano. Se puede pasar de a una pantalla.

## Cómo correr los scripts

Los dos scripts solo hacen `SELECT` (transacción de solo lectura). Necesitan la variable `PGCONN` con
`POSTGRES_URL_NON_POOLING` de `.env.rebucret` (sin imprimirla nunca):

```sh
export PATH="$HOME/.local/node/bin:$PATH"
export PGCONN=$(grep '^POSTGRES_URL_NON_POOLING=' .env.rebucret | cut -d= -f2- | tr -d '"')

node scripts/generar-tipos.mjs                     # regenera types/database.ts
node scripts/volcar-esquema.mjs /tmp/esquema.sql   # foto actual, para comparar
```

**No volver a generar `000000000000_esquema_base.sql` encima de sí mismo.** Para saber si la base de producción
se corrió de lo que dice el repo (un cambio hecho a mano en el panel de Supabase), volcar a otro archivo y
comparar contra la foto más las migraciones posteriores.

## Seguridad en la base (fase 0c-2, desde la migración `202611241900_seguridad_rls.sql`)

Después de esa migración **la clave pública (anon) no puede nada** y el navegador habla con la base con el token de
la sesión (`authenticated`). Las reglas (RLS) leen los permisos de la persona en el momento con
`rebucret_permiso('seccion.accion', …)`. Detalle en `docs/migracion-loop/fase-0c.md`, "0c-2 · Especificación técnica".

Reglas para toda migración nueva (las controla `npm run test:seguridad`):

1. **Tabla nueva en `public`:** `ALTER TABLE … ENABLE ROW LEVEL SECURITY` en la misma migración, y sus reglas:
   - leer (si la lee el navegador): `CREATE POLICY rls_leer ON public.x FOR SELECT TO authenticated USING ((SELECT public.rebucret_sesion_ok()));`
   - escribir (si la escribe el navegador): `… FOR INSERT TO authenticated WITH CHECK ((SELECT public.rebucret_permiso('seccion.cargar')))`
     (y `FOR UPDATE … USING (…) WITH CHECK (…)` / `FOR DELETE … USING (…)` con el permiso que corresponda);
   - si solo la usa el servidor (clave de servicio): RLS prendida y ninguna regla.
   Nunca `GRANT … TO anon`. Desde la B, una tabla nueva **no le da nada por defecto a `authenticated`**: si la usa el
   navegador, `GRANT SELECT` (y `INSERT, UPDATE, DELETE` si escribe) `ON public.x TO authenticated` (y `USAGE` de su
   secuencia si tiene), además de las reglas.
2. **Función que escribe y llama el navegador** (`SECURITY DEFINER`): primera línea del `DECLARE`
   `v_permiso_0c2 boolean := public.rebucret_exigir('seccion.accion');` y el usuario con
   `public.rebucret_usuario(p_usuario)`. Las 10 del motor (`registrar_despacho`, `editar_despacho`, …) ya lo tienen:
   **si se reemplaza una, partir de `pg_get_functiondef` de producción** (que ya trae esas líneas) y no sacarlas.
3. Toda escritura nueva desde el navegador (`.from("x").insert/update/upsert/delete`) necesita su regla: si no, la
   prueba `test:seguridad` falla y en producción la base contesta "new row violates row-level security policy".
4. La vuelta atrás de la 0c-2 está en `vuelta-atras/` (no es parte de la lista: no se corre al reconstruir).
