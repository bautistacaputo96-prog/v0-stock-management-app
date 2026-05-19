import { createClient } from "@/lib/supabase"
import { NextResponse } from "next/server"

// GET /api/rrhh/payroll/periods?plant=Olivera&year=2025
export async function GET(request: Request) {
  const supabase = createClient()
  const { searchParams } = new URL(request.url)
  const plant = searchParams.get("plant")
  const year = searchParams.get("year")
  const id = searchParams.get("id")

  if (id) {
    const { data, error } = await supabase
      .from("payroll_periods")
      .select("*, payroll_lines(count)")
      .eq("id", id)
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  let query = supabase
    .from("payroll_periods")
    .select("*")
    .order("period_year", { ascending: false })
    .order("period_month", { ascending: false })

  if (plant) query = query.eq("plant", plant)
  if (year) query = query.eq("period_year", parseInt(year))

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// POST /api/rrhh/payroll/periods — Crea un nuevo período
export async function POST(request: Request) {
  const supabase = createClient()
  const body = await request.json()
  const { plant, period_type, period_year, period_month } = body

  // Calcular fechas del período
  let dateFrom: string
  let dateTo: string

  if (period_type === "primera_quincena") {
    dateFrom = `${period_year}-${String(period_month).padStart(2, "0")}-01`
    dateTo = `${period_year}-${String(period_month).padStart(2, "0")}-15`
  } else if (period_type === "segunda_quincena") {
    dateFrom = `${period_year}-${String(period_month).padStart(2, "0")}-16`
    const lastDay = new Date(period_year, period_month, 0).getDate()
    dateTo = `${period_year}-${String(period_month).padStart(2, "0")}-${lastDay}`
  } else {
    // mensual
    dateFrom = `${period_year}-${String(period_month).padStart(2, "0")}-01`
    const lastDay = new Date(period_year, period_month, 0).getDate()
    dateTo = `${period_year}-${String(period_month).padStart(2, "0")}-${lastDay}`
  }

  const { data, error } = await supabase
    .from("payroll_periods")
    .insert({ plant, period_type, period_year, period_month, date_from: dateFrom, date_to: dateTo })
    .select()
    .single()

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "Ya existe un período para esa planta y quincena" }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, data })
}

// PATCH /api/rrhh/payroll/periods — Cambia estado del período
export async function PATCH(request: Request) {
  const supabase = createClient()
  const body = await request.json()
  const { id, status, closed_by } = body

  // Verificar que la transición de estado sea válida
  const { data: current } = await supabase
    .from("payroll_periods")
    .select("status")
    .eq("id", id)
    .single()

  const validTransitions: Record<string, string[]> = {
    borrador: ["revision"],
    revision: ["borrador", "cerrado"],
    cerrado: [], // No se puede reabrir desde la UI
  }

  if (!current || !validTransitions[current.status]?.includes(status)) {
    return NextResponse.json(
      { error: `No se puede pasar de "${current?.status}" a "${status}"` },
      { status: 400 }
    )
  }

  const updateData: Record<string, unknown> = { status, updated_at: new Date().toISOString() }
  if (status === "cerrado") {
    updateData.closed_at = new Date().toISOString()
    updateData.closed_by = closed_by || "sistema"
  }

  const { data, error } = await supabase
    .from("payroll_periods")
    .update(updateData)
    .eq("id", id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, data })
}

// DELETE /api/rrhh/payroll/periods — Solo borra períodos en borrador
export async function DELETE(request: Request) {
  const supabase = createClient()
  const { searchParams } = new URL(request.url)
  const id = searchParams.get("id")

  const { data: period } = await supabase
    .from("payroll_periods")
    .select("status")
    .eq("id", id)
    .single()

  if (period?.status !== "borrador") {
    return NextResponse.json(
      { error: "Solo se pueden eliminar períodos en estado borrador" },
      { status: 400 }
    )
  }

  const { error } = await supabase.from("payroll_periods").delete().eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
