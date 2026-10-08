/**
 * Fase 4a · Tiempos reales con el GPS.
 *
 * Lógica pura (sin base ni red, para poder probarla con mensajes grabados):
 *   mensajes de Wialon → viajes (salida de planta → obra → vuelta) → cruce con los despachos
 *   → ubicación aprendida de las obras → resúmenes y tiempos medidos.
 *
 * Todo en hora argentina (UTC−3, sin horario de verano). Los horarios se guardan como ISO (UTC).
 *
 * Ojo: este archivo no importa nada en tiempo de ejecución (solo tipos) para que las pruebas
 * corran con `node --test` sin compilar. Por eso tiene su propia distancia (igual a lib/geo.ts).
 */

// ---------------------------------------------------------------------------
// Parámetros (ajustables)
// ---------------------------------------------------------------------------
export const PARAMETROS = {
  /** Radio de la geocerca de planta alrededor de plants.gps_lat/lng. */
  radioPlantaKm: 0.25,
  /** Si el camión sale pero nunca se aleja más que esto de la planta, se considera que siguió en planta (portón, playa). */
  margenPlantaKm: 0.4,
  /** Radio de una parada: mientras el camión se mueva dentro de este círculo sigue en la misma parada (maniobras en obra). */
  radioParadaKm: 0.2,
  /** Parada principal (obra): la más larga fuera de planta, de al menos estos minutos. */
  paradaPrincipalMin: 5,
  /** Otras paradas de al menos estos minutos = paradas fuera de obra. */
  paradaExtraMin: 3,
  /** La parada principal tiene que estar a menos de esto de la obra para confirmar (confianza alta). */
  radioObraKm: 0.4,
  /** Un hueco sin mensajes mayor a esto, mientras el camión se movía, deja el viaje "incompleto". */
  huecoSinSenalMin: 15,
  /** Distancia mínima entre dos mensajes separados por un hueco para considerar que se movió sin señal. */
  huecoMovioKm: 1,
  /** Velocidad (km/h) por debajo de la cual el camión está parado. */
  velParadoKmh: 3,
  /** Un motor apagado por más de esto en planta corta el "tiempo en planta" (el camión pasó la noche o estaba guardado). */
  motorApagadoCorteMin: 30,
  /**
   * Una parada afuera con el motor apagado al menos esto es un camión guardado (vacío: con hormigón el trompo
   * necesita el motor). No puede ser la obra. Si el camión no vuelve a planta ese mismo día, el viaje termina ahí.
   */
  guardadoMotorApagadoMin: 60,
  /** Tope de minutos que se le asigna a un intervalo entre dos mensajes al sumar motor encendido parado. */
  tramoMaxMin: 5,
  /** Horas de jornada por camión para el uso de la flota (07 a 18 h). */
  jornadaHoras: 11,
}
export type Parametros = typeof PARAMETROS

/** Referencias de Loop (se muestran en gris al lado de lo medido). */
export const REFERENCIAS_LOOP = {
  ciclo: 150,
  obra: 70,
  carga: "< 20–25",
  ruta: 60,
  /** Motor encendido parado en planta, por viaje: buena práctica ~35 min; típico al empezar ~60; 10 min ≈ 1 L de gasoil. */
  ralenti: 35,
  ralentiTipico: 60,
}

const OFFSET_AR_MS = -3 * 60 * 60 * 1000

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------
export type LatLng = { lat: number; lng: number }

export type MensajeGps = {
  /** Segundos epoch (UTC). */
  t: number
  lat: number
  lng: number
  /** km/h */
  vel: number
  /** Ignición (eng_ign_stat). Nulo si el equipo no la manda. */
  ign: boolean | null
  /** Odómetro en km (vhc_mileage). */
  odo: number | null
}

export type PlantaGeo = { id: string; lat: number; lng: number }

export type Parada = {
  desde: string
  hasta: string
  min: number
  lat: number
  lng: number
  /** Índices internos de los mensajes (para recalcular tramos). */
  i: number
  j: number
  /** Motor apagado mucho tiempo: camión guardado, no es una obra. */
  guardado?: boolean
}

export type ParadaExtra = {
  desde: string
  hasta: string
  min: number
  lat: number
  lng: number
  tramo: "ida" | "vuelta"
}

export type ViajeGps = {
  /** Día del viaje (fecha argentina de la salida), AAAA-MM-DD. */
  fecha: string
  unidad_wialon: string | null
  plant_id_salida: string
  plant_id_vuelta: string | null
  llegada_planta_previa: string | null
  salida_planta: string
  llegada_obra: string | null
  salida_obra: string | null
  llegada_planta: string | null
  min_en_planta: number | null
  min_motor_parado_planta: number | null
  min_ida: number | null
  min_obra: number | null
  min_vuelta: number | null
  ciclo_min: number | null
  km_ida: number | null
  km_vuelta: number | null
  parada_lat: number | null
  parada_lng: number | null
  paradas_extra: ParadaExtra[]
  estado: "completo" | "incompleto"
  /** Todas las paradas ≥ paradaExtraMin del viaje (no se guarda; sirve para elegir la de la obra al cruzar). */
  paradas: Parada[]
  /** Índice (en `paradas`) de la parada principal. */
  principal: number
  /** Mensajes del tramo afuera (no se guarda). */
  _msgs: MensajeGps[]
}

/** Fila de la tabla viajes_gps (lo que se guarda). */
export type ViajeGpsFila = Omit<ViajeGps, "paradas" | "principal" | "_msgs"> & {
  mixer_id: string
  dispatch_id: string | null
  construction_site_id: string | null
  confianza: "alta" | "media" | "baja" | null
}

export type DespachoCruce = {
  id: string
  /** Hora de despacho registrada (dispatch_date). */
  hora: string
  /** Momento en que se cargó en el sistema (desempate). */
  creado?: string | null
  /** Número de remito (texto libre; se usa el número del principio para ordenar dentro de una planta). */
  remito?: string | null
  plant_id: string | null
  construction_site_id: string | null
  /** Ubicación de la obra, si la tiene (cargada a mano o aprendida). */
  obra: LatLng | null
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
export function distanciaKm(a: LatLng, b: LatLng): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

export function mediana(xs: number[]): number | null {
  const v = xs.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b)
  if (v.length === 0) return null
  const m = v.length >> 1
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}

export function promedio(xs: (number | null | undefined)[]): number | null {
  const v = xs.filter((x): x is number => x != null && Number.isFinite(x))
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}

const iso = (t: number) => new Date(t * 1000).toISOString()
const min = (a: number, b: number) => Math.round(((b - a) / 60) * 10) / 10
const km1 = (x: number) => Math.round(x * 10) / 10

