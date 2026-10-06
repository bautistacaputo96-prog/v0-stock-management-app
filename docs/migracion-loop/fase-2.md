# Fase 2 — Programación que genera los viajes

Estado: **en desarrollo (01/10/2026)**. Bautista vio la maqueta y eligió publicarla en "modo prueba por usuario" (ver `entorno-prueba.md`).

Condición de Bautista (01/10): "No quiero que publiques algo demasiado complejo directamente y mañana no sepan usarlo". Por eso esta fase:
1. se publica **apagada**: solo la ven los usuarios con `app_users.ve_funciones_nuevas = true` (al principio Bautista y quienes programan), con el distintivo "Nuevo · en prueba". Para el resto todo queda exactamente como hoy (ver `entorno-prueba.md`);
2. cambia sobre todo **Programación**, que usan Titan, Felipe, Juan, Fernando y Bautista. **Despacho diario casi no cambia** para el plantista: solo ve qué viaje le toca, y el cambio grande de su pantalla es la Fase 3;
3. todo lo nuevo es **opcional al principio**: si un pedido no tiene viajes, todo funciona como hoy.

Leer antes: `README.md`, `fase-1.md` (tiempos por planta en `plants.t_*`, choferes, bomba), `lib/planificador.ts` (motor que ya existe), `components/programacion-dia.tsx` (vista Día).

## Objetivo

Que cada pedido quede partido en **viajes** guardados, como los "tickets" de Loop. Cada viaje tiene m³, hora de carga, salida, llegada, fin de descarga y vuelta, y un camión sugerido. Esos viajes se pueden ajustar a mano con un **gerenciador** tipo Gantt, se confirman **el día anterior**, y Despacho diario muestra qué viaje sigue.

## 0. Interruptor de funciones nuevas

- `app_users.ve_funciones_nuevas boolean default false`.
- Al iniciar sesión se lee y se guarda junto al usuario actual (`lib/current-user.ts`, un helper `veFuncionesNuevas()`).
- En **Actividad** (solo supervisor) va la sección "Funciones nuevas en prueba": la lista de usuarios con un interruptor, registrada en Actividad.
- Todo lo de esta fase se muestra solo con el interruptor prendido. Eso incluye viajes, gerenciador, sugerencia de horario, gráfico de demanda, confirmación y el aviso de próximo viaje en Despacho diario.
- **La generación de viajes en la base también es opcional:** solo se generan cuando un usuario con el interruptor guarda el pedido o el plan del día. Para los demás, el pedido se guarda como hoy. Si un pedido tiene viajes y alguien sin el interruptor lo edita, sus viajes pendientes se regeneran igual, para que no queden desfasados.

## 1. Datos

**Tabla `viajes`:**

| Columna | Qué guarda |
|---|---|
| `id` | |
| `pedido_id` | FK a `scheduled_dispatches`, `on delete cascade` |
| `plant_id` | |
| `n` | Orden del viaje: 1..N |
| `m3` | m³ del viaje |
| `hora_carga`, `hora_salida`, `hora_llegada`, `hora_fin_descarga`, `hora_vuelta` | Horarios planificados (timestamptz) |
| `mixer_id` | Camión sugerido (puede ser nulo) |
| `estado` | `planificado` / `despachado` / `cancelado` |
| `dispatch_id` | FK a `dispatches`; se completa al despachar |
| `actualizado_por`, `updated_at` | Quién y cuándo |

Índice único `(pedido_id, n)`.

**Columnas nuevas en `scheduled_dispatches`:**
- `confirmado_at` y `confirmado_por`: el 👍 del día anterior.
- `espaciado_min`: minutos entre camiones si el cliente pide otro ritmo. Si queda vacío se usa la descarga de la planta según bomba o directo.
- `m3_por_viaje`: por defecto 8. Para obras que piden menos por camión.

Los viajes **no tocan stock**: el stock lo sigue moviendo solo el despacho (motor de la 0b).

## 2. Cómo se generan los viajes

- **Al guardar un pedido** (Semana o edición) se generan sus viajes con el motor actual:
  - m³ por viaje = `m3_por_viaje`, el último con el resto;
  - el primero llega a la hora pedida;
  - los siguientes, separados por el espaciado;
  - la carga empieza ida + carga antes de la llegada.
- **Si el pedido ya tiene viajes despachados**, no se tocan. Solo se regeneran los `planificado`.
- **"Ordenar el día" en la vista Día** aplica `planificar()` a todos los pedidos del día:
  - respeta las bocas de carga;
  - asigna el camión sugerido;
  - corre las horas de carga si chocan.
  - Muestra el resultado y pide **"Guardar plan del día"**: no se guarda solo.

## 3. Gerenciador de viajes (por pedido)

Se abre desde la tarjeta del pedido en Semana, en la vista Día y en Despacho diario. Es como el "Gerenciador de Tickets" de Loop.

