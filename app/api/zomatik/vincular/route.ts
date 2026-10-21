/**
 * Zomatik Z0 · Pantalla "Vínculos con Zomatik": confirmar, corregir o quitar un vínculo (solo gerenciales).
 * Escribe solo en nuestra base. No toca Zomatik.
 *
 *   POST /api/zomatik/vincular
 *     {items: [{tipo, id, accion, codigo?}]}   (hasta 100; o un solo item sin el array)
 *     tipo    cliente   · id = clients.id            · codigo = código del cliente en Zomatik
 *             formula   · id = formulas.id           · codigo = código del artículo
 *             proyecto  · id = código del proyecto   · codigo = construction_sites.id (la obra)
 *     accion  vincular · sin_par (no está en Zomatik / no tiene obra) · quitar (vuelve a "sin revisar")
 *     soloSiLibre  true = grabar solo si todavía no tiene vínculo ("Confirmar todas las de confianza alta")
 */
import { NextResponse } from "next/server"
import { exigirGerencial, modoPruebaLocal, respuestaModoLocal, respuestaError, registrarActividad, sbServicio } from "@/lib/auth/servidor"

export const dynamic = "force-dynamic"
export const maxDuration = 60

type Item = {
  tipo: "cliente" | "formula" | "proyecto"
  id: string
  accion: "vincular" | "sin_par" | "quitar"
  codigo?: string | number | null
  /** "Confirmar todas las de confianza alta": graba solo si todavía no tiene vínculo (no pisa lo que otro confirmó) */
  soloSiLibre?: boolean
}
type Res = { ok: boolean; error?: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function aplicar(it: Item, usuario: string): Promise<Res> {
  const sb = sbServicio()
  const ahora = new Date().toISOString()
  if (!["vincular", "sin_par", "quitar"].includes(it.accion)) return { ok: false, error: "Acción inválida" }

  if (it.tipo === "cliente") {
    if (!UUID.test(String(it.id))) return { ok: false, error: "Cliente inválido" }
    const { data: c } = await sb.from("clients").select("id, name, zomatik_codigo").eq("id", it.id).maybeSingle()
    if (!c) return { ok: false, error: "No existe el cliente" }
    let upd: Record<string, unknown>
    let detalle: string
    if (it.accion === "vincular") {
      const codigo = Number(it.codigo)
      if (!Number.isInteger(codigo) || codigo <= 0) return { ok: false, error: "Código de Zomatik inválido" }
      const { data: z } = await sb.from("zomatik_clientes").select("codigo, razon_social").eq("codigo", codigo).maybeSingle()
      if (!z) return { ok: false, error: "Ese código no está en la copia de Zomatik" }
      const { data: otro } = await sb.from("clients").select("id, name").eq("zomatik_codigo", codigo).neq("id", it.id).maybeSingle()
      if (otro) return { ok: false, error: `Ese cliente de Zomatik ya está vinculado a «${(otro as any).name}»` }
      upd = { zomatik_codigo: codigo, zomatik_vinculo: "manual", zomatik_vinculado_por: usuario, zomatik_vinculado_at: ahora }
      detalle = `${(z as any).razon_social} (${codigo})`
    } else {
      upd = { zomatik_codigo: null, zomatik_vinculo: it.accion === "sin_par" ? "sin_par" : null, zomatik_vinculado_por: usuario, zomatik_vinculado_at: ahora }
      detalle = it.accion === "sin_par" ? "No está en Zomatik" : "Sin revisar"
    }
    let qc = sb.from("clients").update(upd).eq("id", it.id)
    if (it.soloSiLibre) qc = qc.is("zomatik_vinculo", null)
    const { data: hechos, error } = await qc.select("id")
    if (!error && it.soloSiLibre && !(hechos || []).length) return { ok: false, error: `«${(c as any).name}» ya tenía vínculo: no se tocó` }
    if (error) return { ok: false, error: (error as any).code === "23505" ? "Ese cliente de Zomatik ya está vinculado a otro" : error.message }
    await registrarActividad({ usuario, action: "editar", entity: "cliente", entityId: it.id, reference: (c as any).name, details: { "Vínculo con Zomatik": detalle } })
    return { ok: true }
  }

  if (it.tipo === "formula") {
    if (!UUID.test(String(it.id))) return { ok: false, error: "Fórmula inválida" }
    const { data: f } = await sb.from("formulas").select("id, name").eq("id", it.id).maybeSingle()
    if (!f) return { ok: false, error: "No existe la fórmula" }
    let upd: Record<string, unknown>
    let detalle: string
    if (it.accion === "vincular") {
      const codigo = Number(it.codigo)
      const { data: a } = await sb.from("zomatik_articulos").select("codigo, nombre").eq("codigo", codigo).maybeSingle()
      if (!a) return { ok: false, error: "Ese artículo no está en la copia de Zomatik" }
      upd = { zomatik_articulo_codigo: codigo, zomatik_articulo_nombre: (a as any).nombre, zomatik_vinculo: "manual", zomatik_vinculado_por: usuario, zomatik_vinculado_at: ahora }
      detalle = `${(a as any).nombre} (${codigo})`
    } else {
      upd = { zomatik_articulo_codigo: null, zomatik_articulo_nombre: null, zomatik_vinculo: it.accion === "sin_par" ? "sin_par" : null, zomatik_vinculado_por: usuario, zomatik_vinculado_at: ahora }
      detalle = it.accion === "sin_par" ? "Sin artículo en Zomatik" : "Sin revisar"
    }
    let qf = sb.from("formulas").update(upd).eq("id", it.id)
    if (it.soloSiLibre) qf = qf.is("zomatik_vinculo", null)
    const { data: hechos, error } = await qf.select("id")
    if (error) return { ok: false, error: error.message }
    if (it.soloSiLibre && !(hechos || []).length) return { ok: false, error: `«${(f as any).name}» ya tenía vínculo: no se tocó` }
    await registrarActividad({ usuario, action: "editar", entity: "formula", entityId: it.id, reference: (f as any).name, details: { "Artículo de Zomatik": detalle } })
    return { ok: true }
  }

  if (it.tipo === "proyecto") {
    const codigo = Number(it.id)
    const { data: p } = await sb.from("zomatik_proyectos").select("codigo, numero").eq("codigo", codigo).maybeSingle()
    if (!p) return { ok: false, error: "No existe el proyecto en la copia" }
    let upd: Record<string, unknown>
    let detalle: string
    if (it.accion === "vincular") {
      if (!UUID.test(String(it.codigo))) return { ok: false, error: "Obra inválida" }
      const { data: o } = await sb.from("construction_sites").select("id, name").eq("id", String(it.codigo)).maybeSingle()
      if (!o) return { ok: false, error: "No existe la obra" }
      upd = { construction_site_id: (o as any).id, vinculo: "manual", vinculado_por: usuario, vinculado_at: ahora }
      detalle = `Obra ${(o as any).name}`
    } else {
      upd = { construction_site_id: null, vinculo: it.accion === "sin_par" ? "sin_par" : null, vinculado_por: usuario, vinculado_at: ahora }
      detalle = it.accion === "sin_par" ? "Sin obra en Rebucret" : "Sin revisar"
    }
    let qp = sb.from("zomatik_proyectos").update(upd).eq("codigo", codigo)
    if (it.soloSiLibre) qp = qp.is("vinculo", null)
    const { data: hechos, error } = await qp.select("codigo")
    if (error) return { ok: false, error: error.message }
    if (it.soloSiLibre && !(hechos || []).length) return { ok: false, error: `${(p as any).numero} ya tenía vínculo: no se tocó` }
    await registrarActividad({ usuario, action: "editar", entity: "obra", entityId: typeof upd.construction_site_id === "string" ? (upd.construction_site_id as string) : null, reference: (p as any).numero, details: { "Proyecto de Zomatik": `${(p as any).numero} → ${detalle}` } })
    return { ok: true }
  }
  return { ok: false, error: "Tipo inválido" }
}

export async function POST(req: Request) {
  if (modoPruebaLocal()) return respuestaModoLocal()
  try {
    const r = await exigirGerencial()
    if (r.respuesta) return r.respuesta
    const body = await req.json().catch(() => ({}))
    const items: Item[] = Array.isArray(body?.items) ? body.items : body?.tipo ? [body] : []
    if (items.length === 0) return NextResponse.json({ error: "Nada para vincular" }, { status: 400 })
    if (items.length > 100) return NextResponse.json({ error: "Como mucho 100 por vez" }, { status: 400 })
    const resultados: Res[] = []
    for (const it of items) resultados.push(await aplicar(it, r.sesion.usuario.name))
    const errores = resultados.filter((x) => !x.ok).map((x) => x.error)
    return NextResponse.json({ ok: errores.length === 0, hechos: resultados.filter((x) => x.ok).length, errores }, { status: errores.length && errores.length === items.length ? 400 : 200 })
  } catch (e) {
    return respuestaError(e)
  }
}
