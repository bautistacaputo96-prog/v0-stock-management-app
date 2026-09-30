# Fase 0 — Cimientos

Aprobada por Bautista el 29/09/2026 ("Fase 0 primero"). Se programa en este orden: **0a → 0b → 0d**. La **0c (seguridad)** tiene su propia especificación (`fase-0c.md`, a escribir) y se hace en paralelo a las fases 1–3.

Leer antes: `README.md` (principios) e `inventario-rebucret.md` (secciones 3.2, 3.9, 3.10, 4.6 y 8).

## Reglas para esta fase

- **El servidor local usa la base de PRODUCCIÓN** (`.env.local`). No probar nada que escriba desde la pantalla local. Las funciones SQL se prueban con `node` + `pg` dentro de `BEGIN … ROLLBACK`. La conexión es `POSTGRES_URL_NON_POOLING` de `.env.rebucret`: sacar `sslmode` de la URL, usar `ssl: { rejectUnauthorized: false }` y pasarla por la variable de entorno `PGCONN`, nunca impresa.
- Los cambios de esquema van como archivos en `supabase/migrations/AAAAMMDDHHMM_nombre.sql` y se aplican a producción **recién con el OK de Bautista**, junto con el deploy.
- Build: `export PATH="$HOME/.local/node/bin:$PATH"; npm run build`. No agregar dependencias: Vercel usa `pnpm-lock.yaml`.
- Probar local: config `rebucret` de `.claude/launch.json` en el repo Concretus, puerto 3010. Para loguearse, setear en localStorage `rebucret-auth`=`true` y `rebucret_current_user`=`{"name":"Bautista Caputo","role":"supervisor"}`.
- Rama: `loop/fase-0a-errores`, `loop/fase-0b-motor-despacho`, etc. Commits con el mail `bautistacaputo96@gmail.com`, en español, estilo `fix(…)`/`feat(…)` como el historial.
- Al terminar cada parte: completar la sección "Hecho" al final de este archivo y agregar una línea al registro de avance del `README.md`.

---

## 0a — Errores encontrados en el inventario (una sesión)

Cada ítem lista el problema, dónde está y cuándo está resuelto.

1. **La humedad diaria de acopio no se guarda nunca.**
   - `components/plantista-view.tsx` (`saveHumidity`, ~l.155–194) inserta `log_date` y `humidity_percentage`, pero las columnas reales de `daily_stockpile_humidity` son `reading_date` y `humidity_percent`. Hay que verificar el esquema real con una consulta de solo lectura. `checkDailyHumidity` también filtra por `log_date`. Además no se revisa el `error` del insert.
   - **Resuelto cuando:** al guardar queda la fila; el trigger `trg_update_stockpile_humidity` actualiza `materials.stockpile_humidity`; el cartel no vuelve a aparecer ese día; si hay un error se muestra.
2. **Editar la cantidad de un ingreso no corrige el stock.**
   - `components/stock-entries-table.tsx` (~l.66 y ~l.106–108) llama a las RPC `increment_stock`/`decrement_stock`, que no existen.
   - Hay que usar `update_material_stock(p_material_id, p_quantity_change)` con la diferencia y corregir también `dry_stock` según la humedad del ingreso.
   - En el borrado, sacar la llamada a la RPC inexistente: el trigger `trigger_decrease_stock_on_entry_delete` ya descuenta.
   - **Resuelto cuando:** editar de 30.000 a 28.000 kg baja 2.000 kg el stock, sin doble descuento al borrar.
3. **"A tiempo %" siempre da 100 %** en `components/dispatch-history.tsx` (~l.314–320, tarjeta ~l.959). No existen horas reales de llegada. **Ocultar la tarjeta** hasta la Fase 4 (vuelve con datos reales).
4. **El panel "Consumo real vs teórico de cemento" del Dashboard** (`components/dashboard-client.tsx` ~l.505–530 y ~l.1011) busca "cemento", pero el material se llama "CPC 40". Además, lo "real" sale de la misma fórmula, así que el desvío siempre es 0. **Ocultarlo**: vuelve cuando haya consumo real de la dosificadora.
5. **El resumen de Despacho diario mezcla las dos plantas.**
   - `loadData` en `plantista-view.tsx` trae `dispatches` del día sin filtrar por planta.
   - Afecta "Resumen del día", "Últimos despachos", "Camiones en ruta" y "Despachos manuales".
   - Filtrar por `plant_id = selectedPlant`.
