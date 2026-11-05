# Camiones por planta: reparto del día y cronograma con N camiones

Estado: **propuesta del arquitecto (04/11/2026), pendiente de aprobación de Bautista.** Sin código.
Incluye los criterios que Bautista sumó el mismo día: **los menos camiones posibles**, **los menos traslados
entre plantas** (gastan combustible), **dónde duermen los camiones** y **costo del traslado como parámetro**.

Leer antes: `docs/migracion-loop/README.md` (principios), `fase-2.md` (viajes, planificador, 2b "pocos camiones
bien usados"), `tiempos-gps-programacion.md` (de dónde sale cada tiempo), `fase-3.md` (despacho en tres columnas,
estado del camión). Referencia Loop: `informe-loop.md` §2 ("Trabajando con: N" camiones en el gráfico de
demanda; "Betoneiras da Planta", la lista de camiones de cada planta).

---

## 0. Qué hay hoy (relevado en el código de `main`)

| Pieza | Dónde | Qué hace | Qué le falta para esto |
|---|---|---|---|
| Motor de viajes | `lib/planificador.ts` → `planificar()` | Arma los viajes de una planta con los camiones que se le pasan: carga → ida → descarga → lavado → vuelta, una boca de carga, "pocos camiones bien usados" (primero un camión ya usado que llegue a tiempo), ventanas `ocupados` de otros viajes. | Trabaja con **una planta por vez**. No sabe dónde está cada camión ni cuánto tarda en pasar de una planta a la otra. La boca de carga solo mira los viajes del mismo llamado. |
| Viajes de un pedido | `lib/viajes.ts` → `generarViajes()` | Lo usan el formulario del pedido, el gerenciador y `regenerarViajesPedido`. | Usa **camiones virtuales sin límite**: el cronograma es el ideal, nunca "con 2 camiones". |
| Ordenar el día | `lib/viajes.ts` → `planDelDia()` + vista Día | `planificar()` con todos los pedidos de **una** planta y los camiones "disponibles"; los viajes de la otra planta entran como ocupados. | El viaje de la otra planta ocupa al camión solo de la carga a la vuelta: **no cuenta el traslado** (un camión que vuelve a Hudson 11:05 figura libre en Canning 11:05). |
| Flota por pedido | `explicarFlota()`, `textoConMenosCamiones()` | "Ciclo … = 115 min · un camión cada 30 → hacen falta 4" y "Con 2 camiones el vaciado termina 12:05 en vez de 10:15". | Solo informa; no decide cuántos ni cuáles. |
| Camiones disponibles del día | `components/programacion-dia.tsx`, "Tiempos y camiones" | Botones por camión, **guardados en el navegador** (`localStorage prog-dia-camiones-<planta>`), uno por planta. | No está en la base (pendiente desde la fase 2), no tiene horario y las dos plantas pueden contar el mismo camión a la vez. |
| Gráfico de demanda | vista Día, `demandaPorMediaHora()` | Camiones necesarios por media hora contra una línea fija de disponibles. | La línea es la misma todo el día. |
| "Armar viajes" | vista Día → botón "Armar viajes / Viajes (N)" → `components/gerenciador-viajes.tsx` | Gantt del pedido, ±5 min, m³, camión sugerido por viaje, choques de camión. | No hay "con cuántos camiones": la propuesta es la ideal. |
| Camión del despacho | `scheduled_dispatches.mixer_id`, `viajes.mixer_id` (sugerido), `dispatches.mixer_id` (real); `mixers.status` (`available`/`in_transit`/`maintenance`/`unavailable`); `lib/despacho.ts` `estadoCamion()`, `camionPropuesto()` | El estado sale del GPS (geocerca de planta) o del despacho. | No sabe a qué planta "pertenece" el camión en cada hora. |
| Tiempos | `plants.t_*`, `plants.tiempos_a_mano`, `viajes_gps` (medianas de 90 días, `lib/gps-viajes.ts`), `viaje_min`/`descarga_min` del pedido | Ida, descarga con bomba / directo, espera en planta. Orden de prioridad en `tiempos-gps-programacion.md`. | — |
| Traslado Canning ↔ Hudson | **No existe.** `plants` tiene `gps_lat/gps_lng`; `/api/geo/ruta` calcula km y minutos entre dos puntos (OSRM × 1,3). `viajes_gps` **no guarda** los traslados directos ("salir y volver sin parar no es viaje", `reconstruirViajes`). | — | Hace falta un parámetro. |
| `mixers.plant_id` | null en los 5 | Decisión vigente (`add-mixer-dialog.tsx`): los camiones son compartidos, sin planta, para que aparezcan en las dos. | **No se usa para esto** (ver 2.1). |
| Permisos | `lib/permisos.ts` | `programacion.editar` (ordenar el día, tiempos de la planta), `despacho.cargar` (despachar, taller). | Nada nuevo: se reusan. |

