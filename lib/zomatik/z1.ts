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
import { camposFormulario, numeroNormalizado, type CampoForm, type DatosCliente } from "@/lib/zomatik/np"

const r3 = (n: number) => Math.round(Number(n) * 1000) / 1000
const TOL = 0.001

// ---------------------------------------------------------------------------
// Marca, comprobantes y serie
// ---------------------------------------------------------------------------

const corto = (id: string) => String(id).replace(/-/g, "").slice(0, 8)

/**
 * "Sistema Rebucret - pedido 1a2b3c4d - 2026-10-29 - NP 1": va en las observaciones de la OF y del remito (ASCII).
 * `vez`: 2, 3… para otro remito del mismo pedido, día y NP (despachos que llegaron después del primero):
 * "… - 2026-10-29 - 2 - NP 1". Va antes de "NP" para que ninguna marca quede contenida en otra (tieneMarca).
 */
export function marcaZ1(pedidoId: string, fecha: string, npN: number, vez = 1): string {
  return `Sistema Rebucret - pedido ${corto(pedidoId)} - ${fecha}${vez > 1 ? ` - ${vez}` : ""} - NP ${npN}`
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
  /** m³ de cada despacho en ESTE remito: todo el despacho o, si se partió entre NP, su parte */
  despachos: { id: string; m3: number }[]
  patente: string | null
  patentes: string
  remitos_papel: string
}

export type PlanZ1 = {
  remitos: RemitoPlan[]
  problemas: string[]
  /** Despachos partidos entre dos o más NP (16/11): sus remitos se crean juntos, en una sola transacción. */
  partidos: string[]
}

/**
 * Los remitos de un pedido en un día (17.1, 26.2): uno por NP usada, con los despachos de ese día que todavía no están
 * en un remito. Cada despacho va entero a una NP (la primera, en el orden de los usos, en la que entra). Si no entra
 * entero en ninguna (16/11, A.A. Arquitectura: NP 35 + adicional 3 y el último camión de 8), se parte: llena cada NP
 * apta, en el orden de los usos, con lo que le queda, y el resto va a la siguiente; su número de papel y su patente van
 * en los remitos de todas sus partes. Si ni partido entra (no alcanza lo que les queda a las aptas), problema y no se
 * arma nada de ese despacho. Se frena (problema, sin remito) si: la NP no está en Zomatik, el despacho es de otra
 * fórmula o planta que la NP, o su R/X no coincide con la NP (R ↔ NP, X ↔ NP2). Nunca se parte hacia una NP no apta.
 */
