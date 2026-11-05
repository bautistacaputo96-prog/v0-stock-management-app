# Vista Día unificada, "Guardar y confirmar", mail diario del armado y resumen para WhatsApp

Estado: **propuesta del arquitecto (05/11/2026), pendiente de aprobación de Bautista.** Sin código.
Base: rama `feat/camiones-por-planta` (bloque "Camiones por planta", migración `202611041900_reparto_camiones` ya
aplicada). Leer antes: [`2026-11-04-camiones-por-planta.md`](2026-11-04-camiones-por-planta.md) y
`docs/migracion-loop/README.md` (principios: nada paralelo, lógica en un solo lugar, datos viejos intactos).

---

## 0. Qué hay hoy (relevado en el código de la rama)

| Pieza | Dónde | Qué hace | Problema para este pedido |
|---|---|---|---|
| Bloque "Camiones por planta" | `components/reparto-camiones.tsx` (`useRepartoDia` + `RepartoCamiones`) | Las **dos plantas**: resumen, tabla (Pedido, Planta, Camiones, Termina, Estado), +1/+2, traslados, noche, diagrama, editor, "Guardar reparto". Motor `lib/reparto.ts` → `armarDia()`. | La tabla no deja cambiar hora ni método. La carga de datos vive en el hook (navegador): el servidor no la puede usar para el mail ni para WhatsApp. |
| Barra "Ordenar el día" + "N de M pedidos confirmados" | `programacion-dia.tsx` | Por **una** planta (la del selector). | Duplica lo que el bloque ya calcula. |
| Tarjetas Pedidos / Viajes / Primera carga / Última vuelta / Camiones usados | `programacion-dia.tsx` → `plan` = `planificar()` de **una** planta | Otro motor: una planta, sin traslados ni reparto. | **Pueden contradecir al bloque** (otros camiones, otro fin). |
| Gráfico de demanda | `programacion-dia.tsx` | Camiones por media hora de **una** planta. | El diagrama y el Estado del bloque ya dicen dónde faltan camiones. |
| Lista "Pedidos del día" | `programacion-dia.tsx` | Hora editable + Guardar (`guardarHora` → `regenerarViajesPedido`), Bomba/Directo (`guardarMetodo`), Armar viajes / Viajes (N) (gerenciador), 👍 Confirmar (`confirmarPedido`), texto de flota, tiempos y su fuente, empresa de bomba, suspendido, obra sin ubicar, sugerencia de m³, choques de camión, y a la derecha el resultado de `plan` (otro motor). | Hora, método, termina y estado repetidos (y con otro motor). |
| "Plan del día propuesto" + "Guardar plan del día" | `programacion-dia.tsx` → `guardarPlanDelDia()` | Con reparto usa `propuestaConReparto` (motor del bloque) **solo para la planta elegida**; guarda con `guardarViajes(…, "plan_dia")` + Actividad por pedido. | Por planta; el bloque es de las dos. |
| "El día de cada camión" | `programacion-dia.tsx` | Grilla de **una** planta con `plan` (carga/ida/descarga/vuelta y uso %). | Duplica el diagrama del bloque (que tiene las dos plantas y los traslados). |
| Dónde amanece cada camión | `useRepartoDia` → `amanece` = `reparto_camiones(día anterior).duerme_plant_id` | Si no se guardó el reparto de ayer, "a confirmar". | No mira el GPS. |
| GPS | `lib/wialon.ts` (`posiciones()`, servidor, token en `integraciones`), `app/api/gps/posiciones/route.ts` (cruce unidad ↔ mixer por `gps_unit_id` o patente, planta más cercana, `estadoGps` de `lib/gps-vivo.ts`, último despacho de hoy) | Solo con sesión; lo usan Logística y Despacho. | El cruce está dentro de la ruta: el mail no lo puede reusar. |
| Mails | `lib/control-ingresos/servidor.ts` (`mailsDe` por nombre en `app_users`, fetch a Resend, From `REPORTE_CALIDAD_FROM`) y 5 copias más del fetch a Resend | — | `mailsDe` es privada. |
| Crons | `vercel.json` (Hobby: uno por día por ruta, corre dentro de la hora) y pg_cron `zomatik-np-pasada` cada 10 min con `Bearer` del secreto `cron_secret` en Vault; `lib/cron.ts` `esLlamadaDeCron()` | — | Para 17:00 en punto y el reenvío hace falta pg_cron. |
| WhatsApp diario de producción | Lo manda **Concretus** (otro repo), cron 18:00 de domingo a viernes, leyendo la base de Rebucret (`lib/rebucret.ts` de Concretus) | Tiene una parte "programación de mañana". | Concretus no puede correr `lib/reparto.ts`: necesita los datos ya calculados. |
| Hora del día en el motor | `lib/viajes.ts` `inicioDelDia()` usa `setHours(0)` **local**; `textoChoque`, `textoConMenosCamiones` y `avisosSuperposicion` usan `getHours()` local | En el navegador (Argentina) anda. | **En Vercel la hora local es UTC: el motor arma el día corrido 3 horas.** Hay que fijarlo a Argentina antes de usarlo en el servidor. |
| Usuarios | `app_users`: Juan Oreguy tiene mail; **Fernando Maldonado no** (Bautista lo carga con un script suyo). | — | Se manda por nombre y se avisa si falta. |

**Conclusión:** todo lo que se pide ya se calcula en `lib/reparto.ts`. Falta (1) que la vista Día muestre **un solo
cálculo** (el del bloque) y saque lo que lo contradice, (2) poder mover hora y método en la tabla y guardar todo con
un botón reusando las acciones que ya existen, y (3) correr el mismo cálculo en el servidor para el mail y para el
WhatsApp de Concretus. **No se hace un motor nuevo ni una pantalla nueva.**

## 1. Objetivo

Que quien programa arme y deje cerrado el día siguiente en **un solo bloque** (las dos plantas, hora y método
editables, un botón para guardar y confirmar), que Fernando reciba a las 17:00 el armado del día siguiente **igual al
que ve la pantalla**, con los camiones arrancando donde el GPS dice que están (y una actualización si algo cambia
después), y que el WhatsApp diario de las 18:00 tenga los mismos números por pedido.

## 2. Alcance y fases

Todo detrás del interruptor `ve_funciones_nuevas`, como el bloque. Sin el interruptor la vista Día queda como hoy.

| Fase | Qué | Base de datos | Tamaño |
|---|---|---|---|
| **A. Vista Día unificada** | Carga del día en `lib/` (la usa el hook y, en la B, el servidor); tabla con **Llega a obra** y **Método** editables que recalculan en el momento; "Guardar y confirmar"; "Ordenar el día" dentro del bloque; se saca lo duplicado; link `?vista=dia&fecha=`. | **Ninguno** | M–L |
| **B. Mail del armado y resumen para WhatsApp** | Hora de Argentina fija en el motor; mail 17:00 a Fernando con copia a Juan; toma del GPS ("dónde amanecen"); reenvío con antirrebote; "Ver el mail" y "Enviar ahora"; `GET /api/reparto/resumen` con los datos por pedido para el WhatsApp de Concretus (4.10). | 2 tablas, 1 función nueva, 1 función ajustada, 1 job de pg_cron (sección 5) | L |

Se programan en ese orden y cada una se ve en el preview antes de seguir. La A no necesita nada de la base.

### 2.1 Fuera de alcance
- Cambiar las reglas del motor (`REGLAS_REPARTO`, pasos 1 a 5) o el gerenciador (fase 2 de la spec del 04/11).
- La fase 3 del reparto (avisos en `/plantista`).
- PDF o imagen del diagrama; mail a choferes; responder o editar desde el mail.
- **El cambio en Concretus** (llamar a la ruta y armar el texto del WhatsApp de las 18:00): es otro repo y otro
  pedido; acá queda especificado qué recibe (4.10).
- Elegir destinatarios desde la pantalla (quedan en constantes, como el control de MP).
- Pasar los otros 5 envíos por Resend al helper nuevo (solo se pasa `control-ingresos`, que usa `mailsDe` igual).
- RLS (sigue la 0c-2).
- Recalcular el armado con el GPS durante el día (sigue siendo un botón de la fase 3).

---

## 3. Fase A — Vista Día unificada

### 3.1 Qué se saca, qué se integra y qué queda (con el interruptor)

