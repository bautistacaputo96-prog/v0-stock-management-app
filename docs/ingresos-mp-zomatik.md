# Ingresos de materia prima desde Zomatik

Rama `feat/ingresos-mp-zomatik` (06/11/2026). Especificación: `docs/specs/2026-11-05-ingresos-mp-desde-zomatik.md`.
Las respuestas de Bautista del 05/11 mandan sobre la especificación (abajo, "Decisiones").

## Qué hace
Los remitos de compra de materia prima que Nicolás carga en Zomatik entran solos a `stock_entries`: arena, piedra,
cemento, **aditivos y fibra**. Lo cargado a mano que coincide pasa a ser el ingreso de Zomatik (mismo id, sus muestras
quedan). Si Zomatik corrige, anula o cambia de planta un remito, acá se corrige con asiento. La humedad y la muestra de
granulometría se cargan desde el historial.

## Cuándo lee Zomatik
| Pasada | Horario | Qué lee | Quién |
|---|---|---|---|
| Corta | :05 y :35, de 06:05 a 20:35 (no 16:05 ni 16:35) | últimos 15 días, 50 s | pg_cron `mp-ingresos-pasada` |
| Completa | 05:05 | la ventana del control | pg_cron `mp-ingresos-noche` |
| Con el control | 16:25 | la del control; importa antes de cruzar y del mail | cron Vercel de siempre |
| A mano | botón **Traer de Zomatik** (Ingresos) | corta | gerencial o `materia_prima.editar`; no de 16 a 17; origen `traer` (no figura como control) |

Mismo turno del robot y sucursal 18 confirmada (la lectura es `leerZomatikCompras` del control, con su ventana). Freno:
`control_mp_registrar` con origen `pasada` (una cada 20 min, nunca dos corridas a la vez). Nunca escribe en Zomatik.

## El interruptor (`integraciones`)
- `mp_ingresos_zomatik`: `{"modo":"sombra","desde":"2026-11-09"}` → arma el plan y no escribe nada (bloque
  "Importación" en Control con Zomatik: "Si estuviera prendida: …"). `{"modo":"real","desde":"2026-11-16"}` → importa
  desde F. Sin la fila: apagada (la pasada solo lee). Los SQL están al final de la migración.
- `mp_densidades`: `{"<material_id>": 1.2}` (kg por litro). Se carga desde Control con Zomatik › Densidades (gerencial).

## Cómo decide (lib/ingresos-zomatik/plan.ts, puro)
- **Clave** de cada remito: número completo + artículo (`2-318903|10000004`). Repetido en la misma lectura: se importa el
  primero y el otro queda pendiente "Remito repetido en Zomatik".
- **Cantidad**: áridos y cemento en t (1 a 60 t por renglón); fibra en kg; aditivos en litros o tachos de 1000 L (el
  tacho se reconoce por el artículo: "TACHO", "IBC", "1000 L"). Si el material de Rebucret está en kg, litros × densidad;
  sin densidad queda pendiente "Falta la densidad de X". Un aditivo en litros con 5 o menos queda pendiente "¿Son
  tachos? Revisar". Si cambia la densidad, los importados desde F se corrigen con la nota "Densidad de X cambiada de A a B".
- **Con un manual** (desde F − 10 días, mismo número, material y planta, ±10 días): desde F el manual pasa a ser el
  importado con la cantidad de Zomatik (asiento si difiere); antes de F se empareja sin tocarlo. Parecido pero no seguro
  (otro material o planta, o número mal escrito con las mismas toneladas): pendiente "¿Mismo camión que el ingreso
  manual del dd/mm?", que se resuelve con "Es el mismo" / "Son distintos" / "Descartar" (lo aplica la próxima pasada).
  "Es el mismo" con un manual de otra planta u otro material (desde F): se anula el manual con asiento y entra donde
  dice Zomatik, como un cambio de planta.
- **Corrección**: el ingreso toma la cantidad nueva y queda un asiento `correccion_ingreso` en `stock_movements`.
  **Anulación**: si falta en dos lecturas completas separadas 2 h, cantidad 0 + `anulado_at` (no se borra). Cambio de
  depósito: anula en la planta vieja y da de alta en la nueva.
- Todo lo aplica `mp_zomatik_aplicar` en la base (el alta es un INSERT: el stock lo suma el trigger).

## Pantallas
- **Ingresos**: cartel, **Traer de Zomatik**, filtro "Sin humedad (N)", insignias Zomatik / Falta humedad / Corregido /
  Anulado en Zomatik (tachado). Menú de la fila: Cargar (o Corregir) humedad, Muestra de granulometría. Lo de Zomatik
  solo edita notas; no se elimina ("se anula en Zomatik"). La edición a mano de un manual va con asiento. Eliminar un
  manual desde F de un material que entra desde Zomatik lo anula con asiento; uno emparejado con Zomatik no se elimina.
