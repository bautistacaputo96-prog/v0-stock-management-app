# Inventario funcional y técnico — Sistema Rebucret

Relevado el 29/09/2026 sobre el repo `/Users/bautistacaputo/Documents/v0-stock-management-app` (rama `main`, último commit `a0bc32b feat(programacion): vista Dia que ordena los camiones`, 402 commits) y sobre la base Supabase de producción (proyecto REBUCRET), consultada **solo lectura** (transacción `READ ONLY`, sin escribir nada). Producción: www.produccionrebucret.com (Vercel, deploy desde `main`).

Rutas relativas al repo salvo que se indique otra cosa.

---

## 1. Resumen

- **Qué es:** una app web Next.js 16 (App Router) + React 19 + TypeScript + Tailwind 4 + shadcn/ui, con Supabase (Postgres) como backend. Casi toda la lógica corre **en el navegador** (componentes `"use client"` que llaman a Supabase con la clave anónima). Las rutas de servidor son pocas: PDF de remito, reporte semanal de calidad, aviso de borrados, GPS y geocodificación.
- **Plantas:** Canning (`CAN`) y Hudson (`HUD`) en la tabla `plants`, ya con coordenadas. Canning concentra el grueso: 1.195 despachos / 7.608 m³ contra 122 / 877 m³ de Hudson (Hudson carga desde el 25/06/2026). Volumen reciente: ~1.450–2.070 m³/mes (sep-2026: 286 despachos, 2.068 m³).
- **Qué cubre bien:** stock de materias primas (ingresos con humedad, consumo por fórmula, recuentos, transferencias entre plantas, excedente de humedad para reclamar al proveedor), fórmulas, calidad (probetas 7/28 días, prensa calibrada, granulometría, análisis estadístico, reporte semanal por mail), remito PDF sobre plantilla fiscal, mantenimiento preventivo de la planta (OT), registro de actividad.
- **Qué cubre a medias:** el circuito comercial-operativo tipo Loop. Existe *pedido* (`scheduled_dispatches`) → *despacho por camión* (`dispatches`, 1 fila = 1 camión/remito) → *remito*. Hay una programación semanal, una vista del día con un planificador de viajes (no se guarda) y un mapa GPS en vivo (Wialon, **todavía sin token cargado**).
- **Qué no existe:** choferes de mixer, bombas como recurso, precios/listas/contratos, facturación o cierre del día, estados reales del ciclo del camión (solo `available`/`in_transit`, puestos a mano), tiempos reales (salida/llegada/descarga) persistidos, puntualidad real, app de chofer o de cliente, numeración automática de remitos, integración con el ERP (Zomatik no se usa en este repo).
- **Riesgo técnico principal:** seguridad y consistencia. RLS desactivado en 35 de 36 tablas y la clave anónima (pública en el bundle) tiene todos los permisos; login con contraseña compartida validada en el navegador; operaciones de varios pasos (despacho → descuento de stock → materiales → movimientos → probetas → pedido → camión) hechas desde el cliente **sin transacción**; lógica de despacho duplicada en dos componentes grandes que ya divergen.

---

## 2. Mapa de módulos

| # | Módulo (menú) | Ruta | Componentes principales | Tablas principales | Madurez (1–5) | Nota |
|---|---|---|---|---|---|---|
| 1 | Dashboard | `/` | `app/page.tsx`, `components/dashboard-client.tsx` (1.093 l.), `components/mantenimiento-widget.tsx` | dispatches, dispatch_materials, materials, stock_entries, test_cylinders, formulas, granulometria_tests, press_calibrations, maint_* | 3 | KPIs de m³, stock crítico, probetas del mes, consumo real vs teórico (roto para cemento) |
| 2 | Materias Primas | `/materias-primas?tab=stock\|ingresos\|humedad\|proveedores` | `app/materias-primas/page.tsx`, `stock-evolution-chart.tsx` (1.123), `add-stock-entry-dialog.tsx` (727), `stock-entries-table.tsx`, `humidity-excess-table.tsx`, `suppliers-table.tsx`, `adjust-stock-dialog.tsx`, `transfer-stock-dialog.tsx`, `material-detail-dialog.tsx`, `add-material-dialog.tsx`, `edit-material-dialog.tsx`, `add-carrier-dialog.tsx` | materials, stock_entries, stock_movements, suppliers, material_suppliers, carriers, humidity_excess_log, granulometria_tests | 4 | Núcleo histórico del sistema; trigger en `stock_entries` |
| 3 | Fórmulas | `/formulas` | `app/formulas/page.tsx`, `formulas-grouped-view.tsx`, `add/edit/view/delete-formula-dialog.tsx` | formulas, formula_materials | 3 | kg secos por m³; sin versión ni aprobación |
| 4 | Clientes | `/clientes` | `clients-management.tsx` (727), `add-client-dialog.tsx`, `add-construction-site-dialog.tsx`, `obra-ubicacion.tsx`, `mapa-base.tsx` | clients, construction_sites | 3 | Datos fiscales para remito; obras con mapa y tiempo de viaje |
| 5 | Camiones | `/camiones` | `mixers-management.tsx`, `add-mixer-dialog.tsx` | mixers | 2 | Solo patente/capacidad/estado manual; compartidos entre plantas |
| 6 | Mantenimiento | `/mantenimiento` | `mantenimiento-content.tsx`, `components/mantenimiento/{hoy,calendario,planta,historial,orden-trabajo-dialog,reportar-falla-dialog}.tsx`, `lib/mantenimiento.ts` | maint_equipment, maint_tasks, maint_task_steps/items/images, maint_work_orders, maint_work_order_photos, maint_executions; bucket `mantenimiento` | 4 | Solo la planta Indumóvil 80 de Canning; no cubre mixers |
| 7 | Logística | `/logistica` | `logistica-en-vivo.tsx`, `mapa-base.tsx`, `lib/wialon.ts`, `lib/geo.ts`, `app/api/gps/*` | integraciones, mixers.gps_unit_id, plants/construction_sites gps_* | 1–2 | Construido, pero sin token de Wialon no muestra nada |
| 8 | Despachos › Programación | `/programacion` (pestañas Semana / Día) | `programacion-tabs.tsx`, `dispatch-scheduling.tsx` (850), `programacion-dia.tsx` (358), `lib/planificador.ts` (193) | scheduled_dispatches | 3 | Calendario semanal por hora de llegada + simulador de viajes del día (no persistido) |
| 9 | Despachos › Despacho Diario | `/plantista` | `plantista-view.tsx` (1.216), `add-dispatch-dialog.tsx` (1.065) | scheduled_dispatches, dispatches, dispatch_materials, stock_movements, materials, mixers, test_cylinders, dispatch_status_log, daily_stockpile_humidity | 3 | Pantalla del plantista: "Despachar" cada camión, remito, muestra, fibra |
| 10 | Despachos › Historial | `/historial-despachos` | `dispatch-history.tsx` (1.506), `view-dispatch-dialog.tsx` | dispatches (+ joins), test_cylinders, dispatch_materials, stock_movements | 3 | Filtros tipo Excel, export XLSX, editar, agregar muestra/fibra/superfluidificante, borrar |
| 11 | Calidad | `/calidad?tab=analisis\|probetas\|rotura\|resultados\|granulometria` | `app/calidad/page.tsx`, `quality-analysis-dashboard.tsx` (1.573), `test-cylinders-table.tsx` (653), `muestreo-resumen.tsx`, `cylinder-breaking-table.tsx` (799), `breaking-results-table.tsx`, `edit-cylinder-dialog.tsx`, `granulometria-table.tsx`, `add/edit/view-granulometria-dialog.tsx` | test_cylinders, press_calibrations, granulometria_tests, granulometria_sieve_results, dispatches | 4 | Lo más completo después de stock |
| 12 | Informes | `/informes` (Producción / Calidad) | `app/informes/page.tsx`, `production-report.tsx`, `compression-report.tsx` | dispatches, formulas, mixers, test_cylinders | 2 | Volumen por fecha/fórmula/planta/camión; estadística de compresión |
| 13 | Actividad (solo supervisor) | `/actividad` | `app/actividad/page.tsx`, `lib/activity-log.ts` | activity_log | 2 | Libro de quién hizo qué; incompleto (ver 3.13) |
| — | Login | (envuelve todo) | `components/login-gate.tsx`, `lib/current-user.ts`, `components/user-selector.tsx` | app_users | 1 | Nombre + contraseña compartida en el navegador |
| — | Remito PDF | `/api/remito/[id]` | `app/api/remito/[id]/route.ts` + `public/templates/{control-panel,remito-fiscal,remito-x}.pdf` | dispatches / scheduled_dispatches, clients, construction_sites, formulas, mixers | 3 | Llena plantillas PDF con pdf-lib |
| — | Reporte semanal de calidad | `/api/reportes/calidad-semanal` (cron lunes 11:00 UTC) | `app/api/reportes/calidad-semanal/route.ts` (528) | dispatches, test_cylinders, granulometria_tests, plants | 4 | HTML por mail vía SendGrid o Resend |
| — | Aviso de borrados | `/api/notificar-borrado` | `app/api/notificar-borrado/route.ts` | app_users | 3 | Mail a supervisores (Resend) |
| — | Geo | `/api/geo/buscar`, `/api/geo/ruta`, `/api/geo/link` | `app/api/geo/*`, `lib/geo.ts` | — | 3 | Photon + Nominatim + OSRM (servicios públicos gratuitos) |

