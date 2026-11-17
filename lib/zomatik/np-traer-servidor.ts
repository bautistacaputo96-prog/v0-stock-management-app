/**
 * Zomatik · Traer NP de Zomatik (docs/specs/2026-11-17-traer-np-de-zomatik.md, sección 6). SOLO servidor.
 *
 * Quien programa escribe el número de una NP que ya está en Zomatik (cargada a mano, por ejemplo para facturarla antes)
 * y el sistema la registra en `zomatik_np` como una fila más, sin pedido: desde ahí se usa como "NP con saldo"
 * (`sincronizar` → `validarSaldo` → `zomatik_np_reservar`), se remite y se ajusta como cualquier otra.
 *
 *   1. El número (sin red): `numeroNpTipeado` y la serie de REBUCRET.
 *   2. La planta y su llave (apagada: "NP: se carga a mano").
 *   3. El cliente y la fórmula del pedido, si vinieron (vinculados con Zomatik; la fórmula, de la planta).
 *   4. ¿Ya está en el sistema? Se usa esa, sin leer Zomatik.
 *   5. El turno del robot (una sola sesión en Zomatik a la vez): hasta 15 s; si no, "ocupado".
 *   6. Leer en Zomatik, SOLO LECTURA: el listado por número y la NP abierta (`rutaLecturaNp`, atado a esa NP).
 *   7. Los controles (`evaluarNpTraida`). En el alta, el cliente y la fórmula salen de la NP.
 *   8. Registrar: un insert en `zomatik_np` (marca "Traida de Zomatik - NP …", estado ok, paso autorizada).
 *
 * Sin montos en ningún lado: ni en la respuesta, ni en la base, ni en Actividad. El robot no escribe nada en Zomatik.
 */
import { sbServicio } from "@/lib/auth/servidor"
import { navegadorLectura, navegadorLecturaNp } from "@/lib/zomatik/cliente"
import { buscarNpPorNumero, leerNpParaTraer, type FilaTraer, type NavegadorNp } from "@/lib/zomatik/np-robot"
import {
  COLUMNAS_NP, PASO_AUTORIZADA, actividadNp, esFallaDeAcceso, llaveDe, npUsable, npsConSaldo, plantasNp, type FilaNpDB, type NpSaldo,
} from "@/lib/zomatik/np-servidor"
import {
  MSJ_TRAER, SUCURSAL_REBUCRET, comprobanteDeNumero, esRenglonDe, esSerieRebucret, evaluarNpTraida, marcaTraida, numeroCompleto, numeroNpTipeado,
  type MotivoTraer, type NpLeidaTraer, type PedidoTraer, type Renglon,
} from "@/lib/zomatik/np"
import { MSJ_NP_AJUSTANDOSE } from "@/lib/zomatik/ajuste"

type SB = ReturnType<typeof sbServicio>

/** Lo que `traerNp` necesita de afuera (en las pruebas se reemplaza). */
export type DependenciasTraer = {
  navegadorLectura: () => Promise<NavegadorNp>
  navegadorLecturaNp: (codigoNp: number) => Promise<NavegadorNp>
  robot: { buscarNpPorNumero: typeof buscarNpPorNumero; leerNpParaTraer: typeof leerNpParaTraer }
  /** Reloj y espera del turno (simulados en las pruebas). */
  ahora?: () => number
  esperar?: (ms: number) => Promise<void>
}

export const DEPENDENCIAS_TRAER: DependenciasTraer = { navegadorLectura, navegadorLecturaNp, robot: { buscarNpPorNumero, leerNpParaTraer } }

export type ResultadoTraer =
  | { ok: true; yaEstaba: boolean; np: NpSaldo; remito: "R" | "X"; avisos: string[] }
  /** `datos`: lo que mandó la pantalla no sirve (400). `elegirFormula`: en el alta, más de una fórmula de la planta con ese artículo. */
  | { ok: false; motivo: MotivoTraer | "datos"; error: string; elegirFormula?: { id: string; code: string }[] }

