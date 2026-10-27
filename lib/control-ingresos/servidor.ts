/**
 * Control de ingresos de materia prima · SOLO servidor. Lee Zomatik (ESTAD R.COMPRA, solo lectura, lista cerrada de
 * lib/zomatik/web.ts), guarda la copia, cruza contra stock_entries, actualiza las diferencias y manda el mail.
 *
 * Nunca escribe en Zomatik ni en stock_entries. Escribe solo zomatik_remitos_compra, control_mp_diferencias y
 * control_mp_corridas, con la clave de servicio. Especificación: docs/control-ingresos-mp.md.
 *
 * Reglas de Zomatik (zomatik.md 23 y 24): mismo turno del robot que la lectura diaria y la NP
 * (zomatik_robot_tomar/soltar); la sucursal la comparte el usuario, así que se elige la 18 antes de cada export y
 * después se confirma en la página que sigue en la 18. Si no, ese tramo no se guarda.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { obtenerSesion, discoverForm, fetchExport, sucursalVisible, SUCURSAL_REBUCRET, ZomatikError } from "@/lib/zomatik/cliente"
import { textoError } from "@/lib/zomatik/lectura"
import type { Fila } from "@/lib/zomatik/parseo"
import { puedeBorrarViejos } from "@/lib/zomatik/foto"
import {
  conClaves,
  cruzar,
  desdeVentana,
  fechaArgentina,
  filasCopia,
  planDeEstados,
  sumarDias,
  tramosLectura,
  CATEGORIAS,
  DEPOSITOS,
  MARGEN_DIAS,
  type Diferencia,
  type Guardada,
  type IngresoNuestro,
  type RemitoZomatik,
  type Tramo,
} from "@/lib/control-ingresos/cruce"
import { armarMail, type DiferenciaMail } from "@/lib/control-ingresos/mail"
import { puedeCon, tipoDe, type UsuarioPermisos } from "@/lib/permisos"

/** Quién usa el control: los gerenciales o quien tenga materia_prima.editar (se controla en el servidor). */
export const puedeControlar = (u: UsuarioPermisos) => tipoDe(u) === "gerencial" || puedeCon(u, "materia_prima", "editar")

const LISTADO = "reporte_remitoscompra.php"
/** Vercel corta a los 60 s: la lectura de Zomatik usa como mucho esto desde que empieza el pedido. */
const PRESUPUESTO_ZOMATIK_MS = 38_000
/** Si un export trae esto o más, puede venir cortado: se parte el tramo. */
const SOSPECHA_CORTE = 150
export const LINK_PANTALLA = "https://www.produccionrebucret.com/materias-primas?tab=control"
/** Mail: a Juan, con copia a Bautista (por nombre en app_users, como lib/carga/servidor.ts). */
export const MAIL_A = ["Juan Oreguy"]
export const MAIL_CC = ["Bautista Caputo"]
const FROM = process.env.REPORTE_CALIDAD_FROM || "reportes@produccionrebucret.com"

// ---------------------------------------------------------------------------
// Lectura de Zomatik
// ---------------------------------------------------------------------------

export type ResultadoTramo = Tramo & { ok: boolean; filas?: number; motivo?: string }

const nuevoError = (m: string) => new ZomatikError("formato", m)

/** Export de un depósito (o de todos) confirmando que la página sigue en REBUCRET. */
async function exportarConfirmado(s: Awaited<ReturnType<typeof obtenerSesion>>, form: Awaited<ReturnType<typeof discoverForm>>, t: Tramo, deposito: string): Promise<Fila[]> {
  const extra: Record<string, string> = { bus_deposito: deposito }
  if ("bus_sucursal" in form.fields) extra.bus_sucursal = SUCURSAL_REBUCRET
  const filas = await fetchExport(s, LISTADO, form, { desde: t.desde, hasta: t.hasta, extra }) // elige la 18 antes
  const suc = await sucursalVisible(s, LISTADO)
  if (suc !== SUCURSAL_REBUCRET) throw nuevoError(`la lectura vino de otra sucursal (${suc ?? "?"}): otro sistema la cambió`)
  return filas
}

