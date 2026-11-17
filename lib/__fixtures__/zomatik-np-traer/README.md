Respuestas de Zomatik para `lib/__tests__/zomatik-np-traer.test.mjs` (Traer NP de Zomatik,
docs/specs/2026-11-17-traer-np-de-zomatik.md). Solo lectura: nada de esto graba.

Se reusan, sin copiarlos: `zomatik-np/np-abierta.html`, `zomatik-np/detalle-np-abierta.html` (REAL, 28/10),
`zomatik-np/listado-1176.html`, `zomatik-np/listado-buscador.html`, `zomatik-np/listado-vacio.html` y
`zomatik-ajuste/comprobantes-*.html` (REAL, 06/11).

| Archivo | Qué es | Origen |
|---|---|---|
| `listado-1195.html` | La fila de la NP 0001-00001195 (código 157919, MERVA S.A.) en `listado_pedidos.php?enviado=1`: celdas sin anidar con las vacías intercaladas, Entrega Aprobada como link `set_pedidos_entregaaprobada.php` (" No "), Colocación " No ", acciones FC / REMITO / FC / DEVOL / CAMBSUC / RECIBO, el tacho `BorrarConPregunta('borrar_pedidos.php…')` y la celda `<b>PEN</b>`. Autorizada: sin `Autorizar(` y con `modificar_remitos.php?pedido=157919` | **ARMADO** con la forma de la captura REAL del 17/11 (sección 17 de la spec). Los links de FC y RECIBO van a `#` (no se capturaron); el total es de relleno |
| `listado-np-y-np2.html` | Una NP y una NP2 con el mismo número (0001-00002086) | **ARMADO** |
| `listado-sin-autorizar.html` | La NP 1195 sin autorizar: fila en rojo (`#fe8181`), con `Autorizar(157919)` y sin REMITO | **ARMADO** (la forma del ícono es la del 03/11; en las 299 filas del listado del 17/11 no había ninguna sin autorizar) |
| `np-abierta-1195.html` | `modificar_pedidos.php?codigo=157919`: `estado` SELECT (0 Invisible / 1 Activo, elegido 1), `comprobante` 15, `deposito` 113 REBUCRET, `idcliente` 24644, `numero` 0001-00001195, `fecha_entrega` "2026-11-19 00:00:00", sin la marca del sistema | **ARMADO** con los valores de la captura REAL del 17/11 sobre la forma de `zomatik-np/np-abierta.html`. Nombre, CUIT, lista y vendedor son de relleno |
| `np-abierta-otro-cliente.html` | La misma con `idcliente` 99999 (OTRO CLIENTE SA) | **ARMADO** |
| `np-abierta-otro-deposito.html` | La misma con el depósito PILAR (104) | **ARMADO** |
| `detalle-1195.html` | El detalle que carga la página: un renglón 5349824, artículo 10090014 H30-620-10 C (HUD), 25 m³ | **ARMADO** desde `zomatik-np/detalle-np-abierta.html` (REAL) con los valores de la captura del 17/11 |
| `comprobantes-solo-factura.html` | `_comprobantes.php` con solo la factura F2 0001-00002455 (sin remito) | **ARMADO** quitando el remito de `zomatik-ajuste/comprobantes-con-factura.html` (REAL) |

Pendiente antes de publicar (12.3): la captura REAL de la fila del listado buscando por número, el `manage_pedidos.php`
que carga la página y `_comprobantes.php` de la NP 1195. Si el campo `estado` de una NP anulada no es "0", se ajusta
`evaluarNpTraida` (falla cerrado: "No está activa en Zomatik").