- **Encabezado:** cliente, obra, fórmula, finalidad, bomba, y "entregado / total m³".
- **Gantt:** una fila por viaje con 4 colores:
  - carga: gris;
  - ida: celeste;
  - descarga: amarillo, con los m³ escritos;
  - vuelta: verde.

  Los viajes despachados se ven sólidos y no se pueden mover.
- **Acciones:**
  - **Correr ±5 min** todos los viajes pendientes.
  - **Ajustar a la hora actual**: el próximo viaje pendiente carga ahora y los demás se corren. Es para cuando la obra se atrasa.
  - **Agregar viaje faltante / quitar sobrante**: si se cambió el total del pedido.
  - **m³ editables** por viaje.
  - **Camión sugerido** por viaje.
  - **Guardar**: registra en Actividad quién movió qué.

## 4. Sugerencia de horario sin choque

En el formulario del pedido, debajo de la hora de llegada:
- **"Empieza a cargar a las 06:20"**, calculado.
- Si se pisa con la carga de otro pedido de la misma planta, aparece en rojo: **"Choca con [obra] en la boca de carga"**, con dos botones de horario sugerido, uno antes y otro después (como Loop).

## 5. Gráfico de demanda (vista Día)

Barras por media hora de 06:00 a 19:00: **camiones necesarios** contra una línea de **camiones disponibles**. Las horas donde faltan camiones se ven en rojo, para decidir el día anterior si se corre un pedido o se consigue un camión.

## 6. Confirmación del día anterior

- En la vista Día, cada pedido tiene un botón **👍 Confirmar**, que guarda quién y cuándo.
- Arriba se ve "3 de 5 pedidos confirmados". El plantista ve en Despacho diario si un pedido está confirmado.
- **No bloquea nada**: es una marca de control.

## 7. Despacho diario (cambio mínimo)

- La tarjeta del pedido muestra **"Próximo: viaje 3/5 · cargar 09:40 · AF431GU"** y avisa en rojo si ya pasó la hora de carga (como el borde rojo de Loop).
- Al despachar, `registrar_despacho` marca como `despachado` el primer viaje pendiente del pedido (o el que se elija) y guarda `dispatch_id`. `anular_despacho` lo vuelve a `planificado`.
- Si el pedido no tiene viajes, todo sigue exactamente como hoy.
- **"No se pierde nada"**: la misma condición de la Fase 1, para todos los campos del despacho.

## Fuera de alcance (va en la Fase 3 o después)

- La pantalla de 3 columnas con arrastrar y soltar.
- Estados del camión en vivo y tiempos reales por GPS (Fase 4).
- Programación de las bombas como Gantt propio.
- Duplicar pedidos y pedidos recurrentes.

## Criterios de aceptación

1. Crear un pedido de 35 m³ con bomba genera 5 viajes (8+8+8+8+3), separados por el tiempo de descarga con bomba de la planta. Editar la hora corre todos los pendientes.
2. "Ordenar el día" con 2 pedidos que chocan en la boca de carga los separa. "Guardar plan del día" deja los viajes y los camiones sugeridos.
3. El gerenciador mueve, ajusta a la hora actual, agrega y quita viajes, y no deja mover los despachados.
4. Despachar marca el viaje y anular lo libera. Un pedido sin viajes se despacha igual que hoy. "No se pierde nada" se verifica como en la Fase 1.
5. Con el interruptor apagado, ninguna pantalla cambia (capturas antes y después de Semana, Día, Despacho diario e Historial). Con el interruptor prendido aparece todo lo nuevo con el distintivo "Nuevo · en prueba".

## 2b — Ajustes pedidos por Bautista al probar el preview (05/10/2026)

Todo con el interruptor, salvo el punto B, que es un error que afecta a todos.

**A. Obra ubicada y tiempo de viaje real**
- Al elegir la obra en el pedido (y en el alta rápida), si **no está ubicada**, aparece en el formulario "Esta obra no está ubicada: buscala en el mapa", con el componente `obra-ubicacion.tsx`: dirección, link de Google Maps o pin. Se guarda en `construction_sites`.
- Si **está ubicada**, se calcula y se muestra "Viaje estimado desde [planta del pedido]: X km · Y min", con `/api/geo/ruta` (OSRM ×1,3).
- El tiempo depende de la planta. Por eso se guarda en el pedido: columna nueva `scheduled_dispatches.viaje_min`, editable a mano. El motor usa `viaje_min` del pedido, si no el de la obra, si no el de referencia.
- Hoy hay 0 de 130 obras ubicadas y 107 con el valor por defecto de 30 min.

**B. Camión del pedido (error, para todos)**
- La lista "Camión (opcional)" muestra solo los mixers `available`. Los que quedaron `in_transit` desaprecen; hoy son 2 de 5, porque nadie toca "Entregado".
- Mostrar **todos los activos**. Los que figuran en ruta van con la marca "(en ruta)" pero se pueden elegir: es para un pedido futuro.

