"use client"

import { useState, useEffect, useMemo } from "react"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  ScatterChart,
  Scatter,
  ReferenceLine,
  Cell,
  Legend,
  Area,
  AreaChart,
  ComposedChart,
} from "recharts"
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  TrendingUp,
  TrendingDown,
  Info,
  Calendar,
  Beaker,
  Activity,
  Target,
  Lightbulb,
} from "lucide-react"
import { DateRangeFilter } from "./date-range-filter"

interface Plant {
  id: string
  code: string
  name: string
}

interface TestCylinder {
  id: string
  dispatch_id: string
  cylinder_number: number
  test_age_days: number
  scheduled_test_date: string
  actual_test_date: string | null
  dial_reading: number | null
  strength_mpa: number | null
  weight_grams: number | null
  comments: string | null
  dispatch: {
    remito: string | null
    dispatch_date: string
    sample_number: string | null
    actual_slump_cm: number | null
    extra_water_liters: number | null
    obra: string | null
    client: string | null
    formula: {
      code: string
      name: string
      plant_id: string
    } | null
    client_rel: { name: string } | null
    construction_site: { name: string } | null
  } | null
}

interface GranulometriaTest {
  id: string
  extraction_date: string
  provider: string
  aggregate_type: string
  fineness_modulus: number | null
  plant_id: string | null
}

interface QualityAnalysisDashboardProps {
  plants: Plant[]
  selectedPlantId: string
}

// Helper function to calculate standard deviation
function calculateStdDev(values: number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2))
  const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / (values.length - 1)
  return Math.sqrt(avgSquaredDiff)
}

// Calculate f'cr based on CIRSOC 201:2005
function calculateFcr(fc: number, stdDev: number | null): number {
  if (stdDev === null || stdDev === 0) {
    // Without std dev data - use Table 5
    if (fc < 21) return fc + 7.0
    if (fc <= 35) return fc + 8.5
    return 1.10 * fc + 5.0
  }
  // With std dev - use equations 5-1 and 5-2
  const fcr1 = fc + 1.34 * stdDev
  const fcr2 = fc <= 35 ? fc + 2.33 * stdDev - 3.5 : 0.90 * fc + 2.33 * stdDev
  return Math.max(fcr1, fcr2)
}

// Get f'c value from formula code (H-17, H-21, H-25, H-30)
function getFcFromFormulaCode(code: string): number {
  const match = code.match(/H-?(\d+)/i)
  if (match) {
    return parseInt(match[1])
  }
  return 0
}

// Generate normal distribution curve data
function generateNormalCurve(mean: number, stdDev: number, min: number, max: number): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = []
  const step = (max - min) / 100
  for (let x = min; x <= max; x += step) {
    const y = (1 / (stdDev * Math.sqrt(2 * Math.PI))) * 
              Math.exp(-0.5 * Math.pow((x - mean) / stdDev, 2))
    points.push({ x, y })
  }
  return points
}

