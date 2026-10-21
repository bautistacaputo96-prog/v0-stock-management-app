import { NextResponse } from "next/server"
import { registrarActividad, respuestaError, sbServicio } from "@/lib/auth/servidor"
import { ajusteStockHabilitado, efectoSobreDespacho, type ModoParada } from "@/lib/carga/cierre"
import { desvio } from "@/lib/carga/auditoria"
import { bloqueoDe, cargarFormulas, cargarPuestoPorId, controlDeFormula } from "@/lib/carga/datos"
import { contextoServidor, error, exigirCarga, horaPuente, registrarEvento, yaProcesado } from "@/lib/carga/servidor"
import { SALIDAS, grupoDeSalida, type Salida } from "@/lib/carga/tipos"
import type { Accion } from "@/lib/permisos"

export const dynamic = "force-dynamic"

/**
 * Lo que pasa con una carga (carga-planta.md 5.4 a 5.7, 18.3, 19.5 y 20.2). Body: {accion, pedido, at, ...}.
 *
 * La planta NO se mueve desde acá: esta ruta solo registra lo que hizo el puente (hoy, el simulador en el navegador de
 * la PC de la planta). Cada pedido trae un id (`pedido`): si se reintenta (sin internet), no se graba dos veces.
 *
 * - bajada                 la orden llegó a la PC de la planta (cargas.bajada_at)
 * - arrancar               CARGAR: controla permiso, que esté en la cola, planta libre y la receta (con internet);
 *                          sin internet (20.2) la orden ya bajó y la controló el puente: se acepta igual y queda marcada
 * - no_arranco             la planta no arrancó: vuelve a la cola, no se reintenta sola
 * - evento                 ciclo_inicio · suspender · reanudar · bocina · alarma · alarma_fin
 * - agua_extra             el botón "Extra agua" (19.5)
 * - parar                  PARAR: queda "parada" con lo pesado
 * - terminar               fin con el reporte: materiales reales
 * - resolver_parada        sale con lo cargado · completar con otra carga · se tiró (con motivo)
 * - cancelar               antes de pesar nada, con motivo
 * - revisar                auditoría revisada (carga.editar)
 *
 * MODO SIMULADO: nunca se toca el despacho real ni el stock (lib/carga/cierre.ts). Queda escrito qué se haría.
 */
const PERMISO: Record<string, Accion> = {
  // PARAR no pide permiso (alcanza con ver la pantalla). Lo que sube el puente (terminar) pide cargar mientras no
  // exista la credencial del puesto.
  bajada: "ver", evento: "ver", parar: "ver", no_arranco: "ver", terminar: "cargar",
  arrancar: "cargar", agua_extra: "cargar", resolver_parada: "cargar", cancelar: "cargar",
  revisar: "editar",
}
/** Los botones de la planta (suspender, reanudar, bocina) piden cargar; el resto de los eventos los sube el puente. */
const permisoDe = (accion: string, tipo: unknown): Accion =>
  accion === "evento" && ["suspender", "reanudar", "bocina"].includes(String(tipo)) ? "cargar" : PERMISO[accion]
/** Lo que el puente sube con la etiqueta "sin internet" y que se guarda aunque la orden se haya cancelado mientras */
const DEL_PUENTE = ["arrancar", "evento", "parar", "terminar", "agua_extra"]
const EN_COLA = ["pendiente", "bloqueada", "lista", "preparada"]
const num = (x: unknown) => (x == null || x === "" || !Number.isFinite(Number(x)) ? null : Number(x))