6. **Remito repetido sin aviso al despachar un pedido.**
   - `handleDispatch` en `plantista-view.tsx` no hace la validación anti-duplicado que sí hace `add-dispatch-dialog.tsx` (~l.359–367).
   - Aplicar la misma regla y el mismo mensaje.
7. **Materiales que no deberían descontarse al despachar un pedido.**
   - El despacho manual excluye Agua y "Sikament 33" (aditivo de obra); el del pedido no.
   - Igualar el comportamiento (excluir los mismos) como arreglo provisorio. En la 0b se reemplaza por el tipo de material.

No incluir en la 0a: borrar despacho sin devolver stock (va en la 0b como función transaccional).

Prueba: build limpio; revisar local cada pantalla tocada, sin grabar nada. Los puntos 1, 2 y 6 se prueban con la lógica SQL equivalente en `BEGIN … ROLLBACK`. Pasarle a Bautista capturas de Despacho diario y de Historial.

---

## 0b — Un solo motor de despacho (2–3 sesiones)

**Objetivo:** que registrar, editar y anular un despacho se haga en **una sola transacción en la base**, desde un único lugar, con las mismas reglas desde cualquier pantalla. Es la base de las fases 2–4: después se le suman viaje, chofer y horarios sin tocar la interfaz.

### Datos
- `materials`: agregar `tipo` (`arido_fino`, `arido_grueso`, `cemento`, `agua`, `aditivo_planta`, `aditivo_obra`, `fibra`, `otro`) y `descuenta_stock boolean default true`.
  - Migración que los complete según los nombres actuales: Arena → `arido_fino` (corrige por humedad); Piedra → `arido_grueso`; CPC 40 → `cemento`; Agua → `agua`, `descuenta_stock=false`; Sikament 33S → `aditivo_obra`, `descuenta_stock=false`; Sikament 90E → `aditivo_planta`; Fibra → `fibra`; "Superfluidificante (obra)" → `aditivo_obra`.
  - Confirmado por Bautista el 29/09: Agua y Sikament 33S no descuentan stock.
- `dispatch_materials`: empezar a completar `dry_quantity`, `wet_quantity` y `humidity_at_dispatch`.

### Funciones (plpgsql, `SECURITY DEFINER`, `search_path` fijo)
1. `registrar_despacho(p jsonb) returns jsonb`
   - **Entrada:** planta, pedido (opcional), fórmula, cliente, obra, mixer, m³, remito, fecha/hora, agua extra, fibra kg/m³, muestra (número y asentamiento), `es_prueba` (despacho por árido), materiales manuales (opcional), usuario, observaciones.
   - **Qué hace, todo junto o nada:**
     - valida el remito (no repetido) y los m³ (no superar el restante del pedido + 0,5);
     - **fórmulas de otra planta están permitidas** (Bautista, 29/09: "hay fórmulas de Hudson que se utilizan en Canning", y al revés). Pero los materiales se descuentan del stock **de la planta que despacha**: cada material de la fórmula se busca por tipo y nombre en esa planta (p. ej. "CPC 40" de Canning → "CPC 40" de Hudson). Si falta el equivalente, frena y avisa. Hoy el sistema descuenta del stock de la planta dueña de la fórmula (visto en la 0a: 25/09, MERVA SA, despachado desde Hudson con H30-620-15 B (CAN) descontó materiales de Canning). Contar cuántos despachos cruzados hay desde el 25/06 (inicio de Hudson) y proponer a Bautista la corrección de stock entre plantas;
     - inserta en `dispatches`;
     - por cada material de la fórmula con `descuenta_stock`: kg = kg/m³ × m³ y, si es `arido_fino`, × (1 + humedad del acopio / 100). Inserta `dispatch_materials` con seco, húmedo y humedad, descuenta `current_stock` y inserta `stock_movements` 'consumo';
     - fibra igual, sobre el material `tipo='fibra'` de la planta;
     - probetas: las crea el trigger existente; no duplicar;
     - pedido: `dispatched_m3 = dispatched_m3 + m3` (atómico) y `completed` si se llegó al total;
     - mixer en `in_transit`;
     - `dispatch_status_log` y `activity_log` ("crear despacho").
   - **Devuelve:** `{ id, remito, m3, restante, completo }`.
