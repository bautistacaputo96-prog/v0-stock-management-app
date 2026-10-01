# Fase 1 — Maestros tipo Loop

Estado: **aprobada por Bautista el 30/09/2026** (vio la maqueta).

Definiciones que cierran el diseño:
- **Chofer obligatorio al despachar**, pero solo cuando haya al menos un chofer activo cargado. Si la lista está vacía, se despacha igual y se muestra un aviso "Cargá los choferes en Camiones › Choferes". Así el día del deploy nadie queda bloqueado. Los nombres los cargan ellos desde la pantalla nueva.
- **Lista de finalidades:** la propuesta, sin cambios.
- **Condición de Bautista:** "los parámetros que ya utilizo tienen que estar". Ningún dato que se registra hoy puede desaparecer ni cambiar de lugar: ver la sección **"No se pierde nada"**, que el revisor controla uno por uno.

## No se pierde nada (condición obligatoria)

Estos campos y acciones existen hoy y tienen que seguir funcionando **igual**, con los mismos valores guardados en las mismas columnas. Las pruebas de aceptación y la revisión los chequean uno por uno.

**Despachar desde un pedido** (`plantista-view.tsx`, diálogo "Despachar camión"):
- Cantidad de este camión (m³), sugerida con el restante; camión; número de remito con aviso de repetido.
- **Agua extra en planta (L)** → `dispatches.extra_water_liters`.
- **Fibra**: switch + dosificación en kg/m³, precargada del pedido, con el total del camión calculado. Descuenta el stock de Fibra.
- **Muestra de probeta**: switch + número de muestra, con "Última muestra" a la vista, + asentamiento real. Crea las 3 probetas (1 a 7 días y 2 a 28 días).
- Después de despachar se abre "Camión despachado → Imprimir remito".
- **Humedad diaria de acopio** (solo Arena Fina) y su corrección en el descuento.

**Despacho manual** (`add-dispatch-dialog.tsx`):
- Datos principales:
  - planta, fórmula, humedad del acopio de arena, m³, remito;
  - mixer, cliente y obra (con altas rápidas);
  - **agua extra en planta**, **fibra (kg/m³)**;
  - **muestra** (número + asentamiento), fecha, observaciones.
- Modo **"Despacho por árido"** con carga manual de materias primas (material + kg).

**Pedido** (`dispatch-scheduling.tsx`):
- planta, fecha y hora de llegada, cliente y obra (con altas rápidas);
- **método de descarga obligatorio**, fórmula, cantidad total;
- **fibra (kg por m³)**, camión opcional, observaciones, programado por.

**Historial** (`dispatch-history.tsx`):
- ver remito;
- **agregar muestra** a posteriori;
- **agregar o editar fibra** y **superfluidificante**;
- editar, borrar (con devolución de stock según el motor de la 0b);
- filtros, gráfico y Excel. El Excel mantiene todas sus columnas actuales (Fibra, agua, muestra…) y **suma** Chofer y Finalidad.

**Calidad:** los despachos con muestra siguen apareciendo igual en Probetas, Rotura, Resultados, la tabla de Muestras (con agua extra y asentamiento) y el reporte semanal.

Regla para el obrero: los campos nuevos (chofer, finalidad, bomba) **se agregan** a los formularios. No se reemplaza ni se reordena lo existente, salvo ubicar el campo nuevo junto al que corresponde (el chofer al lado del camión).

Leer antes: `README.md` (principios y decisiones), `fase-0.md` (el motor de despacho de la 0b ya está en producción: todo despacho pasa por `registrar_despacho`/`editar_despacho`).

Decisiones de Bautista que condicionan esta fase (29/09):
- **Bombas: de terceros.** No son camiones propios: se modelan como empresa de bombeo asignada al pedido.
- **Choferes: rotan.** No hay chofer fijo por camión. El chofer se elige en cada despacho.

## Objetivo

Que el sistema sepa **quién manejó cada camión** y **qué bomba va a cada obra**, y que los tiempos de cada planta vivan en la base (hoy están en el navegador de cada uno). Es lo mínimo que necesitan las fases 2 (viajes) y 3 (despacho en 3 columnas).

