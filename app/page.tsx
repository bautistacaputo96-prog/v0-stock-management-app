import { createClient } from "@/lib/supabase/server"
import { DashboardClient } from "@/components/dashboard-client"

// Revalidate every 5 minutes
export const revalidate = 300

export default async function DashboardPage() {
  const supabase = await createClient()

  // Get plants
  const { data: plants } = await supabase
    .from("plants")
    .select("*")
    .order("name", { ascending: true })

  // Get materials with plant info
  const { data: materials } = await supabase
    .from("materials")
    .select(`
      *,
      plants (id, name, code)
    `)
    .order("name", { ascending: true })

  // Get dispatches for the current month and last month
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()

  // Get all dispatches for the last 2 months for calculations
  const { data: dispatches } = await supabase
    .from("dispatches")
    .select(`
      *,
      formulas (id, code, name, plant_id, plants (name)),
      clients:client_id (id, name),
      construction_sites:construction_site_id (id, name),
      dispatch_materials (
        id,
        material_id,
        quantity,
        materials:material_id (id, name, unit)
      )
    `)
    .gte("dispatch_date", startOfLastMonth)
    .order("dispatch_date", { ascending: false })

  // Get recent stock entries
  const { data: recentEntries } = await supabase
    .from("stock_entries")
    .select(`
      *,
      materials (name, unit, plant_id, plants (name)),
      suppliers (name)
    `)
    .order("entry_date", { ascending: false })
    .limit(20)

  // Get test cylinders
  const { data: testCylinders } = await supabase
    .from("test_cylinders")
    .select(`
      *,
      dispatches (
        id,
        formulas (id, name, code)
      )
    `)
    .order("scheduled_test_date", { ascending: true })

  // Get formulas with materials for consumption calculation
  const { data: formulas } = await supabase
    .from("formulas")
    .select(`
      *,
      plants (name),
      formula_materials (
        material_id,
        quantity,
        materials:material_id (id, name, unit)
      )
    `)
    .order("name")

  // Get granulometria tests for quality panel
  const { data: granulometriaTests } = await supabase
    .from("granulometria_tests")
    .select("*")
    .order("extraction_date", { ascending: false })
    .limit(10)

  // Get active press calibration
  const { data: pressCalibrations } = await supabase
    .from("press_calibrations")
    .select("id, calibration_date, is_active")
    .eq("is_active", true)
    .order("calibration_date", { ascending: false })
    .limit(1)

  const pressCalibration = pressCalibrations?.[0] || null

  return (
    <DashboardClient
      plants={plants || []}
      materials={materials || []}
      dispatches={dispatches || []}
      recentEntries={recentEntries || []}
      testCylinders={testCylinders || []}
      formulas={formulas || []}
      granulometriaTests={granulometriaTests || []}
      pressCalibration={pressCalibration}
    />
  )
}
