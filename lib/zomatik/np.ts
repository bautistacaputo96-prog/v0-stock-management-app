/**
 * Zomatik · Z2 · Nota de pedido al programar — funciones puras (sin red, sin base, sin imports en tiempo de ejecución).
 * Se prueban con `npm run test:zomatik-np`. Especificación: docs/migracion-loop/zomatik.md, secciones 22, 23 y 24.
 *
 *   - Estados de cada NP que genera el sistema y qué se muestra.
 *   - Serie de numeración de REBUCRET (la NP no puede caer en la de RUTA 25 - CONCRETUS, 23.3).
 *   - Marca "Sistema Rebucret · pedido N" en las observaciones (23.3 d).
 *   - Lectura de las páginas de Zomatik que usa el robot: formulario de la NP, datos del cliente, listas, detalle
 *     (renglones), listado de pedidos y los `alert()` de error.
 *   - Cuerpos en ISO-8859-1 (Zomatik sirve y lee en latin1).
 *   - Planificación: qué NP hay que crear, vaciar o anular para un pedido (una NP por pedido y día; si se agranda,
 *     NP adicional por la diferencia; si se cancela, vaciar).
 *   - Control del despacho: modo aviso (2 semanas) y modo duro.
 */

// ---------------------------------------------------------------------------
// Estados
// ---------------------------------------------------------------------------

/**
 * pendiente  todavía no está en Zomatik (o Zomatik no respondió): reintento automático cada 10 min
 * generando  el robot la está cargando (si queda colgada más de 3 min, se trata como "cortada": primero se busca la marca)
 * ok         grabada y encontrada en el listado de REBUCRET con su número
 * revisar    cayó en otra sucursal, no aparece después de grabar o tiene remitos al cancelar: lo mira un gerencial
 * error      Zomatik (o el control previo) dijo que no: falta un dato. No se reintenta sola hasta que cambie el pedido
 * vaciar     el pedido se canceló: hay que borrar sus renglones y grabar (23.4)
 * vaciando   el robot la está vaciando
 * vaciada    quedó con total 0 y sin ítems
 * anulada    nunca llegó a Zomatik y ya no hace falta (pedido cancelado o rehecho antes de generarla)
 */
export const ESTADOS_NP = ["pendiente", "generando", "ok", "revisar", "error", "vaciar", "vaciando", "vaciada", "anulada"] as const
export type EstadoNp = (typeof ESTADOS_NP)[number]
export type TipoNp = "nueva" | "proyecto"

export const TEXTO_ESTADO: Record<EstadoNp, string> = {
  pendiente: "NP pendiente",
  generando: "Generando NP…",
  ok: "NP",
  revisar: "NP: revisar",
  error: "NP con error",
  vaciar: "NP: falta vaciar",
  vaciando: "Vaciando NP…",
  vaciada: "NP vaciada",
  anulada: "NP anulada",
}

/** Las que cuentan como "la NP del pedido" (las que siguen vivas). */
export const VIGENTES: EstadoNp[] = ["pendiente", "generando", "ok", "revisar", "error"]
/** Las que todavía no llegaron a Zomatik (se pueden rehacer sin tocar nada allá). */
export const SIN_GRABAR: EstadoNp[] = ["pendiente", "error"]

/** Minutos sin terminar después de los cuales "generando" / "vaciando" se considera cortado. */
export const MIN_CORTADA = 3
/** Cada cuánto se reintenta una NP pendiente. */
export const MIN_REINTENTO = 10

// ---------------------------------------------------------------------------
// Comprobante y serie de numeración
// ---------------------------------------------------------------------------

export const SUCURSAL_REBUCRET = "18"
export const SUCURSAL_RUTA25 = "17"

/** R (con factura) → 15 Nota de Pedido · X (sin factura) → 16 Nota de Pedido 2 (spec 5.2 y 20.2). */
export function comprobanteDe(remitoTipo: string | null | undefined): "15" | "16" | null {
  if (remitoTipo === "R") return "15"
  if (remitoTipo === "X") return "16"
  return null
}

export const PREFIJO: Record<"15" | "16", "NP" | "NP2"> = { "15": "NP", "16": "NP2" }

/** "en 1" va con la NP y "en 2" con la NP2 (spec 5.3). */
export const LISTA_DE: Record<"15" | "16", "en 1" | "en 2"> = { "15": "en 1", "16": "en 2" }

/**
 * Serie de REBUCRET (23.3 b): NP 0001-00001xxx y NP2 0001-00002xxx. RUTA 25 va por 0001-00007xxx (NP) y
 * 0001-00006xxx (NP2). Se acepta de 1.000 a 5.999 en punto 0001: deja lugar para que la serie crezca años y nunca
 * toca la de RUTA 25. Si Zomatik cambia los talonarios, se ajusta acá.
 */
export const SERIE_REBUCRET = { punto: "0001", desde: 1000, hasta: 5999 }

/** "1-1176", "0001-00001176" o "NP 0001-00001176" → "0001-00001176" (o null). */
export function numeroNormalizado(s: unknown): string | null {
  const m = String(s ?? "").trim().match(/(\d{1,4})\s*-\s*(\d{1,8})\s*$/)
  if (!m) return null
  return `${m[1].padStart(4, "0")}-${m[2].padStart(8, "0")}`
}

export function esSerieRebucret(numero: unknown): boolean {
  const n = numeroNormalizado(numero)
  if (!n) return false
  const [punto, nro] = n.split("-")
  const v = Number(nro)
  return punto === SERIE_REBUCRET.punto && v >= SERIE_REBUCRET.desde && v <= SERIE_REBUCRET.hasta
}

/** "NP 0001-00001176" / "NP2 0001-00002080". */
export function numeroCompleto(comprobante: "15" | "16", numero: string): string {
  return `${PREFIJO[comprobante]} ${numeroNormalizado(numero) || numero}`
}

/** "NP2 0001-00002080" → "16"; "NP 0001-…" → "15". */
export function comprobanteDeNumero(s: unknown): "15" | "16" | null {
  const t = String(s ?? "").trim().toUpperCase()
  if (/^NP2\s/.test(t)) return "16"
  if (/^NP\s/.test(t)) return "15"
  return null
}

