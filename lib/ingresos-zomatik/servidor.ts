/**
 * Ingresos de materia prima desde Zomatik · SOLO servidor (clave de servicio). Especificación:
 * docs/specs/2026-11-05-ingresos-mp-desde-zomatik.md, con las respuestas de Bautista del 05/11; ficha docs/ingresos-mp-zomatik.md.
 *
 *   pasada()   registrar (freno control_mp_registrar) → interruptor → leer Zomatik (ESTAD R.COMPRA, la lectura del
 *              control con su ventana) → importar() → avisos → guardar el plan y el resumen en la corrida.
 *   importar() con los días leídos enteros en esta lectura: arma el plan (lib/ingresos-zomatik/plan.ts) y, solo en modo
 *              real, lo aplica con mp_zomatik_aplicar. En sombra no escribe nada (solo la corrida).
 *
 * Nunca escribe en Zomatik (la lectura es la del control, lista cerrada de lib/zomatik/web.ts). Nunca suma stock desde
 * acá: el alta es un INSERT en la base (lo suma el trigger) y las correcciones van con asiento dentro de la función.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { leerZomatikCompras, type ResultadoLectura } from "@/lib/control-ingresos/servidor"
import { textoError } from "@/lib/zomatik/lectura"
import { enviarMail } from "@/lib/mail-servidor"
import { esArenaFina } from "@/lib/ingresos/muestras"
import { desdeVentana, fechaArgentina, sumarDias, ddmm, MARGEN_DIAS } from "@/lib/control-ingresos/cruce"
import { avisarErrorZomatik, avisarFallaAcceso, avisarZomatikVolvio, esFallaDeAcceso } from "@/lib/zomatik/np-servidor"
import {
  claveRemito,
  leerDensidades,
  leerInterruptor,
  planImportacion,
  posiblesCopias,
  textoCantidad,
  textoMotivo,
  textoResumen,
  unidadMaterial,
  CLAVE_DENSIDADES,
  CLAVE_INTERRUPTOR,
  MANUALES_ANTES_DE_F_DIAS,
  TIPOS_IMPORTABLES,
  type Accion,
  type EntradaPlan,
  type FilaCopia,
  type Interruptor,
  type ResumenPlan,
  type Vinculo,
} from "@/lib/ingresos-zomatik/plan"

/** Pasada corta: los últimos 15 días, un tramo, 50 s de lectura (spec 3.1). */
export const DIAS_PASADA_CORTA = 15
export const LECTURA_CORTA_MS = 50_000
/** La completa (05:05) usa la ventana y el presupuesto del control (220 s; maxDuration 300 en la ruta). */
export const LECTURA_COMPLETA_MS = 220_000
/** Arena Fina importada sin humedad: se avisa a las 24 h (Bautista, 05/11). */
export const AVISO_HUMEDAD_MS = 24 * 3600_000
/** Ninguna pasada buena en 2 h (06:00–20:00): aviso a Bautista, uno por día (spec 8). */
export const SIN_PASADA_MS = 2 * 3600_000
export const CLAVE_AVISO_PASADA = "mp_ingresos_aviso"
/** Encargado de cada planta: le aparece el aviso de Arena Fina sin humedad al entrar a Materias Primas (Bautista, 05/11). */
export const ENCARGADO_PLANTA: Record<string, string> = { Canning: "Titan Concretus", Hudson: "David Herrera" }
/** Mail del aviso de humedad: Felipe Calvo (como MAIL_CC_FIJO del control). */
export const MAIL_HUMEDAD = ["f.calvo@concretus.com.ar"]
const FROM = process.env.REPORTE_CALIDAD_FROM || "reportes@produccionrebucret.com"
const LINK = "https://www.produccionrebucret.com/materias-primas?tab=ingresos"

type SB = SupabaseClient

