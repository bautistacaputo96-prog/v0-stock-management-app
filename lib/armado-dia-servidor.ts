/**
 * Mail del armado del día y resumen para WhatsApp: la parte del servidor (lee la base y el GPS, manda y guarda el
 * estado). Lo puro está en lib/armado-dia.ts. Docs: docs/specs/2026-11-05-dia-unificado-y-mail.md, fase B.
 *
 *   pasada(sb, ahora)        la del cron (pg_cron cada 5 min y Vercel una vez por día de respaldo)
 *   verMail(sb, fecha)       el HTML que saldría ahora (no manda ni escribe nada)
 *   enviarAhora(…)           "Enviar ahora" (en el preview, solo a Bautista y sin escribir nada)
 *   vistaParaResumen(sb, …)  el mismo cálculo que el mail, para /api/reparto/resumen (solo lee)
 * Todo usa leerDatosDia + armarVistaDia (lib/reparto-dia.ts): la pantalla, el mail y Concretus dicen lo mismo.
 */
import { leerDatosDia, armarVistaDia, type VistaDia, type DatosDia } from "@/lib/reparto-dia"
import { escenarioConMas, cargarReparto } from "@/lib/reparto"
import { leerPosicionesCamiones, type CamionGps } from "@/lib/gps-camiones"
import { mailsPorNombre, enviarMail } from "@/lib/mail-servidor"
import {
  REGLAS_MAIL_ARMADO, MAIL_ARMADO_A, MAIL_ARMADO_CC, MAIL_ARMADO_PRUEBA, FROM_ARMADO, fechaObjetivo, tomaPendiente, decidirEnvio,
  amanecerDe, contenidoArmado, huellaDe, cambiosEntre, destinatarios, armarMailArmado, datosMailDeVista, estadoVacio, relojAR, sumarDias,
  type EstadoMail, type Amanecer, type ContenidoArmado, type Desaparecido,
} from "@/lib/armado-dia"
import { aHora } from "@/lib/planificador"

type Sb = any

async function plantasDe(sb: Sb): Promise<{ id: string; name: string }[]> {
  const { data } = await sb.from("plants").select("id, name").order("name")
  return (data || []) as { id: string; name: string }[]
}

async function leerEstado(sb: Sb, fecha: string): Promise<EstadoMail> {
  const { data } = await sb.from("armado_mail").select("*").eq("fecha", fecha).maybeSingle()
  return data ? { ...estadoVacio(fecha), ...(data as any) } : estadoVacio(fecha)
}
async function guardarEstado(sb: Sb, fecha: string, cambios: Record<string, unknown>) {
  await sb.from("armado_mail").update({ ...cambios, updated_at: new Date().toISOString() }).eq("fecha", fecha)
}

// ---------------------------------------------------------------------------
// Dónde amanecen (4.3)
// ---------------------------------------------------------------------------
export type TomaGps = { amanecer: Amanecer[]; gpsCaido: boolean; hora: string }

/**
 * Lee el GPS y decide dónde arranca cada camión el día `fecha`. `guardar`: reemplaza las filas de amanecer_camiones
 * de esa fecha (la pasada y "Enviar ahora" en producción; nunca el resumen ni el preview).
 */
export async function tomarGps(sb: Sb, fecha: string, opts: { guardar: boolean; ahora?: number }): Promise<TomaGps> {
  const ahora = opts.ahora ?? Date.now()
  const [plantas, { data: ms }, repartoHoy] = await Promise.all([
    plantasDe(sb),
    sb.from("mixers").select("id, license_plate").eq("active", true).order("license_plate"),
    cargarReparto(sb, sumarDias(fecha, -1)),
  ])
  const nombres = Object.fromEntries(plantas.map((p) => [p.id, p.name]))
  let gps: { conectado: boolean; camiones: CamionGps[]; plantaUltimoDespacho: Record<string, string | null> } | null = null
  try { gps = await leerPosicionesCamiones(sb, { soloLectura: !opts.guardar }) } catch { gps = null }
  const gpsCaido = !gps || !gps.conectado
  const amanecer = ((ms || []) as { id: string; license_plate: string }[]).map((m) => {
    const r = repartoHoy.reparto?.[m.id]
    return amanecerDe({
      mixerId: m.id, patente: m.license_plate, gpsCaido, nombres, ahora,
      gps: gps?.camiones.find((c) => c.mixer_id === m.id) || null,
      repartoHoy: r ? { duerme: r.duerme, terminaEn: r.sale && r.tramos.length ? r.tramos[r.tramos.length - 1].plantId : null } : null,
      ultimoDespachoPlanta: gps?.plantaUltimoDespacho[m.id] ?? null,
    })
  })
  if (opts.guardar) {
    const { error } = await sb.from("amanecer_camiones").delete().eq("fecha", fecha)
    if (!error && amanecer.length) {
      await sb.from("amanecer_camiones").insert(amanecer.map((a) => ({ fecha, ...a, tomado_at: new Date(ahora).toISOString() })))
    }
  }
  return { amanecer, gpsCaido, hora: aHora(relojAR(ahora).min) }
}

