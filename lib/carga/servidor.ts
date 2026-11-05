/**
 * Carga de planta · ayudas para las rutas /api/carga/* (SOLO servidor).
 *
 * - Toda ruta pide la sesión de la 0c-1, el interruptor de funciones nuevas (la pantalla está en prueba) y el permiso
 *   que corresponde (carga.ver / carga.cargar / carga.editar, o formulas.editar para resolver una receta).
 * - Escribe con la clave de servicio: el navegador solo puede leer estas tablas.
 * - Nada de esto habla con la planta. Con el simulador, la planta corre en el navegador de la PC de la planta; con el
 *   puesto real, el puente de la PC sube lo que lee (fase 1, solo lectura: /api/carga/puente). No existe ninguna ruta
 *   que haga arrancar algo.
 */
import { NextResponse } from "next/server"
import { exigirSesion, respuestaModoLocal, sbServicio, type Sesion } from "@/lib/auth/servidor"
import { puedeCon, type Accion, type SeccionClave } from "@/lib/permisos"
import { aRecetaLeida, bloqueoDe, cargarContexto, cargarFormulas, controlDeFormula, type Contexto, type Puesto } from "@/lib/carga/datos"
import { desvio, emparejar, type Candidato } from "@/lib/carga/auditoria"
import { clasificarCambioReceta } from "@/lib/carga/indumix"
import { diferenciasReceta, huellaReceta } from "@/lib/carga/receta"
import { INFO_SALIDA, SALIDAS, grupoDeSalida, normalizarPatente, type RecetaPlanta, type ReportePlanta, type Salida } from "@/lib/carga/tipos"

type Exigido = { sesion: Sesion; usuario: string; respuesta?: undefined } | { sesion?: undefined; usuario?: undefined; respuesta: NextResponse }

export const error = (texto: string, status = 400) => NextResponse.json({ error: texto }, { status })

/** Sesión + funciones nuevas + permiso. `escribe`: en el modo de prueba local no se graba nada. */
export async function exigirCarga(seccion: SeccionClave, accion: Accion, opts: { escribe?: boolean } = {}): Promise<Exigido> {
  const r = await exigirSesion()
  if (r.respuesta) return { respuesta: r.respuesta }
  const s = r.sesion
  if (s.usuario.ve_funciones_nuevas !== true) return { respuesta: error("La carga de planta está en prueba: solo la ven los usuarios con las funciones nuevas.", 403) }
  if (!puedeCon(s.usuario, seccion, accion)) return { respuesta: error("No tenés permiso para hacer esto.", 403) }
  if (opts.escribe !== false && s.local) return { respuesta: respuestaModoLocal() }
  return { sesion: s, usuario: s.usuario.name }
}

/** "12:41" en hora de Argentina */
export function hhmmAR(d: string | number | Date = new Date()): string {
  return new Date(d).toLocaleTimeString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hour12: false })
}

/** Una hora que manda la pantalla (la del puente). Si no viene o es rara (futuro o más de 2 días atrás), ahora. */
export function horaPuente(at: unknown): string {
  const t = typeof at === "string" || typeof at === "number" ? new Date(at).getTime() : NaN
  const ahora = Date.now()
  if (!Number.isFinite(t) || t > ahora + 2 * 60_000 || t < ahora - 2 * 86400_000) return new Date(ahora).toISOString()
  return new Date(t).toISOString()
}

/** Una hora del puente real tal cual (aunque sea vieja); si no se entiende, ahora. */
export function horaExacta(at: unknown): string {
  const t = typeof at === "string" || typeof at === "number" ? new Date(at).getTime() : NaN
  return new Date(Number.isFinite(t) ? t : Date.now()).toISOString()
}

/** Graba un evento. Con `pedido` repetido (se subió dos veces) devuelve false y no graba. */
export async function registrarEvento(e: { carga_id: string | null; puesto_id: string; tipo: string; at?: string; detalle?: Record<string, unknown> | null; usuario?: string | null; pedido?: string | null }): Promise<boolean> {
  const { error: err } = await sbServicio().from("cargas_eventos").insert({
    carga_id: e.carga_id, puesto_id: e.puesto_id, tipo: e.tipo, at: e.at || new Date().toISOString(), detalle: e.detalle ?? null, usuario: e.usuario ?? null, pedido: e.pedido ?? null,
  })
  if (err) {
    if ((err as { code?: string }).code === "23505") return false
    throw err
  }
  return true
}

