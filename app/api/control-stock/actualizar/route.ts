/**
 * Control de stock de materia prima · leer Zomatik (solo lectura) y guardar la copia.
 *
 *   POST "Actualizar ahora" (gerenciales o materia_prima.editar): primero el reporte de producción (FABRICA › REPORTE
 *        PRODUCCION, es corto) y después MOVIMIENTOS STOCK, como hasta ahora.
 *   GET  pg_cron `control-despacho-lectura` (Bearer cron_secret de Vault), 05:42 y 06:42 de Argentina: lo que no se leyó
 *        hoy (reporte de producción y después el stock), para que el mail de las 16:25 compare hasta ayer completo. Si ya
 *        está todo leído hoy (el reintento de las 06:42), no hace nada. Entre las 16:00 y las 16:59 no corre.
 * El cron de las 16:25 sigue leyendo el stock dentro de /api/control-ingresos/controlar, después del mail.
 * Una lectura a la vez (turno del robot de Zomatik). Docs: docs/control-stock-mp.md.
 */
import { NextResponse } from "next/server"
import { exigirSesion, modoPruebaLocal, respuestaModoLocal, respuestaError, sbServicio } from "@/lib/auth/servidor"
import { esLlamadaDeCron } from "@/lib/cron"
import { puedeControlar } from "@/lib/control-ingresos/servidor"
import { leerStockZomatik } from "@/lib/control-stock/servidor"
import { enHorarioDelCron, MENSAJE_HORARIO_CRON } from "@/lib/control-stock/calculo"
import { leerProduccionZomatik, leidoHoy } from "@/lib/control-produccion/servidor"

export const dynamic = "force-dynamic"
// Como el control de remitos (Fluid compute en Hobby)
export const maxDuration = 300

/** El reporte de producción tiene hasta acá desde el pedido; el stock, hasta los 270 s. */
const PRODUCCION_LIMITE_MS = 60_000
const STOCK_LIMITE_MS = 270_000

export async function GET(req: Request) {
  const t0 = Date.now()
  if (modoPruebaLocal()) return respuestaModoLocal()
  try {
    // Estricto, como la pasada de la NP: sin CRON_SECRET cargado no corre (los headers de Vercel se pueden falsificar)
    if (!process.env.CRON_SECRET || !esLlamadaDeCron(req)) return NextResponse.json({ error: "Solo el cron (con CRON_SECRET)." }, { status: 401 })
    if (enHorarioDelCron(t0)) return NextResponse.json({ ok: true, salteada: MENSAJE_HORARIO_CRON })
    const sb = sbServicio()
    const ya = await leidoHoy(sb, t0)
    if (ya.produccion && ya.stock) return NextResponse.json({ ok: true, motivo: "ya leído hoy" })
    const produccion = ya.produccion ? null : await leerProduccionZomatik(sb, { t0, limite: t0 + PRODUCCION_LIMITE_MS })
    const stock = ya.stock ? null : await leerStockZomatik(sb, { t0, limite: t0 + STOCK_LIMITE_MS })
    const ok = (!produccion || produccion.ok || !!produccion.faltaMigracion) && (!stock || stock.ok)
    return NextResponse.json({ ok, produccion, stock }, { status: ok ? 200 : 502 })
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
    if (!puedeControlar(r.sesion.usuario)) return NextResponse.json({ error: "No tenés permiso para el control de stock." }, { status: 403 })
    if (enHorarioDelCron()) return NextResponse.json({ ok: false, error: `${MENSAJE_HORARIO_CRON}.` }, { status: 409 })
    const sb = sbServicio()
    // Freno simple: no más de una vez cada 2 min (el turno del robot ya evita dos a la vez)
    const { data: ult } = await sb.from("zomatik_stock_lecturas").select("intento_at").order("intento_at", { ascending: false, nullsFirst: false }).limit(1)
    const ultimo = (ult as any[])?.[0]?.intento_at
    if (ultimo && Date.now() - Date.parse(ultimo) < 120_000) return NextResponse.json({ ok: false, error: "Se actualizó hace menos de 2 min. Esperá un rato." }, { status: 429 })
    // Primero el reporte de producción (corto); sin su migración no hace nada y el stock sigue como siempre
    const produccion = await leerProduccionZomatik(sb, { t0, limite: t0 + PRODUCCION_LIMITE_MS }).catch((e) => ({ ok: false, error: String(e?.message || e), ms: Date.now() - t0 }))
    const res = await leerStockZomatik(sb, { t0, limite: t0 + STOCK_LIMITE_MS })
    return NextResponse.json({ ...res, produccion }, { status: res.ok ? 200 : 502 })
  } catch (e) {
    return respuestaError(e)
  }
}
