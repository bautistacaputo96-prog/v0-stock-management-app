/**
 * Zomatik Z2b · NP con saldo (sección 25).
 *
 *   GET /api/zomatik/np/saldos                          lista "NP con saldo: pendiente" de Programación: NP del sistema en
 *                                                       Zomatik con saldo y sin pedido activo, con desde cuándo (sin vencer)
 *   GET /api/zomatik/np/saldos?client_id=…&formula_id=… las que sirven para "Usar NP con saldo" en el pedido (mismo cliente
 *                                                       y artículo, con algo libre)
 */
import { NextResponse } from "next/server"
import { exigirSesion, respuestaError } from "@/lib/auth/servidor"
import { puedeCon } from "@/lib/permisos"
import { faltaMigracion, npsConSaldo } from "@/lib/zomatik/np-servidor"

export const dynamic = "force-dynamic"

const uuid = (s: string | null) => (s && /^[0-9a-f-]{36}$/i.test(s) ? s : null)

export async function GET(req: Request) {
  try {
    const r = await exigirSesion()
    if (r.respuesta) return r.respuesta
    if (!puedeCon(r.sesion.usuario, "programacion", "ver")) return NextResponse.json({ error: "No tenés acceso a Programación." }, { status: 403 })
    const q = new URL(req.url).searchParams
    const clientId = uuid(q.get("client_id"))
    const formulaId = uuid(q.get("formula_id"))
    try {
      const res = NextResponse.json({ nps: await npsConSaldo({ clientId, formulaId }) })
      res.headers.set("Cache-Control", "no-store")
      return res
    } catch (e) {
      if (faltaMigracion(e)) return NextResponse.json({ nps: [], sinMigracion: true })
      throw e
    }
  } catch (e) {
    return respuestaError(e)
  }
}