**Conclusión:** casi todo el cálculo ya existe. Falta (1) un orquestador que use `planificar()` con las **dos plantas
a la vez**, sepa dónde está cada camión y cuente los traslados, (2) guardar el reparto del día en la base
(reemplaza los camiones en el navegador) y (3) que el gerenciador arme los viajes con los camiones elegidos.
**No se hace una pantalla nueva:** el reparto vive en la vista Día (Programación) y, en la fase 3, se ve en
Despacho diario.

## 1. Objetivo

Que quien programa vea, para el día, **cuántos y cuáles camiones van a cada planta y desde qué hora**, con los
**menos camiones y los menos traslados entre Canning y Hudson** que cumplen los pedidos, que lo pueda cambiar, y
que al armar los viajes de un pedido el sistema calcule el cronograma con esos camiones y avise cuando no alcanza.

## 2. Alcance y fases

Todo detrás del interruptor `ve_funciones_nuevas` (como las fases 2 y 3). Sin el interruptor no cambia nada.

| Fase | Qué | Tamaño |
|---|---|---|
| **1. Reparto sugerido y editable** | Migración; `lib/reparto.ts`; bloque "Camiones por planta" en la vista Día (sugerencia con el porqué, edición, guardar); traslado como parámetro en "Tiempos y camiones"; "Ordenar el día" y el gráfico de demanda con el reparto; dónde duermen; avisos por pedido en el bloque. | L |
| **2. Cronograma con N camiones en "Armar viajes"** | En el gerenciador: "Tenés 3 camiones asignados para este pedido", sacar o cambiar camiones y recalcular carga, llegada y fin de cada viaje; avisos del pedido. | M |
| **3. Avisos en el despacho** | En `/plantista` (pantalla de tres columnas): "AG083GT pasa a Canning 11:05", a qué planta pertenece cada camión ahora, ver y editar el reparto desde ahí, "Sugerir de nuevo desde ahora" con lo ya despachado fijo. | M |

Se programan en ese orden; cada una se ve en el preview antes de seguir.

### 2.1 Fuera de alcance
- **No se toca `mixers.plant_id`** ni se le da planta fija a los camiones: el reparto cambia por día y por hora, y
  la decisión "camiones compartidos, sin planta" sigue vigente.
- No se cambia `regenerarViajesPedido` (el rearmado al editar un pedido sigue con camiones sin límite); si deja un
  camión en dos lugares, lo marca el aviso de choques que ya existe.
- No se rearman solos los viajes guardados al cambiar el reparto: se rearman con "Ordenar el día" o el gerenciador,
  como hoy.
- Bombas (son de terceros), choferes, m³ por camión distintos por camión (LES431 de 10 m³ sigue llevando los m³
  por camión del pedido), multipunto, recálculo automático en vivo con el GPS (la fase 3 tiene un botón, no un
  proceso solo).
- Medir el traslado con el GPS: hoy la reconstrucción no guarda los traslados directos. Queda anotado para la 4a.

## 3. Cómo se calcula la sugerencia (simple y explicable)

Todo en `lib/reparto.ts`, puro (sin React ni Supabase), sobre `planificar()` y los tiempos de `lib/viajes.ts`
(`parametrosConGps`, `conTiemposGps`: ida, descarga, espera en planta reales; lo del pedido gana siempre).

### 3.1 Supuestos
- **Ciclo de un camión** = carga + ida + descarga (bomba o directo, proporcional a los m³) + lavado (0) + vuelta
  (= ida) + espera en planta antes de volver a cargar. Son los números de siempre, con su fuente.
- **Traslado Canning ↔ Hudson:** minutos (y, si se cargan, km y litros) de la tabla `traslados_plantas` (punto 5).
  Mientras no esté cargado: la ruta del mapa entre las dos plantas (`/api/geo/ruta` con `plants.gps_lat/lng`) o
  **60 min**, con la marca "traslado a confirmar". El camión sale a la vuelta de su último viaje y, al llegar,
  hace la espera de la planta nueva antes de cargar.
