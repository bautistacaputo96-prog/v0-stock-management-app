/**
 * Control de ingresos de materia prima · cruce entre nuestros ingresos (stock_entries) y los remitos de compra de
 * Zomatik (ESTAD R.COMPRA, sucursal REBUCRET). Funciones puras: sin red, sin base y sin React. Se prueban con
 * `npm run test:control-ingresos`.
 *
 * Especificación: docs/control-ingresos-mp.md. Las 4 categorías son las de las planillas de Juan Oreguy:
 *   1. falta_nuestro   está en Zomatik y no en nuestro sistema
 *   2. falta_zomatik   está en nuestro sistema y no en Zomatik (con la nota, si tiene)
 *   3. no_coincide     está en los dos pero no coincide: toneladas (o dígitos invertidos), cargado dos veces,
 *                      otro producto, otra planta u otra fecha
 *   4. numero_mal      el mismo camión y las mismas toneladas con el número mal escrito en uno de los dos
 *                      (un proveedor distinto solo, con el mismo número, material y toneladas, no es diferencia)
 */
import { parseFecha, parseNumero, col, tokensNombre, type Fila } from "@/lib/zomatik/parseo"

// ---------------------------------------------------------------------------
// Parámetros
// ---------------------------------------------------------------------------

/** El control arranca el 01/08/2026; después, siempre los últimos 90 días. */
export const INICIO_CONTROL = "2026-08-01"
export const VENTANA_DIAS = 90
/** Toneladas iguales si difieren en esto o menos. */
export const TOL_TONELADAS = 0.02
/** La fecha puede variar hasta 10 días entre los dos sistemas sin que sea una diferencia (en Zomatik se carga días después). */
export const TOL_FECHA_DIAS = 10
/** Para emparejar un número mal escrito: fecha ±10 días (se prefiere la más cercana). */
export const PAREO_FECHA_DIAS = 10
/** Mismo número de remito en otra fecha: hasta acá se considera el mismo remito (más lejos, es otro). */
export const MISMO_NUMERO_DIAS = 30
/** Lo de los últimos 2 días todavía puede estar por cargarse en el otro sistema: no se avisa que falta. */
export const GRACIA_DIAS = 2
/** "Falta en Zomatik": en Zomatik se carga con atraso, se espera 7 días antes de avisar. */
export const GRACIA_ZOMATIK_DIAS = 7
/** Margen hacia atrás para emparejar lo del borde de la ventana (= la tolerancia de fecha). */
export const MARGEN_DIAS = 10

// ---------------------------------------------------------------------------
// Fechas (AAAA-MM-DD, sin horas)
// ---------------------------------------------------------------------------

export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

export function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000)
}

/** Fecha en Argentina (UTC−3) de un timestamptz o de un instante. */
export function fechaArgentina(v: string | number | Date = Date.now()): string {
  const ms = typeof v === "number" ? v : v instanceof Date ? v.getTime() : Date.parse(v)
  return new Date(ms - 3 * 3600_000).toISOString().slice(0, 10)
}

/** Desde cuándo se controla hoy: el 01/08/2026 o hace 90 días, lo que sea más nuevo. */
export function desdeVentana(hoy: string): string {
  const h = sumarDias(hoy, -VENTANA_DIAS)
  return h > INICIO_CONTROL ? h : INICIO_CONTROL
}

/** "2026-10-20" → "20/10". */
export function ddmm(fecha: string | null | undefined): string {
  if (!fecha) return "-"
  const [, m, d] = fecha.split("-")
  return `${d}/${m}`
}

export type Tramo = { desde: string; hasta: string }

/** Tramos de lectura de Zomatik de 34 días (3 cubren los 90 + 10 de margen), del más nuevo al más viejo. */
export function tramosLectura(desde: string, hoy: string, dias = 34): Tramo[] {
  const out: Tramo[] = []
  for (let hasta = hoy; hasta >= desde; ) {
    const d = sumarDias(hasta, -(dias - 1))
    out.push({ desde: d < desde ? desde : d, hasta })
    hasta = sumarDias(d, -1)
  }
  return out
}

/** Orden de lectura: primero los tramos con días nunca leídos, después los de lectura más vieja (empate: el más nuevo). */
export function ordenTramos(tramos: Tramo[], leidos: Map<string, string>): Tramo[] {
  const peso = (t: Tramo) => {
    let nunca = false
    let viejo = Infinity
    for (let d = t.desde; d <= t.hasta; d = sumarDias(d, 1)) {
      const l = leidos.get(d)
      if (!l) nunca = true
      else viejo = Math.min(viejo, Date.parse(l))
    }
    return { nunca, viejo }
  }
  return tramos
    .map((t, i) => ({ t, i, ...peso(t) }))
    .sort((a, b) => Number(b.nunca) - Number(a.nunca) || a.viejo - b.viejo || a.i - b.i)
    .map((x) => x.t)
}

// ---------------------------------------------------------------------------
// Normalizaciones
// ---------------------------------------------------------------------------

/**
 * Número de remito sin el punto de venta ni los ceros a la izquierda:
 *   "0002-00881597" → "881597" · "00002-  00319166" → "319166" · "0109  00166837" → "166837" · "00880960" → "880960"
 *   "000200881597" (sin separador, 12 dígitos) → "881597" · "0000-00000000" / "000000" / "" → null (sin número)
 *   Zomatik antepone el tipo de comprobante: "RMP 0002-00318903" → "318903".
 */
