# Control de ingresos de materia prima con Zomatik

Rama `loop/control-ingresos-mp` (sale de `loop/zomatik`). 27/10/2026.

## Objetivo
Todos los días, cruzar los remitos de ingreso de materia prima (arena, piedras, cemento, aditivos y fibra) de nuestro sistema (`stock_entries`) con los remitos de compra de Zomatik (Proveedores › ESTAD R.COMPRA, sucursal REBUCRET). Lo que no coincide le llega por mail a Juan Oreguy, y se marca como revisado en Materias Primas › Control con Zomatik. Reemplaza las planillas que Juan arma a mano.

## Datos
- **Nuestro:** `stock_entries.original_quantity` (el peso del remito, antes de la humedad), `remito`, fecha en hora de Argentina, planta del material, proveedor y transportista. Solo se lee.
  - Ojo: la pantalla dice "Cantidad (kg)", pero desde el 17/10 hay 20 ingresos cargados en toneladas (32,76 en vez de 32760). Para el cruce, menos de 200 se toma como toneladas. El stock de esos ingresos quedó mal (ver Preguntas).
- **Zomatik:** `reporte_remitoscompra.php`, que entra en la lista cerrada de `lib/zomatik/web.ts` como solo lectura. Se lee por tramos de 32 días: primero los que tienen días nunca leídos y después los de lectura más vieja. En cada tramo:
  - Canning (depósito 116), Hudson (113) y todos los depósitos; lo que está solo en "todos" se cargó en otro depósito y queda sin planta;
  - se elige la sucursal 18 y se confirma en la página **antes y después** de cada export (zomatik.md 23.3). También se rechaza el tramo si Canning y Hudson vienen vacíos y "todos" trae renglones cuya columna Depósito es Canning o REBUCRET. **El nombre del artículo no sirve para esto:** REBUCRET también usa artículos "CCTS" (visto el 28/10). Ante un rechazo por sucursal, se reintenta una vez a los 15 s;
  - el export tiene que venir en Excel: la página HTML redondea las cantidades (40 en vez de 40,32);
  - cada corrida guarda en `control_mp_corridas.lectura` una muestra por tramo: columnas, depósitos, artículos con su material, series de OC y cuántas cantidades traen decimales;
  - si un export trae 150 renglones o más, el tramo se parte; las dos mitades tienen que terminar, o el tramo no cuenta;
  - si un tramo trae menos del 70 % de lo que había, no se reemplaza;
  - se usa el mismo turno del robot (`zomatik_robot_tomar`/`soltar`) que la lectura diaria y la NP; la espera del turno sale del mismo presupuesto (la lectura termina a los 220 s; `maxDuration` 300, como Concretus con este listado en Hobby);
  - cada tramo leído entero se graba junto con sus días en `zomatik_remitos_compra_dias` (fecha de lectura);
  - no se guardan precios.
- **Solo se controla lo leído:** una diferencia se informa (y se resuelve) solo si Zomatik está leído en las últimas 30 h desde 10 días antes hasta 10 días después de sus fechas. Lo que no, queda como estaba. Sin ninguna lectura reciente, no se cruza.
- **Ventana:** desde el 01/08/2026 y, después, los últimos 90 días, con 5 días de margen hacia atrás para emparejar el borde.

## Reglas de emparejamiento (`lib/control-ingresos/cruce.ts`)
- **Número normalizado:** sin el prefijo de Zomatik ("RMP "), sin punto de venta ni ceros a la izquierda, por ejemplo `RMP 0002-00881597` → `881597`. `0000-00000000` y `000000` quedan como "sin número".
- **Material:** nuestros nombres y los artículos de Zomatik van a una clave común (arena fina, 0/6, 6/12, 6/20, 10/30, cemento, aditivos y fibra). En Zomatik manda el código (10000004 CCTS ARENA ESPECIAL → Arena Fina, 10000026 CCTS CEMENTO GRANEL → CPC 40, 10000005 PIEDRA 6-20 → Piedra Partida 6/20) y si no, el nombre sin "CCTS ". Lo que no se puede llevar a un material no es diferencia: va a la lista "Artículos de Zomatik sin material" de la pantalla.
- **Proveedor:** se compara sin S.A., SRL ni palabras genéricas y tolera errores de tipeo: `Gerrico` = `GUERRICO S.A.`. Alias: Fenomix = Cementos Avellaneda (Fenomix distribuye su cemento).

