# Replanteo: hormigón que vuelve en el camión

Estado: **propuesta del arquitecto, 18/11/2026; decisiones tomadas al final.** Rama
`feat/replanteo-retorno` (sale de `main`).

Pedido de Bautista (18/11): "cuando vayas a despachar un camión, abajo de todo, al lado del cartel que dice despachar,
que haya un botón que diga **Replanteo**. En el replanteo decís con cuántos m³ volvió el camión: 0,5, 1, 1,5, 2… Si
volvió con 1 m³, el cartel dice: se van a descontar 7 m³ de materia prima cuando se despache. Y también un campo para
agregar cemento, con la cantidad de kilos. Lo que se agregue de cemento también se descuenta de la materia prima."

Y sobre la carga de planta: "Ahí le voy a estar diciendo cuánto quiero cargar realmente de m³ y si hay que agregar
cemento."

Caso: el camión vuelve de obra con 1 m³ que sobró. Para el próximo viaje se cargan 7 m³ en vez de 8 y el operario
agrega a mano 50 kg de cemento. Remito, OF y NP: **8 m³**. Materia prima: fórmula × **7 m³ + 50 kg de cemento**. Orden a
la planta: **7 m³ + 50 kg de cemento**.

---

## 0. Qué hay hoy (relevado en el código)

| Pieza | Dónde | Qué hace hoy | Qué se toca |
|---|---|---|---|
| Entrega | `components/despacho/entrega-dialog.tsx` | Formulario del Despacho nuevo; "Despachar e imprimir" y "Despachar"; `registrar_despacho`; con puesto de carga que manda órdenes (`modoPlanta`), después llama a `/api/carga/enviar` | Botón y panel Replanteo |
| Reglas de la Entrega | `lib/despacho.ts` (`FormEntrega`, `validarEntrega`, `armarPayloadDespacho`) | Puro, con pruebas en `lib/__tests__/despacho.test.mjs` | Campos y reglas del replanteo |
| `registrar_despacho` | Vigente: `supabase/migrations/202610201200_fase3_despacho.sql` (línea 522) | Materiales = `_consumo_formula(fórmula, planta, quantity_m3)`; fibra = kg/m³ × `quantity_m3`; `_mover_stock` una vez | Fórmula por `quantity_m3 − retorno_m3` + fila de cemento |
| `editar_despacho` | Vigente: mismo archivo (línea 916) | Camino **escala** (misma fórmula y planta, conserva la humedad del día) y **recálculo**. Stock por diferencia con `_aplicar_neto` (ancla de recuento) | Ratios separados (fórmula / fibra) y la fila de cemento |
| `anular_despacho` | `202610021000_fase2_viajes.sql` (línea 517) | Devuelve todas las filas de `dispatch_materials` | **No se toca** |
| Orden de carga | `app/api/carga/enviar/route.ts` | `cargas.m3 = quantity_m3`, `ciclos = ⌈m3 / m3_max_ciclo⌉`, receta, cliente, camión, Observación = remito | `m3 = quantity_m3 − retorno_m3` y el cemento extra |
| Orden a Indumix | `OrdenPlanta` (`lib/carga/tipos.ts`), `pasosArranque` (`lib/carga/puente.ts`) | Escribe receta, m³, cliente, camión, Observación. **No hay forma de mandar kilos sueltos de cemento** (nunca se escriben recetas) | El cemento va como **indicación** en la pantalla de Carga |
| Pantalla de Carga | `components/carga/pantalla-carga.tsx`, `usar-datos-carga.ts` | Cola, confirmación ("Cargar…"), carga en curso, parada (`efectoSobreDespacho`) | Muestra 7 m³ + cemento; parada con el retorno |
| Auditoría de carga | `lib/carga/auditoria.ts` (`banderas`, `desvio`), `components/carga/auditoria-carga.tsx` | "Dif. volumen" si m³ de cargas ≠ m³ del remito (± 0,1); "Desviación" si lo pesado se va de la tolerancia | Compara contra los m³ **a cargar** y suma el cemento extra a lo esperado |
| Cierre de carga | `lib/carga/cierre.ts` (`efectoSobreDespacho`, `ajustesStock`), `ajustar_stock_carga` (SQL) | Parada "sale con lo cargado" corrige el remito a lo cargado; kilos reales = real − teórico del despacho | `efectoSobreDespacho` suma el retorno; `ajustar_stock_carga` no cambia (ver 8.5) |
| Historial | `components/dispatch-history.tsx` | Edita con `editar_despacho`; fibra = kg/m³ × `quantity_m3` | Campos de replanteo, marca, Excel |
| Zomatik Z1 / NP / ajuste | `lib/zomatik/*` | Usan `dispatches.quantity_m3` | **No se tocan**: siguen en 8 |
| Pantalla vieja | `plantista-view.tsx`, `add-dispatch-dialog.tsx` | `registrar_despacho` sin los campos nuevos | No se tocan |

**Conclusión:** no hace falta nada paralelo. El replanteo es un dato del despacho (cuántos m³ volvieron y cuánto
cemento se agregó) que cambia **tres cosas y nada más**: cuánta fórmula se descuenta, una fila de cemento, y los m³ y el
cemento de la orden a la planta. Remito, OF, NP, pedido, viajes y probetas siguen mirando `quantity_m3`.

Carga de planta hoy: el único puesto ("Canning · simulador") está **apagado**. El diseño anda sin carga (solo stock) y
queda listo para cuando se prenda.

## 1. Objetivo

Que el despacho de un camión que sale con hormigón que volvió diga **8 m³** al cliente (remito, OF, NP, pedido), le
pida a la planta **7 m³ + 50 kg de cemento**, y descuente de materia prima **la fórmula por 7 más el cemento**.

## 2. Alcance

### 2.1 Qué se hace
1. Botón **Replanteo** en la Entrega del Despacho nuevo, al lado de "Despachar": m³ que volvieron, kg de cemento y el
   cartel con lo que se carga y se descuenta. Con y sin puesto de carga.
2. `registrar_despacho` guarda el replanteo y descuenta fórmula × (m³ − retorno) + cemento.
3. `editar_despacho` (Historial) deja poner, cambiar o sacar el replanteo y recalcula el stock por diferencia.
4. **Carga de planta:** la orden a la cola va por los m³ a cargar (7) y lleva el cemento extra; la pantalla de Carga lo
   muestra y pide confirmar el cemento; la auditoría no marca diferencia contra los 8 del remito; la parada respeta el
   retorno.
