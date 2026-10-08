"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { ObraUbicacion, type UbicacionObra } from "@/components/obra-ubicacion"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"
import { Plus, Pencil, Search, Trash2 } from "lucide-react"
import { usePermisos } from "@/lib/current-user"
import { logActivity, logCambio, logDeletion } from "@/lib/activity-log"
import { CampoMotivo, ConfirmarConMotivo, motivoValido } from "@/components/motivo"

type Client = {
  id: string
  name: string
  razon_social: string | null
  cuit: string | null
  cond_iva: string | null
  direccion_fiscal: string | null
  cp: string | null
  localidad_cliente: string | null
  provincia: string | null
  cond_pago: string | null
  phone: string | null
  email: string | null
  contact: string | null
  active: boolean
  plant_id?: string | null
  construction_sites?: ConstructionSite[]
}

type ConstructionSite = {
  id: string
  name: string
  address: string | null
  localidad: string | null
  client_id: string
  travel_time_minutes: number
  unload_time_minutes: number
  requires_pump: boolean
  reception_hours_start: string | null
  reception_hours_end: string | null
  site_contact: string | null
  site_phone: string | null
  observations: string | null
  status: string
  gps_lat?: number | null
  gps_lng?: number | null
  gps_source?: string | null
  travel_distance_km?: number | null
}

const COND_IVA_OPTIONS = [
  "Responsable Inscripto",
  "Monotributista",
  "Consumidor Final",
  "Exento",
  "No Responsable",
]

const COND_PAGO_OPTIONS = [
  "Contado",
  "30 días",
  "60 días",
  "90 días",
  "Cuenta Corriente",
]

const EMPTY_CLIENT_FORM = {
  name: "",
  razon_social: "",
  cuit: "",
  cond_iva: "Responsable Inscripto",
  direccion_fiscal: "",
  cp: "",
  localidad_cliente: "",
  provincia: "Buenos Aires",
  cond_pago: "Contado",
  phone: "",
  email: "",
  contact: "",
}

const EMPTY_SITE_FORM = {
  name: "",
  address: "",
  localidad: "",
  travel_time_minutes: "30",
  unload_time_minutes: "20",
  requires_pump: false,
  reception_hours_start: "07:00",
  reception_hours_end: "18:00",
  site_contact: "",
  site_phone: "",
  observations: "",
}

// Fase 0c-1: nombres en pantalla de los campos que quedan en Actividad al editar
const ETIQUETAS_CLIENTE: Record<string, string> = {
  name: "Nombre", razon_social: "Razón social", cuit: "CUIT", cond_iva: "Condición IVA", direccion_fiscal: "Dirección fiscal",
  cp: "CP", localidad_cliente: "Localidad", provincia: "Provincia", cond_pago: "Condición de pago", phone: "Teléfono", email: "Mail", contact: "Contacto",
}
const ETIQUETAS_OBRA: Record<string, string> = {
  name: "Nombre", address: "Dirección", localidad: "Localidad", travel_time_minutes: "Viaje (min)", unload_time_minutes: "Descarga (min)",
  requires_pump: "Bomba", reception_hours_start: "Recibe desde", reception_hours_end: "Recibe hasta", site_contact: "Contacto en obra",
  site_phone: "Teléfono en obra", observations: "Observaciones", gps: "Ubicación",
}

