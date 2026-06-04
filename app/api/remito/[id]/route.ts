import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { PDFDocument, StandardFonts, rgb } from "pdf-lib"

// ── Supabase ─────────────────────────────────────────────────────────────────
function sb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

// ── Helpers de coordenadas ────────────────────────────────────────────────────
// pdf-lib: (0,0) = esquina inferior izquierda, unidad = puntos (1mm = 2.8346pt)
const pt  = (mm: number) => mm * 2.8346
const top = (mmFromTop: number, pageH: number) => pageH - pt(mmFromTop)

// ── Carga la plantilla desde public/ ─────────────────────────────────────────
async function loadTemplate(name: string): Promise<ArrayBuffer> {
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"
  const res = await fetch(`${baseUrl}/templates/${name}`)
  if (!res.ok) throw new Error(`Template ${name} not found`)
  return res.arrayBuffer()
}

// ══════════════════════════════════════════════════════════════════════════════
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { searchParams } = new URL(req.url)
  const doc = searchParams.get("doc") // "control" | "fiscal" | null (preview)

  // ── Si no hay doc: devuelve página HTML de preview ─────────────────────────
  if (!doc) {
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXT_PUBLIC_SITE_URL || ""
    const html = buildPreviewPage(id, baseUrl)
    return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } })
  }

  // ── Obtener datos del despacho ─────────────────────────────────────────────
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

  const data = {
    fecha,
    razonSocial:      c.razon_social       || c.name || "",
    nombreCliente:    c.name               || "",
    direccion:        c.direccion_fiscal   || "",
    cp:               c.cp                || "",
    localidadCliente: c.localidad_cliente  || "",
    provincia:        c.provincia          || "",
    condIva:          c.cond_iva           || "",
    condPago:         c.cond_pago          || "",
    cuit:             c.cuit               || "",
    nPedido:          "",
    remito,
    m3,
    productoCode,
    obraLocalidad:    s.localidad          || "",
    obraDireccion:    s.address            || "",
    patente:          m.license_plate      || "",
    observaciones:    row.observations || row.notes || "",
  }

  try {
    const pdfBytes = doc === "control"
      ? await fillControlPanel(data)
      : await fillRemitoFiscal(data)

    const filename = doc === "control"
      ? `control-carga-${fecha.replace(/\//g, "-")}.pdf`
      : `remito-fiscal-${fecha.replace(/\//g, "-")}.pdf`

    return new NextResponse(pdfBytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
      },
    })
  } catch (e) {
    console.error("PDF error:", e)
    return new NextResponse("Error generando PDF: " + String(e), { status: 500 })
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// DOCUMENT 1: Control de Carga
// ══════════════════════════════════════════════════════════════════════════════
async function fillControlPanel(data: Record<string, string>): Promise<Uint8Array> {
  const templateBytes = await loadTemplate("control-panel.pdf")
  const pdfDoc = await PDFDocument.load(templateBytes)
  const page   = pdfDoc.getPages()[0]
  const font   = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const H      = page.getHeight()
  const W      = page.getWidth()
  const BLACK  = rgb(0, 0, 0)
  const WHITE  = rgb(1, 1, 1)

  // Tamaño de fuente estándar del documento
  const FS = 8.5

  // ── Función para escribir texto con caja blanca sobre el dato existente ──
  const write = (
    text: string,
    xMm: number,
    yFromTopMm: number,
    opts?: { size?: number; boxW?: number; boxH?: number }
  ) => {
    if (!text) return
    const x   = pt(xMm)
    const y   = top(yFromTopMm, H)
    const sz  = opts?.size ?? FS
    const bW  = opts?.boxW ?? 90  // ancho caja blanca (pts)
    const bH  = opts?.boxH ?? 9   // alto caja blanca (pts)

    // Caja blanca para tapar el dato del ejemplo
    page.drawRectangle({ x: x - 1, y: y - 1.5, width: bW, height: bH, color: WHITE, borderWidth: 0 })
    // Texto nuevo
    page.drawText(text, { x, y, size: sz, font, color: BLACK })
  }

  // ── Fecha (arriba a la derecha) ──────────────────────────────────────────
  write(data.fecha, 148, 24, { boxW: 45, boxH: 9 })

  // ── Columna IZQUIERDA ────────────────────────────────────────────────────
  // Posiciones: x = después del label pre-impreso, y = fila correspondiente
  write(data.razonSocial,   27,  53, { boxW: 80 })  // R. Social:
  write(data.direccion,     27,  61, { boxW: 80 })  // Direccion:
  write(data.cp,            15,  69, { boxW: 35 })  // CP:
  write(data.condIva,       28,  77, { boxW: 80 })  // Cond IVA:
  write(data.nPedido,       20,  85, { boxW: 80 })  // N Ped:
  write(data.condPago,      28,  93, { boxW: 80 })  // Cond Pago:

  // ── Columna DERECHA ──────────────────────────────────────────────────────
  write(data.nombreCliente,    120, 53, { boxW: 80 })  // Cliente:
  write(data.localidadCliente, 120, 61, { boxW: 80 })  // Localidad:
  write(data.provincia,        118, 69, { boxW: 80 })  // Provincia:
  write(data.cuit,             118, 77, { boxW: 80 })  // CUIT:
  // Fila 5 derecha: vacía
  write(data.remito ? "0099-" + data.remito : "", 130, 93, { boxW: 65 })  // RM2:

  // ── Producto ─────────────────────────────────────────────────────────────
  write(data.m3,           10,  108, { size: 9, boxW: 20, boxH: 10 })
  write(data.productoCode, 25,  108, { size: 9, boxW: 130, boxH: 10 })

  // ── Transporte (parte inferior) ──────────────────────────────────────────
  write(data.patente,      51,  272, { boxW: 80 })
  write(data.obraLocalidad,53,  278, { boxW: 80 })
  write(data.obraDireccion,51,  284, { boxW: 80 })

  return pdfDoc.save()
}

// ══════════════════════════════════════════════════════════════════════════════
// DOCUMENT 2: Remito Fiscal (ARCA Remito X)
// ══════════════════════════════════════════════════════════════════════════════
async function fillRemitoFiscal(data: Record<string, string>): Promise<Uint8Array> {
  const templateBytes = await loadTemplate("remito-fiscal.pdf")
  const pdfDoc = await PDFDocument.load(templateBytes)
  const page   = pdfDoc.getPages()[0]
  const font   = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const fontB  = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const H      = page.getHeight()
  const BLACK  = rgb(0, 0, 0)

  const FS = 8.5

  const write = (
    text: string,
    xMm: number,
    yFromTopMm: number,
    opts?: { size?: number; bold?: boolean }
  ) => {
    if (!text) return
    page.drawText(text, {
      x:    pt(xMm),
      y:    top(yFromTopMm, H),
      size: opts?.size ?? FS,
      font: opts?.bold ? fontB : font,
      color: BLACK,
    })
  }

  // ── FECHA ─────────────────────────────────────────────────────────────────
  // La plantilla dice "FECHA" y el valor va a la derecha
  write(data.fecha, 148, 57, { size: 8.5 })

  // ── Número de remito (el campo "Nº 00002-") ──────────────────────────────
  if (data.remito) {
    write(data.remito, 130, 49, { size: 10, bold: true })
  }

  // ── Área del destinatario (zona en blanco grande) ─────────────────────────
  const destX = 12
  let destY = 82
  const lineH = 7

  if (data.razonSocial) {
    write(data.razonSocial, destX, destY, { bold: true, size: 9 })
    destY += lineH
  }
  if (data.direccion) {
    write(data.direccion, destX, destY)
    destY += lineH
  }
  if (data.localidadCliente || data.cp) {
    const loc = [data.localidadCliente, data.cp ? `(${data.cp})` : ""].filter(Boolean).join(" ")
    write(loc + (data.provincia ? ` — ${data.provincia}` : ""), destX, destY)
    destY += lineH
  }
  if (data.cuit) {
    write(`CUIT: ${data.cuit}`, destX, destY)
    destY += lineH
  }

  // ── ITEMS TABLE ───────────────────────────────────────────────────────────
  const itemY = 158
  write(data.m3 + " m³",  12,  itemY, { size: 9, bold: true })
  write(data.productoCode, 38, itemY, { size: 9 })

  // Sub-líneas en el item
  if (data.obraDireccion) {
    write(`Dir. entrega: ${data.obraDireccion}`, 38, itemY + 6, { size: 7.5 })
  }
  if (data.patente) {
    write(`Camión: ${data.patente}`, 38, itemY + 12, { size: 7.5 })
  }

  // ── FOOTER ────────────────────────────────────────────────────────────────
  if (data.observaciones) {
    write(data.observaciones, 48, 251)
  }
  write(`REBUCRET S.A.${data.patente ? " — " + data.patente : ""}`, 52, 259)
  write("30-71598364-4", 28, 267)

  return pdfDoc.save()
}

// ══════════════════════════════════════════════════════════════════════════════
// PÁGINA DE PREVIEW HTML
// ══════════════════════════════════════════════════════════════════════════════
function buildPreviewPage(id: string, baseUrl: string) {
  const controlUrl = `/api/remito/${id}?doc=control`
  const fiscalUrl  = `/api/remito/${id}?doc=fiscal`

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Documentos del Despacho</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: system-ui, sans-serif; background: #1e293b; height: 100vh; display: flex; flex-direction: column; }
.toolbar {
  background: #0f172a; padding: 10px 16px;
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  border-bottom: 1px solid #334155;
}
.title { color: #f1f5f9; font-size: 14px; font-weight: 600; flex: 1; }
.tab { background: transparent; border: 1.5px solid #475569; color: #94a3b8;
  padding: 6px 14px; border-radius: 6px; font-size: 13px; cursor: pointer; }
.tab.active { background: #f1f5f9; color: #0f172a; border-color: #f1f5f9; font-weight: 700; }
.btn { padding: 7px 14px; border-radius: 6px; font-size: 13px; cursor: pointer; border: none;
  font-weight: 600; text-decoration: none; display: inline-flex; align-items: center; gap: 5px; }
.btn-blue { background: #2563eb; color: white; }
.btn-green { background: #16a34a; color: white; }
.frame-container { flex: 1; display: none; }
.frame-container.active { display: block; }
iframe { width: 100%; height: 100%; border: none; }
</style>
</head>
<body>
<div class="toolbar">
  <span class="title">Documentos del Despacho</span>
  <button class="tab active" id="t1" onclick="show('control')">📋 Control de Carga</button>
  <button class="tab"        id="t2" onclick="show('fiscal')">🧾 Remito Fiscal (ARCA)</button>
  <a class="btn btn-blue"   id="dl" href="${controlUrl}" download>📄 Descargar PDF</a>
  <a class="btn btn-green"  id="pr" href="${controlUrl}" target="_blank">🖨 Abrir para imprimir</a>
</div>
<div class="frame-container active" id="f-control">
  <iframe src="${controlUrl}" id="frame-control"></iframe>
</div>
<div class="frame-container" id="f-fiscal">
  <iframe src="${fiscalUrl}" id="frame-fiscal" data-loaded="false"></iframe>
</div>
<script>
var current = 'control';
var urls = { control: '${controlUrl}', fiscal: '${fiscalUrl}' };

function show(doc) {
  current = doc;
  ['control','fiscal'].forEach(function(d) {
    document.getElementById('f-' + d).classList.toggle('active', d === doc);
    document.getElementById('t' + (d === 'control' ? '1' : '2')).classList.toggle('active', d === doc);
  });
  document.getElementById('dl').href = urls[doc];
  document.getElementById('dl').download = doc + '-despacho.pdf';
  document.getElementById('pr').href = urls[doc];
  // Lazy load fiscal iframe
  var iframe = document.getElementById('frame-' + doc);
  if (iframe.dataset.loaded === 'false') {
    iframe.src = urls[doc];
    iframe.dataset.loaded = 'true';
  }
}
</script>
</body>
</html>`
}