export function normalizarRemito(remito: unknown): string | null {
  const grupos = sinPrefijoRemito(remito).match(/\d+/g) || []
  if (!grupos.length) return null
  let n = grupos[grupos.length - 1]
  if (grupos.length === 1 && n.length >= 12) n = n.slice(-8)
  n = n.replace(/^0+/, "")
  return n || null
}

/** "RMP 0002-00318903" → "0002-00318903" (Zomatik antepone el tipo de comprobante). */
export const sinPrefijoRemito = (remito: unknown) => String(remito ?? "").trim().replace(/^[A-Za-z]{1,4}\.?\s+(?=\d)/, "")

const sinTildes = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()

/**
 * Material comparable entre los dos sistemas. Nuestros nombres ("Piedra Partida 6/20", "CPC 40") y los artículos de
 * Zomatik ("PIEDRA PARTIDA 6-20", "CEMENTO CPC40 GRANEL") van a la misma clave. null = no es materia prima (gasoil,
 * repuestos…): no se controla.
 */
export function claveMaterial(nombre: unknown): string | null {
  // Los artículos de Zomatik vienen con el prefijo "CCTS " (también los de REBUCRET): no cuenta
  const t = sinTildes(nombre).replace(/\s+/g, " ").replace(/^\s*CCTS\s+/, "")
  if (!t.trim()) return null
  const medida = (a: number, b: number) => new RegExp(`(^|[^0-9])0?${a}\\s*[-/]\\s*${b}([^0-9]|$)`).test(t)
  if (/ARENA/.test(t)) return /TRIT/.test(t) || medida(0, 6) ? "arena_0_6" : "arena_fina"
  // "PIEDRA 06" (sin la otra medida) es la 0/6 de trituración, no una piedra
  if (/\bPIEDRA\s+0\s*6\b(?!\s*[-/])/.test(t)) return "arena_0_6"
  if (medida(6, 12)) return "piedra_6_12"
  if (medida(6, 20) || medida(6, 19)) return "piedra_6_20"
  if (medida(10, 30)) return "piedra_10_30"
  if (/PIEDRA|GRANZA|TRITURADO/.test(t)) return "piedra"
  if (/CEMENTO|\bCP[CNF]\b|\bCP[CNF]\s*\d|PORTLAND/.test(t)) return "cemento"
  if (/90\s*E\b/.test(t)) return "sikament_90e"
  if (/33\s*S\b/.test(t)) return "sikament_33s"
  if (/SUPERFLUID|PLASTIFIC/.test(t)) return "superfluidificante"
  if (/ESPUM/.test(t)) return "espumigeno"
  if (/FIBRA|MACROFLEX/.test(t)) return "fibra"
  if (/ADITIVO|SIKA/.test(t)) return "aditivo"
  return null
}

/**
 * Artículos de Zomatik por código (ESTAD R.COMPRA de REBUCRET, 20 al 27/10/2026). Manda sobre el nombre.
 *   10000004 CCTS ARENA ESPECIAL → Arena Fina · 10000026 CCTS CEMENTO GRANEL → CPC 40 · 10000005 PIEDRA 6-20
 *   10000001 CCTS PIEDRA 06 → Arena Trituración 0/6 · 10000612 PIEDRA 6-12
 */
export const CODIGOS_ARTICULO: Record<string, string> = {
  "10000004": "arena_fina", // CCTS ARENA ESPECIAL
  "10000026": "cemento", // CCTS CEMENTO GRANEL
  "10000005": "piedra_6_20", // PIEDRA 6-20
  "10000001": "arena_0_6", // CCTS PIEDRA 06 = nuestra Arena Trituración 0/6 (primera corrida, 28/10)
  "10000612": "piedra_6_12", // PIEDRA 6-12
}

/** Material de un renglón de Zomatik: por código y, si no está, por el nombre del artículo. null = sin material. */
export function materialZomatik(articulo: unknown, codigo?: unknown): string | null {
  const c = String(codigo ?? "").trim()
  return CODIGOS_ARTICULO[c] || claveMaterial(articulo)
}

const NOMBRE_MATERIAL: Record<string, string> = {
  arena_fina: "Arena fina",
  arena_0_6: "Arena 0/6",
  piedra_6_12: "Piedra 6/12",
  piedra_6_20: "Piedra 6/20",
  piedra_10_30: "Piedra 10/30",
  piedra: "Piedra",
  cemento: "Cemento",
  sikament_90e: "Sikament 90E",
  sikament_33s: "Sikament 33S",
  superfluidificante: "Superfluidificante",
  espumigeno: "Espumígeno",
  fibra: "Fibra",
  aditivo: "Aditivo",
}
export const nombreMaterial = (clave: string | null) => (clave ? NOMBRE_MATERIAL[clave] || clave : "-")

/** Los que se comparan en toneladas (áridos y cemento). Los aditivos y la fibra, en su unidad. */
export const enToneladas = (clave: string | null) => !!clave && /^(arena|piedra|cemento)/.test(clave)

/**
 * Toneladas de un renglón. Los ingresos dicen kg, pero hay quien carga toneladas (32,76 en vez de 32760): menos de 200
 * se toma como toneladas. Lo mismo para Zomatik.
 */
export function toneladas(cantidad: number): { t: number; cargadoEnT: boolean } {
  if (!Number.isFinite(cantidad)) return { t: 0, cargadoEnT: false }
  return cantidad < 200 ? { t: cantidad, cargadoEnT: true } : { t: cantidad / 1000, cargadoEnT: false }
}

