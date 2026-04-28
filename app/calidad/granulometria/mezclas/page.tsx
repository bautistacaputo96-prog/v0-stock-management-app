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

// Líneas de producción con restricciones de optimización por planta
// Adoquines: semiseco, vibro-prensado (solo Ranchos)
// Caños DN 300-600: semiseco, centrifugado o vibrado (Mercedes/Silke)
// Caños DN 800-1200: semiseco, vibrado interno (Villa Rosa)
const PRODUCTION_LINES = [
  // Ranchos - Adoquines
  { id: "adoquines_ranchos", name: "Adoquines", plant: "ranchos", tma: 6.3, mfMin: 2.8, mfMax: 3.2, sandMin: 25, sandMax: 45, materials: ["arena", "piedra_0_6"] },
  // Mercedes/Silke - Caños chicos (300-600)
  { id: "canos_pequenos_mercedes", name: "Canos DN 300-600", plant: "mercedes", tma: 9.5, mfMin: 3.0, mfMax: 3.5, sandMin: 10, sandMax: 20, materials: ["arena", "piedra_0_10"] },
  // Villa Rosa - Caños grandes (800, 1000, 1200)
  { id: "canos_grandes_villa_rosa", name: "Canos DN 800-1200", plant: "villa-rosa", tma: 19, mfMin: 4.5, mfMax: 5.2, sandMin: 12, sandMax: 22, materials: ["arena", "piedra_0_10"] },
]

// Helper para obtener líneas filtradas por planta
function getProductionLinesForPlant(plant: string | null): typeof PRODUCTION_LINES {
  if (!plant) return PRODUCTION_LINES.filter(l => l.plant === "mercedes")
  return PRODUCTION_LINES.filter(l => l.plant === plant)
}

// ══════════════════════════════════════════════════════════════════════════════
// LÍMITES CALIBRADOS PARA EL MERCADO DE BUENOS AIRES
// ══════════════════════════════════════════════════════════════════════════════
// Las arenas disponibles en Buenos Aires son de río/médano con MF entre 1.70-2.00
// No existe oferta local de arena de trituración con MF > 2.30

// MF de arena - límites ajustados al mercado local
const SAND_MF_LIMITS = {
  optimal: { min: 1.80, max: 2.00 },     // Sin alerta
  acceptable: { min: 1.60, max: 1.79 },  // Alerta amarilla
  attention: { min: 1.40, max: 1.59 },   // Alerta naranja
  reject: { max: 1.40 },                  // Alerta roja - bloquear lote
}

// Alertas de arena - lógica ajustada al mercado local
const SAND_LIMITS = {
  maxClayContent: 3.0,           // C.A ≤ 3% para verde
  maxClayContentYellow: 5.0,     // C.A entre 3-5% amarilla, >5% roja
  maxPassing060: 90,             // % pasante 0.60mm ≤ 90% para verde
  maxPassing060Yellow: 95,       // % pasante 0.60mm 90-95% amarilla
  maxPassing030: 45,             // % pasante 0.30mm ≤ 45% para verde
  maxPassing030Red: 50,          // % pasante 0.30mm > 50% roja
}

// Alertas de piedra 0/6 - énfasis en polvo de trituración
const STONE_06_LIMITS = {
  maxPassing236: 25,             // % pasante 2.36mm ≤ 25% para verde
  maxPassing236Yellow: 40,       // % pasante 2.36mm 25-40% amarilla, >40% roja
  maxPassing118: 10,             // % pasante 1.18mm ≤ 10% para verde
  maxPassing118Red: 20,          // % pasante 1.18mm > 20% roja
  maxClayContent: 1.0,           // C.A ≤ 1% para verde
  maxClayContentYellow: 3.0,     // C.A 1-3% amarilla, >3% roja
}

// Nota del mercado local
const MARKET_NOTE = "El mercado local de Buenos Aires no dispone de arenas con MF superior a 2.0. Los límites están calibrados a la oferta disponible."