const mapaAmanecer = (t: TomaGps) => Object.fromEntries(t.amanecer.map((a) => [a.mixer_id, a.plant_id]))

/** El día armado, con dónde arranca cada camión según `toma` (si viene) o lo guardado */
async function vistaCon(sb: Sb, fecha: string, toma: TomaGps | null): Promise<{ datos: DatosDia; vista: VistaDia }> {
  const datos = await leerDatosDia(sb, fecha, await plantasDe(sb))
  const vista = armarVistaDia(datos, toma ? { amanece: mapaAmanecer(toma) } : {})
  return { datos, vista }
}

const guardadoDe = (datos: DatosDia) => (datos.guardado?.reparto ? { por: datos.guardado.actualizadoPor, at: datos.guardado.actualizado } : null)

/**
 * El mismo cálculo que el mail, para el resumen de WhatsApp: el reparto guardado (o la sugerencia) y dónde arranca cada
 * camión según la toma del GPS guardada; si todavía no hay toma, el GPS en el momento, sin guardarlo. Solo lee.
 */
export async function vistaParaResumen(sb: Sb, fecha: string): Promise<VistaDia> {
  const datos = await leerDatosDia(sb, fecha, await plantasDe(sb))
  if (datos.amanecer?.length) return armarVistaDia(datos)
  const toma = await tomarGps(sb, fecha, { guardar: false })
  return armarVistaDia(datos, { amanece: mapaAmanecer(toma) })
}

// ---------------------------------------------------------------------------
// Armar y mandar
// ---------------------------------------------------------------------------
/** "Conviene pasar esta noche: AE402HE a Canning (mañana Canning arranca con 3)." (de dondeDuermen de hoy) */
async function convieneDeHoy(sb: Sb, fecha: string): Promise<string | null> {
  try {
    const datos = await leerDatosDia(sb, sumarDias(fecha, -1), await plantasDe(sb))
    const v = armarVistaDia(datos)
    if (!v.noche.movidos.length) return null
    const partes = v.noche.movidos.map((id) => `${v.patentes[id]} a ${v.nombres[v.noche.duerme[id] || ""]} (mañana ${v.nombres[v.noche.duerme[id] || ""]} arranca con ${v.noche.arranca[v.noche.duerme[id] || ""]})`)
    return `Conviene pasar esta noche: ${partes.join(", ")}.`
  } catch {
    return null
  }
}

/** Qué pasó con los pedidos que estaban en el mail anterior y ya no están */
async function desaparecidosDe(sb: Sb, ant: ContenidoArmado | null, act: ContenidoArmado): Promise<Record<string, Desaparecido>> {
  const ids = (ant?.pedidos || []).map((p) => p.id).filter((id) => !act.pedidos.some((x) => x.id === id))
  if (!ids.length) return {}
  const { data } = await sb.from("scheduled_dispatches").select("id, status, scheduled_arrival_time").in("id", ids)
  return Object.fromEntries(ids.map((id) => {
    const p = ((data || []) as any[]).find((x) => x.id === id)
    if (!p) return [id, "no_esta"]
    if (p.status === "cancelled") return [id, "cancelado"]
    if (p.status === "completed") return [id, "completado"]
    return [id, relojAR(Date.parse(p.scheduled_arrival_time)).fecha !== act.fecha ? "otro_dia" : "no_esta"]
  }))
}

type Armado = { asunto: string; html: string; contenido: ContenidoArmado; huella: string; aviso: string | null; error: string | null; to: string[]; cc: string[] }