2. `anular_despacho(p_id uuid, p_usuario text, p_motivo text)`
   - Devuelve el stock de cada `dispatch_materials` con movimiento 'ajuste' ("Anulación remito X").
   - Resta `dispatched_m3` del pedido y lo reabre si corresponde.
   - Borra probetas **sin resultados** y frena si alguna ya tiene rotura cargada.
   - Borra `dispatch_materials` y el despacho.
   - Deja la copia en `activity_log`. Mantener el mail de aviso de borrado.
3. `editar_despacho(p_id uuid, p jsonb)`
   - Si cambian m³, fórmula o planta, recalcula materiales y stock por diferencia y corrige el pedido.
   - Si cambian solo datos (remito, cliente, obra, camión, observaciones), actualiza sin tocar stock.
   - Registra lo anterior y lo nuevo en `activity_log`.

### Pantallas que pasan a usar las funciones (misma interfaz, sin cambios visibles)
- `plantista-view.tsx` → `handleDispatch`.
- `add-dispatch-dialog.tsx` → `handleSubmit` (incluido el despacho por árido y los materiales manuales).
- `dispatch-history.tsx` → borrar y editar. Agregar fibra y superfluidificante también por función (`ajustar_material_despacho`).
- Quitar del front los cálculos de consumo duplicados. La cuenta en pantalla ("total en el camión: X kg") puede quedar solo para mostrar.

### Resuelto cuando
- Un despacho de prueba dentro de `BEGIN … ROLLBACK` deja exactamente: 1 despacho, N `dispatch_materials`, N movimientos, stock descontado, pedido actualizado y 3 probetas si hay muestra.
- Si falla cualquier paso (por ejemplo, remito repetido) no queda nada grabado.
- Comparación contra el código actual: para 5 despachos reales recientes (fórmula, m³, humedad), el motor calcula los mismos kg que se descontaron. Las únicas diferencias son las exclusiones acordadas.
- Anular y editar dejan el stock y el pedido como si el despacho no hubiera existido o como si hubiera sido el corregido.
- Ninguna pantalla cambia de aspecto.
- **Deploy coordinado:** primero la migración (funciones + columnas, compatibles con el código viejo), después el front. Hacerlo fuera del horario de despacho, con Bautista avisado.

---

## 0d — Migraciones versionadas y tipos (una sesión, después de la 0b)

- Volcar el esquema real actual (tablas, funciones, triggers, índices, checks) a `supabase/migrations/000000000000_esquema_base.sql` con una consulta de solo lectura (`pg_dump --schema-only` o `information_schema`/`pg_catalog`), para que la base pueda reconstruirse desde el repo.
- Mover `scripts/*.sql` viejos a `scripts/legacy/` (no se borran).
- Generar tipos TypeScript de las tablas (`types/database.ts`) y usarlos al menos en las funciones nuevas.
- Actualizar `DOCUMENTACION_TECNICA.md` o marcarlo como histórico y apuntar a `docs/migracion-loop/`.

---

## Hecho
_(lo completa cada sesión obrero: fecha, rama, commits, qué quedó pendiente)_

### 0a — 29/09/2026 (obrero)
Rama local `loop/fase-0a-errores` (sin push ni merge). Commits: `7695302` (despacho: ítems 1, 5, 6, 7), `26e43c7` (ingresos: ítem 2), `5b677dc` (indicadores: ítems 3, 4). Sin migraciones SQL: no hizo falta cambiar el esquema. Build limpio (`npm run build`); `tsc` no suma errores nuevos (los que hay ya estaban en `main`).

