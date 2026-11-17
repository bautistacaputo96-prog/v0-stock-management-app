# Traer NP de Zomatik (en vez de "Usar NP con saldo")

Estado: **propuesta (17/11/2026)**, rama `feat/traer-np-zomatik`. La fase 1 se implementa ya, sin cambios de base. La
fase 2 (NP con remitos previos) necesita migración y espera el OK de Bautista (sección 16).

Cambia `docs/migracion-loop/zomatik.md` 25.2 y 25.10: la tercera opción del bloque de la NP pasa a ser **"Traer NP de
Zomatik"**, con la búsqueda por número y la lista de NP con saldo dentro de la misma opción. El resto de 24, 25 y 27
sigue mandando. Se anota como sección 28 de `zomatik.md` (texto en la sección 15 de esta spec).

---

## 0. Qué hay hoy (relevado en el código)

| Pieza | Dónde | Qué hace hoy |
|---|---|---|
| Opciones de la NP en el alta | `components/zomatik/np-pregunta.tsx` (sección "¿Qué NP?" de `dispatch-scheduling.tsx`) | NP nueva / NP de un proyecto / Usar NP con saldo. "Con saldo" lista **todas** las NP con saldo (`cargarNpSaldos()`), filtradas por planta en pantalla, y `onSaldo` completa cliente, obra, fórmula, planta y m³ |
| Opciones de la NP en el formulario | `components/zomatik/np-bloque.tsx` (sección "Nota de pedido (Zomatik)") | Las mismas tres. "Con saldo" lista las del cliente y artículo (`cargarNpSaldos({clientId, formulaId})`), **sin filtrar por planta** |
| NP con saldo | `npsConSaldo` (`lib/zomatik/np-servidor.ts`) vía `GET /api/zomatik/np/saldos` | `zomatik_np` en estado `ok`, no `cerrada`, sin ajuste en marcha, con libre > 0 |
| Usar la NP | `sincronizarPedido` → `validarSaldo` → `planificarNp` (`usar`) → `zomatik_np_reservar` | Valida estado, decisión, ajuste, cliente y artículo. **No valida la planta** (la desvincula recién en la sincronización siguiente). Si no alcanza, el resto va a una NP nueva |
| Ajuste al finalizar | `leerNpParaAjuste` / `ajustarCantidadNp` (`np-robot.ts`) | **Exige la marca del sistema en las observaciones de la NP**: una NP cargada a mano queda "revisar" y no se ajusta |
| Vaciar | `vaciarNp` | También exige la marca. "Devolver el saldo" y "Sí, cancelarla" llaman a `zomatik_np_devolver`, que manda a vaciar si la NP no tuvo despachos |
| Remito (Z1) | `remitoAManoEnNp` (`z1-robot.ts`) | Justo antes de grabar, cualquier remito de la NP que no grabó el sistema frena el remito ("se remitió a mano") |
| Autorizar | `autorizarNp` | Ya autorizada: no hace nada. Sin autorizar: exige la marca |
| Antecedente | Script del 17/11 | Fila de `zomatik_np` de MERVA S.A. (NP 0001-00001195, código 157919), marca `'A mano - NP 0001-00001195'`, `paso 'a_mano'`, sin pedido, ya usada por un pedido |

**Conclusión:** no hace falta nada paralelo. La NP traída es una fila más de `zomatik_np`, sin pedido, que entra por el
mismo camino de "Usar NP con saldo" (`eleccion.tipo = "saldo"`). Lo nuevo es: leerla en Zomatik por número y
registrarla, y que el ajuste la reconozca sin la marca.

## 1. Objetivo

Que quien programa pueda usar en un pedido una NP que ya está en Zomatik (cargada a mano, por ejemplo para facturarla
antes) escribiendo su número, sin que el robot genere otra. La NP queda registrada en el sistema y desde ahí se usa,
se remite y se ajusta como cualquier otra.

## 2. Alcance

**Fase 1 (esta spec, sin cambios de base):**
1. La tercera opción se llama "Traer NP de Zomatik", en el bloque del formulario y en la pregunta del alta.
2. Adentro: un campo para el número de NP con "Buscar", y abajo la lista de NP con saldo de siempre.
3. `POST /api/zomatik/np/traer`: lee la NP en Zomatik (solo lectura, con el turno del robot), la controla y la registra
   en `zomatik_np`. Si ya estaba registrada, devuelve la existente sin leer Zomatik.
4. El pedido la usa con el mismo `sincronizar` / `zomatik_np_uso` / `validarSaldo` de hoy.
5. El ajuste al finalizar reconoce la NP traída por su número y su cliente, en vez de la marca.
6. "Devolver el saldo" y "Sí, cancelarla" nunca vacían una NP traída: piden la devolución a mano.
7. Arreglos de paso, porque la traída los expone: `validarSaldo` y la lista del bloque miran la planta; la NP traída
   toma la fecha del pedido que la usa.

**Fase 2 (sección 10.3, espera el OK de Bautista):** traer una NP que ya tiene remitos en Zomatik (libre = cantidad −
remitido).

**Fuera de alcance:**
- Traer NP con remitos previos (fase 2). En la fase 1 se rechazan con un mensaje claro.
- Traer NP de RUTA 25 u otra sucursal.
- Autorizar una NP traída (la autoriza una persona en Zomatik; ver 16.2).
- Cambiar algo de la NP en Zomatik al traerla (cantidad, precio, fecha, observaciones). El robot no escribe nada.
- Vaciar una NP traída (el robot sigue exigiendo la marca para vaciar).
- Montos de cualquier tipo: total, costo, precio. No se leen para mostrar ni se guardan.
- Traer una NP con dos renglones del mismo hormigón.
- Tocar la fila de MERVA del 17/11 (sigue como está; ver 10.2).
- La DEVOL automática (sigue a mano, 25.3).

## 3. Pantalla

### 3.1 Formulario del pedido (`np-bloque.tsx`)

Opción: `["saldo", "Traer NP de Zomatik", "Por número, o una con saldo"]`.

