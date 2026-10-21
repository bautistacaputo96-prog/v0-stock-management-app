/**
 * Carga de planta (dosificadora Indumix de Canning) · tipos compartidos.
 * Especificación: docs/migracion-loop/carga-planta.md (9.1 interfaz del puente; los puntos 18 a 21 mandan).
 *
 * Sin React, sin Supabase y sin imports en tiempo de ejecución: se prueba con `node --test` (npm run test:carga).
 */

/** Salidas de la planta: 4 tolvas de áridos, 2 roscas de cemento, 2 aditivos y el agua. */
export type Salida =
  | "arido_1" | "arido_2" | "arido_3" | "arido_4"
  | "cemento_1" | "cemento_2"
  | "aditivo_1" | "aditivo_2"
  | "agua"

export type Grupo = "arido" | "cemento" | "aditivo" | "agua"
export type UnidadPlanta = "kg" | "g" | "L"

export const SALIDAS: Salida[] = ["arido_1", "arido_2", "arido_3", "arido_4", "cemento_1", "cemento_2", "aditivo_1", "aditivo_2", "agua"]
export const ARIDOS: Salida[] = ["arido_1", "arido_2", "arido_3", "arido_4"]

export const INFO_SALIDA: Record<Salida, { grupo: Grupo; nombre: string; corto: string; unidad: UnidadPlanta }> = {
  arido_1: { grupo: "arido", nombre: "Tolva 1", corto: "T1", unidad: "kg" },
  arido_2: { grupo: "arido", nombre: "Tolva 2", corto: "T2", unidad: "kg" },
  arido_3: { grupo: "arido", nombre: "Tolva 3", corto: "T3", unidad: "kg" },
  arido_4: { grupo: "arido", nombre: "Tolva 4", corto: "T4", unidad: "kg" },
  cemento_1: { grupo: "cemento", nombre: "Rosca 1", corto: "R1", unidad: "kg" },
  cemento_2: { grupo: "cemento", nombre: "Rosca 2", corto: "R2", unidad: "kg" },
  aditivo_1: { grupo: "aditivo", nombre: "Aditivo 1", corto: "Ad1", unidad: "g" },
  aditivo_2: { grupo: "aditivo", nombre: "Aditivo 2", corto: "Ad2", unidad: "g" },
  agua: { grupo: "agua", nombre: "Agua", corto: "Agua", unidad: "L" },
}

export const grupoDeSalida = (s: Salida): Grupo => INFO_SALIDA[s].grupo

// ───────────────────────────── Lo que habla el puente con la dosificadora (9.1) ─────────────────────────────

export type RecetaPlanta = {
  numero: number
  nombre: string
  habilitada: boolean
  salidas: { salida: Salida; nombre_planta: string; valor: number; unidad: UnidadPlanta; orden?: number }[]
}

export type OrdenPlanta = { receta: number; secuencia: number; m3: number; cliente: string; camion: string; observacion: string }

export type EstadoBalanza = "vacia" | "pesando" | "llena" | "descargando"

export type EstadoPlanta = {
  en_linea: boolean
  en_ciclo: boolean
  suspendida: boolean
  /** La carga en curso se paró con PARAR (queda así hasta la próxima orden) */
  parada: boolean
  ciclo: number
  ciclos: number
  m3_ciclo: number
  /** segundos desde que empezó el ciclo */
  tiempo_ciclo_s: number
  /** segundos desde que empezó la carga */
  tiempo_total_s: number
  /** "Contador carga" de Indumix: número de la última carga que arrancó */
  contador_carga: number
  seleccion: OrdenPlanta | null
  salidas: { salida: Salida; real: number; objetivo: number; acumulado: number; total: number; humedad_pct?: number; nivel_pct: number; pesando: boolean }[]
  balanzas: { id: "aridos" | "cemento" | "aditivo"; valor: number; unidad: string; estado: EstadoBalanza; max: number }[]
  agua: { real: number; objetivo: number; extra: number }
  /** m³ que ya bajaron al trompo */
  m3_en_trompo: number
  cinta_en_marcha: boolean
  bocina: boolean
  alarmas: { codigo?: string; texto: string }[]
  /** Reloj de Indumix tal cual (vuelve a 1/1/1970 cada día): "4:57 - 1/1/1970" */
  reloj_plc: string
}

export type LineaReporte = { salida: Salida; receta: number; teorico: number; teorico_corregido: number; real: number; humedad_pct?: number; extra?: number }

export type ReportePlanta = {
  numero: number
  inicio_plc: string
  fin_plc: string
  cliente: string
  camion: string
  observacion: string
  m3: number
  receta: number
  receta_nombre: string
  secuencia: number
  ciclos: number
  /** "1:48" */
  tiempo_ciclo: string
  /** H% de cada tolva (1 a 4) */
  humedades: number[]
  /** true si se cortó con PARAR */
  parada: boolean
  /** m³ que entraron al trompo (en una parada, menos que `m3`) */
  m3_cargados: number
  lineas: LineaReporte[]
  /** agua extra agregada con el botón de Indumix */
  extras: { litros: number; despues_de_terminar: boolean; at_s: number }[]
}

export type InfoPlanta = { marca: string; version: string; max_recetas: number; m3_max_ciclo: number; reloj_plc: string }

