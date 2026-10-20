# Fase 3 — Despacho diario en tres columnas

Estado: **revisada y aprobada (20/10/2026)**; falta aplicar la migración (con OK de Bautista), probar el preview y publicar. **propuesta del arquitecto (08/10/2026), con las respuestas de Bautista del 08/10 (punto 13) y del 20/10 (punto 14, remito R/X). Cada una manda sobre lo anterior.** Programada por el obrero el 20/10/2026 (ver "Hecho"); falta revisión.
Maqueta navegable: [`maqueta-fase-3.html`](maqueta-fase-3.html). Se abre con doble clic, no necesita internet y no graba nada.

Leer antes: `README.md` (principios), `fase-2.md` (viajes, interruptor `ve_funciones_nuevas`), `fase-4a.md` (GPS y `viajes_gps`), `fase-0c.md` (permisos). Referencias de Loop: `informe-loop.md` §2.6 y las capturas `despacho_pantalla_principal`, `despacho_form_entrega`, `despacho_filtro_betoneiras`, `despacho_suspender_programacion`, `entregas_tabla`.

---

## 1. Objetivo

El plantista tiene que tener **en una sola pantalla todo lo que necesita para despachar el día**, como en Loop:

| Viajes | Camiones | Pedidos |
|---|---|---|
| Qué camión tiene que salir y a qué hora. En rojo, el que está atrasado. | Dónde está cada camión, desde hace cuánto y con qué chofer. | Cuánto lleva cada obra (entregado / total), si está confirmada y si el primer camión llegó a tiempo. |

Para despachar, toca el viaje, toca el camión (o arrastra uno sobre el otro), completa el formulario **Entrega** y aprieta **Despachar** o **Despachar e imprimir**. El despacho lo graba el **mismo motor de siempre** (`registrar_despacho`, fase 0b). Por eso el stock, las probetas, la Actividad y el remito quedan exactamente igual que hoy.

Escala real: 2 plantas (Hudson y Canning), 5 mixers compartidos, unos 11 despachos por día. Despachan Titan y Felipe, desde la PC o la tablet de la planta. Todo está pensado para **5 camiones y una tablet**, no para 80 camiones.

## 2. Alcance

**Entra:**
1. La pantalla nueva de tres columnas en `/plantista`, con contadores del día y la tabla de entregas abajo.
2. Estados del camión en vivo, que salen del GPS cuando hay señal y del despacho cuando no hay, más las marcas a mano que hagan falta: "Volvió a planta", "Taller" y "Disponible".
3. Asignar un viaje a un camión: con un botón, tocando o arrastrando.
4. El formulario **Entrega**, con todos los campos de hoy, y los botones Despachar / Despachar e imprimir.
5. Pedido: **suspender** (lluvia) con motivo, **reabrir**, **finalizar** con motivo y **cancelar** con motivo (este último, solo gerencial, como hoy).
6. Convivencia con la pantalla actual, que se muestra con el interruptor de funciones nuevas (punto 8).

**Fuera de alcance:**
- El panel de control con la línea de tiempo de cada viaje, las alertas de 90 min en obra y el hormigón por vencer: es la Fase 4b.
- La puntualidad *real* en vivo. En esta fase se muestra estimada mientras el camión anda y real al día siguiente, cuando la 4a reconstruyó los viajes (punto 3.3).
- El link para el celular del chofer: decisión del 29/09, se espera al GPS.
- El cierre del día y la verificación de remitos: es la Fase 5.
- Mandar la carga a la dosificadora: queda anotado en la 0c.
- El WhatsApp "salió tu camión": es la Fase 7.
- Programar las bombas, o entregas multipunto.
- Cambiar Semana o la vista Día, salvo el distintivo "Suspendido" (punto 6.4).

## 3. Cómo se ve

Arriba, de izquierda a derecha:
- planta (Hudson / Canning);
- día, con ‹ Hoy ›;
- la hora;
- "Carga despacho manual", el mismo diálogo de hoy, que incluye el despacho por árido o de prueba;
- "Actualizar";
- el selector "Pantalla nueva / Pantalla de siempre" (punto 8).

Debajo, el aviso que ya existe: "Se recomienda extraer 3 muestras cada 50 m³".

**Contadores del día** (de la planta elegida), como los íconos de Loop pero con nombre:

| Programado | Despachado | Falta | Suspendido | Cancelado | Viajes |
|---|---|---|---|---|---|
| m³ de los pedidos del día (activos, completos y suspendidos) | m³ de los remitos del día, manuales incluidos | Programado − despachado de los activos | m³ que faltan de los suspendidos | m³ que faltaban al cancelar | "4 de 11" |

En la PC y en la tablet apaisada (1024 × 768 o más) van **tres columnas** del mismo alto, cada una con su propio scroll. Con menos de 900 px de ancho (tablet parada, celular) pasan a **tres pestañas**: Viajes · Camiones · Pedidos.

Todo lo que se toca mide al menos 44 px de alto. Letra base de 15 px.

### 3.1 Columna Viajes

- **Qué muestra:** los viajes **pendientes** de los pedidos activos del día y de la planta, ordenados por hora de carga.
  - Los despachados pasan a la tabla de entregas.
  - Los de un pedido suspendido se esconden y el pedido muestra "4 viajes en pausa".
- **Tarjeta:** `n/N`; obra en grande; cliente; fórmula; **m³ › hora de carga**; ícono de bomba o "directo"; 👍 si el pedido está confirmado; camión sugerido (fase 2), si hay.
- **Borde rojo con "Atrasado 15 min"** cuando ya pasó la hora de carga y no salió (es la misma regla de la fase 2).
- **Borde ámbar con "Ahora"** en los próximos 15 minutos.
- **Pedido sin viajes guardados** (lo cargó alguien sin el interruptor, o es de antes de la fase 2):
  - sus viajes se **calculan en el momento** con el motor de `lib/viajes.ts`, sin guardarlos;
  - llevan la marca gris "calculado";
  - así la columna nunca queda vacía por un pedido sin viajes.
- **Botón "Despachar"** en cada tarjeta: abre Entrega directo, con el camión sugerido o el primero libre. Es el camino más simple y el que se va a usar más.
- **Tocar la tarjeta** la deja **elegida** (marco azul). La columna Camiones resalta los libres con "Tocá un camión para despachar". Tocar de nuevo, o Esc, la suelta.

### 3.2 Columna Camiones

Están siempre los **5 camiones activos**, en las dos plantas, porque se comparten. Arriba, los libres en esta planta; después, los que están en viaje; al final, taller y fuera de servicio. Filtro rápido: Todos · Libres · En viaje · Taller.

**Tarjeta:**
- patente en grande;
- **estado** con color e ícono;
- **tiempo en ese estado** ("hace 24 min");
- chofer (el último que lo manejó hoy, porque rotan);
- obra a la que va o planta donde está;
- de dónde sale el estado: "GPS" o "sin GPS · estimado".

**Estados:**

| Estado | Color | Cómo se sabe | ¿Se puede despachar? |
|---|---|---|---|
| **En planta (libre)** | verde | **GPS:** dentro de la geocerca de una planta (250 m). Sin GPS: `mixers.status = available` | Sí |
| **Yendo a obra** | azul | **GPS:** fuera de planta, en movimiento, con remito del día y antes de la ida estimada + 15 min. Sin GPS: desde el despacho hasta la llegada estimada | Avisa (punto 4.4) |
| **En obra** | ámbar | **GPS:** a menos de 400 m de la obra, si está ubicada. Si la obra no está ubicada: "parado fuera de planta (probable obra)" | Avisa |
| **Volviendo** | celeste | **GPS:** en movimiento después de la ida estimada + 15 min, como hoy en `/api/gps/posiciones`. Sin GPS: desde el fin de descarga estimado | Avisa |
| **Taller** | gris oscuro | **A mano:** `mixers.status = maintenance` (desde esta pantalla o desde Camiones) | No (se puede pasar a Disponible) |
| **Fuera de servicio** | gris | **A mano:** `mixers.status = unavailable` (desde Camiones) | No |

- **Tiempo en el estado:**
  - en viaje (yendo, en obra o volviendo): desde la **hora de salida del remito**. Es el dato más firme, con o sin GPS;
  - en planta o en taller: desde `mixers.estado_desde`, una columna nueva (punto 7).
- **Ciclo del viaje en curso:** "⏱ 1 h 12 desde la salida", como el ⏱ de Loop.
- **Sin señal GPS** (más de 3 h sin posición, o un camión que no está en Wialon):
  - el estado sale de los horarios planificados del viaje despachado y lleva la marca **"sin GPS · estimado"**;
  - cuando pasa la vuelta estimada + 30 min aparece en ámbar **"¿Volvió? Tocá Volvió a planta"**.
- **El GPS manda sobre `mixers.status`.** Si el GPS lo ve dentro de una planta después de haber salido, el camión **queda libre solo**: se graba `available` con fuente GPS (punto 7, `camion_volvio`).
  - Hoy esto no pasa: 2 de los 5 camiones quedaban "en ruta" porque nadie tocaba "Entregado".
- **"Sin chofer":** no es un estado que bloquee, porque los choferes rotan y el chofer se elige en cada despacho. Si el camión no salió todavía en el día, dice "chofer: sin asignar hoy".

### 3.3 Columna Pedidos

Los pedidos del día y de la planta, en orden de hora de llegada.

**Tarjeta:**
- cliente, obra, fórmula, finalidad;
- bomba (empresa y hora) o "directo"; fibra si lleva;
- **entregado / total m³** con su barra;
- 👍 confirmado (fase 2);
- **puntualidad del primer camión:**
  - el **primer remito ya llegó** según la reconstrucción de la 4a (días anteriores): "Llegó 07:52 · pedido 07:45 · +7 min", en verde dentro de la tolerancia de la planta (`plants.tolerancia_puntualidad_min`) y en rojo fuera de ella;
  - **hoy, en vivo:** si el GPS ve al camión del primer remito en la obra, "En obra desde 07:52 (GPS)" con el mismo color; si no, "Llegaría ~07:50 (estimado)" con salida + viaje del pedido;
  - todavía no salió: "1.er camión carga 07:05".

**Pedidos que no están activos:**
- **suspendidos:** en gris, con "Suspendido · lluvia · 08:40 · Titan" y el botón **Reabrir**;
- **completos y finalizados:** abajo, plegados;
- **cancelados:** solo con el filtro "Ver cancelados", como el ⊘ de Loop.

**Menú ⋮ del pedido** (cada opción según el permiso, punto 9):
- 👍 Confirmar / Quitar confirmación;
- Viajes, que abre el gerenciador de la fase 2;
- Editar total;
- **Suspender**;
- **Reabrir**;
- **Finalizar**;
- Ver entregas, que filtra la tabla de abajo;
- **Cancelar pedido**.

### 3.4 Tabla de entregas (abajo)

Los remitos del día de la planta, el último arriba. Incluye los manuales y los por árido, que llevan su marca.