| Hoy | Decisión | Dónde queda la función |
|---|---|---|
| Barra "Ordenar el día" + "N de M confirmados" (una planta) | **Se integra** | En el encabezado del bloque: botón **Ordenar el día** y "👍 0 de 3 confirmados" (las dos plantas). |
| Tarjetas Pedidos / Viajes / Primera carga / Última vuelta / Camiones usados | **Se saca** (otro motor, contradice) | Una línea debajo del resumen del bloque: "3 pedidos · 140 m³ · 17 viajes · primera carga 07:00 · última vuelta 18:33" (de `resultado`). Viajes y comienzo por pedido quedan como columnas de la tabla. |
| Gráfico de demanda | **Se saca** (pregunta 5) | Lo cubren el Estado de cada pedido, el resumen con +1/+2 y el diagrama. |
| Lista "Pedidos del día" | **Se integra en la tabla del bloque** y se saca | Hora y método → columnas editables. Armar viajes / Viajes (N) y 👍 → al final de cada fila. Lo secundario (cliente, m³, fórmula, tiempos y su fuente, empresa de bomba o "sin empresa", finalidad, ⏸ suspendido, obra sin ubicar, sugerencia de m³ por camión, choques de camión, la línea del porqué) → en el **detalle** de la fila (se abre con ›). |
| "Plan del día propuesto" + "Guardar plan del día" | **Se integra** | La tabla del bloque *es* la propuesta; se guarda con **Guardar y confirmar**. |
| "El día de cada camión" (una planta) | **Se saca** | El diagrama del bloque; el tooltip de cada viaje suma "carga 07:00 · sale 07:15 · llega 07:45 · termina 08:15 · vuelve 08:45". |
| Gerenciador (Armar viajes) | **Queda** igual | Se abre desde la fila del bloque. Con hora o método sin guardar, el botón dice "Guardá la hora antes de armar viajes". |
| "Tiempos y camiones" | **Queda** | El selector de planta pasa adentro ("Tiempos de [Canning ▾]"): es lo único que hoy depende de la planta. Los botones "Camiones que salen ese día" se sacan (están en Editar › "Sale hoy"); queda la línea "Los camiones que salen se eligen en Camiones por planta › Editar". |
| "Simular el día completo" (días pasados) | **Se saca** con el interruptor (pregunta 5) | Sin el interruptor sigue. |
| Navegación de días (‹ › Hoy Mañana) | **Queda** | — |
| Día sin pedidos | **Se integra** | El resumen dice "No hay pedidos ese día. Cargalos en la vista Semana." |

Las cuatro funciones que pidió Bautista siguen: **confirmar** (👍 por fila y en Guardar y confirmar), **Armar viajes**
(fila), **Ordenar el día** (encabezado) y **guardar el plan del día** (Guardar y confirmar).

### 3.2 Tabla del bloque

Una sola función pura arma las filas para la pantalla, el mail y la ruta de WhatsApp: `filasPedidos(resultado,
pedidos, plantas)` en `lib/reparto.ts`. Por pedido devuelve: `nombre` (obra con `nombreVisible`), `cliente`,
`planta`, `llegada` y `sale` (HH:MM), `metodo`, `m3`, `viajes` (cantidad de viajes del armado), `camiones`
(cantidad y patentes), `comienza`, `termina`, `aTiempo`, `atrasoMin`, `estado` (texto del chip, `estadoPedido`) y
`confirmado`.

- **Comienza** = la primera carga del pedido en el armado (`min(inicioCarga)` de sus viajes).
- **Termina** = el mismo criterio de la columna Termina de hoy: **el fin de la descarga del último viaje**
  (`medida.fin`). No es la vuelta a planta (la vuelta está en el diagrama y en la línea "última vuelta").
- **atrasoMin** = minutos de atraso contra el ideal (`medida.demora`) si no sale a tiempo y es positivo; 0 si sale a
  tiempo o si el problema son cortes sin atraso (eso lo dice `estado`); `null` si no tiene camión.

Columnas, en el orden pedido por Bautista para el mail (Pedido, Viajes, Camiones, Comienza, Termina) y después lo que
se edita y el estado (compacta, inputs de ancho fijo):

| Pedido | Viajes | Camiones | Comienza | Termina | Llega a obra | Método | Estado | |
|---|---|---|---|---|---|---|---|---|
| Santa Rita › Canning | 5 | 2 CRN449, LES431 | 07:00 | 12:05 | `[07:45]` sale 07:15 | `[Bomba][Directo]` | chip | Viajes (5) · 👍 |

- **Pedido**: la obra y, debajo en gris, la planta.
- **Llega a obra** = `scheduled_arrival_time` (llegada del primer camión). Input `time` de 96 px; debajo, chico,
  "sale HH:MM" (= llegada − ida del pedido, con la fuente de siempre).
- **Método**: el mismo par de botones de hoy. Si es bomba sin empresa, ícono ámbar con title "Bomba sin empresa
  asignada".
