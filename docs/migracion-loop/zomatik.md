# Integración Rebucret ↔ Zomatik (cliente, nota de pedido, orden de fabricación y remito)

Estado: **relevamiento y propuesta del arquitecto (20/10/2026), con las respuestas de Bautista del 21/10/2026 (puntos 16 a 21; cada una manda sobre lo anterior). Maqueta aprobada el 21/10. Z0 (solo lectura) programada el 21/10 en `loop/zomatik`, sin publicar (ver "Hecho"). Nada cargado en Zomatik.** Quedan las preguntas de 20.9 y los pasos del punto 13 (y la prueba del jueves, 20.6). **Z2 (NP al programar) programada el 22/10 en `loop/zomatik`, sin aplicar ni prender: sección 24.**

Base: lo que contó Bautista el 20/10/2026 y un relevamiento **solo mirando** de `https://concretus.zomatik.com`, sucursal **REBUCRET**, hecho el mismo día con su usuario.

---

## 1. Objetivo

Que lo que hoy Fernando, Juan o Felipe cargan a mano en Zomatik salga **solo, desde nuestro sistema**, con la información que ya está cargada:

1. **Cliente:** se da de alta una sola vez, en nuestro sistema, y se crea igual en Zomatik. Antes, una **primera carga** trae los clientes de Zomatik del último año y los vincula con los nuestros.
2. **Nota de pedido:** al programar, queda creada (o vinculada) la nota de pedido de Zomatik.
3. **Remitir el día:** al final del día, con **un botón**, se crean en Zomatik las **órdenes de fabricación** (para el stock) y los **remitos** de lo que se despachó de verdad.

Zomatik sigue siendo el sistema de facturación, cuenta corriente y stock comercial. Nuestro sistema no factura.

---

## 2. Cómo se relevó (y qué no se tocó)

- Un solo login. Se eligió la sucursal REBUCRET (`selsuc=18`). Unas 150 lecturas con 350 ms de pausa.
- **Solo** se hicieron:
  - lecturas (GET) de menús, listados, formularios de alta vacíos y fichas de clientes;
  - búsquedas y exportaciones de listados (`?enviado=1`, con `exportar=1`).
- **No** se envió ningún formulario de alta ni de edición, ni se apretó "Continuar", ni se siguió ningún link de acción.
- Ojo: en Zomatik **hay GET que escriben**. El "Continuar" y el "Agregar artículo" de pedido, OF y remito llaman a `manage_*.php` por GET y arman el detalle en el servidor. Por eso tampoco se abrió el alta de remito "desde pedido" (`modificar_remitos.php?pedido=N`).
- Datos crudos (HTML, XLSX, JSON) en el scratchpad de la sesión, **fuera del repo**. En este documento van conteos y ejemplos recortados.
- Nuestra base se consultó solo para leer (`clients`, `formulas`, `dispatches`, `scheduled_dispatches`, `app_users`).

---

## 3. Mapa de Zomatik (rutas)

Todas cuelgan de `https://concretus.zomatik.com/`. Login: `POST index.php?a=1` (`usuario`, `clave`, `aceptar`). Sucursal: `POST home.php` con `selsuc` (18 = REBUCRET, 17 = RUTA 25 - CONCRETUS, 21 = SILKEBLOCK). Zomatik sirve en ISO-8859-1.

| Qué | Listado | Alta / ficha | Graba en |
|---|---|---|---|
| Clientes (Clientes › CLIENTES) | `listado_clientes.php` | `modificar_clientes.php` (alta); `?codigo=N` (ficha) | `POST grabar_clientes.php?codigo=0` |
| Notas de pedido (Clientes › PEDIDOS) | `listado_pedidos.php` | `modificar_pedidos.php`; impresión `imprimir_pedido.php?codigo=N` | `GET manage_pedidos.php?…` (detalle) + `POST grabar_pedidos.php?codigo=0` |
| Remitos de venta (Clientes › REMITOS) | `listado_remitos.php`; detalle por línea en `reporte_remitosventa.php` (ESTAD R.VENTA) | `modificar_remitos.php` (alta suelta); `modificar_remitos.php?pedido=N` (desde el pedido, link "REMITO" en pedidos pendientes) | `GET manage_remitos.php?…` (ítems pendientes) + `POST grabar_remitos.php?codigo=0` |
| Órdenes de fabricación (Fábrica › ORDENES DE FABRICACION) | `listado_ordenfabricacion.php` | `modificar_ordenfabricacion.php`; impresión `imprimir_ordenfabricacion.php?codigo=N` | `GET manage_ordenfabricacion.php?…` + `POST grabar_ordenfabricacion.php?codigo=0` |
| Artículos (Generales › PRODUCTOS) | `listado_articulos.php` (filtro `bus_linea`) | — | — |
| Listas (Clientes › LISTAS VENTAS) | `listado_listas.php`; contenido en `exportar_lista.php?lista=N` (XLSX) | — | — |
| Proyectos (Clientes › PROYECTOS) | `listado_proyectos.php` | — | — |
| Obras | `listado_obras.php` | — | — |
| Depósitos (Generales › DEPOSITOS) | `listado_depositos.php` | — | — |
| Comprobantes y talonarios (Parámetros › COMPROBANTES) | `listado_tipos_factura.php` | — | — |
| Vehículos y choferes (Transportes) | `listado_vehiculos.php`, `listado_choferes.php` | — | — |
| Vendedores | **No tienen pantalla en el menú.** Salen de los select de cliente y pedido, y del autocompletar | — | — |
| Condiciones de pago | **No tienen pantalla.** Son tres valores fijos del select | — | — |
| Pendientes de entrega | `reporte_entrega.php`, `reporte_pendientesentregadetallado.php` | — | — |

Ayudas de solo lectura que usan los formularios (útiles para el robot):
- `traerdatos.php?fbusca=…&ftabla=…&fcampoid=…&fcamponombre=…`: el autocompletar genérico (clientes, vendedores, listas, artículos, obras);
- `traerdatossecundarios.php?fcliente=N`: los datos del cliente que se copian al pedido y al remito (dirección, CUIT, condición de pago, vendedor…);
- `_validarcuit.php?fcuit=…&fcliente=0`: avisa si el CUIT ya existe;
- `_validarnumeroremito.php?fcomprobante=…&fnumero=…`: avisa si el número de remito está usado o fuera de talonario;
- `_getnumerofactura.php?fcomprobante=N`: el próximo número del comprobante. **No se llamó**: no está claro si reserva el número.

---

## 4. Formularios de alta

### 4.1 Cliente — `modificar_clientes.php` → `POST grabar_clientes.php?codigo=0` (multipart)

Obligatorios según el `validar()` de la página:
- `razon_social`, `provincia`, `clasificacion`, `categoria`, `tipo_iva`, `tipo_documento`, `cuit` y `condicioniibb`;
- además, el CUIT tiene que pasar `_validarcuit.php`, que avisa si está repetido;
- y, si es CUIT o CUIL, el dígito verificador. Si es DNI, que tenga entre 7 y 8 dígitos válidos.

Al salir del campo CUIT, Zomatik completa razón social, dirección, CP, localidad, IVA y provincia desde el padrón de AFIP (`_traerdatosafip.php`).

| Campo (`name`) | Tipo | Opciones reales |
|---|---|---|
| `cuit` * | texto | — |
| `tipo_documento` * | select | 1 CUIT · 2 CUIL · 3 DNI |
| `tipo_iva` * | select | 1 Consumidor Final · 2 Exento · 3 Responsable Inscripto · 5 Monotributo |
| `razon_social` * | texto | — |
| `apellido`, `nombre`, `telefono`, `direccion`, `localidad`, `cp`, `email`, `contacto`, `contacto_obra` | texto | — |
| `provincia` * | select | 1 Buenos Aires · 4 Capital Federal · … (24 provincias) |
| `credito` | texto | 0 |
| `alicuota0` | select | 0 No · 1 Sí |
| `clasificacion` * | select | 3 Casas · 7 Constructora · 1 Corralón · 8 Desarrolladora · 2 Edificios · 4 Marketing · 5 Mostrador · 10 Municipalidad · 6 Obra Particular · 9 Obra Privada · 11 Otros |
| `categoria` * | select | 1 A · 2 B · 3 C · 4 D |
| `condicion_pago` | select | 3 Anticipado · 2 Contado · 1 Cuenta Corriente (+ `condicion_dias`) |
| `vendedor` | select | 14 vendedores (ver 5.5) |
| `zona` | select | 1 CABA · 2 BS.AS. Norte · 3 BS.AS. Sur · 4 BS.AS. Oeste · 5 Interior BS.AS. · 6 Resto del país |
| `ib`, `condicioniibb` *, `ib_numero` | select/texto | condición IIBB: 1 IIBB Buenos Aires · 2 Convenio Multilateral · 3 Exento/Excluido |
| `idactividad`/`actividad`, `comentarios`, `email4..6` | — | — |
| `esproveedor`, `escorralon`, `reactivado` | select | No/Sí |
| `exportardeuda` | select | Sí por defecto |
| `estado` | oculto | 1 |

**El alta de cliente no tiene campo de sucursal:** el cliente queda en la sucursal de la sesión (REBUCRET).

### 4.2 Nota de pedido — `modificar_pedidos.php` → `manage_pedidos.php` (GET) + `POST grabar_pedidos.php?codigo=0`

Obligatorios según `validar()`:
- cliente (`idcliente`), vendedor (`idvendedor`), razón social, depósito, comprobante y número con formato `0000-00000000`;
- fecha de entrega y origen;
- si el origen es Lista, la lista; si es Acopio, el acopio.

| Campo | Qué es | Notas |
|---|---|---|
| `idcliente` / `cliente` | Cliente | Autocompletar de la tabla `clientes`. Al elegirlo, `traerdatossecundarios.php` copia razón social, dirección, localidad, provincia, CP, IVA, CUIT, mail, **condición de pago** y **vendedor del cliente** (salvo que el vendedor se haya cambiado a mano) |
| `razon_social`, `direccion`, `localidad`, `provincia`, `cp`, `tipo_iva`, `cuit`, `email`, `condicion_pago` | Copia editable del cliente | — |
| `idobra` / `obra`, `entregaren` | Obra de Zomatik y "entregar en" | **En REBUCRET no se usan:** la columna Obra está vacía en los 528 pedidos y 711 líneas de remito del año |
| `deposito` | Depósito | Viene marcado **PILAR (104)**: hay que cambiarlo siempre. Canning = 116, REBUCRET (Hudson) = 113 |
| `fecha_entrega` | Fecha de entrega | `aaaa-mm-dd` |
| `observaciones_entrega`, `observaciones` | Observaciones de entrega e internas | — |
| `comprobante` | 15 **Nota de Pedido** (NP) · 16 **Nota de Pedido 2** (NP2) | Al elegirlo, `_getnumerofactura.php` completa `numero` (solo lectura) |
| `origen` (radio) | 1 Lista · 2 Acopio · 3 Proyecto | — |
| `idlista` / `lista` | Lista | Autocompletar de `listas`, filtrable por las listas asignadas al cliente (`listas_x_cliente`). La elige el sistema solo, sin mostrarla (20.2) |
| `acopio`, `concolocacion` | Acopio y colocación | No aplican al hormigón |
| `idvendedor` / `vendedor` | Vendedor | **Obligatorio** |
| `fletemonto` | Valor unitario del flete | 0 |
| `idarticulo` / `articulo` | Artículo a agregar | Autocompletar de `articulos` |
| ítems | Uno por artículo: `codigo…`, `costo…`, `cantidad…`, `observacionesdetalle…` | Los arma `manage_pedidos.php` con lo que Zomatik trae por defecto. El ejemplo real dice "LOSA" o "Miércoles 32 m³ … Jueves 10 m³" |

Cómo graba (del JavaScript de la página):
1. `pedidos_unico` (oculto) es una clave de borrador que trae la página.
2. **"Continuar"** (`Crearpedido()`) y **agregar artículo** (`AddArticuloLista()`) llaman a `manage_pedidos.php?pedidos_unico=…&fcomprobante=…&fcliente=…&flista=…&farticulo=…` **por GET**. El servidor arma el detalle en borrador y devuelve la tabla de ítems.
3. **"Grabar"** manda el formulario completo a `grabar_pedidos.php?codigo=0`, con `fparam` = `codigo,costo,cantidad,observación|||` por ítem (el `costo` es el que trae Zomatik; el robot no lo toca).

### 4.3 Orden de fabricación — `modificar_ordenfabricacion.php` → `manage_ordenfabricacion.php` (GET) + `POST grabar_ordenfabricacion.php?codigo=0`

| Campo | Qué es | Notas |
|---|---|---|
| `idcliente` / `cliente` | Cliente | Opcional (la validación está comentada) |
| `deposito` * | Depósito | Opciones: Canning 116, MERCEDES 117, PILAR 104, RANCHOS 114, REBUCRET 113 |
| `fecha_entrega` | Fecha | Viene en **hoy + 2 días** |
| `observaciones` | Observaciones | — |
| `comprobante` * | 62 Orden de Fabricación | Ya viene elegido |
| `numero` * | Número | Ya viene completo: `0001-00003392` el 20/10 |
| `idarticulo` / `articulo` + ítems `codigo…`, `cantidad…` | Artículo (la fórmula) y m³ | Se agregan con `manage_ordenfabricacion.php` por GET |

El "segundo paso" que cuenta Bautista (depósito y fecha, **Continuar**, después artículo) es esto mismo: **"Continuar"** = `Crearordenfabricacion()` → `GET manage_ordenfabricacion.php?ordenfabricacion_unico=…&fcomprobante=62&fdeposito=…`, que arma la grilla de artículos. **No se tocó.** Lo que devuelve esa grilla (nombres de los campos de cantidad, si pide más datos) hay que verlo con Bautista (punto 13).

### 4.4 Remito de venta — `modificar_remitos.php` → `manage_remitos.php` (GET) + `POST grabar_remitos.php?codigo=0`

Obligatorios según `Validarremito()`:
- cliente, **provincia fiscal**, comprobante y número con formato `0000-00000000`, sin error del validador de número, fecha, transporte y depósito;
- la fecha no puede ser anterior a la de cierre, hoy `2025-10-01`;
- si el transporte es **de proveedor**, además chofer, vehículo, hora de salida y llegada, lote, dirección y localidad de entrega;
- **las cantidades no pueden superar lo pendiente del pedido y tiene que haber stock en el depósito**, salvo el depósito 99, ENTREGA DIRECTA. **Por eso hoy se carga una OF antes de remitir:** la OF le da stock al artículo de hormigón.

| Campo | Qué es | Notas |
|---|---|---|
| `idcliente` / `cliente`, `idobra` / `obra` | Cliente y obra | Al elegir el cliente se copian dirección, localidad, provincia, CP, CUIT y **condición de pago del cliente** |
| `razon_social`, `direccion`, `localidad`, `provincia`, `cp`, `cuit`, `condicion_pago` | Copia editable | — |
| `provincia_fiscal` * | Provincia fiscal | — |
| `comprobante` * | 7 **Remito** (RM, con factura) · 19 **Remito 2** (RM2, sin factura) | En REBUCRET el número **no se completa solo** (el código lo hace solo en otra sucursal) |
| `numero` * | Número | Se tipea. Se formatea a `0001-00002280`. `_validarnumeroremito.php` controla repetidos y talonario, y `_traerentregadoa.php` trae a quién se le entregó ese talonario |
| `entregadoa` | A quién se le entregó el talonario | Automático |
| `fecha`, `fentrega` | Emisión y entrega | Hoy por defecto |
| `observaciones`, `observacionesimp` | Internas e impresas | — |
| `entrega_localidad`, `entrega_direccion`, `lote` | Dónde se entrega | Obligatorios solo con transporte de proveedor |
| `tipo_viaje` | 3 Barrio · 1 Corto · 2 Largo · 5 No aplica · 4 Sale con otro remito | Se usó en 21 de 605 remitos |
| `deposito` * | Depósito | Canning 116 · REBUCRET 113 · … |
| `transporte` (radio) * | 1 **Transporte Local** · 2 Transporte Proveedor | — |
| `patente`, `acoplado` | Texto libre | — |
| `comision`, `comisionespecial`, `idflete`, `idchofer`, `idvehiculo`, `iddistancia`, `monto`, `hora_salida`, `hora_llegada` | Flete | Vehículos: solo "RETIRADO". Choferes: solo "Proveedor con flete incluido". No se usan |
| ítems | `hcantidad…` (pendiente), `cantidad…` (a remitir), `stock…`, `novalidarstock…` | Los trae `manage_remitos.php?fcliente=…&fobra=…&fcomprobante=…&fstdeposito=…&fpedido=…`: **los ítems pendientes de los pedidos del cliente** |

Cómo graba: **"Continuar"** = `MostrarItemsPendientes(0)` → `GET manage_remitos.php…` trae los pendientes. Después se completa la cantidad a remitir de cada uno y "Grabar" → `grabar_remitos.php?codigo=0`. Desde un pedido, el link es `modificar_remitos.php?pedido=N`. **No se abrió:** hay que ver con Bautista qué viene precargado.

---

## 5. Maestros reales

### 5.1 Depósitos
`listado_depositos.php`: TREXCIN, MERCEDES, **Canning (116)**, MATERIALES-PILAR, RANCHOS, **REBUCRET (113)**, CONSUMO INTERNO, SCRAP, Central, PILAR, ENTREGA DIRECTA PROVEEDOR (99), ARREGLOS SISTEMA.

En los pedidos y remitos del año de la sucursal REBUCRET:
- se usan **Canning** y **REBUCRET**;
- además, PILAR en 12 pedidos y TREXCIN en 3 remitos.

Por m³ (mayo–octubre 2026), REBUCRET se corresponde con **Hudson**:

| Depósito en Zomatik | m³ | Nuestra planta | m³ |
|---|---|---|---|
| Canning | 6.829 | Canning | 7.044 |
| REBUCRET | 1.341 | Hudson | 1.075 |

### 5.2 Comprobantes y talonarios
| Documento | Comprobante 1 (con factura) | Comprobante 2 (sin factura) |
|---|---|---|
| Nota de pedido | 15 "Nota de Pedido" → **NP 0001-…** | 16 "Nota de Pedido 2" → **NP2 0001-…** |
| Remito | 7 "Remito" → **RM 0001-…** | 19 "Remito 2" → **RM2 0099-…** |
| Orden de fabricación | 62 → 0001-… (una sola serie) | — |

`listado_tipos_factura.php` tiene los **talonarios de remito**, cada uno con un rango y a quién se le entregó. Por ejemplo:
- "REMITO 1 H" 0001 (2101–2400) y "REMITO 3B" 0099 (2501–2800), los dos de Fernando;
- "REMITO X" 0099 (1000–1999), de Juan;
- "Remitos R" 0002 (401–900) y "REmitos R (Temporales)" 0002 (307–400), los dos de Felipe.

**En el año no hay ningún remito con punto 0002:** los rangos "Remitos R" parecen un intento de cargar el talonario de papel que no se usó.

### 5.3 Listas (las elige el sistema solo; no se muestran)
- 29 listas. Hoy hay **dos activas**:
  - "Lista SEPTIEMBRE 26 **en 1** (013)" (código 10247, desde el 16/10/2026);
  - "Lista SEPTIEMBRE 26 **en 2** (013)" (código 10243, desde el 20/09/2026).
- "en 1" va con el comprobante 1 y "en 2" con el comprobante 2.
- **Cada 1 a 3 meses se crea un par nuevo** y el anterior pasa a invisible. Por eso no se puede guardar un id fijo: hay que buscar la lista activa más nueva "en 1" o "en 2".
- Además, hay listas asignadas por cliente (`listas_x_cliente`).

### 5.4 Proyectos
- 33 proyectos abiertos (26 PRO y 7 PRO2): contratos por obra de los clientes grandes, con saldo y certificaciones. Detalle en 16.1.
- **145 de los 527 pedidos del año salieron de un proyecto** (origen Proyecto), no de una lista.

### 5.5 Vendedores
Los del select (14), con su id:
- **100 Maldonado Fernando**, **101 Oreguy Juan**, **123 Calvo Felipe**;
- 115 Cuello Juan, 132 Grassi Gonzalo, 95 Ricci Nicolás, 105 Caviglione Santiago;
- y otros 7 de Concretus.

En los pedidos del año: Fernando 301, Juan 174, Felipe 50, otros 2. En nuestra tabla `app_users` están los tres: Fernando Maldonado, Juan Oreguy y Felipe Calvo.

### 5.6 Condiciones de pago
Tres valores fijos: 3 Anticipado · 2 Contado · 1 Cuenta Corriente (con días).

En las fichas de los clientes usados en el año **casi nunca está cargada** (121 de 124 vacías). Zomatik la copia del cliente al pedido y al remito, y se puede cambiar en cada uno.

### 5.7 Transporte
Radio "Transporte Local" / "Transporte Proveedor". En REBUCRET no hay vehículos ni choferes reales cargados. **Para nosotros: siempre Transporte Local** y la patente en texto libre.

### 5.8 Artículos (las fórmulas)
- Línea **Hormigón**: 64 artículos. **Hormigón (OBRAS)**: 1. **Servicios**: 16 (BOMBA PLUMA, BOMBA DE ARRASTRE, m3 BOMBEADOS, MACRO FIBRA, SUPERFLUIDIFICANTE S-PLUS, SERVICIOS DE LABORATORIO, ítems de obra y mano de obra).
- Los nombres de Zomatik llevan la planta al final: "H21-620-15 B **(HUD)**", "H30-620-10 C **(CAN)**". También hay viejos sin planta ("H-21 AC10", "H30 AC15").

---

## 6. Datos reales

### 6.1 Clientes de Zomatik (sucursal REBUCRET)
- **467 clientes**, todos activos. **125 tuvieron remitos en el último año** (21/10/2025–20/10/2026). De 124 se leyó la ficha completa; 4 nombres de pedidos no se encontraron tal cual en el listado.
- El export del listado **no trae el CUIT ni la condición de IVA**: hay que leer la ficha (`modificar_clientes.php?codigo=N`, solo lectura).

Qué se llena. Sobre los **467** del export:

| Campo | Lleno |
|---|---|
| Provincia, Clasificación, Categoría | 100 % |
| Vendedor | 89 % |
| Dirección | 27 % |
| Localidad | 24 % |
| CP | 24 % |
| Teléfono | 2 % |
| Email | 1 % |

Sobre las **124 fichas** usadas en el año:
- **Tipo de documento:** CUIT 80, DNI 28, CUIL 16.
- **Campo CUIT: 39 CUIT válidos (dígito verificador), 9 DNI y 76 con basura de 1 a 3 dígitos** (el campo es obligatorio y se completa con cualquier cosa).
- **IVA:** Responsable Inscripto 53, Consumidor Final 46, Exento 22, Monotributo 3.
- **Condición IIBB:** Buenos Aires 93, Convenio Multilateral 16, Exento 15.
- **Clasificación:** Casas 97, Edificios 17, Mostrador 4, Corralón 3, Constructora 2, Marketing 1.
- **Categoría:** A 107, B 12, C 2, D 3.
- **Zona:** BS.AS. Sur 109, vacía 9, otras 6.
- **Vendedor:** Fernando 90, Juan 17, Felipe 12, Juan Cuello 1, vacío 4.
- **Condición de pago:** vacía 121, Cuenta Corriente 2, Anticipado 1.
- **Datos de contacto:** dirección 30 %, localidad 23 %, CP 27 %, teléfono 2 %, mail 2 %.
- **Tipo de remito por cliente:** 98 solo X (RM2), 21 solo R (RM) y 6 los dos.

### 6.2 Nuestros clientes (`clients`)
- 89 (84 activos); 76 con despachos.
- **Condición de pago "Contado" en los 89. IVA: Responsable Inscripto en 85.**
- CUIT: 50 tienen algo, pero **solo 3 son CUIT válidos**. La mayoría son números de 4 dígitos ("21xx", "22xx"), puestos porque el alta lo exige.
- Dirección fiscal, localidad y CP vacíos en todos. Teléfono 17, mail 11.
- `remito_tipo` vacío en todos.
- Muchos nombres son de **obra o de persona + obra** ("… Barrio Parque", "FARIÑA", "HISTÓRICO").

