import { calculateBlockOEE } from "./calculations"

// Objetivos de producción
export const TARGETS = {
  racksPerHour: 8.5,
  availability: 95,
  performance: 75,
  quality: 98.5,
  oee: 80,
  dailyTrays: 1300,
  dailyBlocks: 6500, // 1300 bandejas * 5 bloques
}

// Categorías de paradas planificadas (no afectan disponibilidad ni rendimiento)
export const PLANNED_DOWNTIME_CATEGORIES = [
  "Cambio de producto",
  "Mantenimiento",
  "Capacitación",
  "Reuniones",
  "Mant. Aut (Limp, Lub. Y Ajustes)",
  "Pruebas y/o Ensayos varios",
  "Puesta a punto (set up)",
  "Puesta a punto",
]

// Factores externos que se descuentan del tiempo disponible (no afectan disponibilidad)
export const EXTERNAL_DOWNTIME_CATEGORIES = [
  "Energía Eléctrica",
  "Piedra en Materia Prima",
  "Factores Externos", // Categoría padre
]

export interface ReportMetrics {
  date: string
  shift: string
  racksProduced: number
  traysProduced: number
  productionHours: number
  racksPerHour: number
  availability: number
  performance: number
  quality: number
  oee: number
  totalDowntimeMinutes: number
  plannedDowntimeMinutes: number
  unplannedDowntimeMinutes: number
  scrapUnits: number
  totalBlocks: number
  goodBlocks: number
}

export interface CommentWithMinutes {
  text: string
  minutes: number
}

export interface DowntimeDetail {
  reason: string
  minutes: number
  comments: CommentWithMinutes[]
  category: string
}

export function calculateReportMetrics(record: any): ReportMetrics {
  const racksProduced = record.racks_to_camera || 0
  const traysProduced = racksProduced * 14

  // Calcular horas de producción
  const startTime = record.start_time
  const endTime = record.end_time
  const [startH, startM] = startTime.split(":").map(Number)
  const [endH, endM] = endTime.split(":").map(Number)
  let productionMinutes = endH * 60 + endM - (startH * 60 + startM)
  if (productionMinutes < 0) productionMinutes += 24 * 60
  const productionHours = productionMinutes / 60

  // Calcular paradas planificadas vs no planificadas
  let plannedDowntimeMinutes = 0
  let unplannedDowntimeMinutes = 0
  let calculatedTotalDowntime = 0

  if (record.block_downtime && Array.isArray(record.block_downtime) && record.block_downtime.length > 0) {
    record.block_downtime.forEach((dt: any) => {
      const reason = dt.custom_reason || ""
      const category = dt.downtime_category || ""
      const minutes = dt.minutes || 0
      calculatedTotalDowntime += minutes
      // Paradas planificadas o factores externos no afectan disponibilidad
      const isPlanned = PLANNED_DOWNTIME_CATEGORIES.some((cat) => reason.toLowerCase().includes(cat.toLowerCase()))
      const isExternal = EXTERNAL_DOWNTIME_CATEGORIES.some((cat) => 
        reason.toLowerCase().includes(cat.toLowerCase()) || 
        category.toLowerCase().includes("externo")
      )
      if (isPlanned || isExternal) {
        plannedDowntimeMinutes += minutes
      } else {
        unplannedDowntimeMinutes += minutes
      }
    })
  }

  // Si no hay paradas detalladas pero hay total_downtime_minutes, asumirlas como no planificadas
  const totalDowntimeMinutes = calculatedTotalDowntime > 0 ? calculatedTotalDowntime : (record.total_downtime_minutes || 0)
  if (calculatedTotalDowntime === 0 && record.total_downtime_minutes > 0) {
    unplannedDowntimeMinutes = record.total_downtime_minutes
  }
  const racksPerHour = productionHours > 0 ? racksProduced / productionHours : 0

  // Calcular OEE
  const oeeMetrics = calculateBlockOEE(
    {
      ...record,
      planned_downtime_minutes: plannedDowntimeMinutes,
      total_downtime_minutes: totalDowntimeMinutes,
    },
    null,
  )

  // Calcular bloques
  const totalBlocks = traysProduced * 5
  const scrapUnits = record.scrap_units || 0
  const goodBlocks = totalBlocks - scrapUnits

  return {
    date: record.production_date,
    shift: record.shift?.toString() || "1",
    racksProduced,
    traysProduced,
    productionHours,
    racksPerHour: Number(racksPerHour.toFixed(2)),
    availability: oeeMetrics.availability,
    performance: oeeMetrics.performance,
    quality: oeeMetrics.quality,
    oee: oeeMetrics.oee,
    totalDowntimeMinutes,
    plannedDowntimeMinutes,
    unplannedDowntimeMinutes,
    scrapUnits,
    totalBlocks,
    goodBlocks,
  }
}

