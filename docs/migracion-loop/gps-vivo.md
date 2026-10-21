# GPS en vivo: precisión y "tocar un camión"

Rama `loop/gps-vivo`, que sale de `loop/fase-3-despacho`. Fecha: 21/10/2026.

Bautista pidió dos cosas:

1. "En mi sistema no es tan preciso como en el otro sistema" (B-Track). Después aclaró que **la posición no aparece atrasada**: el punto no queda tan exacto como en B-Track, y cuesta acercar el mapa para ver dónde está el camión.
2. Tocar un camión y que el mapa vaya a su punto, en Logística › En vivo y desde Despacho › "Ver en el mapa".

## Diagnóstico

Todas las mediciones son del 21/10/2026, entre las 09:57 y las 10:06, con los 5 mixers. Se usó la API de Wialon en solo lectura (`token/login`, `core/search_items`, `messages/load_interval`, `messages/unload`, `core/logout`) y `GET https://www.produccionrebucret.com/api/gps/posiciones`.

### 1. Causa principal: el ícono del camión estaba corrido unos 80 px de su posición real

La coordenada que mostramos es exactamente la de Wialon. Lo que estaba mal era el dibujo.

`iconos.camion` (en `components/mapa-base.tsx`) se dibujaba así:

- un `divIcon` de 110×20 px, con el ancla en el centro (55, 10);
- adentro, un `div` con `display:flex` (ocupa los 110 px) y `transform: translate(-30%, -50%)`, es decir, −33 px;
- el círculo del camión quedaba en el borde izquierdo de ese `div`.

Resultado: el centro del círculo caía **81 px a la izquierda y 10 px arriba** del punto real. Como el error es fijo en píxeles, en metros depende del zoom (latitud −34,9°):

| Zoom | m/px | Corrimiento del punto |
|---|---|---|
| 11 (zoom inicial) | 62,7 | ~5 km |
| 13 | 15,7 | ~1,3 km |
| 15 (máximo del encuadre) | 3,9 | ~320 m |
| 17 | 0,98 | ~80 m |
| 19 (máximo del mapa) | 0,24 | ~20 m |

Por eso:

- en B-Track el camión está "adentro de la planta" y en nuestro mapa queda al costado;
- al acercar el mapa, el punto "se desliza" hacia el lugar real, y no hay forma de ver con precisión dónde está.

La etiqueta de la planta tenía el mismo problema: era una caja de 90 px corrida un 25 % (−22 px), así que no marcaba el punto de la planta. El pin de la obra estaba anclado al centro y no a la punta: ~12 px.

### 2. Coordenadas: no recortamos ni redondeamos nada

Comparamos nuestra posición con el mensaje de Wialon **del mismo segundo** (mismo `t`):

| Unidad | Nuestra (API de producción) | Wialon, mismo segundo | Diferencia |
|---|---|---|---|
| AE402HE | -34.976296, -58.505541 (13:04:51 UTC) | -34.976296, -58.505541 | 0,00 m |
| AF431GU | -34.807418, -58.175496 | -34.807418, -58.175496 | 0,00 m |
| AG083GT | -34.97369, -58.465991 | -34.97369, -58.465991 | 0,00 m |
| CRN449 | -34.973898, -58.466111 | -34.973898, -58.466111 | 0,00 m |
| LES431 | -34.973965, -58.46602 | -34.973965, -58.46602 | 0,00 m |

Detalles:

- Wialon manda 6 decimales (~0,1 m) y los pasamos tal cual. No hay ningún `toFixed` ni redondeo en `lib/wialon.ts`, en `/api/gps/posiciones` ni en la pantalla. El único redondeo es el de los km a la planta, que es un dato aparte.
- La posición del camión no se guarda en la base. Las columnas de ubicación tienen decimales de sobra:
  - `plants.gps_lat/lng`: `numeric(10,6)`;
  - `construction_sites`: `numeric(·,8)`;
  - `viajes_gps.parada_*`: `numeric(10,7)`.
- **No "pegamos" el camión a la obra ni a la planta.** El marcador usa la coordenada cruda de Wialon. La planta y la obra solo se usan para calcular el estado.
- `pos` (flag `0x400`) es la **última posición válida**, la misma que muestra B-Track. `lmsg` es el último mensaje y de ahí sale la ignición. Hoy los dos tenían el mismo `t`.

### 3. Zoom máximo

