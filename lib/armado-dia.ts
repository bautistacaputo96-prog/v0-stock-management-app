/**
 * Mail del armado del día y resumen para el WhatsApp de Concretus (docs/specs/2026-11-05-dia-unificado-y-mail.md,
 * fase B). Todo puro: cuándo sale y para qué fecha, dónde amanecen los camiones, la huella y qué cambió, los
 * destinatarios, el HTML del mail (con el diagrama como tabla) y el JSON del resumen. Las filas, el estado, los
 * traslados y la noche salen de las mismas funciones de lib/reparto.ts que usa la pantalla.
 * La parte que lee la base, el GPS y manda está en lib/armado-dia-servidor.ts.
 */
import { aHora, aMin } from "@/lib/planificador"
import { textoNoche, lineaTraslados, contarTraslados, bloquesDiagrama, textoResumenDia, horaArgentina, type FilaPedido, type FilaDiagrama, type Aviso } from "@/lib/reparto"
import type { VistaDia } from "@/lib/reparto-dia"

const MIN = 60_000
const OFFSET_AR = 3 * 3600_000
const DIA_MS = 24 * 3600_000

/** Cuándo sale el mail y cuántas actualizaciones (preguntas 2, 3 y 4, con las recomendaciones) */
export const REGLAS_MAIL_ARMADO = {
  /** Desde cuándo sale el mail del día siguiente */
  hora: "17:00",
  /** Hasta qué hora del día armado se mandan actualizaciones solas */
  reenvioHasta: "06:00",
  /** Antirrebote: minutos sin cambios antes de mandar la actualización */
  esperaMin: 10,
  /** Tope de mails por fecha */
  maxEnvios: 10,
  /** Segunda toma del GPS (solo manda actualización si cambia dónde arranca algún camión) */
  segundaToma: "20:00",
  /** Cada cuánto corre la pasada (pg_cron) */
  pasadaMin: 5,
}

export const MAIL_ARMADO_A = ["Fernando Maldonado"]
export const MAIL_ARMADO_CC = ["Juan Oreguy"]
/** Fuera de producción (preview, local), "Enviar ahora" manda solo a Bautista */
export const MAIL_ARMADO_PRUEBA = ["Bautista Caputo"]
export const FROM_ARMADO = () => `Rebucret - Programación <${process.env.REPORTE_CALIDAD_FROM || "reportes@produccionrebucret.com"}>`
export const SITIO = "https://www.produccionrebucret.com"

