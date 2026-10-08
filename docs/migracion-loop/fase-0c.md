# Fase 0c — Usuarios, permisos y reglas de edición

Estado: **definiciones completas (06/10/2026).** Se programa después de publicar la Fase 2, porque toca las mismas pantallas.

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

## Definiciones finales (06/10/2026) — reemplazan los "puntos a confirmar"

- **Permisos por usuario, partiendo de una plantilla.** El tipo (Gerencial / Operario / Consulta) pone los permisos por defecto. Desde la pantalla Usuarios, un gerencial **agrega o saca permisos puntuales a cada persona**. Ejemplos de Bautista:
  - habilitar a Titan para **editar y borrar despachos** o **ingresos de materia prima**;
  - habilitar a Felipe para dar de alta clientes y obras.
- **Matriz de permisos:** sección × acción (**ver · cargar · editar · borrar**).
  - **Secciones:** Programación del día, Despacho, Historial de despachos, Materia prima (ingresos), Recuentos y ajustes de stock, Laboratorio, Mantenimiento, Clientes y obras, Fórmulas, Camiones/choferes/bombas, Usuarios.
  - Se guarda en `app_users.permisos` (jsonb) más el `tipo`. La plantilla se aplica al crear el usuario o al cambiarle el tipo.
- **Programación del día:** la arma **Titan** según lo programado en el sistema. Los gerenciales también pueden armarla y editarla. Felipe, según su plantilla de operario.
- **Titan:** suma el área **Mantenimiento** (chequeos diarios de la planta).
- **Recuentos y ajustes de stock:** **solo gerencial**, salvo que se le habilite a alguien. **Se elimina la contraseña fija** de "Ajustar stock": alcanza con el permiso del usuario.
- **Clientes y obras (altas y edición):** gerenciales **y Felipe**.

Plantillas por defecto:

| Sección | Gerencial | Operario | Consulta |
|---|---|---|---|
| Todas: ver | ✓ | ✓ | ✓ |
| Cargar | Todo | Solo sus áreas | — |
| Editar y borrar | Todo | — (se habilita por persona) | — |
| Usuarios | ✓ | — | — |

Permisos iniciales por persona: los de la tabla de arriba, más Titan con Mantenimiento y Programación del día, y Felipe con Clientes y obras.

## Dosificadora (anotado para más adelante)
- El programa local de la planta solo guarda las últimas 10 cargas: no hay historial para leer.
- Bautista quiere que el plantista **accione la carga desde nuestro sistema** para no cargar dos veces. Queda para después.
- Recomendación de seguridad registrada: el sistema **prepara** la carga, y la persona en la planta **confirma el arranque** en la planta. Nada de arrancar la planta a distancia sin nadie presente, ni escribir directo al PLC sin el proveedor.

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

## 0c-1 · Especificación técnica

Estado: **escrita por el arquitecto el 06/10/2026; respuestas de Bautista en el punto 18; implementada por el obrero (ver "Hecho"), falta revisor.** Rama `loop/fase-0c-usuarios`. Migración escrita y **sin aplicar**: `supabase/migrations/202610061800_fase0c1_usuarios_permisos.sql`.

### 1. Objetivo
- Cada persona entra con **su nombre y su contraseña propia**. Se terminan la contraseña común, el alta libre de usuarios y la contraseña fija de "Ajustar stock".
- Cada persona ve **solo los botones que su permiso le deja usar**.
- Toda edición o borrado **pide motivo** y queda en Actividad con el antes y el después.
- Un gerencial administra todo desde una pantalla nueva, **Usuarios**.

### 2. Alcance y fuera de alcance
**Entra en la 0c-1:**
- login propio con sesión firmada en el servidor;
- primer ingreso y cambio de contraseña;
- pantalla Usuarios (con el interruptor de funciones nuevas, que se muda ahí);
- `puede(seccion, accion)` en un solo lugar, y todos los botones condicionados;
- motivo obligatorio;
- registros de Actividad que faltan;
- avisos por mail a los gerenciales (por `tipo`).

**No entra (es 0c-2 o después):**
- RLS en las tablas y Supabase Auth;
- proteger rutas de API (remito, GPS, reporte);
- que las funciones de la base verifiquen el permiso;
- la lectura propia del reporte de Concretus.

**Importante:** hasta la 0c-2, alguien que sepa programar puede seguir escribiendo en la base con la clave pública. La 0c-1 ordena lo que hace la gente desde las pantallas; la 0c-2 lo blinda.

### 3. Cómo funciona hoy (relevamiento del código, 06/10/2026)
**Login** (`components/login-gate.tsx`):
- se elige el nombre de una lista (`app_users` activos) y se escribe **una contraseña común** que está en el código del navegador;
- la sesión es `localStorage` (`rebucret-auth = "true"` + `rebucret_current_user` con nombre, rol y el interruptor). No hay nada en el servidor.

**Alta libre de usuarios en dos lugares:**
- "Agregar nuevo usuario" en el login;
- "Agregar" en el selector "Responsable" (`components/user-selector.tsx`), que usan Programación (Semana) y Despacho manual.

**Roles:**
- `app_users.role`: Bautista y Juan son `supervisor`; Braian, `mantenimiento`; el resto, `operario`.
- `supervisor` solo sirve para ver **Actividad** y para recibir los mails de borrados y de stock en cero.
- No hay ningún otro control: **todos ven y pueden usar todos los botones**.

**Contraseña fija de "Ajustar stock":**
- está en `components/stock-evolution-chart.tsx` (constante + un segundo valor aceptado, los dos escritos en el código);
- se pide antes de abrir `adjust-stock-dialog.tsx`.

**Interruptor de funciones nuevas** (Fase 2): `app_users.ve_funciones_nuevas`, que se maneja desde Actividad › "Funciones nuevas en prueba".

**Usuarios en la base** (7, todos activos): Bautista Caputo, Juan Oreguy, Fernando Maldonado, Titan Concretus, Felipe Calvo, Braian Peralta y Joaquin Graham (sin tilde). Solo Bautista y Juan tienen mail. No hay columna de contraseña ni índice único por nombre.

**Actividad (`activity_log`) — qué se registra hoy:**

| Se registra | Falta (se agrega en la 0c-1) |
|---|---|
| Despacho: crear, editar, anular, fibra/superfluidificante (lo hace la base) | Pedido: **crear**, editar desde Semana o Historial, cancelar, eliminar (Semana no deja rastro ni manda mail), finalizar, "Editar total" |
| Ingreso de MP: crear y borrar (con mail) | Ingreso: **editar** |
| Transferencia entre plantas | **Recuento / ajuste de stock** |
| Pedido: hora y método en la vista Día, plan del día, confirmación, viajes, ubicación de obra | Muestra agregada después del despacho; humedad diaria del acopio |
| Choferes, empresas de bombeo y tiempos de planta | Clientes y obras; fórmulas; materiales; camiones; proveedores y transportistas |
| Interruptor de funciones nuevas | Laboratorio: rotura, edición y borrado de probetas, descarte, calibración, granulometrías |
| | Mantenimiento: falla reportada, OT completada, OT cancelada |
| | Usuarios: alta, tipo y permisos, blanqueo, baja, "eligió su contraseña" |

Además: ninguna edición guarda **motivo**, salvo la anulación de despacho, que lo acepta pero el front manda `null`.

**Código muerto** (no lo importa ninguna pantalla, **no se toca**): `dispatches-table.tsx`, `formulas-table.tsx`, `materials-table.tsx`, `materials-dashboard.tsx`, y los que solo usan esos: `edit-material-dialog.tsx`, `delete-material-dialog.tsx`, `material-detail-dialog.tsx`, `view-dispatch-dialog.tsx`. Hoy no hay forma viva de editar o borrar un material: solo se da de alta.

### 4. Modelo de datos

#### 4.1 `app_users` (columnas nuevas)
| Columna | Qué guarda |
|---|---|
| `tipo` | `gerencial` / `operario` / `consulta` (CHECK). Por defecto `consulta`, lo más seguro para una fila que se cree por fuera de Usuarios. |
| `permisos` | jsonb con la matriz completa de la persona (4.3). Por defecto, la plantilla consulta. |
| `permisos_actualizados_at`, `permisos_actualizados_por` | Quién y cuándo tocó tipo o permisos. |
| Índice único `lower(btrim(name))` | El login y la Actividad identifican por nombre. |

`role` **no se toca** (main lo sigue usando hasta el merge). Después del merge no la lee nadie. La API de Usuarios la mantiene coherente al cambiar el tipo (gerencial → `supervisor`, el resto → `operario`) por si algún script viejo la mira.

#### 4.2 Secciones y acciones
Las claves son fijas y van en `lib/permisos.ts`. "—" = la acción no existe en esa sección: en la matriz se ve como guion y se guarda `false`.