**C. Semana: los viajes en la grilla**
- Con el interruptor, la grilla de Semana muestra **cada viaje** en su franja horaria (hora de llegada a obra): obra abreviada, n/N, m³ y camión. Ya no un solo bloque por pedido.
- Así se ven juntos los viajes de distintas obras en la misma franja. Tocar un viaje abre el pedido o su gerenciador.

**D. No asignar un camión ocupado**
- En la vista Día y en el gerenciador, un camión no se puede asignar a un viaje si en ese momento está haciendo otro viaje. Choca si su viaje anterior vuelve a planta después de la carga de este, en este pedido o en otro.
- Se marca en rojo ("AF431GU todavía vuelve de Obra X a las 09:40") y se sugieren camiones libres.

**E. Dimensionar la flota con pocos camiones bien usados**
- Por pedido, mostrar el cálculo: **"Ciclo: carga 10 + ida 25 + descarga 15 + lavado 10 + vuelta 25 = 85 min · un camión cada 15 min → para no cortar el hormigonado hacen falta 6 camiones"**.
- Si hay menos camiones: "Con 4 camiones el vaciado termina 09:50 en vez de 09:15, con N huecos de X min".
- **Asignación que ahorra camiones:** para cada viaje se elige primero un camión **ya usado en el día** que llegue a tiempo. Solo si ninguno llega se suma uno nuevo. Así sube la utilización y pueden sobrar camiones libres, que se muestran como "libre" y se pueden dejar fuera.
- Mostrar "Camiones usados: 3 de 5 · uso promedio 72 %".
- **El tiempo de descarga es el dato clave.** Por pedido se puede corregir (columna nueva `descarga_min`, por camión de 8 m³). Por defecto sale del método (bomba / canaleta) de la planta, y más adelante del GPS por obra o cliente.

Criterios extra: un pedido de 40 m³ (8 por viaje) a una obra ubicada se reparte en 5 viajes con el viaje real. La asignación nunca pone un camión en dos viajes que se pisan. Con 5 camiones disponibles, usa los mínimos necesarios. La grilla Semana muestra los 5 viajes en sus horarios.

## Hecho
_(lo completa la sesión obrero)_

### 01/10/2026 (obrero)
Rama local `loop/fase-2-viajes` (worktree `~/Documents/rebucret-fase2`, sin push ni merge). Commits: `911f26c` migración, `b9ff9b8` motor + interruptor, `b591c61` gerenciador + Semana, `411e7cf` vista Día, `7ad43a7` Despacho diario, `216126c` Actividad, `78ec182` tipos, `dcf683b` y `190dbc2` arreglos chicos, más este registro.

**Migración (NO aplicada a producción):** `supabase/migrations/202610021000_fase2_viajes.sql`. Se puede correr dos veces y es compatible con el front de `main`.
- `app_users.ve_funciones_nuevas` (boolean NOT NULL default false: todos arrancan apagados).
- `scheduled_dispatches`: `confirmado_at`, `confirmado_por`, `espaciado_min` (CHECK > 0, nulo = la descarga de la planta), `m3_por_viaje` (NOT NULL default 8, CHECK > 0).
- Tabla `viajes` como dice la especificación (+ `created_at`), FK al pedido `on delete cascade`, `mixer_id` `on delete set null`, `dispatch_id` `on delete set null` (por seguridad; `anular_despacho` lo libera antes), CHECK de estado, índice único `(pedido_id, n)` e índices por despacho, planta/hora y camión. `GRANT ALL` a anon/authenticated como el resto.
- `guardar_viajes_pedido(pedido_id, viajes jsonb, usuario)`: bloquea el pedido (mismo orden que el despacho), borra los `planificado` y graba los nuevos; valida número, m³ > 0, horarios en orden y que el número no choque con un despachado. Todo o nada.
- `registrar_despacho` y `anular_despacho`: se partió de `pg_get_functiondef` de producción (= fase 1). Diff: `viaje_id` opcional en el jsonb (tiene que ser un viaje pendiente del pedido; si no viene, se marca el primer pendiente por `n`), el viaje queda `despachado` con `dispatch_id`; la respuesta suma `viaje_id`/`viaje_n` y Actividad "Viaje: 3/5" **solo si se marcó un viaje**. Anular lo vuelve a `planificado` (mismas horas) y Actividad suma "Viaje liberado". `editar_despacho` no cambia. Mismos atributos (SECURITY DEFINER, search_path, hora de Argentina, permisos).

