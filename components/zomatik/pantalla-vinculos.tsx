"use client"

/**
 * Zomatik Z0 · "Vínculos con Zomatik" (solo gerenciales). Confirmar o corregir a mano:
 *   - clientes nuestros ↔ clientes de Zomatik;
 *   - fórmulas ↔ artículos de Zomatik;
 *   - proyectos (acopios) abiertos ↔ obras nuestras;
 * y traer los clientes de Zomatik con remitos en el año que no están en Rebucret.
 * Las propuestas usan las mismas reglas que el script de primera carga (lib/zomatik/vinculos.ts).
 * Escribe solo en nuestra base (/api/zomatik/vincular, /api/zomatik/traer-cliente). No toca Zomatik.
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Check, ChevronsUpDown, Download, Loader2, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"
import { proponerClientes, proponerFormulas, proponerProyectos, yaEstaEnRebucret, type Propuesta } from "@/lib/zomatik/vinculos"
import { tokensNombre } from "@/lib/zomatik/parseo"

type ZCli = { codigo: number; razon_social: string; cuit: string | null; tipo_iva: string | null; localidad: string | null; vendedor: string | null; remitos_12m: number; ultimo_remito: string | null; activo: boolean }
type Cli = { id: string; name: string; razon_social: string | null; cuit: string | null; zomatik_codigo: number | null; zomatik_vinculo: string | null; zomatik_vinculado_por: string | null }
type Form = { id: string; name: string; code: string | null; planta: string; zomatik_articulo_codigo: number | null; zomatik_articulo_nombre: string | null; zomatik_vinculo: string | null }
type Art = { codigo: number; nombre: string; linea: string | null }
type Proy = { codigo: number; numero: string; cliente_codigo: number | null; cliente_nombre: string | null; obra: string | null; construction_site_id: string | null; vinculo: string | null; ultima_entrega: string | null }
type Obra = { id: string; name: string; client_id: string }
type Item = { tipo: "cliente" | "formula" | "proyecto"; id: string; accion: "vincular" | "sin_par" | "quitar"; codigo?: string | number | null }

type Pestaña = "clientes" | "formulas" | "proyectos" | "traer"
type Filtro = "revisar" | "vinculados" | "todos"

const fechaCorta = (f: string | null) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(2, 4)}` : "")
const ORIGEN: Record<string, string> = { auto: "primera carga", manual: "a mano", traido: "traído de Zomatik", sin_par: "" }

/** Botón con buscador para elegir de una lista larga. */
function Elegir({ items, onElegir, texto = "Elegir otro…", disabled }: { items: { id: string; label: string; hint?: string }[]; onElegir: (id: string) => void; texto?: string; disabled?: boolean }) {
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
                    onElegir(i.id)
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

function Certeza({ p }: { p: Propuesta<unknown> }) {
  return (
    <span className={cn("rounded px-1 text-[10px] font-medium", p.certeza === "seguro" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800")} title={p.motivo}>
      {p.certeza === "seguro" ? "seguro" : "dudoso"} · {p.motivo}
    </span>
  )
}

export function PantallaVinculos() {
  const [pestaña, setPestaña] = useState<Pestaña>("clientes")
  const [filtro, setFiltro] = useState<Filtro>("revisar")
  const [buscar, setBuscar] = useState("")
  const [zcli, setZcli] = useState<ZCli[] | null>(null)
  const [leido, setLeido] = useState<string | null>(null)
  const [clientes, setClientes] = useState<Cli[]>([])
  const [formulas, setFormulas] = useState<Form[]>([])
  const [arts, setArts] = useState<Art[]>([])
  const [proys, setProys] = useState<Proy[]>([])
  const [obras, setObras] = useState<Obra[]>([])
  const [error, setError] = useState<string | null>(null)
  const [trabajando, setTrabajando] = useState(false)
  const [trayendo, setTrayendo] = useState<number | null>(null)

  const cargar = useCallback(async () => {
    const sb = createClient()
    const [rz, cs, fs, ps, as, pr, os] = await Promise.all([
      fetch("/api/zomatik/clientes", { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
      sb.from("clients").select("id, name, razon_social, cuit, zomatik_codigo, zomatik_vinculo, zomatik_vinculado_por").neq("active", false).order("name"),
      sb.from("formulas").select("id, name, code, plant_id, zomatik_articulo_codigo, zomatik_articulo_nombre, zomatik_vinculo").order("name"),
      sb.from("plants").select("id, name"),
      sb.from("zomatik_articulos" as any).select("codigo, nombre, linea").order("nombre"),
      fetch("/api/zomatik/acopios", { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
      sb.from("construction_sites").select("id, name, client_id").order("name"),
    ])
    if (cs.error || as.error || !pr?.proyectos) {
      setError("Falta aplicar la migración de Zomatik (202610211800_zomatik_z0_lecturas.sql).")
      return
    }
    setError(null)
    setZcli(rz?.clientes || [])
    setLeido(rz?.leido || null)
    setClientes((cs.data as any[]) || [])
    const plantas = new Map(((ps.data as any[]) || []).map((p) => [p.id, p.name]))
    setFormulas((((fs.data as any[]) || []) as any[]).map((f) => ({ ...f, planta: plantas.get(f.plant_id) || "" })))
    setArts((as.data as any[]) || [])
    setProys(((pr.proyectos as Proy[]) || []).sort((a, b) => a.numero.localeCompare(b.numero)))
    setObras((os.data as any[]) || [])
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  async function mandar(items: Item[]) {
    setTrabajando(true)
    try {
      const r = await fetch("/api/zomatik/vincular", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }) })
      const d = await r.json().catch(() => ({}))
      if (d?.errores?.length) toast.error(d.errores.join(" · "))
      else if (!r.ok) toast.error(d?.error || "No se pudo guardar")
      else toast.success(items.length > 1 ? `${d.hechos} vínculos guardados` : "Guardado")
      await cargar()
    } finally {
      setTrabajando(false)
    }
  }

  async function traer(z: ZCli) {
    setTrayendo(z.codigo)
    try {
      const r = await fetch("/api/zomatik/traer-cliente", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ codigo: z.codigo }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) toast.error(d?.error || "No se pudo traer")
      else toast.success(`${d.cliente.name} ${d.yaEstaba ? "ya estaba" : "traído de Zomatik"}`, d.aviso ? { description: d.aviso } : undefined)
      await cargar()
    } finally {
      setTrayendo(null)
    }
  }

  // ── Propuestas ──
  const zPorCodigo = useMemo(() => new Map((zcli || []).map((z) => [z.codigo, z])), [zcli])
  const usados = useMemo(() => new Set(clientes.filter((c) => c.zomatik_codigo != null).map((c) => c.zomatik_codigo as number)), [clientes])
  const propC = useMemo(
    () => proponerClientes(clientes.filter((c) => !c.zomatik_vinculo), (zcli || []).filter((z) => z.activo && !usados.has(z.codigo))),
    [clientes, zcli, usados],
  )
  const propF = useMemo(() => proponerFormulas(formulas.filter((f) => !f.zomatik_vinculo), arts), [formulas, arts])
  const clientePorCodigo = useMemo(() => new Map(clientes.filter((c) => c.zomatik_codigo != null).map((c) => [c.zomatik_codigo as number, c.id])), [clientes])
  const propP = useMemo(() => proponerProyectos(proys.filter((p) => !p.vinculo), obras, clientePorCodigo), [proys, obras, clientePorCodigo])
  const nombreCliente = useMemo(() => new Map(clientes.map((c) => [c.id, c.name])), [clientes])
  const nombreObra = useMemo(() => new Map(obras.map((o) => [o.id, o.name])), [obras])

  const coincide = (...t: (string | null | undefined)[]) => {
    const q = tokensNombre(buscar)
    if (q.length === 0) return true
    const w = t.flatMap((x) => tokensNombre(x))
    return q.every((x) => w.some((y) => y.startsWith(x)))
  }
  const pasaFiltro = (vinculo: string | null) => filtro === "todos" || (filtro === "revisar" ? !vinculo : !!vinculo)

  const itemsZ = useMemo(
    () =>
      (zcli || [])
        .filter((z) => z.activo)
        .map((z) => ({ id: String(z.codigo), label: z.razon_social, hint: [z.cuit && `CUIT ${z.cuit}`, z.localidad, z.remitos_12m ? `${z.remitos_12m} remitos en el año` : "", usados.has(z.codigo) ? "ya vinculado" : ""].filter(Boolean).join(" · ") })),
    [zcli, usados],
  )
  const itemsArt = useMemo(() => arts.filter((a) => !/servicio/i.test(a.linea || "")).map((a) => ({ id: String(a.codigo), label: a.nombre, hint: `${a.linea || ""} · ${a.codigo}` })), [arts])

  const segurosC = [...propC.entries()].filter(([, p]) => p.certeza === "seguro")
  const segurosF = [...propF.entries()].filter(([, p]) => p.certeza === "seguro")
  const segurosP = [...propP.entries()].filter(([, p]) => p.certeza === "seguro")
  const paraTraer = useMemo(
    () => (zcli || []).filter((z) => z.activo && z.remitos_12m > 0 && !usados.has(z.codigo) && !yaEstaEnRebucret(z, clientes)).sort((a, b) => String(b.ultimo_remito || "").localeCompare(String(a.ultimo_remito || ""))),
    [zcli, usados, clientes],
  )

  const cuenta = {
    clientes: clientes.filter((c) => !c.zomatik_vinculo).length,
    formulas: formulas.filter((f) => !f.zomatik_vinculo).length,
    proyectos: proys.filter((p) => !p.vinculo).length,
    traer: paraTraer.length,
  }

  if (error) return <div className="p-6 text-sm text-red-700">{error}</div>
  if (!zcli) return <div className="p-6 text-sm text-muted-foreground"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" />Cargando…</div>

  const Tab = ({ k, t }: { k: Pestaña; t: string }) => (
    <button onClick={() => setPestaña(k)} className={cn("rounded-md px-3 py-1.5 text-sm", pestaña === k ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>
      {t} <span className={cn("ml-1 rounded px-1 text-[11px]", pestaña === k ? "bg-white/20" : "bg-muted")}>{cuenta[k]}</span>
    </button>
  )

  return (
    <div className="space-y-3 px-4 py-4 md:px-6">
      <div>
        <h1 className="text-xl font-bold">Vínculos con Zomatik</h1>
        <p className="text-xs text-muted-foreground">
          Qué cliente, fórmula y obra de Rebucret es cada uno de Zomatik. Solo se guarda acá: en Zomatik no se toca nada. Copia de Zomatik{" "}
          {leido ? `leída ${new Date(leido).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" })}` : "todavía sin leer"}{" "}
          · <Link href="/programacion#acopios" className="underline">Acopios</Link>
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <Tab k="clientes" t="Clientes" />
        <Tab k="formulas" t="Fórmulas" />
        <Tab k="proyectos" t="Proyectos" />
        <Tab k="traer" t="En Zomatik sin cliente nuestro" />
        <span className="flex-1" />
        {pestaña !== "traer" && (
          <select className="h-8 rounded border bg-background px-2 text-xs" value={filtro} onChange={(e) => setFiltro(e.target.value as Filtro)}>
            <option value="revisar">Para revisar</option>
            <option value="vinculados">Revisados</option>
            <option value="todos">Todos</option>
          </select>
        )}
        <Input className="h-8 w-56 text-xs" placeholder="Buscar…" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
      </div>

      {pestaña === "clientes" && (
        <div className="rounded-lg border bg-card">
          <div className="flex items-center gap-2 border-b px-3 py-2 text-xs">
            <span className="text-muted-foreground">Seguro = CUIT válido igual o nombre igual (sin tildes ni S.A.), único. Dudoso = nombre parecido: confirmalo o elegí otro.</span>
            <span className="flex-1" />
            {segurosC.length > 0 && (
              <Button size="sm" className="h-7 text-xs" disabled={trabajando} onClick={() => mandar(segurosC.map(([id, p]) => ({ tipo: "cliente", id, accion: "vincular", codigo: p.candidato.codigo })))}>
                Confirmar los {segurosC.length} seguros
              </Button>
            )}
          </div>
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b text-left">
                <th className="px-3 py-1.5 font-medium">Cliente en Rebucret</th>
                <th className="px-3 py-1.5 font-medium">En Zomatik</th>
                <th className="px-3 py-1.5 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {clientes
                .filter((c) => pasaFiltro(c.zomatik_vinculo) && coincide(c.name, c.razon_social))
                .map((c) => {
                  const z = c.zomatik_codigo != null ? zPorCodigo.get(c.zomatik_codigo) : undefined
                  const p = propC.get(c.id)
                  return (
                    <tr key={c.id} className="border-b last:border-0">
                      <td className="px-3 py-1.5">
                        <div className="font-medium">{c.name}</div>
                        {c.cuit && <div className="text-muted-foreground">CUIT {c.cuit}</div>}
                      </td>
                      <td className="px-3 py-1.5">
                        {c.zomatik_vinculo === "sin_par" ? (
                          <span className="text-muted-foreground">No está en Zomatik</span>
                        ) : c.zomatik_codigo != null ? (
                          <div>
                            <Check className="mr-1 inline h-3 w-3 text-green-700" />
                            <span className="font-medium">{z?.razon_social || `código ${c.zomatik_codigo}`}</span>
                            <span className="ml-1 text-muted-foreground">({c.zomatik_codigo}{ORIGEN[c.zomatik_vinculo || ""] ? ` · ${ORIGEN[c.zomatik_vinculo || ""]}` : ""})</span>
                          </div>
                        ) : p ? (
                          <div className="space-y-0.5">
                            <div>
                              <span className="font-medium">{p.candidato.razon_social}</span>
                              <span className="ml-1 text-muted-foreground">({p.candidato.codigo}{zPorCodigo.get(p.candidato.codigo)?.cuit ? ` · CUIT ${zPorCodigo.get(p.candidato.codigo)?.cuit}` : ""})</span>
                            </div>
                            <Certeza p={p} />
                          </div>
                        ) : (
                          <span className="text-muted-foreground">Sin par</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right">
                        {!c.zomatik_vinculo && p && (
                          <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={trabajando} onClick={() => mandar([{ tipo: "cliente", id: c.id, accion: "vincular", codigo: p.candidato.codigo }])}>
                            Confirmar
                          </Button>
                        )}
                        <Elegir items={itemsZ} disabled={trabajando} texto={c.zomatik_codigo != null ? "Cambiar…" : "Elegir otro…"} onElegir={(cod) => mandar([{ tipo: "cliente", id: c.id, accion: "vincular", codigo: Number(cod) }])} />
                        {!c.zomatik_vinculo && (
                          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs" disabled={trabajando} onClick={() => mandar([{ tipo: "cliente", id: c.id, accion: "sin_par" }])}>
                            No está
                          </Button>
                        )}
                        {c.zomatik_vinculo && (
                          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs" disabled={trabajando} title="Volver a sin revisar" onClick={() => mandar([{ tipo: "cliente", id: c.id, accion: "quitar" }])}>
                            <X className="h-3 w-3" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
      )}

      {pestaña === "formulas" && (
        <div className="rounded-lg border bg-card">
          <div className="flex items-center gap-2 border-b px-3 py-2 text-xs">
            <span className="text-muted-foreground">Seguro = nombre igual, o igual con las reglas (sufijo de planta, 6/12 → 612, GUN → GUNITADO). Dudoso = mismo hormigón y medidas parecidas.</span>
            <span className="flex-1" />
            {segurosF.length > 0 && (
              <Button size="sm" className="h-7 text-xs" disabled={trabajando} onClick={() => mandar(segurosF.map(([id, p]) => ({ tipo: "formula", id, accion: "vincular", codigo: p.candidato.codigo })))}>
                Confirmar las {segurosF.length} seguras
              </Button>
            )}
          </div>
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
              {formulas
                .filter((f) => pasaFiltro(f.zomatik_vinculo) && coincide(f.name, f.code, f.planta))
                .sort((a, b) => a.planta.localeCompare(b.planta) || a.name.localeCompare(b.name))
                .map((f) => {
                  const p = propF.get(f.id)
                  return (
                    <tr key={f.id} className="border-b last:border-0">
                      <td className="px-3 py-1.5 font-medium">{f.name}</td>
                      <td className="px-3 py-1.5">{f.planta}</td>
                      <td className="px-3 py-1.5">
                        {f.zomatik_vinculo === "sin_par" ? (
                          <span className="text-muted-foreground">Sin artículo en Zomatik</span>
                        ) : f.zomatik_articulo_codigo != null ? (
                          <span>
                            <Check className="mr-1 inline h-3 w-3 text-green-700" />
                            <span className="font-medium">{f.zomatik_articulo_nombre}</span>
                            <span className="ml-1 text-muted-foreground">({f.zomatik_articulo_codigo}{ORIGEN[f.zomatik_vinculo || ""] ? ` · ${ORIGEN[f.zomatik_vinculo || ""]}` : ""})</span>
                          </span>
                        ) : p ? (
                          <div className="space-y-0.5">
                            <div className="font-medium">{p.candidato.nombre}</div>
                            <Certeza p={p} />
                          </div>
                        ) : (
                          <span className="text-muted-foreground">Sin par</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right">
                        {!f.zomatik_vinculo && p && (
                          <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={trabajando} onClick={() => mandar([{ tipo: "formula", id: f.id, accion: "vincular", codigo: p.candidato.codigo }])}>
                            Confirmar
                          </Button>
                        )}
                        <Elegir items={itemsArt} disabled={trabajando} texto={f.zomatik_articulo_codigo != null ? "Cambiar…" : "Elegir otro…"} onElegir={(cod) => mandar([{ tipo: "formula", id: f.id, accion: "vincular", codigo: Number(cod) }])} />
                        {!f.zomatik_vinculo && (
                          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs" disabled={trabajando} onClick={() => mandar([{ tipo: "formula", id: f.id, accion: "sin_par" }])}>
                            No tiene
                          </Button>
                        )}
                        {f.zomatik_vinculo && (
                          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs" disabled={trabajando} title="Volver a sin revisar" onClick={() => mandar([{ tipo: "formula", id: f.id, accion: "quitar" }])}>
                            <X className="h-3 w-3" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
      )}

      {pestaña === "proyectos" && (
        <div className="rounded-lg border bg-card">
          <div className="flex items-center gap-2 border-b px-3 py-2 text-xs">
            <span className="text-muted-foreground">Proyectos abiertos de Zomatik. Primero tiene que estar vinculado el cliente; después se elige una de sus obras (varios proyectos pueden ir a la misma obra).</span>
            <span className="flex-1" />
            {segurosP.length > 0 && (
              <Button size="sm" className="h-7 text-xs" disabled={trabajando} onClick={() => mandar(segurosP.map(([cod, p]) => ({ tipo: "proyecto", id: String(cod), accion: "vincular", codigo: p.candidato.id })))}>
                Confirmar los {segurosP.length} seguros
              </Button>
            )}
          </div>
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b text-left">
                <th className="px-3 py-1.5 font-medium">Proyecto</th>
                <th className="px-3 py-1.5 font-medium">Cliente · obra en Zomatik</th>
                <th className="px-3 py-1.5 font-medium">Cliente en Rebucret</th>
                <th className="px-3 py-1.5 font-medium">Obra en Rebucret</th>
                <th className="px-3 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {proys
                .filter((p) => pasaFiltro(p.vinculo) && coincide(p.numero, p.cliente_nombre, p.obra))
                .map((p) => {
                  const cli = p.cliente_codigo != null ? clientePorCodigo.get(p.cliente_codigo) : undefined
                  const pr = propP.get(p.codigo)
                  const obrasCli = cli ? obras.filter((o) => o.client_id === cli).map((o) => ({ id: o.id, label: o.name })) : []
                  return (
                    <tr key={p.codigo} className="border-b last:border-0">
                      <td className="whitespace-nowrap px-3 py-1.5 font-semibold">{p.numero}</td>
                      <td className="px-3 py-1.5">
                        <div className="font-medium">{p.cliente_nombre} <span className="font-normal text-muted-foreground">({p.cliente_codigo})</span></div>
                        <div className="text-muted-foreground">{p.obra || "—"}{p.ultima_entrega ? ` · última entrega ${fechaCorta(p.ultima_entrega)}` : ""}</div>
                      </td>
                      <td className="px-3 py-1.5">{cli ? nombreCliente.get(cli) : <span className="text-amber-700">Sin vincular · <button className="underline" onClick={() => { setPestaña("clientes"); setBuscar(p.cliente_nombre || "") }}>vincular</button></span>}</td>
                      <td className="px-3 py-1.5">
                        {p.vinculo === "sin_par" ? (
                          <span className="text-muted-foreground">Sin obra en Rebucret</span>
                        ) : p.construction_site_id ? (
                          <span><Check className="mr-1 inline h-3 w-3 text-green-700" />{nombreObra.get(p.construction_site_id) || "—"}<span className="ml-1 text-muted-foreground">({ORIGEN[p.vinculo || ""]})</span></span>
                        ) : pr ? (
                          <div className="space-y-0.5"><div className="font-medium">{pr.candidato.name}</div><Certeza p={pr} /></div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right">
                        {!p.vinculo && pr && (
                          <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={trabajando} onClick={() => mandar([{ tipo: "proyecto", id: String(p.codigo), accion: "vincular", codigo: pr.candidato.id }])}>
                            Confirmar
                          </Button>
                        )}
                        {cli && <Elegir items={obrasCli} disabled={trabajando} texto={p.construction_site_id ? "Cambiar…" : "Elegir obra…"} onElegir={(id) => mandar([{ tipo: "proyecto", id: String(p.codigo), accion: "vincular", codigo: id }])} />}
                        {!p.vinculo && (
                          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs" disabled={trabajando} onClick={() => mandar([{ tipo: "proyecto", id: String(p.codigo), accion: "sin_par" }])}>
                            Sin obra
                          </Button>
                        )}
                        {p.vinculo && (
                          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs" disabled={trabajando} title="Volver a sin revisar" onClick={() => mandar([{ tipo: "proyecto", id: String(p.codigo), accion: "quitar" }])}>
                            <X className="h-3 w-3" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
      )}

      {pestaña === "traer" && (
        <div className="rounded-lg border bg-card">
          <div className="border-b px-3 py-2 text-xs text-muted-foreground">
            Clientes de Zomatik con remitos en el último año que no están en Rebucret (ni por código ni por el mismo nombre). "Traer" los crea en Rebucret, vinculados. En Zomatik no se toca nada.
          </div>
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b text-left">
                <th className="px-3 py-1.5 font-medium">Cliente de Zomatik</th>
                <th className="px-3 py-1.5 font-medium">Datos</th>
                <th className="px-3 py-1.5 text-right font-medium">Remitos en el año</th>
                <th className="px-3 py-1.5 font-medium">Último</th>
                <th className="px-3 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {paraTraer
                .filter((z) => coincide(z.razon_social, z.cuit))
                .map((z) => (
                  <tr key={z.codigo} className="border-b last:border-0">
                    <td className="px-3 py-1.5"><span className="font-medium">{z.razon_social}</span> <span className="text-muted-foreground">({z.codigo})</span></td>
                    <td className="px-3 py-1.5 text-muted-foreground">{[z.cuit && `CUIT ${z.cuit}`, z.tipo_iva, z.localidad, z.vendedor].filter(Boolean).join(" · ")}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{z.remitos_12m}</td>
                    <td className="px-3 py-1.5 tabular-nums">{fechaCorta(z.ultimo_remito)}</td>
                    <td className="px-3 py-1.5 text-right">
                      <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={trayendo !== null} onClick={() => traer(z)}>
                        {trayendo === z.codigo ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="mr-1 h-3 w-3" />}
                        Traer
                      </Button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
