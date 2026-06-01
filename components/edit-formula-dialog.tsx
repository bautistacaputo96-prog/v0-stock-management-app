"use client"

import type React from "react"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, X, Droplets } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"

type Material = {
  id: string
  name: string
  unit: string
}

type FormulaMaterialInput = {
  id?: string
  material_id: string
  quantity: string
}

type FormulaMaterial = {
  id: string
  quantity: number
  materials: Material
}

type Formula = {
  id: string
  code: string
  name: string
  description: string | null
  yield_m3: number
  formula_materials: FormulaMaterial[]
}

export function EditFormulaDialog({
  formula,
  materials,
  open,
  onOpenChange,
}: {
  formula: Formula
  materials: Material[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    code: formula.code,
    name: formula.name,
    description: formula.description || "",
    yield_m3: formula.yield_m3.toString(),
  })
  const waterMaterial = formula.formula_materials.find((fm) => fm.materials.name.toLowerCase() === "agua")
  const [waterQuantity, setWaterQuantity] = useState(waterMaterial?.quantity.toString() || "0")
  const waterMaterialId = materials.find((m) => m.name.toLowerCase() === "agua")?.id || ""

  const otherFormulaMaterials = formula.formula_materials.filter((fm) => fm.materials.name.toLowerCase() !== "agua")
  const [formulaMaterials, setFormulaMaterials] = useState<FormulaMaterialInput[]>(
    otherFormulaMaterials.map((fm) => ({
      id: fm.id,
      material_id: fm.materials.id,
      quantity: fm.quantity.toString(),
    })),
  )
  const router = useRouter()
  const { toast } = useToast()

  const addMaterial = () => {
    setFormulaMaterials([...formulaMaterials, { material_id: "", quantity: "0" }])
  }

  const removeMaterial = (index: number) => {
    setFormulaMaterials(formulaMaterials.filter((_, i) => i !== index))
  }

  const updateMaterial = (index: number, field: keyof FormulaMaterialInput, value: string) => {
    const updated = [...formulaMaterials]
    updated[index][field] = value as never
    setFormulaMaterials(updated)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (formulaMaterials.length === 0) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Debes agregar al menos un material a la fórmula",
      })
      return
    }

    if (formulaMaterials.some((m) => !m.material_id || Number.parseFloat(m.quantity) <= 0)) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Todos los materiales deben tener un material seleccionado y una cantidad válida",
      })
      return
    }

    setLoading(true)

    try {
      const supabase = createClient()

      // Get current user
      const { data: { user } } = await supabase.auth.getUser()

      // Update formula
      const { error: formulaError } = await supabase
        .from("formulas")
        .update({
          code: formData.code,
          name: formData.name,
          description: formData.description || null,
          yield_m3: Number.parseFloat(formData.yield_m3),
          updated_at: new Date().toISOString(),
          updated_by: user?.email || null,
        })
        .eq("id", formula.id)

      if (formulaError) throw formulaError

      // Delete existing formula materials
      const { error: deleteError } = await supabase.from("formula_materials").delete().eq("formula_id", formula.id)

      if (deleteError) throw deleteError

      const allMaterials = [...formulaMaterials]

      if (waterMaterialId && Number.parseFloat(waterQuantity) > 0) {
        allMaterials.push({
          material_id: waterMaterialId,
          quantity: waterQuantity,
        })
      }

      const { error: materialsError } = await supabase.from("formula_materials").insert(
        allMaterials.map((m) => ({
          formula_id: formula.id,
          material_id: m.material_id,
          quantity: Number.parseFloat(m.quantity),
        })),
      )

      if (materialsError) throw materialsError

      toast({
        title: "Fórmula actualizada",
        description: `${formData.code} se actualizó correctamente`,
      })

      onOpenChange(false)
      router.refresh()
    } catch (error) {
      console.error("Error saving formula:", error)
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : "No se pudo actualizar la fórmula",
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar Fórmula</DialogTitle>
          <DialogDescription>Modifica la fórmula y su composición</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-code">Código</Label>
              <Input
                id="edit-code"
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-yield">Rinde (m³)</Label>
              <Input
                id="edit-yield"
                type="number"
                step="0.001"
                value={formData.yield_m3}
                onChange={(e) => setFormData({ ...formData, yield_m3: e.target.value })}
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-name">Nombre</Label>
            <Input
              id="edit-name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-description">Descripción</Label>
            <Textarea
              id="edit-description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={2}
            />
          </div>

          <div className="space-y-2 p-4 bg-blue-50 dark:bg-blue-950 rounded-lg border border-blue-200 dark:border-blue-800">
            <div className="flex items-center gap-2 mb-2">
              <Droplets className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              <Label htmlFor="water-quantity" className="text-base font-semibold">
                Cantidad de Agua (kg)
              </Label>
            </div>
            <Input
              id="water-quantity"
              type="number"
              step="0.1"
              value={waterQuantity}
              onChange={(e) => setWaterQuantity(e.target.value)}
              placeholder="Ej: 165"
              required
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Composición de Materiales</Label>
              <Button type="button" variant="outline" size="sm" onClick={addMaterial}>
                <Plus className="h-4 w-4 mr-1" />
                Agregar Material
              </Button>
            </div>

            <div className="space-y-2">
              {formulaMaterials.map((fm, index) => (
                <div key={index} className="flex gap-2 items-end">
                  <div className="flex-1 space-y-2">
                    <Label className="text-xs">Material</Label>
                    <Select
                      value={fm.material_id}
                      onValueChange={(value) => updateMaterial(index, "material_id", value)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Seleccionar..." />
                      </SelectTrigger>
                      <SelectContent>
                        {materials
                          .filter((m) => m.name.toLowerCase() !== "agua")
                          .map((material) => (
                            <SelectItem key={material.id} value={material.id}>
                              {material.name} ({material.unit})
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-32 space-y-2">
                    <Label className="text-xs">Cantidad</Label>
                    <Input
                      type="number"
                      step="0.001"
                      value={fm.quantity}
                      onChange={(e) => updateMaterial(index, "quantity", e.target.value)}
                    />
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => removeMaterial(index)}>
                    <X className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Guardando..." : "Guardar Cambios"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
