import { NextResponse } from "next/server"
import { registrarActividad, respuestaError, sbServicio } from "@/lib/auth/servidor"
import { bloqueoDe, cargarFormulas, cargarPuesto, controlDeFormula, mandaOrdenes } from "@/lib/carga/datos"
import { contextoServidor, error, exigirCarga, mailDespachoFrenado, registrarEvento } from "@/lib/carga/servidor"
import { patenteParaPlanta } from "@/lib/carga/tipos"

export const dynamic = "force-dynamic"

/**
 * Despacho → cola de carga (secuencia A, como Loop; carga-planta.md 19.2 y 21.1).
 * La llama la Entrega DESPUÉS de que `registrar_despacho` grabó el despacho (remito, stock teórico, probetas, pedido,
 * viaje y camión). Crea la orden `pendiente` (o `bloqueada` si la receta frena) con su dispatch_id.
 *
 * Body: {dispatch_id, frenada_confirmada?: boolean}
 * - Si el control de receta frena (cemento, áridos, aditivo o Tolva 1), hace falta `frenada_confirmada` (la casilla
 *   "La carga va a quedar frenada en la planta… ¿Despachar igual?") y se manda el mail a Juan Oreguy (20.1).
 * - El agua distinta no frena: solo queda marcada.
 * - Sin puesto en etapa B o C (o sin la migración), no hace nada y lo dice. Nunca deshace el despacho.
 * - NP de Zomatik: todavía no se controla (lo hace la rama de Zomatik).
 */
