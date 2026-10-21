/**
 * Zomatik Z0 · Proyectos (acopios) de la copia local, para el bloque Acopios de Programación y la pantalla
 * Vínculos. Las tablas zomatik_proyectos y zomatik_proyecto_movimientos no las lee el navegador: van por acá.
 * Sin montos (la copia no los tiene).
 *
 *   GET /api/zomatik/acopios                       proyectos abiertos y la última lectura
 *   GET /api/zomatik/acopios?movimientos=NUMERO    renglones de remito de un proyecto ("PRO 0001-00000030")
 *
 * Con sesión y permiso de ver Programación (o gerencial).
 */
import { NextResponse } from "next/server"
import { exigirSesion, respuestaError, sbServicio } from "@/lib/auth/servidor"
import { puedeCon } from "@/lib/permisos"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  try {
    const r = await exigirSesion()
    if (r.respuesta) return r.respuesta
    if (!puedeCon(r.sesion.usuario, "programacion", "ver"))
      return NextResponse.json({ error: "No tenés acceso a Programación." }, { status: 403 })
    const sb = sbServicio()
    const numero = new URL(req.url).searchParams.get("movimientos")
    let res: NextResponse
    if (numero) {
      const { data, error } = await sb
        .from("zomatik_proyecto_movimientos")
        .select("fecha, remito, pedido, articulo, m3, deposito, es_hormigon")
        .eq("proyecto_numero", numero.slice(0, 40))
        .order("fecha", { ascending: false })
        .limit(1000)
      if (error) throw error
      res = NextResponse.json({ movimientos: data || [] })
    } else {
      const [ps, lec] = await Promise.all([
        sb
          .from("zomatik_proyectos")
          .select("codigo, numero, comprobante, cliente_codigo, cliente_nombre, obra, fecha, tipo, pactado_m3, saldo_pct, remitido_m3, ultima_entrega, estado, construction_site_id, vinculo")
          .eq("estado", "abierto")
          .order("ultima_entrega", { ascending: false, nullsFirst: false }),
        sb.from("zomatik_lecturas").select("fin, ok, error").not("fin", "is", null).order("inicio", { ascending: false }).limit(1),
      ])
      if (ps.error) {
        if (/zomatik_proyectos/.test(ps.error.message || "")) return NextResponse.json({ proyectos: null, sinMigracion: true })
        throw ps.error
      }
      res = NextResponse.json({ proyectos: ps.data || [], lectura: (lec.data as any[])?.[0] || null })
    }
    res.headers.set("Cache-Control", "no-store")
    return res
  } catch (e) {
    return respuestaError(e)
  }
}
