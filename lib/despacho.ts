/**
 * Despacho diario en tres columnas (fase 3): las reglas, sin React y sin Supabase (se prueban con node --test).
 * Especificación: docs/migracion-loop/fase-3.md (los puntos 13 y 14 mandan sobre lo anterior).
 *
 *   - estadoCamion():          en planta / yendo / en obra / volviendo / taller / fuera de servicio, con o sin GPS.
 *   - viajesDelDia():          los viajes guardados (fase 2) más los calculados de los pedidos que no tienen.
 *   - atraso():                "Atrasado 15 min" / "Ahora" (misma regla que la fase 2).
 *   - contadoresDia():         Programado · Despachado · Falta · Suspendido · Cancelado · Viajes.
 *   - puntualidadPrimerCamion(): "Llegó 07:52 · pedido 07:45 · +7 min".
 *   - remitoSugerido() / remitoRepetido() / avisosRemito(): talonario tipeado por planta y tipo (R / X).
 *   - validarEntrega() / armarPayloadDespacho(): las mismas reglas de hoy para `registrar_despacho`.
 *
 * El tipo de remito lo resuelve la base (`remito_tipo_para`): acá solo se muestra lo que devuelve.
 */
import { generarViajes, conTiemposGps, parametrosConGps, pendientes, type ViajeRow, type PedidoParaViajes } from "@/lib/viajes"
import type { Parametros } from "@/lib/planificador"
import type { TiemposGps } from "@/lib/gps-viajes"

const MIN = 60_000
const t = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : NaN)