/** Fecha argentina (AAAA-MM-DD) de un instante. */
export function fechaAR(t: number | string | Date): string {
  const ms = typeof t === "number" ? t * 1000 : new Date(t).getTime()
  return new Date(ms + OFFSET_AR_MS).toISOString().slice(0, 10)
}

/** Instante (segundos epoch) de una hora argentina "AAAA-MM-DD" + horas. */
export function inicioDiaAR(fecha: string): number {
  return Math.floor(new Date(`${fecha}T00:00:00-03:00`).getTime() / 1000)
}

export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// 1. Mensajes
// ---------------------------------------------------------------------------
/** Pasa los mensajes crudos de Wialon (messages/load_interval) a la forma que usa el algoritmo. */
export function mensajesDesdeWialon(raw: any[]): MensajeGps[] {
  const out: MensajeGps[] = []
  for (const m of raw || []) {
    const y = m?.pos?.y, x = m?.pos?.x
    if (typeof m?.t !== "number" || typeof y !== "number" || typeof x !== "number") continue
    if (y === 0 && x === 0) continue
    const ign = m?.p?.eng_ign_stat
    const odo = m?.p?.vhc_mileage
    out.push({
      t: m.t,
      lat: y,
      lng: x,
      vel: typeof m.pos.s === "number" ? m.pos.s : 0,
      ign: ign == null ? null : Number(ign) === 1,
      odo: typeof odo === "number" && odo > 0 ? odo : null,
    })
  }
  out.sort((a, b) => a.t - b.t)
  return out.filter((m, k) => k === 0 || m.t !== out[k - 1].t)
}

// ---------------------------------------------------------------------------
// 2. Reconstrucción de viajes
// ---------------------------------------------------------------------------
function plantaDe(m: LatLng, plantas: PlantaGeo[], radio: number): string | null {
  let mejor: { id: string; d: number } | null = null
  for (const p of plantas) {
    const d = distanciaKm(m, p)
    if (d <= radio && (!mejor || d < mejor.d)) mejor = { id: p.id, d }
  }
  return mejor?.id ?? null
}

/** Paradas por "puntos de estadía": el camión queda dentro de un círculo de radioParadaKm al menos paradaExtraMin. */
function detectarParadas(ms: MensajeGps[], a: number, b: number, P: Parametros): Parada[] {
  const out: Parada[] = []
  let i = a
  while (i <= b) {
    let j = i + 1
    while (j <= b && distanciaKm(ms[i], ms[j]) <= P.radioParadaKm) j++
    const fin = j - 1
    const dur = (ms[fin].t - ms[i].t) / 60
    if (fin > i && dur >= P.paradaExtraMin) {
      const lats = ms.slice(i, fin + 1).map((m) => m.lat)
      const lngs = ms.slice(i, fin + 1).map((m) => m.lng)
      out.push({
        desde: iso(ms[i].t),
        hasta: iso(ms[fin].t),
        min: Math.round(dur * 10) / 10,
        lat: mediana(lats)!,
        lng: mediana(lngs)!,
        i,
        j: fin,
      })
      i = j
    } else i++
  }
  return out
}

/** Minutos del apagado de motor más largo entre los mensajes a..b (el apagado dura hasta el mensaje siguiente). */
function apagadoMasLargo(ms: MensajeGps[], a: number, b: number): number {
  let mx = 0
  let k = a
  while (k <= b) {
    if (ms[k].ign === false) {
      let f = k
      while (f + 1 <= b && ms[f + 1].ign === false) f++
      const hasta = f + 1 < ms.length ? ms[f + 1].t : ms[f].t
      mx = Math.max(mx, (hasta - ms[k].t) / 60)
      k = f + 1
    } else k++
  }
  return mx
}

function kmEntre(ms: MensajeGps[], i: number, j: number): number | null {
  if (i < 0 || j < 0 || j < i) return null
  const a = ms[i].odo, b = ms[j].odo
  if (a != null && b != null && b >= a && b - a < 500) return km1(b - a)
  let s = 0
  for (let k = i + 1; k <= j; k++) s += distanciaKm(ms[k - 1], ms[k])
  return km1(s)
}

/** Inicio efectivo de la estadía en planta: si el motor estuvo apagado mucho tiempo (noche), desde que arrancó. */
function inicioEnPlanta(ms: MensajeGps[], a: number, b: number, P: Parametros, cortarPorMotor: boolean): number {
  if (!cortarPorMotor) return a
  let inicio = a
  let k = a
  while (k <= b) {
    if (ms[k].ign === false) {
      let f = k
      while (f + 1 <= b && ms[f + 1].ign === false) f++
      // El apagado dura hasta el mensaje siguiente (cuando vuelve a encender)
      const hasta = f + 1 <= b ? ms[f + 1].t : ms[f].t
      if ((hasta - ms[k].t) / 60 >= P.motorApagadoCorteMin && f + 1 <= b) inicio = f + 1
      k = f + 1
    } else k++
  }
  return inicio
}

function motorParadoMin(ms: MensajeGps[], a: number, b: number, P: Parametros): number {
  let s = 0
  for (let k = a; k < b; k++) {
    const m = ms[k]
    if (m.ign === true && m.vel < P.velParadoKmh) s += Math.min((ms[k + 1].t - m.t) / 60, P.tramoMaxMin)
  }
  return Math.round(s)
}

/** Arma los campos del viaje a partir de la parada principal elegida. */
function armarTramos(v: ViajeGps, principal: number, P: Parametros): ViajeGps {
  const ms = v._msgs
  const salidaT = new Date(v.salida_planta).getTime() / 1000
  const vueltaT = v.llegada_planta ? new Date(v.llegada_planta).getTime() / 1000 : null
  const par = principal >= 0 ? v.paradas[principal] : null
  const r: ViajeGps = { ...v, principal }
  if (par) {
    const llegObra = ms[par.i].t, salObra = ms[par.j].t
    r.llegada_obra = iso(llegObra)
    r.salida_obra = iso(salObra)
    r.min_ida = min(salidaT, llegObra)
    r.min_obra = min(llegObra, salObra)
    r.min_vuelta = vueltaT != null ? min(salObra, vueltaT) : null
    r.km_ida = kmEntre(ms, 0, par.i)
    r.km_vuelta = vueltaT != null ? kmEntre(ms, par.j, ms.length - 1) : null
    r.parada_lat = par.lat
    r.parada_lng = par.lng
    r.paradas_extra = v.paradas
      .filter((_, k) => k !== principal)
      .map((p) => ({ desde: p.desde, hasta: p.hasta, min: p.min, lat: p.lat, lng: p.lng, tramo: p.i < par.i ? "ida" : "vuelta" }))
  }
  r.ciclo_min = vueltaT != null ? min(salidaT, vueltaT) : null
  return r
}

