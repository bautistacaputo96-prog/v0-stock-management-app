"use client"

/**
 * Panel al costado de la tabla de Fórmulas (docs/migracion-loop/formulas-rediseno.md): datos, materiales, receta de
 * la planta (Indumix), Zomatik y los botones Editar / Historial / Copiar a la otra planta / Eliminar.
 */
import { useEffect, useState } from "react"
import { format, parseISO } from "date-fns"
import { es } from "date-fns/locale"
import { Check, Copy, History, Loader2, Pencil, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"
import { logActivity } from "@/lib/activity-log"
import { cn } from "@/lib/utils"
import { cantidadPorM3 } from "@/lib/carga/receta"
import {
  celda, codigoEnPlanta, existeEnPlanta, leerCodigo, materialesEnPlanta, ordenarMateriales,
  type FormulaTabla, type RecetaContraFormula,
} from "@/lib/formulas-tabla"

export type FormulaPanel = FormulaTabla & {
  plant_id: string
  useful_life_minutes?: number | null
  zomatik_articulo_codigo?: number | null
  zomatik_articulo_nombre?: string | null
}

type Planta = { id: string; name: string }

const fecha = (s: string | null | undefined, f = "dd/MM/yy") => {
  if (!s) return null
  try { return format(parseISO(s), f, { locale: es }) } catch { return null }
}

export function PanelFormula({
  formula, planta, plantas, usos, receta, puedeEditar, puedeCopiar, puedeBorrar, onEditar, onBorrar, onCerrar,
}: {
  formula: FormulaPanel
  planta: Planta | null
  plantas: Planta[]
  usos: number
  /** null = la planta no tiene puesto o la fórmula no tiene número de receta: no se muestra nada */
  receta: RecetaContraFormula | null
  puedeEditar: boolean
  puedeCopiar: boolean
  puedeBorrar: boolean
  onEditar: () => void
  onBorrar: () => void
  onCerrar: () => void
}) {
  const [historial, setHistorial] = useState(false)
  const [copiar, setCopiar] = useState(false)
  const leido = leerCodigo(formula.code)
  const otras = plantas.filter((p) => p.id !== formula.plant_id)
  const mats = ordenarMateriales(
    (formula.formula_materials || [])
      .filter((fm) => fm.materials)
      .map((fm) => ({ id: fm.materials!.id, name: fm.materials!.name, unit: fm.materials!.unit || "", q: Number(fm.quantity) || 0 })),
  )
  const editado = fecha(formula.updated_at)

  return (
    <aside className="w-[270px] shrink-0 overflow-y-auto rounded-md border bg-card text-xs">
      <div className="flex items-start justify-between gap-2 border-b px-3 py-2">
        <div className="min-w-0">
          <div className="truncate font-mono text-[13px] font-medium" title={formula.code}>{formula.code}</div>
          <div className="mt-0.5 text-muted-foreground">
            {[
              planta?.name,
              leido.metodo === "B" ? "B · bombeable" : leido.metodo === "C" ? "C · común" : null,
              leido.asentamiento != null ? `asent. ${leido.asentamiento} cm` : null,
              formula.yield_m3 != null ? `rinde ${celda(Number(formula.yield_m3))} m³` : null,
            ].filter(Boolean).join(" · ")}
          </div>
        </div>
        <button type="button" onClick={onCerrar} className="rounded p-0.5 text-muted-foreground hover:bg-muted" aria-label="Cerrar">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-3 px-3 py-2">
        {formula.description && <p className="text-muted-foreground">{formula.description}</p>}
        <p className="text-muted-foreground">
          {editado ? <>Última edición {editado}{formula.updated_by ? ` por ${formula.updated_by.split("@")[0]}` : ""}</> : "Sin ediciones registradas"}
          {" · "}{usos} despacho{usos === 1 ? "" : "s"} en 90 días
        </p>

        <section>
          <h3 className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Materiales por m³</h3>
          {mats.length === 0 ? (
            <p className="text-muted-foreground">Sin materiales</p>
          ) : (
            <table className="w-full">
              <tbody>
                {mats.map((m) => (
                  <tr key={m.id} className="h-6 border-b border-border/50 last:border-0">
                    <td className="pr-2">{m.name}</td>
                    <td className="text-right tabular-nums">{celda(m.q)}</td>
                    <td className="w-8 pl-1 text-muted-foreground">{m.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {receta && <SeccionReceta r={receta} />}

        <section>
          <h3 className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Zomatik</h3>
          {formula.zomatik_articulo_codigo ? (
            <p className="flex items-start gap-1">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
              <span>{formula.zomatik_articulo_codigo}{formula.zomatik_articulo_nombre ? ` · ${formula.zomatik_articulo_nombre}` : ""}</span>
            </p>
          ) : (
            <p className="text-muted-foreground">Sin vincular</p>
          )}
        </section>

        <div className="flex flex-wrap gap-1.5 border-t pt-2">
          {puedeEditar && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={onEditar}>
              <Pencil className="mr-1 h-3.5 w-3.5" />Editar
            </Button>
          )}
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setHistorial(true)}>
            <History className="mr-1 h-3.5 w-3.5" />Historial
          </Button>
          {puedeCopiar && otras.length > 0 && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setCopiar(true)}>
              <Copy className="mr-1 h-3.5 w-3.5" />Copiar a {otras.length === 1 ? otras[0].name : "otra planta"}
            </Button>
          )}
          {puedeBorrar && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-destructive hover:text-destructive" onClick={onBorrar}>
              <Trash2 className="mr-1 h-3.5 w-3.5" />Eliminar
            </Button>
          )}
        </div>
      </div>

      {historial && <HistorialDialog formula={formula} onClose={() => setHistorial(false)} />}
      {copiar && <CopiarDialog formula={formula} origen={planta} destinos={otras} onClose={() => setCopiar(false)} />}
    </aside>
  )
}

function SeccionReceta({ r }: { r: RecetaContraFormula }) {
  return (
    <section>
      <h3 className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
        Planta · receta {r.numero}{r.nombre ? ` «${r.nombre}»` : ""}
      </h3>
      {r.vacia ? (
        <p className="text-muted-foreground">La receta {r.numero} todavía no se leyó de la planta o está vacía.</p>
      ) : (
        <>
          {r.resumen ? (
            <p className="mb-1 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">{r.resumen}</p>
          ) : (
            <p className="mb-1 flex items-center gap-1 text-emerald-700 dark:text-emerald-400"><Check className="h-3.5 w-3.5" />Igual a la fórmula</p>
          )}
          <table className="w-full">
            <thead>
              <tr className="text-[11px] text-muted-foreground">
                <th className="text-left font-normal" />
                <th className="text-right font-normal">Planta</th>
                <th className="text-right font-normal">Fórmula</th>
              </tr>
            </thead>
            <tbody>
              {r.lineas.map((l) => (
                <tr key={l.material_id} className={cn("h-6 border-b border-border/50 last:border-0", l.distinta && "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200")}>
                  <td className="pr-2">{l.nombre}</td>
                  <td className="text-right tabular-nums">{l.texto}</td>
                  <td className="pl-2 text-right tabular-nums text-muted-foreground">{cantidadPorM3(l.grupo, l.formula)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {r.sueltas.length > 0 && (
            <p className="mt-1 text-amber-800 dark:text-amber-300">Pesa sin material en: {r.sueltas.join(", ")}</p>
          )}
        </>
      )}
    </section>
  )
}

type Registro = { id: string; user_name: string; action: string; details: Record<string, unknown> | null; created_at: string }

const ACCION: Record<string, string> = { crear: "Alta", editar: "Edición", borrar: "Borrado", transferir: "Transferencia" }

function HistorialDialog({ formula, onClose }: { formula: FormulaPanel; onClose: () => void }) {
  const [filas, setFilas] = useState<Registro[] | null>(null)
  useEffect(() => {
    const sb = createClient()
    sb.from("activity_log")
      .select("id, user_name, action, details, created_at")
      .eq("entity", "formula")
      .eq("entity_id", formula.id)
      .order("created_at", { ascending: false })
      .limit(200)
      .then(({ data }: { data: Registro[] | null }) => setFilas(data || []))
  }, [formula.id])

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-mono text-base">Historial · {formula.code}</DialogTitle>
          <DialogDescription>Cambios registrados en Actividad.</DialogDescription>
        </DialogHeader>
        {filas == null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Cargando…</div>
        ) : filas.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay cambios registrados para esta fórmula.</p>
        ) : (
          <ul className="space-y-2 text-[12px]">
            {filas.map((f) => (
              <li key={f.id} className="rounded border px-2 py-1.5">
                <div className="flex justify-between gap-2 text-muted-foreground">
                  <span>{ACCION[f.action] || f.action} · {f.user_name}</span>
                  <span>{fecha(f.created_at, "dd/MM/yy HH:mm")}</span>
                </div>
                {f.details && Object.keys(f.details).length > 0 && (
                  <dl className="mt-1 space-y-0.5">
                    {Object.entries(f.details).map(([k, v]) => (
                      <div key={k} className="flex gap-1">
                        <dt className="shrink-0 text-muted-foreground">{k}:</dt>
                        <dd className="break-words">{typeof v === "object" ? JSON.stringify(v) : String(v)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}

function CopiarDialog({ formula, origen, destinos, onClose }: { formula: FormulaPanel; origen: Planta | null; destinos: Planta[]; onClose: () => void }) {
  const { toast } = useToast()
  const [destinoId, setDestinoId] = useState(destinos[0]?.id || "")
  const [estado, setEstado] = useState<{ cargando: boolean; existe: string | null; faltan: string[] }>({ cargando: true, existe: null, faltan: [] })
  const [guardando, setGuardando] = useState(false)
  const destino = destinos.find((p) => p.id === destinoId) || null
  const nuevoCodigo = destino ? codigoEnPlanta(formula.code, destino.name) : ""
  const nuevoNombre = destino ? codigoEnPlanta(formula.name || formula.code, destino.name) : ""
  const receta = (formula.formula_materials || [])
    .filter((fm) => fm.materials)
    .map((fm) => ({ material_name: fm.materials!.name, quantity: Number(fm.quantity) || 0 }))

  useEffect(() => {
    if (!destinoId) return
    let vivo = true
    setEstado({ cargando: true, existe: null, faltan: [] })
    const sb = createClient()
    Promise.all([
      sb.from("formulas").select("id, code").eq("plant_id", destinoId),
      sb.from("materials").select("id, name").eq("plant_id", destinoId),
    ]).then(([f, m]) => {
      if (!vivo) return
      const ya = existeEnPlanta(formula.code, (f.data || []) as { id: string; code: string }[])
      const { faltan } = materialesEnPlanta(receta, (m.data || []) as { id: string; name: string }[])
      setEstado({ cargando: false, existe: ya?.code || null, faltan })
    })
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destinoId, formula.id])

  async function confirmar() {
    if (!destino || estado.existe || estado.faltan.length) return
    setGuardando(true)
    const sb = createClient()
    try {
      // Se vuelve a mirar justo antes de crear, por si alguien la cargó mientras tanto
      const [f, m] = await Promise.all([
        sb.from("formulas").select("id, code").eq("plant_id", destino.id),
        sb.from("materials").select("id, name").eq("plant_id", destino.id),
      ])
      const ya = existeEnPlanta(formula.code, (f.data || []) as { id: string; code: string }[])
      if (ya) {
        setEstado((e) => ({ ...e, existe: ya.code }))
        return
      }
      const { filas, faltan } = materialesEnPlanta(receta, (m.data || []) as { id: string; name: string }[])
      if (faltan.length || !filas.length) {
        setEstado((e) => ({ ...e, faltan: faltan.length ? faltan : ["(sin materiales)"] }))
        return
      }
      const { data: nueva, error } = await sb
        .from("formulas")
        .insert({
          code: nuevoCodigo,
          name: nuevoNombre,
          description: formula.description || null,
          yield_m3: Number(formula.yield_m3) || 1,
          useful_life_minutes: formula.useful_life_minutes ?? null,
          plant_id: destino.id,
        })
        .select()
        .single()
      if (error) throw error
      const { error: e2 } = await sb.from("formula_materials").insert(filas.map((x) => ({ formula_id: nueva.id, material_id: x.material_id, quantity: x.quantity })))
      if (e2) {
        // que no quede una fórmula sin materiales
        await sb.from("formulas").delete().eq("id", nueva.id)
        throw e2
      }
      await logActivity({
        action: "crear",
        entity: "formula",
        entityId: nueva.id,
        reference: nuevoCodigo,
        plantId: destino.id,
        details: {
          "Código": nuevoCodigo,
          "Copiada de": `${formula.code}${origen ? ` (${origen.name})` : ""}`,
          "Rinde (m³)": Number(formula.yield_m3) || 1,
          Materiales: receta.filter((r) => r.quantity > 0).map((r) => `${r.material_name} ${r.quantity}`).join(" · "),
        },
      })
      toast({ title: "Fórmula copiada", description: `${nuevoCodigo} quedó cargada en ${destino.name}` })
      onClose()
    } catch (err) {
      toast({ variant: "destructive", title: "No se pudo copiar", description: err instanceof Error ? err.message : String((err as { message?: string })?.message || err) })
    } finally {
      setGuardando(false)
    }
  }

  const bloqueada = estado.cargando || !!estado.existe || estado.faltan.length > 0

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Copiar a la otra planta</DialogTitle>
          <DialogDescription>
            Se crea la misma fórmula, con los mismos materiales y cantidades. El artículo de Zomatik no se copia.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-xs">
          {destinos.length > 1 && (
            <Select value={destinoId} onValueChange={setDestinoId}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Planta" /></SelectTrigger>
              <SelectContent>
                {destinos.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <p>
            <span className="font-mono">{formula.code}</span>
            {origen ? ` (${origen.name})` : ""} → <span className="font-mono font-medium">{nuevoCodigo}</span>
            {destino ? ` en ${destino.name}` : ""}
          </p>
          {estado.cargando ? (
            <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Revisando {destino?.name}…</p>
          ) : estado.existe ? (
            <p className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-amber-900">Ya existe <span className="font-mono">{estado.existe}</span> en {destino?.name}: no se copia.</p>
          ) : estado.faltan.length ? (
            <p className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-amber-900">{destino?.name} no tiene: {estado.faltan.join(", ")}. Cargalos en Materias primas antes de copiar.</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={confirmar} disabled={bloqueada || guardando}>
            {guardando ? "Copiando…" : "Copiar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
