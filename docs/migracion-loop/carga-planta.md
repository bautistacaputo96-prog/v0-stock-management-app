# Carga de planta desde el sistema (dosificadora Indumix, Canning)

Estado: **propuesta del arquitecto (20/10/2026), con las respuestas de Bautista del 20/10 (dentro del texto) del 21/10 (punto 18) del 21/10 · 2 (punto 19) del 21/10 · 3 (punto 20) y del 21/10 · 4 (punto 21, que manda sobre todo lo anterior).** Programada la etapa simulada (ver "Hecho"); la migración no está aplicada.
Maqueta navegable: [`maqueta-carga-planta.html`](maqueta-carga-planta.html). Se abre con doble clic, no necesita internet y no graba nada.

Leer antes: `README.md` (principios), `fase-3.md` (despacho en tres columnas y formulario Entrega), `fase-0.md` (motor `registrar_despacho`), `fase-0c.md` (permisos y la nota "Dosificadora"), `informe-loop.md` §2.12 (Auditoría de Carga) y las fotos de `capturas-indumix/`.

---

## 1. Objetivo

Que el plantista **cargue el camión desde nuestro sistema**, en la computadora de la planta de Canning, como en Loop:

1. Toca **Cargar** sobre la orden que llegó del despacho y la planta arranca.
2. Ve en vivo los silos, las tolvas, las balanzas y cada material pesándose, y cuándo termina cada ciclo.
3. **Si la receta que tiene la planta no es igual a nuestra fórmula, la carga no arranca.** Salta una alerta, y solo alguien con permiso la resuelve.
4. Cada carga queda guardada con **teórico y real por material**, unida al remito. Con eso, el stock baja con **kilos reales** y aparece la **Auditoría de carga**: carga sin remito, remito sin carga y desviación contra la fórmula.
5. El sistema avisa **cualquier cambio de receta hecho en Indumix**, aunque nadie cargue nada.

Por qué importa, con un dato real de hoy. La fórmula **H30-612-15 B (CAN)** dice CPC 40 = **330** kg/m³ y Agua = **168** L/m³, igual que la planilla Grow v8. La receta 13 de Indumix, con el mismo nombre, tiene CP 40 = **350** y Agua = **110**. El 20/10 salieron 12 camiones de 3 m³ con esa fórmula para TOP · Santa Clara (remitos 874 a 885). Si se cargaron con la receta 13, cada camión llevó unos 60 kg más de cemento de lo que descontó el stock: **unos 720 kg en el día**, y 58 L/m³ menos de agua que la fórmula del laboratorio (relación agua/cemento 0,31 contra 0,51). Hoy nadie se entera.

**Regla de Bautista (20/10): la receta que vale es siempre la de nuestro sistema; Indumix se adapta.** El agua tiene un tratamiento aparte, porque cambiarla es un cambio grande de dosificación y lo tiene que confirmar la ingeniería de dosificación (Grow) (6.5.1).

## 2. Alcance

**Entra (en tres etapas, punto 4):**
1. **Puente local:** un programa chico en la PC de la planta que habla con Indumix y con nuestro sistema. Incluye un **simulador** para programar sin la planta.
2. **Pantalla Carga** (`/carga`): cola de órdenes, la planta en vivo, controles (Cargar, Parar, Suspender y Bocina), el control de receta y el reporte de cada carga.
3. **Control de recetas:** lectura de las 20 recetas, comparación con nuestras fórmulas, bloqueo y alertas.
4. **Mapa de salidas:** qué material de nuestro sistema hay en cada tolva, rosca, tanque de aditivo y agua. La Tolva 1 cambia entre 6/12 y 6/20.
5. **Registro de cargas** (teórico, real y humedad por material) y su unión con el despacho.
6. **Stock con kilos reales.**
7. **Auditoría de carga**, al estilo de Loop.
8. Permisos nuevos y alertas (pantalla y mail).

**Fuera de alcance:**
- **Escribir recetas en Indumix.** El sistema las lee y las compara, pero no las guarda en la planta. Si algún día se hace, es una decisión aparte con el OK escrito del proveedor (punto 9.3).
- Tocar parámetros, secuencias, calibraciones o alarmas de Indumix.
- Cualquier orden que salga de la nube o de otro dispositivo (punto 3.2).
- **Hudson**, que tiene otro programa. La interfaz del puente queda preparada para sumar otro adaptador después.
- La humedad automática (sondas). La humedad la sigue tipeando el plantista en Indumix: el sistema la lee y la compara.
- Cambiar el remito, la impresión, las probetas o el formulario Entrega más allá del botón "Enviar a cargar" (punto 5.2).

## 3. Arquitectura

### 3.1 Las tres partes

```
 NUBE (Vercel + Supabase)                       PLANTA CANNING · red local 192.168.0.x
 ┌─────────────────────────────┐                ┌────────────────────────────────────────────────────┐
 │ www.produccionrebucret.com  │                │  PC de la planta (la única habilitada)             │
 │                             │   HTTPS        │  ┌──────────────────────┐                          │
 │  /plantista  (Fase 3)       │◄──────────────►│  │ Navegador            │                          │
 │  /carga      (pantalla)     │  (la página)   │  │ www…/carga           │                          │
 │  /api/carga/*               │                │  └─────────┬────────────┘                          │
 │  tablas cargas_*, recetas_* │                │            │ http://127.0.0.1:8787 (solo esta PC) │
 │                             │   HTTPS        │  ┌─────────▼────────────┐                          │
 │  - entrega la orden         │◄───────────────┤  │ PUENTE (servicio)    │  sale a internet;        │
 │  - recibe recetas, eventos, │  (solo sale    │  │ - adaptador Indumix  │  nadie entra desde       │
 │    reportes y latidos       │   del puente)  │  │ - simulador          │  afuera                  │
 │  - NO puede arrancar nada   │                │  │ - cola local         │                          │
 └─────────────────────────────┘                │  └─────────┬────────────┘                          │
                                                │            │ red local (protocolo a averiguar:     │
                                                │            │ HTTP de la pantalla web, Modbus TCP,  │
                                                │            │ S7, OPC UA…)                          │
                                                │  ┌─────────▼────────────┐                          │
                                                │  │ Indumix 192.168.0.10 │──► PLC ──► balanzas,     │
                                                │  │ (pantalla web)       │    tolvas, roscas, agua, │
                                                │  └──────────────────────┘    seguridades propias   │
                                                └────────────────────────────────────────────────────┘
```

| Parte | Qué hace | Qué no hace nunca |
|---|---|---|
| **Nube** (nuestro sistema) | Guarda las órdenes de carga, fórmulas, mapa de salidas, recetas leídas, cargas y alertas. Arma la auditoría y descuenta el stock. Firma el permiso para arrancar una carga puntual (3.2). | Mandar una orden de arranque, de parada ni ninguna otra a la planta. No hay ningún camino de la nube hacia el puente. |
| **Puente** (PC de la planta) | Lee recetas, estado, pesos, alarmas y reportes de Indumix. Escribe la orden de carga y aprieta Cargar, Parar, Suspender y Bocina, **solo si se lo pide la pantalla abierta en esa misma PC**. Sube a la nube lo que lee. | Escuchar en la red: solo atiende `127.0.0.1`. Arrancar solo, reintentar un arranque o saltear algo que el PLC rechazó. Guardar recetas en Indumix. |
| **Indumix + PLC** | Lo de siempre: pesa, dosifica, corrige por humedad, compensa entre ciclos y aplica sus seguridades. | (Sin cambios.) Sus seguridades siguen mandando. |

### 3.2 Reglas de seguridad (acordadas, no negociables)

1. **El arranque sale solo de la PC de la planta.** La pantalla habla con el puente en `http://127.0.0.1:8787`. El puente rechaza todo lo que no venga de esa misma PC y de la página `https://www.produccionrebucret.com` (control de `Origin`).
2. **La nube entrega la orden y recibe resultados; no manda arrancar.** El puente nunca abre un puerto hacia afuera: solo hace pedidos salientes por HTTPS.
3. **Permiso de arranque firmado, de un solo uso.** Al tocar Cargar, la página le pide a la nube un *permiso de arranque* para esa carga: la nube controla quién es la persona (`carga.cargar`), que la carga esté "lista" y que el control de receta haya dado bien. Devuelve un permiso firmado que vale **60 segundos y una sola vez**. El puente lo verifica con el secreto que recibió al darse de alta (punto 8.1). Sin permiso válido, el puente no arranca, aunque alguien le pegue directo a `127.0.0.1`.
4. **El puente usa la orden de la nube, no la de la página.** Con el id de la carga, el puente baja la orden de la nube con su propia credencial: receta, m³, cliente, camión y remito. Así una página adulterada no puede mandar otros valores.
5. **Doble control de receta.** Lo controla la nube al preparar la orden, y el puente de nuevo **inmediatamente antes de arrancar**, leyendo la receta en ese momento. Si alguien la cambió en el medio, no arranca.
6. **El plantista confirma que el camión está abajo de la planta**: con la patente grande en pantalla y manteniendo apretado el botón un segundo, para que no salga de un toque sin querer. Antes puede tocar **Bocina**.
7. **PARAR siempre visible, grande y sin pedir permiso** a nadie que tenga la pantalla abierta en la PC de la planta. Si el puente no contesta en 1 segundo, la pantalla dice: **"No hay conexión con la planta: usá el PARAR de Indumix o la parada de emergencia"**. El PARAR de Indumix y el hongo de emergencia siguen siendo los principales: el nuestro es uno más.
8. **No se saltea ninguna seguridad del PLC.** Si el PLC no arranca, la pantalla muestra lo que dice Indumix y no se reintenta solo. Las alarmas de Indumix se ven en la pantalla tal cual.
9. **Si se cae la conexión en medio de un ciclo, la planta hace lo que hace hoy** (lo decide el PLC). Al volver, la pantalla muestra el estado real y **nunca vuelve a arrancar sola**.
10. **Pruebas en vacío con Bautista presente** antes del primer uso real, con el proveedor de Indumix al tanto (punto 13).

Desde cualquier otro dispositivo (celular de Bautista, la oficina), `/carga` se ve completa, en vivo con los datos que el puente sube a la nube, cada 5 segundos. Se pueden resolver alertas, pero **no aparecen Cargar ni Parar**: "Las cargas se accionan solo desde la computadora de la planta".

### 3.3 Detalles técnicos que el obrero tiene que respetar

- **Puente:** Node.js (el mismo lenguaje del sistema), en una carpeta nueva del repo, `puente-carga/`, sin dependencias nuevas en la app web. Se instala como servicio de Windows que arranca con la PC. Guarda su cola en un archivo local: si se corta internet, no se pierde nada y lo sube al volver.
- **Página a puente:** `fetch` a `http://127.0.0.1:8787` con CORS limitado a nuestro dominio y el encabezado `Access-Control-Allow-Private-Network: true`. Chrome pide la primera vez el permiso de **"acceso a la red local"**: se da una sola vez en esa PC. El estado en vivo va por *Server-Sent Events*, unas 4 veces por segundo.
- **Puente a nube:** rutas `app/api/carga/*` con la credencial del puesto (`Authorization: Bearer`, guardada con hash en `puestos_carga`). Solo sirven para leer la configuración y las órdenes del propio puesto, y para subir recetas, eventos, reportes y latidos.
- **Respaldo si Chrome bloquea el acceso a `127.0.0.1`:** el puente sirve la misma página en `http://127.0.0.1:8787/carga`, que habla con la nube por HTTPS. Las reglas de seguridad no cambian.

## 4. Etapas de puesta en marcha (recomendación)

| Etapa | Qué hace el sistema | Qué escribe en Indumix | Riesgo | Qué hace falta |
|---|---|---|---|---|
| **A · Solo lectura** | Lee las 20 recetas cada 5 min y avisa los cambios. Compara con las fórmulas. Lee cada carga y su reporte, la une con el remito y arma la auditoría. Muestra la planta en vivo. El despacho sigue como hoy. | **Nada** | Muy bajo | HAR del jueves y el OK del proveedor para leer |
| **B · Orden preparada** | Además, escribe en Indumix la selección de carga: receta, m³, cliente, camión y remito en "Observación". El plantista aprieta CARGAR **en Indumix**. El bloqueo por receta ya actúa, porque el sistema no prepara la orden. | La selección de carga | Bajo | Saber cómo se escribe la selección y verificarla leyéndola de vuelta |
| **C · Cargar desde el sistema** | Además, Cargar, Parar, Suspender y Bocina desde nuestra pantalla. | Los botones | Medio | OK escrito del proveedor y pruebas en vacío con Bautista |

**Recomendación: A → B → C, con 1 o 2 semanas en cada una.** La etapa A ya da casi todo lo que pide Bautista en el punto 2: los avisos de cambios de receta, el control de las 20 recetas, la auditoría y los kilos reales, sin tocar la planta. Además, sirve para **corregir todas las diferencias de receta antes de prender el bloqueo**. Si el bloqueo se prendiera hoy, la receta 13 frenaría todos los camiones de TOP.

La etapa del puesto se guarda en `puestos_carga.etapa` y solo la cambia alguien con `carga.editar`.

## 5. Flujo de una carga, paso a paso (etapa C)

> **Reemplazado en parte por el punto 18 (21/10):** el despacho se graba **antes** de cargar ("Despachar y cargar"), el panel de carga vive dentro de la pantalla de despacho y hace falta la nota de pedido de Zomatik. Valen 5.3 a 5.5; 5.2, 5.6 y 5.7 quedan como dice 18.3 y 18.4.

### 5.1 Día anterior: programación (fase 2)
- Al confirmar el día, el sistema controla que cada fórmula programada para Canning **tenga receta en la planta y coincida**. Si no: "Para mañana: **H30-GUN** no tiene receta en la planta (hay libres la 19 y la 20)", o "**H30-612-15 B**: la receta 13 no coincide". El aviso aparece en Programación y en Alertas, y llega por mail a quienes tienen `formulas.editar`. Así se arregla el día anterior y no con el camión esperando.

### 5.2 Despacho (fase 3, formulario Entrega)
- Si la planta del despacho tiene un puesto en etapa B o C, el botón principal de Entrega pasa a ser **"Enviar a cargar"** (con "Despachar sin cargar" en el menú, para el despacho de prueba, el manual o cuando la planta está caída).
- "Enviar a cargar" valida lo mismo que Despachar (`validarEntrega`) y crea la carga en estado `pendiente`, con todo lo del formulario guardado (`cargas.payload_despacho`): viaje, camión, chofer, m³, remito con su tipo R/X, agua, fibra y muestra. **Todavía no crea el despacho ni toca el stock.**
- En Camiones, la tarjeta muestra "En cola de carga · Remito 886".

### 5.3 Pantalla Carga, en la PC de la planta
1. A la izquierda, la **cola**: las cargas pendientes de la planta en orden de llegada, con cliente, obra, camión, remito, fórmula y m³. La primera queda elegida.
2. El sistema controla que se pueda cargar (lista de chequeo a la vista):
   - el puente está conectado e Indumix responde;
   - la fórmula tiene receta asignada en la planta;
   - **la receta coincide con la fórmula, dentro de la tolerancia (punto 6)**;
   - las tolvas tienen los materiales que pide la fórmula (Tolva 1: 6/12 o 6/20);
   - no hay alarmas activas en Indumix;
   - la planta no está en otra carga;
   - los m³ entran en la planta: ciclos = m³ ÷ capacidad del ciclo (1,5 m³ en Canning, a confirmar), redondeado para arriba.
3. Si algo falla, la orden queda **bloqueada** con el motivo en palabras: "La receta 13 de la planta no coincide con la fórmula H30-612-15 B: cemento 350 contra 330 kg/m³, agua 110 contra 168 L/m³". Se ve **quién puede resolverlo** y ya se les avisó. El plantista puede pasar a otra orden de la cola.
4. Si todo está bien, se habilita **Cargar**.