/**
 * Reconstruye los viajes de un camión a partir de sus mensajes (ordenados por tiempo).
 * Un viaje sale de una geocerca de planta y vuelve a una planta (puede ser la otra) con al menos una parada
 * de `paradaPrincipalMin` afuera. Salir y volver sin parar no es viaje (traslado, prueba).
 * Si no vuelve dentro de los mensajes, queda "incompleto" y sin llegada a planta.
 * Las excursiones que empiezan antes del primer mensaje (sin salida conocida) se ignoran.
 */
export function reconstruirViajes(
  mensajes: MensajeGps[],
  plantas: PlantaGeo[],
  opciones: { unidad?: string | null; parametros?: Partial<Parametros> } = {},
): ViajeGps[] {
  const P = { ...PARAMETROS, ...(opciones.parametros || {}) }
  const ms = mensajes
  if (ms.length === 0 || plantas.length === 0) return []
  const enPlanta = ms.map((m) => plantaDe(m, plantas, P.radioPlantaKm))

  // Tramos: corridas de mensajes dentro de planta (con su planta) o afuera
  type Tramo = { dentro: string | null; a: number; b: number }
  const tramos: Tramo[] = []
  for (let k = 0; k < ms.length; k++) {
    const d = enPlanta[k]
    const ult = tramos[tramos.length - 1]
    if (ult && ult.dentro === d) ult.b = k
    else tramos.push({ dentro: d, a: k, b: k })
  }

  // Una salida corta que nunca se aleja del margen de la planta y vuelve a la misma planta: sigue en planta
  for (let k = 1; k < tramos.length - 1; k++) {
    const t = tramos[k], antes = tramos[k - 1], despues = tramos[k + 1]
    if (t.dentro !== null || !antes.dentro || antes.dentro !== despues.dentro) continue
    const p = plantas.find((x) => x.id === antes.dentro)!
    let lejos = 0
    for (let i = t.a; i <= t.b; i++) lejos = Math.max(lejos, distanciaKm(ms[i], p))
    if (lejos <= P.margenPlantaKm) {
      antes.b = despues.b
      tramos.splice(k, 2)
      k--
    }
  }

  const viajes: ViajeGps[] = []
  for (let k = 1; k < tramos.length; k++) {
    const afuera = tramos[k]
    const previo = tramos[k - 1]
    if (afuera.dentro !== null || !previo.dentro) continue

    // Mensajes del viaje: desde el último en planta hasta el primero de vuelta en planta
    const ia = previo.b
    let vuelta: Tramo | null = tramos[k + 1] || null // siempre es una planta si existe
    const salidaT = ms[afuera.a].t
    const ib = vuelta ? vuelta.a : afuera.b
    let sub = ms.slice(ia, ib + 1)
    // Paradas: solo afuera de la planta (sin el primer y el último mensaje, que están adentro)
    const buscarParadas = (xs: MensajeGps[], conVuelta: boolean) =>
      detectarParadas(xs, 1, conVuelta ? xs.length - 2 : xs.length - 1, P).map((p) => ({
        ...p,
        guardado: apagadoMasLargo(xs, p.i, p.j) >= P.guardadoMotorApagadoMin,
      }))
    let paradas = buscarParadas(sub, !!vuelta)
    // Guardado afuera (por ejemplo, de noche) sin volver a planta en el día: el viaje termina al llegar ahí
    const vuelveEnElDia = vuelta && fechaAR(ms[vuelta.a].t) === fechaAR(salidaT)
    const guardado = paradas.find((p) => p.guardado)
    if (guardado && !vuelveEnElDia) {
      sub = sub.slice(0, guardado.i + 1)
      vuelta = null
      paradas = buscarParadas(sub, false).filter((p) => p.j < sub.length - 1)
    }
    const principal = paradas.reduce(
      (best, p, idx) => (!p.guardado && p.min >= P.paradaPrincipalMin && (best < 0 || p.min > paradas[best].min) ? idx : best),
      -1,
    )
    if (principal < 0) continue // salió y volvió sin parar (o fue a guardarse): no es viaje

    // Salida = primer mensaje afuera; llegada = primer mensaje de vuelta adentro
    const llegadaT = vuelta ? ms[vuelta.a].t : null

    // En planta antes de salir: desde que llegó (o desde que arrancó el motor si pasó la noche o estuvo guardado)
    const llegadaPrevKnown = k - 1 > 0 // el tramo en planta empezó dentro de los mensajes
    const largaEstadia = (ms[previo.b].t - ms[previo.a].t) / 3600 > 4
    const cruzaDia = fechaAR(ms[previo.a].t) !== fechaAR(salidaT)
    const ini = inicioEnPlanta(ms, previo.a, previo.b, P, !llegadaPrevKnown || largaEstadia || cruzaDia)
    const iniConocido = llegadaPrevKnown || ini !== previo.a

    // Sin señal: hueco largo mientras se movía
    let incompleto = !vuelta
    for (let i = 1; i < sub.length; i++) {
      if ((sub[i].t - sub[i - 1].t) / 60 > P.huecoSinSenalMin && distanciaKm(sub[i - 1], sub[i]) > P.huecoMovioKm) incompleto = true
    }

    const base: ViajeGps = {
      fecha: fechaAR(salidaT),
      unidad_wialon: opciones.unidad ?? null,
      plant_id_salida: previo.dentro,
      plant_id_vuelta: vuelta?.dentro ?? null,
      llegada_planta_previa: iniConocido ? iso(ms[ini].t) : null,
      salida_planta: iso(salidaT),
      llegada_obra: null,
      salida_obra: null,
      llegada_planta: llegadaT != null ? iso(llegadaT) : null,
      min_en_planta: iniConocido ? min(ms[ini].t, salidaT) : null,
      min_motor_parado_planta: motorParadoMin(ms, ini, previo.b + 1 <= ms.length - 1 ? previo.b + 1 : previo.b, P),
      min_ida: null,
      min_obra: null,
      min_vuelta: null,
      ciclo_min: null,
      km_ida: null,
      km_vuelta: null,
      parada_lat: null,
      parada_lng: null,
      paradas_extra: [],
      estado: incompleto ? "incompleto" : "completo",
      paradas,
      principal,
      _msgs: sub,
    }
    viajes.push(armarTramos(base, principal, P))
  }
  return viajes
}

// ---------------------------------------------------------------------------
// 3. Cruce con los despachos (un camión, un día)
// ---------------------------------------------------------------------------
export type ViajeCruzado = ViajeGps & {
  dispatch_id: string | null
  construction_site_id: string | null
  confianza: "alta" | "media" | "baja" | null
}