/** Arma el mail de una fecha con la vista dada (con los escenarios +1/+2 para el resumen) */
async function armarMail(sb: Sb, datos: DatosDia, vista: VistaDia, o: { estado: EstadoMail; tipo: "dia" | "actualizacion"; prueba: boolean; toma: TomaGps | null; ahora: number; gpsNota?: string }): Promise<Armado> {
  const contenido = contenidoArmado(vista, guardadoDe(datos))
  const huella = huellaDe(contenido)
  const cambios = o.tipo === "actualizacion" ? cambiosEntre(o.estado.contenido_enviado, contenido, { desaparecidos: await desaparecidosDe(sb, o.estado.contenido_enviado, contenido), tomaGpsAt: o.toma ? new Date(o.ahora).toISOString() : null }) : []
  const mails = await mailsPorNombre(sb, [...MAIL_ARMADO_A, ...MAIL_ARMADO_CC, ...MAIL_ARMADO_PRUEBA])
  const dest = destinatarios(o.prueba, mails)
  const mas1 = escenarioConMas(vista.entrada, 1)?.resultado ?? null
  const mas2 = escenarioConMas(vista.entrada, 2)?.resultado ?? null
  const arranque: Amanecer[] = o.toma?.amanecer || (datos.amanecer || []).map((a) => ({ mixer_id: a.mixer_id, plant_id: a.plant_id, fuente: a.fuente as any, estado_gps: null, lat: null, lng: null, km_planta: null, posicion_at: null, texto: a.texto }))
  const { asunto, html } = armarMailArmado(datosMailDeVista(vista, {
    armadoEl: o.ahora, tipo: o.tipo, n: o.tipo === "actualizacion" ? Math.max(1, o.estado.envios) : 0, cambios, prueba: o.prueba, aviso: dest.aviso,
    mas1, mas2, arranque: arranque.length ? arranque : [{ mixer_id: "", plant_id: null, fuente: "sin_dato", estado_gps: null, lat: null, lng: null, km_planta: null, posicion_at: null, texto: o.gpsNota || "Todavía no se tomó el GPS: se toma dónde duermen según el reparto de hoy." }],
    gpsCaido: !!o.toma?.gpsCaido, gpsHora: o.toma?.hora ?? null, conviene: await convieneDeHoy(sb, vista.fecha), guardado: guardadoDe(datos),
  }))
  return { asunto, html, contenido, huella, aviso: dest.aviso, error: dest.error, to: dest.to, cc: dest.cc }
}

/** Manda y deja el estado (envíos, huella enviada, a quién, error) */
async function mandarYAnotar(sb: Sb, fecha: string, estado: EstadoMail, m: Armado, ahora: number): Promise<{ ok: boolean; error?: string }> {
  if (m.error) { await guardarEstado(sb, fecha, { ultimo_error: m.error }); return { ok: false, error: m.error } }
  const r = await enviarMail({ from: FROM_ARMADO(), to: m.to, cc: m.cc, subject: m.asunto, html: m.html })
  if (!r.ok) { await guardarEstado(sb, fecha, { ultimo_error: r.error || "no se pudo mandar" }); return { ok: false, error: r.error } }
  const iso = new Date(ahora).toISOString()
  await guardarEstado(sb, fecha, {
    envios: estado.envios + 1, primer_envio_at: estado.primer_envio_at || iso, ultimo_envio_at: iso,
    huella_enviada: m.huella, contenido_enviado: m.contenido, huella_vista: m.huella, vista_desde: iso, a: [...m.to, ...m.cc], ultimo_error: null,
  })
  return { ok: true }
}

/** La pasada del cron: toma del GPS si toca, decide y, si corresponde, manda (4.1). */
export async function pasada(sb: Sb, ahora: number = Date.now()): Promise<Record<string, unknown>> {
  const fecha = fechaObjetivo(ahora)
  if (!fecha) return { ok: true, motivo: "fuera de horario" }
  const { data: mia, error } = await sb.rpc("armado_mail_tomar", { p_fecha: fecha, p_quien: "pasada", p_segundos: 120 })
  if (error) return { ok: false, error: "Falta aplicar la migración del mail del armado (202611051200)." }
  if (!mia) return { ok: true, fecha, motivo: "otra pasada en curso" }
  try {
    const estado = await leerEstado(sb, fecha)
    const toma = tomaPendiente(estado, ahora)
    let gps: TomaGps | null = null
    if (toma) {
      gps = await tomarGps(sb, fecha, { guardar: true, ahora })
      await guardarEstado(sb, fecha, toma === "primera" ? { toma_gps_at: new Date(ahora).toISOString() } : { toma_gps_2_at: new Date(ahora).toISOString() })
    }
    const { datos, vista } = await vistaCon(sb, fecha, gps)
    const huella = huellaDe(contenidoArmado(vista, guardadoDe(datos)))
    const d = decidirEnvio(estado, ahora, huella, vista.filas.length > 0)
    if (d.anotarVista) await guardarEstado(sb, fecha, { huella_vista: huella, vista_desde: new Date(ahora).toISOString() })
    if (d.accion !== "enviar") return { ok: true, fecha, accion: d.accion, motivo: d.motivo }
    // Antes de mandar, el GPS de nuevo (a la noche ya dice más) y el mail con +1/+2
    const gps2 = await tomarGps(sb, fecha, { guardar: true, ahora })
    const v2 = await vistaCon(sb, fecha, gps2)
    const m = await armarMail(sb, v2.datos, v2.vista, { estado, tipo: d.tipo!, prueba: false, toma: gps2, ahora })
    const r = await mandarYAnotar(sb, fecha, estado, m, ahora)
    return { ok: r.ok, fecha, accion: "enviar", tipo: d.tipo, error: r.error }
  } finally {
    await guardarEstado(sb, fecha, { enviando_hasta: null })
  }
}

