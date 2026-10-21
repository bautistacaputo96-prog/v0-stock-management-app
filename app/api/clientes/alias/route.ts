/**
 * Alias de un cliente: cuando se confirma que dos nombres son el mismo cliente ("MERVA" y "MERVA SA"), el otro
 * nombre se guarda como alias para que el buscador lo encuentre por cualquiera de los dos.
 *
 *   POST /api/clientes/alias   {client_id, alias}   con permiso clientes.cargar
 */
import { NextResponse } from "next/server"
import { exigirSesion, modoPruebaLocal, respuestaModoLocal, respuestaError, registrarActividad, sbServicio } from "@/lib/auth/servidor"
import { puedeCon } from "@/lib/permisos"
import { normalizarAlias } from "@/lib/clientes-buscar"
import { olvidarClientes } from "@/lib/clientes-datos"

export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  if (modoPruebaLocal()) return respuestaModoLocal()
  try {
    const r = await exigirSesion()
    if (r.respuesta) return r.respuesta
    if (!puedeCon(r.sesion.usuario, "clientes", "cargar")) return NextResponse.json({ error: "No tenés permiso para cargar clientes." }, { status: 403 })
    const body = await req.json().catch(() => ({}))
    const id = String(body?.client_id || "")
    const alias = String(body?.alias || "").replace(/\s+/g, " ").trim().slice(0, 120)
    if (!/^[0-9a-f-]{36}$/i.test(id) || alias.length < 2) return NextResponse.json({ error: "Faltan datos" }, { status: 400 })
    const sb = sbServicio()
    const { data: c } = await sb.from("clients").select("id, name, razon_social").eq("id", id).maybeSingle()
    if (!c) return NextResponse.json({ error: "No existe el cliente" }, { status: 404 })
    const norm = normalizarAlias(alias)
    if ([c.name, c.razon_social].some((n: any) => normalizarAlias(n) === norm)) return NextResponse.json({ ok: true, igual: true })
    const { error } = await sb.from("client_alias").upsert({ client_id: id, alias, alias_norm: norm, origen: body?.origen === "alta" ? "alta" : "manual", creado_por: r.sesion.usuario.name }, { onConflict: "client_id,alias_norm", ignoreDuplicates: true })
    if (error) {
      if (/client_alias/.test(error.message || "")) return NextResponse.json({ error: "Falta aplicar la migración de alias (202610212100)." }, { status: 500 })
      throw error
    }
    olvidarClientes()
    await registrarActividad({ usuario: r.sesion.usuario.name, action: "editar", entity: "cliente", entityId: id, reference: (c as any).name, details: { "Alias agregado": alias } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return respuestaError(e)
  }
}