/** Parada del viaje más cercana a la obra, si está dentro del radio de obra. */
function paradaEnObra(v: ViajeGps, obra: LatLng, P: Parametros): number {
  let mejor = -1, dm = Infinity
  v.paradas.forEach((p, k) => {
    if (p.guardado) return
    const d = distanciaKm(p, obra)
    if (d <= P.radioObraKm && d < dm) { dm = d; mejor = k }
  })
  return mejor
}

/** Costo de lugar: planta distinta y obra ubicada que coincide (bonifica) o no (penaliza). */
function costoLugar(v: ViajeGps, d: DespachoCruce, P: Parametros): number {
  let c = 0
  if (d.plant_id && d.plant_id !== v.plant_id_salida) c += 1
  if (d.obra) c += paradaEnObra(v, d.obra, P) >= 0 ? -0.5 : 1
  return c
}

function costoPar(v: ViajeGps, d: DespachoCruce, P: Parametros): number {
  // La hora de despacho no es confiable (se carga después o en tanda): solo penaliza si queda muy lejos del viaje
  const hd = new Date(d.hora).getTime() / 1000
  const ini = v.llegada_planta_previa ? new Date(v.llegada_planta_previa).getTime() / 1000 : new Date(v.salida_planta).getTime() / 1000 - 3600
  const fin = v.llegada_planta ? new Date(v.llegada_planta).getTime() / 1000 : new Date(v.salida_planta).getTime() / 1000 + 4 * 3600
  const fuera = hd < ini ? ini - hd : hd > fin ? hd - fin : 0
  return Math.min(fuera / 3600, 2) + costoLugar(v, d, P)
}

const SALTO = 2.5
/** Despachos cargados "en tanda": registrados a menos de estos minutos uno del otro. */
const TANDA_MIN = 10

/** Alineación ordenada de menor costo (programación dinámica), dejando sueltos los que sobran. */
function alinearOrdenado(viajes: ViajeGps[], despachos: DespachoCruce[], P: Parametros): (number | null)[] {
  const n = viajes.length, m = despachos.length
  const C: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(Infinity))
  const D: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0))
  C[0][0] = 0
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      if (i === 0 && j === 0) continue
      let best = Infinity, dir = 0
      if (i > 0 && j > 0) { const c = C[i - 1][j - 1] + costoPar(viajes[i - 1], despachos[j - 1], P); if (c < best) { best = c; dir = 1 } }
      if (i > 0) { const c = C[i - 1][j] + SALTO; if (c < best) { best = c; dir = 2 } }
      if (j > 0) { const c = C[i][j - 1] + SALTO; if (c < best) { best = c; dir = 3 } }
      C[i][j] = best
      D[i][j] = dir
    }
  }
  const res: (number | null)[] = Array(n).fill(null)
  let i = n, j = m
  while (i > 0 || j > 0) {
    const dir = D[i][j]
    if (dir === 1) { res[i - 1] = j - 1; i--; j-- }
    else if (dir === 2) i--
    else j--
  }
  return res
}

/**
 * Tandas cuyo orden vale la pena revisar: despachos consecutivos registrados a menos de TANDA_MIN uno del otro,
 * a obras distintas y con alguna obra ubicada (sin ubicación no hay con qué decidir: queda el orden registrado).
 */
function tandasAmbiguas(ds: DespachoCruce[]): number[][] {
  const out: number[][] = []
  let k = 0
  while (k < ds.length) {
    let f = k
    while (f + 1 < ds.length && Math.abs(new Date(ds[f + 1].hora).getTime() - new Date(ds[f].hora).getTime()) / 60000 <= TANDA_MIN) f++
    const g = Array.from({ length: f - k + 1 }, (_, x) => k + x)
    const obras = new Set(g.map((x) => ds[x].construction_site_id))
    if (g.length >= 2 && g.length <= 4 && obras.size > 1 && g.some((x) => ds[x].obra)) out.push(g)
    k = f + 1
  }
  return out
}

function permutaciones<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs]
  const r: T[][] = []
  xs.forEach((x, i) => {
    for (const p of permutaciones([...xs.slice(0, i), ...xs.slice(i + 1)])) r.push([x, ...p])
  })
  return r
}

/**
 * Alinea viajes y despachos (ya en el orden del día, ver ordenarDespachos) de un camión en un día.
 * Si hay la misma cantidad: 1.º con 1.º, 2.º con 2.º… (la hora registrada no es confiable).
 * Si no: alineación ordenada de menor costo (hora, planta y obra), dejando sueltos los que sobran.
 * Los remitos cargados en tanda (en el mismo minuto) no dicen el orden real: si las obras están ubicadas, se
 * prueba cada orden posible de la tanda y se queda el que mejor coincide (a igualdad, el registrado).
 */
export function alinear(viajes: ViajeGps[], despachos: DespachoCruce[], P: Parametros = PARAMETROS): (number | null)[] {
  const n = viajes.length, m = despachos.length
  const iguales = n === m
  // Órdenes candidatos: el registrado primero y después las permutaciones de las tandas ambiguas
  let ordenes: number[][] = [despachos.map((_, k) => k)]
  for (const t of tandasAmbiguas(despachos)) {
    const nuevos: number[][] = []
    for (const o of ordenes) for (const p of permutaciones(t)) {
      const x = [...o]
      t.forEach((pos, q) => { x[pos] = o[p[q]] })
      nuevos.push(x)
    }
    ordenes = nuevos
    if (ordenes.length > 500) break
  }
  // Candidatos en orden de preferencia; uno posterior gana solo si cuesta claramente menos (0,25).
  // Con la misma cantidad, primero va "1.º con 1.º"; también se prueba la alineación ordenada, que gana
  // cuando hay un viaje sin remito y un remito sin viaje (por ejemplo, un traslado y un remito de otra planta).
  let mejor: { res: (number | null)[]; costo: number } | null = null
  for (const orden of ordenes) {
    const ds = orden.map((k) => despachos[k])
    const locales = iguales ? [viajes.map((_, i) => i), alinearOrdenado(viajes, ds, P)] : [alinearOrdenado(viajes, ds, P)]
    for (const local of locales) {
      const res = local.map((j) => (j == null ? null : orden[j]))
      const costo = costoAlineacion(viajes, despachos, res, P)
      if (!mejor || costo < mejor.costo - 0.25) mejor = { res, costo }
    }
  }
  return mejor ? mejor.res : []
}

/** Costo total de una alineación: cada par (hora, planta, obra) más un salto por cada viaje o remito suelto. */
export function costoAlineacion(viajes: ViajeGps[], despachos: DespachoCruce[], res: (number | null)[], P: Parametros = PARAMETROS): number {
  const usados = res.filter((j) => j != null).length
  return (
    res.reduce<number>((s, j, i) => s + (j == null ? 0 : costoPar(viajes[i], despachos[j], P)), 0) +
    SALTO * (viajes.length - usados + despachos.length - usados)
  )
}

