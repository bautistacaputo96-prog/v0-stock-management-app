/**
 * Conexión con Wialon (B-Track de Bilderit). Solo se usa del lado del servidor.
 *
 * El token lo genera el usuario en la página de Wialon y queda guardado en la
 * tabla `integraciones` (RLS sin políticas: solo la lee el service role).
 * Wialon cobra por unidad y por mes, no por consulta.
 */
import { createClient } from "@supabase/supabase-js"

export const WIALON_HOST = "https://hst-api.wialon.us"
/** Página donde el usuario autoriza el acceso con su usuario de B-Track. */
export const WIALON_LOGIN = "https://hosting.wialon.us/login.html"
/**
 * Permisos del token: rastreo en línea (0x100) + ver datos (0x200). Solo lectura.
 * Ojo: 0x400 NO es "última posición", es modificación de datos: no se pide.
 */
export const WIALON_ACCESS = 0x100 + 0x200

export function sbAdmin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

async function llamar(svc: string, params: any, sid?: string) {
  const body = new URLSearchParams({ svc, params: JSON.stringify(params) })
  if (sid) body.set("sid", sid)
  const r = await fetch(`${WIALON_HOST}/wialon/ajax.html`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  })
  const d = await r.json()
  if (d && typeof d === "object" && "error" in d && d.error !== 0) {
    const e: any = new Error(`Wialon error ${d.error}`)
    e.code = d.error
    throw e
  }
  return d
}

/** Valida un token y devuelve el usuario de Wialon al que pertenece. */
export async function validarToken(token: string): Promise<{ usuario: string; sid: string }> {
  const d = await llamar("token/login", { token, fl: 1 })
  return { usuario: d?.user?.nm || "", sid: d.eid }
}

export async function leerToken(): Promise<string | null> {
  const { data } = await sbAdmin().from("integraciones").select("valor").eq("clave", "wialon_token").maybeSingle()
  return data?.valor || null
}

// Sesión reutilizada entre consultas (Wialon la cierra tras 5 min sin uso)
let sesion: { sid: string; vence: number } | null = null

export async function obtenerSid(): Promise<string | null> {
  if (sesion && sesion.vence > Date.now()) return sesion.sid
  const token = await leerToken()
  if (!token) return null
  const { sid } = await validarToken(token)
  sesion = { sid, vence: Date.now() + 4 * 60 * 1000 }
  return sid
}

export type Unidad = {
  id: number
  nombre: string
  lat: number | null
  lng: number | null
  velocidad: number | null
  rumbo: number | null
  /** Momento de la última posición (ms) */
  t: number | null
  motor: boolean | null
}

// Caché compartida: si varias pantallas consultan a la vez, Wialon recibe una sola consulta
let cache: { datos: Unidad[]; hasta: number } | null = null

export async function posiciones(): Promise<Unidad[] | null> {
  if (cache && cache.hasta > Date.now()) return cache.datos
  const pedir = async (sid: string) =>
    llamar(
      "core/search_items",
      {
        spec: { itemsType: "avl_unit", propName: "sys_name", propValueMask: "*", sortType: "sys_name" },
        force: 1,
        flags: 0x1 | 0x400, // datos básicos + última posición/mensaje
        from: 0,
        to: 0,
      },
      sid,
    )
  let sid = await obtenerSid()
  if (!sid) return null
  let d: any
  try {
    d = await pedir(sid)
  } catch (e: any) {
    if (e?.code === 1) { // sesión vencida: se reabre una vez
      sesion = null
      sid = await obtenerSid()
      if (!sid) return null
      d = await pedir(sid)
    } else throw e
  }
  const datos: Unidad[] = (d.items || []).map((u: any) => ({
    id: u.id,
    nombre: String(u.nm || "").trim(),
    lat: u.pos?.y ?? null,
    lng: u.pos?.x ?? null,
    velocidad: u.pos?.s ?? null,
    rumbo: u.pos?.c ?? null,
    t: u.pos?.t ? u.pos.t * 1000 : null,
    motor: u.lmsg?.p?.eng_ign_stat != null ? Number(u.lmsg.p.eng_ign_stat) === 1 : null,
  }))
  cache = { datos, hasta: Date.now() + 25 * 1000 }
  return datos
}

// ---------------------------------------------------------------------------
// Historial (Fase 4a). Solo lectura: token/login, core/search_items, messages/load_interval,
// messages/unload y core/logout. Cada proceso abre su propia sesión y la cierra al terminar,
// para no mezclar la capa de mensajes con la sesión compartida de la pantalla En vivo.
// ---------------------------------------------------------------------------

/** Abre una sesión propia con el token guardado. Nulo si el GPS no está conectado. */
export async function abrirSesion(): Promise<string | null> {
  const token = await leerToken()
  if (!token) return null
  const { sid } = await validarToken(token)
  return sid
}

export async function cerrarSesion(sid: string): Promise<void> {
  await llamar("core/logout", {}, sid).catch(() => {})
}

/** Unidades (camiones) visibles para el usuario de Wialon. */
export async function unidades(sid: string): Promise<{ id: number; nombre: string }[]> {
  const d = await llamar(
    "core/search_items",
    {
      spec: { itemsType: "avl_unit", propName: "sys_name", propValueMask: "*", sortType: "sys_name" },
      force: 1,
      flags: 0x1,
      from: 0,
      to: 0,
    },
    sid,
  )
  return (d.items || []).map((u: any) => ({ id: u.id, nombre: String(u.nm || "").trim() }))
}

/**
 * Mensajes de datos (posición, velocidad, ignición, odómetro) de una unidad entre dos instantes
 * (segundos epoch). Descarga la capa de mensajes al terminar.
 */
export async function mensajesIntervalo(sid: string, unidadId: number, desde: number, hasta: number): Promise<any[]> {
  try {
    const d = await llamar(
      "messages/load_interval",
      { itemId: unidadId, timeFrom: desde, timeTo: hasta, flags: 0x0000, flagsMask: 0xff00, loadCount: 0xffffffff },
      sid,
    )
    return d?.messages || []
  } finally {
    await llamar("messages/unload", {}, sid).catch(() => {})
  }
}
