/**
 * Ingresos de materia prima desde Zomatik · lo que necesita la pantalla Materias Primas (docs/ingresos-mp-zomatik.md).
 *
 *   GET  { modo, desde, activa, avisosHumedad }  con sesión. `activa` = ya entra solo desde Zomatik (modo real, hoy ≥ F):
 *        la carga manual queda para gerenciales. `avisosHumedad`: Arena Fina sin humedad a las 24 h de la planta de la que
 *        la persona es encargada (Titan en Canning, David en Hudson).
 *   POST { accion: "editar", id, kg_visto, kg_nuevo, remito, notas, fecha, motivo }  la edición del historial con asiento
 *        (mp_ingreso_editar), con materia_prima.editar. Sin la migración contesta 501 `sin_migracion` y la pantalla
 *        edita como antes.
 *   POST { accion: "borrar", id, kg_visto, motivo }  con materia_prima.borrar. Decide cómo se elimina un ingreso:
 *        de Zomatik o emparejado con Zomatik → no se puede (409); a mano desde F de un material que entra desde
 *        Zomatik → se anula con asiento (mp_ingreso_anular); lo demás → `comoSiempre` (la pantalla lo borra como hoy).
 *        Sin la migración, 501.
 */
import { NextResponse } from "next/server"
import { exigirSesion, modoPruebaLocal, respuestaModoLocal, respuestaError, sbServicio } from "@/lib/auth/servidor"
import { puedeCon } from "@/lib/permisos"
import { fechaArgentina } from "@/lib/control-ingresos/cruce"
import { importacionActiva } from "@/lib/ingresos-zomatik/plan"
import { arenasSinHumedad, faltaMigracion, leerConfig, plantasDeEncargado } from "@/lib/ingresos-zomatik/servidor"
import { TIPOS_IMPORTABLES } from "@/lib/ingresos-zomatik/plan"
import { registrarActividad } from "@/lib/auth/servidor"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const r = await exigirSesion()
    if (r.respuesta) return r.respuesta
    const sb = sbServicio()
    const { interruptor } = await leerConfig(sb)
    const activa = importacionActiva(interruptor, fechaArgentina())
    let avisosHumedad: Awaited<ReturnType<typeof arenasSinHumedad>> = []
    const plantas = plantasDeEncargado(r.sesion.usuario.name)
    if (activa && plantas.length) {
      avisosHumedad = (await arenasSinHumedad(sb, Date.now(), interruptor.desde).catch(() => [])).filter((a) => plantas.includes(a.planta))
    }
    return NextResponse.json({ modo: interruptor.modo, desde: interruptor.desde, activa, avisosHumedad })
  } catch (e) {
    return respuestaError(e)
  }
}

export async function POST(req: Request) {
  if (modoPruebaLocal()) return respuestaModoLocal()
  try {
    const r = await exigirSesion()
    if (r.respuesta) return r.respuesta
    const b = await req.json().catch(() => ({}))
    if (b?.accion === "borrar") return await borrar(r.sesion.usuario, b)
    if (!puedeCon(r.sesion.usuario, "materia_prima", "editar")) return NextResponse.json({ error: "No tenés permiso para editar ingresos." }, { status: 403 })
    if (b?.accion !== "editar" || !/^[0-9a-f-]{36}$/i.test(String(b?.id || ""))) return NextResponse.json({ error: "Pedido inválido" }, { status: 400 })
    const motivo = String(b?.motivo || "").trim().slice(0, 500)
    if (!motivo) return NextResponse.json({ error: "Falta el motivo." }, { status: 400 })
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(b?.fecha || "")) ? b.fecha : null
    const { data, error } = await sbServicio().rpc("mp_ingreso_editar", {
      p: { id: b.id, kg_visto: Number(b.kg_visto), kg_nuevo: Number(b.kg_nuevo), remito: String(b.remito ?? ""), notas: String(b.notas ?? ""), fecha, motivo, usuario: r.sesion.usuario.name },
    })
    if (error) {
      if (faltaMigracion(error)) return NextResponse.json({ codigo: "sin_migracion", error: "Falta la migración" }, { status: 501 })
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    return NextResponse.json({ ok: true, diff: Number((data as any)?.diff) || 0 })
  } catch (e) {
    return respuestaError(e)
  }
}

async function borrar(usuario: { name: string; tipo?: unknown; permisos?: unknown }, b: any) {
  if (!puedeCon(usuario as any, "materia_prima", "borrar")) return NextResponse.json({ error: "No tenés permiso para eliminar ingresos." }, { status: 403 })
  const id = String(b?.id || "")
  const motivo = String(b?.motivo || "").trim().slice(0, 500)
  const kgVisto = Number(b?.kg_visto)
  if (!/^[0-9a-f-]{36}$/i.test(id) || !motivo || !Number.isFinite(kgVisto)) return NextResponse.json({ error: "Pedido inválido" }, { status: 400 })
  const sb = sbServicio()
  const { data: v, error: eV } = await sb.from("zomatik_ingresos_mp").select("id").eq("stock_entry_id", id).limit(1)
  if (eV) {
    if (faltaMigracion(eV)) return NextResponse.json({ codigo: "sin_migracion", error: "Falta la migración" }, { status: 501 })
    throw eV
  }
  const { data: e, error: eE } = await sb.from("stock_entries").select("id, quantity, remito, origen, anulado_at, entry_date, materials(name, tipo)").eq("id", id).maybeSingle()
  if (eE) throw eE
  if (!e) return NextResponse.json({ error: "El ingreso ya no existe." }, { status: 404 })
  const x = e as any
  if (x.origen === "zomatik") return NextResponse.json({ error: "Viene de Zomatik: se anula allá." }, { status: 409 })
  if ((v as any[])?.length) return NextResponse.json({ error: "Está emparejado con un remito de Zomatik: no se puede eliminar." }, { status: 409 })
  if (x.anulado_at) return NextResponse.json({ error: "Ya está anulado." }, { status: 409 })
  const { interruptor } = await leerConfig(sb)
  const desdeF = interruptor.modo === "real" && !!interruptor.desde && fechaArgentina(x.entry_date) >= interruptor.desde
  if (!desdeF || !TIPOS_IMPORTABLES.includes(x.materials?.tipo || "")) return NextResponse.json({ ok: true, comoSiempre: true })
  const { error } = await sb.rpc("mp_ingreso_anular", { p: { id, kg_visto: kgVisto, usuario: usuario.name, motivo } })
  if (error) return NextResponse.json({ error: error.message }, { status: 409 })
  await registrarActividad({ usuario: usuario.name, action: "borrar", entity: "ingreso", entityId: id, reference: x.remito, details: { Material: x.materials?.name || "-", Cantidad: x.quantity, Qué: "Anulado con asiento (a mano desde el arranque de Zomatik)", motivo } })
  return NextResponse.json({ ok: true, anulado: true })
}