/**
 * Adaptador de la dosificadora (lo que cambia según la marca). Hoy hay UNA implementación: el simulador
 * (`lib/carga/simulador.ts`). La de Indumix real (192.168.0.10) se programa después del jueves 23/10, cuando se sepa
 * cómo se conecta. Nunca escribe recetas en la planta (no hay método para eso, a propósito).
 */
export interface AdaptadorDosificadora {
  conectar(): Promise<void>
  info(): Promise<InfoPlanta>
  leerRecetas(): Promise<RecetaPlanta[]>
  leerEstado(): Promise<EstadoPlanta>
  leerReportes(): Promise<ReportePlanta[]>
  /** Selección de carga: receta, m³, secuencia, cliente, camión, observación. NO arranca. */
  escribirOrden(o: OrdenPlanta): Promise<void>
  leerOrden(): Promise<OrdenPlanta | null>
  /** = CARGAR de Indumix */
  arrancar(): Promise<void>
  /** = PARAR */
  parar(): Promise<void>
  suspender(): Promise<void>
  reanudar(): Promise<void>
  bocina(ms: number): Promise<void>
  /** = "Extra agua" de Indumix (19.5): durante la carga o después de terminar, con el camión en planta */
  extraAgua(litros: number): Promise<void>
}

/** La dosificadora no contesta (puente caído o red local cortada). */
export class SinConexionError extends Error {
  codigo = "sin_conexion"
  constructor(texto = "No hay conexión con la planta: usá el PARAR de Indumix o la parada de emergencia.") {
    super(texto)
    this.name = "SinConexionError"
  }
}

/** La planta rechazó la orden (lo decide el PLC: no se reintenta ni se saltea nada). */
export class PlantaRechazoError extends Error {
  codigo = "planta_rechazo"
  constructor(texto: string) {
    super(texto)
    this.name = "PlantaRechazoError"
  }
}

// ───────────────────────────── Lo que guarda nuestro sistema ─────────────────────────────

export type EstadoCarga =
  | "pendiente" | "bloqueada" | "lista" | "preparada" | "en_curso" | "suspendida"
  | "terminada" | "parada" | "cancelada" | "anulada" | "leida" | "ya_cargada_indumix"

export type OrigenCarga = "sistema" | "indumix" | "prueba"

/** Material de nuestro sistema, lo justo para comparar (materials). */
export type MaterialSistema = { id: string; name: string; tipo: string | null; unit?: string | null }

/** Una salida del mapa vigente (puesto_salidas). */
export type SalidaMapa = {
  salida: Salida
  nombre_planta: string | null
  material_id: string | null
  unidad_planta: UnidadPlanta
  /** de la unidad de Indumix a la nuestra (g → kg = 0,001) */
  factor: number
  /** materiales que puede tener esa salida (la Tolva 1: Piedra 6/12 o 6/20) */
  alternativas?: string[] | null
}

/** Fórmula: kg (o L de agua) por m³, en la unidad del sistema (aditivo en kg). */
export type FormulaSistema = { id: string; code: string; materiales: { material_id: string; cantidad: number }[] }

export type Tolerancia = { rel: number; abs: number }
export type Tolerancias = { receta: Record<Grupo, Tolerancia>; pesaje: Record<Grupo, number> }

/** 6.2: control de receta (la mayor de las dos) y tolerancias de pesaje de la auditoría (ASTM C94). Aditivo en kg/m³. */
export const TOLERANCIAS_BASE: Tolerancias = {
  receta: {
    cemento: { rel: 0.01, abs: 2 },
    agua: { rel: 0.02, abs: 3 },
    arido: { rel: 0.01, abs: 5 },
    aditivo: { rel: 0.02, abs: 0.02 },
  },
  pesaje: { cemento: 0.01, arido: 0.02, agua: 0.03, aditivo: 0.03 },
}

/** Grupo de dosificación de un material del sistema; null = no pasa por Indumix (aditivo de obra, fibra). */
export function grupoDeMaterial(tipo: string | null | undefined): Grupo | null {
  switch (tipo) {
    case "arido_fino":
    case "arido_grueso":
      return "arido"
    case "cemento":
      return "cemento"
    case "aditivo_planta":
      return "aditivo"
    case "agua":
      return "agua"
    default:
      return null
  }
}

/** Formato es-AR con `d` decimales (sin decimales de más). */
export function nf(x: number | null | undefined, d = 0): string {
  if (x == null || !Number.isFinite(x)) return "—"
  return Number(x).toLocaleString("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d })
}

export const m3txt = (x: number | null | undefined) => (x == null ? "—" : nf(x, Math.round(x * 10) % 10 ? 1 : 0))

/** Solo los dígitos: "0886" = "886" = "R 886". */
export function digitos(t: string | null | undefined): string {
  return String(t ?? "").replace(/\D/g, "").replace(/^0+(?=\d)/, "")
}

/** Patente sin espacios ni guiones, en mayúsculas: "AG 083 GT" = "AG083GT". */
export function normalizarPatente(t: string | null | undefined): string {
  return String(t ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "")
}

/** "AG083GT" → "AG 083 GT" (como lo escribe Indumix). */
export function patenteParaPlanta(p: string | null | undefined): string {
  const n = normalizarPatente(p)
  const m = n.match(/^([A-Z]{2})(\d{3})([A-Z]{2})$/) || n.match(/^([A-Z]{3})(\d{3})$/)
  return m ? m.slice(1).join(" ") : n
}
