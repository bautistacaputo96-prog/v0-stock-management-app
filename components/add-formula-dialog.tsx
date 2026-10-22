"use client"

import type React from "react"
import { useState, useMemo } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Plus } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"
import { logActivity } from "@/lib/activity-log"
import { usePermisos } from "@/lib/current-user"
import { CamposNombre, codigoDe, type ValorNombre } from "@/components/formulas/campos-nombre"
import { PARTES_VACIAS } from "@/lib/formulas-nombre"

type Material = {
  id: string
  name: string
  unit: string
}

interface AddFormulaDialogProps {
  materials: Material[]
  plantId: string
  /** nombre de la planta: pone (CAN) / (HUD) en el código */
  plantName?: string | null
  onSuccess: () => void
  /** texto del botón (por defecto "Agregar Formula") */
  etiqueta?: string
  /** botón chico, para el encabezado de la tabla de Fórmulas */
  compacto?: boolean
}

const NOMBRE_VACIO: ValorNombre = { modo: "partes", partes: PARTES_VACIAS, libre: "" }

export function AddFormulaDialog({ materials, plantId, plantName = null, onSuccess, etiqueta = "Agregar Formula", compacto = false }: AddFormulaDialogProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const { esGerencial } = usePermisos()
  // Nombre automático (22/10): H30-620-15 B (CAN) PELQUE; nombre libre solo gerencial
  const [nombre, setNombre] = useState<ValorNombre>(NOMBRE_VACIO)
  const [formData, setFormData] = useState({
    yield_m3: "1.0",
  })
  // Store quantities keyed by material_id
  const [materialQuantities, setMaterialQuantities] = useState<Record<string, string>>({})
  const { toast } = useToast()

  const { codigo: generatedCode, error: errorNombre } = codigoDe(nombre, plantName)

  const updateMaterialQuantity = (materialId: string, quantity: string) => {
    setMaterialQuantities(prev => ({
      ...prev,
      [materialId]: quantity
    }))
  }

  const resetForm = () => {
    setFormData({ yield_m3: "1.0" })
    setNombre(NOMBRE_VACIO)
    setMaterialQuantities({})
  }

  // Get materials with quantities > 0
  const formulaMaterials = useMemo(() => {
    return Object.entries(materialQuantities)
      .filter(([_, qty]) => Number.parseFloat(qty) > 0)
      .map(([material_id, quantity]) => ({ material_id, quantity }))
  }, [materialQuantities])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (errorNombre || !generatedCode) {
      toast({ variant: "destructive", title: "Falta el nombre", description: errorNombre || "Completá el nombre de la fórmula" })
      return
    }
    if (nombre.modo === "libre" && !esGerencial) {
      toast({ variant: "destructive", title: "Nombre libre", description: "Solo un gerencial puede poner un nombre libre." })
      return
    }

    if (formulaMaterials.length === 0) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Debes agregar al menos un material a la formula",
      })
      return
    }

    setLoading(true)

    try {
      const supabase = createClient()

      // Insert formula
      const { data: formula, error: formulaError } = await supabase
        .from("formulas")
        .insert({
          code: generatedCode,
          name: generatedCode,
          description: null,
          yield_m3: Number.parseFloat(formData.yield_m3),
          plant_id: plantId,
        })
        .select()
        .single()

      if (formulaError) {
        if ((formulaError as { code?: string }).code === "23505") throw new Error(`Ya existe ${generatedCode} en esta planta`)
        throw formulaError
      }

      // Insert formula materials
      const { error: materialsError } = await supabase.from("formula_materials").insert(
        formulaMaterials.map((m) => ({
          formula_id: formula.id,
          material_id: m.material_id,
          quantity: Number.parseFloat(m.quantity),
        })),
      )

      if (materialsError) throw materialsError

      logActivity({
        action: "crear",
        entity: "formula",
        entityId: formula.id,
        reference: generatedCode,
        plantId,
        details: {
          "Código": generatedCode,
          "Rinde (m³)": Number.parseFloat(formData.yield_m3),
          Materiales: formulaMaterials.map((m) => `${materials.find((x: any) => x.id === m.material_id)?.name || "?"} ${m.quantity}`).join(" · "),
        },
      })

      toast({
        title: "Formula agregada",
        description: `${generatedCode} se agrego correctamente`,
      })

      resetForm()
      setOpen(false)
      onSuccess()
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : "No se pudo agregar la formula",
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) resetForm() }}>
      <DialogTrigger asChild>
        <Button size={compacto ? "sm" : "default"} className={compacto ? "h-8" : undefined}>
          <Plus className={compacto ? "h-4 w-4 mr-1" : "h-4 w-4 mr-2"} />
          {etiqueta}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Agregar Formula</DialogTitle>
          <DialogDescription>Crea una nueva formula de hormigon con su composicion</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <CamposNombre valor={nombre} onChange={setNombre} planta={plantName} permiteLibre={esGerencial} />

          <div className="space-y-2">
            <Label>Rinde (m3)</Label>
            <Input
              type="number"
              step="0.001"
              value={formData.yield_m3}
              onChange={(e) => setFormData({ ...formData, yield_m3: e.target.value })}
              required
            />
          </div>

          {/* Materials Table */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Composicion</Label>
              <span className="text-sm text-muted-foreground">
                {formulaMaterials.length} material{formulaMaterials.length !== 1 ? "es" : ""} con cantidad
              </span>
            </div>

            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="w-[50%]">Material</TableHead>
                    <TableHead className="w-[25%]">Cantidad</TableHead>
                    <TableHead className="w-[25%]">Unidad</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {materials.map((material) => (
                    <TableRow key={material.id} className={materialQuantities[material.id] && Number.parseFloat(materialQuantities[material.id]) > 0 ? "bg-primary/5" : ""}>
                      <TableCell className="font-medium py-2">{material.name}</TableCell>
                      <TableCell className="py-2">
                        <Input
                          type="number"
                          step="0.001"
                          min="0"
                          value={materialQuantities[material.id] || ""}
                          onChange={(e) => updateMaterialQuantity(material.id, e.target.value)}
                          placeholder="0"
                          className="h-8"
                        />
                      </TableCell>
                      <TableCell className="py-2 text-muted-foreground">{material.unit}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Guardando..." : "Guardar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
