"use client"

import { forwardRef } from "react"

const PIPE_DIAMETERS = [300, 400, 500, 600, 800, 1000, 1200]

interface PipeQualityData {
  byDiameter: Record<number, { first: number; second: number; broken: number; total: number }>
  byReason: { reason: string; category: string; total: number; byDiameter: Record<number, number> }[]
  totals: { first: number; second: number; broken: number; total: number }
}

// Datos de producción para calcular índices sobre toneladas
interface ProductionData {
  canosPlayaTn: number        // Toneladas de caños a playa (simples + armado)
  canosPlayaUnits: number     // Unidades de caños a playa
  segundaTn: number           // Toneladas de segunda calidad
  rotosCalidadTn: number      // Toneladas de rotos en calidad
  cajonesDesperdicioTn: number // Toneladas de cajones de desperdicio
  totalProducidoTn: number    // Total = caños a playa + cajones desperdicio
  // Índices calculados sobre toneladas
  qualityIndex: number        // (primeraTn / totalProducidoTn) * 100
  secondIndex: number         // (segundaTn / totalProducidoTn) * 100
  brokenIndex: number         // (rotosCalidadTn / totalProducidoTn) * 100
  scrapIndex: number          // (cajonesDesperdicioTn / totalProducidoTn) * 100
}

interface PipeQualityExecutiveReportProps {
  fromDate: string
  toDate: string
  reportData: PipeQualityData
  controlsCount: number
  productionData?: ProductionData  // Opcional para mantener compatibilidad
}

const MONTHS = [
  "", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
]

