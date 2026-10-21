import { NextResponse } from "next/server"
import { registrarActividad, respuestaError, sbServicio } from "@/lib/auth/servidor"
import { cargarPuestoPorId } from "@/lib/carga/datos"
import { error, exigirCarga } from "@/lib/carga/servidor"

export const dynamic = "force-dynamic"

const ETAPAS: Record<string, string> = {
  apagado: "Apagado (Despachar no manda órdenes)",
  lectura: "A · Solo lectura",
  orden: "B · Orden preparada",
  arranque: "C · Cargar desde el sistema",
}

/**
 * Configurar el puesto (carga.editar). Body: {puesto_id, etapa}. Con "orden" o "arranque", Despachar manda la orden a
 * la cola de carga; con "apagado" o "lectura", no. `usa_kilos_reales` NO se cambia desde acá: queda apagado hasta que
 * exista el puente real (y en el simulador, la base no lo deja prender).
 */
export async function POST(req: Request) {
  try {
    const r = await exigirCarga("carga", "editar")
    if (r.respuesta) return r.respuesta
    const body = await req.json().catch(() => ({}))
    const sb = sbServicio()
    const puesto = await cargarPuestoPorId(sb, String(body?.puesto_id || ""))
    if (!puesto) return error("El puesto de carga no existe.", 404)
    const etapa = String(body?.etapa || "")
    if (!ETAPAS[etapa]) return error("Etapa desconocida.")
    if (etapa === puesto.etapa) return NextResponse.json({ ok: true })
    const { error: e } = await sb.from("puestos_carga").update({ etapa }).eq("id", puesto.id)
    if (e) throw e
    await registrarActividad({ usuario: r.usuario, action: "editar", entity: "carga", entityId: puesto.id, reference: puesto.nombre, details: { Etapa: `${ETAPAS[puesto.etapa]} → ${ETAPAS[etapa]}` } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return respuestaError(e)
  }
}