### 5.4 Cargar
1. El plantista toca **Bocina**, si hace falta, y después **Cargar**.
2. Se abre la confirmación: "**¿El camión AG083GT está abajo de la planta?**". Botón **"Sí, está abajo · mantener apretado"**.
3. La página pide el permiso de arranque a la nube (3.2.3) y se lo pasa al puente.
4. Los pasos que hace el puente, a la vista:
   1. baja la orden de la nube;
   2. escribe la selección en Indumix: receta, m³, secuencia, cliente, camión y, en Observación, el remito ("0886");
   3. **la lee de vuelta** y la compara con lo que escribió;
   4. lee la receta en ese momento y la compara otra vez;
   5. aprieta CARGAR.

   Cualquier diferencia corta ahí y no arranca nada.
5. La carga pasa a `en_curso`, con la hora del puente (punto 10).

### 5.5 En curso
- La pantalla muestra en vivo el material de cada tolva, rosca, aditivo y agua, con **Objetivo** y **Real**. También la humedad que usa Indumix, las balanzas (vacía, pesando o descargando), el ciclo ("Ciclo 1 de 2 · 1,5 m³"), el tiempo del ciclo y el total, y el trompo llenándose.
- **Suspender** y **Reanudar** son los de Indumix. **PARAR** está siempre a la vista.
- Si aparece una alarma de Indumix, se muestra arriba en rojo con su texto, y no se hace nada más que mostrarla.

### 5.6 Fin, reporte y despacho
1. Cuando Indumix termina, el puente lee el **reporte** de esa carga y lo cruza con lo que vio en vivo. Lo sube con su número de carga (el "Contador carga" de Indumix) para no duplicarlo.
2. La nube hace todo en una función, `cerrar_carga`:
   - guarda `cargas_materiales` (receta, teórico, teórico corregido por humedad, real y humedad por material);
   - llama a **`registrar_despacho`** con lo guardado en 5.2 y con los **materiales reales** (punto 7.3). El despacho queda con remito, probetas, pedido, viaje y camión en ruta, como siempre, y **el stock baja con los kilos reales**;
   - calcula los desvíos y deja la carga en la auditoría.
3. En pantalla aparece el **reporte**: material por material, la fórmula, la receta de la planta, el teórico, la humedad, el real y la diferencia. Hay un botón **Imprimir remito** (el de la fase 3) y el aviso "Despacho registrado · Remito 886 · stock con kilos reales".

### 5.7 Si algo sale distinto
| Caso | Qué pasa |
|---|---|
| **PARAR en medio** | La carga queda `parada` con lo pesado hasta ese momento. El plantista elige: "Se tiró (no sale)" (descuenta lo real como pérdida, `stock_movements` con `reference_type='carga'`) o "Sale igual con lo cargado" (despacho con los m³ reales, que pide motivo). Las dos quedan en la auditoría. |
| **Puente o internet caídos** | Se trabaja como hoy: Indumix a mano y "Despachar sin cargar" (consumo teórico). Al volver, el puente lee los reportes que haya (Indumix guarda **solo las últimas 10**), y la auditoría los une a los remitos. El stock se corrige con la diferencia (7.3). |
| **Alguien carga directo desde Indumix** con el puente andando | El puente ve que cambió el contador de Indumix sin una orden nuestra. Se crea una carga con origen `indumix` y la alerta "Carga hecha desde Indumix, sin pasar por el sistema". Queda "Sin remito" hasta que se una con uno. **Nuestro bloqueo no puede impedir esto** (ver riesgos): solo lo detecta. |
| **El PLC no arranca** | Se muestra el motivo que da Indumix. La carga vuelve a `lista` y no se reintenta sola. |
| **Se cancela en el despacho** | Una carga `pendiente`, `bloqueada` o `lista` se cancela con motivo. Una carga en curso, no: primero PARAR. |

## 6. Control de recetas

### 6.1 Qué se compara
Para cada salida de la planta (Tolva 1–4, Rosca 1–2, Aditivo 1–2 y Agua), se compara **por m³**:

- el valor de la receta de Indumix, pasado a nuestra unidad: el aditivo de gramos a kg, y el agua de litros a kg (1 a 1);
- contra la cantidad de la fórmula del **material que hoy tiene esa salida**, según el mapa de salidas (6.3).

Reglas:
- Se comparan solo los materiales que **dosifica la planta**: áridos, cemento, agua y aditivos de planta (`materials.tipo`). Quedan afuera el **aditivo de obra** (Sikament 33S, Superfluidificante) y la **fibra**, que no pasan por Indumix.
- Si la fórmula lleva un material que no está en ninguna salida (por ejemplo, el Espumígeno de los RDC), **no coincide**, salvo que el material esté marcado "se agrega a mano" (`materials.dosifica_planta = false`, pregunta 7).
- Si la receta pesa algo (> 0) en una salida que la fórmula no usa, **no coincide**.
- **El nombre no se compara**: una receta puede llamarse distinto. El nombre sirve solo para sugerir la asociación.
- **El agua se compara sobre la receta base (L/m³), nunca contra el agua que pesa la carga.**
  - Indumix descuenta del agua la humedad de los áridos. En el reporte del remito 885, la teórica fue 330 L y la real 268 L: la diferencia, unos 62 L, es el 3 % de humedad de los 2.082 kg de arena.
  - Por eso la comparación de recetas es **110 contra 168 L/m³**, y el agua real de cada carga se controla en la auditoría contra el teórico **ya descontada la humedad** (6.6).

**Regla de fondo (Bautista, 20/10): la que vale es siempre la fórmula de nuestro sistema.** Indumix se adapta a ella, y no al revés. El problema que esto resuelve es justamente "me cambian las cosas y no tengo control".

### 6.2 Tolerancias (propuesta)
Para el **control de receta**, que debería dar igual salvo redondeos, la tolerancia es la mayor de las dos columnas:

| Material | Tolerancia relativa | Mínimo absoluto | Ejemplo H30-612-15 B |
|---|---|---|---|
| Cemento | ±1 % | 2 kg/m³ | 350 contra 330 = +6,1 % → **no coincide** |
| Agua (receta base) | ±2 % | 3 L/m³ | 110 contra 168 = −34,5 % → **no coincide · agua** (tiene su propio tratamiento, 6.5.1) |
| Áridos (cada uno) | ±1 % | 5 kg/m³ | 950 / 231 / 694 iguales → coincide |
| Aditivo de planta | ±2 % | 20 g/m³ | 2.800 g contra 2.805 g = −0,2 % → coincide |

Para la **auditoría de cada carga** (lo pesado de verdad contra lo teórico), las tolerancias son las usuales de pesaje (ASTM C94; la IRAM 1666 va en la misma línea; que lo confirme el laboratorio): **cemento ±1 %, áridos ±2 %, agua ±3 %** (incluye el error de la corrección por humedad), **aditivos ±3 %**. En la carga real de la foto (remito 885) todos los materiales quedan adentro.

Las tolerancias se guardan por puesto (`puestos_carga.tolerancias`, jsonb) y las cambia solo alguien con `carga.editar`.

### 6.3 Mapa de salidas (qué material hay en cada tolva)
Tabla `puesto_salidas`: una fila por salida, con el material de nuestro sistema, la unidad de Indumix y desde cuándo vale.

| Salida | Nombre en Indumix | Material del sistema (hoy) | Unidad Indumix | Cambia seguido |
|---|---|---|---|---|
| Tolva 1 | "PIE 6/20 O 6/12" | Piedra Partida 6/12 **o** 6/20 | kg | **Sí**: se elige qué hay cargado |
| Tolva 2 | "piedra 06" | Arena Trituración 0/6 | kg | No |
| Tolva 3 | "ARENA" | Arena Fina | kg | No |
| Tolva 4 | "PIE 6/20" | Piedra Partida 6/20 | kg | No |
| Rosca 1 y 2 | "CP 40" | CPC 40 | kg | No |
| Aditivo 1 | "PLASTIF" | Sikament 90E | g | No |
| Aditivo 2 | (vacío) | — | g | — |
| Agua | "Agua" | Agua | L | No |

- **Tolva 1:** en la pantalla de carga, la tolva muestra "**hoy: Piedra 6/12** · Cambiar". El plantista (`carga.cargar`) la cambia cuando carga la tolva con la otra piedra. Queda en Actividad y en el historial (`vigente_desde` / `vigente_hasta`), y vale para el stock de cada carga. Si la fórmula pide 6/12 y la Tolva 1 tiene 6/20: "**La fórmula pide Piedra 6/12 y la Tolva 1 tiene Piedra 6/20**", y se bloquea.
- **El resto del mapa** (qué material, qué unidad) lo configura alguien con `carga.editar`. El jueves hay que confirmar si las fórmulas de 6/20 usan la Tolva 1 o la 4, y dónde va la 10/30 del pavimento.

### 6.4 Lectura de las 20 recetas y aviso de cambios
- El puente lee **las 20 recetas cada 5 minutos**, además de al arrancar, antes de cada carga y cuando se toca "Leer ahora". Calcula una huella (hash) de cada una.
- Si una huella cambió, guarda la versión nueva en `recetas_planta` (**nunca se pisa la anterior**: queda la historia completa) y crea la alerta **"La receta 7 cambió en Indumix entre 10:05 y 10:10: CP 40 310 → 320"**.
- Indumix no dice quién la cambió. El sistema da la ventana de tiempo y quién tenía abierta la pantalla de carga en esa PC.
- Si la receta cambiada está asociada a una fórmula, se recompara: si ahora no coincide, las cargas con esa fórmula se bloquean. Si ahora sí coincide, se desbloquean y la alerta se cierra sola ("La receta 13 ahora coincide · leída 10:52").
- Una receta que aparece por primera vez, o una que se vació, también avisa.

### 6.5 Cuando no coincide: quién lo resuelve y cómo
**La carga no se acciona.** Se crea **una** alerta abierta por receta y fórmula; no se repite en cada lectura. Avisa:
- en la pantalla de carga (franja roja) y en la campana del sistema;
- por **mail** (Resend, como `app/api/alertas/stock-cero`) a quienes tienen `formulas.editar`. Hoy son Bautista, Fernando y Juan.

**Resolver** lo ve solo quien tiene `formulas.editar`, desde cualquier dispositivo, porque resolver no acciona la planta. **El camino normal es el 1**: la planta se corrige para que quede igual al sistema.

| Opción | Qué hace | Cuándo |
|---|---|---|
| **1. Corregir la receta de la planta (camino normal)** | Genera la **ficha para cargar en Indumix**: "RECETAS › 13 · CP 40 (Rosca 1): 350 → **330** · GUARDAR". Se puede imprimir o mandar por WhatsApp a mano. La carga sigue bloqueada hasta que el puente lea la receta corregida; ahí se desbloquea sola y la alerta se cierra con "corregida en la planta". | Siempre, salvo que se elija otra cosa con motivo. |
| **2. Autorizar solo esta carga** | La carga se hace con la receta de la planta tal cual. Pide motivo, vale **una sola carga y hasta el fin del día**, y la carga queda marcada "autorizada con receta distinta" en la auditoría. El stock baja con lo real. **No sirve para la Tolva 1 equivocada**: eso se corrige en la tolva. | Camión esperando y la ficha ya pedida. |
| **3. Corregir nuestra fórmula (excepción)** | Abre la edición de la fórmula con los valores de la planta precargados (solo los distintos). Pide `formulas.editar`, motivo y la confirmación "**El laboratorio/Grow cambió la dosificación**". Vale **para las cargas que vienen**, no cambia despachos anteriores, y queda resaltado en Actividad. | Solo si la dosificación de la planta es la nueva oficial. |

Quién resuelve, cuándo, con qué opción y por qué queda en la alerta y en Actividad.

#### 6.5.1 El agua tiene su propio tratamiento
Pasar de **110 a 168 L/m³** de agua en la H30-612-15 B no es un ajuste de redondeo: es un **cambio grande de la relación agua/cemento**.

| | Agua | Cemento | Agua/cemento |
|---|---|---|---|
| Sistema (Grow v8) | 168 L/m³ | 330 kg/m³ | **0,51** |
| Indumix receta 13 | 110 L/m³ | 350 kg/m³ | **0,31** |

Puede que en la planta se cargue menos agua a propósito y el resto se complete en el camión o en obra. Si se "sincroniza" a ciegas, el hormigón puede salir mucho más fluido de lo que el plantista está acostumbrado. Por eso, cuando la diferencia es **solo de agua** (o el agua es una de las diferencias):

1. **Sigue bloqueando**, con un aviso propio en ámbar ("**Agua distinta**"), separado del de cemento y áridos. Muestra la relación agua/cemento de las dos recetas.
2. **La opción 1 (corregir la planta) para el agua pide una confirmación más:** "**La ingeniería de dosificación (Grow) confirmó el agua de la fórmula**", con quién confirmó y la fecha. Sin esa casilla, la ficha para Indumix lleva el cemento, los áridos y el aditivo, pero **no el agua**.
3. **Mientras se consulta a Grow**, quien tiene `formulas.editar` puede marcar la alerta como "**Agua en consulta con Grow**", con vencimiento (7 días como máximo). Durante ese plazo:
   - las cargas de esa fórmula **no se bloquean por el agua**: solo muestran el aviso ámbar y quedan marcadas en la auditoría;
   - **sí se siguen bloqueando por cemento, áridos o aditivo**.

   Si vence sin respuesta, vuelve a bloquear y se avisa de nuevo.
4. La tolerancia del agua (±2 %, mínimo 3 L/m³) no se agranda: una diferencia de 58 L/m³ tiene que verse siempre.

Para la H30-612-15 B esto quiere decir:
- el **cemento 350 → 330** se corrige ya en la planta (camino normal);
- el **agua 110 → 168** queda "en consulta con Grow", sin frenar los camiones de TOP pero a la vista, hasta que Grow confirme.

### 6.6 Humedad
- Indumix usa la humedad que tipea el plantista (H% por tolva) para corregir: **pesa más árido húmedo y descuenta esa agua del agua de la receta.** Las fotos lo confirman:
  - Arena: 2.082 kg × 1,03 = 2.144,5;
  - agua: 330 − 62,5 = **268 L reales**, exactamente lo del reporte.
- Nuestro sistema guarda la humedad del acopio (Arena Fina de Canning: **6 %** hoy, contra el **3 %** de Indumix).
- **Si la diferencia supera 1,5 puntos, se avisa** ("Humedad Arena Fina: Indumix 3 % · acopio 6 %, medida 07:30"), **pero no se bloquea**: la humedad cambia durante el día y la mide la planta.
- En el stock se usa la humedad de Indumix de esa carga (es la que se usó para pesar).

### 6.7 Compensación entre ciclos (lo que hace Indumix, confirmado con las fotos)
El objetivo del último ciclo es el **total teórico menos lo real del ciclo anterior**.
- Cemento: teórico 1.050 kg; el ciclo 1 pesó 528, así que el objetivo del ciclo 2 fue 1.050 − 528 = **521,9** (es el "521.925" de la foto).
- Tolva 1: 2.850 − 1.438,9 = **1.411,13**.

El simulador lo reproduce, y la auditoría compara **por carga** (no por ciclo), igual que el reporte de Indumix.

## 7. El límite de 20 recetas

### 7.1 Situación
- Indumix guarda **20 recetas** ("Máximo 20 recetas").
- Canning tiene **34 fórmulas**: 25 se usaron en los últimos 6 meses y 16 más de una vez por mes. H30-620-10 C sola tiene 448 despachos de 1.000.

### 7.2 Propuesta
- **Mapa de recetas** (`puesto_recetas`): cada número del 1 al 20 está asociado a una fórmula o está libre. Una fórmula tiene como mucho un número por puesto.
- **1 a 16, fijas**: las más usadas. El sistema propone la lista según los despachos de los últimos 6 meses, y se revisa cada 3 meses.
- **17 a 20, rotativas**: para las que se usan poco (H30-GUN, H21-612-15 B, H30-612-10 C, PELQUE…). Las carga a mano en Indumix alguien con `formulas.editar`, con la **ficha para cargar en Indumix** (6.5, opción 2). El puente la lee y confirma que coincide.
- **Asociación automática:** al leer las recetas, el sistema sugiere la fórmula por nombre ("H30-612-15 B" ↔ "H30-612-15 B (CAN)") y por valores. La asociación se confirma a mano (`carga.editar`).
- **Aviso anticipado** (5.1): un pedido de mañana con una fórmula sin número avisa hoy, y propone el número rotativo libre que se usó hace más tiempo.
- **Más adelante (etapa D, solo con el OK escrito del proveedor):** que el puente escriba la receta en un número rotativo antes de cada carga. Así desaparece el problema de las 20 y el de las recetas distintas, como hace Loop al "enviar la línea al batch".

