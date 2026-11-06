Respuestas de Zomatik para `lib/__tests__/zomatik-ajuste.test.mjs` (ajustar la NP a lo despachado al finalizar el
pedido, docs/specs/2026-11-06-ajustar-np-al-finalizar.md). Lo de la NP facturada se confirmó el 06/11 mirando Zomatik
(solo lectura, 4 NP); lo del Grabar al editar sigue SUPUESTO hasta la captura 4 (7.4). Antes de prender
`ajustar_activo` hay que reemplazar lo SUPUESTO y revisar `rechazoPorFactura` (lib/zomatik/ajuste.ts) y
`ajustarCantidadNp` (lib/zomatik/np-robot.ts).

| Archivo | Qué es | Origen |
|---|---|---|
| `detalle-np.html` | El detalle que carga una NP grabada (`manage_pedidos.php` con `pedidos=N` y su `pedidos_unico`), con `{{CANT}}` y `{{TOTAL}}` para la cantidad del renglón y el total. Trae el botón Grabar (`botgrabar`): NP sin factura | **REAL** en la forma: es `zomatik-np/detalle-np-abierta.html` (NP2 0001-00002086, 28/10) con la cantidad y el total como plantilla |
| `detalle-np-facturada.html` | El mismo detalle SIN la fila del botón Grabar (`<td class="botonformulario"><input type="image" id="botgrabar" …>`), con la cantidad editable | **REAL** en el comportamiento (06/11: NP2 2098 PEN con F2 sin remito y NP2 2092 con RM2 + F2 no traen el Grabar; NP 1182 con solo RM y una NP sin comprobantes sí). Armado quitando esa fila del detalle real. La página estática `modificar_pedidos.php?codigo=N` NUNCA trae el `botgrabar` (solo lo nombra un script): solo cuenta el detalle |
| `comprobantes-con-factura.html` | `GET _comprobantes.php?ftarget=pedidos&ftargetid=N` de una NP con remito y factura: `RM2 0099-00002758` (`modificar_remitos.php?codigo=`) y `F2 0001-00002455` (`modificar_facturasventa.php?codigo=`) | **REAL** (06/11, lo que abre "COMPROBANTES / OPERACIONES") |
| `comprobantes-sin-nada.html` | La misma respuesta de una NP sin comprobantes (solo la cabecera) | **REAL** (06/11) |
| `grabar-rechazo-factura.html` | El Grabar de una NP con factura contesta un `alert` que habla de comprobantes / factura | **SUPUESTO** (forma de `zomatik-np/grabar-alert.html`, que es real; el texto no). Con la señal C real no debería llegar a grabarse |
| `grabar-rechazo-remitido.html` | El Grabar con una cantidad menor a lo remitido contesta un `alert` | **SUPUESTO**. Falta la captura 4 (7.4.3) |

También es SUPUESTO (se arma en la prueba, no hay archivo):
- La fila del listado de pedidos con estado `FAC` (señal A): `pedidosDeListado` ya acepta FAC, pero no se vio nunca.
- Que después de editar la cantidad el Grabar redirija (302) y que el total del listado quede en proporción.
- Que el Grabar de la edición sea el mismo multipart que el de vaciar (`cuerpoGrabar`) con el renglón y `fparam` con la
  cantidad nueva, sin pasar antes por `manage_pedidos.php` (captura 4, 7.4.2).
- Qué trae "Continuar" del remito como pendiente después de editar una NP con un remito parcial (7.4.2): se usa la
  forma real de `zomatik-z1/remito-pendientes.html`.

Contexto (06/11): de 70 NP recientes, 43 terminaron con factura, casi siempre hecha DESPUÉS del remito. Antes del
remito la tienen el pago adelantado (3 casos) y los pedidos de varios días con remitos ya facturados: esos son los que
el ajuste encuentra "con factura".

La página de la NP abierta (`modificar_pedidos.php?codigo=N`) es la de siempre: `zomatik-np/np-abierta.html`.
