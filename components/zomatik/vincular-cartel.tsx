"use client"
/**
 * Cartel "Falta vincular con Zomatik" del pedido (04/11/2026, docs/specs/2026-11-04-vincular-al-programar.md).
 * Quien programa elige el cliente de Zomatik y/o el artículo de la fórmula, con sugerencias y un buscador. Solo completa
 * lo que falta: corregir un vínculo es de un gerencial, en Vínculos. Todo pasa por /api/zomatik/vincular.
 *   - En el formulario (`alTerminar: "nada"`): cuando ya no falta nada, vuelve a "Guardar".
 *   - Desde el menú ⋯ de un pedido con la NP en error (`alTerminar: "generar"`): al terminar reintenta la NP.
 * En el formulario también pide la localidad de la obra si no la tiene (10/11/2026: Zomatik la exige en el remito).
 * Se guarda en la obra; sin ella no se puede guardar el pedido (tampoco con «Guardar sin vincular»). Con
 * `conVinculos: false` el cartel es solo para la localidad (no consulta Zomatik).
 */
import { useEffect, useRef, useState } from "react"
import { Check, ChevronsUpDown, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { normalizarLocalidad, FALTA_LOCALIDAD } from "@/lib/geo-direccion"
import { interpretarNombre } from "@/lib/formulas-nombre"
import { buscarParaVincular, estadoVinculos, generarNpAhora, vincularDesdePedido, type EstadoVinculosPedido } from "@/lib/zomatik/np-cliente"
import { otraPlantaDelArticulo } from "@/lib/zomatik/vinculos"
import type { HitArticuloVincular, HitClienteVincular } from "@/lib/zomatik/vincular-servidor"

const fechaCorta = (f: string | null | undefined) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}` : "")

/** Buscador del cartel (como el "Elegir" de Vínculos), que consulta al servidor mientras se escribe. */
function Buscador<T extends { codigo: number }>({
  placeholder, vacio, buscar, fila, onElegir, deshabilitado,
}: {
  placeholder: string
  vacio: string
  buscar: (q: string) => Promise<T[]>
  fila: (x: T) => { texto: string; nota?: string; bloqueado?: string | null }
  onElegir: (x: T) => void
  deshabilitado?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")
  const [res, setRes] = useState<T[]>([])
  const [buscando, setBuscando] = useState(false)
  const ultimo = useRef(0)
  useEffect(() => {
    if (q.trim().length < 2) {
      setRes([])
      return
    }
    const n = ++ultimo.current
    setBuscando(true)
    const t = setTimeout(async () => {
      const r = await buscar(q.trim())
      if (n !== ultimo.current) return
      setRes(r)
      setBuscando(false)
    }, 250)
    return () => clearTimeout(t)
  }, [q]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={deshabilitado}>
          {placeholder}
          <ChevronsUpDown className="ml-1 h-3 w-3 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[440px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder={placeholder} value={q} onValueChange={setQ} />
          <CommandList className="max-h-[260px]">
            {q.trim().length >= 2 && !buscando && <CommandEmpty>{vacio}</CommandEmpty>}
            {buscando && <div className="px-3 py-2 text-xs text-muted-foreground">Buscando…</div>}
            <CommandGroup>
              {res.map((x) => {
                const f = fila(x)
                return (
                  <CommandItem
                    key={x.codigo}
                    value={String(x.codigo)}
                    disabled={!!f.bloqueado}
                    onSelect={() => {
                      if (f.bloqueado) return
                      onElegir(x)
                      setOpen(false)
                    }}
                  >
                    <span className="truncate">{f.texto}</span>
                    {(f.bloqueado || f.nota) && <span className={cn("ml-2 shrink-0 text-[11px]", f.bloqueado ? "text-amber-700" : "text-muted-foreground")}>{f.bloqueado || f.nota}</span>}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export function VincularCartel({
  open, clientId, formulaId, plantId, pedidoId, onVinculado, onUsarCliente, alTerminar, onGuardar, onGuardarSinVincular, onCerrar,
  conVinculos = true, obraSinLocalidad = null, guardarLocalidad,
}: {
  open: boolean
  clientId: string | null
  formulaId: string | null
  plantId: string | null
  /** El pedido guardado (para la Actividad del pedido y para reintentar la NP); sin él, "pedido nuevo". */
  pedidoId?: string | null
  /** `hecho` = se vinculó en este cartel; false = ya estaba vinculado (solo se actualiza la pantalla de atrás). */
  onVinculado: (tipo: "cliente" | "formula", codigo: number, nombre: string, hecho: boolean) => void
  /** Solo dentro del formulario: usar en el pedido el cliente nuestro que ya tiene ese código de Zomatik. */
  onUsarCliente?: (c: { id: string; name: string; zomatik_codigo: number }) => void
  alTerminar: "generar" | "nada"
  /** En el formulario: "Guardar" (se habilita cuando no falta nada). */
  onGuardar?: () => void
  onGuardarSinVincular?: () => void
  onCerrar: () => void
  /** false = no falta vincular nada, el cartel es solo para la localidad (no consulta Zomatik) */
  conVinculos?: boolean
  /** Solo en el formulario: la obra del pedido no tiene localidad */
  obraSinLocalidad?: { id: string; name: string } | null
  /** Guarda la localidad (ya normalizada) en la obra; devuelve el error o null */
  guardarLocalidad?: (localidad: string) => Promise<string | null>
}) {
  const { toast } = useToast()
  const [estado, setEstado] = useState<EstadoVinculosPedido | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hecho, setHecho] = useState<{ cliente?: string; formula?: string }>({})
  const [grabando, setGrabando] = useState<string | null>(null)
  const [np, setNp] = useState<{ generando: boolean; texto?: string; ok?: boolean } | null>(null)
  const generada = useRef(false)
  // Localidad de la obra: lo que se escribe y lo que quedó guardado
  const [localidad, setLocalidad] = useState("")
  const [localidadHecha, setLocalidadHecha] = useState<{ obra: { id: string; name: string }; localidad: string } | null>(null)

  useEffect(() => {
    if (!open) return
    let vivo = true
    setEstado(null)
    setError(null)
    setHecho({})
    setNp(null)
    setLocalidad("")
    setLocalidadHecha(null)
    generada.current = false
    if (!conVinculos) {
      setEstado({ cliente: null, formula: null })
      return
    }
    estadoVinculos(clientId, formulaId).then((r) => {
      if (!vivo) return
      if ("error" in r) return setError(r.error)
      setEstado(r)
      // Lo que ya está vinculado (por ejemplo, lo vinculó otro en el medio) se actualiza en la pantalla de atrás
      if (r.cliente && !r.cliente.falta && r.cliente.vinculado) onVinculado("cliente", r.cliente.vinculado.codigo, r.cliente.vinculado.nombre || "", false)
      if (r.formula && r.formula.vinculado && r.formula.problema === null) onVinculado("formula", r.formula.vinculado.codigo, r.formula.vinculado.nombre || "", false)
    })
    return () => {
      vivo = false
    }
  }, [open, clientId, formulaId, conVinculos]) // eslint-disable-line react-hooks/exhaustive-deps

  const faltaCliente = !!estado?.cliente?.falta && !hecho.cliente
  const faltaFormula = !!estado?.formula?.falta && !hecho.formula
  const faltaLocalidad = !!obraSinLocalidad && !localidadHecha
  const listo = !!estado && !faltaCliente && !faltaFormula && !faltaLocalidad

  // Desde el menú ⋯: cuando ya no falta nada, se reintenta la NP (una sola vez)
  useEffect(() => {
    if (!open || !listo || alTerminar !== "generar" || !pedidoId || generada.current) return
    generada.current = true
    setNp({ generando: true })
    generarNpAhora(pedidoId).then((r) => setNp({ generando: false, texto: r.texto, ok: r.ok }))
  }, [open, listo, alTerminar, pedidoId])

  async function elegir(tipo: "cliente" | "formula", codigo: number, nombreZ: string) {
    const id = tipo === "cliente" ? estado?.cliente?.id : estado?.formula?.id
    if (!id) return
    setGrabando(`${tipo}:${codigo}`)
    const r = await vincularDesdePedido([{ tipo, id, codigo }], pedidoId)
    setGrabando(null)
    if (!r.ok) {
      toast({ title: "No se vinculó", description: r.errores[0] || "No se pudo vincular", variant: "destructive" })
      return
    }
    const nombreNuestro = tipo === "cliente" ? estado?.cliente?.name : estado?.formula?.code || estado?.formula?.name
    const nombre = r.resultados[0]?.nombre || nombreZ
    toast({ title: `Vinculado: ${nombreNuestro} → ${nombre} (${codigo})` })
    setHecho((h) => ({ ...h, [tipo]: `${nombre} (${codigo})` }))
    onVinculado(tipo, codigo, nombre, true)
  }

  async function grabarLocalidad() {
    const v = normalizarLocalidad(localidad)
    if (!v) {
      toast({ title: "Falta la localidad", description: FALTA_LOCALIDAD, variant: "destructive" })
      return
    }
    if (!guardarLocalidad || !obraSinLocalidad) return
    const obra = obraSinLocalidad
    setGrabando("localidad")
    const err = await guardarLocalidad(v)
    setGrabando(null)
    if (err) {
      toast({ title: "No se guardó la localidad", description: err, variant: "destructive" })
      return
    }
    setLocalidadHecha({ obra, localidad: v })
  }

  const c = estado?.cliente
  const f = estado?.formula
  // Una vez guardada, la obra ya tiene localidad en la pantalla de atrás: se sigue mostrando la que se guardó
  const obraLoc = obraSinLocalidad || localidadHecha?.obra || null
  const conLocalidad = !!obraLoc
  const titulo = !conLocalidad ? "Falta vincular con Zomatik" : conVinculos ? "Falta completar el pedido" : "Falta la localidad de la obra"
  const partes = f ? interpretarNombre(f.code || f.name) : null

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCerrar()}>
      <DialogContent className="sm:max-w-[680px] max-h-[90vh] overflow-y-auto text-[13px]">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>{conVinculos ? "Elegí el que corresponde: queda para los próximos pedidos." : "Zomatik la pide en el remito. Queda guardada en la obra."}</DialogDescription>
        </DialogHeader>

        {obraLoc && (
          <div className="space-y-1.5 rounded-md border p-2">
            <p className="font-medium">Obra: {obraLoc.name} · ¿en qué localidad está?</p>
            {localidadHecha ? (
              <p className="text-xs text-green-800"><Check className="mr-1 inline h-3 w-3" />Localidad: {localidadHecha.localidad}</p>
            ) : (
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  grabarLocalidad()
                }}
              >
                <Input value={localidad} onChange={(e) => setLocalidad(e.target.value)} placeholder="Ej: San Vicente" className="h-7 max-w-[260px] text-xs" autoFocus disabled={!!grabando} />
                <Button type="submit" size="sm" className="h-7 px-2 text-xs" disabled={!!grabando || !localidad.trim()}>
                  {grabando === "localidad" ? "Guardando…" : "Guardar en la obra"}
                </Button>
              </form>
            )}
          </div>
        )}

        {!estado && !error && <p className="text-xs text-muted-foreground"><Loader2 className="mr-1 inline h-3 w-3 animate-spin" />Buscando…</p>}
        {error && <p className="text-xs text-red-700">{error}</p>}

        {c && (c.falta || hecho.cliente) && (
          <div className="space-y-1.5 rounded-md border p-2">
            <p className="font-medium">Cliente: {c.name} · ¿cuál es en Zomatik?</p>
            {hecho.cliente ? (
              <p className="text-xs text-green-800"><Check className="mr-1 inline h-3 w-3" />Vinculado con {hecho.cliente}</p>
            ) : (
              <>
                {c.problema === "sin_par" && <p className="text-[11px] text-muted-foreground">Estaba marcado «No está en Zomatik».</p>}
                {c.duplicadoDe.map((d) => (
                  <div key={d.id} className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900">
                    «{c.name}» parece el mismo que «{d.name}» (Zomatik {d.zomatik_codigo}). Si es el mismo, usá ese. Para unirlos, avisale a un gerencial (Vínculos › Duplicados).
                    {onUsarCliente && (
                      <Button type="button" size="sm" variant="outline" className="ml-2 h-6 bg-white px-2 text-[11px]" onClick={() => onUsarCliente({ id: d.id, name: d.name, zomatik_codigo: d.zomatik_codigo })}>
                        Usar «{d.name}» en el pedido
                      </Button>
                    )}
                  </div>
                ))}
                {c.sugerencias.map((s) => {
                  const bloqueo = s.vinculado_a ? `ya es «${s.vinculado_a.name}» acá` : s.cuit_coincide === "distinto" ? "CUIT distinto: lo vincula un gerencial en Vínculos" : null
                  return (
                    <div key={s.codigo} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded border px-2 py-1 text-xs">
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{s.razon_social}</span> · {s.codigo}
                        {s.cuit ? ` · CUIT ${s.cuit}` : ""}
                        {` · ${s.remitos_12m} remitos en el año`}
                        {s.ultimo_remito ? ` · último ${fechaCorta(s.ultimo_remito)}` : ""}
                      </span>
                      <span className="rounded bg-muted px-1 text-[10px]">{s.motivo}</span>
                      {bloqueo ? (
                        <>
                          <span className="text-[11px] text-amber-700">{bloqueo}</span>
                          {s.vinculado_a?.se_puede_usar && onUsarCliente && (
                            <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => onUsarCliente({ id: s.vinculado_a!.id, name: s.vinculado_a!.name, zomatik_codigo: s.codigo })}>
                              Usar «{s.vinculado_a.name}» en el pedido
                            </Button>
                          )}
                        </>
                      ) : (
                        <Button type="button" size="sm" className="h-6 px-2 text-[11px]" disabled={!!grabando} onClick={() => elegir("cliente", s.codigo, s.razon_social)}>
                          {grabando === `cliente:${s.codigo}` ? "Vinculando…" : "Es este"}
                        </Button>
                      )}
                    </div>
                  )
                })}
                {!c.sugerencias.length && <p className="text-xs text-muted-foreground">Sin sugerencias por CUIT o nombre.</p>}
                <Buscador<HitClienteVincular>
                  placeholder="Buscar en Zomatik por nombre o CUIT"
                  vacio="No aparece. Si es nuevo, hay que darlo de alta en Zomatik."
                  deshabilitado={!!grabando}
                  buscar={async (q) => (await buscarParaVincular("cliente", q, { clientId: c.id })).clientes || []}
                  fila={(z) => ({
                    texto: `${z.razon_social} · ${z.codigo}${z.cuit ? ` · CUIT ${z.cuit}` : ""}`,
                    nota: `${z.remitos_12m || 0} remitos en el año`,
                    bloqueado: z.vinculado_a ? `ya es «${z.vinculado_a.name}» acá` : z.cuit_coincide === "distinto" ? "CUIT distinto" : null,
                  })}
                  onElegir={(z) => elegir("cliente", z.codigo, z.razon_social)}
                />
              </>
            )}
          </div>
        )}

        {f && (f.falta || hecho.formula) && (
          <div className="space-y-1.5 rounded-md border p-2">
            <p className="font-medium">Fórmula: {f.code || f.name} · ¿qué artículo es?</p>
            {hecho.formula ? (
              <p className="text-xs text-green-800"><Check className="mr-1 inline h-3 w-3" />Vinculada con {hecho.formula}</p>
            ) : f.problema === "articulo_no_esta" || f.problema === "articulo_sin_codigo_sistema" ? (
              <p className="text-xs text-amber-800">
                Está vinculada con {f.vinculado?.nombre || "un artículo"} ({f.vinculado?.codigo}), pero ese artículo {f.problema === "articulo_no_esta" ? "no está en la copia de Zomatik" : "no se puede usar en la NP (no tiene código de sistema)"}. Lo corrige un gerencial en Vínculos.
              </p>
            ) : (
              <>
                {f.problema === "sin_par" && <p className="text-[11px] text-muted-foreground">Estaba marcada «No está en Zomatik».</p>}
                {f.sugerencias.map((s) => (
                  <div key={s.codigo} className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 rounded border px-2 py-1 text-xs", (s.otra_planta || s.sin_codigo_sistema) && "opacity-70")}>
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{s.nombre}</span> · {s.codigo} · {s.motivo}
                    </span>
                    {s.otra_planta ? (
                      <span className="text-[11px] text-amber-700">
                        es de {otraPlantaDelArticulo(s.nombre, f.planta) || "otra planta"}{" "}
                        <span className="cursor-help rounded-full border px-1" title="Desde el pedido no se vincula con un artículo de otra planta.">?</span>
                      </span>
                    ) : s.sin_codigo_sistema ? (
                      <span className="text-[11px] text-amber-700">no se puede usar en la NP</span>
                    ) : (
                      <Button type="button" size="sm" className="h-6 px-2 text-[11px]" disabled={!!grabando} onClick={() => elegir("formula", s.codigo, s.nombre)}>
                        {grabando === `formula:${s.codigo}` ? "Vinculando…" : "Es este"}
                      </Button>
                    )}
                  </div>
                ))}
                {!f.sugerencias.some((s) => !s.otra_planta) && (
                  <p className="text-xs text-amber-800">
                    {partes ? `No hay un artículo ${partes.resistencia}${f.planta ? ` de ${f.planta}` : ""} en Zomatik.` : "No hay un artículo parecido en Zomatik."} Buscalo a mano o seguí sin vincular.
                  </p>
                )}
                <Buscador<HitArticuloVincular>
                  placeholder="Buscar artículo por nombre o código"
                  vacio="No aparece en la copia de Zomatik."
                  deshabilitado={!!grabando}
                  buscar={async (q) => (await buscarParaVincular("articulo", q, { formulaId: f.id })).articulos || []}
                  fila={(a) => ({ texto: `${a.nombre} · ${a.codigo}`, bloqueado: a.otra_planta ? `es de ${otraPlantaDelArticulo(a.nombre, f.planta) || "otra planta"}` : a.sin_codigo_sistema ? "no se puede usar en la NP" : null })}
                  onElegir={(a) => elegir("formula", a.codigo, a.nombre)}
                />
              </>
            )}
          </div>
        )}

        {listo && alTerminar === "generar" && (
          <p className={cn("text-xs", np?.generando ? "text-muted-foreground" : np?.ok ? "text-green-800" : "text-red-700")}>
            {np?.generando ? <><Loader2 className="mr-1 inline h-3 w-3 animate-spin" />Generando la NP en Zomatik…</> : np?.texto}
          </p>
        )}
        {listo && alTerminar === "nada" && <p className="text-xs text-green-800">Ya no falta nada: tocá Guardar.</p>}

        <DialogFooter className="gap-2 sm:items-center">
          {alTerminar === "nada" && onGuardarSinVincular && !listo && !faltaLocalidad && (
            <span className="mr-auto text-[11px] text-muted-foreground">«Guardar sin vincular»: se guarda y la NP queda pendiente; le llega un mail a Bautista.</span>
          )}
          <Button type="button" variant="outline" size="sm" onClick={onCerrar} disabled={np?.generando}>
            {alTerminar === "generar" ? "Cerrar" : "Volver"}
          </Button>
          {alTerminar === "nada" && onGuardarSinVincular && !listo && !faltaLocalidad && (
            <Button type="button" variant="outline" size="sm" disabled={!!grabando} onClick={onGuardarSinVincular}>
              Guardar sin vincular
            </Button>
          )}
          {alTerminar === "nada" && onGuardar && (
            <Button type="button" size="sm" disabled={!listo || !!grabando} onClick={onGuardar}>
              Guardar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
