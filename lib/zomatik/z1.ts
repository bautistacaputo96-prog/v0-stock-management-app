/**
 * Zomatik · Z1 · "Finalizar pedido" → OF + remito — funciones puras (sin red, sin base). Spec: zomatik.md, sección 26.
 * Se prueban con `npm run test:zomatik-z1`.
 *
 *   - Qué remitos lleva un pedido en un día: uno por NP que usó (17.1: uno por pedido y día, confirmado el 29/10), con
 *     los despachos de ese día que todavía no se remitieron, la patente del primer camión y todas en observaciones.
 *   - Número del remito (Bautista 29/10: "del anterior"): el más alto del talonario de Zomatik + 1 (RM 0001, RM2 0099).
 *   - Lectura de las páginas de la OF (alta y JavaScript capturados el 29/10; la lista, como el robot real de Concretus)
 *     y del remito (alta, Validarremito, manage_remitos y _validarnumeroremito capturados el 29/10).
 */
import { camposFormulario, numeroNormalizado, type CampoForm } from "@/lib/zomatik/np"

const r3 = (n: number) => Math.round(Number(n) * 1000) / 1000
const TOL = 0.001

// ---------------------------------------------------------------------------
// Marca, comprobantes y serie
// ---------------------------------------------------------------------------

const corto = (id: string) => String(id).replace(/-/g, "").slice(0, 8)

/**
 * "Sistema Rebucret - pedido 1a2b3c4d - 2026-10-29 - NP 1": va en las observaciones de la OF y del remito (ASCII).
 * `sufijo`: " - 2" para un segundo remito del mismo pedido, día y NP (despachos que llegaron después del primero).
 */
export function marcaZ1(pedidoId: string, fecha: string, npN: number, sufijo = ""): string {
  return `Sistema Rebucret - pedido ${corto(pedidoId)} - ${fecha} - NP ${npN}${sufijo}`
}

/** Despacho manual sin pedido (solo OF, 26.9): "Sistema Rebucret - despacho 1a2b3c4d - 2026-10-29". */
export function marcaOfSuelta(despachoId: string, fecha: string): string {
  return `Sistema Rebucret - despacho ${corto(despachoId)} - ${fecha}`
}


/** NP (15) → Remito RM (7) · NP2 (16) → Remito 2 RM2 (19). Del número de la NP ("NP2 0001-…"). */
export function comprobanteRemito(numeroNp: string | null | undefined): "7" | "19" | null {
  const t = String(numeroNp ?? "").trim().toUpperCase()
  if (/^NP2\s/.test(t)) return "19"
  if (/^NP\s/.test(t)) return "7"
  return null
}

export const PREFIJO_REMITO: Record<"7" | "19", "RM" | "RM2"> = { "7": "RM", "19": "RM2" }
/** El tipo del remito de papel que corresponde a cada comprobante (R con factura, X sin factura). */
export const TIPO_DE_COMPROBANTE: Record<"7" | "19", "R" | "X"> = { "7": "R", "19": "X" }

/** Punto de venta de cada remito (5.2 y captura del 29/10: RM 0001-…, RM2 0099-…). */
export const PUNTO_REMITO: Record<"7" | "19", string> = { "7": "0001", "19": "0099" }

/**
 * El número del remito (Bautista 29/10, "del anterior"): el MÁS ALTO del talonario del comprobante + 1 (no el más
 * reciente por fecha: en REBUCRET no son correlativos por fecha). `numeros`: los del listado ("RM2 0099-00002746" o
 * "0099-00002746"). Se valida con `_validarnumeroremito` justo antes de grabar.
 */
export function siguienteNumeroRemito(numeros: string[], comprobante: "7" | "19"): string | null {
  const punto = PUNTO_REMITO[comprobante]
  const pref = PREFIJO_REMITO[comprobante]
  let max = 0
  for (const s of numeros) {
    const t = String(s ?? "").trim().toUpperCase()
    const mPref = t.match(/^(RM2?)\s/)
    if (mPref && mPref[1] !== pref) continue
    const n = numeroNormalizado(t)
    if (!n || !n.startsWith(`${punto}-`)) continue
    max = Math.max(max, Number(n.slice(5)))
  }
  if (!max) return null // sin historia no se inventa un número
  return `${punto}-${String(max + 1).padStart(8, "0")}`
}