5. Se guarda de qué despacho volvió el hormigón (automático, opcional; decisión 14.4).
6. Actividad del despacho y eventos de la carga con el replanteo.
7. Historial, Excel, detalle del material y Calidad muestran que hubo replanteo.

### 2.2 Fuera de alcance
- Pantalla vieja (`plantista-view`) y despacho manual sin pedido (`add-dispatch-dialog`): sin botón.
- El despacho del que volvió el hormigón: no se toca (sigue con sus 8 m³ y su consumo).
- Zomatik: OF, remito, NP y ajuste no cambian (`quantity_m3`). Ver 10.3 por el stock de MP en Zomatik.
- Escribir el cemento extra en Indumix: no hay cómo (el puente nunca escribe recetas y la orden no tiene kilos
  sueltos). Lo agrega el plantista a mano; el sistema se lo indica y le pide confirmarlo.
- Prender la carga de planta o el ajuste con kilos reales (`usa_kilos_reales`): siguen apagados.
- Volver a mandar una orden ya en la cola si se edita el replanteo en Historial (igual que hoy con los m³: ver 10.19).
- Calidad del hormigón que volvió. Muestras, probetas y asentamiento no cambian.
- Cargar replanteos de días pasados en masa.

## 3. Reglas

### 3.1 Cuánto

| | Cuánto |
|---|---|
| m³ del despacho (`quantity_m3`) | **8**. Remito, OF, NP, pedido, viaje, informes de m³ |
| m³ a cargar | `quantity_m3 − retorno_m3` = **7**. Orden a la planta y consumo de fórmula |
| Fórmula | `_consumo_formula(fórmula, planta, m³ a cargar)` |
| Cemento del replanteo | `cemento_extra_kg`, en **una fila aparte** de `dispatch_materials` (`es_replanteo = true`); en la orden, `cargas.cemento_extra_kg` |
| Fibra | kg/m³ × **m³ del camión (8)**, como hoy (decisión 14.5) |
| Superfluidificante en obra | Como hoy |

Sin replanteo (`retorno_m3` nulo) todo es exactamente lo de hoy, también la orden de carga.

### 3.2 Qué material es "el cemento" (`_cemento_replanteo(fórmula, planta)`, decisión 14.2)
1. El material `cemento` de la fórmula, llevado a la planta que despacha con `_material_en_planta`. Si la fórmula tiene
   **más de uno**, el de más kg/m³ (empate: por nombre).
2. Si la fórmula no tiene: el único material `cemento` de la planta.
3. Si no se puede saber y hay cemento > 0: **frena** con "No se sabe de qué cemento descontar: la fórmula no tiene
   cemento." Con 0 kg no frena.
4. Con `descuenta_stock = false`, se registra y no mueve el stock (regla de siempre).

La pantalla lo muestra ("Se descuenta de CPC 40.") con la RPC de lectura `cemento_para_replanteo` (misma función).

### 3.3 Límites (decisión 14.3)

| Dato | Regla | Si no se cumple |
|---|---|---|
| Retorno | De a 0,5 m³; mayor a 0 y hasta los m³ del camión (volvió entero = se permite) | Frena (pantalla y base) |
| Cemento | Número ≥ 0 y ≤ **1.000 kg** | Frena |
| Cemento alto | Más de **100 kg por m³ que volvió** | Aviso, no frena |
| Cemento sin retorno | No se puede | Frena (base) |
| Despacho de prueba / por árido | Sin replanteo | Frena (base) |

### 3.4 Despacho del que volvió (decisión 14.4)
Al abrir el panel, la pantalla busca el último despacho del **mismo camión** en las últimas 12 h (no de prueba) y lo
muestra en una línea. Se guarda en `retorno_de_dispatch_id`. "No es ese" lo saca. Si se cambia el camión, se busca de
nuevo.

## 4. Pantalla: Entrega (`entrega-dialog.tsx`)

**Pie:** `[Cancelar] [Replanteo] [🖨 Despachar e imprimir] [Despachar]`.
- "Replanteo" es `variant="outline"`; con replanteo cargado pasa a ámbar y dice **"Replanteo · volvió 1 m³"**.
- Aparece **con y sin** puesto de carga. No aparece si la base no tiene la columna (sonda
  `select("retorno_m3").limit(0)` al abrir, como la de `remito_tipo`).

**Panel** (arriba del pie, dentro del mismo diálogo):

```
Replanteo  (?)
¿Con cuántos m³ volvió?   [0,5] [1] [1,5] [2] [2,5] [3]  Otro [____]
Cemento agregado (kg)     [____]   Se descuenta de CPC 40.
┌──────────────────────────────────────────────────────────────────────┐
│ Se van a descontar 7 m³ de materia prima + 50 kg de cemento          │
│ cuando se despache. Remito y OF: 8 m³.                               │
└──────────────────────────────────────────────────────────────────────┘
Volvió del remito R 1234 · La Tercera · H21 (09:40)   No es ese
Sacar replanteo
```

- (?) → "Usalo cuando el camión vuelve con hormigón que sobró y lo completás. El cliente recibe los m³ del camión; la
  planta carga y la materia prima baja por lo que falta, más el cemento."
- Botones de m³ más grandes que el camión: deshabilitados. "Otro" para más de 3.
- Cartel (`textoReplanteo`), se recalcula al cambiar "m³ en este camión":
  - **sin puesto de carga**, con cemento: "Se van a descontar **7 m³** de materia prima **+ 50 kg de cemento** cuando
    se despache. Remito y OF: **8 m³**."; sin cemento: lo mismo sin "+ 50 kg de cemento";
  - **con puesto de carga** (`modoPlanta`): "La planta carga **7 m³** (receta 4) **+ 50 kg de cemento a mano**. Remito
    y OF: **8 m³**.";
  - volvió entero: "No se carga hormigón nuevo: solo **50 kg de cemento** a mano. Remito y OF: **8 m³**." (con puesto:
    "… No va orden a la planta.").
- Aviso de cemento alto (ámbar, no frena): "Es mucho cemento para 1 m³. Revisá el número."
- Sin cemento en la fórmula ni en la planta: "La fórmula no tiene cemento."
- Sin despacho anterior: "No encontramos el viaje anterior de este camión."
- "Sacar replanteo": cierra el panel y borra los datos.

