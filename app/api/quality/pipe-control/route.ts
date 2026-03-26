import { createClient } from "@/lib/supabase"
import { NextResponse } from "next/server"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const from = searchParams.get("from")
    const to = searchParams.get("to")

    const supabase = createClient()
    let query = supabase
      .from("pipe_quality_control")
      .select("*, items:pipe_quality_items(*, defects:pipe_quality_defects(*, reason:pipe_defect_reasons(*)))")
      .order("control_date", { ascending: false })

    if (from) query = query.gte("control_date", from)
    if (to) query = query.lte("control_date", to)

    const { data, error } = await query
    if (error) throw error
    return NextResponse.json(data)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Error al obtener controles"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const supabase = createClient()

    // Insert control header
    const { data: control, error: controlError } = await supabase
      .from("pipe_quality_control")
      .insert({
        control_date: body.control_date,
        lote: body.lote,
        fabrication_order: body.fabrication_order,
        production_responsible_id: body.production_responsible_id,
        logistics_responsible_id: body.logistics_responsible_id,
        observations: body.observations || null,
      })
      .select()
      .single()

    if (controlError) throw controlError

    // Insert items for each diameter
    if (body.items && body.items.length > 0) {
      const items = body.items.map((item: { diameter: number; first_quality: number; second_quality: number; broken: number }) => ({
        pipe_quality_control_id: control.id,
        diameter: item.diameter,
        first_quality: item.first_quality,
        second_quality: item.second_quality,
        broken: item.broken,
      }))

      const { data: insertedItems, error: itemsError } = await supabase
        .from("pipe_quality_items")
        .insert(items)
        .select()
      if (itemsError) throw itemsError

      // Insert defects for items that have second_quality or broken > 0
      if (body.defects && body.defects.length > 0 && insertedItems) {
        const defectRows: { pipe_quality_item_id: number; defect_reason_id: number; quantity: number }[] = []

        for (const defect of body.defects) {
          // Match item by diameter
          const matchedItem = insertedItems.find((i: { diameter: number }) => i.diameter === defect.diameter)
          if (matchedItem && defect.reasons) {
            for (const r of defect.reasons) {
              if (r.quantity > 0) {
                defectRows.push({
                  pipe_quality_item_id: matchedItem.id,
                  defect_reason_id: r.defect_reason_id,
                  quantity: r.quantity,
                })
              }
            }
          }
        }

        if (defectRows.length > 0) {
          const { error: defectError } = await supabase
            .from("pipe_quality_defects")
            .insert(defectRows)
          if (defectError) throw defectError
        }
      }
    }

    // Re-fetch with items and defects
    const { data: full, error: fetchError } = await supabase
      .from("pipe_quality_control")
      .select("*, items:pipe_quality_items(*, defects:pipe_quality_defects(*, reason:pipe_defect_reasons(*)))")
      .eq("id", control.id)
      .single()

    if (fetchError) throw fetchError
    return NextResponse.json(full)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Error al crear control"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")
    if (!id) return NextResponse.json({ error: "ID requerido" }, { status: 400 })

    const body = await request.json()
    const supabase = createClient()

    // Update control header
    const { error: controlError } = await supabase
      .from("pipe_quality_control")
      .update({
        control_date: body.control_date,
        lote: body.lote,
        fabrication_order: body.fabrication_order,
        production_responsible_id: body.production_responsible_id,
        logistics_responsible_id: body.logistics_responsible_id,
        observations: body.observations || null,
      })
      .eq("id", id)

    if (controlError) throw controlError

    // Get existing items to delete their defects
    const { data: existingItems } = await supabase
      .from("pipe_quality_items")
      .select("id")
      .eq("pipe_quality_control_id", id)

    if (existingItems && existingItems.length > 0) {
      const itemIds = existingItems.map(i => i.id)
      await supabase
        .from("pipe_quality_defects")
        .delete()
        .in("pipe_quality_item_id", itemIds)
    }

    // Delete existing items
    await supabase
      .from("pipe_quality_items")
      .delete()
      .eq("pipe_quality_control_id", id)

    // Re-insert items
    if (body.items && body.items.length > 0) {
      const items = body.items.map((item: { diameter: number; first_quality: number; second_quality: number; broken: number }) => ({
        pipe_quality_control_id: Number(id),
        diameter: item.diameter,
        first_quality: item.first_quality,
        second_quality: item.second_quality,
        broken: item.broken,
      }))

      const { data: insertedItems, error: itemsError } = await supabase
        .from("pipe_quality_items")
        .insert(items)
        .select()
      if (itemsError) throw itemsError

      // Insert defects
      if (body.defects && body.defects.length > 0 && insertedItems) {
        const defectRows: { pipe_quality_item_id: number; defect_reason_id: number; quantity: number }[] = []

        for (const defect of body.defects) {
          const matchedItem = insertedItems.find((i: { diameter: number }) => i.diameter === defect.diameter)
          if (matchedItem && defect.reasons) {
            for (const r of defect.reasons) {
              if (r.quantity > 0) {
                defectRows.push({
                  pipe_quality_item_id: matchedItem.id,
                  defect_reason_id: r.defect_reason_id,
                  quantity: r.quantity,
                })
              }
            }
          }
        }

        if (defectRows.length > 0) {
          const { error: defectError } = await supabase
            .from("pipe_quality_defects")
            .insert(defectRows)
          if (defectError) throw defectError
        }
      }
    }

    // Re-fetch with items and defects
    const { data: full, error: fetchError } = await supabase
      .from("pipe_quality_control")
      .select("*, items:pipe_quality_items(*, defects:pipe_quality_defects(*, reason:pipe_defect_reasons(*)))")
      .eq("id", id)
      .single()

    if (fetchError) throw fetchError
    return NextResponse.json(full)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Error al actualizar control"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
