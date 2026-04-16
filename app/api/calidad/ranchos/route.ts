import { NextRequest, NextResponse } from "next/server"
import { getSupabase } from "@/lib/supabase"

export async function GET(request: NextRequest) {
  const supabase = getSupabase()
  const { searchParams } = new URL(request.url)
  const type = searchParams.get("type")

  try {
    if (type === "pending") {
      // Get pending tests
      const { data, error } = await supabase
        .from("quality_pending_tests")
        .select("*")
        .eq("plant", "ranchos")
        .eq("status", "pending")
        .order("created_at", { ascending: false })
      
      if (error) throw error
      return NextResponse.json(data || [])
    }

    if (type === "calibration") {
      // Get active press calibration
      const { data, error } = await supabase
        .from("quality_press_calibration")
        .select("*")
        .eq("plant", "ranchos")
        .eq("is_active", true)
        .order("calibration_date", { ascending: false })
        .limit(1)
        .single()
      
      if (error && error.code !== "PGRST116") throw error
      return NextResponse.json(data || null)
    }

    if (type === "flexion-samples") {
      // Get flexion samples with specimens
      const { data, error } = await supabase
        .from("quality_flexion_samples")
        .select(`
          *,
          specimens:quality_flexion_specimens(*)
        `)
        .eq("plant", "ranchos")
        .order("extraction_date", { ascending: false })
        .limit(50)
      
      if (error) throw error
      return NextResponse.json(data || [])
    }

    if (type === "flexion-pending") {
      // Get specimens pending testing (7 or 28 days reached)
      const today = new Date().toISOString().split("T")[0]
      
      const { data, error } = await supabase
        .from("quality_flexion_specimens")
        .select(`
          *,
          sample:quality_flexion_samples(*)
        `)
        .is("tested_at", null)
        .lte("scheduled_test_date", today)
        .order("scheduled_test_date", { ascending: true })
      
      if (error) throw error
      return NextResponse.json(data || [])
    }

    if (type === "parameters") {
      // Get quality parameters
      const { data, error } = await supabase
        .from("quality_parameters")
        .select("*")
        .eq("plant", "ranchos")
      
      if (error) throw error
      
      // Convert to object for easier access
      const params: Record<string, number> = {}
      data?.forEach((p: { parameter_name: string; parameter_value: number }) => {
        params[p.parameter_name] = p.parameter_value
      })
      return NextResponse.json(params)
    }

    if (type === "flexion-results") {
      // Get flexion results for chart
      const { data, error } = await supabase
        .from("quality_flexion_specimens")
        .select(`
          *,
          sample:quality_flexion_samples(*)
        `)
        .eq("plant", "ranchos")
        .not("result_mpa", "is", null)
        .order("tested_at", { ascending: false })
        .limit(100)
      
      if (error) throw error
      return NextResponse.json(data || [])
    }

    return NextResponse.json({ error: "Invalid type parameter" }, { status: 400 })
  } catch (error) {
    console.error("Quality API error:", error)
    return NextResponse.json({ error: "Failed to fetch data" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const supabase = getSupabase()
  const body = await request.json()
  const { type, ...data } = body

  try {
    if (type === "pending-test") {
      // Create pending test from material receipt
      const { data: result, error } = await supabase
        .from("quality_pending_tests")
        .insert({
          plant: "ranchos",
          test_type: data.test_type,
          material_type: data.material_type,
          supplier_name: data.supplier_name,
          receipt_date: data.receipt_date,
          receipt_number: data.receipt_number,
          status: "pending"
        })
        .select()
        .single()
      
      if (error) throw error
      return NextResponse.json(result)
    }

    if (type === "calibration") {
      // Deactivate previous calibrations
      await supabase
        .from("quality_press_calibration")
        .update({ is_active: false })
        .eq("plant", "ranchos")
      
      // Create new calibration
      const { data: result, error } = await supabase
        .from("quality_press_calibration")
        .insert({
          plant: "ranchos",
          calibration_date: data.calibration_date,
          coef_a: data.coef_a,
          coef_b: data.coef_b,
          coef_c: data.coef_c,
          coef_d: data.coef_d,
          calibrated_by: data.calibrated_by,
          certificate_number: data.certificate_number,
          is_active: true
        })
        .select()
        .single()
      
      if (error) throw error
      return NextResponse.json(result)
    }

    if (type === "flexion-sample") {
      // Create flexion sample with 3 specimens
      const { data: sample, error: sampleError } = await supabase
        .from("quality_flexion_samples")
        .insert({
          plant: "ranchos",
          sample_code: data.sample_code,
          adoquin_type: data.adoquin_type,
          extraction_date: data.extraction_date,
          production_date: data.production_date,
          formula_snapshot: data.formula_snapshot,
          notes: data.notes
        })
        .select()
        .single()
      
      if (sampleError) throw sampleError

      // Calculate test dates
      const extractionDate = new Date(data.extraction_date)
      const date7 = new Date(extractionDate)
      date7.setDate(date7.getDate() + 7)
      const date28 = new Date(extractionDate)
      date28.setDate(date28.getDate() + 28)

      // Create 3 specimens: 1 for 7 days, 2 for 28 days
      const specimens = [
        {
          sample_id: sample.id,
          plant: "ranchos",
          specimen_number: 1,
          target_age_days: 7,
          scheduled_test_date: date7.toISOString().split("T")[0]
        },
        {
          sample_id: sample.id,
          plant: "ranchos",
          specimen_number: 2,
          target_age_days: 28,
          scheduled_test_date: date28.toISOString().split("T")[0]
        },
        {
          sample_id: sample.id,
          plant: "ranchos",
          specimen_number: 3,
          target_age_days: 28,
          scheduled_test_date: date28.toISOString().split("T")[0]
        }
      ]

      const { error: specimensError } = await supabase
        .from("quality_flexion_specimens")
        .insert(specimens)
      
      if (specimensError) throw specimensError

      return NextResponse.json(sample)
    }

    if (type === "flexion-result") {
      // Record flexion test result
      const { data: calibration } = await supabase
        .from("quality_press_calibration")
        .select("*")
        .eq("plant", "ranchos")
        .eq("is_active", true)
        .single()

      if (!calibration) {
        return NextResponse.json({ error: "No hay calibracion activa" }, { status: 400 })
      }

      // Calculate force using cubic polynomial: F = A*dial^3 + B*dial^2 + C*dial + D
      const dial = data.dial_reading
      const force_kn = 
        calibration.coef_a * Math.pow(dial, 3) +
        calibration.coef_b * Math.pow(dial, 2) +
        calibration.coef_c * dial +
        calibration.coef_d

      // Calculate MPa: Flexion with central point load
      // Formula: σ = (3 * P * L) / (2 * b * h^2)
      // Where P = force (N), L = span (mm), b = width (mm), h = height (mm)
      const force_n = force_kn * 1000
      const span_mm = 180 // Distance between supports (20cm - 1cm each side)
      const width_mm = data.width_mm || 100
      const height_mm = data.height_mm || (data.adoquin_type?.includes("8") ? 80 : 60)
      
      const result_mpa = (3 * force_n * span_mm) / (2 * width_mm * Math.pow(height_mm, 2))

      const { data: result, error } = await supabase
        .from("quality_flexion_specimens")
        .update({
          tested_at: new Date().toISOString(),
          dial_reading: dial,
          force_kn: force_kn,
          result_mpa: result_mpa,
          weight_sss_g: data.weight_sss_g,
          height_mm: height_mm,
          width_mm: width_mm,
          tested_by: data.tested_by,
          notes: data.notes
        })
        .eq("id", data.specimen_id)
        .select()
        .single()
      
      if (error) throw error
      return NextResponse.json(result)
    }

    if (type === "complete-pending") {
      // Mark pending test as completed
      const { error } = await supabase
        .from("quality_pending_tests")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", data.id)
      
      if (error) throw error
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: "Invalid type" }, { status: 400 })
  } catch (error) {
    console.error("Quality API POST error:", error)
    return NextResponse.json({ error: "Failed to save data" }, { status: 500 })
  }
}