export function ClientsManagement() {
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [isClientDialogOpen, setIsClientDialogOpen] = useState(false)
  const [isSiteDialogOpen, setIsSiteDialogOpen] = useState(false)
  const [editingClient, setEditingClient] = useState<Client | null>(null)
  const [editingSite, setEditingSite] = useState<ConstructionSite | null>(null)
  const [deleteClientConfirm, setDeleteClientConfirm] = useState<Client | null>(null)
  const [deleteSiteConfirm, setDeleteSiteConfirm] = useState<ConstructionSite | null>(null)
  // Fase 0c-1: clientes y obras = permiso "clientes"; editar y borrar piden motivo
  const { puede } = usePermisos()
  const [motivo, setMotivo] = useState("")
  const { toast } = useToast()

  const [clientForm, setClientForm] = useState({ ...EMPTY_CLIENT_FORM })
  const [siteForm, setSiteForm] = useState({ ...EMPTY_SITE_FORM })
  const UBIC_VACIA: UbicacionObra = { lat: null, lng: null, fuente: null, km: null, minutos: null }
  const [siteUbic, setSiteUbic] = useState<UbicacionObra>(UBIC_VACIA)

  useEffect(() => { loadClients() }, [])

  async function loadClients() {
    const supabase = createClient()
    const { data, error } = await supabase
      .from("clients")
      .select("*, construction_sites (*)")
      .neq("active", false)
      .order("name")
      .limit(10000)

    if (error) {
      toast({ title: "Error", description: "No se pudieron cargar los clientes", variant: "destructive" })
    } else {
      setClients(data || [])
    }
    setLoading(false)
  }

  const filteredClients = clients.filter(
    (c) =>
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.razon_social?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.cuit?.includes(searchTerm) ||
      c.construction_sites?.some((s) => s.name.toLowerCase().includes(searchTerm.toLowerCase()))
  )

  async function handleSaveClient() {
    if (editingClient ? !puede("clientes", "editar") : !puede("clientes", "cargar")) return
    if (editingClient && !motivoValido(motivo)) {
      toast({ title: "Falta el motivo", description: "Escribí por qué se corrige el cliente.", variant: "destructive" })
      return
    }
    if (!clientForm.name.trim()) {
      toast({ title: "Error", description: "El nombre es obligatorio", variant: "destructive" })
      return
    }
    if (!clientForm.cuit.trim()) {
      toast({ title: "Error", description: "El CUIT es obligatorio", variant: "destructive" })
      return
    }

    const supabase = createClient()

    // Anti-duplicado por CUIT (excluyendo el propio cliente al editar)
    const { data: dupCuit } = await supabase
      .from("clients")
      .select("id, name")
      .eq("cuit", clientForm.cuit.trim())
      .neq("active", false)
      .limit(5)
    const conflict = (dupCuit || []).find((c: any) => c.id !== editingClient?.id)
    if (conflict) {
      toast({ title: "CUIT duplicado", description: `Ya existe un cliente con ese CUIT: ${conflict.name}.`, variant: "destructive" })
      return
    }
    const payload = {
      name:              clientForm.name.trim(),
      razon_social:      clientForm.razon_social.trim() || clientForm.name.trim(),
      cuit:              clientForm.cuit.trim(),
      cond_iva:          clientForm.cond_iva || null,
      direccion_fiscal:  clientForm.direccion_fiscal.trim() || null,
      cp:                clientForm.cp.trim() || null,
      localidad_cliente: clientForm.localidad_cliente.trim() || null,
      provincia:         clientForm.provincia.trim() || null,
      cond_pago:         clientForm.cond_pago || null,
      phone:             clientForm.phone.trim() || null,
      email:             clientForm.email.trim() || null,
      contact:           clientForm.contact.trim() || null,
    }

    if (editingClient) {
      const { error } = await supabase.from("clients").update(payload).eq("id", editingClient.id)
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return }
      toast({ title: "Cliente actualizado" })
      await logCambio({
        entity: "cliente",
        entityId: editingClient.id,
        reference: payload.name,
        antes: editingClient as unknown as Record<string, unknown>,
        despues: payload,
        etiquetas: ETIQUETAS_CLIENTE,
        motivo: motivo.trim(),
      })
    } else {
      const { data: creado, error } = await supabase.from("clients").insert({ ...payload, active: true }).select("id").single()
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return }
      toast({ title: "Cliente creado" })
      logActivity({ action: "crear", entity: "cliente", entityId: (creado as any)?.id ?? null, reference: payload.name, details: { Cliente: payload.name, CUIT: payload.cuit, "Condición IVA": payload.cond_iva || "-" } })
    }

    setIsClientDialogOpen(false)
    setEditingClient(null)
    setClientForm({ ...EMPTY_CLIENT_FORM })
    loadClients()
  }

  async function handleSaveSite() {
    if (!selectedClient) return
    if (editingSite ? !puede("clientes", "editar") : !puede("clientes", "cargar")) return
    if (editingSite && !motivoValido(motivo)) {
      toast({ title: "Falta el motivo", description: "Escribí por qué se corrige la obra.", variant: "destructive" })
      return
    }
    if (!siteForm.name.trim()) {
      toast({ title: "Error", description: "El nombre de la obra es obligatorio", variant: "destructive" })
      return
    }
    if (!siteForm.address.trim()) {
      toast({ title: "Error", description: "La dirección es obligatoria", variant: "destructive" })
      return
    }
    if (!siteForm.localidad.trim()) {
      toast({ title: "Error", description: "La localidad es obligatoria", variant: "destructive" })
      return
    }

    const supabase = createClient()
    const siteData = {
      name:                   siteForm.name.trim(),
      address:                siteForm.address.trim(),
      localidad:              siteForm.localidad.trim(),
      client_id:              selectedClient.id,
      travel_time_minutes:    parseInt(siteForm.travel_time_minutes) || 30,
      unload_time_minutes:    parseInt(siteForm.unload_time_minutes) || 20,
      requires_pump:          siteForm.requires_pump,
      reception_hours_start:  siteForm.reception_hours_start || null,
      reception_hours_end:    siteForm.reception_hours_end || null,
      site_contact:           siteForm.site_contact.trim() || null,
      site_phone:             siteForm.site_phone.trim() || null,
      observations:           siteForm.observations.trim() || null,
      gps_lat:                siteUbic.lat,
      gps_lng:                siteUbic.lng,
      gps_source:             siteUbic.fuente,
      travel_distance_km:     siteUbic.km,
      gps_updated_at:         siteUbic.lat != null ? new Date().toISOString() : null,
    }

    if (editingSite) {
      const { error } = await supabase.from("construction_sites").update(siteData).eq("id", editingSite.id)
      if (error) { toast({ title: "Error", description: "No se pudo actualizar la obra", variant: "destructive" }); return }
      toast({ title: "Obra actualizada" })
      await logCambio({
        entity: "obra",
        entityId: editingSite.id,
        reference: siteData.name,
        antes: {
          ...editingSite,
          reception_hours_start: editingSite.reception_hours_start?.slice(0, 5) || null,
          reception_hours_end: editingSite.reception_hours_end?.slice(0, 5) || null,
          gps: editingSite.gps_lat != null ? `${Number(editingSite.gps_lat)}, ${Number(editingSite.gps_lng)}` : "",
        } as unknown as Record<string, unknown>,
        despues: { ...siteData, gps: siteData.gps_lat != null ? `${Number(siteData.gps_lat)}, ${Number(siteData.gps_lng)}` : "" },
        etiquetas: ETIQUETAS_OBRA,
        motivo: motivo.trim(),
        extra: { Cliente: selectedClient.name },
      })
    } else {
      const { data: creada, error } = await supabase.from("construction_sites").insert(siteData).select("id").single()
      if (error) { toast({ title: "Error", description: "No se pudo crear la obra", variant: "destructive" }); return }
      toast({ title: "Obra creada" })
      logActivity({ action: "crear", entity: "obra", entityId: (creada as any)?.id ?? null, reference: siteData.name, details: { Obra: siteData.name, Cliente: selectedClient.name, "Dirección": siteData.address, Localidad: siteData.localidad, "Viaje (min)": siteData.travel_time_minutes } })
    }

    setIsSiteDialogOpen(false)
    setEditingSite(null)
    setSiteForm({ ...EMPTY_SITE_FORM })
    setSiteUbic(UBIC_VACIA)
    loadClients()
  }

  function openEditClient(client: Client) {
    setMotivo("")
    setEditingClient(client)
    setClientForm({
      name:              client.name,
      razon_social:      client.razon_social      || "",
      cuit:              client.cuit              || "",
      cond_iva:          client.cond_iva          || "Responsable Inscripto",
      direccion_fiscal:  client.direccion_fiscal  || "",
      cp:                client.cp                || "",
      localidad_cliente: client.localidad_cliente || "",
      provincia:         client.provincia         || "Buenos Aires",
      cond_pago:         client.cond_pago         || "Contado",
      phone:             client.phone             || "",
      email:             client.email             || "",
      contact:           client.contact           || "",
    })
    setIsClientDialogOpen(true)
  }

  function openEditSite(site: ConstructionSite) {
    setMotivo("")
    setEditingSite(site)
    setSiteUbic({
      lat: site.gps_lat != null ? Number(site.gps_lat) : null,
      lng: site.gps_lng != null ? Number(site.gps_lng) : null,
      fuente: (site.gps_source as any) || null,
      km: site.travel_distance_km != null ? Number(site.travel_distance_km) : null,
      minutos: null,
    })
    setSiteForm({
      name:                   site.name,
      address:                site.address      || "",
      localidad:              site.localidad    || "",
      travel_time_minutes:    site.travel_time_minutes?.toString()  || "30",
      unload_time_minutes:    site.unload_time_minutes?.toString()  || "20",
      requires_pump:          site.requires_pump || false,
      reception_hours_start:  site.reception_hours_start || "07:00",
      reception_hours_end:    site.reception_hours_end   || "18:00",
      site_contact:           site.site_contact  || "",
      site_phone:             site.site_phone    || "",
      observations:           site.observations  || "",
    })
    setIsSiteDialogOpen(true)
  }

  async function confirmDeleteClient(motivoBaja: string) {
    if (!deleteClientConfirm || !puede("clientes", "borrar")) return
    const supabase = createClient()
    const { error } = await supabase.from("clients").update({ active: false }).eq("id", deleteClientConfirm.id)
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return }
    toast({ title: "Cliente eliminado" })
    await logDeletion({
      entity: "cliente",
      entityId: deleteClientConfirm.id,
      reference: deleteClientConfirm.name,
      details: {
        Cliente: deleteClientConfirm.name,
        CUIT: deleteClientConfirm.cuit || "-",
        Obras: deleteClientConfirm.construction_sites?.map((o) => o.name).join(", ") || "-",
        Baja: "se da de baja (active = false); no se borra",
      },
      motivo: motivoBaja,
    })
    setDeleteClientConfirm(null)
    if (selectedClient?.id === deleteClientConfirm.id) setSelectedClient(null)
    loadClients()
  }

  async function confirmDeleteSite(motivoBorrado: string) {
    if (!deleteSiteConfirm || !puede("clientes", "borrar")) return
    const supabase = createClient()
    const { error } = await supabase.from("construction_sites").delete().eq("id", deleteSiteConfirm.id)
    if (error) { toast({ title: "Error", description: "No se pudo eliminar la obra", variant: "destructive" }); return }
    toast({ title: "Obra eliminada" })
    await logDeletion({
      entity: "obra",
      entityId: deleteSiteConfirm.id,
      reference: deleteSiteConfirm.name,
      details: {
        Obra: deleteSiteConfirm.name,
        Cliente: clients.find((c) => c.id === deleteSiteConfirm.client_id)?.name || "-",
        "Dirección": deleteSiteConfirm.address || "-",
        Localidad: deleteSiteConfirm.localidad || "-",
        "Viaje (min)": deleteSiteConfirm.travel_time_minutes,
        "Descarga (min)": deleteSiteConfirm.unload_time_minutes,
      },
      motivo: motivoBorrado,
    })
    setDeleteSiteConfirm(null)
    loadClients()
  }

  if (loading) return <div className="flex items-center justify-center py-8">Cargando...</div>

  return (
    <div className="space-y-6">
      {/* Barra superior */}
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar cliente, CUIT u obra..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
        {puede("clientes", "cargar") && (
          <Button onClick={() => { setEditingClient(null); setClientForm({ ...EMPTY_CLIENT_FORM }); setIsClientDialogOpen(true) }} className="gap-2">
            <Plus className="h-4 w-4" /> Nuevo Cliente
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Lista de clientes */}
        <Card className="lg:col-span-1">
          <CardHeader className="py-3">
            <CardTitle className="text-base">Clientes ({filteredClients.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y max-h-[600px] overflow-y-auto">
              {filteredClients.map((client) => (
                <div
                  key={client.id}
                  className={`px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors ${selectedClient?.id === client.id ? "bg-muted" : ""}`}
                  onClick={() => setSelectedClient(client)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm truncate">{client.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {client.cuit ? `CUIT ${client.cuit}` : "Sin CUIT"} · {client.construction_sites?.length || 0} obra(s)
                      </p>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      {puede("clientes", "editar") && (
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); openEditClient(client) }}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {puede("clientes", "borrar") && (
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={(e) => { e.stopPropagation(); setDeleteClientConfirm(client) }}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Detalle del cliente y obras */}
        <Card className="lg:col-span-2">
          {selectedClient ? (
            <>
              <CardHeader className="flex flex-row items-center justify-between py-3">
                <div className="min-w-0">
                  <CardTitle className="text-base truncate">{selectedClient.name}</CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    {selectedClient.cuit && `CUIT: ${selectedClient.cuit}`}
                    {selectedClient.phone && ` · Tel: ${selectedClient.phone}`}
                    {selectedClient.cond_iva && ` · ${selectedClient.cond_iva}`}
                  </p>
                </div>
                {puede("clientes", "cargar") && (
                  <Button size="sm" onClick={() => { setEditingSite(null); setSiteForm({ ...EMPTY_SITE_FORM }); setSiteUbic(UBIC_VACIA); setIsSiteDialogOpen(true) }} className="gap-1.5 shrink-0">
                    <Plus className="h-4 w-4" /> Nueva Obra
                  </Button>
                )}
              </CardHeader>
              <CardContent className="px-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="h-9 text-xs">Obra</TableHead>
                      <TableHead className="h-9 text-xs">Localidad</TableHead>
                      <TableHead className="h-9 text-xs text-center">Viaje</TableHead>
                      <TableHead className="h-9 text-xs text-center">Descarga</TableHead>
                      <TableHead className="h-9 text-xs text-center">Bomba</TableHead>
                      <TableHead className="h-9 w-[70px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedClient.construction_sites?.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-8 text-sm">No hay obras registradas</TableCell>
                      </TableRow>
                    ) : (
                      selectedClient.construction_sites?.map((site) => (
                        <TableRow key={site.id}>
                          <TableCell className="py-2 font-medium text-sm">
                            <div className="truncate max-w-[200px]">{site.name}</div>
                            {site.address && <div className="text-xs text-muted-foreground font-normal truncate max-w-[200px]">{site.address}</div>}
                            {site.gps_lat == null && <div className="text-[10px] text-amber-600 font-normal">Sin ubicar en el mapa</div>}
                          </TableCell>
                          <TableCell className="py-2 text-sm">{site.localidad || "-"}</TableCell>
                          <TableCell className="py-2 text-center text-sm whitespace-nowrap">{site.travel_time_minutes}'</TableCell>
                          <TableCell className="py-2 text-center text-sm whitespace-nowrap">{site.unload_time_minutes}'</TableCell>
                          <TableCell className="py-2 text-center">
                            {site.requires_pump ? <Badge className="text-xs">Sí</Badge> : <span className="text-muted-foreground text-sm">No</span>}
                          </TableCell>
                          <TableCell className="py-2">
                            <div className="flex items-center gap-0.5">
                              {puede("clientes", "editar") && <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditSite(site)}><Pencil className="h-3.5 w-3.5" /></Button>}
                              {puede("clientes", "borrar") && <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteSiteConfirm(site)}><Trash2 className="h-3.5 w-3.5" /></Button>}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </>
          ) : (
            <CardContent className="flex items-center justify-center h-[400px] text-muted-foreground">
              Seleccioná un cliente para ver sus obras
            </CardContent>
          )}
        </Card>
      </div>

      {/* ── Dialog Cliente ── */}
      <Dialog open={isClientDialogOpen} onOpenChange={setIsClientDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingClient ? "Editar Cliente" : "Nuevo Cliente"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">

            {/* Datos fiscales */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Datos fiscales</p>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label>Nombre / Razón Social <span className="text-destructive">*</span></Label>
                  <Input
                    value={clientForm.razon_social}
                    onChange={(e) => setClientForm({ ...clientForm, razon_social: e.target.value, name: e.target.value })}
                    placeholder="Ej: GARCÍA JUAN CARLOS"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>CUIT <span className="text-destructive">*</span></Label>
                    <Input
                      value={clientForm.cuit}
                      onChange={(e) => setClientForm({ ...clientForm, cuit: e.target.value })}
                      placeholder="XX-XXXXXXXX-X"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Cond. ante IVA</Label>
                    <Select value={clientForm.cond_iva} onValueChange={(v) => setClientForm({ ...clientForm, cond_iva: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {COND_IVA_OPTIONS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Cond. de Pago</Label>
                  <Select value={clientForm.cond_pago} onValueChange={(v) => setClientForm({ ...clientForm, cond_pago: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {COND_PAGO_OPTIONS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="border-t" />

            {/* Domicilio fiscal */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Domicilio fiscal</p>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label>Dirección</Label>
                  <Input
                    value={clientForm.direccion_fiscal}
                    onChange={(e) => setClientForm({ ...clientForm, direccion_fiscal: e.target.value })}
                    placeholder="Calle y número"
                  />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label>CP</Label>
                    <Input
                      value={clientForm.cp}
                      onChange={(e) => setClientForm({ ...clientForm, cp: e.target.value })}
                      placeholder="1234"
                    />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label>Localidad</Label>
                    <Input
                      value={clientForm.localidad_cliente}
                      onChange={(e) => setClientForm({ ...clientForm, localidad_cliente: e.target.value })}
                      placeholder="Ej: La Plata"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Provincia</Label>
                  <Input
                    value={clientForm.provincia}
                    onChange={(e) => setClientForm({ ...clientForm, provincia: e.target.value })}
                    placeholder="Ej: Buenos Aires"
                  />
                </div>
              </div>
            </div>

            <div className="border-t" />

            {/* Datos de contacto */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Contacto</p>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Teléfono</Label>
                    <Input value={clientForm.phone} onChange={(e) => setClientForm({ ...clientForm, phone: e.target.value })} placeholder="Teléfono" />
                  </div>
                  <div className="space-y-1">
                    <Label>Email</Label>
                    <Input type="email" value={clientForm.email} onChange={(e) => setClientForm({ ...clientForm, email: e.target.value })} placeholder="email@ejemplo.com" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Nombre del contacto</Label>
                  <Input value={clientForm.contact} onChange={(e) => setClientForm({ ...clientForm, contact: e.target.value })} placeholder="Nombre del contacto" />
                </div>
              </div>
            </div>
          </div>
          {editingClient && <CampoMotivo value={motivo} onChange={setMotivo} id="motivo-cliente" ejemplo="Ej: el CUIT estaba mal cargado" />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsClientDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSaveClient} disabled={!clientForm.razon_social || !clientForm.cuit || (!!editingClient && !motivoValido(motivo))}>
              {editingClient ? "Guardar" : "Crear"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog Obra ── */}
      <Dialog open={isSiteDialogOpen} onOpenChange={setIsSiteDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingSite ? "Editar Obra" : "Nueva Obra"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">

            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Datos de la obra</p>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label>Nombre de la Obra <span className="text-destructive">*</span></Label>
                  <Input value={siteForm.name} onChange={(e) => setSiteForm({ ...siteForm, name: e.target.value })} placeholder="Ej: Edificio Centro" />
                </div>
                <div className="space-y-1">
                  <Label>Dirección <span className="text-destructive">*</span></Label>
                  <Input value={siteForm.address} onChange={(e) => setSiteForm({ ...siteForm, address: e.target.value })} placeholder="Calle y número" />
                </div>
                <div className="space-y-1">
                  <Label>Localidad <span className="text-destructive">*</span></Label>
                  <Input value={siteForm.localidad} onChange={(e) => setSiteForm({ ...siteForm, localidad: e.target.value })} placeholder="Ej: Quilmes" />
                </div>
                <div className="space-y-1">
                  <Label>Ubicación en el mapa</Label>
                  <ObraUbicacion
                    direccion={siteForm.address}
                    localidad={siteForm.localidad}
                    plantaId={selectedClient?.plant_id}
                    valor={siteUbic}
                    onChange={setSiteUbic}
                    onTiempoViaje={(min) => setSiteForm((f) => ({ ...f, travel_time_minutes: String(min) }))}
                  />
                </div>
              </div>
            </div>

            <div className="border-t" />

            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Logística</p>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Tiempo de Viaje (min)</Label>
                    <Input type="number" value={siteForm.travel_time_minutes} onChange={(e) => setSiteForm({ ...siteForm, travel_time_minutes: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label>Tiempo de Descarga (min)</Label>
                    <Input type="number" value={siteForm.unload_time_minutes} onChange={(e) => setSiteForm({ ...siteForm, unload_time_minutes: e.target.value })} />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <Label>Requiere Bomba</Label>
                  <Switch checked={siteForm.requires_pump} onCheckedChange={(checked) => setSiteForm({ ...siteForm, requires_pump: checked })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Horario Desde</Label>
                    <Input type="time" value={siteForm.reception_hours_start} onChange={(e) => setSiteForm({ ...siteForm, reception_hours_start: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label>Horario Hasta</Label>
                    <Input type="time" value={siteForm.reception_hours_end} onChange={(e) => setSiteForm({ ...siteForm, reception_hours_end: e.target.value })} />
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t" />

            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Contacto en obra</p>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Contacto</Label>
                    <Input value={siteForm.site_contact} onChange={(e) => setSiteForm({ ...siteForm, site_contact: e.target.value })} placeholder="Nombre" />
                  </div>
                  <div className="space-y-1">
                    <Label>Teléfono</Label>
                    <Input value={siteForm.site_phone} onChange={(e) => setSiteForm({ ...siteForm, site_phone: e.target.value })} placeholder="Teléfono" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Observaciones</Label>
                  <Textarea value={siteForm.observations} onChange={(e) => setSiteForm({ ...siteForm, observations: e.target.value })} placeholder="Indicaciones de acceso, restricciones, etc." rows={2} />
                </div>
              </div>
            </div>
          </div>
          {editingSite && <CampoMotivo value={motivo} onChange={setMotivo} id="motivo-obra" ejemplo="Ej: el cliente pasó otra dirección" />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsSiteDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSaveSite} disabled={!siteForm.name || !siteForm.address || !siteForm.localidad || (!!editingSite && !motivoValido(motivo))}>
              {editingSite ? "Guardar" : "Crear"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Baja de cliente y eliminar obra: con motivo (fase 0c-1) */}
      <ConfirmarConMotivo
        open={!!deleteClientConfirm}
        onOpenChange={(open) => !open && setDeleteClientConfirm(null)}
        titulo="Eliminar Cliente"
        descripcion={
          <>
            ¿Seguro que querés eliminar a <strong>{deleteClientConfirm?.name}</strong>?
            {(deleteClientConfirm?.construction_sites?.length || 0) > 0 && (
              <span className="block mt-2 text-destructive font-medium">También dejan de verse sus {deleteClientConfirm?.construction_sites?.length} obra(s).</span>
            )}
          </>
        }
        textoBoton="Sí, eliminar"
        onConfirmar={confirmDeleteClient}
      />
      <ConfirmarConMotivo
        open={!!deleteSiteConfirm}
        onOpenChange={(open) => !open && setDeleteSiteConfirm(null)}
        titulo="Eliminar Obra"
        descripcion={<>¿Seguro que querés eliminar la obra <strong>{deleteSiteConfirm?.name}</strong>? Esta acción no se puede deshacer.</>}
        textoBoton="Sí, eliminar"
        onConfirmar={confirmDeleteSite}
      />
    </div>
  )
}
