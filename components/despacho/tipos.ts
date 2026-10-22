/** Tipos compartidos de la pantalla de despacho en tres columnas (fase 3). */
import type { EstadoCamion, OrigenTipo, PedidoDia, TipoRemito, ViajeDia } from "@/lib/despacho"

export type Planta = { id: string; name: string }

export type PedidoT = PedidoDia & {
  client_id: string
  construction_site_id: string
  formula_id: string
  observations?: string | null
  is_urgent?: boolean
  fiber_kg_per_m3?: number | null
  finalidad?: string | null
  bomba_la_pone?: "rebucret" | "cliente" | null
  bomba_empresa_id?: string | null
  bomba_hora?: string | null
  confirmado_at?: string | null
  confirmado_por?: string | null
  created_by?: string | null
  remito_tipo?: TipoRemito | null
  suspendido_at?: string | null
  suspendido_por?: string | null
  suspendido_motivo_tipo?: string | null
  suspendido_motivo?: string | null
  cierre_motivo_tipo?: string | null
  cierre_motivo?: string | null
  clients?: { id: string; name: string; remito_tipo?: TipoRemito | null } | null
  construction_sites?: {
    id: string; name: string; address?: string | null; travel_time_minutes?: number | null; requires_pump?: boolean | null
    gps_lat?: number | null; gps_lng?: number | null; localidad?: string | null; site_contact?: string | null; site_phone?: string | null; remito_tipo?: TipoRemito | null
  } | null
  formulas?: { id: string; name: string; code: string } | null
}

export type DespachoT = {
  id: string
  dispatch_date: string
  created_at?: string | null
  remito: string | null
  remito_tipo?: TipoRemito | null
  quantity_m3: number
  mixer_id: string | null
  chofer_id?: string | null
  plant_id: string
  scheduled_dispatch_id: string | null
  construction_site_id?: string | null
  is_test_dispatch?: boolean | null
  sample_taken?: boolean | null
  sample_number?: string | null
  clients?: { name: string } | null
  construction_sites?: { name: string; travel_time_minutes?: number | null } | null
  formulas?: { code: string } | null
}

export type TipoResuelto = { tipo: TipoRemito | null; origen: OrigenTipo | null }

export type CamionT = {
  id: string
  patente: string
  status: string
  e: EstadoCamion
  chofer: string | null
  choferId: string | null
  /** obra a la que va (en viaje) */
  obra: string | null
  /** id del despacho en curso (para el "Ahora" de la tabla) */
  despachoId: string | null
  notaTaller: string | null
  /** remito del despacho en curso (para la confirmación de "Volvió a planta" cuando todavía no salió) */
  remito: string | null
}

export type ViajeT = ViajeDia
