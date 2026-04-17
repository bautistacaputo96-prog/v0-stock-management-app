import { createClient } from "@/lib/supabase"
import { NextResponse } from "next/server"

const MATERIAL_CATEGORIES = {
  arena: ["arena", "arena especial", "arena_especial", "arena de trituración"],
  piedra: ["piedra", "piedra 0/10", "piedra_0_10", "piedra 0/20"],
  cemento: ["cemento", "cpc40"],
  aditivo: ["aditivo", "mark v", "daraccel", "aditivo_mark_v", "aditivo_darasell"],
}

function categorize(materialType: string): string {
  const lower = materialType?.toLowerCase() || ""
  for (const [category, keywords] of Object.entries(MATERIAL_CATEGORIES)) {
    if (keywords.some(k => lower.includes(k))) return category
  }
  return "otro"
}

function dateStr(offsetDays = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return d.toISOString().split("T")[0]
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const plant = searchParams.get("plant") || ""
    const leadTimeDays = parseInt(searchParams.get("lead_time") || "3")

    const supabase = createClient()
    const ninetyDaysAgo = dateStr(-90)

    // Fetch receipts filtered by plant
    let receiptsQuery = supabase
      .from("mp_receipts")
      .select("material_type, quantity_tn, receipt_date, plant")
      .order("receipt_date", { ascending: true })
    
    if (plant) {
      receiptsQuery = receiptsQuery.eq("plant", plant)
    }
    
    const { data: receipts } = await receiptsQuery

    // Fetch block production records (last 90 days)
    const { data: blockProductions } = await supabase
      .from("block_production")
      .select("production_date, cement_kg, sand_kg, stone_0_10_kg, additive_1_kg, additive_2_kg")
      .gte("production_date", ninetyDaysAgo)
      .order("production_date", { ascending: true })

    // Fetch pipe production records (last 90 days) - for plants like silke, villa-rosa, mercedes
    const { data: pipeProductions } = await supabase
      .from("pipe_production")
      .select("production_date, cement_kg, sand_kg, stone_0_10_kg, stone_0_20_kg, additive_1_kg, additive_2_kg, plant")
      .gte("production_date", ninetyDaysAgo)
      .order("production_date", { ascending: true })

    // Fetch paver production records (last 90 days)
    const { data: paverProductions } = await supabase
      .from("paver_production")
      .select("production_date, formula_cement_kg, formula_sand_kg, formula_stone_kg, formula_additive_lts")
      .gte("production_date", ninetyDaysAgo)
      .order("production_date", { ascending: true })

    const safeReceipts = (receipts || []) as {
      material_type: string
      quantity_tn: number
      receipt_date: string
    }[]
    
    const safeBlockProductions = (blockProductions || []) as Record<string, any>[]
    const safePipeProductions = ((pipeProductions || []) as Record<string, any>[])
      .filter(p => !plant || p.plant === plant)
    const safePaverProductions = (paverProductions || []) as Record<string, any>[]

    // ── Calculate totals by category ──────────────────────────────────────
    const categories = ["arena", "piedra", "cemento", "aditivo"]
    
    // Total received by category (quantity is in Tn, convert to Kg)
    const totalReceivedKg: Record<string, number> = {}
    for (const cat of categories) {
      totalReceivedKg[cat] = safeReceipts
        .filter((r) => categorize(r.material_type) === cat)
        .reduce((s, r) => s + ((r.quantity_tn || 0) * 1000), 0)
    }

    // Total consumed from all production lines
    const getConsumedByCategory = (productions: Record<string, any>[], cat: string): number => {
      return productions.reduce((sum, p) => {
        if (cat === "arena") return sum + (p.sand_kg || p.formula_sand_kg || 0)
        if (cat === "piedra") return sum + (p.stone_0_10_kg || 0) + (p.stone_0_20_kg || 0) + (p.formula_stone_kg || 0)
        if (cat === "cemento") return sum + (p.cement_kg || p.formula_cement_kg || 0)
        if (cat === "aditivo") return sum + (p.additive_1_kg || 0) + (p.additive_2_kg || 0) + ((p.formula_additive_lts || 0) * 1.1) // Convert liters to kg approx
        return sum
      }, 0)
    }

    const totalConsumedKg: Record<string, number> = {}
    for (const cat of categories) {
      totalConsumedKg[cat] = 
        getConsumedByCategory(safeBlockProductions, cat) +
        getConsumedByCategory(safePipeProductions, cat) +
        getConsumedByCategory(safePaverProductions, cat)
    }

    // Current stock
    const currentStockKg: Record<string, number> = {}
    for (const cat of categories) {
      currentStockKg[cat] = Math.max(0, totalReceivedKg[cat] - totalConsumedKg[cat])
    }

    // ── Last 7 days avg daily consumption ──────────────────────────────────
    const sevenDaysAgo = dateStr(-7)
    const last7Block = safeBlockProductions.filter((p) => p.production_date >= sevenDaysAgo)
    const last7Pipe = safePipeProductions.filter((p) => p.production_date >= sevenDaysAgo)
    const last7Paver = safePaverProductions.filter((p) => p.production_date >= sevenDaysAgo)

    const dailyConsumptionKg: Record<string, number> = {}
    for (const cat of categories) {
      const consumed7 = 
        getConsumedByCategory(last7Block, cat) +
        getConsumedByCategory(last7Pipe, cat) +
        getConsumedByCategory(last7Paver, cat)
      dailyConsumptionKg[cat] = consumed7 / 7
    }

    // ── Days of stock ──────────────────────────────────────────────────────
    const daysOfStock: Record<string, number> = {}
    for (const cat of categories) {
      daysOfStock[cat] =
        dailyConsumptionKg[cat] > 0
          ? currentStockKg[cat] / dailyConsumptionKg[cat]
          : 999
    }

    // ── Critical stock alerts ──────────────────────────────────────────────
    const criticalDays = 3 // Alert if less than 3 days of stock
    const warningDays = 7 // Warning if less than 7 days
    const alerts = categories.map(cat => ({
      material: cat,
      stockTn: currentStockKg[cat] / 1000,
      daysOfStock: Math.round(daysOfStock[cat]),
      status: daysOfStock[cat] <= criticalDays ? "critical" : daysOfStock[cat] <= warningDays ? "warning" : "ok",
      dailyConsumptionTn: dailyConsumptionKg[cat] / 1000,
    }))

    // ── Planning table ─────────────────────────────────────────────────────
    const planning = categories.map((cat) => {
      const days = daysOfStock[cat]
      const finitedays = Math.min(days, 365)
      const exhaustionDate =
        days < 365 ? dateStr(Math.round(finitedays)) : null
      const suggestedOrderDate =
        exhaustionDate
          ? new Date(
              new Date(exhaustionDate).getTime() -
                leadTimeDays * 24 * 60 * 60 * 1000
            )
              .toISOString()
              .split("T")[0]
          : null
      return {
        material: cat,
        stockTn: currentStockKg[cat] / 1000,
        dailyConsumptionTn: dailyConsumptionKg[cat] / 1000,
        daysOfStock: Math.min(days, 999),
        exhaustionDate,
        suggestedOrderDate,
      }
    })

    // ── 90-day stock evolution ─────────────────────────────────────────────
    const last90Dates: string[] = []
    for (let i = 89; i >= 0; i--) {
      last90Dates.push(dateStr(-i))
    }

    const allProductions = [...safeBlockProductions, ...safePipeProductions, ...safePaverProductions]

    const stockEvolution = last90Dates.map((d) => {
      const entry: Record<string, number | string> = { date: d }
      for (const cat of categories) {
        const received = safeReceipts
          .filter((r) => categorize(r.material_type) === cat && r.receipt_date <= d)
          .reduce((s, r) => s + ((r.quantity_tn || 0) * 1000), 0)
        const consumed = allProductions
          .filter((p) => p.production_date <= d)
          .reduce((s, p) => s + getConsumedByCategory([p], cat), 0)
        entry[cat] = Math.max(0, (received - consumed) / 1000) // Tn
      }
      return entry
    })

    // ── Mass balance — current month ───────────────────────────────────────
    const now = new Date()
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`

    const monthReceipts = safeReceipts.filter((r) => r.receipt_date >= monthStart)
    const monthProds = allProductions.filter((p) => p.production_date >= monthStart)

    const massBalance = categories.map((cat) => {
      const ingresosTn = monthReceipts
        .filter((r) => categorize(r.material_type) === cat)
        .reduce((s, r) => s + (r.quantity_tn || 0), 0)

      const consumoTeoricoTn = getConsumedByCategory(monthProds, cat) / 1000

      const diferenciaPct =
        consumoTeoricoTn > 0
          ? Math.abs((ingresosTn - consumoTeoricoTn) / consumoTeoricoTn) * 100
          : ingresosTn > 0
          ? 100
          : 0

      return { material: cat, ingresosTn, consumoTeoricoTn, diferenciaPct }
    })

    // Debug info - breakdown of receipts and consumption
    const debug = categories.map(cat => ({
      material: cat,
      totalReceivedTn: totalReceivedKg[cat] / 1000,
      totalConsumedTn: totalConsumedKg[cat] / 1000,
      stockTn: currentStockKg[cat] / 1000,
      receiptsCount: safeReceipts.filter(r => categorize(r.material_type) === cat).length,
      blockConsumptionKg: getConsumedByCategory(safeBlockProductions, cat),
      pipeConsumptionKg: getConsumedByCategory(safePipeProductions, cat),
      paverConsumptionKg: getConsumedByCategory(safePaverProductions, cat),
    }))

    return NextResponse.json({
      currentStockKg,
      daysOfStock,
      dailyConsumptionKg,
      stockEvolution,
      planning,
      massBalance,
      alerts,
      categories,
      debug,
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Error al obtener stock"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
