# Puente con Indumix (Canning) · fase 1 solo lectura, fase 2 diseñada (05/11/2026)

Repo Rebucret. Arquitecto → obrero → revisor. Rama sugerida: `loop/puente-indumix`.
Lee antes: `docs/migracion-loop/carga-planta.md` (puntos 3, 6, 9, 10 y 18 a 27 + "Hecho"). Esta spec **manda sobre
carga-planta.md** en lo que se contradiga.

## Objetivo

Hoy `/carga` funciona con una planta simulada. Con lo que se grabó el 04/11 en la PC de Canning ya se puede leer
Indumix de verdad. La fase 1 hace que el sistema vea la planta real (estado, reportes, recetas, totales y alarmas) y
que controle recetas, cargas cortas, humedad y Tolva 1. **No manda ninguna carga.** La fase 2 (mandar la carga) queda
diseñada, pero no se programa todavía.

## Lo que hay hoy (relevado en el código)

- `lib/carga/puente.ts`: `crearPuente("indumix")` tira error a propósito. El único adaptador es `SimuladorIndumix`, que
  corre en el navegador.
- Rutas que ya hacen casi todo lo que necesita el puente, pero piden **sesión de persona** (`exigirCarga`):
  - `POST /api/carga/recetas` guarda versiones de recetas, abre alertas de cambio y recalcula bloqueos;
  - `POST /api/carga/indumix` guarda el reporte de una carga, la une al remito (`emparejar`) y crea alertas.
- Las tablas de `202610211800_carga_planta.sql` ya están aplicadas: `puestos_carga`, `puesto_salidas`,
  `recetas_planta`, `recetas_planta_actual`, `puesto_recetas`, `cargas`, `cargas_materiales`, `cargas_eventos`,
  `cargas_agua_extra` y `alertas_carga`. El navegador solo lee. Escribe el servidor con la clave de servicio.
- Hay **un** puesto: "Canning · simulador", en etapa C. Por eso cada despacho de Canning que se hace desde la pantalla
  nueva manda una orden a la cola simulada.
- `cargarPuesto(plantId)` devuelve el **primer puesto activo** de la planta, ordenado por `created_at`. Lo usan `/carga`,
  la auditoría, `/formulas` y la Entrega.
- No hay pantalla para decir qué fórmula es cada receta: `puesto_recetas` solo se llena con "Armar las 20 recetas del
  simulador".
- En la vista "Otro equipo (solo mirar)" no se ven pesos: dice "Los pesos en vivo se ven en la PC de la planta".
- Mail diario de control MP: `lib/control-ingresos/servidor.ts` (`mandarMail`) y `mail.ts` (`armarMail`). Corre por cron
  a las 16:25 (`/api/control-ingresos/controlar`). El semanal ya suma una sección (`stockHtml`): la de carga va igual.

## Lo que muestran las grabaciones y cambia supuestos de carga-planta.md

| Supuesto anterior | Lo real (04/11) |
|---|---|
| Ciclo de 1,5 m³ | **2 m³ por ciclo** (`@GV.Registro.m3Ciclo = 2`). 8 m³ y 7,5 m³ = 4 ciclos |
| Reloj en 1/1/1970 cada día | Fecha real, **atrasada 3 a 4 h** (`@GV.FechaHoraActual = "5 : 37 - 4/11/2026"`). Formato con espacios: `"10 : 54 - 3/11/2026"`, sin segundos |
| "Contador carga" | `@GV.Cont_Ciclo` (13 en INICIO = `NCarga` del último reporte) |
| Protocolo a averiguar | POST XML para leer, GET `writeVal.exe` para escribir. Sin clave y sin CORS |
| Leer no escribe nada | **Leer un reporte o una receta exige escribir el número que se quiere ver** (`Receta.neReporte`, `Receta.neReceta`). Ver "Decisiones", 1 |

Datos reales de los 10 reportes del 03/11, que sirven de prueba (receta 15 «H40-6/20-15 B»):
- **N° 13**, 10:54 → 11:01 (hora del PLC), Observación `0961`, camión `AG 083`, 8 m³, 4 ciclos. Receta por m³: T1 925,
  T2 232, T3 696, R2 365, agua 170, aditivo 0. Teórico: T1 7400, R2 2920, agua 1360. Real: T1 7446, R2 2930,
  agua 1196.
- **N° 8** aparece dos veces (slots 6 y 7), 8:43 → 8:43, con **todo el real en 0**: son arranques cortados.
- **N° 5** (slot 10), 6:43 → 7:04, sin cliente, camión ni Observación (vienen los textos de relleno `Cliente`,
  `Camion`, `Observacion`), 7,5 m³. Cemento R1 real 2074 contra 2737,5 teórico (−24 %), T1 5208 contra 6938, agua
  extra 8 L. **Es una carga corta** (unos 3 de 4 ciclos).
- **N° 7** (slot 8): aditivo real 16130 g contra 22400 g (−28 %). La bomba de aditivo fallaba.
- En el día, el agua de la receta 15 cambió 150 → 170 → 160 → 170. El aditivo pasó de 3100 a 2900, a 2800 y a 0. El
  cemento pasó de la rosca 1 a la 2.
- Las patentes vienen incompletas y con guiones: `AG - 083`, `AF - 431`, `AE 402`.

---

# FASE 1 · Solo lectura

## Alcance

1. Programa puente en la PC de la planta. Lee Indumix y sube lo leído a `/api/carga/puente`.
2. Ruta `/api/carga/puente` con clave por puesto, y pantalla para generar la clave.
3. Puesto real "Canning · Indumix" en etapa A (lectura), con la base sin poder pasarlo a B o C.
4. `/carga` con datos reales para ese puesto (la vista de la PC de la planta y la de otro equipo son iguales en esta
   fase), "Cargas de hoy", recetas reales y la asignación receta ↔ fórmula.
5. Control de recetas y de cargas cortas en el mail diario de control MP.
6. Avisos de humedad y de Tolva 1.

## Fuera de alcance

- Escribir en Indumix cualquier cosa que no sea `Receta.neReporte` o `Receta.neReceta` (punto 1.4).
- CARGAR, PARAR, Suspender, Bocina, Extra agua y orden preparada: eso es la fase 2.
- Ajustar el stock con kilos reales: `usa_kilos_reales` sigue en `false`.
- Escuchar en un puerto: en la fase 1 el puente no abre ninguno, ni siquiera `127.0.0.1:8787`.
- "Leer ahora" desde la pantalla (un pedido de la nube al puente). Alcanza con la lectura de cada hora y la que se hace
  cuando cambia una receta.
- Aviso por mail o WhatsApp de "puente caído". En esta fase se ve en pantalla y en el mail diario.
- Hudson.
- Actualizar el puente solo desde la nube. Una versión nueva se instala a mano.

