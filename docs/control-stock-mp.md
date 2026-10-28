# Control de stock de materia prima con Zomatik

Rama `loop/control-stock-mp` (sale de `main`, con el control de remitos ya publicado). 28/10/2026.

## Objetivo
Comparar el stock de materia prima de nuestro sistema con el de Zomatik, por planta (Canning y Hudson) y material (Arena Fina, Arena Trituración 0/6, Piedra 6/12, Piedra 6/20 y CPC 40), para ver dónde se separan. Se suma un resumen al mail de las 16:25 de Juan.

## Nuestro sistema (`lib/control-stock/calculo.ts`, solo lee)
- **Entró:** `stock_entries.quantity`, por `entry_date` (fecha de Argentina). Es la cantidad del remito, no `dry_quantity`; el trigger suma `quantity` al stock.
- **Salió:** `stock_movements` con `movement_type = 'consumo'`. El `quantity_kg` es positivo cuando consume y negativo cuando devuelve (ediciones de remito).
- **Recuentos y ajustes:** `stock_movements` de tipo `ajuste` (recuentos y correcciones) y `transferencia`, con su signo.
- **Stock de un día:** `materials.current_stock` menos todo lo que pasó después de ese día. El inicio es el día anterior al período; el final, el último día.
- **Ajuste sin registro:** se arma el libro desde el último recuento. Arranca en el "Nuevo: Y kg" del recuento y suma lo que se cargó después (por `created_at`). Lo que separa ese libro de `current_stock` es un ajuste sin registro: alguien tocó el stock o un ingreso a mano. Se muestra aparte.
- Los movimientos de tipo `ingreso` (10 de enero a abril) no se cuentan, porque los ingresos salen de `stock_entries`.

## Zomatik (`reporte_movimientosdestock.php`, INVENTARIO › MOVIMIENTOS STOCK)
- Es solo lectura: entra en la lista cerrada de `lib/zomatik/web.ts`.
- Se lee en el mismo cron de las 16:25, en este orden: remitos, **mail** (con la última lectura de stock guardada) y recién después la lectura de stock nueva, que queda para el mail del día siguiente y para la pantalla. Así el mail de remitos nunca se pierde. La lectura de stock arranca solo si pasaron menos de 190 s y termina a los 255 s (`maxDuration` 300).
- Tiene su botón "Actualizar ahora", como mucho uno cada 2 min y nunca entre las 16:15 y las 16:45 ("se actualiza solo a las 16:25").
- Protecciones: el mismo turno del robot y la sucursal 18 confirmada en la página antes y después de cada export (`fetchMatrizEnSucursal`).
- **Qué se lee:** por depósito (116 Canning, 113 Hudson) y artículo, con `bus_linea` 131 (MP Áridos) o 130 (MP Cemento). El período va desde el inicio de la ventana del control (01/08, o los últimos 90 días) hasta hoy. Las cantidades están en toneladas.
- **El artículo (`idarticulo`):**
  - Se prueba primero el que anduvo la última vez, después el "Codigo Sistema" de `listado_articulos.php` (como `farticulo` en la NP) y por último el código visible (10000004, 10000001, 10000612, 10000005 y 10000026).
  - Un intento vale si los saldos cierran, si no trae remitos de compra (RMP) de otro artículo o depósito y si trae los RMP propios que tiene la copia de ESTAD R.COMPRA. Si no hubo compras en el período, queda "sin verificar".
  - Se guarda el que anduvo.
- **Saldos:** en el ejemplo real (Canning, cemento, del 20 al 27/10), el "Total acumulado" (68,727) es igual a 102,847 − 34,120. Es decir, es el **saldo anterior** al primer movimiento, no el final. Por eso:
  - el stock inicial es el primer saldo menos su movimiento;
  - el stock final es el **último Saldo**;
  - cada lectura comprueba que el total coincide con el inicial (`total_es_inicial`). Si no coincide, la pantalla lo avisa.
- **Lectura cortada:** también se comprueba que cada saldo sea el anterior más su movimiento. Si no cierra, el reporte vino cortado o mezcla artículos, y no se guarda. Además es **sospechosa** si:
  - tiene 300 renglones o más;
  - la página trae un link "Siguiente" o `pagina=`;
  - Zomatik no tiene movimientos en los últimos 10 días y nosotros tenemos consumos después.

  Si es sospechosa, se parte el período en dos. Si alguna mitad sigue sospechosa, no se guarda y la pantalla muestra el aviso.
- **Entró y salió:** por el signo del movimiento. El detalle muestra el prefijo del comprobante: RMP es compra, RMI es consumo, y puede haber otros.