export function getDowntimeDetails(records: any[]): DowntimeDetail[] {
  const downtimeMap = new Map<string, DowntimeDetail>()

  records.forEach((record) => {
    if (record.block_downtime && Array.isArray(record.block_downtime)) {
      record.block_downtime.forEach((dt: any) => {
        const reason = dt.custom_reason || "Sin especificar"
        const minutes = dt.minutes || 0
        const comment = dt.comments || ""
        const category = dt.downtime_category || "Otros"

        if (minutes > 0) {
          if (downtimeMap.has(reason)) {
            const existing = downtimeMap.get(reason)!
            existing.minutes += minutes
            if (comment) {
              // Buscar si ya existe el comentario para sumar minutos
              const existingComment = existing.comments.find(c => c.text === comment)
              if (existingComment) {
                existingComment.minutes += minutes
              } else {
                existing.comments.push({ text: comment, minutes })
              }
            }
          } else {
            downtimeMap.set(reason, {
              reason,
              minutes,
              comments: comment ? [{ text: comment, minutes }] : [],
              category,
            })
          }
        }
      })
    }
  })

  return Array.from(downtimeMap.values()).sort((a, b) => b.minutes - a.minutes)
}

export function getParetoDowntimes(downtimes: DowntimeDetail[]): DowntimeDetail[] {
  const totalMinutes = downtimes.reduce((sum, dt) => sum + dt.minutes, 0)
  const threshold = totalMinutes * 0.8

  let accumulated = 0
  const paretoDowntimes: DowntimeDetail[] = []

  for (const dt of downtimes) {
    if (accumulated >= threshold && paretoDowntimes.length >= 3) break
    paretoDowntimes.push(dt)
    accumulated += dt.minutes
  }

  return paretoDowntimes
}

export function calculateAverageMetrics(metrics: ReportMetrics[]): ReportMetrics {
  if (metrics.length === 0) {
    return {
      date: "",
      shift: "",
      racksProduced: 0,
      traysProduced: 0,
      productionHours: 0,
      racksPerHour: 0,
      availability: 0,
      performance: 0,
      quality: 0,
      oee: 0,
      totalDowntimeMinutes: 0,
      plannedDowntimeMinutes: 0,
      unplannedDowntimeMinutes: 0,
      scrapUnits: 0,
      totalBlocks: 0,
      goodBlocks: 0,
    }
  }

  const sum = metrics.reduce(
    (acc, m) => ({
      racksProduced: acc.racksProduced + m.racksProduced,
      traysProduced: acc.traysProduced + m.traysProduced,
      productionHours: acc.productionHours + m.productionHours,
      racksPerHour: acc.racksPerHour + m.racksPerHour,
      availability: acc.availability + m.availability,
      performance: acc.performance + m.performance,
      quality: acc.quality + m.quality,
      oee: acc.oee + m.oee,
      totalDowntimeMinutes: acc.totalDowntimeMinutes + m.totalDowntimeMinutes,
      plannedDowntimeMinutes: acc.plannedDowntimeMinutes + m.plannedDowntimeMinutes,
      unplannedDowntimeMinutes: acc.unplannedDowntimeMinutes + m.unplannedDowntimeMinutes,
      scrapUnits: acc.scrapUnits + m.scrapUnits,
      totalBlocks: acc.totalBlocks + m.totalBlocks,
      goodBlocks: acc.goodBlocks + m.goodBlocks,
    }),
    {
      racksProduced: 0,
      traysProduced: 0,
      productionHours: 0,
      racksPerHour: 0,
      availability: 0,
      performance: 0,
      quality: 0,
      oee: 0,
      totalDowntimeMinutes: 0,
      plannedDowntimeMinutes: 0,
      unplannedDowntimeMinutes: 0,
      scrapUnits: 0,
      totalBlocks: 0,
      goodBlocks: 0,
    },
  )

  const count = metrics.length

  return {
    date: "",
    shift: "",
    racksProduced: sum.racksProduced,
    traysProduced: sum.traysProduced,
    productionHours: sum.productionHours,
    racksPerHour: Number((sum.racksPerHour / count).toFixed(2)),
    availability: Number((sum.availability / count).toFixed(2)),
    performance: Number((sum.performance / count).toFixed(2)),
    quality: Number((sum.quality / count).toFixed(2)),
    oee: Number((sum.oee / count).toFixed(2)),
    totalDowntimeMinutes: sum.totalDowntimeMinutes,
    plannedDowntimeMinutes: sum.plannedDowntimeMinutes,
    unplannedDowntimeMinutes: sum.unplannedDowntimeMinutes,
    scrapUnits: sum.scrapUnits,
    totalBlocks: sum.totalBlocks,
    goodBlocks: sum.goodBlocks,
  }
}

