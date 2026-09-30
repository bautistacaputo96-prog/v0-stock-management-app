# Fase 1 — Maestros tipo Loop

Estado: **aprobada por Bautista el 30/09/2026** (vio la maqueta).

Definiciones que cierran el diseño:
- **Chofer obligatorio al despachar**, pero solo cuando haya al menos un chofer activo cargado. Si la lista está vacía, se despacha igual y se muestra un aviso "Cargá los choferes en Camiones › Choferes". Así el día del deploy nadie queda bloqueado. Los nombres los cargan ellos desde la pantalla nueva.
- **Lista de finalidades:** la propuesta, sin cambios.
- **Condición de Bautista:** "los parámetros que ya utilizo tienen que estar". Ningún dato que se registra hoy puede desaparecer ni cambiar de lugar: ver la sección **"No se pierde nada"**, que el revisor controla uno por uno.

## No se pierde nada (condición obligatoria)

Estos campos y acciones existen hoy y tienen que seguir funcionando **igual**, con los mismos valores guardados en las mismas columnas. Las pruebas de aceptación y la revisión los chequean uno por uno.

**Despachar desde un pedido** (`plantista-view.tsx`, diálogo "Despachar camión"):
- Cantidad de este camión (m³), sugerida con el restante; camión; número de remito con aviso de repetido.
- **Agua extra en planta (L)** → `dispatches.extra_water_liters`.
- **Fibra**: switch + dosificación en kg/m³, precargada del pedido, con el total del camión calculado. Descuenta el stock de Fibra.
- **Muestra de probeta**: switch + número de muestra, con "Última muestra" a la vista, + asentamiento real. Crea las 3 probetas (1 a 7 días y 2 a 28 días).
- Después de despachar se abre "Camión despachado → Imprimir remito".
- **Humedad diaria de acopio** (solo Arena Fina) y su corrección en el descuento.

**Despacho manual** (`add-dispatch-dialog.tsx`):
- Datos principales:
  - planta, fórmula, humedad del acopio de arena, m³, remito;
  - mixer, cliente y obra (con altas rápidas);
  - **agua extra en planta**, **fibra (kg/m³)**;
  - **muestra** (número + asentamiento), fecha, observaciones.
- Modo **"Despacho por árido"** con carga manual de materias primas (material + kg).

**Pedido** (`dispatch-scheduling.tsx`):
- planta, fecha y hora de llegada, cliente y obra (con altas rápidas);
- **método de descarga obligatorio**, fórmula, cantidad total;
- **fibra (kg por m³)**, camión opcional, observaciones, programado por.

**Historial** (`dispatch-history.tsx`):
- ver remito;
- **agregar muestra** a posteriori;
- **agregar o editar fibra** y **superfluidificante**;
- editar, borrar (con devolución de stock según el motor de la 0b);
- filtros, gráfico y Excel. El Excel mantiene todas sus columnas actuales (Fibra, agua, muestra…) y **suma** Chofer y Finalidad.

**Calidad:** los despachos con muestra siguen apareciendo igual en Probetas, Rotura, Resultados, la tabla de Muestras (con agua extra y asentamiento) y el reporte semanal.

Regla para el obrero: los campos nuevos (chofer, finalidad, bomba) **se agregan** a los formularios. No se reemplaza ni se reordena lo existente, salvo ubicar el campo nuevo junto al que corresponde (el chofer al lado del camión).

Leer antes: `README.md` (principios y decisiones), `fase-0.md` (el motor de despacho de la 0b ya está en producción: todo despacho pasa por `registrar_despacho`/`editar_despacho`).

Decisiones de Bautista que condicionan esta fase (29/09):
- **Bombas: de terceros.** No son camiones propios: se modelan como empresa de bombeo asignada al pedido.
- **Choferes: rotan.** No hay chofer fijo por camión. El chofer se elige en cada despacho.

## Objetivo

Que el sistema sepa **quién manejó cada camión** y **qué bomba va a cada obra**, y que los tiempos de cada planta vivan en la base (hoy están en el navegador de cada uno). Es lo mínimo que necesitan las fases 2 (viajes) y 3 (despacho en 3 columnas).

## 1. Choferes

- **Tabla `choferes`:** `id`, `nombre` (obligatorio), `telefono`, `dni`, `activo` (por defecto true), `created_at`. Sin planta ni camión fijo, porque rotan.
- **Pantalla:** `/camiones` pasa a tener pestañas **Camiones | Choferes | Bombas**. Se respeta lo existente: misma página, mismo estilo de tarjetas.
  - Choferes permite alta, edición y baja lógica. La baja no borra: el chofer queda en los despachos viejos.
- **En el despacho** (Despacho diario, despacho manual y edición en Historial):
  - Campo **Chofer** con la lista de activos.
  - Por defecto, el chofer que hizo el último viaje de **ese camión en el día**. Como rotan, se puede cambiar.
  - Obligatorio / opcional: **lo decide Bautista** (propuesta: obligatorio).
- **Datos:** `dispatches.chofer_id` (FK a `choferes`, puede ser nulo para los despachos viejos).
  - `registrar_despacho` y `editar_despacho` aceptan `chofer_id`. Nueva migración que reemplaza las funciones sin romper las llamadas actuales: el parámetro es opcional en el jsonb.
