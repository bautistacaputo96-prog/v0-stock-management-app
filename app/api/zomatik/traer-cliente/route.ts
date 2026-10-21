/**
 * Zomatik Z0 · "Traer de Zomatik": crea en Rebucret un cliente que está en Zomatik, vinculado a su código.
 * No escribe nada en Zomatik. Nunca duplica (ver lib/zomatik/traer.ts).
 *
 *   POST /api/zomatik/traer-cliente   {codigo, plantId?}   con sesión y permiso clientes.cargar
 */
import { NextResponse } from "next/server"
import { exigirSesion, modoPruebaLocal, respuestaModoLocal, respuestaError, registrarActividad } from "@/lib/auth/servidor"
import { puedeCon } from "@/lib/permisos"
import { traerCliente } from "@/lib/zomatik/traer"

export const dynamic = "force-dynamic"
export const maxDuration = 30

export async function POST(req: Request) {
  if (modoPruebaLocal()) return respuestaModoLocal()
  try {
    const r = await exigirSesion()
    if (r.respuesta) return r.respuesta
    if (!puedeCon(r.sesion.usuario, "clientes", "cargar"))
      return NextResponse.json({ error: "No tenés permiso para cargar clientes." }, { status: 403 })
    const body = await req.json().catch(() => ({}))
    const codigo = Number(body?.codigo)
    const plantId = typeof body?.plantId === "string" && /^[0-9a-f-]{36}$/i.test(body.plantId) ? body.plantId : null
    const res = await traerCliente({ codigo, plantId, usuario: r.sesion.usuario.name })
    if (!res.ok) return NextResponse.json({ error: res.error, cliente: res.cliente }, { status: res.status })
    if (!res.yaEstaba)
      await registrarActividad({
        usuario: r.sesion.usuario.name,
        action: "crear",
        entity: "cliente",
        entityId: res.cliente.id,
        reference: res.cliente.name,
        details: { Cliente: res.cliente.name, Origen: "Traído de Zomatik", "Código Zomatik": String(codigo) },
      })
    return NextResponse.json({ cliente: res.cliente, yaEstaba: res.yaEstaba, aviso: res.aviso })
  } catch (e) {
    return respuestaError(e)
  }
}
