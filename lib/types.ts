export type LineType = "bloques" | "caños"

export interface CycleTime {
  id: number
  product_type: string
  product_code: string
  cycle_seconds: number
  line_type: LineType
  created_at: string
  updated_at: string
}

export interface DowntimeReason {
  id: number
  reason: string
  line_type: LineType
  category?: string // Added category field for grouping downtime reasons
  is_active: boolean
  created_at: string
}

export interface BlockProduction {
  id: number
  production_date: string
  shift: 1 | 2
  start_time: string
  end_time: string
  total_downtime_minutes: number
  product_type?: string
  concrete_formula?: string
  racks_produced: number
  blocks_discarded: number
  cement_kg?: number
  sand_kg?: number
  stone_0_10_kg?: number
  stone_0_20_kg?: number
  water_kg?: number
  fresh_racks?: number
  machine_operator?: string
  internal_driver?: string
  palletizer_1?: string
  created_at: string
  updated_at: string
}

export interface BlockDowntime {
  id: number
  block_production_id: number
  downtime_reason_id?: number
  custom_reason?: string
  minutes?: number // Added minutes field to track downtime duration per reason
  comments?: string
  created_at: string
}

export interface PipeProduction {
  id: number
  production_date: string
  shift: 1 | 2
  start_time: string
  end_time: string
  total_downtime_minutes: number
  cc400_units: number
  cc500_units: number
  cc600_units: number
  cc800_units: number
  cc1000_units: number
  cc1200_units: number
  reprocessed_units: number
  cement_kg?: number
  sand_kg?: number
  stone_0_10_kg?: number
  stone_0_20_kg?: number
  water_kg?: number
  fresh_racks?: number
  machine_operator?: string
  internal_driver?: string
  palletizer_1?: string
  created_at: string
  updated_at: string
}

export interface PipeDowntime {
  id: number
  pipe_production_id: number
  downtime_reason_id?: number
  custom_reason?: string
  minutes?: number // Added minutes field
  comments?: string
  created_at: string
}

export interface OEEMetrics {
  availability: number
  performance: number
  quality: number
  oee: number
}
