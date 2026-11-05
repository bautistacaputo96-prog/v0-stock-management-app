import { NextResponse } from "next/server"
import { registrarActividad, respuestaError, sbServicio } from "@/lib/auth/servidor"
import { puedeCon } from "@/lib/permisos"
import { diferenciasReceta, huellaReceta } from "@/lib/carga/receta"
import { aRecetaLeida, cargarPuestoPorId } from "@/lib/carga/datos"
import { contextoServidor, error, exigirCarga, guardarRecetasLeidas, hhmmAR, horaPuente, limpiarRecetas, recalcularBloqueos, sincronizarAlertasReceta } from "@/lib/carga/servidor"
import type { RecetaPlanta } from "@/lib/carga/tipos"

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

    // Lo que llega se limpia (solo salidas conocidas, valores ≥ 0, textos cortos)
    const limpias = limpiarRecetas(puesto, recetas)

    // "Armar las 20 recetas" (con mapeo): todo junto en una función de la base, o todo o nada
    if (Array.isArray(body?.mapeo)) {
      if (!puedeCon(r.sesion.usuario, "carga", "editar")) return error("Asignar fórmulas a las recetas pide Carga · editar.", 403)
      // Con el puesto real las recetas las lee el puente: nunca se arman recetas de prueba encima
      if (puesto.sistema === "indumix") return error("Con la planta real las recetas las lee el puente. Las fórmulas se asignan una por una en Recetas de la planta.", 409)
      // Se sacan los repetidos antes de llamar a la base: un número una sola vez y una fórmula en un solo número (queda
      // el primero)
      const numeros = new Set<number>(), formulasVistas = new Set<string>()
      const filas = (body.mapeo as { numero: number; formula_id: string | null; tipo: string }[])
        .filter((m) => Number(m.numero) >= 1 && Number(m.numero) <= puesto.max_recetas)
        .map((m) => ({ numero: Number(m.numero), formula_id: m.formula_id || null, tipo: m.tipo === "rotativa" ? "rotativa" : "fija" }))
        .filter((m) => {
          if (numeros.has(m.numero)) return false
          numeros.add(m.numero)
          if (m.formula_id) { if (formulasVistas.has(m.formula_id)) return false; formulasVistas.add(m.formula_id) }
          return true
        })
      const unicas = [...new Map(limpias.map((x) => [x.numero, x])).values()]
      // Avisar si alguna receta que ya estaba leída cambia con el armado
      const { data: antes } = await sb.from("recetas_planta_actual").select("*").eq("puesto_id", puesto.id)
      const previas = new Map(((antes || []) as Record<string, unknown>[]).map((x) => { const rl = aRecetaLeida(x); return [rl.numero, rl] as const }))
      const cambiadas = unicas.filter((x) => { const a = previas.get(x.numero); return !!a && a.huella !== huellaReceta(x) })
      const { data: res, error: ea } = await sb.rpc("armar_recetas_puesto", {
        p_puesto: puesto.id, p_mapeo: filas, p_recetas: unicas.map((x) => ({ ...x, huella: huellaReceta(x) })), p_usuario: r.usuario, p_leida: leida,
      })
      if (ea) throw ea
      for (const x of cambiadas) {
        const a = previas.get(x.numero)!
        await sb.from("alertas_carga").insert({
          puesto_id: puesto.id, tipo: "receta_cambiada", receta_numero: x.numero,
          titulo: `La receta ${x.numero} cambió al armar las recetas (${hhmmAR(a.ultima_lectura_at)} → ${hhmmAR(leida)})`,
          detalle: { diferencias: diferenciasReceta(a, x), anterior_id: a.id, simulada: puesto.sistema === "simulador", nota: "Se guardó la versión anterior." },
        })
      }
      await registrarActividad({ usuario: r.usuario, action: "editar", entity: "carga", entityId: puesto.id, reference: puesto.nombre, details: { "Recetas de la planta": `${filas.filter((f) => f.formula_id).length} fórmulas asignadas a números`, Recetas: String((res as any)?.recetas ?? "") } })
      const ctx = await contextoServidor(puesto)
      const al = await sincronizarAlertasReceta(ctx, leida)
      const recalculadas = await recalcularBloqueos(ctx)
      return NextResponse.json({ ok: true, nuevas: (res as any)?.recetas ?? 0, cambios: cambiadas.length, cambiadas: cambiadas.map((x) => x.numero), mapeo: true, alertas: al, recalculadas })
    }

    // Recetas leídas: versiones nuevas y avisos de cambio (lib/carga/servidor.ts, la usa también el puente real)
    const res = await guardarRecetasLeidas(puesto, limpias, leida, r.usuario)
    return NextResponse.json({ ok: true, nuevas: res.nuevas, cambios: res.cambios, mapeo: false, alertas: res.alertas, recalculadas: res.recalculadas })
  } catch (e) {
    return respuestaError(e)
  }
}
