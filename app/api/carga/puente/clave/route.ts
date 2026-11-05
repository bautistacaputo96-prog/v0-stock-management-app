import { NextResponse } from "next/server"
import { registrarActividad, respuestaError, sbServicio } from "@/lib/auth/servidor"
import { tipoDe } from "@/lib/permisos"
import { cargarPuestoPorId } from "@/lib/carga/datos"
import { error, exigirCarga } from "@/lib/carga/servidor"
import { generarClave, hashClave } from "@/lib/carga/puente-servidor"

export const dynamic = "force-dynamic"

/**
 * "Generar clave del puente" (Carga · editar y gerencial). Body: {puesto_id}. Genera una clave nueva (`rbp_` + 32 bytes
 * al azar), guarda solo su sha256 (la anterior deja de andar) y la devuelve UNA sola vez: no se vuelve a mostrar.
 */
export async function POST(req: Request) {
  try {
    const r = await exigirCarga("carga", "editar")
    if (r.respuesta) return r.respuesta
    if (tipoDe(r.sesion.usuario) !== "gerencial") return error("La clave del puente la genera un usuario gerencial.", 403)
    const body = await req.json().catch(() => ({}))
    const sb = sbServicio()
    const puesto = await cargarPuestoPorId(sb, String(body?.puesto_id || ""))
    if (!puesto) return error("El puesto de carga no existe.", 404)
    if (puesto.sistema !== "indumix") return error("Solo el puesto real de Indumix usa la clave del puente.")
    const clave = generarClave()
    const { error: e } = await sb.from("puestos_carga_credenciales").upsert(
      { puesto_id: puesto.id, hash: hashClave(clave), creada_por: r.usuario, creada_at: new Date().toISOString() },
      { onConflict: "puesto_id" },
    )
    if (e) throw e
    await registrarActividad({ usuario: r.usuario, action: "editar", entity: "carga", entityId: puesto.id, reference: puesto.nombre, details: { "Clave del puente generada": "la anterior deja de andar" } })
    return NextResponse.json({ ok: true, clave })
  } catch (e) {
    return respuestaError(e)
  }
}
