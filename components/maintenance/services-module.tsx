"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, Wrench, Settings } from "lucide-react"

interface ServiceProgram {
  id: number
  equipment_id: number
  nombre: string
  intervalo_horas: number | null
  intervalo_meses: number | null
  modo: string
}

interface ServiceRecord {
  id: number
  equipment_id: number
  program_id: number | null
  fecha: string
  horometro_al_momento: number | null
  notas: string | null
  realizado_por: string | null
}

interface EquipmentWithService {
  id: number
  nombre: string
  tipo: string
  marca: string | null
  modelo: string | null
  horometro_actual: number
  status: string
  programs: ServiceProgram[]
  lastService: ServiceRecord | null
}

interface ServicesModuleProps {
  plant: string
}

type StatusColor = "green" | "yellow" | "red" | "gray"

function calcStatus(eq: EquipmentWithService): { color: StatusColor; badge: string; detail: string } {
  const prog = eq.programs[0]
  if (!prog) return { color: "gray", badge: "SIN PROGRAMA", detail: "Configurar programa de service" }

  const last = eq.lastService
  const results: { color: StatusColor; badge: string; detail: string }[] = []

  // Hours check
  if ((prog.modo === "horas" || prog.modo === "primero") && prog.intervalo_horas) {
    const lastHs = last?.horometro_al_momento ?? 0
    const nextHs = lastHs + prog.intervalo_horas
    const remaining = nextHs - eq.horometro_actual
    const pct = remaining / prog.intervalo_horas
    if (remaining <= 0)
      results.push({ color: "red", badge: "VENCIDO", detail: `${Math.abs(Math.round(remaining))} hs vencido` })
    else if (pct <= 0.15)
      results.push({ color: "yellow", badge: "PRÓXIMO", detail: `Faltan ${Math.round(remaining)} hs` })
    else
      results.push({ color: "green", badge: "OK", detail: `Faltan ${Math.round(remaining)} hs` })
  }

  // Time check
  if ((prog.modo === "tiempo" || prog.modo === "primero") && prog.intervalo_meses) {
    const baseDate = last?.fecha ? new Date(last.fecha + "T12:00:00") : null
    if (baseDate) {
      const nextDate = new Date(baseDate)
      nextDate.setMonth(nextDate.getMonth() + prog.intervalo_meses)
      const today = new Date()
      const diffDays = Math.round((nextDate.getTime() - today.getTime()) / 86400000)
      if (diffDays <= 0)
        results.push({ color: "red", badge: "VENCIDO", detail: `${Math.abs(diffDays)} días vencido` })
      else if (diffDays <= 15)
        results.push({ color: "yellow", badge: "PRÓXIMO", detail: `En ${diffDays} días` })
      else
        results.push({ color: "green", badge: "OK", detail: `${nextDate.toLocaleDateString("es-AR")}` })
    } else {
      results.push({ color: "yellow", badge: "SIN SERVICE", detail: "Sin registro previo" })
    }
  }

  if (results.length === 0) {
    if (!last) return { color: "yellow", badge: "SIN SERVICE", detail: "Sin service registrado" }
    return { color: "gray", badge: "SIN PROGRAMA", detail: "Configurar programa" }
  }

  // Return the worst status (red > yellow > green > gray)
  const priority: StatusColor[] = ["red", "yellow", "green", "gray"]
  results.sort((a, b) => priority.indexOf(a.color) - priority.indexOf(b.color))
  return results[0]
}

const BADGE_STYLES: Record<StatusColor, string> = {
  red: "bg-red-500 text-white",
  yellow: "bg-yellow-400 text-yellow-900",
  green: "bg-green-500 text-white",
  gray: "bg-gray-200 text-gray-600",
}

const TIPO_LABELS: Record<string, string> = {
  autoelevador: "Autoelevador",
  pala: "Pala",
  compresor: "Compresor",
  generador: "Generador",
  otro: "Otro",
}

