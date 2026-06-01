"use client"

import type React from "react"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"

type AddCarrierDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  supplierId: string
  supplierName: string
  onCarrierAdded: (carrierId: string) => void
}

export function AddCarrierDialog({
  open,
  onOpenChange,
  supplierId,
  supplierName,
  onCarrierAdded,
}: AddCarrierDialogProps) {
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    name: "",
    driver_name: "",
    phone: "",
  })
  const router = useRouter()
  const { toast } = useToast()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.name.trim()) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "El nombre del flete es requerido",
      })
      return
    }

    setLoading(true)

    try {
      const supabase = createClient()

      const { data, error } = await supabase
        .from("carriers")
        .insert({
          name: formData.name.trim(),
          driver_name: formData.driver_name.trim() || null,
          phone: formData.phone.trim() || null,
          supplier_id: supplierId,
        })
        .select()
        .single()

      if (error) throw error

      toast({
        title: "Flete agregado",
        description: `${formData.name} fue agregado correctamente`,
      })

      setFormData({ name: "", driver_name: "", phone: "" })
      onOpenChange(false)
      onCarrierAdded(data.id)
      router.refresh()
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error?.message || "No se pudo agregar el flete",
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Agregar Nuevo Flete</DialogTitle>
          <DialogDescription>Agregar un nuevo flete para el proveedor {supplierName}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="carrier-name">
              Nombre del Flete / Transportista <span className="text-red-500">*</span>
            </Label>
            <Input
              id="carrier-name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="Ej: Juan Pérez - Camión 123"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="driver-name">Nombre del Conductor</Label>
            <Input
              id="driver-name"
              value={formData.driver_name}
              onChange={(e) => setFormData({ ...formData, driver_name: e.target.value })}
              placeholder="Opcional"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="carrier-phone">Teléfono</Label>
            <Input
              id="carrier-phone"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              placeholder="Opcional"
            />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Guardando..." : "Agregar Flete"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
