/**
 * Fase 0c-2 · Token para la base (JWT que entiende Supabase). SOLO servidor.
 *
 * Con la sesión de la 0c-1 (cookie firmada), el servidor le da al navegador un token corto para hablar con la
 * base. La base lo reconoce como `authenticated` y sabe quién es (`sub`). Los permisos NO van en el token: la base
 * los lee en el momento de `app_users` (rebucret_permiso), y compara `v` con `sesion_version` (una baja, un
 * blanqueo o un cambio de contraseña lo cortan en el acto).
 *
 * Firmado con HS256 y el secreto JWT del proyecto de Supabase (`SUPABASE_JWT_SECRET`, el "Legacy JWT secret").
 * Sin imports de otros archivos del proyecto (se prueba con `node --test`).
 */
import { createHmac, timingSafeEqual } from "crypto"

/** Dura un turno. El navegador lo renueva cuando le queda menos de RENOVAR_TOKEN_SI_QUEDAN_S. */
export const DURACION_TOKEN_S = 8 * 60 * 60
export const RENOVAR_TOKEN_SI_QUEDAN_S = 60 * 60

export type DatosToken = { sub: string; v: number }

export type ClaimsToken = {
  aud: "authenticated"
  role: "authenticated"
  iss: "rebucret"
  sub: string
  v: number
  iat: number
  exp: number
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function desdeB64url(texto: string): Buffer {
  const b64 = texto.replace(/-/g, "+").replace(/_/g, "/")
  return Buffer.from(b64 + "=".repeat((4 - (b64.length % 4)) % 4), "base64")
}

/** El secreto JWT de Supabase, o null si falta (o es demasiado corto para ser el de verdad). */
export function secretoJwtBase(env: Record<string, string | undefined> = process.env): string | null {
  const s = (env.SUPABASE_JWT_SECRET || "").trim()
  return s.length >= 32 ? s : null
}

export function firmarTokenBase(datos: DatosToken, secreto: string, ahoraMs: number = Date.now(), duracionS: number = DURACION_TOKEN_S): string {
  if (!secreto) throw new Error("Falta el secreto JWT")
  if (typeof datos.sub !== "string" || !datos.sub) throw new Error("Falta el usuario del token")
  if (!Number.isInteger(datos.v)) throw new Error("Falta la versión de sesión del token")
  const iat = Math.floor(ahoraMs / 1000)
  const claims: ClaimsToken = { aud: "authenticated", role: "authenticated", iss: "rebucret", sub: datos.sub, v: datos.v, iat, exp: iat + duracionS }
  const cabecera = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })))
  const cuerpo = b64url(Buffer.from(JSON.stringify(claims)))
  const firma = b64url(createHmac("sha256", secreto).update(`${cabecera}.${cuerpo}`).digest())
  return `${cabecera}.${cuerpo}.${firma}`
}

/** Lee y verifica un token (firma, HS256 y vencimiento). Para las pruebas y el diagnóstico. */
export function leerTokenBase(token: string | null | undefined, secreto: string, ahoraMs: number = Date.now()): ClaimsToken | null {
  if (typeof token !== "string" || !secreto) return null
  const partes = token.split(".")
  if (partes.length !== 3 || partes.some((p) => !p)) return null
  try {
    const cab = JSON.parse(desdeB64url(partes[0]).toString("utf8"))
    if (!cab || cab.alg !== "HS256") return null
    const esperada = createHmac("sha256", secreto).update(`${partes[0]}.${partes[1]}`).digest()
    const recibida = desdeB64url(partes[2])
    if (recibida.length !== esperada.length || !timingSafeEqual(recibida, esperada)) return null
    const c = JSON.parse(desdeB64url(partes[1]).toString("utf8"))
    if (!c || c.role !== "authenticated" || typeof c.sub !== "string" || !Number.isInteger(c.v) || typeof c.exp !== "number") return null
    if (c.exp * 1000 <= ahoraMs) return null
    return c as ClaimsToken
  } catch {
    return null
  }
}
