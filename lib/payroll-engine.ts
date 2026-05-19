/**
 * Motor de Liquidación de Sueldos - Concretus SA
 * Lógica pura de cálculo (sin dependencias de DB ni UI)
 * UOCRA CCT 76/75 + empleados fuera de convenio
 */

// ─── Interfaces de entrada ────────────────────────────────────────────────────

export interface PayrollEmployee {
  id: number
  employee_id: string
  first_name: string
  last_name: string
  branch: "Villa Rosa" | "Ranchos" | "Olivera"
  agreement: string | null
  increases_under_agreement: boolean
  remuneration_type: "quincenal" | "mensual" | null
  salary_type: "por_hora" | "fijo" | null
  salary_value: number | null
  category: string | null
  real_start_date: string | null
  positions: string[]
  has_sindical: boolean   // si descuenta cuota sindical
  shift_name?: string     // turno asignado (para Olivera)
  shift_start?: string    // HH:MM horario de entrada (para tardanzas)
}

export interface AttendanceRecord {
  attendance_date: string  // YYYY-MM-DD
  clock_in: string | null  // HH:MM
  clock_out: string | null // HH:MM
  status: "presente" | "ausente" | "justificado" | "vacaciones" | "licencia" | "feriado"
  observations?: string
}

export interface PayrollParams {
  presentismo_percent: number        // 20
  jubilacion_percent: number         // 11
  obra_social_percent: number        // 3
  inssjp_percent: number             // 3
  sindical_percent: number           // 2
  overtime_weekly_threshold: number  // 44
  late_tolerance_minutes: number     // 5
  late_penalty_threshold: number     // 3 (tardanzas que hacen perder presentismo)
  // Regla turno Olivera
  olivera_clocked_hours_min: number  // 10.0
  olivera_clocked_hours_max: number  // 10.67
  olivera_counted_hours: number      // 11.0
}

export interface UocraCategory {
  category_name: string
  hourly_rate: number
}

export interface HolidayEntry {
  holiday_date: string  // YYYY-MM-DD
  holiday_name: string
}

// ─── Interfaces de salida ─────────────────────────────────────────────────────

export interface DailyDetail {
  date: string
  day_name: string
  day_of_week: number       // 0=Dom, 1=Lun … 6=Sáb
  is_holiday: boolean
  holiday_name?: string
  is_saturday: boolean
  clocked_hours: number     // horas que marca el fichero
  counted_hours: number     // horas que se contabilizan (con regla Olivera si aplica)
  normal_hours: number      // horas normales (dentro de las 44/sem)
  overtime_50_hours: number
  overtime_100_hours: number
  is_late: boolean
  minutes_late: number
  status: string
  no_clock: boolean         // no fichó entrada/salida
}

export interface PayrollResult {
  // Horas
  normal_hours: number
  overtime_50_hours: number
  overtime_100_hours: number
  worked_days: number
  present_days: number
  absent_days: number
  late_count: number
  // Tarifa aplicada
  applied_hourly_rate: number
  applied_category: string
  // Haberes
  basic_amount: number
  overtime_50_amount: number
  overtime_100_amount: number
  holiday_extra_amount: number
  presentismo_amount: number
  presentismo_eligible: boolean
  sac_provision: number
  gross_total: number
  // Descuentos
  jubilacion_amount: number
  obra_social_amount: number
  inssjp_amount: number
  sindical_amount: number
  total_deductions: number
  // Neto
  net_total: number
  // Detalle
  daily_details: DailyDetail[]
}

// ─── Utilidades de tiempo ─────────────────────────────────────────────────────

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number)
  return h * 60 + m
}

function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100
}

function timeDiffHours(clockIn: string, clockOut: string): number {
  let inMin = timeToMinutes(clockIn)
  let outMin = timeToMinutes(clockOut)
  // Maneja turnos que cruzan la medianoche
  if (outMin < inMin) outMin += 24 * 60
  return minutesToHours(outMin - inMin)
}

function getISOWeekKey(dateStr: string): string {
  const date = new Date(dateStr + "T12:00:00")
  const day = date.getDay()
  // Lunes como inicio de semana
  const monday = new Date(date)
  monday.setDate(date.getDate() - ((day + 6) % 7))
  return monday.toISOString().split("T")[0]
}

const DAY_NAMES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"]

// ─── Función principal de cálculo ────────────────────────────────────────────