- Editable solo si `ajustaPedido(p)`; si no, se ve igual pero apagado con el title de hoy ("Pedido de X: solo lo
  ajusta quien lo cargó o un gerencial"). En un escenario (+1/+2), apagado.
- **Al cambiar hora o método se recalcula todo el día en el momento, sin grabar**: tabla, resumen, +1/+2, traslados,
  noche, diagrama, avisos. La celda cambiada queda ámbar y arriba aparece "Cambios sin guardar (1 hora, 1 método): la
  tabla y el diagrama ya los usan." con **Descartar**.
- Pedidos completados: fila gris al final, "Completado · 40 m³", sin inputs ni camiones.
- Pedido con parte despachada: en el detalle, "16 de 40 m³ ya enviados".
- Cambiar de día con cambios sin guardar: `confirm("Tenés cambios sin guardar del día. Si cambiás de día, se pierden. ¿Seguir?")`.

Cómo se implementa el recálculo: el hook guarda `ajustes: Record<pedidoId, { hora?: "HH:MM"; metodo?: "bomba" | "directo" }>`
y los aplica **antes** de `conTiemposGps` (la hora arma un `scheduled_arrival_time` nuevo en la fecha del día; el
método cambia `metodo_descarga`). Todo lo demás del hook no cambia: `entrada`, `sugerencia`, escenarios y
`resultado` salen de ahí.

**Lo que se ve es lo que se guarda:** `resultado` pasa a ser siempre `armarDia({ …entrada, reparto: vigente })`
(`vigente` = la edición, lo guardado o, si no hay nada, la sugerencia como reparto). Hoy, sin nada guardado, la tabla
muestra la sugerencia libre; al guardarla, el motor la vuelve a correr con el reparto y podría dar otra cosa. Con este
cambio la tabla ya muestra lo que va a quedar. (Prueba en 7: con el ejemplo tienen que coincidir; si en algún caso no
coinciden, manda lo restringido y el obrero lo reporta.)

### 3.3 Encabezado del bloque

`Camiones por planta · jueves 05/11 [Nuevo] (?)` — a la derecha:
`[Con los que hay (3)] [+1 camión] [+2 camiones]` · **Ordenar el día** · Editar · Descartar · **Guardar y confirmar**
— y debajo, a la derecha, "👍 0 de 3 confirmados".

- **Ordenar el día** (`programacion.editar` o `despacho.cargar`): vuelve a leer pedidos y viajes y deja **la
  sugerencia** como reparto en edición (lo que hoy hacen "Recalcular" + "Usar la sugerencia", que se sacan). Respeta
  las horas y métodos sin guardar (son datos del pedido, no del reparto). Si hay un reparto editado a mano:
  `confirm("Vuelve a la sugerencia y se pierde el reparto editado. ¿Seguir?")`.
- **Guardar y confirmar** (`programacion.editar`). Quien solo tiene `despacho.cargar` ve en su lugar **Guardar
  reparto** (lo de hoy, solo el reparto).

### 3.4 "Guardar y confirmar" (reusa lo que existe, sin duplicar)

Primero, un cartel: "**Guardar y confirmar el jueves 05/11.** Se guarda el reparto de las dos plantas, los viajes de
3 pedidos y se confirman 2 (Santa Rita, Pampero). [Cancelar] [Guardar y confirmar]". Si hay avisos rojos, los lista
arriba ("Se puede guardar igual").

Después, en este orden (cada paso con la función que ya existe, sacada a `lib/` para que la usen la pantalla vieja y
la nueva):

1. **Horas y métodos cambiados** → `guardarHoraPedido()` y `guardarMetodoPedido()`: el `update` de
   `scheduled_dispatches` que hoy está dentro de `guardarHora` (con `scheduled_departure_time` y la bomba que se mueve
   con el primer camión) y de `guardarMetodo` (con la limpieza de bomba al pasar a directo), con su Actividad.
   **Sin `regenerarViajesPedido`**: los viajes los graba el paso 3. (El botón Guardar por fila de la pantalla sin
   interruptor sigue llamando a `regenerarViajesPedido` como hoy.)
2. **Reparto** → `guardarReparto()` (`guardar_reparto_dia`, todo o nada, Actividad), con `vigente` y origen
   `sugerido` / `a_mano` como hoy. Se salta si no cambió respecto de lo guardado.
3. **Viajes de los pedidos de las dos plantas** → `guardarPlanDia()`: el cuerpo de `guardarPlanDelDia` sacado a
   `lib/` (por pedido: los no planificados quedan, los planificados se reemplazan por `resultado.pedidos[i].filas`,
   `guardarViajes(…, "plan_dia")`, Actividad con los 10 primeros viajes).
4. **Confirmar** → `confirmarPedidos()`: el `update` de `confirmarPedido` para cada pedido del día que no esté
   confirmado, completado, cancelado ni suspendido y que la persona pueda ajustar; Actividad "Confirmado: no → sí
   (día anterior)".

Si un paso falla, los siguientes igual se intentan (salvo que falle el 1 en ese pedido: ese pedido no sigue) y el
aviso dice qué quedó: "Se guardó solo una parte. Guardado: reparto, viajes de Santa Rita y Pampero, 2 confirmados. No
se guardó: Greenville (viajes): <error>". Al terminar se relee todo (`cargar(true)`).

Éxito: "**Día guardado y confirmado** · Reparto, viajes de 3 pedidos y 2 confirmados. Quedó en Actividad."

No se hace una función de base que lo haga todo en una transacción: duplicaría `guardar_viajes_pedido` y la lógica de
la hora; se sigue el patrón de "Guardar plan del día", que ya reporta lo parcial (decisión en el punto 9).

### 3.5 Link a la fecha

`/programacion?vista=dia&fecha=2026-11-05` abre la vista Día en esa fecha (`programacion-tabs.tsx` lee `vista`;
`ProgramacionDia` recibe la fecha inicial). Sin parámetros, como hoy (vista guardada en el navegador, día = mañana).
Si la persona no tiene la sesión iniciada, después de entrar tiene que llegar a esa misma dirección (verificarlo; si el
login no vuelve, guardar la dirección pedida y volver a ella).

### 3.6 Archivos (fase A)

**Nuevos**
- `lib/reparto-dia.ts`: lo que hoy hace `useRepartoDia` sin React, para usarlo también en el servidor.
  `leerDatosDia(sb, fecha: "yyyy-mm-dd", plantIds)`: las mismas consultas del hook (plantas, mixers activos, pedidos
  del día y del siguiente con `clients(name), formulas(code), construction_sites(...)`, viajes, tiempos GPS, reparto
  del día y del anterior, traslado), con los límites del día **en hora de Argentina**
  (`${fecha}T00:00:00-03:00`), no `startOfDay` del equipo. `armarVistaDia(datos, { ajustes, edicion, ruta })`: pura;
  devuelve `entrada`, `sugerencia`, `noche`, `sugerido`, `vigente`, `resultado`, `filas` (de `filasPedidos`),
  `avisos`, `contexto`, `resumenNumeros`. Patrón: la parte de carga al final de `lib/viajes.ts` / `lib/reparto.ts`.
  **Es la única carga del día: la usan la pantalla, el mail y la ruta para WhatsApp.**
- `lib/programacion-acciones.ts`: `guardarHoraPedido`, `guardarMetodoPedido`, `guardarPlanDia`, `confirmarPedidos`
  (el código que hoy está en `programacion-dia.tsx`, movido, con el mismo comportamiento) y
  `planGuardarYConfirmar(vista, pedidos, puedeAjustar)`: pura, arma la lista de pasos y el texto del cartel.

**Se modifican**
- `lib/reparto.ts`: `filasPedidos()` (3.2).
- `components/reparto-camiones.tsx`: el hook usa `lib/reparto-dia.ts`; la tabla usa `filasPedidos`; columnas
  nuevas, `ajustes`, detalle de fila, encabezado, Guardar y confirmar, Ordenar el día, línea de números, tooltip con
  horas, fila de completados.
- `components/programacion-dia.tsx`: con el interruptor, se sacan los bloques de 3.1 y se abre el gerenciador desde el
  bloque; las acciones usan `lib/programacion-acciones.ts`; fecha inicial por prop. **Sin el interruptor, igual que
  hoy.**
- `components/programacion-tabs.tsx`: `?vista=dia&fecha=`.
- `lib/permisos.ts`: solo descripciones (programacion.editar: "…, guardar y confirmar el día").

### 3.7 Criterios de aceptación (fase A)

Datos fijos (los del test de la spec del 04/11 con **3 camiones**): Canning (carga 15, espera 10, directo 30 y bomba
38 por 8 m³, jornada 07:00–18:00, 1 boca); Hudson (carga 10, espera 22, directo 43, bomba 45, 1 boca); ida 30 min;
traslado 50; 8 m³ por camión. Pedidos del **jueves 05/11**: Santa Rita (Canning, 40 m³, directo, llega 07:45 = sale
07:15), Greenville (Hudson, 40 m³, bomba, llega 08:20 = sale 07:50), Pampero (Canning, 60 m³, bomba, llega 13:00 =
sale 12:30). Camiones: **AE402HE, AF431GU y AG083GT** (pregunta 7 sobre las horas).

1. La vista Día con el interruptor muestra **un solo bloque** con 3 filas en orden de primera carga: Santa Rita
   (Canning · llega 07:45, sale 07:15 · Directo), Greenville (Hudson · 08:20, sale 07:50 · Bomba), Pampero (Canning ·
   13:00, sale 12:30 · Bomba). Las columnas van en el orden de 3.2. El encabezado dice "Con los que hay (3)" y "👍 0 de
   3 confirmados". No aparecen las tarjetas, el gráfico de demanda, la lista vieja, el plan propuesto ni "El día de
   cada camión".
2. Viajes, Camiones, Comienza, Termina y Estado de cada fila son los que da `armarDia` con esos datos; quedan fijados
   en el test y son **los mismos** que en el mail y en la ruta de WhatsApp de la fase B (los tres salen de
   `filasPedidos`). Comienza de Santa Rita = su primera carga (07:00 con carga de 15 min si el primer viaje no se
   atrasa); Termina = fin de la descarga del último viaje.
3. Pasar Pampero a 14:00: sin grabar nada en la base, cambian la fila de Pampero, el resumen, el diagrama y los
   traslados; la celda queda ámbar y aparece "Cambios sin guardar (1 hora)". Volver a 13:00 deja todo idéntico al
   punto 2. Ningún request de escritura sale de la pantalla.
4. Pasar Santa Rita a Bomba: recalcula con la descarga con bomba de Canning (38 por 8 m³); Descartar vuelve al punto 2.
5. Con una hora sin guardar, "Armar viajes" de esa fila está apagado con "Guardá la hora antes de armar viajes".
6. Guardar y confirmar (prueba de Bautista con el día real de mañana en el preview: hace lo mismo que hoy hace a mano
   con Guardar hora, Guardar reparto, Guardar plan del día y 👍): cartel con lo que va a hacer; después,
   `reparto_camiones` de la fecha tiene una fila por camión, los viajes planificados de **los pedidos de las dos
   plantas** son los del diagrama (mismas horas de carga y camión), origen `plan_dia`; los pedidos quedan con
   `confirmado_at/por`; Actividad tiene la línea del reparto, una por pedido con los viajes, las de hora/método
   cambiados y las de confirmación. Al recargar, la tabla es la misma y dice "Guardado por …" y "3 de 3 confirmados".
7. Quien solo tiene `despacho.cargar` ve "Guardar reparto" (no Guardar y confirmar) y no puede cambiar hora ni método.
8. `/programacion?vista=dia&fecha=2026-11-05` abre la vista Día el jueves 05/11 (también después de iniciar sesión).
9. **No se rompe nada:** sin el interruptor la vista Día es idéntica a la de la rama (capturas antes y después); el
   botón Guardar por fila sigue rearmando los viajes; `test:reparto`, `test:despacho` y `test:gps` siguen pasando;
   `tsc` sin errores nuevos en los archivos tocados.

---

## 4. Fase B — Mail del armado y resumen para WhatsApp

### 4.1 Cuándo sale el mail

Una ruta `app/api/programacion/armado-dia/route.ts`:
- **GET** (cron, `esLlamadaDeCron`): la llama **pg_cron cada 5 minutos** (job `armado-dia-pasada`, mismo patrón y
  mismo secreto `cron_secret` que `zomatik-np-pasada`) y, de respaldo, el cron de Vercel una vez por día
  (`"5 20 * * *"` = 17:05 de Argentina; en Hobby puede correr hasta las 17:59; si ya salió, no hace nada).
- **POST** `{ fecha, accion: "ver" | "enviar" }` con sesión: "Ver el mail" (`programacion.ver`) y "Enviar ahora"
  (`programacion.editar`).

La decisión es una función pura, `decidirEnvio(estado, ahora, huellaActual)` en `lib/armado-dia.ts`, con las
constantes en `REGLAS_MAIL_ARMADO`:

| Constante | Valor | Qué es |
|---|---|---|
| `hora` | 17:00 | Desde cuándo sale el mail del día siguiente |
| `reenvioHasta` | 06:00 | Hasta qué hora del día armado se mandan actualizaciones solas (pregunta 3) |
| `esperaMin` | 10 | Antirrebote: minutos sin cambios antes de mandar la actualización |
| `maxEnvios` | 10 | Tope por fecha (si algo cambia solo sin parar, no se mandan 50 mails) |

**Fecha que se arma:** de 17:00 a 23:59 → mañana; de 00:00 a 05:59 → hoy (es el "mañana" de ayer a la noche); de 06:00
a 16:59 → ninguna (la pasada termina enseguida, sin leer la base).

Por cada pasada (con la fecha que toque):
1. **Toma del GPS de las 17:00** (una vez por fecha, haya o no pedidos): sección 4.3.
2. Se lee el día (`leerDatosDia` de la fase A, con clave de servicio), se arma (`armarVistaDia`, sin escenarios) y se
   calcula la **huella** del contenido (4.4).
3. Decide:
   - Todavía no salió ningún mail de esa fecha y hay pedidos → **sale el mail del día**.
   - No hay pedidos → no sale (pregunta 2). Si después aparece uno, sale como mail del día (no como actualización),
     con el antirrebote.
   - Ya salió y la huella es la del último mail → nada.
   - La huella cambió respecto de la última vista → se anota (`huella_vista`, `vista_desde = ahora`) y se espera.
   - La huella es distinta de la enviada y no cambió hace `esperaMin` → **sale una actualización**. Con la pasada cada
     5 min, sale entre 10 y 15 minutos después del último cambio: 10 cambios seguidos = 1 mail.
   - Llegó a `maxEnvios` → no manda más y la pantalla lo avisa.
4. Antes de mandar se vuelve a leer el GPS (4.3), se arma con los escenarios +1/+2 (para el resumen) y se manda.

Dos pasadas a la vez (cron y "Enviar ahora"): `armado_mail_tomar(fecha)` reserva la fecha 2 minutos; la otra
termina sin mandar.

**"Enviar ahora"** manda en el momento (sin antirrebote ni horario, también antes de las 17:00), cuenta como envío y
deja la huella enviada: si nada cambia, el cron no vuelve a mandar. Si ya había salido uno, va como actualización.

**Preview y local:** fuera de producción (`VERCEL_ENV !== "production"`) "Enviar ahora" manda **solo a Bautista**
(por nombre), con el asunto "[PRUEBA] …", y **no escribe nada** (ni `armado_mail` ni la toma del GPS). En el modo
prueba local, "Ver el mail" funciona sin GPS ("GPS no disponible en local") y "Enviar" responde como las otras rutas
locales.

### 4.2 Destinatarios y envío

- `MAIL_ARMADO_A = ["Fernando Maldonado"]`, `MAIL_ARMADO_CC = ["Juan Oreguy"]`, por nombre en `app_users` (activos,
  con mail), con `mailsDe`. Bautista carga el mail de Fernando con un script suyo; hasta entonces (o si se borra):
  - si Fernando no tiene mail, va **a Juan** y el mail dice arriba "Fernando Maldonado no tiene mail cargado en
    Usuarios: este mail no le llegó.";
  - si ninguno tiene mail, no sale; queda el error en `armado_mail.ultimo_error` y la pantalla dice "No se mandó:
    Fernando Maldonado y Juan Oreguy no tienen mail cargado en Usuarios."
- Resend: `fetch` a `api.resend.com/emails` con `RESEND_API_KEY`, From `Rebucret - Programación <${REPORTE_CALIDAD_FROM}>`.
  Si Resend falla, queda el error y la pasada siguiente reintenta (cuenta para `maxEnvios` solo si salió).
- `mailsDe` y el envío pasan a `lib/mail-servidor.ts` (`mailsDe(sb, nombres)`, `enviarMail({ from, to, cc, subject, html })`);
  `lib/control-ingresos/servidor.ts` importa `mailsDe` de ahí (mismo comportamiento).

### 4.3 Dónde amanecen los camiones (GPS)

**Cuándo se toma:** en la primera pasada desde las 17:00 de la fecha anterior (la "toma de las 17") y cada vez que
sale un mail de esa fecha (en una actualización a las 22:00 el GPS ya dice más). Se guarda en `amanecer_camiones`
(5.1), así la pantalla, las pasadas y la ruta de WhatsApp no consultan Wialon cada vez.

**Cómo se lee:** el cruce unidad ↔ camión que hoy está en `/api/gps/posiciones` (por `mixers.gps_unit_id` o patente,
planta más cercana con `plants.gps_lat/gps_lng`, `estadoGps` de `lib/gps-vivo.ts`, último despacho de hoy) pasa a
`lib/gps-camiones.ts` → `leerPosicionesCamiones(sb, { soloLectura })`; la ruta lo usa y responde **lo mismo que hoy**.

**Qué planta se toma** (función pura `amanecerDe()` en `lib/armado-dia.ts`), por camión:

| Caso | Planta | Texto en el mail |
|---|---|---|
| El reparto de hoy dice que duerme en la otra planta de donde termina (traslado de noche decidido) | la del reparto | "AG083GT: pasa a Canning esta noche (reparto)." |
| GPS en planta (radio de `RADIO_PLANTA_KM`) | esa | "AF431GU: en Hudson." |
| GPS fuera de planta (en obra, yendo, volviendo, parado) y tuvo despacho hoy | la del último despacho de hoy | "AE402HE: todavía en obra (Santa Rita), se toma Canning (su último viaje)." |
| GPS fuera de planta, sin despacho hoy | la más cercana | "AF431GU: a 18 km de Hudson, se toma Hudson (la más cercana)." |
| Sin señal (más de 3 h) o sin vínculo con el GPS | reparto de hoy → último despacho → a confirmar | "AG083GT: sin señal del GPS desde las 11:20, se toma Hudson (reparto de hoy)." / "LES431: sin GPS, a confirmar." |
| No se pudo leer Wialon | igual que "sin señal", para todos | Una sola línea: "No se pudo leer el GPS: se toma dónde duermen según el reparto de hoy." |

En los textos, "todavía en obra" / "yendo a obra" / "volviendo" / "parado fuera de planta" según `estadoGps`.

**Quién lo usa:** el "amanece en" de cada camión pasa a ser `amanecer_camiones(fecha).plant_id`; si no hay toma,
`reparto_camiones(fecha − 1).duerme_plant_id` (como hoy); si tampoco, a confirmar. Lo usan la pantalla (el editor
dice "durmió en: Canning (GPS 17:00)" / "(reparto)" / "a confirmar"), el mail, la ruta de WhatsApp y
`guardar_reparto_dia` (para contar traslados en Actividad). Un mismo criterio en todos.

### 4.4 Huella y "qué cambió"

`contenidoArmado(vista)` (pura) arma el contenido del mail sin la hora de armado: las `filasPedidos`, traslados,
arranque de cada camión (planta y fuente), noche, bloques del diagrama, y si el reparto está guardado o es la
sugerencia. `huellaDe(contenido)` = hash determinístico del JSON con las claves ordenadas (FNV-1a en TS puro: anda
igual en el navegador y en Node).

Así entra todo lo que **cambia el armado** —pedido nuevo, hora, m³, método, cancelación, otro día, reparto guardado,
tiempos de la planta, traslado, el reparto de hoy (noche), los pedidos de pasado mañana (noche)— y no manda nada si se
edita algo que no lo cambia.

`cambiosEntre(anterior, actual)` (pura) arma la lista para la actualización, con `armado_mail.contenido_enviado`:
"Pampero: llega 13:00 → 14:00", "Santa Rita: directo → bomba", "Greenville: 40 → 32 m³", "Nuevo: Lote 5 (Hudson,
11:00)", "Greenville: cancelado" / "Greenville: pasó a otro día", "Cambió el reparto (guardado por Fernando 22:31)",
"AE402HE ahora arranca en Hudson (GPS 22:40)". Máximo 8 líneas; si son más, "y 3 cambios más".

