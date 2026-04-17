"use client"

import { useState, useEffect, useMemo } from "react"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Slider } from "@/components/ui/slider"
import { ArrowLeft, AlertTriangle, CheckCircle2, TrendingUp, Lightbulb, Calculator, BarChart3, RefreshCw, FlaskConical, FileText } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { usePlant } from "@/lib/plant-context"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Area, ComposedChart, ReferenceLine } from "recharts"
import Link from "next/link"

// Tamices estándar en mm (según especificación del usuario)
const SIEVE_SIZES_MM = [9.5, 4.75, 2.36, 1.18, 0.60, 0.30, 0.15]
const SIEVE_LABELS = ["9.5mm", "4.75mm", "2.36mm", "1.18mm", "0.60mm", "0.30mm", "0.15mm", "Fondo"]

// Límites IRAM 1627 Zona II (óptima para hormigón semiseco)
const IRAM_1627_ZONA_II = {
  min: [100, 90, 75, 55, 35, 15, 5],
  max: [100, 100, 100, 90, 70, 34, 15]
}

// Líneas de producción
const PRODUCTION_LINES = [
  { id: "adoquines", name: "Línea 1 - Adoquines", tma: 6.3, mfMin: 2.8, mfMax: 3.2, materials: ["arena", "piedra_0_6"] },
  { id: "canos_pequenos", name: "Línea 2 - Caños DN 300-600", tma: 9.5, mfMin: 3.0, mfMax: 3.5, materials: ["arena", "piedra_0_10"] },
  { id: "canos_grandes", name: "Línea 2 - Caños DN 800-1200", tma: 19, mfMin: 4.5, mfMax: 5.2, materials: ["arena", "piedra_0_10"] },
]

const MATERIAL_TYPES = [
  { value: "arena", label: "Arena" },
  { value: "piedra_0_6", label: "Piedra 0/6" },
  { value: "piedra_0_10", label: "Piedra 0/10" },
]

interface SieveData {
  retained: number[] // gramos retenidos
  passing: number[] // % pasante
}

interface GranulometryTest {
  id: string
  test_date: string
  material_type: string
  supplier: string | null
  sample_weight_g: number
  sieve_results: Record<string, number>
  passing_percentages: Record<string, number>
  fineness_modulus: number | null
}

// Calcular curva Fuller-Thompson
function calculateFullerThompson(tma: number): number[] {
  return SIEVE_SIZES_MM.map(d => 100 * Math.sqrt(d / tma))
}

// Calcular % pasante desde gramos retenidos
function calculatePassingFromRetained(retainedGrams: number[], totalWeight: number): number[] {
  const passing: number[] = []
  let cumulativeRetained = 0
  
  for (let i = 0; i < retainedGrams.length; i++) {
    cumulativeRetained += retainedGrams[i] || 0
    const passingPct = ((totalWeight - cumulativeRetained) / totalWeight) * 100
    passing.push(Math.max(0, Math.min(100, passingPct)))
  }
  
  return passing
}

// Calcular módulo de finura
function calculateFinenessModulus(passing: number[]): number {
  // MF = suma de % retenidos acumulados en 4.75, 2.36, 1.18, 0.60, 0.30, 0.15 / 100
  // Índices: 1, 2, 3, 4, 5, 6 (excluyendo 9.5mm)
  const relevantIndices = [1, 2, 3, 4, 5, 6]
  let sumRetained = 0
  
  for (const idx of relevantIndices) {
    sumRetained += (100 - (passing[idx] || 0))
  }
  
  return sumRetained / 100
}

// Calcular curva de mezcla
function calculateBlendCurve(passing1: number[], passing2: number[], proportion1: number): number[] {
  const proportion2 = 100 - proportion1
  return passing1.map((p1, i) => (p1 * proportion1 + (passing2[i] || 0) * proportion2) / 100)
}

// Calcular RMS (desviación)
function calculateRMS(actual: number[], theoretical: number[]): number {
  let sumSquares = 0
  let count = 0
  
  for (let i = 0; i < actual.length; i++) {
    if (theoretical[i] !== undefined) {
      sumSquares += Math.pow(actual[i] - theoretical[i], 2)
      count++
    }
  }
  
  return count > 0 ? Math.sqrt(sumSquares / count) : 0
}

// Encontrar proporción óptima
function findOptimalProportion(passing1: number[], passing2: number[], tma: number): { proportion: number; rms: number } {
  const fullerCurve = calculateFullerThompson(tma)
  let bestProportion = 50
  let bestRMS = Infinity
  
  for (let p = 0; p <= 100; p++) {
    const blend = calculateBlendCurve(passing1, passing2, p)
    const rms = calculateRMS(blend, fullerCurve)
    
    if (rms < bestRMS) {
      bestRMS = rms
      bestProportion = p
    }
  }
  
  return { proportion: bestProportion, rms: bestRMS }
}

// Verificar alertas por tamiz
function checkSieveAlerts(blendPassing: number[]): Array<{ sieve: string; value: number; min: number; max: number; diff: number }> {
  const alerts: Array<{ sieve: string; value: number; min: number; max: number; diff: number }> = []
  
  for (let i = 0; i < SIEVE_SIZES_MM.length; i++) {
    const value = blendPassing[i] || 0
    const min = IRAM_1627_ZONA_II.min[i]
    const max = IRAM_1627_ZONA_II.max[i]
    
    if (value < min) {
      alerts.push({ sieve: `${SIEVE_SIZES_MM[i]}mm`, value, min, max, diff: min - value })
    } else if (value > max) {
      alerts.push({ sieve: `${SIEVE_SIZES_MM[i]}mm`, value, min, max, diff: value - max })
    }
  }
  
  return alerts
}

