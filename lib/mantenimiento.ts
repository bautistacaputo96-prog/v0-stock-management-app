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
 *  - CANCELAR una preventiva no registra ejecución (no se hizo): ese vencimiento
 *    queda SALTEADO. No se vuelve a generar; la próxima sale en el vencimiento
 *    siguiente del plan (ver `vencimientoConSalteo`).
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
  "Planta completa": { icono: "eye", descripcion: "Recorrida visual diaria de toda la planta" },
  "Pala cargadora": { icono: "truck", descripcion: "Pala que carga los áridos en las tolvas: motor, hidráulico, neumáticos y balde" },
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

/**
 * Preventivas canceladas que saltean un vencimiento: por tarea, la última cancelada que es posterior a su última
 * ejecución (fecha programada después de la ejecución, o la tarea nunca se hizo). Se devuelve como una "ejecución"
 * de mentira con el día de la cancelación (hora argentina), para contar desde ahí los m³ con `calcularM3`. NO es una
 * ejecución: no cambia la "Última" que se muestra ni el historial.
 */
export function salteosPorTarea(ordenes: OrdenTrabajo[], ultimaPorTarea: Record<string, Ejecucion>): Record<string, Ejecucion> {
  const out: Record<string, Ejecucion> = {}
  for (const o of ordenes) {
    if (o.estado !== "cancelada" || o.tipo !== "preventiva" || !o.task_id) continue
    const ultima = ultimaPorTarea[o.task_id]
    if (ultima && String(o.fecha_programada).slice(0, 10) <= String(ultima.fecha).slice(0, 10)) continue
    const dia = o.fecha_fin ? diaArgentina(o.fecha_fin) : String(o.fecha_programada).slice(0, 10)
    const ya = out[o.task_id]
    if (!ya || dia > ya.fecha) out[o.task_id] = { task_id: o.task_id, fecha: dia, realizado_por: o.completado_por, m3_acumulado: null }
  }
  return out
}

/**
 * Cuándo vence una tarea teniendo en cuenta una preventiva cancelada (`salteo`, de `salteosPorTarea` con los m³
 * de `calcularM3`). Sin salteo, igual que `proximoVencimiento`. Con salteo:
 *  - por días: el primer vencimiento del plan (última ejecución + n × frecuencia) DESPUÉS del día de la cancelación.
 *    Si nunca se hizo, la cancelación + frecuencia. Ej.: mensual, vencía el 01/11, se canceló el 05/11 → 01/12.
 *  - por m³: los m³ se cuentan desde el día de la cancelación.
 * La cancelada no finge que se hizo: la "Última" sigue siendo la ejecución real.
 */
export function vencimientoConSalteo(t: Tarea, ultima: Ejecucion | undefined, salteo: Ejecucion | undefined, m3Actual: number): { fecha: Date; porM3: boolean; restanM3: number | null; salteada: boolean } {
  if (!salteo) return { ...proximoVencimiento(t, ultima, m3Actual), salteada: false }
  const hoy = startOfDay(new Date())
  const dia = startOfDay(parseISO(salteo.fecha))
  let fecha: Date
  if (t.frecuencia_dias) {
    const f = t.frecuencia_dias
    const base = ultima ? addDays(startOfDay(parseISO(ultima.fecha)), f) : addDays(dia, f)
    const pasados = differenceInCalendarDays(dia, base)
    fecha = pasados >= 0 ? addDays(base, (Math.floor(pasados / f) + 1) * f) : base
  } else {
    fecha = addDays(hoy, 3650)
  }
  let porM3 = false
  let restanM3: number | null = null
  if (t.frecuencia_m3 && salteo.m3_acumulado != null) {
    restanM3 = t.frecuencia_m3 - (m3Actual - Number(salteo.m3_acumulado))
    if (restanM3 <= 0 && fecha > hoy) {
      fecha = hoy
      porM3 = true
    }
  }
  return { fecha, porM3, restanM3, salteada: true }
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

/** Tope de filas que devuelve Supabase por consulta (aunque se pida un .limit() mayor). */
export const TOPE_FILAS = 1000

/**
 * Trae TODAS las filas de una consulta, de a páginas de 1000. Supabase corta
 * cada respuesta en 1000 filas aunque se pida .limit(20000): sin esto los m³
 * acumulados quedaban fijos en la suma de 1000 despachos y, pasadas las 1000
 * órdenes, las más nuevas (las de hoy) no llegaban. `consulta` arma la consulta
 * de un rango y tiene que tener un orden estable. Si una página falla, lanza.
 */
export async function traerTodas<T = any>(
  consulta: (desde: number, hasta: number) => PromiseLike<{ data: any[] | null; error: any }>,
): Promise<T[]> {
  const out: T[] = []
  for (let desde = 0; ; desde += TOPE_FILAS) {
    const { data, error } = await consulta(desde, desde + TOPE_FILAS - 1)
    if (error) throw error
    out.push(...((data || []) as T[]))
    if (!data || data.length < TOPE_FILAS) break
  }
  return out
}

/** Día calendario en Argentina ("yyyy-MM-dd") de un timestamp. */
export function diaArgentina(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(iso))
}

