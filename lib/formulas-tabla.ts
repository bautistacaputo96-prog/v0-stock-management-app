/**
 * Fórmulas · tabla resumen (docs/migracion-loop/formulas-rediseno.md).
 * Lógica pura de la pantalla /formulas: leer el código, ordenar los materiales como la planilla de Grow, armar la
 * matriz fórmula × material, filtrar, ordenar, el nombre al copiar a la otra planta y la comparación con la receta
 * de Indumix. Sin React ni Supabase: se prueba con `npm run test:formulas`.
 */
import { compararReceta, cantidadPorM3 } from "@/lib/carga/receta"
import { INFO_SALIDA } from "@/lib/carga/tipos"
import type { FormulaSistema, Grupo, MaterialSistema, RecetaPlanta, SalidaMapa, Tolerancias } from "@/lib/carga/tipos"

export const RESISTENCIAS = ["H4", "H8", "H13", "H17", "H21", "H25", "H30", "H35", "H40", "H45", "H50"]

export type MaterialTabla = { id: string; name: string; unit: string; tipo?: string | null }
export type FormulaTabla = {
  id: string
  code: string
  name: string
  description?: string | null
  yield_m3?: number | null
  updated_at?: string | null
  updated_by?: string | null
  formula_materials?: { id?: string; quantity: number | string; materials: { id: string; name: string; unit?: string } | null }[] | null
}

// ───────────────────────────── Código ─────────────────────────────

export type CodigoLeido = {
  /** "H25"; null si el código no empieza con H + número (RDC-200) */
  resistencia: string | null
  /** "B" bombeable, "C" común; null si el código no lo dice */
  metodo: "B" | "C" | null
  /** asentamiento en cm, si el código lo trae (H25-620-15 B → 15) */
  asentamiento: number | null
}

/** Saca la etiqueta de planta del final: "H25-620-10 C (CAN)" → "H25-620-10 C". */
export function sinEtiquetaPlanta(code: string): string {
  return String(code ?? "").replace(/\s*\([^)]*\)\s*$/, "").trim()
}

export function leerCodigo(code: string): CodigoLeido {
  const c = sinEtiquetaPlanta(code)
  const r = c.match(/^H(\d+)/i)
  const m = c.match(/\s([BC])(?=\s|$)/i)
  const partes = c.split(/\s/)[0].split("-")
  const asent = partes.length >= 3 && /^\d{1,2}$/.test(partes[2]) ? Number(partes[2]) : null
  return {
    resistencia: r ? `H${Number(r[1])}` : null,
    metodo: m ? (m[1].toUpperCase() as "B" | "C") : null,
    asentamiento: asent,
  }
}

// ───────────────────────────── Materiales ─────────────────────────────

const quitarTildes = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()

/** Orden de la planilla de Grow (por nombre). Lo que no figura va después, por tipo y nombre. */
const ORDEN_NOMBRE: RegExp[] = [
  /^cpc|cemento/, /arena fina/, /arena tritur/, /6\/20/, /6\/12/, /10\/30/, /^agua$/, /90e/, /33s/, /espum/,
]
const ORDEN_TIPO = ["cemento", "arido_fino", "arido_grueso", "agua", "aditivo_planta", "aditivo_obra", "fibra"]

function rangoMaterial(m: MaterialTabla): [number, number] {
  const n = quitarTildes(m.name)
  const i = ORDEN_NOMBRE.findIndex((re) => re.test(n))
  if (i >= 0) return [i, 0]
  const t = ORDEN_TIPO.indexOf(m.tipo || "")
  return [ORDEN_NOMBRE.length, t >= 0 ? t : ORDEN_TIPO.length]
}

export function ordenarMateriales<T extends MaterialTabla>(ms: T[]): T[] {
  return [...ms].sort((a, b) => {
    const ra = rangoMaterial(a), rb = rangoMaterial(b)
    return ra[0] - rb[0] || ra[1] - rb[1] || a.name.localeCompare(b.name, "es")
  })
}

/** Encabezado corto de la columna (el nombre entero va en el title). */
export function nombreCorto(name: string): string {
  const n = quitarTildes(name)
  const piedra = name.match(/(\d+\/\d+)/)
  if (/^piedra/.test(n) && piedra) return `P. ${piedra[1]}`
  if (/arena tritur/.test(n)) return "A. Trit."
  if (/arena fina/.test(n)) return "A. Fina"
  if (/^sikament\s/.test(n)) return name.replace(/^sikament\s+/i, "Sika ")
  if (/espum/.test(n)) return "Espum."
  return name
}

/** Tamaño de piedra de un material de árido grueso ("6/20"); null si no es piedra. */
export function piedraDe(m: MaterialTabla): string | null {
  if (m.tipo && m.tipo !== "arido_grueso") return null
  if (!m.tipo && !/piedra/i.test(m.name)) return null
  return m.name.match(/(\d+\/\d+)/)?.[1] ?? null
}

