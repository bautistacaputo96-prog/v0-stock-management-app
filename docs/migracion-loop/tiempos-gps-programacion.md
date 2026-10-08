# Tiempos reales del GPS en la programación

Estado: **aprobado por Bautista (08/10/2026)**; revisión del 08/10 con dos arreglos y decisiones nuevas de Bautista
(sección 8), ya incorporadas. Rama `loop/tiempos-gps-programacion` (sale de `main`).
Es la parte 6 de la Fase 4a ("Uso de los tiempos medidos, para la Fase 2"), que había quedado pendiente.

Leer antes: `README.md`, `fase-2.md` (viajes, 2b: `viaje_min` y `descarga_min` del pedido) y `fase-4a.md` (tabla `viajes_gps`).

## 1. Objetivo

Que los viajes de la programación se armen con **lo que tardan de verdad los camiones**, medido por el GPS,
en vez de los números fijos de la planta:

- **Por obra** (3 viajes GPS o más, de 2 días o más): la **descarga real** de esa obra y la **ida real** desde la
  planta que despacha. Ejemplo: CORDONES (Fideicomiso La Tercera) está 78 min por camión en obra con 3 m³; hoy se
  programa con 25 por cada 8 m³.
- **Por planta** (obras nuevas o con pocos datos): el **tiempo en planta real** y la **descarga directa y con bomba
  reales** de cada planta.
- **Se recalcula solo:** los números salen de `viajes_gps`, que el proceso de las 06:00 rehace cada noche.
- **Siempre se puede corregir a mano**: en el pedido, como hoy (minutos de viaje, descarga, m³ por camión, minutos
  entre camiones), y los tiempos reales de cada planta (gerencial). Al lado de cada número se dice de dónde sale:
  "real GPS · 12 viajes", "promedio de la planta · 268 viajes", "cargado a mano"…
- **Sugerencia de m³ por camión** para obras con un patrón claro (CORDONES: 3 m³ por camión).

### Alcance

- Solo para quien tiene **funciones nuevas** (`app_users.ve_funciones_nuevas`), igual que todo lo de la Fase 2:
  formulario del pedido (Semana), vista Día y gerenciador de viajes.
- Lo único que corre para todos es lo que ya corría: si un pedido **ya tiene viajes** y alguien lo edita,
  sus viajes pendientes se rearman (`regenerarViajesPedido`), y ahora con los tiempos reales. Así no quedan
  dos motores con números distintos.
- Sin el interruptor ninguna pantalla cambia. La vista Día "vieja" sigue con los tiempos de la planta.
- **Para todos (decisión de Bautista):** el lavado de las dos plantas pasa a 0 (migración, ver 4).

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
  Se usa con **3 viajes o más de 2 días distintos o más** desde esa planta (Etcheverry tenía 113 min de ida con
  viajes de un solo día). La vuelta del planificador sigue siendo igual a la ida.
- **Tiempo en obra real** = mediana de `min_obra` con **3 viajes o más de 2 días o más** (de cualquier planta),
  junto con la mediana de los m³ de esos viajes y cuántos fueron con bomba y cuántos directos. Si mezcla los dos
  métodos, la pantalla lo dice ("mezcla viajes con bomba (2) y directos (9)").
- **Obra que el GPS no ve bien:** si en menos de la mitad de sus viajes hay una parada de obra válida (8 min o más),
  no se usan ni su ida ni su tiempo en obra: va lo de la planta. Pasa en los pavimentos (el camión avanza mientras
  descarga): PAVIMENTO de FARIÑA tiene 16 paradas válidas de 62 viajes, con 11 min en obra y 40 de "ida".
- **m³ sugeridos** = mediana de los m³ (redondeada a 0,5) si hay 3 viajes o más **y** al menos 2 de cada 3
  están a ±1 m³ de ella (patrón claro). Se muestra solo si difiere en 0,5 m³ o más de lo cargado en el pedido.

### Por planta (`plant_id_salida`)
- **Tiempo en planta real** = mediana de `min_en_planta` (llegada a planta → salida), con **10 viajes o más**,
  **sin el primer viaje del día de cada camión** (su `min_en_planta` mide desde que arrancó el motor: mediana
  65–67 min) **ni los viajes sin llegada previa a planta o con la llegada de otro día**. Canning 25 min, Hudson 32.
