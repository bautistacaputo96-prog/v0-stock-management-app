/**
 * Zomatik · funciones puras de parseo (etapa Z0, solo lectura).
 *
 * Sin React, sin Supabase, sin `xlsx` y sin imports en tiempo de ejecución: se prueban con `node --test`
 * (`npm run test:zomatik`). El HTML de Zomatik llega ya decodificado de ISO-8859-1 (ver `cliente.ts`).
 *
 * Especificación: docs/migracion-loop/zomatik.md (puntos 5, 6, 16.1, 17.4 y 20.3).
 */

export type Fila = Record<string, string | number>

export type TablaHtml = { headers: string[]; rows: Record<string, string>[] }

/** Entidades HTML más comunes (Zomatik escribe &nbsp;, &amp;, &quot; y números de carácter). */
export function decodificarEntidades(s: string): string {
  return String(s ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/gi, "&")
}

/** Texto de una celda: sin etiquetas, sin entidades y con los espacios juntos. */
export function textoCelda(html: string): string {
  return decodificarEntidades(String(html ?? "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
}

/** Saca los comentarios HTML (Zomatik deja columnas enteras comentadas). */
export function sinComentarios(html: string): string {
  return String(html ?? "").replace(/<!--[\s\S]*?-->/g, "")
}

/**
 * Tabla de datos de un listado HTML. Zomatik arma el layout con tablas anidadas (el menú incluido): se elige
 * la que tenga más filas × columnas con al menos 3 columnas. Las columnas comentadas no cuentan.
 */
export function parseHtmlTable(html: string): TablaHtml {
  const limpio = sinComentarios(html)
  const tablas = limpio.match(/<table[\s\S]*?<\/table>/gi) || []
  let mejor: string[][] = []
  let mejorPuntaje = 0
  for (const t of tablas) {
    const filas: string[][] = []
    for (const tr of t.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
      const celdas = (tr.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) || []).map(textoCelda)
      if (celdas.length >= 3) filas.push(celdas)
    }
    if (filas.length < 2) continue
    const puntaje = filas.length * Math.max(...filas.map((f) => f.length))
    if (puntaje > mejorPuntaje) {
      mejorPuntaje = puntaje
      mejor = filas
    }
  }
  if (mejor.length < 2) return { headers: [], rows: [] }
  const ancho = Math.max(...mejor.map((f) => f.length))
  const headers = Array.from({ length: ancho }, (_, i) => mejor[0][i] || `col${i}`)
  const rows = mejor
    .slice(1)
    .filter((f) => f.filter((c) => c !== "").length >= 2)
    .map((f) => {
      const o: Record<string, string> = {}
      headers.forEach((h, i) => {
        o[h] = f[i] ?? ""
      })
      return o
    })
  return { headers, rows }
}

/** "$ 1.234.567,89" → 1234567.89 · "7,986,362.92" → 7986362.92 · número → número. */
export function parseNumero(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null
  if (typeof v === "number") return Number.isFinite(v) ? v : null
  let t = String(v).replace(/[^\d,.-]/g, "")
  if (!t || t === "-") return null
  const ultComa = t.lastIndexOf(",")
  const ultPunto = t.lastIndexOf(".")
  if (ultComa > ultPunto) t = t.replace(/\./g, "").replace(",", ".") // 1.234,56
  else if (ultPunto > ultComa && ultComa >= 0) t = t.replace(/,/g, "") // 1,234.56
  else if (ultComa < 0 && (t.match(/\./g) || []).length > 1) t = t.replace(/\./g, "") // 1.234.567
  const n = parseFloat(t)
  return Number.isFinite(n) ? n : null
}

/** Fechas de Zomatik: "27/08/2026", "2026-08-27" o el número de serie de Excel. Devuelve AAAA-MM-DD. */
export function parseFecha(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null
  if (typeof v === "number" || /^\d+(\.\d+)?$/.test(String(v).trim())) {
    const serial = typeof v === "number" ? v : parseFloat(String(v))
    if (serial > 20000 && serial < 80000) {
      const ms = Math.round((serial - 25569) * 86400 * 1000)
      return new Date(ms).toISOString().slice(0, 10)
    }
    return null
  }
  const t = String(v).trim()
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const m = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (!m) return null
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`
}

/** Valor de una columna por nombre exacto o, si no está, por palabras del encabezado (sin mayúsculas). */
export function col(row: Fila | Record<string, string>, ...claves: string[]): string {
  for (const c of claves) if (c in row) return String(row[c] ?? "").trim()
  const ks = Object.keys(row)
  for (const c of claves) {
    const k = ks.find((x) => x.toLowerCase().replace(/\s+/g, " ").trim() === c.toLowerCase())
    if (k) return String(row[k] ?? "").trim()
  }
  for (const c of claves) {
    const k = ks.find((x) => x.toLowerCase().includes(c.toLowerCase()))
    if (k) return String(row[k] ?? "").trim()
  }
  return ""
}

// ---------------------------------------------------------------------------
// Nombres y documentos
// ---------------------------------------------------------------------------

/** Palabras que no cuentan para comparar razones sociales (spec 6.3: "sin tildes, S.A., ARQ, ING…"). */
const PALABRAS_VACIAS = new Set(["SA", "SRL", "SAS", "SAU", "SACIF", "SCA", "ARQ", "ING", "FIDEICOMISO", "FID", "DE", "DEL", "LA", "LAS", "EL", "LOS", "Y"])

/** Tokens de una razón social: sin tildes, mayúsculas, sin S.A./S.R.L./ARQ/ING/FIDEICOMISO ni artículos. */
export function tokensNombre(s: unknown): string[] {
  const t = String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\bS\s*\.\s*R\s*\.\s*L\b\.?/g, " SRL ")
    .replace(/\bS\s*\.\s*A\s*\.\s*S\b\.?/g, " SAS ")
    .replace(/\bS\s*\.\s*A\s*\.\s*U\b\.?/g, " SAU ")
    .replace(/\bS\s*\.\s*A\b\.?/g, " SA ")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
  if (!t) return []
  return t.split(" ").filter((w) => w && !PALABRAS_VACIAS.has(w))
}

/** Clave para "nombre igual": los tokens ordenados. "García, Juan S.A." = "JUAN GARCIA". */
export function nombreNormalizado(s: unknown): string {
  return tokensNombre(s).slice().sort().join(" ")
}

/** Parecido entre dos nombres: tokens (de 3 letras o más) en común sobre el menor de los dos. 0 a 1. */
export function parecidoNombres(a: unknown, b: unknown): number {
  const A = new Set(tokensNombre(a).filter((t) => t.length > 2))
  const B = new Set(tokensNombre(b).filter((t) => t.length > 2))
  if (A.size === 0 || B.size === 0) return 0
  let comunes = 0
  for (const t of A) if (B.has(t)) comunes++
  return comunes / Math.min(A.size, B.size)
}

export function soloDigitos(s: unknown): string {
  return String(s ?? "").replace(/\D/g, "")
}

/** CUIT o CUIL válido: 11 dígitos con el verificador correcto (módulo 11). */
export function cuitValido(s: unknown): boolean {
  const d = soloDigitos(s)
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false
  if (!["20", "23", "24", "25", "26", "27", "30", "33", "34"].includes(d.slice(0, 2))) return false
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
  let suma = 0
  for (let i = 0; i < 10; i++) suma += Number(d[i]) * pesos[i]
  let v = 11 - (suma % 11)
  if (v === 11) v = 0
  if (v === 10) return false
  return v === Number(d[10])
}

/** "Responsable Inscripto" / "Monotributo" / … de Zomatik → la condición de IVA de nuestro alta. */
export function condIvaDeZomatik(t: unknown): string | null {
  const s = String(t ?? "").toLowerCase()
  if (!s) return null
  if (s.includes("inscripto")) return "Responsable Inscripto"
  if (s.includes("monotrib")) return "Monotributista"
  if (s.includes("consumidor")) return "Consumidor Final"
  if (s.includes("exento")) return "Exento"
  return null
}

/** Condición de pago de la ficha → la nuestra (vacía en casi todas las fichas: spec 5.6). */
export function condPagoDeZomatik(t: unknown): string | null {
  const s = String(t ?? "").toLowerCase()
  if (s.includes("cuenta")) return "Cuenta Corriente"
  if (s.includes("contado")) return "Contado"
  if (s.includes("anticip")) return "Anticipado"
  return null
}

// ---------------------------------------------------------------------------
// Ficha del cliente (modificar_clientes.php?codigo=N, solo lectura)
// ---------------------------------------------------------------------------

export type FichaCliente = {
  razon_social: string
  cuit: string
  tipo_documento: string
  tipo_iva: string
  direccion: string
  localidad: string
  provincia: string
  cp: string
  telefono: string
  email: string
  contacto: string
  vendedor: string
  clasificacion: string
  categoria: string
  condicion_pago: string
  zona: string
}

function atributo(tag: string, nombre: string): string | null {
  const m = tag.match(new RegExp(`\\b${nombre}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"))
  if (!m) return null
  return m[1] ?? m[2] ?? m[3] ?? ""
}

/**
 * Lee los valores de un formulario de alta/edición de Zomatik: inputs (value), selects (texto de la opción
 * elegida) y textareas. Devuelve null si la página no tiene el formulario (por ejemplo, la sesión se cayó).
 */
export function valoresFormulario(html: string, nombreForm: RegExp): Record<string, string> | null {
  const limpio = sinComentarios(html)
  const forms = limpio.match(/<form[\s\S]*?<\/form>/gi) || []
  const form = forms.find((f) => nombreForm.test((f.match(/<form[^>]*>/i) || [""])[0]))
  if (!form) return null
  const out: Record<string, string> = {}
  for (const m of form.matchAll(/<input\b[^>]*>/gi)) {
    const tag = m[0]
    const name = atributo(tag, "name")
    if (!name) continue
    const type = (atributo(tag, "type") || "text").toLowerCase()
    if (["submit", "button", "image", "file", "reset"].includes(type)) continue
    if ((type === "radio" || type === "checkbox") && !/\bchecked\b/i.test(tag)) continue
    out[name] = decodificarEntidades(atributo(tag, "value") ?? "").trim()
  }
  for (const m of form.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const name = atributo(`<select ${m[1]}>`, "name")
    if (!name) continue
    let elegido = ""
    for (const o of m[2].matchAll(/<option\b([^>]*)>([^<]*)/gi)) {
      if (/\bselected\b/i.test(o[1])) {
        const v = atributo(`<option ${o[1]}>`, "value") ?? ""
        elegido = v === "" || v === "0" ? "" : textoCelda(o[2])
      }
    }
    out[name] = elegido.startsWith("--") ? "" : elegido
  }
  for (const m of form.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi)) {
    const name = atributo(`<textarea ${m[1]}>`, "name")
    if (name) out[name] = decodificarEntidades(m[2]).trim()
  }
  return out
}

