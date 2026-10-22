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
