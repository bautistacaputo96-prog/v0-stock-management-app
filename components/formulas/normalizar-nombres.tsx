"use client"

/**
 * "Normalizar nombres" (22/10/2026): lista "actual → propuesto" de las fórmulas de todas las plantas con el formato
 * H30-620-15 B (CAN) PELQUE. Solo un gerencial con Fórmulas · editar lo aplica, todas juntas o de a una, con
 * confirmación. Cada renombre queda en Actividad. Despachos y demás apuntan a formula_id: el código se puede cambiar.
 */
import { useEffect, useMemo, useState } from "react"
import { ArrowRight, Check, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"
import { logCambio } from "@/lib/activity-log"
import { cn } from "@/lib/utils"
import { proponerRenombres, type EstadoRenombre, type Renombre } from "@/lib/formulas-nombre"

const MOTIVO = "Normalizar nombres (formato H30-620-15 B (CAN) PELQUE)"
const PESTANAS: { clave: EstadoRenombre; nombre: string }[] = [
  { clave: "renombrar", nombre: "Para renombrar" },
  { clave: "revisar", nombre: "Revisar a mano" },
  { clave: "igual", nombre: "Ya están bien" },
]

export function NormalizarNombres({ plantas, onClose }: { plantas: { id: string; name: string }[]; onClose: (cambio: boolean) => void }) {
  const { toast } = useToast()
  const [filas, setFilas] = useState<Renombre[] | null>(null)
  const [pestana, setPestana] = useState<EstadoRenombre>("renombrar")
  const [editado, setEditado] = useState<Record<string, string>>({})
  const [aConfirmar, setAConfirmar] = useState<string | null>(null)
  const [confirmarTodas, setConfirmarTodas] = useState(false)
  const [trabajando, setTrabajando] = useState(false)
  const [hechos, setHechos] = useState<Record<string, string>>({})
  const [errores, setErrores] = useState<Record<string, string>>({})
  const [cambio, setCambio] = useState(false)

  async function cargar() {
    const { data } = await createClient().from("formulas").select("id, code, name, plant_id")
    setFilas(proponerRenombres((data || []) as { id: string; code: string; name: string | null; plant_id: string }[], plantas))
  }
  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cuenta = useMemo(() => {
    const c: Record<EstadoRenombre, number> = { renombrar: 0, revisar: 0, igual: 0 }
    for (const f of filas || []) if (!hechos[f.id]) c[f.estado]++
    return c
  }, [filas, hechos])
  const visibles = (filas || []).filter((f) => f.estado === pestana)
  const nuevoDe = (f: Renombre) => (f.estado === "revisar" ? (editado[f.id] ?? f.propuesto) : f.propuesto).replace(/\s+/g, " ").trim()

  /** Renombra una fórmula (código y nombre). Devuelve el error, o null. */
  async function renombrar(f: Renombre, nuevo: string): Promise<string | null> {
    if (nuevo.length < 2) return "Escribí el nombre"
    const sb = createClient()
    const { data: antes } = await sb.from("formulas").select("code, name").eq("id", f.id).maybeSingle()
    if (!antes) return "La fórmula ya no existe"
    if (antes.code === nuevo && antes.name === nuevo) return null
    const { error } = await sb.from("formulas").update({ code: nuevo, name: nuevo }).eq("id", f.id)
    if (error) return (error as { code?: string }).code === "23505" ? `Ya hay otra ${nuevo} en ${f.planta}` : error.message
    await logCambio({
      entity: "formula",
      entityId: f.id,
      reference: nuevo,
      plantId: f.plant_id,
      antes: { code: antes.code, name: antes.name },
      despues: { code: nuevo, name: nuevo },
      etiquetas: { code: "Código", name: "Nombre" },
      motivo: MOTIVO,
    })
    return null
  }

  async function aplicarUna(f: Renombre) {
    setAConfirmar(null)
    setTrabajando(true)
    const nuevo = nuevoDe(f)
    const err = await renombrar(f, nuevo)
    setTrabajando(false)
    if (err) setErrores((e) => ({ ...e, [f.id]: err }))
    else {
      setHechos((h) => ({ ...h, [f.id]: nuevo }))
      setErrores((e) => { const x = { ...e }; delete x[f.id]; return x })
      setCambio(true)
    }
  }

  async function aplicarTodas() {
    setConfirmarTodas(false)
    setTrabajando(true)
    let ok = 0, mal = 0
    for (const f of (filas || []).filter((x) => x.estado === "renombrar" && !hechos[x.id])) {
      const nuevo = nuevoDe(f)
      const err = await renombrar(f, nuevo)
      if (err) { mal++; setErrores((e) => ({ ...e, [f.id]: err })) }
      else { ok++; setHechos((h) => ({ ...h, [f.id]: nuevo })) }
    }
    setTrabajando(false)
    if (ok) setCambio(true)
    toast({ title: "Nombres normalizados", description: `${ok} renombrada${ok === 1 ? "" : "s"}${mal ? ` · ${mal} con error (quedan marcadas)` : ""}` })
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !trabajando && onClose(cambio)}>
      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle>Normalizar nombres</DialogTitle>
          <DialogDescription>
            Formato H30-620-15 B (CAN) PELQUE en las dos plantas. Los despachos no se tocan: apuntan a la fórmula, no al nombre.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-1">
          {PESTANAS.map((p) => (
            <button
              key={p.clave}
              type="button"
              onClick={() => setPestana(p.clave)}
              className={cn("h-7 rounded-full border px-3 text-xs", pestana === p.clave ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
            >
              {p.nombre} ({cuenta[p.clave]})
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
          {filas == null ? (
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Cargando…</div>
          ) : visibles.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No hay fórmulas en esta lista.</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 text-left font-normal">Planta</th>
                  <th className="px-2 py-1.5 text-left font-normal">Actual</th>
                  <th className="w-4" />
                  <th className="px-2 py-1.5 text-left font-normal">{pestana === "igual" ? "" : "Propuesto"}</th>
                  <th className="w-[110px]" />
                </tr>
              </thead>
              <tbody>
                {visibles.map((f) => {
                  const hecho = hechos[f.id]
                  return (
                    <tr key={f.id} className={cn("border-t align-top", hecho && "bg-emerald-50 dark:bg-emerald-950")}>
                      <td className="px-2 py-1.5 text-muted-foreground">{f.planta}</td>
                      <td className="px-2 py-1.5 font-mono">{f.actual}</td>
                      <td className="py-1.5 text-muted-foreground">{pestana !== "igual" && <ArrowRight className="h-3 w-3" />}</td>
                      <td className="px-2 py-1.5">
                        {pestana === "igual" ? null : hecho ? (
                          <span className="font-mono">{hecho}</span>
                        ) : f.estado === "revisar" ? (
                          <Input
                            value={editado[f.id] ?? f.propuesto}
                            onChange={(e) => setEditado((x) => ({ ...x, [f.id]: e.target.value }))}
                            className="h-7 font-mono text-xs"
                          />
                        ) : (
                          <span className="font-mono font-medium">{f.propuesto}</span>
                        )}
                        {f.motivo && !hecho && <p className="mt-0.5 text-amber-800 dark:text-amber-300">{f.motivo}</p>}
                        {errores[f.id] && <p className="mt-0.5 text-destructive">{errores[f.id]}</p>}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        {pestana === "igual" ? null : hecho ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700"><Check className="h-3.5 w-3.5" />Hecho</span>
                        ) : aConfirmar === f.id ? (
                          <Button size="sm" className="h-7 px-2 text-xs" disabled={trabajando} onClick={() => aplicarUna(f)}>¿Confirmar?</Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs"
                            disabled={trabajando || (f.estado === "revisar" && nuevoDe(f) === f.actual)}
                            onClick={() => setAConfirmar(f.id)}
                          >
                            Aplicar
                          </Button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        <DialogFooter className="items-center gap-2 sm:justify-between">
          <p className="text-xs text-muted-foreground">Cada cambio queda en Actividad.</p>
          <div className="flex gap-2">
            <Button variant="outline" disabled={trabajando} onClick={() => onClose(cambio)}>Cerrar</Button>
            {pestana === "renombrar" && cuenta.renombrar > 0 && (
              <Button disabled={trabajando} onClick={() => setConfirmarTodas(true)}>
                {trabajando ? "Renombrando…" : `Aplicar todas (${cuenta.renombrar})`}
              </Button>
            )}
          </div>
        </DialogFooter>

        {confirmarTodas && (
          <Dialog open onOpenChange={(o) => !o && setConfirmarTodas(false)}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>¿Renombrar {cuenta.renombrar} fórmulas?</DialogTitle>
                <DialogDescription>
                  Se cambian el código y el nombre de las de "Para renombrar". Las de "Revisar a mano" no se tocan.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmarTodas(false)}>Cancelar</Button>
                <Button onClick={aplicarTodas}>Renombrar</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  )
}
