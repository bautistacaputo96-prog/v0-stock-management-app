"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"
import { Plus, Pencil, MapPin, Phone, Clock, Building2, Search, Trash2 } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"

type Client = {
  id: string
  name: string
  cuit: string | null
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

  const [clientForm, setClientForm] = useState({
    name: "",
    cuit: "",
    phone: "",
    email: "",
    contact: "",
  })

  const [siteForm, setSiteForm] = useState({
    name: "",
    address: "",
    travel_time_minutes: "30",
    unload_time_minutes: "20",
    requires_pump: false,
    reception_hours_start: "07:00",
    reception_hours_end: "18:00",
    site_contact: "",
    site_phone: "",
    observations: "",
  })

  useEffect(() => {
    loadClients()
  }, [])

  async function loadClients() {
    const supabase = createClient()
    const { data, error } = await supabase
      .from("clients")
      .select(`
        *,
        construction_sites (*)
      `)
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
      c.cuit?.includes(searchTerm) ||
      c.construction_sites?.some((s) => s.name.toLowerCase().includes(searchTerm.toLowerCase()))
  )

  async function handleSaveClient() {
    console.log("[v0] handleSaveClient called", { clientForm, editingClient })
    
    if (!clientForm.name.trim()) {
      toast({ title: "Error", description: "El nombre del cliente es obligatorio", variant: "destructive" })
      return
    }
    
    const supabase = createClient()

    if (editingClient) {
      console.log("[v0] Updating client:", editingClient.id)
      const { error } = await supabase
        .from("clients")
        .update({
          name: clientForm.name,
          cuit: clientForm.cuit || null,
          phone: clientForm.phone || null,
          email: clientForm.email || null,
          contact: clientForm.contact || null,
        })
        .eq("id", editingClient.id)

      console.log("[v0] Update result:", { error })
      if (error) {
        toast({ title: "Error", description: error.message || "No se pudo actualizar el cliente", variant: "destructive" })
        return
      }
      toast({ title: "Cliente actualizado" })
    } else {
      console.log("[v0] Creating new client")
      const { data, error } = await supabase.from("clients").insert({
        name: clientForm.name,
        cuit: clientForm.cuit || null,
        phone: clientForm.phone || null,
        email: clientForm.email || null,
        contact: clientForm.contact || null,
        active: true,
      }).select()

      console.log("[v0] Insert result:", { data, error })
      if (error) {
        toast({ title: "Error", description: error.message || "No se pudo crear el cliente", variant: "destructive" })
        return
      }
      toast({ title: "Cliente creado" })
    }

    setIsClientDialogOpen(false)
    setEditingClient(null)
    setClientForm({ name: "", cuit: "", phone: "", email: "", address: "" })
    loadClients()
  }

  async function handleSaveSite() {
    if (!selectedClient) return
    const supabase = createClient()

    const siteData = {
      name: siteForm.name,
      address: siteForm.address || null,
      client_id: selectedClient.id,
      travel_time_minutes: parseInt(siteForm.travel_time_minutes) || 30,
      unload_time_minutes: parseInt(siteForm.unload_time_minutes) || 20,
      requires_pump: siteForm.requires_pump,
      reception_hours_start: siteForm.reception_hours_start || null,
      reception_hours_end: siteForm.reception_hours_end || null,
      site_contact: siteForm.site_contact || null,
      site_phone: siteForm.site_phone || null,
      observations: siteForm.observations || null,
    }

    if (editingSite) {
      const { error } = await supabase.from("construction_sites").update(siteData).eq("id", editingSite.id)

      if (error) {
        toast({ title: "Error", description: "No se pudo actualizar la obra", variant: "destructive" })
        return
      }
      toast({ title: "Obra actualizada" })
    } else {
      const { error } = await supabase.from("construction_sites").insert(siteData)

      if (error) {
        toast({ title: "Error", description: "No se pudo crear la obra", variant: "destructive" })
        return
      }
      toast({ title: "Obra creada" })
    }

    setIsSiteDialogOpen(false)
    setEditingSite(null)
    setSiteForm({
      name: "",
      address: "",
      travel_time_minutes: "30",
      unload_time_minutes: "20",
      requires_pump: false,
      reception_hours_start: "07:00",
      reception_hours_end: "18:00",
      site_contact: "",
      site_phone: "",
      observations: "",
    })
    loadClients()
  }

  function openEditClient(client: Client) {
    setEditingClient(client)
    setClientForm({
      name: client.name,
      cuit: client.cuit || "",
      phone: client.phone || "",
      email: client.email || "",
      contact: client.contact || "",
    })
    setIsClientDialogOpen(true)
  }

  function openEditSite(site: ConstructionSite) {
    setEditingSite(site)
    setSiteForm({
      name: site.name,
      address: site.address || "",
      travel_time_minutes: site.travel_time_minutes?.toString() || "30",
      unload_time_minutes: site.unload_time_minutes?.toString() || "20",
      requires_pump: site.requires_pump || false,
      reception_hours_start: site.reception_hours_start || "07:00",
      reception_hours_end: site.reception_hours_end || "18:00",
      site_contact: site.site_contact || "",
      site_phone: site.site_phone || "",
      observations: site.observations || "",
    })
    setIsSiteDialogOpen(true)
  }

  function startDeleteClient(client: Client) {
    setDeleteClientConfirm(client)
    setDeleteClientStep(1)
  }

  async function confirmDeleteClient() {
    if (deleteClientStep === 1) {
      setDeleteClientStep(2)
      return
    }

    if (!deleteClientConfirm) return
    const supabase = createClient()

    console.log("[v0] Deleting client:", deleteClientConfirm.id)

    // Use soft delete - set active to false
    const { error } = await supabase
      .from("clients")
      .update({ active: false })
      .eq("id", deleteClientConfirm.id)

    console.log("[v0] Delete result:", { error })

    if (error) {
      toast({ title: "Error", description: error.message || "No se pudo eliminar el cliente", variant: "destructive" })
      return
    }

    toast({ title: "Cliente eliminado" })
    setDeleteClientConfirm(null)
    setDeleteClientStep(1)
    if (selectedClient?.id === deleteClientConfirm.id) {
      setSelectedClient(null)
    }
    loadClients()
  }

  function startDeleteSite(site: ConstructionSite) {
    setDeleteSiteConfirm(site)
    setDeleteSiteStep(1)
  }

  async function confirmDeleteSite() {
    if (deleteSiteStep === 1) {
      setDeleteSiteStep(2)
      return
    }

    if (!deleteSiteConfirm) return
    const supabase = createClient()

    const { error } = await supabase
      .from("construction_sites")
      .delete()
      .eq("id", deleteSiteConfirm.id)

    if (error) {
      toast({ title: "Error", description: "No se pudo eliminar la obra", variant: "destructive" })
      return
    }

    toast({ title: "Obra eliminada" })
    setDeleteSiteConfirm(null)
    setDeleteSiteStep(1)
    loadClients()
  }

  if (loading) {
    return <div className="flex items-center justify-center py-8">Cargando...</div>
  }

  return (
    <div className="space-y-6">
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
        <Button
          onClick={() => {
            setEditingClient(null)
    setClientForm({ name: "", cuit: "", phone: "", email: "", contact: "" })
            setIsClientDialogOpen(true)
          }}
          className="gap-2"
        >
          <Plus className="h-4 w-4" />
          Nuevo Cliente
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
                  className={`p-4 cursor-pointer hover:bg-muted/50 transition-colors ${
                    selectedClient?.id === client.id ? "bg-muted" : ""
                  }`}
                  onClick={() => setSelectedClient(client)}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium">{client.name}</p>
                      {client.cuit && <p className="text-sm text-muted-foreground">CUIT: {client.cuit}</p>}
                      <p className="text-sm text-muted-foreground mt-1">
                        {client.construction_sites?.length || 0} obra(s)
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); openEditClient(client) }}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={(e) => { e.stopPropagation(); startDeleteClient(client) }}>
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
                  </p>
                </div>
                <Button
                  onClick={() => {
                    setEditingSite(null)
                    setSiteForm({
                      name: "",
                      address: "",
                      travel_time_minutes: "30",
                      unload_time_minutes: "20",
                      requires_pump: false,
                      reception_hours_start: "07:00",
                      reception_hours_end: "18:00",
                      site_contact: "",
                      site_phone: "",
                      observations: "",
                    })
                    setIsSiteDialogOpen(true)
                  }}
                  className="gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Nueva Obra
                </Button>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Obra</TableHead>
                      <TableHead>Direccion</TableHead>
                      <TableHead className="text-center">Tiempo Viaje</TableHead>
                      <TableHead className="text-center">Descarga</TableHead>
                      <TableHead className="text-center">Bomba</TableHead>
                      <TableHead>Horario</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedClient.construction_sites?.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                          No hay obras registradas
                        </TableCell>
                      </TableRow>
                    ) : (
                      selectedClient.construction_sites?.map((site) => (
                        <TableRow key={site.id}>
                          <TableCell className="font-medium">{site.name}</TableCell>
                          <TableCell className="max-w-[150px] truncate">{site.address || "-"}</TableCell>
                          <TableCell className="text-center">{site.travel_time_minutes} min</TableCell>
                          <TableCell className="text-center">{site.unload_time_minutes} min</TableCell>
                          <TableCell className="text-center">
                            {site.requires_pump ? (
                              <Badge>Si</Badge>
                            ) : (
                              <span className="text-muted-foreground">No</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {site.reception_hours_start && site.reception_hours_end
                              ? `${site.reception_hours_start.slice(0, 5)} - ${site.reception_hours_end.slice(0, 5)}`
                              : "-"}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <Button variant="ghost" size="sm" onClick={() => openEditSite(site)}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => startDeleteSite(site)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
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
              Selecciona un cliente para ver sus obras
            </CardContent>
          )}
        </Card>
      </div>

      {/* Dialog Cliente */}
      <Dialog open={isClientDialogOpen} onOpenChange={setIsClientDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingClient ? "Editar Cliente" : "Nuevo Cliente"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nombre *</Label>
              <Input
                value={clientForm.name || ""}
                onChange={(e) => setClientForm({ ...clientForm, name: e.target.value })}
                placeholder="Nombre del cliente"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>CUIT</Label>
                <Input
                  value={clientForm.cuit || ""}
                  onChange={(e) => setClientForm({ ...clientForm, cuit: e.target.value })}
                  placeholder="XX-XXXXXXXX-X"
                />
              </div>
              <div className="space-y-2">
                <Label>Telefono</Label>
                <Input
                  value={clientForm.phone || ""}
                  onChange={(e) => setClientForm({ ...clientForm, phone: e.target.value })}
                  placeholder="Telefono"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                value={clientForm.email || ""}
                onChange={(e) => setClientForm({ ...clientForm, email: e.target.value })}
                placeholder="email@ejemplo.com"
              />
            </div>
            <div className="space-y-2">
              <Label>Contacto</Label>
              <Input
                value={clientForm.contact || ""}
                onChange={(e) => setClientForm({ ...clientForm, contact: e.target.value })}
                placeholder="Nombre del contacto"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsClientDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSaveClient} disabled={!clientForm.name}>
              {editingClient ? "Guardar" : "Crear"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog Obra */}
      <Dialog open={isSiteDialogOpen} onOpenChange={setIsSiteDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingSite ? "Editar Obra" : "Nueva Obra"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
            <div className="space-y-2">
              <Label>Nombre de la Obra *</Label>
              <Input
                value={siteForm.name}
                onChange={(e) => setSiteForm({ ...siteForm, name: e.target.value })}
                placeholder="Ej: Edificio Centro"
              />
            </div>
            <div className="space-y-2">
              <Label>Direccion</Label>
              <Input
                value={siteForm.address}
                onChange={(e) => setSiteForm({ ...siteForm, address: e.target.value })}
                placeholder="Direccion completa"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Tiempo de Viaje (min)</Label>
                <Input
                  type="number"
                  value={siteForm.travel_time_minutes}
                  onChange={(e) => setSiteForm({ ...siteForm, travel_time_minutes: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Tiempo de Descarga (min)</Label>
                <Input
                  type="number"
                  value={siteForm.unload_time_minutes}
                  onChange={(e) => setSiteForm({ ...siteForm, unload_time_minutes: e.target.value })}
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <Label>Requiere Bomba</Label>
              <Switch
                checked={siteForm.requires_pump}
                onCheckedChange={(checked) => setSiteForm({ ...siteForm, requires_pump: checked })}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Horario Desde</Label>
                <Input
                  type="time"
                  value={siteForm.reception_hours_start}
                  onChange={(e) => setSiteForm({ ...siteForm, reception_hours_start: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Horario Hasta</Label>
                <Input
                  type="time"
                  value={siteForm.reception_hours_end}
                  onChange={(e) => setSiteForm({ ...siteForm, reception_hours_end: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Contacto en Obra</Label>
                <Input
                  value={siteForm.site_contact}
                  onChange={(e) => setSiteForm({ ...siteForm, site_contact: e.target.value })}
                  placeholder="Nombre"
                />
              </div>
              <div className="space-y-2">
                <Label>Telefono Obra</Label>
                <Input
                  value={siteForm.site_phone}
                  onChange={(e) => setSiteForm({ ...siteForm, site_phone: e.target.value })}
                  placeholder="Telefono"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Observaciones</Label>
              <Textarea
                value={siteForm.observations}
                onChange={(e) => setSiteForm({ ...siteForm, observations: e.target.value })}
                placeholder="Indicaciones especiales de acceso, restricciones, etc."
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsSiteDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSaveSite} disabled={!siteForm.name}>
              {editingSite ? "Guardar" : "Crear"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Client Confirmation */}
      <AlertDialog open={!!deleteClientConfirm} onOpenChange={(open) => { if (!open) { setDeleteClientConfirm(null); setDeleteClientStep(1); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteClientStep === 1 ? "Eliminar Cliente" : "Confirmar Eliminacion"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteClientStep === 1 ? (
                <>
                  Esta seguro que desea eliminar al cliente <strong>{deleteClientConfirm?.name}</strong>?
                  {(deleteClientConfirm?.construction_sites?.length || 0) > 0 && (
                    <span className="block mt-2 text-destructive font-medium">
                      Esto tambien eliminara {deleteClientConfirm?.construction_sites?.length} obra(s) asociada(s).
                    </span>
                  )}
                </>
              ) : (
                <span className="text-destructive font-medium">
                  Esta accion no se puede deshacer. Todos los datos del cliente y sus obras seran eliminados permanentemente.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setDeleteClientConfirm(null); setDeleteClientStep(1); }}>
              Cancelar
            </AlertDialogCancel>
            <Button 
              variant="destructive" 
              onClick={(e) => {
                e.preventDefault()
                console.log("[v0] Delete button clicked, step:", deleteClientStep)
                confirmDeleteClient()
              }}
            >
              {deleteClientStep === 1 ? "Continuar" : "Si, Eliminar"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Site Confirmation */}
      <AlertDialog open={!!deleteSiteConfirm} onOpenChange={(open) => { if (!open) { setDeleteSiteConfirm(null); setDeleteSiteStep(1); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteSiteStep === 1 ? "Eliminar Obra" : "Confirmar Eliminacion"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteSiteStep === 1 ? (
                <>Esta seguro que desea eliminar la obra <strong>{deleteSiteConfirm?.name}</strong>?</>
              ) : (
                <span className="text-destructive font-medium">
                  Esta accion no se puede deshacer. Todos los datos de la obra seran eliminados permanentemente.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setDeleteSiteConfirm(null); setDeleteSiteStep(1); }}>
              Cancelar
            </AlertDialogCancel>
            <Button 
              variant="destructive" 
              onClick={(e) => {
                e.preventDefault()
                confirmDeleteSite()
              }}
            >
              {deleteSiteStep === 1 ? "Continuar" : "Si, Eliminar"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
