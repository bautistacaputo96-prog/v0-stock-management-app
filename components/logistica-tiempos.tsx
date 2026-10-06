"use client"

/**
 * Logística · Tiempos reales (Fase 4a): los viajes medidos con el GPS, cruzados con los remitos.
 * Por día, resumen del período, ranking de tiempo en obra y puntualidad. Las referencias de Loop van en gris.
 * Solo lee (viajes_gps la llena el proceso nocturno /api/gps/reconstruir).
 */
import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { AlertTriangle, Info, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { REFERENCIAS_LOOP, fechaAR, promedio, resumirViajes, sumarDias, type ViajeGpsFila } from "@/lib/gps-viajes"

type Viaje = ViajeGpsFila & { id?: string }
type Despacho = {
  id: string
  remito: string | null
  quantity_m3: number | null
  dispatch_date: string
  mixer_id: string
  plant_id: string | null
  client_id: string | null
  construction_site_id: string | null
  scheduled_dispatch_id: string | null
  clients?: { name: string } | null
  construction_sites?: { name: string } | null
  choferes?: { nombre: string } | null
}
type Pedido = { id: string; scheduled_arrival_time: string | null; plant_id: string | null; client_id: string | null; clients?: { name: string } | null; construction_sites?: { name: string } | null }
type Planta = { id: string; name: string; tolerancia_puntualidad_min: number | null }

const TZ = "America/Argentina/Buenos_Aires"
const hora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ }) : "–"
const n0 = (x: number | null | undefined) => (x == null ? "–" : String(Math.round(Number(x))))
const n1 = (x: number | null | undefined) => (x == null ? "–" : Number(x).toLocaleString("es-AR", { maximumFractionDigits: 1 }))
const fechaCorta = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`
const inicioAR = (f: string) => new Date(`${f}T00:00:00-03:00`).toISOString()

function Kpi({ titulo, valor, unidad, loop, nota }: { titulo: string; valor: string; unidad?: string; loop?: string; nota?: string }) {
  return (
    <Card>
      <CardContent className="p-3 md:p-4">
        <p className="text-xs text-muted-foreground">{titulo}</p>
        <p className="text-2xl font-semibold tabular-nums">
          {valor}
          {unidad && valor !== "–" && <span className="text-sm font-normal text-muted-foreground ml-1">{unidad}</span>}
        </p>
        {loop && <p className="text-[11px] text-gray-400">Loop: {loop}</p>}
        {nota && <p className="text-[11px] text-muted-foreground mt-0.5">{nota}</p>}
      </CardContent>
    </Card>
  )
}

function Confianza({ v }: { v: Viaje }) {
  if (!v.dispatch_id) return <Badge variant="outline" className="text-[11px] bg-amber-50 text-amber-800 border-amber-300">Sin remito</Badge>
  const c = { alta: ["Confirmado", "bg-emerald-50 text-emerald-800 border-emerald-300"], media: ["Por orden", "bg-slate-50 text-slate-700 border-slate-300"], baja: ["Dudoso", "bg-orange-50 text-orange-800 border-orange-300"] }[v.confianza || "media"]!
  return <Badge variant="outline" className={cn("text-[11px]", c[1])}>{c[0]}</Badge>
}

export function LogisticaTiempos() {
  const params = useSearchParams()
  // Solo en desarrollo: ver los viajes calculados al vuelo (sin escribir nada), antes de que exista la tabla
  const simular = process.env.NODE_ENV !== "production" && params.get("simular") === "1"
  const ayer = sumarDias(fechaAR(new Date()), -1)
  const [desde, setDesde] = useState(params.get("desde") || sumarDias(ayer, -6))
  const [hasta, setHasta] = useState(params.get("hasta") || ayer)
  const [dia, setDia] = useState(params.get("dia") || params.get("hasta") || ayer)
  const [planta, setPlanta] = useState("todas")
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [viajes, setViajes] = useState<Viaje[]>([])
  const [despachos, setDespachos] = useState<Despacho[]>([])
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [plantas, setPlantas] = useState<Planta[]>([])
  const [mixers, setMixers] = useState<Record<string, string>>({})
  const [obras, setObras] = useState<Record<string, { name: string; cliente: string | null }>>({})

  // El día elegido arrastra el período si queda afuera
  const desdeQ = dia < desde ? dia : desde
  const hastaQ = dia > hasta ? dia : hasta

  useEffect(() => {
    let vivo = true
    ;(async () => {
      setCargando(true)
      setError(null)
      const sb = createClient()
      try {
        const [{ data: pl }, { data: mx }] = await Promise.all([
          sb.from("plants").select("id, name, tolerancia_puntualidad_min").order("name"),
          sb.from("mixers").select("id, license_plate"),
        ])
        // Viajes medidos
        let vs: Viaje[] = []
        if (simular) {
          const r = await fetch(`/api/gps/reconstruir?desde=${desdeQ}&hasta=${hastaQ}&simular=1`).then((x) => x.json())
          if (!r.ok) throw new Error(r.error || "No se pudo simular")
          vs = r.filas || []
        } else {
          const { data, error: e } = await sb
            .from("viajes_gps")
            .select("*")
            .gte("fecha", desdeQ)
            .lte("fecha", hastaQ)
            .order("salida_planta")
            .limit(5000)
          if (e) {
            if (/viajes_gps/.test(e.message || "") || e.code === "42P01" || e.code === "PGRST205") throw new Error("SIN_TABLA")
            throw e
          }
          vs = (data as any) || []
        }
        // Remitos del período (con camión)
        const sel = "id, remito, quantity_m3, dispatch_date, mixer_id, plant_id, client_id, construction_site_id, scheduled_dispatch_id, clients(name), construction_sites(name)"
        let r1: any = await sb.from("dispatches").select(`${sel}, choferes(nombre)`).not("mixer_id", "is", null).gt("quantity_m3", 0)
          .gte("dispatch_date", inicioAR(desdeQ)).lt("dispatch_date", inicioAR(sumarDias(hastaQ, 1))).limit(5000)
        if (r1.error) r1 = await sb.from("dispatches").select(sel).not("mixer_id", "is", null).gt("quantity_m3", 0)
          .gte("dispatch_date", inicioAR(desdeQ)).lt("dispatch_date", inicioAR(sumarDias(hastaQ, 1))).limit(5000)
        if (r1.error) throw r1.error
        const ds: Despacho[] = r1.data || []
        // Pedidos (puntualidad) y obras de los viajes sin remito
        const idsPed = [...new Set(ds.map((d) => d.scheduled_dispatch_id).filter(Boolean))] as string[]
        const idsObra = [...new Set(vs.filter((v) => !v.dispatch_id && v.construction_site_id).map((v) => v.construction_site_id!))]
        const [{ data: ped }, { data: ob }] = await Promise.all([
          idsPed.length
            ? sb.from("scheduled_dispatches").select("id, scheduled_arrival_time, plant_id, client_id, clients(name), construction_sites(name)").in("id", idsPed)
            : Promise.resolve({ data: [] as any[] }),
          idsObra.length ? sb.from("construction_sites").select("id, name, clients(name)").in("id", idsObra) : Promise.resolve({ data: [] as any[] }),
        ])
        if (!vivo) return
        setPlantas((pl as any) || [])
        setMixers(Object.fromEntries(((mx as any) || []).map((m: any) => [m.id, m.license_plate])))
        setViajes(vs)
        setDespachos(ds)
        setPedidos((ped as any) || [])
        setObras(Object.fromEntries(((ob as any) || []).map((o: any) => [o.id, { name: o.name, cliente: o.clients?.name ?? null }])))
      } catch (e: any) {
        if (vivo) setError(e?.message || "Error cargando los viajes")
      } finally {
        if (vivo) setCargando(false)
      }
    })()
    return () => { vivo = false }
  }, [desdeQ, hastaQ, simular])

  const despPorId = useMemo(() => new Map(despachos.map((d) => [d.id, d])), [despachos])
  const nombrePlanta = (id: string | null) => plantas.find((p) => p.id === id)?.name || "–"

  // Viajes con los datos del remito, filtrados por planta de salida
  const enriquecidos = useMemo(
    () =>
      viajes
        .filter((v) => planta === "todas" || v.plant_id_salida === planta)
        .sort((a, b) => a.salida_planta.localeCompare(b.salida_planta))
        .map((v) => {
          const d = v.dispatch_id ? despPorId.get(v.dispatch_id) : undefined
          const o = v.construction_site_id ? obras[v.construction_site_id] : undefined
          return {
            ...v,
            desp: d,
            m3: d ? Number(d.quantity_m3) || 0 : null,
            chofer: d?.choferes?.nombre ?? null,
            cliente: d?.clients?.name ?? o?.cliente ?? null,
            obra: d?.construction_sites?.name ?? o?.name ?? null,
            client_id: d?.client_id ?? null,
          }
        }),
    [viajes, planta, despPorId, obras],
  )
  const delPeriodo = useMemo(() => enriquecidos.filter((v) => v.fecha >= desde && v.fecha <= hasta), [enriquecidos, desde, hasta])
  const resumen = useMemo(() => resumirViajes(delPeriodo), [delPeriodo])

  // Remitos sin viaje
  const usados = useMemo(() => new Set(viajes.map((v) => v.dispatch_id).filter(Boolean)), [viajes])
  const remitosSinViaje = (f1: string, f2: string) =>
    despachos.filter((d) => {
      const f = fechaAR(d.dispatch_date)
      return f >= f1 && f <= f2 && !usados.has(d.id) && (planta === "todas" || d.plant_id === planta)
    })

  // ---------- Día ----------
  const delDia = enriquecidos.filter((v) => v.fecha === dia)
  const sinViajeDia = remitosSinViaje(dia, dia)
  const camionesConViajeDia = new Set(viajes.filter((v) => v.fecha === dia).map((v) => v.mixer_id))
  const diaSinProcesar = viajes.filter((v) => v.fecha === dia).length === 0 && despachos.some((d) => fechaAR(d.dispatch_date) === dia)

  // ---------- Ranking de tiempo en obra ----------
  const confiables = delPeriodo.filter((v) => v.dispatch_id && v.confianza !== "baja" && v.min_obra != null)
  const ranking = (clave: (v: (typeof confiables)[number]) => string | null, nombre: (v: (typeof confiables)[number]) => string) => {
    const g = new Map<string, { nombre: string; mins: number[] }>()
    for (const v of confiables) {
      const k = clave(v)
      if (!k) continue
      const x = g.get(k) || { nombre: nombre(v), mins: [] }
      x.mins.push(Number(v.min_obra))
      g.set(k, x)
    }
    return [...g.values()]
      .map((x) => ({ nombre: x.nombre, viajes: x.mins.length, prom: Math.round(promedio(x.mins) || 0), max: Math.round(Math.max(...x.mins)) }))
      .sort((a, b) => b.prom - a.prom)
  }
  const rankingObras = ranking((v) => v.construction_site_id, (v) => `${v.obra || "Obra sin nombre"}${v.cliente ? ` · ${v.cliente}` : ""}`)
  const rankingClientes = ranking((v) => v.client_id, (v) => v.cliente || "Cliente sin nombre")

  // ---------- Puntualidad: primer camión del pedido contra la hora pedida ----------
  const puntualidad = useMemo(() => {
    const primeros = new Map<string, string>()
    for (const v of delPeriodo) {
      if (!v.desp?.scheduled_dispatch_id || !v.llegada_obra || v.confianza === "baja") continue
      const k = v.desp.scheduled_dispatch_id
      if (!primeros.has(k) || v.llegada_obra < primeros.get(k)!) primeros.set(k, v.llegada_obra)
    }
    const filas = pedidos
      .filter((p) => primeros.has(p.id) && p.scheduled_arrival_time)
      .map((p) => {
        const tol = plantas.find((x) => x.id === p.plant_id)?.tolerancia_puntualidad_min ?? 15
        const llegada = primeros.get(p.id)!
        const dif = Math.round((new Date(llegada).getTime() - new Date(p.scheduled_arrival_time!).getTime()) / 60000)
        return { p, llegada, dif, tol, puntual: dif <= tol }
      })
      .sort((a, b) => b.dif - a.dif)
    const porCliente = new Map<string, { nombre: string; pedidos: number; puntuales: number; difs: number[] }>()
    for (const f of filas) {
      const k = f.p.client_id || "?"
      const x = porCliente.get(k) || { nombre: f.p.clients?.name || "Sin cliente", pedidos: 0, puntuales: 0, difs: [] }
      x.pedidos++
      if (f.puntual) x.puntuales++
      x.difs.push(f.dif)
      porCliente.set(k, x)
    }
    return { filas, porCliente: [...porCliente.values()].sort((a, b) => a.puntuales / a.pedidos - b.puntuales / b.pedidos) }
  }, [delPeriodo, pedidos, plantas])

  if (error === "SIN_TABLA") {
    return (
      <Card className="max-w-xl">
        <CardContent className="p-6 space-y-2">
          <p className="font-semibold">Todavía no hay tiempos medidos</p>
          <p className="text-sm text-muted-foreground">La medición con el GPS todavía no está activada. Cuando se active, cada mañana aparecen acá los viajes del día anterior.</p>
        </CardContent>
      </Card>
    )
  }

  const hayChoferes = resumen.porChofer.length > 0
  const pctPuntual = puntualidad.filas.length ? Math.round((puntualidad.filas.filter((f) => f.puntual).length / puntualidad.filas.length) * 100) : null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Desde</Label>
          <Input type="date" value={desde} max={hasta} onChange={(e) => e.target.value && setDesde(e.target.value)} className="h-9 w-[150px]" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Hasta</Label>
          <Input type="date" value={hasta} min={desde} onChange={(e) => e.target.value && setHasta(e.target.value)} className="h-9 w-[150px]" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Planta</Label>
          <Select value={planta} onValueChange={setPlanta}>
            <SelectTrigger className="h-9 w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas</SelectItem>
              {plantas.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {cargando && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground mb-2.5" />}
        {simular && <Badge variant="outline" className="mb-2 bg-violet-50 text-violet-800 border-violet-300">Simulación (desarrollo): calculado al vuelo, sin guardar</Badge>}
      </div>
      {error && <p className="text-sm text-red-600 flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" />{error}</p>}

      <Tabs defaultValue={params.get("tab") || "dia"}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="dia">Por día</TabsTrigger>
          <TabsTrigger value="resumen">Resumen</TabsTrigger>
          <TabsTrigger value="obras">Tiempo en obra</TabsTrigger>
          <TabsTrigger value="puntualidad">Puntualidad</TabsTrigger>
        </TabsList>

        {/* ---------------- Por día ---------------- */}
        <TabsContent value="dia" className="space-y-3">
          <div className="flex items-end gap-3 flex-wrap">
            <div className="space-y-1">
              <Label className="text-xs">Día</Label>
              <Input type="date" value={dia} onChange={(e) => e.target.value && setDia(e.target.value)} className="h-9 w-[150px]" />
            </div>
            <p className="text-sm text-muted-foreground pb-2">
              {delDia.length} viaje{delDia.length === 1 ? "" : "s"} · {delDia.filter((v) => !v.dispatch_id).length} sin remito · {sinViajeDia.length} remito{sinViajeDia.length === 1 ? "" : "s"} sin viaje
            </p>
          </div>
          {diaSinProcesar && !cargando && (
            <p className="text-sm text-amber-700 flex items-center gap-1.5"><Info className="h-4 w-4" />Ese día tiene remitos pero ningún viaje medido: todavía no se procesó o el GPS no mandó datos.</p>
          )}
          <Card>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Camión</TableHead>
                    <TableHead>Obra</TableHead>
                    <TableHead>Remito</TableHead>
                    <TableHead className="text-center">Sale</TableHead>
                    <TableHead className="text-center">Llega obra</TableHead>
                    <TableHead className="text-center">Sale obra</TableHead>
                    <TableHead className="text-center">Vuelve</TableHead>
                    <TableHead className="text-right">Ida</TableHead>
                    <TableHead className="text-right">Obra</TableHead>
                    <TableHead className="text-right">Vuelta</TableHead>
                    <TableHead className="text-right">Ciclo</TableHead>
                    <TableHead className="text-right">Km ida/vuelta</TableHead>
                    <TableHead className="text-right">En planta</TableHead>
                    <TableHead className="text-right">Ralentí</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {delDia.map((v) => (
                    <TableRow key={`${v.mixer_id}-${v.salida_planta}`} className={cn(!v.dispatch_id && "bg-amber-50/50")}>
                      <TableCell className="whitespace-nowrap">
                        <span className="font-medium">{mixers[v.mixer_id] || "?"}</span>
                        {v.chofer && <span className="block text-xs text-muted-foreground">{v.chofer}</span>}
                        {v.plant_id_vuelta && v.plant_id_vuelta !== v.plant_id_salida && (
                          <span className="block text-[11px] text-muted-foreground">{nombrePlanta(v.plant_id_salida)} → {nombrePlanta(v.plant_id_vuelta)}</span>
                        )}
                      </TableCell>
                      <TableCell className="min-w-[160px]">
                        {v.obra || <span className="text-muted-foreground">–</span>}
                        {v.cliente && <span className="block text-xs text-muted-foreground">{v.cliente}</span>}
                        {v.paradas_extra?.length > 0 && (
                          <span className="block text-[11px] text-muted-foreground">
                            {v.paradas_extra.length} parada{v.paradas_extra.length > 1 ? "s" : ""} fuera de obra ({n0(v.paradas_extra.reduce((s, p) => s + p.min, 0))} min)
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{v.desp?.remito || "–"}{v.m3 != null && <span className="block text-xs text-muted-foreground">{n1(v.m3)} m³</span>}</TableCell>
                      <TableCell className="text-center tabular-nums">{hora(v.salida_planta)}</TableCell>
                      <TableCell className="text-center tabular-nums">{hora(v.llegada_obra)}</TableCell>
                      <TableCell className="text-center tabular-nums">{hora(v.salida_obra)}</TableCell>
                      <TableCell className="text-center tabular-nums">{hora(v.llegada_planta)}</TableCell>
                      <TableCell className="text-right tabular-nums">{n0(v.min_ida)}</TableCell>
                      <TableCell className={cn("text-right tabular-nums", (v.min_obra ?? 0) > 90 && "text-orange-700 font-medium")}>{n0(v.min_obra)}</TableCell>
                      <TableCell className="text-right tabular-nums">{n0(v.min_vuelta)}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{n0(v.ciclo_min)}</TableCell>
                      <TableCell className="text-right tabular-nums whitespace-nowrap">{n1(v.km_ida)} / {n1(v.km_vuelta)}</TableCell>
                      <TableCell className="text-right tabular-nums">{n0(v.min_en_planta)}</TableCell>
                      <TableCell className="text-right tabular-nums">{n0(v.min_motor_parado_planta)}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Confianza v={v} />
                        {v.estado === "incompleto" && <span className="block text-[11px] text-muted-foreground mt-0.5">Incompleto</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                  {delDia.length === 0 && !cargando && (
                    <TableRow><TableCell colSpan={15} className="text-center text-sm text-muted-foreground py-6">No hay viajes medidos ese día.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
          <p className="text-[11px] text-muted-foreground">
            Minutos. "Ciclo" = salida → vuelta a planta. "En planta" = desde que llegó (o arrancó el motor a la mañana) hasta que salió; "Ralentí" = de eso, motor encendido y parado.
            Confirmado = paró en la obra ubicada; Por orden = n.º de viaje del día con n.º de remito; Dudoso = no cierran las cantidades, la planta o el lugar.
          </p>

          {sinViajeDia.length > 0 && (
            <Card>
              <CardContent className="p-3 space-y-2">
                <p className="text-sm font-medium">Remitos sin viaje del GPS</p>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Remito</TableHead><TableHead>Camión</TableHead><TableHead>Obra</TableHead><TableHead>Cargado</TableHead><TableHead>m³</TableHead><TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sinViajeDia.map((d) => (
                        <TableRow key={d.id}>
                          <TableCell>{d.remito || "–"}</TableCell>
                          <TableCell>{mixers[d.mixer_id] || "?"}</TableCell>
                          <TableCell>{d.construction_sites?.name || "–"}<span className="block text-xs text-muted-foreground">{d.clients?.name}</span></TableCell>
                          <TableCell className="tabular-nums">{hora(d.dispatch_date)} · {nombrePlanta(d.plant_id)}</TableCell>
                          <TableCell>{n1(d.quantity_m3)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {!camionesConViajeDia.has(d.mixer_id) ? "El camión no salió de la planta ese día (¿obra pegada a la planta?) o no hubo señal" : "Hay más remitos que viajes para este camión"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ---------------- Resumen ---------------- */}
        <TabsContent value="resumen" className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {fechaCorta(desde)} al {fechaCorta(hasta)} · {resumen.viajes} viajes ({resumen.completos} completos, {resumen.sinRemito} sin remito) · {n1(resumen.m3)} m³
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-2 md:gap-3">
            <Kpi titulo="Ciclo promedio" valor={n0(resumen.ciclo)} unidad="min" loop={`~${REFERENCIAS_LOOP.ciclo} (con la carga)`} nota="salida → vuelta a planta" />
            <Kpi titulo="Tiempo en obra" valor={n0(resumen.obra)} unidad="min" loop={`~${REFERENCIAS_LOOP.obra}`} />
            <Kpi titulo="Ida / vuelta" valor={resumen.ida == null ? "–" : `${n0(resumen.ida)} / ${n0(resumen.vuelta)}`} unidad="min" loop={`ruta ~${REFERENCIAS_LOOP.ruta} (ida + vuelta)`} />
            <Kpi titulo="Tiempo en planta" valor={n0(resumen.enPlanta)} unidad="min" loop={`carga ${REFERENCIAS_LOOP.carga}`} nota="incluye la espera y la carga" />
            <Kpi
              titulo="Ralentí en planta"
              valor={n0(resumen.motorParadoPlanta)}
              unidad="min/viaje"
              loop={`buena práctica ~${REFERENCIAS_LOOP.ralenti}; típico al empezar ~${REFERENCIAS_LOOP.ralentiTipico}`}
              nota="motor encendido y parado · 10 min ≈ 1 L de gasoil"
            />
            <Kpi titulo="Uso de la flota" valor={n0(resumen.usoFlota)} unidad="%" nota="horas en viaje / jornada de 11 h, días trabajados" />
            <Kpi titulo="Minutos por m³" valor={n1(resumen.minPorM3)} unidad="min" nota="ciclo / m³ de los viajes con remito" />
            <Kpi titulo="Km por viaje" valor={n1(resumen.kmPorViaje)} unidad="km" nota="ida + vuelta" />
            <Kpi titulo="Viajes" valor={String(resumen.viajes)} nota={`${resumen.conRemito} con remito`} />
            <Kpi titulo="m³ entregados" valor={n1(resumen.m3)} unidad="m³" nota="de los viajes con remito" />
          </div>

          <div className="grid lg:grid-cols-2 gap-3">
            <Card>
              <CardContent className="p-3">
                <p className="text-sm font-medium mb-2">Por camión</p>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Camión</TableHead><TableHead className="text-right">Viajes</TableHead><TableHead className="text-right">m³</TableHead>
                        <TableHead className="text-right">Días</TableHead><TableHead className="text-right">Uso</TableHead><TableHead className="text-right">Km</TableHead>
                        <TableHead className="text-right">Ralentí/viaje</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[...resumen.porCamion].sort((a, b) => b.viajes - a.viajes).map((c) => (
                        <TableRow key={c.mixer_id}>
                          <TableCell className="font-medium">{mixers[c.mixer_id] || "?"}</TableCell>
                          <TableCell className="text-right tabular-nums">{c.viajes}</TableCell>
                          <TableCell className="text-right tabular-nums">{n1(c.m3)}</TableCell>
                          <TableCell className="text-right tabular-nums">{c.dias}</TableCell>
                          <TableCell className="text-right tabular-nums">{c.uso}%</TableCell>
                          <TableCell className="text-right tabular-nums">{c.km}</TableCell>
                          <TableCell className={cn("text-right tabular-nums", (c.motorParadoPlanta ?? 0) > REFERENCIAS_LOOP.ralenti && "text-orange-700")}>{n0(c.motorParadoPlanta)} min</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <p className="text-sm font-medium mb-2">Por chofer</p>
                {hayChoferes ? (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow><TableHead>Chofer</TableHead><TableHead className="text-right">Viajes</TableHead><TableHead className="text-right">m³</TableHead><TableHead className="text-right">Ralentí/viaje</TableHead></TableRow>
                      </TableHeader>
                      <TableBody>
                        {[...resumen.porChofer].sort((a, b) => b.m3 - a.m3).map((c) => (
                          <TableRow key={c.chofer}>
                            <TableCell>{c.chofer}</TableCell>
                            <TableCell className="text-right tabular-nums">{c.viajes}</TableCell>
                            <TableCell className="text-right tabular-nums">{n1(c.m3)}</TableCell>
                            <TableCell className={cn("text-right tabular-nums", (c.motorParadoPlanta ?? 0) > REFERENCIAS_LOOP.ralenti && "text-orange-700")}>{n0(c.motorParadoPlanta)} min</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Todavía no hay choferes en los remitos de este período. Aparecen cuando se elige el chofer al despachar.</p>
                )}
              </CardContent>
            </Card>
          </div>
          <p className="text-[11px] text-gray-400">Referencias de Loop 4 (empresas de hormigón elaborado): ciclo ~150 min con la carga, obra ~70, carga menos de 20–25, ruta ~60, ralentí en planta ~35 por viaje.</p>
        </TabsContent>

        {/* ---------------- Tiempo en obra ---------------- */}
        <TabsContent value="obras" className="space-y-3">
          <p className="text-sm text-muted-foreground">Los que más retienen los camiones ({fechaCorta(desde)} al {fechaCorta(hasta)}). Se cuentan los viajes con remito confirmados o por orden. <span className="text-gray-400">Loop: obra ~{REFERENCIAS_LOOP.obra} min</span></p>
          <div className="grid lg:grid-cols-2 gap-3">
            {[{ titulo: "Por cliente", filas: rankingClientes }, { titulo: "Por obra", filas: rankingObras }].map((b) => (
              <Card key={b.titulo}>
                <CardContent className="p-3">
                  <p className="text-sm font-medium mb-2">{b.titulo}</p>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow><TableHead>{b.titulo === "Por cliente" ? "Cliente" : "Obra"}</TableHead><TableHead className="text-right">Viajes</TableHead><TableHead className="text-right">Promedio</TableHead><TableHead className="text-right">Máximo</TableHead></TableRow>
                      </TableHeader>
                      <TableBody>
                        {b.filas.slice(0, 30).map((f) => (
                          <TableRow key={f.nombre}>
                            <TableCell>{f.nombre}</TableCell>
                            <TableCell className="text-right tabular-nums">{f.viajes}</TableCell>
                            <TableCell className={cn("text-right tabular-nums font-medium", f.prom > REFERENCIAS_LOOP.obra && "text-orange-700")}>{f.prom} min</TableCell>
                            <TableCell className="text-right tabular-nums">{f.max} min</TableCell>
                          </TableRow>
                        ))}
                        {b.filas.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-4">Sin datos en el período.</TableCell></TableRow>}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* ---------------- Puntualidad ---------------- */}
        <TabsContent value="puntualidad" className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Llegada del primer camión de cada pedido contra la hora pedida, con la tolerancia de la planta (15 min).{" "}
            {pctPuntual != null && <strong className="text-foreground">{pctPuntual}% puntuales ({puntualidad.filas.length} pedidos).</strong>}
          </p>
          <div className="grid lg:grid-cols-[1fr_1.4fr] gap-3">
            <Card>
              <CardContent className="p-3">
                <p className="text-sm font-medium mb-2">Por cliente</p>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead>Cliente</TableHead><TableHead className="text-right">Pedidos</TableHead><TableHead className="text-right">Puntuales</TableHead><TableHead className="text-right">Atraso prom.</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                      {puntualidad.porCliente.map((c) => (
                        <TableRow key={c.nombre}>
                          <TableCell>{c.nombre}</TableCell>
                          <TableCell className="text-right tabular-nums">{c.pedidos}</TableCell>
                          <TableCell className="text-right tabular-nums">{Math.round((c.puntuales / c.pedidos) * 100)}%</TableCell>
                          <TableCell className="text-right tabular-nums">{n0(promedio(c.difs))} min</TableCell>
                        </TableRow>
                      ))}
                      {puntualidad.porCliente.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-4">Sin pedidos medidos en el período.</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <p className="text-sm font-medium mb-2">Pedidos</p>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead>Día</TableHead><TableHead>Cliente / obra</TableHead><TableHead className="text-center">Pedida</TableHead><TableHead className="text-center">Llegó</TableHead><TableHead className="text-right">Diferencia</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                      {puntualidad.filas.slice(0, 60).map((f) => (
                        <TableRow key={f.p.id}>
                          <TableCell className="whitespace-nowrap">{fechaCorta(fechaAR(f.llegada))}</TableCell>
                          <TableCell>{f.p.clients?.name || "–"}<span className="block text-xs text-muted-foreground">{f.p.construction_sites?.name}</span></TableCell>
                          <TableCell className="text-center tabular-nums">{hora(f.p.scheduled_arrival_time)}</TableCell>
                          <TableCell className="text-center tabular-nums">{hora(f.llegada)}</TableCell>
                          <TableCell className={cn("text-right tabular-nums font-medium", f.puntual ? "text-emerald-700" : "text-red-700")}>
                            {f.dif > 0 ? `+${f.dif}` : f.dif} min
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>
          <p className="text-[11px] text-muted-foreground">Llegar antes también cuenta como puntual. Sin remito o con cruce dudoso no se cuenta. Cancelados y suspendidos se suman cuando exista el motivo (Fase 3).</p>
        </TabsContent>
      </Tabs>
    </div>
  )
}