export function planificarRemitos(despachos: DespachoZ1[], nps: NpZ1[], yaRemitidos: Set<string>, remitidoPorNp: Map<string, number> = new Map()): PlanZ1 {
  const problemas: string[] = []
  const partidos: string[] = []
  const pendientes = [...despachos].filter((d) => !yaRemitidos.has(d.id) && Number(d.m3) > TOL).sort((a, b) => a.created_at.localeCompare(b.created_at))
  if (!pendientes.length) return { remitos: [], problemas, partidos }
  const usables = nps.filter((x) => x.estado === "ok" && comprobanteRemito(x.numero) && x.zomatik_codigo)
  if (!usables.length) return { remitos: [], problemas: ["El pedido no tiene una NP en Zomatik: no se puede remitir."], partidos }
  // Lo que le queda a cada NP para este pedido: lo que reserva menos lo ya remitido contra ella (otros días o antes)
  const lugar = new Map(usables.map((x) => [x.np_id, r3((Number(x.m3_uso) || 0) - (remitidoPorNp.get(x.np_id) || 0))]))
  /** Lo que va a cada NP: el despacho y los m³ que le tocan (todo el despacho, o su parte si se partió). */
  const porNp = new Map<string, { d: DespachoZ1; m3: number }[]>()
  const poner = (npId: string, d: DespachoZ1, m3: number) => {
    lugar.set(npId, r3((lugar.get(npId) || 0) - m3))
    porNp.set(npId, [...(porNp.get(npId) || []), { d, m3: r3(m3) }])
  }
  for (const d of pendientes) {
    const m3 = r3(d.m3)
    const aptas = usables.filter((x) => {
      const comp = comprobanteRemito(x.numero)!
      return (!d.remito_tipo || TIPO_DE_COMPROBANTE[comp] === d.remito_tipo) && (!x.formula_id || !d.formula_id || x.formula_id === d.formula_id) && (!x.plant_id || !d.plant_id || x.plant_id === d.plant_id)
    })
    if (!aptas.length) {
      problemas.push(`El despacho ${d.remito || d.id.slice(0, 8)} (${m3} m³) no coincide con ninguna NP del pedido (R/X, fórmula o planta): revisalo.`)
      continue
    }
    const np = aptas.find((x) => (lugar.get(x.np_id) || 0) + TOL >= m3)
    if (np) {
      poner(np.np_id, d, m3)
      continue
    }
    // No entra entero en ninguna: se parte entre las aptas que tienen lugar, en el orden de los usos
    const conLugar = aptas.filter((x) => (lugar.get(x.np_id) || 0) > TOL)
    const total = r3(conLugar.reduce((s, x) => s + (lugar.get(x.np_id) || 0), 0))
    if (total + TOL < m3) {
      problemas.push(`El despacho ${d.remito || d.id.slice(0, 8)} (${m3} m³) supera lo que le queda a la NP: generá una NP adicional antes de remitir.`)
      continue
    }
    let resto = m3
    for (const x of conLugar) {
      if (resto <= TOL) break
      const l = lugar.get(x.np_id) || 0
      const toma = resto - l <= TOL ? resto : l
      poner(x.np_id, d, toma)
      resto = r3(resto - toma)
    }
    partidos.push(d.id)
  }
  const remitos: RemitoPlan[] = []
  for (const x of usables) {
    const ds = porNp.get(x.np_id)
    if (!ds?.length) continue
    const patentes = [...new Set(ds.map(({ d }) => (d.patente || "").trim()).filter(Boolean))]
    remitos.push({
      np_id: x.np_id,
      np_n: x.n,
      comprobante: comprobanteRemito(x.numero)!,
      m3: r3(ds.reduce((s, p) => s + p.m3, 0)),
      despachos: ds.map((p) => ({ id: p.d.id, m3: p.m3 })),
      patente: patentes[0] || null,
      patentes: patentes.join(", "),
      remitos_papel: ds.map(({ d }) => d.remito).filter(Boolean).join(", "),
    })
  }
  return { remitos, problemas, partidos }
}

/**
 * Observaciones del remito, como los cargan hoy (12 remitos reales, 29/10):
 *   observaciones    la marca del sistema PRIMERO (si Zomatik recorta el texto, no se pierde), la obra (la
 *                    "descripción") y las patentes;
 *   observacionesimp (las impresas) los números de remito de planta del día separados por espacio: "934 935 936".
 */
export function observacionesRemito(marca: string, r: { patentes: string; remitos_papel: string }, obra: string | null): { observaciones: string; observacionesimp: string } {
  const obs = [marca, obra || "", r.patentes ? `Camiones: ${r.patentes}` : ""].filter(Boolean).join(" - ")
  const imp = r.remitos_papel.split(",").map((x) => x.trim()).filter(Boolean).join(" ")
  return { observaciones: obs, observacionesimp: imp }
}

/**
 * Lugar de entrega del remito, como lo cargan hoy (29/10): lote = el lote de la obra si lo tiene (barrio) o si no el
 * nombre de la obra; dirección = la de la obra o su nombre; localidad = la de la obra (sin ella, "revisar").
 */
