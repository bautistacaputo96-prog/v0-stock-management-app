/**
 * Puente real de Indumix · lado servidor (SOLO servidor). Especificación: docs/specs/2026-11-05-puente-indumix.md, 2.
 *
 * - La clave del puente: `rbp_` + 32 bytes al azar. En la base queda solo el sha256 (puestos_carga_credenciales, que el
 *   navegador no puede leer). Con la clave se identifica el puesto; no hay persona ni sesión.
 * - El puente sube variables crudas; acá se interpretan (lib/carga/indumix.ts) y se reusa la lógica de las rutas de hoy
 *   (guardarRecetasLeidas y registrarReporte de lib/carga/servidor.ts).
 * - Nada de esto escribe en la planta: la fase 1 es solo lectura.
 */
import { createHash, randomBytes } from "node:crypto"
import { sbServicio } from "@/lib/auth/servidor"
import { aPuesto, cargarFormulas, materialesDeReporte, type Puesto } from "@/lib/carga/datos"
import {
  CADENCIAS, DIAS_MUESTREO_CRUDO, RUIDO, VARIABLES, claveSinMaterial,
  controlHumedad, controlTolva1, derivaSegundos, estadoDesdeVariables, horaReal, huecosContador, recetaDeReporteDistinta,
  recetaDesdeVariables, reporteDesdeVariables, textoPerdidas,
  type Variables, type Visto,
} from "@/lib/carga/indumix"
import { contextoServidor, guardarRecetasLeidas, hhmmAR, horaPuente, registrarEvento, registrarReporte } from "@/lib/carga/servidor"
import { nf, type EstadoVivo, type RecetaPlanta } from "@/lib/carga/tipos"

// ───────────────────────────── Clave ─────────────────────────────

export const hashClave = (clave: string) => createHash("sha256").update(clave, "utf8").digest("hex")
export const generarClave = () => `rbp_${randomBytes(32).toString("base64url")}`

/** La clave del encabezado `Authorization: Bearer …` (null si no viene). */
export function claveDe(req: Request): string | null {
  const m = (req.headers.get("authorization") || "").match(/^Bearer\s+(\S+)$/i)
  return m ? m[1] : null
}

export type ResultadoClave = { puesto: Puesto } | { status: 409; error: string } | null

/**
 * ¿De qué puesto es esta clave? null = no existe (401). Si el puesto no es Indumix, está inactivo o apagado: 409
 * ("Puesto apagado"; el puente queda quieto y vuelve a probar cada 5 min). `buscar` recibe el sha256 y devuelve la fila
 * de puestos_carga (se pasa aparte para probarlo sin base).
 */
export async function verificarClave(clave: string | null, buscar: (hash: string) => Promise<Record<string, unknown> | null>): Promise<ResultadoClave> {
  if (!clave || !/^rbp_[A-Za-z0-9_-]{20,}$/.test(clave)) return null
  const fila = await buscar(hashClave(clave))
  if (!fila) return null
  const puesto = aPuesto(fila)
  if (puesto.sistema !== "indumix" || !puesto.activo || puesto.etapa === "apagado") return { status: 409, error: "Puesto apagado" }
  return { puesto }
}

/** Busca el puesto por el hash de su clave (con la clave de servicio). */
export async function buscarPorHash(hash: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await sbServicio().from("puestos_carga_credenciales").select("puesto_id, puestos_carga(*)").eq("hash", hash).maybeSingle()
  if (error || !data) return null
  const p = (data as { puestos_carga?: Record<string, unknown> | Record<string, unknown>[] | null }).puestos_carga
  return (Array.isArray(p) ? p[0] : p) || null
}

/** "Puente Canning" (el usuario que queda registrado en lo que sube el puente). */
export const usuarioPuente = (p: Puesto) => `Puente ${p.nombre.split("·")[0].trim() || "planta"}`

// ───────────────────────────── Config (GET) ─────────────────────────────

