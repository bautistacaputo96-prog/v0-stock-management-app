/**
 * Indicadores de logística (Fase 4a): única definición de cada KPI — nombre, explicación, cómo se calcula,
 * referencia de Loop, bandas (bueno / normal / a mejorar) y el cálculo. La usan las tarjetas y el detalle de
 * Logística › Tiempos reales y la van a usar los tableros que vengan.
 *
 * Sin imports en tiempo de ejecución (para probar con `node --test`).
 * Referencias de Loop: docs/migracion-loop/informe-loop.md, sección 7.
 */

// ---------------------------------------------------------------------------
// Datos de entrada
// ---------------------------------------------------------------------------
/** Un viaje medido, con los datos de su remito. */
export type ViajeKpi = {
  /** Clave del viaje (mixer + salida) para ir a su fila en la vista del día. */
  key: string
  fecha: string
  mixer_id: string
  camion: string
  chofer: string | null
  obra_id: string | null
  obra: string | null
  cliente_id: string | null
  cliente: string | null
  remito: string | null
  dispatch_id: string | null
  m3: number | null
  confianza: "alta" | "media" | "baja" | null
  estado: "completo" | "incompleto"
  min_en_planta: number | null
  min_motor_parado_planta: number | null
  min_ida: number | null
  min_obra: number | null
  min_vuelta: number | null
  ciclo_min: number | null
  km_ida: number | null
  km_vuelta: number | null
  /** Minutos en paradas fuera de obra (suma) y cantidad. */
  min_paradas_extra: number
  paradas_extra: number
}

/** Un pedido con la llegada de su primer camión (para la puntualidad). */
export type PedidoKpi = {
  key: string
  fecha: string
  /** Primer camión del pedido (por remito). */
  mixer_id: string | null
  camion: string | null
  chofer: string | null
  obra_id: string | null
  obra: string | null
  cliente_id: string | null
  cliente: string | null
  remito: string | null
  /** Clave del viaje del primer camión, si se midió. */
  viaje_key: string | null
  /** Minutos de diferencia contra la hora pedida (positivo = tarde). Nulo = sin dato. */
  dif: number | null
  tolerancia: number
}

export type DatosKpi = { viajes: ViajeKpi[]; pedidos: PedidoKpi[] }

/** Lo que se lista en "los viajes detrás del número". */
export type ItemKpi = {
  key: string
  /** Clave del viaje para ir a la vista del día (nula si no hay viaje medido). */
  viaje_key: string | null
  fecha: string
  camion: string | null
  remito: string | null
  obra: string | null
  cliente: string | null
  chofer: string | null
  valor: number
}

export type Desglose = "camion" | "obra" | "cliente" | "chofer"
export type Banda = "bueno" | "normal" | "a_mejorar"