**Errores** (`validarEntrega`, arriba del botón):
- "Elegí con cuántos m³ volvió el camión."
- "El retorno va de a 0,5 m³."
- "No puede volver más de lo que lleva el camión (8 m³)."
- "Poné los kg de cemento (o 0)."
- "Más de 1.000 kg de cemento: revisá el número."

**Toasts:**
- Despacho: la descripción suma " · replanteo: se descontaron 7 m³ + 50 kg de cemento".
- Cola de carga (el toast de hoy): "Orden en la cola de carga · 7 m³ + 50 kg de cemento a mano". Volvió entero: "No va
  orden a la planta: volvió entero. Agregá el cemento a mano."
- Se mandó replanteo y la respuesta no trae `m3_cargados` (función vieja): toast rojo "El despacho se grabó sin el
  replanteo (descontó 8 m³). Avisale a Bautista."

**Tabla de entregas del día** (`tabla-entregas.tsx`): al lado de los m³, en chico, "volvió 1". Título: "Replanteo: se
cargaron 7 m³ + 50 kg de cemento". (Llega con el `*` de `despacho-tablero`.)

## 5. Carga de planta

### 5.1 La orden (`/api/carga/enviar`)
- Lee del despacho también `retorno_m3` y `cemento_extra_kg`.
- `m3 = m3ACargar(quantity_m3, retorno_m3)` (7); `ciclos` y `m3_ciclo` sobre 7 (con 1,5 por ciclo: 5 ciclos de 1,4).
- La fila de `cargas` suma `retorno_m3` y `cemento_extra_kg` (copia: es lo que se le pidió a la planta).
- **Volvió entero** (m³ a cargar = 0): no se crea orden; responde `{enviada: false, motivo: "Volvió entero: no hay
  nada que cargar en la planta."}`.
- A Indumix se escribe lo de siempre (`OrdenPlanta`: receta, **7 m³**, cliente, camión, Observación = remito). El
  remito sigue siendo el de 8.
- Control de receta (`controlDeFormula`): igual (es por m³, no depende de cuántos).
- Para poder probarlo, la fila de la orden se arma en una función pura nueva `filaOrdenCarga(desp, puesto, ctl, usuario)`
  en `lib/carga/datos.ts` (la ruta solo la usa).
- "Completar con otra carga" (parada): la carga nueva va con `cemento_extra_kg = 0` y `retorno_m3` nulo (el cemento va
  una sola vez, con la primera).

### 5.2 Pantalla de Carga (`pantalla-carga.tsx`)
- **Tarjeta de la cola:** "7 m³ · 5 ciclos" como hoy y, con replanteo, un chip ámbar **"+ 50 kg cemento a mano"** y en
  gris "volvió 1 · remito 8 m³".
- **Confirmación "Cargar…"** (el resumen de hoy): "… · **7 m³** (volvió 1, remito 8) · **+ 50 kg de cemento a mano** ·
  Remito R 1234".
- **Carga en curso:** franja ámbar arriba de los pesos: **"Agregar 50 kg de cemento a mano"** con el botón **"Listo,
  agregado"**. Al tocarlo: "Cemento agregado: 50 kg ✓" (con quién y a qué hora). Se puede tocar también después de
  terminar, mientras el camión está en planta.
  - "Listo, agregado" abre "¿Cuántos kg?" con 50 puesto (se puede cambiar, 0 a 1.000). Graba el evento
    `cemento_extra` en `cargas_eventos` y `cargas.cemento_extra_hecho = {kg, por, at}`.
  - Si se termina la carga sin tocarlo, en el cierre (junto a "¿Se sacó muestra?") aparece "¿Agregaste los 50 kg de
    cemento?" **[Sí]** **[Otra cantidad]** **[No]**.
- Estos kilos confirmados **no tocan el stock** (el stock ya bajó al despachar). Si difieren de lo pedido, la auditoría
  lo marca y se corrige el despacho en Historial (o lo hará el ajuste con kilos reales cuando se prenda, 8.5).
- **Simulador:** al tocar "Listo, agregado", el simulador suma esos kg al real de la salida de cemento de esa carga
  (como si el plantista lo hubiera dosificado a mano con la balanza). Nunca mueve stock (carga simulada).

