/**
 * Zomatik Z1 · OF + remito de un pedido (spec 26).
 *
 *   GET  /api/zomatik/remito?pedidos=id1,id2     estado de los remitos de cada pedido
 *   POST /api/zomatik/remito {accion: "remitir", pedido_id, fecha?}
 *        Al finalizar el pedido (o "Remitir en Zomatik"): arma los remitos del día con lo despachado (uno por NP) y el
 *        robot hace la OF y el remito después de responder. Con la llave de remitir apagada no hace nada.
 */
import { NextResponse, after } from "next/server"
import { exigirSesion, respuestaError, respuestaModoLocal, sbServicio } from "@/lib/auth/servidor"
import { puedeCon } from "@/lib/permisos"
import { hoyAR } from "@/lib/zomatik/np"
import { avisarErrorZomatik } from "@/lib/zomatik/np-servidor"
import { estadoRemitos, prepararRemitos, procesarZ1 } from "@/lib/zomatik/z1-servidor"

export const dynamic = "force-dynamic"
export const maxDuration = 60

const uuid = (s: unknown) => (typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s) ? s : null)

/** Falta de configuración del servidor (la clave de servicio o el secreto): la contesta `respuestaError`, sin mail. */
const esDeConfiguracion = (e: unknown) => ["sin_clave_servicio", "sin_secreto"].includes(String((e as { codigo?: string })?.codigo || ""))

/**
 * Un error inesperado con "Remitir en Zomatik" (04/11): lo despachado no se toca y queda sin remitir (la pasada de la
 * noche lo vuelve a armar). Se le avisa a Bautista y se contesta claro.
 */
async function fallaInesperada(e: unknown, o: { pedidoId: string; fecha: string; usuario: string }) {
  console.error("[zomatik-z1] falla inesperada", o.pedidoId, e)
  try {
    const m = (e as { message?: string })?.message || String(e)
    await avisarErrorZomatik(sbServicio(), `Falla inesperada al remitir · Pedido ${o.pedidoId.slice(0, 8)}`, [
      `Pedido ${o.pedidoId.slice(0, 8)} (${o.pedidoId}) · ${o.fecha}`,
      `Botón: Remitir en Zomatik · ${o.usuario}`,
      `Error: ${m}`,
      "Lo despachado queda sin remitir: la pasada de la noche lo vuelve a armar, o tocá \"Remitir en Zomatik\" otra vez.",
    ])
  } catch (err) {
    console.error("[zomatik-z1] aviso de la falla", (err as Error)?.message)
  }
  return NextResponse.json({ error: "No se pudo remitir en Zomatik: queda pendiente y ya le avisamos a Bautista." }, { status: 500 })
}

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
  // Con el pedido ya validado: un error inesperado avisa a Bautista
  let boton: { pedidoId: string; fecha: string; usuario: string } | null = null
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
    boton = { pedidoId, fecha, usuario: u.name }
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
    if (boton && !esDeConfiguracion(e)) return fallaInesperada(e, boton)
    return respuestaError(e)
  }
}