export function calculatePayroll(
  employee: PayrollEmployee,
  attendanceRecords: AttendanceRecord[],
  params: PayrollParams,
  categories: UocraCategory[],
  holidays: HolidayEntry[],
  periodDateFrom: string,
  periodDateTo: string
): PayrollResult {

  // Turno rotativo Olivera: aplica a operarios por hora de esa planta
  // El turno se detecta por hora de entrada en cada día (< 10:00 = T1, >= 10:00 = T2)
  const isOliveraShift =
    employee.branch === "Olivera" &&
    employee.salary_type === "por_hora" &&
    employee.agreement === "UOCRA"

  const holidayDates = new Set(holidays.map((h) => h.holiday_date))
  const holidayNames: Record<string, string> = Object.fromEntries(
    holidays.map((h) => [h.holiday_date, h.holiday_name])
  )

  // ── Obtener tarifa horaria ──────────────────────────────────────────────────
  let appliedHourlyRate = 0
  let appliedCategory = ""

  if (employee.salary_type === "por_hora") {
    if (employee.increases_under_agreement && employee.category) {
      const categoryKey = employee.category.toUpperCase()
      const cat = categories.find(
        (c) => c.category_name.toUpperCase() === categoryKey
      )
      appliedHourlyRate = cat?.hourly_rate ?? employee.salary_value ?? 0
      appliedCategory = employee.category
    } else {
      appliedHourlyRate = employee.salary_value ?? 0
      appliedCategory = employee.category ?? "Fuera de convenio"
    }
  }

  // ── Filtrar registros del período ──────────────────────────────────────────
  const periodRecords = attendanceRecords.filter(
    (r) => r.attendance_date >= periodDateFrom && r.attendance_date <= periodDateTo
  )

  // ── Procesar cada día ──────────────────────────────────────────────────────
  const dailyDetails: DailyDetail[] = []
  // Acumuladores semanales para HE (threshold 44hs)
  const weeklyCountedHours: Record<string, number> = {}

  let lateCount = 0
  let absentDays = 0
  let presentDays = 0

  for (const record of periodRecords) {
    const date = new Date(record.attendance_date + "T12:00:00")
    const dayOfWeek = date.getDay()
    const isSaturday = dayOfWeek === 6
    const isSunday = dayOfWeek === 0
    const isHoliday = holidayDates.has(record.attendance_date)
    const weekKey = getISOWeekKey(record.attendance_date)

    // ── Calcular horas fichadas ──────────────────────────────────────────────
    let clockedHours = 0
    let noClock = false
    let isLate = false
    let minutesLate = 0

    if (record.status === "presente" || record.status === "feriado") {
      if (record.clock_in && record.clock_out) {
        clockedHours = timeDiffHours(record.clock_in, record.clock_out)
        // Tardanza (solo aplica para días hábiles de semana, no sábados)
        if (record.clock_in && employee.shift_start && !isSaturday) {
          const lateMin = timeToMinutes(record.clock_in) - timeToMinutes(employee.shift_start)
          if (lateMin > params.late_tolerance_minutes) {
            isLate = true
            minutesLate = lateMin
            lateCount++
          }
        }
      } else if (record.clock_in || record.clock_out) {
        // Fichó solo entrada o solo salida → sin fichar completo
        noClock = true
        clockedHours = 0
      } else {
        noClock = true
      }
    }

    // ── Aplicar regla turno Olivera ──────────────────────────────────────────
    let countedHours = clockedHours
    if (
      isOliveraShift &&
      record.status === "presente" &&
      clockedHours >= params.olivera_clocked_hours_min &&
      clockedHours <= params.olivera_clocked_hours_max
    ) {
      countedHours = params.olivera_counted_hours
    }

    // ── Clasificar horas del día ─────────────────────────────────────────────
    let normalHours = 0
    let overtime50Hours = 0
    let overtime100Hours = 0

    if (record.status === "presente" && !noClock && countedHours > 0) {
      if (isHoliday) {
        // Feriado trabajado: 100% extra (la base ya está en el sueldo)
        overtime100Hours = countedHours

      } else if (isSaturday) {
        // Sábado: todo va a HE50 hasta las 13:00, HE100 después
        if (record.clock_in) {
          const clockInMin = timeToMinutes(record.clock_in)
          const clockOutMin = record.clock_out
            ? timeToMinutes(record.clock_out) + (timeToMinutes(record.clock_out) < clockInMin ? 1440 : 0)
            : clockInMin + Math.round(countedHours * 60)
          const limit13 = 13 * 60  // 13:00 en minutos

          const minutesBefore13 = Math.max(0, Math.min(clockOutMin, limit13) - clockInMin)
          const minutesAfter13 = Math.max(0, clockOutMin - Math.max(clockInMin, limit13))

          overtime50Hours = minutesToHours(minutesBefore13)
          overtime100Hours = minutesToHours(minutesAfter13)
        } else {
          overtime50Hours = countedHours
        }

      } else if (!isSunday) {
        // Lunes a Viernes: acumular en bucket semanal para calcular HE
        weeklyCountedHours[weekKey] = (weeklyCountedHours[weekKey] ?? 0) + countedHours
        normalHours = countedHours  // será re-clasificado después
      }
    }

    if (record.status === "ausente") absentDays++
    if (record.status === "presente" && !noClock) presentDays++

    dailyDetails.push({
      date: record.attendance_date,
      day_name: DAY_NAMES[dayOfWeek],
      day_of_week: dayOfWeek,
      is_holiday: isHoliday,
      holiday_name: holidayNames[record.attendance_date],
      is_saturday: isSaturday,
      clocked_hours: clockedHours,
      counted_hours: countedHours,
      normal_hours: normalHours,
      overtime_50_hours: overtime50Hours,
      overtime_100_hours: overtime100Hours,
      is_late: isLate,
      minutes_late: minutesLate,
      status: record.status,
      no_clock: noClock,
    })
  }

  // ── Redistribuir horas semana → normal vs HE50 ────────────────────────────
  // Por cada semana que supere 44hs, las horas que exceden pasan a HE50
  let totalNormalHours = 0
  let totalOT50FromWeekly = 0

  for (const [weekKey, weekHours] of Object.entries(weeklyCountedHours)) {
    const threshold = params.overtime_weekly_threshold
    const normal = Math.min(weekHours, threshold)
    const extra = Math.max(weekHours - threshold, 0)
    totalNormalHours += normal
    totalOT50FromWeekly += extra
  }

  // Actualizar los daily_details con la proporcionalidad de OT semanal
  // (para visualización, distribuir el OT al último día de la semana con horas)
  if (totalOT50FromWeekly > 0) {
    for (const [weekKey, weekHours] of Object.entries(weeklyCountedHours)) {
      if (weekHours > params.overtime_weekly_threshold) {
        const extraThisWeek = weekHours - params.overtime_weekly_threshold
        // Asignar al último día de semana con normal_hours > 0
        const daysThisWeek = dailyDetails
          .filter(
            (d) =>
              getISOWeekKey(d.date) === weekKey &&
              d.normal_hours > 0 &&
              d.day_of_week !== 0 &&
              d.day_of_week !== 6
          )
          .reverse()
        if (daysThisWeek.length > 0) {
          const lastDay = daysThisWeek[0]
          lastDay.overtime_50_hours += extraThisWeek
          lastDay.normal_hours = Math.max(0, lastDay.normal_hours - extraThisWeek)
        }
      }
    }
  }

  // ── Totales finales de horas ──────────────────────────────────────────────
  const totalOT50Hours =
    totalOT50FromWeekly +
    dailyDetails.reduce((s, d) => s + (d.is_saturday || d.is_holiday ? d.overtime_50_hours : 0), 0)

  const totalOT100Hours = dailyDetails.reduce((s, d) => s + d.overtime_100_hours, 0)

  const holidayHours = dailyDetails
    .filter((d) => d.is_holiday)
    .reduce((s, d) => s + d.counted_hours, 0)

  const workedDays = dailyDetails.filter(
    (d) => d.status === "presente" && !d.no_clock
  ).length

  // ── Cálculo de montos ─────────────────────────────────────────────────────
  let basicAmount = 0
  let overtime50Amount = 0
  let overtime100Amount = 0
  let holidayExtraAmount = 0
  let presentismoAmount = 0
  let presentismoEligible = false
  let sacProvision = 0

  if (employee.salary_type === "por_hora") {
    const rate = appliedHourlyRate
    basicAmount = round2(totalNormalHours * rate)
    overtime50Amount = round2(totalOT50Hours * rate * 0.5)   // el recargo del 50%
    overtime100Amount = round2(totalOT100Hours * rate * 1.0) // el recargo del 100%
    holidayExtraAmount = round2(holidayHours * rate)          // plus por trabajar feriado

    // Presentismo: 20% del básico, sólo si < 3 tardanzas
    presentismoEligible = lateCount < params.late_penalty_threshold
    if (presentismoEligible) {
      presentismoAmount = round2(basicAmount * (params.presentismo_percent / 100))
    }

  } else if (employee.salary_type === "fijo") {
    // Sueldo fijo: divide entre 2 si es quincenal
    const fullSalary = employee.salary_value ?? 0
    basicAmount = employee.remuneration_type === "quincenal"
      ? round2(fullSalary / 2)
      : round2(fullSalary)
    // Empleados fuera de convenio no tienen presentismo
    presentismoEligible = false
  }

  // SAC proporcional del período (informativo - no se paga en cada quincena)
  // SAC = mejor remuneración mensual del semestre / 12 × días del período / días del mes
  // Aproximación: gross_haberes_mensuales / 12
  const grossBeforeSac = basicAmount + overtime50Amount + overtime100Amount +
    holidayExtraAmount + presentismoAmount
  sacProvision = round2(grossBeforeSac / 12)

  const grossTotal = round2(grossBeforeSac)  // SAC no se incluye en base de descuentos

  // ── Descuentos ────────────────────────────────────────────────────────────
  const jubilacionAmount = round2(grossTotal * (params.jubilacion_percent / 100))
  const obraSocialAmount = round2(grossTotal * (params.obra_social_percent / 100))
  const inssjpAmount = round2(grossTotal * (params.inssjp_percent / 100))
  const sindicalAmount = employee.has_sindical
    ? round2(grossTotal * (params.sindical_percent / 100))
    : 0

  const totalDeductions = round2(
    jubilacionAmount + obraSocialAmount + inssjpAmount + sindicalAmount
  )

  const netTotal = round2(grossTotal - totalDeductions)

  return {
    normal_hours: totalNormalHours,
    overtime_50_hours: totalOT50Hours,
    overtime_100_hours: totalOT100Hours,
    worked_days: workedDays,
    present_days: presentDays,
    absent_days: absentDays,
    late_count: lateCount,
    applied_hourly_rate: appliedHourlyRate,
    applied_category: appliedCategory,
    basic_amount: basicAmount,
    overtime_50_amount: overtime50Amount,
    overtime_100_amount: overtime100Amount,
    holiday_extra_amount: holidayExtraAmount,
    presentismo_amount: presentismoAmount,
    presentismo_eligible: presentismoEligible,
    sac_provision: sacProvision,
    gross_total: grossTotal,
    jubilacion_amount: jubilacionAmount,
    obra_social_amount: obraSocialAmount,
    inssjp_amount: inssjpAmount,
    sindical_amount: sindicalAmount,
    total_deductions: totalDeductions,
    net_total: netTotal,
    daily_details: dailyDetails,
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function formatCurrency(n: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
  }).format(n)
}

