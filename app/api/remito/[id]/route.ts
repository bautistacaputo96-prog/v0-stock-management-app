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

  const c = (client  as any) || {}
  const s = (site    as any) || {}
  const f = (formula as any) || {}
  const m = (mixer   as any) || {}

  const dateRaw = row.dispatch_date || row.scheduled_arrival_time
  const fecha   = new Date(dateRaw).toLocaleDateString("es-AR", {
    day: "2-digit", month: "2-digit", year: "numeric"
  })

  const m3          = Number(row.quantity_m3 || 0).toFixed(1)
  const formulaDesc = f.code
    ? `HORMIGON ELABORADO ${f.name} (${f.code})`
    : f.name ? `HORMIGON ELABORADO ${f.name}` : "HORMIGON ELABORADO"
  const obraDesc    = s.name ? `Obra: ${s.name}` : ""
  const descripcion = [formulaDesc, obraDesc].filter(Boolean).join(" — ")
  const obraDireccion = [s.address, s.localidad].filter(Boolean).join(", ")

  const html = buildHTML({
    fecha,
    razonSocial:   c.razon_social || c.name || "",
    direccion:     c.direccion_fiscal || "",
    localidad:     c.localidad_cliente || "",
    cp:            c.cp || "",
    cuitCliente:   c.cuit || "",
    condIva:       c.cond_iva || "",
    m3,
    descripcion,
    obraDireccion,
    obraNombre:    s.name || "",
    patente:       m.license_plate || "",
    observaciones: row.observations || row.notes || "",
    isScheduled,
  })

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  })
}

