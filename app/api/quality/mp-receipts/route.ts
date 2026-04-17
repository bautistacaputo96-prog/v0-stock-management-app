import { createClient } from "@/lib/supabase"
import { NextResponse } from "next/server"

// Check if material type requires lab sample (case-insensitive)
function isLabSampleMaterial(materialType: string): boolean {
  const normalized = materialType.toLowerCase().trim()
  return normalized.includes("arena") || normalized.includes("piedra")
}

// Check if material is arena type (for humidity tests)
function isArenaMaterial(materialType: string): boolean {
  return materialType.toLowerCase().trim().includes("arena")
}

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

    // Filter by plant
    if (plant) query = query.eq("plant", plant)
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
        line_type: body.line_type || body.production_line || "ambas",
        observations: body.notes || null,
        carrier_id: body.carrier_id || null,
        plant: body.plant || "mercedes",
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

    // Create pending quality tests if lab sample was taken
    if (body.lab_sample_taken && isLabSampleMaterial(body.material_type)) {
      const pendingTests = []
      
      // Humidity test pending (for arena types)
      if (isArenaMaterial(body.material_type)) {
        pendingTests.push({
          mp_receipt_id: receipt.id,
          test_type: "humedad",
          material_type: body.material_type,
          plant: body.plant || "mercedes",
          remito_number: body.remito_number,
          supplier_id: body.supplier_id,
          supplier_name: receipt.supplier?.name || null,
          sample_date: body.date,
          status: "pending",
        })
      }
      
      // Granulometry test pending (for both arena and piedra)
      pendingTests.push({
        mp_receipt_id: receipt.id,
        test_type: "granulometria",
        material_type: body.material_type,
        plant: body.plant || "mercedes",
        remito_number: body.remito_number,
        supplier_id: body.supplier_id,
        supplier_name: receipt.supplier?.name || null,
        sample_date: body.date,
        status: "pending",
      })

      if (pendingTests.length > 0) {
        const { error: pendingError } = await supabase
          .from("quality_pending_tests")
          .insert(pendingTests)
        
        if (pendingError) {
          console.error("[v0] Error creating pending tests:", pendingError)
          // Don't throw - receipt was created successfully
        }
      }
    }

    return NextResponse.json(receipt)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Error al crear ingreso"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
