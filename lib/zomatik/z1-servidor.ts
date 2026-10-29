/**
 * Zomatik · Z1 · "Finalizar pedido" → OF + remito: el lado del servidor (SOLO rutas de app/api). Spec zomatik.md 26.
 *
 *   prepararRemitos  arma los remitos de un pedido en un día (uno por NP usada, 17.1) con los despachos que todavía no
 *                    se remitieron y los deja "pendiente" (zomatik_remito_crear: remito + despachos juntos, sin duplicar).
 *   prepararOfSueltas  los despachos manuales sin pedido (sin NP): solo la OF, el remito queda a mano (26.9).
 *   procesarZ1       con el turno del robot (el mismo que la NP y la lectura): por cada remito, primero la OF y después
 *                    el remito (16.3 A), guardando cada paso solo si la fila sigue "generando". La foto de las OF y el
 *                    número del remito se guardan ANTES de grabar: un corte nunca se repite a ciegas.
 *   pasadaZ1         la pasada de la noche: remite lo del día que quedó sin remitir (16.3).
 *
 * Número del remito (Bautista 29/10, "del anterior"): el más alto del talonario + 1, validado justo antes de grabar.
 * Talonario terminado: "revisar", aviso "Cargar talonario nuevo de RM/RM2 en Zomatik" y se reintenta con "Remitir".
 *
 * LLAVE PROPIA: `zomatik_np_config.remitir_activo` (apagada por defecto), y además la de la NP. `llaveZ1()` es el único
 * lugar que arma la llave que pide `navegadorZ1()`.
 */
import { sbServicio } from "@/lib/auth/servidor"
import { navegadorZ1, mensajeZomatik } from "@/lib/zomatik/cliente"
import { actividadNp, avisarGerenciales } from "@/lib/zomatik/np-servidor"
import { diaAR, hoyAR, quedaTiempo } from "@/lib/zomatik/np"
import { elegirNumeroRemito, generarOf, generarRemito, type LlaveZ1, type ResultadoZ1 } from "@/lib/zomatik/z1-robot"
import { marcaOfSuelta, marcaZ1, observacionesRemito, planificarRemitos, type DespachoZ1, type NpZ1 } from "@/lib/zomatik/z1"
import type { NavegadorNp } from "@/lib/zomatik/np-robot"

type SB = ReturnType<typeof sbServicio>

export type ConfigZ1 = { plant_id: string; activo: boolean; remitir_activo: boolean; remitir_desde: string | null; deposito: number | null }

/** Config por planta. Sin la migración de Z1 (no existe remitir_activo): vacío (todo apagado). */
export async function configZ1(sb: SB): Promise<Record<string, ConfigZ1>> {
  const { data, error } = await sb.from("zomatik_np_config").select("plant_id, activo, remitir_activo, remitir_desde, deposito")
  if (error) return {}
  return Object.fromEntries(((data as ConfigZ1[]) || []).map((c) => [c.plant_id, c]))
}

/** El ÚNICO lugar que arma la llave para OF + remito: la NP prendida Y la de remitir prendida. */
export function llaveZ1(c: ConfigZ1 | undefined): LlaveZ1 | null {
  return c?.activo === true && c.remitir_activo === true ? { remitir: true, plantId: c.plant_id } : null
}

const COLUMNAS_REMITO =
  "id, tipo, scheduled_dispatch_id, np_id, fecha, plant_id, marca, comprobante, m3, formula_id, patente, patentes, remitos_papel, estado, of_estado, of_numero, of_codigo, of_foto, remito_estado, remito_numero, remito_codigo, paso, mensaje, intentos, proximo_intento, en_curso_desde, created_at"

export type RemitoDB = {
  id: string; tipo: "pedido" | "suelto"; scheduled_dispatch_id: string | null; np_id: string | null; fecha: string; plant_id: string; marca: string; comprobante: "7" | "19" | null; m3: number
  formula_id: string | null; patente: string | null; patentes: string | null; remitos_papel: string | null; estado: string; of_estado: string
  of_numero: string | null; of_codigo: number | null; of_foto: string[] | null; remito_estado: string; remito_numero: string | null; remito_codigo: number | null
  paso: string | null; mensaje: string | null; intentos: number; proximo_intento: string | null; en_curso_desde: string | null; created_at: string
}