export function formatDateForDisplay(dateString: string): string {
  if (!dateString) return ""
  const [year, month, day] = dateString.split("-")
  return `${day}/${month}/${year}`
}

// Pesos de productos por tipo (en kg)
export const PRODUCT_WEIGHTS: Record<string, number> = {
  B20T: 13.2,
  B15: 11.5,
  B12: 9.8,
  B10: 8.2,
  // Agregar más productos según sea necesario
}

export interface RawMaterialConsumption {
  cement_kg: number
  sand_kg: number
  stone_0_10_kg: number
  water_kg: number
  additive_1_kg: number
  additive_2_kg: number
  total_kg: number
}

export interface DailyRawMaterialDetail {
  date: string
  productType: string
  blocksProduced: number
  productionWeight_kg: number
  dosage: RawMaterialConsumption
  consumption: RawMaterialConsumption
}

// Calcula el consumo de materia prima basado en la dosificación y producción
export function calculateRawMaterialConsumption(records: any[]): {
  totalConsumption: RawMaterialConsumption
  dailyDetails: DailyRawMaterialDetail[]
} {
  const dailyDetails: DailyRawMaterialDetail[] = []
  
  let totalConsumption: RawMaterialConsumption = {
    cement_kg: 0,
    sand_kg: 0,
    stone_0_10_kg: 0,
    water_kg: 0,
    additive_1_kg: 0,
    additive_2_kg: 0,
    total_kg: 0,
  }

  records.forEach((record) => {
    const racks = record.racks_to_camera || 0
    const trays = racks * 14
    const blocks = trays * 5
    const productType = record.product_type || 'B20T'
    const productWeight = PRODUCT_WEIGHTS[productType] || 13.2
    const productionWeight = blocks * productWeight

    // Dosificación del pastón (lo que se cargó ese día)
    const dosage: RawMaterialConsumption = {
      cement_kg: Number(record.cement_kg) || 0,
      sand_kg: Number(record.sand_kg) || 0,
      stone_0_10_kg: Number(record.stone_0_10_kg) || 0,
      water_kg: Number(record.water_kg) || 0,
      additive_1_kg: Number(record.additive_1_kg) || 0,
      additive_2_kg: Number(record.additive_2_kg) || 0,
      total_kg: 0,
    }
    dosage.total_kg = dosage.cement_kg + dosage.sand_kg + dosage.stone_0_10_kg + 
                      dosage.water_kg + dosage.additive_1_kg + dosage.additive_2_kg

    // Calcular proporciones de cada materia prima en el pastón
    // El consumo real se calcula como: (proporción del material) × peso total producido
    let consumption: RawMaterialConsumption
    
    if (dosage.total_kg > 0) {
      const cementRatio = dosage.cement_kg / dosage.total_kg
      const sandRatio = dosage.sand_kg / dosage.total_kg
      const stoneRatio = dosage.stone_0_10_kg / dosage.total_kg
      const waterRatio = dosage.water_kg / dosage.total_kg
      const additive1Ratio = dosage.additive_1_kg / dosage.total_kg
      const additive2Ratio = dosage.additive_2_kg / dosage.total_kg

      consumption = {
        cement_kg: Math.round(productionWeight * cementRatio),
        sand_kg: Math.round(productionWeight * sandRatio),
        stone_0_10_kg: Math.round(productionWeight * stoneRatio),
        water_kg: Math.round(productionWeight * waterRatio),
        additive_1_kg: Math.round(productionWeight * additive1Ratio),
        additive_2_kg: Math.round(productionWeight * additive2Ratio),
        total_kg: Math.round(productionWeight),
      }
    } else {
      consumption = {
        cement_kg: 0,
        sand_kg: 0,
        stone_0_10_kg: 0,
        water_kg: 0,
        additive_1_kg: 0,
        additive_2_kg: 0,
        total_kg: 0,
      }
    }

    dailyDetails.push({
      date: record.production_date,
      productType,
      blocksProduced: blocks,
      productionWeight_kg: productionWeight,
      dosage,
      consumption,
    })

    // Acumular totales
    totalConsumption.cement_kg += consumption.cement_kg
    totalConsumption.sand_kg += consumption.sand_kg
    totalConsumption.stone_0_10_kg += consumption.stone_0_10_kg
    totalConsumption.water_kg += consumption.water_kg
    totalConsumption.additive_1_kg += consumption.additive_1_kg
    totalConsumption.additive_2_kg += consumption.additive_2_kg
    totalConsumption.total_kg += consumption.total_kg
  })

  return { totalConsumption, dailyDetails }
}