1. **Humedad diaria** (`plantista-view.tsx`). El esquema real es `reading_date` / `humidity_percent` (+ `recorded_by`) con índice único `(plant_id, material_id, reading_date)`. Ahora hace upsert con esas columnas, fecha local (antes UTC: después de las 21 h daba el día siguiente), revisa el `error` y lo muestra, y no acepta el % vacío (antes lo guardaba como 0). Probado en `BEGIN…ROLLBACK`: al guardar 4,5 el trigger deja `materials.stockpile_humidity` = 4,5; un segundo guardado el mismo día reemplaza la fila (queda 1); la consulta de `checkDailyHumidity` la encuentra (el cartel no vuelve); el insert viejo falla con "column log_date does not exist". En local el modal aparece (hoy 0 filas) y se cerró con "Omitir por ahora".
2. **Editar ingreso** (`stock-entries-table.tsx`). Usa `update_material_stock(diferencia)` después de actualizar la fila; actualiza `dry_quantity` del ingreso (si no, el trigger de borrado descontaría el seco viejo) y, solo en Arena Fina (mismo criterio que el alta), corrige `dry_stock` con la humedad del ingreso. Borrar ya no llama a la RPC inexistente. Probado en `BEGIN…ROLLBACK` con un ingreso de prueba: Piedra 6/12 30.000 → 28.000 baja 2.000 y al borrar baja 28.000 (neto 0, sin doble descuento); Arena Fina al 4 %: húmedo −2.000, seco −1.923,08, al borrar neto 0 (−0,01 kg de redondeo en seco).
3. **"A tiempo %"** del Historial: tarjeta y cálculo quitados; quedan 3 tarjetas.
4. **"Consumo real vs teórico"** del Dashboard: tarjeta y cálculo quitados. El Panel de Calidad queda solo en su fila (media pantalla, a la izquierda).
5. **Resumen del Despacho diario** filtra `dispatches` por `plant_id` (0 de 1.317 despachos sin planta). Verificado local el 25/09: Canning 1 despacho / 8 m³ y Hudson 13 / 98 m³, igual que la base (antes cada planta mostraba 14 / 106).
6. **Remito repetido** al despachar un pedido: misma consulta y mismo mensaje que el despacho manual (global, no por planta: de los 64 repetidos solo 1 es entre plantas). Consulta probada contra la base (remito existente → frena; inventado → pasa).
7. **Agua y Sikament 33S** ya no se descuentan al despachar un pedido (misma regla por nombre que el manual). Igual que el manual, **siguen grabando `dispatch_materials` y el `stock_movements` 'consumo'** (el libro los cuenta aunque el stock no se mueva); se ordena en la 0b con `descuenta_stock`. Afecta 50 fórmulas con Agua y 38 con Sikament 33S (últimos 30 días: ~300.700 kg de agua y ~1.240 kg de Sikament 33S que ya no bajan stock).

Capturas (local, sin grabar nada), en `/private/tmp/claude-501/-Users-bautistacaputo-Documents-v0-plant-production-control/aec4cd85-59dc-45a8-9077-b068ee49c837/scratchpad/fase0a/`: `01-despacho-modal-humedad.jpg`, `02-despacho-canning-25-09.jpg`, `03-despacho-hudson-25-09.jpg`, `04-historial-sin-a-tiempo.jpg`, `05-dashboard-sin-panel-cemento.jpg` (carpeta temporal de la sesión: copiarlas si se quieren guardar).

Para el deploy / decisiones de Bautista:
- **Con el ítem 1 la humedad diaria empieza a pesar en el descuento.** El modal lista todo lo que tenga "arena" en el nombre (Arena Fina y Arena Trituración 0/6 de cada planta) y el despacho multiplica esos materiales por (1 + h/100). Hoy solo Arena Fina de Canning tiene 3 %; si el plantista carga, por ejemplo, 6 % en la 0/6 de Hudson, desde ese momento cada despacho descuenta 6 % más de ese material. Avisar a los plantistas qué medir.
- Los ítems 5 y 6 cambian lo que ve el plantista: cada planta ve solo sus despachos y camiones en ruta (un mixer despachado desde Hudson no aparece en "en ruta" de Canning), y un remito ya usado se rechaza.
- Visto de paso (fuera de alcance): hay despachos de Hudson con fórmulas "(CAN)" (p. ej. 25/09, MERVA SA, H30-620-15 B (CAN)): descuentan materiales de Canning. En "Actividad reciente" del Dashboard los despachos dicen "a null".

### 0b — 29-30/09/2026 (obrero)
Rama local `loop/fase-0b-motor-despacho` (sin push ni merge). Commits: `ce45cd4` (migraciones), `12f036f` (pantallas), más este registro. Build limpio; `tsc` no suma errores en los archivos tocados (hay menos que en `main`).

