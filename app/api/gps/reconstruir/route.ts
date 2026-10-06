/**
 * Fase 4a · Reconstruye los viajes reales de los mixers desde el historial del GPS (Wialon) y los cruza con los despachos.
 *
 *   GET /api/gps/reconstruir?fecha=AAAA-MM-DD
 *   GET /api/gps/reconstruir?desde=AAAA-MM-DD&hasta=AAAA-MM-DD   (máximo 7 días por llamada)
 *   GET /api/gps/reconstruir                                       (cron: ayer y los 2 días previos)
 *   …&simular=1   calcula todo y devuelve los viajes sin escribir nada (para controlar antes de cargar)
 *
 * Idempotente: reemplaza los viajes de cada camión en esos días. Solo escribe viajes_gps y las ubicaciones
 * aprendidas de obras sin ubicación cargada a mano. Por ahora sin secreto (lo protege la fase 0c).
 */
import { NextResponse } from "next/server"
import { reconstruirRango } from "@/lib/gps-reconstruir"
import { fechaAR, sumarDias } from "@/lib/gps-viajes"

export const dynamic = "force-dynamic"
export const maxDuration = 60

const MAX_DIAS = 7
const FECHA = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams
  const hoy = fechaAR(new Date())
  let desde = q.get("fecha") || q.get("desde")
  let hasta = q.get("fecha") || q.get("hasta")
  if (!desde && !hasta) {
    // Cron (06:00 en Argentina): el día anterior y repaso de los 2 previos, por si llegaron mensajes atrasados
    desde = sumarDias(hoy, -3)
    hasta = sumarDias(hoy, -1)
  }
  if (!desde || !hasta || !FECHA.test(desde) || !FECHA.test(hasta) || isNaN(Date.parse(desde)) || isNaN(Date.parse(hasta))) {
    return NextResponse.json({ error: "Fechas inválidas: usar fecha=AAAA-MM-DD o desde y hasta" }, { status: 400 })
  }
  if (desde > hasta) return NextResponse.json({ error: "desde es posterior a hasta" }, { status: 400 })
  if (hasta > hoy) hasta = hoy
  const dias = Math.round((Date.parse(hasta) - Date.parse(desde)) / 86400000) + 1
  if (dias > MAX_DIAS) return NextResponse.json({ error: `Máximo ${MAX_DIAS} días por llamada` }, { status: 400 })

  try {
    const informe = await reconstruirRango(desde, hasta, { simular: q.get("simular") === "1" })
    return NextResponse.json({ ok: true, ...informe })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Error reconstruyendo los viajes" }, { status: 500 })
  }
}
