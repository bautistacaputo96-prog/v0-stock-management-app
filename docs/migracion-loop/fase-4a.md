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
_(lo completa la sesión obrero)_
