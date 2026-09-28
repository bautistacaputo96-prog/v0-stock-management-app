"use client"

/**
 * Ubicar una obra en el mapa: se busca la dirección, se elige el resultado, y el
 * punto se puede mover o marcar con un clic (útil en barrios cerrados y lotes,
 * donde la dirección no alcanza). También acepta pegar un link de Google Maps.
 * Con la ubicación calcula la distancia y el tiempo de viaje desde la planta.
 */
import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MapaBase, iconos } from "@/components/mapa-base"
import { parsearCoordenadas } from "@/lib/geo"
import { MapPin, Search, Loader2, Link2, Route } from "lucide-react"

export type UbicacionObra = {
  lat: number | null
  lng: number | null
  fuente: "direccion" | "manual" | "gps" | null
  km: number | null
  minutos: number | null
}

type Props = {
  direccion: string
  localidad: string
  plantaId?: string | null
  valor: UbicacionObra
  onChange: (u: UbicacionObra) => void
  /** Si se calcula un tiempo de viaje, se ofrece para completar el campo de la obra */
  onTiempoViaje?: (minutos: number) => void
}

type Planta = { id: string; name: string; gps_lat: number | null; gps_lng: number | null }

export function ObraUbicacion({ direccion, localidad, plantaId, valor, onChange, onTiempoViaje }: Props) {
  const [plantas, setPlantas] = useState<Planta[]>([])
  const [buscando, setBuscando] = useState(false)
  const [resultados, setResultados] = useState<{ nombre: string; lat: number; lng: number; exacto?: boolean }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pegar, setPegar] = useState("")
  const [calculando, setCalculando] = useState(false)

  useEffect(() => {
    createClient().from("plants").select("id, name, gps_lat, gps_lng").then(({ data }) => setPlantas((data as any) || []))
  }, [])

  const planta = plantas.find((p) => p.id === plantaId) || plantas.find((p) => p.gps_lat != null)

  async function buscar() {
    const q = [direccion, localidad].filter(Boolean).join(", ")
    if (q.trim().length < 3) { setError("Escribí la dirección y la localidad primero"); return }
    setBuscando(true); setError(null); setResultados([])
    try {
      const r = await fetch(`/api/geo/buscar?q=${encodeURIComponent(q)}`)
      const d = await r.json()
      if (!d.resultados?.length) setError("No se encontró en la zona. Marcá el punto tocando el mapa, o pegá abajo el link de Google Maps que manda el cliente.")
      else if (d.resultados.length === 1 && d.resultados[0].exacto) elegir(d.resultados[0].lat, d.resultados[0].lng, "direccion")
      else setResultados(d.resultados)
    } catch { setError("No se pudo buscar la dirección") }
    setBuscando(false)
  }

  async function elegir(lat: number, lng: number, fuente: UbicacionObra["fuente"]) {
    setResultados([])
    onChange({ ...valor, lat, lng, fuente, km: null, minutos: null })
    if (!planta?.gps_lat) return
    setCalculando(true)
    try {
      const r = await fetch(`/api/geo/ruta?desde=${planta.gps_lat},${planta.gps_lng}&hasta=${lat},${lng}`)
      const d = await r.json()
      onChange({ lat, lng, fuente, km: d.km ?? null, minutos: d.minutos ?? null })
      if (d.minutos) onTiempoViaje?.(d.minutos)
    } catch {}
    setCalculando(false)
  }

  async function usarLink() {
    let c = parsearCoordenadas(pegar)
    if (!c) {
      // Links cortos de Google Maps (los que llegan por WhatsApp): se resuelven en el servidor
      try {
        const r = await fetch(`/api/geo/link?u=${encodeURIComponent(pegar.trim())}`)
        const d = await r.json()
        if (d.lat != null) c = { lat: d.lat, lng: d.lng }
      } catch {}
    }
    if (!c) { setError("No reconozco ese link o esas coordenadas. Pegá el link de Google Maps del lugar (el que manda el cliente por WhatsApp sirve), o algo como -34.97, -58.46"); return }
    setPegar(""); setError(null)
    elegir(c.lat, c.lng, "manual")
  }

  const marcadores = [
    ...(planta?.gps_lat != null ? [{ id: "planta", lat: Number(planta.gps_lat), lng: Number(planta.gps_lng), html: iconos.planta(planta.name), tamano: [90, 20] as [number, number] }] : []),
    ...(valor.lat != null && valor.lng != null ? [{ id: "obra", lat: valor.lat, lng: valor.lng, html: iconos.obra(), arrastrable: true, tamano: [22, 22] as [number, number] }] : []),
  ]

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={buscar} disabled={buscando} className="gap-1.5">
          {buscando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          Ubicar dirección en el mapa
        </Button>
        {valor.lat != null && (
          <span className="text-xs text-muted-foreground self-center flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5 text-violet-600" /> Ubicada{valor.fuente === "manual" ? " a mano" : valor.fuente === "gps" ? " por GPS" : ""}
          </span>
        )}
      </div>

      {resultados.length > 0 && (
        <div className="rounded-md border divide-y text-xs max-h-40 overflow-y-auto">
          <p className="px-2 py-1 text-muted-foreground">Elegí la más cercana y después ajustá el punto en el mapa si hace falta:</p>
          {resultados.map((r, i) => (
            <button key={i} type="button" className="w-full text-left px-2 py-1.5 hover:bg-muted/50" onClick={() => elegir(r.lat, r.lng, "direccion")}>
              {r.nombre}{!r.exacto && <span className="text-muted-foreground"> · aproximado, ajustá el punto</span>}
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-xs text-amber-700">{error}</p>}

      <MapaBase
        marcadores={marcadores}
        centro={valor.lat != null ? { lat: valor.lat, lng: valor.lng! } : planta?.gps_lat != null ? { lat: Number(planta.gps_lat), lng: Number(planta.gps_lng) } : undefined}
        zoom={valor.lat != null ? 15 : 11}
        alto={240}
        onClick={(p) => elegir(p.lat, p.lng, "manual")}
        onArrastrar={(_id, p) => elegir(p.lat, p.lng, "manual")}
      />
      <p className="text-[11px] text-muted-foreground">Tocá el mapa o arrastrá el punto para corregir la ubicación exacta (por ejemplo, el lote dentro de un barrio).</p>

      <div className="flex gap-2">
        <Input value={pegar} onChange={(e) => setPegar(e.target.value)} placeholder="O pegá un link de Google Maps o coordenadas" className="h-8 text-xs" />
        <Button type="button" variant="outline" size="sm" className="h-8" onClick={usarLink} disabled={!pegar.trim()}><Link2 className="h-3.5 w-3.5" /></Button>
      </div>

      {(calculando || valor.km != null) && (
        <p className="text-xs flex items-center gap-1.5">
          <Route className="h-3.5 w-3.5 text-muted-foreground" />
          {calculando ? "Calculando recorrido..." : <>Desde {planta?.name}: <strong>{valor.km} km</strong> · <strong>~{valor.minutos} min</strong> de viaje para un mixer</>}
        </p>
      )}
    </div>
  )
}