### 5.3 Parada (`efectoSobreDespacho`, `lib/carga/cierre.ts`)
- Recibe `retorno_m3`. "Sale con lo cargado": el remito queda en **cargados + retorno** ("Se corrige el remito R 1234 a
  6 m³ (5 cargados + 1 que volvió)…"); lo que falta del pedido = m³ a cargar − cargados.
- "Completar": la carga nueva por lo que falta de los **7**; el remito no cambia.
- "Se tiró": como hoy (se anula el despacho; el hormigón que volvió también se pierde).
- Se usa igual en la ruta (`app/api/carga/[id]/route.ts`) y en la pantalla (línea ~478).

### 5.4 Auditoría de carga (`lib/carga/auditoria.ts`, `auditoria-carga.tsx`)
- `DespachoAuditoria` suma `retorno_m3` y `cemento_extra_kg` (de `dispatches`).
- **"Dif. volumen"** compara los m³ de las cargas contra **m³ a cargar** (`m3 − retorno_m3`), no contra los 8. 7 contra
  7: sin bandera.
- **"Sin carga"** no se marca si los m³ a cargar son 0 (volvió entero).
- **Cemento:** en la salida de cemento del material del replanteo (o la primera `cemento_*` con material), lo esperado
  es `teorico_corregido + cemento_extra_kg`. `desvio()` recibe ese extra: 7 m³ + 50 kg pesados contra 7 m³ + 50 kg →
  sin desviación. Si el cemento se agregó y no figura en el reporte de Indumix (ver 14.6), la desviación sale y avisa.
- Bandera nueva **"Replanteo"** (gris, informativa) en las filas con retorno, con título "Volvió 1 m³ · + 50 kg de
  cemento · confirmado 50 kg" (o "sin confirmar").
- Bandera nueva **"Cemento extra"** (ámbar) si lo confirmado en la Carga es distinto de lo pedido o quedó "No".
- Columnas: "m³ remito" sigue en 8; la de la carga dice "7 (volvió 1)". Excel: suma "Volvió (m³)", "Cemento extra
  pedido (kg)", "Cemento extra confirmado (kg)".
- El resumen de teóricos (línea ~132) suma el cemento extra al cemento.
- La misma armada de filas que usa la pantalla de Carga (línea ~773) pasa los dos datos nuevos.

### 5.5 Sin carga de planta (hoy)
Puesto apagado o sin puesto: `mandaOrdenes` da false, la Entrega no llama a `/api/carga/enviar` y todo es solo stock
(secciones 6 y 7). Nada de la sección 5 se ve. Al prender el puesto, la sección 5 anda sin cambiar nada más.

## 6. Base de datos

Migración nueva `supabase/migrations/202611181700_replanteo_retorno.sql`, **sin aplicar**. Una transacción,
`lock_timeout` 3 s, fuera de horario, probada antes en `BEGIN … ROLLBACK`. **Va antes de publicar el código.**

| Cambio | Detalle |
|---|---|
| `dispatches.retorno_m3` | `numeric(10,3)` nulo. Nulo = sin replanteo |
| `dispatches.cemento_extra_kg` | `numeric(10,3)` nulo |
| `dispatches.retorno_de_dispatch_id` | `uuid` nulo, `REFERENCES dispatches(id) ON DELETE SET NULL` + índice parcial `WHERE retorno_de_dispatch_id IS NOT NULL` |
| CHECK `dispatches_retorno_ck` | `retorno_m3 IS NULL OR (retorno_m3 > 0 AND retorno_m3 <= quantity_m3)` |
| CHECK `dispatches_cemento_extra_ck` | `cemento_extra_kg IS NULL OR (cemento_extra_kg >= 0 AND cemento_extra_kg <= 1000 AND retorno_m3 IS NOT NULL)` |
| `dispatch_materials.es_replanteo` | `boolean NOT NULL DEFAULT false`. Marca la fila del cemento agregado |
| `cargas.retorno_m3`, `cargas.cemento_extra_kg` | `numeric` nulos (`ALTER TABLE IF EXISTS … ADD COLUMN IF NOT EXISTS`). Lo que se le pidió a la planta |
| `cargas.cemento_extra_hecho` | `jsonb` nulo: `{kg, por, at}` (lo que confirmó el plantista) |
| CHECK `cargas_cemento_extra_ck` | `cemento_extra_kg IS NULL OR cemento_extra_kg BETWEEN 0 AND 1000` |
| `_cemento_replanteo(p_formula_id, p_plant_id) RETURNS materials` | Regla 3.2. `STABLE`, solo `service_role` |
| `cemento_para_replanteo(p_formula_id, p_plant_id) RETURNS jsonb` | `{id, nombre}` o `{error}`. Lectura; `GRANT` a anon/authenticated/service_role |
| `registrar_despacho` | `CREATE OR REPLACE` sobre la de fase 3, con 6.1 |
| `editar_despacho` | `CREATE OR REPLACE` sobre la de fase 3, con 6.2 |
| `ajustar_stock_carga` | **Sin cambios** (ver 8.5) |
| `NOTIFY pgrst, 'reload schema'` | Al final |

**Antes de aplicar:** comparar `registrar_despacho` y `editar_despacho` de producción con las de
`202610201200_fase3_despacho.sql` (`scripts/volcar-esquema.mjs` a otro archivo). Si producción tiene algo que el repo
no, el obrero lo suma primero.

**Qué pasa con los datos ya cargados:**
- `dispatches`: todos con las tres columnas nulas = sin replanteo. Los CHECK pasan (todo nulo).
- `dispatch_materials`: todas las filas `es_replanteo = false` (default, no reescribe la tabla).
- `cargas`: columnas nuevas nulas; las cargas simuladas de prueba que haya quedan igual.
- Stock, `stock_movements`, pedidos, viajes, probetas, Zomatik: **no cambian**. No hay recálculo.
- Los replanteos hechos antes a mano descontaron 8 m³. Si Bautista quiere corregir alguno, se edita en Historial: el
  stock se corrige por diferencia, salvo materiales con un recuento posterior (ancla).
- Planta: despachos, materiales y cargas van por `plant_id` (uuid); no hay columna `plant` / `planta` de texto en estas
  tablas. El cemento se busca en la planta del despacho.

### 6.1 `registrar_despacho` (diff)
- Entrada opcional: `retorno_m3`, `cemento_extra_kg`, `retorno_de_dispatch_id`. Sin `retorno_m3` (o 0): como hoy.
- Con retorno: frena en despacho por árido o de prueba ("El replanteo es solo para despachos con remito.") y con las
  reglas de 3.3 (mismos textos que la pantalla). `retorno_de_dispatch_id` inexistente o igual al nuevo: se ignora.
- `v_cargados := v_m3 − v_retorno`. "Supera el restante" sigue con `v_m3`.
- Fórmula: `_consumo_formula(..., v_cargados)` solo si `v_cargados > 0`. Nota del movimiento: `'Despacho remito N ·
  replanteo: 7 de 8 m³'`.
- Fibra: sin cambios (`× v_m3`).
- Cemento (si > 0): `_cemento_replanteo`; fila `es_replanteo = true` (`quantity = dry = wet = kg`, humedad 0); a
  `v_mover` si descuenta; movimiento `'consumo'` con nota `'Replanteo: cemento agregado (volvió 1 m³) — remito N'`.
- Un solo `_mover_stock` al final. Nada en `stock_entries` (el trigger de ingresos no se entera).
- Actividad: `'Replanteo'` = "Volvió 1 m³ · se cargaron 7 m³ · +50 kg de CPC 40" y `'Volvió de'` = "Remito R 1234 ·
  La Tercera".
- Respuesta: suma `retorno_m3`, `m3_cargados`, `cemento_extra_kg` (siempre).

### 6.2 `editar_despacho` (diff)
- Entrada nueva: `retorno_m3`, `cemento_extra_kg`, `retorno_de_dispatch_id` (clave ausente = queda; nulo o 0 = sin
  replanteo). Validaciones de 3.3 contra los m³ nuevos.
- `carg_viejo = m3_viejo − ret_viejo`, `carg_nuevo = m3_nuevo − ret_nuevo`. `v_recalc` = lo de hoy **o** cambió el
  retorno **o** el cemento.
- **Escala** (misma fórmula y planta, `carg_viejo > 0` y `carg_nuevo > 0`): filas de fórmula (no fibra, no
  `es_replanteo`, sin superfluidificante) × `carg_nuevo / carg_viejo`; fibra × `m3_nuevo / m3_viejo`; lo que no está en
  la fórmula se quita (como hoy); la fila `es_replanteo` se borra (neto −viejo) y se inserta la nueva si hay (+nuevo).
  Sin retorno, los dos ratios son el de hoy.
- **Recálculo** (cambia fórmula o planta, o algún cargado es 0): como hoy con `_consumo_formula(..., carg_nuevo)` (si
  > 0), fibra = kg/m³ de antes × `m3_nuevo`, y la fila `es_replanteo` nueva si hay.
- Stock con `_aplicar_neto` (ancla). `_ajustar_pedido` solo con la diferencia de `quantity_m3`.
- `UPDATE dispatches` suma las tres columnas. `cargas` no se toca.
- Actividad `'Replanteo'`: "sin replanteo → volvió 1 m³ + 50 kg", "volvió 1 m³ + 50 kg → sin replanteo" o "volvió
  1 → 1,5 m³ · cemento 50 → 80 kg".
- Editar solo el replanteo no cambia `quantity_m3`: Z1 no avisa "despacho editado".

## 7. Cálculo del stock (ejemplo)

Fórmula **de ejemplo** (números ilustrativos), Arena Fina con 5 % de humedad: CPC 40 320 kg/m³, Arena Fina 750 (seco),
Piedra 6/20 1.050, Agua 180 (no descuenta), Aditivo 2,5.

**Camión de 8 m³, volvió 1 m³, 50 kg de cemento** (fibra 0,5 kg/m³):

| Material | Sin replanteo (8 m³) | Con replanteo (7 m³ + 50 kg) | Diferencia |
|---|---|---|---|
| CPC 40 | 2.560 | 2.240 (fórmula) + 50 (fila replanteo) = **2.290** | −270 |
| Arena Fina (húmeda) | 6.300 | **5.512,5** | −787,5 |
| Piedra 6/20 | 8.400 | **7.350** | −1.050 |
| Agua (no mueve stock) | 1.440 | 1.260 | −180 |
| Aditivo | 20 | **17,5** | −2,5 |
| Fibra | 4 | **4** (sobre 8 m³) | 0 |

Remito, OF, NP, pedido y viaje: **8 m³**. Orden a la planta: **7 m³** (receta) **+ 50 kg** de cemento a mano.

**Ediciones en Historial** (sobre el despacho de arriba):

| Edición | CPC 40 | Arena Fina | Piedra | Aditivo | Fibra |
|---|---|---|---|---|---|
| m³ 8 → 9, retorno 1, 50 kg (cargados 7 → 8) | 2.610 (**+320**) | 6.300 (**+787,5**) | 8.400 (**+1.050**) | 20 (**+2,5**) | 4,5 (**+0,5**) |
| Cemento 50 → 80 kg | 2.320 (**+30**) | igual | igual | igual | igual |
| Retorno 1 → 2 (cargados 7 → 6), 50 kg | 1.970 (**−320**) | 4.725 (**−787,5**) | 6.300 (**−1.050**) | 15 (**−2,5**) | igual |
| Sacar replanteo (8 m³ de fórmula) | 2.560 (**+270**) | 6.300 (**+787,5**) | 8.400 (**+1.050**) | 20 (**+2,5**) | igual |
| Anular | devuelve 2.290 | devuelve 5.512,5 | devuelve 7.350 | devuelve 17,5 | devuelve 4 |

Volvió entero (8 de 8, 50 kg): fórmula 0, CPC 40 = **50**, fibra 4. Sin orden a la planta.

El total de la planta queda bien: el despacho anterior ya descontó su hormigón entero; el que volvió se reusa y este
descuenta solo lo nuevo.

## 8. Cómo queda en cada lado

### 8.1 Historial (`dispatch-history.tsx`)
- **Fila:** "volvió 1" al lado de los m³. Título: "Replanteo: se cargaron 7 m³ + 50 kg de cemento".
- **Editar despacho:** bloque "Replanteo": "Volvió con (m³)" (vacío = sin replanteo) y "Cemento agregado (kg)", con la
  línea "Descuenta 7 m³ + 50 kg de cemento". Se mandan siempre a `editar_despacho`; motivo obligatorio como hoy. Mismas
  validaciones de `lib/despacho.ts`.
- **Fibra desde Historial:** sin cambios. **Excel:** al final, "Volvió (m³)" y "Cemento replanteo (kg)".

### 8.2 Informes: qué m³ ve cada uno

| Informe / pantalla | Usa | Con replanteo |
|---|---|---|
| Remito PDF, OF y remito de Zomatik, NP, ajuste al finalizar | `quantity_m3` | **8** (sin cambios) |
| Pedido, viajes, contadores, Dashboard, producción, calidad semanal, muestreo | `quantity_m3` | **8** (sin cambios) |
| Orden de carga, pantalla de Carga, "m³ carga" de la auditoría | `cargas.m3` | **7** (sección 5) |
| "m³ remito" de la auditoría | `quantity_m3` | **8**, sin "Dif. volumen" (compara con 7) |
| Stock, movimientos, alertas y días de stock | `dispatch_materials` / `stock_movements` | **7 + cemento**, solo |
| Control de stock con Zomatik (pantalla y mail semanal) | `stock_movements` | **7 + cemento**, solo. Ver 10.3 |
| Control de ingresos de MP (mail diario) | `stock_entries` | No le afecta |
| Detalle del material (`material-detail-dialog.tsx`) | m³ del despacho | "8 · volvió 1"; la fila del cemento con "(replanteo)" |
| Calidad, relación a/c efectiva (`quality-analysis-dashboard.tsx`) | `dispatch_materials` | **"—"** con "Con hormigón que volvió: no se calcula". Resto igual |

### 8.3 Actividad
- Despacho: `'Replanteo'` y `'Volvió de'` (6.1); edición: antes → después (6.2).
- Carga: evento `orden_creada` suma `{m3: 7, retorno_m3: 1, cemento_extra_kg: 50}`; evento `cemento_extra` con los kg
  confirmados.

### 8.4 Zomatik
Sin cambios de código. Nota corta en `docs/migracion-loop/zomatik.md` (sección 12).

### 8.5 Ajuste con kilos reales (`ajustar_stock_carga`, apagado)
Compara lo pesado por Indumix contra **todo** `dispatch_materials` del despacho (incluye la fila de 50 kg). Si el
cemento se agrega con la balanza de la planta (recomendación 14.6), el reporte de Indumix trae 7 m³ + 50 kg y el ajuste
da 0: **no hay que cambiarlo**. Si se agregara en bolsas fuera de la balanza, habría que sacar la fila `es_replanteo`
del teórico (si no, devolvería 50 kg al stock): se decide antes de prender `usa_kilos_reales`.

## 9. Pruebas

`node --test`.

**`lib/__tests__/despacho.test.mjs`** (`npm run test:despacho`):
- `m3Cargados`: 8 − 1 = 7; 8 − 8 = 0; 7,3 − 0,5 = 6,8.
- `errorReplanteo` / `validarEntrega` con replanteo: sin retorno, 0,7, 9 con camión de 8, cemento "abc", 1.200 → los
  textos de 4; 8 de 8 con 50 → ok; apagado → no mira los campos.
- `avisoCemento`: 1 m³ con 100 → nada; 101 → aviso; 2 m³ con 150 → nada.
- `textoReplanteo`: sin puesto (con y sin cemento), con puesto ("La planta carga 7 m³ (receta 4) + 50 kg de cemento a
  mano…"), volvió entero (con y sin puesto); coma decimal (7,5).
- `armarPayloadDespacho`: apagado → **sin** las tres claves (payload igual al de hoy); prendido → `retorno_m3: 1`,
  `cemento_extra_kg: 50` (vacío → 0), `retorno_de_dispatch_id` solo si hay; `quantity_m3` sigue en 8.
- Las de siempre pasan sin tocarlas.

**`lib/__tests__/carga.test.mjs`** (`npm run test:carga`):
- `filaOrdenCarga`: 8 m³ sin retorno → `m3 8`, 6 ciclos de 1,333 (como hoy); retorno 1 + 50 kg → `m3 7`, 5 ciclos de
  1,4, `retorno_m3 1`, `cemento_extra_kg 50`; volvió entero → no hay orden (`null` con el motivo).
- `banderas`: despacho 8 con retorno 1 y carga terminada de 7 → **sin** "Dif. volumen", con "Replanteo"; la misma carga
  sin retorno en el despacho → "Dif. volumen" (como hoy); volvió entero sin carga → **sin** "Sin carga"; confirmado 30
  de 50 → "Cemento extra"; sin confirmar → sin "Cemento extra".
- `desvio` con extra: cemento teórico corregido 2.240, real 2.290, extra 50 → sin desvío; real 2.240 con extra 50 → con
  desvío; sin extra, igual que hoy.
- `efectoSobreDespacho` con retorno 1: carga de 7 parada a los 5, "sale" → remito 6 y falta 2; "completar" → carga
  nueva de 2; sin retorno → lo de hoy.
- Simulador: orden de 7 m³; "Listo, agregado" con 50 → el reporte trae el real de cemento = lo de 7 m³ + 50; la
  auditoría de esa carga no marca desviación.
- `ajustesStock` (pura, la misma cuenta que la SQL): teórico del despacho con la fila de 50 y real de Indumix con 50 →
  ajuste 0 en el cemento.
- `pasosArranque` con la orden de 7 sigue escribiendo "7 m³" (nada del cemento va a Indumix).

**Base** (no hay `node --test` para SQL): bloque `BEGIN … ROLLBACK` comentado al final de la migración, que Bautista
corre antes de aplicarla, con un pedido y una fórmula reales de Canning:
1. `registrar_despacho` 8 m³, retorno 1, 50 kg → `m3_cargados = 7`; fórmula × 7 + fila `es_replanteo` de 50; el
   cemento bajó fórmula × 7 + 50; `dispatched_m3` +8.
2. `editar_despacho` m³ 9 → +1 m³ de fórmula; fibra × 9/8; cemento extra igual.
3. `editar_despacho` `retorno_m3: null` → fórmula × 9, sin fila `es_replanteo`.
4. `anular_despacho` → el stock vuelve al de antes de 1.
5. Sin las claves nuevas → `dispatch_materials` idéntico a hoy.
6. Retorno 0,7, retorno 9 con 8, cemento sin retorno, despacho de prueba con retorno → frenan.

Además: `tsc` sin errores nuevos sobre los archivos tocados; `next build --webpack`.

## 10. Casos borde

| Caso | Qué pasa |
|---|---|
| 10.1 Volvió entero | Se permite. Fórmula 0, solo cemento (y fibra si tiene). Sin orden a la planta; la auditoría no marca "Sin carga" |
| 10.2 Volvió hormigón de otra fórmula | Se permite. MP = fórmula de **este** despacho × m³ a cargar + cemento. a/c "—" |
| 10.3 Stock de MP en Zomatik | La OF de 8 puede consumir en Zomatik la composición por 8; nosotros 7 + cemento. En el ejemplo: −270 kg de cemento y −1,8 t de áridos por camión. Decisión 14.7 |
| 10.4 Fórmula sin cemento y cemento > 0 | El único cemento de la planta; si no hay uno solo, frena |
| 10.5 Fórmula de la otra planta | `_material_en_planta`, como hoy |
| 10.6 Retorno sin cemento | Descuenta 7; la orden va sin el chip de cemento |
| 10.7 Editar m³ por debajo del retorno | Frena: "No puede volver más de lo que lleva el camión (6 m³)." |
| 10.8 Cambiar la fórmula con replanteo | Recálculo con m³ a cargar; el cemento se busca en la fórmula nueva |
| 10.9 Recuento posterior | Editar no mueve los materiales anclados (como cualquier edición) |
| 10.10 Anular | Devuelve todo, también el cemento. Quien apuntaba a este como origen queda nulo |
| 10.11 Prueba / por árido | Sin replanteo |
| 10.12 Pantalla vieja / despacho manual | No mandan los campos: como hoy |
| 10.13 Código sin la migración | La sonda no ve la columna: sin botón. Si igual llega a la función vieja, toast rojo |
| 10.14 Camión cambiado con el panel abierto | Se vuelve a buscar el despacho del que volvió |
| 10.15 m³ no múltiplo de 0,5 (7,3) | Se permite: a cargar 6,8 |
| 10.16 Carga parada con replanteo | 5.3: el remito queda en cargados + retorno |
| 10.17 Completar con otra carga | La segunda sin cemento (va una vez) |
| 10.18 Carga hecha desde Indumix, unida al despacho por el emparejador | La auditoría compara contra los m³ a cargar del despacho; la orden no tenía la indicación del cemento: "sin confirmar" |
| 10.19 Editar el replanteo con la orden ya en la cola | La orden no cambia sola (pasa lo mismo hoy al editar m³). Historial avisa: "Ese despacho tiene una orden en la cola de carga con 7 m³: cancelala en Carga si cambió lo que hay que cargar." |
| 10.20 Plantista confirma otra cantidad de cemento | No mueve stock; bandera "Cemento extra" y se corrige en Historial si hace falta |
| 10.21 Carga simulada | Nunca mueve stock ni toca el despacho (regla de siempre); el simulador suma el cemento al real solo para la auditoría |
| 10.22 Modo duro de NP | Sin cambios |

## 11. Criterios de aceptación

En el preview, con un pedido de prueba de OBRA PROPIA REBUCRET en Canning (fórmula con CPC 40), migración aplicada.

**Sin carga de planta (puesto apagado, como hoy):**
1. La Entrega muestra "Replanteo". Tocar 1 y poner 50 → "Se van a descontar 7 m³ de materia prima + 50 kg de cemento
   cuando se despache. Remito y OF: 8 m³." y "Se descuenta de CPC 40." El botón dice "Replanteo · volvió 1 m³".
2. Despachar: remito y toast con **8 m³**; el pedido suma 8.
3. Materias Primas: CPC 40 bajó fórmula × 7 + 50; arena, piedra y aditivo, fórmula × 7. Detalle del material: "8 · volvió
   1" y la fila "(replanteo)".
4. Actividad: "Replanteo: Volvió 1 m³ · se cargaron 7 m³ · +50 kg de CPC 40" y "Volvió de: Remito …".
5. Historial: "volvió 1". Editar a 9 → +1 m³ de fórmula y fibra × 9/8; sacar el replanteo → fórmula × m³ completos sin
   los 50 kg; Actividad con antes → después. Anular → el stock vuelve al de antes.
6. Zomatik: OF y remito de ese despacho por **8 m³**.
7. Sin tocar Replanteo: `dispatch_materials`, stock, Actividad y payload **idénticos** a hoy.
8. Retorno mayor que el camión, 0,7 o cemento 1.200: frena con su texto. Cemento 150 con 1 m³: aviso, despacha igual.
9. Calidad: esa muestra con a/c "—".

**Con carga de planta (prender "Canning · simulador" en etapa orden en el preview, solo para probar):**
10. La Entrega dice "La planta carga 7 m³ (receta N) + 50 kg de cemento a mano." Después de despachar, toast "Orden en
    la cola de carga · 7 m³ + 50 kg de cemento a mano".
11. En Carga, la tarjeta de la cola dice "7 m³ · 5 ciclos", con el chip "+ 50 kg cemento a mano" y "volvió 1 · remito
    8 m³". La confirmación dice "7 m³ (volvió 1, remito 8) · + 50 kg de cemento a mano".
12. El simulador escribe **7 m³** en Indumix. Durante la carga, la franja "Agregar 50 kg de cemento a mano"; "Listo,
    agregado" con 50 → "Cemento agregado: 50 kg ✓".
13. Auditoría: la fila tiene "Replanteo" y **no** tiene "Dif. volumen" ni "Desviación" de cemento; "m³ remito" 8, carga
    "7 (volvió 1)". Confirmar 30 en vez de 50 → bandera "Cemento extra".
14. PARAR a los 5 m³ y "Sale con lo cargado" → el texto dice remito a 6 m³ (5 + 1). Carga simulada: el despacho real no
    se toca.
15. Volvió entero: no va orden a la cola y la auditoría no marca "Sin carga".
16. Ningún movimiento de stock nace de la carga simulada.

**Siempre:**
17. `npm run test:despacho` y `npm run test:carga` pasan (con los casos nuevos), y las demás pruebas también.

## 12. Archivos

| Archivo | Qué | Patrón a copiar |
|---|---|---|
| `supabase/migrations/202611181700_replanteo_retorno.sql` (nuevo, **sin aplicar**) | Sección 6 + bloque de prueba con `ROLLBACK` comentado | `202610201200_fase3_despacho.sql` (funciones), `202611061200_zomatik_np_ajuste.sql` (encabezado, `lock_timeout`) |
| `lib/despacho.ts` | `FormEntrega` + `replanteoOn`, `retorno`, `cementoKg`, `retornoDe`; `PASOS_RETORNO`, `TOPE_CEMENTO_KG`, `AVISO_CEMENTO_KG_POR_M3`; `m3Cargados`, `errorReplanteo`, `avisoCemento`, `textoReplanteo` (con y sin puesto); `validarEntrega` y `armarPayloadDespacho` | `validarEntrega`, `avisosRemito` |
| `components/despacho/entrega-dialog.tsx` | Botón, panel, sonda, `cemento_para_replanteo`, despacho del que volvió, toasts (también el de la cola) | Bloque de Fibra, pie actual |
| `components/despacho/tabla-entregas.tsx` | "volvió 1" | — |
| `lib/carga/datos.ts` | `filaOrdenCarga` (pura) | La fila de hoy en `enviar/route.ts` |
| `app/api/carga/enviar/route.ts` | Lee el replanteo, usa `filaOrdenCarga`, volvió entero sin orden, evento con los datos nuevos | — |
| `app/api/carga/[id]/route.ts` | Acción nueva `cemento_extra` (kg 0–1.000, graba `cemento_extra_hecho` y el evento, permiso `carga.cargar`); `resolver_parada` pasa el retorno a `efectoSobreDespacho`; "completar" con cemento 0 | Acción `muestra` |
| `lib/carga/cierre.ts` | `efectoSobreDespacho` con `retorno_m3` | — |
| `lib/carga/auditoria.ts` | `DespachoAuditoria` + `retorno_m3`, `cemento_extra_kg`; `CargaAuditoria` + `cemento_extra_kg`, `cemento_extra_hecho`; `desvio` con extra; "Dif. volumen" y "Sin carga" contra m³ a cargar; banderas "Replanteo" y "Cemento extra" | `banderas` |
| `lib/carga/simulador.ts` | `cementoManual(kg)`: suma al real de la salida de cemento de la carga en curso o la última (como el agua extra después de terminar) | `extraAguaCerrar` |
| `lib/carga/puente.ts`, `lib/carga/tipos.ts` | `cementoManual` en `Puente` / `AdaptadorDosificadora` (en el real: no hace nada en la planta, solo devuelve) | `extraAgua` |
| `components/carga/pantalla-carga.tsx`, `usar-datos-carga.ts`, `usar-puente-simulado.ts` | Chip y texto en la cola, confirmación, franja "Agregar … / Listo, agregado", pregunta del cierre, parada con retorno, armado de la fila de auditoría | "¿Se sacó muestra?", extra agua |
| `components/carga/auditoria-carga.tsx` | Selects con `retorno_m3`, `cemento_extra_kg`; columna "7 (volvió 1)"; Excel; resumen de teóricos | — |
| `components/dispatch-history.tsx` | Marca, bloque Replanteo, aviso de orden en la cola (10.19), Excel | Campo "Agua extra" |
| `components/material-detail-dialog.tsx` | "8 · volvió 1" y "(replanteo)" | — |
| `components/quality-analysis-dashboard.tsx` | a/c "—" | — |
| `types/database.ts` | Columnas y funciones nuevas (a mano, forma de `generar-tipos.mjs`; Bautista lo regenera al aplicar) | — |
| `lib/__tests__/despacho.test.mjs`, `lib/__tests__/carga.test.mjs` | Sección 9 | Las pruebas de cada archivo |
| `docs/migracion-loop/zomatik.md` | Nota: "Replanteo (18/11): OF, remito y NP siguen con `quantity_m3`; el consumo de MP del sistema baja por el retorno (ver la spec, 10.3)" | — |
| `docs/migracion-loop/carga-planta.md` | Sección nueva corta: la orden por m³ a cargar, el cemento como indicación y confirmación, la auditoría (remite a esta spec) | — |

No se tocan: `anular_despacho`, `_consumo_formula`, `ajustar_material_despacho`, `ajustar_stock_carga`,
`plantista-view.tsx`, `add-dispatch-dialog.tsx`, `lib/zomatik/*`, `lib/control-stock/*`, `lib/control-ingresos/*`, el
trigger de ingresos, `puestos_carga` (sigue apagado).

**Orden para publicar:** 1) Bautista compara las funciones de producción y corre la prueba con `ROLLBACK`; 2) aplica la
migración fuera de horario (con el código de `main` no cambia nada); 3) se publica el código.

