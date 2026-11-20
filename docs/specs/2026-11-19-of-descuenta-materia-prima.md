# La OF del robot tiene que descontar la materia prima en Zomatik (19/11/2026)

> Urgente. Lo pidió Bautista el 19/11: "necesito que el robot haga todo". Capturas reales del 19/11 (solo lectura).

## 1. El problema

Desde que el robot hace las OF, **Zomatik no descuenta la materia prima**. Cuando una persona da de alta una OF:

1. `POST grabar_ordenfabricacion.php?codigo=0` (alta).
2. Zomatik redirige a la **segunda pantalla**: `modificar_ordenfabricacioncompo.php?codigo=N` ("Composicion"), con un
   campo `adescontar_<id interno del material>` por material, precargado con composición del artículo × cantidad de la
   OF (en toneladas). La persona toca "Continuar" → `POST grabar_ordenfabricacioncompo.php` → Zomatik crea un **remito
   interno (RMI) de materia prima** ligado a la OF. Es lo que descuenta el stock.
3. "Remitir la OF" (lapicito, `remitir_ordenfabricacion.php?codigo=N`) → crea el **RMI del hormigón terminado** y la OF
   pasa a FIN.

El robot hace 1 y 3 y se saltea 2. Evidencia (listado de remitos internos, 19/11): toda OF hecha a mano tiene **dos**
RMI (materia prima + hormigón); toda OF del robot tiene **uno** (hormigón). En la OF 3447 de Fernando: alta 06:48:32,
RMI de materia prima 06:48:35, RMI del hormigón 06:48:43; los valores del RMI de materia prima son exactamente los que
precarga la pantalla (2,79 · 6,51 · 9,75 · 2,85).

OF del robot sin materia prima: 3424, 3427 (06–07/11), 3442, 3443, 3444, 3450 (13/11), 3453–3456 (16/11), 3457–3460
(18/11). Algunas son duplicadas de OF hechas a mano (la 3450 seguro; 3424 y 3427 probablemente): esas NO se regularizan.

## 2. Lo capturado (fixtures nuevos en `lib/__fixtures__/zomatik-z1/`)

- `of-compo.html`: la segunda pantalla real (OF 8271, 1 m³). Form `frm_ordenfabricacion`, `action="grabar_ordenfabricacioncompo.php"`,
  `method="POST"`, `enctype="multipart/form-data"`; ocultos `ordenfabricacion` (= código de la OF) y `fparam` (vacío);
  un `<input type="TEXT" name="adescontar_<id>">` por material con el valor a descontar; cada fila trae código de
  artículo (8 dígitos), nombre y cantidad. "Continuar" = `Validar()` → `submit()` (no arma `fparam`).
- `remitosinternos-listado.html`: `listado_remitosinternos.php` (búsqueda `bus_numero`, `bus_fechacred`,
  `bus_fechacreh`; columnas Codigo · Fecha · Flete · Deposito Origen · Deposito Destino · Observaciones · Remito Fisico ·
  Recibido · OF). La columna OF dice "OF 0001-0000NNNN". Por defecto trae los últimos 150.
- La pantalla "Composicion" **se puede abrir para una OF que ya existe**, también FIN, y muestra lo que corresponde a su
  cantidad (leído para la 8268 del robot, 4 m³: 0,94 · 2,82 · 3,88 · 1,24). **También la muestra para una OF que YA
  descontó** (8248, hecha a mano): Zomatik no protege contra descontar dos veces. El control lo tiene que hacer el robot.
- Lo que NO se capturó: la respuesta del `POST grabar_ordenfabricacioncompo.php` (no se confirmó la OF de prueba). Por
  eso la verificación NO depende de esa respuesta: se vuelve a leer el listado de remitos internos.

## 3. Qué se hace

### 3.1 Paso nuevo en el robot de Z1: "materia prima de la OF"

En el flujo de la OF (`lib/zomatik/z1-robot.ts`, `z1-servidor.ts`), entre "OF creada" y "remitir la OF":

1. Sucursal REBUCRET (18), como el resto.
2. **Contar los RMI de esa OF** en `listado_remitosinternos.php` (por el número de OF de la fila; el listado tiene que
   llegar hasta la fecha de la OF: si los 150 por defecto no alcanzan, buscar con `bus_fechacred`/`bus_fechacreh`; si no
   se puede asegurar, no se sigue → reintento / revisar). Regla (`tieneRmiDeMp`, pura y con test):
   - OF **PEN** (no remitida): 0 RMI → falta la materia prima; ≥ 1 → ya está.
   - OF **FIN** (remitida): 1 RMI → falta; ≥ 2 → ya está.
   Si ya está: no se manda nada y queda `ok` ("ya estaba").
3. `GET modificar_ordenfabricacioncompo.php?codigo=N`. Controles (cualquiera que falle → `revisar`, sin mandar):
   - el form es `grabar_ordenfabricacioncompo.php`, POST;
   - `ordenfabricacion` === N;
   - hay al menos un `adescontar_<dígitos>`; todos con valor numérico > 0;
   - no hay otros campos con nombre desconocido (solo `ordenfabricacion`, `fparam`, `adescontar_*`).
   Sin ningún `adescontar_*`: el artículo no tiene composición en Zomatik → `revisar` con ese texto.
