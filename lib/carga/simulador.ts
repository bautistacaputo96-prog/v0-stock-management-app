/**
 * Simulador de la dosificadora Indumix (carga-planta.md 9.4). Implementa la misma interfaz que el adaptador real y
 * reproduce lo que muestran las fotos de Indumix:
 *
 * - ciclos de hasta 1,5 m³ (ciclos = m³ ÷ 1,5 redondeado para arriba, todos iguales);
 * - áridos pesados uno atrás del otro en el orden de la receta, sobre una sola balanza; cemento, aditivo y agua en
 *   paralelo; después la descarga al camión por la cinta;
 * - corrección por humedad: árido húmedo = seco × (1 + H%), y esa agua se descuenta del agua de la receta
 *   (receta 13 × 3 m³ con H% 0/0/3/0: agua 330 − 62,5 = 268 L reales, como el reporte del remito 885);
 * - compensación entre ciclos: el objetivo de cada ciclo es lo que falta ÷ los ciclos que quedan, así que el último
 *   es el total menos lo real de los anteriores (cemento 1.050 − 528,075 = 521,925);
 * - error de pesaje chico y al azar (con semilla, para que las pruebas den siempre igual);
 * - reloj de 1970 (vuelve a 0:00 cada vez que "se prende");
 * - fallas a pedido: alarma, receta cambiada, corte de conexión, PLC que no arranca y carga hecha desde Indumix.
 *
 * El tiempo NO corre solo: lo hace correr quien lo usa con `avanzar(segundos)` (la pantalla lo llama varias veces
 * por segundo; las pruebas, de a saltos). Nunca habla con la red ni con 192.168.0.10.
 */
import {
  ARIDOS, INFO_SALIDA, PlantaRechazoError, SALIDAS, SinConexionError, grupoDeSalida,
  type AdaptadorDosificadora, type EstadoBalanza, type EstadoPlanta, type Grupo, type InfoPlanta, type OrdenPlanta,
  type RecetaPlanta, type ReportePlanta, type Salida,
} from "@/lib/carga/tipos"
import { relojPlc } from "@/lib/carga/reloj"

/** Duración de un ciclo en el simulador (s): pesaje ~50 s, descarga hasta ~98 s, fin a los 108 s (1:48). */
export const DURACION_CICLO_S = 108
/** Ventanas de descarga al camión, por grupo (s dentro del ciclo) */
const DESCARGA: Record<Grupo, [number, number]> = { arido: [50, 96], cemento: [54, 90], aditivo: [58, 72], agua: [52, 98] }
/** Lo que queda pegado en cada balanza vacía */
const RESIDUO = { aridos: 31, cemento: 9, aditivo: 12 }
/** Capacidad de cada tolva / silo / tanque para el nivel (unidad de Indumix) */
const CAPACIDAD: Record<Grupo, number> = { arido: 26000, cemento: 60000, aditivo: 1_400_000, agua: 30000 }
/** Error de pesaje por grupo (fracción): chico, adentro de las tolerancias de pesaje */
const ERROR: Record<Grupo, [number, number]> = { arido: [-0.009, 0.013], cemento: [-0.003, 0.007], agua: [-0.008, 0.008], aditivo: [-0.01, 0.008] }

/** Generador con semilla (mulberry32): mismo número, mismo resultado. */
export function azar(semilla: number) {
  let s = semilla | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x))
/** Curva de pesaje: rápido hasta el 93 % y después fino */
const curva = (p: number) => (p <= 0 ? 0 : p >= 1 ? 1 : p < 0.75 ? (0.93 * p) / 0.75 : 0.93 + (0.07 * (p - 0.75)) / 0.25)
const r1 = (x: number) => Math.round(x * 10) / 10

export type Falla =
  | { tipo: "alarma"; texto?: string; codigo?: string }
  | { tipo: "alarma_fin" }
  | { tipo: "sin_conexion" }
  | { tipo: "con_conexion" }
  | { tipo: "no_arranca"; texto?: string }
  | { tipo: "carga_indumix"; receta?: number; m3?: number; camion?: string; cliente?: string; observacion?: string }

