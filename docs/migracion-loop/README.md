# Migración de Rebucret hacia un sistema tipo Loop

Documento maestro del proyecto (lo mantiene el "arquitecto"). Fecha de inicio: 29/09/2026.
Estado: **propuesta, pendiente de aprobación de Bautista**. Nada de esto está programado todavía.

Material de base (en esta carpeta):
- [`informe-loop.md`](informe-loop.md): relevamiento completo de Loop 4 Readymix (22 módulos, modelo de datos, KPIs, fuentes). Capturas en [`capturas-loop/`](capturas-loop/).
- [`inventario-rebucret.md`](inventario-rebucret.md): inventario funcional y técnico de nuestro sistema al 29/09/2026 (módulos, base de datos, bugs, riesgos, huecos frente a Loop).

---

## 1. Objetivo

Que la operación diaria de Rebucret funcione como Loop: **pedido → programación que genera los viajes → despacho de cada viaje a un camión con chofer → seguimiento con tiempos reales → cierre del día**, con indicadores de ciclo, puntualidad y uso de la flota. Sin perder lo que ya funciona bien (stock de materias primas, calidad, mantenimiento, remito).

Escala real para dimensionar: 2 plantas, 5 mixers (compartidos), ~11 despachos por día (~2.000 m³/mes), 7 usuarios. Loop está pensado para flotas de 20 a 100 camiones: copiamos su **forma de organizar el día**, no todo su catálogo.

## 2. Principios (no negociables)

1. **Sin "sistema 2.0" paralelo.** Cada fase transforma una sección existente sobre el mismo sistema y la misma base. Si una pantalla nueva reemplaza a otra, conviven como máximo unas semanas y la vieja se retira.
2. **Producción nunca se corta.** El plantista tiene que poder despachar todos los días, durante toda la migración.
3. **Cada fase se ve antes de programarla** (maqueta o captura) y se aprueba antes de subir.
4. **Datos viejos intactos.** Los 1.317 despachos, 585 probetas y 7.000 movimientos de stock siguen apuntando a `dispatches.id`. Nada se borra; se agregan tablas y columnas.
5. **Lógica de negocio en un solo lugar** (funciones de base o rutas de servidor), no repetida en cada pantalla.

## 3. Cómo se trabaja: arquitecto, obrero y revisor

| Rol | Quién | Qué hace | Entrega |
|---|---|---|---|
| **Arquitecto** | Esta conversación (o una sesión "Arquitecto Loop") | Mantiene este documento, escribe la especificación de cada fase (`fase-N.md`) con pantallas, datos, reglas y criterios de aceptación. Decide el orden. | `fase-N.md` aprobado por Bautista |
| **Obrero** | Una conversación nueva por fase (o por parte de una fase) | Programa **solo** lo que dice `fase-N.md`, en una rama propia, lo prueba local (Rebucret en el puerto 3010) y muestra capturas. | Rama con la fase funcionando + notas |
| **Revisor** | Un agente nuevo (o `/code-review`) | Compara el cambio contra `fase-N.md`: que cumpla los criterios, que no rompa despacho/stock/calidad, que no haya datos a medias. | Lista de problemas o visto bueno |
| **Dueño** | Bautista | Aprueba la especificación, prueba la fase y da el OK para subir. | "Dale" |

Mensaje para abrir una sesión obrero:
> Trabajás en el repo `~/Documents/v0-stock-management-app` (Rebucret). Leé `docs/migracion-loop/README.md` y `docs/migracion-loop/fase-N.md` y programá exactamente esa fase. No toques nada fuera de su alcance. Probala local, mostrame capturas y no subas a main sin mi OK.

Reglas para el obrero: rama `loop/fase-N-...`; migraciones SQL versionadas en `supabase/migrations/` (fecha + nombre); cada fase deja anotado en su `fase-N.md` qué se hizo y qué quedó pendiente; commits con el mail `bautistacaputo96@gmail.com` (Vercel Hobby); deploy = merge a `main`.

## 4. Modelo de datos objetivo (resumen)

Se agrega, no se reemplaza:

| Entidad | Tabla | Qué es | Estado |
|---|---|---|---|
| Pedido / programación | `scheduled_dispatches` (existe) | El pedido del cliente para un día: obra, fórmula, m³ totales, llegada a obra, bomba/directo. Se suman: finalidad (losa, columna…), espaciado entre camiones, bomba asignada, confirmado (quién/cuándo), suspendido con motivo. | Ampliar |
| **Viaje (ticket)** | `viajes` (nueva) | Un camión de un pedido: n/N, m³ planificados, horarios planificados (carga, salida, llegada, fin de descarga, vuelta), camión y chofer asignados, estado, horarios reales y de dónde salió cada hora (manual, app, GPS). | Nueva |
| Remito / consumo | `dispatches` (existe) | Lo que salió de verdad y descontó stock. Se suman `viaje_id`, `chofer_id`, número de remito generado por el sistema, verificado en el cierre. | Ampliar |
| Evento de viaje | `viaje_eventos` (nueva) | Cada cambio de estado con hora y fuente (para auditoría y para recalcular tiempos). | Nueva |
| Chofer | `choferes` (nueva) | Nombre, teléfono, DNI, planta, activo; chofer habitual por camión. | Nueva |
| Vehículo | `mixers` (existe) | Se suman tipo (mixer / bomba), propio o tercero, planta base, chofer habitual. | Ampliar |
| Parámetros de planta | `plants` (existe) | Tiempos estándar (carga, descarga bomba/directo por 8 m³, lavado), bocas de carga, jornada, tolerancia de puntualidad (15 min). Hoy viven en el navegador. | Ampliar |
| Cierre del día | `cierres_dia` (nueva) | Planta + fecha, remitos verificados, faltantes/sobrantes con motivo, cerrado y bloqueado. | Nueva |
| Precios / proyecto | (a decidir) | Proyecto = contrato + obra con lista de precios y adicionales (como Loop). Solo si se decide facturar desde el sistema. | Decisión pendiente |

Estados del viaje: `planificado → asignado → cargando → en_viaje → en_obra → descargando → volviendo → en_planta` (+ `cancelado`). El estado del camión sale del viaje en curso (en planta, en viaje, en obra, volviendo, mantenimiento, sin chofer).

## 5. Fases

Tamaño: S = una sesión obrero, M = 2–3, L = 4 o más. El orden importa: cada fase se apoya en la anterior.

### Fase 0 — Cimientos (invisible para el usuario, imprescindible)
- **0a. Arreglar los errores encontrados en el inventario** (S): humedad diaria de acopio que no se guarda (columnas mal nombradas); editar un ingreso no corrige el stock; borrar un despacho no devuelve stock ni descuenta el pedido; "a tiempo" siempre 100 % en Historial; panel de cemento vacío (busca "cemento", el material es "CPC 40"); el resumen de Despacho diario mezcla Canning y Hudson; remitos repetidos sin aviso en el despacho desde pedido.
- **0b. Un solo motor de despacho** (M): una función en la base (`registrar_despacho`) que hace todo en una transacción (remito, materiales por fórmula con humedad y fibra, movimientos de stock, probetas, pedido, camión). La usan Despacho diario y el despacho manual. Materiales con "tipo" (árido fino, cemento, agua, aditivo de planta/obra, fibra) en vez de reglas por nombre.
- **0c. Seguridad** (L, se puede hacer en paralelo a las fases 1–3, obligatoria antes de la 4 y la 7): login real con usuario y contraseña propios, roles aplicados en el servidor, RLS en las tablas, rutas de API protegidas (remito, reporte, token GPS). Coordinar con Concretus, cuyo reporte diario de WhatsApp lee la base de Rebucret.
- **0d. Migraciones versionadas y tipos de la base** (S).

### Fase 1 — Maestros tipo Loop (M)
Choferes (alta, baja, chofer habitual por camión); camiones con tipo (mixer/bomba), planta base y propio/tercero; parámetros de tiempo por planta guardados en la base (reemplazan los de la vista Día); finalidad del pedido.