/** Cuánto se espera el turno del robot antes de decir "ocupado" (el botón espera la respuesta). */
const ESPERA_TURNO_MS = 15_000
const ENTRE_INTENTOS_MS = 3_000
const RENOVAR_MS = 10_000

type ClienteDB = { id: string; name: string; zomatik_codigo: number | null }
type FormulaDB = { id: string; code: string; plant_id: string | null; zomatik_articulo_codigo: number | null; zomatik_articulo_nombre: string | null }

const no = (motivo: MotivoTraer | "datos", error: string, extra: { elegirFormula?: { id: string; code: string }[] } = {}): ResultadoTraer => ({ ok: false, motivo, error, ...extra })

export async function traerNp(o: {
  numero: string
  plantId: string
  clientId?: string | null
  formulaId?: string | null
  remito?: "R" | "X" | null
  usuario: string
  sb?: SB
  dep?: DependenciasTraer
}): Promise<ResultadoTraer> {
  const sb = o.sb ?? sbServicio()
  const dep = o.dep ?? DEPENDENCIAS_TRAER
  const ahora = dep.ahora ?? Date.now
  const esperar = dep.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  // 1. El número (sin red)
  const t = numeroNpTipeado(o.numero)
  if (!t) return no("formato", MSJ_TRAER.formato)
  if (!esSerieRebucret(t.numero)) return no("otra_serie", MSJ_TRAER.otra_serie)

  // 2. La planta y su llave
  const plantas = await plantasNp(sb)
  const planta = plantas[o.plantId]
  if (!planta) return no("datos", "La planta no existe.")
  if (!llaveDe(planta)) return no("apagada", MSJ_TRAER.apagada)

  // 3. El cliente y la fórmula del pedido (si vinieron)
  let cliente: ClienteDB | null = null
  if (o.clientId) {
    const { data } = await sb.from("clients").select("id, name, zomatik_codigo").eq("id", o.clientId).maybeSingle()
    cliente = (data as ClienteDB | null) ?? null
    if (!cliente) return no("datos", "El cliente no existe.")
    if (!cliente.zomatik_codigo) return no("cliente_sin_vinculo", MSJ_TRAER.cliente_sin_vinculo)
  }
  let formula: FormulaDB | null = null
  if (o.formulaId) {
    const { data } = await sb.from("formulas").select("id, code, plant_id, zomatik_articulo_codigo, zomatik_articulo_nombre").eq("id", o.formulaId).maybeSingle()
    formula = (data as FormulaDB | null) ?? null
    if (!formula || formula.plant_id !== o.plantId) return no("datos", "La fórmula no es de esa planta.")
    if (!formula.zomatik_articulo_codigo) return no("formula_sin_vinculo", MSJ_TRAER.formula_sin_vinculo)
  }

  // 4. ¿Ya está en el sistema? (sin Zomatik)
  const numeros = t.comprobante ? [numeroCompleto(t.comprobante, t.numero)] : [numeroCompleto("15", t.numero), numeroCompleto("16", t.numero)]
  const { data: ya, error: eYa } = await sb.from("zomatik_np").select(COLUMNAS_NP).in("numero", numeros)
  if (eYa) throw eYa
  const enSistema = (ya as unknown as FilaNpDB[] | null) || []
  if (new Set(enSistema.map((x) => x.numero)).size > 1) return no("ambigua", MSJ_TRAER.ambigua)
  if (enSistema.length) {
    const fila = enSistema.find((x) => x.estado === "ok") || enSistema[0]
    return usarExistente(sb, fila, { cliente, formula, plantId: o.plantId, remito: o.remito ?? null })
  }

  // 5. El turno del robot (el mismo que la lectura nocturna y el robot de las NP)
  const t0 = ahora()
  const quien = `traer·${o.usuario}·${t0.toString(36)}`
  const tomar = () => sb.rpc("zomatik_robot_tomar", { p_quien: quien, p_segundos: 60 })
  let { data: turno, error: eT } = await tomar()
  if (eT) throw eT
  while (turno !== true && ahora() - t0 < ESPERA_TURNO_MS) {
    await esperar(ENTRE_INTENTOS_MS)
    ;({ data: turno, error: eT } = await tomar())
    if (eT) throw eT
  }
  if (turno !== true) return no("ocupado", MSJ_TRAER.ocupado)
  const latido = setInterval(() => {
    tomar().then(() => {}, () => {})
  }, RENOVAR_MS)
  ;(latido as { unref?: () => void }).unref?.()
  try {
    return await leerYRegistrar(sb, dep, { ...o, t, planta: { id: planta.id, name: planta.name, deposito: planta.zomatik_deposito ?? null }, cliente, formula })
  } finally {
    clearInterval(latido)
    await sb.rpc("zomatik_robot_soltar", { p_quien: quien }).then(() => {}, () => {})
  }
}

