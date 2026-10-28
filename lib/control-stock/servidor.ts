/**
 * Control de stock de materia prima · SOLO servidor. Lee Zomatik (INVENTARIO › MOVIMIENTOS STOCK, solo lectura, lista
 * cerrada de lib/zomatik/web.ts), guarda la copia y arma la comparación con nuestro sistema.
 *
 * Nunca escribe en Zomatik ni en stock_entries / stock_movements / materials. Escribe solo zomatik_stock_movimientos y
 * zomatik_stock_lecturas (clave de servicio). Especificación: docs/control-stock-mp.md.
 *
 * Mismas protecciones que el control de remitos: turno del robot, sucursal 18 confirmada antes y después de cada
 * export (fetchMatrizEnSucursal) y presupuesto de tiempo. El artículo se filtra con `idarticulo`: se prueba el código
 * del sistema del artículo (listado_articulos, como `farticulo` en la NP) y si no anda, el código visible; el que filtra
 * bien se verifica con los remitos de compra (RMP) de la copia de ESTAD R.COMPRA y se guarda para la próxima.
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import { obtenerSesion, discoverForm, fetchExport, fetchMatrizEnSucursal, ZomatikError, type FormInfo, type ZomatikSesion } from "@/lib/zomatik/cliente"
import { textoError } from "@/lib/zomatik/lectura"
import { desdeVentana, fechaArgentina } from "@/lib/control-ingresos/cruce"
import {
  MATERIALES,
  articuloDeListado,
  clavesRojas,
  comparar,
  inicioDeMes,
  partirPeriodo,
  sospechaCorte,
  unirMitades,
  leerReporteStock,
  libroDesdeRecuento,
  materialDeNombre,
  nuevoDeRecuento,
  resumenNuestro,
  resumenZomatik,
  seccionMailStock,
  verificarArticulo,
  verificarLectura,
  type ClaveMaterial,
  type FilaMail,
  type Lado,
  type MovNuestro,
  type MovZomatik,
} from "@/lib/control-stock/calculo"

const REPORTE = "reporte_movimientosdestock.php"
export const LINK_STOCK = "https://www.produccionrebucret.com/materias-primas?tab=control-stock"
/** Un día de Zomatik está al día si se leyó en las últimas 30 h. */
const FRESCO_MS = 30 * 3600_000
const DEPOSITOS_STOCK = [
  { id: 116, planta: "Canning" },
  { id: 113, planta: "Hudson" },
] as const

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))
const errorFormato = (m: string) => new ZomatikError("formato", m)