## 8. Modelo de datos (propuesto, **no se aplica nada**)

Una migración nueva, `supabase/migrations/2026MMDDHHMM_carga_planta.sql`. **Solo agrega tablas y columnas**: ningún dato existente cambia. Antes de aplicarla se avisa a Bautista, como siempre.

### 8.1 Tablas nuevas

**`puestos_carga`**: una por dosificadora.
`id`, `plant_id`, `nombre` ("Canning · Indumix"), `sistema` ('indumix' | 'simulador'), `etapa` ('lectura' | 'orden' | 'arranque' | 'apagado'), `max_recetas` (20), `m3_max_ciclo` (1,5), `tolerancias` jsonb (6.2), `usa_kilos_reales` (false; 8.3), `credencial_hash`, `secreto_arranque_cifrado`, `ultimo_latido_at`, `version_puente`, `deriva_reloj_s` (diferencia entre la PC y la nube), `activo`, `created_at`.
Alta: el puente muestra un código de 6 dígitos al instalarlo; alguien con `carga.editar` lo tipea en `/carga › Configuración` y ahí se generan la credencial y el secreto.

**`puesto_salidas`**: mapa de salidas, con historia.
`id`, `puesto_id`, `salida` ('arido_1'…'arido_4', 'cemento_1', 'cemento_2', 'aditivo_1', 'aditivo_2', 'agua'), `nombre_planta`, `material_id` (nulo = vacía), `unidad_planta` ('kg' | 'g' | 'L'), `factor_a_unidad_sistema` (g→kg = 0,001), `vigente_desde`, `vigente_hasta` (nulo = la de hoy), `cambiado_por`.
Índice único: una sola vigente por `(puesto_id, salida)`.

**`recetas_planta`**: cada versión leída de cada receta de Indumix (historia completa, nunca se pisa).
`id`, `puesto_id`, `numero` (1–20), `nombre`, `habilitada`, `valores` jsonb (`{"arido_1":{"valor":950,"orden":2}, …, "agua":{"valor":110}}`), `huella`, `primera_lectura_at`, `ultima_lectura_at`.
Índice único `(puesto_id, numero, huella)`. "La receta actual" es la de `ultima_lectura_at` más reciente por número (vista `recetas_planta_actual`).

**`puesto_recetas`**: qué fórmula va en cada número.
`puesto_id`, `numero`, `formula_id` (nulo = libre), `tipo` ('fija' | 'rotativa'), `asignada_por`, `asignada_at`. PK `(puesto_id, numero)`, y único `(puesto_id, formula_id)`.

**`cargas`**: una por carga, la pida el sistema o se haga desde Indumix.
`id`, `puesto_id`, `plant_id`, `estado` ('pendiente' | 'bloqueada' | 'lista' | 'preparada' | 'en_curso' | 'suspendida' | 'terminada' | 'parada' | 'cancelada' | 'leida'), `origen` ('sistema' | 'indumix'), `viaje_id`, `pedido_id`, `dispatch_id` (único, nulo hasta cerrar), `payload_despacho` jsonb (lo de Entrega), `remito`, `remito_tipo`, `mixer_id`, `patente_planta` (lo que dice Indumix, "AG 083 GT"), `cliente_planta`, `observacion_planta`, `formula_id`, `receta_numero`, `receta_planta_id` (la versión con la que se cargó), `m3`, `ciclos`, `m3_ciclo`, `bloqueo` jsonb (motivos), `autorizacion` jsonb (quién, motivo, alerta), `camion_abajo_por`, `camion_abajo_at`, `arrancada_por`, `inicio_at` y `fin_at` (**hora del puente**), `inicio_plc` y `fin_plc` (texto crudo del PLC), `contador_planta` (el "Contador carga" de Indumix), `estado_auditoria` ('ok' | 'con_desvios' | 'revisada'), `revisada_por`, `revisada_at`, `nota`, `created_by`, `created_at`.
`dia_planta` (el día de Indumix, punto 10). Índice único `(puesto_id, dia_planta, contador_planta, inicio_plc)`: el mismo reporte leído dos veces no duplica la carga.

**`cargas_materiales`**: teórico y real por material.
`id`, `carga_id`, `ciclo` (0 = total de la carga; 1…N = cada ciclo, si el puente lo vio en vivo), `salida`, `material_id`, `receta_por_m3` (de la planta), `formula_por_m3` (la nuestra), `teorico` (receta × m³, seco), `humedad_pct`, `teorico_corregido` (húmedo; en el agua, descontada la de los áridos), `real`, `extra` (agua extra), `unidad`.

**`cargas_eventos`**: la línea de tiempo de la carga.
`id`, `carga_id` (puede ser nulo si es del puesto), `puesto_id`, `at` (hora del puente), `tipo` ('orden_escrita' | 'orden_verificada' | 'receta_verificada' | 'arranque' | 'ciclo_inicio' | 'ciclo_fin' | 'suspender' | 'reanudar' | 'parar' | 'bocina' | 'alarma' | 'alarma_fin' | 'fin' | 'reporte' | 'error' | 'sin_conexion'), `detalle` jsonb, `usuario`.

**`alertas_carga`**:
`id`, `puesto_id`, `tipo` ('receta_no_coincide' | 'receta_cambiada' | 'receta_nueva' | 'receta_faltante' | 'tolva_material' | 'humedad' | 'carga_desde_indumix' | 'puente_caido' | 'reloj'), `carga_id`, `formula_id`, `receta_numero`, `receta_planta_id`, `detalle` jsonb, `estado` ('abierta' | 'esperando_planta' | 'agua_en_consulta' | 'resuelta' | 'cerrada_sola'), `resolucion` ('corregir_planta' | 'autorizar_una_vez' | 'corregir_formula' | 'agua_en_consulta' | 'descartar'), `agua_confirmada_por` (quién de Grow y cuándo), `vence_at` (para "agua en consulta"), `resuelta_por`, `resuelta_at`, `motivo`, `avisado_a` jsonb, `created_at`.

### 8.2 Cambios en tablas que existen
| Cambio | Para qué | Qué pasa con lo cargado |
|---|---|---|
| `materials.dosifica_planta boolean default true` | Separar lo que pasa por Indumix de lo que se agrega a mano. Se pone en `false` para el aditivo de obra, la fibra y lo que diga Bautista (pregunta 7). | Todos quedan en `true`, y la migración pone `false` en los de `tipo` 'aditivo_obra' y 'fibra'. Nada más cambia. |
| `registrar_despacho`: acepta `materiales_reales` (opcional) en el jsonb | Que el despacho que sale de una carga descuente los kilos reales (7.3). | Sin ese campo hace exactamente lo de hoy. Se parte de `pg_get_functiondef` de producción **después** de que se publique la fase 3, que también la toca. |
| `stock_movements.reference_type = 'carga'` (valor nuevo, sin cambio de esquema) | Ajustes de real contra teórico (etapa A) y las cargas que se tiraron. | — |

### 8.3 Stock con kilos reales

> **Reemplazado por 18.5:** como el despacho se graba antes, en todas las etapas el stock se corrige con **un ajuste por material** (real − teórico). `registrar_despacho` no necesita `materiales_reales`.
- **Etapas B y C:** `cerrar_carga` llama a `registrar_despacho` con `materiales_reales` = lo real de cada material, en kg húmedos, con la humedad de Indumix (el seco sale como hoy: `dry_quantity`, `wet_quantity`, `humidity_at_dispatch`). Hay **un solo movimiento por material**, igual que hoy. La fibra y el aditivo de obra siguen saliendo del formulario Entrega.
- **Etapa A** (el despacho ya se registró teórico): cuando la carga se une al remito, se graba **un ajuste por material** (`stock_movements`, `movement_type='ajuste'`, `reference_type='carga'`, `reference_id = carga.id`) por la diferencia real − teórico. Se prende por planta con `puestos_carga.usa_kilos_reales`, **después de una semana mirando la auditoría** (pregunta 6).
- Las cargas que se tiraron (5.7) descuentan lo real como pérdida, con su motivo.

## 9. Interfaz del puente

### 9.1 Adaptador (lo que cambia según la marca de dosificadora)
```ts
// puente-carga/src/adaptador.ts — una implementación por sistema: Simulador, IndumixWeb (después del jueves), Hudson (más adelante)
export interface AdaptadorDosificadora {
  conectar(): Promise<void>
  info(): Promise<InfoPlanta>                 // marca, versión, cantidad de recetas, m³ por ciclo, reloj del PLC (texto crudo)
  leerRecetas(): Promise<RecetaPlanta[]>      // las 20, con sus salidas, unidades y orden de pesaje
  leerEstado(): Promise<EstadoPlanta>         // se llama 2 a 5 veces por segundo
  leerReportes(): Promise<ReportePlanta[]>    // las últimas que guarde Indumix (hoy 10)
  escribirOrden(o: OrdenPlanta): Promise<void>// selección de carga: receta, m³, secuencia, cliente, camión, observación. NO arranca
  leerOrden(): Promise<OrdenPlanta>           // lo que quedó escrito (para verificar)
  arrancar(): Promise<void>                   // = CARGAR de Indumix
  parar(): Promise<void>                      // = PARAR
  suspender(): Promise<void>
  reanudar(): Promise<void>
  bocina(ms: number): Promise<void>
}

type Salida = "arido_1" | "arido_2" | "arido_3" | "arido_4" | "cemento_1" | "cemento_2" | "aditivo_1" | "aditivo_2" | "agua"
type RecetaPlanta = { numero: number; nombre: string; habilitada: boolean
  salidas: { salida: Salida; nombre_planta: string; valor: number; unidad: "kg" | "g" | "L"; orden?: number }[] }
type EstadoPlanta = { en_linea: boolean; en_ciclo: boolean; suspendida: boolean; ciclo: number; ciclos: number; m3_ciclo: number
  tiempo_ciclo_s: number; contador_carga: number; seleccion: OrdenPlanta
  salidas: { salida: Salida; real: number; objetivo: number; humedad_pct?: number }[]
  balanzas: { id: "aridos" | "cemento" | "aditivo"; valor: number; unidad: string; estado: "vacia" | "pesando" | "llena" | "descargando" }[]
  agua: { real: number; extra: number }
  alarmas: { codigo?: string; texto: string }[]
  reloj_plc: string }
type OrdenPlanta = { receta: number; secuencia: number; m3: number; cliente: string; camion: string; observacion: string }
type ReportePlanta = { numero: number; inicio_plc: string; fin_plc: string; cliente: string; camion: string; observacion: string
  m3: number; receta: number; receta_nombre: string; secuencia: number; ciclos: number; tiempo_ciclo: string; humedades: number[]
  lineas: { salida: Salida; receta: number; teorico: number; real: number; extra?: number }[] }
```

### 9.2 Lo que el puente ofrece a la pantalla (solo `127.0.0.1:8787`)
| Ruta | Qué hace |
|---|---|
| `GET /v1/salud` | Versión, puesto, conectado a Indumix, hora del puente, reloj del PLC, etapa |
| `GET /v1/estado` y `GET /v1/estado/stream` (SSE) | Estado en vivo (9.1) |
| `GET /v1/recetas` · `POST /v1/recetas/leer` | Las 20 recetas; "Leer ahora" |
| `POST /v1/cargas/:id/preparar` | Baja la orden de la nube, escribe la selección y la verifica (5.4, pasos 1–3) |
| `POST /v1/cargas/:id/arrancar` `{ permiso }` | Verifica el permiso firmado, recompara la receta y arranca (5.4, pasos 4–5) |
| `POST /v1/parar` · `/v1/suspender` · `/v1/reanudar` · `/v1/bocina` | Los botones. PARAR no pide permiso |

Todas las órdenes llevan un `id` de pedido para no ejecutarse dos veces si se reintenta.

### 9.3 Lo que el puente le pide a la nube (`/api/carga/*`, con la credencial del puesto)
`GET /api/carga/puesto` (mapa de salidas, mapa de recetas, tolerancias, etapa) · `GET /api/carga/ordenes/:id` · `POST /api/carga/latido` (cada 30 s: estado resumido; la pantalla de otros dispositivos lo usa) · `POST /api/carga/recetas` (solo las que cambiaron, más una lectura completa por hora) · `POST /api/carga/eventos` · `POST /api/carga/reportes`.

Para la pantalla (con la sesión de la persona): `POST /api/carga/enviar` (desde Entrega), `POST /api/carga/:id/permiso-arranque`, `POST /api/carga/:id/cancelar`, `POST /api/carga/alertas/:id/resolver`, `POST /api/carga/salidas` (cambiar la Tolva 1).

### 9.4 Simulador
`AdaptadorSimulador` implementa la misma interfaz con la lógica que muestran las fotos:
- ciclos de hasta 1,5 m³;
- pesaje de áridos en el orden de la receta, sobre una sola balanza;
- cemento, aditivo y agua en paralelo;
- corrección por humedad y descuento del agua de los áridos;
- compensación del último ciclo (6.7);
- error de pesaje aleatorio y chico;
- reporte igual al de Indumix.

Además, permite **provocar fallas**: alarma ("Tolva 3 sin material"), receta cambiada, corte de conexión en medio del ciclo, PLC que no arranca y carga hecha desde Indumix. La maqueta es una versión de ese simulador. Con el simulador se programa y se prueba todo, menos el adaptador real.

## 10. Reloj de Indumix: vuelve a 1/1/1970 todos los días

- Indumix dice "4:57 - 1/1/1970". **Según Bautista, el reloj vuelve a 1/1/1970 todos los días** (seguramente al prender la planta): no es un error de configuración de una sola vez. Mientras está prendido corre bien (de 4:36 a 4:40 hay 4 minutos), pero la fecha y la hora no sirven.
- **Toda hora que guarda el sistema es la del puente**, es decir, la de la PC, sincronizada por Windows. El puente compara su hora con la de la nube en cada latido y avisa si la diferencia pasa los 2 minutos.
- La hora cruda de Indumix se guarda igual (`inicio_plc`, `fin_plc`), solo como dato.
- **El puente detecta el reinicio diario**: cuando el reloj de Indumix vuelve para atrás, anota la hora real de ese momento ("Indumix arrancó a las 06:58") y empieza un **día de Indumix** nuevo. Con eso:
  - **una carga vista en vivo** lleva la hora del puente de cuando pasó;
  - **un reporte leído después** (etapa A o con el puente caído) se pasa a hora real con la diferencia entre el reloj de Indumix y el del puente **de ese mismo día de Indumix**, y queda marcado "hora estimada";
  - si el reporte es de un día de Indumix anterior al que vio el puente (por ejemplo, la PC estuvo apagada), no se estima la hora: se une solo por remito y camión;
  - el **contador de cargas** también puede reiniciarse (a averiguar), así que la identidad de una carga es `(puesto, día de Indumix, contador, inicio)`.
- **No ponemos en hora a Indumix nosotros.** Se le pregunta al proveedor si es la pila del reloj y cómo sincronizarlo (P7).

## 11. Auditoría de carga (como Loop §2.12)

Pantalla `/carga › Auditoría`. Filtros: planta, puesto, período y "solo con problemas". Se puede exportar a Excel (`xlsx`, que ya está).

- **Resumen:** remitos, cargas, m³ de remitos, m³ de cargas y cantidad de desvíos.
- **Contadores por categoría:**

