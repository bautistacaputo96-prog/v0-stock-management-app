"use client"

/**
 * Logística · En vivo: dónde está cada mixer ahora, a qué obra va y cuánto le falta.
 * Consulta el GPS cada 30 s solo mientras la pantalla está visible.
 */
import { useEffect, useMemo, useState, useCallback } from "react"
import { useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { MapaBase, iconos, type Marcador } from "@/components/mapa-base"
import { Truck, Radio, Link2, RefreshCw, AlertTriangle, CheckCircle2, MapPin } from "lucide-react"
import { formatDistanceToNowStrict, parseISO, format } from "date-fns"
import { es } from "date-fns/locale"
import { cn } from "@/lib/utils"

type Camion = {
  unidad_id: number
  patente: string
  mixer_id: string | null
  lat: number | null
  lng: number | null
  velocidad: number | null
  ultima_posicion: string | null
  motor: boolean | null
  estado: "en_planta" | "hacia_obra" | "en_obra" | "volviendo" | "detenido" | "sin_senal"
  planta_cercana: { nombre: string; km: number } | null
  minutos_a_planta: number | null
  minutos_a_obra: number | null
  despacho: null | {
    id: string; remito: string | null; m3: number; salida: string; minutos_desde_salida: number | null
    cliente: string | null; obra: { id: string; nombre: string; lat: number | null; lng: number | null } | null
  }
}

export const ESTADOS: Record<Camion["estado"], { label: string; color: string; bg: string }> = {
  en_planta: { label: "En planta", color: "#0f766e", bg: "bg-teal-100 text-teal-800" },
  hacia_obra: { label: "Hacia la obra", color: "#2563eb", bg: "bg-blue-100 text-blue-800" },
  en_obra: { label: "En obra", color: "#d97706", bg: "bg-amber-100 text-amber-800" },
  volviendo: { label: "Volviendo", color: "#7c3aed", bg: "bg-violet-100 text-violet-800" },
  detenido: { label: "Detenido", color: "#64748b", bg: "bg-slate-100 text-slate-700" },
  sin_senal: { label: "Sin señal", color: "#dc2626", bg: "bg-red-100 text-red-700" },
}

export function useGps(intervaloMs = 30000) {
  const [datos, setDatos] = useState<{ conectado: boolean; camiones: Camion[]; actualizado?: string; error?: string } | null>(null)
  const [cargando, setCargando] = useState(false)
  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const r = await fetch("/api/gps/posiciones", { cache: "no-store" })
      setDatos(await r.json())
    } catch {
      setDatos((d) => ({ conectado: d?.conectado ?? true, camiones: d?.camiones || [], error: "No se pudo actualizar" }))
    }
    setCargando(false)
  }, [])
  useEffect(() => {
    cargar()
    const t = setInterval(() => { if (document.visibilityState === "visible") cargar() }, intervaloMs)
    return () => clearInterval(t)
  }, [cargar, intervaloMs])
  return { datos, cargando, recargar: cargar }
}

