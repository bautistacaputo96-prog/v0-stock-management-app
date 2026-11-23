/**
 * Control cruzado del despacho contra Zomatik · SOLO servidor. Lee FABRICA › REPORTE PRODUCCION (solo lectura: el GET y
 * el POST exacto de la lista cerrada de lib/zomatik/web.ts), guarda la copia y arma la comparación con nuestro sistema.
 *
 * Nunca escribe en Zomatik ni en dispatches, dispatch_materials, stock_*, materials o zomatik_remitos (solo los lee).
 * Escribe solo zomatik_produccion_dia y zomatik_produccion_lectura (clave de servicio).
 * Especificación: docs/specs/2026-11-20-control-cruzado-despacho-zomatik.md (la sección 18 manda).
 *
 * Mismas protecciones que el control de stock: turno del robot y la sucursal 18 confirmada en la MISMA respuesta del
 * reporte (si muestra otra, se reintenta una vez a los 15 s).
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { obtenerSesion, fetchReporteProduccion } from "@/lib/zomatik/cliente"
import { textoError } from "@/lib/zomatik/lectura"
import { nombreArticuloLista } from "@/lib/zomatik/parseo"
import { fechaArgentina, sumarDias } from "@/lib/control-ingresos/cruce"
import { MATERIALES } from "@/lib/control-stock/calculo"
import {
  DIAS_REPORTE,
  MARGEN_REPORTE,
  armarDespacho,
  leerReporteProduccion,
  seccionMailDespacho,
  ventana,
  type DatosDespacho,
  type ResultadoDespacho,
} from "@/lib/control-produccion/calculo"

export const LINK_DESPACHO = "https://www.produccionrebucret.com/materias-primas?tab=control-stock"
export const MENSAJE_FALTA_MIGRACION = "Falta aplicar la migración del control de despacho (202611201500)."
const DEPOSITOS_STOCK = [116, 113]

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))
const esDeSucursal = (e: unknown) => /otra sucursal|no se ve la sucursal/i.test((e as Error)?.message || "")

/** Las tablas nuevas no están (la migración 202611201500 sin aplicar). */
export class FaltaMigracionDespacho extends Error {
  constructor() {
    super(MENSAJE_FALTA_MIGRACION)
    this.name = "FaltaMigracionDespacho"
  }
}
/** ¿El error de Supabase es "no existe la tabla o la función" del control de despacho? */
/** Solo por el código (no por el texto: un 42501 "permission denied for table zomatik_produccion_dia" NO es esto). */
const faltaTabla = (e: any) => ["42P01", "PGRST205", "PGRST202"].includes(String(e?.code ?? ""))