## 13. Lo que hay que mirar en la planta (antes de prender la carga, no antes de publicar esto)
1. Cómo agrega el plantista los kilos sueltos de cemento: con la balanza de Indumix (manual) o en bolsas.
2. Si es con la balanza: si ese cemento aparece en el reporte de la carga (real de la salida de cemento) o en otro lado.
3. Con eso se confirma 14.6 y si `ajustar_stock_carga` y la auditoría quedan como están.

## 14. Decisiones para Bautista (con recomendación)

1. **Dónde se guarda.** (a) Columnas en `dispatches` (+ marca en la fila del cemento y dos columnas en `cargas`); (b)
   tabla aparte. **Recomendación:** (a). Es 1 a 1 con el despacho, viaja con el `*`, se borra con el despacho.
2. **Qué cemento.** **Recomendación:** el de la fórmula (con dos, el de más kg/m³); sin cemento en la fórmula, el único
   de la planta; si no se sabe, frena. La pantalla dice de cuál.
3. **Límites.** **Recomendación:** retorno de a 0,5 hasta los m³ del camión (incluye "volvió entero"); cemento hasta
   1.000 kg; aviso arriba de 100 kg por m³ que volvió. ¿Te sirven los 100 kg/m³?
4. **De qué despacho volvió.** **Recomendación:** sí, automático (último del mismo camión en 12 h), una línea con "No es
   ese". No le pide nada al operario.
