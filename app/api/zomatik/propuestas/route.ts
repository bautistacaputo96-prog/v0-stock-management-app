/**
 * Zomatik Z0 · Propuestas de la pantalla "Vínculos con Zomatik" (solo gerenciales), calculadas acá en el servidor
 * con el cruce por fechas, m³ y planta más el nombre (lib/zomatik/propuestas.ts): el navegador no lee las copias.
 *
 *   GET /api/zomatik/propuestas
 *
 * No graba nada: los vínculos los confirma un gerencial con /api/zomatik/vincular.
 */
import { NextResponse } from "next/server"
import { exigirGerencial, respuestaError, sbServicio } from "@/lib/auth/servidor"
import { cargarDatosCruce } from "@/lib/zomatik/datos-cruce"
import { armarPropuestas } from "@/lib/zomatik/propuestas"

export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET() {
  try {
    const r = await exigirGerencial()
    if (r.respuesta) return r.respuesta
    const datos = await cargarDatosCruce(sbServicio())
    const res = NextResponse.json({ ...armarPropuestas(datos), leido: datos.leido })
    res.headers.set("Cache-Control", "no-store")
    return res
  } catch (e) {
    return respuestaError(e)
  }
}
