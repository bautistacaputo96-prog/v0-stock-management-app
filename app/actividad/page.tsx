"use client"

import { useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import Link from "next/link"
import { esGerencial } from "@/lib/current-user"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Loader2, ShieldAlert, Download, RefreshCw } from "lucide-react"

type LogRow = {
  id: string
  user_name: string
  action: string
  entity: string
  reference: string | null
  details: Record<string, unknown> | null
  created_at: string
}

const ACTION_STYLE: Record<string, string> = {
  crear: "bg-emerald-100 text-emerald-800 border-emerald-300",
  editar: "bg-amber-100 text-amber-800 border-amber-300",
  borrar: "bg-red-100 text-red-800 border-red-300",
  transferir: "bg-sky-100 text-sky-800 border-sky-300",
}

// Nombres del filtro "Tipo" (fase 0c-1). Los que aparezcan en los datos y no estén acá se muestran con su clave.
const ENTIDADES: Record<string, string> = {
  despacho: "Despachos",
  pedido: "Pedidos programados",
  ingreso: "Ingresos",
  stock: "Recuentos y ajustes de stock",
  humedad: "Humedad del acopio",
  material: "Materiales",
  proveedor: "Proveedores",
  transportista: "Transportistas",
  probeta: "Probetas",
  granulometria: "Granulometrías",
  calibracion: "Calibración de la prensa",
  cliente: "Clientes",
  obra: "Obras",
  formula: "Fórmulas",
  camion: "Camiones",
  chofer: "Choferes",
  bomba: "Empresas de bombeo",
  planta: "Tiempos de planta",
  orden_trabajo: "Órdenes de trabajo",
  usuario: "Usuarios",
}

export default function ActividadPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [rows, setRows] = useState<LogRow[]>([])
  const [loading, setLoading] = useState(true)
  const [userFilter, setUserFilter] = useState("all")
  const [actionFilter, setActionFilter] = useState("all")
  const [entityFilter, setEntityFilter] = useState("all")
  const [search, setSearch] = useState("")

  useEffect(() => {
    setAllowed(esGerencial())
  }, [])

  useEffect(() => {
    if (allowed) load()
  }, [allowed])

  async function load() {
    setLoading(true)
    const supabase = createClient()
    const { data } = await supabase
      .from("activity_log")
      .select("id, user_name, action, entity, reference, details, created_at")
      .order("created_at", { ascending: false })
      .limit(1000)
    setRows(data || [])
    setLoading(false)
  }

  const usuarios = useMemo(
    () => Array.from(new Set(rows.map((r) => r.user_name))).sort(),
    [rows],
  )

  // Todos los del mapa más los raros que haya en los datos (formula, test_cylinders, maint_tasks...)
  const entidades = useMemo(
    () => [...Object.keys(ENTIDADES), ...Array.from(new Set(rows.map((r) => r.entity))).filter((e) => !(e in ENTIDADES)).sort()],
    [rows],
  )

  const filtered = rows.filter((r) => {
    if (userFilter !== "all" && r.user_name !== userFilter) return false
    if (actionFilter !== "all" && r.action !== actionFilter) return false
    if (entityFilter !== "all" && r.entity !== entityFilter) return false
    const term = search.trim().toLowerCase()
    if (!term) return true
    return [r.user_name, r.entity, r.reference, JSON.stringify(r.details)]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(term))
  })

  async function exportar() {
    const XLSX = await import("xlsx")
    const data = filtered.map((r) => ({
      Fecha: new Date(r.created_at).toLocaleString("es-AR"),
      Usuario: r.user_name,
      Accion: r.action,
      Registro: ENTIDADES[r.entity] || r.entity,
      Referencia: r.reference || "-",
      Detalle: r.details
        ? Object.entries(r.details).map(([k, v]) => `${k}: ${v}`).join(" · ")
        : "",
    }))
    const ws = XLSX.utils.json_to_sheet(data)
    ws["!cols"] = [{ wch: 18 }, { wch: 22 }, { wch: 10 }, { wch: 22 }, { wch: 14 }, { wch: 60 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Actividad")
    XLSX.writeFile(wb, `actividad_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  if (allowed === null) return null

  if (!allowed) {
    return (
      <div className="py-10 px-6">
        <Card className="max-w-md mx-auto">
          <CardContent className="pt-6 text-center space-y-2">
            <ShieldAlert className="h-10 w-10 mx-auto text-muted-foreground" />
            <p className="font-medium">Sección restringida</p>
            <p className="text-sm text-muted-foreground">
              El registro de actividad es solo para gerenciales.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="py-4 px-4 md:py-6 md:px-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight">Actividad</h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">
            Quién cargó, editó o eliminó cada registro
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Actualizar
          </Button>
          <Button size="sm" onClick={exportar} className="gap-2" disabled={filtered.length === 0}>
            <Download className="h-4 w-4" />
            Excel
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        El interruptor de funciones nuevas se maneja desde <Link href="/usuarios" className="underline">Usuarios</Link>.
      </p>

      <div className="flex flex-wrap gap-2">
        <Select value={userFilter} onValueChange={setUserFilter}>
          <SelectTrigger className="w-[190px]"><SelectValue placeholder="Usuario" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los usuarios</SelectItem>
            {usuarios.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={actionFilter} onValueChange={setActionFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Acción" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toda acción</SelectItem>
            <SelectItem value="crear">Creados</SelectItem>
            <SelectItem value="editar">Editados</SelectItem>
            <SelectItem value="borrar">Eliminados</SelectItem>
            <SelectItem value="transferir">Transferencias</SelectItem>
          </SelectContent>
        </Select>
        <Select value={entityFilter} onValueChange={setEntityFilter}>
          <SelectTrigger className="w-[190px]"><SelectValue placeholder="Tipo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todo tipo</SelectItem>
            {entidades.map((e) => <SelectItem key={e} value={e}>{ENTIDADES[e] || e}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input
          placeholder="Buscar remito, material..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-[220px]"
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">
            {filtered.length} movimiento{filtered.length === 1 ? "" : "s"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Table containerClassName="max-h-[600px] overflow-auto">
              <TableHeader className="sticky top-0 z-20 bg-card">
                <TableRow>
                  <TableHead className="w-[150px]">Fecha</TableHead>
                  <TableHead>Usuario</TableHead>
                  <TableHead className="w-[100px]">Acción</TableHead>
                  <TableHead>Registro</TableHead>
                  <TableHead>Referencia</TableHead>
                  <TableHead>Detalle</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                      Sin movimientos registrados todavía
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs font-mono whitespace-nowrap">
                        {new Date(r.created_at).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </TableCell>
                      <TableCell className="font-medium">{r.user_name}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={ACTION_STYLE[r.action] || ""}>
                          {r.action}
                        </Badge>
                      </TableCell>
                      <TableCell>{ENTIDADES[r.entity] || r.entity}</TableCell>
                      <TableCell className="font-mono text-sm">{r.reference || "-"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[380px]">
                        {r.details
                          ? Object.entries(r.details)
                              .map(([k, v]) => `${k}: ${v}`)
                              .join(" · ")
                          : "-"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