/**
 * Lee un tramo (Canning, Hudson y todos los depósitos) y lo graba en la copia. Si un export viene sospechoso de corte,
 * se parte en dos (hasta 1 día). Devuelve los tramos efectivamente leídos.
 */
async function leerTramo(
  sb: SupabaseClient,
  s: Awaited<ReturnType<typeof obtenerSesion>>,
  form: Awaited<ReturnType<typeof discoverForm>>,
  t: Tramo,
  plantas: Map<number, string>,
  queda: () => number,
): Promise<ResultadoTramo[]> {
  if (queda() < 8_000) return [{ ...t, ok: false, motivo: "sin tiempo (queda la lectura anterior)" }]
  const porDeposito: { deposito: number; filas: Fila[] }[] = []
  for (const d of DEPOSITOS) porDeposito.push({ deposito: d.id, filas: await exportarConfirmado(s, form, t, String(d.id)) })
  const todos = await exportarConfirmado(s, form, t, "")
  const sospechoso = [...porDeposito.map((d) => d.filas.length), todos.length].some((n) => n >= SOSPECHA_CORTE)
  if (sospechoso && t.desde < t.hasta) {
    const medio = sumarDias(t.desde, Math.floor((Date.parse(t.hasta) - Date.parse(t.desde)) / 86_400_000 / 2))
    return [...(await leerTramo(sb, s, form, { desde: sumarDias(medio, 1), hasta: t.hasta }, plantas, queda)), ...(await leerTramo(sb, s, form, { desde: t.desde, hasta: medio }, plantas, queda))]
  }
  const filas = conClaves(filasCopia(porDeposito, todos).filter((f): f is NonNullable<typeof f> => !!f && f.fecha >= t.desde && f.fecha <= t.hasta)).map((f) => ({
    ...f,
    plant_id: f.deposito !== null ? plantas.get(f.deposito) ?? null : null,
  }))
  const { count, error: eC } = await sb.from("zomatik_remitos_compra").select("id", { count: "exact", head: true }).gte("fecha", t.desde).lte("fecha", t.hasta)
  if (eC) throw eC
  if ((count || 0) >= 10 && !puedeBorrarViejos(filas.length, count || 0))
    return [{ ...t, ok: false, filas: filas.length, motivo: `trajo ${filas.length} renglones y había ${count}: no se reemplazó` }]
  const { error } = await sb.rpc("control_mp_reemplazar_zomatik", { p_desde: t.desde, p_hasta: t.hasta, p_filas: filas })
  if (error) throw error
  return [{ ...t, ok: true, filas: filas.length, motivo: sospechoso ? "un día con muchos renglones: revisar si vino cortado" : undefined }]
}

