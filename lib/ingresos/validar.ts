/**
 * Controles de un ingreso de materia prima cargado a mano (diálogo "Registrar Ingreso" y "Editar Ingreso" del historial).
 * Funciones puras: se prueban con `npm run test:ingresos-zomatik` y `npm run test:ingresos-cantidad` (cantidad rara).
 */
import { KG_SOSPECHOSO, claveMaterial, enToneladas, faltaPorToneladas, normalizarRemito } from "@/lib/control-ingresos/cruce"
import { mismoRemitoCompleto, numeroCompleto } from "@/lib/ingresos-zomatik/plan"

/** Un árido o el cemento con menos de esto en kg seguramente se cargó en toneladas (32,76 en vez de 32760). El mismo
 *  límite que usa el control de ingresos para avisar "probable carga en toneladas". */
export { KG_SOSPECHOSO }

/** ¿El material viene en camiones de toneladas? (áridos y cemento) */
export const vaEnToneladas = (m: { name: string; tipo?: string | null } | null | undefined) =>
  !!m && (["arido_fino", "arido_grueso", "cemento"].includes(m.tipo || "") || enToneladas(claveMaterial(m.name)))

/** ¿La cantidad (kg) parece cargada en toneladas? Áridos y cemento con más de 0 y menos de 200 kg. */
export const pareceToneladas = (m: { name: string; tipo?: string | null } | null | undefined, kg: number) =>
  vaEnToneladas(m) && kg > 0 && kg < KG_SOSPECHOSO

/**
 * Aviso de un ingreso que parece cargado en toneladas (alta, edición e historial): el mismo texto que el control de
 * ingresos. null si no parece.
 */
export function avisoToneladas(m: { name: string; tipo?: string | null } | null | undefined, kg: number): { titulo: string; texto: string; kg: number } | null {
  if (!pareceToneladas(m, kg)) return null
  const t = kg.toLocaleString("es-AR", { maximumFractionDigits: 2 })
  const enKg = Math.round(kg * 1000 * 100) / 100
  return {
    titulo: "¿Son toneladas?",
    texto: `${t} t = ${enKg.toLocaleString("es-AR")} kg. La cantidad va en kg: si queda así, al stock le faltan ${Math.round(faltaPorToneladas(kg)).toLocaleString("es-AR")} kg.`,
    kg: enKg,
  }
}

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

/**
 * Cantidad rara (pedido del 25/11/2026: remito 885580 de piedra 6/20 cargado con 3.046 kg cuando los camiones de
 * Guerrico traen ~30.400): se compara con la mediana de los últimos ingresos del mismo material en la planta (del mismo
 * proveedor si hay suficientes). Todos los límites, acá.
 */
export const CANTIDAD_RARA = {
  /** Cuántos ingresos (los más nuevos, sin anular) se miran. */
  ultimos: 10,
  /** Con menos ingresos que esto no se avisa; también es lo mínimo del mismo proveedor para usar solo los suyos. */
  minimo: 3,
  /** Avisa si la cantidad es menos que esto por la mediana (60%)... */
  menorQue: 0.6,
  /** ...o más que esto por la mediana (150%). */
  mayorQue: 1.5,
} as const

/** Un ingreso anterior del mismo material (el que llama los pasa del más nuevo al más viejo, sin anulados). */
export type IngresoPrevio = { kg: number; supplier_id?: string | null }

export type ReferenciaCantidad = { mediana: number; n: number; delProveedor: boolean }

const mediana = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * La cantidad de referencia: mediana de los últimos `CANTIDAD_RARA.ultimos` ingresos del proveedor si tiene al menos
 * `CANTIDAD_RARA.minimo`; si no, de los últimos del material. null si no hay historial suficiente.
 */
export function referenciaCantidad(previos: IngresoPrevio[], supplierId?: string | null): ReferenciaCantidad | null {
  const validos = previos.filter((p) => Number.isFinite(p.kg) && p.kg > 0)
  const delProv = supplierId ? validos.filter((p) => p.supplier_id === supplierId).slice(0, CANTIDAD_RARA.ultimos) : []
  const delProveedor = delProv.length >= CANTIDAD_RARA.minimo
  const usados = delProveedor ? delProv : validos.slice(0, CANTIDAD_RARA.ultimos)
  if (usados.length < CANTIDAD_RARA.minimo) return null
  return { mediana: mediana(usados.map((p) => p.kg)), n: usados.length, delProveedor }
}

/** Redondeo para mostrar la referencia ("unos 30.400 kg"): a 100 desde 10.000, a 10 desde 1.000, si no a 1. */
const redondearRef = (n: number) => {
  const paso = n >= 10000 ? 100 : n >= 1000 ? 10 : 1
  return Math.round(n / paso) * paso
}

/**
 * Aviso de una cantidad muy distinta a los últimos ingresos (alta y edición). null si no hay historial suficiente, si
 * está dentro de los límites o si ya corresponde el aviso "¿Son toneladas?" (ese va primero: no dos carteles).
 */
export function avisoCantidadRara(
  m: { name: string; tipo?: string | null; unit?: string | null } | null | undefined,
  kg: number,
  previos: IngresoPrevio[],
  supplierId?: string | null,
): { titulo: string; texto: string; referencia: number; tipo: "menos" | "mas" } | null {
  if (!m || !Number.isFinite(kg) || kg <= 0) return null
  if (pareceToneladas(m, kg)) return null
  const ref = referenciaCantidad(previos, supplierId)
  if (!ref) return null
  const r = kg / ref.mediana
  if (r >= CANTIDAD_RARA.menorQue && r <= CANTIDAD_RARA.mayorQue) return null
  const unidad = (m.unit || "kg").trim()
  const enKg = unidad.toLowerCase() === "kg"
  const refR = redondearRef(ref.mediana)
  const refTxt = `${refR.toLocaleString("es-AR")} ${unidad}${enKg ? ` (${(refR / 1000).toLocaleString("es-AR", { maximumFractionDigits: 1 })} t)` : ""}`
  return {
    titulo: "¿Estás seguro?",
    texto: `Los últimos ingresos de ${m.name} fueron de unos ${refTxt}. Cargaste ${kg.toLocaleString("es-AR", { maximumFractionDigits: 2 })} ${unidad}.`,
    referencia: ref.mediana,
    tipo: r < CANTIDAD_RARA.menorQue ? "menos" : "mas",
  }
}
