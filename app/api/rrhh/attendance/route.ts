import { createClient } from "@/lib/supabase"
import { NextResponse } from "next/server"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const month = searchParams.get("month")
    const year = searchParams.get("year")
    const fromDate = searchParams.get("from_date")
    const toDate = searchParams.get("to_date")
    const employeeId = searchParams.get("employee_id")
    const branch = searchParams.get("branch")

    let startDate: string
    let endDate: string

    if (fromDate && toDate) {
      // Date range mode: for multi-month queries (history)
      startDate = fromDate
      endDate = toDate
    } else if (month && year) {
      // Monthly mode: existing behavior
      startDate = `${year}-${month.padStart(2, "0")}-01`
      const lastDay = new Date(Number(year), Number(month), 0).getDate()
      endDate = `${year}-${month.padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`
    } else {
      return NextResponse.json({ error: "Se requiere month/year o from_date/to_date" }, { status: 400 })
    }

    const supabase = createClient()
    let query = supabase
      .from("attendance")
      .select("*, employees(first_name, last_name, dni, branch, employee_id)")
      .gte("attendance_date", startDate)
      .lte("attendance_date", endDate)
      .order("attendance_date", { ascending: true })

    if (employeeId) {
      query = query.eq("employee_id", Number(employeeId))
    }

    if (branch) {
      query = query.eq("employees.branch", branch)
    }

    const { data, error } = await query
    if (error) throw error

    // Filter out rows where employee didn't match the branch filter
    const filtered = branch ? data?.filter((r: Record<string, unknown>) => r.employees !== null) : data
    return NextResponse.json(filtered)
  } catch {
    return NextResponse.json({ error: "Error al obtener asistencia" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const supabase = createClient()

    // Upsert: insert or update on conflict
    const { data, error } = await supabase
      .from("attendance")
      .upsert(body, { onConflict: "employee_id,attendance_date" })
      .select()

    if (error) throw error
    return NextResponse.json(data)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Error al guardar asistencia"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