| Clave | En pantalla | ver | cargar | editar | borrar |
|---|---|---|---|---|---|
| `programacion` | Programación del día | `/programacion` | Crear pedidos. Armar el día: hora y método en la vista Día, "Ordenar el día" / "Guardar plan", gerenciador de viajes, 👍 confirmar | Editar un pedido ya cargado (formulario de Semana), "Editar total" en Despacho diario, tiempos de la planta | Cancelar o eliminar un pedido |
| `despacho` | Despacho | `/plantista` | Despachar (desde pedido y manual), Finalizar pedido con lo enviado, "Entregado" | — | — |
| `historial` | Historial de despachos | `/historial-despachos` | — | Editar despacho, agregar fibra, superfluidificante o muestra después | Eliminar / anular despacho |
| `materia_prima` | Materia prima | `/materias-primas` | Ingresos, humedad diaria del acopio, transferencias entre plantas, proveedores y transportistas nuevos, marcar excedente acreditado | Editar ingresos y proveedores | Borrar ingresos y proveedores |
| `recuentos` | Recuentos y ajustes de stock | — | Hacer un recuento / ajuste ("Ajustar") | — | — |
| `laboratorio` | Laboratorio | `/calidad` | Cargar rotura, calibración de la prensa, granulometría nueva | Corregir probetas y granulometrías | Descartar o eliminar probetas y resultados |
| `mantenimiento` | Mantenimiento | `/mantenimiento` | Reportar falla; en la OT: empezar, pasos, fotos, completar, "ya la hice" | — | Cancelar OT |
| `clientes` | Clientes y obras | `/clientes` | Cliente u obra nuevos (también el alta rápida dentro del pedido o del despacho) | Editar cliente u obra | Dar de baja cliente, eliminar obra |
| `formulas` | Fórmulas y materiales | `/formulas` | Fórmula nueva, material nuevo | Editar fórmula | Eliminar fórmula |
| `flota` | Camiones, choferes y bombas | `/camiones` | Camión, chofer o empresa de bombeo nuevos (también el alta rápida de camión) | Editar, cambiar estado del camión | Dar de baja |
| `usuarios` | Usuarios | `/usuarios` y `/actividad` | — | — | — |

- **Ver** = la sección aparece en el menú y se abre. Sin "ver", el menú no la muestra y la ruta dice "No tenés acceso a esta sección".
- Dashboard, Informes y Logística los ven todos.
- `recuentos` no tiene pantalla propia: su único permiso es "cargar".

#### 4.3 Estructura exacta de `permisos`
```json
{
  "programacion":  { "ver": true, "cargar": true,  "editar": true,  "borrar": false },
  "despacho":      { "ver": true, "cargar": true,  "editar": false, "borrar": false },
  "historial":     { "ver": true, "cargar": false, "editar": false, "borrar": false },
  "materia_prima": { "ver": true, "cargar": true,  "editar": false, "borrar": false },
  "recuentos":     { "ver": true, "cargar": false, "editar": false, "borrar": false },
  "laboratorio":   { "ver": true, "cargar": true,  "editar": false, "borrar": false },
  "mantenimiento": { "ver": true, "cargar": true,  "editar": false, "borrar": false },
  "clientes":      { "ver": true, "cargar": false, "editar": false, "borrar": false },
  "formulas":      { "ver": true, "cargar": false, "editar": false, "borrar": false },
  "flota":         { "ver": true, "cargar": false, "editar": false, "borrar": false },
  "usuarios":      { "ver": false,"cargar": false, "editar": false, "borrar": false }
}
```
(ejemplo: Titan). Reglas, todas en `lib/permisos.ts`:
1. **Gerencial puede todo.** `puede()` devuelve `true` sin mirar el jsonb, así un gerencial no se puede dejar afuera a sí mismo. En la matriz se ve todo tildado y gris.
2. **`usuarios` sale solo del tipo**: solo gerencial. No se habilita por persona, porque quien administra usuarios puede darse cualquier permiso.
3. Si falta una sección o una acción, o el valor no es booleano, se toma `false` (`normalizarPermisos`).
4. Las acciones que no existen en la sección (4.2) siempre dan `false`.
5. Tildar cargar, editar o borrar tilda "ver"; destildar "ver" destilda las demás.
6. Se guarda **la matriz completa** de la persona, no las diferencias con la plantilla. La pantalla marca "agregado a mano" o "quitado a mano" comparando con la plantilla del tipo.

#### 4.4 Plantillas (`PLANTILLAS` en `lib/permisos.ts`)
- **gerencial:** todo `true`.
- **operario:** "ver" en todo menos Usuarios, y nada más. Las áreas donde carga se agregan por persona (al crearlo se tildan en el mismo formulario).
- **consulta:** igual que operario sin áreas: ve todo menos Usuarios.

La plantilla se aplica al crear la persona y al cambiarle el tipo. Antes de cambiar el tipo, la pantalla avisa "Se reemplazan los permisos actuales por los de [tipo]".

#### 4.5 Permisos iniciales (los pone la migración; David lo crea un gerencial)
| Persona | Tipo | Cargar | Editar | Borrar |
|---|---|---|---|---|
| Bautista Caputo | gerencial | todo | todo | todo |
| Juan Oreguy | gerencial | todo | todo | todo |
| Fernando Maldonado | gerencial (hoy `operario`) | todo | todo | todo |
| Titan Concretus | operario | Programación del día, Despacho, Materia prima, Laboratorio, Mantenimiento | **Programación del día** (ver pregunta 1) | — |
| Felipe Calvo | operario | Programación del día, Despacho, Materia prima, Clientes y obras | **Clientes y obras** | — |
| David (nuevo) | operario | Laboratorio | — | — |
| Braian Peralta | operario | Mantenimiento | — | — |
| Joaquin Graham | consulta | — | — | — |

Todos ven todo menos Usuarios y Actividad, que son de los gerenciales.

Por qué Titan edita en Programación del día: las definiciones le suman "Programación del día" **además** de su área de carga ("la arma Titan... los gerenciales también pueden armarla y editarla"). Si fuera solo cargar, ya lo tenía por "Programación y despacho". Sin eso, Titan no podría corregir la hora o los m³ de un pedido ya cargado, que es lo que hace todos los días.

**David no se crea en la migración:** un gerencial lo da de alta desde Usuarios, con su apellido y una contraseña inicial que elige el gerencial. Así nadie (ni nosotros) inventa una contraseña.

#### 4.6 `app_user_credenciales` (tabla nueva, solo el servidor)
| Columna | Qué guarda |
|---|---|
| `user_id` | PK y FK a `app_users`, `on delete cascade` |
| `clave_hash` | `scrypt$N$r$p$sal$hash` (base64). CHECK de formato. **Nunca** texto plano. |
| `debe_cambiar` | Tiene que elegir su contraseña al entrar (alta, blanqueo o primer ingreso) |
| `permite_clave_comun` | Puede entrar **una vez** con la contraseña común (solo los existentes al día de la migración y mientras no tengan la suya) |
| `sesion_version` | Va dentro de la cookie. Sumarle 1 cierra todas las sesiones de la persona |
| `intentos_fallidos`, `bloqueado_hasta` | Freno a la adivinación: 5 errores seguidos → 10 minutos |
| `clave_cambiada_at`, `ultimo_ingreso_at`, `actualizado_por`, `created_at`, `updated_at` | Control |

- RLS prendida, **sin políticas**, `REVOKE ALL` a anon y authenticated, `GRANT ALL` a service_role. Es el mismo patrón que `integraciones` y `alertas_stock`.
- El navegador nunca la lee. Se separó de `app_users` porque `app_users` la lee el navegador con la clave pública: un hash ahí quedaría a la vista de cualquiera.

### 5. Login, sesión y primer ingreso

#### 5.1 Primer ingreso: decisión
Se combinan las dos variantes:
- **(A) Los 7 usuarios existentes:** entran **una última vez** con la contraseña común de siempre. El sistema les obliga a elegir la propia en ese momento, y desde ahí la común deja de valer **para esa persona**.
- **(B) David, cualquier alta nueva y todo blanqueo:** el gerencial escribe una contraseña inicial y la persona la cambia al entrar (es lo que dice la definición de la etapa).

Por qué:
- Con (A) nadie queda afuera el día del cambio. Titan y Felipe abren el sistema a la mañana, ponen lo de siempre, eligen su contraseña y siguen despachando, sin depender de que alguien les pase una contraseña antes de las 7.
- Nadie (ni Bautista ni nosotros) tiene que inventar ni repartir 7 contraseñas.
- (B) es la regla para siempre.

**Decisión del 07/10/2026 (revisión): los gerenciales no entran con la contraseña común.**
- La migración deja `permite_clave_comun = true` solo para los operarios y consulta (Titan, Felipe, Braian, Joaquín) **y para Bautista**.
- Juan y Fernando quedan con `permite_clave_comun = false` y sin contraseña: si prueban, ven "Todavía no tenés contraseña. Pedile a un gerencial que te la dé desde Usuarios."
- Bautista es el único gerencial que entra con la común, una sola vez, en el preview (protegido con el login de Vercel), justo después de aplicar la migración. Elige su contraseña y desde Usuarios les da una inicial a Juan y Fernando (la cambian al entrar).
- Así nadie que sepa la común puede quedarse con una cuenta gerencial durante la transición.

**Riesgo de (A):** mientras dure la transición, alguien que sepa la común podría elegir la contraseña de otro antes que él. Se acota así:
1. la ventana es por persona y se cierra sola cuando cada uno elige la suya;
2. un gerencial la cierra para todos con un botón ("Cerrar el ingreso con la contraseña común");
3. queda en Actividad "eligió su contraseña" con fecha y hora;
4. si pasa, el afectado no puede entrar con su contraseña: avisa, el gerencial le blanquea la contraseña y le cierra las sesiones al otro (`sesion_version`).

