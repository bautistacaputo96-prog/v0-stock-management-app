# Vincular con Zomatik al programar (04/11/2026)

Repo Rebucret. Arquitecto → obrero → revisor. Rama sugerida: `feat/vincular-al-programar`.

## Objetivo

Desde hoy la NP sale sola al programar, pero se cae si el cliente o la fórmula no están vinculados con Zomatik
("La fórmula no está vinculada con un artículo de Zomatik (H8-620-15 (CAN))"). Faltan 16 fórmulas de Canning, 13 de
Hudson y 57 de 95 clientes. Bautista no quiere vincular todo junto: se vincula **caso por caso, en el pedido**, quien
programa, con sugerencias y un buscador. Si no se vincula, el pedido se guarda igual y todo sigue como hoy.

## Lo que hay hoy (relevado en el código)

**Qué controla el robot antes de tocar Zomatik** (`lib/zomatik/np-robot.ts`, `generarNp`, líneas 307-313). Se fija,
en este orden, en:
1. `clienteCodigo`, que sale de `clients.zomatik_codigo` (lo lee `datosParaRobot` en `np-servidor.ts` con
   `np.client_id`).
2. El depósito de la planta.
3. `articuloCodigoSistema`, que sale de `formulas.zomatik_articulo_codigo` → `zomatik_articulos.codigo_sistema`.
   **Ojo:** si la fórmula está vinculada pero el artículo no tiene `codigo_sistema`, el mensaje es el mismo: "no está
   vinculada".
4. Los m³.
5. R/X (para la NP nueva).
6. El proyecto (para la NP de proyecto).

**La obra no se controla.** La NP nueva va con `idobra: "0"`. La obra solo se escribe como texto en "observaciones de
entrega". La NP de proyecto pide que el proyecto sea del cliente (`validarProyecto` compara contra
`clients.zomatik_codigo`). El vínculo proyecto ↔ obra (`zomatik_proyectos.construction_site_id`) y
`construction_sites.zomatik_proyecto_codigo` solo sirven para sugerir.

Estos son errores de "dato" (`Corte("error", …, reintentar=false)`). La NP queda en **error**, la pasada de 10 min no
la vuelve a tomar y sale un solo mail a Bautista (`avisarErrorZomatik`; no se repite si ya estaba en error). Solo la
reintenta "Generar NP ahora" (`POST /api/zomatik/np {accion:"generar"}`, que incluye las que están en error).
`datosParaRobot` lee el cliente y la fórmula **en el momento de trabajar**: si se vincula después, alcanza con
reintentar. No hay que tocar la fila de la NP.

**Quién vincula hoy.** `POST /api/zomatik/vincular` llama a `exigirGerencial()`: solo gerenciales. Acepta `vincular`,
`sin_par` y `quitar`, para cliente, fórmula y proyecto. `soloSiLibre` graba solo si `zomatik_vinculo IS NULL`.
Registra la Actividad con `entity: cliente|formula|obra`. Además:
- `/api/zomatik/propuestas` es solo para gerenciales y pesado: carga todos los despachos desde el 13/04 más el cruce
  por remitos.
- `/api/clientes/buscar` ya deja buscar en la copia de Zomatik a quien tiene `programacion.cargar`.
- `/api/zomatik/clientes` exige `clientes.cargar`.

**Un código, un cliente.** La migración `202610211800` crea `clients_zomatik_codigo_key`, un índice único parcial.
`zomatik.md` §"Hecho" lo deja escrito: "dos clientes nuestros nunca pueden tener el mismo código". `vincular` ya
contesta "Ese cliente de Zomatik ya está vinculado a «X»". El CHECK de `zomatik_vinculo` admite
`auto|manual|traido|sin_par` en clientes y `auto|manual|sin_par` en fórmulas.

**¿Un vínculo de cliente puede romper otra cosa?** Revisé lo que usa `clients.zomatik_codigo`:

| Dónde | Qué hace con el código | Riesgo |
| --- | --- | --- |
| Robot NP (`datosParaRobot`) | La NP sale a nombre de ese cliente de Zomatik | **Alto si el vínculo está mal**: NP, remitos y factura a otro cliente. Es el único riesgo real |
| `validarProyecto` / `/api/zomatik/np/proyectos` | Lista y valida los proyectos de ese código | Vincular habilita la "NP de un proyecto". Nada se rompe |
| `/api/zomatik/np/proyectos?todos=1`, `acopios-bloque.tsx` | `Map código → cliente` | Supone 1:1. Con el índice único, no se rompe |
| Z1, remitos (`z1-servidor.ts`) | Usa el código de la **NP**, no el del cliente | No se toca |
| Control de remitos R/X (`remito_tipo_para`) | No usa Zomatik | No se toca |
| "Usar NP con saldo" | Va por `client_id` nuestro | No se toca |
| Cruce y propuestas de Vínculos | Lo vinculado sale de los candidatos libres | Esperable |
| `unificar_clientes()` | No unifica dos con distinto código | Un vínculo apurado a otro código puede frenar después una unificación. Se previene abajo (duplicados) |
| `traer.ts` | Busca por código para no duplicar | Sin cambios |

En la revisión del 21/10 aparece **H8-620-15 (CAN)** como "sin propuesta": Zomatik no tiene artículo H8 de Canning. Lo
más parecido es H8-620-10 C (HUD) (10090007), de Hudson.

## Decisiones

1. **Un código de Zomatik va con un solo cliente nuestro. Se mantiene.** Para "LA TERCERA" no se ofrece 22812, que ya
   es de «Fideicomiso La Tercera»: se avisa y se ofrece usar ese cliente en el pedido. Unir los repetidos lo sigue
   haciendo un gerencial en Vínculos › Duplicados.
   - *Descartado: permitir N:1.* Supone 1:1 en `np/proyectos?todos`, `acopios-bloque`, `traer.ts`,
     `unificar_clientes` y en los "usados" de las propuestas. Y cambia la base.
   - *Descartado: mover el código al cliente nuevo.* Pisa un vínculo de otro.
2. **Desde el pedido solo se completa lo que falta.** Se vincula un cliente o una fórmula con `zomatik_vinculo` nulo o
   `sin_par`. Nunca se quita ni se cambia un vínculo, tampoco un gerencial desde el cartel: corregir es en Vínculos.
   La condición va **dentro del UPDATE** (es atómica). Si no actualiza ninguna fila, alguien lo vinculó en el medio.
3. **Sin cambios de base.** El vínculo desde el pedido graba `zomatik_vinculo = 'manual'`, `zomatik_vinculado_por` y
   `_at`, igual que hoy. "manual" deja de querer decir "lo confirmó un gerencial": lo que distingue es quién y la
   Actividad ("Desde: Programación").
   - *Descartado: un valor nuevo `pedido`.* Cambia los CHECK de `clients` y `formulas`.
4. **Obra y proyecto no van en el cartel.** El robot no los necesita para la NP nueva. La NP de proyecto solo necesita
   el cliente vinculado: vinculado el cliente, el bloque NP ya lista sus proyectos. El vínculo proyecto ↔ obra sigue
   en Vínculos.
5. **Sugerencias livianas** por CUIT, nombre y partes del código. No se usa el cruce por fechas de Vínculos, que tarda
   varios segundos y es solo para gerenciales. Sirve el ranking de nombre de `vinculos.ts`, que ya existe.
6. **Desde el cartel no se vincula** con:
   - un artículo de otra planta;
   - un artículo sin `codigo_sistema`;
   - un cliente de Zomatik genérico o inactivo;
   - un cliente con **CUIT válido distinto** del nuestro.

   Esos casos los ve un gerencial en Vínculos.
7. **Reintento.** Si el cartel se abre fuera del formulario (menú ⋯ de un pedido con la NP en error), al terminar llama
   solo a `generarNpAhora`. Dentro del formulario, la NP se reintenta **después de Guardar**, para no generarla con
   datos que todavía no se guardaron.
8. **"Generar NP ahora" también con `programacion.editar`.** Hoy pide solo `cargar`. Así cualquiera que puede vincular
   puede reintentar.

## Alcance

### A. Servidor

1. **`lib/permisos.ts`**: agregar `puedeVincularDesdePedido(u)`, que vale `programacion.cargar || programacion.editar`.
2. **`lib/zomatik/np.ts`** (puro): exportar `MSJ_SIN_CLIENTE` ("El cliente no está vinculado con Zomatik") y
   `MSJ_SIN_ARTICULO` ("La fórmula no está vinculada con un artículo de Zomatik"), más `esFaltaDeVinculo(mensaje)`.
   `np-robot.ts` usa esas constantes y sus textos no cambian (los tests actuales los comparan).
