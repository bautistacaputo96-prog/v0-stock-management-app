import { NextResponse } from "next/server"
import { registrarActividad, respuestaError, sbServicio } from "@/lib/auth/servidor"
import { ajusteStockHabilitado, efectoSobreDespacho, type ModoParada } from "@/lib/carga/cierre"
import { desvio } from "@/lib/carga/auditoria"
import { bloqueoDe, cargarFormulas, cargarPuestoPorId, controlDeFormula } from "@/lib/carga/datos"
import { contextoServidor, error, exigirCarga, horaPuente, registrarEvento } from "@/lib/carga/servidor"
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
  bajada: "ver", evento: "ver", parar: "ver", terminar: "ver", no_arranco: "ver",
  arrancar: "cargar", agua_extra: "cargar", resolver_parada: "cargar", cancelar: "cargar",
  revisar: "editar",
}
const EN_COLA = ["pendiente", "bloqueada", "lista", "preparada"]
const num = (x: unknown) => (x == null || x === "" || !Number.isFinite(Number(x)) ? null : Number(x))

type MaterialBody = { salida: Salida; material_id: string | null; receta_por_m3?: number; formula_por_m3?: number | null; teorico?: number; humedad_pct?: number | null; teorico_corregido?: number; real?: number; extra?: number; unidad?: string }

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const accion = String(body?.accion || "")
    if (!PERMISO[accion]) return error("Acción desconocida.")
    const r = await exigirCarga("carga", PERMISO[accion])
    if (r.respuesta) return r.respuesta
    const sb = sbServicio()
    const { data: c, error: e0 } = await sb.from("cargas").select("*").eq("id", id).maybeSingle()
    if (e0) throw e0
    if (!c) return error("La carga no existe.", 404)
    const carga = c as any
    const puesto = await cargarPuestoPorId(sb, carga.puesto_id)
    if (!puesto) return error("El puesto de carga no existe.", 404)
    const at = horaPuente(body?.at)
    const pedido = typeof body?.pedido === "string" && body.pedido.length <= 80 ? body.pedido : null
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
        const sinInternet = body?.sin_internet === true
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
        if (!(await evento("arranque", { sin_internet: sinInternet, contador: num(body?.contador), receta: num(body?.receta), camion_abajo_at: body?.camion_abajo_at || null }))) return listo({ duplicado: true })
        await upd({
          estado: "en_curso", inicio_at: at, arrancada_por: r.usuario, camion_abajo_por: r.usuario, camion_abajo_at: horaPuente(body?.camion_abajo_at || at),
          contador_planta: num(body?.contador), inicio_plc: body?.inicio_plc ? String(body.inicio_plc).slice(0, 40) : null, dia_planta: body?.dia_planta || null,
          ciclo_actual: 1, ciclos: num(body?.ciclos) ?? carga.ciclos, m3_ciclo: num(body?.m3_ciclo) ?? carga.m3_ciclo, receta_numero: num(body?.receta) ?? carga.receta_numero,
          sin_internet: sinInternet, bloqueo, bajada_at: carga.bajada_at || at,
        })
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
        if (!(await evento("cancelar", { motivo }))) return listo({ duplicado: true })
        const texto = carga.simulada
          ? "Planta simulada: se cancela solo la orden de carga. El despacho real no se toca (si hay que anularlo o cambiar el camión, se hace desde Historial, como siempre)."
          : "Se cancela la orden de carga."
        await upd({ estado: "cancelada", resolucion: { modo: "cancelada", motivo, por: r.usuario, at, efecto: { texto } } })
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
