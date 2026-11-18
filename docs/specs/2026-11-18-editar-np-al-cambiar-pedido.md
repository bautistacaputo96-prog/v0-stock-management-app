# Editar la NP cuando el pedido cambia de m³ (antes de terminar)

Estado: **propuesta del arquitecto, 18/11/2026. Falta que Bautista conteste la sección 12.** Rama
`feat/np-editar-al-cambiar-pedido`. Cuando se apruebe, manda sobre `docs/migracion-loop/zomatik.md` 24.1.2, 24.5.6 y
25.2 ("Agrandar" / "Achicar"), y sobre la última frase de 3.3 de `docs/specs/2026-11-06-ajustar-np-al-finalizar.md`
("la decisión 20.1.5 sigue para cuando se agranda el pedido antes de despachar"). El resto de las secciones 24 a 28
sigue igual.

Pedido de Bautista (18/11): "La idea es que él pueda editar el pedido de 8, pasarlo a 9, y que la NP se edite."
Caso real: La Tercera, Cordones. Titan lo programó el 16/11 por 8 m³ (NP 0001-00001194). Hoy lo pasó a 9 y el robot
hizo la adicional 0001-00001197 por 1 m³. Resultado: dos NP, y un camión con m³ de las dos sale en dos remitos.

---

## 0. Qué hay hoy (relevado en el código de `main`)

| Pieza | Dónde | Qué hace | Qué se reusa |
|---|---|---|---|
| Plan de la NP | `planificarNp` (`lib/zomatik/np.ts`) | Crece: primero lo libre de sus NP (`ajustar`), después la NP con saldo elegida, y el resto **NP adicional** (`crear`, `es_adicional`). Achica: baja la reserva (`ajustar`) y lo que sobra queda de saldo | Se le suma una salida `editar` |
| Sincronizar | `sincronizarPedido` (`np-servidor.ts`) | Aplica el plan en la base: `zomatik_np_reservar` (con la NP bloqueada), `zomatik_np_crear_con_uso`. Corre al guardar el pedido (Programación y "Editar total" de Despacho) y en la pasada de cada 10 min (`pasadaNp`) | Es el único lugar que decide qué necesita el pedido |
| Editar la cantidad en Zomatik | `ajustarCantidadNp` (`np-robot.ts`) | Lee la NP (marca, un renglón, cantidad = la de la base), mira la factura (`facturaDeNp`: sin `botgrabar` = con factura, REAL 06/11), pone la cantidad con `conCantidad` (el `costo<id>` no se toca), graba en `grabar_pedidos.php?codigo=N`, verifica (un renglón, cantidad nueva, total en proporción). Reintento seguro: la cantidad es absoluta y un corte relee primero | **Tal cual**. Es el único camino de grabar |
| Navegador | `navegadorAjuste(llave, codigoNp)` (`cliente.ts`) + `rutaEscrituraAjuste` (`web.ts`) | Lista cerrada atada a UNA NP: abrir, detalle, `_comprobantes`, listado, `grabar_pedidos.php?codigo=N`. Nada de `fborrar`, `faccion`, `fautorizar`, `farticulo`, `set_*`, `borrar_*`, `generar_*`, `remitir_*` | **Tal cual**, sin rutas nuevas |
| Tabla | `zomatik_np_ajustes` (migración `202611061200`) | Una fila por pedido y NP (`UNIQUE (np_id, scheduled_dispatch_id)`), estados `pendiente/generando/ok/nada/revisar/error/a_mano/anulado`, `paso`, `intentos`, `proximo_intento`, `con_factura`, `aviso_juan_at` | Se le suma `origen` (sección 4) |
| Tomar y aplicar | `zomatik_ajuste_tomar`, `zomatik_ajuste_aplicar` | Toma la fila en una sentencia; aplica en la base con la NP bloqueada (NP = objetivo, uso = **lo despachado**, cierra el saldo si no queda libre) | `tomar` tal cual; `aplicar` no sirve (el uso de una edición es la reserva, no lo despachado, y no cierra el saldo): función nueva hermana |
| Saldo y "NP con saldo" | `npsAjustandose` | Una NP con una fila de `zomatik_np_ajustes` en curso no se muestra ni se reserva en "NP con saldo" | **Gratis**: mira todas las filas de la NP, también las nuevas |
| Remitos | `planificarRemitos` (`z1.ts`) | Lugar de cada NP = **reserva del pedido** (`zomatik_np_uso.m3`) − lo ya remitido. Un despacho que no entra en ninguna NP se parte (16/11) o queda como problema | Sin cambios: con la reserva en 9 entra el camión entero |

**Conclusión:** no hace falta nada paralelo. Es el mismo robot del ajuste con otro origen: el ajuste deja la NP en lo
despachado **al terminar**; la edición la deja en lo que el pedido **necesita ahora**. Las dos escriben en la misma
tabla, así "¿esta NP se está cambiando?" se contesta en un solo lugar.

## 1. Objetivo

Que cambiar los m³ de un pedido antes de terminarlo **edite la cantidad de su NP en Zomatik** (8 → 9, o 9 → 6) en vez de
generar una NP adicional. Una NP por pedido, un remito por camión. Si la NP no se puede editar (factura, la hizo una
persona, es de un proyecto o la comparte otro pedido), sigue lo de hoy.

## 2. Alcance

### 2.1 Qué se hace
1. **Crece** (8 → 9): la NP editable del pedido pasa a 9 en Zomatik; la reserva del pedido, a 9. Sin NP adicional.
2. **Achica** (9 → 6): la NP editable baja a 6, nunca por debajo de lo despachado ni de lo remitido. Ya no queda saldo
   libre esperando el final.
3. **Varios cambios seguidos** (8 → 9 → 10): una sola edición, a 10 (espera de 2 min y el robot recalcula antes de
   grabar).
4. **En curso**: el pedido muestra "NP: actualizando a 9 m³" hasta que Zomatik lo confirma.
5. **No se puede editar** (factura, Zomatik dice que no): crece → NP adicional como hoy; achica → no se toca y lo
   resuelve el ajuste al finalizar (DEVOL a mano + mail a Juan, lo de siempre).
