"use client"

/**
 * Pantalla de Carga de planta (carga-planta.md, puntos 19 a 21; maqueta-carga-planta.html, pestaña "Carga").
 *
 * Secuencia A, como Loop: Despacho graba el despacho e imprime el remito; la orden llega a esta cola; acá se carga.
 * ETAPA SIMULADA: la planta es un simulador que corre en este navegador (cuando este equipo es "la PC de la planta").
 * No hay conexión con Indumix. Las cargas quedan marcadas `simulada`: no ajustan el stock ni corrigen despachos.
 *
 * - PC de la planta: cola, planta en vivo, CARGAR, Suspender, Bocina, Extra agua y PARAR fijo (sin permiso).
 * - Otro equipo (vista remota): lo mismo, leído de la base cada 5 s, sin CARGAR ni PARAR.
 * - Pestañas Recetas de la planta y Alertas; la Auditoría de carga va aparte (/carga/auditoria).
 * - 1366×768 sin scrollear, 13 px de base, respeta el alto contraste (clases d3c de la fase 3).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { RefreshCw } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { createClient } from "@/lib/supabase/client"
import { usePermisos } from "@/lib/current-user"
import { NuevoBadge } from "@/components/nuevo-badge"
import { SinAcceso } from "@/components/seccion-protegida"
import { cn } from "@/lib/utils"
import { controlDeFormula, recetaDeFormula, type Contexto } from "@/lib/carga/datos"
import { efectoSobreDespacho, type ModoParada } from "@/lib/carga/cierre"
import { banderas, type FilaAuditoria } from "@/lib/carga/auditoria"
import { recetasIniciales } from "@/lib/carga/recetas-sim"
import { INFO_SALIDA, SALIDAS, grupoDeSalida, nf, type Salida } from "@/lib/carga/tipos"
import { cantidadPorM3 } from "@/lib/carga/receta"
import { Btn, CartelSimulada, Chip, Tag, hhmm, hms, m3t, mmss } from "./comun"
import { PlantaVivo, TablaPesajes, nombreCorto } from "./planta-vivo"
import { ConfirmarCamion, MotivoDialog, PruebaDialog, ReporteDialog, TolvaDialog, type FilaReporte } from "./dialogos-carga"
import { AlertasCarga, ResolverDialog } from "./alertas-carga"
import { RecetasPlanta } from "./recetas-planta"
import { usarDatosCarga, ESTADOS_COLA, ESTADOS_PLANTA, type AlertaFila, type CargaFila } from "./usar-datos-carga"
import { usarPuenteSimulado } from "./usar-puente-simulado"
import { Buscador, coincide } from "@/components/despacho/buscador"
import { agregarMuestraDespacho, asentamientoValido } from "@/lib/muestra"
import { logActivity } from "@/lib/activity-log"

type Planta = { id: string; name: string }
type Tab = "carga" | "recetas" | "alertas"
const CLAVE_EQUIPO = "rebucret_carga_equipo"
const leerLS = (k: string) => { try { return window.localStorage.getItem(k) } catch { return null } }
const guardarLS = (k: string, v: string) => { try { window.localStorage.setItem(k, v) } catch { /* sin almacenamiento */ } }

type Item = { clave: string; ok: boolean; aviso?: boolean; neutro?: boolean; corto: string; texto: string }

export function PantallaCarga({ plants }: { plants: Planta[] }) {
  const { listo, usuario, puede } = usePermisos()
  if (!listo) return null
  if (!usuario?.veFuncionesNuevas) return <SinAcceso texto="La carga de planta está en prueba: por ahora la ven solo los usuarios con las funciones nuevas." />
  return <Pantalla plants={plants} puedeCargar={puede("carga", "cargar")} puedeEditar={puede("carga", "editar")} puedeResolver={puede("formulas", "editar")} puedeMuestra={puede("historial", "cargar")} />
}