Al elegirla, una línea y abajo la lista (inputs de ancho fijo, sin agrandar el formulario):

```
N.º de NP [ Ej.: 1195 o NP2 2086 ] [Buscar] (?)
<estado de la búsqueda, una línea>
Con saldo de este cliente:
  NP 0001-00001195  H30-620-10 C (HUD) · de Zomatik · del 19/11        25 m³ libres
  NP2 0001-00002090 H30-620-10 C (HUD) · Obra Las Lomas · del 12/11     4 m³ libres
Toma 25 m³ de esa NP y 5 m³ van en una NP nueva.          ← el aviso de hoy, si el pedido pide más
```

- Input `w-44`, `h-7`, `text-xs`. Enter = Buscar. Botón deshabilitado si el campo está vacío, buscando o `soloLectura`.
- (?) dice: "El número de la NP en Zomatik: 1195, 0001-00001195 o NP2 2086. Tiene que ser del mismo cliente y
  hormigón del pedido."
- Si falta el cliente o la fórmula del pedido: el campo queda deshabilitado con "Elegí el cliente y la fórmula para
  buscar." (gris).
- Si la búsqueda sale bien: la NP aparece en la lista, elegida (`onCambio({ tipo: "saldo", np_id })`), y la línea de
  estado muestra los avisos (3.3). La lista se vuelve a pedir.
- Las traídas llevan " · de Zomatik" en la lista. Sin obra (no tienen pedido de origen), no se muestra obra.
- Sin NP con saldo y sin búsqueda: "No hay NP con saldo de este cliente y hormigón." (gris, ya no ámbar).
- La línea del precio (`LineaPrecio`), con `tipo = "saldo"`: "Precio por m³: el de la NP elegida".

### 3.2 Pregunta del alta (`np-pregunta.tsx`)

Opción: `["saldo", "Traer NP de Zomatik", "Una NP que ya está en Zomatik: cargada a mano o que quedó con m³ (por ejemplo, un pedido cancelado por lluvia)."]`.

- Un solo input (el de hoy), con placeholder "N.º de NP, cliente u obra". Sigue filtrando la lista.
- Si lo escrito se entiende como número de NP (`numeroNpTipeado`, 8.1) aparece, debajo, el botón
  "Buscar NP 0001-00001195 en Zomatik".
- Acá todavía no hay cliente ni fórmula: el servidor los saca de la NP (6, paso 3). Si hay más de una fórmula de la
  planta con ese artículo, responde `elegirFormula` y se muestran como botones chicos: "¿Qué fórmula? [H30 HUD] [H30 HUD
  bombeable]". Al tocar una, se busca de nuevo con esa fórmula.
- Si sale bien, se llama al `onSaldo(x)` de hoy (completa cliente, fórmula, planta y m³ = libre; obra vacía) y además,
  si el formulario no tiene R/X, se pone el de la NP (NP → R, NP2 → X).

### 3.3 Estados (los dos lugares, misma línea, `text-xs`)

Gris = informativo; ámbar = no se pudo; verde = listo. **Ninguno muestra montos.**

| Código (`motivo`) | Texto |
|---|---|
| buscando | "Buscando en Zomatik…" (gris; el botón dice "Buscando…") |
| ok | "Lista: NP 0001-00001195, 25 m³ libres." (verde) + avisos |
| ya_estaba | "Ya estaba en el sistema: NP 0001-00001195, 25 m³ libres." (verde) |
| formato | "Escribí el número de la NP. Ej.: 1195 o NP2 2086." |
| otra_serie | "Ese número no es de Rebucret (van del 1000 al 5999)." |
| no_existe | "No está en Zomatik (Rebucret). Revisá el número." |
| ambigua | "Hay una NP y una NP2 con ese número: escribí NP o NP2 adelante." |
| otro_cliente | "Es de otro cliente: {razón social de Zomatik}." |
| cliente_sin_vinculo | "El cliente no está vinculado con Zomatik." + botón "Vincular" (el de hoy, si puede) |
| cliente_no_esta (alta) | "El cliente de la NP ({razón social}) no está en el sistema. Agregalo con «Traer de Zomatik»." |
| formula_sin_vinculo | "La fórmula no está vinculada con un artículo de Zomatik." + "Vincular" |
| otro_articulo | "Es de otro hormigón: {artículo de la NP}." |
| sin_formula (alta) | "Ninguna fórmula de {planta} está vinculada con {artículo}." |
| elegir_formula (alta) | "¿Qué fórmula?" + botones |
| renglon_doble | "Tiene dos renglones de {artículo}: no se puede traer." |
| anulada | "Está anulada en Zomatik." |
| inactiva | "No está activa en Zomatik." |
| sin_autorizar | "Está sin autorizar en Zomatik: que la autorice un gerencial y buscala de nuevo." |
| otro_deposito | "Es del depósito {nombre} y el pedido es de {planta}: corregilo en Zomatik." |
| otro_remito | "Es NP2 (remito X) y el pedido dice R." / "Es NP (remito R) y el pedido dice X." |
| con_remitos | "Ya tiene remitos en Zomatik ({RM2 0099-00002758, …}): por ahora no se puede traer." |
| sin_m3 | "No le quedan m³ en Zomatik." |
| usada | "Ya la usa otro pedido y no le quedan m³ libres." |
| otra_planta | "Es de otra planta." |
| cerrada | "En el sistema ya está cerrada o se está devolviendo." |
| revisar | "En el sistema está para revisar: avisale a un gerencial." |
| anulada_sistema | "En el sistema figura anulada o vaciada: avisale a Bautista." |
| ajustandose | `MSJ_NP_AJUSTANDOSE` (el de hoy) |
| ocupado | "Zomatik está ocupado con otra tarea. Probá en un minuto." |
| zomatik | "Zomatik no responde ahora. Probá en unos minutos." |
| no_se_entiende | "Zomatik mostró la NP de una forma que no se entiende. Avisale a Bautista." |
| comprobantes_ilegibles | "No se pudo saber si tiene remitos. Probá en un rato." |
| apagada | "NP: se carga a mano en Zomatik." |
| sin_conexion | "Sin conexión." |

