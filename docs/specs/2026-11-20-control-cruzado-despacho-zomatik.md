# Control cruzado: lo despachado contra Zomatik (20/11/2026)

Estado: **propuesta**, rama `feat/control-cruzado-of` (sale de `main`). Hay migración (tablas nuevas) y un pg_cron nuevo.
Lo pidió Bautista el 20/11: "debería haber un control cruzado con mi sistema y lo que se despachó".

## 1. Objetivo

Que nunca más pase una semana sin que nadie se entere de que Zomatik no descontó la materia prima (13 al 20/11: ~72 t
de cemento). Todos los días se compara lo que despachó nuestro sistema con lo que tiene Zomatik: los m³ con OF, la
materia prima descontada y las OF del robot que quedaron sin descontar. Sale arriba de todo en el mail diario de
control y en Materias Primas › Control de stock.

## 2. Alcance

1. **m³:** despachados en el sistema contra m³ con OF en Zomatik, por planta y por día (últimos 7 días cerrados) y el
   total de la semana.
2. **Materia prima:** por planta y material (los 5 de `MATERIALES`), lo que descontó el sistema contra lo que descontó
   Zomatik, acumulado de los mismos 7 días.
3. **OF sin materia prima descontada:** la lista de las OF del robot de esos 7 días que no quedaron `ok`.
4. Lectura nueva de Zomatik: FABRICA › REPORTE PRODUCCION (solo lectura), guardada en una tabla nueva.
5. Una lectura automática a la mañana (pg_cron 05:42), para que el mail de las 16:25 compare hasta ayer completo.
6. Semáforo de una línea arriba del mail diario (y del semanal de los lunes) y una tarjeta en la pantalla.

**Fuera de alcance**
- Corregir algo en Zomatik: el control solo lee. No toca `lib/zomatik/z1-*.ts` ni el robot de las OF.
- Aditivos y fibra (Zomatik no los lleva en los depósitos 116 y 113).
- Las OF hechas a mano no entran en la lista del punto 3 (no sabemos su estado): se ven por la diferencia de material.
- Marcar diferencias como "revisadas". Una OF en `revisar` que alguien arregla a mano se corrige con el UPDATE que
  describe la migración `202611191200`; el botón para eso queda como etapa B (pregunta 4).
- Montos: ninguno. Solo m³ y toneladas.
- Mail o WhatsApp nuevo. No se cambia la hora ni los destinatarios del mail diario. No se toca `vercel.json`.
- El orden del cron de las 16:25 (remitos → mail → stock) no cambia.

## 3. Lo que ya existe y se reusa (no es un módulo paralelo)

| Qué | Dónde | Cómo se usa |
|---|---|---|
| Materiales, umbrales, formato | `lib/control-stock/calculo.ts`: `MATERIALES`, `UMBRAL_PCT` (5), `MINIMO_T` (0,5), `materialDeNombre`, `fmtT`, `dias` | Tal cual |
| Consumo de Zomatik | `zomatik_stock_movimientos` (prefijo `RMI`), `zomatik_stock_lecturas.leido_at` | Se lee; no cambia |
| Lectura de stock | `leerStockZomatik` (`lib/control-stock/servidor.ts`) | Se llama también desde el cron nuevo de la mañana; no cambia |
| Depósitos y plantas | `DEPOSITOS` (`lib/control-ingresos/cruce.ts`), `zomatik_np_config (plant_id, deposito)` | 116 Canning, 113 Hudson ("REBUCRET") |
| Estado de la MP de cada OF | `zomatik_remitos.of_mp_estado / of_mp_at / of_mp_detalle / fecha / m3 / of_numero` | Se lee; no cambia |
| Mail | `armarMail` (`lib/control-ingresos/mail.ts`), `mandarMail` (`servidor.ts`) | Se agrega un bloque arriba |
| Pantalla y permisos | `components/control-stock-zomatik.tsx`, `puedeControlar` | La tarjeta va arriba de la tabla; mismos permisos |
| Turno del robot, sesión, sucursal 18 | `zomatik_robot_tomar/soltar`, `obtenerSesion`, `sucursalDePagina` (`lib/zomatik/cliente.ts`) | Igual que las otras lecturas |

Lo único nuevo: la lectura del REPORTE PRODUCCION, su tabla y el cálculo de la comparación.

## 4. Decisiones

1. **Dónde vive:** `lib/control-produccion/` (`calculo.ts` puro y `servidor.ts`), hermano de `control-stock`, del que
   importa materiales y umbrales. La ruta y la pantalla cuelgan de control-stock (`/api/control-stock/despacho`, misma
   pestaña). Motivo: `control-stock/calculo.ts` compara stocks (saldos); esto compara consumos y m³ por día de despacho.
   Mezclarlos en el mismo archivo lo dejaría en más de 700 líneas con dos criterios distintos.
2. **Ventana:** los 7 días cerrados, de `hoy − 7` a `hoy − 1` (hora de Argentina). La misma para m³ y materia prima.
   **Hoy no se compara:** el robot hace las OF al finalizar el pedido o en la pasada de las 23:30. En la pantalla, hoy
   se muestra aparte, en gris, sin color.