export function configPuente(p: Puesto, ahora = Date.now()) {
  const primer = p.info_planta?.primer_latido_at ? Date.parse(String(p.info_planta.primer_latido_at)) : ahora
  return {
    ok: true,
    puesto: { id: p.id, nombre: p.nombre, etapa: p.etapa },
    variables: VARIABLES,
    ruido: RUIDO,
    cadencias: CADENCIAS,
    muestrear_crudo_hasta: new Date((Number.isFinite(primer) ? primer : ahora) + DIAS_MUESTREO_CRUDO * 86400_000).toISOString(),
    hora_servidor: new Date(ahora).toISOString(),
  }
}

// ───────────────────────────── Ayudas ─────────────────────────────

const diaAR = (ms: number) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" })
const inicioDiaAR = (dia: string) => `${dia}T03:00:00.000Z`
const minutosAR = (ms: number) => { const [h, m] = hhmmAR(ms).split(":").map(Number); return h * 60 + m }
const vars = (x: unknown): Variables => (x && typeof x === "object" && !Array.isArray(x) ? (x as Variables) : {})
const corto = (t: unknown, n: number) => (typeof t === "string" ? t.slice(0, n) : null)

async function cerrarAlerta(id: string, motivo: string) {
  await sbServicio().from("alertas_carga").update({ estado: "cerrada_sola", resuelta_at: new Date().toISOString(), motivo, updated_at: new Date().toISOString() }).eq("id", id)
}

// ───────────────────────────── Latido ─────────────────────────────

export async function procesarLatido(p: Puesto, b: { variables: Variables; at: string; version: string | null; puente?: unknown }) {
  const sb = sbServicio()
  const ev: EstadoVivo = estadoDesdeVariables(b.variables, b.at)
  const pu = (b.puente && typeof b.puente === "object" ? b.puente : {}) as Record<string, unknown>
  ev.puente = { mediana_ms: Number.isFinite(Number(pu.mediana_ms)) ? Number(pu.mediana_ms) : null, lento: pu.lento === true, cola: Number.isFinite(Number(pu.cola)) ? Number(pu.cola) : null }
  const ant = p.estado_vivo
  const ahora = Date.now()
  const deriva = derivaSegundos(ev.reloj_plc, Date.parse(b.at))
  const info: Record<string, unknown> = { ...(p.info_planta || {}), nombres: ev.nombres }
  if (!info.primer_latido_at) info.primer_latido_at = new Date(ahora).toISOString()
  const humedadCambio = !!ant && (ant.humedades?.[2] ?? null) !== (ev.humedades[2] ?? null)
  const arranco = !!ev.en_ciclo && !ant?.en_ciclo
  const ultimoCtl = info.ctl_humedad_at ? Date.parse(String(info.ctl_humedad_at)) : 0
  const tocaHumedad = humedadCambio || arranco || !(ahora - ultimoCtl < 10 * 60_000)
  if (tocaHumedad) info.ctl_humedad_at = new Date(ahora).toISOString()
  const { error } = await sb.from("puestos_carga").update({
    estado_vivo: ev, ultimo_latido_at: new Date(ahora).toISOString(), version_puente: b.version, deriva_reloj_s: deriva, info_planta: info,
  }).eq("id", p.id)
  if (error) throw error

  if (p.deriva_reloj_s != null && deriva != null && Math.abs(deriva - p.deriva_reloj_s) > 120)
    await registrarEvento({ carga_id: null, puesto_id: p.id, tipo: "reloj", at: b.at, detalle: { antes_s: p.deriva_reloj_s, ahora_s: deriva, reloj_plc: ev.reloj_plc } })
  const codigos = (e: EstadoVivo | null) => (e?.alarmas || []).map((a) => a.codigo).sort().join(",")
  if (codigos(ant) !== codigos(ev)) {
    if (ev.alarmas.length) await registrarEvento({ carga_id: null, puesto_id: p.id, tipo: "alarma", at: b.at, detalle: { alarmas: ev.alarmas } })
    else await registrarEvento({ carga_id: null, puesto_id: p.id, tipo: "alarma_fin", at: b.at, detalle: { antes: ant?.alarmas || [] } })
  }
  if (humedadCambio) await registrarEvento({ carga_id: null, puesto_id: p.id, tipo: "humedad", at: b.at, detalle: { antes: ant?.humedades || null, ahora: ev.humedades } })
  if (tocaHumedad) await controlarHumedad(p, ev)
  if (ev.receta != null && ev.receta !== (ant?.receta ?? null)) await controlarTolva(p, ev)
  return { ok: true }
}

