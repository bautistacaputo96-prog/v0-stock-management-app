/**
 * Reparto de camiones por planta (docs/specs/2026-11-04-camiones-por-planta.md).
 *
 * Motor puro (sin React ni Supabase) que arma el día de las DOS plantas a la vez con el planificador de siempre
 * (lib/planificador.ts → planificar) y los tiempos de lib/viajes.ts:
 *   paso 1 — cuántos camiones necesita cada pedido solo (el menor N que "alcanza", REGLAS_REPARTO);
 *   paso 2 — los pedidos en orden de primera carga; para cada uno, los camiones más baratos (primero los que ya
 *            están en la planta: cada traslado gasta) y planificar() con los viajes ya armados como ocupados;
 *   paso 3 — la bomba no espera: le saca camiones a un directo que se superpone (nunca lo deja en 0);
 *   paso 4 — los tramos de cada camión y las franjas del día (se deducen de los viajes);
 *   paso 5 — dónde duermen (se quedan donde terminan, salvo que mañana a una planta le falten para arrancar).
 * Con un reparto guardado o editado (3.4) los pasos 2 a 4 corren con esa restricción: un camión solo carga en una
 * planta dentro de sus tramos en esa planta.
 * Al final, la carga y el guardado en la base (tablas reparto_camiones y traslados_plantas; si la migración no está
 * aplicada, todo sigue como antes: sin reparto).
 */
import { planificar, aMin, aHora, type Parametros, type Camion, type Ocupado, type Pedido, type Plan } from "@/lib/planificador"
import {
  entradaPedido, pedidoParaPlan, filasDelPlan, explicarFlota, choquesDeCamion, textoConMenosCamiones, viajeMinDe, conBombaDe,
  type PedidoParaViajes, type ViajeRow,
} from "@/lib/viajes"

const MIN = 60_000
/** "Nunca" en minutos del día (el planificador necesita números, no Infinity) */
const H = 36 * 60

/**
 * Reglas para decir que N camiones "alcanzan" (punto 3.2) y otros números del reparto, en un solo lugar.
 * Los umbrales son los recomendados mientras Bautista no conteste la pregunta 3.
 */
export const REGLAS_REPARTO = {
  /** Bomba (no puede esperar): ningún corte entre camiones de más de corteMax y termina como mucho demoraMax tarde */
  bomba: { corteMax: 10, demoraMax: 20 },
  /** Directo */
  directo: { corteMax: 20, demoraMax: 30 },
  /** Traslado entre plantas si no está cargado ni hay ruta del mapa (marcado "a confirmar") */
  trasladoSinDatoMin: 60,
  /** Dónde duermen: cuenta los camiones que la sugerencia del día siguiente usa antes de esta hora */
  horaArranque: "10:00",
  /** En los textos, las esperas de la obra más cortas que esto no se nombran */
  esperaVisibleMin: 5,
  /** Cambios de planta por camión en el editor */
  maxCambios: 3,
}
export type ReglasReparto = typeof REGLAS_REPARTO

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------
/** prm = los parámetros efectivos de la planta (con lo real del GPS, parametrosConGps) */
export type PlantaReparto = { id: string; nombre: string; prm: Parametros }
/** amanece = la planta donde durmió (reparto del día anterior); null = a confirmar */
export type CamionReparto = {
  id: string; patente: string; capacidad: number; amanece: string | null
  /** Escenarios (+1, +2): camión ficticio disponible recién desde esta hora (minutos del día) */
  disponibleDesde?: number
}
export type Traslado = { minutos: number; km: number | null; litros: number | null; fuente: "cargado" | "ruta" | "sin_dato"; aConfirmar: boolean }
/** desde = minutos del día en que el camión está en esa planta (llegada del traslado); null = desde que arranca el día */
export type Tramo = { plantId: string; desde: number | null }
export type RepartoCamion = { sale: boolean; tramos: Tramo[]; duerme: string | null }
/** Por camión (mixer_id). Un camión con tramos vacíos no tiene restricción (puede cargar en las dos plantas). */
export type Reparto = Record<string, RepartoCamion>
/** p = el pedido con los tiempos del GPS (conTiemposGps); existentes = sus viajes guardados */
export type PedidoReparto = { p: PedidoParaViajes; existentes: ViajeRow[]; obra: string }

/** Un viaje del día en minutos (del armado o fijo: ya despachado) */
export type ViajeDia = {
  pedidoId: string; plantId: string; camionId: string; n: number; m3: number
  inicioCarga: number; salida: number; llegada: number; finDescarga: number; vuelta: number; esperaObra: number
  fijo: boolean
}

export type EntradaDia = {
  /** 00:00 del día (hora local, ms) */
  base: number
  plantas: PlantaReparto[]
  /** Los camiones que salen ese día */
  camiones: CamionReparto[]
  pedidos: PedidoReparto[]
  traslado: Traslado
  /** Viajes ya despachados del día (cualquier planta): quedan fijos y cuentan como ocupados */
  fijos?: ViajeRow[]
  /** Reparto guardado o en edición (3.4); sin esto, la sugerencia libre */
  reparto?: Reparto | null
  reglas?: ReglasReparto
  /** Para revisar a mano (pruebas): camiones como máximo por pedido, sin buscar otra combinación */
  topesFijos?: Record<string, number>
  /**
   * Pedidos que no se rearman (viajes ajustados a mano en el gerenciador): quedan con sus viajes guardados, que van
   * también en `fijos` para que ocupen a sus camiones y la boca.
   */
  fijados?: Set<string>
}

export type Medida = { fin: number; finIdeal: number; cortes: number[]; maxCorte: number; demora: number }

export type ResultadoPedido = {
  id: string; plantId: string; obra: string; conBomba: boolean
  /** Paso 1: el menor N que alcanza con el pedido solo */
  necesarios: number
  /** Para no cortar nada (explicarFlota) */
  flotaIdeal: number
  ritmo: number
  viajes: ViajeDia[]
  filas: ViajeRow[]
  camiones: string[]
  medida: Medida
  alcanza: boolean
  /** Camiones que tuvieron que pasar de la otra planta para este pedido */
  traslados: number
  /** "Con 4 termina 17:45 pero suma un traslado" */
  alternativa: { n: number; fin: number; trasladosExtra: number } | null
  /** Obra de la bomba a la que este directo le cedió camiones (paso 3) */
  cedeA: string | null
  /** Bomba que no alcanza y no hay de dónde sacar camiones */
  sinArreglo: boolean
  primeraCargaIdeal: number
  ultimaVueltaIdeal: number
  finJornada: number
  estado: "verde" | "ambar" | "rojo"
  texto: string
}

/** Lo que hace un camión en una planta durante el día */
export type TramoCalc = { plantId: string; desde: number | null; viajes: number; primeraCarga: number | null; ultimaVuelta: number | null }
/** Un traslado del día (sale de `de`, llega a `a`) */
export type TrasladoCamion = { camionId: string; de: string; a: string; sale: number; llega: number }
export type Aviso = { nivel: "rojo" | "ambar" | "info"; texto: string; pedidoId?: string; camionId?: string }

export type ResultadoDia = {
  pedidos: ResultadoPedido[]
  viajes: ViajeDia[]
  /** Tramos de cada camión: deducidos de los viajes (sugerencia) o los del reparto (3.4) */
  tramos: Record<string, TramoCalc[]>
  traslados: TrasladoCamion[]
  /** Camiones que arrancan en otra planta que donde durmieron, sin hora (reparto a mano) */
  arranquesMovidos: string[]
  avisos: Aviso[]
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
const hora = (m: number) => aHora(Math.round(m))
const esperaDe = (pl: PlantaReparto | undefined) => Math.max(0, Number(pl?.prm.esperaPlantaMin) || 0)
const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios)
const camionesTxt = (n: number) => `${n} ${plural(n, "camión", "camiones")}`

/** Minutos de traslado entre dos plantas (0 si es la misma). */
export function trasladoEntre(a: string | null | undefined, b: string | null | undefined, t: Traslado): number {
  return !a || !b || a === b ? 0 : t.minutos
}

/**
 * El traslado que usa el motor: el cargado en traslados_plantas; si no, la ruta del mapa; si no, 60 min. Los dos
 * últimos van con la marca "a confirmar".
 */
export function trasladoDe(
  fila: { minutos?: number | null; km?: number | null; litros?: number | null } | null | undefined,
  ruta?: { minutos?: number | null; km?: number | null } | null,
  reglas: ReglasReparto = REGLAS_REPARTO,
): Traslado {
  const n = (v: unknown) => (Number(v) > 0 ? Number(v) : null)
  if (fila && n(fila.minutos)) return { minutos: Math.round(n(fila.minutos)!), km: n(fila.km), litros: n(fila.litros), fuente: "cargado", aConfirmar: false }
  if (ruta && n(ruta.minutos)) return { minutos: Math.round(n(ruta.minutos)!), km: n(ruta.km), litros: null, fuente: "ruta", aConfirmar: true }
  return { minutos: reglas.trasladoSinDatoMin, km: null, litros: null, fuente: "sin_dato", aConfirmar: true }
}

/** Camiones virtuales sin límite (el cronograma ideal, como generarViajes) */
const virtuales = (n: number): Camion[] => Array.from({ length: n }, (_, i) => ({ id: `v${i}`, patente: "", capacidad: 1000 }))

/** Cortes, fin y demora de los viajes de un pedido contra su fin ideal. */
export function medir(viajes: { finDescarga: number; esperaObra: number }[], finIdeal: number): Medida {
  const fin = viajes.length ? Math.max(...viajes.map((v) => v.finDescarga)) : finIdeal
  const cortes = viajes.map((v) => Math.round(v.esperaObra)).filter((x) => x > 0)
  return { fin, finIdeal, cortes, maxCorte: cortes.length ? Math.max(...cortes) : 0, demora: Math.round(fin - finIdeal) }
}

/** ¿Alcanzan? Bomba: cortes de hasta 10 min y hasta 20 min tarde; directo: 20 y 30 (REGLAS_REPARTO). */
export function alcanza(m: { maxCorte: number; demora: number }, conBomba: boolean, reglas: ReglasReparto = REGLAS_REPARTO): boolean {
  const r = conBomba ? reglas.bomba : reglas.directo
  return m.maxCorte <= r.corteMax && m.demora <= r.demoraMax
}

// ---------------------------------------------------------------------------
// Paso 1: cuántos camiones necesita cada pedido, solo
// ---------------------------------------------------------------------------
export type Minimos = { necesarios: number; flotaIdeal: number; ritmo: number; ideal: Plan; medidas: { n: number; medida: Medida; alcanza: boolean }[] }

/** El cronograma ideal (sin límite de camiones) y el menor N (1, 2, … hasta el ideal) que alcanza. */
export function camionesMinimos(p: PedidoParaViajes, ped: Pedido, prm: Parametros, reglas: ReglasReparto = REGLAS_REPARTO): Minimos {
  const tam = ped.m3PorViaje && ped.m3PorViaje > 0 ? ped.m3PorViaje : 8
  const ideal = planificar([ped], virtuales(Math.ceil(ped.m3 / tam) + 1), prm)
  const finIdeal = ideal.viajes.length ? Math.max(...ideal.viajes.map((v) => v.finDescarga)) : 0
  const flota = explicarFlota(p, prm, ideal.viajes.length)
  const medidas: Minimos["medidas"] = []
  for (let n = 1; n <= flota.necesarios; n++) {
    const pl = planificar([ped], virtuales(n), prm)
    const medida = medir(pl.viajes, finIdeal)
    const ok = alcanza(medida, ped.conBomba, reglas)
    medidas.push({ n, medida, alcanza: ok })
    if (ok) return { necesarios: n, flotaIdeal: flota.necesarios, ritmo: flota.ritmo, ideal, medidas }
  }
  return { necesarios: flota.necesarios, flotaIdeal: flota.necesarios, ritmo: flota.ritmo, ideal, medidas }
}