async function todasLasFilas<T>(q: (a: number, b: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; ; i += 1000) {
    const { data, error } = await q(i, i + 999)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return out
}

// ---------------------------------------------------------------------------
// Lectura de Zomatik
// ---------------------------------------------------------------------------

export type ParteStock = { deposito: number; codigo: string; ok: boolean; idarticulo?: string; renglones?: number; verificado?: string; motivo?: string; intentos?: string[] }
export type ResultadoStock = { ok: boolean; partes: ParteStock[]; error?: string; ms: number }

/** Código visible → código del sistema y nombre, de listado_articulos (líneas MP Áridos 131 y MP Cemento 130). */
async function articulosMp(s: ZomatikSesion): Promise<Map<string, { codigoSistema: string | null; nombre: string }>> {
  const f = await discoverForm(s, "listado_articulos.php")
  const out = new Map<string, { codigoSistema: string | null; nombre: string }>()
  for (const linea of ["131", "130"])
    for (const r of await fetchExport(s, "listado_articulos.php", f, { extra: { bus_linea: linea } })) {
      const a = articuloDeListado(r)
      if (a) out.set(a.codigo, { codigoSistema: a.codigoSistema, nombre: a.nombre })
    }
  return out
}

/**
 * Lee MOVIMIENTOS STOCK de los 5 materiales en Canning y Hudson, desde el inicio de la ventana del control (01/08 o 90
 * días) hasta hoy. Cada depósito y artículo se graba entero o no se graba (queda la lectura anterior, con el error).
 * `limite`: instante en que hay que dejar de leer. `turnoTomado`: el que llama ya tiene el turno del robot.
 */
export async function leerStockZomatik(sb: SupabaseClient, opts: { t0: number; limite: number }): Promise<ResultadoStock> {
  const hoy = fechaArgentina(opts.t0)
  const desde = desdeVentana(hoy)
  const partes: ParteStock[] = []
  const quien = `control-stock·${opts.t0.toString(36)}`
  let { data, error } = await sb.rpc("zomatik_robot_tomar", { p_quien: quien, p_segundos: 90 })
  const hastaTurno = Math.min(Date.now() + 20_000, opts.limite - 30_000)
  while (!error && data !== true && Date.now() < hastaTurno) {
    await espera(3_000)
    ;({ data, error } = await sb.rpc("zomatik_robot_tomar", { p_quien: quien, p_segundos: 90 }))
  }
  if (error) return { ok: false, partes, error: "Falta la migración del turno de Zomatik (zomatik_robot_tomar)", ms: Date.now() - opts.t0 }
  if (data !== true) return { ok: false, partes, error: "Otro proceso estaba trabajando en Zomatik", ms: Date.now() - opts.t0 }
  const renovar = setInterval(() => {
    sb.rpc("zomatik_robot_tomar", { p_quien: quien, p_segundos: 90 }).then(() => {}, () => {})
  }, 20_000)
  try {
    const [{ data: cfg }, previas, remitos] = await Promise.all([
      sb.from("zomatik_np_config").select("plant_id, deposito"),
      sb.from("zomatik_stock_lecturas").select("deposito, codigo_articulo, idarticulo, leido_at"),
      todasLasFilas<any>((a, b) => sb.from("zomatik_remitos_compra").select("remito_norm, codigo_articulo, deposito").gte("fecha", desde).order("id").range(a, b)),
    ])
    const plantaDe = new Map<number, string>(((cfg as any[]) || []).map((c) => [Number(c.deposito), c.plant_id]))
    const idPrevio = new Map<string, string>(((previas.data as any[]) || []).filter((p) => p.idarticulo).map((p) => [`${p.deposito}|${p.codigo_articulo}`, p.idarticulo]))
    // Último consumo nuestro de cada planta y material (para sospechar de un reporte cortado)
    const ultimoConsumo = new Map<string, string>()
    const { data: mats } = await sb.from("materials").select("id, name, plant_id")
    for (const m of (mats as any[]) || []) {
      const clave = materialDeNombre(m.name)
      const dep = [...plantaDe].find(([, p]) => p === m.plant_id)?.[0]
      if (!clave || !dep) continue
      const { data: u } = await sb.from("stock_movements").select("movement_date").eq("material_id", m.id).eq("movement_type", "consumo").lte("movement_date", hoy).order("movement_date", { ascending: false }).limit(1)
      const f = (u as any[])?.[0]?.movement_date
      if (f) ultimoConsumo.set(`${dep}|${MATERIALES.find((x) => x.clave === clave)!.codigo}`, String(f))
    }
    const s = await obtenerSesion()
    const articulos = await articulosMp(s)
    const form: FormInfo = await discoverForm(s, REPORTE)
    for (const campo of ["bus_deposito", "bus_linea", "idarticulo"])
      if (!(campo in form.fields)) throw errorFormato(`El buscador de MOVIMIENTOS STOCK no tiene "${campo}" (¿cambió la página?)`)
    if (!form.fechaDesdeField || !form.fechaHastaField) throw errorFormato("El buscador de MOVIMIENTOS STOCK no tiene las fechas (¿cambió la página?)")

    for (const dep of DEPOSITOS_STOCK)
      for (const mat of MATERIALES) {
        const parte: ParteStock = { deposito: dep.id, codigo: mat.codigo, ok: false, intentos: [] }
        partes.push(parte)
        if (opts.limite - Date.now() < 20_000) {
          parte.motivo = "sin tiempo (queda la lectura anterior)"
          continue
        }
        const art = articulos.get(mat.codigo)
        const candidatos = [...new Set([idPrevio.get(`${dep.id}|${mat.codigo}`), art?.codigoSistema, mat.codigo].filter((x): x is string => !!x))]
        const propios = new Set<string>(remitos.filter((r) => r.deposito === dep.id && r.codigo_articulo === mat.codigo && r.remito_norm).map((r) => r.remito_norm))
        const ajenos = new Set<string>(remitos.filter((r) => !(r.deposito === dep.id && r.codigo_articulo === mat.codigo) && r.remito_norm).map((r) => r.remito_norm))
        try {
          for (const id of candidatos) {
            if (opts.limite - Date.now() < 15_000) {
              parte.motivo = "sin tiempo (queda la lectura anterior)"
              break
            }
            const leer = async (p: { desde: string; hasta: string }) => {
              const m = await fetchMatrizEnSucursal(s, REPORTE, form, {
                desde: p.desde,
                hasta: p.hasta,
                extra: { bus_deposito: String(dep.id), bus_linea: mat.linea, idarticulo: id, articulo: art?.nombre || "" },
              })
              return { m, r: leerReporteStock(m.filas) }
            }
            const consumo = ultimoConsumo.get(`${dep.id}|${mat.codigo}`) || null
            const primera = await leer({ desde, hasta: hoy })
            if (!primera.r.encabezado && primera.r.totalAcumulado === null) {
              parte.intentos!.push(`${id}: no vino la tabla`)
              continue
            }
            let r = { movs: primera.r.movs, totalAcumulado: primera.r.totalAcumulado }
            const m = primera.m
            // ¿Cortada? Se parte el período en dos; si sigue sospechosa, no se guarda (queda el aviso en la pantalla)
            const sospecha = sospechaCorte({ movs: r.movs, paginado: m.paginado, hoy, ultimoConsumoNuestro: consumo })
            if (sospecha) {
              const mitades = partirPeriodo(desde, hoy)
              if (!mitades || opts.limite - Date.now() < 25_000) {
                parte.intentos!.push(`${id}: ${sospecha}`)
                continue
              }
              const a = await leer(mitades[0])
              const b = await leer(mitades[1])
              const sigue =
                sospechaCorte({ movs: a.r.movs, paginado: a.m.paginado, hoy: mitades[0].hasta, ultimoConsumoNuestro: null }) ||
                sospechaCorte({ movs: b.r.movs, paginado: b.m.paginado, hoy, ultimoConsumoNuestro: consumo })
              if (sigue) {
                parte.intentos!.push(`${id}: partido en dos, sigue sospechosa (${sigue})`)
                continue
              }
              r = { movs: unirMitades(a.r.movs, b.r.movs), totalAcumulado: a.r.totalAcumulado }
            }
            const v = verificarLectura(r.movs, r.totalAcumulado)
            if (!v.cierra) {
              parte.intentos!.push(`${id}: los saldos no cierran (¿mezcla artículos o vino cortado?)`)
              continue
            }
            const a = verificarArticulo(r.movs, propios, ajenos)
            if (!a.ok) {
              parte.intentos!.push(`${id}: ${a.motivo}`)
              continue
            }
            const lectura = {
              plant_id: plantaDe.get(dep.id) ?? null,
              articulo: art?.nombre || mat.nombre,
              idarticulo: id,
              desde,
              hasta: hoy,
              saldo_inicial: v.inicial,
              saldo_final: v.final,
              total_acumulado: r.totalAcumulado,
              total_es_inicial: v.totalEsInicial,
              cierra: v.cierra,
              verificado: a.estado,
              formato: m.formato,
            }
            const { error: eR } = await sb.rpc("control_stock_reemplazar", { p_deposito: dep.id, p_codigo: mat.codigo, p_lectura: lectura, p_movs: r.movs })
            if (eR) throw eR
            Object.assign(parte, { ok: true, idarticulo: id, renglones: r.movs.length, verificado: a.estado })
            break
          }
          if (!parte.ok && !parte.motivo) parte.motivo = `ningún idarticulo filtró bien (${parte.intentos!.join(" · ")})`
        } catch (e) {
          parte.motivo = textoError(e)
          if (e instanceof ZomatikError && ["sin_credenciales", "login_rechazado", "login_bloqueado", "sesion_caida"].includes(e.codigo)) {
            await anotarError(sb, parte, plantaDe)
            break
          }
        }
        if (!parte.ok) await anotarError(sb, parte, plantaDe)
      }
    const fallas = partes.filter((p) => !p.ok)
    return { ok: fallas.length === 0, partes, error: fallas.length ? `${fallas.length} de ${partes.length} sin leer: ${fallas.map((f) => `${f.deposito}/${f.codigo} ${f.motivo}`).join(" · ")}`.slice(0, 1500) : undefined, ms: Date.now() - opts.t0 }
  } catch (e) {
    return { ok: false, partes, error: textoError(e), ms: Date.now() - opts.t0 }
  } finally {
    clearInterval(renovar)
    await sb.rpc("zomatik_robot_soltar", { p_quien: quien })
  }
}

/** Deja el error de la última lectura sin tocar los datos de la anterior. */
async function anotarError(sb: SupabaseClient, p: ParteStock, plantaDe: Map<number, string>) {
  await sb
    .from("zomatik_stock_lecturas")
    .upsert({ deposito: p.deposito, codigo_articulo: p.codigo, plant_id: plantaDe.get(p.deposito) ?? null, intento_at: new Date().toISOString(), error: (p.motivo || "error").slice(0, 500) }, { onConflict: "deposito,codigo_articulo" })
    .then(() => {}, () => {})
}

// ---------------------------------------------------------------------------
// La comparación de un período
// ---------------------------------------------------------------------------

export type FilaStock = {
  plantaId: string
  planta: string
  materialId: string
  material: string
  clave: ClaveMaterial
  nuestro: Lado
  /** Stock actual − libro desde el último recuento (t). null = sin recuento. */
  sinRegistro: number | null
  ultimoRecuento: string | null
  zomatik: Lado | null
  comparacion: ReturnType<typeof comparar>
  lectura: { leidoAt: string | null; vieja: boolean; error: string | null; totalEsInicial: boolean | null; totalAcumulado: number | null; saldoInicial: number | null; idarticulo: string | null; verificado: string | null; desde: string | null } | null
}

/** Arma las filas (planta × material) del período [desde, hasta] (AAAA-MM-DD). Solo lee la base. */
export async function calcularStock(sb: SupabaseClient, desde: string, hasta: string): Promise<FilaStock[]> {
  const [{ data: plantas }, { data: mats }, { data: cfg }] = await Promise.all([
    sb.from("plants").select("id, name"),
    sb.from("materials").select("id, name, plant_id, current_stock"),
    sb.from("zomatik_np_config").select("plant_id, deposito"),
  ])
  const nombrePlanta = new Map(((plantas as any[]) || []).map((p) => [p.id, p.name]))
  const depositoDe = new Map(((cfg as any[]) || []).map((c) => [c.plant_id, Number(c.deposito)]))
  const materiales = ((mats as any[]) || [])
    .map((m) => ({ ...m, clave: materialDeNombre(m.name) }))
    .filter((m) => m.clave && nombrePlanta.has(m.plant_id))
  const ids = materiales.map((m) => m.id)
  if (!ids.length) return []

  // Último recuento de cada material (el libro arranca ahí)
  const recuentos = await todasLasFilas<any>((a, b) =>
    sb.from("stock_movements").select("material_id, notes, created_at").eq("reference_type", "recuento").in("material_id", ids).order("created_at", { ascending: false }).range(a, b),
  )
  const recuentoDe = new Map<string, { nuevoKg: number; creadoAt: string }>()
  for (const r of recuentos) {
    if (recuentoDe.has(r.material_id)) continue
    const n = nuevoDeRecuento(r.notes)
    if (n !== null) recuentoDe.set(r.material_id, { nuevoKg: n, creadoAt: r.created_at })
  }
  const desdeTs = `${desde}T03:00:00.000Z`
  const masViejo = [...recuentoDe.values()].map((r) => r.creadoAt).sort()[0] || desdeTs
  const corte = masViejo < desdeTs ? masViejo : desdeTs

  const [entradas, movimientos] = await Promise.all([
    todasLasFilas<any>((a, b) =>
      sb.from("stock_entries").select("material_id, entry_date, quantity, created_at").in("material_id", ids).or(`entry_date.gte.${desdeTs},created_at.gte.${corte}`).order("id").range(a, b),
    ),
    todasLasFilas<any>((a, b) =>
      sb
        .from("stock_movements")
        .select("material_id, movement_type, quantity_kg, movement_date, created_at")
        .in("material_id", ids)
        .in("movement_type", ["consumo", "ajuste", "transferencia"])
        .or(`movement_date.gte.${desde},created_at.gte.${corte}`)
        .order("id")
        .range(a, b),
    ),
  ])

  const zLecturas = await sb.from("zomatik_stock_lecturas").select("*")
  const lecturas = (zLecturas.data as any[]) || []
  const zMovs = await todasLasFilas<any>((a, b) => sb.from("zomatik_stock_movimientos").select("deposito, codigo_articulo, fecha, orden, comprobante, prefijo, descripcion, movimiento, saldo").order("id").range(a, b))

  const filas: FilaStock[] = []
  for (const m of materiales) {
    // Ingresos por entry_date (la cantidad del remito, `quantity`: no la seca); consumos y ajustes por movement_date
    const movs: (MovNuestro & { creadoAt: string })[] = [
      ...entradas.filter((e) => e.material_id === m.id).map((e) => ({ fecha: fechaArgentina(e.entry_date), tipo: "entrada" as const, kg: Number(e.quantity) || 0, creadoAt: e.created_at })),
      ...movimientos
        .filter((x) => x.material_id === m.id)
        .map((x) => ({ fecha: String(x.movement_date), tipo: x.movement_type === "consumo" ? ("consumo" as const) : ("ajuste" as const), kg: Number(x.quantity_kg) || 0, creadoAt: x.created_at })),
    ]
    const actual = Number(m.current_stock) || 0
    const enPeriodo = movs.filter((x) => x.fecha >= desde)
    const nuestro = resumenNuestro(actual, enPeriodo, desde, hasta)
    const rc = recuentoDe.get(m.id) || null
    const libro = libroDesdeRecuento(actual, rc, movs)
    const mat = MATERIALES.find((x) => x.clave === m.clave)!
    const dep = depositoDe.get(m.plant_id)
    const lec = lecturas.find((l) => l.deposito === dep && l.codigo_articulo === mat.codigo) || null
    let zomatik: Lado | null = null
    if (lec?.leido_at && lec.desde) {
      const zm: MovZomatik[] = zMovs
        .filter((x) => x.deposito === dep && x.codigo_articulo === mat.codigo)
        .map((x) => ({ fecha: x.fecha, orden: x.orden, comprobante: x.comprobante || "", prefijo: x.prefijo || "", descripcion: x.descripcion || "", movimiento: Number(x.movimiento), saldo: Number(x.saldo) }))
      zomatik = resumenZomatik({ desde: lec.desde, saldoInicial: Number(lec.saldo_inicial) || 0 }, zm, desde, hasta > lec.hasta ? lec.hasta : hasta)
    }
    filas.push({
      plantaId: m.plant_id,
      planta: nombrePlanta.get(m.plant_id),
      materialId: m.id,
      material: mat.nombre,
      clave: m.clave,
      nuestro,
      sinRegistro: libro && Math.abs(libro.sinRegistroKg) >= 1 ? libro.sinRegistroKg / 1000 : libro ? 0 : null,
      ultimoRecuento: rc?.creadoAt ?? null,
      zomatik,
      comparacion: comparar(nuestro, zomatik),
      lectura: lec
        ? {
            leidoAt: lec.leido_at,
            vieja: !lec.leido_at || Date.now() - Date.parse(lec.leido_at) > FRESCO_MS,
            error: lec.error,
            totalEsInicial: lec.total_es_inicial,
            totalAcumulado: lec.total_acumulado === null ? null : Number(lec.total_acumulado),
            saldoInicial: lec.saldo_inicial === null ? null : Number(lec.saldo_inicial),
            idarticulo: lec.idarticulo,
            verificado: lec.verificado,
            desde: lec.desde,
          }
        : null,
    })
  }
  const orden = (f: FilaStock) => `${f.planta}|${MATERIALES.findIndex((x) => x.clave === f.clave)}`
  return filas.sort((a, b) => (orden(a) < orden(b) ? -1 : 1))
}

/** Sección del mail de las 16:25: el mes en curso hasta hoy. Nunca tira: si falla, devuelve un aviso. */
export async function seccionStockParaMail(sb: SupabaseClient, hoy: string, errorLectura?: string | null): Promise<{ html: string; rojas: string[] } | null> {
  try {
    const desde = inicioDeMes(hoy)
    const filas = await calcularStock(sb, desde, hoy)
    if (!filas.length) return null
    const fm: FilaMail[] = filas.map((f) => ({
      clave: `${f.plantaId}|${f.clave}`,
      planta: f.planta,
      material: f.material,
      nuestroFinal: f.nuestro.final,
      zomatikFinal: f.zomatik ? f.zomatik.final : null,
      // En rojo por el stock final o por el neto (entró − salió)
      dif: f.comparacion ? { ...f.comparacion.final, rojo: f.comparacion.rojo } : null,
      aviso: !f.zomatik ? "sin lectura de Zomatik" : f.comparacion?.neto.rojo && !f.comparacion.final.rojo ? "el neto (entró − salió) no coincide" : null,
      vieja: f.zomatik && f.lectura?.vieja && f.lectura.leidoAt ? fechaArgentina(f.lectura.leidoAt) : null,
    }))
    const rojas = clavesRojas(fm)
    const aviso = errorLectura ? `Hoy no se pudo leer todo el stock de Zomatik (${errorLectura}).` : null
    return { html: seccionMailStock({ filas: fm, desde, hasta: hoy, link: LINK_STOCK, aviso }), rojas }
  } catch (e) {
    return { html: `<p style="color:#78350f">No se pudo armar el control de stock: ${String(textoError(e)).replace(/[<>&]/g, "")}</p>`, rojas: [] }
  }
}

