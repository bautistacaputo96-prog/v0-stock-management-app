/**
 * Cómo se muestra una cantidad de stock.
 *
 * Los áridos y el cemento se manejan por toneladas, pero los materiales "finos"
 * (fibra, aditivos) se compran y dosifican en kilos o litros: mostrarlos en
 * toneladas (0,4 t) no le dice nada a nadie. Para esos se mantiene la unidad.
 */

export function esMaterialFino(nombre?: string | null, unidad?: string | null): boolean {
  if (unidad && /^l/i.test(unidad)) return true
  return /fibra|sikament|superfluid|aditivo|plastif|acelerante|retardante|incorporador/i.test(nombre || "")
}

/**
 * Formatea un valor de stock según el material.
 *  - fino: "414 kg" / "1.250 kg" (nunca toneladas)
 *  - resto: ≥ 1.000 → "12,5 t", si no "850 kg"
 */
export function formatStock(valor: number, nombre?: string | null, unidad?: string | null, opts?: { decimalesT?: number; espacio?: boolean }): string {
  const v = Number(valor) || 0
  const sep = opts?.espacio === false ? "" : " "
  const u = unidad || "kg"
  if (esMaterialFino(nombre, u)) {
    return `${v.toLocaleString("es-AR", { maximumFractionDigits: Math.abs(v) < 10 ? 1 : 0 })}${sep}${u}`
  }
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(opts?.decimalesT ?? 1)}${sep}t`
  return `${Math.round(v).toLocaleString("es-AR")}${sep}${u}`
}
