import type { CycleTime } from "./types"
import { calculateBlockOEE, calculatePipeOEE } from "./calculations"

/**
 * Genera un archivo CSV con los datos de producción de bloques
 */
export function exportBlockProductionToCSV(productions: any[], cycleTimes: CycleTime[]): string {
  const headers = [
    "Fecha",
    "Turno",
    "Hora Inicio",
    "Hora Fin",
    "Paradas (min)",
    "Tipo Producto",
    "Fórmula Hormigón",
    "Racks",
    "Bloques Descartados",
    "Disponibilidad (%)",
    "Rendimiento (%)",
    "Calidad (%)",
    "OEE (%)",
    "Motivos de Parada",
  ]

  const rows = productions.map((prod) => {
    const blockCycleTime = cycleTimes.find((ct) => ct.line_type === "bloques")
    const metrics = calculateBlockOEE(prod, blockCycleTime || null)

    const downtimeReasons =
      prod.block_downtime
        ?.map(
          (dt: any) => `${dt.downtime_reasons?.reason || dt.custom_reason}${dt.comments ? ` (${dt.comments})` : ""}`,
        )
        .join("; ") || ""

    return [
      prod.production_date,
      prod.shift,
      prod.start_time,
      prod.end_time,
      prod.total_downtime_minutes,
      prod.product_type || "",
      prod.concrete_formula || "",
      prod.racks_produced,
      prod.blocks_discarded,
      metrics.availability.toFixed(2),
      metrics.performance.toFixed(2),
      metrics.quality.toFixed(2),
      metrics.oee.toFixed(2),
      `"${downtimeReasons}"`,
    ]
  })

  const csv = [headers.join(","), ...rows.map((row) => row.join(","))].join("\n")

  return csv
}

/**
 * Genera un archivo CSV con los datos de producción de caños
 */
export function exportPipeProductionToCSV(productions: any[], cycleTimes: CycleTime[]): string {
  const headers = [
    "Fecha",
    "Turno",
    "Hora Inicio",
    "Hora Fin",
    "Paradas (min)",
    "CC400",
    "CC500",
    "CC600",
    "CC800",
    "CC1000",
    "CC1200",
    "Reprocesados",
    "Total Unidades",
    "Disponibilidad (%)",
    "Rendimiento (%)",
    "Calidad (%)",
    "OEE (%)",
    "Motivos de Parada",
  ]

  const rows = productions.map((prod) => {
    const pipeCycleTimes = cycleTimes.filter((ct) => ct.line_type === "caños")
    const metrics = calculatePipeOEE(prod, pipeCycleTimes)

    const totalUnits =
      prod.cc400_units + prod.cc500_units + prod.cc600_units + prod.cc800_units + prod.cc1000_units + prod.cc1200_units

    const downtimeReasons =
      prod.pipe_downtime
        ?.map(
          (dt: any) => `${dt.downtime_reasons?.reason || dt.custom_reason}${dt.comments ? ` (${dt.comments})` : ""}`,
        )
        .join("; ") || ""

    return [
      prod.production_date,
      prod.shift,
      prod.start_time,
      prod.end_time,
      prod.total_downtime_minutes,
      prod.cc400_units,
      prod.cc500_units,
      prod.cc600_units,
      prod.cc800_units,
      prod.cc1000_units,
      prod.cc1200_units,
      prod.reprocessed_units,
      totalUnits,
      metrics.availability.toFixed(2),
      metrics.performance.toFixed(2),
      metrics.quality.toFixed(2),
      metrics.oee.toFixed(2),
      `"${downtimeReasons}"`,
    ]
  })

  const csv = [headers.join(","), ...rows.map((row) => row.join(","))].join("\n")

  return csv
}

/**
 * Descarga un archivo CSV
 */
export function downloadCSV(csv: string, filename: string): void {
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" })
  const link = document.createElement("a")
  const url = URL.createObjectURL(blob)

  link.setAttribute("href", url)
  link.setAttribute("download", filename)
  link.style.visibility = "hidden"

  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}
