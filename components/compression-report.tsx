"use client"

import { useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { textoReplanteoCorto } from "@/lib/despacho"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Card } from "@/components/ui/card"
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts"

interface Formula {
  id: string
  code: string
  plant_id: string
}

interface CompressionReportProps {
  formulas: Formula[]
}

interface Statistics {
  mean: number
  stdDev: number
  count: number
  min: number
  max: number
  characteristic: number
}

export default function CompressionReport({ formulas }: CompressionReportProps) {
  const [selectedFormulas, setSelectedFormulas] = useState<string[]>([])
  const [testAge, setTestAge] = useState<7 | 28>(28)
  const [statistics, setStatistics] = useState<Statistics | null>(null)
  const [chartData, setChartData] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  const calculateStatistics = (values: number[]): Statistics => {
    const count = values.length
    const mean = values.reduce((sum, val) => sum + val, 0) / count
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / count
    const stdDev = Math.sqrt(variance)
    const min = Math.min(...values)
    const max = Math.max(...values)

    // Resistencia característica: fcm - 1.645 * σ (para 95% de confianza)
    const characteristic = mean - 1.645 * stdDev

    return { mean, stdDev, count, min, max, characteristic }
  }

  const generateReport = async () => {
    if (selectedFormulas.length === 0) {
      alert("Selecciona al menos una fórmula")
      return
    }

    setLoading(true)
    const supabase = createClient()

    // Con el replanteo (m³, retorno y cemento); sin la migración, como siempre
    const consulta = (conReplanteo: boolean) => supabase
      .from("test_cylinders")
      .select(`
        id,
        test_age_days,
        strength_mpa,
        dispatch_id,
        dispatches!inner(
          sample_number,
          formula_id,${conReplanteo ? "\n          quantity_m3,\n          retorno_m3,\n          cemento_extra_kg," : ""}
          formulas!inner(code)
        )
      `)
      .in("dispatches.formula_id", selectedFormulas)
      .eq("test_age_days", testAge)
      .not("strength_mpa", "is", null)
    let res: any = await consulta(true)
    if (res.error && /retorno_m3|cemento_extra_kg/.test(res.error.message || "")) res = await consulta(false)
    const { data, error } = res

    if (error) {
      console.error("[v0] Error loading compression data:", error)
      setLoading(false)
      return
    }

    // For 28 days, we need to average the two cylinders per sample
    let values: number[] = []
    // Muestra y replanteo de cada valor (en el mismo orden que values)
    let info: { muestra: string; replanteo: string }[] = []
    const infoDe = (c: any) => ({ muestra: c.dispatches?.sample_number || "-", replanteo: textoReplanteoCorto(c.dispatches?.quantity_m3, c.dispatches?.retorno_m3, c.dispatches?.cemento_extra_kg) })

    if (testAge === 28) {
      // Group by dispatch_id and average
      const grouped: Record<string, number[]> = {}
      const primera: Record<string, any> = {}
      data?.forEach((cylinder: any) => {
        const dispatchId = cylinder.dispatch_id
        if (!grouped[dispatchId]) { grouped[dispatchId] = []; primera[dispatchId] = cylinder }
        grouped[dispatchId].push(Number.parseFloat(cylinder.strength_mpa))
      })

      // Calculate average for each sample
      values = Object.values(grouped).map((vals) => vals.reduce((sum, val) => sum + val, 0) / vals.length)
      info = Object.keys(grouped).map((k) => infoDe(primera[k]))
    } else {
      // For 7 days, use values directly
      values = data?.map((cylinder: any) => Number.parseFloat(cylinder.strength_mpa)) || []
      info = (data || []).map(infoDe)
    }

    if (values.length === 0) {
      alert("No hay datos disponibles para los filtros seleccionados")
      setLoading(false)
      return
    }

    const stats = calculateStatistics(values)
    setStatistics(stats)

    // Prepare chart data
    const chartData = values.map((val, idx) => ({
      index: idx + 1,
      mpa: val,
      muestra: info[idx]?.muestra || "-",
      replanteo: info[idx]?.replanteo || "",
    }))
    setChartData(chartData)

    setLoading(false)
  }

  return (
    <div className="space-y-6">
      {/* Formula selector */}
      <Card className="p-4">
        <Label className="font-semibold mb-2 block">Seleccionar Fórmulas</Label>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 max-h-40 overflow-y-auto">
          {formulas.map((formula) => (
            <div key={formula.id} className="flex items-center space-x-2">
              <Checkbox
                id={`comp-formula-${formula.id}`}
                checked={selectedFormulas.includes(formula.id)}
                onCheckedChange={(checked) => {
                  if (checked) {
                    setSelectedFormulas([...selectedFormulas, formula.id])
                  } else {
                    setSelectedFormulas(selectedFormulas.filter((id) => id !== formula.id))
                  }
                }}
              />
              <label htmlFor={`comp-formula-${formula.id}`} className="text-sm">
                {formula.code}
              </label>
            </div>
          ))}
        </div>
      </Card>

      {/* Test age selector */}
      <div>
        <Label className="mb-2 block">Días de Ensayo</Label>
        <div className="flex gap-4">
          <Button variant={testAge === 7 ? "default" : "outline"} onClick={() => setTestAge(7)}>
            7 días
          </Button>
          <Button variant={testAge === 28 ? "default" : "outline"} onClick={() => setTestAge(28)}>
            28 días
          </Button>
        </div>
      </div>

      <Button onClick={generateReport} disabled={loading} className="w-full">
        {loading ? "Generando..." : "Generar Informe"}
      </Button>

      {/* Statistics */}
      {statistics && (
        <div className="space-y-6">
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">Estadísticas de Compresión</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Valor Medio</p>
                <p className="text-2xl font-bold">{statistics.mean.toFixed(2)} MPa</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Desvío Estándar</p>
                <p className="text-2xl font-bold">{statistics.stdDev.toFixed(2)} MPa</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Cantidad de Muestras</p>
                <p className="text-2xl font-bold">{statistics.count}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Valor Mínimo</p>
                <p className="text-2xl font-bold">{statistics.min.toFixed(2)} MPa</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Valor Máximo</p>
                <p className="text-2xl font-bold">{statistics.max.toFixed(2)} MPa</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Resistencia Característica</p>
                <p className="text-2xl font-bold text-blue-600">{statistics.characteristic.toFixed(2)} MPa</p>
              </div>
            </div>
          </Card>

          {/* Replanteo: muestras de un hormigón mezclado (el camión volvió con hormigón y se completó) */}
          {chartData.some((d) => d.replanteo) && (
            <Card className="border-amber-300 bg-amber-50 p-4 text-sm">
              <p className="font-semibold text-amber-900">
                {chartData.filter((d) => d.replanteo).length} muestra{chartData.filter((d) => d.replanteo).length === 1 ? "" : "s"} con replanteo (en ámbar en el gráfico). Entran en las estadísticas; la relación a/c no se calcula.
              </p>
              <ul className="mt-1 space-y-0.5 text-amber-900">
                {chartData.filter((d) => d.replanteo).map((d) => (
                  <li key={d.index}><span className="rounded bg-amber-100 px-1 text-xs font-semibold">Replanteo</span> Muestra {d.muestra} · {d.mpa.toFixed(1)} MPa · {d.replanteo.replace(/^Replanteo: /, "")}</li>
                ))}
              </ul>
            </Card>
          )}

          {/* Chart */}
          <div>
            <h3 className="text-lg font-semibold mb-4">Distribución de Resistencias</h3>
            <ResponsiveContainer width="100%" height={400}>
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="index" name="Muestra" />
                <YAxis name="MPa" />
                <Tooltip cursor={{ strokeDasharray: "3 3" }} />
                <ReferenceLine y={statistics.mean} stroke="green" strokeDasharray="3 3" label="Media" />
                <ReferenceLine y={statistics.characteristic} stroke="red" strokeDasharray="3 3" label="fck" />
                <Scatter name="Resistencia" data={chartData.filter((d) => !d.replanteo)} fill="#3b82f6" />
                {chartData.some((d) => d.replanteo) && <Scatter name="Con replanteo" data={chartData.filter((d) => d.replanteo)} fill="#d97706" />}
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}
