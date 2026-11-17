/**
 * Zomatik · Traer NP de Zomatik (docs/specs/2026-11-17-traer-np-de-zomatik.md, sección 5).
 *
 *   POST /api/zomatik/np/traer { numero, plant_id, client_id?, formula_id?, remito? }
 *        Busca la NP por su número: si ya está en el sistema, la devuelve sin leer Zomatik; si no, la lee en Zomatik (solo
 *        lectura, con el turno del robot), la controla y la registra en `zomatik_np` sin pedido. Después el pedido la usa
 *        como "NP con saldo" (`sincronizar`). Con programacion.cargar (el mismo permiso con que se elige la NP del pedido).
 *   200 { ok: true, yaEstaba, np, remito, avisos } · 422 { ok: false, motivo, error, elegirFormula? } (no se puede traer)
 *   503 ocupado / zomatik · 409 apagada · 400 datos mal formados · 403 sin permiso. Sin montos en la respuesta.
 */
import { NextResponse } from "next/server"
import { esErrorDeConfiguracion, exigirSesion, respuestaError, respuestaModoLocal } from "@/lib/auth/servidor"
import { puedeCon } from "@/lib/permisos"
import { MSJ_TRAER } from "@/lib/zomatik/np"
import { avisarFallaInesperada, faltaMigracion } from "@/lib/zomatik/np-servidor"
import { traerNp } from "@/lib/zomatik/np-traer-servidor"

export const dynamic = "force-dynamic"
export const maxDuration = 60

const UUID = /^[0-9a-f-]{36}$/i

/** uuid, null (vacío o ausente) o "mal" si vino algo que no es un uuid. */
const uuidOpcional = (s: unknown): string | null | "mal" => (s === undefined || s === null || s === "" ? null : typeof s === "string" && UUID.test(s) ? s : "mal")

export async function POST(req: Request) {
  let traerDe: { numero: string; usuario: string } | null = null
  try {
    const r = await exigirSesion()
    if (r.respuesta) return r.respuesta
    const s = r.sesion
    const u = s.usuario
    if (s.local) return respuestaModoLocal()
    if (!puedeCon(u, "programacion", "cargar")) return NextResponse.json({ ok: false, error: "Es de Programación." }, { status: 403 })
    const body = await req.json().catch(() => ({}))
    const numero = typeof body?.numero === "string" ? body.numero.trim() : ""
    const plantId = uuidOpcional(body?.plant_id)
    const clientId = uuidOpcional(body?.client_id)
    const formulaId = uuidOpcional(body?.formula_id)
    const remito = body?.remito === "R" || body?.remito === "X" ? body.remito : body?.remito === undefined || body?.remito === null || body?.remito === "" ? null : "mal"
    if (!numero || numero.length > 30 || !plantId || plantId === "mal" || clientId === "mal" || formulaId === "mal" || remito === "mal")
      return NextResponse.json({ ok: false, error: "Faltan datos" }, { status: 400 })
    traerDe = { numero, usuario: u.name }
    let out
    try {
      out = await traerNp({ numero, plantId, clientId, formulaId, remito, usuario: u.name })
    } catch (e) {
      if (faltaMigracion(e)) return NextResponse.json({ ok: false, motivo: "apagada", error: MSJ_TRAER.apagada }, { status: 409 })
      throw e
    }
    if (out.ok) {
      const res = NextResponse.json(out)
      res.headers.set("Cache-Control", "no-store")
      return res
    }
    const status = out.motivo === "datos" ? 400 : out.motivo === "apagada" ? 409 : out.motivo === "ocupado" || out.motivo === "zomatik" ? 503 : 422
    return NextResponse.json(out, { status })
  } catch (e) {
    if (!traerDe || esErrorDeConfiguracion(e)) return respuestaError(e)
    // Un error inesperado (nuestro): se avisa a Bautista y se contesta claro. No se registró nada a medias (un solo insert)
    console.error("[zomatik-np] traer", traerDe.numero, e)
    const de = traerDe
    const avisado = await avisarFallaInesperada(e, `Falla inesperada al traer la NP ${de.numero}`, (m) => [`NP tipeada: ${de.numero}`, `Quién: ${de.usuario}`, `Error: ${m}`])
    return NextResponse.json({ ok: false, error: `No se pudo traer la NP (error del sistema). ${avisado ? "Ya le avisamos a Bautista." : "Avisale a Bautista."}` }, { status: 500 })
  }
}
