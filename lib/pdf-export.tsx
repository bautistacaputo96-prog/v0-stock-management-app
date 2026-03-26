import jsPDF from "jspdf"

/**
 * CSS styles completos para el iframe - sin oklch
 */
const PDF_STYLES = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { 
    font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
    background: white; 
    color: #111827;
    line-height: 1.5;
    padding: 12px 16px;
  }
  
  /* Typography */
  h1 { font-size: 1.5rem; font-weight: 700; color: #111827; }
  h2 { font-size: 1rem; font-weight: 600; color: #111827; }
  h3 { font-size: 0.875rem; font-weight: 500; color: #374151; }
  p { color: #4b5563; }
  
  /* Gray colors - replace Tailwind oklch */
  .text-gray-900, [class*="text-gray-900"] { color: #111827 !important; }
  .text-gray-800, [class*="text-gray-800"] { color: #1f2937 !important; }
  .text-gray-700, [class*="text-gray-700"] { color: #374151 !important; }
  .text-gray-600, [class*="text-gray-600"] { color: #4b5563 !important; }
  .text-gray-500, [class*="text-gray-500"] { color: #6b7280 !important; }
  .text-gray-400, [class*="text-gray-400"] { color: #9ca3af !important; }
  .text-gray-300, [class*="text-gray-300"] { color: #d1d5db !important; }
  
  .bg-white, [class*="bg-white"] { background-color: #ffffff !important; }
  .bg-gray-50, [class*="bg-gray-50"] { background-color: #f9fafb !important; }
  .bg-gray-100, [class*="bg-gray-100"] { background-color: #f3f4f6 !important; }
  .bg-gray-200, [class*="bg-gray-200"] { background-color: #e5e7eb !important; }
  .bg-gray-900, [class*="bg-gray-900"] { background-color: #111827 !important; color: #ffffff !important; }
  
  .border-gray-200, [class*="border-gray-200"] { border-color: #e5e7eb !important; }
  .border-gray-300, [class*="border-gray-300"] { border-color: #d1d5db !important; }
  
  /* Status colors */
  .text-green-600, [class*="text-green-600"] { color: #16a34a !important; }
  .text-green-500, [class*="text-green-500"] { color: #22c55e !important; }
  .bg-green-100, [class*="bg-green-100"] { background-color: #dcfce7 !important; }
  .bg-green-500, [class*="bg-green-500"] { background-color: #22c55e !important; }
  
  .text-red-600, [class*="text-red-600"] { color: #dc2626 !important; }
  .text-red-500, [class*="text-red-500"] { color: #ef4444 !important; }
  .text-red-700, [class*="text-red-700"] { color: #b91c1c !important; }
  .bg-red-100, [class*="bg-red-100"] { background-color: #fee2e2 !important; }
  .bg-red-600, [class*="bg-red-600"] { background-color: #dc2626 !important; }
  
  .text-yellow-600, [class*="text-yellow-600"] { color: #ca8a04 !important; }
  .text-yellow-500, [class*="text-yellow-500"] { color: #eab308 !important; }
  .bg-yellow-100, [class*="bg-yellow-100"] { background-color: #fef9c3 !important; }
  
  .text-blue-600, [class*="text-blue-600"] { color: #2563eb !important; }
  .bg-blue-500, [class*="bg-blue-500"] { background-color: #3b82f6 !important; }
  
  .text-amber-600, [class*="text-amber-600"] { color: #d97706 !important; }
  .bg-amber-500, [class*="bg-amber-500"] { background-color: #f59e0b !important; }
  
  .text-cyan-600, [class*="text-cyan-600"] { color: #0891b2 !important; }
  .bg-cyan-500, [class*="bg-cyan-500"] { background-color: #06b6d4 !important; }
  
  /* Layout */
  .flex { display: flex; }
  .inline-flex { display: inline-flex; }
  .grid { display: grid; }
  .items-center { align-items: center; }
  .items-start { align-items: start; }
  .justify-center { justify-content: center; }
  .justify-between { justify-content: space-between; }
  .gap-1 { gap: 0.25rem; }
  .gap-2 { gap: 0.5rem; }
  .gap-3 { gap: 0.75rem; }
  .gap-4 { gap: 1rem; }
  .gap-5 { gap: 1.25rem; }
  .gap-6 { gap: 1.5rem; }
  
  /* Spacing */
  .p-2 { padding: 0.5rem; }
  .p-3 { padding: 0.75rem; }
  .p-4 { padding: 1rem; }
  .p-6 { padding: 1.5rem; }
  .px-3 { padding-left: 0.75rem; padding-right: 0.75rem; }
  .px-4 { padding-left: 1rem; padding-right: 1rem; }
  .px-6 { padding-left: 1.5rem; padding-right: 1.5rem; }
  .py-1 { padding-top: 0.25rem; padding-bottom: 0.25rem; }
  .py-2 { padding-top: 0.5rem; padding-bottom: 0.5rem; }
  .py-3 { padding-top: 0.75rem; padding-bottom: 0.75rem; }
  .py-4 { padding-top: 1rem; padding-bottom: 1rem; }
  .pt-4 { padding-top: 1rem; }
  .pt-8 { padding-top: 2rem; }
  .pb-4 { padding-bottom: 1rem; }
  .mb-1 { margin-bottom: 0.25rem; }
  .mb-2 { margin-bottom: 0.5rem; }
  .mb-3 { margin-bottom: 0.75rem; }
  .mb-6 { margin-bottom: 1.5rem; }
  .mb-8 { margin-bottom: 2rem; }
  .mt-0\\.5 { margin-top: 0.125rem; }
  .mt-3 { margin-top: 0.75rem; }
  .mt-8 { margin-top: 2rem; }
  .mt-auto { margin-top: auto; }
  .ml-1 { margin-left: 0.25rem; }
  .ml-4 { margin-left: 1rem; }
  
  /* Sizing */
  .w-2 { width: 0.5rem; }
  .w-8 { width: 2rem; }
  .w-full { width: 100%; }
  .h-2 { height: 0.5rem; }
  .h-4 { height: 1rem; }
  .h-8 { height: 2rem; }
  .h-32 { height: 8rem; }
  .h-64 { height: 16rem; }
  .min-w-0 { min-width: 0; }
  .flex-1 { flex: 1 1 0%; }
  .flex-shrink-0 { flex-shrink: 0; }
  
  /* Grid */
  .grid-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  
  /* Border */
  .border { border: 1px solid #e5e7eb; }
  .border-b { border-bottom: 1px solid #e5e7eb; }
  .rounded { border-radius: 0.25rem; }
  .rounded-md { border-radius: 0.375rem; }
  .rounded-lg { border-radius: 0.5rem; }
  .rounded-full { border-radius: 9999px; }
  .overflow-hidden { overflow: hidden; }
  
  /* Typography */
  .text-xs { font-size: 0.75rem; line-height: 1rem; }
  .text-sm { font-size: 0.875rem; line-height: 1.25rem; }
  .text-base { font-size: 1rem; line-height: 1.5rem; }
  .text-lg { font-size: 1.125rem; line-height: 1.75rem; }
  .text-xl { font-size: 1.25rem; line-height: 1.75rem; }
  .text-2xl { font-size: 1.5rem; line-height: 2rem; }
  .font-medium { font-weight: 500; }
  .font-semibold { font-weight: 600; }
  .font-bold { font-weight: 700; }
  .text-center { text-align: center; }
  
  /* Lists */
  .list-disc { list-style-type: disc; }
  .list-inside { list-style-position: inside; }
  .space-y-1 > * + * { margin-top: 0.25rem; }
  .space-y-1\\.5 > * + * { margin-top: 0.375rem; }
  .space-y-5 > * + * { margin-top: 1.25rem; }
  
  /* Tables */
  table { border-collapse: collapse; width: 100%; }
  th { text-align: left; }
  td, th { padding: 0.625rem 1rem; }
  thead { background-color: #f9fafb; }
  
  /* SVG */
  svg { display: inline-block; vertical-align: middle; }
  
  /* Page break */
  .pdf-page-break { page-break-before: always; padding-top: 24px; }
`

/**
 * Exporta un elemento HTML a PDF capturando su contenido visual
 * Usa un iframe aislado con estilos propios para evitar oklch
 * Detecta páginas por minHeight: '297mm' y pageBreakBefore: 'always'
 */
export async function exportElementToPDF(element: HTMLElement, filename: string) {
  const html2canvas = (await import("html2canvas")).default
  
  // A4 dimensions in mm
  const A4_WIDTH_MM = 210
  const A4_HEIGHT_MM = 297
  
  // A4 dimensions in pixels at 96 DPI: 794 x 1123 px
  const A4_WIDTH_PX = 794
  const A4_HEIGHT_PX = 1123
  
  // Buscar páginas definidas dentro del elemento (divs con minHeight: 297mm o pageBreakBefore: always)
  const pages = element.querySelectorAll('[style*="297mm"], [style*="page-break-before"]')
  const hasMultiplePages = pages.length > 1
  
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
  const margin = 3 // 3mm de margen reducido para maximizar espacio
  const usableWidth = A4_WIDTH_MM - (margin * 2)
  const usableHeight = A4_HEIGHT_MM - (margin * 2)
  
  if (hasMultiplePages) {
    // Renderizar cada página por separado para mejor calidad
    for (let i = 0; i < pages.length; i++) {
      const pageElement = pages[i] as HTMLElement
      
      if (i > 0) pdf.addPage()
      
      // Crear iframe para esta página
      const iframe = document.createElement("iframe")
      iframe.style.cssText = `position:absolute;left:-9999px;top:0;width:${A4_WIDTH_PX}px;height:${A4_HEIGHT_PX + 50}px;border:none;`
      document.body.appendChild(iframe)
      
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document
      if (!iframeDoc) {
        document.body.removeChild(iframe)
        continue
      }
      
      // Escribir contenido de esta página
      iframeDoc.open()
      iframeDoc.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <style>
            ${PDF_STYLES}
            body { 
              width: ${A4_WIDTH_PX - 20}px !important; 
              max-width: ${A4_WIDTH_PX - 20}px !important;
              height: ${A4_HEIGHT_PX}px !important;
              padding: 10px !important;
              margin: 0 !important;
              overflow: hidden !important;
            }
          </style>
        </head>
        <body>${pageElement.outerHTML}</body>
        </html>
      `)
      iframeDoc.close()
      
      await new Promise(resolve => setTimeout(resolve, 200))
      
      const canvas = await html2canvas(iframeDoc.body, {
        scale: 2.5,
        useCORS: true,
        logging: false,
        backgroundColor: "#ffffff",
        width: A4_WIDTH_PX,
        height: A4_HEIGHT_PX,
      })
      
      document.body.removeChild(iframe)
      
      const imgData = canvas.toDataURL("image/png")
      pdf.addImage(imgData, "PNG", margin, margin, usableWidth, usableHeight)
    }
  } else {
    // Comportamiento original para contenido sin páginas definidas
    const htmlContent = element.outerHTML
    
    const iframe = document.createElement("iframe")
    iframe.style.cssText = `position:absolute;left:-9999px;top:0;width:${A4_WIDTH_PX}px;height:2000px;border:none;`
    document.body.appendChild(iframe)
    
    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document
    if (!iframeDoc) {
      document.body.removeChild(iframe)
      throw new Error("Could not access iframe document")
    }
    
    iframeDoc.open()
    iframeDoc.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          ${PDF_STYLES}
          body { 
            width: ${A4_WIDTH_PX - 40}px !important; 
            max-width: ${A4_WIDTH_PX - 40}px !important;
            padding: 20px !important;
            margin: 0 !important;
          }
        </style>
      </head>
      <body>${htmlContent}</body>
      </html>
    `)
    iframeDoc.close()
    
    await new Promise(resolve => setTimeout(resolve, 300))
    
    const bodyHeight = iframeDoc.body.scrollHeight
    iframe.style.height = `${bodyHeight + 50}px`
    
    await new Promise(resolve => setTimeout(resolve, 100))
    
    const canvas = await html2canvas(iframeDoc.body, {
      scale: 2.5,
      useCORS: true,
      logging: false,
      backgroundColor: "#ffffff",
      width: A4_WIDTH_PX,
    })
    
    document.body.removeChild(iframe)

    const imgData = canvas.toDataURL("image/png")
    const imgWidth = canvas.width
    const imgHeight = canvas.height
    
    const ratio = usableWidth / (imgWidth / 2.5)
    const scaledImgHeight = (imgHeight / 2.5) * ratio

    if (scaledImgHeight <= usableHeight) {
      pdf.addImage(imgData, "PNG", margin, margin, usableWidth, scaledImgHeight)
    } else {
      const pageCanvas = document.createElement("canvas")
      const ctx = pageCanvas.getContext("2d")
      if (!ctx) {
        pdf.addImage(imgData, "PNG", margin, margin, usableWidth, scaledImgHeight)
      } else {
        const pageHeightPx = (usableHeight / ratio) * 2.5
        let remainingHeight = imgHeight
        let page = 0

        while (remainingHeight > 0) {
          if (page > 0) pdf.addPage()

          const sliceHeight = Math.min(pageHeightPx, remainingHeight)
          pageCanvas.width = imgWidth
          pageCanvas.height = sliceHeight

          ctx.fillStyle = "#ffffff"
          ctx.fillRect(0, 0, imgWidth, sliceHeight)
          ctx.drawImage(canvas, 0, page * pageHeightPx, imgWidth, sliceHeight, 0, 0, imgWidth, sliceHeight)

          const sliceRatio = usableWidth / (imgWidth / 2.5)
          pdf.addImage(pageCanvas.toDataURL("image/png"), "PNG", margin, margin, usableWidth, (sliceHeight / 2.5) * sliceRatio)

          remainingHeight -= pageHeightPx
          page++
        }
      }
    }
  }

  pdf.save(filename)
}
