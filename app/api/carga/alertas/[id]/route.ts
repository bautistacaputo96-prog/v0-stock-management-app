import { NextResponse } from "next/server"
import { registrarActividad, respuestaError, sbServicio } from "@/lib/auth/servidor"
import { puedeCon } from "@/lib/permisos"
import { fichaParaIndumix } from "@/lib/carga/receta"
import { cargarFormulas, cargarPuestoPorId } from "@/lib/carga/datos"
import { contextoServidor, error, exigirCarga, recalcularBloqueos, registrarEvento } from "@/lib/carga/servidor"

export const dynamic = "force-dynamic"

/**
 * Resolver una alerta de carga (6.5, con 19.4: ya no existe "agua en consulta").
 * Body: {opcion, motivo?, carga_id?, grow_confirmo?: boolean, grow_quien?: string}
 *
 * Receta que no coincide (pide Fórmulas · editar, controlado acá):
 *  - corregir_planta (camino normal): arma la ficha para Indumix y deja la alerta "esperando a la planta". Se cierra
 *    sola cuando el puente lee la receta corregida. El agua va en la ficha solo si se tilda "Grow confirmó el agua".
 *  - autorizar_una_vez: esa carga se hace con la receta de la planta (motivo, una carga, hasta el fin del día). No sirve
 *    para la Tolva 1 equivocada.
 *  - corregir_formula (excepción): con la planta simulada NO se toca la fórmula real.
 * Cualquier alerta: descartar (con Carga · editar o Fórmulas · editar), con motivo.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const r = await exigirCarga("carga", "ver")
    if (r.respuesta) return r.respuesta
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const sb = sbServicio()
    const { data: a } = await sb.from("alertas_carga").select("*").eq("id", id).maybeSingle()
    if (!a) return error("La alerta no existe.", 404)
    const al = a as any
    const puesto = await cargarPuestoPorId(sb, al.puesto_id)
    if (!puesto) return error("El puesto de carga no existe.", 404)
    const opcion = String(body?.opcion || "")
    const motivo = String(body?.motivo || "").trim()
    const u = r.sesion.usuario
    const ahora = new Date().toISOString()
    if (["resuelta", "cerrada_sola"].includes(al.estado)) return error("Esa alerta ya está cerrada.", 409)

    if (opcion === "descartar") {
      if (!puedeCon(u, "carga", "editar") && !puedeCon(u, "formulas", "editar")) return error("Pide Carga · editar o Fórmulas · editar.", 403)
      if (motivo.length < 3) return error("Escribí el motivo.")
      await sb.from("alertas_carga").update({ estado: "resuelta", resolucion: "descartar", resuelta_por: r.usuario, resuelta_at: ahora, motivo, updated_at: ahora }).eq("id", id)
      await registrarEvento({ carga_id: al.carga_id, puesto_id: puesto.id, tipo: "alerta_resuelta", detalle: { alerta: id, opcion, motivo }, usuario: r.usuario })
      return NextResponse.json({ ok: true })
    }

    if (al.tipo !== "receta_no_coincide") return error("Esa alerta solo se puede descartar.")
    if (!puedeCon(u, "formulas", "editar")) return error("Resolver una receta que no coincide pide Fórmulas · editar.", 403)
    const ctx = await contextoServidor(puesto)
    const [formula] = await cargarFormulas(sb, al.formula_id ? [al.formula_id] : [])
    const receta = ctx.recetas.find((x) => x.numero === al.receta_numero) || null
    if (!formula || !receta) return error("No se encontró la receta o la fórmula de la alerta.")

    if (opcion === "corregir_planta") {
      const conAgua = body?.grow_confirmo === true
      const ficha = fichaParaIndumix(receta, formula, ctx.salidas, ctx.materiales, conAgua)
      const quien = conAgua ? `${String(body?.grow_quien || "").trim() || "Grow"} · confirmado por ${r.usuario} ${ahora.slice(0, 10)}` : null
      await sb.from("alertas_carga").update({
        estado: "esperando_planta", resolucion: "corregir_planta", agua_confirmada_por: quien, resuelta_por: r.usuario, motivo: motivo || null, updated_at: ahora,
        detalle: { ...(al.detalle || {}), ficha: { ...ficha, numero: receta.numero, nombre: receta.nombre, con_agua: conAgua, pedida_por: r.usuario, pedida_at: ahora } },
      }).eq("id", id)
      await registrarActividad({ usuario: r.usuario, action: "editar", entity: "carga", entityId: id, reference: `Receta ${receta.numero}`, details: { "Ficha para Indumix": ficha.lineas.map((l) => `${l.nombre_planta}: ${l.antes} → ${l.despues}`).join(" · ") || "(sin cambios)", Agua: conAgua ? "va (confirmó Grow)" : "no va" } })
      return NextResponse.json({ ok: true, ficha })
    }

    if (opcion === "autorizar_una_vez") {
      if (motivo.length < 3) return error("Escribí el motivo.")
      const { data: k } = await sb.from("cargas").select("id, estado, bloqueo, remito").eq("id", String(body?.carga_id || "")).eq("puesto_id", puesto.id).eq("formula_id", formula.id).maybeSingle()
      if (!k || !["pendiente", "bloqueada", "lista"].includes((k as any).estado)) return error("Elegí una carga de esa fórmula que esté esperando en la cola.")
      const tolva = ((k as any).bloqueo?.items || []).some((i: { clave: string; ok: boolean }) => i.clave === "tolva" && !i.ok)
      if (tolva) return error("La Tolva 1 equivocada no se autoriza: se corrige en la tolva.", 409)
      // Vale una carga y hasta el fin del día (hora de Argentina)
      const dia = new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" })
      await sb.from("cargas").update({ autorizacion: { por: r.usuario, motivo, at: ahora, alerta_id: id, vence: new Date(`${dia}T23:59:59-03:00`).toISOString() } }).eq("id", (k as any).id)
      await sb.from("alertas_carga").update({ detalle: { ...(al.detalle || {}), autorizadas: [...(al.detalle?.autorizadas || []), { carga_id: (k as any).id, remito: (k as any).remito, por: r.usuario, motivo, at: ahora }] }, updated_at: ahora }).eq("id", id)
      await registrarEvento({ carga_id: (k as any).id, puesto_id: puesto.id, tipo: "autorizada", detalle: { alerta: id, motivo }, usuario: r.usuario })
      await registrarActividad({ usuario: r.usuario, action: "editar", entity: "carga", entityId: (k as any).id, reference: (k as any).remito, details: { "Autorizada con receta distinta (solo esta carga)": motivo } })
      await recalcularBloqueos(ctx)
      return NextResponse.json({ ok: true })
    }

    if (opcion === "corregir_formula") {
      if (puesto.sistema === "simulador") return error("Con la planta simulada no se corrige la fórmula real. Si la dosificación oficial cambió, se edita en Fórmulas, como siempre.", 409)
      return error("Corregir la fórmula se hace desde Fórmulas (con el OK del laboratorio).", 409)
    }
    return error("Opción desconocida.")
  } catch (e) {
    return respuestaError(e)
  }
}