6. **Llave propia por planta** (`editar_activo`), apagada al aplicar la migración. Apagada, todo como hoy.

### 2.2 Fuera de alcance
- Juntar las NP de pedidos que ya tienen adicional (Cordones con 1194 + 1197): **no se migran**. Si Cordones cambia de
  nuevo, se edita la última NP editable (la 1197, sección 3.3).
- Editar NP traídas de Zomatik ("Traida de Zomatik - …" / "A mano - …"): nunca. Siguen con adicional.
- Editar NP de proyecto (sección 3.1; decisión 12.3).
- Cambiar fórmula, cliente o planta: sigue la regla de hoy (la NP vieja queda con saldo, NP nueva).
- Vaciar o dejar en 0 una NP: la edición nunca pone 0 (sigue 15.5 del ajuste).
- DEVOL automática, notas de crédito, "Anulación Material Proyecto".
- El ajuste al finalizar: no cambia su cuenta ni sus avisos. Solo aprende a esperar una edición en curso (6.1).
- Cambiar la fecha en Zomatik (25.5: no hace falta).

## 3. Reglas

### 3.1 NP editable

Una NP que usa el pedido P se puede editar si **todo** esto se cumple (lo calcula el servidor, `npEditable`):

| Condición | Por qué |
|---|---|
| Llave `editar_activo` prendida en la planta del pedido | Se prende planta por planta |
| `tipo = 'nueva'` y la marca es del sistema (`!esNpTraida(marca)`) | La traída la hizo una persona y puede estar facturada |
| `estado = 'ok'`, `zomatik_codigo` y `sucursal = '18'`; `paso` distinto de `autorizar_revisar` | Tiene que estar en Zomatik y ser nuestra. Si está `generando`, la edición **espera** (no se la da por no editable) |
| Sin `saldo_decision` (`devolver` o `cerrada`) | Ya decidió una persona |
| Ningún **otro pedido activo** con un uso activo de esa NP | Lo que reserva otro pedido no se toca (como hoy) |
| Ninguna fila de esa NP con `con_factura = true` (de cualquier origen) ni una edición terminada como "no se pudo" (`nada`/`a_mano` con tipo `adicional`/`devol`) | Ya se sabe que no deja. No se vuelve a probar en cada cambio |

**NP de proyecto: no se edita** (recomendación, decisión 12.3). Agrandarla consume saldo del proyecto que el sistema
solo conoce aproximado (el "≈"), y no sabemos qué contesta Zomatik si no alcanza ni si achicarla devuelve el saldo
(3.5 del ajuste). Queda como hoy: proyecto con tope → el resto va en la NP nueva (que **sí** es editable); proyecto sin
tope → adicional de proyecto. Al terminar, el ajuste la deja justa (15.7, ya decidido).

### 3.2 Cuánto

Dos números, que se aplican juntos en la base (nunca uno sin el otro):

- **Reserva nueva del pedido en la NP** (`m3_uso_objetivo`): la decide `planificarNp`, con los m³ del pedido.
- **Cantidad nueva de la NP** (`m3_objetivo`, `objetivoEdicion` en `ajuste.ts`):
  `obj = comprometidoOtros(x, usos de los otros pedidos) + max(reserva nueva, lo despachado de P contra x)`.
  Es la misma cuenta del ajuste al finalizar (decisión 16) con la reserva en lugar de lo despachado: la NP queda sin
  libre. Lo despachado contra x sale de `despachadoPorUso` con la reserva nueva.
- **Pisos** (si no se cumplen: `revisar`, no se toca): `obj > 0` y `obj ≥ Σ zomatik_remitos.m3` de la NP (todos los
  pedidos, remito `ok` o cortado en Grabar, como `remitidoContra`).
- El `costo` del renglón **no se toca** (`conCantidad`). El total de la NP cambia en proporción (lo controla
  `totalProporcional`).

### 3.3 Pedido con varias NP: cuál se edita

- **Crece:** primero lo libre de sus NP (como hoy), después la NP con saldo elegida (como hoy), y el resto **a la
  última NP editable en el orden de los usos**. Si no hay ninguna editable: NP adicional (como hoy).
  - Por qué la última: es la que se está consumiendo (los despachos llenan las NP en orden) y evita editar una NP
    vieja ya remitida entera.
  - Ejemplos: "Traer NP de Zomatik" 5 + NP nueva 3, crece a 10 → la nueva pasa a 5. Proyecto con tope 20 + nueva 5,
    crece → la nueva. Cordones (1194 por 8 + 1197 por 1), crece a 10 → la 1197 pasa a 2.
- **Achica:** de la última NP para atrás (como hoy). En cada una: si es editable y la reserva nueva es mayor a 0, se
  edita; si no, solo baja la reserva y lo que sobra queda de saldo (como hoy). Una NP editable que quedaría en 0 se
  trata como no editable (reserva 0, saldo; al terminar, 15.5).
- En una NP editable, `planificarNp` **ya no** baja la reserva con `ajustar` al achicar: la reserva y la NP bajan
  juntas cuando Zomatik confirma (así una pasada sin cambios nunca anula una edición pendiente).

### 3.4 Casos