const numeroRemito = (r: string | null | undefined): number | null => {
  const m = String(r ?? "").match(/^\s*0*(\d+)/)
  return m ? Number(m[1]) : null
}

/**
 * Orden del día de los despachos de un camión. La hora registrada no es confiable (se carga después, en tanda,
 * o queda en 12:00 en el despacho manual); el talonario de remitos sí sigue el orden de carga dentro de una
 * planta. Entonces: se ordena por hora y, dentro de cada planta, los lugares que ocupan sus despachos se
 * reparten por número de remito (si todos tienen número).
 */
export function ordenarDespachos(despachos: DespachoCruce[]): DespachoCruce[] {
  const ds = [...despachos].sort(
    (a, b) => a.hora.localeCompare(b.hora) || String(a.creado ?? "").localeCompare(String(b.creado ?? "")) || a.id.localeCompare(b.id),
  )
  const plantas = [...new Set(ds.map((d) => d.plant_id ?? ""))]
  for (const pl of plantas) {
    const lugares = ds.map((d, k) => ((d.plant_id ?? "") === pl ? k : -1)).filter((k) => k >= 0)
    const grupo = lugares.map((k) => ds[k])
    if (grupo.some((d) => numeroRemito(d.remito) == null)) continue
    const ordenado = [...grupo].sort((a, b) => numeroRemito(a.remito)! - numeroRemito(b.remito)!)
    lugares.forEach((k, x) => { ds[k] = ordenado[x] })
  }
  return ds
}

/**
 * Cruza los viajes de un camión en un día con sus despachos (ordenados por hora de despacho).
 * Confianza: alta = obra ubicada y la parada coincide (< radioObraKm); media = por orden, obra sin ubicar;
 * baja = las cantidades no coinciden, la parada no coincide con la obra ubicada o la planta es otra.
 * Un viaje sin remito, si paró cerca de una obra ubicada, toma esa obra.
 */
export function cruzarConDespachos(
  viajes: ViajeGps[],
  despachos: DespachoCruce[],
  obrasUbicadas: { id: string; lat: number; lng: number }[] = [],
  parametros: Partial<Parametros> = {},
): { viajes: ViajeCruzado[]; remitosSinViaje: string[] } {
  const P = { ...PARAMETROS, ...parametros }
  const vs = [...viajes].sort((a, b) => a.salida_planta.localeCompare(b.salida_planta))
  const ds = ordenarDespachos(despachos)
  const al = alinear(vs, ds, P)
  const usados = new Set<number>()
  const out: ViajeCruzado[] = vs.map((v, i) => {
    const j = al[i]
    if (j == null) {
      // Sin remito: ¿paró en una obra conocida?
      let obraId: string | null = null, dm = Infinity
      if (v.parada_lat != null) {
        for (const o of obrasUbicadas) {
          const d = distanciaKm({ lat: v.parada_lat, lng: v.parada_lng! }, o)
          if (d <= P.radioObraKm && d < dm) { dm = d; obraId = o.id }
        }
      }
      return { ...v, dispatch_id: null, construction_site_id: obraId, confianza: null }
    }
    usados.add(j)
    const d = ds[j]
    let vv: ViajeGps = v
    let confianza: "alta" | "media" | "baja"
    if (d.obra) {
      const k = paradaEnObra(v, d.obra, P)
      if (k >= 0) {
        if (k !== v.principal) vv = armarTramos(v, k, P)
        confianza = "alta"
      } else confianza = "baja"
    } else {
      confianza = vs.length !== ds.length || (d.plant_id && d.plant_id !== v.plant_id_salida) ? "baja" : "media"
    }
    return { ...vv, dispatch_id: d.id, construction_site_id: d.construction_site_id, confianza }
  })
  const remitosSinViaje = ds.filter((_, j) => !usados.has(j)).map((d) => d.id)
  return { viajes: out, remitosSinViaje }
}

/** Lo que se guarda en viajes_gps. */
export function aFila(v: ViajeCruzado, mixerId: string): ViajeGpsFila {
  const { paradas: _p, principal: _x, _msgs: _m, ...resto } = v
  return { ...resto, mixer_id: mixerId }
}

// ---------------------------------------------------------------------------
// 4. Ubicación aprendida de la obra
// ---------------------------------------------------------------------------
export type ParadaObra = LatLng & { fecha: string }

/**
 * Mediana de las paradas principales de los viajes a una obra. Hace falta consenso: las paradas que coinciden
 * (a menos de `radioKm` de la mediana) tienen que ser la mayoría (60 %) y ser al menos 3 (sin importar los días:
 * la mayoría de las obras son de un solo día de hormigonado) o, si son solo 2, de 2 días distintos.
 * Si no, no se sugiere nada.
 */
export function ubicacionAprendida(
  paradas: ParadaObra[],
  { radioKm = 0.2, minParadas = 3 }: { radioKm?: number; minParadas?: number } = {},
): (LatLng & { viajes: number; dias: number }) | null {
  const ps = paradas.filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.fecha)
  if (ps.length < 2) return null
  const med = { lat: mediana(ps.map((p) => p.lat))!, lng: mediana(ps.map((p) => p.lng))! }
  const cerca = ps.filter((p) => distanciaKm(p, med) <= radioKm)
  const dias = new Set(cerca.map((p) => p.fecha)).size
  if (cerca.length * 10 < ps.length * 6) return null
  const alcanza = cerca.length >= minParadas || (cerca.length === 2 && dias >= 2)
  if (!alcanza) return null
  return { lat: mediana(cerca.map((p) => p.lat))!, lng: mediana(cerca.map((p) => p.lng))!, viajes: cerca.length, dias }
}

/**
 * Paradas que se usan para aprender la ubicación de una obra.
 * - Obra sin ubicación: las paradas principales de los viajes con remito cruzados por orden (confianza media).
 * - Obra con ubicación aprendida: se recalcula cada vez con TODOS los viajes con remito a esa obra (cualquier
 *   confianza), para que un valor equivocado no se confirme a sí mismo.
 * - Obra con ubicación cargada a mano: nunca (devuelve vacío).
 */
export function paradasParaAprender(
  obra: { gps_lat: unknown; gps_source: string | null },
  viajes: Pick<ViajeGpsFila, "dispatch_id" | "confianza" | "parada_lat" | "parada_lng" | "fecha">[],
): ParadaObra[] {
  if (!sePuedeAprender(obra)) return []
  const aprendida = obra.gps_lat != null && obra.gps_source === "gps_aprendido"
  return viajes
    .filter((v) => v.dispatch_id && v.parada_lat != null && v.parada_lng != null && (aprendida || v.confianza === "media"))
    .map((v) => ({ lat: Number(v.parada_lat), lng: Number(v.parada_lng), fecha: v.fecha }))
}