function Pantalla({ plants, puedeCargar, puedeEditar, puedeResolver, puedeMuestra }: { plants: Planta[]; puedeCargar: boolean; puedeEditar: boolean; puedeResolver: boolean; puedeMuestra: boolean }) {
  const { toast } = useToast()
  const aviso = useCallback((title: string, description?: string) => toast({ title, description }), [toast])
  const [planta, setPlanta] = useState(() => plants.find((p) => p.name === "Canning")?.id || plants[0]?.id || "")
  const [tab, setTab] = useState<Tab>("carga")
  const [equipo, setEquipo] = useState<"planta" | "otro">("otro")
  useEffect(() => { if (leerLS(CLAVE_EQUIPO) === "planta" && puedeCargar) setEquipo("planta") }, [puedeCargar])
  const enPlanta = equipo === "planta" && puedeCargar
  const D = usarDatosCarga(planta, enPlanta ? 3000 : 5000)
  const { ctx, puesto } = D
  const simulada = puesto?.sistema === "simulador"
  const P = usarPuenteSimulado({ activo: enPlanta && !!ctx && simulada, ctx, formulas: D.formulas, onCambio: D.leer, onAviso: aviso })
  const [sel, setSel] = useState<string | null>(null)
  const [ahora, setAhora] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setAhora(Date.now()), 1000); return () => clearInterval(t) }, [])
  useEffect(() => { const q = new URLSearchParams(window.location.search).get("carga"); if (q) setSel(q) }, [])

  // Diálogos
  const [confirmar, setConfirmar] = useState<CargaFila | null>(null)
  const [parada, setParada] = useState<{ carga: CargaFila; modo: ModoParada } | null>(null)
  const [cancelar, setCancelar] = useState<CargaFila | null>(null)
  const [tolva, setTolva] = useState(false)
  const [prueba, setPrueba] = useState(false)
  const [resolver, setResolver] = useState<AlertaFila | null>(null)
  const [reporte, setReporte] = useState<{ carga: CargaFila; filas: FilaReporte[] } | null>(null)
  const [humAcopio, setHumAcopio] = useState<number | null>(null)
  const [muestra, setMuestra] = useState<CargaFila | null>(null)
  const [buscarCola, setBuscarCola] = useState("")

  // Humedad del acopio de la Arena Fina (aviso si difiere de la de Indumix más de 1,5 puntos; no frena)
  useEffect(() => {
    const af = ctx?.materiales.find((m) => m.name === "Arena Fina")
    if (!af) return
    const d = new Date(); const dia = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    createClient().from("daily_stockpile_humidity").select("humidity_percent").eq("material_id", af.id).eq("reading_date", dia).order("created_at", { ascending: false }).limit(1)
      .then((r: any) => setHumAcopio(r.data?.[0] ? Number(r.data[0].humidity_percent) : null))
  }, [ctx?.materiales])

  // ── Derivados ──
  const sinInternet = enPlanta && !P.internet
  const cola = useMemo(() => D.cargas.filter((c) => ESTADOS_COLA.includes(c.estado))
    .sort((a, b) => (b.completa_carga_id ? 1 : 0) - (a.completa_carga_id ? 1 : 0) || a.created_at.localeCompare(b.created_at)), [D.cargas])
  // Sin internet (simulado), lo nuevo no baja a la PC de la planta: se ve solo lo que ya bajó
  const colaVisible = sinInternet ? cola.filter((c) => c.bajada_at) : cola
  const sinBajar = cola.length - colaVisible.length
  const yaCargadas = D.cargas.filter((c) => c.estado === "ya_cargada_indumix")
  const enPlantaDB = D.cargas.filter((c) => ESTADOS_PLANTA.includes(c.estado) && !(c.estado === "parada" && c.resolucion?.modo))
  const activa = (P.orden ? D.cargas.find((c) => c.id === P.orden!.cargaId) : null) || enPlantaDB[0] || null
  const ultimaId = P.ultima?.cargaId || null
  const ultimaCarga = ultimaId ? D.cargas.find((c) => c.id === ultimaId) || null : null
  const elegida = (sel && colaVisible.find((c) => c.id === sel)) || colaVisible[0] || null
  const formulaDe = useCallback((id: string | null) => D.formulas.find((f) => f.id === id) || null, [D.formulas])
  // "¿Se sacó muestra?" (21/10 · 5): las cargas de hoy terminadas, con despacho, que todavía no tienen respuesta
  // (solo si la base ya tiene la columna: migración 202610212000)
  const faltaMuestra = D.cargas.filter((c) => "muestra" in c && c.dispatch_id && !c.muestra && (c.estado === "terminada" || (c.estado === "parada" && c.resolucion?.modo === "sale")))

  // Las órdenes que llegan a la PC de la planta: "bajó" (19.6)
  const bajadas = useRef(new Set<string>())
  useEffect(() => {
    if (!enPlanta || sinInternet) return
    for (const c of cola) if (!c.bajada_at && !bajadas.current.has(c.id)) {
      bajadas.current.add(c.id)
      void fetch(`/api/carga/${c.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "bajada", at: new Date().toISOString() }) })
    }
  }, [cola, enPlanta, sinInternet])

  const chequeo = useCallback((k: CargaFila): { items: Item[]; ok: boolean; aviso: boolean; motivo: string | null } => {
    const items: Item[] = [{ clave: "np", ok: true, neutro: true, corto: "NP", texto: "NP: se controla cuando esté Zomatik" }]
    if (ctx) {
      const ctl = controlDeFormula(ctx, formulaDe(k.formula_id), k.autorizacion)
      items.push(...ctl.items)
    }
    const conectado = enPlanta ? P.conectado : true
    items.push({ clave: "puente", ok: conectado, corto: "Planta", texto: conectado ? (enPlanta ? "Puente (simulador) conectado" : "Puente: se ve desde la PC de la planta") : "El puente no llega a Indumix (red local)" })
    const alarma = P.estado?.alarmas?.[0]?.texto
    items.push({ clave: "alarma", ok: !alarma, corto: "Alarmas", texto: alarma ? `Alarma activa en Indumix: ${alarma}` : "Sin alarmas en Indumix" })
    const otra = (activa && activa.id !== k.id) || (P.prep && P.prep.cargaId !== k.id) || (enPlanta && P.estado?.en_ciclo && P.orden?.cargaId !== k.id)
    items.push({ clave: "libre", ok: !otra, corto: "Planta libre", texto: otra ? "La planta está con otra carga" : "Planta libre" })
    return { items, ok: items.every((i) => i.ok), aviso: items.some((i) => i.ok && i.aviso), motivo: items.find((i) => !i.ok)?.texto || null }
  }, [ctx, formulaDe, enPlanta, P.conectado, P.estado, P.prep, P.orden, activa])

  // Objetivo por ciclo de la orden elegida, para ver la planta "lista" antes de arrancar
  const previa = useMemo(() => {
    if (!ctx || !elegida || activa) return null
    const { receta } = recetaDeFormula(ctx, elegida.formula_id)
    if (!receta) return null
    const ciclos = Math.max(1, Math.ceil(elegida.m3 / ctx.puesto.m3_max_ciclo - 1e-9))
    const hum = Object.fromEntries((P.estado?.salidas || []).map((s) => [s.salida, s.humedad_pct || 0]))
    const out: Partial<Record<Salida, number>> = {}
    let aguaAr = 0
    for (const s of receta.salidas) {
      if (!(s.valor > 0)) continue
      let x = s.valor * elegida.m3
      if (grupoDeSalida(s.salida) === "arido") { const y = x * (1 + (hum[s.salida] || 0) / 100); aguaAr += y - x; x = y }
      out[s.salida] = x / ciclos
    }
    if (out.agua != null) out.agua = ((receta.salidas.find((s) => s.salida === "agua")?.valor || 0) * elegida.m3 - aguaAr) / ciclos
    return out
  }, [ctx, elegida, activa, P.estado])

  // ── Acciones ──
  async function api(ruta: string, body: Record<string, unknown>) {
    const r = await fetch(ruta, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pedido: crypto.randomUUID?.() || String(Date.now()), at: new Date().toISOString(), ...body }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { aviso("No se pudo", j?.error || `Error ${r.status}`); return null }
    D.leer()
    return j
  }
  const tolva1 = ctx?.salidas.find((s) => s.alternativas?.length) || null
  const puedeTolva = enPlanta && puedeCargar && !activa && !P.estado?.en_ciclo
  async function elegirTolva(id: string) {
    setTolva(false)
    if (!ctx || !tolva1) return
    const j = await api("/api/carga/salidas", { puesto_id: ctx.puesto.id, salida: tolva1.salida, material_id: id })
    if (j) aviso(`${INFO_SALIDA[tolva1.salida].nombre}: ${ctx.materiales.find((m) => m.id === id)?.name}`, "Queda en Actividad. Se recalculó el control de las cargas de la cola.")
  }
  async function armarRecetas() {
    if (!ctx) return
    const { recetas, mapeo } = recetasIniciales(D.formulas.map((f) => ({ ...f, usos: f.usos || 0 })), ctx.salidas, ctx.materiales)
    const j = await api("/api/carga/recetas", { puesto_id: ctx.puesto.id, leida_at: new Date().toISOString(), recetas, mapeo })
    if (j) aviso(j.cambios ? `Recetas armadas · ${j.cambios} cambiada${j.cambios > 1 ? "s" : ""}` : "Recetas del simulador armadas",
      j.cambios ? `Cambiaron las recetas ${j.cambiadas.join(", ")} (quedó la versión anterior y la alerta).` : `${mapeo.filter((m) => m.formula_id).length} fórmulas con número. La 13 es la real de la foto (frena por cemento).`)
  }
  async function verReporte(k: CargaFila) {
    const { data } = await createClient().from("cargas_materiales").select("*").eq("carga_id", k.id).eq("ciclo", 0)
    const orden = (s: string) => SALIDAS.indexOf(s as Salida)
    const filas: FilaReporte[] = ((data || []) as any[]).sort((a, b) => orden(a.salida) - orden(b.salida)).map((m) => ({
      salida: m.salida, nombre: ctx?.materiales.find((x) => x.id === m.material_id)?.name || null, receta_por_m3: m.receta_por_m3 == null ? null : Number(m.receta_por_m3),
      formula_por_m3: m.formula_por_m3 == null ? null : Number(m.formula_por_m3), teorico: m.teorico == null ? null : Number(m.teorico), humedad_pct: m.humedad_pct == null ? null : Number(m.humedad_pct),
      teorico_corregido: m.teorico_corregido == null ? null : Number(m.teorico_corregido), real: m.real == null ? null : Number(m.real), unidad: m.unidad,
    }))
    setReporte({ carga: k, filas })
  }
  async function responderMuestra(k: CargaFila, tomada: boolean, datos?: { numero: string; asentamiento: number }) {
    if (tomada && datos && k.dispatch_id) {
      // El mismo camino que "Agregar muestra" del Historial: marca el despacho y crea las 3 probetas
      const r = await agregarMuestraDespacho(createClient(), logActivity, {
        dispatchId: k.dispatch_id, numero: datos.numero, asentamiento: datos.asentamiento, remito: k.remito, plantId: k.despacho ? planta : null, origen: "Carga de planta (al terminar la carga)",
      })
      if (!r.ok) { aviso("No se pudo guardar la muestra", r.error); return false }
      aviso(`Muestra ${datos.numero} registrada`, r.probetas === "creadas" ? "3 probetas creadas (7 y 28 días)." : "El despacho ya tenía probetas: no se crearon de nuevo.")
    }
    const j = await api(`/api/carga/${k.id}`, { accion: "muestra", tomada, numero: datos?.numero, asentamiento: datos?.asentamiento })
    return !!j
  }
  function aplicarFicha() {
    const s = P.simulador
    const al = D.alertas.find((a) => a.estado === "esperando_planta" && a.detalle?.ficha)
    if (!s || !al) { aviso("No hay ninguna ficha pedida a la planta", "Primero «Resolver › Corregir la receta de la planta»."); return }
    const cambios: Record<string, number> = {}
    for (const l of al.detalle!.ficha.lineas) cambios[l.salida] = l.despues
    void P.simular({ tipo: "cambiar_receta", numero: al.detalle!.ficha.numero, cambios })
  }
  function simular(q: string) {
    const s = P.simulador
    if (!s) return
    if (q === "cambio") {
      const r1 = s.recetas.find((r) => r.numero === 1)
      const c = r1?.salidas.find((x) => x.salida === "cemento_1")?.valor || 0
      void P.simular({ tipo: "cambiar_receta", numero: 1, cambios: { cemento_1: c + 10 } })
    } else if (q === "ficha") aplicarFicha()
    else if (q === "internet") void P.simular({ tipo: "internet" })
    else if (q === "lan") void P.simular({ tipo: P.conectado ? "sin_conexion" : "con_conexion" })
    else if (q === "alarma") void P.simular({ tipo: "alarma" })
    else if (q === "alarmaFin") void P.simular({ tipo: "alarma_fin" })
    else if (q === "indumix") {
      if (P.estado?.en_ciclo) { aviso("Primero terminá la carga en curso"); return }
      void P.simular({ tipo: "carga_indumix", receta: 2, m3: 1.5, camion: "LES 431", observacion: "" })
    } else if (q === "indumixCola") {
      const k = colaVisible[0]
      if (!k || k.receta_numero == null) { aviso("No hay una orden en la cola con receta"); return }
      if (P.estado?.en_ciclo) { aviso("Primero terminá la carga en curso"); return }
      void P.simular({ tipo: "carga_indumix", receta: k.receta_numero, m3: k.m3, camion: k.patente_planta || "", observacion: k.observacion_planta || k.remito || "" })
    } else if (q === "noarranca") { void P.simular({ tipo: "no_arranca" }); aviso("La próxima vez que toques CARGAR, el PLC no va a arrancar") }
    else if (q === "prueba") setPrueba(true)
  }

  // ── Alto de las columnas (1366×768 sin scrollear) ──
  const grilla = useRef<HTMLDivElement>(null)
  const medio = useRef<HTMLElement>(null)
  const [alto, setAlto] = useState(560)
  const [anchoMedio, setAnchoMedio] = useState(900)
  useEffect(() => {
    const m = medio.current
    if (!m) return
    // menos el relleno de la columna (12) y el borde y relleno del dibujo de la planta (14)
    const ro = new ResizeObserver(() => setAnchoMedio(m.clientWidth - 26))
    ro.observe(m)
    return () => ro.disconnect()
  }, [tab, puesto?.id, ctx?.puesto.id])
  useEffect(() => {
    const medir = () => {
      const g = grilla.current
      if (!g) return
      const scroll = (g.closest("main") as HTMLElement | null)?.scrollTop || 0
      setAlto(Math.max(420, Math.round(window.innerHeight - (g.getBoundingClientRect().top + scroll) - 6)))
    }
    medir()
    window.addEventListener("resize", medir)
    const t = setTimeout(medir, 300)
    return () => { window.removeEventListener("resize", medir); clearTimeout(t) }
  }, [tab, D.cargando, enPlanta, sinInternet, P.conectado])

  if (!planta) return <div className="p-6 text-slate-500">No hay plantas.</div>
  const plantaNombre = plants.find((p) => p.id === planta)?.name || ""
  const abiertas = D.alertas.filter((a) => a.estado === "abierta").length
  const cambiosReceta = D.alertas.filter((a) => a.estado === "abierta" && a.tipo === "receta_cambiada")
  const e = P.estado
  const conectado = enPlanta ? P.conectado : true

  // Estado de la planta (franja de arriba de la columna del medio)
  let st = "SIN CARGAS", stc = "bg-muted text-slate-500"
  if (P.prep) { st = "PREPARANDO"; stc = "bg-blue-50 text-blue-800" }
  else if (activa?.estado === "parada" || (enPlanta && e?.parada && P.orden)) { st = "PARADA"; stc = "bg-slate-200 text-slate-900" }
  else if ((enPlanta && e?.suspendida) || activa?.estado === "suspendida") { st = "SUSPENDIDA"; stc = "bg-amber-50 text-amber-800" }
  else if ((enPlanta && e?.en_ciclo) || activa?.estado === "en_curso") { st = e?.alarmas.length ? "ALARMA" : "EN CICLO"; stc = e?.alarmas.length ? "bg-red-50 text-red-700" : "bg-green-50 text-green-800" }
  else if (elegida) { const ch = chequeo(elegida); st = ch.ok ? "LISTA" : "BLOQUEADA"; stc = ch.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700" }

  return (
    <div className="d3c space-y-1.5 text-xs">
      {/* Barra de arriba */}
      <div className="sticky top-0 z-30 -mx-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b bg-background/95 px-3 py-1 backdrop-blur">
        <h1 className="text-base font-medium">Carga de planta</h1>
        <NuevoBadge />
        <div className="inline-flex rounded-md border p-0.5">
          {plants.map((p) => <button key={p.id} onClick={() => setPlanta(p.id)} className={cn("h-[26px] rounded px-2.5 text-xs", planta === p.id ? "bg-muted font-medium" : "text-slate-500")}>{p.name}</button>)}
        </div>
        <span className="text-xs font-medium tabular-nums">{hms(ahora)}</span>
        {enPlanta ? (
          <>
            <Chip ok={P.internet}>{P.internet ? "Internet" : "Sin internet"}</Chip>
            <Chip ok>{"Puente (simulador)"}</Chip>
            <Chip ok={P.conectado}>{P.conectado ? "Indumix" : "Sin red con Indumix"}</Chip>
            {P.porSubir > 0 && <span className="text-[11px] font-medium text-red-700">{P.porSubir} por subir</span>}
            {e && <span className="text-[11px] text-slate-500" title="El reloj de Indumix vuelve a 1/1/1970 cada día: todas las horas son las del puente">Indumix {e.reloj_plc} → hora del puente</span>}
          </>
        ) : <span className="inline-flex items-center gap-1 text-[11px] text-slate-500"><i className="inline-block h-[7px] w-[7px] rounded-full bg-cyan-500" />Vista remota (cada 5 s, por la nube)</span>}
        <span className="flex-1" />
        <div className="inline-flex rounded-md border p-0.5">
          {([["carga", "Carga"], ["recetas", "Recetas de la planta"], ["alertas", "Alertas"]] as [Tab, string][]).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={cn("h-[26px] rounded px-2.5 text-xs", tab === k ? "bg-muted font-medium" : "text-slate-500")}>
              {l}{k === "alertas" && abiertas > 0 && <Tag tono="bad" className="ml-1">{abiertas}</Tag>}
            </button>
          ))}
        </div>
        <Link href="/carga/auditoria" className="text-xs text-blue-800 underline">Auditoría de carga</Link>
        <button className="h-[26px] w-[26px] rounded border border-slate-300" title="Actualizar" onClick={() => D.leer()}><RefreshCw className="mx-auto h-3.5 w-3.5" /></button>
      </div>

      {simulada && <CartelSimulada />}

      {/* Este equipo + controles del simulador */}
      {puesto && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {puedeCargar ? (
            <div className="inline-flex rounded-md border p-0.5">
              {([["planta", "Esta es la PC de la planta"], ["otro", "Otro equipo (solo mirar)"]] as const).map(([k, l]) => (
                <button key={k} onClick={() => { setEquipo(k); guardarLS(CLAVE_EQUIPO, k) }} className={cn("h-[26px] rounded px-2 text-xs", equipo === k ? "bg-muted font-medium" : "text-slate-500")}>{l}</button>
              ))}
            </div>
          ) : <span className="text-slate-500">Vista remota: CARGAR y PARAR se accionan solo desde la computadora de la planta.</span>}
          {enPlanta && simulada && (
            <>
              <span className="text-slate-500">Simulador:</span>
              <label className="inline-flex items-center gap-1">velocidad
                <select className="h-[26px] rounded-md border bg-card px-1 text-xs" value={P.vel} onChange={(ev) => P.setVel(Number(ev.target.value))}>
                  {[1, 5, 10, 20].map((v) => <option key={v} value={v}>x{v}</option>)}
                </select>
              </label>
              <select className="h-[26px] rounded-md border bg-card px-1 text-xs" value="" onChange={(ev) => { simular(ev.target.value); ev.target.value = "" }}>
                <option value="">Simular…</option>
                <option value="prueba">Orden de prueba (sin despacho)</option>
                <option value="ficha">Aplicar en Indumix la ficha pedida (corrigieron la receta)</option>
                <option value="cambio">Alguien cambia la receta 1 en Indumix</option>
                <option value="internet">{P.internet ? "Cortar" : "Volver"} internet en la planta</option>
                <option value="lan">{P.conectado ? "Cortar" : "Volver"} la red local PC ↔ planta</option>
                <option value="alarma">Alarma de Indumix</option>
                <option value="alarmaFin">Se resolvió la alarma</option>
                <option value="indumix">Carga hecha desde Indumix (sin remito)</option>
                <option value="indumixCola">La primera de la cola se cargó a mano en Indumix</option>
                <option value="noarranca">El PLC no va a arrancar</option>
              </select>
            </>
          )}
        </div>
      )}

      {/* Avisos */}
      <div className="space-y-1">
        {D.sinMigracion && <Ban tono="red">Falta aplicar en la base la migración de la carga de planta (202610211800_carga_planta.sql). Hasta entonces esta pantalla no tiene datos. Avisale a Bautista.</Ban>}
        {!D.sinMigracion && !D.cargando && !puesto && <Ban tono="dark">{plantaNombre} no tiene un puesto de carga. Por ahora solo Canning tiene la planta simulada.</Ban>}
        {puesto && puesto.etapa === "apagado" && <Ban>El puesto de carga está apagado: Despachar no manda órdenes a esta cola (las órdenes de prueba sí andan).{puedeEditar ? <> Se prende en <button className="ml-1 text-xs text-blue-800 underline" onClick={() => setTab("recetas")}>Recetas de la planta › Etapa</button>.</> : " Lo prende Bautista."}</Ban>}
        {enPlanta && !P.conectado && <Ban tono="dark">Se cortó la red local entre esta PC y la planta. El PLC sigue solo con la carga en curso. Para parar: parada de emergencia (y el PARAR de Indumix, si su pantalla no corre en esta PC). Al volver se lee el estado real; no arranca nada solo.</Ban>}
        {sinInternet && <Ban>Sin internet. Andan igual: la carga en curso, el PARAR, la planta en vivo y las órdenes que ya bajaron (se cargan igual, sin pedir nada extra). No bajan órdenes nuevas{sinBajar ? ` (${sinBajar} esperando)` : ""}: se carga a mano en Indumix con el remito en Observación y el emparejador las une después.</Ban>}
        {e?.alarmas?.[0] && <Ban tono="red">ALARMA DE INDUMIX: {e.alarmas[0].texto}{e.en_ciclo ? " · la planta se detuvo (lo decide el PLC)" : ""}</Ban>}
        {cambiosReceta.slice(0, 2).map((a) => <Ban key={a.id}>{a.titulo}: {a.detalle?.diferencias}. <button className="ml-1 text-xs text-blue-800 underline" onClick={() => setTab("alertas")}>Ver alertas</button></Ban>)}
      </div>

      {puesto && ctx && tab === "recetas" && (
        <RecetasPlanta ctx={ctx} formulas={D.formulas} puedeEditar={puedeEditar} enPlanta={enPlanta} ultimaLectura={P.ultimaLectura}
          onLeer={() => void P.simular({ tipo: "leer" })} onCambiarTolva={puedeTolva && tolva1 ? () => setTolva(true) : null} onArmar={armarRecetas}
          onEtapa={async (et) => { const j = await api("/api/carga/puesto", { puesto_id: ctx.puesto.id, etapa: et }); if (j) aviso("Etapa del puesto cambiada", et === "orden" || et === "arranque" ? "Despachar manda la orden a la cola de carga." : "Despachar ya no manda órdenes a la cola.") }} />
      )}
      {puesto && ctx && tab === "alertas" && (
        <AlertasCarga alertas={D.alertas} ctx={ctx} formulas={D.formulas} cargas={D.cargas} puedeResolver={puedeResolver} puedeDescartar={puedeEditar || puedeResolver}
          simulada={simulada} onResuelto={D.leer} onAviso={aviso} />
      )}

      {puesto && ctx && tab === "carga" && (
        <div ref={grilla} className="grid gap-2" style={{ gridTemplateColumns: "200px minmax(0,1fr) 300px", height: alto }}>
          {/* Cola */}
          <section className="d3c-col flex min-h-0 flex-col overflow-hidden rounded-md border bg-card">
            <div className="flex min-h-[31px] items-center gap-1.5 border-b px-2.5 py-1"><h2 className="text-[13px] font-medium">Cola de carga</h2><span className="text-xs text-slate-500">{colaVisible.length}</span><span className="flex-1" /><span className="text-[11px] text-slate-500">llega de Despacho</span></div>
            <Buscador valor={buscarCola} onCambio={setBuscarCola} />
            <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-auto p-1.5">
              {!ctx.recetas.length && <div className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-900">La planta simulada no tiene recetas todavía. <button className="underline" onClick={() => setTab("recetas")}>Armarlas</button></div>}
              {colaVisible.filter((k) => coincide(buscarCola, k.mixers?.license_plate, k.patente_planta, k.despacho?.cliente, k.cliente_planta, k.despacho?.obra, k.remito, k.formulas?.code)).map((k) => <FilaCola key={k.id} k={k} sel={elegida?.id === k.id} ch={chequeo(k)} corriendo={activa?.id === k.id || P.prep?.cargaId === k.id} onClick={() => setSel(k.id)} />)}
              {!colaVisible.length && <div className="py-6 text-center text-xs text-slate-500">No hay cargas. Llegan desde Despacho al tocar «Despachar»{simulada && enPlanta ? ", o con «Simular… › Orden de prueba»" : ""}.</div>}
              {sinBajar > 0 && <div className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-900">{sinBajar} despacho{sinBajar > 1 ? "s" : ""} todavía no bajó (sin internet). Cargalo a mano en Indumix con el remito en Observación: el emparejador lo une después.</div>}
              {faltaMuestra.filter((k) => k.id !== ultimaCarga?.id).length > 0 && (
                <div className="mt-1 rounded-md border border-dashed px-2 py-1 text-[11px]">
                  <b className="font-medium">Falta responder la muestra</b>
                  {faltaMuestra.filter((k) => k.id !== ultimaCarga?.id).map((k) => (
                    <div key={k.id} className="mt-0.5 flex items-center gap-1">
                      <span className={cn("truncate", k.muestra_pedida && "font-medium text-amber-800")}>{k.mixers?.license_plate || k.patente_planta} · {k.remito_tipo || ""} {k.remito} · {hhmm(k.fin_at)}{k.muestra_pedida ? " · pidieron muestra" : ""}</span>
                      <span className="flex-1" />
                      {puedeMuestra && <><button className="text-blue-800 underline" onClick={() => setMuestra(k)}>Sí</button><button className="text-slate-500 underline" onClick={() => void responderMuestra(k, false)}>No</button></>}
                    </div>
                  ))}
                </div>
              )}
              {yaCargadas.map((k) => (
                <div key={k.id} className="d3c-card rounded-md border border-r-[3px] border-slate-200 border-r-slate-400 bg-slate-50 px-2 py-1 text-xs opacity-80">
                  <b className="font-medium">{k.mixers?.license_plate || k.patente_planta}</b> · remito {k.remito} <Tag tono="slate">Ya cargada en Indumix</Tag>
                  <div className="text-[11px] text-slate-500">N° {k.contador_planta} · {k.union_remito} · no se vuelve a cargar</div>
                </div>
              ))}
            </div>
          </section>

          {/* Planta en vivo */}
          <section ref={medio} className="d3c-col flex min-h-0 flex-col overflow-hidden rounded-md border bg-card">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b px-2 py-1">
              <span className={cn("rounded px-1.5 text-[11px] font-medium", stc)}>{st}</span>
              {enPlanta && e && (e.en_ciclo || e.parada) && P.orden && <>
                <span className="text-xs">Ciclo <b className="font-medium">{e.ciclo}/{e.ciclos}</b> · {m3t(e.m3_ciclo)} m³ · {e.tiempo_ciclo_s < 50 ? "pesando" : e.tiempo_ciclo_s < 98 ? "descargando al camión" : "fin de ciclo"}</span>
                <span className="text-xs text-slate-500">ciclo <b className="font-medium tabular-nums text-foreground">{mmss(e.tiempo_ciclo_s)}</b> · total {mmss(e.tiempo_total_s)}</span>
              </>}
              {!enPlanta && activa && <span className="text-xs">{activa.mixers?.license_plate || activa.patente_planta} · ciclo {activa.ciclo_actual || "—"}/{activa.ciclos || "—"} · desde {hhmm(activa.inicio_at)}</span>}
              {enPlanta && e && (e.en_ciclo || e.parada) && P.orden && (
                <div className="flex w-full gap-[3px]">{Array.from({ length: e.ciclos }, (_, i) => <div key={i} className="h-[5px] flex-1 overflow-hidden rounded-full bg-slate-200"><i className="block h-full bg-green-600" style={{ width: `${i + 1 < e.ciclo ? 100 : i + 1 === e.ciclo ? Math.min(100, (e.tiempo_ciclo_s / 108) * 100) : 0}%` }} /></div>)}</div>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-1.5">
              {enPlanta ? (
                <>
                  <PlantaVivo estado={e} salidas={ctx.salidas} materiales={ctx.materiales} conectado={conectado}
                    patente={(activa || elegida)?.mixers?.license_plate || (activa || elegida)?.patente_planta || null} m3Total={(activa || elegida)?.m3 ?? null}
                    previa={previa} ancho={anchoMedio} onCambiarTolva={puedeTolva && tolva1 ? () => setTolva(true) : null} humedadAcopio={humAcopio} />
                  <TablaPesajes estado={e} salidas={ctx.salidas} materiales={ctx.materiales} />
                </>
              ) : (
                <div className="space-y-2 p-2 text-xs text-slate-500">
                  <p>Los pesos en vivo se ven en la PC de la planta. Desde acá se ve la cola, el estado de cada carga y las alertas, leído de la base cada 5 segundos.</p>
                  <div className="rounded-md border p-2 text-foreground">
                    <b className="font-medium">Qué hay en cada salida</b>
                    <div className="mt-1 grid grid-cols-3 gap-x-3 gap-y-0.5 text-xs">
                      {ctx.salidas.map((s) => <span key={s.salida}><span className="text-slate-500">{INFO_SALIDA[s.salida].nombre}:</span> {nombreCorto(ctx.materiales.find((m) => m.id === s.material_id)?.name)}</span>)}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Orden, control y botones */}
          <section className="d3c-col flex min-h-0 flex-col overflow-hidden rounded-md border bg-card">
            <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col gap-[5px] overflow-y-auto overflow-x-hidden px-2 py-1.5", enPlanta && "pb-[72px]")}>
              <PanelDerecho
                ctx={ctx} enPlanta={enPlanta} puedeCargar={puedeCargar} puedeResolver={puedeResolver} simulada={simulada}
                prep={P.prep} activa={activa} elegida={elegida} chequeo={chequeo} estado={e} ordenEnPlanta={!!P.orden}
                ultima={ultimaCarga && !activa && !ultimaCarga.salida_gps ? ultimaCarga : null} extras={D.extras} formulaDe={formulaDe} alertas={D.alertas}
                onCargar={(k) => setConfirmar(k)} onBocina={() => void P.bocina()} onCancelar={setCancelar}
                onSuspender={() => void (e?.suspendida ? P.reanudar() : P.suspender())}
                onParada={(k, modo) => setParada({ carga: k, modo })}
                onResolver={setResolver} onReporte={verReporte}
                agua={{ abierta: !!e?.agua_extra_abierta, pulso: e?.agua_extra_pulso || 0, total: e?.agua.extra || 0, abrir: P.aguaAbrir, soltar: () => void P.aguaParar() }}
                pesajeTerminado={P.pesajeTerminado} onTerminar={(k) => void P.terminarCarga(k.id, k.formula_id)}
                puedeMuestra={puedeMuestra} onMuestra={(k, si) => { if (si) setMuestra(k); else void responderMuestra(k, false) }}
              />
            </div>
          </section>
        </div>
      )}

      {/* PARAR: grande, fijo y sin permiso, solo en la PC de la planta */}
      {enPlanta && puesto && (
        <button
          onClick={() => { if (P.conectado && !P.prep && !P.estado?.en_ciclo) aviso("PARAR enviado a Indumix", "No había carga en curso. Está siempre, para cualquiera en esta PC."); void P.parar() }}
          className="k3c-parar fixed bottom-3 right-3.5 z-40 h-[60px] w-[132px] rounded-[10px] border-[3px] border-white bg-red-600 text-[22px] font-extrabold leading-none tracking-[.06em] text-white shadow-[0_6px_18px_rgba(220,38,38,.4),0_0_0_1.5px_#dc2626]"
        >
          PARAR<small className="mt-0.5 block text-[10px] font-medium tracking-normal opacity-95">siempre · sin permiso</small>
        </button>
      )}

      {confirmar && (
        <ConfirmarCamion
          patente={confirmar.mixers?.license_plate || confirmar.patente_planta || "—"}
          resumen={<><b className="font-medium">{confirmar.despacho?.cliente || confirmar.cliente_planta}</b> · {confirmar.despacho?.obra || ""} · {confirmar.formulas?.code} · <b className="font-medium">{m3t(confirmar.m3)} m³</b> · Remito {confirmar.remito_tipo || ""} {confirmar.remito}</>}
          avisos={chequeo(confirmar).items.filter((i) => i.ok && i.aviso).map((i) => i.texto)}
          onBocina={() => void P.bocina()} onCerrar={() => setConfirmar(null)}
          onConfirmar={() => {
            const k = confirmar
            setConfirmar(null)
            const { numero, receta } = recetaDeFormula(ctx!, k.formula_id)
            void P.cargar({ ...k, receta_numero: numero ?? k.receta_numero }, receta)
          }}
        />
      )}
      {parada && (() => {
        const k = parada.carga
        const ef = efectoSobreDespacho(parada.modo === "completar" && k.completa_carga_id ? "sale" : parada.modo, { m3_despacho: k.m3, m3_cargados: Number(k.m3_cargados ?? e?.m3_en_trompo ?? 0), remito: k.remito ? `${k.remito_tipo || ""} ${k.remito}`.trim() : null, simulada: k.simulada, esCompletar: !!k.completa_carga_id })
        const tit = { sale: "Sale con lo cargado", completar: "Completar con otra carga", tirada: "Se tiró: anular el despacho" }[parada.modo]
        return <MotivoDialog titulo={tit} cuerpo={ef.texto} boton="Confirmar" peligro={parada.modo === "tirada"}
          onConfirmar={async (m) => { const j = await api(`/api/carga/${k.id}`, { accion: "resolver_parada", modo: parada.modo, motivo: m }); if (j) { if (P.orden?.cargaId === k.id) P.soltarOrden(); aviso(tit, j.efecto?.texto) } return !!j }} onCerrar={() => setParada(null)} />
      })()}
      {cancelar && (
        <MotivoDialog titulo={`Cancelar la carga de ${cancelar.mixers?.license_plate || cancelar.patente_planta || ""}`} boton="Cancelar la carga" peligro ejemplo="Ej.: se rompió el camión, la obra suspendió"
          cuerpo={<>Todavía no se pesó nada. {cancelar.dispatch_id ? `El despacho ya está grabado (remito ${cancelar.remito_tipo || ""} ${cancelar.remito}).` : "Es una orden de prueba."} {cancelar.simulada ? <b className="font-medium">Planta simulada: se cancela solo la orden; el despacho real no se toca (si hay que anularlo o cambiar el camión, se hace desde Historial, como siempre).</b> : null}</>}
          onConfirmar={async (m) => !!(await api(`/api/carga/${cancelar.id}`, { accion: "cancelar", motivo: m }))} onCerrar={() => setCancelar(null)} />
      )}
      {tolva && tolva1 && <TolvaDialog opciones={(tolva1.alternativas || []).map((id) => ({ id, name: ctx?.materiales.find((m) => m.id === id)?.name || "?" }))} actual={tolva1.material_id} onElegir={elegirTolva} onCerrar={() => setTolva(false)} />}
      {prueba && ctx && (
        <PruebaDialog formulas={D.formulas.map((f) => ({ id: f.id, code: f.code, numero: ctx.asignaciones.find((a) => a.formula_id === f.id)?.numero ?? null }))} mixers={D.mixers}
          onCrear={async (d) => { const j = await api("/api/carga/prueba", { puesto_id: ctx.puesto.id, ...d }); if (j) { setSel(j.carga_id); aviso("Orden de prueba en la cola", j.frena ? "Va a quedar frenada: la receta no coincide." : undefined) } return !!j }}
          onCerrar={() => setPrueba(false)} />
      )}
      {resolver && ctx && (
        <ResolverDialog alerta={resolver} ctx={ctx} formula={D.formulas.find((f) => f.id === resolver.formula_id) || null} simulada={simulada}
          cargas={D.cargas.filter((c) => c.formula_id === resolver.formula_id && ESTADOS_COLA.includes(c.estado))}
          onEnviar={async (b) => { const r = await fetch(`/api/carga/alertas/${resolver.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }); const j = await r.json().catch(() => ({})); if (!r.ok) { aviso("No se pudo", j?.error); return false } D.leer(); return true }}
          onCerrar={() => setResolver(null)} />
      )}
      {muestra && <MuestraDialog k={muestra} onGuardar={(d) => responderMuestra(muestra, true, d)} onCerrar={() => setMuestra(null)} />}
      {reporte && (
        <ReporteCarga k={reporte.carga} filas={reporte.filas} extras={D.extras.filter((x) => x.carga_id === reporte.carga.id)} ahora={ahora} onCerrar={() => setReporte(null)} />
      )}
    </div>
  )
}

