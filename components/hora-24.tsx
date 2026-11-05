"use client"

/**
 * Campo de hora de 24 h (HH:MM) con máscara: acepta "1300", "13:00" y "13.00", valida 00:00 a 23:59 y avisa el cambio
 * al salir del campo o con Enter (si no es válida, vuelve a la que estaba). Reemplaza a <input type="time"> en el
 * bloque del día y en el gerenciador (en un navegador en inglés, type=time muestra 12 h y se corta).
 */
import { useEffect, useState } from "react"
import { Input } from "@/components/ui/input"
import { parsearHora24 } from "@/lib/hora-24"
import { cn } from "@/lib/utils"

export function Hora24({ value, onChange, disabled, title, className }: {
  value: string
  /** Se llama con "HH:MM" válida y distinta de la de antes */
  onChange: (hora: string) => void
  disabled?: boolean
  title?: string
  className?: string
}) {
  const [texto, setTexto] = useState(value)
  const [mal, setMal] = useState(false)
  useEffect(() => { setTexto(value); setMal(false) }, [value])
  const confirmar = () => {
    const h = parsearHora24(texto)
    if (!h) { setTexto(value); setMal(false); return }
    setTexto(h)
    setMal(false)
    if (h !== value) onChange(h)
  }
  return (
    <Input
      type="text" inputMode="numeric" autoComplete="off" placeholder="HH:MM" maxLength={5}
      value={texto} disabled={disabled}
      title={mal ? "Hora de 00:00 a 23:59 (por ejemplo 13:00 o 1300)" : title}
      onChange={(e) => { const v = e.target.value.replace(/[^\d:.,]/g, "").slice(0, 5); setTexto(v); setMal(!!v && !parsearHora24(v)) }}
      onBlur={confirmar}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); confirmar() } else if (e.key === "Escape") { setTexto(value); setMal(false) } }}
      className={cn("tabular-nums", mal && "border-red-500 focus-visible:ring-red-500", className)}
    />
  )
}