## 1. Choferes

- **Tabla `choferes`:** `id`, `nombre` (obligatorio), `telefono`, `dni`, `activo` (por defecto true), `created_at`. Sin planta ni camión fijo, porque rotan.
- **Pantalla:** `/camiones` pasa a tener pestañas **Camiones | Choferes | Bombas**. Se respeta lo existente: misma página, mismo estilo de tarjetas.
  - Choferes permite alta, edición y baja lógica. La baja no borra: el chofer queda en los despachos viejos.
- **En el despacho** (Despacho diario, despacho manual y edición en Historial):
  - Campo **Chofer** con la lista de activos.
  - Por defecto, el chofer que hizo el último viaje de **ese camión en el día**. Como rotan, se puede cambiar.
  - Obligatorio / opcional: **lo decide Bautista** (propuesta: obligatorio).
- **Datos:** `dispatches.chofer_id` (FK a `choferes`, puede ser nulo para los despachos viejos).
  - `registrar_despacho` y `editar_despacho` aceptan `chofer_id`. Nueva migración que reemplaza las funciones sin romper las llamadas actuales: el parámetro es opcional en el jsonb.
- **Historial:** columna y filtro "Chofer", también en el Excel.
- **Despacho diario:** en "Camiones en ruta" y "Últimos despachos" se muestra el chofer.

## 2. Bombas de terceros

- **Tabla `empresas_bombeo`:** `id`, `nombre` (obligatorio), `contacto`, `telefono`, `observaciones`, `activo`. Se administra en la pestaña **Bombas** de `/camiones`.
- **En el pedido** (Programación · Semana y edición), solo cuando el método de descarga es **Bomba**:
  - **¿Quién pone la bomba?**: `Rebucret la contrata` / `La trae el cliente`.
  - **Empresa de bomba** (si la contrata Rebucret): lista de `empresas_bombeo`. Opcional al crear el pedido, para poder confirmarla el día anterior.
  - **Hora de la bomba en obra**: por defecto, la hora de llegada del primer camión.
- **Datos en `scheduled_dispatches`:** `bomba_la_pone` (`rebucret`|`cliente`, nulo si es directo), `bomba_empresa_id` (FK), `bomba_hora` (timestamptz).
- **Dónde se ve:**
  - En la tarjeta del pedido en Despacho diario: el badge BOMBA pasa a decir "BOMBA · Empresa X · 08:30" o "BOMBA (cliente)".
  - En la vista Día y en el calendario Semana.
  - Aviso en la vista Día: "pedido con bomba sin empresa asignada", para confirmarlo el día anterior.

## 3. Tiempos de cada planta, en la base

- **Columnas nuevas en `plants`:**

  | Columna | Valor por defecto |
  |---|---|
  | `t_carga_min` | 10 |
  | `t_descarga_bomba_min` | 15 (por 8 m³) |
  | `t_descarga_directa_min` | 25 (por 8 m³) |
  | `t_lavado_min` | 10 |
  | `jornada_inicio` | 07:00 |
  | `jornada_fin` | 18:00 |
  | `tolerancia_puntualidad_min` | **15** (estándar Loop; hoy el planificador usa 10) |
  | `bocas_carga` | 1 |

- **Vista Día › "Tiempos y camiones":** los tiempos se leen y se guardan en la planta elegida. Dejan de estar en `localStorage`.
  - Se muestra "Última modificación: fecha y quién" y se registra en `activity_log`.
  - Los **camiones disponibles del día** siguen en el navegador por ahora; se guardan en la Fase 2.
- `lib/planificador.ts` recibe los parámetros de la planta. Hoy son globales.
- Más adelante (Fase 6), un botón "Calcular desde el GPS" propone estos tiempos con los viajes reales.

## 4. Finalidad del pedido

- **`scheduled_dispatches.finalidad`**, texto de una lista fija: Platea / Fundación, Pilotes, Columnas, Vigas, Losa, Tabiques, Contrapiso, Pavimento / Carpeta, Otro. La lista la valida Bautista.
- En el formulario del pedido, opcional, al lado de la fórmula.
- Se ve en la tarjeta de Despacho diario, en la vista Día y en Historial (columna + Excel, tomada del pedido).