#### 5.2 Piezas del servidor
Todo es Node (`crypto`), sin dependencias nuevas.

| Archivo | Qué hace |
|---|---|
| `lib/auth/clave.ts` | `hashClave(clave)` usa `crypto.scrypt` (N=16384, r=8, p=1, 64 bytes, sal aleatoria de 16 bytes) y da `scrypt$16384$8$1$<sal>$<hash>`. `verificarClave(clave, hash)` compara con `timingSafeEqual` y nunca tira error con datos inválidos. `validarClaveNueva(nombre, clave)` devuelve el texto del error o `null`: mínimo 6 caracteres, no puede ser igual al nombre ni a la contraseña común. `esClaveComun(texto)` normaliza como hoy (minúsculas, sin tildes, sin espacios a los costados) y compara contra una constante **que vive solo acá**. Se borra el `VALID_PASSWORD` del login. |
| `lib/auth/token.ts` | `firmarSesion({u, v, e})` da `base64url(json).base64url(hmacSHA256)` con `process.env.SESION_SECRETO`. `leerSesion(valor)` verifica la firma con `timingSafeEqual` y que no esté vencida; si algo falla devuelve `null`. Sin `SESION_SECRETO` (o con menos de 32 caracteres) tira un error claro que las rutas devuelven como `500 {codigo: "sin_secreto"}`. |
| `lib/auth/ingreso.ts` | `decidirIngreso({credencial, activo, clave, ahora, verificar})`: función **pura** con todas las reglas del 5.3. Devuelve `{ok, debeCambiar, error, cambios}`; `cambios` es lo que hay que grabar (intentos, bloqueo, último ingreso). Así se prueba sin base. |
| `lib/auth/servidor.ts` | `sbServicio()`: cliente de Supabase con `SUPABASE_SERVICE_ROLE_KEY`, la variable que ya usan el remito y el GPS. `sesionActual()`: lee la cookie y carga el usuario y su credencial; pide que esté activo y que coincida `sesion_version`. `exigirGerencial()`. `usuarioParaElNavegador(u)` arma `{id, name, tipo, permisos (normalizados), veFuncionesNuevas}`. `ponerCookieSesion(res, …)` y `borrarCookieSesion(res)`. `registrarActividad(...)`: insert en `activity_log` con service role y el nombre de la sesión. |
| `lib/supabase/servicio.ts` | `sbServicio()` (o se reusa el de `lib/wialon.ts`; el obrero elige uno y no lo duplica). |

**Cookie:**
- nombre `rebucret_sesion`, `httpOnly`, `sameSite=lax`, `path=/`, `secure` en producción;
- dura **30 días** y se renueva sola cuando le quedan menos de 15 (en `GET /api/sesion`);
- contenido `{u: user_id, v: sesion_version, e: vencimiento}`. No lleva ni nombre ni permisos: los permisos se leen de la base en cada `GET /api/sesion`.

**Rutas** (Next 16: en las dinámicas, `params` es una Promise):

| Ruta | Quién | Qué hace |
|---|---|---|
| `GET /api/sesion` | Cualquiera | 200 `{usuario, debeCambiarClave}` o 401. Renueva la cookie. |
| `GET /api/sesion/usuarios` | Cualquiera | `[{id, name}]` de los activos, para la lista del login. Así el login no depende de leer `app_users` con la clave pública, y no se rompe en la 0c-2. |
| `POST /api/sesion/ingresar` `{usuarioId, clave}` | Cualquiera | Aplica `decidirIngreso`, graba los cambios, pone la cookie. Errores en castellano simple. |
| `POST /api/sesion/clave` `{actual?, nueva}` | Con sesión | Si `debe_cambiar`, no pide `actual`; si es un cambio voluntario, sí. Graba el hash y pone `debe_cambiar=false`, `permite_clave_comun=false`, `intentos=0`, `sesion_version+1` (cierra las otras sesiones) y una cookie nueva para este equipo. Actividad: "Contraseña: eligió su contraseña" o "cambió su contraseña". **Nunca el valor.** |
| `POST /api/sesion/salir` | Cualquiera | Borra la cookie. |
| `GET /api/usuarios` | Gerencial | Lista completa: tipo, permisos, mail, activo, interruptor, estado de la contraseña ("propia" / "tiene que cambiarla" / "primer ingreso pendiente" / "sin contraseña"), último ingreso, bloqueado. Nunca el hash. |
| `POST /api/usuarios` `{name, email?, tipo, permisos?, claveInicial}` | Gerencial | Alta. Nombre único (si se repite: "Ya hay un usuario con ese nombre"). Permisos = plantilla, o los que mande la pantalla normalizados. Credencial con `debe_cambiar=true` y `permite_clave_comun=false`. Actividad. |
| `PATCH /api/usuarios/[id]` `{tipo?, permisos?, email?, active?, ve_funciones_nuevas?}` | Gerencial | Graba lo que viene y registra en Actividad el antes y el después por campo (permisos: "Historial · editar: no → sí"). Si cambia el tipo, se aplica la plantilla salvo que vengan permisos. Baja: `sesion_version+1`. Frenos: nadie se da de baja a sí mismo; siempre queda al menos un gerencial activo. El nombre no se edita en la 0c-1 (los registros viejos quedarían con el nombre anterior). |
| `POST /api/usuarios/[id]/clave` `{claveInicial}` | Gerencial | Blanqueo: nuevo hash, `debe_cambiar=true`, `permite_clave_comun=false`, `intentos=0`, `bloqueado_hasta=null`, `sesion_version+1`. Actividad "Contraseña blanqueada". |
| `POST /api/usuarios/cerrar-clave-comun` | Gerencial | `permite_clave_comun=false` para todos. Actividad. |

**Modo de prueba local** (solo para el obrero):
- Si `NODE_ENV === "development"` **y** existe `SESION_LOCAL_COMO="Nombre Apellido"`, `GET /api/sesion` devuelve ese usuario con su tipo y permisos reales, leídos de la base (solo lectura).
- Las rutas que escriben (`ingresar`, `clave`, `/api/usuarios` POST/PATCH) responden 403 "modo prueba local".
- Así se miran las pantallas como gerencial, operario o consulta sin grabar nada en producción.
- En Vercel `NODE_ENV` es siempre `production`, así que no se puede prender ahí. Va probado.

#### 5.3 Reglas de ingreso (`decidirIngreso`)
1. Usuario inexistente o inactivo → "Usuario o contraseña incorrectos".
2. `bloqueado_hasta` en el futuro → "Demasiados intentos. Esperá N minutos o pedile a un gerencial que te blanquee la contraseña."
3. Si tiene `clave_hash`: vale **solo** esa. La común ya no vale, aunque `permite_clave_comun` siga en true.
4. Si no tiene `clave_hash` y `permite_clave_comun`: vale la común, y entra con `debeCambiar=true`.
5. Si no tiene `clave_hash` ni `permite_clave_comun` (o no tiene fila de credencial) → "Todavía no tenés contraseña. Pedile a un gerencial que te la dé desde Usuarios."
6. Contraseña mal → `intentos_fallidos+1`; al llegar a 5 → `bloqueado_hasta = ahora + 10 min` e intentos a 0.
7. Bien → intentos a 0, `ultimo_ingreso_at = ahora`.

#### 5.4 Pantallas
**Login** (`components/login-gate.tsx`, se reescribe):
- Al abrir llama a `GET /api/sesion`:
  - **200:** guarda el usuario en el caché local (`setCurrentUser`) y entra. Si `debeCambiarClave`, muestra primero "Elegí tu contraseña".
  - **401:** limpia el caché y muestra el login.
  - **Error de red o 5xx:** si hay usuario en caché, **entra con el caché** y muestra una franja "Sin conexión con el servidor: se usan tus permisos guardados", y reintenta cada minuto. Si no hay caché, un mensaje de error con "Reintentar". Así un corte de internet a las 7 no deja a nadie sin despachar.
  - **`codigo: "sin_secreto"`:** "El sistema no está bien configurado (falta SESION_SECRETO). Avisale a Bautista."
- **Formulario:** lista de nombres (`GET /api/sesion/usuarios`) y contraseña con ojito para verla. Los campos no ponen mayúsculas solas (`autoCapitalize="none"`, `autoCorrect="off"`, `spellCheck={false}`): las contraseñas distinguen mayúsculas.
  - Texto: "Elegí tu nombre y poné tu contraseña. Si es tu primera vez con contraseña propia, poné la de siempre: el sistema te va a pedir que elijas una nueva."
- **Se borra** "Agregar nuevo usuario".
- Revalida en segundo plano cada 15 minutos. Si la sesión ya no vale (baja, blanqueo), vuelve al login y avisa "Tu sesión se cerró. Entrá de nuevo."

**"Elegí tu contraseña"** (`components/elegir-clave.tsx`):
- Dos campos (nueva y repetila) con las reglas a la vista: "Mínimo 6 letras o números. Distinguí mayúsculas. No uses la de antes."
- Botón "Guardar y entrar". No se puede saltear: solo da la opción "Salir".

**Menú del usuario** (`components/app-shell.tsx`):
- abajo a la izquierda y en el círculo de arriba (que hoy dice "OP"), el nombre con el tipo ("Gerencial", "Operario", "Consulta");
- opciones "Cambiar mi contraseña" (pide la actual) y "Salir" (`POST /api/sesion/salir`, limpia el caché y recarga). En la tablet compartida, "Salir" es "cambiar de usuario".

