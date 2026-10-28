/**
 * Zomatik Z2 · Proyectos abiertos de un cliente para "NP de un proyecto" (formulario del pedido).
 *
 *   GET /api/zomatik/np/proyectos?client_id=…&site_id=…
 *   GET /api/zomatik/np/proyectos?todos=1        todos los proyectos abiertos con su cliente nuestro (y la obra, si está
 *                                               vinculada): la primera pregunta del alta, "¿Qué NP?" › de un proyecto
 *
 * Lo disponible en m³: el ≈ de la copia (`zomatik_proyectos`, saldo % y remitido, 20.3) y lo que trajo "Continuar"
 * del MATERIAL la última vez que se generó una NP (23.2). El proyecto guardado en la obra va primero.
 */
import { NextResponse } from "next/server"
import { exigirSesion, respuestaError, sbServicio } from "@/lib/auth/servidor"
import { puedeCon } from "@/lib/permisos"
import { saldoAcopio } from "@/lib/zomatik/acopios"
import { faltaMigracion } from "@/lib/zomatik/np-servidor"

export const dynamic = "force-dynamic"

const uuid = (s: string | null) => (s && /^[0-9a-f-]{36}$/i.test(s) ? s : null)

export async function GET(req: Request) {
  try {
    const r = await exigirSesion()
    if (r.respuesta) return r.respuesta
    if (!puedeCon(r.sesion.usuario, "programacion", "ver")) return NextResponse.json({ error: "No tenés acceso a Programación." }, { status: 403 })
    const q = new URL(req.url).searchParams
    const clientId = uuid(q.get("client_id"))
    const siteId = uuid(q.get("site_id"))
    const sb = sbServicio()
    if (!clientId && q.get("todos") === "1") {
      const [{ data: ps, error: ep }, { data: cs }] = await Promise.all([
        sb.from("zomatik_proyectos").select("codigo, numero, obra, tipo, pactado_m3, saldo_pct, remitido_m3, ultima_entrega, construction_site_id, cliente_codigo, cliente_nombre").eq("estado", "abierto"),
        sb.from("clients").select("id, name, zomatik_codigo").not("zomatik_codigo", "is", null).eq("active", true),
      ])
      if (ep) throw ep
      const porCodigo = new Map(((cs as { id: string; name: string; zomatik_codigo: number }[]) || []).map((c) => [c.zomatik_codigo, c]))
      const proyectos = ((ps as any[]) || [])
        .map((p) => {
          const c = porCodigo.get(p.cliente_codigo)
          if (!c) return null // sin cliente nuestro vinculado no se puede programar
          const s = saldoAcopio({ tipo: p.tipo, pactado_m3: p.pactado_m3 === null ? null : Number(p.pactado_m3), saldo_pct: p.saldo_pct === null ? null : Number(p.saldo_pct), remitido_m3: Number(p.remitido_m3) || 0 })
          return { codigo: p.codigo, numero: p.numero, obra: p.obra, client_id: c.id, cliente: c.name, construction_site_id: p.construction_site_id ?? null, saldo_m3: s.saldoM3, estimado: s.estimado, ultima_entrega: p.ultima_entrega }
        })
        .filter(Boolean)
        .sort((a: any, b: any) => String(b.ultima_entrega || "").localeCompare(String(a.ultima_entrega || "")))
      const out = NextResponse.json({ proyectos })
      out.headers.set("Cache-Control", "no-store")
      return out
    }
    if (!clientId) return NextResponse.json({ proyectos: [] })
    const { data: cli } = await sb.from("clients").select("zomatik_codigo").eq("id", clientId).maybeSingle()
    const codigo = (cli as { zomatik_codigo?: number | null } | null)?.zomatik_codigo
    if (!codigo) return NextResponse.json({ proyectos: [], sinVinculo: true })
    let obraProyecto: number | null = null
    if (siteId) {
      const { data: o, error } = await sb.from("construction_sites").select("zomatik_proyecto_codigo").eq("id", siteId).maybeSingle()
      if (!error) obraProyecto = (o as { zomatik_proyecto_codigo?: number | null } | null)?.zomatik_proyecto_codigo ?? null
    }
    let res = await sb.from("zomatik_proyectos").select("codigo, numero, obra, tipo, pactado_m3, saldo_pct, remitido_m3, ultima_entrega, construction_site_id, disponible_m3, disponible_articulo, disponible_at").eq("estado", "abierto").eq("cliente_codigo", codigo)
    if (res.error && faltaMigracion(res.error))
      res = (await sb.from("zomatik_proyectos").select("codigo, numero, obra, tipo, pactado_m3, saldo_pct, remitido_m3, ultima_entrega, construction_site_id").eq("estado", "abierto").eq("cliente_codigo", codigo)) as typeof res
    if (res.error) throw res.error
    const proyectos = ((res.data as any[]) || []).map((p) => {
      const s = saldoAcopio({ tipo: p.tipo, pactado_m3: p.pactado_m3 === null ? null : Number(p.pactado_m3), saldo_pct: p.saldo_pct === null ? null : Number(p.saldo_pct), remitido_m3: Number(p.remitido_m3) || 0 })
      return {
        codigo: p.codigo, numero: p.numero, obra: p.obra, ultima_entrega: p.ultima_entrega,
        saldo_m3: s.saldoM3, saldo_pct: s.saldoPct, estimado: s.estimado,
        disponible_m3: p.disponible_m3 === undefined || p.disponible_m3 === null ? null : Number(p.disponible_m3), disponible_articulo: p.disponible_articulo ?? null, disponible_at: p.disponible_at ?? null,
        de_la_obra: !!siteId && (p.construction_site_id === siteId || p.codigo === obraProyecto),
      }
    })
    proyectos.sort((a, b) => Number(b.codigo === obraProyecto) - Number(a.codigo === obraProyecto) || Number(b.de_la_obra) - Number(a.de_la_obra) || String(b.ultima_entrega || "").localeCompare(String(a.ultima_entrega || "")))
    const out = NextResponse.json({ proyectos, obraProyecto })
    out.headers.set("Cache-Control", "no-store")
    return out
  } catch (e) {
    return respuestaError(e)
  }
}
