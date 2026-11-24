import { createClient as crearCliente } from "@supabase/supabase-js"
import { sesionActual } from "@/lib/auth/servidor"
import { tokenBaseParaSesion } from "@/lib/auth/token-base"

/**
 * Cliente de la base para las páginas y rutas del servidor que leen "como la persona".
 *
 * Fase 0c-2: con la sesión de la cookie (0c-1) va con el token de esa persona, así la base aplica sus permisos (RLS).
 * Sin sesión, o sin SUPABASE_JWT_SECRET, va con la clave pública como antes (después de la migración de RLS, eso
 * no ve nada: el login vuelve a pedir la página al entrar).
 *
 * No guardarlo en una variable global: cada pedido es de una persona distinta.
 */
export async function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY

  let token: string | null = null
  try {
    const s = await sesionActual()
    if (s) {
      const t = await tokenBaseParaSesion(s)
      token = t.token
    }
  } catch (e) {
    // Sin SESION_SECRETO o sin clave de servicio: sigue con la clave pública (el login avisa lo que falta)
    console.warn("[supabase/server] sin token de sesión:", (e as Error)?.message || e)
  }

  return crearCliente(supabaseUrl!, supabaseKey!, {
    accessToken: async () => token,
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}
