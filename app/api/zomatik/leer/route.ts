/**
 * Zomatik Z0 · Lectura de Zomatik (solo lectura): clientes, artículos, proyectos con su remitido y NP pendientes.
 *
 *   GET  /api/zomatik/leer   cron diario de Vercel (03:30 en Argentina), o un gerencial con sesión
 *   POST /api/zomatik/leer   botón "Actualizar" (solo gerenciales)
 *
 * Las llamadas del cron pasan sin sesión: con CRON_SECRET en Vercel, solo con `Authorization: Bearer …`; sin él,
 * por el header x-vercel-cron como /api/gps/reconstruir (lib/cron.ts). El resto pide sesión de gerencial.
 * Además, freno en la base (zomatik_lectura_registrar,
 * con candado): una lectura a la vez, "Actualizar" como mucho cada 5 min y el cron una vez por hora (el header
 * del cron se puede falsificar). Cada lectura queda en zomatik_lecturas con su resultado.
 *
 * No escribe nada en Zomatik. Escribe solo las copias zomatik_* (ver lib/zomatik/lectura.ts).
 */
import { NextResponse } from "next/server"
import { exigirGerencial, modoPruebaLocal, respuestaModoLocal, respuestaError, sbServicio } from "@/lib/auth/servidor"
import { leerZomatik } from "@/lib/zomatik/lectura"
import { esLlamadaDeCron } from "@/lib/cron"

export const dynamic = "force-dynamic"
export const maxDuration = 60

async function correr(origen: "cron" | "manual", usuario: string | null) {
  const sb = sbServicio()
  const { data: reg, error } = await sb.rpc("zomatik_lectura_registrar", { p_origen: origen, p_usuario: usuario })
  if (error) return NextResponse.json({ ok: false, error: "Falta aplicar la migración de Zomatik (zomatik_lectura_registrar)" }, { status: 500 })
  if ((reg as any)?.motivo) return NextResponse.json({ ok: false, error: (reg as any).motivo }, { status: 429 })
  const id = (reg as any)?.id as string
  let resultado
  try {
    resultado = await leerZomatik()
  } catch (e: any) {
    resultado = { ok: false, partes: {}, errores: [e?.message || "Error leyendo Zomatik"], ms: 0 }
  }
  await sb
    .from("zomatik_lecturas")
    .update({
      fin: new Date().toISOString(),
      ok: resultado.ok,
      resultado: { partes: resultado.partes, ms: resultado.ms },
      error: resultado.errores.length ? resultado.errores.join(" · ").slice(0, 2000) : null,
    })
    .eq("id", id)
  return NextResponse.json({ ok: resultado.ok, partes: resultado.partes, errores: resultado.errores, ms: resultado.ms }, { status: resultado.ok ? 200 : 502 })
}

export async function GET(req: Request) {
  if (modoPruebaLocal()) return respuestaModoLocal()
  try {
    if (esLlamadaDeCron(req)) return await correr("cron", null)
    const r = await exigirGerencial()
    if (r.respuesta) return r.respuesta
    return await correr("manual", r.sesion.usuario.name)
  } catch (e) {
    return respuestaError(e)
  }
}

export async function POST() {
  if (modoPruebaLocal()) return respuestaModoLocal()
  try {
    const r = await exigirGerencial()
    if (r.respuesta) return r.respuesta
    return await correr("manual", r.sesion.usuario.name)
  } catch (e) {
    return respuestaError(e)
  }
}