type MaterialBody = { salida: Salida; material_id: string | null; receta_por_m3?: number; formula_por_m3?: number | null; teorico?: number; humedad_pct?: number | null; teorico_corregido?: number; real?: number; extra?: number; unidad?: string }

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: idPedido } = await params
    const body = await req.json().catch(() => ({}))
    const accion = String(body?.accion || "")
    if (!PERMISO[accion]) return error("Acción desconocida.")
    const r = await exigirCarga("carga", permisoDe(accion, body?.tipo))
    if (r.respuesta) return r.respuesta
    const sb = sbServicio()
    const { data: c, error: e0 } = await sb.from("cargas").select("*").eq("id", idPedido).maybeSingle()
    if (e0) throw e0
    if (!c) return error("La carga no existe.", 404)
    let carga = c as any
    const puesto = await cargarPuestoPorId(sb, carga.puesto_id)
    if (!puesto) return error("El puesto de carga no existe.", 404)
    const at = horaPuente(body?.at)
    const pedido = typeof body?.pedido === "string" && body.pedido.length <= 80 ? body.pedido : null
    const sinInternet = body?.sin_internet === true
    if (await yaProcesado(pedido)) return NextResponse.json({ ok: true, duplicado: true })

    // Sin internet la planta cargó una orden que mientras tanto se canceló en la nube: lo que pasó en la planta se
    // guarda igual, en otra carga unida al mismo despacho, con su alerta (no se pierde ni se pisa la cancelación).
    if (sinInternet && ["cancelada", "anulada"].includes(carga.estado) && DEL_PUENTE.includes(accion)) {
      const otra = await cargaDeOrdenCancelada(carga, ["arrancar", "parar", "terminar"].includes(accion), r.usuario, at)
      if (!otra) return NextResponse.json({ ok: true, ignorado: true })
      carga = otra
    }
    const id: string = carga.id
    const upd = (cambios: Record<string, unknown>) => sb.from("cargas").update(cambios).eq("id", id)
    const evento = (tipo: string, detalle?: Record<string, unknown> | null) =>
      registrarEvento({ carga_id: id, puesto_id: puesto.id, tipo, at, detalle: detalle ?? null, usuario: r.usuario, pedido })
    const listo = (extra: Record<string, unknown> = {}) => NextResponse.json({ ok: true, ...extra })

    switch (accion) {
      case "bajada": {
        if (!carga.bajada_at) await upd({ bajada_at: at })
        return listo()
      }

      case "arrancar": {
        if (!EN_COLA.includes(carga.estado)) return error(carga.estado === "en_curso" ? "Esa carga ya está cargando." : "Esa carga ya no está en la cola.", 409)
        let bloqueo = carga.bloqueo
        if (!sinInternet) {
          const { data: otra } = await sb.from("cargas").select("id").eq("puesto_id", puesto.id).in("estado", ["en_curso", "suspendida"]).neq("id", id).limit(1)
          if (otra?.length) return error("La planta está con otra carga.", 409)
          const ctx = await contextoServidor(puesto)
          const [f] = await cargarFormulas(sb, carga.formula_id ? [carga.formula_id] : [])
          const ctl = controlDeFormula(ctx, f || null, carga.autorizacion)
          bloqueo = bloqueoDe(ctl)
          if (ctl.frena) {
            await upd({ estado: "bloqueada", bloqueo, agua_distinta: ctl.aguaDistinta })
            return error(`No se puede cargar: ${ctl.motivo}`, 409)
          }
        }
        // Condicional: solo si sigue en la cola (dos CARGAR a la vez, o CARGAR contra un Cancelar, no pasan los dos)
        const { data: act, error: eu } = await sb.from("cargas").update({
          estado: "en_curso", inicio_at: at, arrancada_por: r.usuario, camion_abajo_por: r.usuario, camion_abajo_at: horaPuente(body?.camion_abajo_at || at),
          contador_planta: num(body?.contador), inicio_plc: body?.inicio_plc ? String(body.inicio_plc).slice(0, 40) : null, dia_planta: body?.dia_planta || null,
          ciclo_actual: 1, ciclos: num(body?.ciclos) ?? carga.ciclos, m3_ciclo: num(body?.m3_ciclo) ?? carga.m3_ciclo, receta_numero: num(body?.receta) ?? carga.receta_numero,
          sin_internet: sinInternet, bloqueo, bajada_at: carga.bajada_at || at,
        }).eq("id", id).in("estado", EN_COLA).select("id")
        if (eu) {
          if ((eu as { code?: string }).code === "23505") return error("La planta está con otra carga.", 409)
          throw eu
        }
        if (!act?.length) return error("Esa carga ya no está en la cola (la arrancaron o la cancelaron).", 409)
        await evento("arranque", { sin_internet: sinInternet, contador: num(body?.contador), receta: num(body?.receta), camion_abajo_at: body?.camion_abajo_at || null })
        return listo()
      }

      case "no_arranco": {
        if (carga.estado !== "en_curso" && !EN_COLA.includes(carga.estado)) return listo()
        if (!(await evento("no_arranco", { motivo: String(body?.motivo || "").slice(0, 300) }))) return listo({ duplicado: true })
        await upd({ estado: carga.bloqueo?.frena ? "bloqueada" : "pendiente", inicio_at: null, arrancada_por: null, contador_planta: null, inicio_plc: null, ciclo_actual: null })
        return listo()
      }

      case "evento": {
        const tipo = String(body?.tipo || "")
        if (!["ciclo_inicio", "suspender", "reanudar", "bocina", "alarma", "alarma_fin"].includes(tipo)) return error("Evento desconocido.")
        if (!(await evento(tipo, { ciclo: num(body?.ciclo), texto: body?.texto ? String(body.texto).slice(0, 300) : null }))) return listo({ duplicado: true })
        if (tipo === "ciclo_inicio" && num(body?.ciclo) != null) await upd({ ciclo_actual: num(body.ciclo) })
        if (tipo === "suspender" && carga.estado === "en_curso") await upd({ estado: "suspendida" })
        if (tipo === "reanudar" && carga.estado === "suspendida") await upd({ estado: "en_curso" })
        return listo()
      }

      case "agua_extra": {
        const litros = num(body?.litros)
        if (litros == null || litros <= 0 || litros > 500) return error("Litros fuera de rango (1 a 500).")
        const { error: e } = await sb.from("cargas_agua_extra").insert({
          carga_id: id, dispatch_id: carga.dispatch_id, at, litros, despues_de_terminar: body?.despues_de_terminar === true, usuario: r.usuario, origen: "sistema", pedido,
        })
        if (e) {
          if ((e as { code?: string }).code === "23505") return listo({ duplicado: true })
          throw e
        }
        await registrarEvento({ carga_id: id, puesto_id: puesto.id, tipo: "agua_extra", at, detalle: { litros, despues_de_terminar: body?.despues_de_terminar === true }, usuario: r.usuario })
        return listo()
      }

      case "parar":
      case "terminar": {
        if (accion === "terminar" && ["terminada", "cancelada", "anulada"].includes(carga.estado)) return listo({ duplicado: true })
        if (accion === "parar" && carga.estado === "parada") return listo({ duplicado: true })
        if (!(await evento(accion === "parar" ? "parar" : "fin", { m3_cargados: num(body?.m3_cargados), fin_plc: body?.fin_plc || null }))) return listo({ duplicado: true })
        const mats = (Array.isArray(body?.materiales) ? body.materiales : []) as MaterialBody[]
        const filas = mats.filter((m) => SALIDAS.includes(m.salida)).map((m) => ({
          carga_id: id, ciclo: 0, salida: m.salida, material_id: m.material_id || null, receta_por_m3: num(m.receta_por_m3), formula_por_m3: num(m.formula_por_m3),
          teorico: num(m.teorico), humedad_pct: num(m.humedad_pct), teorico_corregido: num(m.teorico_corregido), real: num(m.real), extra: num(m.extra) ?? 0, unidad: m.unidad || null,
        }))
        if (filas.length) {
          const { error: e } = await sb.from("cargas_materiales").upsert(filas, { onConflict: "carga_id,ciclo,salida" })
          if (e) throw e
        }
        const conDesvio = filas.some((f) => desvio({ grupo: grupoDeSalida(f.salida), teorico_corregido: f.teorico_corregido, real: f.real }, puesto.tolerancias.pesaje))
        await upd({
          estado: accion === "parar" ? "parada" : "terminada",
          ...(accion === "parar" ? { parada_at: at } : { fin_at: at }),
          fin_plc: body?.fin_plc ? String(body.fin_plc).slice(0, 40) : carga.fin_plc, m3_cargados: num(body?.m3_cargados) ?? carga.m3,
          ciclo_actual: num(body?.ciclo) ?? carga.ciclo_actual, estado_auditoria: carga.estado_auditoria === "revisada" ? "revisada" : conDesvio ? "con_desvios" : "ok",
        })
        // Stock con kilos reales (18.5): programado y APAGADO. Con una carga simulada no se llama nunca.
        let stock: unknown = { aplicado: false, motivo: carga.simulada ? "Carga simulada: no mueve el stock." : "Apagado en este puesto." }
        if (accion === "terminar" && ajusteStockHabilitado({ simulada: carga.simulada, sistema: puesto.sistema, usa_kilos_reales: puesto.usa_kilos_reales })) {
          const { data, error: e } = await sb.rpc("ajustar_stock_carga", { p_carga_id: id, p_usuario: r.usuario })
          stock = e ? { aplicado: false, motivo: e.message } : data
        }
        return listo({ stock })
      }

      case "resolver_parada": {
        const modo = String(body?.modo || "") as ModoParada
        const motivo = String(body?.motivo || "").trim()
        if (!["sale", "completar", "tirada"].includes(modo)) return error("Elegí qué pasó con la carga.")
        if (motivo.length < 3) return error("Escribí el motivo.")
        if (carga.estado !== "parada") return error("La carga no está parada.", 409)
        if (carga.resolucion?.modo) return listo({ duplicado: true })
        const esCompletar = !!carga.completa_carga_id
        const ef = efectoSobreDespacho(modo === "completar" && esCompletar ? "sale" : modo, { m3_despacho: Number(carga.m3) || 0, m3_cargados: Number(carga.m3_cargados) || 0, remito: carga.remito, simulada: carga.simulada, esCompletar })
        if (!(await evento("resolver_parada", { modo, motivo, efecto: ef }))) return listo({ duplicado: true })
        let nueva: string | null = null
        if (ef.accion === "nueva_carga" && (ef.m3_falta || 0) > 0.05) {
          const ciclos = Math.max(1, Math.ceil(ef.m3_falta! / puesto.m3_max_ciclo - 1e-9))
          const { data: n, error: e } = await sb.from("cargas").insert({
            puesto_id: puesto.id, plant_id: carga.plant_id, estado: carga.bloqueo?.frena ? "bloqueada" : "pendiente", origen: carga.origen,
            dispatch_id: carga.dispatch_id, pedido_id: carga.pedido_id, completa_carga_id: id, remito: carga.remito, remito_tipo: carga.remito_tipo,
            mixer_id: carga.mixer_id, patente_planta: carga.patente_planta, cliente_planta: carga.cliente_planta, observacion_planta: carga.observacion_planta,
            formula_id: carga.formula_id, receta_numero: carga.receta_numero, m3: ef.m3_falta, ciclos, m3_ciclo: ef.m3_falta! / ciclos,
            bloqueo: carga.bloqueo, agua_distinta: carga.agua_distinta, autorizacion: carga.autorizacion, bajada_at: at, union_remito: carga.union_remito, created_by: r.usuario,
          }).select("id").single()
          if (e) throw e
          nueva = n.id
        }
        // ef.aplicar = false con una simulada: el despacho real no se toca (ni editar_despacho ni anular_despacho)
        await upd({ resolucion: { modo, motivo, por: r.usuario, at, efecto: ef, nueva_carga_id: nueva }, fin_at: carga.parada_at || at })
        await registrarActividad({
          usuario: r.usuario, action: "editar", entity: "carga", entityId: id, reference: carga.remito,
          details: { "Carga parada": { sale: "Sale con lo cargado", completar: "Completar con otra carga", tirada: "Se tiró" }[modo], Motivo: motivo, Despacho: ef.texto, Simulada: carga.simulada ? "sí" : "no" },
        })
        return listo({ efecto: ef, nueva_carga_id: nueva })
      }

      case "cancelar": {
        const motivo = String(body?.motivo || "").trim()
        if (motivo.length < 3) return error("Escribí el motivo.")
        if (!EN_COLA.includes(carga.estado)) return error("Solo se cancela una carga que todavía no arrancó. Si está cargando, primero PARAR.", 409)
        const texto = carga.simulada
          ? "Planta simulada: se cancela solo la orden de carga. El despacho real no se toca (si hay que anularlo o cambiar el camión, se hace desde Historial, como siempre)."
          : "Se cancela la orden de carga."
        const { data: act } = await sb.from("cargas").update({ estado: "cancelada", resolucion: { modo: "cancelada", motivo, por: r.usuario, at, efecto: { texto } } })
          .eq("id", id).in("estado", EN_COLA).select("id")
        if (!act?.length) return error("Esa carga ya arrancó: primero PARAR.", 409)
        await evento("cancelar", { motivo })
        await registrarActividad({ usuario: r.usuario, action: "editar", entity: "carga", entityId: id, reference: carga.remito, details: { "Carga cancelada": motivo, Simulada: carga.simulada ? "sí" : "no" } })
        return listo({ texto })
      }

      case "revisar": {
        await upd({ estado_auditoria: "revisada", revisada_por: r.usuario, revisada_at: at, nota: body?.nota ? String(body.nota).slice(0, 500) : carga.nota })
        await registrarEvento({ carga_id: id, puesto_id: puesto.id, tipo: "revisada", at, detalle: { nota: body?.nota || null }, usuario: r.usuario })
        return listo()
      }
    }
    return error("Acción desconocida.")
  } catch (e) {
    return respuestaError(e)
  }
}

