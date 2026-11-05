import { NextResponse } from "next/server"
import { respuestaError, sbServicio } from "@/lib/auth/servidor"
import { cargarPuestoPorId } from "@/lib/carga/datos"
import { error, exigirCarga, registrarReporte, yaProcesado, type MaterialReporte } from "@/lib/carga/servidor"
import type { ReportePlanta } from "@/lib/carga/tipos"

export const dynamic = "force-dynamic"

/**
 * Una carga que el puente vio en la planta SIN una orden nuestra (alguien cargó directo desde Indumix, o se cargó a
 * mano sin internet; 5.7 y 19.8). La sube el simulador de la PC de la planta con el reporte de Indumix; la lógica (el
 * emparejador, 19.2) está en `registrarReporte` (lib/carga/servidor.ts), que usa también el puente real
 * (/api/carga/puente).
 * Body: {puesto_id, pedido, dia_planta, inicio_at, fin_at, reporte: ReportePlanta, materiales: [...]}
 */
export async function POST(req: Request) {
  try {
    // Lo sube la pantalla (simulador): pide carga.cargar. El puente real usa su clave en /api/carga/puente.
    const r = await exigirCarga("carga", "cargar")
    if (r.respuesta) return r.respuesta
    const body = await req.json().catch(() => ({}))
    const sb = sbServicio()
    const puesto = await cargarPuestoPorId(sb, String(body?.puesto_id || ""))
    if (!puesto) return error("El puesto de carga no existe.", 404)
    const pedido = typeof body?.pedido === "string" ? body.pedido.slice(0, 80) : null
    if (await yaProcesado(pedido)) return NextResponse.json({ ok: true, duplicado: true })
    const rep = body?.reporte as ReportePlanta
    if (!rep || !Number.isFinite(Number(rep.numero))) return error("Falta el reporte de Indumix.")
    const res = await registrarReporte(puesto, {
      reporte: rep, materiales: (Array.isArray(body?.materiales) ? body.materiales : []) as MaterialReporte[],
      inicio_at: body?.inicio_at, fin_at: body?.fin_at, dia_planta: body?.dia_planta || null, hora_estimada: body?.hora_estimada === true, pedido,
    }, r.usuario)
    return NextResponse.json(res)
  } catch (e) {
    return respuestaError(e)
  }
}
