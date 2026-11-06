Respuestas de Zomatik para `lib/__tests__/zomatik-ajuste.test.mjs` (ajustar la NP a lo despachado al finalizar el
pedido, docs/specs/2026-11-06-ajustar-np-al-finalizar.md). **Ninguna es una captura nueva**: las capturas 2 y 4 de la
sección 7 todavía no se hicieron. Antes de prender `ajustar_activo` hay que reemplazar las SUPUESTO por las reales y
ajustar `facturaDeNp` / `rechazoPorFactura` (lib/zomatik/ajuste.ts) y `ajustarCantidadNp` (lib/zomatik/np-robot.ts).

| Archivo | Qué es | Origen |
|---|---|---|
| `detalle-np.html` | El detalle que carga una NP grabada (`manage_pedidos.php` con `pedidos=N` y su `pedidos_unico`), con `{{CANT}}` y `{{TOTAL}}` para la cantidad del renglón y el total | **REAL** en la forma: es `zomatik-np/detalle-np-abierta.html` (NP2 0001-00002086, 28/10) con la cantidad y el total como plantilla |
| `detalle-np-facturada.html` | Una NP con factura: sin el botón Grabar (`botgrabar`) y con la cantidad `readonly` | **SUPUESTO** (15.1: "Zomatik no deja editar la NP"). Falta la captura 2 (7.2) |
| `detalle-np-sin-grabar.html` | Igual, solo sin el botón Grabar (la cantidad editable) | **SUPUESTO** |
| `grabar-rechazo-factura.html` | El Grabar de una NP con factura contesta un `alert` que habla de comprobantes / factura | **SUPUESTO** (forma de `zomatik-np/grabar-alert.html`, que es real; el texto no) |
| `grabar-rechazo-remitido.html` | El Grabar con una cantidad menor a lo remitido contesta un `alert` | **SUPUESTO**. Falta la captura 4 (7.4.3) |

También es SUPUESTO (se arma en la prueba, no hay archivo):
- La fila del listado de pedidos con estado `FAC` (señal A): `pedidosDeListado` ya acepta FAC, pero no se vio nunca.
- Que después de editar la cantidad el Grabar redirija (302) y que el total del listado quede en proporción.
- Que el Grabar de la edición sea el mismo multipart que el de vaciar (`cuerpoGrabar`) con el renglón y `fparam` con la
  cantidad nueva, sin pasar antes por `manage_pedidos.php` (captura 4, 7.4.2).
- Qué trae "Continuar" del remito como pendiente después de editar una NP con un remito parcial (7.4.2): se usa la
  forma real de `zomatik-z1/remito-pendientes.html`.

La página de la NP abierta (`modificar_pedidos.php?codigo=N`) es la de siempre: `zomatik-np/np-abierta.html`.
