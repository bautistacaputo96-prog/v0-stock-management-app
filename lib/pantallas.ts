/**
 * Cálculos puros de pantallas sueltas (auditoría de código 24/11/2026): Dashboard, Informe de producción y fórmulas.
 * Sin React ni Supabase, para probarlos con `node --test` (lib/__tests__/pantallas.test.mjs).
 */

// ---------------------------------------------------------------------------
// Fechas
// ---------------------------------------------------------------------------

/** "yyyy-mm-dd" del instante en la hora de la compu (no UTC: con toISOString o cortando el texto de la base, un
 *  despacho de las 21:30 de Argentina caía en el día siguiente). */
export function fechaLocal(x: string | number | Date): string {
  const d = new Date(x)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/** Filtro de días (yyyy-mm-dd) para una columna timestamptz, de 00:00 a 23:59:59 de Argentina (UTC−3 fijo). Sin el
 *  -03:00 la base toma la fecha como 00:00 UTC: el día "hasta" quedaba afuera y entraban las 21–24 h del día anterior
 *  al "desde". Vacío = sin ese extremo. */
export function rangoDiasAR(desde: string, hasta: string): { desde: string | null; hasta: string | null } {
  return {
    desde: desde ? `${desde}T00:00:00-03:00` : null,
    hasta: hasta ? `${hasta}T23:59:59.999-03:00` : null,
  }
}

// ---------------------------------------------------------------------------
// Dashboard: meses elegidos
// ---------------------------------------------------------------------------

/** Clave del mes como la arma el selector del Dashboard: "2026-10" = noviembre (mes de getMonth(), de 0 a 11). */
export function claveMes(x: string | number | Date): string {
  const d = new Date(x)
  return `${d.getFullYear()}-${d.getMonth()}`
}

/** ¿La fecha cae en alguno de los meses elegidos? (los meses sueltos no incluyen los del medio) */
export function enMeses(x: string | number | Date, meses: string[]): boolean {
  return meses.includes(claveMes(x))
}

/**
 * Días ya transcurridos de los meses elegidos, para el promedio diario: el mes en curso cuenta hasta hoy (no los días
 * que faltan) y los meses que todavía no empezaron no cuentan. Antes se dividía por el mes entero: el día 5 el
 * promedio salía 6 veces más bajo y "M3 Hoy" siempre daba arriba del promedio.
 */
export function diasTranscurridos(meses: string[], ahora: Date = new Date()): number {
  let dias = 0
  for (const k of new Set(meses)) {
    const [a, m] = k.split("-").map(Number)
    if (!Number.isFinite(a) || !Number.isFinite(m)) continue
    const inicio = new Date(a, m, 1)
    if (inicio > ahora) continue
    const delMes = new Date(a, m + 1, 0).getDate()
    dias += a === ahora.getFullYear() && m === ahora.getMonth() ? ahora.getDate() : delMes
  }
  return dias
}

// ---------------------------------------------------------------------------
// Informe de producción
// ---------------------------------------------------------------------------

export type FilaProduccion = {
  quantity_m3: number | string | null
  plant_id?: string | null
  formulas?: { code?: string | null; plant_id?: string | null } | null
  mixers?: { license_plate?: string | null } | null
}

/**
 * m³ por planta, fórmula o camión. La planta es la que despachó (no la de la fórmula: Hudson despacha con fórmulas
 * cargadas en Canning, y el filtro de planta ya era por la que despachó); los despachos viejos sin planta caen en la
 * de la fórmula.
 */
export function agruparProduccion(
  filas: FilaProduccion[],
  por: "plant" | "formula" | "mixer",
  plantas: { id: string; name: string }[],
): { name: string; volumen: number }[] {
  const nombrePlanta = new Map(plantas.map((p) => [p.id, p.name]))
  const suma = new Map<string, number>()
  for (const d of filas) {
    let k: string
    if (por === "plant") {
      const id = d.plant_id || d.formulas?.plant_id || ""
      k = (id && nombrePlanta.get(id)) || "Sin planta"
    } else if (por === "formula") k = d.formulas?.code || "Sin fórmula"
    else k = d.mixers?.license_plate || "Sin camión"
    suma.set(k, (suma.get(k) || 0) + (Number(d.quantity_m3) || 0))
  }
  return [...suma].map(([name, v]) => ({ name, volumen: Math.round(v * 100) / 100 }))
}

// ---------------------------------------------------------------------------
// Fórmulas
// ---------------------------------------------------------------------------

/** El primer material que aparece dos veces en la composición (la base no acepta dos filas del mismo material). */
export function materialRepetido(ids: (string | null | undefined)[]): string | null {
  const vistos = new Set<string>()
  for (const id of ids) {
    if (!id) continue
    if (vistos.has(id)) return id
    vistos.add(id)
  }
  return null
}
