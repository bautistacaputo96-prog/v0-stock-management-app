import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

function sb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

function fmt(d: Date) {
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" })
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = sb()

  // Buscar en scheduled_dispatches primero, luego en dispatches
  let row: any = null
  let isScheduled = false

  const { data: sched } = await supabase
    .from("scheduled_dispatches").select("*").eq("id", id).limit(1).single()
  if (sched) { row = sched; isScheduled = true }
  else {
    const { data: disp } = await supabase
      .from("dispatches").select("*").eq("id", id).limit(1).single()
    if (disp) row = disp
  }

  if (!row) return new NextResponse("Despacho no encontrado", { status: 404 })

  const [{ data: client }, { data: site }, { data: formula }, { data: mixer }] = await Promise.all([
    row.client_id             ? supabase.from("clients").select("*").eq("id", row.client_id).single() : { data: null },
    row.construction_site_id  ? supabase.from("construction_sites").select("*").eq("id", row.construction_site_id).single() : { data: null },
    row.formula_id            ? supabase.from("formulas").select("*").eq("id", row.formula_id).single() : { data: null },
    row.mixer_id              ? supabase.from("mixers").select("*").eq("id", row.mixer_id).single() : { data: null },
  ])

  const c = client  || {}
  const s = site    || {}
  const f = formula || {}
  const m = mixer   || {}

  const dateRaw = row.dispatch_date || row.scheduled_arrival_time
  const fecha   = fmt(new Date(dateRaw))
  const m3      = Number(row.quantity_m3 || 0).toFixed(0)
  const remito  = (!isScheduled && row.remito) ? row.remito : ""

  const d = {
    fecha,
    razonSocial:      (c as any).razon_social       || (c as any).name          || "",
    nombreCliente:    (c as any).name               || "",
    clienteDireccion: (c as any).direccion_fiscal   || "",
    clienteCP:        (c as any).cp                 || "",
    clienteLocalidad: (c as any).localidad_cliente  || "",
    clienteProvincia: (c as any).provincia          || "",
    condIva:          (c as any).cond_iva           || "",
    condPago:         (c as any).cond_pago          || "",
    cuit:             (c as any).cuit               || "",
    nPedido:          "",
    remito,
    m3,
    productoCodigo:   (f as any).code || (f as any).name || "",
    obraLocalidad:    (s as any).localidad || "",
    obraDireccion:    (s as any).address   || "",
    patente:          (m as any).license_plate || "",
  }

  const html = buildHTML(d)
  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  })
}

// ──────────────────────────────────────────────────────────────────────────────
// HTML del remito overlay — solo valores, posicionados sobre el formulario ARCA
// Ajustar las variables CSS en :root para calibrar con el formulario físico
// ──────────────────────────────────────────────────────────────────────────────
function buildHTML(d: Record<string, string>) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Remito ${d.remito || d.m3 + "m³"}</title>
<style>
/* ── Calibración ── ajustar según el formulario físico */
:root {
  --fecha-top:   24mm; --fecha-left: 153mm;
  --col-izq:     28mm;
  --col-der:    128mm;
  --r1: 53mm; --r2: 61mm; --r3: 69mm;
  --r4: 77mm; --r5: 85mm; --r6: 93mm;
  --remito-left: 152mm;
  --prod-top:   108mm; --prod-qty: 12mm; --prod-cod: 26mm;
  --trans-left:  77mm;
  --t1: 261mm; --t2: 267mm; --t3: 273mm; --t4: 279mm; --t5: 285mm;
  --fs: 8.5pt;
  --ff: Arial, Helvetica, sans-serif;
}
@page { size: A4; margin: 0; }
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 210mm; height: 297mm; background: white; font-family: var(--ff); font-size: var(--fs); color: #000; position: relative; overflow: hidden; }
.v { position: absolute; white-space: nowrap; line-height: 1; }
.btn { position: fixed; top: 8px; right: 8px; background: #1d4ed8; color: white; border: none; border-radius: 6px; padding: 8px 16px; font-size: 13px; cursor: pointer; z-index: 999; font-family: system-ui, sans-serif; }
@media print { .btn { display: none; } }
</style>
</head>
<body>
<button class="btn" onclick="window.print()">🖨 Imprimir</button>

<span class="v" style="top:var(--fecha-top);left:var(--fecha-left)">${d.fecha}</span>

<span class="v" style="top:var(--r1);left:var(--col-izq)">${d.razonSocial}</span>
<span class="v" style="top:var(--r2);left:var(--col-izq)">${d.clienteDireccion}</span>
<span class="v" style="top:var(--r3);left:var(--col-izq)">${d.clienteCP}</span>
<span class="v" style="top:var(--r4);left:var(--col-izq)">${d.condIva}</span>
<span class="v" style="top:var(--r5);left:var(--col-izq)">${d.nPedido}</span>
<span class="v" style="top:var(--r6);left:var(--col-izq)">${d.condPago}</span>

<span class="v" style="top:var(--r1);left:var(--col-der)">${d.nombreCliente}</span>
<span class="v" style="top:var(--r2);left:var(--col-der)">${d.clienteLocalidad}</span>
<span class="v" style="top:var(--r3);left:var(--col-der)">${d.clienteProvincia}</span>
<span class="v" style="top:var(--r4);left:var(--col-der)">${d.cuit}</span>
<span class="v" style="top:var(--r6);left:var(--remito-left)">${d.remito}</span>

<span class="v" style="top:var(--prod-top);left:var(--prod-qty);font-size:9.5pt">${d.m3}</span>
<span class="v" style="top:var(--prod-top);left:var(--prod-cod);font-size:9.5pt">${d.productoCodigo}</span>

<span class="v" style="top:var(--t3);left:var(--trans-left)">${d.patente}</span>
<span class="v" style="top:var(--t4);left:var(--trans-left)">${d.obraLocalidad}</span>
<span class="v" style="top:var(--t5);left:var(--trans-left)">${d.obraDireccion}</span>
</body>
</html>`
}