function Ban({ tono, children }: { tono?: "red" | "dark"; children: React.ReactNode }) {
  return <div className={cn("d3c-card flex flex-wrap items-center gap-2 rounded-md border border-l-[3px] border-slate-200 px-2.5 py-0.5 text-xs", tono === "red" ? "border-l-red-600 bg-red-50 text-red-700" : tono === "dark" ? "border-l-slate-900 bg-slate-50 text-slate-900" : "border-l-amber-500 bg-slate-50")}>{children}</div>
}

function FilaCola({ k, sel, ch, corriendo, onClick }: { k: CargaFila; sel: boolean; ch: { ok: boolean; aviso: boolean; items: Item[] }; corriendo: boolean; onClick: () => void }) {
  const mal = ch.items.find((i) => !i.ok)
  const [tono, txt] = corriendo ? (["blue", "cargando"] as const) : !ch.ok ? (["bad", `${mal?.corto} ✕`] as const) : ch.aviso ? (["warn", "lista · agua !"] as const) : (["ok", "lista"] as const)
  // Tarjeta como los tickets del despacho: gris clara, borde fino, barra de color a la derecha (roja si está frenada)
  return (
    <button onClick={onClick} className={cn("d3c-card w-full rounded-md border border-r-[3px] border-slate-200 bg-slate-50 px-2 py-1 text-left leading-tight", corriendo ? "border-r-blue-500" : !ch.ok ? "border-red-300 border-r-red-500" : "border-r-violet-700", sel && "ring-2 ring-blue-500")}>
      <div className="flex items-center gap-1 border-b border-slate-200 pb-0.5 text-[11px] text-slate-500">
        <span className="truncate">{k.origen === "prueba" ? "Prueba" : `Remito ${k.remito_tipo || ""} ${k.remito || ""}`}</span>
        <span className="flex-1" />
        <span>{k.completa_carga_id ? "completa el remito" : `despachó ${hhmm(k.created_at)}`}</span>
      </div>
      <div className="mt-0.5 flex items-baseline gap-2 text-xs font-medium">
        <span className="min-w-0 flex-1 truncate">{k.mixers?.license_plate || k.patente_planta || "—"} · {k.despacho?.cliente || k.cliente_planta}</span>
        <span className="shrink-0 tabular-nums">{m3t(k.m3)} m³</span>
      </div>
      <div className="flex items-center gap-1 text-[11px] text-slate-500">
        <span className="min-w-0 flex-1 truncate">{k.formulas?.code}</span>
        <Tag tono={tono}>{txt}</Tag>
      </div>
    </button>
  )
}