- **Descarga directa real / con bomba real** = mediana de `min_obra` y de los m³ de los viajes con ese método,
  con **10 viajes o más** (Bautista: la de bomba de Canning se usa con sus 18 viajes, y se muestra la cantidad).
  El método sale del pedido (`metodo_descarga`); si no tiene, de la obra (`requires_pump`); si tampoco, directo
  (la misma regla del planificador).

### Cómo entran al planificador (sin contar nada dos veces)

El planificador arma cada viaje así: **carga → ida → descarga → lavado → vuelta**, y el camión vuelve a cargar
cuando vuelve a planta. La descarga se guarda **por camión de 8 m³** y cada viaje la usa proporcional a sus m³.

1. **Tiempo en obra → descarga por 8 m³.** El GPS mide la parada entera en la obra: descarga **más** el lavado
   y la salida. El planificador suma el lavado aparte, así que:

   `descarga por 8 m³ = (tiempo en obra − lavado de la planta) × 8 ÷ m³ típicos de la obra`, mínimo 5.

   Con el lavado en 0 (decisión de Bautista), todo el tiempo en obra cuenta como descarga.
   CORDONES: 78 × 8 ÷ 3 ≈ 208 min por 8 m³; con 3 m³ por camión da 78 en obra.

   **Solo con m³ parecidos:** la descarga de la obra se usa si los m³ por camión del pedido están a **±1,5 m³** de
   los típicos de la obra. Si no, llevarla a otros m³ da números absurdos (La huella: 78 min con 2 m³ → 312 por
   8 m³; con 8 m³ por camión serían 312 min por camión). En ese caso se usa la descarga de la planta y la pantalla
   avisa: "Esta obra suele llevar 2 m³; con 8 m³ por camión se usan los tiempos de la planta". Vale también para
   `regenerarViajesPedido`, que corre para todos.

2. **Tiempo en planta → carga + espera.** El tiempo en planta real (25–32 min) **no** es el tiempo de carga:
   incluye esperar y los papeles. Si se pusiera como carga, la boca quedaría ocupada 25–32 min por camión y el
   planificador creería que Canning carga 2 camiones por hora, cuando el GPS muestra que el 25 % de las salidas de
   Canning salen a menos de 18 min de la anterior. Entonces se parte en dos:
   - **carga** = la de la planta (`t_carga_min`: Canning 15, Hudson 10): lo que la boca queda ocupada;
   - **espera en planta** = tiempo en planta real − carga (Canning 25 − 15 = 10; Hudson 32 − 10 = 22): lo que el
     camión, después de volver, tarda en poder cargar otra vez. No ocupa la boca.

   El ciclo del camión queda con el tiempo en planta real y la boca sigue con su ritmo. Parámetro nuevo
   `esperaPlantaMin` (en el motor); con 0 el planificador da exactamente lo mismo que hoy.

3. **Ida real → minutos de viaje** del pedido.

