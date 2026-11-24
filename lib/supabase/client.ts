import { createClient as crearCliente, type SupabaseClient } from "@supabase/supabase-js"

/**
 * Cliente de la base para el navegador (uno solo para toda la app).
 *
 * Fase 0c-2: cada pedido a la base va con el token de la sesión (`GET /api/sesion/token`), así la base sabe quién
 * es y aplica sus permisos (RLS). Si no hay token (sin sesión, o el servidor todavía no tiene SUPABASE_JWT_SECRET),
 * va con la clave pública como antes: mientras no se corra la migración de RLS, anda igual.
 *
 * El token dura un turno (8 h). Se renueva solo cuando le queda menos de 1 hora; si el servidor no contesta, se
 * sigue usando el que hay hasta que vence. `olvidarTokenBase()` al entrar, salir o cambiar la contraseña.
 */

type EstadoToken = {
  valor: string | null
  /** Desde cuándo conviene pedir uno nuevo (ms, reloj del navegador). */
  renovarDesde: number
  /** Hasta cuándo sirve el que hay (ms, reloj del navegador). */
  sirveHasta: number
}

const MARGEN_MS = 60 * 1000
const RENOVAR_SI_QUEDAN_MS = 60 * 60 * 1000
/** Sin token (sin sesión o sin secreto en el servidor): cada cuánto se vuelve a preguntar. */
const SIN_TOKEN_REPREGUNTAR_MS = 5 * 60 * 1000
/** Si falla la renovación, cada cuánto se reintenta (mientras tanto, el token que hay). */
const REINTENTO_MS = 60 * 1000

let estado: EstadoToken | null = null
let pedidoEnCurso: Promise<string | null> | null = null
let cliente: SupabaseClient | null = null

async function pedirToken(): Promise<string | null> {
  const ahora = Date.now()
  try {
    const r = await fetch("/api/sesion/token", { cache: "no-store", credentials: "same-origin" })
    if (r.status === 401 || r.status === 403) {
      estado = { valor: null, renovarDesde: ahora + SIN_TOKEN_REPREGUNTAR_MS, sirveHasta: ahora + SIN_TOKEN_REPREGUNTAR_MS }
      return null
    }
    if (!r.ok) throw new Error(String(r.status))
    const d = await r.json()
    if (typeof d?.token === "string" && d.token && Number(d.segundos) > 0) {
      const sirveHasta = ahora + Number(d.segundos) * 1000 - MARGEN_MS
      estado = { valor: d.token, sirveHasta, renovarDesde: Math.max(ahora + REINTENTO_MS, sirveHasta - RENOVAR_SI_QUEDAN_MS) }
      return d.token
    }
    estado = { valor: null, renovarDesde: ahora + SIN_TOKEN_REPREGUNTAR_MS, sirveHasta: ahora + SIN_TOKEN_REPREGUNTAR_MS }
    return null
  } catch {
    // Sin servidor: el token que había sigue sirviendo hasta que vence; se reintenta en un minuto
    if (estado?.valor && estado.sirveHasta > ahora) {
      estado = { ...estado, renovarDesde: ahora + REINTENTO_MS }
      return estado.valor
    }
    estado = { valor: null, renovarDesde: ahora + REINTENTO_MS, sirveHasta: ahora + REINTENTO_MS }
    return null
  }
}

/** Token vigente para la base, o null (= clave pública). En el servidor siempre null. */
export async function tokenBase(): Promise<string | null> {
  if (typeof window === "undefined") return null
  const ahora = Date.now()
  if (estado && ahora < estado.renovarDesde) return estado.valor
  if (!pedidoEnCurso) {
    pedidoEnCurso = pedirToken().finally(() => {
      pedidoEnCurso = null
    })
  }
  // Mientras se renueva, el que hay (si todavía sirve) no hace esperar a nadie
  if (estado?.valor && ahora < estado.sirveHasta) return estado.valor
  return pedidoEnCurso
}

/** Al entrar, salir o cambiar la contraseña: el próximo pedido a la base pide un token nuevo. */
export function olvidarTokenBase() {
  estado = null
}

export function createClient(): SupabaseClient {
  if (cliente) return cliente
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  cliente = crearCliente(supabaseUrl!, supabaseKey!, {
    // Sin Supabase Auth: la sesión es la de la 0c-1 (cookie del servidor) y la base recibe su token
    accessToken: tokenBase,
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  return cliente
}
