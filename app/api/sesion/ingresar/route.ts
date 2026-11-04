import { NextResponse } from "next/server"
import { verificarClave, esClaveComun } from "@/lib/auth/clave"
import { decidirIngreso, errorTrasIntentoFallido, ERROR_INCORRECTO } from "@/lib/auth/ingreso"
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
 * Los intentos fallidos y el reseteo al entrar se graban con funciones atómicas de la base
 * (registrar_ingreso_fallido / registrar_ingreso_ok): varios pedidos al mismo tiempo cuentan todos, y si
 * la cuenta se bloqueó mientras se verificaba la contraseña, no entra.
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

    if (!r.ok) {
      // Contraseña mal (decidirIngreso pide grabar intentos): suma 1 en la base, en forma atómica
      if (r.cambios && credencial) {
        const { data, error } = await sbServicio().rpc("registrar_ingreso_fallido", { p_user_id: usuarioId })
        if (error) throw error
        const fila = Array.isArray(data) ? data[0] : data
        return NextResponse.json({ error: errorTrasIntentoFallido(fila, new Date()) }, { status: 401 })
      }
      return NextResponse.json({ error: r.error || ERROR_INCORRECTO }, { status: 401 })
    }
    if (!usuario || !credencial) return NextResponse.json({ error: ERROR_INCORRECTO }, { status: 401 })

    // Bien: intentos a 0 y último ingreso. Sin bloqueo por intentos (04/11/2026): si la base todavía tenía
    // bloqueado_hasta (registrar_ingreso_ok no graba en ese caso), se limpia acá y entra igual
    const { data: puedeEntrar, error: eOk } = await sbServicio().rpc("registrar_ingreso_ok", { p_user_id: usuarioId })
    if (eOk) throw eOk
    if (puedeEntrar !== true) {
      const { error: eLimpia } = await sbServicio().from("app_user_credenciales")
        .update({ intentos_fallidos: 0, bloqueado_hasta: null, ultimo_ingreso_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("user_id", usuarioId)
      if (eLimpia) throw eLimpia
    }

    const res = NextResponse.json({ usuario: usuarioParaElNavegador(usuario), debeCambiarClave: r.debeCambiar })
    ponerCookieSesion(res, usuario.id, credencial.sesion_version)
    return res
  } catch (e) {
    return respuestaError(e)
  }
}
