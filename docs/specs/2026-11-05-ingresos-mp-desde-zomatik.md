# Ingresos de materia prima desde Zomatik

Estado: **propuesta del arquitecto (05/11/2026), pendiente de aprobación de Bautista.** Sin código.
Rama sugerida: `feat/ingresos-mp-zomatik` (desde `main`). Leer antes: `docs/control-ingresos-mp.md`,
`docs/control-stock-mp.md` y `docs/migracion-loop/zomatik.md` (23 y 24: sucursal, turno del robot, lista cerrada).

---

## 0. Qué hay hoy (relevado en el código de `main`)

| Pieza | Dónde | Qué hace | Qué importa para este pedido |
|---|---|---|---|
| Carga de ingreso | `components/add-stock-entry-dialog.tsx` (botón "Registrar Ingreso" en Materias Primas › Ingresos, permiso `materia_prima.cargar`) | Inserta `stock_entries` (`quantity` = `original_quantity` = kg del remito, `dry_quantity`, `supplier_id`, `carrier_id` obligatorio, `remito` obligatorio, `entry_date` = `AAAA-MM-DDT12:00:00`, `created_by`). Para **Arena Fina**: humedad obligatoria, suma `materials.dry_stock` a mano, inserta `humidity_excess_log` si pasa 3 %, y si "se extrajo muestra" crea `granulometria_tests` pendiente y lo vincula (`stock_entries.granulometry_test_id` y `granulometria_tests.stock_entry_id`). | **La humedad y la muestra se cargan solo en el momento del ingreso.** Hoy no hay forma de cargarlas después desde el historial: hay que construirla. |
| Stock | Trigger `trigger_update_stock_entry` → `update_stock_after_entry()` (solo INSERT, suma `quantity` a `current_stock`). Al borrar, `decrease_stock_after_entry_delete()` resta con `GREATEST(0, …)`. | El cliente no suma `current_stock` (doble conteo 03/08–09/09). `dry_stock` sí lo lleva el cliente. | Un ingreso importado tiene que entrar con INSERT (lo suma la base) y nunca borrarse para "anular": el borrado recorta a 0 (Hudson tiene stock negativo) y choca con la FK de `granulometria_tests.stock_entry_id`. |
| Historial | `components/stock-entries-table.tsx` | Tabla con Humedad y Granulometría (solo muestra). Editar (cantidad, remito, notas, fecha, con motivo): cambia `quantity` y `dry_quantity` y corrige con `update_material_stock(diff)` **sin asiento en `stock_movements`** (queda en Actividad). Borrar con motivo. | Hay que sumar acciones "Cargar humedad" y "Muestra de granulometría", y frenar la edición de lo que viene de Zomatik. |
| Calidad › Granulometría | `components/add-granulometria-dialog.tsx` | Un ensayo nuevo se vincula al ingreso por `remito` **exacto** + `material_id`. | Los remitos importados vienen como `0002-00318903`; si el laboratorio escribe `318903` no se vincula. |
| Copia de Zomatik | `lib/control-ingresos/servidor.ts` `leerZomatikCompras()` → `zomatik_remitos_compra` (+ `_dias`) | ESTAD R.COMPRA por tramos de 34 días, depósitos 116 (Canning) y 113 (Hudson) + "todos", sucursal 18 confirmada antes y después, turno `zomatik_robot_tomar`, partición si viene cortado, freno del 70 %. **Se borra y recarga por tramo**: los `id` cambian y la `clave` incluye la cantidad. | Sirve como lectura. **No sirve como identidad** de un remito entre lecturas (si cambia la cantidad, cambia la clave). |
| Columnas reales del export | `lib/__tests__/control-ingresos.test.mjs` (renglones reales del 20/10) | `Fecha`, `Nº Remito` (`RMP 0002-00318903`), `Nº OC`, `Proveedor`, `Código`, `Artículo`, `Cantidad` (t, con decimales solo en Excel), `P.Unit`, `Total`, `Depósito`, `Transporte`, `Chofer`, `Valor Flete`. | **No trae patente** ni observaciones. Sin id interno del remito. |
| Mapeo | `lib/control-ingresos/cruce.ts` | `CODIGOS_ARTICULO`, `materialZomatik()`, `claveMaterial()`, `normalizarRemito()`, `sinPrefijoRemito()`, `mismoProveedor()` (con alias Fenomix = Avellaneda), `DEPOSITOS`. Planta por `zomatik_np_config.deposito`. | Se reusa tal cual. |
| Cruce y mail | `cruzar()` + `controlar()` + `mail.ts`; cron Vercel `25 19 * * *` (16:25); freno `control_mp_registrar` (cron 1 por hora, manual cada 2 min, uno a la vez) | 4 categorías de Juan, mail diario a Juan + cc Bautista y Felipe; lunes semanal con stock. | Con lo nuestro saliendo de Zomatik, las 4 categorías se vacían para lo importado. Hay que reconvertirlo (punto 7). |
| Control de stock | `lib/control-stock/*` | Entró = `stock_entries.quantity` por `entry_date`; consumos/ajustes/transferencias de `stock_movements`; `libroDesdeRecuento()` por `created_at`. Ignora `movement_type = 'ingreso'`. | Una corrección de un ingreso **anterior** al último recuento hoy aparece como "ajuste sin registro" (pasa también con la edición manual de hoy). |
| Robots de Zomatik | pg_cron `zomatik-np-pasada` cada 10 min (`:00, :10…`, 60 s); Vercel: `zomatik/leer` 03:30, `np/procesar` 07:00, `remito/pasada` 23:30, control 16:25; Concretus `cajas-whatsapp` 15:50 lun–vie (mismo usuario) | Mismo usuario, mismo turno, login con freno (1 cada 10 min por proceso, bloqueo 30 min si rechaza). | La pasada nueva tiene que caer entre esos horarios y usar el mismo turno. |
| Avisos | `lib/zomatik/np-servidor.ts`: `avisarErrorZomatik()` (solo Bautista), `avisarFallaAcceso()` / `avisarZomatikVolvio()` (un aviso mientras dure) | — | Se reusan. |