### 6.3 Cruce de clientes
| Cómo coinciden | Nuestros clientes | De ellos, con despachos |
|---|---|---|
| Por CUIT (igual) | 7 | 4 |
| CUIT nuestro que contiene el DNI de Zomatik | 1 | 1 |
| Por nombre igual (sin tildes, S.A., ARQ, ING…) | 51 | 47 |
| Por nombre parecido (dudoso, hay que confirmar) | 7 | 4 |
| Están en Zomatik pero sin uso en el año | 4 | 4 |
| **Sin par** | **19** | 16 (incluye "HISTÓRICO", "FARIÑA", "INARCH" y 2 de prueba) |

- **El CUIT no sirve para vincular.** Hay 31 pares con el mismo nombre y CUIT distinto, porque en los dos lados hay CUIT de relleno.
- Desde Zomatik:
  - de los 124 clientes usados en el año, **74 no tienen par** en nuestra tabla;
  - de los **71 clientes con remitos desde el 13/04/2026** (cuando arrancaron nuestros despachos), **41 tienen par seguro**, que son **~90 % de los m³**.

### 6.4 Notas de pedido (último año)
- **527 notas**: NP 217 · NP2 306 · devoluciones 4.
  - **Estado:** remitidas 501 y **26 pendientes**; la más vieja es del 29/10/2025, así que hay pendientes que nadie cierra.
  - **Origen:** Lista 380 y Proyecto 145.
  - **Depósito:** Canning 355, REBUCRET 157, PILAR 12 y TREXCIN 3.
- **Se cargan el mismo día o después de entregar.** En 238 la fecha de entrega es igual a la del pedido y en 213 es **anterior**. O sea: hoy el pedido de Zomatik **no se carga cuando se programa**, se carga para poder remitir.
- **521 pedidos tienen remito.** 487 tienen **uno solo**, 24 tienen 2 y 10 tienen entre 3 y 18 (obras largas). Por ejemplo, un NP tiene 17 remitos de 3 a 16 m³ entre noviembre y abril.
- Un pedido puede tener varios renglones y observaciones por renglón ("Miércoles 32 m³ de H25 / Jueves 10 m³ de H21"), o sea, **varios días en un pedido**.

### 6.5 Remitos (último año): ¿por camión o por pedido?
- **608 remitos** (RM 277 · RM2 331) y **711 renglones**. 555 tienen un solo renglón y 50 llevan un renglón de bombeo.
- **m³ por remito:** hasta 8 m³, 256; de 9 a 16, 123; de 17 a 40, 107; **más de 40, 122**. Mediana 11,5 m³; máximo 601 m³.
- **Numeración:**
  - RM `0001-0000xxxx`: en el año, del 1796 al 2337;
  - RM2 `0099-0000xxxx`: del 2055 al 2743;
  - los números se tipean y **no son cronológicos**.
- **Cruce con nuestros despachos (01/05–19/10/2026):**

  | | Remitos | m³ |
  |---|---|---|
  | Zomatik | **302** | **8.169** |
  | Nuestro sistema | **1.149** despachos | **8.118** |

  - Mes a mes los m³ dan parecido: junio 1.612 contra 1.783; septiembre 2.220 contra 2.068.
  - **El número del remito de papel no está en Zomatik:** coinciden 2 de 1.149, por casualidad. Nuestros R van por el 700–900 y los X por el 3100–3300 (talonario de imprenta `00002-…`). Zomatik va por RM 0001-00002xxx y RM2 0099-00002xxx.
  - En 87 combinaciones cliente-día con remito en los dos lados, **en 55 los m³ de Zomatik son exactamente la suma de los camiones de ese cliente en el día**.
  - Los demás son remitos que juntan **varios días**: el 27/05 hay un remito de 300 m³ contra 56 despachados ese día, y 29 remitos se emitieron más de 3 días después del despacho.
- **Remito → factura:**
  - RM: FA 153, FB 33, FCEA 19 y sin factura todavía 135;
  - RM2: **F2** 335 y sin factura 32. El comprobante 2 también se "factura" con un F2 interno.

**Conclusión: hoy un remito de Zomatik no es un camión.** Es **lo entregado a un cliente en el día, por pedido y tipo (R o X)**, y a veces junta varios días atrasados. El número no es el del papel.

### 6.6 Órdenes de fabricación (último año)
- **558 OF**, casi todas de un artículo (557), en los depósitos Canning y REBUCRET.
- m³ en OF: **13.826**; m³ remitidos de hormigón: 13.975. **Hay una OF por cada remito o artículo**, más o menos el mismo día. Se hace para tener stock y poder remitir.

### 6.7 Artículos contra nuestras fórmulas
- **Nuestras 67 fórmulas** (34 Canning y 33 Hudson):
  - **11 coinciden por nombre exacto**;
  - **17 coinciden con reglas**: a Hudson le falta el " (HUD)", "6/12" se escribe "612", "GUN" es "GUNITADO" y "PELQUE" va después de la planta;
  - **39 sin par**: H25-620-10 C, las 6/12 y 6/20, RDC-200/300, Cordones, Pavimento, H4-RECUPERADO, H35 de Canning y otras.
- Medido en m³ despachados (mayo–octubre), **77 % sale con una fórmula que tiene par**.
- Hay artículos de Zomatik usados en el año que son casi seguro una fórmula nuestra con otro nombre:
  - H40-612-15 B (CAN), 436,5 m³ ↔ "H40-6/12-15";
  - H17-620-15 B (CAN), 522 m³ ↔ "H17-6/20 B";
  - RDC MORTERO 300 ↔ "RDC-300".

  **El vínculo tiene que ser una tabla confirmada a mano**, no una regla de nombre.
- **Despachos cruzados:** a veces Hudson despacha una fórmula de Canning ("H30-620-10 C (CAN)" desde Hudson, 145 m³). El artículo y el depósito tienen que salir de la **planta que despachó**, no del sufijo.

---

## 7. Mapeo campo por campo

### 7.1 Cliente (nuestro `clients` → alta de Zomatik)
| Nuestro | Zomatik | Regla |
|---|---|---|
| `razon_social` (o `name`) | `razon_social` | Mayúsculas como hoy |
| `cuit` | `cuit` + `tipo_documento` | 11 dígitos válidos → CUIT (1). 7–8 dígitos → DNI (3). Si no es válido, **no se manda** y se le pide al usuario (ver 14.3) |
| `cond_iva` | `tipo_iva` | Responsable Inscripto → 3 · Monotributista → 5 · Consumidor Final → 1 · Exento → 2 · No Responsable → **sin equivalente** (pregunta 14.4) |
| `direccion_fiscal` | `direccion` | — |
| `localidad_cliente` | `localidad` | — |
| `provincia` | `provincia` | Texto → id. Por defecto Buenos Aires (1) |
| `cp` | `cp` | — |
| `phone` / `email` / `contact` | `telefono` / `email` / `contacto` | — |
| `cond_pago` | `condicion_pago` | Contado → 2 · Cuenta Corriente → 1 · Anticipado → 3 |
| — (nuevo) | `clasificacion` * | Por defecto **Casas (3)**, que es lo más usado. Elegible en el alta |
| — (nuevo) | `categoria` * | Por defecto **A (1)** |
| — (nuevo) | `condicioniibb` * | Por defecto **IIBB Buenos Aires (1)** |
| — (nuevo) | `zona` | Por defecto **BS.AS. Sur (3)** |
| usuario que carga | `vendedor` | Fernando → 100 · Juan → 101 · Felipe → 123 (pregunta 14.5) |
| `remito_tipo` | — | En Zomatik no es del cliente: es el comprobante del pedido y del remito |
| `construction_sites` | — | En REBUCRET no se usan obras de Zomatik. La obra va como texto en las observaciones |
| fijos | `alicuota0` = 0, `exportardeuda` = 1, `credito` = 0, `estado` = 1, `escorralon`/`esproveedor`/`reactivado` = 0 | — |

### 7.2 Nota de pedido (nuestro pedido programado → NP de Zomatik)
| Nuestro | Zomatik | Regla |
|---|---|---|
| `scheduled_dispatches.client_id` → `clients.zomatik_codigo` | `idcliente` | Sin cliente vinculado no se crea: se avisa |
| `plant_id` | `deposito` | Canning → 116 · Hudson → 113 (REBUCRET) |
| `remito_tipo` (R/X), resuelto como en la Fase 3 (pedido, obra, cliente) | `comprobante` 15/16, `origen` = 1 (Lista) y `idlista` = la activa más nueva "en 1" o "en 2" | Si el cliente tiene **proyecto** en Zomatik, `origen` = 3 y el proyecto (pregunta 14.7) |
| `formula_id` → `formulas.zomatik_articulo_codigo` | ítem: artículo | El resto lo completa Zomatik por defecto |
| `quantity_m3` | ítem: cantidad | — |
| Bomba (`bomba_la_pone`, `metodo_descarga`) | ítem extra "m3 BOMBEADOS", "BOMBA PLUMA" o "BOMBA DE ARRASTRE" | Solo si Rebucret cobra el bombeo (pregunta 14.8) |
| fecha de `scheduled_arrival_time` | `fecha_entrega` | `aaaa-mm-dd` |
| obra (nombre y dirección), `finalidad`, `observations` | `observaciones_entrega` y `observacionesdetalle` del ítem | Más la marca `[RBC p:<id corto>]` en `observaciones` internas (ver 10) |
| usuario que programa | `idvendedor` | Pregunta 14.5 |
| `cond_pago` del cliente | `condicion_pago` | — |

### 7.3 Orden de fabricación (lo despachado → OF)
| Nuestro | Zomatik |
|---|---|
| Planta que despachó | `deposito` (116 o 113) |
| Día | `fecha_entrega` |
| Fórmula despachada → artículo | ítem: artículo |
| Suma de m³ de los despachos de ese día, planta y artículo | ítem: cantidad |
| Marca `[RBC of:<fecha>-<planta>-<artículo>]` | `observaciones` |

### 7.4 Remito (lo despachado → RM o RM2)
| Nuestro | Zomatik | Regla |
|---|---|---|
| Cliente del despacho → `zomatik_codigo` | `idcliente` | — |
| Nota de pedido vinculada | ítems pendientes de esa NP (`fpedido`) | — |
| `dispatches.remito_tipo` R/X | `comprobante` 7/19 | — |
| — | `numero` | **El siguiente de la serie en Zomatik**: el mayor de `listado_remitos` + 1, validado con `_validarnumeroremito.php`. No es el número del papel (pregunta 14.2) |
| Fecha del despacho (`dispatch_date`) | `fecha`, `fentrega` | — |
| Planta | `deposito` | — |
| Suma de m³ del cliente, día, pedido, tipo y artículo | `cantidad…` | — |
| Patentes de los camiones (`mixers.license_plate`) | `patente` | Si hubo un solo camión, su patente. Si fueron varios, "VARIOS" y la lista en observaciones |
| Números de los remitos de papel y obra | `observacionesimp` | Por ejemplo, "Remitos 884, 885, 887 · Obra …". Así se puede cruzar con el papel |
| Provincia del cliente o de la obra | `provincia_fiscal` | Buenos Aires por defecto |
| — | `transporte` = 1 (Local), `tipo_viaje` vacío | — |
| `cond_pago` del cliente | `condicion_pago` | — |
| Marca `[RBC r:<id corto>]` | `observaciones` | — |

---

## 8. Propuesta de flujo

```
Cliente ──(alta en nuestro sistema)──> Zomatik: cliente (una vez)
Programación ──(al guardar el pedido del día)──> Zomatik: NP nueva, o vínculo con una NP abierta
Despacho (Titan, remito de papel R/X)  ──  no toca Zomatik
Fin del día: "Remitir el día" (un botón) ──> Zomatik: OF por planta y artículo → RM/RM2 por cliente y pedido
```

### 8.1 Cliente
- **Alta nueva:** en el alta de nuestro sistema se agregan los campos que Zomatik exige y hoy no tenemos:
  - documento (CUIT o DNI) **validado**, con el dígito verificador;
  - provincia, clasificación y condición IIBB, con los valores por defecto del 7.1.
- Al guardar se crea el cliente en Zomatik: antes se pregunta `_validarcuit.php` y se busca por nombre, para no duplicarlo.
  - Si Zomatik rechaza el alta, el cliente queda igual en nuestro sistema con "Pendiente en Zomatik" y el motivo.
  - **Despachar no se frena nunca por Zomatik.**
- **Editar un cliente** en nuestro sistema no cambia Zomatik en la primera versión: se avisa "Cambiá también en Zomatik". Así hay menos escrituras riesgosas.

### 8.2 Nota de pedido (al programar)
Cuando se guarda un pedido programado con cliente vinculado:
- **Opción por defecto: NP nueva por pedido programado.** Es lo que pasa hoy en 487 de cada 521 casos: un pedido, un remito.
  - Se crea en segundo plano y la tarjeta muestra "NP2 0001-00002079 ✓".
  - Si el pedido programado se cambia (m³, fórmula, fecha) **antes de remitir**, la NP no se edita sola: queda "NP desactualizada" y al remitir se usa lo despachado. Lo pendiente que sobre lo cierra Zomatik al remitir de menos, o se avisa (pregunta 14.6).
- **"Usar una NP que ya existe"** (obras largas, proyectos): un selector muestra las NP **pendientes** del cliente en Zomatik, leídas de `listado_pedidos.php` (PEND) y de los pendientes de entrega.
  - Se elige una, no se crea nada y se recuerda para los próximos pedidos de esa obra.
  - El remito del día va contra esa NP mientras le quede pendiente.
- **Pedidos chicos que no se programan:** si un despacho no tiene pedido programado, al remitir el día se crea la NP en ese momento, como hoy.

### 8.3 Despacho
**No cambia.** Titan despacha con el remito de papel R o X como en la Fase 3. Para que el día se pueda remitir solo, el despacho necesita cliente, fórmula y tipo R/X; eso ya lo pide la Fase 3.

### 8.4 "Remitir el día" (Juan, Felipe o Fernando, un botón)
Pantalla "Remitir a Zomatik", por planta y fecha (o "todo lo no remitido"):

1. **Vista previa:** una fila por **cliente + NP + tipo + artículo**, con m³, camiones y remitos de papel. Se marcan los problemas:
   - cliente sin vincular;
   - fórmula sin artículo;
   - despacho sin R/X;
   - NP sin pendiente suficiente.

   Los problemas se arreglan desde ahí, con un link al cliente o a la fórmula.
2. **Remitir:**
   - Crea **una OF por planta y artículo** con los m³ del día. Es más simple que hoy y deja el mismo stock; ver pregunta 14.9.
   - Después crea **un remito por fila agrupada** contra su NP: número siguiente de la serie, patente y remitos de papel en las observaciones.
   - Cada paso se guarda apenas termina. Si algo falla, lo que salió bien queda remitido y lo que falló queda en rojo con el motivo y **"Reintentar"**.
3. **Resultado:** "5 remitos creados (RM 0001-00002338…), 2 OF, 1 con error: el cliente X no está vinculado".
   - Cada despacho queda marcado con el remito de Zomatik.
   - Un despacho remitido **no se puede editar** sin permiso. Si se edita, queda "remitido, revisar en Zomatik".

**Cierre del día (Fase 5):** "Remitir el día" es la primera pieza del cierre. Cuando esté la Fase 5, el botón queda adentro del cierre.

---

## 9. Modelo de datos propuesto (no aplicado)

Todo **se agrega**; no se cambia ni se borra nada de lo cargado.

| Dónde | Qué | Para qué |
|---|---|---|
| `clients` | `zomatik_codigo int unique`, `zomatik_estado text` (`sin_vincular`, `vinculado`, `pendiente`, `error`), `zomatik_error text`, `zomatik_sync_at timestamptz`, `tipo_documento text`, `clasificacion text`, `condicion_iibb text`, `zona text` | Vínculo y datos que exige Zomatik |
| `formulas` | `zomatik_articulo_codigo int`, `zomatik_articulo_nombre text` | Vínculo confirmado a mano (6.7) |
| `plants` | `zomatik_deposito_id int` (Canning 116, Hudson 113) | — |
| `app_users` | `zomatik_vendedor_id int` (Fernando 100, Juan 101, Felipe 123) | Pregunta 14.5 |
| `zomatik_pedidos` (nueva) | `id`, `client_id`, `plant_id`, `comprobante` (1/2), `zomatik_codigo int` (id interno, por ejemplo 157672), `numero text` (por ejemplo "NP2 0001-00002078"), `origen` (lista/proyecto), `m3_pedidos`, `estado` (`creando`, `ok`, `error`, `verificar`, `cerrado`), `error`, `marca text unique`, `creado_por`, `created_at` | Una NP de Zomatik, creada por nosotros o vinculada |
| `scheduled_dispatches` | `zomatik_pedido_id uuid` → `zomatik_pedidos` | Varios pedidos programados pueden ir a la misma NP |
| `zomatik_remitos` (nueva) | `id`, `fecha`, `plant_id`, `client_id`, `zomatik_pedido_id`, `comprobante`, `numero`, `zomatik_codigo`, `m3`, `estado`, `error`, `marca unique`, `creado_por`, `created_at` | Un RM/RM2 |
| `dispatches` | `zomatik_remito_id uuid` → `zomatik_remitos` | Qué despacho quedó en qué remito. Un despacho, un remito |
| `zomatik_ofs` (nueva) | `id`, `fecha`, `plant_id`, `formula_id`, `zomatik_articulo_codigo`, `m3`, `numero`, `zomatik_codigo`, `estado`, `error`, `marca unique` | Las OF |
| `zomatik_operaciones` (nueva) | `id`, `tipo` (cliente, pedido, of, remito, lectura), `entidad_id`, `paso`, `estado`, `intentos`, `request_resumen jsonb` (sin claves), `respuesta_resumen text`, `error text`, `usuario`, `created_at` | Bitácora de cada request que escribe en Zomatik, para auditar y reintentar |
| `integraciones` (existe, la usa B-Track) | La sesión de Zomatik (cookie) se guarda ahí mientras dure | Para no hacer un login por request |

Credenciales: `ZOMATIK_USER` y `ZOMATIK_PASS` en Vercel (proyecto Rebucret), igual que en Concretus. Mejor un **usuario propio para el robot** (pregunta 14.10).

Código:
- `lib/zomatik/` en Rebucret: una copia de las lecturas de `lib/zomatik.ts` de Concretus (login, `setSucursal`, export, `parseHtmlTable`), más las escrituras paso por paso;
- rutas de servidor `app/api/zomatik/{cliente,pedido,remitir-dia}`;
- nada de esto corre en el navegador.

---

## 10. Sin duplicar, con reintento y con errores a la vista

**No duplicar:**
- **Marca propia en cada documento:** `[RBC r:ab12cd]` en `observaciones` de NP, OF y remito. Antes de crear, se busca la marca en el listado del día (`listado_pedidos`, `listado_remitos`, `listado_ordenfabricacion` en HTML, con la fecha filtrada). Si ya está, se toma ese documento y no se crea otro.
- **Cliente:** antes del alta, `_validarcuit.php` (si hay CUIT válido) y búsqueda por nombre con `traerdatos.php`. Si hay un parecido, **no se crea**: se pide confirmar "¿es este?".
- **Una sola operación a la vez por documento:** estado `creando` con fecha. Un segundo clic o un segundo usuario ve "en curso".
- **Remito:** `dispatches.zomatik_remito_id` impide remitir dos veces el mismo despacho. El número se valida con `_validarnumeroremito.php` justo antes de grabar.

**Reintentar:**
- Si Zomatik contesta con error claro (por ejemplo, el `alert` de validación o "No se dispone de suficiente stock"), queda `error` con el texto y se reintenta a mano.
- Si se corta (timeout, sin respuesta), queda **`verificar`**. **Nunca se reintenta solo un "grabar":** primero se busca la marca. Si está, `ok`; si no, se puede reintentar.
- **El login no se reintenta en bucle:** si falla dos veces, se para todo y se avisa a Bautista. Si no, se puede bloquear el usuario.

**Cómo se ve un error:**
- En la tarjeta del pedido o en la fila del remito, en rojo y en castellano: "Zomatik no aceptó el remito: no hay stock de H21-620-15 B (HUD) en Canning".
- Con **"Reintentar"** y **"Ver en Zomatik"** (link a la NP o al remito si existe).
- Un aviso por WhatsApp o mail a quien remitió si "Remitir el día" terminó con errores.
- La bitácora completa en `zomatik_operaciones`, visible para los gerenciales.

---

## 11. Primera carga de clientes

1. **Leer** de Zomatik los clientes con pedidos o remitos en los últimos 12 meses (hoy 125), con su ficha (CUIT, IVA, dirección, vendedor, clasificación) y el tipo de remito que usaron (R, X o los dos).
2. **Proponer vínculos** en una pantalla de revisión, con nuestros 89 clientes:
   - "seguro": CUIT válido igual, o nombre igual sin tildes ni S.A.;
   - "dudoso": nombre parecido;
   - "sin par".

   Hoy darían ~59 seguros, 7 dudosos y 19 sin par.
3. Bautista (o Juan) **confirma** los dudosos, elige "es otro" o vincula a mano. Los de prueba ("asdas", "ads") se dan de baja aparte, no en esta carga.
4. Los clientes de Zomatik **sin par** (~74 del año) se **crean** en nuestra tabla con:
   - `zomatik_codigo` y razón social;
   - IVA y CUIT, solo si es válido;
   - dirección si la hay;
   - y `remito_tipo` sugerido: "siempre X" si en el año solo usó RM2 (98 clientes), "siempre R" si solo usó RM (21). Con los dos, queda vacío.
5. Para los vinculados:
   - **no se pisa** lo nuestro;
   - **se completa** lo vacío: dirección, localidad, CP e IVA;
   - y se propone reemplazar el CUIT nuestro inválido por el válido de Zomatik.
6. Nada se escribe en Zomatik en esta carga. Se corre una vez con un script, que primero se muestra en un "simulacro" con los conteos, y después queda en la pantalla para los que vayan apareciendo.

---

## 12. Riesgos

| Riesgo | Qué hacemos |
|---|---|
| **No hay API.** Se automatiza la pantalla: si Zomatik cambia un formulario (un nombre de campo, un paso nuevo), la integración se rompe | Antes de escribir, cada paso **lee el formulario y verifica los campos esperados**. Si falta uno, para con "Zomatik cambió el formulario de remito" y no manda nada. Pruebas de humo de solo lectura cada mañana |
| **El detalle se arma con GET que escriben** (`manage_*.php`) y un borrador del lado del servidor (`*_unico`) | Seguir exactamente la secuencia del navegador, un documento a la vez, y no dejar borradores a medio armar. Si un paso falla, se descarta el borrador (nunca se reutiliza la clave) |
| Duplicados por cortes de red | Marca `[RBC …]` + estado `verificar` + búsqueda antes de reintentar (10) |
| **Stock:** el remito exige stock del artículo en el depósito | Siempre la OF primero. Si falta stock, el error es claro y se puede reintentar después de la OF |
| Numeración de remito tipeada y no cronológica en Zomatik; talonarios con rango | El robot toma el **mayor de la serie + 1** y lo valida con `_validarnumeroremito.php`. Si una persona remite a mano al mismo tiempo, la validación lo frena y se toma el siguiente |
| Las listas cambian cada 1–3 meses | Se busca la lista activa más nueva "en 1" o "en 2" en cada pedido. Si hay más de una activa del mismo tipo, se frena y se avisa |
| Proyectos (PRO): 145 pedidos al año van contra un proyecto | El vínculo cliente/obra ↔ proyecto lo elige una persona. Sin proyecto, se usa la lista |
| Clientes sin CUIT válido en Zomatik (76 de 124) | El robot no inventa CUIT. Un alta nueva exige CUIT o DNI válido |
| Sesión: Zomatik filtra por la sucursal activa; el depósito del pedido viene en PILAR | `setSucursal(REBUCRET)` al empezar y depósito siempre explícito |
| Usuario bloqueado por muchos logins | Un login por tanda, la cookie se reutiliza y nunca se reintenta en bucle |
| Tiempo de las funciones en Vercel | Remitir un día: ~5–15 documentos × 4–6 requests con pausa. Se procesa **un documento por llamada** desde la pantalla (barra de progreso), no todo en una función larga |
| Facturación: el remito es la base de FA/F2 | El remito lleva lo despachado de verdad; Zomatik factura como hoy |
| Seguridad de Zomatik: `traerdatos.php` recibe la tabla y el filtro desde el navegador | Lo usamos solo como lo usa la página. Conviene contárselo al proveedor de Zomatik |
| Edición o borrado de despachos ya remitidos | Bloqueado sin permiso. Si se fuerza, queda marcado "revisar en Zomatik" (no se anula solo) |

