/**
 * Controles de un ingreso de materia prima cargado a mano (diálogo "Registrar Ingreso" y "Editar Ingreso" del historial).
 * Funciones puras: se prueban con `npm run test:ingresos-zomatik`.
 */
import { claveMaterial, enToneladas, normalizarRemito } from "@/lib/control-ingresos/cruce"
import { mismoRemitoCompleto, numeroCompleto } from "@/lib/ingresos-zomatik/plan"

/** Un árido o el cemento con menos de esto en kg seguramente se cargó en toneladas (32,76 en vez de 32760). */
export const KG_SOSPECHOSO = 200

/** ¿El material viene en camiones de toneladas? (áridos y cemento) */
export const vaEnToneladas = (m: { name: string; tipo?: string | null } | null | undefined) =>
  !!m && (["arido_fino", "arido_grueso", "cemento"].includes(m.tipo || "") || enToneladas(claveMaterial(m.name)))

/** ¿La cantidad (kg) parece cargada en toneladas? Áridos y cemento con más de 0 y menos de 200 kg. */
export const pareceToneladas = (m: { name: string; tipo?: string | null } | null | undefined, kg: number) =>
  vaEnToneladas(m) && kg > 0 && kg < KG_SOSPECHOSO

/** Un ingreso ya cargado (de cualquier planta) para buscar el remito repetido. */
export type IngresoCargado = { id: string; remito: string | null; origen?: string | null; material: string | null; plant_id?: string | null }

export type RemitoRepetido = {
  /** zomatik = ya entró desde Zomatik · mismo = mismo remito completo · parecido = mismo número, uno sin punto de venta */
  tipo: "zomatik" | "mismo" | "parecido"
  fila: IngresoCargado
  /** El ingreso está en otra planta que la del material elegido. */
  otraPlanta: boolean
}

const mismoMaterial = (a: string | null | undefined, b: string | null | undefined) => {
  const ca = claveMaterial(a)
  const cb = claveMaterial(b)
  if (ca || cb) return ca === cb
  return String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase()
}

/**
 * ¿El remito ya está cargado? Mismo material (por nombre, en cualquier planta: un camión no descarga en las dos), sin
 * anular. `filas` = los ingresos de la ventana de fechas (el que llama filtra fechas y anulados).
 *   zomatik:  entró desde Zomatik con el mismo número (sin punto de venta, como lo compara el robot)
 *   mismo:    el mismo remito completo (punto de venta + número), de cualquier origen
 *   parecido: el mismo número y a uno de los dos le falta el punto de venta ("318903" y "0002-00318903"): se pregunta
 */
export function remitoRepetido(
  remito: string,
  material: { name: string; plant_id?: string | null },
  filas: IngresoCargado[],
): RemitoRepetido | null {
  const nro = normalizarRemito(remito)
  if (!nro) return null
  const candidatas = filas.filter((f) => mismoMaterial(f.material, material.name) && normalizarRemito(f.remito) === nro)
  const con = (tipo: RemitoRepetido["tipo"], f: IngresoCargado): RemitoRepetido => ({
    tipo,
    fila: f,
    otraPlanta: !!material.plant_id && !!f.plant_id && f.plant_id !== material.plant_id,
  })
  const z = candidatas.find((f) => f.origen === "zomatik")
  if (z) return con("zomatik", z)
  const m = candidatas.find((f) => mismoRemitoCompleto(f.remito, remito))
  if (m) return con("mismo", m)
  const sinPv = (r: unknown) => !String(numeroCompleto(r) ?? "").includes("-")
  const p = candidatas.find((f) => sinPv(f.remito) || sinPv(remito))
  if (p) return con("parecido", p)
  return null
}
