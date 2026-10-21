import { NextResponse } from "next/server"
import { registrarActividad, respuestaError, sbServicio } from "@/lib/auth/servidor"
import { puedeCon } from "@/lib/permisos"
import { diferenciasReceta, huellaReceta } from "@/lib/carga/receta"
import { aRecetaLeida, cargarPuestoPorId } from "@/lib/carga/datos"
import { contextoServidor, error, exigirCarga, hhmmAR, horaPuente, recalcularBloqueos, sincronizarAlertasReceta } from "@/lib/carga/servidor"
import { INFO_SALIDA, SALIDAS, type RecetaPlanta, type Salida } from "@/lib/carga/tipos"

export const dynamic = "force-dynamic"

/**
 * El puente sube las recetas que leyó de la planta (6.4). Hoy el "puente" es el simulador de la PC de la planta.
 * Body: {puesto_id, leida_at, recetas: RecetaPlanta[], mapeo?: [{numero, formula_id, tipo}]}
 *
 * - Cada receta con una huella nueva se guarda como versión nueva (la anterior NUNCA se pisa) y abre la alerta
 *   "La receta N cambió en Indumix entre … y …" (o "receta nueva"). Las que no cambiaron solo actualizan la hora.
 * - Después se recompara: abre una alerta por receta y fórmula que no coincide, cierra sola las corregidas y
 *   recalcula las cargas que esperan en la cola.
 * - `mapeo` (qué fórmula va en cada número) solo con carga.editar: lo usa "Armar las 20 recetas del simulador".
 * - Nunca se escribe nada en la planta.
 */
export async function POST(req: Request) {
  try {
    const r = await exigirCarga("carga", "cargar")
    if (r.respuesta) return r.respuesta
    const body = await req.json().catch(() => ({}))
    const sb = sbServicio()
    const puesto = await cargarPuestoPorId(sb, String(body?.puesto_id || ""))
    if (!puesto) return error("El puesto de carga no existe.", 404)
    const leida = horaPuente(body?.leida_at)
    const recetas = (Array.isArray(body?.recetas) ? body.recetas : []) as RecetaPlanta[]
    if (recetas.length > puesto.max_recetas) return error(`La planta guarda ${puesto.max_recetas} recetas como máximo.`)

    let mapeoGuardado = false
    if (Array.isArray(body?.mapeo)) {
      if (!puedeCon(r.sesion.usuario, "carga", "editar")) return error("Asignar fórmulas a las recetas pide Carga · editar.", 403)
      const filas = (body.mapeo as { numero: number; formula_id: string | null; tipo: string }[])
        .filter((m) => Number(m.numero) >= 1 && Number(m.numero) <= puesto.max_recetas)
        .map((m) => ({ puesto_id: puesto.id, numero: Number(m.numero), formula_id: m.formula_id || null, tipo: m.tipo === "rotativa" ? "rotativa" : "fija", asignada_por: r.usuario, asignada_at: leida }))
      const vistos = new Set<string>()
      for (const f of filas) if (f.formula_id) { if (vistos.has(f.formula_id)) return error("Una fórmula va en un solo número."); vistos.add(f.formula_id) }
      const { error: e1 } = await sb.from("puesto_recetas").delete().eq("puesto_id", puesto.id)
      if (e1) throw e1
      if (filas.length) { const { error: e2 } = await sb.from("puesto_recetas").insert(filas); if (e2) throw e2 }
      mapeoGuardado = true
      await registrarActividad({ usuario: r.usuario, action: "editar", entity: "carga", entityId: puesto.id, reference: puesto.nombre, details: { "Recetas de la planta": `${filas.filter((f) => f.formula_id).length} fórmulas asignadas a números` } })
    }

    // Recetas leídas: versiones nuevas y avisos de cambio
    const { data: act } = await sb.from("recetas_planta_actual").select("*").eq("puesto_id", puesto.id)
    const actuales = new Map(((act || []) as Record<string, unknown>[]).map((x) => { const rl = aRecetaLeida(x); return [rl.numero, rl] as const }))
    let nuevas = 0, cambios = 0
    for (const raw of recetas) {
      const numero = Number(raw?.numero)
      if (!(numero >= 1 && numero <= puesto.max_recetas)) continue
      const rec: RecetaPlanta = {
        numero, nombre: String(raw.nombre || "").slice(0, 40), habilitada: raw.habilitada !== false,
        salidas: (Array.isArray(raw.salidas) ? raw.salidas : []).filter((s) => SALIDAS.includes(s.salida as Salida)).map((s) => ({
          salida: s.salida, nombre_planta: String(s.nombre_planta || INFO_SALIDA[s.salida].nombre).slice(0, 30), valor: Math.max(0, Number(s.valor) || 0),
          unidad: INFO_SALIDA[s.salida].unidad, ...(s.orden != null && Number.isFinite(Number(s.orden)) ? { orden: Number(s.orden) } : {}),
        })),
      }
      const huella = huellaReceta(rec)
      const ant = actuales.get(numero) || null
      const { data: ya } = await sb.from("recetas_planta").select("id").eq("puesto_id", puesto.id).eq("numero", numero).eq("huella", huella).limit(1)
      if (ya?.length) {
        await sb.from("recetas_planta").update({ ultima_lectura_at: leida }).eq("id", ya[0].id)
        if (ant && ant.huella === huella) continue
      } else {
        const { data: ins, error: e } = await sb.from("recetas_planta").insert({ puesto_id: puesto.id, numero, nombre: rec.nombre, habilitada: rec.habilitada, valores: rec.salidas, huella, primera_lectura_at: leida, ultima_lectura_at: leida }).select("id").single()
        if (e) throw e
        nuevas++
        if (!ant && !rec.salidas.some((s) => s.valor > 0)) continue // una vacía que aparece por primera vez no avisa
        const dif = diferenciasReceta(ant, rec)
        await sb.from("alertas_carga").insert({
          puesto_id: puesto.id, tipo: ant ? "receta_cambiada" : "receta_nueva", receta_numero: numero, receta_planta_id: ins.id,
          titulo: ant ? `La receta ${numero} cambió en Indumix entre ${hhmmAR(ant.ultima_lectura_at)} y ${hhmmAR(leida)}` : `Receta ${numero} leída por primera vez («${rec.nombre || "sin nombre"}»)`,
          detalle: { diferencias: dif, anterior_id: ant?.id ?? null, simulada: puesto.sistema === "simulador", nota: "Indumix no dice quién la cambió. Se guardó la versión anterior." },
          estado: ant ? "abierta" : "cerrada_sola",
        })
        if (ant) cambios++
        continue
      }
      // Volvió a una versión que ya se había leído antes (A → B → A): también es un cambio
      if (ant && ant.huella !== huella) {
        await sb.from("alertas_carga").insert({
          puesto_id: puesto.id, tipo: "receta_cambiada", receta_numero: numero, receta_planta_id: ya![0].id,
          titulo: `La receta ${numero} cambió en Indumix entre ${hhmmAR(ant.ultima_lectura_at)} y ${hhmmAR(leida)}`,
          detalle: { diferencias: diferenciasReceta(ant, rec), anterior_id: ant.id, simulada: puesto.sistema === "simulador" },
        })
        cambios++
      }
    }

    const ctx = await contextoServidor(puesto)
    const al = await sincronizarAlertasReceta(ctx, leida)
    const recalculadas = await recalcularBloqueos(ctx)
    return NextResponse.json({ ok: true, nuevas, cambios, mapeo: mapeoGuardado, alertas: al, recalculadas })
  } catch (e) {
    return respuestaError(e)
  }
}
