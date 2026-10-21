/**
 * CUIT de un cliente existente (Respuestas de Bautista 21/10/2026, 7: desde ahora el CUIT es obligatorio).
 * Valida el dígito verificador y controla que no lo tenga otro cliente de Rebucret ni otro de la copia de Zomatik.
 *
 *   POST /api/clientes/cuit   {client_id, cuit, soloControlar?}
 *     soloControlar = true: solo responde si se puede (lo usa Editar cliente, que graba con el resto del formulario)
 *     si no: lo graba (pestaña "Clientes sin CUIT" y el aviso del pedido) y queda en Actividad
 *
 * Permisos: clientes.editar; o programacion.cargar para un cliente que todavía no tiene CUIT válido (el aviso del
 * formulario de pedido).
 */
import { NextResponse } from "next/server"
import { exigirSesion, modoPruebaLocal, respuestaModoLocal, respuestaError, registrarActividad, sbServicio } from "@/lib/auth/servidor"
import { puedeCon } from "@/lib/permisos"
import { controlarCuit } from "@/lib/clientes-buscar"
import { cargarClientesParaBuscar, olvidarClientes } from "@/lib/clientes-datos"
import { cuitValido, soloDigitos } from "@/lib/zomatik/parseo"

export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    const r = await exigirSesion()
    if (r.respuesta) return r.respuesta
    const u = r.sesion.usuario
    const body = await req.json().catch(() => ({}))
    const id = String(body?.client_id || "")
    const soloControlar = body?.soloControlar === true
    if (!soloControlar && modoPruebaLocal()) return respuestaModoLocal()
    if (!/^[0-9a-f-]{36}$/i.test(id) && !(soloControlar && id === "nuevo")) return NextResponse.json({ error: "Falta el cliente" }, { status: 400 })
    const sb = sbServicio()
    olvidarClientes()
    const { nuestros, zomatik } = await cargarClientesParaBuscar(sb)
    const yo = nuestros.find((c) => c.id === id)
    if (!yo && id !== "nuevo") return NextResponse.json({ error: "No existe el cliente" }, { status: 404 })
    const sinCuitValido = !cuitValido(soloDigitos(yo?.cuit))
    if (!puedeCon(u, "clientes", "editar") && !(sinCuitValido && (puedeCon(u, "programacion", "cargar") || puedeCon(u, "clientes", "cargar"))))
      return NextResponse.json({ error: "No tenés permiso para cambiar el CUIT de este cliente." }, { status: 403 })
    const c = controlarCuit(body?.cuit, id, nuestros, zomatik)
    if (!c.ok) return NextResponse.json({ error: c.error, conflicto: c.conflicto }, { status: 409 })
    if (soloControlar) return NextResponse.json({ ok: true, cuit: c.cuit })
    const { error } = await sb.from("clients").update({ cuit: c.cuit }).eq("id", id)
    if (error) throw error
    olvidarClientes()
    await registrarActividad({ usuario: u.name, action: "editar", entity: "cliente", entityId: id, reference: yo!.name, details: { CUIT: `${yo!.cuit || "-"} → ${c.cuit}` } })
    return NextResponse.json({ ok: true, cuit: c.cuit })
  } catch (e) {
    return respuestaError(e)
  }
}
