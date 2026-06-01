"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar, X } from "lucide-react"

interface DateRangeFilterProps {
  onFilterChange: (startDate: string | null, endDate: string | null) => void
}

export function DateRangeFilter({ onFilterChange }: DateRangeFilterProps) {
  const [startDate, setStartDate] = useState<string>("")
  const [endDate, setEndDate] = useState<string>("")

  const handleApply = () => {
    onFilterChange(startDate || null, endDate || null)
  }

  const handleClear = () => {
    setStartDate("")
    setEndDate("")
    onFilterChange(null, null)
  }

  const hasFilter = startDate || endDate

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="gap-2 bg-transparent">
          <Calendar className="h-4 w-4" />
          Filtrar por fecha
          {hasFilter && (
            <span className="ml-1 rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">1</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start">
        <div className="space-y-4">
          <div className="space-y-2">
            <h4 className="font-medium leading-none">Filtrar por rango de fechas</h4>
            <p className="text-sm text-muted-foreground">Selecciona el rango de fechas que deseas consultar</p>
          </div>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="start-date">Fecha desde</Label>
              <Input id="start-date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end-date">Fecha hasta</Label>
              <Input id="end-date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-between pt-2">
            <Button variant="ghost" size="sm" onClick={handleClear} disabled={!hasFilter}>
              <X className="h-4 w-4 mr-1" />
              Limpiar
            </Button>
            <Button size="sm" onClick={handleApply}>
              Aplicar filtro
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
