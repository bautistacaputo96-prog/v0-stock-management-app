"use client"

import { useEffect, useState } from "react"
import { Navigation } from "@/components/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { usePlant } from "@/lib/plant-context"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts"

const MATERIAL_LABELS: Record<string, string> = {
  arena_especial: "Arena Especial",
  piedra_0_10: "Piedra 0/10",
  cemento: "Cemento",
  aditivo_mark_v: "Aditivo Mark V",
  aditivo_darasell: "Aditivo Darasell",
}

const CHART_COLORS: Record<string, string> = {
  arena_especial: "#f59e0b",
  piedra_0_10: "#6366f1",
  cemento: "#94a3b8",
  aditivo_mark_v: "#10b981",
  aditivo_darasell: "#ec4899",
}

interface StockData {
  currentStockKg: Record<string, number>
  daysOfStock: Record<string, number>
  dailyConsumptionKg: Record<string, number>
  stockEvolution: Record<string, number | string>[]
  planning: {
    material: string
    stockTn: number
    dailyConsumptionTn: number
    daysOfStock: number
    exhaustionDate: string | null
    suggestedOrderDate: string | null
  }[]
  massBalance: {
    material: string
    ingresosTn: number
    consumoTeoricoTn: number
    diferenciaPct: number
  }[]
}

function fmtTn(kg: number) {
  return (kg / 1000).toFixed(2)
}

function fmtDate(d: string | null) {
  if (!d) return "—"
  const [y, m, day] = d.split("-")
  return `${day}/${m}/${y}`
}