export function formatHours(h: number): string {
  const hours = Math.floor(h)
  const minutes = Math.round((h - hours) * 60)
  return `${hours}:${minutes.toString().padStart(2, "0")}hs`
}

/** Calcula los días de vacaciones según LCT según antigüedad */
export function getVacationDays(realStartDate: string | null, referenceDate: string = new Date().toISOString().split("T")[0]): number {
  if (!realStartDate) return 14
  const start = new Date(realStartDate + "T12:00:00")
  const ref = new Date(referenceDate + "T12:00:00")
  const yearsOfService = (ref.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 365.25)

  if (yearsOfService < 5) return 14
  if (yearsOfService < 10) return 21
  if (yearsOfService < 20) return 28
  return 35
}

/** Calcula el SAC del semestre (para pago en Junio/Diciembre) */
export function calculateSAC(
  monthlyGrossAmounts: number[]  // montos brutos de cada mes del semestre
): number {
  const bestMonth = Math.max(...monthlyGrossAmounts)
  return round2(bestMonth / 2)
}

/** Genera número de recibo */
export function generateReceiptNumber(
  plant: string,
  year: number,
  month: number,
  periodType: string,
  employeeId: string
): string {
  const plantCode = plant === "Olivera" ? "OL" : plant === "Ranchos" ? "RA" : "VR"
  const quinceCode = periodType === "primera_quincena" ? "Q1" : periodType === "segunda_quincena" ? "Q2" : "M"
  const monthStr = month.toString().padStart(2, "0")
  return `REC-${year}-${monthStr}-${quinceCode}-${plantCode}-${employeeId.padStart(3, "0")}`
}
