import type { BlockProduction, PipeProduction, CycleTime } from "./types"

/**
 * Calcula la disponibilidad de la máquina
 * Disponibilidad = (Tiempo disponible ajustado - Paradas NO planificadas) / Tiempo disponible ajustado
 * 
 * Donde:
 * - Tiempo disponible ajustado = Tiempo total - Paradas planificadas
 * - Paradas NO planificadas = Total paradas - Paradas planificadas
 * 
 * Ejemplo: 660 min totales, 20 min puesta a punto (planificada), 40 min falla equipo (no planificada)
 * - Tiempo ajustado = 660 - 20 = 640 min
 * - Disponibilidad = (640 - 40) / 640 = 600/640 = 93.75%
 */
export function calculateAvailability(
  startTime: string,
  endTime: string,
  totalDowntimeMinutes: number,
  plannedDowntimeMinutes = 0,
): number {
  const start = parseTime(startTime)
  const end = parseTime(endTime)

  let totalMinutes = (end - start) / (1000 * 60)

  // Si el fin es menor que el inicio, asumimos que cruzó medianoche
  if (totalMinutes < 0) {
    totalMinutes += 24 * 60
  }

  // Tiempo disponible ajustado = Tiempo total - Paradas planificadas
  const adjustedTotalMinutes = totalMinutes - plannedDowntimeMinutes
  
  // Paradas no planificadas = Total paradas - Paradas planificadas
  const unplannedDowntimeMinutes = Math.max(0, totalDowntimeMinutes - plannedDowntimeMinutes)

  if (adjustedTotalMinutes <= 0) return 0

  // Disponibilidad = (Tiempo ajustado - Paradas no planificadas) / Tiempo ajustado
  const availability = ((adjustedTotalMinutes - unplannedDowntimeMinutes) / adjustedTotalMinutes) * 100

  return Math.max(0, Math.min(100, availability))
}

/**
 * Calcula el rendimiento de la máquina
 * Rendimiento = (Ciclos reales / Ciclos teóricos) * 100
 */
export function calculatePerformance(
  startTime: string,
  endTime: string,
  totalDowntimeMinutes: number,
  plannedDowntimeMinutes: number,
  actualCycles: number,
  cycleTimeSeconds: number,
): number {
  const start = parseTime(startTime)
  const end = parseTime(endTime)

  let totalMinutes = (end - start) / (1000 * 60)

  if (totalMinutes < 0) {
    totalMinutes += 24 * 60
  }

  // Tiempo disponible ajustado = Tiempo total - Paradas planificadas
  const adjustedTotalMinutes = totalMinutes - plannedDowntimeMinutes
  
  // Paradas no planificadas = Total paradas - Paradas planificadas
  const unplannedDowntimeMinutes = Math.max(0, totalDowntimeMinutes - plannedDowntimeMinutes)
  
  // Tiempo efectivo de producción
  const availableMinutes = adjustedTotalMinutes - unplannedDowntimeMinutes
  const availableSeconds = availableMinutes * 60

  if (availableSeconds <= 0 || cycleTimeSeconds === 0) return 0

  const theoreticalCycles = availableSeconds / cycleTimeSeconds
  const performance = (actualCycles / theoreticalCycles) * 100

  return Math.max(0, Math.min(100, performance))
}

/**
 * Calcula la calidad de la producción
 * Calidad = (Unidades buenas / Unidades totales) * 100
 */
export function calculateQuality(goodUnits: number, totalUnits: number): number {
  if (totalUnits === 0) return 0
  const quality = (goodUnits / totalUnits) * 100
  return Math.max(0, Math.min(100, quality))
}

/**
 * Calcula el OEE (Overall Equipment Effectiveness)
 * OEE = Disponibilidad × Rendimiento × Calidad / 10000
 */
export function calculateOEE(availability: number, performance: number, quality: number): number {
  return (availability * performance * quality) / 10000
}

/**
 * Convierte un string de tiempo "HH:MM" a objeto Date
 */
function parseTime(timeString: string): number {
  const [hours, minutes] = timeString.split(":").map(Number)
  const date = new Date()
  date.setHours(hours, minutes, 0, 0)
  return date.getTime()
}

/**
 * Calcula métricas OEE para producción de bloques
 *
 * Cálculo de Calidad:
 * - Bandejas = Racks × 14
 * - Producción Real (a cámara) = Bandejas × 5 bloques
 * - Producción Neta (a playa) = Producción Real - Bloques descartados
 * - Calidad = (Producción Neta / Producción Real) × 100
 *
 * Ejemplo: 87 racks, 200 bloques descartados
 * - Bandejas = 87 × 14 = 1218
 * - Prod Real = 1218 × 5 = 6090 bloques
 * - Prod Neta = 6090 - 200 = 5890 bloques
 * - Calidad = 5890 / 6090 × 100 = 96.7%
 */
