import { NextResponse } from "next/server"
import { exigirGerencial, leerCredencial, respuestaError } from "@/lib/auth/servidor"
import { secretoJwtBase, firmarTokenBase } from "@/lib/auth/jwt-supabase"
import { leerConBearer, clavePublica } from "@/lib/auth/token-base"

export const dynamic = "force-dynamic"

/**
 * Fase 0c-2 · Control ANTES de correr la migración de RLS (solo gerenciales). Abrirlo en el navegador:
 *   https://www.produccionrebucret.com/api/sesion/token/probar
 * Tiene que decir "tokenAceptado": true. Nunca muestra el secreto ni el token.
 * "laClavePublicaVeDatos": true antes de la migración de RLS, false después.
 */
export async function GET() {
  try {
    const r = await exigirGerencial()
    if (r.respuesta) return r.respuesta
    const secreto = secretoJwtBase()
    const publica = await leerConBearer(clavePublica())
    let token: { status: number | null; filas: number | null; detalle: string } | null = null
    if (secreto) {
      const cred = r.sesion.credencial || (await leerCredencial(r.sesion.usuario.id))
      token = await leerConBearer(firmarTokenBase({ sub: r.sesion.usuario.id, v: cred?.sesion_version ?? 0 }, secreto, Date.now(), 60))
    }
    const tokenAceptado = token ? token.status !== null && token.status < 400 : null
    const res = NextResponse.json({
      jwtSecretCargado: !!secreto,
      tokenAceptado,
      tokenVeDatos: token ? (token.filas ?? 0) > 0 : null,
      laClavePublicaVeDatos: (publica.filas ?? 0) > 0,
      detalle: token && !tokenAceptado ? token.detalle : undefined,
      queHacer: !secreto
        ? "Falta SUPABASE_JWT_SECRET en Vercel (Production y Preview). Después, volver a publicar."
        : tokenAceptado
          ? "Listo: la base acepta el token. Se puede seguir con Concretus y la migración de RLS."
          : "La base rechaza el token: revisar que SUPABASE_JWT_SECRET sea el \"Legacy JWT secret\" de Supabase (Settings > JWT Keys). No correr la migración de RLS.",
    })
    res.headers.set("Cache-Control", "no-store")
    return res
  } catch (e) {
    return respuestaError(e)
  }
}
