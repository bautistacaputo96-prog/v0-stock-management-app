import { NextResponse } from "next/server"
import { hashClave, validarClaveNueva } from "@/lib/auth/clave"
import {
  sbServicio,
  exigirGerencial,
  usuarioParaLaPantalla,
  registrarActividad,
  modoPruebaLocal,
  respuestaModoLocal,
  respuestaError,
  COLUMNAS_USUARIO,
  COLUMNAS_CREDENCIAL,
  type FilaUsuario,
  type FilaCredencial,
} from "@/lib/auth/servidor"
import { esTipo, normalizarPermisos, normalizarNombre, plantilla, seccionesCon, NOMBRE_TIPO } from "@/lib/permisos"

export const dynamic = "force-dynamic"

/** Fase 0c-1 · Pantalla Usuarios: lista completa (solo gerenciales). Nunca devuelve hashes. */
export async function GET() {
  try {
    const r = await exigirGerencial()
    if (r.respuesta) return r.respuesta
    const sb = sbServicio()
    const [us, cs] = await Promise.all([
      sb.from("app_users").select(COLUMNAS_USUARIO).order("name"),
      sb.from("app_user_credenciales").select(COLUMNAS_CREDENCIAL),
    ])
    if (us.error) throw us.error
    if (cs.error) throw cs.error
    const porId = new Map(((cs.data as FilaCredencial[] | null) || []).map((c) => [c.user_id, c]))
    const lista = ((us.data as FilaUsuario[] | null) || []).map((u) => usuarioParaLaPantalla(u, porId.get(u.id)))
    const res = NextResponse.json({ usuarios: lista, yo: r.sesion.usuario.id, modoPruebaLocal: r.sesion.local || undefined })
    res.headers.set("Cache-Control", "no-store")
    return res
  } catch (e) {
    return respuestaError(e)
  }
}

/** Alta. Body: {name, email?, tipo, permisos?, claveInicial}. La persona cambia la contraseña al entrar. */
export async function POST(req: Request) {
  if (modoPruebaLocal()) return respuestaModoLocal()
  try {
    const r = await exigirGerencial()
    if (r.respuesta) return r.respuesta
    const yo = r.sesion.usuario.name
    const body = await req.json().catch(() => ({}))

    const name = String(body?.name || "").replace(/\s+/g, " ").trim()
    const email = String(body?.email || "").trim() || null
    const tipo = body?.tipo
    const claveInicial = typeof body?.claveInicial === "string" ? body.claveInicial : ""
    if (name.length < 3) return NextResponse.json({ error: "Poné el nombre y apellido." }, { status: 400 })
    if (!esTipo(tipo)) return NextResponse.json({ error: "Elegí el tipo de usuario." }, { status: 400 })
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "El mail no parece válido." }, { status: 400 })
    const errClave = validarClaveNueva(name, claveInicial)
    if (errClave) return NextResponse.json({ error: errClave }, { status: 400 })

    const sb = sbServicio()
    const { data: todos, error: eTodos } = await sb.from("app_users").select("id, name")
    if (eTodos) throw eTodos
    if ((todos || []).some((u: any) => normalizarNombre(u.name) === normalizarNombre(name)))
      return NextResponse.json({ error: "Ya hay un usuario con ese nombre." }, { status: 400 })

    const permisos = tipo === "gerencial" ? plantilla("gerencial") : normalizarPermisos(body?.permisos ?? plantilla(tipo))
    const ahora = new Date().toISOString()
    const { data: creado, error } = await sb
      .from("app_users")
      .insert({
        name,
        email,
        active: true,
        role: tipo === "gerencial" ? "supervisor" : "operario",
        tipo,
        permisos,
        permisos_actualizados_at: ahora,
        permisos_actualizados_por: yo,
      })
      .select(COLUMNAS_USUARIO)
      .single()
    if (error) {
      if ((error as any).code === "23505") return NextResponse.json({ error: "Ya hay un usuario con ese nombre." }, { status: 400 })
      throw error
    }
    const u = creado as FilaUsuario

    const { data: cred, error: eCred } = await sb
      .from("app_user_credenciales")
      .insert({
        user_id: u.id,
        clave_hash: await hashClave(claveInicial),
        debe_cambiar: true,
        permite_clave_comun: false,
        clave_cambiada_at: ahora,
        actualizado_por: yo,
      })
      .select(COLUMNAS_CREDENCIAL)
      .single()
    if (eCred) {
      // Sin contraseña la persona no podría entrar: se deshace el alta (es una fila recién creada)
      await sb.from("app_users").delete().eq("id", u.id)
      throw eCred
    }

    const fila = usuarioParaLaPantalla(u, cred as FilaCredencial)
    await registrarActividad({
      usuario: yo,
      action: "crear",
      entity: "usuario",
      entityId: u.id,
      reference: u.name,
      details: {
        Tipo: NOMBRE_TIPO[fila.tipo],
        "Carga en": seccionesCon(fila, "cargar").join(", ") || "-",
        "Edita": seccionesCon(fila, "editar").join(", ") || "-",
        "Borra": seccionesCon(fila, "borrar").join(", ") || "-",
        ...(email ? { Mail: email } : {}),
        "Contraseña": "inicial dada por un gerencial (la cambia al entrar)",
      },
    })
    return NextResponse.json({ usuario: fila })
  } catch (e) {
    return respuestaError(e)
  }
}