/** "39,24" y "39,42": los mismos dígitos en otro orden. */
export function digitosInvertidos(a: number, b: number): boolean {
  const x = a.toFixed(2).replace(".", "")
  const y = b.toFixed(2).replace(".", "")
  if (x === y || x.length !== y.length) return false
  return [...x].sort().join("") === [...y].sort().join("")
}

const GENERICAS = new Set(["MATERIALES", "CEMENTOS", "CANTERA", "CANTERAS", "ARGENTINA", "SAIC", "SAICF", "HNOS", "HERMANOS", "TRANSPORTE", "TRANSPORTES"])

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  const v = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = v[0]
    v[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = v[j]
      v[j] = Math.min(v[j] + 1, v[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return v[b.length]
}

/** Proveedores que son el mismo para el control: Fenomix distribuye el cemento de Cementos Avellaneda. */
const ALIAS_PROVEEDOR: { grupo: string; re: RegExp }[] = [{ grupo: "avellaneda", re: /FENOMIX|AVELLANEDA/ }]
const grupoProveedor = (s: unknown) => {
  const t = sinTildes(s)
  return ALIAS_PROVEEDOR.find((x) => x.re.test(t))?.grupo || null
}

/**
 * ¿Es el mismo proveedor? "GUERRICO" = "Gerrico" = "GUERRICO S.A." · "CEMENTOS AVELLANEDA" ≠ "FENOMIX MATERIALES".
 * null si falta alguno de los dos (no se puede decir).
 */
export function mismoProveedor(a: unknown, b: unknown): boolean | null {
  const ga = grupoProveedor(a)
  if (ga && ga === grupoProveedor(b)) return true
  const ta = tokensNombre(a).filter((t) => t.length > 2)
  const tb = tokensNombre(b).filter((t) => t.length > 2)
  if (!ta.length || !tb.length) return null
  const fa = ta.filter((t) => !GENERICAS.has(t))
  const fb = tb.filter((t) => !GENERICAS.has(t))
  const A = fa.length ? fa : ta
  const B = fb.length ? fb : tb
  return A.some((x) => B.some((y) => x === y || (x.length >= 5 && y.length >= 5 && levenshtein(x, y) <= 2) || (x.length >= 4 && y.length >= 4 && (x.startsWith(y) || y.startsWith(x)))))
}

/** Proveedores de una diferencia para mostrar: uno si son el mismo ("BLINKI" y "BLINKI S.A."), todos si no. */
export function proveedoresTexto(ls: { proveedor: string | null }[]): string {
  const out: string[] = []
  for (const l of ls) if (l.proveedor && l.proveedor.trim() && !out.some((o) => mismoProveedor(o, l.proveedor) !== false)) out.push(l.proveedor.trim())
  return out.join(" / ") || "-"
}

/** ¿Un número parece el otro mal escrito? (uno termina en el otro, o cambian 1 o 2 dígitos). */
export function numerosParecidos(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  if (a.endsWith(b) || b.endsWith(a)) return true
  return a.length === b.length && levenshtein(a, b) <= 2
}

// ---------------------------------------------------------------------------
// Entradas
// ---------------------------------------------------------------------------

/** Un ingreso nuestro (stock_entries), ya con la planta, el material, el proveedor y el transportista por nombre. */
export type IngresoNuestro = {
  id: string
  fecha: string
  plantaId: string | null
  planta: string
  material: string
  cantidad: number
  remito: string | null
  proveedor: string | null
  transportista: string | null
  notas: string | null
  cargadoPor: string | null
}

/** Un renglón de la copia de Zomatik (zomatik_remitos_compra). */
export type RemitoZomatik = {
  clave: string
  fecha: string
  plantaId: string | null
  planta: string
  articulo: string
  codigo?: string | null
  cantidad: number
  remito: string
  proveedor: string | null
  transportista: string | null
}

/** Depósitos de Zomatik de cada planta (zomatik.md 4 y 24: Canning 116, REBUCRET = Hudson 113). */
export const DEPOSITOS = [
  { id: 116, planta: "Canning", nombre: /CANNING/i },
  { id: 113, planta: "Hudson", nombre: /REBUCRET|HUDSON/i },
] as const

/** Columnas del export que nunca se guardan (precios y montos: lectura.ts, "nunca se guarda un precio"). */
const COLUMNA_PRECIO = /p\.?\s*unit|precio|total|importe|neto|iva|monto|subtotal|valor/i

/** Renglón del export de ESTAD R.COMPRA → fila de la copia (sin precios). null = total del reporte o sin datos. */
export function renglonCompra(row: Fila, deposito: number | null): {
  fecha: string
  remito: string
  remito_norm: string | null
  orden_compra: string | null
  proveedor: string | null
  codigo_articulo: string | null
  articulo: string
  cantidad: number
  transportista: string | null
  deposito: number | null
  /** La columna "Depósito" del export (si viene). */
  deposito_texto: string | null
  datos: Record<string, string | number>
} | null {
  const remito = col(row, "N Remito", "Nro Remito", "Remito")
  const articulo = col(row, "Articulo", "Artículo", "Descripcion")
  const fecha = parseFecha(row["Fecha"] ?? col(row, "Fecha"))
  const cantidad = parseNumero(row["Cantidad"] ?? col(row, "Cantidad"))
  // La última fila del reporte es el total general: no tiene remito ni artículo
  if (!remito || !articulo || !fecha || cantidad === null) return null
  const datos: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(row)) if (!COLUMNA_PRECIO.test(k)) datos[k] = v
  const valor = (re: RegExp) => {
    const k = Object.keys(row).find((x) => re.test(x) && !COLUMNA_PRECIO.test(x))
    return k ? String(row[k] ?? "").trim() : ""
  }
  // "Transporte" y "Chofer" (el "Valor Flete" es un monto: no se guarda)
  const transportista = [valor(/^\s*transp/i), valor(/chofer/i)].filter(Boolean).join(" · ") || null
  return {
    fecha,
    remito,
    remito_norm: normalizarRemito(remito),
    orden_compra: col(row, "Nº OC", "N° OC", "N Oc", "Nro OC", "Orden de compra") || null,
    proveedor: col(row, "Proveedor") || null,
    codigo_articulo: col(row, "Codigo", "Código") || null,
    articulo,
    cantidad,
    transportista,
    deposito,
    deposito_texto: valor(/dep[oó]sito/i) || null,
    datos,
  }
}

/** Identidad de un renglón para comparar lecturas (el export no trae un id). */
export const firmaRenglon = (r: { fecha: string; remito: string; codigo_articulo: string | null; articulo: string; cantidad: number; proveedor: string | null }) =>
  [r.fecha, r.remito.replace(/\s+/g, ""), r.codigo_articulo || r.articulo, r.cantidad, sinTildes(r.proveedor).replace(/[^A-Z0-9]/g, "")].join("|")

/**
 * Filas de la copia para un tramo: las de cada depósito con su planta, y las que solo aparecen leyendo todos los
 * depósitos (se cargaron en otro depósito) sin planta. `clave` es estable entre lecturas mientras el renglón no cambie.
 */
export function filasCopia(porDeposito: { deposito: number; filas: Fila[] }[], todos: Fila[] | null): ReturnType<typeof renglonCompra>[] {
  const out: NonNullable<ReturnType<typeof renglonCompra>>[] = []
  const vistos = new Map<string, number>()
  for (const d of porDeposito)
    for (const f of d.filas) {
      const r = renglonCompra(f, d.deposito)
      if (!r) continue
      out.push(r)
      const k = firmaRenglon(r)
      vistos.set(k, (vistos.get(k) || 0) + 1)
    }
  for (const f of todos || []) {
    const r = renglonCompra(f, null)
    if (!r) continue
    const k = firmaRenglon(r)
    const n = vistos.get(k) || 0
    if (n > 0) vistos.set(k, n - 1)
    else out.push(r)
  }
  return out
}

/**
 * ¿El tramo leído parece de otra sucursal? Sin mirar el nombre del artículo (REBUCRET también usa "CCTS"): solo si
 * Canning y Hudson vinieron vacíos y "todos" trae renglones cuya columna Depósito es Canning o REBUCRET (el filtro de
 * depósito no anduvo o la sucursal cambió). Sin la columna Depósito no se rechaza: queda la confirmación de la página.
 */
export function motivoRechazoTramo(porDeposito: { deposito: number; filas: Fila[] }[], todos: Fila[]): string | null {
  const nuestras = porDeposito.reduce((n, d) => n + d.filas.filter((f) => renglonCompra(f, d.deposito)).length, 0)
  if (nuestras > 0) return null
  const deNuestrosDepositos = todos
    .map((f) => renglonCompra(f, null))
    .filter((r) => r && r.deposito_texto && DEPOSITOS.some((d) => d.nombre.test(r.deposito_texto!))).length
  return deNuestrosDepositos > 0 ? `Canning y Hudson vinieron vacíos y "todos" trajo ${deNuestrosDepositos} renglones de esos depósitos (¿otra sucursal?)` : null
}

/** Muestra de lo leído para diagnosticar (sin precios): columnas, depósitos, artículos, series de OC y decimales. */
export function muestraLectura(porDeposito: { deposito: number; filas: Fila[] }[], todos: Fila[]) {
  const filas = [...porDeposito.flatMap((d) => d.filas.map((f) => renglonCompra(f, d.deposito))), ...todos.map((f) => renglonCompra(f, null))].filter(
    (r): r is NonNullable<ReturnType<typeof renglonCompra>> => !!r,
  )
  const contar = (xs: string[]) => Object.fromEntries([...xs.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]).slice(0, 20))
  const una = porDeposito.find((d) => d.filas.length)?.filas[0] || todos[0]
  return {
    renglones: Object.fromEntries([...porDeposito.map((d) => [String(d.deposito), d.filas.length]), ["todos", todos.length]]),
    columnas: una ? Object.keys(una).filter((k) => !COLUMNA_PRECIO.test(k)) : [],
    depositos: contar(filas.map((r) => r.deposito_texto || "(sin columna)")),
    articulos: contar(filas.map((r) => `${r.codigo_articulo || "-"} ${r.articulo} → ${materialZomatik(r.articulo, r.codigo_articulo) || "sin material"}`)),
    series_oc: contar(filas.map((r) => (r.orden_compra || "").replace(/\d{4,}$/, "…") || "(sin OC)")),
    con_decimales: filas.filter((r) => !Number.isInteger(r.cantidad)).length,
  }
}

