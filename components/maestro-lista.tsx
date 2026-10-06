"use client"

/**
 * Lista simple con alta, edición y baja lógica (fase 1): choferes y empresas de bombeo.
 * Mismo estilo de tarjetas que la pestaña Camiones. La baja no borra: el registro queda
 * en los despachos y pedidos viejos y se puede reactivar.
 */
import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { logActivity } from "@/lib/activity-log"
import { usePermisos } from "@/lib/current-user"
import { CampoMotivo, ConfirmarConMotivo, motivoValido } from "@/components/motivo"
import { Plus, Pencil, Search, Ban, RotateCcw } from "lucide-react"
import type { LucideIcon } from "lucide-react"

type Campo = { key: string; label: string; placeholder?: string }
type Fila = { id: string; nombre: string; activo: boolean; [k: string]: any }

export function MaestroLista({
  tabla,
  entidad,
  singular,
  icono: Icono,
  campos,
  ayuda,
  femenino = false,
}: {
  tabla: "choferes" | "empresas_bombeo"
  entidad: "chofer" | "bomba"
  /** "chofer", "empresa de bombeo" */
  singular: string
  icono: LucideIcon
  /** Campos además del nombre */
  campos: Campo[]
  ayuda: string
  /** "empresa de bombeo": nueva, repetida, cargada... */
  femenino?: boolean
}) {
  const { toast } = useToast()
  const [filas, setFilas] = useState<Fila[]>([])
  const [cargando, setCargando] = useState(true)
  const [sinTabla, setSinTabla] = useState(false)
  const [busqueda, setBusqueda] = useState("")
  const [verBajas, setVerBajas] = useState(false)
  const [editando, setEditando] = useState<Fila | null>(null)
  const [abierto, setAbierto] = useState(false)
  const [form, setForm] = useState<Record<string, string>>({})
  const [baja, setBaja] = useState<Fila | null>(null)
  const [guardando, setGuardando] = useState(false)
  // Fase 0c-1: choferes y bombas = permiso "flota"; editar y dar de baja piden motivo
  const { puede } = usePermisos()
  const [motivo, setMotivo] = useState("")

  const Titulo = singular.charAt(0).toUpperCase() + singular.slice(1)
  const o = femenino ? "a" : "o"

  useEffect(() => { cargar() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function cargar() {
    const { data, error } = await createClient().from(tabla).select("*").order("nombre")
    setSinTabla(!!error)
    setFilas((data as Fila[]) || [])
    setCargando(false)
  }

  function abrir(f: Fila | null) {
    setMotivo("")
    setEditando(f)
    const v: Record<string, string> = { nombre: f?.nombre || "" }
    campos.forEach((c) => (v[c.key] = f?.[c.key] || ""))
    setForm(v)
    setAbierto(true)
  }

  async function guardar() {
    const nombre = (form.nombre || "").trim()
    if (!nombre) return
    if (editando ? !puede("flota", "editar") : !puede("flota", "cargar")) return
    if (editando && !motivoValido(motivo)) return
    const repetido = filas.find((f) => f.nombre.trim().toLowerCase() === nombre.toLowerCase() && f.id !== editando?.id)
    if (repetido) {
      toast({ title: `${Titulo} repetid${o}`, description: `${repetido.nombre} ya está cargado${repetido.activo ? "" : " (dad${o} de baja: reactival${o})"}`, variant: "destructive" })
      return
    }
    const datos: Record<string, string | null> = { nombre }
    campos.forEach((c) => (datos[c.key] = (form[c.key] || "").trim() || null))
    setGuardando(true)
    const sb = createClient()
    const { data, error } = editando
      ? await sb.from(tabla).update(datos).eq("id", editando.id).select().single()
      : await sb.from(tabla).insert(datos).select().single()
    setGuardando(false)
    if (error) {
      toast({ title: "Error", description: `No se pudo guardar: ${error.message}`, variant: "destructive" })
      return
    }
    const cambios: Record<string, string> = {}
    if (editando) {
      for (const k of ["nombre", ...campos.map((c) => c.key)]) {
        if ((editando[k] || null) !== (datos[k] || null)) cambios[campos.find((c) => c.key === k)?.label || "Nombre"] = `${editando[k] || "-"} → ${datos[k] || "-"}`
      }
    }
    logActivity({ action: editando ? "editar" : "crear", entity: entidad, entityId: (data as Fila)?.id, reference: nombre, details: editando ? { ...cambios, Motivo: motivo.trim() } : datos })
    toast({ title: editando ? `${Titulo} actualizad${o}` : `${Titulo} cargad${o}` })
    setAbierto(false)
    cargar()
  }

  async function cambiarActivo(f: Fila, activo: boolean, motivoBaja?: string) {
    if (!puede("flota", "borrar")) return
    const { error } = await createClient().from(tabla).update({ activo }).eq("id", f.id)
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" })
      return
    }
    logActivity({ action: "editar", entity: entidad, entityId: f.id, reference: f.nombre, details: { Estado: activo ? `reactivad${o}` : `dad${o} de baja`, ...(motivoBaja ? { Motivo: motivoBaja } : {}) } })
    toast({ title: activo ? `${f.nombre} reactivad${o}` : `${f.nombre} dad${o} de baja` })
    setBaja(null)
    cargar()
  }

  const visibles = filas
    .filter((f) => (verBajas ? !f.activo : f.activo))
    .filter((f) => [f.nombre, ...campos.map((c) => f[c.key])].some((v) => (v || "").toString().toLowerCase().includes(busqueda.toLowerCase())))
  const bajas = filas.filter((f) => !f.activo).length

  if (cargando) return <div className="flex items-center justify-center py-8">Cargando...</div>

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{ayuda}</p>
      {sinTabla && (
        <p className="text-sm rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-800">
          Falta aplicar la migración de la fase 1 en la base: todavía no se pueden cargar.
        </p>
      )}
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <div className="flex gap-2 items-center">
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Buscar..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} className="pl-9" />
          </div>
          {bajas > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setVerBajas(!verBajas)}>
              {verBajas ? `Ver activ${o}s` : `Ver dad${o}s de baja (${bajas})`}
            </Button>
          )}
        </div>
        {puede("flota", "cargar") && <Button onClick={() => abrir(null)} className="gap-2" disabled={sinTabla}>
          <Plus className="h-4 w-4" />
          Nuev{o} {singular}
        </Button>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {visibles.map((f) => (
          <Card key={f.id} className={f.activo ? "" : "opacity-70"}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Icono className="h-4 w-4 text-muted-foreground shrink-0" />
                  <CardTitle className="text-lg truncate">{f.nombre}</CardTitle>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {puede("flota", "editar") && <Button variant="ghost" size="sm" onClick={() => abrir(f)} title="Editar"><Pencil className="h-4 w-4" /></Button>}
                  {!puede("flota", "borrar") ? null : f.activo ? (
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setBaja(f)} title="Dar de baja"><Ban className="h-4 w-4" /></Button>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => cambiarActivo(f, true)} title="Reactivar"><RotateCcw className="h-4 w-4" /></Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {campos.map((c) => (
                <div key={c.key} className="flex items-center justify-between gap-2">
                  <span className="text-sm text-muted-foreground">{c.label}</span>
                  <span className="text-sm text-right truncate">{f[c.key] || "-"}</span>
                </div>
              ))}
              {!f.activo && <Badge variant="outline" className="text-muted-foreground">Dad{o} de baja</Badge>}
            </CardContent>
          </Card>
        ))}
      </div>

      {visibles.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          {filas.length === 0 ? `Todavía no hay ${tabla === "choferes" ? "choferes" : "empresas de bombeo"} cargad${o}s.` : "No se encontraron resultados"}
        </div>
      )}

      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editando ? `Editar ${singular}` : `Nuev${o} ${singular}`}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nombre *</Label>
              <Input value={form.nombre || ""} onChange={(e) => setForm({ ...form, nombre: e.target.value })} autoFocus />
            </div>
            {campos.map((c) => (
              <div key={c.key} className="space-y-2">
                <Label>{c.label}</Label>
                <Input value={form[c.key] || ""} onChange={(e) => setForm({ ...form, [c.key]: e.target.value })} placeholder={c.placeholder} />
              </div>
            ))}
          </div>
          {editando && <CampoMotivo value={motivo} onChange={setMotivo} id="motivo-maestro" ejemplo="Ej: el teléfono estaba mal" />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAbierto(false)}>Cancelar</Button>
            <Button onClick={guardar} disabled={!(form.nombre || "").trim() || guardando || (!!editando && !motivoValido(motivo))}>{guardando ? "Guardando..." : editando ? "Guardar" : "Crear"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmarConMotivo
        open={!!baja}
        onOpenChange={(v) => !v && setBaja(null)}
        titulo="Dar de baja"
        descripcion={`${baja?.nombre || ""} deja de aparecer en las listas. No se borra: sigue figurando en los despachos y pedidos que ya tiene, y se puede reactivar.`}
        textoBoton="Dar de baja"
        onConfirmar={async (m) => {
          if (baja) await cambiarActivo(baja, false, m)
        }}
      />
    </div>
  )
}
