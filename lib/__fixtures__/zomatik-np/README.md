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