/** Artículos de la copia que no se pudieron llevar a un material nuestro (no se controlan: van a una lista aparte). */
export function articulosSinMaterial(filas: { articulo: string; codigo?: string | null; fecha: string }[]): { articulo: string; codigo: string | null; renglones: number; ultima: string }[] {
  const m = new Map<string, { articulo: string; codigo: string | null; renglones: number; ultima: string }>()
  for (const f of filas) {
    if (materialZomatik(f.articulo, f.codigo)) continue
    const k = `${f.codigo || ""}|${f.articulo}`
    const x = m.get(k) || { articulo: f.articulo, codigo: f.codigo || null, renglones: 0, ultima: f.fecha }
    x.renglones++
    if (f.fecha > x.ultima) x.ultima = f.fecha
    m.set(k, x)
  }
  return [...m.values()].sort((a, b) => b.renglones - a.renglones || a.articulo.localeCompare(b.articulo))
}

/** Clave estable de cada fila de la copia: depósito + firma + orden entre renglones idénticos. */
export function conClaves<T extends NonNullable<ReturnType<typeof renglonCompra>>>(filas: T[]): (T & { clave: string })[] {
  const n = new Map<string, number>()
  return filas.map((r) => {
    const base = `${r.deposito ?? "otro"}|${firmaRenglon(r)}`
    const k = (n.get(base) || 0) + 1
    n.set(base, k)
    return { ...r, clave: `${base}|${k}` }
  })
}

