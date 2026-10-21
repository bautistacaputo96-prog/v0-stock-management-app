"use client"

/**
 * Zomatik Z0 · "Vínculos con Zomatik" (solo gerenciales). Confirmar o corregir a mano:
 *   - clientes nuestros ↔ clientes de Zomatik;
 *   - fórmulas ↔ artículos de Zomatik;
 *   - proyectos (acopios) abiertos ↔ obras nuestras;
 * y traer los clientes de Zomatik con remitos en el año que no están en Rebucret.
 *
 * Las propuestas las calcula el servidor (/api/zomatik/propuestas) con el cruce por fechas y m³ más el nombre,
 * con confianza alta / media / baja y la evidencia a la vista. "Confirmar todas las de confianza alta" muestra
 * un resumen antes de grabar. Escribe solo en nuestra base (/api/zomatik/vincular, /api/zomatik/traer-cliente).
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { AlertTriangle, Check, ChevronsUpDown, Download, Loader2, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { cn } from "@/lib/utils"
import { tokensNombre } from "@/lib/zomatik/parseo"

type Conf = "alta" | "media" | "baja"
type Prop = { confianza: Conf; motivo: string; evidencia: string }
type Cand = { codigo: number; nombre: string; evidencia: string; confianza: Conf }
type FilaC = { id: string; name: string; cuit: string | null; despachos: number; vinculo: string | null; vinculado_por: string | null; zomatik_codigo: number | null; zomatik_nombre: string | null; duplicado: string | null; propuesta: (Prop & { codigo: number; nombre: string; cuit: string | null }) | null; candidatos: Cand[] }
type FilaF = { id: string; name: string; planta: string; vinculo: string | null; vinculado_por: string | null; codigo: number | null; nombre: string | null; propuesta: (Prop & { codigo: number; nombre: string }) | null; ranking: { codigo: number; nombre: string; pct: number; dias: number; base: number }[] }
type FilaP = { codigo: number; numero: string; cliente_codigo: number | null; cliente_nombre: string | null; obra: string | null; ultima_entrega: string | null; construction_site_id: string | null; vinculo: string | null; clientes: { id: string; name: string; origen: string }[]; obras: { id: string; name: string; cliente: string }[]; propuesta: (Prop & { id: string; nombre: string; cliente: string }) | null }
type ZCli = { codigo: number; razon_social: string; cuit: string | null; localidad: string | null; remitos_12m: number; vinculado: boolean; generico: boolean }
type ZAnio = {
  codigo: number; razon_social: string; cuit: string | null; localidad: string | null; tipo_iva: string | null; vendedor: string | null; remitos_12m: number; ultimo_remito: string | null; generico: boolean
  vinculado_a: { id: string; name: string } | null; propuesto_para: { id: string; name: string } | null; mismo_nombre: boolean
  cubre: { id: string; name: string; evidencia: string; confianza: Conf; libre: boolean } | null
}
type Conteo = { faltan: number; alta: number; media: number; baja: number; sin: number }
type Datos = { clientes: FilaC[]; formulas: FilaF[]; proyectos: FilaP[]; zomatik: ZCli[]; zomatikAnio: ZAnio[]; articulos: { codigo: number; nombre: string; linea: string | null }[]; sinCruce: boolean; leido: string | null; conteos: { clientes: Conteo; formulas: Conteo; proyectos: Conteo } }
type Dias = { evidencia: string; nuestros: { fecha: string; m3: number; obra: string | null; formula: string | null; planta: string; cliente?: string | null; coincide: boolean }[]; zomatik: { fecha: string; m3: number; articulo: string; deposito: string; cliente?: string | null; remito?: string | null; coincide: boolean }[] }
type Item = { tipo: "cliente" | "formula" | "proyecto"; id: string; accion: "vincular" | "sin_par" | "quitar"; codigo?: string | number | null; etiqueta?: string }

type Pestaña = "clientes" | "formulas" | "proyectos" | "traer"
type Filtro = "revisar" | "alta" | "vinculados" | "todos"

const fechaCorta = (f: string | null) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(2, 4)}` : "")
const ORIGEN: Record<string, string> = { auto: "primera carga", manual: "a mano", traido: "traído de Zomatik", sin_par: "" }
const COLOR: Record<Conf, string> = { alta: "bg-green-100 text-green-800", media: "bg-amber-100 text-amber-800", baja: "bg-red-100 text-red-800" }

/** Botón con buscador para elegir de una lista larga. */
function Elegir({ items, onElegir, texto = "Elegir otro…", disabled }: { items: { id: string; label: string; hint?: string }[]; onElegir: (id: string, label: string) => void; texto?: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs" disabled={disabled}>
          {texto}
          <ChevronsUpDown className="ml-1 h-3 w-3 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[380px] p-0" align="end">
        <Command>
          <CommandInput placeholder="Buscar…" />
          <CommandList className="max-h-[260px]">
            <CommandEmpty>Sin resultados</CommandEmpty>
            <CommandGroup>
              {items.map((i) => (
                <CommandItem
                  key={i.id}
                  value={`${i.label} ${i.hint || ""} ${i.id}`}
                  onSelect={() => {
                    onElegir(i.id, i.label)
                    setOpen(false)
                  }}
                >
                  <span className="truncate">{i.label}</span>
                  {i.hint && <span className="ml-2 truncate text-xs text-muted-foreground">{i.hint}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function Propuesta({ p }: { p: Prop }) {
  return (
    <div className="space-y-0.5">
      <span className={cn("rounded px-1 text-[10px] font-semibold", COLOR[p.confianza])}>confianza {p.confianza}</span>
      <span className="ml-1 text-[11px] text-muted-foreground">{p.motivo}</span>
      <div className="text-[11px] text-muted-foreground">{p.evidencia}</div>
    </div>
  )
}

function Vinculado({ texto, codigo, vinculo, por }: { texto: string; codigo?: string | number | null; vinculo: string | null; por?: string | null }) {
  return (
    <div>
      <Check className="mr-1 inline h-3 w-3 text-green-700" />
      <span className="font-medium">{texto}</span>
      <span className="ml-1 text-muted-foreground">
        ({[codigo, ORIGEN[vinculo || ""], vinculo === "manual" && por ? por : ""].filter(Boolean).join(" · ")})
      </span>
    </div>
  )
}

const m3 = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 1 })

/** "Ver días": nuestros despachos y los remitos de Zomatik del candidato, lado a lado; lo que coincide, resaltado. */
function VerDias({ tipo, id, codigo }: { tipo: "cliente" | "formula" | "proyecto"; id: string; codigo: string | number }) {
  const [d, setD] = useState<Dias | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    fetch(`/api/zomatik/dias?tipo=${tipo}&id=${encodeURIComponent(id)}&codigo=${encodeURIComponent(String(codigo))}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}))
        if (!vivo) return
        if (r.ok) setD(j)
        else setError(j?.error || "No se pudieron leer los días")
      })
      .catch(() => vivo && setError("No se pudieron leer los días"))
    return () => {
      vivo = false
    }
  }, [tipo, id, codigo])
  if (error) return <div className="text-xs text-red-700">{error}</div>
  if (!d) return <div className="text-xs text-muted-foreground"><Loader2 className="mr-1 inline h-3 w-3 animate-spin" />Cargando días…</div>
  const fila = (on: boolean) => cn("border-b border-muted", on && "bg-green-50 font-medium")
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium">{d.evidencia} · <span className="rounded bg-green-50 px-1">resaltado</span> = coincide (Zomatik remite hasta 3 días después)</div>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <div className="mb-0.5 text-[11px] font-semibold">Nuestros despachos (desde 13/04)</div>
          <div className="max-h-64 overflow-y-auto rounded border">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-muted text-muted-foreground"><tr className="text-left"><th className="px-1.5 py-0.5">Fecha</th><th className="px-1.5 py-0.5 text-right">m³</th><th className="px-1.5 py-0.5">{tipo === "formula" ? "Cliente" : "Obra"}</th><th className="px-1.5 py-0.5">Fórmula</th><th className="px-1.5 py-0.5">Planta</th></tr></thead>
              <tbody>
                {d.nuestros.length === 0 && <tr><td colSpan={5} className="px-1.5 py-1 text-muted-foreground">Sin despachos</td></tr>}
                {d.nuestros.map((x, i) => (
                  <tr key={i} className={fila(x.coincide)}>
                    <td className="px-1.5 py-0.5 tabular-nums">{fechaCorta(x.fecha)}</td>
                    <td className="px-1.5 py-0.5 text-right tabular-nums">{m3(x.m3)}</td>
                    <td className="px-1.5 py-0.5">{tipo === "formula" ? x.cliente : x.obra}</td>
                    <td className="px-1.5 py-0.5">{x.formula}</td>
                    <td className="px-1.5 py-0.5">{x.planta}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <div className="mb-0.5 text-[11px] font-semibold">Remitos de Zomatik (desde 13/04)</div>
          <div className="max-h-64 overflow-y-auto rounded border">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-muted text-muted-foreground"><tr className="text-left"><th className="px-1.5 py-0.5">Fecha</th><th className="px-1.5 py-0.5 text-right">m³</th><th className="px-1.5 py-0.5">Artículo</th><th className="px-1.5 py-0.5">Depósito</th></tr></thead>
              <tbody>
                {d.zomatik.length === 0 && <tr><td colSpan={4} className="px-1.5 py-1 text-muted-foreground">Sin remitos</td></tr>}
                {d.zomatik.map((x, i) => (
                  <tr key={i} className={fila(x.coincide)}>
                    <td className="px-1.5 py-0.5 tabular-nums">{fechaCorta(x.fecha)}</td>
                    <td className="px-1.5 py-0.5 text-right tabular-nums">{m3(x.m3)}</td>
                    <td className="px-1.5 py-0.5">{x.articulo}{x.remito ? ` · ${x.remito}` : ""}</td>
                    <td className="px-1.5 py-0.5">{x.deposito}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

export function PantallaVinculos() {
  const [pestaña, setPestaña] = useState<Pestaña>("clientes")
  const [filtro, setFiltro] = useState<Filtro>("revisar")
  const [buscar, setBuscar] = useState("")
  const [d, setD] = useState<Datos | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [trabajando, setTrabajando] = useState(false)
  const [trayendo, setTrayendo] = useState<number | null>(null)
  const [resumen, setResumen] = useState<Item[] | null>(null)
  /** "tipo:id:codigo" de la fila con "Ver días" abierto */
  const [dias, setDias] = useState<string | null>(null)
  const botonDias = (tipo: "cliente" | "formula" | "proyecto", id: string, codigo: string | number) => {
    const k = `${tipo}:${id}:${codigo}`
    return (
      <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs text-blue-700" onClick={() => setDias(dias === k ? null : k)}>
        {dias === k ? "Ocultar días" : "Ver días"}
      </Button>
    )
  }
  const filaDias = (tipo: "cliente" | "formula" | "proyecto", id: string, cols: number) => {
    if (!dias || !dias.startsWith(`${tipo}:${id}:`)) return null
    const codigo = dias.slice(`${tipo}:${id}:`.length)
    return (
      <tr className="border-b bg-muted/20">
        <td colSpan={cols} className="px-3 py-2"><VerDias tipo={tipo} id={id} codigo={codigo} /></td>
      </tr>
    )
  }

  const cargar = useCallback(async () => {
    const r = await fetch("/api/zomatik/propuestas", { cache: "no-store" })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) {
      setError(j?.error || "No se pudieron calcular las propuestas. ¿Falta aplicar la migración de Zomatik?")
      return
    }
    setError(null)
    setD(j as Datos)
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  async function mandar(items: Item[]) {
    setTrabajando(true)
    try {
      let hechos = 0
      const errores: string[] = []
      for (let i = 0; i < items.length; i += 100) {
        const lote = items.slice(i, i + 100).map(({ etiqueta, ...x }) => x)
        const r = await fetch("/api/zomatik/vincular", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: lote }) })
        const j = await r.json().catch(() => ({}))
        hechos += j?.hechos || 0
        if (j?.errores?.length) errores.push(...j.errores)
        else if (!r.ok) errores.push(j?.error || "No se pudo guardar")
      }
      if (errores.length) toast.error(errores.join(" · "))
      if (hechos) toast.success(hechos > 1 ? `${hechos} vínculos guardados` : "Guardado")
      await cargar()
    } finally {
      setTrabajando(false)
    }
  }

  async function traer(z: { codigo: number }) {
    setTrayendo(z.codigo)
    try {
      const r = await fetch("/api/zomatik/traer-cliente", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ codigo: z.codigo }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) toast.error(j?.error || "No se pudo traer")
      else toast.success(`${j.cliente.name} ${j.yaEstaba ? "ya estaba" : "traído de Zomatik"}`, j.aviso ? { description: j.aviso } : undefined)
      await cargar()
    } finally {
      setTrayendo(null)
    }
  }

  const coincide = (...t: (string | null | undefined)[]) => {
    const q = tokensNombre(buscar)
    if (q.length === 0) return true
    const w = t.flatMap((x) => tokensNombre(x))
    return q.every((x) => w.some((y) => y.startsWith(x)))
  }
  const pasa = (vinculo: string | null, p: { confianza: Conf } | null) =>
    filtro === "todos" || (filtro === "revisar" ? !vinculo : filtro === "alta" ? !vinculo && p?.confianza === "alta" : !!vinculo)

  const itemsZ = useMemo(
    () => (d?.zomatik || []).map((z) => ({ id: String(z.codigo), label: z.razon_social, hint: [z.generico ? "genérico" : "", z.cuit && `CUIT ${z.cuit}`, z.localidad, z.remitos_12m ? `${z.remitos_12m} remitos en el año` : "", z.vinculado ? "ya vinculado" : ""].filter(Boolean).join(" · ") })),
    [d],
  )
  const itemsArt = useMemo(() => (d?.articulos || []).map((a) => ({ id: String(a.codigo), label: a.nombre, hint: `${a.linea || ""} · ${a.codigo}` })), [d])

  /** Todas las de confianza alta sin revisar, para el resumen antes de grabar. */
  const altas = useMemo((): Item[] => {
    if (!d) return []
    // Un mismo cliente de Zomatik no puede ir a dos nuestros: el servidor ya baja al segundo; acá además se evita
    const usadosZ = new Set<number>()
    const cs: Item[] = []
    for (const c of d.clientes)
      if (!c.vinculo && c.propuesta?.confianza === "alta" && !usadosZ.has(c.propuesta.codigo)) {
        usadosZ.add(c.propuesta.codigo)
        cs.push({ tipo: "cliente", id: c.id, accion: "vincular", codigo: c.propuesta.codigo, etiqueta: `${c.name} → ${c.propuesta.nombre}` })
      }
    const fs: Item[] = d.formulas
      .filter((f) => !f.vinculo && f.propuesta?.confianza === "alta")
      .map((f) => ({ tipo: "formula", id: f.id, accion: "vincular", codigo: f.propuesta!.codigo, etiqueta: `${f.planta}: ${f.name} → ${f.propuesta!.nombre}` }))
    const ps: Item[] = d.proyectos
      .filter((p) => !p.vinculo && p.propuesta?.confianza === "alta")
      .map((p) => ({ tipo: "proyecto", id: String(p.codigo), accion: "vincular", codigo: p.propuesta!.id, etiqueta: `${p.numero} → obra ${p.propuesta!.nombre} (${p.propuesta!.cliente})` }))
    return [...cs, ...fs, ...ps]
  }, [d])

  if (error) return <div className="p-6 text-sm text-red-700">{error}</div>
  if (!d) return <div className="p-6 text-sm text-muted-foreground"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" />Calculando propuestas…</div>

  const cuenta = {
    clientes: d.clientes.filter((c) => !c.vinculo).length,
    formulas: d.formulas.filter((f) => !f.vinculo).length,
    proyectos: d.proyectos.filter((p) => !p.vinculo).length,
    traer: d.zomatikAnio.filter((z) => !z.vinculado_a && !z.generico).length,
  }
  const Tab = ({ k, t }: { k: Pestaña; t: string }) => (
    <button onClick={() => setPestaña(k)} className={cn("rounded-md px-3 py-1.5 text-sm", pestaña === k ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>
      {t} <span className={cn("ml-1 rounded px-1 text-[11px]", pestaña === k ? "bg-white/20" : "bg-muted")}>{cuenta[k]}</span>
    </button>
  )
  const acciones = (opts: { vinculo: string | null; propuesta: { codigo?: number; id?: string } | null; item: (accion: Item["accion"], codigo?: string | number) => Item; items: { id: string; label: string; hint?: string }[]; tieneVinculo: boolean; sinPar: string }) => (
    <>
      {!opts.vinculo && opts.propuesta && (
        <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={trabajando} onClick={() => mandar([opts.item("vincular", opts.propuesta!.codigo ?? opts.propuesta!.id)])}>
          Confirmar
        </Button>
      )}
      {opts.items.length > 0 && <Elegir items={opts.items} disabled={trabajando} texto={opts.tieneVinculo ? "Cambiar…" : "Elegir otro…"} onElegir={(id) => mandar([opts.item("vincular", id)])} />}
      {!opts.vinculo && (
        <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs" disabled={trabajando} onClick={() => mandar([opts.item("sin_par")])}>
          {opts.sinPar}
        </Button>
      )}
      {opts.vinculo && (
        <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs" disabled={trabajando} title="Volver a sin revisar" onClick={() => mandar([opts.item("quitar")])}>
          <X className="h-3 w-3" />
        </Button>
      )}
    </>
  )

  return (
    <div className="space-y-3 px-4 py-4 md:px-6">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold">Vínculos con Zomatik</h1>
          <p className="text-xs text-muted-foreground">
            Qué cliente, fórmula y obra de Rebucret es cada uno de Zomatik. Las propuestas cruzan los días y m³ despachados acá (desde el 13/04, misma planta) con los remitos de Zomatik, más el nombre. Solo se guarda acá: en
            Zomatik no se toca nada. Copia de Zomatik{" "}
            {d.leido ? `leída ${new Date(d.leido).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" })}` : "todavía sin leer"} ·{" "}
            <Link href="/programacion#acopios" className="underline">Acopios</Link>
          </p>
          <p className="mt-1 text-sm font-semibold">
            Faltan {d.conteos.clientes.faltan} clientes y {d.conteos.formulas.faltan} fórmulas por resolver
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              (clientes: {d.conteos.clientes.alta} alta · {d.conteos.clientes.media} media · {d.conteos.clientes.baja} baja · {d.conteos.clientes.sin} sin propuesta — fórmulas: {d.conteos.formulas.alta} alta · {d.conteos.formulas.media} media · {d.conteos.formulas.baja} baja · {d.conteos.formulas.sin} sin propuesta — proyectos sin obra: {d.conteos.proyectos.faltan})
            </span>
          </p>
          {d.sinCruce && <p className="text-xs text-amber-700">Todavía no está el resumen diario de remitos de Zomatik: clientes y fórmulas se proponen solo por nombre hasta la próxima lectura.</p>}
        </div>
        <Button size="sm" className="h-8" disabled={trabajando || altas.length === 0} onClick={() => setResumen(altas)}>
          Confirmar todas las de confianza alta ({altas.length})
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <Tab k="clientes" t="Clientes" />
        <Tab k="formulas" t="Fórmulas" />
        <Tab k="proyectos" t="Proyectos" />
        <Tab k="traer" t="Zomatik → Rebucret" />
        <span className="flex-1" />
        {pestaña !== "traer" && (
          <select className="h-8 rounded border bg-background px-2 text-xs" value={filtro} onChange={(e) => setFiltro(e.target.value as Filtro)}>
            <option value="revisar">Para revisar</option>
            <option value="alta">Para revisar, confianza alta</option>
            <option value="vinculados">Revisados</option>
            <option value="todos">Todos</option>
          </select>
        )}
        <Input className="h-8 w-56 text-xs" placeholder="Buscar…" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
      </div>

      {pestaña === "clientes" && (
        <div className="rounded-lg border bg-card">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b text-left">
                <th className="px-3 py-1.5 font-medium">Cliente en Rebucret</th>
                <th className="px-3 py-1.5 font-medium">En Zomatik</th>
                <th className="px-3 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {d.clientes
                .filter((c) => pasa(c.vinculo, c.propuesta) && coincide(c.name))
                .map((c) => (
                  <Fragment key={c.id}>
                  <tr className="border-b align-top last:border-0">
                    <td className="px-3 py-1.5">
                      <div className="font-medium">{c.name}</div>
                      <div className="text-muted-foreground">{[c.cuit && `CUIT ${c.cuit}`, `${c.despachos} despachos desde abril`].filter(Boolean).join(" · ")}</div>
                      {c.duplicado && <div className="text-[11px] text-amber-700"><AlertTriangle className="mr-0.5 inline h-3 w-3" />{c.duplicado}</div>}
                    </td>
                    <td className="px-3 py-1.5">
                      {c.vinculo === "sin_par" ? (
                        <span className="text-muted-foreground">No está en Zomatik</span>
                      ) : c.zomatik_codigo != null ? (
                        <Vinculado texto={c.zomatik_nombre || `código ${c.zomatik_codigo}`} codigo={c.zomatik_codigo} vinculo={c.vinculo} por={c.vinculado_por} />
                      ) : c.propuesta ? (
                        <div className="space-y-0.5">
                          <div>
                            <span className="font-medium">{c.propuesta.nombre}</span>
                            <span className="ml-1 text-muted-foreground">({c.propuesta.codigo}{c.propuesta.cuit ? ` · CUIT ${c.propuesta.cuit}` : ""})</span>
                          </div>
                          <Propuesta p={c.propuesta} />
                        </div>
                      ) : (
                        <span className="text-muted-foreground">Sin par por nombre</span>
                      )}
                      {!c.vinculo && c.candidatos.length > 0 && (
                        <div className="mt-1 space-y-0.5 border-t pt-1">
                          <div className="text-[10px] font-semibold uppercase text-muted-foreground">Mejores por fechas y m³ (sin mirar el nombre)</div>
                          {c.candidatos.map((k) => (
                            <div key={k.codigo} className="flex flex-wrap items-center gap-1">
                              <span className={cn("rounded px-1 text-[10px] font-semibold", COLOR[k.confianza])}>{k.confianza}</span>
                              <span className="font-medium">{k.nombre}</span>
                              <span className="text-[11px] text-muted-foreground">({k.codigo}) {k.evidencia}</span>
                              <Button size="sm" variant="ghost" className="h-5 px-1 text-[11px]" disabled={trabajando} onClick={() => mandar([{ tipo: "cliente", id: c.id, accion: "vincular", codigo: k.codigo }])}>Elegir</Button>
                              {botonDias("cliente", c.id, k.codigo)}
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right">
                      {acciones({
                        vinculo: c.vinculo,
                        propuesta: c.propuesta,
                        item: (accion, codigo) => ({ tipo: "cliente", id: c.id, accion, codigo: codigo != null ? Number(codigo) : null }),
                        items: itemsZ,
                        tieneVinculo: c.zomatik_codigo != null,
                        sinPar: "Sin par",
                      })}
                      {(c.zomatik_codigo ?? c.propuesta?.codigo) != null && botonDias("cliente", c.id, (c.zomatik_codigo ?? c.propuesta?.codigo)!)}
                    </td>
                  </tr>
                  {filaDias("cliente", c.id, 3)}
                  </Fragment>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {pestaña === "formulas" && (
        <div className="rounded-lg border bg-card">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b text-left">
                <th className="px-3 py-1.5 font-medium">Fórmula</th>
                <th className="px-3 py-1.5 font-medium">Planta</th>
                <th className="px-3 py-1.5 font-medium">Artículo de Zomatik</th>
                <th className="px-3 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {d.formulas
                .filter((f) => pasa(f.vinculo, f.propuesta) && coincide(f.name, f.planta))
                .sort((a, b) => a.planta.localeCompare(b.planta) || a.name.localeCompare(b.name))
                .map((f) => (
                  <Fragment key={f.id}>
                  <tr className="border-b align-top last:border-0">
                    <td className="px-3 py-1.5 font-medium">{f.name}</td>
                    <td className="px-3 py-1.5">{f.planta}</td>
                    <td className="px-3 py-1.5">
                      {f.vinculo === "sin_par" ? (
                        <span className="text-muted-foreground">Sin artículo en Zomatik</span>
                      ) : f.codigo != null ? (
                        <Vinculado texto={f.nombre || String(f.codigo)} codigo={f.codigo} vinculo={f.vinculo} por={f.vinculado_por} />
                      ) : f.propuesta ? (
                        <div className="space-y-0.5">
                          <div className="font-medium">{f.propuesta.nombre} <span className="font-normal text-muted-foreground">({f.propuesta.codigo})</span></div>
                          <Propuesta p={f.propuesta} />
                        </div>
                      ) : (
                        <span className="text-muted-foreground">Sin par por nombre</span>
                      )}
                      {f.ranking.length > 0 && (
                        <div className="mt-1 space-y-0.5 border-t pt-1">
                          <div className="text-[10px] font-semibold uppercase text-muted-foreground">En los remitos de los mismos días y clientes</div>
                          {f.ranking.map((k) => (
                            <div key={k.codigo} className="flex flex-wrap items-center gap-1">
                              <span className="font-medium">{k.nombre}</span>
                              <span className="text-[11px] text-muted-foreground">{k.pct} % ({k.dias} de {k.base} días)</span>
                              {!f.vinculo && <Button size="sm" variant="ghost" className="h-5 px-1 text-[11px]" disabled={trabajando} onClick={() => mandar([{ tipo: "formula", id: f.id, accion: "vincular", codigo: k.codigo }])}>Elegir</Button>}
                              {botonDias("formula", f.id, k.codigo)}
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right">
                      {acciones({
                        vinculo: f.vinculo,
                        propuesta: f.propuesta,
                        item: (accion, codigo) => ({ tipo: "formula", id: f.id, accion, codigo: codigo != null ? Number(codigo) : null }),
                        items: itemsArt,
                        tieneVinculo: f.codigo != null,
                        sinPar: "No tiene",
                      })}
                      {(f.codigo ?? f.propuesta?.codigo) != null && botonDias("formula", f.id, (f.codigo ?? f.propuesta?.codigo)!)}
                    </td>
                  </tr>
                  {filaDias("formula", f.id, 4)}
                  </Fragment>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {pestaña === "proyectos" && (
        <div className="rounded-lg border bg-card">
          <div className="border-b px-3 py-2 text-xs text-muted-foreground">
            En Zomatik no hay maestro de obras: nuestras obras se vinculan a través de los proyectos. Se proponen entre las obras del cliente (vinculado, propuesto o con el mismo nombre), cruzando los remitos del proyecto con
            los despachos a cada obra. Varios proyectos pueden ir a la misma obra.
          </div>
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b text-left">
                <th className="px-3 py-1.5 font-medium">Proyecto</th>
                <th className="px-3 py-1.5 font-medium">Cliente · obra en Zomatik</th>
                <th className="px-3 py-1.5 font-medium">Obra en Rebucret</th>
                <th className="px-3 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {d.proyectos
                .filter((p) => pasa(p.vinculo, p.propuesta) && coincide(p.numero, p.cliente_nombre, p.obra))
                .map((p) => {
                  const obraActual = p.construction_site_id ? p.obras.find((o) => o.id === p.construction_site_id) : null
                  const obraVer = p.construction_site_id || p.propuesta?.id || null
                  return (
                    <Fragment key={p.codigo}>
                    <tr className="border-b align-top last:border-0">
                      <td className="whitespace-nowrap px-3 py-1.5 font-semibold">{p.numero}</td>
                      <td className="px-3 py-1.5">
                        <div className="font-medium">{p.cliente_nombre} <span className="font-normal text-muted-foreground">({p.cliente_codigo})</span></div>
                        <div className="text-muted-foreground">{p.obra || "—"}{p.ultima_entrega ? ` · última entrega ${fechaCorta(p.ultima_entrega)}` : ""}</div>
                        {p.clientes.length === 0 && (
                          <div className="text-[11px] text-amber-700">
                            Cliente sin par en Rebucret · <button className="underline" onClick={() => { setPestaña("clientes"); setBuscar(p.cliente_nombre || "") }}>buscarlo</button>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        {p.vinculo === "sin_par" ? (
                          <span className="text-muted-foreground">Sin obra en Rebucret</span>
                        ) : p.construction_site_id ? (
                          <Vinculado texto={obraActual ? `${obraActual.name} (${obraActual.cliente})` : "obra vinculada"} vinculo={p.vinculo} />
                        ) : p.propuesta ? (
                          <div className="space-y-0.5">
                            <div className="font-medium">{p.propuesta.nombre} <span className="font-normal text-muted-foreground">({p.propuesta.cliente})</span></div>
                            <Propuesta p={p.propuesta} />
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right">
                        {acciones({
                          vinculo: p.vinculo,
                          propuesta: p.propuesta ? { id: p.propuesta.id } : null,
                          item: (accion, codigo) => ({ tipo: "proyecto", id: String(p.codigo), accion, codigo: codigo != null ? String(codigo) : null }),
                          items: p.obras.map((o) => ({ id: o.id, label: o.name, hint: o.cliente })),
                          tieneVinculo: !!p.construction_site_id,
                          sinPar: "Sin obra",
                        })}
                        {obraVer && botonDias("proyecto", String(p.codigo), obraVer)}
                      </td>
                    </tr>
                    {filaDias("proyecto", String(p.codigo), 4)}
                    </Fragment>
                  )
                })}
            </tbody>
          </table>
        </div>
      )}

      {pestaña === "traer" && (
        <div className="rounded-lg border bg-card">
          <div className="border-b px-3 py-2 text-xs text-muted-foreground">
            Al revés: cada cliente de Zomatik con remitos en el último año y cuál de los nuestros cubre sus días (fechas, m³ y planta). Si nadie lo cubre y no está en Rebucret, "Traer" lo crea acá, vinculado. Los genéricos
            (mostrador, consumidor final, varios) no se proponen. En Zomatik no se toca nada.
          </div>
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b text-left">
                <th className="px-3 py-1.5 font-medium">Cliente de Zomatik</th>
                <th className="px-3 py-1.5 text-right font-medium">Remitos</th>
                <th className="px-3 py-1.5 font-medium">En Rebucret</th>
                <th className="px-3 py-1.5 font-medium">Lo cubre (por fechas y m³)</th>
                <th className="px-3 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {d.zomatikAnio
                .filter((z) => (filtro === "todos" || filtro === "vinculados" ? true : !z.vinculado_a) && (filtro !== "vinculados" || !!z.vinculado_a) && (filtro !== "alta" || z.cubre?.confianza === "alta") && coincide(z.razon_social, z.cuit, z.cubre?.name))
                .map((z) => (
                  <Fragment key={z.codigo}>
                    <tr className="border-b align-top last:border-0">
                      <td className="px-3 py-1.5">
                        <span className="font-medium">{z.razon_social}</span> <span className="text-muted-foreground">({z.codigo})</span>
                        {z.generico && <span className="ml-1 rounded bg-muted px-1 text-[10px]">genérico</span>}
                        <div className="text-muted-foreground">{[z.cuit && `CUIT ${z.cuit}`, z.tipo_iva, z.localidad, z.vendedor, z.ultimo_remito && `último ${fechaCorta(z.ultimo_remito)}`].filter(Boolean).join(" · ")}</div>
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{z.remitos_12m}</td>
                      <td className="px-3 py-1.5">
                        {z.vinculado_a ? (
                          <span><Check className="mr-1 inline h-3 w-3 text-green-700" />{z.vinculado_a.name}</span>
                        ) : z.propuesto_para ? (
                          <span className="text-muted-foreground">propuesto para {z.propuesto_para.name}</span>
                        ) : z.mismo_nombre ? (
                          <span className="text-amber-700">hay uno con el mismo nombre</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        {z.cubre ? (
                          <div className="space-y-0.5">
                            <div><span className={cn("rounded px-1 text-[10px] font-semibold", COLOR[z.cubre.confianza])}>{z.cubre.confianza}</span> <span className="font-medium">{z.cubre.name}</span>{!z.cubre.libre && <span className="ml-1 text-[11px] text-muted-foreground">(ya vinculado)</span>}</div>
                            <div className="text-[11px] text-muted-foreground">{z.cubre.evidencia}</div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">Ninguno de los nuestros coincide</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right">
                        {!z.vinculado_a && !z.generico && z.cubre?.libre && (
                          <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={trabajando} onClick={() => mandar([{ tipo: "cliente", id: z.cubre!.id, accion: "vincular", codigo: z.codigo }])}>
                            Vincular con {z.cubre.name.length > 16 ? z.cubre.name.slice(0, 15) + "…" : z.cubre.name}
                          </Button>
                        )}
                        {!z.vinculado_a && !z.generico && !z.mismo_nombre && (
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={trayendo !== null} onClick={() => traer(z)}>
                            {trayendo === z.codigo ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="mr-1 h-3 w-3" />}
                            Traer
                          </Button>
                        )}
                        {z.cubre && botonDias("cliente", z.cubre.id, z.codigo)}
                      </td>
                    </tr>
                    {z.cubre && filaDias("cliente", z.cubre.id, 5)}
                  </Fragment>
                ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!resumen} onOpenChange={(v) => !v && !trabajando && setResumen(null)}>
        <DialogContent className="sm:max-w-[640px]">
          <DialogHeader><DialogTitle>Confirmar las de confianza alta</DialogTitle></DialogHeader>
          {resumen && (
            <div className="space-y-2 text-sm">
              <p className="text-muted-foreground">
                Se van a grabar {resumen.length} vínculos (solo en Rebucret): {resumen.filter((i) => i.tipo === "cliente").length} clientes, {resumen.filter((i) => i.tipo === "formula").length} fórmulas y{" "}
                {resumen.filter((i) => i.tipo === "proyecto").length} proyectos. Los que ya tienen vínculo no se tocan.
              </p>
              <div className="max-h-[50vh] space-y-2 overflow-y-auto rounded border p-2 text-xs">
                {(["cliente", "formula", "proyecto"] as const).map((t) => {
                  const del = resumen.filter((i) => i.tipo === t)
                  if (!del.length) return null
                  return (
                    <div key={t}>
                      <div className="font-semibold">{t === "cliente" ? "Clientes" : t === "formula" ? "Fórmulas" : "Proyectos"}</div>
                      <ul className="list-disc pl-4">{del.map((i) => <li key={`${i.tipo}${i.id}`}>{i.etiqueta}</li>)}</ul>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setResumen(null)} disabled={trabajando}>Volver</Button>
            <Button
              disabled={trabajando}
              onClick={async () => {
                const items = resumen || []
                await mandar(items)
                setResumen(null)
              }}
            >
              {trabajando ? <Loader2 className="h-4 w-4 animate-spin" /> : `Grabar ${resumen?.length || 0}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
