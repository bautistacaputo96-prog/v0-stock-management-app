"use client"

import { forwardRef } from "react"

const PIPE_DIAMETERS = [300, 400, 500, 600, 800, 1000, 1200]

const MONTHS = [
  "", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
]

interface DiameterData {
  produced: number
  planned: number
  first: number
  second: number
  broken: number
}

interface DowntimeData {
  reason: string
  minutes: number
  percentage: number
}

interface PipeWeeklyReportData {
  totalUnits: number
  totalPlanned: number
  byDiameter: Record<number, DiameterData>
  qualityIndex: number
  secondPercent: number
  brokenPercent: number
  wastePercent: number
  topDowntimes: DowntimeData[]
  totalDowntimeMinutes: number
  prevWeekUnits: number
  prevWeekQuality: number
}

interface PipeWeeklyExecutiveReportProps {
  weekStart: string
  weekEnd: string
  reportData: PipeWeeklyReportData
  daysWorked: number
}

export const PipeWeeklyExecutiveReport = forwardRef<HTMLDivElement, PipeWeeklyExecutiveReportProps>(
  function PipeWeeklyExecutiveReport({ weekStart, weekEnd, reportData, daysWorked }, ref) {
    if (reportData.totalUnits === 0) return null

    // Calcular tendencias vs semana anterior
    const unitsTrend = reportData.prevWeekUnits > 0 
      ? ((reportData.totalUnits - reportData.prevWeekUnits) / reportData.prevWeekUnits) * 100 
      : 0
    const qualityTrend = reportData.prevWeekQuality > 0 
      ? reportData.qualityIndex - reportData.prevWeekQuality 
      : 0

    // Cumplimiento del plan
    const planCompliance = reportData.totalPlanned > 0 
      ? (reportData.totalUnits / reportData.totalPlanned) * 100 
      : 100

    // Formatear período
    const startDate = new Date(weekStart + "T12:00:00")
    const endDate = new Date(weekEnd + "T12:00:00")
    const weekNumber = Math.ceil((startDate.getDate() + new Date(startDate.getFullYear(), startDate.getMonth(), 1).getDay()) / 7)
    const periodoTexto = `Semana ${weekNumber} - ${MONTHS[startDate.getMonth() + 1]} ${startDate.getFullYear()}`
    const rangoFechas = `${startDate.getDate()}/${startDate.getMonth() + 1} al ${endDate.getDate()}/${endDate.getMonth() + 1}`

    // Estado general basado en calidad y cumplimiento
    const estadoGeneral = reportData.qualityIndex >= 95 && planCompliance >= 90 
      ? "Excelente" 
      : reportData.qualityIndex >= 90 && planCompliance >= 80 
        ? "Aceptable" 
        : "En Revisión"
    const estadoBgColor = estadoGeneral === "Excelente" ? "#16a34a" : estadoGeneral === "Aceptable" ? "#d97706" : "#dc2626"

    // Función para color de tendencia
    const getTrendColor = (value: number, invertido = false) => {
      const adjusted = invertido ? -value : value
      if (adjusted > 0) return "#16a34a"
      if (adjusted < 0) return "#dc2626"
      return "#6b7280"
    }

    const getTrendArrow = (value: number, invertido = false) => {
      const adjusted = invertido ? -value : value
      if (adjusted > 0) return "▲"
      if (adjusted < 0) return "▼"
      return "="
    }

    return (
      <div
        ref={ref}
        style={{
          width: '210mm',
          height: '297mm',
          padding: '10mm 12mm',
          backgroundColor: '#ffffff',
          fontFamily: 'Arial, Helvetica, sans-serif',
          fontSize: '9pt',
          color: '#1f2937',
          lineHeight: '1.4',
          boxSizing: 'border-box',
          overflow: 'hidden',
        }}
      >
        {/* Encabezado compacto */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '4mm' }}>
          <tbody>
            <tr>
              <td style={{ width: '20%', verticalAlign: 'middle' }}>
                <img 
                  src="/concretus-logo.png" 
                  alt="Concretus" 
                  style={{ height: '14mm', objectFit: 'contain' }}
                  crossOrigin="anonymous"
                />
              </td>
              <td style={{ width: '60%', textAlign: 'center', verticalAlign: 'middle' }}>
                <div style={{ fontSize: '13pt', fontWeight: 'bold', color: '#111827', letterSpacing: '0.5px' }}>
                  INFORME SEMANAL DE PRODUCCIÓN
                </div>
                <div style={{ fontSize: '8pt', color: '#6b7280', marginTop: '1mm' }}>
                  Línea de Caños | {rangoFechas}
                </div>
              </td>
              <td style={{ width: '20%', textAlign: 'right', verticalAlign: 'middle' }}>
                <div style={{ fontSize: '11pt', fontWeight: 'bold', color: '#111827' }}>{periodoTexto}</div>
                <div style={{ fontSize: '8pt', color: '#6b7280' }}>{daysWorked} días trabajados</div>
              </td>
            </tr>
          </tbody>
        </table>

        <div style={{ borderBottom: '2px solid #DC2626', marginBottom: '4mm' }} />

        {/* KPIs principales - 4 columnas */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '4mm' }}>
          <tbody>
            <tr>
              {/* Producción Total */}
              <td style={{ width: '25%', padding: '3mm', backgroundColor: '#DC2626', verticalAlign: 'top' }}>
                <div style={{ fontSize: '7pt', color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase' }}>Producción Total</div>
                <div style={{ fontSize: '20pt', fontWeight: 'bold', color: '#ffffff' }}>{reportData.totalUnits.toLocaleString()}</div>
                <div style={{ fontSize: '8pt', color: 'rgba(255,255,255,0.9)' }}>unidades</div>
                <div style={{ fontSize: '8pt', color: 'rgba(255,255,255,0.8)', marginTop: '1mm' }}>
                  <span style={{ color: getTrendColor(unitsTrend) === "#16a34a" ? "#bbf7d0" : getTrendColor(unitsTrend) === "#dc2626" ? "#fecaca" : "#ffffff" }}>
                    {getTrendArrow(unitsTrend)} {Math.abs(unitsTrend).toFixed(1)}% vs sem. ant.
                  </span>
                </div>
              </td>
              
              {/* Plan */}
              <td style={{ width: '25%', padding: '3mm', backgroundColor: '#f3f4f6', border: '1px solid #e5e7eb', verticalAlign: 'top' }}>
                <div style={{ fontSize: '7pt', color: '#6b7280', textTransform: 'uppercase' }}>Cumplimiento Plan</div>
                <div style={{ fontSize: '20pt', fontWeight: 'bold', color: planCompliance >= 90 ? '#16a34a' : planCompliance >= 80 ? '#d97706' : '#dc2626' }}>
                  {planCompliance.toFixed(0)}%
                </div>
                <div style={{ fontSize: '8pt', color: '#6b7280' }}>{reportData.totalPlanned.toLocaleString()} plan</div>
                <div style={{ fontSize: '8pt', color: planCompliance >= 100 ? '#16a34a' : '#dc2626', marginTop: '1mm' }}>
                  {reportData.totalUnits - reportData.totalPlanned >= 0 ? '+' : ''}{(reportData.totalUnits - reportData.totalPlanned).toLocaleString()} uds
                </div>
              </td>
              
              {/* Calidad */}
              <td style={{ width: '25%', padding: '3mm', backgroundColor: '#f3f4f6', border: '1px solid #e5e7eb', verticalAlign: 'top' }}>
                <div style={{ fontSize: '7pt', color: '#6b7280', textTransform: 'uppercase' }}>Índice Calidad</div>
                <div style={{ fontSize: '20pt', fontWeight: 'bold', color: reportData.qualityIndex >= 95 ? '#16a34a' : reportData.qualityIndex >= 90 ? '#d97706' : '#dc2626' }}>
                  {reportData.qualityIndex.toFixed(1)}%
                </div>
                <div style={{ fontSize: '8pt', color: '#6b7280' }}>Primera calidad</div>
                <div style={{ fontSize: '8pt', color: getTrendColor(qualityTrend), marginTop: '1mm' }}>
                  {getTrendArrow(qualityTrend)} {Math.abs(qualityTrend).toFixed(1)}pp vs sem. ant.
                </div>
              </td>
              
              {/* Desperdicio */}
              <td style={{ width: '25%', padding: '3mm', backgroundColor: '#f3f4f6', border: '1px solid #e5e7eb', verticalAlign: 'top' }}>
                <div style={{ fontSize: '7pt', color: '#6b7280', textTransform: 'uppercase' }}>Desperdicio</div>
                <div style={{ fontSize: '20pt', fontWeight: 'bold', color: reportData.wastePercent <= 3 ? '#16a34a' : reportData.wastePercent <= 5 ? '#d97706' : '#dc2626' }}>
                  {reportData.wastePercent.toFixed(1)}%
                </div>
                <div style={{ fontSize: '8pt', color: '#6b7280' }}>2da + rotura</div>
                <div style={{ fontSize: '8pt', color: '#6b7280', marginTop: '1mm' }}>
                  Seg: {reportData.secondPercent.toFixed(1)}% | Rot: {reportData.brokenPercent.toFixed(1)}%
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* Estado General */}
        <div style={{ 
          display: 'inline-block',
          padding: '1.5mm 4mm', 
          backgroundColor: estadoBgColor,
          color: '#ffffff',
          fontSize: '8pt',
          fontWeight: '600',
          marginBottom: '4mm'
        }}>
          Estado General: {estadoGeneral}
        </div>

        {/* Producción por Diámetro */}
        <div style={{ fontSize: '9pt', fontWeight: 'bold', color: '#111827', marginBottom: '2mm', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid #e5e7eb', paddingBottom: '1mm' }}>
          Producción por Diámetro
        </div>
        
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '4mm', fontSize: '8pt' }}>
          <thead>
            <tr style={{ backgroundColor: '#f3f4f6' }}>
              <th style={{ padding: '1.5mm', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #d1d5db', color: '#374151' }}>Diámetro</th>
              <th style={{ padding: '1.5mm', textAlign: 'center', fontWeight: '600', borderBottom: '1px solid #d1d5db', color: '#374151' }}>Producido</th>
              <th style={{ padding: '1.5mm', textAlign: 'center', fontWeight: '600', borderBottom: '1px solid #d1d5db', color: '#374151' }}>Plan</th>
              <th style={{ padding: '1.5mm', textAlign: 'center', fontWeight: '600', borderBottom: '1px solid #d1d5db', color: '#374151' }}>Cumpl.</th>
              <th style={{ padding: '1.5mm', textAlign: 'center', fontWeight: '600', borderBottom: '1px solid #d1d5db', color: '#16a34a' }}>1ra</th>
              <th style={{ padding: '1.5mm', textAlign: 'center', fontWeight: '600', borderBottom: '1px solid #d1d5db', color: '#d97706' }}>2da</th>
              <th style={{ padding: '1.5mm', textAlign: 'center', fontWeight: '600', borderBottom: '1px solid #d1d5db', color: '#dc2626' }}>Roto</th>
              <th style={{ padding: '1.5mm', textAlign: 'center', fontWeight: '600', borderBottom: '1px solid #d1d5db', color: '#374151' }}>Calidad</th>
            </tr>
          </thead>
          <tbody>
            {PIPE_DIAMETERS.map((d, idx) => {
              const data = reportData.byDiameter[d]
              if (!data || data.produced === 0) return null
              const total = data.first + data.second + data.broken
              const compliance = data.planned > 0 ? (data.produced / data.planned) * 100 : 100
              const quality = total > 0 ? (data.first / total) * 100 : 100
              return (
                <tr key={d} style={{ backgroundColor: idx % 2 === 1 ? '#fafafa' : '#ffffff' }}>
                  <td style={{ padding: '1.5mm', borderBottom: '1px solid #e5e7eb', fontWeight: '500' }}>CC{d}</td>
                  <td style={{ padding: '1.5mm', textAlign: 'center', borderBottom: '1px solid #e5e7eb', fontWeight: '600' }}>{data.produced}</td>
                  <td style={{ padding: '1.5mm', textAlign: 'center', borderBottom: '1px solid #e5e7eb', color: '#6b7280' }}>{data.planned || '-'}</td>
                  <td style={{ padding: '1.5mm', textAlign: 'center', borderBottom: '1px solid #e5e7eb', color: compliance >= 90 ? '#16a34a' : compliance >= 80 ? '#d97706' : '#dc2626', fontWeight: '500' }}>
                    {data.planned > 0 ? `${compliance.toFixed(0)}%` : '-'}
                  </td>
                  <td style={{ padding: '1.5mm', textAlign: 'center', borderBottom: '1px solid #e5e7eb', color: '#16a34a' }}>{data.first}</td>
                  <td style={{ padding: '1.5mm', textAlign: 'center', borderBottom: '1px solid #e5e7eb', color: '#d97706' }}>{data.second}</td>
                  <td style={{ padding: '1.5mm', textAlign: 'center', borderBottom: '1px solid #e5e7eb', color: '#dc2626' }}>{data.broken}</td>
                  <td style={{ 
                    padding: '1.5mm', 
                    textAlign: 'center', 
                    borderBottom: '1px solid #e5e7eb', 
                    fontWeight: '600',
                    color: quality >= 95 ? '#16a34a' : quality >= 90 ? '#d97706' : '#dc2626'
                  }}>{quality.toFixed(1)}%</td>
                </tr>
              )
            })}
            <tr style={{ backgroundColor: '#f3f4f6', fontWeight: '600' }}>
              <td style={{ padding: '1.5mm', borderTop: '2px solid #d1d5db' }}>TOTAL</td>
              <td style={{ padding: '1.5mm', textAlign: 'center', borderTop: '2px solid #d1d5db' }}>{reportData.totalUnits}</td>
              <td style={{ padding: '1.5mm', textAlign: 'center', borderTop: '2px solid #d1d5db', color: '#6b7280' }}>{reportData.totalPlanned}</td>
              <td style={{ padding: '1.5mm', textAlign: 'center', borderTop: '2px solid #d1d5db', color: planCompliance >= 90 ? '#16a34a' : planCompliance >= 80 ? '#d97706' : '#dc2626' }}>
                {planCompliance.toFixed(0)}%
              </td>
              <td style={{ padding: '1.5mm', textAlign: 'center', borderTop: '2px solid #d1d5db', color: '#16a34a' }}>
                {Object.values(reportData.byDiameter).reduce((s, d) => s + d.first, 0)}
              </td>
              <td style={{ padding: '1.5mm', textAlign: 'center', borderTop: '2px solid #d1d5db', color: '#d97706' }}>
                {Object.values(reportData.byDiameter).reduce((s, d) => s + d.second, 0)}
              </td>
              <td style={{ padding: '1.5mm', textAlign: 'center', borderTop: '2px solid #d1d5db', color: '#dc2626' }}>
                {Object.values(reportData.byDiameter).reduce((s, d) => s + d.broken, 0)}
              </td>
              <td style={{ padding: '1.5mm', textAlign: 'center', borderTop: '2px solid #d1d5db', color: reportData.qualityIndex >= 95 ? '#16a34a' : reportData.qualityIndex >= 90 ? '#d97706' : '#dc2626' }}>
                {reportData.qualityIndex.toFixed(1)}%
              </td>
            </tr>
          </tbody>
        </table>

        {/* Top 3 Paradas */}
        {reportData.topDowntimes.length > 0 && (
          <>
            <div style={{ fontSize: '9pt', fontWeight: 'bold', color: '#111827', marginBottom: '2mm', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid #e5e7eb', paddingBottom: '1mm' }}>
              Top 3 Paradas de Producción
            </div>
            
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '4mm', fontSize: '8pt' }}>
              <thead>
                <tr style={{ backgroundColor: '#fef2f2' }}>
                  <th style={{ padding: '1.5mm', textAlign: 'center', fontWeight: '600', borderBottom: '1px solid #fecaca', color: '#991b1b', width: '8%' }}>#</th>
                  <th style={{ padding: '1.5mm', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #fecaca', color: '#991b1b' }}>Motivo</th>
                  <th style={{ padding: '1.5mm', textAlign: 'center', fontWeight: '600', borderBottom: '1px solid #fecaca', color: '#991b1b', width: '15%' }}>Minutos</th>
                  <th style={{ padding: '1.5mm', textAlign: 'center', fontWeight: '600', borderBottom: '1px solid #fecaca', color: '#991b1b', width: '15%' }}>% Total</th>
                  <th style={{ padding: '1.5mm', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #fecaca', color: '#991b1b', width: '30%' }}>Impacto Visual</th>
                </tr>
              </thead>
              <tbody>
                {reportData.topDowntimes.slice(0, 3).map((dt, idx) => (
                  <tr key={idx} style={{ backgroundColor: idx % 2 === 1 ? '#fafafa' : '#ffffff' }}>
                    <td style={{ padding: '1.5mm', textAlign: 'center', borderBottom: '1px solid #e5e7eb', fontWeight: '700', color: '#dc2626' }}>{idx + 1}</td>
                    <td style={{ padding: '1.5mm', borderBottom: '1px solid #e5e7eb' }}>{dt.reason}</td>
                    <td style={{ padding: '1.5mm', textAlign: 'center', borderBottom: '1px solid #e5e7eb', fontWeight: '600' }}>{dt.minutes}</td>
                    <td style={{ padding: '1.5mm', textAlign: 'center', borderBottom: '1px solid #e5e7eb', fontWeight: '500' }}>{dt.percentage.toFixed(1)}%</td>
                    <td style={{ padding: '1.5mm', borderBottom: '1px solid #e5e7eb' }}>
                      <div style={{ 
                        height: '4mm', 
                        backgroundColor: '#fee2e2', 
                        borderRadius: '2px',
                        overflow: 'hidden'
                      }}>
                        <div style={{ 
                          height: '100%', 
                          width: `${Math.min(dt.percentage, 100)}%`,
                          backgroundColor: idx === 0 ? '#dc2626' : idx === 1 ? '#f87171' : '#fca5a5'
                        }} />
                      </div>
                    </td>
                  </tr>
                ))}
                <tr style={{ backgroundColor: '#f3f4f6', fontWeight: '600' }}>
                  <td style={{ padding: '1.5mm', borderTop: '1px solid #d1d5db' }}></td>
                  <td style={{ padding: '1.5mm', borderTop: '1px solid #d1d5db' }}>Total Paradas</td>
                  <td style={{ padding: '1.5mm', textAlign: 'center', borderTop: '1px solid #d1d5db', color: '#dc2626' }}>{reportData.totalDowntimeMinutes} min</td>
                  <td style={{ padding: '1.5mm', textAlign: 'center', borderTop: '1px solid #d1d5db' }}>
                    ({(reportData.totalDowntimeMinutes / 60).toFixed(1)} hrs)
                  </td>
                  <td style={{ padding: '1.5mm', borderTop: '1px solid #d1d5db' }}></td>
                </tr>
              </tbody>
            </table>
          </>
        )}

        {/* Resumen Ejecutivo */}
        <div style={{ fontSize: '9pt', fontWeight: 'bold', color: '#111827', marginBottom: '2mm', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid #e5e7eb', paddingBottom: '1mm' }}>
          Resumen Ejecutivo
        </div>
        
        <div style={{ 
          padding: '3mm', 
          backgroundColor: '#f9fafb', 
          border: '1px solid #e5e7eb',
          fontSize: '8pt',
          lineHeight: '1.6'
        }}>
          <p style={{ margin: '0 0 2mm 0' }}>
            <strong>Producción:</strong> Se produjeron <strong>{reportData.totalUnits.toLocaleString()}</strong> unidades 
            ({unitsTrend >= 0 ? '+' : ''}{unitsTrend.toFixed(1)}% vs semana anterior), 
            alcanzando un <strong>{planCompliance.toFixed(0)}%</strong> del plan semanal.
          </p>
          <p style={{ margin: '0 0 2mm 0' }}>
            <strong>Calidad:</strong> Índice de calidad del <strong>{reportData.qualityIndex.toFixed(1)}%</strong> 
            ({qualityTrend >= 0 ? '+' : ''}{qualityTrend.toFixed(1)}pp vs semana anterior). 
            Desperdicio total: {reportData.wastePercent.toFixed(1)}% (Segunda: {reportData.secondPercent.toFixed(1)}%, Rotura: {reportData.brokenPercent.toFixed(1)}%).
          </p>
          {reportData.topDowntimes.length > 0 && (
            <p style={{ margin: '0' }}>
              <strong>Paradas:</strong> {reportData.totalDowntimeMinutes} minutos totales ({(reportData.totalDowntimeMinutes / 60).toFixed(1)} horas). 
              Principal causa: {reportData.topDowntimes[0]?.reason} ({reportData.topDowntimes[0]?.percentage.toFixed(0)}% del total).
            </p>
          )}
        </div>

        {/* Pie de página */}
        <div style={{ 
          position: 'absolute',
          bottom: '8mm',
          left: '12mm',
          right: '12mm',
          borderTop: '1px solid #e5e7eb',
          paddingTop: '2mm',
          fontSize: '7pt',
          color: '#9ca3af',
          display: 'flex',
          justifyContent: 'space-between'
        }}>
          <span>Generado: {new Date().toLocaleDateString('es-AR')} {new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</span>
          <span>CONCRETUS S.A. - Sistema de Control de Producción</span>
        </div>
      </div>
    )
  }
)
