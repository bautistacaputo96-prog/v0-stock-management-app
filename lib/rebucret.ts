// Cliente Supabase para Rebucret usando fetch directo (sin SDK para evitar caché)
const REBUCRET_URL = () => process.env.REBUCRET_SUPABASE_URL!
const REBUCRET_KEY = () => process.env.REBUCRET_SUPABASE_ANON_KEY!

async function rebucretFetch(path: string) {
  const res = await fetch(`${REBUCRET_URL()}/rest/v1/${path}`, {
    headers: {
      apikey: REBUCRET_KEY(),
      Authorization: `Bearer ${REBUCRET_KEY()}`,
    },
    cache: "no-store",
  })
  if (!res.ok) throw new Error(`Rebucret fetch error: ${res.status}`)
  return res.json()
}

// Zona horaria Argentina (UTC-3)
const AR_OFFSET = -3

function getArgentinaDate(date: Date): string {
  const ar = new Date(date.getTime() + AR_OFFSET * 60 * 60 * 1000)
  return ar.toISOString().split("T")[0]
}

function formatArgentinaDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-")
  const days = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"]
  const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]
  const dt = new Date(`${y}-${m}-${d}T12:00:00`)
  return `${days[dt.getDay()]} ${d}/${months[parseInt(m) - 1]}`
}

// ─── Lookup tables ──────────────────────────────────────────────────────────
async function getClients(): Promise<Record<string, string>> {
  const data = await rebucretFetch("clients?select=id,name")
  return Object.fromEntries((data as any[]).map((c: any) => [c.id, c.name]))
}

async function getConstructionSites(): Promise<Record<string, string>> {
  const data = await rebucretFetch("construction_sites?select=id,name")
  return Object.fromEntries((data as any[]).map((c: any) => [c.id, c.name]))
}

async function getFormulas(): Promise<Record<string, string>> {
  const data = await rebucretFetch("formulas?select=id,name,code")
  return Object.fromEntries((data as any[]).map((f: any) => [f.id, f.name]))
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
  const now = new Date()
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const dateStr = getArgentinaDate(yesterday)

  // Argentina UTC-3: día empieza a las 03:00Z y termina a las 02:59Z del día siguiente
  const nextDateStr = getArgentinaDate(new Date(yesterday.getTime() + 24 * 60 * 60 * 1000))
  const [dispatches, clients, sites, formulas] = await Promise.all([
    rebucretFetch(
      `dispatches?dispatch_date=gte.${dateStr}T03:00:00Z&dispatch_date=lt.${nextDateStr}T03:00:00Z&is_test_dispatch=eq.false&select=quantity_m3,client_id,construction_site_id,formula_id,dispatch_date`
    ),
    getClients(),
    getConstructionSites(),
    getFormulas(),
  ])

  const groups: Record<string, DispatchSummary> = {}
  for (const d of dispatches as any[]) {
    const clientName = clients[d.client_id] || "Sin cliente"
    const obraName = sites[d.construction_site_id] || "Sin obra"
    const formulaName = formulas[d.formula_id] || "Sin tipo"
    const key = `${clientName}|${obraName}|${formulaName}`
    if (!groups[key]) groups[key] = { client: clientName, obra: obraName, formula: formulaName, total_m3: 0, viajes: 0 }
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
  const todayStr = getArgentinaDate(new Date())

  const tomorrowStr = getArgentinaDate(new Date(new Date().getTime() + 24 * 60 * 60 * 1000))
  const [scheduled, clients, sites, formulas] = await Promise.all([
    rebucretFetch(
      `scheduled_dispatches?scheduled_arrival_time=gte.${todayStr}T03:00:00Z&scheduled_arrival_time=lt.${tomorrowStr}T03:00:00Z&status=neq.cancelled&order=scheduled_arrival_time.asc&select=quantity_m3,scheduled_arrival_time,is_urgent,status,client_id,construction_site_id,formula_id`
    ),
    getClients(),
    getConstructionSites(),
    getFormulas(),
  ])

  const groups: Record<string, ScheduledSummary> = {}
  for (const d of scheduled as any[]) {
    const clientName = clients[d.client_id] || "Sin cliente"
    const obraName = sites[d.construction_site_id] || "Sin obra"
    const formulaName = formulas[d.formula_id] || "Sin tipo"
    const key = `${clientName}|${obraName}|${formulaName}`

    const arrivalDate = new Date(d.scheduled_arrival_time)
    const hora = new Date(arrivalDate.getTime() + AR_OFFSET * 60 * 60 * 1000)
      .toISOString().substring(11, 16)

    if (!groups[key]) {
      groups[key] = { client: clientName, obra: obraName, formula: formulaName, total_m3: 0, viajes: 0, hora, is_urgent: false, status: d.status }
    }
    groups[key].total_m3 += Number(d.quantity_m3) || 0
    groups[key].viajes += 1
    if (d.is_urgent) groups[key].is_urgent = true
  }

  return Object.values(groups).sort((a, b) => a.hora.localeCompare(b.hora))
}

// ─── Formatea el reporte como mensaje WhatsApp ─────────────────────────────
export function formatDailyReport(
  yesterday: DispatchSummary[],
  todaySchedule: ScheduledSummary[],
  reportDate: Date
): string {
  const now = new Date(reportDate.getTime() + AR_OFFSET * 60 * 60 * 1000)
  const yesterdayStr = getArgentinaDate(new Date(now.getTime() - 24 * 60 * 60 * 1000))
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
    const totalViajes = yesterday.reduce((s, d) => s + d.viajes, 0)
    lines.push(`Total: *${totalM3.toFixed(1)} m³* en ${totalViajes} viajes`)
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
      const viajesStr = d.viajes > 1 ? ` (${d.viajes} viajes)` : ""
      lines.push(`${d.hora}hs • ${d.client} → *${d.formula}*: ${d.total_m3.toFixed(1)} m³${viajesStr}${urgente}${completado}`)
      if (d.obra && d.obra !== d.client) lines.push(`  📍 ${d.obra}`)
    }
  }

  lines.push(``)
  lines.push(`_Rebucret · ${now.toLocaleDateString("es-AR")}_`)

  return lines.join("\n")
}