| Caso | NP (Zomatik) | Pedido | Remitido | Qué pasa |
|---|---|---|---|---|
| **Cordones nuevo** | 8 | 8 → 9 | 0 | NP 8 → 9, reserva 9. Sin adicional |
| Crece con remitos | 8 | 8 → 10 | 5 | NP 8 → 10 (≥ 5). El remito del día siguiente sale contra la misma NP |
| Achica | 9 | 9 → 6 | 0 | NP 9 → 6, reserva 6 |
| Achica con despachos | 9 | 9 → 6 | 7 despachados | NP 9 → 7 (nunca menos de lo despachado) |
| 8 → 9 → 10 en 1 minuto | 8 | 10 | 0 | Una edición, 8 → 10 |
| 8 → 9 → 8 antes de que la tome el robot | 8 | 8 | 0 | La edición se anula. Zomatik no se abre |
| Con factura, crece | 8 (F) | 8 → 9 | — | No se toca; NP adicional por 1 (como hoy). Sin mail |
| Con factura, achica | 9 (F) | 9 → 6 | — | No se toca; reserva 6, 3 de saldo. Al terminar, el ajuste pide la DEVOL a Juan (lo de siempre) |
| NP traída | 5 | 5 → 7 | — | NP nueva por 2 (como hoy) |
| NP compartida con otro pedido activo | 20 | 8 → 9 | — | Como hoy (libre o adicional) |
| Proyecto sin tope | proyecto | 8 → 9 | — | Como hoy (adicional de proyecto) |
| Llave apagada | 8 | 8 → 9 | — | Como hoy (adicional) |

## 4. Base de datos

Migración nueva `supabase/migrations/202611181400_zomatik_np_edicion.sql`, **sin aplicar**. Correrla fuera de
horario, probada antes en `BEGIN … ROLLBACK` (lock_timeout 3 s). **Va antes de publicar el código** (6.4).

| Cambio | Detalle |
|---|---|
| `zomatik_np_config.editar_activo` | `boolean NOT NULL DEFAULT false`. Llave propia; requiere `activo` (la NP). No requiere remitir ni ajustar |
| `zomatik_np_config.editar_desde` | `timestamptz`, de registro (cuándo se prendió) |
| `zomatik_np_ajustes.origen` | `text NOT NULL DEFAULT 'finalizar' CHECK (origen IN ('finalizar','pedido'))`. `pedido` = edición por cambio del pedido |
| `zomatik_np_ajustes.m3_uso_objetivo` | `numeric(10,3)`: la reserva del pedido después de editar (solo `pedido`) |
| UNIQUE | Se saca `zomatik_np_ajustes_np_pedido_key` y se crean dos índices únicos parciales: `(np_id, scheduled_dispatch_id) WHERE origen = 'finalizar'` (lo mismo de hoy) y `(np_id) WHERE origen = 'pedido' AND estado IN ('pendiente','generando','revisar','error')` (**una sola edición abierta por NP**) |
| `zomatik_np_edicion_aplicar(p_id)` (nueva) | Con la fila y la NP `FOR UPDATE`. Exige `origen = 'pedido'` y estado `generando` (o ya aplicada: idempotente, solo la deja `ok`). `zomatik_np.m3_original = coalesce(m3_original, m3)`, `zomatik_np.m3 = m3_objetivo`, `saldo_desde = NULL`; el uso activo del pedido en esa NP = `m3_uso_objetivo` (si ya no está activo, solo la NP). **No** cierra el saldo. Fila `ok`, `aplicado_at`, `ok_at`. Devuelve `{ok}` o `{error}`. `REVOKE` a anon/authenticated, `GRANT` a service_role |
| `zomatik_ajuste_aplicar` | Misma función con una línea más al principio: si `origen <> 'finalizar'`, `{error: 'No es un ajuste al finalizar.'}` |

Tipos (`tipo`): ya alcanzan los del CHECK (`editar`, `adicional`, `devol`, `nada`). Estados: los mismos.

Marca de la fila (clave interna, no se graba en Zomatik): `marcaEdicion(pedidoId, np, k)` =
"Sistema Rebucret - pedido 1a2b3c4d - edicion NP 0001-00001194 - 1" (ASCII; `k` = cuántas ediciones de esa NP y ese
pedido hubo + 1).

**Qué pasa con los datos ya cargados:**
- `zomatik_np_ajustes`: todas las filas quedan `origen = 'finalizar'` (default) y `m3_uso_objetivo` nulo. El índice
  parcial nuevo protege exactamente lo mismo que el UNIQUE de hoy (todas son `finalizar`): ninguna fila choca.
- `zomatik_np_config`: `editar_activo = false` en Canning y Hudson. Con la llave apagada no se crea ninguna fila
  `pedido` y todo sigue como hoy.
- `zomatik_np`, `zomatik_np_uso`, `zomatik_remitos`, `zomatik_remito_despachos`, `zomatik_np_pedido`,
  `scheduled_dispatches`, `dispatches`: no se tocan. Las NP adicionales que ya existen (1197 de Cordones) quedan.
- Al prender la llave no se edita nada solo: todo pedido activo tiene hoy su reserva igual a sus m³ (lo cubrió una
  adicional). La edición nace solo de un cambio del pedido.
- No hay columna `plant` / `planta` en estas tablas: la planta va por `plant_id` (uuid), como en todo Zomatik.

## 5. Flujo

### 5.1 Al guardar el pedido (`sincronizarPedido`, sin Zomatik)

1. `plantasNp` lee también `editar_activo` (si la columna no existe, 42703: sin edición, como `configZ1`).
2. Para cada uso activo arma `UsoPlan.editable` (3.1) y `UsoPlan.edicion` (la fila abierta de origen `pedido` de esa NP
   y ese pedido: `id`, `estado`, `m3_uso_objetivo`, `fija` = generando, cortada en `grabar_np`/`verificar_np`/`aplicar`,
   `revisar` o `error`).
3. `planificarNp` devuelve además `editar: { uso_id, np_id, m3_uso }[]` (3.3) y avisos. Con una edición `fija` en esa NP
   que no alcanza, no crea adicional: aviso "La NP se está actualizando: el cambio a 10 m³ va después."
4. El servidor, por cada `editar`: calcula `m3_objetivo` (3.2).
   - Hay una fila abierta `pendiente` y no fija: si cambió algo, la actualiza (`m3_objetivo`, `m3_uso_objetivo`,
     `m3_np`) y le pone `proximo_intento = ahora + 2 min`. Si no cambió nada, **no** toca `proximo_intento` (la pasada de
     cada 10 min sincroniza todo y no puede postergarla para siempre).
   - Hay una fija: no se toca; cuando termine, el robot vuelve a sincronizar el pedido.
   - No hay y `m3_objetivo` ≠ `zomatik_np.m3` (o la reserva cambia): inserta la fila (`origen 'pedido'`, `tipo
     'editar'`, `estado 'pendiente'`, `proximo_intento = ahora + 2 min`). 23505 = otro proceso la creó: se relee.
