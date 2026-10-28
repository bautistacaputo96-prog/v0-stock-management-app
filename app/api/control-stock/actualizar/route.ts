/**
 * Control de stock de materia prima · "Actualizar ahora": lee MOVIMIENTOS STOCK de Zomatik (solo lectura) y guarda la
 * copia. El cron diario lo lee dentro de /api/control-ingresos/controlar, antes del mail de las 16:25.
 * Gerenciales o materia_prima.editar. Una lectura a la vez (turno del robot de Zomatik).
 */
import { NextResponse } from "next/server"
import { exigirSesion, modoPruebaLocal, respuestaModoLocal, respuestaError, sbServicio } from "@/lib/auth/servidor"
import { puedeControlar } from "@/lib/control-ingresos/servidor"
import { leerStockZomatik } from "@/lib/control-stock/servidor"

export const dynamic = "force-dynamic"
// Como el control de remitos (Fluid compute en Hobby)
export const maxDuration = 300

export async function POST() {
  const t0 = Date.now()
  if (modoPruebaLocal()) return respuestaModoLocal()
  try {
    const r = await exigirSesion()
    if (r.respuesta) return r.respuesta
    if (!puedeControlar(r.sesion.usuario)) return NextResponse.json({ error: "No tenés permiso para el control de stock." }, { status: 403 })
    const sb = sbServicio()
    // Freno simple: no más de una vez cada 2 min (el turno del robot ya evita dos a la vez)
    const { data: ult } = await sb.from("zomatik_stock_lecturas").select("intento_at").order("intento_at", { ascending: false, nullsFirst: false }).limit(1)
    const ultimo = (ult as any[])?.[0]?.intento_at
    if (ultimo && Date.now() - Date.parse(ultimo) < 120_000) return NextResponse.json({ ok: false, error: "Se actualizó hace menos de 2 min. Esperá un rato." }, { status: 429 })
    const res = await leerStockZomatik(sb, { t0, limite: t0 + 270_000 })
    return NextResponse.json(res, { status: res.ok ? 200 : 502 })
  } catch (e) {
    return respuestaError(e)
  }
}