| Categoría | Regla |
|---|---|
| **Sin remito** | Carga sin despacho unido, pasados 30 min de terminada |
| **Sin carga** | Despacho de una planta con puesto activo sin carga unida. Solo cuenta para los días en que el puente estuvo conectado |
| **Dif. volumen** | m³ de la carga distintos de los m³ del remito (más de 0,1 m³) |
| **Desviación** | Algún material real fuera de la tolerancia de pesaje (6.2) contra lo teórico de la receta |
| **Receta distinta** | La receta usada no coincidía con la fórmula del remito, o se autorizó con receta distinta |
| **Carga desde Indumix** | Arrancada en Indumix y no desde el sistema (etapas B y C) |

- **Unión carga ↔ remito**, en este orden:
  1. por id, cuando la carga salió del sistema (`cargas.dispatch_id`);
  2. por **remito en "Observación"**, comparando solo los dígitos ("0886" = "886");
  3. por **camión + hora**: la patente de Indumix normalizada ("AG 083 GT" = "AG083GT") y la carga terminada hasta 30 min antes de la hora del remito.

  Lo que se une por 2 o 3 queda marcado "unido por remito" o "unido por camión y hora", y se puede deshacer a mano.
- **Tabla doble:** a la izquierda, el **despacho** (remito, camión, hora, cliente y obra, fórmula, m³); a la derecha, la **carga** (N° de Indumix, inicio, m³, receta, origen). Al tocar una fila se ve el detalle material por material: fórmula, receta, teórico, real y diferencia.
- **Marcar revisada** (`carga.editar`), con nota.
- **El dato que sale de esto:** cemento real contra teórico por día y por fórmula. Es el panel "Consumo real vs teórico de cemento" que se ocultó en la fase 0 porque "lo real salía de la misma fórmula". Ahora vuelve con datos reales.

## 12. Permisos (se suman a `lib/permisos.ts`)

**Sección nueva `carga`, "Carga de planta":**

| Acción | Qué habilita | Plantilla operario | Gerencial |
|---|---|---|---|
| `ver` | La pantalla, la cola, las recetas leídas, la auditoría y las alertas | Sí | Sí |
| `cargar` | En la PC de la planta: Cargar, Suspender, Reanudar y Bocina; cambiar el material de la Tolva 1; "Enviar a cargar" desde Entrega (además de `despacho.cargar`); qué pasó con una carga parada | No (se habilita por persona: Titan, Felipe, David) | Sí |
| `editar` | Configurar el puesto (etapa, mapa de salidas, tolerancias), asignar recetas a fórmulas, dar de alta el puente y marcar la auditoría revisada | No | Sí |

- **PARAR no pide permiso:** lo puede apretar cualquiera con la pantalla abierta en la PC de la planta.
- **Resolver una receta que no coincide** pide **`formulas.editar`** (las tres opciones de 6.5). Hoy lo tienen Bautista, Fernando y Juan, que son gerenciales.
- El permiso se controla **en el servidor**: en `permiso-arranque`, `resolver`, `enviar` y `salidas`, con la sesión de la 0c-1. Que no se vea el botón no alcanza.

## 13. Qué averiguar el jueves en la planta (con Bautista)

**Para la grabación (HAR):** Chrome › F12 › Network › "Preserve log", y guardar como HAR. **Ojo:** el HAR puede tener contraseñas y cookies. Se guarda fuera del repo y no se comparte.

Grabar por separado, con nombre:
1. `inicio-quieto.har`: la pantalla INICIO abierta 1 minuto sin hacer nada. Sirve para ver cómo se actualizan los pesos: qué dirección, cada cuánto y en qué formato.
2. `seleccion.har`: cambiar m³, receta (< >) y secuencia, y tipear Cliente, Camión y Observación, **sin cargar**.
3. `carga-normal.har`: una carga real completa, desde CARGAR hasta el fin. Es lo que pidió Bautista.
4. `recetas-lectura.har`: RECETAS, pasar de la 1 a la 20 con < > **sin tocar GUARDAR**.
5. `reporte.har`: REPORTE, pasar por los 10.
6. `alarma.har`: abrir ALARMA, y ESTADÍSTICA si hay.
7. Si Bautista lo autoriza y en vacío, `suspender-parar.har`: SUSPENDER, reanudar y PARAR. Bocina también.

**Mirar y anotar (con fotos):**
- **Qué es `192.168.0.10`:** ¿es el PLC (marca, modelo, si tiene servidor web propio) o una PC? ¿La pantalla se ve en el navegador de la PC de la planta? ¿Hay usuario y contraseña?
- La PC: Windows (versión), si tiene internet estable, si está prendida todo el día, si es la misma donde se va a usar `/carga` y si tiene pantalla táctil.
- Las pantallas SECUENCIA y PARÁMETROS (solo fotos, **sin tocar**), y RECETAS de varias recetas, incluida una de 6/20, para ver qué tolva usa.
- **Capacidad del ciclo** (¿1,5 m³ fijo?) y cómo arma los ciclos con 8 m³.
- **Humedad:** quién la tipea, cuándo, y si es por tolva.
- Qué es **"Extra Agua" 223** en INICIO y el agua extra del reporte.
- Si el **Contador carga** se reinicia (por día o al apagar) y si los reportes se borran al apagar.
- **La red:** ¿la PC llega a Indumix por cable o por wifi? ¿La pantalla de Indumix corre en esta misma PC? ¿Hay UPS?
- **El reloj:** a qué hora se prende la planta, si al prender vuelve a 1/1/1970 0:00 (foto de la pantalla al prender) y si Indumix corre en la PC o en el PLC: eso dice de quién es la pila.
- Si el chofer o el plantista agregan agua o aditivo **a mano** fuera de Indumix (explica el agua 110 contra 168).
- Cómo se cambia de 6/12 a 6/20 en la Tolva 1 y cada cuánto.
- Dónde está la parada de emergencia y qué pasa con el camión durante la carga (¿hay sensor de camión presente?).
- La red: switch, cables y si la PC tiene IP fija.

**No hacer el jueves:** guardar recetas, cambiar parámetros, poner el reloj en hora o escanear puertos sin el OK del proveedor.

## 14. Preguntas para el proveedor de Indumix

- **P1.** ¿Indumix tiene una forma oficial de integrarse (API, Modbus TCP, OPC UA, S7, base de datos, exportación de archivos)? ¿Hay documentación de las variables o *tags*?
- **P2.** ¿Un programa externo, en la misma red, puede leer las recetas, el estado y los pesos en vivo y los reportes? ¿Y escribir la selección de carga (receta, m³, cliente, camión, observación)?
- **P3.** ¿Puede apretar CARGAR, PARAR, SUSPENDER y Bocina? ¿Qué seguridades tiene el PLC para el arranque (camión presente, tolvas, compuertas, motores) que **no** dependan de la pantalla?
- **P4.** Si se corta la comunicación con la pantalla o con el programa externo en medio de un ciclo, ¿qué hace el PLC?
- **P5.** ¿Se puede **impedir que se arranque desde Indumix** una carga que no autorizó nuestro sistema (por ejemplo, una habilitación externa)? Si no, el bloqueo por receta solo vale para lo que se carga desde el sistema.
- **P6.** ¿Por qué el máximo de 20 recetas? ¿Se puede ampliar? ¿Se podría escribir una receta desde afuera (para más adelante)?
- **P7.** El reloj vuelve a 1/1/1970 **todos los días**. ¿Es la **pila del reloj** del PLC o de la PC que corre Indumix? ¿Se puede cambiar? ¿Indumix puede **sincronizar la hora** con la red (NTP) o con la PC? ¿El contador de cargas y los reportes también se reinician?
- **P8.** ¿Guarda solo los últimos 10 reportes? ¿Se puede ampliar o exportar? ¿Hay un registro de **quién y cuándo cambió una receta**?
- **P9.** **Corrección por humedad y entre ciclos:** confirmar que pesa árido húmedo = seco × (1 + H%), que descuenta esa agua del agua de la receta y que el último ciclo compensa el error del anterior. ¿Qué es "Extra Agua"?
- **P10.** ¿Hay usuarios con contraseña en Indumix, para saber quién cambió qué?
- **P11.** Lista de alarmas y sus códigos.
- **P12.** Calibración de balanzas: cuándo fue la última y si hay certificado.
- **P13.** Si tocamos la integración, ¿cómo queda el soporte y la garantía? ¿Lo dan por escrito? ¿Pueden estar en las pruebas en vacío?
- **P14.** ¿Las actualizaciones de Indumix pueden cambiar la pantalla web o las variables? ¿Avisan antes?

## 15. Criterios de aceptación

**De la maqueta (para aprobar esta propuesta):** Bautista la recorre con la guía "Qué probar" y está de acuerdo con:
- la pantalla;
- el bloqueo y sus tres salidas;
- las etapas A, B y C;
- el modelo de datos.

**De la implementación** (cada etapa en su rama, con el arquitecto, el obrero y el revisor):

1. **Simulador:** una carga de 3 m³ de H30-612-15 B con receta coincidente hace 2 ciclos de 1,5 m³. El objetivo del ciclo 2 compensa el ciclo 1, y el reporte tiene el mismo formato y redondeo que el de Indumix. Con la receta y las humedades de la foto (H% 0/0/3/0), el agua teórica corregida da 268 L.
2. **Bloqueo:** con la receta 13 en CP 40 = 350 y Agua = 110, la carga de H30-612-15 B (CAN) queda bloqueada con los dos motivos y **Cargar no se habilita**. Además, un `POST /v1/cargas/:id/arrancar` directo al puente, sin permiso válido, se rechaza.
3. **Alerta única:** se crea **una** alerta (no una por lectura) y llega el mail a quienes tienen `formulas.editar`. "Resolver" solo aparece y solo funciona (el servidor lo controla) para ellos.
4. **Resolver:**
   - "corregir la planta" (camino normal) desbloquea solo cuando el puente lee la receta corregida, y la ficha no lleva el agua si no está tildada la confirmación de Grow;
   - "agua en consulta con Grow" deja cargar con el aviso ámbar hasta el vencimiento, pero sigue bloqueando por el cemento;
   - "autorizar una vez" vale para una sola carga y queda marcada en la auditoría;
   - "corregir nuestra fórmula" (excepción) pide la confirmación del laboratorio, motivo y Actividad.
5. **Cambio de receta:** cambiar una receta en el simulador genera la alerta con la diferencia en menos de 5 minutos, y la versión anterior queda guardada.
6. **Tolva 1:** con la Tolva 1 en 6/20, una fórmula de 6/12 se bloquea con el motivo. El cambio de material queda en Actividad y en `puesto_salidas`.
7. **Seguridad:**
   - el puente no acepta conexiones desde otra PC de la red (rechazada) ni desde otro `Origin`;
   - desde otro dispositivo no aparecen Cargar ni Parar;
   - no existe ninguna ruta de la nube que haga arrancar algo.
8. **PARAR:** siempre visible, sin permiso, y responde en menos de 1 s en el simulador. Con el puente apagado, se ve el mensaje de usar el PARAR de Indumix.
9. **Corte en medio del ciclo:** al volver, la pantalla muestra el estado real y no arranca nada sola. Los reportes pendientes se suben sin duplicarse.
10. **Despacho y stock:** al terminar, el despacho queda creado con el remito, las probetas, el pedido y el viaje como en la fase 3, y `dispatch_materials` y `stock_movements` tienen los **kilos reales**. Sin `materiales_reales`, `registrar_despacho` hace exactamente lo de antes (probado en `BEGIN … ROLLBACK`).
11. **Reloj:** con el PLC en 1970, todas las horas son las del puente, y un reporte leído después queda con hora estimada.
12. **Auditoría:** con un juego de datos de prueba aparece al menos un caso de cada categoría (sin remito, sin carga, dif. volumen, desviación, receta distinta, desde Indumix), con los contadores correctos. Además, une "0886" con el remito 886 y "AG 083 GT" con AG083GT.
13. **Prueba en vacío:** antes del primer uso real de las etapas B y C, al menos 5 cargas en vacío o de prueba con Bautista presente: Cargar, Suspender, Reanudar, PARAR en medio y Bocina. La lista queda firmada en este documento.
14. **Nunca se escribe una receta en Indumix** (se revisa en el código del adaptador).

## 16. Riesgos

| Riesgo | Cómo se cubre |
|---|---|
| **Arranque sin camión abajo, o con el camión equivocado** | Confirmación con la patente y botón mantenido, Bocina, seguridades del PLC y la etapa C solo después de las pruebas en vacío. |
| **El bloqueo se saltea cargando directo desde Indumix** | Se detecta y se avisa (5.7), pero no se impide. Para impedirlo hace falta una habilitación del lado de Indumix (P5). |
| **Integración no documentada:** si se usa la pantalla web, una actualización de Indumix puede romperla | Adaptador aislado, verificación de lo escrito leyéndolo de vuelta, y el puente frena todo si no reconoce lo que lee. Pedir aviso de actualizaciones (P14). |
| **Garantía y responsabilidad con el proveedor** | OK escrito antes de las etapas B y C (P13). |
| **Corte de conexión en medio de un ciclo** | El PLC decide (P4). El puente nunca reintenta un arranque, y la cola local evita perder reportes. |
| **Indumix guarda solo 10 reportes:** con el puente caído más de 10 cargas, se pierden | Aviso "puente caído" a los 10 minutos, y el contador muestra cuántas faltan leer. |
| **Bloqueo que frena la operación** el primer día (la receta 13 frenaría a TOP) | Etapa A primero, con las diferencias corregidas antes de prender el bloqueo. Además existe "Autorizar solo esta carga". |
| **Chrome bloquea la página contra `127.0.0.1`** | Permiso de red local dado una vez, o el respaldo de la página servida por el puente (3.3). |
| **Doble conteo de stock** (ajuste de la etapa A más los kilos reales) | Un solo camino por etapa. El ajuste se graba una vez por carga (`reference_id` único). |
| **Remito tipeado mal en Observación** (etapa A) | Unión por camión y hora como respaldo, y unión manual. En las etapas B y C lo escribe el sistema. |
| **Sincronizar el agua a ciegas** (110 → 168 L/m³ cambia mucho el hormigón) | Tratamiento aparte del agua: confirmación de Grow antes de pasarla a la planta y "agua en consulta" con vencimiento (6.5.1). |
| **Una caída de Zomatik frena la planta** (sin NP no se despacha) | Excepción gerencial "Despachar sin NP" con motivo y NP que se genera sola después (18.7.1). |
| **Despachar primero y no poder cargar** (deja despachos sin carga) | "Despachar y cargar" bloqueado si la NP o la receta están en rojo; si falla después, "Anular el despacho" o "Cambiar de camión" (18.3). |
| **Choque con la fase 3** (las dos tocan `registrar_despacho` y Entrega) | Esta se programa después de publicada la fase 3, partiendo de la función de producción. |

## 17. Preguntas para Bautista (con recomendación)