// ---------------------------------------------------------------------------
// Cruce
// ---------------------------------------------------------------------------

export type Categoria = "falta_nuestro" | "falta_zomatik" | "no_coincide" | "numero_mal"
export type TipoDiferencia = "falta" | "toneladas" | "digitos" | "duplicado_nuestro" | "duplicado_zomatik" | "producto" | "planta" | "fecha" | "numero" | "proveedor"

export const CATEGORIAS: { clave: Categoria; titulo: string }[] = [
  { clave: "falta_nuestro", titulo: "Falta en nuestro sistema (está en Zomatik)" },
  { clave: "falta_zomatik", titulo: "Falta en Zomatik (está en nuestro sistema)" },
  { clave: "no_coincide", titulo: "Está en los dos pero no coincide" },
  { clave: "numero_mal", titulo: "Mismo camión y toneladas, número mal escrito" },
]

/** Lo que se muestra de cada lado (en el mail, en la pantalla y en la tabla de diferencias). */
export type Lado = {
  ref: string
  fecha: string
  planta: string
  material: string
  t: number
  /** "t" = toneladas · "kg" = kg o litros de nuestro material · "" = unidad de Zomatik sin confirmar (no se compara). */
  unidad: "t" | "kg" | ""
  remito: string | null
  proveedor: string | null
  transportista: string | null
  notas?: string | null
  cargadoPor?: string | null
  cargadoEnT?: boolean
}

export type Diferencia = {
  clave: string
  categoria: Categoria
  tipo: TipoDiferencia
  fecha: string
  plantaId: string | null
  detalle: string
  nuestro: Lado[]
  zomatik: Lado[]
}

type Item = Lado & { lado: "n" | "z"; plantaId: string | null; mat: string | null; nro: string | null; comparaT: boolean; usado: boolean }

const fmtT = (t: number) => t.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const cant = (i: Lado) => (i.unidad === "t" ? `${fmtT(i.t)} t` : `${i.t.toLocaleString("es-AR")}${i.unidad ? ` ${i.unidad}` : ""}`)

function itemNuestro(n: IngresoNuestro): Item {
  const mat = claveMaterial(n.material)
  const comparaT = enToneladas(mat)
  const { t, cargadoEnT } = toneladas(n.cantidad)
  return {
    lado: "n",
    ref: n.id,
    fecha: n.fecha,
    plantaId: n.plantaId,
    planta: n.planta,
    material: mat ? nombreMaterial(mat) : n.material,
    mat,
    t: comparaT ? t : n.cantidad,
    unidad: comparaT ? "t" : "kg",
    remito: n.remito,
    nro: normalizarRemito(n.remito),
    proveedor: n.proveedor,
    transportista: n.transportista,
    notas: n.notas,
    cargadoPor: n.cargadoPor,
    cargadoEnT: comparaT && cargadoEnT,
    comparaT,
    usado: false,
  }
}

function itemZomatik(z: RemitoZomatik): Item {
  const mat = materialZomatik(z.articulo, z.codigo)
  const comparaT = enToneladas(mat)
  return {
    lado: "z",
    ref: z.clave,
    fecha: z.fecha,
    plantaId: z.plantaId,
    planta: z.planta,
    material: mat ? nombreMaterial(mat) : z.articulo,
    mat,
    t: comparaT ? toneladas(z.cantidad).t : z.cantidad,
    unidad: comparaT ? "t" : "",
    remito: z.remito,
    nro: normalizarRemito(z.remito),
    proveedor: z.proveedor,
    transportista: z.transportista,
    comparaT,
    usado: false,
  }
}

const lado = (i: Item): Lado => {
  const { lado: _l, plantaId: _p, mat: _m, nro: _n, comparaT: _c, usado: _u, ...resto } = i
  return resto
}

const igualesT = (a: Item, b: Item) => Math.abs(a.t - b.t) <= (a.comparaT ? TOL_TONELADAS : Math.max(TOL_TONELADAS, Math.abs(a.t) * 0.01)) + 1e-9
const distProv = (a: Item, b: Item) => mismoProveedor(a.proveedor, b.proveedor) === false