/** H1 y H2 del punto 6: una alerta `humedad` abierta por día como mucho; se cierra sola. */
async function controlarHumedad(p: Puesto, ev: EstadoVivo) {
  const sb = sbServicio()
  const ahora = Date.now()
  const hoy = diaAR(ahora)
  const { data: af } = await sb.from("materials").select("id").eq("plant_id", p.plant_id).eq("name", "Arena Fina").limit(1)
  const arena = (af as { id: string }[] | null)?.[0]?.id
  if (!arena) return
  const [med, cargas, ultimoCambio, abiertas, programados] = await Promise.all([
    sb.from("daily_stockpile_humidity").select("humidity_percent, created_at").eq("material_id", arena).eq("reading_date", hoy).order("created_at", { ascending: false }).limit(1),
    sb.from("cargas").select("id").eq("puesto_id", p.id).gte("created_at", inicioDiaAR(hoy)).limit(1),
    sb.from("cargas_eventos").select("at").eq("puesto_id", p.id).eq("tipo", "humedad").order("at", { ascending: false }).limit(1),
    sb.from("alertas_carga").select("id, titulo, detalle, created_at").eq("puesto_id", p.id).eq("tipo", "humedad").eq("estado", "abierta"),
    // H1 solo los días con despachos programados en la planta
    sb.from("scheduled_dispatches").select("id").eq("plant_id", p.plant_id).gte("scheduled_arrival_time", inicioDiaAR(hoy))
      .lt("scheduled_arrival_time", new Date(Date.parse(inicioDiaAR(hoy)) + 86400_000).toISOString()).neq("status", "cancelled").limit(1),
  ])
  const m = (med.data as { humidity_percent: number; created_at: string }[] | null)?.[0]
  const ult = (ultimoCambio.data as { at: string }[] | null)?.[0]?.at
  const r = controlHumedad({
    indumix: ev.humedades[2] ?? null,
    medida: m ? { pct: Number(m.humidity_percent), hhmm: hhmmAR(m.created_at) } : null,
    minutos: minutosAR(ahora),
    cargoHoy: !!ev.en_ciclo || !!(cargas.data as unknown[] | null)?.length,
    sinCambioDesdeAyer: !!ult && ult < inicioDiaAR(hoy),
    diaConDespachos: !!(programados.data as unknown[] | null)?.length,
  })
  const lista = (abiertas.data || []) as { id: string; titulo: string; detalle: { regla?: string; dia?: string } | null; created_at: string }[]
  for (const a of lista.filter((x) => (x.detalle?.dia || diaAR(Date.parse(x.created_at))) !== hoy)) await cerrarAlerta(a.id, "Era de otro día")
  const deHoy = lista.find((x) => (x.detalle?.dia || diaAR(Date.parse(x.created_at))) === hoy) || null
  if (r.regla) {
    const detalle = { regla: r.regla, dia: hoy, indumix: ev.humedades[2] ?? null, medida: m ? Number(m.humidity_percent) : null }
    if (deHoy) {
      if (deHoy.titulo !== r.texto) await sb.from("alertas_carga").update({ titulo: r.texto, detalle, updated_at: new Date().toISOString() }).eq("id", deHoy.id)
    } else {
      // como mucho una por día: si ya hubo una hoy (cerrada), se reabre esa
      const { data: hoyCerr } = await sb.from("alertas_carga").select("id").eq("puesto_id", p.id).eq("tipo", "humedad").gte("created_at", inicioDiaAR(hoy)).limit(1)
      const id = (hoyCerr as { id: string }[] | null)?.[0]?.id
      if (id) await sb.from("alertas_carga").update({ estado: "abierta", titulo: r.texto, detalle, resuelta_at: null, motivo: null, updated_at: new Date().toISOString() }).eq("id", id)
      else await sb.from("alertas_carga").insert({ puesto_id: p.id, tipo: "humedad", titulo: r.texto, detalle })
    }
  } else if (deHoy) {
    await cerrarAlerta(deHoy.id, deHoy.detalle?.regla === "H1" ? "Se cargó la humedad de hoy" : "La humedad de Indumix volvió a estar cerca de la medida")
  }
}