**Migraciones (NO aplicadas a producción)**, en `supabase/migrations/`:
1. `202609291800_materiales_tipo.sql` — `materials.tipo` (`arido_fino`, `arido_grueso`, `cemento`, `agua`, `aditivo_planta`, `aditivo_obra`, `fibra`, `otro`, NOT NULL + CHECK), `descuenta_stock` (default true) y **`corrige_humedad`** (default false). Decisión: la Arena Trituración 0/6 queda `arido_fino` (es lo que es) pero con `corrige_humedad=false`; solo la Arena Fina corrige. Una marca aparte es más clara que "disfrazar" la 0/6 de árido grueso. Completa las 22 filas por nombre (Agua y Sikament 33S `descuenta_stock=false`; Sikament 90E `aditivo_planta`; Superfluidificante (obra) `aditivo_obra`, sí descuenta). La única regla por nombre que queda vive en `clasificar_material(nombre)` y la usa un trigger `BEFORE INSERT` para dar tipo a un material nuevo dado de alta desde la pantalla actual (que no manda tipo). `requires_humidity_control` no se toca (la usa el recuento).
2. `202609291810_motor_despacho.sql` — funciones plpgsql `SECURITY DEFINER`, `search_path=public`, `timezone=America/Argentina/Buenos_Aires`, con `EXECUTE` para anon/authenticated (RLS sigue apagado):
   - `registrar_despacho(p jsonb)`: en una transacción valida remito (no repetido en todo el sistema, compara sin espacios, con lock por número para dos pantallas a la vez), m³ contra restante + 0,5, pedido no cancelado ni completo; inserta el despacho; por cada material de la fórmula busca **el mismo material (tipo + nombre) en la planta que despacha** (si falta frena: "La planta Hudson no tiene el material X (lo usa la fórmula Y)…"); kg = kg/m³ × m³ × (1 + humedad) solo si `corrige_humedad`; graba `dispatch_materials` con `dry_quantity`, `wet_quantity`, `humidity_at_dispatch` (quantity = húmedo), baja `current_stock` solo si `descuenta_stock` (atómico), `stock_movements` 'consumo' por cada fila (Agua y Sikament 33S también, como hoy); fibra sobre el material `tipo='fibra'` de la planta; pedido `dispatched_m3 = dispatched_m3 + m3` y `completed` al llegar; `dispatch_status_log`; camión `in_transit` (solo si viene de un pedido, como hoy); `activity_log` "crear despacho" (ahora también para Despacho diario). Con `materiales_manuales` (despacho por árido + ingreso manual) registra la salida manual como hoy (sin despacho), mapeando cada material a la planta elegida. Devuelve `{id, remito, m3, restante, completo, probetas, materiales}`.
   - `anular_despacho(p_id, p_usuario, p_motivo)`: frena si alguna probeta tiene rotura (resistencia, lectura o fecha real); devuelve el stock con movimiento 'consumo' negativo ("Anulación remito X"; ver revisión abajo); resta los m³ del pedido y lo reabre si estaba completo y ya no llega (no reabre los cerrados a mano con "Finalizar"); pedido viejo 1:1 (`scheduled_dispatches.dispatch_id`) se borra como antes, o se desvincula si tiene otros camiones; borra probetas, materiales y despacho; copia en `activity_log`. El mail de aviso sigue saliendo desde el Historial.
   - `editar_despacho(p_id, p jsonb)`: solo datos (remito, cliente, obra, camión, agua, observaciones, fecha) → no toca stock; remito nuevo repetido → error. Cambian los m³ → escala cada material de la fórmula y la fibra (conserva la humedad y las exclusiones con que se cargó), stock y pedido por diferencia (movimiento 'consumo' con la diferencia, como ya hacía la fibra). Cambia fórmula o planta → recalcula como `registrar_despacho` con la humedad actual del acopio. El superfluidificante agregado en obra no se toca. Registra antes → después en Actividad.
   - `ajustar_material_despacho(id, 'fibra'|'superfluidificante', cantidad, usuario, nota)`: fija el total de ese material en el despacho y corrige stock por la diferencia (Historial).
   - Auxiliares: `_material_en_planta`, `_consumo_formula` (cálculo sin escribir), `_ajustar_pedido`.