export const PipeQualityExecutiveReport = forwardRef<HTMLDivElement, PipeQualityExecutiveReportProps>(
  function PipeQualityExecutiveReport({ fromDate, toDate, reportData, controlsCount, productionData }, ref) {
    if (reportData.totals.total === 0 && !productionData) return null

    // Cálculos sobre unidades (para compatibilidad con módulo de calidad)
    const qualityIndexUnits = reportData.totals.total > 0 ? (reportData.totals.first / reportData.totals.total) * 100 : 0
    const secondPercentUnits = reportData.totals.total > 0 ? (reportData.totals.second / reportData.totals.total) * 100 : 0
    const brokenPercentUnits = reportData.totals.total > 0 ? (reportData.totals.broken / reportData.totals.total) * 100 : 0
    
    // Si hay datos de producción, usar índices sobre toneladas
    const hasProductionData = !!productionData
    const qualityIndex = hasProductionData ? productionData.qualityIndex : qualityIndexUnits
    const secondPercent = hasProductionData ? productionData.secondIndex : secondPercentUnits
    const brokenPercent = hasProductionData ? productionData.brokenIndex : brokenPercentUnits
    const scrapPercent = hasProductionData ? productionData.scrapIndex : 0

    // Estado general
    const estadoGeneral = qualityIndex >= 95 ? "Excelente" : qualityIndex >= 90 ? "Aceptable" : "En Revisión"
    const estadoBgColor = qualityIndex >= 95 ? "#DC2626" : qualityIndex >= 90 ? "#374151" : "#9ca3af"

    // Formatear período
    const fromDateObj = new Date(fromDate + "T12:00:00")
    const toDateObj = new Date(toDate + "T12:00:00")
    const periodoTexto = fromDateObj.getMonth() === toDateObj.getMonth() && fromDateObj.getFullYear() === toDateObj.getFullYear()
      ? `${MONTHS[fromDateObj.getMonth() + 1]} ${fromDateObj.getFullYear()}`
      : `${fromDateObj.toLocaleDateString("es-AR")} - ${toDateObj.toLocaleDateString("es-AR")}`

    // Top 5 defectos
    const topDefects = reportData.byReason.slice(0, 5)

    // Función para estado de indicadores
    const getEstado = (valor: number, objetivo: number, invertido = false) => {
      const pct = invertido ? (objetivo / valor) * 100 : (valor / objetivo) * 100
      if (pct >= 95) return { texto: "Cumple", color: "#DC2626" }
      if (pct >= 85) return { texto: "Aceptable", color: "#374151" }
      return { texto: "En revisión", color: "#9ca3af" }
    }

    return (
      <div
        ref={ref}
        style={{
          width: '210mm',
          minHeight: '297mm',
          padding: '12mm 18mm',
          backgroundColor: '#ffffff',
          fontFamily: 'Arial, Helvetica, sans-serif',
          fontSize: '10pt',
          color: '#1f2937',
          lineHeight: '1.5',
        }}
      >
        {/* Encabezado */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '6mm' }}>
          <tbody>
            <tr>
              <td style={{ width: '25%', verticalAlign: 'middle' }}>
                <img 
                  src="/concretus-logo.png" 
                  alt="Concretus" 
                  style={{ height: '20mm', objectFit: 'contain' }}
                  crossOrigin="anonymous"
                />
              </td>
              <td style={{ width: '50%', textAlign: 'center', verticalAlign: 'middle' }}>
                <div style={{ fontSize: '14pt', fontWeight: 'bold', color: '#111827', letterSpacing: '0.5px' }}>
                  INFORME DE CALIDAD
                </div>
                <div style={{ fontSize: '9pt', color: '#6b7280', marginTop: '1mm' }}>
                  Control de Producción de Caños
                </div>
              </td>
              <td style={{ width: '25%', textAlign: 'right', verticalAlign: 'middle' }}>
                <div style={{ fontSize: '9pt', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Período</div>
                <div style={{ fontSize: '12pt', fontWeight: 'bold', color: '#111827' }}>
                  {periodoTexto}
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        <div style={{ borderBottom: '2px solid #DC2626', marginBottom: '6mm' }} />

        {/* Estado General y KPI Principal */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '6mm' }}>
          <tbody>
            <tr>
              <td style={{ width: '50%', padding: '4mm', backgroundColor: '#f9fafb', border: '1px solid #e5e7eb', verticalAlign: 'top' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: '8pt', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Índice de Calidad</div>
                    <div style={{ fontSize: '22pt', fontWeight: 'bold', color: '#111827' }}>{qualityIndex.toFixed(1)}%</div>
                    <div style={{ fontSize: '8pt', color: '#6b7280' }}>Primera Calidad / Total</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ 
                      display: 'inline-block',
                      padding: '1.5mm 4mm', 
                      backgroundColor: '#374151',
                      color: '#ffffff',
                      fontSize: '9pt',
                      fontWeight: '600',
                    }}>
                      {controlsCount} planillas
                    </div>
                    <div style={{ fontSize: '7pt', color: '#6b7280', marginTop: '1mm' }}>procesadas</div>
                  </div>
                </div>
                <div style={{ 
                  display: 'inline-block',
                  padding: '1.5mm 4mm', 
                  backgroundColor: estadoBgColor,
                  color: '#ffffff',
                  fontSize: '8pt',
                  fontWeight: '500',
                  marginTop: '2mm'
                }}>
                  {estadoGeneral}
                </div>
              </td>
              <td style={{ width: '50%', padding: '4mm', backgroundColor: '#DC2626', border: '1px solid #DC2626', verticalAlign: 'top' }}>
                <div style={{ fontSize: '8pt', color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Producción Total</div>
                <div style={{ fontSize: '28pt', fontWeight: 'bold', color: '#ffffff' }}>{reportData.totals.total.toLocaleString()}</div>
                <div style={{ fontSize: '10pt', color: 'rgba(255,255,255,0.9)', fontWeight: '500' }}>unidades controladas</div>
                <div style={{ fontSize: '8pt', color: 'rgba(255,255,255,0.7)', marginTop: '2mm' }}>
                  Primera: {reportData.totals.first.toLocaleString()} | Segunda: {reportData.totals.second.toLocaleString()} | Rotos: {reportData.totals.broken.toLocaleString()}
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* Índices sobre Toneladas (solo si hay datos de producción) */}
        {hasProductionData && productionData && (
          <>
            <div style={{ fontSize: '9pt', fontWeight: 'bold', color: '#111827', marginBottom: '3mm', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid #e5e7eb', paddingBottom: '2mm' }}>
              Índices sobre Toneladas Producidas
            </div>
            
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '6mm' }}>
              <tbody>
                <tr>
                  <td style={{ width: '25%', padding: '3mm', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', textAlign: 'center' }}>
                    <div style={{ fontSize: '8pt', color: '#166534', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Índice Primera</div>
                    <div style={{ fontSize: '18pt', fontWeight: 'bold', color: '#166534' }}>{productionData.qualityIndex.toFixed(2)}%</div>
                    <div style={{ fontSize: '8pt', color: '#166534' }}>{(productionData.canosPlayaTn - productionData.segundaTn - productionData.rotosCalidadTn).toFixed(2)} Tn</div>
                  </td>
                  <td style={{ width: '25%', padding: '3mm', backgroundColor: '#fefce8', border: '1px solid #fef08a', textAlign: 'center' }}>
                    <div style={{ fontSize: '8pt', color: '#a16207', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Índice Segunda</div>
                    <div style={{ fontSize: '18pt', fontWeight: 'bold', color: '#a16207' }}>{productionData.secondIndex.toFixed(2)}%</div>
                    <div style={{ fontSize: '8pt', color: '#a16207' }}>{productionData.segundaTn.toFixed(2)} Tn</div>
                  </td>
                  <td style={{ width: '25%', padding: '3mm', backgroundColor: '#fef2f2', border: '1px solid #fecaca', textAlign: 'center' }}>
                    <div style={{ fontSize: '8pt', color: '#dc2626', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Índice Rotura</div>
                    <div style={{ fontSize: '18pt', fontWeight: 'bold', color: '#dc2626' }}>{productionData.brokenIndex.toFixed(2)}%</div>
                    <div style={{ fontSize: '8pt', color: '#dc2626' }}>{productionData.rotosCalidadTn.toFixed(2)} Tn</div>
                  </td>
                  <td style={{ width: '25%', padding: '3mm', backgroundColor: '#fef2f2', border: '1px solid #fecaca', textAlign: 'center' }}>
                    <div style={{ fontSize: '8pt', color: '#dc2626', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Cajones Desperdicio</div>
                    <div style={{ fontSize: '18pt', fontWeight: 'bold', color: '#dc2626' }}>{productionData.scrapIndex.toFixed(2)}%</div>
                    <div style={{ fontSize: '8pt', color: '#dc2626' }}>{productionData.cajonesDesperdicioTn.toFixed(2)} Tn</div>
                  </td>
                </tr>
              </tbody>
            </table>
            
            <div style={{ fontSize: '7pt', color: '#6b7280', marginBottom: '4mm', padding: '2mm', backgroundColor: '#f9fafb', border: '1px solid #e5e7eb' }}>
              <strong>Fórmulas:</strong> Primera = Caños a playa - Segunda - Rotos calidad = {(productionData.canosPlayaTn - productionData.segundaTn - productionData.rotosCalidadTn).toFixed(2)} Tn | 
              Total Producido = Caños a playa + Cajones desperdicio = {productionData.totalProducidoTn.toFixed(2)} Tn
            </div>
          </>
        )}

        {/* Indicadores de Calidad (sobre unidades) */}
        <div style={{ fontSize: '9pt', fontWeight: 'bold', color: '#111827', marginBottom: '3mm', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid #e5e7eb', paddingBottom: '2mm' }}>
          Indicadores de Calidad {hasProductionData ? '(sobre unidades)' : ''}
        </div>
        
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '6mm', fontSize: '9pt' }}>
          <thead>
            <tr style={{ backgroundColor: '#f3f4f6' }}>
              <th style={{ padding: '2.5mm 3mm', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #d1d5db', color: '#374151' }}>Indicador</th>
              <th style={{ padding: '2.5mm 3mm', textAlign: 'center', fontWeight: '600', borderBottom: '1px solid #d1d5db', color: '#374151' }}>Resultado</th>
              <th style={{ padding: '2.5mm 3mm', textAlign: 'center', fontWeight: '600', borderBottom: '1px solid #d1d5db', color: '#374151' }}>Objetivo</th>
              <th style={{ padding: '2.5mm 3mm', textAlign: 'center', fontWeight: '600', borderBottom: '1px solid #d1d5db', color: '#374151' }}>Estado</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ padding: '2.5mm 3mm', borderBottom: '1px solid #e5e7eb' }}>Índice de Calidad (Primera)</td>
              <td style={{ padding: '2.5mm 3mm', textAlign: 'center', borderBottom: '1px solid #e5e7eb', fontWeight: '600' }}>{qualityIndex.toFixed(1)}%</td>
              <td style={{ padding: '2.5mm 3mm', textAlign: 'center', borderBottom: '1px solid #e5e7eb', color: '#6b7280' }}>≥95%</td>
              <td style={{ padding: '2.5mm 3mm', textAlign: 'center', borderBottom: '1px solid #e5e7eb', color: getEstado(qualityIndex, 95).color }}>{getEstado(qualityIndex, 95).texto}</td>
            </tr>
            <tr style={{ backgroundColor: '#fafafa' }}>
              <td style={{ padding: '2.5mm 3mm', borderBottom: '1px solid #e5e7eb' }}>Segunda Calidad</td>
              <td style={{ padding: '2.5mm 3mm', textAlign: 'center', borderBottom: '1px solid #e5e7eb', fontWeight: '600' }}>{secondPercent.toFixed(1)}%</td>
              <td style={{ padding: '2.5mm 3mm', textAlign: 'center', borderBottom: '1px solid #e5e7eb', color: '#6b7280' }}>≤3%</td>
              <td style={{ padding: '2.5mm 3mm', textAlign: 'center', borderBottom: '1px solid #e5e7eb', color: secondPercent <= 3 ? '#DC2626' : secondPercent <= 5 ? '#374151' : '#9ca3af' }}>{secondPercent <= 3 ? 'Cumple' : secondPercent <= 5 ? 'Aceptable' : 'En revisión'}</td>
            </tr>
            <tr>
              <td style={{ padding: '2.5mm 3mm', borderBottom: '1px solid #e5e7eb' }}>Rotura</td>
              <td style={{ padding: '2.5mm 3mm', textAlign: 'center', borderBottom: '1px solid #e5e7eb', fontWeight: '600' }}>{brokenPercent.toFixed(1)}%</td>
              <td style={{ padding: '2.5mm 3mm', textAlign: 'center', borderBottom: '1px solid #e5e7eb', color: '#6b7280' }}>≤2%</td>
              <td style={{ padding: '2.5mm 3mm', textAlign: 'center', borderBottom: '1px solid #e5e7eb', color: brokenPercent <= 2 ? '#DC2626' : brokenPercent <= 5 ? '#374151' : '#9ca3af' }}>{brokenPercent <= 2 ? 'Cumple' : brokenPercent <= 5 ? 'Aceptable' : 'En revisión'}</td>
            </tr>
          </tbody>
        </table>

        {/* Producción por Diámetro - Ordenado por índice de calidad (peor primero) */}
        <div style={{ fontSize: '9pt', fontWeight: 'bold', color: '#111827', marginBottom: '3mm', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid #e5e7eb', paddingBottom: '2mm' }}>
          Producción por Diámetro (ordenado por índice de calidad)
        </div>
        
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '6mm', fontSize: '8pt' }}>
          <thead>
            <tr style={{ backgroundColor: '#f3f4f6' }}>
              <th style={{ padding: '2mm', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #d1d5db', color: '#374151' }}>Diámetro</th>
              <th style={{ padding: '2mm', textAlign: 'center', fontWeight: '600', borderBottom: '1px solid #d1d5db', color: '#16a34a' }}>Primera</th>
              <th style={{ padding: '2mm', textAlign: 'center', fontWeight: '600', borderBottom: '1px solid #d1d5db', color: '#d97706' }}>Segunda</th>
              <th style={{ padding: '2mm', textAlign: 'center', fontWeight: '600', borderBottom: '1px solid #d1d5db', color: '#dc2626' }}>Rotos</th>
              <th style={{ padding: '2mm', textAlign: 'center', fontWeight: '600', borderBottom: '1px solid #d1d5db', color: '#374151' }}>Total</th>
              <th style={{ padding: '2mm', textAlign: 'center', fontWeight: '600', borderBottom: '1px solid #d1d5db', color: '#d97706' }}>% Seg.</th>
              <th style={{ padding: '2mm', textAlign: 'center', fontWeight: '600', borderBottom: '1px solid #d1d5db', color: '#dc2626' }}>% Rot.</th>
              <th style={{ padding: '2mm', textAlign: 'center', fontWeight: '600', borderBottom: '1px solid #d1d5db', color: '#16a34a' }}>Calidad</th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              // Sort diameters by quality index (lowest first = worst first)
              const sortedDiameters = PIPE_DIAMETERS
                .map(d => {
                  const data = reportData.byDiameter[d]
                  if (!data || data.total === 0) return null
                  const qIndex = (data.first / data.total) * 100
                  return { diameter: d, data, qualityIndex: qIndex }
                })
                .filter(Boolean)
                .sort((a, b) => a!.qualityIndex - b!.qualityIndex) as { diameter: number; data: { first: number; second: number; broken: number; total: number }; qualityIndex: number }[]

              return sortedDiameters.map((item, idx) => {
                const { diameter: d, data, qualityIndex: cal } = item
                const seg = (data.second / data.total) * 100
                const rot = (data.broken / data.total) * 100
                const bgColor = cal < 90 ? '#fef2f2' : cal < 95 ? '#fefce8' : '#f0fdf4'
                return (
                  <tr key={d} style={{ backgroundColor: idx % 2 === 1 ? '#fafafa' : bgColor }}>
                    <td style={{ padding: '2mm', borderBottom: '1px solid #e5e7eb', fontWeight: '500' }}>CC{d}</td>
                    <td style={{ padding: '2mm', textAlign: 'center', borderBottom: '1px solid #e5e7eb', color: '#16a34a' }}>{data.first}</td>
                    <td style={{ padding: '2mm', textAlign: 'center', borderBottom: '1px solid #e5e7eb', color: '#d97706' }}>{data.second}</td>
                    <td style={{ padding: '2mm', textAlign: 'center', borderBottom: '1px solid #e5e7eb', color: '#dc2626' }}>{data.broken}</td>
                    <td style={{ padding: '2mm', textAlign: 'center', borderBottom: '1px solid #e5e7eb', fontWeight: '600' }}>{data.total}</td>
                    <td style={{ padding: '2mm', textAlign: 'center', borderBottom: '1px solid #e5e7eb', color: seg > 5 ? '#d97706' : '#6b7280' }}>{seg.toFixed(1)}%</td>
                    <td style={{ padding: '2mm', textAlign: 'center', borderBottom: '1px solid #e5e7eb', color: rot > 5 ? '#dc2626' : '#6b7280' }}>{rot.toFixed(1)}%</td>
                    <td style={{ 
                      padding: '2mm', 
                      textAlign: 'center', 
                      borderBottom: '1px solid #e5e7eb', 
                      fontWeight: '600', 
                      color: cal >= 95 ? '#16a34a' : cal >= 90 ? '#d97706' : '#dc2626',
                      backgroundColor: cal < 90 ? '#fee2e2' : cal < 95 ? '#fef9c3' : '#dcfce7'
                    }}>{cal.toFixed(1)}%</td>
                  </tr>
                )
              })
            })()}
            <tr style={{ backgroundColor: '#f3f4f6', fontWeight: '600' }}>
              <td style={{ padding: '2mm', borderTop: '2px solid #d1d5db' }}>TOTAL</td>
              <td style={{ padding: '2mm', textAlign: 'center', borderTop: '2px solid #d1d5db', color: '#16a34a' }}>{reportData.totals.first}</td>
              <td style={{ padding: '2mm', textAlign: 'center', borderTop: '2px solid #d1d5db', color: '#d97706' }}>{reportData.totals.second}</td>
              <td style={{ padding: '2mm', textAlign: 'center', borderTop: '2px solid #d1d5db', color: '#dc2626' }}>{reportData.totals.broken}</td>
              <td style={{ padding: '2mm', textAlign: 'center', borderTop: '2px solid #d1d5db' }}>{reportData.totals.total}</td>
              <td style={{ padding: '2mm', textAlign: 'center', borderTop: '2px solid #d1d5db', color: '#d97706' }}>{secondPercent.toFixed(1)}%</td>
              <td style={{ padding: '2mm', textAlign: 'center', borderTop: '2px solid #d1d5db', color: '#dc2626' }}>{brokenPercent.toFixed(1)}%</td>
              <td style={{ padding: '2mm', textAlign: 'center', borderTop: '2px solid #d1d5db', color: '#16a34a' }}>{qualityIndex.toFixed(1)}%</td>
            </tr>
          </tbody>
        </table>

        {/* Top Defectos con Heatmap */}
        {topDefects.length > 0 && (
          <>
            <div style={{ fontSize: '9pt', fontWeight: 'bold', color: '#111827', marginBottom: '3mm', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid #e5e7eb', paddingBottom: '2mm' }}>
              Principales Causas de Defectos (Top 5) - Heatmap por Diámetro
            </div>
            
            {(() => {
              // Calculate max value for heatmap intensity
              const maxDefectValue = Math.max(...topDefects.flatMap(r => PIPE_DIAMETERS.map(d => r.byDiameter[d] || 0)))
              // Calculate totals per diameter
              const diameterTotals: Record<number, number> = {}
              PIPE_DIAMETERS.forEach(d => {
                diameterTotals[d] = topDefects.reduce((sum, r) => sum + (r.byDiameter[d] || 0), 0)
              })
              const totalDefects = topDefects.reduce((sum, r) => sum + r.total, 0)

              return (
                <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '6mm', fontSize: '8pt' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f3f4f6' }}>
                      <th style={{ padding: '2mm', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #d1d5db', color: '#374151' }}>Motivo</th>
                      <th style={{ padding: '2mm', textAlign: 'center', fontWeight: '600', borderBottom: '1px solid #d1d5db', color: '#374151' }}>Cat.</th>
                      {PIPE_DIAMETERS.map(d => (
                        <th key={d} style={{ padding: '2mm', textAlign: 'center', fontWeight: '600', borderBottom: '1px solid #d1d5db', color: '#6b7280', fontSize: '7pt' }}>CC{d}</th>
                      ))}
                      <th style={{ padding: '2mm', textAlign: 'center', fontWeight: '600', borderBottom: '1px solid #d1d5db', color: '#dc2626' }}>Total</th>
                      <th style={{ padding: '2mm', textAlign: 'center', fontWeight: '600', borderBottom: '1px solid #d1d5db', color: '#6b7280', fontSize: '7pt' }}>%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topDefects.map((r, idx) => (
                      <tr key={r.reason} style={{ backgroundColor: idx % 2 === 1 ? '#fafafa' : '#ffffff' }}>
                        <td style={{ padding: '2mm', borderBottom: '1px solid #e5e7eb', fontWeight: '500', maxWidth: '40mm' }}>{r.reason}</td>
                        <td style={{ padding: '2mm', textAlign: 'center', borderBottom: '1px solid #e5e7eb', fontSize: '6pt' }}>
                          <span style={{ 
                            padding: '0.5mm 1.5mm', 
                            backgroundColor: r.category === 'produccion' ? '#dbeafe' : '#fef3c7',
                            color: r.category === 'produccion' ? '#1d4ed8' : '#92400e',
                            borderRadius: '2px'
                          }}>
                            {r.category === 'produccion' ? 'Prod' : 'Desm'}
                          </span>
                        </td>
                        {PIPE_DIAMETERS.map(d => {
                          const val = r.byDiameter[d] || 0
                          const intensity = maxDefectValue > 0 ? val / maxDefectValue : 0
                          // Heatmap: white (0) to red (max)
                          const bgColor = val === 0 ? '#ffffff' : `rgba(239, 68, 68, ${Math.max(0.15, intensity * 0.8)})`
                          return (
                            <td key={d} style={{ 
                              padding: '2mm', 
                              textAlign: 'center', 
                              borderBottom: '1px solid #e5e7eb', 
                              color: val > 0 ? '#991b1b' : '#d1d5db',
                              backgroundColor: bgColor,
                              fontWeight: intensity > 0.5 ? '600' : '400'
                            }}>
                              {val > 0 ? val : '-'}
                            </td>
                          )
                        })}
                        <td style={{ padding: '2mm', textAlign: 'center', borderBottom: '1px solid #e5e7eb', fontWeight: '700', color: '#dc2626' }}>{r.total}</td>
                        <td style={{ padding: '2mm', textAlign: 'center', borderBottom: '1px solid #e5e7eb', color: '#6b7280', fontSize: '7pt' }}>
                          {totalDefects > 0 ? ((r.total / totalDefects) * 100).toFixed(1) : '0.0'}%
                        </td>
                      </tr>
                    ))}
                    {/* Totals row */}
                    <tr style={{ backgroundColor: '#f3f4f6', fontWeight: '600' }}>
                      <td style={{ padding: '2mm', borderTop: '2px solid #d1d5db' }} colSpan={2}>TOTAL</td>
                      {PIPE_DIAMETERS.map(d => (
                        <td key={d} style={{ padding: '2mm', textAlign: 'center', borderTop: '2px solid #d1d5db', color: diameterTotals[d] > 0 ? '#991b1b' : '#d1d5db' }}>
                          {diameterTotals[d] > 0 ? diameterTotals[d] : '-'}
                        </td>
                      ))}
                      <td style={{ padding: '2mm', textAlign: 'center', borderTop: '2px solid #d1d5db', color: '#dc2626', fontWeight: '700' }}>{totalDefects}</td>
                      <td style={{ padding: '2mm', textAlign: 'center', borderTop: '2px solid #d1d5db', color: '#6b7280' }}>100%</td>
                    </tr>
                  </tbody>
                </table>
              )
            })()}
          </>
        )}

        {/* Pie de página */}
        <div style={{ 
          borderTop: '1px solid #e5e7eb',
          paddingTop: '3mm',
          fontSize: '7pt',
          color: '#9ca3af',
          textAlign: 'center',
          marginTop: '4mm'
        }}>
          Documento interno | Generado: {new Date().toLocaleDateString('es-AR')} | SILKE S.A.
        </div>
      </div>
    )
  }
)