## Fuera de alcance

- Planta base del camión y camiones de terceros: los 5 son propios y compartidos.
- Documentación de choferes (licencia, vencimientos).
- Horas trabajadas por chofer (sale en la Fase 6 con el GPS).
- Remito con el nombre del chofer: se evalúa con el tema de la numeración del remito en la Fase 3.
- Importar choferes desde B-Track (Wialon tiene "conductores", pero Rebucret no los usa).

## Base de datos

- Migración `supabase/migrations/202610011000_fase1_maestros.sql`:
  - tablas `choferes` y `empresas_bombeo`;
  - columnas nuevas en `dispatches`, `scheduled_dispatches` y `plants`;
  - `registrar_despacho` y `editar_despacho` con `chofer_id`.
- Todo agregado, nada se borra. Es compatible con el front actual: se puede aplicar antes del deploy.
- Permisos como el resto de las tablas (la 0c pone la seguridad).
- Actualizar `types/database.ts` con el script de la 0d.

## Criterios de aceptación

1. Alta, edición y baja de choferes y de empresas de bomba desde `/camiones`. Las bajas no aparecen en las listas pero siguen en el historial.
2. Un despacho desde pedido y uno manual graban `chofer_id`. El chofer por defecto es el del último viaje del camión en el día. Editar en Historial permite cambiarlo.
3. Un pedido con bomba guarda quién la pone, la empresa y la hora. Se ve en Despacho diario, en la vista Día y en Semana. Un pedido directo no muestra nada de bomba.
4. Los tiempos editados en la vista Día para Canning no cambian los de Hudson, y los ve igual otra persona desde otra computadora.
5. La finalidad se elige en el pedido y aparece en Despacho diario, en la vista Día y en Historial.
6. **"No se pierde nada":** despachos de prueba (desde pedido con fibra y muestra, manual con agua extra y fibra, y por árido), corridos por el motor en `BEGIN … ROLLBACK`, graban exactamente las mismas columnas que antes de la fase más `chofer_id`. Capturas de los tres formularios antes y después para Bautista.
7. El motor de despacho sigue pasando todas las pruebas de la 0b dentro de `BEGIN … ROLLBACK`, más las nuevas de chofer.
8. Build limpio; `tsc` sin errores nuevos en los archivos tocados.
9. Deploy: primero la migración, después el front, fuera del horario de despacho.

## Hecho
_(lo completa la sesión obrero)_

### 30/09–01/10/2026 (obrero)
Rama local `loop/fase-1-maestros` (worktree `~/Documents/rebucret-fase1`, sin push ni merge). Commits: `3f5bec2` (esta especificación), `53fa9a3` (migración), `2b8cc54` (pantallas), más este registro.

**Migración (NO aplicada a producción):** `supabase/migrations/202610011000_fase1_maestros.sql`. Se puede correr dos veces.
- Tablas `choferes` (nombre, teléfono, DNI, activo) y `empresas_bombeo` (nombre, contacto, teléfono, observaciones, activo). Sin RLS, `GRANT ALL` a anon/authenticated como el resto.
- `dispatches.chofer_id` (FK sin ON DELETE: un chofer con despachos no se puede borrar, solo dar de baja; índice).
- `scheduled_dispatches.finalidad` (texto; la lista vive en `lib/maestros.ts` para poder ajustarla sin migración), `bomba_la_pone` (CHECK `rebucret`|`cliente`), `bomba_empresa_id` (FK), `bomba_hora`.
- `plants`: `t_carga_min` 10, `t_descarga_bomba_min` 15, `t_descarga_directa_min` 25, `t_lavado_min` 10, `jornada_inicio` 07:00, `jornada_fin` 18:00, `tolerancia_puntualidad_min` 15, `bocas_carga` 1 (NOT NULL con default y CHECK > 0).
- `registrar_despacho` / `editar_despacho`: se partió de `pg_get_functiondef` de producción (idéntico al repo). El diff es solo el chofer: `chofer_id` opcional en el jsonb (si no viene, igual que antes), validación "El chofer elegido no existe", columna en el INSERT/UPDATE, "Chofer" en Actividad (alta: solo si hay chofer; edición: "A → B"). Se conservan SECURITY DEFINER, `search_path=public, pg_temp`, hora de Argentina y permisos.