const despuesDe = (min: number) => new Date(Date.now() + min * 60_000).toISOString()
/** 00:00 del día en Argentina, en UTC */
const inicioDia = (dia: string) => new Date(`${dia}T03:00:00.000Z`).toISOString()

// ---------------------------------------------------------------------------
// Preparar los remitos de un pedido en un día
// ---------------------------------------------------------------------------

export type ResultadoPreparar = { activo: false; motivo: string } | { activo: true; creados: number; problemas: string[] }

export async function prepararRemitos(pedidoId: string, dia: string, usuario: string, sb: SB = sbServicio()): Promise<ResultadoPreparar> {
  const { data: p } = await sb.from("scheduled_dispatches").select("id, plant_id, construction_site_id").eq("id", pedidoId).maybeSingle()
  if (!p) return { activo: false, motivo: "El pedido no existe" }
  const ped = p as { id: string; plant_id: string }
  const cfg = (await configZ1(sb))[ped.plant_id]
  if (!llaveZ1(cfg)) return { activo: false, motivo: "OF y remito: se cargan a mano en Zomatik" }
  const fin = new Date(Date.parse(inicioDia(dia)) + 86400_000).toISOString()
  let q = sb.from("dispatches").select("id, quantity_m3, remito, remito_tipo, formula_id, plant_id, created_at, is_test_dispatch, mixers(license_plate)").eq("scheduled_dispatch_id", ped.id).gte("dispatch_date", inicioDia(dia)).lt("dispatch_date", fin)
  if (cfg!.remitir_desde) q = q.gte("created_at", cfg!.remitir_desde)
  const { data: ds, error: ed } = await q
  if (ed) throw ed
  const despachos: DespachoZ1[] = ((ds as any[]) || [])
    .filter((d) => !d.is_test_dispatch)
    .map((d) => ({ id: d.id, m3: Number(d.quantity_m3) || 0, remito: d.remito ?? null, remito_tipo: d.remito_tipo ?? null, patente: d.mixers?.license_plate ?? null, formula_id: d.formula_id ?? null, plant_id: d.plant_id ?? null, created_at: d.created_at }))
  if (!despachos.length) return { activo: true, creados: 0, problemas: [] }
  const { data: ya } = await sb.from("zomatik_remito_despachos").select("dispatch_id").in("dispatch_id", despachos.map((d) => d.id))
  const yaRemitidos = new Set(((ya as { dispatch_id: string }[]) || []).map((x) => x.dispatch_id))
  // Las NP que usa el pedido (en el orden de sus usos)
  const { data: us } = await sb.from("zomatik_np_uso").select("np_id, m3, created_at").eq("scheduled_dispatch_id", ped.id).eq("activo", true).order("created_at")
  const usos = (us as { np_id: string; m3: number; created_at: string }[]) || []
  const { data: ns } = usos.length ? await sb.from("zomatik_np").select("id, n, estado, numero, zomatik_codigo, formula_id, plant_id").in("id", usos.map((u) => u.np_id)) : { data: [] }
  const porId = new Map(((ns as any[]) || []).map((n) => [n.id, n]))
  const nps: NpZ1[] = usos.filter((u) => porId.has(u.np_id)).map((u) => {
    const n = porId.get(u.np_id)
    return { np_id: n.id, n: n.n, estado: n.estado, numero: n.numero, zomatik_codigo: n.zomatik_codigo, formula_id: n.formula_id, plant_id: n.plant_id, m3_uso: Number(u.m3) }
  })
  // Lo ya remitido contra cada NP por este pedido (otros días o un remito anterior del mismo día)
  const { data: prev } = await sb.from("zomatik_remitos").select("np_id, m3").eq("scheduled_dispatch_id", ped.id).neq("estado", "anulado")
  const remitidoPorNp = new Map<string, number>()
  for (const x of (prev as { np_id: string; m3: number }[]) || []) remitidoPorNp.set(x.np_id, (remitidoPorNp.get(x.np_id) || 0) + Number(x.m3))
  const plan = planificarRemitos(despachos, nps, yaRemitidos, remitidoPorNp)
  // Las marcas que ya tiene el pedido: un segundo remito del mismo día y NP lleva " - 2" (la marca no se repite)
  const { data: mm } = await sb.from("zomatik_remitos").select("marca").eq("scheduled_dispatch_id", ped.id)
  const marcas = new Set(((mm as { marca: string }[]) || []).map((x) => x.marca))
  let creados = 0
  for (const r of plan.remitos) {
    let marca = marcaZ1(ped.id, dia, r.np_n)
    for (let k = 2; marcas.has(marca) && k < 50; k++) marca = marcaZ1(ped.id, dia, r.np_n, ` - ${k}`)
    marcas.add(marca)
    const { data: id, error } = await sb.rpc("zomatik_remito_crear", {
      p: {
        tipo: "pedido", scheduled_dispatch_id: ped.id, np_id: r.np_id, fecha: dia, plant_id: ped.plant_id, marca, comprobante: r.comprobante, m3: r.m3,
        formula_id: despachos.find((d) => d.id === r.despachos[0].id)?.formula_id ?? "", patente: r.patente, patentes: r.patentes, remitos_papel: r.remitos_papel,
        despachos: r.despachos, created_by: usuario,
      },
    })
    if (error) throw error
    if (id) {
      creados++
      await actividadNp(sb, { usuario, action: "crear", pedidoId: ped.id, plantId: ped.plant_id, referencia: `Pedido ${ped.id.slice(0, 8)}`, detalle: { "Qué pasó": `OF + remito pendientes por ${r.m3} m³ (${dia})`, Despachos: r.remitos_papel || r.despachos.length } })
    }
  }
  if (plan.problemas.length) await actividadNp(sb, { usuario, pedidoId: ped.id, plantId: ped.plant_id, referencia: `Pedido ${ped.id.slice(0, 8)}`, detalle: { "Qué pasó": "No se puede remitir todo", Aviso: plan.problemas.join(" · ") } })
  return { activo: true, creados, problemas: plan.problemas }
}

