/**
 * Control de ingresos de materia prima · SOLO servidor. Lee Zomatik (ESTAD R.COMPRA, solo lectura, lista cerrada de
 * lib/zomatik/web.ts), guarda la copia, cruza contra stock_entries, actualiza las diferencias y manda el mail.
 *
 * Nunca escribe en Zomatik ni en stock_entries. Escribe solo zomatik_remitos_compra (+ _dias), control_mp_diferencias y
 * control_mp_corridas, con la clave de servicio. Especificación: docs/control-ingresos-mp.md.
 *
 * Reglas de Zomatik (zomatik.md 23 y 24): mismo turno del robot que la lectura diaria y la NP
 * (zomatik_robot_tomar/soltar); la sucursal la comparte el usuario, así que antes y después de cada export se confirma
 * en la página que la sesión está en la 18. Si no, ese tramo no se guarda ni cuenta como leído.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { obtenerSesion, discoverForm, fetchExportEnSucursal, ZomatikError, type FormInfo, type ZomatikSesion } from "@/lib/zomatik/cliente"
import { textoError } from "@/lib/zomatik/lectura"
import type { Fila } from "@/lib/zomatik/parseo"
import { puedeBorrarViejos } from "@/lib/zomatik/foto"
import {
  conClaves,
  cruzar,
  desdeVentana,
  evaluable,
  fechaArgentina,
  fechasDe,
  filasCopia,
  planDeEstados,
  sumarDias,
  tramosLectura,
  ordenTramos,
  CATEGORIAS,
  DEPOSITOS,
  MARGEN_DIAS,
  type Diferencia,
  type Guardada,
  type IngresoNuestro,
  type OpcionesCruce,
  type RemitoZomatik,
  type Tramo,
} from "@/lib/control-ingresos/cruce"
import { armarMail, type DiferenciaMail } from "@/lib/control-ingresos/mail"
import { puedeCon, tipoDe, type UsuarioPermisos } from "@/lib/permisos"

/** Quién usa el control: los gerenciales o quien tenga materia_prima.editar (se controla en el servidor). */
export const puedeControlar = (u: UsuarioPermisos) => tipoDe(u) === "gerencial" || puedeCon(u, "materia_prima", "editar")

const LISTADO = "reporte_remitoscompra.php"
/** maxDuration = 300 s (como Concretus con este listado en Hobby). La lectura de Zomatik termina a los 220 s del pedido. */
export const LECTURA_HASTA_MS = 220_000
/** No se arranca un tramo con menos de esto. */
const MINIMO_TRAMO_MS = 25_000
/** Espera del turno del robot (dentro del presupuesto de lectura). */
const ESPERA_TURNO_MS = 20_000
/** Si un export trae esto o más, puede venir cortado: se parte el tramo. */
const SOSPECHA_CORTE = 150
/** Un día de Zomatik cuenta como leído si se leyó en las últimas 30 h. */
export const FRESCO_MS = 30 * 3600_000
export const LINK_PANTALLA = "https://www.produccionrebucret.com/materias-primas?tab=control"
/** Mail: a Juan, con copia a Bautista (por nombre en app_users, como lib/carga/servidor.ts). */
export const MAIL_A = ["Juan Oreguy"]
export const MAIL_CC = ["Bautista Caputo"]
const FROM = process.env.REPORTE_CALIDAD_FROM || "reportes@produccionrebucret.com"

// ---------------------------------------------------------------------------
// Lectura de Zomatik
// ---------------------------------------------------------------------------

export type ResultadoTramo = Tramo & { ok: boolean; filas?: number; motivo?: string }

const errorFormato = (m: string) => new ZomatikError("formato", m)
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))
const esDeSucursal = (e: unknown) => /otra sucursal|no se ve la sucursal/i.test((e as Error)?.message || "")

type Fila_ = NonNullable<ReturnType<typeof filasCopia>[number]>

/**
 * Lee un tramo (Canning, Hudson y todos los depósitos) sin grabar nada. Si un export viene sospechoso de corte, se parte
 * en dos (hasta 1 día) y se leen las dos mitades: o termina entero o tira error (el tramo no cuenta como leído).
 */
