Respuestas de Zomatik para las pruebas del precio por m³ al programar (`lib/__tests__/zomatik-precio.test.mjs`,
docs/specs/2026-11-16-precio-en-programacion.md).

- `lista-10248.xlsx`: ARMADA A MANO (no es el archivo real) con la estructura que relevó Bautista el 16/11 en
  `exportar_lista.php?lista=10248` (sección 15.A de la spec): una hoja, filas 1–3 vacías, en la fila 4 el título
  (`Lista de precios N: 0   Fecha: 28/10/2026   Lista OCTUBRE 2026`, y en E `T.C: 1573.590`), y después por rubro una
  cabecera `Rubro | Precio` con una fila `Nombre | Precio` por artículo. Sin códigos de artículo: el cruce es por nombre.
  Los tres precios de hormigón son los reales (H21-620-10 C (CAN) = 176.500, el `costo` de la NP2 0001-00002086 del
  28/10). Lo demás es de relleno (un nombre con doble espacio, un rubro de servicios y un precio como texto).
- `listado-listas.html`: `listado_listas.php` armado con la estructura de `../zomatik-np/listas.html`: una sola lista
  activa (10248, OCTUBRE 2026) y dos invisibles.
