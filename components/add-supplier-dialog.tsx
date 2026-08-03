"use client"

import type React from "react"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"

type Material = {
  id: string
  name: string
  unit: string
}

type Plant = {
  id: string
  name: string
}

type AddSupplierDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  materials: Material[]
  selectedMaterialId?: string
  onSupplierAdded: (supplierId: string) => void
  plantId: string
  plants?: Plant[]
}

export function AddSupplierDialog({
  open,
  onOpenChange,
  materials,
  selectedMaterialId,
  onSupplierAdded,
  plantId,
  plants = [],
}: AddSupplierDialogProps) {
  const [loading, setLoading] = useState(false)
  const [plantMode, setPlantMode] = useState<string>(plantId)
  const [formData, setFormData] = useState({
    name: "",
    contact: "",
    phone: "",
    materialIds: selectedMaterialId ? [selectedMaterialId] : [],
  })
  const { toast } = useToast()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.name || formData.materialIds.length === 0) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Debes ingresar el nombre del proveedor y seleccionar al menos un material",
      })
      return
    }

    setLoading(true)

    try {
      const supabase = createClient()

      // Determine which plants to create the supplier for
      const targetPlantIds = plantMode === "ambas"
        ? plants.map((p) => p.id)
        : [plantMode || plantId]

      const selectedMaterialNames = materials
        .filter((m) => formData.materialIds.includes(m.id))
        .map((m) => m.name)

      let returnedSupplierId = ""

      for (const pid of targetPlantIds) {
        // Create supplier for this plant
        const { data: supplier, error: supplierError } = await supabase
          .from("suppliers")
          .insert({
            name: formData.name,
            contact: formData.contact || null,
            phone: formData.phone || null,
            plant_id: pid,
          })
          .select()
          .single()

        if (supplierError) throw supplierError

        // Get material IDs for this specific plant
        let matIds = formData.materialIds
        if (pid !== plantId) {
          // Fetch equivalent materials from the other plant by name
          const { data: plantMats } = await supabase
            .from("materials")
            .select("id, name")
            .eq("plant_id", pid)
            .in("name", selectedMaterialNames)
          matIds = plantMats?.map((m: any) => m.id) || []
        }

        // Create material-supplier links
        if (matIds.length > 0) {
          const materialSuppliers = matIds.map((materialId) => ({
            supplier_id: supplier.id,
            material_id: materialId,
          }))
          const { error: relationError } = await supabase.from("material_suppliers").insert(materialSuppliers)
          if (relationError) throw relationError
        }

        // Return the supplier ID for the current plant
        if (pid === plantId || !returnedSupplierId) {
          returnedSupplierId = supplier.id
        }
      }

      const plantLabel = plantMode === "ambas" ? "ambas plantas" : plants.find((p) => p.id === plantMode)?.name || "la planta"

      toast({
        title: "Proveedor agregado",
        description: `${formData.name} fue agregado para ${plantLabel}`,
      })

      setFormData({
        name: "",
        contact: "",
        phone: "",
        materialIds: selectedMaterialId ? [selectedMaterialId] : [],
      })
      setPlantMode(plantId)
      onSupplierAdded(returnedSupplierId)
      onOpenChange(false)
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : "No se pudo agregar el proveedor",
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Agregar Proveedor</DialogTitle>
          <DialogDescription>Registra un nuevo proveedor y los materiales que suministra</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="supplier-name">
              Nombre del Proveedor <span className="text-red-500">*</span>
            </Label>
            <Input
              id="supplier-name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="Ej: LOMA NEGRA"
              required
            />
          </div>

          {plants.length > 1 && (
            <div className="space-y-2">
              <Label>Planta</Label>
              <Select value={plantMode} onValueChange={setPlantMode}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {plants.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                  <SelectItem value="ambas">Ambas plantas</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="supplier-materials">
              Materiales que suministra <span className="text-red-500">*</span>
            </Label>
            <Select
              value={formData.materialIds[0] || ""}
              onValueChange={(value) => {
                const currentIds = formData.materialIds
                if (currentIds.includes(value)) {
                  setFormData({ ...formData, materialIds: currentIds.filter((id) => id !== value) })
                } else {
                  setFormData({ ...formData, materialIds: [...currentIds, value] })
                }
              }}
            >
              <SelectTrigger id="supplier-materials">
                <SelectValue placeholder="Seleccionar material..." />
              </SelectTrigger>
              <SelectContent>
                {materials.map((material) => (
                  <SelectItem key={material.id} value={material.id}>
                    {material.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {formData.materialIds.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {formData.materialIds.map((id) => {
                  const material = materials.find((m) => m.id === id)
                  return (
                    <div key={id} className="bg-muted px-2 py-1 rounded-md text-sm flex items-center gap-2">
                      {material?.name}
                      <button
                        type="button"
                        onClick={() =>
                          setFormData({ ...formData, materialIds: formData.materialIds.filter((mid) => mid !== id) })
                        }
                        className="text-muted-foreground hover:text-foreground"
                      >
                        ×
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="supplier-contact">Contacto</Label>
            <Input
              id="supplier-contact"
              value={formData.contact}
              onChange={(e) => setFormData({ ...formData, contact: e.target.value })}
              placeholder="Nombre de contacto (opcional)"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="supplier-phone">Teléfono</Label>
            <Input
              id="supplier-phone"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              placeholder="Número de teléfono (opcional)"
            />
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Guardando..." : "Agregar Proveedor"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
