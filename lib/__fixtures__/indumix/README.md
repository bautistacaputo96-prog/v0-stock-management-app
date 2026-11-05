# Datos de prueba de Indumix (Canning)

Recortados de las grabaciones HAR de la pantalla de Indumix hechas el **04/11/2026** en la PC de la planta de Canning
(`inicio-quieto`, `seleccion`, `reporte`, `recetas`, `guardar-receta` y `alarma`; el original está en el Drive de
plantacanning). Los usa `lib/__tests__/carga-indumix.test.mjs`. Cada archivo pesa menos de 20 KB.

Qué se recortó: **sin cookies ni encabezados** (solo los cuerpos de los pedidos y las respuestas, y las URL de
escritura). La grabación entera no va al repo.

| Archivo | De qué grabación | Qué tiene |
|---|---|---|
| `pedido-inicio.xml` | inicio-quieto | Cuerpo de un pedido de `hmi.js`, recortado a sus 10 primeras variables |
| `respuesta-inicio-quieto.xml` | inicio-quieto | Las 102 variables de INICIO con la planta quieta (incluidas las "var not found") |
| `respuesta-reporte-slot1.xml` | reporte | Reporte 1: N° 13, normal (receta 15, 8 m³, Observación 0961, AG 083) |
| `respuesta-reporte-slot6.xml` | reporte | Reporte 6: N° 8, todo lo pesado en 0 (arranque cortado) |
| `respuesta-reporte-slot10.xml` | reporte | Reporte 10: N° 5, carga corta, sin cliente, camión ni Observación |
| `reportes-03-11.json` | reporte | Los 10 reportes del 03/11 como `{slot, variables}` (sin los nombres de tolvas `Txt*`, iguales en todos) |
| `respuesta-receta-15.xml` | recetas | Receta 15 «H40-6/20-15 B» completa |
| `receta-15-guardar.json` | guardar-receta | Receta 15 antes y después de pasar el cemento de la rosca 2 a la 1 |
| `respuesta-totales.xml` | alarma (ESTADÍSTICA) | `ConsumoT.*` y `ConsumoP.*` |
| `respuesta-alarma.xml` | alarma | ALARMAS con `Main.Falla_TAC = 1` |
| `escritura.txt` | reporte, recetas, seleccion | Tres GET `writeVal.exe` con su respuesta (sirve también para la fase 2) |