5. Toda edición abierta del pedido, **no fija**, que el plan ya no pide (volvió a 8, se canceló, se desvinculó la NP por
   fecha/fórmula/cliente/planta) → `anulado` con el motivo.
6. Devuelve `editadas` (cuántas filas creó o cambió) y los avisos. Actividad: "La NP 0001-00001194 pasa a 9 m³ en
   Zomatik (pendiente)".

### 5.2 Robot (`procesarEdiciones`, `lib/zomatik/edicion-servidor.ts`, nuevo)

Lo llama `/api/zomatik/np/procesar` **después** de `procesarNp` y antes de Z1 (generar NP es más urgente: el modo duro
frena el despacho sin NP), y "Generar NP ahora" del pedido (manual: sin esperar los 2 min, también las de `error`).
Mismo turno del robot (`zomatik_robot_tomar`, se suelta en `finally`), misma regla de tiempo (`quedaTiempo`).

| # | Paso | Qué hace | Si no se puede |
|---|---|---|---|
| 0 | tomar | `zomatik_ajuste_tomar(id, ['pendiente', (manual) 'error'])`; colgada en `generando` > 3 min = corte | — |
| 1 | `controlar` (sin Zomatik, solo si no está cortada) | Pedido cancelado → `anulado`. Pedido completo con el ajuste al finalizar prendido → `anulado` ("Lo deja justo el ajuste al finalizar"). NP ya no editable → `anulado` + `sincronizarPedido` (sale la adicional si hace falta). NP en `generando` → `pendiente` +10 ("Esperando que salga la NP"). Otra fila abierta de la misma NP (ajuste al finalizar de otro pedido) → `pendiente` +10 ("Esperando otro cambio de la NP"). Más de 3 cortes → `revisar` | — |
| 2 | `decidir` | Recalcula `m3_objetivo` con la base de **ahora** (3.2) y la reserva de la fila. Igual a la NP → solo `aplicar` (sin Zomatik, `nada`). Pisos de 3.2 no dan → `revisar` | — |
| 3 | `leer_np` … `verificar_np` | `navegadorAjuste(llaveEdicion(planta), codigo)` + `ajustarCantidadNp` **sin cambios** (marca, un renglón, cantidad = base, factura, Grabar, verificación) | Resultados en 5.3 |
| 4 | `aplicar` | `guardarSi(paso 'aplicar')` → `zomatik_np_edicion_aplicar`. Si falla la base, queda `generando` en `aplicar` y el reintento **solo** repite esto | — |
| 5 | después | Si el listado muestra la NP "por autorizar" (`autorizacionEnListado`, solo lectura) → `zomatik_np.paso = 'sin_autorizar'` (la autoriza la pasada de siempre, `sinAutorizar`). Si el pedido tiene despachos sin remito y Z1 está prendido → `prepararRemitos`. Siempre → `sincronizarPedido` (por si cambió de nuevo) | Errores de estos pasos van a consola y Actividad; la edición ya está `ok` |

### 5.3 Qué hace con cada resultado del robot

| `ajustarCantidadNp` | Edición queda | Y además |
|---|---|---|
| `ok` (o `yaEstaba` tras un corte) | `ok` | Actividad "NP editada en Zomatik: NP 0001-00001194 8 → 9 m³ (el pedido pasó a 9)" |
| `con_factura` | `nada`, `con_factura = true`, `tipo = 'adicional'` (crece) o `'devol'` (achica) | `sincronizarPedido`: crece → NP adicional como hoy; achica → reserva baja, saldo queda (lo resuelve el ajuste al finalizar). **Sin mail** (decisión 12.4) |
| `error` en `grabar_np` (Zomatik contestó un `alert` que no habla de factura) | `nada`, `con_factura = false`, tipo como arriba | `sincronizarPedido` (la adicional si crece) + mail a Bautista (`avisarErrorZomatik`, uno por edición) con el texto de Zomatik (decisión 12.7) |
| `error` en otro paso (formato, falta un dato) | `error` | Mail a Bautista una vez por episodio. Se reintenta solo con "Generar NP ahora" o "Reintentar cambio de NP" |
| `revisar` (sin marca, cantidad tocada a mano, contradice, no cerró el total, no se pudo leer) | `revisar` | Mail a Bautista una vez por episodio. **No** se hace adicional (pudo haber quedado grabada). Lo resuelve un gerencial (7.3) |
| `pendiente` (red, sesión) | `pendiente` +10 min | `avisarFallaAcceso` / `avisarCaidaFila` / `avisarPendienteLargo`, los de siempre |

Reglas de Zomatik (sin excepciones): el robot nunca borra; nunca pide por GET un link de acción (`remitir_*`, `set_*`,
`borrar_*`, `generar_*`, `_autorizar*`): la lista cerrada del ajuste no los tiene y no se le agrega nada. Edita solo con
`ajustarCantidadNp` (el mismo Grabar del ajuste). La autorización, si hace falta, la hace la pasada de la NP con su
propio grupo (`_autorizarpedido.php` por POST, como desde el 03/11).

## 6. Convivencia con el resto

