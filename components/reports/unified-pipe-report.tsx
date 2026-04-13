"use client"

import { useState, useEffect, useRef, useMemo } from "react"
import { getSupabase } from "@/lib/supabase"
import { usePlant } from "@/lib/plant-context"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { 
  FileDown, Search, Eye, TrendingUp, TrendingDown, Minus, 
  Calendar, Loader2, AlertTriangle
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, 
  Tooltip, ResponsiveContainer, ReferenceLine
} from "recharts"

const PIPE_DIAMETERS = [300, 400, 500, 600, 800, 1000, 1200]

interface PeriodData {
  // Producción (del parte diario)
  totalUnits: number
  totalWeightTn: number
  byDiameter: Record<number, { produced: number; reprocessed: number; weightKg: number }>
  dailyProduction: { date: string; units: number; weightTn: number; scrapBoxes: number; reprocessed: number }[]
  reprocessedUnits: number
  reprocessedTn: number
  
  // Planificación
  totalPlanned: number
  byDiameterPlanned: Record<number, number>
  
  // Cajones de desperdicio (del parte diario)
  totalScrapBoxes: number
  totalScrapTn: number
  scrapBoxWeight: number
  
  // Calidad (del control de calidad)
  qualityData: {
    totalFirst: number
    totalSecond: number
    totalBroken: number
    firstTn: number
    secondTn: number
    brokenTn: number
    byDiameter: Record<number, { first: number; second: number; broken: number }>
    topDefects: { reason: string; count: number; percentage: number }[]
  } | null
  
  // Paradas
  totalDowntimeMinutes: number
  availableMinutes: number
  effectiveMinutes: number
  topDowntimes: { reason: string; minutes: number; percentage: number; topComment: string }[]
  
  // Fórmulas materia prima
  materialConsumption: Record<string, { total: number; byDiameter: Record<number, number> }> | null
  
  // Métricas calculadas
  qualityIndex: number
  wasteIndex: number
  availabilityIndex: number
  planCompliance: number
  // Desglose en TONELADAS
  totalProducidoTn: number
  canosPlayaTn: number
  primeraTn: number
  segundaTn: number
  rotosCalidadTn: number
  roturaProduccionTn: number
  totalDesperdicioTn: number
  // Desglose en UNIDADES
  canosPlayaUnits: number
  primeraUnits: number
  segundaUnits: number
  rotosCalidadUnits: number
  roturaProduccionUnits: number
  // Índices individuales
  secondIndex: number
  brokenIndex: number
  scrapIndex: number
  roturaEnCajonesIndex: number
  daysWorked: number
  avgDowntimePerDay: number
}

// Componente Delta para mostrar variación
function DeltaIndicator({ current, previous, unit = "", invert = false, showPP = false }: { 
  current: number; previous: number; unit?: string; invert?: boolean; showPP?: boolean 
}) {
  if (previous === 0) return <span className="text-xs text-muted-foreground">sin ref.</span>
  
  const diff = showPP ? current - previous : ((current - previous) / previous) * 100
  const isPositive = invert ? diff < 0 : diff > 0
  const isNeutral = Math.abs(diff) < 0.1
  
  if (isNeutral) return (
    <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
      <Minus className="w-3 h-3" /> 0{showPP ? "pp" : "%"}
    </span>
  )
  
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
      {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {diff > 0 ? '+' : ''}{diff.toFixed(1)}{showPP ? "pp" : "%"}
    </span>
  )
}