1. **¿Etapas A → B → C, o directo a C?** Recomiendo **A → B → C**: la A da el control de recetas, la auditoría y los kilos reales sin tocar la planta, y permite corregir las recetas antes de prender el bloqueo.
2. ~~¿Cuál manda?~~ **Respondida el 20/10: manda siempre el sistema.** Queda una sola pregunta: **el agua de la H30-612-15 B** (110 en la planta contra 168 en la fórmula: agua/cemento 0,31 contra 0,51). ¿Se la consultamos a Grow antes de sincronizar? Recomiendo **sí**: el cemento se corrige ya en la planta, y el agua queda "en consulta con Grow" (6.5.1), sin frenar a TOP pero a la vista. Hay que preguntarle también a la planta si el agua que falta se agrega en el camión.
3. **¿Se permite "Autorizar solo esta carga"?** Recomiendo **sí**, solo con `formulas.editar`, con motivo, para una sola carga y marcada en la auditoría. Sin esa salida, un camión puede quedar parado esperando que alguien vaya a la planta.
4. **¿Las tolerancias de 6.2 están bien?** Recomiendo empezar con esas y revisarlas después de 2 semanas de la etapa A.
5. **¿20 recetas: 16 fijas y 4 rotativas, cargadas a mano con la ficha?** Recomiendo **sí**. Escribir recetas desde el sistema, solo más adelante y con el OK del proveedor.
6. **¿El stock con kilos reales desde la etapa A?** Recomiendo prenderlo **después de una semana mirando la auditoría**, cuando la unión carga ↔ remito dé bien.
7. **¿Qué materiales no pasan por Indumix?** El Sikament 33S, el Superfluidificante y la fibra, seguro. ¿Y el **Espumígeno** de los RDC, que Indumix no tiene en ninguna salida (Aditivo 2 vacío)? Recomiendo marcarlo "se agrega a mano" si es así.
8. **¿PARAR también desde el celular?** Recomiendo **no**: haría falta un camino de la nube a la planta, que es justo lo que no queremos. Para parar desde lejos se llama a la planta.
9. **¿Quién recibe las alertas y por dónde?** Recomiendo mail a quienes tienen `formulas.editar` (hoy Bautista, Fernando y Juan), más el aviso en la pantalla. WhatsApp después, cuando el sistema lo tenga.
10. **¿Dónde se usa la pantalla de carga?** Recomiendo **la misma PC de Indumix** (o una al lado, en la misma red), y solo esa habilitada. ¿El plantista despacha (fase 3) desde la misma PC o desde la tablet? Si es la tablet, el envío a cargar se hace desde ahí, y Cargar solo en la PC.
11. **¿Hudson después?** Recomiendo **sí**, cuando Canning esté en la etapa C y estable, con su propio adaptador.

## 18. Respuestas de Bautista (21/10/2026) — mandan sobre lo anterior

> **Reemplazado en buena parte por el punto 19 (21/10, 2):** despacho y carga vuelven a ser **dos pantallas** como en Loop, el agua distinta **no frena**, el plantista **no genera la NP**, el remito se imprime **al despachar** y "Salió a las" **no** es el fin de la carga. Siguen valiendo de 18: la densidad (18.2), "primero se despacha y después se carga", la tabla de cancelaciones de 18.3, el ajuste de stock (18.5) y el modelo de 18.6.

Maqueta actualizada: [`maqueta-carga-planta.html`](maqueta-carga-planta.html). Tiene la vista **Despacho + carga** (la principal) y la vista **Solo carga**.

### 18.1 Lo que dijo Bautista
1. **Pantalla más chica y menos saturada, pensada para PC**, igual que el despacho diario del 21/10 (fase 3, commit `e9b35d5`):
   - letra de 13 px de base y 11–12 px lo secundario;
   - sin rellenos fuertes, bordes finos, color solo en franjas y etiquetas suaves;
   - botones de tamaño mouse.

   Tiene que entrar en **1366×768 sin scrollear**. El **PARAR sigue grande y visible**, y se respeta el **alto contraste** (botón ☀ del sistema).
2. **Despacho y carga en la misma pantalla.**
   - En la pantalla de despacho en tres columnas (fase 3) se elige el viaje y el camión.
   - El formulario Entrega tiene **"Despachar y cargar"**, que graba el despacho y manda la orden de carga a la planta.
   - Se abre un **panel de carga en la misma pantalla**, sin perder la cola de viajes.
   - La pantalla de carga sola queda como vista completa para la PC de la planta.
3. **Regla nueva:** no se puede **despachar ni cargar** hormigón si el pedido no tiene una **nota de pedido (NP) cargada en Zomatik**. El control se muestra junto al de la receta: "Sin NP en Zomatik · Generar NP ahora".

### 18.2 Cómo se ve (densidad y PC)
Se copian los tamaños, colores y estructura de `components/despacho/*` (rama de la fase 3):

| Elemento | Medida |
|---|---|
| Letra base | 13 px (`text-[13px]`) |
| Texto secundario | 11–12 px, `text-muted-foreground` |
| Encabezados de columna | 14 px semibold, en una línea de ~31 px |
| Filas | 2 líneas de ~43 px, con borde fino y **franja izquierda de 3 px** con el color del estado |
| Etiquetas | 10,5–11 px, fondo `*-50` y texto `*-800` (R verde, X ámbar, "sin NP" rojo suave, "receta ✕") |
| Botones | 26–32 px de alto (mouse). CARGAR, 34 px verde |
| PARAR | Fijo abajo a la derecha, **132 × 60 px**, rojo, en todas las vistas de la PC de la planta |

- **Planta en vivo** en tamaño chico: 9 salidas de unos 52 px de ancho, cada una con material, nivel, H% y Real/Objetivo; balanzas en una franja; cinta y trompo.
  - En la vista completa, las mismas piezas con más tamaño (salidas de 78 px) y la tabla de pesajes.
- **Alto contraste:** se suman reglas en `app/globals.css` con el mismo patrón que la fase 3 (`.high-contrast .d3c …`):
  - bordes `#555`;
  - texto secundario `#111`;
  - etiquetas con borde;
  - fondo rojo suave más fuerte;
  - el PARAR con borde negro.
- **Columnas con todo el alto** (se mide, como en la fase 3). Con menos de 720 px de ancho pasan a pestañas.

### 18.3 Despacho y carga juntos

**Pantalla de despacho (fase 3) en la PC de la planta:**

```
┌ Despacho · Canning · Hoy · 12:15 · ● Puente · Indumix 5:17 → hora del puente ······· Recetas · Auditoría · Alertas · ☀ ┐
│ Programado 76,5 · Despachado 46,5 · Falta 30 · Viajes 16 de 24 · Cargas en cola 1 · ⚠ 3 muestras cada 50 m³        │
├─ Viajes ─────────────────┬─ Camiones ──────────┬─ [Carga ●] Pedidos ────────────────────────────────────────────┤
│ 12:10 13/16 Santa Clara… │ AG083GT Cargando    │ AF431GU  R 888  Pavimentos del Sur · Barrio Las Acacias       │
│   H30-612-15 B  receta ✕ │ AF431GU En carga    │ ✓ NP 0001-00000817  ✓ Receta 1  ✓ Agua  ✓ Tolva 4  ✓ Puente   │
│ 12:20 2/3 Las Acacias…   │ AE402HE Yendo       │ [EN CICLO] Ciclo 1/3 · 1,50 m³ · pesando · 0:42 / 1:48         │
│ 12:50 1/1 Lote 23 sin NP │ CRN449  En obra     │ T1 T2 T3 T4 | R1 R2 | Ad1 Ad2 | Agua   (nivel, H%, R/O)        │
│ …                        │ LES431  Taller      │ Bal. áridos · Bal. cemento · Bal. aditivo · Agua               │
│                          │                     │ Cinta ═══════ camión: trompo 0,8 de 4,5 m³                      │
│                          │                     │ [Suspender] [Bocina]                                [ PARAR ]  │
└──────────────────────────┴─────────────────────┴────────────────────────────────────────────────────────────────┘
```

- **La tercera columna tiene dos pestañas: Carga | Pedidos.**
  - Con una carga en la cola o en curso, se abre sola en **Carga** y toma más ancho (1,45 contra 1 de las otras).
  - **Viajes y Camiones se siguen viendo siempre**, así que se puede preparar el próximo despacho mientras carga el anterior.
  - Pedidos queda a un toque.
- **Arriba del panel, la cola de carga:** una fila por despacho que espera carga, en orden. Se elige cuál cargar. Solo una carga a la vez.
- **Camiones:** estado nuevo, **"En carga"** (violeta suave): despachado y en la cola, o cargando ("Cargando · ciclo 2/3"). Al terminar la carga pasa a **"Yendo a obra"**, con la hora del fin de la carga.
- **La vista "Solo carga"** (`/carga`) es la de pantalla completa, para la PC de la planta:
  - cola, planta grande con tabla de pesajes, orden y controles;
  - más las pestañas Recetas de la planta, Auditoría de carga y Alertas.

  Desde el despacho se llega con "Recetas · Auditoría · Alertas".
- **Desde la tablet o la oficina:** el despacho y el panel se ven igual, y "Despachar y cargar" manda la orden a la cola de la PC de la planta. **CARGAR y PARAR aparecen solo en la PC de la planta**, que es la del puente (3.2, sin cambios).

**Orden: primero se despacha y después se carga** (la recomendación del coordinador, que comparto):
1. **Entrega › "Despachar y cargar":**
   - controla la **NP** (18.4) y la **receta** (6), y valida lo mismo que hoy;
   - llama a `registrar_despacho` como siempre: remito, **stock teórico** (fórmula × m³), probetas, pedido, viaje y camión;
   - crea la carga en estado `pendiente` con `dispatch_id`.

   Con la NP o la receta en rojo, **el botón está bloqueado**, porque no tiene sentido despachar algo que no se va a poder cargar.
2. **Panel de carga:** chequeo (NP, receta, agua, tolva, puente, alarmas y planta libre), CARGAR, confirmación de que el camión está abajo, carga en vivo y fin. Es lo mismo que 5.3 a 5.5.
3. **Fin de la carga:**
   - se guarda el reporte;
   - el stock se **ajusta con los kilos reales** (18.5);
   - "Salió a las" (`dispatch_date`) pasa a ser **la hora de fin de la carga**, que es la real de salida, salvo que alguien la haya corregido a mano;
   - el camión queda "Yendo a obra";
   - recién ahí se habilita **"Imprimir remito"**, para que no se imprima el papel de una carga que después se cancela.
4. **"Despachar sin cargar"** queda para cuando el puente está caído, el despacho de prueba o el despacho por árido. Con el puente andando, solo lo ve un gerencial, con motivo. **También pide NP.** La carga que se haga a mano en Indumix la lee el puente y la auditoría la une al remito.

**Si la carga no sale como se despachó:**

| Caso | Qué pasa con el despacho | Quién |
|---|---|---|
| **Se cancela antes de arrancar** (no se pesó nada) | Dos opciones. **"Cambiar de camión"**: se edita el despacho (camión y chofer) y la carga pasa al otro camión. **"Anular el despacho"**: el despacho queda **anulado** (no se borra) con motivo; vuelven el stock teórico, los m³ del pedido y el viaje a la columna Viajes, y el remito de papel queda anulado | `carga.cargar` mientras no se haya pesado nada; después, solo gerencial (`historial.borrar`) |
| **PARAR a mitad · "Sale con lo cargado"** | Se **corrige el m³ del despacho** a lo que entró en el trompo, con `editar_despacho` y motivo. El pedido vuelve a tener lo que falta, que se rearma en viajes como hoy. El stock se ajusta con lo real | `carga.cargar` |
| **PARAR a mitad · "Completar con otra carga"** | El despacho no cambia. Lo que falta va en **otra carga del mismo despacho** (mismo camión, mismo remito), primera en la cola. Las dos cargas se suman en la auditoría. Si esa segunda carga también se para, solo queda "Sale con lo cargado" | `carga.cargar` |
| **PARAR a mitad · "Se tiró"** | El despacho queda **anulado** (como arriba) y lo pesado se registra como **pérdida** (`stock_movements`, `reference_type='carga'`), con motivo. El viaje vuelve | `carga.cargar`, con motivo; queda en Actividad y en la auditoría |
| **El PLC no arranca** | Nada: la carga vuelve a "lista". Si no se puede cargar, se usa "Cancelar" | — |

### 18.4 Nota de pedido de Zomatik: sin NP no se despacha ni se carga
- **Qué cuenta como "tiene NP":** el pedido programado está vinculado a una NP de Zomatik en estado `ok` (`scheduled_dispatches.zomatik_pedido_id` → `zomatik_pedidos`, de `zomatik.md` §9 y §16.2). Puede ser:
  - una NP propia del pedido (NP para R, NP2 para X);
  - la NP del día generada contra un **acopio** (proyecto);
  - una NP pendiente que ya existía, elegida para la obra (camino "c" de §16.2).
- **Dónde se ve:**
  - en **Viajes** y **Pedidos**, la etiqueta roja "sin NP";
  - en **Entrega**, una línea arriba de la receta: "NP 0001-00000817 · Zomatik ✓", o en rojo "**Sin NP en Zomatik · Generar NP ahora**";
  - en el **panel de carga**, el primer control de la lista: "✓ NP 0001-…".
- **"Generar NP ahora":** crea la NP del pedido en Zomatik con el robot de `zomatik.md` (NP o NP2 según R/X, fórmula y m³ del pedido). Mientras trabaja muestra "Generando la NP en Zomatik…", y cuando termina, el número.
  - Si Zomatik falla: "Zomatik no respondió · Reintentar".
  - Lo puede hacer quien tiene `programacion.cargar` (Titan, Felipe, Juan, Fernando y Bautista). Los demás ven "Pedila a Felipe o Juan".
- **En la base:** `registrar_despacho` suma una condición: si el pedido no tiene NP `ok`, `RAISE 'El pedido no tiene nota de pedido en Zomatik.'`. Así frena también la pantalla vieja y el despacho manual.
  - El **despacho manual** (sin pedido programado) también necesita NP: el diálogo ofrece "Generar NP ahora" con cliente, fórmula y m³.
- **Ojo, cambia una regla de `zomatik.md`:** §8.1 decía "Despachar no se frena nunca por Zomatik". Con esta regla, **sí se frena**. Hay que avisar en esa spec (la lleva otro arquitecto) y decidir qué pasa si Zomatik está caído (pregunta 18.7.1).
- **Orden de trabajo:** este control necesita que esté programada la NP al programar (Z3 de `zomatik.md`) o "Generar NP ahora" (que usa el mismo robot). Va antes que la etapa B de la carga, o junto con ella.

### 18.5 Stock con kilos reales (reemplaza 8.3)
- El despacho descuenta lo **teórico**, como hoy (fórmula × m³, con la humedad del acopio).
- Al cerrar la carga, `cerrar_carga` graba **un ajuste por material**: `stock_movements` con `movement_type='ajuste'`, `reference_type='carga'` y `reference_id = cargas.id`, por **real − teórico del despacho**.
  - En los áridos el ajuste se hace **en seco**: lo real se pasa a seco con la humedad que usó Indumix.
  - El agua no descuenta stock, como hoy.
- **Un solo camino en todas las etapas** (A, B y C): `registrar_despacho` no cambia salvo por el control de NP, y desaparece el parámetro `materiales_reales`.
- En la etapa A el ajuste se prende por planta (`puestos_carga.usa_kilos_reales`), como estaba.
- Si se edita o se anula el despacho, los ajustes de su carga se recalculan, o se revierten, en la misma transacción.

### 18.6 Cambios al modelo de datos (se suman al punto 8)
| Cambio | Para qué | Qué pasa con lo cargado |
|---|---|---|
| `cargas.dispatch_id` **obligatorio** para las cargas con origen `sistema` (se crea al despachar). Las de origen `indumix` siguen pudiendo no tenerlo | Despachar primero | Tabla nueva: no hay datos |
| `cargas.estado` suma `anulada`. `cargas.completa_carga_id` es la carga a la que completa, si es la segunda del mismo despacho | Cancelar y completar | — |
| Quedan afuera `cargas.payload_despacho` y el parámetro `materiales_reales` de `registrar_despacho` | Ya no hacen falta | — |
| `dispatches.anulado_at`, `anulado_por`, `anulado_motivo` (si la fase 3 o la 0c no lo agregaron ya), y la función `anular_despacho`: devuelve el stock teórico y los ajustes, el pedido y el viaje. **No borra** | Anular por carga cancelada o tirada | Nulos |
| `registrar_despacho`: condición de NP (18.4) | Regla del 21/10 | Ningún despacho anterior se toca |
| `mixers.status` no cambia. "En carga" se **calcula** (camión con una carga `pendiente`, `lista` o `en_curso`) en `estadoCamion()` de `lib/despacho.ts` | Estado nuevo en Camiones | — |

