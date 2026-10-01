# Fase 2 — Programación que genera los viajes

Estado: **en desarrollo (01/10/2026)**. Bautista vio la maqueta y eligió publicarla en "modo prueba por usuario" (ver `entorno-prueba.md`).

Condición de Bautista (01/10): "No quiero que publiques algo demasiado complejo directamente y mañana no sepan usarlo". Por eso esta fase:
1. se publica **apagada**: solo la ven los usuarios con `app_users.ve_funciones_nuevas = true` (al principio Bautista y quienes programan), con el distintivo "Nuevo · en prueba". Para el resto todo queda exactamente como hoy (ver `entorno-prueba.md`);
2. cambia sobre todo **Programación**, que usan Titan, Felipe, Juan, Fernando y Bautista. **Despacho diario casi no cambia** para el plantista: solo ve qué viaje le toca, y el cambio grande de su pantalla es la Fase 3;
3. todo lo nuevo es **opcional al principio**: si un pedido no tiene viajes, todo funciona como hoy.

Leer antes: `README.md`, `fase-1.md` (tiempos por planta en `plants.t_*`, choferes, bomba), `lib/planificador.ts` (motor que ya existe), `components/programacion-dia.tsx` (vista Día).

## Objetivo

Que cada pedido quede partido en **viajes** guardados, como los "tickets" de Loop. Cada viaje tiene m³, hora de carga, salida, llegada, fin de descarga y vuelta, y un camión sugerido. Esos viajes se pueden ajustar a mano con un **gerenciador** tipo Gantt, se confirman **el día anterior**, y Despacho diario muestra qué viaje sigue.

## 0. Interruptor de funciones nuevas

- `app_users.ve_funciones_nuevas boolean default false`.
- Al iniciar sesión se lee y se guarda junto al usuario actual (`lib/current-user.ts`, un helper `veFuncionesNuevas()`).
- En **Actividad** (solo supervisor) va la sección "Funciones nuevas en prueba": la lista de usuarios con un interruptor, registrada en Actividad.
- Todo lo de esta fase se muestra solo con el interruptor prendido. Eso incluye viajes, gerenciador, sugerencia de horario, gráfico de demanda, confirmación y el aviso de próximo viaje en Despacho diario.
- **La generación de viajes en la base también es opcional:** solo se generan cuando un usuario con el interruptor guarda el pedido o el plan del día. Para los demás, el pedido se guarda como hoy. Si un pedido tiene viajes y alguien sin el interruptor lo edita, sus viajes pendientes se regeneran igual, para que no queden desfasados.

## 1. Datos

**Tabla `viajes`:**

| Columna | Qué guarda |
|---|---|
| `id` | |
| `pedido_id` | FK a `scheduled_dispatches`, `on delete cascade` |
| `plant_id` | |
| `n` | Orden del viaje: 1..N |
| `m3` | m³ del viaje |
| `hora_carga`, `hora_salida`, `hora_llegada`, `hora_fin_descarga`, `hora_vuelta` | Horarios planificados (timestamptz) |
| `mixer_id` | Camión sugerido (puede ser nulo) |
| `estado` | `planificado` / `despachado` / `cancelado` |
| `dispatch_id` | FK a `dispatches`; se completa al despachar |
| `actualizado_por`, `updated_at` | Quién y cuándo |

Índice único `(pedido_id, n)`.

**Columnas nuevas en `scheduled_dispatches`:**
- `confirmado_at` y `confirmado_por`: el 👍 del día anterior.
- `espaciado_min`: minutos entre camiones si el cliente pide otro ritmo. Si queda vacío se usa la descarga de la planta según bomba o directo.
- `m3_por_viaje`: por defecto 8. Para obras que piden menos por camión.

Los viajes **no tocan stock**: el stock lo sigue moviendo solo el despacho (motor de la 0b).

## 2. Cómo se generan los viajes

- **Al guardar un pedido** (Semana o edición) se generan sus viajes con el motor actual:
  - m³ por viaje = `m3_por_viaje`, el último con el resto;
  - el primero llega a la hora pedida;
  - los siguientes, separados por el espaciado;
  - la carga empieza ida + carga antes de la llegada.
