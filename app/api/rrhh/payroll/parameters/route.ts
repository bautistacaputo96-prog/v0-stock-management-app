import { createClient } from "@/lib/supabase"
import { NextResponse } from "next/server"

// GET /api/rrhh/payroll/parameters
// Devuelve categorías UOCRA, parámetros globales y feriados
export async function GET() {
  const supabase = createClient()

  const [categoriesRes, paramsRes, holidaysRes] = await Promise.all([
    supabase
      .from("uocra_categories")
      .select("*")
      .eq("is_current", true)
      .order("category_name"),
    supabase
      .from("payroll_parameters")
      .select("*")
      .eq("is_current", true)
      .order("parameter_key"),
    supabase
      .from("public_holidays")
      .select("*")
      .order("holiday_date"),
  ])

  if (categoriesRes.error || paramsRes.error || holidaysRes.error) {
    return NextResponse.json({ error: "Error al obtener parámetros" }, { status: 500 })
  }

  // Convertir array de parámetros a objeto key:value
  const paramsMap: Record<string, number> = {}
  paramsRes.data?.forEach((p) => {
    paramsMap[p.parameter_key] = parseFloat(p.parameter_value)
  })

  return NextResponse.json({
    categories: categoriesRes.data,
    parameters: paramsMap,
    parameters_raw: paramsRes.data,
    holidays: holidaysRes.data,
  })
}

// PUT /api/rrhh/payroll/parameters
// Actualiza valor de una categoría UOCRA o un parámetro global
export async function PUT(request: Request) {
  const supabase = createClient()
  const body = await request.json()

  // Actualizar categoría UOCRA
  if (body.type === "category") {
    const { category_name, hourly_rate, daily_rate, effective_from } = body

    // Marcar la anterior como no-current
    await supabase
      .from("uocra_categories")
      .update({ is_current: false })
      .eq("category_name", category_name)
      .eq("is_current", true)

    // Insertar nueva versión
    const { data, error } = await supabase
      .from("uocra_categories")
      .insert({
        category_name,
        hourly_rate: parseFloat(hourly_rate),
        daily_rate: daily_rate ? parseFloat(daily_rate) : parseFloat(hourly_rate) * 8,
        effective_from: effective_from || new Date().toISOString().split("T")[0],
        is_current: true,
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, data })
  }

  // Actualizar parámetro global
  if (body.type === "parameter") {
    const { parameter_key, parameter_value } = body

    const { error } = await supabase
      .from("payroll_parameters")
      .update({ parameter_value: parseFloat(parameter_value) })
      .eq("parameter_key", parameter_key)
      .eq("is_current", true)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: "Tipo de actualización no válido" }, { status: 400 })
}

// POST /api/rrhh/payroll/parameters/holiday
// Agrega o elimina feriado
export async function POST(request: Request) {
  const supabase = createClient()
  const body = await request.json()

  if (body.action === "add_holiday") {
    const { holiday_date, holiday_name, holiday_type } = body
    const { data, error } = await supabase
      .from("public_holidays")
      .upsert({ holiday_date, holiday_name, holiday_type: holiday_type || "nacional" })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, data })
  }

  if (body.action === "delete_holiday") {
    const { id } = body
    const { error } = await supabase.from("public_holidays").delete().eq("id", id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: "Acción no válida" }, { status: 400 })
}
