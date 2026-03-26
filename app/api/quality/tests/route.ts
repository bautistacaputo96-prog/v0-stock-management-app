import { createClient } from "@/lib/supabase"
import { NextResponse } from "next/server"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const type = searchParams.get("type") // absorption, flexion, granulometry, humidity
    const plant = searchParams.get("plant")
    const from = searchParams.get("from")
    const to = searchParams.get("to")

    const supabase = createClient()

    if (type === "absorption") {
      let query = supabase.from("absorption_tests").select("*").order("test_date", { ascending: false })
      if (plant) query = query.eq("plant", plant)
      if (from) query = query.gte("test_date", from)
      if (to) query = query.lte("test_date", to)
      const { data, error } = await query
      if (error) throw error
      return NextResponse.json(data)
    }

    if (type === "flexion") {
      let query = supabase.from("flexion_tests").select("*").order("test_date", { ascending: false })
      if (plant) query = query.eq("plant", plant)
      if (from) query = query.gte("test_date", from)
      if (to) query = query.lte("test_date", to)
      const { data, error } = await query
      if (error) throw error
      return NextResponse.json(data)
    }

    if (type === "granulometry") {
      let query = supabase.from("granulometry_tests").select("*, mp_receipt:mp_receipts(*, supplier:suppliers(*))").order("created_at", { ascending: false })
      if (from || to) {
        // Filter by receipt date
        if (from) query = query.gte("mp_receipt.date", from)
        if (to) query = query.lte("mp_receipt.date", to)
      }
      const { data, error } = await query
      if (error) throw error
      return NextResponse.json(data)
    }

    if (type === "humidity") {
      let query = supabase.from("humidity_tests").select("*, mp_receipt:mp_receipts(*, supplier:suppliers(*))").order("created_at", { ascending: false })
      if (from || to) {
        if (from) query = query.gte("mp_receipt.date", from)
        if (to) query = query.lte("mp_receipt.date", to)
      }
      const { data, error } = await query
      if (error) throw error
      return NextResponse.json(data)
    }

    return NextResponse.json({ error: "Tipo de ensayo no valido" }, { status: 400 })
  } catch {
    return NextResponse.json({ error: "Error al obtener ensayos" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { type, ...data } = body
    const supabase = createClient()

    if (type === "absorption") {
      const { data: test, error } = await supabase
        .from("absorption_tests")
        .insert(data)
        .select()
        .single()
      if (error) throw error
      return NextResponse.json(test)
    }

    if (type === "flexion") {
      const { data: test, error } = await supabase
        .from("flexion_tests")
        .insert(data)
        .select()
        .single()
      if (error) throw error
      return NextResponse.json(test)
    }

    return NextResponse.json({ error: "Tipo de ensayo no valido" }, { status: 400 })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Error al crear ensayo"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
