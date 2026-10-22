import { NextResponse } from "next/server"
import { respuestaError, sbServicio } from "@/lib/auth/servidor"
import { emparejar, desvio, type Candidato } from "@/lib/carga/auditoria"
import { cargarPuestoPorId } from "@/lib/carga/datos"
import { error, exigirCarga, hhmmAR, horaPuente, registrarEvento, yaProcesado } from "@/lib/carga/servidor"
import { SALIDAS, grupoDeSalida, normalizarPatente, type ReportePlanta, type Salida } from "@/lib/carga/tipos"

export const dynamic = "force-dynamic"

/**
 * Una carga que el puente vio en la planta SIN una orden nuestra (alguien cargó directo desde Indumix, o se cargó a
 * mano sin internet; 5.7 y 19.8). La sube el puente con el reporte de Indumix y la une el emparejador (19.2):
 *  1. con una orden de la cola, por el remito en "Observación" o por camión y hora → esa orden queda
 *     "Ya cargada en Indumix" (para que no se cargue dos veces);
 *  2. si no, con un despacho de la planta de las últimas 12 h sin carga, igual;
 *  3. si no, queda como carga "desde Indumix" sin remito, con su alerta.
 * Body: {puesto_id, pedido, dia_planta, inicio_at, fin_at, reporte: ReportePlanta, materiales: [...]}
 */
