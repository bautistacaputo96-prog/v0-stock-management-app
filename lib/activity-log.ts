/**
 * Libro de actividad: deja asentado quién hizo qué.
 *
 * En los borrados se guarda además una copia del registro eliminado (details),
 * para poder saber exactamente qué se perdió e incluso reponerlo a mano.
 * Nunca corta la operación: si el registro falla, se avisa por consola pero
 * la acción del usuario sigue adelante.
 */
import { createClient } from "@/lib/supabase/client"
import { currentUserName } from "@/lib/current-user"

export type ActivityAction = "crear" | "editar" | "borrar" | "transferir"
export type ActivityEntity =
  | "despacho"
  | "ingreso"
  | "pedido"
  | "material"
  | "chofer"
  | "bomba"
  | "planta"
  | "usuario"
  // fase 0c-1
  | "cliente"
  | "obra"
  | "formula"
  | "camion"
  | "proveedor"
  | "transportista"
  | "probeta"
  | "granulometria"
  | "calibracion"
  | "humedad"
  | "stock"
  | "orden_trabajo"

export const ENTITY_LABEL: Record<ActivityEntity, string> = {
  despacho: "Despacho",
  ingreso: "Ingreso de materia prima",
  pedido: "Pedido programado",
  material: "Material",
  chofer: "Chofer",
  bomba: "Empresa de bombeo",
  planta: "Tiempos de planta",
  usuario: "Usuario",
  cliente: "Cliente",
  obra: "Obra",
  formula: "Fórmula",
  camion: "Camión",
  proveedor: "Proveedor",
  transportista: "Transportista",
  probeta: "Probeta",
  granulometria: "Granulometría",
  calibracion: "Calibración de la prensa",
  humedad: "Humedad del acopio",
  stock: "Recuento / ajuste de stock",
  orden_trabajo: "Orden de trabajo",
}

export async function logActivity(opts: {
  action: ActivityAction
  entity: ActivityEntity
  entityId?: string | null
  reference?: string | null
  plantId?: string | null
  details?: Record<string, unknown> | null
}) {
  try {
    const supabase = createClient()
    if (!supabase) return
    await supabase.from("activity_log").insert({
      user_name: currentUserName(),
      action: opts.action,
      entity: opts.entity,
      entity_id: opts.entityId ?? null,
      reference: opts.reference ?? null,
      plant_id: opts.plantId ?? null,
      details: opts.details ?? null,
    })
  } catch (err) {
    console.error("[activity-log] no se pudo registrar:", err)
  }
}

/** Texto para mostrar un valor en Actividad ("-" si está vacío). */
function aTexto(v: unknown): string {
  if (v === null || v === undefined || v === "") return "-"
  if (typeof v === "boolean") return v ? "sí" : "no"
  if (typeof v === "object") return JSON.stringify(v)
  return String(v)
}

/**
 * Fase 0c-1 · Registra una edición con el antes → después, solo de lo que cambió, más el motivo.
 * `etiquetas` da el nombre en pantalla de cada campo (los que no figuran se registran con su clave).
 * Si no cambió nada, no registra (y devuelve false).
 */
export async function logCambio(opts: {
  entity: ActivityEntity
  entityId?: string | null
  reference?: string | null
  plantId?: string | null
  antes: Record<string, unknown>
  despues: Record<string, unknown>
  etiquetas?: Record<string, string>
  motivo?: string | null
  extra?: Record<string, unknown>
}): Promise<boolean> {
  const details: Record<string, unknown> = {}
  const campos = Object.keys(opts.etiquetas || opts.despues)
  for (const k of campos) {
    if (!(k in opts.despues)) continue
    const a = aTexto(opts.antes[k])
    const d = aTexto(opts.despues[k])
    if (a !== d) details[opts.etiquetas?.[k] || k] = `${a} → ${d}`
  }
  if (Object.keys(details).length === 0) return false
  if (opts.extra) Object.assign(details, opts.extra)
  if (opts.motivo) details.Motivo = opts.motivo
  await logActivity({ action: "editar", entity: opts.entity, entityId: opts.entityId, reference: opts.reference, plantId: opts.plantId, details })
  return true
}

/**
 * Registra un borrado y avisa por mail a los gerenciales.
 * El aviso se hace en el servidor (/api/notificar-borrado) porque necesita la
 * clave del servicio de mail. El motivo (fase 0c-1) va a Actividad y al mail.
 */
export async function logDeletion(opts: {
  entity: ActivityEntity
  entityId?: string | null
  reference?: string | null
  plantId?: string | null
  details?: Record<string, unknown> | null
  motivo?: string | null
}) {
  const { motivo, ...resto } = opts
  const details = motivo ? { ...(opts.details || {}), Motivo: motivo } : opts.details
  await logActivity({ ...resto, details, action: "borrar" })
  await notifyDeletion({ ...resto, details })
}

/**
 * Solo el mail de aviso de borrado a los gerenciales (sin asentar en Actividad).
 * Se usa cuando el registro en Actividad ya lo hizo la base (p. ej. anular_despacho).
 */
export async function notifyDeletion(opts: {
  entity: ActivityEntity
  reference?: string | null
  details?: Record<string, unknown> | null
}) {
  try {
    await fetch("/api/notificar-borrado", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        usuario: currentUserName(),
        entidad: ENTITY_LABEL[opts.entity],
        referencia: opts.reference || "-",
        detalle: opts.details || {},
      }),
    })
  } catch (err) {
    // El borrado ya quedó asentado; que falle el aviso no debe romper nada.
    console.error("[activity-log] no se pudo notificar el borrado:", err)
  }
}
