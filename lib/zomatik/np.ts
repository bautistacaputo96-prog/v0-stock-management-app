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

/** "Sistema Rebucret · pedido 1a2b3c4d · NP 1" — única por NP (n = 1 la primera, 2… las adicionales). */
export function marcaNp(pedidoId: string, n: number): string {
  return `Sistema Rebucret · pedido ${String(pedidoId).replace(/-/g, "").slice(0, 8)} · NP ${n}`
}

const plano = (s: unknown) =>
  String(s ?? "")
    .replace(/\u00c2(?=\u00b7)/g, "") // "Â·": el "·" guardado en UTF-8 y leído en latin1
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
 * La lista que corresponde (20.2): la activa "en 1" para la NP o "en 2" para la NP2. Tiene que haber UNA sola activa
 * de ese tipo: si hay cero o varias, no se genera ("Revisar las listas en Zomatik").
 */
export function listaActiva(listas: Lista[], comprobante: "15" | "16"): { lista: Lista } | { error: string } {
  const clave = LISTA_DE[comprobante]
  const re = new RegExp(`\\b${clave.replace(" ", "\\s+")}\\b`, "i")
  const activas = listas.filter((l) => /^activ/i.test(l.estado) && re.test(l.nombre))
  if (activas.length === 1) return { lista: activas[0] }
  if (!activas.length) return { error: `No hay ninguna lista activa "${clave}" en Zomatik. Revisar las listas en Zomatik.` }
  return { error: `Hay ${activas.length} listas activas "${clave}" en Zomatik (${activas.map((l) => l.codigo).join(", ")}). Revisar las listas en Zomatik.` }
}

// ── Detalle de la NP (lo que devuelve manage_pedidos.php y lo que muestra la NP abierta) ──

export type Renglon = {
  /** Lo que sigue al nombre de cada campo (codigo<sufijo>, cantidad<sufijo>…). */
  sufijo: string
  codigo: string
  costo: string
  cantidad: string
  observaciones: string
  /** Id para el tacho (`verificar(id)` → `fborrar=id`). */
  borrar: string | null
  /** Texto del renglón (el nombre del artículo). */
  articulo: string
  /** Todos los campos del renglón, como los manda el formulario. */
  campos: CampoForm[]
}

/** Filas sin otras filas adentro (el layout de Zomatik anida tablas). */
const filasInternas = (html: string) => sinComentarios(html).match(/<tr\b(?:(?!<tr\b)[\s\S])*?<\/tr>/gi) || []

const PREFIJOS_RENGLON = ["observacionesdetalle", "codigo", "costo", "cantidad"] as const

