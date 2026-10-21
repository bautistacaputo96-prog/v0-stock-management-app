/**
 * Unificar dos clientes duplicados (solo gerenciales): mueve obras, pedidos y despachos al que queda, pasa el
 * código de Zomatik y los nombres como alias, y da de baja el otro. Todo en una transacción de la base
 * (función unificar_clientes, migración 202610212100). No toca Zomatik.
 *
 *   POST /api/clientes/unificar   {queda, sale, motivo}
 */
import { NextResponse } from "next/server"
import { exigirGerencial, modoPruebaLocal, respuestaModoLocal, respuestaError, sbServicio } from "@/lib/auth/servidor"
import { olvidarClientes } from "@/lib/clientes-datos"

export const dynamic = "force-dynamic"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: Request) {
  if (modoPruebaLocal()) return respuestaModoLocal()
  try {
    const r = await exigirGerencial()
    if (r.respuesta) return r.respuesta
    const body = await req.json().catch(() => ({}))
    const queda = String(body?.queda || "")
    const sale = String(body?.sale || "")
    const motivo = String(body?.motivo || "").trim()
    if (!UUID.test(queda) || !UUID.test(sale)) return NextResponse.json({ error: "Elegí los dos clientes." }, { status: 400 })
    const { data, error } = await sbServicio().rpc("unificar_clientes", { p_queda: queda, p_sale: sale, p_usuario: r.sesion.usuario.name, p_motivo: motivo })
    if (error) {
      // La función no existe todavía (PGRST202 / "Could not find the function"): falta la migración
      if ((error as any).code === "PGRST202" || /could not find the function|function .*unificar_clientes.* does not exist/i.test(error.message || ""))
        return NextResponse.json({ error: "Falta aplicar la migración 202610212100 (unificar_clientes)." }, { status: 500 })
      if ((error as any).code === "23505")
        return NextResponse.json({ error: "No se pudo unificar: quedaría repetido un dato que tiene que ser único. No se cambió nada." }, { status: 409 })
      throw error
    }
    if ((data as any)?.error) return NextResponse.json({ error: (data as any).error }, { status: 400 })
    olvidarClientes()
    return NextResponse.json(data)
  } catch (e) {
    return respuestaError(e)
  }
}
