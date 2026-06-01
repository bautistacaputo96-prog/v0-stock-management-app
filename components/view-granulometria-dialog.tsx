"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Loader2 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts"

// Sieve data matching the PDF format exactly
const SIEVE_DATA = [
  { name: '3/8"', opening: "9.5", index: 0 },
  { name: "#4", opening: "4.75", index: 1 },
  { name: "#8", opening: "2.36", index: 2 },
  { name: "#16", opening: "1.18", index: 3 },
  { name: "#30", opening: "0.6", index: 4 },
  { name: "#50", opening: "0.3", index: 5 },
  { name: "#100", opening: "0.15", index: 6 },
  { name: "#200", opening: "0.075", index: 7 },
  { name: "Pasa #200", opening: "Lavado", index: 8 },
]

// ASTM C33 limits for fine aggregate (arena) - matching PDF values
const LIMITS_A = [100, 100, 100, 85, 60, 30, 10, 0, 0]
const LIMITS_B = [100, 95, 80, 50, 25, 10, 2, 0, 0]
const LIMITS_C = [100, 89, 65, 25, 5, 0, 0, 0, 0]

interface ViewGranulometriaDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  testId: string
}

export function ViewGranulometriaDialog({ open, onOpenChange, testId }: ViewGranulometriaDialogProps) {
  const [loading, setLoading] = useState(true)
  const [testData, setTestData] = useState<any>(null)
  const [sieveResults, setSieveResults] = useState<any[]>([])

  useEffect(() => {
    if (open && testId) {
      loadTestData()
    }
  }, [open, testId])

  const loadTestData = async () => {
    setLoading(true)
    const supabase = createClient()

    const { data: test, error: testError } = await supabase
      .from("granulometria_tests")
      .select("*")
      .eq("id", testId)
      .single()

    const sieveOrder = ['3/8"', "#4", "#8", "#16", "#30", "#50", "#100", "#200", "Pasa #200", "Fondo"]

    const { data: sieves, error: sievesError } = await supabase
      .from("granulometria_sieve_results")
      .select("*")
      .eq("test_id", testId)

    if (!testError && !sievesError) {
      setTestData(test)
      const sortedSieves = (sieves || []).sort((a, b) => {
        return sieveOrder.indexOf(a.sieve_size) - sieveOrder.indexOf(b.sieve_size)
      })
      setSieveResults(sortedSieves)
    }

    setLoading(false)
  }

  const formatDate = (dateStr: string) => {
    if (!dateStr) return ""
    const date = new Date(dateStr)
    return date.toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl w-[95vw] max-h-[95vh] overflow-y-auto">
        <DialogHeader className="pb-4 border-b">
          <DialogTitle className="text-xl">Analisis de Materias Primas</DialogTitle>
          <DialogDescription className="text-base">
            Analisis Granulometrico de Agregados - {testData?.aggregate_type || ""}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center p-12">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : testData ? (
          <div className="space-y-6 pt-4">
            {/* Header - Sample Data */}
            <Card className="bg-muted/30">
              <CardContent className="pt-6">
                <h3 className="font-semibold text-sm text-muted-foreground mb-4 uppercase tracking-wide">Datos de la Muestra</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Fecha de Extraccion</p>
                    <p className="font-semibold">{formatDate(testData.extraction_date)}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Peso Muestra Humedo</p>
                    <p className="font-semibold">{testData.sample_weight_grams?.toFixed(0) || "-"} g</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Proveedor</p>
                    <p className="font-semibold">{testData.provider}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Remito</p>
                    <p className="font-semibold">{testData.remito || "-"}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Peso Muestra Seco</p>
                    <p className="font-semibold">{testData.dry_weight_grams?.toFixed(0) || "-"} g</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Humedad %</p>
                    <p className="font-semibold">{testData.moisture_percent?.toFixed(2) || "-"}%</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Full Width Table */}
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between mb-4 flex-wrap gap-4">
                  <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Resultados del Tamizado</h3>
                  <div className="flex items-center gap-4">
                    {/* Clasificación del lote - MF bajo = Arena Fina (granos finos), MF alto = Arena Gruesa */}
                    <div className="px-4 py-2 rounded-lg bg-blue-50 border border-blue-200">
                      <p className="text-xs text-blue-600 mb-1">Clasificacion</p>
                      <p className="font-bold text-blue-900">
                        {testData.fineness_modulus 
                          ? testData.fineness_modulus > 3.0 
                            ? "Arena Gruesa" 
                            : testData.fineness_modulus >= 2.3 
                              ? "Arena Media" 
                              : "Arena Fina"
                          : "-"}
                      </p>
                    </div>
                    {/* Módulo de finura */}
                    <div className={`flex items-center gap-3 px-4 py-2 rounded-lg ${testData.fineness_modulus < 1.8 || testData.fineness_modulus > 2.2 ? "bg-destructive/10 border border-destructive/30" : "bg-green-500/10 border border-green-500/30"}`}>
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">Modulo de Finura</p>
                        <p className="text-xs text-muted-foreground">(Rango: 1.80 - 2.20)</p>
                      </div>
                      <div className={`text-3xl font-bold ${testData.fineness_modulus < 1.8 || testData.fineness_modulus > 2.2 ? "text-destructive" : "text-green-600"}`}>
                        {testData.fineness_modulus?.toFixed(2)}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="rounded-md border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-primary text-primary-foreground">
                        <TableHead className="font-semibold text-primary-foreground">Tamiz</TableHead>
                        <TableHead className="font-semibold text-primary-foreground text-center">Abertura (mm)</TableHead>
                        <TableHead className="font-semibold text-primary-foreground text-right">Ret. Parcial (g)</TableHead>
                        <TableHead className="font-semibold text-primary-foreground text-right">Ret. Acum. (g)</TableHead>
                        <TableHead className="font-semibold text-primary-foreground text-right">% Retenido</TableHead>
                        <TableHead className="font-semibold text-primary-foreground text-right">% Ret. Acum.</TableHead>
                        <TableHead className="font-semibold text-primary-foreground text-right">% Pasa</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {SIEVE_DATA.map((sieve, idx) => {
                        const result = sieveResults.find(r => r.sieve_size === sieve.name)
                        const isEven = idx % 2 === 0
                        return (
                          <TableRow key={sieve.name} className={isEven ? "bg-muted/30" : ""}>
                            <TableCell className="font-semibold">{sieve.name}</TableCell>
                            <TableCell className="text-center">{sieve.opening}</TableCell>
                            <TableCell className="text-right font-mono">{result?.retained_grams?.toFixed(1) || "0.0"}</TableCell>
                            <TableCell className="text-right font-mono">{result?.retained_cumulative_grams?.toFixed(1) || "0.0"}</TableCell>
                            <TableCell className="text-right font-mono">{result?.percent_retained?.toFixed(1) || "0.0"}%</TableCell>
                            <TableCell className="text-right font-mono">{result?.percent_retained_cumulative?.toFixed(1) || "0.0"}%</TableCell>
                            <TableCell className="text-right font-mono font-semibold">{result?.percent_passing?.toFixed(1) || "100.0"}%</TableCell>
                          </TableRow>
                        )
                      })}
                      {/* Total row */}
                      <TableRow className="bg-primary/10 font-semibold border-t-2">
                        <TableCell>TOTAL</TableCell>
                        <TableCell></TableCell>
                        <TableCell className="text-right font-mono">
                          {sieveResults.reduce((sum, r) => sum + (r.retained_grams || 0), 0).toFixed(1)}
                        </TableCell>
                        <TableCell colSpan={4}></TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

              {/* Chart */}
              <Card>
                <CardContent className="pt-6">
                  <h3 className="font-semibold text-sm text-muted-foreground mb-4 uppercase tracking-wide">Curva Granulometrica</h3>
                  <div className="h-[450px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={SIEVE_DATA.slice().reverse().map((sieve, idx) => {
                          const originalIdx = SIEVE_DATA.length - 1 - idx
                          const result = sieveResults.find(r => r.sieve_size === sieve.name)
                          return {
                            index: idx,
                            sieveName: sieve.name,
                            opening: sieve.opening,
                            percentPassing: result?.percent_passing ?? 100,
                            limitA: LIMITS_A[originalIdx],
                            limitB: LIMITS_B[originalIdx],
                            limitC: LIMITS_C[originalIdx],
                          }
                        })}
                        margin={{ top: 20, right: 30, left: 20, bottom: 60 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis
                          dataKey="opening"
                          tick={{ fontSize: 10 }}
                          axisLine={{ stroke: '#94a3b8' }}
                          tickLine={{ stroke: '#94a3b8' }}
                          label={{ value: 'Abertura (mm)', position: 'insideBottom', offset: -5, fontSize: 11 }}
                        />
                        <YAxis
                          domain={[0, 100]}
                          ticks={[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]}
                          tick={{ fontSize: 11 }}
                          axisLine={{ stroke: '#94a3b8' }}
                          tickLine={{ stroke: '#94a3b8' }}
                          tickFormatter={(value) => `${value}%`}
                          label={{ value: '% Pasa', angle: -90, position: 'insideLeft', fontSize: 11 }}
                        />
                        <Tooltip
                          formatter={(value: number, name: string) => {
                            const labels: Record<string, string> = {
                              percentPassing: `Muestra`,
                              limitA: 'Limite A',
                              limitB: 'Limite B',
                              limitC: 'Limite C',
                            }
                            return [`${value?.toFixed(0)}%`, labels[name] || name]
                          }}
                          labelFormatter={(opening) => `Abertura: ${opening} mm`}
                          contentStyle={{ fontSize: 12 }}
                        />
                        <Legend 
                          verticalAlign="bottom" 
                          height={36}
                          wrapperStyle={{ paddingTop: 10 }}
                        />
                        <Line
                          type="linear"
                          dataKey="limitA"
                          stroke="#f97316"
                          strokeWidth={2}
                          strokeDasharray="8 4"
                          dot={false}
                          name="Limite A"
                        />
                        <Line
                          type="linear"
                          dataKey="limitB"
                          stroke="#eab308"
                          strokeWidth={2}
                          strokeDasharray="8 4"
                          dot={false}
                          name="Limite B"
                        />
                        <Line
                          type="linear"
                          dataKey="limitC"
                          stroke="#22c55e"
                          strokeWidth={2}
                          strokeDasharray="8 4"
                          dot={false}
                          name="Limite C"
                        />
                        <Line
                          type="linear"
                          dataKey="percentPassing"
                          stroke="#1a56db"
                          strokeWidth={3}
                          dot={{ fill: '#1a56db', r: 5, strokeWidth: 2, stroke: '#fff' }}
                          activeDot={{ r: 7, fill: '#1a56db' }}
                          name={`${testData?.aggregate_type || "Muestra"}`}
                          connectNulls
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

            {/* Devolución del Análisis */}
            {testData.fineness_modulus && (
              <Card className={testData.fineness_modulus >= 1.8 && testData.fineness_modulus <= 2.2 
                ? "border-green-300 bg-green-50/50" 
                : "border-amber-300 bg-amber-50/50"}>
                <CardContent className="pt-6">
                  <h3 className="font-semibold text-sm text-muted-foreground mb-4 uppercase tracking-wide">Devolucion del Analisis</h3>
                  
                  <div className="flex items-start gap-4">
                    {/* Estado */}
                    <div className={`px-4 py-3 rounded-lg ${
                      testData.fineness_modulus >= 1.8 && testData.fineness_modulus <= 2.2 
                        ? "bg-green-100 border border-green-300" 
                        : "bg-amber-100 border border-amber-300"
                    }`}>
                      <p className="text-xs text-muted-foreground mb-1">Estado</p>
                      <p className={`font-bold text-lg ${
                        testData.fineness_modulus >= 1.8 && testData.fineness_modulus <= 2.2 
                          ? "text-green-700" 
                          : "text-amber-700"
                      }`}>
                        {testData.fineness_modulus >= 1.8 && testData.fineness_modulus <= 2.2 
                          ? "APROBADO" 
                          : "PENDIENTE APROBACION"}
                      </p>
                    </div>

                    {/* Texto explicativo */}
                    <div className="flex-1 space-y-2">
                      <p className="text-sm leading-relaxed">
                        {testData.fineness_modulus >= 1.8 && testData.fineness_modulus <= 2.2 ? (
                          <>
                            El lote de arena analizado presenta un <strong>Modulo de Finura de {testData.fineness_modulus.toFixed(2)}</strong>, 
                            el cual se encuentra <strong>dentro del rango aceptable (1.80 - 2.20)</strong> segun norma ASTM C33. 
                            El material es apto para su uso en la elaboracion de hormigon sin necesidad de ajustes en la dosificacion.
                          </>
                        ) : testData.fineness_modulus < 1.8 ? (
                          <>
                            El lote de arena analizado presenta un <strong>Modulo de Finura de {testData.fineness_modulus.toFixed(2)}</strong>, 
                            el cual se encuentra <strong>por debajo del rango aceptable (1.80 - 2.20)</strong>. 
                            Esto indica que la arena es <strong>muy fina</strong>, con mayor proporcion de particulas pequeñas.
                          </>
                        ) : (
                          <>
                            El lote de arena analizado presenta un <strong>Modulo de Finura de {testData.fineness_modulus.toFixed(2)}</strong>, 
                            el cual se encuentra <strong>por encima del rango aceptable (1.80 - 2.20)</strong>. 
                            Esto indica que la arena es <strong>mas gruesa de lo recomendado</strong>, con mayor proporcion de particulas grandes.
                          </>
                        )}
                      </p>

                      {/* Recomendaciones si está fuera de rango */}
                      {(testData.fineness_modulus < 1.8 || testData.fineness_modulus > 2.2) && (
                        <div className="mt-3 p-3 rounded bg-white/70 border border-amber-200">
                          <p className="text-xs font-semibold text-amber-800 mb-2">RECOMENDACIONES:</p>
                          {testData.fineness_modulus < 1.8 ? (
                            <ul className="text-sm text-amber-900 space-y-1 list-disc list-inside">
                              <li>Considerar mezclar con arena mas gruesa para equilibrar la granulometria</li>
                              <li>Ajustar la formula aumentando la proporcion de agregado grueso</li>
                              <li>Puede requerir mayor cantidad de agua y cemento para mantener trabajabilidad</li>
                              <li>Consultar con el responsable tecnico antes de utilizar el lote</li>
                            </ul>
                          ) : (
                            <ul className="text-sm text-amber-900 space-y-1 list-disc list-inside">
                              <li>Considerar mezclar con arena mas fina para equilibrar la granulometria</li>
                              <li>Ajustar la formula aumentando la proporcion de arena fina</li>
                              <li>Verificar la cohesion de la mezcla durante la produccion</li>
                              <li>Consultar con el responsable tecnico antes de utilizar el lote</li>
                            </ul>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {testData.comments && (
              <Card>
                <CardContent className="pt-6">
                  <p className="text-sm">
                    <span className="font-semibold">Observaciones:</span> {testData.comments}
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        ) : (
          <div className="text-center p-8 text-muted-foreground">No se pudo cargar el ensayo</div>
        )}
      </DialogContent>
    </Dialog>
  )
}