/** ¿Ya se procesó este pedido de la pantalla? (idempotencia de las acciones que se reintentan sin internet) */
export async function yaProcesado(pedido: string | null | undefined): Promise<boolean> {
  if (!pedido) return false
  const { data } = await sbServicio().from("cargas_eventos").select("id").eq("pedido", pedido).limit(1)
  return !!data?.length
}

/**
 * Recalcula el control de receta de las cargas que esperan en la cola del puesto (después de leer recetas, cambiar la
 * Tolva 1 o resolver una alerta) y las pasa a "bloqueada" o "pendiente".
 */
export async function recalcularBloqueos(ctx: Contexto): Promise<number> {
  const sb = sbServicio()
  const { data } = await sb.from("cargas").select("id, estado, formula_id, autorizacion").eq("puesto_id", ctx.puesto.id).in("estado", ["pendiente", "bloqueada", "lista"])
  const cargas = (data || []) as { id: string; estado: string; formula_id: string | null; autorizacion: { por: string; motivo?: string } | null }[]
  if (!cargas.length) return 0
  const formulas = await cargarFormulas(sb, [...new Set(cargas.map((c) => c.formula_id).filter(Boolean) as string[])])
  let n = 0
  for (const c of cargas) {
    const f = formulas.find((x) => x.id === c.formula_id) || null
    const ctl = controlDeFormula(ctx, f, c.autorizacion)
    const estado = ctl.frena ? "bloqueada" : "pendiente"
    await sb.from("cargas").update({ bloqueo: bloqueoDe(ctl), agua_distinta: ctl.aguaDistinta, estado, receta_numero: ctl.numero }).eq("id", c.id)
    if (estado !== c.estado) n++
  }
  return n
}

/**
 * Una alerta abierta por receta y fórmula (6.5): se abre cuando la receta de la planta no es igual a la fórmula
 * asignada (roja si frena; ámbar si es solo el agua) y se cierra sola cuando el puente lee la receta corregida.
 */
export async function sincronizarAlertasReceta(ctx: Contexto, leidaAt: string): Promise<{ abiertas: number; cerradas: number }> {
  const sb = sbServicio()
  const ids = ctx.asignaciones.map((a) => a.formula_id).filter(Boolean) as string[]
  const formulas = await cargarFormulas(sb, ids)
  const { data } = await sb.from("alertas_carga").select("id, receta_numero, formula_id, estado").eq("puesto_id", ctx.puesto.id).eq("tipo", "receta_no_coincide").in("estado", ["abierta", "esperando_planta"])
  const abiertas = (data || []) as { id: string; receta_numero: number; formula_id: string; estado: string }[]
  let nuevas = 0, cerradas = 0
  for (const a of ctx.asignaciones) {
    if (!a.formula_id) continue
    const f = formulas.find((x) => x.id === a.formula_id)
    const receta = ctx.recetas.find((r) => r.numero === a.numero)
    if (!f || !receta) continue
    const ctl = controlDeFormula(ctx, f)
    const ya = abiertas.find((x) => x.receta_numero === a.numero && x.formula_id === a.formula_id)
    // La Tolva 1 no es un problema de receta: se controla aparte (y se corrige en la tolva)
    const coincide = !!ctl.cmp?.ok
    if (!coincide && ctl.cmp && !ya) {
      const soloAgua = !ctl.frenaReceta && ctl.aguaDistinta
      const { error: err } = await sb.from("alertas_carga").insert({
        puesto_id: ctx.puesto.id, tipo: "receta_no_coincide", formula_id: f.id, receta_numero: a.numero, receta_planta_id: receta.id,
        titulo: soloAgua ? `Receta ${a.numero}: el agua no es igual a ${f.code} (no frena)` : `La receta ${a.numero} de la planta no coincide con ${f.code}`,
        detalle: { frena: ctl.frenaReceta, agua: ctl.aguaDistinta, motivo: ctl.motivo, items: bloqueoDe(ctl).items, simulada: ctx.puesto.sistema === "simulador" },
      })
      if (!err) nuevas++
    } else if (coincide && ya) {
      await sb.from("alertas_carga").update({ estado: "cerrada_sola", resuelta_at: new Date().toISOString(), motivo: `Corregida en la planta · leída ${hhmmAR(leidaAt)}`, updated_at: new Date().toISOString() }).eq("id", ya.id)
      cerradas++
    }
  }
  return { abiertas: nuevas, cerradas }
}

