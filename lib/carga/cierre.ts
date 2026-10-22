/**
 * Cierre de una carga: el ajuste de stock con los kilos reales (18.5) y qué pasa con el despacho cuando la carga sale
 * distinta (18.3 y 21.1).
 *
 * MODO SIMULADO: las cargas simuladas NUNCA mueven el stock ni tocan el despacho real. Lo de acá se calcula y se
 * muestra, pero `ajusteStockHabilitado` da false y `efectoSobreDespacho(...).aplicar` también. El ajuste queda
 * programado (función `ajustar_stock_carga` en la base) y apagado hasta que exista el puente real y Bautista prenda
 * `puestos_carga.usa_kilos_reales`.
 */
import { grupoDeSalida, type Grupo, type Salida } from "@/lib/carga/tipos"

export type MaterialReal = {
  salida: Salida
  material_id: string | null
  /** lo pesado, en la unidad de Indumix (aditivo en g) */
  real: number
  humedad_pct?: number | null
  /** de la unidad de Indumix a la del sistema (g → kg = 0,001) */
  factor: number
}

export type AjusteStock = { material_id: string; grupo: Grupo; teorico: number; real: number; ajuste: number }

/**
 * Un ajuste por material = real − teórico del despacho, en kg del sistema. Los áridos se pasan a seco con la humedad
 * que usó Indumix; el agua no descuenta stock (como hoy). Si el despacho se anuló ("se tiró"), el teórico es 0 y el
 * ajuste es todo lo pesado (pérdida).
 */
export function ajustesStock(materiales: MaterialReal[], teoricoDespacho: Record<string, number>, opciones: { anulado?: boolean } = {}): AjusteStock[] {
  const real = new Map<string, { kg: number; grupo: Grupo }>()
  for (const m of materiales) {
    if (!m.material_id) continue
    const g = grupoDeSalida(m.salida)
    if (g === "agua") continue
    let kg = (Number(m.real) || 0) * (m.factor || 1)
    if (g === "arido") kg = kg / (1 + (Number(m.humedad_pct) || 0) / 100)
    const prev = real.get(m.material_id)
    real.set(m.material_id, { kg: (prev?.kg || 0) + kg, grupo: g })
  }
  const ids = new Set([...real.keys(), ...Object.keys(teoricoDespacho)])
  const out: AjusteStock[] = []
  for (const id of ids) {
    const r = real.get(id)
    if (!r) continue // material del despacho que no pasa por la planta (fibra, aditivo de obra): no se toca
    const teo = opciones.anulado ? 0 : Number(teoricoDespacho[id] || 0)
    const aj = Math.round((r.kg - teo) * 1000) / 1000
    out.push({ material_id: id, grupo: r.grupo, teorico: Math.round(teo * 1000) / 1000, real: Math.round(r.kg * 1000) / 1000, ajuste: aj })
  }
  return out
}

/** ¿Se puede ajustar el stock con esta carga? Nunca con una simulada; con una real, solo si el puesto lo tiene prendido. */
export function ajusteStockHabilitado(c: { simulada: boolean; sistema: string; usa_kilos_reales: boolean }): boolean {
  if (c.simulada || c.sistema === "simulador") return false
  return c.usa_kilos_reales === true
}

export type ModoParada = "sale" | "completar" | "tirada"

export type EfectoDespacho = {
  accion: "editar_m3" | "nueva_carga" | "anular"
  /** m³ con que queda el despacho (sale con lo cargado) */
  m3_despacho?: number
  /** m³ que van en la otra carga (completar) */
  m3_falta?: number
  texto: string
  /** false con una carga simulada: solo se registra, el despacho real no se toca */
  aplicar: boolean
}

/** Qué pasa con el despacho cuando se para a mitad (18.3, con 21.1: se corrige el remito). */
export function efectoSobreDespacho(modo: ModoParada, d: { m3_despacho: number; m3_cargados: number; remito: string | null; simulada: boolean; esCompletar?: boolean }): EfectoDespacho {
  const cargados = Math.max(0, Math.round(d.m3_cargados * 10) / 10)
  const falta = Math.max(0, Math.round((d.m3_despacho - cargados) * 10) / 10)
  const rem = d.remito ? `el remito ${d.remito}` : "el despacho"
  const sim = d.simulada ? " (planta simulada: no se toca el despacho real, solo queda registrado)" : ""
  if (modo === "sale" || (modo === "completar" && d.esCompletar))
    return { accion: "editar_m3", m3_despacho: cargados, texto: `Se corrige ${rem} a ${cargados.toLocaleString("es-AR")} m³ y el pedido vuelve a tener ${falta.toLocaleString("es-AR")} m³ por enviar${sim}.`, aplicar: !d.simulada }
  if (modo === "completar")
    return { accion: "nueva_carga", m3_falta: falta, texto: `Los ${falta.toLocaleString("es-AR")} m³ que faltan van en otra carga del mismo camión y ${rem}, primera en la cola. El despacho no cambia.`, aplicar: true }
  return { accion: "anular", texto: `${rem[0].toUpperCase()}${rem.slice(1)} queda anulado, vuelve el stock teórico y lo pesado se registra como pérdida. El viaje vuelve a Viajes${sim}.`, aplicar: !d.simulada }
}
