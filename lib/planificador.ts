/**
 * Planificador del día de despachos (motor puro, sin base de datos).
 *
 * Idea (como Loop / Command Alkon): para que una obra no se quede sin hormigón,
 * los camiones tienen que llegar uno detrás del otro, separados por el tiempo
 * que tarda en descargar cada uno. Con el ciclo completo del camión
 * (carga + ida + descarga + lavado + vuelta) se sabe cuántos camiones hacen falta
 * para sostener ese ritmo, y se reparten los disponibles en el día respetando
 * que la planta carga un camión por vez.
 */

export type Parametros = {
  /** Minutos de carga en planta por camión (benchmark ~10) */
  cargaMin: number
  /** Minutos en obra después de descargar: lavado, remito, salida (~10) */
  lavadoMin: number
  /** Minutos de descarga de un camión de 8 m³ según el método */
  descargaBombaMin: number
  descargaDirectaMin: number
  /** Jornada de la planta */
  inicioJornada: string // "07:00"
  finJornada: string // "18:00"
  /** Tolerancia para considerar que un camión llegó "a tiempo" */
  toleranciaMin: number
}

export const PARAMETROS_BASE: Parametros = {
  cargaMin: 10,
  lavadoMin: 10,
  descargaBombaMin: 15,
  descargaDirectaMin: 25,
  inicioJornada: "07:00",
  finJornada: "18:00",
  toleranciaMin: 10,
}

export type Pedido = {
  id: string
  cliente: string
  obra: string
  m3: number
  /** Hora pactada de llegada del primer camión, en minutos desde las 00:00 */
  llegada: number
  /** Minutos de viaje planta → obra */
  viajeMin: number
  conBomba: boolean
  /** Minutos de descarga por camión de 8 m³ si la obra tiene un valor propio (reemplaza al benchmark) */
  descargaMin?: number | null
}

export type Camion = { id: string; patente: string; capacidad: number }

export type Viaje = {
  pedidoId: string
  camionId: string
  n: number // número de viaje dentro del pedido (1..)
  m3: number
  inicioCarga: number
  salida: number
  llegada: number
  finDescarga: number
  salidaObra: number
  vuelta: number // llega a planta
  /** Minutos que la obra estuvo esperando este camión (hueco en el vaciado) */
  esperaObra: number
}

export type ResumenPedido = {
  pedidoId: string
  viajes: number
  camionesIdeal: number
  camionesUsados: number
  cicloMin: number
  ritmoIdealMin: number
  llegadaPedida: number
  primeraLlegada: number
  finVaciado: number
  demoraInicio: number
  huecosMin: number
  m3Hora: number
}

export type Plan = {
  viajes: Viaje[]
  pedidos: ResumenPedido[]
  camiones: { id: string; patente: string; viajes: number; m3: number; ocupadoMin: number; utilizacion: number; primeraSalida: number | null; ultimaVuelta: number | null }[]
  plantaOcupacion: number
  jornadaMin: number
  /** Primera carga del día (puede ser antes del inicio de la jornada) */
  primeraCarga: number | null
}

