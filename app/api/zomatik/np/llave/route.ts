/**
 * Zomatik Z2 · Llave de la NP automática por planta (solo gerenciales; la prende Bautista).
 *
 *   GET  /api/zomatik/np/llave        plantas con su llave y modo, y las NP para revisar o con error
 *   POST /api/zomatik/np/llave {plant_id, activo, duro?}
 *        Prender: desde ahora los pedidos nuevos de la planta tienen NP automática (los de antes no). La primera vez
 *        arranca el modo aviso por 2 semanas (20.7). Apagar: no se escribe más en Zomatik.
 */
import { NextResponse } from "next/server"
import { exigirGerencial, respuestaError, respuestaModoLocal, sbServicio } from "@/lib/auth/servidor"
import { actividadNp, COLUMNAS_NP, faltaMigracion, modoDe, plantasNp } from "@/lib/zomatik/np-servidor"
import { hoyAR } from "@/lib/zomatik/np"

export const dynamic = "force-dynamic"

const mas14 = () => new Date(Date.parse(`${hoyAR()}T12:00:00Z`) + 14 * 86400_000).toISOString().slice(0, 10)

export async function GET() {
  try {
    const r = await exigirGerencial()
    if (r.respuesta) return r.respuesta
    const sb = sbServicio()
    try {
      const plantas = await plantasNp(sb)
      if (!Object.keys(plantas).length) return NextResponse.json({ plantas: [], bandeja: [], sinMigracion: true })
      const { data } = await sb.from("zomatik_np").select(COLUMNAS_NP).in("estado", ["revisar", "error", "vaciar"]).order("updated_at", { ascending: false }).limit(50)
      const res = NextResponse.json({
        plantas: Object.values(plantas).map((p) => ({ id: p.id, name: p.name, activo: !!p.zomatik_np_activo, desde: p.zomatik_np_desde, deposito: p.zomatik_deposito, modo: modoDe(p), aviso_hasta: p.aviso_hasta, exigir_np: p.exigir_np })),
        bandeja: data || [],
      })
      res.headers.set("Cache-Control", "no-store")
      return res
    } catch (e) {
      if (faltaMigracion(e)) return NextResponse.json({ plantas: [], bandeja: [], sinMigracion: true })
      throw e
    }
  } catch (e) {
    return respuestaError(e)
  }
}

export async function POST(req: Request) {
  try {
    const r = await exigirGerencial()
    if (r.respuesta) return r.respuesta
    if (r.sesion.local) return respuestaModoLocal()
    const body = await req.json().catch(() => ({}))
    const sb = sbServicio()
    const plantas = await plantasNp(sb)
    const p = plantas[String(body?.plant_id || "")]
    if (!p) return NextResponse.json({ error: "La planta no existe (o falta la migración de Z2)." }, { status: 400 })
    const activo = body?.activo === true
    if (activo && !p.zomatik_deposito) return NextResponse.json({ error: "La planta no tiene depósito de Zomatik." }, { status: 400 })
    const cambios: Record<string, unknown> = { zomatik_np_activo: activo }
    if (activo && !p.zomatik_np_activo) {
      cambios.zomatik_np_desde = new Date().toISOString()
      if (!p.aviso_hasta) cambios.aviso_hasta = mas14()
    }
    if (body?.duro === true) cambios.exigir_np = "duro"
    if (body?.duro === false) cambios.exigir_np = "aviso"
    const { error } = await sb.from("plants").update(cambios as never).eq("id", p.id)
    if (error) throw error
    await actividadNp(sb, {
      usuario: r.sesion.usuario.name, pedidoId: null, plantId: p.id, referencia: `NP automática · ${p.name}`,
      detalle: {
        "Qué pasó": activo ? (p.zomatik_np_activo ? "NP automática: cambio de modo" : "NP automática PRENDIDA") : "NP automática APAGADA",
        ...(cambios.aviso_hasta ? { "Modo aviso hasta": cambios.aviso_hasta } : {}),
        ...(cambios.exigir_np ? { Modo: cambios.exigir_np } : {}),
      },
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return respuestaError(e)
  }
}
