"use client"

import type React from "react"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"
import { logActivity } from "@/lib/activity-log"
import { Plus } from "lucide-react"
import { ObraUbicacion, type UbicacionObra } from "@/components/obra-ubicacion"

interface AddConstructionSiteDialogProps {
  clientId: string
  trigger?: React.ReactNode
  onSiteAdded?: (site: { id: string; name: string; address: string | null; client_id: string; travel_time_minutes: number; unload_time_minutes: number; requires_pump: boolean; reception_hours_start: string | null; reception_hours_end: string | null }) => void
}

export function AddConstructionSiteDialog({ clientId, trigger, onSiteAdded }: AddConstructionSiteDialogProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    name: "",
    address: "",
    localidad: "",
    travel_time_minutes: "30",
    unload_time_minutes: "20",
  })
  const UBIC_VACIA: UbicacionObra = { lat: null, lng: null, fuente: null, km: null, minutos: null }
  const [ubic, setUbic] = useState<UbicacionObra>(UBIC_VACIA)
  const [plantaCliente, setPlantaCliente] = useState<string | null>(null)

  const supabase = createClient()

  // La planta del cliente define desde dónde se calcula el viaje
  const cargarPlanta = async () => {
    if (!clientId) return
    const { data } = await supabase.from("clients").select("plant_id").eq("id", clientId).maybeSingle()
    setPlantaCliente(data?.plant_id || null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.name.trim()) {
      toast.error("El nombre de la obra es obligatorio")
      return
    }

    setLoading(true)

    try {
      const { data, error } = await supabase
        .from("construction_sites")
        .insert({
          name: formData.name,
          address: formData.address || null,
          localidad: formData.localidad || null,
          client_id: clientId,
          gps_lat: ubic.lat,
          gps_lng: ubic.lng,
          gps_source: ubic.fuente,
          travel_distance_km: ubic.km,
          gps_updated_at: ubic.lat != null ? new Date().toISOString() : null,
          travel_time_minutes: parseInt(formData.travel_time_minutes) || 30,
          unload_time_minutes: parseInt(formData.unload_time_minutes) || 20,
        })
        .select()
        .single()

      if (error) throw error

      toast.success("Obra agregada exitosamente")
      logActivity({ action: "crear", entity: "obra", entityId: data?.id, reference: data?.name, details: { Obra: formData.name, "Dirección": formData.address || "-", Localidad: formData.localidad || "-", "Viaje (min)": parseInt(formData.travel_time_minutes) || 30 } })
      setFormData({ name: "", address: "", localidad: "", travel_time_minutes: "30", unload_time_minutes: "20" })
      setUbic(UBIC_VACIA)
      setOpen(false)

      if (onSiteAdded && data) {
        onSiteAdded({
          id: data.id,
          name: data.name,
          address: data.address,
          client_id: data.client_id,
          travel_time_minutes: data.travel_time_minutes,
          unload_time_minutes: data.unload_time_minutes,
          requires_pump: data.requires_pump || false,
          reception_hours_start: data.reception_hours_start,
          reception_hours_end: data.reception_hours_end,
        })
      }
    } catch (error: any) {
      toast.error(error.message || "Error al agregar obra")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) cargarPlanta() }}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            <Plus className="h-4 w-4 mr-2" />
            Agregar Obra
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Agregar Nueva Obra</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Nombre *</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="Nombre de la obra"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="address">Direccion</Label>
            <Textarea
              id="address"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              placeholder="Calle y número, o barrio y lote"
              rows={2}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="localidad">Localidad</Label>
            <Input
              id="localidad"
              value={formData.localidad}
              onChange={(e) => setFormData({ ...formData, localidad: e.target.value })}
              placeholder="Ej: San Vicente"
            />
          </div>
          <div className="space-y-2">
            <Label>Ubicación en el mapa</Label>
            <ObraUbicacion
              direccion={formData.address}
              localidad={formData.localidad}
              plantaId={plantaCliente}
              valor={ubic}
              onChange={setUbic}
              onTiempoViaje={(min) => setFormData((f) => ({ ...f, travel_time_minutes: String(min) }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="travel_time">Tiempo de viaje (min)</Label>
              <Input
                id="travel_time"
                type="number"
                value={formData.travel_time_minutes}
                onChange={(e) => setFormData({ ...formData, travel_time_minutes: e.target.value })}
                placeholder="30"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="unload_time">Tiempo de descarga (min)</Label>
              <Input
                id="unload_time"
                type="number"
                value={formData.unload_time_minutes}
                onChange={(e) => setFormData({ ...formData, unload_time_minutes: e.target.value })}
                placeholder="20"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Guardando..." : "Guardar Obra"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