**Pantallas:**
- `/camiones`: pestañas Camiones | Choferes | Bombas (`camiones-tabs.tsx`, `maestro-lista.tsx`). Alta, edición, baja lógica con confirmación, "Ver dados de baja" y reactivar; aviso de repetido; todo queda en Actividad (tipos nuevos `chofer`, `bomba`, `planta`, también en el filtro de Actividad).
- Chofer (`chofer-select.tsx`) junto al camión en Despachar camión, despacho manual y Editar del Historial. Por defecto, el del último viaje de ese camión en el día (en cualquier planta; si se elige uno a mano no se pisa al cambiar de camión). Obligatorio solo si hay choferes activos; si no, aviso "Cargá los choferes en Camiones › Choferes" y se despacha igual. En el manual se exige solo si se eligió mixer; el despacho por árido no lleva chofer. Se ve en "Camiones en ruta", "Últimos despachos" y en el cartel "Camión despachado".
- Pedido (Semana y edición): con Bomba aparece "¿Quién pone la bomba?" (Rebucret la contrata / La trae el cliente), Empresa (opcional, "A confirmar") y Hora de la bomba (precargada con la llegada; se mueve con ella si eran iguales). Directo borra todo lo de bomba. Finalidad opcional debajo de la fórmula. Badge de Despacho diario: "BOMBA · Empresa · 08:30" / "BOMBA (cliente)"; finalidad al lado de la fórmula. Semana: una línea con empresa y hora. Vista Día: bomba y finalidad por pedido y aviso "Pedido con bomba sin empresa asignada".
- Historial: columnas Finalidad (del pedido) y Chofer (con filtro), búsqueda por ambos; el Excel conserva sus 15 columnas en el mismo orden y suma Chofer y Finalidad al final.
- Vista Día › Tiempos y camiones: los 4 tiempos + jornada, tolerancia y bocas se leen y guardan en la planta elegida (botón "Guardar tiempos de X", aviso de cambios sin guardar, "Última modificación: fecha · usuario" desde Actividad). Ya no se usa `localStorage` para los tiempos; los camiones disponibles siguen ahí. `lib/planificador.ts`: `parametrosDePlanta()`/`columnasDePlanta()`, tolerancia por defecto 15, `bocasCarga` (con 1 boca el cálculo es exactamente el de antes).
- Sin la migración todo anda como antes: las consultas usan `*` y las listas nuevas devuelven vacío si la tabla no existe.

**Pruebas: 94/94 OK** (`node` + `pg`, un único `BEGIN … ROLLBACK` contra producción; al final se verificó que no existen `choferes`, `empresas_bombeo`, `dispatches.chofer_id`, `plants.t_*` ni despachos de prueba).
- **"No se pierde nada" (6):** cuatro despachos con los mismos datos que mandan las pantallas — A desde pedido (agua extra 50 L, fibra 0,5 kg/m³, muestra con asentamiento 12), B manual (humedad de acopio 4 %, agua 30 L, fibra 1 kg/m³, muestra, fecha 29/09, observaciones), C1 por árido con fórmula, C2 por árido con materias primas manuales — corridos con las funciones de producción (antes) y con la migración aplicada (después). Se compararon todas las columnas de `dispatches`, `dispatch_materials`, `stock_movements`, `test_cylinders` (3: 7 d el 07/10 y 28 d el 28/10 para A), `activity_log`, `manual_material_withdrawals`/items, el pedido, `dispatch_status_log`, el camión y el stock de los 11 materiales que se movieron: **idénticos**; sin chofer, `chofer_id` queda nulo; con chofer, lo único distinto es `chofer_id` y la clave "Chofer" en Actividad (C1/C2 sin chofer).
- **0b (62):** las 62 pruebas de la 0b con la migración aplicada, todas OK (motor, errores, cruce de plantas, paridad con 5 despachos reales, anular/editar, ancla de recuento, permisos y search_path).
- **Nuevas (26):** alta/baja de choferes y empresas (sin nombre → error; borrar un chofer con despachos → no se puede; la baja conserva el dato); despacho manual y desde pedido graban `chofer_id`; chofer inexistente → error sin grabar nada; chofer por defecto = último viaje del camión hoy; editar solo el chofer no toca stock ni movimientos y deja "Chofer Prueba 1 → Chofer Prueba 2"; editar sin la clave lo conserva y con vacío lo quita; los 1.300+ despachos viejos quedan con chofer nulo; pedido con bomba de Rebucret / del cliente / directo (insert viejo); CHECK y FK de bomba; despachar no toca bomba ni finalidad; tiempos por defecto en las dos plantas, editar Canning no cambia Hudson, tiempo 0 → error; anon puede leer y escribir las tablas nuevas y los tiempos; funciones con los mismos atributos.

