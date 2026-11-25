/**
 * Los últimos ingresos de un material (en su planta: el material ya es de una planta) para el aviso de cantidad rara
 * (lib/ingresos/validar.ts, avisoCantidadRara). Lo usan el alta y la edición desde el navegador. Solo lee.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import type { IngresoPrevio } from "@/lib/ingresos/validar"

/** Del más nuevo al más viejo, sin anulados ni cantidades en 0, sin el ingreso que se está editando. Ante error, []. */
export async function ultimosIngresos(sb: SupabaseClient, materialId: string, opts: { excluirId?: string } = {}): Promise<IngresoPrevio[]> {
  const buscar = (conAnulado: boolean) => {
    let q = sb
      .from("stock_entries")
      .select(conAnulado ? "id, quantity, supplier_id, anulado_at" : "id, quantity, supplier_id")
      .eq("material_id", materialId)
      .gt("quantity", 0)
      .order("entry_date", { ascending: false })
      .limit(60)
    if (conAnulado) q = q.is("anulado_at", null)
    return q
  }
  // Sin la migración de la importación (no hay anulado_at), como siempre
  let { data, error } = await buscar(true)
  if (error) ({ data, error } = await buscar(false))
  if (error) return []
  return ((data as any[]) || [])
    .filter((x) => x.id !== opts.excluirId)
    .map((x) => ({ kg: Number(x.quantity) || 0, supplier_id: x.supplier_id ?? null }))
}
