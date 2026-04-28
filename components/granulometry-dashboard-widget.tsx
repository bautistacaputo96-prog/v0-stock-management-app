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

        // Extraer pasantes
        const passing = [
          test.sieve_9500 ?? 100,
          test.sieve_4750 ?? 100,
          test.sieve_2360 ?? 100,
          test.sieve_1180 ?? 100,
          test.sieve_600 ?? 100,
          test.sieve_300 ?? 100,
          test.sieve_150 ?? 100,
        ].map((v: number) => {
          if (test.total_sample_weight_g && test.total_sample_weight_g > 0) {
            // Si los valores son pesos retenidos, convertir a % pasante acumulado
            // Asumimos que ya estan como % pasante si son <= 100
            return v > 100 ? 100 : v
          }
          return v
        })

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
  const { currentRMS, suggestedFormula, hasEnoughData } = useMemo(() => {
    const sandAgg = aggregates.find((a) => a.type === "arena")
    const stoneAgg = aggregates.find((a) => a.type !== "arena")

    if (!sandAgg?.passing.length || !stoneAgg?.passing.length || !currentFormula) {
      return { currentRMS: null, suggestedFormula: null, hasEnoughData: false }
    }

    const currentRMS = calculateRMS(sandAgg.passing, stoneAgg.passing, currentFormula.sandPct, config.tma)
    const optimal = findOptimalProportion(sandAgg.passing, stoneAgg.passing, config.tma, 0, 100)
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
  }, [aggregates, currentFormula, config.tma])

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

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <FlaskConical className="h-4 w-4" />
          Granulometria - {config.product}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* SECCION 1: Estado de acopios */}
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Estado de Acopios</div>
          {aggregates.map((agg) => {
            const mfEval = agg.mf !== null ? getMFEvaluation(agg.type, agg.mf) : null
            const isOutdated = agg.daysSinceTest !== null && agg.daysSinceTest > 7
            const isCritical = agg.daysSinceTest !== null && agg.daysSinceTest > 15
            const isMissing = agg.mf === null

            return (
              <div
                key={agg.name}
                className={`flex items-center justify-between p-2 rounded-lg border ${
                  isMissing ? "bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-900" :
                  isCritical ? "bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-900" :
                  isOutdated ? "bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-900" :
                  "bg-card border-border"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{agg.name}</span>
                  {mfEval && (
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${
                        mfEval.level === "green" ? "bg-emerald-100 text-emerald-700 border-emerald-300" :
                        mfEval.level === "yellow" ? "bg-amber-100 text-amber-700 border-amber-300" :
                        mfEval.level === "orange" ? "bg-orange-100 text-orange-700 border-orange-300" :
                        "bg-red-100 text-red-700 border-red-300"
                      }`}
                    >
                      MF {agg.mf?.toFixed(2)}
                    </Badge>
                  )}
                </div>
                <div className="text-right">
                  {isMissing ? (
                    <span className="text-xs text-red-600 font-medium">Sin ensayo disponible</span>
                  ) : (
                    <>
                      <div className={`text-xs flex items-center gap-1 ${isCritical ? "text-red-600" : isOutdated ? "text-amber-600" : "text-muted-foreground"}`}>
                        <Clock className="h-3 w-3" />
                        {agg.testDate ? new Date(agg.testDate).toLocaleDateString("es-AR") : "-"}
                      </div>
                      {agg.testedBy && (
                        <div className="text-[10px] text-muted-foreground flex items-center gap-1 justify-end">
                          <User className="h-2.5 w-2.5" />
                          {agg.testedBy}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )
          })}
          
          {/* Alertas de ensayo desactualizado */}
          {hasCriticallyOutdatedTest && (
            <div className="text-xs text-red-600 bg-red-50 dark:bg-red-950/30 p-2 rounded border border-red-200">
              Sin ensayo reciente - actualizar antes de producir.
            </div>
          )}
          {hasOutdatedTest && !hasCriticallyOutdatedTest && (
            <div className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/30 p-2 rounded border border-amber-200">
              Ensayo desactualizado - se recomienda nuevo muestreo.
            </div>
          )}
        </div>

        {/* SECCION 2: Formula actual vs sugerida */}
        {hasEnoughData && currentFormula && suggestedFormula ? (
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Formula Actual vs Sugerida</div>
            <div className={`grid grid-cols-2 gap-2 p-2 rounded-lg border ${
              showOptimalBadge ? "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-900" :
              showAdjustWarning ? "bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-900" :
              "bg-card border-border"
            }`}>
              {/* Columna actual */}
              <div className="space-y-1">
                <div className="text-[10px] font-medium text-muted-foreground uppercase">Actual</div>
                <div className="text-sm">
                  <span className="font-semibold">{currentFormula.sandKg}</span>
                  <span className="text-muted-foreground text-xs"> kg arena</span>
                </div>
                <div className="text-sm">
                  <span className="font-semibold">{currentFormula.stoneKg}</span>
                  <span className="text-muted-foreground text-xs"> kg piedra</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {currentFormula.sandPct}% / {currentFormula.stonePct}%
                </div>
                {currentRMS !== null && (
                  <div className="text-xs">
                    RMS: <span className="font-mono font-medium">{currentRMS.toFixed(1)}</span>
                  </div>
                )}
              </div>

              {/* Columna sugerida */}
              <div className="space-y-1">
                <div className="text-[10px] font-medium text-muted-foreground uppercase">Sugerida</div>
                <div className="text-sm">
                  <span className="font-semibold">{suggestedFormula.sandKg}</span>
                  <span className="text-muted-foreground text-xs"> kg arena</span>
                </div>
                <div className="text-sm">
                  <span className="font-semibold">{suggestedFormula.stoneKg}</span>
                  <span className="text-muted-foreground text-xs"> kg piedra</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {suggestedFormula.sandPct}% / {suggestedFormula.stonePct}%
                </div>
                <div className="text-xs">
                  RMS: <span className="font-mono font-medium">{suggestedFormula.rms.toFixed(1)}</span>
                </div>
              </div>
            </div>

            {/* Mensaje de estado */}
            {showOptimalBadge && (
              <div className="flex items-center gap-1 text-xs text-emerald-600">
                <CheckCircle2 className="h-3 w-3" />
                Proporcion actual optima.
              </div>
            )}
            {showAdjustWarning && (
              <div className="flex items-center gap-1 text-xs text-amber-600">
                <AlertTriangle className="h-3 w-3" />
                Ajuste de proporcion recomendado.
              </div>
            )}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
            Sin datos suficientes para sugerir formula.
          </div>
        )}

        {/* SECCION 3: Acceso rapido */}
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