- **Dónde amanece cada camión:** la planta donde se decidió que durmiera el día anterior
  (`reparto_camiones.duerme_plant_id`). Si no hay (el primer día), se toma la planta donde la sugerencia lo usa
  primero, **sin contar traslado**, y se muestra "durmió en: a confirmar".
- **Camiones del día:** los activos que no están en taller ni fuera de servicio, menos los que se marquen "no sale
  hoy" en el reparto.
- **Una boca de carga por planta** (`plants.bocas_carga`), también entre pedidos distintos.
- **Viajes ya despachados** de hoy quedan fijos (cuentan como ocupados).

### 3.2 Cuándo "alcanzan" N camiones (reglas, constantes `REGLAS_REPARTO` en `lib/reparto.ts`)
Con N camiones el pedido se compara contra su **cronograma ideal** (`generarViajes`, sin límite de camiones):

| | Ningún corte entre camiones de más de | Termina como mucho |
|---|---|---|
| **Bomba** (no puede esperar) | 10 min | 20 min después que el ideal |
| **Directo** | 20 min | 30 min después que el ideal |

"Corte" = minutos entre el fin de descarga de un camión y la llegada del siguiente (`esperaObra` de `planificar`).
Además se avisa aparte si termina después del fin de jornada de la planta. Los valores son para charlar con
Bautista (pregunta 3); quedan en una sola constante.

### 3.3 Pasos

**Paso 1 — Cuántos camiones necesita cada pedido, solo.** Para cada pedido pendiente del día (de las dos
plantas): N ideal = `explicarFlota().necesarios`; después se prueba con 1, 2, … hasta N ideal camiones
(`planificar` con ese pedido solo) y se queda el **menor N que alcanza** (3.2). Es el "usar los menos camiones
posibles" de Bautista. Texto: *"3 alcanzan: la bomba recibe un camión cada 38 min (2 esperas de 9 min). Con 4
termina 17:45 en vez de 18:03, pero suma un traslado."*

**Paso 2 — Armar el día con las dos plantas.** Los pedidos se arman **en orden de hora de la primera carga**. Para
cada uno:
1. Se ordenan los camiones por **costo**: (a) primero los que a esa hora ya están en la planta del pedido (no
   suman traslado); (b) entre ellos, el que puede cargar antes; (c) a igual hora, el que se usó más tarde ("pocos
   camiones bien usados", como la 2b); (d) patente. Un camión que está en la otra planta suma **1 traslado** y
   recién puede cargar a su vuelta + traslado + espera.
2. Se toman los **N del paso 1** y se arman los viajes con `planificar()` de esa planta, con los viajes ya armados
   (de este paso, de cualquier planta, y los despachados) como **ocupados**. Un viaje de la otra planta ocupa al
   camión desde su carga − traslado hasta su vuelta + traslado.
3. Si con esos N no alcanza (porque algunos llegan tarde), se prueba con N + 1 del mismo orden, hasta que alcance o
   no queden camiones. Si nunca alcanza, queda el que termina antes y el pedido lleva su aviso.

**Paso 3 — La bomba no espera.** Si al terminar el paso 2 un pedido **con bomba** no alcanza y hay un pedido
**directo** que se superpone en el horario y usa camiones, se le saca **un** camión a ese directo (al que más
tiene, nunca por debajo de 1) y se vuelve a armar el día. Se repite hasta que la bomba alcance o no haya a quién
sacarle. Texto: *"Santa Rita queda con 2 camiones (hacían falta 4): los otros 3 están con la bomba de Greenville."*
Si no hay de dónde sacar: aviso rojo *"No alcanzan los camiones para la bomba de Pampero: hacen falta 4 y a esa
hora hay 3."*

**Paso 4 — Reparto por franja (se deduce, no se decide aparte).** Con los viajes de cada camión salen sus
**tramos**: planta, desde (primera carga o llegada del traslado) y hasta (última vuelta). Un camión que se queda
sin viajes **no se mueve** ("libre en Hudson desde 11:52"): no se lo pasa a la otra planta "por las dudas", porque
cada traslado gasta. Las **franjas** se cortan en cada traslado: *"07:00 a 11:05 · Hudson 3 · Canning 2"*,
*"Desde 11:55 · Canning 3 · Hudson 2 libres"*.

**Paso 5 — Dónde duermen.** Cada camión, por defecto, **se queda donde termina** (0 traslados). Si el día
siguiente ya tiene pedidos cargados, se corre el paso 1 y 2 de ese día solo para ver **cuántos camiones necesita
cada planta para arrancar** (los que la sugerencia del día siguiente usa antes de las 10:00). Si a una planta le
faltan y a la otra le sobran, se sugiere pasar los que sobran **esa noche** (cuenta 1 traslado de noche cada uno:
es el mismo gasto que pasarlo a la mañana, pero arranca a horario). Textos: *"AG083GT: se queda en Canning (mañana
Canning arranca con 3)"*, *"Mañana todavía no tiene pedidos: cada camión queda donde termina."*

