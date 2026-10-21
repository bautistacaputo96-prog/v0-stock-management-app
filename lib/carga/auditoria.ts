/**
 * Auditoría de carga (carga-planta.md 11, con 19.5 agua extra y 19.6 tiempos), y el emparejador (el "broker" de Loop)
 * que une con su remito las cargas que nacen en Indumix sin orden nuestra.
 */
import { TOLERANCIAS_BASE, digitos, normalizarPatente, type Grupo, type Salida } from "@/lib/carga/tipos"

export type MaterialAuditoria = {
  salida: Salida
  material_id: string | null
  nombre: string
  grupo: Grupo
  unidad: string
  receta_por_m3: number | null
  formula_por_m3: number | null
  teorico: number | null
  humedad_pct: number | null
  teorico_corregido: number | null
  real: number | null
}

export type CargaAuditoria = {
  id: string
  origen: "sistema" | "indumix" | "prueba"
  simulada: boolean
  estado: string
  contador: number | null
  inicio_at: string | null
  fin_at: string | null
  m3: number | null
  m3_cargados: number | null
  ciclos: number | null
  receta_numero: number | null
  /** la receta coincidía con la fórmula (sin contar el agua) cuando se cargó */
  receta_ok: boolean
  agua_distinta: boolean
  autorizada: boolean
  /** cómo terminó una parada: sale / completar / tirada */
  parada: string | null
  completa_carga_id: string | null
  materiales: MaterialAuditoria[]
  plantista: string | null
  patente_planta: string | null
  observacion_planta: string | null
  revisada: boolean
}

export type DespachoAuditoria = {
  id: string
  remito: string | null
  remito_tipo: string | null
  patente: string | null
  /** hora en que se grabó (created_at) */
  despachado_at: string | null
  /** "Salió a las" (dispatch_date) */
  salio_at: string | null
  cliente: string
  obra: string
  formula: string
  m3: number
  anulado?: boolean
}

export type FilaAuditoria = {
  despacho: DespachoAuditoria | null
  cargas: CargaAuditoria[]
  extras: { litros: number; at: string; despues_de_terminar: boolean; usuario: string | null }[]
  salida_gps: string | null
  union: "por id" | "por remito (Observación)" | "por camión y hora" | null
}

export type Bandera = "sinRemito" | "sinCarga" | "difVol" | "desv" | "receta" | "aguaDist" | "aguaExtra" | "indumix" | "parada" | "simulada"

export const NOMBRE_BANDERA: Record<Bandera, string> = {
  sinRemito: "Sin remito", sinCarga: "Sin carga", difVol: "Dif. volumen", desv: "Desviación", receta: "Receta distinta",
  aguaDist: "Agua distinta", aguaExtra: "Agua extra", indumix: "Desde Indumix", parada: "Parada", simulada: "Simulada",
}

/** Lo pesado fuera de la tolerancia de pesaje contra el teórico corregido (cemento 1 %, áridos 2 %, agua y aditivos 3 %). */
export function desvio(m: Pick<MaterialAuditoria, "grupo" | "teorico_corregido" | "real">, tol: Record<Grupo, number> = TOLERANCIAS_BASE.pesaje): boolean {
  const tc = Number(m.teorico_corregido || 0)
  if (!(tc > 0) || m.real == null) return false
  return Math.abs(Number(m.real) - tc) > tol[m.grupo] * tc + 1e-9
}

const m3DeCargas = (cs: CargaAuditoria[]) => cs.reduce((s, c) => s + Number(c.m3_cargados ?? c.m3 ?? 0), 0)
const MIN = 60_000

/**
 * Banderas de una fila. `ahora` sirve para "sin remito": la carga terminada hace más de 30 min sin despacho unido.
 * Las de "sin carga" las pone quien arma las filas solo para los días con el puente conectado.
 */
export function banderas(f: FilaAuditoria, ahora: number, tol?: Record<Grupo, number>): Bandera[] {
  const b: Bandera[] = []
  const cs = f.cargas
  const principal = cs[0] || null
  if (!f.despacho && principal && principal.origen !== "prueba") {
    const fin = principal.fin_at ? new Date(principal.fin_at).getTime() : null
    if (fin == null || ahora - fin > 30 * MIN) b.push("sinRemito")
  }
  if (f.despacho && !f.despacho.anulado && !cs.length) b.push("sinCarga")
  const termino = cs.filter((c) => c.estado === "terminada" || c.estado === "parada" || c.estado === "leida" || c.estado === "ya_cargada_indumix")
  if (f.despacho && termino.length && !cs.some((c) => c.parada === "completar" && !cs.some((x) => x.completa_carga_id === c.id && x.estado === "terminada"))) {
    if (Math.abs(m3DeCargas(termino) - f.despacho.m3) > 0.1) b.push("difVol")
  }
  if (cs.some((c) => !c.parada && c.materiales.some((m) => desvio(m, tol)))) b.push("desv")
  if (cs.some((c) => !c.receta_ok || c.autorizada)) b.push("receta")
  if (cs.some((c) => c.agua_distinta)) b.push("aguaDist")
  if (f.extras.length) b.push("aguaExtra")
  if (cs.some((c) => c.origen === "indumix")) b.push("indumix")
  if (cs.some((c) => c.parada)) b.push("parada")
  if (cs.some((c) => c.simulada)) b.push("simulada")
  return b
}

