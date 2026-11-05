/**
 * Resumen del reparto de un día para el WhatsApp diario de Concretus (docs/specs/2026-11-05-dia-unificado-y-mail.md, 4.10).
 *
 *   GET /api/reparto/resumen?fecha=AAAA-MM-DD
 *   Authorization: Bearer <REPARTO_RESUMEN_SECRET>  (secreto propio, solo para esta ruta: NO acepta CRON_SECRET ni sesión)
 *
 * Solo lee: no escribe nada, no manda nada, no toca Zomatik. El mismo cálculo que la pantalla y el mail
 * (vistaParaResumen). Respuesta: { fecha, camiones, pedidos: [{ nombre, planta, viajes, camiones, comienza, termina,
 * atraso_min, a_tiempo }], traslados: string[], noche: string | null }.
 */
import { NextResponse } from "next/server"
import { sbServicio } from "@/lib/auth/servidor"
import { vistaParaResumen } from "@/lib/armado-dia-servidor"
import { resumenReparto, validarFechaResumen, autorizadoResumen } from "@/lib/armado-dia"

export const dynamic = "force-dynamic"
export const maxDuration = 30

export async function GET(req: Request) {
  if (!autorizadoResumen(req.headers.get("authorization"), process.env.REPARTO_RESUMEN_SECRET)) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  const f = validarFechaResumen(new URL(req.url).searchParams.get("fecha"))
  if (!f.ok) return NextResponse.json({ error: f.error }, { status: 400 })
  try {
    return NextResponse.json(resumenReparto(await vistaParaResumen(sbServicio(), f.fecha)))
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "No se pudo armar el resumen" }, { status: 502 })
  }
}
