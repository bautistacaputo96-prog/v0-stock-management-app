"use client"

/**
 * Humedad del acopio (Arena Fina), una vez por día, igual que en la pantalla de siempre (components/plantista-view.tsx):
 * solo le aparece a quien carga materia prima. Es una copia mientras conviven las dos pantallas: al retirar la vieja
 * queda solo esta (fase-3.md 6.4).
 */
import { useEffect, useState } from "react"
import { format } from "date-fns"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { currentUserName } from "@/lib/current-user"
import { logActivity } from "@/lib/activity-log"

type Fila = { mode: "direct" | "calculate"; humidity: string; wetWeight: string; dryWeight: string }

export function HumedadAcopio({ plantId, habilitado }: { plantId: string; habilitado: boolean }) {
  const { toast } = useToast()
  const [materiales, setMateriales] = useState<{ id: string; name: string; stockpile_humidity: number | null }[]>([])
  const [abierto, setAbierto] = useState(false)
  const [revisada, setRevisada] = useState<Record<string, boolean>>({})
  const [form, setForm] = useState<Record<string, Fila>>({})
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    if (!habilitado || !plantId || revisada[plantId]) return
    let vivo = true
    ;(async () => {
      const sb = createClient()
      const hoy = format(new Date(), "yyyy-MM-dd")
      const { data: mats } = await sb.from("materials").select("id, name, stockpile_humidity").eq("plant_id", plantId).ilike("name", "arena fina").order("name")
      if (!vivo) return
      if (!mats?.length) { setRevisada((r) => ({ ...r, [plantId]: true })); return }
      const { data: logs } = await sb.from("daily_stockpile_humidity").select("material_id").eq("reading_date", hoy).eq("plant_id", plantId).in("material_id", mats.map((m: any) => m.id))
      if (!vivo) return
      const hechos = new Set((logs || []).map((l: any) => l.material_id))
      const faltan = mats.filter((m: any) => !hechos.has(m.id))
      setRevisada((r) => ({ ...r, [plantId]: true }))
      if (!faltan.length) return
      setMateriales(faltan as any)
      setForm(Object.fromEntries(faltan.map((m: any) => [m.id, { mode: "direct", humidity: m.stockpile_humidity?.toString() || "", wetWeight: "", dryWeight: "" }])))
      setAbierto(true)
    })()
    return () => { vivo = false }
  }, [plantId, habilitado]) // eslint-disable-line react-hooks/exhaustive-deps

  async function guardar() {
    if (!habilitado) return
    setGuardando(true)
    const sb = createClient()
    const hoy = format(new Date(), "yyyy-MM-dd")
    try {
      for (const m of materiales) {
        const f = form[m.id]
        let humedad: number
        if (f.mode === "direct") {
          humedad = parseFloat(f.humidity.replace(",", "."))
          if (isNaN(humedad) || humedad < 0) { toast({ title: "Error", description: `Ingresá la humedad de ${m.name}`, variant: "destructive" }); return }
        } else {
          const h = parseFloat(f.wetWeight.replace(",", ".")) || 0, s = parseFloat(f.dryWeight.replace(",", ".")) || 0
          if (s <= 0) { toast({ title: "Error", description: `Peso seco inválido para ${m.name}`, variant: "destructive" }); return }
          humedad = ((h - s) / s) * 100
        }
        // Una lectura por material, planta y día; el trigger la copia a materials.stockpile_humidity
        const { error } = await sb.from("daily_stockpile_humidity").upsert({
          material_id: m.id, plant_id: plantId, reading_date: hoy, humidity_percent: humedad,
          wet_weight_grams: f.mode === "calculate" ? parseFloat(f.wetWeight.replace(",", ".")) : null,
          dry_weight_grams: f.mode === "calculate" ? parseFloat(f.dryWeight.replace(",", ".")) : null,
          recorded_by: currentUserName(),
        }, { onConflict: "plant_id,material_id,reading_date" })
        if (error) throw error
        logActivity({ action: "crear", entity: "humedad", entityId: m.id, reference: m.name, plantId, details: { Material: m.name, "Humedad (%)": Math.round(humedad * 100) / 100, Fecha: hoy } })
      }
      toast({ title: "Humedad registrada", description: "Los valores de humedad del acopio fueron actualizados" })
      setAbierto(false)
    } catch (e: any) {
      toast({ title: "Error", description: `No se pudo guardar la humedad${e?.message ? `: ${e.message}` : ""}`, variant: "destructive" })
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Humedad del Acopio - Control Diario</DialogTitle>
          <DialogDescription>Registre la humedad actual de los materiales en acopio. Este control es obligatorio una vez por día.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-4 overflow-y-auto py-2">
          {materiales.map((m) => {
            const f = form[m.id] || { mode: "direct", humidity: "", wetWeight: "", dryWeight: "" }
            const setF = (c: Partial<Fila>) => setForm((x) => ({ ...x, [m.id]: { ...f, ...c } }))
            const calc = f.mode === "calculate" && f.wetWeight && f.dryWeight
              ? (((parseFloat(f.wetWeight) - parseFloat(f.dryWeight)) / parseFloat(f.dryWeight)) * 100).toFixed(2) : null
            return (
              <Card key={m.id}>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm font-medium">{m.name}</CardTitle>
                  {m.stockpile_humidity != null && <p className="text-xs text-muted-foreground">Última humedad: {Number(m.stockpile_humidity).toFixed(2)}%</p>}
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex gap-2">
                    <Button type="button" size="sm" variant={f.mode === "direct" ? "default" : "outline"} onClick={() => setF({ mode: "direct" })}>Ingresar %</Button>
                    <Button type="button" size="sm" variant={f.mode === "calculate" ? "default" : "outline"} onClick={() => setF({ mode: "calculate" })}>Calcular</Button>
                  </div>
                  {f.mode === "direct" ? (
                    <div className="space-y-2"><Label className="text-xs">Humedad (%)</Label><Input inputMode="decimal" placeholder="Ej: 5.5" value={f.humidity} onChange={(e) => setF({ humidity: e.target.value })} /></div>
                  ) : (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1"><Label className="text-xs">Peso Húmedo (g)</Label><Input inputMode="decimal" placeholder="Ej: 500" value={f.wetWeight} onChange={(e) => setF({ wetWeight: e.target.value })} /></div>
                        <div className="space-y-1"><Label className="text-xs">Peso Seco (g)</Label><Input inputMode="decimal" placeholder="Ej: 475" value={f.dryWeight} onChange={(e) => setF({ dryWeight: e.target.value })} /></div>
                      </div>
                      {calc && <p className="text-sm font-medium text-primary">Humedad calculada: {calc}%</p>}
                      <p className="text-xs text-muted-foreground">Fórmula: (Peso Húmedo - Peso Seco) / Peso Seco × 100</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setAbierto(false)}>Omitir por ahora</Button>
          <Button onClick={guardar} disabled={guardando}>{guardando ? "Guardando..." : "Guardar Humedad"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