3. **Zomatik "al día":** una fuente (el reporte de producción, o cada material de MOVIMIENTOS STOCK) vale si se leyó
   **hoy**. Una lectura de ayer no puede validar el consumo de ayer. Si no está al día: fila en gris, no cuenta como
   rojo y el semáforo dice "no se pudo leer Zomatik hoy".
4. **Días de gracia (2):** si ayer o anteayer faltan OF, va en **ámbar** ("todavía en plazo"), no en rojo. Del tercer
   día en adelante, rojo. Una OF de más es roja siempre.
5. **Umbrales:** materia prima, los de hoy: rojo si pasa el 5 % **y** media tonelada. m³: rojo si la diferencia es de
   **0,5 m³ o más** (sin porcentaje: la OF copia los m³ del despacho, tienen que coincidir; 0,5 absorbe el redondeo del
   reporte).
6. **El porcentaje va sobre nuestro sistema**, no sobre Zomatik como en la tabla de stock: el caso a detectar es
   justamente Zomatik en cero, y sobre cero no hay porcentaje. Se lee "faltan 71,2 t (79 %)".
7. **Consumo de Zomatik con fecha de otro día:** el descuento queda con la fecha del día en que se confirma. Para las
   OF del robot sabemos el día del despacho (`fecha`), cuándo se descontó (`of_mp_at`) y cuánto (`of_mp_detalle`): esas
   toneladas se **pasan al día del despacho**. Así la regularización del 20/11 no da rojo ni el 21 ni el 27 (ver 6.4).
   Lo que no se pueda atribuir (algo hecho a mano con otra fecha) se va solo a los 7 días: nunca es permanente.
8. **Humedad de las arenas:** el sistema descuenta la arena con humedad (`dispatch_materials.quantity`) y Zomatik la
   composición seca. No cuenta como diferencia: Zomatik está bien si cae entre lo seco y lo húmedo, ±5 % (pregunta 1).
9. **Hudson:** igual que Canning. Las plantas salen de `zomatik_np_config`; nada fijo por planta.
10. **Pruebas y OBRA PROPIA:** se excluyen los despachos de prueba (`is_test_dispatch`): no tienen OF. OBRA PROPIA
    REBUCRET **sí entra**: tiene NP, OF y remito como cualquier cliente. Las descargas manuales por árido no están en
    `dispatch_materials`, así que no entran.
11. **Hora:** el mail sigue a las 16:25. Zomatik se lee a las **05:42** (pg_cron), cuando las OF de ayer ya están
    (pasada de las 23:30 y reintentos) y nadie está programando: la lectura de stock ocupa el turno del robot unos
    minutos. Si falla, reintenta a las 06:42. El mail no lee nada nuevo: arma el bloque con esa lectura.
12. **Permisos:** `puedeControlar` (gerenciales o `materia_prima.editar`), controlado en el servidor.

## 5. Fuentes de datos

### 5.1 Nuestro sistema (solo lectura, se calcula en el momento)

m³ por planta y día:

```sql
SELECT d.plant_id, (d.dispatch_date AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS dia,
       f.zomatik_articulo_codigo, sum(d.quantity_m3) AS m3
  FROM dispatches d JOIN formulas f ON f.id = d.formula_id
 WHERE d.dispatch_date >= '2026-11-12T03:00:00Z' AND d.dispatch_date < '2026-11-19T03:00:00Z'
   AND coalesce(d.is_test_dispatch, false) = false
 GROUP BY 1, 2, 3;
```

Materia prima realmente descontada (sirve igual con el replanteo publicado: sale de `dispatch_materials`, no de la
fórmula):

```sql
SELECT d.plant_id, (d.dispatch_date AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS dia, m.name,
       sum(dm.quantity) / 1000 AS t, sum(coalesce(dm.dry_quantity, dm.quantity)) / 1000 AS t_seco
  FROM dispatch_materials dm
  JOIN dispatches d ON d.id = dm.dispatch_id
  JOIN materials m ON m.id = dm.material_id
 WHERE d.dispatch_date >= '2026-11-12T03:00:00Z' AND d.dispatch_date < '2026-11-19T03:00:00Z'
   AND coalesce(d.is_test_dispatch, false) = false
 GROUP BY 1, 2, 3;
```

- La planta es `dispatches.plant_id` (la que despachó). El material va a su clave con `materialDeNombre(m.name)`; lo que
  no es uno de los 5 no se compara.
- En el código: una consulta paginada a `dispatches` con `dispatch_materials(quantity, dry_quantity, materials(name))` y
  `formulas(code, zomatik_articulo_codigo, zomatik_articulo_nombre)`, agrupada con `fechaArgentina`. Se pide desde
  `hoy − 7` hasta ahora (hoy se muestra aparte).

### 5.2 Zomatik: m³ con OF (nuevo, `zomatik_produccion_dia`)

FABRICA › REPORTE PRODUCCION. `POST reporte_produccion.php` con el cuerpo exacto
`enviado=1&exportar=0&bus_fechad=AAAA-MM-DD`, sucursal 18. Devuelve 16 días desde esa fecha, una fila por producto y
depósito, por **fecha de entrega de la OF** (incluye las PEN). Se pide con `bus_fechad = hoy − 9` (la ventana más dos
días de margen): un solo pedido cubre la ventana, hoy y las dos plantas.