---

## 13. Para mirar con Bautista en Zomatik (en una sesión juntos, con un caso real)

1. **OF, segundo paso:** apretar "Continuar" con depósito Canning, y ver la grilla que devuelve `manage_ordenfabricacion.php` (campos de cantidad, si pide lote) y qué hace "Grabar".
2. **Remito desde el pedido:** abrir `modificar_remitos.php?pedido=N` de una NP pendiente y ver qué viene precargado (cliente, comprobante, condición de pago, ítems).
3. **NP:** el "Continuar" y "Agregar artículo": confirmar que Zomatik completa solo el ítem y que el robot manda solo artículo y cantidad.
4. **Respuesta de "Grabar"** de cada documento: ¿redirige a la ficha con el código nuevo? Lo necesitamos para guardar `zomatik_codigo`.
5. **Remitir de menos:** si la NP tenía 40 m³ y se remiten 38, ¿queda pendiente 2 m³ o se cierra? ¿Cómo la cierran hoy? Hay 26 NP pendientes desde 2025.
6. **Stock:** si la OF del día ya cubre lo remitido, o si hay que fabricar por remito.
7. Ver el comportamiento de `_getnumerofactura.php`: ¿reserva el número de NP u OF al pedirlo?

---

## 14. Preguntas para Bautista (cada una con la recomendación) — respondidas en parte el 21/10, ver 16

1. **¿El remito de Zomatik es por camión o por día?**
   - Hoy es por **cliente y día** (302 remitos contra 1.149 camiones desde mayo), con un número propio de Zomatik.
   - **Recomendación:** seguir igual. Un remito por cliente + NP + tipo + día, con los números de papel en las observaciones. Por camión serían 4 veces más remitos y el número igual no coincidiría con el papel.
2. **¿El número del remito en Zomatik tiene que ser el del papel?**
   - Hoy no lo es (Zomatik RM 0001-00002xxx; papel R 0002-…8xx y X 00002-…33xx).
   - **Recomendación:** no. Zomatik sigue con su serie (el robot toma la siguiente) y el papel queda en observaciones. Si el contador quiere que coincidan, hay que pasar a remito por camión y cargar los talonarios de papel en Zomatik. Es otra fase.
3. **Clientes sin CUIT válido** (la mayoría, en los dos sistemas): ¿se exige CUIT o DNI válido en el alta?
   - **Recomendación:** sí, para los nuevos (Zomatik lo pide igual). Para los viejos, completar de a poco con el CUIT válido de Zomatik cuando exista.
4. **"No Responsable"** (1 cliente nuestro) no existe en Zomatik.
   - **Recomendación:** sacarlo de nuestras opciones y mapear a Consumidor Final o Exento según el caso, con la ayuda del contador.
5. **Vendedor del pedido: ¿quien carga, o el vendedor del cliente?** Zomatik pone por defecto el del cliente (Fernando en 90 de 124), y el vendedor manda en las comisiones.
   - **Recomendación:** el **vendedor del cliente**. Si no tiene, quien programa (Fernando 100, Juan 101 o Felipe 123).
6. **NP: ¿una por pedido programado, o una por obra que se va remitiendo?**
   - **Recomendación:** una por pedido programado por defecto (es lo que pasa hoy). En obras largas o con proyecto, "usar una NP existente", elegida una vez por obra.
   - Si se despacha menos que lo pedido, se remite lo despachado y la NP se **cierra** (pendiente de confirmar en 13.5).
7. **Proyectos (PRO):** ¿los pedidos de clientes con proyecto van siempre contra el proyecto?
   - **Recomendación:** sí. En la obra se elige el proyecto de Zomatik una vez y el pedido sale con origen Proyecto. Sin proyecto, sale como NP común.
8. **Bombeo:** las bombas son de terceros, pero 50 remitos del año llevan "m3 BOMBEADOS" o "BOMBA PLUMA". ¿Rebucret cobra el bombeo en el remito?
   - **Recomendación:** si la bomba la pone Rebucret (`bomba_la_pone`), sumar el renglón "m3 BOMBEADOS" con los m³ del pedido. Si la pone el cliente, no.
9. **OF: ¿una por día, planta y artículo, o una por remito como hoy?**
   - **Recomendación:** una por día, planta y artículo. Es menos carga y da el mismo stock. Si contaduría necesita la OF por remito, se cambia sin tocar el resto.
10. **Usuario de Zomatik para el robot:** ¿se puede pedir al proveedor un usuario "Rebucret Sistema" con permisos de cliente, pedido, OF y remito?
    - **Recomendación:** sí. Así se distingue en Zomatik qué cargó el sistema y no se mezcla con el tuyo.
11. **Clasificación, categoría, IIBB y zona** de los clientes nuevos.
    - **Recomendación:** por defecto Casas, A, IIBB Buenos Aires y BS.AS. Sur (lo más común), con un desplegable en el alta para cambiarlos.
12. **¿Quién aprieta "Remitir el día" y cuándo?**
    - **Recomendación:** Juan, Felipe o Fernando (permiso nuevo `zomatik.remitir`), al cierre de cada día.
    - El sistema avisa a la mañana siguiente si quedó un día sin remitir.
    - Editar un despacho ya remitido queda solo para gerenciales.
13. **Edición de clientes:** ¿los cambios en nuestro sistema tienen que pasar a Zomatik?
    - **Recomendación:** no en la primera versión. Se avisa "cambiá también en Zomatik". Se suma después si hace falta.
14. **Primera carga:** ¿traemos solo los clientes del último año (125) o todos (467)?
    - **Recomendación:** solo los del último año. Los demás se vinculan cuando vuelvan a comprar: el alta busca primero en Zomatik.

---

## 15. Orden sugerido de trabajo (cuando Bautista apruebe)

1. **Z0 (S):** lecturas.
   - Cliente de Zomatik en Rebucret (copia de lo de Concretus).
   - Vínculo de fórmulas ↔ artículos (pantalla de confirmación) y plantas ↔ depósitos.
   - Primera carga de clientes (punto 11).
   - Sin escribir en Zomatik.
2. **Z1 (M):** "Remitir el día" (OF + remito) contra NP existentes y creando la NP en el momento (como hoy). Es lo que más trabajo ahorra.
3. **Z2 (S):** NP al programar (punto 8.2).
4. **Z3 (S):** alta de cliente en Zomatik desde nuestro alta.

Antes de Z1, la sesión del punto 13 con Bautista. Las primeras corridas de Z1 se hacen **con Bautista mirando** y con el día de Zomatik revisado a mano.

---

## 16. Respuestas de Bautista (21/10/2026) — mandan sobre lo anterior

Si algo de los puntos 1 a 15 contradice esta sección, vale esta sección.

**Lo que dijo Bautista:**
1. Las notas de pedido también salen de **Clientes › Proyectos** (botón "Material" en Acciones), o eligiendo **Origen = Proyecto** en el alta del pedido. Así se descuenta de un proyecto.
2. Al programar, en nuestro sistema se puede:
   - (a) **generar la nota de pedido**;
   - (b) **generar un acopio** (proyecto) para una obra larga;
   - (c) **programar desde un pedido o acopio que ya existe** en Zomatik.
3. **El número de remito en Zomatik no tiene que coincidir con el del papel:** va la serie propia de Zomatik. Esto cierra la pregunta 14.2.
4. Remito y OF:
   - (a) **se remite solo** cuando se da por finalizada la programación del día de ese pedido;
   - (b) la OF puede ser automática al final del día, por tipo de hormigón, para ajustar el stock;
   - (c) "si se remite cada despacho podemos poner la patente del camión real".
5. **Clientes nuevos:** se dan de alta en nuestro sistema y se crean en Zomatik. Confirmado.
6. Pregunta suya: **¿qué pasa si se busca un cliente que no está en nuestro sistema pero sí en Zomatik?** Ver 16.5.
7. **Vendedor:** el del cliente en Zomatik. Confirmado; cierra la pregunta 14.5.

### 16.1 Proyectos, "Material" y Origen (relevado el 21/10, solo lectura)

**Qué es un proyecto.**
- Clientes › PROYECTOS = `listado_proyectos.php`. Hoy hay **33 abiertos** (26 PRO y 7 PRO2) en REBUCRET.
- En Zomatik **"proyecto" y "acopio" son lo mismo**: las acciones usan el mismo código con `proyecto=N` o `acopio=N`.
- El listado de "Acopios" sueltos (`listado_acopios.php`) tiene un solo acopio, de 2021. Cuando Bautista dice "acopio", es un **proyecto**.

**Columnas del listado:**
- Código, Cliente + obra ("FIDEICOMISO LA T… (código) PAVIMENTO LT 1"), Fecha, Entrega aprobada;
- columnas de saldo, certificación y facturación (en pesos; no se usan, 20.1);
- Estado (Abierto).

**Acciones de cada fila** (solo se miró a dónde apuntan):

| Botón | URL | ¿Escribe? |
|---|---|---|
| VER | `reporte_detalleproyecto.php?proyecto=N` | No. Se leyó: lista las NP descontadas, con fecha, artículo, m³ y saldo |
| XLS | `exportar_acopio.php?acopio=N` | No. Se leyó: artículos del proyecto, vacío si es de monto fijo |
| COPIAR | `generar_acopio.php?acopio=N` | **Sí.** No se siguió |
| DEVOLVER | `listado_proyectosdevolucion.php?acopio=N` | No se siguió |
| **MATERIAL** | **`modificar_pedidos.php?proyecto=N&tipo=1`** | Es el **alta de nota de pedido** con el proyecto ya puesto (`proyecto` y `tipo` son campos ocultos del alta, que vacía valen 0). No se abrió, por la duda de si arma el borrador del pedido al abrir |
| CERTIF | `modificar_pedidos.php?proyecto=N&tipo=2` | Igual, para certificaciones. No se abrió |
| FACTURAR, REDETERMINACION | `modificar_facturasventa.php?proyecto=N&…` | Sí. No se siguieron |
| DEV MAT, DEV CERT | `modificar_asientos.php?proyecto=N&tipo=1/2` | Sí. No se siguieron |

**Cómo se usa un proyecto en la práctica** (detalle del PRO 0001-00000030, una obra de pavimento):
- desde el 03/07/2026 **cada día de hormigonado es una NP nueva** (32, 31,5, 40, 47… m³ de H30-620-10 C (CAN)) que **descuenta del saldo del proyecto**.

En el año, **145 NP salieron de proyectos, de solo 5 clientes** (67, 55, 10, 8 y 5).

**Alta de proyecto** (`modificar_proyectos.php`, se leyó vacío; **graba** con `manage_proyectos.php` por GET + `POST grabar_proyectos.php?codigo=0`).

Obligatorios: cliente, vendedor, comprobante y número.

| Campo | Qué es | Notas |
|---|---|---|
| `idcliente` / `cliente` | Cliente | Copia razón social, dirección, IVA, CUIT y condición de pago |
| `idobra`, `idvendedor`, `idcolocador` | Obra, vendedor y colocador | — |
| `observaciones`, `observaciones_clientes` | Observaciones | — |
| `comprobante` | 75 **Proyecto** (PRO) · 76 **Proyecto 2** (PRO2) | El número lo trae `_getnumerofactura.php` |
| `idlista`, `tipo` (1 Monto fijo · 2 Cantidades), `monto`, artículos y cantidades | Datos comerciales del proyecto | Fuera de esta etapa (18.7 y 20.1). Se agregan con "Continuar" / "Agregar", por `manage_proyectos.php` |

**El proyecto no tiene depósito:** el depósito se elige en cada NP.

**Origen en el alta de pedido:**
- El radio `origen` tiene 1 Lista, 2 Acopio y 3 Proyecto.
- En el alta vacía, elegir **Proyecto no muestra ningún selector**: el JavaScript solo reacciona a Lista (muestra la lista) y a Acopio (carga los acopios del cliente), y el campo oculto `proyecto` queda en 0.
- O sea, **para descontar de un proyecto el camino que funciona es "Material"**, que entra con `proyecto=N`.
- Que "Origen = Proyecto" desde el alta suelto pida el proyecto en algún lado hay que verlo con Bautista (13.8).

### 16.2 Programar en nuestro sistema: tres caminos

En el formulario del pedido programado, un bloque **"Zomatik"** con tres opciones. Por defecto viene la que corresponda al cliente.

| Opción | Qué hace en Zomatik | Cuándo |
|---|---|---|
| **(a) Generar nota de pedido** | Al tocar "Finalizar pedido" (16.3), o al guardar si se pide así, crea **una NP**: NP o NP2 según R/X, con lo que Zomatik pone por defecto | Pedidos comunes |
| **(b) Generar acopio** | Crea **un proyecto** (PRO o PRO2, tipo Cantidades: artículo + m³ totales de la obra), queda vinculado a la **obra**, y cada día programado genera su NP **contra el proyecto**, como el botón "Material" | Obra larga, a pedido de quien vende. El precio pactado lo carga una persona con permiso |
| **(c) Usar un pedido o acopio que ya existe** | No crea nada al programar. Muestra las **NP pendientes** y los **proyectos abiertos** del cliente, leídos de Zomatik, con lo que les resta. Se elige uno y queda guardado en la obra para los próximos días. Si es un proyecto, cada día genera su NP contra él. Si es una NP pendiente, el remito va contra esa NP mientras le quede saldo | Obras que ya vienen con NP o PRO cargado |

Cambios al modelo del punto 9:
- `zomatik_pedidos` suma `tipo` (`np` / `proyecto`) y `proyecto_id` (la NP hija apunta al proyecto);
- `construction_sites` suma `zomatik_proyecto_id` (el proyecto o NP elegido para esa obra);
- el saldo del proyecto se lee de Zomatik (columna "Restan material" del listado o el detalle), no se calcula acá.

### 16.3 Orden de la OF y el remito (¿Zomatik deja remitir sin stock?)

**No deja.** Por eso la OF no puede quedar para la noche si el remito sale durante el día:
- El remito frena con "No se dispone de suficiente stock para remitir" cuando la cantidad supera el stock del depósito. La única excepción es el depósito 99 (entrega directa), o un ítem marcado `novalidarstock`, que no sabemos de dónde sale.
- **Stock de hormigón hoy:** Canning tiene 2,5 m³ (de un solo artículo) y Hudson 1 m³. Todo lo demás está en 0 y no hay negativos. Se fabrica **exactamente** lo que se remite, justo antes.

Opciones:

| Opción | Cómo | Ventajas | Contras |
|---|---|---|---|
| **A. OF por pedido y día, justo antes de su remito** (recomendada) | Al tocar "Finalizar pedido": 1) OF en el depósito de la planta que despachó, por artículo, con los m³ despachados; 2) remito contra la NP. Las dos en la misma acción, una detrás de la otra | Funciona con Zomatik como está. El stock queda en 0 como hoy y cada remito tiene su OF (es lo que hacen hoy) | Más OF (una por pedido y día, ~2–4 por día) |
| B. OF del día a la noche y remito después | Todo a la noche: OF por planta y artículo, después todos los remitos | Menos OF | Contradice 4(a): el remito no puede salir al finalizar el pedido |
| C. Que Zomatik no valide stock del hormigón | Pedirle al proveedor que los artículos de hormigón no controlen stock (`novalidarstock`) o permitir negativo | Remito en el momento y OF a la noche por tipo, como quiere 4(b) | Depende del proveedor. El stock queda negativo durante el día |
| D. OF a la mañana con lo programado | OF por lo programado y ajuste a la noche | — | Zomatik no tiene cómo "desfabricar" lo que sobra. **Descartada** |

**Recomendación: A.** Además, **a la noche corre una pasada de control**, que cumple el 4(b) como red de seguridad:
- remite lo que haya quedado sin remitir: pedidos no finalizados, despachos sin pedido programado, que generan su NP en ese momento;
- y avisa lo que no pudo remitir.

Si el proveedor acepta la opción C, se pasa a "remito en el momento, OF a la noche por tipo" sin cambiar el resto.

**"Finalizar pedido"** es la acción que ya existe en la programación (finalizar el pedido con motivo, Fase 3). Al finalizar:
1. se arma lo despachado de ese pedido en el día;
2. sale la OF;
3. sale el remito;
4. el pedido muestra "Remitido RM2 0099-00002744" o el error con "Reintentar".

**Finalizar no se frena nunca porque Zomatik falle:** queda pendiente para reintentar o para la pasada de la noche.

### 16.4 ¿Un remito por pedido y día, o uno por despacho?

| | **Uno por pedido y día** (como hoy) | **Uno por despacho** (camión) |
|---|---|---|
| Cuándo sale | Al tocar "Finalizar pedido" | Apenas se despacha el camión (OF de ese camión + remito), o al finalizar, uno por camión |
| Patente | La del primer camión en el campo `patente`, y todas en observaciones | **La real de cada camión** en el campo |
| Remito de papel | Los números en observaciones ("884, 885, 887") | **Uno a uno:** el número de papel en observaciones de su remito |
| Cantidad de documentos | ~2–4 remitos + 2–4 OF por día | ~11 remitos + ~11 OF por día (4 veces más) |
| Talonarios de Zomatik | Duran como hoy | Se gastan 4 veces más rápido. Hoy al RM le quedan **~63 números** de su talonario (hasta 2400) y al RM2 **~57** (hasta 2800): con el remito por despacho duran una semana. Hay que cargar talonarios nuevos en Parámetros › Comprobantes igual, antes de arrancar |
| Errores | Menos requests | Más requests, más chance de que algo falle (cada una se reintenta sola, una por una) |
| Edición de un despacho | Si se corrige un camión después de remitir, hay que corregir un remito que tiene varios | Se corrige solo el remito de ese camión |
| Facturación | Igual que hoy | Más renglones para facturar. Zomatik factura desde varios remitos, pero conviene confirmarlo con quien factura |
| Cruce con GPS y auditoría (Fase 6) | Por día | 1 a 1 con el viaje |

**Recomendación:**
- **Arrancar con uno por pedido y día** (A de 16.3): es lo de hoy, con menos riesgo y menos talonario.
- Si Bautista prefiere la patente real, pasar a uno por despacho cuando estén cargados los talonarios nuevos y la integración lleve un par de semanas sin errores.

**Queda como pregunta 16.8.1.**

### 16.5 Cliente que no está en nuestro sistema pero sí en Zomatik

**Regla: nunca puede quedar un cliente duplicado, ni acá ni en Zomatik.**

- **Copia local de los clientes de Zomatik:**
  - tabla nueva `zomatik_clientes` en nuestra base: código, razón social, nombre normalizado, CUIT, IVA, vendedor, clasificación y `actualizado_at`;
  - se carga con el export de `listado_clientes.php` (467 hoy, un solo request) **todas las noches** y cuando alguien aprieta "Actualizar";
  - las fichas (CUIT, IVA) se leen solo cuando hacen falta.
- **Al buscar un cliente** (programación, alta de cliente, despacho manual), el buscador muestra dos grupos:
  - "En Rebucret";
  - "**En Zomatik (no está en Rebucret)**", buscando en la copia local por nombre normalizado y CUIT, y, si no aparece, con una búsqueda de solo lectura en Zomatik (`traerdatos.php`).
- **"Traer de Zomatik":**
  1. lee la ficha (solo lectura);
  2. crea el cliente en nuestro sistema con `zomatik_codigo`, razón social, CUIT (si es válido), IVA, dirección y vendedor;
  3. **no crea nada en Zomatik**.

  Queda vinculado y listo para programar.
- **Alta nueva:** antes de crear en Zomatik:
  - se busca por CUIT (`_validarcuit.php`) y por nombre en la copia local **y** en Zomatik, justo antes de grabar;
  - si hay un parecido, la pantalla dice "Ya existe en Zomatik: … ¿Es este?" con **"Sí, traerlo"** y "No, es otro cliente". Para elegir "es otro" hay que tener un CUIT o DNI distinto y válido;
  - sin eso no se crea.
- **En la base:**
  - `clients.zomatik_codigo` es **único**;
  - la marca `[RBC c:<id>]` va en `comentarios` del cliente creado, para encontrarlo si se corta la conexión (10).

### 16.6 Cambios a las secciones anteriores
- **8.2 y 8.4** quedan reemplazados por 16.2 y 16.3:
  - el remito sale **al tocar "Finalizar pedido"**, no con un botón al final del día;
  - "Remitir el día" queda como la **pasada de la noche** y como botón manual para remitir lo pendiente.
- **7.4, número:** la serie propia de Zomatik (confirmado). La patente depende de 16.8.1.
- **14.2:** cerrada (no coincide con el papel). **14.5:** cerrada (vendedor del cliente). **14.6 y 14.7:** reemplazadas por 16.2. **14.9:** reemplazada por 16.3 (OF por pedido y día, antes del remito).
- **Riesgos (12)** que se suman:
  - talonarios de remito casi agotados en Zomatik;
  - el remito automático durante el día depende de que Zomatik responda en horario de planta. Si no, queda para la pasada de la noche.
- **Orden de trabajo (15):**
  - Z0 suma la copia `zomatik_clientes` y "Traer de Zomatik";
  - Z1 pasa a ser "Finalizar pedido → OF + remito" más la pasada de la noche;
  - Z2 suma los tres caminos de 16.2 (generar NP, generar acopio, usar uno existente).

### 16.7 Para mirar con Bautista (se suma al punto 13)
8. Abrir **"Material"** de un proyecto y ver qué trae precargado (cliente, artículos del proyecto, saldo) y si pide depósito. Probar también "Origen = Proyecto" en el alta suelta: ¿dónde se elige el proyecto?
9. Abrir el alta de un proyecto con "Continuar" y ver cómo se cargan artículos y m³ (tipo Cantidades).
10. Ver en Parámetros › Comprobantes cómo se carga un talonario nuevo de RM y RM2, y si `_validarnumeroremito.php` frena fuera de rango.
11. Preguntar al proveedor qué es `novalidarstock` y si se puede marcar el hormigón (opción C de 16.3).

### 16.8 Preguntas que quedan (con recomendación)
1. **¿Un remito por pedido y día, o uno por despacho (patente real)?**
   - **Recomendación:** por pedido y día para arrancar, con todas las patentes en observaciones y la del primer camión en el campo. Pasar a por despacho cuando haya talonarios nuevos y la integración esté estable.
2. **¿OF por pedido y día, justo antes del remito?**
   - **Recomendación:** sí, es la única forma de remitir durante el día con Zomatik como está. Consultar al proveedor por la opción C si se quiere la OF a la noche por tipo.
3. **Generar acopio:** queda para más adelante (18.7). Sin precios (20.1).
4. **¿El NP de cada día va siempre contra el proyecto de la obra mientras le quede saldo?** ¿Qué pasa cuando se acaba?
   - **Recomendación:** sí. Cuando el saldo no alcanza, se avisa al programar y el resto va en una NP nueva común (20.4).
5. **Talonarios:** a RM y RM2 les quedan ~60 números en Zomatik. ¿Quién carga los nuevos?
   - **Recomendación:** pedirlo ya, antes de Z1, sea cual sea la respuesta a 16.8.1.
6. **¿El remito sale al finalizar o también apenas se completa el pedido** (cuando lo despachado llega a lo programado)?
   - **Recomendación:** solo al finalizar, que lo hace una persona, más la pasada de la noche.
7. Siguen abiertas, con la recomendación de antes:
   - 14.1, por día o por camión: ahora es 16.8.1;
   - 14.3, CUIT o DNI válido: sí;
   - 14.4, "No Responsable";
   - 14.8, bombeo;
   - 14.10, usuario del robot;
   - 14.11, valores por defecto;
   - 14.12, quién y cuándo: queda reemplazado por "al finalizar", con permiso `zomatik.remitir` para la pasada manual;
   - 14.13, edición de clientes;
   - 14.14, primera carga.

