/**
 * Zomatik Z1 · OF + remito de un pedido (spec 26).
 *
 *   GET  /api/zomatik/remito?pedidos=id1,id2     estado de los remitos de cada pedido
 *   POST /api/zomatik/remito {accion: "remitir", pedido_id, fecha?}
 *        Al finalizar el pedido (o "Remitir en Zomatik"): arma los remitos del día con lo despachado (uno por NP) y el
 *        robot hace la OF y el remito después de responder. Con la llave de remitir apagada no hace nada.
 */
import { NextResponse, after } from "next/server"
import { exigirSesion, respuestaError, respuestaModoLocal } from "@/lib/auth/servidor"
import { puedeCon } from "@/lib/permisos"
import { hoyAR } from "@/lib/zomatik/np"
import { estadoRemitos, prepararRemitos, procesarZ1 } from "@/lib/zomatik/z1-servidor"

export const dynamic = "force-dynamic"
export const maxDuration = 60

const uuid = (s: unknown) => (typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s) ? s : null)

export async function GET(req: Request) {
  try {
    const r = await exigirSesion()
    if (r.respuesta) return r.respuesta
    const u = r.sesion.usuario
    if (!puedeCon(u, "programacion", "ver") && !puedeCon(u, "despacho", "ver")) return NextResponse.json({ error: "No tenés acceso." }, { status: 403 })
    const ids = (new URL(req.url).searchParams.get("pedidos") || "").split(",").map(uuid).filter(Boolean).slice(0, 300) as string[]
    const res = NextResponse.json({ porPedido: await estadoRemitos(ids) })
    res.headers.set("Cache-Control", "no-store")
    return res
  } catch (e) {
    return respuestaError(e)
  }
}

export async function POST(req: Request) {
  const inicio = Date.now()
  try {
    const r = await exigirSesion()
    if (r.respuesta) return r.respuesta
    if (r.sesion.local) return respuestaModoLocal()
    const u = r.sesion.usuario
    if (!puedeCon(u, "despacho", "cargar") && !puedeCon(u, "programacion", "cargar")) return NextResponse.json({ error: "No tenés permiso." }, { status: 403 })
    const body = await req.json().catch(() => ({}))
    const pedidoId = uuid(body?.pedido_id)
    if (body?.accion !== "remitir" || !pedidoId) return NextResponse.json({ error: "Faltan datos" }, { status: 400 })
    const fecha = typeof body?.fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.fecha) ? body.fecha : hoyAR()
    let prep
    try {
      prep = await prepararRemitos(pedidoId, fecha, u.name)
    } catch (e) {
      if (/zomatik_remito|remitir_activo|does not exist|schema cache/i.test(String((e as Error)?.message || ""))) return NextResponse.json({ activo: false, motivo: "OF y remito: se cargan a mano en Zomatik", sinMigracion: true })
      throw e
    }
    if (prep.activo) after(() => procesarZ1({ usuario: u.name, pedidoId, inicio }).catch((e) => console.error("[zomatik-z1] procesar", e?.message)))
    return NextResponse.json(prep)
  } catch (e) {
    return respuestaError(e)
  }
}