/** Una falla al leer Zomatik: de entrada o red → "zomatik"; lo que no se entiende → "no_se_entiende" (con el recorte en
 *  Actividad). Lo demás (por ejemplo, una ruta fuera de la lista cerrada) es nuestro: se tira (500). */
async function fallaZomatik(sb: SB, e: unknown, o: { usuario: string; plantId: string; ref: string }): Promise<ResultadoTraer> {
  const codigo = String((e as { codigo?: unknown } | null)?.codigo ?? "")
  if (esFallaDeAcceso(e) || (e as Error)?.name === "AbortError") return no("zomatik", MSJ_TRAER.zomatik)
  if (codigo === "formato") {
    const recorte = (e as { recorte?: string }).recorte
    await actividadNp(sb, { usuario: o.usuario, pedidoId: null, plantId: o.plantId, referencia: o.ref, detalle: { "Qué pasó": "Traer NP de Zomatik: no se entendió la NP", Mensaje: (e as Error).message, ...(recorte ? { "Respuesta de Zomatik (recorte)": recorte } : {}) } })
    return no("no_se_entiende", MSJ_TRAER.no_se_entiende)
  }
  throw e
}

async function leerYRegistrar(
  sb: SB,
  dep: DependenciasTraer,
  o: { usuario: string; plantId: string; remito?: "R" | "X" | null; t: { numero: string; comprobante: "15" | "16" | null }; planta: { id: string; name: string; deposito: number | null }; cliente: ClienteDB | null; formula: FormulaDB | null },
): Promise<ResultadoTraer> {
  const ref = `NP ${o.t.numero}`
  // 6. Leer en Zomatik (solo lectura)
  let filaZ: FilaTraer
  let leida: Omit<NpLeidaTraer, "fila">
  try {
    const filas = (await dep.robot.buscarNpPorNumero(await dep.navegadorLectura(), o.t)).filas
    if (!filas.length) return no("no_existe", MSJ_TRAER.no_existe)
    if (filas.length > 1) {
      if (new Set(filas.map((f) => comprobanteDeNumero(f.numero))).size > 1) return no("ambigua", MSJ_TRAER.ambigua)
      throw Object.assign(new Error(`el listado trae ${filas.length} NP con el número ${o.t.numero}`), { codigo: "formato" })
    }
    filaZ = filas[0]
    const comp = comprobanteDeNumero(filaZ.numero)
    leida = await dep.robot.leerNpParaTraer(await dep.navegadorLecturaNp(filaZ.codigo), { codigo: filaZ.codigo, numero: filaZ.numero, comprobante: comp })
  } catch (e) {
    return fallaZomatik(sb, e, { usuario: o.usuario, plantId: o.plantId, ref })
  }
  const comprobante = comprobanteDeNumero(filaZ.numero)
  if (!comprobante) return fallaZomatik(sb, Object.assign(new Error("la fila del listado no dice NP ni NP2"), { codigo: "formato" }), { usuario: o.usuario, plantId: o.plantId, ref })

  // 7. Los controles. En el alta (sin cliente o sin fórmula) se controla primero lo que no depende de ellos
  const articuloDe = async (f: FormulaDB) => {
    const { data: a } = await sb.from("zomatik_articulos").select("codigo, nombre").eq("codigo", f.zomatik_articulo_codigo).maybeSingle()
    return { codigo: f.zomatik_articulo_codigo, nombre: (a as { nombre?: string } | null)?.nombre || f.zomatik_articulo_nombre || f.code }
  }
  const pedido = (cliente: ClienteDB | null, articulo: PedidoTraer["articulo"]): PedidoTraer => ({
    clienteCodigo: cliente ? Number(cliente.zomatik_codigo) : null, articulo, depositoPlanta: o.planta.deposito, nombrePlanta: o.planta.name, remito: o.remito ?? null,
  })
  let cliente = o.cliente
  let formula = o.formula
  let articulo = formula ? await articuloDe(formula) : null
  let ev = evaluarNpTraida({ fila: filaZ, ...leida, pedido: pedido(cliente, articulo) })
  if (!ev.ok) return no(ev.motivo, ev.error)
  if (!cliente) {
    const { data } = await sb.from("clients").select("id, name, zomatik_codigo").eq("zomatik_codigo", Number(leida.campos.idcliente) || -1).maybeSingle()
    cliente = (data as ClienteDB | null) ?? null
    if (!cliente) return no("cliente_no_esta", MSJ_TRAER.cliente_no_esta(filaZ.cliente || `código ${leida.campos.idcliente}`))
  }
  if (!formula) {
    const { data } = await sb.from("formulas").select("id, code, plant_id, zomatik_articulo_codigo, zomatik_articulo_nombre").eq("plant_id", o.plantId)
    const candidatas = ((data as FormulaDB[] | null) || []).filter((f) => f.zomatik_articulo_codigo && leida.renglones.some((r) => esRenglonDe({ codigoArticulo: r.codigoArticulo, nombreArticulo: "" } as Renglon, { codigo: f.zomatik_articulo_codigo })))
    if (!candidatas.length) return no("sin_formula", MSJ_TRAER.sin_formula(o.planta.name, leida.renglones.map((r) => r.nombreArticulo || r.codigoArticulo).join(", ") || "el artículo de la NP"))
    if (candidatas.length > 1) return no("elegir_formula", MSJ_TRAER.elegir_formula, { elegirFormula: candidatas.map((f) => ({ id: f.id, code: f.code })).sort((a, b) => a.code.localeCompare(b.code)) })
    formula = candidatas[0]
    articulo = await articuloDe(formula)
  }
  ev = evaluarNpTraida({ fila: filaZ, ...leida, pedido: pedido(cliente, articulo) })
  if (!ev.ok) return no(ev.motivo, ev.error)
  const m3 = ev.m3
  const fecha = leida.campos.fecha_entrega
  if (m3 === null || !fecha) return fallaZomatik(sb, Object.assign(new Error(m3 === null ? "no se leyó la cantidad" : "no se leyó la fecha de entrega"), { codigo: "formato" }), { usuario: o.usuario, plantId: o.plantId, ref })

  // 8. Registrar: una sola fila (atómico). Si otro la trajo en el mismo momento, choca con la marca y se usa esa
  const numero = numeroCompleto(comprobante, o.t.numero)
  const marca = marcaTraida(comprobante, o.t.numero)
  const ahora = new Date().toISOString()
  const fila = {
    scheduled_dispatch_id: null, n: 1, marca, tipo: ev.proyecto ? "proyecto" : "nueva", proyecto_codigo: ev.proyecto ?? null, es_adicional: false,
    plant_id: o.plantId, client_id: cliente.id, formula_id: formula.id, fecha, fecha_zomatik: fecha, m3,
    estado: "ok", paso: PASO_AUTORIZADA, numero, zomatik_codigo: filaZ.codigo, sucursal: SUCURSAL_REBUCRET, ok_at: ahora, saldo_desde: ahora,
    created_by: o.usuario, intentos: 0, proximo_intento: null, mensaje: null, vendedor_usuario_id: null,
  }
  const { data: alta, error: eA } = await sb.from("zomatik_np").insert(fila as never).select("id")
  if (eA) {
    if ((eA as { code?: string }).code !== "23505") throw eA
    const { data: otra } = await sb.from("zomatik_np").select(COLUMNAS_NP).eq("marca", marca).maybeSingle()
    if (!otra) throw eA
    return usarExistente(sb, otra as unknown as FilaNpDB, { cliente, formula, plantId: o.plantId, remito: o.remito ?? null })
  }
  const id = ((alta as { id: string }[] | null) || [])[0]?.id
  if (!id) throw new Error("No se pudo registrar la NP traída")
  await actividadNp(sb, {
    usuario: o.usuario, action: "crear", pedidoId: null, plantId: o.plantId, referencia: numero,
    detalle: { "Qué pasó": "NP traída de Zomatik", NP: numero, Cliente: cliente.name, Hormigón: articulo?.nombre || formula.code, "m³": m3, Entrega: fecha, Planta: o.planta.name, Marca: marca },
  })
  const np = await comoNpSaldo(sb, id, cliente.id)
  return { ok: true, yaEstaba: false, np, remito: ev.remito, avisos: ev.avisos }
}