**Conclusión:** la lectura, el mapeo y el emparejamiento ya existen. Falta (1) una **identidad persistente** por remito
de Zomatik y el paso que lo convierte en `stock_entries`, (2) corregir y anular **con asiento** sin romper el
trigger ni el libro, (3) cargar humedad y muestra **después**, desde el historial, y (4) que el control diario pase a
controlar la importación. No se hace una pantalla nueva ni un lector nuevo de Zomatik.

## 1. Objetivo

Que los remitos de compra de MP cargados en Zomatik (vía el sistema de logística de Nicolás) entren solos a
`stock_entries` con los mismos datos que hoy carga la pantalla, sin duplicar lo ya cargado a mano, que las
correcciones y anulaciones de Zomatik se reflejen en el stock con asiento, y que humedad y granulometría se sigan
cargando, ahora desde el historial.

## 2. Alcance y fases

| Fase | Qué | Base | Escribe stock |
|---|---|---|---|
| **0. Sombra** (1 semana) | Pasada cada 30 min que lee Zomatik, arma el plan (altas, emparejados, cambios, pendientes) y lo guarda en la corrida. Bloque "Importación (prueba)" en Control con Zomatik. La carga manual sigue igual. | Migraciones 1 y 2 (sección 5) | **No** |
| **1. Importación real** desde la fecha F | Altas, emparejamiento con manuales, correcciones, anulaciones y cambios de planta con asiento. Historial: marca Zomatik, "Cargar humedad", "Muestra de granulometría", "Traer de Zomatik", edición frenada. Carga manual restringida. Edición manual de ingresos con asiento. Libro del control de stock con correcciones. | Ninguna nueva (se prende con el interruptor, 5.4) | Sí |
| **2. Control y mail nuevos** | El control diario pasa a "Ingresos MP desde Zomatik": no importados, cambios aplicados, manuales sin Zomatik, artículos sin material; el cruce viejo solo para fechas < F. Resolver pendientes desde la pantalla. Avisos. | Ninguna | No |

Cada fase se prueba en el preview antes de seguir. **Ojo: el preview usa la base de producción.** Por eso la fase 0
no escribe nada y la fase 1 se prende recién con el interruptor, no con el deploy.

### 2.1 Fuera de alcance
- Escribir en Zomatik (la lista cerrada de `lib/zomatik/web.ts` no cambia).
- El sistema de logística de Nicolás (no se lee directo: la fuente es Zomatik).
- Importar remitos con fecha < F. Corregir los 20 ingresos cargados en toneladas desde el 17/10 (script aparte, ya
  pedido en `control-ingresos-mp.md`, pregunta 1).
- Patente: hoy no se guarda y el export no la trae. Si Nicolás la manda a Zomatik (columna Chofer u otra), queda en
  `datos` del vínculo y se decide aparte.
- Aditivos y fibra mientras no se confirme su unidad en Zomatik (siguen a mano; pregunta 3).
- Tabla de alias de proveedores editable desde pantalla (por ahora alias en código, como Fenomix).
- El bug de `GREATEST(0, …)` del trigger de borrado y el de `requiresGranulometry` (sección 12).

---

## 3. Importación (fase 0 en sombra, fase 1 real)

### 3.1 Cuándo se lee Zomatik
| Pasada | Horario (Argentina) | Ventana leída | Quién la dispara |
|---|---|---|---|
| Corta | cada 30 min, a los **:05 y :35**, de 06:05 a 20:35, **salvo 16:05 y 16:35** | últimos **15 días** (un tramo; Zomatik se carga hasta 9 días después) | pg_cron `mp-ingresos-pasada` (`5,35 9-23 * * *` UTC), Bearer `cron_secret` de Vault, timeout 120 s |
| Completa | **05:05** | la del control (desde el 01/08 o 90 días, + margen) | pg_cron `mp-ingresos-noche` (`5 8 * * *` UTC) |
| Completa + mail | 16:25 (la de hoy) | la del control | cron Vercel existente `/api/control-ingresos/controlar`: después de leer, importa y recién después cruza y manda el mail |
| A mano | botón **Traer de Zomatik** | corta | gerencial o `materia_prima.editar`; freno 2 min; no de 16:00 a 16:59 (`enHorarioDelCron`) |

Por qué así: `:05`/`:35` cae entre dos pasadas de la NP (`:00`, `:10`…); 16:xx es del control; 15:50 de Concretus
queda entre 15:35 y 16:25. La de 05:05 no choca con `zomatik/leer` (03:30) ni con `np/procesar` (07:00).

Reglas (las mismas del control): turno `zomatik_robot_tomar` (espera hasta 20 s; si no, se saltea y queda la
próxima), sucursal 18 confirmada antes y después de cada export, Excel obligatorio, freno del 70 %, partición si
viene cortado. Una pasada corta tiene que terminar en 50 s de lectura (`maxDuration` 120). El freno es el de
`control_mp_registrar` con origen nuevo `pasada`: una cada 20 min como mínimo y nunca dos a la vez (el cron de las
16:25 ya espera 90 s si hay una en curso).

Implementación: `leerZomatikCompras()` recibe la ventana (`{ desde, hoy, margen: 0 }`) en vez de calcularla. La
importación **no** vuelve a leer Zomatik: trabaja sobre `zomatik_remitos_compra` de los días que se leyeron enteros
**en esta pasada** (`zomatik_remitos_compra_dias.leido_at >= inicio de la pasada`).