// Generar recomendación según patrones de desviación IRAM 1627
function generateRecommendation(
  currentProportion: number,
  optimalProportion: number,
  currentRMS: number,
  optimalRMS: number,
  blendPassing: number[],
  mf: number,
  mfMin: number,
  mfMax: number
): string {
  const parts: string[] = []
  
  // Comparación de proporciones
  parts.push(`Con la proporción actual (${currentProportion}% arena / ${100 - currentProportion}% piedra) la mezcla tiene una desviación Fuller de ${currentRMS.toFixed(1)}.`)
  
  if (Math.abs(currentProportion - optimalProportion) > 2) {
    parts.push(`Ajustando a ${optimalProportion}% arena / ${100 - optimalProportion}% piedra se reduce la desviación a ${optimalRMS.toFixed(1)}.`)
  }
  
  // Verificar si todos los tamices están dentro del rango IRAM
  let allWithinRange = true
  for (let i = 0; i < SIEVE_SIZES_MM.length; i++) {
    if (blendPassing[i] < IRAM_1627_ZONA_II.min[i] || blendPassing[i] > IRAM_1627_ZONA_II.max[i]) {
      allWithinRange = false
      break
    }
  }
  
  // Índices de tamices para análisis de patrones
  const fines030Index = SIEVE_SIZES_MM.findIndex(s => s === 0.30)  // N°50
  const fines015Index = SIEVE_SIZES_MM.findIndex(s => s === 0.15)  // N°100
  const medium060Index = SIEVE_SIZES_MM.findIndex(s => s === 0.60) // N°30
  const medium118Index = SIEVE_SIZES_MM.findIndex(s => s === 1.18) // N°16
  const coarse236Index = SIEVE_SIZES_MM.findIndex(s => s === 2.36) // N°8
  const coarse475Index = SIEVE_SIZES_MM.findIndex(s => s === 4.75) // N°4
  
  // Patrón 1: Exceso de pasante en tamices ≤ 0.30mm (finos)
  const excessFines = (fines030Index >= 0 && blendPassing[fines030Index] > IRAM_1627_ZONA_II.max[fines030Index]) ||
                      (fines015Index >= 0 && blendPassing[fines015Index] > IRAM_1627_ZONA_II.max[fines015Index])
  if (excessFines) {
    parts.push("Exceso de finos. Riesgo de mayor demanda de agua y cemento. Reducir proporción de arena o solicitar arena con menor contenido de polvo.")
  }
  
  // Patrón 2: Déficit de pasante en tamices ≥ 2.36mm (gruesos)
  const deficitCoarse = (coarse236Index >= 0 && blendPassing[coarse236Index] < IRAM_1627_ZONA_II.min[coarse236Index]) ||
                        (coarse475Index >= 0 && blendPassing[coarse475Index] < IRAM_1627_ZONA_II.min[coarse475Index])
  if (deficitCoarse) {
    parts.push("Déficit de fracción gruesa. Riesgo de menor resistencia al desgaste superficial. Aumentar proporción de piedra.")
  }
  
  // Patrón 3: Exceso de pasante en tamices intermedios (0.60-1.18mm)
  const excessMedium = (medium060Index >= 0 && blendPassing[medium060Index] > IRAM_1627_ZONA_II.max[medium060Index]) ||
                       (medium118Index >= 0 && blendPassing[medium118Index] > IRAM_1627_ZONA_II.max[medium118Index])
  if (excessMedium && !excessFines) {
    parts.push("Curva cargada en fracción media. Verificar MF y considerar ajuste de proporción.")
  }
  
  // Patrón 4: Curva dentro de rango pero RMS > 5
  if (allWithinRange && currentRMS > 5) {
    parts.push("Curva dentro de límites IRAM pero alejada de Fuller. El formuleo es aceptable pero puede optimizarse ajustando la proporción.")
  }
  
  // MF fuera de rango
  if (mf < mfMin) {
    parts.push(`El MF de la mezcla (${mf.toFixed(2)}) está por debajo del óptimo (${mfMin}-${mfMax}). Se recomienda aumentar la proporción de piedra.`)
  } else if (mf > mfMax) {
    parts.push(`El MF de la mezcla (${mf.toFixed(2)}) está por encima del óptimo (${mfMin}-${mfMax}). Se recomienda aumentar la proporción de arena.`)
  }
  
  // Si todo está bien
  if (parts.length === 1 && allWithinRange && currentRMS <= 5 && mf >= mfMin && mf <= mfMax) {
    parts.push("La mezcla está dentro de especificación IRAM 1627 y próxima a la curva Fuller. Formuleo óptimo.")
  }
  
  return parts.join(" ")
}