/** Nunca se pisa una ubicación cargada a mano: solo se escribe si la obra no tiene o si la que tiene es aprendida. */
export function sePuedeAprender(obra: { gps_lat: unknown; gps_source: string | null }): boolean {
  return obra.gps_lat == null || obra.gps_source === "gps_aprendido"
}

// ---------------------------------------------------------------------------
// 5. Tiempos medidos (para la programación, Fase 2)
// ---------------------------------------------------------------------------
export type TiemposMedidos = { ida: number | null; obra: number | null; vuelta: number | null; viajes: number }

/** Mediana de ida, obra y vuelta de los viajes completos que se pasen (ya filtrados y limitados a los últimos N). */
export function medianasTramos(viajes: Pick<ViajeGpsFila, "min_ida" | "min_obra" | "min_vuelta" | "estado">[]): TiemposMedidos {
  const ok = viajes.filter((v) => v.estado === "completo")
  const r = (xs: (number | null)[]) => {
    const m = mediana(xs.filter((x): x is number => x != null))
    return m == null ? null : Math.round(m)
  }
  return { ida: r(ok.map((v) => v.min_ida)), obra: r(ok.map((v) => v.min_obra)), vuelta: r(ok.map((v) => v.min_vuelta)), viajes: ok.length }
}

// --- Tiempos reales para la programación (docs/migracion-loop/tiempos-gps-programacion.md) ---
// Se calculan en el momento desde viajes_gps (que el proceso de las 06:00 rehace cada noche): no se guardan.
// El paso a los parámetros del planificador (descarga por 8 m³, espera en planta) está en lib/viajes.ts.

/** Reglas: ventana, mínimos de viajes y valores que se descartan por absurdos (minutos o m³, ambos inclusive). */
export const TIEMPOS_GPS = {
  ventanaDias: 90,
  minViajesObra: 3,
  minViajesPlanta: 10,
  enPlanta: [1, 240] as [number, number],
  ida: [1, 180] as [number, number],
  // Menos de 8 min no es una descarga: el GPS no vio bien la parada (pavimentos, el camión avanza descargando)
  obra: [8, 240] as [number, number],
  m3: [0.01, 15] as [number, number],
  /** m³ sugeridos: al menos esta parte de los viajes a ±1 m³ de la mediana ("patrón claro") */
  parteM3Parecidos: 2 / 3,
  /**
   * Una obra se usa solo si el GPS ve la descarga en al menos esta parte de sus viajes. Si no (pavimentos: el
   * camión avanza mientras descarga y las paradas duran 5 min), su ida y su tiempo en obra no son confiables y
   * se usa lo de la planta. Ej.: PAVIMENTO de FARIÑA, 16 de 62 viajes.
   */
  parteObraVisible: 0.5,
}
export type ReglasTiemposGps = typeof TIEMPOS_GPS

/** Lo mínimo de un viaje GPS para los tiempos (ya filtrado: completo, alta/media, sin árido, en la ventana). */
export type FilaTiemposGps = {
  plant_id_salida: string
  construction_site_id: string | null
  min_en_planta: number | null
  min_ida: number | null
  min_obra: number | null
  /** m³ del remito */
  m3: number | null
  metodo: "bomba" | "directo"
}
/** Una mediana y de cuántos viajes sale. */
export type MedidaGps = { min: number; viajes: number }
/** Tiempo en obra (mediana) junto con los m³ típicos (mediana) de esos mismos viajes. */
export type MedidaObraGps = MedidaGps & { m3: number }
export type M3SugeridoGps = { m3: number; viajes: number; desde: number; hasta: number }
export type TiemposObraGps = {
  /** Ida real por planta de salida (la ida depende de la planta) */
  ida: Record<string, MedidaGps>
  obra: MedidaObraGps | null
  m3: M3SugeridoGps | null
}
export type TiemposPlantaGps = { enPlanta: MedidaGps | null; directo: MedidaObraGps | null; bomba: MedidaObraGps | null }
export type TiemposGps = { desde: string; obras: Record<string, TiemposObraGps>; plantas: Record<string, TiemposPlantaGps> }

const dentro = (x: number | null | undefined, [a, b]: [number, number]): x is number => x != null && Number.isFinite(x) && x >= a && x <= b
const r1 = (x: number) => Math.round(x * 10) / 10

/** Mediana de un tramo con un mínimo de viajes válidos; nula si no alcanza. */
function medida(xs: (number | null | undefined)[], lim: [number, number], minViajes: number): MedidaGps | null {
  const v = xs.filter((x): x is number => dentro(x, lim))
  if (v.length < minViajes) return null
  return { min: Math.round(mediana(v)!), viajes: v.length }
}
/** Tiempo en obra + m³ típicos, de los viajes que tienen las dos cosas válidas. */
function medidaObra(fs: FilaTiemposGps[], P: ReglasTiemposGps, minViajes: number): MedidaObraGps | null {
  const v = fs.filter((f) => dentro(f.min_obra, P.obra) && dentro(f.m3, P.m3))
  if (v.length < minViajes) return null
  return { min: Math.round(mediana(v.map((f) => f.min_obra!))!), viajes: v.length, m3: r1(mediana(v.map((f) => f.m3!))!) }
}
/** m³ por camión con un patrón claro: mediana redondeada a 0,5 y la mayoría a ±1 m³ de ella. */
export function m3Sugerido(m3s: (number | null | undefined)[], P: ReglasTiemposGps = TIEMPOS_GPS): M3SugeridoGps | null {
  const v = m3s.filter((x): x is number => dentro(x, P.m3))
  if (v.length < P.minViajesObra) return null
  const med = mediana(v)!
  const parecidos = v.filter((x) => Math.abs(x - med) <= 1).length
  if (parecidos < v.length * P.parteM3Parecidos) return null
  return { m3: Math.max(0.5, Math.round(med * 2) / 2), viajes: v.length, desde: Math.min(...v), hasta: Math.max(...v) }
}