### 4.5 El mail (textos)

**Asunto**
- Del día: `Armado del jueves 05/11 · Rebucret`
- Actualización: `ACTUALIZACIÓN 1 · Armado del jueves 05/11 · Rebucret (22:40)` (adelante, para que se vea en la bandeja)
- Prueba: `[PRUEBA] …`

**Cuerpo** (HTML con estilos en línea, sin imágenes ni CSS externo, ancho máx. 680 px; `esc()` en todo texto):

1. Título "Armado del jueves 05/11" y debajo, gris: "Armado el miércoles 04/11 a las 17:00." En la actualización,
   primero un recuadro ámbar: "**Actualización 1 (22:40).** Cambió: Pampero: llega 13:00 → 14:00."
2. **Resumen:** la frase de `textoResumenDia` (con +1/+2) y la línea "3 pedidos · 140 m³ · 17 viajes · primera carga
   07:00 · última vuelta 18:33". Estado: "Reparto guardado por Fernando el 04/11 16:30 · 0 de 3 confirmados" o "Es la
   sugerencia: todavía no se guardó ni se confirmó."
3. **Pedidos** (tabla, de `filasPedidos`), columnas en este orden: **Pedido** (obra; debajo, gris, planta · método ·
   m³ · cliente) · **Viajes** · **Camiones** (cantidad y, gris, patentes) · **Comienza** · **Termina** · **Llega a
   obra** (y "sale 07:15") · **Estado** (mismo texto que el chip: "A tiempo", "29 min tarde (bomba)", "termina después
   de las 18:00"; verde o ámbar) · **Conf.** (Sí / No).
4. **Avisos** (si hay): los del bloque (rojo / ámbar), igual que en la pantalla.
5. **Arrancan** "(GPS de las 17:00)": una línea por camión (tabla 4.3). Si conviene pasar camiones esta noche
   (`dondeDuermen` de hoy con los pedidos de mañana): "Conviene pasar esta noche: AE402HE a Canning (mañana Canning
   arranca con 3)."
