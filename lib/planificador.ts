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
  /** Camiones que la planta puede cargar a la vez */
  bocasCarga: number
  /**
   * Minutos que el camión, después de volver a planta, tarda en poder cargar otra vez (esperar, lavar, papeles),
   * además de la carga. No ocupa la boca. Sale del tiempo en planta real del GPS (tiempo en planta − carga);
   * no se guarda en la planta. Sin valor = 0 (como antes).
   */
  esperaPlantaMin?: number
}

export const PARAMETROS_BASE: Parametros = {
  cargaMin: 10,
  lavadoMin: 10,
  descargaBombaMin: 15,
  descargaDirectaMin: 25,
  inicioJornada: "07:00",
  finJornada: "18:00",
  toleranciaMin: 15, // estándar Loop
  bocasCarga: 1,
}

/**
 * Parámetros de una planta, guardados en la tabla plants (fase 1). Si falta una columna
 * (migración sin aplicar) se usa el valor de referencia.
 */
export function parametrosDePlanta(planta: Record<string, any> | null | undefined): Parametros {
  const num = (v: any, def: number) => (v == null || Number.isNaN(Number(v)) ? def : Number(v))
  const hora = (v: any, def: string) => (typeof v === "string" && /^\d{2}:\d{2}/.test(v) ? v.slice(0, 5) : def)
  const b = PARAMETROS_BASE
  if (!planta) return b
  return {
    cargaMin: num(planta.t_carga_min, b.cargaMin),
    lavadoMin: num(planta.t_lavado_min, b.lavadoMin),
    descargaBombaMin: num(planta.t_descarga_bomba_min, b.descargaBombaMin),
    descargaDirectaMin: num(planta.t_descarga_directa_min, b.descargaDirectaMin),
    inicioJornada: hora(planta.jornada_inicio, b.inicioJornada),
    finJornada: hora(planta.jornada_fin, b.finJornada),
    toleranciaMin: num(planta.tolerancia_puntualidad_min, b.toleranciaMin),
    bocasCarga: Math.max(1, num(planta.bocas_carga, b.bocasCarga)),
  }
}

