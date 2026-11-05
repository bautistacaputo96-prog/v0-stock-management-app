import { NextResponse } from "next/server"
import { sbAdmin } from "@/lib/wialon"
import { leerPosicionesCamiones } from "@/lib/gps-camiones"
import { exigirSesion, respuestaError } from "@/lib/auth/servidor"

export const dynamic = "force-dynamic"

/**
 * Posición actual de los mixers, cruzada con nuestros datos:
 * patente → mixer, último despacho del día (obra, remito, hora de salida) y un estado simple.
 */
export async function GET() {
  // Solo con sesión iniciada en la app (las posiciones de los camiones no son públicas). La usan Logística › En vivo
  // y Despacho; ningún cron ni Concretus la llama.
  let soloLectura = false
  try {
    const r = await exigirSesion()
    if (r.respuesta) return r.respuesta
    soloLectura = r.sesion.local
  } catch (e) {
    return respuestaError(e)
  }
  try {
    const { plantaUltimoDespacho: _p, ...respuesta } = await leerPosicionesCamiones(sbAdmin(), { soloLectura })
    void _p
    return NextResponse.json(respuesta)
  } catch (e: any) {
    return NextResponse.json({ conectado: true, error: e?.message || "Error consultando el GPS", camiones: [] }, { status: 502 })
  }
}