| Columna | Qué muestra |
|---|---|
| Salió | Hora de salida |
| Remito | Número |
| Camión | Patente |
| Chofer | Nombre |
| Cliente / obra | |
| Fórmula | |
| m³ | |
| Viaje | n/N |
| Muestra | Número de muestra, si se tomó |
| Ahora | Estado actual del camión, si es su viaje en curso |
| En obra / volvió | Del GPS, cuando la 4a ya reconstruyó el viaje |
| 🖨 | Remito |

## 4. Asignar y despachar, paso a paso

### 4.1 Camino corto (botón)
1. En **Viajes**, el plantista aprieta **Despachar** en la tarjeta de arriba de todo (la más urgente, en rojo si está atrasada).
2. Se abre **Entrega** con:
   - el viaje;
   - el camión sugerido, o el primero libre en esta planta;
   - su último chofer.
3. Completa el remito y lo que haga falta, y aprieta **Despachar** o **Despachar e imprimir**.

### 4.2 Tocando
1. Toca un viaje: queda elegido y los camiones libres se resaltan.
2. Toca un camión: se abre Entrega con ese viaje y ese camión.
3. También anda al revés: primero el camión y después el viaje.

### 4.3 Arrastrando (como Loop)
- Se arrastra la tarjeta del viaje sobre la del camión y, al soltar, se abre Entrega.
- Se hace con *pointer events*, que andan con el dedo en la tablet y con el mouse en la PC, sin librerías.
- Si se suelta fuera de un camión, no pasa nada.

### 4.4 Camión que no figura libre
Si el camión elegido figura en viaje, en obra o volviendo, se pregunta: "AF431GU figura **en obra** (GPS, hace 1 h 07). ¿Despachar igual?".
- Se puede, porque el estado puede estar mal: por ejemplo, volvió sin señal.
- Al despachar queda en ruta, como siempre.
- En **Taller** no deja: primero hay que tocar "Disponible".

### 4.5 Formulario Entrega

Encabezado del pedido:
- cliente, obra, dirección;
- fórmula, finalidad, bomba o directo, fibra del pedido;
- "Total 32 m³ · enviado 16 · falta 16".

| Campo | Cómo viene | Regla |
|---|---|---|
| **Viaje** | El elegido ("Viaje 3/4 · 8 m³ · cargar 08:50") | Se puede cambiar por otro pendiente. Al despachar se vuelve a buscar por número, como en la fase 2 ("El viaje 3 ya no está pendiente · se despacha como viaje 4") |
| **Camión*** | El tocado o el sugerido | Lista de los 5, con el estado al lado ("AF431GU · en obra") |
| **Chofer*** | El último de ese camión hoy | Obligatorio si hay choferes cargados (como hoy). Si se cambia el camión, se propone el chofer del nuevo, salvo que se haya elegido a mano |
| **m³ este camión*** | Los del viaje, o lo que falta si es menos | > 0 y ≤ falta + 0,5 (como hoy) |
| **Remito*** | Tipeado del talonario, con el siguiente de la serie que se usó por última vez en la planta (**ver 13.1**) | La base frena el repetido **en la misma planta**. Avisa si salta mucho o tiene dígitos de más (13.1) |
| **Salió a las** | La hora actual | Se puede corregir hacia atrás dentro del mismo día. Va a `dispatch_date`, que el motor ya acepta. Es para cuando se carga en tanda (fase 4a: "el plantista carga en tanda"). La hora real de carga queda en `created_at` y no se pisa (**13.5**) |
| **Agua extra en planta (L)** | 0 | Como hoy |
| **Fibra** | Prendida con los kg/m³ del pedido si lleva | Muestra el "Total en el camión: 4 kg (0,5 × 8)", como hoy |
| **Muestra de probeta** | Apagada | Al prenderla: número de muestra* (con "Última: M-0412") y asentamiento real*. "Se crean 3 probetas: 1 a 7 días y 2 a 28" |

Botones: **Cancelar** · **Despachar** · **Despachar e imprimir**.

**Despachar:**
1. Llama a `registrar_despacho` con el mismo jsonb de hoy, más `viaje_id` y `dispatch_date`. Todo en una transacción: remito, materiales, stock, fibra, probetas, pedido, viaje y camión en ruta.
2. Si el camión salió con otros m³ que los planificados, se rearman los pendientes, igual que hoy (`regenerarViajesPedido`).
3. En pantalla, sin esperar el refresco:
   - el viaje sale de la columna;
   - el camión pasa a **Yendo a obra · hace 0 min**;
   - el pedido suma los m³;
   - se actualizan los contadores;
   - se agrega la fila de la entrega.
4. Aviso: "Camión despachado · Remito 1283 · falta 8 m³".

**Despachar e imprimir** hace lo mismo y además abre el remito (`/api/remito/[id]`). En el formulario se elige "hoja preimpresa" u "hoja en blanco", y queda recordado por planta (**13.2**).

Si algo falla (remito repetido, supera lo que falta, pedido suspendido o cancelado por otro), el mensaje de la base aparece arriba del botón y **no se graba nada**: es el motor de la 0b.

### 4.6 Otras acciones del día

**Volvió a planta** (en la tarjeta del camión en viaje, sobre todo sin GPS):
- deja el camión en planta, libre;
- es lo mismo que el "Entregado" de hoy, más la hora y la fuente (a mano);
- con GPS casi nunca hace falta.

**Taller / Disponible** (menú ⋮ del camión):
- cambia `mixers.status` entre `maintenance` y `available`;
- queda en Actividad;
- no pide motivo, porque es operativo (regla de la 0c);
- "Taller" pide una nota corta opcional ("pinchó una goma").

**Suspender pedido** (lluvia):
- motivo con botones rápidos: **Lluvia** · Obra no está lista · Falla de bomba · Falla de camión · Falta material · Pedido del cliente · Otro;
- más un texto (obligatorio si es "Otro");
- los viajes pendientes quedan en pausa;
- los m³ que faltan pasan al contador "Suspendido";
- la base no deja despacharlo.

**Reabrir:**
- vuelve a activo;
- ofrece "Correr los viajes: el próximo carga a las 10:20", que usa "Ajustar a la hora actual" del gerenciador (lib/viajes), o "Dejar los horarios como estaban".

**Finalizar con motivo** (reemplaza al Finalizar de hoy):
- muestra Programado / Despachado / Sin enviar, como hoy;
- suma el motivo con botones: **La obra pidió menos** · Lluvia · Falla · Otro;
- la nota que hoy va a observaciones se sigue escribiendo igual.

**Cancelar con motivo:** como hoy (solo gerencial), pero el motivo también se guarda en el pedido (punto 7).

**Todo queda en Actividad** y en `dispatch_status_log`, con quién, cuándo y por qué.

## 5. De dónde sale cada dato (sin GPS y con GPS)

| Dato | Con GPS (B-Track, 5 mixers conectados desde el 30/09) | Sin GPS en ese camión |
|---|---|---|
| Libre en planta | Geocerca de la planta (y se marca solo) | `mixers.status`, más "Volvió a planta" a mano |
| Yendo, en obra, volviendo | `/api/gps/posiciones` cada 60 s | Estimado con los horarios del viaje despachado (ida, descarga y vuelta de la fase 2), con la marca "estimado" |
| Hora de salida | Remito ("Salió a las") | Remito |
| Llegada a obra (puntualidad) | En vivo: GPS en obra. Al otro día: `viajes_gps.llegada_obra` (4a) | Salida + viaje estimado, con la marca "estimado" |
| Taller, fuera de servicio | A mano | A mano |
| Chofer | Último remito del día de ese camión | Ídem |

El estado se arma en **una sola función pura**, `estadoCamion()` en `lib/despacho.ts`, que combina el GPS, `mixers`, el despacho del día y sus viajes. La usa esta pantalla y la puede usar el panel de la 4b. **No se agregan estados a `mixers.status`:** yendo, en obra y volviendo se calculan, no se guardan.

## 6. Qué pasa con la pantalla vieja

1. **Convive.** En `/plantista` aparece el selector **"Pantalla nueva · en prueba / Pantalla de siempre"**, y solo lo ven los usuarios con `ve_funciones_nuevas` (fase 2). Para ellos arranca en la nueva, y cada uno puede volver a la de siempre (se recuerda en el equipo). **Para los demás no cambia nada.**
2. **Mismo motor y mismos datos.** Las dos pantallas despachan con `registrar_despacho`, así que se puede pasar de una a otra en medio del día sin perder nada.
3. **Cambios mínimos en la vieja** (para todos, porque si no se rompe algo):
   - un pedido suspendido muestra el distintivo **"Suspendido · motivo"** y no muestra Despachar. Si alguien lo intenta igual, la base lo frena;
   - "Entregado" pasa a llamar a `camion_volvio`, que hace lo mismo más la hora;
   - "Finalizar" sigue igual y la nueva suma el motivo.
4. **Retiro:** cuando Titan y Felipe trabajen **dos semanas seguidas solo con la nueva** sin volver a la vieja (se mide en Actividad) y Bautista dé el OK, se prende para todos y en la publicación siguiente se borran la vista vieja y el selector. Hasta ese día el código viejo no se refactoriza.
5. Semana y la vista Día solo suman el distintivo "Suspendido" en la tarjeta del pedido.

## 7. Modelo de datos

**Ya existe y se usa tal cual:**
- `viajes` (fase 2): la columna Viajes. Los despachados, con `dispatch_id`.
- `scheduled_dispatches`: pedidos, `dispatched_m3`, `confirmado_at`, bomba, fibra, finalidad, `viaje_min`.
- `dispatches`, con `chofer_id`, y el motor `registrar_despacho` (0b + fase 1 + fase 2): ya acepta `viaje_id`, `chofer_id`, `dispatch_date`, agua, fibra y muestra.
- `mixers.status` (`available` / `in_transit` / `maintenance` / `unavailable`) y `mixers.gps_unit_id`.
- `/api/gps/posiciones` y `lib/wialon.ts` (posición, estado simple, caché).
- `viajes_gps` (4a): llegada real a obra para la puntualidad de días anteriores.
- `plants.tolerancia_puntualidad_min` y `t_*`, `choferes`, `empresas_bombeo`.
- `dispatch_status_log`: historial de estados del pedido.
- `activity_log`.

**Hace falta (una migración chica, `supabase/migrations/2026MMDDHHMM_fase3_despacho.sql`, que se puede correr dos veces y es compatible con main):**

