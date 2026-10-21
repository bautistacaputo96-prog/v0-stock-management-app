/**
 * Cliente de Zomatik (concretus.zomatik.com) — SOLO servidor y SOLO LECTURA (etapa Z0).
 *
 * Adaptado de `lib/zomatik.ts` del repo de Concretus. Zomatik no tiene API: se usa como un navegador.
 *   1. Login con ZOMATIK_USER / ZOMATIK_PASS (variables de Vercel) → cookie de sesión.
 *   2. Sucursal REBUCRET (selsuc=18) antes de leer.
 *   3. Cada listado: GET de la página para descubrir los campos del buscador y POST `?enviado=1` con
 *      exportar=1 (XLSX) o sin exportar (HTML, que trae los links con los códigos internos).
 *
 * Reglas (spec, puntos 10, 12 y 17.6):
 *   - Lista cerrada de rutas: solo login, home (sucursal), buscadores de listados y reportes (`?enviado=1`),
 *     fichas de cliente por GET y el XLS de un acopio. Cualquier otra ruta (manage_*, grabar_*, generar_*, set_*,
 *     _get*) se rechaza ANTES de salir. En esta etapa no hay ninguna función que escriba en Zomatik.
 *   - Un login por corrida como máximo (y por proceso, uno cada 10 min). La cookie se reutiliza (en memoria y en `integraciones`, que solo lee
 *     la clave de servicio). Si Zomatik rechaza el usuario, no se vuelve a intentar por 30 min en ningún proceso:
 *     muchos logins fallidos pueden bloquear el usuario (es el de Bautista).
 *   - ~300 ms entre requests.
 */
import * as XLSX from "xlsx"
import { sbAdmin } from "@/lib/wialon"
import { parseHtmlTable, type Fila } from "@/lib/zomatik/parseo"
import { ZOMATIK_WEB } from "@/lib/zomatik/web"

export const ZOMATIK_BASE = ZOMATIK_WEB
/** Sucursal REBUCRET en el selector global (spec 3). */
export const SUCURSAL_REBUCRET = "18"
/** Pausa entre requests. */
const PAUSA_MS = 300
/** Cookie guardada: se reusa mientras tenga menos de esto. */
const VIDA_COOKIE_MS = 20 * 60 * 1000
/** Después de un rechazo de usuario o clave, nadie vuelve a intentar por este tiempo. */
const BLOQUEO_LOGIN_MS = 30 * 60 * 1000
const TIMEOUT_MS = 25_000

const CLAVE_SESION = "zomatik_sesion"
const CLAVE_BLOQUEO = "zomatik_login_bloqueado"

export class ZomatikError extends Error {
  codigo: "sin_credenciales" | "login_rechazado" | "login_bloqueado" | "sin_respuesta" | "ruta_no_permitida" | "sesion_caida" | "formato"
  constructor(codigo: ZomatikError["codigo"], mensaje: string) {
    super(mensaje)
    this.name = "ZomatikError"
    this.codigo = codigo
  }
}

export type ZomatikSesion = { cookie: string }

export type FormInfo = {
  /** nombre → valor por defecto (el elegido en los select, el value en los input). */
  fields: Record<string, string>
  fechaDesdeField: string | null
  fechaHastaField: string | null
}

// ---------------------------------------------------------------------------
// Lista cerrada de rutas (solo lectura)
// ---------------------------------------------------------------------------

const PROHIBIDO = /(^|\/)(manage_|grabar_|generar_|set_|_get|_validar|_traer|eliminar|borrar|anular|modificar_(?!clientes\.php\?codigo=\d+$))/i

