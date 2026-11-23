/**
 * Control cruzado · lo despachado en nuestro sistema contra Zomatik. Funciones puras: sin red, sin base y sin React. Se
 * prueban con `npm run test:control-produccion`. Especificación: docs/specs/2026-11-20-control-cruzado-despacho-zomatik.md
 * (la sección 18 manda sobre lo anterior).
 *
 * Tres comparaciones sobre los 7 días cerrados (de hoy − 7 a hoy − 1; hoy nunca da color):
 *   1. m³ despachados contra m³ con OF (FABRICA › REPORTE PRODUCCION), por planta y día.
 *   2. Materia prima descontada, POR GRUPO (cemento, arenas, piedras): nuestro `dispatch_materials` contra los RMI de
 *      INVENTARIO › MOVIMIENTOS STOCK. Material por material es solo informativo: las composiciones de Zomatik no
 *      reparten los áridos igual que nuestras fórmulas.
 *   3. Las OF del robot que no quedaron con la materia prima descontada.
 * Hermano de lib/control-stock/calculo.ts (que compara saldos): de ahí salen materiales, umbrales y formato.
 */
import { parseNumero, sinComentarios, textoCelda, nombreArticuloLista } from "@/lib/zomatik/parseo"
import { claveMaterial, ddmm, fechaArgentina, sumarDias, DEPOSITOS } from "@/lib/control-ingresos/cruce"
import { MATERIALES, MINIMO_T, UMBRAL_PCT, dias, fmtT } from "@/lib/control-stock/calculo"

// ---------------------------------------------------------------------------
// Parámetros
// ---------------------------------------------------------------------------

/** Días cerrados que se comparan: de hoy − 7 a hoy − 1. */
export const DIAS_VENTANA = 7
/** Una OF que falta de ayer o de anteayer va en ámbar ("en plazo"); desde el tercer día, en rojo. */
export const DIAS_GRACIA_OF = 2
/** m³: rojo si la diferencia de la semana es de esto o más (la OF copia los m³ del despacho; absorbe el redondeo). */
export const MINIMO_M3 = 0.5
/** Las OF del robot llevan estado de materia prima desde este día: un `of_mp_estado` vacío anterior es una fila vieja. */
export const MP_OF_DESDE = "2026-11-20"
/** El reporte de producción devuelve 16 días desde la fecha pedida. */
export const DIAS_REPORTE = 16
/** Se pide desde hoy − 9: la ventana más dos días de margen (un solo pedido cubre la ventana, hoy y las dos plantas). */
export const MARGEN_REPORTE = 9

const EPS = 1e-9
const r3 = (n: number) => Math.round(n * 1000) / 1000

export type Estado = "bien" | "ambar" | "rojo" | "gris"

/** La ventana de un día: los 7 días cerrados. */
export function ventana(hoy: string): { desde: string; hasta: string } {
  return { desde: sumarDias(hoy, -DIAS_VENTANA), hasta: sumarDias(hoy, -1) }
}

/** Ayer y anteayer: lo que falta ahí todavía está en plazo. */
export const diasDeGracia = (hoy: string): string[] => Array.from({ length: DIAS_GRACIA_OF }, (_, i) => sumarDias(hoy, -(i + 1)))

export const fmtM3 = (n: number) => r3(n).toLocaleString("es-AR", { maximumFractionDigits: 2 })
const fmtPct = (p: number) => Math.abs(p).toLocaleString("es-AR", { maximumFractionDigits: Math.abs(p) < 10 ? 1 : 0 })
/** "2026-11-20T08:44:10Z" → "05:44" (hora de Argentina). */
export const horaArgentina = (iso: string) => new Date(Date.parse(iso) - 3 * 3600_000).toISOString().slice(11, 16)
/** "hoy 05:44" si es de hoy; si no, "19/11 05:44". */
export const cuandoSeLeyo = (iso: string | null | undefined, hoy: string) =>
  !iso ? "nunca" : fechaArgentina(iso) === hoy ? `hoy ${horaArgentina(iso)}` : `${ddmm(fechaArgentina(iso))} ${horaArgentina(iso)}`

// ---------------------------------------------------------------------------
// Zomatik: FABRICA › REPORTE PRODUCCION
// ---------------------------------------------------------------------------

/** Una celda del reporte con m³: un producto, en un depósito, un día. */
export type CeldaProduccion = { fecha: string; deposito: number; segmento: string; producto: string; um: string; m3: number }
/** Lo que el reporte trae y no se suma (otro segmento u otro depósito), con el total de los 16 días. */
export type OtroProduccion = { segmento: string; producto: string; deposito: string; um: string; m3: number }
export type ReporteProduccion = {
  /** false = no se guarda (queda la lectura anterior). */
  ok: boolean
  motivo?: string
  /** Los días del encabezado (AAAA-MM-DD). */
  fechas: string[]
  celdas: CeldaProduccion[]
  otros: OtroProduccion[]
}

const sinTildes = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()

/** Depósito de Zomatik de la columna "Deposito" ("Canning" → 116, "REBUCRET" → 113). Nunca del nombre del producto. */
export const depositoDeTexto = (t: unknown): number | null => DEPOSITOS.find((d) => d.nombre.test(String(t ?? "")))?.id ?? null

const esHormigon = (segmento: unknown) => sinTildes(segmento).startsWith("hormigon")

/**
 * Lee la página del reporte. La tabla trae Segmento | Producto | Deposito | UM y una columna por día (con celdas
 * separadoras vacías en el medio: se usan las posiciones del encabezado). Vale solo si el encabezado trae 16 días
 * seguidos (desde `desde`, si se pasa) y algún depósito es Canning o REBUCRET. Una fila sin números (la "… | M2" real)
 * se ignora. Solo salen las celdas con m³ distinto de 0.
 */
