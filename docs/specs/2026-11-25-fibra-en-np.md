# La fibra del pedido en la NP de Zomatik (25/11/2026)

Rama `feat/fibra-en-np` (sale de `fix/auditoria-codigo`). Migración `supabase/migrations/202611251200_zomatik_fibra_np.sql`
**sin aplicar**. Todo lo del robot queda detrás de una llave **apagada** (`zomatik_np_config.fibra_activo`).

## 1. El pedido

Bautista, 25/11: *"En una programación que lleva fibra, la fibra tiene que estar visible todo el tiempo (hoy está en
'Más datos'), y el robot tiene que traer el precio de ese artículo de Zomatik y agregarlo a la NP."*

Después sumó:
- La fibra se carga en **kg por m³** (ej. 0,8). Al lado, siempre, la cuenta en **bolsitas de 800 g**
  (0,8 kg/m³ × 8 m³ = 6,4 kg = 8 bolsitas). En la carga, el despacho y el historial tiene que decir claro cuántos kg y
  cuántas bolsitas lleva el camión.
- En producción hay pedidos con fibra absurda (el H17 de La Tercera del 24/11 con **800 kg/m³** = 6.400 kg por camión;
  el promedio de los 6 pedidos con fibra da 267). La macro fibra va de a pocos kg por m³: hay que frenarlo al cargar y
  la NP nunca puede mandar una cantidad fuera del tope.

Datos confirmados en Zomatik (25/11): el artículo es **MACRO FIBRA, código 10099016**, unidad **KG**. Está en la lista
activa nueva **10253 "LISTA NOVIEMBRE 26"** (reemplazó a la 10252) a $25.000 por kg, pero su ficha tiene
**"Exportar en Lista de Precios: No"**: hoy no sale en `exportar_lista.php` y por eso no está en la copia
(`zomatik_lista_precios`). Bautista lo va a pasar a "Sí".

## 2. Cómo funciona hoy

- **Pedido** (`scheduled_dispatches.fiber_kg_per_m3`): se carga en Programación, plegado en "Más datos". El plantista
  la propone en cada camión (`registrar_despacho` → `dispatch_materials`, material tipo `fibra`, en kg, descuenta stock)
  y se corrige desde el historial (`ajustar_material_despacho`).
- **NP nueva** (`np-robot.ts › nueva`): alta → datos del cliente → lista activa (`listado_listas.php`) → Continuar →
  *agregar artículo* (`manage_pedidos.php?…&farticulo=<código sistema>`) → el detalle tiene que traer **un** renglón,
  el del hormigón → cantidad (y el precio si hay uno puesto) → número → Grabar (`fparam` = `codigo,costo,cantidad,obs|||`
  por renglón) → verificar por número y marca.
- **NP de proyecto** (`deProyecto`): el MATERIAL del proyecto → Continuar trae **todos** los renglones del proyecto →
  se borran todos menos el del hormigón (tacho, `fborrar`) → cantidad del día (el precio lo pone el proyecto) → Grabar.
- **Edición** (el pedido cambia de m³, spec 2026-11-18) y **ajuste al finalizar** (spec 2026-11-06): el mismo robot
  `ajustarCantidadNp`; la NP tenía que tener **un solo renglón** (con dos: "revisar, no se toca").
- **OF** (Z1): un renglón, el artículo de hormigón, para darle stock en el depósito y poder remitir.
- **Remito** (Z1): "Continuar" trae los pendientes de la NP; el renglón del hormigón va con los m³ del día y **todos los
  demás en 0**.

## 3. Qué cambia

### 3.1 El pedido (Programación) — siempre, sin llave

- "Fibra (kg por m³)" pasa a la sección **Hormigón**, siempre a la vista (sale de "Más datos"). Al lado: bolsitas por m³
  y el total del pedido ("6,4 kg = 8 bolsitas (0,8 kg/m³ × 8 m³)").