3. **`lib/zomatik/vinculos.ts`** (puro, junto a `proponerClientes`/`proponerFormulas`): agregar tres funciones.

   **`sugerenciasCliente(cliente, zcli, nuestros, max = 5)`**
   - Candidatos: los clientes de Zomatik activos y no genéricos (`esGenerico` de `cruce.ts`).
   - Orden: CUIT válido igual, después nombre normalizado igual (con `razon_social` y los alias), después
     `parecidoNombres` ≥ 0,5. Desempate por `remitos_12m` y, después, por `ultimo_remito`.
   - Cada sugerencia trae `codigo`, `razon_social`, `cuit`, `localidad`, `remitos_12m`, `ultimo_remito` y `motivo`
     ("CUIT igual", "nombre igual", "nombre parecido 78 %"). Trae también
     `cuit: "igual" | "distinto" | null` y `vinculado_a: {id, name} | null`. Si ya es de otro cliente nuestro se
     muestra igual, pero no se puede elegir.
   - Además devuelve `duplicadoDe`: los clientes nuestros que `detectarDuplicados` (`clientes-buscar.ts`) empareja con
     este y que ya tienen código. Es el caso de La Tercera.

   **`sugerenciasArticulo(formula, plantaNombre, articulos, max = 6)`**
   - Lee el código de la fórmula y el nombre de cada artículo con `interpretarNombre` (`lib/formulas-nombre.ts`), que
     ya saca el "(CAN)"/"(HUD)".
   - Solo sugiere artículos de **la misma resistencia**. Los ordena así:
     1. de la misma planta o sin sufijo, antes que los de la otra planta;
     2. con la misma piedra;
     3. con el asentamiento más cercano (igual primero);
     4. con el mismo método C/B;
     5. con el mismo comentario (PELQUE…).
   - Si el código no se puede leer (RDC, cordones, recuperado), usa la regla de tokens de `proponerFormulas`.
   - El nombre igual o igual por reglas (`variantesFormula`) va primero.
   - Cada sugerencia trae `codigo`, `nombre`, `motivo` ("misma resistencia y piedra, asentamiento 10 en vez de 15"),
     `otra_planta: boolean` y `sin_codigo_sistema: boolean`.
   - Saca los servicios (`deHormigon`).

   **`controlVinculoPedido(...)`**: la regla de la decisión 6. Devuelve `null` o el texto del error.
4. **`lib/zomatik/vincular-servidor.ts`** (nuevo; patrón: `np-servidor.ts`, con `sb = sbServicio()` como parámetro
   para poder probarlo):
   - Recibe el `aplicar` que hoy vive en la ruta. Se mueve tal cual (Vínculos sigue igual) y se le agrega el modo
     pedido.
   - **Modo pedido**: solo `accion: "vincular"` y `tipo: cliente | formula`; uno o dos ítems.
     - UPDATE con `zomatik_codigo` (o `zomatik_articulo_codigo`) nulo y `zomatik_vinculo` nulo o `sin_par`.
     - Si no actualiza nada: lee quién lo hizo y contesta "Ya lo vinculó {por}…".
     - Cliente: además el `controlVinculoPedido` y el control de "ya es «X»" que ya existe. Un 23505 se contesta igual.
       Después llama a `olvidarClientes()`.
     - Fórmula: el artículo tiene que estar en la copia, ser de hormigón, tener `codigo_sistema` y ser de la misma
       planta o no llevar sufijo.
     - Con `pedido_id`: el pedido tiene que existir y su `client_id`/`formula_id` tiene que ser el del ítem (así no se
       vincula cualquier cosa desde el cartel).
   - **Actividad**:
     1. la de siempre (`registrarActividad`, `entity: cliente|formula`), con `details` más `Desde: "Programación ·
        pedido abcd1234"` (o "pedido nuevo") y `Antes: "Sin revisar" | "No está en Zomatik"`;
     2. con `pedido_id`, también `actividadNp` del pedido: "Qué pasó: Vinculó la fórmula «H8-620-15 (CAN)» con
        H8-620-15 C (CAN) (10090xxx)".
   - **`estadoVinculos({clientId, formulaId})`**: para cada uno devuelve `falta` y `problema`, que puede ser
     `sin_vinculo`, `sin_par`, `articulo_no_esta` o `articulo_sin_codigo_sistema`. Devuelve también lo vinculado (con
     `por`) y las sugerencias.
     - Clientes: usa `cargarClientesParaBuscar` (ya tiene caché de 30 s).
     - Fórmulas: lee `formulas` + `plants` + `zomatik_articulos`.
   - **`buscarParaVincular(tipo, q)`**:
     - cliente: `buscarEnZomatik` sobre la copia, marcando `vinculado_a`;
     - artículo: por nombre o código, con las mismas marcas.