**Motor en un solo lugar:** `lib/viajes.ts` (sobre `lib/planificador.ts`, que ahora acepta `m3PorViaje` y `espaciadoMin` opcionales; sin ellos da exactamente lo mismo que antes: 1.000 días al azar comparados contra el de `main`). Lo usan el formulario de Semana, la vista Día, el gerenciador y las ediciones. Para un pedido: m³ restantes partidos por `m3_por_viaje`, el primero a la hora pedida (más el espaciado de los ya despachados), los siguientes separados por `espaciado_min` o la descarga de la planta (bomba/directo), carga = llegada − ida − carga, respeta las bocas; los despachados no se tocan y los pendientes conservan su camión sugerido. "Ordenar el día" = `planificar()` con todos los pedidos y los camiones disponibles.

**Pantallas** (todo solo con el interruptor, con el distintivo "Nuevo · en prueba"; `useFuncionesNuevas()` en `lib/current-user.ts`, que el login lee de `app_users` y refresca al abrir el sistema):
- **Semana:** en el formulario, "Empieza a cargar a las 06:20 · 5 viajes" debajo de la hora; si choca en la boca de carga con otro pedido de la misma planta, en rojo "Choca con [obra] en la boca de carga" y dos botones de llegada sugerida (antes/después, de a 5 min). Recuadro "Viajes" con m³ por camión y minutos entre camiones. Al guardar (crear o editar) se arman los viajes; si fallan, el pedido queda y se avisa. Tarjeta: "5 viajes · 👍"; menú ⋯ › Viajes abre el gerenciador.
- **Gerenciador** (`components/gerenciador-viajes.tsx`): encabezado (cliente, obra, fórmula, finalidad, bomba, llegada, entregado/total), Gantt carga gris / ida celeste / descarga ámbar con m³ / vuelta verde; despachados sólidos con ✓ y sin controles; pendientes claros con m³ editable, camión sugerido y quitar. −5/+5 min, Ajustar a la hora actual, Agregar viaje (faltante), aviso de m³ que faltan/sobran. Si el pedido no tiene viajes muestra la propuesta sin guardar. Guardar → `guardar_viajes_pedido` + Actividad con lo que cambió (por viaje).
- **Vista Día:** barra "Ordenar el día" (muestra el plan propuesto por pedido con camión; "Guardar plan del día" lo graba; deshabilitado si hay horas sin guardar) y "3 de 5 pedidos confirmados"; por pedido "Armar viajes / Viajes (5)" y "👍 Confirmar" (o "Confirmado · quién · cuándo", tocando se quita; queda en Actividad). Gráfico de demanda por media hora 06–19 con la línea de camiones disponibles y en rojo donde faltan.
- **Despacho diario:** en la tarjeta "Próximo: viaje 3/5 · cargar 09:40 · AF431GU" (rojo si ya pasó la hora de carga) y "👍 Confirmado"; en Despachar camión, selector "Viaje" (por defecto el próximo, con sus m³ y camión sugeridos); ⋯ › Viajes. Nada más cambia en el diálogo.
- **Actividad** (supervisor): "Funciones nuevas en prueba", lista de usuarios con interruptor; cada cambio queda en Actividad (tipo nuevo "Usuarios" en el filtro). Esta sección se ve siempre (es la llave), avisa si falta la migración.
- **Sin el interruptor ninguna pantalla cambia.** Lo único que corre igual para todos: si un pedido **ya tiene** viajes, editarlo en Semana, cambiar la hora o el método en la vista Día o "Editar total" en Despacho diario regenera sus pendientes; y la base marca el viaje al despachar.

**Pruebas:**
- Motor (`/private/tmp/claude-501/-Users-bautistacaputo-Documents-v0-plant-production-control/aec4cd85-59dc-45a8-9077-b068ee49c837/scratchpad/fase2/motor/test.mts`): **27/27 OK** (35 m³ bomba → 8+8+8+8+3 a 08:00/15/30/45/09:00, directo cada 25, m³ por camión y espaciado, editar la hora corre solo pendientes, despachados intactos, choque y horarios sugeridos, ordenar el día, gerenciador, demanda).
- Base (`/private/tmp/claude-501/-Users-bautistacaputo-Documents-v0-plant-production-control/aec4cd85-59dc-45a8-9077-b068ee49c837/scratchpad/fase2/test.js`, un único `BEGIN … ROLLBACK` contra producción, migración aplicada dos veces): **137/137 OK**. "No se pierde nada" (8): los 4 despachos de la fase 1 (desde pedido con agua extra/fibra/muestra, manual con humedad, por árido con fórmula y con materias primas) **más la anulación**, con las funciones de producción y con las nuevas, pedido sin viajes: todas las columnas, respuesta, Actividad, probetas, movimientos y stock **idénticos**; pedido con viajes: idéntico salvo `viaje_id`/`viaje_n` y "Viaje 1/3"/"Viaje liberado 1". 0b (62) y fase 1 (26) siguen OK (R2 ahora excluye la foto del esquema de la 0d). Viajes (41): generación y horarios con los tiempos de Canning, no toca stock, editar la hora, despachar sin elegir / eligiendo, errores sin grabar nada (viaje ya despachado, de otro pedido, en despacho manual, número de un despachado, horarios desordenados, m³ 0, camión o pedido inexistente), despachados intactos al regenerar, gerenciador, anular libera y devuelve stock, pedido sin viajes igual que hoy, ordenar el día separa dos pedidos que chocaban, confirmación, CHECKs, cascade, interruptor apagado para todos, permisos anon, atributos de funciones y `editar_despacho` sin cambios. Al final se verificó que en producción no existe nada de la fase 2 ni datos de prueba.
- Build `next build --webpack` limpio; `tsc`: 54 líneas, igual que `main` (en los archivos tocados solo queda el error viejo de `plantista-view` Mixer[]). `types/database.ts` regenerado con la migración aplicada dentro de una transacción (incluye también lo de la fase 1, que faltaba).

