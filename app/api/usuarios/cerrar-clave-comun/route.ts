import { NextResponse } from "next/server"
import {
  sbServicio,
  exigirGerencial,
  registrarActividad,
  modoPruebaLocal,
  respuestaModoLocal,
  respuestaError,
} from "@/lib/auth/servidor"

export const dynamic = "force-dynamic"

/**
 * Fase 0c-1 · "Cerrar el ingreso con la contraseña común" (solo gerenciales). Desde acá, los que no
 * eligieron su contraseña no pueden entrar hasta que un gerencial les dé una inicial.
 */
export async function POST() {
  if (modoPruebaLocal()) return respuestaModoLocal()
  try {
    const r = await exigirGerencial()
    if (r.respuesta) return r.respuesta
    const sb = sbServicio()
    const { data, error } = await sb
      .from("app_user_credenciales")
      .update({ permite_clave_comun: false, actualizado_por: r.sesion.usuario.name, updated_at: new Date().toISOString() })
      .eq("permite_clave_comun", true)
      .select("user_id")
    if (error) throw error

    const ids = (data || []).map((c: any) => c.user_id)
    let pendientes: string[] = []
    if (ids.length) {
      const { data: us } = await sb.from("app_users").select("id, name, active").in("id", ids)
      pendientes = ((us as any[]) || []).filter((u) => u.active !== false).map((u) => u.name)
    }
    await registrarActividad({
      usuario: r.sesion.usuario.name,
      action: "editar",
      entity: "usuario",
      reference: "Contraseña común",
      details: {
        "Ingreso con la contraseña común": "abierto → cerrado",
        "Quedaron sin contraseña": pendientes.length ? pendientes.join(", ") : "nadie",
      },
    })
    return NextResponse.json({ ok: true, cerrados: ids.length, sinContraseña: pendientes })
  } catch (e) {
    return respuestaError(e)
  }
}
