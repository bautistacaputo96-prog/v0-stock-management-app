import { NextResponse } from "next/server"
import {
  exigirGerencial,
  leerUsuario,
  desbloquearIngreso,
  registrarActividad,
  modoPruebaLocal,
  respuestaModoLocal,
  respuestaError,
} from "@/lib/auth/servidor"

export const dynamic = "force-dynamic"

/**
 * Fase 0c-2 · Desbloquear el ingreso de una persona frenada por intentos fallidos (solo gerenciales).
 * Borra sus intentos de los últimos minutos (tabla ingreso_intentos); no toca la contraseña.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (modoPruebaLocal()) return respuestaModoLocal()
  try {
    const r = await exigirGerencial()
    if (r.respuesta) return r.respuesta
    const { id } = await params
    const u = await leerUsuario(id)
    if (!u) return NextResponse.json({ error: "Ese usuario no existe." }, { status: 404 })
    const borrados = await desbloquearIngreso(id)
    await registrarActividad({
      usuario: r.sesion.usuario.name,
      action: "editar",
      entity: "usuario",
      entityId: id,
      reference: u.name,
      details: { Ingreso: "desbloqueado (intentos fallidos borrados)", Intentos: borrados },
    })
    return NextResponse.json({ ok: true, borrados })
  } catch (e) {
    return respuestaError(e)
  }
}