- **Tope: 20 kg/m³** (`FIBRA_MAX_KG_M3`, `lib/fibra.ts`). Arriba del tope **no deja guardar**, con el motivo ("… es
  demasiado: la macro fibra va de a pocos kg por m³ (como mucho 20). Revisá el número: es por m³, no por camión ni por
  pedido."). Se eligió rechazar (no confirmar) porque no hay ningún caso real arriba de 20 y los errores eran de unidad.
- Lo mismo al despachar (plantista, Despacho › Entregar, despacho manual) y al corregir desde el historial.
- Los pedidos que ya tienen 800 kg/m³ no se tocan solos: al abrirlos y guardar, pide corregir la fibra.

### 3.2 Bolsitas — siempre, sin llave

- `BOLSITA_FIBRA_KG = 0.8` (`lib/fibra.ts`, constante).
- **Redondeo:** el número exacto con hasta 2 decimales ("8 bolsitas", "7,5 bolsitas", "1,25 bolsitas"), sin redondear
  para arriba: el plantista ve si hay que abrir una bolsita y quien programa ve si la dosificación no da bolsitas enteras.
- Dónde: Programación (al lado del campo), plantista (chip del pedido y "Lleva el camión: 6,4 kg = 8 bolsitas"),
  pantalla de carga (cola y camión elegido: "Fibra: 6,4 kg = 8 bolsitas", sale de `dispatch_materials`), Despacho
  (pedidos: kg/m³ y bolsitas por m³; viajes: kg y bolsitas del camión; Entregar: lo que lleva el camión), historial
  (diálogo de la fibra y el ícono).
- **Remito impreso (PDF): no.** Es una hoja preimpresa con posiciones fijas y la fibra no tiene lugar; el remito de
  Zomatik la lleva (3.6).

### 3.3 NP nueva — con la llave

- Con `fibra_activo` y un pedido con fibra: después de agregar el hormigón, el robot **agrega MACRO FIBRA** como lo hace
  el navegador (`farticulo=<código sistema de 10099016>`, con el renglón del hormigón en `fparam`). Paso nuevo: `fibra`.
- **Cantidad** = kg/m³ del pedido × m³ de **esa** NP (una NP adicional lleva la fibra de sus m³).
- **Precio** = el precio por kg de MACRO FIBRA en la **copia** de la lista (`zomatik_lista_precios`), de la **misma
  lista** con que sale la NP (la que el robot lee en vivo de `listado_listas.php`). Se pone en el renglón (`costo<id>` y
  `fparam`, como el precio a mano del hormigón).
- **Sin precio en la copia:** la NP queda en **error** (como el hormigón sin precio), antes de pedir el número, con:
  *"Falta el precio de MACRO FIBRA en la lista … En Zomatik, en la ficha de MACRO FIBRA, poné «Exportar en Lista de
  Precios: Sí» (y que tenga precio en la lista); después tocá «Actualizar» en el precio del pedido y «Generar NP
  ahora»."* Va el mail de error de siempre a Bautista.
- Fuera del tope (más de 20 kg/m³): error **antes de tocar Zomatik** ("La fibra del pedido (800 kg/m³) supera el tope
  de 20 kg/m³: no se manda a Zomatik…").
- MACRO FIBRA sin código de sistema en la copia de artículos: error ("Tocá «Actualizar desde Zomatik» en Vínculos").
- Si el detalle no trae exactamente los dos renglones (hormigón + fibra): error con recorte, no se graba.
- `zomatik_np.fibra_kg` guarda los kg que quedaron en la NP. Actividad de "NP generada" suma "Fibra: 16 kg de MACRO
  FIBRA (2 kg/m³) · $ 25.000/kg, de la lista".
- En Programación (solo con el permiso de precios y la llave): una línea debajo del precio por m³ con los kg, las
  bolsitas y el precio por kg de la lista; si no está, el aviso de qué hacer y el botón «Actualizar».

### 3.4 NP de proyecto — con la llave

- Va el renglón de MACRO FIBRA **del proyecto** (con su precio, que no se toca), con los kg del pedido; se sigue
  sacando el resto (como hoy).
- El proyecto **no** tiene MACRO FIBRA: error *"El proyecto no tiene MACRO FIBRA y el pedido lleva fibra. Agregala al
  proyecto en Zomatik (o sacá la fibra del pedido)…"*. No se agrega de la lista: **a confirmar** si Zomatik deja
  agregar un artículo de lista en una NP de proyecto (origen 3).
- Al proyecto le quedan menos kg que los del pedido: error con los kg (como con los m³).
- "NP con saldo" (usar una NP que ya existe): no se agrega fibra (esa NP ya está grabada). Queda para más adelante.

### 3.5 Edición (cambian los m³) y ajuste al finalizar — con la NP que tiene fibra

- Solo si la NP tiene `fibra_kg` (la grabó el sistema con fibra). El robot acepta **dos** renglones (hormigón + fibra) y
  deja la fibra **en la misma proporción** que tenía: `fibraObjetivo = fibra_kg × m³ nuevos / m³ de la NP`. Un solo
  Grabar con los dos renglones; al verificar, los dos tienen que estar en el objetivo y el total del listado tiene que
  quedar en proporción con los **subtotales** (costo × cantidad de cada renglón).
- La fibra de Zomatik no es la que cree el sistema: "revisar" sin grabar. La NP no tiene el renglón que se esperaba:
  "revisar". La fibra quedaría en 0 o fuera del tope: "revisar".
- Sin `fibra_kg` (todas las NP de antes) y la NP con dos renglones: como hoy ("La NP tiene 2 renglones: no se toca").
- **No** se edita la NP si cambia solo la fibra del pedido (sin cambiar los m³): la NP queda con la de antes y el remito
  avisa la diferencia (3.6). Queda para más adelante si hace falta.
- El ajuste al finalizar también la deja en proporción a los m³ despachados (no a la fibra real de cada camión): la
  diferencia con lo cargado de verdad la ve el remito.

### 3.6 Remito — con la llave

Sí: **el remito de Zomatik lleva la fibra realmente cargada.** Es lo que se factura, y si el renglón de fibra de la NP
fuera en 0 quedaría pendiente para siempre.

- kg del remito = por cada despacho del remito, su fibra (`dispatch_materials`, material tipo `fibra`, la que puso el
  plantista o se corrigió en el historial) en proporción a los m³ que van en ese remito (un camión partido entre dos NP).
- Va en el renglón de MACRO FIBRA de los pendientes de la NP; el hormigón como siempre y lo demás en 0.
- **La fibra nunca frena el remito del hormigón.** Si no se puede remitir toda, el remito sale igual y queda Actividad
  "Remito sin toda la fibra" + mail a Bautista con lo que falta:
  - se cargó más que lo pendiente de la NP: va lo pendiente; "faltan X kg por remitir (NP adicional a mano)";
  - la NP no tiene renglón de fibra (una NP de antes de prender la llave): va sin fibra; "remitila y facturala a mano";
  - Zomatik controla stock de la fibra y no hay: va sin fibra (**a confirmar**: MACRO FIBRA está en la línea Servicios,
    lo más probable es que no controle stock);
  - más de 20 kg por m³ cargados: va sin fibra.
- Si se cargó menos que la NP, queda fibra pendiente en la NP de Zomatik (como un pedido que no se despachó entero).

### 3.7 OF — no cambia

La fibra **no va en la OF**. La OF existe para darle stock al artículo de hormigón en el depósito (si no, Zomatik no deja
remitir) y para descontar su materia prima ("Composicion", spec 2026-11-19). La MACRO FIBRA es un artículo aparte de la
línea Servicios que se vende por kg: no se fabrica, y Zomatik no lleva la fibra en los depósitos 113/116 (spec
2026-11-20). Si un día MACRO FIBRA controlara stock en el depósito, habría que ver cómo se le da stock (**a confirmar**).

## 4. La llave

- `zomatik_np_config.fibra_activo` (por planta, **false** por defecto): requiere la de la NP (`activo`). Apagada: la NP
  sale solo con el hormigón, como hoy, y el remito como hoy.
- `zomatik_np_config.fibra_articulo` (por defecto **10099016**): el código visible del artículo. Si un día es otro, se
  cambia acá, sin tocar el código.
- Sin la migración aplicada todo funciona como hoy (la llave se lee apagada).
- Prender (cuando Juan haya hecho lo de la sección 7 y se pruebe con un pedido real):

```sql
UPDATE zomatik_np_config SET fibra_activo = true, fibra_desde = now() WHERE plant_id = '<id de Canning>';
```

## 5. Base de datos (migración `202611251200_zomatik_fibra_np.sql`, sin aplicar)

| Qué | Para qué | Datos de hoy |
|---|---|---|
| `zomatik_np_config.fibra_activo` boolean, false | La llave | Canning y Hudson quedan apagadas |
| `zomatik_np_config.fibra_articulo` integer, 10099016 | El artículo | 10099016 en las dos |
| `zomatik_np_config.fibra_desde` timestamptz | De registro | nulo |
| `zomatik_np.fibra_kg` numeric(12,3) (≥ 0) | kg de fibra grabados en la NP | nulo en todas: se siguen tratando como hoy |

No se toca ningún dato. Los pedidos con fibra absurda quedan como están (se corrigen al editarlos).

## 6. Para confirmar en Zomatik (con Bautista)

1. **Agregar un segundo artículo** a la NP nueva: el robot manda `farticulo` con el renglón del hormigón en `fparam`
   (como `fborrar`). Lo más probable es que `AddArticuloLista()` lo haga así; igual el robot vuelve a poner cantidad y
   costo en los dos renglones. Capturar el detalle real con MACRO FIBRA (hoy el test lo arma copiando el renglón real
   del 28/10).
2. Que el detalle de MACRO FIBRA traiga el código visible 10099016 en la 1.ª celda (así lo reconoce el robot).
3. NP de proyecto sin MACRO FIBRA: ¿Zomatik deja agregarla de la lista? (hoy: error).
4. ¿MACRO FIBRA controla stock en el remito (`novalidarstock`)? (lo más probable: no, es de Servicios).
5. Que la copia (`exportar_lista.php`) traiga MACRO FIBRA en $/kg una vez que la ficha diga "Exportar: Sí".

## 7. Qué tiene que hacer Juan en Zomatik

1. En la ficha de **MACRO FIBRA (10099016)**: "Exportar en Lista de Precios: **Sí**".
2. Que tenga precio por kg en la lista activa de NP y de NP2 (hoy LISTA NOVIEMBRE 26, 10253: $25.000/kg).
3. En los **proyectos** de obras con fibra (p. ej. PRO 31 de La Tercera, 590): que tengan el renglón de MACRO FIBRA con
   los kg y el precio.
4. Después, en Programación (precio del pedido) tocar «Actualizar» para traer la lista.

## 8. Archivos

| Archivo | Qué |
|---|---|
| `lib/fibra.ts` (nuevo) | Tope, kg, bolsitas, proporción |
| `lib/zomatik/np.ts` | Mensajes de la fibra, `subtotalRenglones` |
| `lib/zomatik/np-robot.ts` | Renglón de fibra en la NP nueva y de proyecto; ajuste con dos renglones |
| `lib/zomatik/np-servidor.ts` | Llave (`fibraDe`), `fibraParaNp`, `fibraDeLaNp`, `guardarFibraNp`, Actividad |
| `lib/zomatik/precio-servidor.ts`, `app/api/zomatik/np/precio/route.ts` | `preciosFibra`; la línea de la fibra |
| `lib/zomatik/ajuste-servidor.ts`, `lib/zomatik/edicion-servidor.ts` | La fibra al ajustar / editar |
| `lib/zomatik/z1-robot.ts`, `lib/zomatik/z1-servidor.ts` | La fibra real en el remito (`fibraDelRemito`, `fibraParaRemito`) |
| `lib/zomatik/ajuste.ts` | `totalProporcional` con subtotales |
| `components/dispatch-scheduling.tsx`, `components/zomatik/np-bloque.tsx`, `lib/zomatik/np-cliente.ts` | Campo visible, tope, bolsitas, línea de la fibra |
| `components/plantista-view.tsx`, `components/carga/*`, `components/despacho/*`, `lib/despacho.ts`, `components/dispatch-history.tsx`, `components/add-dispatch-dialog.tsx` | Tope y kg + bolsitas del camión |
| `lib/__tests__/zomatik-fibra.test.mjs` (nuevo, en `test:zomatik-np`) | Pruebas |

## 9. Cómo probarlo (preview)

1. Programación: la fibra se ve sin abrir "Más datos"; 0,8 con 8 m³ → "6,4 kg = 8 bolsitas"; 800 → no guarda.
2. Plantista / Entregar / historial: 800 no deja; 0,8 muestra kg y bolsitas del camión. Pantalla de carga: la cola
   muestra la fibra del camión.
3. Con la migración y la llave prendida en una planta de prueba: un pedido con fibra → NP con dos renglones; sin el
   precio en la copia → la NP en error con el mensaje de "Exportar en Lista de Precios".
