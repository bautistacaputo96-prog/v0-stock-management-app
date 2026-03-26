"use client"

import { useState, useEffect, useCallback } from "react"
import { usePlant } from "@/lib/plant-context"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Navigation } from "@/components/navigation"
import { PlusCircle, CheckCircle2, Loader2, AlertTriangle, ShieldCheck, Droplets, Hammer } from "lucide-react"

// IRAM reference parameters
const ABSORPTION_LIMITS = {
  individual_max: 6.0, // % max per individual sample
  average_max: 5.0, // % max average of 3 samples
}

const FLEXION_LIMITS = {
  individual_min: 3.5, // MPa min per individual sample
  average_min: 4.0, // MPa min average of 3 samples
}

const PIPE_DIAMETERS = [300, 400, 500, 600, 800, 1000, 1200]

interface AbsorptionTest {
  id: number
  test_date: string
  pipe_diameter: number
  sample_dry_weight_g: number
  sample_wet_weight_g: number
  absorption_percentage: number
  complies_iram: boolean
  lote: string
  observations: string
  plant: string
}

interface FlexionTest {
  id: number
  test_date: string
  product_type: string
  sample_length_mm: number
  sample_width_mm: number
  sample_height_mm: number
  break_load_n: number
  flexion_strength_mpa: number
  complies_iram: boolean
  lote: string
  observations: string
  plant: string
}