---

## 3. Detalle por módulo

### 3.0 Estructura general, navegación, roles y login

- **Layout:** `app/layout.tsx` envuelve todo en `LoginGate` → `AppShell`. Título "Stock Management - Rebucret S.A.", `lang="es"`, Vercel Analytics, dos sistemas de toasts (`components/ui/toaster.tsx` de shadcn y `sonner`).
- **Menú** (`components/app-shell.tsx`, 402 l.):
  - Ítems fijos: Dashboard `/`, Materias Primas, Formulas, Clientes, Camiones, Mantenimiento, Logística.
  - Grupo **Despachos**: Programacion `/programacion`, Despacho Diario `/plantista`, Historial `/historial-despachos`.
  - Grupo **Calidad**: Probetas `/calidad?tab=probetas`, Rotura `?tab=rotura`, Granulometria `?tab=granulometria` (las pestañas `analisis` —por defecto— y `resultados` existen en la página pero no en el submenú).
  - Informes `/informes`.
  - **Actividad** `/actividad`: solo si `role === "supervisor"`.
  - Versión colapsada (íconos) y menú móvil (Sheet). Toggle de alto contraste (`components/high-contrast-toggle.tsx`). El avatar dice siempre "OP".
- **Roles:** en `app_users.role` hay `operario`, `supervisor` y `mantenimiento` (Braian Peralta). El front solo distingue supervisor/no supervisor (`lib/current-user.ts` convierte cualquier otro rol en `operario`). **El único efecto de ser supervisor es ver "Actividad"** y recibir mails de borrado; todas las pantallas y acciones (borrar despachos, editar fórmulas, ajustar stock) están abiertas a cualquiera. El chequeo es solo en el navegador (`app/actividad/page.tsx:40`).
- **Login** (`components/login-gate.tsx`): se elige un nombre de `app_users` (activos) y se escribe una contraseña **única y compartida, fija en el código del navegador**. Se guardan `localStorage["rebucret-auth"]="true"` y `localStorage["rebucret_current_user"]={name, role}`. Desde la misma pantalla cualquiera puede **dar de alta un usuario nuevo** (inserta en `app_users` con rol operario). No hay Supabase Auth, ni sesión de servidor, ni vencimiento. 7 usuarios hoy (2 supervisores con mail: Bautista Caputo, Juan Oreguy).
- `components/user-selector.tsx`: combo "Programado por"/"Cargado por" en algunos formularios (redundante con el usuario logueado; `currentUserName()` se usa como fallback).
- Páginas de servidor que solo cargan `plants` y delegan en un componente cliente: `app/programacion/page.tsx`, `app/plantista/page.tsx`, `app/historial-despachos/page.tsx`, `app/clientes/page.tsx`, `app/camiones/page.tsx`. `app/page.tsx` e `app/informes/page.tsx` sí hacen consultas de servidor (con la clave anónima vía `lib/supabase/server.ts`).
- Resto: `app/ingresos/loading.tsx` existe sin `page.tsx` (huérfano). `app/*/loading.tsx` en calidad, formulas, materias-primas.

### 3.1 Dashboard (`/`)

- `app/page.tsx` (server, `force-dynamic`) trae: plantas, **todos** los materiales, despachos de los últimos 2 meses con `dispatch_materials`, últimos 20 ingresos, **todas** las probetas (sin límite), fórmulas con materiales, últimas 10 granulometrías y la calibración activa de la prensa. Todo se pasa a `components/dashboard-client.tsx`.
- KPIs y paneles: M3 hoy / período / últimos 30 días; Evolución de despachos (día/semana, selector de meses); Distribución por fórmula (% de m³ del mes); Principales clientes por m³; Stock crítico (materiales bajo `min_stock`); Resumen de probetas del mes (ensayadas/aprobadas/rechazadas); Calibración de prensa; "Consumo real vs teórico — desvío de cemento por fórmula" (busca materiales cuyo nombre contenga "cemento"; el cemento se llama "CPC 40", así que el panel queda vacío; además el "real" sale de la misma fórmula, no de la planta); "Últimos movimientos"; widget de mantenimiento (`components/mantenimiento-widget.tsx`: OTs vencidas/próximas).
- Filtro por planta y agrupación por la planta que despachó (commit 27/08).

### 3.2 Materias Primas (`/materias-primas`)

Página cliente `app/materias-primas/page.tsx` con pestañas por query `?tab=`: **stock**, **ingresos**, **humedad**, **proveedores**; selector de planta (`components/plant-selector.tsx`), rango de fechas y filtro de material; export XLSX.

- **Materiales** (`materials`, 22 filas = 11 por planta): Agua, Arena Fina, Arena Trituración 0/6, CPC 40, Fibra, Piedra Partida 10/30, 6/12, 6/20, Sikament 33S, Sikament 90E, "Superfluidificante (obra)" (en litros). Campos: `current_stock` (kg, húmedo), `dry_stock`, `min_stock`, `stockpile_humidity`, `bulk_density`, `bulking_factor_k`, `requires_humidity_control`. Alta/edición en `add-material-dialog.tsx` / `edit-material-dialog.tsx` (ojo: la edición guarda `current_stock` tal como está en el formulario → puede pisar el stock con un valor viejo). Varios stocks están negativos (Agua, Sikament, Arena 0/6 en Hudson) porque el despacho nunca se bloquea por falta de stock.
- **Ingresos** (`components/add-stock-entry-dialog.tsx`): material → proveedor habilitado (`material_suppliers`) → transportista (`carriers`, con `driver_name` = chofer del camión del **proveedor**, no de un mixer) → remito, cantidad en kg, humedad (directa o calculada con muestra húmeda/seca), toma de muestra para granulometría.
  - Inserta `stock_entries`. **El stock húmedo (`current_stock`) lo suma solo la base** con el trigger `trigger_update_stock_entry` → `update_stock_after_entry()` (AFTER INSERT). El cliente solo suma `dry_stock` (lectura + update, no atómico). Hubo doble conteo del 03/08 al 09/09/2026, corregido con ajustes (commit "fix(ingresos): cada camion se sumaba dos veces al stock").
  - Si la humedad de arena supera la tolerancia (3 %) inserta `humidity_excess_log` (exceso en kg/tn para reclamar; campos `credited`, `credit_note_number`). Pantalla: `components/humidity-excess-table.tsx` (total acreditado/pendiente).
  - Si se tomó muestra crea `granulometria_tests` vinculado (`stock_entries.granulometry_test_id` y `granulometria_tests.stock_entry_id`).
  - Registra `activity_log` (145 ingresos creados).
  - **No** inserta `stock_movements` de tipo `ingreso` (solo hay 10 históricos): el gráfico de evolución combina `stock_entries` + `stock_movements`.
- **Lista de ingresos** (`components/stock-entries-table.tsx`): editar y borrar. Borrar llama a una RPC `decrement_stock` **que no existe en la base** (falla en silencio); el stock igual se descuenta porque hay trigger `trigger_decrease_stock_on_entry_delete` (AFTER DELETE, con `GREATEST(0,…)` y ajuste de `dry_stock`). **Editar la cantidad** llama a `increment_stock`/`decrement_stock`, que no existen → **el stock no se corrige al editar un ingreso** (bug). Borrar notifica por mail (`logDeletion`).
- **Evolución de stock** (`components/stock-evolution-chart.tsx`): gráfico de área + barras por material y período, detalle por camión y por fórmula, botón "Ajustar stock" protegido con una **contraseña fija en el código del cliente**.
- **Recuento** (`components/adjust-stock-dialog.tsx`): fija `current_stock` y recalcula `dry_stock`; inserta `stock_movements` `ajuste`/`recuento` con nota "Anterior: X, Nuevo: Y" (74 recuentos; es el ancla para reconciliar libro vs stock).
- **Transferencia entre plantas** (`components/transfer-stock-dialog.tsx`): dos llamadas a `update_material_stock` (±) y dos `stock_movements` `transferencia` (sin transacción).
- **Proveedores** (`components/suppliers-table.tsx`, `add-supplier-dialog.tsx`): `suppliers` + `material_suppliers` (qué materiales provee cada uno).
- `components/material-detail-dialog.tsx`: detalle de un material con ingresos y consumos.

### 3.3 Fórmulas (`/formulas`)

- `app/formulas/page.tsx` + `components/formulas-grouped-view.tsx`; diálogos `add-formula-dialog.tsx` (380), `edit-formula-dialog.tsx` (306, guarda `updated_by`), `view-formula-dialog.tsx`, `delete-formula-dialog.tsx` (revisa si hay despachos/pedidos que la usan).
- Modelo: `formulas` (code, name, description, `yield_m3`=1, `useful_life_minutes`=90, `plant_id`) + `formula_materials` (kg **secos** por m³). 31 fórmulas en Canning, 28 en Hudson. El código codifica la resistencia (`H30-620-10 C (CAN)`): el reporte de calidad extrae f'c con una regex sobre el código.
- No hay versionado, aprobación, costo, precio, ni relación agua/cemento explícita; editar una fórmula cambia retroactivamente lo que "debería" haber consumido.