/** Renglones del detalle: una fila con inputs codigo… / costo… / cantidad… (y observacionesdetalle…). */
export function renglonesDetalle(html: string): Renglon[] {
  const out: Renglon[] = []
  for (const tr of filasInternas(html)) {
    const campos: CampoForm[] = []
    const r: Partial<Renglon> = {}
    for (const m of tr.matchAll(/<input\b[^>]*>|<textarea\b[^>]*>[\s\S]*?<\/textarea>/gi)) {
      const t = m[0]
      const esArea = /^<textarea/i.test(t)
      const nombre = atributo(esArea ? (t.match(/<textarea[^>]*>/i) || [""])[0] : t, "name")
      if (!nombre) continue
      const valor = esArea ? decodificar(t.replace(/^<textarea[^>]*>/i, "").replace(/<\/textarea>$/i, "")) : decodificar(atributo(t, "value") ?? "")
      const pref = PREFIJOS_RENGLON.find((p) => nombre.toLowerCase().startsWith(p) && nombre.length > p.length)
      if (!pref) continue
      campos.push({ nombre, valor })
      const suf = nombre.slice(pref.length)
      if (pref === "codigo") r.sufijo = suf
      if (pref === "observacionesdetalle") r.observaciones = valor
      else (r as any)[pref] = valor
    }
    if (r.sufijo === undefined || r.cantidad === undefined) continue
    const borrar = tr.match(/verificar\(\s*['"]?(\d+)['"]?\s*\)/i)?.[1] || null
    out.push({
      sufijo: r.sufijo,
      codigo: r.codigo ?? "",
      costo: r.costo ?? "",
      cantidad: r.cantidad ?? "",
      observaciones: r.observaciones ?? "",
      borrar,
      articulo: texto(tr.replace(/<input\b[^>]*>|<textarea\b[\s\S]*?<\/textarea>|<a\b[\s\S]*?<\/a>/gi, " ")),
      campos,
    })
  }
  return out
}

/** `fparam` como lo arma GrabarDatosDetalle(): "codigo,costo,cantidad,observación|||" por renglón. */
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
  np_tipo?: TipoNp | null
  proyecto_codigo?: number | null
  /** Si está, solo esto va contra el proyecto y el resto en una NP nueva (20.4, opción 2). */
  proyecto_tope_m3?: number | null
}

export type FilaNp = {
  id: string
  n: number
  estado: EstadoNp
  /** Hasta dónde llegó el robot: con "grabar" (o después) puede estar en Zomatik aunque siga pendiente. */
  paso?: string | null
  tipo: TipoNp
  m3: number
  proyecto_codigo?: number | null
  formula_id?: string | null
  plant_id?: string | null
  client_id?: string | null
  fecha?: string | null
}

export type NuevaNp = { n: number; tipo: TipoNp; m3: number; proyecto_codigo: number | null; es_adicional: boolean }

/** Pasos después de los cuales una NP pendiente PUEDE haber quedado grabada (un corte en "Grabar"). */
export const PASOS_GRABADA = ["grabar", "verificar", "grabar_cortado", "buscar_marca"]
export const puedeEstarGrabada = (x: { paso?: string | null }) => PASOS_GRABADA.includes(x.paso || "")
/** No llegó a Zomatik seguro: se puede rehacer o anular sin tocar nada allá. */
const sinGrabarSeguro = (x: FilaNp) => SIN_GRABAR.includes(x.estado) && !puedeEstarGrabada(x)

export type PlanNp = {
  crear: NuevaNp[]
  /** NP ya grabadas en Zomatik que hay que vaciar (pedido cancelado). */
  vaciar: string[]
  /** NP que nunca llegaron a Zomatik y ya no hacen falta. */
  anular: string[]
  /** Pedido cancelado con una NP que se cortó al grabar: puede estar en Zomatik, la mira un gerencial. */
  revisar: string[]
  avisos: string[]
}

const r3 = (n: number) => Math.round(Number(n) * 1000) / 1000
const TOL = 0.001

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

/**
 * Qué hacer con las NP de un pedido (decisiones del 22/10):
 *   - cancelado: vaciar las que ya están en Zomatik; anular las que no llegaron; las "generando"/"revisar" se avisan.
 *   - activo sin NP: una NP por los m³ del pedido (nueva o contra el proyecto; con tope, el resto en una NP nueva).
 *   - activo con NP que todavía no llegó a Zomatik (pendiente/error) y ninguna grabada: se rehace con los datos de ahora.
 *   - activo que se agrandó: NP adicional por la diferencia (20.1.5).
 *   - activo que se achicó: NO se toca (falta la decisión de Bautista): solo un aviso.
 *   - completo: nada (el remito y el cierre son Z3).
 */
export function planificarNp(p: PedidoNp, nps: FilaNp[]): PlanNp {
  const plan: PlanNp = { crear: [], vaciar: [], anular: [], revisar: [], avisos: [] }
  let n = nps.reduce((m, x) => Math.max(m, x.n || 0), 0)
  if (p.status === "cancelled") {
    for (const x of nps) {
      if (x.estado === "ok") plan.vaciar.push(x.id)
      else if (sinGrabarSeguro(x)) plan.anular.push(x.id)
      else if (SIN_GRABAR.includes(x.estado)) plan.revisar.push(x.id)
      else if (x.estado === "generando") plan.avisos.push(`La NP ${x.n} se está generando: cuando termine, se vacía.`)
      else if (x.estado === "revisar") plan.avisos.push(`La NP ${x.n} está para revisar: vaciala a mano en Zomatik si hace falta.`)
    }
    return plan
  }
  if (p.status === "completed") return plan

  const tipo: TipoNp = p.np_tipo === "proyecto" && p.proyecto_codigo ? "proyecto" : "nueva"
  const proyecto = tipo === "proyecto" ? Number(p.proyecto_codigo) : null
  const tope = tipo === "proyecto" && p.proyecto_tope_m3 !== null && p.proyecto_tope_m3 !== undefined ? Number(p.proyecto_tope_m3) : null
  const m3 = r3(Number(p.quantity_m3) || 0)
  let vigentes = nps.filter((x) => VIGENTES.includes(x.estado))
  const grabadas = vigentes.filter((x) => !sinGrabarSeguro(x))

  // Nada grabado todavía: lo pendiente se rehace con los datos de ahora (si cambió algo)
  if (!grabadas.length && vigentes.length) {
    const quiere = repartir(m3, tipo, proyecto, tope, 0)
    const igual =
      quiere.length === vigentes.length &&
      quiere.every((q, i) => {
        const v = vigentes[i]
        return v.tipo === q.tipo && Math.abs(Number(v.m3) - q.m3) <= TOL && (v.proyecto_codigo ?? null) === q.proyecto_codigo &&
          (v.formula_id ?? p.formula_id) === p.formula_id && (v.plant_id ?? p.plant_id) === p.plant_id && (v.client_id ?? p.client_id) === p.client_id && (v.fecha ?? p.fecha) === p.fecha
      })
    if (igual) return plan
    plan.anular.push(...vigentes.map((x) => x.id))
    vigentes = []
  }

  if (!vigentes.length) {
    if (m3 > TOL) for (const q of repartir(m3, tipo, proyecto, tope, 0)) plan.crear.push({ n: ++n, ...q, es_adicional: false })
    return plan
  }

  const total = r3(vigentes.reduce((s, x) => s + Number(x.m3 || 0), 0))
  for (const v of grabadas) {
    const dif: string[] = []
    if (v.formula_id && v.formula_id !== p.formula_id) dif.push("fórmula")
    if (v.plant_id && v.plant_id !== p.plant_id) dif.push("planta")
    if (v.client_id && v.client_id !== p.client_id) dif.push("cliente")
    if (v.fecha && v.fecha !== p.fecha) dif.push("fecha")
    if (dif.length) plan.avisos.push(`La NP ${v.n} se generó con otra ${dif.join(", ")}: revisala en Zomatik.`)
  }
  if (m3 > total + TOL) {
    const contraProyecto = vigentes.filter((x) => x.tipo === "proyecto").reduce((s, x) => s + Number(x.m3 || 0), 0)
    for (const q of repartir(r3(m3 - total), tipo, proyecto, tope, contraProyecto)) plan.crear.push({ n: ++n, ...q, es_adicional: true })
  } else if (m3 < total - TOL) {
    plan.avisos.push(`El pedido bajó a ${cantidadTexto(m3)} m³ y sus NP suman ${cantidadTexto(total)} m³: la NP no se achica sola (falta decidir cómo).`)
  }
  return plan
}

// ---------------------------------------------------------------------------
// Control del despacho
// ---------------------------------------------------------------------------

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