export function QualityAnalysisDashboard({ plants, selectedPlantId: initialPlantId }: QualityAnalysisDashboardProps) {
  const [selectedPlantId, setSelectedPlantId] = useState(initialPlantId)
  const [cylinders, setCylinders] = useState<TestCylinder[]>([])
  const [granulometriaTests, setGranulometriaTests] = useState<GranulometriaTest[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedFormulaType, setSelectedFormulaType] = useState<string>("all")
  const [selectedFormulaCode, setSelectedFormulaCode] = useState<string>("all")
  const [quantileType, setQuantileType] = useState<"10" | "5">("10") // 10% CIRSOC 201:2005, 5% for older
  const [dateRange, setDateRange] = useState<{ from: string; to: string }>({
    from: new Date(new Date().setFullYear(new Date().getFullYear() - 5)).toISOString().split("T")[0],
    to: new Date().toISOString().split("T")[0],
  })

  // Load data
  useEffect(() => {
    async function loadData() {
      setLoading(true)
      const supabase = createClient()
      if (!supabase) {
        setLoading(false)
        return
      }

  // Load test cylinders with dispatch info
  let cylindersQuery = supabase
    .from("test_cylinders")
    .select(`
      *,
      dispatch:dispatches(
        remito,
        dispatch_date,
        sample_number,
        actual_slump_cm,
        extra_water_liters,
        obra,
        client,
        formula:formulas(code, name, plant_id),
        client_rel:clients(name),
        construction_site:construction_sites(name)
      )
    `)
    .not("strength_mpa", "is", null)
    .order("actual_test_date", { ascending: false })

      // Load granulometria tests
      let granulometriaQuery = supabase
        .from("granulometria_tests")
        .select("*")
        .not("fineness_modulus", "is", null)
        .order("extraction_date", { ascending: false })

      if (selectedPlantId !== "all") {
        granulometriaQuery = granulometriaQuery.eq("plant_id", selectedPlantId)
      }

      const [cylindersResult, granulometriaResult] = await Promise.all([
        cylindersQuery,
        granulometriaQuery,
      ])

      if (cylindersResult.data) {
        // Filter by plant if needed
        let filtered = cylindersResult.data as TestCylinder[]
        if (selectedPlantId !== "all") {
          filtered = filtered.filter(c => c.dispatch?.formula?.plant_id === selectedPlantId)
        }
        setCylinders(filtered)
      }

      if (granulometriaResult.data) {
        setGranulometriaTests(granulometriaResult.data)
      }

      setLoading(false)
    }

    loadData()
  }, [selectedPlantId])

  // Get unique formula types from data
  const formulaTypes = useMemo(() => {
    const types = new Set<string>()
    cylinders.forEach(c => {
      if (c.dispatch?.formula?.code) {
        const match = c.dispatch.formula.code.match(/H-?\d+/i)
        if (match) types.add(match[0].toUpperCase())
      }
    })
    return Array.from(types).sort()
  }, [cylinders])

  // Get unique formula codes from data
  const formulaCodes = useMemo(() => {
    const codes = new Set<string>()
    cylinders.forEach(c => {
      if (c.dispatch?.formula?.code) {
        codes.add(c.dispatch.formula.code)
      }
    })
    return Array.from(codes).sort()
  }, [cylinders])

  // Filter cylinders by date range, formula type and formula code
  const filteredCylinders = useMemo(() => {
    return cylinders.filter(c => {
      // Date filter
      if (c.actual_test_date) {
        const testDate = new Date(c.actual_test_date)
        const fromDate = dateRange.from ? new Date(dateRange.from) : null
        const toDate = dateRange.to ? new Date(dateRange.to) : null
        if (fromDate && testDate < fromDate) return false
        if (toDate && testDate > toDate) return false
      }
      // Formula type filter
      if (selectedFormulaType !== "all" && c.dispatch?.formula?.code) {
        const match = c.dispatch.formula.code.match(/H-?\d+/i)
        if (!match || match[0].toUpperCase() !== selectedFormulaType.toUpperCase()) return false
      }
      // Formula code filter
      if (selectedFormulaCode !== "all" && c.dispatch?.formula?.code !== selectedFormulaCode) {
        return false
      }
      return true
    })
  }, [cylinders, dateRange, selectedFormulaType, selectedFormulaCode])

  // Get 28-day results only for statistical analysis
  const results28Days = useMemo(() => {
    return filteredCylinders
      .filter(c => c.test_age_days === 28 && c.strength_mpa !== null)
      .map(c => ({
        ...c,
        strength: c.strength_mpa!,
        date: c.actual_test_date || c.scheduled_test_date,
        formulaCode: c.dispatch?.formula?.code || "N/A",
        slump: c.dispatch?.actual_slump_cm || null,
        extraWater: c.dispatch?.extra_water_liters || null,
        // Use direct field first, then relation
        constructionSite: c.dispatch?.obra || c.dispatch?.construction_site?.name || null,
        client: c.dispatch?.client || c.dispatch?.client_rel?.name || null,
        comments: c.comments || null,
      }))
  }, [filteredCylinders])

  // Get 7-day results
  const results7Days = useMemo(() => {
    return filteredCylinders
      .filter(c => c.test_age_days === 7 && c.strength_mpa !== null)
      .map(c => ({
        ...c,
        strength: c.strength_mpa!,
        date: c.actual_test_date || c.scheduled_test_date,
        sampleNumber: c.dispatch?.sample_number,
      }))
  }, [filteredCylinders])

  // Calculate statistics for 28-day results
  const stats = useMemo(() => {
    const strengths = results28Days.map(r => r.strength)
    if (strengths.length === 0) {
      return {
        fcm: 0,
        stdDev: 0,
        cv: 0,
        fck: 0,
        fc: selectedFormulaType !== "all" ? getFcFromFormulaCode(selectedFormulaType) : 0,
        fcr: 0,
        count: 0,
        min: 0,
        max: 0,
      }
    }

    const fcm = strengths.reduce((a, b) => a + b, 0) / strengths.length
    const stdDev = calculateStdDev(strengths)
    const cv = fcm > 0 ? (stdDev / fcm) * 100 : 0
    const k = quantileType === "10" ? 1.28 : 1.65
    const fck = fcm - k * stdDev
    const fc = selectedFormulaType !== "all" ? getFcFromFormulaCode(selectedFormulaType) : 0
    const fcr = calculateFcr(fc, strengths.length >= 30 ? stdDev : null)

    return {
      fcm: Math.round(fcm * 10) / 10,
      stdDev: Math.round(stdDev * 100) / 100,
      cv: Math.round(cv * 10) / 10,
      fck: Math.round(fck * 10) / 10,
      fc,
      fcr: Math.round(fcr * 10) / 10,
      count: strengths.length,
      min: Math.min(...strengths),
      max: Math.max(...strengths),
    }
  }, [results28Days, selectedFormulaType, quantileType])

  // Calculate histogram data with Gaussian curve
  const histogramData = useMemo(() => {
    if (results28Days.length === 0) return []
    
    const strengths = results28Days.map(r => r.strength)
    const min = Math.floor(Math.min(...strengths) / 2) * 2
    const max = Math.ceil(Math.max(...strengths) / 2) * 2
    const binSize = 2 // 2 MPa bins
    const bins: { range: string; count: number; midpoint: number; belowFc: boolean; gaussian: number }[] = []
    
    // Calculate mean and std for Gaussian
    const mean = strengths.reduce((a, b) => a + b, 0) / strengths.length
    const variance = strengths.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / strengths.length
    const std = Math.sqrt(variance)
    
    // Normal distribution function
    const normalPDF = (x: number) => {
      const exponent = -Math.pow(x - mean, 2) / (2 * variance)
      return (1 / (std * Math.sqrt(2 * Math.PI))) * Math.exp(exponent)
    }
    
    // Scale factor to match histogram (bin width * total count)
    const scaleFactor = binSize * strengths.length
    
    for (let i = min; i < max; i += binSize) {
      const count = strengths.filter(s => s >= i && s < i + binSize).length
      const midpoint = i + binSize / 2
      bins.push({
        range: `${i}-${i + binSize}`,
        count,
        midpoint,
        belowFc: stats.fc > 0 && midpoint < stats.fc,
        gaussian: normalPDF(midpoint) * scaleFactor,
      })
    }
    
    return bins
  }, [results28Days, stats.fc])

  // Calculate moving average for temporal chart
  const temporalData = useMemo(() => {
    const sorted = [...results28Days].sort((a, b) => 
      new Date(a.date).getTime() - new Date(b.date).getTime()
    )
    
    return sorted.map((r, idx) => {
      // Calculate 5-point moving average
      const windowSize = 5
      const start = Math.max(0, idx - windowSize + 1)
      const window = sorted.slice(start, idx + 1)
      const movingAvg = window.reduce((sum, w) => sum + w.strength, 0) / window.length
      
      // Calculate 3-point moving average for CIRSOC compliance
      const window3 = sorted.slice(Math.max(0, idx - 2), idx + 1)
      const movingAvg3 = window3.reduce((sum, w) => sum + w.strength, 0) / window3.length
      
    return {
      date: new Date(r.date).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" }),
      fullDate: r.date,
      strength: r.strength,
      movingAvg: Math.round(movingAvg * 10) / 10,
      movingAvg3: Math.round(movingAvg3 * 10) / 10,
      sampleNumber: r.dispatch?.sample_number,
      formulaCode: r.formulaCode,
      slump: r.slump,
      extraWater: r.extraWater,
      constructionSite: r.constructionSite,
      client: r.client,
      comments: r.comments,
    }
    })
  }, [results28Days])

  // Calculate 7/28 day correlation data
  const correlationData = useMemo(() => {
    const pairs: { strength7: number; strength28: number; sampleNumber: string }[] = []
    
    results7Days.forEach(r7 => {
      const matching28 = results28Days.find(r28 => 
        r28.dispatch?.sample_number && 
        r28.dispatch.sample_number === r7.sampleNumber
      )
      if (matching28) {
        pairs.push({
          strength7: r7.strength,
          strength28: matching28.strength,
          sampleNumber: r7.sampleNumber || "",
        })
      }
    })
    
    return pairs
  }, [results7Days, results28Days])

  // Calculate linear regression for correlation
  const correlation = useMemo(() => {
    if (correlationData.length < 3) {
      return { slope: 0, intercept: 0, r2: 0, ratio: 0 }
    }
    
    const n = correlationData.length
    const sumX = correlationData.reduce((sum, p) => sum + p.strength7, 0)
    const sumY = correlationData.reduce((sum, p) => sum + p.strength28, 0)
    const sumXY = correlationData.reduce((sum, p) => sum + p.strength7 * p.strength28, 0)
    const sumX2 = correlationData.reduce((sum, p) => sum + p.strength7 * p.strength7, 0)
    const sumY2 = correlationData.reduce((sum, p) => sum + p.strength28 * p.strength28, 0)
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)
    const intercept = (sumY - slope * sumX) / n
    
    // Calculate R²
    const meanY = sumY / n
    const ssTotal = correlationData.reduce((sum, p) => sum + Math.pow(p.strength28 - meanY, 2), 0)
    const ssResidual = correlationData.reduce((sum, p) => {
      const predicted = slope * p.strength7 + intercept
      return sum + Math.pow(p.strength28 - predicted, 2)
    }, 0)
    const r2 = 1 - ssResidual / ssTotal
    
    // Calculate average R7/R28 ratio
    const ratio = sumX / sumY
    
    return {
      slope: Math.round(slope * 100) / 100,
      intercept: Math.round(intercept * 10) / 10,
      r2: Math.round(r2 * 1000) / 1000,
      ratio: Math.round(ratio * 100) / 100,
    }
  }, [correlationData])

  // Slump (asentamiento) analysis
  const slumpData = useMemo(() => {
    return results28Days
      .filter(r => r.slump !== null)
      .map(r => ({
        date: new Date(r.date).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" }),
        slump: r.slump,
        strength: r.strength,
        formulaCode: r.formulaCode,
      }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
  }, [results28Days])

  // Granulometry MF evolution
  const mfEvolution = useMemo(() => {
    return granulometriaTests
      .filter(t => {
        const testDate = new Date(t.extraction_date)
        const fromDate = dateRange.from ? new Date(dateRange.from) : null
        const toDate = dateRange.to ? new Date(dateRange.to) : null
        if (fromDate && testDate < fromDate) return false
        if (toDate && testDate > toDate) return false
        return true
      })
      .map(t => ({
        date: new Date(t.extraction_date).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" }),
        fullDate: t.extraction_date,
        mf: t.fineness_modulus,
        type: t.aggregate_type,
        provider: t.provider,
      }))
      .sort((a, b) => new Date(a.fullDate).getTime() - new Date(b.fullDate).getTime())
  }, [granulometriaTests, dateRange])

  // CIRSOC compliance semaphore
  const compliance = useMemo(() => {
    if (temporalData.length === 0) {
      return {
        condition1: { status: "neutral" as const, value: 0 },
        condition2: { status: "neutral" as const, value: 0 },
        cvStatus: { status: "neutral" as const, value: 0 },
      }
    }

    const fc = stats.fc
    const lastThree = temporalData.slice(-3)
    const fcm3 = lastThree.length > 0 
      ? lastThree.reduce((sum, t) => sum + t.strength, 0) / lastThree.length 
      : 0
    const minStrength = Math.min(...results28Days.map(r => r.strength))

    // Condition 1 - Moving average of last 3 tests
    let condition1Status: "green" | "yellow" | "red" | "neutral" = "neutral"
    if (fc > 0) {
      if (fcm3 >= fc + 5) condition1Status = "green"
      else if (fcm3 >= fc) condition1Status = "yellow"
      else condition1Status = "red"
    }

    // Condition 2 - Lowest individual result
    let condition2Status: "green" | "yellow" | "red" | "neutral" = "neutral"
    if (fc > 0) {
      if (minStrength >= fc) condition2Status = "green"
      else if (minStrength >= fc - 2) condition2Status = "yellow"
      else condition2Status = "red"
    }

    // CV status
    let cvStatus: "green" | "yellow" | "red" | "neutral" = "neutral"
    if (stats.cv > 0) {
      if (stats.cv < 10) cvStatus = "green"
      else if (stats.cv <= 15) cvStatus = "yellow"
      else cvStatus = "red"
    }

    return {
      condition1: { status: condition1Status, value: Math.round(fcm3 * 10) / 10 },
      condition2: { status: condition2Status, value: Math.round(minStrength * 10) / 10 },
      cvStatus: { status: cvStatus, value: stats.cv },
    }
  }, [temporalData, stats, results28Days])

  // Generate automatic suggestions
  const suggestions = useMemo(() => {
    const suggestionsList: { type: "warning" | "info" | "success"; message: string }[] = []

    if (stats.count === 0) return suggestionsList

    // f'ck vs f'c comparison
    if (stats.fc > 0 && stats.fck < stats.fc) {
      const diff = Math.round((stats.fc - stats.fck) * 10) / 10
      suggestionsList.push({
        type: "warning",
        message: `La resistencia caracteristica calculada (${stats.fck} MPa) esta ${diff} MPa por debajo del valor especificado f'c = ${stats.fc} MPa. Se recomienda revisar la relacion agua/cemento y verificar la dosificacion.`,
      })
    }

    // CV analysis
    if (stats.cv > 0) {
      if (stats.cv < 10) {
        suggestionsList.push({
          type: "success",
          message: `El coeficiente de variacion es ${stats.cv}%, lo que indica un proceso excelente con muy buena uniformidad en la produccion.`,
        })
      } else if (stats.cv <= 15) {
        suggestionsList.push({
          type: "info",
          message: `El coeficiente de variacion es ${stats.cv}%, lo que indica un proceso aceptable. Mantener el control de dosificacion y materiales.`,
        })
      } else {
        suggestionsList.push({
          type: "warning",
          message: `El coeficiente de variacion es ${stats.cv}%, lo que indica variabilidad excesiva. Revisar uniformidad de materiales, dosificacion, procedimientos de moldeo y curado de probetas.`,
        })
      }
    }

    // Results below f'c
    if (stats.fc > 0) {
      const belowFc = results28Days.filter(r => r.strength < stats.fc).length
      if (belowFc > 0) {
        suggestionsList.push({
          type: "warning",
          message: `Se detectaron ${belowFc} resultados por debajo de f'c = ${stats.fc} MPa. Verificar el protocolo de curado y moldeo de probetas.`,
        })
      }
    }

    // 7/28 correlation
    if (correlationData.length >= 5) {
      const reliabilityText = correlation.r2 >= 0.85 ? "confiable" : "poco confiable"
      suggestionsList.push({
        type: correlation.r2 >= 0.85 ? "info" : "warning",
        message: `La correlacion R7/R28 de su planta es ${correlation.ratio}. Los resultados a 7 dias son un predictor ${reliabilityText} de los resultados a 28 dias (R² = ${correlation.r2}).`,
      })
    }

    // MF variation in granulometry
    if (mfEvolution.length >= 2) {
      const lastTwo = mfEvolution.slice(-2)
      if (lastTwo[0].mf && lastTwo[1].mf) {
        const mfDiff = Math.abs(lastTwo[1].mf - lastTwo[0].mf)
        if (mfDiff > 0.2) {
          suggestionsList.push({
            type: "warning",
            message: `Se detecto una variacion significativa en el Modulo de Finura de ${lastTwo[1].type} (${mfDiff.toFixed(2)}). Revisar proveedor o ajustar dosificacion de agua.`,
          })
        }
      }
    }

    return suggestionsList
  }, [stats, results28Days, correlationData, correlation, mfEvolution])

  const getStatusColor = (status: "green" | "yellow" | "red" | "neutral") => {
    switch (status) {
      case "green": return "bg-green-500"
      case "yellow": return "bg-yellow-500"
      case "red": return "bg-red-500"
      default: return "bg-gray-300"
    }
  }

  const getStatusBadge = (status: "green" | "yellow" | "red" | "neutral") => {
    switch (status) {
      case "green": return <Badge className="bg-green-500 text-white">Conforme</Badge>
      case "yellow": return <Badge className="bg-yellow-500 text-black">Atencion</Badge>
      case "red": return <Badge className="bg-red-500 text-white">No conforme</Badge>
      default: return <Badge variant="outline">Sin datos</Badge>
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Filtros en una sola línea */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1">
              <Label className="text-xs">Planta</Label>
              <Select value={selectedPlantId} onValueChange={setSelectedPlantId}>
                <SelectTrigger className="w-[160px] h-9">
                  <SelectValue placeholder="Planta" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {plants.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Tipo</Label>
              <Select value={selectedFormulaType} onValueChange={(v) => { setSelectedFormulaType(v); setSelectedFormulaCode("all") }}>
                <SelectTrigger className="w-[100px] h-9">
                  <SelectValue placeholder="Tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {formulaTypes.map(t => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Codigo</Label>
              <Select value={selectedFormulaCode} onValueChange={setSelectedFormulaCode}>
                <SelectTrigger className="w-[180px] h-9">
                  <SelectValue placeholder="Codigo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los codigos</SelectItem>
                  {formulaCodes
                    .filter(c => selectedFormulaType === "all" || c.match(new RegExp(selectedFormulaType, "i")))
                    .map(c => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Normativa</Label>
              <Select value={quantileType} onValueChange={(v) => setQuantileType(v as "10" | "5")}>
                <SelectTrigger className="w-[220px] h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">CIRSOC/ACI (10% - K=1.28)</SelectItem>
                  <SelectItem value="5">Eurocode/Anterior (5% - K=1.65)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <DateRangeFilter
              dateFrom={dateRange.from}
              dateTo={dateRange.to}
              onDateFromChange={(v) => setDateRange(prev => ({ ...prev, from: v }))}
              onDateToChange={(v) => setDateRange(prev => ({ ...prev, to: v }))}
            />
          </div>
        </CardContent>
      </Card>

      {/* Panel Principal - Estadísticas Clave */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {/* Cantidad de Muestras - MUY IMPORTANTE */}
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="pt-4 pb-4">
            <div className="text-center">
              <div className="text-4xl font-bold text-primary">{stats.count}</div>
              <div className="text-sm text-muted-foreground mt-1">Muestras Analizadas</div>
            </div>
          </CardContent>
        </Card>

        {/* Resistencia Característica f'ck */}
        <Card className={stats.fck >= stats.fc ? "bg-green-50 border-green-200" : "bg-orange-50 border-orange-200"}>
          <CardContent className="pt-4 pb-4">
            <div className="text-center">
              <div className={`text-4xl font-bold ${stats.fck >= stats.fc ? "text-green-600" : "text-orange-600"}`}>
                {stats.fck}
              </div>
              <div className="text-sm text-muted-foreground mt-1">f&apos;ck (MPa)</div>
              <div className="text-xs text-muted-foreground">Resistencia Caracteristica</div>
            </div>
          </CardContent>
        </Card>

        {/* Resistencia Media f'cm */}
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="text-center">
              <div className="text-4xl font-bold text-blue-600">{stats.fcm}</div>
              <div className="text-sm text-muted-foreground mt-1">f&apos;cm (MPa)</div>
              <div className="text-xs text-muted-foreground">Resistencia Media</div>
            </div>
          </CardContent>
        </Card>

        {/* Desviación Estándar */}
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="text-center">
              <div className="text-4xl font-bold">{stats.stdDev}</div>
              <div className="text-sm text-muted-foreground mt-1">s (MPa)</div>
              <div className="text-xs text-muted-foreground">Desviacion Estandar</div>
            </div>
          </CardContent>
        </Card>

        {/* Coeficiente de Variación */}
        <Card className={stats.cv < 10 ? "bg-green-50 border-green-200" : stats.cv <= 15 ? "bg-yellow-50 border-yellow-200" : "bg-red-50 border-red-200"}>
          <CardContent className="pt-4 pb-4">
            <div className="text-center">
              <div className={`text-4xl font-bold ${stats.cv < 10 ? "text-green-600" : stats.cv <= 15 ? "text-yellow-600" : "text-red-600"}`}>
                {stats.cv}%
              </div>
              <div className="text-sm text-muted-foreground mt-1">CV</div>
              <div className="text-xs text-muted-foreground">
                {stats.cv < 10 ? "Excelente" : stats.cv <= 15 ? "Aceptable" : "Revisar"}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Info secundaria compacta */}
      {stats.fc > 0 && (
        <div className="flex flex-wrap gap-6 text-sm text-muted-foreground px-1">
          <span>f&apos;c especificada: <strong className="text-foreground">{stats.fc} MPa</strong></span>
          <span>Minimo individual aceptable: <strong className="text-foreground">{(stats.fc - 3.5).toFixed(1)} MPa</strong></span>
        </div>
      )}

      {/* Charts Tabs */}
      <Tabs defaultValue="histogram" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 lg:grid-cols-5">
          <TabsTrigger value="histogram">Distribucion</TabsTrigger>
          <TabsTrigger value="temporal">Evolucion</TabsTrigger>
          <TabsTrigger value="correlation">Correlacion 7/28</TabsTrigger>
          <TabsTrigger value="slump">Asentamiento</TabsTrigger>
          <TabsTrigger value="granulometry">Granulometria</TabsTrigger>
        </TabsList>

        {/* Histogram + Normal Curve */}
        <TabsContent value="histogram">
          <Card>
            <CardHeader>
              <CardTitle>Distribucion de Frecuencias - Resistencia a 28 dias (Campana de Gauss)</CardTitle>
              <CardDescription>
                Histograma con curva de distribucion normal superpuesta. La linea roja muestra la curva de Gauss teorica basada en la media y desviacion estandar de los datos.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {histogramData.length > 0 ? (
                <ResponsiveContainer width="100%" height={400}>
                  <ComposedChart data={histogramData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis 
                      dataKey="midpoint" 
                      label={{ value: "Resistencia (MPa)", position: "bottom", offset: 0 }}
                    />
                    <YAxis 
                      yAxisId="left"
                      label={{ value: "Frecuencia", angle: -90, position: "insideLeft" }}
                    />
                    <Tooltip 
                      formatter={(value: number, name: string) => {
                        if (name === "count") return [value, "Cantidad"]
                        return [value, name]
                      }}
                      labelFormatter={(label) => `${label} MPa`}
                    />
                    <Legend />
                    <Bar yAxisId="left" dataKey="count" name="Frecuencia" radius={[4, 4, 0, 0]}>
                      {histogramData.map((entry, index) => (
                        <Cell 
                          key={`cell-${index}`} 
                          fill={entry.belowFc ? "#ef4444" : "#3b82f6"} 
                          fillOpacity={0.7}
                        />
                      ))}
                    </Bar>
                    {/* Gaussian/Normal Distribution Curve */}
                    <Line 
                      yAxisId="left"
                      type="monotone" 
                      dataKey="gaussian" 
                      name="Curva de Gauss" 
                      stroke="#dc2626" 
                      strokeWidth={3}
                      dot={false}
                      legendType="line"
                    />
                    {/* Reference lines */}
                    {stats.fc > 0 && (
                      <ReferenceLine 
                        yAxisId="left"
                        x={stats.fc} 
                        stroke="#dc2626" 
                        strokeWidth={3}
                        label={{ value: `f'c=${stats.fc} MPa`, position: "top", fill: "#dc2626", fontWeight: "bold", fontSize: 12 }}
                      />
                    )}
                    {stats.fck > 0 && (
                      <ReferenceLine 
                        yAxisId="left"
                        x={stats.fck} 
                        stroke="#f97316" 
                        strokeWidth={2}
                        strokeDasharray="8 4"
                        label={{ value: `f'ck=${stats.fck}`, position: "insideTopRight", fill: "#f97316", fontSize: 11 }}
                      />
                    )}
                    <ReferenceLine 
                      yAxisId="left"
                      x={stats.fcm} 
                      stroke="#22c55e" 
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      label={{ value: `f'cm=${stats.fcm}`, position: "top", fill: "#22c55e", fontSize: 11 }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[400px] text-muted-foreground">
                  No hay datos suficientes para mostrar el histograma
                </div>
              )}
              <div className="flex flex-wrap gap-6 mt-4 justify-center text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-1 bg-red-600 rounded" />
                  <span>f&apos;c especificada ({stats.fc} MPa)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-0.5 bg-orange-500 rounded" style={{ borderTop: "2px dashed #f97316" }} />
                  <span>f&apos;ck calculada ({stats.fck} MPa)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-0.5 bg-green-500 rounded" style={{ borderTop: "2px dashed #22c55e" }} />
                  <span>f&apos;cm media ({stats.fcm} MPa)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-1 bg-red-600 rounded" />
                  <span>Curva de Gauss</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Temporal Evolution */}
        <TabsContent value="temporal">
          <Card>
            <CardHeader>
              <CardTitle>Evolucion Temporal de Resistencia</CardTitle>
              <CardDescription>
                Resultados individuales con media movil de 5 ensayos
              </CardDescription>
            </CardHeader>
            <CardContent>
              {temporalData.length > 0 ? (
                <ResponsiveContainer width="100%" height={400}>
                  <ComposedChart data={temporalData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis 
                      dataKey="date" 
                      angle={-45}
                      textAnchor="end"
                      height={60}
                      label={{ value: "Fecha de rotura", position: "bottom", offset: 40 }}
                    />
                    <YAxis 
                      domain={["auto", "auto"]}
                      label={{ value: "Resistencia (MPa)", angle: -90, position: "insideLeft" }}
                    />
                    <Tooltip 
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0].payload
                          return (
                            <div className="bg-background border rounded-lg p-3 shadow-lg min-w-[200px]">
                              <p className="font-semibold text-base border-b pb-1 mb-2">{data.sampleNumber || "Sin ID"}</p>
                              <div className="space-y-1 text-sm">
                                <p><span className="text-muted-foreground">Fecha:</span> {data.date}</p>
                                <p><span className="text-muted-foreground">Resistencia:</span> <strong>{data.strength} MPa</strong></p>
                                <p><span className="text-muted-foreground">Media movil:</span> {data.movingAvg} MPa</p>
                                {data.formulaCode && <p><span className="text-muted-foreground">Formula:</span> {data.formulaCode}</p>}
                                {data.constructionSite && <p><span className="text-muted-foreground">Obra:</span> {data.constructionSite}</p>}
                                {data.client && <p><span className="text-muted-foreground">Cliente:</span> {data.client}</p>}
                                {data.slump && <p><span className="text-muted-foreground">Asentamiento:</span> {data.slump} cm</p>}
                                {data.extraWater !== null && data.extraWater > 0 && (
                                  <p className="text-orange-600"><span className="text-muted-foreground">Agua extra:</span> {data.extraWater} L</p>
                                )}
                                {data.comments && (
                                  <p className="text-blue-600 italic"><span className="text-muted-foreground">Comentario:</span> {data.comments}</p>
                                )}
                              </div>
                            </div>
                          )
                        }
                        return null
                      }}
                    />
                    <Legend />
                    <Scatter 
                      dataKey="strength" 
                      name="Resultado individual" 
                      fill="#3b82f6"
                    />
                    <Line 
                      type="monotone" 
                      dataKey="movingAvg" 
                      name="Media movil (5)" 
                      stroke="#22c55e" 
                      strokeWidth={2}
                      dot={false}
                    />
                    {stats.fc > 0 && (
                      <ReferenceLine 
                        y={stats.fc} 
                        stroke="#ef4444" 
                        strokeWidth={2}
                        strokeDasharray="5 5"
                        label={{ value: `f'c=${stats.fc}`, position: "right", fill: "#ef4444" }}
                      />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[400px] text-muted-foreground">
                  No hay datos para mostrar la evolucion temporal
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 7/28 Correlation */}
        <TabsContent value="correlation">
          <Card>
            <CardHeader>
              <CardTitle>Correlacion Resistencia 7 dias / 28 dias</CardTitle>
              <CardDescription>
                Relacion entre resistencia temprana y final. R² = {correlation.r2} | Ratio R7/R28 = {correlation.ratio}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {correlationData.length > 2 ? (
                <>
                  <ResponsiveContainer width="100%" height={400}>
                    <ScatterChart margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis 
                        type="number" 
                        dataKey="strength7" 
                        name="Resistencia 7 dias"
                        unit=" MPa"
                        label={{ value: "Resistencia 7 dias (MPa)", position: "bottom", offset: 0 }}
                      />
                      <YAxis 
                        type="number" 
                        dataKey="strength28" 
                        name="Resistencia 28 dias"
                        unit=" MPa"
                        label={{ value: "Resistencia 28 dias (MPa)", angle: -90, position: "insideLeft" }}
                      />
                      <Tooltip 
                        cursor={{ strokeDasharray: "3 3" }}
                        formatter={(value: number) => [`${value} MPa`]}
                      />
                      <Scatter 
                        data={correlationData} 
                        fill="#3b82f6"
                        name="Muestras"
                      />
                      {/* Regression line would need to be calculated separately */}
                    </ScatterChart>
                  </ResponsiveContainer>
                  <div className="mt-4 p-4 bg-muted rounded-lg">
                    <p className="text-sm">
                      <strong>Ecuacion de regresion:</strong> R28 = {correlation.slope} × R7 + {correlation.intercept}
                    </p>
                    <p className="text-sm mt-1">
                      <strong>Coeficiente de determinacion:</strong> R² = {correlation.r2} 
                      {correlation.r2 >= 0.85 ? " (Correlacion fuerte)" : correlation.r2 >= 0.7 ? " (Correlacion moderada)" : " (Correlacion debil)"}
                    </p>
                    <p className="text-sm mt-1">
                      <strong>Ratio promedio R7/R28:</strong> {correlation.ratio}
                    </p>
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-center h-[400px] text-muted-foreground">
                  Se necesitan al menos 3 pares de datos 7/28 dias para el analisis de correlacion
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Slump Analysis */}
        <TabsContent value="slump">
          <div className="grid gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Evolucion del Asentamiento (Cono de Abrams)</CardTitle>
                <CardDescription>
                  Asentamiento medido en cada despacho. Limites tipicos: Plastica 5-10 cm, Muy plastica 10-15 cm.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {slumpData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={slumpData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis 
                        dataKey="date" 
                        angle={-45}
                        textAnchor="end"
                        height={60}
                      />
                      <YAxis 
                        domain={[0, 25]}
                        label={{ value: "Asentamiento (cm)", angle: -90, position: "insideLeft" }}
                      />
                      <Tooltip />
                      <Legend />
                      <Line 
                        type="monotone" 
                        dataKey="slump" 
                        name="Asentamiento" 
                        stroke="#3b82f6" 
                        strokeWidth={2}
                        dot={{ fill: "#3b82f6" }}
                      />
                      <ReferenceLine y={5} stroke="#22c55e" strokeDasharray="3 3" label="Min Plastica" />
                      <ReferenceLine y={10} stroke="#22c55e" strokeDasharray="3 3" label="Max Plastica" />
                      <ReferenceLine y={15} stroke="#f97316" strokeDasharray="3 3" label="Max Muy Plastica" />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                    No hay datos de asentamiento disponibles
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Correlacion Asentamiento vs Resistencia</CardTitle>
                <CardDescription>
                  Verifica si asentamientos altos coinciden con resistencias bajas (efecto del exceso de agua)
                </CardDescription>
              </CardHeader>
              <CardContent>
                {slumpData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <ScatterChart margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis 
                        type="number" 
                        dataKey="slump" 
                        name="Asentamiento"
                        unit=" cm"
                        label={{ value: "Asentamiento (cm)", position: "bottom", offset: 0 }}
                      />
                      <YAxis 
                        type="number" 
                        dataKey="strength" 
                        name="Resistencia"
                        unit=" MPa"
                        label={{ value: "Resistencia 28d (MPa)", angle: -90, position: "insideLeft" }}
                      />
                      <Tooltip cursor={{ strokeDasharray: "3 3" }} />
                      <Scatter data={slumpData} fill="#3b82f6" />
                    </ScatterChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                    No hay datos suficientes
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Granulometry */}
        <TabsContent value="granulometry">
          <Card>
            <CardHeader>
              <CardTitle>Evolucion del Modulo de Finura</CardTitle>
              <CardDescription>
                MF admisible: 2.3 - 3.1 | Variacion maxima entre envios: ±0.2
              </CardDescription>
            </CardHeader>
            <CardContent>
              {mfEvolution.length > 0 ? (
                <ResponsiveContainer width="100%" height={400}>
                  <LineChart data={mfEvolution} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis 
                      dataKey="date" 
                      angle={-45}
                      textAnchor="end"
                      height={60}
                    />
                    <YAxis 
                      domain={[1.5, 3.5]}
                      label={{ value: "Modulo de Finura", angle: -90, position: "insideLeft" }}
                    />
                    <Tooltip 
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0].payload
                          return (
                            <div className="bg-background border rounded-lg p-3 shadow-lg">
                              <p className="font-semibold">{data.date}</p>
                              <p>MF: {data.mf}</p>
                              <p>Tipo: {data.type}</p>
                              <p>Proveedor: {data.provider}</p>
                            </div>
                          )
                        }
                        return null
                      }}
                    />
                    <Legend />
                    <Line 
                      type="monotone" 
                      dataKey="mf" 
                      name="Modulo de Finura" 
                      stroke="#3b82f6" 
                      strokeWidth={2}
                      dot={{ fill: "#3b82f6" }}
                    />
                    <ReferenceLine y={2.3} stroke="#ef4444" strokeDasharray="5 5" label={{ value: "Min 2.3", position: "right" }} />
                    <ReferenceLine y={3.1} stroke="#ef4444" strokeDasharray="5 5" label={{ value: "Max 3.1", position: "right" }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[400px] text-muted-foreground">
                  No hay datos de granulometria disponibles
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Suggestions Panel */}
      {suggestions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lightbulb className="h-5 w-5" />
              Sugerencias Automaticas
            </CardTitle>
            <CardDescription>
              Recomendaciones basadas en el analisis de los datos
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {suggestions.map((s, idx) => (
              <Alert key={idx} variant={s.type === "warning" ? "destructive" : "default"}>
                {s.type === "warning" ? (
                  <AlertTriangle className="h-4 w-4" />
                ) : s.type === "success" ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <Info className="h-4 w-4" />
                )}
                <AlertDescription>{s.message}</AlertDescription>
              </Alert>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