/** La NP con su saldo, como la lista de "NP con saldo" (sin montos). */
async function comoNpSaldo(sb: SB, id: string, clientId: string | null): Promise<NpSaldo> {
  const x = (await npsConSaldo({ sb, clientId: clientId || undefined })).find((n) => n.id === id)
  if (!x) throw new Error("La NP traída no aparece con saldo")
  return x
}

/**
 * Paso 4: la NP ya está en `zomatik_np` (traída antes o generada por el sistema). Se usa esa sin leer Zomatik, si sirve
 * para el pedido (`npUsable`) y le queda algo libre. En el alta, el cliente y la fórmula salen de la fila.
 */
async function usarExistente(
  sb: SB,
  fila: FilaNpDB,
  o: { cliente: ClienteDB | null; formula: FormulaDB | null; plantId: string; remito: "R" | "X" | null },
): Promise<ResultadoTraer> {
  if (["anulada", "vaciada", "vaciar", "vaciando"].includes(fila.estado)) return no("anulada_sistema", MSJ_TRAER.anulada_sistema)
  if (["revisar", "error", "pendiente", "generando"].includes(fila.estado)) return no("revisar", MSJ_TRAER.revisar)
  const ped = { client_id: o.cliente?.id ?? fila.client_id ?? "", formula_id: o.formula?.id ?? fila.formula_id ?? "", plant_id: o.plantId }
  const u = await npUsable(sb, fila, ped)
  if ("error" in u) {
    switch (u.motivo) {
      case "otro_cliente": {
        const { data } = fila.client_id ? await sb.from("clients").select("name").eq("id", fila.client_id).maybeSingle() : { data: null }
        return no("otro_cliente", MSJ_TRAER.otro_cliente((data as { name?: string } | null)?.name || "otro"))
      }
      case "otro_articulo": {
        const { data } = fila.formula_id ? await sb.from("formulas").select("code, zomatik_articulo_nombre").eq("id", fila.formula_id).maybeSingle() : { data: null }
        const f = data as { code?: string; zomatik_articulo_nombre?: string | null } | null
        return no("otro_articulo", MSJ_TRAER.otro_articulo(f?.zomatik_articulo_nombre || f?.code || "otro"))
      }
      case "otra_planta": return no("otra_planta", MSJ_TRAER.otra_planta)
      case "cerrada": return no("cerrada", MSJ_TRAER.cerrada)
      case "ajustandose": return no("ajustandose", MSJ_NP_AJUSTANDOSE)
      default: return no("revisar", MSJ_TRAER.revisar)
    }
  }
  const remito: "R" | "X" = comprobanteDeNumero(fila.numero) === "16" ? "X" : "R"
  if (o.remito && o.remito !== remito) return no("otro_remito", MSJ_TRAER.otro_remito(remito))
  if (u.libre <= 0.001) return no("usada", MSJ_TRAER.usada)
  const avisos = [
    ...(fila.tipo === "proyecto" ? ["Es de un proyecto."] : []),
    ...(u.conPedidoActivo && u.comprometido > 0.001 ? [`Otro pedido ya usa ${String(Math.round(u.comprometido * 1000) / 1000).replace(".", ",")} m³.`] : []),
  ]
  const np = await comoNpSaldo(sb, fila.id, fila.client_id ?? null)
  return { ok: true, yaEstaba: true, np, remito, avisos }
}