export const aMin = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + (m || 0) }
export const aHora = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(Math.round(min % 60)).padStart(2, "0")}`

/** Minutos de descarga de un viaje, proporcional a los m³ que lleva. */
function descargaDe(p: Pedido, m3: number, prm: Parametros) {
  const base8 = p.descargaMin ?? (p.conBomba ? prm.descargaBombaMin : prm.descargaDirectaMin)
  return Math.max(5, Math.round((base8 * m3) / 8))
}

export function planificar(pedidos: Pedido[], camiones: Camion[], prm: Parametros = PARAMETROS_BASE): Plan {
  const inicio = aMin(prm.inicioJornada)
  const fin = aMin(prm.finJornada)
  // Cuándo queda libre cada camión en planta, y la boca de carga
  const libre = new Map(camiones.map((c) => [c.id, -Infinity]))
  const cargas: { desde: number; hasta: number }[] = []
  const bocaLibreDesde = (t: number) => {
    let x = t
    for (const c of [...cargas].sort((a, b) => a.desde - b.desde)) if (x < c.hasta && x + prm.cargaMin > c.desde) x = c.hasta
    return x
  }
  const viajes: Viaje[] = []
  const resumen: ResumenPedido[] = []
  const capMax = Math.max(...camiones.map((c) => c.capacidad), 8)

  for (const p of [...pedidos].sort((a, b) => a.llegada - b.llegada)) {
    // Viajes del pedido: camiones llenos y el último con el resto
    const cant: number[] = []
    let resto = p.m3
    while (resto > 0.01) { const q = Math.min(8, resto); cant.push(Math.round(q * 100) / 100); resto -= q }
    const ritmo = descargaDe(p, 8, prm)
    const ciclo = prm.cargaMin + p.viajeMin + ritmo + prm.lavadoMin + p.viajeMin
    const ideal = Math.min(cant.length, Math.ceil(ciclo / ritmo))

    let proximaLlegada = p.llegada
    let finAnterior: number | null = null
    let huecos = 0
    const usados = new Set<string>()
    cant.forEach((m3, i) => {
      const desc = descargaDe(p, m3, prm)
      const cargaObjetivo = proximaLlegada - p.viajeMin - prm.cargaMin
      // Camión que queda libre antes (o el primero que se libere)
      const candidatos = camiones
        .filter((c) => c.capacidad >= m3 - 0.01 || c.capacidad === capMax)
        .map((c) => ({ c, t: Math.max(libre.get(c.id)!, cargaObjetivo) }))
        .sort((a, b) => a.t - b.t || (libre.get(b.c.id)! - libre.get(a.c.id)!))
      const elegido = candidatos[0]
      // Puede cargar antes del inicio de la jornada si la obra lo pide (se avisa aparte)
      let inicioCarga = bocaLibreDesde(elegido.t)
      const salida = inicioCarga + prm.cargaMin
      const llegada = Math.max(salida + p.viajeMin, proximaLlegada)
      const inicioDescarga = finAnterior != null ? Math.max(llegada, finAnterior) : llegada
      const espera = finAnterior != null ? Math.max(0, llegada - finAnterior) : 0
      huecos += espera
      const finDescarga = inicioDescarga + desc
      const salidaObra = finDescarga + prm.lavadoMin
      const vuelta = salidaObra + p.viajeMin
      cargas.push({ desde: inicioCarga, hasta: salida })
      libre.set(elegido.c.id, vuelta)
      usados.add(elegido.c.id)
      viajes.push({ pedidoId: p.id, camionId: elegido.c.id, n: i + 1, m3, inicioCarga, salida, llegada: inicioDescarga, finDescarga, salidaObra, vuelta, esperaObra: espera })
      finAnterior = finDescarga
      proximaLlegada = finDescarga // el siguiente debería llegar cuando termina este
    })

    const vs = viajes.filter((v) => v.pedidoId === p.id)
    const dur = (vs[vs.length - 1].finDescarga - vs[0].llegada) / 60
    resumen.push({
      pedidoId: p.id,
      viajes: cant.length,
      camionesIdeal: ideal,
      camionesUsados: usados.size,
      cicloMin: ciclo,
      ritmoIdealMin: ritmo,
      llegadaPedida: p.llegada,
      primeraLlegada: vs[0].llegada,
      finVaciado: vs[vs.length - 1].finDescarga,
      demoraInicio: Math.max(0, vs[0].llegada - p.llegada),
      huecosMin: huecos,
      m3Hora: dur > 0 ? Math.round((p.m3 / dur) * 10) / 10 : p.m3,
    })
  }

  const jornada = fin - inicio
  return {
    viajes,
    pedidos: resumen,
    camiones: camiones.map((c) => {
      const vs = viajes.filter((v) => v.camionId === c.id)
      const ocupado = vs.reduce((s, v) => s + (v.vuelta - v.inicioCarga), 0)
      return {
        id: c.id, patente: c.patente, viajes: vs.length, m3: vs.reduce((s, v) => s + v.m3, 0), ocupadoMin: ocupado,
        utilizacion: Math.round((ocupado / jornada) * 100),
        primeraSalida: vs.length ? Math.min(...vs.map((v) => v.salida)) : null,
        ultimaVuelta: vs.length ? Math.max(...vs.map((v) => v.vuelta)) : null,
      }
    }),
    plantaOcupacion: Math.round((cargas.reduce((s, c) => s + (c.hasta - c.desde), 0) / jornada) * 100),
    jornadaMin: jornada,
    primeraCarga: cargas.length ? Math.min(...cargas.map((c) => c.desde)) : null,
  }
}
