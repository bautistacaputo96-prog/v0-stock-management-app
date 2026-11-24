/**
 * Cálculos y fechas de Calidad (probetas, roturas, reporte semanal). Sin React ni Supabase: se prueba con
 * `npm run test:calidad` (corre con la zona de Vercel, UTC, y con la de Argentina).
 *
 * Fechas: las columnas `date` (scheduled_test_date, actual_test_date, calibration_date) llegan como "yyyy-mm-dd".
 * `new Date("yyyy-mm-dd")` las toma como medianoche UTC, que en Argentina es las 21 h del día ANTERIOR: por eso
 * se leen con `fechaDeDia`. `dispatch_date` es timestamptz y llega en UTC: el día del moldeo es el de Argentina
 * (`diaArgentina`), no los primeros 10 caracteres.
 */

export const ZONA_AR = "America/Argentina/Buenos_Aires"

const DIA = /^(\d{4})-(\d{2})-(\d{2})$/

/** "yyyy-mm-dd" del instante en hora de Argentina. Un "yyyy-mm-dd" suelto se devuelve igual. "" si no sirve. */
export function diaArgentina(valor: string | Date | null | undefined): string {
  if (!valor) return ""
  if (typeof valor === "string" && DIA.test(valor)) return valor
  const d = valor instanceof Date ? valor : new Date(valor)
  if (Number.isNaN(d.getTime())) return ""
  // en-CA formatea como yyyy-mm-dd
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONA_AR, year: "numeric", month: "2-digit", day: "2-digit" }).format(d)
}

/** Medianoche LOCAL del día "yyyy-mm-dd" (o del día de un timestamp). null si no sirve. */
export function fechaDeDia(dia: string | null | undefined): Date | null {
  const m = DIA.exec(String(dia ?? "").slice(0, 10))
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

/** "dd/mm/yyyy" de un "yyyy-mm-dd" (sin pasar por Date: no corre de día con ninguna zona). "" si no sirve. */
export function fmtDia(dia: string | null | undefined): string {
  const m = DIA.exec(String(dia ?? "").slice(0, 10))
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ""
}

const ordinal = (dia: string) => {
  const m = DIA.exec(dia)
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000 : NaN
}

/** Días de calendario de `desde` a `hasta` (ambos "yyyy-mm-dd" o timestamps, que se pasan al día de Argentina). */
export function diasEntre(desde: string | Date, hasta: string | Date): number | null {
  const a = ordinal(diaArgentina(desde)), b = ordinal(diaArgentina(hasta))
  return Number.isFinite(a) && Number.isFinite(b) ? b - a : null
}

/** Cuántos días faltan para la rotura programada (negativo = vencida, 0 = hoy), contando desde hoy en Argentina. */
export function diasHasta(dia: string, ahora: Date = new Date()): number | null {
  return diasEntre(ahora, dia)
}

/** "yyyy-mm-dd" + n días. */
export function sumarDias(dia: string, n: number): string {
  const o = ordinal(dia)
  if (!Number.isFinite(o)) return ""
  return new Date((o + n) * 86_400_000).toISOString().slice(0, 10)
}

/** Última semana completa (lunes a domingo) antes de `ahora`, en días de Argentina. */
export function semanaAnterior(ahora: Date = new Date()): { desde: string; hasta: string } {
  const hoy = diaArgentina(ahora)
  const dow = new Date(ordinal(hoy) * 86_400_000).getUTCDay() // 0 = domingo
  const lunesEsta = sumarDias(hoy, -(dow === 0 ? 6 : dow - 1))
  return { desde: sumarDias(lunesEsta, -7), hasta: sumarDias(lunesEsta, -1) }
}

/** Límites de un rango de días de Argentina para filtrar un timestamptz (dispatch_date). */
export function limitesDias(desde: string, hasta: string): { gte: string; lte: string } {
  return { gte: `${desde}T00:00:00-03:00`, lte: `${hasta}T23:59:59.999-03:00` }
}

/**
 * Resistencia especificada (f'c, MPa) de una fórmula: la clase H del código (`H30-620-15 B (CAN)` → 30). Si el código
 * no la tiene, se busca en el nombre y la descripción. null si ninguna la tiene (RDC, cordones…).
 */
export function resistenciaDeFormula(...textos: (string | null | undefined)[]): number | null {
  for (const t of textos) {
    const m = String(t ?? "").match(/(?:^|[^A-Z])H-?\s?(\d{1,2})(?!\d)/i)
    if (m) return Number.parseInt(m[1], 10)
  }
  return null
}

export type Calibracion = {
  constant_a: number
  constant_b: number
  constant_c: number
  constant_d: number
  cylinder_diameter_cm: number
  force_unit?: string | null
}

/** Fuerza (en la unidad de la calibración) → Newton. */
export const FUERZA_A_NEWTON: Record<string, number> = { tf: 9806.65, kN: 1000, kgf: 9.80665, N: 1 }

/** MPa de una lectura de dial: Y = Ax³ + Bx² + Cx + D (en la unidad de la calibración) / área del cilindro. */
export function mpaDesdeDial(cal: Calibracion | null | undefined, dial: number): number | null {
  if (!cal || !Number.isFinite(dial)) return null
  const y = cal.constant_a * dial ** 3 + cal.constant_b * dial ** 2 + cal.constant_c * dial + cal.constant_d
  const r = Number(cal.cylinder_diameter_cm) / 100 / 2
  if (!(r > 0)) return null
  const factor = FUERZA_A_NEWTON[cal.force_unit || "tf"] ?? FUERZA_A_NEWTON.tf
  return (y * factor) / (Math.PI * r * r) / 1_000_000
}

/** Desvío estándar muestral (n − 1), el que usa el CIRSOC 201. 0 con menos de 2 valores. */
export function desvioMuestral(valores: number[]): number {
  const n = valores.length
  if (n < 2) return 0
  const media = valores.reduce((s, v) => s + v, 0) / n
  return Math.sqrt(valores.reduce((s, v) => s + (v - media) ** 2, 0) / (n - 1))
}

/** Límites de los intervalos del histograma (de a `ancho` MPa): el máximo siempre cae adentro del último. */
export function limitesHistograma(valores: number[], ancho = 2): { min: number; max: number } | null {
  if (!valores.length) return null
  const min = Math.floor(Math.min(...valores) / ancho) * ancho
  const max = Math.floor(Math.max(...valores) / ancho) * ancho + ancho
  return { min, max }
}