// ---------------------------------------------------------------------------
// Ventanas ocupadas de un camión en una planta (traslados y reparto)
// ---------------------------------------------------------------------------
type Ctx = { plantas: Map<string, PlantaReparto>; traslado: Traslado; reparto: Reparto | null }

/** Ventanas en que el camión NO puede usarse en `plantId` (para planificar), en minutos del día. */
function ventanasCamion(c: CamionReparto, plantId: string, viajes: ViajeDia[], ctx: Ctx): Ocupado[] {
  const T = ctx.traslado.minutos
  const espAca = esperaDe(ctx.plantas.get(plantId))
  const out: Ocupado[] = []
  for (const v of viajes) {
    if (v.camionId !== c.id) continue
    if (v.plantId === plantId) out.push({ camionId: c.id, desde: v.inicioCarga, hasta: v.vuelta })
    // Un viaje de la otra planta: tiene que salir de acá a tiempo para llegar, esperar y cargar allá; vuelve después
    else out.push({ camionId: c.id, desde: v.inicioCarga - T - esperaDe(ctx.plantas.get(v.plantId)) + espAca, hasta: v.vuelta + T })
  }
  const r = ctx.reparto?.[c.id]
  if (r && r.tramos.length) {
    // 3.4: solo dentro de sus tramos en esta planta. Fuera de ellos, ocupado (el planificador suma la espera de acá
    // al final de cada ventana: llega, espera y carga; y para que pueda volver justo a la hora de salir, la ventana
    // que empieza al salir se corre esa misma espera).
    const permitidas: [number, number][] = []
    r.tramos.forEach((t, i) => {
      if (t.plantId !== plantId) return
      const sig = r.tramos[i + 1]
      permitidas.push([t.desde ?? -H, sig && sig.desde != null ? sig.desde - T : H])
    })
    let prev = -H
    for (const [a, b] of permitidas) {
      if (a > prev) out.push({ camionId: c.id, desde: prev === -H ? -H : prev + espAca, hasta: a })
      prev = Math.max(prev, b)
    }
    if (prev < H) out.push({ camionId: c.id, desde: prev === -H ? -H : prev + espAca, hasta: H })
  } else if (!r?.tramos.length && c.amanece && c.amanece !== plantId) {
    // Durmió en la otra planta: sale a primera hora y llega después del traslado
    const ini = aMin(ctx.plantas.get(c.amanece)?.prm.inicioJornada || "07:00")
    out.push({ camionId: c.id, desde: -H, hasta: ini + T })
  }
  // Camión ficticio de un escenario: carga recién desde su hora (el planificador suma la espera al final de la ventana)
  if (c.disponibleDesde != null) out.push({ camionId: c.id, desde: -H, hasta: c.disponibleDesde - espAca })
  return out
}

/** Primer momento ≥ t en que el camión podría hacer un ciclo de `ciclo` min sin pisar sus ventanas (como primerHueco). */
function primerLibre(ventanas: Ocupado[], t: number, ciclo: number, esperaAca: number) {
  let x = t
  for (let k = 0; k < 60; k++) {
    const w = ventanas.find((o) => x < o.hasta + esperaAca && x + ciclo > o.desde)
    if (!w) return x
    x = w.hasta + esperaAca
    if (x >= H) return H
  }
  return x
}

/** Dónde está el camión a la hora t: su tramo (reparto) o la planta de su último viaje, si no donde durmió. */
function ubicacion(c: CamionReparto, t: number, viajes: ViajeDia[], ctx: Ctx): string | null {
  const r = ctx.reparto?.[c.id]
  if (r && r.tramos.length) {
    let pl = r.tramos[0].plantId
    for (const tr of r.tramos) if ((tr.desde ?? -H) <= t) pl = tr.plantId
    return pl
  }
  let ult: ViajeDia | null = null
  for (const v of viajes) if (v.camionId === c.id && v.inicioCarga <= t && (!ult || v.inicioCarga > ult.inicioCarga)) ult = v
  return ult ? ult.plantId : c.amanece
}

/** Viajes guardados (ISO) → viajes del día en minutos */
function viajeDeFila(v: ViajeRow, base: number, plantDe: (pedidoId: string) => string | null): ViajeDia | null {
  if (!v.mixer_id || v.estado === "cancelado") return null
  const m = (iso: string) => (new Date(iso).getTime() - base) / MIN
  const plantId = v.plant_id || plantDe(v.pedido_id)
  if (!plantId) return null
  return {
    pedidoId: v.pedido_id, plantId, camionId: v.mixer_id, n: v.n, m3: Number(v.m3),
    inicioCarga: m(v.hora_carga), salida: m(v.hora_salida), llegada: m(v.hora_llegada), finDescarga: m(v.hora_fin_descarga), vuelta: m(v.hora_vuelta),
    esperaObra: 0, fijo: true,
  }
}

// ---------------------------------------------------------------------------
// Un pedido con los camiones elegidos (lo usan armarDia y el gerenciador)
// ---------------------------------------------------------------------------
/**
 * El cronograma de un pedido con estos camiones: planificar() con el pedido solo, los camiones dados (en ese orden),
 * sus ventanas ocupadas y las cargas de otros pedidos en la boca. Devuelve los viajes en minutos y como filas.
 */
export function cronogramaPedido(args: {
  p: PedidoParaViajes; ped: Pedido; prm: Parametros; base: number; existentes: ViajeRow[]
  camiones: Camion[]; ocupados?: Ocupado[]; cargasOcupadas?: { desde: number; hasta: number }[]
}): { plan: Plan; filas: ViajeRow[] } {
  const plan = planificar([args.ped], args.camiones, args.prm, args.ocupados || [], args.cargasOcupadas || [])
  return { plan, filas: filasDelPlan(args.p, args.base, plan.viajes, args.existentes) }
}

// ---------------------------------------------------------------------------
// Pasos 2 y 3: armar el día con las dos plantas
// ---------------------------------------------------------------------------
type Info = {
  pr: PedidoReparto; ped: Pedido; plantId: string; prm: Parametros; min: Minimos
  primeraCarga: number; ultimaVuelta: number; finIdeal: number; ciclo: number; orden: number
}

function prepararPedidos(ent: EntradaDia, reglas: ReglasReparto): Info[] {
  const plantas = new Map(ent.plantas.map((p) => [p.id, p]))
  const out: Info[] = []
  for (const pr of ent.pedidos) {
    const p = pr.p
    if (p.status === "completed" || p.status === "cancelled") continue
    const pl = plantas.get(p.plant_id)
    if (!pl) continue
    const e = entradaPedido(p, pr.existentes, pl.prm)
    if (e.pendiente <= 0.01) continue
    const ped = pedidoParaPlan(p, e.pendiente, e.llegada + (e.base - ent.base) / MIN, pr.obra)
    const min = camionesMinimos(p, ped, pl.prm, reglas)
    const vs = min.ideal.viajes
    if (!vs.length) continue
    out.push({
      pr, ped, plantId: p.plant_id, prm: pl.prm, min,
      primeraCarga: vs[0].inicioCarga, ultimaVuelta: Math.max(...vs.map((v) => v.vuelta)), finIdeal: Math.max(...vs.map((v) => v.finDescarga)),
      ciclo: explicarFlota(p, pl.prm, vs.length).ciclo, orden: 0,
    })
  }
  out.sort((a, b) => a.primeraCarga - b.primeraCarga || a.ped.llegada - b.ped.llegada || a.ped.id.localeCompare(b.ped.id))
  out.forEach((x, i) => (x.orden = i))
  return out
}

type Parcial = Omit<ResultadoPedido, "estado" | "texto" | "cedeA" | "sinArreglo">

/** Un pedido que no se rearma: sus viajes pendientes guardados, tal cual, medidos contra el ideal */
function pedidoFijado(x: Info, ent: EntradaDia, reglas: ReglasReparto): Parcial {
  const m = (iso: string) => (new Date(iso).getTime() - ent.base) / MIN
  const propios = x.pr.existentes.filter((v) => v.estado === "planificado").sort((a, b) => m(a.hora_llegada) - m(b.hora_llegada))
  const vs: ViajeDia[] = propios.map((v, i) => ({
    pedidoId: x.ped.id, plantId: x.plantId, camionId: v.mixer_id || "", n: v.n, m3: Number(v.m3),
    inicioCarga: m(v.hora_carga), salida: m(v.hora_salida), llegada: m(v.hora_llegada), finDescarga: m(v.hora_fin_descarga), vuelta: m(v.hora_vuelta),
    esperaObra: i ? Math.max(0, Math.round(m(v.hora_llegada) - m(propios[i - 1].hora_fin_descarga))) : 0, fijo: true,
  }))
  const medida = medir(vs, x.finIdeal)
  return {
    id: x.ped.id, plantId: x.plantId, obra: x.pr.obra, conBomba: x.ped.conBomba, necesarios: x.min.necesarios, flotaIdeal: x.min.flotaIdeal, ritmo: x.min.ritmo,
    primeraCargaIdeal: x.primeraCarga, ultimaVueltaIdeal: x.ultimaVuelta, finJornada: aMin(x.prm.finJornada),
    viajes: vs, filas: [], camiones: [...new Set(vs.map((v) => v.camionId).filter(Boolean))], medida,
    alcanza: vs.length > 0 && alcanza(medida, x.ped.conBomba, reglas), traslados: 0, alternativa: null,
  }
}

