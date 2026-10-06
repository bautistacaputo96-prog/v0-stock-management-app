/**
 * Sesión del lado del servidor (fase 0c-1). SOLO para rutas de `app/api`.
 *
 * - La cookie `rebucret_sesion` (httpOnly) lleva {u, v, e} firmados con SESION_SECRETO (lib/auth/token.ts).
 * - Usuario y contraseña se leen con la clave de servicio (`sbAdmin`, la misma del remito y el GPS):
 *   `app_user_credenciales` no la puede leer el navegador.
 * - Modo de prueba local: con NODE_ENV=development y SESION_LOCAL_COMO="Nombre Apellido", la sesión es esa
 *   persona (solo lectura: las rutas que escriben responden 403). En Vercel NODE_ENV es siempre production.
 */
import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { sbAdmin } from "@/lib/wialon"
import { firmarSesion, leerSesion, SinSecretoError, DURACION_SESION_MS, type DatosSesion } from "@/lib/auth/token"
import { normalizarPermisos, normalizarNombre, tipoDe, type Permisos, type Tipo } from "@/lib/permisos"

export const NOMBRE_COOKIE = "rebucret_sesion"

export type FilaUsuario = {
  id: string
  name: string
  email: string | null
  active: boolean | null
  role: string | null
  tipo: string | null
  permisos: unknown
  ve_funciones_nuevas: boolean | null
  permisos_actualizados_at?: string | null
  permisos_actualizados_por?: string | null
}

export type FilaCredencial = {
  user_id: string
  clave_hash: string | null
  debe_cambiar: boolean
  permite_clave_comun: boolean
  sesion_version: number
  intentos_fallidos: number
  bloqueado_hasta: string | null
  clave_cambiada_at: string | null
  ultimo_ingreso_at: string | null
}

export type Sesion = {
  usuario: FilaUsuario
  credencial: FilaCredencial | null
  datos: DatosSesion | null
  /** Modo de prueba local (solo lectura). */
  local: boolean
}

/** Lo que el navegador guarda en su caché (nunca contraseñas ni hashes). */
export type UsuarioNavegador = {
  id: string
  name: string
  tipo: Tipo
  permisos: Permisos
  veFuncionesNuevas: boolean
}

export const COLUMNAS_USUARIO =
  "id, name, email, active, role, tipo, permisos, ve_funciones_nuevas, permisos_actualizados_at, permisos_actualizados_por"
export const COLUMNAS_CREDENCIAL =
  "user_id, clave_hash, debe_cambiar, permite_clave_comun, sesion_version, intentos_fallidos, bloqueado_hasta, clave_cambiada_at, ultimo_ingreso_at"

export function sbServicio() {
  return sbAdmin()
}

/** Nombre de la persona del modo de prueba local, o null (siempre null fuera de `next dev`). */
export function modoPruebaLocal(): string | null {
  if (process.env.NODE_ENV !== "development") return null
  const n = (process.env.SESION_LOCAL_COMO || "").trim()
  return n || null
}

export function respuestaModoLocal() {
  return NextResponse.json({ error: "Modo prueba local: no se graba nada." }, { status: 403 })
}

export function usuarioParaElNavegador(u: FilaUsuario): UsuarioNavegador {
  const tipo = tipoDe(u)
  return {
    id: u.id,
    name: u.name,
    tipo,
    permisos: normalizarPermisos(u.permisos),
    veFuncionesNuevas: u.ve_funciones_nuevas === true,
  }
}

export type EstadoClave = "propia" | "tiene que cambiarla" | "primer ingreso pendiente" | "sin contraseña"

export function estadoClave(c: FilaCredencial | null | undefined): EstadoClave {
  if (!c) return "sin contraseña"
  if (c.clave_hash) return c.debe_cambiar ? "tiene que cambiarla" : "propia"
  return c.permite_clave_comun ? "primer ingreso pendiente" : "sin contraseña"
}

/** Fila de la pantalla Usuarios (solo gerenciales). Nunca lleva el hash. */
export function usuarioParaLaPantalla(u: FilaUsuario, c: FilaCredencial | null | undefined, ahora: number = Date.now()) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    active: u.active !== false,
    tipo: tipoDe(u),
    permisos: normalizarPermisos(u.permisos),
    veFuncionesNuevas: u.ve_funciones_nuevas === true,
    estadoClave: estadoClave(c),
    ultimoIngreso: c?.ultimo_ingreso_at || null,
    bloqueado: !!(c?.bloqueado_hasta && new Date(c.bloqueado_hasta).getTime() > ahora),
    permisosActualizadosAt: u.permisos_actualizados_at || null,
    permisosActualizadosPor: u.permisos_actualizados_por || null,
  }
}

