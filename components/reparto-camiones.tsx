"use client"

/**
 * Camiones por planta (docs/specs/2026-11-04-camiones-por-planta.md, fase 1).
 *
 * useRepartoDia: carga lo necesario de las DOS plantas (pedidos del día y del siguiente, viajes, tiempos, camiones,
 * reparto guardado de ese día y del anterior, traslado) y arma con lib/reparto.ts la sugerencia y, si hay un reparto
 * guardado o en edición, el resultado respetándolo. RepartoCamiones: el bloque de la vista Día (sugerencia con el
 * porqué, editor, guardar). Solo con el interruptor de funciones nuevas. Si la migración no está aplicada, el bloque
 * muestra la sugerencia y no deja guardar; la programación sigue como antes.
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { NuevoBadge } from "@/components/nuevo-badge"
import { Hora24 } from "@/components/hora-24"
import { useToast } from "@/hooks/use-toast"
import { currentUserName, usePermisos } from "@/lib/current-user"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { parametrosDePlanta, aMin, aHora } from "@/lib/planificador"
import { leerDatosDia, armarVistaDia, type DatosDia, type AjustesPedidos, type PedidoDia } from "@/lib/reparto-dia"
import {
  dondeDuermen, repartoDe, contarTraslados, franjasDe, textoNoche, textoComparacion, trasladoDe, mismoReparto,
  guardarReparto, guardarTraslado, validarReparto, escenarioConMas, textoResumenDia, lineaTraslados, bloquesDiagrama,
  horaArgentina, estadoPedido as estadoPedidoFn, TEXTO_ESCENARIO, REGLAS_REPARTO, type Reparto,
} from "@/lib/reparto"
import { choquesDeCamion, claveViaje, conTiemposGps, m3ParaSugerir, parametrosConGps, textoChoque, textoDescargaObra, textoTiempos, tiemposDelPedido, viajeMinDe, type PedidoParaViajes } from "@/lib/viajes"
import { cargarEmpresasBombeo, textoBomba, bombaSinEmpresa, type EmpresaBombeo } from "@/lib/maestros"
import { textoMotivo } from "@/lib/despacho"
import { guardarHoraPedido, guardarMetodoPedido, guardarPlanDia, confirmarPedidos, planGuardarYConfirmar, type PlanGuardar } from "@/lib/programacion-acciones"
import { regenerarViajesPedido } from "@/lib/viajes"
import { textoEstadoMail, MAIL_ARMADO_A, MAIL_ARMADO_CC, type EstadoMail } from "@/lib/armado-dia"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { AlertTriangle, ArrowLeftRight, ChevronDown, ChevronRight, CircleHelp, ListOrdered, Loader2, Mail, MapPin, Moon, Plus, RefreshCw, Send, Truck, X } from "lucide-react"
import { cn } from "@/lib/utils"

type Plant = { id: string; name: string }
/** Colores por planta (andan en modo oscuro): Canning verde suave (teal), Hudson violeta suave */
const ESTILOS_PLANTA = {
  teal: { bloque: "bg-teal-100 text-teal-900 border-teal-300 dark:bg-teal-900/40 dark:text-teal-100 dark:border-teal-700", punto: "bg-teal-300 dark:bg-teal-700" },
  violeta: { bloque: "bg-violet-100 text-violet-900 border-violet-300 dark:bg-violet-900/40 dark:text-violet-100 dark:border-violet-700", punto: "bg-violet-300 dark:bg-violet-700" },
}
const ESTILO_TRASLADO = { bloque: "bg-muted text-muted-foreground border-border", punto: "bg-muted-foreground/40" }
const fecha = (d: Date) => format(d, "yyyy-MM-dd")
const clonar = (r: Reparto): Reparto => JSON.parse(JSON.stringify(r))

export type TrasladoForm = { minutos: string; km: string; litros: string }