---

## 17. Respuestas de Bautista (21/10/2026, 2) — mandan sobre lo anterior

Si algo de los puntos 1 a 16 contradice esta sección, vale esta sección. Maqueta: [`maqueta-zomatik.html`](maqueta-zomatik.html).

### 17.1 Decisiones
1. **Remito: uno por pedido y por día.** Las patentes de todos los camiones van en observaciones y la del **primer camión** en el campo `patente`. Cierra 16.8.1.
2. **Al tocar "Finalizar pedido":** primero la **OF** con los m³ despachados (por artículo y planta que despachó) y enseguida el **remito**. A la noche corre la **pasada de control** (16.3).
   - **No se le pide nada al proveedor:** la opción C de 16.3 queda descartada.
   - Cierra 16.8.2.
3. **No hay usuario propio para el sistema:** se usa el de Bautista. Riesgos en 17.6.
4. *(Reemplazado por 20.1: por ahora no se habla de precios.)*
5. **Botón "Cargar pedido" en el Dashboard** (17.2).
6. **Vista de estado de los acopios** (17.4).

### 17.2 Botón "Cargar pedido" (Dashboard)
- **Dónde:** arriba del Dashboard, destacado, para quien tenga `programacion.cargar` (Felipe, Juan, Fernando y Bautista).
- **Qué pregunta**, en un cuadro con dos botones grandes:
  - **"Es para una obra o proyecto (acopio)":** abre el **alta de acopio** (17.3).
  - **"Es para programar":** abre **Programación** con el formulario de pedido ya abierto, en la fecha de mañana y en la planta elegida.
- **Programación hace lo mismo sin pasar por el Dashboard.** En el formulario del pedido, el bloque "Zomatik" tiene las tres opciones de 16.2:
  - generar nota de pedido;
  - generar acopio (abre el mismo alta de 17.3 y vuelve al pedido con el acopio elegido);
  - programar desde un pedido o acopio existente.

### 17.3 Alta de acopio
| Campo | De dónde | Notas |
|---|---|---|
| Cliente | Buscador con "Traer de Zomatik" (16.5) | Obligatorio y vinculado a Zomatik |
| Obra | Obras del cliente (`construction_sites`) o "Obra nueva" | Queda vinculada al acopio (`construction_sites.zomatik_proyecto_id`) |
| Con o sin factura | R → **PRO** (comprobante 75) · X → **PRO2** (76) | Por defecto, el `remito_tipo` de la obra o el cliente |
| Tipo | **Por m³** (Cantidades) | Confirmado el 21/10 |
| Renglones | Fórmula + m³ | Una o más fórmulas. Cada una con su artículo de Zomatik |
| Vendedor | El del cliente en Zomatik | Automático (16, punto 7) |
| Observaciones | Texto | Van al proyecto, con la marca `[RBC a:<id>]` |

**Al guardar:**
1. se crea el proyecto en Zomatik (`manage_proyectos.php` + `grabar_proyectos.php`);
2. se guarda en `zomatik_pedidos` con `tipo = 'proyecto'`;
3. el acopio queda elegido en la obra.

Desde ahí, **cada día programado de esa obra genera su NP contra el proyecto**, como el botón "Material", y al finalizar sale la OF + el remito.

Si Zomatik falla, el acopio queda "Pendiente en Zomatik" con "Reintentar". Se puede programar igual: la NP espera a que el acopio exista.

### 17.4 Estado de los acopios
**Dónde:**
- **Programación › pestaña "Acopios"**: la vista completa;
- **Clientes**, en la ficha del cliente y de la obra: un resumen (saldo, última entrega, aviso) con link a la pestaña;
- **el Dashboard** muestra solo los avisos de saldo bajo.

**Por acopio:**
- cliente y obra, comprobante (PRO o PRO2) y tipo;
- **total pactado** en m³;
- **remitido** en m³, con el **detalle por día**;
- **saldo** en m³ (20.3);
- **programado a futuro** contra ese acopio;
- **última entrega**;
- estado: abierto, saldo bajo, agotado o cerrado.

**De dónde sale cada dato:**

| Dato | Fuente |
|---|---|
| Saldo y estado del proyecto (Abierto) | Zomatik, `listado_proyectos.php`, export o HTML. Una lectura por corrida. Zomatik lo lleva en pesos: acá se muestra solo como % y m³ (20.3) |
| Renglones pactados (fórmula, m³) si es por m³ | Zomatik, `exportar_acopio.php?acopio=N` (XLS) |
| NP descontadas por día (fecha, artículo, m³) | Zomatik, `reporte_detalleproyecto.php?proyecto=N` |
| **Remitido por día (m³)** y última entrega | Zomatik, `reporte_remitosventa.php`: ya trae la columna **Proyecto** ("PRO 0001-00000013") por renglón de remito |
| Cliente y obra vinculados, programado a futuro (`scheduled_dispatches`), despachado hoy y todavía no remitido | **Nuestra base** |
| Saldo en m³ de los proyectos por monto | Estimado sin mostrar pesos (20.3). Se muestra como "≈" |

**Cuándo se lee:**
- a la noche, con la pasada de control;
- después de cada remito contra un acopio;
- y con el botón "Actualizar".

Se guarda una foto en `zomatik_proyectos` (cabecera, nueva) y `zomatik_proyecto_movimientos` (un renglón por remito o NP). Así la pantalla no le pega a Zomatik cada vez que se abre.

**Sin montos en pantalla** (20.1).

**Aviso de saldo bajo** (recomendado; se ajusta en 17.7.1). Se activa por cualquiera de dos condiciones:
- el saldo no alcanza para lo **programado contra ese acopio en los próximos 7 días**;
- o el saldo queda **por debajo del 15 % del pactado**.

**Dónde se ve el aviso:**
- en ámbar en la pestaña Acopios, el Dashboard y la ficha del cliente;
- al programar contra ese acopio: "Al acopio le quedan 18 m³ y estás programando 24 m³";
- **agotado** (saldo ≤ 0) en rojo. No se pueden generar más NP contra ese proyecto: el pedido va en una NP nueva común (20.4).

### 17.5 Cambios a lo anterior
- **7.4:** `patente` = la del primer camión del pedido en el día. `observacionesimp` = "Camiones AF123KD, AG456LM · Remitos 884, 885 · Obra …".
- **16.3:** queda la opción A más la pasada de la noche. C descartada.
- **16.8.3:** sin precios (20.1); acopio por m³ (confirmado).
- **Modelo (9):**
  - se suman `zomatik_proyectos` (código, número, cliente, obra, tipo, pactado m³, remitido m³, saldo % y m³, estado, `leido_at`) y `zomatik_proyecto_movimientos` (proyecto, fecha, NP, remito, artículo, m³);
- **Orden de trabajo (15)**, reemplaza al anterior:
  1. **Z0:** lecturas, vínculos, primera carga, copia de clientes y "Traer de Zomatik" (solo crea acá).
  2. **Z1:** **vista Acopios**, que es solo lectura y sirve desde el día uno.
  3. **Z2:** "Finalizar pedido" → OF + remito, más la pasada de la noche.
  4. **Z3:** "Cargar pedido", las tres opciones al programar y el alta de acopio.
  5. **Z4:** alta de cliente nuevo en Zomatik.

### 17.6 Riesgo nuevo: se usa el usuario de Bautista
| Riesgo | Qué hacemos |
|---|---|
| En Zomatik todo figura cargado por Bautista: no se distingue lo del sistema de lo suyo | Cada documento lleva en observaciones "Cargado desde Rebucret por [usuario]" + la marca `[RBC …]`. La bitácora `zomatik_operaciones` guarda quién apretó qué |
| Si Bautista cambia la clave, la integración se corta | Error claro ("Zomatik rechazó el usuario: actualizar la clave en Vercel") y aviso a Bautista. No se reintenta: si se reintenta, se bloquea el usuario |
| La sesión del robot y la de Bautista en el navegador al mismo tiempo. No sabemos si Zomatik permite dos sesiones del mismo usuario ni si una cierra la otra | Probarlo en la sesión del punto 13. Si se pisan, el robot usa sesiones cortas (login, la tanda, salir) en horarios acotados |
| Con la cuenta de Bautista el robot tiene todos sus permisos (facturar, borrar, contable) | El código del robot solo puede llamar a una **lista cerrada** de rutas (las de cliente, pedido, proyecto, OF y remito). Cualquier otra se rechaza antes de salir |
| Comisiones y reportes por usuario | El vendedor sale del cliente (no del usuario), así que las comisiones no cambian |

Cuando haya un usuario propio, se cambian las variables en Vercel y nada más.

### 17.7 Preguntas que quedan (con recomendación)
1. **¿Cuándo avisar saldo bajo?**
   - **Recomendación:** cuando no alcance para lo programado en los próximos 7 días, o quede menos del 15 % del pactado.
2. **¿El acopio se pacta por m³ o por monto?**
   - **Respondida:** por m³ (tipo Cantidades).
3. **¿Se puede programar más allá del saldo?**
   - **Respondida:** alerta, y el excedente va en una NP nueva común (20.4).
4. **¿Quién ve el botón "Cargar pedido"?**
   - **Recomendación:** los que hoy cargan programación (`programacion.cargar`).
5. **¿Los acopios viejos que ya están en Zomatik (33 abiertos) se vinculan a nuestras obras?**
   - **Recomendación:** sí, en la primera carga, con la misma pantalla de confirmación que los clientes (por cliente y nombre de obra del proyecto).
6. Siguen abiertas:
   - 14.3, CUIT o DNI válido;
   - 14.4, "No Responsable";
   - 14.8, bombeo;
   - 14.11, valores por defecto;
   - 14.13, edición de clientes;
   - 14.14, primera carga;
   - 16.8.4, qué pasa cuando se acaba el acopio (ver 17.7.3);
   - 16.8.5, talonarios: siguen haciendo falta, ~60 números por serie;
   - 16.8.6, si el remito sale solo al finalizar.

---

## 18. Respuestas de Bautista (21/10/2026, 3) — mandan sobre lo anterior

Si algo de los puntos 1 a 17 contradice esta sección, vale esta sección. **Bautista aprobó la maqueta** ("quedó perfecto"); está ajustada con estos cambios en [`maqueta-zomatik.html`](maqueta-zomatik.html).

### 18.1 Decisiones
1. **Los proyectos (acopios) se siguen cargando en Zomatik.** Nuestro sistema **no los crea** en esta etapa.
   - El **alta de acopio** (17.3) y la opción "Generar acopio" (16.2 b) pasan a **"para más adelante"** (18.7).
   - Lo que sí hace nuestro sistema es **generar una NP contra un proyecto que ya existe**, lo mismo que el botón **MATERIAL** del proyecto en Zomatik (`modificar_pedidos.php?proyecto=N&tipo=1`).
2. **Si se programa más de lo que le queda al proyecto, salta una alerta**, porque no se va a poder fabricar ni remitir (18.3).
3. **Regla dura: no se despacha hormigón si el pedido no tiene su NP en Zomatik** (18.4).
4. Respuestas a 17.7:
   - **aviso de saldo bajo:** 7 días o 15 %;
   - **acopio por m³**;
   - **programar de más:** alerta (18.3);
   - **vincular los 33 acopios abiertos:** sí, en la primera carga.
5. Quedan **con la recomendación del arquitecto**, sin respuesta de Bautista:
   - CUIT o DNI válido obligatorio para el alta nueva (14.3);
   - "No Responsable" se mapea a Consumidor Final o Exento con el contador (14.4);
   - bombeo: renglón "m3 BOMBEADOS" solo si la bomba la pone Rebucret (14.8);
   - valores por defecto Casas · A · IIBB Buenos Aires · BS.AS. Sur (14.11);
   - editar un cliente no cambia Zomatik en la primera versión (14.13);
   - primera carga solo con los clientes del último año (14.14);
   - el remito sale solo al finalizar, más la pasada de la noche (16.8.6).

### 18.2 La NP ahora se genera al programar (cambia 8.2, 16.2 y 17.2)
Como sin NP no se despacha (18.4), **la NP se crea al guardar el pedido programado**, no al finalizar. El bloque "Zomatik" del pedido queda con tres opciones:

| Opción | Qué hace en Zomatik |
|---|---|
| **(a) Generar nota de pedido** | NP o NP2 según R/X, con lo que Zomatik pone por defecto (20.2). Por los m³ programados |
| **(b) Contra un proyecto existente** | Elegir un proyecto **abierto** del cliente: los 33 de hoy, leídos de Zomatik y vinculados a la obra. Genera la NP contra el proyecto, como MATERIAL. Queda recordado en la obra para los próximos días |
| **(c) Usar una NP que ya existe** | Elegir una NP **pendiente** del cliente con saldo suficiente. No crea nada |

**"Cargar pedido" en el Dashboard:**
- **"Es para una obra o proyecto":** abre **"Pedido para un proyecto"**: lista de proyectos abiertos (buscador por cliente u obra, con saldo y último pedido), y al elegir uno, el formulario corto con fecha, planta, fórmula (las del proyecto), m³ y llegada. **"Generar NP y programar"** crea la NP contra el proyecto y el pedido programado.
- **"Es para programar":** queda igual (Programación con el formulario abierto, opción a, b o c).

**Cuándo se crea la NP:**
- al guardar, en segundo plano. La tarjeta muestra "NP2 0001-00002079 ✓", o "Sin NP" en rojo con **"Generar NP ahora"**;
- si el pedido se **amplía** (más m³) después de tener NP: se crea una **NP adicional** por la diferencia, porque editar una NP en Zomatik es más riesgoso;
- si se **achica:** no se toca, y al finalizar se remite lo despachado;
- si se **cancela** antes de despachar: la NP queda pendiente en Zomatik y se avisa "Anular la NP en Zomatik" a quien carga. El sistema no anula nada.

**El cliente tiene que existir en Zomatik para tener NP.** Por eso el alta de cliente en Zomatik (Z4) se adelanta junto con esta etapa (18.6). Mientras tanto vale "lo das de alta en Zomatik y lo traés" (16.5).

### 18.3 Programar de más contra un proyecto
- **Saldo del proyecto en m³** (pactado por m³, 18.1):
  - pactado − remitido − NP pendientes contra el proyecto (de Zomatik);
  - − programado sin NP (de nuestra base).
  - Se actualiza al abrir el formulario: una lectura del proyecto, si la última tiene más de 30 min.
- Si los m³ del pedido superan el saldo, aparece un **aviso rojo** arriba del botón:

  > "Al proyecto PRO2 0001-00000014 le quedan 18 m³ y estás programando 24 m³. Zomatik no va a dejar fabricar ni remitir los 6 m³ que sobran."

- Opciones del aviso:
  1. **Programar solo 18 m³** contra el proyecto;
  2. **Programar 18 contra el proyecto y 6 en una NP nueva común** (20.4);
  3. **Guardar sin NP** y avisar al vendedor para que amplíe el proyecto en Zomatik. El pedido queda "Sin NP" y **no se va a poder despachar** hasta que tenga NP.
- **No se puede guardar contra el proyecto por encima del saldo.** Zomatik lo rechaza igual: "El importe excede el monto del acopio".
- Saldo bajo (7 días o 15 %): sigue el aviso ámbar de 17.4.

### 18.4 Regla dura: sin NP no se despacha
**Qué se controla.** Para despachar un viaje de un pedido programado, el pedido tiene que tener su NP en Zomatik:
- `scheduled_dispatches.zomatik_pedido_id` → `zomatik_pedidos` con `estado = 'ok'` y **número guardado** ("NP2 0001-00002079");
- y los m³ despachados del día, contando el que sale, **no pueden superar los m³ de sus NP**. Si los superan, ofrece "Generar NP adicional por X m³".

**Dónde se controla:**
- **En la base**, dentro de `registrar_despacho` (motor 0b). Si no hay NP válida ni excepción, devuelve el error `SIN_NP` y **no graba nada**. Así ninguna pantalla se lo saltea: la de tres columnas, la vieja, el despacho manual y, más adelante, la carga de planta o dosificadora, que tiene que llamar al mismo control.
- **En la pantalla Entrega**, antes de tocar "Despachar":
  - el viaje sin NP se ve en rojo: "Sin nota de pedido en Zomatik";
  - el formulario muestra **"Generar NP ahora"**: crea la NP con los datos del pedido, en 5 a 10 segundos, y deja despachar.
- **Despacho manual sin pedido programado** (pedidos chicos que hoy no se programan): el formulario pide primero cliente, obra, fórmula, m³ y R/X, y crea el pedido programado + su NP en el momento ("Generar NP y despachar"). Así no hay despachos sin pedido.

**Si Zomatik está caído o no responde.** "Generar NP ahora" falla con un mensaje claro ("Zomatik no responde desde las 07:12"). Para no frenar la planta hay una **excepción**:
- Botón **"Despachar sin NP (autoriza un gerencial)"**.
- Lo autoriza un **gerencial** (permiso nuevo `despacho.sin_np`: Bautista, Juan y Fernando):
  - si el que despacha no es gerencial, el gerencial pone **su usuario y su clave** en el mismo equipo (el login de la 0c-1), **o** aprueba desde su celular un pedido de autorización que le llega por WhatsApp, con link;
  - y elige un **motivo**: "Zomatik caído", "Cliente sin alta en Zomatik todavía", u "Otro" con texto (mínimo 5 letras).
- **Alcance:** vale para **ese pedido y ese día**, no para todos. Si Zomatik vuelve, los viajes siguientes del pedido ya usan la NP.
- **Después:**
  - el sistema **reintenta solo** crear la NP cada 10 min mientras el pedido esté abierto, y en la pasada de la noche;
  - **no se puede finalizar ni remitir** sin la NP;
  - la excepción queda en Actividad y en un aviso del Dashboard ("2 despachos sin NP hoy, 1 regularizado");
  - si a la mañana siguiente sigue sin NP, se avisa a Bautista.
- **Cómo se sabe que Zomatik está caído:** se intenta crear la NP. Si falla por error de red o por tiempo (no por validación), se habilita la excepción. Un error de validación ("cliente sin código", "excede el proyecto") **no** habilita la excepción: hay que arreglar el dato.

**Para arrancar sin frenar la planta:** una semana en **modo aviso**. El control avisa y deja despachar, anotando "sin NP" en Actividad, mientras se ve cuántos pedidos llegan al despacho sin NP. Después, **modo duro**. Un parámetro de planta lo cambia el gerencial.

### 18.5 Datos (se suma al punto 9; no aplicado)
| Dónde | Qué |
|---|---|
| `zomatik_pedidos` | `m3` (los m³ de la NP), `es_adicional bool`, `proyecto_id` (si es contra proyecto) |
| `zomatik_proyectos` | Solo **lectura y vínculo** (no se crean), más `construction_site_id` |
| `zomatik_excepciones_np` (nueva) | `id`, `scheduled_dispatch_id`, `fecha`, `motivo_tipo`, `motivo`, `autorizado_por` (gerencial), `pedido_por`, `created_at`, `regularizado_at`, `zomatik_pedido_id` (la NP que llegó después) |
| `registrar_despacho` | Control `SIN_NP` y `SUPERA_NP`, salvo excepción vigente del pedido y el día. Se parte de `pg_get_functiondef` de producción. **Cambio de base: avisar antes de aplicar.** Los despachos ya cargados no cambian |
| `plants` | `exigir_np text` (`aviso` / `duro`) |
| Permisos | `despacho.sin_np` (gerenciales). Sale `acopio.precio`, porque ya no hay alta de acopio |

### 18.6 Orden de trabajo (reemplaza 17.5)
1. **Z0 — lecturas** (solo crea acá):
   - clientes de Zomatik con "Traer de Zomatik";
   - vínculo de fórmulas, plantas y vendedores;
   - primera carga de clientes;
   - **vínculo de los 33 proyectos abiertos con nuestras obras**.
2. **Z1 — vista Acopios** (solo lectura), con saldo bajo y agotado.
3. **Z2 — NP al programar:**
   - opciones a, b y c, "Cargar pedido" › proyecto y la alerta de saldo (18.3);
   - **alta de cliente en Zomatik**;
   - "Generar NP ahora";
   - control en el despacho en **modo aviso**.
4. **Z3 — "Finalizar pedido" → OF + remito**, más la pasada de la noche. Después de una semana sin problemas, el control de NP pasa a **modo duro** con la excepción gerencial.
5. **Más adelante:** alta de acopio desde nuestro sistema (17.3), cuando Bautista lo pida.

### 18.7 Para más adelante (no entra en esta etapa)
- **Alta de acopio (proyecto) desde nuestro sistema:** se conserva el diseño de 17.3 y el relevamiento del alta de proyecto de 16.1.
- Editar una NP existente en Zomatik, en vez de crear NP adicionales.
- Anular desde nuestro sistema una NP de un pedido cancelado.

### 18.8 Preguntas que quedan (con recomendación)
1. **Si el pedido supera el saldo del proyecto, ¿se ofrece el resto en otra NP?** **Respondida (20.4):** sí, en una NP nueva común.
2. **¿Quién autoriza "Despachar sin NP"?**
   - **Recomendación:** Bautista, Juan y Fernando. Con su clave en el equipo de la planta o desde el link de WhatsApp.
3. **¿Arrancamos con una semana en modo aviso antes del modo duro?**
   - **Recomendación:** sí.
4. **Pedido cancelado con NP ya creada:** ¿quién la anula en Zomatik?
   - **Recomendación:** el vendedor del cliente, con un aviso automático. El sistema no anula.
5. **Pedido que se amplía:** ¿NP adicional (recomendado) o editar la NP en Zomatik?
   - **Recomendación:** NP adicional. Es menos riesgo y queda trazado.

---

## 19. Respuestas de Bautista (21/10/2026, 4) — mandan sobre lo anterior

Si algo de los puntos 1 a 18 contradice esta sección, vale esta sección. La maqueta está rehecha con estos cambios: [`maqueta-zomatik.html`](maqueta-zomatik.html).

### 19.1 Decisiones
1. **Dashboard: queda como está.** Cambian solo los textos de "Cargar pedido" (la explicación de abajo de cada opción sigue igual):
   - "Para una obra o proyecto" → **"Generar NP para un proyecto ya cargado"**;
   - "Para programar" → **"Generar NP nueva"**, que lleva a Programación.
2. **La maqueta se parece a lo que ya existe.** "Generar NP nueva" lleva a la **grilla de Programación de hoy** (`components/programacion-tabs.tsx`):
   - pestañas **Semana** (`dispatch-scheduling.tsx`) y **Día · ordenar camiones** (`programacion-dia.tsx`);
   - en Semana, la grilla de 6:00 a 19:00 por día, donde se toca un horario para cargar;
   - el pedido se carga con el **formulario actual** (planta, fecha y hora de llegada, cliente y obra con buscador, tiempos del GPS, descarga y bomba, fórmula, finalidad, m³, viajes, fibra, camión, observaciones).

   Sobre esa base se suma solo lo de Zomatik (19.2) y unas mejoras chicas (19.3).
3. **Crear el proyecto en Zomatik:** la opción **se ve pero deshabilitada**, con el texto "Por ahora los proyectos se cargan en Zomatik". Está en el formulario del pedido y en "Generar NP para un proyecto ya cargado".
4. **"Finalizar día" pasa a llamarse "Finalizar pedido"**, en la spec y en la maqueta. Es el mismo "Finalizar pedido" de la Fase 3 (finalizar con lo enviado, con motivo), que ahora además genera la OF y el remito.
5. **Acopios no van en una pestaña aparte.** Van **abajo de la grilla de Programación** (en Semana y en Día), como un bloque **"Acopios"**:
   - una fila por proyecto abierto, con barra de avance, pactado, remitido, saldo, programado, última entrega y aviso (saldo bajo o agotado);
   - cada fila **se despliega** al detalle por día (remito, fórmula, m³ y saldo).

   Reemplaza el "dónde" de 17.4. Los datos y los avisos siguen igual (17.4 y 18.3).

