"use client"

import { forwardRef } from "react"
import {
  TARGETS,
  type ReportMetrics,
  type DowntimeDetail,
  type RawMaterialConsumption,
} from "@/lib/report-utils"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts"

interface ExecutiveReportProps {
  selectedMonth: string
  selectedYear: string
  dailyMetrics: ReportMetrics[]
  averageMetrics: ReportMetrics | null
  paretoDowntimes: DowntimeDetail[]
  totalDowntime: number
  rawMaterialConsumption: RawMaterialConsumption | null
}

const MONTHS = [
  "", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
]

export const ExecutiveReport = forwardRef<HTMLDivElement, ExecutiveReportProps>(
  function ExecutiveReport(
    {
      selectedMonth,
      selectedYear,
      dailyMetrics,
      averageMetrics,
      totalDowntime,
    },
    ref
  ) {
    if (!averageMetrics || dailyMetrics.length === 0) return null

    // Cálculos
    const promedioBandejasDiarias = Math.round(averageMetrics.traysProduced / dailyMetrics.length)
    const objetivoBloquesMensual = TARGETS.dailyBlocks * dailyMetrics.length
    const cumplimientoProduccion = (averageMetrics.goodBlocks / objetivoBloquesMensual) * 100

    // Tendencia OEE
    const midPoint = Math.floor(dailyMetrics.length / 2)
    const firstHalfOee = dailyMetrics.slice(0, midPoint).reduce((sum, m) => sum + m.oee, 0) / midPoint || 0
    const secondHalfOee = dailyMetrics.slice(midPoint).reduce((sum, m) => sum + m.oee, 0) / (dailyMetrics.length - midPoint) || 0
    const oeeTrend = secondHalfOee - firstHalfOee

    // Datos para gráfico
    const trendData = dailyMetrics.map(m => ({
      date: m.date.split("-")[2],
      oee: m.oee,
    }))

    // Estado general (tolerante) - Paleta Concretus (rojo #DC2626)
    const cumpleOee = averageMetrics.oee >= TARGETS.oee * 0.9
    const estadoGeneral = cumpleOee ? "En Objetivo" : "En Desarrollo"
    const estadoBgColor = cumpleOee ? "#DC2626" : "#6b7280"

    // Función para estado de indicadores (tolerante) - Paleta Concretus
    const getEstado = (valor: number, objetivo: number) => {
      const pct = (valor / objetivo) * 100
      if (pct >= 95) return { texto: "Cumple", color: "#DC2626" }
      if (pct >= 85) return { texto: "Aceptable", color: "#374151" }
      return { texto: "En revisión", color: "#9ca3af" }
    }

    const getVariacion = (valor: number, objetivo: number, decimales = 1) => {
      const diff = valor - objetivo
      const signo = diff >= 0 ? "+" : ""
      return `${signo}${diff.toFixed(decimales)}`
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
                  RESUMEN EJECUTIVO
                </div>
                <div style={{ fontSize: '9pt', color: '#6b7280', marginTop: '1mm' }}>
                  Producción de Bloques
                </div>
              </td>
              <td style={{ width: '25%', textAlign: 'right', verticalAlign: 'middle' }}>
                <div style={{ fontSize: '9pt', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Período</div>
                <div style={{ fontSize: '14pt', fontWeight: 'bold', color: '#111827' }}>
                  {MONTHS[Number.parseInt(selectedMonth)]} {selectedYear}
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
                    <div style={{ fontSize: '8pt', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>OEE Promedio</div>
                    <div style={{ fontSize: '22pt', fontWeight: 'bold', color: '#111827' }}>{averageMetrics.oee}%</div>
                    <div style={{ fontSize: '8pt', color: '#6b7280' }}>Objetivo: {TARGETS.oee}%</div>
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
                      {dailyMetrics.length} días
                    </div>
                    <div style={{ fontSize: '7pt', color: '#6b7280', marginTop: '1mm' }}>de operación</div>
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
                <div style={{ fontSize: '8pt', color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Producción Diaria</div>
                <div style={{ fontSize: '28pt', fontWeight: 'bold', color: '#ffffff' }}>{promedioBandejasDiarias.toLocaleString()}</div>
                <div style={{ fontSize: '10pt', color: 'rgba(255,255,255,0.9)', fontWeight: '500' }}>bandejas/día promedio</div>
                <div style={{ fontSize: '8pt', color: 'rgba(255,255,255,0.7)', marginTop: '2mm' }}>
                  Objetivo: {TARGETS.dailyTrays.toLocaleString()} | Dif: {promedioBandejasDiarias - TARGETS.dailyTrays >= 0 ? '+' : ''}{promedioBandejasDiarias - TARGETS.dailyTrays}
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* Indicadores de Desempeño */}
        <div style={{ fontSize: '9pt', fontWeight: 'bold', color: '#111827', marginBottom: '3mm', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid #e5e7eb', paddingBottom: '2mm' }}>
          Indicadores de Desempeño (Promedios)
        </div>
        
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '6mm', fontSize: '9pt' }}>
          <thead>
            <tr style={{ backgroundColor: '#f3f4f6' }}>
              <th style={{ padding: '2.5mm 3mm', textAlign: 'left', fontWeight: '600', borderBottom: '1px solid #d1d5db', color: '#374151' }}>Indicador</th>
              <th style={{ padding: '2.5mm 3mm', textAlign: 'center', fontWeight: '600', borderBottom: '1px solid #d1d5db', color: '#374151' }}>Resultado</th>
              <th style={{ padding: '2.5mm 3mm', textAlign: 'center', fontWeight: '600', borderBottom: '1px solid #d1d5db', color: '#374151' }}>Objetivo</th>
              <th style={{ padding: '2.5mm 3mm', textAlign: 'center', fontWeight: '600', borderBottom: '1px solid #d1d5db', color: '#374151' }}>Var.</th>
              <th style={{ padding: '2.5mm 3mm', textAlign: 'center', fontWeight: '600', borderBottom: '1px solid #d1d5db', color: '#374151' }}>Estado</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ padding: '2.5mm 3mm', borderBottom: '1px solid #e5e7eb' }}>Disponibilidad</td>
              <td style={{ padding: '2.5mm 3mm', textAlign: 'center', borderBottom: '1px solid #e5e7eb', fontWeight: '600' }}>{averageMetrics.availability}%</td>
              <td style={{ padding: '2.5mm 3mm', textAlign: 'center', borderBottom: '1px solid #e5e7eb', color: '#6b7280' }}>{TARGETS.availability}%</td>
              <td style={{ padding: '2.5mm 3mm', textAlign: 'center', borderBottom: '1px solid #e5e7eb', color: getEstado(averageMetrics.availability, TARGETS.availability).color }}>{getVariacion(averageMetrics.availability, TARGETS.availability)}%</td>
              <td style={{ padding: '2.5mm 3mm', textAlign: 'center', borderBottom: '1px solid #e5e7eb', color: getEstado(averageMetrics.availability, TARGETS.availability).color }}>{getEstado(averageMetrics.availability, TARGETS.availability).texto}</td>
            </tr>
            <tr style={{ backgroundColor: '#fafafa' }}>
              <td style={{ padding: '2.5mm 3mm', borderBottom: '1px solid #e5e7eb' }}>Rendimiento</td>
              <td style={{ padding: '2.5mm 3mm', textAlign: 'center', borderBottom: '1px solid #e5e7eb', fontWeight: '600' }}>{averageMetrics.performance}%</td>
              <td style={{ padding: '2.5mm 3mm', textAlign: 'center', borderBottom: '1px solid #e5e7eb', color: '#6b7280' }}>{TARGETS.performance}%</td>
              <td style={{ padding: '2.5mm 3mm', textAlign: 'center', borderBottom: '1px solid #e5e7eb', color: getEstado(averageMetrics.performance, TARGETS.performance).color }}>{getVariacion(averageMetrics.performance, TARGETS.performance)}%</td>
              <td style={{ padding: '2.5mm 3mm', textAlign: 'center', borderBottom: '1px solid #e5e7eb', color: getEstado(averageMetrics.performance, TARGETS.performance).color }}>{getEstado(averageMetrics.performance, TARGETS.performance).texto}</td>
            </tr>
            <tr>
              <td style={{ padding: '2.5mm 3mm', borderBottom: '1px solid #e5e7eb' }}>Calidad</td>
              <td style={{ padding: '2.5mm 3mm', textAlign: 'center', borderBottom: '1px solid #e5e7eb', fontWeight: '600' }}>{averageMetrics.quality}%</td>
              <td style={{ padding: '2.5mm 3mm', textAlign: 'center', borderBottom: '1px solid #e5e7eb', color: '#6b7280' }}>{TARGETS.quality}%</td>
              <td style={{ padding: '2.5mm 3mm', textAlign: 'center', borderBottom: '1px solid #e5e7eb', color: getEstado(averageMetrics.quality, TARGETS.quality).color }}>{getVariacion(averageMetrics.quality, TARGETS.quality, 2)}%</td>
              <td style={{ padding: '2.5mm 3mm', textAlign: 'center', borderBottom: '1px solid #e5e7eb', color: getEstado(averageMetrics.quality, TARGETS.quality).color }}>{getEstado(averageMetrics.quality, TARGETS.quality).texto}</td>
            </tr>
            <tr style={{ backgroundColor: '#fafafa' }}>
              <td style={{ padding: '2.5mm 3mm', borderBottom: '1px solid #e5e7eb' }}>Racks/Hora</td>
              <td style={{ padding: '2.5mm 3mm', textAlign: 'center', borderBottom: '1px solid #e5e7eb', fontWeight: '600' }}>{averageMetrics.racksPerHour}</td>
              <td style={{ padding: '2.5mm 3mm', textAlign: 'center', borderBottom: '1px solid #e5e7eb', color: '#6b7280' }}>{TARGETS.racksPerHour}</td>
              <td style={{ padding: '2.5mm 3mm', textAlign: 'center', borderBottom: '1px solid #e5e7eb', color: getEstado(averageMetrics.racksPerHour, TARGETS.racksPerHour).color }}>{getVariacion(averageMetrics.racksPerHour, TARGETS.racksPerHour, 2)}</td>
              <td style={{ padding: '2.5mm 3mm', textAlign: 'center', borderBottom: '1px solid #e5e7eb', color: getEstado(averageMetrics.racksPerHour, TARGETS.racksPerHour).color }}>{getEstado(averageMetrics.racksPerHour, TARGETS.racksPerHour).texto}</td>
            </tr>
          </tbody>
        </table>

        {/* Producción y Paradas */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '6mm' }}>
          <tbody>
            <tr>
              <td style={{ width: '50%', verticalAlign: 'top', paddingRight: '3mm' }}>
                <div style={{ fontSize: '9pt', fontWeight: 'bold', color: '#111827', marginBottom: '3mm', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid #e5e7eb', paddingBottom: '2mm' }}>
                  Objetivo Mensual de Producción
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9pt' }}>
                  <tbody>
                    <tr>
                      <td style={{ padding: '2mm 0', color: '#6b7280' }}>Bloques Producidos</td>
                      <td style={{ padding: '2mm 0', textAlign: 'right', fontWeight: '600' }}>{averageMetrics.goodBlocks.toLocaleString()}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '2mm 0', color: '#6b7280' }}>Objetivo Período</td>
                      <td style={{ padding: '2mm 0', textAlign: 'right', fontWeight: '600' }}>{objetivoBloquesMensual.toLocaleString()}</td>
                    </tr>
                    <tr style={{ borderTop: '1px solid #e5e7eb' }}>
                      <td style={{ padding: '3mm 0', fontWeight: '600' }}>Cumplimiento</td>
                      <td style={{ padding: '3mm 0', textAlign: 'right', fontWeight: 'bold', fontSize: '12pt', color: cumplimientoProduccion >= 95 ? '#DC2626' : '#374151' }}>
                        {cumplimientoProduccion.toFixed(1)}%
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
              <td style={{ width: '50%', verticalAlign: 'top', paddingLeft: '3mm' }}>
                <div style={{ fontSize: '9pt', fontWeight: 'bold', color: '#111827', marginBottom: '3mm', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid #e5e7eb', paddingBottom: '2mm' }}>
                  Tiempo de Paradas
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9pt' }}>
                  <tbody>
                    <tr>
                      <td style={{ padding: '2mm 0', color: '#6b7280' }}>Total del Período</td>
                      <td style={{ padding: '2mm 0', textAlign: 'right', fontWeight: 'bold', fontSize: '12pt' }}>{totalDowntime} min</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '2mm 0', color: '#6b7280' }}>Equivalente</td>
                      <td style={{ padding: '2mm 0', textAlign: 'right', fontWeight: '600' }}>{(totalDowntime / 60).toFixed(1)} horas</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '2mm 0', color: '#6b7280' }}>Promedio Diario</td>
                      <td style={{ padding: '2mm 0', textAlign: 'right', fontWeight: '600' }}>{Math.round(totalDowntime / dailyMetrics.length)} min/día</td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>

        {/* Tendencia */}
        <div style={{ fontSize: '9pt', fontWeight: 'bold', color: '#111827', marginBottom: '3mm', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid #e5e7eb', paddingBottom: '2mm' }}>
          Tendencia del Período
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '6mm' }}>
          <tbody>
            <tr>
              <td style={{ width: '65%', verticalAlign: 'middle' }}>
                <div style={{ height: '100px' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendData} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
                      <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#6b7280' }} axisLine={{ stroke: '#e5e7eb' }} tickLine={false} />
                      <YAxis 
                        tick={{ fontSize: 9, fill: '#6b7280' }} 
                        axisLine={false} 
                        tickLine={false}
                        domain={[0, 100]}
                        ticks={[0, 25, 50, 75, 100]}
                        width={30}
                      />
                      <ReferenceLine y={TARGETS.oee} stroke="#DC2626" strokeDasharray="4 4" strokeWidth={1.5} />
                      <Line 
                        type="monotone" 
                        dataKey="oee" 
                        stroke="#DC2626"
                        strokeWidth={2.5}
                        dot={{ r: 3, fill: '#DC2626', strokeWidth: 0 }}
                        activeDot={{ r: 5 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </td>
              <td style={{ width: '35%', textAlign: 'left', verticalAlign: 'middle', paddingLeft: '6mm' }}>
                <div style={{ fontSize: '8pt', color: '#6b7280', marginBottom: '2mm' }}>Línea punteada: Objetivo {TARGETS.oee}%</div>
                <div style={{ fontSize: '11pt', fontWeight: '600', color: oeeTrend >= 0 ? '#DC2626' : '#374151', marginBottom: '1mm' }}>
                  {oeeTrend > 2 ? "Tendencia Positiva" : oeeTrend < -2 ? "Tendencia a Revisar" : "Tendencia Estable"}
                </div>
                <div style={{ fontSize: '9pt', color: '#374151' }}>
                  Variación: {oeeTrend >= 0 ? '+' : ''}{oeeTrend.toFixed(1)}% OEE
                </div>
              </td>
            </tr>
          </tbody>
        </table>

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