Build: `next build --webpack` limpio (en el worktree el build con Turbopack falla solo porque `node_modules` es un symlink fuera del worktree; en Vercel no aplica). `tsc`: 54 líneas de error en todo el repo (55 en `main`); en los archivos tocados quedan solo los 3 errores viejos (`add-dispatch-dialog` onSiteAdded, `plantista-view` Mixer[]), se fue el de `created_by` en `dispatch-scheduling`.

**Capturas** (local, sin grabar nada), en `/private/tmp/claude-501/-Users-bautistacaputo-Documents-v0-plant-production-control/aec4cd85-59dc-45a8-9077-b068ee49c837/scratchpad/fase1/capturas/`: antes `antes-01-camiones`, `02-pedido`, `03-dia-tiempos`, `04-despacho-diario`, `05-despachar-camion`, `06-despacho-manual`, `07-historial`; después `despues-01a-camiones`, `01b-choferes`, `01c-bombas`, `02a-semana`, `02b-pedido-bomba-finalidad`, `03-dia-tiempos`. Como la migración no está aplicada, las de "después" usan **datos de ejemplo inyectados en el navegador** (choferes Juan Pérez/Carlos Gómez/Miguel Sosa, empresas Bombeos del Sur/Hormibomba, bomba y finalidad inventadas en pedidos viejos) con toda escritura bloqueada. Faltan las de después de Despachar camión, despacho manual e Historial (se cortó el tiempo): en las tres el único cambio visible es el campo **Chofer** debajo de Camión/Mixer (o el aviso ámbar si no hay choferes) y, en Historial, las columnas Finalidad y Chofer; todo lo demás queda igual y en el mismo orden. Conviene verlas en el preview de Vercel después de aplicar la migración.

**Deploy (en este orden, fuera del horario de despacho):**
1. Aplicar `202610011000_fase1_maestros.sql` en producción (SQL editor o `psql`). Verificar: existen `choferes` y `empresas_bombeo`; `select name, t_carga_min, tolerancia_puntualidad_min, bocas_carga from plants;` da 10/15/1; un despacho con el front actual sigue andando (la función ignora la falta de `chofer_id`).
2. Recién entonces mergear `loop/fase-1-maestros` a `main` (Vercel publica). Al revés no: el front nuevo guarda bomba/finalidad/tiempos en columnas que no existirían.
3. Cargar los choferes en Camiones › Choferes (hasta que haya uno activo el chofer no es obligatorio) y las empresas de bombeo.
4. Probar un despacho real con chofer y mirar Historial/Actividad.

**Pendiente / a decidir:**
- `types/database.ts` (script de la 0d): la 0d no está en `main` todavía; regenerar los tipos cuando se mergee.
- La lista de finalidades no tiene CHECK en la base (a propósito); si Bautista la cambia, alcanza con `lib/maestros.ts`.
- Al pasar la tolerancia de 10 a 15 min, la vista Día marca en rojo menos pedidos (el primer camión tiene que llegar más de 15 min tarde).
- No se tocó `README.md` (falta la línea del registro de avance de la fase 1).