### 19.2 Lo que se suma a Programación por Zomatik
- **En el formulario del pedido**, un bloque **"Nota de pedido (Zomatik)"** después de "m³ del pedido":
  - **Generar NP nueva:** NP o NP2, con lo que Zomatik pone por defecto;
  - **NP para un proyecto ya cargado:** selector de proyectos abiertos del cliente, con saldo, y la alerta roja si no alcanza (18.3);
  - **Usar NP pendiente:** NP pendientes del cliente con saldo;
  - **Crear proyecto en Zomatik:** deshabilitada, con "Por ahora los proyectos se cargan en Zomatik".

  Además, el **tipo de remito** (con factura R / sin factura X), que decide NP o NP2. Viene del pedido, la obra o el cliente, como en la Fase 3.

  El botón "Programar" pasa a **"Programar y generar NP"**.
- **En la grilla Semana**, cada pedido suma una línea con la NP:
  - "NP2 …2079 ✓" en verde;
  - **"Sin NP"** en rojo;
  - y, si ya se remitió, el remito ("RM2 …2746").

  En el menú ⋯ del pedido se suman "Generar NP ahora" (si no tiene) y "Finalizar pedido".
- **En la vista Día**, cada pedido muestra a la derecha:
  - la NP: chip verde, o "Sin NP" con **"Generar NP ahora"**;
  - el remito: "—", "RM2 0099-00002746 ✓" o error con "Reintentar";
  - y el botón **"Finalizar pedido"**, que abre el cuadro con lo despachado, los camiones, los remitos de papel y lo que se va a crear (OF + remito), con resultado, o error con "Reintentar".

### 19.3 Mejoras chicas propuestas al formulario actual (marcadas en la maqueta como "mejora propuesta")
Sin rehacerlo: mismo diálogo, mismos campos.
1. **Cliente y obra arriba de todo.** Hoy van después de planta, fecha y hora, pero los tiempos del GPS, la sugerencia de llegada y la bomba dependen de la obra. Con la obra primero, todo lo que sigue ya viene calculado.
2. **Títulos de sección** en el diálogo largo: "Cliente y obra", "Cuándo", "Hormigón", "Nota de pedido (Zomatik)", "Más datos". Sirven para ubicarse al hacer scroll. "Más datos" (fibra, camión, observaciones) arranca **plegado**.
3. **"Repetir el último pedido de esta obra"**: un botón que copia fórmula, m³, descarga, bomba, m³ por camión y fibra del último pedido de la obra. La mayoría de las obras repiten.
4. **Resumen fijo al pie**, siempre visible arriba de los botones. Por ejemplo: "24 m³ · H30-620-10 C · 3 viajes · carga 06:55 · llega 07:30 · NP2 contra PRO2 0001-00000014".
5. **Decir qué falta.** Hoy "Programar" queda gris sin explicar. Al lado del botón: "Falta: obra, descarga".
6. **Textos:**

   | Hoy | Propuesto |
   |---|---|
   | "Nuevo Despacho Programado" | "Nuevo pedido" |
   | "Formula" | "Fórmula" |
   | "Cantidad Total (m3)" | "m³ del pedido" |
   | "Camion (opcional)" | "Camión (opcional)" |
   | "Cancelar Despacho" | "Cancelar pedido" |
   | "Dejar vacio" | "Dejar vacío" |

7. **El tipo de remito (R/X) en el formulario**, al lado de los m³: hoy no se ve al programar, y ahora hace falta para la NP.

Cada una es independiente; Bautista puede elegir cuáles van (pregunta 19.5.1).

### 19.4 Cambios a lo anterior
- **17.2 / 18.2:** textos de "Cargar pedido" según 19.1.1. "Generar NP nueva" abre la grilla Semana con el formulario del pedido abierto en mañana a las 8:00, que se puede cambiar.
- **17.4:** el bloque Acopios vive abajo de la grilla de Programación, no en una pestaña. El resumen en la ficha del cliente y de la obra (Clientes) y los avisos del Dashboard siguen.
- **"Finalizar pedido"** reemplaza "Finalizar día" y "finalizar el día del pedido" en toda la spec.

### 19.5 Preguntas que quedan (con recomendación)
1. **¿Cuáles de las mejoras de 19.3 se hacen?**
   - **Recomendación:** todas son chicas. Si hay que elegir: 1 (cliente y obra arriba), 5 (qué falta), 6 (textos) y 7 (R/X). La 3 (repetir el último pedido) es la que más tiempo ahorra.
2. **¿"Finalizar pedido" también en la grilla Semana (menú ⋯) o solo en la vista Día?**
   - **Recomendación:** en las dos, porque el día se cierra desde cualquiera.
3. Las de 18.8 quedan respondidas en el punto 20.

---

## 20. Respuestas de Bautista (21/10/2026, 5) — mandan sobre lo anterior

Si algo de los puntos 1 a 19 contradice esta sección, vale esta sección.

### 20.1 Decisiones
1. **"Por ahora no hablamos de precios."**
   - No hay precios, listas, precio pactado ni montos en $ en ninguna pantalla nuestra.
   - Los acopios se siguen **solo en m³**.
   - En la spec se sacaron las menciones de precios de las secciones de diseño. Quedan solo los nombres técnicos de campos de Zomatik que el robot tiene que conocer.
2. **Autorizan despachar sin NP:** Bautista, Juan y Fernando. Cierra 18.8.2.
3. **Modo aviso: 2 semanas**, que arrancan **recién cuando Bautista dé el OK para lanzar**. Después, modo duro. Cierra 18.8.3.
4. **Pedido cancelado en nuestro sistema → cancelar la NP en Zomatik automáticamente** (20.5). Reemplaza 18.2 ("el sistema no anula nada") y 18.8.4.
5. **Pedido que se agranda: NP adicional** por la diferencia. Cierra 18.8.5.

### 20.2 La NP sale con lo que Zomatik pone por defecto
- El robot **no muestra ni deja elegir** lista ni precio.
- Zomatik exige una lista cuando el origen es "Lista", así que el robot manda la que corresponde, sin preguntar:
  - **NP común:** la lista activa más nueva del comprobante, "en 1" para la NP y "en 2" para la NP2 (5.3);
  - **NP contra un proyecto:** lo que trae el proyecto (botón MATERIAL), sin tocar nada.
- Los ítems llevan artículo y cantidad; el resto lo completa Zomatik.
- Si no encuentra una lista activa única del comprobante, **no genera la NP** y avisa "Revisar las listas en Zomatik". No inventa nada.

### 20.3 Saldo de los acopios en m³
**Relevado el 21/10, solo lectura:** se leyó el XLS (`exportar_acopio.php`) de los **33 proyectos abiertos**. **Los 33 son "por monto"** (sin artículos ni cantidades): Zomatik lleva el saldo en pesos, no en m³.

Cómo se muestra, sin pesos:
- **Remitido en m³:** exacto, de los remitos del proyecto (`reporte_remitosventa.php`, columna Proyecto).
- **Saldo en %:** lo que le queda al proyecto según Zomatik, como porcentaje. Se calcula con los montos de Zomatik, pero **solo se muestra el %**.
- **Saldo ≈ m³:** lo remitido en m³ × saldo % ÷ consumido %. Se muestra con "≈" y la aclaración "estimado: el proyecto está cargado por monto".
- **Proyectos cargados por m³** (tipo Cantidades, si en el futuro se cargan así en Zomatik): saldo exacto = m³ pactados − remitidos, sin "≈".
- **La palabra final la tiene Zomatik:** si al generar la NP contra el proyecto Zomatik contesta "excede el monto del acopio", el sistema muestra la alerta roja de 20.4, aunque la estimación dijera que alcanzaba.

Avisos (17.4): saldo bajo si el ≈ no alcanza para lo programado en 7 días o queda menos del 15 %; agotado si Zomatik da saldo 0 o negativo.

### 20.4 Programar más de lo que queda en el proyecto (reemplaza 18.3)
Alerta roja: "Al proyecto … le quedan ≈ 18 m³ y estás programando 24 m³. Zomatik no va a dejar fabricar ni remitir lo que sobra". Tres opciones:
1. **Programar solo lo que queda** (18 m³) contra el proyecto.
2. **Lo que queda contra el proyecto y el resto en una NP nueva común**: dos NP, la segunda NP o NP2 según R/X, como cualquier pedido.
3. **Guardar sin NP.** El pedido queda "Sin NP" y **no se puede despachar** hasta que tenga una. Se avisa al vendedor para que amplíe el proyecto.

### 20.5 Cancelación automática de la NP
**Lo que se vio en Zomatik** (solo lectura, sin seguir ningún link):
- **El listado de pedidos no tiene ninguna acción de "anular" o "cancelar" por fila.** Cada fila tiene:
  - el número y el cliente: `modificar_pedidos.php?codigo=N` (editar);
  - FC: `modificar_facturasventa.php?pedido=N`;
  - REMITO: `modificar_remitos.php?pedido=N`, solo en las pendientes;
  - RECIBO: `modificar_recibos.php?pedido=N`;
  - **DEVOL:** `listado_pedidosdevolucion.php?pedido=N`;
  - imprimir y PDF: `imprimir_pedido.php?codigo=N[&pdf=1]`;
  - destacado: `set_pedidos_destacado.php?codigo=N`, que escribe;
  - y una nota: `_notas.php`.
- **DEVOL** abre el listado de devoluciones del pedido (leído: vacío). Desde ahí, el alta es **`modificar_pedidosdevolucion.php?pedido=N`** (no se abrió). Es la **devolución de pedido (DP/DP2)**, que en el año se usó 4 veces y en el listado figura como "DEVPED".
- **Dentro de la NP** (edición `modificar_pedidos.php?codigo=N`), el JavaScript que ya se leyó del alta borra renglones:
  - `verificar()` → `manage_pedidos.php?…&fborrar=<renglón>`;
  - y "Eliminar" seleccionados → `manage_pedidos.php?…&faccion=3&fitems=…`;
  - después hay que grabar con `grabar_pedidos.php`.
- **Parámetros › LIBERAR COMPROBANTE** (`modificar_liberarcomprobante.php`, leído el formulario) pide comprobante (incluye 15 Nota de Pedido y 16 Nota de Pedido 2) y número, y graba en `grabar_liberarcomprobante.php`. **No sabemos qué hace "liberar"** (¿anula?, ¿destraba la edición?).
- Para proyectos existen los comprobantes **"Anulacion Material Proyecto" (84/85)**. Probablemente sea lo que devuelve saldo al proyecto cuando se anula material.

**Diseño propuesto.** El método exacto se confirma el jueves (20.6). Al cancelar un pedido en nuestro sistema:

1. **Solo se tocan NP que creó el sistema** (con la marca `[RBC p:…]`). Las NP que se eligieron con "Usar NP pendiente" **nunca** se cancelan solas: se desvinculan y se avisa al vendedor.
2. **Se lee el estado de la NP** antes de tocar nada:
   - remitos contra la NP (`reporte_remitosventa.php` por N Pedido);
   - y lo pendiente (`reporte_pendientesentregadetallado.php`).
3. **Sin remitos, todo pendiente → se cancela entera.** Por **devolución de pedido (DP/DP2) por todo lo pendiente** (recomendado: deja rastro y no borra nada), o por el método que Zomatik use de verdad (borrar los renglones, o "Liberar comprobante"), según lo que se vea el jueves.
4. **Con remitos → no se cancela.** El pedido se cancela en nuestro sistema igual y se avisa a quien canceló y al vendedor: "La NP2 0001-00002079 ya tiene remitos (16 m³). Se canceló solo lo que no se despachó" (punto 5), o "revisala en Zomatik".
5. **Cancelación parcial** (pedido achicado, o "Finalizar pedido" con menos de lo pedido):
   - lo **remitido** queda;
   - lo **pendiente** (pedido − remitido) se cancela con una DP por esa diferencia;
   - si Zomatik no deja hacerlo, queda **avisado** en el pedido ("2 m³ pendientes en la NP, cancelar a mano") y en el Dashboard.
6. **NP contra un proyecto:** la cancelación tiene que **devolver el saldo al proyecto**. Hay que ver si la DP lo hace sola o si hace falta "Anulacion Material Proyecto". Se confirma el jueves.
7. **Varias NP del mismo pedido** (adicionales): se cancelan todas las que no tengan remitos.
8. **Si Zomatik falla:** el pedido se cancela igual en nuestro sistema. La cancelación de la NP queda pendiente con "Reintentar", sigue en la pasada de la noche y nunca se reintenta sola sin verificar.
9. **Datos:** `zomatik_pedidos.estado` suma `cancelando` y `cancelada` (+ `cancelada_con`: dp / borrado / liberar, y el número de DP). La bitácora va en `zomatik_operaciones`.

Mientras no se confirme el método (jueves), **la cancelación automática no se activa**: se avisa "Cancelá la NP2 … en Zomatik" a quien canceló.

### 20.6 Prueba con Bautista en la planta (jueves 23/10)
Con una NP de prueba (un cliente de prueba, 1 m³), en Zomatik y con Bautista:
1. ver qué hace **DEVOL** (`modificar_pedidosdevolucion.php?pedido=N`): ¿deja la NP sin pendiente? ¿cambia el estado a REM o a otro?;
2. ver qué hace **"Liberar comprobante"** con una NP;
3. ver qué pasa al **borrar los renglones** de una NP y grabar;
4. lo mismo con una NP **contra un proyecto**: ¿vuelve el saldo?;
5. con una NP **remitida en parte**: ¿qué se puede cancelar?;
6. se suman los pasos pendientes del punto 13 (Continuar de OF, remito desde el pedido, Material, respuesta de Grabar, dos sesiones del mismo usuario).

Después de la prueba se anula todo lo de prueba **a mano**, por Bautista.

### 20.7 Modo aviso (cambia 18.4)
- Arranca **cuando Bautista da el OK para lanzar**, no al publicar.
- Dura **2 semanas** y después pasa solo a modo duro, con aviso al gerencial el día anterior.
- El parámetro por planta (`plants.exigir_np`) suma `aviso_hasta` (fecha).

### 20.8 Cambios en la maqueta
- Sin precios ni $. Acopios en m³: remitido exacto, saldo en % y ≈ m³, con "estimado: proyecto cargado por monto".
- Excedente sobre el saldo: "Programar solo lo que queda", "Lo que queda contra el proyecto + el resto en una NP nueva común" y "Guardar sin NP".
- "Cancelar pedido" en la vista Día. Muestra los dos casos (sin remitos: se cancela la NP; con remitos: no se cancela y se avisa) y la marca "a confirmar el jueves".

### 20.9 Preguntas que quedan (con recomendación)
1. **¿Se pide que los proyectos nuevos se carguen por cantidades (m³) en Zomatik?** Así el saldo en m³ sería exacto y no estimado.
   - **Recomendación:** sí, para los nuevos. Los 33 abiertos siguen por monto, con el ≈.
2. **¿Cómo se cancela hoy una NP en Zomatik?** Lo resuelve la prueba del jueves (20.6).
   - **Recomendación:** por devolución de pedido (DP) por lo pendiente, si deja la NP cerrada y devuelve el saldo al proyecto.
3. Quedan con la recomendación del arquitecto, sin respuesta:
   - CUIT o DNI válido (14.3);
   - "No Responsable" (14.4);
   - bombeo (14.8);
   - valores por defecto del cliente (14.11);
   - edición de clientes (14.13);
   - primera carga (14.14);
   - remito solo al finalizar (16.8.6);
   - y las mejoras de 19.3 (19.5.1) y dónde va "Finalizar pedido" (19.5.2).

---

## 21. Respuestas de Bautista (21/10/2026, 6) — mandan sobre lo anterior

1. **Las 7 mejoras del formulario de pedido (19.3) van todas.** Cierra 19.5.1.
2. **El plantista no genera NP, por ahora.** "Generar NP ahora" está solo en **Programación** (permiso `programacion.cargar`), no en la pantalla de despacho. Reemplaza lo de 18.4 sobre la pantalla Entrega.
3. **Un viaje programado siempre tiene NP**, porque se genera al programar.
   - **Si al programar Zomatik estaba caído**, el pedido queda **"NP pendiente"**. Se resuelve desde Programación: reintento automático cada 10 min y botón "Generar NP ahora".
   - Mientras siga pendiente, el despacho lo muestra en rojo, "NP pendiente: avisale a Programación", con un botón que avisa por WhatsApp a quien programó.
   - Queda la excepción gerencial de 18.4 (Bautista, Juan o Fernando, con motivo, para ese pedido y ese día) por si Zomatik sigue caído a la hora de despachar.
4. **Despacho manual (sin pedido programado): queda para más adelante.** Ahí se definirá si sale con "NP pendiente" o si la genera en el momento. En esta etapa el despacho manual sigue como hoy, sin el control de NP, y queda anotado en Actividad como "despacho manual sin NP".
5. **Cambios al orden de trabajo (18.6):** en Z2, "Generar NP ahora" va en Programación. El control del despacho bloquea los pedidos con "NP pendiente" (en modo aviso las 2 primeras semanas) y no incluye el despacho manual.
6. **Buscar el cliente sí o sí, y no dar de alta el mismo con otro nombre** (21/10, con la precisión del mismo día). Cuando se busca un cliente para un pedido (formulario de Programación, alta rápida, despacho manual), el buscador tiene que encontrarlo si existe, en Rebucret **o en Zomatik**. Solo si no aparece en ninguno de los dos se da de alta.
   - **Buscador unificado** (reemplaza el del pedido y el del despacho manual): busca a la vez en nuestros clientes y en la copia de Zomatik, sin tildes ni mayúsculas, por palabras en cualquier orden y por partes de palabra ("fide terc" → Fideicomiso La Tercera), por razón social, nombre y alias, por CUIT o DNI con o sin guiones, por nombre de obra (aparece su cliente) y por teléfono. Grupos: "En Rebucret", "En Zomatik (se trae al elegirlo)" y "Posibles parecidos" (trigramas, tolera errores de tipeo; sin dependencias). Elegir uno de Zomatik hace "Traer de Zomatik" en el momento. Un cliente de Zomatik ya vinculado (o con el mismo nombre que uno nuestro) aparece como nuestro: nunca se ofrece traerlo. Los dados de baja aparecen marcados ("reactivalo").
   - **Alta nueva, solo si no se encontró:** exige **CUIT válido** (11 dígitos con el dígito verificador). **No se acepta DNI** (el buscador sí encuentra por DNI si está cargado). Sin CUIT, solo un gerencial, con motivo. Antes de grabar se controla en los dos lados: el mismo CUIT (aunque el nombre sea otro) no deja crear y ofrece el existente; los nombres parecidos muestran "¿Es alguno de estos?" con su evidencia (obras, despachos, remitos), y para seguir hay que tocar "No, es otro cliente". Queda en Actividad quién lo dio de alta, con qué CUIT o por qué excepción, y qué parecidos descartó.
   - **Alias:** si se confirma que es uno existente ("Sí, es este"), el nombre escrito queda como alias de ese cliente. Al unificar, los nombres del que sale quedan como alias del que queda. El buscador encuentra por cualquiera.
   - **Duplicados nuestros:** la pantalla Vínculos lista los que parecen el mismo (mismo CUIT, nombre muy parecido, o mismas obras: 2 o más, o 1 con nombres parecidos), y un gerencial los **unifica**: obras, pedidos, despachos y respuestas R/X del día pasan al que queda, el código de Zomatik también (si el que queda no tiene), y el otro queda dado de baja apuntando al que quedó. Todo en una transacción (`unificar_clientes`, migración `202610212100`). La lista se calcula al abrir la pantalla con los datos del momento (en vez de una foto de la noche: siempre está al día).



---

## Respuestas de Bautista (21/10/2026, 7) — clientes, mandan sobre lo anterior

1. Se busca con el **buscador unificado** (21.6).
2. Si está en Rebucret **y** en Zomatik, se **vincula**.
3. Si está en Rebucret pero **no** en Zomatik, se **da de alta en Zomatik** con CUIT válido. Es etapa de escritura: la primera alta se hace **con Bautista el jueves 23/10 en la planta**, mirando qué graba Zomatik. Hasta entonces el botón "Dar de alta en Zomatik" está a la vista pero deshabilitado ("Se habilita después de la prueba con Bautista").
4. Si no está en ninguno, se da de alta **en los dos** con CUIT válido (el alta en Zomatik, también después del jueves).
5. **Desde ahora el CUIT es obligatorio.**
   - Pestaña **"Clientes sin CUIT"** en Vínculos: los activos sin CUIT válido, por m³ de los últimos 12 meses, con el CUIT del cliente de Zomatik vinculado ("Usar este") o un campo para cargarlo a mano.
   - Al cargar o cambiar un CUIT (esa pestaña, Editar cliente y el aviso del formulario de pedido) el servidor (`/api/clientes/cuit`) valida el dígito verificador (CUIT, no DNI) y que no lo tenga otro cliente de Rebucret ni otro de la copia de Zomatik (el suyo vinculado, sí).
   - Editar un cliente con un CUIT inválido de antes que no se cambia deja guardar los otros datos, con aviso.

---

## Hecho

### Z0 — lecturas, copia local, vínculos y "Traer de Zomatik" (obrero, 21/10/2026, rama `loop/zomatik`, sin push)

**Solo lee de Zomatik.** No hay ninguna función que mande un alta ni llame a `manage_*`, `grabar_*`, `generar_*` o `set_*`: el cliente tiene una **lista cerrada de rutas de solo lectura** y rechaza cualquier otra antes de salir (probado en `test:zomatik`).

**Migración** `supabase/migrations/202610211800_zomatik_z0_lecturas.sql` (**no aplicada**). Todo se agrega; compatible con main y con la Fase 3:
- `clients.zomatik_codigo` (único: dos clientes nuestros nunca pueden tener el mismo código) y `formulas.zomatik_articulo_codigo` / `_nombre`, cada uno con `zomatik_vinculo` (`auto` = primera carga, `manual` = lo confirmó un gerencial, `traido` = "Traer de Zomatik", `sin_par`), quién y cuándo.
- Copias: `zomatik_clientes` (listado + R/X del año + ficha), `zomatik_articulos`, `zomatik_proyectos` (saldo **solo en %**, ningún monto; vínculo con la obra en `construction_site_id`, como dice 18.5: varios proyectos pueden ir a la misma obra), `zomatik_proyecto_movimientos` (remito, NP, artículo, m³ por día), `zomatik_np_pendientes` (sin el total en pesos). **El navegador solo lee `zomatik_articulos` y `zomatik_lecturas`**; clientes, proyectos, movimientos y NP pendientes van por rutas del servidor con sesión (`/api/zomatik/clientes`, `/api/zomatik/acopios`).
- `zomatik_lecturas` + `zomatik_lectura_registrar()`: registro de cada lectura y freno con candado (una a la vez; "Actualizar" cada 5 min; cron una vez por hora).
- Datos ya cargados: no cambia nada; las columnas nuevas quedan nulas y las tablas vacías.
- Probada **dos veces en `BEGIN … ROLLBACK`** (cada una aplicándola dos veces), con `lock_timeout 2s` y `statement_timeout 60s`: 3,2 s y 2,6 s. Controla código repetido (rechazado) y vínculo sin código (rechazado). Tipos (`types/database.ts`) regenerados con la migración aplicada dentro de un ROLLBACK (2,4 s).

