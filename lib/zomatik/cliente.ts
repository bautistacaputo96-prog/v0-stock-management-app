/**
 * Cliente de Zomatik (concretus.zomatik.com) — SOLO servidor. Lectura (Z0) y, aparte, la nota de pedido (Z2).
 *
 * Adaptado de `lib/zomatik.ts` del repo de Concretus. Zomatik no tiene API: se usa como un navegador.
 *   1. Login con ZOMATIK_USER / ZOMATIK_PASS (variables de Vercel) → cookie de sesión.
 *   2. Sucursal REBUCRET (selsuc=18) antes de leer.
 *   3. Cada listado: GET de la página para descubrir los campos del buscador y POST `?enviado=1` con
 *      exportar=1 (XLSX) o sin exportar (HTML, que trae los links con los códigos internos).
 *
 * Reglas (spec, puntos 10, 12 y 17.6):
 *   - Lista cerrada de rutas (web.ts): solo login, home (sucursal), buscadores de listados y reportes (`?enviado=1`),
 *     fichas de cliente por GET y el XLS de un acopio. Cualquier otra ruta (manage_*, grabar_*, generar_*, set_*,
 *     _get*) se rechaza ANTES de salir. La única excepción es el grupo de la NP (Z2, `navegadorNp`), que pide la
 *     llave de la planta prendida (`np-servidor.ts`).
 *   - Un login por corrida como máximo (y por proceso, uno cada 10 min). La cookie se reutiliza (en memoria y en `integraciones`, que solo lee
 *     la clave de servicio). Si Zomatik rechaza el usuario, no se vuelve a intentar por 30 min en ningún proceso:
 *     muchos logins fallidos pueden bloquear el usuario (es el de Bautista).
 *   - ~300 ms entre requests.
 */
import * as XLSX from "xlsx"
import { sbAdmin } from "@/lib/wialon"
import { parseHtmlTable, matrizDeTablaHtml, type Fila } from "@/lib/zomatik/parseo"
import type { LlaveNp, NavegadorNp, RespuestaNav } from "@/lib/zomatik/np-robot"
import type { LlaveZ1 } from "@/lib/zomatik/z1-robot"
import { ZOMATIK_WEB, LISTADOS, rutaPermitida, rutaDeLocation, rutaEscrituraNp, rutaEscrituraZ1 } from "@/lib/zomatik/web"
import { camposFormulario } from "@/lib/zomatik/np"

export const ZOMATIK_BASE = ZOMATIK_WEB
/** Sucursal REBUCRET en el selector global (spec 3). */
export const SUCURSAL_REBUCRET = "18"
/** Pausa entre requests. */
const PAUSA_MS = 300
/** Cookie guardada: se reusa mientras tenga menos de esto. */
const VIDA_COOKIE_MS = 20 * 60 * 1000
/** Después de un rechazo de usuario o clave, nadie vuelve a intentar por este tiempo. */
const BLOQUEO_LOGIN_MS = 30 * 60 * 1000
/** Después de cualquier otra falla del login (sin cookie, red, la sesión se cae al elegir la sucursal). */
const BLOQUEO_FALLA_MS = 10 * 60 * 1000
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
// Lista cerrada de rutas: vive en web.ts (solo lectura + el grupo aparte de la NP, Z2)
// ---------------------------------------------------------------------------

export { LISTADOS, rutaPermitida, rutaDeLocation }

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

let ultimoRequest = 0
async function pausa() {
  const espera = ultimoRequest + PAUSA_MS - Date.now()
  if (espera > 0) await new Promise((r) => setTimeout(r, espera))
  ultimoRequest = Date.now()
}

const MAX_REDIRECCIONES = 3

type InitPedido = RequestInit & {
  method?: "GET" | "POST"
  /** Z2: habilita el grupo de la NP (solo con la llave prendida, ver np-servidor.ts). */
  escrituraNp?: boolean
  /** Z1: habilita el grupo de OF + remito (solo con la llave de remitir prendida, ver z1-servidor.ts). */
  escrituraZ1?: boolean
}

