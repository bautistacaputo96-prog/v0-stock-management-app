Respuestas de Zomatik para `lib/__tests__/zomatik-z1.test.mjs` (Z1: OF + remito). Armadas con las capturas reales del
29/10/2026 en REBUCRET (sucursal 18, solo lectura, sin grabar; spec 26.9). Los valores (tokens, ids, clientes) son
de ejemplo; los nombres de los campos, el orden de las columnas y las respuestas son los capturados.

- `of-alta.html`: modificar_ordenfabricacion.php (form, depósitos, número, fecha_entrega = hoy + 2). Capturado.
- `of-manage.html`: la lista de manage_ordenfabricacion.php al agregar el artículo (H21-620-10 C (CAN), farticulo
  1000015959, depósito 116). Capturada: `codigo14850` / `cantidad14850` → fparam "14850,<cantidad>|||".
- `remito-alta.html`: modificar_remitos.php?pedido=N (frm_remitos; provincia_fiscal vacía, transporte sin marcar,
  número 0000-00000000). Capturado.
- `remito-pendientes.html`: "Continuar" (manage_remitos.php): un renglón por pendiente de la NP, con la cantidad
  PRECARGADA con todo lo pendiente. Capturado.
- `_validarnumeroremito.php` (en la prueba): "" libre, "… ya se encuentra utilizado", "… no esta cargado en el sistema".
