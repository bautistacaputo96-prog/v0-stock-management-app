# Ajustar la NP a lo despachado al finalizar el pedido (antes de la OF y el remito)

Estado: **aprobada por Bautista el 06/11/2026 con las decisiones de la sección 15 (mandan sobre el resto).** Fase 1 en curso.
**13/11/2026: la decisión 16 (bajar también el saldo libre) reemplaza a la 15.3 y a la cuenta de 3.1.**
Manda sobre `docs/migracion-loop/zomatik.md` 25.3 (allá era "remito primero y después DEVOL") y sobre 26.7.4 / 26.9.4
("DEVOL en otra etapa"). Todo lo demás de las secciones 20 a 26 sigue igual.

---

## 0. Qué hay hoy (relevado en el código de `main`)

| Pieza | Dónde | Qué hace | Qué le falta para este pedido |
|---|---|---|---|
| Finalizar | `components/despacho/despacho-tablero.tsx` `hacerFinalizar` → RPC `finalizar_pedido` → `remitirAhora` → `remitirPedido` (`lib/zomatik/z1-cliente.ts`) → `POST /api/zomatik/remito` | Cierra el pedido (`status = completed`) y pide OF + remito | No toca la NP |
| "Remitir en Zomatik" | Menú del pedido, misma función `remitirAhora` | Igual, sin finalizar | Igual |
| Armar remitos | `prepararRemitos` (`z1-servidor.ts`) + `planificarRemitos` (`z1.ts`) | Un remito por día real y NP con los despachos sin remitir (7 días). Si un despacho no entra en lo que reserva el pedido de la NP: problema "generá una NP adicional", **no se remite** | El sobrante (60 → 40) no se corrige; el exceso (tolerancia de +0,5 m³ por despacho en `registrar_despacho`) frena el remito |
| Robot OF + remito | `procesarZ1` → `generarOf` → `autorizarNp` → `elegirNumeroRemito` → `generarRemito` | Turno único, pasos guardados antes de grabar, nunca un Grabar a ciegas | No hay ningún paso de NP antes de la OF |
| Robot de la NP | `np-robot.ts`: `generarNp`, `vaciarNp`, `autorizarNp` | Vaciar: abre la NP, carga el detalle con `manage_pedidos.php` (`pedidos=N` + su `pedidos_unico`), borra renglones (`fborrar`), graba en `grabar_pedidos.php?codigo=N`, verifica | **Editar la cantidad** de un renglón ya grabado no existe (es lo mismo que vaciar, pero con `conCantidad` en vez de `fborrar`) |
| Saldo de la NP | `saldoNp` / `despachadoPorUso` (`np.ts`) y `zomatik_np_saldo` en la base | Saldo = m³ de la NP − comprometido de sus usos. Lo despachado de un pedido se reparte entre sus NP en orden; **el último uso se lleva lo que sobra** | — (se reusa tal cual) |
| NP con saldo | `npsConSaldo`, `decidirSaldo` | Lista en Programación; "Devolver el saldo" con despachos = **DEVOL a mano** + "Ya la devolví" | Sigue igual (ver Fuera de alcance) |
| Lista cerrada | `web.ts`: `rutaPermitida` (lectura), `rutaEscrituraNp`, `rutaEscrituraZ1`; `cliente.ts`: `navegadorNp`, `navegadorZ1` | Toda ruta fuera de la lista se rechaza antes de salir | El navegador de Z1 no puede abrir el detalle de la NP ni grabarla; no hay rutas de DEVOL |
| Avisos | `avisarErrorZomatik` (solo Bautista), `avisarGerenciales` (Bautista, Juan, Fernando), `mandarAviso` (privada, por nombre en `app_users`) | Mail por Resend, un mail por episodio | No hay aviso solo a Juan |
| Factura de la NP | — | **No se sabe cómo se ve en Zomatik.** El detalle real de la NP (`lib/__fixtures__/zomatik-np/detalle-np-abierta.html`) tiene `MostrarComprobantes('pedidos',157767)` ("COMPROBANTES / OPERACIONES") y el botón `botgrabar`; el listado tiene FC / FC / RECIBO / DEVOL por fila (20.5) | Hay que capturarlo (sección 7) |

Ojo: los fixtures están en `lib/__fixtures__/zomatik-np/` y `lib/__fixtures__/zomatik-z1/` (no hay `lib/__fixtures__/zomatik/`).

**Conclusión:** no hace falta nada paralelo. El ajuste es un paso más de Z1, antes de la OF, con el mismo blindaje que
el resto del robot (turno único, marca, paso guardado antes de grabar, verificación, sin repetir a ciegas). Editar la
cantidad reusa lo de vaciar; la cantidad sale de la misma cuenta que ya usa el saldo (`despachadoPorUso`).

## 1. Objetivo

Que al finalizar un pedido (o tocar "Remitir en Zomatik" en uno completo) la NP de Zomatik quede con los m³ que de verdad
se despacharon **antes** de hacer la OF y el remito: editando la NP si no tiene factura, o con una devolución de pedido
(DP / DP2) por la diferencia si la tiene. Así la NP no queda con un pendiente fantasma (60 − 40 = 20 m³) que nadie cierra.

Por qué antes de la OF y no solo antes del remito: si el ajuste falla y el remito tiene que esperar, una OF hecha sin su
remito deja stock colgado en Zomatik.

## 2. Alcance

### 2.1 Fases

| Fase | Qué | Necesita |
|---|---|---|
| **0. Capturas** | Lo de la sección 7, con Bautista, en el navegador. Sin programar nada que escriba antes de tenerlas | Bautista, 40 min |
| **1. Ajuste por edición** | Plan del ajuste, tabla y llave nuevas, gate en Z1, robot que lee la NP, detecta factura y **edita la cantidad** (achicar o agrandar). Si la NP tiene factura: **no se toca**, queda "Hacer la DEVOL a mano" + mail a Juan, y el remito espera hasta "Ya la hice" | Capturas 1, 2 y 4 |
| **2. DEVOL automática** | El robot hace la DP / DP2 por la diferencia cuando la NP tiene factura | Captura 3 y la primera DEVOL real con Juan mirando |

Se programan y se prueban en preview en ese orden. La llave nueva queda apagada hasta que Bautista la prenda (sección 5.1).

### 2.2 Qué se hace (fases 1 y 2)

1. **Al finalizar o remitir un pedido completo**, por cada NP que usa el pedido se arma un **ajuste** con la cantidad
   que tiene que quedar (sección 3). Si no hay que tocar nada, el ajuste nace "nada" y el remito sigue como hoy.
2. **Gate:** el remito (y su OF) de un pedido completo espera hasta que el ajuste de su NP esté "ok", "nada" o "a mano".
3. **El robot, por ajuste:** lee la NP → ¿tiene factura? → edita la cantidad o hace la DEVOL (o vacía, si queda en 0) →
   verifica → guarda en la base. Recién después, OF → remito (lo de siempre).