/**
 * La carga donde se guarda lo que la planta hizo sin internet con una orden que se canceló en la nube: la que ya se
 * creó para eso (resolucion.cargada_sin_internet) o una nueva unida al mismo despacho, con su alerta. Para eventos
 * sueltos (sin arranque ni fin) no se crea nada.
 */
async function cargaDeOrdenCancelada(cancelada: any, crear: boolean, usuario: string, at: string): Promise<any | null> {
  const sb = sbServicio()
  const ya = cancelada.resolucion?.cargada_sin_internet
  if (ya) {
    const { data } = await sb.from("cargas").select("*").eq("id", ya).maybeSingle()
    if (data) return data
  }
  if (!crear) return null
  const base = {
    puesto_id: cancelada.puesto_id, plant_id: cancelada.plant_id, estado: "pendiente", origen: cancelada.origen, dispatch_id: cancelada.dispatch_id,
    pedido_id: cancelada.pedido_id, remito: cancelada.remito, remito_tipo: cancelada.remito_tipo, mixer_id: cancelada.mixer_id, patente_planta: cancelada.patente_planta,
    cliente_planta: cancelada.cliente_planta, observacion_planta: cancelada.observacion_planta, formula_id: cancelada.formula_id, receta_numero: cancelada.receta_numero,
    m3: cancelada.m3, ciclos: cancelada.ciclos, m3_ciclo: cancelada.m3_ciclo, bloqueo: cancelada.bloqueo, agua_distinta: cancelada.agua_distinta, autorizacion: cancelada.autorizacion,
    bajada_at: cancelada.bajada_at || at, sin_internet: true, union_remito: cancelada.dispatch_id ? "por id" : null, created_by: usuario,
    nota: `Se cargó sin internet una orden que se había cancelado (${cancelada.resolucion?.motivo || "sin motivo"}).`,
  }
  let ins = await sb.from("cargas").insert(base).select("*").single()
  // Si el despacho ya tiene otra carga viva, esta queda como la que "completa" a la cancelada (sigue unida al despacho)
  if (ins.error && (ins.error as { code?: string }).code === "23505") ins = await sb.from("cargas").insert({ ...base, completa_carga_id: cancelada.id }).select("*").single()
  if (ins.error) throw ins.error
  await sb.from("cargas").update({ resolucion: { ...(cancelada.resolucion || {}), cargada_sin_internet: ins.data.id } }).eq("id", cancelada.id)
  await sb.from("alertas_carga").insert({
    puesto_id: cancelada.puesto_id, tipo: "orden_cancelada_cargada", carga_id: ins.data.id, formula_id: cancelada.formula_id, receta_numero: cancelada.receta_numero,
    titulo: `Se cargó sin internet una orden cancelada · remito ${cancelada.remito || "s/n"}`,
    detalle: { cancelada_id: cancelada.id, motivo_cancelacion: cancelada.resolucion?.motivo || null, simulada: cancelada.simulada, nota: "Quedó registrada igual, unida al mismo despacho. Revisá qué pasó con el camión." },
  })
  await registrarEvento({ carga_id: ins.data.id, puesto_id: cancelada.puesto_id, tipo: "orden_cancelada_cargada", at, detalle: { cancelada_id: cancelada.id }, usuario })
  return ins.data
}
