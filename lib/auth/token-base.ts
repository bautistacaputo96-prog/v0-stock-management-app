/**
 * Fase 0c-2 · Token para la base, del lado del servidor (SOLO rutas de `app/api` y páginas del servidor).
 *
 * - Sin `SUPABASE_JWT_SECRET`: no hay token y todo sigue con la clave pública (como antes de la 0c-2).
 * - Antes de repartir tokens, se prueba UNO contra la base (una lectura de `plants`): si la base lo rechaza (secreto
 *   mal copiado, o el proyecto ya no acepta el "Legacy JWT secret"), no se reparten y se sigue con la clave pública.
 *   Así cargar mal la variable no rompe nada mientras no se corra la migración de RLS. El resultado se guarda
 *   10 minutos en memoria.
 */
import { createHash } from "crypto"
import { firmarTokenBase, secretoJwtBase, DURACION_TOKEN_S } from "@/lib/auth/jwt-supabase"
import { leerCredencial, debeCambiarClave, type Sesion } from "@/lib/auth/servidor"

export type TokenBase = { token: string; segundos: number } | { token: null; motivo: "sin_jwt_secret" | "jwt_rechazado" | "sin_version" }

export type PruebaToken = { aceptado: boolean | null; status: number | null; detalle: string }

const DIEZ_MIN = 10 * 60 * 1000
let pruebaGuardada: { huella: string; hasta: number; resultado: PruebaToken } | null = null

function urlBase(): string {
  return (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").replace(/\/+$/, "")
}

export function clavePublica(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || ""
}

/** Lee una tabla chica con `bearer` (token o clave pública). Devuelve el status y cuántas filas vinieron. */
export async function leerConBearer(bearer: string): Promise<{ status: number | null; filas: number | null; detalle: string }> {
  try {
    const r = await fetch(`${urlBase()}/rest/v1/plants?select=id&limit=1`, {
      headers: { apikey: clavePublica(), Authorization: `Bearer ${bearer}` },
      cache: "no-store",
    })
    const texto = await r.text()
    let filas: number | null = null
    try {
      const d = JSON.parse(texto)
      if (Array.isArray(d)) filas = d.length
    } catch {}
    return { status: r.status, filas, detalle: r.ok ? "ok" : texto.slice(0, 200) }
  } catch (e: any) {
    return { status: null, filas: null, detalle: e?.message || "sin conexión con la base" }
  }
}

/** ¿La base acepta un token firmado con este secreto? (null = no se pudo saber: sin conexión) */
export async function probarSecreto(secreto: string, sub: string, v: number, ahora: number = Date.now()): Promise<PruebaToken> {
  const huella = createHash("sha256").update(secreto).digest("hex")
  if (pruebaGuardada && pruebaGuardada.huella === huella && pruebaGuardada.hasta > ahora) return pruebaGuardada.resultado
  const r = await leerConBearer(firmarTokenBase({ sub, v }, secreto, ahora, 60))
  const resultado: PruebaToken =
    r.status === 401 || r.status === 403
      ? { aceptado: false, status: r.status, detalle: r.detalle }
      : r.status !== null && r.status < 500
        ? { aceptado: true, status: r.status, detalle: r.detalle }
        : { aceptado: null, status: r.status, detalle: r.detalle }
  // Solo se guarda una respuesta clara (aceptado o rechazado)
  if (resultado.aceptado !== null) pruebaGuardada = { huella, hasta: ahora + DIEZ_MIN, resultado }
  else console.warn("[token-base] no se pudo probar el token contra la base:", r.detalle)
  if (resultado.aceptado === false) console.error("[token-base] la base RECHAZA el token: revisar SUPABASE_JWT_SECRET.", r.detalle)
  return resultado
}

/** Token para la persona de la sesión (que ya eligió su contraseña). */
export async function tokenBaseParaSesion(s: Sesion, ahora: number = Date.now()): Promise<TokenBase> {
  const secreto = secretoJwtBase()
  if (!secreto) return { token: null, motivo: "sin_jwt_secret" }
  if (debeCambiarClave(s)) return { token: null, motivo: "sin_version" }
  // En el modo de prueba local no hay cookie: se usa la versión de sesión real (solo lectura)
  const cred = s.credencial || (await leerCredencial(s.usuario.id))
  if (!cred || !Number.isInteger(cred.sesion_version)) return { token: null, motivo: "sin_version" }
  const prueba = await probarSecreto(secreto, s.usuario.id, cred.sesion_version, ahora)
  if (prueba.aceptado === false) return { token: null, motivo: "jwt_rechazado" }
  return { token: firmarTokenBase({ sub: s.usuario.id, v: cred.sesion_version, s: s.datos?.s }, secreto, ahora), segundos: DURACION_TOKEN_S }
}
