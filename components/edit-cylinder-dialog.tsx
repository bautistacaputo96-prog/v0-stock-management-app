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
    dispatch_id: string | null
    cylinder_number: number | null
    test_age_days: number | null
    scheduled_test_date: string | null
    actual_test_date: string | null
    dial_reading: number | null
    strength_mpa: number | null
    weight_grams: number | null
    comments: string | null
    dispatch: {
      remito: string | null
      sample_number: string | null
      actual_slump_cm: number | null
      extra_water_liters: number | null
    } | null
  }
  onClose: () => void
  onUpdate: () => void
}

export function EditCylinderDialog({ cylinder, onClose, onUpdate }: EditCylinderDialogProps) {
  const [formData, setFormData] = useState({
    // Datos propios de la probeta
    cylinder_number: cylinder.cylinder_number?.toString() || "",
    test_age_days: cylinder.test_age_days?.toString() || "",
    scheduled_test_date: cylinder.scheduled_test_date || "",
    actual_test_date: cylinder.actual_test_date || "",
    dial_reading: cylinder.dial_reading?.toString() || "",
    strength_mpa: cylinder.strength_mpa?.toString() || "",
    weight_grams: cylinder.weight_grams?.toString() || "",
    comments: cylinder.comments || "",
    // Datos del despacho asociado (se sincronizan con la tabla dispatches)
    sample_number: cylinder.dispatch?.sample_number || "",
    remito: cylinder.dispatch?.remito || "",
    actual_slump_cm: cylinder.dispatch?.actual_slump_cm?.toString() || "",
    extra_water_liters: cylinder.dispatch?.extra_water_liters?.toString() || "",
  })
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)

    const supabase = createClient()

    // 1) Actualizar los datos propios de la probeta
    const cylinderUpdate: any = {
      cylinder_number: formData.cylinder_number ? Number.parseInt(formData.cylinder_number) : null,
      test_age_days: formData.test_age_days ? Number.parseInt(formData.test_age_days) : null,
      scheduled_test_date: formData.scheduled_test_date || null,
      actual_test_date: formData.actual_test_date || null,
      dial_reading: formData.dial_reading ? Number.parseFloat(formData.dial_reading) : null,
      strength_mpa: formData.strength_mpa ? Number.parseFloat(formData.strength_mpa) : null,
      weight_grams: formData.weight_grams ? Number.parseFloat(formData.weight_grams) : null,
      comments: formData.comments || null,
      updated_at: new Date().toISOString(),
    }

    const { data: cylData, error: cylError } = await supabase
      .from("test_cylinders")
      .update(cylinderUpdate)
      .eq("id", cylinder.id)
      .select()

    if (cylError) {
      console.log("[v0] Error updating cylinder:", cylError.message, cylError.details, cylError.hint, cylError.code)
      toast.error(cylError.message || "Error al actualizar la probeta")
      setSaving(false)
      return
    }

    if (!cylData || cylData.length === 0) {
      console.log("[v0] No cylinder row updated for id:", cylinder.id)
      toast.error("No se encontro la probeta para actualizar")
      setSaving(false)
      return
    }

    // 2) Si la probeta tiene un despacho asociado, sincronizar los campos compartidos
    if (cylinder.dispatch_id) {
      const dispatchUpdate: any = {
        sample_number: formData.sample_number || null,
        remito: formData.remito || null,
        actual_slump_cm: formData.actual_slump_cm ? Number.parseFloat(formData.actual_slump_cm) : null,
        extra_water_liters: formData.extra_water_liters ? Number.parseFloat(formData.extra_water_liters) : null,
      }

      const { error: dispError } = await supabase
        .from("dispatches")
        .update(dispatchUpdate)
        .eq("id", cylinder.dispatch_id)

      if (dispError) {
        console.log("[v0] Error updating linked dispatch:", dispError.message, dispError.details, dispError.hint)
        toast.error("La probeta se guardo, pero no se pudieron sincronizar los datos del despacho")
        setSaving(false)
        onUpdate()
        return
      }
    }

    setSaving(false)
    toast.success("Probeta actualizada correctamente")
    onUpdate()
    onClose()
  }

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar Probeta</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Datos del despacho / extraccion */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-muted-foreground">Datos de extracción (despacho)</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="remito">Remito</Label>
                <Input
                  id="remito"
                  value={formData.remito}
                  onChange={(e) => setFormData({ ...formData, remito: e.target.value })}
                  disabled={!cylinder.dispatch_id}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="sample_number">N° de Probeta / Muestra</Label>
                <Input
                  id="sample_number"
                  value={formData.sample_number}
                  onChange={(e) => setFormData({ ...formData, sample_number: e.target.value })}
                  disabled={!cylinder.dispatch_id}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="actual_slump_cm">Asentamiento real (cm)</Label>
                <Input
                  id="actual_slump_cm"
                  type="number"
                  step="0.5"
                  placeholder="Ej: 10"
                  value={formData.actual_slump_cm}
                  onChange={(e) => setFormData({ ...formData, actual_slump_cm: e.target.value })}
                  disabled={!cylinder.dispatch_id}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="extra_water_liters">Agua extra (L)</Label>
                <Input
                  id="extra_water_liters"
                  type="number"
                  step="0.1"
                  placeholder="Ej: 5"
                  value={formData.extra_water_liters}
                  onChange={(e) => setFormData({ ...formData, extra_water_liters: e.target.value })}
                  disabled={!cylinder.dispatch_id}
                />
              </div>
            </div>
            {!cylinder.dispatch_id && (
              <p className="text-xs text-muted-foreground">
                Esta probeta no tiene un despacho asociado, por lo que estos campos no se pueden editar.
              </p>
            )}
          </div>

          {/* Datos propios de la probeta */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-muted-foreground">Datos de la probeta</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cylinder_number">N° de Cilindro</Label>
                <Input
                  id="cylinder_number"
                  type="number"
                  value={formData.cylinder_number}
                  onChange={(e) => setFormData({ ...formData, cylinder_number: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="test_age_days">Edad de ensayo (días)</Label>
                <Input
                  id="test_age_days"
                  type="number"
                  value={formData.test_age_days}
                  onChange={(e) => setFormData({ ...formData, test_age_days: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="scheduled_test_date">Fecha programada de rotura</Label>
                <Input
                  id="scheduled_test_date"
                  type="date"
                  value={formData.scheduled_test_date}
                  onChange={(e) => setFormData({ ...formData, scheduled_test_date: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="actual_test_date">Fecha real de rotura</Label>
                <Input
                  id="actual_test_date"
                  type="date"
                  value={formData.actual_test_date}
                  onChange={(e) => setFormData({ ...formData, actual_test_date: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="weight_grams">Peso (g)</Label>
                <Input
                  id="weight_grams"
                  type="number"
                  step="0.1"
                  placeholder="Ej: 12500"
                  value={formData.weight_grams}
                  onChange={(e) => setFormData({ ...formData, weight_grams: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="dial_reading">Lectura del dial</Label>
                <Input
                  id="dial_reading"
                  type="number"
                  step="0.01"
                  placeholder="Ej: 245.50"
                  value={formData.dial_reading}
                  onChange={(e) => setFormData({ ...formData, dial_reading: e.target.value })}
                />
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="strength_mpa">Resistencia (MPa)</Label>
                <Input
                  id="strength_mpa"
                  type="number"
                  step="0.01"
                  placeholder="Ej: 28.5"
                  value={formData.strength_mpa}
                  onChange={(e) => setFormData({ ...formData, strength_mpa: e.target.value })}
                />
              </div>
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
