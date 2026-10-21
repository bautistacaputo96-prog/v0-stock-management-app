/**
 * Lectura de la base para la carga de planta. La usan el navegador (cliente anon, solo lectura) y las rutas
 * /api/carga/* (clave de servicio). Si la migración 202610211800_carga_planta.sql todavía no se aplicó, las tablas no
 * existen: todo devuelve null / vacío y las pantallas lo dicen, sin romper el despacho.
 */
import { controlReceta, type ControlReceta } from "@/lib/carga/receta"
import {
  TOLERANCIAS_BASE,
  type FormulaSistema, type MaterialSistema, type RecetaPlanta, type Salida, type SalidaMapa, type Tolerancias, type UnidadPlanta,
} from "@/lib/carga/tipos"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = any

export type Puesto = {
  id: string
  plant_id: string
  nombre: string
  sistema: "indumix" | "simulador"
  etapa: "lectura" | "orden" | "arranque" | "apagado"
  max_recetas: number
  m3_max_ciclo: number
  tolerancias: Tolerancias
  usa_kilos_reales: boolean
  activo: boolean
}

export type RecetaLeida = RecetaPlanta & { id: string; huella: string; ultima_lectura_at: string; primera_lectura_at: string }
export type Asignacion = { numero: number; formula_id: string | null; tipo: "fija" | "rotativa" }

export type Contexto = {
  puesto: Puesto
  salidas: SalidaMapa[]
  /** filas vigentes de puesto_salidas (con id y desde cuándo) */
  salidasFilas: { id: string; salida: Salida; material_id: string | null; vigente_desde: string; cambiado_por: string | null }[]
  asignaciones: Asignacion[]
  recetas: RecetaLeida[]
  materiales: MaterialSistema[]
}

/** Las tolerancias del puesto, completadas con las de la spec (6.2). */
export function tolerancias(raw: unknown): Tolerancias {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Tolerancias>
  const out: Tolerancias = JSON.parse(JSON.stringify(TOLERANCIAS_BASE))
  for (const g of ["cemento", "agua", "arido", "aditivo"] as const) {
    const t = r.receta?.[g]
    if (t && Number.isFinite(Number(t.rel)) && Number.isFinite(Number(t.abs))) out.receta[g] = { rel: Number(t.rel), abs: Number(t.abs) }
    const p = r.pesaje?.[g]
    if (p != null && Number.isFinite(Number(p))) out.pesaje[g] = Number(p)
  }
  return out
}

function aPuesto(p: Record<string, unknown>): Puesto {
  return {
    id: String(p.id), plant_id: String(p.plant_id), nombre: String(p.nombre || ""), sistema: p.sistema === "indumix" ? "indumix" : "simulador",
    etapa: (["lectura", "orden", "arranque", "apagado"].includes(String(p.etapa)) ? p.etapa : "apagado") as Puesto["etapa"],
    max_recetas: Number(p.max_recetas) || 20, m3_max_ciclo: Number(p.m3_max_ciclo) || 1.5, tolerancias: tolerancias(p.tolerancias),
    usa_kilos_reales: p.usa_kilos_reales === true, activo: p.activo !== false,
  }
}

/** El puesto activo de la planta (el simulador, hoy). null: no hay, o falta la migración. */
export async function cargarPuesto(sb: SB, plantId: string): Promise<Puesto | null> {
  try {
    const { data, error } = await sb.from("puestos_carga").select("*").eq("plant_id", plantId).eq("activo", true).order("created_at")
    if (error || !data?.length) return null
    return aPuesto(data[0])
  } catch {
    return null
  }
}

export async function cargarPuestoPorId(sb: SB, id: string): Promise<Puesto | null> {
  try {
    const { data, error } = await sb.from("puestos_carga").select("*").eq("id", id).maybeSingle()
    if (error || !data) return null
    return aPuesto(data)
  } catch {
    return null
  }
}

/** ¿Despachar manda la orden a la cola de este puesto? (etapas B y C) */
export const mandaOrdenes = (p: Puesto | null) => !!p && p.activo && (p.etapa === "orden" || p.etapa === "arranque")

export function aRecetaLeida(r: Record<string, unknown>): RecetaLeida {
  const valores = Array.isArray(r.valores) ? (r.valores as RecetaPlanta["salidas"]) : []
  return {
    id: String(r.id), numero: Number(r.numero), nombre: String(r.nombre || ""), habilitada: r.habilitada !== false,
    salidas: valores.map((s) => ({ salida: s.salida, nombre_planta: s.nombre_planta, valor: Number(s.valor) || 0, unidad: s.unidad, ...(s.orden != null ? { orden: Number(s.orden) } : {}) })),
    huella: String(r.huella), ultima_lectura_at: String(r.ultima_lectura_at), primera_lectura_at: String(r.primera_lectura_at),
  }
}