export function useRepartoDia({ dia, plants, activo }: { dia: Date; plants: Plant[]; activo: boolean }) {
  const [cargando, setCargando] = useState(false)
  const [datos, setDatos] = useState<DatosDia | null>(null)
  const [ruta, setRuta] = useState<{ minutos: number; km: number } | null>(null)
  const [edicion, setEdicion] = useState<Reparto | null>(null)
  // Horas y métodos cambiados en la tabla, sin guardar: el día se recalcula con ellos en el momento
  const [ajustes, setAjustes] = useState<AjustesPedidos>({})
  const [trasladoForm, setTrasladoForm] = useState<TrasladoForm>({ minutos: "", km: "", litros: "" })
  const [guardando, setGuardando] = useState(false)
  // "Ordenar el día": después de releer, la sugerencia queda como reparto en edición
  const [pedirSugerencia, setPedirSugerencia] = useState(false)

  const clavePlantas = plants.map((p) => p.id).join(",")
  const fechaDia = fecha(dia)

  /**
   * Lee todo de nuevo (lib/reparto-dia.ts). limpiar = descarta la edición y los ajustes sin guardar (cambio de día,
   * después de guardar); sin limpiar (después de guardar el traslado o un viaje) lo editado se conserva.
   */
  const cargar = useCallback(async (limpiar = false) => {
    if (!activo || !clavePlantas) return
    setCargando(true)
    try {
      const d = await leerDatosDia(createClient(), fechaDia, plants)
      setDatos(d)
      const f = d.traslado.fila
      setTrasladoForm({ minutos: f ? String(f.minutos) : "", km: f?.km != null ? String(f.km) : "", litros: f?.litros != null ? String(f.litros) : "" })
      if (limpiar) { setEdicion(null); setAjustes({}) }
    } finally {
      setCargando(false)
    }
  }, [activo, clavePlantas, fechaDia]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { cargar(true) }, [cargar])

  // Ruta del mapa entre las dos plantas (solo para mostrar y como respaldo del traslado)
  const plantRows = datos?.plantRows || []
  useEffect(() => {
    if (!activo || plantRows.length !== 2) return
    const [a, b] = plantRows
    if (a.gps_lat == null || a.gps_lng == null || b.gps_lat == null || b.gps_lng == null) return
    let vivo = true
    fetch(`/api/geo/ruta?desde=${a.gps_lat},${a.gps_lng}&hasta=${b.gps_lat},${b.gps_lng}`)
      .then((r) => r.json())
      .then((d) => { if (vivo && Number(d?.minutos) > 0) setRuta({ minutos: Number(d.minutos), km: Number(d.km) || 0 }) })
      .catch(() => {})
    return () => { vivo = false }
  }, [activo, plantRows])

  // Listo = ya se cargó este día (aunque esté recargando: se sigue con lo último hasta que llegue lo nuevo)
  const listo = activo && !!datos && datos.fecha === fechaDia && datos.plants.map((p) => p.id).join(",") === clavePlantas && datos.plantRows.length > 0
  const vista = useMemo(() => (listo && datos ? armarVistaDia(datos, { ajustes, edicion, ruta }) : null), [listo, datos, ajustes, edicion, ruta])
  useEffect(() => {
    if (pedirSugerencia && vista && !cargando) { setEdicion(clonar(vista.sugerido)); setPedirSugerencia(false) }
  }, [pedirSugerencia, vista, cargando])

  const plantas = vista?.plantas || []
  const nombres = vista?.nombres || {}
  const patentes = vista?.patentes || {}
  const traslado = vista?.traslado || trasladoDe(null)
  const amanece = vista?.amanece || {}
  const delDia = vista?.delDia || []
  const camiones = vista?.camiones || []
  const vigente = vista?.vigente || null
  const guardado = datos?.guardado || null
  const trasladoFila = datos?.traslado || { disponible: false, fila: null }

  // ---- Edición del reparto (sobre lo vigente) ----
  const editar = (f: (r: Reparto) => void) => {
    const base0 = vigente ? clonar(vigente) : {}
    for (const m of delDia) if (!base0[m.id]) base0[m.id] = { sale: true, tramos: [], duerme: amanece[m.id] ?? null }
    f(base0)
    setEdicion(base0)
  }
  const otraPlanta = (id: string) => plantas.find((p) => p.id !== id)?.id || id
  const alternar = (ts: { plantId: string; desde: number | null }[], arranca: string) => ts.map((t, i) => ({ ...t, plantId: i % 2 === 0 ? arranca : otraPlanta(arranca) }))
  const acciones = {
    setSale: (id: string, sale: boolean) => editar((r) => { r[id] = { ...r[id], sale } }),
    setArranca: (id: string, plantId: string) => editar((r) => { const ts = r[id].tramos.length ? r[id].tramos : [{ plantId, desde: null }]; r[id].tramos = alternar(ts, plantId) }),
    agregarCambio: (id: string) => editar((r) => {
      const ts = r[id].tramos
      if (!ts.length || ts.length > REGLAS_REPARTO.maxCambios) return
      const ult = ts[ts.length - 1]
      const vuelta = (vista?.resultado.tramos[id] || []).find((t) => t.plantId === ult.plantId && (t.desde ?? null) === ult.desde)?.ultimaVuelta
      const sale = Math.max((ult.desde ?? aMin("07:00")) + 30, vuelta ?? aMin("12:00"))
      ts.push({ plantId: otraPlanta(ult.plantId), desde: Math.round(sale + traslado.minutos) })
    }),
    setCambio: (id: string, i: number, salida: string) => editar((r) => { if (/^\d{2}:\d{2}$/.test(salida)) r[id].tramos[i].desde = aMin(salida) + traslado.minutos }),
    quitarCambio: (id: string, i: number) => editar((r) => { const ts = r[id].tramos; ts.splice(i, 1); r[id].tramos = ts.length ? alternar(ts, ts[0].plantId) : ts }),
    setDuerme: (id: string, plantId: string | null) => editar((r) => { r[id].duerme = plantId }),
    /** Hora o método de un pedido, sin guardar (null = volver a lo guardado) */
    setAjuste: (pedidoId: string, cambio: { hora?: string | null; metodo?: "bomba" | "directo" | null }) => setAjustes((a) => {
      const orig = datos?.pedidosHoy.find((p) => p.id === pedidoId)
      const x = { ...(a[pedidoId] || {}) }
      if (cambio.hora !== undefined) {
        if (!cambio.hora || (orig && horaArgentina(orig.scheduled_arrival_time) === cambio.hora)) delete x.hora
        else x.hora = cambio.hora
      }
      if (cambio.metodo !== undefined) {
        if (!cambio.metodo || cambio.metodo === orig?.metodo_descarga) delete x.metodo
        else x.metodo = cambio.metodo
      }
      const out = { ...a }
      if (x.hora || x.metodo) out[pedidoId] = x
      else delete out[pedidoId]
      return out
    }),
    /** Descarta el reparto editado y las horas y métodos sin guardar */
    descartar: () => { setEdicion(null); setAjustes({}) },
    /** "Ordenar el día": relee pedidos y viajes y deja la sugerencia como reparto en edición (respeta horas y métodos sin guardar) */
    ordenarDia: async () => { await cargar(false); setPedirSugerencia(true) },
  }

  async function guardar(): Promise<string | null> {
    if (!vigente) return "No hay reparto para guardar"
    const invalido = validarReparto(vigente, (id) => patentes[id] || "Un camión", (id) => nombres[id] || "la otra planta", traslado)
    if (invalido) return invalido
    setGuardando(true)
    const origen = mismoReparto(vigente, vista?.sugerido) ? "sugerido" : "a_mano"
    const { error } = await guardarReparto(createClient(), fechaDia, vigente, currentUserName(), origen)
    setGuardando(false)
    if (!error) { setEdicion(null); await cargar(false) }
    return error
  }

  // ---- Traslado (se guarda con "Guardar tiempos", con el motivo de siempre) ----
  const nf = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")))
  const trasladoNuevo = { minutos: nf(trasladoForm.minutos), km: nf(trasladoForm.km), litros: nf(trasladoForm.litros) }
  const trasladoCambiado = activo && trasladoFila.disponible && (
    trasladoNuevo.minutos !== (trasladoFila.fila?.minutos ?? null) || trasladoNuevo.km !== (trasladoFila.fila?.km ?? null) || trasladoNuevo.litros !== (trasladoFila.fila?.litros ?? null))
  const trasladoValido = trasladoNuevo.minutos != null && trasladoNuevo.minutos > 0 && [trasladoNuevo.km, trasladoNuevo.litros].every((x) => x == null || x > 0)
  const textoTrasladoFila = (f: { minutos: number | null; km: number | null; litros: number | null } | null) =>
    f && f.minutos ? `${f.minutos} min${f.km ? ` · ${f.km} km` : ""}${f.litros ? ` · ${f.litros} L` : ""}` : "sin cargar"
  async function guardarTrasladoForm(): Promise<{ error: string | null; detalle?: string }> {
    if (!trasladoCambiado) return { error: null }
    if (!trasladoValido || plants.length !== 2) return { error: "Revisá el traslado: los minutos son obligatorios y todo tiene que ser mayor a 0" }
    const { error } = await guardarTraslado(createClient(), plants[0].id, plants[1].id, { minutos: trasladoNuevo.minutos!, km: trasladoNuevo.km, litros: trasladoNuevo.litros }, currentUserName())
    if (error) return { error }
    const detalle = `${textoTrasladoFila(trasladoFila.fila)} → ${textoTrasladoFila(trasladoNuevo)}`
    await cargar()
    return { error: null, detalle }
  }

  const nAjustes = { horas: Object.values(ajustes).filter((a) => a.hora).length, metodos: Object.values(ajustes).filter((a) => a.metodo).length }
  return {
    vista, datos, fechaDia, ajustes, nAjustes,
    /** El día con otras opciones (por ejemplo, rearmando también los viajes ajustados a mano) */
    armarCon: (o: { rearmarManuales?: boolean }) => (datos && listo ? armarVistaDia(datos, { ajustes, edicion, ruta, ...o }) : null), hayCambios: !!edicion || nAjustes.horas + nAjustes.metodos > 0,
    entrada: vista?.entrada || null, obraDe: vista?.obraDe || ((id: string) => id), activo, cargando, listo,
    disponible: !!guardado?.disponible, guardado, plantas, nombres, patentes, camiones, delDia,
    traslado, trasladoFila, ruta, trasladoForm, setTrasladoForm, trasladoCambiado, trasladoValido, guardarTrasladoForm,
    sugerencia: vista?.sugerencia || null, sugerido: vista?.sugerido || null, resultado: vista?.resultado || null, noche: vista?.noche || null,
    efectivo: vista?.efectivo || null, edicion, vigente, amanece, avisos: vista?.avisos || [], contexto: vista?.contexto || null,
    noSalen: vista?.noSalen || new Set<string>(), guardando, setGuardando, guardar, cargar, ...acciones,
    nombreTraslado: plants.length === 2 ? `${plants[0].name} ↔ ${plants[1].name}` : "entre plantas",
  }
}

