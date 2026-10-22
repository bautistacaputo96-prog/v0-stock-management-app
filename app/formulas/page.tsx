"use client"

/**
 * Fórmulas · tabla resumen estilo planilla de Grow (docs/migracion-loop/formulas-rediseno.md).
 * Una fila por fórmula, una columna por material de la planta, panel al costado con el detalle.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { format, parseISO } from "date-fns"
import { ArrowDown, ArrowUp, Factory, Search } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { AddFormulaDialog } from "@/components/add-formula-dialog"
import { EditFormulaDialog } from "@/components/edit-formula-dialog"
import { DeleteFormulaDialog } from "@/components/delete-formula-dialog"
import { PanelFormula, type FormulaPanel } from "@/components/formulas/panel-formula"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SeccionProtegida } from "@/components/seccion-protegida"
import { usePermisos } from "@/lib/current-user"
import { cn } from "@/lib/utils"
import { cargarContexto, cargarPuesto, recetaDeFormula, type Contexto } from "@/lib/carga/datos"
import {
  RESISTENCIAS, armarMatriz, celda, contarUsos, filtrar, nombreCorto, ordenar, piedraDe, recetaContraFormula,
  type MaterialTabla, type Orden,
} from "@/lib/formulas-tabla"

const DIAS_USO = 90

export default function FormulasPage() {
  return (
    <SeccionProtegida seccion="formulas">
      <FormulasContenido />
    </SeccionProtegida>
  )
}

function Chip({ activo, apagado, onClick, children, title }: { activo: boolean; apagado?: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "h-6 rounded-full border px-2 text-[11px] leading-none transition-colors",
        activo ? "border-primary bg-primary text-primary-foreground" : "bg-card text-foreground hover:bg-muted",
        apagado && !activo && "opacity-40",
      )}
    >
      {children}
    </button>
  )
}

function FormulasContenido() {
  const supabase = createClient()
  const { puede } = usePermisos() // fase 0c-1
  const [plants, setPlants] = useState<{ id: string; name: string }[]>([])
  const [selectedPlant, setSelectedPlant] = useState("")
  const [formulas, setFormulas] = useState<FormulaPanel[]>([])
  const [materials, setMaterials] = useState<MaterialTabla[]>([])
  const [usos, setUsos] = useState<Record<string, number>>({})
  const [ctx, setCtx] = useState<Contexto | null>(null)
  const [cargando, setCargando] = useState(true)
  const plantaActual = useRef("") // para descartar respuestas de una planta que ya no está elegida

  const [texto, setTexto] = useState("")
  const [resistencia, setResistencia] = useState<string | null>(null)
  const [piedra, setPiedra] = useState<string | null>(null)
  const [metodo, setMetodo] = useState<"B" | "C" | null>(null)
  const [soloUsadas, setSoloUsadas] = useState(false)
  const [orden, setOrden] = useState<Orden>({ col: "code", asc: true })
  const [elegida, setElegida] = useState<string | null>(null)
  const [editar, setEditar] = useState<FormulaPanel | null>(null)
  const [borrar, setBorrar] = useState<FormulaPanel | null>(null)

  useEffect(() => {
    supabase.from("plants").select("id, name").order("name").then(({ data }: { data: { id: string; name: string }[] | null }) => {
      if (data?.length) {
        setPlants(data)
        setSelectedPlant(data[0].id)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!selectedPlant) return
    plantaActual.current = selectedPlant
    setElegida(null)
    setCtx(null)
    cargarTodo(selectedPlant)
    // Receta de la planta: solo si la planta tiene puesto de carga (si no, el panel no muestra nada)
    cargarPuesto(supabase, selectedPlant).then(async (p) => {
      if (!p) return
      try {
        const c = await cargarContexto(supabase, p)
        if (plantaActual.current === p.plant_id) setCtx(c)
      } catch { setCtx(null) }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlant])

  async function cargarTodo(plantId: string) {
    setCargando(true)
    const [f, m] = await Promise.all([
      supabase
        .from("formulas")
        .select("*, formula_materials ( id, quantity, materials ( id, name, unit ) )")
        .eq("plant_id", plantId)
        .order("code", { ascending: true }),
      supabase.from("materials").select("id, name, unit, tipo").eq("plant_id", plantId).order("name", { ascending: true }),
    ])
    if (plantaActual.current !== plantId) return
    const fs = (f.data || []) as FormulaPanel[]
    setFormulas(fs)
    setMaterials((m.data || []) as MaterialTabla[])
    const u = await cargarUsos(fs.map((x) => x.id))
    if (plantaActual.current !== plantId) return
    setUsos(u)
    setCargando(false)
  }

  /** Despachos de los últimos 90 días por fórmula (sin los de prueba), de a 1000 filas. */
  async function cargarUsos(ids: string[]): Promise<Record<string, number>> {
    if (!ids.length) return {}
    const desde = new Date(Date.now() - DIAS_USO * 86400000).toISOString()
    const filas: { formula_id: string | null }[] = []
    for (let i = 0; i < 50; i++) {
      const { data, error } = await supabase
        .from("dispatches")
        .select("formula_id")
        .in("formula_id", ids)
        .gte("dispatch_date", desde)
        .or("is_test_dispatch.is.null,is_test_dispatch.eq.false")
        .order("id")
        .range(i * 1000, i * 1000 + 999)
      if (error || !data) break
      filas.push(...data)
      if (data.length < 1000) break
    }
    return contarUsos(filas)
  }

  const recargar = () => selectedPlant && cargarTodo(selectedPlant)

  const matriz = useMemo(() => armarMatriz(formulas, materials, usos), [formulas, materials, usos])
  const filas = useMemo(
    () => ordenar(filtrar(matriz.filas, { texto, resistencia, piedra, metodo, soloUsadas }), orden),
    [matriz, texto, resistencia, piedra, metodo, soloUsadas, orden],
  )
  const piedras = useMemo(() => [...new Set(matriz.columnas.map(piedraDe).filter((x): x is string => !!x))], [matriz])
  const conResistencia = useMemo(() => new Set(matriz.filas.map((r) => r.leido.resistencia)), [matriz])
  const hayOtras = matriz.filas.some((r) => !r.leido.resistencia || !RESISTENCIAS.includes(r.leido.resistencia))

  const formulaElegida = formulas.find((f) => f.id === elegida) || null
  const recetaElegida = useMemo(() => {
    if (!ctx || !formulaElegida) return null
    const { numero, receta } = recetaDeFormula(ctx, formulaElegida.id)
    const fs = {
      id: formulaElegida.id,
      code: formulaElegida.code,
      materiales: (formulaElegida.formula_materials || [])
        .filter((fm) => fm.materials)
        .map((fm) => ({ material_id: fm.materials!.id, cantidad: Number(fm.quantity) || 0 })),
    }
    return recetaContraFormula(numero, receta, fs, ctx.salidas, ctx.materiales, ctx.puesto.tolerancias)
  }, [ctx, formulaElegida])

  const ordenarPor = (col: string) => setOrden((o) => (o.col === col ? { col, asc: !o.asc } : { col, asc: col === "code" }))
  const flecha = (col: string) =>
    orden.col === col ? (orden.asc ? <ArrowUp className="inline h-3 w-3" /> : <ArrowDown className="inline h-3 w-3" />) : null

  const th = "sticky top-0 z-10 h-7 cursor-pointer select-none whitespace-nowrap border-b bg-muted px-1.5 text-right text-[11px] font-normal text-muted-foreground hover:text-foreground"

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col gap-2 px-4 py-3 md:h-[calc(100vh-4rem)]">
      {/* Encabezado */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold tracking-tight">Fórmulas</h1>
        <div className="flex items-center gap-1.5">
          <Factory className="h-4 w-4 text-muted-foreground" />
          <Select value={selectedPlant} onValueChange={setSelectedPlant}>
            <SelectTrigger className="h-8 w-[140px] bg-card text-sm"><SelectValue placeholder="Planta" /></SelectTrigger>
            <SelectContent>
              {plants.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="relative w-[240px]">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar por código o nombre" value={texto} onChange={(e) => setTexto(e.target.value)} className="h-8 pl-8 text-sm" />
        </div>
        <div className="ml-auto">
          {puede("formulas", "cargar") && (
            <AddFormulaDialog materials={materials} plantId={selectedPlant} onSuccess={recargar} etiqueta="Nueva" compacto />
          )}
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-1">
        <Chip activo={!resistencia} onClick={() => setResistencia(null)}>Todas</Chip>
        {RESISTENCIAS.map((r) => (
          <Chip key={r} activo={resistencia === r} apagado={!conResistencia.has(r)} onClick={() => setResistencia(resistencia === r ? null : r)}>{r}</Chip>
        ))}
        {hayOtras && <Chip activo={resistencia === "Otras"} onClick={() => setResistencia(resistencia === "Otras" ? null : "Otras")} title="RDC y otras sin resistencia en el código">Otras</Chip>}
        <span className="mx-1 h-4 w-px bg-border" />
        {piedras.map((p) => (
          <Chip key={p} activo={piedra === p} onClick={() => setPiedra(piedra === p ? null : p)} title={`Usa piedra ${p}`}>{p}</Chip>
        ))}
        <span className="mx-1 h-4 w-px bg-border" />
        <Chip activo={metodo === "B"} onClick={() => setMetodo(metodo === "B" ? null : "B")} title="Bombeable">B</Chip>
        <Chip activo={metodo === "C"} onClick={() => setMetodo(metodo === "C" ? null : "C")} title="Común (canaleta)">C</Chip>
        <span className="mx-1 h-4 w-px bg-border" />
        <Chip activo={soloUsadas} onClick={() => setSoloUsadas(!soloUsadas)}>Solo usadas en {DIAS_USO} días</Chip>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {filas.length === matriz.filas.length ? `${filas.length} fórmulas` : `${filas.length} de ${matriz.filas.length}`}
        </span>
      </div>

      {/* Tabla + panel */}
      <div className="flex min-h-0 flex-1 gap-3">
        <div className="min-h-0 min-w-0 flex-1 overflow-auto rounded-md border bg-card">
          <table className="w-max min-w-full border-separate border-spacing-0 text-xs">
            <thead>
              <tr>
                <th onClick={() => ordenarPor("code")} className={cn(th, "left-0 z-20 min-w-[140px] border-r text-left")}>Fórmula {flecha("code")}</th>
                {matriz.columnas.map((m) => (
                  <th key={m.id} onClick={() => ordenarPor(m.id)} className={cn(th, "min-w-[52px]")} title={`${m.name} (${m.unit} por m³)`}>
                    {nombreCorto(m.name)} {flecha(m.id)}
                  </th>
                ))}
                <th onClick={() => ordenarPor("usos")} className={cn(th, "min-w-[44px]")} title={`Despachos de los últimos ${DIAS_USO} días`}>Usos {flecha("usos")}</th>
                <th onClick={() => ordenarPor("editado")} className={cn(th, "min-w-[64px] pr-2")}>Últ. edic. {flecha("editado")}</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((r) => {
                const sel = r.id === elegida
                const fondo = sel ? "bg-blue-100 dark:bg-blue-950" : "bg-card group-hover:bg-muted"
                const ed = r.editado ? (() => { try { return format(parseISO(r.editado!), "dd/MM/yy") } catch { return "—" } })() : "—"
                return (
                  <tr key={r.id} onClick={() => setElegida(sel ? null : r.id)} className="group h-7 cursor-pointer">
                    <td className={cn("sticky left-0 z-[5] whitespace-nowrap border-b border-r px-2 font-medium", fondo)} title={r.name !== r.code ? r.name : undefined}>
                      {r.code}
                    </td>
                    {matriz.columnas.map((m) => {
                      const v = r.valores[m.id]
                      return (
                        <td key={m.id} className={cn("whitespace-nowrap border-b px-1.5 text-right tabular-nums", fondo, v == null && "text-muted-foreground/50")}>
                          {celda(v)}
                        </td>
                      )
                    })}
                    <td className={cn("border-b px-1.5 text-right tabular-nums", fondo, !r.usos && "text-muted-foreground/50")}>{r.usos || "—"}</td>
                    <td className={cn("whitespace-nowrap border-b px-1.5 pr-2 text-right text-[11px] text-muted-foreground", fondo)}>{ed}</td>
                  </tr>
                )
              })}
              {!filas.length && (
                <tr>
                  <td colSpan={matriz.columnas.length + 3} className="py-10 text-center text-muted-foreground">
                    {cargando ? "Cargando…" : "No hay fórmulas con esos filtros"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {formulaElegida && (
          <PanelFormula
            key={formulaElegida.id}
            formula={formulaElegida}
            planta={plants.find((p) => p.id === formulaElegida.plant_id) || null}
            plantas={plants}
            usos={usos[formulaElegida.id] || 0}
            receta={recetaElegida}
            puedeEditar={puede("formulas", "editar")}
            puedeCopiar={puede("formulas", "cargar")}
            puedeBorrar={puede("formulas", "borrar")}
            onEditar={() => setEditar(formulaElegida)}
            onBorrar={() => setBorrar(formulaElegida)}
            onCerrar={() => setElegida(null)}
          />
        )}
      </div>

      {editar && (
        <EditFormulaDialog
          formula={editar as never}
          materials={materials}
          open
          onOpenChange={(o) => {
            if (!o) {
              setEditar(null)
              recargar()
            }
          }}
        />
      )}
      {borrar && (
        <DeleteFormulaDialog
          formula={borrar}
          open
          onOpenChange={(o) => {
            if (!o) {
              setBorrar(null)
              recargar()
            }
          }}
        />
      )}
    </div>
  )
}
