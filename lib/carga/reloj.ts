/**
 * Reloj de Indumix (carga-planta.md 10): vuelve a 1/1/1970 0:00 todos los días al prender la planta. Mientras está
 * prendido corre bien, pero la fecha no sirve. Toda hora que guarda el sistema es la del puente (la PC); la de Indumix
 * se guarda cruda, solo como dato, y sirve para estimar la hora de un reporte leído después.
 */

const pad = (n: number) => String(n).padStart(2, "0")

/** Segundos desde que se prendió → "4:57 - 1/1/1970" (como lo muestra Indumix). Pasadas 24 h, cambia el día. */
export function relojPlc(segundosDesdePrendida: number): string {
  const s = Math.max(0, Math.floor(segundosDesdePrendida))
  const dia = 1 + Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${h}:${pad(m)} - ${dia}/1/1970`
}

/** "4:57 - 1/1/1970" → segundos desde el 1/1/1970 0:00 del PLC (null si no se entiende). Acepta "4:57:12". */
export function segundosPlc(texto: string | null | undefined): number | null {
  const m = String(texto ?? "").match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*-?\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (!m) return null
  const [, h, mi, se, d, mes, a] = m
  if (Number(a) !== 1970 || Number(mes) !== 1) return null
  return (Number(d) - 1) * 86400 + Number(h) * 3600 + Number(mi) * 60 + Number(se || 0)
}

/** El reloj de Indumix volvió para atrás: se reinició (nuevo "día de Indumix"). Un minuto de margen. */
export function seReinicio(anteriorPlcSeg: number | null, actualPlcSeg: number | null): boolean {
  return anteriorPlcSeg != null && actualPlcSeg != null && actualPlcSeg < anteriorPlcSeg - 60
}

/**
 * Hora real estimada de una hora de Indumix, con una referencia del MISMO día de Indumix (lo que vio el puente:
 * en `puenteMs` el PLC decía `plcSeg`). Si la hora es posterior a la referencia más de un día, o no se entiende, null:
 * se une solo por remito y camión.
 */
export function horaEstimada(textoPlc: string | null | undefined, ref: { plcSeg: number; puenteMs: number }): number | null {
  const s = segundosPlc(textoPlc)
  if (s == null) return null
  const dif = s - ref.plcSeg
  if (Math.abs(dif) > 86400) return null
  return ref.puenteMs + dif * 1000
}

// ───────────────────────────── Indumix real (04/11/2026): fecha real, atrasada unas horas ─────────────────────────────
// El reloj de la planta de Canning NO vuelve a 1970: tiene la fecha real, atrasada 3 a 4 h, con espacios y sin segundos
// ("10 : 54 - 3/11/2026"). La hora real sale de la deriva que mide el puente (su hora contra la del PLC). Si alguna vez
// vuelve a 1970, vale lo de arriba (día de Indumix).

export type FechaPlc = { anio: number; mes: number; dia: number; h: number; mi: number }

/** "10 : 54 - 3/11/2026" o "4:57 - 1/1/1970" → partes (null si no se entiende). */
export function fechaPlc(texto: string | null | undefined): FechaPlc | null {
  const m = String(texto ?? "").match(/(\d{1,2})\s*:\s*(\d{1,2})(?:\s*:\s*\d{1,2})?\s*-\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})/)
  if (!m) return null
  const [h, mi, dia, mes, anio] = m.slice(1).map(Number)
  if (h > 23 || mi > 59 || dia < 1 || dia > 31 || mes < 1 || mes > 12) return null
  return { anio, mes, dia, h, mi }
}

/** El PLC no tiene fecha (1/1/1970): se usa la lógica del día de Indumix. */
export const esReloj1970 = (f: FechaPlc | null) => !!f && f.anio === 1970

/** Milisegundos de una hora del PLC leída como hora de Argentina (UTC−3, sin horario de verano). */
export function msPlc(f: FechaPlc): number {
  return Date.UTC(f.anio, f.mes - 1, f.dia, f.h + 3, f.mi)
}

/** "2026-11-03" (la fecha que dice el PLC). */
export const diaPlc = (f: FechaPlc) => `${f.anio}-${pad(f.mes)}-${pad(f.dia)}`

/**
 * Segundos que el reloj de Indumix va atrasado respecto del puente (positivo = atrasado). La resolución es de un minuto
 * (el PLC no tiene segundos). null si no se entiende o si el reloj está en 1970.
 */
export function derivaSegundos(plcTexto: string | null | undefined, puenteMs: number): number | null {
  const f = fechaPlc(plcTexto)
  if (!f || esReloj1970(f) || !Number.isFinite(puenteMs)) return null
  return Math.round((puenteMs - msPlc(f)) / 1000)
}

/**
 * Hora real (ms) de una hora del PLC, con la deriva medida. Con el reloj en 1970 hace falta una referencia del mismo día
 * de Indumix (`ref`, la de `horaEstimada`); sin ella, null.
 */
export function horaReal(plcTexto: string | null | undefined, derivaS: number | null | undefined, ref?: { plcSeg: number; puenteMs: number } | null): number | null {
  const f = fechaPlc(plcTexto)
  if (!f) return null
  if (esReloj1970(f)) return ref ? horaEstimada(plcTexto, ref) : null
  if (derivaS == null || !Number.isFinite(derivaS)) return null
  return msPlc(f) + derivaS * 1000
}

/** "−3 h 24 min" (la deriva, para mostrar). */
export function textoDeriva(derivaS: number | null | undefined): string {
  if (derivaS == null || !Number.isFinite(derivaS)) return ""
  const min = Math.round(Math.abs(derivaS) / 60)
  const signo = derivaS > 0 ? "−" : derivaS < 0 ? "+" : ""
  if (min === 0) return "en hora"
  return `${signo}${min >= 60 ? `${Math.floor(min / 60)} h ` : ""}${min % 60 ? `${min % 60} min` : ""}`.trim()
}