#### 5.5 Variable de entorno nueva
- **`SESION_SECRETO`**: un texto aleatorio de 48 caracteres o más.
  - La genera y la carga **Bautista** en Vercel, en Production y en Preview. Por ejemplo, la genera en su terminal con `openssl rand -base64 48` y la pega en Vercel. Nunca se pega en el chat ni en el repo.
  - Para el desarrollo local va en `.env.local`.
  - Si cambia, se cierran todas las sesiones (todos vuelven a entrar con su contraseña; no se pierde nada).
- **`SUPABASE_SERVICE_ROLE_KEY`** ya existe en Production (la usan el remito y el GPS). Hay que **confirmar que también esté en Preview**.

### 6. Permisos en el front: una sola función
- **`lib/permisos.ts`** (sin React y sin Supabase; lo usan el navegador y el servidor). Exporta:
  - `SECCIONES`: clave, nombre, acciones que existen, ruta y descripción;
  - `PLANTILLAS` y `plantilla(tipo)`;
  - `normalizarPermisos(raw)`;
  - `puedeCon(usuario, seccion, accion)`;
  - `diferenciasConPlantilla(tipo, permisos)`;
  - `seccionDeRuta(pathname)`.
- **`lib/current-user.ts`:**
  - `CurrentUser` pasa a ser `{id, name, tipo, permisos, veFuncionesNuevas, role}`. `role` se deriva (`gerencial` → `supervisor`), para no romper lo que todavía lo mire.
  - Funciones nuevas:
    - `puede(seccion, accion)`: lee el caché y no espera a nada;
    - `esGerencial()`;
    - hook `usePermisos()` → `{puede, esGerencial, tipo, listo}`. Usa el mismo evento que `useFuncionesNuevas`, y en el primer render da `false` en todo.
  - `isSupervisor()` queda como alias de `esGerencial()`.
  - `currentUserName()` no cambia: lo siguen usando las funciones de la base y la Actividad.
- **`components/seccion-protegida.tsx`:** `<SeccionProtegida seccion="laboratorio">` envuelve cada página de 4.2. Sin "ver" muestra "No tenés acceso a esta sección" (el mismo cartel que hoy usa Actividad).
- **Regla para el obrero:** ningún componente compara `tipo` ni `role` a mano. Todo pasa por `puede()` / `usePermisos()`, salvo lo que es "solo gerencial", que usa `esGerencial()`.
- **Sin permiso, el botón no se muestra.** No se muestra deshabilitado: la definición es "un operario no ve Editar ni Borrar".
- Los formularios que se abren desde una tarjeta se abren **en modo lectura** (sin Guardar). Pasa con el pedido en Semana, el gerencial de viajes y la OT de mantenimiento.

### 7. Pantalla Usuarios (`app/usuarios/page.tsx` + `components/usuarios/*`)
Solo gerencial: ítem "Usuarios" en el menú, al lado de Actividad. Todo pasa por `/api/usuarios`; nada escribe `app_users` desde el navegador.

**Arriba:**
- botón **"Nuevo usuario"**;
- recuadro **"Primer ingreso pendiente: N de 7"** con los nombres que faltan y el botón **"Cerrar el ingreso con la contraseña común"**. Pide confirmar: "Los que no eligieron su contraseña no van a poder entrar hasta que les des una".

**Lista**, una fila por persona:
- nombre;
- tipo (con colores);
- "Carga en: Programación, Despacho, …";
- "Edita/borra: …" (solo lo habilitado a mano);
- estado de la contraseña;
- último ingreso;
- interruptor **"Funciones nuevas en prueba"** (sale de Actividad y queda igual, con su registro en Actividad);
- activo.

Los dados de baja van en una lista plegada, "Ver dados de baja".

**Diálogo de la persona** (nuevo o editar):
- nombre (solo al crear), mail (opcional: "para recibir los avisos de borrados y de stock en cero; solo gerenciales");
- tipo (tres botones grandes con una línea de explicación cada uno);
- **matriz**: una fila por sección y las columnas Ver / Cargar / Editar / Borrar, con casillas grandes. Donde la acción no existe va "—". Para gerencial, todo tildado y gris con "Gerencial puede todo". Cada casilla distinta de la plantilla lleva la marca "a mano". Abajo, "Volver a la plantilla de [tipo]";
- al crear: "Contraseña inicial" dos veces, con la nota "Dásela a la persona. Al entrar la va a tener que cambiar";
- botones "Blanquear contraseña" (pide la nueva inicial dos veces), "Dar de baja" / "Reactivar" y "Guardar".

Los cambios de esta pantalla **no piden motivo**: quedan en Actividad con el antes y el después y quién los hizo. Es configuración, no corrección de datos. Si Bautista quiere motivo también acá, se agrega.

**Actividad** (`app/actividad/page.tsx`):
- se saca la tarjeta "Funciones nuevas en prueba" y queda un renglón "El interruptor de funciones nuevas se maneja desde Usuarios";
- el acceso pasa a `esGerencial()`;
- el filtro "Tipo" suma los registros nuevos (10.2). Para que no se pierdan los raros que ya hay (`formula`, `test_cylinders`, `maint_tasks`), sale de un mapa de nombres más los que aparezcan en los datos.

### 8. Botones por pantalla (archivo por archivo)
Columnas: permiso que pide · ¿motivo? · Actividad (**nuevo** = hoy no se registra).

**Programación**
| Archivo | Botón / acción | Permiso | Motivo | Actividad |
|---|---|---|---|---|
| `components/dispatch-scheduling.tsx` | Tocar una franja vacía (pedido nuevo) | programacion.cargar | — | **nuevo**: crear pedido (cliente, obra, fórmula, m³, llegada, planta). El insert pide siempre `.select("id")`. |
| idem | Abrir un pedido (tarjeta, ⋯ Editar) | con programacion.editar: editable; sin: **"Ver pedido"**, solo lectura | sí, al guardar una edición | **nuevo**: editar pedido con el antes → después por campo |
| idem | Botón "Cancelar pedido" del formulario | programacion.borrar | sí | **nuevo**: cancelar pedido (sin mail: el pedido no se borra) |
| idem | ⋯ Eliminar | programacion.borrar | sí | **nuevo**: `logDeletion` (copia + mail) |
| idem | ⋯ Viajes / tocar un viaje | sin programacion.cargar, el gerenciador se abre `soloLectura` | — | ya existe |
| idem | Alta rápida de cliente / obra ("+") | clientes.cargar | — | **nuevo**: crear cliente / obra |
| idem | Alta rápida de camión | flota.cargar | — | **nuevo**: crear camión |
| idem | Completar el CUIT que falta, ubicar una obra sin ubicación | el mismo permiso del formulario (cargar o editar) | — | ubicación: ya existe; CUIT: **nuevo** |
| idem + `components/user-selector.tsx` | "Responsable" | se saca el botón "Agregar"; por defecto, el usuario en sesión (hoy es el primero de la lista) | — | — |
| `components/programacion-dia.tsx` | Hora de llegada, método, "Ordenar el día" / "Guardar plan", Viajes, 👍 Confirmar | programacion.cargar | — | ya existe |
| idem | "Tiempos y camiones" › Guardar tiempos de la planta | programacion.editar (los camiones disponibles del día, que viven en el navegador, quedan libres) | sí | ya existe; se suma el motivo |
| `components/gerenciador-viajes.tsx` | Todo el gerenciador | programacion.cargar (si no, `soloLectura`) · "Editar pedido": programacion.editar | — | ya existe |

**Despacho diario**
| Archivo | Botón / acción | Permiso | Motivo | Actividad |
|---|---|---|---|---|
| `components/plantista-view.tsx` | "Despachar", Despacho manual | despacho.cargar | — | ya existe (la base) |
| idem | "Finalizar" pedido | despacho.cargar | — | **nuevo**: "Finalizado con X de Y m³" |
| idem | "Entregado" (camión disponible) | despacho.cargar | — | — (estado del camión) |
| idem | ⋯ Editar total | programacion.editar | sí | **nuevo**: m³ antes → después |
| idem | ⋯ Cancelar | programacion.borrar | sí | **nuevo** |
| idem | ⋯ Viajes | como en Programación | — | ya existe |
| idem | Aviso automático de humedad del acopio y el botón de humedad | materia_prima.cargar (sin permiso, el aviso no aparece) | — | **nuevo**: humedad cargada (material, %) |
| `components/add-dispatch-dialog.tsx` | Alta rápida de cliente / obra / camión, "Responsable" | igual que en Programación | — | igual |

**Historial** (`components/dispatch-history.tsx`)
| Botón | Permiso | Motivo | Actividad |
|---|---|---|---|
| ⋯ Agregar muestra | historial.editar | sí | **nuevo**: muestra N, asentamiento, probetas creadas |
| ⋯ Superfluidificante / Fibra | historial.editar | sí | lo registra la base; se manda `p_motivo` (parámetro nuevo) |
| ⋯ Editar (despacho real) | historial.editar | sí | lo registra la base; se manda `motivo` en el jsonb de `editar_despacho` |
| ⋯ Editar (fila de pedido) | historial.editar | sí | **nuevo**: antes → después |
| ⋯ Eliminar (despacho real) | historial.borrar | sí | `anular_despacho(p_motivo := motivo)` (hoy se manda null) + mail con el motivo |
| ⋯ Eliminar (pedido) | historial.borrar | sí | `logDeletion` con el motivo |
| Remito, Excel | todos | — | — |