export type OpcionesSimulador = {
  recetas: RecetaPlanta[]
  m3MaxCiclo?: number
  duracionCicloS?: number
  /** H% de cada tolva que tipeó el plantista en Indumix (por defecto, Arena 3 %) */
  humedades?: Partial<Record<Salida, number>>
  /** nivel (%) de cada tolva, silo y tanque */
  niveles?: Partial<Record<Salida, number>>
  semilla?: number
  /** Error de pesaje (fracción) por salida, ciclo y carga. Por defecto, al azar y chico. */
  errorPesaje?: (salida: Salida, ciclo: number, contador: number) => number
  /** Contador de cargas de Indumix al arrancar */
  contador?: number
  /** Segundos que lleva prendida la planta (el reloj de Indumix) */
  prendidaHaceS?: number
}

type Fase = "en_ciclo" | "suspendida" | "parada" | "terminada"

type CargaSim = {
  orden: OrdenPlanta
  receta: RecetaPlanta
  contador: number
  ciclos: number
  m3c: number
  c: number
  t: number
  total: number
  fase: Fase
  valores: Partial<Record<Salida, number>>
  orden_pesaje: Partial<Record<Salida, number>>
  teo: Partial<Record<Salida, number>>
  tot: Partial<Record<Salida, number>>
  acum: Partial<Record<Salida, number>>
  tgt: Partial<Record<Salida, number>>
  real: Partial<Record<Salida, number>>
  win: Partial<Record<Salida, [number, number]>>
  hum: Partial<Record<Salida, number>>
  nivel0: Partial<Record<Salida, number>>
  inicio_plc: string
  fin_plc: string | null
  extras: { litros: number; despues_de_terminar: boolean; at_s: number }[]
  m3_cargados: number | null
}

export class SimuladorIndumix implements AdaptadorDosificadora {
  recetas: RecetaPlanta[]
  humedades: Partial<Record<Salida, number>>
  niveles: Record<Salida, number>
  m3MaxCiclo: number
  duracionCicloS: number
  contador: number
  /** segundos desde que se prendió (reloj de Indumix) */
  plcS: number
  conectado = true
  alarmas: { codigo?: string; texto: string }[] = []
  seleccion: OrdenPlanta | null = null
  carga: CargaSim | null = null
  reportes: ReportePlanta[] = []
  bocinaHastaS = -1
  noArranca: string | null = null
  private semilla: number
  private errorPesaje: OpcionesSimulador["errorPesaje"]

  constructor(o: OpcionesSimulador) {
    this.recetas = o.recetas.map((r) => JSON.parse(JSON.stringify(r)))
    this.humedades = { arido_1: 0, arido_2: 0, arido_3: 3, arido_4: 0, ...(o.humedades || {}) }
    this.niveles = { arido_1: 64, arido_2: 57, arido_3: 78, arido_4: 69, cemento_1: 62, cemento_2: 18, aditivo_1: 55, aditivo_2: 0, agua: 70, ...(o.niveles || {}) } as Record<Salida, number>
    this.m3MaxCiclo = o.m3MaxCiclo || 1.5
    this.duracionCicloS = o.duracionCicloS || DURACION_CICLO_S
    this.contador = o.contador ?? 0
    this.plcS = o.prendidaHaceS ?? 0
    this.semilla = o.semilla ?? 7
    this.errorPesaje = o.errorPesaje
  }

  // ───────────── interfaz del adaptador ─────────────

  async conectar() { this.exigirConexion() }

  async info(): Promise<InfoPlanta> {
    this.exigirConexion()
    return { marca: "Indumix (simulador)", version: "sim-1", max_recetas: 20, m3_max_ciclo: this.m3MaxCiclo, reloj_plc: relojPlc(this.plcS) }
  }