4. **El remito controla el ajuste:** antes de grabar, lo pendiente que trae Zomatik en "Continuar" tiene que ser el
   esperado. Si no, frena sin grabar el remito (sección 4.4).
5. **Exceso** (se despachó más de lo que tiene la NP): se agranda la NP si no tiene factura; si tiene, NP adicional
   por la diferencia (sección 3.3). Después se vuelven a armar los remitos con los despachos que habían quedado afuera.
6. **Avisos:** mail a Bautista si falla (lo de hoy), mail a Juan si hubo DEVOL o la NP tenía factura (sección 6).
7. **Escape gerencial:** "Remitir sin ajustar la NP" (con motivo) si el ajuste queda trabado y la NP se arregla a mano.

## 3. Qué cantidad

### 3.1 La cuenta (una sola, la misma del saldo)

Para el pedido P que se completa y cada uso activo `u` de P sobre una NP `x` (estado "ok", en Zomatik):

- `desp_u` = lo despachado de P que le toca a `x`, con `despachadoPorUso` (`np.ts`), sobre los despachos de P que no
  son de prueba, **de todos los días** (no `dispatched_m3`: se suman los despachos con el mismo filtro de
  `prepararRemitos`). El último uso se lleva el exceso, si lo hay.
- `cant_x` = la cantidad del renglón de `x` **leída en Zomatik** al momento del ajuste. Tiene que ser igual a
  `zomatik_np.m3`; si no, alguien la tocó a mano: **revisar**, no se toca.
- **Objetivo:** `obj_x = cant_x − u.m3 + desp_u`. O sea, se le saca a la NP solo lo que **este pedido** reservó y no
  usó (o se le suma lo que se pasó). Lo que reservan otros pedidos o lo que quedó libre de antes no se toca.
- **Piso:** `obj_x ≥ comprometido de los otros usos de x + desp_u` (lo que otros pedidos activos todavía necesitan y lo
  que ya despacharon). Con las reservas hechas en la base (`zomatik_np_reservar`, `FOR UPDATE`) siempre se cumple; si
  no se cumple, **revisar** y no se toca.
- **Control con los remitos:** `Σ zomatik_remitos.m3` de P contra `x` (sin anulados, incluidos los que se acaban de
  armar) tiene que dar `desp_u`. Si no da (un caso raro de dos NP donde un despacho entero fue a la otra), **revisar**:
  la cuenta del saldo y lo remitido en Zomatik no coinciden y no se adivina.
- Si P tiene despachos de antes de `remitir_desde` (se remitieron a mano), **revisar**: "Ajustá la NP a mano".

### 3.2 Casos (todos van a las pruebas)

| Caso | NP en Zomatik | Uso de P | Despachado P | Otros | Objetivo | Qué hace |
|---|---|---|---|---|---|---|
| **Santa Rita** | 60 | 60 | 40 (un día) | — | 40 | Edita 60 → 40 |
| Varios días | 60 | 60 | 25 + 15 (dos días; 25 ya remitidos) | — | 40 | Edita 60 → 40 con un remito parcial de 25 |
| NP compartida | 60 | 40 | 30 | otro pedido activo reserva 20 | 50 | Edita 60 → 50 (nunca menos de 20 + 30) |
| "Usar NP con saldo" | 100 (de un pedido cancelado sin despachos) | 30 | 20 | 70 libres en "NP con saldo" | 90 | Edita 100 → 90; los 70 libres siguen en "NP con saldo" (pregunta 3) |
| Dos NP (NP 1 50 + adicional 10) | 50 / 10 | 50 / 10 | 40 | — | 40 / 0 | NP 1 → 40; la adicional queda en 0 (3.4) |
| Exceso por la tolerancia | 40 | 40 | 40,4 | — | 40,4 | Agranda 40 → 40,4 (3.3) |
| Completo justo | 60 | 60 | 60 | — | 60 | "nada": no se abre Zomatik |
| Con factura | 60 facturada | 60 | 40 | — | 40 | DEVOL por 20 (fase 2; en la fase 1, a mano) |

### 3.3 Si se despachó MÁS de lo que dice la NP (punto 4)

**Propuesta:** agrandar la misma NP si no tiene factura. Es el mismo paso que achicar (poner la cantidad del renglón),
deja una sola NP y un solo remito, y destraba el caso de hoy en que un exceso de la tolerancia (+0,5 m³ por despacho)
frena el remito con "generá una NP adicional". La decisión 20.1.5 ("pedido que se agranda: NP adicional") sigue para
cuando se agranda el pedido **antes** de despachar (Programación, "Editar total"): ahí no se toca.

- **Con factura:** no se agranda. NP adicional por el exceso (NP o NP2 según la NP original, misma fórmula y planta),
  con la función que ya crea NP + uso (`zomatik_np_crear_con_uso`), y se autoriza como siempre. El remito del exceso
  sale contra esa NP.
- **NP de proyecto:** se intenta agrandar; si Zomatik contesta "excede el monto del acopio", va a una NP adicional
  común por el exceso (la opción 2 de 20.4, que ya decidió Bautista).
- Después del ajuste se vuelve a llamar a `prepararRemitos` del pedido: el despacho que había quedado afuera entra.

### 3.4 Si una NP queda en 0

Pasa con una NP adicional que no se llegó a usar. Sin remitos y sin factura: se **vacía** con `vaciarNp`, el mismo
mecanismo que aprobó Bautista el 28/10 ("Sí, cancelarla"). Con remitos o factura no puede quedar en 0 por la cuenta;
con factura y sin remitos: DEVOL por todo. Es el único caso que saca un renglón; el ajuste nunca borra una NP, un
remito, una OF ni una devolución (pregunta 5).

### 3.5 NP de proyecto (acopio / MATERIAL) (punto 5)

- La NP de proyecto se ajusta igual (editar o DEVOL). **No sabemos si el saldo vuelve al proyecto** al bajarla o al
  devolver (23.4 y 20.5.6 lo dejaron abierto; existen los comprobantes "Anulación Material Proyecto" 84/85).
- Se resuelve una vez, con la captura 4.3. Mientras no esté confirmado que vuelve solo:
  - el ajuste de una NP de proyecto se hace igual (la NP tiene que coincidir con lo despachado);
  - y **mail a Juan**: "El saldo del proyecto … puede no haber vuelto: revisá si hace falta la Anulación Material
    Proyecto". El sistema **no** hace la anulación de material (pregunta 7).
- En nuestra base no cambia nada del proyecto: el "≈ m³" sale de lo remitido (20.3) y `disponible_m3` se vuelve a
  leer en el próximo MATERIAL.

## 4. Orden exacto, fallas y reintentos (punto 1)

### 4.1 Quién arma el ajuste

`prepararAjustes(pedidoId)` (nuevo, `lib/zomatik/ajuste-servidor.ts`), idempotente (una fila por pedido y NP, marca
única). Se llama:
1. en `POST /api/zomatik/remito` (Finalizar y "Remitir en Zomatik"), **después** de `prepararRemitos` y antes de
   responder, si el pedido está completo;