4. **Ritmo y ciclo con el camión lleno del pedido.** El cálculo de flota ("un camión cada N min → hacen falta K
   camiones") usaba siempre la descarga de 8 m³. Con m³ por camión distinto de 8 queda mal (CORDONES: "un camión
   cada 208 min"), así que ahora usa la descarga de un camión con los m³ del pedido ("descarga 78 (3 m³) … un
   camión cada 78 min"). Con 8 m³ por camión da lo mismo que antes. Los horarios de los viajes no cambian por esto.

### Qué número se usa (orden de prioridad)

| Dato | 1.º | 2.º | 3.º | 4.º |
|---|---|---|---|---|
| Minutos de viaje | el del pedido (`viaje_min`) | real GPS de la obra desde esa planta | el de la obra (`travel_time_minutes`) | 30 |
| Descarga por 8 m³ | la del pedido (`descarga_min`, a mano) | real GPS de la obra (si los m³ son parecidos) | de la planta: a mano > real GPS según el método > `t_descarga_*` | |
| Espera en planta | — | — | de la planta: a mano > real GPS | 0 (como hoy) |
| Carga | la de la planta (`t_carga_min`, siempre a mano) | | | |
| m³ por camión | el del pedido (por defecto 8) | — sugerencia, no se aplica sola | | |

En el formulario, si la obra tiene ida real desde esa planta **ya no se completa sola con la ruta del mapa**
(la ruta se sigue mostrando como dato). Los minutos de viaje que el mapa ya guardó en pedidos futuros se borran
con un script el día de la publicación (ver 8).

### Textos de la fuente
- "real GPS · 12 viajes" (de la obra), "promedio de la planta · 268 viajes" (de la planta);
- "cargado a mano" (lo escribió alguien en el pedido o, en "Tiempos y camiones", en la planta),
  "cargado a mano en la planta" (al lado del pedido, cuando sale de lo corregido en la planta),
  "ruta del mapa" (la propuso el mapa en este formulario), "cargado en el pedido" (minutos de viaje ya guardados);
- "el de la obra", "de la planta", "de referencia".

## 3. Pantallas (todas con el interruptor)

- **Formulario del pedido (Semana):**
  - Placeholder de "Minutos de viaje": `24 (real GPS · 12 viajes)` y, debajo, "Se usa: 24 min · real GPS · 12 viajes".
  - Placeholder de "Descarga por camión de 8 m³": `208 (real GPS · 12 viajes)` / `30 (promedio de la planta · 320 viajes)` / `25 (la de la planta)`.
    Si es de la obra, debajo: "En esta obra cada camión estuvo 78 min (con 3 m³, contando el lavado): son unos 208
    min de descarga por cada 8 m³"; si la obra lleva otros m³: "Esta obra suele llevar 3 m³; con 8 m³ por camión se
    usan los tiempos de la planta".
  - En "Viajes": "Esta obra suele llevar 3 m³ por camión (12 viajes, de 2 a 4)" con el botón **Usar 3 m³**.
  - "Empieza a cargar a las…", el choque en la boca y los horarios sugeridos usan los tiempos reales.
- **Vista Día:** por pedido, el viaje con su fuente; el cálculo de flota con el tiempo en planta
  ("Ciclo: en planta 25 (carga 15 + espera 10) + ida 24 + descarga 78 (3 m³) + lavado 0 + vuelta 24 = …") y la
  fuente de cada número; la sugerencia de m³. En "Tiempos y camiones":
  - los campos de siempre (el lavado ahora acepta 0);
  - al lado de las descargas, lo que usan los viajes con su fuente;
  - el recuadro **"Tiempos reales de la planta"**: tiempo en planta, directo y con bomba del GPS, y una fila por
    espera, descarga directa y descarga con bomba con el valor que se usa, la fuente ("real GPS · N viajes" o
    "cargado a mano (GPS: X)") y, para un gerencial, **"Corregir a mano"** / **"Volver a automático"**. Se guarda con
    el botón de siempre ("Guardar tiempos de…", con motivo) y queda en Actividad.
- **Gerenciador de viajes:** la propuesta, "Agregar viaje" y el cambio de m³ usan los tiempos reales; debajo del
  ciclo, de dónde sale cada número.
- **Actividad:** cuando se rearman los viajes de un pedido, una línea "Tiempos" con lo que se usó
  ("viaje 24 (real GPS · 12 viajes) · descarga 8 m³ 208 (real GPS · 12 viajes) · en planta 25 (…)").
- Textos: "camión" / "camiones" y "viaje" / "viajes" según la cantidad ("hace falta 1 camión").

Permisos: corregir los tiempos de la planta pide `programacion.editar` (el mismo de los tiempos de planta de hoy).
Lo del pedido (m³ sugeridos, minutos) se guarda con el pedido, que ya pasa por `ajustaPedido`.

## 4. Dónde se guarda

Los tiempos reales **no se guardan**: se calculan en el momento desde `viajes_gps` (≈ 470 viajes en 90 días, una
consulta paginada) y quedan 10 minutos en memoria del navegador.

- "Recalculado todas las noches": `viajes_gps` solo cambia con el proceso de las 06:00 (`/api/gps/reconstruir`),
  así que los números quedan fijos durante el día y se actualizan solos cada mañana. No hace falta un paso en el cron.
- Si la lectura falla, **tarda más de 3 s** o **viene vacía** (por ejemplo, con RLS en la 0c-2 sin permiso), se sigue
  con los tiempos de la planta y no se guarda en la caché (se reintenta). Anotado en `fase-0c.md` (0c-2).
- `construction_sites.unload_time_minutes` sigue sin usarse (el motor nunca la usó; casi todas dicen 20).

**Migración `supabase/migrations/202610081800_lavado_cero_tiempos_a_mano.sql`** (sin aplicar; probada dos veces en
`BEGIN … ROLLBACK`):
- `plants.t_lavado_min`: el CHECK pasa de `> 0` a `>= 0`, y se pone en **0 en Hudson (estaba 10) y Canning (estaba
  1)**, con una entrada en Actividad por planta. **Efecto para todos, también en `main`:** el ciclo que calcula la
  programación se acorta (Hudson 10 min por viaje, Canning 1). No cambia viajes ya guardados ni despachos.
- `plants.tiempos_a_mano jsonb NOT NULL DEFAULT '{}'` (claves `espera_planta_min`, `descarga_directa_min`,
  `descarga_bomba_min`, con su CHECK): lo corregido a mano por planta. `{}` = todo automático (como hoy). El front
  solo manda la columna si existe, así la rama funciona antes y después de aplicarla.

**Script `scripts/2026-10-08-borrar-viaje-min-pedidos-futuros.sql`** (se corre una vez, el día de la publicación):
muestra cuántos y cuáles pedidos toca y después, en una transacción, pone `viaje_min = null` en los pedidos con
llegada desde hoy (hora de Argentina) que no están completos ni cancelados, con Actividad por pedido. No toca los
viajes ya armados (se recalculan al editar el pedido o guardar el plan del día).

## 5. Archivos que cambian

| Archivo | Cambio |
|---|---|
| `lib/gps-viajes.ts` | §5: reglas (`TIEMPOS_GPS`), `noCuentaEnPlanta()`, `calcularTiemposGps()` (puro) y `cargarTiemposGps()` (lee `viajes_gps`, 3 s, caché). Reemplaza `tiemposMedidos()`, que nadie usaba. |
| `lib/planificador.ts` | `esperaPlantaMin` y `aMano` opcionales; `tiemposAManoDe` / `tiemposAManoAColumna`; ritmo/ciclo con el camión lleno. Con espera 0, igual que hoy. |
| `lib/viajes.ts` | `parametrosConGps()`, `conTiemposGps()`, `tiemposDelPedido()`, textos; la descarga de la obra con ±1,5 m³; `explicarFlota` con el tiempo en planta; `regenerarViajesPedido` con los tiempos reales y Actividad. |
| `components/dispatch-scheduling.tsx` | Formulario: placeholders, fuentes, ruta que no pisa al GPS, sugerencia de m³. |
| `components/programacion-dia.tsx` | Vista Día: plan, flota, fuentes, m³ sugeridos, tiempos reales de la planta con corrección a mano, lavado 0. |
| `components/gerenciador-viajes.tsx` | Gerenciador con los tiempos reales y sus fuentes. |
| `supabase/migrations/202610081800_…sql`, `scripts/2026-10-08-…sql` | Lavado 0 y `tiempos_a_mano`; borrar `viaje_min` de pedidos futuros. |
| `lib/__tests__/tiempos-gps.test.mjs`, `lib/__tests__/alias.mjs`, `package.json` | Pruebas de las funciones puras (en `npm run test:gps`). |

## 6. Criterios de aceptación

1. Pedido a CORDONES desde Canning con 3 m³ por camión: viaje 24 ("real GPS · 12 viajes"), cada camión 78 min en
   obra. Con 8 m³ por camión: descarga de la planta y el aviso "Esta obra suele llevar 3 m³…", más "Usar 3 m³".
2. Pedido a una obra sin viajes GPS: descarga = "promedio de la planta" según el método; viaje = el de la obra o 30.
3. Escribir minutos de viaje o de descarga en el pedido gana siempre y dice "cargado a mano". Un tiempo de planta
   corregido a mano gana al GPS hasta "Volver a automático".
4. El ciclo incluye el tiempo en planta real (carga + espera) y la boca de carga sigue ocupada solo la carga.
5. Con `esperaPlantaMin = 0` y sin tiempos GPS, el planificador y los viajes dan exactamente lo mismo que en `main`
   (días al azar comparados). El lavado 0 funciona en el planificador, el formulario y la fórmula de descarga.
6. Sin el interruptor ninguna pantalla cambia (salvo que el lavado puede ser 0). Si `viajes_gps` no responde, todo
   como hoy.
7. `tsc` sin errores nuevos (17 en `main`), `next build --webpack` limpio, `npm run test:gps` OK, migración dos
   veces en `BEGIN … ROLLBACK`.

## 7. Riesgos

- **Cola en obra:** si los camiones esperan uno detrás del otro, el GPS cuenta esa espera como tiempo en obra y la
  descarga real sale más larga. La mediana lo suaviza; si una obra sale rara, se corrige en el pedido.
- **Proporcional a los m³:** el motor supone que la descarga crece con los m³. Por eso la descarga de la obra solo se
  usa con m³ parecidos a los habituales (±1,5) y al lado va la sugerencia de m³.
- **Pocos datos en Hudson:** 37 viajes para el tiempo en planta y 55 para la descarga en 90 días; pocas obras de
  Hudson llegan a 3 viajes de 2 días.
- **Los números cambian solos cada mañana**: un pedido guardado ayer y rearmado hoy puede moverse unos minutos.
  Queda en Actividad con los tiempos usados.
- **Bomba con pocos viajes:** casi ningún pedido viejo tiene método de descarga (35 de 469 viajes). Canning tiene 18
  con bomba: 38 min en obra contra los 15 de hoy (se usa, decisión de Bautista). Hudson tiene 2 y sigue con 15. Los
  viajes sin método cuentan como directo.
- **Lavado 0 para todos:** el ciclo de la programación vieja también se acorta (ver 4).

## Ejemplos con datos reales (08/10/2026, solo lectura, viajes del 10/07 al 06/10, lavado 0)

Calculados con las mismas funciones y la misma consulta de la app (clave anon), pedido a las 08:00, directo.
"Hoy" = `main` con los tiempos guardados hoy en la planta (lavado Canning 1, Hudson 10).

**Plantas**

| | Tiempo en planta | Carga + espera | Directo: en obra → descarga 8 m³ | Con bomba |
|---|---|---|---|---|
| Canning | 25 min (268 viajes) | 15 + 10 | 30 min → **30** (320 viajes; hoy 25) | 38 min → **38** (18 viajes; hoy 15) |
| Hudson | 32 min (37 viajes) | 10 + 22 | 43 min → **43** (55 viajes; hoy 25) | sin datos: 15 (la de la planta) |

**CORDONES (Fideicomiso La Tercera) desde Canning, 12 m³**
- Con **3 m³ por camión**: viaje 24 (real GPS · 12 viajes) · descarga 8 m³ 208 (real GPS · 12 viajes) · en planta 25.
  4 viajes; llegan 08:00, 09:18, 10:36, 11:54; cada uno 78 min en obra; "Ciclo: en planta 25 (carga 15 + espera
  10) + ida 24 + descarga 78 (3 m³) + lavado 0 + vuelta 24 = 151 min · un camión cada 78 min → hacen falta 2
  camiones". Hoy (sin GPS): llegan 08:00, 08:15, 08:30, 08:45 con 9 min de descarga cada uno.