/** Pasos 2 (un solo armado): cada pedido con los camiones más baratos; `topes` = camiones como máximo (paso 3). */
function armarUnaVez(ent: EntradaDia, infos: Info[], topes: Map<string, number>, reglas: ReglasReparto) {
  const ctx: Ctx = { plantas: new Map(ent.plantas.map((p) => [p.id, p])), traslado: ent.traslado, reparto: ent.reparto || null }
  const plantDe = (id: string) => ent.pedidos.find((x) => x.p.id === id)?.p.plant_id || null
  const viajes: ViajeDia[] = (ent.fijos || []).map((v) => viajeDeFila(v, ent.base, plantDe)).filter((v): v is ViajeDia => !!v)
  const res: Parcial[] = []
  for (const x of infos) {
    if (ent.fijados?.has(x.ped.id)) { res.push(pedidoFijado(x, ent, reglas)); continue }
    const espAca = esperaDe(ctx.plantas.get(x.plantId))
    // (a) los que ya están en la planta; (b) el que puede cargar antes; (c) el usado más tarde; (d) patente
    const orden = ent.camiones
      .map((c) => {
        const vent = ventanasCamion(c, x.plantId, viajes, ctx)
        const ub = ubicacion(c, x.primeraCarga, viajes, ctx)
        const t = primerLibre(vent, x.primeraCarga, x.ciclo, espAca)
        const usos = viajes.filter((v) => v.camionId === c.id && v.vuelta <= t).map((v) => v.vuelta)
        return { c, vent, enPlanta: ub == null || ub === x.plantId, conocido: ub != null, t, uso: usos.length ? Math.max(...usos) : -H }
      })
      .filter((o) => o.t < H - x.ciclo)
      .sort((a, b) => Number(b.enPlanta) - Number(a.enPlanta) || a.t - b.t || b.uso - a.uso || a.c.patente.localeCompare(b.c.patente))
    const cargas = viajes.filter((v) => v.plantId === x.plantId).map((v) => ({ desde: v.inicioCarga, hasta: v.salida }))
    const tope = topes.get(x.ped.id)
    const probar = (n: number) => {
      const sel = orden.slice(0, n)
      const { plan, filas } = cronogramaPedido({
        p: x.pr.p, ped: x.ped, prm: x.prm, base: ent.base, existentes: x.pr.existentes,
        camiones: sel.map((o) => ({ id: o.c.id, patente: o.c.patente, capacidad: o.c.capacidad })),
        ocupados: sel.flatMap((o) => o.vent), cargasOcupadas: cargas,
      })
      const medida = medir(plan.viajes, x.finIdeal)
      const usados = new Set(plan.viajes.map((v) => v.camionId))
      const traslados = sel.filter((o) => usados.has(o.c.id) && !o.enPlanta && o.conocido).length
      return { n, plan, filas, medida, ok: alcanza(medida, x.ped.conBomba, reglas), traslados, usados }
    }
    const base = { id: x.ped.id, plantId: x.plantId, obra: x.pr.obra, conBomba: x.ped.conBomba, necesarios: x.min.necesarios, flotaIdeal: x.min.flotaIdeal, ritmo: x.min.ritmo, primeraCargaIdeal: x.primeraCarga, ultimaVueltaIdeal: x.ultimaVuelta, finJornada: aMin(x.prm.finJornada) }
    if (!orden.length) {
      res.push({ ...base, viajes: [], filas: [], camiones: [], medida: medir([], x.finIdeal), alcanza: false, traslados: 0, alternativa: null })
      continue
    }
    const desde = Math.max(1, Math.min(x.min.necesarios, tope ?? Infinity))
    const hasta = Math.min(orden.length, tope ?? orden.length)
    const intentos: ReturnType<typeof probar>[] = []
    for (let n = Math.min(desde, hasta); n <= hasta; n++) {
      const it = probar(n)
      intentos.push(it)
      if (it.ok) break
    }
    const elegido = intentos.find((i) => i.ok) || [...intentos].sort((a, b) => a.medida.fin - b.medida.fin || a.n - b.n)[0]
    let alternativa: ResultadoPedido["alternativa"] = null
    if (elegido.ok && elegido.n < orden.length) {
      const alt = probar(elegido.n + 1)
      if (alt.medida.fin < elegido.medida.fin - 0.5 && alt.usados.size > elegido.usados.size) alternativa = { n: alt.usados.size, fin: alt.medida.fin, trasladosExtra: Math.max(0, alt.traslados - elegido.traslados) }
    }
    const vs: ViajeDia[] = elegido.plan.viajes.map((v) => ({ ...v, plantId: x.plantId, fijo: false }))
    viajes.push(...vs)
    res.push({
      ...base, viajes: vs, filas: elegido.filas, camiones: [...elegido.usados], medida: elegido.medida, alcanza: elegido.ok,
      traslados: elegido.traslados, alternativa,
    })
  }
  return { res, viajes }
}

/** Minutos de atraso de un pedido (0 si está a tiempo; sin camión, un día entero), con la bomba pesando el doble. */
function atrasoPonderado(x: { alcanza: boolean; conBomba: boolean; viajes: unknown[]; medida: Medida }) {
  const min = !x.viajes.length ? 24 * 60 : x.alcanza ? 0 : x.medida.demora > 0 ? x.medida.demora : x.medida.maxCorte
  return min * (x.conBomba ? 2 : 1)
}

/** Traslados que implican los viajes (cambios de planta de cada camión, contando dónde durmió). */
function cambiosDePlanta(viajes: ViajeDia[], camiones: CamionReparto[]) {
  let n = 0
  for (const c of camiones) {
    let pl = c.amanece
    for (const v of viajes.filter((x) => x.camionId === c.id).sort((a, b) => a.inicioCarga - b.inicioCarga)) {
      if (pl && v.plantId !== pl) n++
      pl = v.plantId
    }
  }
  return n
}

/** El costo de un día armado: [minutos de atraso con la bomba ×2, traslados] (menor es mejor). */
export function costoDelDia(res: ResultadoDia, camiones: CamionReparto[]) {
  return costoDia(res.pedidos, res.viajes, camiones)
}

/** Costo del día para elegir (sugerencia y escenarios): [minutos de atraso, bomba ×2] y después [traslados]. */
function costoDia(res: { alcanza: boolean; conBomba: boolean; viajes: unknown[]; medida: Medida }[], viajes: ViajeDia[], camiones: CamionReparto[]) {
  return [Math.round(res.reduce((s, x) => s + atrasoPonderado(x), 0)), cambiosDePlanta(viajes, camiones)]
}


/**
 * Pasos 2 a 4: el día de las dos plantas. Sin `reparto`, la sugerencia libre; con `reparto`, respetándolo (3.4).
 * Paso 3: se le saca un camión (nunca por debajo de 1) al pedido que más baje el costo del día (atraso con la bomba ×2,
 * después traslados) y se vuelve a armar, hasta que ningún cambio lo baje.
 */
export function armarDia(ent: EntradaDia): ResultadoDia {
  const reglas = ent.reglas || REGLAS_REPARTO
  const infos = prepararPedidos(ent, reglas)
  let topes = new Map<string, number>(Object.entries(ent.topesFijos || {}))
  const cede = new Map<string, string>()
  const sinArreglo = new Set<string>()
  let r = armarUnaVez(ent, infos, topes, reglas)
  // Paso 3 (criterio del 05/11): se le saca un camión al pedido que convenga mientras baje el costo del día, que es
  // 1) los minutos de atraso en total, con la bomba pesando el doble, y 2) los traslados. Así la bomba tiene prioridad,
  // pero no se deja un directo horas tarde por unos minutos de bomba, y no se le sacan camiones a nadie por nada.
  let actual = costoDia(r.res, r.viajes, ent.camiones)
  for (let it = 0; it < (ent.topesFijos ? 0 : 30); it++) {
    let mejor: { topes: Map<string, number>; r: typeof r; costo: number[]; quitado: Parcial } | null = null
    for (const x of r.res) {
      if (x.camiones.length < 2 || ent.fijados?.has(x.id)) continue
      const nuevos = new Map(topes).set(x.id, x.camiones.length - 1)
      const r2 = armarUnaVez(ent, infos, nuevos, reglas)
      const c2 = costoDia(r2.res, r2.viajes, ent.camiones)
      if (menorNota(c2, mejor ? mejor.costo : actual)) mejor = { topes: nuevos, r: r2, costo: c2, quitado: x }
    }
    if (!mejor) break
    // "Los otros están con la bomba de X": el directo que cedió y la bomba que más mejoró
    if (!mejor.quitado.conBomba) {
      const gana = mejor.r.res
        .map((y) => ({ y, baja: atrasoPonderado(r.res.find((z) => z.id === y.id)!) - atrasoPonderado(y) }))
        .filter((g) => g.y.conBomba && g.baja > 0).sort((a, b) => b.baja - a.baja)[0]
      if (gana) cede.set(mejor.quitado.id, gana.y.obra)
    }
    topes = mejor.topes
    r = mejor.r
    actual = mejor.costo
  }
  for (const x of r.res) if (x.conBomba && !x.alcanza) sinArreglo.add(x.id)
  const restringido = !!ent.reparto
  const pedidos: ResultadoPedido[] = r.res.map((x) => {
    const completo = { ...x, cedeA: x.alcanza ? null : cede.get(x.id) || null, sinArreglo: sinArreglo.has(x.id) && !restringido }
    const { estado, texto } = textoPorQue(completo, reglas)
    return { ...completo, estado, texto }
  })
  const plantas = new Map(ent.plantas.map((p) => [p.id, p]))
  const { tramos, traslados, arranquesMovidos } = ent.reparto
    ? tramosDeReparto(ent.reparto, ent.camiones, r.viajes, ent.traslado)
    : tramosDe(ent.camiones, r.viajes, plantas, ent.traslado)
  const out: ResultadoDia = { pedidos, viajes: r.viajes, tramos, traslados, arranquesMovidos, avisos: [] }
  out.avisos = avisosDelDia(out, ent)
  return out
}

/**
 * La entrada del día con lo que se ve en la pantalla para una planta ("Ordenar el día"): sus pedidos con la hora y los
 * tiempos de la pantalla, sus viajes guardados y los parámetros de la planta aunque no estén guardados.
 * Lo de la otra planta no se reordena desde acá (como `otrosViajes` en planDelDia): sus pedidos con viajes pendientes
 * guardados quedan fijos con esos viajes (ocupan a sus camiones, con el traslado); los que no tienen viajes guardados se
 * arman con la sugerencia, para no darle a esta planta camiones que la otra va a necesitar.
 */
export function entradaConPantalla(ent: EntradaDia, plantId: string, pantalla: { pedidos: PedidoReparto[]; prm: Parametros }): EntradaDia {
  const ids = new Set(pantalla.pedidos.map((x) => x.p.id))
  const deEstaPlanta = new Set(ent.pedidos.filter((x) => x.p.plant_id === plantId).map((x) => x.p.id))
  const otras = ent.pedidos.filter((x) => x.p.plant_id !== plantId && !ids.has(x.p.id))
  const conGuardados = otras.filter((x) => x.existentes.some((v) => v.estado === "planificado"))
  const fijas = new Set(conGuardados.map((x) => x.p.id))
  const pedidos = [...otras.filter((x) => !fijas.has(x.p.id)), ...pantalla.pedidos]
  const plantas = ent.plantas.map((p) => (p.id === plantId ? { ...p, prm: pantalla.prm } : p))
  const fijos = [
    ...(ent.fijos || []).filter((v) => !ids.has(v.pedido_id) && !deEstaPlanta.has(v.pedido_id) && !fijas.has(v.pedido_id) && v.plant_id !== plantId),
    ...conGuardados.flatMap((x) => x.existentes.filter((v) => v.estado !== "cancelado").map((v) => ({ ...v, plant_id: v.plant_id || x.p.plant_id }))),
    ...pantalla.pedidos.flatMap((x) => x.existentes.filter((v) => v.estado === "despachado")),
  ]
  return { ...ent, pedidos, plantas, fijos }
}

/** "Ordenar el día" con el reparto: los viajes propuestos para los pedidos de una planta. */
export function propuestaDePlanta(res: ResultadoDia, plantId: string): Record<string, ViajeRow[]> {
  const out: Record<string, ViajeRow[]> = {}
  for (const p of res.pedidos) if (p.plantId === plantId && p.filas.length) out[p.id] = p.filas
  return out
}