4. Guardar el paso (`mp_of`) ANTES del POST. `POST grabar_ordenfabricacioncompo.php` con **los mismos campos y valores
   que trajo la pantalla, sin cambiarlos** (lo que hace una persona al tocar Continuar).
5. Verificar: volver a contar los RMI de la OF. Tiene que haber exactamente uno más → `ok`. Si no → `revisar` (nunca se
   reintenta el POST a ciegas: en un corte, se vuelve a contar primero; si ya subió, es `ok`).
6. Queda en Actividad: "Materia prima descontada en Zomatik" con el detalle (artículo y toneladas de cada material).

**Si el paso queda en `revisar`** (sin composición, formato raro, verificación que no cierra): **el remito del cliente
NO se frena**. Se sigue con "remitir la OF" y el remito; la fila queda marcada "MP: revisar" y sale UN mail a Bautista y
Juan (un aviso por episodio, como los demás) con la OF, el artículo y el motivo.

Si el paso queda pendiente por red/sesión/turno: se reintenta en la pasada siguiente, con el mismo tope de reintentos
que los otros pasos; mientras tanto sí espera (no se remite la OF sin haber intentado la materia prima, salvo `revisar`).

### 3.2 Lista cerrada (`lib/zomatik/web.ts`)

El navegador de Z1 puede, además de lo de hoy y SOLO para la OF que está trabajando:
- `GET modificar_ordenfabricacioncompo.php?codigo=N`
- `POST grabar_ordenfabricacioncompo.php` con `ordenfabricacion=N` en el cuerpo
- `GET listado_remitosinternos.php` y `POST listado_remitosinternos.php?enviado=1` (búsqueda)
Nunca: `borrar_remitosinternos.php`, `grabar_remitosinternos.php`, `modificar_remitosinternos.php` con escritura,
ni ningún otro `grabar_*`. Tests de que se rechazan.

### 3.3 Base (`zomatik_remitos`), migración nueva SIN aplicar

`supabase/migrations/202611191200_zomatik_of_mp.sql` (se puede correr dos veces; BEGIN/COMMIT; `lock_timeout`):
- `of_mp_estado text` NULL con CHECK en (`pendiente`, `ok`, `revisar`, `no`):
  - NULL = filas viejas (no se tocan solas);
  - `pendiente` = hay que descontar (las filas nuevas nacen así cuando se crea la OF; las viejas, solo si alguien las
    marca para regularizar);
  - `ok` = descontada (o ya estaba);
  - `revisar` = no se pudo (ver mensaje);
  - `no` = decidido que no va (OF duplicada).
- `of_mp_at timestamptz`, `of_mp_mensaje text`, `of_mp_detalle jsonb` (lo descontado: `[{codigo, nombre, toneladas}]`).
Datos cargados: no cambia ninguna fila (todas quedan con NULL). Sin la migración aplicada el código tiene que seguir
andando como hoy (tolerar 42703: el paso no corre).

### 3.4 Regularizar las OF atrasadas

Las filas viejas (NULL) no se procesan solas, por los duplicados. La pasada del robot (la de cada 10 minutos) toma
también las filas con `of_mp_estado = 'pendiente'` cuya OF ya está creada (incluso FIN y con el remito hecho) y les corre
el mismo paso 3.1 (para una FIN: 1 RMI → falta). Quién las marca `pendiente`: un script que corre Bautista (fuera de
esta rama; lo arma el orquestador con la lista confirmada). Límite por pasada: las que entren en el tiempo, de a una,
con el turno del robot.

### 3.5 Pantalla

Mínimo: donde hoy se ve el estado de la OF/remito del pedido (chip y detalle en Despacho y Programación), si
`of_mp_estado = 'revisar'` se ve "MP sin descontar" con el motivo en el tooltip. Sin montos. Nada más.

## 4. Lo que NO entra

- Cambiar las cantidades que propone Zomatik (mandar el consumo real, o el replanteo): es el paso siguiente y necesita
  el mapa material del sistema ↔ artículo de Zomatik. Dejar `enviarMp` preparado para recibir valores, pero hoy manda
  los de la pantalla.
- Borrar o corregir RMI: nunca.

## 5. Tests (`lib/__tests__/zomatik-z1.test.mjs` o archivo nuevo)

Con los fixtures nuevos y navegador simulado: OF nueva (0 RMI → POST con los mismos campos → 1 RMI → ok y sigue a
remitir); ya estaba (PEN con 1, FIN con 2 → no manda nada); regularizar FIN con 1 → POST → 2 → ok; sin composición →
revisar, mail, y el remito sigue; `ordenfabricacion` distinto → revisar sin mandar; campo desconocido → revisar sin
mandar; corte después del POST → al reintentar cuenta primero y no manda dos veces; verificación que no sube → revisar;
lista cerrada (rechaza `borrar_remitosinternos`, `grabar_remitosinternos` y un `grabar_ordenfabricacioncompo` de otra
OF); sin la migración no corre y todo sigue como hoy.

## 6. Criterios de aceptación

1. Una OF nueva del robot queda con dos RMI en Zomatik (materia prima + hormigón), como las hechas a mano.
2. Nunca descuenta dos veces la misma OF (cortes, reintentos, regularización).
3. Si no puede descontar, el remito del cliente sale igual y avisa por mail.
4. Las OF viejas solo se regularizan si se las marca `pendiente`.
5. Todos los tests de zomatik, despacho y sesion pasan; `tsc` no suma errores.
