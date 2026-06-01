"use client"

import type React from "react"

import { useState } from "react"
import { useRouter } from "next/navigation"
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
  current_stock: number
  min_stock: number
  dry_stock?: number
  stockpile_humidity?: number
  requires_humidity_control?: boolean
}

export function EditMaterialDialog({
  material,
  open,
  onOpenChange,
}: {
  material: Material
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    name: material.name,
    unit: material.unit,
    current_stock: material.current_stock.toString(),
    dry_stock: (material.dry_stock ?? material.current_stock).toString(),
    min_stock: material.min_stock.toString(),
    stockpile_humidity: (material.stockpile_humidity ?? 0).toString(),
  })

  const requiresHumidity = material.requires_humidity_control
  const router = useRouter()
  const { toast } = useToast()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const supabase = createClient()
      const currentStock = Number.parseFloat(formData.current_stock)
      const humidity = Number.parseFloat(formData.stockpile_humidity) || 0
      // Calcular dry_stock a partir del stock actual y humedad de acopio
      const dryStock = requiresHumidity ? currentStock / (1 + humidity / 100) : currentStock
      
      const { error } = await supabase
        .from("materials")
        .update({
          name: formData.name,
          unit: formData.unit,
          current_stock: currentStock,
          dry_stock: dryStock,
          min_stock: Number.parseFloat(formData.min_stock),
          stockpile_humidity: humidity,
          updated_at: new Date().toISOString(),
        })
        .eq("id", material.id)

      if (error) throw error

      toast({
        title: "Material actualizado",
        description: `${formData.name} se actualizó correctamente`,
      })

      onOpenChange(false)
      router.refresh()
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : "No se pudo actualizar el material",
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar Material</DialogTitle>
          <DialogDescription>Modifica los datos del material</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-name">Nombre del Material</Label>
            <Input
              id="edit-name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-unit">Unidad de Medida</Label>
            <Select value={formData.unit} onValueChange={(value) => setFormData({ ...formData, unit: value })}>
              <SelectTrigger id="edit-unit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="kg">Kilogramos (kg)</SelectItem>
                <SelectItem value="L">Litros (L)</SelectItem>
                <SelectItem value="m3">Metros cúbicos (m³)</SelectItem>
                <SelectItem value="tn">Toneladas (tn)</SelectItem>
                <SelectItem value="unidad">Unidad</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-current-stock">Stock Actual ({material.unit})</Label>
            <Input
              id="edit-current-stock"
              type="number"
              step="0.01"
              value={formData.current_stock}
              onChange={(e) => setFormData({ ...formData, current_stock: e.target.value, dry_stock: e.target.value })}
              required
            />
          </div>
          {requiresHumidity && (
            <div className="space-y-2">
              <Label htmlFor="edit-humidity">Humedad de Acopio (%)</Label>
              <Input
                id="edit-humidity"
                type="number"
                step="0.1"
                min="0"
                max="20"
                value={formData.stockpile_humidity}
                onChange={(e) => setFormData({ ...formData, stockpile_humidity: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Este valor se usa internamente para calcular el descuento en despachos
              </p>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="edit-min-stock">Stock Minimo</Label>
            <Input
              id="edit-min-stock"
              type="number"
              step="0.01"
              value={formData.min_stock}
              onChange={(e) => setFormData({ ...formData, min_stock: e.target.value })}
              required
            />
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
