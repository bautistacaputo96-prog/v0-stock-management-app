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
 *        listas        AL FINAL: listado_listas.php y exportar_lista.php de cada lista ACTIVA (precio neto por artículo,
 *                      para el precio por m³ al programar). Si falla o no queda tiempo, quedan las de antes
 *      Historia, tipos y fichas van de a poco y respetan un presupuesto de tiempo (Vercel corta a los 60 s).
 *   2. `guardarFoto`: graba las copias (filas armadas en lib/zomatik/foto.ts).
 *
 * Las partes clientes y artículos (`leerClientes`/`leerArticulos` + `guardarClientes`/`guardarArticulos`) también
 * las corre sueltas "Actualizar desde Zomatik" del cartel de vincular (lib/zomatik/actualizar-copia.ts).
 *
 * El único precio que se guarda es el de las listas (zomatik_listas / zomatik_lista_precios, tablas que solo lee el
 * servidor): el precio por m³ al programar (docs/specs/2026-11-16-precio-en-programacion.md). Ningún otro monto.
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
  fetchListasHtml,
  fetchListaXls,
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
  preciosDeLista,
  cruzarPreciosLista,
  type Articulo,
  type ClienteListado,
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
  puedeBorrarViejos,
  filasRemitosDia,
  type Foto,
  type LecturaListas,
  type Previo,
} from "@/lib/zomatik/foto"
import { listasDeListado } from "@/lib/zomatik/np"

export type ResultadoLectura = { ok: boolean; partes: Record<string, unknown>; errores: string[]; ms: number }

const PRESUPUESTO_MS = 40_000
const FICHAS_POR_VEZ = 25
const TIPOS_POR_VEZ = 6
const LOTE = 200

function fallaGrave(e: unknown) {
  return e instanceof ZomatikError && ["sin_credenciales", "login_rechazado", "login_bloqueado", "sesion_caida"].includes(e.codigo)
}

/** ¿El error es de una tabla o función que no existe (falta la migración), y no otro error de la base? */
export function esFaltaDeTabla(e: unknown, nombre: RegExp): boolean {
  const m = String((e as { message?: string })?.message || "")
  const code = String((e as { code?: string })?.code || "")
  return nombre.test(m) && (["42P01", "42883", "PGRST202", "PGRST205"].includes(code) || /does not exist|schema cache|could not find/i.test(m))
}

export function textoError(e: unknown): string {
  if (e instanceof ZomatikError) return e.message
  const m = (e as any)?.message
  return typeof m === "string" && m ? m.slice(0, 300) : "Error inesperado"
}

/** Una foto sin nada leído (la lectura la va completando por partes). */
export function fotoVacia(): Foto {
  const hoy = hoyArgentina()
  return {
    inicio: new Date().toISOString(),
    hoy,
    desde12: sumarDias(hoy, -365),
    clientes: null,
    articulos: null,
    renglones12: null,
    proyectos: null,
    historia: { renglones: [], completaPara: [] },
    tipos: [],
    fichas: [],
    npPendientes: null,
  }
}

/** Parte "clientes": el listado completo (export). También la usa "Actualizar desde Zomatik" del cartel de vincular. */
export async function leerClientes(s: ZomatikSesion): Promise<ClienteListado[]> {
  const f = await discoverForm(s, "listado_clientes.php")
  const lista = clientesDeListado(await fetchExport(s, "listado_clientes.php", f))
  if (lista.length === 0) throw new ZomatikError("formato", "El listado de clientes vino vacío (¿cambió el formato?)")
  return lista
}

/** Parte "articulos": las líneas Hormigón, Hormigón (OBRAS) y Servicios (export). También la usa el cartel de vincular. */
export async function leerArticulos(s: ZomatikSesion): Promise<Articulo[]> {
  const f = await discoverForm(s, "listado_articulos.php")
  const todos: Articulo[] = []
  for (const linea of ["132", "136", "135"]) todos.push(...articulosDeListado(await fetchExport(s, "listado_articulos.php", f, { extra: { bus_linea: linea } })))
  if (todos.length === 0) throw new ZomatikError("formato", "El listado de artículos vino vacío")
  return todos
}

/**
 * Parte "listas": el listado de listas de precios y el export de cada lista ACTIVA (precio neto por nombre de artículo).
 * También la usa "Actualizar" del precio en Programación (actualizar-copia.ts, tipo "precios"). No toca la base.
 */