| Cambio | Para qué | Qué pasa con lo cargado |
|---|---|---|
| `mixers.estado_desde timestamptz` + trigger `BEFORE UPDATE OF status` que lo pone en `now()` cuando cambia el estado | "Libre hace 24 min", "En taller desde ayer 16:10" | Se completa con `updated_at` (o `now()`). Nada más cambia |
| `scheduled_dispatches.suspendido_at`, `suspendido_por`, `suspendido_motivo_tipo`, `suspendido_motivo` | Suspender y reabrir sin tocar `status` (punto 7.1) | Quedan nulos: ningún pedido está suspendido |
| `scheduled_dispatches.cierre_motivo_tipo`, `cierre_motivo` | Motivo de finalizar y cancelar, para contarlo después (la 4a lo dejó pendiente: "cancelados y suspendidos, cuando exista el motivo estructurado") | Nulos. Los cancelados viejos tienen su motivo en Actividad. La columna vieja `cancelled_reason`, que nunca se usó, no se toca |
| CHECK de `*_motivo_tipo` en (`lluvia`, `obra_no_lista`, `falla_bomba`, `falla_camion`, `falla` (el "Falla" de finalizar, revisión del 20/10), `falta_material`, `pedido_cliente`, `obra_pidio_menos`, `otro`) | Que se pueda contar | — |
| Función `suspender_pedido(p_id, p_tipo, p_motivo, p_usuario)` | Bloquea el pedido (mismo orden que el despacho), valida que esté activo, graba las 4 columnas, `dispatch_status_log` y Actividad | — |
| Función `reabrir_pedido(p_id, p_usuario)` | Limpia la suspensión, deja el log y Actividad. No toca los viajes: los corre el front con el gerenciador si se elige | — |
| Función `finalizar_pedido(p_id, p_tipo, p_motivo, p_usuario)` | Lo que hoy hace el front (`status = completed` + la nota en observaciones) más el motivo, todo en la base y con el trigger de viajes de la fase 2 | La vieja puede seguir con su update hasta que se retire |
| Función `camion_volvio(p_mixer_id, p_fuente, p_usuario)` con fuente `manual` o `gps` | `available` + Actividad ("Volvió a planta · GPS"). No hace nada si ya estaba libre o en taller | — |
| **`registrar_despacho`:** una condición más, `IF v_pedido.suspendido_at IS NOT NULL THEN RAISE 'El pedido está suspendido: reabrilo para despachar.'` | Que nadie despache un pedido suspendido, ni desde la pantalla vieja | Se parte de `pg_get_functiondef` de producción (fase 2 + 0c-1). El diff tiene 3 líneas |

**Por qué columnas y no `status = 'suspended'`:** `status` lo filtran más de 15 consultas (Semana, Historial, Informes, el reporte de Concretus, los triggers de viajes). Un valor nuevo haría aparecer o desaparecer pedidos en pantallas que no se tocan en esta fase. Con columnas aparte, un pedido suspendido sigue siendo `scheduled` para todas ellas.

**Según la respuesta a la pregunta 1 (remito)** se podría sumar:
- **(recomendada, sin cambios de base)** el número sugerido se calcula en el front: el último remito numérico de la planta + 1;
- control de repetido **por planta** en vez de global, cambiando la condición de `registrar_despacho` a `plant_id = v_plant_id AND btrim(remito) = v_remito`. Hoy el control global obliga a tipear "755 HUDSON" cuando las dos plantas tienen un 755 (visto en la 4a);
- si se elige el correlativo del sistema: tabla `remito_numeracion (plant_id pk, proximo int, prefijo text)`, y `registrar_despacho` toma el número con `UPDATE … RETURNING` dentro de la misma transacción.

**No se toca:** `dispatches`, `viajes`, `viajes_gps`, el stock ni las probetas. Tampoco cambia ninguna firma de función que use main.

### 7.1 Permisos de las funciones nuevas
Mismo patrón que las de la fase 2 (`SECURITY DEFINER`, `search_path`, hora de Argentina, `GRANT EXECUTE` a anon y authenticated). Hasta la 0c-2 el permiso se controla en la pantalla, como todo lo demás.

## 8. Archivos

**Nuevos:**
- `lib/despacho.ts` (puro, sin React y sin Supabase):
  - `estadoCamion()` (punto 5);
  - `viajesDelDia()`: los guardados más los calculados de los pedidos sin viajes;
  - `atraso()`;
  - `contadoresDia()`;
  - `puntualidadPrimerCamion()`;
  - `remitoSugerido()`;
  - `validarEntrega()` y `armarPayloadDespacho()`, con las mismas reglas que hoy.
- `lib/__tests__/despacho.test.mjs` + script `test:despacho`.
- `components/despacho/despacho-tablero.tsx`: contenedor, carga de datos, refresco cada 30 s (base) y 60 s (GPS), solo con la pestaña visible.
- `components/despacho/columna-viajes.tsx`, `columna-camiones.tsx`, `columna-pedidos.tsx`, `contadores-dia.tsx`, `tabla-entregas.tsx`.
- `components/despacho/entrega-dialog.tsx`, `suspender-dialog.tsx`, `finalizar-dialog.tsx`, `usar-arrastre.ts` (hook de *pointer events*).
- La migración del punto 7.

**Se modifican:**
- `app/plantista/page.tsx`: el selector de pantalla.
- `components/plantista-view.tsx`: el distintivo "Suspendido", "Entregado" → `camion_volvio`, y nada más.
- `components/dispatch-scheduling.tsx` y `components/programacion-dia.tsx`: solo el distintivo "Suspendido".
- `app/api/gps/posiciones/route.ts`: `minutos_desde_salida` con `dispatch_date` en vez de `created_at` (por la hora corregida), y el estado "detenido fuera de planta con remito" pasa a "probable obra".
- `types/database.ts`: se regenera.

**Se reutilizan sin cambios:**
- `components/gerenciador-viajes.tsx`, `components/chofer-select.tsx`, `components/add-dispatch-dialog.tsx`, `components/motivo.tsx`;
- `lib/viajes.ts`, `lib/maestros.ts`, `lib/permisos.ts`, `app/api/remito/[id]`.

**Sin dependencias nuevas.**

## 9. Permisos (con la 0c-1)

| Acción en la pantalla | Permiso |
|---|---|
| Ver la pantalla | `despacho.ver` |
| Despachar (botón, tocar, arrastrar), Volvió a planta, Taller / Disponible | `despacho.cargar` (Taller: decidido, 13.4) |
| Suspender y reabrir | `despacho.cargar` (decidido, 13.3) |
| Finalizar con motivo | `despacho.cargar` (como hoy) |
| 👍 Confirmar | `programacion.cargar` en sus pedidos, `programacion.editar` en todos (regla 18.4) |
| Viajes (gerenciador), Editar total, Correr viajes al reabrir | `programacion.editar` (o `cargar` en los propios, como en la fase 2) |
| Cancelar pedido | `programacion.borrar` (solo gerenciales) |
| Carga despacho manual, humedad del acopio | Como hoy |

- **Consulta** (Joaquín) ve las tres columnas y la tabla, sin ningún botón y sin poder arrastrar.
- Sin permiso, el botón no aparece (regla de la 0c).

## 10. Criterios de aceptación

1. **"No se pierde nada."** Un despacho desde la pantalla nueva graba exactamente lo mismo que uno desde la vieja, con los mismos datos. Se comparan en `BEGIN … ROLLBACK`, como en las fases 1 y 2, todas las columnas de `dispatches`, `dispatch_materials`, movimientos, stock, probetas, pedido, viaje, camión y Actividad. Los datos de prueba son: agua extra, fibra, muestra con asentamiento, chofer, viaje elegido, m³ distintos del viaje, y un pedido sin viajes.
2. Con 5 pedidos y 11 viajes, la columna Viajes los ordena por hora de carga. Uno con la carga 15 min atrasada se ve en rojo con "Atrasado 15 min". Un pedido sin viajes guardados muestra sus viajes "calculados".
3. Despachar desde el botón, tocando (viaje → camión y camión → viaje) y arrastrando abre Entrega con el viaje y el camión correctos. Probado con el dedo en una tablet de 1024 × 768 y con el mouse.
4. Al despachar:
   - el viaje desaparece de la columna;
   - el camión pasa a "Yendo a obra · hace 0 min";
   - el pedido y los contadores suman;
   - aparece la fila en entregas;
   - "Despachar e imprimir" abre el remito.
5. Con GPS, un camión que vuelve a la geocerca de la planta queda «Volvió a planta · disponible (GPS)» solo, con Actividad. Sin GPS, muestra "estimado" y, pasada la vuelta + 30 min, "¿Volvió?". "Volvió a planta" lo deja disponible.
6. Suspender por lluvia:
   - esconde los viajes;
   - suma al contador "Suspendido";
   - deja el log y la Actividad con el motivo;
   - `registrar_despacho` lo rechaza, también desde la pantalla vieja.

   Reabrir lo devuelve, y "Correr los viajes" deja el próximo cargando a la hora actual.
7. Finalizar y cancelar guardan el motivo estructurado. Cancelar solo lo ve un gerencial.
8. Permisos: Titan y Felipe despachan, suspenden y finalizan; Joaquín no ve ningún botón; un operario sin `programacion.editar` no ve Editar total ni el gerenciador en pedidos ajenos.
9. Sin el interruptor, `/plantista` es la pantalla de siempre (capturas antes y después), salvo el distintivo "Suspendido".
10. `npm run test:despacho` cubre `estadoCamion` (cada fila del punto 3.2, GPS viejo y camión que no está en Wialon), los viajes calculados, el atraso, los contadores con suspendidos y cancelados, la puntualidad y el remito sugerido. Build limpio y `tsc` sin errores nuevos.

## 11. Riesgos

| Riesgo | Cómo se cubre |
|---|---|
| El plantista carga los remitos en tanda y más tarde (4a), así que los estados sin GPS quedan corridos | Campo "Salió a las", que se puede corregir. Con GPS el estado no depende del remito. La tablet en la planta es para cargarlo en el momento |
| Dos equipos (PC y tablet) despachan el mismo viaje a la vez | El motor bloquea el pedido y vuelve a buscar el viaje por número (fase 2). El segundo ve "El viaje 3 ya no está pendiente · se despacha como viaje 4" o "supera lo que falta" |
| Estado GPS equivocado (obra sin ubicar, camión parado en la calle) | Siempre se ve la fuente ("GPS" / "estimado" / "probable obra"). Se puede despachar igual con aviso. No se guarda ningún estado calculado, salvo la vuelta a planta |
| Que se marque solo "volvió" por un camión que pasa al lado de la planta | Solo cuando entra en la geocerca **después** de haber salido con un remito del día y con al menos 15 min de viaje; la misma regla de 400 m que usa la 4a |
| Arrastrar en la tablet es incómodo | No es obligatorio: el botón Despachar y el tocar hacen lo mismo |
| Cambio grande para gente de planta (condición de Bautista del 01/10) | Sale apagada (interruptor), convive con la vieja y se puede volver con un toque. Los campos del formulario son los mismos y con los mismos nombres |
| Otro agente cambia el cálculo de tiempos de la programación (`rebucret-tiempos`) | Esta fase **lee** los viajes guardados y usa `lib/viajes.ts` solo para los calculados. Se programa después de que ese cambio esté en main, y se rebasa |
| Las consultas de Wialon (60 s × pantallas abiertas) | `posiciones()` ya tiene caché en el servidor. Se pide solo con la pestaña visible |
| **Cuando los R de Canning pasen el 2200** (van por el 887 en octubre, unos 150–180 por mes: hacia mediados de 2027), la deducción por número (`_remito_tipo_de_numero`: 2201 en adelante = X) los va a confundir con X. Afecta a la pantalla de siempre (que no manda el tipo), al aviso "parece del otro tipo" y al control de repetido de los despachos sin tipo | **Propuesta:** (1) retirar la pantalla vieja antes (la nueva y el despacho manual siempre mandan el tipo) y, después del script de clasificación, que la base **exija** el tipo en todo despacho nuevo con remito; (2) limitar la deducción a los despachos anteriores a la publicación de esta fase (una fecha de corte en `_remito_tipo_de_numero`, o usar solo `remito_tipo` cuando no es nulo, que después del script son casi todos); (3) cambiar el aviso "parece del otro tipo" por la cercanía a las series de los últimos 30 días de cada tipo (el sugerido ya usa eso) en vez de un número fijo. Revisarlo cuando Canning llegue al 1800 |
| La 0c-2 (RLS) todavía no está | Igual que el resto: la pantalla respeta los permisos y la base frena lo grave (suspendido, remito repetido, restante) |