/**
 * Despachos manuales sin pedido (sin NP) del día, de las plantas con la llave: una OF por despacho para que haya stock
 * (Bautista 29/10); el remito queda a mano (`remito_estado = 'a_mano'`). Va en la pasada de cada 10 min y en la de la
 * noche.
 */
export async function prepararOfSueltas(dia: string, usuario: string, sb: SB = sbServicio()): Promise<number> {
  const cfg = await configZ1(sb)
  const plantas = Object.values(cfg).filter((c) => llaveZ1(c))
  if (!plantas.length) return 0
  const fin = new Date(Date.parse(inicioDia(dia)) + 86400_000).toISOString()
  let creados = 0
  for (const c of plantas) {
    let q = sb.from("dispatches").select("id, quantity_m3, remito, formula_id, plant_id, created_at, is_test_dispatch, mixers(license_plate)").eq("plant_id", c.plant_id).is("scheduled_dispatch_id", null).gte("dispatch_date", inicioDia(dia)).lt("dispatch_date", fin).limit(200)
    if (c.remitir_desde) q = q.gte("created_at", c.remitir_desde)
    const { data: ds, error } = await q
    if (error) throw error
    const sueltos = ((ds as any[]) || []).filter((d) => !d.is_test_dispatch && Number(d.quantity_m3) > 0)
    if (!sueltos.length) continue
    const { data: ya } = await sb.from("zomatik_remito_despachos").select("dispatch_id").in("dispatch_id", sueltos.map((d) => d.id))
    const hechos = new Set(((ya as { dispatch_id: string }[]) || []).map((x) => x.dispatch_id))
    for (const d of sueltos) {
      if (hechos.has(d.id)) continue
      const m3 = Math.round(Number(d.quantity_m3) * 1000) / 1000
      const { data: id, error: e } = await sb.rpc("zomatik_remito_crear", {
        p: {
          tipo: "suelto", scheduled_dispatch_id: "", np_id: "", comprobante: "", fecha: dia, plant_id: c.plant_id, marca: marcaOfSuelta(d.id, dia), m3,
          formula_id: d.formula_id ?? "", patente: d.mixers?.license_plate ?? null, patentes: d.mixers?.license_plate ?? "", remitos_papel: d.remito ?? "",
          despachos: [{ id: d.id, m3 }], created_by: usuario,
        },
      })
      if (e) throw e
      if (id) {
        creados++
        await actividadNp(sb, { usuario, action: "crear", pedidoId: null, plantId: c.plant_id, referencia: `Despacho ${d.remito || d.id.slice(0, 8)}`, detalle: { "Qué pasó": `OF pendiente por ${m3} m³ (despacho sin pedido; el remito, a mano)` } })
      }
    }
  }
  return creados
}

