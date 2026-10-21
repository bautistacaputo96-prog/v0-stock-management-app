/**
 * Zomatik Z0 · "Ver días" de la pantalla Vínculos (solo gerenciales): nuestros despachos y los remitos de
 * Zomatik del candidato, lado a lado, con los días que coinciden marcados. No graba nada.
 *
 *   GET /api/zomatik/dias?tipo=cliente&id=<clients.id>&codigo=<código del cliente en Zomatik>
 *   GET /api/zomatik/dias?tipo=formula&id=<formulas.id>&codigo=<código del artículo>
 *   GET /api/zomatik/dias?tipo=proyecto&id=<código del proyecto>&codigo=<construction_sites.id>
 */
import { NextResponse } from "next/server"
import { exigirGerencial, respuestaError, sbServicio } from "@/lib/auth/servidor"
import { cargarDatosCruce } from "@/lib/zomatik/datos-cruce"
import { armarPropuestas, clienteNormDe, diasCliente, diasFormula, diasProyecto } from "@/lib/zomatik/propuestas"

export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET(req: Request) {
  try {
    const r = await exigirGerencial()
    if (r.respuesta) return r.respuesta
    const q = new URL(req.url).searchParams
    const tipo = q.get("tipo")
    const id = String(q.get("id") || "")
    const codigo = String(q.get("codigo") || "")
    const datos = await cargarDatosCruce(sbServicio())
    let out
    if (tipo === "cliente") out = diasCliente(datos, id, Number(codigo))
    else if (tipo === "formula") out = diasFormula(datos, id, Number(codigo), clienteNormDe(datos, armarPropuestas(datos)))
    else if (tipo === "proyecto") out = diasProyecto(datos, Number(id), codigo)
    else return NextResponse.json({ error: "tipo inválido" }, { status: 400 })
    const res = NextResponse.json(out)
    res.headers.set("Cache-Control", "no-store")
    return res
  } catch (e) {
    return respuestaError(e)
  }
}