## Tablas (migración `supabase/migrations/202610281800_control_stock_mp.sql`, sin aplicar)
- `zomatik_stock_movimientos`: la copia del reporte (fecha, comprobante, prefijo, movimiento y saldo).
- `zomatik_stock_lecturas`: por depósito y artículo, el período leído, el saldo inicial y el final, el total acumulado, si cierra, el `idarticulo`, si se verificó, cuándo se leyó y el error del último intento.
- `control_stock_reemplazar()`: reemplaza todo un depósito y artículo, o no reemplaza nada.
- Solo el servidor tiene acceso; anon no. No toca ninguna tabla existente.

## Pantalla
Materias Primas › **Control de stock**, al lado de "Control con Zomatik", con los mismos permisos: gerenciales o `materia_prima.editar`, controlados en `/api/control-stock`.
- Una fila por planta y material, para el período elegido (por defecto, el mes en curso).
- Nuestro sistema: inicio, entró, salió, recuentos y final.
- Zomatik: inicio, entró, salió y final.
- Diferencia en t y % del final, del neto (entró − salió), de lo que entró y de lo que salió. Va en **rojo si el final o el neto superan el 5 %** y son de al menos media tonelada. Una devolución (en un sistema resta de lo que entró y en el otro suma a lo que salió) no marca rojo si el neto coincide.
- Las filas con la lectura de Zomatik vieja (más de 30 h) van en gris, con "lectura del dd/mm".
- Al tocar una fila: el detalle por día de los dos lados, los comprobantes de Zomatik por tipo, el ajuste sin registro y cómo se leyó Zomatik.
- Es compacta: `text-xs` y sin negritas.

## Mail
Se suma al mail de las 16:25 (`lib/control-ingresos/servidor.ts`) una tabla corta del mes en curso:
- planta, material, stock final de nuestro sistema y de Zomatik, y la diferencia;
- las filas en rojo, marcadas;
- el link a la pantalla.

- Una fila en rojo dispara el mail **solo si es nueva**, es decir, si no estaba en rojo en el último mail. Así, los stocks negativos de Hudson no lo mandan todos los días.
- Si el mail sale por los remitos, la sección de stock va siempre, con todas las filas en rojo.
- Las filas con la lectura vieja van en gris y no disparan el mail.

## Criterios de aceptación
1. Canning, CPC 40, del 20 al 27/10: nuestro sistema da 106,8 t de entradas y 122,2 t de consumo (`npm run test:control-stock`, 15 pruebas, con el extracto real de Zomatik).
2. El "Total acumulado" se reconoce como saldo inicial y el final es el último Saldo.
3. Un reporte que no cierra o que trae remitos de otro artículo no se guarda.
4. Si la lectura de stock falla, el control de remitos y su mail siguen igual: el mail sale antes de leer el stock.
5. Nunca se escribe en Zomatik ni en `stock_entries`, `stock_movements` o `materials`.
6. tsc sin errores nuevos (17 de la base) y `next build --webpack` bien.

## Lo que hay que confirmar en la primera corrida
- **`idarticulo`:** si es el código del sistema o el visible. Queda guardado en `zomatik_stock_lecturas.idarticulo`.
- **Exportar:** si devuelve Excel o la página (columna `formato`).
- **"Total acumulado":** si siempre es el saldo inicial (`total_es_inicial`).
- **Cortes:** si un período de 90 días viene cortado (`cierra`).

## Preguntas abiertas (con recomendación)
1. **Ajustes sin registro (al 28/10, desde el recuento del 22/09):**
   - Canning: Piedra 6/12 +215,5 t, Piedra 6/20 +55,0 t, Arena 0/6 −35,5 t;
   - Hudson: Piedra 6/20 +21,2 t.

   Es stock que cambió sin un movimiento que lo explique. *Recomiendo* revisarlo con Bautista antes del próximo recuento.
2. **Stock negativo en Hudson:** Piedra 6/20 −60 t y Arena 0/6 −115 t. Seguramente faltan ingresos cargados o hubo despachos cruzados. El control lo va a mostrar contra Zomatik.
3. **Otros comprobantes de Zomatik** (ajustes, remito cambio, scrap): hoy cuentan en entró o salió según su signo, y se ven por prefijo en el detalle. *Recomiendo* separarlos en una columna cuando aparezcan en la primera corrida.
4. **Rojo:** más del 5 % y al menos 0,5 t (confirmado en la revisión).
5. **"Sin movimientos en 10 días":** si Juan carga los consumos (RMI) en Zomatik cada más de 10 días, esa planta y material nunca se guardaría. *Recomiendo* mirar en la primera corrida cada cuánto aparecen los RMI y ajustar los 10 días.