export function UnifiedPipeReport() {
  const { selectedPlant } = usePlant()
  const supabase = getSupabase()
  const { toast } = useToast()
  
  // Estados
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [currentPeriod, setCurrentPeriod] = useState<PeriodData | null>(null)
  const [previousPeriod, setPreviousPeriod] = useState<PeriodData | null>(null)
  const [pipeWeights, setPipeWeights] = useState<Record<number, number>>({})
  const [formulas, setFormulas] = useState<Record<number, { cement: number; sand: number; stone: number; additive: number }>>({})
  
  // Previews
  const [showFullPreview, setShowFullPreview] = useState(false)
  const [showExecutivePreview, setShowExecutivePreview] = useState(false)
  
  const reportRef = useRef<HTMLDivElement>(null)
  const executiveRef = useRef<HTMLDivElement>(null)

  // Calcular la última semana con producción al cargar
  useEffect(() => {
    async function findLastWeekWithProduction() {
      const { data } = await supabase
        .from("pipe_production")
        .select("production_date")
        .or(`plant.is.null,plant.eq.${selectedPlant}`)
        .order("production_date", { ascending: false })
        .limit(1)
      
      if (data && data.length > 0) {
        const lastDate = new Date(data[0].production_date)
        // Encontrar el lunes de esa semana
        const dayOfWeek = lastDate.getDay()
        const monday = new Date(lastDate)
        monday.setDate(lastDate.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1))
        // El viernes de esa semana
        const friday = new Date(monday)
        friday.setDate(monday.getDate() + 4)
        
        setStartDate(monday.toISOString().split("T")[0])
        setEndDate(friday.toISOString().split("T")[0])
      } else {
        // Default: última semana
        const today = new Date()
        const dayOfWeek = today.getDay()
        const monday = new Date(today)
        monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1) - 7)
        const friday = new Date(monday)
        friday.setDate(monday.getDate() + 4)
        
        setStartDate(monday.toISOString().split("T")[0])
        setEndDate(friday.toISOString().split("T")[0])
      }
    }
    
    findLastWeekWithProduction()
  }, [selectedPlant, supabase])

  // Función para cargar datos de un período
  async function loadPeriodData(periodStart: string, periodEnd: string): Promise<PeriodData | null> {
    const plantFilter = selectedPlant === "silke" ? "silke" : selectedPlant

    // 1. Cargar configuración de pesos
    const { data: productConfig } = await supabase
      .from("product_config")
      .select("product_code, piece_weight_kg")
      .eq("line_type", "caños")
      .eq("is_active", true)

    const weights: Record<number, number> = {
      300: 95, 400: 150, 500: 220, 600: 310, 800: 520, 1000: 1080, 1200: 1100
    }
    let scrapBoxWeight = 150

    if (productConfig) {
      productConfig.forEach((p: any) => {
        const match = p.product_code?.match(/CC(\d+)/)
        if (match && p.piece_weight_kg) {
          weights[parseInt(match[1])] = p.piece_weight_kg
        }
        if (p.product_code === "CAJON-DESP" && p.piece_weight_kg) {
          scrapBoxWeight = p.piece_weight_kg
        }
      })
    }
    setPipeWeights(weights)

    // 2. Cargar fórmulas de materia prima
    const { data: mixDesigns } = await supabase
      .from("pipe_mix_designs")
      .select("diameter, cement_kg, sand_kg, stone_kg, additive_liters, pipe_weight_kg")
      .eq("is_active", true)
      .or(`plant.is.null,plant.eq.${plantFilter}`)

    const formulasData: Record<number, { cement: number; sand: number; stone: number; additive: number }> = {}
    mixDesigns?.forEach((f: any) => {
      formulasData[f.diameter] = {
        cement: f.cement_kg || 0,
        sand: f.sand_kg || 0,
        stone: f.stone_kg || 0,
        additive: f.additive_liters || 0
      }
      if (f.pipe_weight_kg) weights[f.diameter] = f.pipe_weight_kg
    })
    setFormulas(formulasData)

    // 3. Cargar producción del parte diario
    const { data: productionData } = await supabase
      .from("pipe_production")
      .select("*, pipe_downtime(id, downtime_reason_id, custom_reason, minutes, comments, downtime_category, downtime_reasons:downtime_reason_id(reason))")
      .gte("production_date", periodStart)
      .lte("production_date", periodEnd)
      .or(`plant.is.null,plant.eq.${plantFilter}`)
      .order("production_date", { ascending: true })

    if (!productionData || productionData.length === 0) {
      return null
    }

    // Filtrar solo días laborables (lunes a viernes) - la producción solo se carga L-V
    const weekdayProductionData = productionData.filter((p: any) => {
      const date = new Date(p.production_date + "T12:00:00")
      const dayOfWeek = date.getDay() // 0 = Domingo, 6 = Sábado
      return dayOfWeek !== 0 && dayOfWeek !== 6
    })

    if (weekdayProductionData.length === 0) {
      return null
    }

    // Obtener fechas únicas con producción (solo días laborables)
    const productionDates = new Set(weekdayProductionData.map((p: any) => p.production_date))
    const daysWorked = productionDates.size

    // Calcular producción por diámetro y totales
    const byDiameter: Record<number, { produced: number; reprocessed: number; weightKg: number }> = {}
    let totalUnits = 0
    let totalWeightKg = 0
    let totalScrapBoxes = 0
    let reprocessedUnits = 0
    let reprocessedWeightKg = 0
    let availableMinutes = 0
    let effectiveMinutes = 0
    const dailyProd: Record<string, { units: number; weightKg: number; scrapBoxes: number; reprocessed: number }> = {}
    
    // Paradas con comentarios
    const downtimeData: Record<string, { minutes: number; comments: string[] }> = {}
    let totalDowntimeMinutes = 0

    weekdayProductionData.forEach((record: any) => {
      const dateKey = record.production_date
      if (!dailyProd[dateKey]) {
        dailyProd[dateKey] = { units: 0, weightKg: 0, scrapBoxes: 0, reprocessed: 0 }
      }

      PIPE_DIAMETERS.forEach(d => {
        const simple = record[`cc${d}_simples`] || 0
        const armado = record[`cc${d}_armado`] || 0
        const produced = simple + armado
        const weight = produced * (weights[d] || 0)
        
        // Reprocesados: de la columna "Rotura" del parte diario
        const reprocessed = (record[`cc${d}_rotura`] || 0) + (record[`cc${d}_rotura_armado`] || 0)
        const reprocessedWeight = reprocessed * (weights[d] || 0)

        if (!byDiameter[d]) byDiameter[d] = { produced: 0, reprocessed: 0, weightKg: 0 }
        byDiameter[d].produced += produced
        byDiameter[d].reprocessed += reprocessed
        byDiameter[d].weightKg += weight
        
        totalUnits += produced
        totalWeightKg += weight
        reprocessedUnits += reprocessed
        reprocessedWeightKg += reprocessedWeight
        
        dailyProd[dateKey].units += produced
        dailyProd[dateKey].weightKg += weight
        dailyProd[dateKey].reprocessed += reprocessed
      })

      // Cajones de desperdicio
      totalScrapBoxes += record.scrap_boxes || 0
      dailyProd[dateKey].scrapBoxes += record.scrap_boxes || 0

      // Minutos disponibles y efectivos (estimación si no hay campo específico)
      // Turno de 8 horas = 480 min, menos limpieza
      const shiftMinutes = 480 - (record.cleaning_minutes || 0)
      availableMinutes += shiftMinutes
      effectiveMinutes += shiftMinutes - (record.total_downtime_minutes || 0)

      // Paradas con comentarios
      record.pipe_downtime?.forEach((dt: any) => {
        const reason = dt.downtime_reasons?.reason || dt.custom_reason || "Sin especificar"
        const minutes = dt.minutes || 0
        const comment = dt.comments || ""
        
        if (!downtimeData[reason]) {
          downtimeData[reason] = { minutes: 0, comments: [] }
        }
        downtimeData[reason].minutes += minutes
        if (comment) downtimeData[reason].comments.push(comment)
        totalDowntimeMinutes += minutes
      })
    })

    // Top paradas con comentario más frecuente
    const topDowntimes = Object.entries(downtimeData)
      .sort((a, b) => b[1].minutes - a[1].minutes)
      .slice(0, 5)
      .map(([reason, data]) => {
        // Encontrar comentario más frecuente
        const commentCounts: Record<string, number> = {}
        data.comments.forEach(c => {
          commentCounts[c] = (commentCounts[c] || 0) + 1
        })
        const topComment = Object.entries(commentCounts)
          .sort((a, b) => b[1] - a[1])[0]?.[0] || ""
        
        return {
          reason,
          minutes: data.minutes,
          percentage: totalDowntimeMinutes > 0 ? (data.minutes / totalDowntimeMinutes) * 100 : 0,
          topComment
        }
      })

    // Producción diaria
    const dailyProduction = Object.entries(dailyProd)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, data]) => ({
        date,
        units: data.units,
        weightTn: data.weightKg / 1000,
        scrapBoxes: data.scrapBoxes,
        reprocessed: data.reprocessed
      }))

    // 4. Cargar planificación
    const startDateObj = new Date(periodStart)
    const endDateObj = new Date(periodEnd)
    const byDiameterPlanned: Record<number, number> = {}
    PIPE_DIAMETERS.forEach(d => { byDiameterPlanned[d] = 0 })

    // Obtener meses involucrados
    const months: { year: number; month: number }[] = []
    let currentMonth = new Date(startDateObj.getFullYear(), startDateObj.getMonth(), 1)
    while (currentMonth <= endDateObj) {
      months.push({ year: currentMonth.getFullYear(), month: currentMonth.getMonth() + 1 })
      currentMonth.setMonth(currentMonth.getMonth() + 1)
    }

    for (const { year, month } of months) {
      const { data: planningData } = await supabase
        .from("production_planning")
        .select("*")
        .eq("year", year)
        .eq("month", month)

      if (planningData) {
        planningData.forEach((row: any) => {
          const size = parseInt(row.pipe_size)
          for (let day = 1; day <= 31; day++) {
            const dayDate = new Date(year, month - 1, day)
            if (dayDate >= startDateObj && dayDate <= endDateObj) {
              const dayOfWeek = dayDate.getDay()
              // Solo días laborables
              if (dayOfWeek !== 0 && dayOfWeek !== 6) {
                byDiameterPlanned[size] = (byDiameterPlanned[size] || 0) + (row[`day_${day}`] || 0)
              }
            }
          }
        })
      }
    }

    const totalPlanned = Object.values(byDiameterPlanned).reduce((s, v) => s + v, 0)

    // 5. Cargar control de calidad (L-S, incluye sábados aunque no haya producción ese día)
    // El control del sábado corresponde a caños producidos durante la semana
    const { data: qualityControls } = await supabase
      .from("pipe_quality_control")
      .select(`
        *,
        items:pipe_quality_items(
          *,
          defects:pipe_quality_defects(
            *,
            reason:pipe_defect_reasons(reason, category)
          )
        )
      `)
      .gte("control_date", periodStart)
      .lte("control_date", periodEnd)

    // NO filtrar por días de producción - el control de calidad incluye sábados
    const filteredQuality = qualityControls || []

    let qualityData: PeriodData["qualityData"] = null
    if (filteredQuality.length > 0) {
      const qualityByDiameter: Record<number, { first: number; second: number; broken: number }> = {}
      let totalFirst = 0, totalSecond = 0, totalBroken = 0
      let firstTn = 0, secondTn = 0, brokenTn = 0
      const defectCounts: Record<string, number> = {}

      filteredQuality.forEach((control: any) => {
        control.items?.forEach((item: any) => {
          const d = item.diameter
          const weight = weights[d] || 0
          
          if (!qualityByDiameter[d]) qualityByDiameter[d] = { first: 0, second: 0, broken: 0 }
          qualityByDiameter[d].first += item.first_quality || 0
          qualityByDiameter[d].second += item.second_quality || 0
          qualityByDiameter[d].broken += item.broken || 0
          
          totalFirst += item.first_quality || 0
          totalSecond += item.second_quality || 0
          totalBroken += item.broken || 0
          
          firstTn += (item.first_quality || 0) * weight / 1000
          secondTn += (item.second_quality || 0) * weight / 1000
          brokenTn += (item.broken || 0) * weight / 1000

          item.defects?.forEach((defect: any) => {
            const reason = defect.reason?.reason || "Sin especificar"
            if (!defectCounts[reason]) defectCounts[reason] = 0
            defectCounts[reason] += defect.quantity || 1
          })
        })
      })

      const totalDefects = Object.values(defectCounts).reduce((s, v) => s + v, 0)
      const topDefects = Object.entries(defectCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([reason, count]) => ({
          reason,
          count,
          percentage: totalDefects > 0 ? (count / totalDefects) * 100 : 0
        }))

      qualityData = {
        totalFirst,
        totalSecond,
        totalBroken,
        firstTn,
        secondTn,
        brokenTn,
        byDiameter: qualityByDiameter,
        topDefects
      }
    }

    // 6. Calcular consumo de materia prima
    let materialConsumption: PeriodData["materialConsumption"] = null
    if (Object.keys(formulasData).length > 0) {
      const consumption: Record<string, { total: number; byDiameter: Record<number, number> }> = {
        "Cemento": { total: 0, byDiameter: {} },
        "Arena": { total: 0, byDiameter: {} },
        "Piedra": { total: 0, byDiameter: {} },
        "Aditivo": { total: 0, byDiameter: {} }
      }
      
      Object.entries(byDiameter).forEach(([diamStr, data]) => {
        const diam = parseInt(diamStr)
        const formula = formulasData[diam]
        if (formula && data.produced > 0) {
          consumption["Cemento"].total += formula.cement * data.produced
          consumption["Cemento"].byDiameter[diam] = formula.cement * data.produced
          
          consumption["Arena"].total += formula.sand * data.produced
          consumption["Arena"].byDiameter[diam] = formula.sand * data.produced
          
          consumption["Piedra"].total += formula.stone * data.produced
          consumption["Piedra"].byDiameter[diam] = formula.stone * data.produced
          
          consumption["Aditivo"].total += formula.additive * data.produced
          consumption["Aditivo"].byDiameter[diam] = formula.additive * data.produced
        }
      })
      
      materialConsumption = consumption
    }

    // ============================================
    // CÁLCULO DE ÍNDICES (según lógica de negocio)
    // ============================================
    // 
    // FUENTES DE DATOS:
    // - Parte Diario: Caños a playa (producidos), Rotura producción (INFO - ya incluida en cajones), Cajones desperdicio
    // - Control Calidad: Segunda, Rotos
    //
    // IMPORTANTE: La rotura de producción YA ESTÁ INCLUIDA en los cajones de desperdicio
    // Por lo tanto NO se suma al total (evitar doble conteo)
    // Se muestra como dato informativo para saber qué % de cajones es rotura
    //
    // FÓRMULAS:
    // - Primera = Caños a playa - Segunda - Rotos calidad
    // - Total Producido = Caños a playa + Cajones desperdicio (sin duplicar rotura)
    // - Total Desperdicio = Segunda + Rotos calidad + Cajones desperdicio
    // ============================================

    // TONELADAS de cada concepto
    const canosPlayaTn = totalWeightKg / 1000  // Del parte diario: van a clasificación
    const roturaProduccionTn = reprocessedWeightKg / 1000  // INFO: ya incluida en cajones
    const cajonesDesperdicioTn = (totalScrapBoxes * scrapBoxWeight) / 1000  // Del parte diario
    
    const segundaTn = qualityData?.secondTn || 0  // Del control de calidad
    const rotosCalidadTn = qualityData?.brokenTn || 0  // Del control de calidad
    
    // Primera = Caños a playa - Segunda - Rotos de calidad
    const primeraTn = Math.max(0, canosPlayaTn - segundaTn - rotosCalidadTn)
    
    // Total Producido = Caños a playa + Cajones (rotura prod ya está en cajones, no sumar)
    const totalProducidoTn = canosPlayaTn + cajonesDesperdicioTn
    
    // Total Desperdicio = Segunda + Rotos calidad + Cajones
    const totalDesperdicioTn = segundaTn + rotosCalidadTn + cajonesDesperdicioTn
    
    // UNIDADES de cada concepto (para mostrar en cantidad de caños)
    const canosPlayaUnits = totalUnits  // Del parte diario
    const roturaProduccionUnits = reprocessedUnits  // INFO: ya incluida en cajones
    const segundaUnits = qualityData?.totalSecond || 0  // Del control de calidad
    const rotosCalidadUnits = qualityData?.totalBroken || 0  // Del control de calidad
    const primeraUnits = Math.max(0, canosPlayaUnits - segundaUnits - rotosCalidadUnits)
    
    // ÍNDICES (en porcentaje sobre Total Producido en Tn)
    const qualityIndex = totalProducidoTn > 0 ? (primeraTn / totalProducidoTn) * 100 : 100
    const secondIndex = totalProducidoTn > 0 ? (segundaTn / totalProducidoTn) * 100 : 0
    const brokenIndex = totalProducidoTn > 0 ? (rotosCalidadTn / totalProducidoTn) * 100 : 0  // Solo rotos calidad, no rotura prod
    const scrapIndex = totalProducidoTn > 0 ? (cajonesDesperdicioTn / totalProducidoTn) * 100 : 0
    const wasteIndex = totalProducidoTn > 0 ? (totalDesperdicioTn / totalProducidoTn) * 100 : 0
    
    // Índice de rotura producción (informativo - % de cajones que es rotura)
    const roturaEnCajonesIndex = cajonesDesperdicioTn > 0 ? (roturaProduccionTn / cajonesDesperdicioTn) * 100 : 0
      
    const planCompliance = totalPlanned > 0 
      ? (totalUnits / totalPlanned) * 100 
      : 100
      
    const availabilityIndex = availableMinutes > 0
      ? (effectiveMinutes / availableMinutes) * 100
      : 100
      
    const avgDowntimePerDay = daysWorked > 0
      ? totalDowntimeMinutes / daysWorked
      : 0

    return {
      totalUnits,
      totalWeightTn: totalWeightKg / 1000,
      byDiameter,
      dailyProduction,
      reprocessedUnits,
      reprocessedTn: roturaProduccionTn,
      totalPlanned,
      byDiameterPlanned,
      totalScrapBoxes,
      totalScrapTn: cajonesDesperdicioTn,
      scrapBoxWeight,
      qualityData,
      totalDowntimeMinutes,
      availableMinutes,
      effectiveMinutes,
      topDowntimes,
      materialConsumption,
      // Índices principales
      qualityIndex,
      wasteIndex,
      availabilityIndex,
      planCompliance,
      // Desglose en TONELADAS
      totalProducidoTn,
      canosPlayaTn,
      primeraTn,
      segundaTn,
      rotosCalidadTn,
      roturaProduccionTn,
      totalDesperdicioTn,
      // Desglose en UNIDADES
      canosPlayaUnits,
      primeraUnits,
      segundaUnits,
      rotosCalidadUnits,
      roturaProduccionUnits,
      // Índices individuales
      secondIndex,
      brokenIndex,
      scrapIndex,
      roturaEnCajonesIndex,
      daysWorked,
      avgDowntimePerDay
    }
  }

  async function loadReport() {
    if (!startDate || !endDate) {
      toast({ title: "Error", description: "Seleccione un rango de fechas", variant: "destructive" })
      return
    }
    if (startDate > endDate) {
      toast({ title: "Error", description: "La fecha de inicio debe ser anterior a la fecha de fin", variant: "destructive" })
      return
    }

    setLoading(true)
    setSearched(true)

    try {
      // Cargar período actual
      const current = await loadPeriodData(startDate, endDate)
      setCurrentPeriod(current)

      // Calcular período anterior (misma duración)
      const startObj = new Date(startDate)
      const endObj = new Date(endDate)
      const diffDays = Math.ceil((endObj.getTime() - startObj.getTime()) / (1000 * 60 * 60 * 24)) + 1
      
      const prevEnd = new Date(startObj)
      prevEnd.setDate(prevEnd.getDate() - 1)
      const prevStart = new Date(prevEnd)
      prevStart.setDate(prevStart.getDate() - diffDays + 1)
      
      const previous = await loadPeriodData(
        prevStart.toISOString().split("T")[0],
        prevEnd.toISOString().split("T")[0]
      )
      setPreviousPeriod(previous)

    } catch (error) {
      console.error("Error loading report:", error)
      toast({ title: "Error", description: "No se pudo cargar el informe", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  async function exportPDF(type: "full" | "executive") {
    const targetRef = type === "full" ? reportRef : executiveRef
    if (!targetRef.current) return

    try {
      const { exportElementToPDF } = await import("@/lib/pdf-export")
      const filename = type === "full" 
        ? `informe-canos-${startDate}-a-${endDate}.pdf`
        : `informe-ejecutivo-canos-${startDate}-a-${endDate}.pdf`
      await exportElementToPDF(targetRef.current, filename)
      toast({ title: "PDF Generado", description: "El informe se ha exportado correctamente" })
    } catch (error) {
      console.error("Error exporting PDF:", error)
      toast({ title: "Error", description: "No se pudo generar el PDF", variant: "destructive" })
    }
  }

  const formatDate = (date: string) => {
    const d = new Date(date + "T12:00:00")
    return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" })
  }

  const formatDateShort = (date: string) => {
    const d = new Date(date + "T12:00:00")
    return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })
  }

  const getStatusColor = (value: number, target: number, invert = false) => {
    const adjusted = invert ? -value : value
    const adjustedTarget = invert ? -target : target
    if (adjusted >= adjustedTarget) return "text-green-600"
    if (adjusted >= adjustedTarget * 0.9) return "text-amber-600"
    return "text-red-600"
  }

  const getStatusBg = (value: number, target: number, invert = false) => {
    const adjusted = invert ? -value : value
    const adjustedTarget = invert ? -target : target
    if (adjusted >= adjustedTarget) return "bg-green-50 border-green-200"
    if (adjusted >= adjustedTarget * 0.9) return "bg-amber-50 border-amber-200"
    return "bg-red-50 border-red-200"
  }

  // Calcular diámetros con producción
  const activeDiameters = useMemo(() => {
    if (!currentPeriod) return []
    return PIPE_DIAMETERS.filter(d => 
      currentPeriod.byDiameter[d]?.produced > 0
    )
  }, [currentPeriod])

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Informe de Producción de Caños
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1">
              <Label className="text-xs">Fecha Inicio</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-40" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Fecha Fin</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-40" />
            </div>
            <Button onClick={loadReport} disabled={loading} className="gap-2">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Generar Informe
            </Button>
            
            {currentPeriod && (
              <>
                <div className="border-l pl-4 flex gap-2">
                  <Button variant="outline" onClick={() => setShowFullPreview(true)} className="gap-2">
                    <Eye className="h-4 w-4" />
                    Ver Informe
                  </Button>
                  <Button variant="outline" onClick={() => setShowExecutivePreview(true)} className="gap-2">
                    <Eye className="h-4 w-4" />
                    Ver Ejecutivo
                  </Button>
                </div>
                <div className="border-l pl-4 flex gap-2">
                  <Button variant="outline" onClick={() => exportPDF("full")} className="gap-2">
                    <FileDown className="h-4 w-4" />
                    PDF Informe
                  </Button>
                  <Button variant="outline" onClick={() => exportPDF("executive")} className="gap-2">
                    <FileDown className="h-4 w-4" />
                    PDF Ejecutivo
                  </Button>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Estado de carga */}
      {loading ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
            Cargando informe...
          </CardContent>
        </Card>
      ) : !searched ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Seleccione un rango de fechas y presione &quot;Generar Informe&quot;
          </CardContent>
        </Card>
      ) : !currentPeriod ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No hay datos de producción para el período seleccionado
          </CardContent>
        </Card>
      ) : (
        /* Contenido del informe */
        <div className="space-y-4">
          {/* SECCIÓN 1: KPIs PRINCIPALES */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {/* Días analizados */}
            <Card>
              <CardContent className="py-3 text-center">
                <p className="text-2xl font-bold text-primary">{currentPeriod.daysWorked}</p>
                <p className="text-[10px] text-muted-foreground uppercase">Días analizados</p>
              </CardContent>
            </Card>
            
            {/* Caños producidos */}
            <Card className="bg-primary/5 border-primary/20">
              <CardContent className="py-3 text-center">
                <p className="text-2xl font-bold text-primary">{currentPeriod.totalUnits.toLocaleString()}</p>
                <p className="text-[10px] text-muted-foreground uppercase">Caños producidos</p>
                {previousPeriod && (
                  <DeltaIndicator current={currentPeriod.totalUnits} previous={previousPeriod.totalUnits} />
                )}
              </CardContent>
            </Card>
            
            {/* Reprocesados (del parte diario - columna Rotura) */}
            <Card className="bg-amber-50 border-amber-200">
              <CardContent className="py-3 text-center">
                <p className="text-2xl font-bold text-amber-600">{currentPeriod.reprocessedUnits}</p>
                <p className="text-[10px] text-muted-foreground uppercase">Reprocesados</p>
                <p className="text-[10px] text-amber-600 font-medium">
                  {currentPeriod.reprocessedTn.toFixed(2)} Tn
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {currentPeriod.totalUnits > 0 
                    ? ((currentPeriod.reprocessedUnits / currentPeriod.totalUnits) * 100).toFixed(1) 
                    : "0"}% del total
                </p>
                {previousPeriod && (
                  <DeltaIndicator current={currentPeriod.reprocessedUnits} previous={previousPeriod.reprocessedUnits} invert />
                )}
              </CardContent>
            </Card>
            
            {/* Cajones de Desperdicio */}
            <Card>
              <CardContent className="py-3 text-center">
                <p className="text-2xl font-bold text-orange-600">{currentPeriod.totalScrapBoxes}</p>
                <p className="text-[10px] text-muted-foreground uppercase">Cajones Desp.</p>
                <p className="text-[10px] text-orange-600 font-medium">
                  {currentPeriod.totalScrapTn.toFixed(2)} Tn
                </p>
                {previousPeriod && (
                  <DeltaIndicator current={currentPeriod.totalScrapBoxes} previous={previousPeriod.totalScrapBoxes} invert />
                )}
              </CardContent>
            </Card>
            
            {/* Toneladas Producidas */}
            <Card className="bg-blue-50 border-blue-200">
              <CardContent className="py-3 text-center">
                <p className="text-2xl font-bold text-blue-600">{currentPeriod.totalWeightTn.toFixed(1)}</p>
                <p className="text-[10px] text-muted-foreground uppercase">Toneladas</p>
                {previousPeriod && (
                  <DeltaIndicator current={currentPeriod.totalWeightTn} previous={previousPeriod.totalWeightTn} />
                )}
              </CardContent>
            </Card>
            
            {/* Paradas */}
            <Card className="bg-red-50 border-red-200">
              <CardContent className="py-3 text-center">
                <p className="text-2xl font-bold text-red-600">{currentPeriod.totalDowntimeMinutes}</p>
                <p className="text-[10px] text-muted-foreground uppercase">Min. Paradas</p>
                <p className="text-[10px] text-muted-foreground">
                  Prom: {currentPeriod.avgDowntimePerDay.toFixed(0)} min/día
                </p>
                {previousPeriod && (
                  <DeltaIndicator current={currentPeriod.totalDowntimeMinutes} previous={previousPeriod.totalDowntimeMinutes} invert />
                )}
              </CardContent>
            </Card>
          </div>

          {/* SECCIÓN 2: DESGLOSE POR DIÁMETRO */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm uppercase tracking-wide">Desglose por Diámetro</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left py-2 px-2 font-medium">Diámetro</th>
                      <th className="text-center py-2 px-2 font-medium">Producido</th>
                      <th className="text-center py-2 px-2 font-medium text-amber-600">Reproc.</th>
                      <th className="text-center py-2 px-2 font-medium">Plan</th>
                      <th className="text-center py-2 px-2 font-medium">Cumpl.</th>
                      <th className="text-center py-2 px-2 font-medium text-amber-600">% Reproc.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeDiameters.map((d, idx) => {
                      const prod = currentPeriod.byDiameter[d]
                      const planned = currentPeriod.byDiameterPlanned[d] || 0
                      const compliance = planned > 0 ? (prod.produced / planned) * 100 : 100
                      const reprocessedRate = prod.produced > 0 
                        ? (prod.reprocessed / prod.produced) * 100 
                        : 0
                      
                      return (
                        <tr key={d} className={idx % 2 === 1 ? "bg-muted/30" : ""}>
                          <td className="py-2 px-2 font-medium">CC{d}</td>
                          <td className="py-2 px-2 text-center font-semibold">{prod.produced.toLocaleString()}</td>
                          <td className="py-2 px-2 text-center text-amber-600">{prod.reprocessed || "-"}</td>
                          <td className="py-2 px-2 text-center text-muted-foreground">{planned || "-"}</td>
                          <td className={`py-2 px-2 text-center font-medium ${getStatusColor(compliance, 95)}`}>
                            {planned > 0 ? `${compliance.toFixed(0)}%` : "-"}
                          </td>
                          <td className={`py-2 px-2 text-center ${reprocessedRate > 3 ? "text-amber-600 font-medium" : "text-muted-foreground"}`}>
                            {prod.reprocessed > 0 ? `${reprocessedRate.toFixed(1)}%` : "-"}
                          </td>
                        </tr>
                      )
                    })}
                    {/* Fila de totales */}
                    <tr className="border-t-2 bg-muted/50 font-semibold">
                      <td className="py-2 px-2">TOTAL</td>
                      <td className="py-2 px-2 text-center">{currentPeriod.totalUnits.toLocaleString()}</td>
                      <td className="py-2 px-2 text-center text-amber-600">{currentPeriod.reprocessedUnits}</td>
                      <td className="py-2 px-2 text-center text-muted-foreground">{currentPeriod.totalPlanned || "-"}</td>
                      <td className={`py-2 px-2 text-center ${getStatusColor(currentPeriod.planCompliance, 95)}`}>
                        {currentPeriod.planCompliance.toFixed(0)}%
                      </td>
                      <td className="py-2 px-2 text-center text-amber-600">
                        {currentPeriod.totalUnits > 0 
                          ? ((currentPeriod.reprocessedUnits / currentPeriod.totalUnits) * 100).toFixed(1) 
                          : "0"}%
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* SECCIÓN 3: ÍNDICES DE CALIDAD Y DESPERDICIO */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm uppercase tracking-wide">Índices de Calidad y Desperdicio</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Fórmulas explicativas */}
              <div className="bg-muted/50 rounded-lg p-3 text-xs space-y-1">
                <p className="font-medium text-muted-foreground mb-2">Fórmulas de cálculo:</p>
                <p><span className="text-green-600 font-medium">Primera</span> = Caños a playa - Segunda - Rotos calidad = <span className="font-bold text-green-600">{currentPeriod.primeraTn.toFixed(2)} Tn</span> ({currentPeriod.primeraUnits.toLocaleString()} u)</p>
                <p><span className="text-muted-foreground font-medium">Total Producido</span> = Caños a playa + Cajones desperdicio = <span className="font-bold">{currentPeriod.totalProducidoTn.toFixed(2)} Tn</span></p>
                <p className="text-[10px] text-muted-foreground italic mt-1">Nota: La rotura de producción ({currentPeriod.roturaProduccionUnits} u / {currentPeriod.roturaProduccionTn.toFixed(2)} Tn) ya está incluida en los cajones de desperdicio, representa el {currentPeriod.roturaEnCajonesIndex.toFixed(1)}% de los cajones</p>
              </div>

              {/* Tabla resumen en UNIDADES y TONELADAS */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left py-2 px-2 font-medium">Concepto</th>
                      <th className="text-center py-2 px-2 font-medium">Unidades</th>
                      <th className="text-center py-2 px-2 font-medium">Toneladas</th>
                      <th className="text-center py-2 px-2 font-medium">% del Total</th>
                      <th className="text-left py-2 px-2 font-medium">Fuente</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="bg-blue-50">
                      <td className="py-2 px-2 font-medium">Caños a playa</td>
                      <td className="py-2 px-2 text-center">{currentPeriod.canosPlayaUnits.toLocaleString()}</td>
                      <td className="py-2 px-2 text-center">{currentPeriod.canosPlayaTn.toFixed(2)}</td>
                      <td className="py-2 px-2 text-center">-</td>
                      <td className="py-2 px-2 text-muted-foreground">Parte diario</td>
                    </tr>
                    <tr className="bg-green-50">
                      <td className="py-2 px-2 font-medium text-green-700">Primera</td>
                      <td className="py-2 px-2 text-center font-semibold text-green-600">{currentPeriod.primeraUnits.toLocaleString()}</td>
                      <td className="py-2 px-2 text-center font-semibold text-green-600">{currentPeriod.primeraTn.toFixed(2)}</td>
                      <td className="py-2 px-2 text-center font-bold text-green-600">{currentPeriod.qualityIndex.toFixed(1)}%</td>
                      <td className="py-2 px-2 text-muted-foreground">Calculado</td>
                    </tr>
                    <tr className="bg-amber-50">
                      <td className="py-2 px-2 font-medium text-amber-700">Segunda</td>
                      <td className="py-2 px-2 text-center font-semibold text-amber-600">{currentPeriod.segundaUnits.toLocaleString()}</td>
                      <td className="py-2 px-2 text-center font-semibold text-amber-600">{currentPeriod.segundaTn.toFixed(2)}</td>
                      <td className="py-2 px-2 text-center font-bold text-amber-600">{currentPeriod.secondIndex.toFixed(2)}%</td>
                      <td className="py-2 px-2 text-muted-foreground">Control calidad</td>
                    </tr>
                    <tr className="bg-red-50">
                      <td className="py-2 px-2 font-medium text-red-700">Rotos (calidad)</td>
                      <td className="py-2 px-2 text-center font-semibold text-red-600">{currentPeriod.rotosCalidadUnits.toLocaleString()}</td>
                      <td className="py-2 px-2 text-center font-semibold text-red-600">{currentPeriod.rotosCalidadTn.toFixed(2)}</td>
                      <td className="py-2 px-2 text-center font-bold text-red-600">{currentPeriod.brokenIndex.toFixed(2)}%</td>
                      <td className="py-2 px-2 text-muted-foreground">Control calidad</td>
                    </tr>
                    <tr className="bg-orange-50">
                      <td className="py-2 px-2 font-medium text-orange-700">Cajones desperdicio</td>
                      <td className="py-2 px-2 text-center text-orange-600">{currentPeriod.totalScrapBoxes} caj</td>
                      <td className="py-2 px-2 text-center font-semibold text-orange-600">{currentPeriod.totalScrapTn.toFixed(2)}</td>
                      <td className="py-2 px-2 text-center font-bold text-orange-600">{currentPeriod.scrapIndex.toFixed(2)}%</td>
                      <td className="py-2 px-2 text-muted-foreground">Parte diario</td>
                    </tr>
                    <tr className="text-muted-foreground">
                      <td className="py-2 px-2 pl-4 text-[10px]">└ Rotura producción (incluida)</td>
                      <td className="py-2 px-2 text-center text-[10px]">{currentPeriod.roturaProduccionUnits.toLocaleString()}</td>
                      <td className="py-2 px-2 text-center text-[10px]">{currentPeriod.roturaProduccionTn.toFixed(2)}</td>
                      <td className="py-2 px-2 text-center text-[10px]">{currentPeriod.roturaEnCajonesIndex.toFixed(1)}% caj</td>
                      <td className="py-2 px-2 text-[10px]">Parte diario</td>
                    </tr>
                    <tr className="border-t-2 bg-muted/50 font-semibold">
                      <td className="py-2 px-2">TOTAL PRODUCIDO</td>
                      <td className="py-2 px-2 text-center">-</td>
                      <td className="py-2 px-2 text-center">{currentPeriod.totalProducidoTn.toFixed(2)}</td>
                      <td className="py-2 px-2 text-center">100%</td>
                      <td className="py-2 px-2"></td>
                    </tr>
                    <tr className="bg-destructive/10 font-semibold">
                      <td className="py-2 px-2 text-destructive">DESPERDICIO TOTAL</td>
                      <td className="py-2 px-2 text-center text-destructive">-</td>
                      <td className="py-2 px-2 text-center text-destructive">{currentPeriod.totalDesperdicioTn.toFixed(2)}</td>
                      <td className="py-2 px-2 text-center text-destructive">{currentPeriod.wasteIndex.toFixed(2)}%</td>
                      <td className="py-2 px-2 text-[10px] text-muted-foreground">2da + Rotos + Cajones</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Grid de índices visual */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {/* Índice de Primera (Calidad) */}
                <div className={`p-4 rounded-lg ${getStatusBg(currentPeriod.qualityIndex, 95)} border`}>
                  <p className={`text-2xl font-bold ${getStatusColor(currentPeriod.qualityIndex, 95)}`}>
                    {currentPeriod.qualityIndex.toFixed(1)}%
                  </p>
                  <p className="text-xs font-medium uppercase mt-1 text-green-700">Índice Primera</p>
                  <p className="text-sm font-semibold text-green-600">{currentPeriod.primeraTn.toFixed(2)} Tn</p>
                  <p className="text-[10px] text-muted-foreground">{currentPeriod.primeraUnits.toLocaleString()} unidades</p>
                  {previousPeriod && (
                    <DeltaIndicator 
                      current={currentPeriod.qualityIndex} 
                      previous={previousPeriod.qualityIndex}
                      showPP
                    />
                  )}
                </div>
                
                {/* Índice de Segunda */}
                <div className="p-4 rounded-lg bg-amber-50 border border-amber-200">
                  <p className="text-2xl font-bold text-amber-600">
                    {currentPeriod.secondIndex.toFixed(2)}%
                  </p>
                  <p className="text-xs font-medium uppercase mt-1 text-amber-700">Índice Segunda</p>
                  <p className="text-sm font-semibold text-amber-600">{currentPeriod.segundaTn.toFixed(2)} Tn</p>
                  <p className="text-[10px] text-muted-foreground">{currentPeriod.segundaUnits.toLocaleString()} unidades</p>
                  {previousPeriod && (
                    <DeltaIndicator 
                      current={currentPeriod.secondIndex} 
                      previous={previousPeriod.secondIndex}
                      invert
                      showPP
                    />
                  )}
                </div>
                
                {/* Índice de Rotura (solo calidad) */}
                <div className="p-4 rounded-lg bg-red-50 border border-red-200">
                  <p className="text-2xl font-bold text-red-600">
                    {currentPeriod.brokenIndex.toFixed(2)}%
                  </p>
                  <p className="text-xs font-medium uppercase mt-1 text-red-700">Índice Rotura</p>
                  <p className="text-sm font-semibold text-red-600">{currentPeriod.rotosCalidadTn.toFixed(2)} Tn</p>
                  <p className="text-[10px] text-muted-foreground">{currentPeriod.rotosCalidadUnits.toLocaleString()} unidades</p>
                  {previousPeriod && (
                    <DeltaIndicator 
                      current={currentPeriod.brokenIndex} 
                      previous={previousPeriod.brokenIndex}
                      invert
                      showPP
                    />
                  )}
                </div>

                {/* Desperdicio Total */}
                <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/30">
                  <p className="text-2xl font-bold text-destructive">
                    {currentPeriod.wasteIndex.toFixed(2)}%
                  </p>
                  <p className="text-xs font-medium uppercase mt-1 text-destructive">Desperdicio Total</p>
                  <p className="text-sm font-semibold text-destructive">{currentPeriod.totalDesperdicioTn.toFixed(2)} Tn</p>
                  <p className="text-[10px] text-muted-foreground">2da + Rotos + Cajones</p>
                  {previousPeriod && (
                    <DeltaIndicator 
                      current={currentPeriod.wasteIndex} 
                      previous={previousPeriod.wasteIndex}
                      invert
                      showPP
                    />
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
          
          {/* SECCIÓN 3b: DESGLOSE POR TIPO DE CAÑO */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm uppercase tracking-wide">Desglose por Tipo de Caño</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left py-2 px-2 font-medium">Diámetro</th>
                      <th className="text-center py-2 px-2 font-medium">Producido</th>
                      <th className="text-center py-2 px-2 font-medium">Rotura Prod.</th>
                      <th className="text-center py-2 px-2 font-medium text-green-600">1ra (Calidad)</th>
                      <th className="text-center py-2 px-2 font-medium text-amber-600">2da (Calidad)</th>
                      <th className="text-center py-2 px-2 font-medium text-red-600">Rotos (Calidad)</th>
                      <th className="text-center py-2 px-2 font-medium">% Calidad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PIPE_DIAMETERS.filter(d => 
                      currentPeriod.byDiameter[d]?.produced > 0 || 
                      currentPeriod.qualityData?.byDiameter[d]
                    ).map((d, idx) => {
                      const prod = currentPeriod.byDiameter[d] || { produced: 0, reprocessed: 0, weightKg: 0 }
                      const qual = currentPeriod.qualityData?.byDiameter[d]
                      const totalClassified = qual ? qual.first + qual.second + qual.broken : 0
                      const qualityRate = totalClassified > 0 ? (qual!.first / totalClassified) * 100 : 0
                      
                      return (
                        <tr key={d} className={idx % 2 === 1 ? "bg-muted/30" : ""}>
                          <td className="py-2 px-2 font-medium">CC{d}</td>
                          <td className="py-2 px-2 text-center">{prod.produced.toLocaleString()}</td>
                          <td className="py-2 px-2 text-center text-orange-600">{prod.reprocessed || "-"}</td>
                          <td className="py-2 px-2 text-center text-green-600 font-medium">{qual?.first || "-"}</td>
                          <td className="py-2 px-2 text-center text-amber-600">{qual?.second || "-"}</td>
                          <td className="py-2 px-2 text-center text-red-600">{qual?.broken || "-"}</td>
                          <td className={`py-2 px-2 text-center font-medium ${qualityRate >= 95 ? "text-green-600" : qualityRate >= 90 ? "text-amber-600" : "text-red-600"}`}>
                            {qual ? `${qualityRate.toFixed(1)}%` : "-"}
                          </td>
                        </tr>
                      )
                    })}
                    <tr className="border-t-2 bg-muted/50 font-semibold">
                      <td className="py-2 px-2">TOTAL</td>
                      <td className="py-2 px-2 text-center">{currentPeriod.canosPlayaUnits.toLocaleString()}</td>
                      <td className="py-2 px-2 text-center text-orange-600">{currentPeriod.roturaProduccionUnits}</td>
                      <td className="py-2 px-2 text-center text-green-600">{currentPeriod.qualityData?.totalFirst || "-"}</td>
                      <td className="py-2 px-2 text-center text-amber-600">{currentPeriod.qualityData?.totalSecond || "-"}</td>
                      <td className="py-2 px-2 text-center text-red-600">{currentPeriod.qualityData?.totalBroken || "-"}</td>
                      <td className={`py-2 px-2 text-center font-bold ${currentPeriod.qualityIndex >= 95 ? "text-green-600" : currentPeriod.qualityIndex >= 90 ? "text-amber-600" : "text-red-600"}`}>
                        {currentPeriod.qualityIndex.toFixed(1)}%
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* SECCIÓN 3b: OTROS ÍNDICES (Disponibilidad y Cumplimiento) */}
          <div className="grid grid-cols-2 gap-3">
            {/* Índice de Disponibilidad */}
            <Card className={getStatusBg(currentPeriod.availabilityIndex, 85)}>
              <CardContent className="py-4 text-center">
                <p className={`text-3xl font-bold ${getStatusColor(currentPeriod.availabilityIndex, 85)}`}>
                  {currentPeriod.availabilityIndex.toFixed(1)}%
                </p>
                <p className="text-xs text-muted-foreground uppercase mt-1">Disponibilidad</p>
                <p className="text-[10px] text-muted-foreground">
                  Prom. parada/día: {currentPeriod.avgDowntimePerDay.toFixed(0)} min
                </p>
                {previousPeriod && (
                  <div className="mt-1">
                    <DeltaIndicator 
                      current={currentPeriod.availabilityIndex} 
                      previous={previousPeriod.availabilityIndex}
                      showPP
                    />
                  </div>
                )}
              </CardContent>
            </Card>
            
            {/* Cumplimiento Plan */}
            <Card className={getStatusBg(currentPeriod.planCompliance, 90)}>
              <CardContent className="py-4 text-center">
                <p className={`text-3xl font-bold ${getStatusColor(currentPeriod.planCompliance, 90)}`}>
                  {currentPeriod.planCompliance.toFixed(0)}%
                </p>
                <p className="text-xs text-muted-foreground uppercase mt-1">Cumplimiento Plan</p>
                <p className="text-[10px] text-muted-foreground">
                  {currentPeriod.totalUnits.toLocaleString()} / {currentPeriod.totalPlanned.toLocaleString()}
                </p>
                {previousPeriod && (
                  <div className="mt-1">
                    <DeltaIndicator 
                      current={currentPeriod.planCompliance} 
                      previous={previousPeriod.planCompliance}
                      showPP
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* SECCIÓN 4: PARADAS */}
          {currentPeriod.topDowntimes.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm uppercase tracking-wide">Top 5 Paradas</CardTitle>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-red-50">
                      <th className="text-left py-2 px-2 font-medium text-red-800">Motivo</th>
                      <th className="text-center py-2 px-2 font-medium text-red-800">Min</th>
                      <th className="text-center py-2 px-2 font-medium text-red-800">%</th>
                      <th className="text-left py-2 px-2 font-medium text-red-800">Comentario frecuente</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentPeriod.topDowntimes.map((dt, idx) => (
                      <tr key={idx} className={idx % 2 === 1 ? "bg-muted/30" : ""}>
                        <td className="py-2 px-2">{dt.reason}</td>
                        <td className="py-2 px-2 text-center font-medium text-red-600">{dt.minutes}</td>
                        <td className="py-2 px-2 text-center">{dt.percentage.toFixed(1)}%</td>
                        <td className="py-2 px-2 text-muted-foreground text-xs truncate max-w-[200px]">
                          {dt.topComment || "-"}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t-2 bg-red-50 font-semibold">
                      <td className="py-2 px-2">TOTAL</td>
                      <td className="py-2 px-2 text-center text-red-600">{currentPeriod.totalDowntimeMinutes}</td>
                      <td className="py-2 px-2 text-center">100%</td>
                      <td className="py-2 px-2 text-muted-foreground">
                        ({(currentPeriod.totalDowntimeMinutes / 60).toFixed(1)} horas)
                      </td>
                    </tr>
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {/* SECCIÓN 5: GRÁFICO EVOLUCIÓN DIARIA */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm uppercase tracking-wide">Evolución Diaria de Producción</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={currentPeriod.dailyProduction} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="prodGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#1e3a5f" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#1e3a5f" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis 
                      dataKey="date" 
                      tick={{ fontSize: 10 }} 
                      tickFormatter={(v) => formatDateShort(v)}
                    />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip
                      contentStyle={{ fontSize: 12 }}
                      labelFormatter={(v) => `Fecha: ${formatDate(v)}`}
                      formatter={(value: number, name: string) => {
                        if (name === "units") return [value.toLocaleString(), "Caños"]
                        return [value, name]
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="units"
                      stroke="#1e3a5f"
                      strokeWidth={2}
                      fill="url(#prodGradient)"
                      dot={{ r: 3, fill: "#1e3a5f" }}
                      name="units"
                    />
                    <ReferenceLine
                      y={currentPeriod.totalUnits / currentPeriod.daysWorked}
                      stroke="#1e3a5f"
                      strokeDasharray="4 4"
                      strokeOpacity={0.6}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* SECCIÓN 6: ANÁLISIS DE ROTURAS */}
          {currentPeriod.qualityData && currentPeriod.qualityData.topDefects.length > 0 && (
            <div className="grid md:grid-cols-2 gap-4">
              {/* Defectos más frecuentes */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm uppercase tracking-wide">Defectos más frecuentes</CardTitle>
                </CardHeader>
                <CardContent>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-amber-50">
                        <th className="text-left py-2 px-2 font-medium">Motivo</th>
                        <th className="text-center py-2 px-2 font-medium">Cant.</th>
                        <th className="text-center py-2 px-2 font-medium">%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentPeriod.qualityData.topDefects.map((def, idx) => (
                        <tr key={idx} className={idx % 2 === 1 ? "bg-muted/30" : ""}>
                          <td className="py-2 px-2">{def.reason}</td>
                          <td className="py-2 px-2 text-center font-medium">{def.count}</td>
                          <td className="py-2 px-2 text-center">{def.percentage.toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>

              {/* Calidad por diámetro */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm uppercase tracking-wide">Calidad por diámetro</CardTitle>
                </CardHeader>
                <CardContent>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left py-2 px-2 font-medium">Diámetro</th>
                        <th className="text-center py-2 px-2 font-medium text-green-600">1ra %</th>
                        <th className="text-center py-2 px-2 font-medium text-amber-600">2da %</th>
                        <th className="text-center py-2 px-2 font-medium text-red-600">Rot %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeDiameters.map((d, idx) => {
                        const qual = currentPeriod.qualityData?.byDiameter[d]
                        if (!qual) return null
                        const total = qual.first + qual.second + qual.broken
                        if (total === 0) return null
                        
                        return (
                          <tr key={d} className={idx % 2 === 1 ? "bg-muted/30" : ""}>
                            <td className="py-2 px-2 font-medium">CC{d}</td>
                            <td className="py-2 px-2 text-center text-green-600">
                              {((qual.first / total) * 100).toFixed(1)}%
                            </td>
                            <td className="py-2 px-2 text-center text-amber-600">
                              {((qual.second / total) * 100).toFixed(1)}%
                            </td>
                            <td className="py-2 px-2 text-center text-red-600">
                              {((qual.broken / total) * 100).toFixed(1)}%
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </div>
          )}

          {/* SECCIÓN 7: CONSUMO DE MATERIA PRIMA */}
          {currentPeriod.materialConsumption && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm uppercase tracking-wide">Consumo Teórico de Materia Prima</CardTitle>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left py-2 px-2 font-medium">Material</th>
                      <th className="text-center py-2 px-2 font-medium">Total (kg)</th>
                      <th className="text-center py-2 px-2 font-medium">Total (Tn)</th>
                      {activeDiameters.map(d => (
                        <th key={d} className="text-center py-2 px-2 font-medium text-muted-foreground">CC{d}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(currentPeriod.materialConsumption).map(([material, data], idx) => (
                      <tr key={material} className={idx % 2 === 1 ? "bg-muted/30" : ""}>
                        <td className="py-2 px-2 font-medium">{material}</td>
                        <td className="py-2 px-2 text-center">{data.total.toLocaleString()}</td>
                        <td className="py-2 px-2 text-center font-medium">{(data.total / 1000).toFixed(2)}</td>
                        {activeDiameters.map(d => (
                          <td key={d} className="py-2 px-2 text-center text-muted-foreground text-xs">
                            {data.byDiameter[d] 
                              ? (data.byDiameter[d] / 1000).toFixed(1) 
                              : <span className="text-amber-500 flex items-center justify-center gap-0.5">
                                  <AlertTriangle className="w-3 h-3" />
                                  <span className="text-[10px]">Sin fórmula</span>
                                </span>
                            }
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-[10px] text-muted-foreground mt-2">
                  * Consumo calculado en base a las fórmulas cargadas y la producción total del período
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Modal Preview Informe Completo */}
      <Dialog open={showFullPreview} onOpenChange={setShowFullPreview}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Vista Previa - Informe Completo</DialogTitle>
          </DialogHeader>
          {currentPeriod && (
            <div ref={reportRef} className="bg-white p-6 space-y-4">
              {/* Aquí iría el contenido formateado para PDF */}
              <div className="text-center border-b pb-4">
                <h1 className="text-xl font-bold">INFORME DE PRODUCCIÓN DE CAÑOS</h1>
                <p className="text-muted-foreground">
                  Período: {formatDate(startDate)} - {formatDate(endDate)}
                </p>
              </div>
              <p className="text-sm text-muted-foreground text-center">
                El contenido del informe se exportará a PDF
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal Preview Ejecutivo */}
      <Dialog open={showExecutivePreview} onOpenChange={setShowExecutivePreview}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Vista Previa - Informe Ejecutivo</DialogTitle>
          </DialogHeader>
          {currentPeriod && (
            <div ref={executiveRef} className="bg-white p-6">
              {/* Resumen ejecutivo */}
              <div className="text-center border-b pb-4 mb-4">
                <h1 className="text-lg font-bold">RESUMEN EJECUTIVO - PRODUCCIÓN CAÑOS</h1>
                <p className="text-sm text-muted-foreground">
                  {formatDate(startDate)} - {formatDate(endDate)} | {currentPeriod.daysWorked} días
                </p>
              </div>
              
              <div className="grid grid-cols-4 gap-4 text-center mb-4">
                <div className="bg-primary/10 rounded p-3">
                  <p className="text-2xl font-bold text-primary">{currentPeriod.totalUnits.toLocaleString()}</p>
                  <p className="text-xs">Producido</p>
                </div>
                <div className={`rounded p-3 ${getStatusBg(currentPeriod.planCompliance, 90)}`}>
                  <p className={`text-2xl font-bold ${getStatusColor(currentPeriod.planCompliance, 90)}`}>
                    {currentPeriod.planCompliance.toFixed(0)}%
                  </p>
                  <p className="text-xs">Cumpl. Plan</p>
                </div>
                <div className={`rounded p-3 ${getStatusBg(currentPeriod.qualityIndex, 95)}`}>
                  <p className={`text-2xl font-bold ${getStatusColor(currentPeriod.qualityIndex, 95)}`}>
                    {currentPeriod.qualityIndex.toFixed(1)}%
                  </p>
                  <p className="text-xs">Calidad</p>
                </div>
                <div className="bg-amber-50 rounded p-3">
                  <p className="text-2xl font-bold text-amber-600">{currentPeriod.totalScrapBoxes}</p>
                  <p className="text-xs">Caj. Desp.</p>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