// ---------------------------------------------------------------------------
// Hora de Argentina
// ---------------------------------------------------------------------------
/** Fecha (yyyy-mm-dd) y minutos del día en Argentina de un instante */
export function relojAR(t: number) {
  const d = new Date(t - OFFSET_AR)
  return { fecha: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes() }
}
export const sumarDias = (fecha: string, n: number) => new Date(Date.parse(`${fecha}T12:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10)
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"]
/** "jueves 05/11" */
export function tituloDe(fecha: string) {
  const d = new Date(`${fecha}T12:00:00Z`)
  return `${DIAS[d.getUTCDay()]} ${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`
}
const hhDe = (t: number) => aHora(relojAR(t).min)

/**
 * Qué fecha se arma en este momento: de 17:00 a 23:59, mañana; de 00:00 a 05:59, hoy (el "mañana" de anoche); de 06:00
 * a 16:59, ninguna (la pasada termina enseguida).
 */
export function fechaObjetivo(ahora: number): string | null {
  const r = relojAR(ahora)
  if (r.min >= aMin(REGLAS_MAIL_ARMADO.hora)) return sumarDias(r.fecha, 1)
  if (r.min < aMin(REGLAS_MAIL_ARMADO.reenvioHasta)) return r.fecha
  return null
}

// ---------------------------------------------------------------------------
// Estado del mail de una fecha (tabla armado_mail) y la decisión
// ---------------------------------------------------------------------------
export type EstadoMail = {
  fecha: string
  toma_gps_at: string | null
  toma_gps_2_at?: string | null
  primer_envio_at: string | null
  ultimo_envio_at: string | null
  envios: number
  huella_enviada: string | null
  contenido_enviado: ContenidoArmado | null
  huella_vista: string | null
  vista_desde: string | null
  a?: string[] | null
  ultimo_error: string | null
}
export const estadoVacio = (fecha: string): EstadoMail => ({ fecha, toma_gps_at: null, toma_gps_2_at: null, primer_envio_at: null, ultimo_envio_at: null, envios: 0, huella_enviada: null, contenido_enviado: null, huella_vista: null, vista_desde: null, a: null, ultimo_error: null })

/** ¿Hay que tomar el GPS en esta pasada? La de las 17:00 (una vez por fecha) y la segunda de las 20:00. */
export function tomaPendiente(e: EstadoMail, ahora: number): "primera" | "segunda" | null {
  if (!e.toma_gps_at) return "primera"
  const r = relojAR(ahora)
  const tomada = relojAR(Date.parse(e.toma_gps_at))
  const segunda = aMin(REGLAS_MAIL_ARMADO.segundaToma)
  if (!e.toma_gps_2_at && r.fecha === sumarDias(e.fecha, -1) && r.min >= segunda && !(tomada.fecha === r.fecha && tomada.min >= segunda)) return "segunda"
  return null
}

export type Decision = { accion: "nada" | "esperar" | "enviar"; tipo?: "dia" | "actualizacion"; anotarVista: boolean; motivo: string }

/**
 * La decisión de cada pasada (4.1): el primer mail sale enseguida; después, solo si cambió la huella y no volvió a
 * cambiar en `esperaMin` (antirrebote); sin pedidos no sale (si aparece uno, sale como mail del día con antirrebote);
 * como mucho `maxEnvios` por fecha. El horario lo pone `fechaObjetivo` (fuera de horario no hay fecha).
 */
export function decidirEnvio(estado: EstadoMail | null, ahora: number, huella: string, hayPedidos: boolean): Decision {
  const e = estado || estadoVacio("")
  if (e.envios >= REGLAS_MAIL_ARMADO.maxEnvios) return { accion: "nada", anotarVista: false, motivo: "tope" }
  const cambioVista = huella !== e.huella_vista
  if (huella === e.huella_enviada) return { accion: "nada", anotarVista: cambioVista, motivo: "igual al último mail" }
  if (!hayPedidos && e.envios === 0) return { accion: "nada", anotarVista: cambioVista, motivo: "sin pedidos" }
  if (cambioVista) {
    if (e.envios === 0 && e.huella_vista == null) return { accion: "enviar", tipo: "dia", anotarVista: true, motivo: "primer mail" }
    return { accion: "esperar", anotarVista: true, motivo: "cambió: se espera el antirrebote" }
  }
  const desde = e.vista_desde ? Date.parse(e.vista_desde) : ahora
  if (ahora - desde >= REGLAS_MAIL_ARMADO.esperaMin * MIN) return { accion: "enviar", tipo: e.envios === 0 ? "dia" : "actualizacion", anotarVista: false, motivo: "sin cambios hace 10 min" }
  return { accion: "esperar", anotarVista: false, motivo: "antirrebote" }
}

// ---------------------------------------------------------------------------
// Dónde amanecen los camiones (4.3)
// ---------------------------------------------------------------------------
export type FuenteAmanecer = "reparto_noche" | "gps_planta" | "ultimo_viaje" | "cercana" | "reparto" | "sin_dato"
export type Amanecer = {
  mixer_id: string
  plant_id: string | null
  fuente: FuenteAmanecer
  estado_gps: string | null
  lat: number | null
  lng: number | null
  km_planta: number | null
  posicion_at: string | null
  texto: string
}
export type GpsCamionMin = {
  estado: string
  planta_id: string | null
  planta_cercana: { id: string; nombre: string; km: number } | null
  ultima_posicion: string | null
  lat: number | null
  lng: number | null
  despacho: { obra: { nombre: string } | null } | null
}
/** Más de esto sin posición = sin señal */
export const SIN_SENAL_MIN = 180
const DESCRIPCION_GPS: Record<string, string> = { en_obra: "todavía en obra", hacia_obra: "yendo a obra", volviendo: "volviendo", detenido: "parado fuera de planta" }

/**
 * Qué planta se toma para un camión, con su línea del mail. `repartoHoy`: el reparto del día de hoy (el anterior al
 * armado) de ese camión: dónde duerme y dónde termina. `gpsCaido`: no se pudo leer Wialon (para todos).
 */
export function amanecerDe(a: {
  mixerId: string; patente: string; gps: GpsCamionMin | null; gpsCaido: boolean
  repartoHoy: { duerme: string | null; terminaEn: string | null } | null
  ultimoDespachoPlanta: string | null; nombres: Record<string, string>; ahora: number
}): Amanecer {
  const N = (id: string | null) => (id ? a.nombres[id] || "otra planta" : "")
  const base = { mixer_id: a.mixerId, estado_gps: a.gps?.estado ?? null, lat: a.gps?.lat ?? null, lng: a.gps?.lng ?? null, km_planta: a.gps?.planta_cercana?.km ?? null, posicion_at: a.gps?.ultima_posicion ?? null }
  const r = a.repartoHoy
  if (r?.duerme && r.terminaEn && r.duerme !== r.terminaEn) return { ...base, plant_id: r.duerme, fuente: "reparto_noche", texto: `${a.patente}: pasa a ${N(r.duerme)} esta noche (reparto).` }
  const respaldo = (prefijo: string): Amanecer => {
    const delReparto = r?.duerme || r?.terminaEn || null
    if (delReparto) return { ...base, plant_id: delReparto, fuente: "reparto", texto: `${a.patente}: ${prefijo}, se toma ${N(delReparto)} (reparto de hoy).` }
    if (a.ultimoDespachoPlanta) return { ...base, plant_id: a.ultimoDespachoPlanta, fuente: "ultimo_viaje", texto: `${a.patente}: ${prefijo}, se toma ${N(a.ultimoDespachoPlanta)} (su último viaje).` }
    return { ...base, plant_id: null, fuente: "sin_dato", texto: `${a.patente}: ${prefijo}, a confirmar.` }
  }
  if (a.gpsCaido) return respaldo("no se pudo leer el GPS")
  if (!a.gps) return respaldo("sin GPS")
  const t = a.gps.ultima_posicion ? Date.parse(a.gps.ultima_posicion) : NaN
  if (a.gps.estado === "sin_senal" || !Number.isFinite(t) || a.ahora - t > SIN_SENAL_MIN * MIN) {
    return respaldo(Number.isFinite(t) ? `sin señal del GPS desde las ${hhDe(t)}` : "sin señal del GPS")
  }
  if (a.gps.estado === "en_planta" && a.gps.planta_id) return { ...base, plant_id: a.gps.planta_id, fuente: "gps_planta", texto: `${a.patente}: en ${N(a.gps.planta_id)}.` }
  const desc = DESCRIPCION_GPS[a.gps.estado] || "fuera de planta"
  if (a.ultimoDespachoPlanta) {
    const obra = a.gps.despacho?.obra?.nombre
    return { ...base, plant_id: a.ultimoDespachoPlanta, fuente: "ultimo_viaje", texto: `${a.patente}: ${desc}${obra ? ` (${obra})` : ""}, se toma ${N(a.ultimoDespachoPlanta)} (su último viaje).` }
  }
  const c = a.gps.planta_cercana
  if (c) return { ...base, plant_id: c.id, fuente: "cercana", texto: `${a.patente}: a ${Math.round(c.km)} km de ${c.nombre}, se toma ${c.nombre} (la más cercana).` }
  return { ...base, plant_id: null, fuente: "sin_dato", texto: `${a.patente}: ${desc}, a confirmar.` }
}
export const TEXTO_GPS_CAIDO = "No se pudo leer el GPS: se toma dónde duermen según el reparto de hoy."

// ---------------------------------------------------------------------------
// Contenido, huella y qué cambió (4.4)
// ---------------------------------------------------------------------------
export type ContenidoArmado = {
  fecha: string
  pedidos: Pick<FilaPedido, "id" | "nombre" | "planta" | "llegada" | "sale" | "metodo" | "m3" | "viajes" | "camiones" | "comienza" | "termina" | "aTiempo" | "atrasoMin" | "estado" | "jornada" | "confirmado">[]
  traslados: string[]
  /** Dónde arranca cada camión (solo la planta entra en la huella) */
  arranque: { id: string; patente: string; plantId: string | null; planta: string | null }[]
  noche: string
  diagrama: { patente: string; bloques: string[] }[]
  reparto: "guardado" | "sugerencia"
  repartoPor: string | null
  repartoAt: string | null
}

/** "10:56 AG083GT → Canning" (hora de salida) */
export const trasladosCortos = (v: VistaDia) => [...v.resultado.traslados].sort((a, b) => a.sale - b.sale).map((t) => `${aHora(Math.round(t.sale))} ${v.patentes[t.camionId] || t.camionId} → ${v.nombres[t.a] || ""}`)

/** Dónde duerme cada camión según el reparto vigente del día armado */
export const duermeDe = (v: VistaDia) => Object.fromEntries(v.delDia.map((m) => [m.id, v.vigente[m.id]?.duerme ?? (v.vigente[m.id]?.tramos.slice(-1)[0]?.plantId || v.amanece[m.id] || null)]))

export function contenidoArmado(v: VistaDia, guardado: { por: string | null; at: string | null } | null): ContenidoArmado {
  return {
    fecha: v.fecha,
    pedidos: v.filas.map((f) => ({ id: f.id, nombre: f.nombre, planta: f.planta, llegada: f.llegada, sale: f.sale, metodo: f.metodo, m3: f.m3, viajes: f.viajes, camiones: f.camiones, comienza: f.comienza, termina: f.termina, aTiempo: f.aTiempo, atrasoMin: f.atrasoMin, estado: f.estado, jornada: f.jornada, confirmado: f.confirmado })),
    traslados: trasladosCortos(v),
    arranque: v.delDia.map((m) => ({ id: m.id, patente: m.license_plate, plantId: v.amanece[m.id] ?? null, planta: v.amanece[m.id] ? v.nombres[v.amanece[m.id]!] || null : null })),
    noche: textoNoche(duermeDe(v), v.plantas),
    diagrama: bloquesDiagrama(v.resultado, v.camiones, v.nombres, v.obraDe).map((f) => ({ patente: f.patente, bloques: f.bloques.map((b) => `${b.texto} ${aHora(Math.round(b.desde))}-${aHora(Math.round(b.hasta))}`) })),
    reparto: guardado ? "guardado" : "sugerencia",
    repartoPor: guardado?.por ?? null,
    repartoAt: guardado?.at ?? null,
  }
}

/** JSON con las claves ordenadas (y los pedidos y camiones por id): el mismo contenido da el mismo texto */
function estable(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(estable).join(",")}]`
  if (x && typeof x === "object") return `{${Object.keys(x as object).sort().map((k) => `${JSON.stringify(k)}:${estable((x as any)[k])}`).join(",")}}`
  return JSON.stringify(x ?? null)
}
/** FNV-1a de 32 bits (anda igual en el navegador y en Node) */
function fnv1a(s: string) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(16).padStart(8, "0")
}
/** La huella del armado: cambia si cambia algo que se ve en el mail (no con la hora de armado ni el orden) */
export function huellaDe(c: ContenidoArmado) {
  const porId = <T extends { id: string }>(xs: T[]) => [...xs].sort((a, b) => a.id.localeCompare(b.id))
  return fnv1a(estable({ ...c, pedidos: porId(c.pedidos), arranque: porId(c.arranque), diagrama: [...c.diagrama].sort((a, b) => a.patente.localeCompare(b.patente)) }))
}

/** Lo que pasó con un pedido que estaba en el mail anterior y ya no está */
export type Desaparecido = "cancelado" | "otro_dia" | "completado" | "no_esta"

/** "Pampero: llega 13:00 → 14:00", "Nuevo: Lote 5 (Hudson, 11:00)", "Cambió el reparto (guardado por Fernando 22:31)"… (máx. 8) */
export function cambiosEntre(ant: ContenidoArmado | null, act: ContenidoArmado, opts: { desaparecidos?: Record<string, Desaparecido>; tomaGpsAt?: string | null } = {}): string[] {
  if (!ant) return []
  const out: string[] = []
  for (const p of act.pedidos) {
    const a = ant.pedidos.find((x) => x.id === p.id)
    if (!a) { out.push(`Nuevo: ${p.nombre} (${p.planta}, ${p.llegada})`); continue }
    if (a.llegada !== p.llegada) out.push(`${p.nombre}: llega ${a.llegada} → ${p.llegada}`)
    if (a.metodo !== p.metodo) out.push(`${p.nombre}: ${a.metodo} → ${p.metodo}`)
    if (Number(a.m3) !== Number(p.m3)) out.push(`${p.nombre}: ${a.m3} → ${p.m3} m³`)
  }
  for (const a of ant.pedidos) {
    if (act.pedidos.some((x) => x.id === a.id)) continue
    const d = opts.desaparecidos?.[a.id] || "no_esta"
    out.push(`${a.nombre}: ${d === "cancelado" ? "cancelado" : d === "otro_dia" ? "pasó a otro día" : d === "completado" ? "completado" : "ya no está en el día"}`)
  }
  if (ant.reparto !== act.reparto || ant.repartoAt !== act.repartoAt) {
    out.push(act.reparto === "guardado" ? `Cambió el reparto${act.repartoPor ? ` (guardado por ${act.repartoPor}${act.repartoAt ? ` ${hhDe(Date.parse(act.repartoAt))}` : ""})` : ""}` : "Cambió el reparto (vuelve a ser la sugerencia)")
  }
  for (const c of act.arranque) {
    const a = ant.arranque.find((x) => x.id === c.id)
    if (a && a.plantId !== c.plantId) out.push(c.plantId ? `${c.patente} ahora arranca en ${c.planta || "otra planta"}${opts.tomaGpsAt ? ` (GPS ${hhDe(Date.parse(opts.tomaGpsAt))})` : ""}` : `${c.patente}: dónde arranca, a confirmar`)
  }
  if (!out.length && estable(ant.diagrama) !== estable(act.diagrama)) out.push("Cambió el armado de los camiones")
  return out.length > 8 ? [...out.slice(0, 8), `y ${out.length - 8} ${out.length - 8 === 1 ? "cambio más" : "cambios más"}`] : out
}

// ---------------------------------------------------------------------------
// Destinatarios (4.2)
// ---------------------------------------------------------------------------
export type Destinatarios = { to: string[]; cc: string[]; aviso: string | null; error: string | null; prueba: boolean }

/** `mails`: nombre → mail (o null) de los usuarios de MAIL_ARMADO_A, MAIL_ARMADO_CC y MAIL_ARMADO_PRUEBA */
export function destinatarios(prueba: boolean, mails: Record<string, string | null>): Destinatarios {
  if (prueba) {
    const to = MAIL_ARMADO_PRUEBA.map((n) => mails[n]).filter((x): x is string => !!x)
    return { to, cc: [], aviso: null, error: to.length ? null : `${MAIL_ARMADO_PRUEBA.join(", ")} no tiene mail cargado en Usuarios.`, prueba: true }
  }
  const faltan = [...MAIL_ARMADO_A, ...MAIL_ARMADO_CC].filter((n) => !mails[n])
  const a = MAIL_ARMADO_A.map((n) => mails[n]).filter((x): x is string => !!x)
  const cc = MAIL_ARMADO_CC.map((n) => mails[n]).filter((x): x is string => !!x)
  if (!a.length && !cc.length) return { to: [], cc: [], aviso: null, error: `${lista(faltan)} no tienen mail cargado en Usuarios.`, prueba: false }
  if (!a.length) return { to: cc, cc: [], aviso: `${lista(MAIL_ARMADO_A)} no tiene mail cargado en Usuarios: este mail no le llegó.`, error: null, prueba: false }
  return { to: a, cc, aviso: null, error: null, prueba: false }
}
const lista = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}` : xs[0] || "")

// ---------------------------------------------------------------------------
// El mail (4.5) y el diagrama como tabla (4.6)
// ---------------------------------------------------------------------------
export const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
export const linkDia = (fecha: string) => `${SITIO}/programacion?vista=dia&fecha=${fecha}`

const COLOR_PLANTA = { teal: "#ccfbf1", violeta: "#ede9fe", traslado: "#e5e7eb" }
function colorPlanta(nombre: string, i: number) {
  const n = nombre.toLowerCase()
  if (n.includes("canning")) return COLOR_PLANTA.teal
  if (n.includes("hudson")) return COLOR_PLANTA.violeta
  return i % 2 === 0 ? COLOR_PLANTA.teal : COLOR_PLANTA.violeta
}

/**
 * El diagrama para el mail: una fila por camión, celdas de 15 min, cada viaje o traslado una celda con colspan (con el
 * color de la planta y el nombre si ocupa 4 celdas o más). Debajo, la misma información en texto (para el celular).
 */
export function diagramaHtml(filas: FilaDiagrama[], plantas: { id: string; nombre: string }[]) {
  const nombre = (id: string) => plantas.find((p) => p.id === id)?.nombre || ""
  const color = (id: string) => colorPlanta(nombre(id), Math.max(0, plantas.findIndex((p) => p.id === id)))
  const todos = filas.flatMap((f) => f.bloques)
  const t0 = Math.min(aMin("07:00"), ...todos.map((b) => Math.floor(b.desde / 60) * 60))
  const t1 = Math.max(aMin("18:00"), ...todos.map((b) => Math.ceil(b.hasta / 60) * 60))
  const n = Math.round((t1 - t0) / 15)
  const celda = 'style="padding:0;height:22px;font-size:10px;border-right:1px solid #fff"'
  const cabecera = Array.from({ length: n / 4 }, (_, i) => `<td colspan="4" style="font-size:10px;color:#6b7280;padding:2px 0">${aHora(t0 + i * 60).slice(0, 2)}</td>`).join("")
  const filasHtml = filas.map((f) => {
    let c = 0
    const tds: string[] = []
    for (const b of [...f.bloques].sort((x, y) => x.desde - y.desde)) {
      const s = Math.max(c, Math.floor((b.desde - t0) / 15))
      const e = Math.min(n, Math.ceil((b.hasta - t0) / 15))
      if (e <= s) continue
      if (s > c) tds.push(`<td colspan="${s - c}" ${celda}></td>`)
      const bg = b.tipo === "traslado" ? COLOR_PLANTA.traslado : color(b.plantId)
      const texto = e - s >= 4 ? esc(b.texto) : ""
      tds.push(`<td colspan="${e - s}" bgcolor="${bg}" title="${esc(`${b.texto} · ${b.detalle}`)}" style="padding:0 3px;height:22px;font-size:10px;background:${bg};border-right:2px solid #fff;white-space:nowrap;overflow:hidden">${texto}</td>`)
      c = e
    }
    if (c < n) tds.push(`<td colspan="${n - c}" ${celda}></td>`)
    return `<tr><td style="font-size:11px;font-weight:bold;padding:0 6px 0 0;white-space:nowrap">${esc(f.patente)}</td>${tds.join("")}</tr>`
  }).join("")
  const leyenda = [...plantas.map((p) => `<span style="background:${color(p.id)};padding:1px 6px;border-radius:3px">${esc(p.nombre)}</span>`), `<span style="background:${COLOR_PLANTA.traslado};padding:1px 6px;border-radius:3px">Traslado</span>`].join(" ")
  const texto = filas.map((f) => {
    const partes: string[] = []
    let planta: string | null = null
    let actual: string[] = []
    const cerrar = () => { if (actual.length) partes.push(`${esc(nombre(planta!))}: ${actual.join(", ")}`); actual = [] }
    for (const b of [...f.bloques].sort((x, y) => x.desde - y.desde)) {
      const h = `${aHora(Math.round(b.desde))}–${aHora(Math.round(b.hasta))}`
      if (b.tipo === "traslado") { cerrar(); partes.push(`${esc(b.texto)} ${h}`); planta = null; continue }
      if (planta !== b.plantId) { cerrar(); planta = b.plantId }
      actual.push(`${esc(b.texto)} ${h}`)
    }
    cerrar()
    return `<div style="font-size:12px;margin:2px 0"><b>${esc(f.patente)}</b> · ${partes.length ? partes.join(" · ") : "sin viajes"}</div>`
  }).join("")
  return `<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;table-layout:fixed"><tr><td style="width:64px"></td>${cabecera}</tr>${filasHtml}</table>`
    + `<div style="font-size:11px;color:#6b7280;margin:6px 0">${leyenda}</div>`
    + `<div style="margin-top:8px">${texto}</div>`
}