function PanelDerecho(p: {
  ctx: Contexto; enPlanta: boolean; puedeCargar: boolean; puedeResolver: boolean; simulada: boolean
  prep: { cargaId: string; pasos: string[]; i: number } | null; activa: CargaFila | null; elegida: CargaFila | null
  chequeo: (k: CargaFila) => { items: Item[]; ok: boolean; aviso: boolean; motivo: string | null }
  estado: ReturnType<typeof usarPuenteSimulado>["estado"]; ordenEnPlanta: boolean; ultima: CargaFila | null
  extras: { carga_id: string; litros: number; at: string; despues_de_terminar: boolean }[]
  formulaDe: (id: string | null) => any; alertas: AlertaFila[]
  onCargar: (k: CargaFila) => void; onBocina: () => void; onCancelar: (k: CargaFila) => void; onSuspender: () => void
  onParada: (k: CargaFila, modo: ModoParada) => void
  onResolver: (a: AlertaFila) => void; onReporte: (k: CargaFila) => void
  /** Extra agua mantenido (21/10 · 6): litros en vivo de esta pulsada y total del camión */
  agua: { abierta: boolean; pulso: number; total: number; abrir: () => Promise<boolean>; soltar: () => void }
  pesajeTerminado: boolean; onTerminar: (k: CargaFila) => void
  puedeMuestra: boolean; onMuestra: (k: CargaFila, si: boolean) => void
}) {
  const { ctx, enPlanta, puedeCargar, prep, activa, elegida, estado: e } = p
  const listaExtras = (id: string) => {
    const ex = p.extras.filter((x) => x.carga_id === id)
    return ex.length ? <div className="text-xs">Agua extra: {ex.map((x, i) => <span key={i}><b className="font-medium">{x.litros} L</b> {hhmm(x.at)}{x.despues_de_terminar ? " (después de terminar)" : ""}{i < ex.length - 1 ? " · " : ""}</span>)}</div> : null
  }
  const pat = (k: CargaFila) => k.mixers?.license_plate || k.patente_planta || "—"
  // Cabecera en 2 renglones (22/10): patente · remito / fórmula · m³. El cliente y lo demás, plegado en "Más datos".
  const cab = (k: CargaFila) => (
    <div className="min-w-0 leading-tight" title={`${k.despacho?.cliente || k.cliente_planta || ""}${k.despacho?.obra ? ` · ${k.despacho.obra}` : ""}`}>
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="truncate text-sm font-medium tracking-[.04em]">{pat(k)}</span>
        <span className="flex-1" />
        {k.simulada && <Tag tono="warn">sim.</Tag>}
        <Tag tono={k.remito_tipo === "X" ? "X" : "R"}>{k.origen === "prueba" ? "PRUEBA" : `${k.remito_tipo || ""} ${k.remito || ""}`}</Tag>
      </div>
      <div className="flex min-w-0 items-center gap-1 text-xs text-slate-500">
        <span className="min-w-0 flex-1 truncate">{k.formulas?.code}</span>
        <span className="shrink-0 tabular-nums text-foreground">{m3t(k.m3)} m³ · {k.ciclos || Math.ceil(k.m3 / ctx.puesto.m3_max_ciclo)} ciclos</span>
      </div>
    </div>
  )
  const masDatos = (k: CargaFila, extra?: React.ReactNode) => (
    <details className="text-[11px] text-slate-500">
      <summary className="cursor-pointer select-none">Más datos</summary>
      <div className="mt-0.5 space-y-px break-words">
        <div>{k.despacho?.cliente || k.cliente_planta}{k.despacho?.obra ? ` · ${k.despacho.obra}` : ""}</div>
        <div>Despachó {hhmm(k.despacho?.created_at || k.created_at)} {k.created_by || ""} · bajó {hms(k.bajada_at)}</div>
        {extra}
      </div>
    </details>
  )

  if (prep) {
    return (
      <div className="rounded-md border border-l-[3px] border-l-blue-500 px-2 py-1.5 text-xs">
        <h3 className="mb-1 text-xs font-medium">Arrancando</h3>
        <ul className="flex flex-col gap-[3px]">
          {prep.pasos.map((t, i) => (
            <li key={i} className={cn("flex gap-1.5", i < prep.i ? "text-foreground" : i === prep.i ? "font-medium text-blue-800" : "text-slate-500")}>
              <span className={cn("inline-flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full border-[1.5px] text-[9px]", i < prep.i ? "border-green-600 bg-green-600 text-white" : "border-slate-300")}>{i < prep.i ? "✓" : i + 1}</span>{t}
            </li>
          ))}
        </ul>
      </div>
    )
  }

  if (activa) {
    const k = activa
    const parada = k.estado === "parada" || (enPlanta && e?.parada && p.ordenEnPlanta)
    const susp = k.estado === "suspendida" || (enPlanta && e?.suspendida)
    const m3Tr = Number(k.m3_cargados ?? e?.m3_en_trompo ?? 0)
    return (
      <>
        {cab(k)}
        <div className="truncate text-xs text-slate-500">Inicio <span className="text-foreground">{hms(k.inicio_at)}</span>{k.inicio_at ? ` · llevamos ${mmss((Date.now() - new Date(k.inicio_at).getTime()) / 1000)}` : ""} · receta {k.receta_numero ?? "—"}</div>
        {masDatos(k, k.contador_planta ? <div>N° {k.contador_planta} en Indumix</div> : null)}
        {k.autorizacion && <div className="rounded-md border border-l-[3px] border-l-amber-500 px-2 py-1 text-xs">Autorizada con receta distinta · {k.autorizacion.por}: «{k.autorizacion.motivo}»</div>}
        {k.agua_distinta && <div className="rounded-md border border-l-[3px] border-l-amber-500 px-2 py-1 text-xs">Agua de la receta distinta de la fórmula: no frena, queda en la auditoría.</div>}
        {k.sin_internet && <div className="text-[11px] text-amber-800">Arrancó sin internet: la orden ya había bajado.</div>}
        {listaExtras(k.id)}
        {parada ? (
          <div className="rounded-md border border-l-[3px] border-l-slate-900 px-2 py-1.5 text-xs">
            <h3 className="mb-1 text-xs font-medium">Carga parada{k.parada_at ? ` a las ${hhmm(k.parada_at)}` : ""} · en el trompo ~{m3t(Math.round(m3Tr * 10) / 10)} m³</h3>
            {enPlanta && puedeCargar && k.estado === "parada" ? (
              <div className="flex flex-wrap gap-1">
                <Btn tono="pri" onClick={() => p.onParada(k, "sale")}>Sale con lo cargado</Btn>
                {k.completa_carga_id ? <span className="text-[11px] text-slate-500">Es el resto del remito {k.remito}.</span> : <>
                  <Btn onClick={() => p.onParada(k, "completar")}>Completar con otra carga</Btn>
                  <Btn onClick={() => p.onParada(k, "tirada")}>Se tiró · anular despacho</Btn>
                </>}
              </div>
            ) : <div className="text-xs text-slate-500">{k.estado === "parada" ? "Lo decide el plantista en la PC de la planta." : "Registrando…"}</div>}
            {p.simulada && <div className="mt-1 text-[11px] text-amber-800">Planta simulada: queda registrado qué se haría con el remito; el despacho real no se toca.</div>}
          </div>
        ) : enPlanta && p.ordenEnPlanta && p.pesajeTerminado ? (
          <div className="rounded-md border border-l-[3px] border-l-green-600 px-2 py-1.5 text-xs">
            <h3 className="mb-1 text-xs font-medium">Pesaje terminado · el camión sigue abajo</h3>
            <BotonAgua {...p.agua} disabled={!puedeCargar} />
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              <Btn tono="ok" disabled={!puedeCargar || p.agua.abierta} onClick={() => p.onTerminar(k)}>Terminar carga</Btn>
              <Btn onClick={p.onBocina}>Bocina</Btn>
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500">«Terminar carga» cierra la carga con el agua extra total; después se pregunta por la muestra y el camión queda «Cargado · esperando salir».</div>
          </div>
        ) : enPlanta && p.ordenEnPlanta ? (
          <>
            <div className="flex flex-wrap gap-1">
              <Btn tono="amb" disabled={!puedeCargar} onClick={p.onSuspender}>{susp ? "Reanudar" : "Suspender"}</Btn>
              <Btn disabled={!puedeCargar} onClick={p.onBocina}>Bocina</Btn>
            </div>
            <BotonAgua {...p.agua} disabled={!puedeCargar} />
            <div className="text-[11px] text-slate-500">PARAR: abajo a la derecha, siempre.</div>
          </>
        ) : <div className="rounded-md border border-dashed border-slate-400 px-2 py-1 text-xs text-slate-600">{enPlanta ? "En curso según el sistema, pero esta PC no la está cargando (¿se cargó desde otra PC o se recargó la página?). La planta sigue según Indumix." : "Vista remota: se ve, no se acciona."}</div>}
      </>
    )
  }

  const ult = p.ultima ? (
    <div className="rounded-md border border-l-[3px] border-l-blue-500 px-2 py-1.5 text-xs">
      <h3 className="text-xs font-medium">{pat(p.ultima)} · Cargado {hhmm(p.ultima.fin_at)} · esperando salir (GPS)</h3>
      {listaExtras(p.ultima.id)}
      {"muestra" in p.ultima && p.ultima.dispatch_id && !p.ultima.muestra && (
        <div className={cn("mt-1 flex flex-wrap items-center gap-1 rounded-md px-1.5 py-1", p.ultima.muestra_pedida ? "border-2 border-amber-500 bg-amber-50" : "border")}>
          <b className={cn(p.ultima.muestra_pedida && "text-amber-900")}>¿Se sacó muestra?</b>
          {p.ultima.muestra_pedida && <span className="text-[11px] font-medium text-amber-900">Pidieron muestra a este camión.</span>}
          <span className="flex-1" />
          {p.puedeMuestra ? <><Btn tono="pri" className="h-[26px] text-xs" onClick={() => p.onMuestra(p.ultima!, true)}>Sí</Btn><Btn className="h-[26px] text-xs" onClick={() => p.onMuestra(p.ultima!, false)}>No</Btn></>
            : <span className="text-[11px] text-slate-500">La carga quien tiene Historial · cargar.</span>}
        </div>
      )}
      {p.ultima.muestra && <div className="mt-0.5 text-[11px]">{p.ultima.muestra.tomada ? `Muestra ${p.ultima.muestra.numero} · asentamiento ${p.ultima.muestra.asentamiento} cm` : "Sin muestra"} · {p.ultima.muestra.por}</div>}
      <div className="mt-1 flex flex-wrap gap-1">
        <Btn className="h-[26px] text-xs" onClick={() => p.onReporte(p.ultima!)}>Ver reporte</Btn>
      </div>
    </div>
  ) : null

  const k = elegida
  if (!k) return <>{ult}<div className="py-6 text-center text-xs text-slate-500">No hay una carga elegida.</div></>
  const ch = p.chequeo(k)
  const f = p.formulaDe(k.formula_id)
  const ctl = controlDeFormula(ctx, f, k.autorizacion)
  const alerta = p.alertas.find((a) => a.tipo === "receta_no_coincide" && a.formula_id === k.formula_id && ["abierta", "esperando_planta"].includes(a.estado))
  const malos = ch.items.filter((i) => !i.ok)
  const avisos = ch.items.filter((i) => i.ok && i.aviso)
  const bien = ch.items.filter((i) => i.ok && !i.aviso)
  const chip = (i: Item) => (
    <span key={i.clave + i.corto} title={i.texto} className={cn("inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded border px-1 text-[11px]", i.neutro ? "border-dashed text-slate-500" : !i.ok ? "border-red-300 bg-red-50 text-red-700" : i.aviso ? "border-amber-300 bg-amber-50 text-amber-800" : "border-slate-200 text-slate-600")}>
      {i.neutro ? "·" : !i.ok ? "✕" : i.aviso ? "!" : "✓"} {i.corto}
    </span>
  )
  return (
    <>
      {ult}
      {cab(k)}
      {/* Controles: los que fallan (y los avisos) sueltos; los que están bien, en un resumen que se abre */}
      <div className="flex flex-wrap items-center gap-[3px]">
        {malos.map(chip)}
        {avisos.map(chip)}
        <details className="text-[11px] text-slate-500">
          <summary className="cursor-pointer select-none whitespace-nowrap"><span className="text-green-700">✓</span> {bien.filter((i) => !i.neutro).length} controles OK</summary>
          <div className="mt-0.5 flex flex-wrap gap-[3px]">{bien.map(chip)}</div>
        </details>
      </div>
      {ctl.cmp && ctl.frenaReceta ? (
        <div className="rounded-md border border-l-[3px] border-slate-200 border-l-red-600 px-1.5 py-1 text-xs">
          <div className="truncate font-medium text-red-700" title={ctl.motivo || ""}>Receta {ctl.numero} distinta de la fórmula</div>
          <ComparacionCompacta cmp={ctl.cmp} numero={ctl.numero} />
          {p.puedeResolver && alerta ? <Btn tono="pri" className="mt-1" onClick={() => p.onResolver(alerta)}>Resolver</Btn>
            : <details className="mt-0.5 text-[11px] text-slate-500"><summary className="cursor-pointer select-none">¿Quién lo resuelve?</summary>Quien tiene Fórmulas · editar (Bautista, Fernando y Juan){k.frenada_confirmada_por ? `. Se despachó igual (${k.frenada_confirmada_por}): ya le llegó el mail a Juan Oreguy.` : "."}</details>}
        </div>
      ) : ctl.cmp ? (
        <div className="text-xs">
          <ComparacionCompacta cmp={ctl.cmp} numero={ctl.numero} />
          {ctl.aguaDistinta && <details className="text-[11px] text-amber-800"><summary className="cursor-pointer select-none">Agua distinta · no frena</summary>{ctl.items.find((i) => i.clave === "agua")?.texto}. Antes de tocar el agua en la planta conviene que lo confirme Grow.</details>}
        </div>
      ) : null}
      {enPlanta ? (
        <>
          <div className="flex items-center gap-1">
            <button className="h-[34px] rounded-md bg-green-600 px-[18px] text-[13.5px] font-bold tracking-[.03em] text-white disabled:bg-slate-300 disabled:text-slate-600" disabled={!ch.ok || !puedeCargar} onClick={() => p.onCargar(k)}>CARGAR</button>
            <Btn onClick={p.onBocina}>Bocina</Btn>
            <Btn tono="ghost" disabled={!puedeCargar} onClick={() => p.onCancelar(k)}>Cancelar…</Btn>
          </div>
          {ch.motivo
            ? <details className="text-[11px] text-red-700"><summary className="cursor-pointer select-none truncate" title={ch.motivo}>{ch.motivo}</summary><div className="break-words">{ch.motivo}</div></details>
            : <div className="truncate text-[11px] text-slate-500">Antes de arrancar se confirma que el camión está abajo.</div>}
        </>
      ) : <div className="rounded-md border border-dashed border-slate-400 px-2 py-1 text-[11px] text-slate-600">CARGAR y PARAR se accionan solo desde la computadora de la planta.</div>}
      {masDatos(k, <div>NP: se controla cuando esté Zomatik.</div>)}
    </>
  )
}

