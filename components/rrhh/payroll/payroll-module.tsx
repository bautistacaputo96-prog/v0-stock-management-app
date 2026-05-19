"use client"

import { useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Settings, CalendarDays, Calculator } from "lucide-react"
import { PeriodManager } from "./period-manager"
import { LiquidationView } from "./liquidation-view"
import { ParametersConfig } from "./parameters-config"

interface PayrollPeriod {
  id: number
  plant: string
  period_type: string
  period_year: number
  period_month: number
  date_from: string
  date_to: string
  status: "borrador" | "revision" | "cerrado"
  total_gross: number
  total_net: number
  employee_count: number
}

export function PayrollModule() {
  const [activeTab, setActiveTab] = useState("periodos")
  const [selectedPeriod, setSelectedPeriod] = useState<PayrollPeriod | null>(null)

  function handleSelectPeriod(period: PayrollPeriod) {
    setSelectedPeriod(period)
    setActiveTab("liquidacion")
  }

  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full max-w-2xl grid-cols-3">
          <TabsTrigger value="periodos" className="gap-2">
            <CalendarDays className="h-4 w-4" />
            Períodos
          </TabsTrigger>
          <TabsTrigger
            value="liquidacion"
            className="gap-2"
            disabled={!selectedPeriod}
          >
            <Calculator className="h-4 w-4" />
            {selectedPeriod
              ? `Liquidar — ${PERIOD_LABEL[selectedPeriod.period_type]} ${MONTH_NAMES[selectedPeriod.period_month - 1]} ${selectedPeriod.period_year}`
              : "Liquidar"}
          </TabsTrigger>
          <TabsTrigger value="parametros" className="gap-2">
            <Settings className="h-4 w-4" />
            Parámetros
          </TabsTrigger>
        </TabsList>

        {/* ── Períodos ──────────────────────────────────────────────────── */}
        <TabsContent value="periodos" className="mt-4">
          <PeriodManager
            onSelectPeriod={handleSelectPeriod}
            selectedPeriodId={selectedPeriod?.id}
          />
        </TabsContent>

        {/* ── Liquidación ───────────────────────────────────────────────── */}
        <TabsContent value="liquidacion" className="mt-4">
          {selectedPeriod ? (
            <LiquidationView
              period={selectedPeriod}
              onPeriodUpdated={(updated) => setSelectedPeriod(updated)}
            />
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              Seleccioná un período desde la pestaña "Períodos" para liquidar.
            </div>
          )}
        </TabsContent>

        {/* ── Parámetros ────────────────────────────────────────────────── */}
        <TabsContent value="parametros" className="mt-4">
          <ParametersConfig />
        </TabsContent>
      </Tabs>
    </div>
  )
}

const PERIOD_LABEL: Record<string, string> = {
  primera_quincena: "1ra Q.",
  segunda_quincena: "2da Q.",
  mensual: "Mensual",
}

const MONTH_NAMES = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
]
