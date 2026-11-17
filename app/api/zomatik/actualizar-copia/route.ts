/**
 * Zomatik · "¿No está? Actualizar desde Zomatik" del cartel de vincular (16/11/2026).
 *
 *   POST /api/zomatik/actualizar-copia {tipo: "clientes" | "articulos"}
 *     con sesión y el mismo permiso que el buscador del cartel (programacion.cargar o editar, o un gerencial)
 *   POST /api/zomatik/actualizar-copia {tipo: "precios"}
 *     las listas de precios (precio por m³ al programar): solo con precios_np.editar
 *
 * Corre solo esa parte de la lectura de Zomatik (solo lectura) y graba la copia. Como mucho una vez cada 2 min por
 * tipo: si se actualizó hace poco, responde `reciente` sin ir a Zomatik. Lógica en lib/zomatik/actualizar-copia.ts.
 */
import { NextResponse } from "next/server"
import { exigirSesion, modoPruebaLocal, respuestaModoLocal, respuestaError, sbServicio } from "@/lib/auth/servidor"
import { puedeCon, puedeVincularDesdePedido, tipoDe } from "@/lib/permisos"
import { actualizarCopia, tipoDeCopia } from "@/lib/zomatik/actualizar-copia"

export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function POST(req: Request) {
  if (modoPruebaLocal()) return respuestaModoLocal()
  try {
    const r = await exigirSesion()
    if (r.respuesta) return r.respuesta
    const u = r.sesion.usuario
    const body = await req.json().catch(() => ({}))
    const tipo = tipoDeCopia(body?.tipo)
    if (!tipo) return NextResponse.json({ error: "Tipo inválido (clientes, articulos o precios)" }, { status: 400 })
    if (tipo === "precios" ? !puedeCon(u, "precios_np", "editar") : !puedeVincularDesdePedido(u) && tipoDe(u) !== "gerencial")
      return NextResponse.json({ error: tipo === "precios" ? "No tenés permiso para ver precios." : "Es de Programación." }, { status: 403 })
    const res = await actualizarCopia(tipo, { sb: sbServicio() })
    return NextResponse.json(res, { status: res.ok ? 200 : 502 })
  } catch (e) {
    return respuestaError(e)
  }
}