export type KpiDef = {
  id: string
  titulo: string
  unidad: string
  /** Encabezado de la columna de valor en "los viajes detrás del número". */
  columnaItem: string
  /** Una línea, debajo del número. */
  corta: string
  /** Para el dueño, 2–3 oraciones. */
  queMide: string
  /** Eventos del GPS, desde → hasta, qué se excluye. */
  comoSeCalcula: string
  /** Referencia de Loop en palabras (se muestra en gris). */
  referencia: string
  /** Valor de referencia para la línea del gráfico. */
  valorReferencia: number | null
  /** "menor" = menos es mejor (ciclo, obra…); "mayor" = más es mejor (m³, puntualidad…). */
  direccion: "menor" | "mayor"
  /** Bandas: bueno hasta (o desde) `bueno`, normal hasta (o desde) `normal`, después a mejorar. Nulo = sin referencia. */
  bandas: { bueno: number; normal: number; nota?: string } | null
  /** Orden de "los viajes detrás del número", peor primero: "desc" = el valor más alto primero. */
  peorItem: "desc" | "asc"
  decimales: number
  desgloses: Desglose[]
  /** Valor del período (o de un subconjunto: un día, un camión, una obra). */
  calcular: (d: DatosKpi) => number | null
  /** Los viajes (o pedidos) que forman el número, con su valor individual. */
  items: (d: DatosKpi) => ItemKpi[]
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
const num = (x: number | null | undefined): x is number => x != null && Number.isFinite(Number(x))
export function promedio(xs: (number | null | undefined)[]): number | null {
  const v = xs.filter(num).map(Number)
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}
const suma = (xs: (number | null | undefined)[]) => xs.filter(num).reduce((a, b) => a + Number(b), 0)

/** Horas de jornada por camión para el uso de la flota (07 a 18 h). */
export const JORNADA_HORAS = 11
/** Una estadía en planta más larga que esto no es "tiempo antes de salir" (camión guardado). */
const PLANTA_MAX_MIN = 180

// Filtros de viajes (los mismos para todos los indicadores)
/** Viaje de entrega: tiene remito (un traslado sin remito no cuenta). */
export const deEntrega = (v: ViajeKpi) => !!v.dispatch_id
/** Viaje de entrega completo (volvió a planta, sin cortes de señal) y con cruce confiable (no dudoso). */
export const confiable = (v: ViajeKpi) => deEntrega(v) && v.estado === "completo" && v.confianza !== "baja"
const enPlantaValido = (v: ViajeKpi) => num(v.min_en_planta) && Number(v.min_en_planta) <= PLANTA_MAX_MIN
const cicloConPlanta = (v: ViajeKpi) => (num(v.ciclo_min) && enPlantaValido(v) ? Number(v.ciclo_min) + Number(v.min_en_planta) : null)

const item = (v: ViajeKpi, valor: number): ItemKpi => ({
  key: v.key,
  viaje_key: v.key,
  fecha: v.fecha,
  camion: v.camion,
  remito: v.remito,
  obra: v.obra,
  cliente: v.cliente,
  chofer: v.chofer,
  valor,
})

/** KPI = promedio de un valor por viaje, sobre los viajes que pasan el filtro. */
function porViaje(valor: (v: ViajeKpi) => number | null, filtro: (v: ViajeKpi) => boolean) {
  return {
    calcular: (d: DatosKpi) => promedio(d.viajes.filter(filtro).map(valor)),
    items: (d: DatosKpi) =>
      d.viajes.filter(filtro).flatMap((v) => {
        const x = valor(v)
        return num(x) ? [item(v, Number(x))] : []
      }),
  }
}

/** Días con trabajo de cada camión (o chofer) en los datos: la base de "por camión por día". */
function diasDe(viajes: ViajeKpi[], clave: (v: ViajeKpi) => string | null): number {
  const s = new Set<string>()
  for (const v of viajes) {
    const k = clave(v)
    if (k) s.add(`${k}|${v.fecha}`)
  }
  return s.size
}

// ---------------------------------------------------------------------------
// Definiciones
// ---------------------------------------------------------------------------
export const KPIS: KpiDef[] = [
  {
    id: "ciclo_planta",
    columnaItem: "Ciclo con planta (min)",
    titulo: "Ciclo con planta",
    unidad: "min",
    corta: "Desde que el camión llega a planta a cargar hasta que vuelve de la obra",
    queMide:
      "Cuánto tarda una vuelta completa de un camión: espera y carga en planta, viaje a la obra, descarga y vuelta. Es el número que mejor resume la productividad de la flota: cuanto más corto, más viajes puede hacer cada camión por día.",
    comoSeCalcula:
      "Por viaje: minutos en planta antes de salir (desde que llegó, o desde que arrancó el motor si pasó la noche) + minutos desde que sale de la geocerca de la planta hasta que vuelve a entrar. Promedio de los viajes de entrega completos. No cuenta viajes sin remito (traslados), incompletos (sin señal o que no volvieron) ni con cruce dudoso, ni estadías en planta de más de 3 h.",
    referencia: "Loop: benchmark 151 min, Top 5: 150. Rango normal de la industria: 30 a 180 min.",
    valorReferencia: 150,
    direccion: "menor",
    peorItem: "desc",
    bandas: { bueno: 150, normal: 180 },
    decimales: 0,
    desgloses: ["camion", "obra", "cliente", "chofer"],
    ...porViaje(cicloConPlanta, confiable),
  },
  {
    id: "ciclo_calle",
    columnaItem: "Ciclo en la calle (min)",
    titulo: "Ciclo en la calle",
    unidad: "min",
    corta: "Desde que sale de planta hasta que vuelve",
    queMide:
      "El tiempo que el camión pasa afuera en cada entrega: ida, obra y vuelta. A diferencia del ciclo con planta, no incluye la espera ni la carga.",
    comoSeCalcula:
      "Por viaje: desde el primer mensaje del GPS fuera de la geocerca de planta (250 m) hasta el primero de vuelta adentro (en cualquiera de las dos plantas). Promedio de los viajes de entrega completos y con cruce confiable; no cuenta traslados, viajes incompletos ni dudosos.",
    referencia: "Loop no lo da aparte: ruta ~63 (ida + vuelta) + obra ~71 ≈ 134 min.",
    valorReferencia: 134,
    direccion: "menor",
    peorItem: "desc",
    bandas: { bueno: 134, normal: 160 },
    decimales: 0,
    desgloses: ["camion", "obra", "cliente", "chofer"],
    ...porViaje((v) => v.ciclo_min, confiable),
  },
  {
    id: "obra",
    columnaItem: "En obra (min)",
    titulo: "Tiempo en obra",
    unidad: "min",
    corta: "Desde que llega a la obra hasta que se va",
    queMide:
      "Cuánto tiempo retiene la obra a cada camión: espera, descarga, lavado. Es el tramo que más depende del cliente; si es largo, conviene hablarlo o cobrar la espera.",
    comoSeCalcula:
      "Por viaje: la parada más larga fuera de planta (el camión queda dentro de un círculo de 200 m al menos 5 min; si la obra está ubicada, la parada en la obra). Llegada = primer mensaje en ese lugar; salida = último. Promedio de los viajes de entrega completos y con cruce confiable.",
    referencia: "Loop: benchmark 71 min, Top 5: 69. Alerta habitual: más de 90 min.",
    valorReferencia: 70,
    direccion: "menor",
    peorItem: "desc",
    bandas: { bueno: 70, normal: 90 },
    decimales: 0,
    desgloses: ["obra", "cliente", "camion", "chofer"],
    ...porViaje((v) => v.min_obra, confiable),
  },
  {
    id: "ida",
    columnaItem: "Ida (min)",
    titulo: "Ida",
    unidad: "min",
    corta: "Desde que sale de planta hasta que llega a la obra",
    queMide:
      "Cuánto tarda el camión cargado en llegar a la obra. Depende sobre todo de la distancia; sirve para ver qué obras están lejos y para programar la hora de salida.",
    comoSeCalcula:
      "Por viaje: desde que sale de la geocerca de planta hasta el inicio de la parada en obra. Promedio de los viajes de entrega completos y con cruce confiable.",
    referencia: "Loop: ruta (ida + vuelta) benchmark 63 min, Top 5: 59 → ~30 min de ida. Depende de la distancia.",
    valorReferencia: 30,
    direccion: "menor",
    peorItem: "desc",
    bandas: { bueno: 30, normal: 45, nota: "Depende de lo lejos que esté la obra: comparar mejor por obra." },
    decimales: 0,
    desgloses: ["obra", "cliente", "camion", "chofer"],
    ...porViaje((v) => v.min_ida, confiable),
  },
  {
    id: "vuelta",
    columnaItem: "Vuelta (min)",
    titulo: "Vuelta",
    unidad: "min",
    corta: "Desde que sale de la obra hasta que entra a planta",
    queMide:
      "Cuánto tarda el camión vacío en volver. Si es mucho más larga que la ida, el camión pasó por otro lado (paradas, cargar combustible, otra planta).",
    comoSeCalcula:
      "Por viaje: desde el fin de la parada en obra hasta el primer mensaje dentro de una geocerca de planta. Promedio de los viajes de entrega completos y con cruce confiable.",
    referencia: "Loop: ruta (ida + vuelta) benchmark 63 min → ~30 min de vuelta. Depende de la distancia.",
    valorReferencia: 30,
    direccion: "menor",
    peorItem: "desc",
    bandas: { bueno: 30, normal: 45, nota: "Depende de lo lejos que esté la obra: comparar con la ida." },
    decimales: 0,
    desgloses: ["obra", "cliente", "camion", "chofer"],
    ...porViaje((v) => v.min_vuelta, confiable),
  },
  {
    id: "planta",
    columnaItem: "En planta (min)",
    titulo: "Tiempo en planta",
    unidad: "min",
    corta: "Desde que llega a planta hasta que sale cargado",
    queMide:
      "Cuánto está el camión en planta antes de cada viaje: espera, carga, ajuste y papeles. Es lo que Loop llama tiempo de carga. Si es alto, hay cola en la boca de carga o camiones esperando pedidos.",
    comoSeCalcula:
      "Por viaje: desde que el camión entra a la geocerca de planta (o desde que arranca el motor, si pasó la noche ahí) hasta que sale. Promedio de los viajes de entrega; no cuenta estadías de más de 3 h (camión guardado) ni traslados sin remito.",
    referencia: "Loop: normal 10 a 25 min, meta menos de 20. Benchmark 32, Top 5: 24.",
    valorReferencia: 25,
    direccion: "menor",
    peorItem: "desc",
    bandas: { bueno: 25, normal: 32 },
    decimales: 0,
    desgloses: ["camion", "chofer"],
    ...porViaje((v) => (enPlantaValido(v) ? v.min_en_planta : null), deEntrega),
  },
  {
    id: "ralenti",
    columnaItem: "Motor parado (min)",
    titulo: "Motor encendido parado en planta",
    unidad: "min/viaje",
    corta: "Minutos con el motor prendido y el camión quieto en planta, por viaje",
    queMide:
      "El ralentí: motor en marcha sin moverse mientras espera, carga o lava en planta. Gasta gasoil y motor sin producir: 10 minutos son más o menos 1 litro de gasoil (y otro tanto en mantenimiento).",
    comoSeCalcula:
      "Por viaje: dentro del tiempo en planta, suma de los intervalos con ignición encendida (eng_ign_stat del GPS) y velocidad menor a 3 km/h (cada intervalo cuenta hasta 5 min). Promedio de los viajes de entrega.",
    referencia: "Loop: buena práctica ~35 min por viaje; al empezar a medir lo típico es ~60. Benchmark 46,5, Top 5: 37,5.",
    valorReferencia: 35,
    direccion: "menor",
    peorItem: "desc",
    bandas: { bueno: 35, normal: 60 },
    decimales: 0,
    desgloses: ["camion", "chofer"],
    ...porViaje((v) => v.min_motor_parado_planta, deEntrega),
  },
  {
    id: "m3_camion",
    columnaItem: "m³",
    titulo: "m³ por camión",
    unidad: "m³/día",
    corta: "Metros cúbicos que entrega cada camión en un día de trabajo",
    queMide:
      "La producción de cada camión. Junto con los viajes por camión dice si la flota está bien aprovechada o si sobran o faltan camiones.",
    comoSeCalcula:
      "m³ de los remitos que tienen viaje medido ÷ días-camión con al menos un viaje de entrega (un camión que trabajó 3 días cuenta 3). Los días sin viajes no cuentan.",
    referencia: "Loop: ejemplo 22,5 m³ por vehículo por día; clientes de 230 a 600 m³ por camión por mes.",
    valorReferencia: 22.5,
    direccion: "mayor",
    peorItem: "asc",
    bandas: { bueno: 22.5, normal: 15 },
    decimales: 1,
    desgloses: ["camion"],
    calcular: (d) => {
      const vs = d.viajes.filter(deEntrega)
      const dias = diasDe(vs, (v) => v.mixer_id)
      return dias ? suma(vs.map((v) => v.m3)) / dias : null
    },
    items: (d) => d.viajes.filter(deEntrega).map((v) => item(v, Number(v.m3) || 0)),
  },
  {
    id: "viajes_camion",
    columnaItem: "m³",
    titulo: "Viajes por camión",
    unidad: "viajes/día",
    corta: "Entregas que hace cada camión en un día de trabajo",
    queMide: "Cuántas vueltas da cada camión por día. Si el ciclo baja, este número sube.",
    comoSeCalcula: "Viajes de entrega (con remito) ÷ días-camión con al menos un viaje de entrega. Los traslados sin remito no cuentan.",
    referencia: "Loop: ejemplo 3,5 entregas por vehículo por día.",
    valorReferencia: 3.5,
    direccion: "mayor",
    peorItem: "asc",
    bandas: { bueno: 3.5, normal: 2.5 },
    decimales: 1,
    desgloses: ["camion"],
    calcular: (d) => {
      const vs = d.viajes.filter(deEntrega)
      const dias = diasDe(vs, (v) => v.mixer_id)
      return dias ? vs.length / dias : null
    },
    items: (d) => d.viajes.filter(deEntrega).map((v) => item(v, Number(v.m3) || 0)),
  },
  {
    id: "uso_flota",
    columnaItem: "En la calle (min)",
    titulo: "Uso de la flota",
    unidad: "%",
    corta: "Parte de la jornada que los camiones pasan en viaje",
    queMide:
      "Qué porcentaje de la jornada (7 a 18 h) los camiones están afuera entregando. Bajo = camiones parados esperando pedidos o en planta; muy alto = flota justa, sin margen.",
    comoSeCalcula:
      "Suma de los ciclos en la calle de los viajes de entrega completos ÷ (días-camión con viajes × 11 h). No cuenta el tiempo en planta ni los traslados.",
    referencia: "Loop no publica un número para esto.",
    valorReferencia: null,
    direccion: "mayor",
    peorItem: "asc",
    bandas: null,
    decimales: 0,
    desgloses: ["camion"],
    calcular: (d) => {
      const vs = d.viajes.filter(deEntrega)
      const dias = diasDe(vs, (v) => v.mixer_id)
      if (!dias) return null
      const horas = suma(vs.filter((v) => v.estado === "completo").map((v) => v.ciclo_min)) / 60
      return (horas / (dias * JORNADA_HORAS)) * 100
    },
    items: (d) =>
      d.viajes.filter((v) => deEntrega(v) && v.estado === "completo" && num(v.ciclo_min)).map((v) => item(v, Number(v.ciclo_min))),
  },
  {
    id: "min_m3",
    columnaItem: "min/m³",
    titulo: "Minutos por m³",
    unidad: "min/m³",
    corta: "Minutos de camión que cuesta entregar cada metro cúbico",
    queMide:
      "La eficiencia de la flota en una sola cifra: cuánto tiempo de camión lleva cada m³ entregado. Baja si los camiones van llenos y el ciclo es corto.",
    comoSeCalcula:
      "Suma de los ciclos con planta (planta + calle) ÷ suma de los m³ de esos mismos viajes. Solo viajes de entrega completos y con cruce confiable.",
    referencia: "Loop: benchmark 20,4 min/m³, Top 5: 17,5.",
    valorReferencia: 20.4,
    direccion: "menor",
    peorItem: "desc",
    bandas: { bueno: 17.5, normal: 20.4 },
    decimales: 1,
    desgloses: ["camion", "obra", "cliente", "chofer"],
    calcular: (d) => {
      const vs = d.viajes.filter((v) => confiable(v) && num(cicloConPlanta(v)) && (Number(v.m3) || 0) > 0)
      const m3 = suma(vs.map((v) => v.m3))
      return m3 > 0 ? suma(vs.map(cicloConPlanta)) / m3 : null
    },
    items: (d) =>
      d.viajes
        .filter((v) => confiable(v) && num(cicloConPlanta(v)) && (Number(v.m3) || 0) > 0)
        .map((v) => item(v, cicloConPlanta(v)! / Number(v.m3))),
  },
  {
    id: "km_viaje",
    columnaItem: "Km ida + vuelta",
    titulo: "Km por viaje",
    unidad: "km",
    corta: "Kilómetros de ida y vuelta de cada entrega",
    queMide:
      "La distancia recorrida por viaje. Comparando ida y vuelta se ven desvíos: si la vuelta es mucho más larga, el camión pasó por otro lado.",
    comoSeCalcula:
      "Por viaje: km de ida + km de vuelta, por el odómetro del GPS (o sumando posiciones si no hay odómetro). Promedio de los viajes de entrega completos.",
    referencia: "Loop: ejemplo de informe 31,4 km promedio. Depende de dónde estén las obras.",
    valorReferencia: null,
    direccion: "menor",
    peorItem: "desc",
    bandas: null,
    decimales: 1,
    desgloses: ["obra", "cliente", "camion"],
    ...porViaje(
      (v) => (num(v.km_ida) && num(v.km_vuelta) ? Number(v.km_ida) + Number(v.km_vuelta) : null),
      (v) => deEntrega(v) && v.estado === "completo",
    ),
  },
  {
    id: "paradas_extra",
    columnaItem: "Paradas (min)",
    titulo: "Paradas fuera de obra",
    unidad: "min/viaje",
    corta: "Minutos parado en otros lugares (no la obra) por viaje",
    queMide:
      "Paradas de 3 minutos o más que no son la obra: semáforos largos, combustible, comida, trámites o paradas no autorizadas. Sirve para auditar los viajes.",
    comoSeCalcula:
      "Por viaje: suma de los minutos de las paradas de 3 min o más fuera de planta que no son la parada principal (la obra). Promedio de los viajes de entrega completos.",
    referencia: "Loop lo usa en la auditoría (paradas no autorizadas), sin un número de referencia.",
    valorReferencia: null,
    direccion: "menor",
    peorItem: "desc",
    bandas: null,
    decimales: 0,
    desgloses: ["camion", "chofer", "obra"],
    ...porViaje((v) => v.min_paradas_extra, (v) => deEntrega(v) && v.estado === "completo"),
  },
  {
    id: "puntualidad",
    columnaItem: "Diferencia (min, + = tarde)",
    titulo: "Puntualidad",
    unidad: "%",
    corta: "Pedidos en los que el primer camión llegó a horario",
    queMide:
      "De los pedidos con hora de llegada, en cuántos el primer camión llegó a la obra a tiempo (o antes), con la tolerancia de cada planta. Es lo que más nota el cliente.",
    comoSeCalcula:
      "Por pedido: llegada a obra (GPS) del viaje del primer remito del pedido contra la hora pedida. Puntual si llegó como mucho 15 min tarde (tolerancia de la planta). Si ese viaje no se midió o el cruce es dudoso, el pedido queda sin dato (no se usa el segundo camión).",
    referencia: "Loop: tolerancia de 15 min. No publica un porcentaje; bandas propuestas por nosotros (a confirmar).",
    valorReferencia: 90,
    direccion: "mayor",
    peorItem: "desc",
    bandas: { bueno: 90, normal: 75, nota: "Bandas propias, no de Loop." },
    decimales: 0,
    desgloses: ["cliente", "obra", "camion", "chofer"],
    calcular: (d) => {
      const ps = d.pedidos.filter((p) => num(p.dif))
      return ps.length ? (ps.filter((p) => p.dif! <= p.tolerancia).length / ps.length) * 100 : null
    },
    items: (d) =>
      d.pedidos
        .filter((p) => num(p.dif))
        .map((p) => ({
          key: p.key,
          viaje_key: p.viaje_key,
          fecha: p.fecha,
          camion: p.camion,
          remito: p.remito,
          obra: p.obra,
          cliente: p.cliente,
          chofer: p.chofer,
          valor: p.dif!,
        })),
  },
  {
    id: "m3_chofer",
    columnaItem: "m³",
    titulo: "m³ por chofer",
    unidad: "m³/día",
    corta: "Metros cúbicos que entrega cada chofer en un día de trabajo",
    queMide: "La producción de cada chofer. Sirve para comparar choferes y ver quién rinde más con los mismos camiones.",
    comoSeCalcula:
      "m³ de los remitos con chofer y viaje medido ÷ días-chofer con al menos un viaje. Solo cuenta desde que se elige el chofer al despachar.",
    referencia: "Loop: benchmark 16,7 m³ por conductor por día, Top 5: 19,9.",
    valorReferencia: 16.7,
    direccion: "mayor",
    peorItem: "asc",
    bandas: { bueno: 19.9, normal: 16.7 },
    decimales: 1,
    desgloses: ["chofer"],
    calcular: (d) => {
      const vs = d.viajes.filter((v) => deEntrega(v) && v.chofer)
      const dias = diasDe(vs, (v) => v.chofer)
      return dias ? suma(vs.map((v) => v.m3)) / dias : null
    },
    items: (d) => d.viajes.filter((v) => deEntrega(v) && v.chofer).map((v) => item(v, Number(v.m3) || 0)),
  },
]

export const kpi = (id: string): KpiDef => {
  const k = KPIS.find((x) => x.id === id)
  if (!k) throw new Error(`KPI desconocido: ${id}`)
  return k
}

// ---------------------------------------------------------------------------
// Lectura del número
// ---------------------------------------------------------------------------
export function banda(k: KpiDef, valor: number | null): Banda | null {
  if (valor == null || !k.bandas) return null
  const { bueno, normal } = k.bandas
  if (k.direccion === "menor") return valor <= bueno ? "bueno" : valor <= normal ? "normal" : "a_mejorar"
  return valor >= bueno ? "bueno" : valor >= normal ? "normal" : "a_mejorar"
}

export const NOMBRE_BANDA: Record<Banda, string> = { bueno: "Bueno", normal: "Normal", a_mejorar: "A mejorar" }

/** Texto de cada banda con sus números, para el panel. */
export function textoBandas(k: KpiDef): { banda: Banda; texto: string }[] {
  if (!k.bandas) return []
  const { bueno, normal } = k.bandas
  const f = (x: number) => formatear(k, x)
  return k.direccion === "menor"
    ? [
        { banda: "bueno", texto: `hasta ${f(bueno)} ${k.unidad}` },
        { banda: "normal", texto: `de ${f(bueno)} a ${f(normal)} ${k.unidad}` },
        { banda: "a_mejorar", texto: `más de ${f(normal)} ${k.unidad}` },
      ]
    : [
        { banda: "bueno", texto: `${f(bueno)} ${k.unidad} o más` },
        { banda: "normal", texto: `de ${f(normal)} a ${f(bueno)} ${k.unidad}` },
        { banda: "a_mejorar", texto: `menos de ${f(normal)} ${k.unidad}` },
      ]
}

export function formatear(k: KpiDef, x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return "–"
  return Number(x).toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: k.decimales })
}