// ───────────────────────────── Matriz ─────────────────────────────

export type FilaMatriz = {
  id: string
  code: string
  name: string
  leido: CodigoLeido
  /** material_id → cantidad por m³ (sumada si se repite); sin clave = no lo usa */
  valores: Record<string, number>
  /** tamaños de piedra que usa ("6/20", "6/12") */
  piedras: string[]
  usos: number
  editado: string | null
}

export type Matriz = { columnas: MaterialTabla[]; filas: FilaMatriz[] }

/**
 * Una fila por fórmula y una columna por material de la planta, en el orden de la planilla, solo los que alguna
 * fórmula usa (cantidad > 0).
 */
export function armarMatriz(formulas: FormulaTabla[], materiales: MaterialTabla[], usos: Record<string, number> = {}): Matriz {
  const porId = new Map(materiales.map((m) => [m.id, m]))
  const usados = new Set<string>()
  const filas: FilaMatriz[] = formulas.map((f) => {
    const valores: Record<string, number> = {}
    for (const fm of f.formula_materials || []) {
      const id = fm.materials?.id
      const q = Number(fm.quantity) || 0
      if (!id || !(q > 0)) continue
      valores[id] = (valores[id] || 0) + q
      usados.add(id)
    }
    const piedras = Object.keys(valores).map((id) => (porId.get(id) ? piedraDe(porId.get(id)!) : null)).filter((x): x is string => !!x)
    return {
      id: f.id, code: f.code, name: f.name, leido: leerCodigo(f.code), valores, piedras: [...new Set(piedras)],
      usos: usos[f.id] || 0, editado: f.updated_at || null,
    }
  })
  return { columnas: ordenarMateriales(materiales.filter((m) => usados.has(m.id))), filas }
}

/** Cantidad para la celda: enteros sin decimales; lo chico (aditivos) con hasta 3 (2,805). */
export function celda(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return "—"
  const d = Math.abs(x) < 20 && Math.abs(x % 1) > 0.001 ? 3 : 0
  return x.toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: d })
}

// ───────────────────────────── Filtros y orden ─────────────────────────────

export type Filtros = {
  texto?: string
  /** "H25" o "Otras" (las que no empiezan con H + número); vacío = todas */
  resistencia?: string | null
  piedra?: string | null
  metodo?: "B" | "C" | null
  soloUsadas?: boolean
}

export function filtrar(filas: FilaMatriz[], f: Filtros): FilaMatriz[] {
  const t = quitarTildes((f.texto || "").trim())
  return filas.filter((r) => {
    if (t && !quitarTildes(r.code).includes(t) && !quitarTildes(r.name || "").includes(t)) return false
    if (f.resistencia) {
      if (f.resistencia === "Otras" ? r.leido.resistencia && RESISTENCIAS.includes(r.leido.resistencia) : r.leido.resistencia !== f.resistencia) return false
    }
    if (f.piedra && !r.piedras.includes(f.piedra)) return false
    if (f.metodo && r.leido.metodo !== f.metodo) return false
    if (f.soloUsadas && !(r.usos > 0)) return false
    return true
  })
}

/** "code" | "usos" | "editado" | id de material */
export type Columna = string
export type Orden = { col: Columna; asc: boolean }

const numResistencia = (r: FilaMatriz) => (r.leido.resistencia ? Number(r.leido.resistencia.slice(1)) : 999)

export function ordenar(filas: FilaMatriz[], o: Orden): FilaMatriz[] {
  const s = o.asc ? 1 : -1
  const porCodigo = (a: FilaMatriz, b: FilaMatriz) =>
    numResistencia(a) - numResistencia(b) || a.code.localeCompare(b.code, "es", { numeric: true })
  return [...filas].sort((a, b) => {
    if (o.col === "code") return s * porCodigo(a, b)
    if (o.col === "usos") return s * (a.usos - b.usos) || porCodigo(a, b)
    if (o.col === "editado") {
      // las que no tienen fecha van siempre al final
      const ta = a.editado ? Date.parse(a.editado) : NaN, tb = b.editado ? Date.parse(b.editado) : NaN
      if (Number.isNaN(ta) !== Number.isNaN(tb)) return Number.isNaN(ta) ? 1 : -1
      return (Number.isNaN(ta) ? 0 : s * (ta - tb)) || porCodigo(a, b)
    }
    // material: las que no lo usan van al final
    const va = a.valores[o.col], vb = b.valores[o.col]
    if ((va == null) !== (vb == null)) return va == null ? 1 : -1
    return (va == null ? 0 : s * (va - vb)) || porCodigo(a, b)
  })
}