/** Tolva 1 del punto 6: al cambiar la receta elegida, ¿la piedra que pide es la de la última carga? */
async function controlarTolva(p: Puesto, ev: EstadoVivo) {
  const sb = sbServicio()
  const ctx = await contextoServidor(p)
  const salida = ctx.salidas.find((s) => s.alternativas?.length) || null
  if (!salida) return
  const fila = ctx.salidasFilas.find((s) => s.salida === salida.salida)
  const receta = ctx.recetas.find((r) => r.numero === ev.receta) || null
  const asig = ctx.asignaciones.find((a) => a.numero === ev.receta)
  const formula = asig?.formula_id ? (await cargarFormulas(sb, [asig.formula_id]))[0] || null : null
  // La última carga leída que pesó en esa tolva, salvo que después se haya cambiado la tolva a mano
  const { data: ult } = await sb.from("cargas").select("id, fin_at, cargas_materiales(salida, material_id, real)").eq("puesto_id", p.id).eq("simulada", false).not("fin_at", "is", null).order("fin_at", { ascending: false }).limit(5)
  let ultimo = salida.material_id
  for (const c of (ult || []) as { fin_at: string; cargas_materiales: { salida: string; material_id: string | null; real: number | null }[] }[]) {
    const m = c.cargas_materiales?.find((x) => x.salida === salida.salida && Number(x.real) > 0)
    if (!m) continue
    if (!fila?.vigente_desde || c.fin_at > fila.vigente_desde) ultimo = m.material_id
    break
  }
  const r = controlTolva1({ numero: ev.receta!, receta: receta ? { ...receta, nombre: receta.nombre || ev.receta_nombre } : null, formula, salida, materiales: ctx.materiales, ultimo })
  const { data: ab } = await sb.from("alertas_carga").select("id, detalle").eq("puesto_id", p.id).eq("tipo", "tolva_material").eq("estado", "abierta")
  const abiertas = (ab || []) as { id: string; detalle: { lleva?: string } | null }[]
  if (r.aviso) {
    if (abiertas.some((a) => a.detalle?.lleva === r.lleva)) return
    for (const a of abiertas) await cerrarAlerta(a.id, "Cambió la receta elegida")
    const nombre = (id: string | null) => ctx.materiales.find((m) => m.id === id)?.name || null
    await sb.from("alertas_carga").insert({
      puesto_id: p.id, tipo: "tolva_material", receta_numero: ev.receta, titulo: r.texto,
      detalle: { salida: salida.salida, lleva: r.lleva, lleva_nombre: nombre(r.lleva), ultimo, ultimo_nombre: nombre(ultimo), receta_nombre: ev.receta_nombre },
    })
  } else {
    for (const a of abiertas) await cerrarAlerta(a.id, `La receta ${ev.receta} lleva la piedra de la última carga`)
  }
}

// ───────────────────────────── Reportes ─────────────────────────────

