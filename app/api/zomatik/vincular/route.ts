/**
 * Zomatik Z0 · Vínculos con Zomatik. Escribe solo en nuestra base: no toca Zomatik. La lógica está en
 * lib/zomatik/vincular-servidor.ts.
 *
 *   POST /api/zomatik/vincular                          Pantalla "Vínculos con Zomatik" (solo gerenciales)
 *     {items: [{tipo, id, accion, codigo?}]}   (hasta 100; o un solo item sin el array)
 *     tipo    cliente   · id = clients.id            · codigo = código del cliente en Zomatik
 *             formula   · id = formulas.id           · codigo = código del artículo
 *             proyecto  · id = código del proyecto   · codigo = construction_sites.id (la obra)
 *     accion  vincular · sin_par (no está en Zomatik / no tiene obra) · quitar (vuelve a "sin revisar")
 *     soloSiLibre  true = grabar solo si todavía no tiene vínculo ("Confirmar todas las de confianza alta")
 *
 *   POST /api/zomatik/vincular {desde: "pedido", pedido_id?, items}   Cartel del pedido (04/11/2026,
 *     docs/specs/2026-11-04-vincular-al-programar.md), con programacion.cargar o editar (también un gerencial, con las
 *     mismas reglas): solo `vincular` un cliente o una fórmula que no tiene vínculo (o "No está en Zomatik"); 1 o 2 ítems.
 *
 *   GET /api/zomatik/vincular?client_id=&formula_id=           qué falta vincular del pedido, con sugerencias
 *   GET /api/zomatik/vincular?buscar=cliente|articulo&q=       buscador del cartel (sin teléfonos ni mails)
 *     (con la misma permisión que el cartel, o gerencial)
 */
import { NextResponse } from "next/server"
import { exigirGerencial, exigirSesion, modoPruebaLocal, respuestaModoLocal, respuestaError } from "@/lib/auth/servidor"
import { puedeVincularDesdePedido, tipoDe } from "@/lib/permisos"
import { aplicar, aplicarDesdePedido, buscarParaVincular, estadoVinculos, type Item, type Res } from "@/lib/zomatik/vincular-servidor"

export const dynamic = "force-dynamic"
export const maxDuration = 60

const uuid = (s: unknown) => (typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : null)

export async function GET(req: Request) {
  try {
    const r = await exigirSesion()
    if (r.respuesta) return r.respuesta
    const u = r.sesion.usuario
    if (!puedeVincularDesdePedido(u) && tipoDe(u) !== "gerencial") return NextResponse.json({ error: "Es de Programación." }, { status: 403 })
    const p = new URL(req.url).searchParams
    const buscar = p.get("buscar")
    const clientId = uuid(p.get("client_id"))
    const formulaId = uuid(p.get("formula_id"))
    const datos =
      buscar === "cliente" || buscar === "articulo"
        ? await buscarParaVincular(buscar, p.get("q") || "", { clientId, formulaId })
        : await estadoVinculos({ clientId, formulaId })
    const res = NextResponse.json(datos)
    res.headers.set("Cache-Control", "no-store")
    return res
  } catch (e) {
    return respuestaError(e)
  }
}

export async function POST(req: Request) {
  if (modoPruebaLocal()) return respuestaModoLocal()
  try {
    const body = await req.json().catch(() => ({}))
    const items: Item[] = Array.isArray(body?.items) ? body.items : body?.tipo ? [body] : []

    if (body?.desde === "pedido") {
      const r = await exigirSesion()
      if (r.respuesta) return r.respuesta
      const u = r.sesion.usuario
      if (!puedeVincularDesdePedido(u)) return NextResponse.json({ error: "Vincular desde el pedido es de Programación." }, { status: 403 })
      if (items.length === 0) return NextResponse.json({ error: "Nada para vincular" }, { status: 400 })
      if (items.length > 2) return NextResponse.json({ error: "Desde el pedido, un cliente y una fórmula como mucho" }, { status: 400 })
      const pedidoId = body?.pedido_id ? uuid(body.pedido_id) : null
      if (body?.pedido_id && !pedidoId) return NextResponse.json({ error: "Pedido inválido" }, { status: 400 })
      const resultados: Res[] = []
      for (const it of items) resultados.push(await aplicarDesdePedido(it, { usuario: u.name, pedidoId }))
      const errores = resultados.filter((x) => !x.ok).map((x) => x.error)
      return NextResponse.json(
        { ok: errores.length === 0, hechos: resultados.filter((x) => x.ok).length, errores, resultados },
        { status: errores.length && errores.length === items.length ? 400 : 200 },
      )
    }

    const r = await exigirGerencial()
    if (r.respuesta) return r.respuesta
    if (items.length === 0) return NextResponse.json({ error: "Nada para vincular" }, { status: 400 })
    if (items.length > 100) return NextResponse.json({ error: "Como mucho 100 por vez" }, { status: 400 })
    const resultados: Res[] = []
    for (const it of items) resultados.push(await aplicar(it, r.sesion.usuario.name))
    const errores = resultados.filter((x) => !x.ok).map((x) => x.error)
    return NextResponse.json({ ok: errores.length === 0, hechos: resultados.filter((x) => x.ok).length, errores }, { status: errores.length && errores.length === items.length ? 400 : 200 })
  } catch (e) {
    return respuestaError(e)
  }
}
