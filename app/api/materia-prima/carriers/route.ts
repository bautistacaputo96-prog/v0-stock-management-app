import { createClient } from "@/lib/supabase"
import { NextResponse } from "next/server"

export async function GET(request: Request) {
  try {
    const supabase = createClient()
    const { searchParams } = new URL(request.url)
    const plant = searchParams.get("plant")
    
    let query = supabase
      .from("carriers")
      .select("*")
      .eq("is_active", true)
      .order("name", { ascending: true })
    
    // Filtrar por planta si se especifica
    if (plant) {
      query = query.eq("plant", plant)
    }
    
    const { data, error } = await query
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
      .insert({ 
        name: body.name.trim(), 
        phone: body.phone?.trim() || null,
        license_plate: body.license_plate?.trim() || null,
        company: body.company?.trim() || null,
        contact: body.contact?.trim() || null,
        plant: body.plant || "silke",
        is_active: true
      })
      .select()
      .single()
    if (error) throw error
    return NextResponse.json(data)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Error al crear transportista"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
