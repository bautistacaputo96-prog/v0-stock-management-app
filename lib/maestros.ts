/**
 * Maestros de la fase 1: choferes, empresas de bombeo y finalidad del pedido.
 *
 * Las consultas toleran que la migración todavía no esté aplicada (devuelven listas vacías),
 * así las pantallas siguen andando igual que antes.
 */
import { format } from "date-fns"

export type Chofer = { id: string; nombre: string; telefono: string | null; dni: string | null; activo: boolean }
export type EmpresaBombeo = { id: string; nombre: string; contacto: string | null; telefono: string | null; observaciones: string | null; activo: boolean }

/** Lista fija (la valida Bautista). Se guarda el texto tal cual en scheduled_dispatches.finalidad. */
export const FINALIDADES = [
  "Platea / Fundación",
  "Pilotes",
  "Columnas",
  "Vigas",
  "Losa",
  "Tabiques",
  "Contrapiso",
  "Pavimento / Carpeta",
  "Otro",
] as const

/** Todos los choferes (activos y dados de baja), para mostrar nombres en despachos viejos. */
export async function cargarChoferes(supabase: any): Promise<Chofer[]> {
  const { data, error } = await supabase.from("choferes").select("*").order("nombre")
  if (error) return []
  return (data || []) as Chofer[]
}

export async function cargarEmpresasBombeo(supabase: any): Promise<EmpresaBombeo[]> {
  const { data, error } = await supabase.from("empresas_bombeo").select("*").order("nombre")
  if (error) return []
  return (data || []) as EmpresaBombeo[]
}

/**
 * Chofer por defecto de cada camión: el del último viaje de ese camión en el día (en cualquier planta,
 * porque los camiones son compartidos). Los choferes rotan: es solo una sugerencia.
 */
export async function choferPorCamionDelDia(supabase: any, dia: Date = new Date()): Promise<Record<string, string>> {
  const ini = new Date(dia); ini.setHours(0, 0, 0, 0)
  const fin = new Date(ini); fin.setDate(fin.getDate() + 1)
  const { data, error } = await supabase
    .from("dispatches")
    .select("mixer_id, chofer_id, created_at")
    .gte("dispatch_date", ini.toISOString())
    .lt("dispatch_date", fin.toISOString())
    .not("mixer_id", "is", null)
    .not("chofer_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(200)
  if (error || !data) return {}
  const mapa: Record<string, string> = {}
  for (const d of data as { mixer_id: string; chofer_id: string }[]) if (!mapa[d.mixer_id]) mapa[d.mixer_id] = d.chofer_id
  return mapa
}

type PedidoBomba = {
  metodo_descarga?: string | null
  bomba_la_pone?: "rebucret" | "cliente" | null
  bomba_empresa_id?: string | null
  bomba_hora?: string | null
  scheduled_arrival_time?: string
}

/** "BOMBA · Empresa X · 08:30", "BOMBA (cliente)" o "BOMBA". Nulo si el pedido no va con bomba. */
export function textoBomba(p: PedidoBomba, empresas: EmpresaBombeo[], prefijo = "BOMBA"): string | null {
  if (p.metodo_descarga !== "bomba") return null
  if (p.bomba_la_pone === "cliente") return `${prefijo} (cliente)`
  if (p.bomba_la_pone === "rebucret") {
    const emp = empresas.find((e) => e.id === p.bomba_empresa_id)?.nombre || "sin empresa"
    const hora = p.bomba_hora || p.scheduled_arrival_time
    return `${prefijo} · ${emp}${hora ? ` · ${format(new Date(hora), "HH:mm")}` : ""}`
  }
  return prefijo
}

/** Pedido con bomba que todavía no tiene empresa asignada (salvo que la traiga el cliente). */
export function bombaSinEmpresa(p: PedidoBomba): boolean {
  return p.metodo_descarga === "bomba" && p.bomba_la_pone !== "cliente" && !p.bomba_empresa_id
}