export type RepartoDia = ReturnType<typeof useRepartoDia>

/** Estilo de una planta: por nombre (Canning teal, Hudson violeta); si no, alternando */
function estiloPlanta(rep: RepartoDia, plantId: string) {
  const n = (rep.nombres[plantId] || "").toLowerCase()
  if (n.includes("canning")) return ESTILOS_PLANTA.teal
  if (n.includes("hudson")) return ESTILOS_PLANTA.violeta
  return rep.plantas.findIndex((p) => p.id === plantId) % 2 === 0 ? ESTILOS_PLANTA.teal : ESTILOS_PLANTA.violeta
}

const CHIP_VERDE = "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100"
const CHIP_AMBAR = "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
const CELDA_CAMBIADA = "border-amber-400 bg-amber-50 dark:bg-amber-950/40"

export function RepartoCamiones({ rep, dia, onArmarViajes, onGuardado }: {
  rep: RepartoDia
  dia: Date
  /** Abre el gerenciador ("Armar viajes") de ese pedido */
  onArmarViajes?: (p: PedidoDia) => void
  /** Después de "Guardar y confirmar" o de un 👍 (la vista de abajo relee) */
  onGuardado?: () => void
}) {
  const { toast } = useToast()
  const { puede, ajustaPedido } = usePermisos()
  // Ordenar el día, Editar y Guardar reparto: programacion.editar o despacho.cargar; Guardar y confirmar: programacion.editar
  const editaReparto = puede("programacion", "editar") || puede("despacho", "cargar")
  const editaTodo = puede("programacion", "editar")
  const [ayuda, setAyuda] = useState(false)
  const [verEditor, setVerEditor] = useState(false)
  const [abierto, setAbierto] = useState<string | null>(null)
  const [plan, setPlan] = useState<PlanGuardar | null>(null)
  // El tilde del cartel: rearmar también los viajes ajustados a mano (destildado por defecto)
  const [rearmarManuales, setRearmarManuales] = useState(false)
  const [trabajando, setTrabajando] = useState(false)
  const [empresas, setEmpresas] = useState<EmpresaBombeo[]>([])
  // Mail del armado (fase B): "Ver el mail" y "Enviar ahora"
  const [mailVisto, setMailVisto] = useState<{ asunto: string; html: string } | null>(null)
  const [mailTrabajando, setMailTrabajando] = useState<"ver" | "enviar" | null>(null)
  useEffect(() => { if (rep.activo) cargarEmpresasBombeo(createClient()).then(setEmpresas) }, [rep.activo])
  // 0 = con los camiones que hay; 1 / 2 = escenario con camiones ficticios (solo para ver)
  const [escenario, setEscenario] = useState<0 | 1 | 2>(0)
  // Los escenarios se arman sin el reparto guardado: con un camión más, los reales también pueden cambiar de planta
  const mas1 = useMemo(() => (rep.entrada ? escenarioConMas(rep.entrada, 1) : null), [rep.entrada])
  const mas2 = useMemo(() => (rep.entrada ? escenarioConMas(rep.entrada, 2) : null), [rep.entrada])

  if (!rep.activo) return null
  const v = rep.vista
  if (!rep.listo || !v) {
    return (
      <Card><CardContent className="p-4 text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Armando el reparto de camiones…
      </CardContent></Card>
    )
  }
  const base = v.resultado
  const esc = escenario === 1 ? mas1 : escenario === 2 ? mas2 : null
  const res = esc ? esc.resultado : base
  const camiones = esc ? esc.camiones : rep.camiones
  const patentes = { ...rep.patentes, ...Object.fromEntries((esc?.ficticios || []).map((c) => [c.id, c.patente])) }
  const amanece = { ...rep.amanece, ...Object.fromEntries((esc?.ficticios || []).map((c) => [c.id, c.amanece])) }
  const vigente = esc ? repartoDe(res, camiones, dondeDuermen(res, camiones, rep.plantas, null).duerme) : v.vigente
  const conteo = contarTraslados(vigente, amanece)
  const duerme = Object.fromEntries([...rep.delDia.map((m) => m.id), ...(esc?.ficticios || []).map((c) => c.id)].map((id) => [id, vigente[id]?.duerme ?? amanece[id] ?? null]))
  const sinPedidos = v.pedidos.length === 0
  // Mismo cálculo en la vista base y en los escenarios; el consejo de "+N" y de correr la hora, solo en la base
  const resumen = sinPedidos
    ? { tono: "verde" as const, texto: "No hay pedidos ese día. Cargalos en la vista Semana." }
    : esc ? textoResumenDia(camiones.length, res, null, null, "escenario") : textoResumenDia(camiones.length, res, mas1?.resultado ?? null, mas2?.resultado ?? null, "base")
  const filasDiagrama = bloquesDiagrama(res, camiones, rep.nombres, rep.obraDe)
  const tituloDia = format(dia, "EEEE dd/MM", { locale: es })
  const comparacion = !esc && v.efectivo && rep.sugerencia ? textoComparacion(franjasDe(rep.sugerencia, rep.camiones, rep.plantas), franjasDe(base, rep.camiones, rep.plantas), rep.nombres) : null
  const pendientes = v.pedidos.filter((p) => p.status !== "completed")
  const completados = v.pedidos.filter((p) => p.status === "completed")
  const confirmados = pendientes.filter((p) => p.confirmado_at).length
  const ajustes = rep.ajustes
  const cambiosTxt = [rep.nAjustes.horas ? `${rep.nAjustes.horas} ${rep.nAjustes.horas === 1 ? "hora" : "horas"}` : "", rep.nAjustes.metodos ? `${rep.nAjustes.metodos} ${rep.nAjustes.metodos === 1 ? "método" : "métodos"}` : "", rep.edicion ? "reparto" : ""].filter(Boolean).join(", ")
  const estadoTxt = rep.guardado?.reparto && !rep.edicion
    ? `Reparto guardado${rep.guardado.origen === "sugerido" ? " (la sugerencia)" : " a mano"}${rep.guardado.actualizadoPor ? ` por ${rep.guardado.actualizadoPor}` : ""}${rep.guardado.actualizado ? ` · ${format(new Date(rep.guardado.actualizado), "dd/MM HH:mm")}` : ""}.`
    : rep.disponible
      ? "Es la sugerencia, sin guardar: la tabla y el diagrama ya muestran lo que queda al guardar. Armar viajes propone los camiones de la sugerencia."
      : "Es solo la sugerencia: el reparto todavía no se puede guardar (falta un paso de Bautista). Guardar y confirmar guarda las horas, los viajes y los 👍."

  // Eje del diagrama: cada hora (o cada 2 si el día es largo)
  const todos = filasDiagrama.flatMap((f) => f.bloques)
  const t0 = Math.min(aMin("07:00"), ...todos.map((b) => Math.floor(b.desde / 60) * 60))
  const t1 = Math.max(aMin("18:00"), ...todos.map((b) => Math.ceil(b.hasta / 60) * 60))
  const paso = t1 - t0 > 10 * 60 ? 120 : 60
  const pos = (m: number) => `${((m - t0) / (t1 - t0)) * 100}%`
  const ancho = (a: number, b: number) => `calc(${Math.max(0.4, ((b - a) / (t1 - t0)) * 100)}% - 2px)`

  const nombrePedido = (p: PedidoDia) => v.filas.find((f) => f.id === p.id)?.nombre || rep.obraDe(p.id)
  const original = (id: string) => rep.datos?.pedidosHoy.find((p) => p.id === id)

  async function guardarSoloReparto() {
    const error = await rep.guardar()
    if (error) toast({ title: "No se guardó el reparto", description: error, variant: "destructive" })
    else toast({ title: "Reparto guardado", description: "Lo ven las dos plantas, desde cualquier computadora. Quedó en Actividad." })
  }

  /** El plan de "Guardar y confirmar"; con `rearmar`, los ajustados a mano también se rearman (el motor los vuelve a armar) */
  function abrirGuardarYConfirmar(rearmar = false) {
    const vr = rearmar && v!.manuales.length ? rep.armarCon({ rearmarManuales: true }) || v! : v!
    const p = planGuardarYConfirmar({
      tituloDia, ajustes, resultado: vr.resultado, viajesGuardados: rep.datos?.viajes || {}, vigente: vr.vigente, guardado: rep.guardado?.reparto || null,
      repartoDisponible: rep.disponible, origen: mismoReparto(vr.vigente, vr.sugerido) ? "sugerido" : "a_mano",
      pedidos: (rep.datos?.pedidosHoy || []).map((x) => ({ ...x, nombre: nombrePedido(x) } as any)),
      puedeAjustar: (x) => ajustaPedido(x), manuales: v!.manuales, rearmarManuales: rearmar,
    })
    setRearmarManuales(rearmar)
    setPlan(p)
  }

  /** Quien solo carga pedidos (programacion.cargar): guarda la hora y el método de sus filas y rearma esos viajes, como el Guardar de siempre */
  async function guardarMisFilas() {
    setTrabajando(true)
    const sb = createClient()
    const usuario = currentUserName()
    const hechos: string[] = [], fallas: string[] = []
    try {
      for (const [id, a] of Object.entries(ajustes)) {
        const orig = original(id)
        if (!orig || !ajustaPedido(orig)) continue
        const nombre = nombrePedido(orig)
        if (a.hora) {
          const { error } = await guardarHoraPedido(sb, orig, rep.fechaDia, a.hora)
          if (error) { fallas.push(`${nombre} (hora): ${error}`); continue }
        }
        if (a.metodo) {
          const { error } = await guardarMetodoPedido(sb, orig, a.metodo, true)
          if (error) { fallas.push(`${nombre} (método): ${error}`); continue }
        }
        const rv = await regenerarViajesPedido(sb, id, usuario, { soloSiTiene: true, motivo: [a.hora ? "hora de llegada" : "", a.metodo ? "método de descarga" : ""].filter(Boolean).join(" y ") })
        if (rv.error) fallas.push(`${nombre} (viajes): ${rv.error}`)
        hechos.push(nombre)
      }
    } finally {
      setTrabajando(false)
    }
    if (fallas.length) toast({ title: "Se guardó solo una parte", description: `Guardado: ${hechos.join(", ") || "nada"}. No se guardó: ${fallas.join(" · ")}`, variant: "destructive" })
    else toast({ title: "Cambios guardados", description: hechos.join(", ") })
    await rep.cargar(true)
    onGuardado?.()
  }

  async function guardarYConfirmar() {
    if (!plan) return
    setTrabajando(true)
    const sb = createClient()
    const usuario = currentUserName()
    const hechos: string[] = [], fallas: string[] = []
    const caidos = new Set<string>()
    // 1. Horas y métodos (sin rearmar los viajes: los graba el paso 3)
    for (const h of plan.horas) {
      const { error } = await guardarHoraPedido(sb, h.pedido, rep.fechaDia, h.hora)
      if (error) { caidos.add(h.pedido.id); fallas.push(`${nombrePedido(h.pedido as PedidoDia)} (hora): ${error}`) } else hechos.push(`hora de ${nombrePedido(h.pedido as PedidoDia)}`)
    }
    for (const m of plan.metodos) {
      if (caidos.has(m.pedido.id)) continue
      const { error } = await guardarMetodoPedido(sb, m.pedido, m.metodo, true)
      if (error) { caidos.add(m.pedido.id); fallas.push(`${nombrePedido(m.pedido as PedidoDia)} (método): ${error}`) } else hechos.push(`método de ${nombrePedido(m.pedido as PedidoDia)}`)
    }
    // 2. Reparto
    if (plan.reparto) {
      const invalido = validarReparto(plan.reparto.reparto, (id) => rep.patentes[id] || "Un camión", (id) => rep.nombres[id] || "la otra planta", rep.traslado)
      const { error } = invalido ? { error: invalido } : await guardarReparto(sb, rep.fechaDia, plan.reparto.reparto, usuario, plan.reparto.origen)
      if (error) fallas.push(`reparto: ${error}`)
      else hechos.push("reparto")
    }
    // 3. Viajes de los pedidos de las dos plantas
    const items = plan.viajes.filter((x) => !caidos.has(x.pedido.id))
    if (items.length) {
      const r = await guardarPlanDia(sb, items, (id) => (id ? rep.patentes[id] || "" : ""), usuario)
      if (r.ok.length) hechos.push(`viajes de ${r.ok.join(", ")}`)
      fallas.push(...r.errores.map((e) => `${e} (viajes)`))
    }
    // 4. Confirmar
    const aConfirmar = plan.confirmar.filter((x) => !caidos.has(x.id))
    if (aConfirmar.length) {
      const r = await confirmarPedidos(sb, aConfirmar, usuario, true)
      if (r.ok.length) hechos.push(`${r.ok.length} ${r.ok.length === 1 ? "confirmado" : "confirmados"}`)
      fallas.push(...r.errores)
    }
    setTrabajando(false)
    setPlan(null)
    if (fallas.length) toast({ title: "Se guardó solo una parte", description: `Guardado: ${hechos.join(", ") || "nada"}. No se guardó: ${fallas.join(" · ")}`, variant: "destructive" })
    else toast({ title: "Día guardado y confirmado", description: `${hechos.join(", ") || "Nada que cambiar"}. Quedó en Actividad.` })
    await rep.cargar(true)
    onGuardado?.()
  }

  async function llamarMail(accion: "ver" | "enviar") {
    setMailTrabajando(accion)
    try {
      const r = await fetch("/api/programacion/armado-dia", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fecha: rep.fechaDia, accion }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || d.ok === false) { toast({ title: accion === "ver" ? "No se pudo armar el mail" : "No se mandó el mail", description: d.error || `Error ${r.status}`, variant: "destructive" }); return }
      if (accion === "ver") setMailVisto({ asunto: d.asunto, html: d.html })
      else { toast({ title: d.prueba ? "Mail de prueba enviado" : "Mail enviado", description: d.a?.length ? `A ${d.a.join(", ")}` : undefined }); await rep.cargar(false) }
    } finally {
      setMailTrabajando(null)
    }
  }

  async function alternarConfirmado(p: PedidoDia) {
    const { errores } = await confirmarPedidos(createClient(), [p], currentUserName(), !p.confirmado_at)
    if (errores.length) toast({ title: "No se pudo confirmar", description: errores.join(" · "), variant: "destructive" })
    await rep.cargar(false)
    onGuardado?.()
  }

  // Detalle de una fila (lo secundario de la lista de antes)
  function Detalle({ p }: { p: PedidoDia }) {
    const r = res.pedidos.find((x) => x.id === p.id)
    const row = rep.datos?.plantRows.find((x) => x.id === p.plant_id)
    const prmBase = parametrosDePlanta(row)
    const prm = parametrosConGps(prmBase, p.plant_id, rep.datos?.tiempos || null)
    const td = tiemposDelPedido(p as PedidoParaViajes, prmBase, rep.datos?.tiempos || null)
    const descObra = textoDescargaObra(td)
    const sugM3 = m3ParaSugerir(td, p.m3_por_viaje)
    const enviados = Number(p.dispatched_m3 || 0)
    const guardadosDia = (rep.datos?.pedidosHoy || []).flatMap((x) => (rep.datos?.viajes[x.id] || []).filter((y) => y.estado !== "cancelado"))
    const choques = choquesDeCamion(guardadosDia)
    void prm
    return (
      <div className="text-[11px] text-muted-foreground space-y-0.5 py-1">
        <p>{[p.clients?.name, `${Number(p.quantity_m3)} m³`, p.formulas?.code, p.finalidad].filter(Boolean).join(" · ")}{enviados > 0 ? ` · ${enviados} de ${Number(p.quantity_m3)} m³ ya enviados` : ""}</p>
        <p>Tiempos: {textoTiempos(td)}</p>
        {descObra && <p>{descObra}</p>}
        {p.metodo_descarga === "bomba" && "bomba_la_pone" in p && <p className="text-sky-700 dark:text-sky-400">{textoBomba(p as any, empresas, "Bomba")}</p>}
        {"bomba_la_pone" in p && bombaSinEmpresa(p as any) && <p className="text-amber-700 dark:text-amber-400">Pedido con bomba sin empresa asignada: confirmala el día anterior (vista Semana › editar pedido)</p>}
        {p.suspendido_at && <p>⏸ Suspendido · {textoMotivo(p.suspendido_motivo_tipo)}</p>}
        {p.construction_sites?.gps_lat == null && <p className="text-amber-700 dark:text-amber-400 flex items-center gap-0.5"><MapPin className="h-3 w-3" />obra sin ubicar</p>}
        {sugM3 && <p className="text-violet-700 dark:text-violet-400">Esta obra suele llevar {sugM3.m3.toLocaleString("es-AR")} m³ por camión ({sugM3.viajes} viajes). Se cambia en el pedido (m³ por camión).</p>}
        {(rep.datos?.viajes[p.id] || []).filter((x) => x.estado === "planificado" && choques.has(claveViaje(x))).map((x) => (
          <p key={x.n} className="text-amber-700 dark:text-amber-400">Viaje {x.n}: {textoChoque(choques.get(claveViaje(x))!, rep.patentes[x.mixer_id || ""] || "—", rep.obraDe(choques.get(claveViaje(x))!.otro.pedido_id))}</p>
        ))}
        {r && <p>{r.texto}</p>}
      </div>
    )
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        {/* Encabezado */}
        <div className="flex items-start gap-3 flex-wrap">
          <div>
            <p className="text-sm font-medium flex items-center gap-1.5">
              <Truck className="h-4 w-4" /> Camiones por planta · {tituloDia} <NuevoBadge />
              <button type="button" className="text-muted-foreground hover:text-foreground" title="Cómo se calcula" onClick={() => setAyuda(!ayuda)}><CircleHelp className="h-4 w-4" /></button>
            </p>
            <p className="text-xs text-muted-foreground">
              {rep.camiones.length === 1 ? "1 camión disponible" : `${rep.camiones.length} camiones disponibles`}
              {esc ? ` · escenario con ${esc.extra === 1 ? "1 camión más" : "2 camiones más"} (${esc.ficticios.map((c) => `${c.patente} en ${rep.nombres[c.amanece || ""]}`).join(", ")})` : ""}
            </p>
          </div>
          <div className="ml-auto flex flex-col items-end gap-1">
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <div className="inline-flex rounded-md border overflow-hidden">
                {([[0, `Con los que hay (${rep.camiones.length})`], [1, "+1 camión"], [2, "+2 camiones"]] as const).map(([k, l]) => (
                  <button key={k} type="button" onClick={() => setEscenario(k)} disabled={(k === 1 && !mas1) || (k === 2 && !mas2)}
                    className={cn("px-2.5 py-1 text-xs border-l first:border-l-0", escenario === k ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted")}>{l}</button>
                ))}
              </div>
              {editaReparto && (
                <Button size="sm" variant="outline" className="gap-1.5" disabled={!!esc || rep.cargando} title="Vuelve a leer pedidos y viajes y deja la sugerencia" onClick={() => {
                  if (rep.edicion && !mismoReparto(rep.edicion, v.sugerido) && !window.confirm("Vuelve a la sugerencia y se pierde el reparto editado. ¿Seguir?")) return
                  rep.ordenarDia()
                }}><ListOrdered className="h-3.5 w-3.5" />Ordenar el día</Button>
              )}
              {editaReparto && <Button size="sm" variant="outline" disabled={!!esc} onClick={() => setVerEditor(!verEditor)}>{verEditor ? "Cerrar edición" : "Editar"}</Button>}
              {editaReparto && !esc && rep.hayCambios && <Button size="sm" variant="ghost" onClick={rep.descartar}>Descartar</Button>}
              {!editaTodo && puede("programacion", "cargar") && Object.keys(ajustes).some((id) => { const o = original(id); return !!o && ajustaPedido(o) }) && (
                <Button size="sm" onClick={guardarMisFilas} disabled={!!esc || trabajando} title="Guarda la hora y el método de tus pedidos cambiados">
                  {trabajando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Guardar"}
                </Button>
              )}
              {editaTodo ? (
                <Button size="sm" onClick={() => abrirGuardarYConfirmar(false)} disabled={!!esc || trabajando || sinPedidos} title={esc ? TEXTO_ESCENARIO : undefined}>
                  {trabajando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Guardar y confirmar"}
                </Button>
              ) : editaReparto && rep.disponible ? (
                <Button size="sm" onClick={guardarSoloReparto} disabled={!!esc || rep.guardando || (!rep.edicion && !!rep.guardado?.reparto)} title={esc ? TEXTO_ESCENARIO : "Cambia el reparto de las dos plantas"}>
                  {rep.guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Guardar reparto"}
                </Button>
              ) : null}
            </div>
            {!sinPedidos && <p className="text-xs text-muted-foreground">👍 {confirmados} de {pendientes.length} confirmados</p>}
          </div>
        </div>
        {esc && (editaTodo || editaReparto) && <p className="text-xs text-muted-foreground text-right">{TEXTO_ESCENARIO}.</p>}
        {!esc && rep.hayCambios && (
          <p className="text-xs text-amber-700 dark:text-amber-400">Cambios sin guardar ({cambiosTxt}): la tabla y el diagrama ya los usan.</p>
        )}

        {/* Ayuda (?) */}
        {ayuda && (
          <div className="text-xs text-muted-foreground rounded-md bg-muted/50 px-3 py-2 space-y-1">
            <p>{estadoTxt}</p>
            <p>Para cada pedido se busca la menor cantidad de camiones que alcanza: a tiempo es, con bomba, sin cortes de más de {REGLAS_REPARTO.bomba.corteMax} min y no más de {REGLAS_REPARTO.bomba.demoraMax} min tarde; directo, {REGLAS_REPARTO.directo.corteMax} y {REGLAS_REPARTO.directo.demoraMax}. Se elige lo que deja menos minutos de atraso en total (la bomba pesa el doble) y después menos traslados. Un camión sin viajes no se mueve. A la noche cada camión queda donde termina, salvo que mañana a una planta le falten para arrancar.</p>
            <p>Llega a obra y Método se pueden cambiar en la tabla: el día se recalcula en el momento y se guarda con Guardar y confirmar (horas, reparto, viajes de las dos plantas y 👍).</p>
            <p>"+1 camión" y "+2 camiones" muestran qué pasaría con camiones de 8 m³ disponibles desde las 07:00 en la planta donde más convenga. Son solo para ver: no se guardan.</p>
            {comparacion && <p>{comparacion}</p>}
            {!esc && rep.noche && <p>{rep.noche.textos.join(" · ")}</p>}
            <p>El traslado entre plantas (minutos, km y litros) se carga en Tiempos y camiones.</p>
          </div>
        )}

        {/* Resumen en una frase y los números del día */}
        <div className="space-y-1">
          <p className={cn("text-sm rounded-md border px-3 py-2", resumen.tono === "verde"
            ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100"
            : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100")}>{resumen.texto}</p>
          {!sinPedidos && !esc && <p className="text-xs text-muted-foreground">{v.numeros}</p>}
        </div>

        {/* Tabla por pedido (la misma del mail): lo que se ve es lo que se guarda */}
        {!sinPedidos && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-b text-left">
                  <th className="py-1.5 pr-2 font-medium">Pedido</th>
                  <th className="py-1.5 pr-2 font-medium">Viajes</th>
                  <th className="py-1.5 pr-2 font-medium">Camiones</th>
                  <th className="py-1.5 pr-2 font-medium">Comienza</th>
                  <th className="py-1.5 pr-2 font-medium">Termina</th>
                  <th className="py-1.5 pr-2 font-medium">Llega a obra</th>
                  <th className="py-1.5 pr-2 font-medium">Método</th>
                  <th className="py-1.5 pr-2 font-medium">Estado</th>
                  <th className="py-1.5 font-medium" />
                </tr>
              </thead>
              <tbody>
                {(esc ? res.pedidos.map((r) => r.id) : v.filas.map((f) => f.id)).map((id) => {
                  const f = v.filas.find((x) => x.id === id)
                  const r = res.pedidos.find((x) => x.id === id)
                  const p = v.pedidos.find((x) => x.id === id)
                  const orig = original(id)
                  if (!f || !r || !p || !orig) return null
                  const e = (() => { const x = esc ? res.pedidos.find((y) => y.id === id)! : null; return x ? { texto: estadoDe(x), aTiempo: x.alcanza && x.viajes.length > 0 } : { texto: f.estado, aTiempo: f.aTiempo } })()
                  const cargas = r.viajes.map((x) => x.inicioCarga)
                  const ajusta = ajustaPedido(orig) && !esc
                  const tituloAjusta = !ajustaPedido(orig) ? `Pedido de ${orig.created_by || "otra persona"}: solo lo ajusta quien lo cargó o un gerencial` : undefined
                  const aj = ajustes[id]
                  const hora = aj?.hora ?? horaArgentina(orig.scheduled_arrival_time)
                  const metodo = (aj?.metodo ?? orig.metodo_descarga) || (orig.construction_sites?.requires_pump ? "bomba" : "directo")
                  const sale = aHora(((aMin(hora) - viajeMinDe(conTiemposGps(p as PedidoParaViajes, parametrosConGps(parametrosDePlanta(rep.datos?.plantRows.find((x) => x.id === p.plant_id)), p.plant_id, rep.datos?.tiempos || null), rep.datos?.tiempos || null))) + 1440) % 1440)
                  const nViajes = (rep.datos?.viajes[id] || []).filter((x) => x.estado !== "cancelado").length
                  return [
                    <tr key={id} className="border-t align-top">
                      <td className="py-1.5 pr-2">
                        <button type="button" className="flex items-start gap-1 text-left" onClick={() => setAbierto(abierto === id ? null : id)}>
                          {abierto === id ? <ChevronDown className="h-3.5 w-3.5 mt-0.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
                          <span><span className="font-medium">{f.nombre}</span>{orig.suspendido_at ? " ⏸" : ""}<span className="block text-muted-foreground">{f.planta}</span></span>
                        </button>
                      </td>
                      <td className="py-1.5 pr-2">{r.viajes.length}</td>
                      <td className="py-1.5 pr-2">{r.camiones.length} <span className="text-muted-foreground">{r.camiones.map((c) => patentes[c]).join(", ")}</span></td>
                      <td className="py-1.5 pr-2">{cargas.length ? aHora(Math.round(Math.min(...cargas))) : "—"}</td>
                      <td className="py-1.5 pr-2">{r.viajes.length ? aHora(Math.round(r.medida.fin)) : "—"}</td>
                      <td className="py-1.5 pr-2">
                        <Hora24 value={hora} disabled={!ajusta} title={tituloAjusta} onChange={(h) => rep.setAjuste(id, { hora: h })}
                          className={cn("h-7 w-[96px] text-xs", aj?.hora && CELDA_CAMBIADA)} />
                        <span className="block text-[10px] text-muted-foreground">sale {sale}</span>
                      </td>
                      <td className="py-1.5 pr-2">
                        <span className="inline-flex items-center gap-1">
                          <span className={cn("inline-flex rounded border overflow-hidden", aj?.metodo && CELDA_CAMBIADA)}>
                            {(["bomba", "directo"] as const).map((m) => (
                              <button key={m} type="button" disabled={!ajusta} title={tituloAjusta} onClick={() => rep.setAjuste(id, { metodo: m })}
                                className={cn("px-1.5 py-0.5 text-[11px]", metodo === m ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>{m === "bomba" ? "Bomba" : "Directo"}</button>
                            ))}
                          </span>
                          {metodo === "bomba" && "bomba_la_pone" in orig && bombaSinEmpresa(orig as any) && <span title="Bomba sin empresa asignada"><AlertTriangle className="h-3.5 w-3.5 text-amber-600" /></span>}
                        </span>
                      </td>
                      <td className="py-1.5 pr-2">
                        <span className="flex flex-wrap gap-1">
                          <span className={cn("rounded-full px-2 py-0.5", e.aTiempo ? CHIP_VERDE : CHIP_AMBAR)}>{e.texto}</span>
                          {!esc && f.jornada && <span className={cn("rounded-full px-2 py-0.5", CHIP_AMBAR)}>{f.jornada}</span>}
                        </span>
                      </td>
                      <td className="py-1.5 whitespace-nowrap text-right">
                        {onArmarViajes && (
                          <Button size="sm" variant="outline" className="h-6 px-1.5 text-[11px] gap-1" disabled={!!aj || !!esc} title={aj ? "Guardá la hora antes de armar viajes" : undefined} onClick={() => onArmarViajes(orig)}>
                            <Truck className="h-3 w-3" />{nViajes ? `Viajes (${nViajes})` : "Armar viajes"}
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" className={cn("h-6 px-1.5 text-[11px]", orig.confirmado_at && "text-emerald-700 dark:text-emerald-400")} disabled={!ajustaPedido(orig) || !!esc}
                          title={orig.confirmado_at ? `Confirmado por ${orig.confirmado_por || "-"} · ${format(new Date(orig.confirmado_at), "dd/MM HH:mm")} (tocá para quitar)` : "Confirmar"} onClick={() => alternarConfirmado(orig)}>
                          👍{orig.confirmado_at ? " ✓" : ""}
                        </Button>
                      </td>
                    </tr>,
                    abierto === id ? <tr key={`${id}-d`}><td colSpan={9} className="pl-6 pb-1.5"><Detalle p={p} /></td></tr> : null,
                  ]
                })}
                {!esc && completados.map((p) => (
                  <tr key={p.id} className="border-t text-muted-foreground">
                    <td className="py-1.5 pr-2" colSpan={9}>{rep.obraDe(p.id)} · {rep.nombres[p.plant_id]} · Completado · {Number(p.quantity_m3)} m³</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Traslados en una línea y la noche */}
        <div className="text-xs space-y-0.5">
          <p className="flex items-center gap-1.5"><ArrowLeftRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />{lineaTraslados(res, conteo, rep.traslado, rep.nombres, patentes)}</p>
          <p className="flex items-center gap-1.5"><Moon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />{textoNoche(duerme, rep.plantas)}</p>
        </div>

        {/* Avisos del día (traslado a confirmar, cambios a mano, camiones en dos viajes) */}
        {rep.avisos.length > 0 && !esc && (
          <div className="space-y-0.5">
            {rep.avisos.map((a, i) => (
              <p key={i} className={cn("text-xs flex items-start gap-1", a.nivel === "info" ? "text-muted-foreground" : "text-amber-700 dark:text-amber-400")}>
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />{a.texto}
              </p>
            ))}
          </div>
        )}

        {/* Mail del armado (fase B): estado, Ver el mail y Enviar ahora */}
        {!esc && !sinPedidos && (
          <div className="flex items-start gap-2 flex-wrap text-xs text-muted-foreground">
            <Mail className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <div className="space-y-0.5">
              {textoEstadoMail((rep.datos?.armadoMail as EstadoMail | null) || null, rep.fechaDia, Date.now(), rep.hayCambios).map((t, i) => <p key={i}>{t}</p>)}
            </div>
            <div className="ml-auto flex gap-1.5">
              <Button size="sm" variant="outline" className="h-6 px-2 text-[11px] gap-1" disabled={!!mailTrabajando} onClick={() => llamarMail("ver")}>
                {mailTrabajando === "ver" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mail className="h-3 w-3" />}Ver el mail
              </Button>
              {editaTodo && (
                <Button size="sm" variant="outline" className="h-6 px-2 text-[11px] gap-1" disabled={!!mailTrabajando || rep.hayCambios} title={rep.hayCambios ? "Guardá los cambios antes de mandar" : undefined}
                  onClick={() => { if (window.confirm(`Se manda ahora el armado del ${tituloDia} a ${MAIL_ARMADO_A.join(", ").split(" ")[0]} con copia a ${MAIL_ARMADO_CC.join(", ").split(" ")[0]}.`)) llamarMail("enviar") }}>
                  {mailTrabajando === "enviar" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}Enviar ahora
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Diagrama: una fila por camión, un bloque por viaje (de la carga a la vuelta) */}
        <div className="overflow-x-auto">
          <div className="min-w-[680px] space-y-1">
            <div className="grid grid-cols-[84px_minmax(0,1fr)] gap-2 text-[11px] text-muted-foreground">
              <span />
              <div className="relative h-4">
                {Array.from({ length: Math.floor((t1 - t0) / paso) + 1 }, (_, i) => t0 + i * paso).map((t) => <span key={t} className="absolute -translate-x-1/2" style={{ left: pos(t) }}>{aHora(t)}</span>)}
              </div>
            </div>
            {filasDiagrama.map((f) => (
              <div key={f.camionId} className="grid grid-cols-[84px_minmax(0,1fr)] gap-2 items-center">
                <span className={cn("text-xs font-medium truncate", f.ficticio && "italic text-muted-foreground")}>{f.patente}</span>
                <div className="relative h-7 border-b border-dashed border-border">
                  {f.bloques.map((b, i) => {
                    const est = b.tipo === "traslado" ? ESTILO_TRASLADO : estiloPlanta(rep, b.plantId)
                    return (
                      <div key={i} className={cn("absolute top-0.5 h-6 rounded border px-1 text-[10px] leading-6 truncate", est.bloque)} style={{ left: pos(b.desde), width: ancho(b.desde, b.hasta) }}
                        title={`${b.texto} · ${b.detalle}`}>
                        {b.texto}
                      </div>
                    )
                  })}
                  {!f.bloques.length && <span className="absolute inset-y-0 left-1 flex items-center text-[11px] text-muted-foreground">sin viajes</span>}
                </div>
              </div>
            ))}
            <div className="flex gap-3 text-[11px] text-muted-foreground flex-wrap pt-1">
              {rep.plantas.map((p) => <span key={p.id} className="flex items-center gap-1"><span className={cn("h-2.5 w-2.5 rounded-sm", estiloPlanta(rep, p.id).punto)} />{p.nombre}</span>)}
              <span className="flex items-center gap-1"><span className={cn("h-2.5 w-2.5 rounded-sm", ESTILO_TRASLADO.punto)} />Traslado</span>
            </div>
          </div>
        </div>

        {/* Editor del reparto (con los camiones reales; no en un escenario) */}
        {verEditor && editaReparto && !esc && (
          <div className="rounded-md border px-3 py-2 space-y-1.5">
            <p className="text-xs font-medium">Editar el reparto <span className="font-normal text-muted-foreground">(las horas son de salida de la planta; el cambio se ve arriba al momento)</span></p>
            {rep.delDia.map((m) => {
              const r = v.vigente[m.id]
              if (!r) return null
              const sale = r.sale !== false
              const ts = base.tramos[m.id] || []
              return (
                <div key={m.id} className="flex items-center gap-2 flex-wrap text-xs">
                  <span className={cn("w-[76px] font-medium", !sale && "line-through text-muted-foreground")}>{m.license_plate}</span>
                  <label className="flex items-center gap-1"><input type="checkbox" checked={sale} onChange={(ev) => rep.setSale(m.id, ev.target.checked)} />Sale hoy</label>
                  {sale && (
                    <>
                      <span className="text-muted-foreground">Arranca en</span>
                      <Select value={r.tramos[0]?.plantId || "none"} onValueChange={(x) => x !== "none" && rep.setArranca(m.id, x)}>
                        <SelectTrigger className="h-7 w-[120px] text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {!r.tramos.length && <SelectItem value="none">A confirmar</SelectItem>}
                          {rep.plantas.map((p) => <SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {r.tramos.slice(1).map((t, k) => (
                        <span key={k} className="flex items-center gap-1 rounded border px-1.5 py-0.5">
                          Pasa a {rep.nombres[t.plantId]} a las
                          <Hora24 className="h-6 w-[96px] text-xs" value={t.desde != null ? aHora(Math.max(0, Math.round(t.desde - rep.traslado.minutos))) : ""} onChange={(h) => rep.setCambio(m.id, k + 1, h)} />
                          <span className="text-muted-foreground">(llega {t.desde != null ? aHora(Math.round(t.desde)) : "—"})</span>
                          <button type="button" className="text-muted-foreground hover:text-destructive" title="Quitar este cambio" onClick={() => rep.quitarCambio(m.id, k + 1)}><X className="h-3 w-3" /></button>
                        </span>
                      ))}
                      {r.tramos.length > 0 && r.tramos.length <= REGLAS_REPARTO.maxCambios && (
                        <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs gap-0.5" onClick={() => rep.agregarCambio(m.id)}><Plus className="h-3 w-3" />Pasa a la otra planta</Button>
                      )}
                      {ts.map((t, i) => (i < ts.length - 1 && t.ultimaVuelta != null ? <span key={`s${i}`} className="text-muted-foreground">sale de {rep.nombres[t.plantId]} {aHora(Math.round(t.ultimaVuelta))}</span> : null))}
                    </>
                  )}
                  <span className="text-muted-foreground ml-2">Duerme en</span>
                  <Select value={r.duerme || "none"} onValueChange={(x) => rep.setDuerme(m.id, x === "none" ? null : x)}>
                    <SelectTrigger className="h-7 w-[120px] text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">A confirmar</SelectItem>
                      {rep.plantas.map((p) => <SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <span className="text-muted-foreground">durmió en: {rep.amanece[m.id] ? `${rep.nombres[rep.amanece[m.id]!]} (${v.fuenteAmanece[m.id] === "gps" ? `GPS ${(() => { const t = rep.datos?.amanecer?.find((a) => a.mixer_id === m.id)?.tomado_at; return t ? horaArgentina(t) : "" })()}`.trim() : "reparto"})` : "a confirmar"}</span>
                </div>
              )
            })}
            <div className="flex justify-end">
              <Button size="sm" variant="ghost" className="gap-1.5 h-7 text-xs" onClick={() => {
                if (rep.hayCambios && !window.confirm("Tenés cambios sin guardar. Si recalculás, se pierden. ¿Seguir?")) return
                rep.cargar(true)
              }}><RefreshCw className="h-3.5 w-3.5" />Recalcular</Button>
            </div>
          </div>
        )}

        {/* "Ver el mail": el HTML que saldría ahora (no manda nada) */}
        <Dialog open={!!mailVisto} onOpenChange={(o) => !o && setMailVisto(null)}>
          <DialogContent className="sm:max-w-3xl max-h-[92vh] overflow-y-auto">
            <DialogHeader><DialogTitle className="text-sm">{mailVisto?.asunto}</DialogTitle></DialogHeader>
            {mailVisto && <iframe title="Mail del armado" srcDoc={mailVisto.html} className="w-full h-[70vh] rounded border bg-white" sandbox="" />}
          </DialogContent>
        </Dialog>

        {/* Cartel de "Guardar y confirmar" */}
        <AlertDialog open={!!plan} onOpenChange={(o) => !o && !trabajando && setPlan(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{plan?.titulo}</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2 text-sm">
                  {rep.avisos.filter((a) => a.nivel === "rojo").length > 0 && (
                    <div className="rounded border border-amber-300 bg-amber-50 dark:bg-amber-950/40 px-2 py-1 text-xs text-amber-900 dark:text-amber-100 space-y-0.5">
                      {rep.avisos.filter((a) => a.nivel === "rojo").map((a, i) => <p key={i}>{a.texto}</p>)}
                      <p>Se puede guardar igual.</p>
                    </div>
                  )}
                  <p>{plan?.texto}</p>
                  {!!plan?.manuales.length && (
                    <div className="rounded border px-2 py-1 text-xs space-y-1">
                      <p><strong>Viajes ajustados a mano: se dejan como están</strong> ({plan.manuales.map((x) => x.nombre).join(", ")}).</p>
                      <label className="flex items-center gap-1.5">
                        <input type="checkbox" checked={rearmarManuales} disabled={trabajando} onChange={(ev) => abrirGuardarYConfirmar(ev.target.checked)} />
                        Rearmarlos también
                      </label>
                    </div>
                  )}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={trabajando}>Cancelar</AlertDialogCancel>
              <AlertDialogAction disabled={trabajando} onClick={(ev) => { ev.preventDefault(); guardarYConfirmar() }}>
                {trabajando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar y confirmar"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  )
}

/** Texto del chip de un pedido en un escenario (mismo criterio que la tabla) */
function estadoDe(r: Parameters<typeof estadoPedidoFn>[0]) { return estadoPedidoFn(r).texto }