Avisos con `ok` (gris, después del texto verde, separados por " · "):
- "Es de un proyecto." si la NP es de un proyecto (`proyecto` > 0).
- "Tiene factura: al terminar, el ajuste lo hace Juan a mano." si `_comprobantes` lista una factura.
- "Tiene otros renglones: al terminar, el ajuste lo revisa una persona." si hay renglones de otros artículos.
- "Otro pedido ya usa {x} m³." si la fila ya estaba y otro pedido activo reserva parte.

## 4. Permisos

- `POST /api/zomatik/np/traer`: **`programacion.cargar`**, el mismo con que `sincronizar` acepta la elección de la NP
  (`app/api/zomatik/np/route.ts`). Sin eso, 403 "Es de Programación.". Titan y David programan con ese permiso.
- En pantalla: el campo existe donde hoy existe la opción (llave de la planta prendida, bloque listo, no
  `soloLectura`).
- Precios: la respuesta, `zomatik_np`, los mensajes y Actividad **no llevan montos**. El robot no guarda el total del
  listado ni el costo del renglón. Titan y David ven lo mismo que todos: número, hormigón, fecha, m³.

## 5. Ruta API nueva

`app/api/zomatik/np/traer/route.ts` (copiar la forma de `app/api/zomatik/np/route.ts`: `exigirSesion`,
`respuestaModoLocal` si `s.local`, `respuestaError`, `faltaMigracion` → apagada).

```
POST /api/zomatik/np/traer
  { numero: string, plant_id: uuid, client_id?: uuid|null, formula_id?: uuid|null, remito?: "R"|"X"|null }
```
- `dynamic = "force-dynamic"`, `maxDuration = 60`.
- 200 `{ ok: true, yaEstaba: boolean, np: NpSaldo, remito: "R"|"X", avisos: string[] }` (`NpSaldo` con `traida: true`).
- 422 `{ ok: false, motivo, error, elegirFormula?: { id, code }[] }`: no se puede traer (motivos de 3.3).
- 503 `{ ok: false, motivo: "ocupado" | "zomatik", error }`.
- 409 `{ ok: false, motivo: "apagada", error }`: llave de la planta apagada.
- 400 datos mal formados (uuid, `numero` de más de 30 caracteres). 403 sin permiso.
- Un error inesperado (nuestro): 500 con `avisarFallaInesperada` (como `fallaInesperada` de `np/route.ts`), texto "No
  se pudo traer la NP (error del sistema). Ya le avisamos a Bautista." o "…avisale a Bautista".

Cliente: `traerNpDeZomatik(o)` en `lib/zomatik/np-cliente.ts`, con tiempo máximo de 60 s y "Sin conexión" si falla
el fetch. `cargarNpSaldos` suma `plantId` (opcional) y `GET /api/zomatik/np/saldos` acepta `plant_id`.

## 6. Servidor: `traerNp` (`lib/zomatik/np-traer-servidor.ts`, nuevo)

`traerNp(o: { numero, plantId, clientId?, formulaId?, remito?, usuario, sb?, dep? }): Promise<ResultadoTraer>`.
`dep` = `{ navegadorLectura, navegadorLecturaNp, robot: { buscarNpPorNumero, leerNpParaTraer } }` para las pruebas
(como `Dependencias` de `np-servidor.ts`). Pasos, en orden; el primero que falla corta:

1. **Número** (sin red): `numeroNpTipeado(numero)` (8.1) → `{ numero: "0001-00001195", comprobante: "15"|"16"|null }`.
   Si es null → `formato`. Si `!esSerieRebucret` → `otra_serie`.
2. **Planta y llave**: `plantasNp(sb)`; sin llave → `apagada`. Depósito de la planta: `zomatik_deposito`.
3. **Cliente y fórmula del pedido** (si vinieron): cliente sin `zomatik_codigo` → `cliente_sin_vinculo`; fórmula sin
   `zomatik_articulo_codigo` → `formula_sin_vinculo`. La fórmula tiene que ser de la planta (si no, 400).
4. **¿Ya está en el sistema?** (sin Zomatik): `zomatik_np` con
   `numero = numeroCompleto(comprobante, numero)` (si vino el prefijo) o con cualquiera de los dos prefijos (si no
   vino). Dos filas con NP y NP2 → `ambigua`. Una fila:
   - `anulada` / `vaciada` / `vaciar` / `vaciando` → `anulada_sistema`; `revisar` / `error` / `pendiente` /
     `generando` → `revisar`;
   - `npUsable(sb, fila, { client_id, formula_id, plant_id })` (6.1). Si falla, ese motivo;
   - libre ≤ 0.001 → `usada`;
   - si no: 200 `yaEstaba: true`, sin tocar Zomatik ni la base.
   En el alta (sin cliente ni fórmula) el cliente y la fórmula salen de la fila.
5. **Turno del robot**: `zomatik_robot_tomar` con `p_segundos: 60` y `quien = traer·{usuario}·{base36}`; si no lo da,
   se reintenta cada 3 s hasta 15 s (como `actualizar-copia.ts`). Si no → `ocupado`. Se renueva cada 10 s y se suelta
   en un `finally` (`zomatik_robot_soltar`).
6. **Leer en Zomatik** (7): `buscarNpPorNumero` y después `leerNpParaTraer`. `ZomatikError` de entrada o red
   (`sin_credenciales`, `login_rechazado`, `login_bloqueado`, `sesion_caida`, `sin_respuesta`) → `zomatik`; formato →
   `no_se_entiende` (con el recorte en Actividad). No se manda mail desde acá: la pasada del robot ya avisa si Zomatik
   no deja entrar.
7. **Controles** con `evaluarNpTraida` (8.3), puro, sobre lo leído: anulada, inactiva, sin autorizar, cliente,
   artículo, renglón doble, depósito, R/X, remitos, cantidad.
   - En el alta, el cliente sale de `clients.zomatik_codigo = idcliente` (índice único): si no hay → `cliente_no_esta`.
     La fórmula: las de la planta con `zomatik_articulo_codigo` = código del renglón. Ninguna → `sin_formula`; una →
     esa; más de una → `elegir_formula` con la lista (sin registrar nada).