/** Vía alternativa: pegar un token que generó el soporte de Bilderit. */
function PegarToken({ onListo }: { onListo: () => void }) {
  const [abierto, setAbierto] = useState(false)
  const [token, setToken] = useState("")
  const [estado, setEstado] = useState<string | null>(null)
  async function guardar() {
    setEstado("Verificando...")
    const r = await fetch("/api/gps/conectar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) })
    const d = await r.json()
    if (d.ok) { setEstado(null); setToken(""); onListo() } else setEstado(d.error || "No se pudo conectar")
  }
  if (!abierto) {
    return (
      <p className="text-xs text-muted-foreground">
        ¿Entrás a B-Track desde Bilderit y no tenés contraseña propia?{" "}
        <button className="underline" onClick={() => setAbierto(true)}>Pegá un token de acceso</button> que te genere el soporte de Bilderit (pediles uno de Wialon, solo lectura).
      </p>
    )
  }
  return (
    <div className="space-y-2 border-t pt-3">
      <p className="text-xs text-muted-foreground">Pedile a Bilderit un token de Wialon de solo lectura (seguimiento en línea y última posición) para la cuenta de Rebucret, y pegalo acá. No se muestra en ningún lado.</p>
      <div className="flex gap-2">
        <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Token de Wialon" className="flex-1 h-9 rounded-md border px-3 text-sm bg-background" autoComplete="off" />
        <Button size="sm" onClick={guardar} disabled={token.trim().length < 20}>Conectar</Button>
      </div>
      {estado && <p className="text-xs text-amber-700">{estado}</p>}
    </div>
  )
}

export function LogisticaEnVivo() {
  const params = useSearchParams()
  const { datos, cargando, recargar } = useGps()
  const [plantas, setPlantas] = useState<{ id: string; name: string; gps_lat: number | null; gps_lng: number | null }[]>([])
  const [obrasHoy, setObrasHoy] = useState<{ id: string; name: string; gps_lat: number; gps_lng: number; cliente: string; hora: string; m3: number }[]>([])
  const [sinUbicar, setSinUbicar] = useState(0)

  useEffect(() => {
    const sb = createClient()
    sb.from("plants").select("id, name, gps_lat, gps_lng").then(({ data }) => setPlantas((data as any) || []))
    const hoy = new Date(); const ini = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()); const fin = new Date(ini.getTime() + 86400000)
    sb.from("scheduled_dispatches")
      .select("scheduled_arrival_time, quantity_m3, clients(name), construction_sites(id, name, gps_lat, gps_lng)")
      .gte("scheduled_arrival_time", ini.toISOString()).lt("scheduled_arrival_time", fin.toISOString()).neq("status", "cancelled")
      .then(({ data }) => {
        const obras = (data || []).map((d: any) => ({ ...d.construction_sites, cliente: d.clients?.name, hora: d.scheduled_arrival_time, m3: d.quantity_m3 }))
        setSinUbicar(obras.filter((o: any) => o.gps_lat == null).length)
        setObrasHoy(obras.filter((o: any) => o.gps_lat != null))
      })
  }, [])

  const marcadores: Marcador[] = useMemo(() => [
    ...plantas.filter((p) => p.gps_lat != null).map((p) => ({ id: `p-${p.id}`, lat: Number(p.gps_lat), lng: Number(p.gps_lng), html: iconos.planta(p.name), tamano: [90, 20] as [number, number] })),
    ...obrasHoy.map((o, i) => ({ id: `o-${o.id}-${i}`, lat: Number(o.gps_lat), lng: Number(o.gps_lng), html: iconos.obra(), tamano: [22, 22] as [number, number], popup: `<b>${o.name}</b><br>${o.cliente || ""}<br>${o.m3} m³ · ${format(parseISO(o.hora), "HH:mm")}` })),
    ...(datos?.camiones || []).filter((c) => c.lat != null).map((c) => ({
      id: `c-${c.unidad_id}`, lat: c.lat!, lng: c.lng!, html: iconos.camion(c.patente, ESTADOS[c.estado].color), tamano: [110, 20] as [number, number],
      popup: `<b>${c.patente}</b> · ${ESTADOS[c.estado].label}${c.despacho ? `<br>${c.despacho.obra?.nombre || ""} · R ${c.despacho.remito || "-"}` : ""}`,
    })),
  ], [plantas, obrasHoy, datos])

  if (datos && !datos.conectado) {
    return (
      <Card className="max-w-xl">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <Radio className="h-6 w-6 text-muted-foreground" />
            <div>
              <p className="font-semibold">Conectar el GPS de los camiones</p>
              <p className="text-sm text-muted-foreground">Se conecta con B-Track (Bilderit). El acceso es de solo lectura: el sistema ve las posiciones y no puede modificar nada en B-Track.</p>
            </div>
          </div>
          {params.get("error") && <p className="text-sm text-red-600">No se pudo conectar: {params.get("error")}</p>}
          <ol className="text-sm list-decimal list-inside space-y-1 text-muted-foreground">
            <li>Tocá el botón. Se abre la página de Wialon, que es el sistema detrás de B-Track.</li>
            <li>Entrá con tu usuario y contraseña de B-Track y aceptá el acceso.</li>
            <li>Vuelve solo a esta pantalla con los camiones en el mapa.</li>
          </ol>
          <Button asChild className="gap-2"><a href="/api/gps/conectar"><Link2 className="h-4 w-4" /> Conectar con B-Track</a></Button>
          <PegarToken onListo={recargar} />
        </CardContent>
      </Card>
    )
  }

  const camiones = datos?.camiones || []
  const orden: Camion["estado"][] = ["hacia_obra", "en_obra", "volviendo", "en_planta", "detenido", "sin_senal"]

  return (
    <div className="space-y-4">
      {params.get("conectado") && (
        <p className="text-sm text-emerald-700 flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4" /> GPS conectado.</p>
      )}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-2 flex-wrap">
          {orden.map((e) => {
            const n = camiones.filter((c) => c.estado === e).length
            if (!n) return null
            return <Badge key={e} className={cn("font-medium", ESTADOS[e].bg)} variant="outline">{ESTADOS[e].label}: {n}</Badge>
          })}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {datos?.actualizado && <span>Actualizado {format(parseISO(datos.actualizado), "HH:mm:ss")} · se refresca cada 30 s</span>}
          <Button variant="outline" size="sm" onClick={recargar} disabled={cargando}><RefreshCw className={cn("h-3.5 w-3.5", cargando && "animate-spin")} /></Button>
        </div>
      </div>
      {datos?.error && <p className="text-sm text-amber-700 flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" />{datos.error}</p>}

      <div className="grid lg:grid-cols-[1fr_340px] gap-4">
        <Card className="overflow-hidden">
          <MapaBase marcadores={marcadores} alto={560} zoom={11} />
          {sinUbicar > 0 && (
            <p className="text-xs text-amber-700 px-3 py-2 flex items-center gap-1.5 border-t"><MapPin className="h-3.5 w-3.5" />{sinUbicar} pedido{sinUbicar > 1 ? "s" : ""} de hoy van a obras sin ubicar. Ubicalas en Clientes → obra → Ubicación en el mapa.</p>
          )}
        </Card>

        <div className="space-y-2">
          {[...camiones].sort((a, b) => orden.indexOf(a.estado) - orden.indexOf(b.estado)).map((c) => (
            <Card key={c.unidad_id}>
              <CardContent className="p-3 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold flex items-center gap-1.5"><Truck className="h-4 w-4" style={{ color: ESTADOS[c.estado].color }} />{c.patente}</span>
                  <Badge variant="outline" className={cn("text-[11px]", ESTADOS[c.estado].bg)}>{ESTADOS[c.estado].label}</Badge>
                </div>
                {c.despacho ? (
                  <p className="text-xs text-muted-foreground">
                    {c.despacho.cliente} · <strong className="text-foreground">{c.despacho.obra?.nombre || "obra sin nombre"}</strong> · {c.despacho.m3} m³ · R {c.despacho.remito || "-"}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">Sin despacho hoy</p>
                )}
                <p className="text-xs">
                  {c.estado === "hacia_obra" && c.minutos_a_obra != null && <>Llega a obra en <strong>~{c.minutos_a_obra} min</strong> · </>}
                  {(c.estado === "volviendo" || c.estado === "en_obra") && c.minutos_a_planta != null && <>A planta: <strong>~{c.minutos_a_planta} min</strong> · </>}
                  {c.despacho?.minutos_desde_salida != null && c.estado !== "en_planta" && <>salió hace {c.despacho.minutos_desde_salida} min · </>}
                  {c.velocidad != null && c.velocidad > 3 && <>{c.velocidad} km/h · </>}
                  <span className="text-muted-foreground">{c.ultima_posicion ? `posición ${formatDistanceToNowStrict(parseISO(c.ultima_posicion), { locale: es, addSuffix: true })}` : "sin posición"}</span>
                </p>
                {!c.mixer_id && <p className="text-[11px] text-amber-700">Esta unidad no coincide con ningún camión cargado en el sistema.</p>}
              </CardContent>
            </Card>
          ))}
          {datos && camiones.length === 0 && <p className="text-sm text-muted-foreground">No hay unidades en la cuenta de GPS.</p>}
        </div>
      </div>
    </div>
  )
}
