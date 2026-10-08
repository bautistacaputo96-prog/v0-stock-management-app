"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Checkbox } from "@/components/ui/checkbox"
import { useToast } from "@/hooks/use-toast"
import { Plus, MoreHorizontal, Pencil, Trash2, Package, Search, Loader2 } from "lucide-react"
import { format, parseISO } from "date-fns"
import { usePermisos } from "@/lib/current-user"
import { logActivity, logCambio, logDeletion } from "@/lib/activity-log"
import { CampoMotivo, ConfirmarConMotivo, motivoValido } from "@/components/motivo"

type Supplier = {
  id: string
  name: string
  contact: string | null
  phone: string | null
  plant_id: string
  created_at: string
  materials: string[]
}

type Material = {
  id: string
  name: string
}

export function SuppliersTable({ plantId }: { plantId: string }) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null)
  const [deleteSupplier, setDeleteSupplier] = useState<Supplier | null>(null)
  const [saving, setSaving] = useState(false)
  const [formData, setFormData] = useState({
    name: "",
    contact: "",
    phone: "",
    selectedMaterials: [] as string[],
  })
  const { toast } = useToast()
  const supabase = createClient()
  // Fase 0c-1: proveedores = materia prima (cargar / editar / borrar); editar y borrar piden motivo
  const { puede } = usePermisos()
  const [motivo, setMotivo] = useState("")

  useEffect(() => {
    if (plantId) {
      loadSuppliers()
      loadMaterials()
    }
  }, [plantId])

  async function loadSuppliers() {
    setLoading(true)
    const { data, error } = await supabase
      .from("suppliers")
      .select(`
        id,
        name,
        contact,
        phone,
        plant_id,
        created_at,
        material_suppliers (
          materials (
            id,
            name
          )
        )
      `)
      .eq("plant_id", plantId)
      .order("name")

    if (data) {
      const formattedSuppliers: Supplier[] = data.map((s: any) => ({
        id: s.id,
        name: s.name,
        contact: s.contact,
        phone: s.phone,
        plant_id: s.plant_id,
        created_at: s.created_at,
        materials: s.material_suppliers?.map((ms: any) => ms.materials?.name).filter(Boolean) || [],
      }))
      setSuppliers(formattedSuppliers)
    }
    setLoading(false)
  }

  async function loadMaterials() {
    const { data } = await supabase
      .from("materials")
      .select("id, name")
      .eq("plant_id", plantId)
      .neq("name", "Agua")
      .order("name")
    setMaterials(data || [])
  }

  function resetForm() {
    setFormData({ name: "", contact: "", phone: "", selectedMaterials: [] })
  }

  function openEditDialog(supplier: Supplier) {
    setMotivo("")
    setEditingSupplier(supplier)
    // Get material IDs for this supplier
    const materialIds = materials
      .filter(m => supplier.materials.includes(m.name))
      .map(m => m.id)
    setFormData({
      name: supplier.name,
      contact: supplier.contact || "",
      phone: supplier.phone || "",
      selectedMaterials: materialIds,
    })
  }

  async function handleSave() {
    if (!formData.name.trim()) {
      toast({ title: "Error", description: "El nombre es requerido", variant: "destructive" })
      return
    }

    if (editingSupplier ? !puede("materia_prima", "editar") : !puede("materia_prima", "cargar")) return
    if (editingSupplier && !motivoValido(motivo)) {
      toast({ title: "Falta el motivo", description: "Escribí por qué se corrige el proveedor.", variant: "destructive" })
      return
    }

    setSaving(true)

    if (editingSupplier) {
      // Update supplier
      const { error } = await supabase
        .from("suppliers")
        .update({
          name: formData.name.trim(),
          contact: formData.contact.trim() || null,
          phone: formData.phone.trim() || null,
        })
        .eq("id", editingSupplier.id)

      if (error) {
        toast({ title: "Error", description: "No se pudo actualizar el proveedor", variant: "destructive" })
        setSaving(false)
        return
      }

      // Update material associations
      await supabase.from("material_suppliers").delete().eq("supplier_id", editingSupplier.id)
      
      if (formData.selectedMaterials.length > 0) {
        const materialRelations = formData.selectedMaterials.map(materialId => ({
          supplier_id: editingSupplier.id,
          material_id: materialId,
        }))
        await supabase.from("material_suppliers").insert(materialRelations)
      }

      toast({ title: "Proveedor actualizado" })
      const nombresMat = (ids: string[]) => materials.filter((m) => ids.includes(m.id)).map((m) => m.name).sort().join(", ")
      await logCambio({
        entity: "proveedor",
        entityId: editingSupplier.id,
        reference: formData.name.trim(),
        plantId,
        antes: { nombre: editingSupplier.name, contacto: editingSupplier.contact || "", telefono: editingSupplier.phone || "", materiales: [...editingSupplier.materials].sort().join(", ") },
        despues: { nombre: formData.name.trim(), contacto: formData.contact.trim(), telefono: formData.phone.trim(), materiales: nombresMat(formData.selectedMaterials) },
        etiquetas: { nombre: "Nombre", contacto: "Contacto", telefono: "Teléfono", materiales: "Materiales" },
        motivo: motivo.trim(),
      })
      setEditingSupplier(null)
    } else {
      // Create new supplier
      const { data: newSupplier, error } = await supabase
        .from("suppliers")
        .insert({
          name: formData.name.trim(),
          contact: formData.contact.trim() || null,
          phone: formData.phone.trim() || null,
          plant_id: plantId,
        })
        .select()
        .single()

      if (error) {
        toast({ title: "Error", description: "No se pudo crear el proveedor", variant: "destructive" })
        setSaving(false)
        return
      }

      // Add material associations
      if (formData.selectedMaterials.length > 0 && newSupplier) {
        const materialRelations = formData.selectedMaterials.map(materialId => ({
          supplier_id: newSupplier.id,
          material_id: materialId,
        }))
        await supabase.from("material_suppliers").insert(materialRelations)
      }

      toast({ title: "Proveedor creado" })
      logActivity({
        action: "crear",
        entity: "proveedor",
        entityId: newSupplier?.id ?? null,
        reference: formData.name.trim(),
        plantId,
        details: { Proveedor: formData.name.trim(), Contacto: formData.contact.trim() || "-", "Teléfono": formData.phone.trim() || "-" },
      })
      setIsAddOpen(false)
    }

    resetForm()
    loadSuppliers()
    setSaving(false)
  }

  async function handleDelete(motivoBorrado: string) {
    if (!deleteSupplier || !puede("materia_prima", "borrar")) return

    setSaving(true)
    
    // First delete material associations
    await supabase.from("material_suppliers").delete().eq("supplier_id", deleteSupplier.id)
    
    // Then delete supplier
    const { error } = await supabase.from("suppliers").delete().eq("id", deleteSupplier.id)

    if (error) {
      toast({ title: "Error", description: "No se pudo eliminar el proveedor", variant: "destructive" })
    } else {
      toast({ title: "Proveedor eliminado" })
      await logDeletion({
        entity: "proveedor",
        entityId: deleteSupplier.id,
        reference: deleteSupplier.name,
        plantId,
        details: { Proveedor: deleteSupplier.name, Contacto: deleteSupplier.contact || "-", "Teléfono": deleteSupplier.phone || "-", Materiales: deleteSupplier.materials.join(", ") || "-" },
        motivo: motivoBorrado,
      })
      loadSuppliers()
    }

    setDeleteSupplier(null)
    setSaving(false)
  }

  const filteredSuppliers = suppliers.filter(s =>
    s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.materials.some(m => m.toLowerCase().includes(searchTerm.toLowerCase()))
  )

  const SupplierForm = () => (
    <div className="space-y-4 py-4">
      <div className="space-y-2">
        <Label>Nombre del Proveedor *</Label>
        <Input
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder="Ej: Cementos Avellaneda"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Contacto</Label>
          <Input
            value={formData.contact}
            onChange={(e) => setFormData({ ...formData, contact: e.target.value })}
            placeholder="Nombre del contacto"
          />
        </div>
        <div className="space-y-2">
          <Label>Telefono</Label>
          <Input
            value={formData.phone}
            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            placeholder="Telefono"
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Materiales que provee</Label>
        <div className="border rounded-lg p-3 max-h-[200px] overflow-y-auto space-y-2">
          {materials.map((material) => (
            <div key={material.id} className="flex items-center space-x-2">
              <Checkbox
                id={`material-${material.id}`}
                checked={formData.selectedMaterials.includes(material.id)}
                onCheckedChange={(checked) => {
                  if (checked) {
                    setFormData({ ...formData, selectedMaterials: [...formData.selectedMaterials, material.id] })
                  } else {
                    setFormData({ ...formData, selectedMaterials: formData.selectedMaterials.filter(id => id !== material.id) })
                  }
                }}
              />
              <Label htmlFor={`material-${material.id}`} className="text-sm font-normal cursor-pointer">
                {material.name}
              </Label>
            </div>
          ))}
          {materials.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-2">No hay materiales disponibles</p>
          )}
        </div>
      </div>
    </div>
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar proveedor o material..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
        {puede("materia_prima", "cargar") && <Dialog open={isAddOpen} onOpenChange={(open) => { setIsAddOpen(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Agregar Proveedor
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Nuevo Proveedor</DialogTitle>
            </DialogHeader>
            <SupplierForm />
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAddOpen(false)}>Cancelar</Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Guardando..." : "Guardar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Proveedor</TableHead>
                <TableHead>Contacto</TableHead>
                <TableHead>Telefono</TableHead>
                <TableHead>Materiales</TableHead>
                <TableHead>Fecha Alta</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredSuppliers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    {searchTerm ? "No se encontraron proveedores" : "No hay proveedores registrados"}
                  </TableCell>
                </TableRow>
              ) : (
                filteredSuppliers.map((supplier) => (
                  <TableRow key={supplier.id}>
                    <TableCell className="font-medium">{supplier.name}</TableCell>
                    <TableCell>{supplier.contact || "-"}</TableCell>
                    <TableCell>{supplier.phone || "-"}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {supplier.materials.length > 0 ? (
                          supplier.materials.map((mat, idx) => (
                            <Badge key={idx} variant="secondary" className="text-xs">
                              {mat}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-muted-foreground text-sm">Sin materiales</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {format(parseISO(supplier.created_at), "dd/MM/yyyy")}
                    </TableCell>
                    <TableCell>
                      {(puede("materia_prima", "editar") || puede("materia_prima", "borrar")) && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {puede("materia_prima", "editar") && (
                              <DropdownMenuItem onClick={() => openEditDialog(supplier)}>
                                <Pencil className="h-4 w-4 mr-2" />
                                Editar
                              </DropdownMenuItem>
                            )}
                            {puede("materia_prima", "borrar") && (
                              <DropdownMenuItem
                                onClick={() => setDeleteSupplier(supplier)}
                                className="text-destructive focus:text-destructive"
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Eliminar
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={!!editingSupplier} onOpenChange={(open) => { if (!open) { setEditingSupplier(null); resetForm(); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Proveedor</DialogTitle>
          </DialogHeader>
          <SupplierForm />
          <CampoMotivo value={motivo} onChange={setMotivo} id="motivo-proveedor" />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditingSupplier(null); resetForm(); }}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving || !motivoValido(motivo)}>
              {saving ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Eliminar: con motivo (fase 0c-1) */}
      <ConfirmarConMotivo
        open={!!deleteSupplier}
        onOpenChange={(open) => !open && setDeleteSupplier(null)}
        titulo="Eliminar Proveedor"
        descripcion={<span>Se elimina el proveedor <strong>{deleteSupplier?.name}</strong>. Esta acción no se puede deshacer.</span>}
        textoBoton="Eliminar"
        onConfirmar={handleDelete}
      />
    </div>
  )
}