### 3.2 Identidad de cada remito (clave)
El export no trae un id. Clave = **número completo normalizado + código de artículo**:
`claveRemito("RMP 0002-00318903", "10000004") = "2-318903|10000004"` (sin prefijo RMP, sin ceros, con punto de
venta). Si no hay código, el nombre del artículo sin "CCTS " y sin tildes.

- No entran en la clave: cantidad, fecha, proveedor, depósito, transporte. Si cambian, es **el mismo remito
  corregido** (3.4).
- `0000-00000000`, `000000` o vacío → **pendiente "Remito sin número"** (no se importa: no se puede seguir).
- La misma clave dos veces en una lectura (ej. `RMP 0002-00318913` ×2 de 32,46 t, transportes A y B) → se importa
  el **primero** (por depósito y orden del export) y el otro queda **pendiente "Remito repetido en Zomatik"**
  (pregunta 4).
- Cambio de artículo en Zomatik (6-12 → 6-20): cambia la clave, así que es una anulación (con la espera de 3.4) y un
  alta. Es raro; durante esas 2 h el camión cuenta en los dos materiales.
- En la fase 0 se verifica si la página HTML trae un link con el código interno del remito: si lo trae, pasa a ser
  la clave (anotar en la corrida). Si no, queda la de arriba.

### 3.3 Mapeo de cada renglón
| Dato de `stock_entries` | De dónde sale | Si no se puede |
|---|---|---|
| planta | `deposito` → `zomatik_np_config.plant_id` (116 Canning, 113 Hudson) | pendiente "Depósito sin planta" (lo que solo está en "todos") |
| `material_id` | `materialZomatik(articulo, codigo)` → el material **de esa planta** con la misma `claveMaterial(name)` y `tipo` árido o cemento. Tiene que haber uno solo. | artículo sin material (gasoil, malla…) → **no es MP**: no se importa ni es pendiente; va a la lista "Artículos sin material", como hoy. Material sin par en la planta o más de uno → pendiente "Material no encontrado en la planta" |
| `quantity`, `original_quantity`, `dry_quantity` | `Cantidad` (t) × 1000 = kg. Los tres iguales al entrar. | fuera de **1 a 60 t** por renglón → pendiente "Cantidad rara (x t)" (ej. alguien cargó 40140 en vez de 40,14). Unidad del material distinta de kg → pendiente |
| `entry_date` | `Fecha` → `AAAA-MM-DDT12:00:00Z` (mismo criterio que la edición) | — |
| `remito` | `sinPrefijoRemito()` → `0002-00318903` | — |
| `supplier_id` | `Proveedor` contra los proveedores del material (`material_suppliers`) y después los de la planta, con `mismoProveedor()`. Gana la coincidencia por palabra sobre el alias (Fenomix → "FENOMIX MATERIALES" si existe; si no, "CEMENTOS AVELLANEDA"). Uno solo. | `supplier_id` nulo y el texto en `stock_entries.supplier` (columna vieja, ya existe). **Se importa igual** (el stock no espera). Va a la lista "Proveedores sin vincular" |
| `carrier_id` | `Transporte` contra `carriers` de ese proveedor (`mismoProveedor()`). "Proveedor con flete incluido" → nulo | nulo; el texto queda en el vínculo |
| `created_by` | `"Zomatik"` | — |
| `origen` (nueva) | `'zomatik'` | — |
| `notes`, `humidity_percentage`, `sample_taken_granulometry`, `granulometry_test_id` | vacíos: los completa la planta desde el historial (punto 4) | — |
| `dry_stock` | Arena Fina: `+ kg` (sin humedad todavía, seco = húmedo), como hace hoy el diálogo con humedad 0 | — |

Todo lo leído del renglón (sin precios) queda en `zomatik_ingresos_mp.datos`.

### 3.4 Qué hace cada pasada (`planImportacion`, puro)
**Candidatos manuales** = ingresos con `origen` nulo o `manual`, sin vínculo, con fecha **desde F − 10 días** (el
borde: un camión cargado a mano el día antes de F puede tener remito de Zomatik con fecha ≥ F).

Para cada renglón de la copia con fecha ≥ F, material y planta, y para cada vínculo existente:

| Caso | Acción |
|---|---|
| Clave nueva, sin candidato manual | **Alta**: INSERT `stock_entries` (el trigger suma) + vínculo `importado` |
| Clave nueva y un candidato con el **mismo número normalizado, mismo material y planta, ±10 días** | **Emparejar**: vínculo `emparejado` apuntando al manual, sin INSERT. Si las toneladas difieren más de 0,02 t y el manual tiene fecha ≥ F → **corrección** (manda Zomatik). Si el manual es anterior a F, no se corrige: se informa. La fecha del manual no se toca |
| Clave nueva y un candidato parecido pero no seguro (número mal escrito, como el paso 3 de `cruzar()`, o el mismo número en otro material o planta) | **Pendiente "¿Mismo camión que el ingreso manual del dd/mm?"**. No se importa hasta que alguien elija (fase 2: "Es el mismo" / "Son distintos") |
| Vínculo con otra cantidad | **Corrección** (3.5) |
| Vínculo con otra fecha | se actualiza `entry_date` (solo si es `importado`), sin efecto en stock |
| Vínculo con otro depósito | **Cambio de planta**: anula en la planta vieja y da de alta en la nueva, en la misma transacción |
| Vínculo con otro proveedor/transporte | se actualiza `supplier_id`/`carrier_id` solo si lo puso el robot (no pisa lo que eligió una persona) |
| Vínculo cuya fecha cae en un día leído entero en esta pasada y **no está** | 1ª vez: `falta_desde = ahora`, nada más. Si sigue faltando en una pasada **2 h después o más** → **Anulación** (3.5). Si reaparece, se limpia `falta_desde` |
| Vínculo `importado` cuyo ingreso se borró a mano (`stock_entry_id` nulo) | pendiente "Borrado a mano en Rebucret". **No se vuelve a importar** |
| Renglón con fecha < F | no se toca (lo controla el cruce viejo) |

