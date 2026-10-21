"use client"

/**
 * Formulario Entrega (fase 3): los mismos campos de la pantalla de siempre (camión, chofer, m³, remito, agua extra,
 * fibra, muestra de probeta) más el viaje, "Salió a las" y el tipo de remito R / X. Despacha SIEMPRE con
 * `registrar_despacho` (una transacción: remito, materiales, stock, fibra, probetas, pedido, viaje y camión).
 * Si la base rechaza (remito repetido, supera lo que falta, pedido suspendido o cancelado por otro), el mensaje
 * aparece arriba del botón y no se graba nada.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { ChoferSelect } from "@/components/chofer-select"
import { currentUserName } from "@/lib/current-user"
import { textoBomba, type Chofer, type EmpresaBombeo } from "@/lib/maestros"
import { cargarViajes, pendientes, regenerarViajesPedido } from "@/lib/viajes"
import {
  armarPayloadDespacho, avisosRemito, duracion, faltaDe, hhmm, m3txt, num, remitoRepetido, remitoSugerido, textoFuenteEstado,
  TIPO_TEXTO, validarEntrega, type AvisoRemito, type FormEntrega, type OrigenTipo, type RemitoHist, type TipoRemito,
} from "@/lib/despacho"
import { cn } from "@/lib/utils"
import { cargarContexto, cargarFormulas, cargarPuesto, controlDeFormula, mandaOrdenes } from "@/lib/carga/datos"
import type { ControlReceta } from "@/lib/carga/receta"
import type { CamionT, PedidoT, Planta, TipoResuelto, ViajeT } from "./tipos"

export type EntregaAbierta = { pedido: PedidoT; viajeClave: string | null; camionId: string }

/** Si la planta tiene puesto de carga que recibe órdenes (se recuerda entre aperturas, para que la Entrega no salte) */
const puestoPorPlanta = new Map<string, boolean>()
export type ResultadoDespacho = {
  id: string
  pedidoId: string
  viajeClave: string | null
  mixerId: string
  choferId: string | null
  m3: number
  remito: string
  tipo: TipoRemito
  salida: string
  restante: number | null
  completo: boolean
}

const ORIGEN_TEXTO = (o: OrigenTipo | null, tipo: TipoRemito | null) => {
  const t = tipo ? TIPO_TEXTO[tipo].toLowerCase() : ""
  switch (o) {
    case "pedido": return "lo dice el pedido"
    case "obra": return `la obra va siempre ${t}`
    case "cliente": return `el cliente va siempre ${t}`
    case "dia": return "se respondió hoy para este cliente"
    case "manual": return "cambiado solo en este remito (queda en Actividad)"
    default: return ""
  }
}

