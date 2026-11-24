/**
 * Fase 0c-2 · Lectura para el WhatsApp diario de Concretus (docs/migracion-loop/concretus-lectura.md).
 *
 *   GET /api/concretus/lectura?tipo=despachos|programacion&desde=<ISO>&hasta=<ISO>
 *   Authorization: Bearer <REPARTO_RESUMEN_SECRET>   (el mismo secreto que Concretus ya usa para /api/reparto/resumen;
 *                                                     NO acepta CRON_SECRET ni sesión)
 *
 * Solo lee (con la clave de servicio) y solo devuelve lo que usa el reporte: ver lib/concretus-lectura.ts.
 * Rango máximo 3 días. Respuesta: { tipo, desde, hasta, filas: [...] }.
 */
import { NextResponse } from "next/server"
import { sbServicio } from "@/lib/auth/servidor"
import { autorizadoResumen } from "@/lib/armado-dia"
import { validarLectura, filasDespachos, filasProgramacion, idsDe } from "@/lib/concretus-lectura"

export const dynamic = "force-dynamic"
export const maxDuration = 30

async function nombres(sb: ReturnType<typeof sbServicio>, tabla: string, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map()
  const { data, error } = await sb.from(tabla).select("id, name").in("id", ids)
  if (error) throw error
  return new Map(((data as { id: string; name: string | null }[] | null) || []).map((x) => [x.id, x.name || ""]))
}

export async function GET(req: Request) {
  if (!autorizadoResumen(req.headers.get("authorization"), process.env.REPARTO_RESUMEN_SECRET)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }
  const v = validarLectura(new URL(req.url).searchParams)
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })
  const { tipo, desde, hasta } = v.params
  try {
    const sb = sbServicio()
    const { data, error } =
      tipo === "despachos"
        ? await sb
            .from("dispatches")
            .select("quantity_m3, client_id, construction_site_id, formula_id, dispatch_date, is_test_dispatch")
            .gte("dispatch_date", desde)
            .lt("dispatch_date", hasta)
            .eq("is_test_dispatch", false)
            .order("dispatch_date")
            .limit(2000)
        : await sb
            .from("scheduled_dispatches")
            .select("quantity_m3, scheduled_arrival_time, is_urgent, status, client_id, construction_site_id, formula_id")
            .gte("scheduled_arrival_time", desde)
            .lt("scheduled_arrival_time", hasta)
            .neq("status", "cancelled")
            .order("scheduled_arrival_time")
            .limit(2000)
    if (error) throw error
    const filas = (data as any[] | null) || []
    const [clientes, obras, formulas] = await Promise.all([
      nombres(sb, "clients", idsDe(filas, "client_id")),
      nombres(sb, "construction_sites", idsDe(filas, "construction_site_id")),
      nombres(sb, "formulas", idsDe(filas, "formula_id")),
    ])
    const n = { clientes, obras, formulas }
    const res = NextResponse.json({ tipo, desde, hasta, filas: tipo === "despachos" ? filasDespachos(filas, n) : filasProgramacion(filas, n) })
    res.headers.set("Cache-Control", "no-store")
    return res
  } catch (e: any) {
    console.error("[concretus/lectura]", e?.message || e)
    return NextResponse.json({ error: "No se pudo leer" }, { status: 502 })
  }
}