export type DatosMail = {
  fecha: string
  /** Cuándo se armó (ms) */
  armadoEl: number
  tipo: "dia" | "actualizacion"
  /** Número de actualización (1, 2…) */
  n: number
  cambios: string[]
  prueba: boolean
  aviso: string | null
  resumen: string
  numeros: string
  estado: string
  filas: FilaPedido[]
  avisos: Aviso[]
  arranque: string[]
  gpsCaido: boolean
  gpsHora: string | null
  conviene: string | null
  traslados: string
  trasladoAConfirmar: boolean
  noche: string
  diagrama: FilaDiagrama[]
  plantas: { id: string; nombre: string }[]
}

/** Asunto y HTML del mail (estilos en línea, sin imágenes ni CSS externo, ancho máx. 680 px) */
export function armarMailArmado(d: DatosMail): { asunto: string; html: string } {
  const titulo = tituloDe(d.fecha)
  const r = relojAR(d.armadoEl)
  const asuntoBase = d.tipo === "actualizacion"
    ? `ACTUALIZACIÓN ${d.n} · Armado del ${titulo} · Rebucret (${aHora(r.min)})`
    : `Armado del ${titulo} · Rebucret`
  const asunto = `${d.prueba ? "[PRUEBA] " : ""}${asuntoBase}`
  const gris = "color:#6b7280"
  const th = 'style="text-align:left;font-size:11px;color:#6b7280;padding:4px 6px;border-bottom:1px solid #e5e7eb"'
  const td = 'style="font-size:12px;padding:4px 6px;border-bottom:1px solid #f3f4f6;vertical-align:top"'
  const chip = (texto: string, ok: boolean) => `<span style="display:inline-block;padding:1px 6px;border-radius:9px;font-size:11px;background:${ok ? "#d1fae5" : "#fef3c7"};color:${ok ? "#065f46" : "#92400e"}">${esc(texto)}</span>`
  const filas = d.filas.map((f) => `<tr>`
    + `<td ${td}><b>${esc(f.nombre)}</b><div style="${gris};font-size:11px">${esc([f.planta, f.metodo, `${f.m3} m³`, f.cliente].filter(Boolean).join(" · "))}</div></td>`
    + `<td ${td}>${f.viajes}</td>`
    + `<td ${td}>${f.camiones.n}<div style="${gris};font-size:11px">${esc(f.camiones.patentes.join(", "))}</div></td>`
    + `<td ${td}>${esc(f.comienza || "—")}</td>`
    + `<td ${td}>${esc(f.termina || "—")}</td>`
    + `<td ${td}>${esc(f.llegada)}<div style="${gris};font-size:11px">sale ${esc(f.sale)}</div></td>`
    + `<td ${td}>${chip(f.estado, f.aTiempo)}${f.jornada ? ` ${chip(f.jornada, false)}` : ""}</td>`
    + `<td ${td}>${f.confirmado ? "Sí" : "No"}</td>`
    + `</tr>`).join("")
  const tabla = `<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%"><tr>`
    + ["Pedido", "Viajes", "Camiones", "Comienza", "Termina", "Llega a obra", "Estado", "Conf."].map((h) => `<th ${th}>${h}</th>`).join("")
    + `</tr>${filas}</table>`
  const seccion = (t: string, cuerpo: string) => `<h3 style="font-size:14px;margin:18px 0 6px">${t}</h3>${cuerpo}`
  const avisos = d.avisos.length ? seccion("Avisos", d.avisos.map((a) => `<div style="font-size:12px;color:${a.nivel === "rojo" ? "#b91c1c" : a.nivel === "ambar" ? "#b45309" : "#6b7280"}">${esc(a.texto)}</div>`).join("")) : ""
  const arranque = seccion(`Arrancan${d.gpsHora ? ` (GPS de las ${esc(d.gpsHora)})` : ""}`,
    (d.gpsCaido ? `<div style="font-size:12px">${esc(TEXTO_GPS_CAIDO)}</div>` : d.arranque.map((x) => `<div style="font-size:12px">${esc(x)}</div>`).join(""))
    + (d.conviene ? `<div style="font-size:12px;margin-top:4px">${esc(d.conviene)}</div>` : ""))
  const link = linkDia(d.fecha)
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:680px;color:#111827">`
    + (d.prueba ? `<div style="background:#fee2e2;color:#991b1b;padding:6px 10px;font-size:12px;margin-bottom:10px">Mail de PRUEBA (preview): solo le llega a Bautista.</div>` : "")
    + (d.aviso ? `<div style="background:#fef3c7;color:#92400e;padding:6px 10px;font-size:12px;margin-bottom:10px">${esc(d.aviso)}</div>` : "")
    + (d.tipo === "actualizacion" ? `<div style="background:#fef3c7;border:1px solid #fcd34d;padding:8px 10px;font-size:13px;margin-bottom:10px"><b>Actualización ${d.n} (${aHora(r.min)}).</b> ${d.cambios.length ? `Cambió: ${esc(d.cambios.join(" · "))}.` : "Cambió el armado."}</div>` : "")
    + `<h2 style="font-size:18px;margin:0">Armado del ${esc(titulo)}</h2>`
    + `<div style="${gris};font-size:12px;margin-bottom:12px">Armado el ${esc(tituloDe(r.fecha))} a las ${aHora(r.min)}.</div>`
    + `<div style="font-size:13px;margin-bottom:4px">${esc(d.resumen)}</div>`
    + `<div style="${gris};font-size:12px">${esc(d.numeros)}</div>`
    + `<div style="${gris};font-size:12px;margin-bottom:6px">${esc(d.estado)}</div>`
    + seccion("Pedidos", tabla)
    + avisos
    + arranque
    + seccion("Traslados", `<div style="font-size:12px">${esc(d.traslados)}</div>${d.trasladoAConfirmar ? `<div style="font-size:12px;${gris}">Traslado a confirmar.</div>` : ""}`)
    + seccion("A la noche", `<div style="font-size:12px">${esc(d.noche)}</div>`)
    + seccion("Diagrama", diagramaHtml(d.diagrama, d.plantas))
    + `<div style="margin:20px 0"><a href="${esc(link)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:8px 14px;border-radius:6px;font-size:13px">Modificar en Programación › Día</a></div>`
    + `<div style="${gris};font-size:11px">Lo armó el sistema con los tiempos reales del GPS. Si algo cambia después de las 17:00, llega una actualización. produccionrebucret.com</div>`
    + `</div>`
  return { asunto, html }
}

