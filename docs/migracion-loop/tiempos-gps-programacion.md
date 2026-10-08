# Tiempos reales del GPS en la programación

Estado: **aprobado por Bautista (08/10/2026)**. Rama `loop/tiempos-gps-programacion` (sale de `main`).
Es la parte 6 de la Fase 4a ("Uso de los tiempos medidos, para la Fase 2"), que había quedado pendiente.

Leer antes: `README.md`, `fase-2.md` (viajes, 2b: `viaje_min` y `descarga_min` del pedido) y `fase-4a.md` (tabla `viajes_gps`).

## 1. Objetivo

Que los viajes de la programación se armen con **lo que tardan de verdad los camiones**, medido por el GPS,
en vez de los números fijos de la planta:

- **Por obra** (3 viajes GPS o más): la **descarga real** de esa obra y la **ida real** desde la planta que despacha.
  Ejemplo: CORDONES (Fideicomiso La Tercera) está 78 min por camión en obra; hoy se programa con 25.
- **Por planta** (obras nuevas o con pocos datos): el **tiempo en planta real** y la **descarga directa real**
  (y con bomba, si hay datos) de cada planta.
- **Se recalcula solo:** los números salen de `viajes_gps`, que el proceso de las 06:00 rehace cada noche.
- **Siempre se puede corregir a mano en el pedido**, como hoy (minutos de viaje, descarga, m³ por camión,
  minutos entre camiones). Al lado de cada número se dice de dónde sale: "real GPS · 12 viajes",
  "promedio de la planta · 412 viajes", "cargado a mano"…
- **Sugerencia de m³ por camión** para obras con un patrón claro (CORDONES: 3 m³ por camión).

### Alcance

- Solo para quien tiene **funciones nuevas** (`app_users.ve_funciones_nuevas`), igual que todo lo de la Fase 2:
  formulario del pedido (Semana), vista Día y gerenciador de viajes.
- Lo único que corre para todos es lo que ya corría: si un pedido **ya tiene viajes** y alguien lo edita,
  sus viajes pendientes se rearman (`regenerarViajesPedido`), y ahora con los tiempos reales. Así no quedan
  dos motores con números distintos.
- Sin el interruptor ninguna pantalla cambia. La vista Día "vieja" sigue con los tiempos de la planta.
- **No cambia la base de datos** (ver 4). No se tocan los tiempos guardados en la planta (`plants.t_*`).

Fuera de alcance: rearmar solos, de noche, los viajes ya guardados de pedidos futuros (los números nuevos se
usan cuando el pedido se guarda, se edita, se arma el plan del día o se abre el gerenciador); tiempos por
cliente; vuelta distinta de la ida.

## 2. Cómo se calcula cada número

### Viajes que se usan
De `viajes_gps`:
- `estado = 'completo'` y `confianza in ('alta','media')` (cruzados con su remito);
- de los **últimos 90 días** (por `fecha`);
- sin despachos por árido (`dispatches.is_test_dispatch`);
- se usa la **mediana**, no el promedio (un camión que se quedó 3 horas no corre el número).

Valores absurdos que se descartan, tramo por tramo:

| Tramo | Se usa si está entre | Por qué |
|---|---|---|
| Tiempo en planta (`min_en_planta`) | 1 y 240 min | más de 4 h es un camión guardado, no un ciclo |
| Ida (`min_ida`) | 1 y 180 min | |
| En obra (`min_obra`) | 8 y 240 min | menos de 8 min no es una descarga: el GPS no vio bien la parada (pasa en pavimentos, donde el camión avanza mientras descarga: PAVIMENTO de FARIÑA da 6 min) |
| m³ del remito | más de 0 y hasta 15 | |

### Por obra (`construction_site_id` del viaje GPS)
- **Ida real** = mediana de `min_ida` de los viajes **desde la planta del pedido** (la ida depende de la planta).
  Se usa con **3 viajes o más** desde esa planta. La vuelta del planificador sigue siendo igual a la ida.
- **Tiempo en obra real** = mediana de `min_obra` con **3 viajes o más** (de cualquier planta), junto con la
  mediana de los m³ de esos viajes.
