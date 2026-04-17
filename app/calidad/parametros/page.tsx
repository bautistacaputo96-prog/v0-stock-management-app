"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Navigation } from "@/components/navigation"
import { Loader2, ShieldCheck, Droplets, Hammer, FlaskConical } from "lucide-react"

interface QualityParameter {
  id: number
  test_type: string
  parameter_name: string
  unit: string
  min_value: number | null
  max_value: number | null
  norm_reference: string
  description: string
}

const TEST_TYPE_CONFIG: Record<string, { label: string; icon: typeof ShieldCheck; color: string }> = {
  absorption: { label: "Absorcion (Canos)", icon: Droplets, color: "text-blue-600" },
  flexion: { label: "Flexion (Adoquines)", icon: Hammer, color: "text-amber-600" },
  granulometry: { label: "Granulometria", icon: FlaskConical, color: "text-emerald-600" },
  humidity: { label: "Humedad", icon: Droplets, color: "text-cyan-600" },
}

export default function ParametrosIRAMPage() {
  const [parameters, setParameters] = useState<QualityParameter[]>([])
  const [loading, setLoading] = useState(true)

  const fetchParams = useCallback(async () => {
    try {
      const res = await fetch("/api/quality/parameters")
      if (res.ok) setParameters(await res.json())
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  useEffect(() => { fetchParams() }, [fetchParams])

  // Group by test_type
  const grouped = parameters.reduce<Record<string, QualityParameter[]>>((acc, p) => {
    if (!acc[p.test_type]) acc[p.test_type] = []
    acc[p.test_type].push(p)
    return acc
  }, {})

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-foreground tracking-tight">Parametros IRAM</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Criterios de aceptacion segun normas IRAM para ensayos de calidad</p>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 p-4 bg-muted/50 rounded-lg border border-border">
        <ShieldCheck className="h-5 w-5 text-primary shrink-0 mt-0.5" />
        <div className="text-xs text-muted-foreground space-y-1">
          <p className="font-semibold text-foreground">Referencia de Normas IRAM</p>
          <p>Los valores mostrados son los criterios de aceptacion utilizados para validar automaticamente los resultados de ensayos. Se basan en las normas IRAM aplicables a tubos de hormigon simple y adoquines de hormigon.</p>
          <p>Estos parametros se utilizan como referencia en la seccion de Ensayos para indicar si un resultado CUMPLE o NO CUMPLE.</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([testType, params]) => {
            const config = TEST_TYPE_CONFIG[testType] || { label: testType, icon: ShieldCheck, color: "text-foreground" }
            const Icon = config.icon
            return (
              <Card key={testType}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Icon className={`h-4 w-4 ${config.color}`} />
                    {config.label}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left py-2.5 px-3 text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Parametro</th>
                          <th className="text-center py-2.5 px-3 text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Min.</th>
                          <th className="text-center py-2.5 px-3 text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Max.</th>
                          <th className="text-center py-2.5 px-3 text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Unidad</th>
                          <th className="text-left py-2.5 px-3 text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Norma</th>
                          <th className="text-left py-2.5 px-3 text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Descripcion</th>
                        </tr>
                      </thead>
                      <tbody>
                        {params.map((p) => (
                          <tr key={p.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                            <td className="py-2.5 px-3 text-xs font-medium text-foreground">{p.parameter_name}</td>
                            <td className="py-2.5 px-3 text-center">
                              {p.min_value !== null ? (
                                <span className="text-xs font-semibold text-foreground">{p.min_value}</span>
                              ) : (
                                <span className="text-xs text-muted-foreground">-</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              {p.max_value !== null ? (
                                <span className="text-xs font-semibold text-foreground">{p.max_value}</span>
                              ) : (
                                <span className="text-xs text-muted-foreground">-</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              <Badge variant="secondary" className="text-[10px]">{p.unit}</Badge>
                            </td>
                            <td className="py-2.5 px-3">
                              <Badge variant="outline" className="text-[10px] font-mono">{p.norm_reference}</Badge>
                            </td>
                            <td className="py-2.5 px-3 text-xs text-muted-foreground max-w-xs">{p.description}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