**Capturas** (local, sin grabar nada) en `/private/tmp/claude-501/-Users-bautistacaputo-Documents-v0-plant-production-control/aec4cd85-59dc-45a8-9077-b068ee49c837/scratchpad/fase2/capturas/`: `antes-01-semana`, `antes-02-pedido`, `antes-03-dia`; con el interruptor apagado `despues-apagado-01-semana` y `-02-pedido` (iguales a las de antes); prendido (marca inyectada solo en el navegador, migración sin aplicar) `prendido-01-pedido-choque-boca` (carga 07:20 · 5 viajes, "Choca con Magallanes 276", llegadas sugeridas 07:50/08:10) y `prendido-02-dia-demanda-confirmar`. **Faltan** (el navegador dejó de tomar los clics): gerenciador, plan del día propuesto, Despacho diario con "Próximo viaje", Actividad y Historial (Historial no se tocó). Conviene verlas en el preview después de aplicar la migración.

**Deploy (en este orden, fuera del horario de despacho):**
1. Aplicar `202610021000_fase2_viajes.sql` en producción. Verificar: existe `viajes`; `select name, ve_funciones_nuevas from app_users` da todo false; un despacho desde el front actual sigue andando (sin viajes, la función hace lo mismo que antes).
2. Abrir el preview de Vercel de la rama (usa la base de producción): Actividad › Funciones nuevas en prueba › prender a Bautista; volver a abrir el sistema y probar Semana, Día, gerenciador y Despacho diario con un pedido de prueba (los viajes no tocan stock; **no despachar** de prueba).
3. Con el OK de Bautista, merge a `main`. Después prender a quienes programan (Titan, Felipe, Juan, Fernando).

**Pendiente / a decidir:**
- ~~Viajes de pedidos cancelados o finalizados~~ y ~~m³ planificados en el viaje despachado~~: resueltos en la revisión (abajo).
- "Ordenar el día" usa las horas guardadas (pide guardar antes las cambiadas). Los camiones disponibles del día siguen en el navegador (la fase 1 decía que se guardaban en la 2; esta especificación no lo pide).
- Un usuario con la sesión abierta ve el cambio del interruptor al recargar la página.
- No se tocó `README.md` (registro de avance).

### Revisión (02/10/2026)
APROBADO CON CAMBIOS (interruptor apagado y "No se pierde nada": OK). Arreglos del obrero en la misma rama: `aa87467` (base), `963e084` (pantallas), `f650a21` (tipos) y este registro. La migración sigue sin aplicar.
- **M1 · m³ reales.** `registrar_despacho` graba en el viaje los m³ reales del camión y guarda los planificados en la columna nueva `viajes.m3_planificado`; `anular_despacho` se los devuelve; `editar_despacho` (definición de producción + 3 líneas) copia los m³ nuevos al viaje. Se eligió la columna porque así el viaje dice siempre lo que salió y anular deja el plan como estaba, sin recalcular nada en la base. El motor usa `m3Entregados()` (m³ reales de los viajes despachados, o lo despachado del pedido si es más: despachos de antes de tener viajes) en la generación, los faltantes y el gerenciador. Si el camión sale con otros m³, Despacho diario rearma los pendientes (24 m³, sale con 6 → 8+8+2; el gerenciador muestra 6/24). El viaje se marca **antes** de completar el pedido.
- **M2 · no pisar ajustes en silencio.** Solo se rearman los pendientes si cambió hora de llegada, cantidad, método de descarga, obra, m³ por camión o espaciado (`cambiosQueRearman`); observaciones, fibra, bomba, finalidad, etc. no los tocan. Cada rearmado queda en Actividad ("Viajes: recalculados por cambio de hora de llegada", "Viajes pendientes 3 → 3"). Si pisa un plan del día o ajustes del gerenciador (columna nueva `viajes.origen`: automatico / plan_dia / gerenciador) lo hace igual, pero suma "Aviso: se reemplazaron horarios o camiones ajustados a mano". Con el interruptor sale el aviso "Se recalcularon los viajes de este pedido".
- **M3 · ids estables.** `guardar_viajes_pedido` actualiza por `n` los planificados que ya estaban (mismo id), agrega los nuevos y borra los sobrantes; rechaza números repetidos y un origen desconocido. En Despacho diario el viaje se elige por número y se vuelve a buscar en la base al confirmar; si ya no está pendiente sale el primer pendiente con el aviso "El viaje N ya no está pendiente · se despacha como viaje M".
- **L1 · pedidos cerrados.** Trigger `trg_viajes_pedido_cerrado` en `scheduled_dispatches` (vale para todas las pantallas: Cancelar en Semana y Despacho diario, Finalizar y el despacho que completa el pedido): los pendientes pasan a `cancelado`. Si el pedido se reabre (anular el despacho que lo completó), los que se habían cancelado por completarse vuelven. `guardar_viajes_pedido` rechaza pedidos cancelados o completos. Semana no cuenta "N viajes" ni choques en la boca de carga de pedidos cancelados o completos.
- **L2.** Índice único parcial `viajes(dispatch_id) where dispatch_id is not null` (reemplaza el índice común).
- **L4.** En el gerenciador los m³ se pueden borrar y volver a escribir; vacío o 0 muestra "Poné los m³" en rojo y no deja guardar.

