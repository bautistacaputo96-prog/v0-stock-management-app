import { NextResponse } from "next/server"
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
  COLUMNAS_USUARIO,
  type FilaUsuario,
} from "@/lib/auth/servidor"
import { esTipo, tipoDe, normalizarPermisos, plantilla, cambiosDePermisos, NOMBRE_TIPO, type Tipo } from "@/lib/permisos"

export const dynamic = "force-dynamic"

/**
 * Fase 0c-1 · Cambiar a una persona (solo gerenciales).
 * Body: {tipo?, permisos?, email?, active?, ve_funciones_nuevas?}.
 * - Si cambia el tipo, se aplica la plantilla del tipo salvo que vengan permisos.
 * - Frenos: nadie se da de baja a sí mismo; siempre queda al menos un gerencial activo.
 * - Baja: cierra las sesiones de la persona (sesion_version + 1).
 * - El nombre no se edita (los registros viejos quedarían con el nombre anterior).
 * Queda en Actividad el antes y el después de cada campo.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (modoPruebaLocal()) return respuestaModoLocal()
  try {
    const r = await exigirGerencial()
    if (r.respuesta) return r.respuesta
    const yo = r.sesion.usuario
    const { id } = await params
    const body = await req.json().catch(() => ({}))

    const antes = await leerUsuario(id)
    if (!antes) return NextResponse.json({ error: "Ese usuario no existe." }, { status: 404 })

    const tipoAntes = tipoDe(antes)
    const activoAntes = antes.active !== false
    const cambios: Record<string, unknown> = {}
    const detalle: Record<string, string> = {}

    // Tipo y permisos
    let tipoNuevo: Tipo = tipoAntes
    if (body?.tipo !== undefined) {
      if (!esTipo(body.tipo)) return NextResponse.json({ error: "Tipo inválido." }, { status: 400 })
      tipoNuevo = body.tipo
    }
    let permisosNuevos = normalizarPermisos(antes.permisos)
    if (tipoNuevo !== tipoAntes) permisosNuevos = body?.permisos !== undefined ? normalizarPermisos(body.permisos) : plantilla(tipoNuevo)
    else if (body?.permisos !== undefined) permisosNuevos = normalizarPermisos(body.permisos)
    if (tipoNuevo === "gerencial") permisosNuevos = plantilla("gerencial") // gerencial puede todo

    const difPermisos = cambiosDePermisos(antes.permisos, permisosNuevos)
    if (tipoNuevo !== tipoAntes) {
      cambios.tipo = tipoNuevo
      cambios.role = tipoNuevo === "gerencial" ? "supervisor" : "operario" // por si algún script viejo la mira
      detalle.Tipo = `${NOMBRE_TIPO[tipoAntes]} → ${NOMBRE_TIPO[tipoNuevo]}`
    }
    if (Object.keys(difPermisos).length > 0) {
      cambios.permisos = permisosNuevos
    }
    Object.assign(detalle, difPermisos)
    if (cambios.tipo !== undefined || cambios.permisos !== undefined) {
      cambios.permisos_actualizados_at = new Date().toISOString()
      cambios.permisos_actualizados_por = yo.name
    }

    // Mail
    if (body?.email !== undefined) {
      const email = String(body.email || "").trim() || null
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "El mail no parece válido." }, { status: 400 })
      if (email !== (antes.email || null)) {
        cambios.email = email
        detalle.Mail = `${antes.email || "-"} → ${email || "-"}`
      }
    }

    // Activo (baja / reactivar)
    let activoNuevo = activoAntes
    if (body?.active !== undefined) {
      activoNuevo = body.active === true
      if (activoNuevo !== activoAntes) {
        if (!activoNuevo && id === yo.id) return NextResponse.json({ error: "No te podés dar de baja a vos mismo." }, { status: 400 })
        cambios.active = activoNuevo
        detalle.Activo = activoNuevo ? "dado de baja → reactivado" : "activo → dado de baja"
      }
    }

    // Funciones nuevas en prueba (fase 2): mismo texto que tenía en Actividad
    if (body?.ve_funciones_nuevas !== undefined) {
      const v = body.ve_funciones_nuevas === true
      if (v !== (antes.ve_funciones_nuevas === true)) {
        cambios.ve_funciones_nuevas = v
        detalle["Funciones nuevas en prueba"] = v ? "apagadas → prendidas" : "prendidas → apagadas"
      }
    }

    if (Object.keys(cambios).length === 0) {
      const cred = await leerCredencial(id)
      return NextResponse.json({ usuario: usuarioParaLaPantalla(antes, cred), sinCambios: true })
    }

    // Siempre tiene que quedar al menos un gerencial activo
    const dejaDeSerGerencialActivo = tipoAntes === "gerencial" && activoAntes && (tipoNuevo !== "gerencial" || !activoNuevo)
    if (dejaDeSerGerencialActivo) {
      const { data: gers, error: eG } = await sbServicio().from("app_users").select("id").eq("tipo", "gerencial").eq("active", true).neq("id", id)
      if (eG) throw eG
      if (!gers || gers.length === 0) return NextResponse.json({ error: "Tiene que quedar al menos un gerencial activo." }, { status: 400 })
    }

    const { data: actualizado, error } = await sbServicio().from("app_users").update(cambios).eq("id", id).select(COLUMNAS_USUARIO).single()
    if (error) throw error

    let cred = await leerCredencial(id)
    if (cambios.active === false && cred) {
      // La baja cierra las sesiones abiertas de la persona
      const { error: eC } = await sbServicio()
        .from("app_user_credenciales")
        .update({ sesion_version: cred.sesion_version + 1, actualizado_por: yo.name, updated_at: new Date().toISOString() })
        .eq("user_id", id)
      if (eC) throw eC
      cred = { ...cred, sesion_version: cred.sesion_version + 1 }
    }

    await registrarActividad({
      usuario: yo.name,
      action: "editar",
      entity: "usuario",
      entityId: id,
      reference: antes.name,
      details: detalle,
    })

    return NextResponse.json({ usuario: usuarioParaLaPantalla(actualizado as FilaUsuario, cred) })
  } catch (e) {
    return respuestaError(e)
  }
}
