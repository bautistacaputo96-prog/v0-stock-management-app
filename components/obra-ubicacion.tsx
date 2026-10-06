"use client"

/**
 * Ubicar una obra en el mapa: se busca la dirección, se elige el resultado, y el
 * punto se puede mover o marcar con un clic (útil en barrios cerrados y lotes,
 * donde la dirección no alcanza). También acepta pegar un link de Google Maps.
 * Con la ubicación calcula la distancia y el tiempo de viaje desde la planta.
 *
 * Buscador libre "como Google Maps": sugerencias mientras se escribe (Google Places desde el servidor, o
 * OpenStreetMap si no hay clave o Google falla), con flechas y Enter. Mapa / Satélite en el mapa.
 */
import { useState, useEffect, useRef } from "react"
import type { Sugerencia, FuenteLugar } from "@/lib/geo-lugares"
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
  // Buscador libre con sugerencias
  const [texto, setTexto] = useState("")
  const [sugerencias, setSugerencias] = useState<Sugerencia[]>([])
  const [fuente, setFuente] = useState<FuenteLugar | null>(null)
  const [abierto, setAbierto] = useState(false)
  const [activo, setActivo] = useState(-1)
  const [buscandoSug, setBuscandoSug] = useState(false)
  // La lista muestra el resultado de la búsqueda completa (como apretar Enter en Google Maps)
  const [modoBusqueda, setModoBusqueda] = useState(false)
  const sesion = useRef<string | null>(null)
  const escrito = useRef(false) // solo se busca si la persona escribió (no al elegir una sugerencia)

  useEffect(() => {
    createClient().from("plants").select("id, name, gps_lat, gps_lng").then(({ data }) => setPlantas((data as any) || []))
  }, [])

  const planta = plantas.find((p) => p.id === plantaId) || plantas.find((p) => p.gps_lat != null)

  // Sugerencias: 300 ms después de dejar de escribir, desde 3 letras. Un token de sesión por búsqueda
  // (se renueva después de elegir) para que Google cobre la sesión entera y no cada tecla.
  useEffect(() => {
    if (!escrito.current) return
    const q = texto.trim()
    if (q.length < 3) { setSugerencias([]); setAbierto(false); return }
    if (!sesion.current) sesion.current = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    let vivo = true
    const t = setTimeout(async () => {
      setBuscandoSug(true)
      try {
        const r = await fetch(`/api/geo/autocompletar?q=${encodeURIComponent(q)}&planta=${encodeURIComponent(plantaId || planta?.id || "")}&sesion=${encodeURIComponent(sesion.current || "")}`)
        const d = await r.json()
        if (!vivo) return
        // Si el autocompletado no sugiere nada, se hace solo la búsqueda completa
        if (!(d.sugerencias || []).length) { await buscarCompleto(q); return }
        setSugerencias(d.sugerencias || [])
        setFuente(d.fuente || null)
        setModoBusqueda(false)
        setActivo(-1)
        setAbierto(true)
      } catch {
        if (vivo) setSugerencias([])
      }
      if (vivo) setBuscandoSug(false)
    }, 300)
    return () => { vivo = false; clearTimeout(t) }
  }, [texto]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Búsqueda completa ("Enter" de Google Maps): encuentra barrios y caminos que el autocompletado no sugiere */
  async function buscarCompleto(q: string = texto) {
    const t = q.trim()
    if (t.length < 3) return
    setBuscandoSug(true)
    try {
      const r = await fetch(`/api/geo/buscar-texto?q=${encodeURIComponent(t)}&planta=${encodeURIComponent(plantaId || planta?.id || "")}`)
      const d = await r.json()
      setSugerencias(d.sugerencias || [])
      setFuente(d.fuente || null)
    } catch {
      setSugerencias([])
    }
    setModoBusqueda(true)
    setActivo(-1)
    setAbierto(true)
    setBuscandoSug(false)
  }

  async function elegirSugerencia(sg: Sugerencia) {
    escrito.current = false
    setTexto([sg.principal, sg.secundario].filter(Boolean).join(", "))
    setAbierto(false); setSugerencias([]); setError(null)
    if (sg.lat != null && sg.lng != null) { sesion.current = null; elegir(sg.lat, sg.lng, "direccion"); return }
    try {
      const r = await fetch(`/api/geo/lugar?id=${encodeURIComponent(sg.id)}&sesion=${encodeURIComponent(sesion.current || "")}`)
      const d = await r.json()
      if (d.lugar) elegir(d.lugar.lat, d.lugar.lng, "direccion")
      else setError(d.error || "No se pudo ubicar ese lugar: marcá el punto en el mapa")
    } catch { setError("No se pudo ubicar ese lugar: marcá el punto en el mapa") }
    sesion.current = null
  }

  // Renglones navegables: las sugerencias y, al final (en el autocompletado), "Buscar «texto»"
  const conBuscar = !modoBusqueda && texto.trim().length >= 3
  const renglones = sugerencias.length + (conBuscar ? 1 : 0)
  function teclas(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault()
      // Enter sin nada marcado (o sobre "Buscar…") = búsqueda completa, como en Google Maps
      if (abierto && activo >= 0 && activo < sugerencias.length) elegirSugerencia(sugerencias[activo])
      else buscarCompleto()
      return
    }
    if (!abierto || !renglones) return
    if (e.key === "ArrowDown") { e.preventDefault(); setActivo((i) => (i + 1) % renglones) }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActivo((i) => (i <= 0 ? renglones - 1 : i - 1)) }
    else if (e.key === "Escape") { e.preventDefault(); setAbierto(false) }
  }

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
      {/* Buscador libre con sugerencias (como Google Maps) */}
      <div className="relative">
        <div className="relative">
          <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={texto}
            onChange={(e) => { escrito.current = true; setTexto(e.target.value) }}
            onKeyDown={teclas}
            onFocus={() => sugerencias.length && setAbierto(true)}
            onBlur={() => setTimeout(() => setAbierto(false), 150)}
            placeholder="Buscá la obra: barrio, calle y número, lugar…"
            className="pl-8 h-9"
            role="combobox"
            aria-expanded={abierto}
            aria-autocomplete="list"
            autoComplete="off"
          />
          {buscandoSug && <Loader2 className="h-4 w-4 animate-spin absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />}
        </div>
        {abierto && (
          <div className="absolute left-0 right-0 top-full mt-1 rounded-md border bg-popover shadow-md text-sm overflow-hidden" style={{ zIndex: 1100 }} role="listbox">
            {modoBusqueda && sugerencias.length > 0 && (
              <p className="px-3 py-1 text-[10px] uppercase tracking-wide text-muted-foreground border-b bg-muted/40">Resultados de la búsqueda</p>
            )}
            {sugerencias.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">{modoBusqueda ? "Sin resultados: probá con otras palabras, o marcá el punto en el mapa." : "Sin sugerencias."}</p>
            ) : (
              sugerencias.map((sg, i) => (
                <button
                  key={sg.id}
                  type="button"
                  role="option"
                  aria-selected={i === activo}
                  onMouseDown={(e) => { e.preventDefault(); elegirSugerencia(sg) }}
                  onMouseEnter={() => setActivo(i)}
                  className={`w-full text-left px-3 py-1.5 flex items-start gap-2 ${i === activo ? "bg-muted" : "hover:bg-muted/60"}`}
                >
                  <MapPin className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{sg.principal}</span>
                    {sg.secundario && <span className="block truncate text-xs text-muted-foreground">{sg.secundario}</span>}
                  </span>
                  {sg.busqueda && <span className="shrink-0 self-center rounded border px-1 text-[9px] text-muted-foreground">resultado de búsqueda</span>}
                </button>
              ))
            )}
            {conBuscar && (
              <button
                type="button"
                role="option"
                aria-selected={activo === sugerencias.length}
                onMouseDown={(e) => { e.preventDefault(); buscarCompleto() }}
                onMouseEnter={() => setActivo(sugerencias.length)}
                className={`w-full text-left px-3 py-1.5 flex items-center gap-2 border-t text-sm ${activo === sugerencias.length ? "bg-muted" : "hover:bg-muted/60"}`}
              >
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate">Buscar «{texto.trim()}»{fuente === "google" ? " en Google Maps" : ""}</span>
              </button>
            )}
            {fuente === "google" && sugerencias.length > 0 && (
              <p className="px-3 py-1 text-[10px] text-right text-muted-foreground border-t">Powered by Google</p>
            )}
          </div>
        )}
      </div>

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
