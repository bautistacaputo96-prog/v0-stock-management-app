"use client"

import type React from "react"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { Plus } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { BuscarZomatik } from "@/components/zomatik/buscar-zomatik"
import { ConflictoAlta, pedirAlta, type RespuestaAlta } from "@/components/clientes/alta-conflicto"
import { usePermisos } from "@/lib/current-user"
import { documentoValido } from "@/lib/clientes-buscar"

interface AddClientDialogProps {
  plantId: string
  trigger?: React.ReactNode
  onClientAdded?: (client: { id: string; name: string }) => void
}

const VACIO = { name: "", razon_social: "", cuit: "", cond_iva: "Responsable Inscripto", contact: "", phone: "", email: "", remito_tipo: "" }

/**
 * Alta rápida de cliente (pedido y despacho manual). Regla de Bautista del 21/10/2026: no dar de alta el mismo
 * cliente con otro nombre. Pide CUIT válido (con dígito verificador; no DNI), salvo excepción de un gerencial con
 * motivo, y el servidor controla en Rebucret y en Zomatik el mismo CUIT y los nombres parecidos.
 */
export function AddClientDialog({ plantId, trigger, onClientAdded }: AddClientDialogProps) {
  const { esGerencial } = usePermisos()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({ ...VACIO })
  const [conflicto, setConflicto] = useState<Extract<RespuestaAlta, { ok: false }> | null>(null)
  const [descartados, setDescartados] = useState<string[]>([])
  const [sinCuit, setSinCuit] = useState(false)
  const [motivo, setMotivo] = useState("")

  const cuitOk = documentoValido(formData.cuit)?.tipo === "CUIT"
  const reiniciar = () => {
    setFormData({ ...VACIO })
    setConflicto(null)
    setDescartados([])
    setSinCuit(false)
    setMotivo("")
  }
  const terminar = (c: { id: string; name: string }) => {
    reiniciar()
    setOpen(false)
    onClientAdded?.(c)
  }

  async function enviar(desc: string[]) {
    if (!formData.name.trim()) {
      toast.error("El nombre del cliente es obligatorio")
      return
    }
    if (!plantId || plantId === "all" || plantId === "") {
      toast.error("Primero seleccione una planta en el formulario de programacion")
      return
    }
    if (!cuitOk && !(esGerencial && sinCuit)) {
      toast.error("Hace falta un CUIT válido (11 dígitos con el dígito verificador). No se acepta DNI.")
      return
    }
    if (!cuitOk && motivo.trim().length < 5) {
      toast.error("Escribí por qué se da de alta sin CUIT")
      return
    }
    setLoading(true)
    try {
      const r = await pedirAlta(
        {
          name: formData.name,
          razon_social: formData.razon_social || formData.name,
          cuit: formData.cuit,
          cond_iva: formData.cond_iva,
          contact: formData.contact,
          phone: formData.phone,
          email: formData.email,
          plant_id: plantId,
          remito_tipo: formData.remito_tipo,
        },
        desc,
        cuitOk ? undefined : motivo.trim(),
      )
      if (r.ok) {
        toast.success("Cliente agregado exitosamente")
        terminar(r.cliente)
      } else if (r.codigo === "mismo_documento" || r.codigo === "parecidos") setConflicto(r)
      else toast.error(r.error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reiniciar() }}>
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
        <form onSubmit={(e) => { e.preventDefault(); enviar(descartados) }} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Nombre / Razón Social *</Label>
            <Input
              id="name"
              value={formData.razon_social}
              onChange={(e) => { setFormData({ ...formData, razon_social: e.target.value, name: e.target.value }); setConflicto(null); setDescartados([]) }}
              placeholder="Ej: GARCÍA JUAN CARLOS"
              required
            />
          </div>
          {/* Zomatik Z0: si ya está en Rebucret, avisa; si está en Zomatik, se trae (no se escribe en Zomatik) */}
          <BuscarZomatik texto={formData.razon_social} plantId={plantId} onTraido={terminar} />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="cuit">CUIT *</Label>
              <Input
                id="cuit"
                value={formData.cuit}
                onChange={(e) => { setFormData({ ...formData, cuit: e.target.value }); setConflicto(null) }}
                placeholder="XX-XXXXXXXX-X"
              />
              {formData.cuit.trim() && !cuitOk && (
                <p className="text-xs text-red-700">{documentoValido(formData.cuit)?.tipo === "DNI" ? "El alta pide CUIT, no DNI." : "CUIT inválido (revisá el dígito verificador)."}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Cond. IVA</Label>
              <Select value={formData.cond_iva} onValueChange={(v) => setFormData({ ...formData, cond_iva: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["Responsable Inscripto","Monotributista","Consumidor Final","Exento","No Responsable"].map(o => (
                    <SelectItem key={o} value={o}>{o}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {esGerencial && !cuitOk && (
            <div className="space-y-1 rounded-md border p-2 text-xs">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={sinCuit} onChange={(e) => setSinCuit(e.target.checked)} />
                Dar de alta sin CUIT (excepción de gerencial)
              </label>
              {sinCuit && <Input className="h-8 text-xs" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (queda en Actividad)" />}
            </div>
          )}
          {/* Fase 3: remito R / X por defecto ("" = se decide en cada pedido) */}
          <div className="space-y-2">
            <Label>Remito</Label>
            <Select value={formData.remito_tipo || "segun"} onValueChange={(v) => setFormData({ ...formData, remito_tipo: v === "segun" ? "" : v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="segun">Se decide en cada pedido</SelectItem>
                <SelectItem value="R">Siempre con factura (R)</SelectItem>
                <SelectItem value="X">Siempre sin factura (X)</SelectItem>
              </SelectContent>
            </Select>
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
          {conflicto && (
            <ConflictoAlta
              respuesta={conflicto}
              nombreNuevo={formData.name}
              plantId={plantId}
              onUsar={terminar}
              onEsOtro={() => {
                const d = [...descartados, ...(conflicto.conflictos || []).map((c) => `${c.tipo}:${c.id}`)]
                setDescartados(d)
                setConflicto(null)
                enviar(d)
              }}
            />
          )}
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