export function ServicesModule({ plant }: ServicesModuleProps) {
  const [equipment, setEquipment] = useState<EquipmentWithService[]>([])
  const [loading, setLoading] = useState(true)

  // Register service dialog
  const [showRegister, setShowRegister] = useState(false)
  const [selectedEquip, setSelectedEquip] = useState<EquipmentWithService | null>(null)
  const [serviceForm, setServiceForm] = useState({
    fecha: new Date().toISOString().split("T")[0],
    horometro: "",
    realizado_por: "",
    notas: "",
  })
  const [savingService, setSavingService] = useState(false)

  // Add program dialog
  const [showAddProgram, setShowAddProgram] = useState(false)
  const [programEquip, setProgramEquip] = useState<EquipmentWithService | null>(null)
  const [programForm, setProgramForm] = useState({
    nombre: "Service",
    modo: "horas",
    intervalo_horas: "",
    intervalo_meses: "",
  })

  const supabase = createClient()

  useEffect(() => { loadData() }, [plant])

  async function loadData() {
    setLoading(true)
    const { data: equips } = await supabase
      .from("maintenance_equipment")
      .select("*")
      .eq("plant", plant)
      .neq("status", "baja")
      .order("tipo").order("nombre")

    if (!equips || equips.length === 0) { setEquipment([]); setLoading(false); return }

    const ids = equips.map(e => e.id)
    const [{ data: programs }, { data: records }] = await Promise.all([
      supabase.from("maintenance_service_programs").select("*").in("equipment_id", ids),
      supabase.from("maintenance_service_records").select("*").in("equipment_id", ids).order("fecha", { ascending: false }),
    ])

    const enriched: EquipmentWithService[] = equips.map(eq => ({
      ...eq,
      programs: programs?.filter(p => p.equipment_id === eq.id) || [],
      lastService: records?.find(r => r.equipment_id === eq.id) || null,
    }))

    // Sort: red first, then yellow, then green
    const priority: StatusColor[] = ["red", "yellow", "green", "gray"]
    enriched.sort((a, b) => {
      const sa = calcStatus(a).color
      const sb = calcStatus(b).color
      return priority.indexOf(sa) - priority.indexOf(sb)
    })

    setEquipment(enriched)
    setLoading(false)
  }

  function openRegister(eq: EquipmentWithService) {
    setSelectedEquip(eq)
    setServiceForm({
      fecha: new Date().toISOString().split("T")[0],
      horometro: eq.horometro_actual.toString(),
      realizado_por: "",
      notas: "",
    })
    setShowRegister(true)
  }

  async function handleRegisterService() {
    if (!selectedEquip) return
    setSavingService(true)
    try {
      await supabase.from("maintenance_service_records").insert({
        equipment_id: selectedEquip.id,
        program_id: selectedEquip.programs[0]?.id || null,
        fecha: serviceForm.fecha,
        horometro_al_momento: parseFloat(serviceForm.horometro) || selectedEquip.horometro_actual,
        notas: serviceForm.notas || null,
        realizado_por: serviceForm.realizado_por || null,
      })
      setShowRegister(false)
      loadData()
    } finally {
      setSavingService(false)
    }
  }

  async function handleAddProgram() {
    if (!programEquip || !programForm.nombre.trim()) return
    await supabase.from("maintenance_service_programs").insert({
      equipment_id: programEquip.id,
      nombre: programForm.nombre,
      modo: programForm.modo,
      intervalo_horas: programForm.intervalo_horas ? parseInt(programForm.intervalo_horas) : null,
      intervalo_meses: programForm.intervalo_meses ? parseInt(programForm.intervalo_meses) : null,
    })
    setShowAddProgram(false)
    setProgramForm({ nombre: "Service", modo: "horas", intervalo_horas: "", intervalo_meses: "" })
    loadData()
  }

  if (loading) return <Card><CardContent className="py-10 text-center text-muted-foreground">Cargando services...</CardContent></Card>
  if (equipment.length === 0) return (
    <Card><CardContent className="py-10 text-center text-muted-foreground">
      No hay equipos cargados. Primero cargalos en la pestaña "Equipos".
    </CardContent></Card>
  )

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5" />
            Seguimiento de Services
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Equipo</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Horómetro actual</TableHead>
                  <TableHead>Programa</TableHead>
                  <TableHead>Último service</TableHead>
                  <TableHead>Próximo service</TableHead>
                  <TableHead className="text-center">Estado</TableHead>
                  <TableHead className="text-center">Acción</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {equipment.map(eq => {
                  const prog = eq.programs[0]
                  const last = eq.lastService
                  const status = calcStatus(eq)

                  const nextHs = prog?.intervalo_horas != null
                    ? (last?.horometro_al_momento ?? 0) + prog.intervalo_horas
                    : null

                  return (
                    <TableRow key={eq.id}>
                      <TableCell className="font-semibold">{eq.nombre}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{TIPO_LABELS[eq.tipo] || eq.tipo}</TableCell>
                      <TableCell className="text-right font-mono text-sm font-medium">
                        {eq.horometro_actual.toLocaleString("es-AR")} hs
                      </TableCell>
                      <TableCell className="text-sm">
                        {prog ? (
                          <div className="text-muted-foreground">
                            <div className="font-medium text-foreground">{prog.nombre}</div>
                            <div className="text-xs">
                              {prog.intervalo_horas && `c/ ${prog.intervalo_horas} hs`}
                              {prog.intervalo_horas && prog.intervalo_meses && " · "}
                              {prog.intervalo_meses && `c/ ${prog.intervalo_meses} meses`}
                            </div>
                          </div>
                        ) : (
                          <button
                            className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                            onClick={() => { setProgramEquip(eq); setShowAddProgram(true) }}
                          >
                            <Settings className="h-3 w-3" /> Configurar
                          </button>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {last ? (
                          <div>
                            <div>{new Date(last.fecha + "T12:00:00").toLocaleDateString("es-AR")}</div>
                            {last.horometro_al_momento != null && (
                              <div className="text-xs text-muted-foreground">{last.horometro_al_momento.toLocaleString("es-AR")} hs</div>
                            )}
                            {last.realizado_por && <div className="text-xs text-muted-foreground">{last.realizado_por}</div>}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">Sin registro</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm font-mono">
                        {nextHs != null ? (
                          <span>{nextHs.toLocaleString("es-AR")} hs</span>
                        ) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex flex-col items-center gap-0.5">
                          <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-bold ${BADGE_STYLES[status.color]}`}>
                            {status.badge}
                          </span>
                          <span className="text-xs text-muted-foreground">{status.detail}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Button size="sm" variant="outline" onClick={() => openRegister(eq)}>
                          <Plus className="h-3.5 w-3.5 mr-1" /> Registrar
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Register Service Dialog */}
      <Dialog open={showRegister} onOpenChange={setShowRegister}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Registrar Service — {selectedEquip?.nombre}</DialogTitle>
          </DialogHeader>
          {selectedEquip?.lastService && (
            <div className="p-3 bg-muted/30 rounded-lg text-sm space-y-0.5">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Último service registrado</p>
              <p className="font-medium">{new Date(selectedEquip.lastService.fecha + "T12:00:00").toLocaleDateString("es-AR")}</p>
              {selectedEquip.lastService.horometro_al_momento != null && (
                <p className="text-muted-foreground">{selectedEquip.lastService.horometro_al_momento.toLocaleString("es-AR")} hs</p>
              )}
              {selectedEquip.lastService.notas && (
                <p className="text-muted-foreground text-xs">{selectedEquip.lastService.notas}</p>
              )}
            </div>
          )}
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Fecha *</Label>
                <Input type="date" value={serviceForm.fecha} onChange={e => setServiceForm({ ...serviceForm, fecha: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>Horómetro (hs)</Label>
                <Input
                  type="number"
                  value={serviceForm.horometro}
                  onChange={e => setServiceForm({ ...serviceForm, horometro: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Realizado por</Label>
              <Input
                value={serviceForm.realizado_por}
                onChange={e => setServiceForm({ ...serviceForm, realizado_por: e.target.value })}
                placeholder="Nombre del técnico"
              />
            </div>
            <div className="space-y-1">
              <Label>Notas / Trabajos realizados</Label>
              <Textarea
                rows={3}
                value={serviceForm.notas}
                onChange={e => setServiceForm({ ...serviceForm, notas: e.target.value })}
                placeholder="Cambio de aceite, filtros, observaciones..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRegister(false)}>Cancelar</Button>
            <Button onClick={handleRegisterService} disabled={savingService}>
              {savingService ? "Guardando..." : "Guardar Service"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Program Dialog */}
      <Dialog open={showAddProgram} onOpenChange={setShowAddProgram}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Configurar programa — {programEquip?.nombre}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>Nombre del programa *</Label>
              <Input
                value={programForm.nombre}
                onChange={e => setProgramForm({ ...programForm, nombre: e.target.value })}
                placeholder="M1, Service 250hs, Service anual..."
              />
            </div>
            <div className="space-y-1">
              <Label>Modalidad</Label>
              <Select value={programForm.modo} onValueChange={v => setProgramForm({ ...programForm, modo: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="horas">Por horas de uso</SelectItem>
                  <SelectItem value="tiempo">Por tiempo (meses)</SelectItem>
                  <SelectItem value="primero">Lo que ocurra primero</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(programForm.modo === "horas" || programForm.modo === "primero") && (
              <div className="space-y-1">
                <Label>Intervalo en horas</Label>
                <Input
                  type="number"
                  value={programForm.intervalo_horas}
                  onChange={e => setProgramForm({ ...programForm, intervalo_horas: e.target.value })}
                  placeholder="250"
                />
              </div>
            )}
            {(programForm.modo === "tiempo" || programForm.modo === "primero") && (
              <div className="space-y-1">
                <Label>Intervalo en meses</Label>
                <Input
                  type="number"
                  value={programForm.intervalo_meses}
                  onChange={e => setProgramForm({ ...programForm, intervalo_meses: e.target.value })}
                  placeholder="3"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddProgram(false)}>Cancelar</Button>
            <Button onClick={handleAddProgram} disabled={!programForm.nombre.trim()}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