export async function leerListas(s: ZomatikSesion): Promise<LecturaListas> {
  const listas = listasDeListado(await fetchListasHtml(s))
  if (listas.length === 0) throw new ZomatikError("formato", "El listado de listas de precios vino vacío (¿cambió el formato?)")
  const precios: LecturaListas["precios"] = []
  for (const l of listas.filter((x) => /^activ/i.test(x.estado))) {
    const filas = preciosDeLista(await fetchListaXls(s, l.codigo))
    if (filas.length === 0) throw new ZomatikError("formato", `La lista ${l.codigo} vino sin precios (¿cambió el export?)`)
    precios.push({ lista: l.codigo, filas })
  }
  return { listas, precios }
}

/**
 * Graba las listas: todas en zomatik_listas (las que ya no están en Zomatik se borran) y, por cada activa, reemplaza sus
 * precios en zomatik_lista_precios cruzando por nombre con los artículos (`articulos` de la misma lectura o la copia).
 * Borra los precios de las listas que ya no están activas. `inicio` = cuándo empezó la lectura (leida_at).
 * Si una lista activa no cruza NINGÚN nombre (¿cambiaron los nombres o la copia de artículos vino vacía?), no se borran
 * sus precios de antes: quedan y se avisa en `avisos`.
 */
export async function guardarListas(sb: SupabaseClient, l: LecturaListas, inicio: string, articulos?: { codigo: number; nombre: string }[] | null): Promise<{ listas: number; activas: number; precios: number; sin_cruzar: number; avisos: string[] }> {
  let arts = articulos && articulos.length ? articulos : null
  if (!arts) {
    const { data, error } = await sb.from("zomatik_articulos").select("codigo, nombre").limit(5000)
    if (error) throw error
    arts = ((data as { codigo: number; nombre: string }[]) || []).map((a) => ({ codigo: Number(a.codigo), nombre: a.nombre }))
  }
  await upsertLotes(sb, "zomatik_listas", l.listas.map((x) => ({ codigo: x.codigo, nombre: x.nombre, desde: x.desde, estado: x.estado, leida_at: inicio })), "codigo")
  const { error: eL } = await sb.from("zomatik_listas").delete().lt("leida_at", inicio)
  if (eL) throw eL
  let precios = 0
  let sinCruzar = 0
  const avisos: string[] = []
  for (const p of l.precios) {
    const filas = cruzarPreciosLista(p.filas, arts)
    sinCruzar += p.filas.length - filas.length
    if (!filas.length) {
      avisos.push(`La lista ${p.lista} no cruzó ningún artículo por nombre: quedan sus precios de antes.`)
      continue
    }
    await upsertLotes(sb, "zomatik_lista_precios", filas.map((f) => ({ lista_codigo: p.lista, ...f, leida_at: inicio })), "lista_codigo,articulo_codigo")
    const { error } = await sb.from("zomatik_lista_precios").delete().eq("lista_codigo", p.lista).lt("leida_at", inicio)
    if (error) throw error
    precios += filas.length
  }
  const activas = l.precios.map((p) => p.lista)
  const q = sb.from("zomatik_lista_precios").delete()
  const { error: eV } = activas.length ? await q.not("lista_codigo", "in", `(${activas.join(",")})`) : await q.gte("lista_codigo", 0)
  if (eV) throw eV
  return { listas: l.listas.length, activas: activas.length, precios, sin_cruzar: sinCruzar, avisos }
}

