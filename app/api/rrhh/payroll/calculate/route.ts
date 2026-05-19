import { createClient } from "@/lib/supabase"
import { NextResponse } from "next/server"
import {
  calculatePayroll,
  type PayrollEmployee,
  type PayrollParams,
} from "@/lib/payroll-engine"

// POST /api/rrhh/payroll/calculate
// Calcula (o recalcula) la liquidación completa de un período
export async function POST(request: Request) {
  const supabase = createClient()
  const body = await request.json()
  const { period_id, employee_id } = body  // employee_id es opcional (para calcular solo uno)

  // ── 1. Obtener el período ────────────────────────────────────────────────
  const { data: period, error: periodError } = await supabase
    .from("payroll_periods")
    .select("*")
    .eq("id", period_id)
    .single()

  if (periodError || !period) {
    return NextResponse.json({ error: "Período no encontrado" }, { status: 404 })
  }

  if (period.status === "cerrado") {
    return NextResponse.json({ error: "El período está cerrado y no puede recalcularse" }, { status: 400 })
  }

  // ── 2. Obtener parámetros globales ───────────────────────────────────────
  const [paramsRes, categoriesRes, holidaysRes] = await Promise.all([
    supabase.from("payroll_parameters").select("*").eq("is_current", true),
    supabase.from("uocra_categories").select("*").eq("is_current", true),
    supabase
      .from("public_holidays")
      .select("*")
      .gte("holiday_date", period.date_from)
      .lte("holiday_date", period.date_to),
  ])

  const paramsMap: Record<string, number> = {}
  paramsRes.data?.forEach((p) => { paramsMap[p.parameter_key] = parseFloat(p.parameter_value) })

  const params: PayrollParams = {
    presentismo_percent: paramsMap.presentismo_percent ?? 20,
    jubilacion_percent: paramsMap.jubilacion_percent ?? 11,
    obra_social_percent: paramsMap.obra_social_percent ?? 3,
    inssjp_percent: paramsMap.inssjp_percent ?? 3,
    sindical_percent: paramsMap.sindical_percent ?? 2,
    overtime_weekly_threshold: paramsMap.overtime_weekly_threshold ?? 44,
    late_tolerance_minutes: paramsMap.late_tolerance_minutes ?? 5,
    late_penalty_threshold: paramsMap.late_penalty_threshold ?? 3,
    olivera_clocked_hours_min: paramsMap.olivera_clocked_hours_min ?? 10.0,
    olivera_clocked_hours_max: paramsMap.olivera_clocked_hours_max ?? 10.67,
    olivera_counted_hours: paramsMap.olivera_counted_hours ?? 11.0,
  }

  // ── 3. Obtener empleados activos de la planta ────────────────────────────
  let employeesQuery = supabase
    .from("employees")
    .select(`
      *,
      employee_schedules!left(day_of_week, shift_start, shift_end, effective_from)
    `)
    .eq("branch", period.plant)
    .eq("is_active", true)

  if (employee_id) {
    employeesQuery = employeesQuery.eq("id", employee_id)
  }

  // Filtrar por tipo de liquidación (quincenal vs mensual)
  if (period.period_type !== "mensual") {
    employeesQuery = employeesQuery.eq("remuneration_type", "quincenal")
  } else {
    employeesQuery = employeesQuery.eq("remuneration_type", "mensual")
  }

  const { data: employees, error: empError } = await employeesQuery
  if (empError) return NextResponse.json({ error: empError.message }, { status: 500 })

  if (!employees || employees.length === 0) {
    return NextResponse.json({ success: true, calculated: 0, message: "No hay empleados para este período" })
  }

  // ── 4. Obtener registros de asistencia del período ───────────────────────
  const employeeIds = employees.map((e: any) => e.id)

  const { data: attendance, error: attError } = await supabase
    .from("attendance")
    .select("*")
    .in("employee_id", employeeIds)
    .gte("attendance_date", period.date_from)
    .lte("attendance_date", period.date_to)

  if (attError) return NextResponse.json({ error: attError.message }, { status: 500 })

  // ── 5. Calcular liquidación por empleado ─────────────────────────────────
  const results = []
  let totalGross = 0
  let totalNet = 0

  for (const emp of employees) {
    // Obtener horario vigente para saber la hora de entrada (tardanzas)
    const schedules = emp.employee_schedules ?? []
    const validSchedules = schedules
      .filter((s: any) => s.effective_from <= period.date_from)
      .sort((a: any, b: any) => b.effective_from.localeCompare(a.effective_from))

    // Horario del lunes (día 1) como referencia de hora de entrada
    const mondaySchedule = validSchedules.find((s: any) => s.day_of_week === 1)
    const shiftStart = mondaySchedule?.shift_start?.slice(0, 5) ?? null  // HH:MM

    const payrollEmployee: PayrollEmployee = {
      id: emp.id,
      employee_id: emp.employee_id,
      first_name: emp.first_name,
      last_name: emp.last_name,
      branch: emp.branch,
      agreement: emp.agreement,
      increases_under_agreement: emp.increases_under_agreement ?? true,
      remuneration_type: emp.remuneration_type,
      salary_type: emp.salary_type,
      salary_value: emp.salary_value ? parseFloat(emp.salary_value) : null,
      category: emp.category,
      real_start_date: emp.real_start_date,
      positions: emp.positions ?? [],
      has_sindical: emp.agreement === "UOCRA",
      shift_name: emp.shift_name ?? null,
      shift_start: shiftStart,
    }

    const empAttendance = (attendance ?? []).filter((a: any) => a.employee_id === emp.id)

    const result = calculatePayroll(
      payrollEmployee,
      empAttendance,
      params,
      categoriesRes.data ?? [],
      holidaysRes.data ?? [],
      period.date_from,
      period.date_to
    )

    // Guardar/actualizar línea de liquidación (skip si fue editada manualmente)
    const { data: existingLine } = await supabase
      .from("payroll_lines")
      .select("id, is_manual_override")
      .eq("period_id", period_id)
      .eq("employee_id", emp.id)
      .single()

    if (!existingLine?.is_manual_override) {
      const lineData = {
        period_id,
        employee_id: emp.id,
        normal_hours: result.normal_hours,
        overtime_50_hours: result.overtime_50_hours,
        overtime_100_hours: result.overtime_100_hours,
        holiday_hours: 0,
        worked_days: result.worked_days,
        present_days: result.present_days,
        absent_days: result.absent_days,
        late_count: result.late_count,
        applied_hourly_rate: result.applied_hourly_rate,
        applied_category: result.applied_category,
        basic_amount: result.basic_amount,
        overtime_50_amount: result.overtime_50_amount,
        overtime_100_amount: result.overtime_100_amount,
        holiday_extra_amount: result.holiday_extra_amount,
        presentismo_amount: result.presentismo_amount,
        presentismo_eligible: result.presentismo_eligible,
        sac_provision: result.sac_provision,
        gross_total: result.gross_total,
        jubilacion_amount: result.jubilacion_amount,
        obra_social_amount: result.obra_social_amount,
        inssjp_amount: result.inssjp_amount,
        sindical_amount: result.sindical_amount,
        total_deductions: result.total_deductions,
        net_total: result.net_total,
        calculation_details: JSON.stringify(result.daily_details),
        updated_at: new Date().toISOString(),
      }

      if (existingLine) {
        await supabase.from("payroll_lines").update(lineData).eq("id", existingLine.id)
      } else {
        await supabase.from("payroll_lines").insert(lineData)
      }
    }

    totalGross += result.gross_total
    totalNet += result.net_total

    results.push({
      employee_id: emp.id,
      employee_name: `${emp.last_name}, ${emp.first_name}`,
      ...result,
    })
  }

  // ── 6. Actualizar totales del período ────────────────────────────────────
  await supabase
    .from("payroll_periods")
    .update({
      total_gross: Math.round(totalGross * 100) / 100,
      total_net: Math.round(totalNet * 100) / 100,
      employee_count: results.length,
      updated_at: new Date().toISOString(),
    })
    .eq("id", period_id)

  return NextResponse.json({
    success: true,
    calculated: results.length,
    total_gross: totalGross,
    total_net: totalNet,
    results,
  })
}

