/**
 * Mail del armado del día siguiente (docs/specs/2026-11-05-dia-unificado-y-mail.md, 4.1).
 *
 *   GET  la pasada: pg_cron cada 5 min (job armado-dia-pasada) y, de respaldo, el cron de Vercel a las 17:05 de
 *        Argentina. De 06:00 a 16:59 termina enseguida. Solo con el Bearer del cron.
 *   POST { fecha, accion: "ver" | "enviar" } con sesión: "Ver el mail" (programacion.ver; no manda ni escribe) y
 *        "Enviar ahora" (programacion.editar). Fuera de producción, "Enviar ahora" manda solo a Bautista con
 *        "[PRUEBA]" y no escribe nada. En el modo prueba local, "Ver el mail" anda sin GPS y "Enviar" no.
 */
import { NextResponse } from "next/server"
import { exigirSesion, modoPruebaLocal, respuestaModoLocal, respuestaError, sbServicio } from "@/lib/auth/servidor"
import { esLlamadaDeCron } from "@/lib/cron"
import { puedeCon } from "@/lib/permisos"
import { pasada, verMail, enviarAhora } from "@/lib/armado-dia-servidor"
import { validarFechaResumen } from "@/lib/armado-dia"

export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET(req: Request) {
  if (modoPruebaLocal()) return respuestaModoLocal()
  try {
    if (!esLlamadaDeCron(req)) return NextResponse.json({ error: "Solo el cron." }, { status: 401 })
    return NextResponse.json(await pasada(sbServicio(), Date.now()))
  } catch (e) {
    return respuestaError(e)
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const accion = body?.accion === "enviar" ? "enviar" : body?.accion === "ver" ? "ver" : null
    if (!accion) return NextResponse.json({ error: "Falta la acción (ver o enviar)." }, { status: 400 })
    const f = validarFechaResumen(body?.fecha)
    if (!f.ok) return NextResponse.json({ error: f.error }, { status: 400 })
    const local = !!modoPruebaLocal()
    if (local && accion === "enviar") return respuestaModoLocal()
    const r = await exigirSesion()
    if (r.respuesta) return r.respuesta
    const usuario = r.sesion.usuario
    const prueba = process.env.VERCEL_ENV !== "production"
    if (accion === "ver") {
      if (!puedeCon(usuario, "programacion", "ver")) return NextResponse.json({ error: "No tenés permiso para ver la programación." }, { status: 403 })
      return NextResponse.json(await verMail(sbServicio(), f.fecha, { gps: !local, prueba }))
    }
    if (!puedeCon(usuario, "programacion", "editar")) return NextResponse.json({ error: "Mandar el mail del armado es de quien programa (programacion.editar)." }, { status: 403 })
    const res = await enviarAhora(sbServicio(), f.fecha, usuario.name, { prueba })
    return NextResponse.json({ ...res, prueba }, { status: res.ok ? 200 : 502 })
  } catch (e) {
    return respuestaError(e)
  }
}
