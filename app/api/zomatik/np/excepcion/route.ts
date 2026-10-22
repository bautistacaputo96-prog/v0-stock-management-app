/**
 * Zomatik Z2 · "Despachar sin NP": excepción de un gerencial (Bautista, Juan o Fernando: tipo gerencial), con motivo,
 * para ESE pedido y ESE día (18.4 y 20.1.2). El trigger del despacho la mira y deja despachar; queda en Actividad.
 *
 *   POST /api/zomatik/np/excepcion {pedido_id, motivo_tipo: zomatik_caido | cliente_sin_alta | otro, motivo}
 */
import { NextResponse } from "next/server"
import { exigirSesion, respuestaError, respuestaModoLocal, sbServicio } from "@/lib/auth/servidor"
import { tipoDe } from "@/lib/permisos"
import { actividadNp } from "@/lib/zomatik/np-servidor"
import { hoyAR } from "@/lib/zomatik/np"

export const dynamic = "force-dynamic"

const MOTIVOS: Record<string, string> = { zomatik_caido: "Zomatik caído", cliente_sin_alta: "Cliente sin alta en Zomatik todavía", otro: "Otro" }

export async function POST(req: Request) {
  try {
    const r = await exigirSesion()
    if (r.respuesta) return r.respuesta
    if (r.sesion.local) return respuestaModoLocal()
    const u = r.sesion.usuario
    if (tipoDe(u) !== "gerencial") return NextResponse.json({ error: "La excepción la autoriza un gerencial (Bautista, Juan o Fernando)." }, { status: 403 })
    const body = await req.json().catch(() => ({}))
    const pedidoId = typeof body?.pedido_id === "string" && /^[0-9a-f-]{36}$/i.test(body.pedido_id) ? body.pedido_id : null
    const tipo = String(body?.motivo_tipo || "")
    const motivo = String(body?.motivo || "").trim().slice(0, 300)
    if (!pedidoId || !MOTIVOS[tipo]) return NextResponse.json({ error: "Elegí el motivo." }, { status: 400 })
    if (tipo === "otro" && motivo.replace(/\s/g, "").length < 5) return NextResponse.json({ error: "Contá el motivo (mínimo 5 letras)." }, { status: 400 })
    const sb = sbServicio()
    const { data: ped } = await sb.from("scheduled_dispatches").select("id, plant_id, clients(name)").eq("id", pedidoId).maybeSingle()
    if (!ped) return NextResponse.json({ error: "El pedido no existe." }, { status: 404 })
    // Vale para el día del despacho (hoy en Argentina, el mismo que mira el trigger con dispatch_date). Con copia del
    // pedido: si el pedido se borra, la excepción queda.
    const fila = {
      scheduled_dispatch_id: pedidoId, fecha: hoyAR(), motivo_tipo: tipo, motivo: motivo || null, autorizado_por: u.name, pedido_por: u.name,
      pedido_ref: pedidoId.slice(0, 8), cliente: (ped as { clients?: { name?: string } | null }).clients?.name || null, plant_id: (ped as { plant_id: string }).plant_id,
    }
    const { error } = await sb.from("zomatik_np_excepciones").upsert(fila as never, { onConflict: "scheduled_dispatch_id,fecha" })
    if (error) throw error
    await actividadNp(sb, {
      usuario: u.name, action: "crear", pedidoId, plantId: (ped as { plant_id: string }).plant_id, referencia: "Despachar sin NP (excepción)",
      detalle: { "Qué pasó": "Excepción: se puede despachar sin NP hoy", Motivo: `${MOTIVOS[tipo]}${motivo ? ` — ${motivo}` : ""}`, Autorizó: u.name },
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return respuestaError(e)
  }
}