**Pantallas** (misma interfaz): `plantista-view.tsx` `handleDispatch`, `add-dispatch-dialog.tsx` `handleSubmit` (normal, por árido e ingreso manual) y `dispatch-history.tsx` (borrar, editar, fibra, superfluidificante) llaman a las funciones; se quitaron del front los cálculos de consumo, el alta de probetas y el `logActivity` duplicado. Los mensajes de error que ve el usuario son los de la base. Probetas: las crea solo el trigger; "Agregar muestra" del Historial conserva su propio insert porque no crea un despacho (hace `update`, el trigger es `AFTER INSERT`). `lib/activity-log.ts` suma `notifyDeletion` (solo el mail). Revisado local (Despacho diario, diálogo de despacho manual abierto y cerrado sin grabar, Historial): se ven igual, sin errores en consola.

**Pruebas** (`node` + `pg`, migraciones + escenarios dentro de un único `BEGIN … ROLLBACK` contra producción; al final se verificó que la columna `tipo` y los despachos de prueba no existen): **47/47 OK**.
1. Pedido de Canning, 8 m³ con muestra y fibra 0,5: 1 despacho, 8 `dispatch_materials` (7 de fórmula + fibra) con seco/húmedo/humedad, 8 movimientos, stock bajó en todo salvo Agua y Sikament 33S, Arena Fina 5.552 seco → 5.718,6 húmedo (3 %), 0/6 sin humedad, fibra −4 kg, pedido 8/16 abierto, camión en ruta, 3 probetas (7 d el 06/10, 28 d el 27/10), actividad y log de estado. Segundo camión: pedido completo.
2. Remito repetido (también con espacios), pedido completo, más del restante + 0,5 → error y conteos idénticos (nada grabado). Restante + 0,5 exacto pasa.
3. Hudson con H30-620-15 B (CAN): los 7 materiales son de Hudson, stock de Canning intacto, CPC 40 de Hudson −2.560 kg, Arena Fina con la humedad de Hudson (0 %). Material sin equivalente → frena con el mensaje.
4. Paridad con 5 despachos reales (26/09 CAN R 0818 y 0816 pedido; 25/09 HUD R 753 HUDSON con fórmula CAN; 25/09 HUD R 3199 H30-GUN; 08/08 CAN manual): mismos kg en todos los materiales. Únicas diferencias, las acordadas: Agua y Sikament 33S se registran pero no descuentan; en el cruzado los materiales pasan a ser de Hudson y la Arena Fina baja de 5.003,7 a 4.858,0 kg (humedad de Hudson 0 % en vez del 3 % de Canning).
5. Anular el 2.º camión: stock exacto al anterior, pedido vuelve a 8 m³ y se reabre, 7 ajustes. Con una probeta con rotura → error, nada cambia.
6. Editar solo el remito: stock y movimientos sin cambios; a un remito ya usado → error. 8 → 6 m³: devuelve 2/8 de cada material que descuenta, pedido 8 → 6, la Arena Fina conserva el 3 %. Cambio de fórmula (CAN → HUD): stock corregido por la diferencia por material. Fibra 3 → 3,6 kg (−0,6) y superfluidificante 5 L.
7. Manual con fecha 28/09: movimientos del 28/09 y probetas desde el 28/09. Por árido: sin cliente ni remito, descuenta la fórmula; sin observaciones → error. Ingreso manual en Hudson eligiendo materiales de Canning: sin despacho, CPC 40 de **Hudson** −100 kg, Agua sin cambio.

**Informe de despachos cruzados (solo lectura, propuesta; no se aplicó ninguna corrección).** Desde el 25/06: **34 despachos desde Hudson con fórmulas de Canning, 250 m³** (25/06–25/09, todos de pedidos; 6 fórmulas "(CAN)": H30-620-15 B 10, H30-620-10 C 10, H25-620-15 B 9, H21-620-15 B 3, H21-620-10 C 1, H21-612-10 C 1). Ninguno al revés. Kg descontados de Canning que eran de Hudson en todo el período: Arena Fina 182.005 (con el 3 % de Canning), Arena 0/6 59.136, CPC 40 74.520, Piedra 6/20 236.530, Piedra 6/12 3.880, Sikament 90E 633 (más Agua 41.900 y Sikament 33S 224, que no cuentan). Pero el recuento del 21/09 a las 23 h (todas las arenas, piedras y CPC 40 de ambas plantas) ya absorbió lo anterior. **Lo que todavía afecta el stock son 14 despachos (110 m³, 22–25/09)**:

| Material | Sumar a Canning / restar a Hudson |
|---|---|
| Arena Fina | 79.202 kg (húmedo con 3 %) — o 76.895 kg seco, que es lo que habría descontado Hudson con su humedad 0 % |
| Arena Trituración 0/6 | 25.605 kg |
| CPC 40 | 34.375 kg |
| Piedra Partida 6/20 | 104.950 kg |
| Sikament 90E | 309 kg (16 despachos desde el recuento de Canning del 28/08; el de Hudson nunca se contó) |

Propuesta: dos ajustes por material (+ en Canning, − en Hudson). **Aplicada por el coordinador el 30/09** (movimientos 'transferencia' / `reference_type='correccion'`, fecha 30/09; Sikament 90E +309,2 Canning / −633,5 Hudson porque Hudson nunca contó el 90E).

**Deploy (en este orden, fuera del horario de despacho, con Bautista avisado):**
1. Aplicar en la base de producción `202609291800_materiales_tipo.sql` y después `202609291810_motor_despacho.sql` (SQL editor de Supabase o `psql`, en ese orden). Verificar: `select name, tipo, descuenta_stock, corrige_humedad from materials order by name;` (solo Arena Fina con `corrige_humedad`) y que existan las 4 funciones. El front actual sigue funcionando igual con la migración aplicada (solo agrega columnas con default, un trigger de alta y funciones; probado un alta de material "a la vieja").
2. Recién entonces mergear `loop/fase-0b-motor-despacho` a `main` (Vercel publica). **Al revés no**: el front nuevo sin las funciones no puede despachar.
3. Probar un despacho real y mirar Historial/Actividad. Para volver atrás alcanza con revertir el front (las funciones pueden quedar).

**Para decidir / avisar a Bautista:**
- Cambios de comportamiento (pocos y a propósito): borrar un despacho ahora **devuelve stock y m³ del pedido** y no deja borrar si ya hay roturas; al editar solo se manda la fecha si se cambió el día (antes cada edición movía la hora a las 12:00); un pedido completo o cancelado ya no acepta despachos; si falta el material Fibra en la planta el despacho se frena (antes se guardaba sin fibra con aviso; hoy ambas plantas la tienen); en el ingreso manual por árido el material se toma siempre de la planta elegida y Agua/Sikament 33S no mueven stock; las probetas de despachos cargados después de las 21 h quedan con la fecha correcta (antes, un día después por UTC).
- Sin cambios (igual que hoy, a revisar más adelante): `dry_stock` no se toca al despachar; Agua y Sikament 33S siguen generando movimiento 'consumo' sin mover stock; una muestra con número "NO" o "PRUEBA" crea probetas (lo hacía el trigger; 8 históricas); 7 fórmulas sin materiales (p. ej. "H25-620-15 B PELQUE", usada el 19/09) despachan sin descontar nada; 26 despachos viejos con muestra y sin probetas.
- No se tocó `README.md` (tiene un cambio pendiente del arquitecto): falta la línea del registro de avance de la 0b.

