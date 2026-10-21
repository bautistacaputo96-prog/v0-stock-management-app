"use client"

/** Datos de la pantalla de Carga (se leen con el cliente del navegador, que solo puede leer estas tablas). */
import { useCallback, useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { cargarContexto, cargarFormulas, cargarPuesto, type Contexto, type Puesto } from "@/lib/carga/datos"
import type { FormulaSistema } from "@/lib/carga/tipos"

export const ESTADOS_COLA = ["pendiente", "bloqueada", "lista", "preparada"]
export const ESTADOS_PLANTA = ["en_curso", "suspendida", "parada"]

export type CargaFila = {
  id: string
  puesto_id: string
  estado: string
  origen: "sistema" | "indumix" | "prueba"
  simulada: boolean
  dispatch_id: string | null
  completa_carga_id: string | null
  remito: string | null
  remito_tipo: "R" | "X" | null
  mixer_id: string | null
  patente_planta: string | null
  cliente_planta: string | null
  observacion_planta: string | null
  formula_id: string | null
  receta_numero: number | null
  m3: number
  ciclos: number | null
  m3_ciclo: number | null
  ciclo_actual: number | null
  m3_cargados: number | null
  bloqueo: { frena: boolean; motivo: string | null; agua: boolean; items: { clave: string; ok: boolean; aviso: boolean; corto: string; texto: string }[] } | null
  agua_distinta: boolean
  autorizacion: { por: string; motivo: string; at: string; vence?: string } | null
  frenada_confirmada_por: string | null
  arrancada_por: string | null
  bajada_at: string | null
  inicio_at: string | null
  fin_at: string | null
  parada_at: string | null
  contador_planta: number | null
  sin_internet: boolean
  resolucion: { modo: string; motivo: string; por: string; at: string; efecto?: { texto: string } } | null
  union_remito: string | null
  estado_auditoria: string | null
  /** "Sacar muestra a este camión" (aviso de la Entrega) y la respuesta al terminar */
  muestra_pedida: boolean
  muestra: { tomada: boolean; numero: string | null; asentamiento: number | null; por: string; at: string } | null
  created_by: string | null
  created_at: string
  formulas?: { code: string } | null
  mixers?: { license_plate: string } | null
  // del despacho
  despacho?: { created_at: string; dispatch_date: string; quantity_m3: number; cliente: string; obra: string } | null
  salida_gps?: string | null
}

export type AlertaFila = {
  id: string
  tipo: string
  carga_id: string | null
  formula_id: string | null
  receta_numero: number | null
  titulo: string
  detalle: Record<string, any> | null
  estado: "abierta" | "esperando_planta" | "resuelta" | "cerrada_sola"
  resolucion: string | null
  agua_confirmada_por: string | null
  resuelta_por: string | null
  resuelta_at: string | null
  motivo: string | null
  created_at: string
}

export type AguaExtraFila = { id: string; carga_id: string; at: string; litros: number; despues_de_terminar: boolean; usuario: string | null; origen: string }

const hoy0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString() }