### 3.4 Clientes y Obras (`/clientes`)

- `components/clients-management.tsx`: listado con búsqueda (nombre/CUIT), alta/edición de cliente con **CUIT obligatorio y anti-duplicado**, razón social, condición IVA, condición de pago (default "Contado"), dirección fiscal, CP, localidad, provincia, contacto, teléfono, email. Baja lógica (`active=false`).
- Obras (`construction_sites`): nombre, dirección, localidad, **ubicación en mapa** (`components/obra-ubicacion.tsx`: buscar dirección en la zona, pegar link de Google Maps —también cortos de WhatsApp— o coordenadas, marcar a mano; calcula distancia y tiempo desde la planta con OSRM ×1,3), tiempo de viaje, tiempo de descarga, requiere bomba, horario de recepción, contacto y teléfono de obra, observaciones. Borrado físico.
- Altas rápidas desde Programación y despacho manual: `add-client-dialog.tsx`, `add-construction-site-dialog.tsx`.
- Datos reales: 79 clientes (38 con CUIT, 42 con razón social, **0 con dirección fiscal** → el remito sale con esos campos vacíos); 124 obras, 52 con dirección, **0 con coordenadas**, 102 con el tiempo de viaje por defecto (30 min), 0 marcadas "requiere bomba".
- `clients.plant_id` existe pero el uso es inconsistente (Programación trae todos los clientes activos; Despacho Diario y la edición del historial filtran por planta).

### 3.5 Camiones (`/camiones`)

- `components/mixers-management.tsx`: patente (aviso de repetida), marca, modelo, capacidad (m³), estado manual: `available`, `in_transit`, `maintenance`, `unavailable`; baja lógica `active=false`. Tarjetas con conteo por estado.
- 5 mixers (IVECO Tector ×3, IVECO Trakker 10 m³, Astra), todos `available`, `plant_id` nulo (compartidos entre plantas, decisión del 31/08), `gps_unit_id` nulo (se completa solo al primer cruce con Wialon).
- **No hay** choferes, documentación (VTV, seguro), odómetro/horas, costos, ni vínculo con el módulo de mantenimiento.

### 3.6 Mantenimiento (`/mantenimiento`)

- `app/mantenimiento/page.tsx` (server) → `components/mantenimiento-content.tsx` con vistas **Hoy / Calendario / Planta / Historial** (`components/mantenimiento/*.tsx`) y diálogos de **Orden de trabajo** (`orden-trabajo-dialog.tsx`: empezar, tildar pasos, fotos comprimidas al bucket público `mantenimiento`, completar con fecha, cancelar) y **Reportar falla** (`reportar-falla-dialog.tsx`: OT correctiva).
- `lib/mantenimiento.ts`: modelo PLAN (`maint_tasks`, con frecuencia en días y/o m³, pasos, ítems/repuestos, imágenes del manual) → **OT** (`maint_work_orders`: número secuencial, tipo preventiva/correctiva, estado pendiente/en_curso/completada/cancelada, prioridad, asignado, pasos jsonb, m³ acumulado) → **EJECUCIÓN** (`maint_executions`, reinicia el contador). `proximoVencimiento()` combina días y m³ despachados; `sincronizarOrdenes()` crea OTs para tareas vencidas al abrir la pantalla (índice único parcial: una OT abierta por tarea).
- Datos: 1 equipo (Indumóvil 80, Canning), 33 tareas, 37 OTs (28 pendientes, 8 canceladas, 1 completada) → uso real todavía bajo. Semillas en `scripts/seed-mantenimiento-*.js`; fotos del manual en `public/manuales/indumovil80`.
- No cubre mixers, bombas ni pala (la pala está como "componente" de la planta).

### 3.7 Logística (`/logistica`) y geo

- `components/logistica-en-vivo.tsx` + `components/mapa-base.tsx` (Leaflet 1.9.4 desde cdnjs, teselas OSM). Consulta `/api/gps/posiciones` cada 30 s mientras la pestaña está visible. Muestra mapa con plantas, obras y camiones; estados calculados: `en_planta`, `hacia_obra`, `en_obra`, `volviendo`, `detenido`, `sin_senal`; minutos a obra/planta; pedidos del día.
- Conexión: botón que va a `/api/gps/conectar` (GET → OAuth de Wialon con permisos de solo lectura `0x100+0x200` → vuelve con `access_token` → se valida y se guarda en `integraciones` con clave `wialon_token`) o pegar un token (POST). **Hoy `integraciones` tiene 0 filas: no está conectado.**
- `lib/wialon.ts`: host `https://hst-api.wialon.us` (B-Track de Bilderit es Wialon white-label). Sesión reutilizada 4 min; caché de posiciones 25 s compartida en memoria del servidor (se pierde entre instancias serverless). Busca unidades `avl_unit` con última posición e ignición.
- `app/api/gps/posiciones/route.ts`: cruza unidad ↔ mixer por `gps_unit_id` o patente normalizada (y guarda el vínculo), toma el último despacho del día del mixer (por `created_at`), calcula distancia a planta (radio 250 m) y a la obra (400 m) y un estado heurístico. **No persiste nada** del viaje (ni eventos, ni tiempos, ni posiciones).
- `lib/geo.ts`: distancia haversine, tiempo estimado (línea recta ×1,35 a 35 km/h), `FACTOR_MIXER=1.3`, parser de coordenadas/links. `app/api/geo/buscar` (Photon + Nominatim acotados a la zona Canning–Hudson), `app/api/geo/ruta` (OSRM público), `app/api/geo/link` (resuelve links cortos de Google Maps siguiendo redirecciones).

### 3.8 Programación (`/programacion`)

Pestañas en `components/programacion-tabs.tsx` (la última elegida se recuerda en `localStorage`).

**Semana** (`components/dispatch-scheduling.tsx`, 850 l.):
- Grilla lunes–domingo × horas 06–19 por **hora de llegada a obra**; filtro "Todas las plantas" o una; colores por estado (`scheduled`, `confirmed`, `loading`, `in_transit`, `delivered`, `completed`, `cancelled`) y etiqueta de planta.
- Clic en un hueco → "Nuevo Despacho Programado" (en la práctica es el **pedido**): planta, fecha y hora de llegada, cliente (alta rápida; si no tiene CUIT pide cargarlo con anti-duplicado), obra (alta rápida; muestra viaje/descarga/bomba/horario), **método de descarga obligatorio** (bomba ~15 min / directo ~25 min por camión, desde 29/09), fórmula (filtrada por planta), cantidad total m³, fibra kg/m³, camión opcional (solo `available`), observaciones, "Programado por".
- `scheduled_departure_time = llegada − travel_time_minutes` (CHECK en base: salida ≤ llegada). Se crea con `status` por defecto `scheduled`, `mixer_id` nulo.
- Editar, cancelar (`status=cancelled`), eliminar (borrado físico), "Visualizar Remito" (abre `/api/remito/<id del pedido>`).
- No hay confirmación con el cliente, ni estados comerciales (cotizado/confirmado/crédito), ni validación contra horario de recepción de la obra o capacidad de la planta.

**Día · ordenar camiones** (`components/programacion-dia.tsx` + `lib/planificador.ts`):
- Por defecto muestra **mañana**. Lista los pedidos del día con hora de llegada editable (se guarda en el pedido y recalcula la salida; se registra en `activity_log`) y método bomba/directo editable.
- Motor puro `planificar(pedidos, camiones, parámetros)`: divide cada pedido en viajes de hasta 8 m³, calcula ciclo (carga 10' + ida + descarga proporcional a m³ + lavado 10' + vuelta), camiones ideales para no cortar el vaciado, asigna el camión que se libera antes, respeta **una boca de carga** (un camión por vez), y devuelve por viaje: inicio de carga, salida, llegada, fin de descarga, vuelta y espera de la obra; por pedido: demora del primer camión, huecos, m³/h; por camión: utilización.
- UI: KPIs del día (pedidos, viajes, primera carga, última vuelta, uso de mixers), diagnóstico por pedido (a tiempo / tarde / huecos por falta de camiones), diagrama tipo Gantt por camión. Camiones disponibles y parámetros de tiempo se guardan **en el navegador** (`localStorage`), no en la base. Modo "simular el día completo" para días pasados.
- **El plan no se persiste**: no genera tickets/viajes, no asigna camión al pedido, no llega a Despacho diario.

### 3.9 Despacho Diario (`/plantista`)

`components/plantista-view.tsx` (1.216 l.). Pantalla del operador de planta.

