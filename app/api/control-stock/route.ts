/**
 * Control de stock de materia prima · pantalla (Materias Primas › Control de stock).
 *
 *   GET /api/control-stock?desde=AAAA-MM-DD&hasta=AAAA-MM-DD   (por defecto, el mes en curso hasta hoy)
 *       una fila por planta y material con nuestro sistema, Zomatik, la diferencia y el detalle por día
 *
 * Mismos permisos que el control con Zomatik: gerenciales o materia_prima.editar (en el servidor). Solo lee.
 */
import { NextResponse } from "next/server"
import { exigirSesion, respuestaError, sbServicio } from "@/lib/auth/servidor"
import { puedeControlar } from "@/lib/control-ingresos/servidor"
import { fechaArgentina } from "@/lib/control-ingresos/cruce"
import { inicioDeMes } from "@/lib/control-stock/calculo"
import { calcularStock } from "@/lib/control-stock/servidor"

export const dynamic = "force-dynamic"
export const maxDuration = 60

const FECHA = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: Request) {
  try {
    const r = await exigirSesion()
    if (r.respuesta) return r.respuesta
    if (!puedeControlar(r.sesion.usuario)) return NextResponse.json({ error: "No tenés permiso para el control de stock." }, { status: 403 })
    const u = new URL(req.url)
    const hoy = fechaArgentina()
    let desde = u.searchParams.get("desde") || inicioDeMes(hoy)
    let hasta = u.searchParams.get("hasta") || hoy
    if (!FECHA.test(desde) || !FECHA.test(hasta)) return NextResponse.json({ error: "Fechas inválidas" }, { status: 400 })
    if (hasta > hoy) hasta = hoy
    if (desde > hasta) desde = hasta
    try {
      const filas = await calcularStock(sbServicio(), desde, hasta)
      return NextResponse.json({ desde, hasta, filas })
    } catch (e: any) {
      if (/zomatik_stock_(lecturas|movimientos)/.test(e?.message || "")) return NextResponse.json({ error: "Falta aplicar la migración del control de stock (202610281800)." }, { status: 500 })
      throw e
    }
  } catch (e) {
    return respuestaError(e)
  }
}
