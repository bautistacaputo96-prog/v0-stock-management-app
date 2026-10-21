"use client"

/**
 * Buscador unificado de clientes para el pedido (Programación) y el despacho manual (regla de Bautista del
 * 21/10/2026): si el cliente existe, en Rebucret o en Zomatik, lo encuentra sí o sí.
 *   - Busca sin tildes, por palabras en cualquier orden y por partes ("fide terc"), por razón social, alias,
 *     CUIT/DNI (con o sin guiones), obra y teléfono. La búsqueda la hace el servidor (/api/clientes/buscar).
 *   - Grupos: "En Rebucret", "En Zomatik (se trae al elegirlo)" y "Posibles parecidos" (errores de tipeo).
 *   - Elegir uno de Zomatik hace "Traer de Zomatik" en el momento (crea el cliente acá, vinculado; en Zomatik no
 *     se toca nada). Solo si no aparece en ninguno de los dos, se da de alta ("Agregar").
 */
import { useEffect, useRef, useState } from "react"
import { ChevronsUpDown, Download, Loader2, Search } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

type HitR = { id: string; name: string; via: string; dado_de_baja: boolean }
type HitZ = { codigo: number; razon_social: string; cuit: string | null; localidad: string | null; remitos_12m: number; ultimo_remito: string | null }
type Par = { tipo: "rebucret" | "zomatik"; id: string; nombre: string; similitud: number; dado_de_baja?: boolean }
type Res = { rebucret: HitR[]; zomatik: HitZ[]; parecidos: Par[]; puedeTraer: boolean }

