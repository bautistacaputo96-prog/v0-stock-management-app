import { NextResponse } from "next/server"
import { respuestaError, sbServicio } from "@/lib/auth/servidor"
import { bloqueoDe, cargarFormulas, cargarPuestoPorId, controlDeFormula } from "@/lib/carga/datos"
import { contextoServidor, error, exigirCarga, registrarEvento } from "@/lib/carga/servidor"
import { patenteParaPlanta } from "@/lib/carga/tipos"

export const dynamic = "force-dynamic"

/**
 * Orden de PRUEBA para la planta simulada (carga.cargar): una carga sin despacho, para probar la pantalla sin
 * despachar un camión de verdad. Solo en un puesto simulador; queda `origen = 'prueba'` y `simulada` (la base no deja
 * una carga de prueba que no sea simulada). Body: {puesto_id, formula_id, m3, mixer_id?}
 */
export async function POST(req: Request) {
  try {
    const r = await exigirCarga("carga", "cargar")
    if (r.respuesta) return r.respuesta
    const body = await req.json().catch(() => ({}))
    const sb = sbServicio()
    const puesto = await cargarPuestoPorId(sb, String(body?.puesto_id || ""))
    if (!puesto) return error("El puesto de carga no existe.", 404)
    if (puesto.sistema !== "simulador") return error("Las órdenes de prueba son solo para la planta simulada.", 403)
    const m3 = Number(String(body?.m3 ?? "").replace(",", "."))
    if (!(m3 > 0 && m3 <= 12)) return error("m³ entre 0,5 y 12.")
    const [formula] = await cargarFormulas(sb, body?.formula_id ? [String(body.formula_id)] : [])
    if (!formula) return error("Elegí la fórmula.")
    let patente: string | null = null
    if (body?.mixer_id) {
      const { data: m } = await sb.from("mixers").select("license_plate").eq("id", String(body.mixer_id)).maybeSingle()
      patente = (m as { license_plate?: string } | null)?.license_plate || null
    }
    const ctx = await contextoServidor(puesto)
    const ctl = controlDeFormula(ctx, formula)
    const ciclos = Math.max(1, Math.ceil(m3 / puesto.m3_max_ciclo - 1e-9))
    const { data: c, error: e } = await sb.from("cargas").insert({
      puesto_id: puesto.id, plant_id: puesto.plant_id, estado: ctl.frena ? "bloqueada" : "pendiente", origen: "prueba", simulada: true,
      remito: "PRUEBA", mixer_id: body?.mixer_id || null, patente_planta: patente ? patenteParaPlanta(patente) : "PRUEBA", cliente_planta: "PRUEBA",
      observacion_planta: "PRUEBA", formula_id: formula.id, receta_numero: ctl.numero, receta_planta_id: ctl.receta?.id ?? null,
      m3, ciclos, m3_ciclo: m3 / ciclos, bloqueo: bloqueoDe(ctl), agua_distinta: ctl.aguaDistinta, bajada_at: new Date().toISOString(), created_by: r.usuario,
    }).select("id").single()
    if (e) throw e
    await registrarEvento({ carga_id: c.id, puesto_id: puesto.id, tipo: "orden_creada", detalle: { prueba: true, m3, formula: formula.code }, usuario: r.usuario })
    return NextResponse.json({ ok: true, carga_id: c.id, frena: ctl.frena })
  } catch (e) {
    return respuestaError(e)
  }
}