// ---------------------------------------------------------------------------
// Paso 4: tramos y franjas
// ---------------------------------------------------------------------------
/** Tramos de cada camión deducidos de sus viajes: se queda donde está hasta que tiene un viaje en la otra planta. */
export function tramosDe(camiones: CamionReparto[], viajes: ViajeDia[], plantas: Map<string, PlantaReparto>, traslado: Traslado) {
  const tramos: Record<string, TramoCalc[]> = {}
  const traslados: TrasladoCamion[] = []
  for (const c of camiones) {
    const vs = viajes.filter((v) => v.camionId === c.id).sort((a, b) => a.inicioCarga - b.inicioCarga)
    const inicio = c.amanece ?? vs[0]?.plantId ?? null
    if (!inicio) { tramos[c.id] = []; continue }
    const ts: TramoCalc[] = [{ plantId: inicio, desde: null, viajes: 0, primeraCarga: null, ultimaVuelta: null }]
    for (const v of vs) {
      let t = ts[ts.length - 1]
      if (v.plantId !== t.plantId) {
        // Sale a la vuelta de su último viaje (o a primera hora, si no tuvo viajes ahí)
        const sale = t.ultimaVuelta ?? aMin(plantas.get(t.plantId)?.prm.inicioJornada || "07:00")
        const llega = sale + trasladoEntre(t.plantId, v.plantId, traslado)
        traslados.push({ camionId: c.id, de: t.plantId, a: v.plantId, sale, llega })
        t = { plantId: v.plantId, desde: llega, viajes: 0, primeraCarga: null, ultimaVuelta: null }
        ts.push(t)
      }
      t.viajes++
      t.primeraCarga = t.primeraCarga == null ? v.inicioCarga : Math.min(t.primeraCarga, v.inicioCarga)
      t.ultimaVuelta = Math.max(t.ultimaVuelta ?? -H, v.vuelta)
    }
    tramos[c.id] = ts
  }
  return { tramos, traslados, arranquesMovidos: [] as string[] }
}

/** Tramos de un reparto guardado o editado, con los viajes que le tocaron a cada camión. */
export function tramosDeReparto(reparto: Reparto, camiones: CamionReparto[], viajes: ViajeDia[], traslado: Traslado) {
  const tramos: Record<string, TramoCalc[]> = {}
  const traslados: TrasladoCamion[] = []
  const arranquesMovidos: string[] = []
  for (const c of camiones) {
    const r = reparto[c.id]
    if (!r || !r.sale || !r.tramos.length) { tramos[c.id] = []; continue }
    const vs = viajes.filter((v) => v.camionId === c.id)
    tramos[c.id] = r.tramos.map((t, i) => {
      const fin = r.tramos[i + 1]?.desde != null ? r.tramos[i + 1].desde! - traslado.minutos : H
      const mios = vs.filter((v) => v.plantId === t.plantId && v.inicioCarga >= (t.desde ?? -H) && v.inicioCarga < fin)
      if (i > 0 && t.desde != null) traslados.push({ camionId: c.id, de: r.tramos[i - 1].plantId, a: t.plantId, sale: t.desde - traslado.minutos, llega: t.desde })
      return {
        plantId: t.plantId, desde: t.desde, viajes: mios.length,
        primeraCarga: mios.length ? Math.min(...mios.map((v) => v.inicioCarga)) : null,
        ultimaVuelta: mios.length ? Math.max(...mios.map((v) => v.vuelta)) : null,
      }
    })
    if (c.amanece && c.amanece !== r.tramos[0].plantId) arranquesMovidos.push(c.id)
  }
  return { tramos, traslados, arranquesMovidos }
}

/** La sugerencia (o el resultado) como reparto para guardar o editar. */
export function repartoDe(res: ResultadoDia, camiones: CamionReparto[], duerme: Record<string, string | null>, noSalen: CamionReparto[] = []): Reparto {
  const out: Reparto = {}
  for (const c of camiones) {
    const ts = res.tramos[c.id] || []
    out[c.id] = { sale: true, tramos: ts.map((t) => ({ plantId: t.plantId, desde: t.desde == null ? null : Math.round(t.desde) })), duerme: duerme[c.id] ?? ts[ts.length - 1]?.plantId ?? c.amanece ?? null }
  }
  for (const c of noSalen) out[c.id] = { sale: false, tramos: [], duerme: c.amanece }
  return out
}

/** Traslados del día y de la noche de un reparto (con dónde durmió cada camión). */
export function contarTraslados(reparto: Reparto, amanece: Record<string, string | null>) {
  let dia = 0, noche = 0
  for (const [id, r] of Object.entries(reparto)) {
    const ts = r.sale ? r.tramos : []
    dia += Math.max(0, ts.length - 1)
    if (ts.length && amanece[id] && amanece[id] !== ts[0].plantId) dia++
    const fin = ts.length ? ts[ts.length - 1].plantId : amanece[id] ?? null
    if (r.duerme && fin && r.duerme !== fin) noche++
  }
  return { dia, noche }
}

export type Franja = {
  desde: number
  hasta: number | null
  plantas: { plantId: string; activos: string[]; libres: { id: string; vuelve: number | null }[] }[]
  sinPlanta: string[]
}

