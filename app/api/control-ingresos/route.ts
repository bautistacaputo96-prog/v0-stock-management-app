/**
 * Control de ingresos de materia prima · pantalla (Materias Primas › Control con Zomatik).
 *
 *   GET  /api/control-ingresos?estado=abierta|revisada|resuelta|todas&planta=<id>&desde=AAAA-MM-DD&hasta=AAAA-MM-DD
 *        diferencias, última corrida, cuántas hay por estado y los artículos de Zomatik sin material (no se controlan)
 *   POST /api/control-ingresos  { id, accion: "revisar" | "reabrir", nota? }
 *
 * Importación de ingresos desde Zomatik (docs/ingresos-mp-zomatik.md): el GET trae también `importacion` (modo, última
 * pasada, pendientes, cambios, cargados a mano sin Zomatik, proveedores sin vincular, densidades). El POST suma:
 *   { id, accion: "mismo" | "distintos" | "descartar", nota? }  resolver un pendiente (lo aplica la próxima pasada)
 *   { id, accion: "eliminar_manual", motivo, kg_visto }        solo gerencial: anula con asiento un ingreso a mano desde F
 *   { material_id, accion: "densidad", valor }                 solo gerencial: densidad (kg/L) de un aditivo en kg
 *
 * Solo gerenciales o quien tenga materia_prima.editar (se controla acá, en el servidor). Las tablas no las ve anon.
 */
import { NextResponse } from "next/server"
import { exigirSesion, modoPruebaLocal, respuestaModoLocal, respuestaError, sbServicio, registrarActividad } from "@/lib/auth/servidor"
import { puedeControlar } from "@/lib/control-ingresos/servidor"
import { datosImportacion, faltaMigracion, leerConfig, MENSAJE_SIN_MIGRACION } from "@/lib/ingresos-zomatik/servidor"
import { CLAVE_DENSIDADES } from "@/lib/ingresos-zomatik/plan"
import { tipoDe } from "@/lib/permisos"
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
    const [difs, corrida, abiertas, revisadas, resueltas, copia, importacion] = await Promise.all([
      q,
      // El último control (diario o "Controlar ahora"): las pasadas de la importación se muestran aparte
      sb.from("control_mp_corridas").select("inicio, fin, ok, origen, usuario, error, mail_at, resumen").in("origen", ["cron", "manual"]).order("inicio", { ascending: false }).limit(1),
      contar("abierta"),
      contar("revisada"),
      contar("resuelta"),
      sb.from("zomatik_remitos_compra").select("articulo, codigo_articulo, fecha").gte("fecha", ventana).limit(10000),
      datosImportacion(sb).catch((e) => ({ error: String(e?.message || e) })),
    ])
    if (difs.error) {
      if (/control_mp_diferencias/.test(difs.error.message || "")) return NextResponse.json({ error: "Falta aplicar la migración del control (202610271900)." }, { status: 500 })
      throw difs.error
    }
    const porEstado = { abierta: abiertas.count || 0, revisada: revisadas.count || 0, resuelta: resueltas.count || 0 }
    const sinMaterial = articulosSinMaterial(((copia.data as any[]) || []).map((f) => ({ articulo: f.articulo, codigo: f.codigo_articulo, fecha: f.fecha })))
    return NextResponse.json({ diferencias: difs.data || [], ultimaCorrida: (corrida.data as any[])?.[0] || null, porEstado, sinMaterial, importacion, gerencial: tipoDe(r.sesion.usuario) === "gerencial" })
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
    if (["mismo", "distintos", "descartar", "eliminar_manual", "densidad"].includes(accion)) return await accionImportacion(r.sesion.usuario, body)
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

