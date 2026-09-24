"use client"

/**
 * Mover stock de un material entre plantas (ej. fibra de Canning a Hudson).
 * Descuenta en la planta de origen y suma en la de destino, con un movimiento
 * de tipo "transferencia" en cada una para que el libro cuente la historia.
 */

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { currentUserName } from "@/lib/current-user"
import { logActivity } from "@/lib/activity-log"
import { formatStock } from "@/lib/stock-format"
import { ArrowLeftRight, Loader2 } from "lucide-react"

type Material = { id: string; name: string; unit: string; current_stock: number; plant_id?: string }
type Plant = { id: string; name: string }

type Props = {
  material: Material | null
  plants: Plant[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone?: () => void
}

export function TransferStockDialog({ material: materialProp, plants: plantsProp, open, onOpenChange, onDone }: Props) {
  // Si quien abre el diálogo no tiene la lista de plantas o el material no trae
  // su planta, se buscan acá para no depender de cada pantalla.
  const [plantsAuto, setPlantsAuto] = useState<Plant[]>([])
  const [material, setMaterial] = useState<Material | null>(materialProp)
  const plants = plantsProp.length ? plantsProp : plantsAuto
  useEffect(() => {
    if (!open) return
    const supabase = createClient()
    if (!plantsProp.length) supabase.from("plants").select("id, name").order("name").then(({ data }) => setPlantsAuto(data || []))
    if (materialProp && !materialProp.plant_id) {
      supabase.from("materials").select("id, name, unit, current_stock, plant_id").eq("id", materialProp.id).single().then(({ data }) => setMaterial(data || materialProp))
    } else {
      setMaterial(materialProp)
    }
  }, [open, materialProp, plantsProp.length])

  const [destinoPlanta, setDestinoPlanta] = useState("")
  const [destino, setDestino] = useState<Material | null>(null)
  const [cantidad, setCantidad] = useState("")
  const [notas, setNotas] = useState("")
  const [buscando, setBuscando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const { toast } = useToast()

  const origenPlanta = plants.find((p) => p.id === material?.plant_id)
  const otrasPlantas = plants.filter((p) => p.id !== material?.plant_id)

  useEffect(() => {
    if (!open) { setCantidad(""); setNotas(""); setDestino(null); setDestinoPlanta(otrasPlantas.length === 1 ? otrasPlantas[0].id : "") }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Al elegir planta de destino, buscar el mismo material allá (por nombre)
  useEffect(() => {
    if (!destinoPlanta || !material) { setDestino(null); return }
    let vivo = true
    ;(async () => {
      setBuscando(true)
      const supabase = createClient()
      const { data } = await supabase
        .from("materials")
        .select("id, name, unit, current_stock, plant_id")
        .eq("plant_id", destinoPlanta)
        .ilike("name", material.name)
        .maybeSingle()
      if (vivo) { setDestino(data || null); setBuscando(false) }
    })()
    return () => { vivo = false }
  }, [destinoPlanta, material])

  const qty = Number.parseFloat(cantidad)
  const valido = material && destino && !Number.isNaN(qty) && qty > 0

  async function transferir() {
    if (!valido || !material || !destino) return
    setGuardando(true)
    const supabase = createClient()
    const usuario = currentUserName()
    const hoy = new Date().toISOString().slice(0, 10)
    const destNombre = plants.find((p) => p.id === destinoPlanta)?.name || "otra planta"
    const origNombre = origenPlanta?.name || "otra planta"
    try {
      const { error: e1 } = await supabase.rpc("update_material_stock", { p_material_id: material.id, p_quantity_change: -qty })
      if (e1) throw e1
      const { error: e2 } = await supabase.rpc("update_material_stock", { p_material_id: destino.id, p_quantity_change: qty })
      if (e2) throw e2
      await supabase.from("stock_movements").insert([
        { material_id: material.id, movement_type: "transferencia", quantity_kg: -qty, reference_type: "transfer", movement_date: hoy, notes: `Transferencia a ${destNombre}${notas ? ` · ${notas}` : ""} (${usuario})` },
        { material_id: destino.id, movement_type: "transferencia", quantity_kg: qty, reference_type: "transfer", movement_date: hoy, notes: `Transferencia desde ${origNombre}${notas ? ` · ${notas}` : ""} (${usuario})` },
      ])
      await logActivity({
        action: "transferir",
        entity: "material",
        entityId: material.id,
        reference: material.name,
        plantId: material.plant_id,
        details: { Material: material.name, Cantidad: `${qty} ${material.unit}`, De: origNombre, A: destNombre, Notas: notas || "-" },
      })
      toast({ title: "Transferencia registrada", description: `${qty} ${material.unit} de ${material.name}: ${origNombre} → ${destNombre}` })
      onOpenChange(false)
      onDone?.()
    } catch (err: any) {
      toast({ title: "No se pudo transferir", description: err?.message || "Error", variant: "destructive" })
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ArrowLeftRight className="h-5 w-5" /> Mover {material?.name} entre plantas</DialogTitle>
          <DialogDescription>Se descuenta en {origenPlanta?.name || "origen"} y se suma en la planta de destino.</DialogDescription>
        </DialogHeader>
        {material && (
          <div className="space-y-4 py-2">
            <div className="rounded-lg bg-muted/50 p-3 text-sm">
              <p><span className="text-muted-foreground">Desde:</span> <strong>{origenPlanta?.name || "-"}</strong> · stock actual <strong>{formatStock(material.current_stock, material.name, material.unit)}</strong></p>
            </div>
            <div className="space-y-1.5">
              <Label>Hacia</Label>
              <Select value={destinoPlanta} onValueChange={setDestinoPlanta}>
                <SelectTrigger><SelectValue placeholder="Elegí la planta de destino" /></SelectTrigger>
                <SelectContent>
                  {otrasPlantas.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {destinoPlanta && (
                <p className="text-xs text-muted-foreground">
                  {buscando ? "Buscando el material en destino..." : destino ? `Stock actual allá: ${formatStock(destino.current_stock, destino.name, destino.unit)}` : <span className="text-red-600">Esa planta no tiene un material llamado "{material.name}". Crealo primero desde Agregar material.</span>}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Cantidad a mover ({material.unit})</Label>
              <Input type="number" step="0.1" min="0" inputMode="decimal" value={cantidad} onChange={(e) => setCantidad(e.target.value)} placeholder="0" autoFocus />
              {valido && (
                <p className="text-xs text-muted-foreground">
                  Queda: {origenPlanta?.name} {formatStock(material.current_stock - qty, material.name, material.unit)} · {plants.find((p) => p.id === destinoPlanta)?.name} {formatStock((destino?.current_stock || 0) + qty, material.name, material.unit)}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Notas (opcional)</Label>
              <Input value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Ej: lo llevó el camión AG083GT" />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={transferir} disabled={!valido || guardando}>
            {guardando ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ArrowLeftRight className="h-4 w-4 mr-2" />}Transferir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
