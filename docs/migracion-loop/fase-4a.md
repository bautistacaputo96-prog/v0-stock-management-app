# Fase 4a — Medición de tiempos reales con el GPS (adelantada)

Estado: **aprobada por Bautista (05/10/2026)**: "Perfecto con empezar a medir los tiempos reales". Se adelanta porque B-Track ya está conectado (30/09) y **Wialon guarda historia desde el 01/09/2025** (verificado: AE402HE tiene 232.589 mensajes; un día de trabajo ronda los 1.800 mensajes por camión). Se reconstruye **todo el historial** y después sigue cada noche.

Métricas elegidas por Bautista: tiempo en obra, ciclo, tiempo de carga en planta (ver nota), ida/vuelta reales, puntualidad, uso de la flota, m³ y viajes por camión, m³ por chofer, paradas fuera de obra, km y diferencia ida/vuelta, minutos por m³, cancelados/suspendidos. "Motor encendido parado en planta" no lo eligió, porque pensaba que no se puede medir. El GPS sí manda la ignición (`eng_ign_stat`), así que el dato **se guarda igual** y se le ofrece.

Nota sobre la carga: la hora de despacho que carga el operario no es la de la carga real (se carga desde otra computadora y muchas veces después). Por eso el "tiempo en planta" sale del GPS: llegada a planta → salida de planta. La carga real se va a poder medir si se integra el sistema de la dosificadora (consulta abierta con Bautista).

## Qué se construye

### 1. Reconstrucción de viajes desde el GPS (`lib/gps-viajes.ts`)
- **Fuente:** Wialon `messages/load_interval` por unidad y por día, con posición, velocidad, ignición y odómetro. Solo lectura, con el token guardado en `integraciones` (lo usa el servidor; nunca se muestra).
- **Geocercas de planta:** círculo de 250 m alrededor de `plants.gps_lat/lng`, parámetro ajustable.
- **Viaje:** sale de una geocerca de planta y vuelve a una planta (puede ser la otra).
- **Dentro del viaje:**
  - **parada principal** = la parada más larga (velocidad 0 por más de 5 min) fuera de planta → **llegada a obra** = inicio de esa parada; **salida de obra** = fin;
  - las otras paradas de más de 3 min = **paradas fuera de obra**, con ubicación y duración;
  - **km de ida** y **de vuelta**, por odómetro o sumando posiciones.
- **En planta:** **tiempo en planta antes de salir** (desde que llegó) y **minutos con motor encendido y parado en planta** (ignición encendida, velocidad 0).
- Casos borde: viajes que cruzan la medianoche, equipos sin señal (se marca "incompleto"), camión que sale y vuelve sin parar (no es viaje: carga de prueba o traslado).

### 2. Cruce con los despachos
- Por camión (`mixers.gps_unit_id` o la patente) y por día. La hora de despacho no es confiable, así que se cruza por **orden del día**: el 1.er viaje con el 1.er despacho de ese camión, y así.
- Si la obra está ubicada, se confirma por distancia (la parada principal a menos de 400 m de la obra).
- **Confianza:** `alta` (obra ubicada y coincide), `media` (por orden, sin ubicación), `baja` (las cantidades no coinciden).
- Quedan marcados los **viajes sin remito** y los **remitos sin viaje**: es la base de la auditoría de entregas.
- **Aprender la ubicación de la obra:** si la obra no tiene coordenadas y hay viajes con confianza media, se guarda la mediana de las paradas principales como **ubicación sugerida**:
  - en `construction_sites.gps_lat/lng` con `gps_source = 'gps_aprendido'`;
  - nunca pisa una ubicación cargada a mano;
  - se puede corregir desde Clientes.

### 3. Datos: tabla `viajes_gps`
`id`, `fecha`, `mixer_id`, `unidad_wialon`, `plant_id_salida`, `plant_id_vuelta`, `dispatch_id` (puede ser nulo), `construction_site_id`, `llegada_planta_previa`, `salida_planta`, `llegada_obra`, `salida_obra`, `llegada_planta`, `min_en_planta`, `min_motor_parado_planta`, `min_ida`, `min_obra`, `min_vuelta`, `ciclo_min`, `km_ida`, `km_vuelta`, `parada_lat`, `parada_lng`, `paradas_extra` (jsonb), `confianza`, `estado` (`completo` / `incompleto`), `procesado_at`.

