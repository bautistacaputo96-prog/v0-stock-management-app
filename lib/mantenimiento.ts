/**
 * Lógica compartida del módulo de mantenimiento.
 *
 * Modelo:
 *  - El PLAN (maint_tasks) dice qué hay que hacer y cada cuánto. Es el motor.
 *  - Cuando una tarea vence, se genera una ORDEN DE TRABAJO (maint_work_orders).
 *    El operario trabaja sobre órdenes: las empieza, tilda pasos, saca fotos y
 *    las completa. También puede crear órdenes correctivas ("se rompió X").
 *  - Al completar una orden preventiva se registra una EJECUCIÓN
 *    (maint_executions), que es lo que reinicia el contador de la tarea.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { addDays, differenceInCalendarDays, parseISO, format, startOfDay } from "date-fns"

export type Item = { id: string; item: string; cantidad: number | null; unidad: string | null; tipo: string; codigo_repuesto: string | null }
export type Foto = { id: string; url: string; epigrafe: string | null; orden: number }
export type Paso = { id: string; texto: string; orden: number }

export type Tarea = {
  id: string
  equipment_id: string
  codigo: string | null
  titulo: string
  detalle: string | null
  componente: string | null
  frecuencia_dias: number | null
  frecuencia_m3: number | null
  referencia_manual: string | null
  asignado_default: string | null
  duracion_min: number | null
  maint_task_items: Item[]
  maint_task_images: Foto[]
  maint_task_steps: Paso[]
}

export type Ejecucion = { task_id: string; fecha: string; realizado_por: string | null; m3_acumulado: number | null }

export type EstadoOT = "pendiente" | "en_curso" | "completada" | "cancelada"

export type OrdenTrabajo = {
  id: string
  numero: number
  equipment_id: string
  task_id: string | null
  tipo: "preventiva" | "correctiva"
  titulo: string
  descripcion: string | null
  componente: string | null
  estado: EstadoOT
  prioridad: "baja" | "normal" | "alta" | "urgente"
  fecha_programada: string
  fecha_inicio: string | null
  fecha_fin: string | null
  asignado_a: string | null
  creado_por: string | null
  completado_por: string | null
  observaciones: string | null
  pasos: Record<string, boolean> | null
  m3_acumulado: number | null
  created_at: string
  maint_work_order_photos?: { id: string; url: string; comentario: string | null; subida_por: string | null; created_at: string }[]
}

/** Los 8 conjuntos de la Indumóvil, con un ícono y una descripción corta. */
export const COMPONENTES: Record<string, { icono: string; descripcion: string }> = {
  "Cinta transportadora": { icono: "conveyor", descripcion: "Lleva los áridos desde las tolvas hasta el camión" },
  "Tornillos de cemento": { icono: "screw", descripcion: "Transportan el cemento del silo a la balanza y de la balanza al camión" },
  "Reductores": { icono: "gear", descripcion: "Cajas reductoras del cabezal motriz y de los tornillos" },
  "Sistema neumático": { icono: "air", descripcion: "Compresor, regulador, electroválvulas y cilindros de las compuertas" },
  "Tolvas de áridos": { icono: "hopper", descripcion: "Acopio y pesada de arena y piedra, con sus compuertas" },
  "Balanza de cemento": { icono: "scale", descripcion: "Pesa el cemento antes de descargarlo" },
  "Circuito de agua": { icono: "water", descripcion: "Tanque, bomba, filtro y válvulas de dosificación de agua" },
  "Dosificador de aditivos": { icono: "flask", descripcion: "Bombas y circuito de aditivos químicos" },
  "Tablero eléctrico": { icono: "bolt", descripcion: "Tablero de potencia y comando de la planta" },
}

/** Nombre legible de la frecuencia. */
export function etiquetaFrecuencia(dias: number | null): string {
  if (!dias) return "Sin frecuencia"
  if (dias <= 1) return "Diaria"
  if (dias <= 7) return "Semanal"
  if (dias <= 15) return "Quincenal"
  if (dias <= 31) return "Mensual"
  if (dias <= 62) return "Bimestral"
  if (dias <= 93) return "Trimestral"
  if (dias <= 186) return "Semestral"
  if (dias <= 366) return "Anual"
  if (dias <= 550) return "Cada 1½ años"
  if (dias <= 731) return "Cada 2 años"
  if (dias <= 1300) return "Cada 3½ años"
  return "Cada 7 años"
}

/**
 * Cuándo vence la próxima vez una tarea.
 * Si nunca se registró, vence hoy (hay que hacer la puesta a cero).
 * Si además vence por m³ y eso cae antes, se adelanta.
 */
export function proximoVencimiento(t: Tarea, ultima: Ejecucion | undefined, m3Actual: number): { fecha: Date; porM3: boolean; restanM3: number | null } {
  const hoy = startOfDay(new Date())
  if (!ultima) return { fecha: hoy, porM3: false, restanM3: null }

  let fecha = t.frecuencia_dias ? addDays(startOfDay(parseISO(ultima.fecha)), t.frecuencia_dias) : addDays(hoy, 3650)
  let porM3 = false
  let restanM3: number | null = null

  if (t.frecuencia_m3 && ultima.m3_acumulado != null) {
    restanM3 = t.frecuencia_m3 - (m3Actual - Number(ultima.m3_acumulado))
    if (restanM3 <= 0 && fecha > hoy) {
      fecha = hoy
      porM3 = true
    }
  }
  return { fecha, porM3, restanM3 }
}