// GET /api/rrhh/payroll/calculate?period_id=X
// Obtiene las líneas ya calculadas de un período
export async function GET(request: Request) {
  const supabase = createClient()
  const { searchParams } = new URL(request.url)
  const periodId = searchParams.get("period_id")

  if (!periodId) return NextResponse.json({ error: "Falta period_id" }, { status: 400 })

  const { data, error } = await supabase
    .from("payroll_lines")
    .select(`
      *,
      employees(id, employee_id, first_name, last_name, category, salary_type, agreement, branch)
    `)
    .eq("period_id", periodId)
    .order("employees(last_name)")

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// PATCH /api/rrhh/payroll/calculate — Override manual de una línea
export async function PATCH(request: Request) {
  const supabase = createClient()
  const body = await request.json()
  const { line_id, overrides, notes } = body

  // Verificar que el período no está cerrado
  const { data: line } = await supabase
    .from("payroll_lines")
    .select("period_id, payroll_periods(status)")
    .eq("id", line_id)
    .single()

  if ((line?.payroll_periods as any)?.status === "cerrado") {
    return NextResponse.json({ error: "El período está cerrado" }, { status: 400 })
  }

  const { error } = await supabase
    .from("payroll_lines")
    .update({
      ...overrides,
      is_manual_override: true,
      notes,
      updated_at: new Date().toISOString(),
    })
    .eq("id", line_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