/** ¿Pueden ser el mismo remito dos renglones con el mismo número? (mismo material o mismo proveedor, ±30 días) */
const mismoRemito = (a: Item, b: Item) => Math.abs(diasEntre(a.fecha, b.fecha)) <= MISMO_NUMERO_DIAS && (a.mat === b.mat || !distProv(a, b))

/** Qué no coincide en un par con el mismo número. Vacío = coinciden. */
function diferenciasDelPar(a: Item, z: Item): { tipo: TipoDiferencia; texto: string }[] {
  const out: { tipo: TipoDiferencia; texto: string }[] = []
  // Aditivos y fibra: la unidad de Zomatik no está confirmada, no se comparan las cantidades (solo número y fecha)
  if (a.comparaT && z.comparaT && !igualesT(a, z)) {
    const inv = a.comparaT && digitosInvertidos(a.t, z.t)
    out.push({ tipo: inv ? "digitos" : "toneladas", texto: `${inv ? "Dígitos invertidos" : "Toneladas distintas"}: ${cant(a)} en el nuestro y ${cant(z)} en Zomatik` })
  }
  if (a.mat !== z.mat) out.push({ tipo: "producto", texto: `Otro producto: ${a.material} en el nuestro y ${z.material} en Zomatik` })
  if (a.plantaId !== z.plantaId) out.push({ tipo: "planta", texto: `Otra planta: ${a.planta} el ${ddmm(a.fecha)} en el nuestro y ${z.planta} el ${ddmm(z.fecha)} en Zomatik` })
  // La fecha sola no es diferencia (Bautista, 28/10): en Zomatik se carga días después
  return out
}

function textoProveedor(a: Item, z: Item) {
  return `Otro proveedor: ${a.proveedor || "-"} en el nuestro y ${z.proveedor || "-"} en Zomatik`
}

/** Empareja greedy por puntaje (menor = mejor). */
function emparejar(A: Item[], Z: Item[], puntaje: (a: Item, z: Item) => number | null): [Item, Item][] {
  const cands: { a: Item; z: Item; p: number }[] = []
  for (const a of A) for (const z of Z) {
    const p = puntaje(a, z)
    if (p !== null) cands.push({ a, z, p })
  }
  cands.sort((x, y) => x.p - y.p || (x.a.ref < y.a.ref ? -1 : 1) || (x.z.ref < y.z.ref ? -1 : 1))
  const pares: [Item, Item][] = []
  for (const c of cands) {
    if (c.a.usado || c.z.usado) continue
    c.a.usado = true
    c.z.usado = true
    pares.push([c.a, c.z])
  }
  return pares
}

const claveDe = (cat: Categoria, tipo: TipoDiferencia, items: Item[]) => `${cat}:${tipo}:${items.map((i) => `${i.lado}:${i.ref}`).sort().join(",")}`

export type OpcionesCruce = {
  hoy: string
  desde?: string
  /** ¿Ese día de Zomatik está leído (y fresco)? Sin esto, todos. Solo se informa lo que se puede controlar. */
  cubierto?: (fecha: string) => boolean
}

/**
 * ¿Se puede controlar algo con estas fechas? Tiene que tener alguna desde `desde` y Zomatik leído desde 10 días antes
 * hasta 10 días después (la fecha puede variar ±10 días), sin pasar de hoy ni del margen de lectura.
 */
export function evaluable(fechas: string[], o: OpcionesCruce): boolean {
  if (!fechas.length) return false
  const desde = o.desde || desdeVentana(o.hoy)
  const f = [...fechas].sort()
  if (f[f.length - 1] < desde) return false
  if (!o.cubierto) return true
  const piso = sumarDias(desde, -MARGEN_DIAS)
  let d = sumarDias(f[0], -TOL_FECHA_DIAS)
  if (d < piso) d = piso
  const tope = sumarDias(f[f.length - 1], TOL_FECHA_DIAS) > o.hoy ? o.hoy : sumarDias(f[f.length - 1], TOL_FECHA_DIAS)
  for (; d <= tope; d = sumarDias(d, 1)) if (!o.cubierto(d)) return false
  return true
}

/** Fechas de los renglones de una diferencia guardada. */
export const fechasDe = (d: { fecha: string; nuestro?: { fecha: string }[] | null; zomatik?: { fecha: string }[] | null }) => {
  const fs = [...(d.nuestro || []), ...(d.zomatik || [])].map((l) => l.fecha).filter(Boolean)
  return fs.length ? fs : [d.fecha]
}

/**
 * Cruza los dos sistemas. `nuestros` y `zomatik` pueden traer de más hacia atrás (MARGEN_DIAS) para emparejar el borde;
 * solo se informan las diferencias con algo desde `desde`.
 *
 * 1. Mismo número normalizado: se emparejan (mismo material o mismo proveedor, ±30 días) y se mira qué no coincide.
 * 2. Cargado dos veces: lo que quedó suelto y tiene otro renglón con su mismo número del mismo lado (antes del paso 3
 *    si el hermano ya tiene par; si no, después).
 * 3. Número mal escrito: lo que quedó suelto se empareja por material, ±2 días y toneladas iguales (±0,02), en
 *    cualquier planta (mejor la misma).
 * 4. Lo que queda: falta en el otro sistema ("falta en Zomatik" después de 7 días; "falta en nuestro sistema", de 2).
 * Por ahora solo áridos y cemento: Zomatik no trae aditivos ni fibra en 116 y 113.
 */
