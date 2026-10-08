import { NextResponse } from "next/server"
import { hashClave, validarClaveNueva } from "@/lib/auth/clave"
import {
  sbServicio,
  exigirGerencial,
  leerUsuario,
  leerCredencial,
  usuarioParaLaPantalla,
  registrarActividad,
  modoPruebaLocal,
  respuestaModoLocal,
  respuestaError,
  COLUMNAS_CREDENCIAL,
  type FilaCredencial,
} from "@/lib/auth/servidor"

export const dynamic = "force-dynamic"

/**
 * Fase 0c-1 · Blanqueo de contraseña (solo gerenciales). Body: {claveInicial}.
 * La persona entra con esa y tiene que elegir la suya. Desbloquea y cierra sus sesiones abiertas.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (modoPruebaLocal()) return respuestaModoLocal()
  try {
    const r = await exigirGerencial()
    if (r.respuesta) return r.respuesta
    const yo = r.sesion.usuario
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const claveInicial = typeof body?.claveInicial === "string" ? body.claveInicial : ""

    const u = await leerUsuario(id)
    if (!u) return NextResponse.json({ error: "Ese usuario no existe." }, { status: 404 })
    const err = validarClaveNueva(u.name, claveInicial)
    if (err) return NextResponse.json({ error: err }, { status: 400 })

    const antes = await leerCredencial(id)
    const ahora = new Date().toISOString()
    const fila = {
      user_id: id,
      clave_hash: await hashClave(claveInicial),
      debe_cambiar: true,
      permite_clave_comun: false,
      intentos_fallidos: 0,
      bloqueado_hasta: null,
      sesion_version: (antes?.sesion_version ?? 0) + 1,
      clave_cambiada_at: ahora,
      actualizado_por: yo.name,
      updated_at: ahora,
    }
    const { data, error } = await sbServicio().from("app_user_credenciales").upsert(fila, { onConflict: "user_id" }).select(COLUMNAS_CREDENCIAL).single()
    if (error) throw error

    await registrarActividad({
      usuario: yo.name,
      action: "editar",
      entity: "usuario",
      entityId: id,
      reference: u.name,
      details: { "Contraseña": "blanqueada (la cambia al entrar)", "Sesiones abiertas": "cerradas" },
    })
    return NextResponse.json({ usuario: usuarioParaLaPantalla(u, data as FilaCredencial) })
  } catch (e) {
    return respuestaError(e)
  }
}