8. **Registrar**: un `insert` en `zomatik_np` (una sola fila: atómico, sin función nueva):

| Columna | Valor |
|---|---|
| `scheduled_dispatch_id` | null |
| `n` | 1 |
| `marca` | `marcaTraida(comprobante, numero)` = `"Traida de Zomatik - NP 0001-00001195"` (ASCII, como las otras marcas) |
| `tipo` / `proyecto_codigo` | `'nueva'` / null; si `proyecto` > 0: `'proyecto'` / ese código |
| `es_adicional` | false |
| `plant_id`, `client_id`, `formula_id` | los del pedido (o los resueltos en el alta) |
| `fecha`, `fecha_zomatik` | `fecha_entrega` de la NP (la `fecha` pasa a la del pedido al usarla, 9.3) |
| `m3` | la cantidad del renglón del artículo |
| `estado` / `paso` | `'ok'` / `'autorizada'` (se vio autorizada en el listado) |
| `numero` | `numeroCompleto(comprobante, numero)` ("NP 0001-00001195") |
| `zomatik_codigo` | el código de `modificar_pedidos.php?codigo=N` |
| `sucursal` | `'18'` |
| `ok_at`, `saldo_desde` | `now()` |
| `created_by` | el nombre de quien la trae |
| `intentos`, `proximo_intento`, `mensaje`, `vendedor_usuario_id` | 0, null, null, null |

   - Si el insert da 23505 (`marca` repetida: otro la trajo en el mismo momento), se lee por la marca y se sigue como
     `yaEstaba`.
   - Actividad (`actividadNp`, `action: "crear"`, `pedidoId: null`, `referencia: "NP 0001-00001195"`): `{ "Qué pasó":
     "NP traída de Zomatik", NP, Cliente, Hormigón, "m³", Entrega, Planta, Marca }`. Sin montos.
9. **Respuesta**: la fila como `NpSaldo` (de `npsConSaldo({ sb, ... })` filtrando por id, o armada igual), más
   `remito` y `avisos`.

### 6.1 `npUsable` (nuevo, en `np-servidor.ts`, exportado)

`npUsable(sb, np: FilaNpDB, ped: { client_id: string; formula_id: string; plant_id: string }): Promise<{ error: string; motivo: string } | { libre: number; comprometido: number; conPedidoActivo: boolean }>`

Lo que hoy hace `validarSaldo`, más la planta: estado `ok`; no `cerrada`/`devolver` (`cerrada`); sin ajuste en marcha
(`ajustandose`); mismo cliente (`otro_cliente`); misma fórmula o mismo artículo (`otro_articulo`); **misma planta si
la NP tiene planta (`otra_planta`, "Esa NP es de otra planta.")**; y el saldo (`saldosDe`). `validarSaldo` pasa a
llamarla (mismos textos de error que hoy, más el de la planta).

## 7. Robot y lista cerrada

### 7.1 Lista cerrada (`lib/zomatik/web.ts`)

Grupo nuevo `rutaLecturaNp(path, metodo, codigoNp)`, **solo lectura y atado a una NP**, copiado de
`rutaEscrituraAjuste` sin el Grabar:
- `GET modificar_pedidos.php?codigo=N` (solo N);
- `GET manage_pedidos.php?…` con `pedidos=N` una sola vez, `pedidos_unico` numérico, sin `codigo` y sin
  `fborrar|faccion|fitems|fautorizar|farticulo|borrar` (es lo que hace la página al abrir la NP; no agrega ni borra);
- `GET _comprobantes.php?ftarget=pedidos&ftargetid=N(&rnd=n)`.
- Nada más: ningún POST (el listado ya está en `rutaPermitida`), ni `grabar_*`, `_autorizarpedido`, `remitir_*`,
  `listado_pedidosdevolucion`, ni otro N.

`lib/zomatik/cliente.ts`: `InitPedido.lecturaNp?: number` y `navegadorLecturaNp(codigoNp)` (copia de
`navegadorAjuste`, sin llave: es lectura; el control de la llave de la planta lo hace `traerNp`). `pedir` acepta la
ruta si `typeof init.lecturaNp === "number" && rutaLecturaNp(ruta, metodo, init.lecturaNp)`.

### 7.2 Funciones del robot (`lib/zomatik/np-robot.ts`)

`buscarNpPorNumero(nav, { numero, comprobante })` con `navegadorLectura()`:
1. `aRebucret(nav)`; `listado(nav, { bus_numero: numero }, SUCURSAL_REBUCRET, true)` (limpio, como
   `buscarNpEnZomatik`).
2. `sucursalPagina !== "18"` → tira `formato` ("el listado vino de otra sucursal"). Paginado → `formato`.
3. Filas con `numeroNormalizado(f.numero) === numero` y, si vino, `comprobanteDeNumero(f.numero) === comprobante`.
4. Devuelve `{ filas: { codigo, numero, cliente, estado, autorizacion }[] }` con `autorizacionEnListado(html, codigo)`.
   **No devuelve `total`.**

`leerNpParaTraer(nav, { codigo, numero, comprobante }, { azar })` con `navegadorLecturaNp(codigo)`:
1. `aRebucret`; `abrir(nav, codigo)`; sin form → `formato`. `pedidos` del form ≠ codigo → `formato`.
2. Detalle como `leerNpParaAjuste`: `manage(nav, c, [fcliente, facopio, forigen, flista], proyecto, azar)`;
   `esDetalle` falso → `formato`.
3. `_comprobantes.php?ftarget=pedidos&ftargetid=N&rnd=…` → `comprobantesDeNp` (puede dar null: ilegible).
4. Devuelve `{ campos: { idcliente, numero, comprobante, deposito, depositoNombre, fecha_entrega, estado, proyecto },
   renglones: { codigoArticulo, nombreArticulo, cantidad }[], comprobantes }`. Sin costo ni total.

No escribe nada, no sigue ningún link de acción y no cambia de sucursal salvo a la 18.