// ---------------------------------------------------------------------------
// Qué remitos lleva un pedido en un día
// ---------------------------------------------------------------------------

export type DespachoZ1 = {
  id: string
  m3: number
  /** Número del remito de papel */
  remito: string | null
  remito_tipo: "R" | "X" | null
  patente: string | null
  formula_id: string | null
  plant_id: string | null
  created_at: string
}

/** Una NP que usa el pedido (en el orden de sus usos), con lo que reserva. */
export type NpZ1 = { np_id: string; n: number; estado: string; numero: string | null; zomatik_codigo: number | null; formula_id: string | null; plant_id: string | null; m3_uso: number }

export type RemitoPlan = {
  np_id: string
  np_n: number
  comprobante: "7" | "19"
  m3: number
  despachos: { id: string; m3: number }[]
  patente: string | null
  patentes: string
  remitos_papel: string
}

export type PlanZ1 = { remitos: RemitoPlan[]; problemas: string[] }

/**
 * Los remitos de un pedido en un día (17.1, 26.2): uno por NP usada, con los despachos de ese día que todavía no están
 * en un remito. Cada despacho va entero a una NP (la primera, en el orden de los usos, en la que entra; si no entra en
 * ninguna, problema). Se frena (problema, sin remito) si: la NP no está en Zomatik, el despacho es de otra fórmula o
 * planta que la NP, o su R/X no coincide con la NP (R ↔ NP, X ↔ NP2).
 */
export function planificarRemitos(despachos: DespachoZ1[], nps: NpZ1[], yaRemitidos: Set<string>, remitidoPorNp: Map<string, number> = new Map()): PlanZ1 {
  const problemas: string[] = []
  const pendientes = [...despachos].filter((d) => !yaRemitidos.has(d.id) && Number(d.m3) > TOL).sort((a, b) => a.created_at.localeCompare(b.created_at))
  if (!pendientes.length) return { remitos: [], problemas }
  const usables = nps.filter((x) => x.estado === "ok" && comprobanteRemito(x.numero) && x.zomatik_codigo)
  if (!usables.length) return { remitos: [], problemas: ["El pedido no tiene una NP en Zomatik: no se puede remitir."] }
  // Lo que le queda a cada NP para este pedido: lo que reserva menos lo ya remitido contra ella (otros días o antes)
  const lugar = new Map(usables.map((x) => [x.np_id, r3((Number(x.m3_uso) || 0) - (remitidoPorNp.get(x.np_id) || 0))]))
  const porNp = new Map<string, DespachoZ1[]>()
  for (const d of pendientes) {
    const aptas = usables.filter((x) => {
      const comp = comprobanteRemito(x.numero)!
      return (!d.remito_tipo || TIPO_DE_COMPROBANTE[comp] === d.remito_tipo) && (!x.formula_id || !d.formula_id || x.formula_id === d.formula_id) && (!x.plant_id || !d.plant_id || x.plant_id === d.plant_id)
    })
    if (!aptas.length) {
      problemas.push(`El despacho ${d.remito || d.id.slice(0, 8)} (${r3(d.m3)} m³) no coincide con ninguna NP del pedido (R/X, fórmula o planta): revisalo.`)
      continue
    }
    const np = aptas.find((x) => (lugar.get(x.np_id) || 0) + TOL >= d.m3)
    if (!np) {
      problemas.push(`El despacho ${d.remito || d.id.slice(0, 8)} (${r3(d.m3)} m³) supera lo que le queda a la NP: generá una NP adicional antes de remitir.`)
      continue
    }
    lugar.set(np.np_id, r3((lugar.get(np.np_id) || 0) - d.m3))
    porNp.set(np.np_id, [...(porNp.get(np.np_id) || []), d])
  }
  const remitos: RemitoPlan[] = []
  for (const x of usables) {
    const ds = porNp.get(x.np_id)
    if (!ds?.length) continue
    const patentes = [...new Set(ds.map((d) => (d.patente || "").trim()).filter(Boolean))]
    remitos.push({
      np_id: x.np_id,
      np_n: x.n,
      comprobante: comprobanteRemito(x.numero)!,
      m3: r3(ds.reduce((s, d) => s + Number(d.m3), 0)),
      despachos: ds.map((d) => ({ id: d.id, m3: r3(d.m3) })),
      patente: patentes[0] || null,
      patentes: patentes.join(", "),
      remitos_papel: ds.map((d) => d.remito).filter(Boolean).join(", "),
    })
  }
  return { remitos, problemas }
}

