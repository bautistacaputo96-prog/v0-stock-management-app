"use client"

import { useState } from "react"
import { createClient } from "@/lib/supabase/client"
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
  const [reportData, setReportData] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [groupBy, setGroupBy] = useState<"plant" | "formula" | "mixer">("plant")

  const generateReport = async () => {
    setLoading(true)
    const supabase = createClient()

    let query = supabase
      .from("dispatches")
      .select(`
        id,
        dispatch_date,
        quantity_m3,
        formula_id,
        mixer_id,
        formulas!inner(code, plant_id, plants!inner(name)),
        mixers(license_plate)
      `)
      .eq("is_test_dispatch", false)
      .not("quantity_m3", "is", null)

    if (startDate) query = query.gte("dispatch_date", startDate)
    if (endDate) query = query.lte("dispatch_date", endDate)
    if (selectedPlants.length > 0) query = query.in("formulas.plant_id", selectedPlants)
    if (selectedFormulas.length > 0) query = query.in("formula_id", selectedFormulas)
    if (selectedMixers.length > 0) query = query.in("mixer_id", selectedMixers)

    const { data, error } = await query

    if (error) {
      console.error("[v0] Error loading production report:", error)
      setLoading(false)
      return
    }

    // Group data based on selection
    const grouped: Record<string, number> = {}

    data?.forEach((dispatch: any) => {
      let key = ""
      if (groupBy === "plant") {
        key = dispatch.formulas?.plants?.name || "Sin planta"
      } else if (groupBy === "formula") {
        key = dispatch.formulas?.code || "Sin fórmula"
      } else if (groupBy === "mixer") {
        key = dispatch.mixers?.license_plate || "Sin camión"
      }

      if (!grouped[key]) grouped[key] = 0
      grouped[key] += Number.parseFloat(dispatch.quantity_m3 || 0)
    })

    const chartData = Object.entries(grouped).map(([name, volume]) => ({
      name,
      volumen: Number.parseFloat(volume.toFixed(2)),
    }))

    setReportData(chartData)
    setLoading(false)
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
