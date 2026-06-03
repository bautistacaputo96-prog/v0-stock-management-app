"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar, X } from "lucide-react"

interface DateRangeFilterProps {
  onFilterChange?: (startDate: string | null, endDate: string | null) => void
  // Alternative controlled props
  dateFrom?: string
  dateTo?: string
  onDateFromChange?: (value: string) => void
  onDateToChange?: (value: string) => void
}

export function DateRangeFilter({ 
  onFilterChange, 
  dateFrom, 
  dateTo, 
  onDateFromChange, 
  onDateToChange 
}: DateRangeFilterProps) {
  // Use controlled values if provided, otherwise use internal state
  const isControlled = dateFrom !== undefined || dateTo !== undefined
  const [internalStartDate, setInternalStartDate] = useState<string>("")
  const [internalEndDate, setInternalEndDate] = useState<string>("")

  const startDate = isControlled ? (dateFrom || "") : internalStartDate
  const endDate = isControlled ? (dateTo || "") : internalEndDate

  const setStartDate = (value: string) => {
    if (isControlled && onDateFromChange) {
      onDateFromChange(value)
    } else {
      setInternalStartDate(value)
    }
  }

  const setEndDate = (value: string) => {
    if (isControlled && onDateToChange) {
      onDateToChange(value)
    } else {
      setInternalEndDate(value)
    }
  }

  const handleApply = () => {
    if (onFilterChange) {
      onFilterChange(startDate || null, endDate || null)
    }
  }

  const handleClear = () => {
    setStartDate("")
    setEndDate("")
    if (onFilterChange) {
      onFilterChange(null, null)
    }
  }

  const hasFilter = startDate || endDate

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="gap-2 bg-transparent h-9">
          <Calendar className="h-4 w-4" />
          {hasFilter ? (
            <span className="text-xs">
              {startDate && new Date(startDate).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" })}
              {startDate && endDate && " - "}
              {endDate && new Date(endDate).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" })}
            </span>
          ) : (
            "Fechas"
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start">
        <div className="space-y-4">
          <div className="space-y-2">
            <h4 className="font-medium leading-none">Filtrar por rango de fechas</h4>
            <p className="text-sm text-muted-foreground">Selecciona el rango de fechas</p>
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
            {onFilterChange && (
              <Button size="sm" onClick={handleApply}>
                Aplicar filtro
              </Button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