- El mapa no tenía `maxZoom` propio y las capas tenían `maxZoom: 19`. El encuadre inicial llega hasta 15.
- Con el ícono corrido, acercarse no servía de mucho.
- Verificamos los tiles sobre Canning:
  - Esri World Imagery tiene imagen real hasta el **19** (tiles de 15 a 17 KB);
  - en el 20 y el 21 devuelve siempre el mismo tile de 2,5 KB, que es el de "sin datos";
  - OSM estándar llega hasta el 19.

### 4. Atraso del dato (secundario, pero existía)

**El equipo de B-Track es bueno:**

- parado con el motor encendido, manda un mensaje cada **30 s**;
- en movimiento, cada **2 a 4 s** (mediana; en los giros, más seguido);
- el mensaje tarda **4 s** en llegar a Wialon (p90: 6 s);
- con el motor apagado, reporta mucho menos: CRN449 llevaba 12 min y LES431, 31 min.

**Nuestro camino sumaba atraso:**

- caché de 25 s en el servidor;
- la pantalla consultaba cada 30 s (Despacho, cada 60 s).

Con 14 consultas seguidas a producción, la posición devuelta tenía entre **11 y 46 s** de antigüedad. Sumando el refresco de la pantalla, el operador podía ver datos de **hasta ~75 s**. Un camión en movimiento a 50 km/h son unos 1.000 m.

El rótulo "Actualizado HH:mm:ss" mostraba la hora de la consulta, no la del dato: el atraso no se notaba.

### 5. Rumbo y velocidad

- La API ya devolvía `rumbo` y `velocidad`, pero la pantalla no usaba el rumbo.
- La velocidad solo se mostraba arriba de 3 km/h.

### 6. Estado (en planta, en obra, detenido): reglas toscas

- **En planta:** a menos de 250 m. Está bien: el patio de Canning está a unos 20 m de la coordenada cargada.
- **En obra:** a menos de 400 m, **solo si la obra está ubicada**. En los últimos 30 días, de 36 obras despachadas solo 13 tienen coordenadas: el resto cae en "detenido" o en "parado fuera de planta".
- **"Hacia la obra" o "Volviendo":** se decidía solo por el reloj (si pasaron más minutos que la ida + 15, "volviendo"). Un camión demorado en ir figuraba "volviendo", y uno que descargó rápido seguía "hacia la obra".

## Qué se cambió

| Archivo | Cambio |
|---|---|
| `components/mapa-base.tsx` | Íconos anclados a la coordenada exacta: el centro del círculo del camión, el cuadradito de la planta y la punta del pin de la obra (`tamano` + `ancla` nuevos en cada ícono). Camión con **flecha de rumbo** cuando se mueve y versión **destacada** con halo que late. Zoom hasta **21** en Mapa y Satélite (`maxNativeZoom: 19` + overzoom). Marcadores **actualizados en el lugar**: un popup abierto ya no se cierra en cada refresco. Props nuevas: `foco` (volar al punto y seguirlo), `onMarcadorClick` y `reencuadre`. |
| `components/logistica-en-vivo.tsx` | Tocar un camión en la lista o en el mapa: vuela a zoom 18, lo resalta (halo y tarjeta con borde), lo sigue en cada refresco y hace scroll hasta la tarjeta. Botón "Ver todos". `?camion=PATENTE` o el id del mixer lo elige al entrar. Cada tarjeta muestra velocidad y rumbo ("42 km/h hacia el NE", con flecha) o "Parado · motor encendido/apagado", la **hora del dato** y "hace 20 s" (en vivo, corregido por el reloj del servidor). El dato se marca en ámbar si tiene más de 2 min con el motor encendido, y aparece el aviso "pocos satélites" con menos de 4. El encabezado dice cuándo se consultó. Refresco cada **15 s**. |
| `lib/wialon.ts` | Caché de 25 s → **8 s**. Devuelve `satelites` (`pos.sc`). |
| `app/api/gps/posiciones/route.ts` | El estado sale de `estadoGps()` y se suma `satelites` a la respuesta. El resto de la respuesta queda igual (Fase 3). |
| `lib/gps-vivo.ts` (nuevo) | Lógica pura: `estadoGps`, `rumboHacia`, `difAngulo`, `rumboTexto`, `antiguedad` y las constantes. **Mejora del estado:** en movimiento, con la obra ubicada, y si la obra y la planta más cercana quedan para lados distintos (más de 90° entre una y otra), manda el rumbo: si apunta a la obra (±60°), "hacia la obra"; si apunta a la planta, "volviendo". En cualquier otro caso, la regla del reloj de antes. |
| `lib/__tests__/gps-vivo.test.mjs` (nuevo, en `test:gps`) | 7 pruebas: rumbos, antigüedad y todos los estados, incluidos los casos donde el rumbo no decide. |
| `components/despacho/columna-camiones.tsx` | "📍 Ver en el mapa" abre `/logistica?camion=PATENTE` con el camión centrado. El menú ⋮ ahora se ve también en modo consulta (solo con "Ver en el mapa"); las acciones de despacho siguen solo para quien despacha. |
| `components/despacho/despacho-tablero.tsx` | GPS cada **30 s** (antes, 60 s). |
| `components/obra-ubicacion.tsx` | Usa los íconos nuevos: el pin de la obra marca con la punta el punto que se guarda. |

