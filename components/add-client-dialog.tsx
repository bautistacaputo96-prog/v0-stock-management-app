"use client"

import type React from "react"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"
import { Plus } from "lucide-react"

interface AddClientDialogProps {
  plantId: string
  trigger?: React.ReactNode
  onClientAdded?: (client: { id: string; name: string }) => void
}

export function AddClientDialog({ plantId, trigger, onClientAdded }: AddClientDialogProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    name: "",
    contact: "",
    phone: "",
    email: "",
  })

  const supabase = createClient()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    console.log("[v0] AddClientDialog handleSubmit called", { formData, plantId })

    if (!formData.name.trim()) {
      toast.error("El nombre del cliente es obligatorio")
      return
    }

    if (!plantId || plantId === "all" || plantId === "") {
      toast.error("Primero seleccione una planta en el formulario de programacion")
      return
    }

    setLoading(true)

    try {
      console.log("[v0] Inserting client:", { name: formData.name, plant_id: plantId })
      const { data, error } = await supabase
        .from("clients")
        .insert({
          name: formData.name,
          contact: formData.contact || null,
          phone: formData.phone || null,
          email: formData.email || null,
          plant_id: plantId,
        })
        .select()
        .single()

      console.log("[v0] Insert result:", { data, error })
      if (error) throw error

      toast.success("Cliente agregado exitosamente")
      setFormData({ name: "", contact: "", phone: "", email: "" })
      setOpen(false)

      if (onClientAdded && data) {
        onClientAdded({ id: data.id, name: data.name })
      }
    } catch (error: any) {
      toast.error(error.message || "Error al agregar cliente")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            <Plus className="h-4 w-4 mr-2" />
            Agregar Cliente
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Agregar Nuevo Cliente</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Nombre *</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="Nombre del cliente"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contact">Contacto</Label>
            <Input
              id="contact"
              value={formData.contact}
              onChange={(e) => setFormData({ ...formData, contact: e.target.value })}
              placeholder="Nombre del contacto"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">Teléfono</Label>
            <Input
              id="phone"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              placeholder="Teléfono"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              placeholder="correo@ejemplo.com"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Guardando..." : "Guardar Cliente"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