6. **Traslados:** `lineaTraslados()` ("10:56 · AG083GT pasa a Canning · Traslados: 1 · 41 km") y, si el traslado no
   está cargado, "Traslado a confirmar."
7. **A la noche:** `textoNoche()` del día armado ("A la noche quedan 2 en Canning y 1 en Hudson.").
8. **Diagrama** como tabla HTML (4.6).
9. Botón-link **"Modificar en Programación › Día"** →
   `https://www.produccionrebucret.com/programacion?vista=dia&fecha=2026-11-05`.
10. Pie gris: "Lo armó el sistema con los tiempos reales del GPS. Si algo cambia después de las 17:00, llega una
    actualización. produccionrebucret.com"

Todos los textos de pedidos, estado, avisos, traslados y noche salen de las mismas funciones de `lib/reparto.ts` que
usa la pantalla: **no se escriben de nuevo para el mail.**

### 4.6 Diagrama para el mail

`diagramaHtml(filas: FilaDiagrama[], plantas)` (pura, sobre `bloquesDiagrama()`):
- Una `<table>` con una fila por camión: primera celda la patente; después celdas de **15 min** desde
  min(07:00, primera carga) hasta max(18:00, última vuelta), redondeado a la hora.
- Cada viaje o traslado es **una celda con `colspan`** (inicio redondeado para abajo, fin para arriba a 15 min; si se
  pisa con el anterior, empieza donde termina el anterior), con `bgcolor` y `style` del color de la planta (Canning
  `#ccfbf1`, Hudson `#ede9fe`, traslado `#e5e7eb`) y el nombre de la obra (o "→ Canning") si ocupa 4 celdas o más; si
  no, vacía con `title`.
- Encabezado con la hora cada 4 celdas (`colspan=4`). Leyenda debajo.
- Debajo, para el celular, la misma información en texto, una línea por camión: "AE402HE · Hudson: Greenville
  07:40–09:55, Greenville 10:30–12:37 · → Canning 12:37–13:27 · Canning: Pampero 13:31–15:40".

### 4.7 En la pantalla (bloque, con el interruptor)

Debajo de los avisos, una línea (`programacion.ver`):
- "Mail a Fernando (copia a Juan): sale hoy a las 17:00." (antes de mandarse)
- "Mail enviado mié 04/11 17:00." / "Mail enviado 17:00 · actualización 2 a las 22:40."
- "Hay cambios desde el último mail: sale una actualización a las ~22:55 si no cambia nada más." (`vista_desde` +
  `esperaMin`, a la pasada siguiente)
- "Los cambios sin guardar no van al mail." (si hay ajustes o edición sin guardar)
- "No se mandó: <error>." / "Se mandaron 10 mails de este día: no se mandan más solos. Usá Enviar ahora."
- Botones: **Ver el mail** (abre el HTML en un diálogo, no manda nada) y **Enviar ahora** (`programacion.editar`;
  `confirm("Se manda ahora el armado del jueves 05/11 a Fernando con copia a Juan.")`; con cambios sin guardar,
  apagado con "Guardá los cambios antes de mandar").

### 4.8 Archivos (fase B)

**Nuevos**
- `lib/armado-dia.ts` (puro): `REGLAS_MAIL_ARMADO`, `fechaObjetivo(ahora)`, `decidirEnvio()`, `amanecerDe()`,
  `contenidoArmado()`, `huellaDe()`, `cambiosEntre()`, `destinatarios()`, `armarMailArmado()`, `diagramaHtml()`,
  `linkDia(fecha)`, `resumenReparto()` y `validarFechaResumen()` (4.10). Patrón: `lib/control-ingresos/mail.ts`.
- `lib/armado-dia-servidor.ts` (solo servidor): `pasada(sb, ahora)`, `tomarGps(sb, fecha)`, `verMail(sb, fecha)`,
  `enviarAhora(sb, fecha, usuario)`, `vistaParaResumen(sb, fecha)` (la arma el mail y la ruta de WhatsApp: mismo
  cálculo). Patrón: `lib/control-ingresos/servidor.ts`.
- `lib/gps-camiones.ts`: el cruce de `/api/gps/posiciones`.
- `lib/mail-servidor.ts`: `mailsDe`, `enviarMail`.
- `app/api/programacion/armado-dia/route.ts` (`maxDuration = 60`). Patrón: `app/api/control-ingresos/controlar/route.ts`.
- `app/api/reparto/resumen/route.ts` (4.10, `maxDuration = 30`).
- `supabase/migrations/202611051200_armado_dia_mail.sql` (5.1) y `supabase/migrations/202611051210_armado_dia_cron.sql`
  (5.2, se aplica **después** de unificar con `main`).
- `lib/__tests__/armado-dia.test.mjs` y el script `test:armado` (7).

**Se modifican**
- `lib/viajes.ts`: `inicioDelDia()` y los `hh` de `textoChoque` / `textoConMenosCamiones` en **hora de Argentina
  fija** (UTC−3, sin horario de verano desde 2009); en un navegador de Argentina da lo mismo que hoy.
- `lib/reparto.ts`: el `hh` de `avisosSuperposicion`, igual.
- `lib/reparto-dia.ts`: lee `amanecer_camiones` y aplica el criterio de 4.3.
- `components/reparto-camiones.tsx`: "durmió en … (GPS 17:00)", línea del mail, Ver el mail, Enviar ahora.
- `app/api/gps/posiciones/route.ts`: usa `lib/gps-camiones.ts` (misma respuesta).
- `lib/control-ingresos/servidor.ts`: importa `mailsDe` de `lib/mail-servidor.ts`.
- `vercel.json`: `{ "path": "/api/programacion/armado-dia", "schedule": "5 20 * * *" }`.
- `app/actividad/page.tsx`: `ENTIDADES` suma `armado_mail: "Mail del armado"` (solo "Enviar ahora" deja Actividad).
- `lib/permisos.ts`: descripción de programacion.editar "…, mandar el mail del armado".
- `types/database.ts` (regenerar), `docs/migracion-loop/README.md` (registro y decisiones), `docs/migracion-loop/fase-0c.md`
  (tablas nuevas sin RLS y la ruta `/api/reparto/resumen` en la lista de rutas protegidas).