/** Tiempos reales por obra y por planta a partir de los viajes GPS (lógica pura). */
export function calcularTiemposGps(filas: FilaTiemposGps[], desde = "", P: ReglasTiemposGps = TIEMPOS_GPS): TiemposGps {
  const porObra = new Map<string, FilaTiemposGps[]>()
  const porPlanta = new Map<string, FilaTiemposGps[]>()
  for (const f of filas) {
    if (f.construction_site_id) (porObra.get(f.construction_site_id) || porObra.set(f.construction_site_id, []).get(f.construction_site_id)!).push(f)
    if (f.plant_id_salida) (porPlanta.get(f.plant_id_salida) || porPlanta.set(f.plant_id_salida, []).get(f.plant_id_salida)!).push(f)
  }
  const obras: Record<string, TiemposObraGps> = {}
  for (const [id, fs] of porObra) {
    const ida: Record<string, MedidaGps> = {}
    const visible = fs.filter((f) => dentro(f.min_obra, P.obra)).length >= fs.length * P.parteObraVisible
    for (const pl of visible ? new Set(fs.map((f) => f.plant_id_salida)) : []) {
      const m = medida(fs.filter((f) => f.plant_id_salida === pl).map((f) => f.min_ida), P.ida, P.minViajesObra)
      if (m) ida[pl] = m
    }
    const obra = visible ? medidaObra(fs, P, P.minViajesObra) : null
    const m3 = m3Sugerido(fs.map((f) => f.m3), P)
    if (Object.keys(ida).length || obra || m3) obras[id] = { ida, obra, m3 }
  }
  const plantas: Record<string, TiemposPlantaGps> = {}
  for (const [id, fs] of porPlanta) {
    plantas[id] = {
      enPlanta: medida(fs.map((f) => f.min_en_planta), P.enPlanta, P.minViajesPlanta),
      directo: medidaObra(fs.filter((f) => f.metodo === "directo"), P, P.minViajesPlanta),
      bomba: medidaObra(fs.filter((f) => f.metodo === "bomba"), P, P.minViajesPlanta),
    }
  }
  return { desde, obras, plantas }
}

/** Fila de la consulta de cargarTiemposGps → FilaTiemposGps (nula si es un despacho por árido). */
export function filaTiemposDeConsulta(x: any): FilaTiemposGps | null {
  const d = Array.isArray(x.dispatches) ? x.dispatches[0] : x.dispatches
  if (d?.is_test_dispatch) return null
  const sd = d ? (Array.isArray(d.scheduled_dispatches) ? d.scheduled_dispatches[0] : d.scheduled_dispatches) : null
  const cs = Array.isArray(x.construction_sites) ? x.construction_sites[0] : x.construction_sites
  const num = (v: any) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v))
  const metodo = (sd?.metodo_descarga || (cs?.requires_pump ? "bomba" : "directo")) === "bomba" ? "bomba" : "directo"
  return {
    plant_id_salida: x.plant_id_salida, construction_site_id: x.construction_site_id ?? null,
    min_en_planta: num(x.min_en_planta), min_ida: num(x.min_ida), min_obra: num(x.min_obra), m3: num(d?.quantity_m3), metodo,
  }
}

let cacheTiempos: { en: number; p: Promise<TiemposGps | null> } | null = null
const CACHE_TIEMPOS_MS = 10 * 60_000

/**
 * Tiempos reales de los últimos 90 días (solo lectura). Se guardan 10 min en memoria: viajes_gps cambia una vez por
 * noche. Si la tabla no se puede leer devuelve null y la programación sigue con los tiempos de la planta.
 */
export function cargarTiemposGps(sb: any, opts: { refrescar?: boolean; hoy?: string } = {}): Promise<TiemposGps | null> {
  if (!opts.refrescar && cacheTiempos && Date.now() - cacheTiempos.en < CACHE_TIEMPOS_MS) return cacheTiempos.p
  const desde = sumarDias(opts.hoy || fechaAR(new Date()), -TIEMPOS_GPS.ventanaDias)
  // El pedido se pide por la FK del remito (scheduled_dispatches también tiene dispatch_id: sin el nombre es ambiguo)
  const p = todasLasFilas((a, b) =>
    sb.from("viajes_gps")
      .select("plant_id_salida, construction_site_id, min_en_planta, min_ida, min_obra, dispatches(quantity_m3, is_test_dispatch, scheduled_dispatches!dispatches_scheduled_dispatch_id_fkey(metodo_descarga)), construction_sites(requires_pump)")
      .eq("estado", "completo").in("confianza", ["alta", "media"]).gte("fecha", desde)
      .order("salida_planta").order("mixer_id").range(a, b),
  )
    .then((rows) => calcularTiemposGps(rows.map(filaTiemposDeConsulta).filter((f): f is FilaTiemposGps => !!f), desde))
    .catch(() => null)
  cacheTiempos = { en: Date.now(), p }
  // Un error no queda guardado: la próxima vez se vuelve a intentar
  p.then((t) => { if (!t && cacheTiempos?.p === p) cacheTiempos = null })
  return p
}

// ---------------------------------------------------------------------------
// 6. Resumen de un período (pantalla)
// ---------------------------------------------------------------------------
export type ViajeResumen = Pick<
  ViajeGpsFila,
  "fecha" | "mixer_id" | "salida_planta" | "llegada_planta" | "min_en_planta" | "min_motor_parado_planta" | "min_ida" | "min_obra" | "min_vuelta" | "ciclo_min" | "km_ida" | "km_vuelta" | "estado" | "dispatch_id"
> & { m3?: number | null; chofer?: string | null }