Índice único `(mixer_id, salida_planta)`: reprocesar un día **reemplaza** sus viajes, no los duplica.

### 4. Procesos
- `/api/gps/reconstruir?fecha=AAAA-MM-DD` (o `desde` y `hasta`, máximo 7 días por llamada): procesa los días pedidos para los 5 camiones. Es idempotente. Por ahora sin secreto (la 0c lo protege). No escribe nada fuera de `viajes_gps` y de las ubicaciones aprendidas.
- **Cron diario** 09:00 UTC (06:00 en Argentina): procesa el día anterior y repasa los 2 días previos, por si llegaron mensajes atrasados.
- **Carga histórica:** llamadas por semana desde el 01/09/2025 hasta hoy, una sola vez. Las hace el arquitecto con el OK final.

### 5. Pantalla: Logística › "Tiempos reales" (para todos)
- **Por día:** la lista de viajes con camión, chofer, obra, remito y los horarios salida → obra → salida obra → planta, más los minutos de cada tramo y los km. Marca viajes sin remito y remitos sin viaje.
- **Resumen de un período**, con filtro por planta:
  - ciclo promedio;
  - tiempo en obra promedio;
  - ida y vuelta promedio;
  - tiempo en planta;
  - m³ y viajes por camión;
  - uso de la flota (horas en viaje sobre la jornada);
  - minutos por m³;
  - m³ por chofer (desde que haya choferes);
  - km por viaje.
- **Ranking de tiempo en obra** por cliente y por obra: los que más retienen los camiones.
- **Puntualidad:** llegada del primer camión del pedido contra `scheduled_arrival_time`, con la tolerancia de la planta (15 min). Por cliente y en el período.
- Las referencias de Loop se muestran al lado, en gris (ciclo ~150, obra ~70, carga < 20–25, ruta ~60).
- Las métricas de cancelados y suspendidos quedan para cuando exista el motivo estructurado (Fase 3).

### 6. Uso de los tiempos medidos (para la Fase 2)
- Función `tiemposMedidos(obra | cliente | planta)` con la mediana de los últimos N viajes de ida, obra y vuelta.
- La programación la usa como valor sugerido: "Medido: 32 min en obra (12 viajes)". Así el dimensionamiento de camiones se apoya en lo real.
- Integrarlo en el formulario del pedido queda para después del merge de la Fase 2.

## Criterios de aceptación
1. Un día real conocido (por ejemplo 02/10, Canning, 6 despachos de H17) reconstruye 6 viajes de ese camión. Cada uno tiene salida, llegada a obra, salida de obra y vuelta con horarios razonables (sin negativos, sin ciclos de 0 o de 12 h), y se cruza con sus remitos.
2. Procesar dos veces el mismo día no duplica.
3. Un camión sin señal o un día sin trabajo no rompe nada.
4. Las ubicaciones aprendidas no pisan las cargadas a mano.
5. La pantalla muestra resúmenes coherentes con lo que se ve en B-Track para ese día. Se compara con 2 viajes mirados a mano.
6. Build limpio y `tsc` sin errores nuevos. "No se pierde nada": ninguna pantalla existente cambia, salvo el ítem nuevo en Logística.

## Hecho

**05/10/2026 — obrero.** Rama `loop/fase-4a-tiempos-gps` (local, sin subir). Commits: `9ad61f6` algoritmo + pruebas, `274fa6b` migración, `8a2e0c2` endpoint + cron, `30ff79b` pantalla, más este registro.

**Agregado aprobado el 05/10 (Bautista, vía coordinador):** se **muestra** también la métrica 9, ralentí en planta (motor encendido y parado antes de salir): promedio por viaje en el resumen, por camión y por chofer, con la referencia de Loop en gris (buena práctica ~35 min por viaje; típico al empezar ~60; 10 min ≈ 1 L de gasoil). En la tabla del día va por viaje.

