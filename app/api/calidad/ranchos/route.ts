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
        .order("sample_date", { ascending: false })
        .limit(50)
      
      if (error) throw error
      return NextResponse.json(data || [])
    }

    if (type === "flexion-pending") {
      // Get specimens pending testing (7 or 28 days reached)
      // Specimens without test_date are pending, filter by plant via sample relation
      const { data, error } = await supabase
        .from("quality_flexion_specimens")
        .select(`
          *,
          sample:quality_flexion_samples!inner(*)
        `)
        .eq("sample.plant", "ranchos")
        .is("test_date", null)
        .order("test_age_days", { ascending: true })
      
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
      // Get flexion results for chart - specimens have resistance_mpa not result_mpa
      const { data, error } = await supabase
        .from("quality_flexion_specimens")
        .select(`
          *,
          sample:quality_flexion_samples(*)
        `)
        .not("resistance_mpa", "is", null)
        .order("test_date", { ascending: false })
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
      // Using correct column names from schema
      const { data: sample, error: sampleError } = await supabase
        .from("quality_flexion_samples")
        .insert({
          plant: "ranchos",
          sample_code: data.sample_code,
          adoquin_type: data.adoquin_type,
          adoquin_height_cm: data.adoquin_type?.includes("8") ? 8 : 6,
          sample_date: data.sample_date || new Date().toISOString().split("T")[0],
          production_date: data.production_date,
          length_mm: 200,
          width_mm: 100,
          lote: data.lote || null,
          formula_cement_kg: data.formula_cement_kg || null,
          formula_sand_kg: data.formula_sand_kg || null,
          formula_stone_kg: data.formula_stone_kg || null,
          formula_additive_lts: data.formula_additive_lts || null,
          status: "pending",
          observations: data.notes || null,
          created_by: data.created_by || "Sistema"
        })
        .select()
        .single()
      
      if (sampleError) {
        console.error("Error creating sample:", sampleError)
        throw sampleError
      }

      // Create 3 specimens: 1 for 7 days, 2 for 28 days
      // Using correct column names: test_age_days, specimen_number, height_mm (required)
      const heightMm = data.adoquin_type?.includes("8") ? 80 : 60
      const specimens = [
        {
          sample_id: sample.id,
          specimen_number: 1,
          test_age_days: 7,
          height_mm: heightMm
        },
        {
          sample_id: sample.id,
          specimen_number: 2,
          test_age_days: 28,
          height_mm: heightMm
        },
        {
          sample_id: sample.id,
          specimen_number: 3,
          test_age_days: 28,
          height_mm: heightMm
        }
      ]

      const { error: specimensError } = await supabase
        .from("quality_flexion_specimens")
        .insert(specimens)
      
      if (specimensError) {
        console.error("Error creating specimens:", specimensError)
        throw specimensError
      }

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
      const load_kn = 
        calibration.coef_a * Math.pow(dial, 3) +
        calibration.coef_b * Math.pow(dial, 2) +
        calibration.coef_c * dial +
        calibration.coef_d

      // Calculate MPa: Flexion with central point load
      // Formula: σ = (3 * P * L) / (2 * b * h^2)
      // Where P = force (N), L = span (mm), b = width (mm), h = height (mm)
      const load_n = load_kn * 1000
      const span_mm = 180 // Distance between supports (20cm - 1cm each side)
      const width_mm = 100 // Standard adoquin width
      const height_mm = data.height_mm || (data.adoquin_type?.includes("8") ? 80 : 60)
      const area_mm2 = width_mm * height_mm
      
      const resistance_mpa = (3 * load_n * span_mm) / (2 * width_mm * Math.pow(height_mm, 2))
      const complies_min = resistance_mpa >= 3.8 // IRAM minimum individual

      // Use correct column names from schema
      const { data: result, error } = await supabase
        .from("quality_flexion_specimens")
        .update({
          test_date: new Date().toISOString().split("T")[0],
          dial_reading: dial,
          calibration_id: calibration.id,
          load_kn: load_kn,
          area_mm2: area_mm2,
          resistance_mpa: resistance_mpa,
          complies_min: complies_min,
          weight_sss_g: data.weight_sss_g || null,
          height_mm: height_mm,
          tested_by: data.tested_by,
          observations: data.notes || null
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