**Contador de traslados** (siempre a la vista): *"Traslados: 1 en el día · 0 a la noche · ≈ 42 km · 17 L"* (km y
litros solo si están cargados en el parámetro). Al lado de la decisión de cada pedido, cuánto costaría la
alternativa: *"con 4 camiones serían 2 traslados"*.

### 3.4 Con un reparto editado
Si el reparto del día ya está guardado (o se está editando), los pasos 2 a 4 corren **con esa restricción**: un
camión solo carga en una planta dentro de sus tramos en esa planta (fuera de ellos es "ocupado"; entre dos tramos
de distinta planta, el traslado). La sugerencia no pisa lo guardado: se ve al lado ("Sugerido: Canning 3 · tenés
Canning 5") hasta que alguien toque "Usar la sugerencia". Así el mismo motor sirve para sugerir, para editar y
para "Ordenar el día".

## 4. Pantallas y textos

### 4.1 Fase 1 — Vista Día, bloque "Camiones por planta" (con el interruptor)
Va arriba del gráfico de demanda, con el distintivo "Nuevo · en prueba" y (?) con la explicación corta del 3.3.
Muestra **las dos plantas** aunque la vista Día esté en una (los camiones son compartidos).

Arriba, el resumen:
- "**07:00 a 11:05** · Hudson 3 (AE402HE, AF431GU, AG083GT) · Canning 2 (CRN449, LES431)"
- "**11:05** · AG083GT pasa de Hudson a Canning (llega 11:55)"
- "**Desde 11:55** · Canning 3 (CRN449, LES431, AG083GT) · Hudson 2 libres (AE402HE vuelve 11:52, AF431GU 12:37)"
- "**Traslados: 1** en el día · 0 a la noche"
- "**A la noche:** quedan 3 en Canning y 2 en Hudson"

Por pedido, una línea con el porqué (de `lib/reparto.ts`, no armada en la pantalla):
- Verde: "Greenville · bomba · **3 camiones**: alcanzan, la bomba recibe un camión cada 45 min."
- Ámbar: "Santa Rita · directo · **2 camiones** (hacían falta 4): termina 12:05 en vez de 10:15, con 2 cortes de 55 min. Los otros están con la bomba de Greenville."
- Verde: "Pampero · bomba · **3 camiones**: alcanzan, un camión cada 38 min (2 esperas de 9 min). Con 4 termina 17:45 pero suma un traslado."

Debajo, una fila por camión con la barra del día (color de la planta, gris = traslado) y, para editar:
- "Sale hoy" (sí/no);
- "Arranca en" Canning / Hudson;
- "+ Pasa a la otra planta a las [hh:mm]" (hasta 3 cambios en el día); al lado, "sale de Hudson 11:05";
- "Duerme en" Canning / Hudson.

Botones: **Sugerir** (recalcula), **Usar la sugerencia**, **Guardar reparto** (con el aviso "Cambia el reparto de
las dos plantas"). Mientras se edita, las líneas de cada pedido se recalculan en el momento.

Avisos del bloque (fase 1, los del punto 4 del pedido):
- "La bomba de X va a esperar: hacen falta 4 camiones y a esa hora hay 3."
- "X termina 12:05 en vez de 10:15." / "X termina 18:03, después del fin de jornada (18:00)."
- "X se superpone con Y: AF431GU tendría que cargar para Y a las 12:15 y vuelve de X 12:37."
- "AG083GT pasa a Canning a las 11:05 pero vuelve de Greenville 11:52." (cambio a mano imposible)
- "Traslado a confirmar: cargalo en Tiempos y camiones."

Otros cambios en la vista Día (con el interruptor):
- "Tiempos y camiones": **los botones de "Camiones disponibles ese día" se reemplazan por el reparto** (el que no
  sale hoy, no sale). Sin el interruptor quedan como están (en el navegador).
- "Tiempos y camiones": campo **"Traslado Canning ↔ Hudson"**: minutos, km y litros (opcionales), con "Ruta del
  mapa: 52 min · 41 km" al lado. Se guarda con el botón y el motivo de siempre (gerencial).
- **"Ordenar el día"** usa el reparto (3.4) en vez de todos los camiones.
- **Gráfico de demanda:** la línea de "Disponibles" sigue el reparto de esa planta en cada media hora (escalones).

### 4.2 Fase 2 — "Armar viajes" (gerenciador)
Arriba del Gantt:
- "**Tenés 3 camiones asignados para este pedido:** [CRN449] [LES431] [AG083GT]". Por defecto: los camiones de los
  viajes pendientes guardados; si no tiene, los que eligió la sugerencia para este pedido.
- Cada camión es un botón que se saca o se pone. Se ofrecen solo los que el reparto tiene en esta planta en ese
  horario; los otros aparecen apagados con "en Hudson hasta 11:55". Debajo: "Para usar otro camión, cambialo en
  Camiones por planta."
- Al cambiar, **se recalcula el cronograma** (sin grabar) y se muestra por viaje: camión, carga, sale, llega,
  termina, vuelve. Resumen: "Con 2 camiones termina 12:05 (con 3, 10:40) · 2 cortes de 55 min".
- Avisos del pedido: los mismos de 4.1 que le tocan.
- **Guardar** graba los viajes con su camión (`guardar_viajes_pedido`, origen `gerenciador`), como hoy.

### 4.3 Fase 3 — Despacho diario (tres columnas)
- Columna Camiones: en la tarjeta, "Hoy: Hudson → Canning 11:55"; ordena primero los del reparto de esta planta.
- Aviso arriba de la columna, 30 min antes: "**11:05 · AG083GT pasa a Canning** (reparto del día)". En la otra
  planta: "AG083GT llega de Hudson ~11:55".
- `camionPropuesto()` prefiere un camión del reparto de esta planta.
- Botón "Camiones por planta" (mismo componente que 4.1) y **"Sugerir de nuevo desde ahora"**: lo despachado queda
  fijo y se resugiere el resto del día; no se guarda solo.

## 5. Base de datos (Bautista lo aprueba antes)

Una migración `supabase/migrations/2026MMDDHHMM_reparto_camiones.sql`, que se puede correr dos veces y es compatible
con `main`. **Solo agrega; no cambia ninguna tabla ni función existente.**

**Tabla `traslados_plantas`** (una fila por par de plantas; hoy, una sola):

| Columna | Tipo | Nota |
|---|---|---|
| `plant_a`, `plant_b` | uuid FK `plants` | PK (`plant_a`, `plant_b`), CHECK `plant_a < plant_b` (sirve para los dos sentidos) |
| `minutos` | int NOT NULL, CHECK > 0 | |
| `km` | numeric(6,1), CHECK > 0 | opcional |
| `litros` | numeric(6,1), CHECK > 0 | opcional; si no está, no se muestran litros |
| `actualizado_por`, `updated_at` | | quién y cuándo (además, Actividad con motivo) |

La migración la crea **vacía**, salvo que Bautista dé el número (pregunta 1): entonces se inserta esa fila.

**Tabla `reparto_camiones`** (una fila por camión y día):

| Columna | Tipo | Nota |
|---|---|---|
| `fecha` | date | día argentino. PK (`fecha`, `mixer_id`) |
| `mixer_id` | uuid FK `mixers` ON DELETE CASCADE | |
| `sale` | boolean NOT NULL DEFAULT true | false = no sale ese día |
| `tramos` | jsonb NOT NULL DEFAULT '[]' | `[{"plant_id": "…", "desde": "07:00"}, {"plant_id": "…", "desde": "11:55"}]`. `desde` del primero puede ser null (desde que arranca el día). Cada tramo dura hasta el siguiente − traslado |
| `duerme_plant_id` | uuid FK `plants`, null | dónde queda a la noche; es el "amanece en" del día siguiente |
| `origen` | text CHECK in (`sugerido`, `a_mano`) | `sugerido` = se guardó tal cual la sugerencia |
| `actualizado_por`, `updated_at` | | |

**Función `guardar_reparto_dia(p_fecha date, p_filas jsonb, p_usuario text) returns jsonb`**: mismo patrón que
`guardar_viajes_pedido` (SECURITY DEFINER, `search_path`, hora de Argentina, GRANT EXECUTE a anon y authenticated).
Bloquea la fecha (`pg_advisory_xact_lock`), valida (camión activo, plantas que existen, horas `HH:MM` crecientes,
dos tramos seguidos de distinta planta), reemplaza todas las filas de esa fecha (todo o nada) y deja una línea en
`activity_log` (entity `reparto`, reference la fecha, detalle por camión: "AG083GT: Hudson → Canning 11:55",
"Traslados: 1"). Los avisos (camión que no llega, traslado corto) son de la pantalla, no frenan.

**Qué pasa con lo cargado:** nada. Ningún pedido, viaje, despacho ni camión cambia. Los días sin reparto se
comportan como hoy (todos los camiones disponibles en las dos plantas). `mixers.plant_id` sigue en null. Los
camiones guardados en el navegador quedan solo para quien no tiene el interruptor; se retiran cuando el interruptor
se prenda para todos. RLS: como el resto (0c-2 pendiente); anotar las dos tablas en `fase-0c.md`.

**Tipos:** regenerar `types/database.ts`. Actividad: sumar `reparto: "Reparto de camiones"` a `ENTIDADES` en
`app/actividad/page.tsx`.

## 6. Archivos

**Nuevos**
- `lib/reparto.ts` (puro): `REGLAS_REPARTO`, `alcanza()`, `camionesMinimos()` (paso 1), `armarDia()` (pasos 2–3,
  con reparto opcional, 3.4), `tramosDe()` y `franjasDe()` (paso 4), `dondeDuermen()` (paso 5),
  `contarTraslados()`, `trasladoEntre()`, `cronogramaPedido()` (un pedido con los camiones elegidos: lo usa
  `armarDia` y el gerenciador), y los textos (`textoPorQue()`, `textoFranja()`, `textoTraslados()`, avisos).
  Patrón: `lib/viajes.ts` (motor puro + textos + carga/guardado al final del archivo: `cargarReparto()`,
  `guardarReparto()`, `cargarTraslado()`).
- `lib/__tests__/reparto.test.mjs` y el script `"test:reparto"` en `package.json` (igual a `test:despacho`, con
  `alias.mjs`).
- `components/reparto-camiones.tsx`: el bloque y el editor (4.1); lo usan la vista Día y, en la fase 3, el despacho.
- La migración del punto 5.

**Se modifican**
- `lib/planificador.ts`: parámetro opcional `cargasOcupadas` en `planificar()` (cargas de otros pedidos de la misma
  planta, para la boca). **Sin el parámetro da exactamente lo mismo que hoy** (comparar 1.000 días al azar, como en
  la 2b).
- `lib/viajes.ts`: `ocupadosDe()` y `generarViajes`/`planDelDia` con traslado opcional para los viajes de otra
  planta (sin traslado = como hoy); `planDelDia` con reparto opcional delega en `armarDia()` (un solo motor).
- `components/programacion-dia.tsx` (fase 1): bloque, traslado en "Tiempos y camiones", disponibles del reparto,
  "Ordenar el día" y demanda con el reparto.
- `components/gerenciador-viajes.tsx` (fase 2): camiones del pedido y recálculo con `cronogramaPedido()`.
- `components/despacho/columna-camiones.tsx`, `despacho-tablero.tsx`, `lib/despacho.ts` (`camionPropuesto`) (fase 3).
- `lib/permisos.ts`: solo las descripciones (programacion.editar y despacho.cargar: "reparto de camiones del día").
- `app/actividad/page.tsx`, `types/database.ts`, `docs/migracion-loop/README.md` (registro de avance y decisiones).

**Sin dependencias nuevas.**

## 7. Permisos

| Acción | Permiso |
|---|---|
| Ver el reparto | `programacion.ver` o `despacho.ver` |
| Editar y guardar el reparto, "Usar la sugerencia", "Sugerir de nuevo desde ahora" | `programacion.editar` **o** `despacho.cargar` (quien programa o el plantista, pedido de Bautista) |
| Traslado Canning ↔ Hudson (minutos, km, litros) | `programacion.editar`, con motivo (como los tiempos de la planta) |
| Camiones del pedido en el gerenciador y guardar sus viajes | como hoy: `programacion.editar`, o `cargar` en los propios |

Hasta la 0c-2 el permiso se controla en la pantalla, como el resto.

## 8. Criterios de aceptación (con el ejemplo del 05/11)

**Datos de prueba fijos** (los de la base pueden ser otros; ver pregunta 2):
- Canning: carga 15, espera 10, lavado 0, directo 30 y bomba 38 por 8 m³, jornada 07:00–18:00, 1 boca.
- Hudson: carga 10, espera 22, lavado 0, directo 43, **bomba 45** por 8 m³ (a mano), 1 boca.
- Ida 30 min a las tres obras. Traslado 50 min. 8 m³ por camión.
- Durmieron: CRN449 y LES431 en Canning; AE402HE, AF431GU y AG083GT en Hudson.
- Pedidos: Santa Rita (Canning, 40 m³, directo, llega 07:45 = sale 07:15); Greenville (Hudson, 40 m³, bomba,
  llega 08:20 = sale 07:50); Pampero (Canning, 60 m³, bomba, llega 13:00 = sale 12:30).

1. **Paso 1:** Greenville necesita 3 (ideal 4; con 3 hay una espera de 2 min y termina 12:07 contra 12:05). Pampero
   necesita 3 (ideal 4; con 3 hay 2 esperas de 9 min y termina 18:03 contra 17:45; con 2 no alcanza). Santa Rita
   necesita 4 (con 3 hay cortes de 25 min).
2. **Paso 3:** Santa Rita queda con 2 y Greenville con 3. El cartel dice "Santa Rita · directo · 2 camiones (hacían
   falta 4): termina 12:05 en vez de 10:15, con 2 cortes de 55 min. Los otros están con la bomba de Greenville".
3. **Reparto:** "07:00 a 11:05 · Hudson 3 (AE402HE, AF431GU, AG083GT) · Canning 2 (CRN449, LES431)"; "11:05 ·
   AG083GT pasa de Hudson a Canning (llega 11:55)"; "Desde 11:55 · Canning 3 · Hudson 2 libres". **Traslados: 1.**
   Pampero dice "3 camiones: alcanzan … Con 4 termina 17:45 pero suma un traslado". (La idea de Bautista, "desde
   11:30 Canning 5", gasta 3 traslados; con estas reglas alcanzan 3 camiones y 1 traslado.)
4. **Cronograma de Pampero** con CRN449, LES431 y AG083GT: cargas 12:15, 12:53, 13:31, 14:18, 14:56, 15:34, 16:21,
   16:59; ningún camión en dos viajes a la vez; ninguna carga se pisa con otra en la boca de Canning.
5. **Dónde duermen:** sin pedidos el 06/11 → "cada camión queda donde termina", 0 traslados de noche (3 en Canning,
   2 en Hudson). Con un pedido de prueba el 06/11 en Canning que pide 5 camiones a las 07:00 → sugiere pasar
   AE402HE y AF431GU a Canning esa noche y dice "Traslados: 1 en el día · 2 a la noche".
6. **Editar:** pasar AE402HE a Canning desde 12:52 y guardar → `reparto_camiones` del 05/11 tiene 5 filas,
   `origen = a_mano`, Actividad con el cambio; el contador dice "Traslados: 2"; al recargar en otra computadora se
   ve igual. "Usar la sugerencia" lo vuelve al de 3.
7. **Edición imposible:** poner "AG083GT pasa a Canning 10:30" → aviso "vuelve de Greenville 11:05" y Greenville
   pasa a ámbar ("la bomba va a esperar"); se puede guardar igual.
8. **Fase 2:** en "Armar viajes" de Pampero dice "Tenés 3 camiones asignados para este pedido"; sacar uno recalcula
   y muestra que no alcanza ("la bomba espera"; termina más tarde); volver a ponerlo deja el cronograma del punto 4;
   Guardar graba los viajes con su camión.
9. **Fase 3:** en `/plantista` de Hudson aparece "11:05 · AG083GT pasa a Canning" desde las 10:35; en Canning,
   "AG083GT llega de Hudson ~11:55".
10. **No se rompe nada:** sin el interruptor ninguna pantalla cambia (capturas antes y después de la vista Día, el
    gerenciador y el despacho). Un día sin reparto guardado se planifica igual que hoy. `planificar()` sin
    `cargasOcupadas` y `planDelDia` sin reparto ni traslado dan idéntico a `main` en 1.000 días al azar.
    `npm run test:gps` y `test:despacho` siguen pasando; `tsc` sin errores nuevos en los archivos tocados.
11. **Con datos reales** (solo lectura, clave anon): la sugerencia del 05/11 se le muestra a Bautista con la fuente
    de cada tiempo antes de publicar.

## 9. Pruebas (`node --test`, `lib/__tests__/reparto.test.mjs`)
- El ejemplo completo del punto 8 (pasos 1 a 5, textos incluidos).
- `alcanza()`: límite justo (corte de 10 y de 11 min con bomba; 20 y 21 directo; demora 20/21 y 30/31).
- Un pedido solo con 5 camiones libres usa el mínimo (no los 5).
- Preferencia por no trasladar: con un camión libre en la planta y otro libre antes en la otra, elige el de la
  planta aunque cargue un poco más tarde, mientras alcance.
- Traslado: un camión que vuelve a Hudson 11:05 no puede cargar en Canning antes de 11:05 + traslado + espera.
- La bomba le saca camiones al directo y nunca deja un directo con 0.
- Dos bombas que no alcanzan: aviso rojo, sin bucle infinito.
- Reparto editado (3.4): un camión fuera de su tramo nunca recibe viajes en esa planta.
- Viajes despachados quedan fijos y cuentan como ocupados.
- Sin traslado cargado: 60 min y la marca "a confirmar".
- Boca de carga entre dos pedidos de la misma planta.
- Dónde duermen: sin pedidos al otro día, con pedidos que caben y con faltante.
- Identidad con `main` de `planificar()` y `planDelDia()` sin los parámetros nuevos.
- Base: migración dos veces en `BEGIN … ROLLBACK` (tablas, CHECKs, `guardar_reparto_dia` todo o nada, Actividad,
  `anon` guarda y lee); después del ROLLBACK producción queda igual.

## 10. Riesgos
| Riesgo | Cómo se cubre |
|---|---|
| Hudson tiene la descarga con bomba en 15 min por 8 m³ (sin datos del GPS): con eso la sugerencia cree que Greenville necesita 5 camiones y deja a Canning sin ninguno | Pregunta 2: corregirla a mano en "Tiempos y camiones" o cargar la descarga en el pedido. La línea del porqué muestra el número y su fuente |
| La sugerencia queda vieja si un pedido se atrasa | Fase 3: "Sugerir de nuevo desde ahora". El reparto guardado no se cambia solo |
| Greedy: no siempre da el óptimo | Es a propósito: se explica en una línea por pedido y se puede editar. Se prueba con el ejemplo y con días reales |
| Dos personas editan el reparto a la vez | `guardar_reparto_dia` bloquea la fecha y reemplaza todo; gana el último y queda en Actividad |
| Directo con cortes largos (junta fría) | Aviso ámbar con los minutos; la regla de 20 min se charla con Bautista |

## 11. Preguntas para Bautista (con recomendación)
1. **Traslado Canning ↔ Hudson:** ¿cuántos minutos tarda un mixer vacío, cuántos km y cuántos litros gasta (o el
   consumo en L/km)? *Recomendación:* cargar minutos y km ya; litros si los tenés. Mientras, la ruta del mapa.
2. **Descarga con bomba de Hudson:** hoy 15 min por 8 m³ (2 viajes con GPS). ¿Cuánto tarda de verdad? *Recomendación:*
   corregirla a mano (Canning mide 38) antes de probar la sugerencia.
3. **Cuándo alcanzan:** bomba sin cortes de más de 10 min y no más de 20 min tarde; directo, 20 y 30. ¿Te sirven?
4. **Noche:** ¿los camiones tienen que volver a una planta fija (choferes, seguridad) o pueden dormir en cualquiera?
   *Recomendación:* en cualquiera; el sistema sugiere quedarse donde terminan.
5. **Quién edita:** quien programa con `programacion.editar` y el plantista con `despacho.cargar`. ¿Alguien más?
6. **Tu ejemplo:** pediste "desde 11:30, Canning 5". Con la regla de los menos traslados quedan 3 en Canning y 2
   libres en Hudson (1 traslado en vez de 3). ¿Confirmás que preferís eso?

## 12. Decisiones propuestas (se anotan en `docs/migracion-loop/README.md` §6 cuando Bautista apruebe)
- **El reparto es por día y por hora, en una tabla nueva (`reparto_camiones`)**, no en `mixers.plant_id`.
  Descartado: planta fija por camión (contradice "camiones compartidos" y no tiene franjas); seguir en el
  navegador (no lo ve el plantista ni otra computadora).
- **Un solo motor:** `lib/reparto.ts` orquesta `planificar()`; "Ordenar el día" y el gerenciador lo usan.
  Descartado: un planificador nuevo de dos plantas (duplicaría reglas que ya están probadas).
- **Criterio:** menos camiones por pedido y menos traslados; la bomba tiene prioridad sobre el directo; un camión
  sin trabajo no se traslada. Descartado: repartir los camiones "por si acaso" según los m³ de cada planta.
- **Traslado como parámetro** en `traslados_plantas` (minutos, km, litros). Descartado: medirlo del GPS (hoy no se
  guardan los traslados directos) y una columna por planta (ambiguo con más de dos plantas).