export interface WeeklyRawMaterialConsumption {
  weekNumber: number
  weekStart: string
  weekEnd: string
  consumption: RawMaterialConsumption
  daysCount: number
}

// Agrupa el consumo de materia prima por semana
export function groupRawMaterialByWeek(records: any[]): WeeklyRawMaterialConsumption[] {
  if (!records || records.length === 0) return []

  // Ordenar registros por fecha
  const sortedRecords = [...records].sort((a, b) => 
    new Date(a.production_date).getTime() - new Date(b.production_date).getTime()
  )

  // Obtener la función de consumo por registro
  const { dailyDetails } = calculateRawMaterialConsumption(sortedRecords)

  // Agrupar por semana del año
  const weeklyData: Map<string, WeeklyRawMaterialConsumption> = new Map()

  sortedRecords.forEach((record, index) => {
    const date = new Date(record.production_date + 'T12:00:00')
    const weekNumber = getWeekNumber(date)
    const year = date.getFullYear()
    const weekKey = `${year}-W${weekNumber}`

    const dailyDetail = dailyDetails[index]
    if (!dailyDetail) return

    if (!weeklyData.has(weekKey)) {
      // Calcular inicio y fin de la semana
      const weekStart = getWeekStart(date)
      const weekEnd = new Date(weekStart)
      weekEnd.setDate(weekEnd.getDate() + 6)

      weeklyData.set(weekKey, {
        weekNumber,
        weekStart: weekStart.toISOString().split('T')[0],
        weekEnd: weekEnd.toISOString().split('T')[0],
        consumption: {
          cement_kg: 0,
          sand_kg: 0,
          stone_0_10_kg: 0,
          water_kg: 0,
          additive_1_kg: 0,
          additive_2_kg: 0,
          total_kg: 0,
        },
        daysCount: 0,
      })
    }

    const weekData = weeklyData.get(weekKey)!
    weekData.consumption.cement_kg += dailyDetail.consumption.cement_kg
    weekData.consumption.sand_kg += dailyDetail.consumption.sand_kg
    weekData.consumption.stone_0_10_kg += dailyDetail.consumption.stone_0_10_kg
    weekData.consumption.water_kg += dailyDetail.consumption.water_kg
    weekData.consumption.additive_1_kg += dailyDetail.consumption.additive_1_kg
    weekData.consumption.additive_2_kg += dailyDetail.consumption.additive_2_kg
    weekData.consumption.total_kg += dailyDetail.consumption.total_kg
    weekData.daysCount += 1
  })

  return Array.from(weeklyData.values()).sort((a, b) => a.weekNumber - b.weekNumber)
}

// Obtiene el número de semana del año
function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}

// Obtiene el inicio de la semana (lunes)
function getWeekStart(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  return new Date(d.setDate(diff))
}

// Interface para métricas de caños
export interface PipeReportMetrics {
  availability: number
  performance: number
  quality: number
  oee: number
  totalUnits: number
  totalWeightTn: number
  tnPerHour: number
  tnPerHourPerOperator: number
  productionByType: { size: string; quantity: number; weightTn: number }[]
  moldBreakages: { diameter: string; reasons: string[]; comments: string; date: string; shift: number }[]
  breakagesByType: { reason: string; count: number }[]
  breakagesByMold: { diameter: string; count: number }[]
  downtimes: { reason: string; minutes: number; category: string }[]
  totalDowntimeMinutes: number
  externalDowntimeMinutes: number
  availableMinutes: number
  operators: number
}