`leerNpParaAjuste`: el control de la marca pasa a
`tieneMarca(obs, d.marca) || (d.traida && esLaNpTraida(a.form.campos, d.traida))`. `DatosAjuste` suma
`traida?: { clienteCodigo: number; numero: string; comprobante: "15" | "16" }`. `vaciarNp` y `autorizarNp` **no
cambian** (siguen exigiendo la marca).

## 8. Funciones puras (`lib/zomatik/np.ts`)

1. `numeroNpTipeado(s)` → `{ numero, comprobante } | null`. Acepta, sin importar mayúsculas ni espacios: "1195",
   "0001-00001195", "1-1195", "NP 0001-00001195", "NP1195", "np2 2086", "NP2 0001-00002086". Sin guion: 1 a 8 dígitos y
   punto 0001. Con guion: `numeroNormalizado`. Prefijo NP → "15", NP2 → "16", sin prefijo → null. Rechaza vacío, letras
   sueltas, "NP3 …", más de 8 dígitos y punto 0000.
2. `PREFIJOS_TRAIDA = ["Traida de Zomatik - ", "A mano - "]`, `marcaTraida(comp, numero)` y `esNpTraida(marca)` (empieza
   con alguno; "A mano - " es la fila de MERVA del 17/11).
3. `evaluarNpTraida(e)` → `{ ok: true, m3, avisos, remito, proyecto } | { ok: false, motivo, error }`. Entrada: lo leído
   (fila del listado + `leerNpParaTraer`) y lo del pedido (`clienteCodigo`, `articulo: { codigo, nombre }`,
   `depositoPlanta`, `nombrePlanta`, `remito`). Orden de los controles:
   anulada (estado del listado `ANU`/`ANULADA`) → inactiva (`estado` del form ≠ "1", ver 12.3) → sin_autorizar
   (`porAutorizar` o sin REMITO) → otro_cliente → otro_articulo (ningún renglón `esRenglonDe`) → renglon_doble → depósito
   → otro_remito (si vino R/X) → comprobantes_ilegibles (null) → con_remitos (algún remito) → sin_m3 (cantidad ≤ 0).
4. `esLaNpTraida(campos, t)`: `numeroNormalizado(campos.numero) === numeroNormalizado(t.numero)` y
   `String(campos.idcliente) === String(t.clienteCodigo)` y, si el form trae `comprobante`, que sea `t.comprobante`.
5. `MSJ_TRAER: Record<MotivoTraer, string>` con los textos de 3.3 (las plantillas con `{…}` como funciones).
6. `MSJ_TRAIDA_DEVOLVER = "La NP la cargaron a mano en Zomatik: el sistema no la vacía. Devolvé o anulá el saldo en Zomatik y tocá «Ya la devolví»."`

## 9. Cambios en lo que ya existe

1. **`npsConSaldo`**: acepta `plantId` (filtra `plant_id`); cada `NpSaldo` suma `traida: esNpTraida(marca)` y
   `remito` ("R" si NP, "X" si NP2). `GET /api/zomatik/np/saldos` pasa `plant_id`. El bloque la pide con
   `{ clientId, formulaId, plantId }`.
2. **`validarSaldo`** usa `npUsable` (6.1): suma el control de planta.
3. **`sincronizarPedido`, `plan.usar`**: después de `zomatik_np_reservar` con `dado > 0`, si la NP es traída, su
   `fecha` ≠ la del pedido y no tiene otro uso activo, `update zomatik_np set fecha = <fecha del pedido>` (solo en el
   sistema, como "mover la NP" de 25.5). Así la sincronización siguiente no pide "falta decidir si se mueve". El log
   dice "El pedido usa {dado} m³ de la NP traída de Zomatik" (y el de hoy para las otras).
4. **`decidirSaldo(…, "devolver")`** con NP traída: **no** llama a `zomatik_np_devolver` (que podría mandarla a vaciar).
   Lee `zomatik_np_saldo`; con pedido activo → "La NP la está usando un pedido activo."; sin libre → "La NP no tiene
   saldo."; si no, `update … set saldo_decision='devolver', saldo_decision_por, saldo_decision_at, saldo_mensaje =
   MSJ_TRAIDA_DEVOLVER where id = … and estado = 'ok' and saldo_decision is null`. Después vuelve a leer el saldo: si
   un pedido la tomó en el medio, deshace (`saldo_decision = null`, `saldo_mensaje = null`) y responde "Un pedido la
   tomó recién. Actualizá la pantalla.". "Ya la devolví" sigue igual.
5. **`NpCancelarPregunta`** (`np-cancelar.tsx`): si alguna NP del pedido es traída (`NpFila.traida`), no muestra "Sí,
   cancelarla"; muestra "La NP la cargaron a mano en Zomatik: queda pendiente en «NP con saldo». Si hay que anularla, se
   hace en Zomatik." y solo "No, dejala pendiente".
6. **`estadoPedidos`** → `NpFila.traida`.
7. **Ajuste** (`ajuste-servidor.ts`, donde arma los datos de `ajustarCantidadNp`): si `esNpTraida(np.marca)`, pasa
   `traida: { clienteCodigo, numero, comprobante }` (cliente de `zomatik_np.client_id` → `clients.zomatik_codigo`,
   comprobante de `comprobanteDeNumero(np.numero)`). Si falta alguno, no se pasa y el ajuste queda "revisar" como hoy.
   El resto del ajuste no cambia: con factura avisa a Juan; con varios renglones, "revisar".
8. **Textos**: `NP_NUEVA` y el toast de `dispatch-scheduling.tsx` "El pedido usa la NP con saldo" → "El pedido usa la
   NP elegida" ("No se generó otra NP."). `LineaPrecio`: "Precio por m³: el de la NP elegida".
9. **Programación › NP con saldo** (`np-saldos.tsx`): las traídas llevan "de Zomatik" al lado del número. Los botones
   no cambian (el servidor ya responde distinto, 9.4).

Lo que **no** cambia: `planificarNp`, `zomatik_np_reservar`, el trigger del despacho, Z1 (`planificarRemitos`,
`remitoAManoEnNp`), el gate del ajuste, `vaciarNp`, `autorizarNp`, el control de NP eliminadas, los precios.

## 10. Base de datos

### 10.1 Fase 1: sin cambios de schema

Ni tablas, ni columnas, ni funciones. Una NP traída es una fila más de `zomatik_np` (un insert, atómico). La elección
del pedido sigue siendo `zomatik_np_pedido.tipo = 'saldo'` con `np_id`. No hay uso hasta que un pedido la reserva.

### 10.2 Datos ya cargados

- **No cambia ninguno.** La fila de MERVA del 17/11 (marca `'A mano - NP 0001-00001195'`, `paso 'a_mano'`) queda
  igual: `esNpTraida` la reconoce por el prefijo, así que el ajuste la trata como traída y "Devolver" no la vacía. Antes
  del remito, Z1 llama a `autorizarNp` (su `paso` no es `autorizada`): si en Zomatik ya está autorizada, pasa a
  `autorizada` como cualquier otra; si no, queda "revisar" (no tiene la marca) y hay que autorizarla a mano.
- Las NP del sistema no cambian. Con el control de planta nuevo, una NP con saldo de otra planta deja de ofrecerse y
  `validarSaldo` la rechaza; los usos que ya existen no se tocan.
- Las traídas que nadie usa aparecen en "NP con saldo" de Programación (son NP reales con saldo): es lo que se quiere.

### 10.3 Fase 2 (propuesta, no implementar sin el OK de Bautista): NP con remitos previos

Para que libre = cantidad − remitido hacen falta tres cosas, y la tercera necesita guardar qué remitos son:
1. **Saldo:** un uso sin pedido, inactivo, `m3 = 0`, `despachado_fijo = remitido`, `motivo = "Remitido en Zomatik antes
   de traerla"`. Las cuentas de saldo (`saldoNp`, `zomatik_np_saldo`) y el ajuste (`comprometidoOtros`) ya lo cuentan
   bien; "Devolver" ve `comprometido > 0` y pide DEVOL a mano.