## 1. El programa puente

### 1.1 Tecnología: Node portable + un solo archivo `.mjs`, sin dependencias

- **Qué es.** Una carpeta `C:\Users\<usuario>\rebucret-puente\` con:
  - `node\node.exe`: Node 22 LTS win-x64 en zip, el oficial de nodejs.org. No va en el repo; lo baja quien instala;
  - `puente.mjs` y `indumix-xml.mjs`;
  - `config.json`, `instalar.cmd`, `iniciar.cmd` y `LEEME.md`.
- **Por qué.**
  - No necesita administrador ni instalador: `node.exe` es un ejecutable suelto, **firmado** por la OpenJS Foundation.
    Eso evita el aviso de SmartScreen y los antivirus que saltan con un `.exe` armado a mano.
  - Es el mismo lenguaje del sistema. `indumix-xml.mjs` se prueba con `node --test` igual que el resto, sin
    compilar.
  - `fetch` viene incluido: no hace falta ninguna dependencia de npm.
  - Como no escucha en ningún puerto, el firewall de Windows no pregunta nada.
- **Descartadas:**
  - *PowerShell:* no hay que bajar nada, pero es un tercer lenguaje, no se prueba con nuestros tests, la 5.1 tiene
    problemas con TLS y UTF-8, y la política de ejecución trae sorpresas;
  - *Ejecutable de Node empaquetado (SEA/pkg):* pierde la firma, hace saltar a los antivirus, necesita `postject` y
    armarlo para Windows desde la Mac es frágil;
  - *Servicio de Windows:* pide administrador.
- **Arranque solo.** `instalar.cmd` hace tres cosas:
  1. pide la clave y la guarda en `config.json`;
  2. copia un acceso a `iniciar.cmd` en `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup` (no pide
     administrador);
  3. arranca el puente.

  `iniciar.cmd` abre una ventana minimizada con el título "PUENTE REBUCRET · NO CERRAR" y relanza `node puente.mjs` a
  los 10 s si se cae. Como la PC queda prendida todo el día y tiene UPS, alcanza.
- Antes de instalar hay que confirmar que la PC tiene Windows 10 u 11 de 64 bits. Node 22 no corre en Windows 7.

### 1.2 Qué lee y cada cuánto

Las listas de variables y las cadencias **las baja de la nube** (`GET /api/carga/puente`, cada 5 min). Así se pueden
ajustar sin ir a la PC. Lo que puede escribir, en cambio, **está fijo en el código del puente** (1.4).

| Qué | Cada cuánto | Pedidos a Indumix |
|---|---|---|
| Estado (unas 60 variables de INICIO: receta, m³, cliente, camión, Observación, ciclos, Proceso, botones, parciales, `PD_O*`, humedades, agua extra, `Cont_Ciclo`, reloj, balanzas vacías, alarmas) | **3 s con carga en curso, 15 s quieta** | 1 POST |
| Último reporte (slot 1) | cuando sube `Cont_Ciclo` o `Proceso` pasa a "Fin" (a los 15 s), y cada 5 min | `neReporte=1` + 1 POST |
| Los 10 reportes | al arrancar y cada 30 min | 10 × (escritura + POST) |
| Las 20 recetas | al arrancar y cada 60 min, **solo con la planta quieta y nadie en RECETAS** (1.4) | 20 × (escritura + POST) |
| La receta N | cuando un reporte trae una receta por m³ distinta de la última versión guardada de N | 1 escritura + 1 POST |
| Totales (`Receta.ConsumoT.*`, `ConsumoP.*`) | cada 15 min y al terminar cada carga | 1 POST |
| Alarmas | van dentro del estado | — |

- **Cuidar al controlador.** Es un servidor web chico (InterNiche) que además atiende la pantalla de Indumix (102
  variables, 1,6 veces por segundo). Por eso:
  - nunca hay más de **un pedido a la vez**;
  - cada pedido tiene 3 s de tiempo máximo;
  - el puente mide la mediana de respuesta. Si pasa los 500 ms, duplica los intervalos solo y lo avisa en el latido.
- **Sin red con Indumix:** con 3 fallas seguidas manda el evento `sin_red_indumix` y reintenta cada 10 s. Cuando vuelve,
  manda `red_indumix_ok`.
- **Muestreo crudo para la fase 2:** durante 7 días (`muestrear_crudo_hasta`, viene en la config), con carga en curso,
  manda cada 30 s las variables crudas (`cargas_eventos` tipo `vivo_crudo`). Son unos 720 registros por día, unos
  25 MB en total. Sirve para entender los pesos en vivo sin otra grabación HAR.
- **Formato del pedido.** Mismo cuerpo que `hmi.js`: `<client>hmi.js</client>`, `client_ver 1.6.40.150.09` y el
  `file_name` de cada pantalla, tal cual sale del HAR. Lo arma `indumix-xml.mjs`. La respuesta se pasa a
  `{variable: texto}`: se recorta el espacio del final ("PLASTIF " → "PLASTIF") y "var not found" queda como `null`.

### 1.3 Cómo lo manda al servidor

- El **puente es tonto: no interpreta**. Manda las variables tal cual, con la hora de la PC (`at`). La lógica (qué es
  cada variable, reloj, alertas) está en el servidor (`lib/carga/indumix.ts`). Así se corrige con un deploy, sin tocar
  la PC.
- `Authorization: Bearer <clave>` en todos los pedidos.
- Cada envío lleva un id (`pedido`, UUID). Con eso, si se reintenta no se graba dos veces (`cargas_eventos.pedido` es
  único y los reportes tienen además su índice propio).
- **Sin internet:** lo que no se pudo subir queda en `cola\*.json` y se sube en orden cuando vuelve.
  - Los latidos viejos se descartan: solo vale el último.
  - Los reportes, las recetas y los totales **nunca se descartan**.
  - Máximo 50 MB.
- **Latido:** cada 5 s con carga en curso. Quieta, solo si cambió algo, y como mucho cada 60 s. Son unas 5.000
  llamadas por día a Vercel (plan Hobby). Revisar el uso la primera semana; si hace falta, se baja la cadencia desde la
  config.
- Registro local en `registro\AAAA-MM-DD.log`, que se guarda 14 días.

### 1.4 Seguridad del puente

- Habla **solo** con:
  - `http://192.168.0.10`: está en `config.json`, pero el puente rechaza cualquier dirección que no sea una IPv4
    privada;
  - `https://www.produccionrebucret.com`: fijo en el código.
  
  No abre ningún puerto.
