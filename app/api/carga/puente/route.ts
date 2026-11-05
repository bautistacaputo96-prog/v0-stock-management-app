import { NextResponse } from "next/server"
import { respuestaError } from "@/lib/auth/servidor"
import { buscarPorHash, claveDe, configPuente, procesarPuente, verificarClave } from "@/lib/carga/puente-servidor"

export const dynamic = "force-dynamic"

/** Lo más que se acepta en un envío del puente (los 10 reportes juntos pesan unos 30 KB). */
const MAX_BYTES = 512 * 1024

/**
 * El puente de la PC de la planta (fase 1, solo lectura; docs/specs/2026-11-05-puente-indumix.md, 2). No hay sesión de
 * persona: el puesto sale de la clave (`Authorization: Bearer rbp_…`), de la que la base guarda solo el sha256.
 *   - 401: la clave no existe.
 *   - 409 "Puesto apagado": el puesto no es Indumix, está inactivo o apagado. El puente queda quieto y prueba cada 5 min.
 * GET: la config (listas de variables, cadencias, muestreo crudo, hora del servidor).
 * POST {tipo, at, version, pedido, ...}: latido, reportes, recetas, totales o eventos. Contesta {ok, duplicado?}.
 */
async function puesto(req: Request) {
  const r = await verificarClave(claveDe(req), buscarPorHash)
  if (!r) return { respuesta: NextResponse.json({ error: "Clave del puente inválida." }, { status: 401 }) }
  if ("status" in r) return { respuesta: NextResponse.json({ error: r.error }, { status: r.status }) }
  return { puesto: r.puesto }
}

export async function GET(req: Request) {
  try {
    const r = await puesto(req)
    if (r.respuesta) return r.respuesta
    return NextResponse.json(configPuente(r.puesto))
  } catch (e) {
    return respuestaError(e)
  }
}

export async function POST(req: Request) {
  try {
    const largo = Number(req.headers.get("content-length") || 0)
    if (largo > MAX_BYTES) return NextResponse.json({ error: "Envío demasiado grande." }, { status: 413 })
    const r = await puesto(req)
    if (r.respuesta) return r.respuesta
    const buf = await req.arrayBuffer()
    if (buf.byteLength > MAX_BYTES) return NextResponse.json({ error: "Envío demasiado grande." }, { status: 413 })
    let body: Record<string, unknown>
    try {
      body = JSON.parse(new TextDecoder().decode(buf))
    } catch {
      return NextResponse.json({ error: "El envío no es JSON." }, { status: 400 })
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "El envío no es un objeto." }, { status: 400 })
    const res = await procesarPuente(r.puesto, body)
    return NextResponse.json(res.json, { status: res.status })
  } catch (e) {
    return respuestaError(e)
  }
}