export async function POST(req: Request) {
  try {
    const r = await exigirCarga("despacho", "cargar")
    if (r.respuesta) return r.respuesta
    const body = await req.json().catch(() => ({}))
    const dispatchId = String(body?.dispatch_id || "")
    if (!dispatchId) return error("Falta el despacho.")
    const sb = sbServicio()
    const { data: d, error: e1 } = await sb.from("dispatches")
      .select("id, plant_id, remito, remito_tipo, quantity_m3, mixer_id, formula_id, scheduled_dispatch_id, is_test_dispatch, created_at, mixers(license_plate), clients(name), construction_sites(name), formulas(code), plants(name)")
      .eq("id", dispatchId).maybeSingle()
    if (e1) throw e1
    // Anular un despacho lo borra (anular_despacho): si no está, no hay nada que mandar
    if (!d) return error("El despacho no existe (¿se anuló?).", 404)
    const desp = d as any
    if (desp.is_test_dispatch) return NextResponse.json({ ok: true, enviada: false, motivo: "Es un despacho de prueba: no va a la cola de carga." })
    if (Date.now() - new Date(desp.created_at).getTime() > 12 * 3600_000) return NextResponse.json({ ok: true, enviada: false, motivo: "Es un despacho de hace más de 12 horas: no va a la cola de carga." })
    const puesto = await cargarPuesto(sb, desp.plant_id)
    if (!mandaOrdenes(puesto)) return NextResponse.json({ ok: true, enviada: false, motivo: "La planta no tiene un puesto de carga que reciba órdenes." })
    const { data: ya } = await sb.from("cargas").select("id").eq("dispatch_id", dispatchId).is("completa_carga_id", null).not("estado", "in", "(cancelada,anulada)").limit(1)
    if (ya?.length) return NextResponse.json({ ok: true, enviada: false, carga_id: ya[0].id, motivo: "Ese despacho ya está en la cola de carga." })

    const ctx = await contextoServidor(puesto!)
    const [formula] = await cargarFormulas(sb, desp.formula_id ? [desp.formula_id] : [])
    const ctl = controlDeFormula(ctx, formula || null)
    if (ctl.frena && body?.frenada_confirmada !== true)
      return error(`La carga va a quedar frenada en la planta: ${ctl.motivo}. Tildá la confirmación para despachar igual.`, 409)

    const m3 = Number(desp.quantity_m3) || 0
    const ciclos = Math.max(1, Math.ceil(m3 / puesto!.m3_max_ciclo - 1e-9))
    const patente = desp.mixers?.license_plate || null
    const { data: carga, error: e2 } = await sb.from("cargas").insert({
      puesto_id: puesto!.id, plant_id: desp.plant_id, estado: ctl.frena ? "bloqueada" : "pendiente", origen: "sistema",
      dispatch_id: dispatchId, pedido_id: desp.scheduled_dispatch_id, remito: desp.remito, remito_tipo: desp.remito_tipo,
      mixer_id: desp.mixer_id, patente_planta: patente ? patenteParaPlanta(patente) : null,
      cliente_planta: String(desp.clients?.name || "").slice(0, 20), observacion_planta: String(desp.remito || "").replace(/\D/g, "").padStart(4, "0"),
      formula_id: desp.formula_id, receta_numero: ctl.numero, receta_planta_id: ctl.receta?.id ?? null, m3, ciclos, m3_ciclo: m3 / ciclos,
      bloqueo: bloqueoDe(ctl), agua_distinta: ctl.aguaDistinta, frenada_confirmada_por: ctl.frena ? r.usuario : null,
      union_remito: "por id", created_by: r.usuario,
    }).select("id, simulada").single()
    if (e2) {
      if ((e2 as { code?: string }).code === "23505") return NextResponse.json({ ok: true, enviada: false, motivo: "Ese despacho ya está en la cola de carga." })
      throw e2
    }
    await registrarEvento({ carga_id: carga.id, puesto_id: puesto!.id, tipo: "orden_creada", detalle: { remito: desp.remito, m3, frena: ctl.frena, agua: ctl.aguaDistinta }, usuario: r.usuario })

    let mail: Awaited<ReturnType<typeof mailDespachoFrenado>> | null = null
    // Con la planta simulada, "no tiene receta" es normal (no están armadas todas): no se le manda el mail a Juan
    const sinReceta = ctl.numero == null || !ctl.cmp
    if (ctl.frena && carga.simulada && sinReceta) mail = { enviado: false, a: [], motivo: "planta simulada sin receta para esa fórmula: no se manda" }
    else if (ctl.frena) mail = await mailDespachoFrenado({
        simulada: carga.simulada, planta: desp.plants?.name || "", remito: `${desp.remito_tipo || ""} ${desp.remito || "s/n"}`.trim(), camion: patente || "-",
        formula: desp.formulas?.code || formula?.code || "-", receta: ctl.numero, motivo: ctl.motivo || "", items: ctl.items, por: r.usuario,
      })
    if (ctl.frena && mail) {
      await registrarEvento({ carga_id: carga.id, puesto_id: puesto!.id, tipo: "frenada_confirmada", detalle: { motivo: ctl.motivo, mail }, usuario: r.usuario })
      // Queda en la alerta de la receta (la abre si no estaba) y en Actividad
      if (ctl.numero != null && formula) {
        const { data: al } = await sb.from("alertas_carga").select("id, detalle").eq("puesto_id", puesto!.id).eq("tipo", "receta_no_coincide").eq("receta_numero", ctl.numero).eq("formula_id", formula.id).in("estado", ["abierta", "esperando_planta"]).limit(1)
        const nota = { remito: desp.remito, camion: patente, por: r.usuario, at: new Date().toISOString() }
        if (al?.length) await sb.from("alertas_carga").update({ detalle: { ...(al[0].detalle || {}), despachos_frenados: [...((al[0].detalle as any)?.despachos_frenados || []), nota] }, updated_at: new Date().toISOString() }).eq("id", al[0].id)
        else await sb.from("alertas_carga").insert({ puesto_id: puesto!.id, tipo: "receta_no_coincide", formula_id: formula.id, receta_numero: ctl.numero, receta_planta_id: ctl.receta?.id ?? null, carga_id: carga.id, titulo: `La receta ${ctl.numero} de la planta no coincide con ${formula.code}`, detalle: { frena: true, motivo: ctl.motivo, items: bloqueoDe(ctl).items, despachos_frenados: [nota] } })
      } else {
        await sb.from("alertas_carga").insert({ puesto_id: puesto!.id, tipo: "despacho_frenado", formula_id: formula?.id ?? null, carga_id: carga.id, titulo: `Despacho con la carga frenada · remito ${desp.remito || "s/n"}`, detalle: { motivo: ctl.motivo, mail } })
      }
      await registrarActividad({
        usuario: r.usuario, action: "crear", entity: "carga", entityId: carga.id, reference: desp.remito,
        details: { "Despachó igual con la carga frenada": ctl.motivo, Mail: mail.enviado ? `a ${mail.a.join(", ")}` : `no se mandó (${mail.motivo})`, Simulada: carga.simulada ? "sí" : "no" },
      })
    }
    return NextResponse.json({ ok: true, enviada: true, carga_id: carga.id, simulada: carga.simulada, frena: ctl.frena, agua_distinta: ctl.aguaDistinta, mail })
  } catch (e) {
    return respuestaError(e)
  }
}