### 6.1 Ajuste al finalizar
- `prepararAjustes`: antes de armar, anula las ediciones abiertas **no fijas** del pedido ("Lo deja justo el ajuste al
  finalizar"). Su cuenta ya cubre lo que faltaba: con la reserva en 8 y 9 despachados, `tope = 8 + (9 − 8) = 9`.
- `trabajarAjustes`: si la NP tiene una edición abierta (fija), el ajuste queda `pendiente` +10 con "Esperando el cambio
  de la NP". El remito espera por el gate de siempre (el ajuste no está listo).
- Todas las lecturas del ajuste filtran `origen = 'finalizar'`: `prepararAjustes` (`ya`, `ahoraHay`), `ajusteDe`,
  `ajustesATrabajar`, `remitirSinAjustar`, `estadoAjustes`. Si la columna no existe (42703), sin filtro (como hoy).
- `npsAjustandose` **no** filtra: una edición en curso también saca la NP de "NP con saldo".
- Con el ajuste apagado y el pedido completo, la edición termina igual (la NP queda cubriendo lo despachado y el remito
  del sobrante sale).

### 6.2 Remitos (Z1)
- `planificarRemitos` no cambia: con la reserva aplicada (9), el camión de 9 entra entero en una NP: **un remito**.
- Mientras la edición no se aplicó, la reserva sigue en 8: el despacho que no entra queda afuera como hoy. En
  `prepararRemitos`, si el pedido tiene una edición abierta, el problema dice "Esperando que la NP pase a 9 m³ en
  Zomatik" en vez de "generá una NP adicional". Al aplicar, el paso 5 vuelve a armar los remitos.
- Lo ya remitido no se toca: los pisos de 3.2 garantizan que la NP nunca queda por debajo.
- Despacho partido entre NP (16/11): sigue andando para los pedidos que ya tienen dos NP.

### 6.3 Fecha
- Cambia fecha y m³ a la vez, "¿Mover la NP a la nueva fecha?":
  - **Sí:** se mueve (solo en el sistema) y se edita la misma NP.
  - **No:** la NP queda con su saldo (desvincular, como hoy) y va una NP nueva **por el total**. Una edición pendiente de
    esa NP se anula.
  - **Sin contestar** (solo pasa en la pasada): se edita igual, con el aviso de siempre.

### 6.4 Orden para publicar
1. Aplicar la migración (fuera de horario). Con el código de `main` no cambia nada (no lee `origen`).
2. Publicar el código con la llave apagada.
3. Primera edición real con Bautista mirando (7.4). Recién ahí prender `editar_activo` con SQL en Canning, y después en
   Hudson.

Si se publicara el código sin la migración, los filtros por `origen` no pueden apagar el ajuste al finalizar: por eso
la vuelta sin filtro con 42703 es obligatoria.

## 7. Pantalla

Textos cortos, rioplatense. Sin montos.

### 7.1 Formulario del pedido (`np-bloque.tsx`)
- Al cambiar los m³ de un pedido con una sola NP editable (`editable` viene en el estado), abajo de "Ya tiene:":
  "Al guardar, la NP …1194 pasa a 9 m³." con (?) → "Se edita la misma NP en Zomatik. Si tiene factura, va una NP
  adicional."
- Con la NP no editable, nada nuevo (sale la adicional, como hoy).

### 7.2 Al guardar (toast, `dispatch-scheduling.tsx`)
- `editadas > 0`: "NP: pasa a 9 m³" / "En unos minutos queda en Zomatik."
- Con factura conocida (no editable) y crece: lo de hoy ("Generando la NP en Zomatik…").

### 7.3 Chip del pedido (`chipNp`, Programación y Despacho)
- Edición `pendiente` o `generando`: **"NP: actualizando a 9 m³"** (ámbar). Título: "NP 0001-00001194: 8 → 9 m³ en
  Zomatik".
- Esperando (NP generando u otro cambio): mismo chip; el título suma el motivo.
- `revisar` o `error`: **"NP: revisar cambio"** (ámbar / rojo). Título: el mensaje.
- `nada` por factura o rechazo: el chip de siempre; el título suma "Zomatik no dejó cambiarla: va una NP adicional por
  1 m³" (crece) o "Tiene factura: se ajusta al terminar" (achica).
- Menú ⋯ del pedido (solo gerenciales, con la edición en `revisar` o `error`):
  - **"Reintentar cambio de NP"** → vuelve a `pendiente` (un corte se relee primero, como siempre).
  - **"Dejar la NP como está"** → "¿Dejás la NP en 8 m³? Si el pedido necesita más, va una NP adicional." + motivo →
    `a_mano`, tipo `adicional`; la NP deja de ser editable para ese pedido y se sincroniza.

### 7.4 Primera edición real (con Bautista)
Antes de prender la llave, si el ajuste al finalizar todavía no editó una NP real: pedido de prueba de OBRA PROPIA
REBUCRET en Canning, 1 m³ → 2 m³, con la llave prendida un rato y Bautista mirando Zomatik. Mirar y anotar:
1. que la NP queda con un renglón de 2 m³, el mismo precio por m³ y el total al doble;
2. **si la NP vuelve a "por autorizar"** después de editarla (hoy no se sabe; el paso 5 lo cubre igual);
3. el HAR del Grabar, para pasar a REAL los fixtures SUPUESTO de `lib/__fixtures__/zomatik-ajuste/`.
Después, la NP de prueba la vacía Bautista a mano.

## 8. Casos borde

| Caso | Qué pasa |
|---|---|
| El robot edita mientras Titan cambia de nuevo | La fila está fija: el cambio nuevo espera. Al aplicar, el paso 5 sincroniza y nace otra edición |
| Corte en el Grabar | `paso = grabar_np`: el reintento relee. Ya en el objetivo → `aplicar`; en la de antes → edita; otra → `revisar` |
| Corte entre Zomatik y la base | Queda `generando` en `aplicar`; el reintento solo repite `aplicar` |
| Pedido cancelado con la edición en Grabar | No se anula; termina, `aplicar` deja la NP con la cantidad nueva y sin uso activo → "NP con saldo", como cualquier cancelado |
| Zomatik caído o sesión caída | `pendiente`, un solo aviso para todo el robot (`avisarFallaAcceso`) |
| Alguien editó la NP a mano en Zomatik | Cantidad ≠ base → `revisar` "La NP cambió en Zomatik…", sin tocar |
| La NP tiene dos renglones | `revisar` (no se toca) |
| Despacho con tolerancia (+0,5) | No cambia los m³ del pedido: no hay edición. Lo resuelve el ajuste al finalizar |
| Pedido que llega a 0 m³ | No se edita a 0: reserva 0 y la NP con saldo (como hoy) |
| NP que comparte otro pedido activo | No editable: como hoy |
| Despacho en modo duro con la edición pendiente | No frena: el pedido tiene su NP `ok` (el trigger no cambia) |
| Prender la llave | No dispara ediciones solas (4, último punto) |
| Precio (sección 27) | No cambia: el `costo` del renglón queda igual; la adicional de un fallback sale con el precio congelado, como hoy |

## 9. Pruebas

`node --test` con los scripts de siempre. Fixtures: los de `lib/__fixtures__/zomatik-ajuste/` (detalle con y sin
factura, comprobantes, rechazos) y los del listado con `Autorizar(` de `lib/__fixtures__/zomatik-np/`. Sin fixtures
nuevos hasta la captura de 7.4.

- **`lib/__tests__/zomatik-np.test.mjs`** (`planificarNp`): crece 8 → 9 con una NP editable → `editar` 9, sin
  `crear`; crece con NP no editable (traída, proyecto, compartida, con factura) → `crear` adicional como hoy; achica
  9 → 6 editable → `editar` 6 y **sin** `ajustar`; achica no editable → `ajustar` como hoy; edición fija y el pedido pide
  más → ni `crear` ni `editar`, con el aviso; pasada sin cambios con una edición pendiente → `editar` con el mismo valor;
  fecha + m³ con mover sí → `mover_fecha` + `editar`; mover no → `desvincular` + `crear` por el total; proyecto con tope
  + nueva → edita la nueva; Cordones (8 + 1) a 10 → edita la adicional a 2; achicar la adicional a 0 → `ajustar` 0.
- **`lib/__tests__/zomatik-ajuste.test.mjs`**: `objetivoEdicion` (sin despachos 9; con 5 remitidos y pedido 10 → 10;
  achica a 6 con 7 despachados → 7; con un uso desvinculado que despachó 2 → +2; piso de remitos no da → revisar);
  `marcaEdicion` ASCII y con `k`; `npEditable` (cada fila de 3.1, una por una).
- **`lib/__tests__/zomatik-np-servidor.test.mjs`** (base simulada): sincronizar crea una fila `pedido` con
  `proximo_intento` +2 min; 8 → 9 → 10 antes de la pasada = una fila con 10; una pasada sin cambios no mueve
  `proximo_intento`; vuelve a 8 → `anulado`; cancelar con una pendiente → `anulado`; con una fija → no se anula; llave
  apagada → adicional, sin filas; dos filas abiertas de la misma NP → 23505 y se relee; `npsAjustandose` ve la edición.
- **Robot y servidor de la edición** (nuevo `lib/__tests__/zomatik-edicion.test.mjs`, script `test:zomatik-edicion`;
  navegador y base simulados, como `zomatik-ajuste.test.mjs`): 8 → 9 ok → el cuerpo del Grabar trae `cantidad<id>=9`
  y el `costo<id>` leído sin cambiar, NP 9, uso 9, `m3_original` 8; con factura → `nada` tipo `adicional` y la
  sincronización crea la adicional de 1, sin mail a Juan; achica con factura → `nada` tipo `devol`, reserva 6, sin mail;
  rechazo del Grabar (`grabar-rechazo-remitido.html`) → adicional + un mail a Bautista; corte en `grabar_np` con la NP ya
  en 9 → ok sin grabar de nuevo; corte en `aplicar` → solo `aplicar`; sin marca → `revisar` sin grabar; cantidad tocada
  a mano → `revisar`; NP por autorizar después → `paso = 'sin_autorizar'`; NP generando → espera; ajuste al finalizar
  abierto en la misma NP → espera; pedido completo con el ajuste prendido → `anulado`; 3 cortes → `revisar`; llave
  apagada → `navegadorAjuste` rechaza.
- **Ajuste** (en `zomatik-ajuste.test.mjs`): con una fila `pedido` `ok` del mismo pedido y NP, `prepararAjustes` igual
  arma la de `finalizar` (no choca); el gate solo mira `finalizar`; `remitirSinAjustar` y `estadoAjustes` ignoran las
  ediciones; el ajuste espera una edición fija; `zomatik_ajuste_aplicar` rechaza una fila `pedido`.
- **Z1** (`zomatik-z1.test.mjs`): con la reserva en 9, un despacho de 9 sale en un remito contra una NP; con una
  edición abierta, el problema dice "Esperando que la NP pase a 9 m³"; después de aplicar, `prepararRemitos` arma el
  despacho que había quedado afuera.
- **Lista cerrada** (`zomatik-np.test.mjs`): sin cambios en `rutaEscrituraAjuste`; se agrega que con la llave de
  edición el navegador sigue rechazando `remitir_ordenfabricacion`, `set_`, `borrar_`, `generar_`, `_autorizarpedido`,
  `fborrar`, `codigo=0` y otro código.
- Además: `test:zomatik-np`, `test:zomatik-ajuste`, `test:zomatik-z1`, `test:zomatik` pasan; `tsc` sin errores nuevos
  sobre los archivos tocados; build con `--webpack`.

## 10. Criterios de aceptación

Caso Cordones de nuevo, con la llave prendida en Canning: pedido de La Tercera, Cordones, H… por **8 m³**, con su NP
generada y autorizada (sea 0001-0000XXXX).

1. Titan edita el pedido a **9**. El formulario dice "Al guardar, la NP …XXXX pasa a 9 m³." Al guardar: toast
   "NP: pasa a 9 m³" y el chip "NP: actualizando a 9 m³".
2. En la próxima pasada (hasta ~12 min): en Zomatik la **misma** NP tiene **un** renglón de **9 m³**, el mismo precio por
   m³ y el total × 9/8. **No** aparece una NP adicional. En la base: `zomatik_np.m3 = 9`, `m3_original = 8`, uso 9, una
   fila `zomatik_np_ajustes` `origen 'pedido'`, `tipo 'editar'`, `estado 'ok'`. Actividad: "NP editada en Zomatik: NP
   0001-0000XXXX 8 → 9 m³". El chip vuelve al verde con un solo número.
3. Un camión de 9 m³ sale en **un** remito contra esa NP.
4. **8 → 9 → 10** en menos de 2 minutos: una sola fila, una sola edición a 10.
5. **9 → 6** sin despachos: la NP queda en 6 y no aparece en "NP con saldo". Con 7 despachados: queda en 7.
6. **Con factura** (NP sin el botón Grabar): crece → NP adicional por la diferencia, como hoy, y la NP con factura no se
   toca; achica → no se toca, reserva baja; al finalizar, el mail a Juan es **uno** (el del ajuste).
7. **NP traída, de proyecto o compartida:** exactamente lo de hoy.
8. **Llave apagada** (o planta Hudson antes de prenderla): exactamente lo de hoy (adicional al crecer, saldo al
   achicar), y ninguna fila `pedido` en la base.
9. **Finalizar** con el ajuste prendido: igual que hoy; si había una edición pendiente, queda `anulado` y la NP la deja
   justa el ajuste.
10. **No se rompe:** las pruebas de siempre pasan; Cordones con 1194 + 1197 sigue con sus dos NP; al prender la llave la
    pasada no edita ninguna NP sola; ninguna ruta fuera de la lista cerrada del ajuste sale hacia Zomatik.

## 11. Archivos

| Archivo | Qué | Patrón a copiar |
|---|---|---|
| `supabase/migrations/202611181400_zomatik_np_edicion.sql` (nuevo, **sin aplicar**) | Sección 4 | `202611061200_zomatik_np_ajuste.sql` |
| `lib/zomatik/np.ts` | `UsoPlan.editable` y `UsoPlan.edicion`; `PlanNp.editar`; las reglas de 3.3 en `planificarNp` (crece: después de libre y saldo, la última editable; achica: editar en vez de `ajustar` en las editables); textos de aviso | `planificarNp` |
| `lib/zomatik/ajuste.ts` | `objetivoEdicion`, `marcaEdicion`, `npEditable` (pura, con lo leído de la base), `ORIGEN_FINALIZAR`/`ORIGEN_PEDIDO`, textos de 7 y 5.3 | `planificarAjuste`, `comprometidoOtros`, `marcaAjuste` |
| `lib/zomatik/np-servidor.ts` | `plantasNp` lee `editar_activo` (con 42703); `llaveEdicion(planta)` (el único lugar que arma la `LlaveAjuste` para una edición: NP + edición prendidas); `sincronizarPedido` arma `editable`/`edicion`, aplica `plan.editar` (5.1), anula ediciones que ya no hacen falta y devuelve `editadas`; `estadoPedidos` suma por NP `editable` y `edicion` (estado, `m3_objetivo`, mensaje) | `sincronizarPedido`, `npsAjustandose` |
| `lib/zomatik/edicion-servidor.ts` (nuevo) | `procesarEdiciones` (5.2 y 5.3), `resolverEdicion` (reintentar / dejar como está) | `trabajarAjustes`, `remitirSinAjustar` (`ajuste-servidor.ts`) |
| `lib/zomatik/np-robot.ts` | `ajustarCantidadNp` devuelve también `porAutorizar` (de la fila del listado leída en la verificación, `autorizacionEnListado`). Nada más | `filaNp` |
| `lib/zomatik/ajuste-servidor.ts` | Filtro `origen = 'finalizar'` (con vuelta sin filtro en 42703) en `prepararAjustes`, `ajusteDe`, `ajustesATrabajar`, `remitirSinAjustar`, `estadoAjustes`; `prepararAjustes` anula ediciones no fijas del pedido; `trabajarAjustes` espera una edición fija; `COLUMNAS_AJUSTE` suma `origen`, `m3_uso_objetivo` | — |
| `lib/zomatik/z1-servidor.ts` | `configZ1` lee `editar_activo` (con 42703); en `prepararRemitos`, el texto del problema con una edición abierta | — |
| `app/api/zomatik/np/procesar/route.ts` | `procesarEdiciones` después de `procesarNp` y antes de Z1 | — |
| `app/api/zomatik/np/route.ts` | "generar" corre también `procesarEdiciones` del pedido (manual); acción nueva `edicion` (`reintentar` / `dejar`, solo gerenciales, `dejar` con motivo); "sincronizar" devuelve `editadas` (sin `after()`: la espera de 2 min es a propósito) | Acción `saldo` |
| `lib/zomatik/np-cliente.ts` | Tipos (`editable`, `edicion`); `chipNp` con los textos de 7.3; `avisarNp` devuelve `editadas`; `resolverEdicionNp` | `chipNp`, `generarNpAhora` |
| `components/zomatik/np-bloque.tsx` | La línea "Al guardar, la NP …1194 pasa a 9 m³." (7.1) | Línea del precio (`LineaPrecio`), ancho fijo |
| `components/dispatch-scheduling.tsx` | Toast de 7.2; ítems del menú ⋯ de 7.3 (gerenciales) con el diálogo de motivo | "Generar NP ahora" y "Remitir sin ajustar la NP" |
| `components/despacho/despacho-tablero.tsx` | Nada nuevo: "Editar total" ya llama a `avisarNp`; el chip sale de `chipNp` | — |
| `lib/__tests__/zomatik-edicion.test.mjs` (nuevo) + script `test:zomatik-edicion` en `package.json` | Sección 9 | `zomatik-ajuste.test.mjs` |
| `lib/__tests__/zomatik-np.test.mjs`, `zomatik-np-servidor.test.mjs`, `zomatik-ajuste.test.mjs`, `zomatik-z1.test.mjs` | Casos nuevos de la sección 9 | — |
| `docs/migracion-loop/zomatik.md` | Pegar la sección 29 (abajo) | — |

No se tocan: `web.ts` (lista cerrada), `cliente.ts`, `z1.ts`, `z1-robot.ts`, el trigger del despacho, `registrar_despacho`.

## 12. Decisiones para Bautista (con recomendación)

1. **Llave propia por planta** (`editar_activo`), separada del ajuste. **Recomendación:** sí; prender Canning después de
   la primera edición real con vos mirando (7.4), y Hudson una semana después.
2. **Pedido con varias NP: cuál se edita.** (a) la última editable; (b) la primera (la "principal").
   **Recomendación:** (a). Es la que se está consumiendo y no choca con una NP vieja ya remitida entera. En pedidos
   nuevos va a haber una sola NP casi siempre.
3. **NP de proyecto.** (a) no se edita, queda como hoy; (b) se edita respetando el saldo del proyecto.
   **Recomendación:** (a). El saldo del proyecto en el sistema es aproximado y no sabemos qué hace Zomatik si no
   alcanza ni si al achicar vuelve. Al terminar, el ajuste la deja justa (ya lo aprobaste el 06/11). Con tope, el resto
   va en una NP nueva que sí se edita.
4. **Achica con factura: ¿mail a Juan en el momento?** **Recomendación:** no. Se avisa una sola vez, al finalizar, con
   la devolución exacta (lo de hoy). Avisar ahora pide una DEVOL que puede cambiar si el pedido cambia de nuevo.
5. **Cuánto espera para juntar cambios.** **Recomendación:** 2 minutos desde el último cambio y después la pasada de
   cada 10 min: el cambio queda en Zomatik en hasta ~12 min y 8 → 9 → 10 sale en una sola edición. Si lo querés al
   instante, "Generar NP ahora" lo hace ya.
6. **Achicar también saca el saldo libre que tuviera la NP** (es tu decisión 16, aplicada antes de terminar).
   **Recomendación:** sí. La NP queda siempre en lo que el pedido necesita.
7. **Zomatik rechaza la edición sin hablar de factura.** (a) NP adicional automática + mail a vos; (b) queda para
   revisar y el pedido espera. **Recomendación:** (a): el pedido nunca queda corto y te enterás.
8. **Pedidos con adicional de antes (Cordones):** no se juntan. Si cambian de nuevo, se edita la adicional. ¿OK?

---

## 13. Sección 29 para pegar en `docs/migracion-loop/zomatik.md`

```markdown
## 29. Editar la NP cuando el pedido cambia de m³ (18/11/2026) — cambia 24.1.2, 24.5.6 y 25.2 (Agrandar / Achicar)

Spec: `docs/specs/2026-11-18-editar-np-al-cambiar-pedido.md` (la sección 12, cuando la conteste Bautista, manda).
Migración `supabase/migrations/202611181400_zomatik_np_edicion.sql`. Motivo: La Tercera, Cordones (18/11) pasó de 8 a
9 m³ y quedaron dos NP (1194 + adicional 1197); un camión con m³ de las dos salía en dos remitos.

- **Qué cambia:** con la llave nueva `zomatik_np_config.editar_activo` (por planta, apagada por defecto), si el pedido
  cambia de m³ antes de terminar, el robot **edita la cantidad de su NP** en Zomatik (8 → 9 o 9 → 6) en vez de hacer
  una NP adicional o dejar saldo. Mismo camino que el ajuste al finalizar (`ajustarCantidadNp`, `navegadorAjuste`,
  control de factura); el `costo` del renglón no se toca.
- **NP editable:** nueva, con la marca del sistema, `ok` en la sucursal 18, sin decisión de "NP con saldo", sin otro
  pedido activo que la use y sin factura conocida. **No** se editan: traídas de Zomatik, de proyecto ni compartidas
  (siguen como en 25.2).
- **Cuánto:** la NP queda en lo que reservan los otros + máx(reserva nueva, lo despachado de este pedido). Nunca menos de
  lo remitido ni 0. Crece: después de lo libre y la NP con saldo, la última NP editable. Achica: de la última para atrás.
- **Base:** `zomatik_np_ajustes.origen` (`finalizar` / `pedido`) y `m3_uso_objetivo`; una sola edición abierta por NP;
  `zomatik_np_edicion_aplicar` pasa a la base la NP y la reserva juntas cuando Zomatik confirma.
- **Cuándo:** 2 min después del último cambio, en la pasada de cada 10 min (o ya, con "Generar NP ahora"). 8 → 9 → 10
  sale en una sola edición. La pantalla dice "NP: actualizando a 9 m³".
- **Si no se puede:** con factura o si Zomatik dice que no → crece: NP adicional (como antes); achica: no se toca y lo
  resuelve el ajuste al finalizar. "Revisar" o "error": mail a Bautista; un gerencial elige "Reintentar cambio de NP" o
  "Dejar la NP como está".
- **Con el resto:** el ajuste al finalizar anula una edición pendiente y espera una en curso; Z1 no cambia (con la
  reserva en 9, un camión de 9 sale en un remito). Cambiar la fecha: "Sí, mover" edita la misma NP; "No" deja la vieja
  con saldo y va una nueva por el total.
- **Datos ya cargados:** no cambian. Las adicionales que ya existen (Cordones 1197) quedan; prender la llave no edita
  nada solo.
```

## 14. Decisiones tomadas (18/11, orquestador) — mandan sobre la sección 12

Se toman las 8 recomendaciones de la sección 12:
1. Llave propia por planta (`editar_activo`), apagada al nacer.
2. Con varias NP se edita la última editable.
3. Una NP de proyecto no se edita: queda como hoy.
4. Si achica con factura, no se manda mail en el momento: le llega uno solo a Juan al finalizar.
5. Espera de 2 minutos para juntar cambios, más la pasada.
6. Achicar también saca el saldo libre.
7. Si Zomatik rechaza la edición sin que sea por factura: NP adicional automática y mail a Bautista.
8. Los pedidos con adicional de antes no se juntan. Si vuelven a cambiar, se edita la adicional.

La migración se escribe pero NO se aplica: Bautista la corre después de que el revisor apruebe.