  async leerRecetas(): Promise<RecetaPlanta[]> {
    this.exigirConexion()
    return this.recetas.map((r) => JSON.parse(JSON.stringify(r)))
  }

  async leerEstado(): Promise<EstadoPlanta> {
    this.exigirConexion()
    return this.estado()
  }

  async leerReportes(): Promise<ReportePlanta[]> {
    this.exigirConexion()
    return this.reportes.map((r) => JSON.parse(JSON.stringify(r)))
  }

  async escribirOrden(o: OrdenPlanta) {
    this.exigirConexion()
    if (this.carga && (this.carga.fase === "en_ciclo" || this.carga.fase === "suspendida")) throw new PlantaRechazoError("La planta está cargando: no se puede cambiar la selección.")
    if (!this.recetas.some((r) => r.numero === o.receta)) throw new PlantaRechazoError(`La receta ${o.receta} no existe en la planta.`)
    if (!(o.m3 > 0) || o.m3 > 12) throw new PlantaRechazoError("m³ fuera de rango.")
    // Indumix corta los textos (Cliente y Camión a 20, Observación a 30)
    this.seleccion = { ...o, cliente: o.cliente.slice(0, 20), camion: o.camion.slice(0, 20), observacion: o.observacion.slice(0, 30) }
  }

  async leerOrden(): Promise<OrdenPlanta | null> {
    this.exigirConexion()
    return this.seleccion ? { ...this.seleccion } : null
  }

  async arrancar() {
    this.exigirConexion()
    this.arrancarInterno()
  }

  async parar() {
    this.exigirConexion()
    const C = this.carga
    if (!C || (C.fase !== "en_ciclo" && C.fase !== "suspendida")) return
    // Lo pesado hasta ahora queda: lo del ciclo en curso, lo que llegó a pesar
    for (const k of Object.keys(C.tot) as Salida[]) C.acum[k] = (C.acum[k] || 0) + this.valor(k, C.t)
    C.m3_cargados = r1(this.m3EnTrompo())
    C.fase = "parada"
    C.fin_plc = relojPlc(this.plcS)
    this.reportes.unshift(this.armarReporte(C))
    this.reportes = this.reportes.slice(0, 10)
  }

  async suspender() {
    this.exigirConexion()
    if (this.carga?.fase === "en_ciclo") this.carga.fase = "suspendida"
  }

  async reanudar() {
    this.exigirConexion()
    if (this.carga?.fase === "suspendida") this.carga.fase = "en_ciclo"
  }

  async bocina(ms: number) {
    this.exigirConexion()
    this.bocinaHastaS = this.plcS + Math.max(0, ms) / 1000
  }

  async extraAgua(litros: number) {
    this.exigirConexion()
    if (!(litros > 0) || litros > 500) throw new PlantaRechazoError("Litros fuera de rango.")
    const C = this.carga
    if (!C) throw new PlantaRechazoError("No hay un camión cargando ni recién cargado en la planta.")
    const despues = C.fase === "terminada" || C.fase === "parada"
    C.extras.push({ litros, despues_de_terminar: despues, at_s: this.plcS })
    // El reporte de esa carga suma el agua extra (Indumix la muestra en "Extra … Litros")
    const rep = this.reportes.find((r) => r.numero === C.contador)
    if (rep) {
      rep.extras = C.extras.map((e) => ({ ...e }))
      const lw = rep.lineas.find((l) => l.salida === "agua")
      if (lw) lw.extra = C.extras.reduce((s, e) => s + e.litros, 0)
    }
  }

  // ───────────── solo del simulador ─────────────

  /** Hace correr el tiempo. La PLC sigue aunque se corte la conexión (19.8 C); la alarma la detiene. */
  avanzar(segundos: number) {
    let resto = Math.max(0, segundos)
    while (resto > 0) {
      const paso = Math.min(resto, 1)
      resto -= paso
      this.plcS += paso
      const C = this.carga
      if (!C || C.fase !== "en_ciclo" || this.alarmas.length) continue
      C.t += paso
      C.total += paso
      if (C.t >= this.duracionCicloS) this.finCiclo()
    }
  }