- Selector de planta y día (ayer/hoy/mañana), reloj, refresco automático cada 30 s. Carga: pedidos del día de la planta (por `scheduled_arrival_time`, excluye cancelados), mixers activos (todos), fórmulas y clientes de la planta, y despachos del día (**sin filtrar por planta**: el "Resumen del día" y "Camiones en ruta" mezclan Canning y Hudson).
- **Control diario de humedad de acopio** (modal al abrir hoy, para materiales con "arena" en el nombre; % directo o por pesada húmedo/seco). **Está roto:** escribe columnas `log_date` y `humidity_percentage` que no existen (las reales son `reading_date` y `humidity_percent`) y no revisa el error → `daily_stockpile_humidity` tiene **0 filas**, el modal reaparece siempre y el trigger `trg_update_stockpile_humidity` (que copiaría la humedad a `materials.stockpile_humidity`) nunca corre. La humedad que usa el despacho es la que haya quedado en `materials.stockpile_humidity` (hoy 3 % en Arena Fina de Canning, 0 en el resto).
- Banner fijo "Se recomienda extraer 3 muestras cada 50 m³" (el reporte semanal mide otro objetivo: 1 muestra cada 3 camiones).
- Tarjetas: pedidos activos, en ruta, camiones disponibles, urgentes. "Resumen del día" por fórmula y por cliente; "Últimos despachos" con botón de remito.
- **Pedidos del día**: por pedido muestra cliente, obra, fórmula, badges BOMBA/DIRECTO y FIBRA, barra enviado/restante. Acciones: **Despachar**, **Finalizar** (cierra `completed` con lo enviado y anota los m³ no enviados en observaciones), Editar total, Cancelar.
- **Despachar camión** (`handleDispatch`, líneas 306–494): cantidad sugerida = min(restante, 8), camión (lista todos; marca "en ruta"), **remito obligatorio (número tipeado a mano)**, agua extra en planta (L), fibra (switch + kg/m³ precargado del pedido), muestra de probeta (N° de muestra + asentamiento real; muestra la última muestra cargada). Valida no superar el restante +0,5 m³. Luego, **desde el navegador y en pasos sueltos**:
  1. `insert dispatches` (fecha = ahora, `scheduled_dispatch_id`, `plant_id`, `created_by`).
  2. Por cada material de la fórmula: cantidad = kg/m³ × m³; si el nombre contiene "arena"/"sand" y hay humedad → ×(1 + h/100) (corrección por humedad); `rpc update_material_stock(−cant)`; `insert dispatch_materials(quantity)`; `insert stock_movements('consumo','dispatch')`. **No excluye Agua ni Sikament 33S** (el despacho manual sí los excluye) y no guarda `dry_quantity`/`wet_quantity`/`humidity_at_dispatch` (0 de 6.739 filas los tienen).
  3. Fibra: busca un material con "fibra" en el nombre en esa planta y repite el trío RPC + dispatch_materials + movimiento.
  4. Probetas: el trigger `trigger_create_test_cylinders` ya crea 3 (1×7 d, 2×28 d) al insertar el despacho con `sample_taken=true`; el cliente verifica si existen antes de insertar (evita duplicar).
  5. `update scheduled_dispatches.dispatched_m3 += m3` (lectura-modificación-escritura desde el estado en pantalla, no atómico) y `status='completed'` si se completó.
  6. `update mixers.status='in_transit'`.
  7. `insert dispatch_status_log` "fire and forget" (genera sobre todo filas `scheduled→scheduled`, 521 de 1.266).
  Al terminar abre "Camión despachado — Imprimir remito". **No** registra `actual_load_start_time`/`actual_departure_time`, ni actividad en `activity_log`, ni chequea remito duplicado (hay **64 números de remito repetidos** en `dispatches`).
- **Camiones en ruta**: el último despacho del día de cada mixer con `status=in_transit`; ETA = hora del despacho + `travel_time_minutes`; botón **Entregado** → solo pone el mixer `available` (no guarda hora de llegada ni de descarga, no toca el despacho).
- **Carga despacho manual** (`components/add-dispatch-dialog.tsx`, 1.065 l.): despacho sin pedido (`scheduled_dispatch_id` nulo). Planta, fórmula (combo con búsqueda), humedad de arena (precargada del último despacho; se guarda en `dispatches.sand_stockpile_humidity` pero el cálculo usa `materials.stockpile_humidity`), m³, remito (con **anti-duplicado**), mixer, cliente y obra (altas rápidas), agua extra, fibra, muestra, **fecha** (se guarda a las 12:00 −03:00: de ahí el pico de 84 despachos "a las 12" en el último mes), observaciones, usuario. Modo **"Despacho por árido"** (`is_test_dispatch`): sin cliente, observaciones obligatorias, y opción de **carga manual de materiales** → `manual_material_withdrawals` + `manual_withdrawal_items` + RPC + `stock_movements` con `reference_type='manual_withdrawal'`. Excluye del descuento Agua y "Sikament 33" (aditivo de obra). Crea probetas con `insert` directo además del trigger (sin chequeo previo; puede duplicar). Registra `activity_log` (solo 1 "crear despacho" en la base).

### 3.10 Historial de despachos (`/historial-despachos`)

`components/dispatch-history.tsx` (1.506 l.). Muestra **solo `dispatches`** (camiones reales) en un rango de fechas, por planta o todas; hasta 10.000 filas.
- Cada despacho se "disfraza" de pedido: `scheduled_arrival_time = actual_arrival_time = dispatch_date` y `status='delivered'`. Por eso el KPI **"puntualidad" da siempre 100 %** y el filtro de estado no aporta.
- Búsqueda libre + filtros por columna tipo Excel (remito, cliente, obra, fórmula, camión, responsable), gráfico de m³/día, **export a XLSX**.
- Acciones: ver (`view-dispatch-dialog.tsx`), **editar** (m³, fecha, remito, cliente, obra, fórmula, camión, agua, observaciones: **no recalcula materiales ni stock**), **agregar muestra** a posteriori (crea probetas programadas desde la fecha del despacho), **agregar/editar fibra** y **superfluidificante** (ajusta `dispatch_materials` y stock por diferencia, con `stock_movements`), **borrar**.
- **Borrar un despacho**: registra y avisa por mail, borra probetas y `dispatch_materials`, borra el pedido vinculado **solo si está enlazado por la columna vieja `scheduled_dispatches.dispatch_id`** y borra el despacho. **No devuelve el stock**, deja los `stock_movements` de consumo huérfanos y, en el flujo nuevo (enlace `dispatches.scheduled_dispatch_id`), **no descuenta `dispatched_m3` del pedido**.

### 3.11 Calidad (`/calidad`)

`app/calidad/page.tsx` con pestañas:
- **analisis** → `components/quality-analysis-dashboard.tsx` (1.573 l.): evolución temporal de resistencia, distribución de 28 d con campana de Gauss, correlación 7/28 d, asentamiento vs resistencia, evolución del asentamiento (cono de Abrams), evolución del módulo de finura, pestaña Muestras; f'ck = f'cm − k·σ (k = 1,65 o 1,28 CIRSOC/ACI); alertas cuando f'ck < f'c; exporta PDF (jsPDF + autotable) con relación a/c y agua extra.
- **probetas** → `components/test-cylinders-table.tsx` (653) + `components/muestreo-resumen.tsx` (muestras vs camiones y m³ por planta y semana; objetivo 1 muestra cada 3 camiones).
- **rotura** → `components/cylinder-breaking-table.tsx` (799): carga de rotura por probeta (peso, lectura del dial, fecha real), resistencia calculada con la **calibración de la prensa** (`press_calibrations`: polinomio Y = A·x³ + B·x² + C·x + D en tf/kN, diámetro de probeta) → MPa; gestión de calibraciones.
- **resultados** → `components/breaking-results-table.tsx` (494); corrección con `edit-cylinder-dialog.tsx` (registra `activity_log` "correccion"); descarte de probetas (`discarded`, `discard_reason`).
- **granulometria** → `components/granulometria-table.tsx`, `add/edit/view-granulometria-dialog.tsx`: tamices, % retenido/pasante, módulo de finura, curva; vinculada a ingreso/proveedor/material.
- Reglas: probetas solo con `cylinder_number ∈ {1,2,3}` y `test_age_days ∈ {7,28}` (CHECK en base). La unidad de resultado a 28 d es la **muestra** (promedio de sus probetas de 28 d). Datos: 585 probetas, 179 despachos con muestra (todas en Canning; Hudson 0).

### 3.12 Informes (`/informes`) y reporte semanal

- `app/informes/page.tsx`: pestaña **Producción** (`components/production-report.tsx`: volumen despachado por rango, agrupado por fórmula/planta/camión) y **Calidad** (`components/compression-report.tsx`: estadística de compresión por fórmula: n, media, σ, mín/máx, resistencia característica, distribución).
- Reporte semanal: ver sección 5.

### 3.13 Actividad (`/actividad`)

- `app/actividad/page.tsx` (solo supervisor, chequeo en el navegador) sobre `activity_log` (usuario, acción, entidad, referencia, planta, `details` jsonb con copia del registro borrado). Filtros por usuario, acción y tipo.
- `lib/activity-log.ts`: `logActivity()` y `logDeletion()` (este además llama a `/api/notificar-borrado`). Nunca corta la operación.
- **Cobertura parcial**: registra ingresos (145), borrados (7 despachos, 7 ingresos), cambios de hora del pedido en la vista Día, correcciones de probetas/fórmula/material, transferencias. **No** registra los despachos hechos desde Despacho Diario (el flujo principal), la creación/edición de pedidos en la vista Semana, ni recuentos.