**Materia prima**
| Archivo | Botón / acción | Permiso | Motivo | Actividad |
|---|---|---|---|---|
| `app/materias-primas/page.tsx` | "Nuevo ingreso" | materia_prima.cargar | — | ya existe |
| idem | "Nuevo material" (pestaña stock) | formulas.cargar | — | **nuevo** |
| `components/add-stock-entry-dialog.tsx` | Alta rápida de proveedor y de transportista | materia_prima.cargar | — | **nuevo** |
| `components/stock-entries-table.tsx` | ⋯ Editar ingreso | materia_prima.editar | sí | **nuevo**: antes → después (cantidad, remito, fecha, notas) y si se corrigió el stock |
| idem | ⋯ Eliminar ingreso | materia_prima.borrar | sí | ya existe (copia + mail); se suma el motivo |
| `components/stock-evolution-chart.tsx` | "Ajustar" / "Ajustar Stock" | recuentos.cargar. **Se borran** la contraseña fija (las dos constantes, `handlePasswordSubmit` y su diálogo): se abre directo el diálogo de ajuste | — | — |
| idem | "Mover" (transferir) | materia_prima.cargar | — | ya existe (se corrige el tipo `ActivityAction`, que no incluye `transferir`) |
| `components/adjust-stock-dialog.tsx` | Guardar ajuste | (ya filtrado) | **sí**: "Observaciones (opcional)" pasa a "Motivo del ajuste (obligatorio)". Va al movimiento como hoy y a Actividad | **nuevo**: entidad `stock`, "Material, Antes, Ahora, Diferencia, Motivo" |
| `components/humidity-excess-table.tsx` | "Marcar acreditado" | materia_prima.cargar (es cargar un número de nota de crédito; hoy no se usa: 0 de 142) | — | **nuevo** |
| `components/suppliers-table.tsx` | Nuevo / Editar / Eliminar proveedor | materia_prima.cargar / editar / borrar | sí en editar y eliminar | **nuevo** (eliminar con `logDeletion`) |

**Laboratorio** (`app/calidad`)
| Archivo | Botón / acción | Permiso | Motivo | Actividad |
|---|---|---|---|---|
| `components/cylinder-breaking-table.tsx` | ✓ guardar rotura | laboratorio.cargar | — | **nuevo**: rotura cargada (muestra, probeta, edad, dial, MPa) |
| idem | 🗑 Descartar probeta | laboratorio.borrar | sí: el "motivo del descarte" pasa a obligatorio y se guarda en `discard_reason`, como hoy | **nuevo** |
| idem | Calibración de la prensa | laboratorio.cargar | — | **nuevo**: constantes antes → después |
| `components/test-cylinders-table.tsx` + `edit-cylinder-dialog.tsx` | ⋯ Editar probeta | laboratorio.editar | sí | **nuevo**: antes → después (también de los campos del despacho que sincroniza) |
| idem | ⋯ Eliminar probeta | laboratorio.borrar | sí | **nuevo**: `logDeletion` |
| `components/breaking-results-table.tsx` | 🗑 Eliminar resultado | laboratorio.borrar | sí | **nuevo**: `logDeletion` |
| `components/granulometria-table.tsx` (+ add/edit dialog) | Nueva / Editar granulometría | laboratorio.cargar / laboratorio.editar | sí al editar | **nuevo** |

**Mantenimiento**
| Archivo | Botón / acción | Permiso | Motivo | Actividad |
|---|---|---|---|---|
| `components/mantenimiento-content.tsx` | "Reportar falla" | mantenimiento.cargar | — | **nuevo** |
| `components/mantenimiento/orden-trabajo-dialog.tsx` | Empezar, pasos, foto, Completar, "Ya la hice" | mantenimiento.cargar (sin él: OT en solo lectura) | — | **nuevo**: solo "OT completada" (los pasos y las fotos ya quedan en la OT) |
| idem | "Cancelar orden" | mantenimiento.borrar | sí (las observaciones pasan a obligatorias) | **nuevo** |
| `lib/mantenimiento.ts` | Generación automática de OTs ("Sistema") | **sin cambios**: corre para todos | — | — |

**Clientes, Fórmulas, Flota**
| Archivo | Botón / acción | Permiso | Motivo | Actividad |
|---|---|---|---|---|
| `components/clients-management.tsx` | Nuevo cliente / Nueva obra | clientes.cargar | — | **nuevo** |
| idem | ✏ editar cliente / obra | clientes.editar | sí | **nuevo**: antes → después |
| idem | 🗑 baja de cliente / eliminar obra | clientes.borrar | sí | **nuevo**: `logDeletion` |
| `components/add-client-dialog.tsx`, `add-construction-site-dialog.tsx` | (los filtra quien los abre) | clientes.cargar | — | **nuevo** |
| `app/formulas/page.tsx`, `components/formulas-grouped-view.tsx` + add/edit/delete-formula-dialog | Nueva / Editar / Eliminar fórmula | formulas.cargar / editar / borrar | sí en editar y eliminar | **nuevo** (editar: materiales y cantidades antes → después) |
| `components/mixers-management.tsx`, `add-mixer-dialog.tsx` | Nuevo / Editar / Estado / Dar de baja camión | flota.cargar / editar / editar / borrar | sí en editar y baja (el estado no lo pide: es operativo) | **nuevo** |
| `components/maestro-lista.tsx` (choferes, bombas) | Nuevo / Editar / Dar de baja / Reactivar | flota.cargar / editar / borrar / borrar | sí en editar y baja | ya existe; se suma el motivo |

**Otros**
| Archivo | Cambio |
|---|---|
| `components/logistica-en-vivo.tsx` | El formulario "Conectar B-Track" solo lo ve un gerencial. La ruta se protege en la 0c-2. |
| `components/app-shell.tsx` | El menú se filtra por "ver". Actividad y Usuarios solo para gerencial. El bloque del usuario muestra el tipo y suma "Cambiar mi contraseña" y "Salir". |
| `app/api/notificar-borrado/route.ts`, `app/api/alertas/stock-cero/route.ts` | `.eq("role", "supervisor")` pasa a `.eq("tipo", "gerencial")`. Hoy da los mismos destinatarios: Bautista y Juan, porque Fernando no tiene mail. |
| Cada `app/<sección>/page.tsx` de 4.2 | Envuelto en `<SeccionProtegida>`. |

### 9. Motivo obligatorio
- **Regla única:** todo botón que pide permiso de **editar** o **borrar** pide motivo, más el recuento de stock. Excepciones escritas: el estado del camión y la pantalla Usuarios.
- **`components/motivo.tsx`** exporta:
  - `<CampoMotivo value onChange />`: textarea "Motivo (obligatorio)", con el ejemplo "Ej: el remito se cargó con otro número";
  - `motivoValido(texto)`: al menos 5 caracteres sin contar espacios;
  - `<ConfirmarConMotivo open titulo descripcion textoBoton onConfirmar={(motivo) => …} />`, para eliminar y cancelar. Reemplaza los `AlertDialog` de borrado de las pantallas de arriba.
- En los diálogos de edición, `CampoMotivo` va arriba de los botones, y "Guardar" queda deshabilitado hasta que el motivo sea válido.
- El motivo va a Actividad (`details.Motivo`), al mail de borrado (que ya muestra todo lo de `details`) y, donde hay movimiento de stock, a su nota (base: `editar_despacho`; front: recuento).

### 10. Actividad completa

#### 10.1 Ayudantes (`lib/activity-log.ts`)
- `ActivityAction` suma `transferir`. `ActivityEntity` suma: `cliente`, `obra`, `formula`, `camion`, `proveedor`, `transportista`, `probeta`, `granulometria`, `calibracion`, `humedad`, `stock`, `orden_trabajo` (con su nombre en `ENTITY_LABEL`).
- `logCambio({entity, entityId, reference, plantId, antes, despues, etiquetas, motivo})`: arma `{"Campo": "antes → después"}` solo con lo que cambió, más "Motivo". Si no cambió nada, no registra.
- `logDeletion(...)` suma el parámetro `motivo`, que va a `details.Motivo` y al mail.
- Nunca corta la operación (como hoy).

#### 10.2 Qué se suma
Todo lo marcado **nuevo** en el punto 8, más lo que registra el servidor en Usuarios (5.2).

#### 10.3 Cambios en la base
Sin tocar las firmas usadas por main:
- `editar_despacho`: lee `p->>'motivo'` (opcional). Lo agrega a Actividad ("Motivo") y a la nota del movimiento de stock. Si no viene, todo queda igual que hoy.
- `ajustar_material_despacho`: parámetro nuevo `p_motivo` al final, con default `NULL`. Se borra la firma de 5 parámetros para que PostgREST no vea dos funciones. El front de main la llama con 5 parámetros con nombre y sigue andando.
- Las dos parten de `pg_get_functiondef` de producción del 06/10/2026 (= fase 2), con 3 líneas de diferencia cada una.

