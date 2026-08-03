import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

// ── Supabase (service role) ───────────────────────────────────────────────────
function sb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

// Muestreo objetivo: 1 muestra cada 3 camiones despachados (se redondea para abajo)
const CAMIONES_POR_MUESTRA = 3

// ── Período: última semana completa (lunes a domingo) ─────────────────────────
function ultimaSemana(now: Date) {
  const d = new Date(now)
  const dow = d.getDay() // 0=domingo
  const haciaLunes = dow === 0 ? 6 : dow - 1
  const lunesEsta = new Date(d)
  lunesEsta.setDate(d.getDate() - haciaLunes)
  lunesEsta.setHours(0, 0, 0, 0)
  const desde = new Date(lunesEsta); desde.setDate(lunesEsta.getDate() - 7)
  const hasta = new Date(lunesEsta); hasta.setDate(lunesEsta.getDate() - 1); hasta.setHours(23, 59, 59, 999)
  return { desde, hasta }
}

const fmtFecha = (d: Date | string) =>
  new Date(d).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" })
const fmtCorta = (d: Date | string) =>
  new Date(d).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })

// Resistencia especificada a partir del código de fórmula (H30-620-10 C -> 30)
function resistenciaEspecificada(code: string): number | null {
  const m = (code || "").match(/H\s*(\d+)/i)
  return m ? parseInt(m[1], 10) : null
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const supabase = sb()

  // Período (permite override con ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD)
  const now = new Date()
  const rango = ultimaSemana(now)
  const desde = searchParams.get("desde") ? new Date(searchParams.get("desde") + "T00:00:00") : rango.desde
  const hasta = searchParams.get("hasta") ? new Date(searchParams.get("hasta") + "T23:59:59") : rango.hasta

  // ── Datos ───────────────────────────────────────────────────────────────────
  const [{ data: plants }, { data: despachos }, { data: roturas }, { data: vencidas }] = await Promise.all([
    supabase.from("plants").select("id, name"),
    supabase
      .from("dispatches")
      .select("id, quantity_m3, sample_taken, plant_id, dispatch_date")
      .gte("dispatch_date", desde.toISOString())
      .lte("dispatch_date", hasta.toISOString())
      .limit(10000),
    supabase
      .from("test_cylinders")
      .select("id, cylinder_number, test_age_days, strength_mpa, actual_test_date, dispatches!inner(sample_number, plant_id, remito, dispatch_date, extra_water_liters, actual_slump_cm, formulas(code), clients(name), construction_sites(name))")
      .not("strength_mpa", "is", null)
      .gte("actual_test_date", desde.toISOString().slice(0, 10))
      .lte("actual_test_date", hasta.toISOString().slice(0, 10))
      .limit(10000),
    supabase
      .from("test_cylinders")
      .select("id")
      .is("actual_test_date", null)
      .eq("discarded", false)
      .lt("scheduled_test_date", now.toISOString().slice(0, 10))
      .limit(10000),
  ])

  const plantName: Record<string, string> = {}
  ;(plants || []).forEach((p: any) => (plantName[p.id] = p.name))

  // ── 1. Producción y muestreo por planta ─────────────────────────────────────
  type Fila = { planta: string; despachos: number; m3: number; muestras: number }
  const porPlanta: Record<string, Fila> = {}
  ;(despachos || []).forEach((d: any) => {
    const key = d.plant_id || "sin"
    const nombre = plantName[d.plant_id] || "Sin planta"
    if (!porPlanta[key]) porPlanta[key] = { planta: nombre, despachos: 0, m3: 0, muestras: 0 }
    porPlanta[key].despachos++
    porPlanta[key].m3 += Number(d.quantity_m3 || 0)
    if (d.sample_taken) porPlanta[key].muestras++
  })
  const filasPlanta = Object.values(porPlanta).sort((a, b) => b.m3 - a.m3)
  const totM3 = filasPlanta.reduce((s, f) => s + f.m3, 0)
  const totMuestras = filasPlanta.reduce((s, f) => s + f.muestras, 0)
  const totDespachos = filasPlanta.reduce((s, f) => s + f.despachos, 0)
  // Objetivo: 1 muestra cada 3 camiones, redondeado para abajo
  const totObjetivo = Math.floor(totDespachos / CAMIONES_POR_MUESTRA)

  // ── 2. Ensayos de la semana ─────────────────────────────────────────────────
  type Ensayo = {
    fecha: string; planta: string; muestra: string; formula: string
    edad: number; mpa: number; esp: number | null; cumple: boolean | null; pct: number | null
    probetaId: string; remito: string; moldeo: string; cliente: string; obra: string
    aguaExtra: number | null; asentamiento: number | null
  }
  const ensayos: Ensayo[] = (roturas || []).map((r: any) => {
    const disp = r.dispatches || {}
    const code = disp.formulas?.code || ""
    const esp = resistenciaEspecificada(code)
    const mpa = Number(r.strength_mpa)
    const edad = Number(r.test_age_days || 0)
    // Solo se evalúa cumplimiento a 28 días (a 7 días es informativo)
    const cumple = esp && edad >= 28 ? mpa >= esp : null
    const pct = esp ? (mpa / esp) * 100 : null
    return {
      fecha: r.actual_test_date, planta: plantName[disp.plant_id] || "-",
      muestra: disp.sample_number || "-", formula: code || "-",
      edad, mpa, esp, cumple, pct,
      probetaId: `${disp.sample_number || "-"}-${r.cylinder_number ?? ""}`,
      remito: disp.remito || "-",
      moldeo: disp.dispatch_date || "",
      cliente: disp.clients?.name || "-",
      obra: disp.construction_sites?.name || "-",
      aguaExtra: disp.extra_water_liters !== null && disp.extra_water_liters !== undefined ? Number(disp.extra_water_liters) : null,
      asentamiento: disp.actual_slump_cm !== null && disp.actual_slump_cm !== undefined ? Number(disp.actual_slump_cm) : null,
    }
  }).sort((a, b) => (a.fecha < b.fecha ? 1 : -1))

  const e28 = ensayos.filter(e => e.edad >= 28 && e.esp)
  const e7 = ensayos.filter(e => e.edad < 28)
  const cumplen28 = e28.filter(e => e.cumple).length
  const pctCumple28 = e28.length ? (cumplen28 / e28.length) * 100 : null

  // Resumen por fórmula (28 días)
  type Res = { formula: string; esp: number | null; n: number; suma: number; min: number; cumplen: number }
  const porFormula: Record<string, Res> = {}
  e28.forEach(e => {
    if (!porFormula[e.formula]) porFormula[e.formula] = { formula: e.formula, esp: e.esp, n: 0, suma: 0, min: Infinity, cumplen: 0 }
    const r = porFormula[e.formula]
    r.n++; r.suma += e.mpa; r.min = Math.min(r.min, e.mpa); if (e.cumple) r.cumplen++
  })
  const resumenFormula = Object.values(porFormula).sort((a, b) => a.formula.localeCompare(b.formula))

  // ── 3. HTML ─────────────────────────────────────────────────────────────────
  // Probetas que no alcanzaron la resistencia especificada (evaluadas a 28 días)
  const noCumplen = e28.filter(e => e.cumple === false)

  const html = buildHtml({
    desde, hasta, filasPlanta, totM3, totMuestras, totObjetivo, totDespachos,
    ensayos, e28, e7, cumplen28, pctCumple28, resumenFormula, noCumplen,
    vencidas: (vencidas || []).length,
  })

  // ── 4. Envío por mail (si está configurado el servicio) ─────────────────────
  const debeEnviar = searchParams.get("send") === "1"
  if (debeEnviar) {
    // Lista fija de la cadena semanal. Se puede sobreescribir para un envío puntual con ?to=mail1,mail2
    const LISTA_SEMANAL = [
      "b.caputo@concretus.com.ar",
      "j.oreguy@concretus.com.ar",
      "f.calvo@concretus.com.ar",
      "Fernandomaldonado1504@gmail.com",
      "joaquingraham@icloud.com",
    ].join(",")
    const destinatarios = (
      searchParams.get("to") || process.env.REPORTE_CALIDAD_EMAILS || LISTA_SEMANAL
    ).split(",").map(s => s.trim()).filter(Boolean)

    // ?dry=1 devuelve a quiénes se enviaría, sin enviar (para verificar la lista)
    if (searchParams.get("dry") === "1") {
      return NextResponse.json({ dry: true, destinatarios })
    }
    const asunto = `Reporte semanal de calidad · ${fmtFecha(desde)} al ${fmtFecha(hasta)}`
    const from = process.env.REPORTE_CALIDAD_FROM || "reportes@concretus.com.ar"

    // SendGrid (el servicio de email de Twilio) tiene prioridad; si no, Resend
    if (process.env.SENDGRID_API_KEY) {
      const r = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          personalizations: [{ to: destinatarios.map(email => ({ email })) }],
          from: { email: from, name: "Rebucret - Calidad" },
          subject: asunto,
          content: [{ type: "text/html", value: html }],
        }),
      })
      return NextResponse.json(
        { ok: r.ok, via: "sendgrid", destinatarios, detalle: r.ok ? "enviado" : await r.text() },
        { status: r.ok ? 200 : 500 }
      )
    }
    if (process.env.RESEND_API_KEY) {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: `Rebucret - Calidad <${from}>`, to: destinatarios, subject: asunto, html }),
      })
      return NextResponse.json(
        { ok: r.ok, via: "resend", destinatarios, detalle: r.ok ? "enviado" : await r.text() },
        { status: r.ok ? 200 : 500 }
      )
    }
    return NextResponse.json({
      ok: false,
      error: "No hay servicio de mail configurado. Agregá SENDGRID_API_KEY (Twilio SendGrid) o RESEND_API_KEY en Vercel.",
      destinatarios,
    }, { status: 200 })
  }

  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } })
}