export async function procesarReportes(p: Puesto, b: { reportes: unknown; at: string; pedido: string | null }) {
  const sb = sbServicio()
  const lista = (Array.isArray(b.reportes) ? b.reportes : []).slice(0, 12) as { slot?: number; variables?: unknown; visto?: Visto | null }[]
  const ctx = await contextoServidor(p)
  const usuario = usuarioPuente(p)
  const leerRecetas = new Set<number>()
  const dias = new Set<string>()
  const resultados: Record<string, unknown>[] = []
  for (const x of lista) {
    const L = reporteDesdeVariables(vars(x.variables), x.visto || null)
    const rep = L.reporte
    if (!(rep.numero > 0)) { resultados.push({ slot: x.slot, ignorado: "sin número" }); continue }
    const visto = x.visto || null
    const fin = visto?.fin_at || (horaReal(rep.fin_plc, p.deriva_reloj_s) != null ? new Date(horaReal(rep.fin_plc, p.deriva_reloj_s)!).toISOString() : null)
    const ini = visto?.inicio_at || (horaReal(rep.inicio_plc, p.deriva_reloj_s) != null ? new Date(horaReal(rep.inicio_plc, p.deriva_reloj_s)!).toISOString() : null)
    const dia = L.dia_planta || (ini ? diaAR(Date.parse(ini)) : null)
    if (dia) dias.add(dia)
    if (L.sinMaterial) {
      // Arranque cortado (los dos N° 8 del 03/11): no se crea carga, así no chocan
      const nuevo = await registrarEvento({
        carga_id: null, puesto_id: p.id, tipo: "carga_sin_material", at: horaPuente(fin || b.at), usuario,
        detalle: { numero: rep.numero, dia_planta: dia, inicio_plc: rep.inicio_plc, camion: rep.camion, observacion: rep.observacion, receta: rep.receta, slot: x.slot ?? null },
        pedido: claveSinMaterial(p.id, dia, rep),
      })
      resultados.push({ slot: x.slot, numero: rep.numero, sin_material: true, duplicado: !nuevo })
      continue
    }
    const { data: ya } = await sb.from("cargas").select("id").eq("puesto_id", p.id).eq("contador_planta", rep.numero).eq("inicio_plc", rep.inicio_plc.slice(0, 40)).limit(1)
    if ((ya as unknown[] | null)?.length) { resultados.push({ slot: x.slot, numero: rep.numero, duplicado: true }); continue }
    // Solo con un reporte nuevo: si su receta por m³ no es la última versión guardada, el puente vuelve a leer esa receta
    if (rep.receta >= 1 && rep.receta <= p.max_recetas && recetaDeReporteDistinta(rep, ctx.recetas.find((r) => r.numero === rep.receta) || null)) leerRecetas.add(rep.receta)
    const nota = rep.parada
      ? `Carga corta: cemento ${nf(L.cemento.real)} de ${nf(L.cemento.teorico)} kg (${L.cemento.pct != null ? nf(L.cemento.pct * 100, 0) : "—"} %) · ${nf(rep.m3_cargados, 1)} m³ estimados`
      : null
    const res = await registrarReporte(p, {
      reporte: rep, materiales: materialesDeReporte(rep, ctx.salidas, null),
      inicio_at: ini || b.at, fin_at: fin || b.at, dia_planta: dia, hora_estimada: !visto?.fin_at, horas_del_puente: true, pedido: b.pedido ? `${b.pedido}:${x.slot ?? rep.numero}`.slice(0, 80) : null,
      nota, detalle: { slot: x.slot ?? null, m3_estimado: L.m3_estimado, corta: rep.parada, sin_humedad: L.sin_humedad, cemento_pct: L.cemento.pct, receta_nombre: rep.receta_nombre },
    }, usuario)
    resultados.push({ slot: x.slot, numero: rep.numero, ...res })
  }
  // Huecos del contador (Indumix guarda solo los 10 últimos)
  for (const dia of dias) {
    const [cg, sm] = await Promise.all([
      sb.from("cargas").select("contador_planta").eq("puesto_id", p.id).eq("dia_planta", dia).not("contador_planta", "is", null),
      sb.from("cargas_eventos").select("detalle").eq("puesto_id", p.id).eq("tipo", "carga_sin_material").eq("detalle->>dia_planta", dia),
    ])
    const numeros = [
      ...((cg.data || []) as { contador_planta: number }[]).map((c) => Number(c.contador_planta)),
      ...((sm.data || []) as { detalle: { numero?: number } | null }[]).map((e) => Number(e.detalle?.numero)),
    ]
    const faltan = huecosContador(numeros)
    if (faltan.length) await registrarEvento({ carga_id: null, puesto_id: p.id, tipo: "cargas_perdidas", at: horaPuente(b.at), usuario, detalle: { dia_planta: dia, faltan, texto: textoPerdidas(faltan) }, pedido: `perdidas:${p.id}:${dia}:${faltan.join(",")}`.slice(0, 200) })
  }
  return { ok: true, resultados, leer_recetas: [...leerRecetas] }
}