/** Lee de Zomatik todo lo de Z0. No toca la base. `partes` y `errores` se completan por parte. */
export async function leerFoto(
  s: ZomatikSesion,
  previo: Previo,
  opts: { presupuestoMs?: number; partes: Record<string, unknown>; errores: string[] },
): Promise<Foto> {
  const t0 = Date.now()
  const queda = () => (opts.presupuestoMs ?? PRESUPUESTO_MS) - (Date.now() - t0)
  const foto = fotoVacia()
  const { hoy, desde12 } = foto
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
    foto.clientes = await leerClientes(s)
    return foto.clientes.length
  })

  await parte("articulos", async () => {
    foto.articulos = await leerArticulos(s)
    return foto.articulos.length
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

  // Al final: lo nuevo no le quita tiempo a lo de siempre. Sin tiempo, quedan las de antes
  await parte("listas", async () => {
    if (queda() < 4_000) return "sin tiempo"
    foto.listas = await leerListas(s)
    return { listas: foto.listas.listas.length, activas: foto.listas.precios.length }
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

async function upsertLotes(sb: SupabaseClient, tabla: string, filas: Record<string, unknown>[], onConflict: string) {
  await enLotes(filas, async (lote) => {
    const { error } = await sb.from(tabla).upsert(lote, { onConflict })
    if (error) throw error
  })
}

/**
 * Graba la copia de clientes con lo que trae la foto (listado y, si se leyeron los remitos, R/X del año). Sin los
 * remitos (`renglones12` null) no toca remitos_r_12m / remitos_x_12m / ultimo_remito. Devuelve cuántos grabó.
 */
export async function guardarClientes(sb: SupabaseClient, foto: Foto): Promise<number> {
  const cli = filasClientes(foto)
  await upsertLotes(sb, "zomatik_clientes", cli, "codigo")
  return cli.length
}

/** Graba la copia de artículos de la foto. Devuelve cuántos grabó. */
export async function guardarArticulos(sb: SupabaseClient, foto: Foto): Promise<number> {
  const arts = filasArticulos(foto)
  try {
    await upsertLotes(sb, "zomatik_articulos", arts, "codigo")
  } catch (e) {
    // Sin la migración de Z2 (202610222200) no existe codigo_sistema: se graba como antes
    if (!/codigo_sistema/.test((e as { message?: string })?.message || "")) throw e
    await upsertLotes(sb, "zomatik_articulos", arts.map(({ codigo_sistema: _c, ...a }) => a), "codigo")
  }
  return arts.length
}

/** Graba la foto en las copias. Devuelve conteos de lo grabado. */
export async function guardarFoto(sb: SupabaseClient, foto: Foto, previo: Previo): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {}
  const upsert = (tabla: string, filas: Record<string, unknown>[], onConflict: string) => upsertLotes(sb, tabla, filas, onConflict)

  // Clientes (listado + R/X del año) y fichas
  out.clientes = await guardarClientes(sb, foto)
  for (const f of filasFichas(foto)) {
    const { error } = await sb.from("zomatik_clientes").update(f.valores).eq("codigo", f.codigo)
    if (error) throw error
  }
  out.fichas = foto.fichas.length

  // Artículos
  out.articulos = await guardarArticulos(sb, foto)
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
  const { count: guardadosAnio, error: eC } = await sb
    .from("zomatik_proyecto_movimientos")
    .select("id", { count: "exact", head: true })
    .gte("fecha", foto.desde12)
  if (eC) throw eC
  await upsert("zomatik_proyecto_movimientos", movs.delAnio.map(conLeido), "proyecto_numero,remito,articulo_codigo")
  await upsert("zomatik_proyecto_movimientos", movs.historia.map(conLeido), "proyecto_numero,remito,articulo_codigo")
  if (foto.renglones12 && foto.renglones12.length > 0) {
    // Lo que estaba en la ventana del año y Zomatik ya no trae (remito anulado): se saca, salvo que la lectura
    // haya caído mucho respecto de lo guardado (export cortado o formato cambiado: mejor no borrar)
    if (puedeBorrarViejos(movs.delAnio.length, guardadosAnio || 0)) {
      const { error } = await sb.from("zomatik_proyecto_movimientos").delete().gte("fecha", foto.desde12).lt("leido_at", foto.inicio)
      if (error) throw error
    } else {
      out.movimientos_sin_borrar = `La lectura trajo ${movs.delAnio.length} renglones del año y había ${guardadosAnio}: no se borró nada`
    }
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

  // Resumen diario de remitos por cliente (cruce por fechas y m³). Si falta su migración, no corta el resto.
  try {
    const rd = filasRemitosDia(foto)
    if (rd.length > 0) {
      const { count: antes, error: eA } = await sb.from("zomatik_remitos_dia").select("cliente_norm", { count: "exact", head: true }).gte("fecha", foto.desde12)
      if (eA) throw eA
      await upsert("zomatik_remitos_dia", rd, "cliente_norm,fecha,planta")
      if (puedeBorrarViejos(rd.length, antes || 0)) {
        const { error } = await sb.from("zomatik_remitos_dia").delete().lt("leido_at", foto.inicio)
        if (error) throw error
      }
    }
    out.remitos_dia = rd.length
  } catch (e: any) {
    out.remitos_dia = /zomatik_remitos_dia/.test(e?.message || "") ? "falta la migración 202610212000" : `error: ${String(e?.message || e).slice(0, 120)}`
  }

  // NP pendientes: se reemplazan
  if (foto.npPendientes) {
    await upsert("zomatik_np_pendientes", foto.npPendientes.map(conLeido), "numero")
    const { error } = await sb.from("zomatik_np_pendientes").delete().lt("leido_at", foto.inicio)
    if (error) throw error
    out.np_pendientes = foto.npPendientes.length
  }

  // Listas de precios, al final (si falla, quedan las de antes). Sin su migración, no corta nada.
  if (foto.listas) {
    try {
      out.listas = await guardarListas(sb, foto.listas, foto.inicio, foto.articulos)
    } catch (e: any) {
      out.listas = esFaltaDeTabla(e, /zomatik_lista/) ? "falta la migración 202611161600" : `error: ${String(e?.message || e).slice(0, 120)}`
    }
  }
  return out
}

/** Lectura completa: sesión, foto de Zomatik y grabado de las copias. */
export async function leerZomatik(opts: { presupuestoMs?: number } = {}): Promise<ResultadoLectura> {
  const t0 = Date.now()
  const partes: Record<string, unknown> = {}
  const errores: string[] = []
  const sb = sbAdmin()
  // Z2: el mismo turno que el robot de la NP (una sola sesión trabajando en Zomatik a la vez, 23.3 e).
  // Sin la migración de Z2 la función no existe y se lee como antes.
  const quien = `lectura·${t0.toString(36)}`
  let conTurno = false
  let renovar: ReturnType<typeof setInterval> | null = null
  try {
    // Si el robot de las NP tiene el turno, se espera hasta ~30 s (lo suelta al terminar) antes de rendirse
    let { data, error } = await sb.rpc("zomatik_robot_tomar", { p_quien: quien, p_segundos: 90 })
    while (!error && data !== true && Date.now() - t0 < 30_000) {
      await new Promise((r) => setTimeout(r, 3_000))
      ;({ data, error } = await sb.rpc("zomatik_robot_tomar", { p_quien: quien, p_segundos: 90 }))
    }
    if (!error) {
      if (data !== true) return { ok: false, partes, errores: ["El robot de las NP está trabajando en Zomatik: la lectura se hace en un rato."], ms: Date.now() - t0 }
      conTurno = true
      // Mientras se lee, el turno se renueva cada 20 s (vence a los 90 s si el proceso se corta)
      renovar = setInterval(() => {
        sb.rpc("zomatik_robot_tomar", { p_quien: quien, p_segundos: 90 }).then(() => {}, () => {})
      }, 20_000)
    }
  } catch {
    /* sin la migración de Z2 */
  }
  try {
    const previo = await leerPrevio(sb)
    const s = await obtenerSesion()
    let foto: Foto | null = null
    try {
      // Lo que se esperó por el turno se descuenta del presupuesto
      const esperado = Date.now() - t0
      foto = await leerFoto(s, previo, { presupuestoMs: opts.presupuestoMs !== undefined ? Math.max(5_000, opts.presupuestoMs - esperado) : esperado > 1_000 ? Math.max(5_000, PRESUPUESTO_MS - esperado) : undefined, partes, errores })
    } catch {
      // Falla grave (sesión o usuario): ya quedó en `errores`. No se graba nada a medias.
    }
    if (foto) partes.grabado = await guardarFoto(sb, foto, previo)
    // Una lista que no cruzó ningún artículo (quedaron sus precios de antes) se avisa como un error de la lectura
    const gl = (partes.grabado as { listas?: { avisos?: string[] } | string } | undefined)?.listas
    if (gl && typeof gl === "object") errores.push(...(gl.avisos || []).map((a) => `listas: ${a}`))
    else if (typeof gl === "string" && gl.startsWith("error")) errores.push(`listas: ${gl}`)
  } catch (e) {
    errores.push(textoError(e))
  } finally {
    if (renovar) clearInterval(renovar)
    if (conTurno) await sb.rpc("zomatik_robot_soltar", { p_quien: quien })
  }
  return { ok: errores.length === 0, partes, errores, ms: Date.now() - t0 }
}