export function leerReporteProduccion(html: string, desde?: string): ReporteProduccion {
  const vacio = (motivo: string): ReporteProduccion => ({ ok: false, motivo, fechas: [], celdas: [], otros: [] })
  let filas: string[][] | null = null
  let iEnc = -1
  // Solo tablas sin otras tablas adentro (Zomatik arma el layout con tablas anidadas); la que tenga el encabezado
  for (const t of sinComentarios(html).match(/<table\b(?:(?!<table\b)[\s\S])*?<\/table>/gi) || []) {
    const fs = (t.match(/<tr\b[\s\S]*?<\/tr>/gi) || []).map((tr) => (tr.match(/<t[dh]\b[\s\S]*?<\/t[dh]>/gi) || []).map(textoCelda))
    const i = fs.findIndex((f) => {
      const n = f.map(sinTildes)
      return n.includes("segmento") && n.includes("producto") && n.some((c) => c.startsWith("deposito"))
    })
    if (i >= 0) {
      filas = fs
      iEnc = i
      break
    }
  }
  if (!filas) return vacio("no vino la tabla del reporte de producción")
  const enc = filas[iEnc].map(sinTildes)
  const cSeg = enc.indexOf("segmento")
  const cProd = enc.indexOf("producto")
  const cDep = enc.findIndex((c) => c.startsWith("deposito"))
  const cUm = enc.indexOf("um")
  const cols: { i: number; fecha: string }[] = []
  filas[iEnc].forEach((c, i) => {
    const m = c.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
    if (m) cols.push({ i, fecha: `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` })
  })
  const fechas = cols.map((c) => c.fecha)
  const inicio = desde || fechas[0]
  if (fechas.length !== DIAS_REPORTE || fechas.some((f, i) => f !== sumarDias(inicio, i)))
    return { ...vacio(`el encabezado no trae ${DIAS_REPORTE} días seguidos desde el ${ddmm(inicio)} (trae ${fechas.length})`), fechas }

  const celdas: CeldaProduccion[] = []
  const otros: OtroProduccion[] = []
  let hayDeposito = false
  for (const f of filas.slice(iEnc + 1)) {
    const producto = (f[cProd] ?? "").trim()
    const depTexto = (f[cDep] ?? "").trim()
    if (!producto) continue
    const deposito = depositoDeTexto(depTexto)
    if (deposito !== null) hayDeposito = true
    const valores = cols.map((c) => ({ fecha: c.fecha, m3: parseNumero(f[c.i]) }))
    // La fila "… | M2" real viene sin números: no suma ni rompe
    if (valores.every((v) => v.m3 === null)) continue
    const segmento = (f[cSeg] ?? "").trim()
    const um = cUm >= 0 ? (f[cUm] ?? "").trim() : ""
    if (deposito !== null && esHormigon(segmento)) {
      for (const v of valores) if (v.m3) celdas.push({ fecha: v.fecha, deposito, segmento, producto, um, m3: v.m3 })
    } else {
      const total = r3(valores.reduce((s, v) => s + (v.m3 || 0), 0))
      if (total) otros.push({ segmento, producto, deposito: depTexto, um, m3: total })
    }
  }
  if (!hayDeposito) return { ...vacio("ningún depósito del reporte es Canning ni REBUCRET (¿otra sucursal?)"), fechas }
  return { ok: true, fechas, celdas, otros }
}

// ---------------------------------------------------------------------------
// 1. m³ despachados contra m³ con OF
// ---------------------------------------------------------------------------

export type DiaM3 = { fecha: string; sistema: number; zomatik: number; dif: number; estado: Estado; nota: string | null }
export type SemanaM3 = {
  sistema: number
  zomatik: number
  /** Zomatik − sistema. */
  dif: number
  /** m³ de ayer y anteayer que todavía no tienen OF (en plazo). */
  enEspera: number
  estado: Estado
  texto: string | null
  /** Los días que explican el texto (para el mail: "faltan OF por 12 m³ (17/11)"). */
  dias: string[]
}
export type M3Planta = { dias: DiaM3[]; semana: SemanaM3; hoy: { sistema: number; zomatik: number } }

/**
 * Compara los m³ de una planta. `sistema` y `zomatik`: m³ por día (AAAA-MM-DD). `alDia`: el reporte de producción se leyó
 * hoy; si no, todo en gris y no cuenta. Hoy va aparte y nunca da color.
 *   - semana: sobran 0,5 o más → rojo; faltan 0,5 o más → rojo, salvo que lo que falte sea de ayer o anteayer (ámbar).
 *   - cada día con 0,5 o más de diferencia: falta en un día de gracia → ámbar; con la semana en rojo → rojo; si no,
 *     ámbar "OF con otra fecha" (el total cierra). Así, si hay una celda roja, la semana está en rojo.
 */