/** Lee de Zomatik la ventana, con el turno del robot. No corta: devuelve lo que pudo y por qué no lo demás. */
export async function leerZomatikCompras(sb: SupabaseClient, desde: string, hoy: string, t0: number): Promise<{ ok: boolean; tramos: ResultadoTramo[]; error?: string }> {
  const queda = () => PRESUPUESTO_ZOMATIK_MS - (Date.now() - t0)
  const quien = `control-mp·${t0.toString(36)}`
  // Mismo turno que la lectura diaria y el robot de las NP (pg_cron cada 10 min): se espera hasta ~20 s
  let { data, error } = await sb.rpc("zomatik_robot_tomar", { p_quien: quien, p_segundos: 90 })
  while (!error && data !== true && Date.now() - t0 < 20_000) {
    await new Promise((r) => setTimeout(r, 3_000))
    ;({ data, error } = await sb.rpc("zomatik_robot_tomar", { p_quien: quien, p_segundos: 90 }))
  }
  if (error) return { ok: false, tramos: [], error: "Falta la migración del turno de Zomatik (zomatik_robot_tomar)" }
  if (data !== true) return { ok: false, tramos: [], error: "Otro proceso estaba trabajando en Zomatik" }
  const renovar = setInterval(() => {
    sb.rpc("zomatik_robot_tomar", { p_quien: quien, p_segundos: 90 }).then(() => {}, () => {})
  }, 20_000)
  const tramos: ResultadoTramo[] = []
  try {
    const { data: cfg } = await sb.from("zomatik_np_config").select("plant_id, deposito")
    const plantas = new Map<number, string>(((cfg as any[]) || []).filter((c) => c.deposito).map((c) => [Number(c.deposito), c.plant_id]))
    const s = await obtenerSesion()
    const form = await discoverForm(s, LISTADO)
    for (const t of tramosLectura(sumarDias(desde, -MARGEN_DIAS), hoy)) {
      try {
        tramos.push(...(await leerTramo(sb, s, form, t, plantas, queda)))
      } catch (e) {
        tramos.push({ ...t, ok: false, motivo: textoError(e) })
        if (e instanceof ZomatikError && ["sin_credenciales", "login_rechazado", "login_bloqueado", "sesion_caida"].includes(e.codigo)) break
      }
    }
    const fallas = tramos.filter((t) => !t.ok)
    return { ok: fallas.length === 0, tramos, error: fallas.length ? fallas.map((f) => `${f.desde} a ${f.hasta}: ${f.motivo}`).join(" · ") : undefined }
  } catch (e) {
    return { ok: false, tramos, error: textoError(e) }
  } finally {
    clearInterval(renovar)
    await sb.rpc("zomatik_robot_soltar", { p_quien: quien })
  }
}

// ---------------------------------------------------------------------------
// Lectura de la base
// ---------------------------------------------------------------------------

async function todasLasFilas<T>(q: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; ; i += 1000) {
    const { data, error } = await q(i, i + 999)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return out
}

/** Nuestros ingresos desde `desde` (fecha de Argentina), con planta, material, proveedor y transportista. */
export async function leerNuestros(sb: SupabaseClient, desde: string): Promise<IngresoNuestro[]> {
  const filas = await todasLasFilas<any>((a, b) =>
    sb
      .from("stock_entries")
      .select("id, entry_date, quantity, original_quantity, remito, notes, created_by, materials(name, plant_id, plants(name)), suppliers(name), carriers(name)")
      .gte("entry_date", `${desde}T03:00:00.000Z`)
      .order("id")
      .range(a, b),
  )
  return filas.map((e) => ({
    id: e.id,
    fecha: fechaArgentina(e.entry_date),
    plantaId: e.materials?.plant_id ?? null,
    planta: e.materials?.plants?.name || "-",
    material: e.materials?.name || "-",
    // La cantidad del remito (antes de corregir la humedad)
    cantidad: Number(e.original_quantity ?? e.quantity) || 0,
    remito: e.remito ?? null,
    proveedor: e.suppliers?.name?.trim() || null,
    transportista: e.carriers?.name?.trim() || null,
    notas: e.notes?.trim() || null,
    cargadoPor: e.created_by ?? null,
  }))
}

export async function leerCopiaZomatik(sb: SupabaseClient, desde: string): Promise<RemitoZomatik[]> {
  const [filas, plantas] = await Promise.all([
    todasLasFilas<any>((a, b) => sb.from("zomatik_remitos_compra").select("clave, fecha, remito, proveedor, articulo, cantidad, transportista, deposito, plant_id").gte("fecha", desde).order("id").range(a, b)),
    sb.from("plants").select("id, name"),
  ])
  const nombre = new Map(((plantas.data as any[]) || []).map((p) => [p.id, p.name]))
  return filas.map((z) => ({
    clave: z.clave,
    fecha: z.fecha,
    plantaId: z.plant_id ?? null,
    planta: z.plant_id ? nombre.get(z.plant_id) || "-" : "otro depósito",
    articulo: z.articulo,
    cantidad: Number(z.cantidad) || 0,
    remito: z.remito,
    proveedor: z.proveedor ?? null,
    transportista: z.transportista ?? null,
  }))
}