/** Despachos por fórmula (filas de dispatches con formula_id). */
export function contarUsos(despachos: { formula_id: string | null }[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const d of despachos) if (d.formula_id) out[d.formula_id] = (out[d.formula_id] || 0) + 1
  return out
}

// ───────────────────────────── Copiar a la otra planta ─────────────────────────────

/** Sufijo de código que usa cada planta: Canning lleva "(CAN)", Hudson nada. */
export function sufijoPlanta(nombrePlanta: string | null | undefined): string {
  return /canning/i.test(String(nombrePlanta || "")) ? "(CAN)" : ""
}

/** Código de la fórmula en la planta de destino: "H25-620-10 C" ↔ "H25-620-10 C (CAN)". */
export function codigoEnPlanta(code: string, plantaDestino: string | null | undefined): string {
  const base = String(code ?? "").replace(/\s*\(CAN\)\s*$/i, "").trim()
  const suf = sufijoPlanta(plantaDestino)
  return suf ? `${base} ${suf}` : base
}

const claveCodigo = (c: string) => String(c ?? "").replace(/\s*\(CAN\)\s*$/i, "").replace(/\s+/g, " ").trim().toUpperCase()

/** La fórmula equivalente que ya existe en la otra planta (mismo código sin el sufijo), si hay. */
export function existeEnPlanta<T extends { code: string }>(code: string, formulasDestino: T[]): T | null {
  const k = claveCodigo(code)
  return formulasDestino.find((f) => claveCodigo(f.code) === k) || null
}

/**
 * Materiales de la fórmula pasados a la otra planta (por nombre). `faltan` = los que la otra planta no tiene: en
 * ese caso no se copia.
 */
export function materialesEnPlanta(
  receta: { material_name: string; quantity: number }[],
  materialesDestino: { id: string; name: string }[],
): { filas: { material_id: string; quantity: number }[]; faltan: string[] } {
  const porNombre = new Map(materialesDestino.map((m) => [quitarTildes(m.name).trim(), m.id]))
  const filas: { material_id: string; quantity: number }[] = []
  const faltan: string[] = []
  for (const r of receta) {
    if (!(Number(r.quantity) > 0)) continue
    const id = porNombre.get(quitarTildes(r.material_name).trim())
    if (id) filas.push({ material_id: id, quantity: Number(r.quantity) })
    else faltan.push(r.material_name)
  }
  return { filas, faltan }
}

// ───────────────────────────── Receta de la planta ─────────────────────────────

export type LineaPlanta = { material_id: string; nombre: string; grupo: Grupo; formula: number; receta: number; distinta: boolean; texto: string }

export type RecetaContraFormula = {
  numero: number
  nombre: string | null
  /** la receta no se leyó todavía o está vacía */
  vacia: boolean
  lineas: LineaPlanta[]
  /** salidas que pesan en la receta y no tienen material en el mapa ("Tolva 3") */
  sueltas: string[]
  iguales: boolean
  /** "Planta (receta 13): CPC 40 350 kg · Agua 110 L" (solo lo distinto); null si es igual */
  resumen: string | null
}

/**
 * La receta de Indumix que tiene asignada la fórmula, comparada con la fórmula (la misma comparación que la carga:
 * lib/carga/receta.ts). null si la fórmula no tiene número en el puesto.
 */
export function recetaContraFormula(
  numero: number | null,
  receta: (Pick<RecetaPlanta, "salidas"> & { nombre?: string | null }) | null,
  formula: FormulaSistema,
  salidas: SalidaMapa[],
  materiales: MaterialSistema[],
  tol?: Tolerancias,
): RecetaContraFormula | null {
  if (numero == null) return null
  if (!receta || !(receta.salidas || []).some((s) => Number(s.valor) > 0)) {
    return { numero, nombre: receta?.nombre ?? null, vacia: true, lineas: [], sueltas: [], iguales: false, resumen: null }
  }
  const cmp = compararReceta(receta, formula, salidas, materiales, tol)
  const lineas: LineaPlanta[] = cmp.filas.map((f) => ({
    material_id: f.material_id, nombre: f.nombre, grupo: f.grupo, formula: f.formula, receta: f.receta, distinta: !f.ok,
    texto: cantidadPorM3(f.grupo, f.receta),
  }))
  const distintas = lineas.filter((l) => l.distinta)
  const partes = [...distintas.map((l) => `${l.nombre} ${l.texto}`), ...cmp.sueltas.map((s) => `pesa en ${INFO_SALIDA[s].nombre} sin material`)]
  return {
    numero, nombre: receta.nombre ?? null, vacia: false, lineas, sueltas: cmp.sueltas.map((s) => INFO_SALIDA[s].nombre), iguales: cmp.ok,
    resumen: partes.length ? `Planta (receta ${numero}): ${partes.join(" · ")}` : null,
  }
}
