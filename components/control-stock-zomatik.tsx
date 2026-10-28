"use client"
/**
 * Materias Primas › Control de stock. Stock de materia prima por planta y material, nuestro sistema contra Zomatik
 * (INVENTARIO › MOVIMIENTOS STOCK), con el detalle por día al tocar una fila. Todo por /api/control-stock.
 * Docs: docs/control-stock-mp.md.
 */
import { Fragment, useCallback, useEffect, useState } from "react"
import { Loader2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { enHorarioDelCron, MENSAJE_HORARIO_CRON } from "@/lib/control-stock/calculo"

type Dia = { fecha: string; entro: number; salio: number; ajustes: number; saldo: number }
type Lado = { inicio: number; entro: number; salio: number; ajustes: number; final: number; porDia: Dia[]; porPrefijo?: Record<string, { entro: number; salio: number; n: number }> }
type Dif = { t: number; pct: number | null; rojo: boolean }
type Fila = {
  plantaId: string
  planta: string
  materialId: string
  material: string
  nuestro: Lado
  sinRegistro: number | null
  ultimoRecuento: string | null
  zomatik: Lado | null
  comparacion: { final: Dif; neto: Dif; entro: Dif; salio: Dif; rojo: boolean } | null
  lectura: { leidoAt: string | null; vieja: boolean; error: string | null; totalEsInicial: boolean | null; totalAcumulado: number | null; saldoInicial: number | null; idarticulo: string | null; verificado: string | null; desde: string | null } | null
}

const n1 = (x: number | null | undefined) => (x === null || x === undefined ? "-" : x.toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }))
const pct = (p: number | null) => (p === null ? "-" : `${p > 0 ? "+" : ""}${p.toLocaleString("es-AR", { maximumFractionDigits: 1 })} %`)
const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`
const hora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" }) : "-"

function CeldaDif({ d }: { d: Dif | undefined | null }) {
  if (!d) return <td className="px-1.5 py-1 text-muted-foreground">-</td>
  return (
    <td className={`px-1.5 py-1 text-right ${d.rojo ? "text-red-700" : ""}`}>
      {n1(d.t)} <span className={d.rojo ? "" : "text-muted-foreground"}>({pct(d.pct)})</span>
    </td>
  )
}

export function ControlStockZomatik() {
  const [desde, setDesde] = useState("")
  const [hasta, setHasta] = useState("")
  const [filas, setFilas] = useState<Fila[] | null>(null)
  const [periodo, setPeriodo] = useState<{ desde: string; hasta: string } | null>(null)
  const [abierta, setAbierta] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [leyendo, setLeyendo] = useState(false)

  const cargar = useCallback(async () => {
    setErr(null)
    const p = new URLSearchParams()
    if (desde) p.set("desde", desde)
    if (hasta) p.set("hasta", hasta)
    try {
      const r = await fetch(`/api/control-stock?${p}`, { cache: "no-store" })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        setErr(j?.error || `Error ${r.status}`)
        setFilas([])
        return
      }
      setFilas(j.filas || [])
      setPeriodo({ desde: j.desde, hasta: j.hasta })
    } catch {
      setErr("No se pudo cargar. Probá de nuevo.")
      setFilas([])
    }
  }, [desde, hasta])

  useEffect(() => {
    cargar()
  }, [cargar])

  async function actualizar() {
    setLeyendo(true)
    setErr(null)
    setMsg(null)
    try {
      const r = await fetch("/api/control-stock/actualizar", { method: "POST" })
      const j = await r.json().catch(() => ({}))
      const leidas = (j?.partes || []).filter((p: any) => p.ok).length
      if (j?.partes) setMsg(`Zomatik: ${leidas} de ${j.partes.length} leídos.`)
      if (j?.error) setErr(j.error)
    } catch {
      setErr("No se pudo leer Zomatik. Probá de nuevo en un rato.")
    }
    setLeyendo(false)
    cargar()
  }

  const horarioCron = enHorarioDelCron()
  const ultimaLectura = (filas || []).map((f) => f.lectura?.leidoAt).filter((x): x is string => !!x).sort().pop() || null

  return (
    <div className="space-y-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Input type="date" className="h-7 w-36 text-xs" value={desde} onChange={(e) => setDesde(e.target.value)} title="Desde (por defecto, el 1.º del mes)" />
        <Input type="date" className="h-7 w-36 text-xs" value={hasta} onChange={(e) => setHasta(e.target.value)} title="Hasta (por defecto, hoy)" />
        <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" disabled={leyendo || horarioCron} onClick={actualizar} title={horarioCron ? MENSAJE_HORARIO_CRON : undefined}>
          {leyendo ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Actualizar ahora
        </Button>
        {horarioCron && <span className="text-muted-foreground">{MENSAJE_HORARIO_CRON}</span>}
        <span
          className="cursor-help text-muted-foreground"
          title="Stock de materia prima en toneladas, nuestro sistema contra Zomatik (INVENTARIO › MOVIMIENTOS STOCK, REBUCRET). Nuestro: el stock de cada día se arma desde el stock actual, con los ingresos (cantidad del remito, sin secar), los consumos de los despachos y los recuentos o ajustes. Zomatik: RMP son compras y RMI consumos. En rojo, más de 5 % de diferencia y al menos media tonelada, en el stock final o en el neto (entró − salió: una devolución no lo cambia). En gris, las filas con la lectura de Zomatik vieja. Tocá una fila para ver el detalle por día. Zomatik se lee solo todos los días, después del mail de las 16:25. Mails: todos los días a las 16:25, a Juan (con copia a Bautista), las inconsistencias de remitos detectadas ese día, o “sin inconsistencias hoy”; los lunes, en su lugar, el semanal con las nuevas, todas las abiertas y la tabla de stock."
        >
          (?)
        </span>
      </div>
      <div className="text-muted-foreground">
        {periodo ? `Del ${ddmm(periodo.desde)} al ${ddmm(periodo.hasta)}` : ""}
        {ultimaLectura ? ` · Zomatik leído ${hora(ultimaLectura)}` : " · Zomatik todavía no se leyó"}
      </div>
      {msg && <div className="text-emerald-700">{msg}</div>}
      {err && <div className="text-red-700">{err}</div>}

      {!filas ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : filas.length === 0 ? (
        <div className="text-muted-foreground">Sin materiales para mostrar.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-muted-foreground">
                <th className="px-1.5 py-1 text-left font-normal" colSpan={2}></th>
                <th className="border-l px-1.5 py-1 text-left font-normal" colSpan={5}>
                  Nuestro sistema (t)
                </th>
                <th className="border-l px-1.5 py-1 text-left font-normal" colSpan={4}>
                  Zomatik (t)
                </th>
                <th className="border-l px-1.5 py-1 text-left font-normal" colSpan={4}>
                  Diferencia (t y %)
                </th>
                <th></th>
              </tr>
              <tr className="border-b text-right text-muted-foreground">
                <th className="px-1.5 py-1 text-left font-normal">Planta</th>
                <th className="px-1.5 py-1 text-left font-normal">Material</th>
                <th className="border-l px-1.5 py-1 font-normal">Inicio</th>
                <th className="px-1.5 py-1 font-normal">Entró</th>
                <th className="px-1.5 py-1 font-normal">Salió</th>
                <th className="px-1.5 py-1 font-normal">Recuentos</th>
                <th className="px-1.5 py-1 font-normal">Final</th>
                <th className="border-l px-1.5 py-1 font-normal">Inicio</th>
                <th className="px-1.5 py-1 font-normal">Entró</th>
                <th className="px-1.5 py-1 font-normal">Salió</th>
                <th className="px-1.5 py-1 font-normal">Final</th>
                <th className="border-l px-1.5 py-1 font-normal">Final</th>
                <th className="px-1.5 py-1 font-normal" title="Entró − salió: una devolución no lo cambia">Neto</th>
                <th className="px-1.5 py-1 font-normal">Entró</th>
                <th className="px-1.5 py-1 font-normal">Salió</th>
                <th className="px-1.5 py-1 text-left font-normal"></th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => {
                const k = f.materialId
                const z = f.zomatik
                const c = f.comparacion
                const vieja = !!(z && f.lectura?.vieja && f.lectura.leidoAt)
                const avisos = [
                  !z && !f.lectura?.error ? "sin lectura de Zomatik" : null,
                  f.lectura?.error ? `última lectura de Zomatik: ${f.lectura.error}` : null,
                  vieja ? `lectura del ${ddmm(new Date(Date.parse(f.lectura!.leidoAt!) - 3 * 3600_000).toISOString().slice(0, 10))}` : null,
                  f.sinRegistro ? `ajuste sin registro ${n1(f.sinRegistro)} t` : null,
                ].filter(Boolean)
                return (
                  <Fragment key={k}>
                    <tr className={`cursor-pointer border-b hover:bg-muted/50 ${vieja ? "text-muted-foreground" : c?.rojo ? "bg-red-50/60" : ""}`} onClick={() => setAbierta(abierta === k ? null : k)}>
                      <td className="px-1.5 py-1">{f.planta}</td>
                      <td className="px-1.5 py-1">{f.material}</td>
                      <td className="border-l px-1.5 py-1 text-right">{n1(f.nuestro.inicio)}</td>
                      <td className="px-1.5 py-1 text-right">{n1(f.nuestro.entro)}</td>
                      <td className="px-1.5 py-1 text-right">{n1(f.nuestro.salio)}</td>
                      <td className="px-1.5 py-1 text-right">{f.nuestro.ajustes ? n1(f.nuestro.ajustes) : "-"}</td>
                      <td className="px-1.5 py-1 text-right">{n1(f.nuestro.final)}</td>
                      <td className="border-l px-1.5 py-1 text-right">{n1(z?.inicio)}</td>
                      <td className="px-1.5 py-1 text-right">{n1(z?.entro)}</td>
                      <td className="px-1.5 py-1 text-right">{n1(z?.salio)}</td>
                      <td className="px-1.5 py-1 text-right">{n1(z?.final)}</td>
                      <CeldaDif d={c?.final} />
                      <CeldaDif d={c?.neto} />
                      <CeldaDif d={c?.entro} />
                      <CeldaDif d={c?.salio} />
                      <td className="px-1.5 py-1 text-amber-700">{avisos.join(" · ")}</td>
                    </tr>
                    {abierta === k && (
                      <tr className="border-b bg-muted/30">
                        <td colSpan={16} className="px-2 py-2">
                          <Detalle f={f} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Detalle({ f }: { f: Fila }) {
  const zDia = new Map((f.zomatik?.porDia || []).map((d) => [d.fecha, d]))
  return (
    <div className="space-y-2">
      <div className="text-muted-foreground">
        {f.ultimoRecuento ? `Último recuento: ${hora(f.ultimoRecuento)}` : "Sin recuento"}
        {f.sinRegistro ? ` · el stock actual no cierra con el libro desde ese recuento: ${n1(f.sinRegistro)} t de ajuste sin registro` : ""}
        {f.lectura?.leidoAt ? ` · Zomatik leído ${hora(f.lectura.leidoAt)} (idarticulo ${f.lectura.idarticulo || "-"}, ${f.lectura.verificado === "verificado" ? "verificado con los remitos de compra" : "sin verificar"})` : ""}
        {f.lectura && f.lectura.totalEsInicial === false
          ? ` · ojo: el "Total acumulado" de Zomatik (${n1(f.lectura.totalAcumulado)}) no es el saldo inicial (${n1(f.lectura.saldoInicial)})`
          : ""}
      </div>
      {f.zomatik?.porPrefijo && (
        <div className="text-muted-foreground">
          Zomatik por comprobante:{" "}
          {Object.entries(f.zomatik.porPrefijo)
            .map(([p, v]) => `${p} ${v.n} (${v.entro ? `+${n1(v.entro)}` : ""}${v.entro && v.salio ? " / " : ""}${v.salio ? `−${n1(v.salio)}` : ""})`)
            .join(" · ")}
        </div>
      )}
      <table className="border-collapse">
        <thead>
          <tr className="border-b text-right text-muted-foreground">
            <th className="px-1.5 py-0.5 text-left font-normal">Día</th>
            <th className="border-l px-1.5 py-0.5 font-normal">Entró</th>
            <th className="px-1.5 py-0.5 font-normal">Salió</th>
            <th className="px-1.5 py-0.5 font-normal">Recuentos</th>
            <th className="px-1.5 py-0.5 font-normal">Stock</th>
            <th className="border-l px-1.5 py-0.5 font-normal">Z entró</th>
            <th className="px-1.5 py-0.5 font-normal">Z salió</th>
            <th className="px-1.5 py-0.5 font-normal">Z stock</th>
            <th className="border-l px-1.5 py-0.5 font-normal">Diferencia</th>
          </tr>
        </thead>
        <tbody>
          {f.nuestro.porDia.map((d) => {
            const z = zDia.get(d.fecha)
            const dif = z ? d.saldo - z.saldo : null
            const hay = d.entro || d.salio || d.ajustes || z?.entro || z?.salio
            return (
              <tr key={d.fecha} className={`border-b text-right ${hay ? "" : "text-muted-foreground"}`}>
                <td className="px-1.5 py-0.5 text-left">{ddmm(d.fecha)}</td>
                <td className="border-l px-1.5 py-0.5">{d.entro ? n1(d.entro) : ""}</td>
                <td className="px-1.5 py-0.5">{d.salio ? n1(d.salio) : ""}</td>
                <td className="px-1.5 py-0.5">{d.ajustes ? n1(d.ajustes) : ""}</td>
                <td className="px-1.5 py-0.5">{n1(d.saldo)}</td>
                <td className="border-l px-1.5 py-0.5">{z?.entro ? n1(z.entro) : ""}</td>
                <td className="px-1.5 py-0.5">{z?.salio ? n1(z.salio) : ""}</td>
                <td className="px-1.5 py-0.5">{z ? n1(z.saldo) : "-"}</td>
                <td className="border-l px-1.5 py-0.5">{dif === null ? "-" : n1(dif)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
