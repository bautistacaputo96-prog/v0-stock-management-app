import { NextResponse } from "next/server"
import { hashClave, verificarClave, validarClaveNueva } from "@/lib/auth/clave"
import {
  sbServicio,
  exigirSesion,
  debeCambiarClave,
  ponerCookieSesion,
  usuarioParaElNavegador,
  registrarActividad,
  modoPruebaLocal,
  respuestaModoLocal,
  respuestaError,
} from "@/lib/auth/servidor"

export const dynamic = "force-dynamic"

/**
 * Fase 0c-1 · Elegir o cambiar la contraseña propia. Body: {actual?, nueva}.
 * - Si tiene que elegirla (primer ingreso, alta o blanqueo): no pide la actual.
 * - Si es un cambio voluntario: pide la actual.
 * Cierra las otras sesiones de la persona (sesion_version + 1) y deja una cookie nueva para este equipo.
 */
export async function POST(req: Request) {
  if (modoPruebaLocal()) return respuestaModoLocal()
  try {
    const r = await exigirSesion({ permitirDebeCambiar: true })
    if (r.respuesta) return r.respuesta
    const { usuario, credencial } = r.sesion
    if (!credencial) return NextResponse.json({ error: "Tu sesión se cerró. Entrá de nuevo." }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const nueva = typeof body?.nueva === "string" ? body.nueva : ""
    const actual = typeof body?.actual === "string" ? body.actual : ""
    const eligiendo = debeCambiarClave(r.sesion)

    if (!eligiendo) {
      if (!actual) return NextResponse.json({ error: "Poné tu contraseña actual." }, { status: 400 })
      if (!(await verificarClave(actual, credencial.clave_hash))) return NextResponse.json({ error: "La contraseña actual no es correcta." }, { status: 400 })
    }
    const err = validarClaveNueva(usuario.name, nueva)
    if (err) return NextResponse.json({ error: err }, { status: 400 })
    if (credencial.clave_hash && (await verificarClave(nueva, credencial.clave_hash)))
      return NextResponse.json({ error: "No uses la de antes: elegí una contraseña distinta." }, { status: 400 })

    const ahora = new Date().toISOString()
    const version = credencial.sesion_version + 1
    const { data, error } = await sbServicio()
      .from("app_user_credenciales")
      .update({
        clave_hash: await hashClave(nueva),
        debe_cambiar: false,
        permite_clave_comun: false,
        intentos_fallidos: 0,
        bloqueado_hasta: null,
        sesion_version: version,
        clave_cambiada_at: ahora,
        actualizado_por: usuario.name,
        updated_at: ahora,
      })
      .eq("user_id", usuario.id)
      .eq("sesion_version", credencial.sesion_version) // si otro la cambió al mismo tiempo, no se pisa
      .select("user_id")
    if (error) throw error
    if (!data || data.length === 0) return NextResponse.json({ error: "Tu sesión se cerró. Entrá de nuevo." }, { status: 409 })

    await registrarActividad({
      usuario: usuario.name,
      action: "editar",
      entity: "usuario",
      entityId: usuario.id,
      reference: usuario.name,
      details: { "Contraseña": eligiendo ? "eligió su contraseña" : "cambió su contraseña" },
    })

    const res = NextResponse.json({ ok: true, usuario: usuarioParaElNavegador(usuario), debeCambiarClave: false })
    ponerCookieSesion(res, usuario.id, version)
    return res
  } catch (e) {
    return respuestaError(e)
  }
}