export function compararM3(d: { hoy: string; sistema: Record<string, number>; zomatik: Record<string, number>; alDia: boolean }): M3Planta {
  const { desde, hasta } = ventana(d.hoy)
  const gracia = new Set(diasDeGracia(d.hoy))
  const base = dias(desde, hasta).map((fecha) => {
    const sistema = r3(d.sistema[fecha] || 0)
    const zomatik = r3(d.zomatik[fecha] || 0)
    return { fecha, sistema, zomatik, dif: r3(zomatik - sistema) }
  })
  const sistema = r3(base.reduce((s, x) => s + x.sistema, 0))
  const zomatik = r3(base.reduce((s, x) => s + x.zomatik, 0))
  const hoy = { sistema: r3(d.sistema[d.hoy] || 0), zomatik: r3(d.zomatik[d.hoy] || 0) }
  if (!d.alDia) {
    return {
      dias: base.map((x) => ({ ...x, estado: "gris" as const, nota: null })),
      semana: { sistema, zomatik, dif: r3(zomatik - sistema), enEspera: 0, estado: "gris", texto: "Zomatik sin leer hoy", dias: [] },
      hoy,
    }
  }
  const dif = r3(zomatik - sistema)
  const enEspera = r3(base.filter((x) => gracia.has(x.fecha)).reduce((s, x) => s + Math.max(0, x.sistema - x.zomatik), 0))
  const pasa = (n: number) => n >= MINIMO_M3 - EPS
  let estado: Estado = "bien"
  let texto: string | null = null
  if (pasa(dif)) {
    estado = "rojo"
    texto = `sobran ${fmtM3(dif)} m³ con OF`
  } else if (pasa(-dif)) {
    const faltaFirme = r3(-dif - enEspera)
    estado = pasa(faltaFirme) ? "rojo" : "ambar"
    texto = estado === "rojo" ? `faltan OF por ${fmtM3(-dif)} m³` : `faltan OF por ${fmtM3(-dif)} m³ (de ayer o anteayer, en plazo)`
  }
  const porDia: DiaM3[] = base.map((x) => {
    if (!pasa(Math.abs(x.dif))) return { ...x, estado: "bien", nota: null }
    if (x.dif < 0 && gracia.has(x.fecha)) return { ...x, estado: "ambar", nota: "todavía en plazo" }
    if (estado === "rojo") return { ...x, estado: "rojo", nota: x.dif < 0 ? "falta la OF" : "OF de más" }
    return { ...x, estado: "ambar", nota: "OF con otra fecha" }
  })
  // Los días que explican la semana: donde falta (o sobra), según para dónde va el total
  const explican = porDia.filter((x) => x.estado !== "bien" && (dif > 0 ? x.dif > 0 : x.dif < 0)).map((x) => x.fecha)
  return { dias: porDia, semana: { sistema, zomatik, dif, enEspera, estado, texto, dias: estado === "bien" ? [] : explican }, hoy }
}

/** Detalle informativo por producto: nuestros m³ por artículo de Zomatik contra los del reporte. El color lo da el total. */
export type ProductoDetalle = { clave: string; nombre: string; formulas: string[]; dias: { fecha: string; sistema: number; zomatik: number }[]; sistema: number; zomatik: number }

/**
 * Cruza por artículo: el código si está y, si no, el nombre del reporte contra el del artículo de la fórmula. Varias
 * fórmulas con el mismo artículo se suman en un renglón. Las fórmulas sin artículo van en "sin artículo de Zomatik".
 */
export function detalleProductos(d: {
  fechas: string[]
  sistema: { fecha: string; m3: number; articuloCodigo: number | null; articuloNombre: string | null; formula: string | null }[]
  zomatik: { fecha: string; m3: number; producto: string; articuloCodigo: number | null }[]
}): ProductoDetalle[] {
  type Fila = { nombre: string; formulas: Set<string>; s: Record<string, number>; z: Record<string, number> }
  const filas = new Map<string, Fila>()
  const fila = (clave: string, nombre: string) => {
    let f = filas.get(clave)
    if (!f) filas.set(clave, (f = { nombre, formulas: new Set(), s: {}, z: {} }))
    return f
  }
  const porNombre = new Map<string, string>()
  for (const x of d.sistema) {
    if (!d.fechas.includes(x.fecha)) continue
    const clave = x.articuloCodigo !== null ? `a:${x.articuloCodigo}` : "sin"
    const f = fila(clave, x.articuloCodigo !== null ? x.articuloNombre || `Artículo ${x.articuloCodigo}` : "sin artículo de Zomatik")
    if (x.articuloCodigo !== null && x.articuloNombre) porNombre.set(nombreArticuloLista(x.articuloNombre), clave)
    if (x.formula) f.formulas.add(x.formula)
    f.s[x.fecha] = (f.s[x.fecha] || 0) + x.m3
  }
  for (const x of d.zomatik) {
    if (!d.fechas.includes(x.fecha)) continue
    const n = nombreArticuloLista(x.producto)
    const clave = x.articuloCodigo !== null ? `a:${x.articuloCodigo}` : porNombre.get(n) || `n:${n}`
    const f = fila(clave, x.producto)
    f.z[x.fecha] = (f.z[x.fecha] || 0) + x.m3
  }
  return [...filas.entries()]
    .map(([clave, f]) => {
      const ds = d.fechas.map((fecha) => ({ fecha, sistema: r3(f.s[fecha] || 0), zomatik: r3(f.z[fecha] || 0) }))
      return { clave, nombre: f.nombre, formulas: [...f.formulas].sort(), dias: ds, sistema: r3(ds.reduce((s, x) => s + x.sistema, 0)), zomatik: r3(ds.reduce((s, x) => s + x.zomatik, 0)) }
    })
    .filter((p) => p.sistema || p.zomatik)
    .sort((a, b) => (a.clave === "sin" ? 1 : b.clave === "sin" ? -1 : a.nombre.localeCompare(b.nombre)))
}

// ---------------------------------------------------------------------------
// 2. Materia prima descontada, por grupo
// ---------------------------------------------------------------------------

export type ClaveGrupo = "cemento" | "arenas" | "piedras"

const codigosDe = (prefijo: string) => MATERIALES.filter((m) => m.clave.startsWith(prefijo)).map((m) => m.codigo as string)

/**
 * Los grupos del semáforo (sección 18): el color va por grupo y no por material, porque las composiciones de Zomatik no
 * reparten los áridos igual que nuestras fórmulas (y la Piedra 10/30 no existe en la composición). `codigos`: los
 * artículos de Zomatik de cada grupo (de `MATERIALES`).
 */
export const GRUPOS: { clave: ClaveGrupo; nombre: string; codigos: string[] }[] = [
  { clave: "cemento", nombre: "Cemento", codigos: codigosDe("cemento") },
  { clave: "arenas", nombre: "Arenas", codigos: codigosDe("arena") },
  { clave: "piedras", nombre: "Piedras", codigos: codigosDe("piedra") },
]