### 18.7 Preguntas que quedan (con recomendación)
1. **¿Qué pasa si Zomatik está caído y hay que despachar?** Recomiendo que un **gerencial** pueda "Despachar sin NP (Zomatik caído)", con motivo. La NP se genera sola cuando Zomatik vuelve y queda un aviso hasta que exista. Sin esa salida, una caída de Zomatik para la planta.
2. **¿"Generar NP ahora" lo puede hacer el plantista?** Recomiendo **sí**, para quien tenga `programacion.cargar`, que hoy incluye a Titan. La NP sale con los datos del pedido: el plantista no elige precio ni lista.
3. **¿"Salió a las" = fin de la carga?** Recomiendo **sí**: es la mejor hora de salida que vamos a tener sin GPS, y sirve para los tiempos de la 4a.
4. **¿El remito se imprime al terminar la carga?** Recomiendo **sí**, así no se imprimen papeles de cargas canceladas. Se puede imprimir antes desde la tabla de entregas si hace falta.

### 18.8 Criterios de aceptación que se suman
15. **Densidad y alto contraste:** en 1366×768, con la carga en curso, se ven sin scrollear la franja de contadores, Viajes (unos 9 viajes), Camiones (5), el panel de carga completo (chequeo, planta, balanzas, trompo y controles) y el PARAR. En alto contraste los bordes y textos secundarios se refuerzan como en la fase 3.
16. **"Despachar y cargar":**
    - graba el despacho con el stock teórico y crea la carga `pendiente` con `dispatch_id`;
    - el camión pasa a "En carga";
    - el viaje sale de la columna;
    - el panel se abre sin cambiar de pantalla.
17. **Bloqueos:** con la receta en rojo o sin NP, "Despachar y cargar" está deshabilitado y dice por qué. Sin NP, `registrar_despacho` también rechaza desde la pantalla vieja y el manual.
18. **"Generar NP ahora"** crea la NP (NP para R, NP2 para X), desbloquea el despacho sin cerrar la Entrega y, si Zomatik falla, muestra "Reintentar".
19. **Fin de la carga:** ajuste por material = real − teórico (áridos en seco), "Salió a las" = fin de la carga, y "Imprimir remito" habilitado.
20. **Cancelar y parar:**
    - "Anular el despacho" devuelve stock, pedido y viaje, y deja el despacho anulado (no borrado);
    - "Sale con lo cargado" corrige el m³ del despacho;
    - "Completar" crea la segunda carga con el mismo `dispatch_id`;
    - "Se tiró" anula y registra la pérdida.

    Todo con motivo, en Actividad y en la auditoría.

## 19. Respuestas de Bautista (21/10/2026, 2) — mandan sobre todo lo anterior

Bautista probó la maqueta de despacho y carga juntos, y pidió volver a la forma de Loop. La maqueta se rehízo: [`maqueta-carga-planta.html`](maqueta-carga-planta.html). Tiene tres pestañas arriba que simulan los equipos: **Despacho (oficina o tablet)**, **Carga (PC de la planta)** y **Auditoría de carga**.

### 19.1 Lo que dijo Bautista
1. **No todo en la misma pantalla:** copiar Loop. En Loop:
   - "Despachar" imprime el remito y **manda la línea de despacho al sistema de batch**;
   - la carga se maneja **en la pantalla de la planta**;
   - Loop **lee después** las cargas reales para la Auditoría de carga;
   - un **"broker"** empareja con el pedido las cargas que nacen en el batch (`informe-loop.md` §2.6 y "Sistema de batch").
2. **Un viaje programado siempre tiene NP**, porque la NP se genera al programar. El único despacho sin NP es el **manual**, que queda para después.
3. **El agua distinta resalta pero no frena.** Hay que sumar el botón **"Extra agua"** de Indumix y registrar cuánta agua extra se agrega.
4. **El plantista no genera la NP**, por ahora.
5. **Tiempos:** inicio y fin de carga, tiempo de carga y tiempo hasta que el camión sale de la planta (GPS). "Salió a las" no es el fin de la carga: se guardan los dos.
6. **El remito se imprime al despachar**, con el cálculo teórico.
7. **Despachar sin NP con Zomatik caído:** lo autoriza un gerencial con motivo. Confirmado.
8. Pregunta: **"¿qué pasa si se corta el wifi?"** (19.8).

### 19.2 Dos pantallas conectadas, como Loop

```
 OFICINA o TABLET                         NUBE                        PC DE LA PLANTA (Canning)
┌───────────────────────────┐                                    ┌──────────────────────────────────────┐
│ DESPACHO (fase 3)         │   orden de carga   ┌──────────┐    │ CARGA (/carga)                       │
│ Viajes | Camiones | Ped.  │ ─────────────────► │  cargas  │ ──►│ cola · planta en vivo · CARGAR ·     │
│ Entrega › Despachar       │   (~3 s)           │ (base)   │    │ Suspender · Bocina · Extra agua ·    │
│  = remito impreso         │ ◄───────────────── │          │ ◄──│ reporte · PARAR                       │
│  + stock teórico          │  estado de la carga└──────────┘    │       │ puente (127.0.0.1)            │
│ Camión: "En cola de carga │                         ▲          │       ▼                              │
│  · 1° · Ver carga"        │                         │          │  Indumix + PLC                       │
└───────────────────────────┘                         │          └──────────────────────────────────────┘
                              AUDITORÍA DE CARGA (cualquier equipo): remito ↔ carga, tiempos, agua extra
```

**Despacho** (la pantalla de la fase 3, casi sin cambios):
- "Despachar" y "Despachar e imprimir" hacen lo de siempre: `registrar_despacho`, remito, **stock teórico**, probetas, pedido, viaje y camión.
- Además, si la planta tiene puesto de carga en etapa B o C, **crean la orden en la cola de carga** (`cargas`, estado `pendiente`, con `dispatch_id`).
- **No se muestra la planta en vivo.** No hay botón aparte "Despachar y cargar": "Despachar" ya manda la orden, como en Loop.
- **En la tarjeta del camión**, un indicador chico con link **"Ver carga"** (abre `/carga` con esa orden):
  - "En cola de carga · 1°" (o "· frenada", si la receta no deja cargar);
  - "Cargando · ciclo 1/2", o "Carga parada" / "suspendida";
  - "Cargado 12:41 · esperando salir";
  - después, el GPS lo pasa a "Yendo a obra" como siempre.
- **Aviso de receta antes de despachar:** la línea "En la planta" de la Entrega muestra Receta, Agua y Tolva.
  - Si el cemento, los áridos, el aditivo o la Tolva 1 no coinciden, pide tildar "**La carga va a quedar frenada en la planta** … ¿Despachar igual?" (pregunta 19.12.1).
  - El agua distinta solo se muestra en ámbar.
- En la columna Viajes, la etiqueta "receta ✕" (frena) o "agua !" (no frena).

**Carga** (pantalla propia, en la PC de la planta):
- Cola (lo que llegó de Despacho, con la hora en que bajó), planta en vivo grande, tabla de pesajes y chequeo.
- CARGAR, Suspender, Bocina y **Extra agua**, reporte y PARAR fijo.
- Pestañas **Recetas de la planta** y **Alertas**.
- Lo de 5.3 a 5.5 y 18.3 (cancelar y parar a mitad) sigue valiendo, con la densidad de 18.2.

**Auditoría de carga:** como el punto 11, más tiempos (19.6) y agua extra (19.5).

**Emparejador** (el "broker" de Loop): une con su remito las cargas que nacen en Indumix sin orden nuestra (a mano, sin internet o con el puente caído):
1. por remito en "Observación";
2. si no, por camión y hora.

Además, cuando una orden de la cola ya fue cargada a mano (se vio su carga en Indumix), la marca "**Ya cargada en Indumix**" y no muestra CARGAR, **para que no se cargue dos veces** (19.8).

### 19.3 Nota de pedido (reemplaza 18.4)
- **Todo pedido programado tiene NP**, porque se genera al programar (`zomatik.md` §16.2, Z3). Por eso **un viaje siempre tiene NP**, y ni el despacho ni la carga la vuelven a controlar en pantalla: se muestra como dato ("NP 0001-00000817").
- **Si al programar Zomatik estaba caído**, el pedido queda "**NP pendiente**" y se resuelve **en Programación** (reintentar), no en la planta.
- Si llega el momento de despachar y la NP sigue pendiente, **un gerencial** autoriza "Despachar sin NP (Zomatik caído)", con motivo. La NP se genera cuando Zomatik vuelve y queda un aviso hasta que exista.
- `registrar_despacho` frena si el pedido no tiene NP `ok`, salvo esa autorización (`dispatches.np_excepcion_por`, `np_excepcion_motivo`).
- **El plantista no genera NP.** Se saca "Generar NP ahora" del despacho y de la carga. Generarla queda en Programación, para quien tiene `programacion.cargar` (pregunta 19.12.5).
- **Despacho manual** (sin pedido programado): **queda para después**. Cuando se haga, podrá salir sin NP y quedar "NP pendiente", o generarla en el momento quien tenga permiso.

### 19.4 Agua: resalta, no frena (reemplaza los puntos 1 a 3 de 6.5.1)
- **Frenan la carga solo el cemento, los áridos, el aditivo de planta y la Tolva 1 equivocada.**
- **El agua distinta de la receta** (comparada sobre la receta base, 6.1) se muestra **en ámbar** en la Entrega, en la cola, en el chequeo y en el reporte, con la relación agua/cemento de las dos recetas. Queda marcada "**Agua distinta**" en la auditoría y en la alerta de la receta.
- Ya no existe "Agua en consulta con Grow". La ficha para Indumix sigue llevando el agua **solo si se tilda "Grow confirmó el agua"**.
- Ejemplo, H30-612-15 B: el cemento 350 contra 330 **frena**, hasta corregir la planta o autorizar la carga. El agua 110 contra 168 **se resalta**.

### 19.5 Extra agua
- **Botón "Extra agua"** en la pantalla de carga: es el de Indumix.
  - Se usa **durante la carga**, o **después de terminar** mientras el camión sigue en la planta.
  - Pide los litros (atajos de 10, 20, 30 y 50 L).
  - El puente lo manda a Indumix (etapa C). En las etapas A y B se **lee** del reporte de Indumix ("Extra … Litros").
- **Se registra todo** en la tabla nueva **`cargas_agua_extra`**: `id`, `carga_id`, `dispatch_id`, `at` (hora del puente), `litros`, `despues_de_terminar` (bool), `usuario`, `origen` ('sistema' | 'indumix_reporte' | 'indumix_vivo').
- **Reporte:** fila "Agua extra" con cada agregado, el agua total (real + extra) y la relación agua/cemento real.
- **Auditoría:**
  - columna "Agua extra" y categoría "Agua extra";
  - resumen del día: total de litros, cuántos camiones, cuánto después de terminar, y **por fórmula, por camión y por plantista**.
  - Queda listo el dato para el análisis que quiere Bautista: por camión, fórmula, plantista y mes (Fase 6, indicadores).
- El agua extra **no descuenta stock** (el agua no descuenta, 0b). Sí entra en el agua total de la auditoría.
- **El "Agua extra en planta (L)" de la Entrega** (lo de hoy) se mantiene para el despacho sin carga. Con carga, el agua extra real es la que registra el puente.

### 19.6 Tiempos
Todo con la hora del puente, salvo el GPS:

| Momento | De dónde sale | Dónde queda |
|---|---|---|
| Llegada del camión a la planta | GPS (`viajes_gps.llegada_planta_previa`, fase 4a) | `viajes_gps` |
| Despachado | Hora en que se grabó el despacho | `dispatches.created_at` (fijo, 13.5 de la fase 3) |
| **"Salió a las"** | Lo de la fase 3: la hora del despacho o la corregida a mano | `dispatches.dispatch_date`, **sin cambios** |
| La orden bajó a la planta | Puente | `cargas.bajada_at` |
| **Inicio de carga** | Puente (CARGAR o el arranque visto en Indumix) | `cargas.inicio_at` |
| **Fin de carga** | Puente | `cargas.fin_at` |
| **Tiempo de carga** | fin − inicio | se calcula |
| **Salida de la planta** | GPS (sale de la geocerca de 250 m) | `viajes_gps.salida_planta`, unido por `dispatch_id` |
| **Espera hasta salir** | salida − fin de carga | se calcula |
| Espera antes de cargar | inicio de carga − llegada a planta | se calcula |

- Vista **`cargas_tiempos`**: une `cargas`, `dispatches` y `viajes_gps` por `dispatch_id`. Así el "tiempo en planta" de la 4a (`min_en_planta`) se abre en **espera antes de cargar + carga + espera después**. Se suma a los indicadores logísticos que ya existen (ciclo, ida, obra, vuelta).
- Se deja sin efecto lo de 18.3 ("Salió a las" = fin de carga): **se guardan las dos cosas** y no se pisa ninguna.

### 19.7 Remito (reemplaza 18.3, punto 3, y la pregunta 18.7.4)
- El remito **se imprime al despachar** ("Despachar e imprimir"), con el cálculo teórico, como hoy y como en Loop.
- Si la carga se cancela o se tira, el despacho se **anula** (18.3) y el papel se marca anulado.
- Si sale con menos, el m³ del despacho se corrige con motivo y se puede reimprimir.

### 19.8 ¿Qué pasa si se corta el wifi? (para contarle a Bautista)

**En pocas palabras:** la planta no depende de internet. Indumix y el PLC siguen funcionando solos, y las paradas físicas andan siempre. Lo que necesita internet es **mandar órdenes nuevas** desde la oficina y **subir** los resultados; eso espera y se pone al día solo cuando vuelve la conexión.

Hay tres cortes distintos:

**A. Se corta internet en la planta, con una carga en curso**
- **La carga sigue.** La maneja Indumix con el PLC en la red local, y nada de eso usa internet.
- **El PARAR de Indumix y la parada de emergencia andan siempre.** Nuestro PARAR también, porque va de la pantalla al puente y del puente a Indumix, todo dentro de la planta. La pantalla de carga sigue mostrando la planta en vivo, porque esos datos también son locales.
- **El puente guarda todo** (pesos, reporte, agua extra, eventos) en su archivo local y **lo sube cuando vuelve internet**, sin duplicar. La pantalla muestra "N por subir".

**B. Despachos nuevos mientras la planta no tiene internet**
- **Lo que ya bajó se puede cargar.** El puente tiene guardadas las órdenes de la cola, las 20 recetas, las fórmulas del día, el mapa de tolvas y las tolerancias, así que puede controlar la receta y cargar las órdenes que ya estaban en la cola.
  - El permiso de arranque, que en línea firma la nube (3.2.3), sin internet lo reemplaza el **PIN del plantista**, guardado en el puente al iniciar el día (pregunta 19.12.2). Todo queda registrado y se sube después.
- **Lo que se despache ahora no baja.** Si la oficina tiene internet (por ejemplo, la tablet con datos), el despacho se graba y el remito se imprime, pero la orden **espera en la nube**. En Despacho se avisa: "La PC de la planta no tiene internet".
- **Se sigue como hoy:** el plantista carga a mano en Indumix, con el **número de remito en "Observación"**. Cuando vuelve internet:
  1. el puente sube los reportes de Indumix (los últimos 10);
  2. el **emparejador** une cada carga con su remito (por Observación, o por camión y hora);
  3. la orden que había quedado en la nube aparece como "**Ya cargada en Indumix**", y no como pendiente, **para no cargarla dos veces**.
- **Si no hay internet en ningún lado**, se trabaja con el talonario de papel como hoy, y los despachos se cargan después con su "Salió a las" real. El emparejador hace lo mismo.

**C. Se corta la red local entre la PC y la planta** (cable o wifi entre la computadora e Indumix)
- **La carga en curso sigue**, porque el PLC termina su ciclo solo, con sus seguridades.
- **Nuestra pantalla deja de ver la planta** y nuestro PARAR no llega: aparece "Usá el PARAR de Indumix o la parada de emergencia".
  - **Ojo:** si la pantalla de Indumix corre en esta misma PC por la misma red (`192.168.0.10` en el navegador), **también se pierde**. Queda la **parada de emergencia física**. Hay que confirmarlo el jueves.