### Qué se hizo
- `lib/gps-viajes.ts` (lógica pura, sin dependencias): mensajes → viajes → cruce → ubicación aprendida → resúmenes y `tiemposMedidos()` / `medianasTramos()` para la Fase 2 (integración en el pedido, pendiente como dice la spec).
- `lib/wialon.ts`: `abrirSesion`, `unidades`, `mensajesIntervalo`, `cerrarSesion`. Solo `token/login`, `core/search_items`, `messages/load_interval`, `messages/unload`, `core/logout`; sesión propia por proceso.
- `lib/gps-reconstruir.ts` + `GET /api/gps/reconstruir?fecha=` o `?desde=&hasta=` (≤ 7 días; sin parámetros = ayer y los 2 previos). Por camión: upsert de los viajes y después borra los del rango que quedaron sin tocar (ver Revisión). `&simular=1` calcula todo y devuelve las filas **sin escribir** (sirve para controlar antes de la carga). `maxDuration = 60`; medido: 1 día ≈ 12 s, 7 días ≈ 13 s.
- Cron en `vercel.json`: `0 9 * * *`. Hobby hoy permite **100 crons por proyecto** (una vez por día, con ±59 min de precisión): el tercero no es problema.
- Pantalla `/logistica/tiempos` (`components/logistica-tiempos.tsx`); en el menú, Logística pasa a ser grupo con **En vivo** (sin cambios) y **Tiempos reales**. Pestañas: Por día (con viajes sin remito y remitos sin viaje), Resumen, Tiempo en obra (ranking por cliente y obra), Puntualidad (primer camión vs. hora pedida, tolerancia de la planta). Sin gráficos (solo tablas y tarjetas). Si la tabla no existe muestra "Todavía no hay tiempos medidos". En desarrollo, `?simular=1` usa el endpoint de simulación.
- Pruebas: `npm run test:gps` (`node --test`, 10/10) sobre `lib/__fixtures__/gps-viajes-dias-reales.json` (mensajes reales del 02/10 y 26/09 de AE402HE y AG083GT, despachos anonimizados).
- Tipos: `ViajeGpsFila` está en `lib/gps-viajes.ts`. **No** se tocó `types/database.ts` (lo regenera la Fase 2 y chocaría); regenerarlo después de aplicar la migración.

### Reglas y umbrales (los de la spec, más lo que pidieron los datos reales)
- Geocerca de planta 250 m; parada = el camión queda en un círculo de 200 m (aguanta las maniobras en obra); principal ≥ 5 min (la más larga), extra ≥ 3 min; obra confirmada a < 400 m. **No hubo que cambiarlos.**
- Salida que nunca pasa de 400 m de la planta = sigue en planta (portón, playa).
- **Camión guardado afuera:** una parada con motor apagado ≥ 60 min no puede ser la obra (con hormigón el trompo necesita el motor). Si no vuelve a planta ese día, el viaje termina al llegar ahí (queda incompleto). Pasa de verdad: AG083GT y AF431GU duermen en un mismo punto cerca de Hudson.
- Tiempo en planta: desde que llegó; si pasó la noche (o > 4 h, o empieza antes de los mensajes), desde que arrancó el motor tras ≥ 30 min apagado. Ralentí = motor encendido y velocidad < 3 km/h, sumando tramos de hasta 5 min.
- Incompleto: hueco > 15 min sin mensajes con > 1 km de movimiento, o no volvió a planta.
- **Orden del día de los remitos:** por hora y, dentro de cada planta, por **número de remito** (el talonario sigue el orden de carga; la hora no: el manual queda en 12:00 y el plantista carga en tanda). Misma cantidad → 1.º con 1.º; distinta → alineación ordenada de menor costo (hora fuera de la ventana del viaje, planta distinta, obra). **Tandas** (remitos cargados con < 10 min, a obras distintas, alguna ubicada): se prueba cada orden y gana el que coincide con la obra.
- Confianza: con obra ubicada, alta o baja según la distancia (y se toma como principal la parada en la obra); sin ubicar, media, o baja si no cierran cantidades o planta.
- Ubicación aprendida (regla final del arquitecto, 05/10): mediana de las paradas; las que coinciden (a < 200 m de la mediana) tienen que ser ≥ 60 % y al menos 3 (cualquier día: la mayoría de las obras son de un solo hormigonado) o, si son 2, de 2 días distintos. Si al recalcular no hay consenso, queda el valor aprendido anterior. Es un complemento: las obras también se ubican a mano con el buscador nuevo (rama de la Fase 2). Obra sin ubicación: viajes "media"; obra con ubicación aprendida: se recalcula cada vez con todos sus viajes con remito (cualquier confianza). Solo escribe si la obra no tiene ubicación o la que tiene es `gps_aprendido`. Después de aprender, se vuelve a cruzar el rango.

