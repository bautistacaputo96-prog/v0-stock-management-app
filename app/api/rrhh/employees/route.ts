import { createClient } from "@/lib/supabase"
import { NextResponse } from "next/server"

export async function GET() {
  try {
    const supabase = createClient()
    const { data, error } = await supabase
      .from("employees")
      .select("*")
      .order("last_name", { ascending: true })

    if (error) throw error
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: "Error al obtener empleados" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const supabase = createClient()
    const { data, error } = await supabase
      .from("employees")
      .insert(body)
      .select()
      .single()

    if (error) throw error
    return NextResponse.json(data)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Error al crear empleado"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json()
    const { id, ...updateData } = body
    updateData.updated_at = new Date().toISOString()
    const supabase = createClient()
    const { data, error } = await supabase
      .from("employees")
      .update(updateData)
      .eq("id", id)
      .select()
      .single()

    if (error) throw error
    return NextResponse.json(data)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Error al actualizar empleado"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
