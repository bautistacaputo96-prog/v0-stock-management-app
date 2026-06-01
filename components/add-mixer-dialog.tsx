"use client"

import type React from "react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"

type Mixer = {
  id: string
  license_plate: string
  brand: string
  capacity_m3?: number
}

interface AddMixerDialogProps {
  plantId: string
  trigger?: React.ReactNode
  onMixerAdded?: (mixer: Mixer) => void
}

export function AddMixerDialog({ plantId, trigger, onMixerAdded }: AddMixerDialogProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    license_plate: "",
    brand: "",
    capacity_m3: "8",
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const supabase = createClient()

      const { data, error } = await supabase
        .from("mixers")
        .insert({
          license_plate: formData.license_plate,
          brand: formData.brand || null,
          plant_id: plantId,
          capacity_m3: parseFloat(formData.capacity_m3) || 8,
        })
        .select()
        .single()

      if (error) throw error

      toast.success("Mixer agregado exitosamente")
      setOpen(false)
      setFormData({ license_plate: "", brand: "", capacity_m3: "8" })

      if (onMixerAdded) {
        onMixerAdded({ ...data, capacity_m3: data.capacity_m3 })
      }
    } catch (error: any) {
      console.error("Error creating mixer:", error)
      if (error.code === "23505") {
        toast.error("Este mixer ya está registrado")
      } else {
        toast.error("Error al agregar el mixer")
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? (
        <DialogTrigger asChild>{trigger}</DialogTrigger>
      ) : (
        <DialogTrigger asChild>
          <Button variant="outline">Agregar Mixer</Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Agregar Nuevo Mixer</DialogTitle>
            <DialogDescription>Complete los datos del camión mixer</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="license_plate">Patente *</Label>
              <Input
                id="license_plate"
                placeholder="AB123CD"
                value={formData.license_plate}
                onChange={(e) => setFormData({ ...formData, license_plate: e.target.value.toUpperCase() })}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="brand">Marca</Label>
                <Input
                  id="brand"
                  placeholder="Mercedes-Benz, Iveco, etc."
                  value={formData.brand}
                  onChange={(e) => setFormData({ ...formData, brand: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="capacity">Capacidad (m3)</Label>
                <Input
                  id="capacity"
                  type="number"
                  step="0.5"
                  placeholder="8"
                  value={formData.capacity_m3}
                  onChange={(e) => setFormData({ ...formData, capacity_m3: e.target.value })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={loading}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