// Mensaje para perfil granulométrico típico de arena local
const LOCAL_SAND_PROFILE_MESSAGE = "Perfil granulométrico típico de arena local. La deficiencia en fracción gruesa (≥ 1.18 mm) no puede corregirse con cambio de proveedor en este mercado. Se recomienda compensar con una piedra que tenga bajo contenido de finos (C.A < 1%) para no agravar el exceso de finos en la mezcla."

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

// ══════════════════════════════════════════════════════════════════════════════
// FUNCIONES DE EVALUACIÓN DE ALERTAS
// ══════════════════════════════════════════════════════════════════════════════

// Evaluar estado de arena según límites del mercado local
function evaluateSandAlert(mf: number | null, clayContent: number | null, passing060: number | null, passing030: number | null): {
  status: "green" | "yellow" | "orange" | "red"
  messages: string[]
} {
  const messages: string[] = []
  let status: "green" | "yellow" | "orange" | "red" = "green"
  
  // Evaluar contenido de arcilla
  if (clayContent !== null) {
    if (clayContent > SAND_LIMITS.maxClayContentYellow) {
      status = "red"
      messages.push(`C.A = ${clayContent.toFixed(1)}% excede el límite máximo (>${SAND_LIMITS.maxClayContentYellow}%)`)
    } else if (clayContent > SAND_LIMITS.maxClayContent) {
      if (status !== "red") status = "yellow"
      messages.push(`C.A = ${clayContent.toFixed(1)}% elevado (>${SAND_LIMITS.maxClayContent}%)`)
    }
  }
  
  // Evaluar MF
  if (mf !== null) {
    if (mf < SAND_MF_LIMITS.reject.max) {
      status = "red"
      messages.push(`MF = ${mf.toFixed(2)} muy bajo (<${SAND_MF_LIMITS.reject.max})`)
    } else if (mf < SAND_MF_LIMITS.attention.min) {
      if (status !== "red") status = "orange"
      messages.push(`MF = ${mf.toFixed(2)} requiere atención`)
    } else if (mf < SAND_MF_LIMITS.acceptable.min) {
      if (status !== "red" && status !== "orange") status = "yellow"
      messages.push(`MF = ${mf.toFixed(2)} aceptable pero bajo`)
    }
  }
  
  // Evaluar % pasante 0.60mm
  if (passing060 !== null) {
    if (passing060 > SAND_LIMITS.maxPassing060Yellow) {
      if (status !== "red") status = "yellow"
      messages.push(`Pasante 0.60mm = ${passing060.toFixed(1)}% elevado`)
    } else if (passing060 > SAND_LIMITS.maxPassing060) {
      if (status !== "red" && status !== "orange") status = "yellow"
      messages.push(`Pasante 0.60mm = ${passing060.toFixed(1)}% en límite`)
    }
  }
  
  // Evaluar % pasante 0.30mm
  if (passing030 !== null) {
    if (passing030 > SAND_LIMITS.maxPassing030Red) {
      status = "red"
      messages.push(`Pasante 0.30mm = ${passing030.toFixed(1)}% excede límite (>${SAND_LIMITS.maxPassing030Red}%)`)
    } else if (passing030 > SAND_LIMITS.maxPassing030) {
      if (status !== "red") status = "yellow"
      messages.push(`Pasante 0.30mm = ${passing030.toFixed(1)}% elevado`)
    }
  }
  
  return { status, messages }
}