// Función para calcular métricas de caños
export function calculatePipeMetrics(records: any[], weights: Record<string, number>): PipeReportMetrics {
  const PIPE_SIZES = ["300", "400", "500", "600", "800", "1000", "1200"]
  
  let totalUnits = 0
  let totalWeightKg = 0
  let totalOperators = 0
  let totalAvailableMinutes = 0
  let totalDowntimeMinutes = 0
  let externalDowntimeMinutes = 0
  const productionByType: { size: string; quantity: number; weightTn: number }[] = []
  const allMoldBreakages: { diameter: string; reasons: string[]; comments: string; date: string; shift: number }[] = []
  // Mapa para agrupar paradas por motivo y acumular descripciones con minutos
  const downtimesByReason: Map<string, { minutes: number; category: string; details: { description: string; minutes: number }[] }> = new Map()
  const allDowntimes: { reason: string; minutes: number; category: string }[] = []
  
  // Contadores para análisis
  const breakageCountByReason: Record<string, number> = {}
  const breakageCountByMold: Record<string, number> = {}

  for (const record of records) {
    // Contar operarios
    totalOperators += record.operators_count || 3

    // Calcular tiempo disponible (TPR base - limpieza)
    const tprBase = record.shift === 1 ? 560 : 500
    const cleaningMinutes = record.cleaning_minutes || 0
    
    // Procesar paradas
    const downtimes = record.pipe_downtime || []
    let recordExternalMinutes = 0
    
    for (const dt of downtimes) {
      const reason = dt.custom_reason || ""
      const category = dt.downtime_category || ""
      const minutes = dt.minutes || 0
      const description = dt.description || dt.comments || ""
      
      // Excluir paradas planificadas (capacitación, reuniones, etc.)
      const isPlanned = category.toLowerCase().includes("planificad") ||
        reason.toLowerCase().includes("capacitación") ||
        reason.toLowerCase().includes("capacitacion") ||
        reason.toLowerCase().includes("reunión") ||
        reason.toLowerCase().includes("reunion")
      
      if (isPlanned) continue // Saltar paradas planificadas
      
      totalDowntimeMinutes += minutes
      
      // Agrupar por motivo (normalizado a minúsculas para comparar)
      const reasonKey = reason.toLowerCase().trim()
      if (downtimesByReason.has(reasonKey)) {
        const existing = downtimesByReason.get(reasonKey)!
        existing.minutes += minutes
        if (description) {
          existing.details.push({ description: description.trim(), minutes })
        }
      } else {
        downtimesByReason.set(reasonKey, { 
          minutes, 
          category, 
          details: description ? [{ description: description.trim(), minutes }] : [] 
        })
      }
      
      // Detectar factores externos
      const isExternal = category.toLowerCase().includes("externo") || 
        reason.toLowerCase().includes("energía") || 
        reason.toLowerCase().includes("energia") ||
        reason.toLowerCase().includes("piedra")
      
      if (isExternal) {
        recordExternalMinutes += minutes
        externalDowntimeMinutes += minutes
      }
    }
    
    const availableMinutes = tprBase - cleaningMinutes - recordExternalMinutes
    totalAvailableMinutes += availableMinutes

    // Producción por tipo de caño
    for (const size of PIPE_SIZES) {
      const simples = record[`cc${size}_simples`] || 0
      const rotura = record[`cc${size}_rotura`] || 0
      const armado = record[`cc${size}_armado`] || 0
      const roturaArmado = record[`cc${size}_rotura_armado`] || 0
      const total = simples + rotura + armado + roturaArmado
      
      if (total > 0) {
        const weightKg = total * (weights[size] || 0)
        totalUnits += total
        totalWeightKg += weightKg
        
        const existing = productionByType.find(p => p.size === size)
        if (existing) {
          existing.quantity += total
          existing.weightTn += weightKg / 1000
        } else {
          productionByType.push({ size, quantity: total, weightTn: Number((weightKg / 1000).toFixed(2)) })
        }
      }
    }

    // Roturas de moldes
    const moldBreakages = record.pipe_mold_breakage || []
    for (const b of moldBreakages) {
      if (b.diameter) {
        allMoldBreakages.push({
          diameter: b.diameter,
          reasons: b.reasons || [],
          comments: b.comments || "",
          date: record.production_date || "",
          shift: record.shift || 1,
        })
        
        // Contar por molde
        breakageCountByMold[b.diameter] = (breakageCountByMold[b.diameter] || 0) + 1
        
        // Contar por tipo de rotura
        for (const reason of (b.reasons || [])) {
          breakageCountByReason[reason] = (breakageCountByReason[reason] || 0) + 1
        }
      }
    }
  }

  const totalWeightTn = totalWeightKg / 1000
  const availableHours = totalAvailableMinutes / 60
  const tnPerHour = availableHours > 0 ? totalWeightTn / availableHours : 0
  const avgOperators = records.length > 0 ? totalOperators / records.length : 3
  const tnPerHourPerOperator = avgOperators > 0 ? tnPerHour / avgOperators : 0

  // Calcular OEE para caños
  const unplannedDowntime = Math.max(0, totalDowntimeMinutes - externalDowntimeMinutes)
  const availability = totalAvailableMinutes > 0 
    ? ((totalAvailableMinutes - unplannedDowntime) / totalAvailableMinutes) * 100 
    : 0
  const performance = 85 // Valor por defecto, se puede calcular vs tiempo ciclo teórico
  const quality = 100 // Por ahora 100%, se puede ajustar con defectos registrados
  const oee = (availability * performance * quality) / 10000

  // Convertir contadores a arrays ordenados
  const breakagesByType = Object.entries(breakageCountByReason)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
  
  const breakagesByMold = Object.entries(breakageCountByMold)
    .map(([diameter, count]) => ({ diameter, count }))
    .sort((a, b) => Number.parseInt(a.diameter) - Number.parseInt(b.diameter))

  // Ordenar producción por tipo de caño de forma ascendente (300, 400, 500, etc.)
  const sortedProductionByType = productionByType.sort((a, b) => Number.parseInt(a.size) - Number.parseInt(b.size))

  // Convertir mapa de paradas agrupadas a array ordenado por minutos (mayor a menor)
  const groupedDowntimes = Array.from(downtimesByReason.entries())
    .map(([reasonKey, data]) => ({
      reason: reasonKey.charAt(0).toUpperCase() + reasonKey.slice(1), // Capitalizar
      minutes: data.minutes,
      category: data.category,
      details: data.details
    }))
    .sort((a, b) => b.minutes - a.minutes)

  return {
    availability: Number(availability.toFixed(2)),
    performance: Number(performance.toFixed(2)),
    quality: Number(quality.toFixed(2)),
    oee: Number(oee.toFixed(2)),
    totalUnits,
    totalWeightTn: Number(totalWeightTn.toFixed(2)),
    tnPerHour: Number(tnPerHour.toFixed(2)),
    tnPerHourPerOperator: Number(tnPerHourPerOperator.toFixed(2)),
    productionByType: sortedProductionByType,
    moldBreakages: allMoldBreakages,
    breakagesByType,
    breakagesByMold,
    downtimes: groupedDowntimes,
    totalDowntimeMinutes,
    externalDowntimeMinutes,
    availableMinutes: totalAvailableMinutes,
    operators: Math.round(avgOperators)
  }
}