/** Las franjas del día: se cortan en cada traslado (de la salida a la llegada el camión está en viaje). */
export function franjasDe(res: ResultadoDia, camiones: CamionReparto[], plantas: PlantaReparto[]): Franja[] {
  const primeras = res.viajes.map((v) => v.inicioCarga)
  const inicio = Math.min(...plantas.map((p) => aMin(p.prm.inicioJornada)), ...(primeras.length ? [Math.min(...primeras)] : []))
  const ev = [...res.traslados].sort((a, b) => a.sale - b.sale || a.llega - b.llega)
  const cortes: [number, number | null][] = []
  let a = inicio
  for (const e of ev) {
    cortes.push([a, e.sale])
    a = Math.max(a, e.llega)
  }
  cortes.push([a, null])
  const out: Franja[] = []
  for (const [desde, hasta] of cortes) {
    if (hasta != null && hasta <= desde) continue
    const porPlanta = new Map<string, { activos: { id: string; desde: number }[]; libres: { id: string; vuelve: number | null }[] }>()
    const sinPlanta: string[] = []
    for (const c of camiones) {
      const ts = res.tramos[c.id] || []
      if (!ts.length) { sinPlanta.push(c.id); continue }
      let t = ts[0]
      for (const x of ts) if ((x.desde ?? -H) <= desde) t = x
      const g = porPlanta.get(t.plantId) || porPlanta.set(t.plantId, { activos: [], libres: [] }).get(t.plantId)!
      const aca = res.viajes.filter((v) => v.camionId === c.id && v.plantId === t.plantId)
      const activo = aca.some((v) => v.inicioCarga >= desde && (hasta == null || v.inicioCarga < hasta))
      if (activo) g.activos.push({ id: c.id, desde: t.desde ?? -H })
      else g.libres.push({ id: c.id, vuelve: aca.length ? Math.max(...aca.map((v) => v.vuelta)) : null })
    }
    const pat = (id: string) => camiones.find((c) => c.id === id)?.patente || ""
    out.push({
      desde, hasta, sinPlanta,
      plantas: [...porPlanta.entries()]
        .map(([plantId, g]) => ({
          plantId,
          activos: g.activos.sort((x, y) => x.desde - y.desde || pat(x.id).localeCompare(pat(y.id))).map((x) => x.id),
          libres: g.libres.sort((x, y) => (x.vuelve ?? -H) - (y.vuelve ?? -H) || pat(x.id).localeCompare(pat(y.id))),
        }))
        .sort((x, y) => y.activos.length + y.libres.length - (x.activos.length + x.libres.length) || (plantas.find((p) => p.id === x.plantId)?.nombre || "").localeCompare(plantas.find((p) => p.id === y.plantId)?.nombre || "")),
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Paso 5: dónde duermen
// ---------------------------------------------------------------------------
export type Noche = { duerme: Record<string, string | null>; movidos: string[]; arranca: Record<string, number>; textos: string[]; sinPedidos: boolean }

/**
 * Cada camión se queda donde termina. Si mañana tiene pedidos, se arma ese día (pasos 1 y 2) para ver cuántos camiones
 * usa cada planta antes de las 10:00; si a una planta le faltan y a la otra le sobran, se pasan los que sobran esa noche.
 */
export function dondeDuermen(hoy: ResultadoDia, camiones: CamionReparto[], plantas: PlantaReparto[], manana: Omit<EntradaDia, "camiones" | "reparto"> | null, reglas: ReglasReparto = REGLAS_REPARTO): Noche {
  const nombre = (id: string | null) => plantas.find((p) => p.id === id)?.nombre || "—"
  const fin: Record<string, string | null> = {}
  for (const c of camiones) {
    const ts = hoy.tramos[c.id] || []
    fin[c.id] = ts.length ? ts[ts.length - 1].plantId : c.amanece
  }
  const duerme = { ...fin }
  if (!manana || !manana.pedidos.length) {
    return { duerme, movidos: [], arranca: {}, textos: ["Mañana todavía no tiene pedidos: cada camión queda donde termina."], sinPedidos: true }
  }
  const rm = armarDia({ ...manana, camiones: camiones.map((c) => ({ ...c, amanece: fin[c.id] })), reparto: null, reglas })
  const corte = aMin(reglas.horaArranque)
  const usa: Record<string, Set<string>> = {}
  for (const p of plantas) usa[p.id] = new Set(rm.viajes.filter((v) => v.plantId === p.id && v.inicioCarga < corte).map((v) => v.camionId))
  const tiene: Record<string, number> = {}
  for (const p of plantas) tiene[p.id] = camiones.filter((c) => duerme[c.id] === p.id).length
  const movidos: string[] = []
  const pat = (id: string) => camiones.find((c) => c.id === id)?.patente || ""
  for (const p of plantas) {
    let falta = usa[p.id].size - tiene[p.id]
    for (const q of plantas) {
      if (q.id === p.id) continue
      while (falta > 0 && tiene[q.id] - usa[q.id].size > 0) {
        const cand = camiones
          .filter((c) => duerme[c.id] === q.id && !movidos.includes(c.id))
          .sort((x, y) => Number(usa[p.id].has(y.id)) - Number(usa[p.id].has(x.id)) || Number(usa[q.id].has(x.id)) - Number(usa[q.id].has(y.id)) || x.patente.localeCompare(y.patente))[0]
        if (!cand) break
        duerme[cand.id] = p.id
        movidos.push(cand.id)
        tiene[q.id]--; tiene[p.id]++; falta--
      }
    }
  }
  const arranca: Record<string, number> = {}
  for (const p of plantas) arranca[p.id] = usa[p.id].size
  const textos = [...camiones].sort((x, y) => x.patente.localeCompare(y.patente)).map((c) => {
    const d = duerme[c.id]
    if (!d) return `${c.patente}: dónde duerme, a confirmar`
    return movidos.includes(c.id)
      ? `${pat(c.id)}: pasa a ${nombre(d)} esta noche (mañana ${nombre(d)} arranca con ${arranca[d]})`
      : `${pat(c.id)}: se queda en ${nombre(d)} (mañana ${nombre(d)} arranca con ${arranca[d]})`
  })
  return { duerme, movidos, arranca, textos, sinPedidos: false }
}

// ---------------------------------------------------------------------------
// Textos
// ---------------------------------------------------------------------------
const metodo = (r: { conBomba: boolean }) => (r.conBomba ? "bomba" : "directo")

function textoCortes(cortes: number[], palabra: "cortes" | "esperas") {
  if (!cortes.length) return ""
  const uno = palabra === "cortes" ? "corte" : "espera"
  const max = Math.max(...cortes), min = Math.min(...cortes)
  return cortes.length === 1 ? `1 ${uno} de ${max} min` : min === max ? `${cortes.length} ${palabra} de ${max} min` : `${cortes.length} ${palabra} de hasta ${max} min`
}

/** La línea del porqué de cada pedido (verde, ámbar o rojo). */
export function textoPorQue(r: Omit<ResultadoPedido, "estado" | "texto">, reglas: ReglasReparto = REGLAS_REPARTO): { estado: ResultadoPedido["estado"]; texto: string } {
  const n = r.camiones.length
  const cab = `${r.obra} · ${metodo(r)}`
  if (!n) return { estado: "rojo", texto: `${cab} · sin camiones: no hay camiones libres a esa hora.` }
  if (r.alcanza) {
    const esperas = r.medida.cortes.filter((c) => c >= reglas.esperaVisibleMin)
    const alt = r.alternativa
      ? ` Con ${r.alternativa.n} termina ${hora(r.alternativa.fin)}${r.alternativa.trasladosExtra > 0 ? ` pero suma ${r.alternativa.trasladosExtra === 1 ? "un traslado" : `${r.alternativa.trasladosExtra} traslados`}` : ""}.`
      : ""
    const ritmo = r.viajes.length > 1 ? `, ${r.conBomba ? "la bomba" : "la obra"} recibe un camión cada ${r.ritmo} min${esperas.length ? ` (${textoCortes(esperas, "esperas")})` : ""}` : ""
    return { estado: "verde", texto: `${cab} · ${camionesTxt(n)}: ${plural(n, "alcanza", "alcanzan")}${ritmo}.${alt}` }
  }
  const falta = n < r.necesarios ? ` (hacían falta ${r.necesarios})` : ""
  const cortes = r.medida.cortes.length ? `, con ${textoCortes(r.medida.cortes, "cortes")}` : ""
  const fin = r.medida.demora > 0 ? `termina ${hora(r.medida.fin)} en vez de ${hora(r.medida.finIdeal)}` : `termina ${hora(r.medida.fin)}`
  const cede = r.cedeA ? ` Los otros están con la bomba de ${r.cedeA}.` : ""
  const espera = r.conBomba ? " La bomba va a esperar." : ""
  return { estado: r.conBomba && r.sinArreglo ? "rojo" : "ambar", texto: `${cab} · ${camionesTxt(n)}${falta}: ${fin}${cortes}.${cede}${espera}` }
}

/** "07:00 a 11:05 · Hudson 3 (AE402HE, AF431GU, AG083GT) · Canning 2 (CRN449, LES431)" */
export function textoFranja(f: Franja, i: number, total: number, nombres: Record<string, string>, patentes: Record<string, string>): string {
  const cuando = total === 1 ? "Todo el día" : i === total - 1 ? `Desde ${hora(f.desde)}` : `${hora(f.desde)} a ${hora(f.hasta!)}`
  const partes = f.plantas.map((g) => {
    const n = g.activos.length + g.libres.length
    let primero = true
    const libres = g.libres.map((l) => {
      if (l.vuelve == null) return patentes[l.id]
      const t = `${patentes[l.id]} ${primero ? "vuelve " : ""}${hora(l.vuelve)}`
      primero = false
      return t
    })
    if (!g.activos.length) return `${nombres[g.plantId]} ${n} ${plural(n, "libre", "libres")} (${libres.join(", ")})`
    return `${nombres[g.plantId]} ${n} (${g.activos.map((id) => patentes[id]).join(", ")}${libres.length ? `; ${plural(libres.length, "libre", "libres")}: ${libres.join(", ")}` : ""})`
  })
  if (f.sinPlanta.length) partes.push(`sin usar: ${f.sinPlanta.map((id) => patentes[id]).join(", ")} (durmió en: a confirmar)`)
  return `${cuando} · ${partes.join(" · ")}`
}

/** "11:05 · AG083GT pasa de Hudson a Canning (llega 11:55)" */
export function textoTraslado(t: TrasladoCamion, nombres: Record<string, string>, patentes: Record<string, string>) {
  return `${hora(t.sale)} · ${patentes[t.camionId]} pasa de ${nombres[t.de]} a ${nombres[t.a]} (llega ${hora(t.llega)})`
}

/** "Traslados: 1 en el día · 0 a la noche · ≈ 42 km · 17 L" (km y litros solo si están cargados) */
export function textoTraslados(dia: number, noche: number, t: Traslado) {
  const tot = dia + noche
  const fmt = (x: number) => Math.round(x).toLocaleString("es-AR")
  return `Traslados: ${dia} en el día · ${noche} a la noche${t.km && tot ? ` · ≈ ${fmt(t.km * tot)} km` : ""}${t.litros && tot ? ` · ${fmt(t.litros * tot)} L` : ""}`
}

/** "A la noche: quedan 3 en Canning y 2 en Hudson" */
/** "A la noche quedan 3 en Canning y 2 en Hudson." / "A la noche quedan los 3 en Canning." */
export function textoNoche(duerme: Record<string, string | null>, plantas: PlantaReparto[]) {
  const cuenta = plantas.map((p) => ({ n: Object.values(duerme).filter((d) => d === p.id).length, nombre: p.nombre })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n || a.nombre.localeCompare(b.nombre))
  const sin = Object.values(duerme).filter((d) => !d).length
  if (cuenta.length === 1 && !sin) return cuenta[0].n === 1 ? `A la noche queda en ${cuenta[0].nombre}.` : `A la noche quedan los ${cuenta[0].n} en ${cuenta[0].nombre}.`
  const partes = [...cuenta.map((x) => `${x.n} en ${x.nombre}`), ...(sin ? [`${sin} a confirmar`] : [])]
  if (!partes.length) return "A la noche: —"
  const total = cuenta.reduce((s, x) => s + x.n, 0) + sin
  return `A la noche ${plural(total, "queda", "quedan")} ${lista(partes)}.`
}

/** "A", "A y B", "A, B y C" */
export const lista = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}` : xs[0] || "")

// ---------------------------------------------------------------------------
// Pantalla (rediseño 05/11): estado por pedido, resumen en una frase, escenarios +1 / +2, traslados en una línea y
// diagrama con un bloque por viaje
// ---------------------------------------------------------------------------
/** "29 min", "1 h", "4 h 15 min" */
export function textoDuracion(min: number) {
  const m = Math.max(0, Math.round(min))
  const h = Math.floor(m / 60), r = m % 60
  return h ? `${h} h${r ? ` ${r} min` : ""}` : `${r} min`
}

/** A tiempo = alcanza (REGLAS_REPARTO) con al menos un camión */
export const aTiempo = (r: ResultadoPedido) => r.alcanza && r.viajes.length > 0

/** Estado de un pedido para la tabla: chip verde "A tiempo" o amarillo "29 min tarde (bomba)"; además, fin de jornada. */
export function estadoPedido(r: ResultadoPedido): { aTiempo: boolean; texto: string; jornada: string | null } {
  const jornada = r.viajes.length && r.medida.fin > r.finJornada ? `termina después de las ${hora(r.finJornada)}` : null
  if (!r.viajes.length) return { aTiempo: false, texto: `sin camión (${metodo(r)})`, jornada: null }
  if (aTiempo(r)) return { aTiempo: true, texto: "A tiempo", jornada }
  const texto = r.medida.demora > 0
    ? `${textoDuracion(r.medida.demora)} tarde (${metodo(r)})`
    : `cortes de hasta ${textoDuracion(r.medida.maxCorte)} (${metodo(r)})`
  return { aTiempo: false, texto, jornada }
}

/** "HH:MM" de una hora ISO en hora de Argentina (UTC−3 fijo, sin horario de verano desde 2009): igual en el navegador y en el servidor */
export function horaArgentina(iso: string) {
  const d = new Date(new Date(iso).getTime() - 3 * 3600_000)
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`
}

/** Una fila por pedido: la misma para la tabla de la pantalla, el mail y el resumen para WhatsApp (3.2) */
export type FilaPedido = {
  id: string
  nombre: string
  cliente: string | null
  planta: string
  plantId: string
  /** Llegada del primer camión a la obra y salida de planta (HH:MM) */
  llegada: string
  sale: string
  metodo: "bomba" | "directo"
  m3: number
  viajes: number
  camiones: { n: number; patentes: string[] }
  /** Primera carga del armado y fin de la descarga del último viaje (HH:MM) */
  comienza: string | null
  termina: string | null
  aTiempo: boolean
  /** Minutos tarde contra el ideal; 0 a tiempo o con solo cortes; null sin camión */
  atrasoMin: number | null
  estado: string
  jornada: string | null
  confirmado: boolean
}

/**
 * Las filas de los pedidos pendientes, en el orden del armado (primera carga). `pedidos` = los del día como los usa el
 * motor (con los ajustes de hora y método y los tiempos del GPS).
 */
export function filasPedidos(resultado: ResultadoDia, pedidos: (PedidoParaViajes & { clients?: { name?: string | null } | null; confirmado_at?: string | null })[], plantas: PlantaReparto[], patentes: Record<string, string>): FilaPedido[] {
  return resultado.pedidos.flatMap((r) => {
    const p = pedidos.find((x) => x.id === r.id)
    if (!p) return []
    const llegadaMs = new Date(p.scheduled_arrival_time).getTime()
    const e = estadoPedido(r)
    const cargas = r.viajes.map((v) => v.inicioCarga)
    return [{
      id: r.id, nombre: nombreVisible(r.obra), cliente: p.clients?.name ? nombreVisible(p.clients.name) : null,
      planta: plantas.find((x) => x.id === r.plantId)?.nombre || "", plantId: r.plantId,
      llegada: horaArgentina(p.scheduled_arrival_time), sale: horaArgentina(new Date(llegadaMs - viajeMinDe(p) * MIN).toISOString()),
      metodo: conBombaDe(p) ? "bomba" : "directo", m3: Number(p.quantity_m3),
      viajes: r.viajes.length, camiones: { n: r.camiones.length, patentes: r.camiones.map((id) => patentes[id] || id) },
      comienza: cargas.length ? hora(Math.min(...cargas)) : null,
      termina: r.viajes.length ? hora(r.medida.fin) : null,
      aTiempo: e.aTiempo,
      atrasoMin: !r.viajes.length ? null : e.aTiempo ? 0 : Math.max(0, Math.round(r.medida.demora)),
      estado: e.texto, jornada: e.jornada, confirmado: !!p.confirmado_at,
    }]
  })
}

/** "3 pedidos · 140 m³ · 17 viajes · primera carga 07:00 · última vuelta 18:33" */
export function resumenNumeros(resultado: ResultadoDia, filas: FilaPedido[]) {
  const vs = resultado.viajes.filter((v) => !v.fijo)
  const m3 = filas.reduce((s, f) => s + f.m3, 0)
  const partes = [`${filas.length} ${filas.length === 1 ? "pedido" : "pedidos"}`, `${m3.toLocaleString("es-AR")} m³`, `${vs.length} ${vs.length === 1 ? "viaje" : "viajes"}`]
  if (vs.length) partes.push(`primera carga ${hora(Math.min(...vs.map((v) => v.inicioCarga)))}`, `última vuelta ${hora(Math.max(...vs.map((v) => v.vuelta)))}`)
  return partes.join(" · ")
}

export const PREFIJO_ESCENARIO = "escenario-"
export const esFicticio = (id: string) => id.startsWith(PREFIJO_ESCENARIO)
export type Escenario = { extra: number; resultado: ResultadoDia; camiones: CamionReparto[]; ficticios: CamionReparto[] }

/** a < b comparando en orden (primero el primer número, si empatan el segundo…) */
function menorNota(a: number[], b: number[]) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]
  return false
}

