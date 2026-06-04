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

  const m3           = Number(row.quantity_m3 || 0).toFixed(0)
  const remito       = (!isScheduled && row.remito) ? row.remito : ""
  const productoCode = f.code || f.name || ""
  const productoDesc = productoCode ? `${productoCode}` : "HORMIGON ELABORADO"

  const data = {
    fecha,
    razonSocial:   c.razon_social      || c.name || "",
    nombreCliente: c.name              || "",
    direccion:     c.direccion_fiscal  || "",
    cp:            c.cp                || "",
    localidadCliente: c.localidad_cliente || "",
    provincia:     c.provincia         || "",
    condIva:       c.cond_iva          || "",
    condPago:      c.cond_pago         || "",
    cuit:          c.cuit              || "",
    nPedido:       "",
    remito,
    m3,
    productoDesc,
    obraLocalidad: s.localidad         || "",
    obraDireccion: s.address           || "",
    patente:       m.license_plate     || "",
    observaciones: row.observations || row.notes || "",
  }

  return new NextResponse(buildHTML(data), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  })
}

function buildHTML(d: Record<string, string>) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Documentos del Despacho</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>
<style>
/* ═══════ BASE ═══════ */
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: Arial, Helvetica, sans-serif; background:#e5e7eb; }

/* ═══════ TOOLBAR ═══════ */
.toolbar {
  position: sticky; top: 0; z-index: 100;
  background: #1e293b; padding: 10px 20px;
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
}
.toolbar-title { color: white; font-size: 14px; font-weight: 600; flex: 1; }
.tab-btn {
  background: transparent; border: 1.5px solid #64748b;
  color: #94a3b8; padding: 6px 14px; border-radius: 6px;
  font-size: 12px; cursor: pointer; transition: all .15s;
}
.tab-btn.active { background: white; color: #1e293b; border-color: white; font-weight: 700; }
.act-btn {
  padding: 7px 14px; border-radius: 6px; font-size: 12px;
  cursor: pointer; border: none; font-weight: 600; transition: all .15s;
}
.act-pdf   { background: #2563eb; color: white; }
.act-print { background: #16a34a; color: white; }
.act-btn:hover { opacity: .85; }

/* ═══════ DOCUMENTO A4 ═══════ */
.doc-wrapper { display: none; padding: 20px 0; }
.doc-wrapper.active { display: block; }
.a4 {
  width: 210mm; min-height: 297mm;
  background: white; margin: 0 auto;
  box-shadow: 0 4px 20px rgba(0,0,0,.15);
  position: relative; overflow: hidden;
  font-size: 8.5pt; color: #000;
  font-family: Arial, Helvetica, sans-serif;
}

/* ══════════════════════════════════════════
   DOCUMENTO 1: CONTROL PANEL
   ══════════════════════════════════════════ */
.cp { padding: 12mm 12mm 10mm 12mm; }

.cp-fecha {
  text-align: right; font-size: 8.5pt;
  margin-bottom: 8mm;
}

.cp-cliente {
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 0; margin-bottom: 6mm;
  font-size: 8.5pt; line-height: 1.9;
}
.cp-cliente .col { }
.cp-cliente .row { display: flex; gap: 4px; }
.cp-cliente .lbl { font-size: 8.5pt; }
.cp-cliente .val { font-size: 8.5pt; }
.cp-remito { margin-top: 2mm; font-size: 8.5pt; }

.cp-producto {
  margin: 8mm 0 5mm 0;
  font-size: 9pt;
  display: flex; gap: 12mm; align-items: baseline;
}
.cp-producto .qty { font-size: 9pt; }
.cp-producto .cod { font-size: 9pt; }

/* Tabla principal */
.cp-table {
  width: 100%; border-collapse: collapse;
  font-size: 7.5pt; margin-bottom: 20mm;
}
.cp-table td, .cp-table th {
  border: 0.5px solid #333;
  padding: 1.2mm 1.5mm;
  vertical-align: top;
}
.cp-table .hdr-check {
  font-size: 7pt; text-align: center;
  width: 15mm; vertical-align: middle;
}
.cp-table .check-cell {
  text-align: center; font-size: 7.5pt;
  width: 15mm;
}
.cp-table .check-cell div { line-height: 2; }
.cp-table .full { font-weight: bold; }
.cp-table .disclaimer {
  font-size: 6.5pt; line-height: 1.3;
  width: 45mm;
}
.cp-table .horario-row td { height: 5.5mm; }
.cp-table .section-hdr { font-weight: bold; font-size: 7.5pt; }
.cp-table .empty-row td { height: 7mm; }
.cp-table .litros-cell { width: 12mm; vertical-align: top; }

/* Transporte */
.cp-transporte {
  position: absolute; bottom: 12mm; left: 50mm;
  font-size: 8.5pt; line-height: 2.1;
}

/* ══════════════════════════════════════════
   DOCUMENTO 2: ARCA REMITO X
   ══════════════════════════════════════════ */
.rx { padding: 0; }

/* Header box */
.rx-header {
  border: 1px solid #000;
  display: grid;
  grid-template-columns: 45mm 28mm 1fr;
  margin: 8mm 8mm 0 8mm;
}
.rx-logo {
  border-right: 1px solid #000;
  padding: 6mm 4mm;
  display: flex; flex-direction: column;
  justify-content: center;
}
.rx-logo-icon {
  font-size: 22px; line-height: 1; margin-bottom: 2mm;
}
.rx-logo .co-name { font-size: 10pt; font-weight: 900; letter-spacing: -0.5px; }
.rx-logo .co-addr { font-size: 7pt; line-height: 1.4; margin-top: 1mm; color: #333; }
.rx-logo .co-iva  { font-size: 7pt; margin-top: 2mm; }

.rx-x {
  border-right: 1px solid #000;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  padding: 3mm 2mm; text-align: center;
}
.rx-x .x-box {
  border: 2px solid #000; width: 14mm; height: 10mm;
  display: flex; align-items: center; justify-content: center;
  font-size: 16pt; font-weight: 900; margin-bottom: 2mm;
}
.rx-x .x-label { font-size: 5pt; line-height: 1.3; }

.rx-info {
  padding: 5mm 5mm;
}
.rx-info .remito-title { font-size: 14pt; font-weight: 900; letter-spacing: 2px; }
.rx-info .remito-num { font-size: 11pt; font-weight: 700; margin: 1mm 0; }
.rx-info .fecha-row { display: flex; gap: 4mm; align-items: baseline; margin: 1mm 0; }
.rx-info .fecha-lbl { font-size: 8.5pt; font-weight: 700; }
.rx-info .fecha-val { font-size: 8.5pt; font-weight: 700; border-bottom: 0.5px solid #666; min-width: 28mm; }
.rx-info .cuit-block { font-size: 7pt; margin-top: 2mm; line-height: 1.5; color: #333; }

/* Destinatario */
.rx-dest {
  margin: 0 8mm;
  border-left: 1px solid #000;
  border-right: 1px solid #000;
  border-bottom: 1px solid #000;
  padding: 5mm 5mm;
  min-height: 35mm;
  font-size: 8.5pt; line-height: 1.9;
}
.rx-dest .dest-nombre { font-weight: 700; font-size: 9pt; }

/* Tabla items */
.rx-table {
  width: calc(100% - 16mm);
  margin: 0 8mm;
  border-collapse: collapse;
  font-size: 8pt;
}
.rx-table th {
  border: 0.5px solid #000;
  padding: 1.5mm 2mm;
  font-size: 8pt; font-weight: 700;
  text-transform: uppercase;
  background: white;
}
.rx-table td {
  border: 0.5px solid #000;
  padding: 2mm 2mm;
  vertical-align: top;
}
.rx-table .td-cant { width: 30mm; text-align: center; }
.rx-table .td-desc { }
.rx-table .empty-r td { height: 7mm; }
.rx-table .sig-row td {
  height: 12mm; font-size: 7.5pt; vertical-align: bottom;
  padding-bottom: 1.5mm; text-align: center;
}
.rx-table .sig-row td:not(:first-child) { border-left: 0.5px solid #000; }

/* Nota */
.rx-nota {
  margin: 0 8mm;
  border: 0.5px solid #000; border-top: none;
  padding: 1.5mm 3mm; font-size: 7pt;
}
.rx-nota strong { font-weight: 700; }

/* Footer */
.rx-footer {
  margin: 2mm 8mm 8mm;
  border: 0.5px solid #000;
  font-size: 8pt;
}
.rx-footer-row {
  display: grid; grid-template-columns: 1fr 1fr;
  border-bottom: 0.5px solid #000;
}
.rx-footer-row:last-child { border-bottom: none; }
.rx-fc {
  padding: 1.5mm 3mm; display: flex; gap: 3mm;
}
.rx-fc:first-child { border-right: 0.5px solid #000; }
.rx-fc .fl { font-weight: 700; white-space: nowrap; }
.rx-fc .fv { }
.rx-footer-single {
  padding: 1.5mm 3mm; display: flex; gap: 3mm;
  border-top: 0.5px solid #000;
}
.rx-footer-single .fl { font-weight: 700; }

/* ═══════ PRINT ═══════ */
@media print {
  body { background: white; }
  .toolbar { display: none !important; }
  .doc-wrapper { display: block !important; padding: 0 !important; }
  .doc-wrapper + .doc-wrapper { page-break-before: always; }
  .a4 { box-shadow: none; margin: 0; width: 210mm; min-height: 297mm; }
}
</style>
</head>
<body>

<!-- ── TOOLBAR ── -->
<div class="toolbar">
  <span class="toolbar-title">Documentos del Despacho — ${d.razonSocial || "Sin cliente"} — ${d.fecha}</span>
  <button class="tab-btn active" id="tab-cp" onclick="showTab('cp')">Control de Carga</button>
  <button class="tab-btn"        id="tab-rx" onclick="showTab('rx')">Remito Fiscal (ARCA)</button>
  <button class="act-btn act-pdf"   onclick="downloadPDF()">📄 Descargar PDF</button>
  <button class="act-btn act-print" onclick="window.print()">🖨 Imprimir</button>
</div>

<!-- ══════════════════════════════════════════════════════
     DOCUMENTO 1: CONTROL PANEL
     ══════════════════════════════════════════════════════ -->
<div class="doc-wrapper active" id="wrap-cp">
<div class="a4">
<div class="cp">

  <!-- FECHA -->
  <div class="cp-fecha">${d.fecha}</div>

  <!-- DATOS DEL CLIENTE -->
  <div class="cp-cliente">
    <div class="col">
      <div class="row"><span class="lbl">R. Social:&nbsp;</span><span class="val">${d.razonSocial}</span></div>
      <div class="row"><span class="lbl">Direccion:&nbsp;</span><span class="val">${d.direccion}</span></div>
      <div class="row"><span class="lbl">CP:&nbsp;</span><span class="val">${d.cp}</span></div>
      <div class="row"><span class="lbl">Cond IVA:&nbsp;</span><span class="val">${d.condIva}</span></div>
      <div class="row"><span class="lbl">N Ped:&nbsp;</span><span class="val">${d.nPedido}&nbsp;&nbsp;|</span></div>
      <div class="row"><span class="lbl">Cond Pago:&nbsp;</span><span class="val">${d.condPago}</span></div>
    </div>
    <div class="col">
      <div class="row"><span class="lbl">Cliente:&nbsp;</span><span class="val">${d.nombreCliente}</span></div>
      <div class="row"><span class="lbl">Localidad:&nbsp;</span><span class="val">${d.localidadCliente}</span></div>
      <div class="row"><span class="lbl">Provincia:&nbsp;</span><span class="val">${d.provincia}</span></div>
      <div class="row"><span class="lbl">CUIT:&nbsp;</span><span class="val">${d.cuit}</span></div>
      <div class="row">&nbsp;</div>
      <div class="cp-remito">RM2 - 0099-${d.remito}</div>
    </div>
  </div>

  <!-- PRODUCTO -->
  <div class="cp-producto">
    <span class="qty">${d.m3}</span>
    <span class="cod">${d.productoDesc}</span>
  </div>

  <!-- TABLA PRINCIPAL -->
  <table class="cp-table">
    <!-- Fila 1: header agua + checkboxes -->
    <tr>
      <td rowspan="2" colspan="2" style="width:55%; vertical-align:middle; font-size:7.5pt;">AGREGADO DE AGUA AUTORIZADO POR EL CLIENTE</td>
      <td class="hdr-check">Se realizaron<br>probetas</td>
      <td class="hdr-check">Se realizaron de<br>acuerdo a norma</td>
      <td class="hdr-check">Se encuentra en<br>lugar de guardado<br>apropiado</td>
    </tr>
    <!-- Fila 2: Si / No -->
    <tr>
      <td class="check-cell"><div>Si</div><div>No</div></td>
      <td class="check-cell"><div>Si</div><div>No</div></td>
      <td class="check-cell"><div>Si</div><div>No</div></td>
    </tr>
    <!-- Fila 3: disclaimer + litros + observaciones -->
    <tr>
      <td class="disclaimer">REBUCRET S.A. NO SE RESPONSABILIZA POR LA CANTIDAD DE AGUA AGREGADA EN OBRA YA QUE SE MODIFICA LA RELACIÓN AGUA/CEMENTO EN LA FORMULA DE DISEÑO</td>
      <td class="litros-cell" style="font-size:7pt; text-align:center;">LITROS</td>
      <td colspan="3" style="vertical-align:top; font-size:7.5pt;">Observaciones:</td>
    </tr>
    <!-- Fila 4: asentamiento -->
    <tr>
      <td colspan="5" class="section-hdr">ASENTAMIENTO EN OBRA:</td>
    </tr>
    <!-- Fila 5: aditivos -->
    <tr>
      <td colspan="4" class="section-hdr">ADITIVOS/AGREGADOS:</td>
      <td class="section-hdr" style="text-align:center;">CANTIDAD</td>
    </tr>
    <!-- Filas vacías para aditivos -->
    <tr class="empty-row"><td colspan="4"></td><td></td></tr>
    <tr class="empty-row"><td colspan="4"></td><td></td></tr>
    <tr class="empty-row"><td colspan="4"></td><td></td></tr>
    <!-- Header horarios -->
    <tr>
      <td colspan="5" class="section-hdr">HORARIOS DEL SERVICIO:</td>
    </tr>
    <!-- Filas de horario -->
    <tr class="horario-row"><td colspan="4">HORA DE CARGA:</td><td></td></tr>
    <tr class="horario-row"><td colspan="4">HORA DE LLEGADA A OBRA:</td><td></td></tr>
    <tr class="horario-row"><td colspan="4">COMIENZO DE DESCARGA:</td><td></td></tr>
    <tr class="horario-row"><td colspan="4">TERMINO DE DESCARGA:</td><td></td></tr>
    <tr class="horario-row"><td colspan="4">HORA DE RETIRO DE LA OBRA:</td><td></td></tr>
  </table>

</div><!-- /cp -->

<!-- TRANSPORTE (bottom) -->
<div class="cp-transporte">
  <div>Transporte:</div>
  <div>Chofer:</div>
  <div>Patente:&nbsp;&nbsp;${d.patente}</div>
  <div>Localidad:&nbsp;&nbsp;${d.obraLocalidad}</div>
  <div>Direccion:&nbsp;&nbsp;${d.obraDireccion}</div>
</div>

</div><!-- /a4 -->
</div><!-- /wrap-cp -->


<!-- ══════════════════════════════════════════════════════
     DOCUMENTO 2: ARCA REMITO X
     ══════════════════════════════════════════════════════ -->
<div class="doc-wrapper" id="wrap-rx">
<div class="a4 rx">

  <!-- HEADER -->
  <div class="rx-header">
    <!-- Logo / empresa -->
    <div class="rx-logo">
      <div class="rx-logo-icon">🚛</div>
      <div class="co-name">REBUCRET S.A.</div>
      <div class="co-addr">AV. SANTA FE 1385<br>Piso 6<br>(1059) C.A.B.A.</div>
      <div class="co-iva">I.V.A. RESPONSABLE INSCRIPTO</div>
    </div>
    <!-- X -->
    <div class="rx-x">
      <div class="x-box">X</div>
      <div class="x-label">DOCUMENTO<br>NO VALIDO<br>COMO FACTURA</div>
    </div>
    <!-- Remito info -->
    <div class="rx-info">
      <div class="remito-title">REMITO</div>
      <div class="remito-num">Nº 00002-&nbsp;${d.remito ? "0099-" + d.remito : ""}</div>
      <div class="fecha-row">
        <span class="fecha-lbl">FECHA</span>
        <span class="fecha-val">${d.fecha}</span>
      </div>
      <div class="cuit-block">
        C.U.I.T.: 30-71598364-4<br>
        ING. BRUTOS: 30-71598364-4<br>
        Fecha Inicio Activ.: 06-02-2018
      </div>
    </div>
  </div>

  <!-- DESTINATARIO -->
  <div class="rx-dest">
    <div class="dest-nombre">${d.razonSocial}</div>
    ${d.direccion ? `<div>${d.direccion}</div>` : ""}
    ${d.localidadCliente ? `<div>${d.localidadCliente}${d.cp ? " (" + d.cp + ")" : ""}&nbsp;&nbsp;—&nbsp;&nbsp;${d.provincia}</div>` : ""}
    ${d.cuit ? `<div>C.U.I.T.: ${d.cuit}</div>` : ""}
  </div>

  <!-- ITEMS TABLE -->
  <table class="rx-table">
    <thead>
      <tr>
        <th class="td-cant">CANTIDAD</th>
        <th class="td-desc">DESCRIPCION</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td class="td-cant" style="font-weight:700; font-size:9pt;">${d.m3} m³</td>
        <td class="td-desc">
          ${d.productoDesc}
          ${d.obraDireccion ? `<br><span style="font-size:7.5pt; color:#444;">Dir. entrega: ${d.obraDireccion}</span>` : ""}
          ${d.patente ? `<br><span style="font-size:7.5pt; color:#444;">Camión: ${d.patente}</span>` : ""}
        </td>
      </tr>
      <tr class="empty-r"><td></td><td></td></tr>
      <tr class="empty-r"><td></td><td></td></tr>
      <tr class="empty-r"><td></td><td></td></tr>
      <tr class="empty-r"><td></td><td></td></tr>
      <tr class="empty-r"><td></td><td></td></tr>
      <tr class="empty-r"><td></td><td></td></tr>
      <tr class="empty-r"><td></td><td></td></tr>
      <tr class="empty-r"><td></td><td></td></tr>
      <tr class="sig-row">
        <td colspan="1" style="border-top: 0.5px solid #000; text-align:center;">Firma</td>
        <td style="border-top: 0.5px solid #000; text-align:center;">Aclaración &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Documento Nº</td>
      </tr>
    </tbody>
  </table>

  <!-- NOTA -->
  <div class="rx-nota">
    <strong>NOTA:</strong> La mercadería viaja por cuenta y orden del comprador
  </div>

  <!-- FOOTER -->
  <div class="rx-footer">
    <div class="rx-footer-row">
      <div class="rx-fc">
        <span class="fl">OBSERVACIONES:</span>
        <span class="fv">${d.observaciones}</span>
      </div>
      <div class="rx-fc">
        <span class="fl">BULTOS:</span>
        <span class="fv"></span>
      </div>
    </div>
    <div class="rx-footer-row">
      <div class="rx-fc">
        <span class="fl">TRANSPORTISTA:</span>
        <span class="fv">REBUCRET S.A.${d.patente ? " — " + d.patente : ""}</span>
      </div>
      <div class="rx-fc">
        <span class="fl">VALOR DECLARADO:</span>
        <span class="fv"></span>
      </div>
    </div>
    <div class="rx-footer-row" style="border-bottom:none;">
      <div class="rx-fc" style="border-right:none;">
        <span class="fl">C.U.I.T.:</span>
        <span class="fv">30-71598364-4</span>
      </div>
    </div>
  </div>

</div><!-- /a4 rx -->
</div><!-- /wrap-rx -->

<script>
var currentTab = 'cp';

function showTab(tab) {
  currentTab = tab;
  document.getElementById('wrap-cp').classList.toggle('active', tab === 'cp');
  document.getElementById('wrap-rx').classList.toggle('active', tab === 'rx');
  document.getElementById('tab-cp').classList.toggle('active', tab === 'cp');
  document.getElementById('tab-rx').classList.toggle('active', tab === 'rx');
}

function downloadPDF() {
  var el = document.querySelector('#wrap-' + currentTab + ' .a4');
  var name = currentTab === 'cp' ? 'control-carga' : 'remito-fiscal';
  var opt = {
    margin: 0,
    filename: name + '-${(d.razonSocial || "rebucret").replace(/[^a-zA-Z0-9]/g, '_')}-${d.fecha.replace(/\//g, '-')}.pdf',
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, windowWidth: 794 },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };
  html2pdf().set(opt).from(el).save();
}
</script>
</body>
</html>`
}