/** ¿Se puede pedir esta ruta? `metodo` POST solo para login, sucursal y buscadores (`?enviado=1`). */
export function rutaPermitida(path: string, metodo: "GET" | "POST"): boolean {
  const p = path.replace(/^\/+/, "")
  if (PROHIBIDO.test(p)) return false
  if (metodo === "POST") {
    if (p === "index.php?a=1" || p === "home.php") return true
    return /^(listado|reporte)_[a-z_]+\.php\?enviado=1$/i.test(p)
  }
  if (p === "home.php") return true
  if (/^(listado|reporte)_[a-z_]+\.php$/i.test(p)) return true
  if (/^modificar_clientes\.php\?codigo=\d+$/i.test(p)) return true
  if (/^exportar_acopio\.php\?acopio=\d+$/i.test(p)) return true
  return false
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

let ultimoRequest = 0
async function pausa() {
  const espera = ultimoRequest + PAUSA_MS - Date.now()
  if (espera > 0) await new Promise((r) => setTimeout(r, espera))
  ultimoRequest = Date.now()
}

async function pedir(cookie: string | null, path: string, init: RequestInit & { method?: "GET" | "POST" } = {}): Promise<Response> {
  const metodo = (init.method || "GET") as "GET" | "POST"
  if (!rutaPermitida(path, metodo)) throw new ZomatikError("ruta_no_permitida", `Ruta de Zomatik no permitida en solo lectura: ${metodo} ${path.split("?")[0]}`)
  await pausa()
  const ctrl = new AbortController()
  const corte = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    return await fetch(`${ZOMATIK_BASE}/${path.replace(/^\/+/, "")}`, {
      ...init,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(init.headers || {}) },
      redirect: init.redirect || "follow",
      cache: "no-store",
      signal: ctrl.signal,
    })
  } catch (e: any) {
    throw new ZomatikError("sin_respuesta", e?.name === "AbortError" ? "Zomatik no respondió a tiempo" : "No se pudo conectar con Zomatik")
  } finally {
    clearTimeout(corte)
  }
}

const sesionCaida = (html: string) => /name\s*=\s*["']?clave["']?/i.test(html) && /name\s*=\s*["']?usuario["']?/i.test(html)

export async function fetchRaw(s: ZomatikSesion, path: string, init: RequestInit & { method?: "GET" | "POST" } = {}): Promise<Buffer> {
  const r = await pedir(s.cookie, path, init)
  return Buffer.from(await r.arrayBuffer())
}

/** Texto (Zomatik sirve ISO-8859-1). Si la página es el login, la sesión se cayó. */
export async function fetchText(s: ZomatikSesion, path: string, init: RequestInit & { method?: "GET" | "POST" } = {}): Promise<string> {
  const html = (await fetchRaw(s, path, init)).toString("latin1")
  if (sesionCaida(html)) throw new ZomatikError("sesion_caida", "La sesión de Zomatik se cerró")
  return html
}

// ---------------------------------------------------------------------------
// Sesión: un login por proceso, cookie reutilizada, sin reintentos en bucle
// ---------------------------------------------------------------------------

let sesionProceso: { cookie: string; desde: number } | null = null
/** Último intento de login de este proceso: como mucho uno cada 10 min (nunca en bucle). */
let ultimoIntentoLogin = 0
const ENTRE_LOGINS_MS = 10 * 60 * 1000

/** Sin clave de servicio (pruebas locales) no se guarda ni se lee nada de la base. */
const hayBase = () => !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)

async function leerIntegracion(clave: string): Promise<{ valor: string; actualizado: string | null } | null> {
  if (!hayBase()) return null
  try {
    const { data } = await sbAdmin().from("integraciones").select("valor, actualizado").eq("clave", clave).maybeSingle()
    return (data as any) || null
  } catch {
    return null
  }
}

async function guardarIntegracion(clave: string, valor: string) {
  if (!hayBase()) return
  try {
    await sbAdmin().from("integraciones").upsert({ clave, valor, actualizado: new Date().toISOString(), conectado_por: "sistema" } as any, { onConflict: "clave" })
  } catch {
    /* no corta la lectura */
  }
}

async function borrarIntegracion(clave: string) {
  if (!hayBase()) return
  try {
    await sbAdmin().from("integraciones").delete().eq("clave", clave)
  } catch {
    /* no corta la lectura */
  }
}