/** Combinaciones de plantas (con repetición) para k camiones ficticios */
function combinaciones(ids: string[], k: number, desde = 0): string[][] {
  if (k === 0) return [[]]
  const out: string[][] = []
  for (let i = desde; i < ids.length; i++) for (const resto of combinaciones(ids, k - 1, i)) out.push([ids[i], ...resto])
  return out
}

/**
 * Escenario con `extra` camiones más (solo para ver; no se guarda): camiones ficticios "Camión 4", "Camión 5"… de 8 m³,
 * disponibles desde las 07:00 en la planta donde más convenga (se prueban todas y queda la de menos minutos de atraso,
 * con la bomba pesando el doble, y después menos traslados). Los camiones reales no quedan fijos donde estaban: el
 * escenario se arma sin el reparto guardado (solo cuenta dónde durmió cada uno).
 */
export function escenarioConMas(ent: EntradaDia, extra: number, desde = "07:00"): Escenario | null {
  if (extra <= 0 || !ent.plantas.length) return null
  let mejor: { esc: Escenario; nota: number[] } | null = null
  for (const combo of combinaciones(ent.plantas.map((p) => p.id), extra)) {
    const ficticios: CamionReparto[] = combo.map((pid, i) => ({ id: `${PREFIJO_ESCENARIO}${i + 1}`, patente: `Camión ${ent.camiones.length + i + 1}`, capacidad: 8, amanece: pid, disponibleDesde: aMin(desde) }))
    const camiones = [...ent.camiones, ...ficticios]
    const resultado = armarDia({ ...ent, camiones, reparto: null })
    // Mismo criterio que la sugerencia: menos atraso (bomba ×2) y después menos traslados
    const nota = costoDia(resultado.pedidos, resultado.viajes, camiones)
    if (!mejor || menorNota(nota, mejor.nota)) mejor = { esc: { extra, resultado, camiones, ficticios }, nota }
  }
  return mejor?.esc ?? null
}

/**
 * El nombre de la obra como se ve en la pantalla: sin espacios de más y, si viene todo en mayúsculas ("SANTA RITA"),
 * en tipo título ("Santa Rita"). Lo usan la tabla, el resumen y el diagrama, así dicen lo mismo.
 */
