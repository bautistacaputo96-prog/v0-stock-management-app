import { createClient } from "@/lib/supabase"
import { NextResponse } from "next/server"

export async function GET() {
  try {
    const supabase = createClient()
    const { data, error } = await supabase
      .from("pipe_defect_reasons")
      .select("*")
      .order("category")
      .order("display_order")

    if (error) throw error
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: "Error al obtener motivos de defectos" }, { status: 500 })
  }
}