5. **`app/api/zomatik/vincular/route.ts`**: la ruta queda finita.
   - `POST` sin `desde`: como hoy (`exigirGerencial`, Vínculos).
   - `POST` con `desde: "pedido"` (y `pedido_id` opcional): `exigirSesion` + `puedeVincularDesdePedido`, y se aplica
     el modo pedido **también al gerencial**.
   - `GET` nuevo, con la misma permisión que el modo pedido o gerencial:
     - `?client_id=&formula_id=` → `estadoVinculos`;
     - `?buscar=cliente|articulo&q=` → `buscarParaVincular`.
   - El GET no devuelve teléfonos ni mails de la copia.
   - Actualizar el comentario de arriba.
6. **`app/api/zomatik/np/route.ts`**: `generar` acepta `programacion.cargar || programacion.editar`.
7. **`lib/zomatik/np-servidor.ts`**, en el mail de "Zomatik no generó la NP": si `esFaltaDeVinculo(r.mensaje)`, la
   línea "No se reintenta sola…" pasa a ser: "Se puede vincular desde el pedido (Editar o ⋯ › Vincular con Zomatik):
   la NP se reintenta sola." Nada más cambia en el robot.
8. **Vínculos, para que el gerencial encuentre lo hecho desde un pedido.**
   - `/api/zomatik/propuestas` lee `app_users (name, tipo)` y agrega `por_gerencial` a cada fila de clientes y
     fórmulas. Vale `false` si `vinculado_por` no es de un gerencial.
   - `pantalla-vinculos.tsx` suma el filtro **"De un pedido"**: vínculo `manual` y `!por_gerencial`. Corregir o quitar
     sigue como hoy.

### B. Pantalla

1. **`lib/zomatik/np-cliente.ts`**: agregar `estadoVinculos(clientId, formulaId)`, `buscarParaVincular(tipo, q)` y
   `vincularDesdePedido(items, pedidoId?)`. Son fetch con el mismo patrón que `avisarNp`.
2. **`components/zomatik/vincular-cartel.tsx`** (nuevo; un `Dialog` de shadcn, como el resto; el buscador como el
   `Elegir` de `pantalla-vinculos.tsx`, con `Command`).
   - Props: `clientId`, `formulaId`, `plantId`, `pedidoId?`, `onVinculado(tipo, codigo, nombre)`,
     `onUsarCliente?(clientId)` (solo dentro del formulario), `alTerminar: "generar" | "nada"`, `onGuardarSinVincular?`
     y `onCerrar`.
   - Tiene una sección por lo que falta: Cliente y/o Fórmula. Cada una con las sugerencias, que muestran siempre el
     **código de Zomatik**, y el buscador.
   - Cuando ya no falta nada:
     - con `alTerminar: "generar"` y el pedido con NP en `error` o `pendiente`, llama a `generarNpAhora(pedidoId)` y
       muestra el resultado;
     - en el formulario, vuelve a "Guardar".
3. **`components/zomatik/np-bloque.tsx`**: props nuevas `faltan` y `onVincular`.
   - Con la planta activa y la elección ya leída, muestra el aviso (texto abajo) con el botón "Vincular" si
     `puedeVincularDesdePedido`. Sin permiso, solo el texto.
   - En "Ya tiene:", si la NP en error es por vínculo, el mismo botón.