export function nombreVisible(s: string | null | undefined): string {
  const t = String(s ?? "").replace(/\s+/g, " ").trim()
  if (!t || /[a-záéíóúñü]/.test(t) || !/[A-ZÁÉÍÓÚÑÜ]/.test(t)) return t
  const chicas = new Set(["de", "del", "la", "las", "los", "el", "y", "e"])
  return t.toLowerCase().split(" ").map((w, i) => (i > 0 && chicas.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(" ")
}

/**
 * La frase del resumen, con el mismo cálculo para la vista base y los escenarios:
 *   base: "Con 3 camiones se hace todo, pero 3 pedidos terminan tarde. Con 1 camión más, Greenville y Pampero salen a
 *         tiempo." (sale de calcular de verdad el +1 y, si no alcanza para todo, el +2; si ni con +2 sale todo, el
 *         consejo de correr la hora);
 *   escenario: habla solo de ese escenario, sin consejos ("Con 5 camiones se hace todo; Santa Rita termina 53 min tarde.").
 */
export function textoResumenDia(n: number, base: ResultadoDia, mas1: ResultadoDia | null, mas2: ResultadoDia | null, modo: "base" | "escenario" = "base"): { tono: "verde" | "amarillo"; texto: string } {
  const tarde = base.pedidos.filter((r) => !aTiempo(r))
  if (!base.pedidos.length) return { tono: "verde", texto: "No hay pedidos pendientes ese día." }
  if (!tarde.length) return { tono: "verde", texto: `Con ${camionesTxt(n)} ${base.pedidos.length === 1 ? "el pedido sale" : "salen todos los pedidos"} a tiempo.` }
  const sinCamion = tarde.filter((r) => !r.viajes.length)
  const conAtraso = tarde.filter((r) => r.viajes.length)
  const nombres = (xs: ResultadoPedido[]) => lista(xs.map((r) => nombreVisible(r.obra)))
  if (modo === "escenario") {
    const cuanto = conAtraso.map((r, i) => `${nombreVisible(r.obra)}${i === 0 ? " termina" : ""} ${estadoPedido(r).texto.replace(/ \((bomba|directo)\)$/, "")}`)
    const partes = [
      ...(sinCamion.length ? [`${nombres(sinCamion)} ${plural(sinCamion.length, "queda", "quedan")} sin camión`] : []),
      ...(cuanto.length ? [lista(cuanto)] : []),
    ]
    return { tono: "amarillo", texto: `Con ${camionesTxt(n)} ${sinCamion.length ? "no se hace todo" : "se hace todo"}; ${partes.join("; ")}.` }
  }
  const primera = sinCamion.length
    ? `Con ${camionesTxt(n)} no se hace todo: ${nombres(sinCamion)} ${plural(sinCamion.length, "queda", "quedan")} sin camión${conAtraso.length ? ` y ${conAtraso.length} ${plural(conAtraso.length, "pedido termina", "pedidos terminan")} tarde` : ""}.`
    : `Con ${camionesTxt(n)} se hace todo, pero ${tarde.length === 1 ? "1 pedido termina" : `${tarde.length} pedidos terminan`} tarde.`
  const arreglados = (r: ResultadoDia | null) => (r ? tarde.filter((t) => { const x = r.pedidos.find((y) => y.id === t.id); return !!x && aTiempo(x) }) : [])
  const todos = (r: ResultadoDia | null) => !!r && r.pedidos.every(aTiempo)
  const a1 = arreglados(mas1), a2 = arreglados(mas2)
  const solo2 = a2.filter((x) => !a1.includes(x))
  const siguen = tarde.filter((t) => !a1.includes(t) && !a2.includes(t))
  let segunda: string
  if (todos(mas1)) segunda = `Con 1 camión más, ${nombres(a1)} ${plural(a1.length, "sale", "salen")} a tiempo.`
  else if (todos(mas2)) segunda = a1.length
    ? `Con 1 camión más, ${nombres(a1)} ${plural(a1.length, "sale", "salen")} a tiempo; con 2, también ${nombres(solo2)}.`
    : `Con 2 camiones más, ${nombres(a2)} ${plural(a2.length, "sale", "salen")} a tiempo.`
  else if (!a1.length && !a2.length) segunda = "Ni con 2 camiones más sale todo a tiempo: conviene correr la hora de algún pedido."
  else {
    const partes: string[] = []
    if (a1.length) partes.push(`Con 1 camión más, ${nombres(a1)} ${plural(a1.length, "sale", "salen")} a tiempo`)
    if (solo2.length) partes.push(a1.length ? `con 2, también ${nombres(solo2)}` : `Con 2 camiones más, ${nombres(solo2)} ${plural(solo2.length, "sale", "salen")} a tiempo`)
    partes.push(`${nombres(siguen)} ${plural(siguen.length, "sigue", "siguen")} tarde aun con 2 camiones más: conviene correr la hora de algún pedido`)
    segunda = `${partes.join("; ")}.`
  }
  return { tono: "amarillo", texto: `${primera} ${segunda}` }
}

/** "10:56 · AG083GT pasa a Canning · 12:28 · AF431GU pasa a Canning · Traslados: 2 · 130 km · 52 L" */
export function lineaTraslados(res: ResultadoDia, conteo: { dia: number; noche: number }, t: Traslado, nombres: Record<string, string>, patentes: Record<string, string>) {
  const evs = [...res.traslados].sort((a, b) => a.sale - b.sale).map((x) => `${hora(x.sale)} · ${patentes[x.camionId]} pasa a ${nombres[x.a]}`)
  const arr = res.arranquesMovidos.map((id) => `${patentes[id]} arranca en la otra planta`)
  const tot = conteo.dia + conteo.noche
  const fmt = (x: number) => Math.round(x).toLocaleString("es-AR")
  const cuenta = tot
    ? `Traslados: ${conteo.dia}${conteo.noche ? ` (+${conteo.noche} a la noche)` : ""}${t.km ? ` · ${fmt(t.km * tot)} km` : ""}${t.litros ? ` · ${fmt(t.litros * tot)} L` : ""}`
    : "Sin traslados entre plantas"
  return [...evs, ...arr, cuenta].join(" · ")
}

export type BloqueDiagrama = {
  tipo: "viaje" | "traslado"; desde: number; hasta: number; plantId: string; texto: string; pedidoId?: string
  /** Para el tooltip: "carga 07:00 · sale 07:15 · llega 07:45 · termina 08:15 · vuelve 08:45" */
  detalle: string
}
export type FilaDiagrama = { camionId: string; patente: string; ficticio: boolean; bloques: BloqueDiagrama[] }

/**
 * El diagrama: una fila por camión y un bloque por viaje (de la carga a la vuelta a planta, con el nombre de la obra),
 * más un bloque por traslado ("→ Canning"). Sin el detalle de carga, ida y descarga.
 */
export function bloquesDiagrama(res: ResultadoDia, camiones: CamionReparto[], nombres: Record<string, string>, obraDe: (pedidoId: string) => string): FilaDiagrama[] {
  return camiones.map((c) => {
    const viajes = res.viajes.filter((v) => v.camionId === c.id).map((v): BloqueDiagrama => ({
      tipo: "viaje", desde: v.inicioCarga, hasta: v.vuelta, plantId: v.plantId, texto: obraDe(v.pedidoId), pedidoId: v.pedidoId,
      detalle: `carga ${hora(v.inicioCarga)} · sale ${hora(v.salida)} · llega ${hora(v.llegada)} · termina ${hora(v.finDescarga)} · vuelve ${hora(v.vuelta)}`,
    }))
    const tras = res.traslados.filter((t) => t.camionId === c.id).map((t): BloqueDiagrama => ({ tipo: "traslado", desde: t.sale, hasta: t.llega, plantId: t.a, texto: `→ ${nombres[t.a] || "otra planta"}`, detalle: `sale ${hora(t.sale)} · llega ${hora(t.llega)}` }))
    return { camionId: c.id, patente: c.patente, ficticio: esFicticio(c.id), bloques: [...viajes, ...tras].sort((a, b) => a.desde - b.desde) }
  })
}

/**
 * "tiene 2 camiones y hacen falta 3": los camiones que de verdad le tocan al pedido contra los que necesita. Si tiene
 * los que hacen falta (o más) pero igual espera, es porque llegan tarde.
 */
function textoTiene(r: { camiones: string[]; necesarios: number }) {
  const n = r.camiones.length
  return n < r.necesarios
    ? `tiene ${camionesTxt(n)} y hacen falta ${r.necesarios}`
    : `tiene ${camionesTxt(n)} pero no llegan a tiempo (los otros están en otros pedidos o en la otra planta)`
}

/** Avisos del bloque (bomba, fin de jornada, superposiciones de viajes guardados, traslado a confirmar). */
function avisosDelDia(res: ResultadoDia, ent: EntradaDia): Aviso[] {
  const out: Aviso[] = []
  const restringido = !!ent.reparto
  for (const r of res.pedidos) {
    if (r.conBomba && !r.alcanza && r.camiones.length) {
      out.push(r.sinArreglo && !restringido
        ? { nivel: "rojo", pedidoId: r.id, texto: `No alcanzan los camiones para la bomba de ${r.obra}: ${textoTiene(r)}.` }
        : { nivel: "ambar", pedidoId: r.id, texto: `La bomba de ${r.obra} va a esperar: ${textoTiene(r)}.` })
    } else if (!r.alcanza && r.camiones.length && r.medida.demora > 0) {
      out.push({ nivel: "ambar", pedidoId: r.id, texto: `${r.obra} termina ${hora(r.medida.fin)} en vez de ${hora(r.medida.finIdeal)}.` })
    } else if (!r.camiones.length) {
      out.push({ nivel: "rojo", pedidoId: r.id, texto: `${r.obra}: no hay camiones libres a esa hora.` })
    }
    if (r.camiones.length && r.medida.fin > r.finJornada) {
      out.push({ nivel: "ambar", pedidoId: r.id, texto: `${r.obra} termina ${hora(r.medida.fin)}, después del fin de jornada (${hora(r.finJornada)}).` })
    }
  }
  if (ent.traslado.aConfirmar) out.push({ nivel: "info", texto: "Traslado a confirmar: cargalo en Tiempos y camiones." })
  return out
}

/**
 * Avisos de los viajes guardados del día (las dos plantas): un camión en dos viajes a la vez.
 * "X se superpone con Y: AF431GU tendría que cargar para Y a las 12:15 y vuelve de X 12:37."
 */
export function avisosSuperposicion(viajes: ViajeRow[], obraDe: (pedidoId: string) => string, patente: (id: string) => string): Aviso[] {
  const out: Aviso[] = []
  const vistos = new Set<string>()
  const hh = horaArgentina
  for (const ch of choquesDeCamion(viajes).values()) {
    const antes = ch.otroAntes ? ch.otro : ch.viaje, despues = ch.otroAntes ? ch.viaje : ch.otro
    const k = [antes.pedido_id, antes.n, despues.pedido_id, despues.n].join(":")
    if (vistos.has(k)) continue
    vistos.add(k)
    const x = obraDe(antes.pedido_id), y = obraDe(despues.pedido_id)
    out.push({ nivel: "rojo", camionId: antes.mixer_id || undefined, texto: `${x} se superpone con ${y}: ${patente(antes.mixer_id!)} tendría que cargar para ${y} a las ${hh(despues.hora_carga)} y vuelve de ${x} ${hh(antes.hora_vuelta)}.` })
  }
  return out
}

/**
 * Avisos de un reparto editado a mano (no frenan el guardado): un cambio de planta antes de que el camión vuelva de
 * su viaje ("AG083GT pasa a Canning a las 10:30 pero vuelve de Greenville 11:05"), dos cambios que no dan el tiempo
 * del traslado, y viajes guardados en una planta mientras el reparto lo tiene en la otra.
 * `referencia`: los viajes con que se compara (los guardados o, si el pedido no tiene, los de la sugerencia).
 */
export function avisosEdicion(reparto: Reparto, referencia: ViajeDia[], guardados: Set<string>, camiones: CamionReparto[], plantas: PlantaReparto[], traslado: Traslado, obraDe: (pedidoId: string) => string): Aviso[] {
  const out: Aviso[] = []
  const nombre = (id: string) => plantas.find((p) => p.id === id)?.nombre || "—"
  for (const c of camiones) {
    const r = reparto[c.id]
    if (!r || !r.sale || !r.tramos.length) continue
    const mios = referencia.filter((v) => v.camionId === c.id)
    const avisados = new Set<ViajeDia>()
    r.tramos.forEach((t, i) => {
      if (i === 0 || t.desde == null) return
      const sale = t.desde - traslado.minutos
      const ant = r.tramos[i - 1]
      if (ant.desde != null && sale < ant.desde) out.push({ nivel: "ambar", camionId: c.id, texto: `${c.patente}: el cambio a ${nombre(t.plantId)} de las ${hora(sale)} no da el tiempo del traslado (${traslado.minutos} min) desde que llega a ${nombre(ant.plantId)} (${hora(ant.desde)}).` })
      const pisa = mios.filter((v) => v.plantId === ant.plantId && v.inicioCarga < sale && v.vuelta > sale).sort((a, b) => b.vuelta - a.vuelta)[0]
      if (pisa) {
        avisados.add(pisa)
        out.push({ nivel: "ambar", camionId: c.id, pedidoId: pisa.pedidoId, texto: `${c.patente} pasa a ${nombre(t.plantId)} a las ${hora(sale)} pero vuelve de ${obraDe(pisa.pedidoId)} ${hora(pisa.vuelta)}.` })
      }
    })
    for (const v of mios) {
      if (avisados.has(v) || !guardados.has(v.pedidoId)) continue
      let pl = r.tramos[0].plantId
      for (const t of r.tramos) if ((t.desde ?? -H) <= v.inicioCarga) pl = t.plantId
      if (pl !== v.plantId) out.push({ nivel: "ambar", camionId: c.id, pedidoId: v.pedidoId, texto: `${c.patente} tiene que cargar para ${obraDe(v.pedidoId)} (${nombre(v.plantId)}) a las ${hora(v.inicioCarga)}, pero el reparto lo tiene en ${nombre(pl)}.` })
    }
  }
  return out
}

/** "Sugerido: Hudson 3 · Canning 2 / Canning 3 · Hudson 2 desde 11:55 · tenés …" (null si son iguales) */
export function textoComparacion(sug: Franja[], ef: Franja[], nombres: Record<string, string>): string | null {
  const corto = (fs: Franja[]) => fs.map((f, i) => `${f.plantas.map((g) => `${nombres[g.plantId]} ${g.activos.length + g.libres.length}`).join(" · ")}${i > 0 ? ` desde ${hora(f.desde)}` : ""}`).join(" / ")
  const a = corto(sug), b = corto(ef)
  return a === b ? null : `Sugerido: ${a} · tenés ${b}`
}

// ---------------------------------------------------------------------------
// Fase 2: "Tenés N camiones asignados para este pedido" (gerenciador)
// ---------------------------------------------------------------------------
export type ContextoReparto = {
  base: number
  plantas: PlantaReparto[]
  traslado: Traslado
  /** Camiones que salen ese día, con dónde durmieron */
  camiones: CamionReparto[]
  /** Reparto que manda (el guardado o en edición; si no hay, el sugerido) */
  reparto: Reparto
  /** Camiones que eligió la sugerencia para cada pedido */
  sugeridos: Record<string, string[]>
  /** Viajes de los otros pedidos del día (los guardados o, si no tienen, los de la sugerencia), en minutos */
  otros: ViajeDia[]
}

/** Ventana del pedido (de la primera a la última carga del ideal) para ver qué camiones están en la planta. */
export function camionesParaPedido(ctx: ContextoReparto, plantId: string, desde: number, hasta: number) {
  const nombre = (id: string) => ctx.plantas.find((p) => p.id === id)?.nombre || "la otra planta"
  return ctx.camiones.map((c) => {
    const r = ctx.reparto[c.id]
    if (r && !r.sale) return { id: c.id, patente: c.patente, ofrecido: false, motivo: "no sale hoy" }
    if (!r || !r.tramos.length) return { id: c.id, patente: c.patente, ofrecido: true, motivo: null as string | null }
    const T = ctx.traslado.minutos
    const ventanas = r.tramos.map((t, i) => ({ plantId: t.plantId, a: t.desde ?? -H, b: r.tramos[i + 1]?.desde != null ? r.tramos[i + 1].desde! - T : H }))
    if (ventanas.some((w) => w.plantId === plantId && w.a <= hasta && w.b >= desde)) return { id: c.id, patente: c.patente, ofrecido: true, motivo: null }
    const actual = ventanas.filter((w) => w.a <= desde).pop() || ventanas[0]
    const llega = ventanas.find((w) => w.plantId === plantId && w.a > desde)
    return { id: c.id, patente: c.patente, ofrecido: false, motivo: llega ? `en ${nombre(actual.plantId)} hasta ${hora(llega.a)}` : `en ${nombre(actual.plantId)}` }
  })
}

/**
 * El cronograma del pedido con los camiones elegidos, con el reparto y los viajes de los otros pedidos (con sus
 * traslados) como ocupados. Devuelve las filas (sin grabar), la medida contra el ideal y si alcanza.
 */
export function cronogramaConCamiones(ctx: ContextoReparto, p: PedidoParaViajes, prm: Parametros, existentes: ViajeRow[], camionIds: string[], reglas: ReglasReparto = REGLAS_REPARTO) {
  const e = entradaPedido(p, existentes, prm)
  if (e.pendiente <= 0.01) return null
  const ped = pedidoParaPlan(p, e.pendiente, e.llegada + (e.base - ctx.base) / MIN, p.construction_sites?.name || "")
  const min = camionesMinimos(p, ped, prm, reglas)
  const finIdeal = min.ideal.viajes.length ? Math.max(...min.ideal.viajes.map((v) => v.finDescarga)) : 0
  const plantas = new Map(ctx.plantas.map((x) => [x.id, x]))
  if (!plantas.has(p.plant_id)) plantas.set(p.plant_id, { id: p.plant_id, nombre: "", prm })
  else plantas.set(p.plant_id, { ...plantas.get(p.plant_id)!, prm })
  const c: Ctx = { plantas, traslado: ctx.traslado, reparto: ctx.reparto }
  const otros = ctx.otros.filter((v) => v.pedidoId !== p.id)
  // Los viajes ya despachados de este pedido también ocupan a su camión
  const fijos = viajesDia(existentes.filter((v) => v.estado === "despachado"), ctx.base, () => p.plant_id)
  const todos = [...otros, ...fijos]
  const elegidos = camionIds.map((id) => ctx.camiones.find((x) => x.id === id)).filter((x): x is CamionReparto => !!x)
  const cargas = todos.filter((v) => v.plantId === p.plant_id).map((v) => ({ desde: v.inicioCarga, hasta: v.salida }))
  const prob = (ids: CamionReparto[]) => cronogramaPedido({ p, ped, prm, base: ctx.base, existentes, camiones: ids.map((x) => ({ id: x.id, patente: x.patente, capacidad: x.capacidad })), ocupados: ids.flatMap((x) => ventanasCamion(x, p.plant_id, todos, c)), cargasOcupadas: cargas })
  const { plan, filas } = elegidos.length ? prob(elegidos) : { plan: null, filas: [] as ViajeRow[] }
  const medida = plan ? medir(plan.viajes, finIdeal) : medir([], finIdeal)
  const ok = !!plan && alcanza(medida, ped.conBomba, reglas)
  // Ideal (sin límite) para "en vez de"
  const idealFilas = filasDelPlan(p, ctx.base, min.ideal.viajes, existentes)
  return { filas, medida, alcanza: ok, necesarios: min.necesarios, conBomba: ped.conBomba, idealFilas, finIdeal, finJornada: aMin(prm.finJornada), probar: prob, elegidos }
}

/** "Con 2 camiones termina 12:05 (con 3, 10:40) · 2 cortes de 55 min" */
export function textoCronograma(n: number, medida: Medida, otro: { n: number; fin: number } | null) {
  const cortes = medida.cortes.length ? ` · ${textoCortes(medida.cortes, "cortes")}` : ""
  const alt = otro && Math.round(otro.fin) !== Math.round(medida.fin) ? ` (con ${otro.n}, ${hora(otro.fin)})` : ""
  return `Con ${camionesTxt(n)} termina ${hora(medida.fin)}${alt}${cortes}`
}

/** Avisos del pedido en el gerenciador (los mismos del bloque que le tocan) */
export function avisosCronograma(r: { conBomba: boolean; alcanza: boolean; necesarios: number; medida: Medida; finJornada: number; filas: ViajeRow[]; idealFilas: ViajeRow[] }, obra: string, n: number): string[] {
  const out: string[] = []
  if (!n) return [`Elegí al menos un camión para armar los viajes.`]
  if (!r.alcanza) {
    if (r.conBomba) out.push(`No alcanza: la bomba espera${r.medida.maxCorte ? ` (cortes de hasta ${r.medida.maxCorte} min)` : ""}. Hacen falta ${camionesTxt(r.necesarios)}.`)
    else out.push(`No alcanza: ${r.medida.cortes.length ? `la obra espera (${textoCortes(r.medida.cortes, "cortes")})` : "termina tarde"}. Hacen falta ${camionesTxt(r.necesarios)}.`)
  }
  const menos = textoConMenosCamiones(r.filas, r.idealFilas, n)
  if (menos) out.push(menos)
  if (r.medida.fin > r.finJornada) out.push(`${obra} termina ${hora(r.medida.fin)}, después del fin de jornada (${hora(r.finJornada)}).`)
  return out
}

/** Viajes guardados → minutos del día (para el contexto del gerenciador) */
export function viajesDia(viajes: ViajeRow[], base: number, plantDe: (pedidoId: string) => string | null): ViajeDia[] {
  return viajes.map((v) => viajeDeFila(v, base, plantDe)).filter((v): v is ViajeDia => !!v)
}

/**
 * Antes de guardar: cada cambio de planta con hora, en orden, y que llegue antes de la medianoche (la base lo guarda
 * como HH:MM del día). null = está bien; si no, el mensaje para la pantalla.
 */
export const TEXTO_ESCENARIO = "Es un escenario: conseguí el camión y cargalo para guardarlo"

export function validarReparto(r: Reparto, patente: (id: string) => string, nombre: (plantId: string) => string, traslado: Traslado): string | null {
  // Los escenarios (+1, +2) son solo para ver: sus camiones no existen
  if (Object.keys(r).some(esFicticio)) return TEXTO_ESCENARIO
  for (const [id, x] of Object.entries(r)) {
    if (!x.sale) continue
    let ant: number | null = null
    for (let i = 0; i < x.tramos.length; i++) {
      const t = x.tramos[i]
      if (i > 0 && x.tramos[i - 1].plantId === t.plantId) return `${patente(id)}: tiene dos tramos seguidos en ${nombre(t.plantId)}.`
      if (t.desde == null) {
        if (i > 0) return `${patente(id)}: falta la hora del cambio a ${nombre(t.plantId)}.`
        continue
      }
      const sale = Math.round(t.desde - traslado.minutos)
      if (t.desde > 23 * 60 + 59) return `${patente(id)}: el cambio a ${nombre(t.plantId)} de las ${hora(sale)} llega después de la medianoche (el traslado tarda ${traslado.minutos} min). Ponelo más temprano o sacalo.`
      if (t.desde < 0) return `${patente(id)}: la hora del cambio a ${nombre(t.plantId)} no es válida.`
      if (ant != null && Math.round(t.desde) <= Math.round(ant)) return `${patente(id)}: los cambios de planta tienen que ir en orden (el de las ${hora(sale)} queda antes que el anterior).`
      ant = t.desde
    }
  }
  return null
}

/**
 * La medida de los viajes tal como se ven (guardados o ajustados a mano), contra el fin ideal: el corte de cada camión
 * es lo que llega después de lo previsto (el fin de la descarga anterior, o la llegada anterior + el espaciado).
 * Los cortes se miden solo entre los viajes pendientes (lo despachado ya pasó y sus horas son las reales); el fin es el
 * del último viaje, despachado o no.
 */
export function medirFilas(filas: ViajeRow[], finIdeal: number, base: number, espaciadoMin?: number | null): Medida {
  const m = (iso: string) => (new Date(iso).getTime() - base) / MIN
  const vs = filas.filter((v) => v.estado === "planificado").sort((a, b) => m(a.hora_llegada) - m(b.hora_llegada))
  const out = vs.map((v, i) => {
    if (i === 0) return { finDescarga: m(v.hora_fin_descarga), esperaObra: 0 }
    const prev = vs[i - 1]
    const previsto = espaciadoMin && espaciadoMin > 0 ? m(prev.hora_llegada) + espaciadoMin : m(prev.hora_fin_descarga)
    return { finDescarga: m(v.hora_fin_descarga), esperaObra: Math.max(0, m(v.hora_llegada) - previsto) }
  })
  const despachados = filas.filter((v) => v.estado === "despachado").map((v) => ({ finDescarga: m(v.hora_fin_descarga), esperaObra: 0 }))
  return medir([...despachados, ...out], finIdeal)
}

// ---------------------------------------------------------------------------
// Base de datos (si la migración no está aplicada: disponible = false y todo sigue como antes)
// ---------------------------------------------------------------------------
export type FilaReparto = { mixer_id: string; sale: boolean; tramos: { plant_id: string; desde: string | null }[]; duerme_plant_id: string | null; origen: "sugerido" | "a_mano"; actualizado_por?: string | null; updated_at?: string | null }

const aHHMM = (m: number) => aHora(Math.max(0, Math.min(23 * 60 + 59, Math.round(m))))

export function repartoAFilas(r: Reparto, origen: "sugerido" | "a_mano"): FilaReparto[] {
  return Object.entries(r).map(([mixer_id, x]) => ({
    mixer_id, sale: x.sale, origen, duerme_plant_id: x.duerme,
    tramos: x.sale ? x.tramos.map((t, i) => ({ plant_id: t.plantId, desde: i === 0 && t.desde == null ? null : aHHMM(t.desde ?? 0) })) : [],
  }))
}

export function repartoDeFilas(filas: FilaReparto[]): Reparto {
  const out: Reparto = {}
  for (const f of filas) {
    const ts = Array.isArray(f.tramos) ? f.tramos : []
    out[f.mixer_id] = {
      sale: f.sale !== false,
      tramos: ts.filter((t) => t && t.plant_id).map((t) => ({ plantId: t.plant_id, desde: typeof t.desde === "string" && /^\d{2}:\d{2}/.test(t.desde) ? aMin(t.desde) : null })),
      duerme: f.duerme_plant_id || null,
    }
  }
  return out
}

/** Iguales (para saber si lo guardado es la sugerencia tal cual) */
export function mismoReparto(a: Reparto | null | undefined, b: Reparto | null | undefined) {
  if (!a || !b) return false
  const norm = (r: Reparto) => JSON.stringify(Object.keys(r).sort().map((k) => [k, r[k].sale, r[k].sale ? r[k].tramos.map((t) => [t.plantId, t.desde == null ? null : Math.round(t.desde)]) : [], r[k].duerme]))
  return norm(a) === norm(b)
}

export type RepartoGuardado = { disponible: boolean; reparto: Reparto | null; origen: "sugerido" | "a_mano" | null; actualizadoPor: string | null; actualizado: string | null }

/** Reparto guardado de una fecha (yyyy-mm-dd). Sin la tabla (migración sin aplicar): disponible = false. */
export async function cargarReparto(sb: any, fecha: string): Promise<RepartoGuardado> {
  const nada: RepartoGuardado = { disponible: false, reparto: null, origen: null, actualizadoPor: null, actualizado: null }
  try {
    const { data, error } = await sb.from("reparto_camiones").select("*").eq("fecha", fecha)
    if (error) return nada
    const filas = (data || []) as FilaReparto[]
    if (!filas.length) return { ...nada, disponible: true }
    const ult = [...filas].sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")))[0]
    return { disponible: true, reparto: repartoDeFilas(filas), origen: filas.every((f) => f.origen === "sugerido") ? "sugerido" : "a_mano", actualizadoPor: ult.actualizado_por || null, actualizado: ult.updated_at || null }
  } catch {
    return nada
  }
}

/** Guarda el reparto del día entero (guardar_reparto_dia: todo o nada, queda en Actividad). */
export async function guardarReparto(sb: any, fecha: string, r: Reparto, usuario: string, origen: "sugerido" | "a_mano"): Promise<{ error: string | null }> {
  if (Object.keys(r).some(esFicticio)) return { error: TEXTO_ESCENARIO }
  const filas = repartoAFilas(r, origen)
  if (!filas.length) return { error: "El reparto está vacío: no hay camiones para guardar" }
  const { error } = await sb.rpc("guardar_reparto_dia", { p_fecha: fecha, p_filas: filas, p_usuario: usuario, p_borrar: false })
  return { error: error ? error.message || "No se pudo guardar el reparto" : null }
}

export type FilaTraslado = { plant_a: string; plant_b: string; minutos: number; km: number | null; litros: number | null; actualizado_por?: string | null; updated_at?: string | null }

/** El par ordenado como lo guarda la base (plant_a < plant_b) */
const par = (a: string, b: string) => (a < b ? [a, b] : [b, a])

/** Traslado cargado entre dos plantas. Sin la tabla: disponible = false. */
export async function cargarTraslado(sb: any, a: string, b: string): Promise<{ disponible: boolean; fila: FilaTraslado | null }> {
  if (!a || !b || a === b) return { disponible: false, fila: null }
  try {
    const [x, y] = par(a, b)
    const { data, error } = await sb.from("traslados_plantas").select("*").eq("plant_a", x).eq("plant_b", y).maybeSingle()
    if (error) return { disponible: false, fila: null }
    return { disponible: true, fila: data ? { ...data, minutos: Number(data.minutos), km: data.km == null ? null : Number(data.km), litros: data.litros == null ? null : Number(data.litros) } : null }
  } catch {
    return { disponible: false, fila: null }
  }
}

export async function guardarTraslado(sb: any, a: string, b: string, v: { minutos: number; km: number | null; litros: number | null }, usuario: string): Promise<{ error: string | null }> {
  const [x, y] = par(a, b)
  const { error } = await sb.from("traslados_plantas").upsert(
    { plant_a: x, plant_b: y, minutos: Math.round(v.minutos), km: v.km, litros: v.litros, actualizado_por: usuario, updated_at: new Date().toISOString() },
    { onConflict: "plant_a,plant_b" },
  )
  return { error: error ? error.message || "No se pudo guardar el traslado" : null }
}