export default function MezclasGranulometriaPage() {
  const supabase = createClient()
  const { selectedPlant } = usePlant()
  const [selectedLine, setSelectedLine] = useState(PRODUCTION_LINES[0].id)
  const [tests, setTests] = useState<GranulometryTest[]>([])
  const [loading, setLoading] = useState(true)
  
  // Datos de entrada manual
  const [sandWeight, setSandWeight] = useState(500)
  const [stoneWeight, setStoneWeight] = useState(500)
  const [sandRetained, setSandRetained] = useState<number[]>(Array(8).fill(0))
  const [stoneRetained, setStoneRetained] = useState<number[]>(Array(8).fill(0))
  const [sandProportion, setSandProportion] = useState(50)
  
  // Selección de ensayos existentes
  const [selectedSandTest, setSelectedSandTest] = useState<string>("")
  const [selectedStoneTest, setSelectedStoneTest] = useState<string>("")
  const [useExistingTests, setUseExistingTests] = useState(false)
  
  // Stockpile (acopios) data
  const [stockpileData, setStockpileData] = useState<{
    arena: any | null
    piedra: any | null
    loaded: boolean
  }>({ arena: null, piedra: null, loaded: false })
  
  // Formuleo integration
  const [currentPastonFormula, setCurrentPastonFormula] = useState<any | null>(null)
  const [showFormulaSuggestionDialog, setShowFormulaSuggestionDialog] = useState(false)
  const [suggestedFormula, setSuggestedFormula] = useState<{
    sand_kg: number
    stone_kg: number
    sandPct: number
    stonePct: number
    mfMezcla: number
    rms: number
  } | null>(null)
  
  const currentLine = PRODUCTION_LINES.find(l => l.id === selectedLine) || PRODUCTION_LINES[0]
  
  useEffect(() => {
    loadTests()
    loadStockpileData()
    loadPastonFormula()
  }, [selectedPlant])
  
  // Load current stockpile granulometry data
  async function loadStockpileData() {
    const { data, error } = await supabase
      .from("stockpile_granulometry")
      .select("*")
      .eq("plant", selectedPlant || "mercedes")
      .order("test_date", { ascending: false })
    
    if (!error && data) {
      const arenaTest = data.find((t: any) => t.material_type.toLowerCase().includes("arena"))
      const piedraTest = data.find((t: any) => t.material_type.toLowerCase().includes("piedra"))
      
      setStockpileData({
        arena: arenaTest ? { ...arenaTest, passing: getPassingFromStockpile(arenaTest) } : null,
        piedra: piedraTest ? { ...piedraTest, passing: getPassingFromStockpile(piedraTest) } : null,
        loaded: true,
      })
    }
  }
  
  // Load current paston formula
  async function loadPastonFormula() {
    const { data, error } = await supabase
      .from("paston_formulas")
      .select("*")
      .eq("plant", selectedPlant || "mercedes")
      .eq("is_active", true)
      .single()
    
    if (!error && data) {
      setCurrentPastonFormula(data)
      // Set initial proportion from current formula
      const totalAggregates = (data.sand_kg || 0) + (data.stone_kg || 0)
      if (totalAggregates > 0) {
        setSandProportion(Math.round((data.sand_kg / totalAggregates) * 100))
      }
    }
  }
  
  // Extract passing percentages from stockpile test
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
  
  // Load stockpile data into the analysis
  function loadStockpileIntoAnalysis() {
    if (stockpileData.arena && stockpileData.piedra) {
      setUseExistingTests(false) // Use direct data, not existing tests
      // Update the sandPassing and stonePassing via the retained values
      // Since we have passing percentages, we need to work backwards or use them directly
      // For simplicity, we'll set a flag and use the stockpile data directly
      setStockpileData({ ...stockpileData, loaded: true })
    }
  }
  
  // Calculate suggested formula based on optimal proportions
  function calculateSuggestedFormula(optimalSandPct: number) {
    if (!currentPastonFormula) return null
    
    const currentTotal = currentPastonFormula.sand_kg + currentPastonFormula.stone_kg
    const newSandKg = Math.round((optimalSandPct / 100) * currentTotal)
    const newStoneKg = currentTotal - newSandKg
    
    // Calculate MF of the suggested mix
    let mfMezcla = 0
    if (stockpileData.arena?.modulo_finura && stockpileData.piedra?.modulo_finura) {
      mfMezcla = (stockpileData.arena.modulo_finura * optimalSandPct / 100) + 
                 (stockpileData.piedra.modulo_finura * (100 - optimalSandPct) / 100)
    }
    
    return {
      sand_kg: newSandKg,
      stone_kg: newStoneKg,
      sandPct: optimalSandPct,
      stonePct: 100 - optimalSandPct,
      mfMezcla,
      rms: 0, // Will be calculated
    }
  }
  
  async function loadTests() {
    setLoading(true)
    const { data, error } = await supabase
      .from("granulometry_tests")
      .select(`
        *,
        mp_receipts!left(supplier_id, suppliers!left(name))
      `)
      .order("test_date", { ascending: false })
      .limit(50)
    
    if (!error && data) {
      // Transform data to include supplier_name
      const transformedData = data.map((test: any) => ({
        ...test,
        supplier: test.mp_receipts?.suppliers?.name || test.origin || test.supplier_name || null,
      }))
      setTests(transformedData)
    }
    setLoading(false)
  }
  
  // Helper function to extract passing percentages from test data
  function getPassingFromTest(test: any): number[] {
    // Map sieve sizes to database column names
    const sieveColumnMapping: Record<number, string> = {
      9.5: "sieve_9500",
      4.75: "sieve_4750",
      2.36: "sieve_2360",
      1.18: "sieve_1180",
      0.60: "sieve_600",
      0.30: "sieve_300",
      0.15: "sieve_150",
    }
    
    const totalWeight = parseFloat(test.total_sample_weight_g) || parseFloat(test.sample_weight_g) || 500
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

  // Flag to use stockpile data
  const [useStockpileData, setUseStockpileData] = useState(false)
  
  // Calcular curvas
  const sandPassing = useMemo(() => {
    // Priority: 1) Stockpile data, 2) Existing tests, 3) Manual entry
    if (useStockpileData && stockpileData.arena?.passing) {
      return stockpileData.arena.passing
    }
    if (useExistingTests && selectedSandTest) {
      const test = tests.find(t => t.id === selectedSandTest)
      if (test) {
        return getPassingFromTest(test)
      }
    }
    return calculatePassingFromRetained(sandRetained, sandWeight)
  }, [useStockpileData, stockpileData.arena, useExistingTests, selectedSandTest, tests, sandRetained, sandWeight])
  
  const stonePassing = useMemo(() => {
    // Priority: 1) Stockpile data, 2) Existing tests, 3) Manual entry
    if (useStockpileData && stockpileData.piedra?.passing) {
      return stockpileData.piedra.passing
    }
    if (useExistingTests && selectedStoneTest) {
      const test = tests.find(t => t.id === selectedStoneTest)
      if (test) {
        return getPassingFromTest(test)
      }
    }
    return calculatePassingFromRetained(stoneRetained, stoneWeight)
  }, [useStockpileData, stockpileData.piedra, useExistingTests, selectedStoneTest, tests, stoneRetained, stoneWeight])
  
  const blendPassing = useMemo(() => 
    calculateBlendCurve(sandPassing, stonePassing, sandProportion),
    [sandPassing, stonePassing, sandProportion]
  )
  
  const fullerCurve = useMemo(() => 
    calculateFullerThompson(currentLine.tma),
    [currentLine.tma]
  )
  
  const blendMF = useMemo(() => 
    calculateFinenessModulus(blendPassing),
    [blendPassing]
  )
  
  const currentRMS = useMemo(() => 
    calculateRMS(blendPassing, fullerCurve),
    [blendPassing, fullerCurve]
  )
  
  const iramRMS = useMemo(() => {
    const iramMid = IRAM_1627_ZONA_II.min.map((min, i) => (min + IRAM_1627_ZONA_II.max[i]) / 2)
    return calculateRMS(blendPassing, iramMid)
  }, [blendPassing])
  
  const optimalResult = useMemo(() => 
    findOptimalProportion(sandPassing, stonePassing, currentLine.tma),
    [sandPassing, stonePassing, currentLine.tma]
  )
  
  // Alias for clearer naming in formula suggestion section
  const optimalProportion = optimalResult
  
  const sieveAlerts = useMemo(() => 
    checkSieveAlerts(blendPassing),
    [blendPassing]
  )
  
  const recommendation = useMemo(() => 
    generateRecommendation(
      sandProportion,
      optimalResult.proportion,
      currentRMS,
      optimalResult.rms,
      blendPassing,
      blendMF,
      currentLine.mfMin,
      currentLine.mfMax
    ),
    [sandProportion, optimalResult, currentRMS, blendPassing, blendMF, currentLine]
  )
  
  // Datos para el gráfico (reversed for ascending curve - small sieves on left)
  const chartData = useMemo(() => {
    return SIEVE_SIZES_MM.map((size, i) => ({
      sieve: `${size}mm`,
      size,
      arena: sandPassing[i],
      piedra: stonePassing[i],
      mezcla: blendPassing[i],
      fuller: fullerCurve[i],
      iramMin: IRAM_1627_ZONA_II.min[i],
      iramMax: IRAM_1627_ZONA_II.max[i],
    })).reverse()
  }, [sandPassing, stonePassing, blendPassing, fullerCurve])
  
  // Clasificación del RMS
  const getRMSStatus = (rms: number) => {
    if (rms <= 5) return { label: "Óptimo", color: "bg-green-100 text-green-700", icon: CheckCircle2 }
    if (rms <= 10) return { label: "Aceptable", color: "bg-yellow-100 text-yellow-700", icon: AlertTriangle }
    return { label: "Fuera de rango", color: "bg-red-100 text-red-700", icon: AlertTriangle }
  }
  
  const rmsStatus = getRMSStatus(currentRMS)
  const mfInRange = blendMF >= currentLine.mfMin && blendMF <= currentLine.mfMax
  
  // Filtrar ensayos por tipo de material (case-insensitive)
  const sandTests = tests.filter(t => 
    t.material_type?.toLowerCase().includes("arena")
  )
  const stoneTests = tests.filter(t => 
    t.material_type?.toLowerCase().includes("piedra")
  )
  
  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <Link href="/calidad/granulometria" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-xl font-bold">Análisis de Mezclas Granulométricas</h1>
          <p className="text-sm text-muted-foreground">Optimización de curvas según Fuller-Thompson e IRAM 1627</p>
        </div>
      </div>
      
      <div className="space-y-6">
        {/* Selección de línea de producción */}
        <Card>
          <CardContent className="py-4">
            <div className="flex flex-wrap items-center gap-4">
              <Label className="font-medium">Línea de producción:</Label>
              <Select value={selectedLine} onValueChange={setSelectedLine}>
                <SelectTrigger className="w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRODUCTION_LINES.map(line => (
                    <SelectItem key={line.id} value={line.id}>{line.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex gap-4 text-sm text-muted-foreground ml-auto">
                <span>TMA: <strong>{currentLine.tma}mm</strong></span>
                <span>MF óptimo: <strong>{currentLine.mfMin} - {currentLine.mfMax}</strong></span>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <div className="grid lg:grid-cols-2 gap-6">
          {/* Panel de entrada de datos */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calculator className="h-5 w-5" />
                Entrada de Datos
              </CardTitle>
              <CardDescription>Ingrese los datos de los áridos o seleccione ensayos existentes</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Toggle entre manual, existentes y acopios */}
              <Tabs 
                value={useStockpileData ? "stockpile" : (useExistingTests ? "existing" : "manual")} 
                onValueChange={(v) => {
                  setUseStockpileData(v === "stockpile")
                  setUseExistingTests(v === "existing")
                }}
              >
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="stockpile">
                    <FlaskConical className="h-3.5 w-3.5 mr-1.5" />
                    Acopios Actuales
                  </TabsTrigger>
                  <TabsTrigger value="manual">
                    Ingreso Manual
                  </TabsTrigger>
                  <TabsTrigger value="existing">
                    Ensayos Existentes
                  </TabsTrigger>
                </TabsList>
                
                {/* Stockpile Tab - Load current stockpile data */}
                <TabsContent value="stockpile" className="space-y-4 mt-4">
                  {!stockpileData.arena && !stockpileData.piedra ? (
                    <div className="text-center py-8 text-muted-foreground border rounded-lg">
                      <FlaskConical className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p>No hay ensayos de acopios registrados para esta planta.</p>
                      <Link href="/calidad/granulometria" className="text-blue-600 hover:underline text-sm">
                        Ir a registrar ensayos de acopio
                      </Link>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* Arena Stockpile */}
                      <div className={`border rounded-lg p-4 ${stockpileData.arena ? "bg-green-50/50 border-green-200" : "bg-yellow-50/50 border-yellow-200"}`}>
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <h4 className="font-medium flex items-center gap-2">
                              Arena
                              {stockpileData.arena ? (
                                <CheckCircle2 className="h-4 w-4 text-green-600" />
                              ) : (
                                <AlertTriangle className="h-4 w-4 text-yellow-600" />
                              )}
                            </h4>
                            {stockpileData.arena && (
                              <p className="text-xs text-muted-foreground">
                                MF: {stockpileData.arena.modulo_finura?.toFixed(2)} | 
                                Ensayado: {new Date(stockpileData.arena.test_date).toLocaleDateString("es-AR")} por {stockpileData.arena.tested_by}
                              </p>
                            )}
                          </div>
                          {!stockpileData.arena && (
                            <Badge variant="outline" className="text-yellow-700">Sin datos</Badge>
                          )}
                        </div>
                        {stockpileData.arena?.passing && (
                          <div className="grid grid-cols-7 gap-1 text-xs">
                            {SIEVE_SIZES_MM.map((size, i) => (
                              <div key={size} className="text-center bg-white/50 rounded p-1">
                                <div className="font-medium">{size}mm</div>
                                <div>{stockpileData.arena.passing[i]?.toFixed(1)}%</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      
                      {/* Piedra Stockpile */}
                      <div className={`border rounded-lg p-4 ${stockpileData.piedra ? "bg-green-50/50 border-green-200" : "bg-yellow-50/50 border-yellow-200"}`}>
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <h4 className="font-medium flex items-center gap-2">
                              Piedra {selectedPlant === "ranchos" ? "0/6" : "0/10"}
                              {stockpileData.piedra ? (
                                <CheckCircle2 className="h-4 w-4 text-green-600" />
                              ) : (
                                <AlertTriangle className="h-4 w-4 text-yellow-600" />
                              )}
                            </h4>
                            {stockpileData.piedra && (
                              <p className="text-xs text-muted-foreground">
                                MF: {stockpileData.piedra.modulo_finura?.toFixed(2)} | 
                                Ensayado: {new Date(stockpileData.piedra.test_date).toLocaleDateString("es-AR")} por {stockpileData.piedra.tested_by}
                              </p>
                            )}
                          </div>
                          {!stockpileData.piedra && (
                            <Badge variant="outline" className="text-yellow-700">Sin datos</Badge>
                          )}
                        </div>
                        {stockpileData.piedra?.passing && (
                          <div className="grid grid-cols-7 gap-1 text-xs">
                            {SIEVE_SIZES_MM.map((size, i) => (
                              <div key={size} className="text-center bg-white/50 rounded p-1">
                                <div className="font-medium">{size}mm</div>
                                <div>{stockpileData.piedra.passing[i]?.toFixed(1)}%</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="w-full gap-2"
                        onClick={() => loadStockpileData()}
                      >
                        <RefreshCw className="h-4 w-4" />
                        Actualizar datos de acopios
                      </Button>
                    </div>
                  )}
                </TabsContent>
                
                <TabsContent value="manual" className="space-y-4 mt-4">
                  {/* Arena */}
                  <div className="border rounded-lg p-4">
                    <div className="flex justify-between items-center mb-3">
                      <h4 className="font-medium">Arena</h4>
                      <div className="flex items-center gap-2">
                        <Label className="text-xs">Peso muestra (g):</Label>
                        <Input
                          type="number"
                          className="w-20 h-7 text-xs"
                          value={sandWeight}
                          onChange={(e) => setSandWeight(Number(e.target.value))}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      {SIEVE_LABELS.map((label, i) => (
                        <div key={label} className="space-y-1">
                          <Label className="text-[10px]">{label}</Label>
                          <Input
                            type="number"
                            step="0.1"
                            className="h-7 text-xs"
                            placeholder="0"
                            value={sandRetained[i] || ""}
                            onChange={(e) => {
                              const newRetained = [...sandRetained]
                              newRetained[i] = Number(e.target.value)
                              setSandRetained(newRetained)
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                  
                  {/* Piedra */}
                  <div className="border rounded-lg p-4">
                    <div className="flex justify-between items-center mb-3">
                      <h4 className="font-medium">Piedra {currentLine.id === "adoquines" ? "0/6" : "0/10"}</h4>
                      <div className="flex items-center gap-2">
                        <Label className="text-xs">Peso muestra (g):</Label>
                        <Input
                          type="number"
                          className="w-20 h-7 text-xs"
                          value={stoneWeight}
                          onChange={(e) => setStoneWeight(Number(e.target.value))}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      {SIEVE_LABELS.map((label, i) => (
                        <div key={label} className="space-y-1">
                          <Label className="text-[10px]">{label}</Label>
                          <Input
                            type="number"
                            step="0.1"
                            className="h-7 text-xs"
                            placeholder="0"
                            value={stoneRetained[i] || ""}
                            onChange={(e) => {
                              const newRetained = [...stoneRetained]
                              newRetained[i] = Number(e.target.value)
                              setStoneRetained(newRetained)
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </TabsContent>
                
                <TabsContent value="existing" className="space-y-4 mt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Ensayo de Arena</Label>
                      <Select value={selectedSandTest} onValueChange={setSelectedSandTest}>
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccionar..." />
                        </SelectTrigger>
                        <SelectContent>
                          {sandTests.map(test => (
                            <SelectItem key={test.id} value={test.id}>
                              {new Date(test.test_date).toLocaleDateString("es-AR")} - {test.supplier || "Sin proveedor"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Ensayo de Piedra</Label>
                      <Select value={selectedStoneTest} onValueChange={setSelectedStoneTest}>
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccionar..." />
                        </SelectTrigger>
                        <SelectContent>
                          {stoneTests.map(test => (
                            <SelectItem key={test.id} value={test.id}>
                              {new Date(test.test_date).toLocaleDateString("es-AR")} - {test.supplier || "Sin proveedor"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
              
              {/* Proporción de mezcla */}
              <div className="border rounded-lg p-4 space-y-4">
                <h4 className="font-medium">Proporción de Mezcla</h4>
                <div className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span>Arena: <strong>{sandProportion}%</strong></span>
                    <span>Piedra: <strong>{100 - sandProportion}%</strong></span>
                  </div>
                  <Slider
                    value={[sandProportion]}
                    onValueChange={([v]) => setSandProportion(v)}
                    max={100}
                    min={0}
                    step={1}
                    className="py-2"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
          
          {/* Panel de resultados KPI */}
          <div className="space-y-4">
            {/* Índice de desviación RMS */}
            <Card>
              <CardContent className="py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-center p-4 rounded-lg bg-muted/50">
                    <div className="text-xs text-muted-foreground mb-1">Desviación Fuller</div>
                    <div className="text-3xl font-bold">{currentRMS.toFixed(1)}</div>
                    <Badge className={`mt-2 ${rmsStatus.color}`}>
                      <rmsStatus.icon className="h-3 w-3 mr-1" />
                      {rmsStatus.label}
                    </Badge>
                  </div>
                  <div className="text-center p-4 rounded-lg bg-muted/50">
                    <div className="text-xs text-muted-foreground mb-1">Módulo de Finura</div>
                    <div className="text-3xl font-bold">{blendMF.toFixed(2)}</div>
                    <Badge className={`mt-2 ${mfInRange ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                      {mfInRange ? (
                        <><CheckCircle2 className="h-3 w-3 mr-1" />En rango</>
                      ) : (
                        <><AlertTriangle className="h-3 w-3 mr-1" />Fuera</>
                      )}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            {/* Optimizador */}
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="py-4">
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <TrendingUp className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-medium">Proporción Óptima Sugerida</h4>
                    <p className="text-2xl font-bold text-primary mt-1">
                      {optimalResult.proportion}% arena / {100 - optimalResult.proportion}% piedra
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">
                      RMS: {optimalResult.rms.toFixed(1)} 
                      {optimalResult.rms < currentRMS && (
                        <span className="text-green-600 ml-2">
                          (mejora de {(currentRMS - optimalResult.rms).toFixed(1)} puntos)
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            {/* Alertas por tamiz */}
            {sieveAlerts.length > 0 && (
              <Card className="border-destructive/30">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2 text-destructive">
                    <AlertTriangle className="h-4 w-4" />
                    Alertas por Tamiz
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {sieveAlerts.map((alert, i) => (
                      <div key={i} className="flex justify-between items-center text-sm p-2 bg-destructive/5 rounded">
                        <span className="font-medium">{alert.sieve}</span>
                        <span>
                          Real: <strong>{alert.value.toFixed(1)}%</strong> | 
                          Esperado: {alert.min}-{alert.max}% | 
                          <span className="text-destructive"> Δ{alert.diff.toFixed(1)}%</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
        
        {/* Gráfico de curvas */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Curvas Granulométricas
            </CardTitle>
            <CardDescription>
              Comparación de curva real vs Fuller-Thompson e IRAM 1627 Zona II
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-96">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="sieve" 
                    tick={{ fontSize: 11 }}
                    label={{ value: 'Tamiz (mm)', position: 'insideBottom', offset: -5 }}
                  />
                  <YAxis 
                    domain={[0, 100]} 
                    tick={{ fontSize: 11 }} 
                    label={{ value: '% Pasante', angle: -90, position: 'insideLeft' }} 
                  />
                  <Tooltip 
                    formatter={(value: number, name: string) => {
                      const labels: Record<string, string> = {
                        arena: "Arena",
                        piedra: "Piedra",
                        mezcla: "Mezcla",
                        fuller: "Fuller-Thompson",
                        iramMin: "IRAM Mín",
                        iramMax: "IRAM Máx"
                      }
                      return [`${value.toFixed(1)}%`, labels[name] || name]
                    }}
                  />
                  <Legend />
                  
                  {/* Banda IRAM */}
                  <Area 
                    type="monotone" 
                    dataKey="iramMax" 
                    fill="#dcfce7" 
                    stroke="none" 
                    name="IRAM Sup." 
                    fillOpacity={0.5}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="iramMin" 
                    fill="#ffffff" 
                    stroke="none" 
                    name="IRAM Inf."
                  />
                  
                  {/* Curvas de límites IRAM */}
                  <Line 
                    type="monotone" 
                    dataKey="iramMin" 
                    stroke="#22c55e" 
                    strokeDasharray="5 5" 
                    dot={false} 
                    name="IRAM Mín"
                    strokeWidth={1.5}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="iramMax" 
                    stroke="#22c55e" 
                    strokeDasharray="5 5" 
                    dot={false} 
                    name="IRAM Máx"
                    strokeWidth={1.5}
                  />
                  
                  {/* Curva Fuller */}
                  <Line 
                    type="monotone" 
                    dataKey="fuller" 
                    stroke="#f97316" 
                    strokeDasharray="3 3" 
                    dot={false} 
                    name="Fuller-Thompson"
                    strokeWidth={2}
                  />
                  
                  {/* Curvas de áridos individuales */}
                  <Line 
                    type="monotone" 
                    dataKey="arena" 
                    stroke="#94a3b8" 
                    dot={false} 
                    name="Arena"
                    strokeWidth={1}
                    opacity={0.6}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="piedra" 
                    stroke="#64748b" 
                    dot={false} 
                    name="Piedra"
                    strokeWidth={1}
                    opacity={0.6}
                  />
                  
                  {/* Curva de mezcla (principal) */}
                  <Line 
                    type="monotone" 
                    dataKey="mezcla" 
                    stroke="#2563eb" 
                    strokeWidth={3} 
                    dot={{ r: 4, fill: "#2563eb" }} 
                    name="Mezcla"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
        
        {/* Tabla de datos */}
        <Card>
          <CardHeader>
            <CardTitle>Datos del Análisis</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tamiz</TableHead>
                    {SIEVE_LABELS.map(label => (
                      <TableHead key={label} className="text-center text-xs">{label}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium">Arena % Pasa</TableCell>
                    {sandPassing.map((p, i) => (
                      <TableCell key={i} className="text-center text-xs">{p.toFixed(1)}</TableCell>
                    ))}
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Piedra % Pasa</TableCell>
                    {stonePassing.map((p, i) => (
                      <TableCell key={i} className="text-center text-xs">{p.toFixed(1)}</TableCell>
                    ))}
                  </TableRow>
                  <TableRow className="bg-primary/5">
                    <TableCell className="font-bold">Mezcla % Pasa</TableCell>
                    {blendPassing.map((p, i) => {
                      const isOutside = p < IRAM_1627_ZONA_II.min[i] || p > IRAM_1627_ZONA_II.max[i]
                      return (
                        <TableCell 
                          key={i} 
                          className={`text-center text-xs font-bold ${isOutside ? "bg-red-100 text-red-700" : ""}`}
                        >
                          {p.toFixed(1)}
                        </TableCell>
                      )
                    })}
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium text-orange-600">Fuller</TableCell>
                    {fullerCurve.map((p, i) => (
                      <TableCell key={i} className="text-center text-xs text-orange-600">{p.toFixed(1)}</TableCell>
                    ))}
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium text-green-600">IRAM Mín</TableCell>
                    {IRAM_1627_ZONA_II.min.map((p, i) => (
                      <TableCell key={i} className="text-center text-xs text-green-600">{p}</TableCell>
                    ))}
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium text-green-600">IRAM Máx</TableCell>
                    {IRAM_1627_ZONA_II.max.map((p, i) => (
                      <TableCell key={i} className="text-center text-xs text-green-600">{p}</TableCell>
                    ))}
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
        
        {/* Recomendaciones */}
        <Card className="border-primary/20 bg-gradient-to-r from-primary/5 to-transparent">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lightbulb className="h-5 w-5 text-primary" />
              Recomendaciones de Formuleo
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed">{recommendation}</p>
          </CardContent>
        </Card>
        
        {/* Sugerencia de Fórmula de Pastón */}
        {useStockpileData && stockpileData.arena && stockpileData.piedra && currentPastonFormula && (
          <Card className="border-blue-200 bg-gradient-to-r from-blue-50 to-transparent">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-blue-600" />
                Sugerencia de Fórmula de Pastón
              </CardTitle>
              <CardDescription>
                Basada en los acopios actuales y la dosificación óptima calculada
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Current vs Suggested */}
              <div className="grid grid-cols-2 gap-4">
                {/* Current Formula */}
                <div className="border rounded-lg p-4 bg-white">
                  <h4 className="font-medium text-sm mb-3 text-muted-foreground">Fórmula Actual</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span>Arena:</span>
                      <span className="font-medium">{currentPastonFormula.sand_kg} kg</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Piedra:</span>
                      <span className="font-medium">{currentPastonFormula.stone_kg} kg</span>
                    </div>
                    <div className="flex justify-between border-t pt-2 mt-2">
                      <span>Proporción:</span>
                      <span className="font-medium">
                        {Math.round((currentPastonFormula.sand_kg / (currentPastonFormula.sand_kg + currentPastonFormula.stone_kg)) * 100)}% / 
                        {Math.round((currentPastonFormula.stone_kg / (currentPastonFormula.sand_kg + currentPastonFormula.stone_kg)) * 100)}%
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>MF Mezcla:</span>
                      <span className="font-medium">
                        {(() => {
                          const currentSandPct = (currentPastonFormula.sand_kg / (currentPastonFormula.sand_kg + currentPastonFormula.stone_kg)) * 100
                          const currentStonePct = 100 - currentSandPct
                          const mf = (stockpileData.arena?.modulo_finura * currentSandPct / 100) + 
                                    (stockpileData.piedra?.modulo_finura * currentStonePct / 100)
                          return mf.toFixed(2)
                        })()}
                      </span>
                    </div>
                  </div>
                </div>
                
                {/* Suggested Formula */}
                <div className="border-2 border-blue-300 rounded-lg p-4 bg-blue-50/50">
                  <h4 className="font-medium text-sm mb-3 text-blue-700 flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" />
                    Fórmula Sugerida (Óptima)
                  </h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span>Arena:</span>
                      <span className="font-bold text-blue-700">
                        {Math.round((optimalProportion.proportion / 100) * (currentPastonFormula.sand_kg + currentPastonFormula.stone_kg))} kg
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Piedra:</span>
                      <span className="font-bold text-blue-700">
                        {Math.round(((100 - optimalProportion.proportion) / 100) * (currentPastonFormula.sand_kg + currentPastonFormula.stone_kg))} kg
                      </span>
                    </div>
                    <div className="flex justify-between border-t pt-2 mt-2">
                      <span>Proporción:</span>
                      <span className="font-bold text-blue-700">
                        {optimalProportion.proportion}% / {100 - optimalProportion.proportion}%
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>MF Mezcla:</span>
                      <span className="font-bold text-blue-700">
                        {(() => {
                          const mf = (stockpileData.arena?.modulo_finura * optimalProportion.proportion / 100) + 
                                    (stockpileData.piedra?.modulo_finura * (100 - optimalProportion.proportion) / 100)
                          return mf.toFixed(2)
                        })()}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>RMS vs Fuller:</span>
                      <span>{optimalProportion.rms.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Difference Summary */}
              <div className="bg-white border rounded-lg p-3">
                <div className="flex items-center gap-4 text-sm">
                  <div className="flex-1">
                    <span className="text-muted-foreground">Cambio en Arena:</span>
                    <span className={`ml-2 font-medium ${
                      Math.round((optimalProportion.proportion / 100) * (currentPastonFormula.sand_kg + currentPastonFormula.stone_kg)) - currentPastonFormula.sand_kg > 0 
                        ? "text-green-600" : "text-red-600"
                    }`}>
                      {Math.round((optimalProportion.proportion / 100) * (currentPastonFormula.sand_kg + currentPastonFormula.stone_kg)) - currentPastonFormula.sand_kg > 0 ? "+" : ""}
                      {Math.round((optimalProportion.proportion / 100) * (currentPastonFormula.sand_kg + currentPastonFormula.stone_kg)) - currentPastonFormula.sand_kg} kg
                    </span>
                  </div>
                  <div className="flex-1">
                    <span className="text-muted-foreground">Cambio en Piedra:</span>
                    <span className={`ml-2 font-medium ${
                      Math.round(((100 - optimalProportion.proportion) / 100) * (currentPastonFormula.sand_kg + currentPastonFormula.stone_kg)) - currentPastonFormula.stone_kg > 0 
                        ? "text-green-600" : "text-red-600"
                    }`}>
                      {Math.round(((100 - optimalProportion.proportion) / 100) * (currentPastonFormula.sand_kg + currentPastonFormula.stone_kg)) - currentPastonFormula.stone_kg > 0 ? "+" : ""}
                      {Math.round(((100 - optimalProportion.proportion) / 100) * (currentPastonFormula.sand_kg + currentPastonFormula.stone_kg)) - currentPastonFormula.stone_kg} kg
                    </span>
                  </div>
                </div>
              </div>
              
              {/* Action Buttons */}
              <div className="flex gap-3">
                <Button 
                  className="flex-1 gap-2"
                  onClick={() => {
                    const newSandKg = Math.round((optimalProportion.proportion / 100) * (currentPastonFormula.sand_kg + currentPastonFormula.stone_kg))
                    const newStoneKg = Math.round(((100 - optimalProportion.proportion) / 100) * (currentPastonFormula.sand_kg + currentPastonFormula.stone_kg))
                    const mfMezcla = (stockpileData.arena?.modulo_finura * optimalProportion.proportion / 100) + 
                                    (stockpileData.piedra?.modulo_finura * (100 - optimalProportion.proportion) / 100)
                    setSuggestedFormula({
                      sand_kg: newSandKg,
                      stone_kg: newStoneKg,
                      sandPct: optimalProportion.proportion,
                      stonePct: 100 - optimalProportion.proportion,
                      mfMezcla,
                      rms: optimalProportion.rms
                    })
                    setShowFormulaSuggestionDialog(true)
                  }}
                >
                  <Calculator className="h-4 w-4" />
                  Aplicar Sugerencia al Formuleo
                </Button>
                <Link href="/formuleo" className="flex-1">
                  <Button variant="outline" className="w-full gap-2">
                    <FileText className="h-4 w-4" />
                    Ir a Formuleo
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
      
      {/* Dialog for applying formula suggestion */}
      <Dialog open={showFormulaSuggestionDialog} onOpenChange={setShowFormulaSuggestionDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calculator className="h-5 w-5" />
              Aplicar Sugerencia de Dosificación
            </DialogTitle>
            <DialogDescription>
              Esta acción actualizará la fórmula del pastón en el módulo de Formuleo
            </DialogDescription>
          </DialogHeader>
          
          {suggestedFormula && (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 bg-muted rounded-lg">
                  <div className="text-xs text-muted-foreground mb-1">Arena</div>
                  <div className="text-2xl font-bold">{suggestedFormula.sand_kg} kg</div>
                  <div className="text-xs text-muted-foreground">{suggestedFormula.sandPct}% del total</div>
                </div>
                <div className="p-3 bg-muted rounded-lg">
                  <div className="text-xs text-muted-foreground mb-1">Piedra</div>
                  <div className="text-2xl font-bold">{suggestedFormula.stone_kg} kg</div>
                  <div className="text-xs text-muted-foreground">{suggestedFormula.stonePct}% del total</div>
                </div>
              </div>
              
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex justify-between items-center">
                  <span className="text-sm">MF Mezcla Resultante:</span>
                  <span className="font-bold text-blue-700">{suggestedFormula.mfMezcla.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center text-xs text-muted-foreground mt-1">
                  <span>RMS vs Fuller:</span>
                  <span>{suggestedFormula.rms.toFixed(2)}</span>
                </div>
              </div>
              
              <div className="text-sm text-muted-foreground">
                <AlertTriangle className="h-4 w-4 inline mr-1 text-yellow-600" />
                Esta acción creará una nueva versión de la fórmula del pastón manteniendo el historial de cambios.
              </div>
            </div>
          )}
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowFormulaSuggestionDialog(false)}>
              Cancelar
            </Button>
            <Button 
              onClick={async () => {
                if (!suggestedFormula || !currentPastonFormula) return
                
                // Update paston formula
                const { error } = await supabase
                  .from("paston_formulas")
                  .update({
                    sand_kg: suggestedFormula.sand_kg,
                    stone_kg: suggestedFormula.stone_kg,
                    modified_by: "Sistema (Análisis Granulométrico)",
                    modified_at: new Date().toISOString(),
                  })
                  .eq("id", currentPastonFormula.id)
                
                if (!error) {
                  // Record history
                  await supabase.from("paston_formulas_history").insert({
                    paston_formula_id: currentPastonFormula.id,
                    plant: selectedPlant,
                    modified_by: "Sistema (Análisis Granulométrico)",
                    change_reason: `Ajuste automático basado en análisis granulométrico. MF Arena: ${stockpileData.arena?.modulo_finura?.toFixed(2)}, MF Piedra: ${stockpileData.piedra?.modulo_finura?.toFixed(2)}, MF Mezcla objetivo: ${suggestedFormula.mfMezcla.toFixed(2)}`,
                    previous_values: {
                      sand_kg: currentPastonFormula.sand_kg,
                      stone_kg: currentPastonFormula.stone_kg,
                    },
                    new_values: {
                      sand_kg: suggestedFormula.sand_kg,
                      stone_kg: suggestedFormula.stone_kg,
                    },
                  })
                  
                  setShowFormulaSuggestionDialog(false)
                  loadPastonFormula()
                  // Show success (could add toast here)
                  alert("Fórmula actualizada exitosamente")
                } else {
                  alert("Error al actualizar la fórmula: " + error.message)
                }
              }}
              className="gap-2"
            >
              <CheckCircle2 className="h-4 w-4" />
              Confirmar y Aplicar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
