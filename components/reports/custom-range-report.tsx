"use client"

import { useState, useRef } from "react"
import { getSupabase } from "@/lib/supabase"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { FileDown, TrendingUp, TrendingDown, Minus, Search } from "lucide-react"
import {
  calculateReportMetrics,
  getDowntimeDetails,
  getParetoDowntimes,
  calculateAverageMetrics,
  calculateRawMaterialConsumption,
  groupRawMaterialByWeek,
  TARGETS,
  formatDateForDisplay,
  type ReportMetrics,
  type DowntimeDetail,
  type RawMaterialConsumption,
  type WeeklyRawMaterialConsumption,
} from "@/lib/report-utils"
import { useToast } from "@/hooks/use-toast"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
  LineChart,
  Line,
  ComposedChart,
} from "recharts"
import { PipeQualityDashboard } from "./pipe-quality-dashboard"
import { usePlant } from "@/lib/plant-context"


interface CustomRangeReportProps {
  lineType: "bloques" | "caños"
}

export function CustomRangeReport({ lineType }: CustomRangeReportProps) {
  const { selectedPlant } = usePlant()
  const [startDate, setStartDate] = useState(() => {
    const date = new Date()
    date.setDate(date.getDate() - 7)
    return date.toISOString().split("T")[0]
  })
  const [endDate, setEndDate] = useState(new Date().toISOString().split("T")[0])
  const [dailyMetrics, setDailyMetrics] = useState<ReportMetrics[]>([])
  const [averageMetrics, setAverageMetrics] = useState<ReportMetrics | null>(null)
  const [paretoDowntimes, setParetoDowntimes] = useState<DowntimeDetail[]>([])
  const [totalDowntime, setTotalDowntime] = useState(0)
  const [rawMaterialConsumption, setRawMaterialConsumption] = useState<RawMaterialConsumption | null>(null)
  const [weeklyConsumption, setWeeklyConsumption] = useState<WeeklyRawMaterialConsumption[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [pipeDataLoaded, setPipeDataLoaded] = useState(false)
  const reportRef = useRef<HTMLDivElement>(null)
  const { toast } = useToast()

  const supabase = getSupabase()

  async function loadReport() {
    if (startDate > endDate) {
      toast({
        title: "Error",
        description: "La fecha de inicio debe ser anterior a la fecha de fin",
        variant: "destructive",
      })
      return
    }

    setLoading(true)
    setSearched(true)
    setPipeDataLoaded(false)
    try {
      if (lineType === "bloques") {
        const { data, error } = await supabase
          .from("block_production")
          .select(`
            *,
            block_downtime (
              id,
              custom_reason,
              minutes,
              comments,
              downtime_category
            )
          `)
          .gte("production_date", startDate)
          .lte("production_date", endDate)
          .order("production_date", { ascending: true })

        if (error) throw error

        if (data && data.length > 0) {
          const metrics = data.map(calculateReportMetrics)
          setDailyMetrics(metrics)
          setAverageMetrics(calculateAverageMetrics(metrics))

          const allDowntimes = getDowntimeDetails(data)
          setParetoDowntimes(getParetoDowntimes(allDowntimes))
          setTotalDowntime(allDowntimes.reduce((sum, dt) => sum + dt.minutes, 0))

          const { totalConsumption } = calculateRawMaterialConsumption(data)
          setRawMaterialConsumption(totalConsumption)
          
          const weeklyData = groupRawMaterialByWeek(data)
          setWeeklyConsumption(weeklyData)
        } else {
          setDailyMetrics([])
          setAverageMetrics(null)
          setParetoDowntimes([])
          setTotalDowntime(0)
          setRawMaterialConsumption(null)
          setWeeklyConsumption([])
        }
      } else {
        // CAÑOS - El dashboard de calidad carga sus propios datos
        // Solo reseteamos el estado de bloques
        setDailyMetrics([])
        setAverageMetrics(null)
        setParetoDowntimes([])
        setTotalDowntime(0)
        setRawMaterialConsumption(null)
        setWeeklyConsumption([])
      }
    } catch (error) {
      console.error("Error loading report:", error)
      toast({
        title: "Error",
        description: "No se pudo cargar el informe",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  async function exportToPDF() {
    if (!reportRef.current) return

    try {
      const { exportElementToPDF } = await import("@/lib/pdf-export")
      await exportElementToPDF(reportRef.current, `informe-${startDate}-a-${endDate}.pdf`)

      toast({
        title: "PDF Generado",
        description: "El informe se ha exportado correctamente",
      })
    } catch (error) {
      console.error("Error exporting PDF:", error)
      toast({
        title: "Error",
        description: "No se pudo generar el PDF",
        variant: "destructive",
      })
    }
  }

  function getStatusColor(value: number, target: number, higherIsBetter = true) {
    const diff = higherIsBetter ? value - target : target - value
    if (diff >= 0) return "text-green-600"
    if (diff > -5) return "text-yellow-600"
    return "text-red-600"
  }

  function getStatusIcon(value: number, target: number, higherIsBetter = true) {
    const diff = higherIsBetter ? value - target : target - value
    if (diff >= 0) return <TrendingUp className="h-4 w-4 text-green-500" />
    if (diff > -5) return <Minus className="h-4 w-4 text-yellow-500" />
    return <TrendingDown className="h-4 w-4 text-red-500" />
  }

  const oeeLineData = dailyMetrics.map((m) => ({
    date: formatDateForDisplay(m.date),
    OEE: m.oee,
    Objetivo: TARGETS.oee,
    Disponibilidad: m.availability,
    ObjetivoDisp: TARGETS.availability,
    Tablas: m.traysProduced,
    ObjetivoTablas: TARGETS.dailyTrays,
  }))

  const paretoChartData = paretoDowntimes.map((dt) => ({
    reason: dt.reason.length > 20 ? dt.reason.substring(0, 17) + "..." : dt.reason,
    fullReason: dt.reason,
    minutes: dt.minutes,
    percentage: totalDowntime > 0 ? Number(((dt.minutes / totalDowntime) * 100).toFixed(1)) : 0,
  }))

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Seleccionar Rango de Fechas</CardTitle>
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
            <Button onClick={loadReport} className="gap-2">
              <Search className="h-4 w-4" />
              Buscar
            </Button>
            <Button onClick={exportToPDF} disabled={lineType === "bloques" ? !averageMetrics : !pipeDataLoaded} variant="outline" className="gap-2 bg-transparent">
              <FileDown className="h-4 w-4" />
              Exportar PDF
            </Button>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">Cargando informe...</CardContent>
        </Card>
      ) : !searched ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Seleccione un rango de fechas y presione "Buscar" para generar el informe
          </CardContent>
        </Card>
      ) : lineType === "bloques" && !averageMetrics ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No hay datos de produccion para el rango seleccionado
          </CardContent>
        </Card>
      ) : lineType === "caños" ? (
        <>
        <div ref={reportRef} className="space-y-4 bg-background">
          <div className="text-center border-b pb-4">
            <h2 className="text-xl font-bold">SILKE - Dashboard de Calidad de Canos</h2>
            <p className="text-muted-foreground">
              Periodo: {formatDateForDisplay(startDate)} - {formatDateForDisplay(endDate)}
            </p>
          </div>
          
          {/* Dashboard de Calidad */}
          <PipeQualityDashboard
            startDate={startDate}
            endDate={endDate}
            plant={selectedPlant || undefined}
            onDataLoaded={(d) => setPipeDataLoaded(!!d && d.totals.total > 0)}
          />
        </div>
        </>
      ) : (
        <div ref={reportRef} className="space-y-4 bg-background p-4">
          <div className="text-center border-b pb-4">
            <h2 className="text-xl font-bold">SILKE - Informe de Produccion</h2>
            <p className="text-muted-foreground">
              Periodo: {formatDateForDisplay(startDate)} - {formatDateForDisplay(endDate)} | {dailyMetrics.length} dias
              producidos
            </p>
          </div>

          {/* Promedios del período */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Promedios del Período</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-2">Indicador</th>
                      <th className="text-center py-2 px-2">Promedio</th>
                      <th className="text-center py-2 px-2">Objetivo</th>
                      <th className="text-center py-2 px-2">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b">
                      <td className="py-2 px-2 font-medium">Racks/Hora</td>
                      <td
                        className={`text-center py-2 px-2 font-semibold ${getStatusColor(averageMetrics.racksPerHour, TARGETS.racksPerHour)}`}
                      >
                        {averageMetrics.racksPerHour}
                      </td>
                      <td className="text-center py-2 px-2 text-muted-foreground">{TARGETS.racksPerHour}</td>
                      <td className="text-center py-2 px-2">
                        {getStatusIcon(averageMetrics.racksPerHour, TARGETS.racksPerHour)}
                      </td>
                    </tr>
                    <tr className="border-b">
                      <td className="py-2 px-2 font-medium">Bandejas Diarias</td>
                      <td
                        className={`text-center py-2 px-2 font-semibold ${getStatusColor(averageMetrics.traysProduced / dailyMetrics.length, TARGETS.dailyTrays)}`}
                      >
                        {Math.round(averageMetrics.traysProduced / dailyMetrics.length)}
                      </td>
                      <td className="text-center py-2 px-2 text-muted-foreground">{TARGETS.dailyTrays}</td>
                      <td className="text-center py-2 px-2">
                        {getStatusIcon(averageMetrics.traysProduced / dailyMetrics.length, TARGETS.dailyTrays)}
                      </td>
                    </tr>
                    <tr className="border-b">
                      <td className="py-2 px-2 font-medium">Disponibilidad</td>
                      <td
                        className={`text-center py-2 px-2 font-semibold ${getStatusColor(averageMetrics.availability, TARGETS.availability)}`}
                      >
                        {averageMetrics.availability}%
                      </td>
                      <td className="text-center py-2 px-2 text-muted-foreground">{TARGETS.availability}%</td>
                      <td className="text-center py-2 px-2">
                        {getStatusIcon(averageMetrics.availability, TARGETS.availability)}
                      </td>
                    </tr>
                    <tr className="border-b">
                      <td className="py-2 px-2 font-medium">Rendimiento</td>
                      <td
                        className={`text-center py-2 px-2 font-semibold ${getStatusColor(averageMetrics.performance, TARGETS.performance)}`}
                      >
                        {averageMetrics.performance}%
                      </td>
                      <td className="text-center py-2 px-2 text-muted-foreground">{TARGETS.performance}%</td>
                      <td className="text-center py-2 px-2">
                        {getStatusIcon(averageMetrics.performance, TARGETS.performance)}
                      </td>
                    </tr>
                    <tr className="border-b">
                      <td className="py-2 px-2 font-medium">Calidad</td>
                      <td
                        className={`text-center py-2 px-2 font-semibold ${getStatusColor(averageMetrics.quality, TARGETS.quality)}`}
                      >
                        {averageMetrics.quality}%
                      </td>
                      <td className="text-center py-2 px-2 text-muted-foreground">{TARGETS.quality}%</td>
                      <td className="text-center py-2 px-2">
                        {getStatusIcon(averageMetrics.quality, TARGETS.quality)}
                      </td>
                    </tr>
                    <tr className="bg-muted/50">
                      <td className="py-2 px-2 font-bold">OEE</td>
                      <td
                        className={`text-center py-2 px-2 font-bold ${getStatusColor(averageMetrics.oee, TARGETS.oee)}`}
                      >
                        {averageMetrics.oee}%
                      </td>
                      <td className="text-center py-2 px-2 text-muted-foreground font-semibold">{TARGETS.oee}%</td>
                      <td className="text-center py-2 px-2">{getStatusIcon(averageMetrics.oee, TARGETS.oee)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Gráficos de tendencia */}
          {oeeLineData.length > 1 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Gráfico de tendencia Disponibilidad */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Tendencia Disponibilidad del Período</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={oeeLineData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                        <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                        <Tooltip formatter={(value: number) => [`${value}%`]} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Line type="monotone" dataKey="Disponibilidad" stroke="#3b82f6" strokeWidth={2} dot={{ fill: "#3b82f6" }} />
                        <Line type="monotone" dataKey="ObjetivoDisp" stroke="#ef4444" strokeDasharray="5 5" dot={false} name={`Objetivo ${TARGETS.availability}%`} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              {/* Gráfico de tendencia OEE */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Tendencia OEE del Período</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={oeeLineData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                        <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                        <Tooltip formatter={(value: number) => [`${value}%`]} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Line type="monotone" dataKey="OEE" stroke="#f59e0b" strokeWidth={2} dot={{ fill: "#f59e0b" }} />
                        <Line type="monotone" dataKey="Objetivo" stroke="#ef4444" strokeDasharray="5 5" dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              {/* Gráfico de tendencia Producción de Tablas */}
              <Card className="lg:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Producción de Tablas por Día</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={oeeLineData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <Tooltip formatter={(value: number) => [value, 'Tablas']} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Line type="monotone" dataKey="Tablas" stroke="#06b6d4" strokeWidth={2} dot={{ fill: "#06b6d4" }} />
                        <Line type="monotone" dataKey="ObjetivoTablas" stroke="#ef4444" strokeDasharray="5 5" dot={false} name={`Objetivo ${TARGETS.dailyTrays}`} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Totales del período */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Totales del Período</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div className="bg-muted/50 p-3 rounded-lg">
                  <div className="text-muted-foreground text-xs">Total Racks</div>
                  <div className="text-xl font-bold">{averageMetrics.racksProduced}</div>
                </div>
                <div className="bg-muted/50 p-3 rounded-lg">
                  <div className="text-muted-foreground text-xs">Total Bandejas</div>
                  <div className="text-xl font-bold">{averageMetrics.traysProduced}</div>
                </div>
                <div className="bg-muted/50 p-3 rounded-lg">
                  <div className="text-muted-foreground text-xs">Bloques Buenos</div>
                  <div className="text-xl font-bold text-green-600">{averageMetrics.goodBlocks}</div>
                </div>
                <div className="bg-muted/50 p-3 rounded-lg">
                  <div className="text-muted-foreground text-xs">Tiempo Paradas</div>
                  <div className="text-xl font-bold text-red-600">{totalDowntime} min</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Análisis de Pareto */}
          {paretoDowntimes.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  Análisis de Pareto - Principales Causas de Parada (80% del tiempo)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={paretoChartData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" tick={{ fontSize: 10 }} />
                      <YAxis dataKey="reason" type="category" width={120} tick={{ fontSize: 10 }} />
                      <Tooltip
                        formatter={(value, name) => [
                          name === "minutes" ? `${value} min` : `${value}%`,
                          name === "minutes" ? "Minutos" : "% del total",
                        ]}
                        labelFormatter={(label, payload) => payload?.[0]?.payload?.fullReason || label}
                      />
                      <Bar dataKey="minutes" fill="#ef4444" name="minutes">
                        {paretoChartData.map((entry, index) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={index === 0 ? "#dc2626" : index === 1 ? "#ef4444" : "#f87171"}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 px-2">Motivo</th>
                        <th className="text-center py-2 px-2">Minutos</th>
                        <th className="text-center py-2 px-2">%</th>
                        <th className="text-left py-2 px-2">Observaciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paretoDowntimes.map((dt, idx) => (
                        <tr key={idx} className="border-b">
                          <td className="py-2 px-2 font-medium">{dt.reason}</td>
                          <td className="text-center py-2 px-2">{dt.minutes}</td>
                          <td className="text-center py-2 px-2">
                            {totalDowntime > 0 ? ((dt.minutes / totalDowntime) * 100).toFixed(1) : 0}%
                          </td>
                          <td className="py-2 px-2 text-muted-foreground text-xs">
                            {dt.comments.length > 0 ? (
                              <ul className="list-disc list-inside">
                                {dt.comments.slice(0, 3).map((c, i) => (
                                  <li key={i}>{c.text}</li>
                                ))}
                                {dt.comments.length > 3 && <li>...y {dt.comments.length - 3} más</li>}
                              </ul>
                            ) : (
                              "-"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Consumo de Materia Prima */}
          {rawMaterialConsumption && rawMaterialConsumption.total_kg > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Consumo de Materia Prima del Período</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                  <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 rounded-lg">
                    <div className="text-amber-700 dark:text-amber-400 text-xs font-medium">Cemento</div>
                    <div className="text-lg font-bold">{(rawMaterialConsumption.cement_kg / 1000).toFixed(2)} Tn</div>
                    <div className="text-xs text-muted-foreground">{rawMaterialConsumption.cement_kg.toLocaleString()} kg</div>
                  </div>
                  <div className="bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 p-3 rounded-lg">
                    <div className="text-yellow-700 dark:text-yellow-400 text-xs font-medium">Arena</div>
                    <div className="text-lg font-bold">{(rawMaterialConsumption.sand_kg / 1000).toFixed(2)} Tn</div>
                    <div className="text-xs text-muted-foreground">{rawMaterialConsumption.sand_kg.toLocaleString()} kg</div>
                  </div>
                  <div className="bg-stone-100 dark:bg-stone-900/30 border border-stone-300 dark:border-stone-700 p-3 rounded-lg">
                    <div className="text-stone-700 dark:text-stone-400 text-xs font-medium">Piedra 0-10</div>
                    <div className="text-lg font-bold">{(rawMaterialConsumption.stone_0_10_kg / 1000).toFixed(2)} Tn</div>
                    <div className="text-xs text-muted-foreground">{rawMaterialConsumption.stone_0_10_kg.toLocaleString()} kg</div>
                  </div>
                  <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 p-3 rounded-lg">
                    <div className="text-blue-700 dark:text-blue-400 text-xs font-medium">Agua</div>
                    <div className="text-lg font-bold">{(rawMaterialConsumption.water_kg / 1000).toFixed(2)} Tn</div>
                    <div className="text-xs text-muted-foreground">{rawMaterialConsumption.water_kg.toLocaleString()} kg</div>
                  </div>
                  {rawMaterialConsumption.additive_1_kg > 0 && (
                    <div className="bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 p-3 rounded-lg">
                      <div className="text-purple-700 dark:text-purple-400 text-xs font-medium">Aditivo 1</div>
                      <div className="text-lg font-bold">{rawMaterialConsumption.additive_1_kg.toLocaleString()} kg</div>
                    </div>
                  )}
                  {rawMaterialConsumption.additive_2_kg > 0 && (
                    <div className="bg-pink-50 dark:bg-pink-950/30 border border-pink-200 dark:border-pink-800 p-3 rounded-lg">
                      <div className="text-pink-700 dark:text-pink-400 text-xs font-medium">Aditivo 2</div>
                      <div className="text-lg font-bold">{rawMaterialConsumption.additive_2_kg.toLocaleString()} kg</div>
                    </div>
                  )}
                </div>
                <div className="mt-4 pt-3 border-t">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Total Materia Prima Consumida:</span>
                    <span className="text-xl font-bold">{(rawMaterialConsumption.total_kg / 1000).toFixed(2)} Toneladas</span>
                  </div>
                </div>

                {/* Consumo por Semana */}
                {weeklyConsumption.length > 0 && (
                  <div className="mt-4 pt-3 border-t">
                    <h4 className="text-sm font-medium mb-3">Desglose por Semana</h4>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-2 px-2">Semana</th>
                            <th className="text-right py-2 px-2">Días</th>
                            <th className="text-right py-2 px-2">Cemento</th>
                            <th className="text-right py-2 px-2">Arena</th>
                            <th className="text-right py-2 px-2">Piedra</th>
                            <th className="text-right py-2 px-2">Agua</th>
                            <th className="text-right py-2 px-2 font-bold">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {weeklyConsumption.map((week) => (
                            <tr key={`${week.weekNumber}`} className="border-b hover:bg-muted/50">
                              <td className="py-2 px-2">
                                <div className="font-medium">Semana {week.weekNumber}</div>
                                <div className="text-muted-foreground">{formatDateForDisplay(week.weekStart)} - {formatDateForDisplay(week.weekEnd)}</div>
                              </td>
                              <td className="text-right py-2 px-2">{week.daysCount}</td>
                              <td className="text-right py-2 px-2">{(week.consumption.cement_kg / 1000).toFixed(1)} Tn</td>
                              <td className="text-right py-2 px-2">{(week.consumption.sand_kg / 1000).toFixed(1)} Tn</td>
                              <td className="text-right py-2 px-2">{(week.consumption.stone_0_10_kg / 1000).toFixed(1)} Tn</td>
                              <td className="text-right py-2 px-2">{(week.consumption.water_kg / 1000).toFixed(1)} Tn</td>
                              <td className="text-right py-2 px-2 font-bold">{(week.consumption.total_kg / 1000).toFixed(1)} Tn</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