2. en `pasadaZ1` (noche) para los pedidos completos que prepara;
3. en el gate de `procesarZ1` si encuentra un remito de un pedido completo sin ajuste (por si se cortó entre los dos).

Solo si la llave del ajuste está prendida en la planta y el pedido tiene algún despacho creado después de
`ajustar_desde`. Si el pedido se **reabre** (`reabrir_pedido`) con el ajuste sin hacer, el ajuste queda "anulado"
(el robot lo controla antes de grabar, como hace la NP con el pedido cancelado).

### 4.2 El robot, por ajuste

Corre dentro de `procesarZ1`, con el mismo turno (`zomatik_robot_tomar`), **antes** de las filas de remito del mismo
pedido. Cada paso se guarda con `guardarSi(… estado = 'generando')` antes de hacerlo, como en Z1.

| # | Paso (`paso`) | Qué hace | Si falla |
|---|---|---|---|
| 1 | `leer_np` | Sucursal 18. Abre `modificar_pedidos.php?codigo=N`: tiene que tener **nuestra marca**, el hidden `pedidos` = N y grabar en `grabar_pedidos.php?codigo=N`. Carga el detalle como la página (`manage_pedidos.php` con `pedidos=N` + su `pedidos_unico`, igual que `detalleGrabado`). Un solo renglón, del artículo de la NP. Lee `cant_x` y el total del listado | Sin marca, más de un renglón o `cant_x ≠ zomatik_np.m3` → **revisar** (no se toca). Red → **pendiente** (10 min). Formato raro → **error** con recorte |
| 2 | `leer_factura` | Lee las señales de la sección 5 (fila del listado, comprobantes de la NP, botón Grabar). Resultado: con factura / sin factura / no se sabe | "No se sabe" → **revisar**: "No se pudo saber si la NP tiene factura. No se tocó" |
| 3 | `decidir` | Calcula `obj_x` (3.1). Elige: `editar` (sin factura), `devol` (con factura y obj < cant), `vaciar` (obj = 0, sin remitos ni factura), `adicional` (con factura y obj > cant) | Piso o control de remitos no da → **revisar** |
| 4a | `editar_detalle` → `grabar_np` → `verificar_np` | `conCantidad(renglón, obj)`, Grabar en `grabar_pedidos.php?codigo=N` con todos los campos del renglón y `fparam`, sin `fborrar` (como `cuerpoGrabar`). Verificar: abrir otra vez, detalle con **un** renglón en `obj`, marca, mismo número, y el total del listado ≈ total anterior × obj / cant | Alert de Zomatik → **error** con el texto. Verificación no da → **revisar** |
| 4b | `devol_listado` → `devol_form` → `devol_numero` → `grabar_devol` → `verificar_devol` | (Fase 2) DP / DP2 por `cant − obj`, con la marca en observaciones. Verificar en `listado_pedidosdevolucion.php?pedido=N` (y en el listado de pedidos como DEVPED) que está la DP con la marca y esa cantidad | Igual que 4a |
| 4c | pasos de `vaciarNp` | El vaciado de siempre | Lo de siempre |
| 4d | `adicional` | Crea la NP adicional (NP + uso) y la deja "pendiente": la genera la pasada de NP | — |
| 5 | `aplicar` | En la base, con la NP bloqueada (`zomatik_ajuste_aplicar`): `zomatik_np.m3 = obj` (o `cant − DEVOL`), `uso.m3 = desp_u`, `saldo_decision = 'cerrada'` si no le queda libre ni pedido activo; el ajuste queda "ok" | Error de la base → sigue "generando" en `aplicar`; el reintento **solo** repite `aplicar` (Zomatik ya dice `obj`) |

Después: si hubo exceso agrandado, `prepararRemitos(pedido)` otra vez. Y siguen las filas de remito del pedido (OF →
autorizar → número → remito), ya liberadas por el gate.

### 4.3 Cortes y reintentos ("nunca un Grabar a ciegas")

- **Editar es absoluto** (se pone la cantidad `obj`, no "restar 20"), así que reintentar es seguro. Corte en
  `grabar_np` o `verificar_np`: primero se relee la NP. `cant = obj` → ok (solo falta `aplicar`). `cant = cant` de
  antes → se vuelve a editar. Otra cantidad → **revisar**.
- **La DEVOL no es idempotente.** Corte en `grabar_devol` o `verificar_devol`: primero se busca la DP con la marca en
  el listado de devoluciones de esa NP. Está → ok. Seguro que no está (listado leído entero, de REBUCRET) → se
  reintenta. Dudoso (otra sucursal, paginado, no abre) → **revisar**. Nunca una segunda DEVOL sin buscar.
- "Generando" colgado más de 3 min = corte (como la NP y Z1). Más de 3 cortes → **revisar** con aviso.
- Estados: `pendiente` (red, sesión, Zomatik caído: cada 10 min con la pasada de pg_cron) · `generando` · `ok` ·
  `nada` · `revisar` (lo mira una persona) · `error` (Zomatik dijo que no o falta un dato: solo con el botón
  "Remitir en Zomatik") · `a_mano` (un gerencial lo resolvió en Zomatik) · `anulado` (el pedido se reabrió).
- Sesión de Zomatik caída: el aviso único de siempre (`avisarFallaAcceso`), no uno por ajuste.

### 4.4 El remito no puede salir contra una NP mal ajustada

1. **Gate en `procesarZ1`** (antes de abrir el navegador, sin tocar Zomatik): un remito `tipo = 'pedido'` de un pedido
   completo, con la llave del ajuste prendida, solo sigue si el ajuste de su NP está `ok`, `nada` o `a_mano`. Si no:
   queda "pendiente", `paso = 'esperando_ajuste'`, mensaje "Esperando el ajuste de la NP", reintento en 10 min. Ese
   paso no manda el mail de "pendiente hace más de 1 hora" (el ajuste tiene el suyo), como `autorizar_np`.
2. **Doble control en `generarRemito`:** `DatosRemito` suma `pendienteEsperado` (= `obj_x` − lo ya remitido contra la
   NP por todos los pedidos − lo devuelto). Si el pendiente que trae "Continuar" difiere en más de 0,001 →
   **revisar** sin grabar el remito: "La NP no quedó ajustada: Zomatik dice 20 m³ pendientes y el sistema esperaba 0".
   Con la llave del ajuste apagada, `pendienteEsperado` va nulo y no se controla (como hoy).

## 5. Cómo se detecta "tiene factura" (punto 2)

Hoy no lo sabemos. Propuesta: el robot mira **tres señales**, todas de solo lectura, y decide así:

| Señal | Dónde | Qué se espera (a confirmar con la captura) |
|---|---|---|
| A. Fila del listado | `POST listado_pedidos.php?enviado=1` por número (ya lo hace `porNumero`) | Las columnas FC / FC / RECIBO / DEVOL: sin factura, el link de alta `modificar_facturasventa.php?pedido=N`; con factura, otro link, un número o un estado (¿"FAC"?; `pedidosDeListado` ya acepta FAC) |
| B. Comprobantes de la NP | Lo que llama `MostrarComprobantes('pedidos',N)` desde la NP abierta | La lista de comprobantes asociados (remitos, facturas, devoluciones, recibos). Si es una lectura, es la señal principal |
| C. La NP abierta | `modificar_pedidos.php?codigo=N` | ¿Desaparece `botgrabar` o quedan las cantidades de solo lectura cuando está facturada? |

- **Con factura** = cualquier señal lo dice. **Sin factura** = las tres se leyeron bien y ninguna lo dice. Cualquier
  otra cosa = **no se sabe** → revisar, no se toca.
- Qué cuenta como factura (factura de la NP, remitos de la NP facturados, recibo de pago adelantado): pregunta 1.
- Las funciones de lectura van en `lib/zomatik/ajuste.ts` (puras), con los fixtures reales de la captura.

## 6. Avisos (punto 8)

- **A Bautista** (`avisarErrorZomatik`, lo de hoy): ajuste en `error` (un mail por episodio, como Z1), robot caído
  (`avisarCaidaFila`), pendiente más de 1 hora (`avisarPendienteLargo`). `revisar` → `avisarGerenciales`, como hoy.
- **A Juan** (nuevo `avisarAjusteNp`, en `np-servidor.ts`, mismo `mandarAviso` con `AVISO_AJUSTE_NP = ["Juan Oreguy"]`;
  si no tiene mail en `app_users`, queda en Actividad "sin mail"):
  - se hizo una DEVOL (fase 2), o
  - la NP tenía factura (fase 1: "hacé la DEVOL a mano"), o
  - la NP era de proyecto (3.5), mientras no esté confirmado que el saldo vuelve solo.
  Un mail por ajuste (se marca `aviso_juan_at`). Asunto: "Devolución en Zomatik · Santa Rita · DP2 0001-…". Cuerpo:
  cliente, obra, NP, factura (si se leyó), m³ de la NP, despachados, devueltos, DP, link "Ver en Zomatik" (`linkNp`) y
  "Revisá si corresponde una nota de crédito".
- Todo queda en Actividad (entidad "Nota de pedido (Zomatik)"), con `Marca` y el recorte cuando no se entendió.

## 7. Capturas que faltan antes de programar (punto 7)

**Preparación (una vez):** Chrome, Zomatik, sucursal **REBUCRET**. `F12` → pestaña **Red** (Network) → tildar
**Conservar registro** (Preserve log). Al terminar cada captura: botón derecho en la lista de la pestaña Red →
**Guardar todo como HAR con contenido** → en Descargas, `zomatik-captura-1.har`, `-2`, etc. El HAR lleva la sesión
de Zomatik: **no lo mandes por WhatsApp ni mail**; queda en Descargas, lo leemos acá y después se borra.

**Nunca tocar** (en ninguna captura): Grabar, Continuar, Agregar artículo, el tacho, Autorizar, ni los links FC,
REMITO o RECIBO. Para ver adónde va un link: pasar el mouse y leer la dirección abajo a la izquierda, o botón derecho
→ Copiar dirección del enlace.

### 7.1 Captura 1 — el listado con y sin factura
1. Preguntale a Juan por **una NP facturada** (ideal, la de un cliente que paga por adelantado) y, si hay, **una con
   remitos facturados**.
2. Clientes › PEDIDOS: buscar por fechas que incluyan esas NP y una NP del sistema sin facturar.
3. Captura de pantalla de las filas, que se vean FC / FC / RECIBO / DEVOL y el estado.
4. Copiar la dirección de cada link FC, FC y RECIBO de cada fila (sin hacer clic) y pegarlas en un `.txt`.
5. Guardar el HAR.

### 7.2 Captura 2 — la NP con factura, abierta
1. Clic en el **número** de la NP facturada (abre `modificar_pedidos.php?codigo=N`: es lo mismo que mira el robot,
   no graba). Esperar que carguen los renglones.
2. Captura de pantalla entera: ¿está el botón Grabar? ¿la cantidad se puede escribir? (no escribir nada).
3. `Ctrl+U` (código fuente) → `Ctrl+F` "MostrarComprobantes" → copiar la función entera al `.txt`.
4. **Solo si** esa función llama a una dirección que empieza con `listado_`, `traer`, `_mostrar`, `mostrar` o
   `ver`: clic en "COMPROBANTES / OPERACIONES" y captura de lo que aparece. Si llama a algo con `grabar`, `manage`,
   `set_`, `borrar` o `anular`: **no** hacer clic, alcanza con el código.
5. Repetir 1 a 4 con una **NP sin factura con un remito parcial** (si no hay, una con remito total).
6. Guardar el HAR.

### 7.3 Captura 3 — DEVOL (formulario, sin grabar)
1. En el listado, clic en **DEVOL** de una NP con remito parcial (`listado_pedidosdevolucion.php?pedido=N`: es un
   listado). Captura.
2. Una de las **4 devoluciones del año** (en el listado de pedidos figuran como DEVPED): abrirla con clic en el número.
   Captura: número (¿DP 0001-…?), a qué NP apunta, cantidades, observaciones.
3. Volver al DEVOL del paso 1 y abrir el **alta** (`modificar_pedidosdevolucion.php?pedido=N`). Captura entera: qué
   trae precargado (cliente, DP o DP2, número, renglones con lo pendiente). **No** tocar Continuar, Agregar, Grabar ni
   el tacho.
4. `Ctrl+U` y guardar el código fuente en el `.txt` (ahí está la validación y cómo graba).
5. Si apenas carga el alta aparece en la pestaña Red un pedido `manage_…` o `traer…` (lo pide la página sola), anotar
   la dirección. No hay que tocar nada para eso.
6. Guardar el HAR.

### 7.4 Captura 4 — NP editada con un remito parcial (esto **sí** graba: es una prueba de Bautista, a mano)
No se puede ver sin grabar. Propuesta: prueba controlada con datos de prueba, que graba Bautista (como el 22/10), con
la pestaña Red abierta:
1. **NP de prueba** de OBRA PROPIA REBUCRET, Canning, 2 m³ de H21-620-10 C (CAN). Remito de **1 m³** contra esa NP.
2. Abrir la NP, cambiar la cantidad a **1,5** y Grabar. Guardar el HAR. Después: el listado (estado y total) y abrir
   REMITO desde la NP para ver qué pendiente precarga (**sin** grabar el remito).
3. En la misma NP, cambiar a **0,5** (menos que lo remitido) y Grabar: ver qué dice Zomatik (el robot tiene que
   reconocer ese "no").
4. **Otra NP de prueba** igual (2 m³, remito de 1): hacer la **DEVOL de 1 m³** a mano. HAR del Grabar, el listado de
   devoluciones y el pendiente de REMITO (sin grabar).
