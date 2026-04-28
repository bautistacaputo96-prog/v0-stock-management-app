import { createClient } from "@/lib/supabase"
import { NextResponse } from "next/server"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const plant = searchParams.get("plant")

    const supabase = createClient()
    let query = supabase
      .from("suppliers")
      .select("*")
      .eq("is_active", true)

    if (plant) {
      // Convert plant format (villa-rosa -> villa_rosa)
      const plantValue = plant === "villa-rosa" ? "villa_rosa" : plant
      query = query.eq("plant", plantValue)
    }

    const { data, error } = await query.order("name", { ascending: true })
    if (error) throw error
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: "Error al obtener proveedores" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const supabase = createClient()

    const { data, error } = await supabase
      .from("suppliers")
      .insert({
        name: body.name,
        material_type: body.material_type,
        product_detail: body.product_detail || body.material_type,
        line_type: body.line_type || "ambas",
        plant: body.plant || "mercedes",
        is_active: true,
      })
      .select()
      .single()

    if (error) throw error
    return NextResponse.json(data)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Error al crear proveedor"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