async function todasLasFilas<T>(q: (a: number, b: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; ; i += 1000) {
    const { data, error } = await q(i, i + 999)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return out
}

// ---------------------------------------------------------------------------
// Lectura de Zomatik
// ---------------------------------------------------------------------------

export type ResultadoProduccion = { ok: boolean; desde?: string; celdas?: number; otros?: number; error?: string; faltaMigracion?: boolean; ms: number }

/** Deja el error del último intento sin tocar los datos de la lectura anterior. */
async function anotarError(sb: SupabaseClient, error: string) {
  await sb
    .from("zomatik_produccion_lectura")
    .upsert({ id: 1, intento_at: new Date().toISOString(), error: error.slice(0, 500) }, { onConflict: "id" })
    .then(() => {}, () => {})
}

/**
 * Lee el reporte de producción desde hoy − 9 (16 días: la ventana, hoy y el margen) y lo guarda entero, o no guarda nada
 * (queda la lectura anterior, con el error). `limite`: instante en que hay que dejar de leer.
 */
export async function leerProduccionZomatik(sb: SupabaseClient, opts: { t0: number; limite: number }): Promise<ResultadoProduccion> {
  const hoy = fechaArgentina(opts.t0)
  const desde = sumarDias(hoy, -MARGEN_REPORTE)
  const ms = () => Date.now() - opts.t0
  // Sin la migración no se toca Zomatik
  const previa = await sb.from("zomatik_produccion_lectura").select("id").limit(1)
  if (previa.error) return faltaTabla(previa.error) ? { ok: false, faltaMigracion: true, error: MENSAJE_FALTA_MIGRACION, ms: ms() } : { ok: false, error: textoError(previa.error), ms: ms() }
  const quien = `control-produccion·${opts.t0.toString(36)}`
  let { data, error } = await sb.rpc("zomatik_robot_tomar", { p_quien: quien, p_segundos: 90 })
  const hastaTurno = Math.min(Date.now() + 20_000, opts.limite - 20_000)
  while (!error && data !== true && Date.now() < hastaTurno) {
    await espera(3_000)
    ;({ data, error } = await sb.rpc("zomatik_robot_tomar", { p_quien: quien, p_segundos: 90 }))
  }
  if (error) return { ok: false, error: "Falta la migración del turno de Zomatik (zomatik_robot_tomar)", ms: ms() }
  if (data !== true) {
    await anotarError(sb, "Otro proceso estaba trabajando en Zomatik")
    return { ok: false, error: "Otro proceso estaba trabajando en Zomatik", ms: ms() }
  }
  const renovar = setInterval(() => {
    sb.rpc("zomatik_robot_tomar", { p_quien: quien, p_segundos: 90 }).then(() => {}, () => {})
  }, 20_000)
  try {
    const [{ data: cfg }, { data: arts }] = await Promise.all([sb.from("zomatik_np_config").select("plant_id, deposito"), sb.from("zomatik_articulos").select("codigo, nombre")])
    const plantaDe = new Map<number, string>(((cfg as any[]) || []).filter((c) => c.deposito).map((c) => [Number(c.deposito), c.plant_id]))
    const articuloDe = new Map<string, number>(((arts as any[]) || []).map((a) => [nombreArticuloLista(a.nombre), Number(a.codigo)]))
    const s = await obtenerSesion()
    let html: string
    try {
      html = await fetchReporteProduccion(s, desde)
    } catch (e) {
      // Otro sistema cambió la sucursal (Concretus, por ejemplo): un reintento en 15 s
      if (!esDeSucursal(e) || opts.limite - Date.now() < 30_000) throw e
      await espera(15_000)
      html = await fetchReporteProduccion(s, desde)
    }
    const r = leerReporteProduccion(html, desde)
    if (!r.ok) {
      await anotarError(sb, r.motivo || "no se entendió el reporte")
      return { ok: false, desde, error: r.motivo, ms: ms() }
    }
    const filas = r.celdas.map((c) => ({
      fecha: c.fecha,
      deposito: c.deposito,
      plant_id: plantaDe.get(c.deposito) ?? null,
      segmento: c.segmento,
      producto: c.producto,
      articulo_codigo: articuloDe.get(nombreArticuloLista(c.producto)) ?? null,
      um: c.um,
      m3: c.m3,
    }))
    const { error: eR } = await sb.rpc("control_produccion_reemplazar", { p_desde: desde, p_hasta: sumarDias(desde, DIAS_REPORTE - 1), p_filas: filas, p_otros: r.otros })
    if (eR) throw eR
    return { ok: true, desde, celdas: filas.length, otros: r.otros.length, ms: ms() }
  } catch (e) {
    const msg = textoError(e)
    await anotarError(sb, msg)
    return { ok: false, desde, error: msg, ms: ms() }
  } finally {
    clearInterval(renovar)
    await sb.rpc("zomatik_robot_soltar", { p_quien: quien })
  }
}

/**
 * ¿Ya está todo leído hoy? (para el reintento de las 06:42). Producción: la lectura de hoy. Stock: los 5 materiales en
 * los dos depósitos. Sin las tablas, producción cuenta como "no hace falta" (no se puede leer).
 */
export async function leidoHoy(sb: SupabaseClient, ahora: number = Date.now()): Promise<{ produccion: boolean; stock: boolean }> {
  const hoy = fechaArgentina(ahora)
  const deHoy = (iso: unknown) => !!iso && fechaArgentina(String(iso)) === hoy
  const [p, l] = await Promise.all([sb.from("zomatik_produccion_lectura").select("leido_at").eq("id", 1).maybeSingle(), sb.from("zomatik_stock_lecturas").select("deposito, codigo_articulo, leido_at")])
  const produccion = p.error ? faltaTabla(p.error) : deHoy((p.data as any)?.leido_at)
  const lecturas = ((l.data as any[]) || []).filter((x) => deHoy(x.leido_at))
  const stock = !l.error && DEPOSITOS_STOCK.every((d) => MATERIALES.every((m) => lecturas.some((x) => Number(x.deposito) === d && x.codigo_articulo === m.codigo)))
  return { produccion, stock }
}

// ---------------------------------------------------------------------------
// La comparación (solo lee la base)
// ---------------------------------------------------------------------------

/** Arma la comparación de hoy. Tira `FaltaMigracionDespacho` si no están las tablas nuevas. */
export async function calcularDespacho(sb: SupabaseClient, hoy: string = fechaArgentina()): Promise<ResultadoDespacho> {
  const { desde, hasta } = ventana(hoy)
  const desdeTs = `${desde}T03:00:00.000Z`

  // OF del robot. Sin la migración 202611191200 (42703): sin lista y sin corrección de fechas; el resto anda
  const sinColumnas = (e: any) => e?.code === "42703" || /of_mp_/.test(String(e?.message || ""))
  const sinColumnasVacio = (e: any) => {
    if (sinColumnas(e)) return [] as any[]
    throw e
  }
  // Todas las consultas que no dependen de otra, juntas
  const [prodLectura, prod, { data: cfg, error: eCfg }, { data: plantasDb, error: ePl }, despachos, movimientos, lecturas, ofsRobot, ofs] = await Promise.all([
    sb.from("zomatik_produccion_lectura").select("leido_at, error").eq("id", 1).maybeSingle(),
    todasLasFilas<any>((a, b) => sb.from("zomatik_produccion_dia").select("deposito, fecha, producto, articulo_codigo, m3, segmento").gte("fecha", desde).lte("fecha", hoy).ilike("segmento", "hormigon%").order("id").range(a, b)).catch((e) => {
      throw faltaTabla(e) ? new FaltaMigracionDespacho() : e
    }),
    sb.from("zomatik_np_config").select("plant_id, deposito"),
    sb.from("plants").select("id, name"),
    // Nuestro sistema: los despachos de la ventana y de hoy, sin los de prueba (OBRA PROPIA entra)
    todasLasFilas<any>((a, b) =>
      sb
        .from("dispatches")
        .select("id, plant_id, dispatch_date, quantity_m3, is_test_dispatch, formulas(code, plant_id, zomatik_articulo_codigo, zomatik_articulo_nombre), dispatch_materials(quantity, dry_quantity, materials(name))")
        .gte("dispatch_date", desdeTs)
        .or("is_test_dispatch.is.null,is_test_dispatch.eq.false")
        .order("id")
        .range(a, b),
    ),
    // Zomatik: consumos (RMI) y ajustes (RS) desde el inicio de la ventana, y cuándo se leyó cada artículo
    todasLasFilas<any>((a, b) => sb.from("zomatik_stock_movimientos").select("deposito, codigo_articulo, fecha, prefijo, comprobante, movimiento").in("prefijo", ["RMI", "RS"]).gte("fecha", desde).order("id").range(a, b)),
    sb.from("zomatik_stock_lecturas").select("deposito, codigo_articulo, leido_at, error"),
    todasLasFilas<any>((a, b) =>
      sb.from("zomatik_remitos").select("plant_id, fecha, of_mp_at, of_mp_detalle").eq("of_mp_estado", "ok").not("of_mp_detalle", "is", null).gte("of_mp_at", desdeTs).order("id").range(a, b),
    ).catch(sinColumnasVacio),
    todasLasFilas<any>((a, b) =>
      sb
        .from("zomatik_remitos")
        .select("fecha, plant_id, of_numero, m3, formula_id, of_estado, estado, of_mp_estado, of_mp_mensaje")
        .eq("of_estado", "ok")
        .neq("estado", "anulado")
        .gte("fecha", desde)
        .lte("fecha", hasta)
        .order("fecha")
        .range(a, b),
    ).catch(sinColumnasVacio),
  ])
  if (prodLectura.error) throw faltaTabla(prodLectura.error) ? new FaltaMigracionDespacho() : prodLectura.error
  if (eCfg) throw eCfg
  if (ePl) throw ePl
  if (lecturas.error) throw lecturas.error
  const nombre = new Map(((plantasDb as any[]) || []).map((p) => [p.id, p.name]))
  const plantas = ((cfg as any[]) || [])
    .filter((c) => c.deposito && c.plant_id && nombre.has(c.plant_id))
    .map((c) => ({ id: c.plant_id as string, nombre: String(nombre.get(c.plant_id)), deposito: Number(c.deposito) }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre))

  const idsFormula = [...new Set(ofs.map((o) => o.formula_id).filter(Boolean))]
  const codigoFormula = new Map<string, string>()
  if (idsFormula.length) {
    const { data } = await sb.from("formulas").select("id, code").in("id", idsFormula)
    for (const f of (data as any[]) || []) codigoFormula.set(f.id, f.code)
  }

  const datos: DatosDespacho = {
    hoy,
    plantas,
    despachos: despachos.map((d) => ({
      // La planta que despachó; los despachos viejos sin planta, la de la fórmula
      plantaId: d.plant_id || d.formulas?.plant_id || "",
      fecha: fechaArgentina(d.dispatch_date),
      m3: Number(d.quantity_m3) || 0,
      articuloCodigo: d.formulas?.zomatik_articulo_codigo ?? null,
      articuloNombre: d.formulas?.zomatik_articulo_nombre ?? null,
      formula: d.formulas?.code ?? null,
      materiales: ((d.dispatch_materials as any[]) || []).map((m) => ({
        nombre: m.materials?.name || "",
        kg: Number(m.quantity) || 0,
        kgSeco: m.dry_quantity === null || m.dry_quantity === undefined ? null : Number(m.dry_quantity),
      })),
    })),
    produccion: prod.map((p) => ({ deposito: Number(p.deposito), fecha: p.fecha, producto: p.producto, articuloCodigo: p.articulo_codigo ?? null, m3: Number(p.m3) || 0 })),
    lecturaProduccion: prodLectura.data ? { leidoAt: (prodLectura.data as any).leido_at ?? null, error: (prodLectura.data as any).error ?? null } : null,
    movimientos: movimientos.map((m) => ({ deposito: Number(m.deposito), codigo: m.codigo_articulo, fecha: m.fecha, prefijo: m.prefijo, comprobante: m.comprobante || "", movimiento: Number(m.movimiento) || 0 })),
    lecturasStock: ((lecturas.data as any[]) || []).map((l) => ({ deposito: Number(l.deposito), codigo: l.codigo_articulo, leidoAt: l.leido_at ?? null, error: l.error ?? null })),
    ofsRobot: ofsRobot.map((o) => ({ plantaId: o.plant_id, fecha: o.fecha, ofMpAt: o.of_mp_at, detalle: Array.isArray(o.of_mp_detalle) ? o.of_mp_detalle : [] })),
    ofs: ofs.map((o) => ({ ...o, formula: o.formula_id ? codigoFormula.get(o.formula_id) ?? null : null })),
  }
  return armarDespacho(datos)
}

/** Tope del bloque del despacho en el mail: si no termina, el mail sale igual con una línea ámbar. */
export const TOPE_DESPACHO_MAIL_MS = 20_000
const lineaAmbar = (texto: string) => ({
  html: `<div style="margin:0 0 12px;padding-bottom:10px;border-bottom:1px solid #e2e8f0"><div style="background:#fef3c7;color:#78350f;padding:6px 8px;border-radius:6px">${texto}</div></div>`,
  asunto: null,
})
export const LINEA_NO_SE_PUDO_CONTROLAR = "Despacho contra Zomatik: no se pudo controlar hoy."
export const LINEA_NO_A_TIEMPO = "Despacho contra Zomatik: no se pudo calcular a tiempo."

/**
 * El bloque de arriba del mail de las 16:25 (diario y semanal). Nunca tira y no tarda más de `topeMs` (20 s): sin las
 * tablas nuevas devuelve null (el mail sale como hoy); si no termina a tiempo o con cualquier otro error (también un
 * permiso denegado), una línea ámbar.
 */
export async function seccionDespachoParaMail(sb: SupabaseClient, hoy: string, opts: { topeMs?: number } = {}): Promise<{ html: string; asunto: string | null } | null> {
  let reloj: ReturnType<typeof setTimeout> | undefined
  const tope = new Promise<"tope">((r) => {
    reloj = setTimeout(() => r("tope"), opts.topeMs ?? TOPE_DESPACHO_MAIL_MS)
  })
  try {
    const r = await Promise.race([calcularDespacho(sb, hoy), tope])
    if (r === "tope") {
      console.error("[control-produccion] bloque del mail: no terminó a tiempo")
      return lineaAmbar(LINEA_NO_A_TIEMPO)
    }
    return seccionMailDespacho(r, LINK_DESPACHO)
  } catch (e) {
    if (e instanceof FaltaMigracionDespacho) return null
    console.error("[control-produccion] bloque del mail:", e)
    return lineaAmbar(LINEA_NO_SE_PUDO_CONTROLAR)
  } finally {
    clearTimeout(reloj)
  }
}