- Con **8 m³ por camión**: "Esta obra suele llevar 3 m³; con 8 m³ por camión se usan los tiempos de la planta"
  (descarga 30) y la sugerencia **Usar 3 m³** (12 viajes, de 2 a 4).

**Obra común de Canning: Educación popular (INARCH), 24 m³ a 8**
- viaje 23 (real GPS · 20 viajes) · descarga 8 m³ 28 (real GPS · 20 viajes) · en planta 25.
- Llegan 08:00, 08:28, 08:56; ciclo 99 min (hoy 101).

**Obra de Hudson: PLATANOS (MERVA SA), 32 m³ a 8**
- viaje 15 (real GPS · 28 viajes) · descarga 8 m³ 43 (real GPS · 27 viajes) · en planta 32 (carga 10 + espera 22).
- Llegan 08:00, 08:43, 09:26, 10:09 (hoy cada 25); ciclo 105 min; 3 camiones (hoy 4).

**La huella (Canning), 8 m³ a 8:** el GPS da 78 min con 2 m³; con 8 m³ por camión usa la planta (30), no 312.
**Etcheverry:** sus 113 min de ida desde Canning y 61 desde Hudson eran de un solo día: ahora usa el de la obra (30).
**Obra nueva:** desde Canning, viaje 30, descarga 30 (con bomba 38), en planta 25; desde Hudson, 30 / 43 / 32.
**PAVIMENTO de FARIÑA** (el GPS no ve la descarga): igual que una obra nueva.

