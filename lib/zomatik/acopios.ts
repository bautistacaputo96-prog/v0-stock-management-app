/**
 * Zomatik · estado de los acopios (proyectos) en m³, sin pesos (spec 17.4, 18.1, 20.3 y 19.1.5). Funciones puras.
 *
 *   - Remitido: exacto, de los remitos del proyecto (solo hormigón).
 *   - Saldo %: lo que le queda de material según Zomatik (calculado con sus montos, que acá no se guardan).
 *   - Saldo ≈ m³ (proyecto por monto): remitido × saldo % ÷ consumido %. Se muestra con "≈".
 *   - Saldo exacto (proyecto por cantidades): pactado − remitido.
 *   - Aviso "saldo bajo": el saldo no alcanza para lo programado en los próximos 7 días, o queda menos del 15 %.
 *   - "Agotado": Zomatik da saldo 0 o negativo.
 */

export const DIAS_AVISO = 7
export const PCT_AVISO = 15

export type EstadoAcopio = "abierto" | "bajo" | "agotado" | "cerrado"

export type DatosAcopio = {
  tipo?: "monto" | "cantidades" | null
  pactado_m3?: number | null
  saldo_pct: number | null
  remitido_m3: number
  estado?: "abierto" | "cerrado" | string | null
}

export type SaldoAcopio = {
  /** % del material ya usado (0 a 100). */
  consumidoPct: number | null
  /** % que le queda (puede ser 0). */
  saldoPct: number | null
  /** m³ que le quedan: exacto si es por cantidades, estimado si es por monto (null si no se puede estimar). */
  saldoM3: number | null
  estimado: boolean
}

const r1 = (n: number) => Math.round(n * 10) / 10

export function saldoAcopio(a: DatosAcopio): SaldoAcopio {
  const remitido = Number(a.remitido_m3) || 0
  if (a.tipo === "cantidades" && a.pactado_m3 && a.pactado_m3 > 0) {
    const saldo = a.pactado_m3 - remitido
    return {
      consumidoPct: Math.min(100, Math.max(0, r1((remitido / a.pactado_m3) * 100))),
      saldoPct: Math.max(0, r1((saldo / a.pactado_m3) * 100)),
      saldoM3: r1(saldo),
      estimado: false,
    }
  }
  if (a.saldo_pct === null || a.saldo_pct === undefined || !Number.isFinite(Number(a.saldo_pct))) {
    return { consumidoPct: null, saldoPct: null, saldoM3: null, estimado: true }
  }
  const saldoPct = Math.max(0, Math.min(100, Number(a.saldo_pct)))
  const consumidoPct = r1(100 - saldoPct)
  let saldoM3: number | null = null
  if (saldoPct <= 0) saldoM3 = 0
  else if (consumidoPct > 0 && remitido > 0) saldoM3 = r1((remitido * saldoPct) / consumidoPct)
  return { consumidoPct, saldoPct: r1(saldoPct), saldoM3, estimado: true }
}

/** Estado para la pantalla. `programado7` = m³ programados contra el acopio en los próximos 7 días. */
export function estadoAcopio(a: DatosAcopio, programado7: number): EstadoAcopio {
  if (a.estado === "cerrado") return "cerrado"
  const s = saldoAcopio(a)
  if (s.saldoPct === null) return "abierto"
  if (s.saldoPct <= 0 || (s.saldoM3 !== null && s.saldoM3 <= 0)) return "agotado"
  if (s.saldoPct < PCT_AVISO) return "bajo"
  if (s.saldoM3 !== null && programado7 > s.saldoM3) return "bajo"
  return "abierto"
}

export type MovimientoDia = { fecha: string; remito: string; articulo: string | null; m3: number; es_hormigon?: boolean }

/** Detalle por día, del más nuevo al más viejo, con el remitido acumulado hasta ese renglón. */
export function detallePorDia(movs: MovimientoDia[]): (MovimientoDia & { acumulado: number })[] {
  const h = movs.filter((m) => m.es_hormigon !== false)
  const asc = [...h].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.remito.localeCompare(b.remito))
  let acc = 0
  const con = asc.map((m) => {
    acc = Math.round((acc + (Number(m.m3) || 0)) * 1000) / 1000
    return { ...m, acumulado: acc }
  })
  return con.reverse()
}

/** Programado contra el acopio: total a futuro y lo de los próximos `dias` días (fechas AAAA-MM-DD). */
export function programadoDesde(pedidos: { fecha: string; m3: number }[], hoy: string, dias = DIAS_AVISO): { total: number; proximos: number } {
  const lim = new Date(`${hoy}T12:00:00Z`)
  lim.setUTCDate(lim.getUTCDate() + dias)
  const hasta = lim.toISOString().slice(0, 10)
  let total = 0
  let proximos = 0
  for (const p of pedidos) {
    if (p.fecha < hoy) continue
    const m = Number(p.m3) || 0
    total += m
    if (p.fecha < hasta) proximos += m
  }
  return { total: r1(total), proximos: r1(proximos) }
}

/** "1.234,5" con coma decimal. */
export function m3(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—"
  return n.toLocaleString("es-AR", { maximumFractionDigits: 1 })
}