/** Observaciones del remito: la marca, las patentes y los remitos de papel (17.1, 7.4). ASCII (sin "·"). */
export function observacionesRemito(marca: string, r: { patentes: string; remitos_papel: string }, obra: string | null): { observaciones: string; observacionesimp: string } {
  const obs = [marca, r.patentes ? `Camiones: ${r.patentes}` : "", r.remitos_papel ? `Remitos: ${r.remitos_papel}` : ""].filter(Boolean).join(" - ")
  const imp = [r.remitos_papel ? `Remitos ${r.remitos_papel}` : "", obra ? `Obra ${obra}` : ""].filter(Boolean).join(" - ")
  return { observaciones: obs, observacionesimp: imp }
}

// ---------------------------------------------------------------------------
// OF (como el robot real de Concretus, relevado en vivo el 22/10 en la sucursal 17)
// ---------------------------------------------------------------------------

/** Campos que el alta de OF tiene que traer (relevado el 22/10 en Concretus). Si falta alguno, no se graba. */
export const CAMPOS_OF = ["ordenfabricacion_unico", "ordenfabricacion", "fparam", "estado", "deposito", "fecha_entrega", "observaciones", "comprobante", "numero"] as const
export const COMPROBANTE_OF = "62"
/** Nombre de cada depósito de Rebucret en mayúsculas (el select del alta, 29/10: 116 "Canning", 113 "REBUCRET"). */
export const NOMBRE_DEPOSITO: Record<number, string> = { 116: "CANNING", 113: "REBUCRET" }

/** Formulario de alta de OF: action grabar_ordenfabricacion.php?codigo=0 y los campos de CAMPOS_OF. */
export function formularioOf(html: string) {
  const f = camposFormulario(html, /grabar_ordenfabricacion/i)
  if (!f) return null
  return f
}

/** ¿El select de depósitos del alta trae ese depósito? */
export function tieneDeposito(html: string, deposito: number | string): boolean {
  return new RegExp(`<option\\b[^>]*value\\s*=\\s*["']?${deposito}["'\\s>]`, "i").test(html)
}

/**
 * Lista temporal de la OF (manage_ordenfabricacion.php): pares codigoN / cantidadN (Concretus, 22/10). Falla cerrado
 * (null) sin inputs o con un codigoN sin su cantidadN.
 */