// ---------------------------------------------------------------------------
// Textos comunes
// ---------------------------------------------------------------------------
/** "08:50" en la hora local */
export function hhmm(ms: number | string | Date): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}
/** "24 min" / "1 h 07" */
export function duracion(min: number): string {
  const m = Math.max(0, Math.round(min))
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`
}
/** 8 → "8", 7,5 → "7,5" */
export const m3txt = (x: number | null | undefined) => Number(x || 0).toLocaleString("es-AR", { maximumFractionDigits: 1 })

// ---------------------------------------------------------------------------
// Motivos (los mismos códigos que el CHECK de la base)
// ---------------------------------------------------------------------------
export type MotivoTipo = "lluvia" | "obra_no_lista" | "falla_bomba" | "falla_camion" | "falta_material" | "pedido_cliente" | "obra_pidio_menos" | "otro"
export const MOTIVOS_SUSPENDER: [MotivoTipo, string][] = [
  ["lluvia", "Lluvia"], ["obra_no_lista", "Obra no está lista"], ["falla_bomba", "Falla de bomba"], ["falla_camion", "Falla de camión"],
  ["falta_material", "Falta material"], ["pedido_cliente", "Pedido del cliente"], ["otro", "Otro"],
]
export const MOTIVOS_FINALIZAR: [MotivoTipo, string][] = [["obra_pidio_menos", "La obra pidió menos"], ["lluvia", "Lluvia"], ["falla_bomba", "Falla"], ["otro", "Otro"]]
export const MOTIVOS_CANCELAR: [MotivoTipo, string][] = MOTIVOS_SUSPENDER
const TEXTO_MOTIVO: Record<string, string> = Object.fromEntries([...MOTIVOS_SUSPENDER, ["obra_pidio_menos", "La obra pidió menos"]])
export const textoMotivo = (tipo: string | null | undefined) => (tipo ? TEXTO_MOTIVO[tipo] || tipo : "-")

// ---------------------------------------------------------------------------
// Pedidos del día
// ---------------------------------------------------------------------------
export type PedidoDia = PedidoParaViajes & {
  client_id?: string
  formula_id?: string
  status: string
  dispatched_m3?: number | null
  suspendido_at?: string | null
  confirmado_at?: string | null
}

/** Estado del pedido para la pantalla (los suspendidos siguen "activos" para status: ver fase-3.md 7). */
export type EstadoPedido = "activo" | "suspendido" | "completo" | "cancelado"
export function estadoPedido(p: { status: string; suspendido_at?: string | null }): EstadoPedido {
  if (p.status === "cancelled") return "cancelado"
  if (p.status === "completed") return "completo"
  return p.suspendido_at ? "suspendido" : "activo"
}
export const faltaDe = (p: { quantity_m3: number; dispatched_m3?: number | null }) =>
  Math.max(0, Math.round((Number(p.quantity_m3) - Number(p.dispatched_m3 || 0)) * 100) / 100)

// ---------------------------------------------------------------------------
// Viajes del día
// ---------------------------------------------------------------------------
export type ViajeDia = ViajeRow & {
  /** El pedido no tenía viajes guardados: se calcularon en el momento, sin guardarlos (marca "calculado") */
  calculado: boolean
  /** Clave estable para la pantalla (id del viaje o "calc:pedido:n") */
  clave: string
}

/**
 * Viajes de los pedidos del día: los guardados (fase 2) y, para los pedidos activos SIN viajes guardados, los que
 * arma el motor de lib/viajes en el momento (no se guardan). Así la columna nunca queda vacía por un pedido viejo.
 */
export function viajesDelDia(
  pedidos: PedidoDia[],
  viajesPorPedido: Record<string, ViajeRow[]>,
  prmDePlanta: (plantId: string) => Parametros,
  tiempos: TiemposGps | null = null,
): ViajeDia[] {
  const out: ViajeDia[] = []
  for (const p of pedidos) {
    const guardados = viajesPorPedido[p.id] || []
    if (guardados.length) {
      for (const v of guardados) out.push({ ...v, m3: Number(v.m3), calculado: false, clave: v.id || `${p.id}:${v.n}` })
      continue
    }
    if (estadoPedido(p) === "cancelado" || estadoPedido(p) === "completo") continue
    const prm = parametrosConGps(prmDePlanta(p.plant_id), p.plant_id, tiempos)
    const calc = generarViajes(conTiemposGps(p, prm, tiempos), prm, [])
    for (const v of calc) out.push({ ...v, calculado: true, clave: `calc:${p.id}:${v.n}` })
  }
  return out
}

/** Pendientes de los pedidos activos (no suspendidos), por hora de carga. */
export function viajesPendientes(viajes: ViajeDia[], pedidos: PedidoDia[]): ViajeDia[] {
  const activos = new Set(pedidos.filter((p) => estadoPedido(p) === "activo").map((p) => p.id))
  return viajes.filter((v) => v.estado === "planificado" && activos.has(v.pedido_id)).sort((a, b) => t(a.hora_carga) - t(b.hora_carga) || a.n - b.n)
}
/** Viajes pendientes de pedidos suspendidos ("4 viajes en pausa"). */
export function viajesEnPausa(viajes: ViajeDia[], pedidos: PedidoDia[]): number {
  const susp = new Set(pedidos.filter((p) => estadoPedido(p) === "suspendido").map((p) => p.id))
  return viajes.filter((v) => v.estado === "planificado" && susp.has(v.pedido_id)).length
}

// ---------------------------------------------------------------------------
// Atraso (misma regla de la fase 2: ya pasó la hora de carga y no salió)
// ---------------------------------------------------------------------------
export type Atraso = { tipo: "atrasado" | "ahora" | null; min: number; texto: string | null }
export function atraso(horaCarga: string, ahora: number, ventanaAhoraMin = 15): Atraso {
  const dif = (ahora - t(horaCarga)) / MIN
  if (!Number.isFinite(dif)) return { tipo: null, min: 0, texto: null }
  if (dif > 0) {
    const min = Math.max(1, Math.floor(dif))
    return { tipo: "atrasado", min, texto: `Atrasado ${duracion(min)}` }
  }
  const falta = Math.ceil(-dif)
  if (falta <= ventanaAhoraMin) return { tipo: "ahora", min: falta, texto: falta <= 0 ? "Ahora" : `Ahora · en ${duracion(falta)}` }
  return { tipo: null, min: falta, texto: null }
}

// ---------------------------------------------------------------------------
// Contadores del día
// ---------------------------------------------------------------------------
export type Contadores = { programado: number; despachado: number; falta: number; suspendido: number; cancelado: number; viajesDespachados: number; viajesTotal: number }
export function contadoresDia(
  pedidos: PedidoDia[],
  despachos: { quantity_m3: number; is_test_dispatch?: boolean | null }[],
  viajes: ViajeDia[],
): Contadores {
  const r2 = (x: number) => Math.round(x * 100) / 100
  const est = (p: PedidoDia) => estadoPedido(p)
  const noCanc = pedidos.filter((p) => est(p) !== "cancelado")
  const vivos = new Set(noCanc.map((p) => p.id))
  const vs = viajes.filter((v) => v.estado !== "cancelado" && vivos.has(v.pedido_id))
  return {
    programado: r2(noCanc.reduce((s, p) => s + Number(p.quantity_m3), 0)),
    despachado: r2(despachos.filter((d) => !d.is_test_dispatch).reduce((s, d) => s + Number(d.quantity_m3 || 0), 0)),
    falta: r2(pedidos.filter((p) => est(p) === "activo").reduce((s, p) => s + faltaDe(p), 0)),
    suspendido: r2(pedidos.filter((p) => est(p) === "suspendido").reduce((s, p) => s + faltaDe(p), 0)),
    cancelado: r2(pedidos.filter((p) => est(p) === "cancelado").reduce((s, p) => s + faltaDe(p), 0)),
    viajesDespachados: vs.filter((v) => v.estado === "despachado").length,
    viajesTotal: vs.length,
  }
}

// ---------------------------------------------------------------------------
// Estado del camión
// ---------------------------------------------------------------------------
export type EstadoClave = "planta" | "yendo" | "obra" | "volviendo" | "taller" | "fuera"
export type FuenteEstado = "gps" | "estimado" | "a_mano"

/** Lo que devuelve /api/gps/posiciones para un camión (null = no está en Wialon o el GPS no está conectado). */
export type GpsCamion = {
  estado: "en_planta" | "hacia_obra" | "en_obra" | "volviendo" | "detenido" | "sin_senal"
  ultima_posicion?: string | null
  /** id de la planta donde está (dentro de la geocerca), si está en una */
  planta_id?: string | null
  /** parado fuera de planta, con remito de hoy y la obra sin ubicar */
  probable_obra?: boolean
} | null

export type MixerDia = { id: string; license_plate: string; status: string; estado_desde?: string | null; updated_at?: string | null; plant_id?: string | null }

/** El último despacho de hoy del camión, con los horarios de su viaje (fase 2) si los tiene. */
export type DespachoCamion = {
  id: string
  dispatch_date: string
  plant_id: string
  obra?: string | null
  /** Minutos planificados: ida, descarga y vuelta (con lavado). Sin viaje: los de la obra / de referencia. */
  idaMin: number
  descargaMin: number
  vueltaMin: number
} | null

export type EstadoCamion = {
  clave: EstadoClave
  etiqueta: string
  /** desde cuándo está en este estado (ms) */
  desde: number | null
  fuente: FuenteEstado
  /** "si" = libre; "avisa" = se puede despachar igual con aviso; "no" = taller / fuera de servicio */
  despachable: "si" | "avisa" | "no"
  /** minutos desde la salida del remito (ciclo del viaje en curso) */
  cicloMin: number | null
  /** sin GPS: vuelta estimada (ms) */
  vueltaEstimada: number | null
  /** sin GPS: pasó la vuelta estimada + 30 min → "¿Volvió?" */
  preguntarVolvio: boolean
  /** sin GPS: entre la vuelta estimada y la media hora */
  llegando: boolean
  /** GPS parado fuera de planta con remito y obra sin ubicar */
  probableObra: boolean
  /** El GPS lo ve dentro de una planta después de salir: hay que marcarlo libre (camion_volvio fuente GPS) */
  liberarPorGps: boolean
  /** planta donde está (libre) o a la que vuelve */
  plantaId: string | null
  /** sin GPS (no está en Wialon o más de 3 h sin posición) */
  sinGps: boolean
}

/** Minutos de viaje mínimos para que el GPS lo libere solo al verlo en planta (fase-3.md 11, riesgos). */
export const MIN_VIAJE_PARA_LIBERAR = 15
const SIN_SENAL_MS = 3 * 60 * MIN

/**
 * El estado del camión, en una sola función: GPS si hay señal (manda sobre mixers.status), si no lo estimado con
 * los horarios del viaje despachado, y las marcas a mano (taller, fuera de servicio, volvió a planta).
 * Yendo, en obra y volviendo se calculan: no se guardan en mixers.status.
 */
export function estadoCamion(m: MixerDia, gps: GpsCamion, despacho: DespachoCamion, ahora: number): EstadoCamion {
  const base = {
    cicloMin: null as number | null, vueltaEstimada: null as number | null, preguntarVolvio: false, llegando: false,
    probableObra: false, liberarPorGps: false,
  }
  const desdeEstado = t(m.estado_desde || m.updated_at || null)
  const desdeOk = Number.isFinite(desdeEstado) ? desdeEstado : null
  const sinGps = !gps || gps.estado === "sin_senal" || (!!gps.ultima_posicion && ahora - t(gps.ultima_posicion) > SIN_SENAL_MS)
  const plantaLibre = despacho?.plant_id || m.plant_id || null

  if (m.status === "maintenance")
    return { ...base, clave: "taller", etiqueta: "En taller", desde: desdeOk, fuente: "a_mano", despachable: "no", plantaId: plantaLibre, sinGps }
  if (m.status === "unavailable")
    return { ...base, clave: "fuera", etiqueta: "Fuera de servicio", desde: desdeOk, fuente: "a_mano", despachable: "no", plantaId: plantaLibre, sinGps }

  const salida = despacho ? t(despacho.dispatch_date) : NaN
  const conViaje = m.status === "in_transit" && despacho != null && Number.isFinite(salida) && salida <= ahora
  const ciclo = conViaje ? (ahora - salida) / MIN : null

  if (!sinGps && gps) {
    const fuente: FuenteEstado = "gps"
    if (gps.estado === "en_planta") {
      // Volvió: el GPS lo ve en una planta después de salir con un remito de hoy (y no recién salido)
      if (conViaje && ciclo! >= MIN_VIAJE_PARA_LIBERAR)
        return { ...base, clave: "planta", etiqueta: "En planta · libre", desde: ahora, fuente, despachable: "si", liberarPorGps: true, plantaId: gps.planta_id || plantaLibre, sinGps }
      if (conViaje)
        return { ...base, clave: "yendo", etiqueta: "Yendo a obra", desde: salida, fuente, despachable: "avisa", cicloMin: ciclo, plantaId: despacho!.plant_id, sinGps }
      if (m.status === "in_transit")
        // En ruta sin remito de hoy (quedó así de otro día) y el GPS lo ve en planta: libre
        return { ...base, clave: "planta", etiqueta: "En planta · libre", desde: ahora, fuente, despachable: "si", liberarPorGps: false, plantaId: gps.planta_id || plantaLibre, sinGps }
      return { ...base, clave: "planta", etiqueta: "En planta · libre", desde: desdeOk, fuente, despachable: "si", plantaId: gps.planta_id || plantaLibre, sinGps }
    }
    if (conViaje) {
      if (gps.estado === "en_obra") return { ...base, clave: "obra", etiqueta: "En obra", desde: salida, fuente, despachable: "avisa", cicloMin: ciclo, plantaId: despacho!.plant_id, sinGps }
      if (gps.estado === "volviendo") return { ...base, clave: "volviendo", etiqueta: "Volviendo", desde: salida, fuente, despachable: "avisa", cicloMin: ciclo, plantaId: despacho!.plant_id, sinGps }
      if (gps.estado === "detenido" && gps.probable_obra)
        return { ...base, clave: "obra", etiqueta: "Parado fuera de planta", desde: salida, fuente, despachable: "avisa", cicloMin: ciclo, probableObra: true, plantaId: despacho!.plant_id, sinGps }
      // Parado en la calle (semáforo, etc.) con la obra ubicada: como en /api/gps/posiciones, por el tiempo de ida
      if (gps.estado === "detenido" && ciclo! > despacho!.idaMin + 15)
        return { ...base, clave: "volviendo", etiqueta: "Volviendo", desde: salida, fuente, despachable: "avisa", cicloMin: ciclo, plantaId: despacho!.plant_id, sinGps }
      return { ...base, clave: "yendo", etiqueta: "Yendo a obra", desde: salida, fuente, despachable: "avisa", cicloMin: ciclo, plantaId: despacho!.plant_id, sinGps }
    }
    // Sin remito de hoy en curso y fuera de planta: vale lo que diga mixers.status
    if (m.status === "in_transit")
      return { ...base, clave: "volviendo", etiqueta: "En ruta (sin despacho de hoy)", desde: desdeOk, fuente, despachable: "avisa", plantaId: plantaLibre, sinGps }
    return { ...base, clave: "planta", etiqueta: "Libre · fuera de planta", desde: desdeOk, fuente, despachable: "si", plantaId: plantaLibre, sinGps }
  }

  // Sin GPS: estimado con los horarios del viaje despachado
  if (conViaje) {
    const llegada = salida + despacho!.idaMin * MIN
    const fin = llegada + despacho!.descargaMin * MIN
    const vuelta = fin + despacho!.vueltaMin * MIN
    const est = { ...base, fuente: "estimado" as const, despachable: "avisa" as const, cicloMin: ciclo, vueltaEstimada: vuelta, plantaId: despacho!.plant_id, sinGps }
    if (ahora < llegada) return { ...est, clave: "yendo", etiqueta: "Yendo a obra", desde: salida }
    if (ahora < fin) return { ...est, clave: "obra", etiqueta: "En obra", desde: llegada }
    return { ...est, clave: "volviendo", etiqueta: "Volviendo", desde: fin, preguntarVolvio: ahora > vuelta + 30 * MIN, llegando: ahora > vuelta && ahora <= vuelta + 30 * MIN }
  }
  if (m.status === "in_transit")
    return { ...base, clave: "volviendo", etiqueta: "En ruta (sin despacho de hoy)", desde: desdeOk, fuente: "estimado", despachable: "avisa", preguntarVolvio: true, plantaId: plantaLibre, sinGps }
  return { ...base, clave: "planta", etiqueta: "En planta · libre", desde: desdeOk, fuente: "a_mano", despachable: "si", plantaId: plantaLibre, sinGps }
}

/** Orden de la columna Camiones: libres en esta planta, libres en la otra, en viaje (el que vuelve antes primero), taller, fuera. */
export function ordenCamion(e: EstadoCamion, plantaElegida: string): number {
  if (e.clave === "planta") return e.plantaId === plantaElegida ? 0 : 1
  if (e.clave === "taller") return 8
  if (e.clave === "fuera") return 9
  return 2 + (e.vueltaEstimada ? e.vueltaEstimada / 1e14 : 0.5)
}

/** Texto de la fuente para la tarjeta */
export function textoFuenteEstado(e: EstadoCamion): string {
  if (e.fuente === "gps") return e.probableObra ? "GPS · probable obra" : "GPS"
  if (e.fuente === "estimado") return "sin GPS · estimado"
  return e.sinGps ? "a mano · sin GPS" : "a mano"
}

// ---------------------------------------------------------------------------
// Puntualidad del primer camión
// ---------------------------------------------------------------------------
export type Puntualidad = { clase: "ok" | "mal" | "na"; texto: string } | null
export function puntualidadPrimerCamion(opts: {
  llegadaPedida: string
  toleranciaMin: number
  viajeMin: number
  /** despachos del pedido (salida = dispatch_date) */
  despachos: { id: string; dispatch_date: string; mixer_id?: string | null }[]
  /** llegada real a obra por despacho (viajes_gps de la 4a, días anteriores) */
  llegadaGps?: Record<string, string | null | undefined>
  /** estado actual del camión del primer remito, si es su viaje en curso */
  enObraAhoraGps?: boolean
  proximaCarga?: string | null
  ahora: number
}): Puntualidad {
  const pedida = t(opts.llegadaPedida)
  if (!opts.despachos.length) return opts.proximaCarga ? { clase: "na", texto: `1.er camión carga ${hhmm(opts.proximaCarga)}` } : null
  const primero = [...opts.despachos].sort((a, b) => t(a.dispatch_date) - t(b.dispatch_date))[0]
  const real = opts.llegadaGps?.[primero.id]
  const dif = (llegada: number) => Math.round((llegada - pedida) / MIN)
  const txtDif = (d: number) => (d > 0 ? `+${d} min` : d === 0 ? "justo" : `${d} min`)
  const clase = (d: number) => (d <= opts.toleranciaMin ? "ok" : "mal") as "ok" | "mal"
  if (real) {
    const d = dif(t(real))
    return { clase: clase(d), texto: `Llegó ${hhmm(real)} · pedido ${hhmm(pedida)} · ${txtDif(d)}` }
  }
  if (opts.enObraAhoraGps) {
    // El GPS lo ve en la obra: si todavía no pasó la tolerancia, llegó a tiempo seguro
    const aTiempo = opts.ahora <= pedida + opts.toleranciaMin * MIN
    return { clase: aTiempo ? "ok" : "na", texto: `En obra (GPS) · pedido ${hhmm(pedida)}${aTiempo ? " · a tiempo" : ""}` }
  }
  const llegada = t(primero.dispatch_date) + opts.viajeMin * MIN
  const d = dif(llegada)
  if (opts.ahora < llegada) return { clase: clase(d), texto: `Llegaría ~${hhmm(llegada)} (estimado) · pedido ${hhmm(pedida)}` }
  return { clase: clase(d), texto: `Llegó ~${hhmm(llegada)} (estimado) · ${txtDif(d)}` }
}

// ---------------------------------------------------------------------------
// Remito: talonario tipeado por planta y tipo (R con factura / X sin factura)
// ---------------------------------------------------------------------------
export type TipoRemito = "R" | "X"
export type OrigenTipo = "pedido" | "obra" | "cliente" | "dia" | "pregunta" | "manual" | "numero" | "script"
export const TIPO_TEXTO: Record<TipoRemito, string> = { R: "Con factura", X: "Sin factura" }
/** A partir de este número, los remitos son X (talonarios de imprenta 00002-00002201 … 00008200). */
export const PRIMER_X = 2201

/** Dígitos del remito sin los ceros de adelante ("755 HUDSON" → "755", "0841" → "841"). Igual que _remito_digitos. */
export function digitosRemito(remito: string | null | undefined): string | null {
  const d = String(remito ?? "").replace(/\D/g, "")
  if (!d) return null
  return d.replace(/^0+/, "") || "0"
}
/** Tipo que dice el número (igual que _remito_tipo_de_numero): ≥ 2201 X, si no R; más de 5 dígitos o sin dígitos: null. */
export function tipoPorNumero(remito: string | null | undefined): TipoRemito | null {
  const d = digitosRemito(remito)
  if (!d || d.length > 5) return null
  return Number(d) >= PRIMER_X ? "X" : "R"
}

export type RemitoHist = { remito: string | null; plant_id: string; remito_tipo?: string | null; created_at?: string | null; dispatch_date?: string | null }
const tipoEfectivo = (r: RemitoHist): TipoRemito | null => (r.remito_tipo === "R" || r.remito_tipo === "X" ? r.remito_tipo : tipoPorNumero(r.remito))

/** Números (de hasta 5 dígitos) de una planta y un tipo. */
export function numerosDe(hist: RemitoHist[], planta: string, tipo: TipoRemito): number[] {
  return hist
    .filter((r) => r.plant_id === planta && tipoEfectivo(r) === tipo)
    .map((r) => digitosRemito(r.remito))
    .filter((d): d is string => !!d && d.length <= 5)
    .map(Number)
}

/**
 * Sugerido: el siguiente número de ese tipo en esa planta. El mayor de los remitos que se pasan (los últimos 30
 * días) + 1, salteando los que ya existen. Se usa el mayor y no el último cargado porque se cargan desordenados.
 */
export function remitoSugerido(hist: RemitoHist[], planta: string, tipo: TipoRemito): { numero: number; ultimo: number } | null {
  const ns = numerosDe(hist, planta, tipo)
  if (!ns.length) return null
  const usados = new Set(ns)
  const ultimo = Math.max(...ns)
  let x = ultimo + 1
  while (usados.has(x)) x++
  return { numero: x, ultimo }
}

/**
 * ¿Ya hay ese remito en la planta y el tipo? (aviso en pantalla; el que frena de verdad es la base). Mismo criterio
 * que _remito_repetido: dígitos sin ceros adelante; sin dígitos, el texto; si no se sabe el tipo, choca igual.
 */
export function remitoRepetido(hist: RemitoHist[], planta: string, tipo: TipoRemito | null, texto: string): boolean {
  const d = digitosRemito(texto)
  return hist.some((r) => {
    if (r.plant_id !== planta) return false
    const igual = d ? digitosRemito(r.remito) === d : String(r.remito ?? "").trim() === texto.trim()
    if (!igual) return false
    const te = tipoEfectivo(r)
    return !tipo || !te || te === tipo
  })
}

export type AvisoRemito = { clave: "digitos" | "otro_tipo" | "salta" | "otra_planta"; texto: string }

/**
 * Avisos que no frenan (se despacha igual tocando "Sí, el número está bien" y queda en Actividad):
 * dígitos de más, parece del otro tipo, salta mucho (más de 20 arriba o 50 abajo del mayor) y X ya usado en la otra
 * planta (la numeración X es de imprenta, un solo rango).
 */
export function avisosRemito(
  texto: string, planta: string, tipo: TipoRemito, hist: RemitoHist[],
  nombres: { planta: string; otraPlanta?: string | null; otraPlantaId?: string | null },
): AvisoRemito | null {
  const d = digitosRemito(texto)
  if (!d) return null
  const nR = numerosDe(hist, planta, "R"), nX = numerosDe(hist, planta, "X")
  const largo = (ns: number[]) => (ns.length ? String(Math.max(...ns)).length : null)
  const lr = largo(nR), lx = largo(nX)
  const largoTipo = tipo === "R" ? lr : lx
  if (d.length > 5 || (largoTipo != null && d.length >= largoTipo + 2)) {
    const tienen = [lr != null ? `los R de ${nombres.planta} tienen ${lr}` : null, lx != null ? `los X, ${lx}` : null].filter(Boolean).join(" y ")
    return { clave: "digitos", texto: `¿No juntaste dos números? ${d} tiene ${d.length} dígitos${tienen ? `. ${tienen.charAt(0).toUpperCase()}${tienen.slice(1)}` : ""}.` }
  }
  const n = Number(d)
  const otro = tipoPorNumero(d)
  if (otro && otro !== tipo) {
    const ns = tipo === "R" ? nR : nX
    const va = ns.length ? ` Los ${tipo} de ${nombres.planta} van por el ${Math.max(...ns)}.` : ""
    return { clave: "otro_tipo", texto: `${d} parece un remito ${otro} (${TIPO_TEXTO[otro].toLowerCase()}).${va}` }
  }
  const ns = tipo === "R" ? nR : nX
  if (ns.length) {
    const max = Math.max(...ns)
    if (n > max + 20) return { clave: "salta", texto: `Salta mucho: el último ${tipo} de ${nombres.planta} es ${max}.` }
    if (n < max - 50) return { clave: "salta", texto: `Es mucho más bajo que los últimos: el mayor ${tipo} de ${nombres.planta} es ${max}.` }
  }
  if (tipo === "X" && nombres.otraPlantaId && numerosDe(hist, nombres.otraPlantaId, "X").includes(n))
    return { clave: "otra_planta", texto: `El X ${d} ya se usó en ${nombres.otraPlanta || "la otra planta"}. ¿No agarraste el talonario de la otra planta?` }
  return null
}
export const TEXTO_AVISO: Record<AvisoRemito["clave"], string> = {
  digitos: "dígitos de más",
  otro_tipo: "parece del otro tipo",
  salta: "salta mucho",
  otra_planta: "X ya usado en la otra planta",
}

/** "RM2: 0099-00003201" (X) / "RM: 0099-00000776" (R): lo que imprime el remito pre-impreso. */
export function numeroImpreso(tipo: TipoRemito | null | undefined, remito: string | null | undefined): string {
  const d = digitosRemito(remito)
  const num = d ? `0099-${d.padStart(8, "0")}` : `0099-${String(remito ?? "").trim()}`
  return `${tipo === "R" ? "RM" : "RM2"}: ${num}`
}

// ---------------------------------------------------------------------------
// Formulario Entrega: validación y jsonb para registrar_despacho
// ---------------------------------------------------------------------------
export type FormEntrega = {
  m3: string
  mixerId: string
  choferId: string
  remito: string
  tipo: TipoRemito | null
  origenTipo: OrigenTipo | null
  /** "HH:MM" de "Salió a las" */
  salio: string
  /** el operario cambió "Salió a las" (si no, la hora la pone la base) */
  salioTocado: boolean
  agua: string
  fibraOn: boolean
  fibraKgM3: string
  muestraOn: boolean
  muestraNum: string
  asentamiento: string
}

export const num = (s: string | number | null | undefined) => {
  const n = parseFloat(String(s ?? "").replace(",", "."))
  return Number.isFinite(n) ? n : NaN
}

/** "Salió a las" (HH:MM) del día de `ahora` en ms; NaN si no es válida. */
export function salidaMs(hhmmTxt: string, ahora: number): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmmTxt || "").trim())
  if (!m) return NaN
  const d = new Date(ahora)
  d.setHours(Number(m[1]), Number(m[2]), 0, 0)
  return d.getTime()
}

/** Error que frena (o null). Las mismas reglas de la pantalla de siempre, más tipo de remito y "Salió a las". */
export function validarEntrega(f: FormEntrega, ctx: {
  falta: number
  hayChoferes: boolean
  camionEnTaller: boolean
  repetido: boolean
  plantaNombre: string
  ahora: number
}): string | null {
  const m3 = num(f.m3)
  if (!(m3 > 0)) return "Poné los m³ de este camión."
  if (m3 > ctx.falta + 0.5) return `Supera lo que falta del pedido (${m3txt(ctx.falta)} m³).`
  if (!f.mixerId) return "Elegí el camión."
  if (ctx.camionEnTaller) return "Ese camión está en taller o fuera de servicio. Elegí otro o ponelo «Disponible»."
  if (ctx.hayChoferes && !f.choferId) return "Elegí el chofer."
  if (!f.tipo) return "Contestá si el remito va con o sin factura."
  if (!f.remito.trim()) return "El número de remito es obligatorio."
  if (ctx.repetido) return `Ya hay un remito ${f.tipo} ${digitosRemito(f.remito) || f.remito.trim()} en ${ctx.plantaNombre}. No se puede cargar dos veces.`
  if (f.salioTocado) {
    const s = salidaMs(f.salio, ctx.ahora)
    if (!Number.isFinite(s)) return "Poné la hora de salida."
    if (s > ctx.ahora + 60_000) return "La hora de salida no puede ser más tarde que ahora."
    if (ctx.ahora - s > 12 * 60 * MIN) return "La hora de salida tiene que ser de hoy (hasta 12 h para atrás)."
  }
  if (f.fibraOn && !(num(f.fibraKgM3) > 0)) return "Poné los kg de fibra por m³ (o apagá Fibra)."
  if (f.muestraOn && (!f.muestraNum.trim() || !f.asentamiento.trim())) return "Completá el número de muestra y el asentamiento."
  if (f.muestraOn && !Number.isFinite(num(f.asentamiento))) return "El asentamiento tiene que ser un número (en cm)."
  return null
}

/** El jsonb de `registrar_despacho`: el mismo de la pantalla de siempre, más viaje, hora de salida y tipo de remito. */
export function armarPayloadDespacho(opts: {
  plantId: string
  pedido: { id: string; formula_id?: string; client_id?: string; construction_site_id?: string | null }
  viajeId: string | null
  form: FormEntrega
  usuario: string
  ahora: number
  aviso?: AvisoRemito | null
}): Record<string, unknown> {
  const f = opts.form
  const fibra = num(f.fibraKgM3)
  return {
    plant_id: opts.plantId,
    scheduled_dispatch_id: opts.pedido.id,
    formula_id: opts.pedido.formula_id,
    client_id: opts.pedido.client_id,
    construction_site_id: opts.pedido.construction_site_id,
    mixer_id: f.mixerId,
    ...(f.choferId ? { chofer_id: f.choferId } : {}),
    ...(opts.viajeId ? { viaje_id: opts.viajeId } : {}),
    quantity_m3: num(f.m3),
    remito: f.remito.trim(),
    extra_water_liters: num(f.agua) || 0,
    fiber_kg_per_m3: f.fibraOn && fibra > 0 ? fibra : 0,
    sample_taken: f.muestraOn,
    sample_number: f.muestraOn ? f.muestraNum.trim() : null,
    actual_slump_cm: f.muestraOn ? num(f.asentamiento) : null,
    created_by: opts.usuario,
    usuario: opts.usuario,
    // Fase 3
    ...(f.salioTocado ? { dispatch_date: new Date(salidaMs(f.salio, opts.ahora)).toISOString() } : {}),
    remito_tipo: f.tipo,
    remito_tipo_origen: f.origenTipo,
    ...(opts.aviso ? { aviso_remito: TEXTO_AVISO[opts.aviso.clave] } : {}),
    // En Actividad, para medir cuándo se deja de usar la pantalla de siempre
    pantalla: "Despacho en tres columnas",
  }
}

/** Camión propuesto para un viaje: el sugerido si está libre en esta planta, si no el primer libre de esta planta. */
export function camionPropuesto(sugerido: string | null | undefined, estados: { id: string; e: EstadoCamion }[], planta: string): string | null {
  const libreAca = (x: { e: EstadoCamion }) => x.e.clave === "planta" && x.e.plantaId === planta
  if (sugerido) {
    const s = estados.find((x) => x.id === sugerido)
    if (s && libreAca(s)) return sugerido
  }
  return estados.find(libreAca)?.id || estados.find((x) => x.e.clave === "planta")?.id || null
}

/** Re-export para la pantalla */
export { pendientes }