## 12. Preguntas para Bautista (con recomendación) — respondidas el 08/10, ver punto 13

1. **Remito: ¿número del sistema o del talonario?**
   - **Cómo es hoy:** el plantista tipea el número del talonario. La base no deja repetirlo **en todo el sistema**, y por eso aparecen cosas como "755 HUDSON" cuando Canning también tiene un 755. El PDF lo imprime como "RM2: 0099-000755", sobre hoja en blanco o sobre la pre-impresa.
   - **Opción A, correlativo del sistema por planta:** no se tipea nada, no hay errores de tipeo y el orden es perfecto. Pero solo sirve si el remito **no** tiene que coincidir con un número impreso por imprenta (talonario con CAI) y siempre se imprime desde el sistema.
   - **Opción B, talonario tipeado:** como hoy.
   - **Recomendación: B mejorada, ahora, sin cambiar la base:** el sistema **propone el número siguiente** del talonario de esa planta, el plantista lo confirma mirando el papel, y el control de repetido pasa a ser **por planta**. Si el contador confirma que el remito X no necesita numeración de imprenta, se pasa a A en una fase chica.
   - ¿Los dos talonarios (Hudson y Canning) son independientes?
2. **"Despachar e imprimir": ¿qué imprime?** Hoy abre una página para elegir "hoja en blanco con formulario" o "pre-impresa".
   - **Recomendación:** que cada planta tenga **una opción fija** (por ejemplo, Hudson: pre-impresa), así es un solo toque. Se guarda en el equipo, sin cambiar la base. ¿Cuál usa cada planta?
3. **Camión sin GPS (o sin señal): ¿cómo se marcan los estados?**
   - **Recomendación:** no pedirle nada al chofer. El estado se **estima** con los horarios del viaje (marcado "estimado") y el plantista solo toca **"Volvió a planta"** cuando lo ve llegar. Ya está previsto en la decisión del 29/09 ("salvo volvió a planta si hiciera falta").
   - Con los 5 camiones en B-Track, esto queda para cuando un equipo se queda sin señal o se suma un camión de afuera.
   - ¿Hay algún camión de terceros que despache sin GPS?
4. **¿Quién suspende y reabre?** Cancelar es solo gerencial (respuesta 18.1 de la 0c). Pero la lluvia se ve a las 7 en la planta, y suspender no borra nada y se deshace.
   - **Recomendación:** suspender y reabrir con `despacho.cargar` (Titan y Felipe). Cancelar sigue siendo solo gerencial.
5. **¿Queda disponible solo el camión que el GPS ve volver a la planta?**
   - **Recomendación:** sí. Queda en Actividad como "Volvió a planta · GPS". Es lo que arregla los camiones que quedaban "en ruta" para siempre.
6. **"Salió a las", que se puede corregir.**
   - **Recomendación:** dejarla, hasta 12 h para atrás dentro del mismo día. Así lo cargado en tanda queda con la hora real y la 4a cruza mejor.
   - ¿O preferís que no se pueda tocar, para obligar a cargar en el momento?
7. **Taller desde esta pantalla.** Hoy cambiar el estado del camión es de `flota.editar` (gerenciales), en Camiones.
   - **Recomendación:** dejar que quien despacha mande un camión a **Taller** y lo vuelva a **Disponible** desde acá (operativo, con Actividad). "Fuera de servicio" y las bajas siguen en Camiones.
8. **¿Cuándo se retira la pantalla vieja?**
   - **Recomendación:** cuando Titan y Felipe trabajen dos semanas seguidas solo con la nueva y vos des el OK.

## 13. Respuestas de Bautista (08/10/2026) — mandan sobre lo anterior

Si algo de los puntos 1 a 12 contradice esta sección, vale esta sección.

### 13.1 Remito: sigue el talonario tipeado, con número sugerido por serie (las series ahora son el tipo R/X: ver 14.4)

**Lo que muestran los datos** (relevamiento del coordinador, remitos desde el 15/09):
- Hay **dos series por planta**:
  - **Serie de 3 dígitos:** de ~680 a 841 en Canning y de 710 a 776 en Hudson. Las dos plantas usan el mismo rango. Como hoy el control de repetido es **global**, en Hudson le agregan "HUDSON" al número ("755 HUDSON").
  - **Serie de 4 dígitos:** de 3166 a 3200 en Hudson y de 3297 a 3305 en Canning.
- Dentro de cada serie los números son **casi siempre consecutivos**, pero se cargan desordenados.
- Hay **errores de tipeo** que juntan dos números: "780781", "783788", "318931903191".

**Decisión:** el operario tipea el número del talonario. No hay correlativo del sistema ni tabla de numeración. Lo que se agrega:

1. **Número sugerido** (en el front, `remitoSugerido()` en `lib/despacho.ts`, sin cambios de base):
   - Toma los remitos de la planta de los **últimos 30 días** y les deja solo los dígitos ("755 HUDSON" → 755).
   - Descarta los que parecen dos números juntos (más de 5 dígitos).
   - Arma las **series** de la planta agrupando los números que quedan a menos de 300 entre sí. Hoy salen dos: la de 3 dígitos y la de 4.
   - **Serie propuesta:** la del **último remito cargado** en esa planta (por hora de carga en el sistema, `created_at`).
   - **Número propuesto:** el **siguiente libre** de esa serie, o sea el mayor + 1, salteando los que ya existen. Se usa el mayor y no el último cargado porque se cargan desordenados.
   - Debajo del campo, un botón por serie para cambiar de talonario con un toque: "Serie 3200: **3201** · Serie 700: **777**".
2. **Repetido por planta** (en la base, punto 13.6):
   - Ya no es global: Hudson y Canning pueden tener el mismo número, así que no hace falta agregar "HUDSON".
   - Se comparan los **dígitos**: un "755" nuevo en Hudson choca con el "755 HUDSON" que ya existe en Hudson, y no choca con el 755 de Canning.
   - Es un **error que frena**: "Ya hay un despacho con el remito 755 en Hudson. No se puede cargar dos veces."
3. **Avisos que no frenan.** Se muestran en ámbar arriba de los botones y para despachar igual hay que tocar "Sí, el número está bien":
   - **Demasiados dígitos:** más de 5, o 2 o más dígitos de más que la serie más cercana. "¿No juntaste dos números? 780781 tiene 6 dígitos y los remitos de Hudson tienen 3 o 4."
   - **Salta mucho:** más de 20 por encima del mayor de su serie, o más de 50 por debajo. "Salta mucho: el último de esa serie en Hudson es 776."
   - **Fuera de toda serie:** no está a menos de 300 de ninguna serie. "No se parece a ningún talonario de Hudson (3 o 4 dígitos)."
   - Si se despacha igual, queda en Actividad con "Aviso de remito aceptado: salta mucho" (o el motivo que corresponda), para revisarlo en el cierre del día (Fase 5).
4. Lo que el operario escribe **se guarda igual que hoy**: no se le sacan letras ni ceros. Normalizar es solo para comparar y sugerir.

**Pregunta abierta para Bautista** (*respondida el 20/10: R con factura y X sin factura, ver 14*): ¿qué son las dos series? ¿Dos talonarios, por ejemplo uno viejo y uno nuevo, o razones sociales o puntos de venta distintos?
- Si son razones sociales o puntos de venta distintos, el remito PDF tendría que cambiar el encabezado y el prefijo según la serie. Hoy imprime siempre "RM2: 0099-000" + el número.
- Si es así, la serie pasaría a ser un dato del despacho, con una columna nueva, y no algo que se deduce del número. **No entra en esta fase hasta que conteste.**

**Ojo para la 4a:** el cruce GPS ↔ remito ordena los remitos de cada planta por número (`fase-4a.md`). Con dos series mezcladas, ese orden tendría que hacerse dentro de cada serie. Se anota como pendiente de la 4a; esta fase no la toca.

### 13.2 Imprimir: se elige en cada despacho y se recuerda por planta (**reemplazado por 14.6**: queda solo la pre-impresa)
- El formulario Entrega tiene, al lado de "Despachar e imprimir", la elección **"Imprimir en: Hoja preimpresa · Hoja en blanco"**.
- Viene marcada la **última elección de esa planta en ese equipo** (`localStorage`, clave por planta, sin cambios de base). La primera vez viene "Hoja preimpresa".
- "Despachar e imprimir" abre el PDF directo, sin la página intermedia de hoy:
  - preimpresa: `/api/remito/[id]?doc=remitox&fondo=0`, solo los datos;
  - en blanco: `?doc=remitox&fondo=1`, con el formulario.

  La ruta ya acepta los dos y no se modifica.
- "Despachar" a secas no imprime. El 🖨 de la tabla de entregas sigue abriendo la página de hoy, donde se puede elegir.

### 13.3 Suspender y reabrir: quien despacha
- `despacho.cargar` (Titan y Felipe, y los gerenciales), como estaba recomendado en 4.6 y 9.
- **Cancelar** sigue siendo `programacion.borrar` (solo gerenciales).

### 13.4 Taller desde esta pantalla: quien despacha
- Con `despacho.cargar` se puede "Mandar a taller" y "Disponible" desde la tarjeta del camión, con Actividad y sin motivo.
- Es una excepción escrita a la 0c, donde el estado del camión era `flota.editar`.
- En la pantalla Camiones sigue valiendo `flota.editar`. "Fuera de servicio" y las bajas siguen allá.

### 13.5 "Salió a las": se puede corregir y la hora real de carga queda guardada aparte
- "Salió a las" va a `dispatches.dispatch_date`, como en 4.5: hasta 12 h para atrás, dentro del mismo día y nunca más tarde que ahora.
- **La hora real en que se cargó el despacho en el sistema** ya se guarda sola en **`dispatches.created_at`** (`default now()`). El motor no la escribe y `editar_despacho` no la cambia: la usa como ancla del stock.
- Para que **no se pueda pisar** desde ningún lado, porque hasta la 0c-2 la tabla se puede escribir con la clave pública, se agrega el trigger `trg_dispatches_created_at_fijo`: `BEFORE UPDATE ON dispatches` que hace `NEW.created_at := OLD.created_at`. No hace falta una columna nueva.
- **Dónde se ve:**
  - en la tabla de entregas y en Historial, cuando "Salió a las" y la hora de carga difieren en más de 10 min: "Salió 07:12 · cargado 07:41";
  - en Actividad del despacho: "Salió a las 07:12 (corregida; cargado 07:41)".
