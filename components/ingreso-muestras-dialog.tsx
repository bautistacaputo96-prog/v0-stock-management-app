"use client"
/**
 * Materias Primas › Ingresos › menú de la fila: "Cargar humedad" / "Corregir humedad" y "Muestra de granulometría".
 * Para cualquier ingreso de Arena Fina (importado de Zomatik o a mano), con materia_prima.cargar. La lógica está en
 * lib/ingresos/muestras.ts (la misma que usa "Registrar Ingreso"). Docs: docs/ingresos-mp-zomatik.md, punto 4.
 */
import { useEffect, useState } from "react"
import { Calculator, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CampoMotivo, motivoValido } from "@/components/motivo"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"
import { logActivity, logCambio } from "@/lib/activity-log"
import { calcularHumedad, crearMuestraGranulometria, efectosHumedad, guardarHumedad, PESO_MUESTRA_HUMEDA, TOLERANCIA_HUMEDAD } from "@/lib/ingresos/muestras"

export type IngresoParaMuestra = {
  id: string
  material_id?: string
  quantity: number
  dry_quantity?: number | null
  humidity_percentage: number | null
  remito: string | null
  entry_date: string
  supplier_id?: string | null
  supplier?: string | null
  materials: { id: string; name: string; unit: string; plant_id?: string | null }
  suppliers?: { id: string; name: string } | null
}