## 8. Revisión y decisiones del 08/10/2026

Revisión: **rechazada con dos arreglos** (tiempo en planta con el primer viaje del día; descarga llevada a 8 m³ sin
límite) y menores (2 días por obra, 3 s, nota para la 0c-2, aviso de mezcla bomba/directo, camión/camiones).
Decisiones de Bautista: (1) usar la bomba real de Canning con sus 18 viajes; (2) lavado en 0 en las dos plantas;
(3) los pedidos futuros usan el GPS: borrar los minutos de viaje del mapa con un script el día de la publicación;
(4) un gerencial corrige a mano los tiempos reales de cada planta (carga, espera, descarga directa y con bomba).
Todo resuelto (ver "Hecho").

## Hecho

**08/10/2026 — arquitecto y obrero (misma sesión).** Rama `loop/tiempos-gps-programacion` (local, sin push).
Commits: `5629e62` especificación, `0c3ff92` motor + pruebas, `88f108a` pantallas, `54dc661` registro;
después de la revisión: `883e641` arreglos y decisiones, `84335c0` migración + script + nota 0c-2, más este registro.

### Qué se hizo
- `lib/gps-viajes.ts` §5: `TIEMPOS_GPS` (ventana 90 días, 3 viajes y 2 días por obra, 10 por planta, límites,
  patrón de m³, obra visible, 3 s), `noCuentaEnPlanta()` (primer viaje del día por camión, sin llegada previa o de
  otro día), `calcularTiemposGps()`, `m3Sugerido()`, `filaTiemposDeConsulta()` y `cargarTiemposGps()` (consulta
  paginada con `mixer_id, fecha, salida_planta, llegada_planta_previa`, sin despachos por árido, caché de 10 min;
  si falla, tarda más de 3 s o viene vacía devuelve `null` y no queda en caché). Reemplaza `tiemposMedidos()`.
  La consulta pide el pedido con `scheduled_dispatches!dispatches_scheduled_dispatch_id_fkey` (sin el nombre de la
  FK PostgREST da error de relación ambigua, porque `scheduled_dispatches` también tiene `dispatch_id`).