  provocar(f: Falla) {
    switch (f.tipo) {
      case "alarma":
        this.alarmas = [{ codigo: f.codigo || "A07", texto: f.texto || "Tolva 3 (ARENA): sin material / falla de vibrador" }]
        break
      case "alarma_fin":
        this.alarmas = []
        break
      case "sin_conexion":
        this.conectado = false
        break
      case "con_conexion":
        this.conectado = true
        break
      case "no_arranca":
        this.noArranca = f.texto || "Compuerta de la balanza de áridos abierta"
        break
      case "carga_indumix": {
        // Alguien carga directo desde Indumix, sin una orden nuestra
        const n = f.receta ?? this.recetas.find((r) => r.salidas.some((s) => s.valor > 0))?.numero ?? 1
        this.seleccion = { receta: n, secuencia: 1, m3: f.m3 ?? 1.5, cliente: f.cliente ?? "", camion: f.camion ?? "LES 431", observacion: f.observacion ?? "" }
        this.arrancarInterno()
        break
      }
    }
  }

  /** Alguien cambia una receta en Indumix (pantalla RECETAS › GUARDAR). Solo existe en el simulador. */
  cambiarReceta(numero: number, cambios: Partial<Record<Salida, number>>, nombre?: string) {
    const r = this.recetas.find((x) => x.numero === numero)
    if (!r) return
    for (const [s, v] of Object.entries(cambios) as [Salida, number][]) {
      const fila = r.salidas.find((x) => x.salida === s)
      if (fila) fila.valor = v
      else r.salidas.push({ salida: s, nombre_planta: INFO_SALIDA[s].nombre, valor: v, unidad: INFO_SALIDA[s].unidad })
    }
    if (nombre != null) r.nombre = nombre
  }

  /** Lo que haría `leerEstado`, sin el control de conexión (para la pantalla "sin conexión"). */
  estado(): EstadoPlanta {
    const C = this.carga
    const enCurso = !!C && (C.fase === "en_ciclo" || C.fase === "suspendida")
    const t = C ? C.t : 0
    const salidas = SALIDAS.map((s) => {
      const usada = !!C && C.tot[s] != null
      const real = usada && enCurso ? this.valor(s, t) : 0
      return {
        salida: s,
        real,
        objetivo: usada ? C!.tgt[s] || 0 : 0,
        acumulado: usada ? (C!.acum[s] || 0) + (enCurso ? real : 0) : 0,
        total: usada ? C!.tot[s] || 0 : 0,
        humedad_pct: grupoDeSalida(s) === "arido" ? (C ? C.hum[s] : this.humedades[s]) ?? 0 : undefined,
        nivel_pct: this.nivel(s),
        pesando: usada && enCurso && this.pesando(s, t),
      }
    })
    const bal = (id: "aridos" | "cemento" | "aditivo", g: Grupo, unidad: string) => ({ id, unidad, ...this.balanza(id, g) })
    const aguaObj = C && C.tot.agua != null ? C.tgt.agua || 0 : 0
    return {
      en_linea: true,
      en_ciclo: enCurso,
      suspendida: C?.fase === "suspendida",
      parada: C?.fase === "parada",
      ciclo: C ? C.c : 0,
      ciclos: C ? C.ciclos : 0,
      m3_ciclo: C ? C.m3c : 0,
      tiempo_ciclo_s: enCurso ? t : 0,
      tiempo_total_s: C ? C.total : 0,
      contador_carga: this.contador,
      seleccion: this.seleccion ? { ...this.seleccion } : null,
      salidas,
      balanzas: [bal("aridos", "arido", "kg"), bal("cemento", "cemento", "kg"), bal("aditivo", "aditivo", "g")],
      agua: { real: C && enCurso && C.tot.agua != null ? this.valor("agua", t) : 0, objetivo: aguaObj, extra: C ? C.extras.reduce((s, e) => s + e.litros, 0) : 0 },
      m3_en_trompo: C ? (enCurso ? this.m3EnTrompo() : C.m3_cargados ?? C.orden.m3) : 0,
      cinta_en_marcha: !!C && C.fase === "en_ciclo" && !this.alarmas.length && t >= DESCARGA.arido[0] && t < DESCARGA.arido[1],
      bocina: this.plcS < this.bocinaHastaS,
      alarmas: this.alarmas.map((a) => ({ ...a })),
      reloj_plc: relojPlc(this.plcS),
    }
  }