export function calculateBlockOEE(
  production: BlockProduction & { planned_downtime_minutes?: number },
  cycleTime: CycleTime | null,
): {
  availability: number
  performance: number
  quality: number
  oee: number
} {
  const plannedDowntime = production.planned_downtime_minutes || 0

  const availability = calculateAvailability(
    production.start_time,
    production.end_time,
    production.total_downtime_minutes,
    plannedDowntime,
  )

  // Para bloques, usar el nuevo cálculo basado en ciclo real vs ideal de 20 segundos
  const totalRacks = production.racks_to_camera || production.racks_produced || 0
  const idealCycleSeconds = 20 // Ciclo ideal para bloques

  const performance = calculateBlockPerformance(
    production.start_time,
    production.end_time,
    production.total_downtime_minutes,
    plannedDowntime,
    totalRacks,
    idealCycleSeconds,
  )

  // Bandejas (tablas) = racks × 14
  // Producción Real (a cámara) = bandejas × 5 bloques por bandeja
  // Producción Neta (a playa) = Prod Real - Bloques descartados
  // Calidad = Prod Neta / Prod Real × 100
  const bandejas = totalRacks * 14
  const produccionReal = bandejas * 5 // Total de bloques producidos
  const bloquesDescartados = production.scrap_units || 0
  const produccionNeta = produccionReal - bloquesDescartados // Bloques buenos

  let quality = 100
  if (produccionReal > 0) {
    quality = (produccionNeta / produccionReal) * 100
  }

  const oee = calculateOEE(availability, performance, quality)

  return {
    availability: Number(availability.toFixed(2)),
    performance: Number(performance.toFixed(2)),
    quality: Number(quality.toFixed(2)),
    oee: Number(oee.toFixed(2)),
  }
}

/**
 * Calcula el rendimiento de la máquina para bloques
 * Rendimiento = Ciclo ideal / Ciclo real
 * Ciclo ideal para bloques = 20 segundos
 * Ciclo real = Tiempo disponible en segundos / Cantidad de tablas producidas
 * Las paradas planificadas se restan del tiempo total antes del cálculo
 *
 * Ejemplo: 1218 tablas en 600 minutos disponibles
 * Ciclo real = (600 * 60) / 1218 = 29.56 segundos
 * Rendimiento = 20 / 29.56 = 67.66%
 */
export function calculateBlockPerformance(
  startTime: string,
  endTime: string,
  totalDowntimeMinutes: number,
  plannedDowntimeMinutes: number,
  racksProduced: number,
  idealCycleSeconds = 20,
): number {
  const start = parseTime(startTime)
  const end = parseTime(endTime)

  let totalMinutes = (end - start) / (1000 * 60)

  if (totalMinutes < 0) {
    totalMinutes += 24 * 60
  }

  // Tiempo disponible ajustado = Tiempo total - Paradas planificadas
  const adjustedTotalMinutes = totalMinutes - plannedDowntimeMinutes
  
  // Paradas no planificadas = Total paradas - Paradas planificadas
  const unplannedDowntimeMinutes = Math.max(0, totalDowntimeMinutes - plannedDowntimeMinutes)
  
  // Tiempo efectivo de producción = Tiempo ajustado - Paradas no planificadas
  const availableMinutes = adjustedTotalMinutes - unplannedDowntimeMinutes
  const availableSeconds = availableMinutes * 60

  const tablesProduced = racksProduced * 14

  if (availableSeconds <= 0 || tablesProduced === 0) return 0

  // Calcular tiempo real por ciclo (tabla)
  const realCycleSeconds = availableSeconds / tablesProduced

  // Rendimiento = Ciclo ideal / Ciclo real
  const performance = (idealCycleSeconds / realCycleSeconds) * 100

  return Math.max(0, Math.min(100, performance))
}

/**
 * Calcula métricas OEE para producción de caños
 */
export function calculatePipeOEE(
  production: PipeProduction & { planned_downtime_minutes?: number },
  cycleTimes: CycleTime[],
): {
  availability: number
  performance: number
  quality: number
  oee: number
} {
  const plannedDowntime = production.planned_downtime_minutes || 0

  const availability = calculateAvailability(
    production.start_time,
    production.end_time,
    production.total_downtime_minutes,
    plannedDowntime,
  )

  // Calcular ciclos totales y tiempo promedio ponderado
  const pipeTypes = [
    { code: "CC400", units: production.cc400_units },
    { code: "CC500", units: production.cc500_units },
    { code: "CC600", units: production.cc600_units },
    { code: "CC800", units: production.cc800_units },
    { code: "CC1000", units: production.cc1000_units },
    { code: "CC1200", units: production.cc1200_units },
  ]

  let totalUnits = 0
  let weightedCycleTime = 0

  pipeTypes.forEach((pipe) => {
    const cycleTime = cycleTimes.find((ct) => ct.product_code === pipe.code)
    if (cycleTime && pipe.units > 0) {
      totalUnits += pipe.units
      weightedCycleTime += pipe.units * cycleTime.cycle_seconds
    }
  })

  const avgCycleTime = totalUnits > 0 ? weightedCycleTime / totalUnits : 35

  const performance = calculatePerformance(
    production.start_time,
    production.end_time,
    production.total_downtime_minutes,
    plannedDowntime,
    totalUnits,
    avgCycleTime,
  )

  // Calidad: unidades buenas vs unidades totales (incluyendo reprocesados)
  const totalProduced = totalUnits + production.reprocessed_units
  const quality = calculateQuality(totalUnits, totalProduced)

  const oee = calculateOEE(availability, performance, quality)

  return {
    availability: Number(availability.toFixed(2)),
    performance: Number(performance.toFixed(2)),
    quality: Number(quality.toFixed(2)),
    oee: Number(oee.toFixed(2)),
  }
}