// ───────────────────────────── Recetas ─────────────────────────────

export async function procesarRecetas(p: Puesto, b: { recetas: unknown; at: string }) {
  const lista = (Array.isArray(b.recetas) ? b.recetas : []).slice(0, p.max_recetas) as { numero?: number; variables?: unknown }[]
  const recetas = lista.map((x) => recetaDesdeVariables(Number(x.numero), vars(x.variables))).filter((r): r is RecetaPlanta => !!r && r.numero >= 1 && r.numero <= p.max_recetas)
  if (!recetas.length) return { ok: true, nuevas: 0, cambios: 0 }
  const r = await guardarRecetasLeidas(p, recetas, b.at, usuarioPuente(p))
  return { ok: true, nuevas: r.nuevas, cambios: r.cambios, eventos: r.eventos.length }
}

// ───────────────────────────── Despacho por tipo ─────────────────────────────

const TIPO_EVENTO = /^[a-z][a-z0-9_]{1,39}$/

/** POST del puente: {tipo, at, version, pedido, ...}. Devuelve el cuerpo de la respuesta y el estado HTTP. */
export async function procesarPuente(p: Puesto, body: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
  const tipo = String(body.tipo || "")
  const at = horaPuente(body.at)
  const version = corto(body.version, 40)
  const pedido = corto(body.pedido, 80)
  if (version && version !== p.version_puente && tipo !== "latido") await sbServicio().from("puestos_carga").update({ version_puente: version }).eq("id", p.id)
  switch (tipo) {
    case "latido":
      return { status: 200, json: await procesarLatido(p, { variables: vars(body.variables), at, version, puente: body.puente }) }
    case "reportes":
      return { status: 200, json: await procesarReportes(p, { reportes: body.reportes, at, pedido }) }
    case "recetas":
      return { status: 200, json: await procesarRecetas(p, { recetas: body.recetas, at }) }
    case "totales": {
      const nuevo = await registrarEvento({ carga_id: null, puesto_id: p.id, tipo: "totales", at, usuario: usuarioPuente(p), detalle: { variables: vars(body.variables) }, pedido })
      return { status: 200, json: { ok: true, ...(nuevo ? {} : { duplicado: true }) } }
    }
    case "eventos": {
      const lista = (Array.isArray(body.eventos) ? body.eventos : []).slice(0, 200) as { tipo?: string; at?: string; detalle?: unknown; pedido?: string }[]
      let dup = 0
      for (const e of lista) {
        const t = String(e.tipo || "")
        if (!TIPO_EVENTO.test(t)) continue
        const d = e.detalle && typeof e.detalle === "object" ? (e.detalle as Record<string, unknown>) : e.detalle == null ? null : { texto: String(e.detalle).slice(0, 500) }
        const nuevo = await registrarEvento({ carga_id: null, puesto_id: p.id, tipo: t, at: horaPuente(e.at || at), usuario: usuarioPuente(p), detalle: d, pedido: corto(e.pedido, 80) })
        if (!nuevo) dup++
      }
      return { status: 200, json: { ok: true, ...(dup && dup === lista.length ? { duplicado: true } : {}) } }
    }
    default:
      return { status: 400, json: { error: "Tipo desconocido." } }
  }
}