/** Contexto del puesto con la clave de servicio. */
export const contextoServidor = (p: Puesto) => cargarContexto(sbServicio(), p)

// ───────────────────────────── Lógica compartida por las rutas y el puente real (spec 4.2) ─────────────────────────────

/** Lo que llega se limpia: solo salidas conocidas, valores ≥ 0, textos cortos, números de 1 a max_recetas. */
export function limpiarRecetas(puesto: Puesto, recetas: RecetaPlanta[]): RecetaPlanta[] {
  const limpias: RecetaPlanta[] = []
  for (const raw of recetas) {
    const numero = Number(raw?.numero)
    if (!(numero >= 1 && numero <= puesto.max_recetas)) continue
    limpias.push({
      numero, nombre: String(raw.nombre || "").slice(0, 40), habilitada: raw.habilitada !== false,
      salidas: (Array.isArray(raw.salidas) ? raw.salidas : []).filter((x) => SALIDAS.includes(x.salida as Salida)).map((x) => ({
        salida: x.salida, nombre_planta: String(x.nombre_planta || INFO_SALIDA[x.salida].nombre).slice(0, 30), valor: Math.max(0, Number(x.valor) || 0),
        unidad: INFO_SALIDA[x.salida].unidad, ...(x.orden != null && Number.isFinite(Number(x.orden)) ? { orden: Number(x.orden) } : {}),
      })),
    })
  }
  return limpias
}

const EVENTO_CAMBIO: Record<string, string> = { agua: "receta_agua", salida: "receta_salida", otro: "receta_datos" }

/**
 * Recetas leídas de la planta (la rama sin `mapeo` de /api/carga/recetas): cada huella nueva es una versión nueva (la
 * anterior nunca se pisa) y abre "La receta N cambió en Indumix entre … y …" (o "receta nueva"); las que no cambiaron solo
 * actualizan la hora. Después recompara las fórmulas asignadas y recalcula la cola.
 *
 * Con el puesto real (sistema indumix, 5.2): siempre se guarda la versión y queda el evento, pero la alerta abierta
 * `receta_cambiada` solo se abre si cambia algo que frena (cemento, áridos o aditivo por material). Solo agua →
 * `receta_agua`; el mismo material en otra salida → `receta_salida`; nombre u orden → `receta_datos`.
 */
