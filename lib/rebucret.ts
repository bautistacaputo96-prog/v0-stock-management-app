import { createClient } from "@supabase/supabase-js"

// Cliente Supabase para Rebucret (hormigón elaborado)
export function getRebucretClient() {
  const url = process.env.REBUCRET_SUPABASE_URL!
  const key = process.env.REBUCRET_SUPABASE_ANON_KEY!
  return createClient(url, key)
}

// Zona horaria Argentina
const AR_OFFSET = -3

function getArgentinaDate(date: Date): string {
  const ar = new Date(date.getTime() + AR_OFFSET * 60 * 60 * 1000)
  return ar.toISOString().split("T")[0]
}

function formatArgentinaDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-")
  const days = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"]
  const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]
  const date = new Date(`${y}-${m}-${d}T12:00:00`)
  return `${days[date.getDay()]} ${d}/${months[parseInt(m) - 1]}`
}

// ─── Despachos de ayer (producción real) ───────────────────────────────────
export interface DispatchSummary {
  client: string
  obra: string
  formula: string
  total_m3: number
  viajes: number
}

export async function getYesterdayDispatches(): Promise<DispatchSummary[]> {
  const supabase = getRebucretClient()
  const now = new Date()
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const yesterdayStr = getArgentinaDate(yesterday)

  // Filtramos por fecha en Argentina
  const from = `${yesterdayStr}T03:00:00.000Z` // 00:00 ARG = 03:00 UTC
  const to = `${yesterdayStr}T26:59:59.999Z`   // 23:59 ARG = 02:59 UTC next day

  const { data, error } = await supabase
    .from("dispatches")
    .select(`
      quantity_m3,
      client_id,
      construction_site_id,
      formula_id,
      dispatch_date,
      is_test_dispatch,
      client:clients!client_id(name),
      construction_site:construction_sites!construction_site_id(name),
      formula:formulas!formula_id(name, code)
    `)
    .gte("dispatch_date", from)
    .lte("dispatch_date", new Date(`${yesterdayStr}T23:59:59-03:00`).toISOString())
    .eq("is_test_dispatch", false)

  if (error) {
    console.error("Error fetching dispatches:", error)
    return []
  }

  // Agrupar por cliente + obra + formula
  const groups: Record<string, DispatchSummary> = {}
  for (const d of (data || []) as any[]) {
    const clientName = d.client?.name || "Sin cliente"
    const obraName = d.construction_site?.name || "Sin obra"
    const formulaName = d.formula?.name || "Sin tipo"
    const key = `${clientName}|${obraName}|${formulaName}`

    if (!groups[key]) {
      groups[key] = { client: clientName, obra: obraName, formula: formulaName, total_m3: 0, viajes: 0 }
    }
    groups[key].total_m3 += Number(d.quantity_m3) || 0
    groups[key].viajes += 1
  }

  return Object.values(groups).sort((a, b) => b.total_m3 - a.total_m3)
}

// ─── Programación de hoy ────────────────────────────────────────────────────
export interface ScheduledSummary {
  client: string
  obra: string
  formula: string
  total_m3: number
  viajes: number
  hora: string
  is_urgent: boolean
  status: string
}