**Código**
- `lib/zomatik/cliente.ts`: copia adaptada de Concretus (login, sucursal REBUCRET 18, `discoverForm`, export XLSX y HTML, ficha por GET, XLS del acopio). **Un login por corrida** (y por proceso, uno cada 10 min como mucho); la cookie se reutiliza (en memoria y en `integraciones`, que solo lee la clave de servicio); ante **cualquier** falla del login (rechazo, sin cookie, red, sesión caída al elegir la sucursal) queda un bloqueo en `integraciones` para todos los procesos: 30 min si rechazó el usuario, 10 min si fue otra cosa. Las redirecciones no se siguen solas: cada `Location` se valida con la lista cerrada (solo los 5 listados que se usan, sus archivos `output/<listado>.xlsx`, la ficha del cliente, el XLS del acopio, login y home). 300 ms entre requests.
- `lib/zomatik/parseo.ts`, `foto.ts`, `vinculos.ts`, `acopios.ts`: funciones puras (parseo, nombre normalizado, CUIT, propuestas de vínculo, saldo en % y ≈ m³, avisos). `npm run test:zomatik`: **27/27**.
- `lib/zomatik/lectura.ts` + `/api/zomatik/leer`: **cron diario 03:30** (`vercel.json`) y botón "Actualizar" (gerencial). El cron se reconoce con `lib/cron.ts`: si está `CRON_SECRET`, solo con `Authorization: Bearer`; si no, por el header de Vercel como hasta ahora. Lo manual pide sesión de gerencial. Si la lectura del año trae menos del 70 % de los renglones guardados, no se borra ningún movimiento (puede ser un export cortado). Lee clientes, artículos, remitos del año, proyectos abiertos, historia de los proyectos viejos (una sola vez), tipo de proyecto, fichas y NP pendientes. Historia, tipos (6 por vez) y fichas (25 por vez) van de a poco, con presupuesto de 40 s.
- `lib/zomatik/traer.ts` + `/api/zomatik/traer-cliente` (`clientes.cargar`): crea el cliente **en nuestra base** con código, razón social, CUIT (solo si es válido), IVA, dirección, contacto y remito sugerido (solo X → X, solo R → R). **Nunca duplica**: si hay uno con el mismo código lo devuelve; con el mismo nombre normalizado o el mismo CUIT válido, no crea y avisa "pedile a un gerencial que lo vincule". Compara contra **todos** los clientes: si el que coincide está dado de baja, avisa "está dado de baja: reactivalo" y no crea ni lo devuelve. El índice único frena dos "Traer" a la vez.
- Alta de cliente (`add-client-dialog.tsx`, que es el alta rápida del pedido y del despacho manual, y el "Nuevo cliente" de Clientes): mientras se escribe el nombre o el CUIT aparecen "Ya está en Rebucret" y "En Zomatik (no está en Rebucret)" con **"Traer de Zomatik"**.
- **Bloque "Acopios"** abajo de la grilla de Programación (Semana y Día), como la maqueta: avance (% usado), remitido, saldo ≈ m³ y %, programado (lo que falta despachar de los pedidos de la obra vinculada, sin los suspendidos), última entrega y estado (saldo bajo con 7 días o 15 %, agotado). Cada fila se despliega al detalle por día con el acumulado. Filtro "con entregas en 90 días o programado" / "todos los abiertos". Sin precios ni $. "Actualizar" y "Vínculos", solo gerenciales; "Crear proyecto" deshabilitado.
- **`/zomatik` "Vínculos con Zomatik"** (gerencial, en el menú): clientes, fórmulas y proyectos ↔ obras, con las mismas propuestas que el script (seguro / dudoso), "Confirmar", "Elegir otro…", "No está" y "Confirmar los N seguros"; y la pestaña "En Zomatik sin cliente nuestro" con "Traer". Escribe con `/api/zomatik/vincular` y queda en Actividad.
- `scripts/zomatik-primera-carga.mjs`: Parte A solo lectura (por defecto), Parte B `--escribir` **termina en ROLLBACK**; `--escribir --commit` solo con el OK de Bautista. Graba solo los seguros y nunca pisa un vínculo.

**Lectura real de Zomatik, de punta a punta en local** (un login, solo lectura, sin tocar la base; lo crudo en el scratchpad): primera corrida en **29 s** con el presupuesto real.
- 467 clientes · 81 artículos (64 + 1 + 16) · 711 renglones de remito del año · **33 proyectos abiertos** (los 33 por monto) · 2.252 renglones de historia (3 años) · 42 NP pendientes · 123 fichas de clientes con remitos en el año (39 con CUIT válido; en la primera corrida entran 25 y el resto en las siguientes).
- Cargado en las copias dentro de un ROLLBACK (con la migración): 147 movimientos de proyectos del año + 516 de la historia. Acopios: 17 abiertos, 6 saldo bajo, 10 agotados según Zomatik; 23 con remitido, 7 con entregas en los últimos 90 días.

**Vínculos reales** (primera carga, Parte B en ROLLBACK, con las copias recién leídas):

| | Seguros (se graban) | Dudosos (a mano) | Sin par |
|---|---|---|---|
| Clientes (84 activos) | **15** (todos por nombre) | **51** | 18 |
| Fórmulas (67) | **28** (11 nombre igual + 17 con reglas, igual que 6.7) | 32 | 7 |
| Proyectos (33) | 0 | 5 | 28 (su cliente todavía no está vinculado) |

- Clientes seguros: son muchos menos que los ~59 de 6.3 porque acá "seguro" es **nombre igual** (sin tildes, S.A., ARQ, ING, FIDEICOMISO) y **único de los dos lados**. El relevamiento contaba como "igual" que un nombre estuviera contenido en el otro ("JUAN" ↔ "JUAN LOPEZ", "SAN VICENTE" ↔ "FELICIANO SAN VICENTE"), que no es seguro. Además hay repetidos nuestros ("MERVA" dos veces; "LA TERCERA" y "Fideicomiso La Tercera") que pasan a dudosos. CUIT: ningún par seguro (solo 3 CUIT válidos nuestros).
- Proyectos: la propuesta es entre las obras del cliente vinculado; cuando se confirmen los clientes en la pantalla, aparecen las propuestas de obra.
- Clientes de Zomatik con remitos en el año que siguen sin cliente nuestro: 108 (se traen con "Traer", desde la pantalla o el alta).

**Verificación**
- `npx tsc --noEmit`: 17 errores, los mismos de la rama base; ninguno nuevo.
- `npx next build --webpack` con variables de relleno: bien (`.next` borrado).
- `test:despacho` 27/27 · `test:gps` 44/44 · `test:sesion` 21/21 · `test:zomatik` 27/27.

**Para publicar (con el OK de Bautista)**
1. `ZOMATIK_USER`, `ZOMATIK_PASS` y **`CRON_SECRET`** en Vercel (proyecto Rebucret). Con `CRON_SECRET`, `/api/zomatik/leer` y `/api/gps/reconstruir` solo aceptan el cron con el Bearer (Vercel lo manda solo).
2. Aplicar la migración junto con el deploy.
3. Correr "Actualizar" (o esperar el cron). Para tener todas las fichas y tipos el mismo día, "Actualizar" 4 o 5 veces (cada 5 min).
4. `scripts/zomatik-primera-carga.mjs` Parte A, después Parte B (ROLLBACK) y, con el OK, `--escribir --commit`.
5. Confirmar los dudosos en `/zomatik`.

**Riesgos y pendientes**
- Se usa el usuario de Bautista (17.6): la cookie del robot y la sesión del navegador al mismo tiempo no se probaron (punto 13).
- Zomatik puede cambiar un listado: si vienen vacíos clientes, artículos o proyectos, la parte falla y no se marca nada como cerrado; el resto sigue.
- El cron de Vercel Hobby corre "dentro de la hora" programada; la lectura entra en ~30 s más el grabado (límite 60 s).
- El "programado" del acopio es por obra: si dos proyectos van a la misma obra, los dos muestran lo mismo (en Z2 cada pedido va a su proyecto).
- No se crean en esta carga los ~108 clientes de Zomatik del año sin par (11.4): se traen a mano con "Traer", así no entra nada sin mirar.
- Fuera de Z0 (no se hizo): crear NP, OF, remitos o clientes en Zomatik; cancelar NP; "sin NP no se despacha"; las 7 mejoras del formulario.

#### Ajustes de la revisión (21/10/2026)
- Rama al día con `origin/main` (Fase 3 publicada), sin conflictos.
- `package.json` de vuelta en CRLF: el diff es solo la línea de `test:zomatik`.
- Login: bloqueo en `integraciones` ante cualquier falla (30 min rechazo, 10 min otras). Redirecciones manuales validadas con la lista cerrada; si van al login, "sesión caída". Lista cerrada achicada a los 5 listados que se usan. **Hallazgo de la prueba real:** los export de remitos, acopio y pedidos redirigen a `output/<listado>.xlsx`; se permite solo ese archivo de esos listados.
- `CRON_SECRET` (`lib/cron.ts`) en `/api/zomatik/leer` y `/api/gps/reconstruir` (ahí era trivial: sin el Bearer, la llamada pasa por el freno como una manual). **No** se aplicó a `/api/alertas/stock-cero` (la llama también la base con pg_net, sin el secreto: se rompería) ni a `/api/reportes/calidad-semanal` (no tiene control hoy; sumarlo cambia cómo se manda a mano). Quedan anotados.
- Migración: sin `GRANT SELECT` del navegador en `zomatik_np_pendientes`, `zomatik_proyectos` y `zomatik_proyecto_movimientos`; el bloque Acopios y la pantalla Vínculos los leen por `/api/zomatik/acopios` (sesión + ver Programación).
- "Traer de Zomatik" compara contra los clientes dados de baja y avisa "reactivalo".
- `saldo_pct` acotado a ±999 (en la lectura real, 2 proyectos dan más de 100 %: Zomatik trae lo que resta mayor que el material).
- Acopios: "Programado" sin los pedidos suspendidos. `ultima_entrega` solo con hormigón. `maxDuration = 60` en `vincular`. Programación y despacho manual no repiten en la lista un cliente que "Traer" devolvió porque ya estaba.
- Verificación: tsc sin errores nuevos (17, los mismos de main) · build bien (`.next` borrado) · pruebas 27 + 44 + 21 + 27 · migración dos veces en ROLLBACK (3,7 s y 2,6 s) · copias + primera carga en ROLLBACK (5,3 s, mismos conteos). Lectura real de punta a punta: 29 s, sin errores, mismos conteos. Fueron **dos logins**: la primera corrida de verificación encontró la redirección a `output/*.xlsx` (bloqueada por la lista cerrada, como corresponde), y hubo que repetirla después de permitirla.

#### Vínculos con cruce por fechas y buscador unificado (21/10/2026, rama `loop/zomatik`)
- **Copias en producción cargadas** desde local (un login, solo lectura de Zomatik; transacciones cortas): 467 clientes, 123 fichas, 81 artículos, 33 proyectos (los 33 por monto), 663 movimientos, 43 NP pendientes. Los vínculos los confirma Bautista desde `/zomatik`.
- **Vínculos:** las propuestas las calcula el servidor (`/api/zomatik/propuestas`, gerencial), con el cruce de días y m³ en la misma planta (ventana de 3 días antes a 1 después, sumando) más el nombre, el artículo del remito igual a la fórmula y el CUIT. Confianza alta / media / baja con la evidencia en cada fila; 3 mejores candidatos solo por fechas; "Ver días" lado a lado; "Confirmar todas las de confianza alta" con resumen; pestaña Zomatik → Rebucret; genéricos fuera; "Faltan X clientes y Y fórmulas". Domicilio y obra del remito vienen vacíos en el export de Zomatik: no se usan.
  - Con los datos reales (y el resumen de remitos armado como lo va a grabar la lectura): **clientes 58 por resolver (7 alta, 17 media, 20 baja, 14 sin propuesta); fórmulas 36 (3 alta, 25 media, 1 baja, 7 sin propuesta); proyectos 33 (4 alta, 7 media, 12 baja, 10 sin propuesta).**
  - Un mismo código de Zomatik no puede ir a dos clientes nuestros (índice único): el segundo queda como "posible duplicado, unificar o cargar sus obras en el primero".
- **Migración `202610212000_zomatik_remitos_dia.sql`** (no aplicada): resumen diario de remitos por cliente, que llena la lectura. Sin ella, clientes y fórmulas se proponen solo por nombre.
- **Regla 21.6 (buscador unificado, alta con CUIT, alias, duplicados):** `lib/clientes-buscar.ts` (puro), `/api/clientes/{buscar,alta,alias,unificar}`, `components/clientes/{buscador-cliente,alta-conflicto}.tsx`. El buscador reemplaza el de Programación y el del despacho manual; el alta rápida y el "Nuevo cliente" pasan por `/api/clientes/alta`. Con los datos reales, el detector marca 15 pares de posibles duplicados.
- **Migración `202610212100_clientes_alias_unificar.sql`** (no aplicada): `client_alias`, `clients.unificado_*` y `unificar_clientes()`. Probada dos veces en ROLLBACK (2,4 s cada una, `lock_timeout` 2s): mueve obras y respuestas R/X, pasa el código de Zomatik, guarda alias, da de baja y deja Actividad; no deja unificar dos veces ni un cliente consigo mismo. Sin esta migración, el buscador y el alta andan igual (sin alias) y "Unificar" avisa que falta.
- Verificación: tsc sin errores nuevos (17, los de main) · build bien · `test:zomatik` 41/41, despacho 27, gps 44, sesión 21.

#### Ajustes de la revisión de `bcfd309` / `a313440` (21/10/2026)
- **Lectura de Zomatik desde local** (un login, solo lectura; transacciones de 0,8 a 1,4 s, solo tablas `zomatik_*`): `zomatik_remitos_dia` quedó con 463 renglones; copias refrescadas (467 clientes, 81 artículos, 33 proyectos, 147 movimientos del año, 43 NP pendientes).
- `unificar_clientes` (migración `202610212100`, sin aplicar):
  - obras con el mismo nombre en los dos (sin mayúsculas ni espacios de más): despachos, pedidos, `viajes_gps` y `zomatik_proyectos` pasan a la obra del que queda y la repetida se borra (son las únicas referencias a `construction_sites.id` en el esquema);
  - no deja unificar hacia un cliente dado de baja o ya unificado (sin ciclos), y los que apuntaban al que sale pasan a apuntar al que queda;
  - un `unique_violation` se devuelve como mensaje claro y no cambia nada; Actividad en los dos clientes;
  - probada dos veces en ROLLBACK (1,4 s y 0,7 s, `lock_timeout` 2s, todo en una sola ida a la base, sin transacciones abiertas) con el par real Fideicomiso La Tercera ← LA TERCERA: 2 obras juntadas (CANCHA PADEL y LA TERCERA), 15 pedidos y 43 despachos movidos, 0 referencias colgadas; más ciclos, hacia una baja y el choque de un índice único.
- `client_alias` sin lectura del navegador. El alta controla también el CUIT de Zomatik de los clientes ya vinculados (conflicto con el nuestro) y de los inactivos de Zomatik; con la excepción sin CUIT igual controla que el documento escrito no esté repetido; un nombre repetido en la misma planta (23505) sale como 409 claro.
- Un cliente unificado se muestra como "unificado en «X»" y se ofrece X (buscador, alta y "Traer de Zomatik").
- "Confirmar todas las de confianza alta" manda `soloSiLibre`: el servidor graba solo si todavía no hay vínculo.
- Verificación: tsc sin errores nuevos (17) · build bien · `test:zomatik` 43/43, despacho 27, gps 44, sesión 21.
- Pendiente para la 0c-2: `clients` sigue escribible con la clave anon.
- Segunda revisión (`f3c8ca6`, aprobada con cambios menores): al juntar obras repetidas, a la obra que queda se le copia de la repetida lo que tenga vacío (dirección, localidad, ubicación GPS con su fuente y fecha, km, tiempos, bomba, horario, contacto, teléfono, estado, remito R/X; las observaciones se suman) y en Actividad quedan las obras juntadas con los campos copiados. El buscador del alta y "Traer de Zomatik" piden solo las columnas necesarias más `unificado_en`, con respaldo si la columna todavía no existe. Prueba en ROLLBACK (0,8 s y 0,7 s, una sola ida, `lock_timeout` 2s): par real La Tercera, 2 obras juntadas (CANCHA PADEL y La tercera), 15 pedidos y 43 despachos movidos, 0 campos copiados (la obra que queda ya los tenía); caso de prueba con la obra que queda vacía: se copiaron dirección, ubicación GPS, teléfono y remito R/X, y se sumaron las observaciones.
- Respuestas 7 (21/10): pestaña "Clientes sin CUIT", `/api/clientes/cuit` (dígito verificador + no repetido acá ni en Zomatik) en Editar cliente y en el aviso del pedido, y "Dar de alta en Zomatik" a la vista pero deshabilitado hasta la prueba del jueves. `test:zomatik` 45/45.
- Formulario del pedido (pedido de Bautista del 21/10): ventana grande (hasta 1080 px) y compacta (letra 12–13 px, campos de 32 px, 2–3 columnas en PC, secciones "Cliente y obra", "Cuándo", "Hormigón" y "Más datos" plegado), con las 7 mejoras de 19.3: cliente y obra arriba, secciones, "Repetir el último pedido de esta obra" (copia fórmula, m³, descarga, bomba, m³ por camión, fibra y finalidad; si era de otra planta no copia la fórmula), resumen al pie, "Falta: …", textos ("Nuevo pedido", "Fórmula", "m³ del pedido", "Camión", "Cancelar pedido", "Dejar vacío") y R/X al lado de los m³. Sin cambios de lógica ni de campos.

---

## 22. Respuestas de Bautista (22/10/2026) — mandan sobre lo anterior

1. **En el pedido programado, el bloque Zomatik tiene solo dos opciones:**
   - **"NP nueva"**: NP común del cliente por lo programado ese día;
   - **"NP de un proyecto"**: NP contra un proyecto abierto del cliente, igual que el botón **MATERIAL** de Zomatik (`modificar_pedidos.php?proyecto=N&tipo=1`).
   - Ejemplo de Bautista: barrio cerrado con un proyecto de 1000 m³ por etapa. Cada día que se programa sale una NP contra el proyecto por lo de ese día.
   - **Una NP por pedido y por día, siempre generada por nuestro sistema.** Se saca la opción "usar una NP existente" de 16.2 c. El proyecto que se elige queda guardado en la obra para los próximos días.
2. **Los proyectos se siguen creando en Zomatik** (sin cambios respecto de 18.1).

---

## 23. Prueba real de NP con Bautista (22/10/2026) — mandan sobre lo anterior

Bautista cargó y grabó en Zomatik dos NP de prueba. Claude solo leyó la red y la página, porque el permiso del sistema no deja a Claude escribir en Zomatik.

1. **NP nueva:** NP 0001-00001175, código 157702. Cliente OBRA PROPIA REBUCRET (15893), Canning (116), lista 10247 "en 1", vendedor 100, 1 m³ de H21-620-10 C (CAN).
   - El artículo en el pedido es `farticulo=1000015959` (`articulos.codigo`). **No es** el `codigoint` 10090020 de nuestra copia: hay que guardar los dos.
   - **"Grabar" no devuelve el código:** redirige a `listado_pedidos.php`. El número sale de `_getnumerofactura.php` antes de grabar, y el código se busca en el listado por número (link `modificar_pedidos.php?codigo=N`).
   - `pedidos_unico` es la clave del borrador de cada formulario y viaja en cada `manage_pedidos.php`.
   - Zomatik muestra los errores de validación con `alert()`, por ejemplo "Vendedor debe ser completado". El robot tiene que validar antes de grabar.
2. **NP de un proyecto (MATERIAL):** `modificar_pedidos.php?proyecto=576&tipo=1`.
   - Trae cliente, vendedor (el del proyecto, 101), origen 3 y observaciones del proyecto.
   - El depósito viene en PILAR: hay que cambiarlo.
   - El comprobante y el número quedan bloqueados (muestra el número del proyecto). El número real lo asigna Zomatik al grabar.
   - "Continuar" (`manage_pedidos.php?...&fproyecto=576&forigen=3`) **trae el renglón del proyecto con lo disponible**: H30-620-10 C (CAN), cantidad 823,4. Sirve para mostrar el saldo en m³ al programar. Se cambia la cantidad a la del día y se graba.
3. **La sucursal la comparte el usuario, no la ventana.** El MATERIAL se abrió en REBUCRET, pero la NP se grabó en **RUTA 25 - CONCRETUS** (NP 0001-00007706, código 157703, numeración de Concretus). En esa ventana nadie cambió la sucursal.
   - Causa probable: el sistema de Concretus entra con el mismo usuario (stock de producto, materia prima, pagos, etc.) y hace `setSucursal(17)`.
   - **Bautista decidió (22/10) que por ahora no hay usuario aparte**, así que el robot tiene que blindarse:
     - (a) `setSucursal(18)` justo antes de pedir el número y de nuevo justo antes de grabar, con el menor tiempo posible entre medio;
     - (b) el número pedido tiene que ser de la serie de REBUCRET (NP 0001-00001xxx / NP2 0001-00002xxx; las de RUTA 25 van por 0001-00007xxx / 0001-00006xxx). Si no, no graba y reintenta;
     - (c) después de grabar, confirmar en el listado de REBUCRET que la NP existe con ese número. Si no aparece, buscarla en RUTA 25 por la marca en observaciones, dejarla en "revisar" y **avisar al gerencial en el momento** para vaciarla;
     - (d) cada NP lleva una marca en observaciones ("Sistema Rebucret · pedido N") para encontrarla siempre;
     - (e) una sola sesión del robot a la vez (cola).
   - `modificar_pedidos.php?codigo=N` abre la NP sin importar la sucursal activa.
4. **Cancelar una NP:** no hay "borrar NP". Se borran los renglones (tacho, `verificar(id)` → `manage_pedidos.php?...&fborrar=id`) y se graba. La NP queda con total 0 y sin ítems. Así quedaron 1175 y 7706.
   - El tacho pide `confirm()`: en un navegador sin diálogos no anda, pero el robot llama directo.
   - **Falta ver** si al vaciar la NP del proyecto el saldo vuelve a 823,4 (abrir MATERIAL), y qué estado muestra el listado (PEN / REM).

---

## 24. Z2: especificación (22/10/2026, arquitecto + obrero, rama `loop/zomatik`)

Manda la sección 23, después la 22 y después el resto. **Sin aplicar y sin probar contra Zomatik**: el robot se probó solo con respuestas simuladas.

### 24.1 Qué entra
1. **Bloque "Nota de pedido (Zomatik)"** en el formulario del pedido de Programación, después de "Hormigón":
   - **NP nueva**: NP o NP2 según el remito (R/X), con la lista activa "en 1" / "en 2" (5.3 y 20.2), que elige el robot;
   - **NP de un proyecto**: proyectos abiertos del cliente, con lo disponible en m³ (el ≈ de `zomatik_proyectos` y lo que trajo "Continuar" del MATERIAL la última vez, 23.2). Si el pedido no entra, aviso rojo con las tres opciones de 20.4. El proyecto elegido queda en la obra y se propone solo los días siguientes.
   - El botón pasa a "Programar y generar NP". Con la llave apagada, el bloque dice "NP: se carga a mano en Zomatik" y todo sigue como hoy.
2. **Una NP por pedido y día, siempre del sistema.** Si el pedido se agranda, NP adicional por la diferencia (también desde "Editar total" del despacho). Si se cancela, se **vacía** (renglones borrados y grabar, 23.4); con remitos no se toca y se avisa. Si se achica, **no se hace nada** (aviso; pregunta 24.8.1).
3. **Robot** (`lib/zomatik/np-robot.ts`), exactamente como la sección 23: sucursal 18 antes del número y antes de grabar; el número tiene que ser de la serie de REBUCRET; después de grabar se busca por número en el listado y se confirma la marca "Sistema Rebucret · pedido N · NP n" en observaciones; si no está, se busca la marca en RUTA 25 y queda **revisar** con aviso por mail a Bautista, Juan y Fernando. Una sola sesión del robot a la vez. Un "Grabar" cortado nunca se repite a ciegas: primero se busca la marca desde el día en que se creó la NP.
4. **Estados** en el pedido (tarjeta de la grilla Semana y despacho), con el mensaje de Zomatik a la vista. **"Generar NP ahora"** en el menú ⋯ del pedido (`programacion.cargar`). Reintento automático cada 10 min (24.6).
5. **Despacho**: pedido sin NP en rojo, "NP pendiente: avisale a Programación". **Modo aviso** 2 semanas desde que se prende la llave (deja despachar y lo anota); después **modo duro** (no deja). Excepción de un gerencial con motivo, para ese pedido y ese día. Despacho manual sin control, anotado en Actividad.
6. **Llave por planta** (`zomatik_np_config.activo`, apagada por defecto) en "Vínculos con Zomatik" › "NP automática", con la lista de NP para revisar. Solo los pedidos cargados **después** de prenderla tienen NP automática.
7. Todo queda en **Actividad** (entidad "Nota de pedido (Zomatik)").

No entra: alta de cliente en Zomatik, OF y remito (Z3), "Cargar pedido › NP para un proyecto" del Dashboard (18.2), el botón de WhatsApp de 21.3 y el chip en la vista Día.