export function BuscadorCliente({
  value,
  etiqueta,
  plantId,
  onElegir,
  disabled,
  placeholder = "Buscar cliente: nombre, CUIT, obra o teléfono…",
}: {
  value: string
  /** Nombre del cliente elegido (para el botón). */
  etiqueta?: string | null
  plantId?: string | null
  /** `nuevo` = se acaba de traer de Zomatik (hay que sumarlo a la lista local). */
  onElegir: (c: { id: string; name: string }, nuevo: boolean) => void
  disabled?: boolean
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")
  const [res, setRes] = useState<Res | null>(null)
  const [cargando, setCargando] = useState(false)
  const [trayendo, setTrayendo] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pedido = useRef(0)

  useEffect(() => {
    if (!open) return
    const texto = q.trim()
    if (texto.length < 2) {
      setRes(null)
      return
    }
    const n = ++pedido.current
    setCargando(true)
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/clientes/buscar?q=${encodeURIComponent(texto)}`, { cache: "no-store" })
        const j = await r.json().catch(() => null)
        if (n !== pedido.current) return
        if (!r.ok) setError(j?.error || "No se pudo buscar")
        else {
          setError(null)
          setRes(j)
        }
      } catch {
        if (n === pedido.current) setError("No se pudo buscar")
      } finally {
        if (n === pedido.current) setCargando(false)
      }
    }, 250)
    return () => clearTimeout(t)
  }, [q, open])

  function elegir(c: { id: string; name: string }, nuevo = false) {
    onElegir(c, nuevo)
    setOpen(false)
    setQ("")
  }

  async function traer(codigo: number) {
    setTrayendo(codigo)
    setError(null)
    try {
      const r = await fetch("/api/zomatik/traer-cliente", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo, plantId: plantId && plantId !== "all" ? plantId : null }),
      })
      const j = await r.json().catch(() => ({}))
      if (r.ok) {
        toast.success(j.yaEstaba ? `${j.cliente.name} ya estaba en Rebucret` : `${j.cliente.name} traído de Zomatik`, j.aviso ? { description: j.aviso } : undefined)
        elegir(j.cliente, !j.yaEstaba)
      } else if (j?.cliente) {
        // Ya estaba en Rebucret con otro nombre o el mismo CUIT: se usa ese
        toast.info(j.error)
        elegir(j.cliente)
      } else setError(j?.error || "No se pudo traer el cliente")
    } finally {
      setTrayendo(null)
    }
  }

  const vacio = res && res.rebucret.length === 0 && res.zomatik.length === 0 && res.parecidos.length === 0
  const Grupo = ({ titulo, children }: { titulo: string; children: React.ReactNode }) => (
    <div className="py-1">
      <div className="px-2 pb-0.5 text-[10px] font-semibold uppercase text-muted-foreground">{titulo}</div>
      {children}
    </div>
  )
  const Fila = ({ onClick, children, deshabilitada }: { onClick?: () => void; children: React.ReactNode; deshabilitada?: boolean }) => (
    <button type="button" disabled={deshabilitada} onClick={onClick} className={cn("flex w-full items-center gap-2 px-2 py-1 text-left text-sm", deshabilitada ? "cursor-not-allowed opacity-60" : "hover:bg-muted")}>
      {children}
    </button>
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" disabled={disabled} className="w-full justify-between font-normal">
          <span className={cn("truncate", !value && "text-muted-foreground")}>{value ? etiqueta || "Cliente elegido" : placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-[340px] p-0" align="start">
        <div className="flex items-center gap-1 border-b px-2">
          <Search className="h-4 w-4 opacity-50" />
          <Input autoFocus className="h-9 border-0 px-1 shadow-none focus-visible:ring-0" placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} />
          {cargando && <Loader2 className="h-4 w-4 animate-spin opacity-50" />}
        </div>
        <div className="max-h-[320px] overflow-y-auto">
          {q.trim().length < 2 && <div className="px-2 py-2 text-xs text-muted-foreground">Escribí al menos 2 letras. Busca en Rebucret y en Zomatik a la vez.</div>}
          {error && <div className="px-2 py-2 text-xs font-medium text-red-700">{error}</div>}
          {res && res.rebucret.length > 0 && (
            <Grupo titulo="En Rebucret">
              {res.rebucret.map((c) => (
                <Fila key={c.id} deshabilitada={c.dado_de_baja} onClick={() => elegir({ id: c.id, name: c.name })}>
                  <span className="truncate font-medium">{c.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{c.dado_de_baja ? "dado de baja: reactivalo en Clientes" : c.via === "nombre" ? "" : `por ${c.via}`}</span>
                </Fila>
              ))}
            </Grupo>
          )}
          {res && res.zomatik.length > 0 && (
            <Grupo titulo="En Zomatik (se trae al elegirlo)">
              {res.zomatik.map((z) => (
                <Fila key={z.codigo} deshabilitada={!res.puedeTraer || trayendo !== null} onClick={() => traer(z.codigo)}>
                  {trayendo === z.codigo ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3 text-blue-700" />}
                  <span className="truncate font-medium">{z.razon_social}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {[z.cuit && `CUIT ${z.cuit}`, z.localidad, z.remitos_12m ? `${z.remitos_12m} remitos en el año` : ""].filter(Boolean).join(" · ")}
                  </span>
                </Fila>
              ))}
              {!res.puedeTraer && <div className="px-2 text-[11px] text-amber-700">Para traerlo hace falta permiso de cargar clientes.</div>}
            </Grupo>
          )}
          {res && res.parecidos.length > 0 && (
            <Grupo titulo="Posibles parecidos">
              {res.parecidos.map((p) => (
                <Fila
                  key={`${p.tipo}:${p.id}`}
                  deshabilitada={p.dado_de_baja || (p.tipo === "zomatik" && (!res.puedeTraer || trayendo !== null))}
                  onClick={() => (p.tipo === "rebucret" ? elegir({ id: p.id, name: p.nombre }) : traer(Number(p.id)))}
                >
                  <span className="truncate">{p.nombre}</span>
                  <span className="truncate text-xs text-muted-foreground">{p.tipo === "zomatik" ? "en Zomatik" : p.dado_de_baja ? "dado de baja" : "en Rebucret"} · {Math.round(p.similitud * 100)} %</span>
                </Fila>
              ))}
            </Grupo>
          )}
          {vacio && <div className="px-2 py-2 text-xs text-muted-foreground">No está ni en Rebucret ni en Zomatik. Si es nuevo, usá «Agregar».</div>}
        </div>
      </PopoverContent>
    </Popover>
  )
}
