/**
 * Zomatik Z2b · Vendedor de Zomatik de cada usuario de la app (respuesta 4 del 23/10). Solo gerenciales.
 * La NP lleva el vendedor de quien programa; si no tiene, el del cliente; si tampoco, error "cargale el vendedor".
 *
 *   GET  /api/zomatik/np/vendedores                       usuarios activos con su vendedor
 *   POST /api/zomatik/np/vendedores {app_user_id, vendedor_id, vendedor_nombre}   vendedor_id vacío = sacarlo
 */
import { NextResponse } from "next/server"
import { exigirGerencial, respuestaError, respuestaModoLocal, sbServicio } from "@/lib/auth/servidor"
import { actividadNp, faltaMigracion } from "@/lib/zomatik/np-servidor"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const r = await exigirGerencial()
    if (r.respuesta) return r.respuesta
    const sb = sbServicio()
    const [{ data: us, error: e1 }, { data: vs, error: e2 }] = await Promise.all([
      sb.from("app_users").select("id, name").eq("active", true).order("name"),
      sb.from("zomatik_vendedores").select("app_user_id, vendedor_id, vendedor_nombre"),
    ])
    if (e1) throw e1
    if (e2) {
      if (faltaMigracion(e2)) return NextResponse.json({ usuarios: [], sinMigracion: true })
      throw e2
    }
    const porUsuario = new Map(((vs as { app_user_id: string; vendedor_id: number; vendedor_nombre: string | null }[]) || []).map((v) => [v.app_user_id, v]))
    return NextResponse.json({
      usuarios: ((us as { id: string; name: string }[]) || []).map((u) => ({ id: u.id, name: u.name, vendedor_id: porUsuario.get(u.id)?.vendedor_id ?? null, vendedor_nombre: porUsuario.get(u.id)?.vendedor_nombre ?? null })),
    })
  } catch (e) {
    return respuestaError(e)
  }
}

export async function POST(req: Request) {
  try {
    const r = await exigirGerencial()
    if (r.respuesta) return r.respuesta
    if (r.sesion.local) return respuestaModoLocal()
    const body = await req.json().catch(() => ({}))
    const id = typeof body?.app_user_id === "string" && /^[0-9a-f-]{36}$/i.test(body.app_user_id) ? body.app_user_id : null
    if (!id) return NextResponse.json({ error: "Falta el usuario" }, { status: 400 })
    const vid = body?.vendedor_id === null || body?.vendedor_id === "" || body?.vendedor_id === undefined ? null : Number(body.vendedor_id)
    if (vid !== null && (!Number.isInteger(vid) || vid <= 0)) return NextResponse.json({ error: "El número de vendedor no es válido." }, { status: 400 })
    const nombre = String(body?.vendedor_nombre || "").trim().toUpperCase().slice(0, 80)
    const sb = sbServicio()
    if (vid === null) {
      const { error } = await sb.from("zomatik_vendedores").delete().eq("app_user_id", id)
      if (error) throw error
    } else {
      const { error } = await sb.from("zomatik_vendedores").upsert({ app_user_id: id, vendedor_id: vid, vendedor_nombre: nombre || null, updated_by: r.sesion.usuario.name, updated_at: new Date().toISOString() } as never, { onConflict: "app_user_id" })
      if (error) throw error
    }
    const { data: u } = await sb.from("app_users").select("name").eq("id", id).maybeSingle()
    await actividadNp(sb, { usuario: r.sesion.usuario.name, pedidoId: null, referencia: "Vendedor de Zomatik", detalle: { "Qué pasó": vid === null ? "Se sacó el vendedor de Zomatik" : `Vendedor de Zomatik ${vid}${nombre ? ` (${nombre})` : ""}`, Usuario: (u as { name?: string } | null)?.name || id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return respuestaError(e)
  }
}
