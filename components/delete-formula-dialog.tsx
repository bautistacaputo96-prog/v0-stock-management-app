"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"
import { AlertTriangle } from "lucide-react"
import { logDeletion } from "@/lib/activity-log"
import { CampoMotivo, motivoValido } from "@/components/motivo"

type Formula = {
  id: string
  code: string
  name: string
}

export function DeleteFormulaDialog({
  formula,
  open,
  onOpenChange,
}: {
  formula: Formula
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [loading, setLoading] = useState(false)
  const [motivo, setMotivo] = useState("") // fase 0c-1
  const router = useRouter()
  const { toast } = useToast()

  const handleDelete = async () => {
    if (!motivoValido(motivo)) return
    setLoading(true)

    try {
      const supabase = createClient()

      // Verificar si la fórmula está en uso (para no perder histórico)
      const [dispRes, schedRes] = await Promise.all([
        supabase.from("dispatches").select("id", { count: "exact", head: true }).eq("formula_id", formula.id),
        supabase.from("scheduled_dispatches").select("id", { count: "exact", head: true }).eq("formula_id", formula.id),
      ])
      const dispCount = dispRes.count || 0
      const schedCount = schedRes.count || 0

      if (dispCount > 0 || schedCount > 0) {
        toast({
          variant: "destructive",
          title: "No se puede eliminar",
          description: `${formula.code} tiene ${dispCount} despacho(s) y ${schedCount} programación(es) asociadas. No se puede borrar para no perder el histórico.`,
        })
        setLoading(false)
        return
      }

      // Copia de la receta para Actividad y el mail (fase 0c-1)
      const { data: receta } = await supabase.from("formula_materials").select("quantity, materials(name, unit)").eq("formula_id", formula.id)

      // Borrar primero los materiales de la fórmula (FK), luego la fórmula
      await supabase.from("formula_materials").delete().eq("formula_id", formula.id)
      const { error } = await supabase.from("formulas").delete().eq("id", formula.id)

      if (error) throw error

      await logDeletion({
        entity: "formula",
        entityId: formula.id,
        reference: formula.code,
        details: {
          "Código": formula.code,
          Nombre: formula.name || "-",
          Materiales: ((receta as any[]) || []).map((r) => `${r.materials?.name || "?"} ${r.quantity} ${r.materials?.unit || ""}`.trim()).join(" · ") || "-",
        },
        motivo: motivo.trim(),
      })

      toast({
        title: "Fórmula eliminada",
        description: `${formula.code} se eliminó correctamente`,
      })

      onOpenChange(false)
      router.refresh()
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : "No se pudo eliminar la fórmula",
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Eliminar Fórmula
          </DialogTitle>
          <DialogDescription>
            ¿Estás seguro que deseas eliminar <strong>{formula.code}</strong>? Esta acción no se puede deshacer.
          </DialogDescription>
        </DialogHeader>
        <CampoMotivo value={motivo} onChange={setMotivo} id="motivo-formula-borrar" ejemplo="Ej: fórmula duplicada, se cargó dos veces" />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={loading || !motivoValido(motivo)}>
            {loading ? "Eliminando..." : "Eliminar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