export function cruzar(nuestros: IngresoNuestro[], zomatik: RemitoZomatik[], opts: OpcionesCruce): Diferencia[] {
  const hoy = opts.hoy
  const desde = opts.desde || desdeVentana(hoy)
  // Por ahora se controlan áridos y cemento: Zomatik no trae aditivos ni fibra en los depósitos 116 y 113 (28/10)
  const N = nuestros.map(itemNuestro).filter((i) => i.comparaT)
  const Z = zomatik.map(itemZomatik).filter((z) => z.comparaT)
  const out: Diferencia[] = []
  const agregar = (categoria: Categoria, tipo: TipoDiferencia, items: Item[], detalle: string) => {
    if (!evaluable(items.map((i) => i.fecha), { ...opts, desde })) return
    const n = items.filter((i) => i.lado === "n")
    const z = items.filter((i) => i.lado === "z")
    out.push({
      clave: claveDe(categoria, tipo, items),
      categoria,
      tipo,
      fecha: (n[0] || z[0]).fecha,
      plantaId: (n[0] || z[0]).plantaId,
      detalle,
      nuestro: n.map(lado),
      zomatik: z.map(lado),
    })
  }

  // 1. Mismo número
  const porNro = new Map<string, { n: Item[]; z: Item[] }>()
  for (const i of [...N, ...Z]) {
    if (!i.nro) continue
    const g = porNro.get(i.nro) || { n: [], z: [] }
    ;(i.lado === "n" ? g.n : g.z).push(i)
    porNro.set(i.nro, g)
  }
  const pares: [Item, Item][] = []
  for (const g of porNro.values()) {
    if (!g.n.length || !g.z.length) continue
    pares.push(
      ...emparejar(g.n, g.z, (a, z) => {
        if (!mismoRemito(a, z)) return null
        return (a.mat === z.mat ? 0 : 4) + (distProv(a, z) ? 2 : 0) + (a.plantaId === z.plantaId ? 0 : 1) + (!a.comparaT || igualesT(a, z) ? 0 : 1) + Math.min(Math.abs(diasEntre(a.fecha, z.fecha)), 30) / 30
      }),
    )
  }
  for (const [a, z] of pares) {
    const difs = diferenciasDelPar(a, z)
    if (difs.length) {
      const prov = distProv(a, z) ? [textoProveedor(a, z)] : []
      agregar("no_coincide", difs[0].tipo, [a, z], [...difs.map((d) => d.texto), ...prov].join(" · "))
    }
    // Mismo número, material y toneladas: un proveedor distinto solo nunca es diferencia
  }

  // 3. Cargado dos veces (del mismo lado, mismo número). Primero los que tienen un hermano ya emparejado (es más
  //    probable que sea una carga repetida que un número mal escrito); los demás, después del paso 2.
  const parDe = new Map<Item, Item>()
  const anotarPares = (ps: [Item, Item][]) => {
    for (const [a, z] of ps) {
      parDe.set(a, z)
      parDe.set(z, a)
    }
  }
  const duplicados = (soloConPar: boolean) => {
    for (const [ladoDup, todos] of [["n", N], ["z", Z]] as const) {
      const hechos = new Set<Item>()
      for (const u of todos) {
        if (u.usado || !u.nro || hechos.has(u)) continue
        const grupo = todos.filter((o) => o.nro === u.nro && (o === u || mismoRemito(o, u)) && !hechos.has(o))
        if (grupo.length < 2) continue
        if (soloConPar && !grupo.some((g) => parDe.has(g))) continue
        for (const g of grupo) {
          hechos.add(g)
          g.usado = true
        }
        const otros = grupo.map((g) => parDe.get(g)).filter((x): x is Item => !!x)
        const extra: string[] = []
        const plantas = [...new Set(grupo.map((g) => g.planta))]
        if (plantas.length > 1) extra.push(`en ${plantas.join(" y ")}`)
        if (!otros.length) extra.push(`y no está en ${ladoDup === "n" ? "Zomatik" : "nuestro sistema"}`)
        // Un remito partido en dos renglones (0002 y 0022) que suman lo del otro sistema: se dice, es una sola diferencia
        const suma = grupo.reduce((t, g) => t + g.t, 0)
        if (otros.length === 1 && grupo.every((g) => g.comparaT) && Math.abs(suma - otros[0].t) <= TOL_TONELADAS + 1e-9)
          extra.push(`en ${grupo.length} renglones que suman ${fmtT(suma)} t, igual que ${ladoDup === "n" ? "Zomatik" : "el nuestro"}`)
        const donde = ladoDup === "n" ? "nuestro sistema" : "Zomatik"
        agregar("no_coincide", ladoDup === "n" ? "duplicado_nuestro" : "duplicado_zomatik", [...grupo, ...otros], `Cargado ${grupo.length} veces en ${donde} (Nº ${u.nro})${extra.length ? ` ${extra.join(", ")}` : ""}`)
      }
    }
  }
  anotarPares(pares)
  duplicados(true)

  // 2. Número mal escrito: mismo material, ±2 días, mismas toneladas
  const sueltosN = () => N.filter((i) => !i.usado)
  const sueltosZ = () => Z.filter((i) => !i.usado)
  const fuzzy = emparejar(sueltosN(), sueltosZ(), (a, z) => {
    if (!a.mat || a.mat !== z.mat) return null
    const dd = Math.abs(diasEntre(a.fecha, z.fecha))
    if (dd > PAREO_FECHA_DIAS) return null
    // En toneladas: mismas toneladas. Aditivos y fibra (unidad sin confirmar): misma planta y fecha, sin cantidad
    if (a.comparaT ? !igualesT(a, z) : a.plantaId !== z.plantaId) return null
    const num = !a.nro || !z.nro ? 0.05 : numerosParecidos(a.nro, z.nro) ? 0 : 0.3
    return (a.plantaId === z.plantaId ? 0 : 1) + (distProv(a, z) ? 0.5 : 0) + dd * 0.05 + num + (a.comparaT ? Math.abs(a.t - z.t) : 0)
  })
  for (const [a, z] of fuzzy) {
    // Sin número en los dos ("000000" y "0000-00000000"), misma planta y proveedor: no hay nada mal escrito
    if (!a.nro && !z.nro && a.plantaId === z.plantaId && !distProv(a, z)) continue
    // Mismo número (aditivos y fibra emparejados por fecha) y misma planta: coinciden
    if (a.nro && a.nro === z.nro && a.plantaId === z.plantaId && !distProv(a, z)) continue
    const notas = [`Nº ${a.remito || "sin número"} en el nuestro y ${z.remito || "sin número"} en Zomatik`]
    if (a.plantaId !== z.plantaId) notas.push(`${a.planta} en el nuestro y ${z.planta} en Zomatik`)
    if (distProv(a, z)) notas.push(textoProveedor(a, z))
    agregar("numero_mal", "numero", [a, z], notas.join(" · "))
  }
  anotarPares(fuzzy)
  duplicados(false)

  // 4. Falta en el otro sistema
  const limite = sumarDias(hoy, -GRACIA_DIAS)
  const limiteZomatik = sumarDias(hoy, -GRACIA_ZOMATIK_DIAS)
  for (const a of sueltosN()) if (a.fecha <= limiteZomatik) agregar("falta_zomatik", "falta", [a], a.notas ? `Nota: ${a.notas.replace(/\s+/g, " ")}` : "")
  for (const z of sueltosZ()) if (z.fecha <= limite) agregar("falta_nuestro", "falta", [z], "")

  // Si un renglón está en un "cargado dos veces", su par no se informa aparte (sería la misma diferencia dos veces)
  const enDuplicados = new Set(out.filter((d) => d.tipo === "duplicado_nuestro" || d.tipo === "duplicado_zomatik").flatMap((d) => [...d.nuestro, ...d.zomatik].map((l) => l.ref)))
  for (let i = out.length - 1; i >= 0; i--) {
    const d = out[i]
    if (d.tipo.startsWith("duplicado")) continue
    const refs = [...d.nuestro, ...d.zomatik].map((l) => l.ref)
    if (refs.length > 1 && refs.every((r) => enDuplicados.has(r))) out.splice(i, 1)
  }
  const orden = new Map(CATEGORIAS.map((c, i) => [c.clave, i]))
  return out.sort((x, y) => orden.get(x.categoria)! - orden.get(y.categoria)! || (x.fecha < y.fecha ? -1 : x.fecha > y.fecha ? 1 : 0) || (x.clave < y.clave ? -1 : 1))
}