async function filasTramo(s: ZomatikSesion, form: FormInfo, t: Tramo, limite: number): Promise<Fila_[]> {
  if (Date.now() > limite - 10_000) throw errorFormato("sin tiempo para terminar el tramo")
  const exportar = (deposito: string) => fetchExportEnSucursal(s, LISTADO, form, { desde: t.desde, hasta: t.hasta, extra: { bus_deposito: deposito } })
  const porDeposito: { deposito: number; filas: Fila[] }[] = []
  for (const d of DEPOSITOS) porDeposito.push({ deposito: d.id, filas: await exportar(String(d.id)) })
  const todos = await exportar("")
  const sospechoso = [...porDeposito.map((d) => d.filas.length), todos.length].some((n) => n >= SOSPECHA_CORTE)
  if (sospechoso && t.desde < t.hasta) {
    const medio = sumarDias(t.desde, Math.floor((Date.parse(t.hasta) - Date.parse(t.desde)) / 86_400_000 / 2))
    return [...(await filasTramo(s, form, { desde: sumarDias(medio, 1), hasta: t.hasta }, limite)), ...(await filasTramo(s, form, { desde: t.desde, hasta: medio }, limite))]
  }
  const filas = filasCopia(porDeposito, todos).filter((f): f is Fila_ => !!f && f.fecha >= t.desde && f.fecha <= t.hasta)
  // Señales de que el export vino de otra sucursal aunque la página diga 18
  const nuestras = filas.filter((f) => f.deposito !== null).length
  if (nuestras === 0 && filas.length > 0) throw errorFormato(`otra sucursal: Canning y Hudson vinieron vacíos y "todos" trajo ${filas.length}`)
  if (filas.some((f) => /^\s*CCTS\s/i.test(f.articulo))) throw errorFormato("otra sucursal: vinieron artículos CCTS (de Concretus)")
  return filas
}

async function diasLeidos(sb: SupabaseClient, desde: string): Promise<Map<string, string>> {
  const { data, error } = await sb.from("zomatik_remitos_compra_dias").select("fecha, leido_at").gte("fecha", desde).limit(2000)
  if (error) throw error
  return new Map(((data as any[]) || []).map((d) => [d.fecha, d.leido_at]))
}

/**
 * Lee de Zomatik la ventana, con el turno del robot, hasta `t0 + LECTURA_HASTA_MS` (la espera del turno cuenta). Cada
 * tramo leído entero se graba con sus días marcados como leídos; si no, no cuenta. No corta: devuelve lo que pudo.
 */
