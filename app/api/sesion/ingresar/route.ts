import { NextResponse } from "next/server"
import { verificarClave, esClaveComun } from "@/lib/auth/clave"
import { decidirIngreso, ERROR_INCORRECTO } from "@/lib/auth/ingreso"
import { exigirSecreto } from "@/lib/auth/token"
import {
  sbServicio,
  leerUsuario,
  leerCredencial,
  ponerCookieSesion,
  usuarioParaElNavegador,
  modoPruebaLocal,
  respuestaModoLocal,
  respuestaError,
} from "@/lib/auth/servidor"

export const dynamic = "force-dynamic"

/**
 * Fase 0c-1 · Ingreso con nombre y contraseña. Reglas en lib/auth/ingreso.ts (decidirIngreso).
 * Body: {usuarioId, clave}. Nunca devuelve ni registra la contraseña.
 */
export async function POST(req: Request) {
  if (modoPruebaLocal()) return respuestaModoLocal()
  try {
    exigirSecreto() // sin secreto no se graba nada (ni intentos)
    const body = await req.json().catch(() => ({}))
    const usuarioId = typeof body?.usuarioId === "string" ? body.usuarioId : ""
    const clave = typeof body?.clave === "string" ? body.clave : ""
    if (!usuarioId || !clave) return NextResponse.json({ error: "Elegí tu nombre y poné tu contraseña." }, { status: 400 })
    if (!/^[0-9a-f-]{36}$/i.test(usuarioId)) return NextResponse.json({ error: ERROR_INCORRECTO }, { status: 401 })

    const usuario = await leerUsuario(usuarioId)
    const credencial = usuario ? await leerCredencial(usuarioId) : null
    const r = await decidirIngreso({
      credencial,
      activo: !!usuario && usuario.active !== false,
      clave,
      ahora: new Date(),
      verificar: verificarClave,
      esComun: esClaveComun,
    })

    if (r.cambios && credencial) {
      const { error } = await sbServicio()
        .from("app_user_credenciales")
        .update({ ...r.cambios, updated_at: new Date().toISOString() })
        .eq("user_id", usuarioId)
      if (error) throw error
    }

    if (!r.ok || !usuario || !credencial) return NextResponse.json({ error: r.error || ERROR_INCORRECTO }, { status: 401 })

    const res = NextResponse.json({ usuario: usuarioParaElNavegador(usuario), debeCambiarClave: r.debeCambiar })
    ponerCookieSesion(res, usuario.id, credencial.sesion_version)
    return res
  } catch (e) {
    return respuestaError(e)
  }
}
