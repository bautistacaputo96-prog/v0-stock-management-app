"use client"

import { useEffect, useState, useMemo } from "react"
import { getSupabase } from "@/lib/supabase"
import { usePlant } from "@/lib/plant-context"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { FlaskConical, ArrowRight, AlertTriangle, CheckCircle2, Clock, User } from "lucide-react"
import Link from "next/link"

// ══════════════════════════════════════════════════════════════════════════════
// CONFIGURACION POR PLANTA
// ══════════════════════════════════════════════════════════════════════════════
interface PlantConfig {
  tma: number
  product: string
  aggregates: { name: string; type: "arena" | "piedra_0_6" | "piedra_0_10"; dbType: string }[]
}

const PLANT_CONFIG: Record<string, PlantConfig> = {
  silke: {
    tma: 9.5,
    product: "Canos DN 300-600",
    aggregates: [
      { name: "Arena", type: "arena", dbType: "arena" },
      { name: "Piedra 0/10", type: "piedra_0_10", dbType: "piedra_0_10" },
    ],
  },
  "villa-rosa": {
    tma: 19,
    product: "Canos DN 800-1200",
    aggregates: [
      { name: "Arena", type: "arena", dbType: "arena" },
      { name: "Piedra 0/10", type: "piedra_0_10", dbType: "piedra_0_10" },
    ],
  },
  ranchos: {
    tma: 6.3,
    product: "Adoquines",
    aggregates: [
      { name: "Arena", type: "arena", dbType: "arena" },
      { name: "Piedra 0/6", type: "piedra_0_6", dbType: "piedra_0_6" },
    ],
  },
}

// ══════════════════════════════════════════════════════════════════════════════
// RANGOS DE MF POR TIPO DE ARIDO
// ══════════════════════════════════════════════════════════════════════════════
type MFAlertLevel = "green" | "yellow" | "orange" | "red"

function evaluateSandMF(mf: number): { level: MFAlertLevel; label: string } {
  if (mf < 1.40) return { level: "red", label: "Muy bajo" }
  if (mf < 1.50) return { level: "orange", label: "Bajo" }
  if (mf < 1.80) return { level: "yellow", label: "Aceptable" }
  if (mf <= 2.20) return { level: "green", label: "Optimo" }
  if (mf <= 3.20) return { level: "yellow", label: "Aceptable" }
  return { level: "red", label: "Muy alto" }
}

function evaluateStone06MF(mf: number): { level: MFAlertLevel; label: string } {
  if (mf < 3.00) return { level: "yellow", label: "Bajo" }
  if (mf <= 4.20) return { level: "green", label: "Optimo" }
  return { level: "yellow", label: "Alto" }
}

function evaluateStone010MF(mf: number): { level: MFAlertLevel; label: string } {
  if (mf < 3.50) return { level: "yellow", label: "Bajo" }
  if (mf <= 5.00) return { level: "green", label: "Optimo" }
  return { level: "yellow", label: "Alto" }
}

function getMFEvaluation(type: "arena" | "piedra_0_6" | "piedra_0_10", mf: number) {
  if (type === "arena") return evaluateSandMF(mf)
  if (type === "piedra_0_6") return evaluateStone06MF(mf)
  return evaluateStone010MF(mf)
}

// ══════════════════════════════════════════════════════════════════════════════
// CALCULO DE RMS VS FULLER
// ══════════════════════════════════════════════════════════════════════════════
const SIEVE_SIZES_MM = [9.5, 4.75, 2.36, 1.18, 0.60, 0.30, 0.15]

function fullerCurve(sieveMm: number, tma: number): number {
  return 100 * Math.sqrt(sieveMm / tma)
}

function calculateRMS(sandPassing: number[], stonePassing: number[], sandPct: number, tma: number): number {
  if (!sandPassing.length || !stonePassing.length) return 999
  const blend = sandPassing.map((sp, i) => (sp * sandPct + stonePassing[i] * (100 - sandPct)) / 100)
  let sumSq = 0
  for (let i = 0; i < SIEVE_SIZES_MM.length; i++) {
    const target = fullerCurve(SIEVE_SIZES_MM[i], tma)
    sumSq += Math.pow(blend[i] - target, 2)
  }
  return Math.sqrt(sumSq / SIEVE_SIZES_MM.length)
}