Correr el plan dos veces seguidas con lo aplicado da **sin cambios** (idempotente).

### 3.5 Correcciones y anulaciones sin romper el libro
**Regla:** el ingreso refleja siempre lo vigente en Zomatik y cada cambio deja un **asiento** en `stock_movements`.

- **Corrección** de `kg_viejo` a `kg_nuevo` (función `mp_zomatik_aplicar`, una transacción):
  1. `stock_entries.quantity = original_quantity = kg_nuevo`; `dry_quantity = kg_nuevo / (1 + humedad/100)` si
     tiene humedad (si no, `kg_nuevo`).
  2. `materials.current_stock += (kg_nuevo − kg_viejo)` y, en Arena Fina, `dry_stock += (seco_nuevo − seco_viejo)`.
     **Sin `GREATEST(0, …)`.**
  3. `stock_movements`: `movement_type = 'correccion_ingreso'`, `quantity_kg = diferencia`, `reference_type =
     'zomatik'`, `reference_id = stock_entry_id`, `movement_date = hoy`, `notes = "Corregido en Zomatik: RMP
     0002-00319043 BLINKI, 43,10 t → 43,54 t"`.
  4. Vínculo: `kg_asentado = kg_nuevo`. Actividad (`registrarActividad`, usuario "Zomatik").
- **Anulación**: lo mismo con `kg_nuevo = 0`, `stock_entries.anulado_at = now()`, vínculo `anulado`, nota
  `"Anulado en Zomatik: RMP 0002-00319500 BLINKI, 38,10 t"`. **El ingreso no se borra** (conserva humedad, ensayo y
  excedente). Si reaparece después, se "des-anula" con otro asiento.
- Cada acción lleva el `kg_asentado` que vio el plan; si en la base es otro (otra corrida lo cambió), se saltea.

**Por qué `correccion_ingreso` y no `ajuste`** (decisión D2): si el ingreso quedara con la cantidad vieja y la
diferencia fuera un `ajuste`, el historial, el Excel, el tablero y "entró" del control de stock mostrarían la
cantidad vieja. Si se corrige el ingreso **y** se asienta como `ajuste`, el control de stock lo cuenta dos veces
(suma `stock_entries` + `ajuste`). Un tipo propio queda en el libro, el control de stock lo ignora en el período (ya
filtra por `consumo`, `ajuste`, `transferencia`) y todas las pantallas ven la cantidad vigente.

**Libro desde el último recuento** (`libroDesdeRecuento`): suma las `correccion_ingreso` creadas después del
recuento **solo si su ingreso se creó antes del recuento** (si se creó después, el libro ya usa la cantidad nueva).
Así una corrección no aparece como "ajuste sin registro". Con un recuento en el medio, la corrección igual se aplica
y se marca en el control "corrección de un ingreso anterior al recuento del dd/mm: revisar".

**Edición manual en el historial** (lo que hoy hace `handleUpdate`): mismo criterio, con asiento
`correccion_ingreso` y `reference_type = 'manual'`. Así deja de haber cambios de stock sin asiento.

### 3.6 Transición
- **F** = fecha desde la que se importa (recomiendo el lunes siguiente a una semana de sombra sin sorpresas). Se
  guarda en el interruptor (5.4), no en el código.
- **Antes de F:** nada se importa ni se corrige; las diferencias de esas fechas las sigue mostrando el cruce viejo
  hasta que salen de la ventana de 90 días.
- **Desde F:** los manuales que coinciden (desde F − 10 días) se emparejan: no se duplican. Si alguien sigue
  cargando a mano por costumbre, el robot lo empareja; si difiere y es ≥ F, manda Zomatik con asiento (ej. el 47,1
  "kg" que en realidad era 47,1 t).
- **Sombra (fase 0):** se calcula el plan como si F fuera el día en que se prende la sombra, sin escribir. Cada
  remito de esa semana tiene que salir **emparejado** con su manual o con un motivo claro. Si no, no se pasa a real.

### 3.7 Carga manual
- Sigue el botón **Registrar Ingreso**, pero:
  - `materia_prima.cargar` sin gerencial: la lista de materiales **no muestra áridos ni cemento** (los de `tipo`
    `arido_fino`, `arido_grueso`, `cemento` o `claveMaterial` de árido/cemento). Aditivos, fibra y otros, como hoy.
  - Gerencial: los ve todos; al elegir un árido o cemento aparece el aviso y la nota es obligatoria.
  - Se guarda `origen = 'manual'`.
- Humedad y "¿se extrajo muestra?" siguen en el diálogo para lo que se cargue a mano.

---

## 4. Muestras desde el historial (fase 1)

Hoy humedad y muestra solo se cargan al registrar el ingreso. Se pasan a **acciones de cada fila** del historial,
para todo ingreso (importado o manual), con el permiso `materia_prima.cargar`:

- **Cargar humedad** (Arena Fina sin humedad; con humedad: "Corregir humedad", con motivo). Misma calculadora
  (500 g húmeda, peso seco). Al guardar:
  - `humidity_percentage`, `dry_quantity = quantity / (1 + h/100)`;
  - `materials.dry_stock += (dry_nuevo − dry_viejo)`;
  - si pasa 3 %: inserta (o reemplaza, si no está acreditado) `humidity_excess_log`. Como ahí `supplier_id` es NOT
    NULL, si el ingreso no tiene proveedor vinculado el diálogo lo pide ("Elegí el proveedor") y lo guarda en el
    ingreso;
  - Actividad.