  // ───────────── adentro ─────────────

  private exigirConexion() {
    if (!this.conectado) throw new SinConexionError()
  }

  private arrancarInterno() {
    if (this.alarmas.length) throw new PlantaRechazoError(`Indumix: ${this.alarmas[0].texto}`)
    if (this.carga && (this.carga.fase === "en_ciclo" || this.carga.fase === "suspendida")) throw new PlantaRechazoError("La planta ya está cargando.")
    if (!this.seleccion) throw new PlantaRechazoError("No hay una selección de carga en Indumix.")
    if (this.noArranca) {
      const t = this.noArranca
      this.noArranca = null
      throw new PlantaRechazoError(`Indumix: «${t}». La planta no arrancó.`)
    }
    const o = this.seleccion
    const receta = this.recetas.find((r) => r.numero === o.receta)
    if (!receta) throw new PlantaRechazoError(`La receta ${o.receta} no existe en la planta.`)
    const ciclos = Math.max(1, Math.ceil(o.m3 / this.m3MaxCiclo - 1e-9))
    const m3c = o.m3 / ciclos
    const valores: Partial<Record<Salida, number>> = {}
    const orden_pesaje: Partial<Record<Salida, number>> = {}
    for (const s of receta.salidas) if (s.valor > 0) { valores[s.salida] = s.valor; if (s.orden != null) orden_pesaje[s.salida] = s.orden }
    const teo: Partial<Record<Salida, number>> = {}, tot: Partial<Record<Salida, number>> = {}
    const hum = { ...this.humedades }
    let aguaAridos = 0
    for (const s of SALIDAS) {
      const v = valores[s]
      if (!(v && v > 0)) continue
      teo[s] = v * o.m3
      if (grupoDeSalida(s) === "arido") {
        tot[s] = teo[s]! * (1 + (hum[s] || 0) / 100)
        aguaAridos += tot[s]! - teo[s]!
      } else tot[s] = teo[s]
    }
    if (tot.agua != null) tot.agua = Math.max(0, teo.agua! - aguaAridos)
    this.contador++
    this.carga = {
      orden: { ...o }, receta: JSON.parse(JSON.stringify(receta)), contador: this.contador, ciclos, m3c, c: 1, t: 0, total: 0, fase: "en_ciclo",
      valores, orden_pesaje, teo, tot, acum: {}, tgt: {}, real: {}, win: {}, hum, nivel0: { ...this.niveles },
      inicio_plc: relojPlc(this.plcS), fin_plc: null, extras: [], m3_cargados: null,
    }
    this.prepararCiclo()
  }

