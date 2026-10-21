/**
 * Zomatik · lectura nocturna y botón "Actualizar" (etapa Z0). SOLO servidor. SOLO lee de Zomatik; escribe
 * únicamente nuestras copias (zomatik_*) con la clave de servicio.
 *
 * Dos pasos:
 *   1. `leerFoto`: lee de Zomatik (no toca la base). Partes, en orden; si falla una siguen las demás, salvo que
 *      se caiga la sesión o Zomatik rechace el usuario:
 *        clientes      listado_clientes.php (export, ~467)
 *        artículos     listado_articulos.php por línea (Hormigón, Hormigón (OBRAS), Servicios)
 *        remitos       reporte_remitosventa.php del último año (export): R/X por cliente y renglones de proyectos
 *        proyectos     listado_proyectos.php (HTML, trae el código interno de cada proyecto)
 *        historia      los años anteriores de los proyectos abiertos viejos (una sola vez por proyecto)
 *        tipos         exportar_acopio.php de los proyectos sin revisar (por monto o por cantidades)
 *        fichas        modificar_clientes.php?codigo=N (GET) de los clientes con remitos en el año
 *        NP pendientes listado_pedidos.php "Pendientes" (export)
 *      Historia, tipos y fichas van de a poco y respetan un presupuesto de tiempo (Vercel corta a los 60 s).
 *   2. `guardarFoto`: graba las copias (filas armadas en lib/zomatik/foto.ts).
 *
 * Nunca se guarda un precio ni un monto.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { sbAdmin } from "@/lib/wialon"
import {
  obtenerSesion,
  discoverForm,
  fetchExport,
  fetchHtml,
  fetchFichaCliente,
  fetchAcopioXls,
  ZomatikError,
  type ZomatikSesion,
} from "@/lib/zomatik/cliente"
import {
  clientesDeListado,
  articulosDeListado,
  renglonesRemitos,
  parseProyectosHtml,
  pactadoDeAcopio,
  parseFichaCliente,
  npPendientesDeListado,
} from "@/lib/zomatik/parseo"
import {
  hoyArgentina,
  sumarDias,
  tramosHistoria,
  proyectosSinHistoria,
  proyectosSinTipo,
  fichasPendientes,
  filasClientes,
  filasFichas,
  filasArticulos,
  filasProyectos,
  filasMovimientos,
  totalesPorProyecto,
  type Foto,
  type Previo,
} from "@/lib/zomatik/foto"

export type ResultadoLectura = { ok: boolean; partes: Record<string, unknown>; errores: string[]; ms: number }

const PRESUPUESTO_MS = 40_000
const FICHAS_POR_VEZ = 25
const TIPOS_POR_VEZ = 6
const LOTE = 200

function fallaGrave(e: unknown) {
  return e instanceof ZomatikError && ["sin_credenciales", "login_rechazado", "login_bloqueado", "sesion_caida"].includes(e.codigo)
}

export function textoError(e: unknown): string {
  if (e instanceof ZomatikError) return e.message
  const m = (e as any)?.message
  return typeof m === "string" && m ? m.slice(0, 300) : "Error inesperado"
}

/** Lee de Zomatik todo lo de Z0. No toca la base. `partes` y `errores` se completan por parte. */
export async function leerFoto(
  s: ZomatikSesion,
  previo: Previo,
  opts: { presupuestoMs?: number; partes: Record<string, unknown>; errores: string[] },
): Promise<Foto> {
  const t0 = Date.now()
  const queda = () => (opts.presupuestoMs ?? PRESUPUESTO_MS) - (Date.now() - t0)
  const hoy = hoyArgentina()
  const desde12 = sumarDias(hoy, -365)
  const foto: Foto = {
    inicio: new Date().toISOString(),
    hoy,
    desde12,
    clientes: null,
    articulos: null,
    renglones12: null,
    proyectos: null,
    historia: { renglones: [], completaPara: [] },
    tipos: [],
    fichas: [],
    npPendientes: null,
  }
  const parte = async (nombre: string, fn: () => Promise<unknown>) => {
    try {
      opts.partes[nombre] = await fn()
    } catch (e) {
      opts.errores.push(`${nombre}: ${textoError(e)}`)
      opts.partes[nombre] = { error: textoError(e) }
      if (fallaGrave(e)) throw e
    }
  }

  await parte("clientes", async () => {
    const f = await discoverForm(s, "listado_clientes.php")
    const lista = clientesDeListado(await fetchExport(s, "listado_clientes.php", f))
    if (lista.length === 0) throw new ZomatikError("formato", "El listado de clientes vino vacío (¿cambió el formato?)")
    foto.clientes = lista
    return lista.length
  })

  await parte("articulos", async () => {
    const f = await discoverForm(s, "listado_articulos.php")
    const todos = []
    for (const linea of ["132", "136", "135"]) todos.push(...articulosDeListado(await fetchExport(s, "listado_articulos.php", f, { extra: { bus_linea: linea } })))
    if (todos.length === 0) throw new ZomatikError("formato", "El listado de artículos vino vacío")
    foto.articulos = todos
    return todos.length
  })

  let formRemitos: Awaited<ReturnType<typeof discoverForm>> | null = null
  await parte("remitos_12m", async () => {
    formRemitos = await discoverForm(s, "reporte_remitosventa.php")
    foto.renglones12 = renglonesRemitos(await fetchExport(s, "reporte_remitosventa.php", formRemitos, { desde: desde12, hasta: hoy }))
    return foto.renglones12.length
  })

  await parte("proyectos", async () => {
    const f = await discoverForm(s, "listado_proyectos.php")
    const lista = parseProyectosHtml(await fetchHtml(s, "listado_proyectos.php", f))
    if (lista.length === 0) throw new ZomatikError("formato", "El listado de proyectos vino vacío (¿cambió el formato?)")
    foto.proyectos = lista
    return lista.length
  })

  await parte("historia", async () => {
    const tramos = tramosHistoria(previo.proyectos, foto.proyectos, desde12)
    if (tramos.length === 0) return "nada que leer"
    if (!formRemitos) formRemitos = await discoverForm(s, "reporte_remitosventa.php")
    let leidos = 0
    for (const t of tramos) {
      if (queda() < 12_000) break
      foto.historia.renglones.push(...renglonesRemitos(await fetchExport(s, "reporte_remitosventa.php", formRemitos, t)))
      leidos++
    }
    if (leidos === tramos.length) foto.historia.completaPara = proyectosSinHistoria(previo.proyectos, foto.proyectos, desde12).map((p) => p.codigo)
    return { tramos: tramos.length, leidos, renglones: foto.historia.renglones.length }
  })

  await parte("tipos", async () => {
    const pend = proyectosSinTipo(previo.proyectos, foto.proyectos)
    for (const codigo of pend.slice(0, TIPOS_POR_VEZ)) {
      if (queda() < 8_000) break
      const r = pactadoDeAcopio(await fetchAcopioXls(s, codigo))
      foto.tipos.push({ codigo, tipo: r.tipo, m3: r.m3 })
    }
    return { leidos: foto.tipos.length, faltan: Math.max(0, pend.length - foto.tipos.length) }
  })

  await parte("fichas", async () => {
    const pend = fichasPendientes(foto.clientes, foto.renglones12, previo.fichas)
    for (const codigo of pend.slice(0, FICHAS_POR_VEZ)) {
      if (queda() < 6_000) break
      const ficha = parseFichaCliente(await fetchFichaCliente(s, codigo))
      if (ficha) foto.fichas.push({ codigo, ficha, leida_at: new Date().toISOString() })
    }
    return { leidas: foto.fichas.length, faltan: Math.max(0, pend.length - foto.fichas.length) }
  })

  await parte("np_pendientes", async () => {
    if (queda() < 4_000) return "sin tiempo"
    const f = await discoverForm(s, "listado_pedidos.php")
    foto.npPendientes = npPendientesDeListado(await fetchExport(s, "listado_pedidos.php", f, { extra: { bus_pendrem: "1" } }))
    return foto.npPendientes.length
  })

  return foto
}

