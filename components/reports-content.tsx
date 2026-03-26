"use client"

import { useState } from "react"
import { DailyReport } from "@/components/reports/daily-report"
import { WeeklyReport } from "@/components/reports/weekly-report"
import { MonthlyReport } from "@/components/reports/monthly-report"
import { CustomRangeReport } from "@/components/reports/custom-range-report"
import { Factory, Cylinder, CalendarDays, CalendarRange, CalendarClock, CalendarSearch } from "lucide-react"

type ReportTab = "daily" | "weekly" | "monthly" | "custom"

const REPORT_TABS: { id: ReportTab; label: string; icon: typeof CalendarDays }[] = [
  { id: "daily", label: "Diario", icon: CalendarDays },
  { id: "weekly", label: "Semanal", icon: CalendarRange },
  { id: "monthly", label: "Mensual", icon: CalendarClock },
  { id: "custom", label: "Por Fechas", icon: CalendarSearch },
]

export function ReportsContent() {
  const [selectedLine, setSelectedLine] = useState<"bloques" | "caños" | null>(null)
  const [activeTab, setActiveTab] = useState<ReportTab>("monthly")

  if (!selectedLine) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <p className="text-sm text-muted-foreground mb-6">Selecciona una linea de produccion</p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setSelectedLine("bloques")}
            className="flex items-center gap-2 px-5 py-3 rounded-lg border-2 border-border bg-card hover:bg-muted hover:border-primary/30 transition-all text-sm font-medium text-foreground"
          >
            <Factory className="w-4 h-4" />
            Bloques
          </button>
          <button
            type="button"
            onClick={() => setSelectedLine("caños")}
            className="flex items-center gap-2 px-5 py-3 rounded-lg border-2 border-border bg-card hover:bg-muted hover:border-primary/30 transition-all text-sm font-medium text-foreground"
          >
            <Cylinder className="w-4 h-4" />
            Canos
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Dashboard-style header with line tabs + report tabs */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* Back link */}
          <button
            type="button"
            onClick={() => setSelectedLine(null)}
            className="text-muted-foreground hover:text-foreground transition-colors text-sm"
            aria-label="Volver"
          >
            &larr;
          </button>

          {/* Line tabs - same style as dashboard */}
          <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
            <button
              onClick={() => setSelectedLine("bloques")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                selectedLine === "bloques"
                  ? "bg-card text-foreground shadow-sm border border-border"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Factory className="w-3.5 h-3.5" />
              Bloques
            </button>
            <button
              onClick={() => setSelectedLine("caños")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                selectedLine === "caños"
                  ? "bg-card text-foreground shadow-sm border border-border"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Cylinder className="w-3.5 h-3.5" />
              Canos
            </button>
          </div>
        </div>

        {/* Report type tabs */}
        <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
          {REPORT_TABS.map(tab => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  activeTab === tab.id
                    ? "bg-card text-foreground shadow-sm border border-border"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            )
          })}
        </div>
      </header>

      {/* Report content */}
      {activeTab === "daily" && <DailyReport lineType={selectedLine} />}
      {activeTab === "weekly" && <WeeklyReport lineType={selectedLine} />}
      {activeTab === "monthly" && <MonthlyReport lineType={selectedLine} />}
      {activeTab === "custom" && <CustomRangeReport lineType={selectedLine} />}
    </div>
  )
}