// Interface para métricas diarias de producción de caños (por registro/turno)
export interface PipeDailyMetrics {
  date: string
  shift: number
  operatorsCount: number
  totalUnits: number
  totalWeightTn: number
  availableMinutes: number
  effectiveMinutes: number
  downtimeMinutes: number
  externalDowntimeMinutes: number
  tnPerHour: number
  tnPerAvailableHour: number
  productionBySize: { size: string; quantity: number; weightTn: number }[]
}

// Calcula métricas diarias para cada registro de caño individual (por turno)
export function calculatePipeDailyMetrics(
  record: any,
  weights: Record<string, number>
): PipeDailyMetrics {
  const PIPE_SIZES = ["300", "400", "500", "600", "800", "1000", "1200"]

  let totalUnits = 0
  let totalWeightKg = 0
  const productionBySize: { size: string; quantity: number; weightTn: number }[] = []

  for (const size of PIPE_SIZES) {
    const simples = record[`cc${size}_simples`] || 0
    const rotura = record[`cc${size}_rotura`] || 0
    const armado = record[`cc${size}_armado`] || 0
    const roturaArmado = record[`cc${size}_rotura_armado`] || 0
    const total = simples + rotura + armado + roturaArmado

    if (total > 0) {
      const weightKg = total * (weights[size] || 0)
      totalUnits += total
      totalWeightKg += weightKg
      productionBySize.push({ size, quantity: total, weightTn: Number((weightKg / 1000).toFixed(3)) })
    }
  }

  // Tiempo disponible
  const tprBase = record.shift === 1 ? 560 : 500
  const cleaningMinutes = record.cleaning_minutes || 0

  // Procesar paradas
  const downtimes = record.pipe_downtime || []
  let recordDowntimeMinutes = 0
  let recordExternalMinutes = 0

  for (const dt of downtimes) {
    const reason = dt.custom_reason || ""
    const category = dt.downtime_category || ""
    const minutes = dt.minutes || 0

    const isPlanned = category.toLowerCase().includes("planificad") ||
      reason.toLowerCase().includes("capacitación") ||
      reason.toLowerCase().includes("capacitacion") ||
      reason.toLowerCase().includes("reunión") ||
      reason.toLowerCase().includes("reunion")

    if (isPlanned) continue

    recordDowntimeMinutes += minutes

    const isExternal = category.toLowerCase().includes("externo") ||
      reason.toLowerCase().includes("energía") ||
      reason.toLowerCase().includes("energia") ||
      reason.toLowerCase().includes("piedra")

    if (isExternal) {
      recordExternalMinutes += minutes
    }
  }

  const availableMinutes = tprBase - cleaningMinutes - recordExternalMinutes
  const unplannedDowntime = Math.max(0, recordDowntimeMinutes - recordExternalMinutes)
  const effectiveMinutes = Math.max(0, availableMinutes - unplannedDowntime)

  const totalWeightTn = totalWeightKg / 1000
  const availableHours = availableMinutes / 60
  const effectiveHours = effectiveMinutes / 60
  const tnPerHour = effectiveHours > 0 ? totalWeightTn / effectiveHours : 0
  const tnPerAvailableHour = availableHours > 0 ? totalWeightTn / availableHours : 0

  return {
    date: record.production_date,
    shift: record.shift || 1,
    operatorsCount: record.operators_count || 3,
    totalUnits,
    totalWeightTn: Number(totalWeightTn.toFixed(3)),
    availableMinutes,
    effectiveMinutes,
    downtimeMinutes: recordDowntimeMinutes,
    externalDowntimeMinutes: recordExternalMinutes,
    tnPerHour: Number(tnPerHour.toFixed(3)),
    tnPerAvailableHour: Number(tnPerAvailableHour.toFixed(3)),
    productionBySize,
  }
}