async function login(): Promise<string> {
  const user = process.env.ZOMATIK_USER
  const pass = process.env.ZOMATIK_PASS
  if (!user || !pass) throw new ZomatikError("sin_credenciales", "Faltan ZOMATIK_USER y ZOMATIK_PASS en Vercel (proyecto Rebucret)")
  const bloqueo = await leerIntegracion(CLAVE_BLOQUEO)
  if (bloqueo && Date.parse(bloqueo.valor) > Date.now()) {
    const hasta = new Date(bloqueo.valor).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" })
    throw new ZomatikError("login_bloqueado", `Zomatik rechazó el usuario hace poco. No se reintenta hasta las ${hasta} para no bloquearlo. Revisar ZOMATIK_USER / ZOMATIK_PASS en Vercel.`)
  }
  if (Date.now() - ultimoIntentoLogin < ENTRE_LOGINS_MS)
    throw new ZomatikError("login_bloqueado", "Ya se intentó entrar a Zomatik hace menos de 10 min: no se reintenta")
  ultimoIntentoLogin = Date.now()
  const r = await pedir(null, "index.php?a=1", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ usuario: user, clave: pass, aceptar: "Aceptar" }).toString(),
    redirect: "manual",
  })
  const cookie = (r.headers.get("set-cookie") || "").match(/PHPSESSID=[^;]+/)?.[0]
  if (!cookie) throw new ZomatikError("sin_respuesta", "Zomatik no devolvió la sesión al entrar")
  const home = (await (await pedir(cookie, "home.php")).arrayBuffer().then((b) => Buffer.from(b))).toString("latin1")
  if (sesionCaida(home)) {
    await guardarIntegracion(CLAVE_BLOQUEO, new Date(Date.now() + BLOQUEO_LOGIN_MS).toISOString())
    throw new ZomatikError("login_rechazado", "Zomatik rechazó el usuario: actualizar la clave en Vercel (ZOMATIK_USER / ZOMATIK_PASS)")
  }
  await borrarIntegracion(CLAVE_BLOQUEO)
  await guardarIntegracion(CLAVE_SESION, cookie)
  return cookie
}

/** Cambia la sucursal activa de la sesión. Devuelve false si la sesión ya no sirve. */
async function elegirSucursal(cookie: string, sucursal: string): Promise<boolean> {
  const r = await pedir(cookie, "home.php", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `selsuc=${encodeURIComponent(sucursal)}`,
  })
  const html = Buffer.from(await r.arrayBuffer()).toString("latin1")
  return !sesionCaida(html)
}

/**
 * Sesión lista en la sucursal REBUCRET. Reutiliza la del proceso o la guardada; si no sirve, hace UN login.
 */
export async function obtenerSesion(): Promise<ZomatikSesion> {
  if (sesionProceso && Date.now() - sesionProceso.desde < VIDA_COOKIE_MS) {
    if (await elegirSucursal(sesionProceso.cookie, SUCURSAL_REBUCRET)) return { cookie: sesionProceso.cookie }
    sesionProceso = null
  }
  const guardada = await leerIntegracion(CLAVE_SESION)
  if (guardada?.valor && guardada.actualizado && Date.now() - Date.parse(guardada.actualizado) < VIDA_COOKIE_MS) {
    if (await elegirSucursal(guardada.valor, SUCURSAL_REBUCRET)) {
      sesionProceso = { cookie: guardada.valor, desde: Date.parse(guardada.actualizado) }
      return { cookie: guardada.valor }
    }
  }
  const cookie = await login()
  if (!(await elegirSucursal(cookie, SUCURSAL_REBUCRET))) throw new ZomatikError("sesion_caida", "Zomatik cerró la sesión recién abierta")
  sesionProceso = { cookie, desde: Date.now() }
  return { cookie }
}

// ---------------------------------------------------------------------------
// Buscadores de listados
// ---------------------------------------------------------------------------

/** Descubre los campos del buscador de un listado (los bus_* cambian por página) con sus valores por defecto. */
export async function discoverForm(s: ZomatikSesion, path: string): Promise<FormInfo> {
  const html = (await fetchText(s, path)).replace(/<!--[\s\S]*?-->/g, "")
  const forms = html.match(/<form[\s\S]*?<\/form>/gi) || []
  const form = forms.find((f) => /enviado=1/i.test((f.match(/<form[^>]*>/i) || [""])[0])) || forms.find((f) => /name="bus_/i.test(f))
  if (!form) throw new ZomatikError("formato", `Zomatik cambió el buscador de ${path.split(".")[0]}`)
  const fields: Record<string, string> = {}
  for (const m of form.matchAll(/<input\b[^>]*>/gi)) {
    const tag = m[0]
    const name = tag.match(/\bname\s*=\s*"([^"]+)"/i)?.[1]
    const type = (tag.match(/\btype\s*=\s*"([^"]+)"/i)?.[1] || "text").toLowerCase()
    if (!name || ["submit", "button", "image", "reset"].includes(type)) continue
    if ((type === "checkbox" || type === "radio") && !/\bchecked\b/i.test(tag)) continue
    fields[name] = tag.match(/\bvalue\s*=\s*"([^"]*)"/i)?.[1] ?? ""
  }
  for (const m of form.matchAll(/<select\b[^>]*name\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/select>/gi)) {
    const sel = [...m[2].matchAll(/<option\b([^>]*)>/gi)].find((o) => /\bselected\b/i.test(o[1]))
    fields[m[1]] = sel?.[1].match(/\bvalue\s*=\s*"([^"]*)"/i)?.[1] ?? ""
  }
  const nombres = Object.keys(fields)
  return {
    fields,
    fechaDesdeField: nombres.find((n) => /fecha.*d$|fechad/i.test(n)) || null,
    fechaHastaField: nombres.find((n) => /fecha.*h$|fechah/i.test(n)) || null,
  }
}

