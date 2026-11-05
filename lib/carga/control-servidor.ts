/**
 * Datos de la sección "Carga de planta" del mail diario de control MP (SOLO servidor; spec 2026-11-05, 8).
 * Si no hay un puesto Indumix activo devuelve null: la sección no va y el mail queda igual que hoy.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { aPuesto, cargarContexto, cargarFormulas, controlDeFormula, aRecetaLeida } from "@/lib/carga/datos"
import type { CargaMail, DatosCarga, VersionReceta } from "@/lib/carga/control-mail"
import type { Salida } from "@/lib/carga/tipos"

const diaAR = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" })
const n = (x: unknown) => (x == null || !Number.isFinite(Number(x)) ? null : Number(x))

export async function datosControlCarga(sb: SupabaseClient, desde: string, hasta: string, opts: { semanal?: boolean } = {}): Promise<DatosCarga | null> {
  const { data: ps, error } = await sb.from("puestos_carga").select("*").eq("sistema", "indumix").eq("activo", true).order("created_at").limit(1)
  if (error || !ps?.length) return null
  const puesto = aPuesto(ps[0] as Record<string, unknown>)
  const ctx = await cargarContexto(sb, puesto)
  const { data: cg, error: e1 } = await sb.from("cargas")
    .select("id, contador_planta, inicio_at, fin_at, remito, remito_tipo, patente_planta, formula_id, receta_numero, m3, m3_cargados, dispatch_id, formulas(code), mixers(license_plate)")
    .eq("puesto_id", puesto.id).eq("simulada", false).gte("fin_at", desde).lt("fin_at", hasta).order("fin_at").limit(2000)
  if (e1) throw e1
  const cargas = (cg || []) as any[]
  const ids = cargas.map((c) => c.id)
  const dIds = cargas.map((c) => c.dispatch_id).filter(Boolean)
  const [cm, ex, ds] = await Promise.all([
    ids.length ? sb.from("cargas_materiales").select("carga_id, salida, receta_por_m3, teorico, teorico_corregido, real").in("carga_id", ids).eq("ciclo", 0) : Promise.resolve({ data: [] as any[] }),
    ids.length ? sb.from("cargas_agua_extra").select("carga_id, litros").in("carga_id", ids) : Promise.resolve({ data: [] as any[] }),
    dIds.length ? sb.from("dispatches").select("id, quantity_m3").in("id", dIds) : Promise.resolve({ data: [] as any[] }),
  ])
  const m3Desp = new Map(((ds.data || []) as any[]).map((d) => [d.id, n(d.quantity_m3)]))
  const nombreReceta = new Map(ctx.recetas.map((r) => [r.numero, r.nombre]))
  const filas: CargaMail[] = cargas.map((c) => ({
    id: c.id, contador: n(c.contador_planta), fin_at: c.fin_at, remito: c.remito, remito_tipo: c.remito_tipo,
    camion: c.mixers?.license_plate || c.patente_planta || null, formula_id: c.formula_id, formula_code: c.formulas?.code || null,
    receta_numero: n(c.receta_numero), receta_nombre: c.receta_numero != null ? nombreReceta.get(Number(c.receta_numero)) || null : null,
    m3_remito: c.dispatch_id ? m3Desp.get(c.dispatch_id) ?? null : null, m3: n(c.m3), m3_cargados: n(c.m3_cargados),
    materiales: ((cm.data || []) as any[]).filter((m) => m.carga_id === c.id).map((m) => ({
      salida: m.salida as Salida, receta_por_m3: n(m.receta_por_m3), teorico: n(m.teorico), teorico_corregido: n(m.teorico_corregido), real: n(m.real),
    })),
    agua_extra: ((ex.data || []) as any[]).filter((x) => x.carga_id === c.id).reduce((s, x) => s + Number(x.litros || 0), 0) || null,
  }))

  // Despachos de Canning sin carga, solo de los días en que el puente mandó datos
  const dias = new Set(cargas.map((c) => diaAR(c.fin_at)))
  let sinCarga: DatosCarga["sinCarga"] = []
  if (dias.size) {
    const { data: dsp } = await sb.from("dispatches").select("id, remito, remito_tipo, created_at, mixers(license_plate)")
      .eq("plant_id", puesto.plant_id).eq("is_test_dispatch", false).gte("created_at", desde).lt("created_at", hasta).limit(2000)
    const lista = ((dsp || []) as any[]).filter((d) => dias.has(diaAR(d.created_at)))
    const { data: con } = lista.length ? await sb.from("cargas").select("dispatch_id").eq("puesto_id", puesto.id).in("dispatch_id", lista.map((d) => d.id)) : { data: [] }
    const usados = new Set(((con || []) as any[]).map((x) => x.dispatch_id))
    sinCarga = lista.filter((d) => !usados.has(d.id)).map((d) => ({ remito: `${d.remito_tipo ? `${d.remito_tipo} ` : ""}${d.remito || ""}`.trim() || null, camion: d.mixers?.license_plate || null, at: d.created_at }))
  }

  const [perd, vers, al] = await Promise.all([
    sb.from("cargas_eventos").select("detalle").eq("puesto_id", puesto.id).eq("tipo", "cargas_perdidas").gte("created_at", desde).lt("created_at", hasta),
    sb.from("recetas_planta").select("*").eq("puesto_id", puesto.id).order("primera_lectura_at").limit(2000),
    sb.from("alertas_carga").select("titulo, created_at").eq("puesto_id", puesto.id).in("tipo", ["humedad", "tolva_material"]).gte("created_at", desde).lt("created_at", hasta).order("created_at"),
  ])
  // Versiones de las recetas que cambiaron en el período, con la anterior de cada una
  const todas = ((vers.data || []) as Record<string, unknown>[]).map(aRecetaLeida)
  const cambiaron = new Set(todas.filter((v) => v.primera_lectura_at >= desde && v.primera_lectura_at < hasta).map((v) => v.numero))
  const versiones: VersionReceta[] = []
  for (const num of cambiaron) {
    const vs = todas.filter((v) => v.numero === num && v.primera_lectura_at < hasta)
    const previa = vs.filter((v) => v.primera_lectura_at < desde).pop()
    for (const v of [...(previa ? [previa] : []), ...vs.filter((x) => x.primera_lectura_at >= desde)])
      versiones.push({ numero: v.numero, nombre: v.nombre, salidas: v.salidas, primera_lectura_at: v.primera_lectura_at })
  }

  const fIds = new Set<string>(filas.map((c) => c.formula_id).filter(Boolean) as string[])
  if (opts.semanal) for (const a of ctx.asignaciones) if (a.formula_id) fIds.add(a.formula_id)
  const formulas = await cargarFormulas(sb, [...fIds])
  let recetasNoCoinciden: DatosCarga["recetasNoCoinciden"] = []
  if (opts.semanal) {
    for (const a of ctx.asignaciones) {
      const f = formulas.find((x) => x.id === a.formula_id)
      const r = ctx.recetas.find((x) => x.numero === a.numero)
      if (!f || !r) continue
      const c = controlDeFormula(ctx, f)
      if (!c.cmp || c.cmp.ok) continue
      recetasNoCoinciden.push({ numero: a.numero, nombre: r.nombre, formula: f.code, texto: c.frenaReceta ? c.motivo || "no coincide" : c.items.find((i) => i.clave === "agua")?.texto || "agua distinta", frena: c.frenaReceta })
    }
  }
  return {
    planta: puesto.nombre.split("·")[0].trim(),
    semanal: !!opts.semanal,
    cargas: filas,
    formulas,
    salidas: ctx.salidas,
    materiales: ctx.materiales,
    tolerancias: puesto.tolerancias,
    sinCarga,
    perdidas: ((perd.data || []) as any[]).map((e) => ({ dia: String(e.detalle?.dia_planta || ""), texto: String(e.detalle?.texto || "") })).filter((x) => x.texto),
    versiones,
    desde,
    avisos: ((al.data || []) as any[]).map((a) => ({ titulo: a.titulo, at: a.created_at })),
    ultimoLatidoAt: puesto.ultimo_latido_at,
    recetasNoCoinciden,
  }
}
