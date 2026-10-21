/**
 * Zomatik Z0 · Copia local de los clientes de Zomatik, para el buscador del alta ("Traer de Zomatik") y la
 * pantalla Vínculos. La copia tiene CUIT, teléfonos y mails: el navegador no la lee directo de la base.
 *
 *   GET /api/zomatik/clientes   con sesión y permiso clientes.cargar (o gerencial)
 *
 * Devuelve también la última lectura (para mostrar "leído hoy 03:30").
 */
import { NextResponse } from "next/server"
import { exigirSesion, respuestaError, sbServicio } from "@/lib/auth/servidor"
import { puedeCon } from "@/lib/permisos"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const r = await exigirSesion()
    if (r.respuesta) return r.respuesta
    if (!puedeCon(r.sesion.usuario, "clientes", "cargar"))
      return NextResponse.json({ error: "No tenés permiso para cargar clientes." }, { status: 403 })
    const sb = sbServicio()
    const [cs, lec] = await Promise.all([
      sb
        .from("zomatik_clientes")
        .select("codigo, razon_social, nombre_norm, cuit, tipo_iva, localidad, vendedor, remitos_r_12m, remitos_x_12m, ultimo_remito, estado")
        .order("razon_social")
        .limit(5000),
      sb.from("zomatik_lecturas").select("fin, ok").not("fin", "is", null).order("inicio", { ascending: false }).limit(1),
    ])
    if (cs.error) {
      if (/zomatik_clientes/.test(cs.error.message || "")) return NextResponse.json({ clientes: [], sinMigracion: true })
      throw cs.error
    }
    const clientes = ((cs.data as any[]) || []).map((c) => ({
      codigo: c.codigo,
      razon_social: c.razon_social,
      cuit: c.cuit,
      tipo_iva: c.tipo_iva,
      localidad: c.localidad,
      vendedor: c.vendedor,
      remitos_12m: (c.remitos_r_12m || 0) + (c.remitos_x_12m || 0),
      ultimo_remito: c.ultimo_remito,
      activo: !c.estado || /activ/i.test(c.estado),
    }))
    const res = NextResponse.json({ clientes, leido: (lec.data as any[])?.[0]?.fin || null })
    res.headers.set("Cache-Control", "no-store")
    return res
  } catch (e) {
    return respuestaError(e)
  }
}
