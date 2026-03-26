import { createClient } from "@/lib/supabase"
import { NextResponse } from "next/server"

const MATERIAL_TYPES = [
  "arena_especial",
  "piedra_0_10",
  "cemento",
  "aditivo_mark_v",
  "aditivo_darasell",
] as const

type MaterialType = (typeof MATERIAL_TYPES)[number]

// kg per rack produced for additives (no direct column in block_production)
const ADDITIVE_RATES: Record<string, number> = {
  aditivo_mark_v: 0.8,
  aditivo_darasell: 0.5,
}

function getConsumedKg(mat: MaterialType, prod: Record<string, number>): number {
  if (mat === "arena_especial") return prod.sand_kg || 0
  if (mat === "piedra_0_10") return prod.stone_0_10_kg || 0
  if (mat === "cemento") return prod.cement_kg || 0
  if (mat === "aditivo_mark_v") return (prod.racks_produced || 0) * ADDITIVE_RATES["aditivo_mark_v"]
  if (mat === "aditivo_darasell") return (prod.racks_produced || 0) * ADDITIVE_RATES["aditivo_darasell"]
  return 0
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
    const today = dateStr(0)
    const ninetyDaysAgo = dateStr(-90)

    // Fetch all receipts for the plant (all time for stock calculation)
    const { data: receipts } = await supabase
      .from("mp_receipts")
      .select("material_type, quantity_kg, date")
      .eq("plant", plant)
      .order("date", { ascending: true })

    // Fetch block production records (last 90 days)
    const { data: productions } = await supabase
      .from("block_production")
      .select("production_date, cement_kg, sand_kg, stone_0_10_kg, racks_produced")
      .gte("production_date", ninetyDaysAgo)
      .order("production_date", { ascending: true })

    const safeReceipts = (receipts || []) as {
      material_type: string
      quantity_kg: number
      date: string
    }[]
    const safeProductions = (productions || []) as Record<string, number>[]

    // ── Current stock (all time received − all time consumed from 90 days) ──
    const totalReceived: Record<string, number> = {}
    const totalConsumed: Record<string, number> = {}

    for (const mat of MATERIAL_TYPES) {
      totalReceived[mat] = safeReceipts
        .filter((r) => r.material_type === mat)
        .reduce((s, r) => s + (r.quantity_kg || 0), 0)

      totalConsumed[mat] = safeProductions.reduce(
        (s, p) => s + getConsumedKg(mat, p),
        0
      )
    }

    const currentStockKg: Record<string, number> = {}
    for (const mat of MATERIAL_TYPES) {
      currentStockKg[mat] = Math.max(0, totalReceived[mat] - totalConsumed[mat])
    }

    // ── Last 7 days avg daily consumption ──────────────────────────────────
    const sevenDaysAgo = dateStr(-7)
    const last7 = safeProductions.filter((p) => p.production_date >= sevenDaysAgo)

    const dailyConsumptionKg: Record<string, number> = {}
    for (const mat of MATERIAL_TYPES) {
      const consumed7 = last7.reduce((s, p) => s + getConsumedKg(mat, p), 0)
      dailyConsumptionKg[mat] = consumed7 / 7
    }

    // ── Days of stock ──────────────────────────────────────────────────────
    const daysOfStock: Record<string, number> = {}
    for (const mat of MATERIAL_TYPES) {
      daysOfStock[mat] =
        dailyConsumptionKg[mat] > 0
          ? currentStockKg[mat] / dailyConsumptionKg[mat]
          : 999
    }

    // ── Planning table ─────────────────────────────────────────────────────
    const planning = MATERIAL_TYPES.map((mat) => {
      const days = daysOfStock[mat]
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
        material: mat,
        stockTn: currentStockKg[mat] / 1000,
        dailyConsumptionTn: dailyConsumptionKg[mat] / 1000,
        daysOfStock: Math.min(days, 999),
        exhaustionDate,
        suggestedOrderDate,
      }
    })

    // ── 30-day stock evolution ─────────────────────────────────────────────
    const last30Dates: string[] = []
    for (let i = 29; i >= 0; i--) {
      last30Dates.push(dateStr(-i))
    }

    const stockEvolution = last30Dates.map((d) => {
      const entry: Record<string, number | string> = { date: d }
      for (const mat of MATERIAL_TYPES) {
        const received = safeReceipts
          .filter((r) => r.material_type === mat && r.date <= d)
          .reduce((s, r) => s + (r.quantity_kg || 0), 0)
        const consumed = safeProductions
          .filter((p) => p.production_date <= d)
          .reduce((s, p) => s + getConsumedKg(mat, p), 0)
        entry[mat] = Math.max(0, (received - consumed) / 1000) // Tn
      }
      return entry
    })

    // ── Mass balance — current month ───────────────────────────────────────
    const now = new Date()
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`

    const monthReceipts = safeReceipts.filter((r) => r.date >= monthStart)
    const monthProds = safeProductions.filter(
      (p) => p.production_date >= monthStart
    )

    const massBalance = MATERIAL_TYPES.map((mat) => {
      const ingresosTn =
        monthReceipts
          .filter((r) => r.material_type === mat)
          .reduce((s, r) => s + (r.quantity_kg || 0), 0) / 1000

      const consumoTeoricoTn =
        monthProds.reduce((s, p) => s + getConsumedKg(mat, p), 0) / 1000

      const diferenciaPct =
        consumoTeoricoTn > 0
          ? Math.abs((ingresosTn - consumoTeoricoTn) / consumoTeoricoTn) * 100
          : ingresosTn > 0
          ? 100
          : 0

      return { material: mat, ingresosTn, consumoTeoricoTn, diferenciaPct }
    })

    return NextResponse.json({
      currentStockKg,
      daysOfStock,
      dailyConsumptionKg,
      stockEvolution,
      planning,
      massBalance,
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Error al obtener stock"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
