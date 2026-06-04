"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
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
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"

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
  const [deleteClientStep, setDeleteClientStep] = useState(1)
  const [deleteSiteConfirm, setDeleteSiteConfirm] = useState<ConstructionSite | null>(null)
  const [deleteSiteStep, setDeleteSiteStep] = useState(1)
  const { toast } = useToast()

  const [clientForm, setClientForm] = useState({ ...EMPTY_CLIENT_FORM })
  const [siteForm, setSiteForm] = useState({ ...EMPTY_SITE_FORM })

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
    if (!clientForm.name.trim()) {
      toast({ title: "Error", description: "El nombre es obligatorio", variant: "destructive" })
      return
    }
    if (!clientForm.cuit.trim()) {
      toast({ title: "Error", description: "El CUIT es obligatorio", variant: "destructive" })
      return
    }

    const supabase = createClient()
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
    } else {
      const { error } = await supabase.from("clients").insert({ ...payload, active: true })
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return }
      toast({ title: "Cliente creado" })
    }

    setIsClientDialogOpen(false)
    setEditingClient(null)
    setClientForm({ ...EMPTY_CLIENT_FORM })
    loadClients()
  }

  async function handleSaveSite() {
    if (!selectedClient) return
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
    }

    if (editingSite) {
      const { error } = await supabase.from("construction_sites").update(siteData).eq("id", editingSite.id)
      if (error) { toast({ title: "Error", description: "No se pudo actualizar la obra", variant: "destructive" }); return }
      toast({ title: "Obra actualizada" })
    } else {
      const { error } = await supabase.from("construction_sites").insert(siteData)
      if (error) { toast({ title: "Error", description: "No se pudo crear la obra", variant: "destructive" }); return }
      toast({ title: "Obra creada" })
    }

    setIsSiteDialogOpen(false)
    setEditingSite(null)
    setSiteForm({ ...EMPTY_SITE_FORM })
    loadClients()
  }

  function openEditClient(client: Client) {
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
    setEditingSite(site)
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

  async function confirmDeleteClient() {
    if (deleteClientStep === 1) { setDeleteClientStep(2); return }
    if (!deleteClientConfirm) return
    const supabase = createClient()
    const { error } = await supabase.from("clients").update({ active: false }).eq("id", deleteClientConfirm.id)
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return }
    toast({ title: "Cliente eliminado" })
    setDeleteClientConfirm(null)
    setDeleteClientStep(1)
    if (selectedClient?.id === deleteClientConfirm.id) setSelectedClient(null)
    loadClients()
  }

  async function confirmDeleteSite() {
    if (deleteSiteStep === 1) { setDeleteSiteStep(2); return }
    if (!deleteSiteConfirm) return
    const supabase = createClient()
    const { error } = await supabase.from("construction_sites").delete().eq("id", deleteSiteConfirm.id)
    if (error) { toast({ title: "Error", description: "No se pudo eliminar la obra", variant: "destructive" }); return }
    toast({ title: "Obra eliminada" })
    setDeleteSiteConfirm(null)
    setDeleteSiteStep(1)
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
        <Button onClick={() => { setEditingClient(null); setClientForm({ ...EMPTY_CLIENT_FORM }); setIsClientDialogOpen(true) }} className="gap-2">
          <Plus className="h-4 w-4" /> Nuevo Cliente
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Lista de clientes */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-lg">Clientes ({filteredClients.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y max-h-[600px] overflow-y-auto">
              {filteredClients.map((client) => (
                <div
                  key={client.id}
                  className={`p-4 cursor-pointer hover:bg-muted/50 transition-colors ${selectedClient?.id === client.id ? "bg-muted" : ""}`}
                  onClick={() => setSelectedClient(client)}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium">{client.name}</p>
                      {client.razon_social && client.razon_social !== client.name && (
                        <p className="text-xs text-muted-foreground">{client.razon_social}</p>
                      )}
                      {client.cuit && <p className="text-sm text-muted-foreground">CUIT: {client.cuit}</p>}
                      <p className="text-sm text-muted-foreground mt-1">{client.construction_sites?.length || 0} obra(s)</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); openEditClient(client) }}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={(e) => { e.stopPropagation(); setDeleteClientConfirm(client); setDeleteClientStep(1) }}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
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
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>{selectedClient.name}</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    {selectedClient.cuit && `CUIT: ${selectedClient.cuit}`}
                    {selectedClient.phone && ` | Tel: ${selectedClient.phone}`}
                    {selectedClient.cond_iva && ` | ${selectedClient.cond_iva}`}
                  </p>
                </div>
                <Button onClick={() => { setEditingSite(null); setSiteForm({ ...EMPTY_SITE_FORM }); setIsSiteDialogOpen(true) }} className="gap-2">
                  <Plus className="h-4 w-4" /> Nueva Obra
                </Button>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Obra</TableHead>
                      <TableHead>Dirección</TableHead>
                      <TableHead>Localidad</TableHead>
                      <TableHead className="text-center">T. Viaje</TableHead>
                      <TableHead className="text-center">Descarga</TableHead>
                      <TableHead className="text-center">Bomba</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedClient.construction_sites?.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground py-8">No hay obras registradas</TableCell>
                      </TableRow>
                    ) : (
                      selectedClient.construction_sites?.map((site) => (
                        <TableRow key={site.id}>
                          <TableCell className="font-medium">{site.name}</TableCell>
                          <TableCell className="max-w-[130px] truncate">{site.address || "-"}</TableCell>
                          <TableCell>{site.localidad || "-"}</TableCell>
                          <TableCell className="text-center">{site.travel_time_minutes} min</TableCell>
                          <TableCell className="text-center">{site.unload_time_minutes} min</TableCell>
                          <TableCell className="text-center">
                            {site.requires_pump ? <Badge>Sí</Badge> : <span className="text-muted-foreground">No</span>}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Button variant="ghost" size="sm" onClick={() => openEditSite(site)}><Pencil className="h-4 w-4" /></Button>
                              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => { setDeleteSiteConfirm(site); setDeleteSiteStep(1) }}><Trash2 className="h-4 w-4" /></Button>
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsClientDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSaveClient} disabled={!clientForm.razon_social || !clientForm.cuit}>
              {editingClient ? "Guardar" : "Crear"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog Obra ── */}
      <Dialog open={isSiteDialogOpen} onOpenChange={setIsSiteDialogOpen}>
        <DialogContent className="max-w-lg">
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsSiteDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSaveSite} disabled={!siteForm.name || !siteForm.address || !siteForm.localidad}>
              {editingSite ? "Guardar" : "Crear"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Client */}
      <AlertDialog open={!!deleteClientConfirm} onOpenChange={(open) => { if (!open) { setDeleteClientConfirm(null); setDeleteClientStep(1) } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{deleteClientStep === 1 ? "Eliminar Cliente" : "Confirmar Eliminación"}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteClientStep === 1 ? (
                <>¿Seguro que querés eliminar a <strong>{deleteClientConfirm?.name}</strong>?
                  {(deleteClientConfirm?.construction_sites?.length || 0) > 0 && (
                    <span className="block mt-2 text-destructive font-medium">También se eliminarán {deleteClientConfirm?.construction_sites?.length} obra(s) asociada(s).</span>
                  )}
                </>
              ) : (
                <span className="text-destructive font-medium">Esta acción no se puede deshacer.</span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setDeleteClientConfirm(null); setDeleteClientStep(1) }}>Cancelar</AlertDialogCancel>
            <Button variant="destructive" onClick={(e) => { e.preventDefault(); confirmDeleteClient() }}>
              {deleteClientStep === 1 ? "Continuar" : "Sí, eliminar"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Site */}
      <AlertDialog open={!!deleteSiteConfirm} onOpenChange={(open) => { if (!open) { setDeleteSiteConfirm(null); setDeleteSiteStep(1) } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{deleteSiteStep === 1 ? "Eliminar Obra" : "Confirmar Eliminación"}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteSiteStep === 1
                ? <>¿Seguro que querés eliminar la obra <strong>{deleteSiteConfirm?.name}</strong>?</>
                : <span className="text-destructive font-medium">Esta acción no se puede deshacer.</span>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setDeleteSiteConfirm(null); setDeleteSiteStep(1) }}>Cancelar</AlertDialogCancel>
            <Button variant="destructive" onClick={(e) => { e.preventDefault(); confirmDeleteSite() }}>
              {deleteSiteStep === 1 ? "Continuar" : "Sí, eliminar"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