### 24.2 Archivos
| Archivo | Qué |
|---|---|
| `lib/zomatik/web.ts` | La lista cerrada de rutas pasa acá (estaba en `cliente.ts`, que la reexporta). Grupo aparte `rutaEscrituraNp`: alta, MATERIAL y apertura de la NP, `traerdatossecundarios`, `_getnumerofactura` (15/16), `listado_listas`, `manage_pedidos` (sin `fautorizar`/`faccion`) y `grabar_pedidos` |
| `lib/zomatik/cliente.ts` | `navegadorNp(llave)`: sin seguir redirecciones; el grupo de la NP solo con la llave |
| `lib/zomatik/np.ts` | Puro: estados, serie, marca, lectura de páginas, latin1, `planificarNp`, `modoNp`, `controlDespacho` |
| `lib/zomatik/np-robot.ts` | Robot con navegador inyectado: `generarNp` (nueva / proyecto) y `vaciarNp` |
| `lib/zomatik/np-servidor.ts` | Sincronizar pedido, tomar y procesar, guardar estados, Actividad, mail a gerenciales, pasada |
| `app/api/zomatik/np/*` | `np` (estado, sincronizar, generar, revisada), `procesar` (cron y Programación abierta), `excepcion`, `llave`, `proyectos` |
| `lib/zomatik/np-cliente.ts`, `components/zomatik/np-*.tsx`, `components/despacho/np-aviso.tsx` | Pantallas |
| `components/dispatch-scheduling.tsx`, `components/despacho/{despacho-tablero,columna-pedidos,entrega-dialog}.tsx`, `components/zomatik/pantalla-vinculos.tsx` | Enganches |
| `lib/zomatik/{parseo,foto,lectura}.ts` | La lectura guarda el "Codigo Sistema" del artículo (lo que va en `farticulo`, 23.1) |
| `supabase/migrations/202610222200_zomatik_np.sql` | Migración (**sin aplicar**) |
| `lib/__tests__/zomatik-np.test.mjs` + `lib/__fixtures__/zomatik-np/` | `npm run test:zomatik-np` |

### 24.3 Tablas (migración `202610222200_zomatik_np.sql`, sin aplicar; correrla fuera de horario)
- `zomatik_np_config` (por planta): `activo` (false), `desde`, `deposito` (Canning 116, Hudson 113), `exigir_np` (aviso/duro), `aviso_hasta`. **Solo la escribe el servidor**: no va en `plants` porque `plants` la puede escribir la clave anon.
- `zomatik_np_pedido` (por pedido): `tipo`, `proyecto_codigo`, `tope_m3`. Solo el servidor, que valida que el proyecto esté abierto y sea del cliente. `construction_sites.zomatik_proyecto_codigo` es solo una sugerencia para el formulario.
- `zomatik_articulos.codigo_sistema`; `zomatik_proyectos.disponible_m3 / _articulo / _at`.
- `zomatik_np` (una fila por NP: marca única, estado, paso, mensaje, número, código, sucursal, reintento) y `zomatik_np_excepciones` (si se borra el pedido queda, con una copia). El navegador solo lee `zomatik_np` y las excepciones.
- Funciones `zomatik_np_tomar`, `zomatik_robot_tomar/soltar` (también las usa la lectura Z0) y el trigger `trg_dispatches_zomatik_np` (BEFORE INSERT en `dispatches`). **`registrar_despacho` no se toca**.
- **Datos ya cargados:** no cambia ninguno; `plants` y `scheduled_dispatches` no se tocan. Una fila de config por planta con la llave apagada; el resto, vacío. El trigger solo mira despachos nuevos con la llave prendida.
- Probada en `BEGIN … ROLLBACK` (lock_timeout 2 s): aplicada dos veces seguidas; anon no puede leer ni escribir la config ni la elección; modo duro frena; el despacho de prueba y el autorizado quedan en Actividad.

### 24.4 Estados de la NP
`pendiente` (reintento cada 10 min) → `generando` → `ok` · `revisar` (otra sucursal, no aparece después de grabar, cancelado con remitos o cortado al grabar) · `error` (falta un dato o Zomatik dijo que no: no se reintenta sola hasta que cambie el pedido o se apriete "Generar NP ahora"). Cancelado: `vaciar` → `vaciando` → `vaciada`; lo que nunca llegó a Zomatik, `anulada`. "Generando" colgado más de 3 min = corte: primero se busca la marca.

### 24.5 Criterios de aceptación
1. Llave apagada: ninguna ruta de escritura se puede pedir (la lista cerrada la rechaza antes de salir) y el pedido muestra "NP: se carga a mano en Zomatik".
2. Llave prendida: al programar, la NP aparece en la tarjeta en verde con su número en menos de un minuto, o en rojo con el mensaje.
3. El número usado siempre es de la serie de REBUCRET; si viene de RUTA 25, no se graba.
4. Si quedó en RUTA 25: "revisar", número a la vista, mail a los gerenciales, y la sesión vuelve a REBUCRET.
5. Corte en "Grabar": nunca hay dos NP del mismo pedido y número de NP.
6. Cancelar: NP sin ítems (vaciada) o, con remitos, "revisar" y aviso. Agrandar: NP adicional por la diferencia.
7. Despacho: en aviso deja y anota; en duro no deja sin NP ni excepción; la excepción la da un gerencial con motivo.
8. `npm run test:zomatik-np` (51), las demás pruebas, tsc sin errores nuevos y build bien.

### 24.6 Reintento cada 10 min
`/api/zomatik/np/procesar`: GET solo con `Authorization: Bearer <CRON_SECRET>`; POST con sesión. **Vercel Hobby no deja crons de 10 min** (un `*/10` en `vercel.json` haría fallar el deploy): por eso `vercel.json` tiene uno diario (07:00) y, además, Programación abierta pide la pasada cada 10 min (el servidor hace como mucho una cada 9 min). Para cada 10 min sin nadie mirando, ver 24.8.3.

### 24.7 Antes de prender la llave (con Bautista)
1. Aplicar la migración y correr "Actualizar" en Vínculos (para el "Codigo Sistema" de los artículos).
2. **La primera NP real, con Bautista mirando**: las respuestas de `manage_pedidos.php` no se guardaron el 22/10 y el robot las lee como se supone (`codigo…`, `costo…`, `cantidad…`, `verificar(id)`). Si no coinciden, para con "Zomatik cambió el formulario" sin grabar nada. Después se vacía a mano. Verificar también, en el resultado de `listado_pedidos.php?enviado=1`:
   - que la página trae el selector `frm_selsuc` con la sucursal activa marcada (si no lo trae, toda búsqueda por la marca da "no concluyente" y la NP queda "revisar");
   - que `bus_deposito` filtra por depósito (116 / 113) y `bus_fechad`/`bus_fechah` por la fecha de la NP;
   - cómo se ve el paginado (link "Siguiente", `pagina=`) y cuántas filas trae una página (se supone 300).
3. Prender la llave de una planta (arranca el modo aviso de 2 semanas).

### 24.8 Preguntas para Bautista (con recomendación)
1. **Pedido que se achica después de tener NP.** Hoy solo se avisa. **Recomendación:** no tocar la NP al achicar. Al "Finalizar pedido" (Z3) se remite lo despachado y en el mismo paso se baja la cantidad del renglón de la NP a lo remitido (mismo mecanismo que vaciar, con otra cantidad). Así la NP se toca una sola vez.
2. **Pedido que cambia de fórmula, fecha, planta o cliente con la NP ya hecha.** Hoy solo avisa "revisala". **Recomendación:** si no tiene remitos, vaciar la vieja y generar una nueva, solo.
3. **Reintento cada 10 min sin Programación abierta.** **Recomendación:** pg_cron en Supabase (habilitar la extensión y guardar `CRON_SECRET` en vault; el SQL está comentado al final de la migración). Otra opción: un programador externo con el Bearer.
4. **Cliente sin vendedor en Zomatik:** hoy la NP queda en error "cargáselo en su ficha". **Recomendación:** dejarlo así (no inventar vendedor).
5. **Aviso al gerencial:** por mail (Resend) a Bautista, Juan y Fernando. **Recomendación:** mail por ahora; WhatsApp cuando se haga el botón de 21.3.
6. **NP de proyecto con otros renglones** (bomba, servicios): el robot los saca y deja solo la fórmula del pedido. **Recomendación:** sí.
7. **Serie de REBUCRET:** punto 0001, números del 1.000 al 5.999 (RUTA 25 va por 6.xxx y 7.xxx). **Recomendación:** confirmar con Zomatik que no hay otros talonarios.
8. **Excepción "despachar sin NP":** hoy la da un gerencial con su sesión, en el equipo donde está. **Recomendación:** dejar así; la clave en otro equipo o el link por WhatsApp (18.4) para más adelante.

### 24.9 Hecho y verificación (22/10)
- Paso 0: `origin/main` unificado en `loop/zomatik` (conflicto solo en `package.json`, se quedaron las dos partes).
- `npm run test:zomatik-np`: 34/34 (robot con fixtures, serie, sucursal equivocada, corte en Grabar, reintento al otro día, proyecto, vaciar, plan, modos y lista cerrada). Las demás: gps 51, sesión 26, despacho 28, carga 39, fórmulas 22, zomatik 45.
- tsc: 17 errores, los mismos de la base; ninguno nuevo. `next build --webpack` bien (`.next` borrado).
- No se llamó a Zomatik ni se usaron las credenciales. La base solo se leyó; la migración se probó en ROLLBACK.

### 24.10 Cambios de la revisión (22/10)
- **B1:** la llave y el modo pasan a `zomatik_np_config`, y la elección del pedido a `zomatik_np_pedido`. Las dos tablas son solo del servidor (la clave anon no las ve ni las cambia). El proyecto se valida contra el cliente.
- **B2:** la marca se busca por depósito y fechas (y `bus_sucursal=18` en REBUCRET), abriendo **todas** las NP, sin filtrar por nombre: la NP se graba con la razón social de Zomatik. No es concluyente si la página vino de otra sucursal, tiene más de una página, hay más de 25 NP o alguna no abre. En ese caso queda **revisar** y no se vuelve a generar.
- **I1:** el tiempo se cuenta desde que empieza el request. No se arranca una NP con menos de 30 s. Primero se sincroniza la base (la pasada, como mucho 20 s) y después trabaja el robot. El turno dura 60 s y se renueva en cada paso.
- **I2:** anular y revisar solo si la NP sigue pendiente o con error. El robot guarda cada paso y el resultado solo si la NP sigue "generando"/"vaciando". Si cambió, se corta antes de grabar; si ya grabó, se avisa y no se pisa.
- **I3:** el proyecto de la obra se propone solo en el alta, o si el pedido no tiene elección guardada.
- **I4:** la lectura Z0 pide el mismo turno del robot y vuelve a elegir la sucursal 18 antes de cada búsqueda o export.
- **Menores:**
  - M1: `bus_sucursal=18`.
  - M2: vaciar solo graba sobre esa NP (nunca `codigo=0`).
  - M3: el despacho de prueba sin NP queda en Actividad.
  - M4: la excepción vale por el día de `dispatch_date` y no se borra con el pedido.
  - M6: aviso de correr la migración fuera de horario.
  - M7: `lib/__tests__/zomatik-np-servidor.test.mjs`, con una base y un navegador simulados: llave apagada, carreras, elección, tiempo y lógica del trigger.
- Pruebas: `test:zomatik-np` 47/47. Las preguntas de 24.8 siguen sin respuesta y no se tocaron.

### 24.11 Cambios de la segunda revisión (22/10)
- **I-A:** al rehacer una NP que todavía no llegó a Zomatik, si el robot la tomó en el medio, se anulan menos de las planeadas. En ese caso no se crea la nueva: la próxima sincronización vuelve a planear.
- **I-B:** la búsqueda es dudosa ante cualquier señal de paginado: "Página X de Y", link "Siguiente", `pagina=` o 300 filas.
- **I-C:** una NP colgada en "generando"/"vaciando" más de 3 veces queda "revisar", con aviso a los gerenciales. La búsqueda por la marca renueva el turno en cada NP que abre.
- **Menores:**
  - comentarios viejos de `plants` corregidos;
  - `faltaMigracion` mira solo los nombres nuevos;
  - al editar un pedido, la elección no se manda hasta leer la guardada (y el proyecto de la obra no se propone antes);
  - la lectura Z0 renueva su turno cada 20 s.
- `test:zomatik-np` 51/51.

---

## 25. Respuestas de Bautista (23/10/2026) — mandan sobre lo anterior

Responden las 8 preguntas de 24.8. Lo que cambia de Z2 está programado en `loop/zomatik`, con la migración `202610231000_zomatik_np_saldo.sql` **sin aplicar**. La de Z2, `202610222200`, ya está aplicada.

### 25.1 Lo que dijo Bautista
1. **Pedido finalizado con sobrante:** "se finaliza el pedido y se hace una devolución para que coincida con lo que se remitió, y cierra en el sistema".
2. **Cancelar y cambiar la fecha:** no rehacer solo. "El hecho de reprogramar sucede mucho ya que cuando llueve se cancelan las obras. La NP sigue abierta y la persona tiene que decidir reprogramar." Las pendientes figuran en Programación. "Tal vez la NP es mayor a lo que se pide ese día."
   - **Precisión:** "reprogramar no es instantáneo, no se sabe cuándo se va a retomar la obra. Que quede pendiente."
3. Pasada cada 10 min con **pg_cron**: sí.
4. **Vendedor:** el del **usuario que programa**, no el del cliente.
5. a 8. **OK** a la recomendación: mail ahora y WhatsApp después; en MATERIAL solo el renglón de la fórmula; serie 1000–5999; excepción solo con la sesión de un gerencial.

### 25.2 Cómo queda
- **Una NP puede servir a varios pedidos** (`zomatik_np_uso`: qué pedido usa qué NP y por cuántos m³).
  - **Saldo** de una NP = sus m³ − lo que reservan los pedidos activos − lo despachado de los demás.
  - Lo despachado de un pedido se reparte entre sus NP en el orden en que se crearon.
- **Cancelar el pedido no toca la NP.** Pasa sola a **"NP con saldo: pendiente"**, sin ningún diálogo; solo el aviso "La NP queda pendiente en Programación". Lo que nunca llegó a Zomatik se anula, como antes.
- **Lista "NP con saldo"** en Programación (Semana): NP del sistema en Zomatik con saldo y sin pedido activo.
  - Muestra **desde cuándo** está pendiente y **no vence**.
  - Queda ahí hasta que alguien toque:
    - **Reprogramar:** abre el formulario con cliente, obra, fórmula, planta y saldo precargados, y la opción **"Usar NP con saldo"** elegida. El pedido toma de esa NP lo que necesita, sin generar otra. Si no alcanza, el resto va en una NP nueva.
    - **Devolver el saldo:**
      - si la NP no tuvo despachos, se vacía (23.4; el robot controla antes que no tenga remitos);
      - si tuvo despachos o remitos, hace falta una **devolución de pedido (DEVOL)**, que todavía no hace el sistema (25.3). Queda "Devolver" con el aviso de hacerla a mano y el botón "Ya la devolví".
  - "Dejar abierta" no va: con la precisión, pendiente ya es dejarla abierta.
- **Bloque del pedido:** tres opciones, "NP nueva", "NP de un proyecto" y **"Usar NP con saldo"**. Esta última solo muestra NP del sistema del mismo cliente y artículo, con algo libre. Reemplaza la "usar NP existente" que se sacó en 22.1. Al editar, el bloque queda deshabilitado hasta leer la elección guardada (observación 2 del revisor).
- **Cambiar la fecha de un pedido con NP:** el formulario pregunta "¿Mover la NP a la nueva fecha?".
  - **Sí:** cambia la fecha solo en nuestro sistema; en Zomatik no hace falta (25.5). La fecha con que se grabó queda en `fecha_zomatik`, de registro.
  - **No:** el pedido deja de usarla (queda pendiente con su saldo) y se genera una NP nueva.
- **Cambiar la fórmula, el cliente o la planta:** avisa y no toca la NP vieja (queda pendiente con su saldo). Se genera una nueva para el pedido.
- **Agrandar:** primero vuelve a usar lo libre de su NP; después, NP adicional por la diferencia (sigue igual).
- **Achicar:** el pedido reserva menos y lo que sobra queda de saldo en la NP. Al finalizar se devuelve o se reprograma.
- **Vendedor:**
  - el de quien programa (`zomatik_vendedores`: Fernando Maldonado 100, Juan Oreguy 101, Felipe Calvo 123; lo edita un gerencial en Vínculos › NP automática);
  - si no tiene (David, Titan, Bautista), el del cliente;
  - si tampoco, error "cargale el vendedor".
  - En la NP de proyecto, el de quien programa reemplaza el del proyecto; si no tiene, queda el del proyecto.
- **pg_cron:** la pasada cada 10 min está al final de la migración nueva.
  - Antes, Bautista guarda en Vault el mismo `CRON_SECRET` de Vercel: `select vault.create_secret('<CRON_SECRET>', 'cron_secret');`.
  - Llama a `https://www.produccionrebucret.com/api/zomatik/np/procesar` (**confirmar el dominio**).
- **Trigger del despacho:** el pedido tiene NP si usa una NP "ok" (`zomatik_np_uso`).

### 25.3 Finalizar el pedido con sobrante → devolución (diseño, va con Z1; sin implementar)
Al **finalizar el pedido** (Z1: OF + remito), si la NP tiene más de lo remitido:
1. Se hace el remito por lo despachado (Z1).
2. Si a la NP le queda saldo y **no hay otro pedido activo usándola**, se hace una **devolución de pedido** por la diferencia: `listado_pedidosdevolucion.php?pedido=N` › alta `modificar_pedidosdevolucion.php?pedido=N` (DP o DP2, 20.5).
3. La NP queda **cerrada** (`saldo_decision = cerrada`), con el número de la DP guardado y "Sistema Rebucret · pedido N · DEVOL" en las observaciones (misma marca, para buscarla si se corta).
4. Si hay otro pedido usándola, no se devuelve nada: el saldo sigue para ese pedido.
5. Mientras no esté el robot de DEVOL: el saldo queda en "NP con saldo" (Devolver › a mano › "Ya la devolví").

Mismo blindaje que la NP: sucursal 18, marca, una sesión a la vez, sin repetir a ciegas un "Grabar" cortado.

### 25.4 Para probar con Bautista en Zomatik (se suma a 20.6 y 24.7)
1. **DEVOL** (`modificar_pedidosdevolucion.php?pedido=N`):
   - qué campos pide y qué número da;
   - si deja la NP sin pendiente;
   - con una NP remitida en parte;
   - con una NP de proyecto (¿vuelve el saldo al proyecto?).
2. ~~`CambiarFechaEntrega`~~: no hace falta (25.5).
3. Que el vendedor de quien programa (`idvendedor` + `vendedor_manual=1`) quede bien en la NP nueva y en la de proyecto.
4. Lo de 24.7.2: `frm_selsuc` en las páginas de resultado, `bus_deposito`, paginado y renglones de `manage_pedidos`.

### 25.5 Respuestas de Bautista a 25.4 (23/10)
1. **DEVOL:** está el botón "DEVOL" en Clientes › Pedidos, en cada fila del listado ("FC / FC / DEVOL", visto el 22/10). El formulario sigue sin probar: el robot de DEVOL queda para la prueba con Bautista (25.3).
2. **Fecha:** "En Zomatik no es necesario cambiar la fecha, sí en el mío." Mover la NP a otra fecha cambia solo nuestro sistema. Se sacó el aviso de cambiarla a mano y no se intenta `CambiarFechaEntrega`.
3. **Vendedor:** confirmado, "pone la persona que carga". Queda como en 25.2.

### 25.6 Migración nueva `202610231000_zomatik_np_saldo.sql` (sin aplicar; fuera de horario)
- **Agrega:**
  - `zomatik_np_uso`, que se llena con un uso por cada NP que ya exista (hoy no hay ninguna);
  - en `zomatik_np`: `saldo_decision`, `saldo_desde`, `saldo_mensaje` y `fecha_zomatik`;
  - en `zomatik_np_pedido`: el tipo `saldo` y `np_id`;
  - la tabla `zomatik_vendedores`, con los tres vendedores cargados.
- **Cambia:** el trigger del despacho.
- **Programa:** pg_cron.
- Solo el servidor escribe las tablas nuevas.
- Datos ya cargados: no cambia nada (no hay NP y la llave está apagada en las dos plantas).
- Probada dos veces en `BEGIN … ROLLBACK` (lock_timeout 2 s, 5 s). Resultados:
  - vendedores 100/101/123 cargados;
  - pg_cron programado;
  - anon sin acceso;
  - modo duro: frena sin uso y deja con uso;
  - tipo `saldo` aceptado.
- **Hay que aplicarla antes de prender la llave:** sin ella, Programación y Vínculos dicen "falta aplicar la migración".

### 25.7 Verificación
`test:zomatik-np` 58/58 (plan con usos, saldo, cancelar sin vaciar, reprogramar, devolver, vendedor), las demás pruebas, tsc sin errores nuevos y build bien.

### 25.8 Cambios de la revisión de `5548ecc` (23/10)
- **B1, el mismo saldo dos veces:** reservar, agrandar y devolver se hacen en la base, con la NP bloqueada (`FOR UPDATE`): `zomatik_np_reservar`, `zomatik_np_devolver` y `zomatik_np_saldo`. Si otro tomó el saldo en el medio, se reserva menos y lo que falta va en una NP nueva, con aviso.
- **B2, un uso desactivado:** al desvincular queda la foto de lo despachado hasta ese momento (`despachado_fijo`, `zomatik_np_desvincular`). El resto de lo despachado se reparte solo entre los usos activos. El caso del revisor da NP1 con 10 libres y NP2 con 0.
- **I1:** la pasada ya no mira pedidos cancelados o completos ni NP cerradas, y un aviso igual al último del pedido no se vuelve a grabar.
- **I2:** sin ninguna llave prendida ni NP para trabajar, el robot no toma el turno. La lectura diaria espera hasta ~30 s el turno antes de rendirse.
- **Menores:**
  - "Ya la devolví" lo marca solo un gerencial, con motivo (queda en Actividad), y solo si la NP estaba esperando la devolución.
  - Un pedido que usa una NP de Zomatik no se puede eliminar (trigger): se cancela y la NP queda pendiente.
  - El vendedor de una NP nueva es el del usuario de la sesión que guarda el pedido en ese momento (`zomatik_np.vendedor_usuario_id`), no `created_by`.
  - No queda nada de cambiar la fecha a mano en Zomatik (`cb7c189`).
- La migración `202610231000` (sin aplicar) suma esas funciones, `despachado_fijo`, `vendedor_usuario_id` y el trigger de borrado. Probada en ROLLBACK:
  - el caso B2 da 10 libres y 0;
  - dos reservas de 8 sobre 10 dan 8 y 2;
  - devolver con un pedido activo se rechaza;
  - reservar después de devolver da 0;
  - borrar un pedido con NP se rechaza.

  La concurrencia real la garantiza el `FOR UPDATE`; no se probó con dos sesiones contra la base de producción.
- `test:zomatik-np` 65/65.

### 25.9 Pasada final del revisor (23/10)
- **I-1:** la NP nueva y su uso se crean juntos, en una sola función de la base (`zomatik_np_crear_con_uso`): nunca queda una NP sin uso. Como resguardo, si una NP propia viva no tiene uso, `sincronizarPedido` se lo repone en vez de generar una segunda.
- **Borrar un pedido:**
  - Si sus NP todavía no llegaron a Zomatik (pendiente o con error, sin un "Grabar" cortado), se deja borrar y esas NP se anulan.
  - Si alguna ya está en Zomatik, la base lo frena con "Cancelalo (la NP queda pendiente en Programación)", y Programación y el Historial muestran ese mensaje.
  - El Historial ahora borra primero y recién después anota en Actividad y avisa.
- Probado en ROLLBACK:
  - el alta con uso funciona y una repetida no duplica;
  - se puede borrar un pedido con su NP pendiente, que queda anulada;
  - borrar un pedido con su NP ok se rechaza.