function DaysBar({ days }: { days: number }) {
  const capped = Math.min(days, 30)
  const pct = (capped / 30) * 100
  const color =
    days <= 2 ? "bg-red-500" : days <= 6 ? "bg-yellow-400" : "bg-green-500"
  return (
    <div className="w-full bg-muted rounded-full h-1.5 mt-1">
      <div
        className={`h-1.5 rounded-full ${color}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

export default function StockPage() {
  const { selectedPlant } = usePlant()
  const [data, setData] = useState<StockData | null>(null)
  const [loading, setLoading] = useState(false)
  const [leadTime] = useState(3)
  const today = new Date().toISOString().split("T")[0]

  useEffect(() => {
    if (!selectedPlant) return
    setLoading(true)
    fetch(`/api/materia-prima/stock?plant=${selectedPlant}&lead_time=${leadTime}`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .finally(() => setLoading(false))
  }, [selectedPlant, leadTime])

  // Combined additives for card
  const aditivosKg =
    data
      ? (data.currentStockKg["aditivo_mark_v"] || 0) +
        (data.currentStockKg["aditivo_darasell"] || 0)
      : 0
  const aditivosDays = data
    ? Math.min(
        data.daysOfStock["aditivo_mark_v"] ?? 999,
        data.daysOfStock["aditivo_darasell"] ?? 999
      )
    : 0

  const cards = data
    ? [
        {
          label: "Arena Especial",
          kg: data.currentStockKg["arena_especial"] || 0,
          days: data.daysOfStock["arena_especial"] ?? 999,
        },
        {
          label: "Piedra 0/10",
          kg: data.currentStockKg["piedra_0_10"] || 0,
          days: data.daysOfStock["piedra_0_10"] ?? 999,
        },
        {
          label: "Cemento",
          kg: data.currentStockKg["cemento"] || 0,
          days: data.daysOfStock["cemento"] ?? 999,
        },
        {
          label: "Aditivos",
          kg: aditivosKg,
          days: aditivosDays,
        },
      ]
    : []

  function planRowClass(row: StockData["planning"][0]) {
    if (!row.suggestedOrderDate) return ""
    if (row.suggestedOrderDate <= today) return "bg-red-50 dark:bg-red-950/30"
    const twoDaysOut = new Date()
    twoDaysOut.setDate(twoDaysOut.getDate() + 2)
    const twoDaysStr = twoDaysOut.toISOString().split("T")[0]
    if (row.suggestedOrderDate <= twoDaysStr) return "bg-yellow-50 dark:bg-yellow-950/30"
    return ""
  }

  function diffClass(pct: number) {
    if (pct <= 5) return "text-green-600 font-medium"
    if (pct <= 15) return "text-yellow-600 font-medium"
    return "text-red-600 font-medium"
  }

  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground tracking-tight">Control de Stock</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Gestión de inventario de materia prima</p>
        </div>

        {!selectedPlant && (
          <p className="text-sm text-muted-foreground">Seleccione una planta para ver el stock.</p>
        )}

        {loading && (
          <p className="text-sm text-muted-foreground">Cargando datos...</p>
        )}

        {data && !loading && (
          <>
            {/* Row 1 — Stock cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {cards.map((c) => {
                const critical = c.days <= 2
                return (
                  <Card
                    key={c.label}
                    className={critical ? "border-red-400 dark:border-red-600" : ""}
                  >
                    <CardContent className="pt-4 pb-4">
                      <p className="text-xs text-muted-foreground">{c.label}</p>
                      <p className="text-2xl font-bold mt-0.5">
                        {(c.kg / 1000).toFixed(1)}{" "}
                        <span className="text-sm font-normal text-muted-foreground">Tn</span>
                      </p>
                      <p className={`text-xs mt-1 ${critical ? "text-red-500 font-semibold" : c.days <= 6 ? "text-yellow-600" : "text-green-600"}`}>
                        {c.days >= 999 ? "Sin consumo" : `${Math.round(c.days)} días de stock`}
                      </p>
                      <DaysBar days={c.days >= 999 ? 30 : c.days} />
                    </CardContent>
                  </Card>
                )
              })}
            </div>

            {/* Row 2 — 30-day evolution chart */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Evolución de stock — últimos 30 días (Tn)</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={data.stockEvolution} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(v) => {
                        const [, m, d] = (v as string).split("-")
                        return `${d}/${m}`
                      }}
                      tick={{ fontSize: 10 }}
                      interval={4}
                    />
                    <YAxis tick={{ fontSize: 10 }} width={40} />
                    <Tooltip
                      formatter={(val: number, name: string) => [
                        `${val.toFixed(2)} Tn`,
                        MATERIAL_LABELS[name] || name,
                      ]}
                      labelFormatter={(l) => {
                        const [y, m, d] = (l as string).split("-")
                        return `${d}/${m}/${y}`
                      }}
                    />
                    <Legend
                      formatter={(v) => MATERIAL_LABELS[v] || v}
                      wrapperStyle={{ fontSize: 11 }}
                    />
                    {["arena_especial", "piedra_0_10", "cemento", "aditivo_mark_v", "aditivo_darasell"].map((mat) => (
                      <Line
                        key={mat}
                        type="monotone"
                        dataKey={mat}
                        stroke={CHART_COLORS[mat]}
                        strokeWidth={2}
                        dot={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Row 3 — Planning table */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Planificación de pedidos (lead time: {leadTime} días)</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">Material</th>
                        <th className="text-right px-4 py-2 font-medium text-muted-foreground">Stock actual</th>
                        <th className="text-right px-4 py-2 font-medium text-muted-foreground">Consumo diario</th>
                        <th className="text-right px-4 py-2 font-medium text-muted-foreground">Días de stock</th>
                        <th className="text-right px-4 py-2 font-medium text-muted-foreground">Fecha agotamiento</th>
                        <th className="text-right px-4 py-2 font-medium text-muted-foreground">Fecha sugerida pedido</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.planning.map((row) => (
                        <tr key={row.material} className={`border-b last:border-0 ${planRowClass(row)}`}>
                          <td className="px-4 py-2 font-medium">{MATERIAL_LABELS[row.material] || row.material}</td>
                          <td className="px-4 py-2 text-right">{row.stockTn.toFixed(2)} Tn</td>
                          <td className="px-4 py-2 text-right">{(row.dailyConsumptionTn * 1000).toFixed(0)} kg/día</td>
                          <td className="px-4 py-2 text-right">
                            {row.daysOfStock >= 999 ? "—" : `${Math.round(row.daysOfStock)} días`}
                          </td>
                          <td className="px-4 py-2 text-right">{fmtDate(row.exhaustionDate)}</td>
                          <td className="px-4 py-2 text-right font-medium">
                            {row.suggestedOrderDate ? (
                              <span className={row.suggestedOrderDate <= today ? "text-red-600" : ""}>
                                {fmtDate(row.suggestedOrderDate)}
                              </span>
                            ) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Row 4 — Mass balance */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Balance de masa — mes actual</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">Material</th>
                        <th className="text-right px-4 py-2 font-medium text-muted-foreground">Ingresos (Tn)</th>
                        <th className="text-right px-4 py-2 font-medium text-muted-foreground">Consumo teórico (Tn)</th>
                        <th className="text-right px-4 py-2 font-medium text-muted-foreground">Diferencia</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.massBalance.map((row) => (
                        <tr key={row.material} className="border-b last:border-0">
                          <td className="px-4 py-2 font-medium">{MATERIAL_LABELS[row.material] || row.material}</td>
                          <td className="px-4 py-2 text-right">{row.ingresosTn.toFixed(2)}</td>
                          <td className="px-4 py-2 text-right">{row.consumoTeoricoTn.toFixed(2)}</td>
                          <td className={`px-4 py-2 text-right ${diffClass(row.diferenciaPct)}`}>
                            {row.diferenciaPct.toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="px-4 py-2 text-xs text-muted-foreground border-t">
                  Verde &lt;5% · Amarillo 5–15% · Rojo &gt;15%
                </p>
              </CardContent>
            </Card>
          </>
        )}

        {!loading && data && data.planning.every((r) => r.daysOfStock >= 999) && (
          <p className="text-xs text-muted-foreground text-center">Sin datos de producción recientes para calcular consumo.</p>
        )}
      </div>
    </div>
  )
}
