import { createClient } from "@/lib/supabase"
import { NextResponse } from "next/server"

export async function GET() {
  try {
    const supabase = createClient()
    const { data, error } = await supabase
      .from("carriers")
      .select("*")
      .order("name", { ascending: true })
    if (error) throw error
    return NextResponse.json(data || [])
  } catch {
    return NextResponse.json({ error: "Error al obtener transportistas" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    if (!body.name?.trim()) {
      return NextResponse.json({ error: "El nombre es requerido" }, { status: 400 })
    }
    const supabase = createClient()
    const { data, error } = await supabase
      .from("carriers")
      .insert({ name: body.name.trim(), contact: body.contact?.trim() || null })
      .select()
      .single()
    if (error) throw error
    return NextResponse.json(data)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Error al crear transportista"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