  private prepararCiclo() {
    const C = this.carga!
    const resto = C.ciclos - C.c + 1
    const rnd = azar(this.semilla * 7919 + C.contador * 977 + C.c * 31)
    for (const k of Object.keys(C.tot) as Salida[]) {
      // Compensación: lo que falta repartido en los ciclos que quedan (el último = total − lo real de los anteriores)
      const tg = ((C.tot[k] || 0) - (C.acum[k] || 0)) / resto
      C.tgt[k] = tg
      const [lo, hi] = ERROR[grupoDeSalida(k)]
      const e = this.errorPesaje ? this.errorPesaje(k, C.c, C.contador) : lo + (hi - lo) * rnd()
      C.real[k] = Math.max(0, tg * (1 + e))
    }
    // Áridos uno atrás del otro sobre la misma balanza, en el orden de la receta; lo demás en paralelo
    const ar = ARIDOS.filter((k) => C.tot[k] != null).sort((a, b) => (C.orden_pesaje[a] ?? 9) - (C.orden_pesaje[b] ?? 9))
    const w = 42 / Math.max(1, ar.length)
    ar.forEach((k, i) => (C.win[k] = [2 + i * w, 1 + (i + 1) * w]))
    C.win.cemento_1 = [3, 36]
    C.win.cemento_2 = [3, 36]
    C.win.aditivo_1 = [5, 24]
    C.win.aditivo_2 = [5, 24]
    C.win.agua = [8, 40]
    C.nivel0 = { ...this.niveles }
  }

  private finCiclo() {
    const C = this.carga!
    for (const k of Object.keys(C.tot) as Salida[]) {
      C.acum[k] = (C.acum[k] || 0) + (C.real[k] || 0)
      this.niveles[k] = clamp((C.nivel0[k] ?? 0) - ((C.real[k] || 0) / CAPACIDAD[grupoDeSalida(k)]) * 100, 0, 100)
    }
    if (C.c < C.ciclos) {
      C.c++
      C.t = 0
      this.prepararCiclo()
      return
    }
    C.fase = "terminada"
    C.t = 0
    C.m3_cargados = C.orden.m3
    C.fin_plc = relojPlc(this.plcS)
    this.reportes.unshift(this.armarReporte(C))
    this.reportes = this.reportes.slice(0, 10)
  }

  private armarReporte(C: CargaSim): ReportePlanta {
    const lineas = SALIDAS.filter((s) => C.tot[s] != null).map((s) => ({
      salida: s,
      receta: C.valores[s] || 0,
      teorico: Math.round(C.teo[s] || 0),
      teorico_corregido: Math.round(C.tot[s] || 0),
      real: Math.round(C.acum[s] || 0),
      ...(grupoDeSalida(s) === "arido" ? { humedad_pct: C.hum[s] || 0 } : {}),
      ...(s === "agua" ? { extra: C.extras.reduce((a, e) => a + e.litros, 0) } : {}),
    }))
    const mm = Math.floor(this.duracionCicloS / 60), ss = Math.round(this.duracionCicloS % 60)
    return {
      numero: C.contador, inicio_plc: C.inicio_plc, fin_plc: C.fin_plc || relojPlc(this.plcS),
      cliente: C.orden.cliente, camion: C.orden.camion, observacion: C.orden.observacion,
      m3: C.orden.m3, receta: C.receta.numero, receta_nombre: C.receta.nombre, secuencia: C.orden.secuencia, ciclos: C.ciclos,
      tiempo_ciclo: `${mm}:${String(ss).padStart(2, "0")}`, humedades: ARIDOS.map((a) => C.hum[a] || 0),
      parada: C.fase === "parada", m3_cargados: C.m3_cargados ?? C.orden.m3, lineas, extras: C.extras.map((e) => ({ ...e })),
    }
  }

  private valor(k: Salida, t: number): number {
    const C = this.carga!
    const [a, b] = C.win[k] || [0, 1]
    return (C.real[k] || 0) * curva((t - a) / (b - a))
  }

  private pesando(k: Salida, t: number): boolean {
    const w = this.carga?.win[k]
    return !!w && t >= w[0] && t < w[1]
  }

  private fracDescarga(g: Grupo, t: number): number {
    const [a, b] = DESCARGA[g]
    return clamp((t - a) / (b - a), 0, 1)
  }

