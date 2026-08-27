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

export type ActivityAction = "crear" | "editar" | "borrar"
export type ActivityEntity = "despacho" | "ingreso" | "pedido" | "material"

const ENTITY_LABEL: Record<ActivityEntity, string> = {
  despacho: "Despacho",
  ingreso: "Ingreso de materia prima",
  pedido: "Pedido programado",
  material: "Material",
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

/**
 * Registra un borrado y avisa por mail a los supervisores.
 * El aviso se hace en el servidor (/api/notificar-borrado) porque necesita la
 * clave del servicio de mail.
 */
export async function logDeletion(opts: {
  entity: ActivityEntity
  entityId?: string | null
  reference?: string | null
  plantId?: string | null
  details?: Record<string, unknown> | null
}) {
  const user = currentUserName()
  await logActivity({ ...opts, action: "borrar" })

  try {
    await fetch("/api/notificar-borrado", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        usuario: user,
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
