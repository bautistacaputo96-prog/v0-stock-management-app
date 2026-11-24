"use client"

import { useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { todasLasFilas } from "@/lib/gps-viajes"
import { agruparProduccion, rangoDiasAR, type FilaProduccion } from "@/lib/pantallas"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Card } from "@/components/ui/card"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts"

interface Plant {
  id: string
  name: string
}

interface Formula {
  id: string
  code: string
  plant_id: string
}

interface Mixer {
  id: string
  license_plate: string
}

interface ProductionReportProps {
  plants: Plant[]
  formulas: Formula[]
  mixers: Mixer[]
}

export default function ProductionReport({ plants, formulas, mixers }: ProductionReportProps) {
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [selectedPlants, setSelectedPlants] = useState<string[]>([])
  const [selectedFormulas, setSelectedFormulas] = useState<string[]>([])
  const [selectedMixers, setSelectedMixers] = useState<string[]>([])
  const [filas, setFilas] = useState<FilaProduccion[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [groupBy, setGroupBy] = useState<"plant" | "formula" | "mixer">("plant")

  // Se agrupa al mostrar: cambiar "Agrupar por" después de generar ya no deja el gráfico con la agrupación anterior.
  const reportData = useMemo(() => (filas ? agruparProduccion(filas, groupBy, plants) : []), [filas, groupBy, plants])

  const generateReport = async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    // Días de Argentina: "2026-11-30" solo era 00:00 UTC (el último día quedaba afuera y entraban las 21–24 h del día
    // anterior al inicio).
    const rango = rangoDiasAR(startDate, endDate)

    try {
      // De a 1000 filas: PostgREST corta ahí y el informe de un año (o sin fechas) sumaba solo 1000 despachos.
      const data = await todasLasFilas<any>((desde, hasta) => {
        let query = supabase
          .from("dispatches")
          .select("id, dispatch_date, quantity_m3, formula_id, mixer_id, plant_id, formulas(code, plant_id), mixers(license_plate)")
          .eq("is_test_dispatch", false)
          .not("quantity_m3", "is", null)
        if (rango.desde) query = query.gte("dispatch_date", rango.desde)
        if (rango.hasta) query = query.lte("dispatch_date", rango.hasta)
        // Por la planta que despachó, no por la de la fórmula: una planta puede
        // despachar con fórmulas cargadas en la otra.
        if (selectedPlants.length > 0) query = query.in("plant_id", selectedPlants)
        if (selectedFormulas.length > 0) query = query.in("formula_id", selectedFormulas)
        if (selectedMixers.length > 0) query = query.in("mixer_id", selectedMixers)
        return query.order("id").range(desde, hasta)
      })
      setFilas(data as FilaProduccion[])
    } catch (e: any) {
      console.error("[informes] Error loading production report:", e)
      setFilas(null)
      setError(e?.message || "No se pudo generar el informe")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label>Fecha Inicio</Label>
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>

        <div>
          <Label>Fecha Fin</Label>
          <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Plant filter */}
        <Card className="p-4">
          <Label className="font-semibold mb-2 block">Plantas</Label>
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {plants.map((plant) => (
              <div key={plant.id} className="flex items-center space-x-2">
                <Checkbox
                  id={`plant-${plant.id}`}
                  checked={selectedPlants.includes(plant.id)}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      setSelectedPlants([...selectedPlants, plant.id])
                    } else {
                      setSelectedPlants(selectedPlants.filter((id) => id !== plant.id))
                    }
                  }}
                />
                <label htmlFor={`plant-${plant.id}`} className="text-sm">
                  {plant.name}
                </label>
              </div>
            ))}
          </div>
        </Card>

        {/* Formula filter */}
        <Card className="p-4">
          <Label className="font-semibold mb-2 block">Fórmulas</Label>
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {formulas.map((formula) => (
              <div key={formula.id} className="flex items-center space-x-2">
                <Checkbox
                  id={`formula-${formula.id}`}
                  checked={selectedFormulas.includes(formula.id)}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      setSelectedFormulas([...selectedFormulas, formula.id])
                    } else {
                      setSelectedFormulas(selectedFormulas.filter((id) => id !== formula.id))
                    }
                  }}
                />
                <label htmlFor={`formula-${formula.id}`} className="text-sm">
                  {formula.code}
                </label>
              </div>
            ))}
          </div>
        </Card>

        {/* Mixer filter */}
        <Card className="p-4">
          <Label className="font-semibold mb-2 block">Camiones</Label>
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {mixers.map((mixer) => (
              <div key={mixer.id} className="flex items-center space-x-2">
                <Checkbox
                  id={`mixer-${mixer.id}`}
                  checked={selectedMixers.includes(mixer.id)}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      setSelectedMixers([...selectedMixers, mixer.id])
                    } else {
                      setSelectedMixers(selectedMixers.filter((id) => id !== mixer.id))
                    }
                  }}
                />
                <label htmlFor={`mixer-${mixer.id}`} className="text-sm">
                  {mixer.license_plate}
                </label>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Group by selector */}
      <div>
        <Label className="mb-2 block">Agrupar por</Label>
        <div className="flex gap-4">
          <Button variant={groupBy === "plant" ? "default" : "outline"} onClick={() => setGroupBy("plant")}>
            Planta
          </Button>
          <Button variant={groupBy === "formula" ? "default" : "outline"} onClick={() => setGroupBy("formula")}>
            Fórmula
          </Button>
          <Button variant={groupBy === "mixer" ? "default" : "outline"} onClick={() => setGroupBy("mixer")}>
            Camión
          </Button>
        </div>
      </div>

      <Button onClick={generateReport} disabled={loading} className="w-full">
        {loading ? "Generando..." : "Generar Informe"}
      </Button>

      {error && <p className="text-sm text-red-700">No se pudo generar el informe: {error}</p>}
      {filas && filas.length === 0 && <p className="text-sm text-muted-foreground">No hay despachos con esos filtros.</p>}

      {/* Chart */}
      {reportData.length > 0 && (
        <div className="mt-6">
          <h3 className="text-lg font-semibold mb-4">Volumen Despachado (m³)</h3>
          <ResponsiveContainer width="100%" height={400}>
            <BarChart data={reportData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="volumen" fill="#3b82f6" name="Volumen (m³)" />
            </BarChart>
          </ResponsiveContainer>

          {/* Summary table */}
          <div className="mt-4">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2">Nombre</th>
                  <th className="text-right p-2">Volumen (m³)</th>
                </tr>
              </thead>
              <tbody>
                {reportData.map((item, idx) => (
                  <tr key={idx} className="border-b">
                    <td className="p-2">{item.name}</td>
                    <td className="text-right p-2">{item.volumen.toFixed(2)}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="p-2">Total</td>
                  <td className="text-right p-2">
                    {reportData.reduce((sum, item) => sum + item.volumen, 0).toFixed(2)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