### 11. Migración
`supabase/migrations/202610061800_fase0c1_usuarios_permisos.sql` (escrita completa, **no aplicada**):
- columnas `tipo`, `permisos`, `permisos_actualizados_at/_por` con sus CHECK;
- índice único por nombre (si hay repetidos se frena con un mensaje);
- permisos iniciales por id **y** nombre, solo si `permisos_actualizados_at` es nulo. Volver a correrla no pisa lo que se cambió desde Usuarios;
- tabla `app_user_credenciales` con RLS y permisos solo para el servidor;
- primer ingreso pendiente para los 7 existentes;
- las dos funciones;
- `NOTIFY pgrst`;
- al final, un aviso por persona: tipo, dónde carga y estado de la contraseña.

Qué pasa con los datos ya cargados: explicado en la cabecera del archivo. En corto:
- nada se borra;
- `role` no se toca;
- Fernando pasa a gerencial;
- nadie tiene contraseña propia hasta su primer ingreso.

No se pudo probar contra una base (acá no hay Postgres local y no se escribe en producción). **El obrero la corre dos veces dentro de un único `BEGIN … ROLLBACK`**, como en las fases anteriores (13.2).

### 12. Archivos (resumen para el obrero)
**Nuevos:**
- `lib/permisos.ts`
- `lib/auth/clave.ts`, `lib/auth/token.ts`, `lib/auth/ingreso.ts`, `lib/auth/servidor.ts`
- `lib/supabase/servicio.ts` (o se reusa `sbAdmin`)
- `app/api/sesion/route.ts`, `app/api/sesion/usuarios/route.ts`, `app/api/sesion/ingresar/route.ts`, `app/api/sesion/clave/route.ts`, `app/api/sesion/salir/route.ts`
- `app/api/usuarios/route.ts`, `app/api/usuarios/[id]/route.ts`, `app/api/usuarios/[id]/clave/route.ts`, `app/api/usuarios/cerrar-clave-comun/route.ts`
- `app/usuarios/page.tsx`, `components/usuarios/*`
- `components/elegir-clave.tsx`, `components/seccion-protegida.tsx`, `components/motivo.tsx`
- `lib/__tests__/sesion-permisos.test.mjs`, con el script `test:sesion` en `package.json` (mismo formato que `test:gps`)

**Se modifican:**
- `components/login-gate.tsx`, `lib/current-user.ts`, `lib/activity-log.ts`, `components/app-shell.tsx`, `app/actividad/page.tsx`, `components/user-selector.tsx`
- los componentes del punto 8
- las dos rutas de mail
- las páginas de 4.2
- `types/database.ts` (se regenera con `scripts/generar-tipos.mjs` y la migración aplicada en una transacción)

**No se agregan dependencias.**

### 13. Pruebas que deja el obrero
**1. `npm run test:sesion` (node --test, sin base):**
- permisos: las 3 plantillas, gerencial siempre puede, usuarios no se habilita por persona, claves que faltan = false, acciones que no existen = false, normalizar basura;
- clave: hash y verificación, contraseña mal, hash con otro formato, validación de la nueva;
- token: firma, adulterado, vencido, sin secreto;
- `decidirIngreso`: los 7 casos de 5.3, más "después de elegir la suya, la común ya no vale" y el bloqueo a los 5 errores.

**2. Base en `BEGIN … ROLLBACK`** (con el OK de la sesión principal):
- la migración dos veces;
- tipo y permisos de cada uno de los 7;
- credenciales creadas;
- `SET ROLE anon` no puede leer `app_user_credenciales`;
- `editar_despacho` con motivo deja "Motivo" en Actividad, y sin motivo queda idéntico a producción;
- `ajustar_material_despacho` con 5 parámetros con nombre (como main) y con `p_motivo`;
- un insert en `app_users` como el del login viejo queda consulta;
- al final, que no quede nada en producción.

**3. Front:**
- `next build --webpack` limpio, y `tsc` sin errores nuevos en los archivos tocados (hoy son 54 líneas);
- con el modo de prueba local, capturas como Bautista (gerencial), Titan, Felipe, Braian y Joaquín:
  - menú;
  - Semana (pedido en solo lectura para Felipe);
  - Despacho diario;
  - Historial (sin ⋯ Editar/Eliminar para operarios);
  - Materia prima (sin contraseña en Ajustar; Ajustar solo para gerencial);
  - Calidad;
  - Mantenimiento;
  - Usuarios.
- **Sin grabar nada.**

### 14. Plan de publicación
1. **Bautista aprueba** esta especificación (y contesta las preguntas). Obrero → revisor, como siempre.
2. **Bautista carga `SESION_SECRETO`** en Vercel (Production y Preview) y confirma que `SUPABASE_SERVICE_ROLE_KEY` esté también en Preview.
3. **La sesión principal aplica la migración**, avisándole antes a Bautista. Se puede en cualquier momento: main no cambia en nada. Se controla:
   - los avisos del final;
   - `select name, tipo from app_users`;
   - que un despacho y una edición desde main sigan andando (sin motivo, igual que antes).
4. **Preview** (usa la base real). Bautista:
   1. entra con su nombre y la contraseña de siempre, y elige la suya. Esa queda como su contraseña real;
   2. en Usuarios, da de alta a **David** (Operario, Laboratorio) con una contraseña inicial que le pasa en persona;
   3. si quiere ver la pantalla de un operario, crea un "Usuario de prueba" operario, entra con él en otra ventana privada, mira y después lo da de baja;
   4. revisa que "Ajustar" ya no pida contraseña y pida motivo (sin guardar);
   5. **no** despacha ni edita datos reales de prueba.
5. **Merge** al terminar el día, después del último despacho (o un día sin despachos). Antes, Bautista manda al grupo (texto sugerido):
   > "Desde mañana cada uno entra al sistema con su propia contraseña. La primera vez elegí tu nombre y poné la contraseña de siempre: el sistema te va a pedir que elijas una nueva (mínimo 6 letras o números; ojo con las mayúsculas). No se la pases a nadie. Si te la olvidás, pedime que te la blanquee."
6. **Día siguiente:** Titan y Felipe entran y eligen la suya (un minuto). Bautista mira en Usuarios el recuadro "Primer ingreso pendiente". Cuando están todos, o a más tardar a la semana, toca **"Cerrar el ingreso con la contraseña común"**. Al que haya quedado sin entrar (por ejemplo, Joaquín) le da una contraseña inicial.
7. **Vuelta atrás:** se revierte el merge y main vuelve a ser el de hoy. La migración se puede quedar (main no la usa); las contraseñas elegidas quedan guardadas para el segundo intento.

### 15. Criterios de aceptación
1. Los 7 existentes entran la primera vez con la contraseña común, el sistema los obliga a elegir la suya, y después **la común ya no les sirve**.
2. David, creado desde Usuarios, entra con la contraseña inicial y tiene que cambiarla. Un blanqueo hace lo mismo y cierra sus sesiones abiertas.
3. En el navegador no hay ninguna contraseña:
   - ni la común ni la de "Ajustar stock" en el código del navegador (se busca en `.next/static`);
   - ni hashes en ninguna respuesta;
   - ni la sesión en `localStorage` (solo el caché del usuario).
4. Cambiar a mano `localStorage` (tipo o permisos) no da acceso a otra persona: al recargar, `GET /api/sesion` lo pisa. Sin la cookie, vuelve al login.
5. Con 5 contraseñas mal seguidas, la cuenta queda frenada 10 minutos, con el mensaje que corresponde.
6. Cada persona ve exactamente los botones de su tabla (4.5 y 8):
   - **Felipe:** crea pedidos y arma el día, despacha, carga ingresos, edita clientes; no edita pedidos ni despachos, no ajusta stock.
   - **Titan:** además edita pedidos, carga laboratorio y mantenimiento.
   - **Braian:** solo mantenimiento.
   - **David:** solo laboratorio.
   - **Joaquín:** ningún botón de carga, ve todo.
   - **Los gerenciales:** todo, más Usuarios y Actividad.
7. Un gerencial le habilita a Titan "Historial › editar y borrar", y Titan ve ⋯ Editar / Eliminar en el Historial al recargar.
8. Toda edición o borrado de 8 pide motivo, no deja guardar sin él, y queda en Actividad con el antes, el después y el motivo. Los borrados mandan el mail con el motivo.
9. Quedan en Actividad: crear y editar pedido, cancelar y eliminar pedido, finalizar, editar total, recuento, humedad, muestra, rotura, probetas, granulometrías, calibración, clientes, obras, fórmulas, materiales, camiones, proveedores, OT y usuarios.
10. "Ajustar stock" no pide contraseña: alcanza con `recuentos.cargar`.
11. El interruptor de funciones nuevas se maneja desde Usuarios y funciona igual que antes.
12. No queda ningún botón de "Agregar usuario" fuera de Usuarios.
13. **No se pierde nada:** un despacho desde pedido y uno manual (agua extra, fibra, muestra, humedad) graban exactamente lo mismo que antes, con un operario con permiso. Se prueba como en la Fase 1: comparación en `BEGIN … ROLLBACK` y capturas del formulario.
14. Sin conexión con el servidor, quien ya había entrado sigue trabajando con sus permisos guardados.
15. El WhatsApp diario de Concretus sigue llegando (la 0c-1 no toca permisos de lectura).