function findOptimalProportion(sandPassing: number[], stonePassing: number[], tma: number, sandMin: number, sandMax: number): { proportion: number; rms: number } {
  if (!sandPassing.length || !stonePassing.length) return { proportion: 0, rms: 999 }
  let best = { proportion: sandMin, rms: calculateRMS(sandPassing, stonePassing, sandMin, tma) }
  for (let pct = sandMin; pct <= sandMax; pct++) {
    const rms = calculateRMS(sandPassing, stonePassing, pct, tma)
    if (rms < best.rms) best = { proportion: pct, rms }
  }
  return best
}

// Convertir gramos retenidos a % pasante acumulado (MISMA LOGICA QUE MODULO DE MEZCLAS)
function getPassingFromStockpile(test: any): number[] {
  const sieveColumnMapping: Record<number, string> = {
    9.5: "sieve_9500",
    4.75: "sieve_4750",
    2.36: "sieve_2360",
    1.18: "sieve_1180",
    0.60: "sieve_600",
    0.30: "sieve_300",
    0.15: "sieve_150",
  }
  
  const totalWeight = parseFloat(test.total_sample_weight_g) || 500
  let cumulativeRetained = 0
  const passing: number[] = []
  
  for (const size of SIEVE_SIZES_MM) {
    const colName = sieveColumnMapping[size]
    const retained = colName ? (parseFloat(test[colName]) || 0) : 0
    cumulativeRetained += retained
    const passingPct = ((totalWeight - cumulativeRetained) / totalWeight) * 100
    passing.push(Math.max(0, Math.min(100, passingPct)))
  }
  
  return passing
}

// ══════════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ══════════════════════════════════════════════════════════════════════════════
interface AggregateData {
  name: string
  type: "arena" | "piedra_0_6" | "piedra_0_10"
  mf: number | null
  testDate: string | null
  testedBy: string | null
  passing: number[]
  daysSinceTest: number | null
}

interface FormulaData {
  sandKg: number
  stoneKg: number
  sandPct: number
  stonePct: number
}