- **Lista cerrada de escritura, fija en el código:** solo `Receta.neReporte` (1 a 10) y `Receta.neReceta` (1 a 20).
  Cualquier otra escritura tira error antes de salir. La nube no puede ampliar esta lista.
- **Resguardos al leer reportes y recetas:**
  - antes de cambiar el número, lee el que estaba y **al terminar lo deja como estaba**, y lo vuelve a leer para
    confirmar;
  - recetas: solo con la planta quieta (`Receta.Proceso = "Fin"`). Además, `Receta.neReceta` no tiene que haber
    cambiado en los últimos 2 minutos, porque si cambió es que alguien está navegando RECETAS en Indumix. Si no se
    cumple, la lectura se posterga 15 min. Lo mismo vale para `neReporte` con REPORTE.
  
  El riesgo que queda está en "Riesgos".
- La clave vive solo en `config.json`, en la PC, y en la base como hash (2). No va en el repo ni en el código.

## 2. La ruta `/api/carga/puente`

`app/api/carga/puente/route.ts`:
- **Clave:** se toma `Authorization: Bearer`, se calcula `sha256` y se busca en `puestos_carga_credenciales.hash`.
  - si no está: 401;
  - si el puesto no es `indumix`, está inactivo o está en `apagado`: 409 ("Puesto apagado"). El puente queda quieto y
    vuelve a probar cada 5 min.
  
  Se lee el cuerpo con un máximo de 512 KB. Nada de esto pasa por `exigirCarga` (no hay persona). El usuario que queda
  registrado es "Puente Canning".
- **`GET`** devuelve la config: puesto (id, nombre, etapa), listas de variables por grupo, cadencias,
  `muestrear_crudo_hasta` y `hora_servidor`. Con la hora, el puente avisa si el reloj de la PC está corrido más de
  2 min (evento `reloj_pc`).