- **Si el pedido ya tiene viajes despachados**, no se tocan. Solo se regeneran los `planificado`.
- **"Ordenar el día" en la vista Día** aplica `planificar()` a todos los pedidos del día:
  - respeta las bocas de carga;
  - asigna el camión sugerido;
  - corre las horas de carga si chocan.
  - Muestra el resultado y pide **"Guardar plan del día"**: no se guarda solo.

## 3. Gerenciador de viajes (por pedido)

Se abre desde la tarjeta del pedido en Semana, en la vista Día y en Despacho diario. Es como el "Gerenciador de Tickets" de Loop.

- **Encabezado:** cliente, obra, fórmula, finalidad, bomba, y "entregado / total m³".
- **Gantt:** una fila por viaje con 4 colores:
  - carga: gris;
  - ida: celeste;
  - descarga: amarillo, con los m³ escritos;
  - vuelta: verde.

  Los viajes despachados se ven sólidos y no se pueden mover.
- **Acciones:**
  - **Correr ±5 min** todos los viajes pendientes.
  - **Ajustar a la hora actual**: el próximo viaje pendiente carga ahora y los demás se corren. Es para cuando la obra se atrasa.
  - **Agregar viaje faltante / quitar sobrante**: si se cambió el total del pedido.
  - **m³ editables** por viaje.
  - **Camión sugerido** por viaje.
  - **Guardar**: registra en Actividad quién movió qué.

## 4. Sugerencia de horario sin choque

En el formulario del pedido, debajo de la hora de llegada:
- **"Empieza a cargar a las 06:20"**, calculado.
- Si se pisa con la carga de otro pedido de la misma planta, aparece en rojo: **"Choca con [obra] en la boca de carga"**, con dos botones de horario sugerido, uno antes y otro después (como Loop).

## 5. Gráfico de demanda (vista Día)

Barras por media hora de 06:00 a 19:00: **camiones necesarios** contra una línea de **camiones disponibles**. Las horas donde faltan camiones se ven en rojo, para decidir el día anterior si se corre un pedido o se consigue un camión.

## 6. Confirmación del día anterior

- En la vista Día, cada pedido tiene un botón **👍 Confirmar**, que guarda quién y cuándo.
- Arriba se ve "3 de 5 pedidos confirmados". El plantista ve en Despacho diario si un pedido está confirmado.
- **No bloquea nada**: es una marca de control.

## 7. Despacho diario (cambio mínimo)

- La tarjeta del pedido muestra **"Próximo: viaje 3/5 · cargar 09:40 · AF431GU"** y avisa en rojo si ya pasó la hora de carga (como el borde rojo de Loop).
- Al despachar, `registrar_despacho` marca como `despachado` el primer viaje pendiente del pedido (o el que se elija) y guarda `dispatch_id`. `anular_despacho` lo vuelve a `planificado`.
- Si el pedido no tiene viajes, todo sigue exactamente como hoy.
- **"No se pierde nada"**: la misma condición de la Fase 1, para todos los campos del despacho.

## Fuera de alcance (va en la Fase 3 o después)

- La pantalla de 3 columnas con arrastrar y soltar.
- Estados del camión en vivo y tiempos reales por GPS (Fase 4).
- Programación de las bombas como Gantt propio.
- Duplicar pedidos y pedidos recurrentes.

## Criterios de aceptación

1. Crear un pedido de 35 m³ con bomba genera 5 viajes (8+8+8+8+3), separados por el tiempo de descarga con bomba de la planta. Editar la hora corre todos los pendientes.
2. "Ordenar el día" con 2 pedidos que chocan en la boca de carga los separa. "Guardar plan del día" deja los viajes y los camiones sugeridos.
3. El gerenciador mueve, ajusta a la hora actual, agrega y quita viajes, y no deja mover los despachados.
4. Despachar marca el viaje y anular lo libera. Un pedido sin viajes se despacha igual que hoy. "No se pierde nada" se verifica como en la Fase 1.
5. Con el interruptor apagado, ninguna pantalla cambia (capturas antes y después de Semana, Día, Despacho diario e Historial). Con el interruptor prendido aparece todo lo nuevo con el distintivo "Nuevo · en prueba".

## Hecho
_(lo completa la sesión obrero)_