export async function guardarRecetasLeidas(puesto: Puesto, recetas: RecetaPlanta[], leidaAt: string, usuario?: string | null) {
  const sb = sbServicio()
  const leida = leidaAt
  const limpias = limpiarRecetas(puesto, recetas)
  const real = puesto.sistema === "indumix"
  const ctx0 = real ? await contextoServidor(puesto) : null
  const { data: act } = await sb.from("recetas_planta_actual").select("*").eq("puesto_id", puesto.id)
  const actuales = new Map(((act || []) as Record<string, unknown>[]).map((x) => { const rl = aRecetaLeida(x); return [rl.numero, rl] as const }))
  let nuevas = 0, cambios = 0
  const eventos: { numero: number; tipo: string }[] = []
  /** Con el puesto real, ¿el cambio abre alerta? Si no, queda el evento. */
  const avisaCambio = async (ant: RecetaPlanta, rec: RecetaPlanta, versionId: string) => {
    if (!real || !ctx0) return true
    const c = clasificarCambioReceta(ant, rec, ctx0.salidas)
    if (c === "frena") return true
    if (c !== "igual") {
      const tipo = EVENTO_CAMBIO[c]
      eventos.push({ numero: rec.numero, tipo })
      await registrarEvento({ carga_id: null, puesto_id: puesto.id, tipo, at: leida, usuario: usuario ?? null, detalle: { numero: rec.numero, diferencias: diferenciasReceta(ant, rec), anterior_id: (ant as { id?: string }).id ?? null, version_id: versionId } })
    }
    return false
  }
  for (const rec of limpias) {
    const numero = rec.numero
    const huella = huellaReceta(rec)
    const ant = actuales.get(numero) || null
    const { data: ya } = await sb.from("recetas_planta").select("id").eq("puesto_id", puesto.id).eq("numero", numero).eq("huella", huella).limit(1)
    if (ya?.length) {
      await sb.from("recetas_planta").update({ ultima_lectura_at: leida }).eq("id", ya[0].id)
      if (ant && ant.huella === huella) continue
    } else {
      const { data: ins, error: e } = await sb.from("recetas_planta").insert({ puesto_id: puesto.id, numero, nombre: rec.nombre, habilitada: rec.habilitada, valores: rec.salidas, huella, primera_lectura_at: leida, ultima_lectura_at: leida }).select("id").single()
      if (e) throw e
      nuevas++
      if (!ant && !rec.salidas.some((x) => x.valor > 0)) continue // una vacía que aparece por primera vez no avisa
      if (ant && !(await avisaCambio(ant, rec, ins.id))) continue
      const dif = diferenciasReceta(ant, rec)
      await sb.from("alertas_carga").insert({
        puesto_id: puesto.id, tipo: ant ? "receta_cambiada" : "receta_nueva", receta_numero: numero, receta_planta_id: ins.id,
        titulo: ant ? `La receta ${numero} cambió en Indumix entre ${hhmmAR(ant.ultima_lectura_at)} y ${hhmmAR(leida)}` : `Receta ${numero} leída por primera vez («${rec.nombre || "sin nombre"}»)`,
        detalle: { diferencias: dif, anterior_id: ant?.id ?? null, simulada: puesto.sistema === "simulador", nota: "Indumix no dice quién la cambió. Se guardó la versión anterior." },
        estado: ant ? "abierta" : "cerrada_sola",
      })
      if (ant) cambios++
      continue
    }
    // Volvió a una versión que ya se había leído antes (A → B → A): también es un cambio
    if (ant && ant.huella !== huella) {
      if (!(await avisaCambio(ant, rec, ya![0].id))) continue
      await sb.from("alertas_carga").insert({
        puesto_id: puesto.id, tipo: "receta_cambiada", receta_numero: numero, receta_planta_id: ya![0].id,
        titulo: `La receta ${numero} cambió en Indumix entre ${hhmmAR(ant.ultima_lectura_at)} y ${hhmmAR(leida)}`,
        detalle: { diferencias: diferenciasReceta(ant, rec), anterior_id: ant.id, simulada: puesto.sistema === "simulador" },
      })
      cambios++
    }
  }
  const ctx = await contextoServidor(puesto)
  const alertas = await sincronizarAlertasReceta(ctx, leida)
  const recalculadas = await recalcularBloqueos(ctx)
  return { nuevas, cambios, eventos, alertas, recalculadas }
}

export type MaterialReporte = { salida: Salida; material_id: string | null; receta_por_m3?: number | null; teorico?: number | null; humedad_pct?: number | null; teorico_corregido?: number | null; real?: number | null; extra?: number | null; unidad?: string | null }

export type EntradaReporte = {
  reporte: ReportePlanta
  materiales: MaterialReporte[]
  inicio_at: unknown
  fin_at: unknown
  dia_planta: string | null
  hora_estimada: boolean
  pedido: string | null
  /**
   * Puente real: las horas vienen de horaReal (el reloj de Indumix con su deriva) o de lo que vio el puente, y valen tal
   * cual aunque sean viejas (no se recortan a "ahora"). Con la hora estimada no se une por camión y hora, solo por remito.
   */
  horas_del_puente?: boolean
  /** solo puesto real: nota de la carga (carga corta) y datos que se suman al evento "reporte" */
  nota?: string | null
  detalle?: Record<string, unknown> | null
}

