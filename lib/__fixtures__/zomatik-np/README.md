Respuestas de Zomatik para `lib/__tests__/zomatik-np.test.mjs` (Z2, nota de pedido).

- `detalle-articulo.html`: respuesta REAL de `manage_pedidos.php` al agregar el artículo (28/10/2026, capturada mientras
  Bautista cargaba a mano una NP2 de prueba, sin grabar). Un renglón con id 5349423: `codigo5349423` (hidden, id del
  renglón), `peso…`, `hcosto…`, `costo…`, `apallet…`, `palletcant…`, `cantidad…` (0.000), `coeficiente…`,
  `observacionesdetalle…`; 1.ª celda el código visible del artículo (10090020), 2.ª el nombre; borrar = `verificar(5349423)`;
  inputs sueltos `credito`, `compraactual`, `compraactualsib`, `totalacopio`.
- `detalle-vacio.html` ("Continuar") es la misma tabla sin el renglón. `renglon-np.html`, `detalle-proyecto*.html` están
  armados con ese mismo renglón real (otros ids, códigos y cantidades).
- El resto (alta, MATERIAL, listados, listas, `traerdatossecundarios`) está armado a mano con la estructura de los
  formularios relevados el 20/10 (solo lectura) y la prueba del 22/10 (spec 23). Sin datos de clientes reales salvo
  OBRA PROPIA REBUCRET, el de la prueba.
- `detalle-np-abierta.html`: el detalle REAL que carga la página de una NP grabada (157767, NP2 0001-00002086, 28/10):
  un renglón 5349424 (1 m³, $176.500), la celda OC con `AsignarNPDetalle(5349424)`, los sueltos con el crédito usado,
  `#totalneto` / `#totalcosto` ("Total: 176.500,00") y el bloque COMPROBANTES / OPERACIONES. La página
  `modificar_pedidos.php?codigo=N` no trae renglones: los pide con `pedidos=N` y su `pedidos_unico`.
- `material-576.html`: el MATERIAL del proyecto 576 (`modificar_pedidos.php?proyecto=576&tipo=1`) con los campos REALES,
  en su orden, como los capturó Bautista el 16/11 al hacer a mano la NP 0001-00001192 (cliente 22812, depósito por
  defecto PILAR 104, comprobante 15, número del proyecto 0001-00000030, origen 3, vendedor 101). El nombre y la dirección
  del cliente son de relleno. El comprobante va `disabled` (bloqueado, como se relevó el 22/10: un select solo se bloquea
  así), por eso el navegador no lo manda al grabar. `detalle-proyecto-576.html` es el Continuar con un renglón (506,9 m³).
- `material.html`: el número es `0001-00000014` (sin prefijo), como lo muestra el MATERIAL real.
