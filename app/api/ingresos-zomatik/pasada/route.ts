/**
 * Ingresos de materia prima desde Zomatik · la pasada (docs/ingresos-mp-zomatik.md).
 *
 *   GET  pg_cron (Bearer cron_secret de Vault): cada 30 min a los :05 y :35 de 06:05 a 20:35 (últimos 15 días) y a las
 *        05:05 con `?completa=1` (la ventana del control). Entre las 16:00 y las 16:59 no corre: es la hora del control
 *        diario (que también importa después de leer).
 *   POST botón "Traer de Zomatik" (gerencial o materia_prima.editar): la pasada corta, como mucho una cada 2 min
 *        (origen 'traer' en control_mp_corridas: no se muestra como control).
 *
 * Freno en la base (control_mp_registrar): nunca dos corridas a la vez; la pasada, una cada 20 min. Solo lee de Zomatik
 * (lista cerrada). Con la importación apagada solo lee; en sombra arma el plan sin escribir; en real lo aplica.
 */
import { NextResponse } from "next/server"
import { exigirSesion, modoPruebaLocal, respuestaModoLocal, respuestaError, sbServicio } from "@/lib/auth/servidor"
import { esLlamadaDeCron } from "@/lib/cron"
import { puedeControlar } from "@/lib/control-ingresos/servidor"
import { enHorarioDelCron, MENSAJE_HORARIO_CRON } from "@/lib/control-stock/calculo"
import { pasada } from "@/lib/ingresos-zomatik/servidor"

export const dynamic = "force-dynamic"
// La corta lee 50 s; la completa de la noche usa el presupuesto del control (220 s)
export const maxDuration = 300

export async function GET(req: Request) {
  const t0 = Date.now()
  if (modoPruebaLocal()) return respuestaModoLocal()
  try {
    if (!esLlamadaDeCron(req)) return NextResponse.json({ error: "Solo el cron." }, { status: 401 })
    if (enHorarioDelCron(t0)) return NextResponse.json({ ok: true, salteada: MENSAJE_HORARIO_CRON })
    const completa = new URL(req.url).searchParams.get("completa") === "1"
    const r = await pasada(sbServicio(), { completa, origen: "pasada", usuario: null, t0 })
    return NextResponse.json(r, { status: r.ok || r.ocupado ? 200 : 502 })
  } catch (e) {
    return respuestaError(e)
  }
}

export async function POST() {
  const t0 = Date.now()
  if (modoPruebaLocal()) return respuestaModoLocal()
  try {
    const r = await exigirSesion()
    if (r.respuesta) return r.respuesta
    if (!puedeControlar(r.sesion.usuario)) return NextResponse.json({ error: "No tenés permiso para traer de Zomatik." }, { status: 403 })
    if (enHorarioDelCron(t0)) return NextResponse.json({ ok: false, mensaje: "Entre las 16 y las 17 se actualiza solo." }, { status: 409 })
    // Origen propio ('traer'): no cuenta como "Controlar ahora" ni como la pasada automática
    const p = await pasada(sbServicio(), { completa: false, origen: "traer", usuario: r.sesion.usuario.name, t0 })
    const imp = p.importacion
    let mensaje: string
    if (p.ocupado) mensaje = "Zomatik está ocupado. Probá en un rato."
    else if (!p.ok && (p.motivo || p.lectura?.error || imp?.motivo)) mensaje = p.motivo || imp?.motivo || p.lectura?.error || "No se pudo traer de Zomatik."
    else if (imp?.modo === "real") {
      const n = (imp.resumen?.nuevos ?? 0) + (imp.resumen?.emparejados ?? 0)
      mensaje = n ? `Listo: ${n} ${n === 1 ? "ingreso nuevo" : "ingresos nuevos"}` : "Sin novedades"
    } else if (imp?.modo === "sombra") mensaje = `Prueba (no se cargó nada): ${imp.texto || "sin novedades"}`
    else mensaje = "Se leyó Zomatik (la importación está apagada)."
    return NextResponse.json({ ok: p.ok, mensaje, importacion: imp ?? null }, { status: p.ok || p.ocupado ? 200 : 502 })
  } catch (e) {
    return respuestaError(e)
  }
}
