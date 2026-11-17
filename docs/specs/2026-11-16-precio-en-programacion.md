# Precio por m³ al programar (va a la NP de Zomatik)

Estado: **propuesta (16/11/2026)**, para que Bautista conteste la sección 13. Las decisiones 1 a 3 del pedido ya están
tomadas y mandan.

**Cambia una decisión vieja:** `docs/migracion-loop/zomatik.md` 20.1.1 ("no hay precios ni montos en ninguna pantalla
nuestra") y 20.2 ("el robot no muestra ni deja elegir precio"), y el encabezado de `lib/zomatik/lectura.ts` ("nunca se
guarda un precio"). Desde ahora: **el precio por m³ de la NP se muestra y se edita en Programación, solo para quien
tiene el permiso nuevo, y se guarda solo en tablas que el navegador no puede leer.** El resto de 20.1 sigue (acopios
en m³, sin montos de acopio). Se anota como sección 27 de `zomatik.md`.

---

## 0. Qué hay hoy (relevado en el código)

| Pieza | Dónde | Qué hace hoy |
|---|---|---|
| Formulario del pedido | `components/dispatch-scheduling.tsx` → bloque `NpBloque` (`components/zomatik/np-bloque.tsx`), sección "Nota de pedido (Zomatik)" | Elige NP nueva / proyecto / NP con saldo. Guarda el pedido con la clave anon en `scheduled_dispatches` y después `avisarNp` → `POST /api/zomatik/np {accion:"sincronizar", eleccion}` |
| Elección de la NP | `zomatik_np_pedido` (solo servidor: `REVOKE ALL` a anon) | Una fila por pedido. Que exista la fila cambia `proponer` (si hay "elección guardada") |
| Robot NP nueva | `np-robot.ts` `nueva()` | Elige la lista con `listaActiva()` (`listado_listas.php`), agrega el artículo, `conCantidad` y graba. El renglón trae `hcosto<id>` (hidden) y `costo<id>` (TEXT) con el precio de la lista; `fparamDe` manda `codigo,costo,cantidad,obs|||` con `r.costo` |
| Robot NP de proyecto | `np-robot.ts` `deProyecto()` | MATERIAL del proyecto, `idlista = 0` (fixture real `material-576.html`): el precio lo pone el proyecto, no la lista |
| Ajuste al finalizar | `ajustarCantidadNp` | Cambia solo la cantidad; el `costo` queda el leído de Zomatik |
| Permisos | `lib/permisos.ts` | Secciones × acciones. Ya hay una sección sin pantalla con una sola acción: `recuentos` (`cargar`). Gerencial: lo que falta vale `true`; operario/consulta: `false` |
| Tablas que lee el navegador | `scheduled_dispatches` (`select("*")`), `zomatik_np` (`GRANT SELECT` a anon), `activity_log` | Todo lo que se ponga ahí lo puede leer cualquiera con la clave pública |
| Lectura de Zomatik | `lectura.ts` (noche) y `actualizar-copia.ts` (botón "Actualizar desde Zomatik") | Exports XLSX; `rutaPermitida` (`web.ts`) es una lista cerrada: hoy no incluye `listado_listas.php` ni `exportar_lista.php` |

**Conclusión:** no hace falta nada paralelo. El precio vive al lado de la elección de la NP (servidor), viaja en el
mismo "sincronizar", el robot lo pone en el renglón que ya arma (`costo<id>` + `fparam`) y la lista se lee con el mismo
mecanismo de las otras copias.

## 1. Objetivo

Que quien programa (Felipe, Juan, Fernando, Bautista) vea el precio de lista por m³ de la fórmula y lo pueda cambiar
antes de que salga la NP, y que la NP de Zomatik salga con ese precio. Titan y David no lo ven en ningún lado.

## 2. Alcance

**Sí:**
1. Copia de la lista de precios activa de Zomatik (lectura nocturna + botón "Actualizar").
2. Una línea "Precio por m³" abajo del bloque de la NP, editable hasta que sale la NP.
3. El robot graba la NP nueva (y las adicionales del pedido) con ese precio.
4. Permiso nuevo, y el precio fuera de toda respuesta y tabla que pueda leer quien no lo tiene.
5. Actividad de cada cambio de precio.

**No (fuera de alcance):**
- Total del pedido en $, IVA, descuentos, comisiones, otra lista que no sea la activa.
- Cambiar el precio de una NP ya generada (se hace a mano en Zomatik; el sistema no se entera).
- Precio de la NP de proyecto (no se toca) ni de la NP con saldo reusada (ya está en Zomatik).
- Precio en Despacho, Historial, remitos (Z1), OF o el ajuste al finalizar (siguen con el precio de la NP).
- Pedidos con NP de antes de este cambio: si se agrandan, la adicional sale con la lista (ver 13.3).
- RLS de `activity_log` (ver 13.4).

## 3. Pantalla

Dentro de `NpBloque`, debajo de las opciones de NP y antes de "Crear proyecto: …". **Una sola línea**, input de ancho
fijo (`w-28`), sin agrandar el formulario. Solo si: llave de la planta prendida, el bloque está listo (`lista`) y la
persona tiene `precios_np.editar`. Si no tiene el permiso, la línea **no existe** (ni se pide nada al servidor).

| Caso | Se ve |
|---|---|
| NP nueva, editable | `Precio por m³  $ [176.500]  Lista: $ 176.500 (?)` · si es distinto: `−3,7 % de la lista` en ámbar |
| Vacío | Placeholder con el de la lista. Vacío = "el de la lista" |
| Ya salió la NP | `Precio por m³: $ 170.000 · ya está en la NP (para cambiarlo, en Zomatik)` en gris, sin input |
| NP de proyecto | `Precio por m³: el del proyecto` (y el número cuando ya salió la NP: `$ 150.000, del proyecto`) |
| Proyecto con tope (el resto en NP nueva) | La línea editable, con el texto `Precio del resto (NP nueva)` |
| Usar NP con saldo | `Precio por m³: el de la NP con saldo` |
| Fórmula sin vincular | `Precio: vinculá la fórmula con Zomatik` (sin input; ya está el aviso de vincular) |
| Artículo que no está en la lista | Input vacío + `No está en la lista de Zomatik` + botón chico `Actualizar` |
| Lista sin leer / más de una activa | `No se pudo saber la lista: revisá las listas en Zomatik` + `Actualizar` |

(?) dice: "Es el precio que va a la NP de Zomatik. Vacío = el de la lista. Se puede cambiar hasta que sale la NP. Lista
OCTUBRE 2026, leída el 16/11 03:10."

Formato: `toLocaleString("es-AR")`, sin decimales salvo que los tenga. Se acepta "170000", "170.000" y "170000,50".
Si se tipea 0 o negativo: no deja guardar ("El precio tiene que ser mayor a 0"). Si se tipea exactamente el de la
lista, se guarda como vacío (no queda "puesto a mano").

## 4. Permisos

Sección nueva en `SECCIONES` (`lib/permisos.ts`), con el patrón de `recuentos`:

```ts
{ clave: "precios_np", nombre: "Precio en la NP", acciones: ["editar"], rutas: [],
  descripcion: { editar: "Ver y cambiar el precio por m³ al programar (va a la NP de Zomatik)" } }
```

- Gerenciales (Juan, Fernando, Bautista): la tienen solos (lo que falta vale `true`).
- Operarios: no la tienen (plantilla = solo "ver", y esta sección no tiene "ver"). **Bautista tilda a Felipe** en
  Usuarios. Titan y David quedan sin tildar.
- No se agrega una acción nueva a `ACCIONES` (cambiaría la matriz entera).
- Para ver/editar hace falta además poder ajustar el pedido (`puedeAjustarPedido`), como cualquier cambio del pedido.

**El precio solo sale del servidor por la ruta nueva `GET /api/zomatik/np/precio`**, que responde 403 sin el permiso.
`GET /api/zomatik/np` (`estadoPedidos`), `zomatik_np` y `scheduled_dispatches` **no** llevan el precio. Los mensajes
que se guardan en `zomatik_np.mensaje` o vuelven en `hechas` **no** llevan montos (los ve todo Programación y Despacho).

## 5. Base de datos

Migración nueva `supabase/migrations/202611161600_zomatik_precio_np.sql`, **sin aplicar** (la aplica Bautista), probada
en `BEGIN … ROLLBACK`. Solo tablas nuevas: no pide candados sobre tablas en uso.

| Objeto | Detalle |
|---|---|
| `zomatik_listas` | `codigo int PK`, `nombre text`, `desde date`, `estado text`, `leida_at timestamptz`. Copia de `listado_listas.php` |
| `zomatik_lista_precios` | `lista_codigo int`, `articulo_codigo bigint` (= `zomatik_articulos.codigo`), `articulo_nombre text`, `precio numeric(14,3)`, `leida_at timestamptz`; PK (`lista_codigo`, `articulo_codigo`). Solo las listas activas |
| `zomatik_np_precio` | `scheduled_dispatch_id uuid PK` → `scheduled_dispatches` ON DELETE CASCADE; `precio_m3 numeric(14,3)` (nulo = lista; CHECK > 0 y < 100.000.000); `origen text` (`manual` / `np`; CHECK `(precio_m3 IS NULL) = (origen IS NULL)`); `formula_id uuid` (para qué fórmula vale); `lista_codigo int`, `precio_lista_m3 numeric(14,3)` (la lista cuando se puso); `proyecto_precio_m3 numeric(14,3)` (solo para mostrar); `updated_by text`, `updated_at timestamptz` |
| `zomatik_np_precio_guardar(p_pedido, p_precio, p_formula, p_lista, p_precio_lista, p_usuario)` → jsonb `{ok, bloqueado, antes}` | Con las NP del pedido `FOR UPDATE`: **bloqueado** si hay una NP del pedido `tipo='nueva'`, de esa fórmula, con `estado NOT IN ('pendiente','error','anulada')` o con `paso` en la lista de "puede estar grabada" (la misma del trigger `zomatik_np_no_borrar_pedido`). Si no, upsert (`origen='manual'`, o fila en nulo si `p_precio` es nulo) |
| `zomatik_np_precio_congelar(p_pedido, p_precio, p_formula, p_usuario)` | Después de la primera NP nueva "ok": pone `precio_m3 = p_precio`, `origen='np'` **solo si** `precio_m3` es nulo o la fórmula es otra. Nunca pisa un `manual` de la misma fórmula |

Las tres tablas: `REVOKE ALL FROM anon, authenticated; GRANT ALL TO service_role`. Las funciones: `EXECUTE` solo a
`service_role`.

**Por qué una tabla aparte y no una columna:**
- `scheduled_dispatches` la lee el navegador con `select("*")` y la clave anon: Titan vería el precio.
- `zomatik_np` tiene `GRANT SELECT` a anon.
- `zomatik_np_pedido` sirve (es solo servidor) pero que exista la fila cambia el "¿ya tiene elección guardada?"
  (`proponer` del proyecto de la obra). Una tabla propia no cambia nada de lo que ya anda.

**Datos ya cargados:** no se toca ninguna fila existente. Todo pedido sin fila en `zomatik_np_precio` sale **como hoy**
(precio de la lista). Las copias de listas arrancan vacías y se llenan con la primera lectura. Sin la migración, la ruta
de precio responde "sin migración" y la línea no aparece (como `faltaMigracion` en las otras rutas). No hay columna
`plant`/`planta`: las listas son de la sucursal REBUCRET (las dos plantas); el artículo ya distingue CAN/HUD.

## 6. Lectura de la lista

- `rutaPermitida` (`web.ts`, grupo de solo lectura): sumar `GET listado_listas.php` y `GET exportar_lista.php?lista=\d+`
  (y su `output/exportar_lista.xlsx` si redirige, como el acopio). Nada más.
- `cliente.ts`: `fetchListaXls(s, lista)`, copia de `fetchAcopioXls` (XLSX o tabla HTML).
- `parseo.ts`: `preciosDeLista(filas)` puro → `{ articulo_codigo, articulo_nombre, precio }[]`. **Las columnas del
  XLSX no se conocen**: el obrero las fija con la fixture que baja Bautista (13, captura A). Regla para elegir la columna
  de precio: la que da **176.500 para 10090020 (H21-620-10 C (CAN))**, que es el `costo` real que trajo la lista 10248
  en la NP2 0001-00002086 del 28/10 (`detalle-np-abierta.html`), si la lista no cambió desde entonces. Si el export trae
  "Codigo Sistema" en vez de "Codigo", se pasa a `zomatik_articulos.codigo` con `codigo_sistema`.
- `lectura.ts`: parte nueva `listas` (después de `articulos`): lee `listado_listas.php` (`listasDeListado`, ya existe),
  guarda todas en `zomatik_listas` y, por cada **activa**, baja el export y reemplaza sus filas en
  `zomatik_lista_precios`; borra las filas de listas que ya no están activas. Si falla, quedan las de antes (con su
  `leida_at`) y sigue el resto de la lectura.
- `actualizar-copia.ts`: `TipoCopia` suma `"precios"` (mismo candado de 2 min y mismo turno del robot). La ruta
  `/api/zomatik/actualizar-copia` exige `precios_np.editar` para ese tipo.
- Qué lista usa la pantalla: `listaActiva(listas de la copia, comprobante)` — **la misma función que el robot** —, con
  el comprobante del remito del formulario (R → 15 NP, X → 16 NP2). Hoy hay una sola activa (OCTUBRE 2026, 10248) y vale
  para las dos.

## 7. Servidor

`lib/zomatik/precio-servidor.ts` (nuevo, patrón `np-servidor.ts`):
- `precioParaPedido({ formulaId, plantId, remito, pedidoId? })` → `{ estado: "ok" | "sin_vinculo" | "no_en_lista" |
  "sin_lista", lista: {codigo, nombre, leida_at} | null, precio_lista, precio_m3, origen, bloqueado, numero_np,
  proyecto_precio_m3 }`.
- `guardarPrecio(pedido, precio | null, usuario)` → llama a `zomatik_np_precio_guardar` y deja Actividad.
- `congelarPrecio(np, precio, usuario)`.

`GET /api/zomatik/np/precio?formula_id=…&plant_id=…&remito=R|X[&pedido_id=…]` (nueva, patrón `np/proyectos`):
`exigirSesion` + `precios_np.editar` + `programacion.ver`; si no, 403. `Cache-Control: no-store`.

`POST /api/zomatik/np {accion:"sincronizar"}` acepta `precio_m3` (número o `null`; **ausente = no se toca**):
- Sin `precios_np.editar` o sin poder ajustar el pedido: se **ignora** (no corta el guardado del pedido).
- 0, negativo, no numérico o ≥ 100.000.000: 400 "El precio tiene que ser mayor a 0".
- `sincronizarPedido` recibe `opciones.precio` y lo guarda **antes** de planificar y crear NP (así el robot, que corre
  después con `after`, ya lo encuentra). Si vuelve `bloqueado`: aviso "El precio ya está en la NP: no se cambió. Si
  hace falta, cambialo en Zomatik." (sin montos).
- Si el pedido cambió de fórmula y la fila tiene otra `formula_id`: se limpia (vuelve a la lista) y Actividad "El pedido
  cambió de fórmula: el precio vuelve a la lista". Pasa también si lo edita alguien sin el permiso.

## 8. Robot

- `DatosNp.precioM3?: number | null`. `datosParaRobot` lo lee de `zomatik_np_precio` **después** de tomar la NP
  (`zomatik_np_tomar` ya la dejó "generando", así `guardar` queda bloqueado y no hay carrera): vale si
  `np.tipo === "nueva"` y `formula_id` coincide con la de la NP; si no, `null`.
- `np.ts`: `conCosto(r, precio)` puro: cambia `r.costo` (va en `fparam`) y el campo `/^costo\d+$/i`. **No toca
  `hcosto<id>`**: es lo que pasa en el navegador cuando una persona escribe en el campo Costo (`onkeyup` solo llama a
  `CalcularTotales()`). A confirmar con la captura B (13); si `GrabarDatosDetalle` o `CalcularTotales` tocan `hcosto`,
  se copia eso.
- `nueva()`: `rs = [precio ? conCosto(conCantidad(art[0], m3), precio) : conCantidad(art[0], m3)]`. **Sin precio, el
  cuerpo que se manda es byte a byte el de hoy.**
- Verificación del precio (solo si se mandó uno): después de encontrar la NP con la marca, se carga el detalle grabado
  como en `vaciarNp` (`detalleGrabado`). Si el renglón no tiene ese `costo`: la NP queda **ok** igual (está en Zomatik y
  se autoriza), con `mensaje` "La NP quedó con otro precio en Zomatik: revisala." (sin montos), Actividad con los dos
  montos y `avisarErrorZomatik` a Bautista. Si el detalle no carga: lo mismo con "No se pudo controlar el precio".
- `ResultadoNp.precio` = el `costo` que se mandó (el de la lista si no había). En `trabajarGenerar`, con la primera NP
  nueva "ok" del pedido: `congelarPrecio`. Así **las adicionales salen con el mismo precio** aunque la lista cambie
  (decisión 3), lo haya tocado alguien o no.
- `deProyecto()`: **no se toca el renglón**. Solo devuelve `precioProyecto` (el `costo` que trajo el MATERIAL) y se
  guarda en `zomatik_np_precio.proyecto_precio_m3` para mostrarlo.
- Ajuste al finalizar y Z1: sin cambios.

## 9. Casos borde

| Caso | Qué pasa |
|---|---|
| Fórmula sin vincular | Sin input; la NP no sale igual (`MSJ_SIN_ARTICULO`), como hoy |
| Artículo que no está en la lista | Se puede poner precio a mano; vacío = lo que ponga Zomatik (como hoy) |
| La lista activa cambió entre programar y generar | Con precio puesto a mano: va ese, y Actividad anota "lista NOVIEMBRE (antes OCTUBRE)". Vacío: el de la lista nueva, y queda congelado para las adicionales |
| Más de una lista activa / ninguna | La pantalla muestra el aviso; el robot ya frena con "Revisar las listas en Zomatik" |
| Precio 0 o vacío | 0 no se acepta; vacío = lista |
| NP2 vs NP | La lista sale de `listaActiva(…, comprobante)`; el precio puesto a mano vale para cualquiera de las dos |
| Cambió R/X antes de generar | Se recalcula el de lista en pantalla; el puesto a mano se mantiene |
| Cambió la fórmula | Antes de generar: vuelve a la lista. Después: la NP vieja queda (se desvincula, como hoy) y la nueva es otra fórmula, así que el precio se puede volver a poner hasta que salga |
| Cambió la fecha y "No: va una NP nueva" | Misma fórmula: el precio ya está bloqueado y la nueva sale con el congelado |
| NP cortada en Grabar (`grabar_cortado`) | Bloqueado: puede estar en Zomatik |
| NP en "error" o "pendiente" sin grabar | Editable; el reintento ("Generar NP ahora") usa el precio nuevo |
| Usar NP con saldo | Sin input; si no alcanza, la NP nueva por el resto sale con la lista |
| Proyecto | Sin input; la NP de proyecto igual que hoy |
| Pedido de antes con NP ya generada que se agranda | La adicional sale con la lista (no se sabe el precio de la primera) |

## 10. Actividad

Por `actividadNp` (servidor, entidad `zomatik_np`), nunca desde el navegador:
- "Precio de la NP: $ 176.500 → $ 170.000 /m³ (lista OCTUBRE 2026: $ 176.500)" — quién y cuándo.
- "Precio de la NP: vuelve a la lista" (al vaciar el campo o al cambiar la fórmula).
- "No se cambió el precio: la NP ya salió" (intento bloqueado).
- En "NP generada en Zomatik": campo `Precio` ("$ 170.000/m³, puesto a mano" o "de la lista").
- "La NP quedó con otro precio en Zomatik" (con los dos montos).

## 11. Archivos

| Archivo | Qué | Patrón |
|---|---|---|
| `supabase/migrations/202611161600_zomatik_precio_np.sql` (nueva) | Sección 5 | `202610222200_zomatik_np.sql` (tablas solo servidor), `zomatik_np_reservar` (FOR UPDATE) |
| `lib/permisos.ts` | Sección `precios_np` | `recuentos` |
| `lib/zomatik/web.ts`, `cliente.ts`, `parseo.ts` | Sección 6 | `exportar_acopio` / `fetchAcopioXls` / `pactadoDeAcopio` |
| `lib/zomatik/lectura.ts`, `actualizar-copia.ts`, `app/api/zomatik/actualizar-copia/route.ts` | Parte `listas`, tipo `precios` | `articulos` |
| `lib/zomatik/np.ts` | `conCosto` | `conCantidad` |
| `lib/zomatik/np-robot.ts` | `precioM3`, verificación, `precio`/`precioProyecto` | `nueva()`, `detalleGrabado` |
| `lib/zomatik/precio-servidor.ts` (nuevo) | Sección 7 | `np-servidor.ts` |
| `lib/zomatik/np-servidor.ts` | `opciones.precio`, `datosParaRobot`, congelar, limpiar al cambiar fórmula | — |
| `app/api/zomatik/np/route.ts` | `precio_m3` en sincronizar | `eleccion` |
| `app/api/zomatik/np/precio/route.ts` (nueva) | GET | `app/api/zomatik/np/proyectos/route.ts` |
| `lib/zomatik/np-cliente.ts` | `leerPrecioNp`, `avisarNp(…, precio)` | `cargarNpSaldos`, `avisarNp` |
| `components/zomatik/np-bloque.tsx` | La línea de la sección 3 (props `precio`, `onPrecio`, `remito`, `pedidoId`) | Los avisos del bloque |
| `components/dispatch-scheduling.tsx` | Estado del precio; mandar `precio_m3` en `avisarNp` **solo si se tocó** | `npEleccion` |
| `lib/__fixtures__/zomatik-listas/` (nueva) | `lista-10248.xlsx` (REAL, de Bautista), `listado-listas.html`, `README.md` | `zomatik-np/README.md` |
| `docs/migracion-loop/zomatik.md` | Sección 27 (cambia 20.1.1 y 20.2) | — |

## 12. Pruebas que escribe el obrero

`npm run test:zomatik-np`, `test:zomatik`, `test:sesion`, más las de siempre sin cambios (`test:zomatik-z1`,
`test:zomatik-ajuste`), `tsc` sin errores nuevos y build bien.

- **`np.ts`:** `conCosto` cambia `costo<id>` y `r.costo`, deja `hcosto<id>`; `fparamDe` lleva el precio nuevo.
- **Robot** (navegador simulado, `zomatik-np.test.mjs`): con precio → el multipart lleva `costo<id>=170000`,
  `hcosto<id>=176500.000` y `fparam` con 170000; sin precio → el mismo cuerpo que hoy (comparado contra el test actual);
  proyecto con precio en `DatosNp` → renglón intacto; detalle con otro costo → ok + mensaje sin montos; detalle que no
  carga → ok + "No se pudo controlar el precio".
- **Lista:** `preciosDeLista` con la fixture real (10090020 → 176.500 o lo que diga la fixture); `listaActiva` sobre la
  copia para 15 y 16.
- **Lista cerrada:** `rutaPermitida` acepta `listado_listas.php` y `exportar_lista.php?lista=10248`; rechaza
  `exportar_lista.php?lista=abc`, `modificar_listas.php?codigo=10248` y `grabar_listas.php`.
- **Permisos** (`sesion-permisos.test.mjs`): gerencial sí por defecto, operario y consulta no, plantilla de operario
  sin la casilla, gerencial con `false` explícito no la tiene; la matriz incluye la sección.
- **Servidor** (`zomatik-np-servidor.test.mjs`, base simulada): guarda con permiso; sin permiso se ignora y el pedido se
  sincroniza igual; NP "ok"/"generando"/`grabar_cortado` → bloqueado y no cambia; "error" sin grabar → cambia; cambio de
  fórmula → limpia; primera NP ok → congela; adicional usa el congelado; un `manual` no se pisa al congelar;
  `estadoPedidos` nunca trae `precio`; mensajes de `zomatik_np` sin "$".
- **Ruta** `np/precio`: 403 sin permiso; 400 con 0 o negativo en sincronizar.

## 13. Lo que necesita Bautista (mínimo)

**Capturas, solo lectura (10 min, sucursal REBUCRET, no tocar Grabar):**
- **A.** Bajar `exportar_lista.php?lista=10248` y dejarlo en `lib/__fixtures__/zomatik-listas/lista-10248.xlsx`.
- **B.** Abrir una NP cualquiera (`modificar_pedidos.php?codigo=N`), `Ctrl+U`, copiar a un `.txt` las funciones
  `CalcularTotales` y `GrabarDatosDetalle` y toda línea con `hcosto`. Con eso se sabe si cambiar el precio toca `hcosto`.

**Preguntas:**
1. **Proyecto:** el precio del proyecto no está en nuestra copia (los proyectos son "por monto" y el MATERIAL viene con
   lista 0): se sabe recién cuando sale la NP. ¿Alcanza con "el del proyecto" antes y el número después?
   **Recomendación:** sí. Leerlo antes exige abrir el MATERIAL en Zomatik cada vez que se elige un proyecto.
2. **Primera prueba real:** ¿un pedido de prueba de OBRA PROPIA REBUCRET en Canning, 1 m³, con el precio cambiado, en el
   preview y con vos mirando, que después vaciás a mano? **Recomendación:** sí, antes de avisarle a Felipe.
3. **Pedidos ya programados con NP:** si se agrandan después del cambio, la adicional sale con la lista (no sabemos el
   precio de la primera). ¿Ok? **Recomendación:** sí; es lo que pasa hoy.
4. **Actividad con montos:** `activity_log` se puede leer con la clave pública (como casi todo hoy), aunque la pantalla
   Actividad es solo de gerenciales. ¿Montos en Actividad igual? **Recomendación:** sí; cerrarlo es RLS en
   `activity_log`, otro trabajo.

## 14. Criterios de aceptación

Pedido de prueba: OBRA PROPIA REBUCRET, Canning, H21-620-10 C (CAN), remito X, 8 m³. Lista activa OCTUBRE 2026.

1. **Felipe** (con la casilla) ve abajo de la NP `Precio por m³ $ [ ] Lista: $ 176.500` (o lo que diga la lista). Pone
   170.000 → "−3,7 % de la lista". "Programar y generar NP" → en Zomatik la NP2 tiene **un** renglón con Costo
   **170.000** y Cantidad 8, total $ 1.360.000. En Actividad: "Precio de la NP: $ 176.500 → $ 170.000 /m³", con Felipe.
2. **Titan** abre el mismo pedido: no hay línea de precio. En la pestaña Red, ninguna respuesta trae el precio:
   `GET /api/zomatik/np` sin `precio`; `GET /api/zomatik/np/precio` → 403. Si fuerza `precio_m3` en sincronizar, no
   cambia nada.
3. **Después de la NP:** Felipe vuelve a abrir el pedido: `$ 170.000 · ya está en la NP`, sin input.
4. **Se agranda a 12 m³:** la NP2 adicional de 4 m³ sale con Costo **170.000**.
5. **Sin tocar el precio:** la NP sale con el de la lista; si después cambia la lista y el pedido se agranda, la
   adicional sale con el **mismo** precio de la primera.
6. **Proyecto:** sin input; la NP del proyecto sale exactamente como hoy.
7. **Llave apagada** en la planta: no aparece la línea; nada cambia.
8. **Sin precio puesto**, el Grabar de la NP es idéntico al de hoy (prueba automática).
9. Pruebas de la sección 12 en verde, `tsc` sin errores nuevos.

## 15. Capturas hechas (16/11, solo lectura, desde el navegador de Bautista) — mandan sobre lo de arriba

**A. `exportar_lista.php?lista=10248` (XLSX, una hoja, 100 filas, sin códigos de artículo):**
- Filas 1–3 vacías. Fila 4, A: `Lista de precios N: 0   Fecha: 28/10/2026   Lista OCTUBRE 2026`, E: `T.C: 1573.590`.
- Después, por rubro: una fila cabecera `A=Hormigon | B=Precio` y debajo una fila por artículo `A=<nombre> | B=<precio>`
  (ej.: `H13-620-10 C (CAN) | 163000`, `H21-620-10 C (CAN) | 176500`, `H25-620-15 B (HUD) | 184000`). Puede haber más
  rubros con su propia cabecera `X | Precio`.
- **No trae código**: el cruce es por **nombre** contra `zomatik_articulos.nombre` (exacto después de normalizar
  espacios y mayúsculas). Si un nombre no cruza o cruza con más de uno, esa fila no se usa (queda "no está en la lista").
- H21-620-10 C (CAN) = 176500: coincide con el `costo` de la NP2 2086 (la lista no cambió). El obrero arma la fixture
  a mano con esta estructura (no hace falta el archivo real).

**B. `CalcularTotales` / `GrabarDatosDetalle` (NP 157911):**
- `GrabarDatosDetalle` arma `fparam` recorriendo el form: por renglón `codigo…,costo…,cantidad…,observacionesdetalle|||`
  (usa `name.indexOf("costo")==0`, o sea `costo<id>`, **no** `hcosto`). **Cambiar el precio = cambiar `costo<id>` y el
  `fparam`; `hcosto` no se toca.**
- `CalcularTotales`: con comprobante 15 (NP, R) el total es `costo×cantidad` + IVA 21 % + percepción IIBB; con 16 (NP2,
  X) no suma IVA. **El precio de la lista y el `costo` son netos (sin IVA).** En pantalla: `Precio por m³ (sin IVA)`.

**Respuestas a 13:** 1, 2, 3 y 4 como las recomendaciones (proyecto: "el del proyecto" antes y el número después; prueba
real con OBRA PROPIA REBUCRET en el preview; adicionales de pedidos viejos con la lista; montos en Actividad).
