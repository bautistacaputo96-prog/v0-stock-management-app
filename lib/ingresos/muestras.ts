/**
 * Humedad y muestra de granulometría de un ingreso de materia prima. Un solo lugar para el diálogo "Registrar Ingreso"
 * y para las acciones del historial ("Cargar humedad", "Muestra de granulometría"), que ahora se usan sobre todo con
 * los ingresos que entran solos desde Zomatik (docs/ingresos-mp-zomatik.md, punto 4).
 *
 * `efectosHumedad` y `calcularHumedad` son puras (se prueban con `npm run test:ingresos-zomatik`). Las demás reciben el
 * cliente de Supabase del navegador. Nunca tocan `current_stock` (lo lleva la base); sí `dry_stock`, como hasta ahora.
 */
import type { SupabaseClient } from "@supabase/supabase-js"

/** Tolerancia de humedad de la Arena Fina: lo que pasa de esto se le reclama al proveedor. */
export const TOLERANCIA_HUMEDAD = 3.0
/** Peso fijo de la muestra húmeda (g) de la calculadora. */
export const PESO_MUESTRA_HUMEDA = 500

/** La humedad (y el reclamo por exceso) se mide solo en la Arena Fina: a la 0/6 no se le mide. */
export const esArenaFina = (nombre: unknown) => String(nombre ?? "").trim().toLowerCase() === "arena fina"

const r2 = (n: number) => Math.round(n * 100) / 100

/** Humedad (%) con la calculadora: (500 − seco) / seco × 100. null si el peso seco no sirve. */
export function calcularHumedad(pesoSeco: number, pesoHumedo = PESO_MUESTRA_HUMEDA): number | null {
  if (!(pesoSeco > 0 && pesoSeco < pesoHumedo)) return null
  return r2(((pesoHumedo - pesoSeco) / pesoSeco) * 100)
}

/**
 * Qué cambia al cargar (o corregir) la humedad de un ingreso de `quantity` kg (peso del remito):
 *   seco = quantity / (1 + h/100); dry_stock += seco − seco anterior; si pasa la tolerancia, el excedente.
 */
export function efectosHumedad(d: { quantity: number; dryViejo: number | null | undefined; humedad: number; tolerancia?: number }): {
  dryNuevo: number
  dryDiff: number
  exceso: { pct: number; kg: number; tn: number } | null
} {
  const tol = d.tolerancia ?? TOLERANCIA_HUMEDAD
  const q = Number(d.quantity) || 0
  const dryNuevo = d.humedad > 0 ? r2(q / (1 + d.humedad / 100)) : q
  const dryViejo = d.dryViejo ?? q
  const exceso = d.humedad > tol ? { pct: r2(d.humedad - tol), kg: r2((q * (d.humedad - tol)) / 100), tn: Math.round(((q * (d.humedad - tol)) / 100 / 1000) * 10_000) / 10_000 } : null
  return { dryNuevo, dryDiff: r2(dryNuevo - dryViejo), exceso }
}

export type IngresoMuestra = {
  id: string
  material_id: string
  quantity: number
  dry_quantity?: number | null
  humidity_percentage?: number | null
  remito?: string | null
  entry_date: string
  supplier_id?: string | null
  plant_id?: string | null
}

/** Suma (o resta) al stock seco del material. Solo la Arena Fina lleva stock seco (como el diálogo de siempre). */
export async function moverStockSeco(sb: SupabaseClient, materialId: string, diff: number) {
  if (Math.abs(diff) < 0.0001) return
  const { data, error } = await sb.from("materials").select("dry_stock").eq("id", materialId).single()
  if (error) throw error
  const { error: e2 } = await sb
    .from("materials")
    .update({ dry_stock: (Number((data as any)?.dry_stock) || 0) + diff })
    .eq("id", materialId)
  if (e2) throw e2
}

/** Graba el excedente de humedad de un ingreso (reemplaza el que haya si no está acreditado). */
export async function grabarExcedente(sb: SupabaseClient, e: IngresoMuestra, humedad: number, supplierId: string, plantId: string | null | undefined) {
  const ef = efectosHumedad({ quantity: e.quantity, dryViejo: e.dry_quantity, humedad })
  const { error: eDel } = await sb.from("humidity_excess_log").delete().eq("stock_entry_id", e.id).eq("credited", false)
  if (eDel) throw eDel
  if (!ef.exceso) return
  const { error } = await sb.from("humidity_excess_log").insert({
    stock_entry_id: e.id,
    entry_date: e.entry_date.slice(0, 10),
    material_id: e.material_id,
    supplier_id: supplierId,
    remito: e.remito || null,
    original_quantity_kg: e.quantity,
    humidity_percentage: humedad,
    tolerance_percentage: TOLERANCIA_HUMEDAD,
    excess_humidity_percentage: ef.exceso.pct,
    excess_quantity_kg: ef.exceso.kg,
    excess_quantity_tn: ef.exceso.tn,
    plant_id: plantId ?? null,
  })
  if (error) throw error
}

