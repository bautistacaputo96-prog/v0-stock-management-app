# Fase 0c — Usuarios, permisos y reglas de edición

Estado: **definiciones de Bautista tomadas (05/10/2026); falta la maqueta y el OK.** No programar todavía.

## Definiciones de Bautista (05/10/2026)

1. **Cada persona tiene su usuario y contraseña propios.** Se termina la contraseña compartida.
2. **Hay permisos por usuario y por sección.**
3. **Editar y borrar lo hacen solo los cargos gerenciales:** Bautista, Juan y Fernando.
4. **Hay tres tipos de usuario:**

| Tipo | Ve | Carga | Edita / borra |
|---|---|---|---|
| **Gerencial** | Todo | Todo | **Todo**. Además administra usuarios y permisos |
| **Operario / plantista** | Todo | Solo en sus **áreas habilitadas** | **Nada** |
| **Consulta** | Todo | Nada | Nada |

5. **Quién es cada uno:**

| Usuario | Tipo | Áreas donde carga |
|---|---|---|
| Bautista Caputo | Gerencial | Todas |
| Juan Oreguy | Gerencial | Todas |
| Fernando Maldonado | Gerencial | Todas (hoy figura como operario: se cambia) |
| Titan Concretus | Operario | Programación y despacho · Materia prima · Laboratorio |
| Felipe Calvo | Operario | Programación y despacho · Materia prima |
| **David** (usuario nuevo, a crear) | Operario | Laboratorio |
| Braian Peralta | Operario | Mantenimiento |
| Joaquín Graham | Consulta | — |

"Laboratorio pueden ver todos. Subir cosas pueden David y Titan."

## Áreas

| Área | Qué cubre "cargar" |
|---|---|
| Programación y despacho | Crear pedidos; despachar (desde pedido y manual); viajes y confirmación (Fase 2); finalizar un pedido con lo enviado |
| Materia prima | Ingresos de materiales, humedad diaria del acopio, recuentos (a definir: ¿el recuento es carga o es corrección?), transferencias entre plantas |
| Laboratorio | Extracción y rotura de probetas, granulometrías, calibración de la prensa |
| Mantenimiento | Órdenes de trabajo (empezar, pasos, fotos, completar), reportar fallas |
| Maestros | Clientes, obras, fórmulas, camiones, choferes, bombas: **¿solo gerencial o también operario?** (a definir) |

**Editar o borrar** (solo gerencial) incluye:
- Historial: editar despacho, borrar despacho, agregar fibra o superfluidificante después del despacho, agregar muestra después del despacho.
- Materia prima: editar o borrar ingresos.
- Calidad: corregir resultados y descartar probetas.
- Pedidos: editar o cancelar pedidos.
- Maestros: editar fórmulas, materiales, clientes y obras.
- Mantenimiento: cancelar OTs.

Toda edición o borrado **pide un motivo** y queda en Actividad con el antes y el después. Los borrados siguen mandando mail.

### Puntos a confirmar con Bautista
- **Ajustes del día en Programación por los operarios.** Titan y Felipe programan el día anterior y lo ajustan durante el día: cambiar la hora de un pedido, mover viajes, suspender por lluvia. Propuesta: esos ajustes **sí** los pueden hacer, porque son parte de programar. Lo que no pueden es editar o borrar despachos, ingresos o resultados.
- **Titan y mantenimiento.** Hoy Titan hace los chequeos diarios de la planta. ¿Sigue cargándolos? Si sí, se le suma el área Mantenimiento.
- **Recuentos de stock.** ¿Los hace un operario (es carga) o solo gerencial (es una corrección)?

## Etapas

### 0c-1 · Usuarios y permisos en el sistema (lo que se ve)
- **Pantalla "Usuarios"**, solo gerencial:
  - alta, baja, tipo, áreas habilitadas;
  - blanqueo de contraseña.
- **Login con usuario y contraseña propia:**
  - el gerencial da una contraseña inicial;
  - el usuario la cambia al entrar por primera vez.
  - Se elimina la contraseña compartida y el alta libre de usuarios desde la pantalla de login. También se elimina la contraseña fija de "Ajustar stock".
- **Botones según el permiso:**
  - un operario no ve Editar ni Borrar, y solo ve "Cargar" en sus áreas;
  - Consulta no ve ningún botón de carga.
- **Motivo obligatorio** en toda edición o borrado.
- **Actividad completa:** se registra todo lo que hoy falta, por ejemplo la creación y edición de pedidos y los recuentos.
- El interruptor "funciones nuevas" de la Fase 2 se administra desde la misma pantalla Usuarios.

### 0c-2 · Seguridad real en la base
- Login con **Supabase Auth**, con la sesión validada en el servidor.
- **RLS** en todas las tablas: leer requiere estar logueado; escribir según el tipo y el área del usuario (en los datos del token). Las funciones del motor (despacho, viajes) verifican el permiso adentro.
- **Rutas de API protegidas:**
  - remito PDF: solo usuarios logueados;
  - conectar GPS: solo gerencial;
  - reporte semanal y aviso de stock: con secreto del cron.
- **Coordinar con Concretus:** su reporte diario de WhatsApp lee la base de Rebucret con la clave anónima. Antes de prender RLS hay que darle una lectura propia (una vista o clave de servicio en su servidor), o el reporte se corta.
- Se hace en una noche sin despachos, con vuelta atrás preparada.

## Criterios de aceptación (resumen)
- Cada uno de los 8 usuarios entra con su propia contraseña y ve exactamente los botones de su tipo y áreas.
- Un operario no puede editar ni borrar: ni desde la pantalla, ni (en 0c-2) llamando a la base directo.
- Joaquín ve todo y no puede cargar nada.
- Toda edición o borrado pide motivo y queda en Actividad.
- El reporte de WhatsApp de Concretus sigue llegando.
- "No se pierde nada": todo lo que hoy se carga se sigue cargando igual por quien tiene permiso.

## Hecho
_(lo completa la sesión obrero)_
