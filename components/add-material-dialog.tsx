"use client"

import type React from "react"

import { useState } from "react"
import { useRouter } from "next/navigation"
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"

export function AddMaterialDialog() {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    name: "",
    unit: "kg",
    min_stock: "0",
  })
  const router = useRouter()
  const { toast } = useToast()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const supabase = createClient()
      const { error } = await supabase.from("materials").insert({
        name: formData.name,
        unit: formData.unit,
        min_stock: Number.parseFloat(formData.min_stock),
        current_stock: 0,
      })

      if (error) throw error

      toast({
        title: "Material agregado",
        description: `${formData.name} se agregó correctamente`,
      })

      setFormData({ name: "", unit: "kg", min_stock: "0" })
      setOpen(false)
      router.refresh()
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : "No se pudo agregar el material",
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Agregar Material
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Agregar Material</DialogTitle>
          <DialogDescription>Registra un nuevo material para el acopio</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Nombre del Material</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="Ej: Cemento, Arena, Grava"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="unit">Unidad de Medida</Label>
            <Select value={formData.unit} onValueChange={(value) => setFormData({ ...formData, unit: value })}>
              <SelectTrigger id="unit">
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
            <Label htmlFor="min_stock">Stock Mínimo</Label>
            <Input
              id="min_stock"
              type="number"
              step="0.01"
              value={formData.min_stock}
              onChange={(e) => setFormData({ ...formData, min_stock: e.target.value })}
              required
            />
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