- **Registrar Ingreso**: con la importación prendida, quien no es gerencial no ve los materiales que entran desde Zomatik;
  el gerencial los ve con el aviso y la nota obligatoria. Se guarda `origen = 'manual'`. Si el remito (normalizado) y
  el material ya entraron desde Zomatik, no deja grabarlo ("Ese remito ya entró desde Zomatik"); si hay otro ingreso
  con el mismo remito completo y material en ±30 días, tampoco ("Ya hay un ingreso con ese remito").
- **Control con Zomatik**: bloque Importación (modo, última lectura, en sombra qué haría; prendida: No se pudo importar,
  Cambios de Zomatik, Zomatik cambió y no se pudo aplicar, Posible copia de un importado (mismo remito completo y
  material que uno de Zomatik) y Cargados a mano sin Zomatik de más de 7 días, los dos con **Eliminar**
  (gerencial, los anula con asiento), Proveedores sin
  vincular, Densidades). El cruce de siempre queda plegado en "Antes del dd/mm" (solo fechas anteriores a F).
- **Granulometría**: el ensayo se vincula por remito normalizado + material ±30 días; con más de uno, se elige.
- **Control de stock**: las correcciones de ingresos anteriores al último recuento no salen como "ajuste sin registro".

## Avisos
- Mail diario de las 16:25 (Juan, cc Bautista y Felipe): con la importación prendida, "Rebucret · Ingresos MP: 2 sin
  importar, 1 cambio" o "sin novedades hoy", con lo que no se pudo importar, cambios, cargados a mano sin Zomatik,
  densidades faltantes, artículos y proveedores sin vincular, y el cruce viejo de antes de F. Los lunes, el semanal.
- Zomatik no deja entrar: el aviso único del robot a Bautista. Ninguna pasada buena en 2 h (06–20): a Bautista, uno por día.
- **Arena Fina sin humedad a las 24 h**: mail a Felipe Calvo a la mañana (pasadas de las 8) y a la tarde (con el control
  de las 16:25), una marca por envío; cada ingreso una
  sola vez (la marca se pone cuando el mail salió), y aviso en el momento en Materias Primas para el
  encargado de la planta (`ENCARGADO_PLANTA`: Titan Concretus en Canning, David Herrera en Hudson). No hay un sistema de
  notificaciones dentro de la app.

## Base
- `supabase/migrations/202611061000_ingresos_mp_zomatik.sql` (sin aplicar): `stock_entries.origen` y `anulado_at`,
  `correccion_ingreso` en el CHECK de `stock_movements`, `zomatik_ingresos_mp`, `pasada` en las corridas y el freno,
  `mp_zomatik_aplicar`, `mp_ingreso_editar`, `mp_ingreso_anular`. Explica qué pasa con los datos y trae la vuelta atrás.
- `supabase/migrations/202611061010_ingresos_mp_zomatik_cron.sql`: los dos jobs. Va **después de publicar**.
- Sin las migraciones la app anda como antes (la carga manual, la edición y el Excel prueban sin las columnas nuevas).

## Pruebas
`npm run test:ingresos-zomatik` (23, criterios 1–16 y 19, con `lib/__fixtures__/ingresos-zomatik/lecturas.json`),
`test:control-ingresos`, `test:control-stock`.

## Decisiones
- D1–D5 de la especificación (sección 11).
- D6 (Bautista, 05/11) Sombra desde el 09/11 y F el 16/11; F vive en `integraciones`.
- D7 Aditivos y fibra también se importan (litros, tachos de 1000 L, kg); la densidad es un parámetro por material.
- D8 Desde F un manual emparejado se convierte en el importado (mismo id, cantidad de Zomatik con asiento); los manuales
  desde F sin Zomatik se eliminan con un botón (gerencial), anulándolos con asiento. Los anteriores a F no se tocan.
- D9 Sin Nicolás en copia; el mail diario sigue a Juan, cc Bautista y Felipe, con las secciones nuevas.
- D10 "Son distintos" guarda el ingreso en `rechazados` del vínculo: no se vuelve a proponer.

## A confirmar en la sombra
- Cómo viene el tacho de aditivo en el export (si es otro artículo, otra unidad o una columna). Hoy se reconoce por el nombre.
- Si la página trae un id interno del remito (podría reemplazar la clave).
- Que cada remito de la semana salga emparejado con su manual o con un motivo claro.
