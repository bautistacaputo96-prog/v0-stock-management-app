import { createClient } from "@/lib/supabase"
import { NextResponse } from "next/server"

export async function GET() {
  try {
    const supabase = createClient()
    const { data, error } = await supabase
      .from("quality_parameters")
      .select("*")
      .order("test_type", { ascending: true })
      .order("parameter_name", { ascending: true })

    if (error) throw error
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: "Error al obtener parametros" }, { status: 500 })
  }
}