export default function EnsayosPage() {
  const { selectedPlant } = usePlant()
  const [activeTab, setActiveTab] = useState<"absorption" | "flexion">("absorption")
  const [absorptionTests, setAbsorptionTests] = useState<AbsorptionTest[]>([])
  const [flexionTests, setFlexionTests] = useState<FlexionTest[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [showForm, setShowForm] = useState(false)

  // Absorption form
  const [absDate, setAbsDate] = useState(new Date().toISOString().split("T")[0])
  const [absDiameter, setAbsDiameter] = useState("")
  const [absDryWeight, setAbsDryWeight] = useState("")
  const [absWetWeight, setAbsWetWeight] = useState("")
  const [absLote, setAbsLote] = useState("")
  const [absObs, setAbsObs] = useState("")

  // Flexion form
  const [flexDate, setFlexDate] = useState(new Date().toISOString().split("T")[0])
  const [flexProduct, setFlexProduct] = useState("")
  const [flexLength, setFlexLength] = useState("")
  const [flexWidth, setFlexWidth] = useState("")
  const [flexHeight, setFlexHeight] = useState("")
  const [flexLoad, setFlexLoad] = useState("")
  const [flexLote, setFlexLote] = useState("")
  const [flexObs, setFlexObs] = useState("")

  // Calculated values
  const dryW = parseFloat(absDryWeight) || 0
  const wetW = parseFloat(absWetWeight) || 0
  const absorptionPct = dryW > 0 ? ((wetW - dryW) / dryW) * 100 : 0
  const absComplies = absorptionPct <= ABSORPTION_LIMITS.individual_max && absorptionPct > 0

  const fLength = parseFloat(flexLength) || 0
  const fWidth = parseFloat(flexWidth) || 0
  const fHeight = parseFloat(flexHeight) || 0
  const fLoad = parseFloat(flexLoad) || 0
  // Flexion strength = (3 * F * L) / (2 * b * h^2) where F=load(N), L=length(mm), b=width(mm), h=height(mm)
  const flexionMpa = fWidth > 0 && fHeight > 0 && fLength > 0
    ? (3 * fLoad * fLength) / (2 * fWidth * fHeight * fHeight) // Result in MPa since load in N and dims in mm
    : 0
  const flexComplies = flexionMpa >= FLEXION_LIMITS.individual_min && flexionMpa > 0

  const fetchTests = useCallback(async () => {
    setLoading(true)
    try {
      const [absRes, flexRes] = await Promise.all([
        fetch(`/api/quality/tests?type=absorption&plant=${selectedPlant}`),
        fetch(`/api/quality/tests?type=flexion&plant=${selectedPlant}`),
      ])
      if (absRes.ok) setAbsorptionTests(await absRes.json())
      if (flexRes.ok) setFlexionTests(await flexRes.json())
    } catch { /* ignore */ }
    setLoading(false)
  }, [selectedPlant])

  useEffect(() => { fetchTests() }, [fetchTests])

  const resetForm = () => {
    setAbsDate(new Date().toISOString().split("T")[0])
    setAbsDiameter(""); setAbsDryWeight(""); setAbsWetWeight("")
    setAbsLote(""); setAbsObs("")
    setFlexDate(new Date().toISOString().split("T")[0])
    setFlexProduct(""); setFlexLength(""); setFlexWidth("")
    setFlexHeight(""); setFlexLoad(""); setFlexLote(""); setFlexObs("")
  }

  const submitAbsorption = async () => {
    if (!absDiameter || !absDryWeight || !absWetWeight) return
    setSubmitting(true)
    try {
      const res = await fetch("/api/quality/tests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "absorption",
          test_date: absDate,
          pipe_diameter: parseInt(absDiameter),
          sample_dry_weight_g: dryW,
          sample_wet_weight_g: wetW,
          absorption_percentage: Math.round(absorptionPct * 100) / 100,
          complies_iram: absComplies,
          lote: absLote,
          observations: absObs,
          plant: selectedPlant,
        }),
      })
      if (res.ok) { resetForm(); setShowForm(false); fetchTests() }
    } catch { /* ignore */ }
    setSubmitting(false)
  }

  const submitFlexion = async () => {
    if (!flexProduct || !flexLoad) return
    setSubmitting(true)
    try {
      const res = await fetch("/api/quality/tests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "flexion",
          test_date: flexDate,
          product_type: flexProduct,
          sample_length_mm: fLength,
          sample_width_mm: fWidth,
          sample_height_mm: fHeight,
          break_load_n: fLoad,
          flexion_strength_mpa: Math.round(flexionMpa * 100) / 100,
          complies_iram: flexComplies,
          lote: flexLote,
          observations: flexObs,
          plant: selectedPlant,
        }),
      })
      if (res.ok) { resetForm(); setShowForm(false); fetchTests() }
    } catch { /* ignore */ }
    setSubmitting(false)
  }

  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground tracking-tight">Ensayos de Calidad</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Absorcion (canos) y Flexion (adoquines)</p>
        </div>
        <Button onClick={() => { setShowForm(!showForm); if (showForm) resetForm() }} size="sm" className="gap-2">
          <PlusCircle className="h-4 w-4" />
          Nuevo Ensayo
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-muted rounded-lg p-1 w-fit">
        <button
          onClick={() => { setActiveTab("absorption"); setShowForm(false) }}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-medium transition-all ${activeTab === "absorption" ? "bg-card text-foreground shadow-sm border border-border" : "text-muted-foreground hover:text-foreground"}`}
        >
          <Droplets className="w-3.5 h-3.5" />
          Absorcion (Canos)
        </button>
        <button
          onClick={() => { setActiveTab("flexion"); setShowForm(false) }}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-medium transition-all ${activeTab === "flexion" ? "bg-card text-foreground shadow-sm border border-border" : "text-muted-foreground hover:text-foreground"}`}
        >
          <Hammer className="w-3.5 h-3.5" />
          Flexion (Adoquines)
        </button>
      </div>

      {/* IRAM Reference */}
      <div className="flex items-center gap-4 p-3 bg-muted/50 rounded-lg border border-border text-xs">
        <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
        {activeTab === "absorption" ? (
          <span className="text-muted-foreground">
            <span className="font-semibold text-foreground">Ref. IRAM:</span> Absorcion max. individual {ABSORPTION_LIMITS.individual_max}%, promedio 3 muestras {ABSORPTION_LIMITS.average_max}%
          </span>
        ) : (
          <span className="text-muted-foreground">
            <span className="font-semibold text-foreground">Ref. IRAM:</span> Resistencia flexion min. individual {FLEXION_LIMITS.individual_min} MPa, promedio 3 muestras {FLEXION_LIMITS.average_min} MPa
          </span>
        )}
      </div>

      {/* Absorption Form */}
      {showForm && activeTab === "absorption" && (
        <Card className="border-primary/20">
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Nuevo Ensayo de Absorcion</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Fecha</Label>
                <Input type="date" value={absDate} onChange={(e) => setAbsDate(e.target.value)} className="text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Diametro Cano</Label>
                <Select value={absDiameter} onValueChange={setAbsDiameter}>
                  <SelectTrigger className="text-sm"><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                  <SelectContent>
                    {PIPE_DIAMETERS.map((d) => (
                      <SelectItem key={d} value={String(d)}>Cano {d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Lote</Label>
                <Input value={absLote} onChange={(e) => setAbsLote(e.target.value)} placeholder="L-2026-02" className="text-sm" />
              </div>
              <div />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Peso Seco (g)</Label>
                <Input type="number" step="0.1" value={absDryWeight} onChange={(e) => setAbsDryWeight(e.target.value)} placeholder="450.0" className="text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Peso Saturado (g)</Label>
                <Input type="number" step="0.1" value={absWetWeight} onChange={(e) => setAbsWetWeight(e.target.value)} placeholder="470.0" className="text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Absorcion (%)</Label>
                <div className={`flex items-center h-9 px-3 rounded-md border text-sm font-bold ${absorptionPct > 0 ? (absComplies ? "border-emerald-500/50 bg-emerald-50 text-emerald-700" : "border-destructive/50 bg-destructive/5 text-destructive") : "border-border bg-muted text-muted-foreground"}`}>
                  {absorptionPct > 0 ? `${absorptionPct.toFixed(2)}%` : "-"}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Resultado</Label>
                <div className="flex items-center h-9">
                  {absorptionPct > 0 ? (
                    absComplies ? (
                      <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 gap-1">
                        <CheckCircle2 className="h-3 w-3" /> CUMPLE
                      </Badge>
                    ) : (
                      <Badge variant="destructive" className="gap-1">
                        <AlertTriangle className="h-3 w-3" /> NO CUMPLE
                      </Badge>
                    )
                  ) : (
                    <span className="text-xs text-muted-foreground">Ingrese datos</span>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Observaciones</Label>
              <Input value={absObs} onChange={(e) => setAbsObs(e.target.value)} className="text-sm" />
            </div>

            <div className="flex items-center gap-3 border-t border-border pt-4">
              <Button onClick={submitAbsorption} disabled={submitting || !absDiameter || !absDryWeight || !absWetWeight} size="sm" className="gap-2">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Registrar Ensayo
              </Button>
              <Button variant="outline" size="sm" onClick={() => { setShowForm(false); resetForm() }}>Cancelar</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Flexion Form */}
      {showForm && activeTab === "flexion" && (
        <Card className="border-primary/20">
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Nuevo Ensayo de Flexion</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Fecha</Label>
                <Input type="date" value={flexDate} onChange={(e) => setFlexDate(e.target.value)} className="text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Tipo de Producto</Label>
                <Input value={flexProduct} onChange={(e) => setFlexProduct(e.target.value)} placeholder="Adoquin rectangular" className="text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Lote</Label>
                <Input value={flexLote} onChange={(e) => setFlexLote(e.target.value)} placeholder="L-2026-02" className="text-sm" />
              </div>
              <div />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Largo (mm)</Label>
                <Input type="number" step="0.1" value={flexLength} onChange={(e) => setFlexLength(e.target.value)} placeholder="200" className="text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Ancho (mm)</Label>
                <Input type="number" step="0.1" value={flexWidth} onChange={(e) => setFlexWidth(e.target.value)} placeholder="100" className="text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Alto (mm)</Label>
                <Input type="number" step="0.1" value={flexHeight} onChange={(e) => setFlexHeight(e.target.value)} placeholder="60" className="text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Carga Rotura (N)</Label>
                <Input type="number" step="1" value={flexLoad} onChange={(e) => setFlexLoad(e.target.value)} placeholder="15000" className="text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Resistencia (MPa)</Label>
                <div className={`flex items-center h-9 px-3 rounded-md border text-sm font-bold ${flexionMpa > 0 ? (flexComplies ? "border-emerald-500/50 bg-emerald-50 text-emerald-700" : "border-destructive/50 bg-destructive/5 text-destructive") : "border-border bg-muted text-muted-foreground"}`}>
                  {flexionMpa > 0 ? `${flexionMpa.toFixed(2)} MPa` : "-"}
                </div>
              </div>
            </div>

            {flexionMpa > 0 && (
              <div className={`flex items-center gap-2 p-3 rounded-lg text-xs ${flexComplies ? "bg-emerald-50 border border-emerald-200" : "bg-destructive/5 border border-destructive/20"}`}>
                {flexComplies ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    <span className="font-semibold text-emerald-700">CUMPLE IRAM</span>
                    <span className="text-emerald-600">- {flexionMpa.toFixed(2)} MPa (min. {FLEXION_LIMITS.individual_min} MPa)</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-4 w-4 text-destructive" />
                    <span className="font-semibold text-destructive">NO CUMPLE IRAM</span>
                    <span className="text-destructive/80">- {flexionMpa.toFixed(2)} MPa (min. {FLEXION_LIMITS.individual_min} MPa)</span>
                  </>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs">Observaciones</Label>
              <Input value={flexObs} onChange={(e) => setFlexObs(e.target.value)} className="text-sm" />
            </div>

            <div className="flex items-center gap-3 border-t border-border pt-4">
              <Button onClick={submitFlexion} disabled={submitting || !flexProduct || !flexLoad} size="sm" className="gap-2">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Registrar Ensayo
              </Button>
              <Button variant="outline" size="sm" onClick={() => { setShowForm(false); resetForm() }}>Cancelar</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Results tables */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {activeTab === "absorption" ? "Historial Ensayos de Absorcion" : "Historial Ensayos de Flexion"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : activeTab === "absorption" ? (
            absorptionTests.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">No hay ensayos de absorcion registrados</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2.5 px-3 text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Fecha</th>
                      <th className="text-left py-2.5 px-3 text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Cano</th>
                      <th className="text-left py-2.5 px-3 text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Lote</th>
                      <th className="text-right py-2.5 px-3 text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Peso Seco</th>
                      <th className="text-right py-2.5 px-3 text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Peso Sat.</th>
                      <th className="text-right py-2.5 px-3 text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Absorcion</th>
                      <th className="text-center py-2.5 px-3 text-[10px] uppercase tracking-widest font-medium text-muted-foreground">IRAM</th>
                    </tr>
                  </thead>
                  <tbody>
                    {absorptionTests.map((t) => (
                      <tr key={t.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                        <td className="py-2.5 px-3 text-xs">{new Date(t.test_date).toLocaleDateString("es-AR")}</td>
                        <td className="py-2.5 px-3 text-xs font-medium">Cano {t.pipe_diameter}</td>
                        <td className="py-2.5 px-3 text-xs font-mono">{t.lote || "-"}</td>
                        <td className="py-2.5 px-3 text-xs text-right">{t.sample_dry_weight_g} g</td>
                        <td className="py-2.5 px-3 text-xs text-right">{t.sample_wet_weight_g} g</td>
                        <td className={`py-2.5 px-3 text-xs text-right font-semibold ${t.complies_iram ? "text-emerald-600" : "text-destructive"}`}>
                          {t.absorption_percentage}%
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          {t.complies_iram ? (
                            <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[9px]">CUMPLE</Badge>
                          ) : (
                            <Badge variant="destructive" className="text-[9px]">NO CUMPLE</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            flexionTests.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">No hay ensayos de flexion registrados</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2.5 px-3 text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Fecha</th>
                      <th className="text-left py-2.5 px-3 text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Producto</th>
                      <th className="text-left py-2.5 px-3 text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Lote</th>
                      <th className="text-right py-2.5 px-3 text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Dimensiones</th>
                      <th className="text-right py-2.5 px-3 text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Carga (N)</th>
                      <th className="text-right py-2.5 px-3 text-[10px] uppercase tracking-widest font-medium text-muted-foreground">Resistencia</th>
                      <th className="text-center py-2.5 px-3 text-[10px] uppercase tracking-widest font-medium text-muted-foreground">IRAM</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flexionTests.map((t) => (
                      <tr key={t.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                        <td className="py-2.5 px-3 text-xs">{new Date(t.test_date).toLocaleDateString("es-AR")}</td>
                        <td className="py-2.5 px-3 text-xs font-medium">{t.product_type}</td>
                        <td className="py-2.5 px-3 text-xs font-mono">{t.lote || "-"}</td>
                        <td className="py-2.5 px-3 text-xs text-right">{t.sample_length_mm}x{t.sample_width_mm}x{t.sample_height_mm}</td>
                        <td className="py-2.5 px-3 text-xs text-right">{t.break_load_n?.toLocaleString()}</td>
                        <td className={`py-2.5 px-3 text-xs text-right font-semibold ${t.complies_iram ? "text-emerald-600" : "text-destructive"}`}>
                          {t.flexion_strength_mpa} MPa
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          {t.complies_iram ? (
                            <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[9px]">CUMPLE</Badge>
                          ) : (
                            <Badge variant="destructive" className="text-[9px]">NO CUMPLE</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </CardContent>
      </Card>
      </div>
    </div>
  )
}