export async function getTodaySchedule(): Promise<ScheduledSummary[]> {
  const supabase = getRebucretClient()
  const todayStr = getArgentinaDate(new Date())

  const { data, error } = await supabase
    .from("scheduled_dispatches")
    .select(`
      quantity_m3,
      scheduled_arrival_time,
      is_urgent,
      status,
      observations,
      client:clients!client_id(name),
      construction_site:construction_sites!construction_site_id(name),
      formula:formulas!formula_id(name, code)
    `)
    .gte("scheduled_arrival_time", `${todayStr}T00:00:00-03:00`)
    .lte("scheduled_arrival_time", `${todayStr}T23:59:59-03:00`)
    .neq("status", "cancelled")
    .order("scheduled_arrival_time", { ascending: true })

  if (error) {
    console.error("Error fetching schedule:", error)
    return []
  }

  // Agrupar por cliente + obra + formula para no exceder el límite de WhatsApp
  const groups: Record<string, ScheduledSummary> = {}
  for (const d of (data || []) as any[]) {
    const clientName = d.client?.name || "Sin cliente"
    const obraName = d.construction_site?.name || "Sin obra"
    const formulaName = d.formula?.name || "Sin tipo"
    const key = `${clientName}|${obraName}|${formulaName}`

    const arrivalDate = new Date(d.scheduled_arrival_time)
    const arHours = new Date(arrivalDate.getTime() + AR_OFFSET * 60 * 60 * 1000)
    const hora = arHours.toISOString().substring(11, 16)

    if (!groups[key]) {
      groups[key] = {
        client: clientName,
        obra: obraName,
        formula: formulaName,
        total_m3: 0,
        viajes: 0,
        hora, // primera hora del grupo
        is_urgent: d.is_urgent || false,
        status: d.status,
      }
    }
    groups[key].total_m3 += Number(d.quantity_m3) || 0
    groups[key].viajes += 1
    if (d.is_urgent) groups[key].is_urgent = true
  }

  return Object.values(groups).sort((a, b) => a.hora.localeCompare(b.hora))
}

// ─── Formatea el reporte completo como mensaje WhatsApp ─────────────────────
export function formatDailyReport(
  yesterday: DispatchSummary[],
  todaySchedule: ScheduledSummary[],
  reportDate: Date
): string {
  const now = new Date(reportDate.getTime() + AR_OFFSET * 60 * 60 * 1000)
  const yesterdayDate = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const yesterdayStr = getArgentinaDate(yesterdayDate)
  const todayStr = getArgentinaDate(now)

  const lines: string[] = []

  lines.push(`🏗️ *Reporte Rebucret*`)
  lines.push(``)

  // ── PRODUCCIÓN DE AYER ──
  lines.push(`📊 *PRODUCCIÓN DE AYER* (${formatArgentinaDate(yesterdayStr)})`)

  if (yesterday.length === 0) {
    lines.push(`_Sin despachos registrados_`)
  } else {
    const totalM3 = yesterday.reduce((s, d) => s + d.total_m3, 0)
    lines.push(`Total: *${totalM3.toFixed(1)} m³* en ${yesterday.reduce((s, d) => s + d.viajes, 0)} viajes`)
    lines.push(``)

    for (const d of yesterday) {
      lines.push(`• ${d.client} → *${d.formula}*: ${d.total_m3.toFixed(1)} m³`)
      if (d.obra && d.obra !== d.client) lines.push(`  📍 ${d.obra}`)
    }
  }

  lines.push(``)

  // ── PROGRAMACIÓN DE HOY ──
  lines.push(`📅 *PROGRAMACIÓN DE HOY* (${formatArgentinaDate(todayStr)})`)

  if (todaySchedule.length === 0) {
    lines.push(`_Sin viajes programados_`)
  } else {
    const totalM3 = todaySchedule.reduce((s, d) => s + d.total_m3, 0)
    const totalViajes = todaySchedule.reduce((s, d) => s + d.viajes, 0)
    lines.push(`Total: *${totalM3.toFixed(1)} m³* en ${totalViajes} viajes`)
    lines.push(``)

    for (const d of todaySchedule) {
      const urgente = d.is_urgent ? " ⚡" : ""
      const completado = d.status === "completed" ? " ✅" : ""
      const viajesStr = d.viajes > 1 ? ` (${d.viajes}v)` : ""
      lines.push(`${d.hora}hs • ${d.client} → *${d.formula}*: ${d.total_m3.toFixed(1)} m³${viajesStr}${urgente}${completado}`)
      if (d.obra && d.obra !== d.client) lines.push(`  📍 ${d.obra}`)
    }
  }

  lines.push(``)
  lines.push(`_Rebucret · ${new Date().toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}_`)

  return lines.join("\n")
}
