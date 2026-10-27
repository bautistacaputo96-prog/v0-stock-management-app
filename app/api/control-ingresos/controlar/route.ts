/**
 * Control de ingresos de materia prima · correr el control.
 *
 *   GET  cron diario de Vercel, 16:25 de Argentina (19:25 UTC; Hobby puede correrlo hasta las 16:59): lee Zomatik
 *        (incluye lo cargado ese día), cruza y manda el mail a Juan Oreguy con copia a Bautista (si hay diferencias
 *        abiertas; una vez por día). Si hay un "Controlar ahora" en curso, espera hasta 90 s.
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
// Como Concretus con este mismo listado en Hobby (Fluid compute): la lectura termina a los 220 s (servidor.ts)
export const maxDuration = 300

async function correr(origen: "cron" | "manual", usuario: string | null, t0: number) {
  const sb = sbServicio()
  let { data: reg, error } = await sb.rpc("control_mp_registrar", { p_origen: origen, p_usuario: usuario })
  // El cron no se pierde por un "Controlar ahora" en curso: espera a que termine (hasta 90 s)
  while (origen === "cron" && !error && /Ya se está controlando/.test((reg as any)?.motivo || "") && Date.now() - t0 < 90_000) {
    await new Promise((r) => setTimeout(r, 5_000))
    ;({ data: reg, error } = await sb.rpc("control_mp_registrar", { p_origen: origen, p_usuario: usuario }))
  }
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
