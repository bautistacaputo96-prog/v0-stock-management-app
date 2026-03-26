import { createClient } from "@/lib/supabase"
import { NextResponse } from "next/server"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const plant = searchParams.get("plant")
    const from = searchParams.get("from")
    const to = searchParams.get("to")
    const supplierId = searchParams.get("supplier_id")
    const materialType = searchParams.get("material_type")

    const supabase = createClient()
    let query = supabase
      .from("mp_receipts")
      .select("*, supplier:suppliers(*)")
      .order("date", { ascending: false })

    if (plant) query = query.eq("plant", plant)
    if (from) query = query.gte("date", from)
    if (to) query = query.lte("date", to)
    if (supplierId) query = query.eq("supplier_id", supplierId)
    if (materialType) query = query.eq("material_type", materialType)

    const { data, error } = await query
    if (error) throw error
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: "Error al obtener ingresos" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const supabase = createClient()

    // Insert receipt
    const { data: receipt, error: receiptError } = await supabase
      .from("mp_receipts")
      .insert({
        plant: body.plant,
        date: body.date,
        remito_number: body.remito_number,
        supplier_id: body.supplier_id,
        material_type: body.material_type,
        quantity_kg: body.quantity_kg,
        production_line: body.production_line || null,
        notes: body.notes,
      })
      .select("*, supplier:suppliers(*)")
      .single()

    if (receiptError) throw receiptError

    // Insert granulometry test if provided
    if (body.granulometry) {
      const { error: granError } = await supabase
        .from("granulometry_tests")
        .insert({
          mp_receipt_id: receipt.id,
          ...body.granulometry,
        })
      if (granError) throw granError
    }

    // Insert humidity test if provided (for arena)
    if (body.humidity) {
      const { error: humError } = await supabase
        .from("humidity_tests")
        .insert({
          mp_receipt_id: receipt.id,
          ...body.humidity,
        })
      if (humError) throw humError
    }

    return NextResponse.json(receipt)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Error al crear ingreso"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