- **`POST {tipo, at, version, pedido, ...}`**, según `tipo`:
  - `latido` `{variables}`:
    - el servidor arma el estado (`estadoDesdeVariables`) y lo graba en `puestos_carga.estado_vivo`, junto con
      `ultimo_latido_at`, `version_puente` y `deriva_reloj_s`;
    - lo compara con el estado anterior. Si cambió la receta elegida, controla la Tolva 1 (6). Si cambió la humedad,
      graba el evento `humedad` y controla la humedad (6). Si cambiaron las alarmas, graba `alarma` o `alarma_fin`.
  - `reportes` `{reportes: [{slot, variables, visto?: {inicio_at, fin_at, humedades}}]}`:
    - el servidor arma cada reporte (`reporteDesdeVariables`);
    - si lo pesado da todo 0, graba el evento `carga_sin_material` y **no crea carga**: así no chocan los dos N° 8;
    - si no, llama a `registrarReporte` (la lógica que hoy está en `/api/carga/indumix`, 4.2).
  - `recetas` `{recetas: [{numero, variables}], completa}`: el servidor arma cada receta (`recetaDesdeVariables`) y
    llama a `guardarRecetasLeidas` (la lógica de hoy de `/api/carga/recetas` sin `mapeo`, con la regla de 5.2).
  - `totales` `{variables}`: evento `totales`.
  - `eventos` `{eventos: [{tipo, at, detalle, pedido}]}`: errores del puente, arranque, `sin_red_indumix`, etc.
  
  Contesta `{ok, duplicado?}`. Un 4xx que no es 401 ni 409 aparta el envío en `cola\rechazados\` y no traba la cola:
  igual que hace hoy el simulador.
- **`POST /api/carga/puente/clave`** (sesión, `carga.editar` + gerencial) `{puesto_id}`:
  - genera 32 bytes al azar (`rbp_` + base64url);
  - guarda solo el `sha256`, reemplazando la clave anterior;
  - registra en Actividad "Clave del puente generada";
  - **devuelve la clave una sola vez**.

## 3. Base de datos

Migración `supabase/migrations/202611051200_carga_puente_indumix.sql`. Se puede correr más de una vez. **Se avisa a
Bautista antes de aplicarla.**

| Cambio | Para qué |
|---|---|
| `puestos_carga` + `ultimo_latido_at timestamptz`, `estado_vivo jsonb`, `version_puente text`, `deriva_reloj_s int`, `info_planta jsonb` (versión PD40 y nombres de tolvas `Txt*`) | Vista en vivo y salud del puente |
| Tabla nueva `puestos_carga_credenciales (puesto_id uuid PK → puestos_carga, hash text NOT NULL UNIQUE, creada_por text, creada_at timestamptz)`. RLS prendido, **sin** política, sin permisos para anon y authenticated; solo service_role | La clave no la puede leer el navegador. No va en `puestos_carga` porque esa tabla la lee anon |
| `CHECK puestos_carga_indumix_solo_lectura: sistema <> 'indumix' OR (etapa IN ('lectura','apagado') AND NOT usa_kilos_reales)` | Nadie puede pasar el puesto real a B o C, ni prender los kilos reales, hasta la migración de la fase 2 |
| Fila nueva "Canning · Indumix": `sistema 'indumix'`, `etapa 'lectura'`, `m3_max_ciclo 2`, `max_recetas 20` (`ON CONFLICT (plant_id, sistema) DO NOTHING`) | El puesto real |
| Su mapa en `puesto_salidas`, igual al del simulador (6.3, confirmado con `Txt*`). Tolva 1 arranca con **Piedra Partida 6/20**, con alternativas 6/12 y 6/20: el 03/11 la receta 15 (6/20) pesó por la Tolva 1. `cambiado_por = 'Migración (cargas del 03/11)'` | Qué material sale por cada tolva |
| `UPDATE puestos_carga SET activo = false` del simulador de Canning | `cargarPuesto` pasa a devolver el real ("Decisiones", 2) |

Las tablas `alertas_carga.tipo` y `cargas.estado` **no cambian**: alcanzan `humedad`, `tolva_material`,
`carga_desde_indumix`, `receta_cambiada`, `receta_nueva`, `reloj` y `leida`. `cargas_eventos.tipo` es texto libre.

**Qué pasa con los datos ya cargados:**
- El simulador y todo lo suyo (cargas simuladas, recetas armadas, alertas, órdenes en cola) **quedan intactos**, pero
  ya no se ven. Se recupera con `UPDATE … SET activo = true`. Las órdenes simuladas que hayan quedado pendientes no
  bajan a ningún lado.
- **Efecto visible:** los despachos de Canning de la pantalla nueva **dejan de mandar órdenes a la cola simulada** y de
  mandar el mail "[PLANTA SIMULADA]" a Juan, porque el puesto real está en lectura (`mandaOrdenes = false`).
- No cambian despachos, stock, fórmulas, materiales ni permisos. Las cargas reales se crean con `simulada = false`,
  `origen 'indumix'` y `estado 'leida'`. `ajustar_stock_carga` sigue sin hacer nada (`usa_kilos_reales = false`).
- Planta: la fila nueva usa el `plant_id` de `plants.name = 'Canning'`, como la migración anterior. (Acá no está el tema
  `villa-rosa` / `villa_rosa`: es de Concretus.)

## 4. Servidor: reusar lo que hay

### 4.1 `lib/carga/indumix.ts` (nuevo, puro, sin imports en tiempo de ejecución salvo `tipos`)

- `fechaPlc("10 : 54 - 3/11/2026")` devuelve `{anio, mes, dia, h, mi}`. Acepta espacios y también "4:57 - 1/1/1970".
- `derivaSegundos(plcTexto, puenteMs)` y `horaReal(plcTexto, derivaS)`. La resolución es de un minuto. Si la deriva
  cambia más de 2 min de un latido a otro, se graba el evento `reloj`. Si el año es 1970, se usa la lógica de
  `lib/carga/reloj.ts` (día de Indumix).
- `limpiarTexto`: los rellenos "Cliente", "Camion" y "Observacion" pasan a "".
- `estadoDesdeVariables(v)` devuelve `EstadoVivo`:
  - `proceso`, `en_ciclo` (Proceso ≠ "Fin");
  - receta (`@GV.nReceta`) y su nombre (`Receta_carga.Nombre`), m³, cliente, camión, Observación;
  - `ciclo` y `ciclos` (`NaCiclo` y `NCiclo`: **cuál es cuál se confirma con el muestreo crudo**), `m3_ciclo`;
  - `contador` (`Cont_Ciclo`), `humedades[4]` (`HumedadArido1-4`), objetivo por ciclo (`Parcial*`), pesado (`PD_O*`),
    agua extra (`Caudal_Agua_Extra`), balanzas vacías, tiempo de ciclo ("6:33  MM:ss"), reloj y alarmas.
  
  Lo que no se entiende queda en `null` y la pantalla muestra "—".
- `recetaDesdeVariables(numero, v)` devuelve una `RecetaPlanta`:
  - `Arido1-4` → `arido_1-4`, `Cemento1-2` → `cemento_1-2`, `Aditivo1-2` (g) → `aditivo_1-2`, `Agua1` (L) → `agua`;
  - `SecArido*` → `orden`, `Habilitado` → `habilitada`.
- `reporteDesdeVariables(v)` devuelve un `ReportePlanta`:
  - `R*` va a la receta por m³, `T*` al teórico y `C*` al real, y `CAguaExt` a `extras`;
  - `teorico_corregido`: con la humedad vista en vivo (`visto.humedades`) se calcula como hoy. Sin humedad queda en
    `null` y los áridos y el agua **no se evalúan** (se marcan "sin humedad");
  - `m3_cargados` se estima como m³ × mín(1, cemento real ÷ cemento teórico), redondeado a 0,1, y se marca estimado;
  - `parada` = real < 95 % del teórico de cemento.
- `alarmasDesdeVariables(v)`: `I1_PE`, `I8_QF`, `I6_SP`, `I7_OKAD`, `Falla_Celda`, `Falla_Analg`, `Falla_BAC` y
  `Falla_TAC` se muestran con su nombre y "(a confirmar con Egacom)". **En la fase 1 no van por mail:** `Falla_TAC`
  estuvo en 1 todo el 04/11.
- Las reglas de humedad y Tolva 1 (punto 6) van como funciones puras: `controlHumedad` y `controlTolva1`.

### 4.2 Sacar a funciones lo que hoy está dentro de las rutas, sin cambiar lo que hacen

En `lib/carga/servidor.ts`:
- `guardarRecetasLeidas(puesto, recetas, leidaAt)`: la rama sin `mapeo` de `/api/carga/recetas`;
- `registrarReporte(puesto, {reporte, materiales, inicio_at, fin_at, dia_planta, hora_estimada, pedido}, usuario)`: el
  cuerpo de `/api/carga/indumix`.

Las dos rutas de hoy las llaman igual. `npm run test:carga` (38) sigue en verde.

Cambios de comportamiento solo para un puesto `indumix` en etapa `lectura`:
- **Alerta de "carga desde Indumix":** en lectura, todas las cargas son "desde Indumix". Si se une a un remito, no se
  crea alerta. Si no, la alerta es "Carga N° 5 sin remito (Observación vacía)".
- **Emparejar por patente** (`lib/carga/auditoria.ts`): también valen si una es el comienzo de la otra, con 5 o más
  caracteres: "AG - 083" = AG083GT. Vale para todos los puestos.
- `dia_planta` = fecha del `HoraIni` del PLC. `inicio_at` y `fin_at` salen de lo que vio el puente en vivo; si no lo
  vio, de `horaReal`, con `hora_estimada = true`.
- **Huecos de contador:** si en un `dia_planta` falta un N° entre dos leídos, se graba el evento `cargas_perdidas`
  ("Faltan los N° 3 y 4: Indumix guarda solo 10") y va al mail.

## 5. Recetas: asignación y cambios

### 5.1 Qué fórmula es cada receta

- `POST /api/carga/recetas/asignar` (sesión, `carga.editar`) `{puesto_id, numero, formula_id | null, tipo}`:
  - hace upsert en `puesto_recetas`. Si la fórmula ya está en otro número, contesta "Ya está en la receta 7";
  - registra en Actividad;
  - llama a `sincronizarAlertasReceta` y `recalcularBloqueos`.
- En **Recetas de la planta** (`recetas-planta.tsx`), con un puesto `indumix`:
  - se ven las 20 recetas reales (nombre, valores y última lectura) y, en cada una, "Fórmula: [elegir]";
  - se sugiere la fórmula primero por las **cargas ya unidas a remitos**: la fórmula más repetida de los remitos de esa
    receta en 30 días. Si no hay, por el nombre: `interpretarNombre` de `lib/formulas-nombre.ts` sobre el nombre de
    Indumix, sacando la "/" ("H40-6/20-15 B" → H40-620-15 B);
  - se saca "Armar las 20 recetas del simulador";
  - "Etapa" muestra solo Apagado y A · Solo lectura;
  - se suma el bloque **Puente**: versión, último dato, deriva del reloj, mediana de respuesta y el botón "Generar clave
    del puente". La clave se ve una vez, con "Copiar" y el aviso "No se vuelve a mostrar".

### 5.2 Qué cambio de receta abre alerta (para no llenar de avisos)

Siempre se guarda la versión nueva y queda el evento. Pero la **alerta abierta** `receta_cambiada` solo se abre si
cambia algo que frena: el cemento, los áridos o el aditivo **por material**, comparados con `valoresReceta` y el mapa.
Por eso:
- un cambio **solo de agua** (150 → 170) graba el evento `receta_agua` y va al resumen del mail, sin alerta abierta;
- pasar el **mismo material** de una salida a otra (el cemento de la rosca 2 a la 1) graba el evento
  `receta_salida`, sin alerta.

## 6. Avisos de humedad y de Tolva 1

**Humedad** (`alertas_carga` tipo `humedad`, como mucho una abierta por día):
- **H1 · falta la de hoy:** a las 07:00, o en la primera carga del día si es antes, no hay `daily_stockpile_humidity`
  de hoy para Arena Fina de Canning. Texto: "Falta la humedad de la arena de hoy". Se cierra sola cuando se carga.
- **H2 · Indumix distinta:** `HumedadArido3` (ARENA) difiere en más de 1,5 puntos de la medida de hoy. Texto: "Humedad
  de la arena: Indumix 3 % · medida hoy 6 % (07:30)". Es la regla 6.6, que hoy solo está en la pantalla. Si en Indumix
  no cambió desde ayer, se suma "en Indumix no se cambió desde ayer". Se cierra sola cuando la diferencia vuelve a
  ≤ 1,5. No frena nada.

**Tolva 1** (`tolva_material`, una abierta a la vez):
- Cuando en el latido cambia `@GV.nReceta`, se mira qué piedra pide la receta nueva en la Tolva 1:
  - la piedra de la fórmula asignada, entre las alternativas de `arido_1`;
  - si no tiene fórmula, la que dice el nombre ("6/12" o "6/20").
- Se compara con la de la última carga leída o, si no hay, con la de `puesto_salidas` vigente. Si son distintas y la
  receta pesa algo en `Arido1`, salta el aviso: "¿Cambiaron la piedra de la Tolva 1? La receta 7 lleva 6/12 y lo
  último fue 6/20".
- Botón (`carga.cargar`): "Sí, ya tiene 6/12". Usa `/api/carga/salidas` (ya existe): queda en Actividad y en
  `puesto_salidas`, y cierra la alerta. Si vuelve la receta de antes, se cierra sola.

Las dos se ven:
- en `/carga`, como franja arriba, desde cualquier equipo;
- en Alertas;
- en el mail diario.

Para que el plantista vea el aviso de Tolva a tiempo, `/carga` tiene que estar abierta en la PC de la planta, en una
segunda ventana de Edge al lado de Indumix ("Preguntas", 4).

## 7. `/carga` con el puesto real (vista de la PC y de otro equipo)

Con `puesto.sistema === "indumix"`, en `components/carga/pantalla-carga.tsx`:
- **No aparece** el selector "Esta es la PC de la planta / Otro equipo": en la fase 1 todos ven lo mismo.
- **No aparecen** CARGAR, **PARAR**, Suspender, Bocina, Extra agua, Cancelar, "Simular…" ni el cartel de planta
  simulada. Un PARAR que no hace nada es peligroso.
- Línea fija: "Solo lectura: la planta se maneja desde Indumix".
- Barra de arriba:
  - chip "Indumix · solo lectura";
  - "Datos de hace 4 s", o en rojo "Sin datos del puente desde 12:34" si pasaron más de 2 min;
  - "Reloj de Indumix 5:37 (−3 h 24 min)".
- **Columna izquierda, "Cargas de hoy"** (en lugar de la cola): N°, hora, camión, remito unido o "sin remito", m³,
  receta y etiquetas suaves "corta", "desvío" y "agua extra". Al tocar una se abre el reporte que ya existe
  (`verReporte` / `ReporteCarga`).
- **Centro:** `PlantaVivo` y `TablaPesajes` con el estado de `puesto.estado_vivo`, que se pasa a `EstadoPlanta` con
  `estadoPlantaDeVivo` (en `lib/carga/indumix.ts`). Se muestran:
  - estado (QUIETA, EN CICLO, SUSPENDIDA, ALARMA), receta N «nombre», m³, ciclo, cliente, camión y Observación;
  - objetivo y pesado por salida, humedades y alarmas.
  
  Lo que llega en `null` se ve como "—". Se refresca cada 5 s, como hoy.
- **Derecha:** la carga elegida, con el control de receta contra la fórmula del remito (`compararReceta`, usando la
  receta por m³ del reporte), real contra teórico y cómo se unió.
- Franjas de humedad, Tolva 1, receta cambiada y alarmas.
- `/carga/auditoria` y la "Receta de la planta" de `/formulas` no cambian de código: leen el puesto real solas.

## 8. Mail diario: control de fórmulas y cargas cortas

- `lib/carga/control-mail.ts` (puro) tiene `seccionCarga(datos)`, que devuelve `{html, n}`.
- `lib/carga/control-servidor.ts` tiene `datosControlCarga(sb, desde, hasta)`, para el puesto `indumix` activo. Lo
  llama `mandarMail` con desde = el último mail mandado y hasta = ahora, dentro de un `try` propio. Si falla, el mail de
  remitos sale igual, con la línea "Carga de planta: no se pudo armar".
- Si no hay puesto `indumix` activo, **la sección no va y el mail queda igual que hoy**.

La sección "Carga de planta · Canning" se arma en este orden, cada parte solo si tiene algo:
1. **Receta distinta de la fórmula**, agrupada por receta, fórmula y diferencia. Ejemplo: "Receta 15 (H40-6/20-15 B)
   contra H40-620-15 B (CAN): aditivo 0 contra 3,1 kg/m³ · 6 cargas (0955 a 0961)". Lo que frena va en rojo y el agua
   en ámbar. Usa la receta por m³ del reporte contra `formula_materials` del remito (`compararReceta`).
2. **Cargas cortas o con desvío**, una por carga: remito, camión, hora, fórmula, m³ del remito contra m³ de Indumix,
   cemento real contra teórico (kg y %), aditivo y, si hay humedad, áridos y agua. Entra:
   - toda carga con desvío de pesaje (6.2: cemento 1 %, áridos 2 %, agua y aditivo 3 %);
   - con `m3_cargados` 0,1 m³ o más por debajo del remito;
   - o con `parada`.
3. **Sin remito / sin carga / perdidas:** cargas sin remito, despachos de Canning sin carga (solo de los días en que el
   puente mandó datos) y huecos de contador.
4. **Cambios de receta en Indumix**, resumidos por receta: "Receta 15: agua 150 → 170 → 160 → 170 · aditivo 2800 → 0
   g (08:43) · cemento pasó a la rosca 2".
5. **Humedad y Tolva 1**: una línea por aviso del período.
6. Pie: "N cargas leídas · último dato del puente 16:20".

- **Diario:** solo lo nuevo desde el mail anterior, como los remitos. **Semanal (lunes):** además, las 20 recetas que
  hoy no coinciden con su fórmula.
- **Asunto:**
  - si la sección tiene diferencias (partes 1 a 3), se suma "· N de carga de planta". Ejemplo: "Rebucret · Control de
    ingresos MP: sin inconsistencias hoy · 3 de carga de planta";
  - sin diferencias, el asunto no cambia y la sección es una línea: "Carga de planta: 14 cargas leídas, sin
    diferencias".
- `armarMail` recibe un parámetro opcional `carga?: {html, n}`. Sin ese parámetro, el asunto y el HTML son
  **idénticos** a los de hoy. Las pruebas de `test:control-ingresos` lo cubren.

## 9. Archivos

**Nuevos:**
- `puente-carga/puente.mjs`, `puente-carga/indumix-xml.mjs` (arma el XML, lee la respuesta, la lista cerrada de
  escritura y `urlEscritura`), `config.ejemplo.json`, `instalar.cmd`, `iniciar.cmd` y `LEEME.md` (cómo instalar, en
  pasos cortos).
- `app/api/carga/puente/route.ts`, `app/api/carga/puente/clave/route.ts` y `app/api/carga/recetas/asignar/route.ts`.
  Patrón: las rutas de `app/api/carga/*` (`respuestaError`, `sbServicio`, `registrarActividad`).
- `lib/carga/indumix.ts`, `lib/carga/puente-servidor.ts` (verificar la clave y despachar por `tipo`),
  `lib/carga/control-mail.ts` y `lib/carga/control-servidor.ts`.
- `supabase/migrations/202611051200_carga_puente_indumix.sql`. Patrón: `202610211800_carga_planta.sql` (comentario
  "Qué pasa con los datos ya cargados", idempotente, `NOTIFY pgrst`). Se prueba en `BEGIN … ROLLBACK`.
- `lib/__fixtures__/indumix/` (10) y `lib/__tests__/carga-indumix.test.mjs`, que se suma al script `test:carga` de
  `package.json`. **Sin dependencias nuevas.**

**A modificar:**
- `lib/carga/puente.ts`: el comentario y el error de `crearPuente("indumix")`, que pasa a decir "El puente real es un
  programa aparte en la PC de la planta (fase 1, solo lectura)".
- `lib/carga/tipos.ts`: tipo `EstadoVivo`; `teorico_corregido` puede ser `null`.
- `lib/carga/reloj.ts`: fechas reales y deriva.
- `lib/carga/datos.ts`: `Puesto` suma `estado_vivo`, `ultimo_latido_at`, `version_puente` y `deriva_reloj_s`.
- `lib/carga/servidor.ts` (4.2) y `lib/carga/auditoria.ts` (patente por prefijo).
- `app/api/carga/recetas/route.ts` y `app/api/carga/indumix/route.ts`: llaman a las funciones de 4.2.
- `app/api/carga/puesto/route.ts`: rechaza `orden` y `arranque` para un puesto `indumix`, con el texto "El puesto real
  está en solo lectura hasta la fase 2".
- `components/carga/pantalla-carga.tsx`, `planta-vivo.tsx` (acepta datos que faltan), `recetas-planta.tsx` y
  `alertas-carga.tsx` (botón de Tolva 1).
- `lib/control-ingresos/servidor.ts` y `mail.ts` (8).
- `docs/migracion-loop/carga-planta.md`: en "Hecho", lo de esta fase y las correcciones de la tabla de arriba.

## 10. Datos de prueba (fixtures chicos, sin la grabación entera)

Los arma el obrero desde los HAR del 04/11. El original está en el Drive de plantacanning, carpeta
`1txv0yTEMmk5EUe2OM4Tg0GDe8n1zUgmX`; la copia del scratchpad ya no está. Cada archivo pesa menos de 20 KB y va sin
cookies ni encabezados. En `lib/__fixtures__/indumix/`:

| Archivo | De qué grabación | Qué tiene |
|---|---|---|
| `README.md` | — | Origen, fecha y qué se recortó |
| `pedido-inicio.xml` | inicio-quieto | Cuerpo de un pedido de `hmi.js`, recortado a 10 variables |
| `respuesta-inicio-quieto.xml` | inicio-quieto | Las ~100 variables de INICIO, incluidas las "var not found" |
| `respuesta-reporte-slot1.xml`, `-slot6.xml`, `-slot10.xml` | reporte | N° 13 normal, N° 8 sin material y N° 5 corta |
| `reportes-03-11.json` | reporte | Los 10 reportes como `{variable: texto}` |
| `respuesta-receta-15.xml` | recetas | Receta 15 completa |
| `receta-15-guardar.json` | guardar-receta | Antes y después del cambio de cemento de la rosca 2 a la 1 |
| `respuesta-totales.xml` | alarma (ESTADÍSTICA) | `ConsumoT.*` y `ConsumoP.*` |
| `respuesta-alarma.xml` | alarma | Con `Main.Falla_TAC = 1` |
| `escritura.txt` | seleccion | Un GET `writeVal.exe` y su respuesta (sirve también para la fase 2) |

**Pruebas (`carga-indumix.test.mjs`), con valores esperados reales:**
1. **XML:** `indumix-xml.mjs` arma un pedido equivalente a `pedido-inicio.xml`. La respuesta da "PLASTIF" sin espacio
   final, y "var not found" da `null`.
2. **Reloj:**
   - `fechaPlc("10 : 54 - 3/11/2026")` = 03/11/2026 10:54, y "4:57 - 1/1/1970" también se entiende;
   - con el PLC en "5 : 37 - 4/11/2026" y el puente en 04/11 09:01 (AR), la deriva da 3 h 24 min, y el N° 13 queda
     con inicio estimado 03/11 14:18 y `hora_estimada`.
3. **Reporte N° 13:**
   - receta 15, 8 m³, 4 ciclos, Observación "0961", camión "AG 083";
   - `cemento_2`: teórico 2920, real 2930, sin desvío (+0,3 %); agua: teórico 1360, real 1196.
4. **N° 8:** los dos (slots 6 y 7) dan `carga_sin_material`, ninguna carga y ningún choque de índice.
5. **N° 5:**
   - cliente, camión y Observación vacíos, así que queda "sin remito";
   - cemento 2074 contra 2737,5 (−24 %), `m3_cargados` 5,7 estimado, `parada`, agua extra 8 L. Va a "Cargas cortas".
6. **N° 7:** aditivo 16130 contra 22400 g (−28 %): desvío de aditivo.
7. **Receta 15:** de `respuesta-receta-15.xml` sale T1 925, T2 232, T3 696, cemento 365, agua y aditivo como en el
   archivo.
   - Antes y después del cambio de rosca, la huella cambia y `compararReceta` da lo mismo: evento `receta_salida`, sin
     alerta.
   - Solo agua (150 → 170): evento `receta_agua`, sin alerta.
   - Aditivo 2800 → 0: alerta `receta_cambiada`.
8. **Emparejar:**
   - "AG - 083" con Observación "0958" contra el despacho 958 del AG083GT: "por remito";
   - sin Observación, a 10 min: "por camión y hora";
   - "AG083" contra "AE402GT": no se unen.
9. **Escritura:**
   - `escrituraPermitida("Receta.neReporte", 3)` sí;
   - `("Receta.neReceta", 21)` no;
   - `("@GV.nReceta", 15)` no;
   - `("@GV.Registro.m3Carga", 8)` no;
   - la URL sale como `writeVal.exe?Receta.neReporte+3`, codificada como en `escritura.txt`.
10. **Humedad:**
    - Indumix 3 % contra medida 6 %: H2;
    - contra 4 %: nada;
    - sin medida de hoy a las 07:00: H1.
11. **Tolva 1:**
    - de la receta 15 (6/20) a una 6/12: aviso;
    - a otra 6/20: nada;
    - a una con `Arido1 = 0`: nada.
12. **Clave:** `verificarClave` con la clave buena da el puesto, con otra da `null`, y con el puesto en apagado da 409.
13. **Mail:**
    - `seccionCarga` con N° 5, N° 7 y N° 13 unidos da "Cargas cortas o con desvío (2)" y "Sin remito (1)";
    - `armarMail` sin `carga` da exactamente el asunto y el HTML de hoy.
14. `test:carga` (38), `test:control-ingresos` y `test:despacho` siguen en verde. `tsc` sin errores nuevos y
    `next build --webpack` bien.

## 11. Criterios de aceptación (con el puente andando en Canning)

1. **Instalación sin administrador:** se descomprime la carpeta, se corre `instalar.cmd`, se pega la clave y queda
   andando. Después de reiniciar la PC, arranca solo al iniciar sesión.
2. **Vista en vivo:** desde el celular, `/carga` de Canning muestra:
   - "Indumix · solo lectura" y "Datos de hace ≤ 10 s";
   - la receta elegida en Indumix con su nombre, los m³ y la humedad de la arena;
   - un cambio de receta en Indumix se ve en menos de 20 s.
3. **Sin botones de mando:** en ningún equipo aparecen CARGAR, PARAR, Suspender, Bocina ni Extra agua con el puesto
   real. Etapa ofrece solo Apagado y A. Un `UPDATE` a etapa `orden` lo rechaza la base (CHECK).
4. **Cargas:** cada carga terminada aparece en "Cargas de hoy" y en la Auditoría en menos de 2 min, unida a su remito
   cuando Observación tiene el número. Con el puente reiniciado 3 veces en el día, **no se duplica ninguna** (misma
   cantidad de filas en `cargas`).
5. **Recetas:** en menos de 5 min desde el primer arranque están las 20 en Recetas de la planta. Mientras hay una carga
   en curso o alguien navega RECETAS, no se barren: se ve en el registro del puente ("pospuesta").
6. **Cortes:**
   - sin internet 10 min: al volver se sube todo, sin duplicados;
   - sin cable a Indumix: aparece "Sin red con Indumix" y, al volver, sigue sola.
7. **Seguridad:**
   - `netstat` no muestra al puente escuchando en ningún puerto;
   - el registro solo tiene pedidos a 192.168.0.10 y a www.produccionrebucret.com;
   - en el código, la única escritura posible es `neReporte` y `neReceta` (lo verifica el revisor).
8. **La planta no cambia:** una semana sin quejas del plantista por lentitud de la pantalla de Indumix ni por RECETAS
   que "saltan". La mediana de respuesta del controlador queda en el bloque Puente.
9. **Mail del lunes siguiente:** con la sección "Carga de planta · Canning". Sin puesto real, el mail es idéntico al de
   hoy.
10. **Datos ya cargados:** antes y después de la migración son iguales los conteos de `cargas`, `recetas_planta` y
    `alertas_carga` del simulador, de `dispatches` y de `stock_movements`.

---

# FASE 2 · Mandar la carga (solo diseño, no se programa)

Antes de programarla tienen que estar tres cosas:
- la grabación que falta;
- el OK escrito de Egacom;
- 2 semanas de la fase 1 sin problemas.

Sigue valiendo lo de carga-planta.md 3.2:
- permiso firmado de 60 s y un solo uso;
- la página de la PC habla con el puente en `127.0.0.1:8787`, con control de `Origin`;
- la nube nunca manda arrancar;
- PARAR sin permiso.

**Qué se escribe.** Se amplía la lista cerrada del puente, en una versión nueva que se instala a mano:
- `@GV.nReceta` (1 a 20), `@GV.Registro.m3Carga`, `@GV.Cliente` (20 caracteres, sin tildes hasta ver cómo las
  codifica), `@GV.Camion` (patente para la planta, "AG 083 GT") y `@GV.Observacion` (remito "0961", 30 caracteres);
- `@GV.nSecuencia` no se escribe: se controla que sea 1 (REBUCRET) y, si no, frena.

**Cómo se confirma:**
1. Planta quieta (`Proceso = "Fin"`, sin alarmas, balanzas vacías).
2. Se escribe campo por campo, primero la receta.
3. Se lee todo de vuelta. Además, `Receta_carga.Nombre` tiene que ser el de la receta controlada, y
   `NCiclo` = ⌈m³ ÷ 2⌉.
4. Se vuelve a leer la receta N y se compara la huella.
5. En la **etapa B** termina ahí: el plantista aprieta CARGAR en Indumix. En la **etapa C**, CARGAR (variable según la
   grabación que falta).

Cualquier diferencia corta y no arranca nada (`PuenteConAdaptador.cargarYArrancar` ya hace esos pasos).

**Límites y validaciones.** Las hace el puente; Indumix no valida nada: aceptó la receta 0 y la 21.
- Receta entre 1 y 20, y asignada a la fórmula del remito.
- m³ > 0, como máximo `mixers.capacity_m3` y 8.
- Kilos por ciclo, con humedad: áridos ≤ `PD_Arido_Max` (4100) y cemento ≤ `PD_Cemento_Max` (900). Para la receta 15:
  2 m³ × 1853 kg = 3706 y 730 kg.
- Nunca se escribe con una carga en curso.

**Recetas rotativas 19 y 20.** Para una fórmula sin número:
- el puente escribe la receta en el rotativo que no se usó hace más tiempo y que no está en ninguna orden en cola. Lo
  hace con `Receta.neReceta = N`, los `Receta.Receta_Editar.*` y después `Receta.beReceta` 1 y 0;
- la lee de vuelta y compara la huella. Queda la versión en `recetas_planta`, con Actividad;
- solo con la planta quieta, **nunca de la 1 a la 18**;
- es "escribir recetas", que carga-planta.md dejó afuera: necesita el OK escrito de Egacom y que Bautista diga qué
  fórmulas rotan.

**Qué falta capturar** (HAR de la pantalla de Indumix, con el plantista):
- una carga real completa con CARGAR, SUSPENDER y Reanudar, y PARAR a mitad: qué variable es cada botón y si es pulso
  (1 y después 0) o se mantiene;
- Bocina (`Main.PBBocina`) y Extra agua (¿`Caudal_Agua_Extra`?);
- la selección escrita a mano: cómo viajan en `writeVal` los espacios, las tildes y la ñ, el largo máximo y si Indumix
  rechaza escrituras con una carga en curso.

El muestreo crudo de la fase 1 confirma cuál es `NaCiclo` y cuál `NCiclo`, y cómo se mueven los pesos.

**Prueba en vacío.** Preguntarle antes a Egacom qué hace `@GV.Simulacion = 1` (¿pesa sin mover material? ¿saltea
seguridades?). **Nuestro sistema nunca la escribe.** Si Egacom dice que sirve:
1. la prende Egacom o el plantista desde PARÁMETROS, con Bautista presente y sin camión;
2. se hacen 5 cargas de prueba: Cargar, Suspender, Reanudar, PARAR a mitad y Bocina;
3. se firma la lista en carga-planta.md.

Después vienen la etapa B (1 a 2 semanas) y la C.

---

## Seguridad y riesgos

- **La planta no tiene clave en la red.** Cualquier equipo conectado a la red de la planta (cable o wifi) puede leer y
  **escribir** cualquier variable de Indumix con un GET, incluido arrancar una carga. Esto pasa hoy, con puente o sin
  él. Recomendaciones:
  1. **wifi de la planta con clave WPA2/WPA3**, que no se comparta con choferes ni visitas (red de invitados aparte);
  2. si se puede, que el controlador (192.168.0.10) quede solo en la red de cable de la PC, sin llegada desde el wifi;
  3. preguntarle a Egacom si el servidor web puede pedir usuario y clave.
- **La PC de la planta pasa a tener internet y acceso a la planta a la vez.** El puente no abre puertos, solo habla con
  dos direcciones y en la fase 1 no puede escribir nada que mueva la planta. El riesgo es el de la PC: actualizaciones
  de Windows al día, sin programas de más y sin acceso remoto abierto.
- **Leer reportes y recetas escribe el número que se mira** (`neReporte`, `neReceta`):
  - si alguien está mirando REPORTE o RECETAS en Indumix en ese momento, la pantalla cambia sola unos segundos;
  - **peor caso:** alguien está editando una receta justo cuando el puente cambia el número. Podría perder lo que
    estaba tipeando o, si el buffer se recarga y aprieta GUARDAR, guardar sobre otra receta.
  
  Los resguardos de 1.4 (planta quieta, nadie navegando hace 2 min, se deja todo como estaba) bajan mucho la chance.
  Se le avisa al plantista. Se le pregunta a Egacom si hay variables para leer las 20 recetas y los 10 reportes **sin
  cambiar el número** (arreglos): con eso desaparece la escritura.
- **Clave robada:** con la clave se pueden subir datos falsos (alertas o cargas inventadas), pero no mandar nada a la
  planta. Se cambia con "Generar clave del puente", que invalida la anterior.
- **Se pierden reportes** si el puente está caído más de 10 cargas. Se ve en el mail ("cargas perdidas").
- **Uso de Vercel Hobby:** unas 5.000 llamadas por día. Se mira la primera semana.

## Decisiones (para registrar)

1. **La fase 1 escribe solo `Receta.neReporte` y `Receta.neReceta`**, con lista cerrada en el código del puente y
   restaurando el valor. Es la única forma de leer reportes y recetas que se vio. *Descartado:* no leer recetas y quedarse
   con la receta del reporte de cada carga. Se pierde el control previo de las 20 y el aviso de cambios antes de usarlas.
2. **Un solo puesto activo por planta:** el real reemplaza al simulador, que queda inactivo con sus datos. *Descartado:*
   tener los dos activos con un selector, porque `cargarPuesto` lo usan cinco pantallas y la Entrega; y dejar el
   simulador en C, porque sigue mandando órdenes y mails simulados.
3. **Puente tonto, lógica en el servidor:** el puente manda variables crudas y el servidor las interpreta. Se corrige
   con un deploy. *Descartado:* interpretar en el puente, porque cada corrección exige ir a la PC.
4. **Node portable + `.mjs` sin dependencias, en la carpeta del usuario, con arranque desde la carpeta Inicio.**
   *Descartados:* PowerShell, ejecutable empaquetado y servicio de Windows (1.1).
5. **Clave por puesto con hash en una tabla que el navegador no lee**, generada desde la pantalla por Bautista.
   *Descartado:* variable de entorno en Vercel, porque cambiarla pide un deploy y es una por planta.
6. **El puesto real no puede salir de solo lectura por un CHECK de la base**, hasta la migración de la fase 2.
7. **Ciclo de 2 m³ y reloj con deriva** (no 1970): corrigen carga-planta.md.
8. **No toda modificación de receta abre alerta:** solo lo que frena. El agua y los cambios de salida van al resumen.

## Preguntas para Bautista (con recomendación)

1. **¿Está bien que la "solo lectura" escriba el número de reporte o receta que se mira?** Recomiendo **sí**, con los
   resguardos, y pedirle a Egacom la lectura sin escribir.
2. **¿Se apaga el simulador de Canning?** Hoy está en etapa C: cada despacho de Canning de la pantalla nueva manda una
   orden simulada. Recomiendo **sí**: se prende de nuevo con una línea.
3. **Humedad: ¿dónde la carga Titan todos los días, en Indumix, en el sistema (el aviso del Despacho) o en los dos?**
   Recomiendo controlar las dos: H1 (falta la de hoy en el sistema) y H2 (Indumix distinta de la medida).
4. **¿Va a estar `/carga` abierta en la PC de la planta, al lado de Indumix?** Sin eso, el aviso de Tolva 1 lo ve solo
   la oficina. Recomiendo **sí**, en una segunda ventana de Edge.
5. **Aditivo a mano mientras la bomba está rota:** ¿se avisa igual? Recomiendo **sí, agrupado** (una línea por receta y
   fórmula, no una por carga) y no ocultarlo.
6. **Wifi de la planta:** ¿tiene clave hoy? ¿Quién lo administra?
