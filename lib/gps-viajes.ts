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
  let mejor: { res: (number | null)[]; costo: number } | null = null
  for (const orden of ordenes) {
    const ds = orden.map((k) => despachos[k])
    const local = iguales ? viajes.map((_, i) => i) : alinearOrdenado(viajes, ds, P)
    const res = local.map((j) => (j == null ? null : orden[j]))
    // Con la misma cantidad el orden manda: la hora no cuenta, solo planta y obra
    const f = iguales ? costoLugar : costoPar
    const usados = res.filter((j) => j != null).length
    const costo = res.reduce<number>((s, j, i) => s + (j == null ? 0 : f(viajes[i], despachos[j], P)), 0) + SALTO * (n - usados + m - usados)
    if (!mejor || costo < mejor.costo - 0.25) mejor = { res, costo }
  }
  return mejor ? mejor.res : []
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
/**
 * Mediana de las paradas principales de los viajes a una obra. Hace falta al menos 2 paradas que coincidan
 * (a menos de 0,5 km de la mediana) y que sean la mayoría; si no, no se sugiere nada.
 */
export function ubicacionAprendida(paradas: LatLng[], minimo = 2): (LatLng & { viajes: number }) | null {
  const ps = paradas.filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng))
  if (ps.length < minimo) return null
  const med = { lat: mediana(ps.map((p) => p.lat))!, lng: mediana(ps.map((p) => p.lng))! }
  const cerca = ps.filter((p) => distanciaKm(p, med) <= 0.5)
  if (cerca.length < minimo || cerca.length * 10 < ps.length * 6) return null
  return { lat: mediana(cerca.map((p) => p.lat))!, lng: mediana(cerca.map((p) => p.lng))!, viajes: cerca.length }
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

/**
 * Mediana de los últimos N viajes medidos de una obra, de un cliente o de una planta.
 * `sb` es un cliente de Supabase (navegador o servidor). Ejemplo para la programación:
 * "Medido: 32 min en obra (12 viajes)".
 */
export async function tiemposMedidos(
  sb: any,
  filtro: { obraId?: string; clienteId?: string; plantaId?: string },
  n = 20,
): Promise<TiemposMedidos> {
  let q = sb
    .from("viajes_gps")
    .select("min_ida, min_obra, min_vuelta, estado, dispatches!inner(client_id)")
    .eq("estado", "completo")
    .in("confianza", ["alta", "media"])
    .order("salida_planta", { ascending: false })
    .limit(n)
  if (filtro.obraId) q = q.eq("construction_site_id", filtro.obraId)
  if (filtro.clienteId) q = q.eq("dispatches.client_id", filtro.clienteId)
  if (filtro.plantaId) q = q.eq("plant_id_salida", filtro.plantaId)
  const { data, error } = await q
  if (error) throw error
  return medianasTramos(data || [])
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
    ciclo: r1(promedio(completos.map((v) => v.ciclo_min))),
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
