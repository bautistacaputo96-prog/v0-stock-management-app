"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Save, FileText, Eye } from "lucide-react"

interface Equipment {
  id: number
  nombre: string
  horometro_actual: number
  status: string
}

interface ItemState {
  equipment_id: number
  nombre: string
  horometro_inicial: string
  horometro_final: string
  combustible_lts: string
  aceite_lts: string
  status: string
  observaciones: string
}

interface HistoryItem {
  id: number
  equipment_id: number
  horometro_inicial: number | null
  horometro_final: number | null
  horas_trabajadas: number | null
  combustible_lts: number
  aceite_lts: number
  status: string
  observaciones: string | null
  equipment?: { nombre: string }
}

interface HistoryParte {
  id: number
  fecha: string
  creado_por: string | null
  observaciones: string | null
  items: HistoryItem[]
}

interface OperationalParteModuleProps {
  plant: string
}

const STATUS_LABELS: Record<string, string> = {
  operativo: "Operativo",
  fuera_servicio: "Fuera de servicio",
  no_opera: "No operó hoy",
}

export function OperationalParteModule({ plant }: OperationalParteModuleProps) {
  const [autoelevadores, setAutoelevadores] = useState<Equipment[]>([])
  const [items, setItems] = useState<ItemState[]>([])
  const [fecha, setFecha] = useState(new Date().toISOString().split("T")[0])
  const [creadoPor, setCreadoPor] = useState("")
  const [observaciones, setObservaciones] = useState("")
  const [saving, setSaving] = useState(false)
  const [history, setHistory] = useState<HistoryParte[]>([])
  const [loading, setLoading] = useState(true)
  const [viewParte, setViewParte] = useState<HistoryParte | null>(null)

  const supabase = createClient()

  useEffect(() => { loadData() }, [plant])

  useEffect(() => {
    if (autoelevadores.length > 0) {
      setItems(autoelevadores.map(eq => ({
        equipment_id: eq.id,
        nombre: eq.nombre,
        horometro_inicial: eq.horometro_actual.toString(),
        horometro_final: eq.horometro_actual.toString(),
        combustible_lts: "0",
        aceite_lts: "0",
        status: eq.status === "activo" ? "operativo" : "fuera_servicio",
        observaciones: "",
      })))
    }
  }, [autoelevadores])

  async function loadData() {
    setLoading(true)
    const [{ data: equips }, { data: hist }] = await Promise.all([
      supabase
        .from("maintenance_equipment")
        .select("id, nombre, horometro_actual, status")
        .eq("plant", plant)
        .eq("tipo", "autoelevador")
        .neq("status", "baja")
        .order("nombre"),
      supabase
        .from("maintenance_operational_parte")
        .select(`
          *,
          items:maintenance_operational_items(
            *,
            equipment:maintenance_equipment(nombre)
          )
        `)
        .eq("plant", plant)
        .order("fecha", { ascending: false })
        .limit(30),
    ])
    setAutoelevadores(equips || [])
    setHistory(hist || [])
    setLoading(false)
  }

  function updateItem(idx: number, field: keyof ItemState, value: string) {
    setItems(prev => {
      const updated = [...prev]
      updated[idx] = { ...updated[idx], [field]: value }
      return updated
    })
  }

  function horasTrabajadas(item: ItemState): number {
    const ini = parseFloat(item.horometro_inicial) || 0
    const fin = parseFloat(item.horometro_final) || 0
    return Math.max(0, fin - ini)
  }

  async function handleSave() {
    if (!creadoPor.trim()) {
      alert("Ingresá el nombre de quien carga el parte")
      return
    }
    setSaving(true)
    try {
      const { data: parte, error } = await supabase
        .from("maintenance_operational_parte")
        .insert({ plant, fecha, creado_por: creadoPor, observaciones: observaciones || null })
        .select()
        .single()
      if (error) throw error

      await supabase.from("maintenance_operational_items").insert(
        items.map(item => ({
          parte_id: parte.id,
          equipment_id: item.equipment_id,
          horometro_inicial: parseFloat(item.horometro_inicial) || null,
          horometro_final: parseFloat(item.horometro_final) || null,
          horas_trabajadas: horasTrabajadas(item),
          combustible_lts: parseFloat(item.combustible_lts) || 0,
          aceite_lts: parseFloat(item.aceite_lts) || 0,
          status: item.status,
          observaciones: item.observaciones || null,
        }))
      )

      // Update each equipment's current hour meter
      for (const item of items) {
        const fin = parseFloat(item.horometro_final)
        if (!isNaN(fin) && fin > 0) {
          await supabase
            .from("maintenance_equipment")
            .update({ horometro_actual: fin, fecha_ultimo_horometro: fecha })
            .eq("id", item.equipment_id)
        }
      }

      setCreadoPor("")
      setObservaciones("")
      loadData()
      alert("Parte guardado correctamente")
    } catch (err) {
      console.error(err)
      alert("Error al guardar el parte")
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Card><CardContent className="py-10 text-center text-muted-foreground">Cargando...</CardContent></Card>

  if (autoelevadores.length === 0) return (
    <Card>
      <CardContent className="py-10 text-center text-muted-foreground">
        <FileText className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p>No hay autoelevadores en esta planta.</p>
        <p className="text-xs mt-1">Cargalos en la pestaña "Equipos".</p>
      </CardContent>
    </Card>
  )

  const totalHoras = items.reduce((s, i) => s + horasTrabajadas(i), 0)
  const totalCombustible = items.reduce((s, i) => s + (parseFloat(i.combustible_lts) || 0), 0)
  const operativos = items.filter(i => i.status === "operativo").length

  return (
    <div className="space-y-4">
      {/* Form */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Parte Operativo — Autoelevadores
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Header fields */}
          <div className="flex flex-wrap gap-3">
            <div className="space-y-1">
              <Label>Fecha</Label>
              <Input type="date" value={fecha} onChange={e => setFecha(e.target.value)} className="w-40" />
            </div>
            <div className="space-y-1 min-w-[180px] flex-1">
              <Label>Cargado por *</Label>
              <Input value={creadoPor} onChange={e => setCreadoPor(e.target.value)} placeholder="Nombre" />
            </div>
            <div className="space-y-1 min-w-[220px] flex-1">
              <Label>Observaciones generales</Label>
              <Input value={observaciones} onChange={e => setObservaciones(e.target.value)} placeholder="Opcional" />
            </div>
          </div>

          {/* Grid */}
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="min-w-[140px]">Equipo</TableHead>
                  <TableHead className="text-right min-w-[110px]">Hs. Inicial</TableHead>
                  <TableHead className="text-right min-w-[110px]">Hs. Final</TableHead>
                  <TableHead className="text-right min-w-[110px]">Hs. Trabajadas</TableHead>
                  <TableHead className="text-right min-w-[120px]">Combustible (lts)</TableHead>
                  <TableHead className="text-right min-w-[110px]">Aceite (lts)</TableHead>
                  <TableHead className="min-w-[150px]">Estado</TableHead>
                  <TableHead className="min-w-[150px]">Observaciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item, idx) => (
                  <TableRow key={item.equipment_id}>
                    <TableCell className="font-medium">{item.nombre}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        className="w-24 text-right h-8 text-sm"
                        value={item.horometro_inicial}
                        onChange={e => updateItem(idx, "horometro_inicial", e.target.value)}
                        step="0.1"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        className="w-24 text-right h-8 text-sm"
                        value={item.horometro_final}
                        onChange={e => updateItem(idx, "horometro_final", e.target.value)}
                        step="0.1"
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="font-mono font-semibold text-sm">
                        {horasTrabajadas(item).toFixed(1)} hs
                      </span>
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        className="w-20 text-right h-8 text-sm"
                        value={item.combustible_lts}
                        onChange={e => updateItem(idx, "combustible_lts", e.target.value)}
                        min="0"
                        step="0.1"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        className="w-20 text-right h-8 text-sm"
                        value={item.aceite_lts}
                        onChange={e => updateItem(idx, "aceite_lts", e.target.value)}
                        min="0"
                        step="0.1"
                      />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={item.status}
                        onValueChange={v => updateItem(idx, "status", v)}
                      >
                        <SelectTrigger className="h-8 text-xs w-36">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="operativo">Operativo</SelectItem>
                          <SelectItem value="fuera_servicio">Fuera de servicio</SelectItem>
                          <SelectItem value="no_opera">No operó hoy</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input
                        className="h-8 text-xs w-36"
                        value={item.observaciones}
                        onChange={e => updateItem(idx, "observaciones", e.target.value)}
                        placeholder="Opcional"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Summary */}
          <div className="flex flex-wrap gap-6 px-3 py-2 bg-muted/20 rounded-lg text-sm">
            <div>
              <span className="text-muted-foreground">Total hs: </span>
              <span className="font-bold">{totalHoras.toFixed(1)} hs</span>
            </div>
            <div>
              <span className="text-muted-foreground">Combustible: </span>
              <span className="font-bold">{totalCombustible.toFixed(1)} lts</span>
            </div>
            <div>
              <span className="text-muted-foreground">Operativos: </span>
              <span className="font-bold">{operativos}/{items.length}</span>
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={saving}>
              <Save className="h-4 w-4 mr-2" />
              {saving ? "Guardando..." : "Guardar Parte"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* History */}
      {history.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-muted-foreground font-medium">Historial de partes operativos</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Cargado por</TableHead>
                  <TableHead className="text-center">Equipos</TableHead>
                  <TableHead className="text-right">Total hs</TableHead>
                  <TableHead className="text-right">Combustible</TableHead>
                  <TableHead className="text-center">Ver</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map(h => (
                  <TableRow key={h.id}>
                    <TableCell className="font-medium">
                      {new Date(h.fecha + "T12:00:00").toLocaleDateString("es-AR")}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{h.creado_por || "—"}</TableCell>
                    <TableCell className="text-center">{h.items?.length || 0}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {(h.items?.reduce((s, i) => s + (i.horas_trabajadas || 0), 0) || 0).toFixed(1)} hs
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {(h.items?.reduce((s, i) => s + (i.combustible_lts || 0), 0) || 0).toFixed(1)} lts
                    </TableCell>
                    <TableCell className="text-center">
                      <Button variant="ghost" size="icon" onClick={() => setViewParte(h)}>
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* View Detail Dialog */}
      <Dialog open={!!viewParte} onOpenChange={v => !v && setViewParte(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Parte Operativo — {viewParte && new Date(viewParte.fecha + "T12:00:00").toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" })}
            </DialogTitle>
          </DialogHeader>
          {viewParte && (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">
                Cargado por: <strong className="text-foreground">{viewParte.creado_por || "—"}</strong>
                {viewParte.observaciones && <span> · {viewParte.observaciones}</span>}
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Equipo</TableHead>
                    <TableHead className="text-right">Hs. Ini.</TableHead>
                    <TableHead className="text-right">Hs. Fin.</TableHead>
                    <TableHead className="text-right">Hs. Trab.</TableHead>
                    <TableHead className="text-right">Comb. (lts)</TableHead>
                    <TableHead className="text-right">Aceite (lts)</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {viewParte.items?.map(item => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.equipment?.nombre || "—"}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{item.horometro_inicial ?? "—"}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{item.horometro_final ?? "—"}</TableCell>
                      <TableCell className="text-right font-mono font-semibold text-sm">{item.horas_trabajadas?.toFixed(1) ?? "—"}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{item.combustible_lts}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{item.aceite_lts}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{STATUS_LABELS[item.status] || item.status}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