- Los procesos que miden tiempos usan `dispatch_date`. `created_at` queda para auditoría y para el ancla del stock, como hoy.

### 13.6 Cambios en la base por estas respuestas (se suman al punto 7)
| Cambio | Qué pasa con lo cargado |
|---|---|
| `registrar_despacho` y `editar_despacho` (hoy el de la 0c-1): el control de repetido pasa a ser **por planta y por dígitos**. Candado `pg_advisory_xact_lock(hashtext('remito:' \|\| plant_id \|\| ':' \|\| dígitos))`. Repetido si existe otro despacho de **la misma planta** con los mismos dígitos (`regexp_replace(remito, '\D', '', 'g')`). Si el remito no tiene dígitos, se compara el texto como hoy. `editar_despacho` se excluye a sí mismo, como hoy | No se toca ningún remito. Antes de aplicar, el obrero lista **solo leyendo** los pares que ya chocarían por planta y dígitos. No frenan nada (el control es solo al cargar o editar), pero conviene que Bautista los vea. Ojo: un despacho viejo de un par así no se va a poder editar sin cambiarle el remito |
| Mensaje: "Ya hay un despacho con el remito N en [planta]. No se puede cargar dos veces." | La pantalla vieja y el despacho manual muestran el mensaje nuevo sin cambios en su código |
| Trigger `trg_dispatches_created_at_fijo` | Ninguno: solo impide cambiar `created_at` de ahora en adelante |

Las firmas de las funciones no cambian. Se parte de `pg_get_functiondef` de producción.

### 13.7 Lo que queda con la recomendación del arquitecto
- Pregunta 3 (camión sin GPS): estado estimado más "Volvió a planta", y "¿Volvió?" a la media hora de la vuelta estimada.
- Pregunta 5 (queda disponible solo con el GPS): sí, «Volvió a planta · disponible (GPS)» en Actividad.
- Pregunta 8 (retiro de la pantalla vieja): dos semanas de uso solo con la nueva y el OK de Bautista.

### 13.8 Criterios de aceptación que se suman
11. Con remitos de Hudson 770–776 y 3190–3200, y el último cargado de la serie 3200, se sugiere **3201** y el botón de la otra serie dice **777**. Con "755 HUDSON" en Hudson, un "755" nuevo en Hudson se rechaza y un "755" en Canning entra.
12. Con esas mismas series:
    - "780781" avisa "¿No juntaste dos números?";
    - "3260" avisa "salta mucho";
    - "12" avisa "fuera de toda serie";
    - "3187" no avisa, porque está dentro de la serie, que se carga desordenada.

    Despachar igual deja el aviso en Actividad.
13. La elección de impresión se recuerda por planta en el equipo, y "Despachar e imprimir" abre el PDF correcto (`fondo=0` o `fondo=1`).
14. Un despacho con "Salió a las" corregida conserva su `created_at`. Un `UPDATE dispatches SET created_at = …` no lo cambia (probado en `BEGIN … ROLLBACK`).

## 14. Respuestas de Bautista (20/10/2026) — mandan sobre lo anterior

Si algo de los puntos 1 a 13 contradice esta sección, vale esta sección.

Esta sección **reemplaza**:
- 13.1, en cómo se arman las series: ya no se deducen agrupando números, sale del tipo de remito;
- 13.2 entero: impresión;
- en 13.6, la regla del repetido: ahora es por planta **y tipo**.

**Sigue valiendo:**
- el talonario tipeado;
- los avisos de dígitos de más y de número que salta mucho;
- 13.3 a 13.5: suspender, taller y "Salió a las" con `created_at` fijo.

### 14.1 Lo que dijo Bautista
- **Hay dos tipos de remito, cada uno con su talonario por planta:**
  - **Remito R ("RM"), con factura:** es la serie que va por el 700/800.
  - **Remito X ("RM2"), sin facturar:** es la serie que va por el 3100–3300.
- **Impresión:** de las dos opciones de la pantalla del remito, solo se usa "Imprimir en hoja pre-impresa (solo datos)". **Queda solo esa.**
- **Con o sin factura:**
  - se tilda en el pedido;
  - se puede dejar fijo en la obra o en el cliente ("siempre con factura" / "siempre sin factura");
  - si nadie lo definió, el sistema le pregunta al operario al despachar, y **esa respuesta vale para todos los despachos de ese cliente en ese día**.

**Lo que muestran las plantillas del repo** (`public/templates/`, leídas con pdfjs):
- `remito-x.pdf` es el **Remito X de imprenta**: letra "X", "Nº 00002-", Rebucret S.A., y **"Del 00002-00003201 AL 00002-00008200" (impreso 06/2026)**.
- `remito-fiscal.pdf` es el talonario X **anterior**: "Del 00002-00002201 AL 00002-00003200" (impreso 05/2025).
- Por eso la serie X que va por el 3166–3305 es la numeración de imprenta: el número ya viene impreso en la hoja y el operario lo copia.
- Ojo: los X entre 2201 y 3200 son del talonario viejo. En los datos de abril a septiembre puede haber X en el 2000 (14.5).

### 14.2 Tipo de remito por despacho: cómo se resuelve
**Prioridad** (la primera que tenga valor):

| Orden | De dónde sale | Qué ve el operario en Entrega |
|---|---|---|
| 1 | **Pedido** (`scheduled_dispatches.remito_tipo`) | "Remito R · Con factura — lo dice el pedido" |
| 2 | **Obra** (`construction_sites.remito_tipo`) | "… — la obra va siempre con factura" |
| 3 | **Cliente** (`clients.remito_tipo`) | "… — el cliente va siempre con factura" |
| 4 | **Respuesta del día** de ese cliente (`remito_tipo_dia`) | "… — se respondió hoy para este cliente" |
| 5 | **Nadie lo definió** | Recuadro ámbar: **"¿Este remito va con o sin factura?"** con dos botones grandes: **Con factura · R** y **Sin factura · X**. Debajo: "Lo que elijas vale para todos los despachos de hoy de [cliente]". Sin contestar no deja despachar |

**Reglas:**
- La resolución vive en **una función de la base**, `remito_tipo_para(p_pedido_id, p_client_id, p_site_id, p_fecha)`, que devuelve `{tipo, origen}`. La usan la pantalla, para mostrarlo, y `registrar_despacho`, para validarlo. No se repite en cada pantalla.
- La respuesta del día vale **para el cliente, en las dos plantas**, durante el día de Argentina. Se graba **en la misma transacción del despacho**: si el despacho falla, no queda respondida y se vuelve a preguntar.
- **"Cambiar solo en este remito"**, cuando ya viene definido: con `programacion.editar` (Titan y gerenciales). Cambia solo ese despacho, con origen `manual`, y queda en Actividad. Felipe no lo ve.
- **Si la respuesta del día estuvo mal:** se corrige cargando el tipo en el pedido, la obra o el cliente, que tienen prioridad, o con "Cambiar solo en este remito". No hay una pantalla aparte para la respuesta del día.
- **Al cambiar el tipo en Entrega**, el número sugerido pasa al siguiente de ese tipo, salvo que el operario ya lo haya tipeado a mano.
- **Después de despachado,** el tipo se corrige desde Historial › Editar, con `historial.editar` (gerenciales) y motivo. `editar_despacho` acepta `remito_tipo` y vuelve a controlar el repetido.
- **Pantalla vieja y despacho manual:**
  - el despacho manual (`add-dispatch-dialog.tsx`) suma el mismo campo, con la misma resolución y la misma pregunta;
  - la pantalla vieja de Despacho diario **no se toca**: si no manda el tipo, la base lo resuelve, y si no hay nada definido lo deduce del número (≥ 3100 = X, el resto = R) con origen `numero`. Así sigue andando hasta que se retire;
  - el despacho por árido o de prueba no lleva tipo (queda nulo).

### 14.3 Dónde se marca en el pedido, la obra y el cliente
- **Pedido** (formulario de Semana): tres botones, **"Según obra o cliente (Con factura)"** · **"Con factura · R"** · **"Sin factura · X"**.
  - La primera opción guarda `null` y muestra entre paréntesis lo que va a salir. Si la obra y el cliente tampoco dicen nada: "Según obra o cliente (se pregunta al despachar)".
  - **Por defecto** viene la primera, así lo que diga la obra o el cliente sigue mandando.
  - Quién la cambia: la regla 18.4 de la 0c. `programacion.cargar` en los pedidos propios (al crear, siempre); `programacion.editar` en todos. Al editar un pedido ya cargado pide motivo (regla de la 0c).
- **Obra y cliente** (Clientes y el alta rápida): campo **"Remito"**, con las opciones "Se decide en cada pedido" (`null`, por defecto), "Siempre con factura (R)" y "Siempre sin factura (X)".
  - Al dar de alta: `clientes.cargar` (gerenciales, Felipe y Titan).
  - Para cambiarlo después: `clientes.editar` (gerenciales y Felipe), con motivo.
- **Despacho diario:** la tarjeta del pedido y la del viaje muestran la marca **R** o **X** cuando ya está definido.

### 14.4 Número sugerido y control de repetido (reemplaza 13.1 y la regla de 13.6)
- **Sugerido:** el **siguiente número de ese tipo en esa planta**. Se toma el mayor de los últimos 30 días de esa planta y ese tipo, + 1, salteando los que ya existen. Lo calcula `remitoSugerido(planta, tipo)` en `lib/despacho.ts`.
  - Debajo del campo: "Sugerido: el siguiente R de Hudson (el último fue 776). Controlalo con el papel."
  - Si el tipo no está definido, el número se sugiere recién cuando el operario contesta.
- **Repetido:** se frena si hay otro despacho de **la misma planta y el mismo tipo** con los mismos dígitos. Para los despachos viejos sin clasificar se usa el tipo deducido del número.
  - En `registrar_despacho` y `editar_despacho`, el candado pasa a `hashtext('remito:' || plant_id || ':' || tipo || ':' || dígitos)`.
  - Mensaje: "Ya hay un remito R 776 en Hudson. No se puede cargar dos veces."
- **Avisos que no frenan** (con "Sí, el número está bien" y registro en Actividad, como en 13.1):
  - dígitos de más ("780781");
  - salta mucho: más de 20 sobre el mayor de ese tipo, o más de 50 por debajo;
  - **parece del otro tipo:** un R ≥ 3100 o un X < 3100. Por ejemplo: "3260 parece un remito X (sin factura)";
  - **X ya usado en la otra planta:** la numeración X es de imprenta, un solo rango 00002-00003201 a 00008200, así que no debería repetirse entre plantas. "El X 3205 ya se usó en Canning. ¿No agarraste el talonario de la otra planta?" (pregunta 14.9 b).

### 14.5 Datos viejos: clasificar los despachos que ya existen
Es un script aparte, en dos archivos: **`scripts/fase3-clasificar-remitos-A-lectura.sql`** (solo lectura) y **`scripts/fase3-clasificar-remitos-B-escribe.sql`** (termina en ROLLBACK hasta el OK). No va en la migración. Se corre al publicar, después de la migración y con el OK de Bautista. Tiene dos partes:

**Parte A, solo lectura (se corre primero y se le muestra a Bautista):**
- **Cómo se lee cada remito:**
  - dígitos: `regexp_replace(remito, '\D', '', 'g')`;
  - letras: `regexp_replace(upper(remito), '[^A-ZÁÉÍÓÚÑ]', '', 'g')`. Por ejemplo, "755 HUDSON" → dígitos 755, letras HUDSON.
- **Regla propuesta:**
  - dígitos ≥ 3100 → **X**;
  - el resto → **R**;
  - entre 2201 y 3099 → **dudoso, con propuesta X** (talonario viejo, 14.1).
- **Resumen** por planta, tipo propuesto y mes: cantidad, mínimo y máximo. Sirve para ver de un vistazo que cada serie cae donde tiene que caer.
- **Dudosos**, que **no se clasifican solos**. Se listan con id, fecha, planta, remito, cliente, m³ y motivo:
  1. remito vacío o sin dígitos (fuera de los despachos por árido o de prueba, que quedan sin tipo);
  2. **más de 5 dígitos** (dos números juntos: "780781", "783788", "318931903191");
  3. 4 o 5 dígitos por debajo de 3100. Los de 2201 a 3099 se listan aparte, con la propuesta X;
  4. R por debajo de 600 o X por encima de 8200 (fuera de lo conocido);
  5. **letras que no sean "HUDSON"**, o "HUDSON" en un despacho de Canning. Puede ser uno de los 14 despachos cruzados que se reubicaron el 30/09;
  6. **repetidos después de normalizar** dentro de la misma planta y el mismo tipo (por ejemplo "755" y "755 HUDSON" en Hudson);
  7. despachos con pedido cuyo tipo, definido después, no coincide con el número. Solo aplica si al publicar ya se cargaron tipos en pedidos, obras o clientes.

**Parte B, la que escribe** (en una transacción, con el conteo antes y después):
- `UPDATE dispatches SET remito_tipo = <regla>, remito_tipo_origen = 'script' WHERE remito_tipo IS NULL AND NOT <dudoso>`.
- Los dudosos quedan **sin tipo** y se clasifican a mano desde Historial, con el filtro "Sin tipo" y Editar.
- Los dudosos 2201–3099 entran a la Parte B solo si Bautista confirma que son X.

**"HUDSON":** el texto del remito **no se reescribe**. Queda como se tipeó, porque es lo que está en el papel y en los mails de borrado. Normalizar es solo para comparar, sugerir y clasificar. Desde esta fase ya no hace falta agregarlo, porque el control es por planta.

### 14.6 Remito PDF: queda solo "pre-impresa (solo datos)"
- **"Despachar e imprimir"** abre directo `/api/remito/[id]?doc=remitox&fondo=0`, sin elegir nada.
- **La página del remito** (🖨 de Historial y de la tabla de entregas) deja **un solo botón**: "Imprimir en hoja pre-impresa (solo datos)". La vista de adentro también muestra `fondo=0`.
  - Se saca el botón "hoja en blanco (con formulario)".
  - El camino `fondo=1` se puede dejar en el código, sin enlace, o borrar. Lo decide el obrero; no lo usa nadie.
- **Qué cambia según R/X** (revisado en `app/api/remito/[id]/route.ts`):
  - hoy `fillRemitoX` imprime **siempre** el número como **"RM2: 0099-000" + remito**, en la columna derecha, con la etiqueta incluida aunque sea `fondo=0`;
  - para un **X** la etiqueta está bien, pero el número queda con un dígito menos que en el sistema de gestión: 3201 sale "0099-0003201" (7 dígitos) y la planilla de control de carga de la plantilla muestra "RM2 - 0099-00002590" (8). **Propuesta:** "RM2: 0099-" + número completado a 8 dígitos;
  - para un **R** la etiqueta "RM2" está mal: tendría que decir **"RM"**. Pero no se sabe el prefijo de los R, ni sobre qué hoja se imprimen: la hoja pre-impresa del repo es la de letra **X** y trae su propio número. Queda como **pregunta 14.9 a**. Hasta que conteste, el R se imprime igual que hoy y solo se cambia la etiqueta a "RM:".
  - El resto del contenido (cliente, CUIT, m³, fórmula, fecha) no depende del tipo.
- `doc=fiscal` (la plantilla del talonario X viejo) y `doc=control` no los usa ninguna pantalla. No se tocan.

### 14.7 Historial
- **Filtro "Tipo de remito":** Todos · R (con factura) · X (sin factura) · Sin tipo.
- **Columna "Tipo"** con la marca R o X, también en el Excel.
- **Totales** del filtro: "R 132 m³ · X 48 m³".
- Archivo: `components/dispatch-history.tsx`.

### 14.8 Modelo de datos (se suma al punto 7)
| Cambio | Para qué | Qué pasa con lo cargado |
|---|---|---|
| `dispatches.remito_tipo text CHECK (remito_tipo IN ('R','X'))`, nulo | El tipo de cada remito | Queda nulo hasta el script 14.5. Por árido y de prueba, nulo siempre |
| `dispatches.remito_tipo_origen text CHECK IN ('pedido','obra','cliente','dia','pregunta','manual','numero','script')` | Auditoría: de dónde salió el tipo | Nulo hasta el script |
| `scheduled_dispatches.remito_tipo`, `construction_sites.remito_tipo` y `clients.remito_tipo` (mismo CHECK, nulos) | Pedido, obra y cliente | Nulos = "no definido": nada cambia para lo cargado |
| Tabla **`remito_tipo_dia`** (`fecha date`, `client_id uuid`, `remito_tipo`, `respondido_por`, `respondido_at`, PK `(fecha, client_id)`) | La respuesta "una vez por cliente y por día" | Vacía |
| `remito_tipo_para(...)` y los cambios en `registrar_despacho` / `editar_despacho` | Resolver, validar, grabar la respuesta del día (14.2) y repetido por planta y tipo (14.4) | Las firmas no cambian. Si la pantalla vieja no manda el tipo, se resuelve o se deduce del número |

**Por qué una tabla para la respuesta del día y no deducirla de los despachos:**
- si se anula el despacho que la respondió, la respuesta no se pierde;
- queda quién respondió y a qué hora;
- la consulta es directa.

Es una tabla de 5 columnas, con los mismos permisos que `viajes`.

**Validación en `registrar_despacho`:**
- Si llega `remito_tipo` con origen `pedido`, `obra`, `cliente` o `dia` y no coincide con lo que resuelve la base, frena con "El tipo de remito cambió (ahora es Con factura). Actualizá la pantalla."
- Con origen `pregunta`, graba `remito_tipo_dia`. Si ya había otra respuesta para ese cliente ese día, frena con "Hoy ya se respondió Sin factura para este cliente".
- Con origen `manual`, lo acepta y lo deja en Actividad.

### 14.9 Preguntas para Bautista (cortas, con recomendación)
- **a) Remito R: ¿en qué hoja se imprime y con qué prefijo?** La hoja pre-impresa que tenemos es la del Remito **X** (00002-, del 3201 al 8200). ¿Los R se imprimen desde el sistema o salen de otro lado, por ejemplo con la factura? *Recomendación:* que nos pases una foto de un remito R. Mientras tanto, imprimir "RM:" + número igual que hoy.
- **b) ¿El talonario X es uno solo para las dos plantas?** La imprenta numera un solo rango, así que un X no debería repetirse entre Hudson y Canning. *Recomendación:* control por planta y tipo, como pediste, más el aviso "ese X ya se usó en la otra planta".
- **c) Los X del talonario viejo (2201–3200):** ¿se clasifican como X? *Recomendación:* sí. Te los mostramos en la lista de dudosos antes de grabar.
- **d) Resumen de m³ con factura y sin factura:** *Recomendación:* sí, y barato:
  - en la tabla de entregas del día ("con factura 23 m³ · sin factura 8 m³", ya está en la maqueta);
  - en los totales del filtro del Historial;
  - **por cliente** en la exportación para facturar del cierre del día (Fase 5), no ahora.
- **e) ¿El número de los X se imprime con 8 dígitos ("0099-00003201") como en el sistema de gestión?** *Recomendación:* sí. Hoy le falta un cero.
- **f) ¿Limpiamos el "HUDSON" de los remitos viejos?** *Recomendación:* no. Se deja como se tipeó y se compara solo por los dígitos.

### 14.10 Criterios de aceptación que se suman (reemplazan el 11 y el 13 de 13.8)
15. **Prioridad:**
    - pedido R, obra X → R;
    - pedido sin tipo, obra X → X;
    - sin pedido ni obra, cliente R → R;
    - nada definido → pregunta;
    - contestada X para el cliente C → el segundo despacho del día de C, en cualquier planta, viene X sin preguntar;
    - al día siguiente vuelve a preguntar.
16. Si el despacho que respondió falla (remito repetido), la respuesta no queda grabada.
17. Sugeridos con los datos de ejemplo: Hudson R 777 y X 3201; Canning R 842 y X 3306. "Ya hay un remito R 776 en Hudson" frena; un X 776 no choca con un R 776; "755" en Hudson choca con "755 HUDSON".
18. "Cambiar solo en este remito" solo aparece con `programacion.editar` y queda en Actividad con origen `manual`. Felipe contesta la pregunta, pero no cambia uno definido.
19. El script 14.5:
    - la Parte A no escribe;
    - la Parte B clasifica todo lo que no es dudoso y no toca los dudosos ni el texto del remito;
    - se prueba en `BEGIN … ROLLBACK`;
    - después de correrlo, el filtro "Sin tipo" del Historial muestra exactamente los dudosos.
20. "Despachar e imprimir" abre `doc=remitox&fondo=0`, y la página del remito tiene un solo botón. Un X sale "RM2: 0099-00003201".
21. La pantalla vieja de Despacho diario despacha igual que antes, y su remito queda con el tipo resuelto o deducido del número.

### 14.11 Camión que espera en la planta con el remito hecho (Bautista, 20/10/2026) — manda sobre 3.2, 13.7 y lo anterior
Que un camión espere 15 minutos o más en la planta con el remito hecho es normal (mezclando, sacando muestras, obra cerca). Por eso:
- **Con GPS, si el GPS todavía no lo vio salir de la planta**, la tarjeta dice **"Esperando en planta con remito · X min"** (desde la hora del remito). **No pregunta "¿Volvió?" ni queda disponible solo.**
- Queda **"Volvió a planta · disponible (GPS)"** solo cuando el GPS lo ve salir y volver, o **a mano** desde ⋮ › "Volvió a planta", con la confirmación: **"El camión AE402HE tiene el remito 886 y todavía no salió. ¿Marcarlo disponible igual?"** (botones "No, sigue esperando" y "Sí, está disponible").
- **Palabras (Bautista, 20/10):** en la pantalla, las confirmaciones, las tarjetas y Actividad no se usa "liberar"; se dice **"Volvió a planta · disponible"** (y "(GPS)" cuando lo marca el GPS).
- **Sin señal de GPS**, "¿Volvió?" aparece recién cuando pasó la **vuelta estimada** (salida + ida + descarga + vuelta) **más 30 min** de margen. Nunca por un tiempo fijo desde la salida.