- **Muestra de granulometría** (Arena Fina, el mismo criterio con que se guarda hoy): marca
  `sample_taken_granulometry` y crea el `granulometria_tests` pendiente vinculado por id, igual que el diálogo. Si ya
  tiene, se ve el MF como hoy.
- La lógica se saca del diálogo a `lib/ingresos/muestras.ts` (`efectosHumedad()` puro + `guardarHumedad()` +
  `crearMuestraGranulometria()`) y la usan los dos: **un solo lugar**.
- Pendientes a la vista: insignia **Falta humedad** en las Arena Fina sin humedad y filtro "Sin humedad" con el
  número ("3 sin humedad").
- Calidad › Granulometría (ensayo nuevo): vincula por `normalizarRemito()` + material ±30 días; si hay uno solo, lo
  vincula; si hay más de uno, pide elegir. Deja de depender de cómo se escribió el remito.

---

## 5. Base de datos (Bautista lo aprueba antes de correr nada)

### 5.1 Migración 1 `supabase/migrations/202611061000_ingresos_mp_zomatik.sql` (fase 0, fuera de horario)
1. **`stock_entries`**: dos columnas nuevas, nulas, sin default (no reescribe la tabla):
   - `origen text` con CHECK `origen IS NULL OR origen IN ('manual','zomatik')`. Nulo = como hoy (manual).
   - `anulado_at timestamptz`.
2. **`zomatik_ingresos_mp`** (nueva, solo `service_role`, como las del control): una fila por clave de Zomatik.
   `id bigserial`, `clave text UNIQUE`, `estado` (`importado`, `emparejado`, `pendiente`, `anulado`, `descartado`),
   `motivo text`, `stock_entry_id uuid` FK `stock_entries` ON DELETE SET NULL, `fecha date`, `remito`, `remito_norm`,
   `orden_compra`, `proveedor`, `codigo_articulo`, `articulo`, `cantidad_t numeric`, `deposito int`, `plant_id`,
   `material_id`, `transportista`, `kg_asentado numeric`, `proveedor_por_robot boolean`, `datos jsonb`,
   `primera_vez_at`, `visto_at`, `falta_desde`, `anulado_at`, `resuelto_por`, `resuelto_at`, `nota`.
   Índices: `(estado)`, `(fecha)`, `(stock_entry_id)`.
3. **`control_mp_corridas.origen`**: el CHECK pasa a `('cron','manual','pasada')`.
4. **`control_mp_registrar()`** (CREATE OR REPLACE): suma `pasada` (una cada 20 min; una a la vez con todo). `cron`
   y `manual` quedan igual.
5. **`mp_zomatik_aplicar(p_acciones jsonb) RETURNS jsonb`** (solo `service_role`): recorre las acciones (`alta`,
   `emparejar`, `corregir`, `anular`, `mover`, `pendiente`, `actualizar`), cada una en su bloque con EXCEPTION (una
   que falla no frena las otras) y devuelve el resultado de cada una. Bloquea la fila del vínculo (`FOR UPDATE`) y
   compara `kg_asentado`. El alta inserta primero el vínculo (`ON CONFLICT (clave) DO NOTHING`): si ya estaba, no
   inserta el ingreso.

**Qué pasa con los datos ya cargados:**
- Los `stock_entries` existentes quedan con `origen` y `anulado_at` nulos: se ven y suman igual que hoy. La
  migración no modifica ninguna fila.
- `materials`, `stock_movements`, `granulometria_tests`, `humidity_excess_log`: la migración no los toca.
- `control_mp_corridas`, `control_mp_diferencias`, `zomatik_remitos_compra`: siguen igual; las corridas viejas
  cumplen el CHECK nuevo.
- Desde F (fase 1), el robot **sí** modifica `current_stock`/`dry_stock` (altas, correcciones, anulaciones) y puede
  corregir la cantidad de ingresos manuales **con fecha ≥ F** que empareje. Nunca cambia la cantidad de ingresos con
  fecha < F (solo los puede emparejar, sin tocarlos).

### 5.2 Migración 2 `202611061010_ingresos_mp_zomatik_cron.sql` (después de publicar la fase 0)
Jobs `mp-ingresos-pasada` (`5,35 9-23 * * *`) y `mp-ingresos-noche` (`5 8 * * *`) contra
`/api/ingresos-zomatik/pasada`, mismo patrón que `armado-dia-pasada` (unschedule antes, `cron_secret` de Vault,
`timeout_milliseconds := 120000`). Antes de publicar, la ruta no existe (daría 404). Se sacan con `cron.unschedule`.

### 5.3 Tipos
`stock_entries` nuevo y `zomatik_ingresos_mp` con `as any` (los tipos generados no se regeneran en esta rama).

### 5.4 Interruptor
Fila en `integraciones`: `clave = 'mp_ingresos_zomatik'`, `valor = '{"modo":"sombra","desde":"2026-11-09"}'`.
Sin la fila: apagado (la pasada lee y no planea). `modo: "real"` con `desde: F` prende la fase 1. Se cambia con un
UPDATE que corre Bautista: el deploy no prende nada.

---

## 6. Archivos

**Nuevos**
- `lib/ingresos-zomatik/plan.ts` (puro): `claveRemito`, `kgDeZomatik` (rango 1–60 t), `resolverPlanta`,
  `resolverMaterial`, `resolverProveedor`, `resolverFlete`, `planImportacion`, `textoMotivo`. Patrón:
  `lib/control-ingresos/cruce.ts` (sin red ni base).
