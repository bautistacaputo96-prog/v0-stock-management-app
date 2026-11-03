/**
 * Zomatik · "Ver precio de lista" del bloque de la NP (03/11).
 *
 *   GET /api/zomatik/np/precio?formula_id=…&remito_tipo=R|X
 *       El último precio de lista por m³ (sin IVA) que vio el robot para esa fórmula al generar una NP nueva (NP o NP2
 *       según R/X), con la NP y el día. No entra a Zomatik: leer el precio de la lista sin crear un borrador no se
 *       puede todavía (manage_pedidos crea uno). Sin dato: { precio: null }.
 */
import { NextResponse } from "next/server"
import { exigirSesion, respuestaError, sbServicio } from "@/lib/auth/servidor"
import { puedeCon } from "@/lib/permisos"
import { comprobanteDe } from "@/lib/zomatik/np"
import { ultimoPrecioLista } from "@/lib/zomatik/np-servidor"

export const dynamic = "force-dynamic"

const uuid = (s: string | null) => (s && /^[0-9a-f-]{36}$/i.test(s) ? s : null)

export async function GET(req: Request) {
  try {
    const r = await exigirSesion()
    if (r.respuesta) return r.respuesta
    if (!puedeCon(r.sesion.usuario, "programacion", "cargar")) return NextResponse.json({ error: "Es de Programación." }, { status: 403 })
    const q = new URL(req.url).searchParams
    const formulaId = uuid(q.get("formula_id"))
    if (!formulaId) return NextResponse.json({ error: "Elegí la fórmula." }, { status: 400 })
    const rt = q.get("remito_tipo")
    const lista = await ultimoPrecioLista(sbServicio(), formulaId, comprobanteDe(rt === "R" || rt === "X" ? rt : null))
    const res = NextResponse.json(lista ? { precio: lista.precio, numero: lista.numero, fecha: lista.fecha } : { precio: null })
    res.headers.set("Cache-Control", "no-store")
    return res
  } catch (e) {
    return respuestaError(e)
  }
}