type OpcionesBusqueda = { desde?: string; hasta?: string; extra?: Record<string, string> }

function armarParams(form: FormInfo, opts: OpcionesBusqueda, exportar: boolean): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(form.fields)) params.set(k, v)
  params.set("exportar", exportar ? "1" : "0")
  if (opts.desde && form.fechaDesdeField) params.set(form.fechaDesdeField, opts.desde)
  if (opts.hasta && form.fechaHastaField) params.set(form.fechaHastaField, opts.hasta)
  for (const [k, v] of Object.entries(opts.extra || {})) params.set(k, v)
  return params.toString()
}

function filasDeXlsx(buf: Buffer): Fila[] {
  const wb = XLSX.read(buf, { type: "buffer" })
  const ws = wb.Sheets[wb.SheetNames[0]]
  return ws ? XLSX.utils.sheet_to_json<Fila>(ws, { defval: "" }) : []
}

const esXlsx = (b: Buffer) => b.length > 2 && b[0] === 0x50 && b[1] === 0x4b

/** Export XLSX de un listado con los filtros dados. Si Zomatik devuelve HTML, se lee la tabla. */
export async function fetchExport(s: ZomatikSesion, path: string, form: FormInfo, opts: OpcionesBusqueda = {}): Promise<Fila[]> {
  const buf = await fetchRaw(s, `${path}?enviado=1`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: armarParams(form, opts, true),
  })
  if (esXlsx(buf)) return filasDeXlsx(buf)
  const html = buf.toString("latin1")
  if (sesionCaida(html)) throw new ZomatikError("sesion_caida", "La sesión de Zomatik se cerró")
  return parseHtmlTable(html).rows
}

/** El listado en HTML (con los links de cada fila, que el XLSX no trae). */
export async function fetchHtml(s: ZomatikSesion, path: string, form: FormInfo, opts: OpcionesBusqueda = {}): Promise<string> {
  return fetchText(s, `${path}?enviado=1`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: armarParams(form, opts, false),
  })
}

/** Ficha de un cliente (formulario de edición abierto por GET, sin enviar nada). */
export async function fetchFichaCliente(s: ZomatikSesion, codigo: number): Promise<string> {
  if (!Number.isInteger(codigo) || codigo <= 0) throw new ZomatikError("formato", "Código de cliente inválido")
  return fetchText(s, `modificar_clientes.php?codigo=${codigo}`)
}

/** Renglones pactados de un acopio/proyecto (XLS). Vacío si el proyecto es por monto. */
export async function fetchAcopioXls(s: ZomatikSesion, acopio: number): Promise<Fila[]> {
  if (!Number.isInteger(acopio) || acopio <= 0) throw new ZomatikError("formato", "Código de acopio inválido")
  const buf = await fetchRaw(s, `exportar_acopio.php?acopio=${acopio}`)
  if (esXlsx(buf)) return filasDeXlsx(buf)
  const html = buf.toString("latin1")
  if (sesionCaida(html)) throw new ZomatikError("sesion_caida", "La sesión de Zomatik se cerró")
  return parseHtmlTable(html).rows
}

/** Mensaje para la pantalla (en castellano, sin datos de la sesión). */
export function mensajeZomatik(e: unknown): string {
  if (e instanceof ZomatikError) return e.message
  return "Error leyendo Zomatik"
}