export function EntregaDialog({
  abierta, onClose, planta, otraPlanta, viajes, totalViajes, camiones, choferes, empresas, puedeCambiarTipo, onDespachado, onRemitoListo,
}: {
  abierta: EntregaAbierta | null
  onClose: () => void
  planta: Planta
  otraPlanta: Planta | null
  /** todos los viajes del pedido */
  viajes: ViajeT[]
  totalViajes: number
  camiones: CamionT[]
  choferes: Chofer[]
  empresas: EmpresaBombeo[]
  /** "Cambiar solo en este remito": programacion.editar */
  puedeCambiarTipo: boolean
  onDespachado: (r: ResultadoDespacho) => void
  /** Si el navegador no dejó abrir el PDF, se ofrece imprimirlo desde un aviso */
  onRemitoListo: (r: { id: string; remito: string; tipo: TipoRemito; m3: number; cliente: string; obra: string; patente: string; chofer: string }) => void
}) {
  const { toast } = useToast()
  const p = abierta?.pedido || null
  const [form, setForm] = useState<FormEntrega | null>(null)
  const [viajeClave, setViajeClave] = useState<string | null>(null)
  const [choferTocado, setChoferTocado] = useState(false)
  const [remitoTocado, setRemitoTocado] = useState(false)
  const [resuelto, setResuelto] = useState<TipoResuelto>({ tipo: null, origen: null })
  const [cambiando, setCambiando] = useState(false)
  const [hist, setHist] = useState<RemitoHist[]>([])
  const [ultimaMuestra, setUltimaMuestra] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [aviso, setAviso] = useState<AvisoRemito | null>(null)
  const [avisoOk, setAvisoOk] = useState(false)
  const [imprimirPend, setImprimirPend] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const ahoraAbierto = useRef(Date.now())
  // Carga de planta (en prueba): control de receta "En la planta" y la orden a la cola de carga (carga-planta.md 19.2)
  const [enPlanta, setEnPlanta] = useState<{ simulada: boolean; ctl: ControlReceta } | null>(null)
  const [frenadaOk, setFrenadaOk] = useState(false)
  const [cargandoPlanta, setCargandoPlanta] = useState(false)
  const [muestraPedida, setMuestraPedida] = useState(false)
  // Cada apertura tiene su número: si se cambia de pedido, la respuesta vieja se descarta
  const vueltaPlanta = useRef(0)

  const pend = useMemo(() => (p ? pendientes(viajes.filter((v) => v.pedido_id === p.id)) as ViajeT[] : []), [p, viajes])
  const camion = (id: string) => camiones.find((c) => c.id === id) || null

  // Al abrir: formulario, tipo de remito (lo resuelve la base), remitos de los últimos 30 días y última muestra
  useEffect(() => {
    if (!abierta) { setForm(null); return }
    const ped = abierta.pedido
    const v = abierta.viajeClave ? viajes.find((x) => x.clave === abierta.viajeClave) : pendientes(viajes.filter((x) => x.pedido_id === ped.id))[0]
    const falta = faltaDe(ped)
    const m3 = v ? Math.min(Number(v.m3), falta) : Math.min(8, falta)
    ahoraAbierto.current = Date.now()
    setViajeClave((v as ViajeT | undefined)?.clave || null)
    setForm({
      m3: String(Math.max(0.5, Math.round(m3 * 10) / 10)).replace(".", ","),
      mixerId: abierta.camionId,
      choferId: camion(abierta.camionId)?.choferId || "",
      remito: "",
      tipo: null,
      origenTipo: null,
      salio: hhmm(Date.now()),
      salioTocado: false,
      agua: "0",
      fibraOn: Number(ped.fiber_kg_per_m3) > 0,
      fibraKgM3: Number(ped.fiber_kg_per_m3) > 0 ? String(ped.fiber_kg_per_m3).replace(".", ",") : "",
      muestraOn: false,
      muestraNum: "",
      asentamiento: "",
    })
    setChoferTocado(false); setRemitoTocado(false); setCambiando(false); setErr(null); setAviso(null); setAvisoOk(false)
    setResuelto({ tipo: null, origen: null })
    setCargando(true)
    const sb = createClient()
    setEnPlanta(null); setFrenadaOk(false); setCargandoPlanta(true); setMuestraPedida(false)
    const vuelta = ++vueltaPlanta.current
    // Sin puesto de carga en etapa B o C (o sin la migración), no aparece nada y el despacho es el de siempre
    cargarPuesto(sb, planta.id).then(async (pu) => {
      puestoPorPlanta.set(planta.id, mandaOrdenes(pu))
      if (!mandaOrdenes(pu)) return
      const [ctx, fs] = await Promise.all([cargarContexto(sb, pu!), cargarFormulas(sb, ped.formula_id ? [ped.formula_id] : [])])
      if (vuelta !== vueltaPlanta.current) return
      setEnPlanta({ simulada: pu!.sistema === "simulador", ctl: controlDeFormula(ctx, fs[0] || null) })
      // La muestra pasa al final de la carga: en este despacho no se carga
      setForm((f) => (f ? { ...f, muestraOn: false, muestraNum: "", asentamiento: "", agua: "0" } : f))
    }).catch(() => { if (vuelta === vueltaPlanta.current) setEnPlanta(null) })
      .finally(() => { if (vuelta === vueltaPlanta.current) setCargandoPlanta(false) })
    const desde = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString()
    Promise.all([
      sb.rpc("remito_tipo_para", { p_pedido_id: ped.id }).then((r: any) => (r.error ? null : r.data)),
      sb.from("dispatches").select("remito, plant_id, created_at, dispatch_date, remito_tipo").gte("dispatch_date", desde).eq("is_test_dispatch", false).not("remito", "is", null).limit(3000)
        .then(async (r: any) => r.error
          ? (await sb.from("dispatches").select("remito, plant_id, created_at, dispatch_date").gte("dispatch_date", desde).eq("is_test_dispatch", false).not("remito", "is", null).limit(3000)).data || []
          : r.data || []),
      sb.from("dispatches").select("sample_number").not("sample_number", "is", null).order("created_at", { ascending: false }).limit(1).then((r: any) => r.data?.[0]?.sample_number || null),
    ]).then(([tipo, h, muestra]) => {
      const t = tipo && (tipo.tipo === "R" || tipo.tipo === "X") ? { tipo: tipo.tipo as TipoRemito, origen: tipo.origen as OrigenTipo } : { tipo: null, origen: null }
      setResuelto(t)
      setHist(h as RemitoHist[])
      setUltimaMuestra(muestra)
      setForm((f) => (f && t.tipo ? { ...f, tipo: t.tipo, origenTipo: t.origen, remito: sugeridoDe(h as RemitoHist[], t.tipo) } : f))
    }).finally(() => setCargando(false))
  }, [abierta]) // eslint-disable-line react-hooks/exhaustive-deps

  const sugeridoDe = (h: RemitoHist[], tipo: TipoRemito) => {
    const s = remitoSugerido(h, planta.id, tipo)
    return s ? String(s.numero) : ""
  }

  if (!abierta || !p || !form) return <Dialog open={false} />

  const set = (cambio: Partial<FormEntrega>) => setForm((f) => (f ? { ...f, ...cambio } : f))
  const falta = faltaDe(p)
  const enviado = Number(p.dispatched_m3 || 0)
  const cam = camion(form.mixerId)
  const sug = form.tipo ? remitoSugerido(hist, planta.id, form.tipo) : null
  const bomba = p.metodo_descarga === "bomba" ? textoBomba(p, empresas, "Bomba") : null
  const sinDefinir = !resuelto.tipo
  const preguntando = !form.tipo || form.origenTipo === "pregunta" || cambiando
  const m3n = num(form.m3), fibra = num(form.fibraKgM3)
  // Con la receta que frena la carga, hay que tildar "¿Despachar igual?" (carga-planta.md 20.1)
  const frenadaFalta = !!enPlanta?.ctl.frena && !frenadaOk
  // Mientras se controla "En la planta", se muestra la versión con puesto de carga (sin el agua, con "Sacar muestra"),
  // salvo que ya se sepa que esta planta no tiene: así la Entrega no salta al terminar de cargar (22/10)
  const modoPlanta = !!enPlanta || (cargandoPlanta && puestoPorPlanta.get(planta.id) !== false)

  function elegirTipo(t: TipoRemito) {
    const origen: OrigenTipo = sinDefinir ? "pregunta" : "manual"
    setForm((f) => (f ? { ...f, tipo: t, origenTipo: origen, remito: remitoTocado ? f.remito : sugeridoDe(hist, t) } : f))
    setAviso(null); setAvisoOk(false); setErr(null)
  }
  function noCambiar() {
    setCambiando(false)
    if (resuelto.tipo) setForm((f) => (f ? { ...f, tipo: resuelto.tipo, origenTipo: resuelto.origen, remito: remitoTocado ? f.remito : sugeridoDe(hist, resuelto.tipo!) } : f))
  }
  function cambiarCamion(id: string) {
    setForm((f) => (f ? { ...f, mixerId: id, choferId: choferTocado ? f.choferId : (camion(id)?.choferId || "") } : f))
  }
  function cambiarViaje(clave: string) {
    setViajeClave(clave)
    const v = pend.find((x) => x.clave === clave)
    if (v) set({ m3: String(Math.min(Number(v.m3), falta)).replace(".", ",") })
  }

  async function despachar(imprimir: boolean, avisoAceptado = avisoOk) {
    if (!form || !p || enviando) return
    const ahora = Date.now()
    const enTaller = !!cam && (cam.e.clave === "taller" || cam.e.clave === "fuera")
    const repetido = !!form.tipo && remitoRepetido(hist, planta.id, form.tipo, form.remito)
    const e = validarEntrega(form, { falta, hayChoferes: choferes.some((c) => c.activo), camionEnTaller: enTaller, repetido, plantaNombre: planta.name, ahora })
    if (e) { setErr(e); setAviso(null); return }
    const av = avisosRemito(form.remito, planta.id, form.tipo!, hist, { planta: planta.name, otraPlanta: otraPlanta?.name, otraPlantaId: otraPlanta?.id })
    if (av && !avisoAceptado) { setErr(null); setAviso(av); setImprimirPend(imprimir); return }
    setErr(null)
    // El PDF se abre en la misma acción del clic (si no, el navegador lo bloquea)
    const ventana = imprimir ? window.open("", "_blank") : null
    setEnviando(true)
    const sb = createClient()
    try {
      // El viaje elegido se busca de nuevo por número (se pudieron rearmar mientras tanto)
      const v = viajeClave ? pend.find((x) => x.clave === viajeClave) || null : null
      let viajeId: string | null = null
      if (v && !v.calculado) {
        const frescos = pendientes((await cargarViajes(sb, [p.id]))[p.id] || [])
        const elegido = frescos.find((x) => x.n === v.n) || frescos[0] || null
        if (elegido && elegido.n !== v.n) toast({ title: `El viaje ${v.n} ya no está pendiente`, description: `Se despacha como viaje ${elegido.n}.` })
        viajeId = elegido?.id || null
      }
      const payload = armarPayloadDespacho({
        plantId: planta.id, pedido: p, viajeId, form, usuario: currentUserName(), ahora, aviso: av && avisoAceptado ? av : null,
      })
      const { data, error } = await sb.rpc("registrar_despacho", { p: payload })
      if (error) {
        ventana?.close()
        setErr(error.message || "No se pudo registrar el despacho. No se grabó nada.")
        return
      }
      const r = data as { id: string; restante: number | null; completo: boolean; viaje_n?: number; viaje_m3_planificado?: number | null; remito_tipo?: TipoRemito }
      // Si el camión salió con otros m³ que los del viaje, se rearman los pendientes (como siempre)
      if (r?.viaje_n != null && r.viaje_m3_planificado != null && !r.completo && Math.abs(Number(r.viaje_m3_planificado) - m3n) > 0.01) {
        const rv = await regenerarViajesPedido(sb, p.id, currentUserName(), { soloSiTiene: true, motivo: `m³ del viaje ${r.viaje_n} (${r.viaje_m3_planificado} → ${m3n})` })
        if (rv.generados != null) toast({ title: "Se recalcularon los viajes que faltan", description: `El viaje ${r.viaje_n} salió con ${m3txt(m3n)} m³.` })
      }
      const tipo = (r.remito_tipo || form.tipo)!
      const restante = Math.max(0, r.restante ?? falta - m3n)
      // Como Loop: Despachar también manda la orden a la cola de carga de la PC de la planta. Si falla, el despacho ya
      // quedó grabado igual (se avisa).
      if (enPlanta) {
        try {
          const rc = await fetch("/api/carga/enviar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dispatch_id: r.id, frenada_confirmada: enPlanta.ctl.frena && frenadaOk, muestra_pedida: muestraPedida }) })
          const jc = await rc.json().catch(() => ({}))
          if (!rc.ok) toast({ title: "El despacho quedó grabado, pero la orden no llegó a la cola de carga", description: jc?.error || `Error ${rc.status}` })
          else if (jc.enviada) toast({ title: `Orden en la cola de carga${jc.simulada ? " (planta simulada)" : ""}`, description: jc.frena ? `Va a quedar frenada en la planta. ${jc.mail?.enviado ? "Se avisó por mail a Juan Oreguy." : `No salió el mail (${jc.mail?.motivo || "?"}).`}` : jc.agua_distinta ? "Agua de la receta distinta: no frena, queda en la auditoría." : "La tarjeta del camión dice «En cola de carga · Ver carga»." })
        } catch {
          toast({ title: "El despacho quedó grabado, pero la orden no llegó a la cola de carga", description: "Sin conexión con el sistema." })
        }
      }
      toast({
        title: `Camión despachado · Remito ${tipo} ${form.remito.trim()}`,
        description: `${cam?.patente || ""} sale con ${m3txt(m3n)} m³ · ${r.completo || restante <= 0.01 ? "Pedido completo" : `falta ${m3txt(restante)} m³`}${form.origenTipo === "pregunta" ? ` · ${TIPO_TEXTO[tipo]} queda para todo el día de ${p.clients?.name || "este cliente"}` : ""}${av && avisoAceptado ? " · aviso de remito aceptado (queda en Actividad)" : ""}`,
      })
      const url = `/api/remito/${r.id}?doc=remitox&fondo=0`
      if (ventana) ventana.location.href = url
      else if (imprimir) onRemitoListo({ id: r.id, remito: form.remito.trim(), tipo, m3: m3n, cliente: p.clients?.name || "", obra: p.construction_sites?.name || "", patente: cam?.patente || "", chofer: choferes.find((c) => c.id === form.choferId)?.nombre || "" })
      onDespachado({
        id: r.id, pedidoId: p.id, viajeClave, mixerId: form.mixerId, choferId: form.choferId || null, m3: m3n, remito: form.remito.trim(), tipo,
        salida: form.salioTocado ? new Date(payload.dispatch_date as string).toISOString() : new Date().toISOString(), restante, completo: !!r.completo,
      })
    } catch (ex: any) {
      ventana?.close()
      setErr(ex?.message || "No se pudo registrar el despacho. No se grabó nada.")
    } finally {
      setEnviando(false)
    }
  }

  const txtCamion = (c: CamionT) =>
    c.e.clave === "planta" ? (c.e.plantaId === planta.id ? "libre" : `libre en ${c.e.plantaId === otraPlanta?.id ? otraPlanta?.name : "otra planta"}`) : c.e.etiqueta.toLowerCase()

  return (
    <Dialog open onOpenChange={(v) => !v && !enviando && onClose()}>
      <DialogContent className="max-h-[94vh] overflow-y-auto p-4 text-[13px] sm:max-w-[960px] [&_label]:text-[12px] [&_button[role=combobox]]:h-[30px] [&_button[role=combobox]]:text-[13px]">
        <DialogHeader><DialogTitle className="text-base">Entrega</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <div className="rounded-lg border bg-muted/40 px-3 py-1.5 text-[13px]">
            <div className="text-[14px] font-bold">{p.clients?.name} · {p.construction_sites?.name}</div>
            {p.construction_sites?.address && <div className="text-muted-foreground">{p.construction_sites.address}</div>}
            <div className="mt-0.5"><b>{p.formulas?.code}</b>{p.finalidad ? ` · ${p.finalidad}` : ""} · {bomba || "Directo"}{Number(p.fiber_kg_per_m3) > 0 ? ` · Fibra ${m3txt(p.fiber_kg_per_m3)} kg/m³` : ""}</div>
            <div className="mt-0.5">Total <b>{m3txt(p.quantity_m3)} m³</b> · enviado <b>{m3txt(enviado)}</b> · falta <b className="text-amber-600">{m3txt(falta)}</b></div>
          </div>

          {/* Tipo de remito: R (con factura) / X (sin factura) */}
          {cargando && !form.tipo ? (
            <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[13px] text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Buscando si va con o sin factura…</div>
          ) : !preguntando ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-1.5">
              <div>
                <div className="font-bold">Remito <span className={cn("rounded px-1.5 text-[13px] font-extrabold", form.tipo === "R" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800")}>{form.tipo}</span> {TIPO_TEXTO[form.tipo!]}</div>
                <div className="text-xs text-muted-foreground">{ORIGEN_TEXTO(form.origenTipo, form.tipo)}</div>
              </div>
              {puedeCambiarTipo && form.origenTipo !== "manual" && (
                <Button variant="outline" size="sm" className="h-[28px] text-[12px]" onClick={() => setCambiando(true)}>Cambiar solo en este remito</Button>
              )}
            </div>
          ) : (
            <div className="rounded-lg border-2 border-amber-500 bg-amber-50 px-3 py-1.5">
              <div className="font-bold">¿Este remito va con o sin factura?</div>
              <div className="text-[13px] text-muted-foreground">
                {sinDefinir
                  ? <>No lo dice el pedido, ni la obra, ni el cliente. Lo que elijas vale para <b>todos los despachos de hoy de {p.clients?.name}</b>.</>
                  : "Cambia solo este remito. Queda en Actividad."}
              </div>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                {(["R", "X"] as TipoRemito[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => elegirTipo(t)}
                    className={cn("min-h-[34px] rounded-lg border-2 text-[13px] font-bold", form.tipo === t && (form.origenTipo === "pregunta" || form.origenTipo === "manual") ? "border-foreground bg-foreground text-background" : "bg-card")}
                  >
                    {t === "R" ? "Con factura · R" : "Sin factura · X"}
                  </button>
                ))}
              </div>
              {cambiando && <button className="mt-1.5 text-[13px] underline" onClick={noCambiar}>No cambiar</button>}
            </div>
          )}

          {cargandoPlanta && modoPlanta && (
            <div className="flex items-center gap-1.5 rounded-lg border border-l-[3px] px-2.5 py-1.5 text-[12.5px] text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> <b className="text-foreground">En la planta</b> · controlando la receta…</div>
          )}
          {enPlanta && (() => {
            const c = enPlanta.ctl
            const items = c.items.filter((i) => ["receta", "agua", "tolva"].includes(i.clave))
            return (
              <div className="space-y-1">
                <div className={cn("flex flex-wrap items-center gap-1.5 rounded-lg border border-l-[3px] px-2.5 py-1.5 text-[12.5px]", c.frena ? "border-l-red-600 bg-red-50" : c.aguaDistinta ? "border-l-amber-500" : "border-l-emerald-500")}>
                  <b>En la planta</b>
                  {items.map((i) => <span key={i.clave + i.corto} title={i.texto} className={cn("rounded px-1 text-[11px] font-semibold", !i.ok ? "bg-red-100 text-red-800" : i.aviso ? "bg-amber-100 text-amber-900" : "bg-emerald-50 text-emerald-800")}>{i.corto} {!i.ok ? "✕" : i.aviso ? "!" : "✓"}</span>)}
                  {enPlanta.simulada && <span className="rounded bg-amber-100 px-1 text-[11px] font-semibold text-amber-900">planta simulada</span>}
                  <span className="text-[11px] text-muted-foreground">NP: se controla cuando esté Zomatik</span>
                </div>
                {c.frena ? (
                  <label className="flex items-start gap-2 rounded-lg border border-red-300 px-2.5 py-1.5 text-[12.5px]">
                    <input type="checkbox" className="mt-0.5 h-4 w-4" checked={frenadaOk} onChange={(e) => setFrenadaOk(e.target.checked)} />
                    <span><b>La carga va a quedar frenada en la planta</b>: {c.motivo}. Lo resuelven Bautista, Fernando y Juan; se le avisa por mail a Juan Oreguy. ¿Despachar igual?</span>
                  </label>
                ) : c.aguaDistinta ? <div className="text-[12px] font-semibold text-amber-800">{c.items.find((i) => i.clave === "agua")?.texto}.</div> : null}
              </div>
            )
          })()}

          <div className="grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-3">
            <div className="space-y-1">
              <Label>Viaje</Label>
              {pend.length ? (
                <Select value={viajeClave || ""} onValueChange={cambiarViaje}>
                  <SelectTrigger className="h-[30px] text-[13px]"><SelectValue placeholder="Elegí el viaje" /></SelectTrigger>
                  <SelectContent>
                    {pend.map((v) => (
                      <SelectItem key={v.clave} value={v.clave}>Viaje {v.n}/{totalViajes} · {m3txt(v.m3)} m³ · cargar {hhmm(v.hora_carga)}{v.calculado ? " (calculado)" : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : <div className="rounded-md border px-3 py-1 text-[13px] text-muted-foreground">El pedido no tiene viajes pendientes</div>}
            </div>
            <div className="space-y-1">
              <Label>Camión *</Label>
              <Select value={form.mixerId} onValueChange={cambiarCamion}>
                <SelectTrigger className="h-[30px] text-[13px]"><SelectValue placeholder="Elegí el camión" /></SelectTrigger>
                <SelectContent>
                  {camiones.map((c) => <SelectItem key={c.id} value={c.id}>{c.patente} · {txtCamion(c)}</SelectItem>)}
                </SelectContent>
              </Select>
              {cam && cam.e.clave !== "planta" && cam.e.clave !== "taller" && cam.e.clave !== "fuera" && (
                <p className="text-[11px] font-semibold leading-tight text-amber-700">{cam.patente} figura {cam.e.etiqueta.toLowerCase()} ({textoFuenteEstado(cam.e)}{cam.e.desde ? `, hace ${duracion((Date.now() - cam.e.desde) / 60000)}` : ""}). Se puede despachar igual.</p>
              )}
            </div>
            <div>
              <ChoferSelect choferes={choferes} value={form.choferId} onChange={(v) => { setChoferTocado(true); set({ choferId: v }) }} obligatorio label="Chofer" />
              <p className="mt-0.5 text-[11px] text-muted-foreground">Rotan: viene el último que manejó este camión hoy.</p>
            </div>
            <div className="space-y-1">
              <Label>m³ en este camión *</Label>
              <Input className="h-[30px] text-[14px] font-bold" inputMode="decimal" value={form.m3} onChange={(e) => set({ m3: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Remito *</Label>
              <Input
                className="h-[30px] text-[14px] font-bold"
                inputMode="numeric"
                value={form.remito}
                disabled={!form.tipo}
                onChange={(e) => { setRemitoTocado(true); setAvisoOk(false); setAviso(null); set({ remito: e.target.value }) }}
              />
              <p className="text-[11px] leading-tight text-muted-foreground">
                {!form.tipo
                  ? "Primero contestá si va con o sin factura: el número depende del talonario."
                  : sug
                    ? <>Sugerido: el siguiente <b>{form.tipo}</b> de {planta.name} (el último fue {sug.ultimo}). Controlalo con el papel.</>
                    : <>No hay remitos {form.tipo} de {planta.name} en los últimos 30 días: escribí el número del papel.</>}
              </p>
            </div>
            <div className="space-y-1">
              <Label>Salió a las</Label>
              <Input className="h-[30px] text-[13px]" type="time" value={form.salio} onChange={(e) => set({ salio: e.target.value, salioTocado: true })} />
              <p className="text-[11px] leading-tight text-muted-foreground">Si lo cargás más tarde, poné la hora real de salida. La hora en que lo cargás ({hhmm(ahoraAbierto.current)}) se guarda aparte y no se cambia.</p>
            </div>
            {/* Con carga de planta, el agua extra se registra en la carga ("Extra agua", 21/10 · 6): acá no va.
                registrar_despacho recibe 0 como siempre (extra_water_liters). */}
            {!modoPlanta && (
              <div className="space-y-1">
                <Label>Agua extra en planta (litros)</Label>
                <Input className="h-[30px] text-[13px]" inputMode="numeric" value={form.agua} onChange={(e) => set({ agua: e.target.value })} />
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="rounded-lg border px-3 py-1.5">
            <div className="flex items-center justify-between gap-3">
              <div><div className="font-bold">Fibra</div><div className="text-xs text-muted-foreground">Se agrega al camión en el despacho</div></div>
              <Switch checked={form.fibraOn} onCheckedChange={(v) => set({ fibraOn: v })} />
            </div>
            {form.fibraOn && (
              <div className="mt-1.5 grid grid-cols-2 items-end gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Dosificación (kg por m³)</Label>
                  <Input className="h-[30px] text-[13px]" inputMode="decimal" value={form.fibraKgM3} onChange={(e) => set({ fibraKgM3: e.target.value })} placeholder="Ej: 0,5" />
                </div>
                <div className="pb-1 text-[12.5px]">
                  {fibra > 0 && m3n > 0
                    ? <>Total en el camión: <b>{(fibra * m3n).toLocaleString("es-AR", { maximumFractionDigits: 2 })} kg</b><br /><span className="text-xs text-muted-foreground">{m3txt(fibra)} kg/m³ × {m3txt(m3n)} m³</span></>
                    : <span className="text-[13px] text-muted-foreground">Poné los kg por m³ para ver el total.</span>}
                </div>
              </div>
            )}
          </div>

          {modoPlanta ? (
            // Con carga de planta, la muestra se carga al terminar la carga (respuestas 21/10 · 5): acá solo el aviso
            <label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-1.5">
              <div><div className="font-bold">Sacar muestra a este camión</div><div className="text-xs text-muted-foreground">Es un aviso para la planta. El número y el asentamiento se cargan al terminar la carga («¿Se sacó muestra?»).</div></div>
              <Switch checked={muestraPedida} onCheckedChange={setMuestraPedida} />
            </label>
          ) : (
          <div className="rounded-lg border px-3 py-1.5">
            <div className="flex items-center justify-between gap-3">
              <div><div className="font-bold">Muestra de probeta</div><div className="text-xs text-muted-foreground">Se extrajo muestra para ensayo de compresión</div></div>
              <Switch checked={form.muestraOn} onCheckedChange={(v) => set({ muestraOn: v })} />
            </div>
            {form.muestraOn && (
              <div className="mt-1.5 space-y-1.5">
                {ultimaMuestra && <span className="inline-block rounded bg-blue-100 px-2 py-0.5 text-[13px] font-bold text-blue-800">Última muestra: {ultimaMuestra}</span>}
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1"><Label>Número de muestra *</Label><Input className="h-[30px] text-[13px]" value={form.muestraNum} onChange={(e) => set({ muestraNum: e.target.value })} placeholder="Ej: M-0413" /></div>
                  <div className="space-y-1"><Label>Asentamiento real (cm) *</Label><Input className="h-[30px] text-[13px]" inputMode="decimal" value={form.asentamiento} onChange={(e) => set({ asentamiento: e.target.value })} placeholder="Ej: 12,5" /></div>
                </div>
                <p className="text-[11px] leading-tight text-muted-foreground">Se crean 3 probetas: 1 para 7 días y 2 para 28 días.</p>
              </div>
            )}
          </div>
          )}

          </div>

          {err && <div className="rounded-lg bg-red-100 px-3 py-1.5 text-[13px] font-semibold text-red-800">{err}</div>}
          {aviso && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-100 px-3 py-2 text-[13px] font-bold text-amber-900">
              <span>⚠ {aviso.texto}</span>
              <Button size="sm" className="h-[30px] bg-amber-600 hover:bg-amber-700" disabled={enviando} onClick={() => { setAvisoOk(true); despachar(imprimirPend, true) }}>Sí, el número está bien</Button>
            </div>
          )}
        </div>
        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" className="h-[32px] text-[13px]" onClick={onClose} disabled={enviando}>Cancelar</Button>
          <Button variant="outline" className="h-[32px] text-[13px]" onClick={() => despachar(true)} disabled={enviando || cargando || cargandoPlanta || frenadaFalta}>🖨 Despachar e imprimir</Button>
          <Button className="h-[32px] bg-green-600 text-[13px] hover:bg-green-700" onClick={() => despachar(false)} disabled={enviando || cargando || cargandoPlanta || frenadaFalta}>
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Despachar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