5. Si hay un proyecto que se pueda usar de prueba (pregunta 7): una NP de MATERIAL de 1 m³, bajarla a 0,5 y mirar el
   saldo del proyecto antes y después (listado de proyectos o el XLS del acopio).
6. Al terminar, Bautista vacía o anula a mano lo de prueba.

**Factura de prueba: no.** Las facturas son fiscales (AFIP): el camino "NP con factura" se prueba leyendo las
existentes (7.1 y 7.2) y la **primera DEVOL real se hace con Juan mirando** (fase 2).

Con esto se arman los fixtures de `lib/__fixtures__/zomatik-ajuste/` (marcados REAL o SUPUESTO en su `README.md`) y se
ajusta el robot antes de prender la llave.

## 8. Archivos

| Archivo | Qué | Patrón a copiar |
|---|---|---|
| `lib/zomatik/ajuste.ts` (nuevo, puro) | `planificarAjuste` (3.1–3.4), `marcaAjuste` ("Sistema Rebucret - pedido N - ajuste NP n", ASCII), `facturaDeNp` (señales A/B/C → `con` / `sin` / `no_se_sabe`), lectura del listado y del alta de DEVOL, `pendienteEsperado` | `z1.ts` (`planificarRemitos`, `marcaZ1`) y `np.ts` (`saldoNp`, `despachadoPorUso`, que se reusan, no se copian) |
| `lib/zomatik/np-robot.ts` | `leerNpParaAjuste`, `ajustarCantidadNp` (fase 1) y `devolverNp` (fase 2), con los helpers privados que ya están (`abrir`, `detalleGrabado`, `manage`, `cuerpoGrabar`, `listado`, `rechazo`) | `vaciarNp` (mismo esqueleto: abrir, marca, detalle, grabar sobre N, verificar) |
| `lib/zomatik/ajuste-servidor.ts` (nuevo) | `prepararAjustes`, `trabajarAjuste` (estados, pasos, aplicar, avisos), `estadoAjustes` | `z1-servidor.ts` (`prepararRemitos`, `terminar`, `guardarSi`, `alPaso`) |
| `lib/zomatik/z1-servidor.ts` | Llave del ajuste en `configZ1`; en `procesarZ1`, los ajustes del pedido antes de sus remitos y el **gate** (4.4); `pendienteEsperado` al llamar a `generarRemito`; `prepararAjustes` en `pasadaZ1`; `estadoRemitos` suma el estado del ajuste | — |
| `lib/zomatik/z1-robot.ts` | `DatosRemito.pendienteEsperado` y el control antes de grabar | El control de `it.pendiente` que ya existe |
| `lib/zomatik/web.ts` | Grupo nuevo `rutaEscrituraAjuste(path, metodo, codigoNp)` (8.1) | `rutaEscrituraNp` / `rutaEscrituraZ1` |
| `lib/zomatik/cliente.ts` | `navegadorAjuste(llave, codigoNp)`: el grupo nuevo, atado a **una** NP | `navegadorZ1` |
| `lib/zomatik/np-servidor.ts` | `AVISO_AJUSTE_NP`, `avisarAjusteNp`; NP adicional por exceso para un pedido completo (con `zomatik_np_crear_con_uso`) | `avisarErrorZomatik` |
| `app/api/zomatik/remito/route.ts` | POST "remitir": `prepararAjustes` después de `prepararRemitos`. Acción nueva `remitir_sin_ajustar` (gerencial, con motivo). GET: el estado del ajuste junto al de los remitos | Lo mismo de la ruta |
| `app/api/zomatik/np/procesar/route.ts` | Nada nuevo: los ajustes van dentro de `procesarZ1` | — |
| `lib/zomatik/z1-cliente.ts` | `RemitoEstado` suma el ajuste; `chipRemito` con los textos de 9; `remitirSinAjustar` | `remitirPedido` |
| `components/despacho/finalizar-dialog.tsx` | Una línea con el ajuste (texto en 9), solo con la llave prendida | — |
| `components/despacho/despacho-tablero.tsx` | Toast de finalizar y menú "Remitir sin ajustar la NP" (gerenciales) | `remitirAhora` y el menú "Remitir en Zomatik" |
| `supabase/migrations/20261106xxxx_zomatik_np_ajuste.sql` (nueva, **sin aplicar**) | Sección 10 | `202610291000_zomatik_z1_remitos.sql` |
| `lib/__tests__/zomatik-ajuste.test.mjs` + `lib/__fixtures__/zomatik-ajuste/` | Sección 11; script `test:zomatik-ajuste` en `package.json` | `zomatik-z1.test.mjs`, `zomatik-np-servidor.test.mjs` |

### 8.1 Rutas nuevas, explícitas (punto 6)

Grupo `rutaEscrituraAjuste`, **solo** con `escrituraAjuste: true` en `navegadorAjuste`, que lo arma
`ajuste-servidor.ts` después de leer la llave. El navegador está atado a la NP del ajuste: cualquier `codigo` o
`pedido` distinto de N se rechaza antes de salir.

| Método | Ruta | Para qué | Fase |
|---|---|---|---|
| GET | `modificar_pedidos.php?codigo=N` | Abrir la NP (marca, señal C, `pedidos_unico`) | 1 |
| GET | `manage_pedidos.php?…` con `pedidos=N` y `pedidos_unico=…`, **sin** `fborrar`, `faccion`, `fitems`, `fautorizar` ni `farticulo` | Cargar el detalle grabado (como la página) | 1 |
| POST | `grabar_pedidos.php?codigo=N` (N > 0; **nunca** `codigo=0`) | Grabar la cantidad nueva | 1 |
| GET / POST | `listado_pedidos.php` / `?enviado=1` | Fila de la NP (señal A), total, verificación | 1 (ya es lectura) |
| GET | La URL de `MostrarComprobantes` con `N` (forma exacta tras la captura 2) | Señal B. Solo si es lectura | 1 |
| GET | `listado_pedidosdevolucion.php?pedido=N` | Devoluciones de la NP (verificar, buscar la marca) | 1 (lectura) |
| GET | `modificar_pedidosdevolucion.php?pedido=N` | Alta de DEVOL | 2 |
| GET | El `manage_…` de la DEVOL que dispare el alta (forma exacta tras la captura 3) | Renglones de la DEVOL | 2 |
| GET | `_getnumerofactura.php?fcomprobante=<DP|DP2>` (si la DEVOL lo usa) | Número | 2 |
| POST | `grabar_pedidosdevolucion.php?codigo=0` (nombre exacto tras la captura 3) | Grabar la DEVOL (solo alta) | 2 |
| GET | `exportar_acopio.php?acopio=N` + su `output/…xlsx` | Saldo del proyecto (3.5), si hace falta | 1 (ya es lectura) |

Siguen prohibidos en este grupo: `fborrar`, `faccion`, `fitems`, `fautorizar`, `borrar`, `eliminar`, `anular`,
`set_*`, `modificar_liberarcomprobante`, `modificar_facturasventa`, `modificar_recibos`, `modificar_remitos` (el
remito va por Z1). El vaciado (3.4) usa el grupo de la NP de siempre, sin cambios.