// ---------------------------------------------------------------------------
// Estado de las diferencias entre corridas
// ---------------------------------------------------------------------------

export type Estado = "abierta" | "revisada" | "resuelta"
export type Guardada = { id: string; clave: string; estado: Estado; revisada_at?: string | null; fecha?: string; nuestro?: { fecha: string }[] | null; zomatik?: { fecha: string }[] | null }

/**
 * Qué hacer con la tabla de diferencias después de un cruce:
 *   - nuevas: no estaban: se abren;
 *   - reabiertas: estaban resueltas y volvieron: abiertas, o revisadas (con su nota) si alguien ya las había revisado;
 *   - siguen: estaban abiertas o revisadas: se actualiza el detalle y quedan como estaban (revisada no vuelve al mail);
 *   - resueltas: estaban abiertas o revisadas, se pueden controlar (`evaluableG`: dentro de la ventana y con Zomatik
 *     leído) y el cruce ya no las encuentra (alguien corrigió). Las que salieron de la ventana o no se pudieron
 *     controlar quedan como estaban.
 */
export function planDeEstados(
  actuales: Diferencia[],
  guardadas: Guardada[],
  evaluableG: (g: Guardada) => boolean = () => true,
): { nuevas: Diferencia[]; reabiertas: { id: string; d: Diferencia; revisada: boolean }[]; siguen: { id: string; d: Diferencia }[]; resueltas: string[] } {
  const porClave = new Map(guardadas.map((g) => [g.clave, g]))
  const vistas = new Set<string>()
  const nuevas: Diferencia[] = []
  const reabiertas: { id: string; d: Diferencia; revisada: boolean }[] = []
  const siguen: { id: string; d: Diferencia }[] = []
  for (const d of actuales) {
    if (vistas.has(d.clave)) continue
    vistas.add(d.clave)
    const g = porClave.get(d.clave)
    if (!g) nuevas.push(d)
    else if (g.estado === "resuelta") reabiertas.push({ id: g.id, d, revisada: !!g.revisada_at })
    else siguen.push({ id: g.id, d })
  }
  const resueltas = guardadas.filter((g) => g.estado !== "resuelta" && !vistas.has(g.clave) && evaluableG(g)).map((g) => g.id)
  return { nuevas, reabiertas, siguen, resueltas }
}