- La carga queda "**sin datos desde las 12:34**". Al volver la red, el puente lee el estado real y el reporte, completa la carga y **no arranca nada solo**.
- **Recomendación:** que la PC y el PLC vayan **por cable, no por wifi**, con el switch y la PC en una **UPS**. Se suma a lo que hay que mirar el jueves.

### 19.9 Cambios al modelo de datos (se suman a 8 y 18.6)
| Cambio | Para qué | Qué pasa con lo cargado |
|---|---|---|
| Tabla nueva `cargas_agua_extra` (19.5) | Registrar el agua extra | — |
| `cargas.bajada_at` | Cuándo llegó la orden a la planta | — |
| `cargas.estado` suma `ya_cargada_indumix` | La orden se cargó a mano (19.8.B) | — |
| Vista `cargas_tiempos` (19.6) | Tiempos de planta | Solo lectura, no toca datos |
| `dispatches.np_excepcion_por`, `np_excepcion_motivo` | Despachar sin NP con Zomatik caído (19.3) | Nulos |
| `scheduled_dispatches`: estado de NP "pendiente" (lo define `zomatik.md`) | Zomatik caído al programar | — |
| **El puente guarda en local:** órdenes de la cola, recetas leídas, fórmulas del día, mapa de salidas, tolerancias, hashes de los PIN y la cola por subir | Trabajar sin internet (19.8) | Archivo local en la PC, no en la base |
| Se saca: el botón "Despachar y cargar" (18.3), "Generar NP ahora" en despacho y carga (18.4) y "Agua en consulta" (6.5.1) | Lo pidió Bautista | — |

### 19.10 Permisos (cambia el 12)
- Generar NP: solo en Programación (`programacion.cargar`), no en despacho ni en carga.
- Despachar sin NP: solo gerencial, con motivo.
- Extra agua: `carga.cargar`, en la PC de la planta.
- Arranque sin internet: plantista con `carga.cargar` y su PIN.

### 19.11 Criterios de aceptación (reemplazan 16 a 19 de 18.8; 15 y 20 siguen)
16. **Despachar** (en una planta con puesto en etapa B o C):
    - graba el despacho como hoy;
    - imprime el remito teórico si se eligió "Despachar e imprimir";
    - crea la orden `pendiente` con `dispatch_id`;
    - la orden aparece en `/carga` de la PC de la planta en menos de 5 s;
    - la tarjeta del camión muestra "En cola de carga · Ver carga".
17. **Receta:** con cemento, áridos, aditivo o Tolva 1 distintos, la Entrega pide confirmar "queda frenada" y la carga no arranca. Con **solo el agua distinta**, la carga arranca, con el aviso ámbar y la marca "Agua distinta" en la auditoría.
18. **Extra agua:** durante la carga y después de terminarla (con el camión en planta) queda una fila en `cargas_agua_extra` con litros, hora, usuario y `despues_de_terminar`. La auditoría muestra el total por camión, fórmula y plantista.
19. **Tiempos:** cada carga tiene inicio, fin y tiempo de carga. Con el GPS, también salida de la planta y espera hasta salir. "Salió a las" (`dispatch_date`) no cambia al terminar la carga.
21. **Sin internet:**
    - la carga en curso, la vista en vivo y el PARAR siguen andando;
    - las órdenes ya bajadas se pueden cargar con el PIN;
    - las nuevas no bajan;
    - al volver, se sube todo sin duplicar, y una orden cargada a mano queda "Ya cargada en Indumix" (no se puede volver a cargar).
22. **Sin red local:** la pantalla avisa, no se manda nada, y al volver se completa la carga con el reporte, sin arrancar nada solo.
23. **NP:** un viaje programado siempre muestra su NP. Despachar un pedido con NP pendiente solo lo puede hacer un gerencial, con motivo.

### 19.12 Preguntas que quedan (con recomendación)
1. **¿Se puede despachar un viaje cuya receta frena la carga?** Recomiendo **sí, con confirmación** ("queda frenada en la planta"), como en la maqueta. En la planta se resuelve rápido con la ficha, y bloquear el despacho obligaría a resolver todo desde la oficina. La otra opción es bloquear el despacho hasta que se resuelva.
2. **¿Arranque sin internet con el PIN del plantista?** Recomiendo **sí**, solo para las órdenes que ya bajaron y con la receta controlada contra lo guardado. Si no, un corte de internet obliga a cargar a mano en Indumix.
3. **¿Aviso por mucha agua extra?** Recomiendo un aviso (no bloqueo) cuando se pasan **15 L/m³**, o cuando se agrega agua después de terminar la carga en una fórmula con agua distinta. Que lo vea el laboratorio.
4. **¿El indicador de carga en la tarjeta del camión alcanza**, o también se quiere una franja chica arriba del despacho ("Cargando AG083GT · ciclo 1/2")? Recomiendo **solo la tarjeta**, que es lo que pidió.
5. **"Generar NP" en Programación:** ¿quiénes? Recomiendo los de `programacion.cargar` menos los plantistas, hasta que Bautista diga lo contrario. Hoy Titan tiene ese permiso, así que hay que separarlo, por ejemplo con `programacion.editar`, o un permiso propio "Zomatik · generar NP".

## 20. Respuestas de Bautista (21/10/2026, 3) — mandan sobre lo anterior

Responde a las preguntas de 19.12. **La maqueta no cambia todavía**: primero Bautista define la secuencia.

1. **Despachar un viaje cuya receta frena la carga: se permite**, con la confirmación de la Entrega ("La carga va a quedar frenada en la planta… ¿Despachar igual?").
   - Además, **mail a Juan Oreguy** (Resend, como `app/api/alertas/stock-cero`) con el remito, el camión, la fórmula, la receta de la planta y qué no coincide.
   - Queda en Actividad y en la alerta de la receta.
   - Cierra 19.12.1.
2. **Sin internet: sin PIN ni ningún paso extra.** Con la planta sin internet, la pantalla de carga tiene que poder cargar todo lo que ya está en la cola **igual que con internet**: se elige la orden, se confirma que el camión está abajo y se aprieta CARGAR.
   - **Cambia 19.8.B y 19.10:** sin internet no hace falta el permiso firmado por la nube (3.2.3) **para las órdenes que ya bajaron**. El puente las acepta igual, porque:
     - la orden ya la validó la nube al bajar (despacho con NP, persona con permiso);
     - el puente vuelve a controlar la receta contra lo que tiene guardado;
     - el arranque solo puede venir de esa misma PC (`127.0.0.1`).
   - Se guarda quién estaba con la sesión abierta y todo se sube al volver internet.
   - **Con internet todo sigue igual** (permiso firmado de 60 s, un uso). Un despacho **nuevo** sigue necesitando internet para llegar a la planta: mientras tanto, se carga a mano en Indumix con el remito en Observación y el emparejador lo une después (19.8.B, sin cambios).
   - Se saca el "PIN del plantista" de 19.8, 19.9 (hashes de PIN en el puente), 19.10 y del criterio 21 de 19.11. La maqueta lo muestra todavía en el primer paso de "Arrancando" cuando no hay internet: se corrige cuando se rehaga.
   - Cierra 19.12.2.
3. **Agua extra: queda como está.** Se registra (19.5) y se ve en la auditoría, pero **sin aviso por cantidad**. Cierra 19.12.3.
4. **Permisos: el plantista no carga programación, por ahora.** Se define con Bautista durante el **período de prueba de 2 semanas**.
   - **Pendiente:** separar el permiso de **"generar NP en Zomatik"** del de **"cargar programación"** (`programacion.cargar`). Hoy Titan tiene `programacion.cargar` (fase 0c).
   - Esto toca `lib/permisos.ts` y `zomatik.md`: hay que coordinarlo con esa spec.
   - Cierra 19.12.5, que queda como pendiente para después de la prueba.

Sigue abierta 19.12.4: ¿alcanza el indicador en la tarjeta del camión? La recomendación sigue siendo que sí.

## 21. Respuestas de Bautista (21/10/2026, 4) — mandan sobre lo anterior

1. **Secuencia A, como en Loop (decidida):**
   1. **Despachar:** se graba el despacho y se imprime el remito con los **m³ programados** (stock teórico).
   2. La orden pasa a la **cola de carga** de la PC de la planta.
   3. **Se carga** en la pantalla de carga.
   4. Al terminar, el stock se ajusta con los **kilos reales** (18.5).

   Si la carga sale distinta (PARAR), **se corrige el remito** según la tabla de 18.3:
   - "sale con lo cargado": se corrigen los m³ y se puede reimprimir;
   - "completar con otra carga": mismo remito;
   - "se tiró": el despacho queda anulado y el papel, marcado anulado;
   - cancelada antes de arrancar: anular o cambiar de camión.

   Es lo que ya tenía la maqueta. Ahora "Qué probar" lo explica paso a paso.
2. **El plantista (Titan) sí carga programación y, por lo tanto, genera la NP al programar.**
   - **No se separa el permiso:** generar la NP va con `programacion.cargar`, como está.
   - Se saca el pendiente del punto 20.4 y la pregunta 19.12.5.
   - Sigue valiendo que la NP no se genera desde el despacho ni desde la carga: se genera al programar (19.3).
3. **Sin internet, sin PIN** (confirma el punto 20.2). La maqueta ya no lo muestra: el primer paso de "Arrancando" sin internet dice que la orden ya bajó y la validó la nube, y que el puente la acepta sin pedir nada extra.

## 22. Respuestas de Bautista (21/10/2026, 5) — mandan sobre lo anterior

1. **La muestra pasa al final de la carga.**
   - En la Entrega de la pantalla nueva de despacho, **cuando la planta tiene puesto de carga que recibe órdenes**, ya no se carga la muestra (número y asentamiento): queda solo la casilla opcional **"Sacar muestra a este camión"**, que es un aviso para la planta (`cargas.muestra_pedida`). `registrar_despacho` no cambia.
   - En la pantalla de Carga, al terminar: **"¿Se sacó muestra?" (Sí / No)**. Con Sí se piden el número y el asentamiento medido y se crean las probetas con **el mismo camino que "Agregar muestra después del despacho" del Historial** (`lib/muestra.ts`: marca el despacho y, si no tenía, crea 3 probetas a 7 y 28 días con el moldeo en la fecha del despacho; pide `historial.cargar`). El Historial usa ahora esa misma función. Si el camión tenía la casilla marcada, la pregunta viene destacada. La respuesta queda en `cargas.muestra`.
   - El trigger `trigger_create_test_cylinders` corre solo al insertar el despacho: por eso las probetas de una muestra que se agrega después las crea esa función, como siempre hizo el Historial.
   - Si se olvida, se agrega después desde el Historial, igual que hoy.
   - **Sin cambios:** la pantalla de despacho de siempre, el despacho manual y la Entrega de una planta sin puesto de carga (por ejemplo, Hudson), con su muestra al despachar.
2. **Tiempos, con la secuencia A** (en la Auditoría de carga y en el reporte de cada carga): despacho (hora fija del remito) · inicio y fin de carga (de la planta) · salida de planta (GPS) · **espera en cola** (despacho → inicio) · tiempo de carga (inicio → fin) · espera hasta salir (fin → salida GPS). La vista `cargas_tiempos` suma `min_espera_cola`.
3. **Detalles de la segunda revisión:** el inicio de carga se registra cuando la planta aprieta CARGAR (no cuando se pide el permiso); un 403 permanente (sin permiso) no traba la cola sin internet (se aparta; si es la sesión o la contraseña, se conserva); la ruta de recetas saca los repetidos antes de `armar_recetas_puesto`; "Armar las 20 recetas" avisa (y abre la alerta) si una receta que ya estaba leída cambia.

## 23. Respuestas de Bautista (21/10/2026, 6) — mandan sobre lo anterior

1. **Formulario Entrega más grande y compacto:** la ventana es más ancha (960 px), con letra de 12–13 px, campos de 30 px de alto en 3 columnas, y Fibra y Muestra lado a lado, para completarla sin scrollear.
2. **Viajes programados:** la hora y el atraso pasan a un indicador chico (franja roja, punto y "+15'" en letra chica; ámbar si es "ahora"). Destacan **obra, cliente, fórmula y m³**; la finalidad y la bomba siguen a la vista, en chico.
3. **Agua extra:**
   - Se saca "Agua extra en planta (litros)" de la Entrega **solo** en la pantalla nueva y en plantas con puesto de carga que recibe órdenes. `registrar_despacho` sigue recibiendo `extra_water_liters` = 0 (no cambia). La pantalla de siempre y el despacho manual no cambian.
   - El agua extra se registra **en la carga**: el botón "Extra agua" de la pantalla de Carga funciona **manteniendo apretado**. Mientras se mantiene, el agua cae al camión con caudal constante; al soltar se frena. Se ven los litros de la pulsada en vivo y el total del camión. Cada pulsada es una fila de `cargas_agua_extra`; el total queda en la carga (la línea del agua de `cargas_materiales`, `extra`) y en el reporte y la auditoría.
   - Simulador: caudal fijo de **2,5 L/s** (`CAUDAL_AGUA_EXTRA_LPS`). Mouse y dedo (pointer events); se frena si el puntero sale del botón, si se pierde el foco o se oculta la pestaña.
   - **Seguridad:** la pantalla tiene que "mantener" la válvula cada 250 ms; si deja de hacerlo (se soltó, se colgó o se cortó la comunicación con el puente), la planta la cierra sola en 1 s (`VIGIA_AGUA_EXTRA_S`). Si se corta la comunicación, se cierra en el momento.
4. **"Ya salió" pasa a "Terminar carga".** Cuando la planta termina de pesar, la carga sigue abierta (el camión sigue abajo y se le puede agregar agua). **"Terminar carga"** la cierra: registra el fin y el agua extra total, aparece "¿Se sacó muestra?" y el camión queda "Cargado · esperando salir" hasta que el GPS lo ve salir. La planta no queda libre para la próxima orden hasta terminar la carga. El despacho ya estaba grabado antes (secuencia A).

## 24. Respuestas de Bautista (22/10/2026) — columna Viajes y tarjetas del despacho

1. **Sin negritas:** en Viajes solo la obra va en peso 500; el resto, normal. Lo mismo en Camiones (la patente en 500) y Pedidos (el cliente en 500): fuera `font-semibold`/`font-bold`, también en las etiquetas R/X.
2. **Letra más chica:** 12 px base y 11 px lo secundario. Viajes: línea 1 = hora chica · **obra** · m³ a la derecha; línea 2, en gris = cliente · fórmula · finalidad · bomba/directo · R/X (y fibra, 👍, camión sugerido, n/N). Sin etiquetas grandes ni colores fuertes; el atraso es un punto y "+15'" chicos, más la franja.
3. **Despachar** chico: 24 px de alto, 11–12 px, con borde y sin relleno, a la derecha.
4. **El ▾ del viaje** muestra solo lo útil para despachar: dirección de la obra (con link al mapa si hay ubicación o dirección), observaciones del pedido, bomba (empresa y hora), contacto de obra (`site_contact`, `site_phone`) y si lleva fibra. Se sacaron los tiempos (carga, salida, llegada, vuelta) y lo demás. "Sacar muestra" no tiene dato en el pedido: se marca en la Entrega (punto 22).
5. Camiones y Pedidos con el mismo criterio: botones de 24 px, 11–12 px, sin negrita.

## 25. Respuestas de Bautista (22/10/2026, 2) — las tarjetas del despacho, copiadas de Loop

Bautista pidió copiar exactamente cómo lo hace Loop (capturas `despacho_pantalla_principal.jpg`, `site_despacho_web.jpg` y `despacho_betoneiras_de_planta.jpg`). Reemplaza el punto 24 en lo que se contradiga.