### 4.9 Criterios de aceptación del mail

Mismos datos fijos de 3.7; el mail del jueves 05/11 sale el miércoles 04/11. GPS de prueba a las 17:00: AF431GU en
Hudson; AE402HE en la obra Santa Rita (su último despacho de hoy salió de Canning); AG083GT sin señal desde las 11:20 y
el reparto de hoy lo hace dormir en Hudson.

1. **Hora:** el 04/11 entre 17:00 y 17:05 sale un mail a Fernando con copia a Juan, asunto `Armado del jueves 05/11 · Rebucret`.
   A las 16:55 no sale nada. Si pg_cron no corrió, sale con el cron de Vercel entre 17:05 y 17:59, uno solo.
2. **Contenido:** la tabla del mail tiene las 3 filas con las columnas Pedido, Viajes, Camiones, Comienza, Termina,
   Llega a obra (07:45 / 08:20 / 13:00, sale 07:15 / 07:50 / 12:30), Estado y Conf., **con los mismos valores y textos
   que la tabla de la pantalla** en ese momento; traslados y noche iguales al bloque; el diagrama es una tabla HTML
   (sin `<img>`) y se ve en Gmail web, Gmail del celular y Outlook.
3. **Arrancan:** "AF431GU: en Hudson.", "AE402HE: todavía en obra (Santa Rita), se toma Canning (su último viaje).",
   "AG083GT: sin señal del GPS desde las 11:20, se toma Hudson (reparto de hoy)." `amanecer_camiones` del 05/11 tiene
   esas 3 filas; en la pantalla del 05/11 el editor dice "durmió en: Canning (GPS 17:00)" para AE402HE y el motor lo
   hace arrancar en Canning.
4. **Link:** "Modificar en Programación › Día" abre `/programacion?vista=dia&fecha=2026-11-05` en la vista Día del
   jueves 05/11.
5. **Reenvío con antirrebote:** a las 21:00 se pasa Pampero a 14:00, a las 21:03 Santa Rita a bomba y a las 21:06 se
   guarda el reparto: sale **un solo** mail entre 21:16 y 21:21, asunto `ACTUALIZACIÓN 1 · Armado del jueves 05/11 · Rebucret (21:1x)`,
   con "Cambió: Pampero: llega 13:00 → 14:00 · Santa Rita: directo → bomba · Cambió el reparto…". Volver Pampero a
   13:00 a las 23:00 manda la actualización 2. Editar algo que no cambia el armado (las notas del pedido) no manda nada.
6. **Cancelación y pedido nuevo:** cancelar Greenville a la 01:00 del 05/11 manda una actualización con "Greenville:
   cancelado". Un cambio a las 06:30 del 05/11 no manda nada solo (fuera de `reenvioHasta`); "Enviar ahora" sí.
7. **Sin pedidos:** si el 05/11 no tuviera pedidos, a las 17:00 no sale nada; si a las 19:00 se carga uno, sale el
   mail del día (sin "ACTUALIZACIÓN") a las 19:10–19:15.
8. **Destinatarios:** con Fernando sin mail, el mail va a Juan con la línea "Fernando Maldonado no tiene mail cargado
   en Usuarios: este mail no le llegó." y la pantalla lo avisa. Con los dos sin mail, no sale y la pantalla dice por qué.
9. **Enviar ahora** a las 15:00: sale en el momento (asunto del día); a las 17:00 no sale otro si nada cambió.
   "Ver el mail" muestra el mismo HTML y no manda ni escribe nada.
10. **Preview:** "Enviar ahora" desde el preview manda solo a Bautista, con "[PRUEBA]", y `armado_mail` y
    `amanecer_camiones` no cambian.
11. **GPS caído:** con Wialon sin responder, el mail sale igual con "No se pudo leer el GPS: se toma dónde duermen
    según el reparto de hoy."
12. **Tope:** con una huella que cambia en cada pasada (prueba con un contenido trucado), salen como mucho 10 mails y
    la pantalla dice "Se mandaron 10 mails de este día…".
13. **No se rompe nada:** `/api/gps/posiciones` responde el mismo JSON que antes (comparar con la rama); el control de
    MP manda igual; las pruebas de 7 pasan con `TZ=UTC` y con `TZ=America/Argentina/Buenos_Aires` con el mismo
    resultado; `tsc` sin errores nuevos.

### 4.10 Resumen del reparto para el WhatsApp de Concretus

**Para qué:** el reporte diario de producción de Rebucret por WhatsApp lo manda Concretus (cron 18:00, domingo a
viernes). En la parte "programación de mañana" va, por pedido, cómo queda el día siguiente. Concretus no puede correr
`lib/reparto.ts`: le pide los datos ya calculados a Rebucret y **arma el texto él**.

#### 4.10.1 La ruta

`GET /api/reparto/resumen?fecha=AAAA-MM-DD` (`app/api/reparto/resumen/route.ts`):
- **Protección:** `Authorization: Bearer <CRON_SECRET>` con `esLlamadaDeCron()` de `lib/cron.ts`. Sin eso, `401
  { error: "No autorizado" }`. Ver pregunta 8 (secreto propio).
- **Validación** (`validarFechaResumen`, pura): `fecha` obligatoria, formato `AAAA-MM-DD` y fecha real; si no, `400 { error }`.
- **Solo lee.** No escribe nada (ni `amanecer_camiones` ni `armado_mail`), no manda nada, no toca Zomatik.
- **Mismo cálculo que el mail y la pantalla:** `vistaParaResumen(sb, fecha)` = `leerDatosDia` + `armarVistaDia` con el
  reparto **guardado si existe; si no, la sugerencia** (`vigente`), y el arranque de cada camión según 4.3: la toma del
  GPS guardada en `amanecer_camiones`; si todavía no hay toma para esa fecha, lee el GPS en el momento con
  `amanecerDe()` **sin guardarlo**; si el GPS no responde, el reparto de hoy. Sin escenarios +1/+2.
- **Respuesta:** `200` con el JSON de 4.10.2 (armado por `resumenReparto(vista)`, pura). Si algo falla al armar,
  `502 { error }`.
- `maxDuration = 30`; tiene que responder en menos de 10 s con un día normal.

#### 4.10.2 El JSON

```json
{
  "fecha": "2026-11-05",
  "camiones": 3,
  "pedidos": [
    { "nombre": "Santa Rita", "planta": "Canning", "viajes": 5, "camiones": 1,
      "comienza": "07:00", "termina": "11:38", "atraso_min": 105, "a_tiempo": false }
  ],
  "traslados": ["10:56 AG083GT → Canning"],
  "noche": "Duermen: 3 en Canning"
}
```

| Campo | Qué es | De dónde sale |
|---|---|---|
| `fecha` | la pedida | — |
| `camiones` | camiones que salen ese día (activos, no en taller, sin "no sale") | `vista.entrada.camiones.length` |
| `pedidos[]` | uno por pedido pendiente, en el orden de la tabla (primera carga) | `filasPedidos` (3.2): **los mismos valores que la tabla y el mail** |
| `.nombre`, `.planta` | obra (`nombreVisible`) y planta | idem |
| `.viajes` | viajes del armado | idem |
| `.camiones` | cantidad de camiones del pedido | idem |
| `.comienza` | primera carga, `HH:MM` | idem |
| `.termina` | fin de la descarga del último viaje, `HH:MM` (mismo criterio que la columna Termina) | idem |
| `.atraso_min` | minutos tarde contra el ideal; 0 si sale a tiempo o si solo tiene cortes; `null` si no tiene camión | idem |
| `.a_tiempo` | si sale a tiempo según `REGLAS_REPARTO` (agregado: con `atraso_min` solo, un pedido con cortes largos y 0 de atraso parecería bien) | idem |
| `traslados[]` | `"HH:MM PATENTE → Planta"` (hora de salida), en orden | `vista.resultado.traslados` |
| `noche` | `"Duermen: 3 en Canning"` / `"Duermen: 2 en Canning y 1 en Hudson"` | `textoNoche()` del día armado, en corto |

- Sin pedidos pendientes: `"pedidos": []` (y `traslados: []`; `noche` igual se calcula: dónde quedan los camiones).
- Pedidos completados o cancelados no van.
- `HH:MM` en hora de Argentina.

#### 4.10.3 Lo que tiene que hacer Concretus (otro repo, otro pedido)
- Variables en Vercel de Concretus: la URL de Rebucret y el secreto (el `CRON_SECRET` de Rebucret o el propio de la
  pregunta 8), con un nombre que no pise el `CRON_SECRET` de Concretus (por ejemplo `REBUCRET_RESUMEN_SECRET`).
