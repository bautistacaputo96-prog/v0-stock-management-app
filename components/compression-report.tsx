"use client"

import { useState } from "react"
import { createClient } from "@/lib/supabase/client"
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

    const { data, error } = await supabase
      .from("test_cylinders")
      .select(`
        id,
        test_age_days,
        strength_mpa,
        dispatch_id,
        dispatches!inner(
          sample_number,
          formula_id,
          formulas!inner(code)
        )
      `)
      .in("dispatches.formula_id", selectedFormulas)
      .eq("test_age_days", testAge)
      .not("strength_mpa", "is", null)

    if (error) {
      console.error("[v0] Error loading compression data:", error)
      setLoading(false)
      return
    }

    // For 28 days, we need to average the two cylinders per sample
    let values: number[] = []

    if (testAge === 28) {
      // Group by dispatch_id and average
      const grouped: Record<string, number[]> = {}
      data?.forEach((cylinder: any) => {
        const dispatchId = cylinder.dispatch_id
        if (!grouped[dispatchId]) grouped[dispatchId] = []
        grouped[dispatchId].push(Number.parseFloat(cylinder.strength_mpa))
      })

      // Calculate average for each sample
      values = Object.values(grouped).map((vals) => vals.reduce((sum, val) => sum + val, 0) / vals.length)
    } else {
      // For 7 days, use values directly
      values = data?.map((cylinder: any) => Number.parseFloat(cylinder.strength_mpa)) || []
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
                <Scatter name="Resistencia" data={chartData} fill="#3b82f6" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}
