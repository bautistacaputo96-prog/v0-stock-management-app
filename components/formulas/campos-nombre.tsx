"use client"

/**
 * Campos del nombre automático de una fórmula (alta y edición): resistencia, piedra, asentamiento, C/B y
 * comentario; la planta sale sola. "Nombre libre" (RDC, GUN, casos especiales) solo para gerenciales.
 */
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import {
  PIEDRAS, RESISTENCIAS_NOMBRE, armarNombre, sufijoDePlanta, validarPartes, type PartesNombre, type Piedra,
} from "@/lib/formulas-nombre"

export type ValorNombre = { modo: "partes" | "libre"; partes: PartesNombre; libre: string }

/** El código que queda y, si falta algo, qué. */
export function codigoDe(v: ValorNombre, planta: string | null | undefined): { codigo: string; error: string | null } {
  if (v.modo === "libre") {
    const c = v.libre.replace(/\s+/g, " ").trim()
    return { codigo: c, error: c.length < 2 ? "Escribí el nombre" : null }
  }
  const error = validarPartes(v.partes)
  return { codigo: error ? "" : armarNombre(v.partes, planta), error }
}

const NADA = "_"

export function CamposNombre({
  valor, onChange, planta, permiteLibre, libreSoloLectura,
}: {
  valor: ValorNombre
  onChange: (v: ValorNombre) => void
  planta: string | null | undefined
  /** gerencial: puede pasar a nombre libre o cambiarlo */
  permiteLibre: boolean
  /** la fórmula ya tiene nombre libre y la persona no es gerencial: se ve, no se cambia */
  libreSoloLectura?: boolean
}) {
  const p = valor.partes
  const set = (x: Partial<PartesNombre>) => onChange({ ...valor, partes: { ...p, ...x } })
  const { codigo, error } = codigoDe(valor, planta)
  const opcionesR = p.resistencia && !RESISTENCIAS_NOMBRE.includes(p.resistencia) ? [p.resistencia, ...RESISTENCIAS_NOMBRE] : RESISTENCIAS_NOMBRE

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <Label>Nombre</Label>
        {permiteLibre && (
          <div className="flex gap-1 text-xs">
            {(["partes", "libre"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onChange({ ...valor, modo: m, libre: m === "libre" && !valor.libre ? codigo : valor.libre })}
                className={cn("rounded-full border px-2 py-0.5", valor.modo === m ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
              >
                {m === "partes" ? "Automático" : "Nombre libre"}
              </button>
            ))}
          </div>
        )}
      </div>

      {valor.modo === "libre" ? (
        <div className="space-y-1">
          <Input
            value={valor.libre}
            onChange={(e) => onChange({ ...valor, libre: e.target.value })}
            placeholder={`Ej: RDC-300 ${sufijoDePlanta(planta)}`}
            disabled={libreSoloLectura}
            className="h-8"
          />
          <p className="text-xs text-muted-foreground">
            {libreSoloLectura
              ? "Esta fórmula tiene nombre libre: solo un gerencial lo puede cambiar."
              : `Para RDC, GUN y casos que no encajan. Poné la planta ${sufijoDePlanta(planta)} en el nombre.`}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-5 gap-2">
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Resistencia</span>
            <Select value={p.resistencia || NADA} onValueChange={(v) => set({ resistencia: v === NADA ? "" : v })}>
              <SelectTrigger className="h-8"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NADA}>—</SelectItem>
                {opcionesR.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Piedra</span>
            <Select value={p.piedra || NADA} onValueChange={(v) => set({ piedra: v === NADA ? null : (v as Piedra) })}>
              <SelectTrigger className="h-8"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NADA}>Sin piedra</SelectItem>
                {PIEDRAS.map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Asent. (cm)</span>
            <Input
              type="number"
              min={1}
              max={30}
              step={1}
              value={p.asentamiento ?? ""}
              onChange={(e) => set({ asentamiento: e.target.value === "" ? null : Number(e.target.value) })}
              placeholder="Ej: 15"
              className="h-8"
            />
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Tipo</span>
            <Select value={p.metodo || NADA} onValueChange={(v) => set({ metodo: v === NADA ? null : (v as "B" | "C") })}>
              <SelectTrigger className="h-8"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NADA}>—</SelectItem>
                <SelectItem value="C">C común</SelectItem>
                <SelectItem value="B">B bombeable</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Comentario</span>
            <Input value={p.comentario} onChange={(e) => set({ comentario: e.target.value.toUpperCase() })} placeholder="Ej: PELQUE" maxLength={20} className="h-8" />
          </div>
        </div>
      )}

      <div className="flex items-baseline gap-2 rounded bg-muted px-2 py-1.5">
        <span className="text-xs text-muted-foreground">Queda:</span>
        {codigo ? <span className="font-mono text-sm font-medium">{codigo}</span> : <span className="text-xs text-muted-foreground">{error}</span>}
      </div>
    </div>
  )
}