4. **`components/dispatch-scheduling.tsx`**:
   - El select de `formulas` (línea 377) suma `zomatik_articulo_codigo, zomatik_vinculo`. `clients` ya trae `*`.
   - `faltan` se calcula con los datos que ya están en memoria (no frena Guardar).
   - **Control al Guardar**: en `handleSubmit`, después de las validaciones de siempre y **antes de grabar**, se abre
     el cartel si se dan todas estas condiciones:
     - la planta tiene la llave prendida;
     - es un alta, o el pedido entra en la NP automática;
     - falta algo;
     - la elección no es "Usar NP con saldo";
     - el pedido no tiene una NP `ok` viva;
     - no se eligió ya "Guardar sin vincular" en este diálogo.
   - "Guardar" y "Guardar sin vincular" siguen con el mismo `handleSubmit`. "Volver" cierra el cartel sin grabar.
   - `onUsarCliente`: `setForm({...form, client_id})`. Si la obra no es de ese cliente, se limpia la obra y se vuelve
     al formulario.
   - Después de vincular, se actualiza en memoria el cliente o la fórmula (`zomatik_codigo` /
     `zomatik_articulo_codigo`) para que el control no vuelva a saltar.
   - **Reintento en la edición**: si en este diálogo se vinculó algo y el pedido tenía la NP en `error`, después de
     `avisarNp` se llama a `generarNpAhora(pedidoId)` y se muestra el resultado. Si no, `avisarNp` no corre el robot
     (`creadas = 0`) y la NP quedaría en error.
   - **Menú ⋯ del pedido**: el ítem "Vincular con Zomatik" aparece cuando la NP está en error y
     `esFaltaDeVinculo(mensaje)`. Abre el cartel con `alTerminar: "generar"`, sin `onUsarCliente`.
   - Si "Generar NP ahora" falla por vínculo, el toast agrega: "Tocá ⋯ › Vincular con Zomatik."

## Fuera de alcance

- Vincular obras o proyectos desde el pedido; crear proyectos.
- Crear artículos o clientes en Zomatik. "Traer de Zomatik" sigue en el alta de cliente.
- Unificar clientes desde el cartel: sigue siendo de un gerencial, en Vínculos › Duplicados.
- El cruce por fechas y m³ en las sugerencias del cartel (sigue en Vínculos).
- Despacho manual sin pedido y OF suelta (Z1), aunque `z1-robot` pide lo mismo de la fórmula.
- Hacer los controles de "dato" antes de abrir la sesión de Zomatik (hallazgo de abajo).
- Cargar el CUIT de Zomatik en nuestro cliente.

## Base de datos

**No cambia el schema.** No hay tablas, columnas ni índices nuevos.
- Se escribe en las columnas que ya existen: `clients.zomatik_codigo/_vinculo/_vinculado_por/_vinculado_at` y
  `formulas.zomatik_articulo_codigo/_nombre/_vinculo/_vinculado_por/_vinculado_at`. Ahora también quien programa.
- Más filas en `activity_log`.
- **Datos ya cargados:** no cambian. Las 29 fórmulas y los 57 clientes sin vínculo siguen igual hasta que alguien los
  vincule desde un pedido o desde Vínculos.
- La NP de hoy, que quedó en error, no se toca: se resuelve vinculando y reintentando.
- Ningún vínculo existente se modifica.

## Textos de pantalla

- **Aviso en el bloque NP:** "Falta vincular con Zomatik: el cliente «LA TERCERA» y la fórmula «H8-620-15 (CAN)».
  Sin eso la NP no sale." Botón **Vincular**.
- **Título del cartel:** "Falta vincular con Zomatik". Bajada: "Elegí el que corresponde: queda para los próximos
  pedidos."
- **Sección cliente:** "Cliente: LA TERCERA · ¿cuál es en Zomatik?". Cada fila: "FIDEICOMISO LA TERCERA · 22812 · CUIT
  30-… · 43 remitos en el año · último 20/10", con una etiqueta (CUIT igual / nombre igual / nombre parecido) y el
  botón **Es este**.
  - Ya es de otro: "ya es «Fideicomiso La Tercera» acá". Dentro del formulario, botón **Usar «Fideicomiso La Tercera»
    en el pedido**.
  - Duplicado: "«LA TERCERA» parece el mismo que «Fideicomiso La Tercera» (Zomatik 22812). Si es el mismo, usá ese.
    Para unirlos, avisale a un gerencial (Vínculos › Duplicados)."
  - Buscador: "Buscar en Zomatik por nombre o CUIT". Sin resultados: "No aparece. Si es nuevo, hay que darlo de alta en
    Zomatik."
- **Sección fórmula:** "Fórmula: H8-620-15 (CAN) · ¿qué artículo es?". Cada fila: "H8-620-15 C (CAN) · 10090xxx ·
  misma resistencia, piedra y asentamiento" y el botón **Es este**.
  - De otra planta, deshabilitado: "es de Hudson", con (?) "Desde el pedido no se vincula con un artículo de otra
    planta."
  - Sin código de sistema: "no se puede usar en la NP".
  - Ninguno de la misma resistencia: "No hay un artículo H8 de Canning en Zomatik. Buscalo a mano o seguí sin
    vincular."
  - Buscador: "Buscar artículo por nombre o código".