/**
 * Los datos del mail a partir de la vista del día (las mismas funciones que la pantalla). `mas1` / `mas2`: los
 * escenarios para el resumen (+1/+2); `conviene`: pasar camiones esta noche según `dondeDuermen` de hoy.
 */
export function datosMailDeVista(v: VistaDia, o: {
  armadoEl: number; tipo: "dia" | "actualizacion"; n: number; cambios: string[]; prueba: boolean; aviso: string | null
  mas1: VistaDia["resultado"] | null; mas2: VistaDia["resultado"] | null; arranque: Amanecer[]; gpsCaido: boolean; gpsHora: string | null
  conviene: string | null; guardado: { por: string | null; at: string | null } | null
}): DatosMail {
  const pendientes = v.pedidos.filter((p) => p.status !== "completed")
  const conf = pendientes.filter((p) => p.confirmado_at).length
  const estado = o.guardado
    ? `Reparto guardado${o.guardado.por ? ` por ${o.guardado.por}` : ""}${o.guardado.at ? ` el ${relojAR(Date.parse(o.guardado.at)).fecha.slice(8, 10)}/${relojAR(Date.parse(o.guardado.at)).fecha.slice(5, 7)} ${hhDe(Date.parse(o.guardado.at))}` : ""} · ${conf} de ${pendientes.length} confirmados`
    : "Es la sugerencia: todavía no se guardó ni se confirmó."
  const conteo = contarTraslados(v.vigente, v.amanece)
  return {
    fecha: v.fecha, armadoEl: o.armadoEl, tipo: o.tipo, n: o.n, cambios: o.cambios, prueba: o.prueba, aviso: o.aviso,
    resumen: textoResumenDia(v.camiones.length, v.resultado, o.mas1, o.mas2).texto,
    numeros: v.numeros, estado, filas: v.filas,
    avisos: v.avisos.filter((a) => a.nivel !== "info" || !/^Traslado a confirmar/.test(a.texto)),
    arranque: o.arranque.map((a) => a.texto), gpsCaido: o.gpsCaido, gpsHora: o.gpsHora, conviene: o.conviene,
    traslados: lineaTraslados(v.resultado, conteo, v.traslado, v.nombres, v.patentes), trasladoAConfirmar: v.traslado.aConfirmar,
    noche: textoNoche(duermeDe(v), v.plantas),
    diagrama: bloquesDiagrama(v.resultado, v.camiones, v.nombres, v.obraDe),
    plantas: v.plantas.map((p) => ({ id: p.id, nombre: p.nombre })),
  }
}

