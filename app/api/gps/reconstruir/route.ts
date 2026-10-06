/**
 * Fase 4a · Reconstruye los viajes reales de los mixers desde el historial del GPS (Wialon) y los cruza con los despachos.
 *
 *   GET /api/gps/reconstruir?fecha=AAAA-MM-DD
 *   GET /api/gps/reconstruir?desde=AAAA-MM-DD&hasta=AAAA-MM-DD   (máximo 7 días por llamada)
 *   GET /api/gps/reconstruir                                       (cron: ayer y los 2 días previos)
 *   …&simular=1   calcula todo y devuelve los viajes sin escribir nada (para controlar antes de cargar)
 *
 * Idempotente: por camión hace upsert de los viajes y borra los del rango que quedaron sin tocar. Solo escribe
 * viajes_gps, el registro gps_reconstrucciones y las ubicaciones aprendidas de obras sin ubicación a mano.
 *
 * TODO(fase 0c): autenticación real. Mientras tanto, freno barato para no castigar a Wialon: una llamada manual
 * que repite (o se superpone con) un rango pedido hace menos de 5 min, o la 7.ª llamada manual en 5 min, recibe 429.
 * El control y el registro son atómicos (función gps_reconstruir_registrar, con candado en la base).
 * Las del cron de Vercel (header x-vercel-cron o user-agent vercel-cron) no se frenan. Los dos se pueden falsificar.
 */
import { NextResponse } from "next/server"
import { reconstruirRango } from "@/lib/gps-reconstruir"
import { sbAdmin } from "@/lib/wialon"
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
  const simular = q.get("simular") === "1"
  const cron = req.headers.has("x-vercel-cron") || /vercel-cron/i.test(req.headers.get("user-agent") || "")
  if (!desde && !hasta) {
    // Cron (06:00 en Argentina): el día anterior y repaso de los 2 previos, por si llegaron mensajes atrasados
    desde = sumarDias(hoy, -3)
    hasta = sumarDias(hoy, -1)
  }
  if (!desde || !hasta || !FECHA.test(desde) || !FECHA.test(hasta) || isNaN(Date.parse(desde)) || isNaN(Date.parse(hasta))) {
    return NextResponse.json({ error: "Fechas inválidas: usar fecha=AAAA-MM-DD o desde y hasta" }, { status: 400 })
  }
  if (hasta > hoy) hasta = hoy
  if (desde > hasta) return NextResponse.json({ error: "desde es posterior a hasta (o es una fecha futura)" }, { status: 400 })
  const dias = Math.round((Date.parse(hasta) - Date.parse(desde)) / 86400000) + 1
  if (dias > MAX_DIAS) return NextResponse.json({ error: `Máximo ${MAX_DIAS} días por llamada` }, { status: 400 })

  // Freno + registro de la llamada, en una sola transacción (ver la migración de la fase 4a)
  const sb = sbAdmin()
  const { data: reg, error: eLog } = await sb.rpc("gps_reconstruir_registrar", {
    p_desde: desde,
    p_hasta: hasta,
    p_simular: simular,
    p_origen: cron ? "cron" : "manual",
  })
  if (eLog) return NextResponse.json({ ok: false, error: "Falta aplicar la migración de la fase 4a (gps_reconstruir_registrar)" }, { status: 500 })
  if (reg?.motivo) return NextResponse.json({ ok: false, error: reg.motivo }, { status: 429 })
  const cerrar = async (resultado: any) => {
    if (reg?.id) await sb.from("gps_reconstrucciones").update({ fin: new Date().toISOString(), resultado }).eq("id", reg.id)
  }

  try {
    const informe = await reconstruirRango(desde, hasta, { simular })
    const { filas: _f, ...resumen } = informe
    await cerrar(resumen)
    return NextResponse.json({ ok: true, ...informe })
  } catch (e: any) {
    const error = e?.message || "Error reconstruyendo los viajes"
    await cerrar({ error })
    return NextResponse.json({ ok: false, error }, { status: 500 })
  }
}
