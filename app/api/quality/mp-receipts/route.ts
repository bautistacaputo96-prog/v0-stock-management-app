import { createClient } from "@/lib/supabase"
import { NextResponse } from "next/server"

const LAB_SAMPLE_MATERIALS = ["arena_especial", "piedra_0_10"]

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
      .select("*, supplier:suppliers(*), carrier:carriers(*)")
      .order("receipt_date", { ascending: false })

    // Note: mp_receipts table doesn't have plant column, filter would need to be added if needed
    if (from) query = query.gte("receipt_date", from)
    if (to) query = query.lte("receipt_date", to)
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

    // Insert receipt - convert kg to tn for the database
    const quantityTn = (body.quantity_kg || 0) / 1000
    
    const { data: receipt, error: receiptError } = await supabase
      .from("mp_receipts")
      .insert({
        receipt_date: body.date,
        remito_number: body.remito_number,
        supplier_id: body.supplier_id,
        material_type: body.material_type,
        quantity_tn: quantityTn,
        production_line: body.production_line || null,
        line_type: body.line_type || null,
        observations: body.notes || null,
        carrier_id: body.carrier_id || null,
      })
      .select("*, supplier:suppliers(*), carrier:carriers(*)")
      .single()

    if (receiptError) {
      console.error("[v0] mp_receipts insert error:", receiptError)
      throw receiptError
    }

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

    // Note: quality_pending_tests table may not exist - skipping for now
    // Lab sample tracking can be added later if needed

    return NextResponse.json(receipt)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Error al crear ingreso"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