export function parseFichaCliente(html: string): FichaCliente | null {
  const v = valoresFormulario(html, /frm_clientes|grabar_clientes/i)
  if (!v || !("razon_social" in v)) return null
  const g = (k: string) => (v[k] ?? "").trim()
  return {
    razon_social: g("razon_social"),
    cuit: g("cuit"),
    tipo_documento: g("tipo_documento"),
    tipo_iva: g("tipo_iva"),
    direccion: g("direccion"),
    localidad: g("localidad"),
    provincia: g("provincia"),
    cp: g("cp"),
    telefono: g("telefono"),
    email: g("email"),
    contacto: g("contacto"),
    vendedor: g("vendedor"),
    clasificacion: g("clasificacion"),
    categoria: g("categoria"),
    condicion_pago: g("condicion_pago"),
    zona: g("zona"),
  }
}

// ---------------------------------------------------------------------------
// Listado de clientes (export XLSX de listado_clientes.php)
// ---------------------------------------------------------------------------

export type ClienteListado = {
  codigo: number
  razon_social: string
  nombre_norm: string
  direccion: string | null
  localidad: string | null
  provincia: string | null
  cp: string | null
  telefono: string | null
  email: string | null
  vendedor: string | null
  clasificacion: string | null
  categoria: string | null
  estado: string | null
  ultimo_pedido: string | null
}