export async function leerZomatikCompras(sb: SupabaseClient, desde: string, hoy: string, t0: number): Promise<{ ok: boolean; tramos: ResultadoTramo[]; error?: string }> {
  const limite = t0 + LECTURA_HASTA_MS
  const quien = `control-mp·${t0.toString(36)}`
  // Mismo turno que la lectura diaria y el robot de las NP (pg_cron cada 10 min)
  let { data, error } = await sb.rpc("zomatik_robot_tomar", { p_quien: quien, p_segundos: 90 })
  while (!error && data !== true && Date.now() - t0 < ESPERA_TURNO_MS) {
    await espera(3_000)
    ;({ data, error } = await sb.rpc("zomatik_robot_tomar", { p_quien: quien, p_segundos: 90 }))
  }
  if (error) return { ok: false, tramos: [], error: "Falta la migración del turno de Zomatik (zomatik_robot_tomar)" }
  if (data !== true) return { ok: false, tramos: [], error: "Otro proceso estaba trabajando en Zomatik" }
  const renovar = setInterval(() => {
    sb.rpc("zomatik_robot_tomar", { p_quien: quien, p_segundos: 90 }).then(() => {}, () => {})
  }, 20_000)
  const tramos: ResultadoTramo[] = []
  try {
    const piso = sumarDias(desde, -MARGEN_DIAS)
    const [{ data: cfg }, leidos] = await Promise.all([sb.from("zomatik_np_config").select("plant_id, deposito"), diasLeidos(sb, piso)])
    const plantas = new Map<number, string>(((cfg as any[]) || []).filter((c) => c.deposito).map((c) => [Number(c.deposito), c.plant_id]))
    const s = await obtenerSesion()
    const form = await discoverForm(s, LISTADO)
    if (!("bus_deposito" in form.fields)) throw errorFormato("El buscador de ESTAD R.COMPRA no tiene el filtro de depósito (¿cambió la página?)")
    if (!form.fechaDesdeField || !form.fechaHastaField) throw errorFormato("El buscador de ESTAD R.COMPRA no tiene las fechas (¿cambió la página?)")
    for (const t of ordenTramos(tramosLectura(piso, hoy), leidos)) {
      if (limite - Date.now() < MINIMO_TRAMO_MS) {
        tramos.push({ ...t, ok: false, motivo: "sin tiempo (queda la lectura anterior)" })
        continue
      }
      try {
        let filas: Fila_[]
        try {
          filas = await filasTramo(s, form, t, limite)
        } catch (e) {
          // Otro sistema cambió la sucursal (Concretus, por ejemplo): un reintento en 15 s
          if (!esDeSucursal(e) || limite - Date.now() < MINIMO_TRAMO_MS + 15_000) throw e
          await espera(15_000)
          filas = await filasTramo(s, form, t, limite)
        }
        const copia = conClaves(filas).map((f) => ({ ...f, plant_id: f.deposito !== null ? plantas.get(f.deposito) ?? null : null }))
        const { count, error: eC } = await sb.from("zomatik_remitos_compra").select("id", { count: "exact", head: true }).gte("fecha", t.desde).lte("fecha", t.hasta)
        if (eC) throw eC
        if ((count || 0) >= 10 && !puedeBorrarViejos(copia.length, count || 0)) {
          tramos.push({ ...t, ok: false, filas: copia.length, motivo: `trajo ${copia.length} renglones y había ${count}: no se reemplazó` })
          continue
        }
        const { error: eR } = await sb.rpc("control_mp_reemplazar_zomatik", { p_desde: t.desde, p_hasta: t.hasta, p_filas: copia })
        if (eR) throw eR
        tramos.push({ ...t, ok: true, filas: copia.length })
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

async function upsertEnLotes(sb: SupabaseClient, filas: Record<string, unknown>[]) {
  for (let i = 0; i < filas.length; i += 500) {
    const { error } = await sb.from("control_mp_diferencias").upsert(filas.slice(i, i + 500), { onConflict: "clave" })
    if (error) throw error
  }
}

/** Graba el resultado del cruce en control_mp_diferencias (en lote: cada grupo con las mismas columnas). */
async function guardarDiferencias(sb: SupabaseClient, difs: Diferencia[], opts: OpcionesCruce): Promise<Record<string, number>> {
  const ahora = new Date().toISOString()
  const guardadas = await todasLasFilas<Guardada>((a, b) => sb.from("control_mp_diferencias").select("id, clave, estado, revisada_at, fecha, nuestro, zomatik").order("id").range(a, b))
  // Solo se resuelve lo que hoy se pudo controlar: dentro de la ventana y con Zomatik leído en esas fechas
  const plan = planDeEstados(difs, guardadas, (g) => evaluable(fechasDe(g as any), opts))
  // Siguen: solo el detalle (el estado, la nota y quién revisó no se tocan)
  await upsertEnLotes(sb, plan.siguen.map((r) => filaDif(r.d, ahora)))
  // Nuevas: abiertas
  await upsertEnLotes(sb, plan.nuevas.map((d) => ({ ...filaDif(d, ahora), estado: "abierta", detectada_at: ahora, resuelta_at: null })))
  // Volvieron: abiertas, o revisadas con su nota si alguien ya las había revisado (no vuelven al mail)
  await upsertEnLotes(sb, plan.reabiertas.map((r) => ({ ...filaDif(r.d, ahora), estado: r.revisada ? "revisada" : "abierta", detectada_at: ahora, resuelta_at: null })))
  for (let i = 0; i < plan.resueltas.length; i += 500) {
    const { error } = await sb.from("control_mp_diferencias").update({ estado: "resuelta", resuelta_at: ahora }).in("id", plan.resueltas.slice(i, i + 500))
    if (error) throw error
  }
  const resumen: Record<string, number> = { total: difs.length, nuevas: plan.nuevas.length + plan.reabiertas.filter((r) => !r.revisada).length, resueltas: plan.resueltas.length }
  for (const c of CATEGORIAS) resumen[c.clave] = difs.filter((d) => d.categoria === c.clave).length
  return resumen
}

/**
 * Un control: lee Zomatik (si `leer`), cruza y graba las diferencias. Con `mail`, manda el mail del día.
 * `corridaId` sale de control_mp_registrar (el freno). `t0` = cuándo empezó el pedido (para el presupuesto).
 */
export async function controlar(sb: SupabaseClient, opts: { corridaId: string; leer: boolean; mail: boolean; t0?: number }): Promise<ResultadoControl> {
  const t0 = opts.t0 ?? Date.now()
  const hoy = fechaArgentina(t0)
  const desde = desdeVentana(hoy)
  const res: ResultadoControl = { ok: true }
  try {
    if (opts.leer) res.lectura = await leerZomatikCompras(sb, desde, hoy, t0)
    const desdeMargen = sumarDias(desde, -MARGEN_DIAS)
    const [nuestros, zomatik, leidos] = await Promise.all([leerNuestros(sb, desdeMargen), leerCopiaZomatik(sb, desdeMargen), diasLeidos(sb, desdeMargen)])
    // Solo cuentan los días de Zomatik leídos en las últimas 30 h: lo demás no se informa ni se resuelve
    const frescos = new Set([...leidos].filter(([, l]) => Date.now() - Date.parse(l) <= FRESCO_MS).map(([d]) => d))
    if (frescos.size === 0) {
      res.ok = false
      res.motivo = `No hay una lectura reciente de Zomatik: no se controló${res.lectura?.error ? ` (${res.lectura.error})` : ""}`
    } else {
      const oc: OpcionesCruce = { hoy, desde, cubierto: (d) => frescos.has(d) }
      res.resumen = await guardarDiferencias(sb, cruzar(nuestros, zomatik, oc), oc)
      res.resumen.dias_leidos = frescos.size
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