- **Viajes ("Tickets"):** fila 1 chica y gris con el número de pedido (y un ícono de bomba si es bombeado) y, a la derecha, 👍 si está confirmado y "n/N", con una línea finita abajo; fila 2 con el cliente y "8 m³ › 14:13" (m³ del viaje y hora de carga), 13 px y peso 500; fila 3 gris con la obra; fila 4 gris chica con la fórmula, 📋 (observaciones en tooltip) y ⋮. Tarjeta gris clara, borde fino y barra violeta a la derecha; **atrasado = todo el borde rojo**, sin texto. **Sin botón Despachar:** se arrastra al camión, se toca la tarjeta y después el camión, o ⋮ › Despachar. Lo que antes estaba en el ▾ (dirección, finalidad, bomba, fibra, R/X, contacto, camión sugerido) queda en el tooltip de la tarjeta, y ⋮ suma "Ver la obra en el mapa".
- **Número de pedido:** el sistema no tiene un número de pedido como Loop. Por ahora es el **número del pedido en el día** (1, 2, 3… por hora pedida). Cuando esté Zomatik se puede usar la NP.
- **Camiones ("Betoneiras"):** ícono del mixer con la patente en azul abajo; el punto de estado con el tiempo en ese estado ("03h42", "41min"); el chofer con su ícono; a la derecha y en chico, dónde está y la fuente (GPS, estimado o a mano). Siguen "¿Volvió?", ⋮ y el indicador de la carga de planta.
- **Pedidos ("Programações"):** "número – hora pedida", el cliente en gris y "14 / 35 m³"; a la derecha ⓘ (el detalle) y ⋮ (el menú de siempre); barra violeta a la izquierda.
- **Buscador** ("Buscar:") arriba de las tres columnas: filtra en la pantalla por número, cliente, obra, fórmula, patente o chofer.
- **Contadores** como Loop: una caja chica con íconos (programado, despachado, %, pendiente, suspendido, cancelado y adicional = lo despachado sin pedido programado), al lado del título, en lugar de la franja de texto.

## 26. Respuestas de Bautista (22/10/2026, 3) — Carga y Auditoría con el criterio del despacho

La pantalla de Carga (`/carga`) y la Auditoría usan el mismo criterio visual que el despacho con tarjetas estilo Loop: 12 px de base (`text-xs`) y 10,5–11 px lo secundario; sin negritas salvo los datos clave en peso 500; grises suaves (`slate-500`) para lo secundario; tarjetas gris claro con borde fino (la cola de carga como los tickets del despacho, con la barra de color a la derecha, roja si está frenada); color solo en franjas, barras y etiquetas suaves (las balanzas, el estado de la planta y las categorías de la auditoría pasaron a etiquetas suaves); botones chicos de 26 px con borde o fantasma, salvo **CARGAR, PARAR y "mantener apretado"**, que siguen grandes; encabezados de columna en 13 px y peso 500 con el contador en gris; buscador arriba de la cola, las alertas y la tabla de la auditoría. En alto contraste, los grises suaves, los bordes finos y los fondos gris claro se refuerzan. Se usa `text-xs` en lugar de `text-[12px]` (también en el despacho).

## 27. Respuestas de Bautista (22/10/2026, 4) — columna de la carga más chica y detalle del viaje

1. **Carga, columna 3 a 300 px** (la planta en vivo gana el espacio). Menos texto, no menos datos:
   - cabecera en 2 renglones: patente · remito / fórmula · m³ y ciclos (cliente, obra, quién despachó y cuándo bajó, en "Más datos");
   - controles: los que fallan y los avisos sueltos; los que están bien, en "✓ N controles OK", que se abre;
   - fórmula contra planta: si coincide, "✓ Receta N igual a la fórmula", que se abre; si no, solo las filas que fallan y "Ver los N materiales". La tolerancia va en el tooltip de la diferencia y el % solo si falla;
   - CARGAR, Bocina y Cancelar en un renglón; el motivo del bloqueo en una línea, que se abre. Igual en la vista remota.
   - Las salidas de la planta se reparten el ancho (entre 50 y 78 px) para entrar en un renglón; con menos de 70 px, nombres cortos ("6/12", "0/6", "A. fina", "Sika 90E"). Cuentas: a 1366 con el menú quedan ~543 px → 51 px por salida; a 1920, 78.
2. **Despacho, Viajes:** el detalle del viaje se abre solo al elegirlo (tocar la tarjeta) y se cierra al elegir otro; la flecha sigue andando a mano.

## Hecho

### Etapa simulada (21/10/2026, rama `loop/carga-planta`, sin publicar)

La pantalla de carga está en el sistema con la **planta SIMULADA** hasta ver el jueves 23/10 cómo se conecta Indumix. **No existe ningún programa que hable con Indumix ni con `192.168.0.10`.** Todo se ve solo con el interruptor `ve_funciones_nuevas` (hoy, Bautista y Juan).

**Qué hay:**
- **Puente** (`lib/carga/puente.ts`): la interfaz que usa la pantalla (leer recetas, estado y reportes; cargar la orden y arrancar con los pasos de 5.4; parar, suspender, reanudar, bocina y extra agua). La única implementación es el **simulador** (`lib/carga/simulador.ts`), que corre en el navegador de la PC de la planta: ciclos de hasta 1,5 m³, áridos en el orden de la receta, cemento/aditivo/agua en paralelo, humedad (268 L de la receta 13), compensación del último ciclo (521,925), error de pesaje chico, reloj de 1970, y fallas (alarma, receta cambiada, red local cortada, PLC que no arranca, carga desde Indumix). `crearPuente("indumix")` tira error a propósito: se programa después del jueves.
- **Control de receta** (`lib/carga/receta.ts`): tolerancias de 6.2, Tolva 1 con alternativas (6/12 o 6/20), salida sin material, material sin salida; **frenan cemento, áridos, aditivo y la Tolva 1; el agua resalta y no frena** (19.4). Ficha para Indumix con el agua solo si "Grow confirmó".
- **Pantalla Carga** (`/carga`): cola, planta en vivo, chequeo, CARGAR con "¿El camión está abajo?" (mantener 1 s), Suspender/Reanudar, Bocina, Extra agua (durante y después de terminar), PARAR fijo de 132×60 sin permiso, qué pasó con una carga parada (sale / completar / se tiró) y Cancelar. Pestañas **Recetas de la planta** (las 20, el mapa de salidas, cambiar la Tolva 1, etapa del puesto, fórmulas sin lugar) y **Alertas** (Resolver con Fórmulas · editar: corregir la planta o autorizar solo esta carga; "corregir la fórmula" no se ofrece con la planta simulada). Cartel fijo **"PLANTA SIMULADA — no mueve la planta real"**. "Esta es la PC de la planta / Otro equipo (solo mirar)" se elige por equipo; en la vista remota no aparecen CARGAR ni PARAR.
- **Sin internet** (simulado con "Simular…"): la carga en curso y el PARAR siguen; lo que ya bajó se carga **sin PIN ni nada extra** (20.2); lo nuevo no baja; lo que hay que subir queda en una cola del equipo y se sube después sin duplicar (cada pedido lleva su id).
- **Emparejador** (`lib/carga/auditoria.ts`, `/api/carga/indumix`): una carga vista en Indumix sin orden nuestra se une a una orden de la cola ("Ya cargada en Indumix", no se vuelve a cargar) o a un despacho, por remito en Observación o por camión y hora; si no, queda "Sin remito" con alerta.
- **Auditoría de carga** (`/carga/auditoria`): despacho ↔ carga, las categorías del punto 11 (+ agua distinta, agua extra, parada), tiempos (inicio, fin, tiempo de carga, salida por GPS y espera), agua extra por fórmula, camión y plantista, cemento real contra teórico, Excel y "Marcar revisada".
- **Despacho** (cambio chico en `components/despacho/*`): en la Entrega, la línea "En la planta" (Receta, Agua, Tolva) y, si frena, la casilla "La carga va a quedar frenada en la planta… ¿Despachar igual?"; al despachar, la orden va a la cola (`/api/carga/enviar`) y, si sale frenada, **mail a Juan Oreguy** (Resend, como `alertas/stock-cero`; el asunto dice "[PLANTA SIMULADA]"). En la tarjeta del camión, el indicador chico ("En cola de carga · 1° · simulada", "Cargando · ciclo 1/2", "Carga parada", "Cargado 12:41 · esperando salir") con **Ver carga**. NP: solo el espacio reservado "NP: se controla cuando esté Zomatik", sin bloquear.
- **Orden de prueba** (solo en el simulador): una carga sin despacho, para probar sin mandar un camión.
- **Permisos** (`lib/permisos.ts`): sección `carga` (ver, cargar, editar). Resolver una receta pide `formulas.editar`. Todo se controla en las rutas `/api/carga/*` (sesión 0c-1 + funciones nuevas).

**Base:** migración `supabase/migrations/202610211800_carga_planta.sql`, **NO aplicada**. Tablas `puestos_carga`, `puesto_salidas`, `recetas_planta` (+ vista `recetas_planta_actual`), `puesto_recetas`, `cargas`, `cargas_materiales`, `cargas_eventos`, `cargas_agua_extra`, `alertas_carga`, vista `cargas_tiempos`, función `ajustar_stock_carga` y un trigger de seguridad en `stock_movements`. Crea el puesto "Canning · simulador" **apagado** (etapa `apagado`: Despachar no manda órdenes hasta que Bautista lo prende) con el mapa de salidas de 6.3, y suma la sección `carga` en `app_users.permisos` (gerenciales todo; operarios y consulta "ver"; Titan y David además "cargar"; no cambia ninguna otra casilla). El navegador solo puede **leer** estas tablas (RLS prendido con una política de SELECT, como `alertas_stock`; las vistas con `security_invoker`). "Armar las 20 recetas" es atómico (`armar_recetas_puesto`, todo o nada). Una sola carga en la planta a la vez por puesto (índice único). Quedan para el puente real: credencial del puesto, secreto de arranque, latido, versión y deriva del reloj; `materials.dosifica_planta` (se usa `materials.tipo`); `anular_despacho` por carga y el control de NP en `registrar_despacho`. Probada dos veces en `BEGIN … ROLLBACK` (lock_timeout 2 s, statement_timeout 60 s), con datos inventados dentro de la transacción.

**Stock:** `ajustar_stock_carga` graba `movement_type = 'consumo'` con real − teórico, igual que `_aplicar_neto` (positivo = se consumió más y baja el stock; negativo = se devuelve). **Antes de prenderlo hay que definir con Bautista si se compara húmedo o seco** (hoy: áridos en seco con la humedad de Indumix contra `dry_quantity` del despacho). Las cargas simuladas quedan `simulada = true` (todas las del puesto simulador, por trigger) y **nunca mueven el stock**: CHECK en `cargas`, error en `ajustar_stock_carga` y trigger en `stock_movements`. El ajuste con kilos reales (18.5) está programado en `ajustar_stock_carga` y **apagado** (`puestos_carga.usa_kilos_reales = false`; el simulador no lo puede prender). Tampoco se corrige el despacho real: "sale con lo cargado", "se tiró" y "cancelar" solo quedan registrados con lo que se haría (`lib/carga/cierre.ts`).

**Cómo probarlo (después de aplicar la migración, en el preview):**
1. `/carga` › Recetas de la planta › **Armar las 20 recetas del simulador** (Carga · editar). Para que Despachar mande órdenes a la cola, ahí mismo: **Etapa › C · Cargar desde el sistema** (arranca apagado). La 13 es la H30-612-15 B con los valores de la foto: frena por cemento y resalta el agua.
2. Elegir **"Esta es la PC de la planta"**. "Simular… › Orden de prueba" pone una carga en la cola sin despachar nada. CARGAR → mantener "está abajo" → mirar los ciclos (velocidad x10 para ir rápido) → Extra agua → reporte.
3. Desde `/plantista` (pantalla nueva), despachar un viaje de Canning (**el despacho es real, como siempre: remito y stock teórico; lo simulado es solo la carga**): la orden aparece en la cola y la tarjeta del camión dice "En cola de carga · Ver carga". Con la H30-612-15 B, la Entrega pide confirmar que queda frenada y se manda el mail a Juan.
4. Resolver la receta 13 (Alertas › Resolver › Corregir la planta) y "Simular… › Aplicar en Indumix la ficha pedida": la alerta se cierra sola y la carga se desbloquea.
5. "Simular…": cortar internet, cortar la red local, alarma, PLC que no arranca, carga hecha desde Indumix, la primera de la cola cargada a mano en Indumix. PARAR a mitad y elegir qué pasó.
6. `/carga/auditoria`.

**Ojo:** mientras el puesto simulado esté en etapa B o C, **todo despacho de Canning hecho desde la pantalla nueva** (Bautista o Juan) manda una orden a la cola simulada, y si la receta frena le llega el mail a Juan (marcado "[PLANTA SIMULADA]"; no se manda cuando el motivo es que la fórmula no tiene receta en la planta simulada). Para que no pase, Recetas de la planta › Etapa › "Apagado". Los despachos de prueba y los de hace más de 12 h no van a la cola.

**Arreglos de la revisión (21/10):**
- **PARAR mientras arranca** corta el arranque antes del paso que sigue (sobre todo antes de CARGAR), manda igual el PARAR a la planta y registra `no_arranco` con motivo "PARAR".
- **Cola sin internet:** sale de la cola solo lo que el sistema aceptó (2xx o "duplicado"); sin sesión (401/403) se conserva todo y avisa "Entrá de nuevo para subir N registros"; otro rechazo se aparta a "rechazados" del equipo (no se pierde). Lo que se encola va marcado `sin_internet`: si la orden se canceló en la nube mientras tanto, lo que hizo la planta se guarda igual en otra carga unida al mismo despacho, con la alerta "Se cargó sin internet una orden cancelada".
- **Arrancar y Cancelar** son condicionales en la base (solo si la carga sigue en la cola): no pasan dos a la vez.
- **Permisos:** suspender, reanudar, bocina, terminar y la carga desde Indumix piden Carga · cargar (mientras no exista la credencial del puesto); PARAR sigue con ver.
- **Entrega:** espera el control "En la planta" antes de dejar despachar y descarta respuestas viejas si se cambia de pedido.
- **Emparejador:** con los mismos dígitos prefiere el remito del mismo tipo (R/X, si la Observación lo dice), después el del mismo camión y después el más cercano en la hora.

**Respuestas del punto 22 (21/10, 5):** la muestra al final de la carga ("Sacar muestra a este camión" en la Entrega y "¿Se sacó muestra?" al terminar, con `lib/muestra.ts`, el mismo camino del Historial), la espera en cola en la Auditoría y el reporte, y los detalles de la segunda revisión. **La migración `202610211800_carga_planta.sql` ya está aplicada en producción (21/10, 11:44, puesto en etapa C, 20 recetas armadas)**: lo nuevo va en **`202610212000_carga_muestra_tiempos.sql`** (NO aplicada; `cargas.muestra_pedida`, `cargas.muestra` y `min_espera_cola`), probada dos veces en `BEGIN … ROLLBACK`. Hay que aplicarla junto con este deploy; mientras tanto la orden sale igual sin el aviso de muestra y la pregunta "¿Se sacó muestra?" no aparece (la muestra se agrega desde el Historial).

**Respuestas del punto 23 (21/10, 6):** Entrega más ancha y compacta; Viajes con el atraso en chico; sin "Agua extra" en la Entrega con puesto de carga; "Extra agua" mantenido con caudal constante y vigía de 1 s (cada pulsada en `cargas_agua_extra`); "Terminar carga" en lugar de "Ya salió". Sin cambios de base.

**Pruebas:** `npm run test:carga` (38: simulador, control de receta, puente con PARAR mientras arranca, reloj, emparejador con tipo y camión, auditoría, cierre, indicador, tiempos con la espera en cola, la muestra al final y el agua extra mantenida), más `test:despacho`, `test:gps` y `test:sesion` sin cambios. `tsc` sin errores nuevos (los 17 de siempre) y `next build --webpack` bien.

**Para después del jueves 23/10:** el adaptador real de Indumix (según el HAR), el servicio del puente en `127.0.0.1:8787` con el permiso de arranque firmado (3.2.3), el alta del puesto con credencial, el latido y "puente caído", la lectura de reportes con hora estimada (10), las 20 recetas reales y su asociación a fórmulas, corregir el despacho de verdad al parar o cancelar, la NP con la rama `loop/zomatik`, y prender el stock con kilos reales cuando lo diga Bautista.