### 16. Riesgos
| Riesgo | Cómo se cubre |
|---|---|
| Falta `SESION_SECRETO` en Production y nadie puede entrar | Paso 2 del plan antes del merge; mensaje claro en el login; vuelta atrás = revertir el merge |
| Alguien elige la contraseña de otro durante la transición | Ventana corta, botón para cerrarla, registro en Actividad, blanqueo + `sesion_version` (5.1) |
| Tablet compartida: se trabaja con la sesión de otro | Nombre y tipo siempre visibles arriba; "Salir" a mano. Se puede sumar un cierre por inactividad si Bautista lo pide |
| Hasta la 0c-2 la seguridad es "lo que se ve": con la clave pública se puede escribir igual, y `p_usuario` sigue siendo un nombre que manda el navegador | Explícito en el alcance. La 0c-2 lo cierra. La 0c-1 ya deja todo `app_users` escrito por el servidor, así la 0c-2 puede quitarle la escritura a anon sin tocar el front |
| Una regla de permisos deja a alguien sin poder hacer algo que hacía (no se pierde nada) | Tablas 4.5 y 8 a la vista de Bautista; preguntas abajo; un gerencial lo habilita en 10 segundos desde Usuarios, sin publicar nada |
| Caché viejo de permisos (se cambian mientras la persona trabaja) | Se refresca al abrir y cada 15 minutos; la baja y el blanqueo cierran la sesión |
| Cambio grande en muchas pantallas | Se implementa en 3 bloques en la misma rama: (a) base + servidor + login + Usuarios, (b) `puede()` + botones + motivo, (c) Actividad. Una sola publicación. Si (b) se demora, (a) se puede publicar sola: no cambia ningún botón |

**Compatibilidad con la 0c-2:**
- `permisos` es un jsonb de dos niveles con booleanos. Se puede copiar tal cual a los datos del token de Supabase Auth (`app_metadata`) y leerlo desde las reglas RLS con una función `tiene_permiso(seccion, accion)`.
- Como la ruta de ingreso recibe la contraseña, la 0c-2 puede **crear el usuario de Supabase Auth en el siguiente ingreso de cada persona**, sin pedirle otra contraseña.
- El login ya no lee `app_users` con la clave pública.

### 17. Preguntas para Bautista
1. **Titan y los pedidos.** Se le da "editar" en Programación del día: cambiar hora o m³ de un pedido cargado, editar total, tiempos de planta. ¿Y también **cancelar** pedidos, por ejemplo por lluvia a primera hora? *Recomendación:* sí, habilitarle programacion.borrar desde Usuarios. Hoy queda sin cancelar, por la regla "borrar solo gerencial".
2. **Felipe y los pedidos.** Con su plantilla crea pedidos y ajusta el día (hora en la vista Día, viajes, 👍), pero no abre el formulario de un pedido ya cargado para editarlo. ¿Está bien? *Recomendación:* dejarlo así y habilitarle editar si lo pide.
3. **Alta rápida de obra por Titan.** Si al programar aparece una obra nueva, Titan no puede darla de alta, porque Clientes y obras es de gerenciales y Felipe. *Recomendación:* darle a Titan **cargar** (no editar) en Clientes y obras.
4. **Agregar muestra después del despacho** quedó como "editar" del Historial (solo gerencial), como dice la definición. ¿David o Titan registran muestras olvidadas? Si es así, se les habilita historial.editar o se pasa a "cargar" de Laboratorio. *Recomendación:* dejarlo como está.
5. **Apellido de David** (y mail, si va a recibir avisos: hoy los avisos son solo para gerenciales).
6. **Actividad** queda solo para gerenciales, como hoy con los supervisores. ¿Está bien?

### 18. Respuestas de Bautista (06/10/2026) — mandan sobre lo anterior
1. **Cancelar o eliminar pedidos: solo gerenciales.** Titan **no** cancela (`programacion.borrar=false`, como ya estaba).
2. **Titan da de alta clientes y obras:** `clientes.cargar=true` para Titan (alta, incluida la rápida dentro del pedido). No edita ni borra.
3. **Agregar muestra después del despacho: lo pueden hacer todos los que cargan.** Se separa de "editar" del Historial. Pasa a ser `historial.cargar`, que ahora existe en la sección `historial` con el significado "agregar muestra después del despacho". Va `true` en las plantillas gerencial y operario, y `false` en consulta. Agregar fibra o superfluidificante después sigue siendo `historial.editar` (solo gerencial). Los permisos iniciales de los 5 operarios (incluido David al crearlo) lo llevan en `true`.
4. **Felipe ajusta el día solo en los pedidos que generó él.** Regla general para Programación del día:
   - **`programacion.cargar`:** crear pedidos, y ajustar y corregir **solo los pedidos propios** (`scheduled_dispatches.created_by` = nombre del usuario, normalizado igual que el login). Ajustar es hora y método en la vista Día, viajes y gerenciador, 👍 confirmar, y el formulario del pedido.
   - **`programacion.editar`:** lo mismo sobre **todos** los pedidos, más las acciones que tocan el día entero ("Ordenar el día" / "Guardar plan" de todos), "Editar total" y los tiempos de la planta. Lo tienen Titan y los gerenciales.
   - En los pedidos ajenos, a Felipe le aparecen en modo lectura.
   - `created_by` ya existe y está cargado en los 617 pedidos. El helper es `puedeAjustarPedido(usuario, pedido)` en `lib/permisos.ts`.
   - Ojo: hoy `created_by` sale del selector "Responsable", que se elige a mano. Desde la 0c-1 se completa solo con el usuario de la sesión, y el selector deja de permitir altas.
5. **David:** lo da de alta un gerencial desde Usuarios. El apellido y el mail los pone ahí; no hacen falta ahora.
6. **Actividad: solo gerenciales.** Confirmado.

## Hecho

### 0c-1 · Obrero (06/10/2026) — rama `loop/fase-0c-usuarios`, sin push

**Commits**
1. `docs(migracion-loop): fase 0c-1, especificación y respuestas de Bautista`
2. `feat(usuarios): … (fase 0c-1, bloque a)`: migración ajustada al punto 18, `lib/permisos.ts`, `lib/auth/*`, rutas `/api/sesion/*` y `/api/usuarios/*`, login nuevo, "Elegí tu contraseña", menú del usuario, pantalla Usuarios, menú filtrado, páginas envueltas en `SeccionProtegida`, mails a `tipo = gerencial`, `npm run test:sesion`.
3. `feat(permisos): … (fase 0c-1, bloques b y c)`: todos los botones del punto 8 condicionados, motivo obligatorio, Actividad completa, `types/database.ts` regenerado.

**Qué se hizo (resumen)**
- Login con nombre y contraseña propia; sesión en cookie `rebucret_sesion` (httpOnly, firmada con `SESION_SECRETO`, 30 días, se renueva sola). Primer ingreso de los 7 con la contraseña de siempre, que obliga a elegir una propia. Bloqueo de 10 minutos a los 5 errores. "Cambiar mi contraseña" y "Salir (cambiar de usuario)" en el menú del usuario (abajo a la izquierda y en el círculo de arriba, que ahora muestra las iniciales).
- La contraseña común quedó solo en `lib/auth/clave.ts` (servidor). Se borraron la del login, el "Agregar nuevo usuario" del login, el "Agregar" del selector Responsable y las dos contraseñas fijas de "Ajustar stock". Se buscó en `.next/static` después del build: no aparecen.
- Pantalla **Usuarios** (`/usuarios`, solo gerenciales): lista con tipo, "Carga en", "Edita/borra" a mano, estado de la contraseña, último ingreso, bloqueado, interruptor de funciones nuevas; recuadro "Primer ingreso pendiente" con "Cerrar el ingreso con la contraseña común"; diálogo con tipo (3 botones), matriz con marca "a mano" y "Volver a la plantilla", contraseña inicial, blanqueo, baja/reactivar. Actividad deja de tener la tarjeta del interruptor y su filtro "Tipo" sale de un mapa + lo que haya en los datos.
- `puede()` / `usePermisos()` / `esGerencial()` en `lib/current-user.ts`; `puedeAjustarPedido` en `lib/permisos.ts`. Ningún componente compara `role`. `tipo` solo se compara en el editor de la pantalla Usuarios (sobre la persona que se edita, no sobre la sesión) y en `lib/current-user.ts`.
- Motivo (`components/motivo.tsx`) en toda edición y borrado del punto 8 y en el recuento. Va a Actividad (`Motivo`), al mail de borrado, a `editar_despacho` (jsonb `motivo`), `ajustar_material_despacho` (`p_motivo`) y `anular_despacho` (`p_motivo`, antes iba `null`).