// ---------------------------------------------------------------------------
// Resumen para el WhatsApp de Concretus (4.10)
// ---------------------------------------------------------------------------
export type ResumenReparto = {
  fecha: string
  camiones: number
  pedidos: { nombre: string; planta: string; viajes: number; camiones: number; comienza: string | null; termina: string | null; atraso_min: number | null; a_tiempo: boolean }[]
  traslados: string[]
  noche: string | null
}

/** "Duermen: 3 en Canning" / "Duermen: 2 en Canning y 1 en Hudson" (null sin camiones) */
export function nocheCorta(duerme: Record<string, string | null>, plantas: { id: string; nombre: string }[]): string | null {
  const cuenta = plantas.map((p) => ({ n: Object.values(duerme).filter((d) => d === p.id).length, nombre: p.nombre })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n || a.nombre.localeCompare(b.nombre))
  const sin = Object.values(duerme).filter((d) => !d).length
  const partes = [...cuenta.map((x) => `${x.n} en ${x.nombre}`), ...(sin ? [`${sin} a confirmar`] : [])]
  return partes.length ? `Duermen: ${lista(partes)}` : null
}

/** El JSON que lee Concretus: los mismos valores que la tabla y el mail (filasPedidos) */
export function resumenReparto(v: VistaDia): ResumenReparto {
  return {
    fecha: v.fecha,
    camiones: v.entrada.camiones.length,
    pedidos: v.filas.map((f) => ({ nombre: f.nombre, planta: f.planta, viajes: f.viajes, camiones: f.camiones.n, comienza: f.comienza, termina: f.termina, atraso_min: f.atrasoMin, a_tiempo: f.aTiempo })),
    traslados: trasladosCortos(v),
    noche: nocheCorta(duermeDe(v), v.plantas),
  }
}