/** Tiempos de planta (19.6): tiempo de carga y espera hasta salir (GPS). En minutos. */
export function tiempos(f: Pick<FilaAuditoria, "cargas" | "salida_gps">): { cargaMin: number | null; esperaSalidaMin: number | null } {
  const c = f.cargas.find((x) => x.inicio_at && x.fin_at) || null
  const ini = c?.inicio_at ? new Date(c.inicio_at).getTime() : null
  const fin = f.cargas.reduce<number | null>((m, x) => (x.fin_at ? Math.max(m ?? 0, new Date(x.fin_at).getTime()) : m), null)
  const sal = f.salida_gps ? new Date(f.salida_gps).getTime() : null
  return {
    cargaMin: ini != null && fin != null ? (fin - ini) / MIN : null,
    esperaSalidaMin: fin != null && sal != null && sal >= fin - MIN ? (sal - fin) / MIN : null,
  }
}

export type Candidato = { id: string; remito: string | null; patente: string | null; at: number; tipo?: string | null }

/** "R 886", "X0886", "886" → tipo R/X si lo dice (null si no). */
export function tipoDeObservacion(t: string | null | undefined): "R" | "X" | null {
  const m = String(t ?? "").toUpperCase().match(/(?:^|[^A-Z])([RX])\s*-?\s*\d/)
  return m ? (m[1] as "R" | "X") : null
}

/**
 * Emparejador: une una carga hecha en Indumix (sin orden nuestra) con un despacho o una orden de la cola.
 * 1. por el remito escrito en "Observación" (solo dígitos: "0886" = "886"). Si hay más de uno con esos dígitos (la
 *    serie R y la X se pisan), prefiere el del mismo tipo (si la Observación dice "R" o "X"), después el del mismo
 *    camión y después el más cercano en la hora;
 * 2. si no, por camión (patente normalizada, "AG 083 GT" = "AG083GT") y hora: la carga terminó entre 30 min antes y
 *    2 h después del despacho (con la secuencia A el despacho va primero). Se queda con el más cercano.
 */
export function emparejar(
  carga: { observacion: string | null; patente: string | null; fin: number | null },
  candidatos: Candidato[],
): { id: string; union: "por remito (Observación)" | "por camión y hora" } | null {
  const obs = digitos(carga.observacion)
  const pat = normalizarPatente(carga.patente)
  if (obs) {
    const tipo = tipoDeObservacion(carga.observacion)
    const cand = candidatos.filter((x) => x.remito && digitos(x.remito) === obs)
    const puntos = (x: Candidato) => (tipo && (x.tipo || tipoDeObservacion(x.remito)) === tipo ? 2 : 0) + (pat && normalizarPatente(x.patente) === pat ? 1 : 0)
    const dist = (x: Candidato) => (carga.fin != null ? Math.abs(carga.fin - x.at) : 0)
    const c = [...cand].sort((a, b) => puntos(b) - puntos(a) || dist(a) - dist(b))[0]
    if (c) return { id: c.id, union: "por remito (Observación)" }
  }
  if (pat && carga.fin != null) {
    const enVentana = candidatos
      .filter((x) => normalizarPatente(x.patente) === pat && carga.fin! >= x.at - 30 * MIN && carga.fin! <= x.at + 120 * MIN)
      .sort((a, b) => Math.abs(carga.fin! - a.at) - Math.abs(carga.fin! - b.at))
    if (enVentana[0]) return { id: enVentana[0].id, union: "por camión y hora" }
  }
  return null
}

/** Resumen del agua extra (19.5): total, camiones, después de terminar, y por fórmula, camión y plantista. */
export function resumenAguaExtra(filas: FilaAuditoria[]) {
  const con = filas.filter((f) => f.extras.length)
  const litros = (f: FilaAuditoria) => f.extras.reduce((s, e) => s + Number(e.litros || 0), 0)
  const agrupar = (clave: (f: FilaAuditoria) => string) => {
    const m = new Map<string, number>()
    for (const f of con) m.set(clave(f), (m.get(clave(f)) || 0) + litros(f))
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }
  return {
    total: con.reduce((s, f) => s + litros(f), 0),
    camiones: new Set(con.map((f) => f.despacho?.patente || f.cargas[0]?.patente_planta || "?")).size,
    despues: con.reduce((s, f) => s + f.extras.filter((e) => e.despues_de_terminar).reduce((a, e) => a + Number(e.litros || 0), 0), 0),
    porFormula: agrupar((f) => f.despacho?.formula || "—"),
    porCamion: agrupar((f) => f.despacho?.patente || f.cargas[0]?.patente_planta || "—"),
    porPlantista: agrupar((f) => f.cargas[0]?.plantista || "—"),
  }
}
