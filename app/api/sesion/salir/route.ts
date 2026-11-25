import { NextResponse } from "next/server"
import { borrarCookieSesion, sesionActual, cerrarSesion, sbServicio, modoPruebaLocal } from "@/lib/auth/servidor"

export const dynamic = "force-dynamic"

/**
 * Fase 0c-1 · Salir (o "cambiar de usuario" en la tablet compartida): borra la cookie de este equipo.
 * Fase 0c-2 · Además corta ESTA sesión en el servidor y en la base: su cookie (si alguien la copió) y su token para la
 * base dejan de valer en el acto (tabla sesiones_cerradas). Las sesiones de la persona en otros equipos siguen.
 * Una cookie vieja sin id de sesión: se sube la versión de sesión (eso sí cierra todos sus equipos).
 */
export async function POST() {
  const res = NextResponse.json({ ok: true })
  borrarCookieSesion(res)
  if (modoPruebaLocal()) return res
  try {
    const s = await sesionActual()
    if (s && s.credencial && s.datos) {
      // Con id de sesión: se anota como cerrada (sin la migración A, como antes: la RLS tampoco está prendida)
      if (s.datos.s) await cerrarSesion(s.datos.s, s.usuario.id)
      else {
        const { error } = await sbServicio()
          .from("app_user_credenciales")
          .update({ sesion_version: s.credencial.sesion_version + 1, updated_at: new Date().toISOString() })
          .eq("user_id", s.usuario.id)
          .eq("sesion_version", s.credencial.sesion_version)
        if (error) console.error("[salir] no se pudo cerrar la sesión en el servidor:", error.message)
      }
    }
  } catch (e) {
    // Sin secreto o sin clave de servicio: igual se borra la cookie de este equipo
    console.error("[salir]", (e as Error)?.message || e)
  }
  return res
}
