import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase"

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = createClient()

    const { error } = await supabase
      .from("mp_receipts")
      .delete()
      .eq("id", parseInt(id))

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[v0] Error deleting mp_receipt:", error)
    return NextResponse.json({ error: "Error al eliminar" }, { status: 500 })
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const supabase = createClient()

    const quantityTn = (body.quantity_kg || 0) / 1000

    const { data, error } = await supabase
      .from("mp_receipts")
      .update({
        receipt_date: body.date,
        remito_number: body.remito_number,
        supplier_id: body.supplier_id,
        material_type: body.material_type,
        quantity_tn: quantityTn,
        production_line: body.production_line || null,
        line_type: body.line_type || body.production_line || "ambas",
        observations: body.notes || null,
        carrier_id: body.carrier_id || null,
      })
      .eq("id", parseInt(id))
      .select("*, supplier:suppliers(*), carrier:carriers(*)")
      .single()

    if (error) throw error

    return NextResponse.json(data)
  } catch (error) {
    console.error("[v0] Error updating mp_receipt:", error)
    return NextResponse.json({ error: "Error al actualizar" }, { status: 500 })
  }
}