- `lib/planificador.ts`: `esperaPlantaMin` (camión libre en `vuelta + espera`, también para los camiones ocupados en
  otros viajes; el ciclo la suma), ritmo/ciclo con el camión lleno del pedido, `aMano` (de `plants.tiempos_a_mano`,
  solo si la columna existe; `columnasDePlanta` la manda solo entonces) y el lavado 0 respetado.
- `lib/viajes.ts`: `viaje_min_gps` / `descarga_min_gps` en el pedido (no son columnas), `descargaPropiaDe()`,
  `descarga8DeObra()`, `esperaDePlanta()`, `TOLERANCIA_M3_OBRA` (1,5), `parametrosConGps()` (GPS y encima lo a mano),
  `conTiemposGps()`, `tiemposDelPedido()` (con `obraNoAplica` y la fuente "planta_a_mano"), `textoFuente()`,
  `textoTiempos()`, `textoDescargaObra()`, `textoMezclaMetodos()`, `m3ParaSugerir()`. `explicarFlota` con el tiempo
  en planta y "hace falta 1 camión"; `textoConMenosCamiones` con "camión". `regenerarViajesPedido` (corre también
  para quien no tiene el interruptor, solo si el pedido ya tiene viajes) carga los tiempos reales y suma en Actividad
  la línea "Tiempos" cuando alguno sale del GPS.