// ---------------------------------------------------------------------------
// Corrida completa
// ---------------------------------------------------------------------------

export type ResultadoControl = {
  ok: boolean
  motivo?: string
  lectura?: { ok: boolean; tramos: ResultadoTramo[]; error?: string }
  resumen?: Record<string, number>
  mail?: { enviado: boolean; a: string[]; motivo?: string }
}

const filaDif = (d: Diferencia, ahora: string) => ({
  clave: d.clave,
  categoria: d.categoria,
  tipo: d.tipo,
  fecha: d.fecha,
  plant_id: d.plantaId && /^[0-9a-f-]{36}$/i.test(d.plantaId) ? d.plantaId : null,
  detalle: d.detalle,
  nuestro: d.nuestro,
  zomatik: d.zomatik,
  vista_at: ahora,
})

/** Graba el resultado del cruce en control_mp_diferencias. */
async function guardarDiferencias(sb: SupabaseClient, difs: Diferencia[]): Promise<Record<string, number>> {
  const ahora = new Date().toISOString()
  const guardadas = await todasLasFilas<Guardada>((a, b) => sb.from("control_mp_diferencias").select("id, clave, estado").order("id").range(a, b))
  const plan = planDeEstados(difs, guardadas)
  for (let i = 0; i < plan.nuevas.length; i += 200) {
    const { error } = await sb.from("control_mp_diferencias").insert(plan.nuevas.slice(i, i + 200).map((d) => ({ ...filaDif(d, ahora), estado: "abierta", detectada_at: ahora })))
    if (error) throw error
  }
  for (const r of plan.reabiertas) {
    const { error } = await sb
      .from("control_mp_diferencias")
      .update({ ...filaDif(r.d, ahora), estado: "abierta", detectada_at: ahora, resuelta_at: null, nota: null, revisada_por: null, revisada_at: null })
      .eq("id", r.id)
    if (error) throw error
  }
  for (const r of plan.siguen) {
    const { error } = await sb.from("control_mp_diferencias").update(filaDif(r.d, ahora)).eq("id", r.id)
    if (error) throw error
  }
  if (plan.resueltas.length) {
    const { error } = await sb.from("control_mp_diferencias").update({ estado: "resuelta", resuelta_at: ahora }).in("id", plan.resueltas)
    if (error) throw error
  }
  const resumen: Record<string, number> = { total: difs.length, nuevas: plan.nuevas.length + plan.reabiertas.length, resueltas: plan.resueltas.length }
  for (const c of CATEGORIAS) resumen[c.clave] = difs.filter((d) => d.categoria === c.clave).length
  return resumen
}

/**
 * Un control: lee Zomatik (si `leer`), cruza y graba las diferencias. Con `mail`, manda el mail del día.
 * `corridaId` sale de control_mp_registrar (el freno).
 */
export async function controlar(sb: SupabaseClient, opts: { corridaId: string; leer: boolean; mail: boolean; t0?: number }): Promise<ResultadoControl> {
  const t0 = opts.t0 ?? Date.now()
  const hoy = fechaArgentina(t0)
  const desde = desdeVentana(hoy)
  const res: ResultadoControl = { ok: true }
  try {
    if (opts.leer) res.lectura = await leerZomatikCompras(sb, desde, hoy, t0)
    const desdeMargen = sumarDias(desde, -MARGEN_DIAS)
    const [nuestros, zomatik] = await Promise.all([leerNuestros(sb, desdeMargen), leerCopiaZomatik(sb, desdeMargen)])
    if (zomatik.length === 0) {
      // Sin copia de Zomatik todo saldría como "falta en Zomatik": no se cruza
      res.ok = false
      res.motivo = `Todavía no hay remitos de Zomatik guardados${res.lectura?.error ? ` (${res.lectura.error})` : ""}`
    } else {
      res.resumen = await guardarDiferencias(sb, cruzar(nuestros, zomatik, { hoy, desde }))
      if (res.lectura && !res.lectura.ok) res.ok = false
    }
    if (opts.mail) res.mail = await mandarMail(sb, hoy, res)
  } catch (e) {
    res.ok = false
    res.motivo = textoError(e)
  }
  await sb
    .from("control_mp_corridas")
    .update({
      fin: new Date().toISOString(),
      ok: res.ok,
      lectura: res.lectura ?? null,
      resumen: res.resumen ?? null,
      error: [res.motivo, res.lectura?.error, res.mail && !res.mail.enviado ? `mail: ${res.mail.motivo}` : null].filter(Boolean).join(" · ").slice(0, 2000) || null,
      mail_at: res.mail?.enviado ? new Date().toISOString() : null,
      mail_a: res.mail?.enviado ? res.mail.a : null,
    })
    .eq("id", opts.corridaId)
  return res
}