**Pruebas de la revisión:** motor `/private/tmp/claude-501/-Users-bautistacaputo-Documents-v0-plant-production-control/aec4cd85-59dc-45a8-9077-b068ee49c837/scratchpad/fase2/motor/test.mts` **36/36 OK** (+9: 24 m³ con primer camión de 6 → 8+8+2 y 6/24; qué cambios rearman). Base `/private/tmp/claude-501/-Users-bautistacaputo-Documents-v0-plant-production-control/aec4cd85-59dc-45a8-9077-b068ee49c837/scratchpad/fase2/test.js` **158/158 OK** en un único `BEGIN … ROLLBACK` (las 137 + 21: m³ reales al despachar, rearmado a 8+8+2, ids iguales al rearmar, editar copia los m³, anular devuelve los planificados, guardar por número con sobrante y origen, repetidos y origen inválido → error, el camión que completa marca su viaje y cancela el sobrante, anular reabre y recupera, Finalizar y Cancelar cancelan, guardar en pedido cerrado → error, índice único de `dispatch_id`, pedido sin viajes igual que siempre; `editar_despacho` = producción + el bloque de los m³). Después del ROLLBACK no queda nada en producción. Build limpio, `tsc` 54 líneas (igual que `main`).

**Queda menor:** al anular un despacho cuyo viaje ya se había rearmado, el viaje vuelve con sus m³ planificados y puede sobrar algo hasta el próximo rearmado (el gerenciador lo muestra como "Sobran X m³").

### 2b (05/10/2026, obrero)
Misma rama `loop/fase-2-viajes` (rebasada sobre main). Commits: `ed5cf88` migración, `0b7bd4c` motor, `7510015` Semana + gerenciador, `8638314` vista Día, `28a9004` tipos y este registro. Sin push ni merge.

**Migración nueva (aplicada a producción por el arquitecto el 05/10, con aviso a Bautista):** `supabase/migrations/202610052100_fase2b_viaje_descarga.sql`. Agrega `scheduled_dispatches.viaje_min` y `descarga_min` (enteros, nulos, CHECK > 0). Se puede correr dos veces y es compatible con `main` y con la fase 2. La `202610021000` (ya aplicada) no se tocó.

**Lo que se hizo:**
- **A · Obra ubicada y viaje real** (con el interruptor). En el formulario del pedido:
  - Si la obra no está ubicada aparece "Esta obra no está ubicada: buscala en el mapa" con `obra-ubicacion.tsx` (dirección, link de Google Maps o pin). La ubicación se guarda en `construction_sites` al guardar el pedido, con las mismas columnas que Clientes (`gps_lat/lng`, `gps_source`, `travel_distance_km`, `gps_updated_at`), y queda en Actividad. El alta rápida de obra ya tenía el mapa.
  - Si está ubicada: "Viaje estimado desde [planta del pedido]: X km · Y min", con `/api/geo/ruta`. Se propone en "Minutos de viaje de este pedido" (`viaje_min`); se puede corregir y entonces la ruta ya no lo pisa.
  - Al lado va "Descarga por camión de 8 m³" (`descarga_min`), que por defecto muestra la de la planta.
  - El motor usa el viaje del pedido; si no tiene, el de la obra; si no, 30. Para la descarga usa la del pedido; si no tiene, la de la planta según el método. Cambiarlos rearma los viajes (entra en `cambiosQueRearman`).
