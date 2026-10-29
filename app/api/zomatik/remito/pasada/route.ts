/**
 * Zomatik Z1 · Pasada de la noche (16.3): remite lo del día que quedó sin remitir (pedidos finalizados o no) y trabaja
 * lo pendiente. Solo el cron, con `Authorization: Bearer <CRON_SECRET>`. Con la llave de remitir apagada no hace nada.
 */
import { NextResponse } from "next/server"
import { respuestaError } from "@/lib/auth/servidor"
import { esLlamadaDeCron } from "@/lib/cron"
import { pasadaZ1, procesarZ1 } from "@/lib/zomatik/z1-servidor"

export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET(req: Request) {
  const inicio = Date.now()
  try {
    if (!process.env.CRON_SECRET || !esLlamadaDeCron(req)) return NextResponse.json({ error: "Solo el cron (con CRON_SECRET)." }, { status: 401 })
    const pasada = await pasadaZ1("sistema (pasada de remitos)")
    const proceso = await procesarZ1({ usuario: "sistema (pasada de remitos)", inicio })
    return NextResponse.json({ ok: true, pasada, proceso })
  } catch (e) {
    return respuestaError(e)
  }
}