2. **Gate del ajuste** (`ajuste-servidor.ts`, `gate`): `pendienteEsperado(m3, remitido + previo)`.
3. **Remito (Z1):** `remitoAManoEnNp` frena con cualquier remito que no grabó el sistema; los previos tienen que
   sumarse a `nuestros` (`remitosNuestros`).

Migración propuesta `supabase/migrations/202611171200_zomatik_np_traida.sql`:
- `ALTER TABLE zomatik_np ADD COLUMN IF NOT EXISTS remitos_previos jsonb` (`[{ codigo, numero, comprobante, m3 }]`, nulo
  = ninguno);
- función `zomatik_np_traer(p jsonb) RETURNS uuid` que inserta la NP y el uso de lo remitido en una sola transacción
  (`ON CONFLICT (marca) DO NOTHING`), con `REVOKE` a anon y `GRANT` a `service_role`, como `zomatik_np_crear_con_uso`.
- **Datos ya cargados:** ninguno cambia (la columna queda nula en todas, incluida MERVA). Se prueba en `BEGIN …
  ROLLBACK` antes de aplicarla.
- Lo remitido se lee del reporte de remitos de venta (`reporte_remitosventa.php`, Z0, como `tieneRemitos`) por número de
  NP y artículo, y se cruza con `_comprobantes`: un remito que esté en uno y no en el otro → `comprobantes_ilegibles`.

## 11. Casos borde

| Caso | Qué pasa |
|---|---|
| La NP es de un proyecto | Se trae con `tipo 'proyecto'` y `proyecto_codigo`; aviso "Es de un proyecto.". Se usa, remite y ajusta como las NP de proyecto del sistema |
| NP2 (X) y el pedido dice R, o al revés | Con R/X en el formulario: `otro_remito`, no se registra. Sin R/X: se registra y el formulario toma el de la NP. Si después alguien cambia el R/X del pedido, Z1 frena el remito como hoy |
| Tiene remitos previos | Fase 1: `con_remitos`, no se registra. Fase 2: 10.3 |
| Es de otra sucursal (RUTA 25) | Número fuera de la serie: `otra_serie`, sin llamar a Zomatik. En la serie pero no en el listado de la 18: `no_existe` |
| Ya está en `zomatik_np` | Se usa la existente (6, paso 4), sin leer Zomatik. Si otro pedido la usa entera: `usada` |
| La trajeron dos personas a la vez | La segunda choca con la marca única y devuelve la primera (`yaEstaba`) |
| Sin autorizar | `sin_autorizar`. Una persona la autoriza en Zomatik y se busca de nuevo |
| Depósito de otra planta o de PILAR | `otro_deposito` |
| Tiene factura | Se trae, con aviso. Al terminar, el ajuste ve la factura y avisa a Juan (lo de hoy) |
| Tiene otros renglones (bomba) | Se trae, con aviso. Al terminar, el ajuste queda "revisar" ("tiene N renglones") |
| El pedido pide más que lo libre | Lo de hoy: "Toma X m³ de esa NP y Y m³ van en una NP nueva." |
| Fecha de entrega distinta a la del pedido | Se usa igual; al reservarla, su `fecha` pasa a la del pedido (9.3). `fecha_zomatik` queda la de Zomatik |
| Se cancela el pedido | La NP queda en "NP con saldo" (no se ofrece vaciarla, 9.5) |
| La eliminan en Zomatik | El control de NP eliminadas la trata como cualquier otra |
| Zomatik caído o el robot ocupado | `zomatik` / `ocupado`; no se registra nada |
| El alta con dos fórmulas del mismo artículo | `elegir_formula`; nada se registra hasta elegir |

## 12. Tests

`lib/__tests__/zomatik-np-traer.test.mjs` (nuevo), sumado al script `test:zomatik-np` de `package.json`. Base y
navegador simulados como en `zomatik-np-servidor.test.mjs`.

