"use client"

/**
 * Mapa liviano con Leaflet + OpenStreetMap (gratis). Leaflet se carga desde CDN
 * para no sumar dependencias. Recibe marcadores y avisa los clics.
 * Botón "Mapa / Satélite": la vista satelital usa las imágenes de Esri (World Imagery), útil para ubicar
 * el lote exacto en barrios y obras nuevas que todavía no figuran en el mapa.
 */
import { useEffect, useRef, useState } from "react"

/**
 * Zoom: OSM y Esri tienen imágenes propias hasta el 19 en la zona (verificado el 21/10/2026: en Canning, Esri
 * devuelve "sin datos" desde el 20). Se deja acercar hasta el 21 estirando las del 19 (overzoom), para ver el
 * patio de la planta o la cuadra de la obra.
 */
const ZOOM_MAXIMO = 21
const CAPAS = {
  mapa: { url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", maxNativeZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' },
  satelite: { url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", maxNativeZoom: 19, attribution: "Tiles &copy; Esri" },
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
  /** Punto del ícono que cae exactamente en lat/lng (px desde arriba a la izquierda). Por defecto, el centro. */
  ancla?: [number, number]
  /** Dibujarlo por encima de los demás (el camión elegido) */
  encima?: boolean
}

/** Llevar el mapa a un punto. `clave` distinta = volar con zoom; misma clave y otro punto = seguirlo sin tocar el zoom. */
export type Foco = { lat: number; lng: number; zoom?: number; clave: string | number }

type Props = {
  marcadores: Marcador[]
  centro?: { lat: number; lng: number }
  zoom?: number
  alto?: number | string
  /** Ajustar la vista a todos los marcadores cuando cambian */
  encuadrar?: boolean
  onClick?: (p: { lat: number; lng: number }) => void
  onArrastrar?: (id: string, p: { lat: number; lng: number }) => void
  /** Tocaron un marcador (además de abrir su popup, si tiene) */
  onMarcadorClick?: (id: string) => void
  /** Centrar el mapa en un punto (ver Foco) */
  foco?: Foco | null
  /** Cambiarlo vuelve a encuadrar todos los marcadores */
  reencuadre?: number
  className?: string
}

export function MapaBase({
  marcadores, centro = { lat: -34.9, lng: -58.3 }, zoom = 11, alto = 420, encuadrar = true, onClick, onArrastrar, onMarcadorClick,
  foco, reencuadre, className,
}: Props) {
  const div = useRef<HTMLDivElement>(null)
  const mapa = useRef<any>(null)
  const capa = useRef<any>(null)
  const encuadrado = useRef(false)
  const fondo = useRef<any>(null)
  /** Marcadores dibujados, por id: se actualizan en el lugar (así un popup abierto no se cierra en cada refresco) */
  const dibujados = useRef(new Map<string, { mk: any; html: string; popup?: string; arrastrable: boolean; firma: string }>())
  const ultimoFoco = useRef<string | number | null>(null)
  const [vista, setVista] = useState<"mapa" | "satelite">("mapa")
  const cbClick = useRef(onClick)
  const cbDrag = useRef(onArrastrar)
  const cbMarcador = useRef(onMarcadorClick)
  cbClick.current = onClick
  cbDrag.current = onArrastrar
  cbMarcador.current = onMarcadorClick

  useEffect(() => {
    let vivo = true
    cargarLeaflet().then((L) => {
      if (!vivo || !div.current || mapa.current) return
      mapa.current = L.map(div.current, { zoomControl: true, attributionControl: true, maxZoom: ZOOM_MAXIMO }).setView([centro.lat, centro.lng], zoom)
      fondo.current = L.tileLayer(CAPAS.mapa.url, { maxZoom: ZOOM_MAXIMO, maxNativeZoom: CAPAS.mapa.maxNativeZoom, attribution: CAPAS.mapa.attribution }).addTo(mapa.current)
      capa.current = L.layerGroup().addTo(mapa.current)
      mapa.current.on("click", (e: any) => cbClick.current?.({ lat: e.latlng.lat, lng: e.latlng.lng }))
      dibujar()
      enfocar()
    })
    return () => {
      vivo = false
      mapa.current?.remove()
      mapa.current = null
      dibujados.current.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function icono(L: any, m: Marcador) {
    const [w, h] = m.tamano || [30, 30]
    return L.divIcon({ html: m.html, className: "", iconSize: [w, h], iconAnchor: m.ancla || [w / 2, h / 2] })
  }

  function dibujar() {
    const L = window.L
    if (!L || !mapa.current || !capa.current) return
    const vistos = new Set<string>()
    const puntos: any[] = []
    marcadores.forEach((m) => {
      vistos.add(m.id)
      puntos.push([m.lat, m.lng])
      const firma = JSON.stringify([m.tamano, m.ancla])
      const ya = dibujados.current.get(m.id)
      if (ya && ya.arrastrable === !!m.arrastrable && ya.firma === firma) {
        // Mismo marcador: se mueve y se actualiza en el lugar
        const p = ya.mk.getLatLng()
        if (p.lat !== m.lat || p.lng !== m.lng) ya.mk.setLatLng([m.lat, m.lng])
        if (ya.html !== m.html) { ya.mk.setIcon(icono(L, m)); ya.html = m.html }
        if (ya.popup !== m.popup) {
          if (m.popup) { if (ya.mk.getPopup()) ya.mk.setPopupContent(m.popup); else ya.mk.bindPopup(m.popup) } else ya.mk.unbindPopup()
          ya.popup = m.popup
        }
        ya.mk.setZIndexOffset(m.encima ? 1000 : 0)
        return
      }
      if (ya) { capa.current.removeLayer(ya.mk); dibujados.current.delete(m.id) }
      const mk = L.marker([m.lat, m.lng], { icon: icono(L, m), draggable: !!m.arrastrable, zIndexOffset: m.encima ? 1000 : 0 })
      if (m.popup) mk.bindPopup(m.popup)
      if (m.arrastrable) mk.on("dragend", (e: any) => { const p = e.target.getLatLng(); cbDrag.current?.(m.id, { lat: p.lat, lng: p.lng }) })
      mk.on("click", () => cbMarcador.current?.(m.id))
      mk.addTo(capa.current)
      dibujados.current.set(m.id, { mk, html: m.html, popup: m.popup, arrastrable: !!m.arrastrable, firma })
    })
    for (const [id, d] of dibujados.current) if (!vistos.has(id)) { capa.current.removeLayer(d.mk); dibujados.current.delete(id) }
    if (encuadrar && puntos.length && !encuadrado.current && ultimoFoco.current == null) {
      if (puntos.length === 1) mapa.current.setView(puntos[0], zoom)
      else mapa.current.fitBounds(puntos, { padding: [40, 40], maxZoom: 15 })
      encuadrado.current = true
    }
  }

  function enfocar() {
    if (!mapa.current || !foco) return
    if (foco.clave !== ultimoFoco.current) {
      ultimoFoco.current = foco.clave
      encuadrado.current = true
      mapa.current.flyTo([foco.lat, foco.lng], foco.zoom ?? 16, { duration: 0.6 })
    } else {
      mapa.current.panTo([foco.lat, foco.lng], { animate: true })
    }
  }

  // Redibujar cuando cambian los marcadores
  useEffect(() => { dibujar() }, [JSON.stringify(marcadores.map((m) => [m.id, m.lat, m.lng, m.html, m.popup, m.arrastrable, m.tamano, m.ancla, m.encima]))]) // eslint-disable-line react-hooks/exhaustive-deps

  // Permite volver a encuadrar desde afuera (ej. al elegir otra dirección)
  useEffect(() => { encuadrado.current = false; dibujar() }, [centro.lat, centro.lng]) // eslint-disable-line react-hooks/exhaustive-deps

  // Ir al punto elegido (y seguirlo si se mueve)
  useEffect(() => { if (!foco) ultimoFoco.current = null; else enfocar() }, [foco?.clave, foco?.lat, foco?.lng]) // eslint-disable-line react-hooks/exhaustive-deps

  // Volver a ver todo
  useEffect(() => {
    if (!reencuadre || !mapa.current) return
    const puntos = marcadores.map((m) => [m.lat, m.lng])
    if (puntos.length > 1) mapa.current.fitBounds(puntos, { padding: [40, 40], maxZoom: 15 })
    else if (puntos.length === 1) mapa.current.setView(puntos[0], zoom)
  }, [reencuadre]) // eslint-disable-line react-hooks/exhaustive-deps

  // Cambiar el fondo (mapa / satélite) sin tocar los marcadores
  useEffect(() => {
    const L = window.L
    if (!L || !mapa.current) return
    fondo.current?.remove()
    const c = CAPAS[vista]
    fondo.current = L.tileLayer(c.url, { maxZoom: ZOOM_MAXIMO, maxNativeZoom: c.maxNativeZoom, attribution: c.attribution }).addTo(mapa.current)
    fondo.current.bringToBack?.()
  }, [vista])

  return (
    <div className={className} style={{ position: "relative", height: alto, width: "100%" }}>
      <style>{"@keyframes mapaPulso{0%{transform:scale(.6);opacity:1}100%{transform:scale(1.6);opacity:0}}"}</style>
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

/**
 * Íconos simples reutilizables. Cada uno trae su `tamano` y su `ancla`: el punto del ícono que cae justo en la
 * coordenada (el centro del círculo del camión, la base del pin de la obra). Hasta el 21/10/2026 el camión se
 * corría ~80 px a la izquierda de su posición real (gps-vivo.md).
 */
export const iconos = {
  planta: (nombre: string) =>
    `<div style="position:relative;width:12px;height:12px"><div style="width:12px;height:12px;border-radius:3px;background:#0f172a;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)"></div><div style="position:absolute;left:15px;top:-4px;background:#0f172a;color:#fff;border-radius:6px;padding:2px 6px;font:600 11px system-ui;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.3)">🏭 ${nombre}</div></div>`,
  tamPlanta: [12, 12] as [number, number],
  obra: (color = "#7c3aed") =>
    `<div style="width:18px;height:18px;border-radius:50% 50% 50% 0;background:${color};transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)"></div>`,
  tamObra: [22, 22] as [number, number],
  /** La punta del pin (abajo al centro del rombo girado) */
  anclaObra: [9, 22] as [number, number],
  /**
   * Camión: círculo centrado en la posición, con una flecha hacia donde va si se mueve y la patente al costado.
   * `destacado` = el que se eligió en la lista (más grande, con un halo que late).
   */
  camion: (patente: string, color: string, o: { rumbo?: number | null; enMovimiento?: boolean; destacado?: boolean } = {}) => {
    const d = o.destacado ? 22 : 16
    const off = (TAM_CAMION - d) / 2
    const flecha = o.enMovimiento && o.rumbo != null
      ? `<div style="position:absolute;left:0;top:0;width:${TAM_CAMION}px;height:${TAM_CAMION}px;transform:rotate(${Math.round(o.rumbo)}deg)"><div style="position:absolute;left:${TAM_CAMION / 2 - 5}px;top:${off - 8}px;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:9px solid ${color}"></div></div>`
      : ""
    const halo = o.destacado
      ? `<div style="position:absolute;left:${off - 6}px;top:${off - 6}px;width:${d + 12}px;height:${d + 12}px;border-radius:50%;background:${color}55;animation:mapaPulso 1.4s ease-out infinite"></div>`
      : ""
    return `<div style="position:relative;width:${TAM_CAMION}px;height:${TAM_CAMION}px">${halo}${flecha}<div style="position:absolute;left:${off}px;top:${off}px;width:${d}px;height:${d}px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 0 2px ${color}55,0 1px 3px rgba(0,0,0,.4)"></div><span style="position:absolute;left:${TAM_CAMION + 2}px;top:${TAM_CAMION / 2 - 9}px;background:#fff;border:${o.destacado ? 2 : 1}px solid ${color};color:#0f172a;border-radius:4px;padding:0 4px;font:600 ${o.destacado ? 12 : 11}px/16px system-ui;white-space:nowrap">${patente}</span></div>`
  },
  tamCamion: [24, 24] as [number, number],
}
const TAM_CAMION = 24