  private balanza(id: "aridos" | "cemento" | "aditivo", g: Grupo): { valor: number; estado: EstadoBalanza; max: number } {
    const C = this.carga
    const res = RESIDUO[id]
    if (!C || (C.fase !== "en_ciclo" && C.fase !== "suspendida")) return { valor: res, estado: "vacia", max: 1 }
    const ks = (Object.keys(C.tot) as Salida[]).filter((k) => grupoDeSalida(k) === g)
    if (!ks.length) return { valor: res, estado: "vacia", max: 1 }
    const total = ks.reduce((s, k) => s + (C.real[k] || 0), 0)
    const t = C.t
    if (t < DESCARGA[g][0]) {
      const v = ks.reduce((s, k) => s + this.valor(k, t), 0)
      const pes = ks.some((k) => this.pesando(k, t))
      return { valor: v, estado: pes ? "pesando" : v > total * 0.99 ? "llena" : "vacia", max: total }
    }
    const fd = this.fracDescarga(g, t)
    return { valor: total * (1 - fd) + res * fd, estado: fd < 1 ? "descargando" : "vacia", max: total }
  }

  private nivel(k: Salida): number {
    const C = this.carga
    const base = (C ? C.nivel0[k] : this.niveles[k]) ?? 0
    if (!C || C.tot[k] == null || (C.fase !== "en_ciclo" && C.fase !== "suspendida")) return this.niveles[k] ?? 0
    return clamp(base - (this.valor(k, C.t) / CAPACIDAD[grupoDeSalida(k)]) * 100, 0, 100)
  }

  private m3EnTrompo(): number {
    const C = this.carga
    if (!C) return 0
    const fd = (this.fracDescarga("arido", C.t) + this.fracDescarga("cemento", C.t) + this.fracDescarga("agua", C.t)) / 3
    return (C.c - 1) * C.m3c + C.m3c * fd
  }
}

// ───────────────────────────── Eventos (lo que el puente detecta mirando el estado) ─────────────────────────────

export type EventoPlanta =
  | { tipo: "arranque"; contador: number }
  | { tipo: "ciclo_inicio"; ciclo: number; ciclos: number }
  | { tipo: "fin"; contador: number }
  | { tipo: "parar"; contador: number }
  | { tipo: "suspender" }
  | { tipo: "reanudar" }
  | { tipo: "alarma"; texto: string }
  | { tipo: "alarma_fin"; texto: string }

/**
 * Compara dos lecturas del estado y dice qué pasó. Lo usa el puente con cualquier adaptador (simulador o Indumix):
 * una carga que arrancó sin orden nuestra se ve igual (cambia el contador).
 */
export function detectarEventos(prev: EstadoPlanta | null, next: EstadoPlanta): EventoPlanta[] {
  const out: EventoPlanta[] = []
  if (!prev) return out
  if (next.contador_carga !== prev.contador_carga && next.en_ciclo) {
    out.push({ tipo: "arranque", contador: next.contador_carga })
    out.push({ tipo: "ciclo_inicio", ciclo: next.ciclo, ciclos: next.ciclos })
  } else if (next.en_ciclo && prev.en_ciclo && next.ciclo !== prev.ciclo) out.push({ tipo: "ciclo_inicio", ciclo: next.ciclo, ciclos: next.ciclos })
  if (next.suspendida && !prev.suspendida) out.push({ tipo: "suspender" })
  if (!next.suspendida && prev.suspendida && next.en_ciclo) out.push({ tipo: "reanudar" })
  if (next.parada && (!prev.parada || next.contador_carga !== prev.contador_carga)) out.push({ tipo: "parar", contador: next.contador_carga })
  // Terminó: estaba en ciclo y ya no (sin parada). También si se perdió de vista (corte) y el contador siguió.
  if (prev.en_ciclo && !next.en_ciclo && !next.parada) out.push({ tipo: "fin", contador: prev.contador_carga })
  const antes = new Set(prev.alarmas.map((a) => a.texto)), ahora = new Set(next.alarmas.map((a) => a.texto))
  for (const t of ahora) if (!antes.has(t)) out.push({ tipo: "alarma", texto: t })
  for (const t of antes) if (!ahora.has(t)) out.push({ tipo: "alarma_fin", texto: t })
  return out
}