export async function POST(req: Request) {
  try {
    // Lo sube el puente: pide carga.cargar mientras no exista la credencial del puesto
    const r = await exigirCarga("carga", "cargar")
    if (r.respuesta) return r.respuesta
    const body = await req.json().catch(() => ({}))
    const sb = sbServicio()
    const puesto = await cargarPuestoPorId(sb, String(body?.puesto_id || ""))
    if (!puesto) return error("El puesto de carga no existe.", 404)
    const pedido = typeof body?.pedido === "string" ? body.pedido.slice(0, 80) : null
    if (await yaProcesado(pedido)) return NextResponse.json({ ok: true, duplicado: true })
    const rep = body?.reporte as ReportePlanta
    if (!rep || !Number.isFinite(Number(rep.numero))) return error("Falta el reporte de Indumix.")
    const fin = horaPuente(body?.fin_at)
    const ini = horaPuente(body?.inicio_at || body?.fin_at)
    const finMs = new Date(fin).getTime()
    const desde = new Date(finMs - 12 * 3600_000).toISOString()

    // 1. Órdenes de la cola
    const { data: cola } = await sb.from("cargas").select("id, remito, remito_tipo, patente_planta, created_at, dispatch_id, m3").eq("puesto_id", puesto.id).in("estado", ["pendiente", "bloqueada", "lista"]).gte("created_at", desde)
    const candCola: Candidato[] = ((cola || []) as any[]).map((c) => ({ id: c.id, remito: c.remito, tipo: c.remito_tipo, patente: c.patente_planta, at: new Date(c.created_at).getTime() }))
    const enCola = emparejar({ observacion: rep.observacion, patente: rep.camion, fin: finMs }, candCola)
    // 2. Despachos de la planta sin carga
    let enDesp: ReturnType<typeof emparejar> = null
    let desp: any = null
    if (!enCola) {
      const { data: ds } = await sb.from("dispatches").select("id, remito, remito_tipo, created_at, mixer_id, formula_id, scheduled_dispatch_id, quantity_m3, mixers(license_plate)").eq("plant_id", puesto.plant_id).gte("created_at", desde).eq("is_test_dispatch", false)
      const ids = ((ds || []) as any[]).map((d) => d.id)
      const { data: conCarga } = ids.length ? await sb.from("cargas").select("dispatch_id").in("dispatch_id", ids) : { data: [] }
      const usados = new Set(((conCarga || []) as any[]).map((x) => x.dispatch_id))
      const libres = ((ds || []) as any[]).filter((d) => !usados.has(d.id))
      enDesp = emparejar({ observacion: rep.observacion, patente: rep.camion, fin: finMs }, libres.map((d) => ({ id: d.id, remito: d.remito, tipo: d.remito_tipo, patente: d.mixers?.license_plate || null, at: new Date(d.created_at).getTime() })))
      desp = enDesp ? libres.find((d) => d.id === enDesp!.id) : null
    }

    const datosCarga = {
      contador_planta: Number(rep.numero), inicio_plc: String(rep.inicio_plc || "").slice(0, 40), fin_plc: String(rep.fin_plc || "").slice(0, 40), dia_planta: body?.dia_planta || null,
      inicio_at: ini, fin_at: fin, m3_cargados: Number(rep.m3_cargados) || Number(rep.m3) || null, ciclos: Number(rep.ciclos) || null, receta_numero: Number(rep.receta) || null,
      patente_planta: String(rep.camion || "").slice(0, 20), cliente_planta: String(rep.cliente || "").slice(0, 20), observacion_planta: String(rep.observacion || "").slice(0, 30),
      hora_estimada: body?.hora_estimada === true,
    }
    let cargaId: string
    let titulo: string
    if (enCola) {
      cargaId = enCola.id
      await sb.from("cargas").update({ ...datosCarga, estado: "ya_cargada_indumix", union_remito: enCola.union }).eq("id", cargaId)
      titulo = `La orden del remito ${(cola || []).find((c: any) => c.id === cargaId)?.remito || ""} ya se cargó en Indumix (N° ${rep.numero}): no se vuelve a cargar`
    } else {
      const { data: n, error: e } = await sb.from("cargas").insert({
        ...datosCarga, puesto_id: puesto.id, plant_id: puesto.plant_id, estado: "leida", origen: "indumix", m3: Number(rep.m3) || null,
        dispatch_id: desp?.id ?? null, pedido_id: desp?.scheduled_dispatch_id ?? null, remito: desp?.remito ?? null, remito_tipo: desp?.remito_tipo ?? null,
        mixer_id: desp?.mixer_id ?? null, formula_id: desp?.formula_id ?? null, union_remito: enDesp?.union ?? null, created_by: r.usuario,
      }).select("id").single()
      if (e) {
        if ((e as { code?: string }).code === "23505") return NextResponse.json({ ok: true, duplicado: true })
        throw e
      }
      cargaId = n.id
      titulo = desp ? `Carga hecha desde Indumix (N° ${rep.numero}) unida al remito ${desp.remito || ""} ${enDesp!.union}` : `Carga hecha desde Indumix, sin pasar por el sistema (N° ${rep.numero})`
    }
    const mats = (Array.isArray(body?.materiales) ? body.materiales : []) as { salida: Salida; material_id: string | null; receta_por_m3?: number; teorico?: number; humedad_pct?: number; teorico_corregido?: number; real?: number; extra?: number; unidad?: string }[]
    const filas = mats.filter((m) => SALIDAS.includes(m.salida)).map((m) => ({
      carga_id: cargaId, ciclo: 0, salida: m.salida, material_id: m.material_id || null, receta_por_m3: m.receta_por_m3 ?? null, teorico: m.teorico ?? null,
      humedad_pct: m.humedad_pct ?? null, teorico_corregido: m.teorico_corregido ?? null, real: m.real ?? null, extra: m.extra ?? 0, unidad: m.unidad || null,
    }))
    if (filas.length) await sb.from("cargas_materiales").upsert(filas, { onConflict: "carga_id,ciclo,salida" })
    const conDesvio = filas.some((f) => desvio({ grupo: grupoDeSalida(f.salida), teorico_corregido: f.teorico_corregido, real: f.real }, puesto.tolerancias.pesaje))
    await sb.from("cargas").update({ estado_auditoria: conDesvio ? "con_desvios" : "ok" }).eq("id", cargaId)
    for (const x of rep.extras || []) {
      if (Number(x.litros) > 0) await sb.from("cargas_agua_extra").insert({ carga_id: cargaId, dispatch_id: desp?.id ?? null, at: fin, litros: Number(x.litros), despues_de_terminar: !!x.despues_de_terminar, origen: "indumix_reporte" })
    }
    await registrarEvento({ carga_id: cargaId, puesto_id: puesto.id, tipo: "reporte", at: fin, detalle: { numero: rep.numero, camion: rep.camion, observacion: rep.observacion, union: enCola?.union || enDesp?.union || null }, usuario: r.usuario, pedido })
    await sb.from("alertas_carga").insert({
      puesto_id: puesto.id, tipo: "carga_desde_indumix", carga_id: cargaId, receta_numero: Number(rep.receta) || null, titulo,
      detalle: { camion: rep.camion, patente: normalizarPatente(rep.camion), observacion: rep.observacion, m3: rep.m3, hora: hhmmAR(fin), simulada: puesto.sistema === "simulador" },
      estado: enCola || desp ? "cerrada_sola" : "abierta",
    })
    return NextResponse.json({ ok: true, carga_id: cargaId, union: enCola?.union || enDesp?.union || null, ya_cargada: !!enCola })
  } catch (e) {
    return respuestaError(e)
  }
}