async function todas<T>(q: (a: number, b: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; ; i += 1000) {
    const { data, error } = await q(i, i + 999)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return out
}

/** ¿Falta la migración 202611061000? (tabla o columna que no existe) */
export const faltaMigracion = (e: any) => /zomatik_ingresos_mp|origen|anulado_at|mp_zomatik_aplicar|correccion_ingreso|does not exist|schema cache/i.test(`${e?.message || ""} ${e?.code || ""}`) && /42P01|42703|PGRST20|PGRST116|PGRST204|PGRST205|42883|does not exist|schema cache/i.test(`${e?.message || ""} ${e?.code || ""}`)
export const MENSAJE_SIN_MIGRACION = "Falta aplicar la migración de la importación (202611061000)."

// ---------------------------------------------------------------------------
// Configuración (integraciones)
// ---------------------------------------------------------------------------

export async function leerConfig(sb: SB): Promise<{ interruptor: Interruptor; densidades: Record<string, number> }> {
  const { data } = await sb.from("integraciones").select("clave, valor").in("clave", [CLAVE_INTERRUPTOR, CLAVE_DENSIDADES])
  const fila = (k: string) => ((data as any[]) || []).find((x) => x.clave === k)?.valor
  return { interruptor: leerInterruptor(fila(CLAVE_INTERRUPTOR)), densidades: leerDensidades(fila(CLAVE_DENSIDADES)) }
}

/** Días leídos enteros en una lectura (los tramos que terminaron bien). */
export function diasDeLectura(l: ResultadoLectura | null | undefined): string[] {
  const out: string[] = []
  for (const t of l?.tramos || []) if (t.ok) for (let d = t.desde; d <= t.hasta; d = sumarDias(d, 1)) out.push(d)
  return out
}

// ---------------------------------------------------------------------------
// Importación
// ---------------------------------------------------------------------------

export type ResultadoImportacion = {
  modo: Interruptor["modo"]
  desde: string | null
  ok: boolean
  motivo?: string
  resumen?: ResumenPlan
  texto?: string
  /** Lo que haría (sombra) o hizo (real), para mirar en la corrida y en el bloque "Importación". */
  detalle?: { tipo: Accion["tipo"]; clave: string; texto: string; ok?: boolean; motivo?: string }[]
  aplicadas?: { ok: number; salteadas: number; fallas: number }
  sinMaterial?: { articulo: string; codigo: string | null; renglones: number; ultima: string }[]
  pendientes?: { clave: string; fecha: string; remito: string; motivo: string }[]
}

async function cargarEntrada(sb: SB, i: Interruptor, dias: string[], densidades: Record<string, number>, ahora: number): Promise<EntradaPlan> {
  const F = i.desde!
  const diasF = dias.filter((d) => d >= F).sort()
  const piso = sumarDias(F, -MANUALES_ANTES_DE_F_DIAS)
  const [filas, vinculos, manuales, mats, provs, mps, fletes, plantas] = await Promise.all([
    diasF.length
      ? todas<any>((a, b) =>
          sb
            .from("zomatik_remitos_compra")
            .select("id, fecha, remito, codigo_articulo, articulo, cantidad, deposito, plant_id, proveedor, transportista, orden_compra, datos")
            .gte("fecha", diasF[0])
            .lte("fecha", diasF[diasF.length - 1])
            .order("id")
            .range(a, b),
        )
      : Promise.resolve([]),
    todas<any>((a, b) => sb.from("zomatik_ingresos_mp").select("*").order("id").range(a, b)),
    todas<any>((a, b) =>
      sb
        .from("stock_entries")
        .select("id, entry_date, material_id, quantity, remito, origen, anulado_at, materials(plant_id)")
        .gte("entry_date", `${piso}T03:00:00.000Z`)
        .order("id")
        .range(a, b),
    ),
    sb.from("materials").select("id, name, plant_id, tipo, unit, corrige_humedad"),
    sb.from("suppliers").select("id, name, plant_id"),
    sb.from("material_suppliers").select("material_id, supplier_id"),
    sb.from("carriers").select("id, name, supplier_id"),
    sb.from("plants").select("id, name"),
  ])
  for (const r of [mats, provs, mps, fletes, plantas]) if (r.error) throw r.error
  const set = new Set(diasF)
  return {
    filas: filas
      .filter((f) => set.has(f.fecha))
      .map(
        (f): FilaCopia => ({
          orden: Number(f.id),
          fecha: f.fecha,
          remito: f.remito,
          codigo_articulo: f.codigo_articulo ?? null,
          articulo: f.articulo,
          cantidad: Number(f.cantidad),
          deposito: f.deposito ?? null,
          plant_id: f.plant_id ?? null,
          proveedor: f.proveedor ?? null,
          transportista: f.transportista ?? null,
          orden_compra: f.orden_compra ?? null,
          datos: f.datos ?? null,
        }),
      ),
    diasLeidos: diasF,
    vinculos: vinculos.map(
      (v): Vinculo => ({
        ...v,
        cantidad_zomatik: v.cantidad_zomatik === null ? null : Number(v.cantidad_zomatik),
        kg_asentado: v.kg_asentado === null ? null : Number(v.kg_asentado),
        rechazados: v.rechazados || [],
      }),
    ),
    manuales: manuales
      .filter((m) => m.origen !== "zomatik" && !m.anulado_at)
      .map((m) => ({ id: m.id, fecha: fechaArgentina(m.entry_date), material_id: m.material_id, plant_id: m.materials?.plant_id ?? null, quantity: Number(m.quantity) || 0, remito: m.remito ?? null })),
    materiales: (mats.data as any[]) || [],
    proveedores: (provs.data as any[]) || [],
    materialProveedores: (mps.data as any[]) || [],
    fletes: (fletes.data as any[]) || [],
    plantas: Object.fromEntries(((plantas.data as any[]) || []).map((p) => [p.id, p.name])),
    desde: F,
    ahora,
    densidades,
  }
}

/**
 * Importa lo leído en esta lectura (`dias`). Apagado: nada. Sombra: el plan, sin escribir. Real: lo aplica.
 * Nunca tira: devuelve el error en `motivo`.
 */
export async function importar(sb: SB, o: { dias: string[]; t0?: number }): Promise<ResultadoImportacion> {
  let cfg: Awaited<ReturnType<typeof leerConfig>>
  try {
    cfg = await leerConfig(sb)
  } catch (e) {
    return { modo: "apagado", desde: null, ok: false, motivo: textoError(e) }
  }
  const { interruptor: i, densidades } = cfg
  if (i.modo === "apagado" || !i.desde) return { modo: "apagado", desde: null, ok: true, motivo: "La importación está apagada" }
  const res: ResultadoImportacion = { modo: i.modo, desde: i.desde, ok: true }
  try {
    if (!o.dias.some((d) => d >= i.desde!)) {
      res.motivo = o.dias.length ? `No se leyó ningún día desde el ${ddmm(i.desde)}` : "No se leyó ningún día entero de Zomatik"
      res.ok = o.dias.length > 0
      return res
    }
    const entrada = await cargarEntrada(sb, i, o.dias, densidades, o.t0 ?? Date.now())
    const plan = planImportacion(entrada)
    res.resumen = plan.resumen
    res.texto = textoResumen(plan.resumen)
    res.sinMaterial = plan.sinMaterial
    res.pendientes = plan.pendientes.slice(0, 200)
    res.detalle = plan.acciones.slice(0, 300).map((a) => ({ tipo: a.tipo, clave: a.clave, texto: a.texto }))
    if (i.modo !== "real" || !plan.acciones.length) return res
    // Real: se aplica en tandas (cada acción en su bloque dentro de la función)
    const resultados: any[] = []
    for (let k = 0; k < plan.acciones.length; k += 50) {
      const { data, error } = await sb.rpc("mp_zomatik_aplicar", { p_acciones: plan.acciones.slice(k, k + 50) })
      if (error) throw error
      resultados.push(...((data as any[]) || []))
    }
    const porClave = new Map(resultados.map((r) => [`${r.tipo}|${r.clave}`, r]))
    res.detalle = res.detalle.map((d) => {
      const r = porClave.get(`${d.tipo}|${d.clave}`)
      return r ? { ...d, ok: !!r.ok, motivo: r.motivo || undefined } : d
    })
    // ok = aplicada · sin ok y sin error = salteada (otra pasada ya lo hizo, el ingreso cambió) · error = falló
    res.aplicadas = {
      ok: resultados.filter((r) => r.ok).length,
      salteadas: resultados.filter((r) => !r.ok && !r.error).length,
      fallas: resultados.filter((r) => !r.ok && r.error).length,
    }
    if (res.aplicadas.fallas) res.ok = false
    await actividad(sb, plan.acciones, porClave, entrada)
  } catch (e) {
    res.ok = false
    res.motivo = faltaMigracion(e) ? MENSAJE_SIN_MIGRACION : textoError(e)
  }
  return res
}

/** Actividad de lo que movió stock o cambió un ingreso (usuario "Zomatik"), en un solo insert. Nunca corta. */
async function actividad(sb: SB, acciones: Accion[], porClave: Map<string, any>, e: EntradaPlan) {
  try {
    const filas = acciones
      .filter((a) => ["alta", "corregir", "anular", "mover"].includes(a.tipo) || (a.tipo === "emparejar" && a.reemplazar))
      .map((a) => ({ a, r: porClave.get(`${a.tipo}|${a.clave}`) }))
      .filter((x) => x.r?.ok)
      .map(({ a, r }) => {
        const vin = (a as any).vinculo || {}
        return {
          user_name: "Zomatik",
          action: a.tipo === "alta" ? "crear" : "editar",
          entity: "ingreso",
          entity_id: r.stock_entry_id ?? (a as any).entry_id ?? null,
          reference: vin.remito || null,
          plant_id: vin.plant_id && /^[0-9a-f-]{36}$/i.test(vin.plant_id) ? vin.plant_id : null,
          details: { Qué: a.texto, Origen: "Importación de Zomatik", ...(e.desde ? { Desde: ddmm(e.desde) } : {}) },
        }
      })
    for (let i = 0; i < filas.length; i += 200) {
      const { error } = await sb.from("activity_log").insert(filas.slice(i, i + 200))
      if (error) console.error("[ingresos-zomatik] actividad:", error.message)
    }
  } catch (err) {
    console.error("[ingresos-zomatik] actividad:", err)
  }
}

// ---------------------------------------------------------------------------
// La pasada (pg_cron cada 30 min, la de la noche y "Traer de Zomatik")
// ---------------------------------------------------------------------------

export type ResultadoPasada = { ok: boolean; motivo?: string; ocupado?: boolean; lectura?: ResultadoLectura; importacion?: ResultadoImportacion; avisos?: string[] }

/** origen: "pasada" (pg_cron) o "traer" (botón "Traer de Zomatik"; no cuenta como control). */
export async function pasada(sb: SB, o: { completa: boolean; origen: "pasada" | "traer"; usuario: string | null; t0: number }): Promise<ResultadoPasada> {
  const { data: reg, error: eReg } = await sb.rpc("control_mp_registrar", { p_origen: o.origen, p_usuario: o.usuario })
  if (eReg) return { ok: false, motivo: faltaMigracion(eReg) || /Origen inválido/.test(eReg.message) ? MENSAJE_SIN_MIGRACION : textoError(eReg) }
  if ((reg as any)?.motivo) {
    // Origen inválido = la función vieja (sin 'pasada'): falta la migración
    if (/Origen inválido/.test((reg as any).motivo)) return { ok: false, motivo: MENSAJE_SIN_MIGRACION }
    return { ok: false, ocupado: true, motivo: (reg as any).motivo }
  }
  const corridaId = (reg as any).id as string
  const res: ResultadoPasada = { ok: true, avisos: [] }
  try {
    const hoy = fechaArgentina(o.t0)
    const desde = o.completa ? desdeVentana(hoy) : sumarDias(hoy, -(DIAS_PASADA_CORTA - 1))
    res.lectura = await leerZomatikCompras(sb, desde, hoy, o.t0, {
      margen: o.completa ? MARGEN_DIAS : 0,
      tramoDias: o.completa ? undefined : DIAS_PASADA_CORTA,
      hastaMs: o.completa ? LECTURA_COMPLETA_MS : LECTURA_CORTA_MS,
      quien: `mp-ingresos·${o.t0.toString(36)}`,
    })
    if (/Otro proceso estaba trabajando/.test(res.lectura.error || "")) res.ocupado = true
    res.importacion = await importar(sb, { dias: diasDeLectura(res.lectura), t0: o.t0 })
    res.ok = res.lectura.ok && res.importacion.ok
    res.avisos = await avisos(sb, res, o.t0)
  } catch (e) {
    res.ok = false
    res.motivo = textoError(e)
  }
  // Para la corrida: la lectura sin las muestras de cada tramo (pesan) y la importación
  const lectura = res.lectura ? { ...res.lectura, tramos: res.lectura.tramos.map(({ muestra: _m, ...t }) => t), importacion: res.importacion ?? null, completa: o.completa } : { importacion: res.importacion ?? null }
  await sb
    .from("control_mp_corridas")
    .update({
      fin: new Date().toISOString(),
      ok: res.ok,
      lectura,
      resumen: res.importacion?.resumen ? { importacion: res.importacion.resumen, modo: res.importacion.modo } : null,
      error: [res.motivo, res.lectura?.error, res.importacion?.ok === false ? res.importacion.motivo : null].filter(Boolean).join(" · ").slice(0, 2000) || null,
    })
    .eq("id", corridaId)
  return res
}

// ---------------------------------------------------------------------------
// Avisos (spec 8 y respuestas de Bautista 7)
// ---------------------------------------------------------------------------

const horaAR = (ms: number) => {
  const d = new Date(ms - 3 * 3600_000)
  return d.getUTCHours()
}

async function avisos(sb: SB, r: ResultadoPasada, t0: number): Promise<string[]> {
  const out: string[] = []
  const modo = r.importacion?.modo || "apagado"
  // 1. Zomatik no deja entrar: el aviso único del robot (uno mientras dure) y "volvió"
  try {
    if (r.lectura?.codigo && esFallaDeAcceso({ codigo: r.lectura.codigo })) {
      const x = await avisarFallaAcceso(sb as any, avisarErrorZomatik as any, { que: "Ingresos MP: lectura de ESTAD R.COMPRA", mensaje: r.lectura.error || "", codigo: r.lectura.codigo })
      out.push(`acceso: ${x}`)
    } else if (r.lectura?.ok) {
      await avisarZomatikVolvio(sb as any, avisarErrorZomatik as any)
    }
  } catch (e) {
    console.error("[ingresos-zomatik] aviso de acceso:", e)
  }
  if (modo === "apagado") return out
  // 2. Ninguna pasada buena en 2 h dentro de 06:00–20:00: a Bautista, uno por día
  try {
    const h = horaAR(t0)
    if (!r.ok && h >= 6 && h < 20) {
      const { data } = await sb.from("control_mp_corridas").select("inicio").eq("ok", true).order("inicio", { ascending: false }).limit(1)
      const ultima = (data as any[])?.[0]?.inicio as string | undefined
      if (!ultima || t0 - Date.parse(ultima) > SIN_PASADA_MS) {
        const hoy = fechaArgentina(t0)
        const { data: marca } = await sb.from("integraciones").select("valor").eq("clave", CLAVE_AVISO_PASADA).maybeSingle()
        if ((marca as any)?.valor !== hoy) {
          const m = await avisarErrorZomatik(sb as any, "Ingresos MP: hace más de 2 h que no se puede leer Zomatik", [
            ultima ? `Última lectura buena: ${new Date(ultima).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}.` : "No hay ninguna lectura buena registrada.",
            `Último error: ${[r.motivo, r.lectura?.error, r.importacion?.motivo].filter(Boolean).join(" · ") || "-"}`,
            "Mientras tanto los ingresos de materia prima no entran solos. Se reintenta cada 30 min.",
          ])
          if (m.enviado) await sb.from("integraciones").upsert({ clave: CLAVE_AVISO_PASADA, valor: hoy, actualizado: new Date().toISOString(), conectado_por: "sistema" } as never, { onConflict: "clave" })
          out.push(`sin pasada: ${m.enviado ? "enviado" : m.motivo}`)
        }
      }
    }
  } catch (e) {
    console.error("[ingresos-zomatik] aviso sin pasada:", e)
  }
  // 3. Arena Fina sin humedad a las 24 h: el mail a Felipe sale a la mañana (pasadas de las 8) y con el control de las
  //    16:25 (avisarHumedad, desde lib/control-ingresos/servidor.ts); cada ingreso una vez. El aviso en la app lo ve el
  //    encargado al entrar.
  if (modo === "real" && horaAR(t0) === 8) {
    try {
      const x = await avisarHumedad(sb, t0, "manana")
      if (x) out.push(x)
    } catch (e) {
      console.error("[ingresos-zomatik] aviso de humedad:", e)
    }
  }
  return out
}

export type SinHumedad = { id: string; vinculoId: number | null; fecha: string; remito: string | null; material: string; planta: string; plantId: string | null; kg: number; horas: number }

/** Arena Fina de Zomatik (o emparejada) sin humedad, sin anular, cargada hace más de 24 h. Mismo criterio que el menú de la fila (esArenaFina). */
export async function arenasSinHumedad(sb: SB, ahora = Date.now(), desde?: string | null): Promise<SinHumedad[]> {
  const q = sb
    .from("stock_entries")
    .select("id, entry_date, created_at, remito, quantity, humidity_percentage, anulado_at, origen, materials(name, plant_id, corrige_humedad, plants(name))")
    .eq("origen", "zomatik")
    .is("humidity_percentage", null)
    .is("anulado_at", null)
    .lt("created_at", new Date(ahora - AVISO_HUMEDAD_MS).toISOString())
    .gte("entry_date", `${desde || sumarDias(fechaArgentina(ahora), -60)}T03:00:00.000Z`)
    .limit(500)
  const { data, error } = await q
  if (error) throw error
  return ((data as any[]) || [])
    .filter((e) => esArenaFina(e.materials?.name))
    .map((e) => ({
      id: e.id,
      vinculoId: null,
      fecha: fechaArgentina(e.entry_date),
      remito: e.remito ?? null,
      material: e.materials?.name || "-",
      planta: e.materials?.plants?.name || "-",
      plantId: e.materials?.plant_id ?? null,
      kg: Number(e.quantity) || 0,
      horas: Math.floor((ahora - Date.parse(e.created_at)) / 3600_000),
    }))
}

/** Marca de `integraciones`: el día (AAAA-MM-DD) en que salió el mail de Arena Fina sin humedad. */
export const CLAVE_AVISO_HUMEDAD = "mp_aviso_humedad"

/**
 * Mail a Felipe con la Arena Fina de Zomatik sin humedad a las 24 h: uno por día como mucho (lo llama el control de las
 * 16:25), y cada ingreso una sola vez. `aviso_humedad_at` se marca recién cuando el mail salió.
 */
export async function avisarHumedad(sb: SB, ahora: number = Date.now(), turno: "manana" | "tarde" = "tarde"): Promise<string | null> {
  const { interruptor } = await leerConfig(sb)
  if (interruptor.modo !== "real" || !interruptor.desde) return null
  const hoy = fechaArgentina(ahora)
  const { data: marca } = await sb.from("integraciones").select("valor").eq("clave", CLAVE_AVISO_HUMEDAD).maybeSingle()
  // Una marca por envío (mañana y tarde): así no pasan 48 h y no sale dos veces en el mismo turno
  const envio = `${hoy}|${turno}`
  if ((marca as any)?.valor === envio) return `humedad: ya se mandó (${turno})`
  const arenas = await arenasSinHumedad(sb, ahora, interruptor.desde)
  if (!arenas.length) return null
  const { data: vs, error } = await sb.from("zomatik_ingresos_mp").select("id, stock_entry_id").in("stock_entry_id", arenas.map((a) => a.id)).is("aviso_humedad_at", null)
  if (error) throw error
  const nuevos = arenas.filter((a) => ((vs as any[]) || []).some((v) => v.stock_entry_id === a.id))
  if (!nuevos.length) return null
  const filas = nuevos
    .map((a) => `<tr><td style="padding:3px 6px">${ddmm(a.fecha)}</td><td style="padding:3px 6px">${a.planta}</td><td style="padding:3px 6px">${esc(a.remito || "-")}</td><td style="padding:3px 6px">${(a.kg / 1000).toLocaleString("es-AR", { maximumFractionDigits: 2 })} t</td><td style="padding:3px 6px">${a.horas} h</td></tr>`)
    .join("")
  const html = `<div style="font-family:Arial,sans-serif;max-width:640px;color:#0f172a;font-size:12px">
    <div style="font-size:15px;margin-bottom:6px">Arena Fina sin humedad cargada</div>
    <p>Estos ingresos entraron desde Zomatik hace más de 24 h y todavía no tienen la humedad. La cargan ${Object.entries(ENCARGADO_PLANTA).map(([p, n]) => `${n} (${p})`).join(" o ")} en Materias Primas › Ingresos › "Cargar humedad".</p>
    <table style="border-collapse:collapse"><tr style="color:#64748b"><td style="padding:3px 6px">Fecha</td><td style="padding:3px 6px">Planta</td><td style="padding:3px 6px">Remito</td><td style="padding:3px 6px">Cantidad</td><td style="padding:3px 6px">Hace</td></tr>${filas}</table>
    <p><a href="${LINK}" style="color:#1d4ed8">Ver en el sistema</a></p>
    <p style="font-size:11px;color:#94a3b8">Se avisa una sola vez por ingreso · produccionrebucret.com</p></div>`
  const m = await enviarMail({ from: `Rebucret - Control MP <${FROM}>`, to: MAIL_HUMEDAD, subject: `Rebucret · Arena Fina sin humedad: ${nuevos.length} ${nuevos.length === 1 ? "ingreso" : "ingresos"}`, html })
  if (!m.ok) return `humedad: ${m.error}`
  const { error: eMarca } = await sb
    .from("zomatik_ingresos_mp")
    .update({ aviso_humedad_at: new Date().toISOString() })
    .in("id", ((vs as any[]) || []).filter((v) => nuevos.some((a) => a.id === v.stock_entry_id)).map((v) => v.id))
  if (eMarca) console.error("[ingresos-zomatik] marca del aviso de humedad:", eMarca.message)
  await sb.from("integraciones").upsert({ clave: CLAVE_AVISO_HUMEDAD, valor: envio, actualizado: new Date().toISOString(), conectado_por: "sistema" } as never, { onConflict: "clave" })
  return `humedad: ${nuevos.length} avisados${eMarca ? " (no se pudo marcar)" : ""}`
}

const esc = (t: unknown) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)