- **Pie:** **Guardar** (se habilita cuando no falta nada), **Guardar sin vincular** con la ayuda "Se guarda y la NP
  queda pendiente; le llega un mail a Bautista.", y **Volver**.
- **Al vincular:** toast "Vinculado: LA TERCERA → FIDEICOMISO LA TERCERA (22812)".
- **Errores:**
  - "Ya lo vinculó {nombre}: desde el pedido no se cambia. Si está mal, lo corrige un gerencial en Vínculos."
  - "El CUIT no coincide (acá …, en Zomatik …): lo vincula un gerencial en Vínculos."
  - "Es un artículo de Hudson: desde el pedido no se vincula."
  - "Es un cliente genérico de Zomatik: no se vincula."
- **Menú ⋯:** "Vincular con Zomatik".
- **Vínculos:** filtro "De un pedido".

## Criterios de aceptación

1. **Aviso.** Canning con la llave prendida, alta con LA TERCERA + H8-620-15 (CAN) y NP nueva: el bloque NP muestra
   el aviso.
2. **Control al Guardar.** Con lo anterior, Guardar abre el cartel y **no se graba** ningún pedido hasta elegir.
3. **Cliente ya vinculado a otro.** En la sección cliente, 22812 aparece como "ya es «Fideicomiso La Tercera»", sin
   "Es este".
   - "Usar «Fideicomiso La Tercera»" cambia el cliente del formulario.
   - Si la obra no es de ese cliente, la pide de nuevo.
   - El POST de 22812 para LA TERCERA lo rechaza el servidor. La base no cambia.
4. **Sugerencias de fórmula.**
   - Solo aparecen artículos H8.
   - Primero los de Canning o sin sufijo, por piedra, asentamiento y método.
   - Cada uno muestra su código.
   - Los de Hudson van al final, deshabilitados.
   - Con una copia de prueba que tenga H8-620-10 C (CAN) y H8-620-15 C (CAN), va primero el 15.
5. **Vincular una fórmula.** Al elegir un artículo válido:
   - la fórmula queda con `zomatik_articulo_codigo`, `_nombre`, `zomatik_vinculo = 'manual'` y `vinculado_por` = quien
     programa;
   - hay una entrada de Actividad en la fórmula con "Desde: Programación";
   - Guardar genera la NP (estado ok) sin mail de error.
6. **Guardar sin vincular.** El pedido se guarda, la NP queda en error con el mensaje de hoy y llega **un** mail a
   Bautista (con la línea nueva de "vincular desde el pedido").
7. **Pedido ya guardado con la NP en error por vínculo.**
   - En ⋯ aparece "Vincular con Zomatik".
   - Al terminar de vincular, la NP se reintenta sola y sale "NP generada: NP …".
   - No llega un segundo mail.
   - En la Actividad del pedido figura quién vinculó qué.
8. **Edición de ese mismo pedido.** El bloque muestra el aviso. Después de vincular y Guardar sin otros cambios, la NP
   se reintenta.
9. **Permisos.**
   - Un operario con `programacion.cargar` (no gerencial) vincula desde el cartel.
   - Con el modo pedido, `quitar`, `sin_par` y `proyecto` dan error.
   - Uno ya vinculado da "Ya lo vinculó…", sin cambios en la base.
   - Con solo `ver`: el GET y el POST dan 403 y en pantalla se ve el aviso sin botón.
   - El POST sin `desde` sigue siendo solo de gerenciales (Vínculos igual que hoy).
10. **Cliente marcado `sin_par`.** Se puede vincular desde el pedido y la Actividad dice "Antes: No está en Zomatik".
11. **Bloqueos.**
    - Con CUIT válido distinto: bloqueado con el mensaje.
    - Artículo sin `codigo_sistema`: no se puede elegir.
    - Cliente genérico o inactivo de Zomatik: no aparece.
12. **Dos a la vez.** Si dos personas vinculan el mismo código a dos clientes al mismo tiempo, uno queda y el otro
    recibe "ya es «X»".
13. **Vínculos.** Lo vinculado por un no gerencial aparece en "De un pedido", con el nombre. El gerencial lo corrige o
    lo quita como siempre.
14. **Sin cambios donde no corresponde.**
    - Planta con la llave apagada, pedido de antes de prender la NP o "Usar NP con saldo": no salta el cartel al
      guardar.
    - Guardar tarda lo mismo que hoy (el control usa lo que está en memoria).
