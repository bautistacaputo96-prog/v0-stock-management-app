import { NextResponse } from "next/server"
import { WIALON_LOGIN, WIALON_ACCESS, validarToken, sbAdmin } from "@/lib/wialon"
import { exigirGerencial, respuestaError, respuestaModoLocal } from "@/lib/auth/servidor"

/**
 * Conexión con B-Track (Wialon).
 *  1. Sin parámetros: redirige a la página de Wialon, donde el usuario entra con
 *     su usuario de B-Track y autoriza el acceso de solo lectura.
 *  2. Wialon vuelve acá con ?access_token=…: se valida y se guarda en
 *     `integraciones` (nadie lo ve: la tabla solo la lee el servidor).
 */
/**
 * Alternativa: el usuario pega un token que le generó el soporte de Bilderit.
 * Se valida contra Wialon antes de guardarlo.
 * Las dos vías son solo para gerenciales (gps-vivo.md): reemplazar el token cambia el GPS de todo el sistema.
 */
export async function POST(req: Request) {
  let quien: string
  try {
    const r = await exigirGerencial()
    if (r.respuesta) return r.respuesta
    if (r.sesion.local) return respuestaModoLocal()
    quien = r.sesion.usuario.name
  } catch (e) {
    return respuestaError(e)
  }
  try {
    const { token } = await req.json()
    const t = String(token || "").trim()
    if (t.length < 20) return NextResponse.json({ error: "Ese token no parece válido" }, { status: 400 })
    const { usuario } = await validarToken(t)
    const { error } = await sbAdmin().from("integraciones").upsert({
      clave: "wialon_token",
      valor: t,
      usuario,
      conectado_por: quien,
      actualizado: new Date().toISOString(),
    })
    if (error) throw error
    return NextResponse.json({ ok: true, usuario })
  } catch (e: any) {
    return NextResponse.json({ error: e?.code ? "Wialon rechazó el token" : e?.message || "No se pudo conectar" }, { status: 400 })
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const token = url.searchParams.get("access_token")
  const base = `${url.protocol}//${url.host}`
  const volver = (error: string) => NextResponse.redirect(`${base}/logistica?error=${encodeURIComponent(error)}`)

  // La ida y la vuelta de Wialon son navegaciones del navegador: llevan la cookie de sesión
  let quien: string
  try {
    const r = await exigirGerencial()
    if (r.respuesta) return volver(r.respuesta.status === 401 ? "Tu sesión se cerró. Entrá de nuevo." : "Solo un gerencial puede conectar el GPS.")
    if (r.sesion.local) return volver("Modo prueba local: no se graba nada.")
    quien = r.sesion.usuario.name
  } catch {
    return volver("No se pudo verificar la sesión.")
  }

  if (!token) {
    const login = new URL(WIALON_LOGIN)
    login.searchParams.set("client_id", "Rebucret Produccion")
    login.searchParams.set("access_type", String(WIALON_ACCESS))
    login.searchParams.set("activation_time", "0")
    login.searchParams.set("duration", "0") // sin vencimiento (Wialon lo borra si no se usa en 100 días)
    login.searchParams.set("lang", "es")
    login.searchParams.set("flags", "0x1")
    login.searchParams.set("redirect_uri", `${base}/api/gps/conectar`)
    return NextResponse.redirect(login.toString())
  }

  try {
    const { usuario } = await validarToken(token)
    const { error } = await sbAdmin().from("integraciones").upsert({
      clave: "wialon_token",
      valor: token,
      usuario,
      conectado_por: url.searchParams.get("user_name") || quien,
      actualizado: new Date().toISOString(),
    })
    if (error) throw error
    return NextResponse.redirect(`${base}/logistica?conectado=1`)
  } catch (e: any) {
    return volver(e?.message || "No se pudo conectar")
  }
}