export function IngresoMuestrasDialog({
  ingreso,
  modo,
  onOpenChange,
  onListo,
}: {
  ingreso: IngresoParaMuestra | null
  modo: "humedad" | "granulometria"
  onOpenChange: (open: boolean) => void
  onListo?: () => void
}) {
  const { toast } = useToast()
  const [humedad, setHumedad] = useState("")
  const [seco, setSeco] = useState("")
  const [calc, setCalc] = useState(false)
  const [motivo, setMotivo] = useState("")
  const [proveedor, setProveedor] = useState("")
  const [proveedores, setProveedores] = useState<{ id: string; name: string }[]>([])
  const [guardando, setGuardando] = useState(false)
  const corrige = ingreso?.humidity_percentage !== null && ingreso?.humidity_percentage !== undefined
  const materialId = ingreso?.material_id || ingreso?.materials?.id

  useEffect(() => {
    if (!ingreso) return
    setHumedad(corrige ? String(ingreso.humidity_percentage) : "")
    setSeco("")
    setCalc(false)
    setMotivo("")
    setProveedor("")
    if (modo === "humedad" && !ingreso.supplier_id && materialId) {
      createClient()
        .from("material_suppliers")
        .select("suppliers(id, name)")
        .eq("material_id", materialId)
        .then(({ data }) => setProveedores(((data as any[]) || []).map((x) => x.suppliers).filter(Boolean)))
    }
  }, [ingreso?.id, modo])

  if (!ingreso) return null
  const h = Number.parseFloat(humedad.replace(",", "."))
  const ef = Number.isFinite(h) && h >= 0 ? efectosHumedad({ quantity: ingreso.quantity, dryViejo: ingreso.dry_quantity, humedad: h }) : null
  const faltaProveedor = !!ef?.exceso && !ingreso.supplier_id && !proveedor
  const listo = modo === "granulometria" || (ef !== null && h < 100 && !faltaProveedor && (!corrige || motivoValido(motivo)))

  async function guardar() {
    if (!ingreso || !materialId) return
    setGuardando(true)
    const sb = createClient()
    try {
      const e = {
        id: ingreso.id,
        material_id: materialId,
        quantity: ingreso.quantity,
        dry_quantity: ingreso.dry_quantity,
        humidity_percentage: ingreso.humidity_percentage,
        remito: ingreso.remito,
        entry_date: ingreso.entry_date,
        supplier_id: ingreso.supplier_id ?? ingreso.suppliers?.id ?? null,
        plant_id: ingreso.materials.plant_id ?? null,
      }
      if (modo === "humedad") {
        const r = await guardarHumedad(sb as any, e, h, { supplierId: proveedor || null })
        await logCambio({
          entity: "ingreso",
          entityId: ingreso.id,
          reference: ingreso.remito || null,
          plantId: ingreso.materials.plant_id ?? null,
          antes: { humedad: corrige ? `${ingreso.humidity_percentage}%` : "" },
          despues: { humedad: `${h}%` },
          etiquetas: { humedad: "Humedad" },
          motivo: corrige ? motivo.trim() : null,
          extra: { Material: ingreso.materials.name, Seco: `${r.dryNuevo.toLocaleString("es-AR")} kg`, ...(r.exceso ? { Excedente: `${r.exceso.tn} t` } : {}) },
        })
        toast({ title: corrige ? "Humedad corregida" : "Humedad cargada", description: r.exceso ? `Excede ${TOLERANCIA_HUMEDAD}%: ${r.exceso.tn.toFixed(4)} t a reconocer por el proveedor` : undefined })
      } else {
        const prov = ingreso.suppliers?.name || ingreso.supplier || ""
        const id = await crearMuestraGranulometria(sb as any, e, { materialName: ingreso.materials.name, providerName: prov })
        await logActivity({ action: "crear", entity: "granulometria", entityId: id, reference: ingreso.remito || null, plantId: ingreso.materials.plant_id ?? null, details: { Agregado: ingreso.materials.name, Remito: ingreso.remito || "-", Estado: "Pendiente (muestra del ingreso)" } })
        toast({ title: "Muestra registrada", description: "Quedó un ensayo pendiente en Calidad › Granulometría" })
      }
      onListo?.()
      onOpenChange(false)
    } catch (err) {
      toast({ variant: "destructive", title: "No se pudo guardar", description: err instanceof Error ? err.message : "Probá de nuevo" })
    }
    setGuardando(false)
  }

  return (
    <Dialog open={!!ingreso} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{modo === "granulometria" ? "Muestra de granulometría" : corrige ? "Corregir humedad" : "Cargar humedad"}</DialogTitle>
          <DialogDescription>
            {ingreso.materials.name} · remito {ingreso.remito || "-"} · {ingreso.quantity.toLocaleString("es-AR")} {ingreso.materials.unit}
          </DialogDescription>
        </DialogHeader>
        {modo === "granulometria" ? (
          <p className="text-sm">Se crea un ensayo pendiente en Calidad › Granulometría, vinculado a este ingreso.</p>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="space-y-1">
              <Label htmlFor="humedad-fila">Humedad (%)</Label>
              <div className="flex gap-2">
                <Input id="humedad-fila" className="w-28" type="number" step="0.01" min="0" max="100" value={humedad} onChange={(e) => setHumedad(e.target.value)} />
                <Button type="button" variant="outline" size="sm" onClick={() => setCalc(!calc)}>
                  <Calculator className="mr-1 h-4 w-4" />
                  Calcular
                </Button>
              </div>
              {calc && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Muestra húmeda {PESO_MUESTRA_HUMEDA} g · seca (g)</span>
                  <Input className="h-7 w-24 text-xs" type="number" step="0.01" value={seco} onChange={(e) => setSeco(e.target.value)} placeholder="Ej: 475" />
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    disabled={calcularHumedad(Number.parseFloat(seco)) === null}
                    onClick={() => {
                      const v = calcularHumedad(Number.parseFloat(seco))
                      if (v !== null) setHumedad(String(v))
                      setCalc(false)
                    }}
                  >
                    Aplicar
                  </Button>
                </div>
              )}
            </div>
            {ef && (
              <div className="text-xs text-muted-foreground">
                En seco: {ef.dryNuevo.toLocaleString("es-AR")} kg
                {ef.exceso ? <span className="text-amber-700"> · excede {TOLERANCIA_HUMEDAD}%: {ef.exceso.tn.toFixed(4)} t a reconocer por el proveedor</span> : null}
              </div>
            )}
            {ef?.exceso && !ingreso.supplier_id && (
              <div className="space-y-1">
                <Label>Elegí el proveedor</Label>
                <Select value={proveedor} onValueChange={setProveedor}>
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder={ingreso.supplier ? `Zomatik dice: ${ingreso.supplier}` : "Proveedor..."} />
                  </SelectTrigger>
                  <SelectContent>
                    {proveedores.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {corrige && <CampoMotivo value={motivo} onChange={setMotivo} id="motivo-humedad" />}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={guardar} disabled={guardando || !listo}>
            {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