// ---------------------------------------------------------------------------
// Procesar con el robot: OF y después remito
// ---------------------------------------------------------------------------

export type DependenciasZ1 = {
  navegador: (llave: LlaveZ1) => Promise<NavegadorNp>
  avisar: (sb: SB, titulo: string, lineas: string[]) => Promise<{ enviado: boolean; motivo?: string }>
}
export const DEPENDENCIAS_Z1: DependenciasZ1 = { navegador: navegadorZ1, avisar: avisarGerenciales }

async function guardarSi(sb: SB, id: string, cambios: Record<string, unknown>): Promise<boolean> {
  const { data, error } = await sb.from("zomatik_remitos").update({ ...cambios, updated_at: new Date().toISOString() } as never).eq("id", id).eq("estado", "generando").select("id")
  if (error) throw error
  return ((data as unknown[]) || []).length > 0
}

class Cambio extends Error {}

/** Lo que necesita el robot de cada remito: NP, artículo, depósito y obra. */
async function datos(sb: SB, r: RemitoDB) {
  const [{ data: np }, { data: f }, { data: ped }] = await Promise.all([
    r.np_id ? sb.from("zomatik_np").select("id, n, numero, zomatik_codigo, estado").eq("id", r.np_id).maybeSingle() : Promise.resolve({ data: null }),
    r.formula_id ? sb.from("formulas").select("id, code, zomatik_articulo_codigo, zomatik_articulo_nombre").eq("id", r.formula_id).maybeSingle() : Promise.resolve({ data: null }),
    r.scheduled_dispatch_id ? sb.from("scheduled_dispatches").select("id, construction_sites(name, address, localidad)").eq("id", r.scheduled_dispatch_id).maybeSingle() : Promise.resolve({ data: null }),
  ])
  const codArt = (f as { zomatik_articulo_codigo?: number | null } | null)?.zomatik_articulo_codigo ?? null
  const { data: a } = codArt ? await sb.from("zomatik_articulos").select("codigo, nombre, codigo_sistema").eq("codigo", codArt).maybeSingle() : { data: null }
  return {
    np: np as { numero: string | null; zomatik_codigo: number | null; estado: string } | null,
    articuloCodigo: codArt,
    articuloCodigoSistema: (a as { codigo_sistema?: number | null } | null)?.codigo_sistema ?? null,
    articuloNombre: (a as { nombre?: string } | null)?.nombre || (f as { zomatik_articulo_nombre?: string } | null)?.zomatik_articulo_nombre || "",
    obra: (ped as { construction_sites?: { name?: string } | null } | null)?.construction_sites?.name ?? null,
    entrega: {
      direccion: (ped as { construction_sites?: { address?: string | null } | null } | null)?.construction_sites?.address ?? null,
      localidad: (ped as { construction_sites?: { localidad?: string | null } | null } | null)?.construction_sites?.localidad ?? null,
      /** Pregunta 26.9: qué va en "lote" (la obra no lo tiene). Hasta que conteste, el alta tiene que traerlo. */
      lote: null as string | null,
    },
  }
}

export type ResultadoProcesoZ1 = { ocupado?: boolean; sinTiempo?: boolean; hechas: { id: string; estado: string; mensaje: string | null }[] }