### Fase 2 — Programación que genera los viajes (L)
- Al programar un pedido se crean sus viajes (tabla `viajes`) con el motor que ya existe (`lib/planificador.ts`): m³ de cada viaje y horarios, separados por el tiempo de descarga.
- **Gerenciador de viajes** del pedido: Gantt con 4 colores (carga, ida, descarga, vuelta), m³ editables, correr ±5 min, "ajustar a la hora actual", "agregar faltantes / quitar sobrantes".
- **Sugerencia de hora de llegada** que evita que dos pedidos choquen en la boca de carga.
- **Gráfico de demanda**: camiones necesarios por media hora contra camiones disponibles.
- **Confirmar el día anterior** (👍 por pedido), por Titan, Felipe, Juan, Fernando o Bautista.

### Fase 3 — Despacho diario en tres columnas (L)
- Pantalla como la de Loop: **Viajes** (en orden de hora, borde rojo si está atrasado) | **Camiones** (estado, tiempo en ese estado, chofer) | **Pedidos** (entregado / total m³, confirmado, puntualidad).
- Asignar un viaje a un camión (arrastrar o tocar, pensado para la tablet de planta) → formulario **Entrega** (camión, chofer, m³, remito, agua, fibra, muestra) → **Despachar** / **Despachar e imprimir** (usa el motor de la fase 0b).
- Contadores del día (programado, despachado, pendiente, cancelado), tabla de entregas con horas, suspender (lluvia) / reabrir / finalizar pedido con motivo.
- Convive con la pantalla actual hasta que el plantista la valide; después se retira la vieja.

### Fase 4 — Tiempos reales y panel de control (L)
- Mientras no haya GPS: link para el celular del chofer (sin instalar nada) con botones **Llegué a obra / Empecé a descargar / Terminé / Salí de obra**; el plantista marca **Volvió a planta**.
- Con GPS (B-Track conectado): las horas se completan solas con geocercas de planta y obra; los botones quedan de respaldo ("modo híbrido" de Loop).
- **Panel de control**: una línea por viaje en curso (carga → ida → obra → vuelta → planta) con la hora de cada hito y un cronómetro del tramo actual; alertas de más de 90 min en obra y de hormigón cerca de vencer.
- **Puntualidad real** por pedido y por cliente (tolerancia 15 min, configurable), con justificación de atrasos.

### Fase 5 — Cierre del día (M)
Por planta y fecha: verificar cada remito contra lo programado, faltantes y sobrantes con motivo, cancelaciones, cerrar y bloquear el día (después no se edita sin permiso). Exportación para facturar. Si se decide cobrar desde el sistema, se agregan proyecto/contrato con lista de precios y adicionales (bombeo, espera, fibra, mínimo), como en Loop.

### Fase 6 — Indicadores y auditoría (M)
- Dashboard de logística: ciclo, carga, ruta, tiempo en obra, ralentí en planta por viaje, m³ por camión y por chofer, viajes por camión, puntualidad por cliente, con las referencias de Loop (ciclo ~150 min, carga < 20–25, ruta ~60, obra ~70, ralentí ≤ 35).
- Reconstrucción nocturna de los viajes desde el historial de Wialon, **auditoría de entregas** (GPS contra remito: viajes sin remito, remitos sin viaje, paradas fuera de obra, diferencia de km ida/vuelta).

### Fase 7 — Cliente (M)
WhatsApp automático "salió tu camión" con link de seguimiento en vivo; después, portal del cliente con remitos y ensayos de calidad.

### Fuera de alcance por ahora
CRM de ventas, app de combustible, integración con el tablero de la dosificadora (auditoría de carga), benchmark entre empresas, entregas multipunto, app de calidad con QR. Se pueden revisar al terminar la fase 6.

## 6. Decisiones

Tomadas el 29/09/2026:
- **Orden:** Fase 0 primero (0a → 0b → 0d); la 0c (seguridad) en paralelo a las fases 1–3. Especificación en [`fase-0.md`](fase-0.md).
- **Horas reales:** se espera al GPS. La Fase 4 se arma sobre B-Track: sin link para el chofer por ahora y sin marcas manuales, salvo "volvió a planta" si hiciera falta. Sin GPS no hay tiempos reales ni puntualidad real.