#### 0b — revisión "aprobado con cambios" (30/09/2026, obrero)
Misma rama. Las migraciones se corrigieron en el lugar (siguen sin aplicar). Commit `e07bbcf`.
1. **Ancla de stock** (decisión del arquitecto por Bautista). Al anular, editar o ajustar fibra/superfluidificante, un material con un **recuento físico** (`reference_type='recuento'`) cargado después del despacho (`created_at`) **no mueve `current_stock`**: el recuento ya refleja lo físico. Queda la traza: movimiento 'consumo' con cantidad **0** y la nota "… no se devuelve stock: recuento posterior al despacho (09/09/2026); 1514.1 kg sin mover". Pedido, probetas y `dispatch_materials` se corrigen igual. Actividad y la respuesta dicen cuántos materiales quedaron sin mover. **Corrección del arquitecto (30/09):** la corrección entre plantas del 30/09 (`'correccion'`/`'transferencia'`) es un delta que solo arregló los 14 despachos cruzados, no una foto del stock: **no ancla**. Un despacho cargado después del recuento del 21/09 devuelve todo su stock.
2. **Orden de bloqueos**: despacho → pedido (`FOR UPDATE` apenas se lee el despacho en anular/editar) → materiales; todo `UPDATE materials` pasa por `_mover_stock`, que recorre en orden de id (fibra incluida). En la migración hay un solo `UPDATE materials`.
3. **Editar recalcula todas las filas** salvo el superfluidificante de obra: con la misma fórmula escala fórmula + fibra y **quita** las filas de materiales que ya no están en la fórmula (devolviendo su stock, con la regla 1). Con otra fórmula o planta, quita todo y recalcula.
4. `search_path = public, pg_temp` en todas las funciones. `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` en las auxiliares (`_material_en_planta`, `_consumo_formula`, `_ajustar_pedido` y las nuevas `_sumar_kg`, `_mover_stock`, `_ancla_stock`, `_aplicar_neto`). Las 4 públicas siguen para anon. `clasificar_material` queda ejecutable porque la usa el trigger de alta, que corre como el usuario de la pantalla.
5. **Clasificación**: el trigger también corre `BEFORE UPDATE OF name`. Si el nombre cambió, reclasifica los campos que ese UPDATE no cambió a propósito (tipo, `descuenta_stock`, `corrige_humedad`). `corrige_humedad` = nombre que empieza con "Arena Fina" (también "Arena Fina Lavada"); la 0/6 y otras arenas quedan afuera.
6. **Anulación como 'consumo' negativo** (`reference_type='dispatch'`, "Anulación remito X"), no 'ajuste' positivo: los promedios de consumo de 30 días quedan bien. Para los materiales anclados se eligió **cantidad 0 con nota** y no el consumo negativo: el recuento posterior ya compensó ese consumo en el libro. Un −q sin mover el stock dejaría mal el gráfico de evolución, que reconstruye hacia atrás desde el stock actual. Agua y Sikament 33S (sin ancla) sí llevan el consumo negativo, espejo del positivo que dejó el alta.

**Pruebas: 62/62 OK** (última corrida, con el ancla solo en recuentos), en `BEGIN … ROLLBACK` y con las migraciones aplicadas dos veces (se pueden volver a correr); al final se confirmó que la base no cambió. Siguen pasando las 47 anteriores; la anulación ahora da 7 consumos negativos y ningún 'ajuste'. Nuevas:
- **R1.** Richard La Huella (Canning, cargado el 10/08, 2 m³): editar 2 → 3 m³ y anularlo no mueven ningún stock. Quedan 5 movimientos en 0 con la nota (anclas: recuentos del 09/09 y del 28/08 para el 90E). Agua y Sikament 33S llevan consumo negativo. Un despacho nuevo anulado devuelve todo menos CPC 40, que tiene un recuento de prueba cargado después.
- **R1b.** Despacho real R 0818 (Canning, 28/09, 9 m³, pedido), anulado: devuelve Arena Fina +6.433,4, 0/6 +2.079, CPC 40 +2.880, 6/20 +8.550 y 90E +24,5. Agua y Sikament 33S quedan en 0 y el pedido baja 9 → 0 m³. El caso del 10/08 sigue sin mover stock.
- **R2.** Hay un solo `UPDATE materials`, en el helper ordenado.
- **R3.** 3 → 4 m³ con una fila vieja de Piedra 6/12 (100 kg): la fila se quita y vuelven los 100 kg. El superfluidificante (5 L) queda intacto y la fibra pasa de 3 a 4 kg.
- **R4.** Como anon, `registrar_despacho` funciona y `_consumo_formula` da "permission denied". Todas las funciones tienen `search_path=public, pg_temp`.
- **R5.** Renombrar a "Arena Fina Lavada" corrige humedad; a "Arena Trituración 0/12" no. Si el mismo UPDATE cambia el tipo a propósito, se respeta. Un UPDATE que no cambia el nombre no reclasifica.

Build limpio. El front no cambió en esta revisión: las respuestas nuevas (`sin_devolver_por_recuento`) no se muestran en pantalla, quedan en Actividad.

**Riesgo a decidir (sin cambiar código):** si se anula o edita uno de los **14 despachos cruzados del 22 al 25/09** (Hudson con fórmula de Canning, p. ej. R 753 HUDSON), el motor devuelve el stock a los materiales de **Canning**, porque sus `dispatch_materials` apuntan a Canning. Pero la corrección del 30/09 ya le devolvió esos kg a Canning y se los descontó a Hudson, así que Canning quedaría con esos kg sumados dos veces y Hudson con los suyos de menos. Mientras no se decida otra cosa, anular uno de esos 14 pide un ajuste manual: restar en Canning y sumar en Hudson. Otra opción es reapuntar sus `dispatch_materials` a Hudson.