// ---------------------------------------------------------------------------
// Detalle: por día, desglose y peores primero
// ---------------------------------------------------------------------------
const filtrar = (d: DatosKpi, f: (x: { fecha: string; mixer_id: string | null; obra_id: string | null; cliente_id: string | null; chofer: string | null }) => boolean): DatosKpi => ({
  viajes: d.viajes.filter(f),
  pedidos: d.pedidos.filter(f),
})

/** Valor del KPI día por día (en orden). */
export function porDia(k: KpiDef, d: DatosKpi): { fecha: string; valor: number | null }[] {
  const dias = [...new Set([...d.viajes.map((v) => v.fecha), ...d.pedidos.map((p) => p.fecha)])].sort()
  return dias.map((fecha) => ({ fecha, valor: k.calcular(filtrar(d, (x) => x.fecha === fecha)) }))
}

const CLAVES: Record<Desglose, { id: (x: any) => string | null; nombre: (x: any) => string }> = {
  camion: { id: (x) => x.mixer_id, nombre: (x) => x.camion || "?" },
  obra: { id: (x) => x.obra_id, nombre: (x) => `${x.obra || "Obra sin nombre"}${x.cliente ? ` · ${x.cliente}` : ""}` },
  cliente: { id: (x) => x.cliente_id, nombre: (x) => x.cliente || "Cliente sin nombre" },
  chofer: { id: (x) => x.chofer, nombre: (x) => x.chofer || "?" },
}