- **Obra que el GPS no ve bien:** si en menos de la mitad de sus viajes hay una parada de obra válida (8 min o más),
  no se usan ni su ida ni su tiempo en obra: va lo de la planta. Pasa en los pavimentos (el camión avanza mientras
  descarga): PAVIMENTO de FARIÑA tiene 16 paradas válidas de 62 viajes, con 11 min en obra y 40 de "ida".
- **m³ sugeridos** = mediana de los m³ (redondeada a 0,5) si hay 3 viajes o más **y** al menos 2 de cada 3
  están a ±1 m³ de ella (patrón claro). Se muestra solo si difiere en 0,5 m³ o más de lo cargado en el pedido.

### Por planta (`plant_id_salida`)
- **Tiempo en planta real** = mediana de `min_en_planta` (llegada a planta → salida), con **10 viajes o más**.
- **Descarga directa real / con bomba real** = mediana de `min_obra` y de los m³ de los viajes con ese método,
  con **10 viajes o más**. El método sale del pedido (`metodo_descarga`); si no tiene, de la obra
  (`requires_pump`); si tampoco, directo (la misma regla del planificador).

### Cómo entran al planificador (sin contar nada dos veces)

El planificador arma cada viaje así: **carga → ida → descarga → lavado → vuelta**, y el camión vuelve a cargar
cuando vuelve a planta. La descarga se guarda **por camión de 8 m³** y cada viaje la usa proporcional a sus m³.

1. **Tiempo en obra → descarga por 8 m³.** El GPS mide la parada entera en la obra: descarga **más** el lavado
   y la salida. El planificador suma el lavado aparte, así que:

   `descarga por 8 m³ = (tiempo en obra − lavado de la planta) × 8 ÷ m³ del viaje`, mínimo 5.

   Con los m³ típicos de la obra, el viaje queda exactamente con el tiempo en obra real (descarga + lavado).
   CORDONES: (78 − 1) × 8 ÷ 3 ≈ 205 min por 8 m³; con 3 m³ por camión da 77 + 1 de lavado = 78 en obra.
   Por eso conviene aceptar la sugerencia de m³: si se dejan 8 m³, el planificador entiende que cada camión
   tarda 205 min en vaciar (es una obra lenta: cordones a mano).

2. **Tiempo en planta → carga + espera.** El tiempo en planta real (30–39 min) **no** es el tiempo de carga:
   incluye esperar, lavar el trompo y los papeles. Si se pusiera como carga, la boca quedaría ocupada 30–39 min
   por camión y el planificador creería que Canning carga menos de 2 camiones por hora, cuando el GPS muestra
   que el 25 % de las salidas de Canning salen a menos de 18 min de la anterior. Entonces se parte en dos:
   - **carga** = la de la planta (`t_carga_min`: Canning 15, Hudson 10): lo que la boca queda ocupada;
   - **espera en planta** = tiempo en planta real − carga (Canning 31 − 15 = 16; Hudson 38 − 10 = 28): lo que el
     camión, después de volver, tarda en poder cargar otra vez. No ocupa la boca.

   El ciclo del camión queda con el tiempo en planta real y la boca sigue con su ritmo. Parámetro nuevo
   `esperaPlantaMin` (en el motor, no en la base); con 0 el planificador da exactamente lo mismo que hoy.

3. **Ida real → minutos de viaje** del pedido.