/**
 * El grupo de un material NUESTRO por su nombre: el único lugar donde se decide. Cemento; arenas (fina y trituración
 * 0/6); piedras: toda piedra del sistema (6/12, 6/20, 10/30 y cualquier otra), esté o no en Zomatik. Lo que Zomatik no
 * descuenta (agua, aditivos, fibra) no entra: null. Usa la misma clave que el control de ingresos (`claveMaterial`).
 */
export function grupoDeMaterial(nombre: unknown): ClaveGrupo | null {
  const c = claveMaterial(nombre)
  if (!c) return null
  if (c === "cemento") return "cemento"
  if (c.startsWith("arena")) return "arenas"
  if (c.startsWith("piedra")) return "piedras"
  return null
}

/** El grupo de un artículo de Zomatik por su código (10000026 → cemento…). */
export const grupoDeCodigo = (codigo: unknown): ClaveGrupo | null => GRUPOS.find((g) => g.codigos.includes(String(codigo ?? "").trim()))?.clave ?? null

/** Un descuento de materia prima hecho por el robot: el día del despacho, cuándo se descontó y cuánto de cada artículo. */
export type OfRobot = { fecha: string; ofMpAt: string; detalle: { codigo: string; toneladas: number }[] }

/**
 * Lo que descontó Zomatik por artículo y día, con los descuentos del robot PASADOS AL DÍA DEL DESPACHO (decisión 7): el
 * RMI queda con la fecha del día en que se confirma (`of_mp_at`, en Argentina), no con la del despacho. Solo se pasa lo
 * que la lectura ya trae (`of_mp_at` ≤ `leidoAt` de ese artículo). `rmi`: toneladas descontadas (−movimiento) por día.
 *   - `porDia[codigo][fecha]`: ya corregido.
 *   - `movido[codigo]`: toneladas que cambiaron de día.
 *   - `hoyLibre[codigo]`: lo que Zomatik descontó hoy y no es del robot (alguien regularizó a mano hoy).
 */
export function zomatikPorDia(d: { hoy: string; rmi: { codigo: string; fecha: string; t: number }[]; ofs: OfRobot[]; leidoAt: Record<string, string | null | undefined> }): {
  porDia: Record<string, Record<string, number>>
  movido: Record<string, number>
  hoyLibre: Record<string, number>
} {
  const porDia: Record<string, Record<string, number>> = {}
  const movido: Record<string, number> = {}
  const delRobotHoy: Record<string, number> = {}
  const sumar = (codigo: string, fecha: string, t: number) => {
    const c = (porDia[codigo] ||= {})
    c[fecha] = (c[fecha] || 0) + t
  }
  for (const m of d.rmi) sumar(m.codigo, m.fecha, m.t)
  const rmiHoy: Record<string, number> = {}
  for (const m of d.rmi) if (m.fecha === d.hoy) rmiHoy[m.codigo] = (rmiHoy[m.codigo] || 0) + m.t
  for (const of of d.ofs) {
    const cuando = Date.parse(of.ofMpAt)
    if (!Number.isFinite(cuando)) continue
    const diaMp = fechaArgentina(cuando)
    for (const it of of.detalle || []) {
      const codigo = String(it?.codigo ?? "").trim()
      const t = Number(it?.toneladas)
      if (!codigo || !Number.isFinite(t) || t <= 0) continue
      const leido = d.leidoAt[codigo]
      // Si se descontó después de la lectura, la lectura no lo trae: no hay nada que pasar
      if (!leido || cuando > Date.parse(leido)) continue
      if (diaMp === d.hoy) delRobotHoy[codigo] = (delRobotHoy[codigo] || 0) + t
      if (diaMp === of.fecha) continue
      sumar(codigo, diaMp, -t)
      sumar(codigo, of.fecha, t)
      movido[codigo] = (movido[codigo] || 0) + t
    }
  }
  const hoyLibre: Record<string, number> = {}
  for (const [codigo, t] of Object.entries(rmiHoy)) hoyLibre[codigo] = Math.max(0, t - (delRobotHoy[codigo] || 0))
  return { porDia, movido, hoyLibre }
}

export type EvaluacionGrupo = {
  estado: Estado
  /** Zomatik − sistema (t). */
  dif: number
  /** % sobre NUESTRO sistema (el caso a detectar es Zomatik en cero). null si el sistema no descontó nada. */
  pct: number | null
  /** "faltan 71,2 t (79 %)" · "de más 3,0 t (6 %)" · "coincide". */
  texto: string
  /** "por la humedad" · "faltan OF de ayer o anteayer" · "Zomatik lo descontó hoy". */
  nota: string | null
}

/** ¿`z` está cerca de `ref`? A menos de media tonelada o de 5 % (como el rojo del control de stock, al revés). */
const cerca = (z: number, ref: number) => {
  const d = Math.abs(z - ref)
  return d < MINIMO_T - EPS || (ref > EPS && (d / ref) * 100 <= UMBRAL_PCT + EPS)
}

/**
 * Estado de un grupo (toneladas de la semana). `sistema`: lo que descontó el sistema (la arena, con humedad); `seco`: lo
 * mismo en seco (Zomatik descuenta la composición seca). `pctEspera`: % de los m³ de la semana que todavía esperan su OF
 * (ayer y anteayer). `hoyLibre`: lo que Zomatik descontó hoy y no es del robot.
 *   1. Bien si Zomatik cae entre lo seco y lo húmedo, o a menos de 5 % o de media tonelada de cualquiera de los dos. Si
 *      solo cierra contra el seco: "por la humedad".
 *   2. Por arriba → rojo, "de más".
 *   3. Por abajo → ámbar si la falta (contra el seco) no supera el % en espera + 5, o si se cubre con lo de hoy; si no,
 *      rojo, "faltan".
 */
