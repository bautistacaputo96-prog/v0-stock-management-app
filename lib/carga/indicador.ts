/**
 * Indicador chico de la carga en la tarjeta del camión del Despacho (19.2): "En cola de carga · 1°" (o "· frenada"),
 * "Cargando · ciclo 1/2", "Carga parada" / "suspendida", "Cargado 12:41 · esperando salir". Después el GPS lo pasa a
 * "Yendo a obra" como siempre (el indicador desaparece).
 */
export type CargaIndicador = {
  id: string
  puesto_id: string
  mixer_id: string | null
  estado: string
  ciclo_actual: number | null
  ciclos: number | null
  fin_at: string | null
  created_at: string
  completa_carga_id?: string | null
  simulada: boolean
  bloqueo: { frena?: boolean } | null
  /** cómo se resolvió una parada: sale · completar · tirada */
  resolucion_modo?: string | null
  /** salida de la planta por GPS (viajes_gps.salida_planta), si ya salió */
  salida_gps?: string | null
}

export type Indicador = { texto: string; tono: "violet" | "bad" | "blue" | "dark" | "warn"; cargaId: string; simulada: boolean }

const COLA = ["pendiente", "bloqueada", "lista", "preparada"]
const pad = (n: number) => String(n).padStart(2, "0")
const hhmm = (t: string) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }

/** Por camión, el indicador de su carga más reciente. `esperaMaxMin`: cuánto se muestra "esperando salir" sin GPS. */
export function indicadoresPorCamion(cargas: CargaIndicador[], ahora: number, esperaMaxMin = 45): Record<string, Indicador> {
  const out: Record<string, Indicador> = {}
  const cola = cargas.filter((c) => COLA.includes(c.estado))
    .sort((a, b) => (b.completa_carga_id ? 1 : 0) - (a.completa_carga_id ? 1 : 0) || a.created_at.localeCompare(b.created_at))
  const recientes = [...cargas].sort((a, b) => b.created_at.localeCompare(a.created_at))
  const vistos = new Set<string>()
  for (const c of recientes) {
    // La carga más reciente del camión manda: si ya salió o se canceló, no se muestra nada
    if (!c.mixer_id || vistos.has(c.mixer_id)) continue
    vistos.add(c.mixer_id)
    let ind: Indicador | null = null
    if (COLA.includes(c.estado)) {
      const pos = cola.filter((x) => x.puesto_id === c.puesto_id).findIndex((x) => x.id === c.id) + 1
      const frena = c.estado === "bloqueada" || !!c.bloqueo?.frena
      ind = { texto: `En cola de carga · ${pos}°${frena ? " · frenada" : ""}`, tono: frena ? "bad" : "violet", cargaId: c.id, simulada: c.simulada }
    } else if (c.estado === "en_curso") ind = { texto: `Cargando · ciclo ${c.ciclo_actual || 1}/${c.ciclos || "?"}`, tono: "blue", cargaId: c.id, simulada: c.simulada }
    else if (c.estado === "suspendida") ind = { texto: "Carga suspendida", tono: "warn", cargaId: c.id, simulada: c.simulada }
    else if (c.estado === "parada" && !c.resolucion_modo) ind = { texto: "Carga parada", tono: "dark", cargaId: c.id, simulada: c.simulada }
    else if ((c.estado === "terminada" || c.estado === "ya_cargada_indumix" || (c.estado === "parada" && c.resolucion_modo === "sale")) && c.fin_at && !c.salida_gps && ahora - new Date(c.fin_at).getTime() < esperaMaxMin * 60_000)
      ind = { texto: `Cargado ${hhmm(c.fin_at)} · esperando salir`, tono: "violet", cargaId: c.id, simulada: c.simulada }
    if (ind) out[c.mixer_id] = ind
  }
  return out
}