export async function leerPrevio(sb: SupabaseClient): Promise<Previo> {
  const [p, f] = await Promise.all([
    sb.from("zomatik_proyectos").select("codigo, numero, fecha, estado, historia_leida_at, tipo").limit(5000),
    sb.from("zomatik_clientes").select("codigo, ficha_leida_at").not("ficha_leida_at", "is", null).limit(5000),
  ])
  if (p.error) throw p.error
  if (f.error) throw f.error
  return { proyectos: (p.data as any[]) || [], fichas: (f.data as any[]) || [] }
}

async function enLotes<T>(filas: T[], fn: (lote: T[]) => Promise<void>) {
  for (let i = 0; i < filas.length; i += LOTE) await fn(filas.slice(i, i + LOTE))
}

/** Graba la foto en las copias. Devuelve conteos de lo grabado. */
export async function guardarFoto(sb: SupabaseClient, foto: Foto, previo: Previo): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {}
  const upsert = async (tabla: string, filas: Record<string, unknown>[], onConflict: string) => {
    await enLotes(filas, async (lote) => {
      const { error } = await sb.from(tabla).upsert(lote, { onConflict })
      if (error) throw error
    })
  }

  // Clientes (listado + R/X del año) y fichas
  const cli = filasClientes(foto)
  await upsert("zomatik_clientes", cli, "codigo")
  for (const f of filasFichas(foto)) {
    const { error } = await sb.from("zomatik_clientes").update(f.valores).eq("codigo", f.codigo)
    if (error) throw error
  }
  out.clientes = cli.length
  out.fichas = foto.fichas.length

  // Artículos
  const arts = filasArticulos(foto)
  await upsert("zomatik_articulos", arts, "codigo")
  out.articulos = arts.length
  let lineas = new Map<number, string>()
  if (foto.articulos) lineas = new Map(foto.articulos.map((a) => [a.codigo, a.linea]))
  else {
    const { data } = await sb.from("zomatik_articulos").select("codigo, linea").limit(5000)
    lineas = new Map(((data as any[]) || []).map((a) => [a.codigo, a.linea]))
  }

  // Proyectos: los de la lectura quedan abiertos; los que ya no aparecen, cerrados (solo si la lectura anduvo)
  const proys = filasProyectos(foto)
  await upsert("zomatik_proyectos", proys, "codigo")
  if (foto.proyectos && foto.proyectos.length > 0) {
    const { data: cerrados, error } = await sb
      .from("zomatik_proyectos")
      .update({ estado: "cerrado", leido_at: foto.inicio })
      .eq("estado", "abierto")
      .lt("visto_at", foto.inicio)
      .select("codigo")
    if (error) throw error
    out.proyectos_cerrados = (cerrados || []).length
  }
  out.proyectos = proys.length
  for (const t of foto.tipos) {
    const { error } = await sb.from("zomatik_proyectos").update({ tipo: t.tipo, pactado_m3: t.m3 }).eq("codigo", t.codigo)
    if (error) throw error
  }

  // Movimientos de los proyectos
  const conocidos = [...previo.proyectos.map((p) => p.numero), ...proys.map((p) => String(p.numero))]
  const movs = filasMovimientos(foto, conocidos, (c) => lineas.get(c))
  const conLeido = (m: object) => ({ ...m, leido_at: foto.inicio })
  await upsert("zomatik_proyecto_movimientos", movs.delAnio.map(conLeido), "proyecto_numero,remito,articulo_codigo")
  await upsert("zomatik_proyecto_movimientos", movs.historia.map(conLeido), "proyecto_numero,remito,articulo_codigo")
  if (foto.renglones12 && foto.renglones12.length > 0) {
    // Lo que estaba en la ventana del año y Zomatik ya no trae (remito anulado): se saca
    const { error } = await sb.from("zomatik_proyecto_movimientos").delete().gte("fecha", foto.desde12).lt("leido_at", foto.inicio)
    if (error) throw error
  }
  if (foto.historia.completaPara.length > 0) {
    const { error } = await sb.from("zomatik_proyectos").update({ historia_leida_at: foto.inicio }).in("codigo", foto.historia.completaPara)
    if (error) throw error
  }
  out.movimientos = movs.delAnio.length + movs.historia.length

  // Remitido y última entrega de cada proyecto (con todos los movimientos guardados)
  const todos: any[] = []
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await sb.from("zomatik_proyecto_movimientos").select("proyecto_numero, fecha, m3, es_hormigon").order("id").range(desde, desde + 999)
    if (error) throw error
    todos.push(...((data as any[]) || []))
    if (!data || data.length < 1000) break
  }
  const tot = totalesPorProyecto(todos)
  const { data: lista, error: eL } = await sb.from("zomatik_proyectos").select("codigo, numero, remitido_m3, ultima_entrega")
  if (eL) throw eL
  for (const p of (lista as any[]) || []) {
    const t = tot.get(p.numero)
    const m3 = t?.m3 || 0
    const ultima = t?.ultima || null
    if (Number(p.remitido_m3) === m3 && (p.ultima_entrega || null) === ultima) continue
    const { error } = await sb.from("zomatik_proyectos").update({ remitido_m3: m3, ultima_entrega: ultima }).eq("codigo", p.codigo)
    if (error) throw error
  }

  // NP pendientes: se reemplazan
  if (foto.npPendientes) {
    await upsert("zomatik_np_pendientes", foto.npPendientes.map(conLeido), "numero")
    const { error } = await sb.from("zomatik_np_pendientes").delete().lt("leido_at", foto.inicio)
    if (error) throw error
    out.np_pendientes = foto.npPendientes.length
  }
  return out
}

/** Lectura completa: sesión, foto de Zomatik y grabado de las copias. */
export async function leerZomatik(opts: { presupuestoMs?: number } = {}): Promise<ResultadoLectura> {
  const t0 = Date.now()
  const partes: Record<string, unknown> = {}
  const errores: string[] = []
  const sb = sbAdmin()
  try {
    const previo = await leerPrevio(sb)
    const s = await obtenerSesion()
    let foto: Foto | null = null
    try {
      foto = await leerFoto(s, previo, { presupuestoMs: opts.presupuestoMs, partes, errores })
    } catch {
      // Falla grave (sesión o usuario): ya quedó en `errores`. No se graba nada a medias.
    }
    if (foto) partes.grabado = await guardarFoto(sb, foto, previo)
  } catch (e) {
    errores.push(textoError(e))
  }
  return { ok: errores.length === 0, partes, errores, ms: Date.now() - t0 }
}