**Desvíos de la especificación y por qué**
1. **Acciones que no existen se guardan en `false` también en la base.** `recuentos.ver` queda `false` (4.2 dice "—"; el ejemplo de 4.3 lo mostraba en `true`), y la plantilla gerencial de la migración pasó de "todo `true` en todas las secciones" a "todas las acciones que existen". Así lo guardado es idéntico a `normalizarPermisos` (probado). No cambia nada en pantalla: gerencial puede todo igual.
2. **`decidirIngreso` recibe también `esComun`** además de `verificar`: así queda pura y sin imports (se prueba con `node --test` sin tocar la contraseña real).
3. **No hay `lib/supabase/servicio.ts`**: `sbServicio()` reusa `sbAdmin()` de `lib/wialon.ts` (la spec dejaba elegir; no se duplica).
4. **"Agregar muestra" no pide motivo**: con la respuesta 18.3 pasó a ser `historial.cargar`, y la regla 9 pide motivo solo en editar/borrar. Queda en Actividad igual (muestra, asentamiento, probetas creadas).
5. **Granulometría pendiente**: completar un ensayo que todavía no tiene resultados (los que nacen del ingreso con "muestra tomada") se hace con `laboratorio.cargar` y sin motivo; corregir uno ya cargado pide `laboratorio.editar` y motivo. Si no, David no podría cargar esos resultados (hoy se cargan con el lápiz).
6. **Editar un pedido desde el formulario de Semana siempre pide motivo**, también a Felipe con sus propios pedidos (es una edición de algo ya cargado). Los ajustes rápidos de la vista Día (hora, método, 👍, viajes) no piden motivo, como antes.
7. **Vista Día**: "Ordenar el día" y "Guardar plan del día" solo con `programacion.editar` (18.4: tocan el día entero). Hora/método/👍 se deshabilitan en los pedidos ajenos para quien solo carga. Los tiempos de la planta se pueden seguir tocando para mirar el plan, pero el botón Guardar (con motivo) es de `programacion.editar`.
8. **Rotura y calibración** sin `laboratorio.cargar`: los campos de la fila quedan deshabilitados y el botón "Calibración" no aparece (antes se podía abrir para mirar las constantes).
9. **Camiones › Dar de baja**: el botón de la papelera no abría nada (el diálogo nunca se dibujaba). Ahora abre la confirmación con motivo y funciona. Las bajas de clientes/obras/camiones dejaron la doble confirmación y pasaron a una sola con motivo.
10. **Cancelar OT**: el motivo se guarda en las observaciones de la orden (`Cancelada: …`) y en Actividad.
11. **Responsable**: en Semana ya no hay selector (el pedido lo carga la persona en sesión, 18.4). En el despacho manual queda el selector "Responsable", sin "Agregar" y con la persona en sesión por defecto.
12. **Rutas de Usuarios** (`/api/usuarios*`) además de gerencial piden que la persona ya haya elegido su contraseña. Cambiar el tipo mantiene `role` coherente (gerencial → `supervisor`, resto → `operario`).
13. El modo de prueba local también vale para `GET /api/usuarios` (para ver la pantalla Usuarios sin grabar).

**Cómo se probó**
- `npm run test:sesion`: 20 pruebas OK (plantillas, gerencial puede todo, usuarios no se habilita por persona, basura normalizada, `puedeAjustarPedido`, hash/verificación, formatos inválidos, validación de la nueva, token firmado/adulterado/vencido/sin secreto, los 7 casos de `decidirIngreso` + bloqueo a los 5 + "con la suya, la común no vale").
- Migración en producción **dos veces dentro de un `BEGIN … ROLLBACK`** (script en el scratchpad, `probar-migracion.mjs`): los 7 con el tipo y los permisos de 4.5 + 18 (Titan con `clientes.cargar` y sin `programacion.borrar`; los operarios con `historial.cargar`); lo guardado ya normalizado; los avisos del final iguales en las dos corridas; 7 credenciales con primer ingreso pendiente; `anon` y `authenticated` reciben "permission denied" en `app_user_credenciales`; `editar_despacho` sin motivo da el mismo resultado, la misma Actividad y los mismos 6 movimientos de stock que la función de producción, y con motivo deja "Motivo" en Actividad y en la nota del movimiento; `ajustar_material_despacho` con los 5 parámetros con nombre de main da lo mismo que producción y con `p_motivo` deja "Motivo"; queda una sola firma; un alta como la del login viejo queda `consulta`; el índice frena nombres repetidos. Después del ROLLBACK se verificó que producción quedó igual (sin columnas nuevas, sin tabla, firma vieja). **Nada se aplicó.**
- `tsc --noEmit`: 17 errores, todos viejos (había 18: se arregló el de `transferir` en `ActivityAction`). Ninguno nuevo en los archivos tocados.
- `next build --webpack` (con variables de relleno): OK. En `.next/static` no aparecen la contraseña común, las de "Ajustar stock", `scrypt` ni el secreto.
- Revisión a mano archivo por archivo de la lista del punto 8.
- **No se probó en pantalla** (no se usa el navegador en esta sesión) ni el modo de prueba local: antes de aplicar la migración las columnas `tipo`/`permisos` no existen y `GET /api/sesion` no tiene qué leer.

**Ajustes de la revisión (07–08/10/2026)**
1. **Freno de intentos atómico.** Funciones nuevas en la migración, `SECURITY DEFINER`, `search_path = public, pg_temp`, ejecutables solo por `service_role` (REVOKE a PUBLIC, anon y authenticated):
   - `registrar_ingreso_fallido(user)`: bloquea la fila (`FOR UPDATE`) y suma 1 en la base; al llegar a 5, `bloqueado_hasta = now() + 10 min` e intentos a 0; si ya estaba bloqueado no suma ni alarga (`ya_bloqueado`); `RETURNING` del estado grabado.
   - `registrar_ingreso_ok(user)`: el reseteo al acertar, pero solo si en ese momento no está bloqueado. Es el chequeo atómico del bloqueo: si otro pedido lo bloqueó mientras se verificaba la contraseña, no entra.
   - `POST /api/sesion/ingresar` usa las dos; el mensaje sale de `errorTrasIntentoFallido` (pura, con prueba).
2. **Escritura de `app_users` cerrada para el navegador.** `REVOKE INSERT, UPDATE, DELETE, TRUNCATE` a anon y authenticated, y `GRANT` por columna solo de lo que main usa hoy (revisado en `v0-stock-management-app`): `INSERT (name, active, role)` (login y selector Responsable) y `UPDATE (ve_funciones_nuevas)` (Actividad). `tipo`, `permisos`, `email`, `name` y `active` ya no se pueden tocar con la clave pública. **Pendiente: en la 0c-2 (o en una migración posterior al merge) se sacan también esos GRANT residuales**, porque el front nuevo no escribe `app_users` desde el navegador.
3. **Los gerenciales no entran con la contraseña común (decisión del 07/10, explicada en 5.1).** `permite_clave_comun = true` solo para Titan, Felipe, Braian, Joaquín y Bautista. Juan y Fernando quedan sin contraseña ("Todavía no tenés contraseña…") hasta que Bautista, en el preview y con la suya ya elegida, les dé una inicial desde Usuarios.
4. **"Cerrar el ingreso con la contraseña común"** pasa por `cerrar_ingreso_clave_comun(por)`: `permite_clave_comun = false` para todos y `sesion_version + 1` donde `clave_hash` es nulo (corta las sesiones que entraron con la común y no eligieron la suya). Queda en Actividad cuántas sesiones se cerraron.
5. **Sin `SUPABASE_SERVICE_ROLE_KEY`** las rutas devuelven 500 `{codigo: "sin_clave_servicio"}` y el login muestra "El sistema no está bien configurado (falta la clave de servicio). Avisale a Bautista.", igual que con `sin_secreto`.
6. **Fin de línea.** Los 22 archivos que en main son CRLF (más `package.json`) volvieron a CRLF; ninguno había cambiado solo el fin de línea. `git diff origin/main --stat` bajó de 12.910/7.972 a ≈6.190/1.080 líneas.

Pruebas de los ajustes:
- `npm run test:sesion`: 21 OK.
- Migración dos veces en `BEGIN … ROLLBACK`: 80 controles OK, entre ellos:
  - 4 fallos suman 4; al 5.º, 10 minutos de bloqueo y los intentos a 0; bloqueado, otro fallo no suma y acertar no entra; con el bloqueo vencido entra.
  - anon y authenticated reciben "permission denied" en las tres funciones.
  - El cierre da `sesion_version + 1` solo a los que no tienen contraseña propia.
  - Con `SET ROLE anon` fallan el UPDATE de `tipo`, `permisos`, `email`, `name` y `active`, el DELETE y el INSERT con `tipo`; andan el INSERT de main (con `RETURNING *`), el UPDATE de `ve_funciones_nuevas` y el SELECT.
- `tsc` sin errores nuevos (17 viejos) y build OK.
- `types/database.ts` regenerado.

**Para el día de la publicación**
1. Bautista carga `SESION_SECRETO` (48+ caracteres) en Vercel, Production y Preview, y confirma `SUPABASE_SERVICE_ROLE_KEY` en Preview.
2. La sesión principal aplica la migración avisándole a Bautista. **Tiene que estar aplicada antes del merge**: el front nuevo lee `tipo`/`permisos`/credenciales y manda `p_motivo` a `ajustar_material_despacho` (main sigue andando igual con la migración aplicada; probado).
3. Con la migración aplicada: capturas con el modo de prueba local (`SESION_LOCAL_COMO`) como Bautista, Titan, Felipe, Braian y Joaquín, y regenerar tipos si cambió algo.
4. Preview: los pasos de 14.4 (Bautista entra con la común, elige su contraseña, da contraseña inicial a Juan y Fernando, alta de David como Operario + Laboratorio, "Ajustar" sin contraseña y con motivo, sin grabar datos de prueba).
5. Merge al final del día; al abrir, todos ven el login (el caché viejo no vale como sesión) y entran con la de siempre la primera vez. Mensaje al grupo de 14.5.
6. A la semana (o cuando estén todos): "Cerrar el ingreso con la contraseña común".