/**
 * La ruta del resumen solo acepta su secreto propio (REPARTO_RESUMEN_SECRET), nunca el CRON_SECRET ni una sesión.
 * Sin el secreto cargado, nadie entra.
 */
export function autorizadoResumen(authorization: string | null | undefined, secreto: string | null | undefined): boolean {
  return !!secreto && authorization === `Bearer ${secreto}`
}

/** `fecha` obligatoria, AAAA-MM-DD y fecha real */
export function validarFechaResumen(fecha: string | null | undefined): { ok: true; fecha: string } | { ok: false; error: string } {
  if (!fecha) return { ok: false, error: "Falta la fecha (?fecha=AAAA-MM-DD)" }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { ok: false, error: "La fecha tiene que ser AAAA-MM-DD" }
  const d = new Date(`${fecha}T12:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== fecha) return { ok: false, error: "La fecha no existe" }
  return { ok: true, fecha }
}

// ---------------------------------------------------------------------------
// La línea del mail en la pantalla (4.7)
// ---------------------------------------------------------------------------
export function textoEstadoMail(e: EstadoMail | null, fecha: string, ahora: number, hayCambiosSinGuardar: boolean): string[] {
  const out: string[] = []
  const hoy = relojAR(ahora).fecha
  const envia = sumarDias(fecha, -1)
  if (!e || !e.envios) {
    if (e?.ultimo_error) out.push(`No se mandó: ${e.ultimo_error}.`)
    else if (hoy < envia) out.push(`Mail a ${lista(MAIL_ARMADO_A)} (copia a ${lista(MAIL_ARMADO_CC)}): sale el ${tituloDe(envia)} a las ${REGLAS_MAIL_ARMADO.hora}.`)
    else if (hoy === envia && relojAR(ahora).min < aMin(REGLAS_MAIL_ARMADO.hora)) out.push(`Mail a ${lista(MAIL_ARMADO_A)} (copia a ${lista(MAIL_ARMADO_CC)}): sale hoy a las ${REGLAS_MAIL_ARMADO.hora}.`)
    else out.push(`Mail a ${lista(MAIL_ARMADO_A)} (copia a ${lista(MAIL_ARMADO_CC)}): sale en la próxima pasada (cada ${REGLAS_MAIL_ARMADO.pasadaMin} min) si hay pedidos.`)
  } else {
    const primero = e.primer_envio_at ? Date.parse(e.primer_envio_at) : null
    const ultimo = e.ultimo_envio_at ? Date.parse(e.ultimo_envio_at) : null
    const diaCorto = (t: number) => { const f = relojAR(t).fecha; return `${tituloDe(f).slice(0, 3)} ${f.slice(8, 10)}/${f.slice(5, 7)}` }
    out.push(e.envios === 1 || !ultimo || !primero
      ? `Mail enviado ${primero ? `${diaCorto(primero)} ${hhDe(primero)}` : ""}.`
      : `Mail enviado ${hhDe(primero)} · actualización ${e.envios - 1} a las ${hhDe(ultimo)}.`)
    if (e.ultimo_error) out.push(`No se mandó: ${e.ultimo_error}.`)
    if (e.envios >= REGLAS_MAIL_ARMADO.maxEnvios) out.push(`Se mandaron ${e.envios} mails de este día: no se mandan más solos. Usá Enviar ahora.`)
    else if (e.huella_vista && e.huella_vista !== e.huella_enviada && e.vista_desde) {
      const paso = REGLAS_MAIL_ARMADO.pasadaMin * MIN
      const sale = Math.ceil((Date.parse(e.vista_desde) + REGLAS_MAIL_ARMADO.esperaMin * MIN) / paso) * paso
      out.push(`Hay cambios desde el último mail: sale una actualización a las ~${hhDe(sale)} si no cambia nada más.`)
    }
  }
  if (hayCambiosSinGuardar) out.push("Los cambios sin guardar no van al mail.")
  return out
}

export { horaArgentina }