Los pasos:
1. **Mismo número:** se emparejan los renglones con el mismo número si tienen el mismo material o el mismo proveedor y están a ±30 días. En cada par se mira:
   - toneladas distintas (más de ±0,02), o dígitos invertidos (39,24 contra 39,42);
   - otro producto;
   - otra planta;
   - otra fecha, si difieren más de ±10 días (en Zomatik se carga días después; corrida real del 28/10: de 4 a 9 días).

   Si todo coincide salvo el proveedor, **no es diferencia**. **Aditivos y fibra:** hasta confirmar la unidad de Zomatik no se comparan cantidades: solo número, planta y fecha.
2. **Cargado dos veces:** el mismo número, del mismo lado, más veces que en el otro sistema. Dice si fue en las dos plantas o con dos transportistas.
3. **Número mal escrito:** lo que quedó suelto se empareja por:
   - el mismo material;
   - fecha ±10 días (mejor la más cercana);
   - toneladas iguales (±0,02);
   - cualquier planta, aunque se prefiere la misma.

   Si los dos lados vienen sin número, misma planta y mismo proveedor, no es diferencia.
4. **Falta en el otro sistema:** lo que queda suelto. "Falta en Zomatik" se avisa recién a los 7 días (en Zomatik se carga con atraso); "Falta en nuestro sistema", a los 2. Si nuestro ingreso tiene nota, se muestra.

**Por ahora se controlan solo áridos y cemento:** Zomatik no trae aditivos ni fibra en los depósitos 116 y 113 (corrida del 28/10).

Cada diferencia tiene una `clave` estable: la categoría, el tipo y los renglones de cada lado.

## Tablas (migración `supabase/migrations/202610271900_control_ingresos_mp.sql`, sin aplicar)
- `zomatik_remitos_compra`: la copia de Zomatik. Se reemplaza por tramo con `control_mp_reemplazar_zomatik`, todo o nada, junto con `zomatik_remitos_compra_dias` (qué días se leyeron y cuándo).
- `control_mp_diferencias`: categoría, tipo, detalle, los dos lados, estado (abierta, revisada o resuelta), nota, quién y cuándo.
  - Si una diferencia revisada sigue apareciendo, queda revisada y no vuelve al mail.
  - Si el cruce ya no la encuentra porque alguien corrigió, pasa sola a resuelta. Lo que salió de la ventana de 90 días o no se pudo controlar ese día no se resuelve.
  - Si vuelve a aparecer, se reabre; si alguien ya la había revisado, vuelve a revisada con su nota.
- `control_mp_corridas`: cada corrida, con lo leído, el resumen, el error y el mail.
- `control_mp_registrar`: el freno. Corre una a la vez; a mano, cada 2 min como mínimo; el cron, una vez por hora. Si el cron encuentra un "Controlar ahora" en curso, espera hasta 90 s.
- Solo las usa el servidor: anon no tiene acceso. No toca `stock_entries` ni ninguna tabla existente.

## Mail (Resend)
- **Hora:** cron de Vercel `25 19 * * *`, o sea 16:25 de Argentina. Lee Zomatik justo antes, así entra lo cargado ese día.
  - Queda después de `cajas-whatsapp` de Concretus (18:50 UTC, lun a vie, 60 s, usa el mismo usuario de Zomatik) y entre dos pasadas del pg_cron de las NP (cada 10 min); si el robot tiene el turno, espera hasta 20 s.
  - En el plan Hobby, Vercel puede dispararlo hasta las 16:59. Si en ese momento Concretus cambia la sucursal, el control lo detecta y reintenta el tramo.
