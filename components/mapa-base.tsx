"use client"

/**
 * Mapa liviano con Leaflet + OpenStreetMap (gratis). Leaflet se carga desde CDN
 * para no sumar dependencias. Recibe marcadores y avisa los clics.
 * Botón "Mapa / Satélite": la vista satelital usa las imágenes de Esri (World Imagery), útil para ubicar
 * el lote exacto en barrios y obras nuevas que todavía no figuran en el mapa.
 */
import { useEffect, useRef, useState } from "react"

const CAPAS = {
  mapa: { url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' },
  satelite: { url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", maxZoom: 19, attribution: "Tiles &copy; Esri" },
} as const

declare global {
  interface Window { L?: any }
}

let cargando: Promise<any> | null = null
export function cargarLeaflet(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject()
  if (window.L) return Promise.resolve(window.L)
  if (cargando) return cargando
  cargando = new Promise((resolve, reject) => {
    const css = document.createElement("link")
    css.rel = "stylesheet"
    css.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css"
    document.head.appendChild(css)
    const js = document.createElement("script")
    js.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"
    js.onload = () => resolve(window.L)
    js.onerror = reject
    document.head.appendChild(js)
  })
  return cargando
}

export type Marcador = {
  id: string
  lat: number
  lng: number
  /** HTML del ícono (se dibuja con divIcon) */
  html: string
  popup?: string
  arrastrable?: boolean
  tamano?: [number, number]
}

type Props = {
  marcadores: Marcador[]
  centro?: { lat: number; lng: number }
  zoom?: number
  alto?: number | string
  /** Ajustar la vista a todos los marcadores cuando cambian */
  encuadrar?: boolean
  onClick?: (p: { lat: number; lng: number }) => void
  onArrastrar?: (id: string, p: { lat: number; lng: number }) => void
  className?: string
}

export function MapaBase({ marcadores, centro = { lat: -34.9, lng: -58.3 }, zoom = 11, alto = 420, encuadrar = true, onClick, onArrastrar, className }: Props) {
  const div = useRef<HTMLDivElement>(null)
  const mapa = useRef<any>(null)
  const capa = useRef<any>(null)
  const encuadrado = useRef(false)
  const fondo = useRef<any>(null)
  const [vista, setVista] = useState<"mapa" | "satelite">("mapa")
  const cbClick = useRef(onClick)
  const cbDrag = useRef(onArrastrar)
  cbClick.current = onClick
  cbDrag.current = onArrastrar

  useEffect(() => {
    let vivo = true
    cargarLeaflet().then((L) => {
      if (!vivo || !div.current || mapa.current) return
      mapa.current = L.map(div.current, { zoomControl: true, attributionControl: true }).setView([centro.lat, centro.lng], zoom)
      fondo.current = L.tileLayer(CAPAS.mapa.url, { maxZoom: CAPAS.mapa.maxZoom, attribution: CAPAS.mapa.attribution }).addTo(mapa.current)
      capa.current = L.layerGroup().addTo(mapa.current)
      mapa.current.on("click", (e: any) => cbClick.current?.({ lat: e.latlng.lat, lng: e.latlng.lng }))
      dibujar()
    })
    return () => {
      vivo = false
      mapa.current?.remove()
      mapa.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function dibujar() {
    const L = window.L
    if (!L || !mapa.current || !capa.current) return
    capa.current.clearLayers()
    const puntos: any[] = []
    marcadores.forEach((m) => {
      const [w, h] = m.tamano || [30, 30]
      const icono = L.divIcon({ html: m.html, className: "", iconSize: [w, h], iconAnchor: [w / 2, h / 2] })
      const mk = L.marker([m.lat, m.lng], { icon: icono, draggable: !!m.arrastrable })
      if (m.popup) mk.bindPopup(m.popup)
      if (m.arrastrable) mk.on("dragend", (e: any) => { const p = e.target.getLatLng(); cbDrag.current?.(m.id, { lat: p.lat, lng: p.lng }) })
      mk.addTo(capa.current)
      puntos.push([m.lat, m.lng])
    })
    if (encuadrar && puntos.length && !encuadrado.current) {
      if (puntos.length === 1) mapa.current.setView(puntos[0], zoom)
      else mapa.current.fitBounds(puntos, { padding: [40, 40], maxZoom: 15 })
      encuadrado.current = true
    }
  }

  // Redibujar cuando cambian los marcadores
  useEffect(() => { dibujar() }, [JSON.stringify(marcadores.map((m) => [m.id, m.lat, m.lng, m.html]))]) // eslint-disable-line react-hooks/exhaustive-deps

  // Permite volver a encuadrar desde afuera (ej. al elegir otra dirección)
  useEffect(() => { encuadrado.current = false; dibujar() }, [centro.lat, centro.lng]) // eslint-disable-line react-hooks/exhaustive-deps

  // Cambiar el fondo (mapa / satélite) sin tocar los marcadores
  useEffect(() => {
    const L = window.L
    if (!L || !mapa.current) return
    fondo.current?.remove()
    const c = CAPAS[vista]
    fondo.current = L.tileLayer(c.url, { maxZoom: c.maxZoom, attribution: c.attribution }).addTo(mapa.current)
    fondo.current.bringToBack?.()
  }, [vista])

  return (
    <div className={className} style={{ position: "relative", height: alto, width: "100%" }}>
      <div ref={div} style={{ height: "100%", width: "100%", borderRadius: 8, zIndex: 0 }} />
      <div style={{ position: "absolute", top: 8, right: 8, zIndex: 1000, display: "flex", borderRadius: 6, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,.3)" }}>
        {(["mapa", "satelite"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={(e) => { e.stopPropagation(); setVista(v) }}
            style={{ padding: "3px 8px", font: "600 11px system-ui", background: vista === v ? "#0f172a" : "#fff", color: vista === v ? "#fff" : "#0f172a", border: "none", cursor: "pointer" }}
          >
            {v === "mapa" ? "Mapa" : "Satélite"}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Íconos simples reutilizables */
export const iconos = {
  planta: (nombre: string) =>
    `<div style="background:#0f172a;color:#fff;border-radius:6px;padding:2px 6px;font:600 11px system-ui;white-space:nowrap;transform:translate(-25%,-50%);box-shadow:0 1px 3px rgba(0,0,0,.3)">🏭 ${nombre}</div>`,
  obra: (color = "#7c3aed") =>
    `<div style="width:18px;height:18px;border-radius:50% 50% 50% 0;background:${color};transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)"></div>`,
  camion: (patente: string, color: string) =>
    `<div style="display:flex;align-items:center;gap:3px;transform:translate(-30%,-50%)"><div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 0 2px ${color}55"></div><span style="background:#fff;border:1px solid ${color};color:#0f172a;border-radius:4px;padding:0 4px;font:600 11px system-ui;white-space:nowrap">${patente}</span></div>`,
}