- Formulario del pedido: placeholders con la fuente, "Se usa: … · fuente", texto de la descarga de la obra (o el
  aviso de otros m³), tiempo en planta real, "real GPS: 24 min (12 viajes), se usa ese" al lado de la ruta, la ruta
  del mapa ya no se escribe sola si hay ida real, sugerencia "Usar 3 m³" (calculada con los m³ por camión del
  formulario), la salida programada con la ida real y "viaje / viajes".
- Vista Día: plan, Ordenar el día, demanda, flota y "con N camiones…" con los tiempos reales; por pedido el viaje con
  su fuente, la línea "Tiempos: …", la descarga de la obra o el aviso y la sugerencia de m³. "Tiempos y camiones":
  lavado con 0, lo que usan los viajes al lado de las descargas y el recuadro de tiempos reales con "Corregir a mano"
  / "Volver a automático" (gerencial; se guarda con el motivo y la Actividad de siempre, "Tiempos reales corregidos
  a mano: automático (GPS) → espera 10 · descarga directa 29"). Plurales en los avisos.
- Gerenciador: propuesta, "Agregar viaje" y cambio de m³ con los tiempos reales; "Tiempos: …", descarga de la obra y
  sugerencia de m³ debajo del ciclo.
- Sin el interruptor no cambia ninguna pantalla (todo depende de `ve`), salvo que el lavado de la planta acepta 0.
- Migración `202610081800` y script de pedidos futuros (sección 4). `fase-0c.md`: nota en la 0c-2 con las columnas
  que lee la programación y la lectura vacía.

### Verificación
- `npm run test:gps`: **44/44** (24 de antes + 20 en `lib/__tests__/tiempos-gps.test.mjs`, entre ellas: primer viaje
  del día y llegada previa, 2 días por obra (Etcheverry), bomba con 10 viajes, lectura vacía y demora, La huella y
  CORDONES con 8 m³, mezcla bomba/directo, tiempos a mano (gana al GPS, sin GPS, volver a automático, columna ↔
  parámetros, sin columna no se manda), lavado 0 en el planificador y en los viajes, "hace falta 1 camión").
  `npm run test:sesion` 21/21.
- Contra `main` (copias en el scratchpad, 1.000 días al azar): con 8 m³ por camión `planificar` da **idéntico**;
  con otros m³ los viajes y camiones son idénticos y solo cambia el resumen (ritmo/ciclo). `generarViajes`
  (3.474 pedidos) y `planDelDia` idénticos sin tiempos GPS. La suite vieja del motor de la Fase 2: **66/66**.
- Migración **dos veces en `BEGIN … ROLLBACK`** (cada corrida la aplica dos veces): 14/14 — lavado 0 en las dos
  plantas, Actividad una por planta ("10 → 0", "1 → 0") y la segunda aplicación no suma nada, CHECKs nuevos, lavado
  −1 rechazado, `tiempos_a_mano` válido se guarda y con texto, 0 o lista se rechaza, `anon` guarda y lee la columna
  (como "Guardar tiempos"), el script toca un pedido pendiente de mañana (queda en null, con Actividad) y no uno
  completo; después del ROLLBACK producción quedó igual (lavado 1 y 10, sin la columna). **Nada se aplicó.**
  Hoy el script tocaría 0 pedidos (no hay pedidos futuros con minutos de viaje).
- Con datos reales (solo lectura, clave anon, la consulta de la app): los ejemplos de arriba.
- `tsc`: 17 errores, los mismos que `main` (ninguno en los archivos tocados). `next build --webpack` limpio.
- No se miró en el navegador (regla de esta tarea): verlo en el preview.

### Para publicar
1. Aplicar `supabase/migrations/202610081800_lavado_cero_tiempos_a_mano.sql` (avisando a Bautista: acorta el ciclo
   para todos). Regenerar `types/database.ts`.
2. Bautista mira el preview (con su interruptor prendido): CORDONES desde Canning con 8 y con 3 m³, una obra nueva,
   la vista Día con "Tiempos y camiones" (corregir a mano y volver a automático) y el gerenciador.
3. Merge a `main`. No hay cambios en Vercel.
4. Ese día, fuera del horario de despacho: correr `scripts/2026-10-08-borrar-viaje-min-pedidos-futuros.sql` (primero
   el paso 1 para ver cuántos toca).