- **B · Camión del pedido (para todos).** Se listan todos los mixers activos; los que están `in_transit` llevan la marca "(en ruta)" y se pueden elegir.
- **C · Viajes en la grilla de Semana** (con el interruptor). Los pedidos con viajes se ven viaje por viaje en la franja de su hora de llegada, con obra, hora, n/N, m³ y camión. Despachado va en verde y pendiente en violeta. Tocar un viaje abre el gerenciador, que suma el botón "Editar pedido"; el menú ⋯ del pedido queda en cada viaje. Sin el interruptor la grilla queda igual.
- **D · Camión ocupado.**
  - `choquesDeCamion()` detecta cuando el viaje anterior del mismo camión vuelve a planta después de la carga de este, en el mismo pedido o en otro, de cualquier planta.
  - En el gerenciador, los camiones ocupados figuran "(ocupado)" y no se pueden elegir. Si queda alguno, sale en rojo "AF431GU todavía vuelve de Obra X a las 09:40", con botones de camiones libres, y no deja guardar.
  - En la vista Día sale el mismo aviso por pedido, con los libres.
  - El planificador recibe los viajes de la otra planta y los despachados como ventanas ocupadas y nunca pone un camión en dos viajes que se pisan.
  - Al rearmar, el camión que se conservaba se quita si quedaría pisado.
- **E · Flota.**
  - Por pedido, en la vista Día y en el gerenciador: "Ciclo: carga 10 + ida 25 + descarga 15 + lavado 10 + vuelta 25 = 85 min · un camión cada 15 min → para no cortar el hormigonado hacen falta N camiones", con N = ciclo / ritmo y como máximo uno por viaje.
  - Si con los camiones que hay se corta: "Con 2 camiones el vaciado termina 11:05 en vez de 09:15, con 2 huecos de 55 min".
  - Resumen del día: "Camiones usados: 3 de 5 · uso X %".
  - Asignación que ahorra camiones: primero un camión ya usado en el día que llegue a tiempo (el que se liberó más tarde); uno nuevo solo si ninguno llega. Sin camiones ocupados, el planificador da exactamente lo mismo que antes (1.000 días al azar contra `main`). Era la regla de desempate; ahora está escrita y probada.

**Pruebas:**
- **Motor:** 56/56. Suma 20 de la 2b:
  - 40 m³ / 8 → 5 viajes, con el viaje y la descarga del pedido.
  - Texto de flota: 85 min, cada 15 → 5; con 80 m³ → 6; con espaciado 30 → 3.
  - Dos pedidos chicos con 5 camiones usan 1; 24 m³ directo usa los 3 necesarios y no 5.
  - 300 días al azar sin ningún camión en dos viajes que se pisan, y con un solo pedido nunca más camiones que los necesarios.
  - El camión ocupado en la otra planta se esquiva o se espera.
  - Choques y libres, el texto "con menos camiones", rearmado por viaje o descarga, y el camión del pedido que no se repite.
- **Base:** 169/169 en un único `BEGIN … ROLLBACK`, aplicando solo la 2b, porque producción ya tiene la fase 2.
  - Se ajustaron 4 pruebas viejas al estado real de producción: Canning tiene tiempos editados, el interruptor de Bautista está prendido, `editar_despacho` ya es el de la fase 2, y una fecha de prueba quedó en el pasado.
  - Nuevas (11): columnas y CHECKs; insert como `main`; 40 m³ con viaje 25 min → carga 07:25; descarga 20 → uno cada 20; "Guardar plan del día" con un viaje de Hudson ocupando un camión hasta las 09:30, donde ningún camión queda en dos viajes que se pisan ni se usa ese camión antes; un pedido de 8 m³ con 5 camiones usa 1; texto de flota.
  - Al final no queda nada en producción.
- **Build y tipos:** `next build --webpack` limpio; `tsc` 54 líneas, igual que `main`. Los tipos se regeneraron con la 2b y además traen `alertas_stock`, que ya estaba en producción.

**Deploy:**
1. ~~Aplicar `202610052100_fase2b_viaje_descarga.sql`~~: ya aplicada el 05/10.
2. Bautista prueba el preview: pedido a una obra sin ubicar, ubicarla y ver el viaje desde la planta; viajes en Semana; gerenciador con un camión ocupado; vista Día con el cálculo de flota.
3. Merge.

**Pendiente:** no hay capturas de la 2b (verlo en el preview). En la vista Día, "Ordenar el día" sigue usando las horas guardadas.

#### Revisión de la 2b (05/10/2026)
APROBADO CON CAMBIOS. Arreglado en `1a3e64c`:
- **M1 · un camión nunca en dos viajes a la vez.**
  - `choquesDeCamion` ahora marca **los dos** viajes que se pisan, en los dos sentidos: el otro carga antes ("AF431GU todavía vuelve de X a las 09:40") o después ("AF431GU tiene que cargar para X a las 09:00, antes de volver de este viaje"). Vale para cualquier pedido y cualquier planta, también para los despachados.
  - El gerenciador no deja guardar después de ±5 min, "Ajustar a la hora actual", cambio de m³ o "Agregar viaje".
  - "Agregar viaje" solo propone el camión del último viaje si llega a volver.
  - Al rearmar un pedido (cambio de hora, etc.) se miran los viajes de los otros pedidos del día. Si el camión que se conservaba quedaría pisado, se quita y queda en Actividad ("Camión quitado: …").
  - La vista Día marca el choque en las dos plantas.
