/**
 * Zomatik Z2 · Pasada de las NP: sincroniza los pedidos de hoy en adelante (plantas con la llave prendida) y trabaja
 * las NP pendientes, las de un "Grabar" cortado (primero se busca la marca) y las que hay que vaciar.
 *
 *   GET  /api/zomatik/np/procesar   cron: solo con `Authorization: Bearer <CRON_SECRET>` (lib/cron.ts). Cada 10 min
 *                                   desde un programador externo o pg_cron (pregunta 24.8.3); Vercel Hobby solo deja
 *                                   el cron diario de vercel.json.
 *   POST /api/zomatik/np/procesar   Programación abierta (cada 10 min, con sesión y programacion.cargar). Como mucho
 *                                   una pasada cada 9 min entre todos.
 */
import { NextResponse } from "next/server"
import { exigirSesion, respuestaError, respuestaModoLocal, sbServicio } from "@/lib/auth/servidor"
import { puedeCon } from "@/lib/permisos"
import { esLlamadaDeCron } from "@/lib/cron"
import { faltaMigracion, pasadaNp, procesarNp } from "@/lib/zomatik/np-servidor"

export const dynamic = "force-dynamic"
export const maxDuration = 60

const CLAVE = "zomatik_np_pasada"
const ENTRE_PASADAS_MS = 9 * 60_000

async function correr(usuario: string, frenar: boolean) {
  const sb = sbServicio()
  if (frenar) {
    const { data } = await sb.from("integraciones").select("actualizado").eq("clave", CLAVE).maybeSingle()
    const ultima = (data as { actualizado?: string } | null)?.actualizado
    if (ultima && Date.now() - Date.parse(ultima) < ENTRE_PASADAS_MS) return NextResponse.json({ saltada: true })
  }
  await sb.from("integraciones").upsert({ clave: CLAVE, valor: usuario, actualizado: new Date().toISOString(), conectado_por: "sistema" } as never, { onConflict: "clave" })
  try {
    const pasada = await pasadaNp(usuario)
    const proceso = await procesarNp({ usuario, presupuestoMs: 40_000 })
    return NextResponse.json({ ok: true, pasada, proceso })
  } catch (e) {
    if (faltaMigracion(e)) return NextResponse.json({ ok: false, sinMigracion: true })
    throw e
  }
}

export async function GET(req: Request) {
  try {
    if (!process.env.CRON_SECRET || !esLlamadaDeCron(req)) return NextResponse.json({ error: "Solo el cron (con CRON_SECRET)." }, { status: 401 })
    return await correr("sistema (pasada de NP)", false)
  } catch (e) {
    return respuestaError(e)
  }
}

export async function POST() {
  try {
    const r = await exigirSesion()
    if (r.respuesta) return r.respuesta
    if (r.sesion.local) return respuestaModoLocal()
    if (!puedeCon(r.sesion.usuario, "programacion", "cargar")) return NextResponse.json({ error: "No tenés permiso." }, { status: 403 })
    return await correr(r.sesion.usuario.name, true)
  } catch (e) {
    return respuestaError(e)
  }
}