- `lib/ingresos-zomatik/servidor.ts`: `pasada(sb, { completa, origen, t0 })` = registrar → interruptor → leer
  (`leerZomatikCompras` con ventana) → leer copia de los días leídos, vínculos, materiales, proveedores, fletes y
  candidatos manuales → plan → `mp_zomatik_aplicar` (si `real`) → guardar plan/resumen en la corrida → avisos.
  Patrón: `lib/control-ingresos/servidor.ts`.
- `app/api/ingresos-zomatik/pasada/route.ts`: GET (pg_cron, `esLlamadaDeCron`, saltea 16:00–16:59), POST "Traer de
  Zomatik" (sesión, `puedeControlar`). `maxDuration = 120`. Patrón: `app/api/control-ingresos/controlar/route.ts`.
- `lib/ingresos/muestras.ts` + `components/ingreso-muestras-dialog.tsx` (humedad y granulometría desde la fila).
- `supabase/migrations/202611061000_ingresos_mp_zomatik.sql` y `202611061010_ingresos_mp_zomatik_cron.sql`.
- `lib/__fixtures__/ingresos-zomatik/lecturas.json` (lecturas sucesivas: base, corregida, anulada, movida, repetida).
- `lib/__tests__/ingresos-zomatik.test.mjs` y el script `test:ingresos-zomatik` en `package.json` (mismo formato que
  `test:control-ingresos`).
- `docs/ingresos-mp-zomatik.md` (la ficha final, la escribe el obrero al terminar).

**A modificar**
- `lib/control-ingresos/servidor.ts`: ventana por parámetro en `leerZomatikCompras`; `controlar()` importa después
  de leer; `leerNuestros()` excluye anulados; cruce limitado a fechas < F (fase 2: secciones nuevas).
- `lib/control-ingresos/cruce.ts`: `cruzar()` acepta `hasta`; exportar lo que reusa el plan.
- `lib/control-ingresos/mail.ts` (fase 2).
- `lib/control-stock/calculo.ts` y `servidor.ts`: correcciones en `libroDesdeRecuento` (3.5).
- `components/stock-entries-table.tsx`: insignias, acciones de muestras, edición y borrado frenados para
  `origen = 'zomatik'`, proveedor `suppliers.name || supplier`, edición manual con asiento.
- `components/add-stock-entry-dialog.tsx`: filtro de materiales, aviso, `origen = 'manual'`, usa `lib/ingresos/muestras.ts`.
- `app/materias-primas/page.tsx`: cartel, "Traer de Zomatik", filtro "Sin humedad", columna Origen en el Excel.
- `components/add-granulometria-dialog.tsx`: vínculo por remito normalizado.
- `components/control-ingresos-zomatik.tsx` y `app/api/control-ingresos/route.ts`: sombra (fase 0) y secciones +
  resolver (fase 2).

---

## 7. El control diario (fase 2)

Con lo nuestro saliendo de Zomatik, "falta en nuestro sistema", "no coincide" y "número mal escrito" dejan de tener
sentido para lo importado: sería comparar Zomatik con Zomatik. El control pasa a controlar **la importación**:

| Sección (pantalla y mail) | Qué trae |
|---|---|
| **No se pudo importar** | pendientes con motivo y qué hacer ("Corregilo en Zomatik", "Elegí: es el mismo / son distintos") |
| **Cambios de Zomatik** | correcciones, anulaciones y cambios de planta aplicados (fecha, remito, antes → después); emparejados con diferencia anteriores a F (no corregidos) |
| **Cargados a mano** | manuales ≥ F: emparejados, y los que no están en Zomatik después de 7 días ("Falta en Zomatik") |
| **Artículos sin material** / **Proveedores sin vincular** | como hoy la lista de artículos; proveedores importados con `supplier_id` nulo |
| **Antes del dd/mm (F)** | el cruce viejo, solo fechas < F, plegado; desaparece solo a los 90 días |
| **Control de stock** | igual (semanal los lunes). Ahora "entró" tiene que dar igual a Zomatik: si no, falla la importación; la diferencia real a mirar es "salió" |