## 9. Textos de pantalla

- **Finalizar** (solo con la llave): "Al remitir, la NP2 0001-00002090 baja de 60 a 40 m³." Sin datos de la NP:
  "Al remitir, la NP se ajusta a lo despachado."
- **Toast al finalizar:** "Ajustando la NP y haciendo la OF y el remito…" / "En unos segundos aparece en el pedido."
- **Chip del pedido** (`chipRemito`): "Ajustando NP…" · "NP: revisar ajuste" · "Remito esperando la NP" · al
  terminar, lo de hoy ("RM2 …2760 ✓"), con "NP 60 → 40 m³" o "DP2 0001-… 20 m³" en el detalle.
- **Mensajes del ajuste:**
  - "La NP cambió en Zomatik (tiene 55 m³ y el sistema esperaba 60). No se tocó: revisala."
  - "No se pudo saber si la NP tiene factura. No se tocó: revisala."
  - "La NP tiene factura: hacé la devolución de 20 m³ a mano y tocá «Ya la hice»." (fase 1)
  - "Zomatik no dejó cambiar la NP: <texto de Zomatik>."
  - (decisión 16) "La NP2 0001-… tiene el saldo para devolver en «NP con saldo». No se tocó: revisala." / "La NP2 0001-…
    ya está cerrada en «NP con saldo». No se tocó: revisala."
- **Menú (gerenciales):** "Remitir sin ajustar la NP" → "¿Ya ajustaste la NP a mano en Zomatik?" + motivo →
  "Sí, remitir". En la fase 1, "Ya hice la devolución" usa el mismo diálogo.

## 10. Base de datos

Migración nueva `supabase/migrations/20261106xxxx_zomatik_np_ajuste.sql`, **sin aplicar**, para correr **fuera de
horario** (candados cortos sobre `zomatik_np_config` y `zomatik_np`), probada antes en `BEGIN … ROLLBACK`. Avisar a
Bautista antes de aplicarla.

| Cambio | Detalle |
|---|---|
| `zomatik_np_config` | `ajustar_activo boolean NOT NULL DEFAULT false` (llave propia, requiere la NP y la de remitir prendidas) y `ajustar_desde timestamptz` |
| `zomatik_np` | `m3_original numeric(10,3)`: los m³ con que se creó. `m3` pasa a ser **lo vigente en Zomatik** (después de editar o de la DEVOL), así el saldo sigue saliendo de la misma cuenta en todos lados |
| `zomatik_np_ajustes` (nueva) | `id`, `np_id`, `scheduled_dispatch_id`, `plant_id`, `marca` UNIQUE, UNIQUE (`np_id`, `scheduled_dispatch_id`), `tipo` (`editar`/`devol`/`vaciar`/`adicional`/`nada`), `m3_np` (leído), `m3_objetivo`, `m3_despachado`, `m3_devuelto`, `con_factura` (bool nulo), `factura_texto`, `devol_numero`, `devol_codigo`, `estado` (`pendiente`/`generando`/`ok`/`nada`/`revisar`/`error`/`a_mano`/`anulado`), `paso`, `mensaje`, `intentos`, `proximo_intento`, `en_curso_desde`, `aplicado_at`, `aviso_juan_at`, `resuelto_por`, `resuelto_motivo`, `created_by`, `created_at`, `updated_at`, `ok_at`. Solo servidor: `REVOKE ALL` a anon y authenticated, `GRANT ALL` a service_role (el navegador lo lee por la API) |
| `zomatik_ajuste_tomar(p_id, p_desde)` | Toma una fila en una sentencia (copia de `zomatik_remito_tomar`) |
| `zomatik_ajuste_aplicar(p_id)` | Con la NP `FOR UPDATE`: `zomatik_np.m3`, `uso.m3 = desp_u`, `saldo_decision`/`saldo_mensaje`, `aplicado_at`. Idempotente (si ya tiene `aplicado_at`, no hace nada) |
| `zomatik_remitos` | **Sin cambios** (el gate usa `paso = 'esperando_ajuste'` con los estados que ya existen) |

**Qué pasa con los datos ya cargados:**
- `zomatik_np`: `m3_original = m3` para todas las filas (copia; `m3` no cambia).
- `zomatik_np_config`: la llave nueva nace **apagada** en Canning y Hudson. Con la llave apagada, Finalizar, remitir,
  el saldo y "NP con saldo" quedan **exactamente como hoy**.
- `zomatik_np_uso`, `zomatik_remitos`, `zomatik_remito_despachos`, `zomatik_np_pedido`, `dispatches` y
  `scheduled_dispatches`: no se tocan.
- Los pedidos ya finalizados antes de prender la llave **no se ajustan solos**: sus NP siguen en "NP con saldo" con
  Devolver a mano, como hoy.
- No hay columna `plant` / `planta` en estas tablas: la planta va por `plant_id` (uuid), como en el resto de Zomatik.

## 11. Pruebas (punto 9)

`npm run test:zomatik-ajuste` (`node --experimental-strip-types --test`, con el alias de siempre), más las de
siempre sin cambios (`test:zomatik-np`, `test:zomatik-z1`, `test:zomatik`), `tsc` sin errores nuevos y build bien.

- **Plan** (`ajuste.ts`): los 8 casos de 3.2; `cant_x ≠ zomatik_np.m3` → revisar; piso no da → revisar; remitos ≠
  `desp_u` → revisar; despachos de antes de `remitir_desde` → revisar; pedido reabierto → anulado.
- **Factura** (con los fixtures reales de 7.1/7.2): con, sin, y "no se sabe" (una señal ilegible).
- **Robot** (navegador simulado, como `zomatik-np.test.mjs`): editar ok; Zomatik dice que no (fixture de 7.4.3) →
  error; corte en `grabar_np` con la NP ya en `obj` → ok sin grabar de nuevo; con la cantidad vieja → edita; con otra
  → revisar; sin marca → revisar sin tocar; (fase 2) DEVOL ok; corte en `grabar_devol` con la DP en el listado → ok;
  sin la DP → una sola DEVOL más; listado dudoso → revisar.
- **Lista cerrada:** `rutaEscrituraAjuste` acepta exactamente lo de 8.1 y rechaza `fborrar`, `codigo=0`, otro código,
  `farticulo`, `faccion` y cualquier `grabar_` que no esté.
- **Servidor** (base simulada, como `zomatik-np-servidor.test.mjs`): llave apagada → sin ajustes y el remito sale como
  hoy; el remito espera con el ajuste pendiente, revisar o error y sale con ok, nada o a_mano; `pendienteEsperado`
  distinto → revisar sin grabar el remito; mail a Juan una sola vez con DEVOL o factura; mail a Bautista una vez por
  episodio de error; `prepararAjustes` dos veces no duplica; exceso agrandado → `prepararRemitos` arma el despacho que
  había quedado afuera.

## 12. Criterios de aceptación (ejemplo de Santa Rita)

