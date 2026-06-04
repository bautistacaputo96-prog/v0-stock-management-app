import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

function sb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
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
    row.client_id            ? supabase.from("clients").select("*").eq("id", row.client_id).single() : { data: null },
    row.construction_site_id ? supabase.from("construction_sites").select("*").eq("id", row.construction_site_id).single() : { data: null },
    row.formula_id           ? supabase.from("formulas").select("*").eq("id", row.formula_id).single() : { data: null },
    row.mixer_id             ? supabase.from("mixers").select("*").eq("id", row.mixer_id).single() : { data: null },
  ])

  const c = (client   as any) || {}
  const s = (site     as any) || {}
  const f = (formula  as any) || {}
  const m = (mixer    as any) || {}

  const dateRaw = row.dispatch_date || row.scheduled_arrival_time
  const fecha   = new Date(dateRaw).toLocaleDateString("es-AR", {
    day: "2-digit", month: "2-digit", year: "numeric"
  })

  const m3          = Number(row.quantity_m3 || 0).toFixed(1)
  const formulaDesc = f.code ? `HORMIGON ELABORADO ${f.name} (${f.code})` : (f.name ? `HORMIGON ELABORADO ${f.name}` : "HORMIGON ELABORADO")
  const obraDesc    = s.name ? `Obra: ${s.name}` : ""
  const descripcion = [formulaDesc, obraDesc].filter(Boolean).join(" - ")

  const html = buildHTML({
    fecha,
    razonSocial:  c.razon_social  || c.name       || "",
    direccion:    c.direccion_fiscal              || "",
    localidad:    c.localidad_cliente             || "",
    cp:           c.cp                            || "",
    cuitCliente:  c.cuit                          || "",
    m3,
    descripcion,
    obraDireccion: [s.address, s.localidad].filter(Boolean).join(", "),
    patente:      m.license_plate                 || "",
    observaciones: row.observations || row.notes  || "",
  })

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML del remito — valores posicionados sobre el ARCA Remito X de Rebucret
//
// CALIBRACIÓN: ajustá las variables CSS en :root para alinear con el formulario
// físico. Probá con una hoja en blanco primero para ver posiciones.
// ─────────────────────────────────────────────────────────────────────────────
function buildHTML(d: {
  fecha: string
  razonSocial: string
  direccion: string
  localidad: string
  cp: string
  cuitCliente: string
  m3: string
  descripcion: string
  obraDireccion: string
  patente: string
  observaciones: string
}) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Remito</title>
<style>
/* ══════════════════════════════════════════════════
   CALIBRACIÓN — ajustar estos valores para alinear
   con el formulario físico ARCA Remito X
   ══════════════════════════════════════════════════ */
:root {
  /* ── FECHA (header, columna derecha) ─────────── */
  --fecha-top:   57mm;
  --fecha-left: 148mm;

  /* ── DESTINATARIO (área grande en blanco) ────── */
  --dest-left:   15mm;
  --dest-rs-top:  82mm;   /* Razón Social */
  --dest-dir-top: 90mm;   /* Dirección */
  --dest-loc-top: 98mm;   /* Localidad / CP */
  --dest-cuit-top:106mm;  /* CUIT destinatario */

  /* ── TABLA ITEMS ─────────────────────────────── */
  --item-top:    158mm;   /* primera fila de items */
  --cant-left:    15mm;   /* columna CANTIDAD */
  --desc-left:    40mm;   /* columna DESCRIPCION */

  /* ── FOOTER ──────────────────────────────────── */
  --obs-top:     251mm;   --obs-left:    48mm;
  --trans-top:   259mm;   --trans-left:  52mm;
  --cuit-f-top:  267mm;   --cuit-f-left: 30mm;

  /* ── Tipografía ──────────────────────────────── */
  --fs:   9pt;
  --ff:   Arial, Helvetica, sans-serif;
}

/* ── Página ── */
@page { size: A4; margin: 0; }
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
html, body {
  width: 210mm; height: 297mm;
  background: white;
  font-family: var(--ff);
  font-size: var(--fs);
  color: #000;
  position: relative;
  overflow: hidden;
}

/* ── Valor posicionado ── */
.v {
  position: absolute;
  white-space: nowrap;
  line-height: 1;
}
.v-wrap {
  position: absolute;
  line-height: 1.3;
  max-width: 170mm;
}

/* ── Botón imprimir (no se imprime) ── */
.btn {
  position: fixed; top: 8px; right: 8px;
  background: #1d4ed8; color: white; border: none;
  border-radius: 6px; padding: 8px 18px;
  font-size: 13px; cursor: pointer; z-index: 999;
  font-family: system-ui, sans-serif;
  box-shadow: 0 2px 6px rgba(0,0,0,.3);
}
@media print { .btn { display: none; } }
</style>
</head>
<body>

<button class="btn" onclick="window.print()">🖨 Imprimir</button>

<!-- ── FECHA ── -->
<span class="v" style="top:var(--fecha-top); left:var(--fecha-left);">${d.fecha}</span>

<!-- ── DESTINATARIO ── -->
<span class="v" style="top:var(--dest-rs-top);  left:var(--dest-left); font-weight:bold;">${d.razonSocial}</span>
<span class="v" style="top:var(--dest-dir-top); left:var(--dest-left);">${d.direccion}</span>
<span class="v" style="top:var(--dest-loc-top); left:var(--dest-left);">${d.localidad}${d.cp ? " (" + d.cp + ")" : ""}</span>
<span class="v" style="top:var(--dest-cuit-top); left:var(--dest-left);">CUIT: ${d.cuitCliente}</span>

<!-- ── ITEMS ── -->
<span class="v" style="top:var(--item-top); left:var(--cant-left);">${d.m3} m³</span>
<span class="v-wrap" style="top:var(--item-top); left:var(--desc-left);">${d.descripcion}</span>
${d.obraDireccion ? `<span class="v" style="top:calc(var(--item-top) + 6mm); left:var(--desc-left); font-size:8pt; color:#333;">Dirección entrega: ${d.obraDireccion}</span>` : ""}
${d.patente ? `<span class="v" style="top:calc(var(--item-top) + 12mm); left:var(--desc-left); font-size:8pt; color:#333;">Camión: ${d.patente}</span>` : ""}

<!-- ── FOOTER ── -->
${d.observaciones ? `<span class="v" style="top:var(--obs-top); left:var(--obs-left);">${d.observaciones}</span>` : ""}
<span class="v" style="top:var(--trans-top); left:var(--trans-left);">REBUCRET S.A.${d.patente ? " - " + d.patente : ""}</span>
<span class="v" style="top:var(--cuit-f-top); left:var(--cuit-f-left);">30-71598364-4</span>

</body>
</html>`
}