function buildHTML(d: Record<string, string | boolean>) {
  const fecha       = d.fecha as string
  const razonSocial = d.razonSocial as string
  const direccion   = d.direccion as string
  const localidad   = d.localidad as string
  const cp          = d.cp as string
  const cuitCliente = d.cuitCliente as string
  const m3          = d.m3 as string
  const descripcion = d.descripcion as string
  const obraDireccion = d.obraDireccion as string
  const obraNombre  = d.obraNombre as string
  const patente     = d.patente as string
  const observaciones = d.observaciones as string

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Remito — ${razonSocial || "Sin cliente"} — ${fecha}</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>
<style>
/* ══════════════════════════════════════════════
   PANTALLA — vista previa del remito
   ══════════════════════════════════════════════ */
@media screen {
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    background: #f3f4f6;
    min-height: 100vh;
    padding: 24px 16px 80px;
    color: #111;
  }

  /* Barra de acciones */
  .toolbar {
    max-width: 720px; margin: 0 auto 20px;
    display: flex; gap: 10px; flex-wrap: wrap; align-items: center;
  }
  .toolbar h2 { flex:1; font-size:16px; color:#374151; }
  .btn-pdf {
    background:#1d4ed8; color:white; border:none;
    padding:10px 20px; border-radius:8px; font-size:14px;
    cursor:pointer; font-family:inherit; font-weight:600;
    display:flex; align-items:center; gap:6px;
    box-shadow: 0 2px 4px rgba(0,0,0,.15);
  }
  .btn-pdf:hover { background:#1e40af; }
  .btn-print {
    background:white; color:#374151; border:1.5px solid #d1d5db;
    padding:10px 20px; border-radius:8px; font-size:14px;
    cursor:pointer; font-family:inherit; font-weight:500;
    display:flex; align-items:center; gap:6px;
  }
  .btn-print:hover { background:#f9fafb; }

  /* Tarjeta del remito */
  #remito-preview {
    max-width: 720px; margin: 0 auto;
    background: white;
    border: 1.5px solid #e5e7eb;
    border-radius: 10px;
    overflow: hidden;
    box-shadow: 0 4px 20px rgba(0,0,0,.08);
    font-size: 12px;
  }

  /* Header */
  .rm-header {
    display: grid; grid-template-columns: auto 1fr auto;
    gap: 0; border-bottom: 2px solid #111;
  }
  .rm-logo { padding:12px 14px; border-right:1.5px solid #ddd; display:flex; align-items:center; }
  .rm-logo-text { font-size:22px; font-weight:900; color:#111; letter-spacing:-1px; }
  .rm-empresa { padding:10px 14px; font-size:10px; line-height:1.6; }
  .rm-empresa .nombre { font-size:14px; font-weight:700; margin-bottom:4px; }
  .rm-tipo {
    padding:10px 14px; border-left:1.5px solid #ddd;
    min-width:200px; text-align:right;
  }
  .rm-tipo .titulo { font-size:18px; font-weight:900; letter-spacing:2px; }
  .rm-tipo .numero { font-size:13px; font-weight:600; margin:4px 0; color:#374151; }
  .rm-tipo .fecha-row { display:flex; gap:8px; align-items:center; justify-content:flex-end; margin-top:4px; }
  .rm-tipo .fecha-label { font-size:10px; color:#6b7280; font-weight:600; text-transform:uppercase; }
  .rm-tipo .fecha-val { font-size:12px; font-weight:700; }
  .rm-tipo .cuit-info { font-size:9px; color:#6b7280; margin-top:6px; line-height:1.5; }

  /* Destinatario */
  .rm-dest {
    padding:14px 16px; border-bottom:1px solid #e5e7eb; min-height:70px;
    background:#fafafa;
  }
  .rm-dest-label { font-size:9px; font-weight:700; color:#6b7280; text-transform:uppercase; letter-spacing:.5px; margin-bottom:6px; }
  .rm-dest-nombre { font-size:14px; font-weight:700; color:#111; }
  .rm-dest-info { font-size:11px; color:#374151; margin-top:3px; line-height:1.6; }
  .rm-dest-cuit { font-size:11px; color:#374151; margin-top:2px; }

  /* Tabla items */
  .rm-table { width:100%; border-collapse:collapse; }
  .rm-table th {
    background:#f3f4f6; border:1px solid #e5e7eb;
    padding:7px 10px; font-size:10px; font-weight:700;
    text-transform:uppercase; letter-spacing:.5px; color:#374151;
  }
  .rm-table td {
    border:1px solid #e5e7eb; padding:10px 10px;
    vertical-align:top; font-size:12px;
  }
  .rm-table .td-cant { width:100px; text-align:center; font-size:14px; font-weight:700; }
  .rm-table .td-desc .desc-main { font-weight:600; font-size:13px; }
  .rm-table .td-desc .desc-sub { font-size:10px; color:#6b7280; margin-top:3px; line-height:1.5; }
  .rm-table .empty-rows td { height:24px; }

  /* Nota */
  .rm-nota { padding:8px 12px; font-size:9px; color:#6b7280; border-top:1px solid #e5e7eb; background:#fffbeb; }
  .rm-nota strong { color:#92400e; }

  /* Footer */
  .rm-footer { border-top:2px solid #111; }
  .rm-footer-row {
    display:grid; grid-template-columns:1fr 1fr;
    border-bottom:1px solid #e5e7eb;
  }
  .rm-footer-cell { padding:7px 12px; font-size:10px; }
  .rm-footer-cell .lbl { font-weight:700; color:#374151; text-transform:uppercase; font-size:9px; }
  .rm-footer-cell .val { color:#111; margin-top:1px; font-size:11px; }
  .rm-footer-last { padding:7px 12px; font-size:10px; border-top:1px solid #e5e7eb; }
  .rm-footer-last .lbl { font-weight:700; color:#374151; text-transform:uppercase; font-size:9px; }
  .rm-footer-last .val { color:#111; margin-top:1px; font-size:11px; }
}

/* ══════════════════════════════════════════════
   IMPRESIÓN — overlay sobre formulario físico ARCA
   Calibrar variables :root para alinear
   ══════════════════════════════════════════════ */
@media print {
  .toolbar, #remito-preview { display: none !important; }

  :root {
    --fecha-top:   57mm; --fecha-left: 148mm;
    --dest-left:   15mm;
    --dest-rs-top:  82mm;
    --dest-dir-top: 90mm;
    --dest-loc-top: 98mm;
    --dest-cuit-top:106mm;
    --item-top:    158mm;
    --cant-left:    15mm;
    --desc-left:    40mm;
    --obs-top:     251mm; --obs-left:    48mm;
    --trans-top:   259mm; --trans-left:  52mm;
    --cuit-f-top:  267mm; --cuit-f-left: 30mm;
  }

  @page { size: A4; margin: 0; }
  html, body { width:210mm; height:297mm; background:white; position:relative; overflow:hidden; font-family:Arial,Helvetica,sans-serif; font-size:9pt; color:#000; }

  .overlay { display: block !important; }
  .v { position:absolute; white-space:nowrap; line-height:1; }
}

/* Overlay oculto en pantalla */
.overlay { display: none; }
</style>
</head>
<body>

<!-- ── BARRA DE ACCIONES (solo pantalla) ── -->
<div class="toolbar">
  <h2>Vista previa del Remito</h2>
  <button class="btn-pdf" onclick="descargarPDF()">
    📄 Descargar PDF
  </button>
  <button class="btn-print" onclick="window.print()">
    🖨 Imprimir en formulario ARCA
  </button>
</div>

<!-- ── PREVIEW (solo pantalla) ── -->
<div id="remito-preview">

  <!-- Header -->
  <div class="rm-header">
    <div class="rm-logo">
      <span class="rm-logo-text">Rebucret</span>
    </div>
    <div class="rm-empresa">
      <div class="nombre">REBUCRET S.A.</div>
      <div>AV. SANTA FE 1385, Piso 6 — (1059) C.A.B.A.</div>
      <div>I.V.A. RESPONSABLE INSCRIPTO</div>
    </div>
    <div class="rm-tipo">
      <div class="titulo">REMITO</div>
      <div class="numero">Nº 00002-</div>
      <div class="fecha-row">
        <span class="fecha-label">Fecha</span>
        <span class="fecha-val">${fecha}</span>
      </div>
      <div class="cuit-info">
        C.U.I.T.: 30-71598364-4<br>
        ING. BRUTOS: 30-71598364-4
      </div>
    </div>
  </div>

  <!-- Destinatario -->
  <div class="rm-dest">
    <div class="rm-dest-label">Destinatario</div>
    <div class="rm-dest-nombre">${razonSocial || "—"}</div>
    <div class="rm-dest-info">
      ${direccion ? `${direccion}` : ""}
      ${localidad || cp ? ` — ${[localidad, cp].filter(Boolean).join(" ")}` : ""}
    </div>
    ${cuitCliente ? `<div class="rm-dest-cuit">CUIT: ${cuitCliente}${d.condIva ? ` &nbsp;·&nbsp; ${d.condIva}` : ""}</div>` : ""}
  </div>

  <!-- Items -->
  <table class="rm-table">
    <thead>
      <tr>
        <th>Cantidad</th>
        <th>Descripción</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td class="td-cant">${m3} m³</td>
        <td class="td-desc">
          <div class="desc-main">${descripcion}</div>
          <div class="desc-sub">
            ${obraDireccion ? `📍 Dirección entrega: ${obraDireccion}` : ""}
            ${patente ? `<br>🚛 Camión: ${patente}` : ""}
          </div>
        </td>
      </tr>
      <tr class="empty-rows"><td></td><td></td></tr>
      <tr class="empty-rows"><td></td><td></td></tr>
    </tbody>
  </table>

  <!-- Nota -->
  <div class="rm-nota">
    <strong>NOTA:</strong> La mercadería viaja por cuenta y orden del comprador.
  </div>

  <!-- Footer -->
  <div class="rm-footer">
    <div class="rm-footer-row">
      <div class="rm-footer-cell">
        <div class="lbl">Observaciones</div>
        <div class="val">${observaciones || "—"}</div>
      </div>
      <div class="rm-footer-cell">
        <div class="lbl">Bultos</div>
        <div class="val">—</div>
      </div>
    </div>
    <div class="rm-footer-row">
      <div class="rm-footer-cell">
        <div class="lbl">Transportista</div>
        <div class="val">REBUCRET S.A.${patente ? ` — ${patente}` : ""}</div>
      </div>
      <div class="rm-footer-cell">
        <div class="lbl">Valor Declarado</div>
        <div class="val">—</div>
      </div>
    </div>
    <div class="rm-footer-last">
      <span class="lbl">C.U.I.T. Transportista: </span>
      <span class="val">30-71598364-4</span>
    </div>
  </div>
</div>

<!-- ── OVERLAY (solo impresión en formulario ARCA) ── -->
<div class="overlay">
  <span class="v" style="top:var(--fecha-top);left:var(--fecha-left)">${fecha}</span>
  <span class="v" style="top:var(--dest-rs-top);left:var(--dest-left);font-weight:bold">${razonSocial}</span>
  <span class="v" style="top:var(--dest-dir-top);left:var(--dest-left)">${direccion}</span>
  <span class="v" style="top:var(--dest-loc-top);left:var(--dest-left)">${localidad}${cp ? " (" + cp + ")" : ""}</span>
  <span class="v" style="top:var(--dest-cuit-top);left:var(--dest-left)">CUIT: ${cuitCliente}</span>
  <span class="v" style="top:var(--item-top);left:var(--cant-left)">${m3} m³</span>
  <span class="v" style="top:var(--item-top);left:var(--desc-left)">${descripcion}</span>
  ${obraDireccion ? `<span class="v" style="top:calc(var(--item-top) + 6mm);left:var(--desc-left);font-size:8pt">Dir. entrega: ${obraDireccion}</span>` : ""}
  ${patente ? `<span class="v" style="top:calc(var(--item-top) + 12mm);left:var(--desc-left);font-size:8pt">Camión: ${patente}</span>` : ""}
  ${observaciones ? `<span class="v" style="top:var(--obs-top);left:var(--obs-left)">${observaciones}</span>` : ""}
  <span class="v" style="top:var(--trans-top);left:var(--trans-left)">REBUCRET S.A.${patente ? " — " + patente : ""}</span>
  <span class="v" style="top:var(--cuit-f-top);left:var(--cuit-f-left)">30-71598364-4</span>
</div>

<script>
function descargarPDF() {
  const el = document.getElementById('remito-preview')
  const opt = {
    margin:      [8, 8, 8, 8],
    filename:    'remito-${razonSocial.replace(/[^a-zA-Z0-9]/g, '_') || 'rebucret'}-${fecha.replace(/\//g, '-')}.pdf',
    image:       { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF:       { unit: 'mm', format: 'a4', orientation: 'portrait' }
  }
  html2pdf().set(opt).from(el).save()
}
</script>
</body>
</html>`
}