/**
 * Fórmula contra planta en 300 px (22/10): si coincide, una línea que se abre; si no, solo las filas que fallan y
 * "Ver los N materiales". La tolerancia va en el tooltip de la diferencia; el % solo si falla.
 */
function ComparacionCompacta({ cmp, numero }: { cmp: NonNullable<ReturnType<typeof controlDeFormula>["cmp"]>; numero: number | null }) {
  const fila = (f: (typeof cmp.filas)[number]) => (
    <tr key={f.material_id} className={cn(!f.ok && (f.agua ? "bg-amber-50" : "bg-red-50"))}>
      <td className="truncate border-b border-slate-200 px-1 py-px" title={f.nombre}>{nombreCorto(f.nombre)}</td>
      <td className="border-b border-slate-200 px-1 py-px text-right tabular-nums">{cantidadPorM3(f.grupo, f.formula)}</td>
      <td className="border-b border-slate-200 px-1 py-px text-right tabular-nums">{cantidadPorM3(f.grupo, f.receta)}</td>
      <td className={cn("border-b border-slate-200 px-1 py-px text-right tabular-nums", f.ok ? "text-green-700" : f.agua ? "text-amber-800" : "text-red-700")} title={`Tolerancia ±${cantidadPorM3(f.grupo, f.tol)}`}>
        {f.ok ? "✓" : <>{f.dif > 0 ? "+" : ""}{cantidadPorM3(f.grupo, f.dif)}{f.pct != null && <div className="text-[10px]">{f.dif > 0 ? "+" : ""}{nf(f.pct * 100, 1)} %</div>}</>}
      </td>
    </tr>
  )
  const tabla = (filas: typeof cmp.filas) => (
    <table className="mt-0.5 w-full table-fixed border-collapse text-[11px]">
      <colgroup><col className="w-[32%]" /><col className="w-[22%]" /><col className="w-[22%]" /><col className="w-[24%]" /></colgroup>
      <thead><tr className="text-left text-[10.5px] text-slate-500"><th className="px-1 font-normal">Material</th><th className="px-1 text-right font-normal">Fórmula</th><th className="px-1 text-right font-normal">Planta</th><th className="px-1 text-right font-normal">Dif.</th></tr></thead>
      <tbody>
        {filas.map(fila)}
        {cmp.sueltas.map((s2) => <tr key={s2} className="bg-red-50"><td colSpan={4} className="border-b border-slate-200 px-1 py-px">Pesa en {INFO_SALIDA[s2].nombre}, sin material</td></tr>)}
      </tbody>
    </table>
  )
  if (cmp.ok) return (
    <details className="text-[11px] text-slate-500">
      <summary className="cursor-pointer select-none"><span className="text-green-700">✓</span> Receta {numero} igual a la fórmula</summary>
      {tabla(cmp.filas)}
    </details>
  )
  const mal = cmp.filas.filter((f) => !f.ok)
  return (
    <>
      {tabla(mal)}
      {cmp.filas.length > mal.length && (
        <details className="text-[11px] text-slate-500">
          <summary className="cursor-pointer select-none">Ver los {cmp.filas.length} materiales</summary>
          {tabla(cmp.filas)}
        </details>
      )}
    </>
  )
}