Mail: misma hora (16:25), mismos destinatarios (Juan, cc Bautista y Felipe), una vez por día, solo lo nuevo desde
el mail anterior. Lunes, el semanal con todo lo abierto + stock. Resolver un pendiente ("Es el mismo", "Son
distintos", "Descartar") queda en Actividad y lo aplica la próxima pasada.

## 8. Avisos

| Qué pasa | A quién | Cómo |
|---|---|---|
| Renglones que no se pudieron importar | Juan (los corrige en Zomatik o le pide a Nicolás), cc Bautista y Felipe | mail diario de las 16:25 (no uno por renglón) |
| Zomatik no deja entrar (usuario, sesión) | Bautista | el aviso único que ya existe (`avisarFallaAcceso`), uno mientras dure, y "volvió" |
| Ninguna pasada buena en **2 h** dentro de 06:00–20:00 (otra causa: sucursal, formato, tiempo) | Bautista | `avisarErrorZomatik`, uno por día como mucho (marca en `integraciones`, `mp_ingresos_aviso`) |
| Arena Fina sin humedad hace más de 24 h | ver pregunta 7 | — |

---

## 9. Textos de pantalla

| Dónde | Texto |
|---|---|
| Ingresos, arriba | "Arena, piedra y cemento entran solos desde Zomatik. Acá cargás humedad y muestra." (?) "Se lee Zomatik cada 30 min, de 6 a 20." |
| Botón | **Traer de Zomatik** → "Listo: 2 ingresos nuevos" · "Sin novedades" · "Zomatik está ocupado. Probá en un rato." · "Entre las 16 y las 17 se actualiza solo." |
| Insignias | **Zomatik** · **Falta humedad** · **Corregido** (tooltip "43,10 t → 43,54 t, Zomatik 05/11") · **Anulado en Zomatik** (fila tachada) |
| Menú de la fila | **Cargar humedad** · **Corregir humedad** · **Muestra de granulometría** |
| Editar (importado) | "Viene de Zomatik: cantidad, fecha y remito se corrigen allá y acá se actualizan solos." |
| Eliminar (importado) | deshabilitado, "Se anula en Zomatik." |
| Registrar Ingreso (gerencial, árido/cemento) | "Este material entra solo desde Zomatik. Cargalo acá solo si no va a estar en Zomatik." + nota obligatoria |
| Motivos de pendiente | "Depósito sin planta" · "Remito sin número" · "Remito repetido en Zomatik" · "Cantidad rara (40.140 t)" · "Material no encontrado en Canning" · "¿Mismo camión que el ingreso manual del 19/10 (Hudson)?" · "Borrado a mano en Rebucret" |
| Mail | asunto "Rebucret · Ingresos MP: 2 sin importar, 1 cambio" o "Rebucret · Ingresos MP: sin novedades hoy" |
| Fase 0 | pestaña Control, bloque "Importación (prueba)": "Si estuviera prendida: 12 nuevos, 30 emparejados, 1 sin importar." |

Compacto: `text-xs`, sin negritas, como el control.

---

## 10. Criterios de aceptación

Con los fixtures de `lib/__fixtures__/control-ingresos/casos.json` (renglones reales de Zomatik del 20 al 27/10) y
**F = 2026-10-20** para las pruebas (candidatos manuales desde el 10/10):

1. **Alta:** `RMP 0002-00319500`, 21/10, BLINKI S A, 10000004 CCTS ARENA ESPECIAL, 38,10 t, Canning, sin manual →
   un `stock_entries` Canning "Arena Fina", `quantity = original_quantity = dry_quantity = 38100`, `remito =
   "0002-00319500"`, `entry_date = 2026-10-21T12:00:00Z`, `created_by = "Zomatik"`, `origen = 'zomatik'`, proveedor
   BLINKI; `current_stock` y `dry_stock` suben 38100 (una vez).
2. **Emparejado sin duplicar:** manual "00002 00318903" 40140 kg Canning Arena Fina 20/10 + Zomatik `RMP
   0002-00318903` 40,14 t → vínculo `emparejado`, ningún INSERT, stock igual. Lo mismo con "0002 02742081" CEMENTOS
   AVELLANEDA contra FENOMIX `RMP 0002-02742081`.
3. **Emparejado con corrección:** manual "0002-00319043" 43,54 (cargado en t) del 23/10 + Zomatik 43,10 t →
   emparejado, `quantity = 43100`, `current_stock += 43056,46`, un `correccion_ingreso` de +43056,46 con nota.
4. **Posible duplicado (número mal escrito):** manual CPC 40 "0002-02743030" 36,39 del 23/10 + Zomatik `RMP
   0002-02730799` 36,39 t del 23/10 → pendiente "¿Mismo camión…?", sin INSERT.
5. **Posible duplicado (borde de F, otra planta):** manual Hudson "00880839" 30420 del 19/10 + Zomatik `RMP
   0002-00880839` 30,42 t Canning del 20/10 → pendiente "¿Mismo camión que el ingreso manual del 19/10 (Hudson)?",
   sin INSERT (no se duplica el camión).
6. **Repetido:** `RMP 0002-00318913` ×2 → uno emparejado con el manual "00002 00318913" y el otro pendiente
   "Remito repetido en Zomatik".
7. **Sin número:** `RMP 0000-00000000` 40,12 t Canning → pendiente "Remito sin número".
8. **Fuera de planta y sin material:** renglón sin depósito → pendiente "Depósito sin planta"; GASOIL y CCTS MALLA
   SIMA Q188 → ni ingreso ni pendiente, en "Artículos sin material".
9. **Corrección de Zomatik:** el importado del caso 1 viene en la lectura siguiente con 38,50 t → `quantity =
   38500`, `current_stock += 400`, asiento +400 "Corregido en Zomatik: RMP 0002-00319500 BLINKI, 38,10 t → 38,50 t".
10. **Anulación:** la pasada siguiente (con el 21/10 leído entero) no trae `RMP 0002-00319500` → solo `falta_desde`;
    la de 2 h después tampoco → `quantity = 0`, `anulado_at`, `current_stock −= 38500`, asiento −38500. Con el 21/10
    sin leer en esa pasada: no pasa nada. En una planta con stock −60.000 kg, anular 30.000 deja −90.000 (no recorta
    a 0).
11. **Cambio de planta:** el importado del caso 1 pasa de 116 a 113 → Canning −38100 (anulado, con asiento) y alta
    en Hudson +38100.
12. **Idempotente:** el plan sobre lo ya aplicado da 0 acciones. Dos pasadas a la vez: la segunda la frena
    `control_mp_registrar`.
13. **Fecha < F:** un renglón de Zomatik del 19/10 no genera nada.
14. **Humedad desde el historial:** Arena Fina importada 40140 kg, humedad 5 % → `dry_quantity = 38228,57`,
    `dry_stock −= 1911,43`, excedente 2 % = 802,8 kg (0,8028 t) en `humidity_excess_log`.
15. **Libro:** un ingreso creado antes del último recuento y corregido después no genera "ajuste sin registro".
16. **Cruce viejo:** con todo lo ≥ F importado o emparejado, `cruzar()` no informa nada de fechas ≥ F.
17. **Control de stock:** en Canning, CPC 40, "entró" desde F = "entró" de Zomatik (±0,02 t por remito).
18. **Carga manual:** un usuario con `materia_prima.cargar` sin gerencial no ve Arena Fina ni CPC 40 en "Registrar
    Ingreso"; sí ve aditivos y fibra.
19. **Sombra:** con el interruptor en `sombra`, una pasada no cambia ningún `stock_entries` ni `materials`
    (contar filas y `current_stock` antes y después) y muestra el plan.
20. Nunca se escribe en Zomatik (lista cerrada sin cambios). Las pasadas no corren de 16:00 a 16:59.
21. `npm run test:ingresos-zomatik` (casos 1–15 y 19, puros), `test:control-ingresos` y `test:control-stock` pasan;
    `tsc` sin errores nuevos (17 de la base) y `next build --webpack` bien.

### 10.1 Pruebas con `node --test` (`lib/__tests__/ingresos-zomatik.test.mjs`)
- `claveRemito`: `"RMP 0002-00318903","10000004"` → `"2-318903|10000004"`; `"RMP 0000-00000000"` → null.
- `kgDeZomatik`: 40,14 → 40140; 40140 → fuera de rango; 0,5 → fuera de rango.
- `resolverMaterial`: 10000001 → Arena Trituración 0/6; 10000612 → Piedra Partida 6/12; malla → sin material.
- `resolverProveedor`: "BLINKI S A" → BLINKI; "FENOMIX - MATERIALES SAN FERNANDO" con [CEMENTOS AVELLANEDA,
  FENOMIX MATERIALES] → FENOMIX MATERIALES; solo con [CEMENTOS AVELLANEDA] → ese; con ninguno → null.
- `resolverFlete`: "Proveedor con flete incluido" → null.
- `planImportacion`: criterios 1–13 con `lib/__fixtures__/ingresos-zomatik/lecturas.json` (armado desde `casos.json`).
- `efectosHumedad`: criterio 14. `libroDesdeRecuento`: criterio 15.

---

## 11. Decisiones (Rebucret no tiene `docs/DECISIONES.md`; quedan acá y pasan a la ficha final)

- **D1 (05/11/2026) Zomatik es la fuente de los ingresos de áridos y cemento desde F.** Por qué: lo carga logística
  y ya se lee con todas las protecciones. Descartado: leer el sistema de Nicolás directo (otro sistema más que
  sostener, y Zomatik igual es lo que mira Juan).
- **D2 Corrección = cambiar el ingreso + asiento `correccion_ingreso`**; anulación = cantidad 0 + `anulado_at`, sin
  borrar. Descartado: `ajuste` con el ingreso fijo (todas las pantallas verían la cantidad vieja); corregir + `ajuste`
  (doble conteo en el control de stock); borrar el ingreso (recorta a 0 y pierde ensayo y excedente).
- **D3 Identidad = número completo + artículo**, en una tabla propia persistente. Descartado: la `clave` de
  `zomatik_remitos_compra` (cambia con la cantidad y la tabla se recarga); `Nº OC` (una OC puede cubrir varios
  camiones).
- **D4 Nada antes de F se importa ni se corrige** (los manuales de F − 10 días solo se emparejan). Descartado:
  importar hacia atrás y emparejar el histórico (lo hace el cruce viejo y tocaría stock de meses con recuentos en el
  medio).
- **D5 Anular recién con dos lecturas completas separadas 2 h.** Descartado: anular en la primera falta (un export
  raro bajaría stock real).

## 12. Hallazgos al pasar (no se arreglan acá)
1. `decrease_stock_after_entry_delete()` usa `GREATEST(0, …)`: borrar un ingreso con stock bajo o negativo deja el
   stock mal. Recomiendo sacarlo en otra rama.
2. `add-stock-entry-dialog.tsx`: la pregunta de granulometría se muestra para piedra y trituración pero solo se
   guarda para Arena Fina (`requiresGranulometry` distinto en el render y en el submit).
3. La edición manual de hoy cambia stock sin asiento: si el ingreso era anterior al último recuento, aparece como
   "ajuste sin registro" en el control de stock (puede explicar parte de los +215,5 t de Piedra 6/12 en Canning).
   Se arregla en la fase 1 (3.5).
4. `add-granulometria-dialog.tsx` vincula con `.eq("remito")`: si hay dos ingresos con el mismo remito, los vincula
   a los dos.

## 13. Preguntas para Bautista (con recomendación)
1. **Sombra y F:** ¿una semana en sombra y F el lunes siguiente? *Recomiendo* sí: sombra desde el lunes 09/11, F
   el 16/11 si todo sale emparejado.
2. **Carga manual de áridos y cemento:** ¿solo gerencial, con nota? *Recomiendo* sí; aditivos y fibra siguen como hoy.
3. **Aditivos y fibra:** ¿Nicolás los va a cargar en Zomatik, y en qué unidad (kg, litros, bolsas)? *Recomiendo*
   seguir a mano hasta ver una semana de datos y sumarlos después con su conversión.
4. **Remito repetido en Zomatik:** ¿se importa el primero y el otro espera? *Recomiendo* sí: un camión de más en el
   stock es peor que uno que espera a que Juan lo corrija.
5. **Manuales desde F que no coinciden en cantidad:** ¿manda Zomatik? *Recomiendo* sí, con asiento (arregla solos
   los cargados en toneladas).
6. **Demora del circuito:** ¿Nicolás pasa el remito a Zomatik en el momento o a fin del día? Si tarda, el stock de
   la planta llega tarde (y la alerta de stock cero de las 07:00 puede saltar de más). *Recomiendo* medirlo en la
   sombra antes de decidir F.
7. **Arena sin humedad:** ¿a quién se le avisa si a las 24 h no se cargó? *Recomiendo* la insignia y el filtro, más
   una línea en el mail diario; si querés, mail al encargado de cada planta (decime quién: ¿David en Hudson,
   Fernando en Canning?).
8. **Nicolás en copia** del mail de "no se pudo importar": *recomiendo* no por ahora; Juan le reenvía lo que es de su
   sistema.
