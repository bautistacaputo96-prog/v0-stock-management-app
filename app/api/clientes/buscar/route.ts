/**
 * Buscador unificado de clientes (regla de Bautista del 21/10/2026): busca a la vez en Rebucret y en la copia de
 * Zomatik, por nombre (sin tildes, en cualquier orden, por partes), razón social, alias, CUIT/DNI, obra y
 * teléfono, más los parecidos por errores de tipeo. Ver lib/clientes-buscar.ts.
 *
 *   GET /api/clientes/buscar?q=texto   con sesión y permiso de cargar pedidos, despachar o ver clientes
 */
import { NextResponse } from "next/server"
import { exigirSesion, respuestaError, sbServicio } from "@/lib/auth/servidor"
import { puedeCon } from "@/lib/permisos"
import { buscarClientes } from "@/lib/clientes-buscar"
import { cargarClientesParaBuscar } from "@/lib/clientes-datos"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  try {
    const r = await exigirSesion()
    if (r.respuesta) return r.respuesta
    const u = r.sesion.usuario
    if (!puedeCon(u, "programacion", "cargar") && !puedeCon(u, "despacho", "cargar") && !puedeCon(u, "clientes", "ver"))
      return NextResponse.json({ error: "No tenés permiso para buscar clientes." }, { status: 403 })
    const q = (new URL(req.url).searchParams.get("q") || "").slice(0, 80)
    const { nuestros, zomatik } = await cargarClientesParaBuscar(sbServicio())
    const res = NextResponse.json({ ...buscarClientes(q, nuestros, zomatik), puedeTraer: puedeCon(u, "clientes", "cargar") })
    res.headers.set("Cache-Control", "no-store")
    return res
  } catch (e) {
    return respuestaError(e)
  }
}
