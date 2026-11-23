/**
 * Control cruzado · lo despachado en nuestro sistema contra Zomatik (Materias Primas › Control de stock, la tarjeta de
 * arriba). Docs: docs/specs/2026-11-20-control-cruzado-despacho-zomatik.md.
 *
 *   GET /api/control-stock/despacho   los 7 días cerrados (hoy aparte): m³ con OF, materia prima por grupo y las OF del
 *       robot sin la materia prima descontada. Usa la última lectura guardada: no lee Zomatik.
 *
 * Mismos permisos que el control de stock: gerenciales o materia_prima.editar (en el servidor). Solo lee.
 */
import { NextResponse } from "next/server"
import { exigirSesion, respuestaError, sbServicio } from "@/lib/auth/servidor"
import { puedeControlar } from "@/lib/control-ingresos/servidor"
import { fechaArgentina } from "@/lib/control-ingresos/cruce"
import { calcularDespacho, FaltaMigracionDespacho, MENSAJE_FALTA_MIGRACION } from "@/lib/control-produccion/servidor"

export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET() {
  try {
    const r = await exigirSesion()
    if (r.respuesta) return r.respuesta
    if (!puedeControlar(r.sesion.usuario)) return NextResponse.json({ error: "No tenés permiso para el control de stock." }, { status: 403 })
    try {
      return NextResponse.json(await calcularDespacho(sbServicio(), fechaArgentina()))
    } catch (e) {
      // Sin la migración: la tarjeta lo dice y la tabla de stock sigue andando
      if (e instanceof FaltaMigracionDespacho) return NextResponse.json({ faltaMigracion: true, error: MENSAJE_FALTA_MIGRACION })
      throw e
    }
  } catch (e) {
    return respuestaError(e)
  }
}