Pedido de Santa Rita en Canning, H21, NP2 0001-0000XXXX de **60 m³** generada por el sistema y autorizada; se
despacharon **40 m³** (cinco camiones de 8) y se finalizó. Llave del ajuste prendida en Canning.

1. **Sin factura:** al tocar "Finalizar pedido", el chip dice "Ajustando NP…" y en menos de un minuto la NP2 en
   Zomatik tiene **un** renglón de **40 m³** y el total baja en proporción; después sale la OF de 40 m³ y el RM2 de
   40 m³. En Zomatik la NP2 queda sin pendiente (estado REM). En nuestra base: `zomatik_np.m3 = 40`,
   `m3_original = 60`, el uso en 40, el ajuste "ok" tipo `editar`, y la NP **no** aparece en "NP con saldo".
2. **Orden:** en Actividad, el ajuste ("NP 60 → 40 m³") está **antes** que la OF y el remito. Si el ajuste falla, no
   hay OF ni remito nuevos de ese pedido.
3. **Con factura (fase 1):** la NP2 no se toca; el pedido muestra "La NP tiene factura: hacé la devolución de 20 m³ a
   mano"; a Juan le llega **un** mail; el remito espera hasta "Ya hice la devolución" y entonces sale el RM2 de 40.
   **(fase 2):** sale la DP2 por **20 m³** con la marca, después la OF y el RM2 de 40; mail a Juan con la DP2.
4. **Varios días** (25 el lunes, ya remitidos, y 15 el martes): la NP queda en 40 aunque ya tenía un remito de 25, y
   el remito del martes es de 15.
5. **NP compartida** (otro pedido activo reserva 20 de la misma NP): la NP queda en 50, nunca menos.
6. **Corte de red al grabar la NP:** la próxima pasada relee la NP; si ya está en 40, no vuelve a grabar; nunca quedan
   dos DEVOL para el mismo pedido.
7. **Exceso** (se despacharon 40,4 contra una NP de 40 sin factura): la NP queda en 40,4 y el remito sale por 40,4
   (hoy frena con "generá una NP adicional").
8. **Llave apagada:** Finalizar y "Remitir en Zomatik" hacen exactamente lo de hoy; ninguna ruta del grupo nuevo se
   puede pedir (la lista cerrada la rechaza antes de salir).
9. **No se rompe:** las pruebas de siempre pasan, `tsc` sin errores nuevos, y un pedido que se completa justo (60 de
   60) no abre Zomatik para ajustar (ajuste "nada").

## 13. Fuera de alcance

- Cancelar un pedido con despachos y "Devolver el saldo" de "NP con saldo": siguen con la DEVOL a mano. Cuando la
  fase 2 ande, se pasan al mismo robot (otro pedido).
- La "Anulación Material Proyecto" (84/85): no la hace el sistema.
- Notas de crédito o cualquier cosa de facturación: el sistema no factura.
- "Liberar comprobante": no se usa.
- Despachos manuales sin pedido (no tienen NP).
- Ajustar NP cargadas a mano en Zomatik (sin nuestra marca): nunca se tocan.
- Cambiar la decisión 20.1.5 (NP adicional al agrandar el pedido antes de despachar).

## 14. Preguntas para Bautista (con recomendación)

1. **¿Qué cuenta como "tiene factura"?** (a) factura hecha desde la NP (FC del listado); (b) remitos de esa NP ya
   facturados; (c) un recibo de pago adelantado contra la NP.
   **Recomendación:** las tres → DEVOL y mail a Juan. Es lo conservador: si algo se cobró o facturó contra la NP, no
   se edita y queda el rastro.
2. **Se despachó más de lo que dice la NP:** ¿agrandar la NP o NP adicional?
   **Recomendación:** agrandar si no tiene factura (mismo paso, un remito); NP adicional si tiene factura o si el
   proyecto no alcanza (3.3).