/** Columnas de plants para guardar los parámetros. */
export function columnasDePlanta(prm: Parametros) {
  return {
    t_carga_min: prm.cargaMin,
    t_lavado_min: prm.lavadoMin,
    t_descarga_bomba_min: prm.descargaBombaMin,
    t_descarga_directa_min: prm.descargaDirectaMin,
    jornada_inicio: prm.inicioJornada,
    jornada_fin: prm.finJornada,
    tolerancia_puntualidad_min: prm.toleranciaMin,
    bocas_carga: prm.bocasCarga,
  }
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
  /** Fase 2: m³ por camión (por defecto 8; el último lleva el resto) */
  m3PorViaje?: number | null
  /** Fase 2: minutos entre llegadas si el cliente pide otro ritmo (por defecto, la descarga del camión anterior) */
  espaciadoMin?: number | null
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

/** Un camión ocupado en otro viaje que no entra en este plan (otra planta, ya despachado), en minutos del día. */
export type Ocupado = { camionId: string; desde: number; hasta: number }

/**
 * Asignación de camiones (fase 2b, "pocos camiones bien usados"): para cada viaje se elige primero un camión ya
 * usado en el día que llegue a tiempo (el que se liberó más tarde, para no dejar huecos); solo si ninguno llega
 * se suma uno nuevo; si no quedan nuevos, el que pueda cargar antes. Un camión nunca queda en dos viajes que se
 * pisan: ni en este plan ni con sus viajes de `ocupados`.
 */
export function planificar(pedidos: Pedido[], camiones: Camion[], prm: Parametros = PARAMETROS_BASE, ocupados: Ocupado[] = []): Plan {
  const inicio = aMin(prm.inicioJornada)
  const fin = aMin(prm.finJornada)
  // Tiempo en planta después de volver, antes de poder cargar otra vez (0 = como antes)
  const esperaPlanta = Math.max(0, Number(prm.esperaPlantaMin) || 0)
  // Cuándo queda libre cada camión en planta, y la boca de carga
  const libre = new Map(camiones.map((c) => [c.id, -Infinity]))
  const cargas: { desde: number; hasta: number }[] = []
  const bocas = Math.max(1, Math.floor(prm.bocasCarga || 1))
  const bocaLibreDesde = (t: number) => {
    if (bocas === 1) {
      // Una sola boca: igual que siempre
      let x = t
      for (const c of [...cargas].sort((a, b) => a.desde - b.desde)) if (x < c.hasta && x + prm.cargaMin > c.desde) x = c.hasta
      return x
    }
    // Varias bocas: el primer momento (t o el fin de alguna carga) con menos cargas superpuestas que bocas
    const candidatos = [t, ...cargas.map((c) => c.hasta).filter((h) => h > t)].sort((a, b) => a - b)
    for (const x of candidatos) {
      const ocupadas = cargas.filter((c) => x < c.hasta && x + prm.cargaMin > c.desde).length
      if (ocupadas < bocas) return x
    }
    return candidatos[candidatos.length - 1]
  }
  // Ventanas en que cada camión está en otro viaje (fuera de este plan)
  const ocup = new Map<string, { desde: number; hasta: number }[]>()
  for (const o of ocupados) (ocup.get(o.camionId) || ocup.set(o.camionId, []).get(o.camionId)!).push({ desde: o.desde, hasta: o.hasta + esperaPlanta })
  /** Primer momento ≥ t en que el camión puede cargar sin pisar sus otros viajes (fin(x) = cuándo volvería) */
  const primerHueco = (id: string, t: number, fin: (x: number) => number) => {
    let x = t
    for (let k = 0; k < 50; k++) {
      const w = (ocup.get(id) || []).find((o) => x < o.hasta && fin(x) > o.desde)
      if (!w) return x
      x = w.hasta
    }
    return x
  }
  /** Último uso del camión antes de t (en este plan o en otros viajes); -Infinity si todavía no se usó */
  const ultimoUso = (id: string, t: number) => Math.max(libre.get(id)!, ...(ocup.get(id) || []).filter((o) => o.hasta <= t).map((o) => o.hasta))
  const viajes: Viaje[] = []
  const resumen: ResumenPedido[] = []
  const capMax = Math.max(...camiones.map((c) => c.capacidad), 8)

  for (const p of [...pedidos].sort((a, b) => a.llegada - b.llegada)) {
    // Viajes del pedido: camiones llenos y el último con el resto
    const cant: number[] = []
    let resto = p.m3
    const tam = p.m3PorViaje && p.m3PorViaje > 0 ? p.m3PorViaje : 8
    while (resto > 0.01) { const q = Math.min(tam, resto); cant.push(Math.round(q * 100) / 100); resto -= q }
    // Ritmo y ciclo con un camión lleno del pedido (8 m³ salvo que el pedido diga otra cosa)
    const descargaLleno = descargaDe(p, tam, prm)
    const espaciado = p.espaciadoMin && p.espaciadoMin > 0 ? p.espaciadoMin : null
    const ritmo = espaciado ?? descargaLleno
    const ciclo = prm.cargaMin + esperaPlanta + p.viajeMin + descargaLleno + prm.lavadoMin + p.viajeMin
    const ideal = Math.min(cant.length, Math.ceil(ciclo / ritmo))

    let proximaLlegada = p.llegada
    let finAnterior: number | null = null
    let huecos = 0
    const usados = new Set<string>()
    cant.forEach((m3, i) => {
      const desc = descargaDe(p, m3, prm)
      const cargaObjetivo = proximaLlegada - p.viajeMin - prm.cargaMin
      // Cuándo volvería a planta si carga en x (con la espera en obra si el anterior todavía descarga)
      const vueltaSi = (x: number) => {
        const lleg = Math.max(x + prm.cargaMin + p.viajeMin, proximaLlegada)
        const ini = finAnterior != null ? Math.max(lleg, finAnterior) : lleg
        return ini + desc + prm.lavadoMin + p.viajeMin + esperaPlanta
      }
      // Cada camión: cuándo podría cargar. Primero los que llegan a tiempo; entre ellos, el ya usado que se liberó
      // más tarde (ahorra camiones); un camión nuevo solo si ninguno usado llega.
      const candidatos = camiones
        .filter((c) => c.capacidad >= m3 - 0.01 || c.capacidad === capMax)
        .map((c) => { const t = primerHueco(c.id, Math.max(libre.get(c.id)!, cargaObjetivo), vueltaSi); return { c, t, uso: ultimoUso(c.id, t) } })
        .sort((a, b) => a.t - b.t || b.uso - a.uso)
      const elegido = candidatos[0]
      // Puede cargar antes del inicio de la jornada si la obra lo pide (se avisa aparte). La boca puede correr la
      // carga: se vuelve a controlar que el camión siga libre.
      let inicioCarga = bocaLibreDesde(elegido.t)
      for (let k = 0; k < 20; k++) {
        const x = primerHueco(elegido.c.id, inicioCarga, vueltaSi)
        if (x === inicioCarga) break
        inicioCarga = bocaLibreDesde(x)
      }
      const salida = inicioCarga + prm.cargaMin
      const llegada = Math.max(salida + p.viajeMin, proximaLlegada)
      const inicioDescarga = finAnterior != null ? Math.max(llegada, finAnterior) : llegada
      // Hueco en el vaciado: lo que el camión llega después de lo previsto (sin espaciado, lo previsto es el fin del anterior)
      const espera = finAnterior != null ? Math.max(0, llegada - proximaLlegada) : 0
      huecos += espera
      const finDescarga = inicioDescarga + desc
      const salidaObra = finDescarga + prm.lavadoMin
      const vuelta = salidaObra + p.viajeMin
      cargas.push({ desde: inicioCarga, hasta: salida })
      libre.set(elegido.c.id, vuelta + esperaPlanta)
      usados.add(elegido.c.id)
      viajes.push({ pedidoId: p.id, camionId: elegido.c.id, n: i + 1, m3, inicioCarga, salida, llegada: inicioDescarga, finDescarga, salidaObra, vuelta, esperaObra: espera })
      finAnterior = finDescarga
      // El siguiente debería llegar cuando termina este (o con el espaciado que pidió el cliente)
      proximaLlegada = espaciado != null ? inicioDescarga + espaciado : finDescarga
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
    plantaOcupacion: Math.round((cargas.reduce((s, c) => s + (c.hasta - c.desde), 0) / (jornada * bocas)) * 100),
    jornadaMin: jornada,
    primeraCarga: cargas.length ? Math.min(...cargas.map((c) => c.desde)) : null,
  }
}