// ---------------------------------------------------------------------------
// Datos para el control (pantalla y mail, fase 2)
// ---------------------------------------------------------------------------

export type PendienteVista = {
  id: number
  clave: string
  fecha: string | null
  remito: string | null
  proveedor: string | null
  articulo: string | null
  cantidad: string
  planta: string
  motivo: string
  motivo_codigo: string | null
  queHacer: string
  primera_vez_at: string
  resolucion: string | null
  resuelto_por: string | null
  candidato: { id: string; fecha: string; remito: string | null; cantidad: string; material: string; planta: string } | null
}

export type ManualVista = { id: string; fecha: string; material: string; planta: string; cantidad: number; unidad: string; remito: string | null; cargadoPor: string | null; creado: string; dias: number; remitoZomatik?: string }

export type DatosImportacion = {
  interruptor: Interruptor
  ultimaPasada: { inicio: string; fin: string | null; ok: boolean | null; origen: string; usuario: string | null; error: string | null; importacion: ResultadoImportacion | null } | null
  pendientes: PendienteVista[]
  cambios: { creado: string; fecha: string; material: string; planta: string; kg: number; nota: string }[]
  antesDeF: { fecha: string | null; remito: string | null; motivo: string }[]
  /** Importados que Zomatik cambió y no se pudo aplicar (cantidad rara, otro material, depósito sin planta…). */
  noAplicados: { fecha: string | null; remito: string | null; proveedor: string | null; cantidad: string; planta: string; motivo: string; actualizado: string }[]
  manuales: ManualVista[]
  /** Manuales desde F sin vincular con el mismo remito completo y material que un importado o emparejado. */
  copias: ManualVista[]
  sinVincular: { proveedor: string; renglones: number }[]
  densidades: { material_id: string; material: string; planta: string; densidad: number | null }[]
  sinMaterial: { articulo: string; codigo: string | null; renglones: number; ultima: string }[]
  error?: string
}

