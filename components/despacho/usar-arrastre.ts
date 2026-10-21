"use client"

/**
 * Arrastrar un viaje hasta un camión (fase 3, como Loop) con pointer events: anda con el dedo en la tablet y con el
 * mouse en la PC, sin librerías.
 *   - Mouse: se arrastra al mover más de 8 px con el botón apretado (o desde la manija ⠿).
 *   - Dedo: se arrastra desde la manija ⠿ o dejando el dedo apretado un momento (280 ms) sobre la tarjeta; si el
 *     dedo se mueve antes, es scroll y no pasa nada.
 *   - Se suelta sobre un camión (elemento con data-camion) → onSoltar. Si se suelta fuera, no pasa nada.
 * No es obligatorio: el botón Despachar y el tocar viaje → camión hacen lo mismo.
 */
import { useCallback, useEffect, useRef, useState } from "react"

type Estado = {
  clave: string | null
  x0: number
  y0: number
  pid: number | null
  tipo: string
  activo: boolean
  timer: ReturnType<typeof setTimeout> | null
}

export function usarArrastre(opts: {
  habilitado: boolean
  onSoltar: (viajeClave: string, camionId: string) => void
  onTocar: (viajeClave: string) => void
}) {
  const [fantasma, setFantasma] = useState<{ clave: string; x: number; y: number } | null>(null)
  const [sobre, setSobre] = useState<string | null>(null)
  const st = useRef<Estado>({ clave: null, x0: 0, y0: 0, pid: null, tipo: "mouse", activo: false, timer: null })
  const recienSoltado = useRef(false)
  const cb = useRef(opts)
  cb.current = opts

  const limpiar = useCallback(() => {
    if (st.current.timer) clearTimeout(st.current.timer)
    st.current = { clave: null, x0: 0, y0: 0, pid: null, tipo: "mouse", activo: false, timer: null }
    setFantasma(null)
    setSobre(null)
  }, [])

  const camionEn = (x: number, y: number) => {
    const el = typeof document !== "undefined" ? document.elementFromPoint(x, y) : null
    const c = el && (el as HTMLElement).closest ? ((el as HTMLElement).closest("[data-camion]") as HTMLElement | null) : null
    return c?.dataset.camion || null
  }

  const activar = useCallback((x: number, y: number) => {
    const s = st.current
    if (!s.clave || s.activo) return
    if (s.timer) clearTimeout(s.timer)
    s.activo = true
    setFantasma({ clave: s.clave, x, y })
    try { if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(15) } catch { /* sin vibración */ }
  }, [])

  useEffect(() => {
    const mover = (ev: PointerEvent) => {
      const s = st.current
      if (!s.clave || ev.pointerId !== s.pid) return
      const dist = Math.hypot(ev.clientX - s.x0, ev.clientY - s.y0)
      if (!s.activo) {
        if (s.tipo === "mouse" && dist > 8 && ev.buttons === 1) activar(ev.clientX, ev.clientY)
        else if (s.tipo !== "mouse" && dist > 10) limpiar() // es scroll
        return
      }
      setFantasma({ clave: s.clave, x: ev.clientX, y: ev.clientY })
      setSobre(camionEn(ev.clientX, ev.clientY))
    }
    const soltar = (ev: PointerEvent) => {
      const s = st.current
      if (!s.clave || ev.pointerId !== s.pid) return
      if (!s.activo) { limpiar(); return }
      const clave = s.clave
      const camion = camionEn(ev.clientX, ev.clientY)
      const quieto = Math.hypot(ev.clientX - s.x0, ev.clientY - s.y0) < 10
      limpiar()
      recienSoltado.current = true
      setTimeout(() => (recienSoltado.current = false), 80)
      if (camion) cb.current.onSoltar(clave, camion)
      else if (quieto) cb.current.onTocar(clave)
    }
    const cancelar = () => limpiar()
    // Mientras se arrastra con el dedo, la página no hace scroll
    const tocar = (e: TouchEvent) => { if (st.current.activo) e.preventDefault() }
    document.addEventListener("pointermove", mover)
    document.addEventListener("pointerup", soltar)
    document.addEventListener("pointercancel", cancelar)
    document.addEventListener("touchmove", tocar, { passive: false })
    return () => {
      document.removeEventListener("pointermove", mover)
      document.removeEventListener("pointerup", soltar)
      document.removeEventListener("pointercancel", cancelar)
      document.removeEventListener("touchmove", tocar)
    }
  }, [activar, limpiar])

  /** onPointerDown de la tarjeta del viaje. `manija` = se tocó la manija ⠿ (arranca enseguida). */
  const empezar = useCallback((ev: React.PointerEvent, clave: string, manija = false) => {
    if (!cb.current.habilitado) return
    if ((ev.target as HTMLElement).closest("button, a, input, select") && !manija) return
    st.current = { clave, x0: ev.clientX, y0: ev.clientY, pid: ev.pointerId, tipo: ev.pointerType || "mouse", activo: false, timer: null }
    if (manija) { activar(ev.clientX, ev.clientY); return }
    if (ev.pointerType !== "mouse") {
      const x = ev.clientX, y = ev.clientY
      st.current.timer = setTimeout(() => activar(x, y), 280)
    }
  }, [activar])

  return { empezar, fantasma, sobre, recienSoltado }
}