/** "Ver el mail": lo que saldría ahora. No manda ni escribe nada (GPS en el momento solo si se pide y no hay toma). */
export async function verMail(sb: Sb, fecha: string, opts: { gps: boolean; prueba: boolean }): Promise<{ asunto: string; html: string }> {
  const datos0 = await leerDatosDia(sb, fecha, await plantasDe(sb))
  const toma = opts.gps && !datos0.amanecer?.length ? await tomarGps(sb, fecha, { guardar: false }) : null
  const vista = armarVistaDia(datos0, toma ? { amanece: mapaAmanecer(toma) } : {})
  const estado = await leerEstado(sb, fecha).catch(() => estadoVacio(fecha))
  const m = await armarMail(sb, datos0, vista, { estado, tipo: estado.envios > 0 ? "actualizacion" : "dia", prueba: opts.prueba, toma, ahora: Date.now(), gpsNota: opts.gps ? undefined : "GPS no disponible en local." })
  return { asunto: m.asunto, html: m.html }
}

/**
 * "Enviar ahora": sin antirrebote ni horario. Cuenta como envío y deja la huella enviada (si nada cambia, el cron no
 * vuelve a mandar). En el preview (`prueba`): solo a Bautista, con [PRUEBA], y no escribe nada.
 */
export async function enviarAhora(sb: Sb, fecha: string, usuario: string, opts: { prueba: boolean }): Promise<{ ok: boolean; error?: string; a?: string[] }> {
  const ahora = Date.now()
  if (opts.prueba) {
    const datos0 = await leerDatosDia(sb, fecha, await plantasDe(sb))
    const toma = await tomarGps(sb, fecha, { guardar: false, ahora })
    const vista = armarVistaDia(datos0, { amanece: mapaAmanecer(toma) })
    const estado = await leerEstado(sb, fecha).catch(() => estadoVacio(fecha))
    const m = await armarMail(sb, datos0, vista, { estado, tipo: estado.envios > 0 ? "actualizacion" : "dia", prueba: true, toma, ahora })
    if (m.error) return { ok: false, error: m.error }
    const r = await enviarMail({ from: FROM_ARMADO(), to: m.to, subject: m.asunto, html: m.html })
    return r.ok ? { ok: true, a: m.to } : { ok: false, error: r.error }
  }
  const { data: mia, error } = await sb.rpc("armado_mail_tomar", { p_fecha: fecha, p_quien: usuario, p_segundos: 120 })
  if (error) return { ok: false, error: "Falta aplicar la migración del mail del armado (202611051200)." }
  if (!mia) return { ok: false, error: "Se está mandando el mail de este día en este momento. Probá en un minuto." }
  try {
    const estado = await leerEstado(sb, fecha)
    const toma = await tomarGps(sb, fecha, { guardar: true, ahora })
    if (!estado.toma_gps_at) await guardarEstado(sb, fecha, { toma_gps_at: new Date(ahora).toISOString() })
    const { datos, vista } = await vistaCon(sb, fecha, toma)
    const m = await armarMail(sb, datos, vista, { estado, tipo: estado.envios > 0 ? "actualizacion" : "dia", prueba: false, toma, ahora })
    const r = await mandarYAnotar(sb, fecha, estado, m, ahora)
    if (r.ok) {
      await sb.from("activity_log").insert({
        user_name: usuario, action: "crear", entity: "armado_mail", entity_id: fecha, reference: fecha, plant_id: null,
        details: { Mail: m.asunto, A: [...m.to, ...m.cc].join(", "), Origen: "Enviar ahora" },
      })
    }
    return { ...r, a: r.ok ? [...m.to, ...m.cc] : undefined }
  } finally {
    await guardarEstado(sb, fecha, { enviando_hasta: null })
  }
}

export { REGLAS_MAIL_ARMADO }
