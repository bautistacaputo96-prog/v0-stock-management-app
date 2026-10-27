# Control de ingresos de materia prima con Zomatik

Rama `loop/control-ingresos-mp` (sale de `loop/zomatik`). 27/10/2026.

## Objetivo
Todos los días, cruzar los remitos de ingreso de materia prima (arena, piedras, cemento, aditivos y fibra) de nuestro sistema (`stock_entries`) con los remitos de compra de Zomatik (Proveedores › ESTAD R.COMPRA, sucursal REBUCRET). Lo que no coincide le llega por mail a Juan Oreguy, y se marca como revisado en Materias Primas › Control con Zomatik. Reemplaza las planillas que Juan arma a mano.

## Datos
- **Nuestro:** `stock_entries.original_quantity` (el peso del remito, antes de la humedad), `remito`, fecha en hora de Argentina, planta del material, proveedor y transportista. Solo se lee.
  - Ojo: la pantalla dice "Cantidad (kg)", pero desde el 17/10 hay 20 ingresos cargados en toneladas (32,76 en vez de 32760). Para el cruce, menos de 200 se toma como toneladas. El stock de esos ingresos quedó mal (ver Preguntas).
- **Zomatik:** `reporte_remitoscompra.php`, que entra en la lista cerrada de `lib/zomatik/web.ts` como solo lectura. Se lee por tramos de 32 días, del más nuevo al más viejo, y en cada tramo:
  - Canning (depósito 116), Hudson (113) y todos los depósitos; lo que está solo en "todos" se cargó en otro depósito y queda sin planta;
  - antes de cada export se elige la sucursal 18, y después se confirma en la página que sigue en la 18 (zomatik.md 23.3). Si no, el tramo no se guarda;
  - si un export trae 150 renglones o más, el tramo se parte (puede venir cortado);
  - si un tramo trae menos del 70 % de lo que había, no se reemplaza;
  - se usa el mismo turno del robot (`zomatik_robot_tomar`/`soltar`) que la lectura diaria y la NP;
  - no se guardan precios.
- **Ventana:** desde el 01/08/2026 y, después, los últimos 90 días, con 5 días de margen hacia atrás para emparejar el borde.

## Reglas de emparejamiento (`lib/control-ingresos/cruce.ts`)
- **Número normalizado:** sin punto de venta ni ceros a la izquierda, por ejemplo `0002-00881597` → `881597`. `0000-00000000` y `000000` quedan como "sin número".
- **Material:** nuestros nombres y los artículos de Zomatik van a una clave común (arena fina, 0/6, 6/12, 6/20, 10/30, cemento, aditivos y fibra). Los artículos de Zomatik que no son materia prima, como el gasoil, no se controlan.
- **Proveedor:** se compara sin S.A., SRL ni palabras genéricas y tolera errores de tipeo: `Gerrico` = `GUERRICO S.A.`.

Los pasos:
1. **Mismo número:** se emparejan los renglones con el mismo número si tienen el mismo material o el mismo proveedor y están a ±30 días. En cada par se mira:
   - toneladas distintas (más de ±0,02), o dígitos invertidos (39,24 contra 39,42);
   - otro producto;
   - otra planta;
   - otra fecha, si difieren más de ±3 días.

   Si todo coincide salvo el proveedor, va a la categoría 4.
2. **Cargado dos veces:** el mismo número, del mismo lado, más veces que en el otro sistema. Dice si fue en las dos plantas o con dos transportistas.
3. **Número mal escrito:** lo que quedó suelto se empareja por:
   - el mismo material;
   - fecha ±2 días;
   - toneladas iguales (±0,02);
   - cualquier planta, aunque se prefiere la misma.

   Si los dos lados vienen sin número, misma planta y mismo proveedor, no es diferencia.
4. **Falta en el otro sistema:** lo que queda suelto, salvo lo de los últimos 2 días, que todavía se puede estar cargando. Si nuestro ingreso tiene nota, se muestra.

Cada diferencia tiene una `clave` estable: la categoría, el tipo y los renglones de cada lado.

## Tablas (migración `supabase/migrations/202610271900_control_ingresos_mp.sql`, sin aplicar)
- `zomatik_remitos_compra`: la copia de Zomatik. Se reemplaza por tramo con `control_mp_reemplazar_zomatik`, todo o nada.
- `control_mp_diferencias`: categoría, tipo, detalle, los dos lados, estado (abierta, revisada o resuelta), nota, quién y cuándo.
  - Si una diferencia revisada sigue apareciendo, queda revisada y no vuelve al mail.
  - Si el cruce ya no la encuentra porque alguien corrigió, pasa sola a resuelta.
  - Si vuelve a aparecer, se reabre.
- `control_mp_corridas`: cada corrida, con lo leído, el resumen, el error y el mail.
- `control_mp_registrar`: el freno. Corre una a la vez; a mano, cada 2 min como mínimo; el cron, una vez por hora.
- Solo las usa el servidor: anon no tiene acceso. No toca `stock_entries` ni ninguna tabla existente.

## Mail (Resend)
- **Hora:** cron de Vercel `5 19 * * *`, o sea 16:05 de Argentina. Lee Zomatik justo antes, así entra lo cargado ese día.
  - Corre entre dos pasadas del pg_cron de las NP (cada 10 min); si el robot tiene el turno, espera hasta 20 s.
  - En el plan Hobby, Vercel puede dispararlo en cualquier momento de esa hora.
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
1. Los casos de las planillas de Juan dan su categoría (`npm run test:control-ingresos`, 20 pruebas):
   - 3717 contra 163717, 0109-00065063 contra 165063, 0002-00880159 contra 3410, 318633 contra 319633, 0000-00000000 contra 318729 y Fenomix contra Cementos Avellaneda;
   - 39,42 contra 39,24, 164613 en las dos plantas, 6/12 contra 6/20 y Hudson 19/10 contra Canning 20/10;
   - "descargó lunes 26/10".
2. Con los 304 ingresos reales desde el 27/07 contra un Zomatik igual a lo nuestro, sale una sola diferencia por cada error que se le metió, y nada más.
3. Una diferencia revisada no vuelve al mail. Una corregida pasa sola a resuelta.
4. Nunca se escribe en Zomatik: la ruta nueva está en la lista cerrada como solo lectura. Tampoco se escribe en `stock_entries`.
5. tsc sin errores nuevos (17 de la base) y `next build --webpack` bien.

## Preguntas abiertas (con recomendación)
1. **Ingresos en toneladas en una unidad de kg** (20 de Fernando, desde el 17/10): el stock sumó 32,76 kg en vez de 32.760. *Recomiendo* corregirlos con un script aparte (×1000), con el OK de Bautista. Además, que la carga avise si alguien pone menos de 200 kg de un árido o cemento.
2. **Columnas del export:** se tomaron las de Concretus (`Fecha`, `N Remito`, `Proveedor`, `Articulo`, `Cantidad`). No sabemos si trae el transportista, ni en qué unidad vienen los aditivos. *Recomiendo* la primera corrida a mano con Bautista y mirar `datos` en la copia.
3. **Gracia de 2 días para "falta":** con el mail a las 16, ¿alcanza con 1 día? *Recomiendo* dejar 2 la primera semana.
4. **Fecha:** se avisa "otra fecha" recién con más de 3 días. ¿Juan quiere ver también las de 1 a 3 días? *Recomiendo* que no, porque son el día de descarga contra el día del remito.
5. **Diferencias resueltas a mano:** hoy solo se resuelven solas, cuando alguien corrige. *Recomiendo* que se quede así: "Revisado" alcanza para lo que no se va a corregir.
