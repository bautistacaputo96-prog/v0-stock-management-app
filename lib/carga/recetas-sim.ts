/**
 * Las 20 recetas con que arranca el simulador (carga-planta.md 7.2): 1 a 16 fijas (las fórmulas más usadas de la
 * planta), 17 y 18 rotativas, 19 una receta sin fórmula ("PRUEBA AGUA") y 20 vacía.
 *
 * Cada receta sale de la fórmula, pasada a las salidas de la planta con el mapa de salidas. La H30-612-15 B va en la
 * 13 con los valores REALES de la foto de Indumix (CP 40 = 350 y Agua = 110 contra 330 y 168 de la fórmula), para que
 * el simulador muestre el problema de verdad: el cemento frena y el agua se resalta.
 */
import { valoresDeseados } from "@/lib/carga/receta"
import { INFO_SALIDA, SALIDAS, type FormulaSistema, type MaterialSistema, type RecetaPlanta, type Salida, type SalidaMapa } from "@/lib/carga/tipos"

export type FormulaConUso = FormulaSistema & { usos: number }

/** Nombre corto para Indumix: sin "(CAN)" y en mayúsculas, como en la planta (máx. 20). */
export const nombreParaIndumix = (code: string) => code.replace(/\s*\((CAN|HUD)\)\s*$/i, "").toUpperCase().slice(0, 20)

/** La fórmula pasada a una receta de la planta (con el mapa de salidas). Los materiales sin salida no se ponen. */
export function recetaDesdeFormula(numero: number, f: FormulaSistema, salidas: SalidaMapa[], materiales: MaterialSistema[]): RecetaPlanta {
  const valores = valoresDeseados(f, salidas, materiales, null)
  // Orden de pesaje de los áridos: primero la arena (Tolva 3), después las piedras, al final la 0/6
  const orden: Partial<Record<Salida, number>> = {}
  let i = 1
  for (const s of ["arido_3", "arido_1", "arido_4", "arido_2"] as Salida[]) if (valores[s]) orden[s] = i++
  return {
    numero, nombre: nombreParaIndumix(f.code), habilitada: true,
    salidas: SALIDAS.map((s) => ({
      salida: s, nombre_planta: salidas.find((x) => x.salida === s)?.nombre_planta || INFO_SALIDA[s].nombre,
      valor: valores[s] || 0, unidad: INFO_SALIDA[s].unidad, ...(orden[s] ? { orden: orden[s] } : {}),
    })),
  }
}

const RECETA_REAL_13 = "H30-612-15 B (CAN)"

/**
 * Arma las 20. Devuelve las recetas y qué fórmula va en cada número (para `puesto_recetas`).
 */
export function recetasIniciales(formulas: FormulaConUso[], salidas: SalidaMapa[], materiales: MaterialSistema[]): {
  recetas: RecetaPlanta[]
  mapeo: { numero: number; formula_id: string | null; tipo: "fija" | "rotativa" }[]
} {
  const conMat = formulas.filter((f) => f.materiales.some((m) => m.cantidad > 0))
  const ordenadas = [...conMat].sort((a, b) => b.usos - a.usos || a.code.localeCompare(b.code))
  const real13 = conMat.find((f) => f.code === RECETA_REAL_13) || null
  const resto = ordenadas.filter((f) => f !== real13)
  const slots: (FormulaConUso | null)[] = []
  for (let n = 1; n <= 18; n++) slots.push(n === 13 && real13 ? real13 : resto.shift() || null)
  const recetas: RecetaPlanta[] = []
  const mapeo: { numero: number; formula_id: string | null; tipo: "fija" | "rotativa" }[] = []
  slots.forEach((f, i) => {
    const n = i + 1
    const tipo = n <= 16 ? "fija" : "rotativa"
    if (!f) {
      recetas.push({ numero: n, nombre: "", habilitada: true, salidas: SALIDAS.map((s) => ({ salida: s, nombre_planta: INFO_SALIDA[s].nombre, valor: 0, unidad: INFO_SALIDA[s].unidad })) })
      mapeo.push({ numero: n, formula_id: null, tipo })
      return
    }
    const r = recetaDesdeFormula(n, f, salidas, materiales)
    if (f === real13) {
      // Foto de Indumix, receta 13: CP 40 350 y Agua 110 (el resto igual a la fórmula)
      for (const s of r.salidas) {
        if (s.salida === "cemento_1") s.valor = 350
        if (s.salida === "agua") s.valor = 110
        if (s.salida === "aditivo_1" && s.valor) s.valor = 2800
      }
      r.nombre = "H30-612-15 B"
    }
    recetas.push(r)
    mapeo.push({ numero: n, formula_id: f.id, tipo })
  })
  // 19: una receta de prueba sin fórmula; 20: vacía
  const v19: Partial<Record<Salida, number>> = { arido_2: 200, arido_3: 900, cemento_1: 250, agua: 190 }
  recetas.push({ numero: 19, nombre: "PRUEBA AGUA", habilitada: true, salidas: SALIDAS.map((s) => ({ salida: s, nombre_planta: salidas.find((x) => x.salida === s)?.nombre_planta || INFO_SALIDA[s].nombre, valor: v19[s] || 0, unidad: INFO_SALIDA[s].unidad, ...(s === "arido_3" ? { orden: 1 } : s === "arido_2" ? { orden: 2 } : {}) })) })
  mapeo.push({ numero: 19, formula_id: null, tipo: "rotativa" })
  recetas.push({ numero: 20, nombre: "", habilitada: true, salidas: SALIDAS.map((s) => ({ salida: s, nombre_planta: INFO_SALIDA[s].nombre, valor: 0, unidad: INFO_SALIDA[s].unidad })) })
  mapeo.push({ numero: 20, formula_id: null, tipo: "rotativa" })
  return { recetas, mapeo }
}