async function pedir(cookie: string | null, path: string, init: InitPedido = {}): Promise<Response> {
  let metodo = (init.method || "GET") as "GET" | "POST"
  let ruta = path.replace(/^\/+/, "")
  let cuerpo = init.body
  const seguir = init.redirect !== "manual" // el login lee la cookie de la respuesta, sin seguir
  for (let salto = 0; ; salto++) {
    if (!rutaPermitida(ruta, metodo) && !(init.escrituraNp === true && rutaEscrituraNp(ruta, metodo)) && !(init.escrituraZ1 === true && rutaEscrituraZ1(ruta, metodo)))
      throw new ZomatikError("ruta_no_permitida", `Ruta de Zomatik no permitida: ${metodo} ${ruta.split("?")[0]}`)
    await pausa()
    const ctrl = new AbortController()
    const corte = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    let r: Response
    try {
      const { escrituraNp: _e, escrituraZ1: _z, ...resto } = init
      r = await fetch(`${ZOMATIK_BASE}/${ruta}`, {
        ...resto,
        method: metodo,
        body: metodo === "GET" ? undefined : cuerpo,
        headers: { ...(cookie ? { Cookie: cookie } : {}), ...(metodo === "GET" ? {} : init.headers || {}) },
        redirect: "manual",
        cache: "no-store",
        signal: ctrl.signal,
      })
    } catch (e: any) {
      throw new ZomatikError("sin_respuesta", e?.name === "AbortError" ? "Zomatik no respondió a tiempo" : "No se pudo conectar con Zomatik")
    } finally {
      clearTimeout(corte)
    }
    if (!seguir || r.status < 300 || r.status >= 400) return r
    // Redirección: se valida con la lista cerrada ANTES de seguirla (después de un POST pasa a GET)
    const destino = rutaDeLocation(r.headers.get("location") || "", ruta)
    if (!destino) throw new ZomatikError("ruta_no_permitida", "Zomatik redirigió a otro sitio: no se sigue")
    if (/^index\.php/i.test(destino)) throw new ZomatikError("sesion_caida", "La sesión de Zomatik se cerró")
    if (salto + 1 >= MAX_REDIRECCIONES) throw new ZomatikError("formato", "Zomatik redirigió demasiadas veces")
    if (r.status !== 307 && r.status !== 308) {
      metodo = "GET"
      cuerpo = undefined
    }
    ruta = destino
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

/**
 * Login + sucursal REBUCRET. Ante CUALQUIER falla queda un bloqueo en `integraciones` para todos los procesos:
 * 30 min si Zomatik rechazó el usuario, 10 min si fue otra cosa (sin cookie, red, sesión caída).
 */
async function login(): Promise<string> {
  const user = process.env.ZOMATIK_USER
  const pass = process.env.ZOMATIK_PASS
  if (!user || !pass) throw new ZomatikError("sin_credenciales", "Faltan ZOMATIK_USER y ZOMATIK_PASS en Vercel (proyecto Rebucret)")
  const bloqueo = await leerIntegracion(CLAVE_BLOQUEO)
  if (bloqueo && Date.parse(bloqueo.valor) > Date.now()) {
    const hasta = new Date(bloqueo.valor).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" })
    throw new ZomatikError("login_bloqueado", `Hace poco falló la entrada a Zomatik. No se reintenta hasta las ${hasta} para no bloquear el usuario. Si sigue, revisar ZOMATIK_USER / ZOMATIK_PASS en Vercel.`)
  }
  if (Date.now() - ultimoIntentoLogin < ENTRE_LOGINS_MS)
    throw new ZomatikError("login_bloqueado", "Ya se intentó entrar a Zomatik hace menos de 10 min: no se reintenta")
  ultimoIntentoLogin = Date.now()
  try {
    const r = await pedir(null, "index.php?a=1", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ usuario: user, clave: pass, aceptar: "Aceptar" }).toString(),
      redirect: "manual",
    })
    const cookie = (r.headers.get("set-cookie") || "").match(/PHPSESSID=[^;]+/)?.[0]
    if (!cookie) throw new ZomatikError("sin_respuesta", "Zomatik no devolvió la sesión al entrar")
    let home = ""
    try {
      home = Buffer.from(await (await pedir(cookie, "home.php")).arrayBuffer()).toString("latin1")
    } catch (e) {
      if (!(e instanceof ZomatikError && e.codigo === "sesion_caida")) throw e
      home = 'name="usuario" name="clave"' // redirigió al login: usuario o clave rechazados
    }
    if (sesionCaida(home)) throw new ZomatikError("login_rechazado", "Zomatik rechazó el usuario: actualizar la clave en Vercel (ZOMATIK_USER / ZOMATIK_PASS)")
    if (!(await elegirSucursal(cookie, SUCURSAL_REBUCRET))) throw new ZomatikError("sesion_caida", "Zomatik cerró la sesión recién abierta")
    await borrarIntegracion(CLAVE_BLOQUEO)
    await guardarIntegracion(CLAVE_SESION, cookie)
    return cookie
  } catch (e) {
    const rechazo = e instanceof ZomatikError && e.codigo === "login_rechazado"
    await guardarIntegracion(CLAVE_BLOQUEO, new Date(Date.now() + (rechazo ? BLOQUEO_LOGIN_MS : BLOQUEO_FALLA_MS)).toISOString())
    throw e instanceof ZomatikError ? e : new ZomatikError("sin_respuesta", "No se pudo entrar a Zomatik")
  }
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
  const cookie = await login() // ya deja la sesión en la sucursal REBUCRET
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