export function evaluarGrupo(d: { sistema: number; seco: number; zomatik: number; pctEspera?: number; hoyLibre?: number }): EvaluacionGrupo {
  const { sistema, seco, zomatik: z } = d
  const lo = Math.min(seco, sistema)
  const hi = Math.max(seco, sistema)
  const dif = z - sistema
  const pct = sistema > EPS ? (dif / sistema) * 100 : null
  const cuanto = `${fmtT(Math.abs(dif))} t${pct === null ? "" : ` (${fmtPct(pct)} %)`}`
  const texto = Math.abs(dif) < 0.05 ? "coincide" : dif < 0 ? `faltan ${cuanto}` : `de más ${cuanto}`
  if (cerca(z, sistema)) return { estado: "bien", dif, pct, texto, nota: null }
  if ((z >= lo && z <= hi) || cerca(z, seco)) return { estado: "bien", dif, pct, texto, nota: "por la humedad" }
  if (z > hi) return { estado: "rojo", dif, pct, texto, nota: null }
  const falta = lo - z
  const pctFalta = lo > EPS ? (falta / lo) * 100 : 100
  if ((d.pctEspera || 0) > 0 && pctFalta <= (d.pctEspera || 0) + UMBRAL_PCT + EPS) return { estado: "ambar", dif, pct, texto, nota: "faltan OF de ayer o anteayer" }
  const conHoy = z + (d.hoyLibre || 0)
  if ((d.hoyLibre || 0) > EPS && (conHoy >= lo || cerca(conHoy, lo))) return { estado: "ambar", dif, pct, texto, nota: "Zomatik lo descontó hoy" }
  return { estado: "rojo", dif, pct, texto, nota: null }
}

/** Un material dentro de su grupo: informativo, sin color. `zomatik` null = ese material no es un artículo de Zomatik. */
export type MaterialDetalle = { nombre: string; codigo: string | null; sistema: number; zomatik: number | null }

export type FilaGrupo = EvaluacionGrupo & {
  grupo: ClaveGrupo
  nombre: string
  sistema: number
  seco: number
  zomatik: number
  /** Toneladas del robot que se descontaron otro día y se pasaron al día del despacho. */
  movido: number
  /** Si el grupo está en gris: cuándo se leyó por última vez (null = nunca) y el error del último intento. */
  lectura: { leidoAt: string | null; error: string | null } | null
  materiales: MaterialDetalle[]
  porDia: { fecha: string; sistema: number; zomatik: number }[]
  /** Los ajustes (RS) de Zomatik en la semana: no cuentan, se muestran. */
  ajustes: { fecha: string; material: string; comprobante: string; t: number }[]
}

// ---------------------------------------------------------------------------
// 3. OF del robot sin la materia prima descontada
// ---------------------------------------------------------------------------

export type OfRemito = {
  fecha: string
  plant_id: string
  of_numero: string | null
  m3: number | string | null
  formula_id?: string | null
  of_estado: string | null
  estado: string | null
  of_mp_estado: string | null
  of_mp_mensaje?: string | null
}

/**
 * Las OF del robot de la ventana que no quedaron con la materia prima descontada: `revisar` y `pendiente`, y las que no
 * tienen dato desde el 20/11 (antes son filas viejas, ya tratadas). `no` (OF duplicada, decidido) y `ok` no van. Las de
 * hoy no entran (están en curso): la ventana termina ayer.
 */
export function ofSinMp<T extends OfRemito>(filas: T[], v: { desde: string; hasta: string }): T[] {
  return filas
    .filter((f) => f.of_estado === "ok" && f.estado !== "anulado" && f.fecha >= v.desde && f.fecha <= v.hasta)
    .filter((f) => f.of_mp_estado === "revisar" || f.of_mp_estado === "pendiente" || ((f.of_mp_estado === null || f.of_mp_estado === undefined) && f.fecha >= MP_OF_DESDE))
    .sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : String(a.of_numero || "").localeCompare(String(b.of_numero || ""))))
}

/** Por qué una OF está en la lista. */
export function motivoOfSinMp(f: { of_mp_estado: string | null; of_mp_mensaje?: string | null }): string {
  if (f.of_mp_estado === "pendiente") return "todavía sin descontar"
  if (f.of_mp_estado === null || f.of_mp_estado === undefined) return "sin dato"
  return String(f.of_mp_mensaje || "").replace(/\s+/g, " ").trim().slice(0, 200) || "no se pudo descontar"
}

export type OfSinMp = { fecha: string; planta: string; of: string | null; m3: number; formula: string | null; motivo: string }

// ---------------------------------------------------------------------------
// Todo junto
// ---------------------------------------------------------------------------

export type DatosDespacho = {
  hoy: string
  /** Las plantas con depósito en Zomatik (de `zomatik_np_config`). */
  plantas: { id: string; nombre: string; deposito: number }[]
  /** Despachos desde el inicio de la ventana hasta ahora, sin los de prueba. `kg`: lo descontado; `kgSeco`: en seco. */
  despachos: {
    plantaId: string
    fecha: string
    m3: number
    articuloCodigo: number | null
    articuloNombre: string | null
    formula: string | null
    materiales: { nombre: string; kg: number; kgSeco: number | null }[]
  }[]
  /** m³ con OF (hormigón) por depósito, día y producto. */
  produccion: { deposito: number; fecha: string; producto: string; articuloCodigo: number | null; m3: number }[]
  lecturaProduccion: { leidoAt: string | null; error: string | null } | null
  /** Movimientos RMI (consumo) y RS (ajuste) de Zomatik desde el inicio de la ventana. `movimiento` con su signo. */
  movimientos: { deposito: number; codigo: string; fecha: string; prefijo: string; comprobante: string; movimiento: number }[]
  lecturasStock: { deposito: number; codigo: string; leidoAt: string | null; error: string | null }[]
  /** Descuentos del robot (`of_mp_estado = 'ok'` con detalle) hechos desde el inicio de la ventana. */
  ofsRobot: (OfRobot & { plantaId: string })[]
  /** Las OF del robot de la ventana (se filtran con `ofSinMp`), con el código de la fórmula. */
  ofs: (OfRemito & { formula?: string | null })[]
}