/**
 * Una carga que el puente vio en la planta SIN una orden nuestra (el cuerpo de /api/carga/indumix, 5.7 y 19.8). La une
 * el emparejador (19.2):
 *  1. con una orden de la cola, por el remito en "Observación" o por camión y hora → "Ya cargada en Indumix";
 *  2. si no, con un despacho de la planta de las últimas 12 h sin carga, igual;
 *  3. si no, queda como carga "desde Indumix" sin remito, con su alerta.
 * Con el puesto real en solo lectura todas las cargas son "desde Indumix": si se une a un remito no hay alerta, y si no,
 * la alerta es "Carga N° 5 sin remito (Observación vacía)".
 */
export async function registrarReporte(puesto: Puesto, d: EntradaReporte, usuario: string): Promise<{ ok: true; duplicado?: boolean; carga_id?: string; union?: string | null; ya_cargada?: boolean }> {
  const sb = sbServicio()
  const pedido = d.pedido
  if (await yaProcesado(pedido)) return { ok: true, duplicado: true }
  const rep = d.reporte
  const hora = d.horas_del_puente ? horaExacta : horaPuente
  const fin = hora(d.fin_at)
  const ini = hora(d.inicio_at || d.fin_at)
  const soloRemito = !!d.horas_del_puente && d.hora_estimada
  const finMs = new Date(fin).getTime()
  const desde = new Date(finMs - 12 * 3600_000).toISOString()
  const lectura = puesto.sistema === "indumix" && puesto.etapa === "lectura"

  // 1. Órdenes de la cola
  const { data: cola } = await sb.from("cargas").select("id, remito, remito_tipo, patente_planta, created_at, dispatch_id, m3").eq("puesto_id", puesto.id).in("estado", ["pendiente", "bloqueada", "lista"]).gte("created_at", desde)
  const candCola: Candidato[] = ((cola || []) as any[]).map((c) => ({ id: c.id, remito: c.remito, tipo: c.remito_tipo, patente: c.patente_planta, at: new Date(c.created_at).getTime() }))
  const enCola = emparejar({ observacion: rep.observacion, patente: rep.camion, fin: finMs }, candCola, { soloRemito })
  // 2. Despachos de la planta sin carga
  let enDesp: ReturnType<typeof emparejar> = null
  let desp: any = null
  if (!enCola) {
    const { data: ds } = await sb.from("dispatches").select("id, remito, remito_tipo, created_at, mixer_id, formula_id, scheduled_dispatch_id, quantity_m3, mixers(license_plate)").eq("plant_id", puesto.plant_id).gte("created_at", desde).eq("is_test_dispatch", false)
    const ids = ((ds || []) as any[]).map((x) => x.id)
    const { data: conCarga } = ids.length ? await sb.from("cargas").select("dispatch_id").in("dispatch_id", ids) : { data: [] }
    const usados = new Set(((conCarga || []) as any[]).map((x) => x.dispatch_id))
    const libres = ((ds || []) as any[]).filter((x) => !usados.has(x.id))
    enDesp = emparejar({ observacion: rep.observacion, patente: rep.camion, fin: finMs }, libres.map((x) => ({ id: x.id, remito: x.remito, tipo: x.remito_tipo, patente: x.mixers?.license_plate || null, at: new Date(x.created_at).getTime() })), { soloRemito })
    desp = enDesp ? libres.find((x) => x.id === enDesp!.id) : null
  }

  const datosCarga = {
    contador_planta: Number(rep.numero), inicio_plc: String(rep.inicio_plc || "").slice(0, 40), fin_plc: String(rep.fin_plc || "").slice(0, 40), dia_planta: d.dia_planta || null,
    inicio_at: ini, fin_at: fin, m3_cargados: Number(rep.m3_cargados) || Number(rep.m3) || null, ciclos: Number(rep.ciclos) || null, receta_numero: Number(rep.receta) || null,
    patente_planta: String(rep.camion || "").slice(0, 20), cliente_planta: String(rep.cliente || "").slice(0, 20), observacion_planta: String(rep.observacion || "").slice(0, 30),
    hora_estimada: d.hora_estimada === true,
    ...(d.nota ? { nota: d.nota } : {}),
  }
  let cargaId: string
  let titulo: string
  if (enCola) {
    cargaId = enCola.id
    await sb.from("cargas").update({ ...datosCarga, estado: "ya_cargada_indumix", union_remito: enCola.union }).eq("id", cargaId)
    titulo = `La orden del remito ${(cola || []).find((c: any) => c.id === cargaId)?.remito || ""} ya se cargó en Indumix (N° ${rep.numero}): no se vuelve a cargar`
  } else {
    const { data: n, error: e } = await sb.from("cargas").insert({
      ...datosCarga, puesto_id: puesto.id, plant_id: puesto.plant_id, estado: "leida", origen: "indumix", m3: Number(rep.m3) || null,
      dispatch_id: desp?.id ?? null, pedido_id: desp?.scheduled_dispatch_id ?? null, remito: desp?.remito ?? null, remito_tipo: desp?.remito_tipo ?? null,
      mixer_id: desp?.mixer_id ?? null, formula_id: desp?.formula_id ?? null, union_remito: enDesp?.union ?? null, created_by: usuario,
    }).select("id").single()
    if (e) {
      if ((e as { code?: string }).code === "23505") return { ok: true, duplicado: true }
      throw e
    }
    cargaId = n.id
    titulo = desp ? `Carga hecha desde Indumix (N° ${rep.numero}) unida al remito ${desp.remito || ""} ${enDesp!.union}` : `Carga hecha desde Indumix, sin pasar por el sistema (N° ${rep.numero})`
  }
  const filas = (d.materiales || []).filter((m) => SALIDAS.includes(m.salida)).map((m) => ({
    carga_id: cargaId, ciclo: 0, salida: m.salida, material_id: m.material_id || null, receta_por_m3: m.receta_por_m3 ?? null, teorico: m.teorico ?? null,
    humedad_pct: m.humedad_pct ?? null, teorico_corregido: m.teorico_corregido ?? null, real: m.real ?? null, extra: m.extra ?? 0, unidad: m.unidad || null,
  }))
  if (filas.length) await sb.from("cargas_materiales").upsert(filas, { onConflict: "carga_id,ciclo,salida" })
  const conDesvio = filas.some((f) => desvio({ grupo: grupoDeSalida(f.salida), teorico_corregido: f.teorico_corregido, real: f.real }, puesto.tolerancias.pesaje))
  await sb.from("cargas").update({ estado_auditoria: conDesvio ? "con_desvios" : "ok" }).eq("id", cargaId)
  for (const x of rep.extras || []) {
    if (Number(x.litros) > 0) await sb.from("cargas_agua_extra").insert({ carga_id: cargaId, dispatch_id: desp?.id ?? null, at: fin, litros: Number(x.litros), despues_de_terminar: !!x.despues_de_terminar, origen: "indumix_reporte" })
  }
  const union = enCola?.union || enDesp?.union || null
  await registrarEvento({ carga_id: cargaId, puesto_id: puesto.id, tipo: "reporte", at: fin, detalle: { numero: rep.numero, camion: rep.camion, observacion: rep.observacion, union, ...(d.detalle || {}) }, usuario, pedido })
  const unida = !!(enCola || desp)
  if (!lectura || !unida) {
    await sb.from("alertas_carga").insert({
      puesto_id: puesto.id, tipo: "carga_desde_indumix", carga_id: cargaId, receta_numero: Number(rep.receta) || null,
      titulo: lectura ? `Carga N° ${rep.numero} sin remito (${rep.observacion ? `Observación «${rep.observacion}» sin despacho` : "Observación vacía"})` : titulo,
      detalle: { camion: rep.camion, patente: normalizarPatente(rep.camion), observacion: rep.observacion, m3: rep.m3, hora: hhmmAR(fin), simulada: puesto.sistema === "simulador" },
      estado: unida ? "cerrada_sola" : "abierta",
    })
  }
  return { ok: true, carga_id: cargaId, union, ya_cargada: !!enCola }
}