/**
 * La sucursal la comparte el usuario, no la sesión (23.3): el sistema de Concretus puede pasarla a RUTA 25 en cualquier
 * momento. Antes de cada búsqueda o export se vuelve a elegir REBUCRET.
 */
async function reafirmarRebucret(s: ZomatikSesion) {
  if (!(await elegirSucursal(s.cookie, SUCURSAL_REBUCRET))) throw new ZomatikError("sesion_caida", "La sesión de Zomatik se cerró")
}

/** Export XLSX de un listado con los filtros dados. Si Zomatik devuelve HTML, se lee la tabla. */
export async function fetchExport(s: ZomatikSesion, path: string, form: FormInfo, opts: OpcionesBusqueda = {}): Promise<Fila[]> {
  await reafirmarRebucret(s)
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

/** Sucursal que muestra una página de Zomatik (el selector global `frm_selsuc`), o null si no se ve. */
export function sucursalDePagina(html: string): string | null {
  return camposFormulario(html, /frm_selsuc/i)?.campos.selsuc ?? null
}

/**
 * Sucursal activa de la sesión, vista en el buscador de un listado (GET, solo lectura). Sirve para confirmar, justo
 * después de un export, que la lectura vino de REBUCRET y no de la sucursal que puso otro sistema (23.3).
 */
export async function sucursalVisible(s: ZomatikSesion, path: string): Promise<string | null> {
  return sucursalDePagina(await fetchText(s, path))
}

/**
 * Export XLSX con la sucursal confirmada ANTES y DESPUÉS (23.3): elige `sucursal`, mira en el buscador que la sesión
 * quedó ahí, exporta y vuelve a mirar. Si la página no muestra el selector (`frm_selsuc`) o muestra otra sucursal, error:
 * otro sistema la cambió y lo exportado puede ser de otra sucursal.
 */
export async function fetchExportEnSucursal(s: ZomatikSesion, path: string, form: FormInfo, opts: OpcionesBusqueda, sucursal: string = SUCURSAL_REBUCRET, exigirXlsx = false): Promise<Fila[]> {
  const confirmar = async (cuando: string) => {
    const suc = await sucursalVisible(s, path)
    if (suc === null) throw new ZomatikError("formato", `No se ve la sucursal en ${path.split(".")[0]} (¿cambió la página?)`)
    if (suc !== sucursal) throw new ZomatikError("formato", `La sesión estaba en otra sucursal (${suc}) ${cuando} del export: otro sistema la cambió`)
  }
  if (!(await elegirSucursal(s.cookie, sucursal))) throw new ZomatikError("sesion_caida", "La sesión de Zomatik se cerró")
  await confirmar("antes")
  const buf = await fetchRaw(s, `${path}?enviado=1`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: armarParams(form, opts, true),
  })
  await confirmar("después")
  if (esXlsx(buf)) return filasDeXlsx(buf)
  // La página HTML muestra las cantidades redondeadas (40 en vez de 40,32): para comparar toneladas hace falta el Excel
  if (exigirXlsx) throw new ZomatikError("formato", "El export no vino en Excel (en la página las cantidades vienen redondeadas)")
  const html = buf.toString("latin1")
  if (sesionCaida(html)) throw new ZomatikError("sesion_caida", "La sesión de Zomatik se cerró")
  return parseHtmlTable(html).rows
}

/**
 * Un reporte como matriz (filas × celdas, con las filas sueltas como "Total acumulado: N"), con la sucursal confirmada
 * antes y después como `fetchExportEnSucursal`. Acepta Excel (xlsx o xls) o, si Zomatik devuelve la página, su tabla.
 */
export async function fetchMatrizEnSucursal(s: ZomatikSesion, path: string, form: FormInfo, opts: OpcionesBusqueda, sucursal: string = SUCURSAL_REBUCRET): Promise<{ filas: (string | number)[][]; formato: "excel" | "html"; paginado: boolean }> {
  const confirmar = async (cuando: string) => {
    const suc = await sucursalVisible(s, path)
    if (suc === null) throw new ZomatikError("formato", `No se ve la sucursal en ${path.split(".")[0]} (¿cambió la página?)`)
    if (suc !== sucursal) throw new ZomatikError("formato", `La sesión estaba en otra sucursal (${suc}) ${cuando} del export: otro sistema la cambió`)
  }
  if (!(await elegirSucursal(s.cookie, sucursal))) throw new ZomatikError("sesion_caida", "La sesión de Zomatik se cerró")
  await confirmar("antes")
  const buf = await fetchRaw(s, `${path}?enviado=1`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: armarParams(form, opts, true),
  })
  await confirmar("después")
  const esXls = buf.length > 4 && buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0
  if (esXlsx(buf) || esXls) {
    const wb = XLSX.read(buf, { type: "buffer" })
    const ws = wb.Sheets[wb.SheetNames[0]]
    return { filas: ws ? XLSX.utils.sheet_to_json<(string | number)[]>(ws, { header: 1, raw: true, defval: "" }) : [], formato: "excel", paginado: false }
  }
  const html = buf.toString("latin1")
  if (sesionCaida(html)) throw new ZomatikError("sesion_caida", "La sesión de Zomatik se cerró")
  // Si la página trae paginado ("Siguiente", pagina=), lo que vino es solo una parte
  return { filas: matrizDeTablaHtml(html), formato: "html", paginado: /<a\b[^>]*>[^<]*siguiente|[?&]pagina=\d/i.test(html) }
}