### 3.14 Remito PDF (`/api/remito/[id]`)

- `app/api/remito/[id]/route.ts` (386 l.), servidor con **service role key**. Sin `?doc=` devuelve una página HTML de vista previa con botones; con `?doc=control` (control de carga), `?doc=fiscal` (remito fiscal) o `?doc=remitox` (remito X; `&fondo=0` imprime solo los datos sobre la hoja preimpresa). Rellena `public/templates/*.pdf` con pdf-lib escribiendo sobre coordenadas en mm.
- Acepta id de `scheduled_dispatches` (pedido, sin número de remito) o de `dispatches` (camión). Datos: fecha, razón social, dirección fiscal, CP, localidad, provincia, condición IVA y de pago, CUIT, remito (prefijos fijos "0099-"), m³ exactos, código de producto (= fórmula), localidad/dirección de obra, patente, observaciones. `nPedido` va vacío.
- No lleva precio, chofer, hora de salida/llegada, sello de recepción ni firma; el número de remito no lo genera el sistema; la ruta es pública (cualquiera con el id obtiene el PDF con datos fiscales del cliente).

---

## 4. Modelo de datos

Fuente: `information_schema` de producción (36 tablas en `public`, 0 vistas) + `.from()` del código + `scripts/*.sql`. Filas aproximadas entre corchetes. **RLS desactivado en todas salvo `integraciones`**, y el rol `anon` tiene SELECT/INSERT/UPDATE/DELETE/TRUNCATE sobre las tablas.

### 4.1 Maestros
- **plants** [2]: id, name, code (`CAN`/`HUD`), gps_lat, gps_lng.
- **clients** [79]: id, name, contact, phone, email, plant_id, cuit, active, razon_social, cond_iva (default 'Responsable Inscripto'), direccion_fiscal, cp, localidad_cliente, provincia (default 'Buenos Aires'), cond_pago (default 'Contado').
- **construction_sites** (obras) [124]: id, client_id→clients, name, address, localidad, gps_lat, gps_lng, gps_source, gps_updated_at, travel_time_minutes (30), travel_distance_km, unload_time_minutes (20), requires_pump, reception_hours_start/end (07–18), site_contact, site_phone, observations, status ('active').
- **mixers** [5]: id, license_plate, brand, model, capacity_m3 (8), status ('available'; la UI usa también in_transit/maintenance/unavailable), active, plant_id (nulo en los 5), gps_unit_id.
- **formulas** [59]: id, code, name, description, yield_m3, useful_life_minutes, plant_id, updated_by.
- **formula_materials** [332]: formula_id, material_id, quantity (kg secos/m³).
- **materials** [22]: ver 3.2.
- **suppliers** [13], **material_suppliers** [19], **carriers** [131] (transportistas de materia prima: name, driver_name, phone, supplier_id).
- **app_users** [7]: name, active, role (operario/supervisor/mantenimiento), email.
- **No existen**: tablas de **choferes** de mixer, **bombas**, vendedores, **listas de precios**, **contratos/cotizaciones**, condiciones comerciales por obra, **facturas/liquidaciones**, zonas de flete, cargos adicionales (bombeo, espera, fibra, aditivos), tipos de producto aparte de la fórmula.

### 4.2 Operación comercial-logística
- **scheduled_dispatches** (= **pedido**) [586]: id, plant_id, client_id, construction_site_id, formula_id, mixer_id (opcional; 134 lo tienen), quantity_m3, **dispatched_m3** (acumulado), scheduled_arrival_time, scheduled_departure_time, actual_load_start_time, actual_departure_time, actual_arrival_time (**nunca los escribe el código actual**; 132 filas viejas tienen carga/salida, 0 tienen llegada), status (default 'scheduled'; valores en base: completed 382, delivered 109, scheduled 52, cancelled 24, in_transit 19 — los `loading/in_transit/delivered` son de un flujo viejo 1 pedido = 1 camión), observations, cancelled_reason, is_urgent (0 en uso), dispatch_id→dispatches (enlace viejo 1:1), remito y extra_water_liters (del flujo viejo), created_by, fiber_kg_per_m3, **metodo_descarga** ('bomba'|'directo', CHECK; 0 cargados todavía). CHECK salida ≤ llegada.
- **dispatches** (= **camión/remito/ticket**) [1.317]: id, plant_id, scheduled_dispatch_id→scheduled_dispatches (N:1; 859 lo tienen, hasta 38 camiones por pedido), formula_id, client_id, construction_site_id, mixer_id, quantity_m3, dispatch_date (hora de carga en el flujo del plantista; 12:00 en el manual), created_at, remito (texto libre), notes, extra_water_liters, sand_stockpile_humidity, sample_taken, sample_number, actual_slump_cm, is_test_dispatch (despacho por árido), created_by; `client`/`obra` varchar legados. Hay ~130 despachos de feb–sep 2025 con 0 m³ y uno con fecha año 0001 (datos de prueba/viejos).
- **dispatch_materials** [6.739]: dispatch_id, material_id, quantity (kg), dry_quantity, wet_quantity, humidity_at_dispatch (estas tres siempre vacías).
- **dispatch_status_log** [1.266]: scheduled_dispatch_id, previous_status, new_status, changed_at, changed_by (no se completa), notes.
- **manual_material_withdrawals** [1] / **manual_withdrawal_items** [1]: salidas manuales de materiales.

### 4.3 Stock
- **stock_entries** [491]: material_id, quantity (kg húmedos), original_quantity, dry_quantity, humidity_percentage, supplier/supplier_id, carrier_id, remito, notes, entry_date, sample_taken_granulometry, granulometry_test_id, created_by.
- **stock_movements** [7.119]: material_id, movement_type (CHECK: ingreso/consumo/ajuste/transferencia), quantity_kg, reference_type (dispatch 7.024, recuento 74, correccion 9, stock_entry 10, transfer 2, manual_withdrawal), reference_id (sin FK), movement_date, notes.
- **humidity_excess_log** [139], **daily_stockpile_humidity** [0, roto], **stockpile_cubications** [0, sin uso en código].

### 4.4 Calidad
- **test_cylinders** [585]: dispatch_id, cylinder_number (1–3), test_age_days (7/28), scheduled_test_date, actual_test_date, weight_grams, dial_reading, strength_mpa, comments, discarded, discard_reason.
- **press_calibrations** [3]: plant_id, calibration_date, constant_a..d, cylinder_diameter_cm, force_unit, is_active, calibrated_by, certificate_number.
- **granulometria_tests** [92] y **granulometria_sieve_results** [817].

### 4.5 Mantenimiento, integraciones, auditoría
- **maint_equipment** [1], **maint_tasks** [33], **maint_task_steps** [135], **maint_task_items** [26], **maint_task_images** [115], **maint_work_orders** [37], **maint_work_order_photos** [0], **maint_executions** [1]; bucket de Storage `mantenimiento` (público).
- **integraciones** [0]: clave, valor, usuario, conectado_por, actualizado (RLS activado sin políticas → solo service role).
- **activity_log** [166].

### 4.6 Funciones y triggers en la base
| Objeto | Tipo | Qué hace |
|---|---|---|
| `update_material_stock(p_material_id, p_quantity_change)` | función (RPC) | `current_stock += cambio` (sin chequeo, sin registro). Usada por despachos, fibra, superfluidificante, transferencias, salidas manuales |
| `update_stock_after_entry()` | trigger AFTER INSERT en `stock_entries` | suma `quantity` a `current_stock` |
| `decrease_stock_after_entry_delete()` | trigger AFTER DELETE en `stock_entries` | resta (con piso 0) y corrige `dry_stock` |
| `create_test_cylinders_for_dispatch()` | trigger AFTER INSERT en `dispatches` | si `sample_taken`, crea 3 probetas (7, 28, 28 d) |
| `update_material_stockpile_humidity()` | trigger en `daily_stockpile_humidity` | copia la humedad al material (nunca se dispara, la tabla está vacía) |
| `update_stock_after_dispatch()` | función sin trigger asociado | resto del esquema original |
| `decrement_stock`, `increment_stock` | **no existen** | las llaman `stock-entries-table.tsx` (vivo) y `dispatches-table.tsx` (código muerto) |

### 4.7 Scripts SQL en el repo
`scripts/` (23 archivos): `001_create_tables.sql`, `001_add_plants_support.sql`, `002_seed_initial_data.sql`, `002_load_canning_formulas.sql`, `010_make_dispatch_id_nullable.sql`, `025-add-press-calibration.sql`, `026-add-daily-humidity-log.sql`, `027-add-update-material-stock-function.sql`, `028-reconcile-dispatch-materials.sql`, `029-ensure-granulometry-link-columns.sql`, `030-dispatch-flow-redesign.sql` (1 pedido → N despachos, `dispatched_m3`), `create-app-users-table.sql`, `create-stock-movements-table(-v2).sql`, `fix-dispatch-stock-movements.sql`, `rebuild_database.sql`, `rebuild_seed.sql`, `generate_test_dispatches.py`, `seed-mantenimiento-*.js`. **No son una historia de migraciones completa**: faltan las tablas `maint_*`, `integraciones`, `activity_log`, columnas nuevas (`metodo_descarga`, `fiber_kg_per_m3`, gps de obras/plantas, datos fiscales), triggers e índices; muchos cambios se hicieron directo en la base. `DOCUMENTACION_TECNICA.md` está desactualizado (dice "sin autenticación", estados en castellano, etc.). No hay tipos generados de Supabase: los tipos están escritos a mano en cada componente.