```sql
SELECT deposito, fecha, sum(m3) AS m3
  FROM zomatik_produccion_dia
 WHERE fecha BETWEEN '2026-11-12' AND '2026-11-18' AND segmento ILIKE 'hormigon%'
 GROUP BY 1, 2;
```

- La planta sale de la columna **Depósito** ("Canning" → 116, "REBUCRET" → 113, con `DEPOSITOS`), nunca del nombre del
  producto: en la captura hay 3 m³ de "H21-620-15 B (HUD)" en el depósito Canning el 19/11.
- La fila "… | M2" viene sin números: se ignora. Filas de otro segmento o de otro depósito se guardan en `otros` de la
  lectura y no se suman.
- Detalle por producto: el nombre del reporte se cruza con `zomatik_articulos.nombre` y de ahí con
  `formulas.zomatik_articulo_codigo`. Varias fórmulas pueden ir al mismo artículo ("H30-620-10 Pavimento (CAN)" y
  "H30-Cordones C (CAN)" → H30-620-10 C (CAN)): de nuestro lado se suman por artículo. Las fórmulas sin artículo van en
  un renglón "sin artículo de Zomatik". El detalle es informativo: el color lo da el total de la planta.

### 5.3 Zomatik: materia prima descontada (`zomatik_stock_movimientos`, ya existe)

```sql
SELECT deposito, codigo_articulo, fecha, sum(-movimiento) AS t
  FROM zomatik_stock_movimientos
 WHERE prefijo = 'RMI' AND fecha >= '2026-11-12'
 GROUP BY 1, 2, 3;
```

Solo `RMI` (con su signo: un RMI positivo resta). `RMP` (compras) y `RS` (ajustes) no cuentan; los `RS` de la semana se
muestran en el detalle. Cubre desde el inicio de la ventana del control (90 días) hasta la última lectura.

### 5.4 OF del robot (`zomatik_remitos`, ya existe)

Descuentos con fecha distinta a la del despacho (para la decisión 7):

```sql
SELECT plant_id, fecha, of_mp_at, of_numero, m3, of_mp_detalle
  FROM zomatik_remitos
 WHERE of_mp_estado = 'ok' AND of_mp_detalle IS NOT NULL AND of_mp_at >= '2026-11-12T03:00:00Z';
```

OF sin materia prima descontada (punto 3):

```sql
SELECT fecha, plant_id, of_numero, m3, formula_id, of_mp_estado, of_mp_mensaje
  FROM zomatik_remitos
 WHERE of_estado = 'ok' AND estado <> 'anulado' AND fecha BETWEEN '2026-11-12' AND '2026-11-18'
   AND (of_mp_estado IN ('revisar', 'pendiente') OR (of_mp_estado IS NULL AND fecha >= '2026-11-20'))
 ORDER BY fecha;
```

- `no` (OF duplicada, decidido) y `ok` no van. `pendiente` de hoy no va (está en curso). `NULL` anterior al 20/11 son
  filas viejas ya tratadas: no van.
- Sin la migración `202611191200` (error 42703): lista vacía y sin corrección de fechas; el resto anda.

## 6. Cálculo (`lib/control-produccion/calculo.ts`, funciones puras)

Constantes: `DIAS_VENTANA = 7`, `DIAS_GRACIA_OF = 2`, `MINIMO_M3 = 0.5`, `MP_OF_DESDE = "2026-11-20"`; `UMBRAL_PCT` y
`MINIMO_T` de control-stock. Por planta, con `V` = ventana y `G` = {ayer, anteayer}:

### 6.1 m³

- Por día: `dif = zomatik − sistema`.
- Semana: `difSemana = Σ dif`. `enEspera = Σ en G de max(0, sistema − zomatik)`.
  - `difSemana ≥ +0,5` → **rojo**, "sobran X m³ con OF" (OF duplicada o de más).
  - `difSemana ≤ −0,5`: `faltaFirme = −difSemana − enEspera`. Si `faltaFirme ≥ 0,5` → **rojo**, "faltan OF por X m³";
    si no → **ámbar**, "faltan OF por X m³ (de ayer o anteayer, en plazo)".
  - Si no → bien.
- Cada día con `|dif| ≥ 0,5`: falta en un día de gracia → ámbar; semana en rojo → rojo; semana bien → ámbar, "OF con otra
  fecha" (el total cierra). Así, si hay una celda roja, el semáforo está en rojo.

Ejemplo con la captura real (m³ con OF en Canning): 13/11 **41**, 16/11 **81,5**, 18/11 **45**, 19/11 **19,5**; Hudson
13/11 **36**. Si el sistema despachó lo mismo esos días, todo bien. Si el sistema tiene además 12 m³ el 17/11 sin OF
(ilustrativo), con hoy = 20/11 el 17 ya no está en gracia: 17/11 en rojo y semana "faltan OF por 12 m³".

### 6.2 Materia prima

Por planta y material, en toneladas, sobre `V`:

- `sistema` = Σ `quantity`; `seco` = Σ `dry_quantity` (si viene vacío, `quantity`).
- `zomatik` = Σ RMI con fecha en `V`
  − toneladas de OF del robot descontadas dentro de `V` cuyo despacho es de **antes** de `V`
  + toneladas de OF del robot con despacho en `V` descontadas **hoy** antes de la lectura (`of_mp_at ≤ leido_at`).
  El día de `of_mp_at` es el de Argentina. Solo filas `ok` con `of_mp_detalle`; el `codigo` del detalle se cruza con
  `MATERIALES.codigo`.
- Diferencia que se muestra: `zomatik − sistema`, y el % sobre `sistema`.
- Estado:
  1. Fuente sin leer hoy → gris, no cuenta.
  2. **Bien** si Zomatik está entre `seco` y `sistema`, o a menos de 5 % o de 0,5 t de cualquiera de los dos. Si solo
     cierra contra el seco, nota "por la humedad".
  3. Zomatik por arriba → **rojo**, "de más X t".
  4. Zomatik por abajo (contra el seco): **ámbar** si la falta en % no supera `% de m³ en espera de la semana + 5`
     ("faltan las OF de ayer"), o si se cubre con los RMI de hoy que no son de despachos de hoy ("Zomatik lo descontó
     hoy"). Si no, **rojo**, "faltan X t".

### 6.3 Ejemplo real: semana del 12 al 18/11, Canning, cemento

Sistema **90,3 t**, Zomatik **19,1 t** (seco = húmedo: el cemento no lleva humedad). Diferencia −71,2 t;
71,2 / 90,3 = **78,8 %**. Pasa el 5 % y la media tonelada. Las OF existían (el robot las hizo, sin la materia prima),
así que no hay m³ en espera que lo expliquen: **rojo, "faltan 71,2 t (79 %)"**. Con este control, la diferencia habría
salido en el mail a los pocos días de empezar, no una semana después.

### 6.4 Cómo se ve la regularización del 20/11

Ilustrativo: el robot descontó el 20/11 las 71,2 t de cemento atrasadas de Canning, de despachos del 13 al 18/11.

| Mail del | Ventana | Zomatik sin corregir | Con la decisión 7 |
|---|---|---|---|
| 19/11 | 12 al 18 | faltan 71,2 t: rojo (correcto) | igual |
| 21/11 | 14 al 20 | las 71,2 t están, pero una parte es del 13 (fuera): "de más" | se saca lo del 13: bien |
| 27/11 | 20 al 26 | las 71,2 t no son de esa semana: "de más 71,2 t", rojo | se sacan todas: bien |
| 28/11 | 21 al 27 | ya no entra | bien |

En la fila queda una nota gris: "X t se descontaron otro día y se pasaron al día del despacho". Si una regularización
se hizo a mano en Zomatik (sin pasar por el robot), no se puede corregir: se ve como "de más" hasta que sale de la
ventana, 7 días como mucho.

### 6.5 OF sin materia prima y semáforo

- Lista: la consulta de 5.4. Texto por fila: fecha, planta, OF, m³, fórmula y el motivo (`of_mp_mensaje`, o "todavía sin
  descontar" si está `pendiente`, o "sin dato" si es `NULL`).
- Semáforo:
  - **"Despacho contra Zomatik: hay diferencias"** (rojo) si en alguna planta la semana de m³ está en rojo, algún
    material está en rojo, o la lista no está vacía.
  - **"… no se pudo leer Zomatik hoy"** (ámbar) si no hay rojo y alguna fuente no está al día.
  - **"… todo bien"** (verde) en el resto. Si hay ámbar, una línea gris lo cuenta.

## 7. Mail

Dónde: primer bloque del cuerpo, debajo del título, en el diario y en el semanal de los lunes, en las dos variantes de
`armarMail` (con y sin importación). Mismos destinatarios (Juan; copia a Bautista y a Felipe Calvo) y misma hora.
Cuando hay rojo, al asunto se le agrega " · Despacho contra Zomatik: hay diferencias". Sin montos.

Todo bien (una línea verde, nada más):

> **Despacho contra Zomatik: todo bien.** Del 13/11 al 19/11 coinciden los m³ y la materia prima, y no hay OF sin
> descontar.

Con ámbar se agrega una línea gris: "Hudson: ayer faltan OF por 14 m³. Están en plazo."

Con diferencias (línea roja y el detalle corto; solo lo que no coincide):

> **Despacho contra Zomatik: hay diferencias.**
> Del 12/11 al 18/11. Hoy no se cuenta. Zomatik leído hoy 05:44.
>
> **m³:** coinciden en las dos plantas.
>
> **Materia prima descontada (t)**
> | Planta | Material | Sistema | Zomatik | Diferencia |
> |---|---|---|---|---|
> | Canning | CPC 40 | 90,3 | 19,1 | faltan 71,2 (79 %) |
>
> **OF sin materia prima descontada (2)**
> 18/11 · Canning · OF 0001-00003457 · 8 m³ · todavía sin descontar
> 18/11 · Canning · OF 0001-00003459 · 7,5 m³ · El artículo de la OF no tiene composición en Zomatik
>
> Ver el detalle

(Las OF de la lista y sus m³ son de ejemplo.) Si los m³ no coinciden: "Canning: el sistema despachó 265,5 m³ y
Zomatik tiene OF por 253,5. Faltan OF por 12 m³ (17/11)."

Sin lectura: "**Despacho contra Zomatik: no se pudo leer Zomatik hoy.** Última lectura: 19/11 05:44."

Reglas: el bloque nunca rompe el mail (`seccionDespachoParaMail` no tira). Si faltan las tablas nuevas, el bloque no
sale (mail como hoy). Cualquier otro error: línea ámbar "no se pudo controlar hoy".

## 8. Pantalla

Materias Primas › Control de stock: una tarjeta **arriba** de la tabla actual (`components/control-despacho-zomatik.tsx`,
montada en `control-stock-zomatik.tsx`). `text-xs`, sin negritas, como el resto. "Actualizar ahora" (el botón que ya
está) lee también el reporte de producción y recarga la tarjeta.

```
Despacho contra Zomatik · 13/11 al 19/11 · Zomatik leído hoy 05:44      ● Hay diferencias  (?)

m³ despachados / con OF
Planta    13/11  14/11  15/11  16/11  17/11  18/11  19/11 | Semana                         | Hoy
Canning   41     -      -      81,5   12/0   45     19,5  | 199 / 187  faltan 12           | 32 / 12
Hudson    36     -      -      -      -      -      14/0  | 50 / 36    faltan 14, en plazo | -

Materia prima descontada en la semana (t)
Planta    Material               Sistema  Zomatik  Diferencia
Canning   Arena Fina             48,1     45,9     faltan 2,2 (4,6 %) · por la humedad
Canning   CPC 40                 90,3     19,1     faltan 71,2 (79 %)
Hudson    Piedra 6/20            ...

OF sin materia prima descontada (1)
18/11 · Canning · OF 0001-00003459 · 7,5 m³ · H40-612-15 B (CAN) · El artículo no tiene composición en Zomatik
```

(Maqueta. Son reales los m³ con OF de la captura, 41, 81,5, 45, 19,5 y 36; el 90,3 contra 19,1 es el de la semana del
12 al 18. El resto son números de ejemplo.)

- Celda de m³: un solo número si coincide; "sistema / Zomatik" si no, en rojo o ámbar. "Hoy" siempre en gris.
- Filas de material: rojo, ámbar o normal; en gris con "Zomatik sin leer hoy (última: dd/mm hh:mm)" y el error de la
  lectura si lo hay. Antes de las 5:45 toda la tarjeta está en gris: es normal.
- Al tocar una planta en m³: el detalle por producto y día (sistema por artículo / Zomatik). Al tocar un material: por
  día, sistema, Zomatik (ya pasado al día del despacho) y los `RS` de la semana.
- (?): "Compara los últimos 7 días cerrados. Hoy no cuenta: las OF se hacen al finalizar el pedido o a la noche. En
  rojo: m³ que no coinciden (0,5 o más) o materia prima con más de 5 % y media tonelada de diferencia. En ámbar: OF de
  ayer o anteayer que todavía no están. La arena se descuenta con humedad en el sistema y seca en Zomatik: no cuenta.
  Zomatik se lee solo a las 5:45."
- Sin la migración: la tarjeta dice "Falta aplicar la migración del control de despacho (202611201500)" y la tabla de
  stock sigue andando.

Ruta: `GET /api/control-stock/despacho` → `{ hoy, desde, hasta, semaforo, lectura, plantas: [{ planta, m3: { dias,
semana, hoy, productos }, materiales: [...] }], ofSinMp: [...] }`. `maxDuration` 60. Solo lee.

## 9. Base de datos

**Hay migración.** Dos archivos, los corre Bautista a mano:

`supabase/migrations/202611201500_control_produccion.sql` (antes o después de publicar; se puede correr dos veces):

- `zomatik_produccion_dia`: `id bigserial`, `fecha date`, `deposito integer`, `plant_id uuid` (nulo si no hay planta),
  `segmento text`, `producto text`, `articulo_codigo integer` (nulo si el nombre no cruza), `um text`, `m3 numeric`,
  `leido_at timestamptz`. Índice `(deposito, fecha)`. Solo se guardan las celdas con m³ distinto de 0.
- `zomatik_produccion_lectura`: una sola fila (`id = 1`): `desde`, `hasta`, `filas`, `otros jsonb` (segmentos o
  depósitos que no se sumaron), `leido_at` (última lectura buena), `intento_at`, `error`.
- `control_produccion_reemplazar(p_desde date, p_hasta date, p_filas jsonb, p_otros jsonb)`: borra los días de
  `p_desde` a `p_hasta`, inserta lo leído y actualiza la lectura, todo o nada. Los días anteriores quedan como historia.
- Permisos: solo `service_role`; `anon` y `authenticated` sin acceso (como `zomatik_stock_*`).

`supabase/migrations/202611201510_control_produccion_cron.sql` (**después** de publicar en `main`; antes la ruta no
existe): pg_cron `control-despacho-lectura`, `'42 8,9 * * *'` (05:42 y 06:42 de Argentina), `net.http_get` a
`https://www.produccionrebucret.com/api/control-stock/actualizar` con el `cron_secret` de Vault, igual que
`202611061010`. Vuelta atrás: `SELECT cron.unschedule('control-despacho-lectura');`.

**Qué pasa con los datos ya cargados: nada.** Son tablas nuevas que arrancan vacías; no se toca ninguna tabla
existente (`dispatches`, `dispatch_materials`, `zomatik_remitos` y `zomatik_stock_*` solo se leen). La planta sale de
`plant_id` y del depósito, como en el control de stock.

## 10. Lista cerrada del robot (`lib/zomatik/web.ts`, grupo 1, solo lectura)

- `REPORTE_PRODUCCION = "reporte_produccion.php"`. `rutaPermitida`:
  - `GET reporte_produccion.php` → sí.
  - `POST reporte_produccion.php` (exacto, sin `?enviado=1`: así es el formulario real) → sí.
  - No se agrega a `LISTADOS`: no habilita `?enviado=1` ni `output/reporte_produccion.xlsx`.
- `cuerpoReporteProduccionValido(cuerpo)`: solo `^enviado=1&exportar=0&bus_fechad=\d{4}-\d{2}-\d{2}$`. `pedir`
  (`cliente.ts`) lo controla antes de salir, como hace con `RUTA_AUTORIZAR_NP`. Con `exportar=1` o cualquier otro campo,
  no sale.
- `fetchReporteProduccion(s, desde)` en `cliente.ts`: elige la sucursal 18, hace el POST y exige que la **misma
  respuesta** muestre la sucursal 18 (`sucursalDePagina`; la página trae el selector `frm_selsuc`). Si muestra otra,
  error "otra sucursal"; el lector reintenta una vez a los 15 s. Si es la página de login, sesión caída.
- Ningún grupo de escritura cambia.

## 11. Lectura (`lib/control-produccion/servidor.ts` y `app/api/control-stock/actualizar/route.ts`)

- `leerProduccionZomatik(sb, { t0, limite })`: turno del robot (espera hasta 20 s) → sesión → `fetchReporteProduccion`
  con `hoy − 9` → `leerReporteProduccion(html)` → guardar con `control_produccion_reemplazar`. No se guarda si: no hay
  tabla, el encabezado no trae 16 fechas seguidas desde la pedida, o ningún depósito es Canning o REBUCRET. En ese caso
  queda la lectura anterior y el `error` en `zomatik_produccion_lectura`.
- `actualizar/route.ts`:
  - `POST` (botón): lee primero el reporte de producción (es corto) y después el stock, como hoy.
  - `GET` nuevo, solo cron (`esLlamadaDeCron`): si todo está leído hoy, no hace nada ("ya leído hoy", para el reintento
    de las 06:42); si no, producción y después `leerStockZomatik`. Entre las 16:00 y las 16:59 no corre.
- `calcularDespacho(sb, hoy)`: arma la comparación (5 y 6). La usan la ruta de la pantalla y `seccionDespachoParaMail`.
- El cron de las 16:25 (`controlar`) no cambia: después del mail sigue leyendo el stock para la pantalla.

## 12. Tests

`lib/__tests__/control-produccion.test.mjs` (script `test:control-produccion` en `package.json`, igual que
`test:control-stock`), con `lib/__fixtures__/control-produccion/reporte-produccion.html`:

1. `leerReporteProduccion`: 16 días, del 13/11 al 28/11. Canning: 13/11 = 41, 16/11 = 81,5, 18/11 = 45, 19/11 = 19,5,
   21/11 = 1. Hudson: 13/11 = 36. La fila "M2" sin números no suma ni rompe. El "(HUD)" del 19/11 suma en Canning.
2. Encabezado con menos de 16 fechas, fechas salteadas o sin tabla → no vale.
3. Página con la sucursal 17 → se rechaza.
4. m³: iguales → bien; falta ayer → ámbar y semana sin rojo; falta hace 3 días → rojo; OF duplicada → rojo "sobran";
   misma cantidad en otro día de la semana → ámbar "otra fecha"; hoy no entra en nada.
5. Ejemplo real: 90,3 t contra 19,1 t → −71,2 t, 78,8 %, rojo.
6. Regularización: RMI del 20/11 con filas del robot (despachos del 13 al 18, `of_mp_at` del 20): ventana 14–20 bien,
   ventana 20–26 bien; sin las filas del robot, "de más" en rojo.
7. Humedad: sistema 61,2, seco 58,0, Zomatik 58,1 → bien, "por la humedad"; Zomatik 50,0 → rojo.
8. Gracia: 14 % de m³ en espera y falta 13 % de un material → ámbar; falta 40 % → rojo. Falta cubierta por RMI de hoy →
   ámbar.
9. Umbrales: 0,4 t con 50 % → no es rojo; 5,0 % justo → no; 5,1 % y más de 0,5 t → sí.
10. Lista de OF: `revisar` va; `pendiente` de ayer va y de hoy no; `no` y `ok` no; `NULL` del 18/11 no y del 21/11 sí.
11. Dos fórmulas con el mismo artículo se suman en un renglón del detalle.
12. Mail: todo bien → una línea y ninguna tabla; con rojo → línea, detalle y asunto con el agregado; sin lectura de hoy →
    "no se pudo leer"; nunca aparece "$".

`lib/__tests__/zomatik.test.mjs`: `GET` y `POST reporte_produccion.php` pasan; `POST reporte_produccion.php?enviado=1`,
`output/reporte_produccion.xlsx`, `grabar_*` y `manage_*` no. El cuerpo exacto pasa; con `exportar=1`, un campo de más
u otro orden, no.

`lib/__tests__/control-ingresos.test.mjs`: `armarMail` con y sin el bloque (diario, semanal y con importación); sin el
bloque, el mail queda igual que hoy.

## 13. Criterios de aceptación

1. Con el fixture, Canning da 41 / 81,5 / 45 / 19,5 m³ el 13, 16, 18 y 19/11 y Hudson 36 el 13/11.
2. Semana del 12 al 18/11, Canning, cemento: 90,3 contra 19,1 → rojo, "faltan 71,2 t (79 %)".
3. Con la base real, el día que se publique: la regularización del 20/11 no deja ningún material "de más" en rojo.
4. Hoy nunca da color. Una OF de ayer que falta va en ámbar; a los 3 días, en rojo.
5. El mail diario y el de los lunes empiezan con la línea "Despacho contra Zomatik: …". Con rojo, lo dice el asunto.
   Sin montos.
6. Si el bloque falla, el mail de ingresos sale igual. Sin las tablas nuevas, sale como hoy.
7. Si Zomatik no se leyó hoy, el semáforo dice "no se pudo leer Zomatik hoy": nunca "todo bien" con datos viejos.
8. La pantalla la ven los mismos que hoy ven Control de stock; la ruta devuelve 403 al resto.
9. El robot no puede pedir de `reporte_produccion.php` nada que no sea el GET y el POST exacto. Nunca se escribe en
   Zomatik ni en `dispatches`, `dispatch_materials`, `stock_*`, `materials` o `zomatik_remitos`.
10. `npm run test:control-produccion`, `test:control-stock`, `test:control-ingresos`, `test:zomatik` y
    `test:zomatik-z1` pasan. `tsc` sobre los archivos tocados no suma errores.
11. A las 05:42 quedan leídos el reporte de producción y los 10 materiales; a las 06:42, si ya está, no hace nada.

## 14. Archivos

Nuevos:
- `lib/control-produccion/calculo.ts` (patrón: `lib/control-stock/calculo.ts`)
- `lib/control-produccion/servidor.ts` (patrón: `lib/control-stock/servidor.ts`)
- `app/api/control-stock/despacho/route.ts` (patrón: `app/api/control-stock/route.ts`)
- `components/control-despacho-zomatik.tsx` (patrón: `components/control-stock-zomatik.tsx`)
- `lib/__tests__/control-produccion.test.mjs`
- `supabase/migrations/202611201500_control_produccion.sql`
- `supabase/migrations/202611201510_control_produccion_cron.sql`

A modificar:
- `lib/zomatik/web.ts` (lista cerrada) y `lib/zomatik/cliente.ts` (`fetchReporteProduccion`, control del cuerpo en `pedir`)
- `app/api/control-stock/actualizar/route.ts` (GET del cron y lectura de producción)
- `lib/control-ingresos/mail.ts` y `lib/control-ingresos/servidor.ts` (bloque arriba y asunto)
- `components/control-stock-zomatik.tsx` (montar la tarjeta, texto del (?))
- `package.json` (solo el script de test; ninguna dependencia)
- `lib/__tests__/zomatik.test.mjs`, `lib/__tests__/control-ingresos.test.mjs`
- `docs/control-stock-mp.md`, `docs/control-ingresos-mp.md` y `docs/migracion-loop/zomatik.md` (sección 31)

Ya está: `lib/__fixtures__/control-produccion/reporte-produccion.html`.

## 15. Limitaciones conocidas

- Una OF hecha a mano con fecha distinta a la del despacho, justo en el borde de la ventana, puede dar un rojo de un
  día. Una regularización hecha a mano en Zomatik se ve como "de más" hasta 7 días.
- Una OF en `revisar` que alguien descuenta a mano sigue en la lista hasta que sale de la ventana (7 días) o se corrige
  la fila (pregunta 4).
- `leerStockZomatik` no guarda un material si Zomatik no tiene movimientos en 10 días y nosotros sí consumos
  (`sospechaCorte`). En ese caso la fila queda en gris con ese texto y el semáforo en "no se pudo leer": no pasa por
  "todo bien", pero tampoco sale en rojo.
- Los despachos de prueba consumen material nuestro sin OF: acá no se ven; aparecen en el stock final del control de
  stock.

## 16. Para confirmar antes de programar (orquestador, con la base real)

1. `of_mp_detalle[].codigo` trae el código de 8 dígitos (10000026…): mirar tres filas `ok`.
2. La regularización del 20/11 pasó por el robot (filas con `of_mp_at` del 20/11 y `fecha` del 13 al 18). Si se hizo
   de otra forma, el criterio 3 no se cumple hasta el 27/11.
3. Humedad real de las arenas en la última semana: `sum(quantity)` contra `sum(dry_quantity)` por planta.
4. El formulario real de `reporte_produccion.php` no necesita más campos que los tres del cuerpo, y la página muestra
   los m³ con sus decimales (un despacho de 7,25 m³).
5. Si el reporte incluye OF anuladas.

## 17. Preguntas para Bautista (con recomendación)

1. **La humedad de la arena, ¿cuenta como diferencia?** El sistema descuenta la arena mojada y Zomatik seca, así que la
   arena fina puede dar siempre unos puntos de más. *Recomiendo* que no cuente (decisión 8). Si no, la arena va a estar
   en rojo casi todos los días.
2. **¿Cuántos días se espera una OF antes de marcarla en rojo?** *Recomiendo* 2 (ayer y anteayer en ámbar). Con 3, un
   despacho del viernes cargado el lunes tampoco da rojo.
3. **Lectura de Zomatik a las 5:45 de la mañana** (nueva, automática), para que el mail de las 16:25 compare hasta ayer
   completo. Sin eso, el mail compararía con dos días de atraso. *Recomiendo* que sí. Necesita correr dos scripts.
4. **Una OF que quedó "sin descontar" y alguien arregla a mano en Zomatik sigue en la lista hasta 7 días.** ¿Agregamos
   un botón "Ya está descontada" (queda en Actividad)? *Recomiendo* dejarlo para una segunda etapa y ver primero cuántas
   aparecen.
5. **OBRA PROPIA entra en la comparación** (tiene OF como cualquier cliente). *Recomiendo* que sí.

## 17. Decisiones tomadas y datos confirmados (20/11, orquestador) — mandan sobre lo anterior

**Decisiones (se toman las recomendaciones):**
1. La humedad de la arena no cuenta como diferencia: Zomatik está bien si cae entre lo seco y lo húmedo, ±5 %.
2. Una OF se espera 2 días antes del rojo.
3. Lectura automática de Zomatik a las 05:42, con reintento 06:42. Las dos migraciones se escriben y NO se aplican.
4. El botón "Ya está descontada" queda para una segunda etapa.
5. OBRA PROPIA entra en la comparación. Solo se excluyen los despachos de prueba.

**Cambio importante: el semáforo de materia prima va POR GRUPO, no por material.** Con las 13 OF regularizadas el 20/11
(239,5 m³), lo que descontó Zomatik (composición del artículo) contra lo que descontó el sistema (fórmula real) da:

| Material | Sistema (t) | Zomatik (t) | Dif. |
|---|---|---|---|
| Cemento (10000026) | 72,64 | 72,80 | +0,2 % |
| Arena 0/6 (10000001) | 66,54 | 56,34 | −15,3 % |
| Arena fina (10000004) | 156,53 | 169,05 | +8,0 % |
| **Arenas, suma** | 223,07 | 225,39 | **+1,0 %** |
| Piedra 6/20 (10000005) | 208,61 | 231,36 | +10,9 % |
| Piedra 6/12 (10000612) | 13,59 | — | — |
| Piedra 10/30 (no está en Zomatik) | 19,50 | — | — |
| **Piedras, suma** | 241,70 | 231,36 | **−4,3 %** |

Las composiciones de Zomatik no reparten los áridos igual que las fórmulas del sistema (y la Piedra 10/30 del pavimento
no existe en la composición): material por material daría rojo permanente sin que falte nada. Entonces:
- **Semáforo (rojo/verde) por grupo:** **cemento**, **arenas** (suma de 10000004 + 10000001) y **piedras** (suma de
  10000005 + 10000612 + la Piedra 10/30 y cualquier otra piedra del sistema del lado nuestro). Umbral 5 % y mínimo 0,5 t,
  con la banda seco–húmedo en arenas.
- **Material por material:** se muestra como detalle informativo, sin color (o en gris), en la pantalla; en el mail no.
- Los materiales nuestros que Zomatik no descuenta (agua, aditivos) no entran.
- `MATERIALES` de control-stock no tiene la Piedra 10/30: para el grupo "piedras" del lado nuestro, tomar los
  materiales de la planta cuyo nombre empieza con "Piedra" (definir el criterio en un solo lugar, con test).

**Datos confirmados contra la base (solo lectura):**
- `of_mp_detalle[].codigo` trae el código de 8 dígitos ("10000001", "10000004", "10000005", "10000026").
- La regularización del 20/11 pasó por el robot: 13 filas con `of_mp_at` del 20/11 y `fecha` del 12 al 19/11.
- Humedad real de la arena fina en la semana del 12 al 19/11 (Canning): 226,45 t húmedo contra 219,38 t seco (3,2 %).
  Las demás, igual seco y húmedo.
- `reporte_produccion.php`: alcanza con los tres campos capturados; muestra decimales (43.5, 39.5, 7.5). No se sabe si
  incluye OF anuladas: tratar una OF "de más" como rojo solo si supera 0,5 m³ en la semana, como dice la spec.