// ══════════════════════════════════════════════════════════════════════════════
function buildHtml(d: any) {
  const {
    desde, hasta, filasPlanta, totM3, totMuestras, totObjetivo, totDespachos,
    ensayos, e28, e7, cumplen28, pctCumple28, resumenFormula, noCumplen, vencidas,
  } = d

  const color = (pct: number) => (pct >= 100 ? "#15803d" : pct >= 70 ? "#b45309" : "#b91c1c")
  const bgOk = (ok: boolean | null) => (ok === null ? "#64748b" : ok ? "#15803d" : "#b91c1c")

  const filasPlantaHtml = filasPlanta.map((f: any) => {
    const obj = Math.floor(f.despachos / CAMIONES_POR_MUESTRA)
    const pct = obj > 0 ? (f.muestras / obj) * 100 : 0
    return `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-weight:600">${f.planta}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:right">${f.despachos}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:right">${f.m3.toFixed(1)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:right">${f.muestras}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:right">${obj}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;color:${color(pct)}">${pct.toFixed(0)}%</td>
    </tr>`
  }).join("")

  const pctTot = totObjetivo > 0 ? (totMuestras / totObjetivo) * 100 : 0

  const resumenHtml = resumenFormula.length ? resumenFormula.map((r: any) => {
    const prom = r.suma / r.n
    const okPct = (r.cumplen / r.n) * 100
    return `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-family:monospace">${r.formula}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:right">${r.esp ?? "-"} MPa</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:right">${r.n}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700">${prom.toFixed(1)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:right">${r.min.toFixed(1)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;color:${color(okPct)}">${r.cumplen}/${r.n}</td>
    </tr>`
  }).join("") : `<tr><td colspan="6" style="padding:14px;text-align:center;color:#64748b">Sin ensayos a 28 días en el período</td></tr>`

  const td = `padding:6px 8px;border-bottom:1px solid #fee2e2`
  const noCumplenHtml = noCumplen.length ? noCumplen.map((e: any) => `<tr>
      <td style="${td};font-weight:700">${e.probetaId}</td>
      <td style="${td}">${e.remito}</td>
      <td style="${td};font-family:monospace;font-size:11px">${e.formula}</td>
      <td style="${td}">${e.moldeo ? fmtCorta(e.moldeo) : "-"}</td>
      <td style="${td}">${fmtCorta(e.fecha)}</td>
      <td style="${td}">${e.cliente}</td>
      <td style="${td}">${e.obra}</td>
      <td style="${td};text-align:right;font-weight:700">${e.aguaExtra ?? "-"}</td>
      <td style="${td};text-align:right">${e.asentamiento ?? "-"}</td>
      <td style="${td};text-align:right;font-weight:700;color:#b91c1c">${e.mpa.toFixed(1)}</td>
      <td style="${td};text-align:right">${e.esp}</td>
    </tr>`).join("") : `<tr><td colspan="11" style="padding:14px;text-align:center;color:#15803d;font-weight:600">Todas las probetas ensayadas a 28 días cumplieron la resistencia especificada</td></tr>`

  const ensayosHtml = ensayos.length ? ensayos.map((e: any) => `<tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eef2f7">${fmtCorta(e.fecha)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eef2f7">${e.planta}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eef2f7">${e.muestra}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eef2f7;font-family:monospace;font-size:12px">${e.formula}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eef2f7;text-align:center">${e.edad}d</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eef2f7;text-align:right;font-weight:700">${e.mpa.toFixed(1)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eef2f7;text-align:right">${e.esp ?? "-"}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eef2f7;text-align:center;color:${bgOk(e.cumple)};font-weight:700">
        ${e.cumple === null ? (e.pct ? e.pct.toFixed(0) + "% del esp." : "-") : e.cumple ? "CUMPLE" : "NO CUMPLE"}
      </td>
    </tr>`).join("") : `<tr><td colspan="8" style="padding:14px;text-align:center;color:#64748b">No se registraron roturas en el período</td></tr>`

  // Análisis
  const alertas: string[] = []
  if (pctTot < 100) alertas.push(`El muestreo estuvo <b>por debajo del objetivo</b>: se tomaron ${totMuestras} muestras sobre ${totObjetivo} recomendadas (${pctTot.toFixed(0)}%).`)
  const bajas = resumenFormula.filter((r: any) => r.cumplen < r.n)
  if (bajas.length) alertas.push(`Fórmulas con ensayos por debajo de lo especificado: <b>${bajas.map((b: any) => b.formula).join(", ")}</b>.`)
  if (vencidas > 0) alertas.push(`Hay <b>${vencidas} probetas vencidas</b> pendientes de romper.`)
  if (pctCumple28 !== null && pctCumple28 >= 100 && pctTot >= 100 && vencidas === 0) alertas.push("Sin desvíos: muestreo y resistencias dentro de lo esperado.")
  if (!alertas.length) alertas.push("Sin observaciones para el período.")

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<title>Reporte semanal de calidad</title></head>
<body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a">
<div style="max-width:860px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0">

  <div style="background:#0f172a;color:#fff;padding:20px 24px">
    <div style="font-size:20px;font-weight:700">Reporte semanal de calidad</div>
    <div style="opacity:.75;font-size:14px;margin-top:4px">${fmtFecha(desde)} al ${fmtFecha(hasta)} · Rebucret S.A.</div>
  </div>

  <div style="padding:20px 24px">
    <!-- Muestreo por planta -->
    <h3 style="font-size:15px;margin:0 0 8px">Producción y muestreo por planta</h3>
    <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:13px;margin-bottom:24px">
      <thead><tr style="background:#f1f5f9">
        <th style="padding:8px 10px;text-align:left">Planta</th>
        <th style="padding:8px 10px;text-align:right">Despachos</th>
        <th style="padding:8px 10px;text-align:right">m³</th>
        <th style="padding:8px 10px;text-align:right">Muestras</th>
        <th style="padding:8px 10px;text-align:right">Objetivo</th>
        <th style="padding:8px 10px;text-align:right">% Cumpl.</th>
      </tr></thead>
      <tbody>${filasPlantaHtml || `<tr><td colspan="6" style="padding:14px;text-align:center;color:#64748b">Sin despachos en el período</td></tr>`}</tbody>
    </table>
    <div style="font-size:12px;color:#64748b;margin:-18px 0 24px">
      <b>Objetivo de muestreo: 1 muestra cada 3 camiones despachados</b> (se redondea para abajo).
      Total del período: ${totMuestras} muestras sobre ${totObjetivo} objetivo (${totDespachos} camiones) ·
      <b style="color:${color(pctTot)}">${pctTot.toFixed(0)}% de cumplimiento</b>.
    </div>

    <!-- Resumen por fórmula -->
    <h3 style="font-size:15px;margin:0 0 8px">Resistencias a 28 días por fórmula</h3>
    <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:13px;margin-bottom:24px">
      <thead><tr style="background:#f1f5f9">
        <th style="padding:8px 10px;text-align:left">Fórmula</th>
        <th style="padding:8px 10px;text-align:right">Especificado</th>
        <th style="padding:8px 10px;text-align:right">Ensayos</th>
        <th style="padding:8px 10px;text-align:right">Promedio</th>
        <th style="padding:8px 10px;text-align:right">Mínimo</th>
        <th style="padding:8px 10px;text-align:right">Cumplen</th>
      </tr></thead>
      <tbody>${resumenHtml}</tbody>
    </table>

    <!-- Probetas que NO cumplieron -->
    <h3 style="font-size:15px;margin:0 0 8px;color:#b91c1c">Probetas que no alcanzaron la resistencia (${noCumplen.length})</h3>
    <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:11px;margin-bottom:8px;background:#fef2f2">
      <thead><tr style="background:#fee2e2">
        <th style="padding:8px;text-align:left">Probeta</th>
        <th style="padding:8px;text-align:left">Remito</th>
        <th style="padding:8px;text-align:left">Fórmula</th>
        <th style="padding:8px;text-align:left">Moldeo</th>
        <th style="padding:8px;text-align:left">Rotura</th>
        <th style="padding:8px;text-align:left">Cliente</th>
        <th style="padding:8px;text-align:left">Obra</th>
        <th style="padding:8px;text-align:right">Agua extra (L)</th>
        <th style="padding:8px;text-align:right">Asent. real (cm)</th>
        <th style="padding:8px;text-align:right">MPa</th>
        <th style="padding:8px;text-align:right">Esp.</th>
      </tr></thead>
      <tbody>${noCumplenHtml}</tbody>
    </table>
    <div style="font-size:12px;color:#64748b;margin:0 0 24px">
      El <b>agua extra agregada en planta</b> y el <b>asentamiento real</b> son los factores a revisar ante un incumplimiento:
      el agua de más modifica la relación agua/cemento y baja la resistencia.
    </div>

    <!-- Detalle de ensayos -->
    <h3 style="font-size:15px;margin:0 0 8px">Detalle de ensayos (${ensayos.length} roturas · ${e28.length} a 28d · ${e7.length} a 7d)</h3>
    <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:12px;margin-bottom:24px">
      <thead><tr style="background:#f1f5f9">
        <th style="padding:8px 10px;text-align:left">Fecha</th>
        <th style="padding:8px 10px;text-align:left">Planta</th>
        <th style="padding:8px 10px;text-align:left">Muestra</th>
        <th style="padding:8px 10px;text-align:left">Fórmula</th>
        <th style="padding:8px 10px;text-align:center">Edad</th>
        <th style="padding:8px 10px;text-align:right">MPa</th>
        <th style="padding:8px 10px;text-align:right">Esp.</th>
        <th style="padding:8px 10px;text-align:center">Estado</th>
      </tr></thead>
      <tbody>${ensayosHtml}</tbody>
    </table>
    <div style="font-size:12px;color:#64748b;margin:-18px 0 24px">El cumplimiento se evalúa a 28 días. Los ensayos a 7 días se informan como referencia (% de la resistencia especificada alcanzado).</div>

    <!-- Análisis -->
    <h3 style="font-size:15px;margin:0 0 8px">Estado de situación</h3>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-left:4px solid #0f172a;border-radius:6px;padding:14px 16px;font-size:13px;line-height:1.7">
      ${alertas.map((a: string) => `<div>• ${a}</div>`).join("")}
    </div>
  </div>

  <div style="padding:14px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:11px;color:#64748b">
    Generado automáticamente por el sistema de producción · produccionrebucret.com
  </div>
</div>
</body></html>`
}