## Hecho

### Obrero (20/10/2026) — rama `loop/fase-3-despacho`, sin push

Con las respuestas finales de Bautista del 20/10 a las preguntas de 14.9: (a) R y X en la hoja pre-impresa, "RM" el R y "RM2" el X, mismo formato; (b) repetido por planta y tipo + aviso de X usado en la otra planta; (c) del 2201 al 3200 son X; (d) sin resumen de m³ con y sin factura (queda el filtro por tipo del Historial); (e) X con 8 dígitos; (f) no se limpia el "HUDSON".

**Commits**
1. `docs(migracion-loop): especificación y maqueta de la fase 3` (lo que había dejado el arquitecto, sin cambios, + merge de main con los tiempos GPS).
2. `feat(fase3): migración … y script de clasificación` — `supabase/migrations/202610201200_fase3_despacho.sql` y `scripts/fase3-clasificar-remitos.sql`.
3. `feat(fase3): reglas del despacho en lib/despacho.ts con sus pruebas (test:despacho)`.
4. `feat(fase3): despacho diario en tres columnas … con remito R/X` — pantalla, cambios chicos en las pantallas de siempre, PDF, GPS, tipos.
5. `docs(migracion-loop): fase 3, hecho (obrero)`.
6. `fix(fase3): ajustes de la revisión` y su docs (ver "Ajustes de la revisión", abajo).

**Qué se hizo**
- **Pantalla nueva** en `/plantista` (`components/despacho/*`), solo para quien tiene `ve_funciones_nuevas`: selector "Pantalla nueva · en prueba / Pantalla de siempre" recordado en el equipo (`selector-pantalla.tsx`); para los demás `/plantista` es la de siempre. Barra (planta, ‹ día ›, hora, Carga despacho manual, Actualizar, Pantalla de siempre), aviso de muestras, 6 contadores, tres columnas con scroll propio (pestañas con menos de 900 px), leyenda de colores, tabla de entregas. Base cada 30 s y GPS cada 60 s, solo con la pestaña visible. Humedad del acopio como en la vieja (copia en `humedad-acopio.tsx` mientras convivan).
- **Viajes**: pendientes por hora de carga, rojo "Atrasado 15 min", ámbar "Ahora", marca R/X (o "R/X ?"), "calculado" para pedidos sin viajes guardados (motor de `lib/viajes`, sin grabar), "⏸ N viajes en pausa". Botón Despachar, tocar viaje → camión (y al revés) y arrastre con pointer events (`usar-arrastre.ts`: manija ⠿, mouse con 8 px, dedo con 280 ms).
- **Camiones**: los 5 activos, estado con `estadoCamion()` (GPS / sin GPS · estimado / a mano), tiempo en el estado, ⏱ ciclo, chofer del último despacho de hoy, "¿Volvió? Volvió a planta", ⋮ Mandar a taller (nota opcional) / Disponible / Volvió a planta / Ver en el mapa. Con GPS, al verlo en la planta después de un viaje de 15 min o más llama a `camion_volvio(…, 'gps')` (Actividad "Volvió a planta · fuente GPS").
- **Pedidos**: tarjeta con bomba, fibra, entregado/total, R/X, 👍, puntualidad del primer camión (real de la 4a, en vivo con GPS, estimada o "1.er camión carga"), próximo viaje; suspendidos con Reabrir; completos/finalizados plegados; cancelados con "Ver cancelados". ⋮ con 👍, Viajes (gerenciador), Editar total, Ver entregas, Suspender, Reabrir (con "Correr los viajes: el próximo carga a las …" o dejarlos), Finalizar con motivo, Cancelar (solo `programacion.borrar`).
- **Entrega**: los mismos campos de hoy + viaje, "Salió a las" y tipo de remito (lo que diga la base con su origen; si nadie lo definió, "¿Este remito va con o sin factura?"; "Cambiar solo en este remito" con `programacion.editar`). Número sugerido por planta y tipo, repetido y los 4 avisos con "Sí, el número está bien" (queda en Actividad). Despacha con `registrar_despacho`; rearma los pendientes si cambiaron los m³; actualiza la pantalla sin esperar; "Despachar e imprimir" abre `doc=remitox&fondo=0`.
- **Pantallas de siempre**: distintivo "Suspendido · motivo" en Despacho (sin Despachar), Semana y Día; "Entregado" llama a `camion_volvio`. Formulario del pedido: Remito "Según obra o cliente (…)" · "Con factura · R" · "Sin factura · X". Clientes, obras y altas rápidas: "Remito: Se decide en cada pedido / Siempre con factura (R) / Siempre sin factura (X)". Despacho manual: misma resolución y misma pregunta. Historial: filtro "Tipo de remito" (todos · R · X · Sin tipo), columna Tipo (también en el Excel), edición del tipo con motivo y "Salió 07:12 · cargado 07:41".
- **Remito PDF**: R → "RM: 0099-00000776", X → "RM2: 0099-00003201" (dígitos sin letras ni ceros de adelante, a 8). La página del remito tiene un solo botón (pre-impresa); `fondo=1` queda en el código sin enlace.
- **`/api/gps/posiciones`**: despachos y minutos por `dispatch_date` (no `created_at`); suma `probable_obra` y `planta_id`.

**Migración `202610201200_fase3_despacho.sql`** (NO aplicada; probada dos veces seguidas dentro de un mismo `BEGIN … ROLLBACK`, dos corridas completas, 48/48 controles; verificado después que en producción no quedó nada):
- `mixers.estado_desde` + trigger; `scheduled_dispatches.suspendido_*`, `cierre_*`, `remito_tipo`; `construction_sites.remito_tipo`, `clients.remito_tipo`; `dispatches.remito_tipo` / `remito_tipo_origen` (CHECKs); tabla `remito_tipo_dia`; `trg_dispatches_created_at_fijo`.
- Funciones: `remito_tipo_para`, `suspender_pedido`, `reabrir_pedido`, `finalizar_pedido`, `camion_volvio` y auxiliares `_remito_digitos`, `_remito_tipo_de_numero`, `_remito_repetido`, `_motivo_texto`. `registrar_despacho` y `editar_despacho` desde `pg_get_functiondef` de producción del 20/10, mismas firmas.
- **Datos cargados**: `estado_desde` se completa con `updated_at`; todo lo demás queda nulo (ningún pedido suspendido, nada "definido" R/X). No se reescribe ningún remito.
- **Compatibilidad con main** (probado): las llamadas de la pantalla de siempre (con viaje, chofer, agua, fibra y muestra; pedido sin viajes), del despacho manual, del despacho por árido y el `editar_despacho` de Historial graban exactamente lo mismo en `dispatches`, `dispatch_materials`, `stock_movements`, stock, probetas, pedido, viajes, camión, `dispatch_status_log` y Actividad. Lo único nuevo: la clave "Tipo de remito" en Actividad, `remito_tipo*` en el despacho y en lo que devuelve la función, y el mensaje de repetido ("Ya hay un remito R 776 en Hudson. No se puede cargar dos veces.").
- Controles en ROLLBACK: repetido por planta y tipo ("88755" choca con "88755 HUDSON", no con Canning ni con un X; "877" choca con "0877"; uno viejo sin tipo vale por su número), prioridad pedido > obra > cliente > día, respuesta del día que no queda si el despacho falla, vale en la otra planta y desde la pantalla vieja, se vuelve a preguntar al día siguiente, otra respuesta el mismo día frena, origen que no coincide frena, manual entra y queda en Actividad, aviso aceptado / "Salió a las … (corregida; cargado …)" / "Pantalla" en Actividad, suspender (status no cambia, log y Actividad, los viajes no se tocan, `registrar_despacho` lo rechaza), reabrir, finalizar (nota igual a la de siempre, motivo, viajes cancelados), `camion_volvio` (manual, GPS con 15 min, no toca libres ni taller), `created_at` fijo, `editar_despacho` con tipo y repetido.

**Verificaciones**
- `npx tsc --noEmit`: 17 errores, los mismos 17 de main (comparado archivo por archivo con un checkout de `origin/main`).
- `npx next build --webpack` con variables de relleno: compila; `.next` borrado.
- `npm run test:despacho` 24/24 (estados del camión: cada fila de 3.2, GPS viejo, camión fuera de Wialon, ¿Volvió?, volvió a planta · disponible por GPS; viajes calculados y en pausa; atraso; contadores con suspendidos y cancelados; puntualidad; tipo por número; sugeridos Hudson R 777 / X 3201, Canning R 842 / X 3306; repetido; avisos 780781 / 3260 / 12 / 3187 / X de la otra planta; número impreso; validación; jsonb). `npm run test:gps` 44/44, `npm run test:sesion` 21/21.
- No se usó el navegador (regla): la pantalla no se miró en vivo ni en tablet. Hay que probarla en el preview.

**Script de clasificación (datos reales, Parte A en solo lectura; Parte B probada en ROLLBACK)**
- *(Primera corrida; los números actualizados, con los motivos nuevos, están en "Ajustes de la revisión".)* 1.421 despachos con remito (sin contar árido/prueba). La Parte B clasificaría **1.053**: **552 R** y **501 X**; quedan **368 dudosos** "Sin tipo" (= exactamente los de la Parte A).
- Series que caen bien: Hudson R 710–781 (sep–oct) y X 3122–3241 (ago–sep); Canning R 2–883 (desde el 08/07/2026, empezó en 0002) y X 2228–3307 (abr–oct).
- Dudosos por motivo: repetidos en la planta y el tipo 194 · letras que no son HUDSON 125 · más de 5 dígitos 28 · 4 o 5 dígitos por debajo de 2201 10 · X por encima de 8200 4 · HUDSON en Canning 3 · R < 600 antes de julio 2 · sin dígitos 2. **129 de los 368 son del cliente "HISTÓRICO"** (carga del historial 2025, con "N° 2004", "N°3091-3092", 0 m³).
- Casos para mirar: "R 3110" … "R 3120" en Hudson (jun–jul, con número de X pero escritos con R), "3103-A", "3112-C", "3113-C", "3070-2", "3206-1", "3216-17", pares "2958-2959"… (dos remitos en uno), "12354"/"12355", "10000000000000000000000000000000", "Richard La Huella", "HUDSON" (06/10, Hudson, sin número), "3123/3124/3125 Hudson" cargados en Canning el 10/08, "235" en Canning el 10/04.
- Repetidos: 114 números repetidos el mismo día (sobre todo Canning abril–junio: el mismo remito en 2 o 3 filas) y 14 en días distintos; más los pares HISTÓRICO 2025 ↔ 2026 con el mismo número X. Pares que ya chocarían por planta + tipo + dígitos: **129** (128 en Canning, 1 en Hudson: "3129 Hudson" 10/08 y 19/08). No frenan nada (el control es solo al cargar o editar, y `editar_despacho` solo lo vuelve a mirar si cambian remito, planta o tipo).
- Ojo: en **Hudson los X saltaron a 4202–4207 desde el 15/10** (¿talonario nuevo?) y hay un "2403HUDSON" el 19/10. Con eso el sugerido X de Hudson hoy es 4208 y un 3201 avisaría "mucho más bajo".

