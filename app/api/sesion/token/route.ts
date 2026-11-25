import { NextResponse } from "next/server"
import { exigirSesion, respuestaError } from "@/lib/auth/servidor"
import { tokenBaseParaSesion } from "@/lib/auth/token-base"

export const dynamic = "force-dynamic"

/**
 * Fase 0c-2 · Token para que el navegador hable con la base (lib/supabase/client.ts lo pide y lo renueva).
 * 200 {token, segundos} · 200 {token: null, motivo} (sin SUPABASE_JWT_SECRET o la base lo rechaza: el navegador
 * sigue con la clave pública) · 401 sin sesión · 403 si todavía tiene que elegir su contraseña.
 */
export async function GET() {
  try {
    const r = await exigirSesion()
    if (r.respuesta) return r.respuesta
    const res = NextResponse.json(await tokenBaseParaSesion(r.sesion))
    res.headers.set("Cache-Control", "no-store")
    return res
  } catch (e) {
    return respuestaError(e)
  }
}