const nulo = (s: string) => (s.trim() === "" ? null : s.trim())

export function clientesDeListado(filas: Fila[]): ClienteListado[] {
  const out: ClienteListado[] = []
  const vistos = new Set<number>()
  for (const r of filas) {
    const codigo = Number(col(r, "Codigo"))
    if (!Number.isInteger(codigo) || codigo <= 0 || vistos.has(codigo)) continue
    vistos.add(codigo)
    const rs = col(r, "Razon Social").replace(/\s+/g, " ").trim()
    const ape = col(r, "Apellido")
    const nom = col(r, "Nombre")
    const razon = rs || [ape, nom].filter(Boolean).join(" ").trim()
    out.push({
      codigo,
      razon_social: razon,
      nombre_norm: nombreNormalizado(razon),
      direccion: nulo(col(r, "Direccion")),
      localidad: nulo(col(r, "Localidad")),
      provincia: nulo(col(r, "Provincia")),
      cp: nulo(col(r, "Cp")),
      telefono: nulo(col(r, "Telefono")),
      email: nulo(col(r, "Email")),
      vendedor: nulo(col(r, "Vendedor")),
      clasificacion: nulo(col(r, "Clasificacion")),
      categoria: nulo(col(r, "Categoria")),
      estado: nulo(col(r, "Estado")),
      ultimo_pedido: parseFecha(col(r, "Ultimp Ped", "Ultimo Ped")),
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Artículos (export de listado_articulos.php por línea)
// ---------------------------------------------------------------------------

export type Articulo = { codigo: number; nombre: string; linea: string }

export function articulosDeListado(filas: Fila[]): Articulo[] {
  const out: Articulo[] = []
  for (const r of filas) {
    const codigo = Number(col(r, "Codigo"))
    const nombre = col(r, "Nombre").replace(/\s+/g, " ").trim()
    if (!Number.isInteger(codigo) || codigo <= 0 || !nombre) continue
    out.push({ codigo, nombre, linea: col(r, "Linea") })
  }
  return out
}

/** ¿El artículo es hormigón (cuenta para los m³ del acopio)? Los servicios (bomba, fibra, laboratorio…) no. */
export function esHormigon(nombre: unknown, linea?: unknown): boolean {
  const l = String(linea ?? "").toLowerCase()
  if (l.includes("servicio")) return false
  const n = String(nombre ?? "").toUpperCase()
  if (/BOMB|SERVICIO|LABORATORIO|FIBRA|SUPERFLUID|MANO DE OBRA|FLETE|ADITIVO/.test(n)) return false
  return true
}

// ---------------------------------------------------------------------------
// Remitos por renglón (export de reporte_remitosventa.php)
// ---------------------------------------------------------------------------

export type RenglonRemito = {
  fecha: string
  remito: string
  comprobante: "R" | "X" | null
  pedido: string
  cliente: string
  articulo_codigo: number | null
  articulo: string
  m3: number
  deposito: string
  proyecto: string
}

/** "RM 0001-00002337" → R · "RM2 0099-00002743" → X (columna Comprobante o el prefijo del número). */
export function tipoRemito(comprobante: unknown, numero?: unknown): "R" | "X" | null {
  const c = String(comprobante ?? "").trim().toUpperCase()
  const n = String(numero ?? "").trim().toUpperCase()
  const pref = c || (n.match(/^([A-Z]+\d?)\s/) || [])[1] || ""
  if (pref === "RM2") return "X"
  if (pref === "RM") return "R"
  return null
}

/** Número de proyecto normalizado: "pro2 0001-00000013 " → "PRO2 0001-00000013". */
export function numeroProyecto(s: unknown): string {
  return String(s ?? "").toUpperCase().replace(/\s+/g, " ").trim()
}

export function renglonesRemitos(filas: Fila[]): RenglonRemito[] {
  const out: RenglonRemito[] = []
  for (const r of filas) {
    const remito = col(r, "N Remito")
    const fecha = parseFecha(r["Fecha"] ?? col(r, "Fecha"))
    if (!remito || !fecha) continue
    const cod = Number(col(r, "Codigo"))
    out.push({
      fecha,
      remito: remito.replace(/\s+/g, " ").trim(),
      comprobante: tipoRemito(col(r, "Comprobante"), remito),
      pedido: col(r, "N Pedido").replace(/\s+/g, " ").trim(),
      cliente: col(r, "Cliente").replace(/\s+/g, " ").trim(),
      articulo_codigo: Number.isInteger(cod) && cod > 0 ? cod : null,
      articulo: col(r, "Articulo").replace(/\s+/g, " ").trim(),
      m3: parseNumero(r["Cantidad"] ?? col(r, "Cantidad")) ?? 0,
      deposito: col(r, "Deposito"),
      proyecto: numeroProyecto(col(r, "Proyecto")),
    })
  }
  return out
}

export type ResumenRemitosCliente = { r: number; x: number; ultimo: string | null }

/** Por cliente (nombre normalizado): cuántos remitos R y X distintos y la fecha del último. */
export function resumenRemitosPorCliente(renglones: RenglonRemito[]): Map<string, ResumenRemitosCliente> {
  const vistos = new Set<string>()
  const out = new Map<string, ResumenRemitosCliente>()
  for (const g of renglones) {
    const k = nombreNormalizado(g.cliente)
    if (!k) continue
    const acc = out.get(k) || { r: 0, x: 0, ultimo: null }
    if (!vistos.has(g.remito)) {
      vistos.add(g.remito)
      if (g.comprobante === "R") acc.r++
      else if (g.comprobante === "X") acc.x++
    }
    if (!acc.ultimo || g.fecha > acc.ultimo) acc.ultimo = g.fecha
    out.set(k, acc)
  }
  return out
}

/** Remito sugerido para un cliente traído de Zomatik (spec 11.4): solo X → X, solo R → R, los dos → nada. */
export function remitoSugerido(r: number, x: number): "R" | "X" | null {
  if (r > 0 && x === 0) return "R"
  if (x > 0 && r === 0) return "X"
  return null
}

export type Movimiento = {
  proyecto_numero: string
  fecha: string
  remito: string
  pedido: string | null
  articulo_codigo: number
  articulo: string
  m3: number
  deposito: string | null
  es_hormigon: boolean
}

/**
 * Renglones de remito de los proyectos conocidos, agrupados por proyecto + remito + artículo (suma los m³ si un
 * remito trae el mismo artículo dos veces). `lineaDe` da la línea del artículo (para separar servicios).
 */
export function movimientosDeProyectos(
  renglones: RenglonRemito[],
  proyectos: Set<string>,
  lineaDe: (codigo: number) => string | undefined = () => undefined,
): Movimiento[] {
  const m = new Map<string, Movimiento>()
  for (const g of renglones) {
    if (!g.proyecto || !proyectos.has(g.proyecto)) continue
    const cod = g.articulo_codigo ?? 0
    const k = `${g.proyecto}|${g.remito}|${cod}`
    const prev = m.get(k)
    if (prev) {
      prev.m3 = Math.round((prev.m3 + g.m3) * 1000) / 1000
      continue
    }
    m.set(k, {
      proyecto_numero: g.proyecto,
      fecha: g.fecha,
      remito: g.remito,
      pedido: g.pedido || null,
      articulo_codigo: cod,
      articulo: g.articulo,
      m3: g.m3,
      deposito: g.deposito || null,
      es_hormigon: esHormigon(g.articulo, lineaDe(cod)),
    })
  }
  return [...m.values()]
}

// ---------------------------------------------------------------------------
// Proyectos (acopios) — listado_proyectos.php en HTML (trae los links con el código interno)
// ---------------------------------------------------------------------------

export type ProyectoListado = {
  codigo: number
  numero: string
  comprobante: string
  cliente_codigo: number | null
  cliente_nombre: string
  obra: string | null
  fecha: string | null
  /** Lo que le queda de material, en % del material pactado (Zomatik lo lleva en pesos: acá solo el %). */
  saldo_pct: number | null
  estado_zomatik: string
}

/** "FIDEICOMISO LA TERCERA (22812)<br>PAVIMENTO LT 1" → cliente, código y obra. */
export function clienteYObraDeCelda(htmlCelda: string): { cliente: string; codigo: number | null; obra: string | null } {
  const partes = sinComentarios(htmlCelda).split(/<br\s*\/?>/i).map(textoCelda)
  const primera = partes[0] || ""
  const m = primera.match(/^(.*)\((\d+)\)\s*(.*)$/)
  const cliente = (m ? m[1] : primera).trim()
  const codigo = m ? Number(m[2]) : null
  const resto = [m ? m[3] : "", ...partes.slice(1)].map((s) => s.trim()).filter(Boolean).join(" ")
  return { cliente, codigo, obra: resto || null }
}

/** % del material que le queda al proyecto: "Restan Material" sobre "Material + Flete". Redondeado a 0,1 y acotado a ±999. */
export function saldoPorcentaje(materialTotal: number | null, restan: number | null): number | null {
  if (materialTotal === null || restan === null || !(materialTotal > 0)) return null
  const pct = Math.round((restan / materialTotal) * 1000) / 10
  if (!Number.isFinite(pct)) return null
  // Acotado para que un dato raro de Zomatik no tire abajo el grabado (la columna es numeric(6,1))
  return Math.max(-999, Math.min(999, pct))
}

export function parseProyectosHtml(html: string): ProyectoListado[] {
  const limpio = sinComentarios(html)
  const trs = limpio.match(/<tr[\s\S]*?<\/tr>/gi) || []
  const celdas = (tr: string) => tr.match(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/gi) || []
  const interior = (c: string) => c.replace(/^<t[dh]\b[^>]*>/i, "").replace(/<\/t[dh]>$/i, "")
  const enc = trs.find((tr) => /Restan Material/i.test(tr) && /Cliente/i.test(tr))
  const nombres = enc ? celdas(enc).map((c) => textoCelda(interior(c))) : []
  const idx = (re: RegExp, porDefecto: number) => {
    const i = nombres.findIndex((n) => re.test(n))
    return i >= 0 ? i : porDefecto
  }
  const iCod = idx(/^Codigo$/i, 0)
  const iCli = idx(/^Cliente$/i, 2)
  const iFecha = idx(/^Fecha$/i, 4)
  const iMat = idx(/^Material/i, 10)
  const iRest = idx(/^Restan Material/i, 14)
  const iAcc = idx(/^ACCIONES$/i, 24)
  const out: ProyectoListado[] = []
  const vistos = new Set<number>()
  for (const tr of trs) {
    const mc = tr.match(/modificar_proyectos\.php\?codigo=(\d+)/i)
    if (!mc) continue
    const codigo = Number(mc[1])
    if (vistos.has(codigo)) continue
    const cs = celdas(tr)
    if (cs.length < 5) continue
    vistos.add(codigo)
    const txt = (i: number) => (cs[i] ? textoCelda(interior(cs[i])) : "")
    const numero = numeroProyecto(txt(iCod))
    const cli = clienteYObraDeCelda(cs[iCli] ? interior(cs[iCli]) : "")
    // Estado: la celda después de ACCIONES (la separadora en el medio); si no, la última con una sola palabra
    let estado = txt(iAcc + 2)
    if (!/^[A-Za-zÁÉÍÓÚáéíóú]+$/.test(estado)) {
      estado = ""
      for (let i = cs.length - 1; i >= 0; i--) {
        const t = txt(i)
        if (/^(Abierto|Cerrado|Anulado|Finalizado|Pendiente)$/i.test(t)) {
          estado = t
          break
        }
      }
    }
    out.push({
      codigo,
      numero,
      comprobante: (numero.match(/^([A-Z]+\d?)\s/) || [])[1] || "",
      cliente_codigo: cli.codigo,
      cliente_nombre: cli.cliente,
      obra: cli.obra,
      fecha: parseFecha(txt(iFecha)),
      saldo_pct: saldoPorcentaje(parseNumero(txt(iMat)), parseNumero(txt(iRest))),
      estado_zomatik: estado,
    })
  }
  return out
}

/**
 * Renglones pactados de un proyecto (export de exportar_acopio.php?acopio=N). Vacío = proyecto por monto
 * (spec 20.3). Con artículos y cantidades = por m³: devuelve los m³ pactados de hormigón.
 */
export function pactadoDeAcopio(filas: Fila[]): { tipo: "monto" | "cantidades"; m3: number | null } {
  let m3 = 0
  let hay = false
  for (const r of filas) {
    const nombre = col(r, "Articulo", "Nombre", "Descripcion")
    const cant = parseNumero(col(r, "Cantidad"))
    if (!nombre || cant === null || cant <= 0) continue
    hay = true
    if (esHormigon(nombre)) m3 += cant
  }
  return hay ? { tipo: "cantidades", m3: Math.round(m3 * 1000) / 1000 } : { tipo: "monto", m3: null }
}

// ---------------------------------------------------------------------------
// Notas de pedido pendientes (export de listado_pedidos.php con "Pendientes")
// ---------------------------------------------------------------------------

export type NpPendiente = {
  numero: string
  cliente: string
  fecha: string | null
  fecha_entrega: string | null
  estado: string | null
  vendedor: string | null
  deposito: string | null
  origen: string | null
}

/** Sin la columna Total (en pesos): por ahora no se guardan precios (spec 20.1). */
export function npPendientesDeListado(filas: Fila[]): NpPendiente[] {
  const out: NpPendiente[] = []
  const vistos = new Set<string>()
  for (const r of filas) {
    const numero = col(r, "Codigo").replace(/\s+/g, " ").trim().toUpperCase()
    if (!/^NP2?\s/.test(numero) || vistos.has(numero)) continue
    vistos.add(numero)
    out.push({
      numero,
      cliente: col(r, "Cliente").replace(/\s+/g, " ").trim(),
      fecha: parseFecha(r["Fecha"] ?? col(r, "Fecha")),
      fecha_entrega: parseFecha(r["F.Entrega"] ?? col(r, "F.Entrega", "Entrega")),
      estado: nulo(col(r, "Estado")),
      vendedor: nulo(col(r, "Vendedor")),
      deposito: nulo(col(r, "Deposito")),
      origen: nulo(col(r, "Origen")),
    })
  }
  return out
}
