import { createClient } from "@/lib/supabase/server"
import { DashboardClient } from "@/components/dashboard-client"
import { todasLasFilas } from "@/lib/gps-viajes"

// Render at request time so Supabase env vars are available (avoids build-time prerender error)
export const dynamic = "force-dynamic"

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

  // Despachos de los 12 meses que ofrece el selector del Dashboard (antes se traían solo 2: elegir un mes anterior
  // mostraba 0 m³). De a 1000 filas (PostgREST corta ahí) y sin los materiales, que pesan: esos van aparte, solo de los
  // últimos 8 días (el consumo promedio de las alertas de stock usa 7).
  const now = new Date()
  const inicio12Meses = new Date(now.getFullYear(), now.getMonth() - 11, 1).toISOString()
  const hace8Dias = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString()

  const dispatchesSinMateriales = await todasLasFilas((desde, hasta) =>
    supabase
      .from("dispatches")
      .select(`
        id, dispatch_date, quantity_m3, client, obra, remito, formula_id, client_id, plant_id, is_test_dispatch,
        formulas (id, code, name, plant_id, plants (name)),
        clients:client_id (id, name),
        construction_sites:construction_site_id (id, name)
      `)
      .gte("dispatch_date", inicio12Meses)
      .order("dispatch_date", { ascending: false })
      .order("id")
      .range(desde, hasta),
  ).catch((e) => {
    console.error("[dashboard] despachos:", e)
    return [] as any[]
  })

  const { data: materialesRecientes } = await supabase
    .from("dispatches")
    .select("id, dispatch_materials (id, material_id, quantity, materials:material_id (id, name, unit))")
    .gte("dispatch_date", hace8Dias)
    .limit(1000)
  const materialesDe = new Map((materialesRecientes || []).map((d: any) => [d.id, d.dispatch_materials || []]))
  const dispatches = dispatchesSinMateriales.map((d: any) => ({ ...d, dispatch_materials: materialesDe.get(d.id) || [] }))

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
      dispatches={dispatches}
      recentEntries={recentEntries || []}
      testCylinders={testCylinders || []}
      formulas={formulas || []}
      granulometriaTests={granulometriaTests || []}
      pressCalibration={pressCalibration}
    />
  )
}