export function listaOf(html: string): { n: string; codigo: string; cantidad: string }[] | null {
  const codigos = new Map<string, string>()
  const cant = new Map<string, string>()
  for (const tag of String(html ?? "").match(/<input\b[^>]*>/gi) ?? []) {
    const nombre = tag.match(/name\s*=\s*["']?([^"'\s>]+)/i)?.[1] || ""
    const valor = (tag.match(/value\s*=\s*["']([^"']*)["']/i)?.[1] ?? "").trim()
    let m = nombre.match(/^codigo(\d+)$/i)
    if (m) {
      if (codigos.has(m[1])) return null
      codigos.set(m[1], valor)
      continue
    }
    m = nombre.match(/^cantidad(\d+)$/i)
    if (m) cant.set(m[1], valor)
  }
  if (!codigos.size) return null
  const out: { n: string; codigo: string; cantidad: string }[] = []
  for (const [n, codigo] of codigos) {
    if (!cant.has(n) || !/^[A-Za-z0-9._-]{1,30}$/.test(codigo)) return null
    out.push({ n, codigo, cantidad: cant.get(n)! })
  }
  for (const n of cant.keys()) if (!codigos.has(n)) return null
  return out
}

/** fparam de la OF: "<valor codigoN>,<cantidad>|||" por renglón (GrabarDatosDetalle, Concretus 22/10). */
export function fparamOf(lista: { codigo: string; cantidad: number | string }[]): string {
  return lista.map((r) => `${r.codigo},${r.cantidad}|||`).join("")
}

export type FilaOf = { numero: string; codigo: number | null; estado: string; fechaAlta: string; deposito: string; fechaEntrega: string }

const textoCelda = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim()

/**
 * Listado de OF (listado_ordenfabricacion.php?enviado=1, exportar=0), relevado en Concretus el 22/10 y el 26/10:
 * "Fecha | OF 0001-… | Depósito | Fecha Entrega | PEN/FIN | …", con link modificar_ordenfabricacion.php?codigo=N. Las
 * celdas vacías intercaladas se ignoran. null si una fila con número de OF no tiene ese formato (falla cerrado).
 */
export function listadoOf(html: string): FilaOf[] | null {
  const out: FilaOf[] = []
  for (const fila of String(html ?? "").replace(/<!--[\s\S]*?-->/g, "").match(/<tr\b(?:(?!<tr\b)[\s\S])*?<\/tr>/gi) ?? []) {
    if (!/\b\d{4}-\d{8}\b/.test(textoCelda(fila))) continue
    const celdas = [...fila.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => textoCelda(m[1])).filter((c) => c !== "")
    const num = (celdas[1] ?? "").match(/^(?:OF\s+)?(\d{4}-\d{8})$/i)
    const ok = celdas.length >= 5 && /^\d{4}-\d{2}-\d{2}$/.test(celdas[0]) && num && /^\d{4}-\d{2}-\d{2}$/.test(celdas[3]) && /^(PEN|FIN)$/i.test(celdas[4])
    if (!ok) return null
    const cod = fila.match(/modificar_ordenfabricacion\.php\?codigo=(\d+)/i)?.[1]
    out.push({ numero: num![1], codigo: cod ? Number(cod) : null, estado: celdas[4].toUpperCase(), fechaAlta: celdas[0], deposito: celdas[2].toUpperCase(), fechaEntrega: celdas[3] })
  }
  return out
}

/** OF nuevas respecto de la foto previa (por número). */
export function ofNuevas(foto: string[], ahora: FilaOf[]): FilaOf[] {
  const previas = new Set(foto)
  return ahora.filter((o) => !previas.has(o.numero))
}

// ---------------------------------------------------------------------------
// Remito (alta, Validarremito, manage_remitos y _validarnumeroremito capturados el 29/10 en REBUCRET)
// ---------------------------------------------------------------------------

/**
 * Campos de `frm_remitos` (modificar_remitos.php?pedido=N, 29/10) que el robot necesita. Validarremito() exige además
 * `transporte` marcado (radio sin marcar: no viene en los campos, se busca en la página). Si falta alguno, no se graba.
 */
export const CAMPOS_REMITO = [
  "remitos", "idcliente", "provincia", "provincia_fiscal", "comprobante", "numero", "fecha", "fentrega", "deposito", "patente",
  "observaciones", "observacionesimp", "lote", "entrega_direccion", "entrega_localidad",
] as const

export function formularioRemito(html: string) {
  return camposFormulario(html, /grabar_remitos/i)
}

/** ¿El form de esa action se manda como multipart? (enctype del tag) */
export function esMultipart(html: string, action: RegExp): boolean {
  const tag = (String(html ?? "").match(/<form\b[^>]*>/gi) || []).find((t) => action.test(t)) || ""
  return /enctype\s*=\s*["']?multipart\/form-data/i.test(tag)
}

/** ¿La página trae el radio `transporte` con ese valor? */
export function tieneTransporte(html: string, valor: string): boolean {
  return (String(html ?? "").match(/<input\b[^>]*>/gi) || []).some((t) => /name\s*=\s*["']?transporte["'\s>]/i.test(t) && new RegExp(`value\\s*=\\s*["']?${valor}["'\\s>]`, "i").test(t))
}

/** Un renglón pendiente de la NP en "Continuar" (manage_remitos.php, 29/10). */
export type ItemRemito = {
  /** id del renglón (sufijo de cantidad<id>, hcantidad<id>…) */
  id: string
  /** NP del renglón: código del link modificar_pedidos.php?codigo=N */
  pedido: number | null
  /** "10090040 - H25-620-15 B (CAN)" → 10090040 y "H25-620-15 B (CAN)" */
  codigoArticulo: string
  nombreArticulo: string
  /** hcantidad<id>: lo pendiente */
  pendiente: number | null
  /** stock<id>: el stock físico del depósito */
  stock: number | null
  /** novalidarstock<id> = 1: Zomatik no controla el stock de ese renglón */
  sinControlStock: boolean
  /** TODOS los campos del renglón (peso, cantidad, lote, hcantidad, stock, novalidarstock…), como los manda el form. */
  campos: CampoForm[]
}

const numeroDe = (v: string | undefined) => {
  if (v === undefined || v.trim() === "") return null
  const t = v.replace(/[^\d.,-]/g, "")
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t)
  return Number.isFinite(n) ? n : null
}

const decod = (s: string) => s.replace(/&quot;/gi, '"').replace(/&#0*39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&amp;/gi, "&")

/** Inputs y selects con nombre de un pedazo de HTML, en orden (los radios y checkboxes, solo si están marcados). */
function camposDeHtml(html: string): CampoForm[] {
  const out: CampoForm[] = []
  for (const m of String(html ?? "").matchAll(/<input\b[^>]*>|<select\b[^>]*>[\s\S]*?<\/select>|<textarea\b[^>]*>[\s\S]*?<\/textarea>/gi)) {
    const t = m[0]
    const cab = (t.match(/^<(?:input|select|textarea)\b[^>]*>/i) || [""])[0]
    const nombre = cab.match(/\bname\s*=\s*["']?([^"'\s>]+)/i)?.[1]
    if (!nombre) continue
    const attr = (tag: string, a: string) => {
      const x = tag.match(new RegExp(`\\b${a}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"))
      return x ? (x[1] ?? x[2] ?? x[3] ?? "") : null
    }
    if (/^<input/i.test(t)) {
      const tipo = (attr(t, "type") || "text").toLowerCase()
      if (["submit", "button", "image", "file", "reset"].includes(tipo)) continue
      if ((tipo === "radio" || tipo === "checkbox") && !/\bchecked\b/i.test(t)) continue
      out.push({ nombre, valor: decod(attr(t, "value") ?? "") })
    } else if (/^<select/i.test(t)) {
      const ops = [...t.matchAll(/<option\b([^>]*)>/gi)]
      const el = ops.find((o) => /\bselected\b/i.test(o[1])) || ops[0]
      out.push({ nombre, valor: el ? decod(attr(`<option ${el[1]}>`, "value") ?? "") : "" })
    } else {
      out.push({ nombre, valor: decod(t.replace(/^<textarea[^>]*>/i, "").replace(/<\/textarea>$/i, "")) })
    }
  }
  return out
}

/**
 * Renglones de "Continuar" (manage_remitos.php, respuesta real del 29/10): un <tr> por renglón pendiente de la NP con
 * `peso<id>`, link "NP 0001-…" (modificar_pedidos.php?codigo=N), "código - artículo", `cantidad<id>` (¡precargada con
 * TODO lo pendiente!), `lote<id>`, `hcantidad<id>` (pendiente), `stock<id>` y `novalidarstock<id>`.
 * null si una fila con hcantidad no tiene esa forma (falla cerrado).
 */
export function itemsRemito(html: string): ItemRemito[] | null {
  const out: ItemRemito[] = []
  for (const tr of String(html ?? "").replace(/<!--[\s\S]*?-->/g, "").match(/<tr\b(?:(?!<tr\b)[\s\S])*?<\/tr>/gi) ?? []) {
    const id = tr.match(/name\s*=\s*["']?hcantidad(\d+)/i)?.[1]
    if (!id) continue
    const campos = camposDeHtml(tr)
    const v = (pref: string) => campos.find((c) => c.nombre.toLowerCase() === `${pref}${id}`)?.valor
    if (v("cantidad") === undefined || v("stock") === undefined) return null
    const celdas = [...tr.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => textoCelda(m[1].replace(/<input\b[^>]*>/gi, " ")))
    const art = celdas.map((c) => c.match(/^(\d{3,})\s+-\s+(.+)$/)).find(Boolean)
    if (!art) return null
    const ped = tr.match(/modificar_pedidos\.php\?codigo=(\d+)/i)?.[1]
    out.push({
      id, pedido: ped ? Number(ped) : null, codigoArticulo: art[1], nombreArticulo: art[2].trim(),
      pendiente: numeroDe(v("hcantidad")), stock: numeroDe(v("stock")), sinControlStock: (v("novalidarstock") || "0").trim() === "1", campos,
    })
  }
  return out
}

/** Campos de "Continuar" que no son de ningún renglón (bus_deposito, totales…): el form los manda igual. */
export function camposSueltosRemito(html: string): CampoForm[] {
  let resto = String(html ?? "").replace(/<!--[\s\S]*?-->/g, "")
  for (const tr of resto.match(/<tr\b(?:(?!<tr\b)[\s\S])*?<\/tr>/gi) ?? []) if (/name\s*=\s*["']?hcantidad\d+/i.test(tr)) resto = resto.replace(tr, " ")
  return camposDeHtml(resto)
}

/** ¿El renglón es del artículo? Por el código visible (zomatik_articulos.codigo) o por el nombre. */
export function esItemDe(it: ItemRemito, art: { codigo?: number | string | null; nombre?: string | null }): boolean {
  if (art.codigo && it.codigoArticulo === String(art.codigo)) return true
  const plano = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toUpperCase()
  return !!art.nombre && plano(it.nombreArticulo) === plano(art.nombre)
}

/**
 * Listado de remitos (listado_remitos.php, 29/10: Número | Cliente | … | Depósito | Fecha | …, link
 * modificar_remitos.php?codigo=N): número y código de cada fila. El número, con o sin "RM"/"RM2" adelante.
 */
export function listadoRemitos(html: string): { codigo: number; numero: string }[] {
  const out: { codigo: number; numero: string }[] = []
  const vistos = new Set<number>()
  for (const fila of String(html ?? "").replace(/<!--[\s\S]*?-->/g, "").match(/<tr\b(?:(?!<tr\b)[\s\S])*?<\/tr>/gi) ?? []) {
    const cod = fila.match(/modificar_remitos\.php\?codigo=(\d+)/i)?.[1]
    if (!cod || vistos.has(Number(cod))) continue
    const numero = [...fila.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => textoCelda(m[1])).find((c) => /^(RM2?\s+)?\d{4}-\d{8}$/i.test(c))
    if (!numero) continue
    vistos.add(Number(cod))
    out.push({ codigo: Number(cod), numero: numero.toUpperCase().replace(/\s+/g, " ") })
  }
  return out
}

/**
 * `_validarnumeroremito.php?fcomprobante=…&fnumero=…` (respuestas reales del 29/10): vacío = libre;
 * "El numero de comprobante: 0001-00002252 ya se encuentra utilizado" = usado; "… no esta cargado en el sistema" = fuera
 * del talonario. Cualquier otra cosa: no se sabe (no se graba).
 */
export function numeroRemitoLibre(respuesta: string): { libre: true } | { libre: false; motivo: "usado" | "fuera" | "otro"; texto: string } {
  const t = String(respuesta ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
  if (!t) return { libre: true }
  const motivo = /ya se encuentra utilizado/i.test(t) ? "usado" : /no esta cargado en el sistema/i.test(t) ? "fuera" : "otro"
  return { libre: false, motivo, texto: t.slice(0, 200) }
}
