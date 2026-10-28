/**
 * Control de ingresos de materia prima · pantalla (Materias Primas › Control con Zomatik).
 *
 *   GET  /api/control-ingresos?estado=abierta|revisada|resuelta|todas&planta=<id>&desde=AAAA-MM-DD&hasta=AAAA-MM-DD
 *        diferencias, última corrida, cuántas hay por estado y los artículos de Zomatik sin material (no se controlan)
 *   POST /api/control-ingresos  { id, accion: "revisar" | "reabrir", nota? }
 *
 * Solo gerenciales o quien tenga materia_prima.editar (se controla acá, en el servidor). Las tablas no las ve anon.
 */
import { NextResponse } from "next/server"
import { exigirSesion, modoPruebaLocal, respuestaModoLocal, respuestaError, sbServicio, registrarActividad } from "@/lib/auth/servidor"
import { puedeControlar } from "@/lib/control-ingresos/servidor"
import { articulosSinMaterial, desdeVentana, fechaArgentina, sumarDias, MARGEN_DIAS } from "@/lib/control-ingresos/cruce"

export const dynamic = "force-dynamic"

const FECHA = /^\d{4}-\d{2}-\d{2}$/

async function exigir() {
  const r = await exigirSesion()
  if (r.respuesta) return r
  if (!puedeControlar(r.sesion.usuario)) return { respuesta: NextResponse.json({ error: "No tenés permiso para el control con Zomatik." }, { status: 403 }) }
  return r
}

export async function GET(req: Request) {
  try {
    const r = await exigir()
    if (r.respuesta) return r.respuesta
    const u = new URL(req.url)
    const estado = u.searchParams.get("estado") || "abierta"
    const planta = u.searchParams.get("planta")
    const desde = u.searchParams.get("desde")
    const hasta = u.searchParams.get("hasta")
    const sb = sbServicio()
    let q = sb
      .from("control_mp_diferencias")
      .select("id, categoria, tipo, fecha, plant_id, detalle, nuestro, zomatik, estado, nota, revisada_por, revisada_at, resuelta_at, detectada_at")
      .order("fecha", { ascending: false })
      .limit(1000)
    if (["abierta", "revisada", "resuelta"].includes(estado)) q = q.eq("estado", estado)
    if (planta && /^[0-9a-f-]{36}$/i.test(planta)) q = q.eq("plant_id", planta)
    if (desde && FECHA.test(desde)) q = q.gte("fecha", desde)
    if (hasta && FECHA.test(hasta)) q = q.lte("fecha", hasta)
    const contar = (e: string) => sb.from("control_mp_diferencias").select("id", { count: "exact", head: true }).eq("estado", e)
    const ventana = sumarDias(desdeVentana(fechaArgentina()), -MARGEN_DIAS)
    const [difs, corrida, abiertas, revisadas, resueltas, copia] = await Promise.all([
      q,
      sb.from("control_mp_corridas").select("inicio, fin, ok, origen, usuario, error, mail_at, resumen").order("inicio", { ascending: false }).limit(1),
      contar("abierta"),
      contar("revisada"),
      contar("resuelta"),
      sb.from("zomatik_remitos_compra").select("articulo, codigo_articulo, fecha").gte("fecha", ventana).limit(10000),
    ])
    if (difs.error) {
      if (/control_mp_diferencias/.test(difs.error.message || "")) return NextResponse.json({ error: "Falta aplicar la migración del control (202610271900)." }, { status: 500 })
      throw difs.error
    }
    const porEstado = { abierta: abiertas.count || 0, revisada: revisadas.count || 0, resuelta: resueltas.count || 0 }
    const sinMaterial = articulosSinMaterial(((copia.data as any[]) || []).map((f) => ({ articulo: f.articulo, codigo: f.codigo_articulo, fecha: f.fecha })))
    return NextResponse.json({ diferencias: difs.data || [], ultimaCorrida: (corrida.data as any[])?.[0] || null, porEstado, sinMaterial })
  } catch (e) {
    return respuestaError(e)
  }
}

export async function POST(req: Request) {
  if (modoPruebaLocal()) return respuestaModoLocal()
  try {
    const r = await exigir()
    if (r.respuesta) return r.respuesta
    const body = await req.json().catch(() => ({}))
    const id = String(body?.id || "")
    const accion = body?.accion
    const nota = String(body?.nota ?? "").trim().slice(0, 500) || null
    if (!/^[0-9a-f-]{36}$/i.test(id) || !["revisar", "reabrir"].includes(accion)) return NextResponse.json({ error: "Pedido inválido" }, { status: 400 })
    const sb = sbServicio()
    const valores =
      accion === "revisar"
        ? { estado: "revisada", nota, revisada_por: r.sesion.usuario.name, revisada_at: new Date().toISOString() }
        : { estado: "abierta", nota: null, revisada_por: null, revisada_at: null, detectada_at: new Date().toISOString() }
    const { data, error } = await sb
      .from("control_mp_diferencias")
      .update(valores)
      .eq("id", id)
      .eq("estado", accion === "revisar" ? "abierta" : "revisada")
      .select("id, detalle")
    if (error) throw error
    if (!data?.length) return NextResponse.json({ error: "Esa diferencia ya cambió. Actualizá la pantalla." }, { status: 409 })
    await registrarActividad({ usuario: r.sesion.usuario.name, action: "editar", entity: "control_ingresos_mp", entityId: id, reference: accion === "revisar" ? "Revisado" : "Reabierto", details: { detalle: (data[0] as any).detalle, nota } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return respuestaError(e)
  }
}
