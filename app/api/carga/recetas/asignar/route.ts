import { NextResponse } from "next/server"
import { registrarActividad, respuestaError, sbServicio } from "@/lib/auth/servidor"
import { cargarPuestoPorId } from "@/lib/carga/datos"
import { contextoServidor, error, exigirCarga, recalcularBloqueos, sincronizarAlertasReceta } from "@/lib/carga/servidor"

export const dynamic = "force-dynamic"

/**
 * Qué fórmula es cada receta de la planta (5.1), de a una (Carga · editar). Body: {puesto_id, numero, formula_id | null,
 * tipo}. Una fórmula va en un solo número ("Ya está en la receta 7"). Queda en Actividad y se recompara la receta.
 * Nunca escribe nada en la planta.
 */
export async function POST(req: Request) {
  try {
    const r = await exigirCarga("carga", "editar")
    if (r.respuesta) return r.respuesta
    const body = await req.json().catch(() => ({}))
    const sb = sbServicio()
    const puesto = await cargarPuestoPorId(sb, String(body?.puesto_id || ""))
    if (!puesto) return error("El puesto de carga no existe.", 404)
    const numero = Number(body?.numero)
    if (!Number.isInteger(numero) || numero < 1 || numero > puesto.max_recetas) return error(`La receta va de 1 a ${puesto.max_recetas}.`)
    const formulaId = body?.formula_id ? String(body.formula_id) : null
    const tipo = body?.tipo === "rotativa" ? "rotativa" : "fija"
    let code: string | null = null
    if (formulaId) {
      const { data: f } = await sb.from("formulas").select("id, code, plant_id").eq("id", formulaId).maybeSingle()
      if (!f || (f as { plant_id: string }).plant_id !== puesto.plant_id) return error("La fórmula no es de esta planta.", 404)
      code = (f as { code: string }).code
      const { data: otra } = await sb.from("puesto_recetas").select("numero").eq("puesto_id", puesto.id).eq("formula_id", formulaId).neq("numero", numero).limit(1)
      if ((otra as { numero: number }[] | null)?.length) return error(`Ya está en la receta ${(otra as { numero: number }[])[0].numero}.`, 409)
    }
    const { data: antes } = await sb.from("puesto_recetas").select("formula_id, formulas(code)").eq("puesto_id", puesto.id).eq("numero", numero).maybeSingle()
    const { error: e } = await sb.from("puesto_recetas").upsert(
      { puesto_id: puesto.id, numero, formula_id: formulaId, tipo, asignada_por: r.usuario, asignada_at: new Date().toISOString() },
      { onConflict: "puesto_id,numero" },
    )
    if (e) {
      if ((e as { code?: string }).code === "23505") return error("Esa fórmula ya está en otra receta.", 409)
      throw e
    }
    const antesCode = (antes as { formulas?: { code: string } | null } | null)?.formulas?.code || "sin fórmula"
    await registrarActividad({ usuario: r.usuario, action: "editar", entity: "carga", entityId: puesto.id, reference: puesto.nombre, details: { [`Receta ${numero}`]: `${antesCode} → ${code || "sin fórmula"}` } })
    const ctx = await contextoServidor(puesto)
    const alertas = await sincronizarAlertasReceta(ctx, new Date().toISOString())
    const recalculadas = await recalcularBloqueos(ctx)
    return NextResponse.json({ ok: true, alertas, recalculadas })
  } catch (e) {
    return respuestaError(e)
  }
}