- **A quién:** Juan Oreguy, con copia a Bautista, por nombre en `app_users` (como `lib/carga/servidor.ts`).
- **Cuándo sale:** solo si hay diferencias abiertas, y una vez por día como mucho.
- **Contenido:** primero "Nuevas desde ayer" (las que aparecieron desde el último mail) y después "Siguen abiertas (N)". En cada parte, tablas por las 4 categorías con fecha, material, nuestro sistema y Zomatik (número, toneladas, planta y fecha), proveedor, transportista y qué pasa. Al final, el link a la pantalla.
- **Si no se pudo leer Zomatik:** se avisa arriba y se usa la última lectura guardada. Si además no hay nada abierto, el aviso va solo a Bautista.

## Pantalla
Materias Primas › pestaña **Control con Zomatik**. La ven los gerenciales o quien tenga `materia_prima.editar`, y el servidor lo vuelve a controlar en `/api/control-ingresos`. Tiene:
- filtros de planta, fechas y estado (abiertas, revisadas o resueltas);
- **Controlar ahora**, que lee y cruza sin mandar el mail;
- **Revisado**, con nota opcional, y **Reabrir**; los dos quedan en Actividad.

Es compacta: `text-xs` y sin negritas.

## Criterios de aceptación
1. Los casos de las planillas de Juan dan su categoría (`npm run test:control-ingresos`, 32 pruebas):
   - 3717 contra 163717, 0109-00065063 contra 165063, 0002-00880159 contra 3410, 318633 contra 319633 y 0000-00000000 contra 318729 (Fenomix contra Cementos Avellaneda con el mismo número ya no es diferencia);
   - 39,42 contra 39,24, 164613 en las dos plantas, 6/12 contra 6/20 y Hudson 19/10 contra Canning 20/10;
   - "descargó lunes 26/10".
2. Lo nuestro contra un Zomatik igual da 0 diferencias (prueba automática). Con los 304 ingresos reales desde el 27/07 contra ese espejo con los errores de Juan, sale una diferencia por cada error, y nada más.
3. Sin Zomatik leído en unas fechas, no sale ningún "falta" de esas fechas.
4. Una diferencia revisada no vuelve al mail. Una corregida pasa sola a resuelta.
5. Nunca se escribe en Zomatik: la ruta nueva está en la lista cerrada como solo lectura. Tampoco se escribe en `stock_entries`.
6. tsc sin errores nuevos (17 de la base) y `next build --webpack` bien.

## Preguntas abiertas (con recomendación)
1. **Ingresos en toneladas en una unidad de kg** (20 de Fernando, desde el 17/10): el stock sumó 32,76 kg en vez de 32.760. *Recomiendo* corregirlos con un script aparte (×1000), con el OK de Bautista. Además, que la carga avise si alguien pone menos de 200 kg de un árido o cemento.
2. **Columnas del export:** se tomaron las de Concretus (`Fecha`, `N Remito`, `Proveedor`, `Articulo`, `Cantidad`). No sabemos si trae el transportista, ni en qué unidad vienen los aditivos (hasta saberlo no se comparan sus cantidades). *Recomiendo* la primera corrida a mano con Bautista y mirar `datos` en la copia.
3. **Gracia de 2 días para "falta":** con el mail a las 16:25, ¿alcanza con 1 día? *Recomiendo* dejar 2 la primera semana.
4. **Fecha:** se avisa "otra fecha" recién con más de 10 días. Como en Zomatik se carga hasta 9 días después, un "falta en Zomatik" de los últimos días puede ser solo atraso. ¿Subimos la gracia de 2 días? *Recomiendo* verlo con Juan después de una semana.
5. **Diferencias resueltas a mano:** hoy solo se resuelven solas, cuando alguien corrige. *Recomiendo* que se quede así: "Revisado" alcanza para lo que no se va a corregir.
