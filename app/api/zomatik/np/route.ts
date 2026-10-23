/**
 * Zomatik Z2 · Nota de pedido de un pedido programado (spec 22 a 24).
 *
 *   GET  /api/zomatik/np?pedidos=id1,id2       estado de la NP de cada pedido, modo de la planta y control del despacho
 *   POST /api/zomatik/np {accion: "sincronizar", pedido_id, eleccion?}
 *        Después de guardar, cancelar o cambiar los m³ de un pedido: decide qué NP crear, vaciar o anular. La respuesta
 *        sale enseguida y el robot trabaja después (`after`). Con la llave apagada no hace nada.
 *   POST /api/zomatik/np {accion: "generar", pedido_id}            "Generar NP ahora" (programacion.cargar): espera al robot
 *   POST /api/zomatik/np {accion: "revisada", np_id, decision}      un gerencial resuelve una NP "revisar" (otra | buena)
 *   POST /api/zomatik/np {accion: "saldo", np_id, decision}         NP con saldo: devolver | cerrada ("Ya la devolví") (programacion.cargar)
 *   "sincronizar" acepta además `mover_fecha` (true/false): el pedido cambió de fecha y se decidió qué hacer con la NP.
 */
import { NextResponse, after } from "next/server"
import { exigirSesion, respuestaError, respuestaModoLocal } from "@/lib/auth/servidor"
import { puedeCon, tipoDe } from "@/lib/permisos"
import { decidirSaldo, estadoPedidos, faltaMigracion, procesarNp, revisarNp, sincronizarPedido, type Eleccion } from "@/lib/zomatik/np-servidor"

export const dynamic = "force-dynamic"
export const maxDuration = 60

const uuid = (s: unknown) => (typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s) ? s : null)

export async function GET(req: Request) {
  try {
    const r = await exigirSesion()
    if (r.respuesta) return r.respuesta
    const u = r.sesion.usuario
    if (!puedeCon(u, "programacion", "ver") && !puedeCon(u, "despacho", "ver")) return NextResponse.json({ error: "No tenés acceso." }, { status: 403 })
    const ids = (new URL(req.url).searchParams.get("pedidos") || "").split(",").map(uuid).filter(Boolean).slice(0, 300) as string[]
    try {
      const res = NextResponse.json(await estadoPedidos(ids))
      res.headers.set("Cache-Control", "no-store")
      return res
    } catch (e) {
      if (faltaMigracion(e)) return NextResponse.json({ porPedido: {}, plantas: {}, sinMigracion: true })
      throw e
    }
  } catch (e) {
    return respuestaError(e)
  }
}

export async function POST(req: Request) {
  // El tiempo de la función se cuenta desde acá (el robot no arranca una NP si quedan menos de 30 s)
  const inicio = Date.now()
  try {
    const r = await exigirSesion()
    if (r.respuesta) return r.respuesta
    const s = r.sesion
    const u = s.usuario
    const body = await req.json().catch(() => ({}))
    const accion = String(body?.accion || "")
    if (s.local) return respuestaModoLocal()

    if (accion === "revisada") {
      if (tipoDe(u) !== "gerencial") return NextResponse.json({ error: "Solo un gerencial puede resolver una NP para revisar." }, { status: 403 })
      const id = uuid(body?.np_id)
      const decision = body?.decision === "buena" ? "buena" : body?.decision === "otra" ? "otra" : null
      if (!id || !decision) return NextResponse.json({ error: "Faltan datos" }, { status: 400 })
      const out = await revisarNp(id, decision, u.name, undefined, u.id)
      if (!out.ok) return NextResponse.json({ error: out.error }, { status: 409 })
      after(() => procesarNp({ usuario: u.name, inicio }).catch((e) => console.error("[zomatik-np] procesar", e?.message)))
      return NextResponse.json({ ok: true })
    }

    if (accion === "saldo") {
      if (!puedeCon(u, "programacion", "cargar")) return NextResponse.json({ error: "Es de Programación." }, { status: 403 })
      const id = uuid(body?.np_id)
      const decision = ["devolver", "cerrada"].includes(body?.decision) ? (body.decision as "devolver" | "cerrada") : null
      if (!id || !decision) return NextResponse.json({ error: "Faltan datos" }, { status: 400 })
      // "Ya la devolví" (DEVOL hecha a mano): solo un gerencial, con motivo
      const motivo = String(body?.motivo || "").trim().slice(0, 300)
      if (decision === "cerrada") {
        if (tipoDe(u) !== "gerencial") return NextResponse.json({ error: "\"Ya la devolví\" lo marca un gerencial." }, { status: 403 })
        if (motivo.replace(/\s/g, "").length < 5) return NextResponse.json({ error: "Contá cómo se devolvió (por ejemplo, el número de la DEVOL)." }, { status: 400 })
      }
      const out = await decidirSaldo(id, decision, u.name, undefined, motivo || null)
      if (!out.ok) return NextResponse.json({ error: out.error }, { status: 409 })
      if (decision === "devolver") after(() => procesarNp({ usuario: u.name, inicio }).catch((e) => console.error("[zomatik-np] procesar", e?.message)))
      return NextResponse.json(out)
    }

    const pedidoId = uuid(body?.pedido_id)
    if (!pedidoId) return NextResponse.json({ error: "Falta el pedido" }, { status: 400 })
    const puedeProg = puedeCon(u, "programacion", "cargar")
    if (accion === "generar" && !puedeProg) return NextResponse.json({ error: "\"Generar NP ahora\" es de Programación." }, { status: 403 })
    if (accion === "sincronizar" && !puedeProg && !puedeCon(u, "despacho", "cargar")) return NextResponse.json({ error: "No tenés permiso." }, { status: 403 })
    if (accion !== "sincronizar" && accion !== "generar") return NextResponse.json({ error: "Acción desconocida" }, { status: 400 })

    const e = body?.eleccion
    const eleccion: Eleccion | null =
      puedeProg && e && (e.tipo === "nueva" || e.tipo === "proyecto" || e.tipo === "saldo")
        ? { tipo: e.tipo, proyecto_codigo: Number(e.proyecto_codigo) || null, tope_m3: e.tope_m3 === null || e.tope_m3 === undefined || e.tope_m3 === "" ? null : Number(e.tope_m3), np_id: uuid(e.np_id) }
        : null
    const moverFecha = body?.mover_fecha === true ? true : body?.mover_fecha === false ? false : null
    let sync
    try {
      // El vendedor de las NP nuevas: el de quien guarda ahora (sesión del servidor)
      sync = await sincronizarPedido(pedidoId, u.name, eleccion, undefined, { mover_fecha: moverFecha, usuarioId: u.id })
    } catch (err) {
      if (faltaMigracion(err)) return NextResponse.json({ activo: false, motivo: "NP: se carga a mano en Zomatik", sinMigracion: true })
      throw err
    }
    if (!sync.activo || sync.error) return NextResponse.json(sync, { status: sync.activo && sync.error ? 400 : 200 })
    if (accion === "generar") {
      const proc = await procesarNp({ usuario: u.name, pedidoId, inicio })
      return NextResponse.json({ ...sync, proceso: proc })
    }
    // Primero se responde (la base ya quedó sincronizada); el robot trabaja después, dentro del tiempo que queda
    if (sync.creadas) after(() => procesarNp({ usuario: u.name, pedidoId, inicio }).catch((err) => console.error("[zomatik-np] procesar", err?.message)))
    return NextResponse.json(sync)
  } catch (e) {
    return respuestaError(e)
  }
}