### Validación con días reales (Wialon de verdad, base de producción, sin escribir)
- **02/10** (25 remitos): 24 viajes, 24 con remito. AE402HE 6/6 (salidas 07:16, 10:13, 12:11, 14:37, 16:12, 17:55; ej. 1.º: obra 07:44–09:20, vuelta 09:49, ciclo 153, 22,7/22 km; 2.º: ciclo 84, obra 31), CRN449 5/5, LES431 5/5, AF431GU 4/4 (2 de Hudson y 2 de Canning; el 2.º sale de Hudson y vuelve a Canning), AG083GT 4 viajes / 5 remitos: el "755" de Canning (manual 12:00, repetido del "755 HUDSON") queda **remito sin viaje**; el último viaje no volvió a planta (incompleto). La obra de la platea se aprende sola (17 paradas coincidentes) → 18 alta, 2 media, 4 baja. 755/756 de Hudson se cargaron en el mismo minuto y el GPS muestra el orden al revés: se corrige solo cuando esas obras queden ubicadas (aprendidas o a mano).
- **26/09** (20 remitos): 21 viajes, 20 con remito, **20/20 confirmados por ubicación** después de aprender PAVIMENTO y CANCHA PADEL. El viaje sin remito es un traslado Hudson → Canning a las 05:45. Sin el orden por número de remito, AE402HE cruzaba 2 de 4 al revés (horas 12:00 del manual).
- **01/10** (día tranquilo, lluvia, 0 remitos): 1 viaje sin remito (AF431GU, traslado al lugar donde duerme), nada roto.
- Semana 15–21/09: **19/09** tiene 38 remitos (314 m³, "Pueblos del Plata", Hudson) y los camiones **no salieron de 100 m de la planta** en todo el día: obra pegada a la planta (o bombeada desde ahí). Quedan como "remitos sin viaje" y la pantalla lo explica. Revisar con Bautista.
- 01–07/09/2025: hay viajes pero no remitos (el sistema se usa desde abril 2026): la historia anterior da uso de flota y tiempos, sin cruce.
- No se miraron viajes en B-Track a mano (criterio 5): queda para Bautista/arquitecto con el preview.

### Pendiente / para el revisor
- Clientes muestra una ubicación aprendida como "Ubicada" (sin aclarar que es sugerida); se corrige igual moviendo el pin. No se cambió para no tocar pantallas existentes.
- El endpoint no tiene secreto (como dice la spec; lo cubre la 0c).

### Revisión (05/10/2026, aprobado con cambios) — arreglado en `57dfa9f`
1. Pantalla: las consultas paginan de a 1000 con `.range()` (antes `.limit(5000)` cortaba en 1000 sin avisar).
2. Guardado: por camión, upsert con `procesado_at = ahora` y recién después se borran los del camión en el rango con `procesado_at` anterior (limpia viajes que ya no existen, incluido el que cruzaba la medianoche). Si un camión falla se informa en `camiones[].error` y se sigue con los demás; nunca queda un rango vacío.
3. Ubicación aprendida: se pidió consenso (primero ≥ 3 paradas de ≥ 2 días; después el arquitecto lo cambió por la regla final de arriba); la aprendida se recalcula con todos los viajes con remito; nunca toca las manuales.
4. Freno del endpoint (sin secreto todavía, `TODO(fase 0c)`): tabla nueva `gps_reconstrucciones` (en la misma migración, solo para el servidor) que registra cada llamada; una llamada manual que repite o se superpone con un rango pedido hace < 5 min (mismo modo simular) o la 31.ª en 5 min recibe 429. El cron (`x-vercel-cron` o user-agent `vercel-cron`) pasa siempre. Ojo: sin la migración, el endpoint (también `simular=1`) responde "Falta aplicar la migración".
5. Con la misma cantidad de viajes y remitos también se prueba la alineación ordenada y gana si cuesta claramente menos (traslado + remito de otra planta).
6. Se excluyen los despachos por árido (`is_test_dispatch`) en el proceso y en la pantalla.
7. `package.json` vuelve a CRLF: el diff es solo la línea del script.
8. `desde ≤ hasta` se valida después de recortar `hasta` a hoy.
9. Pantalla: la puntualidad muestra la tolerancia de cada planta; el ciclo se muestra "con planta" (tiempo en planta + calle, comparable con Loop ~150) y "en la calle"; la puntualidad usa el primer remito del pedido (orden de remito) y marca "sin dato" si su viaje falta o es dudoso.

