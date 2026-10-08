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
 * eligieron su contraseña no pueden entrar hasta que un gerencial les dé una inicial, y se cortan las
 * sesiones de quienes entraron con la común y todavía no eligieron la suya (sesion_version + 1).
 * Lo hace la base en un solo paso (cerrar_ingreso_clave_comun).
 */
export async function POST() {
  if (modoPruebaLocal()) return respuestaModoLocal()
  try {
    const r = await exigirGerencial()
    if (r.respuesta) return r.respuesta
    const sb = sbServicio()
    const { data, error } = await sb.rpc("cerrar_ingreso_clave_comun", { p_por: r.sesion.usuario.name })
    if (error) throw error

    const filas = ((data as any[]) || []) as { user_id: string; tenia_clave_comun: boolean; sesion_cerrada: boolean }[]
    const ids = filas.map((c) => c.user_id)
    const sesionesCerradas = filas.filter((c) => c.sesion_cerrada).length
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
        "Sesiones cerradas (sin contraseña propia)": String(sesionesCerradas),
      },
    })
    return NextResponse.json({ ok: true, cerrados: filas.filter((c) => c.tenia_clave_comun).length, sinContraseña: pendientes })
  } catch (e) {
    return respuestaError(e)
  }
}
