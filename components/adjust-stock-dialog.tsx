"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"
import { ArrowRight } from "lucide-react"

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

export function AdjustStockDialog({
  material,
  open,
  onOpenChange,
  onSuccess,
}: {
  material: Material | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [countedStock, setCountedStock] = useState("")
  const [notes, setNotes] = useState("")
  const { toast } = useToast()

  useEffect(() => {
    if (material) {
      setCountedStock(material.current_stock?.toString() ?? "")
      setNotes("")
    }
  }, [material, open])

  if (!material) return null

  const currentStock = material.current_stock || 0
  const newStock = Number.parseFloat(countedStock)
  const difference = !Number.isNaN(newStock) ? newStock - currentStock : 0

  const formatValue = (value: number) =>
    Math.abs(value) >= 1000 ? `${(value / 1000).toFixed(2)} t` : `${Math.round(value)} ${material.unit}`

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (Number.isNaN(newStock)) return
    setLoading(true)

    try {
      const supabase = createClient()
      const humidity = material.stockpile_humidity ?? 0
      const dryStock = material.requires_humidity_control ? newStock / (1 + humidity / 100) : newStock

      const { error: updateError } = await supabase
        .from("materials")
        .update({
          current_stock: newStock,
          dry_stock: dryStock,
          updated_at: new Date().toISOString(),
        })
        .eq("id", material.id)

      if (updateError) throw updateError

      // Registrar el ajuste como movimiento para trazabilidad
      const { error: movementError } = await supabase.from("stock_movements").insert({
        material_id: material.id,
        quantity_kg: difference,
        movement_type: "ajuste",
        movement_date: new Date().toISOString().substring(0, 10),
        reference_type: "recuento",
        notes: notes || `Ajuste por recuento. Anterior: ${Math.round(currentStock)} ${material.unit}, Nuevo: ${Math.round(newStock)} ${material.unit}`,
      })

      if (movementError) throw movementError

      toast({
        title: "Stock ajustado",
        description: `${material.name} se actualizó a ${formatValue(newStock)}`,
      })

      onOpenChange(false)
      onSuccess?.()
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : "No se pudo ajustar el stock",
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ajustar Stock - {material.name}</DialogTitle>
          <DialogDescription>
            Corrige el nivel actual de materia prima según el recuento físico
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <p className="text-xs text-muted-foreground">Stock actual en sistema</p>
            <p className="text-lg font-semibold text-foreground">{formatValue(currentStock)}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="counted-stock">Stock según recuento ({material.unit})</Label>
            <Input
              id="counted-stock"
              type="number"
              step="0.01"
              min="0"
              value={countedStock}
              onChange={(e) => setCountedStock(e.target.value)}
              required
              autoFocus
            />
          </div>

          {!Number.isNaN(newStock) && difference !== 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-border p-3 text-sm">
              <span className="text-muted-foreground">{formatValue(currentStock)}</span>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium text-foreground">{formatValue(newStock)}</span>
              <span
                className={`ml-auto font-semibold ${difference >= 0 ? "text-green-600" : "text-red-600"}`}
              >
                {difference >= 0 ? "+" : "-"}
                {formatValue(Math.abs(difference))}
              </span>
            </div>
          )}

          {material.requires_humidity_control && (
            <p className="text-xs text-muted-foreground">
              El stock seco se recalculará con la humedad de acopio actual ({material.stockpile_humidity ?? 0}%).
            </p>
          )}

          <div className="space-y-2">
            <Label htmlFor="adjust-notes">Observaciones (opcional)</Label>
            <Textarea
              id="adjust-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Motivo del ajuste, responsable del recuento, etc."
              rows={2}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading || Number.isNaN(newStock)}>
              {loading ? "Guardando..." : "Guardar Ajuste"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