// Extrae detalles de paradas de registros de caños (similar a getDowntimeDetails pero para pipe_downtime)
export function getPipeDowntimeDetails(records: any[]): DowntimeDetail[] {
  const downtimeMap = new Map<string, DowntimeDetail>()

  for (const record of records) {
    const downtimes = record.pipe_downtime || []
    for (const dt of downtimes) {
      const reason = dt.custom_reason || "Sin especificar"
      const minutes = dt.minutes || 0
      const comment = dt.comments || ""
      const category = dt.downtime_category || "Otros"

      if (minutes > 0) {
        if (downtimeMap.has(reason)) {
          const existing = downtimeMap.get(reason)!
          existing.minutes += minutes
          if (comment) {
            const existingComment = existing.comments.find(c => c.text === comment)
            if (existingComment) {
              existingComment.minutes += minutes
            } else {
              existing.comments.push({ text: comment, minutes })
            }
          }
        } else {
          downtimeMap.set(reason, {
            reason,
            minutes,
            comments: comment ? [{ text: comment, minutes }] : [],
            category,
          })
        }
      }
    }
  }

  return Array.from(downtimeMap.values()).sort((a, b) => b.minutes - a.minutes)
}

// Interface para consumo de materia prima de caños
export interface PipeRawMaterialConsumption {
  cement_kg: number
  sand_kg: number
  stone_0_10_kg: number
  stone_0_20_kg: number
  total_kg: number
}

// Interface para la configuración de fórmula de cada tipo de caño
export interface PipeFormulaConfig {
  piece_weight_kg: number
  formula_cement_kg: number
  formula_sand_kg: number
  formula_stone_0_10_kg: number
  formula_stone_0_20_kg: number
}