// Evaluar estado de piedra 0/6
function evaluateStone06Alert(clayContent: number | null, passing236: number | null, passing118: number | null): {
  status: "green" | "yellow" | "red"
  messages: string[]
} {
  const messages: string[] = []
  let status: "green" | "yellow" | "red" = "green"
  
  // Evaluar contenido de arcilla/polvo
  if (clayContent !== null) {
    if (clayContent > STONE_06_LIMITS.maxClayContentYellow) {
      status = "red"
      messages.push(`C.A = ${clayContent.toFixed(1)}% excede límite (>${STONE_06_LIMITS.maxClayContentYellow}%)`)
    } else if (clayContent > STONE_06_LIMITS.maxClayContent) {
      if (status !== "red") status = "yellow"
      messages.push(`C.A = ${clayContent.toFixed(1)}% elevado (>${STONE_06_LIMITS.maxClayContent}%)`)
    }
  }
  
  // Evaluar % pasante 2.36mm
  if (passing236 !== null) {
    if (passing236 > STONE_06_LIMITS.maxPassing236Yellow) {
      status = "red"
      messages.push(`Pasante 2.36mm = ${passing236.toFixed(1)}% excede límite`)
    } else if (passing236 > STONE_06_LIMITS.maxPassing236) {
      if (status !== "red") status = "yellow"
      messages.push(`Pasante 2.36mm = ${passing236.toFixed(1)}% con exceso de finos`)
    }
  }
  
  // Evaluar % pasante 1.18mm
  if (passing118 !== null) {
    if (passing118 > STONE_06_LIMITS.maxPassing118Red) {
      status = "red"
      messages.push(`Pasante 1.18mm = ${passing118.toFixed(1)}% excede límite`)
    } else if (passing118 > STONE_06_LIMITS.maxPassing118) {
      if (status !== "red") status = "yellow"
      messages.push(`Pasante 1.18mm = ${passing118.toFixed(1)}% elevado`)
    }
  }
  
  return { status, messages }
}