function ReporteCarga({ k, filas, extras, ahora, onCerrar }: { k: CargaFila; filas: FilaReporte[]; extras: { litros: number; at: string; despues_de_terminar: boolean; usuario: string | null }[]; ahora: number; onCerrar: () => void }) {
  const fila: FilaAuditoria = {
    despacho: k.dispatch_id ? { id: k.dispatch_id, remito: k.remito, remito_tipo: k.remito_tipo, patente: k.mixers?.license_plate || null, despachado_at: k.despacho?.created_at || null, salio_at: k.despacho?.dispatch_date || null, cliente: k.despacho?.cliente || "", obra: k.despacho?.obra || "", formula: k.formulas?.code || "", m3: k.despacho?.quantity_m3 ?? k.m3 } : null,
    cargas: [{
      id: k.id, origen: k.origen, simulada: k.simulada, estado: k.estado, contador: k.contador_planta, inicio_at: k.inicio_at, fin_at: k.fin_at, m3: k.m3, m3_cargados: k.m3_cargados, ciclos: k.ciclos,
      receta_numero: k.receta_numero, receta_ok: !(k.bloqueo?.items || []).some((i) => i.clave === "receta" && (!i.ok || i.aviso)), agua_distinta: k.agua_distinta, autorizada: !!k.autorizacion,
      parada: k.resolucion?.modo && k.resolucion.modo !== "cancelada" ? k.resolucion.modo : null, completa_carga_id: k.completa_carga_id,
      materiales: filas.map((f) => ({ ...f, material_id: null, grupo: INFO_SALIDA[f.salida].grupo, unidad: f.unidad || "" })) as any, plantista: k.arrancada_por, patente_planta: k.patente_planta, observacion_planta: k.observacion_planta, revisada: k.estado_auditoria === "revisada",
    }],
    extras, salida_gps: k.salida_gps || null, union: (k.union_remito as any) || null,
  }
  return (
    <ReporteDialog
      titulo={`Reporte de carga${k.contador_planta ? ` N° ${k.contador_planta}` : ""}${k.remito ? ` · Remito ${k.remito_tipo || ""} ${k.remito}` : ""}`}
      cabecera={<>{k.despacho?.cliente || k.cliente_planta} · <b className="font-medium">{k.mixers?.license_plate || k.patente_planta}</b> · {k.formulas?.code} · receta {k.receta_numero ?? "—"} · <b className="font-medium">{m3t(k.m3_cargados ?? k.m3)} m³</b> en {k.ciclos} ciclos · {k.origen === "sistema" ? "desde el sistema" : k.origen === "prueba" ? "orden de prueba" : "arrancada en Indumix"} · plantista {k.arrancada_por || "—"}{k.simulada ? " · PLANTA SIMULADA (no mueve stock)" : ""}</>}
      filas={filas} extras={extras}
      tiempos={{ despachado: k.despacho?.created_at || null, inicio: k.inicio_at, fin: k.fin_at || k.parada_at, salida: k.salida_gps || null }}
      banderas={banderas(fila, ahora)} nota={k.resolucion?.efecto?.texto || null} onCerrar={onCerrar}
    />
  )
}