// ---------------------------------------------------------------------------
// Marca en las observaciones
// ---------------------------------------------------------------------------

/**
 * "Sistema Rebucret - pedido 1a2b3c4d - NP 1" — única por NP (n = 1 la primera, 2… las adicionales). Con guiones: el "·"
 * de antes llegaba a Zomatik como "�" (28/10). `tieneMarca` encuentra las dos formas (la vieja ya está grabada en NP reales).
 */
export function marcaNp(pedidoId: string, n: number): string {
  return `Sistema Rebucret - pedido ${String(pedidoId).replace(/-/g, "").slice(0, 8)} - NP ${n}`
}

const plano = (s: unknown) =>
  String(s ?? "")
    .replace(/\u00c2(?=\u00b7)/g, "") // "Â·": el "·" guardado en UTF-8 y leído en latin1
    .replace(/[\u00b7\ufffd?]/g, " ") // "·", "�" (como quedó en Zomatik el 28/10) o "?": separadores, igual que " - "
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w]+/g, " ")
    .toLowerCase()
    .trim()

/** ¿El texto tiene la marca? Sin importar mayúsculas, el "·" (que Zomatik puede guardar mal) ni los espacios. */
export function tieneMarca(texto: unknown, marca: string): boolean {
  const m = plano(marca)
  return !!m && ` ${plano(texto)} `.includes(` ${m} `)
}

// ---------------------------------------------------------------------------
// HTML de Zomatik
// ---------------------------------------------------------------------------

function decodificar(s: string): string {
  return String(s ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/gi, "&")
}

