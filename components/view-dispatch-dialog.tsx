"use client"

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { CheckCircle2, XCircle } from "lucide-react"

type DispatchData = {
  id: string
  dispatch_date: string
  remito: string
  quantity_m3: number
  notes: string | null
  extra_water_liters: number | null
  sand_stockpile_humidity: number | null
  sample_taken: boolean | null
  sample_number: string | null
  actual_slump_cm: number | null
  clients: {
    id: string
    name: string
  } | null
  construction_sites: {
    id: string
    name: string
  } | null
  mixers: {
    id: string
    license_plate: string
    brand: string | null
  } | null
  formulas: {
    id: string
    code: string
    name: string
    yield_m3: number
    formula_materials: Array<{
      id: string
      quantity: number
      materials: {
        id: string
        name: string
        unit: string
      }
    }>
  }
}

export function ViewDispatchDialog({
  dispatch,
  open,
  onOpenChange,
}: {
  dispatch: DispatchData
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  // Calculate materials used
  const materialsUsed = dispatch.formulas.formula_materials.map((fm) => ({
    name: fm.materials.name,
    unit: fm.materials.unit,
    quantity: (fm.quantity * dispatch.quantity_m3) / dispatch.formulas.yield_m3,
  }))

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const year = date.getUTCFullYear()
    const month = String(date.getUTCMonth() + 1).padStart(2, "0")
    const day = String(date.getUTCDate()).padStart(2, "0")
    return `${day}/${month}/${year}`
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Detalle del Despacho</DialogTitle>
          <DialogDescription>
            Remito: <Badge variant="outline">{dispatch.remito}</Badge>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 bg-muted/50 rounded-lg">
              <p className="text-xs text-muted-foreground mb-1">Fecha</p>
              <p className="font-medium text-sm">{formatDate(dispatch.dispatch_date)}</p>
            </div>
            <div className="p-3 bg-muted/50 rounded-lg">
              <p className="text-xs text-muted-foreground mb-1">Cantidad</p>
              <p className="font-medium text-sm">{dispatch.quantity_m3} m³</p>
            </div>
            <div className="p-3 bg-muted/50 rounded-lg">
              <p className="text-xs text-muted-foreground mb-1">Fórmula</p>
              <p className="font-medium text-sm">{dispatch.formulas.code}</p>
            </div>
          </div>

          <Separator />

          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-muted-foreground mb-1">Cliente</p>
              <p className="font-medium">{dispatch.clients?.name || "-"}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">Obra</p>
              <p className="font-medium">{dispatch.construction_sites?.name || "-"}</p>
            </div>
          </div>

          {dispatch.mixers && (
            <div>
              <p className="text-sm text-muted-foreground mb-1">Camión Mixer</p>
              <p className="font-medium">
                {dispatch.mixers.license_plate}
                {dispatch.mixers.brand && <span className="text-muted-foreground ml-2">({dispatch.mixers.brand})</span>}
              </p>
            </div>
          )}

          <Separator />

          <div className="space-y-3">
            <h4 className="text-sm font-semibold">Parámetros Adicionales</h4>
            <div className="grid grid-cols-2 gap-3">
              {dispatch.sand_stockpile_humidity !== null && (
                <div className="p-2 bg-muted/30 rounded">
                  <p className="text-xs text-muted-foreground">Humedad Acopio Arena</p>
                  <p className="text-sm font-medium">{dispatch.sand_stockpile_humidity}%</p>
                </div>
              )}
              {dispatch.extra_water_liters !== null && (
                <div className="p-2 bg-muted/30 rounded">
                  <p className="text-xs text-muted-foreground">Agua Extra en Planta</p>
                  <p className="text-sm font-medium">{dispatch.extra_water_liters} L</p>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-semibold">Muestreo</h4>
            <div className="p-3 bg-muted/30 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                {dispatch.sample_taken ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <span className="text-sm font-medium">Se tomó muestra</span>
                  </>
                ) : (
                  <>
                    <XCircle className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">No se tomó muestra</span>
                  </>
                )}
              </div>
              {dispatch.sample_taken && (
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Número de Muestra</p>
                    <p className="text-sm font-medium">{dispatch.sample_number || "-"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Asentamiento Real</p>
                    <p className="text-sm font-medium">
                      {dispatch.actual_slump_cm ? `${dispatch.actual_slump_cm} cm` : "-"}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <Separator />

          <div>
            <p className="text-sm font-semibold mb-2">Materiales Utilizados</p>
            <div className="grid grid-cols-2 gap-2">
              {materialsUsed.map((material, index) => (
                <div key={index} className="flex justify-between items-center p-2 bg-muted/40 rounded text-sm">
                  <span className="truncate">{material.name}</span>
                  <span className="font-medium ml-2 whitespace-nowrap">
                    {material.quantity.toFixed(2)} {material.unit}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {dispatch.notes && (
            <>
              <Separator />
              <div>
                <p className="text-sm text-muted-foreground mb-1">Observaciones</p>
                <p className="text-sm">{dispatch.notes}</p>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