### 4.8 Relaciones clave (resumen)
`plants 1─N formulas/materials/clients/suppliers` · `clients 1─N construction_sites` · `scheduled_dispatches N─1 clients/sites/formulas/mixers/plants` · `dispatches N─1 scheduled_dispatches` (y el enlace viejo `scheduled_dispatches.dispatch_id`) · `dispatches 1─N dispatch_materials, test_cylinders` · `stock_movements.reference_id` → dispatch/stock_entry/withdrawal (polimórfico, sin FK) · `maint_equipment 1─N maint_tasks 1─N maint_work_orders`.

---

## 5. Ciclo de vida de un pedido hoy

```
Cliente/Obra ──► Pedido (Programación Semana) ──► [Vista Día: simular, ajustar hora] ──►
Despacho diario: "Despachar" por camión ──► dispatches + stock + probetas ──► Remito PDF ──►
"Entregado" (solo libera el camión) ──► Finalizar/auto-completar pedido ──► Historial ──►
Calidad (rotura 7/28 d) ──► Informes / Reporte semanal
```

| Paso | Dónde | Qué pasa | Manual / automático | Qué falta |
|---|---|---|---|---|
| 1. Alta cliente y obra | `/clientes`, altas rápidas en Programación y despacho manual | CUIT obligatorio con anti-duplicado; obra con tiempo de viaje, descarga, bomba, horario, ubicación | Manual | Datos fiscales incompletos; obras sin coordenadas; sin condiciones comerciales, crédito ni precios por obra |
| 2. Pedido | `/programacion` › Semana | 1 fila en `scheduled_dispatches` con m³ totales, hora de llegada, fórmula, método de descarga, fibra; salida = llegada − viaje | Manual (lo carga quien atiende el teléfono/WhatsApp) | Sin cotización/contrato, sin confirmación al cliente, sin ritmo (m³/h) ni espaciado pedido por el cliente, sin bomba asignada, sin chofer |
| 3. Planificación del día | `/programacion` › Día | Simula viajes y camiones; solo se guarda la hora de llegada y el método | Semi (cálculo automático, decisión manual) | El plan (viajes, camión, hora de carga) no se guarda ni se pasa al plantista; disponibilidad de camiones en el navegador |
| 4. Carga y despacho de cada camión | `/plantista` › Despachar | Crea `dispatches` (1 por camión), descuenta stock por fórmula (+humedad, +fibra), crea probetas, suma `dispatched_m3`, pone el mixer `in_transit` | Manual (el plantista tipea m³, camión, **número de remito**, agua, muestra) | Sin integración con el tablero de la planta dosificadora (consumo real), sin hora real de carga separada de la de registro, sin chofer, sin ticket numerado por el sistema, sin transacción |
| 5. Remito | `/api/remito/[id]` | PDF sobre plantilla (control de carga, fiscal, X) | Automático al pedirlo | Sin numeración ni CAI/serie controlada; sin firma/recepción; sin precio |
| 6. Viaje y entrega | `/plantista` › Camiones en ruta, `/logistica` | ETA = hora de despacho + viaje estimado; "Entregado" libera el camión | Manual (botón) | No se guardan llegada a obra, inicio/fin de descarga, salida de obra, regreso; GPS sin token y sin persistencia; sin prueba de entrega |
| 7. Cierre del pedido | `/plantista` | Auto `completed` al llegar a los m³; o "Finalizar" con faltante anotado en texto | Semi | Sin motivo estructurado del faltante/sobrante, sin devoluciones de hormigón, sin ajuste de pedido por el cliente en obra |
| 8. Historial | `/historial-despachos` | Consulta, edición, export, agregado de muestra/fibra/aditivo, borrado | Manual | Editar/borrar no recalcula stock ni pedido; "puntualidad" ficticia |
| 9. Calidad | `/calidad` | Probetas programadas por trigger; rotura con prensa calibrada; estadística; reporte semanal | Semi | Sin trazabilidad lote de cemento/aditivo → camión, sin control de asentamiento/temperatura en obra por camión fuera de las muestras |
| 10. Informes / cierre del día / facturación | `/informes`, mail semanal | Volumen por fórmula/planta/camión; calidad | Automático (lectura) | **No hay cierre del día, conciliación remitos vs pedidos, liquidación ni facturación**; la facturación ocurre fuera (ERP) sin vínculo |

Observaciones transversales del ciclo:
- **Estados de camión**: solo `available` e `in_transit` en la operación (más `maintenance`/`unavailable` a mano en Camiones). No hay ciclo *en planta → cargando → en viaje → en obra → descargando → lavando → regresando*.
- **Estados del pedido**: en uso real solo `scheduled` → `completed` (o `cancelled`); `loading/in_transit/delivered` son históricos de un flujo anterior.
- **Tiempos reales**: no se registran (0 llegadas; cargas/salidas solo en 132 pedidos viejos). La única marca temporal por camión es `dispatches.dispatch_date/created_at` (momento en que el plantista registró).
- **Choferes**: no existen en el modelo.
- **Tickets por viaje**: el `dispatches` hace de ticket, pero el número (remito) es manual, repetible (64 repetidos) y el "viaje" planificado por el motor no se persiste.

---

## 6. KPIs e informes existentes