/** El listado en HTML (con los links de cada fila, que el XLSX no trae). */
export async function fetchHtml(s: ZomatikSesion, path: string, form: FormInfo, opts: OpcionesBusqueda = {}): Promise<string> {
  await reafirmarRebucret(s)
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

// ---------------------------------------------------------------------------
// Z2 · Navegador del robot de la nota de pedido (solo con la llave prendida)
// ---------------------------------------------------------------------------

/**
 * Navegador para `np-robot.ts`: no sigue redirecciones (el robot mira a dónde va "Grabar") y cada request pasa por la
 * lista cerrada, con el grupo de la NP habilitado. `llave` la arma `np-servidor.ts` después de leer
 * `zomatik_np_config.activo = true` en la base: sin ella no hay forma de pedir una ruta que escriba.
 */
export async function navegadorNp(llave: LlaveNp): Promise<NavegadorNp> {
  if (!llave || llave.activo !== true) throw new ZomatikError("ruta_no_permitida", "La NP automática está apagada para esta planta")
  const s = await obtenerSesion()
  const leer = async (r: Response, ruta: string): Promise<RespuestaNav> => {
    const html = Buffer.from(await r.arrayBuffer()).toString("latin1")
    const loc = r.status >= 300 && r.status < 400 ? rutaDeLocation(r.headers.get("location") || "", ruta) : null
    if (loc && /^index\.php/i.test(loc)) throw new ZomatikError("sesion_caida", "La sesión de Zomatik se cerró")
    if (sesionCaida(html)) throw new ZomatikError("sesion_caida", "La sesión de Zomatik se cerró")
    return { status: r.status, location: loc, html }
  }
  return {
    async get(ruta) {
      return leer(await pedir(s.cookie, ruta, { redirect: "manual", escrituraNp: true }), ruta)
    },
    async post(ruta, cuerpo, contentType) {
      return leer(await pedir(s.cookie, ruta, { method: "POST", headers: { "Content-Type": contentType }, body: cuerpo as any, redirect: "manual", escrituraNp: true }), ruta)
    },
    async sucursal(id) {
      return elegirSucursal(s.cookie, id)
    },
  }
}

/**
 * Navegador del robot de OF + remito (Z1): igual al de la NP, con el grupo de Z1 habilitado. `llave` la arma
 * `z1-servidor.ts` después de leer `zomatik_np_config.remitir_activo = true` (y la NP prendida) en la base.
 */
export async function navegadorZ1(llave: LlaveZ1): Promise<NavegadorNp> {
  if (!llave || llave.remitir !== true) throw new ZomatikError("ruta_no_permitida", "La OF y el remito automáticos están apagados para esta planta")
  const s = await obtenerSesion()
  const leer = async (r: Response, ruta: string): Promise<RespuestaNav> => {
    const html = Buffer.from(await r.arrayBuffer()).toString("latin1")
    const loc = r.status >= 300 && r.status < 400 ? rutaDeLocation(r.headers.get("location") || "", ruta) : null
    if (loc && /^index\.php/i.test(loc)) throw new ZomatikError("sesion_caida", "La sesión de Zomatik se cerró")
    if (sesionCaida(html)) throw new ZomatikError("sesion_caida", "La sesión de Zomatik se cerró")
    return { status: r.status, location: loc, html }
  }
  return {
    async get(ruta) {
      return leer(await pedir(s.cookie, ruta, { redirect: "manual", escrituraZ1: true }), ruta)
    },
    async post(ruta, cuerpo, contentType) {
      return leer(await pedir(s.cookie, ruta, { method: "POST", headers: { "Content-Type": contentType }, body: cuerpo as any, redirect: "manual", escrituraZ1: true }), ruta)
    },
    async sucursal(id) {
      return elegirSucursal(s.cookie, id)
    },
  }
}