- **L1.** Semana: los viajes antes de las 06 o después de las 19 se muestran en la primera o la última franja, con su hora real y "fuera de horario". Un pedido cuyos viajes no caen todos en su mismo día vuelve a la tarjeta de siempre: nunca se ocultan.
- **L2.** Tocar un viaje de un pedido completo o cancelado abre el pedido, igual que el menú ⋯, que no ofrece Viajes. Si el gerenciador se abre igual para un pedido cerrado, es solo de lectura: sin acciones ni Guardar.

**Pruebas:**
- **Motor:** 66/66. Suma 10, uno por camino:
  - +10 min, ajustar a las 08:00 y m³ 8 → 16, todos contra un viaje de otro pedido que carga después.
  - "Agregar viaje" con y sin tiempo para volver.
  - Rearmar con y sin los otros pedidos; un despachado cuenta y un cancelado no.
- **Base:** 171/171 en `BEGIN … ROLLBACK`. Como la 2b ya está en producción, se vuelve a aplicar dos veces para probar que es idempotente. Nueva prueba: un pedido a las 08:00 con el camión que a las 09:00 carga para Hudson se pasa a las 09:30 y se rearma; el camión se quita y no queda ningún choque.
- **Build y tipos:** build limpio; `tsc` 54 líneas, igual que `main`.


### Buscador de obras (05/10/2026, obrero)
Pedido de Bautista: ubicar la obra "como en Google Maps". Commit `09d7351`, misma rama. Es una mejora del control compartido `obra-ubicacion.tsx` (formulario del pedido, Clientes y alta rápida), así que lo ven todos; no depende del interruptor.
- **Buscador libre con sugerencias** mientras se escribe: espera 300 ms, desde 3 letras. Se maneja con flechas, Enter y Esc, y muestra el nombre y el texto secundario. Al elegir una sugerencia pone el pin, centra el mapa y calcula km y minutos con `/api/geo/ruta`. Siguen andando el botón "Ubicar dirección en el mapa" y pegar un link de Google Maps o coordenadas.
- **Proveedor: Google Places API (New), solo desde el servidor:**
  - `/api/geo/autocompletar?q=&planta=&sesion=` llama a `places:autocomplete` en español, solo Argentina, con sesgo de 50 km alrededor de la planta del pedido (o del centro de la zona). Google acepta como máximo 50 km, no 60.
  - `/api/geo/lugar?id=&sesion=` llama a Place Details con la máscara `location,formattedAddress,displayName` (Essentials).
  - El navegador genera un token de sesión por búsqueda y lo pasa a las dos llamadas.
  - La clave está en `GOOGLE_MAPS_API_KEY` (no es NEXT_PUBLIC). No está en el código, ni en los logs, ni en el paquete del navegador (verificado en el build).
  - Si falta la clave o Google falla, se usa sin avisar el buscador de OpenStreetMap, con la misma respuesta. Ese buscador se movió a `lib/geo-osm.ts` y `/api/geo/buscar` responde igual.
  - "Powered by Google" aparece debajo de las sugerencias solo cuando vienen de Google.
- **Mapa / Satélite** en `mapa-base.tsx`: Esri World Imagery, con la atribución "Tiles © Esri". Por defecto sigue el mapa de OSM y el pin se sigue arrastrando. También aparece en el mapa de Logística, que usa el mismo componente.
- **Pruebas** (`/private/tmp/claude-501/-Users-bautistacaputo-Documents-v0-plant-production-control/aec4cd85-59dc-45a8-9077-b068ee49c837/scratchpad/fase2/geo/test.mts`): **20/20**. Cubren los normalizadores de Google y de OSM y el pedido a Google (idioma, región, sesgo, sesión, clave solo en el encabezado). Para el respaldo: sin clave, error 403, excepción, OSM también caído y menos de 3 letras. Para el detalle: id `osm:` sin llamadas, máscara y sesión, e id inválido. Además, prueba local sin clave: `/api/geo/autocompletar` devuelve las sugerencias de OSM y `/api/geo/buscar` responde igual que antes. Build limpio; `tsc` 54 líneas, igual que `main`.
- **Falta (Bautista):**
  - Crear la clave en Google Cloud, con Places API (New) habilitada, facturación activa y la clave restringida a Places API.
  - Cargarla en Vercel como `GOOGLE_MAPS_API_KEY` (Production y Preview).
  - Hasta entonces el buscador anda con OpenStreetMap.