export function GranulometryDashboardWidget() {
  const { selectedPlant } = usePlant()
  const [aggregates, setAggregates] = useState<AggregateData[]>([])
  const [currentFormula, setCurrentFormula] = useState<FormulaData | null>(null)
  const [loading, setLoading] = useState(true)

  const config = PLANT_CONFIG[selectedPlant || "silke"]

  useEffect(() => {
    loadData()
  }, [selectedPlant])

  async function loadData() {
    setLoading(true)
    try {
      const supabase = getSupabase()
      const dbPlant = selectedPlant === "villa-rosa" ? "villa_rosa" : selectedPlant

      // Cargar ensayos de granulometria de acopios
      const { data: stockpileData } = await supabase
        .from("stockpile_granulometry")
        .select("*")
        .eq("plant", dbPlant)
        .order("test_date", { ascending: false })

      // Cargar formula activa
      const { data: formulaData } = await supabase
        .from("paston_formulas")
        .select("sand_kg, stone_kg")
        .eq("plant", dbPlant)
        .eq("is_active", true)
        .single()

      // Procesar datos de agregados
      const now = new Date()
      const aggData: AggregateData[] = config.aggregates.map((agg) => {
        // Buscar ensayo por material_type
        // Para arena: buscar exactamente "arena"
        // Para piedra: buscar cualquier tipo de piedra (piedra_0_6 o piedra_0_10)
        const test = (stockpileData || []).find((t: any) => {
          const mt = t.material_type?.toLowerCase() || ""
          const dt = agg.dbType.toLowerCase()
          
          if (dt === "arena") {
            // Coincidencia exacta para arena
            return mt === "arena"
          } else {
            // Para piedra, buscar cualquier tipo de piedra disponible
            return mt.startsWith("piedra")
          }
        })

        if (!test) {
          return {
            name: agg.name,
            type: agg.type,
            mf: null,
            testDate: null,
            testedBy: null,
            passing: [],
            daysSinceTest: null,
          }
        }

        const testDate = new Date(test.test_date)
        const daysSince = Math.floor((now.getTime() - testDate.getTime()) / (1000 * 60 * 60 * 24))

        // Extraer pasantes - USAR MISMA LOGICA QUE MODULO DE MEZCLAS
        // Los valores sieve_XXXX son gramos retenidos, NO % pasante
        const passing = getPassingFromStockpile(test)

        // Determinar el tipo real de piedra del ensayo (puede ser diferente al esperado)
        let actualType = agg.type
        if (test.material_type?.toLowerCase().includes("piedra")) {
          actualType = test.material_type.toLowerCase().includes("0_6") ? "piedra_0_6" : "piedra_0_10"
        }

        // Nombre a mostrar basado en el tipo real
        const displayName = actualType === "arena" ? "Arena" : 
          actualType === "piedra_0_6" ? "Piedra 0/6" : "Piedra 0/10"

        return {
          name: displayName,
          type: actualType,
          mf: test.modulo_finura,
          testDate: test.test_date,
          testedBy: test.tested_by,
          passing,
          daysSinceTest: daysSince,
        }
      })

      setAggregates(aggData)

      // Procesar formula
      if (formulaData) {
        const total = (formulaData.sand_kg || 0) + (formulaData.stone_kg || 0)
        if (total > 0) {
          setCurrentFormula({
            sandKg: formulaData.sand_kg || 0,
            stoneKg: formulaData.stone_kg || 0,
            sandPct: Math.round((formulaData.sand_kg || 0) / total * 100),
            stonePct: Math.round((formulaData.stone_kg || 0) / total * 100),
          })
        }
      }
    } catch (e) {
      console.error("[v0] Error loading granulometry widget data:", e)
    }
    setLoading(false)
  }

  // Calcular RMS y formula sugerida
  // CANOS (Silke/Villa Rosa): sin restriccion de arena - optimizador puede sugerir 0% a 100%
  // ADOQUINES (Ranchos): restriccion dinamica segun contenido de finos de la piedra
  const { currentRMS, suggestedFormula, hasEnoughData } = useMemo(() => {
    const sandAgg = aggregates.find((a) => a.type === "arena")
    const stoneAgg = aggregates.find((a) => a.type !== "arena")

    if (!sandAgg?.passing.length || !stoneAgg?.passing.length || !currentFormula) {
      return { currentRMS: null, suggestedFormula: null, hasEnoughData: false }
    }

    // Calcular restriccion de arena segun planta
    let sandMin = 0
    let sandMax = 100
    
    // SOLO para Ranchos (adoquines) aplicar restriccion dinamica
    // Para canos (Silke/Villa Rosa) NO hay restriccion - el optimizador puede sugerir 0%
    if (selectedPlant === "ranchos") {
      const stonePassing236 = stoneAgg.passing[2] // indice 2 = tamiz 2.36mm
      if (stonePassing236 !== undefined) {
        if (stonePassing236 < 40) {
          sandMin = 25 // Piedra baja en finos - requiere mas arena
        } else if (stonePassing236 <= 60) {
          sandMin = 10 // Piedra moderada en finos
        } else {
          sandMin = 0 // Piedra alta en finos (>60%) - puede usar menos arena
        }
      } else {
        sandMin = 25 // Sin datos, usar defecto conservador
      }
      sandMax = 45 // Maximo para adoquines
    }
    // Para Silke y Villa Rosa (canos), sandMin=0, sandMax=100 - sin restriccion

    const currentRMS = calculateRMS(sandAgg.passing, stoneAgg.passing, currentFormula.sandPct, config.tma)
    const optimal = findOptimalProportion(sandAgg.passing, stoneAgg.passing, config.tma, sandMin, sandMax)
    const totalKg = currentFormula.sandKg + currentFormula.stoneKg

    return {
      currentRMS,
      suggestedFormula: {
        sandKg: Math.round((optimal.proportion / 100) * totalKg),
        stoneKg: Math.round(((100 - optimal.proportion) / 100) * totalKg),
        sandPct: optimal.proportion,
        stonePct: 100 - optimal.proportion,
        rms: optimal.rms,
      },
      hasEnoughData: true,
    }
  }, [aggregates, currentFormula, config.tma, selectedPlant])

  // Determinar si hay diferencia significativa
  const proportionDiff = currentFormula && suggestedFormula 
    ? Math.abs(currentFormula.sandPct - suggestedFormula.sandPct) 
    : 0
  const showAdjustWarning = proportionDiff > 10
  const showOptimalBadge = proportionDiff <= 5

  // Verificar si algun arido tiene ensayo desactualizado
  const hasOutdatedTest = aggregates.some((a) => a.daysSinceTest !== null && a.daysSinceTest > 7)
  const hasCriticallyOutdatedTest = aggregates.some((a) => a.daysSinceTest !== null && a.daysSinceTest > 15)
  const hasMissingTest = aggregates.some((a) => a.mf === null)

  if (loading) {
    return (
      <Card className="animate-pulse">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <FlaskConical className="h-4 w-4" />
            Granulometria
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-40 bg-muted rounded" />
        </CardContent>
      </Card>
    )
  }

  // Si no hay ningun ensayo cargado
  if (aggregates.every((a) => a.mf === null)) {
    return (
      <Card className="bg-muted/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <FlaskConical className="h-4 w-4" />
            Granulometria
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-center py-4">
            <AlertTriangle className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              Sin ensayos de granulometria disponibles.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Cargar ensayo en el modulo de calidad.
            </p>
          </div>
          <Link href="/calidad/granulometria/mezclas">
            <Button variant="outline" size="sm" className="w-full gap-2">
              Ver analisis completo
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </CardContent>
      </Card>
    )
  }

  // Calcular si la formula actual coincide con la sugerida
  const formulaMatch = currentFormula && suggestedFormula && 
    Math.abs(currentFormula.sandPct - suggestedFormula.sandPct) <= 5

  return (
    <div className="rounded-lg border bg-card text-card-foreground">
      {/* Header compacto */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
        <div className="flex items-center gap-1.5 text-xs font-medium">
          <FlaskConical className="h-3.5 w-3.5 text-muted-foreground" />
          <span>Granulometria</span>
          <span className="text-muted-foreground">—</span>
          <span className="text-muted-foreground">{config.product}</span>
        </div>
        <Link href="/calidad/granulometria/mezclas" className="text-[10px] text-primary hover:underline flex items-center gap-0.5">
          Ver analisis <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      
      {/* Contenido en una fila */}
      <div className="px-3 py-2 flex items-center gap-4 text-xs">
        {/* Acopios */}
        <div className="flex items-center gap-3">
          {aggregates.map((agg) => {
            const mfEval = agg.mf !== null ? getMFEvaluation(agg.type, agg.mf) : null
            const isMissing = agg.mf === null
            const isCritical = agg.daysSinceTest !== null && agg.daysSinceTest > 15
            const isOutdated = agg.daysSinceTest !== null && agg.daysSinceTest > 7
            const daysAgo = agg.daysSinceTest !== null ? (agg.daysSinceTest === 0 ? "hoy" : `hace ${agg.daysSinceTest}d`) : null

            return (
              <div key={agg.name} className="flex items-center gap-1.5">
                <span className="text-muted-foreground">{agg.name}:</span>
                {isMissing ? (
                  <span className="text-red-600 font-medium">Sin datos</span>
                ) : (
                  <>
                    <span className={`font-semibold ${
                      mfEval?.level === "green" ? "text-emerald-600" :
                      mfEval?.level === "yellow" ? "text-amber-600" :
                      mfEval?.level === "orange" ? "text-orange-600" :
                      "text-red-600"
                    }`}>
                      {agg.mf?.toFixed(2)}
                    </span>
                    <span className={`text-[10px] ${isCritical ? "text-red-500" : isOutdated ? "text-amber-500" : "text-muted-foreground"}`}>
                      ({daysAgo})
                    </span>
                  </>
                )}
              </div>
            )
          })}
        </div>

        {/* Separador */}
        <div className="h-4 w-px bg-border" />

        {/* Formula */}
        {hasEnoughData && currentFormula && suggestedFormula ? (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Formula:</span>
            <span className="font-medium">{currentFormula.sandPct}%/{currentFormula.stonePct}%</span>
            {!formulaMatch && (
              <>
                <ArrowRight className="h-3 w-3 text-amber-500" />
                <span className="font-medium text-amber-600">{suggestedFormula.sandPct}%/{suggestedFormula.stonePct}%</span>
                <span className="text-[10px] text-amber-500">(sugerido)</span>
              </>
            )}
            {formulaMatch && (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            )}
          </div>
        ) : (
          <span className="text-muted-foreground">Sin datos para calcular formula</span>
        )}
      </div>
    </div>
  )
}
