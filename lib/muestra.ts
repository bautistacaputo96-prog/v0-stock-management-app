/**
 * "Agregar muestra después del despacho" (Historial, fase 0c-1): el mismo camino lo usa la pantalla de Carga al
 * terminar ("¿Se sacó muestra?", respuestas de Bautista 21/10 · 5).
 *
 * - Marca el despacho: sample_taken, sample_number y actual_slump_cm.
 * - Si el despacho no tiene probetas, crea 3 (1 a 7 días y 2 a 28), con el moldeo en la fecha del despacho
 *   (la rotura se programa desde ahí, no desde el día en que se registra la muestra).
 * - Queda en Actividad.
 *
 * El trigger `trigger_create_test_cylinders` corre solo al insertar el despacho: por eso, cuando la muestra se
 * agrega después, las probetas las crea esta función (igual que siempre lo hizo el Historial).
 */
import { addDays, format, parseISO } from "date-fns"

export type Probeta = { dispatch_id: string; cylinder_number: number; test_age_days: number; scheduled_test_date: string }

/** Las 3 probetas de una muestra: 7, 28 y 28 días desde el moldeo (la fecha del despacho). */
export function probetasParaMuestra(dispatchId: string, fechaDespacho: string | null | undefined): Probeta[] {
  const moldeo = fechaDespacho ? parseISO(fechaDespacho) : new Date()
  return [
    { dispatch_id: dispatchId, cylinder_number: 1, test_age_days: 7, scheduled_test_date: format(addDays(moldeo, 7), "yyyy-MM-dd") },
    { dispatch_id: dispatchId, cylinder_number: 2, test_age_days: 28, scheduled_test_date: format(addDays(moldeo, 28), "yyyy-MM-dd") },
    { dispatch_id: dispatchId, cylinder_number: 3, test_age_days: 28, scheduled_test_date: format(addDays(moldeo, 28), "yyyy-MM-dd") },
  ]
}

/** Asentamiento válido en cm (como lo pide el Historial). null si no es un número. */
export function asentamientoValido(t: string | number | null | undefined): number | null {
  const n = Number.parseFloat(String(t ?? "").replace(",", "."))
  return Number.isFinite(n) && n >= 0 && n <= 30 ? n : null
}

type Log = (o: { action: "editar"; entity: "despacho"; entityId: string; reference: string | null; plantId: string | null; details: Record<string, unknown> }) => unknown

/**
 * Graba la muestra de un despacho ya hecho. `sb` es el cliente del navegador; `log`, logActivity.
 * Devuelve si se crearon las probetas o ya tenía.
 */
export async function agregarMuestraDespacho(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  log: Log,
  o: { dispatchId: string; numero: string; asentamiento: number; remito: string | null; plantId: string | null; origen: string },
): Promise<{ ok: true; probetas: "creadas" | "ya_tenia" } | { ok: false; error: string }> {
  const { error } = await sb.from("dispatches").update({ sample_taken: true, sample_number: o.numero.trim(), actual_slump_cm: o.asentamiento }).eq("id", o.dispatchId)
  if (error) return { ok: false, error: "No se pudo guardar la muestra" }
  const { data: existentes } = await sb.from("test_cylinders").select("id").eq("dispatch_id", o.dispatchId).limit(1)
  const yaTenia = !!existentes && existentes.length > 0
  if (!yaTenia) {
    const { data: d } = await sb.from("dispatches").select("dispatch_date").eq("id", o.dispatchId).single()
    const { error: e2 } = await sb.from("test_cylinders").insert(probetasParaMuestra(o.dispatchId, d?.dispatch_date))
    if (e2) console.error("Error creating test cylinders:", e2)
  }
  log({
    action: "editar", entity: "despacho", entityId: o.dispatchId, reference: o.remito, plantId: o.plantId,
    details: { Muestra: o.numero.trim(), "Asentamiento (cm)": o.asentamiento, Probetas: yaTenia ? "ya tenía (no se crearon)" : "3 creadas (7 y 28 días)", Origen: o.origen },
  })
  return { ok: true, probetas: yaTenia ? "ya_tenia" : "creadas" }
}