- `test:zomatik-np` 66/66.

### 25.10 Arreglos de la prueba del 28/10 (rama `fix/np-formulario`)
- **"Guardar" ya no depende de la NP.** Al editar, el formulario pide el estado de la NP de **ese** pedido aparte (5 s como mucho), sin depender de la lista de la semana. Si no llega, dice "NP: no se pudo leer, se mantiene la elección", se puede guardar igual y la elección que tenía no se toca.
  - **Causa:** un "volver a mirar en 12 s" pedía la NP con la lista vieja de pedidos y su respuesta pisaba la nueva; el pedido "desaparecía" y el bloque quedaba leyendo para siempre. Ahora vale solo la última respuesta, siempre con la lista de ahora.
  - La fórmula vieja al reabrir: el formulario no se resetea con la NP. Se veía H25 porque el pedido nunca se pudo guardar.
- **Buscador de fórmulas:** encuentra por partes y sin importar guiones, espacios ni paréntesis ("h21 620", "h21-620-10", "620 10 c").
- **Alta del pedido: la primera pregunta es "¿Qué NP?"**, solo con la llave prendida. Tiene tres opciones:
  - NP nueva;
  - de un proyecto: elegís el proyecto y completa cliente y obra;
  - usar NP con saldo: elegís la NP y completa cliente, obra, fórmula y m³.

### 25.11 Lista de precios única (28/10, rama `fix/np-lista-unica`)
En Zomatik crearon "Lista OCTUBRE 2026" (activa, sin "en 1" ni "en 2") y pasaron las de septiembre a invisibles. Bautista: "a fines prácticos usá esa".
- Si hay una sola lista activa, se usa para la NP y la NP2.
- Si hay varias, se elige la "en 1" (NP) o la "en 2" (NP2), y tiene que quedar una sola.
- Si no hay ninguna, o no queda una sola, no se genera la NP ("Revisar las listas en Zomatik").
- La NP n=2 del pedido `42a614e6` quedó en error. Cuando esto esté publicado, se reintenta con "Generar NP ahora".

### 25.12 Renglón real de `manage_pedidos.php` (28/10, rama `fix/np-renglon-real`)
La NP n=2 de `42a614e6` frenó en "articulo" ("el detalle trajo otros renglones"): el robot buscaba el renglón por `codigo<id>`, pero ese es el **id del renglón** (5349423) y no el del artículo.

- Los fixtures ahora son la respuesta **real** capturada el 28/10.
- El renglón del artículo se reconoce por el **código visible** de la 1.ª celda (10090020 = `zomatik_articulos.codigo`) o por el nombre.
- `fparam` = `codigo,costo,cantidad,observación|||` con el valor de `codigo<id>` (el id del renglón). Así lo arma `GrabarDatosDetalle()` en el JavaScript de `modificar_pedidos.php` guardado el 20/10.
- Al grabar van todos los campos del renglón (peso, hcosto, apallet, palletcant, coeficiente…) y los sueltos del detalle (credito, compraactual, compraactualsib, totalacopio), como el navegador.
- Si el detalle no coincide, el error guarda en Actividad un recorte de unos 2 KB de la respuesta de Zomatik.

### 25.13 Primera NP real y cancelar con NP (28/10, rama `fix/np-cancelar-y-marca`)
- **Primera NP real:** NP2 0001-00002086 (código 157767), sucursal 18. Cliente, depósito, fecha, artículo, 1 m³, lista 10248 y vendedor 100: todo bien.
- **Marca:** en Zomatik el "·" quedaba como "�". La marca nueva usa guiones: "Sistema Rebucret - pedido N - NP n". La búsqueda encuentra también las ya grabadas con "·", "Â·" o "�".
- **Cancelar pedido con NP en Zomatik** (Programación y Despacho) pregunta "¿Cancelar también la NP en Zomatik?":
  - **No, dejala pendiente:** por ejemplo, por lluvia; queda en «NP con saldo» para reprogramar.
  - **Sí, cancelarla:** la vacía en el momento, como «Devolver el saldo».
  - Sin elegir, no se cancela.
  - Si el pedido ya tuvo despachos, solo se puede dejarla pendiente, con el aviso de que hace falta una DEVOL.
  - Los permisos son los mismos de siempre.
  - Con la llave apagada no pregunta nada.

### 25.14 Vaciar de verdad (28/10, rama `fix/np-vaciar-real`)
- **Qué pasó:** "Sí, cancelarla" dio por "vaciada" la NP2 0001-00002086 (código 157767), pero en Zomatik siguió con su renglón.
- **Causa:** la página de la NP abierta (`modificar_pedidos.php?codigo=N`) no trae los renglones en el HTML; el navegador los carga después con `manage_pedidos.php`. El robot leyó la página, no vio renglones y la dio por vaciada "porque ya estaba vacía": no borró ni grabó nada. Coincide con los 2 s que tardó (solo el control de remitos y abrir la página).
- **Ahora:**
  1. Lo que vale es lo **grabado** en Zomatik: el total de la NP en el listado.
  2. Los renglones se cargan como lo hace la página: `manage_pedidos.php` con `pedidos=N` y el `pedidos_unico` de esa página.
  3. Se borra cada renglón con el tacho (`fborrar`) y se graba en `grabar_pedidos.php?codigo=N` con `fparam` vacío y sin ningún campo del renglón viejo.
  4. Después se **comprueba**: se vuelve a abrir la NP, se cargan sus renglones y se mira el total del listado.
  5. Queda "vaciada" solo si no hay renglones y el total es 0. Si no, queda "revisar", con el recorte en Actividad y un aviso a los gerenciales.
  6. Sin poder leer los renglones con un total distinto de 0, no se toca nada.
- La NP 157767 la vacía Bautista a mano. La próxima prueba se hace con otra NP.
- Con esta rama: "Capacidad por camión (m³)" vuelve a estar visible (opcional, arranca en 8, con su ayuda). "Cada cuántos minutos sale un camión" queda en "Más datos".
- Observaciones del revisor (28/10):
  - antes de cargar el detalle y antes de borrar se exige que el hidden `pedidos` de la página sea el código de la NP;
  - "vaciada" solo si el detalle cargó bien (tabla con `#totalcosto`) y no tiene renglones. El total 0 del listado y de `#totalcosto` es una confirmación más: con costo 0 puede haber renglones y total 0.
- El fixture de la NP abierta es el detalle real de la 157767 (`detalle-np-abierta.html`): celda OC con `AsignarNPDetalle`, totales y bloque de comprobantes.
- `facopio` va vacío, como en la captura real.

---

## 26. Z1: especificación — "Finalizar pedido" → OF + remito (29/10/2026, rama `loop/z1-remitir`)

Bautista (29/10): "agregar desde el mismo botón la función de remitir y fabricar". Manda sobre 8.4 y 15. Siguen 16.3 A (OF justo antes del remito, por pedido y día, y una pasada de control a la noche) y 17.1 (un remito por pedido y día; la patente del primer camión en `patente` y todas en observaciones). **Sin aplicar y sin probar contra Zomatik.** El remito y el alta de la OF se ajustaron con las capturas del 29/10 (26.9).

### 26.1 Flujo
1. **Cuándo:**
   - **"Finalizar pedido"** en Despacho (`finalizar-dialog` → `finalizar_pedido`); si falla Zomatik, el pedido se finaliza igual;
   - **"📄 Remitir en Zomatik"** en el menú del pedido (pedidos con despachos, por ejemplo uno que se completó solo al despachar todo);
   - **la pasada de la noche** (23:30, `/api/zomatik/remito/pasada`, con `CRON_SECRET`): todo lo del día que quedó sin remitir, finalizado o no.
2. **Qué se arma** (`prepararRemitos`): los despachos del pedido en ese día que todavía no están en un remito (sin los de prueba, desde que se prendió la llave).
   - Se agrupan **un remito por NP** que usa el pedido (normalmente una; dos si tuvo una NP adicional o usó una con saldo). Cada despacho va entero a la primera NP en la que entra.
   - Comprobante: **NP → RM (7)** y **NP2 → RM2 (19)**.
   - Patente del primer camión, todas las patentes y los números de papel en observaciones (7.4).
   - **No se remite** (queda el aviso en Actividad) si el despacho no coincide con la NP en R/X, fórmula o planta, o si supera lo que le queda a la NP.
3. **El robot, por cada remito:**
   - **primero la OF** (depósito de la planta, artículo de la fórmula y m³ despachados);
   - **después el remito** contra la NP (`modificar_remitos.php?pedido=<código de la NP>`).
   - Sucursal 18 antes de leer, antes del número y antes de grabar. La misma marca ASCII en las observaciones de los dos: "Sistema Rebucret - pedido N - aaaa-mm-dd - NP n".

### 26.2 Estados y reintentos (igual que la NP)
- Por remito, un estado del par: pendiente, generando, ok, revisar o error. Por separado, el de la OF y el del remito (`zomatik_remitos`).
- Pendiente (red, sin stock todavía, Zomatik caído): reintento cada 10 min (la pasada de las NP) y a la noche.
- Error (falta un dato o Zomatik dijo que no): no se reintenta solo; se reintenta con "Remitir en Zomatik".
- **Si sale la OF y falla el remito:** la OF queda "ok" con su número y el reintento hace **solo el remito** (nunca otra OF).
- "Revisar": aviso por mail a Bautista, Juan y Fernando, y recorte de la respuesta en Actividad.

### 26.3 Llave
**Propia:** `zomatik_np_config.remitir_activo`, apagada por defecto, y además la de la NP. Con la NP prendida y esta apagada, OF y remito siguen a mano. Se prende con SQL, después de la captura y la primera prueba con Bautista (no hay botón todavía, a propósito).

### 26.4 Verificación después de cada Grabar
- **OF** (como Concretus): antes de grabar se saca y se guarda la foto de las OF del depósito dadas de alta hoy. Después, tiene que haber **exactamente una OF nueva PEN** del depósito y la fecha, **con la marca**. Si no, "revisar". Si se corta, el reintento busca con esa foto antes de grabar otra.
- **Remito:** el número se elige y **se guarda antes de grabar**. Después se busca por ese número en el listado y se abre para ver la marca. Si se corta, el reintento busca primero ese número: con la marca es ok; sin la marca, revisar. Nunca un segundo Grabar a ciegas.
- Cualquier respuesta que no tenga la forma esperada **frena sin grabar** con el recorte en Actividad.

### 26.5 Que no se pueda duplicar
- `zomatik_remito_despachos.dispatch_id` es UNIQUE: un despacho nunca entra en dos remitos. El remito y sus despachos se crean juntos (`zomatik_remito_crear`).
- La marca de `zomatik_remitos` es UNIQUE (un segundo remito del mismo pedido, día y NP lleva "- 2").
- Una fila se toma con `zomatik_remito_tomar` y el turno del robot es el mismo de la NP y de la lectura (una sola sesión).
- Cada guardado del robot pide que la fila siga "generando".

### 26.6 Lo que hay que capturar en vivo con Bautista (en el navegador, sucursal REBUCRET, **sin grabar**). Hecho el 29/10 (ver 26.9)
Con un pedido de prueba con su NP en Zomatik (por ejemplo, la de OBRA PROPIA REBUCRET, Canning, 1 m³ de H21-620-10 C (CAN)). Hace falta la **URL exacta** de cada pedido de la red (con todos sus parámetros) y **la respuesta completa**:
1. **OF, alta:** `GET modificar_ordenfabricacion.php`, la página entera (el form, los depósitos 116/113 y el número que trae).
2. **OF, "Continuar" o agregar artículo:** el `GET manage_ordenfabricacion.php?...` al agregar el H21 con depósito Canning. Hace falta saber:
   - qué parámetros lleva (en Concretus: `ordenfabricacion=0&fcomprobante=62&ordenfabricacion_unico=…&fdeposito=…&fparam=&farticulo=<código sistema>&fsubtipo=0`);
   - la tabla que devuelve;
   - y **si acepta cantidad con decimales** (por ejemplo, 7,5 m³).
3. **OF, listado:** `POST listado_ordenfabricacion.php?enviado=1` filtrando hoy y Canning: la página entera (cómo se llama el depósito en la columna).
4. **Remito desde la NP:** el link REMITO del listado de pedidos, `GET modificar_remitos.php?pedido=N`, la página entera (qué viene precargado: cliente, comprobante, depósito, número, el token de borrador si lo hay).
5. **Remito, "Continuar":** el `GET manage_remitos.php?...` que dispara (`MostrarItemsPendientes`), con todos sus parámetros y la tabla que devuelve (pendiente, stock, cantidad, `novalidarstock`, el tacho).
6. **Número:** el `GET _validarnumeroremito.php?...` al tipear un número libre y uno ya usado (las dos respuestas), y el `_traerentregadoa.php` si aparece.
7. **El JavaScript de `modificar_remitos.php`:** `Validarremito()` y cómo arma lo que manda al grabar (si hay `fparam` y con qué formato).
8. **Listado de remitos:** `POST listado_remitos.php?enviado=1` sin filtros y con `bus_numero`: la página entera (para el mayor número de la serie, el link al remito y la paginación).

Con eso se reemplazan los fixtures `lib/__fixtures__/zomatik-z1/` (hoy marcados SUPUESTOS) y se ajusta el robot. Después, la primera OF + remito real con Bautista mirando.

### 26.7 Preguntas para Bautista (con recomendación). Contestadas el 29/10 (ver 26.9)
1. **¿Qué número de remito?** En REBUCRET se tipea. **Recomendación:** el siguiente de la serie de Zomatik (el mayor de RM 0001 o RM2 0099, + 1), validado con `_validarnumeroremito`, no el del papel (14.2). Antes de prender, cargar talonarios nuevos: a RM y RM2 les quedan unos 60 números (16.4).
2. **R y X en el mismo pedido:** los despachos tienen su R/X y la NP es una sola (NP o NP2). **Recomendación:** el remito sigue a la NP (NP → RM, NP2 → RM2). Si un despacho tiene otro tipo que su NP, no se remite y queda el aviso; se corrige el despacho o se hace la NP del otro tipo.
3. **¿Un remito por pedido y día, o por despacho?** Ya decidido en 17.1: por pedido y día. **Recomendación:** dejarlo así. Pasar a uno por despacho recién con talonarios nuevos y unas semanas sin errores.
4. **Sobrante con DEVOL (25.3):** **recomendación:** en otra etapa (Z1b), después de probar DEVOL en vivo. Por ahora el saldo queda en "NP con saldo" y se devuelve a mano.
5. **¿Una OF por remito o una por día y artículo?** **Recomendación:** una por remito, justo antes (16.3 A), porque el remito exige stock.
6. **Despacho manual (sin pedido programado):** no tiene NP. **Recomendación:** que quede a mano, con el aviso en Actividad, hasta definir su NP (21.4).

### 26.8 Archivos
| Archivo | Qué |
|---|---|
| `lib/zomatik/z1.ts` | Puro: plan de remitos, serie, lectura de OF (como Concretus) y remito (supuesta) |
| `lib/zomatik/z1-robot.ts` | `generarOf` y `generarRemito` |
| `lib/zomatik/z1-servidor.ts` | `prepararRemitos`, `procesarZ1`, `pasadaZ1`, `estadoRemitos` y la llave |
| `lib/zomatik/web.ts` | Grupo aparte `rutaEscrituraZ1` (solo con `escrituraZ1`, en `navegadorZ1`) |
| `app/api/zomatik/remito/*` | Remitir, estado y la pasada de la noche (`vercel.json`, 02:30 UTC) |
| `lib/zomatik/z1-cliente.ts`, `components/despacho/{despacho-tablero,columna-pedidos}.tsx` | "Finalizar" remite, el menú "Remitir en Zomatik" y el chip del remito en el pedido |
| `supabase/migrations/202610291000_zomatik_z1_remitos.sql` | **Sin aplicar.** `remitir_activo`/`remitir_desde`, `zomatik_remitos`, `zomatik_remito_despachos`, `zomatik_remito_crear`, `zomatik_remito_tomar`. No cambia ningún dato |
| `lib/__tests__/zomatik-z1.test.mjs` + `lib/__fixtures__/zomatik-z1/` | `npm run test:zomatik-z1` (27) |

- La migración **no se probó contra la base**: el lector de la base ahora es solo lectura y no corre ROLLBACK. Probarla antes de aplicarla.

### 26.9 Capturas y respuestas del 29/10
**Respuestas de Bautista:**
1. **Número de remito: "del anterior".** Es el número **más alto** del talonario en Zomatik (sucursal 18) + 1: RM en 0001 y RM2 en 0099. No el más reciente por fecha, porque no son correlativos (RM 0001-00002252 y 0001-00002233 son los dos del 28/10).
   - Se lee la primera página del listado de remitos y el buscador de los últimos 60 días.
   - Se valida con `_validarnumeroremito` **justo antes de grabar**. Si está usado, se prueba el siguiente (hasta 5).
   - Si responde "no esta cargado en el sistema", el talonario se terminó: no se graba, el remito queda en "revisar" y va el aviso "Cargar talonario nuevo de RM/RM2 en Zomatik" a los gerenciales. Ese número se olvida. Después de cargar el talonario, "Remitir en Zomatik" lo reintenta: es el único "revisar" que se reintenta, porque no se grabó nada.
   - El número usado queda en `zomatik_remitos.remito_numero` y se ve en el chip del pedido en Despacho. Los despachos de cada remito están en `zomatik_remito_despachos`; la tabla de despachos no se toca.
2. R/X: ok (el remito sigue a la NP).
3. Uno por pedido y día: **confirmado**. En Zomatik hoy se hace uno por camión (DANIEL FIOROTO, 26/10: RM2 2747, 2748 y 2749); con el sistema va uno por pedido y día. Si llegan despachos después del primer remito del día, sale otro remito (marca "… - 2").
4. DEVOL: en otra etapa.
5. Una OF por remito: ok.
6. **Despacho manual sin pedido (sin NP): también lleva su OF**, "para que baje el stock". El remito sigue a mano. Va con la misma llave:
   - `prepararOfSueltas` arma una OF por despacho (`zomatik_remitos.tipo = 'suelto'`, `remito_estado = 'a_mano'`);
   - la hacen la pasada de cada 10 min (`/api/zomatik/np/procesar`, que ahora también reintenta OF + remitos) y la de la noche.

**Lo capturado** (solo lectura; los fixtures nuevos se armaron con esto):
- **OF:** alta con depósitos 116 Canning, 117, 104, 114 y 113 REBUCRET (ninguno elegido), `fecha_entrega` = hoy + 2 y el número que trae solo. `fparam` = "codigo,cantidad|||", sin costo. "Agregar artículo" = `manage_ordenfabricacion.php?ordenfabricacion&fcomprobante&ordenfabricacion_unico&fdeposito&fparam&farticulo&fsubtipo&rnd`, lo mismo que manda el robot.
- **Remito desde la NP:**
  - `frm_remitos` trae `remitos=0`, el cliente, la provincia y `provincia_fiscal` **vacía**. El número viene en 0000-00000000 y se tipea. El transporte viene sin marcar.
  - Validarremito exige siempre provincia fiscal, **lote, dirección y localidad de entrega**, depósito, transporte, cantidad ≤ pendiente y cantidad ≤ stock (salvo `novalidarstock`).
  - No hay `fparam`: se manda el form tal cual. Se manda urlencoded (el form no es multipart; el robot sigue el enctype).
- **"Continuar"** (`manage_remitos.php?remitos=0&fcliente&fobra&fcomprobante&fstdeposito&fdeposito&fpedido&rnd`): un renglón por pendiente de la NP, **con la cantidad precargada con todo lo pendiente**. El robot pone los m³ del día en su renglón y **0 en todos los demás**.
- **`_validarnumeroremito`:** vacío = libre; "… ya se encuentra utilizado"; "… no esta cargado en el sistema".

**Cómo se llenan hoy (12 remitos reales leídos el 29/10) y lo que hace el robot:**
- **transporte = 1 y patente vacía.** Las patentes van en observaciones.
- **lote:** el lote de la obra si es barrio ("112") o, si no, el nombre de la obra o el lugar. La obra no tiene columna de lote, así que va **su nombre**.
- **entrega_direccion:** la dirección de la obra o su nombre.
- **entrega_localidad:** la localidad de la obra. **Sin localidad, el remito queda en "revisar" con "Completar la localidad de la obra"** (aviso a gerenciales). Después de completarla, "Remitir en Zomatik" lo reintenta: es un "revisar" de antes de grabar.
- **observaciones:** la obra, los camiones y la marca del sistema.
- **observacionesimp** (lo que se imprime): **los remitos de planta del día, separados por espacio** ("934 935 936"). Confirma uno por pedido y día.
- provincia_fiscal: la del cliente. No se pudo leer cómo la cargan (la pone el JavaScript).

**OF, lista capturada** (`manage_ordenfabricacion` al agregar el H21-620-10 C (CAN), `farticulo=1000015959`): `codigo14850` / `cantidad14850` → `fparam` = "14850,<cantidad>|||". Es la misma URL que manda el robot. Al grabar se mandan solo los campos del alta con `fparam`, como el robot de Concretus (que graba OF en vivo desde el 23/10).

**"FIN" y "Generar" en el listado de OF:**
- En REBUCRET todas las OF figuran FIN (columna "Remitido") y tienen el link "Generar" (`modificar_CV.php?ordenfabricacion=N`, columna "Com.Ven.").
- El robot de Concretus (`lib/zomatik-of.ts` en origin/main) **no hace nada después de grabar**: graba y verifica en el listado que haya una OF nueva **PEN**. No usa "Generar" ni `modificar_CV`, y en ese repo no aparece en ningún lado.
- O sea, no sabemos si una OF da stock sola: lo tiene que decir Bautista o la primera prueba.
- El robot de Rebucret ahora acepta la OF nueva **PEN o FIN**: lo que asegura que es la nuestra es la marca.
- Si la OF no diera stock, el remito queda "pendiente" (sin stock) y se reintenta cada 10 min, sin grabar nada.

### 26.10 Pregunta que queda
1. **¿La OF da stock al grabarla o hay que tocar "Generar" (`modificar_CV.php`)?** Se le preguntó a Bautista el 29/10. Hasta saberlo, `modificar_CV` no está en la lista cerrada.

- Migración: sigue **sin aplicar y sin probar contra la base**. Cambios desde la primera versión:
  - `zomatik_remitos.tipo` ('pedido'/'suelto'); `np_id` y `comprobante` pueden quedar nulos en 'suelto';
  - `remito_estado` acepta 'a_mano';
  - lo único que no se repite es la marca (ya no la combinación pedido + día + NP).

### 26.11 Revisión del 29/10 (lo que cambió)
- **Reintento después de un corte:**
  - Si el número guardado lo tiene OTRO remito en el listado (sin nuestra marca), el nuestro no llegó: se sigue con el siguiente número.
  - Si Zomatik dice "usado" pero el número no aparece en el listado, puede ser el nuestro: queda "revisar" sin grabar.
- **OF cortada:** se guarda el día de la foto (`of_foto_dia`) y se busca desde ese día. Una OF grabada a las 23:50 no se repite pasada la medianoche.
- **Despachos anulados o editados.** `anular_despacho` borra el despacho y `editar_despacho` cambia los m³; esas RPC no se tocan.
  - Antes de la OF: el remito toma los m³ de hoy y saca los anulados. Si no queda nada, queda "anulado".
  - Con la OF ya en Zomatik y el remito no: "revisar", sin remito, y aviso a gerenciales.
  - Con la OF o el remito ya en Zomatik: la pasada de cada 10 min y la de la noche avisan a gerenciales, una vez por cambio (`cambio_avisado`).
- **Últimos 3 días:** la pasada de la noche y las OF de los despachos sin pedido miran los últimos 3 días, no solo hoy.
- **Sin stock:** a los 6 intentos (1 hora), "revisar" con el aviso "Zomatik no tiene stock: ¿la OF necesita 'Generar'?" (`sin_stock`). "Remitir en Zomatik" lo reintenta.
- **`_validarnumeroremito`:** una respuesta vacía solo cuenta como libre si el código HTTP es 200.
- **Migración (sin aplicar):** suma `of_foto_dia`, `sin_stock` y `cambio_avisado` a `zomatik_remitos`.