export function usarDatosCarga(plantId: string, cadaMs: number) {
  const [puesto, setPuesto] = useState<Puesto | null>(null)
  const [sinMigracion, setSinMigracion] = useState(false)
  const [ctx, setCtx] = useState<Contexto | null>(null)
  const [formulas, setFormulas] = useState<(FormulaSistema & { usos?: number })[]>([])
  const [cargas, setCargas] = useState<CargaFila[]>([])
  const [alertas, setAlertas] = useState<AlertaFila[]>([])
  const [extras, setExtras] = useState<AguaExtraFila[]>([])
  const [mixers, setMixers] = useState<{ id: string; license_plate: string }[]>([])
  const [cargando, setCargando] = useState(true)

  const leer = useCallback(async () => {
    if (!plantId) return
    const sb = createClient()
    const p = await cargarPuesto(sb, plantId)
    if (!p) {
      // ¿no hay puesto o no está la tabla?
      const { error } = await sb.from("puestos_carga").select("id").limit(1)
      setSinMigracion(!!error)
      setPuesto(null); setCtx(null); setCargando(false)
      return
    }
    setSinMigracion(false)
    setPuesto(p)
    const [c, cg, al] = await Promise.all([
      cargarContexto(sb, p),
      sb.from("cargas").select("*, formulas(code), mixers(license_plate)").eq("puesto_id", p.id)
        .or(`estado.in.(${[...ESTADOS_COLA, ...ESTADOS_PLANTA].join(",")}),created_at.gte."${hoy0()}",fin_at.gte."${hoy0()}"`)
        .order("created_at"),
      sb.from("alertas_carga").select("*").eq("puesto_id", p.id).order("created_at", { ascending: false }).limit(150),
    ])
    const filas = ((cg.data || []) as CargaFila[]).map((x) => ({ ...x, m3: Number(x.m3) || 0 }))
    const ids = filas.map((x) => x.dispatch_id).filter(Boolean) as string[]
    const [ds, gps, ex] = await Promise.all([
      ids.length ? sb.from("dispatches").select("id, created_at, dispatch_date, quantity_m3, clients(name), construction_sites(name)").in("id", ids) : Promise.resolve({ data: [] }),
      ids.length ? sb.from("viajes_gps").select("dispatch_id, salida_planta").in("dispatch_id", ids) : Promise.resolve({ data: [] }),
      filas.length ? sb.from("cargas_agua_extra").select("*").in("carga_id", filas.map((x) => x.id)).order("at") : Promise.resolve({ data: [] }),
    ])
    const porD = new Map(((ds.data || []) as any[]).map((d) => [d.id, d]))
    const salida = new Map(((gps.data || []) as any[]).map((g) => [g.dispatch_id, g.salida_planta]))
    for (const f of filas) {
      const d = f.dispatch_id ? porD.get(f.dispatch_id) : null
      f.despacho = d ? { created_at: d.created_at, dispatch_date: d.dispatch_date, quantity_m3: Number(d.quantity_m3), cliente: d.clients?.name || "", obra: d.construction_sites?.name || "" } : null
      f.salida_gps = f.dispatch_id ? salida.get(f.dispatch_id) || null : null
    }
    setCtx(c)
    setCargas(filas)
    setAlertas((al.data || []) as AlertaFila[])
    setExtras(((ex.data || []) as AguaExtraFila[]).map((x) => ({ ...x, litros: Number(x.litros) })))
    setCargando(false)
  }, [plantId])

  // Fórmulas de la planta (con lo que se usaron en 6 meses, para armar las recetas del simulador) y camiones: una vez
  useEffect(() => {
    if (!plantId) return
    const sb = createClient()
    cargarFormulas(sb, { plantId }).then(async (fs) => {
      const desde = new Date(Date.now() - 183 * 86400_000).toISOString()
      const { data } = await sb.from("dispatches").select("formula_id").eq("plant_id", plantId).gte("dispatch_date", desde).limit(20000)
      const usos = new Map<string, number>()
      for (const d of (data || []) as { formula_id: string }[]) usos.set(d.formula_id, (usos.get(d.formula_id) || 0) + 1)
      setFormulas(fs.map((f) => ({ ...f, usos: usos.get(f.id) || 0 })).sort((a, b) => a.code.localeCompare(b.code)))
    })
    sb.from("mixers").select("id, license_plate").eq("active", true).order("license_plate").then((r: any) => setMixers(r.data || []))
  }, [plantId])

  useEffect(() => {
    setCargando(true)
    leer()
    const t = setInterval(() => { if (document.visibilityState === "visible") leer() }, cadaMs)
    return () => clearInterval(t)
  }, [leer, cadaMs])

  return { puesto, sinMigracion, ctx, formulas, cargas, alertas, extras, mixers, cargando, leer }
}
