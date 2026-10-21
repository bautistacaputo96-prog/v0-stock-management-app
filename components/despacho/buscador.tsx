"use client"

/** Buscador arriba de cada columna, como el "Localizar" de Loop. Filtra en la pantalla (no consulta la base). */
import { Search, X } from "lucide-react"

export function Buscador({ valor, onCambio }: { valor: string; onCambio: (v: string) => void }) {
  return (
    <div className="px-1.5 pt-1.5">
      <label className="flex h-7 items-center gap-1.5 rounded-md bg-slate-100 px-2 text-[12px] text-slate-600">
        <Search className="h-3.5 w-3.5 shrink-0" />
        <input
          className="min-w-0 flex-1 bg-transparent text-[12px] text-foreground outline-none placeholder:text-slate-500"
          placeholder="Buscar:"
          value={valor}
          onChange={(e) => onCambio(e.target.value)}
        />
        {valor && <button className="shrink-0" title="Borrar" onClick={() => onCambio("")}><X className="h-3.5 w-3.5" /></button>}
      </label>
    </div>
  )
}

/** ¿El texto buscado está en alguno de los campos? Sin tildes ni mayúsculas; todas las palabras tienen que estar. */
export function coincide(buscado: string, ...campos: (string | number | null | undefined)[]): boolean {
  const norm = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  const q = norm(buscado.trim())
  if (!q) return true
  const todo = norm(campos.filter((x) => x != null && x !== "").join(" "))
  return q.split(/\s+/).every((w) => todo.includes(w))
}