export type DespachoM3 = { quantity_m3: number | string | null; dispatch_date: string | null }

/**
 * m³ acumulados de la planta y, para cada última ejecución, sus m³ "de cuando
 * se hizo" recalculados con los despachos posteriores a ese día (hora argentina):
 * lo que falta por m³ = frecuencia − m³ despachados desde el día siguiente.
 * No se usa el m3_acumulado guardado en la ejecución: se grabó con la suma
 * cortada en 1000 despachos, y "Ya estaba hecha" con fecha vieja grababa los m³ de hoy.
 */
export function calcularM3(despachos: DespachoM3[], ultimaPorTarea: Record<string, Ejecucion>) {
  const dias = despachos.map((d) => ({ dia: d.dispatch_date ? diaArgentina(d.dispatch_date) : "", m3: Number(d.quantity_m3 || 0) }))
  const m3Actual = dias.reduce((s, d) => s + d.m3, 0)
  const ajustadas: Record<string, Ejecucion> = {}
  for (const [id, e] of Object.entries(ultimaPorTarea)) {
    const fecha = String(e.fecha).slice(0, 10)
    const despues = dias.reduce((s, d) => (d.dia > fecha ? s + d.m3 : s), 0)
    ajustadas[id] = { ...e, m3_acumulado: m3Actual - despues }
  }
  return { m3Actual, ultimaPorTarea: ajustadas }
}

/** La última ejecución de cada tarea (las ejecuciones vienen de la más nueva a la más vieja). */
export function ultimaEjecucionPorTarea(ejec: Ejecucion[]): Record<string, Ejecucion> {
  const ultima: Record<string, Ejecucion> = {}
  for (const e of ejec) if (!ultima[e.task_id]) ultima[e.task_id] = e
  return ultima
}

/**
 * Carga todo lo que el módulo necesita para un equipo. Si una consulta falla,
 * lanza: antes el error se tragaba y, sin ejecuciones, todas las tareas
 * parecían "sin registro" y se generaban órdenes de más.
 */
export async function cargarDatosEquipo(supabase: SupabaseClient, equipmentId: string, plantId: string) {
  const { data: tareas, error: errTareas } = await supabase
    .from("maint_tasks")
    .select("*, maint_task_items(*), maint_task_images(*), maint_task_steps(*)")
    .eq("equipment_id", equipmentId)
    .eq("activo", true)
    .order("orden")
  if (errTareas) throw errTareas
  const idsTareas = (tareas || []).map((t: any) => t.id as string)

  const [ejec, desp, ordenes] = await Promise.all([
    idsTareas.length
      ? traerTodas<Ejecucion>((a, b) =>
          supabase
            .from("maint_executions")
            .select("task_id, fecha, realizado_por, m3_acumulado")
            .in("task_id", idsTareas)
            .order("fecha", { ascending: false })
            .order("created_at", { ascending: false })
            .order("id")
            .range(a, b))
      : Promise.resolve([] as Ejecucion[]),
    traerTodas<DespachoM3>((a, b) =>
      supabase.from("dispatches").select("quantity_m3, dispatch_date").eq("plant_id", plantId).order("id").range(a, b)),
    traerTodas<OrdenTrabajo>((a, b) =>
      supabase
        .from("maint_work_orders")
        .select("*, maint_work_order_photos(*)")
        .eq("equipment_id", equipmentId)
        .order("fecha_programada")
        .order("numero")
        .range(a, b)),
  ])

  const ultimas = ultimaEjecucionPorTarea(ejec)
  const { m3Actual, ultimaPorTarea } = calcularM3(desp, ultimas)
  // Preventivas canceladas: con los m³ despachados desde el día de la cancelación
  const salteoPorTarea = calcularM3(desp, salteosPorTarea(ordenes, ultimas)).ultimaPorTarea

  return {
    tareas: (tareas || []) as Tarea[],
    ultimaPorTarea,
    salteoPorTarea,
    m3Actual,
    ordenes,
  }
}