5. **Fibra.** (a) Sobre los 8 del camión, como hoy; (b) sobre los 7. **Recomendación:** (a); si el hormigón que volvió
   ya tenía fibra, el operario baja los kg/m³.
6. **Cemento en la carga de planta.** Indumix no recibe kilos sueltos: (a) la orden lleva 7 m³ y el cemento va como
   indicación en la pantalla de Carga, con "Listo, agregado"; (b) una segunda orden "solo cemento" con una receta
   especial (gasta uno de los 20 números). **Recomendación:** (a), y que el plantista lo agregue **con la balanza** de
   la planta para que quede pesado (así la auditoría y los kilos reales cierran solos). Si se agrega en bolsas, hay
   que ajustar 8.5 antes de prender los kilos reales.
7. **Stock de MP en Zomatik.** La OF va por 8, así que Zomatik puede descontar 8 m³ y nosotros 7 + cemento.
   **Recomendación:** aceptar la diferencia por ahora (chica y explicada); si molesta en el control de stock, sumar
   ahí "replanteos del período". Si los RMI los carga Juan a mano, que use el consumo del sistema.
8. **Calidad.** **Recomendación:** a/c "—" en los despachos con replanteo. Resto igual.
9. **Dónde está el botón.** **Recomendación:** solo en el Despacho nuevo, con y sin carga de planta.
10. **Permisos.** **Recomendación:** Replanteo = `despacho.cargar` (el de despachar); cambiarlo = `historial.editar`
    con motivo; "Listo, agregado" en Carga = `carga.cargar` (el de cargar).
11. **Replanteos de días pasados.** **Recomendación:** no en masa; los puntuales, desde Historial con motivo.

## Decisiones tomadas (18/11, orquestador)

Se toman las recomendaciones 1 a 11. Lo que falta confirmar con Bautista no frena la programación:
- **Umbral de aviso del cemento:** 100 kg por m³ que volvió. Queda como constante fácil de cambiar.
- **Cómo se agrega hoy el cemento en la planta** (balanza o bolsas): afecta solo la parte de carga de planta, que hoy está apagada.

La migración se escribe pero NO se aplica: Bautista la corre después de que el revisor apruebe.