**Desvíos de la especificación y por qué**
1. **Límite R/X = 2201** en todos lados (deducción del número, "parece del otro tipo", script), no 3100 como decían 14.2 y 14.4: es la respuesta (c). Los 2201–3099 entran directo a la Parte B como X.
2. **Dígitos sin ceros de adelante** para comparar, sugerir y clasificar ("0841" = 841): Canning tipeó la serie R con cero adelante desde julio. El texto no se toca.
3. **Más de 5 dígitos → sin tipo** al deducir (la pantalla vieja con "780781" deja el despacho "Sin tipo"); en el control de repetido, si de un lado no se sabe el tipo, choca igual (por las dudas).
4. **Regla 4 del script**: "R por debajo de 600" solo antes del 01/07/2026 (si no, se iban a dudosos ~250 R buenos de Canning, que arrancó en 0002).
5. **`editar_despacho`** controla el repetido solo si cambian los dígitos del remito, la planta o el tipo efectivo (ver "Ajustes de la revisión") (así un despacho viejo de un par repetido se puede seguir editando en otra cosa).
6. **"Salió a las" en Actividad** solo para despachos de pedido (el despacho manual manda siempre las 12:00 del día).
7. Se agregó la clave opcional **`pantalla`** al jsonb (Actividad "Pantalla: Despacho en tres columnas") para medir el retiro de la vieja (6.4).
8. **`/api/gps/posiciones`** mantiene el estado `detenido` y suma `probable_obra` (cambiar el estado rompía Logística › En vivo).
9. **Taller / Disponible** con un update de `mixers.status` + Actividad desde la pantalla (sin función de base); la nota queda en Actividad (`Nota`) y la tarjeta la lee de ahí. **Cancelar** también es un update (como hoy) que suma `cierre_motivo_tipo` / `cierre_motivo`.
10. **"Despachar e imprimir"** abre la pestaña en el mismo clic y le carga el PDF al terminar (si no, el navegador la bloquea); si igual se bloquea, aparece el aviso con "Imprimir remito".
11. El tipo de remito en el pedido, la obra y el cliente **se manda solo si cambió**, así esos formularios siguen andando si la migración todavía no está aplicada.
12. **Puntualidad en vivo con GPS**: el GPS no da la hora de llegada; si lo ve en la obra antes de la tolerancia dice "En obra (GPS) · a tiempo", si no, neutro.
13. **Consulta** ve el ⋮ del pedido solo con "Ver entregas" (un filtro, no graba nada).

**Riesgos y pendientes para publicar**
- **Aplicar la migración antes del merge** (con el OK de Bautista). El preview usa la base de producción: sin la migración, la pantalla nueva no puede suspender, reabrir, finalizar ni saber el tipo de remito (las pantallas de siempre siguen andando igual).
- **Verificar con una impresión de prueba de un R** sobre la hoja pre-impresa ("RM: 0099-00000776", respuesta a): la posición es la misma que la del X.
- Correr la **Parte A** (`fase3-clasificar-remitos-A-lectura.sql`), mostrársela a Bautista, y recién con su OK la **Parte B** (`…-B-escribe.sql`, cambiando su ROLLBACK final por COMMIT). Los 373 dudosos se clasifican a mano desde Historial › "Sin tipo".
- Probar en el preview, con el dedo en la tablet (1024 × 768) y con el mouse: los tres caminos de despacho, el arrastre, las pestañas y el aviso de camión no libre. No se pudo mirar en vivo.
- Hasta que se carguen tipos en obras y clientes, la pantalla nueva va a preguntar "¿con o sin factura?" en el primer despacho de cada cliente del día.
- La pantalla vieja sigue despachando sin elegir tipo: lo resuelve la base o lo deduce del número.
- **R de Canning por encima del 2200** (mediados de 2027): ver la fila nueva en el punto 11 (riesgos) con la propuesta.

### Ajustes de la revisión (20/10/2026) — "aprobado con cambios menores"

**Regla nueva para las pruebas en la base** (la primera corrida tuvo bloqueadas despachos, pedidos y camiones unos 30 s): cada prueba en una transacción **corta** con `SET LOCAL lock_timeout = '2s'` y `SET LOCAL statement_timeout = '60s'`, que falla si no consigue el candado y se reintenta más tarde. Las pruebas de la migración quedaron en **9 transacciones de 2,4 a 4,8 s** (datos de prueba en una sola consulta, camiones y chofer de prueba propios: no se toca ningún camión real). La Parte A del script se prueba sin la migración (funciones auxiliares en `pg_temp`, columnas nuevas como nulas): no toma ningún candado de escritura. La Parte B, con la migración, en una transacción de 1,6 s. Los tipos se regeneraron igual (3,8 s). Ojo: en esta tanda, una primera prueba de la Parte B llegó al `statement_timeout` (60 s, con las tablas tomadas) porque el `UPDATE … FROM` recalculaba los dudosos por cada fila; se arregló con los CTE `MATERIALIZED` (ahora 1,6 s) y quedó anotado en el script.

**Cambios**
1. **`editar_despacho`**: el repetido se vuelve a controlar solo si cambian los dígitos, la planta o el **tipo efectivo** (`coalesce(tipo, el que dice el número)` antes y después). Así los dudosos "repetidos" se pueden clasificar desde Historial. Probado con el par real "3129 Hudson" (10/08 y 19/08): los dos pasan a X sin error; pasarlo a R controla y entra (no hay otro R 3129).
2. **Script en dos archivos**: `scripts/fase3-clasificar-remitos-A-lectura.sql` (solo SELECT, `BEGIN READ ONLY` … `ROLLBACK`) y `scripts/fase3-clasificar-remitos-B-escribe.sql` (termina en **ROLLBACK**, con el aviso de cambiarlo por COMMIT recién con el OK). Los dos con los timeouts.
3. **El GPS lo marca «Volvió a planta · disponible» solo si lo vio afuera**: la pantalla recuerda (en el equipo) la hora en que el GPS vio al camión **fuera** de la planta después de la salida de su despacho (`vistoFueraDePlanta`), y recién si después lo ve en una planta lo marca «Volvió a planta · disponible (GPS)», mandando esa hora a `camion_volvio(…, 'gps', …, p_visto_fuera_at)`. La base no lo marca disponible por GPS sin esa hora, si es anterior a la salida o si el despacho tiene menos de 15 min. Si salió con remito y el GPS nunca lo vio afuera, la tarjeta dice "En planta con remito" y pregunta "¿Volvió?" (se marca disponible a mano; desde el ajuste 14.11 dice "Esperando en planta con remito" y no pregunta). Pruebas nuevas en `test:despacho` y en la migración.
4. **Script, motivos nuevos**: "2b. dos grupos de números" (`remito ~ '\d[^0-9A-Za-z]+\d'`: "0073-2", "0051-2", "3070-2", "3206-1") y "6b. salta mucho dentro del mes" (no hay otro remito de esa planta y ese tipo, en el mismo mes, a ±50: "2403HUDSON" del 19/10, "755" de Canning del 02/10, "2228" de Canning del 30/07, "3241" de Hudson del 10/08).
5. **Candado del remito**: clave planta + dígitos, sin el tipo (en `registrar_despacho` y `editar_despacho`).
6. **"Salió · cargado"** solo en despachos de pedido (tabla de entregas e Historial): el manual se carga con las 12:00 del día.
7. **"Falla" al finalizar** tiene su propio valor (`falla`, en los CHECK, `_motivo_texto` y `finalizar_pedido`), ya no se graba como falla de bomba.
8. **Riesgo de los R de Canning por encima del 2200**: anotado en el punto 11 con la propuesta.
9. La pantalla pide `remito_tipo_para` con `p_fecha` cuando se mira otro día.

**Verificaciones (después de los ajustes)**
- Migración: dos corridas completas, **51/51** controles cada una, la primera transacción aplica la migración dos veces seguidas. Nada quedó en producción.
- `tsc`: los mismos 17 errores de main. Build con `--webpack`: compila (`.next` borrado). `test:despacho` **27/27**, `test:gps` 44/44, `test:sesion` 21/21.
- Script con los datos de hoy (1.425 despachos): la Parte B clasificaría **1.052** (**554 R**, **498 X**) y quedan **373 dudosos** (= los de la Parte A; la B no toca ninguno). Por motivo: repetidos 193 · letras que no son HUDSON 125 · más de 5 dígitos 28 · 4 o 5 dígitos por debajo de 2201 10 · dos grupos de números 4 · salta mucho dentro del mes 4 · HUDSON en Canning 3 · R < 600 antes de julio 2 · X > 8200 2 · sin dígitos 2. Las series quedan limpias: Hudson R 710–781 y X 3122–3200 (ago–sep) / 4202–4207 (oct); Canning R 2–887 (jul–oct) y X 2634–3307 (abr–oct).

### Ajuste del 20/10/2026 (tarde) — camión esperando en planta con remito (14.11)
- `lib/despacho.ts` (`estadoCamion`): con GPS, remito de hoy y el GPS sin haberlo visto salir → "Esperando en planta con remito" (`esperandoConRemito`), con el tiempo desde el remito, sin "¿Volvió?" ni marcarlo disponible, por más que pase el rato (antes, a los 15 min preguntaba "¿Volvió?"). Queda «Volvió a planta · disponible (GPS)» solo cuando el GPS lo vio afuera y vuelve (sin cambios en la base: `camion_volvio` ya exigía `p_visto_fuera_at`). Sin GPS, "¿Volvió?" a la vuelta estimada + 30 min (`MARGEN_VOLVIO_MIN`).
- Pantalla: ⋮ › "Volvió a planta" de un camión esperando abre la confirmación "El camión … tiene el remito … y todavía no salió. ¿Marcarlo disponible igual?" (No, sigue esperando · Sí, está disponible).
- Sin cambios: el camión "En ruta (sin despacho de hoy)" (quedó en ruta de otro día, sin horarios para estimar) sigue preguntando "¿Volvió?".
- Pruebas: `test:despacho` 27/27 (esperando a los 7 min, 25 min y 1 h 53 sin ¿Volvió?; sin GPS a vuelta + 29 no pregunta y a + 31 sí; viaje largo sin pregunta a los 15 min ni a la hora). `tsc` igual a main, build OK, `test:gps` y `test:sesion` OK. No se tocó la base.
- **Palabras (20/10, Bautista):** "liberar" se reemplazó por **"Volvió a planta · disponible"** en la confirmación ("¿Marcarlo disponible igual?", "No, sigue esperando" / "Sí, está disponible"), los avisos, la leyenda y Actividad de `camion_volvio` (`Estado: Volvió a planta · disponible (GPS)` o `(a mano)`, en vez de "en ruta → disponible" + "Volvió a planta: fuente GPS").
