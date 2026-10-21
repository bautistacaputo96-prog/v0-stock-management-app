# Integración Rebucret ↔ Zomatik (cliente, nota de pedido, orden de fabricación y remito)

Estado: **relevamiento y propuesta del arquitecto (20/10/2026), con las respuestas de Bautista del 21/10/2026 (puntos 16 a 21; cada una manda sobre lo anterior). Maqueta aprobada el 21/10. Z0 (solo lectura) programada el 21/10 en `loop/zomatik`, sin publicar (ver "Hecho"). Nada cargado en Zomatik.** Quedan las preguntas de 20.9 y los pasos del punto 13 (y la prueba del jueves, 20.6).

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

---

## Hecho

### Z0 — lecturas, copia local, vínculos y "Traer de Zomatik" (obrero, 21/10/2026, rama `loop/zomatik`, sin push)

**Solo lee de Zomatik.** No hay ninguna función que mande un alta ni llame a `manage_*`, `grabar_*`, `generar_*` o `set_*`: el cliente tiene una **lista cerrada de rutas de solo lectura** y rechaza cualquier otra antes de salir (probado en `test:zomatik`).

**Migración** `supabase/migrations/202610211800_zomatik_z0_lecturas.sql` (**no aplicada**). Todo se agrega; compatible con main y con la Fase 3:
- `clients.zomatik_codigo` (único: dos clientes nuestros nunca pueden tener el mismo código) y `formulas.zomatik_articulo_codigo` / `_nombre`, cada uno con `zomatik_vinculo` (`auto` = primera carga, `manual` = lo confirmó un gerencial, `traido` = "Traer de Zomatik", `sin_par`), quién y cuándo.
- Copias: `zomatik_clientes` (listado + R/X del año + ficha; **el navegador no la lee**, va por `/api/zomatik/clientes` con sesión), `zomatik_articulos`, `zomatik_proyectos` (saldo **solo en %**, ningún monto; vínculo con la obra en `construction_site_id`, como dice 18.5: varios proyectos pueden ir a la misma obra), `zomatik_proyecto_movimientos` (remito, NP, artículo, m³ por día), `zomatik_np_pendientes` (sin el total en pesos).
- `zomatik_lecturas` + `zomatik_lectura_registrar()`: registro de cada lectura y freno con candado (una a la vez; "Actualizar" cada 5 min; cron una vez por hora).
- Datos ya cargados: no cambia nada; las columnas nuevas quedan nulas y las tablas vacías.
- Probada **dos veces en `BEGIN … ROLLBACK`** (cada una aplicándola dos veces), con `lock_timeout 2s` y `statement_timeout 60s`: 3,2 s y 2,6 s. Controla código repetido (rechazado) y vínculo sin código (rechazado). Tipos (`types/database.ts`) regenerados con la migración aplicada dentro de un ROLLBACK (2,4 s).

**Código**
- `lib/zomatik/cliente.ts`: copia adaptada de Concretus (login, sucursal REBUCRET 18, `discoverForm`, export XLSX y HTML, ficha por GET, XLS del acopio). **Un login por corrida** (y por proceso, uno cada 10 min como mucho); la cookie se reutiliza (en memoria y en `integraciones`, que solo lee la clave de servicio); si Zomatik rechaza el usuario, **nadie reintenta por 30 min**. 300 ms entre requests.
- `lib/zomatik/parseo.ts`, `foto.ts`, `vinculos.ts`, `acopios.ts`: funciones puras (parseo, nombre normalizado, CUIT, propuestas de vínculo, saldo en % y ≈ m³, avisos). `npm run test:zomatik`: **24/24**.
- `lib/zomatik/lectura.ts` + `/api/zomatik/leer`: **cron diario 03:30** (`vercel.json`) y botón "Actualizar" (gerencial). Mismo esquema que `/api/gps/reconstruir` (header del cron) más sesión de gerencial para lo manual. Lee clientes, artículos, remitos del año, proyectos abiertos, historia de los proyectos viejos (una sola vez), tipo de proyecto, fichas y NP pendientes. Historia, tipos (6 por vez) y fichas (25 por vez) van de a poco, con presupuesto de 40 s.
- `lib/zomatik/traer.ts` + `/api/zomatik/traer-cliente` (`clientes.cargar`): crea el cliente **en nuestra base** con código, razón social, CUIT (solo si es válido), IVA, dirección, contacto y remito sugerido (solo X → X, solo R → R). **Nunca duplica**: si hay uno con el mismo código lo devuelve; con el mismo nombre normalizado o el mismo CUIT válido, no crea y avisa "pedile a un gerencial que lo vincule"; el índice único frena dos "Traer" a la vez.
- Alta de cliente (`add-client-dialog.tsx`, que es el alta rápida del pedido y del despacho manual, y el "Nuevo cliente" de Clientes): mientras se escribe el nombre o el CUIT aparecen "Ya está en Rebucret" y "En Zomatik (no está en Rebucret)" con **"Traer de Zomatik"**.
- **Bloque "Acopios"** abajo de la grilla de Programación (Semana y Día), como la maqueta: avance (% usado), remitido, saldo ≈ m³ y %, programado (lo que falta despachar de los pedidos de la obra vinculada), última entrega y estado (saldo bajo con 7 días o 15 %, agotado). Cada fila se despliega al detalle por día con el acumulado. Filtro "con entregas en 90 días o programado" / "todos los abiertos". Sin precios ni $. "Actualizar" y "Vínculos", solo gerenciales; "Crear proyecto" deshabilitado.
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
- `test:despacho` 27/27 · `test:gps` 44/44 · `test:sesion` 21/21 · `test:zomatik` 24/24.

**Para publicar (con el OK de Bautista)**
1. `ZOMATIK_USER` y `ZOMATIK_PASS` en Vercel (proyecto Rebucret).
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