**Ajuste del arquitecto (05/10):** el requisito de ≥ 2 días perdía casi todas las obras (son de un solo día). Regla final: ≥ 3 paradas que coinciden a < 200 m (sin importar los días), o 2 de días distintos; se mantiene la mayoría, nunca tocar las manuales y conservar la aprendida si no hay consenso. Simulación 26/09–02/10 otra vez: aprende la platea (17 paradas), PAVIMENTO y CANCHA PADEL; 26/09 queda 20/20 confirmado por ubicación y 02/10 en 18 alta, 2 media, 4 baja. `test:gps` 17/17 (nueva: la platea del 02/10 se aprende con sus 6 paradas de AE402HE), build OK, `tsc` 18 (igual que `main`).

Verificación de la revisión: `npm run test:gps` 16/16 (nuevas: guardado seguro, ubicación aprendida y su recálculo, alineación ordenada con igual cantidad, paginado, freno, primer camión); migración otra vez en `BEGIN … ROLLBACK` 12/12 (upsert + borrar lo viejo deja 24 y limpia una fila vieja, `anon` no ve `gps_reconstrucciones`); simulación 26/09–02/10: 46 viajes, 44 con remito, 1 remito sin viaje (el "755" repetido), 0 aprendidas (cada obra de esa semana tiene un solo día); build OK; `tsc` sin errores nuevos (18, igual que `main`).

### Segunda revisión (05/10/2026, APROBADO) — dos ajustes
- Freno más estricto y atómico: función `gps_reconstruir_registrar` (en la misma migración, solo `service_role`) que con un candado de la base (`pg_advisory_xact_lock`) controla y registra la llamada en una sola transacción. Manual: rechaza un rango superpuesto (mismo modo simular) de hace < 5 min o la 7.ª llamada en 5 min; el cron pasa siempre. La regla vive solo en la base (se quitó la copia en TS). Probado en `BEGIN … ROLLBACK` 8/8, incluida una segunda conexión que queda esperando el candado.
- Pantalla: pedidos y obras se piden en lotes de 200 ids (`porLotes`).
- `test:gps` 17/17, migración 12/12, build OK, `tsc` 18 (igual que `main`).
- Consecuencia para la carga histórica: con 6 llamadas manuales cada 5 min, ir de a una cada ~50 s (≈ 50 min por pasada).

