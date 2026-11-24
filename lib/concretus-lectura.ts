/**
 * Fase 0c-2 · Lectura propia para Concretus (otro sistema, repo aparte), que hasta ahora leía la base de Rebucret con
 * la clave pública desde su servidor para el WhatsApp diario. Con la RLS, la clave pública no ve nada: Concretus
 * pasa a pedir esto a `GET /api/concretus/lectura` con su secreto (el mismo de /api/reparto/resumen).
 *
 * Devuelve SOLO lo que usa su reporte: m³, cliente, obra, fórmula, hora/fecha, urgente y estado. Sin CUIT, sin
 * domicilios, sin precios. Rango máximo: 3 días.
 *
 * Sin imports de otros archivos del proyecto (se prueba con `node --test`).
 */

export const MAX_DIAS_LECTURA = 3

export type TipoLectura = "despachos" | "programacion"

export type ParamsLectura = { tipo: TipoLectura; desde: string; hasta: string }

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})$/

export function validarLectura(sp: { get(nombre: string): string | null }): { ok: true; params: ParamsLectura } | { ok: false; error: string } {
  const tipo = sp.get("tipo")
  if (tipo !== "despachos" && tipo !== "programacion") return { ok: false, error: "tipo tiene que ser despachos o programacion" }
  const desde = sp.get("desde") || ""
  const hasta = sp.get("hasta") || ""
  if (!ISO.test(desde) || !ISO.test(hasta)) return { ok: false, error: "desde y hasta tienen que ser fecha y hora ISO con zona (ej. 2026-11-24T03:00:00Z)" }
  const d = new Date(desde).getTime()
  const h = new Date(hasta).getTime()
  if (!Number.isFinite(d) || !Number.isFinite(h)) return { ok: false, error: "Fecha inválida" }
  if (h <= d) return { ok: false, error: "hasta tiene que ser después de desde" }
  if (h - d > MAX_DIAS_LECTURA * 24 * 60 * 60 * 1000) return { ok: false, error: `Como mucho ${MAX_DIAS_LECTURA} días por consulta` }
  return { ok: true, params: { tipo, desde: new Date(d).toISOString(), hasta: new Date(h).toISOString() } }
}

type Nombres = { clientes: Map<string, string>; obras: Map<string, string>; formulas: Map<string, string> }

const nombre = (m: Map<string, string>, id: unknown) => (typeof id === "string" && m.get(id)) || null

/** Despachos reales (sin los de prueba) con los nombres. */
export function filasDespachos(filas: any[], n: Nombres) {
  return filas
    .filter((d) => d && d.is_test_dispatch !== true)
    .map((d) => ({
      quantity_m3: d.quantity_m3 == null ? null : Number(d.quantity_m3),
      client_id: d.client_id ?? null,
      construction_site_id: d.construction_site_id ?? null,
      formula_id: d.formula_id ?? null,
      dispatch_date: d.dispatch_date ?? null,
      is_test_dispatch: false,
      cliente: nombre(n.clientes, d.client_id),
      obra: nombre(n.obras, d.construction_site_id),
      formula: nombre(n.formulas, d.formula_id),
    }))
}

/** Pedidos programados (sin los cancelados) con los nombres, por hora de llegada. */
export function filasProgramacion(filas: any[], n: Nombres) {
  return filas
    .filter((p) => p && p.status != null && p.status !== "cancelled")
    .sort((a, b) => String(a.scheduled_arrival_time || "").localeCompare(String(b.scheduled_arrival_time || "")))
    .map((p) => ({
      quantity_m3: p.quantity_m3 == null ? null : Number(p.quantity_m3),
      scheduled_arrival_time: p.scheduled_arrival_time ?? null,
      is_urgent: p.is_urgent === true,
      status: p.status ?? null,
      client_id: p.client_id ?? null,
      construction_site_id: p.construction_site_id ?? null,
      formula_id: p.formula_id ?? null,
      cliente: nombre(n.clientes, p.client_id),
      obra: nombre(n.obras, p.construction_site_id),
      formula: nombre(n.formulas, p.formula_id),
    }))
}

/** Ids distintos (no vacíos) de una columna, para traer solo los nombres que hacen falta. */
export function idsDe(filas: any[], col: string): string[] {
  return [...new Set(filas.map((f) => f?.[col]).filter((x): x is string => typeof x === "string" && !!x))]
}