Pendientes:
1. **Facturación:** ¿precios y facturación dentro del sistema, o el cierre del día solo arma el listado para facturar afuera? Bautista lo decide al llegar a la Fase 5.
2. **Remito:** ¿correlativo del sistema o talonario tipeado (con aviso de repetido)? Se revisa con Bautista en la Fase 3; hay que ver qué exige el remito fiscal preimpreso.
3. ~~Token de B-Track~~: **conectado el 30/09/2026** (Bilderit autorizó con el usuario Wialon 39910744; 5 mixers visibles en /logistica).

Tomadas el 29/09/2026 (segunda tanda):
- **Agua y Sikament 33S no descuentan stock** (confirmado para la 0b: `descuenta_stock=false`).
- **Bombas: son de terceros.** No son un vehículo propio. En la Fase 1 se modelan como proveedor/servicio de bombeo asignado al pedido (empresa, contacto, hora), no como camión de la flota.
- **Choferes: rotan.** No hay chofer habitual por camión: el chofer se elige en cada despacho (o al empezar el día por camión) y el maestro de choferes es solo la lista de personas.

## 7. Registro de avance

| Fecha | Fase | Qué pasó |
|---|---|---|
| 29/09/2026 | — | Relevamiento de Loop e inventario de Rebucret. Propuesta de fases. |
| 29/09/2026 | 0 | Bautista aprueba empezar por la Fase 0. Se escribe `fase-0.md` (0a errores, 0b motor de despacho, 0d migraciones). |
| 05–06/10/2026 | — | Aviso por mail de stock en 0 (publicado). PELQUE cargada. Fase 2 (+2b, buscador Google) **publicada 06/10**. Fase 4a (tiempos reales GPS con KPIs y detalle) **publicada 06/10**; carga del historial desde 01/09/2025 en curso. Definiciones de la 0c cerradas. |
| 30/09/2026 | 0d | Esquema real de la base en `supabase/migrations/000000000000_esquema_base.sql` (verificado 695/695 objetos), tipos en `types/database.ts` con su generador, SQL viejos a `scripts/legacy/`. Subida a main (sin cambios visibles). Fase 0 terminada salvo la 0c (seguridad). |
| 30/09/2026 | 1 | Bautista aprueba la Fase 1 con la condición "no se pierde nada" (agua extra, fibra, muestras, etc.). Programada (94/94 pruebas), revisada (aprobada con cambios, arreglados), migración aplicada el 01/10 y preview mirado por Bautista. **Publicada el 01/10/2026** (día de lluvia, sin despachos). Faltan: cargar choferes y empresas de bomba. |
| 30/09/2026 | 0b | Motor programado en rama `loop/fase-0b-motor-despacho`; revisión: "aprobado con cambios" (no devolver stock al borrar/editar despachos anteriores a un recuento, orden de bloqueos, edición completa, permisos, reclasificar al renombrar). Arreglos hechos (62/62 pruebas). **Publicada el 30/09/2026** con OK de Bautista, sin despachos: migraciones aplicadas + 238 filas de `dispatch_materials` de los 34 despachos cruzados reubicadas en la planta que despachó. Falta: controlar el primer despacho real. |
| 30/09/2026 | — | B-Track conectado (Bilderit autorizó). Aplicada con OK de Bautista la corrección de stock de 14 despachos cruzados (Hudson con fórmulas CAN): Canning +79.202 Arena Fina, +25.605 0/6, +34.375 CPC 40, +104.950 Piedra 6/20, +309,2 Sikament 90E; Hudson lo mismo en negativo salvo Sikament 90E −633,5 (sin recuento). Movimientos 'transferencia'/'correccion' del 30/09. |
| 29/09/2026 | 0a | Publicada en producción (commits 7695302…146ab9e). Además de los 7 ítems: la humedad de acopio e ingresos queda **solo para la Arena Fina** (pedido de Bautista: a la 0/6 no se le mide). |
| 29/09/2026 | 0a | Obrero: los 7 errores arreglados en la rama local `loop/fase-0a-errores` (3 commits, build limpio, probado con `BEGIN…ROLLBACK` y en local sin grabar). Falta revisión y OK de Bautista para subir. Detalle en `fase-0.md` → Hecho. |