### 12.1 Puras
- `numeroNpTipeado`: los 7 formatos de 8.1 dan lo esperado; "", "abc", "NP3 1", "123456789", "0000-00001195" → null.
- `esNpTraida`: las dos marcas sí; "Sistema Rebucret - pedido … - NP 1" no.
- `evaluarNpTraida`: un caso por motivo de 8.3 y el orden (anulada gana a otro_cliente); ok con proyecto, con factura y
  con otros renglones (avisos).
- `esLaNpTraida`: ok; otro número; otro cliente; NP vs NP2.
- `rutaLecturaNp`: acepta las tres rutas con N; rechaza otro N, `grabar_pedidos.php?codigo=N`, `manage_pedidos` con
  `fborrar`/`farticulo`/`codigo`, `_autorizarpedido…`, `remitir_ordenfabricacion.php?codigo=N`,
  `listado_pedidosdevolucion.php?pedido=N`, y cualquier POST.

### 12.2 Robot y servidor
- `buscarNpPorNumero`: una fila; NP y NP2 con el mismo número (ambigua); ninguna; otra sucursal (`frm_selsuc` ≠ 18);
  fila sin autorizar (`Autorizar(N)`, en rojo).
- `leerNpParaTraer`: con `np-abierta.html` + `detalle-np-abierta.html` + `comprobantes-sin-nada.html` da cliente,
  depósito, fecha y un renglón; con `comprobantes-con-factura.html`, remitos y factura. Ninguna respuesta del robot
  ni de `traerNp` tiene `total`, `costo` ni `$` (se revisa el JSON).
- `traerNp`: registra (fila de 6.8 exacta, Actividad sin montos, turno tomado y soltado); ya estaba (no llama al
  navegador); 23505 → yaEstaba; ocupado (el turno no se da en 15 s, reloj simulado); llave apagada; cada rechazo no
  inserta nada; alta con una fórmula; alta con dos (`elegirFormula`, no inserta); cliente no está.
- `validarSaldo`/`npUsable`: otra planta → error.
- `decidirSaldo("devolver")` con traída: no llama a `zomatik_np_devolver`; queda `devolver` con `MSJ_TRAIDA_DEVOLVER`;
  con un pedido que la toma en el medio, deshace.
- `sincronizarPedido` con traída: usa la NP (sin crear otra), le pasa la fecha del pedido; pidiendo más que lo libre,
  crea una NP nueva por la diferencia.
- `leerNpParaAjuste` con traída sin marca: sigue si número y cliente coinciden; "revisar" con otro cliente.

### 12.3 Fixtures (`lib/__fixtures__/zomatik-np-traer/`, con README que diga REAL / ARMADO)
- Se reusan: `zomatik-np/np-abierta.html`, `zomatik-np/detalle-np-abierta.html`, `zomatik-np/listado-1176.html`,
  `zomatik-ajuste/comprobantes-*.html`.
- Armados: listado con NP y NP2 del mismo número; fila sin autorizar; comprobantes con solo factura (sin remito);
  NP abierta de otro cliente y de otro depósito.
- **Captura real que hace falta antes de publicar** (solo lectura, la hace Bautista desde su navegador o la autoriza):
  de la NP 0001-00001195 (código 157919), la fila del listado buscando por número, `modificar_pedidos.php?codigo=157919`,
  el `manage_pedidos.php` que carga la página y `_comprobantes.php`. Sobre todo: **qué valor trae el campo `estado` de
  una NP activa y de una anulada** (hoy se supone "1" = activa por la fixture armada; si no coincide, se ajusta
  `evaluarNpTraida` y el control falla cerrado: "No está activa en Zomatik").

## 13. Criterios de aceptación

1. Con la llave de la planta prendida, la tercera opción dice "Traer NP de Zomatik" en la pregunta del alta y en el
   bloque del formulario. Con la llave apagada, todo como hoy.
2. Pedido de MERVA S.A. en Hudson con H30-620-10 C (HUD): escribir "1195", "0001-00001195" o "NP 0001-00001195" encuentra
   la NP de la fila del 17/11 **sin llamar a Zomatik** y la ofrece con sus m³ libres; si el pedido de MERVA ya la usa
   entera, dice "Ya la usa otro pedido y no le quedan m³ libres.".
3. Una NP real de Rebucret que no está en el sistema, sin remitos, autorizada, del cliente, artículo y depósito del
   pedido: aparece elegida en la lista en menos de 20 s con "Lista: NP …, X m³ libres."; en `zomatik_np` queda una fila
   como 6.8 y en Actividad "NP traída de Zomatik". Al guardar el pedido no se genera otra NP; si pide más de lo libre,
   la diferencia sale en una NP nueva.
4. Buscar dos veces la misma NP no crea dos filas.
5. "7706" (RUTA 25): "Ese número no es de Rebucret…", sin llamar a Zomatik. Una NP de otro cliente, otro hormigón,
   otro depósito, NP2 con el pedido en R, sin autorizar o con remitos: su mensaje de 3.3 y nada registrado.
6. Con el robot generando una NP en ese momento: "Zomatik está ocupado…" a los 15 s como mucho.
7. Titan (operario, sin `precios_np`) puede traer una NP; ni la pantalla ni la respuesta de `/api/zomatik/np/traer` ni
   Actividad tienen montos.
8. Al finalizar un pedido que usó una NP traída (con la llave del ajuste prendida), el ajuste la lee y la ajusta (o,
   con factura, avisa a Juan); no queda "revisar" por falta de la marca.
9. "Devolver el saldo" de una traída nunca la manda a vaciar: queda "Devolver" con el mensaje de hacerlo a mano.
   Cancelar un pedido con traída no ofrece "Sí, cancelarla".
10. En el bloque, una NP con saldo de otra planta ya no se ofrece, y forzarla da "Esa NP es de otra planta.".
11. La lista cerrada rechaza, antes de salir, cualquier ruta del grupo de lectura con otro código o con acción (12.1).
12. `npm run test:zomatik-np` (con el archivo nuevo), `test:zomatik-ajuste` y `test:zomatik-z1` pasan; `tsc` sin
    errores nuevos en los archivos tocados; `next build --webpack` bien (borrar `.next` después).

## 14. Archivos