/** "¿Se sacó muestra?" › Sí: número y asentamiento medido, como "Agregar muestra" del Historial. */
function MuestraDialog({ k, onGuardar, onCerrar }: { k: CargaFila; onGuardar: (d: { numero: string; asentamiento: number }) => Promise<boolean>; onCerrar: () => void }) {
  const [numero, setNumero] = useState("")
  const [asent, setAsent] = useState("")
  const [ultima, setUltima] = useState<string | null>(null)
  const [env, setEnv] = useState(false)
  useEffect(() => {
    createClient().from("dispatches").select("sample_number").not("sample_number", "is", null).order("created_at", { ascending: false }).limit(1)
      .then((r: any) => setUltima(r.data?.[0]?.sample_number || null))
  }, [])
  const a = asentamientoValido(asent)
  return (
    <Dialog open onOpenChange={(v) => !v && !env && onCerrar()}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader><DialogTitle>Muestra · {k.mixers?.license_plate || k.patente_planta} · remito {k.remito_tipo || ""} {k.remito}</DialogTitle></DialogHeader>
        <div className="space-y-2 text-xs">
          {ultima && <span className="inline-block rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">Última muestra: {ultima}</span>}
          <label className="block text-[11px] font-medium">Número de muestra *<input className="mt-0.5 block h-[30px] w-full rounded-md border px-2 text-xs" value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="Ej: M-0413" /></label>
          <label className="block text-[11px] font-medium">Asentamiento medido (cm) *<input className="mt-0.5 block h-[30px] w-full rounded-md border px-2 text-xs" inputMode="decimal" value={asent} onChange={(e) => setAsent(e.target.value)} placeholder="Ej: 12,5" /></label>
          <div className="text-xs text-slate-500">Se crean 3 probetas (1 a 7 días y 2 a 28) con el moldeo en la fecha del despacho, igual que «Agregar muestra» del Historial.</div>
        </div>
        <DialogFooter><Btn onClick={onCerrar} disabled={env}>Cancelar</Btn><Btn tono="pri" disabled={!numero.trim() || a == null || env} onClick={async () => { setEnv(true); const ok = await onGuardar({ numero: numero.trim(), asentamiento: a! }); setEnv(false); if (ok) onCerrar() }}>Guardar muestra</Btn></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * "Extra agua" MANTENIDO (21/10 · 6): mientras se mantiene apretado cae agua al camión con caudal constante; al soltar,
 * se frena. También se frena si el puntero sale del botón, si se pierde el foco o la pestaña se oculta, y la planta la
 * corta sola si se corta la comunicación. Mouse y dedo (pointer events).
 */
function BotonAgua({ abierta, pulso, total, abrir, soltar, disabled }: { abierta: boolean; pulso: number; total: number; abrir: () => Promise<boolean>; soltar: () => void; disabled?: boolean }) {
  const apretado = useRef(false)
  const cortar = useCallback(() => { if (apretado.current) { apretado.current = false; soltar() } }, [soltar])
  useEffect(() => {
    const vis = () => { if (document.visibilityState !== "visible") cortar() }
    window.addEventListener("blur", cortar)
    document.addEventListener("visibilitychange", vis)
    return () => { window.removeEventListener("blur", cortar); document.removeEventListener("visibilitychange", vis); cortar() }
  }, [cortar])
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <button
        disabled={disabled}
        className={cn("h-[28px] select-none rounded border px-2.5 text-xs disabled:opacity-45", abierta ? "border-blue-700 bg-blue-600 text-white" : "border-blue-300 bg-transparent text-blue-800 hover:bg-blue-50")}
        style={{ touchAction: "none", WebkitUserSelect: "none" } as React.CSSProperties}
        onContextMenu={(ev) => ev.preventDefault()}
        onPointerDown={async (ev) => { ev.preventDefault(); apretado.current = true; const ok = await abrir(); if (!ok) apretado.current = false; else if (!apretado.current) soltar() }}
        onPointerUp={cortar} onPointerLeave={cortar} onPointerCancel={cortar}
        onKeyDown={(ev) => { if ((ev.key === " " || ev.key === "Enter") && !ev.repeat && !apretado.current) { apretado.current = true; void abrir().then((ok) => { if (!ok) apretado.current = false }) } }}
        onKeyUp={(ev) => { if (ev.key === " " || ev.key === "Enter") cortar() }}
        onBlur={cortar}
      >
        {abierta ? `Cayendo agua… ${nf(pulso, 1)} L` : "Extra agua · mantené apretado"}
      </button>
      <span className="text-xs">Total de este camión <b className="font-medium tabular-nums">{nf(total, 1)} L</b></span>
    </div>
  )
}