export type PlantaDespacho = { plantaId: string; planta: string; deposito: number; m3: M3Planta & { productos: ProductoDetalle[] }; grupos: FilaGrupo[] }

export type Semaforo = {
  estado: "verde" | "ambar" | "rojo"
  /** "Despacho contra Zomatik: todo bien" · "… no se pudo leer Zomatik hoy" · "… hay diferencias". */
  titulo: string
  /** Lo que está en ámbar (en plazo, otra fecha…): una línea gris cada uno. */
  avisos: string[]
}

export type LecturaDespacho = {
  /** Todas las fuentes se leyeron hoy. */
  alDia: boolean
  /** Con todo al día, la lectura más vieja de hoy; si no, la más vieja de lo que falta (null = alguna nunca se leyó). */
  leidoAt: string | null
  produccion: { leidoAt: string | null; alDia: boolean; error: string | null }
  /** Lo que no se leyó hoy: "el reporte de producción", "Canning · Piedras"… */
  sinLeer: string[]
}

export type ResultadoDespacho = {
  hoy: string
  desde: string
  hasta: string
  semaforo: Semaforo
  lectura: LecturaDespacho
  plantas: PlantaDespacho[]
  ofSinMp: OfSinMp[]
}

const masVieja = (xs: (string | null)[]): string | null => (xs.some((x) => !x) ? null : (xs as string[]).slice().sort()[0] ?? null)

/** Arma toda la comparación con lo leído de la base. */
export function armarDespacho(d: DatosDespacho): ResultadoDespacho {
  const { desde, hasta } = ventana(d.hoy)
  const V = dias(desde, hasta)
  const enV = (f: string) => f >= desde && f <= hasta
  const esDeHoy = (iso: string | null | undefined) => !!iso && fechaArgentina(iso) === d.hoy
  const prodAlDia = esDeHoy(d.lecturaProduccion?.leidoAt)
  const nombreDe = new Map(d.plantas.map((p) => [p.id, p.nombre]))
  const sinLeer: string[] = prodAlDia ? [] : ["el reporte de producción"]
  const leidas: (string | null)[] = [d.lecturaProduccion?.leidoAt ?? null]
  const viejas: (string | null)[] = prodAlDia ? [] : [d.lecturaProduccion?.leidoAt ?? null]

  const plantas: PlantaDespacho[] = d.plantas.map((p) => {
    const desp = d.despachos.filter((x) => x.plantaId === p.id)
    const prod = d.produccion.filter((x) => x.deposito === p.deposito)
    const porFecha = (xs: { fecha: string; m3: number }[]) => {
      const o: Record<string, number> = {}
      for (const x of xs) o[x.fecha] = (o[x.fecha] || 0) + x.m3
      return o
    }
    const m3 = compararM3({ hoy: d.hoy, sistema: porFecha(desp), zomatik: porFecha(prod), alDia: prodAlDia })
    const productos = detalleProductos({ fechas: [...V, d.hoy], sistema: desp, zomatik: prod })
    const pctEspera = prodAlDia && m3.semana.sistema > EPS ? (m3.semana.enEspera / m3.semana.sistema) * 100 : 0

    const lecturas = new Map(d.lecturasStock.filter((l) => l.deposito === p.deposito).map((l) => [l.codigo, l]))
    const movs = d.movimientos.filter((m) => m.deposito === p.deposito)
    const z = zomatikPorDia({
      hoy: d.hoy,
      rmi: movs.filter((m) => m.prefijo === "RMI").map((m) => ({ codigo: m.codigo, fecha: m.fecha, t: -m.movimiento })),
      ofs: d.ofsRobot.filter((o) => o.plantaId === p.id),
      leidoAt: Object.fromEntries([...lecturas].map(([c, l]) => [c, l.leidoAt])),
    })
    const zDia = (codigos: string[], fecha: string) => codigos.reduce((s, c) => s + (z.porDia[c]?.[fecha] || 0), 0)

    const grupos: FilaGrupo[] = GRUPOS.map((g) => {
      // Nuestro lado: todo material del grupo que la planta descontó (también la Piedra 10/30, que Zomatik no tiene)
      const nuestros = new Map<string, { nombre: string; kg: number }>()
      const sDia: Record<string, { kg: number; seco: number }> = {}
      for (const x of desp) {
        if (!enV(x.fecha)) continue
        for (const m of x.materiales) {
          if (grupoDeMaterial(m.nombre) !== g.clave) continue
          const dia = (sDia[x.fecha] ||= { kg: 0, seco: 0 })
          dia.kg += m.kg
          dia.seco += m.kgSeco ?? m.kg
          const clave = claveMaterial(m.nombre) || m.nombre
          const n = nuestros.get(clave) || { nombre: m.nombre, kg: 0 }
          n.kg += m.kg
          nuestros.set(clave, n)
        }
      }
      const sistema = Object.values(sDia).reduce((s, x) => s + x.kg, 0) / 1000
      const seco = Object.values(sDia).reduce((s, x) => s + x.seco, 0) / 1000
      const zomatik = V.reduce((s, f) => s + zDia(g.codigos, f), 0)
      const hoyLibre = g.codigos.reduce((s, c) => s + (z.hoyLibre[c] || 0), 0)
      const movido = g.codigos.reduce((s, c) => s + (z.movido[c] || 0), 0)
      const lecs = g.codigos.map((c) => lecturas.get(c) || null)
      const alDia = lecs.every((l) => esDeHoy(l?.leidoAt))
      for (const l of lecs) leidas.push(l?.leidoAt ?? null)
      if (!alDia) {
        sinLeer.push(`${p.nombre} · ${g.nombre}`)
        for (const l of lecs) if (!esDeHoy(l?.leidoAt)) viejas.push(l?.leidoAt ?? null)
      }
      const ev = evaluarGrupo({ sistema, seco, zomatik, pctEspera, hoyLibre })
      // Detalle por material: los nuestros con su artículo de Zomatik (si lo tienen) y los artículos que solo tiene Zomatik
      const materiales: MaterialDetalle[] = []
      const usados = new Set<string>()
      for (const [clave, n] of nuestros) {
        const mat = MATERIALES.find((m) => m.clave === clave)
        if (mat) usados.add(mat.codigo)
        materiales.push({ nombre: n.nombre, codigo: mat?.codigo ?? null, sistema: n.kg / 1000, zomatik: mat ? V.reduce((s, f) => s + zDia([mat.codigo], f), 0) : null })
      }
      for (const c of g.codigos) {
        if (usados.has(c)) continue
        const t = V.reduce((s, f) => s + zDia([c], f), 0)
        if (Math.abs(t) > EPS) materiales.push({ nombre: MATERIALES.find((m) => m.codigo === c)?.nombre || c, codigo: c, sistema: 0, zomatik: t })
      }
      materiales.sort((a, b) => a.nombre.localeCompare(b.nombre))
      const viejo = lecs.filter((l) => !esDeHoy(l?.leidoAt))
      return {
        grupo: g.clave,
        nombre: g.nombre,
        sistema,
        seco,
        zomatik,
        movido,
        ...(alDia ? ev : { ...ev, estado: "gris" as const, nota: null }),
        lectura: alDia ? null : { leidoAt: masVieja(viejo.map((l) => l?.leidoAt ?? null)), error: viejo.map((l) => l?.error).find((e) => !!e) || null },
        materiales,
        porDia: V.map((fecha) => ({ fecha, sistema: (sDia[fecha]?.kg || 0) / 1000, zomatik: zDia(g.codigos, fecha) })),
        ajustes: movs
          .filter((m) => m.prefijo === "RS" && enV(m.fecha) && g.codigos.includes(m.codigo))
          .map((m) => ({ fecha: m.fecha, material: MATERIALES.find((x) => x.codigo === m.codigo)?.nombre || m.codigo, comprobante: m.comprobante, t: m.movimiento }))
          .sort((a, b) => (a.fecha < b.fecha ? -1 : 1)),
      }
    })
    return { plantaId: p.id, planta: p.nombre, deposito: p.deposito, m3: { ...m3, productos }, grupos }
  })

  const lista: OfSinMp[] = ofSinMp(d.ofs, { desde, hasta }).map((f) => ({
    fecha: f.fecha,
    planta: nombreDe.get(f.plant_id) || "-",
    of: f.of_numero || null,
    m3: Number(f.m3) || 0,
    formula: f.formula || null,
    motivo: motivoOfSinMp(f),
  }))

  const alDia = sinLeer.length === 0
  const lectura: LecturaDespacho = {
    alDia,
    leidoAt: masVieja(alDia ? leidas : viejas),
    produccion: { leidoAt: d.lecturaProduccion?.leidoAt ?? null, alDia: prodAlDia, error: d.lecturaProduccion?.error ?? null },
    sinLeer,
  }
  return { hoy: d.hoy, desde, hasta, semaforo: semaforo(plantas, lista.length, alDia), lectura, plantas, ofSinMp: lista }
}