export async function cargarContexto(sb: SB, puesto: Puesto): Promise<Contexto> {
  const [s, a, r, m] = await Promise.all([
    sb.from("puesto_salidas").select("*").eq("puesto_id", puesto.id).is("vigente_hasta", null),
    sb.from("puesto_recetas").select("numero, formula_id, tipo").eq("puesto_id", puesto.id).order("numero"),
    sb.from("recetas_planta_actual").select("*").eq("puesto_id", puesto.id).order("numero"),
    sb.from("materials").select("id, name, tipo, unit").eq("plant_id", puesto.plant_id),
  ])
  const filas = ((s.data || []) as Record<string, unknown>[])
  return {
    puesto,
    salidas: filas.map((x) => ({
      salida: x.salida as Salida, nombre_planta: (x.nombre_planta as string) ?? null, material_id: (x.material_id as string) ?? null,
      unidad_planta: x.unidad_planta as UnidadPlanta, factor: Number(x.factor_a_unidad_sistema) || 1, alternativas: (x.alternativas as string[] | null) ?? null,
    })),
    salidasFilas: filas.map((x) => ({ id: String(x.id), salida: x.salida as Salida, material_id: (x.material_id as string) ?? null, vigente_desde: String(x.vigente_desde), cambiado_por: (x.cambiado_por as string) ?? null })),
    asignaciones: ((a.data || []) as Asignacion[]).map((x) => ({ numero: Number(x.numero), formula_id: x.formula_id, tipo: x.tipo })),
    recetas: ((r.data || []) as Record<string, unknown>[]).map(aRecetaLeida),
    materiales: ((m.data || []) as MaterialSistema[]),
  }
}

/** Fórmulas con sus materiales (por m³). */
export async function cargarFormulas(sb: SB, ids: string[] | { plantId: string }): Promise<FormulaSistema[]> {
  let q = sb.from("formulas").select("id, code, formula_materials(material_id, quantity)")
  q = Array.isArray(ids) ? q.in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]) : q.eq("plant_id", ids.plantId)
  const { data } = await q
  return ((data || []) as { id: string; code: string; formula_materials: { material_id: string; quantity: number }[] | null }[]).map((f) => ({
    id: f.id, code: f.code, materiales: (f.formula_materials || []).map((m) => ({ material_id: m.material_id, cantidad: Number(m.quantity) || 0 })),
  }))
}

/** Número y receta actual de una fórmula en el puesto. */
export function recetaDeFormula(ctx: Contexto, formulaId: string | null | undefined): { numero: number | null; receta: RecetaLeida | null } {
  const a = formulaId ? ctx.asignaciones.find((x) => x.formula_id === formulaId) : null
  if (!a) return { numero: null, receta: null }
  return { numero: a.numero, receta: ctx.recetas.find((r) => r.numero === a.numero) || null }
}

/** "Autorizar solo esta carga" vale hasta el fin del día en que se dio. */
export function autorizacionVigente(a: unknown, ahora = Date.now()): { por: string; motivo?: string | null } | null {
  const x = a as { por?: string; motivo?: string | null; vence?: string } | null
  if (!x?.por) return null
  if (x.vence && new Date(x.vence).getTime() < ahora) return null
  return { por: x.por, motivo: x.motivo ?? null }
}

/** Control de receta de una fórmula en el puesto, con lo que hay hoy en la base. */
export function controlDeFormula(ctx: Contexto, formula: FormulaSistema | null, autorizacion?: unknown): ControlReceta & { receta: RecetaLeida | null } {
  const { numero, receta } = recetaDeFormula(ctx, formula?.id)
  const c = controlReceta({ numero, receta, formula, salidas: ctx.salidas, materiales: ctx.materiales, tolerancias: ctx.puesto.tolerancias, autorizada: autorizacionVigente(autorizacion) })
  return { ...c, receta }
}

/** Lo que se guarda en `cargas.bloqueo` (y lo que lee la tarjeta del camión en Despacho). */
export function bloqueoDe(c: ControlReceta) {
  return {
    frena: c.frena,
    motivo: c.motivo,
    agua: c.aguaDistinta,
    items: c.items.map((i) => ({ clave: i.clave, ok: i.ok, aviso: !!i.aviso, corto: i.corto, texto: i.texto })),
  }
}
export type Bloqueo = ReturnType<typeof bloqueoDe>

/**
 * Materiales de una carga a partir del reporte de Indumix (para cargas_materiales, ciclo 0). Todo en la unidad de
 * Indumix (aditivo en g); `formula_por_m3` también, para comparar a la vista.
 */
export function materialesDeReporte(
  rep: { m3: number; lineas: { salida: Salida; receta: number; teorico: number; teorico_corregido: number; real: number; humedad_pct?: number; extra?: number }[] },
  salidas: SalidaMapa[],
  formula: FormulaSistema | null,
) {
  const pide = new Set((formula?.materiales || []).filter((m) => m.cantidad > 0).map((m) => m.material_id))
  return rep.lineas.map((l) => {
    const s = salidas.find((x) => x.salida === l.salida)
    // La Tolva 1 vale lo que tiene cargado (no lo que pide la fórmula): eso es lo que salió de verdad
    const mat = s?.material_id ?? null
    const fm = formula?.materiales.find((m) => m.material_id === mat)
    const usadaPorOtra = !!mat && rep.lineas.some((o) => o.salida !== l.salida && o.real > 0 && salidas.find((x) => x.salida === o.salida)?.material_id === mat && SALIDAS_ORDEN.indexOf(o.salida) < SALIDAS_ORDEN.indexOf(l.salida))
    return {
      salida: l.salida, material_id: mat, receta_por_m3: l.receta,
      formula_por_m3: fm && pide.has(fm.material_id) && !usadaPorOtra ? Math.round((fm.cantidad / (s?.factor || 1)) * 1000) / 1000 : fm ? 0 : null,
      teorico: l.teorico, humedad_pct: l.humedad_pct ?? null, teorico_corregido: l.teorico_corregido, real: l.real, extra: l.extra ?? 0,
      unidad: s?.unidad_planta || (l.salida.startsWith("aditivo") ? "g" : l.salida === "agua" ? "L" : "kg"),
    }
  })
}
const SALIDAS_ORDEN: Salida[] = ["arido_1", "arido_2", "arido_3", "arido_4", "cemento_1", "cemento_2", "aditivo_1", "aditivo_2", "agua"]
