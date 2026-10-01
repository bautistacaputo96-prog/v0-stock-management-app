"use client"

/** Selector de chofer para los despachos (fase 1). Lista los activos; si el despacho ya tenía uno dado de baja, lo muestra igual. */
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { Chofer } from "@/lib/maestros"

const NINGUNO = "__ninguno__"

export function ChoferSelect({
  choferes,
  value,
  onChange,
  obligatorio,
  label = "Chofer",
}: {
  choferes: Chofer[]
  value: string
  onChange: (v: string) => void
  /** Obligatorio solo cuando hay choferes activos cargados */
  obligatorio?: boolean
  label?: string
}) {
  const activos = choferes.filter((c) => c.activo)
  const actual = choferes.find((c) => c.id === value)
  const opciones = actual && !actual.activo ? [...activos, actual] : activos
  return (
    <div className="space-y-2">
      <Label>{label}{obligatorio && activos.length > 0 ? " *" : ""}</Label>
      {activos.length === 0 && !actual ? (
        <p className="text-xs text-amber-700 rounded-md border border-amber-300 bg-amber-50 px-3 py-2">
          Cargá los choferes en Camiones › Choferes
        </p>
      ) : (
        <Select value={value || NINGUNO} onValueChange={(v) => onChange(v === NINGUNO ? "" : v)}>
          <SelectTrigger><SelectValue placeholder="Seleccionar chofer" /></SelectTrigger>
          <SelectContent>
            {!obligatorio && <SelectItem value={NINGUNO}>Sin chofer</SelectItem>}
            {obligatorio && !value && <SelectItem value={NINGUNO} disabled>Seleccionar chofer</SelectItem>}
            {opciones.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.nombre}{!c.activo ? " (de baja)" : ""}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  )
}