/**
 * Carga o corrige la humedad de un ingreso de Arena Fina desde el historial: humedad, seco, stock seco y excedente.
 * Si pasa la tolerancia hace falta el proveedor (`humidity_excess_log.supplier_id` es obligatorio): si el ingreso no
 * lo tiene, se pasa en `supplierId` y queda guardado en el ingreso. Si el excedente ya está acreditado, no se cambia.
 */
export async function guardarHumedad(sb: SupabaseClient, e: IngresoMuestra, humedad: number, opts: { supplierId?: string | null } = {}) {
  if (!(humedad >= 0 && humedad < 100)) throw new Error("La humedad tiene que ser entre 0 y 100 %")
  const ef = efectosHumedad({ quantity: e.quantity, dryViejo: e.dry_quantity, humedad })
  const proveedor = opts.supplierId || e.supplier_id || null
  if (ef.exceso && !proveedor) throw new Error("Elegí el proveedor: hace falta para el reclamo por exceso de humedad")
  const { data: acreditados } = await sb.from("humidity_excess_log").select("id").eq("stock_entry_id", e.id).eq("credited", true).limit(1)
  if ((acreditados as any[] | null)?.length) throw new Error("El excedente de este ingreso ya está acreditado: la humedad no se puede cambiar")
  const { error } = await sb
    .from("stock_entries")
    .update({ humidity_percentage: humedad, dry_quantity: ef.dryNuevo, ...(opts.supplierId && !e.supplier_id ? { supplier_id: opts.supplierId } : {}) })
    .eq("id", e.id)
  if (error) throw error
  await moverStockSeco(sb, e.material_id, ef.dryDiff)
  if (proveedor) await grabarExcedente(sb, { ...e, dry_quantity: ef.dryNuevo }, humedad, proveedor, e.plant_id)
  return ef
}

/** Crea el ensayo de granulometría pendiente y lo vincula al ingreso por id (como el diálogo de siempre). */
export async function crearMuestraGranulometria(
  sb: SupabaseClient,
  e: IngresoMuestra,
  d: { materialName: string; providerName: string; supplierId?: string | null; plantId?: string | null; fecha?: string },
): Promise<string> {
  const { data, error } = await sb
    .from("granulometria_tests")
    .insert({
      extraction_date: d.fecha || e.entry_date.slice(0, 10),
      material_id: e.material_id,
      supplier_id: d.supplierId ?? e.supplier_id ?? null,
      provider: d.providerName || "",
      aggregate_type: d.materialName || "",
      // Obligatorio en la tabla (NOT NULL): el peso fijo de la muestra, como edit-granulometria-dialog
      sample_weight_grams: PESO_MUESTRA_HUMEDA,
      remito: e.remito || null,
      plant_id: d.plantId ?? e.plant_id ?? null,
      stock_entry_id: e.id,
      comments: "Pendiente de completar ensayo",
    })
    .select("id")
    .single()
  if (error) throw error
  const id = (data as any).id as string
  const { error: e2 } = await sb.from("stock_entries").update({ sample_taken_granulometry: true, granulometry_test_id: id }).eq("id", e.id)
  if (e2) throw e2
  return id
}

/** ¿El error es de una columna que todavía no existe (migración sin aplicar)? */
export const faltaColumna = (error: any, columna: string) =>
  !!error && (error.code === "PGRST204" || error.code === "42703" || /column|columna/i.test(error.message || "")) && new RegExp(columna, "i").test(error.message || "")

/**
 * Inserta un ingreso cargado a mano con `origen = 'manual'`. Sin la migración (la columna no existe), lo inserta como
 * siempre. El stock lo suma la base al insertar (trigger): acá no se suma.
 */
export async function insertarIngresoManual(sb: SupabaseClient, fila: Record<string, unknown>) {
  let r = await sb.from("stock_entries").insert({ ...fila, origen: "manual" }).select().single()
  if (r.error && faltaColumna(r.error, "origen")) r = await sb.from("stock_entries").insert(fila).select().single()
  return r
}