15. **Tests y tipos.** No se rompe nada. Pasan `npm run test:zomatik`, `test:zomatik-np`, `test:zomatik-z1` y
    `test:sesion`, y `tsc` no da errores nuevos en los archivos tocados.

## Pruebas automáticas

- **`test:zomatik`** (`zomatik.test.mjs`):
  - `sugerenciasCliente`:
    - el CUIT igual va primero;
    - LA TERCERA queda con `duplicadoDe` = Fideicomiso, y 22812 con `vinculado_a`;
    - salen los genéricos y los inactivos;
    - se marca el CUIT distinto.
  - `sugerenciasArticulo`:
    - para H8-620-15 (CAN), el orden pedido y Hudson con `otra_planta`;
    - se marca `sin_codigo_sistema`;
    - funciona el plan B de tokens para RDC;
    - el nombre igual va primero.
  - `controlVinculoPedido`: un caso por regla.
- **`test:sesion`** (`sesion-permisos.test.mjs`): `puedeVincularDesdePedido` con `cargar`, con `editar`, con solo
  `ver` y con gerencial al que se le sacó Programación.
- **`test:zomatik-np`** (`zomatik-np-servidor.test.mjs`, con la sb falsa que ya existe):
  - `esFaltaDeVinculo` contra los textos exactos del robot.
  - Una NP en error por una fórmula sin vínculo: se vincula en la sb falsa, se corre `procesarNp({pedidoId})`, queda
    ok y no hay un segundo mail.
  - Modo pedido de `vincular-servidor.ts`:
    - no pisa un vínculo hecho;
    - vincula sobre `sin_par`;
    - deja dos entradas de Actividad cuando hay pedido;
    - un 23505 se contesta con texto claro;
    - un `pedido_id` de otro cliente se rechaza.

  Si la sb falsa no soporta `.or`, sumarle lo mínimo.

## Prueba manual (preview = base de producción)

- **Con la llave prendida, un pedido de prueba genera una NP real en Zomatik.** Probar solo con pedidos reales: el de
  hoy, que quedó en error, y el próximo que se programe. Si no, probar con Bautista.
- La parte sin NP (aviso, cartel, sugerencias, buscador, permisos) se prueba en una planta con la llave apagada, que no
  muestra el cartel. Para eso se mira la ruta GET con sesión, o se prende con Bautista.

## Preguntas para Bautista (con la opción por defecto; el obrero arranca con el defecto)

1. **H8-620-15 (CAN) no tiene artículo de Canning en Zomatik.**
   - (a) **[por defecto]** Se da de alta el artículo en Zomatik; entra a la copia a la noche (o con "Actualizar" en
     Vínculos) y se vincula desde el pedido.
   - (b) Dejar elegir el de Hudson desde el cartel, con confirmación.
   - (c) Que lo decida solo un gerencial, en Vínculos.
2. **Clientes o fórmulas marcados "No está en Zomatik" (`sin_par`).**
   - (a) **[por defecto]** Quien programa los puede vincular.
   - (b) Solo un gerencial.
3. **CUIT distinto.**
   - (a) **[por defecto]** Bloquea en el cartel.
   - (b) Solo avisa y deja vincular.

## Hallazgos (no se arreglan acá)

- **El robot entra a Zomatik antes de controlar los datos.** `trabajarGenerar` abre la sesión (`ctx.abrir`) antes de
  `generarNp`, que es donde se controla el cliente y el artículo. Un error por falta de vínculo gasta una entrada a
  Zomatik (hay una espera de 10 min entre logins por proceso). Se podrían hacer los controles antes de abrir cuando no
  hay `buscarAntes`.
- **El mensaje "La fórmula no está vinculada…" mezcla dos casos:** que no tenga artículo y que el artículo no tenga
  `codigo_sistema`. El GET nuevo los separa. El robot sigue diciendo lo mismo.
- **"¿Qué NP?" › "de un proyecto" (`dispatch-scheduling.tsx` 1251) pone como cliente el vinculado al proyecto y como
  obra la vinculada al proyecto, aunque esa obra sea de otro cliente nuestro.** Es el caso de PRO 0001-31 →
  «CANCHA PADEL» de «LA TERCERA», con el proyecto de Fideicomiso. Puede quedar un pedido con una obra de otro
  cliente. Se arregla unificando La Tercera.