const sinComentarios = (html: string) => String(html ?? "").replace(/<!--[\s\S]*?-->/g, "")
const texto = (html: string) => decodificar(String(html ?? "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()

function atributo(tag: string, nombre: string): string | null {
  const m = tag.match(new RegExp(`\\b${nombre}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"))
  if (!m) return null
  return m[1] ?? m[2] ?? m[3] ?? ""
}

export type CampoForm = { nombre: string; valor: string }

/**
 * Valores CRUDOS de un formulario (lo que mandaría el navegador): inputs (value; radios y checkboxes solo si están
 * tildados), selects (el value de la opción elegida, o la primera) y textareas. Devuelve también el `action`.
 */
export function camposFormulario(html: string, nombreForm: RegExp): { action: string | null; campos: Record<string, string>; orden: CampoForm[] } | null {
  const limpio = sinComentarios(html)
  const forms = limpio.match(/<form\b[\s\S]*?<\/form>/gi) || []
  const form = forms.find((f) => nombreForm.test((f.match(/<form[^>]*>/i) || [""])[0]))
  if (!form) return null
  const cab = (form.match(/<form[^>]*>/i) || [""])[0]
  const orden: CampoForm[] = []
  const re = /<input\b[^>]*>|<select\b[^>]*>[\s\S]*?<\/select>|<textarea\b[^>]*>[\s\S]*?<\/textarea>/gi
  for (const m of form.matchAll(re)) {
    const t = m[0]
    if (/^<input/i.test(t)) {
      const nombre = atributo(t, "name")
      if (!nombre) continue
      const tipo = (atributo(t, "type") || "text").toLowerCase()
      if (["submit", "button", "image", "file", "reset"].includes(tipo)) continue
      if ((tipo === "radio" || tipo === "checkbox") && !/\bchecked\b/i.test(t)) continue
      orden.push({ nombre, valor: decodificar(atributo(t, "value") ?? "") })
    } else if (/^<select/i.test(t)) {
      const nombre = atributo((t.match(/<select[^>]*>/i) || [""])[0], "name")
      if (!nombre) continue
      const ops = [...t.matchAll(/<option\b([^>]*)>/gi)]
      const elegida = ops.find((o) => /\bselected\b/i.test(o[1])) || ops[0]
      orden.push({ nombre, valor: elegida ? decodificar(atributo(`<option ${elegida[1]}>`, "value") ?? "") : "" })
    } else {
      const nombre = atributo((t.match(/<textarea[^>]*>/i) || [""])[0], "name")
      if (!nombre) continue
      orden.push({ nombre, valor: decodificar(t.replace(/^<textarea[^>]*>/i, "").replace(/<\/textarea>$/i, "")) })
    }
  }
  const campos: Record<string, string> = {}
  for (const c of orden) if (!(c.nombre in campos)) campos[c.nombre] = c.valor
  return { action: atributo(cab, "action"), campos, orden }
}

/** Campos que el robot necesita en el formulario de la NP. Si falta uno, Zomatik cambió el formulario: no se manda nada (spec 12). */
export const CAMPOS_NP = [
  "pedidos_unico", "pedidos", "fparam", "idcliente", "cliente", "razon_social", "cuit", "deposito", "fecha_entrega",
  "observaciones", "observaciones_entrega", "comprobante", "numero", "idlista", "idvendedor", "vendedor", "estado",
] as const

export function faltanCampos(campos: Record<string, string>, lista: readonly string[] = CAMPOS_NP): string[] {
  return lista.filter((c) => !(c in campos))
}

/**
 * `traerdatossecundarios.php?fcliente=N` responde los datos separados por "#||#" (del JavaScript del formulario):
 * 0 dirección · 1 localidad · 2 provincia · 3 CP · 4 CUIT · 5 condición de pago · 9 razón social · 10 mail ·
 * 11 IVA · 12 id del vendedor · 13 nombre del vendedor.
 */
export type DatosCliente = {
  direccion: string; localidad: string; provincia: string; cp: string; cuit: string; condicion_pago: string
  razon_social: string; email: string; tipo_iva: string; idvendedor: string; vendedor: string
}

export function datosSecundarios(respuesta: string): DatosCliente | null {
  const t = String(respuesta ?? "")
  if (!t.includes("#||#") || /invalid/i.test(t)) return null
  const v = t.split("#||#").map((x) => x.trim())
  if (v.length < 12) return null
  return {
    direccion: v[0] || "", localidad: v[1] || "", provincia: v[2] || "", cp: v[3] || "", cuit: v[4] || "",
    condicion_pago: v[5] || "", razon_social: v[9] || "", email: v[10] || "", tipo_iva: v[11] || "",
    idvendedor: v[12] && v[12] !== "0" ? v[12] : "", vendedor: v[13] || "",
  }
}

/** Texto de los `alert('...')` sueltos de una respuesta (no los que están dentro de una función del formulario). */
export function alertasDe(html: string): string[] {
  const out: string[] = []
  for (const s of String(html ?? "").matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const js = s[1]
    if (/\bfunction\b/.test(js)) continue
    for (const a of js.matchAll(/alert\(\s*(["'])((?:\\.|(?!\1).)*)\1\s*\)/g)) out.push(a[2].replace(/\\n/g, " ").replace(/\\(.)/g, "$1").replace(/\s+/g, " ").trim())
  }
  return out.filter(Boolean)
}

/** La respuesta de manage_pedidos dice "invalid" cuando el borrador no sirve (el JavaScript la descarta). */
export const respuestaInvalida = (t: string) => /invalid/i.test(String(t ?? ""))

// ── Listas de precios (listado_listas.php) ──

export type Lista = { codigo: number; nombre: string; desde: string | null; estado: string }

export function listasDeListado(html: string): Lista[] {
  const out: Lista[] = []
  const vistos = new Set<number>()
  for (const tr of filasInternas(html)) {
    const m = tr.match(/modificar_listas\.php\?codigo=(\d+)/i)
    if (!m) continue
    const codigo = Number(m[1])
    if (vistos.has(codigo)) continue
    const celdas = (tr.match(/<td\b[^>]*>[\s\S]*?<\/td>/gi) || []).map(texto).filter(Boolean)
    if (celdas.length < 3) continue
    vistos.add(codigo)
    const f = (celdas[1] || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
    out.push({ codigo, nombre: celdas[0], desde: f ? `${f[3]}-${f[2].padStart(2, "0")}-${f[1].padStart(2, "0")}` : null, estado: celdas[2] })
  }
  return out
}

/**
 * La lista que corresponde (20.2, y Bautista el 28/10: "a fines prácticos usá esa"):
 *   - si hay UNA sola lista activa, va para la NP y la NP2, diga o no "en 1" / "en 2" (ej.: "Lista OCTUBRE 2026");
 *   - si hay varias activas, la "en 1" para la NP o la "en 2" para la NP2, y tiene que quedar una sola;
 *   - si no hay ninguna (o no queda una sola), no se genera ("Revisar las listas en Zomatik").
 */
export function listaActiva(listas: Lista[], comprobante: "15" | "16"): { lista: Lista } | { error: string } {
  const clave = LISTA_DE[comprobante]
  const activas = listas.filter((l) => /^activ/i.test(l.estado))
  if (activas.length === 1) return { lista: activas[0] }
  if (!activas.length) return { error: "No hay ninguna lista activa en Zomatik. Revisar las listas en Zomatik." }
  const re = new RegExp(`\\b${clave.replace(" ", "\\s+")}\\b`, "i")
  const delTipo = activas.filter((l) => re.test(l.nombre))
  if (delTipo.length === 1) return { lista: delTipo[0] }
  if (!delTipo.length) return { error: `Hay ${activas.length} listas activas y ninguna "${clave}" en Zomatik (${activas.map((l) => l.codigo).join(", ")}). Revisar las listas en Zomatik.` }
  return { error: `Hay ${delTipo.length} listas activas "${clave}" en Zomatik (${delTipo.map((l) => l.codigo).join(", ")}). Revisar las listas en Zomatik.` }
}

// ── Detalle de la NP (lo que devuelve manage_pedidos.php y lo que muestra la NP abierta) ──

export type Renglon = {
  /** Lo que sigue al nombre de cada campo (codigo<sufijo>, cantidad<sufijo>…): el id del renglón en Zomatik. */
  sufijo: string
  /** Valor de `codigo<sufijo>`: el id del RENGLÓN (5349423), no el del artículo. Es lo que va en `fparam`. */
  codigo: string
  costo: string
  cantidad: string
  observaciones: string
  /** Id para el tacho (`verificar(id)` → `fborrar=id`). */
  borrar: string | null
  /** Código visible del artículo (1.ª celda: 10090020 = `zomatik_articulos.codigo`). */
  codigoArticulo: string
  /** Nombre del artículo (2.ª celda: "H21-620-10 C (CAN)"). */
  nombreArticulo: string
  /** Texto del renglón. */
  articulo: string
  /** TODOS los campos del renglón (codigo, peso, hcosto, costo, apallet, palletcant, cantidad, coeficiente,
   *  observacionesdetalle…), en el orden de la página, como los manda el formulario al grabar. */
  campos: CampoForm[]
}

/** Filas sin otras filas adentro (el layout de Zomatik anida tablas). */
const filasInternas = (html: string) => sinComentarios(html).match(/<tr\b(?:(?!<tr\b)[\s\S])*?<\/tr>/gi) || []

/** Campos de una fila (inputs y textareas con nombre; sin botones ni imágenes). */
function camposDe(html: string): CampoForm[] {
  const out: CampoForm[] = []
  for (const m of html.matchAll(/<input\b[^>]*>|<textarea\b[^>]*>[\s\S]*?<\/textarea>/gi)) {
    const t = m[0]
    const esArea = /^<textarea/i.test(t)
    const nombre = atributo(esArea ? (t.match(/<textarea[^>]*>/i) || [""])[0] : t, "name")
    if (!nombre) continue
    if (!esArea && ["submit", "button", "image", "reset", "file"].includes((atributo(t, "type") || "text").toLowerCase())) continue
    out.push({ nombre, valor: esArea ? decodificar(t.replace(/^<textarea[^>]*>/i, "").replace(/<\/textarea>$/i, "")) : decodificar(atributo(t, "value") ?? "") })
  }
  return out
}

const esRenglonFila = (tr: string) => /name\s*=\s*["']?codigo\d+/i.test(tr) && /name\s*=\s*["']?cantidad\d+/i.test(tr)

/**
 * Renglones del detalle (respuesta real de manage_pedidos.php del 28/10, lib/__fixtures__/zomatik-np): una fila por
 * renglón con `codigo<id>` (hidden, = id del renglón), `costo<id>`, `cantidad<id>`, `observacionesdetalle<id>` y otros;
 * 1.ª celda el código visible del artículo, 2.ª el nombre.
 */
export function renglonesDetalle(html: string): Renglon[] {
  const out: Renglon[] = []
  for (const tr of filasInternas(html)) {
    if (!esRenglonFila(tr)) continue
    const campos = camposDe(tr)
    const valor = (pref: string) => campos.find((c) => new RegExp(`^${pref}\\d+$`, "i").test(c.nombre))
    const cod = valor("codigo")
    if (!cod) continue
    const sufijo = cod.nombre.slice("codigo".length)
    const celdas = tr.match(/<td\b[^>]*>[\s\S]*?<\/td>/gi) || []
    const sinCampos = (c: string) => texto(c.replace(/<input\b[^>]*>|<textarea\b[\s\S]*?<\/textarea>|<a\b[\s\S]*?<\/a>/gi, " "))
    out.push({
      sufijo,
      codigo: cod.valor,
      costo: valor("costo")?.valor ?? "",
      cantidad: valor("cantidad")?.valor ?? "",
      observaciones: valor("observacionesdetalle")?.valor ?? "",
      borrar: tr.match(/verificar\(\s*['"]?(\d+)['"]?\s*\)/i)?.[1] || null,
      codigoArticulo: celdas[0] ? sinCampos(celdas[0]) : "",
      nombreArticulo: celdas[1] ? sinCampos(celdas[1]) : "",
      articulo: sinCampos(tr),
      campos,
    })
  }
  return out
}

/** Campos del detalle que no son de ningún renglón (credito, compraactual, compraactualsib, totalacopio…): el formulario
 *  los manda igual al grabar. */
export function camposSueltosDetalle(html: string): CampoForm[] {
  let resto = sinComentarios(html)
  for (const tr of filasInternas(resto)) if (esRenglonFila(tr)) resto = resto.replace(tr, " ")
  return camposDe(resto)
}

/** ¿Este renglón es el del artículo pedido? Por el código visible (zomatik_articulos.codigo) o por el nombre. Nunca por
 *  `codigo<sufijo>`, que es el id del renglón. */
export function esRenglonDe(r: Renglon, art: { codigo?: number | string | null; nombre?: string | null }): boolean {
  if (art.codigo && r.codigoArticulo.replace(/\D/g, "") === String(art.codigo)) return true
  return !!art.nombre && plano(r.nombreArticulo) === plano(art.nombre)
}

/** Recorte de una respuesta de Zomatik para guardar en Actividad (sin scripts, sin espacios de más, ~2 KB). */
export function recorte(html: string, max = 2000): string {
  return sinComentarios(String(html ?? "")).replace(/<script\b[\s\S]*?<\/script>/gi, "").replace(/\s+/g, " ").trim().slice(0, max)
}

/**
 * `fparam` como lo arma GrabarDatosDetalle() del formulario (leído del JavaScript de modificar_pedidos.php, guardado el
 * 20/10): recorre los campos y por renglón junta el valor de `codigo<id>` (el id del RENGLÓN), `costo<id>` y
 * `cantidad<id>`, más la observación: "codigo,costo,cantidad,observación|||".
 */
export function fparamDe(renglones: Renglon[]): string {
  return renglones.map((r) => `${r.codigo},${r.costo},${r.cantidad},${r.observaciones}|||`).join("")
}

/** Cantidad con punto y hasta 3 decimales ("7.5"), como la toma el formulario. */
export function cantidadTexto(m3: number): string {
  return String(Math.round(Number(m3) * 1000) / 1000)
}

/** Cambia la cantidad de un renglón (en el renglón y en sus campos). */
export function conCantidad(r: Renglon, m3: number): Renglon {
  const c = cantidadTexto(m3)
  return { ...r, cantidad: c, campos: r.campos.map((x) => (x.nombre.toLowerCase().startsWith("cantidad") ? { ...x, valor: c } : x)) }
}

/** "823,4" / "823.4" / "1.234,5" → número. */
export function numeroZomatik(s: unknown): number | null {
  let t = String(s ?? "").replace(/[^\d.,-]/g, "")
  if (!t) return null
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".")
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

// ── Listado de pedidos (HTML) ──

export type FilaPedido = { codigo: number; numero: string; fecha: string | null; cliente: string; estado: string }

export function pedidosDeListado(html: string): FilaPedido[] {
  const out: FilaPedido[] = []
  const vistos = new Set<number>()
  for (const tr of filasInternas(html)) {
    const m = tr.match(/modificar_pedidos\.php\?codigo=(\d+)/i)
    if (!m) continue
    const codigo = Number(m[1])
    if (vistos.has(codigo)) continue
    const celdas = (tr.match(/<td\b[^>]*>[\s\S]*?<\/td>/gi) || []).map(texto)
    const numero = celdas.find((c) => /^NP2?\s+\d{4}-\d{8}$/i.test(c))
    if (!numero) continue
    vistos.add(codigo)
    const fecha = celdas.find((c) => /^\d{4}-\d{2}-\d{2}$/.test(c)) || null
    const iNum = celdas.indexOf(numero)
    const cliente = celdas.slice(iNum + 1).find((c) => c && !/^\$/.test(c)) || ""
    const estado = [...celdas].reverse().find((c) => /^(PEN|REM|PEND|PENDIENTE|REMITIDA|ANU|ANULADA|FAC)$/i.test(c)) || ""
    out.push({ codigo, numero: numero.toUpperCase().replace(/\s+/g, " "), fecha, cliente, estado: estado.toUpperCase() })
  }
  return out
}

/** "Pagina 1 de 10" al pie del listado → 10 (null si no lo dice: una sola página). */
export function paginasDeListado(html: string): number | null {
  const m = texto(sinComentarios(html)).match(/P[aá]gina\s+\d+\s+de\s+(\d+)/i)
  return m ? Number(m[1]) : null
}

/** Tamaño de página del listado de pedidos (el 20/10 se vieron ~300 filas en "Pagina 1 de 10"). */
export const FILAS_POR_PAGINA = 300

/**
 * ¿Hay señales de que el listado sigue en otra página? Link "Siguiente", un parámetro `pagina=` o tantas filas como
 * una página entera. Con cualquiera, la búsqueda por la marca no es concluyente.
 */
export function hayPaginado(html: string): boolean {
  const h = sinComentarios(html)
  if (/[?&]pagina=\d+/i.test(h)) return true
  if (/>\s*Siguiente\b/i.test(h)) return true
  return pedidosDeListado(h).length >= FILAS_POR_PAGINA
}

// ---------------------------------------------------------------------------
// ISO-8859-1
// ---------------------------------------------------------------------------

/** Bytes latin1 de un texto (lo que no entra en latin1 pasa a "?"). */
export function bytesLatin1(s: string): Uint8Array {
  const t = String(s ?? "")
  const out = new Uint8Array(t.length)
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i)
    out[i] = c < 256 ? c : 63
  }
  return out
}

/** encodeURIComponent pero en latin1 ("·" → %B7), como lo manda el navegador en una página ISO-8859-1. */
export function encodeLatin1(s: string): string {
  let out = ""
  for (const b of bytesLatin1(s)) {
    const ch = String.fromCharCode(b)
    out += /[A-Za-z0-9\-_.!~*'()]/.test(ch) ? ch : `%${b.toString(16).toUpperCase().padStart(2, "0")}`
  }
  return out
}

export function queryLatin1(params: [string, string | number][]): string {
  return params.map(([k, v]) => `${encodeLatin1(k)}=${encodeLatin1(String(v))}`).join("&")
}

/** Cuerpo multipart/form-data en latin1 (Grabar del formulario de la NP). */
export function multipartLatin1(campos: CampoForm[], boundary: string): { cuerpo: Uint8Array; tipo: string } {
  const partes: string[] = []
  for (const c of campos) partes.push(`--${boundary}\r\nContent-Disposition: form-data; name="${c.nombre.replace(/"/g, "")}"\r\n\r\n${c.valor}\r\n`)
  partes.push(`--${boundary}--\r\n`)
  return { cuerpo: bytesLatin1(partes.join("")), tipo: `multipart/form-data; boundary=${boundary}` }
}

/** Reemplaza (o agrega) valores en una lista de campos, respetando el orden. */
export function conValores(orden: CampoForm[], valores: Record<string, string>): CampoForm[] {
  const vistos = new Set<string>()
  const out = orden.map((c) => {
    if (c.nombre in valores && !vistos.has(c.nombre)) {
      vistos.add(c.nombre)
      return { nombre: c.nombre, valor: valores[c.nombre] }
    }
    return c
  })
  for (const [k, v] of Object.entries(valores)) if (!vistos.has(k) && !orden.some((c) => c.nombre === k)) out.push({ nombre: k, valor: v })
  return out
}

// ---------------------------------------------------------------------------
// Saldo de una NP (Z2b, respuestas del 23/10): una NP puede servir a varios pedidos
// ---------------------------------------------------------------------------

const r3 = (n: number) => Math.round(Number(n) * 1000) / 1000
const TOL = 0.001

/** Un pedido que usa una NP (`zomatik_np_uso`) con lo que hace falta para calcular el saldo. */
export type UsoSaldo = {
  id: string
  np_id: string
  m3: number
  activo: boolean
  created_at: string
  /** Foto al desvincular: lo despachado contra esta NP hasta ese momento. */
  despachado_fijo?: number | null
  pedido: { id: string; status: string; dispatched_m3: number | null } | null
}

const pedidoActivo = (st: string | null | undefined) => !!st && st !== "cancelled" && st !== "completed"

/**
 * Lo despachado de un pedido que le corresponde a cada uso (misma cuenta que `zomatik_np_uso_despachado` en la base):
 * un uso desactivado se queda con su foto (`despachado_fijo`); el resto se reparte entre los usos ACTIVOS del pedido en
 * el orden en que se crearon, y el último se lleva lo que sobre.
 */
export function despachadoPorUso(usosDelPedido: { id: string; m3: number; created_at: string; activo?: boolean; despachado_fijo?: number | null }[], despachado: number): Map<string, number> {
  const out = new Map<string, number>()
  const inactivos = usosDelPedido.filter((u) => u.activo === false)
  for (const u of inactivos) out.set(u.id, r3(Number(u.despachado_fijo) || 0))
  let queda = Math.max(0, r3((Number(despachado) || 0) - inactivos.reduce((s, u) => s + (Number(u.despachado_fijo) || 0), 0)))
  const orden = usosDelPedido.filter((u) => u.activo !== false).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
  orden.forEach((u, i) => {
    const toma = i === orden.length - 1 ? queda : Math.min(queda, Number(u.m3) || 0)
    out.set(u.id, r3(toma))
    queda = r3(queda - toma)
  })
  return out
}

/**
 * Cuánto de la NP compromete un uso: activo de un pedido activo, lo que reserva (o lo despachado, si es más);
 * desactivado o de un pedido borrado, su foto; de un pedido cerrado, lo despachado contra ella.
 */
export function comprometidoUso(u: UsoSaldo, despachadoContra: number): number {
  if (!u.activo || !u.pedido) return Number(u.despachado_fijo) || 0
  if (pedidoActivo(u.pedido.status)) return Math.max(Number(u.m3) || 0, despachadoContra)
  return Math.min(Number(u.m3) || 0, despachadoContra)
}

export type SaldoNp = { libre: number; comprometido: number; conPedidoActivo: boolean }

/**
 * Saldo de una NP: m³ de la NP − lo comprometido por sus usos. `usosDePedidos` = TODOS los usos de los pedidos que
 * tocan esta NP (para repartir lo despachado de cada pedido entre sus NP).
 */
export function saldoNp(np: { id: string; m3: number }, usosDePedidos: UsoSaldo[]): SaldoNp {
  const porPedido = new Map<string, UsoSaldo[]>()
  for (const u of usosDePedidos) if (u.pedido) porPedido.set(u.pedido.id, [...(porPedido.get(u.pedido.id) || []), u])
  let comprometido = 0
  let conPedidoActivo = false
  for (const u of usosDePedidos.filter((x) => x.np_id === np.id)) {
    const desp = u.pedido ? despachadoPorUso(porPedido.get(u.pedido.id) || [u], Number(u.pedido.dispatched_m3) || 0).get(u.id) || 0 : 0
    comprometido += comprometidoUso(u, desp)
    if (u.activo && u.pedido && pedidoActivo(u.pedido.status)) conPedidoActivo = true
  }
  return { libre: r3(Number(np.m3) - comprometido), comprometido: r3(comprometido), conPedidoActivo }
}

/** ¿Va a la lista "NP con saldo" de Programación? En Zomatik, con saldo y sin pedido activo que la use. */
/** Sin vencimiento: queda en la lista hasta Reprogramar (vuelve a tener pedido activo) o Devolver (cerrada). */
export function npConSaldo(np: { estado: string; saldo_decision?: string | null }, s: SaldoNp): boolean {
  return np.estado === "ok" && s.libre > TOL && !s.conPedidoActivo && np.saldo_decision !== "cerrada"
}

// ---------------------------------------------------------------------------
// Planificación: qué NP necesita un pedido
// ---------------------------------------------------------------------------

export type PedidoNp = {
  id: string
  status: string
  quantity_m3: number
  plant_id: string
  client_id: string
  formula_id: string
  /** Día del pedido (aaaa-mm-dd, hora de Argentina). */
  fecha: string
  /** "saldo" = usar una NP con saldo (Reprogramar). */
  np_tipo?: TipoNp | "saldo" | null
  proyecto_codigo?: number | null
  /** Si está, solo esto va contra el proyecto y el resto en una NP nueva (20.4, opción 2). */
  proyecto_tope_m3?: number | null
  /** La NP con saldo elegida y cuánto le queda libre (si es del mismo cliente y artículo; si no, null). */
  saldo_np?: { id: string; libre: number } | null
  /** Cambió la fecha del pedido: true = mover la NP a la nueva fecha; false = dejarla (queda con saldo); null = no se preguntó. */
  mover_fecha?: boolean | null
}

export type FilaNp = {
  id: string
  n: number
  estado: EstadoNp
  /** Hasta dónde llegó el robot: con "grabar" (o después) puede estar en Zomatik aunque siga pendiente. */
  paso?: string | null
  tipo: TipoNp
  m3: number
  numero?: string | null
  proyecto_codigo?: number | null
  formula_id?: string | null
  plant_id?: string | null
  client_id?: string | null
  fecha?: string | null
}

/** Un uso activo del pedido, con su NP y lo libre de la NP (ya descontado lo que reserva este uso). */
export type UsoPlan = { uso_id: string; m3: number; np: FilaNp; libre: number }

export type NuevaNp = { n: number; tipo: TipoNp; m3: number; proyecto_codigo: number | null; es_adicional: boolean }

/** Pasos después de los cuales una NP pendiente PUEDE haber quedado grabada (un corte en "Grabar"). */
export const PASOS_GRABADA = ["grabar", "verificar", "grabar_cortado", "buscar_marca"]
export const puedeEstarGrabada = (x: { paso?: string | null }) => PASOS_GRABADA.includes(x.paso || "")
/** No llegó a Zomatik seguro: se puede rehacer o anular sin tocar nada allá. */
const sinGrabarSeguro = (x: FilaNp) => SIN_GRABAR.includes(x.estado) && !puedeEstarGrabada(x)

export type PlanNp = {
  /** NP nuevas (cada una con su uso por esos m³). */
  crear: NuevaNp[]
  /** Usar parte de una NP con saldo (Reprogramar / "Usar NP con saldo"). */
  usar: { np_id: string; m3: number }[]
  /** Cambiar los m³ que el pedido reserva de una NP (crece hasta su saldo, o se achica: el resto queda de saldo). */
  ajustar: { uso_id: string; m3: number }[]
  /** El pedido deja de usar la NP (cambió fórmula, cliente, planta o fecha): la NP queda "con saldo: pendiente". */
  desvincular: { uso_id: string; motivo: string }[]
  /** Mover la NP a la nueva fecha del pedido (en nuestro sistema). */
  mover_fecha: string[]
  /** NP que nunca llegaron a Zomatik y ya no hacen falta. */
  anular: string[]
  /** Pedido cancelado con una NP que se cortó al grabar: puede estar en Zomatik, la mira un gerencial. */
  revisar: string[]
  avisos: string[]
}

export const planVacio = (): PlanNp => ({ crear: [], usar: [], ajustar: [], desvincular: [], mover_fecha: [], anular: [], revisar: [], avisos: [] })

/** Reparte m³ entre el proyecto (hasta el tope) y una NP nueva. */
function repartir(m3: number, tipo: TipoNp, proyecto: number | null, tope: number | null, yaContraProyecto: number): { tipo: TipoNp; m3: number; proyecto_codigo: number | null }[] {
  if (tipo !== "proyecto" || !proyecto) return [{ tipo: "nueva", m3: r3(m3), proyecto_codigo: null }]
  if (tope === null || tope === undefined) return [{ tipo: "proyecto", m3: r3(m3), proyecto_codigo: proyecto }]
  const lugar = Math.max(0, r3(tope - yaContraProyecto))
  const contra = Math.min(lugar, m3)
  const out: { tipo: TipoNp; m3: number; proyecto_codigo: number | null }[] = []
  if (contra > TOL) out.push({ tipo: "proyecto", m3: r3(contra), proyecto_codigo: proyecto })
  if (m3 - contra > TOL) out.push({ tipo: "nueva", m3: r3(m3 - contra), proyecto_codigo: null })
  return out
}

const nombreNp = (x: FilaNp) => x.numero || `La NP ${x.n}`

/**
 * Qué hacer con las NP de un pedido (respuestas de Bautista del 23/10, sección 25):
 *   - cancelado: las que no llegaron a Zomatik se anulan; las grabadas NO se tocan: quedan "NP con saldo: pendiente" en
 *     Programación, sin vencimiento, hasta que alguien toque Reprogramar o Devolver el saldo (precisión del 23/10).
 *   - cambió la fórmula, el cliente o la planta de una NP grabada: el pedido deja de usarla (queda con saldo) y se genera
 *     una nueva. Cambió la fecha: si se eligió mover, se mueve; si no, se desvincula; sin respuesta, solo aviso.
 *   - lo que todavía no llegó a Zomatik se rehace con los datos de ahora.
 *   - se agrandó: primero crece lo que reserva de sus NP (hasta su saldo), después la NP con saldo elegida, y por el
 *     resto, NP adicional (20.1.5). Se achicó: reserva menos; lo que sobra queda de saldo (al finalizar, devolución).
 *   - completo: nada (el remito, el cierre y la devolución son Z1).
 */
export function planificarNp(p: PedidoNp, usos: UsoPlan[], nMax = 0): PlanNp {
  const plan = planVacio()
  let n = Math.max(nMax, ...usos.map((u) => u.np.n || 0), 0)
  const vivos = usos.filter((u) => VIGENTES.includes(u.np.estado))
  if (p.status === "cancelled") {
    for (const u of vivos) {
      const x = u.np
      if (sinGrabarSeguro(x)) plan.anular.push(x.id)
      else if (SIN_GRABAR.includes(x.estado)) plan.revisar.push(x.id)
      else if (x.estado === "ok") plan.avisos.push(`${nombreNp(x)} queda pendiente en Programación (NP con saldo), hasta que se reprograme o se devuelva.`)
      else if (x.estado === "generando") plan.avisos.push(`${nombreNp(x)} se está generando: cuando termine queda pendiente en Programación.`)
    }
    return plan
  }
  if (p.status === "completed") return plan

  const usaSaldo = p.np_tipo === "saldo"
  const tipo: TipoNp = p.np_tipo === "proyecto" && p.proyecto_codigo ? "proyecto" : "nueva"
  const proyecto = tipo === "proyecto" ? Number(p.proyecto_codigo) : null
  const tope = tipo === "proyecto" && p.proyecto_tope_m3 !== null && p.proyecto_tope_m3 !== undefined ? Number(p.proyecto_tope_m3) : null
  const m3 = r3(Number(p.quantity_m3) || 0)

  // 1. Las grabadas: ¿siguen sirviendo para este pedido?
  const quedan: UsoPlan[] = []
  const pendientes: UsoPlan[] = []
  for (const u of vivos) {
    const x = u.np
    if (sinGrabarSeguro(x)) {
      pendientes.push(u)
      continue
    }
    const dif: string[] = []
    if (x.formula_id && x.formula_id !== p.formula_id) dif.push("fórmula")
    if (x.client_id && x.client_id !== p.client_id) dif.push("cliente")
    if (x.plant_id && x.plant_id !== p.plant_id) dif.push("planta")
    if (dif.length) {
      plan.desvincular.push({ uso_id: u.uso_id, motivo: `el pedido cambió de ${dif.join(", ")}` })
      plan.avisos.push(`${nombreNp(x)} no se toca: queda pendiente con su saldo (el pedido cambió de ${dif.join(", ")}). Se genera una NP nueva.`)
      continue
    }
    if (x.fecha && x.fecha !== p.fecha) {
      if (p.mover_fecha === true) plan.mover_fecha.push(x.id)
      else if (p.mover_fecha === false) {
        plan.desvincular.push({ uso_id: u.uso_id, motivo: "el pedido cambió de fecha y la NP no se movió" })
        plan.avisos.push(`${nombreNp(x)} queda en su fecha, pendiente con su saldo. Se genera una NP nueva para el pedido.`)
        continue
      } else plan.avisos.push(`El pedido cambió de fecha: falta decidir si se mueve ${nombreNp(x)}.`)
    }
    quedan.push(u)
  }

  // 2. Lo que todavía no llegó a Zomatik: se deja si es justo lo que hace falta; si no, se rehace
  const cubierto = r3(quedan.reduce((s, u) => s + Number(u.m3 || 0), 0))
  if (pendientes.length) {
    const falta = r3(m3 - cubierto)
    const quiere = falta > TOL && !usaSaldo ? repartir(falta, tipo, proyecto, tope, 0) : []
    const igual =
      !quedan.length &&
      quiere.length === pendientes.length &&
      quiere.every((q, i) => {
        const v = pendientes[i].np
        return v.tipo === q.tipo && Math.abs(Number(pendientes[i].m3) - q.m3) <= TOL && (v.proyecto_codigo ?? null) === q.proyecto_codigo &&
          (v.formula_id ?? p.formula_id) === p.formula_id && (v.plant_id ?? p.plant_id) === p.plant_id && (v.client_id ?? p.client_id) === p.client_id && (v.fecha ?? p.fecha) === p.fecha
      })
    if (igual) return plan
    plan.anular.push(...pendientes.map((u) => u.np.id))
  }

  // 3. Cobertura
  let total = cubierto
  if (m3 > total + TOL) {
    let falta = r3(m3 - total)
    // a) crecer lo que reserva de sus NP, hasta lo libre de cada una
    for (const u of quedan) {
      if (falta <= TOL) break
      const crece = Math.min(falta, Math.max(0, Number(u.libre) || 0))
      if (crece > TOL) {
        plan.ajustar.push({ uso_id: u.uso_id, m3: r3(Number(u.m3) + crece) })
        falta = r3(falta - crece)
      }
    }
    // b) la NP con saldo elegida (Reprogramar)
    if (falta > TOL && usaSaldo && p.saldo_np && !quedan.some((u) => u.np.id === p.saldo_np!.id)) {
      const toma = Math.min(falta, Math.max(0, p.saldo_np.libre))
      if (toma > TOL) {
        plan.usar.push({ np_id: p.saldo_np.id, m3: r3(toma) })
        falta = r3(falta - toma)
      }
    }
    // c) el resto, NP nueva (adicional si el pedido ya tenía alguna)
    if (falta > TOL) {
      const contraProyecto = quedan.filter((u) => u.np.tipo === "proyecto").reduce((s, u) => s + Number(u.m3 || 0), 0)
      const adicional = quedan.length > 0 || plan.usar.length > 0
      for (const q of repartir(falta, tipo, proyecto, tope, contraProyecto)) plan.crear.push({ n: ++n, ...q, es_adicional: adicional })
    }
  } else if (m3 < total - TOL) {
    // Se achicó: reserva menos (de la última NP para atrás); lo que sobra queda de saldo en la NP
    let sobra = r3(total - m3)
    for (const u of [...quedan].reverse()) {
      if (sobra <= TOL) break
      const baja = Math.min(sobra, Number(u.m3) || 0)
      plan.ajustar.push({ uso_id: u.uso_id, m3: r3(Number(u.m3) - baja) })
      sobra = r3(sobra - baja)
    }
    plan.avisos.push(`El pedido bajó a ${cantidadTexto(m3)} m³: sobran ${cantidadTexto(r3(total - m3))} m³ en la NP. Quedan de saldo (al finalizar se devuelven o se reprograman).`)
    total = m3
  }
  return plan
}

// ---------------------------------------------------------------------------
// Control del despacho
// ---------------------------------------------------------------------------

/** La llave y el modo de una planta (vienen de `zomatik_np_config`: activo, desde, exigir_np, aviso_hasta). */
export type PlantaNp = { zomatik_np_activo?: boolean | null; exigir_np?: string | null; aviso_hasta?: string | null; zomatik_np_desde?: string | null }
export type ModoNp = "apagado" | "aviso" | "duro"

/**
 * Llave apagada: no hay control (la NP se carga a mano, como hoy). Prendida: modo aviso hasta `aviso_hasta`
 * (2 semanas desde que Bautista la prende, 20.7) y después duro. `exigir_np = 'duro'` lo adelanta.
 */
export function modoNp(planta: PlantaNp | null | undefined, hoy: string): ModoNp {
  if (!planta?.zomatik_np_activo) return "apagado"
  if (planta.exigir_np === "duro") return "duro"
  if (planta.aviso_hasta && hoy > planta.aviso_hasta) return "duro"
  return "aviso"
}

/** ¿El pedido entra en el control? Solo los cargados después de prender la llave (los de antes tienen la NP a mano). */
export function pedidoConNp(planta: PlantaNp | null | undefined, pedidoCreadoAt: string | null | undefined): boolean {
  if (!planta?.zomatik_np_activo) return false
  if (!planta.zomatik_np_desde) return true
  return !!pedidoCreadoAt && pedidoCreadoAt >= planta.zomatik_np_desde
}

export type ControlDespacho = { bloquea: boolean; aviso: string | null }

/** Lo que ve el despacho de un pedido. Igual que el trigger de la base (`zomatik_np_control_despacho`). */
export function controlDespacho(o: { modo: ModoNp; entra: boolean; nps: { estado: EstadoNp }[]; excepcion: boolean }): ControlDespacho {
  if (o.modo === "apagado" || !o.entra) return { bloquea: false, aviso: null }
  if (o.nps.some((x) => x.estado === "ok")) return { bloquea: false, aviso: null }
  if (o.excepcion) return { bloquea: false, aviso: "Sin NP: despacho autorizado por un gerencial" }
  return { bloquea: o.modo === "duro", aviso: "NP pendiente: avisale a Programación" }
}

// ---------------------------------------------------------------------------
// Robot: qué trabajar y cuánto tiempo queda
// ---------------------------------------------------------------------------

/**
 * ¿Hay que trabajar esta NP ahora? Pendientes y "vaciar" cuyo reintento llegó (sin fecha = no se reintenta sola: llave
 * apagada o falta un dato), y las "generando"/"vaciando" colgadas más de 3 min (un corte). Con el botón (`manual`),
 * todas las del pedido, también las de error.
 */
export function trabajoPendiente(x: { estado: string; proximo_intento?: string | null; en_curso_desde?: string | null }, ahora: number, manual: boolean): boolean {
  if (x.estado === "generando" || x.estado === "vaciando") return !!x.en_curso_desde && ahora - Date.parse(x.en_curso_desde) > MIN_CORTADA * 60_000
  if (manual) return ["pendiente", "error", "vaciar"].includes(x.estado)
  if (x.estado !== "pendiente" && x.estado !== "vaciar") return false
  return !!x.proximo_intento && Date.parse(x.proximo_intento) <= ahora
}

/** ¿Alcanza el tiempo para arrancar otra NP? (`total` útil de la función desde que empezó el request). */
export function quedaTiempo(inicio: number, ahora: number, total = 55_000, minimo = 30_000): boolean {
  return total - (ahora - inicio) >= minimo
}

/**
 * Lo que hace el trigger del despacho (`zomatik_np_control_despacho`, migración 202610222200), para probarlo:
 * pasa (sin anotar), pasa y anota en Actividad, o frena.
 */
export function decisionTrigger(o: {
  llave: boolean; manual: boolean; pedidoAntesDeLaLlave: boolean; tieneOk: boolean; prueba: boolean; excepcion: boolean; modo: "aviso" | "duro"
}): "pasa" | "anota" | "frena" {
  if (!o.llave) return "pasa"
  if (o.manual) return "anota"
  if (o.pedidoAntesDeLaLlave || o.tieneOk) return "pasa"
  if (o.prueba || o.excepcion) return "anota"
  return o.modo === "duro" ? "frena" : "anota"
}

/** Hoy en Argentina (aaaa-mm-dd). */
export function hoyAR(ahora: number = Date.now()): string {
  return new Date(ahora - 3 * 3600_000).toISOString().slice(0, 10)
}

/** Día de un timestamp en Argentina. */
export function diaAR(iso: string): string {
  return hoyAR(new Date(iso).getTime())
}