export async function leerUsuario(id: string): Promise<FilaUsuario | null> {
  const { data, error } = await sbServicio().from("app_users").select(COLUMNAS_USUARIO).eq("id", id).maybeSingle()
  if (error) throw error
  return (data as FilaUsuario | null) || null
}

export async function leerCredencial(id: string): Promise<FilaCredencial | null> {
  const { data, error } = await sbServicio().from("app_user_credenciales").select(COLUMNAS_CREDENCIAL).eq("user_id", id).maybeSingle()
  if (error) throw error
  return (data as FilaCredencial | null) || null
}

async function usuarioLocal(nombre: string): Promise<Sesion | null> {
  const { data, error } = await sbServicio().from("app_users").select(COLUMNAS_USUARIO).eq("active", true)
  if (error) throw error
  const u = ((data as FilaUsuario[] | null) || []).find((x) => normalizarNombre(x.name) === normalizarNombre(nombre))
  if (!u) return null
  return { usuario: u, credencial: null, datos: null, local: true }
}

/**
 * Sesión de la cookie: firma válida, sin vencer, persona activa y con la misma versión de sesión.
 * Si algo no cierra, null. Sin SESION_SECRETO, tira SinSecretoError.
 */
export async function sesionActual(): Promise<Sesion | null> {
  const local = modoPruebaLocal()
  if (local) return usuarioLocal(local)
  const almacen = await cookies()
  const datos = leerSesion(almacen.get(NOMBRE_COOKIE)?.value)
  if (!datos) return null
  const [usuario, credencial] = await Promise.all([leerUsuario(datos.u), leerCredencial(datos.u)])
  if (!usuario || usuario.active === false) return null
  if (!credencial || credencial.sesion_version !== datos.v) return null
  return { usuario, credencial, datos, local: false }
}

/** La sesión tiene que elegir su contraseña antes de hacer cualquier otra cosa. */
export function debeCambiarClave(s: Sesion): boolean {
  if (s.local || !s.credencial) return false
  return s.credencial.debe_cambiar === true || !s.credencial.clave_hash
}

type Exigido = { sesion: Sesion; respuesta?: undefined } | { sesion?: undefined; respuesta: NextResponse }

/** Para las rutas que piden estar logueado (y con su contraseña ya elegida, salvo que se indique). */
export async function exigirSesion(opts: { permitirDebeCambiar?: boolean } = {}): Promise<Exigido> {
  const sesion = await sesionActual()
  if (!sesion) return { respuesta: NextResponse.json({ error: "Tu sesión se cerró. Entrá de nuevo." }, { status: 401 }) }
  if (!opts.permitirDebeCambiar && debeCambiarClave(sesion))
    return { respuesta: NextResponse.json({ error: "Primero elegí tu contraseña." }, { status: 403 }) }
  return { sesion }
}

export async function exigirGerencial(): Promise<Exigido> {
  const r = await exigirSesion()
  if (r.respuesta) return r
  if (tipoDe(r.sesion.usuario) !== "gerencial")
    return { respuesta: NextResponse.json({ error: "Solo un gerencial puede hacer esto." }, { status: 403 }) }
  return r
}

export function ponerCookieSesion(res: NextResponse, usuarioId: string, version: number, ahora: number = Date.now()) {
  const e = ahora + DURACION_SESION_MS
  res.cookies.set(NOMBRE_COOKIE, firmarSesion({ u: usuarioId, v: version, e }), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    expires: new Date(e),
  })
}

export function borrarCookieSesion(res: NextResponse) {
  res.cookies.set(NOMBRE_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production", maxAge: 0 })
}

/** Registra en Actividad desde el servidor. Nunca corta la operación. */
export async function registrarActividad(opts: {
  usuario: string
  action: "crear" | "editar" | "borrar"
  entity: string
  entityId?: string | null
  reference?: string | null
  details?: Record<string, unknown> | null
}) {
  try {
    const { error } = await sbServicio().from("activity_log").insert({
      user_name: opts.usuario,
      action: opts.action,
      entity: opts.entity,
      entity_id: opts.entityId ?? null,
      reference: opts.reference ?? null,
      plant_id: null,
      details: opts.details ?? null,
    })
    if (error) console.error("[sesion] no se pudo registrar la actividad:", error.message)
  } catch (err) {
    console.error("[sesion] no se pudo registrar la actividad:", err)
  }
}

/** Respuesta para un error inesperado (sin secreto → 500 {codigo: "sin_secreto"}). */
export function respuestaError(e: unknown) {
  if (e instanceof SinSecretoError || (e as any)?.codigo === "sin_secreto") {
    return NextResponse.json(
      { codigo: "sin_secreto", error: "El sistema no está bien configurado (falta SESION_SECRETO). Avisale a Bautista." },
      { status: 500 },
    )
  }
  console.error("[sesion]", e)
  return NextResponse.json({ error: "No se pudo completar. Probá de nuevo en un rato." }, { status: 500 })
}