/**
 * El semáforo: rojo si en alguna planta la semana de m³ o algún grupo está en rojo, o hay OF sin descontar; ámbar ("no
 * se pudo leer Zomatik hoy") si no hay rojo y alguna fuente no está al día (nunca "todo bien" con datos viejos); verde
 * en el resto. Lo que está en ámbar va como aviso.
 */
export function semaforo(plantas: PlantaDespacho[], ofsSinMp: number, alDia: boolean): Semaforo {
  const rojo = ofsSinMp > 0 || plantas.some((p) => p.m3.semana.estado === "rojo" || p.grupos.some((g) => g.estado === "rojo"))
  const avisos: string[] = []
  for (const p of plantas) {
    if (p.m3.semana.estado === "ambar" && p.m3.semana.texto) avisos.push(`${p.planta}: ${p.m3.semana.texto}.`)
    else if (p.m3.semana.estado === "bien") {
      const otra = p.m3.dias.filter((x) => x.estado === "ambar")
      if (otra.length) avisos.push(`${p.planta}: OF con otra fecha (${otra.map((x) => ddmm(x.fecha)).join(", ")}). El total de la semana coincide.`)
    }
    for (const g of p.grupos) if (g.estado === "ambar") avisos.push(`${p.planta}, ${g.nombre.toLowerCase()}: ${g.texto}${g.nota ? ` (${g.nota})` : ""}.`)
  }
  if (rojo) return { estado: "rojo", titulo: "Despacho contra Zomatik: hay diferencias", avisos }
  if (!alDia) return { estado: "ambar", titulo: "Despacho contra Zomatik: no se pudo leer Zomatik hoy", avisos }
  return { estado: "verde", titulo: "Despacho contra Zomatik: todo bien", avisos }
}

// ---------------------------------------------------------------------------
// Mail: el bloque de arriba del mail diario de las 16:25 (y del semanal de los lunes)
// ---------------------------------------------------------------------------

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)

/** Lo que se le agrega al asunto cuando hay rojo. */
export const ASUNTO_DESPACHO_ROJO = " · Despacho contra Zomatik: hay diferencias"
const MAX_OF_MAIL = 25

/**
 * El bloque del mail. Verde: una línea. Sin lectura de hoy: una línea ámbar con la última lectura. Rojo: la línea y el
 * detalle corto, solo de lo que no coincide (m³ por planta, materia prima por grupo y las OF sin descontar). Sin montos.
 */
