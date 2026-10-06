import { NextResponse } from "next/server"
import { RENOVAR_SI_QUEDAN_MS } from "@/lib/auth/token"
import {
  sesionActual,
  usuarioParaElNavegador,
  debeCambiarClave,
  ponerCookieSesion,
  borrarCookieSesion,
  respuestaError,
} from "@/lib/auth/servidor"

export const dynamic = "force-dynamic"

/**
 * Fase 0c-1 · ¿Quién está en sesión? 200 {usuario, debeCambiarClave} o 401.
 * Los permisos se leen de la base en cada llamada (el navegador solo los guarda en caché).
 * Renueva la cookie cuando le quedan menos de 15 días.
 */
export async function GET() {
  try {
    const s = await sesionActual()
    if (!s) {
      const res = NextResponse.json({ error: "Sin sesión" }, { status: 401 })
      borrarCookieSesion(res)
      return res
    }
    const res = NextResponse.json({
      usuario: usuarioParaElNavegador(s.usuario),
      debeCambiarClave: debeCambiarClave(s),
      modoPruebaLocal: s.local || undefined,
    })
    if (!s.local && s.datos && s.credencial && s.datos.e - Date.now() < RENOVAR_SI_QUEDAN_MS) {
      ponerCookieSesion(res, s.usuario.id, s.credencial.sesion_version)
    }
    res.headers.set("Cache-Control", "no-store")
    return res
  } catch (e) {
    return respuestaError(e)
  }
}