- **Historial:** columna y filtro "Chofer", también en el Excel.
- **Despacho diario:** en "Camiones en ruta" y "Últimos despachos" se muestra el chofer.

## 2. Bombas de terceros

- **Tabla `empresas_bombeo`:** `id`, `nombre` (obligatorio), `contacto`, `telefono`, `observaciones`, `activo`. Se administra en la pestaña **Bombas** de `/camiones`.
- **En el pedido** (Programación · Semana y edición), solo cuando el método de descarga es **Bomba**:
  - **¿Quién pone la bomba?**: `Rebucret la contrata` / `La trae el cliente`.
  - **Empresa de bomba** (si la contrata Rebucret): lista de `empresas_bombeo`. Opcional al crear el pedido, para poder confirmarla el día anterior.
  - **Hora de la bomba en obra**: por defecto, la hora de llegada del primer camión.
- **Datos en `scheduled_dispatches`:** `bomba_la_pone` (`rebucret`|`cliente`, nulo si es directo), `bomba_empresa_id` (FK), `bomba_hora` (timestamptz).
- **Dónde se ve:**
  - En la tarjeta del pedido en Despacho diario: el badge BOMBA pasa a decir "BOMBA · Empresa X · 08:30" o "BOMBA (cliente)".
  - En la vista Día y en el calendario Semana.
  - Aviso en la vista Día: "pedido con bomba sin empresa asignada", para confirmarlo el día anterior.

## 3. Tiempos de cada planta, en la base

- **Columnas nuevas en `plants`:**

  | Columna | Valor por defecto |
  |---|---|
  | `t_carga_min` | 10 |
  | `t_descarga_bomba_min` | 15 (por 8 m³) |
  | `t_descarga_directa_min` | 25 (por 8 m³) |
  | `t_lavado_min` | 10 |
  | `jornada_inicio` | 07:00 |
  | `jornada_fin` | 18:00 |
  | `tolerancia_puntualidad_min` | **15** (estándar Loop; hoy el planificador usa 10) |
  | `bocas_carga` | 1 |

- **Vista Día › "Tiempos y camiones":** los tiempos se leen y se guardan en la planta elegida. Dejan de estar en `localStorage`.
  - Se muestra "Última modificación: fecha y quién" y se registra en `activity_log`.
  - Los **camiones disponibles del día** siguen en el navegador por ahora; se guardan en la Fase 2.
- `lib/planificador.ts` recibe los parámetros de la planta. Hoy son globales.
- Más adelante (Fase 6), un botón "Calcular desde el GPS" propone estos tiempos con los viajes reales.

## 4. Finalidad del pedido

- **`scheduled_dispatches.finalidad`**, texto de una lista fija: Platea / Fundación, Pilotes, Columnas, Vigas, Losa, Tabiques, Contrapiso, Pavimento / Carpeta, Otro. La lista la valida Bautista.
- En el formulario del pedido, opcional, al lado de la fórmula.
- Se ve en la tarjeta de Despacho diario, en la vista Día y en Historial (columna + Excel, tomada del pedido).

## Fuera de alcance

- Planta base del camión y camiones de terceros: los 5 son propios y compartidos.
- Documentación de choferes (licencia, vencimientos).
- Horas trabajadas por chofer (sale en la Fase 6 con el GPS).
- Remito con el nombre del chofer: se evalúa con el tema de la numeración del remito en la Fase 3.
- Importar choferes desde B-Track (Wialon tiene "conductores", pero Rebucret no los usa).

## Base de datos

- Migración `supabase/migrations/202610011000_fase1_maestros.sql`:
  - tablas `choferes` y `empresas_bombeo`;
  - columnas nuevas en `dispatches`, `scheduled_dispatches` y `plants`;
  - `registrar_despacho` y `editar_despacho` con `chofer_id`.
- Todo agregado, nada se borra. Es compatible con el front actual: se puede aplicar antes del deploy.
- Permisos como el resto de las tablas (la 0c pone la seguridad).
- Actualizar `types/database.ts` con el script de la 0d.

## Criterios de aceptación

1. Alta, edición y baja de choferes y de empresas de bomba desde `/camiones`. Las bajas no aparecen en las listas pero siguen en el historial.
2. Un despacho desde pedido y uno manual graban `chofer_id`. El chofer por defecto es el del último viaje del camión en el día. Editar en Historial permite cambiarlo.
3. Un pedido con bomba guarda quién la pone, la empresa y la hora. Se ve en Despacho diario, en la vista Día y en Semana. Un pedido directo no muestra nada de bomba.
4. Los tiempos editados en la vista Día para Canning no cambian los de Hudson, y los ve igual otra persona desde otra computadora.
5. La finalidad se elige en el pedido y aparece en Despacho diario, en la vista Día y en Historial.
6. **"No se pierde nada":** despachos de prueba (desde pedido con fibra y muestra, manual con agua extra y fibra, y por árido), corridos por el motor en `BEGIN … ROLLBACK`, graban exactamente las mismas columnas que antes de la fase más `chofer_id`. Capturas de los tres formularios antes y después para Bautista.
7. El motor de despacho sigue pasando todas las pruebas de la 0b dentro de `BEGIN … ROLLBACK`, más las nuevas de chofer.
8. Build limpio; `tsc` sin errores nuevos en los archivos tocados.
9. Deploy: primero la migración, después el front, fuera del horario de despacho.

## Hecho
_(lo completa la sesión obrero)_