### Atraso esperado ahora

- **En movimiento:** el equipo manda cada ~3 s, más 4 s de llegada, más hasta 8 s de caché, más hasta 15 s de refresco. En total, **normalmente 10–25 s**; antes eran 35–75 s.
- **Parado:** lo manda el equipo, cada 30 s.

### Costo en Vercel Hobby

- Una pestaña de En vivo abierta 10 h por día: ~2.400 llamadas por día (~72.000 por mes).
- Despacho: ~36.000 por mes por pestaña.
- Las llamadas a Wialon están limitadas por la caché: como mucho, 1 cada 8 s para todas las pantallas.
- Con 3 o 4 pestañas abiertas sigue muy por debajo del límite de invocaciones del plan. Las consultas solo corren con la pestaña visible.

## Lo que no se puede mejorar de nuestro lado

- **El equipo:** parado manda cada 30 s, y con el motor apagado mucho menos (en ese caso, un dato de 10 o 30 min es normal y no se marca en ámbar). B-Track tampoco tiene un dato más nuevo: muestra el mismo mensaje.
- **El "vivo" de B-Track:** su web recibe los cambios por eventos cada pocos segundos (`avl_evts`). Nosotros consultamos cada 15 s. Bajarlo más multiplica las llamadas en Vercel Hobby y casi no cambia nada parado.
- **El zoom:** las imágenes satelitales de Esri en la zona llegan al zoom 19. El 20 y el 21 son la misma imagen agrandada. Si B-Track usa Google, en algunos lugares puede verse más nítido; para eso habría que usar Google Maps, que es pago y no está en el plan.
- **La precisión del GPS:** el equipo manda 16–17 satélites (unos pocos metros de error). Cuando manda 0 (CRN449, apagado, hoy), la posición es la última que guardó el equipo y puede no ser exacta: la pantalla lo avisa.
- **"En obra":** depende de que la obra esté ubicada (13 de 36 en los últimos 30 días). Mejora sola a medida que la Fase 4a aprende ubicaciones o se cargan en Clientes.

## Pendientes y hallazgos

- **Hecho (21/10, después del merge de `origin/main`):**
  - `/api/gps/posiciones` exige una sesión iniciada (`exigirSesion`) y sin sesión responde 401. Solo la usan Logística › En vivo y Despacho: ningún cron (`vercel.json`) ni Concretus la llama.
  - El vínculo `mixers.gps_unit_id` se sigue guardando del lado del servidor (en el modo prueba local, no).
  - `/api/gps/conectar` (GET de OAuth y POST con token) es solo para gerenciales (`exigirGerencial`). Si no lo es, vuelve a `/logistica?error=…`. `conectado_por` sale de la sesión, no del navegador.
  - Si la sesión se cerró, las pantallas mantienen lo último que había: En vivo muestra el aviso y no la tarjeta de "Conectar el GPS".
- Con las posiciones exactas, los camiones que están juntos en la planta superponen sus etiquetas. Se puede acercar el mapa (ahora hasta 21) o tocar el camión en la lista.

## Verificación

- `npx tsc --noEmit`: los mismos 17 errores viejos que antes, ninguno nuevo y ninguno en los archivos tocados.
- `next build --webpack` con variables de relleno: pasa. Después se borró `.next`.
- `test:despacho`: 27 de 27. `test:gps`: 51 de 51 (incluye las 7 nuevas). `test:sesion`: 21 de 21.
- No se probó en el navegador (regla de esta tarea): **Bautista lo prueba en el preview**.