export type Nivel = "vencida" | "hoy" | "proxima" | "ok"

export function nivelDeFecha(fecha: Date): Nivel {
  const d = differenceInCalendarDays(fecha, new Date())
  if (d < 0) return "vencida"
  if (d === 0) return "hoy"
  if (d <= 7) return "proxima"
  return "ok"
}

export function textoVencimiento(fecha: Date, porM3: boolean, restanM3: number | null): string {
  const d = differenceInCalendarDays(fecha, new Date())
  if (porM3 && restanM3 !== null) return `Vencida por ${Math.abs(Math.round(restanM3))} m³`
  if (d < 0) return `Vencida hace ${Math.abs(d)} día${Math.abs(d) === 1 ? "" : "s"}`
  if (d === 0) return "Vence hoy"
  if (d === 1) return "Mañana"
  return `En ${d} días`
}

/** Carga todo lo que el módulo necesita para un equipo. */
export async function cargarDatosEquipo(supabase: SupabaseClient, equipmentId: string, plantId: string) {
  const [{ data: tareas }, { data: ejec }, { data: desp }, { data: ordenes }] = await Promise.all([
    supabase
      .from("maint_tasks")
      .select("*, maint_task_items(*), maint_task_images(*), maint_task_steps(*)")
      .eq("equipment_id", equipmentId)
      .eq("activo", true)
      .order("orden"),
    supabase.from("maint_executions").select("task_id, fecha, realizado_por, m3_acumulado").order("fecha", { ascending: false }),
    supabase.from("dispatches").select("quantity_m3").eq("plant_id", plantId).limit(20000),
    supabase
      .from("maint_work_orders")
      .select("*, maint_work_order_photos(*)")
      .eq("equipment_id", equipmentId)
      .order("fecha_programada")
      .order("numero"),
  ])

  const ultimaPorTarea: Record<string, Ejecucion> = {}
  ;(ejec || []).forEach((e: any) => {
    if (!ultimaPorTarea[e.task_id]) ultimaPorTarea[e.task_id] = e
  })
  const m3Actual = (desp || []).reduce((s: number, d: any) => s + Number(d.quantity_m3 || 0), 0)

  return {
    tareas: (tareas || []) as Tarea[],
    ultimaPorTarea,
    m3Actual,
    ordenes: (ordenes || []) as OrdenTrabajo[],
  }
}

/**
 * Genera las órdenes preventivas que faltan: una por cada tarea que ya venció
 * o vence hoy y no tiene una orden abierta. Es idempotente.
 * Devuelve cuántas creó.
 */
export async function sincronizarOrdenes(
  supabase: SupabaseClient,
  equipmentId: string,
  tareas: Tarea[],
  ultimaPorTarea: Record<string, Ejecucion>,
  m3Actual: number,
  ordenes: OrdenTrabajo[],
): Promise<number> {
  const abiertas = new Set(ordenes.filter((o) => o.estado === "pendiente" || o.estado === "en_curso").map((o) => o.task_id))
  const hoy = startOfDay(new Date())
  const nuevas: any[] = []

  for (const t of tareas) {
    if (abiertas.has(t.id)) continue
    const { fecha } = proximoVencimiento(t, ultimaPorTarea[t.id], m3Actual)
    if (fecha > hoy) continue
    nuevas.push({
      equipment_id: equipmentId,
      task_id: t.id,
      tipo: "preventiva",
      titulo: t.titulo,
      descripcion: t.detalle,
      componente: t.componente,
      estado: "pendiente",
      prioridad: differenceInCalendarDays(hoy, fecha) > (t.frecuencia_dias || 1) ? "alta" : "normal",
      fecha_programada: format(fecha, "yyyy-MM-dd"),
      asignado_a: t.asignado_default,
      creado_por: "Sistema",
    })
  }
  // De a una, para que si otra pestaña ya creó la misma orden (la base tiene una
  // traba: una sola orden abierta por tarea) esa falle sola y las demás pasen.
  let creadas = 0
  for (const n of nuevas) {
    const { error } = await supabase.from("maint_work_orders").insert(n)
    if (!error) creadas++
    else if (error.code !== "23505") console.error("sincronizarOrdenes:", error.message)
  }
  return creadas
}

/** Reduce una foto en el navegador antes de subirla (máx. 1600 px, JPEG 85%). */
export async function comprimirFoto(file: File, maxPx = 1600): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const escala = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(bitmap.width * escala)
  canvas.height = Math.round(bitmap.height * escala)
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return new Promise((res) => canvas.toBlob((b) => res(b || file), "image/jpeg", 0.85))
}

/** Sube una foto de evidencia y la asocia a la orden. Devuelve la URL pública. */
export async function subirFotoOrden(supabase: SupabaseClient, ordenId: string, file: File, usuario: string, comentario?: string): Promise<string> {
  const blob = await comprimirFoto(file)
  const path = `ot/${ordenId}/${Date.now()}.jpg`
  const { error } = await supabase.storage.from("mantenimiento").upload(path, blob, { contentType: "image/jpeg", upsert: false })
  if (error) throw error
  const { data } = supabase.storage.from("mantenimiento").getPublicUrl(path)
  await supabase.from("maint_work_order_photos").insert({ work_order_id: ordenId, url: data.publicUrl, subida_por: usuario, comentario: comentario || null })
  return data.publicUrl
}
