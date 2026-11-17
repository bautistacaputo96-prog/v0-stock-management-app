/**
 * Zomatik · "¿No está? Actualizar desde Zomatik" del cartel de vincular (16/11/2026). SOLO servidor.
 *
 * El buscador del cartel mira la copia (zomatik_clientes / zomatik_articulos), que llena la lectura nocturna: un cliente
 * o un artículo dado de alta en Zomatik durante el día no aparece hasta el otro día. Esto corre SOLO la parte
 * `clientes` o `articulos` de la lectura (el mismo export, solo lectura; lib/zomatik/lectura.ts) y graba la copia con
 * el mismo upsert. No escribe nada en Zomatik.
 *
 * Tipo "precios" (16/11/2026): el "Actualizar" del precio por m³ en Programación. Lee las listas de precios (parte
 * `listas`) y graba zomatik_listas / zomatik_lista_precios. La ruta lo exige con el permiso precios_np.editar.
 *
 * Freno: como mucho una vez cada 2 min por tipo, con un candado en `integraciones` (`zomatik_copia_clientes` /
 * `zomatik_copia_articulos`, `actualizado` = la última vez). Si se tocó hace poco no se va a Zomatik: se devuelve
 * `reciente` y el cartel vuelve a buscar en lo que hay. Además pide el mismo turno que la lectura y el robot de las NP
 * (una sola sesión en Zomatik a la vez); si está ocupado, suelta el candado para poder reintentar.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { sbAdmin } from "@/lib/wialon"
import { obtenerSesion, type ZomatikSesion } from "@/lib/zomatik/cliente"
import { fotoVacia, guardarArticulos, guardarClientes, guardarListas, leerArticulos, leerClientes, leerListas, textoError } from "@/lib/zomatik/lectura"
import { olvidarClientes } from "@/lib/clientes-datos"
import type { Articulo, ClienteListado } from "@/lib/zomatik/parseo"
import type { LecturaListas } from "@/lib/zomatik/foto"

export type TipoCopia = "clientes" | "articulos" | "precios"
export type ResultadoCopia =
  | { ok: true; reciente: false; cantidad: number }
  /** Se actualizó hace menos de 2 min: no se fue a Zomatik (`desde` = la última vez). */
  | { ok: true; reciente: true; desde: string }
  | { ok: false; error: string }

export const ESPERA_COPIA_MS = 2 * 60_000
/** Cuánto se espera el turno del robot antes de rendirse (el botón espera la respuesta). */
const ESPERA_TURNO_MS = 15_000

export const claveCopia = (tipo: TipoCopia) => `zomatik_copia_${tipo}`

export function tipoDeCopia(x: unknown): TipoCopia | null {
  return x === "clientes" || x === "articulos" || x === "precios" ? x : null
}

/**
 * Toma el candado del tipo si nadie lo tomó en los últimos 2 min. Atómico: el alta choca con la clave única y la
 * renovación solo pasa si `actualizado` es viejo (dos pedidos juntos: uno solo lo toma).
 */
export async function tomarCandadoCopia(
  sb: SupabaseClient,
  tipo: TipoCopia,
  ahora: number = Date.now(),
): Promise<{ ok: true; marca: string } | { ok: false; desde: string }> {
  const clave = claveCopia(tipo)
  const marca = new Date(ahora).toISOString()
  const { error } = await sb.from("integraciones").insert({ clave, valor: marca, actualizado: marca, conectado_por: "sistema" } as never)
  if (!error) return { ok: true, marca }
  if ((error as { code?: string }).code !== "23505") throw error
  const limite = new Date(ahora - ESPERA_COPIA_MS).toISOString()
  const { data, error: eU } = await sb
    .from("integraciones")
    .update({ valor: marca, actualizado: marca } as never)
    .eq("clave", clave)
    .lt("actualizado", limite)
    .select("clave")
  if (eU) throw eU
  if (((data as unknown[] | null) || []).length > 0) return { ok: true, marca }
  const { data: ya } = await sb.from("integraciones").select("actualizado").eq("clave", clave).maybeSingle()
  return { ok: false, desde: (ya as { actualizado?: string } | null)?.actualizado || marca }
}

/** Suelta el candado (solo si sigue siendo el propio): no se llegó a ir a Zomatik. */
export async function soltarCandadoCopia(sb: SupabaseClient, tipo: TipoCopia, marca: string) {
  await sb.from("integraciones").delete().eq("clave", claveCopia(tipo)).eq("valor", marca)
}

export type DepsCopia = {
  sb?: SupabaseClient
  sesion?: () => Promise<ZomatikSesion>
  leerClientes?: (s: ZomatikSesion) => Promise<ClienteListado[]>
  leerArticulos?: (s: ZomatikSesion) => Promise<Articulo[]>
  leerListas?: (s: ZomatikSesion) => Promise<LecturaListas>
  ahora?: () => number
  esperar?: (ms: number) => Promise<void>
}

export async function actualizarCopia(tipo: TipoCopia, deps: DepsCopia = {}): Promise<ResultadoCopia> {
  const sb = deps.sb ?? sbAdmin()
  const ahora = deps.ahora ?? Date.now
  const esperar = deps.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const candado = await tomarCandadoCopia(sb, tipo, ahora())
  if (!candado.ok) return { ok: true, reciente: true, desde: candado.desde }

  // El mismo turno que la lectura nocturna y el robot de las NP. Sin la migración de Z2 la función no existe: se lee igual.
  const t0 = ahora()
  const quien = `copia-${tipo}·${t0.toString(36)}`
  let conTurno = false
  try {
    let { data, error } = await sb.rpc("zomatik_robot_tomar", { p_quien: quien, p_segundos: 60 })
    while (!error && data !== true && ahora() - t0 < ESPERA_TURNO_MS) {
      await esperar(3_000)
      ;({ data, error } = await sb.rpc("zomatik_robot_tomar", { p_quien: quien, p_segundos: 60 }))
    }
    if (!error && data !== true) {
      await soltarCandadoCopia(sb, tipo, candado.marca).catch(() => {})
      return { ok: false, error: "Zomatik está ocupado con otra lectura o una NP. Probá de nuevo en un minuto." }
    }
    conTurno = !error
  } catch {
    /* sin la migración de Z2 */
  }

  try {
    const s = await (deps.sesion ?? obtenerSesion)()
    const foto = fotoVacia()
    let cantidad: number
    if (tipo === "clientes") {
      foto.clientes = await (deps.leerClientes ?? leerClientes)(s)
      cantidad = await guardarClientes(sb, foto)
      olvidarClientes()
    } else if (tipo === "articulos") {
      foto.articulos = await (deps.leerArticulos ?? leerArticulos)(s)
      cantidad = await guardarArticulos(sb, foto)
    } else {
      const l = await (deps.leerListas ?? leerListas)(s)
      const g = await guardarListas(sb, l, foto.inicio)
      if (g.avisos.length) return { ok: false, error: g.avisos.join(" ") }
      cantidad = g.precios
    }
    return { ok: true, reciente: false, cantidad }
  } catch (e) {
    // El candado queda: si Zomatik falló, no se reintenta antes de los 2 min
    return { ok: false, error: `No se pudo actualizar desde Zomatik: ${textoError(e)}` }
  } finally {
    if (conTurno) await sb.rpc("zomatik_robot_soltar", { p_quien: quien }).then(() => {}, () => {})
  }
}