/** Acciones de la importación de Zomatik (fase 2). Quedan en Actividad. */
async function accionImportacion(usuario: { name: string; tipo?: unknown; permisos?: unknown }, body: any) {
  const sb = sbServicio()
  const gerencial = tipoDe(usuario as any) === "gerencial"
  const accion = String(body?.accion)
  const nota = String(body?.nota ?? body?.motivo ?? "").trim().slice(0, 500) || null
  try {
    if (accion === "densidad") {
      if (!gerencial) return NextResponse.json({ error: "Solo un gerencial puede cargar densidades." }, { status: 403 })
      const mid = String(body?.material_id || "")
      const valor = body?.valor === null || body?.valor === "" ? null : Number(String(body?.valor).replace(",", "."))
      if (!/^[0-9a-f-]{36}$/i.test(mid) || (valor !== null && !(valor > 0.5 && valor < 3))) return NextResponse.json({ error: "Densidad inválida (kg por litro, entre 0,5 y 3)." }, { status: 400 })
      const { densidades } = await leerConfig(sb)
      const antes = densidades[mid] ?? null
      if (valor === null) delete densidades[mid]
      else densidades[mid] = valor
      const { error } = await sb.from("integraciones").upsert({ clave: CLAVE_DENSIDADES, valor: JSON.stringify(densidades), actualizado: new Date().toISOString(), conectado_por: usuario.name } as never, { onConflict: "clave" })
      if (error) throw error
      await registrarActividad({ usuario: usuario.name, action: "editar", entity: "material", entityId: mid, reference: "Densidad (ingresos de Zomatik)", details: { antes, despues: valor } })
      return NextResponse.json({ ok: true })
    }
    if (accion === "eliminar_manual") {
      if (!gerencial) return NextResponse.json({ error: "Solo un gerencial puede eliminar estos ingresos." }, { status: 403 })
      const kgVisto = Number(body?.kg_visto)
      if (!/^[0-9a-f-]{36}$/i.test(idDe(body)) || !nota || body?.kg_visto === undefined || body?.kg_visto === null || !Number.isFinite(kgVisto))
        return NextResponse.json({ error: "Falta el motivo o la cantidad que se vio." }, { status: 400 })
      const { data: e, error: eE } = await sb.from("stock_entries").select("id, quantity, remito, materials(name)").eq("id", idDe(body)).maybeSingle()
      if (eE) throw eE
      if (!e) return NextResponse.json({ error: "El ingreso ya no existe." }, { status: 404 })
      // kg_visto: la cantidad que vio la persona en la pantalla (si cambió, la base no lo anula)
      const { error } = await sb.rpc("mp_ingreso_anular", { p: { id: (e as any).id, kg_visto: kgVisto, usuario: usuario.name, motivo: nota } })
      if (error) {
        if (faltaMigracion(error)) return NextResponse.json({ error: MENSAJE_SIN_MIGRACION }, { status: 500 })
        return NextResponse.json({ error: error.message }, { status: 409 })
      }
      await registrarActividad({ usuario: usuario.name, action: "borrar", entity: "ingreso", entityId: (e as any).id, reference: (e as any).remito, details: { Material: (e as any).materials?.name || "-", Cantidad: (e as any).quantity, Qué: "Anulado: cargado a mano, no está en Zomatik", motivo: nota } })
      return NextResponse.json({ ok: true })
    }
    // Resolver un pendiente: lo aplica la próxima pasada
    const vid = Number(body?.id)
    if (!Number.isInteger(vid)) return NextResponse.json({ error: "Pedido inválido" }, { status: 400 })
    const { data: v, error: eV } = await sb.from("zomatik_ingresos_mp").select("id, estado, remito, motivo, candidato_id, rechazados").eq("id", vid).maybeSingle()
    if (eV) {
      if (faltaMigracion(eV)) return NextResponse.json({ error: MENSAJE_SIN_MIGRACION }, { status: 500 })
      throw eV
    }
    if (!v || (v as any).estado !== "pendiente") return NextResponse.json({ error: "Ese pendiente ya cambió. Actualizá la pantalla." }, { status: 409 })
    if (accion !== "descartar" && !(v as any).candidato_id) return NextResponse.json({ error: "Este pendiente no tiene un ingreso a mano para comparar." }, { status: 400 })
    const rech: string[] = (v as any).rechazados || []
    const { error } = await sb
      .from("zomatik_ingresos_mp")
      .update({
        resolucion: accion,
        resuelto_por: usuario.name,
        resuelto_at: new Date().toISOString(),
        nota,
        ...(accion === "distintos" ? { rechazados: [...new Set([...rech, (v as any).candidato_id])] } : {}),
      })
      .eq("id", vid)
      .eq("estado", "pendiente")
    if (error) throw error
    const texto = accion === "mismo" ? "Es el mismo camión" : accion === "distintos" ? "Son distintos" : "Descartado"
    await registrarActividad({ usuario: usuario.name, action: "editar", entity: "control_ingresos_mp", entityId: String(vid), reference: texto, details: { remito: (v as any).remito, motivo: (v as any).motivo, nota } })
    return NextResponse.json({ ok: true, mensaje: "Listo: se aplica en la próxima lectura de Zomatik (30 min como mucho)." })
  } catch (e) {
    return respuestaError(e)
  }
}
const idDe = (b: any) => String(b?.id || "")