export async function procesarZ1(o: { usuario: string; inicio: number; pedidoId?: string | null; sb?: SB; dep?: DependenciasZ1 }): Promise<ResultadoProcesoZ1> {
  const sb = o.sb ?? sbServicio()
  const dep = o.dep ?? DEPENDENCIAS_Z1
  if (!quedaTiempo(o.inicio, Date.now())) return { sinTiempo: true, hechas: [] }
  const cfg = await configZ1(sb)
  if (!Object.values(cfg).some((c) => llaveZ1(c))) return { hechas: [] }
  let q = sb.from("zomatik_remitos").select(COLUMNAS_REMITO).in("estado", ["pendiente", "generando", ...(o.pedidoId ? ["error", "revisar"] : [])]).order("created_at").limit(20)
  if (o.pedidoId) q = q.eq("scheduled_dispatch_id", o.pedidoId)
  const { data, error } = await q
  if (error) throw error
  // "Remitir en Zomatik" después de cargar un talonario nuevo: el "revisar" del talonario terminado (no se grabó nada,
  // el número quedó olvidado) vuelve a "error" para que se reintente. Ningún otro "revisar" se toca.
  for (const r of (data as unknown as RemitoDB[]) || []) {
    if (r.estado !== "revisar") continue
    if (o.pedidoId && r.paso === "numero_remito" && !r.remito_numero) {
      await sb.from("zomatik_remitos").update({ estado: "error", updated_at: new Date().toISOString() } as never).eq("id", r.id).eq("estado", "revisar").eq("paso", "numero_remito").is("remito_numero", null)
      r.estado = "error"
    }
  }
  const ahora = Date.now()
  const lista = ((data as unknown as RemitoDB[]) || []).filter((r) => r.estado !== "revisar").filter((r) =>
    r.estado === "generando" ? !!r.en_curso_desde && ahora - Date.parse(r.en_curso_desde) > 3 * 60_000 : o.pedidoId ? true : !!r.proximo_intento && Date.parse(r.proximo_intento) <= ahora,
  )
  if (!lista.length) return { hechas: [] }
  const quien = `z1·${o.usuario}·${o.inicio.toString(36)}`
  const { data: turno, error: et } = await sb.rpc("zomatik_robot_tomar", { p_quien: quien, p_segundos: 60 })
  if (et) throw et
  if (turno !== true) return { ocupado: true, hechas: [] }
  let nav: NavegadorNp | null = null
  let ultima = Date.now()
  const renovar = async () => {
    if (Date.now() - ultima < 10_000) return
    ultima = Date.now()
    await sb.rpc("zomatik_robot_tomar", { p_quien: quien, p_segundos: 60 })
  }
  const hechas: ResultadoProcesoZ1["hechas"] = []
  try {
    for (const r of lista) {
      if (!quedaTiempo(o.inicio, Date.now())) break
      const llave = llaveZ1(cfg[r.plant_id])
      if (!llave) continue
      const { data: tom, error: e1 } = await sb.rpc("zomatik_remito_tomar", { p_id: r.id, p_desde: ["pendiente", ...(o.pedidoId ? ["error"] : [])] })
      if (e1) throw e1
      const t = (tom as { remito_id: string; estado_anterior: string; paso_anterior: string | null }[] | null)?.[0]
      if (!t) continue
      // Un corte en Grabar (o después): primero se busca en Zomatik lo que pudo haber quedado (OF por la foto, remito por el número)
      const pasoAnt = t.paso_anterior || ""
      const cortadoOf = /^(grabar_of|verificar_of|buscar_of)$/.test(pasoAnt) || (t.estado_anterior === "generando" && r.of_estado !== "ok" && !!r.of_foto)
      const cortadoRemito = /^(grabar_remito|verificar_remito|buscar_remito)$/.test(pasoAnt) || (t.estado_anterior === "generando" && !!r.remito_numero)
      const ref = r.tipo === "suelto" ? `Despacho ${r.remitos_papel || r.marca.slice(-19)}` : `Pedido ${(r.scheduled_dispatch_id || "").slice(0, 8)}`
      const alPaso = async (paso: string, extra?: Record<string, unknown>) => {
        await renovar()
        const cambios: Record<string, unknown> = { paso }
        if (extra?.foto) cambios.of_foto = extra.foto
        if (extra?.numero) cambios.remito_numero = extra.numero
        if (!(await guardarSi(sb, r.id, cambios))) throw new Cambio("El remito cambió mientras se generaba")
      }
      const terminar = async (res: ResultadoZ1, que: "OF" | "remito") => {
        const est = res.estado === "pendiente" ? "pendiente" : res.estado
        await guardarSi(sb, r.id, {
          estado: est, en_curso_desde: null, mensaje: res.mensaje, paso: res.paso,
          proximo_intento: res.estado === "pendiente" || res.reintentar ? despuesDe(10) : null,
          ...(res.olvidarNumero ? { remito_numero: null } : {}),
          ...(que === "OF" ? { of_estado: est === "pendiente" ? "pendiente" : est } : { remito_estado: est === "pendiente" ? "pendiente" : est }),
        })
        await actividadNp(sb, { usuario: o.usuario, pedidoId: r.scheduled_dispatch_id, plantId: r.plant_id, referencia: ref, detalle: { "Qué pasó": `${que} no salió en Zomatik`, Mensaje: res.mensaje, Paso: res.paso, ...(res.recorte ? { "Respuesta de Zomatik (recorte)": res.recorte } : {}) } })
        if (res.estado === "revisar") await dep.avisar(sb, res.aviso || `${que} para revisar`, [res.mensaje || "", `Marca: ${r.marca}`])
        hechas.push({ id: r.id, estado: est, mensaje: res.mensaje })
      }
      try {
        const d = await datos(sb, r)
        if (!nav) nav = await dep.navegador(llave)
        const deposito = cfg[r.plant_id]?.deposito
        if (!deposito) {
          await terminar({ estado: "error", mensaje: "La planta no tiene depósito de Zomatik.", paso: "inicio" }, "OF")
          continue
        }
        // 1) La OF (si todavía no salió)
        if (r.of_estado !== "ok") {
          const of = await generarOf(nav, { marca: r.marca, deposito, fecha: String(r.fecha), m3: Number(r.m3), articuloCodigoSistema: d.articuloCodigoSistema, articuloNombre: d.articuloNombre, foto: r.of_foto, buscarAntes: cortadoOf }, { hoy: hoyAR(), alPaso })
          if (of.estado !== "ok") {
            await terminar(of, "OF")
            continue
          }
          await guardarSi(sb, r.id, { of_estado: "ok", of_numero: of.numero, of_codigo: of.codigo, paso: "of_ok" })
          await actividadNp(sb, { usuario: o.usuario, action: "crear", pedidoId: r.scheduled_dispatch_id, plantId: r.plant_id, referencia: ref, detalle: { "Qué pasó": `OF en Zomatik: ${of.numero}`, "m³": r.m3 } })
        }
        // 2) El remito. Despacho sin pedido (sin NP): queda a mano
        if (r.tipo === "suelto") {
          const m = "OF hecha. Despacho sin pedido: el remito se carga a mano."
          await guardarSi(sb, r.id, { estado: "ok", remito_estado: "a_mano", en_curso_desde: null, mensaje: m, paso: "of_ok", ok_at: new Date().toISOString(), proximo_intento: null })
          hechas.push({ id: r.id, estado: "ok", mensaje: m })
          continue
        }
        if (!d.np?.zomatik_codigo || d.np.estado !== "ok" || !r.comprobante) {
          await terminar({ estado: "error", mensaje: "La NP del remito no está en Zomatik.", paso: "inicio" }, "remito")
          continue
        }
        // El número es una entrada aparte: el que ya se eligió (y se guardó) o el más alto del talonario + 1
        let numero = r.remito_numero ? r.remito_numero.replace(/^RM2?\s+/i, "") : null
        if (!numero) {
          await alPaso("elegir_numero")
          numero = await elegirNumeroRemito(nav, r.comprobante, { hoy: hoyAR() })
          await alPaso("numero_elegido", { numero })
        }
        // Si falla, la OF queda hecha y el remito se reintenta solo (no se repite la OF)
        const obs = observacionesRemito(r.marca, { patentes: r.patentes || "", remitos_papel: r.remitos_papel || "" }, d.obra)
        const rm = await generarRemito(nav, {
          marca: r.marca, npCodigo: d.np.zomatik_codigo, comprobante: r.comprobante, deposito, fecha: String(r.fecha), m3: Number(r.m3),
          articuloCodigo: d.articuloCodigo, articuloNombre: d.articuloNombre, patente: r.patente, observaciones: obs.observaciones, observacionesimp: obs.observacionesimp,
          numero, entrega: d.entrega, buscarAntes: cortadoRemito,
        }, { hoy: hoyAR(), alPaso })
        if (rm.estado !== "ok") {
          await terminar(rm, "remito")
          continue
        }
        await guardarSi(sb, r.id, { estado: "ok", remito_estado: "ok", remito_numero: rm.numero, remito_codigo: rm.codigo, en_curso_desde: null, mensaje: null, paso: "ok", ok_at: new Date().toISOString(), proximo_intento: null })
        await actividadNp(sb, { usuario: o.usuario, action: "crear", pedidoId: r.scheduled_dispatch_id, plantId: r.plant_id, referencia: ref, detalle: { "Qué pasó": `Remito en Zomatik: ${rm.numero}`, "m³": r.m3, Camiones: r.patentes } })
        hechas.push({ id: r.id, estado: "ok", mensaje: rm.numero ?? null })
      } catch (e) {
        if (e instanceof Cambio) {
          hechas.push({ id: r.id, estado: "cambió", mensaje: e.message })
          continue
        }
        const m = mensajeZomatik(e) || (e as Error)?.message || "Error"
        await guardarSi(sb, r.id, { estado: "pendiente", en_curso_desde: null, mensaje: m, proximo_intento: despuesDe(10) })
        hechas.push({ id: r.id, estado: "pendiente", mensaje: m })
        if (/sesi[oó]n|entrar a Zomatik|login|ZOMATIK_USER/i.test(m)) break
      }
    }
  } finally {
    await sb.rpc("zomatik_robot_soltar", { p_quien: quien })
  }
  return { hechas }
}

