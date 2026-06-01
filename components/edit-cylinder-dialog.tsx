"use client"

import type React from "react"

import { useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"

interface EditCylinderDialogProps {
  cylinder: {
    id: string
    actual_test_date: string | null
    dial_reading: number | null
    strength_mpa: number | null
    comments: string | null
  }
  onClose: () => void
  onUpdate: () => void
}

export function EditCylinderDialog({ cylinder, onClose, onUpdate }: EditCylinderDialogProps) {
  const [formData, setFormData] = useState({
    actual_test_date: cylinder.actual_test_date || "",
    dial_reading: cylinder.dial_reading?.toString() || "",
    strength_mpa: cylinder.strength_mpa?.toString() || "",
    comments: cylinder.comments || "",
  })
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)

    const supabase = createClient()

    const updateData: any = {
      actual_test_date: formData.actual_test_date || null,
      dial_reading: formData.dial_reading ? Number.parseFloat(formData.dial_reading) : null,
      strength_mpa: formData.strength_mpa ? Number.parseFloat(formData.strength_mpa) : null,
      comments: formData.comments || null,
      updated_at: new Date().toISOString(),
    }

    const { error } = await supabase.from("test_cylinders").update(updateData).eq("id", cylinder.id)

    setSaving(false)

    if (error) {
      toast.error("Error al actualizar probeta")
      console.error(error)
      return
    }

    toast.success("Probeta actualizada correctamente")
    onUpdate()
    onClose()
  }

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Editar Resultados de Probeta</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="actual_test_date">Fecha Real de Rotura</Label>
            <Input
              id="actual_test_date"
              type="date"
              value={formData.actual_test_date}
              onChange={(e) => setFormData({ ...formData, actual_test_date: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="dial_reading">Lectura del Dial</Label>
            <Input
              id="dial_reading"
              type="number"
              step="0.01"
              placeholder="Ej: 245.50"
              value={formData.dial_reading}
              onChange={(e) => setFormData({ ...formData, dial_reading: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="strength_mpa">Resistencia (MPa)</Label>
            <Input
              id="strength_mpa"
              type="number"
              step="0.01"
              placeholder="Ej: 28.5"
              value={formData.strength_mpa}
              onChange={(e) => setFormData({ ...formData, strength_mpa: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Más adelante calcularemos esto automáticamente desde la lectura del dial
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="comments">Comentarios</Label>
            <Textarea
              id="comments"
              placeholder="Observaciones sobre la probeta..."
              value={formData.comments}
              onChange={(e) => setFormData({ ...formData, comments: e.target.value })}
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Guardando..." : "Guardar Cambios"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