// Calcula el consumo de materia prima para producción de caños usando fórmulas de product_config
// Ejemplo: CC300 con fórmula 60kg cemento + 100kg arena + 650kg piedra = 810kg total pastón
// Si el caño pesa 162kg → % cemento = 60/810 = 7.4% → cemento por caño = 162 × 7.4% = 12kg
export function calculatePipeRawMaterialConsumption(
  records: any[], 
  formulas: Record<string, PipeFormulaConfig>
): PipeRawMaterialConsumption {
  const PIPE_SIZES = ["300", "400", "500", "600", "800", "1000", "1200"]
  
  const totalConsumption: PipeRawMaterialConsumption = {
    cement_kg: 0,
    sand_kg: 0,
    stone_0_10_kg: 0,
    stone_0_20_kg: 0,
    total_kg: 0,
  }

  for (const record of records) {
    for (const size of PIPE_SIZES) {
      // Sumar todos los tipos de caño (simples, rotura, armado, rotura armado)
      const simples = record[`cc${size}_simples`] || 0
      const rotura = record[`cc${size}_rotura`] || 0
      const armado = record[`cc${size}_armado`] || 0
      const roturaArmado = record[`cc${size}_rotura_armado`] || 0
      const qty = simples + rotura + armado + roturaArmado
      if (qty <= 0) continue
      
      const formula = formulas[size]
      if (!formula || !formula.piece_weight_kg) continue
      
      // Calcular el total de la fórmula del pastón
      const formulaTotal = (formula.formula_cement_kg || 0) + 
                           (formula.formula_sand_kg || 0) + 
                           (formula.formula_stone_0_10_kg || 0) + 
                           (formula.formula_stone_0_20_kg || 0)
      
      if (formulaTotal <= 0) continue
      
      // Calcular % de cada material en el pastón
      const cementPct = (formula.formula_cement_kg || 0) / formulaTotal
      const sandPct = (formula.formula_sand_kg || 0) / formulaTotal
      const stone010Pct = (formula.formula_stone_0_10_kg || 0) / formulaTotal
      const stone020Pct = (formula.formula_stone_0_20_kg || 0) / formulaTotal
      
      // Consumo por caño = peso del caño × % del material
      const cementPerPipe = formula.piece_weight_kg * cementPct
      const sandPerPipe = formula.piece_weight_kg * sandPct
      const stone010PerPipe = formula.piece_weight_kg * stone010Pct
      const stone020PerPipe = formula.piece_weight_kg * stone020Pct
      
      // Consumo total = cantidad de caños × consumo por caño
      totalConsumption.cement_kg += Math.round(qty * cementPerPipe)
      totalConsumption.sand_kg += Math.round(qty * sandPerPipe)
      totalConsumption.stone_0_10_kg += Math.round(qty * stone010PerPipe)
      totalConsumption.stone_0_20_kg += Math.round(qty * stone020PerPipe)
    }
  }

  totalConsumption.total_kg = totalConsumption.cement_kg + totalConsumption.sand_kg + 
    totalConsumption.stone_0_10_kg + totalConsumption.stone_0_20_kg

  return totalConsumption
}

// Calcula el consumo de materia prima de caños por semana (para el informe mensual)
export function calculatePipeWeeklyRawMaterialConsumption(
  records: any[], 
  formulas: Record<string, PipeFormulaConfig>
): { weekNumber: number; weekLabel: string; consumption: PipeRawMaterialConsumption }[] {
  // Ordenar registros por fecha
  const sortedRecords = [...records].sort((a, b) =>
    new Date(a.production_date).getTime() - new Date(b.production_date).getTime()
  )

  // Agrupar por semana
  const weeklyData: Map<number, { records: any[]; weekLabel: string }> = new Map()

  for (const record of sortedRecords) {
    const date = new Date(record.production_date)
    const weekNum = getWeekNumber(date)
    
    if (!weeklyData.has(weekNum)) {
      // Calcular inicio y fin de semana para el label
      const weekStart = getWeekStart(date)
      const weekEnd = new Date(weekStart)
      weekEnd.setDate(weekEnd.getDate() + 6)
      
      const startDay = weekStart.getDate()
      const endDay = weekEnd.getDate()
      const startMonth = weekStart.toLocaleDateString('es', { month: 'short' })
      const endMonth = weekEnd.toLocaleDateString('es', { month: 'short' })
      
      const weekLabel = startMonth === endMonth 
        ? `${startDay}-${endDay} ${startMonth}`
        : `${startDay} ${startMonth} - ${endDay} ${endMonth}`
      
      weeklyData.set(weekNum, { records: [], weekLabel })
    }
    
    weeklyData.get(weekNum)!.records.push(record)
  }

  // Calcular consumo por semana
  const result: { weekNumber: number; weekLabel: string; consumption: PipeRawMaterialConsumption }[] = []

  weeklyData.forEach((data, weekNum) => {
    const consumption = calculatePipeRawMaterialConsumption(data.records, formulas)
    result.push({
      weekNumber: weekNum,
      weekLabel: data.weekLabel,
      consumption
    })
  })

  // Ordenar por número de semana
  return result.sort((a, b) => a.weekNumber - b.weekNumber)
}
