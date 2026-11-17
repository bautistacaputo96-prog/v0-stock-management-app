/**
 * Zomatik · Precio por m³ de la NP (línea "Precio por m³" del formulario del pedido). La ÚNICA ruta que devuelve precios.
 *
 *   GET /api/zomatik/np/precio?formula_id=…&plant_id=…&remito=R|X[&pedido_id=…]
 *     Con sesión, precios_np.editar y programacion.ver (y, con un pedido, poder ajustarlo); si no, 403.
 *     Lista activa de la copia (la misma `listaActiva` del robot, con el comprobante del remito), precio de lista del
 *     artículo de la fórmula, el precio puesto en el pedido y si la NP ya salió. Precios NETOS (sin IVA).
 *     Sin la migración: { sinMigracion: true } (la línea no aparece). Llave de la planta apagada: { activo: false }.
 */
import { NextResponse } from "next/server"
import { exigirSesion, respuestaError, sbServicio } from "@/lib/auth/servidor"
import { puedeVerPrecioNp } from "@/lib/permisos"
import { plantasNp } from "@/lib/zomatik/np-servidor"
import { faltaMigracionPrecio, precioParaPedido } from "@/lib/zomatik/precio-servidor"

export const dynamic = "force-dynamic"

const uuid = (s: string | null) => (s && /^[0-9a-f-]{36}$/i.test(s) ? s : null)

const json = (body: unknown, status = 200) => {
  const res = NextResponse.json(body, { status })
  res.headers.set("Cache-Control", "no-store")
  return res
}

export async function GET(req: Request) {
  try {
    const r = await exigirSesion()
    if (r.respuesta) return r.respuesta
    const u = r.sesion.usuario
    if (!puedeVerPrecioNp(u)) return json({ error: "No tenés permiso para ver precios." }, 403)
    const q = new URL(req.url).searchParams
    const formulaId = uuid(q.get("formula_id"))
    const plantId = uuid(q.get("plant_id"))
    const pedidoId = uuid(q.get("pedido_id"))
    const remito = q.get("remito") === "R" || q.get("remito") === "X" ? q.get("remito") : null
    if (!formulaId || !plantId) return json({ error: "Faltan datos" }, 400)
    const sb = sbServicio()
    if (pedidoId) {
      const { data: ped } = await sb.from("scheduled_dispatches").select("id, created_by").eq("id", pedidoId).maybeSingle()
      if (!ped) return json({ error: "El pedido no existe" }, 404)
      if (!puedeVerPrecioNp(u, ped as { created_by: string | null })) return json({ error: "No podés cambiar este pedido." }, 403)
    }
    try {
      if (!(await plantasNp(sb))[plantId]?.zomatik_np_activo) return json({ activo: false })
      return json({ activo: true, ...(await precioParaPedido({ formulaId, remito, pedidoId }, sb)) })
    } catch (e) {
      if (faltaMigracionPrecio(e)) return json({ sinMigracion: true })
      throw e
    }
  } catch (e) {
    return respuestaError(e)
  }
}