| Archivo | Qué |
|---|---|
| `app/api/zomatik/np/traer/route.ts` | **Nuevo.** La ruta (5) |
| `lib/zomatik/np-traer-servidor.ts` | **Nuevo.** `traerNp` (6), con dependencias inyectables |
| `lib/zomatik/np.ts` | Puras de 8 |
| `lib/zomatik/np-robot.ts` | `buscarNpPorNumero`, `leerNpParaTraer`; `DatosAjuste.traida` y el control de `leerNpParaAjuste` (7.2) |
| `lib/zomatik/web.ts` | `rutaLecturaNp` (7.1) |
| `lib/zomatik/cliente.ts` | `navegadorLecturaNp`, `InitPedido.lecturaNp` y el `if` de `pedir` |
| `lib/zomatik/np-servidor.ts` | `npUsable`, `validarSaldo`, `npsConSaldo` (planta, `traida`, `remito`), `sincronizarPedido` (9.3), `decidirSaldo` (9.4), `estadoPedidos` (`traida`) |
| `lib/zomatik/ajuste-servidor.ts` | Pasar `traida` a `ajustarCantidadNp` (9.7) |
| `lib/zomatik/np-cliente.ts` | `traerNpDeZomatik`; `NpSaldo.traida/remito`; `NpFila.traida`; `cargarNpSaldos({ plantId })` |
| `app/api/zomatik/np/saldos/route.ts` | Acepta `plant_id` |
| `components/zomatik/np-bloque.tsx` | Opción, campo, estados, lista con planta, textos (3.1) |
| `components/zomatik/np-pregunta.tsx` | Opción, botón "Buscar NP … en Zomatik", elegir fórmula (3.2) |
| `components/dispatch-scheduling.tsx` | `onSaldo` de la pregunta pone el R/X si falta; toast (9.8) |
| `components/zomatik/np-cancelar.tsx` | Sin "Sí, cancelarla" para traídas (9.5) |
| `components/zomatik/np-saldos.tsx` | "de Zomatik" en las traídas |
| `lib/__tests__/zomatik-np-traer.test.mjs`, `lib/__fixtures__/zomatik-np-traer/` | **Nuevos** (12) |
| `package.json` | Solo el script `test:zomatik-np` (sin dependencias) |
| `docs/migracion-loop/zomatik.md` | Sección 28 (texto de 15) |

Patrones a copiar: la ruta, de `app/api/zomatik/np/route.ts`; el turno con espera, de `lib/zomatik/actualizar-copia.ts`;
el navegador atado a una NP, de `navegadorAjuste`; la lectura de la NP, de `leerNpParaAjuste`; la búsqueda por número,
de `buscarNpEnZomatik`; las pruebas con base simulada, de `zomatik-np-servidor.test.mjs`.

## 15. Texto para `docs/migracion-loop/zomatik.md` (sección 28)

```markdown
## 28. Traer NP de Zomatik (17/11/2026) — cambia 25.2 y 25.10

Spec: `docs/specs/2026-11-17-traer-np-de-zomatik.md`. Motivo: Juan cargó a mano la NP 0001-00001195 de MERVA S.A.
(25 m³ H30-620-10 C (HUD)) para facturarla y había que programarla sin que el robot hiciera otra.

- **La tercera opción** de "¿Qué NP?" y del bloque del pedido pasa a ser **"Traer NP de Zomatik"**: un campo para el
  número (1195, 0001-00001195, NP 0001-00001195 o NP2 2086) y, abajo, las NP con saldo de siempre. Un solo botón.
- **Buscar** (`POST /api/zomatik/np/traer`, `programacion.cargar`): si la NP ya está en `zomatik_np`, se usa esa, sin
  leer Zomatik. Si no, con el turno del robot y solo lectura (listado de pedidos por número en la 18, la NP abierta, su
  detalle y sus comprobantes; grupo `rutaLecturaNp`, atado a esa NP), se controla: activa, autorizada, cliente,
  artículo, depósito de la planta, NP/NP2 contra el R/X del pedido, sin remitos y con m³. Si pasa, se registra en
  `zomatik_np` sin pedido (marca "Traida de Zomatik - NP …", `estado ok`, `paso autorizada`, sucursal 18).
- **Se usa** como "Usar NP con saldo": `sincronizar` → `validarSaldo` → `zomatik_np_reservar`. Lo que no entra va en
  una NP nueva. Al reservarla toma la fecha del pedido (solo en el sistema).
- **Ajuste al finalizar:** reconoce la NP traída por número y cliente en vez de la marca. Con factura avisa a Juan
  (lo de siempre).
- **Nunca se vacía sola:** "Devolver el saldo" pide la devolución a mano y al cancelar no se ofrece "Sí, cancelarla".
- **De paso:** una NP con saldo de otra planta ya no se ofrece ni se acepta.
- Sin montos en ningún lado. Sin cambios de base. La fila de MERVA del 17/11 ("A mano - NP …") se trata como traída.
- **Pendiente (fase 2, necesita migración):** traer NP con remitos previos (libre = cantidad − remitido). Hoy se
  rechazan.
```

## 16. Decisiones para Bautista (con recomendación)

1. **NP con remitos previos.** Para soportarlas hace falta una migración (una columna y una función, sin tocar datos;
   10.3). **Recomendación:** fase 1 ya, que las rechaza con un mensaje claro, y la fase 2 cuando aparezca el primer
   caso real (la de MERVA no tiene remitos).
2. **NP sin autorizar.** **Recomendación:** no traerla ("que la autorice un gerencial"). Autorizar es un control de
   ustedes y el robot solo autoriza las NP que genera.
3. **NP de otro depósito** (por ejemplo, PILAR por defecto). **Recomendación:** no traerla y que la corrijan en
   Zomatik: el remito automático solo se probó con el depósito de la planta.
4. **NP con otros renglones (bomba).** **Recomendación:** traerla con aviso; al terminar, el ajuste queda para una
   persona.
5. **Captura real de la NP 1195** (solo lectura, 12.3), sobre todo el valor del campo "estado". **Hace falta antes de
   publicar.**
