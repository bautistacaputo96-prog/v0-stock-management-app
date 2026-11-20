Respuestas de Zomatik para `lib/__tests__/zomatik-z1.test.mjs` (Z1: OF + remito). Armadas con las capturas reales del
29/10/2026 en REBUCRET (sucursal 18, solo lectura, sin grabar; spec 26.9). Los valores (tokens, ids, clientes) son
de ejemplo; los nombres de los campos, el orden de las columnas y las respuestas son los capturados.

- `of-alta.html`: modificar_ordenfabricacion.php (form, depósitos, número, fecha_entrega = hoy + 2). Capturado.
- `of-manage.html`: la lista de manage_ordenfabricacion.php al agregar el artículo (H21-620-10 C (CAN), farticulo
  1000015959, depósito 116). Capturada: `codigo14850` / `cantidad14850` → fparam "14850,<cantidad>|||".
- `remito-alta.html`: modificar_remitos.php?pedido=N (frm_remitos; dirección, localidad, provincia, cp, cuit y
  provincia_fiscal vacías, transporte sin marcar, número 0000-00000000). Capturado.
- `remito-secundarios.txt`: traerdatossecundarios.php?fcliente=15893, respuesta real del 30/10 (la página toma de acá
  los datos del cliente).
- `remito-pendientes.html`: "Continuar" (manage_remitos.php): un renglón por pendiente de la NP, con la cantidad
  PRECARGADA con todo lo pendiente. Capturado.
- `_validarnumeroremito.php` (en la prueba): "" libre, "… ya se encuentra utilizado", "… no esta cargado en el sistema".
- `of-compo.html`: modificar_ordenfabricacioncompo.php?codigo=N, la pantalla "Composicion" de una OF (REAL 19/11, OF 8271
  de 1 m³): un `adescontar_<id>` por material. Capturada sin confirmar (la respuesta de "Continuar" no está).
- `remitosinternos-listado.html`: listado_remitosinternos.php (REAL 19/11, recortado a 4 filas): la columna OF dice a qué
  OF pertenece cada remito interno. La búsqueda por fechas (`?enviado=1`) no está capturada.
  Control del 20/11 sobre el listado real entero (las 150 filas, solo lectura; lo hizo el revisor): TODAS tienen la forma
  de las del fixture, todas dicen RECIBIDO, todas traen "OF 0001-0000NNNN", y las fechas vienen del más nuevo al más
  viejo sin ningún desorden. Por eso `rmiEnOrden` exige ese orden y un listado con otra forma va a "revisar".