3. **NP con saldo usada por un pedido nuevo ("Usar NP con saldo"):** al finalizar, ¿se devuelve solo lo que ese pedido
   tomó y no usó, o todo el saldo libre de la NP?
   **Recomendación:** solo lo de ese pedido. El resto sigue en "NP con saldo" para que alguien decida (respeta "que
   quede pendiente" del 23/10).
4. **Si el ajuste se traba (revisar o error), ¿el remito espera?**
   **Recomendación:** sí, espera, con mail; y un gerencial puede "Remitir sin ajustar la NP" con motivo después de
   arreglarla a mano. Nunca sale el remito contra una NP que el sistema no pudo confirmar.
5. **NP que queda en 0 sin remitos ni factura** (adicional sin usar): ¿vaciar (lo aprobado el 28/10) o DEVOL por todo?
   **Recomendación:** vaciar. Es el único caso que saca un renglón; no borra la NP.
6. **Mail de DEVOL / factura:** ¿solo Juan, o también Fernando o quien programó?
   **Recomendación:** solo Juan por ahora (es quien hace la nota de crédito); sumar más es una línea.
7. **NP de proyecto:** ¿hay un proyecto que se pueda usar de prueba para 7.4.5? Si no vuelve el saldo solo, ¿lo
   resuelve Juan a mano?
   **Recomendación:** primer caso real con Juan mirando; hasta confirmar que el saldo vuelve, mail a Juan en cada
   ajuste de proyecto. El sistema no hace la anulación de material.
8. **Orden de las fases:** ¿arrancamos la fase 1 (editar, con la DEVOL a mano) apenas estén las capturas 1, 2 y 4, sin
   esperar la DEVOL automática?
   **Recomendación:** sí. Cubre el caso común (sin factura) y deja la DEVOL para cuando la veamos andar con Juan.

## 15. Decisiones de Bautista (06/11/2026) — mandan sobre todo lo anterior

1. **"Tiene factura" = Zomatik no deja editar la NP.** Si la NP tiene una factura asociada, Zomatik bloquea la edición.
   La señal principal es la C (la NP abierta: sin `botgrabar`, cantidades de solo lectura, o el Grabar contesta un
   rechazo). A y B se leen si están, pero **no** hacen falta para decidir "sin factura": si la NP abre editable, con
   marca y un renglón, se edita. Si el Grabar contesta un rechazo que habla de factura/comprobante → se trata como
   "con factura" (no se reintenta). Cualquier otra cosa rara → **revisar**, no se toca.
2. **Exceso:** se **agranda la NP** (sin factura). Con factura (no deja editar) → NP adicional por el exceso (3.3).
3. ~~**"Usar NP con saldo":** se ajusta **solo lo que tomó ese pedido**. El resto del saldo sigue en "NP con saldo".~~
   **Reemplazada por la decisión 16 (13/11).**
4. **Ajuste trabado:** el remito **espera** y **le llega un mail a Bautista** (`avisarErrorZomatik`, uno por
   episodio, para `revisar` y `error` del ajuste). Escape gerencial "Remitir sin ajustar la NP" con motivo, como 2.2.7.
5. **NP que queda en 0 sin remitos ni factura:** **el robot no la vacía ni la borra.** Queda pendiente para una
   persona: el ajuste nace `revisar` con el mensaje "La NP N quedó sin uso (0 m³): eliminala o dejala pendiente en
   Zomatik" + mail a Bautista, y la NP sigue en "NP con saldo" (la decide una persona: "Ya la eliminé" / dejarla).
   El remito de ese pedido no depende de esa NP (no tiene despachos), así que no espera por ella.
   Reemplaza 3.4 y el paso 4c.
6. **Mail de "la NP tenía factura" / DEVOL:** solo a **Juan** (`AVISO_AJUSTE_NP = ["Juan Oreguy"]`).
7. **NP de proyecto:** **sin** supervisión de Juan ni mail especial. Se ajusta como cualquier NP (editar o, si no
   deja, con factura). Se saca el mail de 3.5 y la tercera viñeta de 6 ("la NP era de proyecto"). La captura 7.4.5 no
   hace falta.
8. **Orden:** fase 1 ya (editar + "con factura → DEVOL a mano" + mail a Juan). La DEVOL automática (fase 2) después.
   La fase 1 se programa ahora con fixtures **SUPUESTO** para la NP facturada y se corrige con las capturas 2 y 4
   antes de prender la llave. La captura 1 queda opcional (por la decisión 1).

## 16. Decisión de Bautista (13/11/2026) — reemplaza a la 15.3 y a la cuenta de 3.1

**Cuando un pedido termina, cada NP que usa baja también el saldo libre** (lo que no reserva ningún uso). El libre se
baja igual aunque otro pedido activo use la NP: lo que ese pedido reserva no se toca. Caso real: A.A. Arquitectura,
NP2 0001-00002114 de 6 m³; el pedido se editó a 4 antes de despachar (uso 4) y se despacharon 4. Con la 15.3 la NP
quedaba en 6 con 2 de saldo; ahora baja a 4.

- **La cuenta** (`planificarAjuste` y `comprometidoOtros`, `ajuste.ts`): `obj_x = lo comprometido por los otros usos de
  x + lo despachado por este pedido contra x` (también la foto de un uso suyo que se desvinculó). Lo comprometido por
  los otros usos es la cuenta del saldo con una diferencia:
  - uso activo de un pedido activo: lo que reserva (o lo despachado, si es más);
  - uso de un pedido **cerrado** (completo o cancelado): **lo despachado contra la NP**, aunque pase lo que reservó
    (`saldoNp` toma el menor de los dos y la NP quedaría por debajo de lo despachado). Ej.: NP 70, el pedido B cerrado
    reservó 20 y despachó 25, este reservó 40 y despachó 30 → **55**;
  - uso desactivado o de un pedido borrado: su foto (`despachado_fijo`).
- **Sin otro pedido activo:** queda en lo despachado por todos. `zomatik_ajuste_aplicar` la deja
  `saldo_decision = 'cerrada'` (firma "Sistema") y no aparece en "NP con saldo" (la función SQL no cambia). **Con otro
  pedido activo:** queda abierta y la cierra el ajuste del último pedido que la use.
- **Agrandar** solo por lo que este pedido despachó de más sobre lo que reservó (3.3). Si la cuenta pide más que eso, la
  NP está reservada de más o la tocaron: **revisar**, no se toca ("La NP … tiene X m³ despachados o reservados y es de
  Y m³. No se tocó: revisala."). Ya no se controla contra "sacar solo lo de este pedido": el ajuste de otro pedido de
  la misma NP pudo haber bajado ya el sobrante de este.
- **NP con una decisión de "NP con saldo"** (`devolver`, la DEVOL del saldo a mano en curso, o `cerrada` por una
  persona): **no se toca**. El ajuste nace **revisar** ("La NP … tiene el saldo para devolver / ya está cerrada en «NP
  con saldo». No se tocó: revisala.") y lo resuelve una persona con «Remitir sin ajustar la NP». La NP que cerró el
  ajuste de **otro** pedido de la misma NP (firma "Sistema") no frena: el ajuste sigue y da "nada" si ya está en lo
  justo. Una NP que se está vaciando (`vaciar` / `vaciando`) no está "ok": no se arma ajuste para ella (como antes).
- **Carrera con "NP con saldo"** (sin cambios en SQL), para no bajar dos veces el mismo saldo:
  - una NP con un ajuste en `pendiente`, `generando` o `revisar` **no aparece** en «NP con saldo», salvo la que ya está
    "para devolver" (falta «Ya la devolví») y la que quedó sin uso (15.5, `np_sin_uso`: la decide una persona desde ahí);
  - "Devolver el saldo" y "Usar NP con saldo" (la reserva) se rechazan con "La NP se está ajustando a lo despachado:
    esperá unos minutos.";
  - el robot vuelve a leer `saldo_decision` antes de armar el plan, antes de `aplicar` y antes de reintentar después
    de un corte; si cambió, el ajuste pasa a **revisar** ("Mientras se ajustaba la NP …, se pidió devolver su saldo / se
    cerró en «NP con saldo». Revisá la NP en Zomatik antes de seguir.").
- **Casos de 3.2 que cambian:** "Usar NP con saldo" (100 / 30 / 20, nadie más la usa) → **edita 100 → 20** y la NP
  queda cerrada (antes 90, con 70 en "NP con saldo"). Si el pedido cancelado había despachado 15 contra ella → 35.
  "NP compartida" con 10 libres (NP 70, este reservó 40 y despachó 30, otro activo reserva 20) → **50** (antes 60).
  Los demás casos de 3.2 dan lo mismo. Si la NP queda en 0 (un pedido que no despachó nada contra ella), sigue la 15.5.
- **Finalizar** (`textoFinalizar`): mismo texto ("baja de 6 a 4 m³"), con la cuenta nueva a partir del libre que ya
  muestra la pantalla; con una decisión de "NP con saldo", el texto general.
- **Base de datos:** sin cambios. Se leen `zomatik_np.saldo_decision` / `saldo_decision_por` y `zomatik_np_ajustes`.
  Queda una diferencia con la base: `zomatik_np_saldo` (SQL) cuenta el menor entre lo reservado y lo despachado de un
  pedido cerrado. En el caso de B (reservó 20, despachó 25, sin ajuste propio), después del ajuste la base ve 5 m³
  libres y la NP no se cierra sola. Arreglarlo es cambiar la función SQL (a decidir aparte).
- **Pruebas** (`zomatik-ajuste.test.mjs` y `zomatik-np-servidor.test.mjs`): A.A. Arquitectura (plan, Finalizar y
  servidor: 6 → 4 y cerrada), NP compartida con otro pedido activo (baja el libre, no se cierra), pedido cerrado que
  despachó de más (55), "Usar NP con saldo" (100 → 20), NP con decisión tomada (revisar; la cerrada por "Sistema" no
  frena), decisión con el ajuste en marcha (antes de aplicar y después de un corte) y «NP con saldo» con un ajuste en
  marcha (oculta, no se devuelve ni se reserva).