- En el cron de las 18:00, para la fecha de mañana: `fetch` con timeout de 10 s y arma las líneas del WhatsApp (por
  pedido: nombre, viajes, camiones, comienza y termina; atraso si hay; traslados; noche). Si `pedidos` viene vacío, un
  error o no responde, **omite esa parte** y el WhatsApp sale igual.

#### 4.10.4 Criterios de aceptación
1. `GET /api/reparto/resumen?fecha=2026-11-05` con el Bearer correcto, con los datos de 3.7 y el GPS de 4.9, devuelve
   `camiones: 3`, 3 pedidos (Santa Rita, Greenville, Pampero, en el orden de la tabla) con `viajes`, `camiones`,
   `comienza`, `termina`, `atraso_min` y `a_tiempo` **iguales a la tabla de la pantalla y del mail**, los traslados en
   el formato `"HH:MM PATENTE → Planta"` y `noche` igual a lo que dice el bloque.
2. Sin el header, con otro secreto o desde el navegador con sesión: `401`. Sin `fecha`, `2026-13-40` o `05/11/2026`:
   `400`.
3. Un día sin pedidos pendientes: `pedidos: []`.
4. Con el reparto guardado, la respuesta usa lo guardado; sin guardar, la sugerencia. Cambiar el reparto en la
   pantalla y guardar cambia la respuesta siguiente.
5. Sin toma del GPS para esa fecha (antes de las 17:00), lee el GPS en el momento y **no** escribe en
   `amanecer_camiones` (la tabla queda igual). Con el GPS caído, responde igual con el reparto de hoy.
6. Responde en menos de 10 s con los datos reales de un día normal (medido en el preview).

---

## 5. Base de datos (solo fase B; Bautista lo aprueba antes)

### 5.1 `202611051200_armado_dia_mail.sql` (se puede correr dos veces; compatible con `main` y con la rama)

**Solo agrega**, salvo el ajuste de `guardar_reparto_dia` (misma firma).

**Tabla `amanecer_camiones`** (dónde arranca cada camión un día, según la toma del GPS). Una fila por fecha y camión.

| Columna | Tipo | Nota |
|---|---|---|
| `fecha` | date | el día que arranca (el armado). PK (`fecha`, `mixer_id`) |
| `mixer_id` | uuid FK `mixers` ON DELETE CASCADE | |
| `plant_id` | uuid FK `plants` ON DELETE SET NULL, null | la planta que se toma; null = a confirmar |
| `fuente` | text CHECK in (`reparto_noche`, `gps_planta`, `ultimo_viaje`, `cercana`, `reparto`, `sin_dato`) | por qué (4.3) |
| `estado_gps` | text, null | `en_planta`, `en_obra`, … o `sin_senal` |
| `lat`, `lng` | numeric, null | última posición |
| `km_planta` | numeric(6,1), null | a la planta más cercana |
| `posicion_at` | timestamptz, null | hora de la posición del GPS |
| `texto` | text NOT NULL | la línea del mail ("AE402HE: todavía en obra…") |
| `tomado_at` | timestamptz NOT NULL DEFAULT now() | |

**Tabla `armado_mail`** (estado del mail de cada fecha). Una fila por fecha.

| Columna | Tipo | Nota |
|---|---|---|
| `fecha` | date PK | el día armado |
| `toma_gps_at` | timestamptz | la toma de las 17:00 ya se hizo |
| `primer_envio_at`, `ultimo_envio_at` | timestamptz | |
| `envios` | int NOT NULL DEFAULT 0 | 1 = el del día; 2+ = actualizaciones |
| `huella_enviada` | text | |
| `contenido_enviado` | jsonb | para "qué cambió" |
| `huella_vista`, `vista_desde` | text, timestamptz | antirrebote |
| `enviando_hasta`, `enviando_por` | timestamptz, text | reserva (`armado_mail_tomar`) |
| `a` | text[] | a quién salió el último |
| `ultimo_error` | text | lo que dice la pantalla si no salió |
| `updated_at` | timestamptz NOT NULL DEFAULT now() | |

Permisos de las dos tablas: `SELECT` para anon y authenticated (la pantalla las lee), todo para service_role. Solo
escribe el servidor (clave de servicio). Sin RLS, como el resto (anotar en `fase-0c.md`).

**Función `armado_mail_tomar(p_fecha date, p_quien text, p_segundos int default 120) returns boolean`**: SECURITY
DEFINER, `search_path`; crea la fila si no está y la reserva si `enviando_hasta` es null o ya pasó. EXECUTE solo para
service_role. (Se suelta poniendo `enviando_hasta = null` al terminar.)

**Ajuste de `guardar_reparto_dia`** (CREATE OR REPLACE, misma firma y mismo resultado): para contar el traslado de
la mañana, "dónde durmió" pasa a ser `coalesce(amanecer_camiones(p_fecha).plant_id, reparto_camiones(p_fecha − 1).duerme_plant_id)`.
Mientras `amanecer_camiones` esté vacía, da exactamente lo mismo que hoy.

**Qué pasa con lo cargado:** nada. Ningún pedido, viaje, despacho, reparto ni camión cambia. Las dos tablas arrancan
vacías. Hasta la primera toma del GPS, la pantalla sigue usando el reparto del día anterior para "durmió en". El
reparto ya guardado no se toca. La ruta del resumen para WhatsApp no necesita nada más de la base.

### 5.2 `202611051210_armado_dia_cron.sql` (después de unificar con `main`)

`cron.schedule('armado-dia-pasada', '*/5 * * * *', net.http_get('https://www.produccionrebucret.com/api/programacion/armado-dia', Bearer cron_secret))`,
igual que `zomatik-np-pasada` (usa el mismo secreto de Vault, que ya está). Antes, `cron.unschedule` del mismo nombre.
Para sacarlo: `select cron.unschedule('armado-dia-pasada');`. Va aparte porque, antes de publicar, la ruta no existe en
producción (daría 404 cada 5 minutos).

## 6. Permisos

| Acción | Permiso |
|---|---|
| Ver el bloque, la línea del mail y "Ver el mail" | `programacion.ver` |
| Cambiar hora y método en la tabla | `ajustaPedido(p)` (como hoy) |
| Ordenar el día, Editar, Guardar reparto | `programacion.editar` o `despacho.cargar` (como hoy) |
| Guardar y confirmar | `programacion.editar` |
| Enviar ahora | `programacion.editar`, controlado **en el servidor** (`exigirSesion` + `puedeCon`) |
| `GET /api/reparto/resumen` | Solo con el Bearer del cron (no con sesión de usuario) |

## 7. Pruebas (`node --test`)

`test:armado` corre `lib/__tests__/armado-dia.test.mjs` dos veces: `TZ=UTC` y `TZ=America/Argentina/Buenos_Aires`.

**Fase A** (en `reparto.test.mjs` o `armado-dia.test.mjs`):
- Ejemplo de 3.7 con 3 camiones: filas, orden, llegada y "sale", y los valores de Viajes/Camiones/Comienza/Termina/
  Estado fijados.
- `filasPedidos`: `comienza` = primera carga; `termina` = `medida.fin` (fin de la última descarga, no la vuelta);
  `atrasoMin` = demora si no sale a tiempo, 0 a tiempo o con solo cortes, `null` sin camión.
- Ajustes: Pampero a 14:00 en memoria da lo mismo que un pedido guardado a las 14:00; volver a 13:00 da lo mismo que
  sin ajustes. Santa Rita a bomba usa la descarga con bomba.
- "Lo que se ve es lo que se guarda": `armarDia(reparto: repartoDe(sugerencia))` da los mismos camiones y fin por
  pedido que la sugerencia en el ejemplo.
- `planGuardarYConfirmar`: los viajes a guardar son las `filas` del resultado de **las dos plantas**; el reparto es
  `vigente`; confirma solo pendientes no confirmados, no suspendidos y ajustables; el texto del cartel.
- `leerDatosDia` con un `sb` falso: las consultas usan `2026-11-05T03:00:00.000Z` a `2026-11-06T03:00:00.000Z` con
  cualquier `TZ`.

**Fase B — mail**:
- `fechaObjetivo`: 16:59 → ninguna; 17:00 → mañana; 23:59 → mañana; 00:01 y 05:59 → hoy; 06:00 → ninguna.
- `decidirEnvio`: todos los casos de 4.1 (primero, sin pedidos, igual, cambió hace 9 y 10 min, fuera de horario, tope,
  "Enviar ahora").