const FROM = process.env.REPORTE_CALIDAD_FROM || "reportes@produccionrebucret.com"
/** A quién va el mail de "despacho con la carga frenada" (20.1): Juan Oreguy. */
export const AVISO_FRENADA_A = ["Juan Oreguy"]

const esc = (t: unknown) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!))

/**
 * Mail (Resend, como app/api/alertas/stock-cero) cuando se despacha igual un viaje cuya receta frena la carga.
 * Nunca corta la operación: devuelve a quién se mandó o por qué no.
 */
export async function mailDespachoFrenado(d: {
  simulada: boolean; planta: string; remito: string; camion: string; formula: string; receta: number | null; motivo: string; items: { texto: string; ok: boolean; aviso?: boolean }[]; por: string
}): Promise<{ enviado: boolean; a: string[]; motivo?: string }> {
  try {
    const sb = sbServicio()
    const { data } = await sb.from("app_users").select("name, email").eq("active", true).not("email", "is", null)
    const a = ((data || []) as { name: string; email: string }[]).filter((u) => AVISO_FRENADA_A.some((n) => n.toLowerCase() === u.name.trim().toLowerCase())).map((u) => u.email)
    if (!a.length) return { enviado: false, a, motivo: "Juan Oreguy no tiene mail cargado" }
    if (!process.env.RESEND_API_KEY) return { enviado: false, a, motivo: "falta RESEND_API_KEY" }
    const sim = d.simulada ? "[PLANTA SIMULADA] " : ""
    const titulo = `${sim}Despacho con la carga frenada: ${d.formula} · remito ${d.remito}`
    const filas = d.items.filter((i) => !i.ok || i.aviso).map((i) => `<li style="margin:3px 0;color:${i.ok ? "#92400e" : "#b91c1c"}">${esc(i.texto)}</li>`).join("")
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
        <div style="background:#b91c1c;color:#fff;padding:14px 18px;border-radius:8px 8px 0 0">
          <div style="font-size:15px;font-weight:700">${esc(titulo)}</div>
          <div style="opacity:.85;font-size:12px;margin-top:2px">Se despachó igual: la carga va a quedar frenada en la planta hasta que se resuelva</div>
        </div>
        <div style="border:1px solid #e2e8f0;border-top:none;padding:14px 18px;border-radius:0 0 8px 8px;font-size:13px">
          ${d.simulada ? `<p style="background:#fef3c7;padding:6px 8px;border-radius:6px;color:#78350f;margin:0 0 10px"><b>Planta simulada</b>: es una prueba de la pantalla de carga, no mueve la planta real.</p>` : ""}
          <p style="margin:0 0 6px"><b>Planta:</b> ${esc(d.planta)} · <b>Remito:</b> ${esc(d.remito)} · <b>Camión:</b> ${esc(d.camion)}</p>
          <p style="margin:0 0 6px"><b>Fórmula:</b> ${esc(d.formula)} · <b>Receta de la planta:</b> ${d.receta ?? "sin receta"}</p>
          <p style="margin:0 0 4px"><b>Qué no coincide:</b></p>
          <ul style="margin:0 0 8px;padding-left:18px">${filas || `<li>${esc(d.motivo)}</li>`}</ul>
          <p style="margin:0">Despachó: ${esc(d.por)} · ${hhmmAR()}. Se resuelve desde Carga de planta › Alertas (Fórmulas · editar).</p>
          <p style="font-size:11px;color:#94a3b8;margin-top:14px">produccionrebucret.com</p>
        </div>
      </div>`
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: `Rebucret - Alertas <${FROM}>`, to: a, subject: `Rebucret · ${titulo}`, html }),
    })
    if (!r.ok) return { enviado: false, a, motivo: `Resend respondió ${r.status}` }
    return { enviado: true, a }
  } catch (e) {
    return { enviado: false, a: [], motivo: (e as Error)?.message || "no se pudo mandar" }
  }
}