export function resumirViajes(viajes: ViajeResumen[], P: Parametros = PARAMETROS) {
  const completos = viajes.filter((v) => v.estado === "completo")
  const r1 = (x: number | null) => (x == null ? null : Math.round(x))
  // En planta: solo estadías razonables (las de la mañana después de pasar la noche ya vienen cortadas por el motor)
  const enPlanta = completos.map((v) => v.min_en_planta).filter((x): x is number => x != null && x <= 180)
  const m3 = viajes.reduce((s, v) => s + (Number(v.m3) || 0), 0)
  const horasViaje = completos.reduce((s, v) => s + (v.ciclo_min || 0), 0) / 60

  // Por camión
  const porCamion = new Map<string, { viajes: number; m3: number; dias: Set<string>; horas: number; km: number; motor: number[] }>()
  for (const v of viajes) {
    const c = porCamion.get(v.mixer_id) || { viajes: 0, m3: 0, dias: new Set<string>(), horas: 0, km: 0, motor: [] }
    if (v.min_motor_parado_planta != null) c.motor.push(v.min_motor_parado_planta)
    c.viajes++
    c.m3 += Number(v.m3) || 0
    c.dias.add(v.fecha)
    c.horas += (v.ciclo_min || 0) / 60
    c.km += (v.km_ida || 0) + (v.km_vuelta || 0)
    porCamion.set(v.mixer_id, c)
  }
  const diasCamion = [...porCamion.values()].reduce((s, c) => s + c.dias.size, 0)

  // Por chofer
  const porChofer = new Map<string, { viajes: number; m3: number; motor: number[] }>()
  for (const v of viajes) {
    if (!v.chofer) continue
    const c = porChofer.get(v.chofer) || { viajes: 0, m3: 0, motor: [] }
    if (v.min_motor_parado_planta != null) c.motor.push(v.min_motor_parado_planta)
    c.viajes++
    c.m3 += Number(v.m3) || 0
    porChofer.set(v.chofer, c)
  }

  const kms = completos.map((v) => (v.km_ida != null && v.km_vuelta != null ? v.km_ida + v.km_vuelta : null))
  return {
    viajes: viajes.length,
    completos: completos.length,
    conRemito: viajes.filter((v) => v.dispatch_id).length,
    sinRemito: viajes.filter((v) => !v.dispatch_id).length,
    /** Salida → vuelta a planta (sin la carga). */
    ciclo: r1(promedio(completos.map((v) => v.ciclo_min))),
    /** Ciclo + tiempo en planta antes de salir (espera y carga): comparable con el ciclo de Loop (~150, con la carga). */
    cicloConPlanta: r1(
      promedio(completos.map((v) => (v.ciclo_min != null && v.min_en_planta != null && v.min_en_planta <= 180 ? Number(v.ciclo_min) + Number(v.min_en_planta) : null))),
    ),
    obra: r1(promedio(completos.map((v) => v.min_obra))),
    ida: r1(promedio(completos.map((v) => v.min_ida))),
    vuelta: r1(promedio(completos.map((v) => v.min_vuelta))),
    enPlanta: r1(promedio(enPlanta)),
    /** Ralentí en planta: minutos promedio por viaje con motor encendido y parado en planta antes de salir. */
    motorParadoPlanta: r1(promedio(viajes.map((v) => v.min_motor_parado_planta))),
    m3: Math.round(m3 * 10) / 10,
    /** Horas en viaje sobre las horas de jornada de los días en que cada camión trabajó. */
    usoFlota: diasCamion ? Math.round((horasViaje / (diasCamion * P.jornadaHoras)) * 100) : null,
    /** Minutos de ciclo por m³, solo de los viajes completos con remito. */
    minPorM3: (() => {
      const cm = completos.filter((v) => (Number(v.m3) || 0) > 0)
      const m = cm.reduce((s, v) => s + Number(v.m3), 0)
      return m > 0 ? Math.round((cm.reduce((s, v) => s + (v.ciclo_min || 0), 0) / m) * 10) / 10 : null
    })(),
    kmPorViaje: (() => { const x = promedio(kms); return x == null ? null : km1(x) })(),
    porCamion: [...porCamion.entries()].map(([mixer_id, c]) => ({
      mixer_id,
      viajes: c.viajes,
      m3: Math.round(c.m3 * 10) / 10,
      dias: c.dias.size,
      uso: Math.round((c.horas / (c.dias.size * P.jornadaHoras)) * 100),
      km: Math.round(c.km),
      motorParadoPlanta: r1(promedio(c.motor)),
    })),
    porChofer: [...porChofer.entries()].map(([chofer, c]) => ({
      chofer,
      viajes: c.viajes,
      m3: Math.round(c.m3 * 10) / 10,
      motorParadoPlanta: r1(promedio(c.motor)),
    })),
  }
}

// ---------------------------------------------------------------------------
// 7. Puntualidad: el primer camión del pedido
// ---------------------------------------------------------------------------
/**
 * El primer camión de un pedido es el primer remito en el orden del día (número de remito dentro de la planta,
 * ver ordenarDespachos), no el que llegó primero. Si ese viaje no se midió o el cruce es dudoso, el pedido
 * queda "sin dato" (no se usa el segundo camión, que daría una puntualidad falsa).
 */
export function llegadaPrimerCamion(
  despachosPedido: { id: string; dispatch_date: string; remito: string | null; plant_id: string | null; construction_site_id?: string | null }[],
  viajePorRemito: Map<string, Pick<ViajeGpsFila, "llegada_obra" | "confianza">>,
): { dispatch_id: string; llegada: string | null } | null {
  if (despachosPedido.length === 0) return null
  const orden = ordenarDespachos(
    despachosPedido.map((d) => ({ id: d.id, hora: new Date(d.dispatch_date).toISOString(), remito: d.remito, plant_id: d.plant_id, construction_site_id: d.construction_site_id ?? null, obra: null })),
  )
  const primero = orden[0]
  const v = viajePorRemito.get(primero.id)
  return { dispatch_id: primero.id, llegada: v && v.llegada_obra && v.confianza !== "baja" ? v.llegada_obra : null }
}

// ---------------------------------------------------------------------------
// 8. Base de datos (reciben un cliente de Supabase; sin imports para poder probarlas)
// ---------------------------------------------------------------------------
/** Trae todas las filas de una consulta paginando de a 1000 (PostgREST corta ahí aunque se pida más). */
export async function todasLasFilas<T = any>(armar: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: any }>, pagina = 1000): Promise<T[]> {
  const out: T[] = []
  for (let a = 0; ; a += pagina) {
    const { data, error } = await armar(a, a + pagina - 1)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < pagina) break
  }
  return out
}

/** Consulta por lotes de ids (un `.in()` con cientos de ids arma una URL demasiado larga). */
export async function porLotes<T = any>(ids: string[], consulta: (lote: string[]) => PromiseLike<{ data: T[] | null; error: any }>, tam = 200): Promise<T[]> {
  const out: T[] = []
  for (let k = 0; k < ids.length; k += tam) {
    const { data, error } = await consulta(ids.slice(k, k + tam))
    if (error) throw error
    out.push(...(data || []))
  }
  return out
}

/**
 * Guarda los viajes de un camión para un rango de días sin dejarlo nunca vacío:
 * 1) upsert de los viajes nuevos con procesado_at = ahora (clave mixer_id + salida_planta);
 * 2) recién después, borra los del camión en el rango que no se tocaron (procesado_at anterior): viajes que
 *    ya no existen, por ejemplo porque cambió la hora de salida o un viaje que cruzaba la medianoche.
 * Si el upsert falla no se borra nada (quedan los viajes anteriores).
 */
export async function guardarViajesCamion(sb: any, mixerId: string, filas: ViajeGpsFila[], desde: string, hasta: string, ahora: string): Promise<void> {
  if (filas.length) {
    const { error } = await sb
      .from("viajes_gps")
      .upsert(filas.map((f) => ({ ...f, procesado_at: ahora })), { onConflict: "mixer_id,salida_planta" })
    if (error) throw error
  }
  const { error } = await sb
    .from("viajes_gps")
    .delete()
    .eq("mixer_id", mixerId)
    .gte("fecha", desde)
    .lte("fecha", hasta)
    .lt("procesado_at", ahora)
  if (error) throw error
}