- `huellaDe`: igual con las filas en otro orden y con otra hora de armado; cambia con hora, m³, método, estado,
  reparto, arranque y pedidos de pasado mañana.
- `cambiosEntre`: hora, método, m³, nuevo, cancelado, otro día, reparto, arranque; corte en 8.
- `amanecerDe`: los 6 casos de 4.3 con sus textos exactos (los de 4.9 punto 3).
- `armarMailArmado`: asuntos (día, actualización N con hora, prueba); el link exacto; la línea de Fernando sin mail;
  sin `<img>` ni `<style>`; nombres con `&` y `<` escapados; columnas en el orden Pedido, Viajes, Camiones, Comienza,
  Termina, Llega a obra, Estado, Conf., con los mismos valores que `filasPedidos`.
- `diagramaHtml`: en cada fila la suma de `colspan` es igual a la cantidad de celdas; bloques que se pisan al
  redondear no se superponen; obra visible solo con 4 celdas o más.
- `destinatarios`: producción (Fernando y Juan; Fernando sin mail → Juan con aviso; ninguno → error) y prueba (solo
  Bautista, sin escrituras).
- Hora de Argentina: `avisosSuperposicion` y `textoChoque` dan la misma hora con `TZ=UTC`.

**Fase B — resumen para WhatsApp**:
- `resumenReparto` con el ejemplo de 3.7 y el GPS de 4.9: el JSON completo fijado (fecha, camiones, 3 pedidos con sus
  campos, traslados, noche).
- Cada pedido del JSON es igual campo a campo a su fila de `filasPedidos` (mismo cálculo que la tabla y el mail).
- Sin pedidos pendientes → `pedidos: []`, `traslados: []`, `noche` con texto.
- Pedido sin camión → `camiones: 0`, `atraso_min: null`, `a_tiempo: false`; pedido con cortes y sin demora →
  `atraso_min: 0`, `a_tiempo: false`.
- Traslados en el formato `"HH:MM PATENTE → Planta"` y en orden; `noche` empieza con "Duermen: ".
- `validarFechaResumen`: válida, inválida (`2026-13-40`, `2026-02-30`, `05/11/2026`) y faltante.
- Migración: se puede correr dos veces, todo en una transacción, `guardar_reparto_dia` mantiene la firma; en la base,
  en `BEGIN … ROLLBACK`: tablas, CHECKs, `armado_mail_tomar` (dos tomas seguidas: la segunda da false; vencida, true) y
  `guardar_reparto_dia` igual que antes con `amanecer_camiones` vacía.

## 8. Riesgos

| Riesgo | Cómo se cubre |
|---|---|
| El motor en el servidor arma el día corrido 3 horas (UTC) | Hora de Argentina fija en `lib/viajes.ts` y `lib/reparto.ts`; pruebas con `TZ=UTC` |
| El mail, el WhatsApp y la pantalla dicen cosas distintas | Una sola carga (`lib/reparto-dia.ts`), una sola función de filas (`filasPedidos`), `vistaParaResumen` compartida |
| A las 17:00 los camiones todavía trabajan | Regla de 4.3 (último viaje) y nueva toma en cada envío; pregunta 4 |
| El preview manda mails reales o escribe en la base de producción | Modo prueba: solo a Bautista, sin escrituras |
| Mails de más | Antirrebote de 10 min, tope de 10 por fecha, solo si cambia el armado |
| pg_cron o pg_net caídos | Cron de Vercel de respaldo (17:05–17:59) |
| Resend o Wialon caídos | Reintento en la pasada siguiente; sin GPS sale igual con el reparto |
| "Guardar y confirmar" queda a medias | Pasos en orden, aviso con lo que quedó y lo que no, relectura |
| El `CRON_SECRET` de Rebucret queda guardado en Concretus: con él se pueden llamar todas las rutas de cron de Rebucret (NP de Zomatik, control de MP…) | Pregunta 8: secreto propio y solo de lectura para esta ruta |
| Rebucret no responde a las 18:00 | Concretus omite la parte y el WhatsApp sale igual (timeout 10 s) |

## 9. Decisiones propuestas (se anotan en `docs/migracion-loop/README.md` §6 cuando Bautista apruebe)

- **La vista Día muestra un solo cálculo, el del bloque.** Se sacan las tarjetas, la grilla y el plan por planta
  porque usaban otro motor y podían contradecirlo. Descartado: dejarlos abajo "para comparar" (dos números para lo
  mismo).
- **Lo que se ve es lo que se guarda:** la tabla siempre corre el motor con el reparto vigente. Descartado: mostrar la
  sugerencia libre y guardar otra cosa.
- **Una sola fila por pedido (`filasPedidos`) para la pantalla, el mail y Concretus**, con Comienza = primera carga y
  Termina = fin de la última descarga. Descartado: que cada salida calcule sus columnas.
- **Guardar y confirmar encadena las acciones que existen** (hora, reparto, plan del día, 👍), con aviso de lo
  parcial. Descartado: una función de base nueva que lo haga en una transacción (duplicaría `guardar_viajes_pedido` y la
  lógica de la hora).
- **El mail se decide con una pasada cada 5 min (pg_cron) y una huella del contenido**, no con disparadores en las
  tablas. Descartado: triggers en `scheduled_dispatches`, `viajes` y `reparto_camiones` (tocan tablas calientes y
  avisan cambios que no cambian el armado); el cron de Vercel solo (en Hobby no es puntual ni puede correr cada 5 min).
- **Dónde amanece un camión se guarda aparte (`amanecer_camiones`)**, no en `reparto_camiones` ni en
  `mixers.plant_id`: es lo observado, no lo planeado. Orden: traslado de noche decidido > GPS > reparto de ayer > a confirmar.
- **Hora de Argentina fija en el motor** (UTC−3), para que el navegador y el servidor armen igual.
- **Concretus no calcula el reparto: le pide los datos por pedido a Rebucret** (`/api/reparto/resumen`, JSON, solo
  lectura, mismo cálculo que el mail) y arma el texto él. Descartado: copiar `lib/reparto.ts` a Concretus (dos
  motores), que Concretus lea `reparto_camiones` directo (sin reparto guardado no hay nada, ni sugerencia ni atrasos) y
  el resumen por franja de planta (a Bautista no le resultó claro).

## 10. Preguntas para Bautista

1. **Interruptor:** el bloque solo se ve con "funciones nuevas". ¿Se lo prendo a Fernando y a Juan para que el link
   del mail les sirva? *Recomiendo que sí.*
2. **Día sin pedidos:** ¿se manda igual un mail que diga "Mañana no hay pedidos"? *Recomiendo que no (menos ruido);
   si después se carga uno, sale el mail.*
3. **Actualizaciones solas:** hasta las 06:00 del día armado, 10 min después del último cambio. ¿Te sirve?
   *Recomiendo eso; después de las 06:00 manda Despacho y "Enviar ahora" sigue.*
4. **GPS a las 17:00:** a esa hora varios camiones siguen trabajando. ¿Sumamos una segunda toma a las 20:00 que solo
   manda actualización si cambia dónde arranca alguno? *Recomiendo que sí.*
5. **Gráfico de demanda y "Simular el día completo":** ¿se pueden sacar de la vista Día nueva? *Recomiendo que sí (el
   bloque ya dice dónde faltan camiones); sin el interruptor quedan.*
6. **Guardar y confirmar** confirma todos los pedidos pendientes del día (no los suspendidos), con un cartel antes.
   ¿Ok? *Recomiendo que sí; el 👍 por fila sigue para sacar uno.*
7. **Horas del ejemplo y "Comienza":** tomé 07:15, 07:50 y 12:30 como hora de **salida** de planta (llegan 07:45,
   08:20 y 13:00), como en la especificación del 04/11. Entonces "Comienza" (primera carga) de Santa Rita da 07:00, no
   07:15. ¿Comienza es la carga (lo que pediste) o preferís la salida? *Recomiendo la carga: es cuando se ocupa la
   planta.*
8. **Secreto de la ruta para Concretus:** con el `CRON_SECRET` de Rebucret, Concretus podría llamar cualquier cron de
   Rebucret. ¿Usamos un secreto propio solo para esta ruta (`RESUMEN_REPARTO_SECRET`, que la ruta acepta además del
   cron)? *Recomiendo que sí: es una variable más en cada Vercel y si se filtra solo deja leer el resumen.*