// ---------------------------------------------------------------------------
// Mail
// ---------------------------------------------------------------------------

async function mailsDe(sb: SupabaseClient, nombres: string[]): Promise<string[]> {
  const { data } = await sb.from("app_users").select("name, email").eq("active", true).not("email", "is", null)
  return ((data || []) as { name: string; email: string }[]).filter((u) => nombres.some((n) => n.toLowerCase() === u.name.trim().toLowerCase())).map((u) => u.email)
}

/**
 * Mail del día: sale si hay diferencias abiertas (nuevas o de antes). Una vez por día como mucho. "Nuevas" = abiertas
 * desde el último mail mandado (o de las últimas 24 h si nunca se mandó). Si no se pudo leer Zomatik, se avisa arriba;
 * si además no hay nada abierto, va solo a Bautista.
 */
async function mandarMail(sb: SupabaseClient, hoy: string, res: ResultadoControl): Promise<{ enviado: boolean; a: string[]; motivo?: string }> {
  const { data: previos } = await sb.from("control_mp_corridas").select("mail_at").not("mail_at", "is", null).order("mail_at", { ascending: false }).limit(1)
  const ultimo = (previos as any[])?.[0]?.mail_at as string | undefined
  if (ultimo && fechaArgentina(ultimo) === hoy) return { enviado: false, a: [], motivo: "ya se mandó hoy" }
  const { data, error } = await sb.from("control_mp_diferencias").select("categoria, fecha, detalle, nuestro, zomatik, detectada_at").eq("estado", "abierta").order("fecha")
  if (error) throw error
  const abiertas = (data || []) as (DiferenciaMail & { detectada_at: string })[]
  const corte = ultimo ? Date.parse(ultimo) : Date.now() - 24 * 3600_000
  const nuevas = abiertas.filter((d) => Date.parse(d.detectada_at) > corte)
  const siguen = abiertas.filter((d) => Date.parse(d.detectada_at) <= corte)
  const fallo = res.motivo || res.lectura?.error
  const aviso = fallo ? `Hoy no se pudo leer todo de Zomatik (${fallo}). El control usa la última lectura guardada.` : null
  if (!abiertas.length && !aviso) return { enviado: false, a: [], motivo: "sin diferencias abiertas" }
  if (!process.env.RESEND_API_KEY) return { enviado: false, a: [], motivo: "falta RESEND_API_KEY" }
  const soloBautista = !abiertas.length
  const to = await mailsDe(sb, soloBautista ? MAIL_CC : MAIL_A)
  const cc = soloBautista ? [] : await mailsDe(sb, MAIL_CC)
  if (!to.length) return { enviado: false, a: [], motivo: `${(soloBautista ? MAIL_CC : MAIL_A).join(", ")} sin mail cargado` }
  const { asunto, html } = armarMail({ nuevas, siguen, link: LINK_PANTALLA, aviso, hoy })
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: `Rebucret - Control MP <${FROM}>`, to, cc: cc.length ? cc : undefined, subject: soloBautista ? "Rebucret · Control de ingresos MP: no se pudo leer Zomatik" : asunto, html }),
  })
  if (!r.ok) return { enviado: false, a: to, motivo: `Resend respondió ${r.status}` }
  return { enviado: true, a: [...to, ...cc] }
}