| Informe / KPI | Dónde | Fuente | Observaciones |
|---|---|---|---|
| m³ hoy, período, 30 días; evolución por día/semana; % por fórmula; top clientes | `components/dashboard-client.tsx` | dispatches | Correcto; mezcla plantas salvo filtro |
| Stock crítico (bajo mínimo) | Dashboard | materials | Depende de `min_stock` cargado |
| Consumo real vs teórico de cemento | Dashboard | dispatch_materials vs formula_materials | Vacío (busca "cemento", el material es "CPC 40") y no es "real" |
| Resumen de probetas del mes (ensayadas/aprobadas/rechazadas) | Dashboard | test_cylinders | Carga todas las probetas sin límite |
| Resumen del día (m³, viajes por fórmula/cliente), pedidos activos, en ruta, disponibles, urgentes | `/plantista` | dispatches, scheduled_dispatches, mixers | Despachos del día sin filtro de planta |
| Plan del día: viajes, primera carga, última vuelta, uso de mixers %, ocupación de la boca de carga, demora del primer camión, huecos en obra, m³/h | `/programacion` › Día | scheduled_dispatches + `lib/planificador.ts` | Teórico (benchmarks), no se guarda |
| Historial: total, entregados, m³, "a tiempo %" (tolerancia 15'), m³/día | `components/dispatch-history.tsx` | dispatches | "A tiempo" siempre 100 % (fechas iguales) |
| Volumen despachado por fórmula/planta/camión | `/informes` › Producción (`production-report.tsx`) | dispatches | Sin horas/viajes por camión ni productividad |
| Estadística de compresión (n, media, σ, f'ck) | `/informes` › Calidad (`compression-report.tsx`) y `/calidad` › análisis | test_cylinders | Buena base técnica |
| Muestreo vs despachos (objetivo 1 cada 3 camiones) | `muestreo-resumen.tsx` y reporte semanal | dispatches, test_cylinders | — |
| Excedente de humedad por proveedor (kg/tn, acreditado/pendiente) | `/materias-primas?tab=humedad` | humidity_excess_log | Útil para reclamos |
| Evolución de stock por material, consumo por camión y fórmula | `stock-evolution-chart.tsx` | stock_entries, stock_movements | — |
| OTs vencidas/próximas | `mantenimiento-widget.tsx`, `/mantenimiento` | maint_* | — |
| **Reporte semanal de calidad por mail** | `app/api/reportes/calidad-semanal/route.ts`; cron `vercel.json` `0 11 * * 1` → `?send=1` | dispatches, test_cylinders, granulometria_tests | Semana lunes–domingo anterior: producción y muestreo por planta, módulo de finura, resistencias a 28 d por fórmula, muestras que no cumplen (con agua extra y asentamiento), detalle de ensayos, probetas vencidas sin romper. Sin parámetro = vista previa HTML; `?dry=1`, `?to=`, `?desde/hasta`. Destinatarios fijos en código o `REPORTE_CALIDAD_EMAILS`. **Sin secreto**: cualquiera puede dispararlo |
| Resumen diario por WhatsApp | **En el otro repo** (Concretus): `~/Documents/v0-plant-production-control/lib/rebucret.ts` + `app/api/whatsapp/{daily-report,report-0,report-1}` | Lee `dispatches`/`scheduled_dispatches`/clients/sites/formulas de Rebucret por REST con la clave anónima | Depende de que Rebucret siga abierto a `anon`: si se activa RLS, se rompe |

**KPIs tipo Loop que no existen:** puntualidad real (llegada vs pactada), tiempo en planta/carga/viaje/espera/descarga/lavado/regreso, m³ por camión-hora, viajes por camión y por chofer, utilización real de flota, tiempo de ciclo por obra, cumplimiento de ritmo de vaciado, hormigón devuelto/rechazado, pedidos cancelados por causa, horas extra, costo por m³ o por viaje, facturación vs despacho.

---

## 7. Integraciones

| Integración | Estado | Dónde | Detalle |
|---|---|---|---|
| **Supabase** (Postgres, Storage) | Activa | `lib/supabase/client.ts` (navegador, clave anon/publishable), `lib/supabase/server.ts` (server components, clave anon + cookies), `createClient(..., SUPABASE_SERVICE_ROLE_KEY)` en `app/api/remito`, `calidad-semanal`, `lib/wialon.ts` | Sin Supabase Auth; bucket `mantenimiento` público |
| **Wialon / B-Track (Bilderit)** | Construida, **sin token** (`integraciones` vacía) | `lib/wialon.ts`, `app/api/gps/conectar`, `app/api/gps/posiciones`, `components/logistica-en-vivo.tsx` | Solo posición actual; sin historial de viajes, geocercas propias ni eventos; los mixers no tienen sensor de trompo (no se detecta la descarga) |
| **Resend** (mail) | Activa | `app/api/notificar-borrado/route.ts`, `app/api/reportes/calidad-semanal/route.ts` | Remitente `reportes@produccionrebucret.com` (dominio verificado); env `RESEND_API_KEY`, `REPORTE_CALIDAD_FROM`, `REPORTE_CALIDAD_EMAILS` |
| **SendGrid** | Código vivo, con prioridad si existe `SENDGRID_API_KEY` | `calidad-semanal/route.ts` | La prueba venció el 31/07/2026; si alguien vuelve a cargar esa variable, el reporte intentaría salir por SendGrid |
| **OpenStreetMap**: Photon, Nominatim, OSRM, teselas OSM; Leaflet vía cdnjs | Activas (servicios públicos gratuitos, sin SLA) | `app/api/geo/*`, `components/mapa-base.tsx` | Límites de uso de Nominatim/OSRM públicos |
| Google Maps | Solo resolver links pegados | `app/api/geo/link/route.ts` | — |
| **WhatsApp** | **No hay en este repo** | — | El resumen diario lo manda Concretus (TextMeBot) leyendo la base de Rebucret |
| **Zomatik (ERP)** | **No se usa en este repo** | — | Solo existe en Concretus (módulo comercial). No hay vínculo clientes/remitos ↔ facturas |
| Vercel | Hosting, cron semanal, Analytics | `vercel.json`, `@vercel/analytics` en `app/layout.tsx` | Plan Hobby (cron solo diario/semanal) |
| Tablero de la planta dosificadora / balanzas | **No existe** | — | El consumo es teórico por fórmula |

---

## 8. Deuda técnica y riesgos para un refactor grande

### 8.1 Tamaño y estructura
- ~30.300 líneas en `app/`, `components/`, `lib/` (incluye 25 componentes `components/ui/*` de shadcn). Componentes gigantes que mezclan datos, reglas y UI:
  `quality-analysis-dashboard.tsx` 1.573 · `dispatch-history.tsx` 1.506 · `plantista-view.tsx` 1.216 · `stock-evolution-chart.tsx` 1.123 · `dashboard-client.tsx` 1.093 · `add-dispatch-dialog.tsx` 1.065 · `dispatch-scheduling.tsx` 850 · `materials-dashboard.tsx` 812 (sin uso) · `cylinder-breaking-table.tsx` 799 · `clients-management.tsx` 727 · `add-stock-entry-dialog.tsx` 727 · `test-cylinders-table.tsx` 653 · `add-granulometria-dialog.tsx` 645 · `edit-granulometria-dialog.tsx` 603 · `calidad-semanal/route.ts` 528.
- Libs compartidas (pocas y chicas): `lib/planificador.ts` (193, motor puro, bien aislado), `lib/mantenimiento.ts` (238), `lib/wialon.ts` (120), `lib/geo.ts` (52), `lib/activity-log.ts` (77), `lib/current-user.ts` (47), `lib/stock-format.ts` (28), `lib/utils.ts`. **No hay capa de dominio ni de acceso a datos**: cada componente arma sus consultas Supabase y sus tipos a mano.
- Código muerto: `components/dispatches-table.tsx` (usa RPC inexistentes), `materials-dashboard.tsx`, `materials-table.tsx`, `formulas-table.tsx`, `client-filter.tsx`, `construction-site-filter.tsx`, `formula-filter.tsx`, `theme-provider.tsx`; `app/ingresos/loading.tsx` huérfano; `stockpile_cubications`, `update_stock_after_dispatch()` sin uso; columnas legadas (`dispatches.client/obra`, `scheduled_dispatches.dispatch_id/remito/extra_water_liters/actual_*`).
- `next.config.mjs`: `typescript.ignoreBuildErrors: true` → el build no detecta errores de tipos. Sin tests, sin lint en CI. Muchos `console.log("[v0] ...")` y `any`. Proyecto nacido en v0.app (`package.json` "my-v0-project"; el repo estuvo desincronizado de producción jun–ago 2026).
- Dos librerías de toasts, `@supabase/supabase-js: "latest"` (versión flotante), `pnpm-lock.yaml` y `package-lock.json` a la vez.

### 8.2 Lógica duplicada y divergente
- **Despacho** implementado dos veces: `plantista-view.tsx:handleDispatch` y `add-dispatch-dialog.tsx:handleSubmit`. Diferencias ya existentes: el manual excluye Agua y Sikament 33S del descuento, el del plantista no; el manual valida remito duplicado, el del plantista no; el manual registra actividad, el del plantista no; distinta forma de crear probetas (con/sin chequeo previo) y de fechar (ahora vs 12:00). Además `dispatch-history.tsx` repite el patrón RPC + `dispatch_materials` + `stock_movements` para fibra y superfluidificante, y `transfer-stock-dialog.tsx` para transferencias.
- Reglas por **nombre de material** en texto: "arena"/"sand" (humedad), "fibra", "agua"/"water", "sikament 33", "cemento", "Superfluidificante (obra)". Renombrar un material rompe reglas en silencio.
- Selectores de fórmula/cliente/obra duplicados (`FormulaCombobox` en `dispatch-scheduling.tsx` y `add-dispatch-dialog.tsx`; `SearchableSelect` exportado desde `dispatch-scheduling.tsx` e importado por el diálogo).
- Probetas creadas por trigger **y** por el cliente.

### 8.3 Consistencia de datos
- **Escrituras de varios pasos desde el navegador sin transacción**: un despacho hace ~3 + 3×(n materiales) + 4 llamadas. Si se corta la red a mitad, queda despacho sin materiales, stock descontado a medias o pedido sin actualizar. Muchas llamadas no revisan `error`.
- Condiciones de carrera: `dispatched_m3` y `dry_stock` se calculan con el valor leído en pantalla y se sobrescriben (dos plantistas o dos pestañas pisan datos).
- Editar/borrar despachos no revierte stock ni pedido; editar ingresos no corrige stock (RPC inexistente); `edit-material-dialog` puede pisar `current_stock`.
- Humedad diaria rota (columnas mal nombradas); humedad por despacho no guardada.
- Fechas: mezcla de hora local del navegador, `toISOString()` UTC y mediodía forzado (−03:00 o `Z`) según la pantalla.
- Stock negativo permitido por diseño (se corrige con recuentos).

### 8.4 Seguridad
- **RLS desactivado** en 35/36 tablas y `anon` con permisos totales: con la clave anónima (visible en el bundle JS) cualquiera puede leer datos fiscales de clientes o borrar tablas completas vía REST.
- Login solo en el navegador con contraseña compartida fija en el código; cualquiera puede crearse un usuario; roles no se aplican en el servidor; la identidad (`created_by`, `user_name`) la escribe el cliente.
- Contraseña fija adicional en el cliente para ajustar stock (`stock-evolution-chart.tsx:64`).
- Rutas API sin autenticación: `/api/remito/[id]` (usa service role; expone datos fiscales), `/api/reportes/calidad-semanal` (dispara mails, sin CRON_SECRET), `/api/notificar-borrado` (manda mails con contenido arbitrario a supervisores), `/api/gps/conectar` GET/POST (cualquiera puede **reemplazar el token de Wialon**), `/api/geo/link` (sigue redirecciones a cualquier host a partir de un link de Google).
- El reporte diario de Concretus depende de este acceso anónimo abierto: activar RLS requiere coordinar ese cambio.

### 8.5 Rendimiento
- Dashboard trae todas las probetas y 2 meses de despachos con materiales en cada carga; Historial hasta 10.000 filas con joins; Despacho diario refresca 5 consultas cada 30 s por pestaña abierta; caché del GPS en memoria de una instancia serverless.

### 8.6 Riesgos específicos para migrar a un diseño tipo Loop
1. **Separar pedido / viaje (ticket) / remito**: hoy `dispatches` es a la vez ticket, remito y registro de consumo. Conviene introducir una entidad de viaje/ticket con estados y tiempos y dejar `dispatches` (o renombrarla) como remito; mantener compatibilidad con 1.317 filas, 585 probetas y 7.024 movimientos que apuntan a `dispatches.id`.
2. **Mover las escrituras a funciones de base o rutas de servidor transaccionales** (RPC `registrar_despacho(...)`) antes de agregar más pasos (tiempos, chofer, bomba); si no, cada paso nuevo aumenta la probabilidad de estados a medias.
3. **Seguridad primero**: RLS + auth real (Supabase Auth o sesiones de servidor) antes de exponer apps de chofer/cliente; coordinar con Concretus (`lib/rebucret.ts`).
4. **Unificar el cálculo de consumo** (fórmula × m³ + humedad + fibra + exclusiones) en una sola función, y reemplazar las reglas por nombre con atributos del material (`tipo`: árido fino, cemento, agua, aditivo de planta/obra, fibra; `descuenta_stock`).
5. **Limpiar estados legados** de `scheduled_dispatches` y el doble enlace `dispatch_id`/`scheduled_dispatch_id`.
6. Hacer migraciones versionadas (hoy la base "real" no se puede reconstruir desde `scripts/`) y generar tipos de Supabase.
7. Partir los componentes gigantes por responsabilidad (datos / reglas / UI) empezando por Despacho diario, que es la pantalla más crítica y la más usada.
8. Respetar lo existente: los usuarios ya operan con Programación Semana, Despacho diario, Historial y Calidad; el cambio debería ser incremental por pantalla (ver preferencia registrada del usuario).

---

## 9. Huecos frente a un sistema tipo Loop 4 Readymix

| Área Loop | ¿Existe en Rebucret? | Qué hay hoy | Qué falta |
|---|---|---|---|
| **Contratos / cotizaciones / listas de precios** | No | Condición de pago e IVA del cliente (texto) | Precios por fórmula/planta/obra/cliente, vigencias, fletes por zona/distancia, cargos (bombeo, espera, fibra, aditivos, sábado, mínimo de carga), saldo de m³ contratados vs despachados, aprobación comercial y crédito |
| **Toma de pedido** | Parcial | `scheduled_dispatches` con m³, hora, fórmula, método de descarga, fibra | Ritmo/espaciado pedido por el cliente (m³/h o minutos entre camiones), tipo de elemento (losa, columna, platea), asentamiento pedido, aditivos, contacto en obra por pedido, confirmación (día anterior), estados comerciales, pedido recurrente, origen (teléfono/WhatsApp/portal), historial de cambios |
| **Programación** | Parcial | Grilla semanal + motor de viajes del día (teórico, no guardado) | Persistir el plan: viajes/tickets con camión, chofer y hora de carga; capacidad por planta y boca de carga; reprogramación en vivo; vista de programación por camión y por bomba; alertas de conflicto y de horario de recepción |
| **Despacho con ticket por viaje** | Parcial | `dispatches` = 1 camión con remito tipeado; PDF de remito | Número de ticket/remito correlativo generado por el sistema (serie/punto de venta), impresión automática, secuencia de viaje dentro del pedido, hora de carga real, dosificación real (integración con la planta), sobrante/retorno |
| **Choferes** | No | — (`carriers.driver_name` es de proveedores) | Maestro de choferes, asignación camión-chofer por día, horas trabajadas, licencias, productividad |
| **Bombas** | No (solo `metodo_descarga` y `requires_pump`) | Método bomba/directo en el pedido | Maestro de bombas (propias/terceros), operador, programación y reserva, tiempos de armado/bombeo, cargo por bombeo, m³ bombeados |
| **Estados del camión** | Mínimo | `available` / `in_transit` a mano; `maintenance`/`unavailable` en Camiones | Ciclo completo (en planta, cargando, cargado, en viaje, en obra, descargando, lavando, regresando, fuera de servicio) con marca de tiempo por evento, disparado por botón del chofer o por geocerca GPS |
| **Tiempos reales** | No | Solo hora de registro del despacho; columnas `actual_*` sin uso | Registro de cada etapa por viaje; comparación con lo planificado; tiempo en obra y de espera facturable |
| **Puntualidad / KPIs de servicio** | No (KPI ficticio en Historial) | Diagnóstico teórico en la vista Día | Puntualidad real vs pactada, ciclo por obra, m³/camión-hora, viajes por camión/chofer, utilización real, esperas, cancelaciones por causa, hormigón devuelto |
| **GPS / auditoría GPS** | Parcial (sin conectar) | Mapa en vivo y estados heurísticos, sin persistencia | Token cargado, geocercas de planta/obra, reconstrucción diaria de viajes desde el historial de Wialon, eventos guardados por ticket, alertas (tiempo excesivo en obra, desvíos, paradas no autorizadas), aprendizaje de la ubicación de obras desde las paradas, sensor de trompo |
| **Entregas / prueba de entrega** | No | Botón "Entregado" que solo libera el camión | Recepción en obra (firma, foto, nombre de quien recibe, hora), agua agregada en obra, asentamiento en obra, rechazos, remito conformado digital |
| **Control de calidad** | **Sí, fuerte** | Probetas 7/28 d, prensa calibrada, estadística f'ck, granulometría, humedad de ingresos, reporte semanal | Vincular calidad a cada ticket de forma sistemática (asentamiento/temperatura por camión), trazabilidad de lotes de cemento/aditivos, no conformidades y acciones, certificados de calidad al cliente |
| **Stock / materiales** | **Sí** | Ingresos con humedad, consumo teórico, recuentos, transferencias, excedente de humedad | Consumo real desde la planta dosificadora, humedad diaria (hoy rota), costos de materiales, pedidos de compra |
| **Cierre del día / conciliación** | No | Resumen del día en pantalla | Cierre por planta: pedidos vs tickets vs remitos, m³ programados vs despachados, faltantes/sobrantes con motivo, anulaciones de remito, bloqueo de edición post-cierre |
| **Facturación** | No | Datos fiscales del cliente para el remito | Liquidación por remito/pedido con precios y cargos, exportación o integración con el ERP (Zomatik) o factura electrónica, cuenta corriente y crédito |
| **App del chofer** | No | — | Ver próximo viaje, botones de estado, navegación a la obra, remito digital/firma, novedades |
| **Portal / app del cliente** | No | — | Seguimiento de camiones en vivo y ETA, historial de remitos y ensayos, pedidos y cambios, avisos por WhatsApp/mail ("salió el camión", "llega en 10 min") |
| **Mantenimiento de flota** | Parcial (solo planta) | OT, plan preventivo, fotos, historial para la Indumóvil 80 | Mixers y bombas como activos (km/horas desde GPS), vínculo con estado del camión, costos, repuestos |
| **Auditoría / seguridad** | Parcial | `activity_log` parcial, mail al borrar | Auth real, roles aplicados en el servidor, auditoría completa (triggers en base), RLS |
| **Integraciones** | Parcial | Wialon (sin token), Resend, OSM | ERP (Zomatik), planta dosificadora, WhatsApp desde este sistema, factura electrónica |

---

## Anexo A — Rutas

**Páginas** (`app/`): `/` (`page.tsx`), `/materias-primas`, `/formulas`, `/clientes`, `/camiones`, `/mantenimiento`, `/logistica`, `/programacion`, `/plantista`, `/historial-despachos`, `/calidad`, `/informes`, `/actividad`. (`app/ingresos/loading.tsx` sin página.)

**API** (`app/api/`):
| Ruta | Método | Auth | Clave Supabase | Función |
|---|---|---|---|---|
| `/api/remito/[id]` | GET (`?doc=control\|fiscal\|remitox&fondo=0`) | Ninguna | service role | PDF de remito / control de carga |
| `/api/reportes/calidad-semanal` | GET (`?send=1&dry=1&to=&desde=&hasta=`) | Ninguna | service role | Reporte semanal HTML / mail |
| `/api/notificar-borrado` | POST | Ninguna | anon | Mail a supervisores |
| `/api/gps/conectar` | GET (OAuth Wialon) / POST (token) | Ninguna | service role | Guarda token en `integraciones` |
| `/api/gps/posiciones` | GET | Ninguna | service role | Posiciones + estado por mixer |
| `/api/geo/buscar` | GET `?q=` | Ninguna | — | Geocodificación en la zona |
| `/api/geo/ruta` | GET `?desde=&hasta=` | Ninguna | — | Distancia/tiempo OSRM ×1,3 |
| `/api/geo/link` | GET `?u=` | Ninguna | — | Link de Google Maps → coordenadas |

**Cron** (`vercel.json`): `/api/reportes/calidad-semanal?send=1` — `0 11 * * 1` (lunes 08:00 Argentina).

## Anexo B — Variables de entorno usadas en el código
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `SENDGRID_API_KEY` (opcional, tiene prioridad), `REPORTE_CALIDAD_FROM`, `REPORTE_CALIDAD_EMAILS`. (El token de Wialon no es variable de entorno: vive en la tabla `integraciones`.)