export function entregaRemito(obra: { nombre?: string | null; direccion?: string | null; localidad?: string | null; lote?: string | null } | null): { direccion: string | null; localidad: string | null; lote: string | null } {
  const t = (s: string | null | undefined) => (s || "").trim() || null
  const nombre = t(obra?.nombre)
  return { lote: t(obra?.lote) || nombre, direccion: t(obra?.direccion) || nombre, localidad: t(obra?.localidad) }
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

export type FilaOf = {
  numero: string; codigo: number | null; estado: string; fechaAlta: string; deposito: string; fechaEntrega: string
  /** El código del lapicito de la columna "Remitido" (`remitir_ordenfabricacion.php?codigo=N`): solo las PEN lo traen (13/11) */
  remitir: number | null
}

const textoCelda = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim()

/**
 * Listado de OF (listado_ordenfabricacion.php?enviado=1, exportar=0), relevado en Concretus el 22/10 y el 26/10:
 * "Fecha | OF 0001-… | Depósito | Fecha Entrega | PEN/FIN | …", con link modificar_ordenfabricacion.php?codigo=N. Las
 * celdas vacías intercaladas se ignoran. null si una fila con número de OF no tiene ese formato (falla cerrado).
 * Las PEN traen en "Remitido" el lapicito `remitir_ordenfabricacion.php?codigo=N` (REAL 13/11): va en `remitir`.
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
    const rem = fila.match(/remitir_ordenfabricacion\.php\?codigo=(\d+)/i)?.[1]
    out.push({ numero: num![1], codigo: cod ? Number(cod) : null, estado: celdas[4].toUpperCase(), fechaAlta: celdas[0], deposito: celdas[2].toUpperCase(), fechaEntrega: celdas[3], remitir: rem ? Number(rem) : null })
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

/** Provincia de la entrega: 1 Buenos Aires (remitos reales, 30/10: fiscal 1 aunque el cliente sea de Capital). */
export const PROVINCIA_BUENOS_AIRES = "1"

const vacioForm = (v: string | undefined) => !v || !v.trim() || v.trim() === "0"

/**
 * Los datos del cliente que `frm_remitos` no trae en el HTML: la página los pide a traerdatossecundarios.php (índices
 * en `datosSecundarios`). Solo se completa lo que el formulario trae vacío. `provincia_fiscal` es la de la entrega:
 * Buenos Aires, salvo que el formulario traiga otra.
 */
export function datosClienteRemito(campos: Record<string, string>, c: DatosCliente): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of ["direccion", "localidad", "provincia", "cp", "cuit", "condicion_pago"] as const) if (vacioForm(campos[k]) && c[k]) out[k] = c[k]
  if (vacioForm(campos.provincia) && !out.provincia) out.provincia = PROVINCIA_BUENOS_AIRES
  out.provincia_fiscal = vacioForm(campos.provincia_fiscal) ? PROVINCIA_BUENOS_AIRES : campos.provincia_fiscal
  return out
}

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
export function numeroRemitoLibre(respuesta: string, status = 200): { libre: true } | { libre: false; motivo: "usado" | "fuera" | "otro"; texto: string } {
  const t = String(respuesta ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
  // Vacío es libre SOLO con 200: un error (500, redirección al login) con cuerpo vacío no prueba nada
  if (status !== 200) return { libre: false, motivo: "otro", texto: `HTTP ${status}${t ? `: ${t.slice(0, 150)}` : ""}` }
  if (!t) return { libre: true }
  const motivo = /ya se encuentra utilizado/i.test(t) ? "usado" : /no esta cargado en el sistema/i.test(t) ? "fuera" : "otro"
  return { libre: false, motivo, texto: t.slice(0, 200) }
}

// ---------------------------------------------------------------------------
// Despachos que cambiaron después de armar el remito (anulados = borrados, o editados)
// ---------------------------------------------------------------------------

export type CambioDespachos = {
  /** Despachos del remito que ya no existen (anular_despacho los borra) */
  anulados: string[]
  /**
   * Despachos con otros m³ (o de otra fórmula) que los del remito. `parte`: solo en un despacho partido entre NP (16/11),
   * lo que le toca a ESTE remito con los m³ de hoy (lo de hoy menos lo que tienen sus otras partes; 0 = ya no le toca nada)
   */
  editados: { id: string; antes: number; ahora: number; parte?: number }[]
  /** m³ de los despachos que siguen (de un despacho partido, su parte en este remito) */
  m3: number
  /** Firma del cambio (para avisar una sola vez); null si no cambió nada */
  firma: string | null
}

/**
 * Compara los despachos del remito (`zomatik_remito_despachos`: lo que se mandó o se va a mandar a Zomatik) con los que
 * existen hoy. Un despacho que no está se anuló; uno con otros m³ o de otra fórmula, se editó.
 * `enOtros`: lo que tiene cada despacho en OTROS remitos (16/11: un despacho partido entre dos NP está en dos remitos).
 * Un despacho partido se compara por la suma de sus partes contra lo de hoy, no por la parte de este remito.
 */
export function cambiosDespachos(
  enRemito: { dispatch_id: string; m3: number }[],
  actuales: { id: string; quantity_m3: number | null; formula_id?: string | null }[],
  formulaRemito: string | null = null,
  enOtros: Map<string, number> = new Map(),
): CambioDespachos {
  const por = new Map(actuales.map((d) => [d.id, d]))
  const anulados: string[] = []
  const editados: CambioDespachos["editados"] = []
  let m3 = 0
  for (const x of enRemito) {
    const d = por.get(x.dispatch_id)
    if (!d) {
      anulados.push(x.dispatch_id)
      continue
    }
    const ahora = r3(Number(d.quantity_m3) || 0)
    const otros = r3(enOtros.get(x.dispatch_id) || 0)
    const otraFormula = !!formulaRemito && !!d.formula_id && d.formula_id !== formulaRemito
    if (otros > TOL) {
      // Partido: la suma de sus partes contra lo de hoy; si cambió, este remito se queda con lo que no tienen las otras
      const antes = r3(Number(x.m3) + otros)
      const cambio = Math.abs(ahora - antes) > TOL
      const parte = cambio ? r3(Math.max(0, ahora - otros)) : r3(x.m3)
      m3 += parte
      if (cambio || otraFormula) editados.push({ id: x.dispatch_id, antes, ahora, parte })
      continue
    }
    m3 += ahora
    if (Math.abs(ahora - r3(x.m3)) > TOL || otraFormula) editados.push({ id: x.dispatch_id, antes: r3(x.m3), ahora })
  }
  anulados.sort()
  editados.sort((a, b) => a.id.localeCompare(b.id))
  const firma = anulados.length || editados.length ? JSON.stringify({ a: anulados, e: editados.map((e) => [e.id, e.ahora]) }) : null
  return { anulados, editados, m3: r3(m3), firma }
}

/** Texto corto del cambio para el aviso: "se anularon 1 despacho(s); se editaron 2 (8 → 6 m³)". */
export function textoCambio(c: CambioDespachos): string {
  const p: string[] = []
  if (c.anulados.length) p.push(`se anuló${c.anulados.length > 1 ? "ron" : ""} ${c.anulados.length} despacho${c.anulados.length > 1 ? "s" : ""}`)
  if (c.editados.length) p.push(`se editó${c.editados.length > 1 ? "ron" : ""} ${c.editados.map((e) => `${e.antes} → ${e.ahora} m³`).join(", ")}`)
  return p.join("; ")
}

/** Los últimos `n` días hasta `hoy` (aaaa-mm-dd), de hoy para atrás. */
export function ultimosDias(hoy: string, n: number): string[] {
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    const d = new Date(`${hoy}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() - i)
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

/** Intentos sin stock antes de "revisar" (cada 10 min: 1 hora). */
export const MAX_SIN_STOCK = 6

// ---------------------------------------------------------------------------
// Listado de remitos: las filas NO vienen en el HTML (prueba real del 29/10). Las trae después el JavaScript
// (TraerPaginado) con POST paginar_<#paginar_archivo>.php y fsql = el hidden #sql de la página, tal cual.
// ---------------------------------------------------------------------------

/** Entidades HTML como las decodifica el navegador al leer `.value` (con nombre comunes y numéricas). */
export function decodificarEntidades(s: string): string {
  const nombres: Record<string, string> = {
    quot: '"', amp: "&", lt: "<", gt: ">", apos: "'", nbsp: "\u00a0",
    aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", ntilde: "ñ", uuml: "ü", Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Ntilde: "Ñ", Uuml: "Ü",
  }
  return String(s ?? "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(n) ? String.fromCharCode(n) : m
    }
    return nombres[e] ?? nombres[e.toLowerCase()] ?? m
  })
}

/** Los atributos de un tag, respetando las comillas (un valor puede traer ">" o "name="). */
function atributosDe(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of tag.replace(/^<\w+/, "").matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    const k = m[1].toLowerCase()
    if (!(k in out)) out[k] = m[2] ?? m[3] ?? m[4] ?? ""
  }
  return out
}

/**
 * El valor (decodificado) del input con ese id o name; null si no está. El tag se corta respetando las comillas: el
 * `#sql` trae ">=" y "<>" crudos dentro de value="…" (con `<input[^>]*>` el valor quedaba en `"select`).
 */
export function valorDeInput(html: string, id: string): string | null {
  for (const tag of String(html ?? "").match(/<input\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi) ?? []) {
    const a = atributosDe(tag)
    if (a.id === id || a.name === id) return decodificarEntidades(a.value ?? "")
  }
  return null
}

/**
 * Lo que necesita el paginado del listado (TraerPaginado): `#paginar_archivo` ("remitos"), `#sql` (la consulta que arma
 * Zomatik con los filtros) y `#query_string`. null si falta el archivo o el sql no es una consulta entera (un sql
 * cortado nunca se manda).
 */
export function paginadoDe(html: string): { archivo: string; sql: string; qs: string } | null {
  const archivo = valorDeInput(html, "paginar_archivo")
  const sql = valorDeInput(html, "sql")
  if (!archivo || !sql || !/^\s*select\b[\s\S]*\bfrom\b/i.test(sql)) return null
  return { archivo, sql, qs: valorDeInput(html, "query_string") ?? "" }
}

/** `id="registros_total"` del paginado (input o texto): el total de filas. */
export function registrosTotal(html: string): number | null {
  const v = valorDeInput(html, "registros_total")
  const t = v ?? String(html ?? "").match(/id\s*=\s*["']?registros_total["']?[^>]*>([^<]*)</i)?.[1]
  const n = Number(String(t ?? "").replace(/[^\d]/g, ""))
  return t !== undefined && t !== null && String(t).trim() !== "" && Number.isFinite(n) ? n : null
}

/** El value de la opción de un select cuyo texto coincide (p. ej. la sucursal REBUCRET del buscador). */
export function opcionDeSelect(html: string, nombre: string, texto: RegExp): string | null {
  const sel = String(html ?? "").match(new RegExp(`<select\\b[^>]*name\\s*=\\s*["']?${nombre}["'\\s>][\\s\\S]*?</select>`, "i"))?.[0]
  if (!sel) return null
  for (const m of sel.matchAll(/<option\b([^>]*)>([\s\S]*?)(?=<option\b|<\/select>)/gi)) {
    if (!texto.test(m[2].replace(/<[^>]+>/g, " ").trim())) continue
    const v = m[1].match(/\bvalue\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)
    return v ? (v[1] ?? v[2] ?? v[3] ?? "") : null
  }
  return null
}

// ---------------------------------------------------------------------------
// Remito hecho a mano (10/11): el robot nunca repite lo que ya se remitió en Zomatik
// ---------------------------------------------------------------------------

/** Un remito que grabó el sistema (o el número que guardó antes de grabar): código y/o número. */
export type RemitoNuestro = { codigo?: number | null; numero: string | null; comprobante?: "7" | "19" | null }

/**
 * "RM2 0099-00002765": el prefijo (el que trae el número o, si no lo trae, el del comprobante) y el número normalizado.
 * null si no tiene número.
 */
export function claveRemito(numero: string | null | undefined, comprobante?: "7" | "19" | null): string | null {
  const n = numeroNormalizado(numero)
  if (!n) return null
  const pref = String(numero ?? "").toUpperCase().match(/\b(RM2?)\s/)?.[1] ?? (comprobante ? PREFIJO_REMITO[comprobante] : "")
  return `${pref} ${n}`.trim()
}

/**
 * Los remitos de la NP en Zomatik (sus comprobantes) que NO hizo el sistema: ni su código ni su número están entre
 * `nuestros`. No se comparan m³: cualquier remito a mano sobre la NP alcanza para no tocarla.
 */
export function remitosAjenos(remitosNp: { codigo: number; numero: string }[], nuestros: RemitoNuestro[]): { codigo: number; numero: string }[] {
  const codigos = new Set(nuestros.map((x) => Number(x.codigo)).filter((c) => c > 0))
  const claves = new Set(nuestros.map((x) => claveRemito(x.numero, x.comprobante)).filter(Boolean))
  return remitosNp.filter((x) => !(x.codigo > 0 && codigos.has(x.codigo)) && !claves.has(claveRemito(x.numero)))
}

export const msjRemitoAMano = (numeros: string[]) => `Ya estaba remitido a mano en Zomatik (${numeros.join(", ")}): el robot no lo repite`
/** Se cortó al grabar el remito del robot (`propio`, en la NP) y además hay uno a mano: los dos quedan nombrados. */
export const msjDosRemitos = (propio: string, numeros: string[]) => `Puede haber dos remitos: ${propio} (robot) y ${numeros.join(", ")} (a mano), revisalos. El robot no hizo otro.`
export const MSJ_COMPROBANTES_ILEGIBLES = "No se pudieron leer los comprobantes de la NP en Zomatik (para saber si ya se remitió a mano): no se siguió. Se reintenta."

// ---------------------------------------------------------------------------
// Materia prima de la OF (docs/specs/2026-11-19-of-descuenta-materia-prima.md; capturas REALES del 19/11)
//   Una OF hecha a mano pasa por la pantalla "Composicion" (modificar_ordenfabricacioncompo.php?codigo=N): "Continuar"
//   crea el remito interno (RMI) de materia prima, que es lo que descuenta el stock. El robot se la salteaba.
// ---------------------------------------------------------------------------

/** Lo que descuenta un material: código de artículo de Zomatik, nombre y toneladas (el valor de `adescontar_<id>`). */
export type MaterialMp = { codigo: string; nombre: string; toneladas: number }

export type FormularioMp =
  | { ok: true; campos: CampoForm[]; materiales: MaterialMp[]; multipart: boolean }
  /** `sin_composicion`: el artículo no tiene composición en Zomatik. `formato`: la pantalla no es la capturada. */
  | { ok: false; motivo: "sin_composicion" | "formato"; mensaje: string }

export const MSJ_SIN_COMPOSICION = "El artículo de la OF no tiene composición en Zomatik: no hay materia prima para descontar."

/**
 * La pantalla "Composicion" de la OF `codigoOf` (REAL 19/11, `of-compo.html`): form `grabar_ordenfabricacioncompo.php`
 * por POST, ocultos `ordenfabricacion` (= la OF) y `fparam`, y un `adescontar_<id interno>` por material con las
 * toneladas a descontar (composición del artículo × cantidad de la OF). Cada fila trae código de artículo, nombre y
 * cantidad. Falla cerrado: otro form, otra OF, un campo que no se conoce o repetido, o un valor que no es un número
 * mayor que 0 → no se manda nada. `campos`: los de la pantalla, en su orden y sin tocar (lo que manda "Continuar").
 */
export function formularioMpOf(html: string, codigoOf: number): FormularioMp {
  const mal = (m: string): FormularioMp => ({ ok: false, motivo: "formato", mensaje: `Zomatik cambió la pantalla de materia prima de la OF (${m}). No se mandó nada.` })
  const limpio = String(html ?? "").replace(/<!--[\s\S]*?-->/g, "")
  const forms = (limpio.match(/<form\b[\s\S]*?<\/form>/gi) || []).filter((f) => /ordenfabricacioncompo/i.test((f.match(/<form[^>]*>/i) || [""])[0]))
  if (forms.length !== 1) return mal(forms.length ? "hay más de un formulario" : "no se abrió la pantalla Composicion")
  const cab = (forms[0].match(/<form[^>]*>/i) || [""])[0]
  const f = camposFormulario(limpio, /ordenfabricacioncompo/i)
  if (!f) return mal("no se abrió la pantalla Composicion")
  if (!/^grabar_ordenfabricacioncompo\.php$/i.test(f.action || "") || !/\bmethod\s*=\s*["']?post["'\s>]/i.test(cab)) return mal("graba en otro lado")
  const nombres = f.orden.map((c) => c.nombre)
  const repetido = nombres.find((n, i) => nombres.indexOf(n) !== i)
  if (repetido) return mal(`el campo ${repetido} viene repetido`)
  const desconocido = nombres.find((n) => n !== "ordenfabricacion" && n !== "fparam" && !/^adescontar_\d+$/.test(n))
  if (desconocido) return mal(`trae un campo que no se conoce: ${desconocido}`)
  if (!Number.isInteger(codigoOf) || codigoOf <= 0 || f.campos.ordenfabricacion !== String(codigoOf)) return mal(`es de otra OF: ${f.campos.ordenfabricacion ?? "sin código"} y se esperaba ${codigoOf}`)
  const aDescontar = f.orden.filter((c) => /^adescontar_\d+$/.test(c.nombre))
  if (!aDescontar.length) return { ok: false, motivo: "sin_composicion", mensaje: MSJ_SIN_COMPOSICION }
  const invalido = aDescontar.find((c) => !/^\d+(\.\d+)?$/.test(c.valor) || !(Number(c.valor) > 0))
  if (invalido) return mal(`${invalido.nombre} vale "${invalido.valor}", no un número mayor que 0`)
  // El detalle de cada material: la fila de su input (código de artículo · nombre · cantidad · input)
  const materiales: MaterialMp[] = []
  for (const tr of forms[0].match(/<tr\b(?:(?!<tr\b)[\s\S])*?<\/tr>/gi) ?? []) {
    const ids = [...tr.matchAll(/name\s*=\s*["']?(adescontar_\d+)/gi)].map((m) => m[1])
    if (!ids.length) continue
    const campo = aDescontar.find((c) => c.nombre === ids[0])
    const celdas = [...tr.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => textoCelda(m[1].replace(/<input\b[^>]*>/gi, " ")))
    const nombre = (celdas[1] ?? "").replace(/:\s*$/, "").trim()
    if (ids.length !== 1 || !campo || !/^\d{3,}$/.test(celdas[0] ?? "") || !nombre) return mal("una fila de material no trae código de artículo y nombre")
    materiales.push({ codigo: celdas[0], nombre, toneladas: Number(campo.valor) })
  }
  if (materiales.length !== aDescontar.length) return mal("los materiales no vienen uno por fila")
  return { ok: true, campos: f.orden, materiales, multipart: esMultipart(limpio, /ordenfabricacioncompo/i) }
}

/** Un remito interno del listado: su código, "RMI 0001-00006857" sin el prefijo, la fecha y la OF a la que está ligado. */
export type FilaRmi = { codigo: number; numero: string; fecha: string; of: string | null }

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()

/**
 * Listado de remitos internos (listado_remitosinternos.php, REAL 19/11, `remitosinternos-listado.html`): Codigo · Fecha ·
 * Flete · Deposito Origen · Deposito Destino · Observaciones · Remito Fisico · Recibido · OF, con una celda angosta
 * entre columnas. La columna OF dice "OF 0001-0000NNNN" (vacía si el remito interno no es de una OF). Las columnas se
 * ubican por el encabezado, no por su posición fija. null (falla cerrado) sin el encabezado o si una fila no tiene esa
 * forma: con un listado que no se entiende no se puede saber si una OF ya descontó.
 */
export function listadoRmi(html: string): FilaRmi[] | null {
  const filas = String(html ?? "").replace(/<!--[\s\S]*?-->/g, "").match(/<tr\b(?:(?!<tr\b)[\s\S])*?<\/tr>/gi) ?? []
  const celdasDe = (tr: string) => [...tr.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => textoCelda(m[1]))
  const iCab = filas.findIndex((tr) => {
    const c = celdasDe(tr).map(sinTildes)
    return c.includes("CODIGO") && c.includes("FECHA") && c.includes("OF")
  })
  if (iCab < 0) return null
  const cab = celdasDe(filas[iCab]).map(sinTildes)
  const [iCod, iFecha, iOf] = [cab.indexOf("CODIGO"), cab.indexOf("FECHA"), cab.indexOf("OF")]
  const out: FilaRmi[] = []
  const vistos = new Set<number>()
  for (const tr of filas.slice(iCab + 1)) {
    const cod = tr.match(/modificar_remitosinternos\.php\?codigo=(\d+)/i)?.[1]
    if (!cod && !/\bRMI\s+\d{4}-\d{8}\b/i.test(textoCelda(tr))) continue
    const c = celdasDe(tr)
    const num = (c[iCod] ?? "").match(/^RMI\s+(\d{4}-\d{8})$/i)
    const of = (c[iOf] ?? "").match(/^(?:OF\s+(\d{4}-\d{8}))?$/i)
    if (!cod || !num || !/^\d{4}-\d{2}-\d{2}$/.test(c[iFecha] ?? "") || !of || vistos.has(Number(cod))) return null
    vistos.add(Number(cod))
    out.push({ codigo: Number(cod), numero: num[1], fecha: c[iFecha], of: of[1] ?? null })
  }
  return out
}

/**
 * ¿El listado de remitos internos llega hasta antes de `desde` (aaaa-mm-dd)? Viene del más nuevo al más viejo y cortado
 * (por defecto, los últimos 150): solo si la ÚLTIMA fila es anterior a `desde` se sabe que están todos los de `desde`
 * en adelante. Sin filas, o si no llega, no se puede asegurar nada.
 */
export function rmiLlegaHasta(filas: FilaRmi[], desde: string): boolean {
  return filas.length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(desde) && filas[filas.length - 1].fecha < desde
}

/** Cuántos remitos internos tiene la OF `numero` ("0001-00003447") en el listado. */
export function rmiDeOf(filas: FilaRmi[], numero: string): number {
  return filas.filter((x) => x.of === numero).length
}

/**
 * ¿La OF ya tiene su remito interno de materia prima? (spec 3.1.2). Una OF hecha a mano tiene DOS remitos internos: el
 * de materia prima (pantalla "Composicion") y el del hormigón (lo crea "remitir la OF", que la pasa a FIN).
 *   PEN (sin remitir): 0 → falta · 1 o más → ya está.
 *   FIN (remitida):    1 → falta · 2 o más → ya está.
 * null = no se sabe (una FIN sin ningún remito interno, o un estado que no se conoce): nunca se manda a ciegas.
 */
export function tieneRmiDeMp(estadoOf: string, rmi: number): boolean | null {
  if (!Number.isInteger(rmi) || rmi < 0) return null
  const e = String(estadoOf ?? "").toUpperCase()
  if (e === "PEN") return rmi >= 1
  if (e === "FIN") return rmi === 0 ? null : rmi >= 2
  return null
}

/** "CCTS ARENA ESPECIAL (10000004): 0,93 t · …": el detalle de lo descontado, para Actividad. */
export function textoMateriales(ms: MaterialMp[]): string {
  return ms.map((m) => `${m.nombre} (${m.codigo}): ${String(Math.round(m.toneladas * 1000) / 1000).replace(".", ",")} t`).join(" · ")
}
