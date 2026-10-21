"use client"

/**
 * El puente de la PC de la planta, SIMULADO (carga-planta.md 9.4; esta etapa). Corre en el navegador:
 *
 * - arma el simulador de Indumix con las recetas que hay en la base (las 20 "de la planta") y lo hace correr;
 * - mira el estado 4 veces por segundo y, como haría el puente real, detecta arranque, ciclos, fin, PARAR, alarmas y
 *   cargas hechas desde Indumix, y las sube a la nube (/api/carga/*);
 * - guarda el estado de la planta simulada en el equipo (si se recarga la página, la planta "siguió andando");
 * - sin internet (simulado): la carga sigue, el PARAR anda, las órdenes que ya bajaron se cargan igual (20.2: sin PIN
 *   ni nada extra) y lo que hay que subir queda en una cola del equipo, que se sube sola cuando vuelve.
 *
 * Nunca habla con la planta real ni con 192.168.0.10.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { ArranqueCanceladoError, crearPuente, pasosArranque, type PuenteConAdaptador } from "@/lib/carga/puente"
import { SimuladorIndumix, detectarEventos, type Falla } from "@/lib/carga/simulador"
import { huellaReceta } from "@/lib/carga/receta"
import { materialesDeReporte, type Contexto } from "@/lib/carga/datos"
import { PlantaRechazoError, SinConexionError, type EstadoPlanta, type FormulaSistema, type OrdenPlanta, type RecetaPlanta, type ReportePlanta } from "@/lib/carga/tipos"

const CLAVE_SIM = "rebucret_carga_simulador"
const CLAVE_COLA = "rebucret_carga_por_subir"
/** Lo que el sistema rechazó al subir (4xx que no es de sesión): no se reintenta, pero queda guardado en el equipo */
const CLAVE_RECHAZADOS = "rebucret_carga_rechazados"
const leer = (k: string) => { try { return window.localStorage.getItem(k) } catch { return null } }
const guardar = (k: string, v: string) => { try { window.localStorage.setItem(k, v) } catch { /* sin almacenamiento */ } }
const nuevoId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`)
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))

export type CargaParaPuente = {
  id: string
  m3: number
  receta_numero: number | null
  formula_id: string | null
  patente_planta: string | null
  cliente_planta: string | null
  observacion_planta: string | null
  remito: string | null
  ciclos: number | null
  m3_ciclo: number | null
}

type Envio = { ruta: string; body: Record<string, unknown> }

export type Prep = { cargaId: string; pasos: string[]; i: number; error?: string }

type Guardado = {
  v: 1
  guardadoMs: number
  recetas: RecetaPlanta[]
  humedades: SimuladorIndumix["humedades"]
  niveles: SimuladorIndumix["niveles"]
  contador: number
  plcS: number
  carga: SimuladorIndumix["carga"]
  reportes: ReportePlanta[]
  alarmas: SimuladorIndumix["alarmas"]
  seleccion: OrdenPlanta | null
  ordenActiva: { cargaId: string; contador: number } | null
  ultima: { cargaId: string; contador: number; fin: number } | null
  diaPlanta: string
}

export function usarPuenteSimulado(o: {
  activo: boolean
  ctx: Contexto | null
  formulas: FormulaSistema[]
  /** se llama cuando algo cambió en la base (para releer) */
  onCambio: () => void
  onAviso: (titulo: string, detalle?: string) => void
}) {
  const { activo, ctx, formulas, onCambio, onAviso } = o
  const simRef = useRef<SimuladorIndumix | null>(null)
  const puenteRef = useRef<PuenteConAdaptador | null>(null)
  const prevRef = useRef<EstadoPlanta | null>(null)
  const ordenRef = useRef<{ cargaId: string; contador: number } | null>(null)
  const ultimaRef = useRef<{ cargaId: string; contador: number; fin: number } | null>(null)
  const diaRef = useRef<string>(new Date().toLocaleDateString("en-CA"))
  const ctxRef = useRef(ctx)
  const formulasRef = useRef(formulas)
  const internetRef = useRef(true)
  const velRef = useRef(1)
  ctxRef.current = ctx
  formulasRef.current = formulas

  const [estado, setEstado] = useState<EstadoPlanta | null>(null)
  const [conectado, setConectado] = useState(true)
  const [internet, setInternetSt] = useState(true)
  const [vel, setVelSt] = useState(1)
  const [porSubir, setPorSubir] = useState(0)
  const [prep, setPrep] = useState<Prep | null>(null)
  const [ultimaLectura, setUltimaLectura] = useState<number | null>(null)
  const [orden, setOrden] = useState<{ cargaId: string; contador: number } | null>(null)
  const [ultima, setUltima] = useState<{ cargaId: string; contador: number; fin: number } | null>(null)
  const [listo, setListo] = useState(false)
  // PARAR mientras arranca: la carga que se está arrancando queda cancelada y `cargar` lo mira antes de cada paso
  const cancelarRef = useRef<string | null>(null)
  const prepRef = useRef<Prep | null>(null)
  useEffect(() => { prepRef.current = prep }, [prep])

  // ── Subir a la nube (o encolar sin internet) ──
  const cola = useCallback((): Envio[] => { try { return JSON.parse(leer(CLAVE_COLA) || "[]") } catch { return [] } }, [])
  const guardarCola = useCallback((c: Envio[]) => { guardar(CLAVE_COLA, JSON.stringify(c)); setPorSubir(c.length) }, [])
  const subir = useCallback(async (ruta: string, body: Record<string, unknown>, opts: { encolar?: boolean } = { encolar: true }): Promise<{ ok: boolean; json?: any; encolado?: boolean; error?: string }> => {
    const b = { pedido: nuevoId(), at: new Date().toISOString(), ...body }
    if (!internetRef.current) {
      if (opts.encolar) { guardarCola([...cola(), { ruta, body: { ...b, sin_internet: true } }]); return { ok: true, encolado: true } }
      return { ok: false, error: "Sin internet" }
    }
    try {
      const r = await fetch(ruta, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })
      const json = await r.json().catch(() => ({}))
      if (!r.ok) return { ok: false, json, error: json?.error || `Error ${r.status}` }
      return { ok: true, json }
    } catch {
      if (opts.encolar) { guardarCola([...cola(), { ruta, body: { ...b, sin_internet: true } }]); return { ok: true, encolado: true } }
      return { ok: false, error: "No hay conexión con el sistema" }
    }
  }, [cola, guardarCola])

  const vaciando = useRef(false)
  const avisoSesion = useRef(0)
  const vaciarCola = useCallback(async () => {
    const c = cola()
    if (!c.length || !internetRef.current || vaciando.current) return
    vaciando.current = true
    // En orden (arrancar antes que terminar). Sale de la cola solo lo que el sistema aceptó (2xx, o "ya estaba":
    // duplicado). Sin sesión (401/403) se conserva todo y se pide entrar de nuevo. Otro rechazo (4xx) se aparta a
    // "rechazados" del equipo para no trabar la cola. Lo que se encoló mientras tanto queda.
    const subidos = new Set<unknown>()
    const rechazados: (Envio & { status: number; error: string })[] = []
    let sinSesion = false
    try {
      for (const x of c) {
        let r: Response
        try { r = await fetch(x.ruta, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(x.body) }) } catch { break }
        if (r.status === 401 || r.status === 403) { sinSesion = true; break }
        if (r.status >= 500) break
        const j = await r.json().catch(() => ({}))
        if (r.ok || j?.duplicado) { subidos.add(x.body.pedido); continue }
        rechazados.push({ ...x, status: r.status, error: String(j?.error || "") })
      }
    } finally {
      const fuera = new Set([...subidos, ...rechazados.map((x) => x.body.pedido)])
      guardarCola(cola().filter((x) => !fuera.has(x.body.pedido)))
      if (rechazados.length) {
        let prev: unknown[] = []
        try { prev = JSON.parse(leer(CLAVE_RECHAZADOS) || "[]") } catch { /* nada */ }
        guardar(CLAVE_RECHAZADOS, JSON.stringify([...prev, ...rechazados].slice(-200)))
      }
      vaciando.current = false
    }
    const n = subidos.size
    if (n) { onAviso(`Se subieron ${n} registro${n > 1 ? "s" : ""} guardados en la PC de la planta`, "Sin duplicar: cada uno lleva su número de pedido."); onCambio() }
    if (rechazados.length) onAviso(`El sistema rechazó ${rechazados.length} registro${rechazados.length > 1 ? "s" : ""} guardado${rechazados.length > 1 ? "s" : ""}`, `${rechazados[0].error || `Error ${rechazados[0].status}`}. Quedan apartados en este equipo; avisale a Bautista.`)
    if (sinSesion && Date.now() - avisoSesion.current > 60_000) {
      avisoSesion.current = Date.now()
      const q = cola().length
      onAviso(`Entrá de nuevo para subir ${q} registro${q === 1 ? "" : "s"}`, "Se cerró la sesión. Lo guardado en esta PC no se pierde: se sube cuando vuelvas a entrar.")
    }
  }, [cola, guardarCola, onAviso, onCambio])

  // ── Guardar / recuperar la planta simulada ──
  const guardarSim = useCallback(() => {
    const s = simRef.current
    if (!s) return
    const g: Guardado = {
      v: 1, guardadoMs: Date.now(), recetas: s.recetas, humedades: s.humedades, niveles: s.niveles, contador: s.contador, plcS: s.plcS,
      carga: s.carga, reportes: s.reportes, alarmas: s.alarmas, seleccion: s.seleccion, ordenActiva: ordenRef.current, ultima: ultimaRef.current, diaPlanta: diaRef.current,
    }
    guardar(CLAVE_SIM + ":" + (ctxRef.current?.puesto.id || ""), JSON.stringify(g))
  }, [])

  const subirRecetas = useCallback(async (aviso = false) => {
    const s = simRef.current, c = ctxRef.current
    if (!s || !c) return
    let rs: RecetaPlanta[]
    try { rs = await s.leerRecetas() } catch { if (aviso) onAviso("No hay conexión con la planta", "No se pudieron leer las recetas."); return }
    const r = await subir("/api/carga/recetas", { puesto_id: c.puesto.id, leida_at: new Date().toISOString(), recetas: rs })
    setUltimaLectura(Date.now())
    if (r.ok && !r.encolado) {
      const j = r.json || {}
      if (aviso || j.cambios || j.alertas?.abiertas || j.alertas?.cerradas || j.recalculadas)
        onAviso("Recetas leídas", j.cambios ? `${j.cambios} receta${j.cambios > 1 ? "s" : ""} cambiada${j.cambios > 1 ? "s" : ""} en Indumix: avisado.` : j.alertas?.cerradas ? "Una receta ahora coincide: se desbloqueó." : "Sin cambios")
      onCambio()
    } else if (!r.ok && aviso) onAviso("No se pudieron subir las recetas", r.error)
  }, [subir, onAviso, onCambio])

  // Crear el simulador cuando hay contexto con recetas (o recuperar el guardado)
  useEffect(() => {
    if (!activo || !ctx || simRef.current) return
    const g = (() => { try { return JSON.parse(leer(CLAVE_SIM + ":" + ctx.puesto.id) || "null") as Guardado | null } catch { return null } })()
    const recetas = g?.recetas?.length ? g.recetas : ctx.recetas.map(({ numero, nombre, habilitada, salidas }) => ({ numero, nombre, habilitada, salidas }))
    if (!recetas.length) return
    const ahora = new Date()
    const prendida = new Date(ahora); prendida.setHours(6, 58, 0, 0)
    const { puente, simulador } = crearPuente("simulador", {
      recetas, m3MaxCiclo: ctx.puesto.m3_max_ciclo, contador: g?.contador ?? 0,
      prendidaHaceS: Math.max(0, (ahora.getTime() - prendida.getTime()) / 1000), semilla: Math.floor(Math.random() * 1e6),
    })
    if (g && g.v === 1 && new Date(g.guardadoMs).toLocaleDateString("en-CA") === ahora.toLocaleDateString("en-CA")) {
      simulador.humedades = g.humedades
      simulador.niveles = g.niveles
      simulador.carga = g.carga
      simulador.reportes = g.reportes || []
      simulador.alarmas = g.alarmas || []
      simulador.seleccion = g.seleccion
      ordenRef.current = g.ordenActiva
      ultimaRef.current = g.ultima
      diaRef.current = g.diaPlanta || diaRef.current
      // La planta siguió andando mientras la página estaba cerrada
      prevRef.current = simulador.estado()
      simulador.avanzar(Math.min(3600, (Date.now() - g.guardadoMs) / 1000))
    }
    simRef.current = simulador
    puenteRef.current = puente
    setOrden(ordenRef.current)
    setUltima(ultimaRef.current)
    setListo(true)
    setPorSubir(cola().length)
    // El puente lee las recetas al arrancar (6.4)
    setTimeout(() => subirRecetas(false), 500)
  }, [activo, ctx, cola, subirRecetas])

  // ── Lo que pasa en la planta → la nube ──
  const alEvento = useCallback(async (ev: ReturnType<typeof detectarEventos>[number], e: EstadoPlanta) => {
    const s = simRef.current!, c = ctxRef.current
    const ord = ordenRef.current
    const nuestra = !!ord && ord.contador === (ev.tipo === "fin" || ev.tipo === "parar" || ev.tipo === "arranque" ? ev.contador : e.contador_carga)
    const reporte = async (n: number) => (await s.leerReportes().catch(() => [] as ReportePlanta[])).find((r) => r.numero === n) || null
    const formulaDe = (id: string | null | undefined) => formulasRef.current.find((f) => f.id === id) || null
    switch (ev.tipo) {
      case "ciclo_inicio":
        if (nuestra && ev.ciclo > 1) await subir(`/api/carga/${ord!.cargaId}`, { accion: "evento", tipo: "ciclo_inicio", ciclo: ev.ciclo })
        break
      case "suspender":
      case "reanudar":
        if (nuestra) await subir(`/api/carga/${ord!.cargaId}`, { accion: "evento", tipo: ev.tipo })
        break
      case "alarma":
      case "alarma_fin":
        if (nuestra) await subir(`/api/carga/${ord!.cargaId}`, { accion: "evento", tipo: ev.tipo, texto: ev.texto })
        break
      case "parar":
      case "fin": {
        const rep = await reporte(ev.contador)
        if (!rep || !c) break
        if (nuestra) {
          const carga = await fetchCarga(ord!.cargaId)
          const mats = materialesDeReporte(rep, c.salidas, formulaDe(carga?.formula_id))
          await subir(`/api/carga/${ord!.cargaId}`, { accion: ev.tipo === "parar" ? "parar" : "terminar", materiales: mats, m3_cargados: rep.m3_cargados, fin_plc: rep.fin_plc, ciclo: e.ciclo })
          if (ev.tipo === "fin") { ultimaRef.current = { cargaId: ord!.cargaId, contador: ev.contador, fin: Date.now() }; setUltima(ultimaRef.current); ordenRef.current = null; setOrden(null) }
          onAviso(ev.tipo === "fin" ? `Carga terminada · ${rep.camion}` : `Carga PARADA · ciclo ${e.ciclo} de ${e.ciclos}`, ev.tipo === "fin" ? "Planta simulada: el stock NO se ajusta (queda apagado hasta el puente real)." : "Lo pesado queda registrado. Elegí qué pasa con el camión.")
        } else if (ev.tipo === "fin") {
          // Carga hecha desde Indumix, sin orden nuestra: la sube el puente y la une el emparejador
          const mats = materialesDeReporte(rep, c.salidas, null)
          const r = await subir("/api/carga/indumix", { puesto_id: c.puesto.id, dia_planta: diaRef.current, inicio_at: new Date(Date.now() - (e.tiempo_total_s || 0) * 1000 / Math.max(1, velRef.current)).toISOString(), fin_at: new Date().toISOString(), reporte: rep, materiales: mats })
          onAviso("El puente vio una carga que el sistema no pidió", r.json?.ya_cargada ? "Era una orden de la cola: quedó «Ya cargada en Indumix» (no se vuelve a cargar)." : r.json?.union ? `Unida al remito ${r.json.union}.` : "Alerta y auditoría «Sin remito» hasta que se una con uno.")
        }
        onCambio()
        break
      }
      case "arranque":
        break
    }
  }, [subir, onAviso, onCambio])

  // Bucle: la planta corre y se mira 4 veces por segundo
  useEffect(() => {
    if (!activo || !listo) return
    let ult = performance.now()
    let ultGuardado = 0, ultRecetas = Date.now(), ultCola = 0
    const t = setInterval(() => {
      const s = simRef.current
      if (!s) return
      const ahora = performance.now()
      s.avanzar(((ahora - ult) / 1000) * velRef.current)
      ult = ahora
      let e: EstadoPlanta | null = null
      try { e = s.estado(); if (!s.conectado) throw new SinConexionError() } catch { e = null }
      setConectado(s.conectado)
      if (e) {
        const evs = detectarEventos(prevRef.current, e)
        prevRef.current = e
        setEstado(e)
        for (const ev of evs) void alEvento(ev, e)
      }
      if (ahora - ultGuardado > 1000) { ultGuardado = ahora; guardarSim() }
      if (Date.now() - ultRecetas > 5 * 60_000) { ultRecetas = Date.now(); void subirRecetas(false) }
      if (internetRef.current && ahora - ultCola > 3000) { ultCola = ahora; void vaciarCola() }
    }, 250)
    return () => clearInterval(t)
  }, [activo, listo, alEvento, guardarSim, subirRecetas, vaciarCola])

  // ── Acciones de la pantalla ──
  const exigir = () => {
    const s = simRef.current, p = puenteRef.current
    if (!s || !p) throw new Error("La planta simulada no está lista.")
    if (!s.conectado) throw new SinConexionError()
    return { s, p }
  }

  /** CARGAR (5.4): permiso (o sin internet, 20.2) → escribir → verificar → recomparar la receta → CARGAR. */
  const cargar = useCallback(async (k: CargaParaPuente, receta: RecetaPlanta | null): Promise<boolean> => {
    let s: SimuladorIndumix, p: PuenteConAdaptador
    try { ({ s, p } = exigir()) } catch (e) { onAviso("No hay conexión con la planta", (e as Error).message); return false }
    if (k.receta_numero == null) { onAviso("Esa fórmula no tiene receta en la planta"); return false }
    const ordenPlanta: OrdenPlanta = {
      receta: k.receta_numero, secuencia: 1, m3: Number(k.m3), cliente: (k.cliente_planta || "").slice(0, 20), camion: (k.patente_planta || "").slice(0, 20),
      observacion: (k.observacion_planta || k.remito || "").slice(0, 30),
    }
    const sinInternet = !internetRef.current
    const pasos = [
      sinInternet ? "Sin internet: la orden ya bajó y la validó la nube; el puente la acepta igual (no se pide nada extra)" : "El sistema controla el permiso, la cola y la receta",
      ...pasosArranque(ordenPlanta),
    ]
    cancelarRef.current = null
    const cancelada = () => cancelarRef.current === k.id
    setPrep({ cargaId: k.id, pasos, i: 0 })
    const contadorEsperado = s.contador + 1
    const r = await subir(`/api/carga/${k.id}`, {
      accion: "arrancar", sin_internet: sinInternet, contador: contadorEsperado, receta: k.receta_numero, inicio_plc: s.estado().reloj_plc, dia_planta: diaRef.current,
      camion_abajo_at: new Date().toISOString(), ciclos: Math.max(1, Math.ceil(Number(k.m3) / s.m3MaxCiclo - 1e-9)), m3_ciclo: Number(k.m3) / Math.max(1, Math.ceil(Number(k.m3) / s.m3MaxCiclo - 1e-9)),
    }, { encolar: sinInternet })
    if (!r.ok) { setPrep(null); onAviso(cancelada() ? "PARAR: no se arrancó nada" : "No arrancó", cancelada() ? undefined : r.error); onCambio(); return false }
    ordenRef.current = { cargaId: k.id, contador: contadorEsperado }
    setOrden(ordenRef.current)
    setPrep((x) => (x ? { ...x, i: 1 } : x))
    await espera(450)
    try {
      await p.cargarYArrancar(ordenPlanta, receta ? huellaReceta(receta) : null, (i) => { setPrep((x) => (x ? { ...x, i: i + 1 } : x)) }, cancelada)
      await espera(450)
      setPrep(null)
      ultimaRef.current = null
      setUltima(null)
      onCambio()
      return true
    } catch (e) {
      ordenRef.current = null
      setOrden(null)
      setPrep(null)
      if (e instanceof ArranqueCanceladoError) {
        await subir(`/api/carga/${k.id}`, { accion: "no_arranco", motivo: "PARAR" })
        onAviso("PARAR: se cortó el arranque", "No se arrancó nada. La orden vuelve a la cola.")
        onCambio()
        return false
      }
      const txt = e instanceof PlantaRechazoError || e instanceof SinConexionError ? e.message : (e as Error)?.message || "Error"
      await subir(`/api/carga/${k.id}`, { accion: "no_arranco", motivo: txt })
      onAviso("La planta no arrancó", `${txt} No se reintenta solo ni se saltea ninguna seguridad.`)
      onCambio()
      return false
    }
  }, [subir, onAviso, onCambio]) // eslint-disable-line react-hooks/exhaustive-deps

  const conPlanta = useCallback(async (f: (p: PuenteConAdaptador) => Promise<void>, ok?: string) => {
    try { const { p } = exigir(); await f(p); if (ok) onAviso(ok) } catch (e) {
      onAviso(e instanceof SinConexionError ? "No hay conexión con la planta" : "La planta no lo aceptó", e instanceof SinConexionError ? "Usá el PARAR de Indumix o la parada de emergencia." : (e as Error).message)
    }
  }, [onAviso]) // eslint-disable-line react-hooks/exhaustive-deps

  /** PARAR: siempre a la planta. Si estaba arrancando, además corta el arranque antes del paso que sigue. */
  const parar = useCallback(async () => {
    if (prepRef.current) cancelarRef.current = prepRef.current.cargaId
    await conPlanta((p) => p.parar())
  }, [conPlanta])

  const extraAgua = useCallback(async (litros: number, cargaId: string, despues: boolean) => {
    try { const { p } = exigir(); await p.extraAgua(litros) } catch (e) { onAviso(e instanceof SinConexionError ? "No hay conexión con la planta" : "No se agregó", (e as Error).message); return false }
    await subir(`/api/carga/${cargaId}`, { accion: "agua_extra", litros, despues_de_terminar: despues })
    onAviso(`Extra agua: ${litros} L${despues ? " (después de terminar)" : ""}`, "Registrado en la carga y en la auditoría.")
    onCambio()
    return true
  }, [subir, onAviso, onCambio]) // eslint-disable-line react-hooks/exhaustive-deps

  const simular = useCallback(async (f: Falla | { tipo: "cambiar_receta"; numero: number; cambios: Record<string, number> } | { tipo: "internet" } | { tipo: "leer" }) => {
    const s = simRef.current
    if (!s) return
    if (f.tipo === "internet") {
      internetRef.current = !internetRef.current
      setInternetSt(internetRef.current)
      onAviso(internetRef.current ? "Volvió internet en la planta" : "Se cortó internet en la planta (simulado)", internetRef.current ? "Se sube lo que quedó guardado, sin duplicar." : "La carga en curso, el PARAR y la planta en vivo siguen andando. Las órdenes que ya bajaron se cargan igual.")
      if (internetRef.current) void vaciarCola()
      return
    }
    if (f.tipo === "leer") { await subirRecetas(true); return }
    if (f.tipo === "cambiar_receta") { s.cambiarReceta(f.numero, f.cambios as never); await subirRecetas(true); return }
    s.provocar(f)
    if (f.tipo === "sin_conexion" || f.tipo === "con_conexion") setConectado(s.conectado)
  }, [onAviso, subirRecetas, vaciarCola])

  const setVel = (v: number) => { velRef.current = v; setVelSt(v) }

  return {
    listo, estado, conectado, internet, vel, setVel, porSubir, prep, ultimaLectura, orden, ultima,
    simulador: simRef.current,
    cargar, parar, extraAgua, simular,
    suspender: () => conPlanta((p) => p.suspender()),
    reanudar: () => conPlanta((p) => p.reanudar()),
    bocina: () => conPlanta((p) => p.bocina(2000)),
    olvidarUltima: () => { ultimaRef.current = null; setUltima(null) },
    /** Después de resolver una carga parada: la planta queda libre para la próxima orden */
    soltarOrden: () => { ordenRef.current = null; setOrden(null) },
  }
}

/** Una carga leída de la base (para armar los materiales del reporte). */
async function fetchCarga(id: string): Promise<{ formula_id: string | null } | null> {
  try {
    const { data } = await createClient().from("cargas").select("formula_id").eq("id", id).maybeSingle()
    return (data as { formula_id: string | null } | null) || null
  } catch {
    return null
  }
}