### Indicadores con detalle (06/10/2026, pedido de Bautista al ver el preview)
Bautista: "Los KPIs necesitan más explicación; estaría bueno que clickeando en cada uno pudiera ver mejor el detalle". La migración ya estaba aplicada en producción (101 viajes del 23/09 al 05/10, 7 obras aprendidas).
- `lib/kpis-logistica.ts`: **única definición** de los 15 indicadores (ciclo con planta, ciclo en la calle, tiempo en obra, ida, vuelta, tiempo en planta, motor encendido parado en planta, m³ por camión, viajes por camión, uso de la flota, minutos por m³, km por viaje, paradas fuera de obra, puntualidad, m³ por chofer): título, explicación corta, qué mide, cómo se calcula (eventos del GPS, desde → hasta, qué se excluye), referencia de Loop, bandas bueno / normal / a mejorar, unidad y cálculo. Más `porDia`, `desglosar` (camión, obra, cliente, chofer) y `peoresPrimero`. La van a usar también los tableros que vengan.
- Reglas comunes: los tiempos (ciclos, obra, ida, vuelta, min/m³) usan viajes de entrega completos y con cruce confiable (sin traslados, incompletos ni dudosos); tiempo en planta y ralentí, todos los viajes de entrega (sin estadías de más de 3 h); m³ y viajes por camión, por día-camión con viajes; m³ por chofer, por día-chofer; minutos por m³ = (planta + calle) ÷ m³, comparable con Loop.
- Bandas (de Loop, sección 7 del informe): ciclo con planta ≤ 150 / ≤ 180; ciclo en la calle ≤ 134 / ≤ 160; obra ≤ 70 / ≤ 90; ida y vuelta ≤ 30 / ≤ 45; planta ≤ 25 / ≤ 32; ralentí ≤ 35 / ≤ 60; m³ por camión ≥ 22,5 / ≥ 15 por día; viajes por camión ≥ 3,5 / ≥ 2,5; min/m³ ≤ 17,5 / ≤ 20,4; m³ por chofer ≥ 19,9 / ≥ 16,7. Puntualidad ≥ 90 % / ≥ 75 %: **bandas propias, Loop no publica un porcentaje (a confirmar con Bautista)**. Sin bandas: uso de la flota, km por viaje, paradas fuera de obra.
- Pantalla, pestaña Resumen: una tarjeta por indicador con el número, la explicación corta, la banda y "Ver detalle". Al tocarla se abre un panel lateral con: qué mide y cómo se calcula; cómo leerlo (referencia de Loop y las tres bandas, marcando dónde estamos); evolución por día (barras de recharts, coloreadas por banda, con la línea de Loop); desglose por camión, obra, cliente y chofer (si hay choferes); y los viajes (o pedidos) detrás del número, peores primero, que llevan a su fila en la vista del día (se resalta).
- Control con los datos reales (23/09–05/10, solo lectura): ciclo con planta 141, en la calle 105, obra 51, ida 27, vuelta 28, en planta 36 (a mejorar), ralentí 31, 24,4 m³ y 3,6 viajes por camión por día, uso 55 %, 20,2 min/m³, 33,3 km, 12 min de paradas por viaje. Puntualidad y m³ por chofer sin datos todavía (sin pedidos con hora en esos viajes cruzados y sin choferes cargados).
- Pruebas: `npm run test:gps` 24/24 (7 nuevas en `lib/__tests__/kpis-logistica.test.mjs`: definiciones completas, bandas y bordes, exclusiones, días-camión, puntualidad, por día/desglose/peores primero, formato). Build OK, `tsc` 18 (igual que `main`). No se miró en el navegador (lo usaba Bautista).

### Pasos para publicar
1. Aplicar `supabase/migrations/202610052200_fase4a_viajes_gps.sql` en producción (solo agrega `viajes_gps` y `gps_reconstrucciones`; probada dos veces en `BEGIN … ROLLBACK`: 24 viajes reales, reproceso sin duplicar, índice único, no pisa ubicaciones manuales, FK al remito con `SET NULL`, anon lee). Regenerar `types/database.ts`.
2. Bautista mira el preview de la rama (`/logistica/tiempos`); antes de cargar, se puede controlar con `/api/gps/reconstruir?fecha=2026-10-02&simular=1`.
3. Merge a `main` (activa el cron de las 06:00).
4. Carga histórica: llamar `/api/gps/reconstruir?desde=…&hasta=…` semana por semana desde el 01/09/2025 hasta ayer (≈ 57 llamadas de ~15 s, de a una y con ~50 s entre llamadas: el freno permite 6 manuales cada 5 min). **Correrla dos veces** desde abril 2026: la segunda pasada usa las ubicaciones aprendidas en la primera y sube la confianza.
5. Controlar: `select fecha, count(*), count(dispatch_id), count(*) filter (where confianza='alta') from viajes_gps group by 1 order by 1 desc`, las obras con `gps_source='gps_aprendido'`, y 2 viajes contra B-Track.