// ---------------------------------------------------------------------------
// Pasada de la noche y estado para las pantallas
// ---------------------------------------------------------------------------

/** Remite lo del día que quedó sin remitir (16.3): pedidos finalizados o no, de las plantas con la llave prendida. */
export async function pasadaZ1(usuario: string, o: { dia?: string; sb?: SB } = {}): Promise<{ pedidos: number; creados: number }> {
  const sb = o.sb ?? sbServicio()
  const dia = o.dia ?? hoyAR()
  const cfg = await configZ1(sb)
  const plantas = Object.values(cfg).filter((c) => llaveZ1(c)).map((c) => c.plant_id)
  if (!plantas.length) return { pedidos: 0, creados: 0 }
  const fin = new Date(Date.parse(inicioDia(dia)) + 86400_000).toISOString()
  const { data } = await sb.from("dispatches").select("id, scheduled_dispatch_id").in("plant_id", plantas).gte("dispatch_date", inicioDia(dia)).lt("dispatch_date", fin).not("scheduled_dispatch_id", "is", null).limit(1000)
  const ids = [...new Set(((data as { scheduled_dispatch_id: string }[]) || []).map((d) => d.scheduled_dispatch_id))]
  let creados = 0
  for (const id of ids) {
    try {
      const r = await prepararRemitos(id, dia, usuario, sb)
      if (r.activo) creados += r.creados
    } catch (e) {
      console.error("[zomatik-z1] preparar", id, (e as Error)?.message)
    }
  }
  try {
    creados += await prepararOfSueltas(dia, usuario, sb)
  } catch (e) {
    console.error("[zomatik-z1] OF sueltas", (e as Error)?.message)
  }
  return { pedidos: ids.length, creados }
}

type EstadoRemito = { estado: string; remito_estado: string; of_numero: string | null; remito_numero: string | null; mensaje: string | null; fecha: string }

export async function estadoRemitos(ids: string[], sb: SB = sbServicio()): Promise<Record<string, EstadoRemito[]>> {
  if (!ids.length) return {}
  const { data, error } = await sb.from("zomatik_remitos").select("scheduled_dispatch_id, estado, remito_estado, of_numero, remito_numero, mensaje, fecha").in("scheduled_dispatch_id", ids).neq("estado", "anulado")
  if (error) return {}
  const out: Record<string, EstadoRemito[]> = {}
  for (const r of (data as any[]) || []) (out[r.scheduled_dispatch_id] ||= []).push({ estado: r.estado, remito_estado: r.remito_estado, of_numero: r.of_numero, remito_numero: r.remito_numero, mensaje: r.mensaje, fecha: r.fecha })
  return out
}

export { diaAR }