/**
 * Genera las órdenes preventivas que faltan: una por cada tarea que ya venció
 * o vence hoy y no tiene una orden abierta. Es idempotente.
 * Una preventiva cancelada saltea ese vencimiento (`salteoPorTarea`): antes, al
 * recargar se volvía a generar la misma orden y cancelar no servía.
 * Devuelve cuántas creó.
 */
export async function sincronizarOrdenes(
  supabase: SupabaseClient,
  equipmentId: string,
  tareas: Tarea[],
  ultimaPorTarea: Record<string, Ejecucion>,
  m3Actual: number,
  ordenes: OrdenTrabajo[],
  salteoPorTarea: Record<string, Ejecucion> = {},
): Promise<number> {
  const abiertas = new Set(ordenes.filter((o) => o.estado === "pendiente" || o.estado === "en_curso").map((o) => o.task_id))
  const hoy = startOfDay(new Date())
  const nuevas: any[] = []

  for (const t of tareas) {
    if (abiertas.has(t.id)) continue
    const { fecha } = vencimientoConSalteo(t, ultimaPorTarea[t.id], salteoPorTarea[t.id], m3Actual)
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
  const { error: errFila } = await supabase.from("maint_work_order_photos").insert({ work_order_id: ordenId, url: data.publicUrl, subida_por: usuario, comentario: comentario || null })
  if (errFila) throw errFila
  return data.publicUrl
}

/** Resultado de completar/empezar: "ok", ya no estaba abierta (otro la cerró), o error. */
export type ResultadoOT = { ok: true } | { ok: false; yaCerrada?: boolean; mensaje: string }

/**
 * Completa una orden y, si es preventiva, registra la ejecución que reinicia el
 * contador de la tarea. Solo pasa si la orden sigue abierta (si otro la completó
 * o la canceló mientras tanto, no la pisa ni duplica la ejecución). Si la
 * ejecución no se puede grabar, devuelve la orden a como estaba: una orden
 * completada sin ejecución hacía que al recargar se generara otra igual.
 */
export async function completarOrden(
  supabase: SupabaseClient,
  orden: Pick<OrdenTrabajo, "id" | "task_id" | "estado" | "fecha_inicio" | "fecha_fin" | "completado_por" | "observaciones" | "pasos" | "m3_acumulado">,
  datos: { usuario: string; obs: string; pasos: Record<string, boolean>; m3Actual: number; fechaManual?: string; ahora: Date },
): Promise<ResultadoOT> {
  const ahoraIso = datos.ahora.toISOString()
  const fechaEjec = datos.fechaManual || format(datos.ahora, "yyyy-MM-dd")
  const { data: tomadas, error } = await supabase
    .from("maint_work_orders")
    .update({
      estado: "completada",
      fecha_fin: datos.fechaManual ? `${datos.fechaManual}T12:00:00-03:00` : ahoraIso,
      fecha_inicio: orden.fecha_inicio || ahoraIso,
      completado_por: datos.usuario,
      observaciones: datos.obs || null,
      pasos: datos.pasos,
      m3_acumulado: datos.m3Actual,
    })
    .eq("id", orden.id)
    .in("estado", ["pendiente", "en_curso"])
    .select("id")
  if (error) return { ok: false, mensaje: error.message }
  if (!tomadas || tomadas.length === 0) return { ok: false, yaCerrada: true, mensaje: "La orden ya estaba cerrada (la completó o canceló otra persona)." }

  if (orden.task_id) {
    const { error: errEjec } = await supabase.from("maint_executions").insert({
      task_id: orden.task_id,
      fecha: fechaEjec,
      realizado_por: datos.usuario,
      observaciones: datos.obs || (datos.fechaManual ? "Registrada como ya realizada" : null),
      m3_acumulado: datos.m3Actual,
      pasos: Object.keys(datos.pasos).length ? datos.pasos : null,
    })
    if (errEjec) {
      // Deshacer: la orden vuelve a quedar abierta como estaba
      await supabase
        .from("maint_work_orders")
        .update({
          estado: orden.estado,
          fecha_fin: orden.fecha_fin,
          fecha_inicio: orden.fecha_inicio,
          completado_por: orden.completado_por,
          observaciones: orden.observaciones,
          pasos: datos.pasos,
          m3_acumulado: orden.m3_acumulado,
        })
        .eq("id", orden.id)
      return { ok: false, mensaje: errEjec.message }
    }
  }
  return { ok: true }
}