4. **Ritmo y ciclo con el camión lleno del pedido.** El cálculo de flota ("un camión cada N min → hacen falta K
   camiones") usaba siempre la descarga de 8 m³. Con m³ por camión distinto de 8 queda mal (CORDONES: "un camión
   cada 205 min"), así que ahora usa la descarga de un camión con los m³ del pedido ("descarga 77 (3 m³) … un
   camión cada 77 min"). Con 8 m³ por camión da lo mismo que antes. Los horarios de los viajes no cambian por esto.

### Qué número se usa (orden de prioridad)

| Dato | 1.º | 2.º | 3.º | 4.º |
|---|---|---|---|---|
| Minutos de viaje | el del pedido (`viaje_min`, a mano o de la ruta del mapa) | real GPS de la obra desde esa planta | el de la obra (`travel_time_minutes`) | 30 |
| Descarga por 8 m³ | la del pedido (`descarga_min`, a mano) | real GPS de la obra | real GPS de la planta según el método | la de la planta (`t_descarga_*`) |
| Espera en planta | — | — | real GPS de la planta | 0 (como hoy) |
| m³ por camión | el del pedido (por defecto 8) | — sugerencia, no se aplica sola | | |

En el formulario, si la obra tiene ida real desde esa planta **ya no se completa sola con la ruta del mapa**
(la ruta se sigue mostrando como dato).

### Textos de la fuente
- "real GPS · 12 viajes" (de la obra), "promedio de la planta · 412 viajes" (de la planta);
- "cargado a mano" (lo escribió alguien), "ruta del mapa" (la propuso el mapa en este formulario),
  "cargado en el pedido" (minutos de viaje ya guardados: pueden venir del mapa o de alguien);
- "el de la obra", "de la planta", "de referencia".

## 3. Pantallas (todas con el interruptor)

- **Formulario del pedido (Semana):**
  - Placeholder de "Minutos de viaje": `24 (real GPS · 12 viajes)` y, debajo, "Se usa: 24 min · real GPS · 12 viajes".
  - Placeholder de "Descarga por camión de 8 m³": `205 (real GPS · 12 viajes)` / `25 (promedio de la planta · 412 viajes)` / `25 (la de la planta)`.
    Si es de la obra, debajo: "En esta obra cada camión estuvo 78 min (con 3 m³): son unos 205 min por cada 8 m³".
  - En "Viajes": "Esta obra suele llevar 3 m³ por camión (12 viajes, de 2 a 4)" con el botón **Usar 3 m³**.
  - "Empieza a cargar a las…", el choque en la boca y los horarios sugeridos usan los tiempos reales.
- **Vista Día:** por pedido, el viaje con su fuente; el cálculo de flota con el tiempo en planta
  ("Ciclo: en planta 31 (carga 15 + espera 16) + ida 24 + descarga 77 + lavado 1 + vuelta 24 = …") y la fuente
  de cada número; la sugerencia de m³. En "Tiempos y camiones", al lado de cada tiempo de la planta, el real del
  GPS ("real GPS: 25 min · 412 viajes · se usa en los viajes") y el tiempo en planta real. Los campos de la planta
  se siguen editando igual (quedan de respaldo y para quien no tiene el interruptor).
- **Gerenciador de viajes:** la propuesta, "Agregar viaje" y el cambio de m³ usan los tiempos reales; debajo del
  ciclo, de dónde sale cada número.
- **Actividad:** cuando se rearman los viajes de un pedido, una línea "Tiempos" con lo que se usó
  ("viaje 24 (real GPS · 12 viajes) · descarga 8 m³ 205 (real GPS · 12 viajes) · en planta 31").

Permisos: no hay nada nuevo que se edite. Lo que se cambia (m³ sugeridos, minutos) se guarda con el pedido,
que ya pasa por los permisos de `programacion` (`ajustaPedido`).

## 4. Dónde se guarda

**En ningún lado nuevo: no hace falta migración.** Se calcula en el momento desde `viajes_gps` (≈ 470 viajes en
90 días, una consulta paginada) y se guarda en memoria del navegador 10 minutos.

- "Recalculado todas las noches": `viajes_gps` solo cambia con el proceso de las 06:00 (`/api/gps/reconstruir`),
  así que los números quedan fijos durante el día y se actualizan solos cada mañana. No hace falta agregar un paso
  al cron.
- Se descartó guardar los resultados en `plants.t_*`: pisaría lo que cargó Bautista, cambiaría la programación de
  quien no tiene el interruptor y no hay dónde guardar lo de cada obra.
- Se descartó una tabla o vista nueva: agrega una migración y otra copia de la regla en SQL; con este volumen de
  datos no hace falta.
- `construction_sites.unload_time_minutes` sigue sin usarse (el motor nunca la usó; casi todas dicen 20).

Si `viajes_gps` no se puede leer, todo funciona como hoy (los tiempos de la planta).

## 5. Archivos que cambian

| Archivo | Cambio |
|---|---|
| `lib/gps-viajes.ts` | §5: reglas (`TIEMPOS_GPS`), `calcularTiemposGps()` (puro) y `cargarTiemposGps()` (lee `viajes_gps` + caché). Reemplaza `tiemposMedidos()`, que nadie usaba. |
| `lib/planificador.ts` | `esperaPlantaMin` opcional: el camión vuelve a estar libre `vuelta + espera`; el ciclo la suma. Con 0, igual que hoy. |
| `lib/viajes.ts` | `parametrosConGps()`, `conTiemposGps()`, `tiemposDelPedido()`, `textoFuente()`; el motor usa la descarga real de la obra; `explicarFlota` con el tiempo en planta; `regenerarViajesPedido` carga los tiempos reales y lo deja en Actividad. |
| `components/dispatch-scheduling.tsx` | Formulario: placeholders, fuentes, ruta que no pisa al GPS, sugerencia de m³. |
| `components/programacion-dia.tsx` | Vista Día: plan, flota, fuentes, m³ sugeridos y el real del GPS en "Tiempos y camiones". |
| `components/gerenciador-viajes.tsx` | Gerenciador con los tiempos reales y sus fuentes. |
| `lib/__tests__/tiempos-gps.test.mjs`, `package.json` | Pruebas de las funciones puras (en `npm run test:gps`). |

## 6. Criterios de aceptación

1. Pedido a CORDONES desde Canning, sin nada cargado a mano: el viaje usa la ida real (≈ 24 min, "real GPS · 12
   viajes") y la descarga real de la obra; con 3 m³ por camión cada camión queda ≈ 78 min en obra; aparece la
   sugerencia "Usar 3 m³".
2. Pedido a una obra sin viajes GPS: descarga = "promedio de la planta" según el método; viaje = el de la obra o 30.
3. Escribir minutos de viaje o de descarga en el pedido gana siempre y dice "cargado a mano".
4. El ciclo incluye el tiempo en planta real (carga + espera) y la boca de carga sigue ocupada solo la carga.
5. Con `esperaPlantaMin = 0` y sin tiempos GPS, el planificador y los viajes dan exactamente lo mismo que en `main`
   (días al azar comparados).
6. Sin el interruptor ninguna pantalla cambia. Si `viajes_gps` no responde, todo como hoy.
7. `tsc` sin errores nuevos (17 en `main`), `next build --webpack` limpio, `npm run test:gps` OK.

## 7. Riesgos

- **Cola en obra:** si los camiones esperan uno detrás del otro, el GPS cuenta esa espera como tiempo en obra y la
  descarga real sale más larga. La mediana lo suaviza; si una obra sale rara, se corrige en el pedido.
- **Proporcional a los m³:** el motor supone que la descarga crece con los m³. En obras con muchos m³ chicos
  (CORDONES) la descarga por 8 m³ queda grande (205): bien si se programa con los m³ habituales, exagerada si se
  dejan 8. Por eso la sugerencia de m³ se muestra al lado.
- **Pocos datos en Hudson:** ≈ 60 viajes en 90 días; pocas obras de Hudson llegan a 3 viajes.
- **Los números cambian solos cada mañana**: un pedido guardado ayer con una descarga y rearmado hoy puede moverse
  unos minutos. Queda en Actividad con los tiempos usados.
- **Minutos de viaje ya guardados por el mapa** (fase 2b) ganan sobre la ida real del GPS, porque no se sabe si
  los escribió alguien. Se pueden borrar en el pedido para que use el GPS.
- **Hoy casi ningún pedido viejo tiene método de descarga** (35 de 469 viajes): la descarga con bomba de la planta
  sale de pocos viajes. Canning tiene 18 (pasa el mínimo de 10): **38 min en obra contra los 15 de hoy**. Hudson
  tiene 2 y sigue con la de la planta. Los viajes sin método cuentan como directo.

## Ejemplos con datos reales (08/10/2026, solo lectura, viajes del 10/07 al 06/10)

Calculados con las mismas funciones y la misma consulta de la app (clave anon), pedido a las 08:00, directo.

**Plantas**

| | Tiempo en planta | Carga + espera | Directo: en obra → descarga 8 m³ | Con bomba |
|---|---|---|---|---|
| Canning | 31 min (410 viajes) | 15 + 16 | 30 min → **29** (320 viajes; hoy 25) | 38 min → **37** (18 viajes; hoy 15) |
| Hudson | 38 min (58 viajes) | 10 + 28 | 43 min → **33** (55 viajes; hoy 25; lavado 10) | sin datos: 15 (la de la planta) |

**CORDONES (Fideicomiso La Tercera) desde Canning, 12 m³**
- Tiempos: viaje 24 (real GPS · 12 viajes) · descarga 8 m³ 205 (real GPS · 12 viajes) · en planta 31.
- "En esta obra cada camión estuvo 78 min (con 3 m³, contando el lavado): son unos 205 min de descarga por cada
  8 m³". Sugerencia: **3 m³ por camión** (12 viajes, de 2 a 4).
- Con 3 m³ por camión: 4 viajes; llegan 08:00, 09:17, 10:34, 11:51; cada uno 77 min de descarga + 1 de lavado;
  "Ciclo: en planta 31 (carga 15 + espera 16) + ida 24 + descarga 77 (3 m³) + lavado 1 + vuelta 24 = 157 min · un
  camión cada 77 min → hacen falta 3 camiones". Hoy (sin GPS): llegan 08:00, 08:15, 08:30, 08:45 con 9 min de
  descarga cada uno.
- Si se dejan 8 m³ por camión: 8 + 4, el primero vacía de 08:00 a 11:25 (por eso la sugerencia).

**Obra común de Canning: Educación popular (INARCH), 24 m³ a 8**
- viaje 23 (real GPS · 20 viajes) · descarga 8 m³ 27 (real GPS · 20 viajes: 28 en obra) · en planta 31.
- Llegan 08:00, 08:27, 08:54; ciclo 105 min (hoy 101: carga 15 + ida 30 + descarga 25 + lavado 1 + vuelta 30).

**Obra de Hudson: PLATANOS (MERVA SA), 32 m³ a 8**
- viaje 15 (real GPS · 28 viajes) · descarga 8 m³ 33 (real GPS · 27 viajes: 43 en obra − 10 de lavado) · en planta 38.
- Llegan 08:00, 08:33, 09:06, 09:39 (hoy cada 25); ciclo 111 min (hoy 105); 4 camiones.

**Obra nueva** (sin viajes): desde Canning, viaje 30 (el de la obra), descarga 29 y en planta 31 (promedio de la
planta); desde Hudson, 30 / 33 / 38. **PAVIMENTO de FARIÑA** (el GPS no ve la descarga): igual que una obra nueva.

Hay 28 obras con datos en la ventana; las más usadas son PAVIMENTO y RESTAURANTE (La Tercera), PLATANOS, Educación
popular, PLATEA, ESTADIO y CORDONES.

## Hecho

**08/10/2026 — arquitecto y obrero (misma sesión).** Rama `loop/tiempos-gps-programacion` (local, sin push).
Commits: `5629e62` especificación, `0c3ff92` motor + pruebas, `88f108a` pantallas, más este registro.

**Sin migración.** No se toca la base: los números se calculan en el navegador desde `viajes_gps` (solo lectura).

### Qué se hizo
- `lib/gps-viajes.ts` §5: `TIEMPOS_GPS` (ventana 90 días, 3 viajes por obra, 10 por planta, límites, patrón de
  m³, obra visible), `calcularTiemposGps()`, `m3Sugerido()`, `filaTiemposDeConsulta()` y `cargarTiemposGps()`
  (consulta paginada, sin despachos por árido, caché de 10 min; si falla devuelve `null` y no queda en caché).
  Reemplaza `tiemposMedidos()`, que no usaba nadie. La consulta pide el pedido con
  `scheduled_dispatches!dispatches_scheduled_dispatch_id_fkey` (sin el nombre de la FK PostgREST da error de
  relación ambigua, porque `scheduled_dispatches` también tiene `dispatch_id`).
- `lib/planificador.ts`: `esperaPlantaMin` opcional (camión libre en `vuelta + espera`, también para los camiones
  ocupados en otros viajes; el ciclo la suma) y ritmo/ciclo con el camión lleno del pedido (punto 4 de §2).
- `lib/viajes.ts`: `viaje_min_gps` / `descarga_min_gps` en el pedido (no son columnas), `descargaPropiaDe()`,
  `descarga8DeObra()`, `esperaDePlanta()`, `parametrosConGps()`, `conTiemposGps()`, `tiemposDelPedido()`,
  `textoFuente()`, `textoTiempos()`, `textoDescargaObra()`, `m3ParaSugerir()`. `explicarFlota` muestra
  "en planta 31 (carga 15 + espera 16)". `regenerarViajesPedido` (corre también para quien no tiene el interruptor,
  solo si el pedido ya tiene viajes) carga los tiempos reales y suma en Actividad la línea "Tiempos" cuando alguno
  sale del GPS.
- Formulario del pedido: placeholders con la fuente, "Se usa: … · fuente" debajo de minutos de viaje y descarga,
  texto de la descarga de la obra, tiempo en planta real, "real GPS: 24 min (12 viajes), se usa ese" al lado de la
  ruta, la ruta del mapa ya no se escribe sola si hay ida real (y si se había escrito sola, se saca; lo escrito a
  mano o ya guardado no se toca), sugerencia "Usar 3 m³", y la salida programada con la ida real.
- Vista Día: plan, Ordenar el día, demanda, flota y "con N camiones…" con los tiempos reales; por pedido "viaje 24
  min (real GPS · 12 viajes)", la línea "Tiempos: …" y la sugerencia de m³. En "Tiempos y camiones", al lado de cada
  campo el real del GPS y un recuadro que explica carga + espera. Los campos siguen guardando lo de la planta.
- Gerenciador: propuesta, "Agregar viaje" y cambio de m³ con los tiempos reales; "Tiempos: …", descarga de la obra y
  sugerencia de m³ debajo del ciclo.
- Sin el interruptor no cambia ninguna pantalla (todo depende de `ve`; con `ve` apagado `prmEf = prm` y
  `pedidosEf = pedidos`).

### Verificación
- `npm run test:gps`: **39/39** (24 de antes + 15 nuevas en `lib/__tests__/tiempos-gps.test.mjs`: mediana,
  filtros, mínimos, obra no visible, m³ sugeridos, fila de la consulta, carga paginada/caché/error, descarga por
  8 m³ y espera, parámetros con GPS, elección de la fuente, viajes de CORDONES, texto de flota, espera 0 = sin
  espera, espera sin ocupar la boca). Para probar `lib/viajes.ts` (usa el alias `@/`) se agregó
  `lib/__tests__/alias.mjs` (`node --import`, sin dependencias). `npm run test:sesion` 21/21.
- Contra `main` (copias en el scratchpad, 1.000 días al azar): con 8 m³ por camión `planificar` da **idéntico**;
  con otros m³ los viajes y camiones son idénticos y solo cambia el resumen (ritmo/ciclo, punto 4). `generarViajes`
  (3.474 pedidos) y `planDelDia` idénticos sin tiempos GPS. La suite vieja del motor de la Fase 2: **66/66**.
- Con datos reales (solo lectura, clave anon, la consulta de la app): los ejemplos de arriba.
- `tsc`: 17 errores, los mismos que `main` (ninguno en los archivos tocados). `next build --webpack` limpio.
- No se miró en el navegador (regla de esta tarea): verlo en el preview.

### Para publicar
1. Bautista mira el preview (con su interruptor prendido): un pedido a CORDONES desde Canning (fuente "real GPS",
   sugerencia de 3 m³), uno a una obra nueva ("promedio de la planta"), la vista Día con "Tiempos y camiones" y el
   gerenciador.
2. Merge a `main`. No hay migración ni cambios en Vercel.

### Preguntas para Bautista
- **Bomba en Canning:** el GPS da 38 min en obra por camión con bomba (18 viajes) contra los 15 cargados. ¿Lo usamos
  (es lo que hace hoy) o preferís esperar más viajes con bomba (los pedidos viejos no tenían el método)?
- **Lavado de Canning en 1 min:** el GPS no separa descarga y lavado; con 1, casi todo el tiempo en obra cuenta como
  descarga. Si el lavado de verdad es en obra, conviene volver a 10 (no cambia el ciclo, solo el reparto).
- **Pedidos con minutos de viaje que puso el mapa** (fase 2b) siguen ganando sobre la ida real. ¿Los borramos para
  los pedidos futuros, así usan el GPS?
- ¿Querés poder corregir a mano los tiempos reales de la planta (hoy solo se corrigen pedido por pedido)?