export function seccionMailDespacho(r: ResultadoDespacho, link: string): { html: string; asunto: string | null } {
  const TH = `style="text-align:left;font-weight:normal;color:#64748b;padding:3px 6px;border-bottom:1px solid #e2e8f0;font-size:11px"`
  const TD = (color: string) => `style="padding:3px 6px;border-bottom:1px solid #f1f5f9;font-size:12px;${color ? `color:${color}` : ""}"`
  const periodo = `Del ${ddmm(r.desde)} al ${ddmm(r.hasta)}`
  const avisos = r.semaforo.avisos.map((a) => `<div style="color:#64748b">${esc(a)}</div>`).join("")
  const caja = (cuerpo: string) => `<div style="margin:0 0 12px;padding-bottom:10px;border-bottom:1px solid #e2e8f0">${cuerpo}</div>`
  const falta = r.lectura.sinLeer.length ? ` Falta: ${r.lectura.sinLeer.join(", ")}.` : ""

  if (r.semaforo.estado === "verde") {
    const resto = r.semaforo.avisos.length ? `${periodo} no hay nada para corregir.` : `${periodo} coinciden los m³ y la materia prima, y no hay OF sin descontar.`
    return { html: caja(`<div><span style="color:#047857">${esc(r.semaforo.titulo)}.</span> ${esc(resto)}</div>${avisos}`), asunto: null }
  }
  if (r.semaforo.estado === "ambar") {
    const ultima = `Última lectura: ${r.lectura.leidoAt ? cuandoSeLeyo(r.lectura.leidoAt, r.hoy) : "nunca"}.`
    return { html: caja(`<div style="background:#fef3c7;color:#78350f;padding:6px 8px;border-radius:6px">${esc(r.semaforo.titulo)}. ${esc(ultima)}${esc(falta)}</div>`), asunto: null }
  }

  const leido = r.lectura.alDia ? `Zomatik leído ${cuandoSeLeyo(r.lectura.leidoAt, r.hoy)}.` : `Zomatik sin leer hoy.${falta}`
  // m³: solo las plantas que no coinciden
  const m3 = r.plantas.every((p) => p.m3.semana.estado === "gris")
    ? `<div style="margin-top:8px;color:#64748b">m³: Zomatik sin leer hoy.</div>`
    : r.plantas.every((p) => p.m3.semana.estado === "bien")
      ? `<div style="margin-top:8px">m³: coinciden${r.plantas.length === 2 ? " en las dos plantas" : r.plantas.length > 2 ? " en todas las plantas" : ""}.</div>`
      : r.plantas
          .filter((p) => p.m3.semana.estado === "rojo" || p.m3.semana.estado === "ambar")
          .map((p) => {
            const s = p.m3.semana
            const t = s.texto ? s.texto.charAt(0).toUpperCase() + s.texto.slice(1) : ""
            const ds = s.dias.length ? ` (${s.dias.map(ddmm).join(", ")})` : ""
            return `<div style="margin-top:8px;color:${s.estado === "rojo" ? "#b91c1c" : "#64748b"}">${esc(p.planta)}: el sistema despachó ${esc(fmtM3(s.sistema))} m³ y Zomatik tiene OF por ${esc(fmtM3(s.zomatik))}. ${esc(t)}${esc(ds)}.</div>`
          })
          .join("")
  // Materia prima: por grupo, solo lo que no coincide
  const filas = r.plantas.flatMap((p) => p.grupos.filter((g) => g.estado !== "bien").map((g) => ({ p, g })))
  const mp = filas.length
    ? `<div style="margin-top:10px">Materia prima descontada (t)</div>
    <table style="width:100%;border-collapse:collapse;margin:2px 0 6px">
      <tr><th ${TH}>Planta</th><th ${TH}>Material</th><th ${TH}>Sistema</th><th ${TH}>Zomatik</th><th ${TH}>Diferencia</th></tr>
      ${filas
        .map(({ p, g }) => {
          const c = g.estado === "rojo" ? "#b91c1c" : g.estado === "gris" ? "#94a3b8" : "#64748b"
          const dif = g.estado === "gris" ? `Zomatik sin leer hoy (última: ${cuandoSeLeyo(g.lectura?.leidoAt, r.hoy)})` : `${g.texto}${g.nota ? ` · ${g.nota}` : ""}`
          return `<tr><td ${TD(c)}>${esc(p.planta)}</td><td ${TD(c)}>${esc(g.nombre)}</td><td ${TD(c)}>${fmtT(g.sistema)}</td><td ${TD(c)}>${g.estado === "gris" ? "-" : fmtT(g.zomatik)}</td><td ${TD(c)}>${esc(dif)}</td></tr>`
        })
        .join("")}
    </table>`
    : `<div style="margin-top:8px">Materia prima: coincide.</div>`
  const ofs = r.ofSinMp.length
    ? `<div style="margin-top:10px">OF sin materia prima descontada (${r.ofSinMp.length})</div>
    ${r.ofSinMp
      .slice(0, MAX_OF_MAIL)
      .map((o) => `<div>${esc([ddmm(o.fecha), o.planta, o.of ? `OF ${o.of}` : "OF sin número", `${fmtM3(o.m3)} m³`, o.motivo].join(" · "))}</div>`)
      .join("")}
    ${r.ofSinMp.length > MAX_OF_MAIL ? `<div style="color:#64748b">y ${r.ofSinMp.length - MAX_OF_MAIL} más</div>` : ""}`
    : ""
  const html = caja(`<div style="font-size:14px;color:#b91c1c">${esc(r.semaforo.titulo)}.</div>
    <div style="color:#64748b">${esc(periodo)}. Hoy no se cuenta. ${esc(leido)}</div>
    ${m3}
    ${mp}
    ${ofs}
    <p style="margin:8px 0 0"><a href="${esc(link)}" style="color:#1d4ed8">Ver el detalle</a></p>`)
  return { html, asunto: ASUNTO_DESPACHO_ROJO }
}
