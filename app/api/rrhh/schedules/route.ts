import { createClient } from "@/lib/supabase"
import { NextResponse } from "next/server"

// GET: Fetch schedules for an employee (or all employees)
// ?employee_id=123 - get all schedule versions for one employee
// ?employee_id=123&date=2026-02-01 - get the schedule effective for that date
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const employeeId = searchParams.get("employee_id")
    const date = searchParams.get("date") // optional: get schedule effective at this date

    const supabase = createClient()

    if (employeeId && date) {
      // Get the schedule that was effective on the given date for each day of week
      // This means: for each day_of_week, get the row with the highest effective_from <= date
      const { data, error } = await supabase
        .from("employee_schedules")
        .select("*")
        .eq("employee_id", Number(employeeId))
        .lte("effective_from", date)
        .order("effective_from", { ascending: false })

      if (error) throw error

      // Group by day_of_week, keep only the most recent effective_from for each
      const byDay = new Map<number, typeof data[0]>()
      for (const row of data || []) {
        if (!byDay.has(row.day_of_week)) {
          byDay.set(row.day_of_week, row)
        }
      }

      return NextResponse.json(Array.from(byDay.values()))
    }

    if (employeeId) {
      // Get all schedule versions for an employee
      const { data, error } = await supabase
        .from("employee_schedules")
        .select("*")
        .eq("employee_id", Number(employeeId))
        .order("effective_from", { ascending: false })
        .order("day_of_week", { ascending: true })

      if (error) throw error
      return NextResponse.json(data)
    }

    // Get all schedules (for batch loading)
    const { data, error } = await supabase
      .from("employee_schedules")
      .select("*")
      .order("employee_id")
      .order("effective_from", { ascending: false })
      .order("day_of_week", { ascending: true })

    if (error) throw error
    return NextResponse.json(data)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Error al obtener horarios"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// POST: Save a full weekly schedule for an employee with an effective_from date
// Body: { employee_id, effective_from, days: [{ day_of_week, shift_start, shift_end }] }
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { employee_id, effective_from, days } = body

    if (!employee_id || !effective_from || !Array.isArray(days)) {
      return NextResponse.json({ error: "Faltan datos requeridos" }, { status: 400 })
    }

    const supabase = createClient()

    // Upsert each day - if a row with same employee_id + day_of_week + effective_from exists, update it
    const rows = days.map((d: { day_of_week: number; shift_start: string | null; shift_end: string | null; is_optional?: boolean }) => ({
      employee_id,
      day_of_week: d.day_of_week,
      shift_start: d.shift_start || null,
      shift_end: d.shift_end || null,
      effective_from,
      is_optional: d.is_optional ?? (d.day_of_week === 6),
    }))

    const { data, error } = await supabase
      .from("employee_schedules")
      .upsert(rows, { onConflict: "employee_id,day_of_week,effective_from" })
      .select()

    if (error) throw error
    return NextResponse.json(data)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Error al guardar horario"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// DELETE: Remove a schedule version
// Body: { employee_id, effective_from }
export async function DELETE(request: Request) {
  try {
    const body = await request.json()
    const { employee_id, effective_from } = body

    const supabase = createClient()
    const { error } = await supabase
      .from("employee_schedules")
      .delete()
      .eq("employee_id", employee_id)
      .eq("effective_from", effective_from)

    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Error al eliminar horario"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