// Detectar perfil típico de arena local (deficiencia en fracción gruesa)
function isTypicalLocalSandProfile(passingPercentages: Record<string, number> | null): boolean {
  if (!passingPercentages) return false
  const passing118 = passingPercentages["1.18"] ?? passingPercentages["1.18mm"]
  const passing060 = passingPercentages["0.60"] ?? passingPercentages["0.60mm"] ?? passingPercentages["0.6"]
  // Arena local típica: muy poco retenido en ≥1.18mm y alto pasante en 0.60mm
  return (passing118 !== undefined && passing118 > 95) && (passing060 !== undefined && passing060 > 80)
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

// Encontrar proporción óptima teórica (sin restricciones)
function findOptimalProportionTheoretical(passing1: number[], passing2: number[], tma: number): { proportion: number; rms: number } {
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

// Encontrar proporción óptima práctica (con restricciones por tipo de producto)
function findOptimalProportion(passing1: number[], passing2: number[], tma: number, sandMin: number = 0, sandMax: number = 100): { proportion: number; rms: number; theoretical: { proportion: number; rms: number } } {
  const fullerCurve = calculateFullerThompson(tma)
  let bestProportion = sandMin
  let bestRMS = Infinity
  
  // Calcular óptimo teórico primero
  const theoretical = findOptimalProportionTheoretical(passing1, passing2, tma)
  
  // Buscar óptimo dentro de las restricciones
  for (let p = sandMin; p <= sandMax; p++) {
    const blend = calculateBlendCurve(passing1, passing2, p)
    const rms = calculateRMS(blend, fullerCurve)
    
    if (rms < bestRMS) {
      bestRMS = rms
      bestProportion = p
    }
  }
  
  return { proportion: bestProportion, rms: bestRMS, theoretical }
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
  
  // Líneas de producción filtradas por planta
  const availableLines = useMemo(() => getProductionLinesForPlant(selectedPlant), [selectedPlant])
  const [selectedLine, setSelectedLine] = useState(availableLines[0]?.id || "")
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
  
  // Cuando cambia la planta, auto-seleccionar la primera línea disponible
  useEffect(() => {
    const linesForPlant = getProductionLinesForPlant(selectedPlant)
    if (linesForPlant.length > 0 && !linesForPlant.find(l => l.id === selectedLine)) {
      setSelectedLine(linesForPlant[0].id)
    }
  }, [selectedPlant])
  
  const currentLine = availableLines.find(l => l.id === selectedLine) || availableLines[0] || PRODUCTION_LINES[0]
  
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
  findOptimalProportion(sandPassing, stonePassing, currentLine.tma, currentLine.sandMin, currentLine.sandMax),
  [sandPassing, stonePassing, currentLine.tma, currentLine.sandMin, currentLine.sandMax]
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
{availableLines.map(line => (
  <SelectItem key={line.id} value={line.id}>{line.name}</SelectItem>
  ))}
                </SelectContent>
              </Select>
              <div className="flex flex-wrap gap-4 text-sm text-muted-foreground ml-auto">
                <span>TMA: <strong>{currentLine.tma}mm</strong></span>
                <span>MF óptimo: <strong>{currentLine.mfMin} - {currentLine.mfMax}</strong></span>
                <span className="text-amber-600">Arena: <strong>{currentLine.sandMin} - {currentLine.sandMax}%</strong></span>
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
                      {(() => {
                        const clayContent = stockpileData.arena?.peso_humedo_g && stockpileData.arena?.peso_seco_g
                          ? ((stockpileData.arena.peso_humedo_g - stockpileData.arena.peso_seco_g) / stockpileData.arena.peso_humedo_g * 100)
                          : null
                        const passing060 = stockpileData.arena?.passing_percentages?.["0.60"] ?? stockpileData.arena?.passing_percentages?.["0.6"] ?? null
                        const passing030 = stockpileData.arena?.passing_percentages?.["0.30"] ?? stockpileData.arena?.passing_percentages?.["0.3"] ?? null
                        const sandAlert = stockpileData.arena 
                          ? evaluateSandAlert(stockpileData.arena.modulo_finura, clayContent, passing060, passing030)
                          : { status: "green" as const, messages: [] }
                        const borderColor = sandAlert.status === "red" ? "border-red-300 bg-red-50/50" 
                          : sandAlert.status === "orange" ? "border-orange-300 bg-orange-50/50"
                          : sandAlert.status === "yellow" ? "border-amber-300 bg-amber-50/50"
                          : stockpileData.arena ? "border-green-200 bg-green-50/50" : "border-yellow-200 bg-yellow-50/50"
                        const iconColor = sandAlert.status === "red" ? "text-red-600" 
                          : sandAlert.status === "orange" ? "text-orange-600"
                          : sandAlert.status === "yellow" ? "text-amber-600"
                          : "text-green-600"
                        
                        return (
                          <div className={`border rounded-lg p-4 ${borderColor}`}>
                            <div className="flex justify-between items-start mb-2">
                              <div>
                                <h4 className="font-medium flex items-center gap-2">
                                  Arena
                                  {stockpileData.arena ? (
                                    sandAlert.status === "green" ? <CheckCircle2 className={`h-4 w-4 ${iconColor}`} /> : <AlertTriangle className={`h-4 w-4 ${iconColor}`} />
                                  ) : (
                                    <AlertTriangle className="h-4 w-4 text-yellow-600" />
                                  )}
                                </h4>
                                {stockpileData.arena && (
                                  <div className="text-xs text-muted-foreground">
                                    <span className={stockpileData.arena.modulo_finura && stockpileData.arena.modulo_finura < SAND_MF_LIMITS.acceptable.min ? "text-amber-600 font-medium" : ""}>
                                      MF: {stockpileData.arena.modulo_finura?.toFixed(2)}
                                    </span>
                                    {clayContent !== null && (
                                      <span className={`ml-2 font-medium ${
                                        clayContent > SAND_LIMITS.maxClayContentYellow ? "text-red-600" 
                                        : clayContent > SAND_LIMITS.maxClayContent ? "text-amber-600" : "text-green-600"
                                      }`}>
                                        | C.A: {clayContent.toFixed(1)}%
                                        {clayContent > SAND_LIMITS.maxClayContent && " (!)"}
                                      </span>
                                    )}
                                    <span className="block">Ensayado: {new Date(stockpileData.arena.test_date).toLocaleDateString("es-AR")} por {stockpileData.arena.tested_by}</span>
                                  </div>
                                )}
                              </div>
                              {!stockpileData.arena && (
                                <Badge variant="outline" className="text-yellow-700">Sin datos</Badge>
                              )}
                            </div>
                            {stockpileData.arena?.passing && (
                              <div className="grid grid-cols-7 gap-1 text-xs mt-2">
                                {SIEVE_SIZES_MM.map((size, i) => (
                                  <div key={size} className="text-center bg-white/50 rounded p-1">
                                    <div className="font-medium">{size}mm</div>
                                    <div>{stockpileData.arena.passing[i]?.toFixed(1)}%</div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })()}
                      
                      {/* Piedra Stockpile */}
                      {(() => {
                        const clayContent = stockpileData.piedra_0_6?.peso_humedo_g && stockpileData.piedra_0_6?.peso_seco_g
                          ? ((stockpileData.piedra_0_6.peso_humedo_g - stockpileData.piedra_0_6.peso_seco_g) / stockpileData.piedra_0_6.peso_humedo_g * 100)
                          : null
                        const passing236 = stockpileData.piedra?.passing_percentages?.["2.36"] ?? null
                        const passing118 = stockpileData.piedra?.passing_percentages?.["1.18"] ?? null
                        const stoneAlert = stockpileData.piedra_0_6 
                          ? evaluateStone06Alert(clayContent, passing236, passing118)
                          : { status: "green" as const, messages: [] }
                        const borderColor = stoneAlert.status === "red" ? "border-red-300 bg-red-50/50" 
                          : stoneAlert.status === "yellow" ? "border-amber-300 bg-amber-50/50"
                          : stockpileData.piedra ? "border-green-200 bg-green-50/50" : "border-yellow-200 bg-yellow-50/50"
                        const iconColor = stoneAlert.status === "red" ? "text-red-600" 
                          : stoneAlert.status === "yellow" ? "text-amber-600"
                          : "text-green-600"
                        
                        return (
                          <div className={`border rounded-lg p-4 ${borderColor}`}>
                            <div className="flex justify-between items-start mb-2">
                              <div>
                                <h4 className="font-medium flex items-center gap-2">
                                  Piedra {selectedPlant === "ranchos" ? "0/6" : "0/10"}
                                  {stockpileData.piedra ? (
                                    stoneAlert.status === "green" ? <CheckCircle2 className={`h-4 w-4 ${iconColor}`} /> : <AlertTriangle className={`h-4 w-4 ${iconColor}`} />
                                  ) : (
                                    <AlertTriangle className="h-4 w-4 text-yellow-600" />
                                  )}
                                </h4>
                                {stockpileData.piedra && (
                                  <div className="text-xs text-muted-foreground">
                                    <span>MF: {stockpileData.piedra.modulo_finura?.toFixed(2)}</span>
                                    {clayContent !== null && (
                                      <span className={`ml-2 font-medium ${
                                        clayContent > STONE_06_LIMITS.maxClayContentYellow ? "text-red-600" 
                                        : clayContent > STONE_06_LIMITS.maxClayContent ? "text-amber-600" : "text-green-600"
                                      }`}>
                                        | C.A: {clayContent.toFixed(1)}%
                                        {clayContent > STONE_06_LIMITS.maxClayContent && " (!)"}
                                      </span>
                                    )}
                                    <span className="block">Ensayado: {new Date(stockpileData.piedra.test_date).toLocaleDateString("es-AR")} por {stockpileData.piedra.tested_by}</span>
                                  </div>
                                )}
                              </div>
                              {!stockpileData.piedra && (
                                <Badge variant="outline" className="text-yellow-700">Sin datos</Badge>
                              )}
                            </div>
                            {stockpileData.piedra?.passing && (
                              <div className="grid grid-cols-7 gap-1 text-xs mt-2">
                                {SIEVE_SIZES_MM.map((size, i) => (
                                  <div key={size} className="text-center bg-white/50 rounded p-1">
                                    <div className="font-medium">{size}mm</div>
                                    <div>{stockpileData.piedra.passing[i]?.toFixed(1)}%</div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })()}
                      
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
                  <div className="flex-1 space-y-3">
                    <div>
                      <h4 className="font-medium text-sm text-muted-foreground">Optimo Practico (Recomendado)</h4>
                      <p className="text-2xl font-bold text-primary">
                        {optimalResult.proportion}% arena / {100 - optimalResult.proportion}% piedra
                      </p>
                      <p className="text-sm text-muted-foreground">
                        RMS: {optimalResult.rms.toFixed(1)} | Restriccion: {currentLine.sandMin}-{currentLine.sandMax}% arena
                      </p>
                      
                      {/* Kilogramos por pastón - desde formuleo */}
                      {currentPastonFormula && (currentPastonFormula.sand_kg > 0 || currentPastonFormula.stone_kg > 0) && (() => {
                        const totalAgg = currentPastonFormula.sand_kg + currentPastonFormula.stone_kg
                        const optSandKg = Math.round((optimalResult.proportion / 100) * totalAgg)
                        const optStoneKg = Math.round(((100 - optimalResult.proportion) / 100) * totalAgg)
                        const currentSandKg = currentPastonFormula.sand_kg
                        const currentStoneKg = currentPastonFormula.stone_kg
                        const diffSandKg = optSandKg - currentSandKg
                        const diffStoneKg = optStoneKg - currentStoneKg
                        
                        return (
                          <div className="mt-3 p-3 bg-white border border-primary/20 rounded-lg">
                            <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                              Sugerencia para Paston (Total agregados: {totalAgg} kg)
                            </h5>
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <p className="text-sm text-muted-foreground">Arena</p>
                                <p className="text-xl font-bold text-primary">{optSandKg} kg</p>
                                <p className="text-xs text-muted-foreground">
                                  Actual: {currentSandKg} kg
                                  {diffSandKg !== 0 && (
                                    <span className={diffSandKg > 0 ? "text-green-600 ml-1" : "text-red-600 ml-1"}>
                                      ({diffSandKg > 0 ? "+" : ""}{diffSandKg} kg)
                                    </span>
                                  )}
                                </p>
                              </div>
                              <div>
                                <p className="text-sm text-muted-foreground">Piedra</p>
                                <p className="text-xl font-bold text-primary">{optStoneKg} kg</p>
                                <p className="text-xs text-muted-foreground">
                                  Actual: {currentStoneKg} kg
                                  {diffStoneKg !== 0 && (
                                    <span className={diffStoneKg > 0 ? "text-green-600 ml-1" : "text-red-600 ml-1"}>
                                      ({diffStoneKg > 0 ? "+" : ""}{diffStoneKg} kg)
                                    </span>
                                  )}
                                </p>
                              </div>
                            </div>
                            {(diffSandKg !== 0 || diffStoneKg !== 0) && (
                              <p className="text-xs text-muted-foreground mt-2 pt-2 border-t">
                                Ajuste sugerido: {diffSandKg > 0 ? "aumentar" : "reducir"} arena en {Math.abs(diffSandKg)} kg 
                                y {diffStoneKg > 0 ? "aumentar" : "reducir"} piedra en {Math.abs(diffStoneKg)} kg
                              </p>
                            )}
                          </div>
                        )
                      })()}
                    </div>
                    
                    {/* Óptimo teórico si es diferente del práctico */}
                    {optimalResult.theoretical && Math.abs(optimalResult.theoretical.proportion - optimalResult.proportion) > 1 && (
                      <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                        <h4 className="font-medium text-sm text-amber-800 flex items-center gap-1">
                          <Lightbulb className="h-4 w-4" />
                          Optimo Teorico (Referencia)
                        </h4>
                        <p className="text-lg font-semibold text-amber-700">
                          {optimalResult.theoretical.proportion}% arena / {100 - optimalResult.theoretical.proportion}% piedra
                        </p>
                        <p className="text-sm text-amber-600">
                          RMS: {optimalResult.theoretical.rms.toFixed(1)} | 
                          Diferencia: +{(optimalResult.rms - optimalResult.theoretical.rms).toFixed(1)} puntos
                        </p>
                        
                        {/* Kilogramos teóricos */}
                        {currentPastonFormula && (currentPastonFormula.sand_kg > 0 || currentPastonFormula.stone_kg > 0) && (() => {
                          const totalAgg = currentPastonFormula.sand_kg + currentPastonFormula.stone_kg
                          const theoSandKg = Math.round((optimalResult.theoretical.proportion / 100) * totalAgg)
                          const theoStoneKg = Math.round(((100 - optimalResult.theoretical.proportion) / 100) * totalAgg)
                          return (
                            <p className="text-xs text-amber-700 mt-1">
                              En kg: {theoSandKg} kg arena / {theoStoneKg} kg piedra
                            </p>
                          )
                        })()}
                        
                        <p className="text-xs text-amber-700 mt-2 leading-relaxed">
                          La proporcion optima teorica queda fuera del rango operativo para este producto. 
                          Se recomienda la proporcion practica para garantizar cohesion y trabajabilidad de la mezcla.
                        </p>
                      </div>
                    )}
                    
                    {optimalResult.rms < currentRMS && (
                      <p className="text-sm text-green-600">
                        Mejora de {(currentRMS - optimalResult.rms).toFixed(1)} puntos vs proporcion actual
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
            
            {/* ══════════════════════════════════════════════════════════════════════════════
                ALERTAS DE CALIDAD - CALIBRADAS PARA MERCADO DE BUENOS AIRES
                ══════════════════════════════════════════════════════════════════════════════ */}
            
            {/* Nota del mercado local */}
            <Card className="border-blue-200 bg-blue-50/50">
              <CardContent className="py-3">
                <p className="text-xs text-blue-700 flex items-start gap-2">
                  <Lightbulb className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  {MARKET_NOTE}
                </p>
              </CardContent>
            </Card>
            
            {/* Alerta de Arena */}
            {stockpileData.arena && (() => {
              const clayContent = stockpileData.arena.peso_humedo_g && stockpileData.arena.peso_seco_g
                ? ((stockpileData.arena.peso_humedo_g - stockpileData.arena.peso_seco_g) / stockpileData.arena.peso_humedo_g * 100)
                : null
              const passing060 = stockpileData.arena.passing_percentages?.["0.60"] ?? stockpileData.arena.passing_percentages?.["0.6"] ?? null
              const passing030 = stockpileData.arena.passing_percentages?.["0.30"] ?? stockpileData.arena.passing_percentages?.["0.3"] ?? null
              const sandAlert = evaluateSandAlert(stockpileData.arena.modulo_finura, clayContent, passing060, passing030)
              const isTypicalProfile = isTypicalLocalSandProfile(stockpileData.arena.passing_percentages)
              
              if (sandAlert.status === "red") {
                return (
                  <Card className="border-red-500 bg-red-50">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2 text-red-700">
                        <AlertTriangle className="h-5 w-5" />
                        ARENA RECHAZADA - Fuera de límites operativos
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="text-sm text-red-700 space-y-1">
                        {sandAlert.messages.map((msg, i) => <li key={i}>• {msg}</li>)}
                      </ul>
                      <p className="text-sm text-red-600 mt-2 font-medium">
                        Arena fuera de límites operativos. No usar en producción.
                      </p>
                    </CardContent>
                  </Card>
                )
              } else if (sandAlert.status === "orange") {
                return (
                  <Card className="border-orange-500 bg-orange-50">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2 text-orange-700">
                        <AlertTriangle className="h-5 w-5" />
                        ARENA - Requiere atención de Calidad
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="text-sm text-orange-700 space-y-1">
                        {sandAlert.messages.map((msg, i) => <li key={i}>• {msg}</li>)}
                      </ul>
                      <p className="text-sm text-orange-600 mt-2">
                        Informar al departamento de calidad para evaluación.
                      </p>
                    </CardContent>
                  </Card>
                )
              } else if (sandAlert.status === "yellow") {
                return (
                  <Card className="border-amber-400 bg-amber-50">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2 text-amber-700">
                        <AlertTriangle className="h-5 w-5" />
                        Arena aceptable con observación
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="text-sm text-amber-700 space-y-1">
                        {sandAlert.messages.map((msg, i) => <li key={i}>• {msg}</li>)}
                      </ul>
                      <p className="text-sm text-amber-600 mt-2">
                        Arena dentro del rango local pero con características que pueden aumentar la demanda de cemento. 
                        Monitorear resistencia de probetas.
                      </p>
                    </CardContent>
                  </Card>
                )
              } else if (isTypicalProfile) {
                return (
                  <Card className="border-blue-300 bg-blue-50/50">
                    <CardContent className="py-3">
                      <p className="text-xs text-blue-700">
                        <strong>Arena apta.</strong> {LOCAL_SAND_PROFILE_MESSAGE}
                      </p>
                    </CardContent>
                  </Card>
                )
              }
              return null
            })()}
            
            {/* Alerta de Piedra 0/6 */}
            {stockpileData.piedra_0_6 && (() => {
              const clayContent = stockpileData.piedra_0_6.peso_humedo_g && stockpileData.piedra_0_6.peso_seco_g
                ? ((stockpileData.piedra_0_6.peso_humedo_g - stockpileData.piedra_0_6.peso_seco_g) / stockpileData.piedra_0_6.peso_humedo_g * 100)
                : null
              const passing236 = stockpileData.piedra_0_6.passing_percentages?.["2.36"] ?? null
              const passing118 = stockpileData.piedra_0_6.passing_percentages?.["1.18"] ?? null
              const stoneAlert = evaluateStone06Alert(clayContent, passing236, passing118)
              
              if (stoneAlert.status === "red") {
                return (
                  <Card className="border-red-500 bg-red-50">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2 text-red-700">
                        <AlertTriangle className="h-5 w-5" />
                        PIEDRA 0/6 RECHAZADA - Fuera de especificación
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="text-sm text-red-700 space-y-1">
                        {stoneAlert.messages.map((msg, i) => <li key={i}>• {msg}</li>)}
                      </ul>
                      <p className="text-sm text-red-600 mt-2">
                        Piedra fuera de especificación IRAM 1627 para árido grueso fino. 
                        Reclamar certificado de granulometría al proveedor y evaluar rechazo del lote.
                      </p>
                    </CardContent>
                  </Card>
                )
              } else if (stoneAlert.status === "yellow") {
                return (
                  <Card className="border-amber-400 bg-amber-50">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2 text-amber-700">
                        <AlertTriangle className="h-5 w-5" />
                        Piedra 0/6 con exceso de finos
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="text-sm text-amber-700 space-y-1">
                        {stoneAlert.messages.map((msg, i) => <li key={i}>• {msg}</li>)}
                      </ul>
                      <p className="text-sm text-amber-600 mt-2">
                        La piedra presenta exceso de finos de trituración. Esto agrava la finura de la mezcla 
                        cuando se combina con arenas locales. Considerar solicitar material lavado al proveedor.
                      </p>
                    </CardContent>
                  </Card>
                )
              }
              return null
            })()}
            
            {/* Alerta cuando ambos áridos tienen exceso de finos */}
            {stockpileData.arena && stockpileData.piedra_0_6 && (() => {
              const sandPassing060 = stockpileData.arena.passing_percentages?.["0.60"] ?? stockpileData.arena.passing_percentages?.["0.6"] ?? 0
              const stonePassing236 = stockpileData.piedra_0_6.passing_percentages?.["2.36"] ?? 0
              
              if (sandPassing060 > 80 && stonePassing236 > 25) {
                return (
                  <Card className="border-purple-400 bg-purple-50">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2 text-purple-700">
                        <Lightbulb className="h-5 w-5" />
                        Recomendación - Ambos áridos con exceso de finos
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-purple-700">
                        Ambos áridos presentan exceso de finos respecto a la curva ideal. 
                        La optimización de proporción tiene impacto limitado en este caso.
                      </p>
                      <p className="text-sm text-purple-600 mt-2 font-medium">
                        La mejora más significativa se lograría reemplazando la piedra 0/6 por una piedra 
                        con menor contenido de polvo de trituración, como una piedra 0/10 lavada.
                      </p>
                    </CardContent>
                  </Card>
                )
              }
              return null
            })()}
            
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
