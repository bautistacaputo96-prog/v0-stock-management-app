/**
 * Control de ingresos de materia prima · correr el control.
 *
 *   GET  cron diario de Vercel, 16:05 de Argentina (19:05 UTC): lee Zomatik (incluye lo cargado ese día), cruza y manda
 *        el mail a Juan Oreguy con copia a Bautista (si hay diferencias abiertas; una vez por día).
 *   POST botón "Controlar ahora" (gerencial o materia_prima.editar): lee Zomatik y cruza, sin mail.
 *
 * Freno en la base (control_mp_registrar): uno a la vez, a mano cada 2 min, el cron una vez por hora. Solo lee de
 * Zomatik (lista cerrada) y nunca escribe en stock_entries. Docs: docs/control-ingresos-mp.md.
 */
import { NextResponse } from "next/server"
import { exigirSesion, modoPruebaLocal, respuestaModoLocal, respuestaError, sbServicio } from "@/lib/auth/servidor"
import { esLlamadaDeCron } from "@/lib/cron"
import { controlar, puedeControlar } from "@/lib/control-ingresos/servidor"

export const dynamic = "force-dynamic"
export const maxDuration = 60

async function correr(origen: "cron" | "manual", usuario: string | null, t0: number) {
  const sb = sbServicio()
  const { data: reg, error } = await sb.rpc("control_mp_registrar", { p_origen: origen, p_usuario: usuario })
  if (error) return NextResponse.json({ ok: false, error: "Falta aplicar la migración del control (202610271900)." }, { status: 500 })
  if ((reg as any)?.motivo) return NextResponse.json({ ok: false, error: (reg as any).motivo }, { status: 429 })
  const r = await controlar(sb, { corridaId: (reg as any).id, leer: true, mail: origen === "cron", t0 })
  return NextResponse.json(r, { status: r.ok ? 200 : 502 })
}

export async function GET(req: Request) {
  const t0 = Date.now()
  if (modoPruebaLocal()) return respuestaModoLocal()
  try {
    if (!esLlamadaDeCron(req)) return NextResponse.json({ error: "Solo el cron diario." }, { status: 401 })
    return await correr("cron", null, t0)
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
    if (!puedeControlar(r.sesion.usuario)) return NextResponse.json({ error: "No tenés permiso para el control con Zomatik." }, { status: 403 })
    return await correr("manual", r.sesion.usuario.name, t0)
  } catch (e) {
    return respuestaError(e)
  }
}