const ingVacio = (i: Interruptor): DatosImportacion => ({ interruptor: i, ultimaPasada: null, pendientes: [], cambios: [], antesDeF: [], noAplicados: [], manuales: [], copias: [], sinVincular: [], densidades: [], sinMaterial: [] })
/** "Cargados a mano sin Zomatik": recién después de 7 días (en Zomatik se carga con atraso). */
export const MANUAL_SIN_ZOMATIK_DIAS = 7

/**
 * Lo de la importación para la pantalla Control con Zomatik y el mail: pendientes, cambios aplicados, manuales desde F
 * sin Zomatik (para eliminar), proveedores sin vincular, densidades. Sin la migración devuelve vacío con `error`.
 */
export async function datosImportacion(sb: SB, o: { ahora?: number } = {}): Promise<DatosImportacion> {
  const ahora = o.ahora ?? Date.now()
  const { interruptor: i, densidades: dens } = await leerConfig(sb)
  const out = ingVacio(i)
  try {
    const [{ data: corr }, mats, plantas] = await Promise.all([
      sb.from("control_mp_corridas").select("inicio, fin, ok, origen, usuario, error, lectura").not("lectura->importacion", "is", null).order("inicio", { ascending: false }).limit(1),
      sb.from("materials").select("id, name, plant_id, tipo, unit"),
      sb.from("plants").select("id, name"),
    ])
    const nombrePlanta = new Map(((plantas.data as any[]) || []).map((p) => [p.id, p.name]))
    const mat = new Map(((mats.data as any[]) || []).map((m) => [m.id, m]))
    const c = (corr as any[])?.[0]
    if (c) out.ultimaPasada = { inicio: c.inicio, fin: c.fin, ok: c.ok, origen: c.origen, usuario: c.usuario, error: c.error, importacion: c.lectura?.importacion ?? null }
    out.sinMaterial = (c?.lectura?.importacion?.sinMaterial as any[]) || []
    // Densidades: aditivos que en Rebucret están en kg (Zomatik los trae en litros o tachos)
    out.densidades = ((mats.data as any[]) || [])
      .filter((m) => ["aditivo_planta", "aditivo_obra"].includes(m.tipo) && unidadMaterial(m.unit) === "kg")
      .map((m) => ({ material_id: m.id, material: m.name, planta: nombrePlanta.get(m.plant_id) || "-", densidad: dens[m.id] ?? null }))
      .sort((a, b) => a.planta.localeCompare(b.planta) || a.material.localeCompare(b.material))
    if (i.modo === "apagado" || !i.desde) return out
    const F = i.desde
    const vinculos = await todas<any>((a, b) => sb.from("zomatik_ingresos_mp").select("id, clave, estado, motivo, motivo_codigo, stock_entry_id, fecha, remito, remito_norm, proveedor, articulo, cantidad_zomatik, unidad_zomatik, plant_id, material_id, candidato_id, resolucion, resuelto_por, primera_vez_at, actualizado_at").order("id").range(a, b))
    const candidatos = [...new Set(vinculos.filter((v) => v.estado === "pendiente" && v.candidato_id).map((v) => v.candidato_id))]
    const [candRows, manRows, sinProv, movs] = await Promise.all([
      candidatos.length ? sb.from("stock_entries").select("id, entry_date, remito, quantity, material_id").in("id", candidatos) : Promise.resolve({ data: [] as any[] }),
      todas<any>((a, b) =>
        sb
          .from("stock_entries")
          .select("id, entry_date, created_at, created_by, quantity, remito, material_id, origen, anulado_at")
          .gte("entry_date", `${F}T03:00:00.000Z`)
          .is("anulado_at", null)
          .order("id")
          .range(a, b),
      ),
      sb.from("stock_entries").select("id, supplier").eq("origen", "zomatik").is("supplier_id", null).is("anulado_at", null).gte("entry_date", `${F}T03:00:00.000Z`).limit(1000),
      sb.from("stock_movements").select("material_id, quantity_kg, notes, created_at, movement_date").eq("movement_type", "correccion_ingreso").eq("reference_type", "zomatik").gte("created_at", new Date(ahora - 60 * 86_400_000).toISOString()).order("created_at", { ascending: false }).limit(500),
    ])
    const cand = new Map((((candRows as any).data as any[]) || []).map((e) => [e.id, e]))
    const cantMat = (q: number, mid: string) => `${Number(q).toLocaleString("es-AR", { maximumFractionDigits: 2 })} ${mat.get(mid)?.unit || ""}`.trim()
    out.pendientes = vinculos
      .filter((v) => v.estado === "pendiente")
      .map((v) => {
        const t = textoMotivo(v.motivo_codigo, v.motivo)
        const ce = v.candidato_id ? cand.get(v.candidato_id) : null
        return {
          id: v.id,
          clave: v.clave,
          fecha: v.fecha,
          remito: v.remito,
          proveedor: v.proveedor,
          articulo: v.articulo,
          cantidad: textoCantidad(v.cantidad_zomatik, v.unidad_zomatik),
          planta: v.plant_id ? nombrePlanta.get(v.plant_id) || "-" : "otro depósito",
          motivo: t.motivo,
          motivo_codigo: v.motivo_codigo,
          queHacer: t.queHacer,
          primera_vez_at: v.primera_vez_at,
          resolucion: v.resolucion,
          resuelto_por: v.resuelto_por,
          candidato: ce
            ? { id: ce.id, fecha: fechaArgentina(ce.entry_date), remito: ce.remito, cantidad: cantMat(ce.quantity, ce.material_id), material: mat.get(ce.material_id)?.name || "-", planta: nombrePlanta.get(mat.get(ce.material_id)?.plant_id) || "-" }
            : null,
        }
      })
      .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))
    out.antesDeF = vinculos.filter((v) => v.motivo_codigo === "antes_de_f").map((v) => ({ fecha: v.fecha, remito: v.remito, motivo: v.motivo }))
    out.noAplicados = vinculos
      .filter((v) => (v.estado === "importado" || v.estado === "anulado") && v.motivo && v.motivo_codigo !== "antes_de_f")
      .map((v) => ({
        fecha: v.fecha,
        remito: v.remito,
        proveedor: v.proveedor,
        cantidad: textoCantidad(v.cantidad_zomatik, v.unidad_zomatik),
        planta: v.plant_id ? nombrePlanta.get(v.plant_id) || "-" : "otro depósito",
        motivo: v.motivo,
        actualizado: v.actualizado_at,
      }))
    out.cambios = (((movs as any).data as any[]) || []).map((m) => ({
      creado: m.created_at,
      fecha: m.movement_date,
      material: mat.get(m.material_id)?.name || "-",
      planta: nombrePlanta.get(mat.get(m.material_id)?.plant_id) || "-",
      kg: Number(m.quantity_kg) || 0,
      nota: m.notes || "",
    }))
    // Manuales desde F sin vincular (ni propuestos como "¿mismo camión?"), de materiales que entran desde Zomatik
    const propuestos = new Set(candidatos)
    const hoy = fechaArgentina(ahora)
    const vista = (e: any, extra: Partial<ManualVista> = {}): ManualVista => {
      const m = mat.get(e.material_id)
      return {
        id: e.id,
        fecha: fechaArgentina(e.entry_date),
        material: m?.name || "-",
        planta: nombrePlanta.get(m?.plant_id) || "-",
        cantidad: Number(e.quantity) || 0,
        unidad: m?.unit || "",
        remito: e.remito,
        cargadoPor: e.created_by,
        creado: e.created_at,
        dias: Math.floor((ahora - Date.parse(e.created_at)) / 86_400_000),
        ...extra,
      }
    }
    const sueltos = manRows.filter((e) => e.origen !== "zomatik" && !propuestos.has(e.id) && TIPOS_IMPORTABLES.includes(mat.get(e.material_id)?.tipo || ""))
    // "Posible copia de un importado": mismo remito completo (punto de venta + número) y material que uno de Zomatik
    const copias = posiblesCopias(sueltos, vinculos)
    const esCopia = new Set(copias.map((x) => x.id))
    out.copias = copias.map((e) => vista(e, { remitoZomatik: e.remitoZomatik })).sort((a, b) => b.fecha.localeCompare(a.fecha))
    // "Cargados a mano sin Zomatik": los demás sin vincular, de más de 7 días
    const vinculadas = new Set(vinculos.map((v) => v.stock_entry_id).filter(Boolean))
    out.manuales = sueltos
      .filter((e) => !vinculadas.has(e.id) && !esCopia.has(e.id) && fechaArgentina(e.entry_date) < sumarDias(hoy, -MANUAL_SIN_ZOMATIK_DIAS))
      .map((e) => vista(e))
      .sort((a, b) => b.fecha.localeCompare(a.fecha))
    const prov = new Map<string, number>()
    for (const e of (((sinProv as any).data as any[]) || [])) prov.set(e.supplier || "(sin proveedor)", (prov.get(e.supplier || "(sin proveedor)") || 0) + 1)
    out.sinVincular = [...prov].map(([proveedor, renglones]) => ({ proveedor, renglones })).sort((a, b) => b.renglones - a.renglones)
  } catch (e) {
    out.error = faltaMigracion(e) ? MENSAJE_SIN_MIGRACION : textoError(e)
  }
  return out
}

/**
 * Para el cruce viejo (fase 2): lo que ya maneja la importación no se cruza. Ingresos vinculados y renglones de la copia
 * cuya clave tiene vínculo (importado, emparejado o anulado). Sin la migración, vacío.
 */
export async function vinculadosParaCruce(sb: SB): Promise<{ entradas: Set<string>; claves: Set<string> } | null> {
  try {
    const vs = await todas<any>((a, b) => sb.from("zomatik_ingresos_mp").select("clave, estado, stock_entry_id").in("estado", ["importado", "emparejado", "anulado"]).order("id").range(a, b))
    return { entradas: new Set(vs.map((v) => v.stock_entry_id).filter(Boolean)), claves: new Set(vs.map((v) => v.clave)) }
  } catch {
    return null
  }
}

export const claveDeCopia = (z: { remito: string; codigo?: string | null; articulo: string }) => claveRemito(z.remito, z.codigo, z.articulo)

/** Para el aviso en Materias Primas: ¿esta persona es encargada de alguna planta? */
export const plantasDeEncargado = (nombre: string | null | undefined) =>
  Object.entries(ENCARGADO_PLANTA)
    .filter(([, n]) => n.toLowerCase() === String(nombre || "").trim().toLowerCase())
    .map(([p]) => p)