/** Valor del KPI por camión, obra, cliente o chofer, peores primero. */
export function desglosar(k: KpiDef, d: DatosKpi, por: Desglose): { id: string; nombre: string; valor: number | null; n: number }[] {
  const c = CLAVES[por]
  const grupos = new Map<string, string>()
  for (const x of [...d.viajes, ...d.pedidos]) {
    const id = c.id(x)
    if (id && !grupos.has(id)) grupos.set(id, c.nombre(x))
  }
  const filas = [...grupos.entries()].map(([id, nombre]) => {
    const sub = filtrar(d, (x) => c.id(x) === id)
    return { id, nombre, valor: k.calcular(sub), n: k.items(sub).length }
  })
  return filas.filter((f) => f.valor != null).sort((a, b) => compararPeor(k, a.valor!, b.valor!))
}

/** Orden "peor primero" de los valores del KPI (desglose). */
export function compararPeor(k: KpiDef, a: number, b: number): number {
  return k.direccion === "menor" ? b - a : a - b
}

/** Los viajes (o pedidos) detrás del número, peores primero. */
export function peoresPrimero(k: KpiDef, d: DatosKpi): ItemKpi[] {
  return [...k.items(d)].sort((a, b) => (k.peorItem === "desc" ? b.valor - a.valor : a.valor - b.valor) || a.fecha.localeCompare(b.fecha))
}
