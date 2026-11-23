"use client"
/**
 * Materias Primas › Control de stock · la tarjeta de arriba: lo despachado en nuestro sistema contra Zomatik en los
 * últimos 7 días cerrados (m³ con OF, materia prima por grupo y OF sin la materia prima descontada). Hoy va aparte, en
 * gris. Todo por /api/control-stock/despacho. Docs: docs/specs/2026-11-20-control-cruzado-despacho-zomatik.md.
 */
import { Fragment, useCallback, useEffect, useState } from "react"
import { Loader2 } from "lucide-react"

type Estado = "bien" | "ambar" | "rojo" | "gris"
type DiaM3 = { fecha: string; sistema: number; zomatik: number; dif: number; estado: Estado; nota: string | null }
type Producto = { clave: string; nombre: string; formulas: string[]; dias: { fecha: string; sistema: number; zomatik: number }[]; sistema: number; zomatik: number }
type Grupo = {
  grupo: string
  nombre: string
  sistema: number
  seco: number
  zomatik: number
  movido: number
  estado: Estado
  texto: string
  nota: string | null
  lectura: { leidoAt: string | null; error: string | null } | null
  materiales: { nombre: string; codigo: string | null; sistema: number; zomatik: number | null }[]
  porDia: { fecha: string; sistema: number; zomatik: number }[]
  ajustes: { fecha: string; material: string; comprobante: string; t: number }[]
}
type Planta = {
  plantaId: string
  planta: string
  m3: { dias: DiaM3[]; semana: { sistema: number; zomatik: number; estado: Estado; texto: string | null }; hoy: { sistema: number; zomatik: number }; productos: Producto[] }
  grupos: Grupo[]
}
type Respuesta = {
  hoy: string
  desde: string
  hasta: string
  semaforo: { estado: "verde" | "ambar" | "rojo"; titulo: string; avisos: string[] }
  lectura: { alDia: boolean; leidoAt: string | null; produccion: { leidoAt: string | null; alDia: boolean; error: string | null }; sinLeer: string[] }
  plantas: Planta[]
  ofSinMp: { fecha: string; planta: string; of: string | null; m3: number; formula: string | null; motivo: string }[]
}

const n1 = (x: number | null | undefined) => (x === null || x === undefined ? "-" : x.toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }))
const m3 = (x: number) => x.toLocaleString("es-AR", { maximumFractionDigits: 2 })
const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`
const hora = (iso: string | null | undefined, hoy: string) => {
  if (!iso) return "nunca"
  const a = new Date(Date.parse(iso) - 3 * 3600_000).toISOString()
  return `${a.slice(0, 10) === hoy ? "hoy" : ddmm(a.slice(0, 10))} ${a.slice(11, 16)}`
}
const color = (e: Estado) => (e === "rojo" ? "text-red-700" : e === "ambar" ? "text-amber-700" : e === "gris" ? "text-muted-foreground" : "")
const SEMAFORO = { verde: { punto: "bg-emerald-600", texto: "Todo bien" }, ambar: { punto: "bg-amber-500", texto: "No se pudo leer Zomatik hoy" }, rojo: { punto: "bg-red-600", texto: "Hay diferencias" } }
const AYUDA =
  "Compara los últimos 7 días cerrados. Hoy no cuenta: las OF se hacen al finalizar el pedido o a la noche. En rojo: m³ que no coinciden (0,5 o más) o materia prima con más de 5 % y media tonelada de diferencia, por grupo (cemento, arenas y piedras: las composiciones de Zomatik no reparten los áridos igual que nuestras fórmulas; material por material es solo informativo). En ámbar: OF de ayer o anteayer que todavía no están. La arena se descuenta con humedad en el sistema y seca en Zomatik: no cuenta. Zomatik se lee solo a las 5:45."

/** Celda de m³: un número si coincide; "sistema / Zomatik" si no. */
function CeldaM3({ s, z, estado }: { s: number; z: number; estado: Estado }) {
  const igual = Math.abs(s - z) < 0.5
  return <td className={`px-1.5 py-1 text-right ${igual ? "" : color(estado)}`}>{!s && !z ? "-" : igual ? m3(z) : `${m3(s)} / ${m3(z)}`}</td>
}

export function ControlDespachoZomatik({ version = 0 }: { version?: number }) {
  const [d, setD] = useState<Respuesta | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [abierta, setAbierta] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const r = await fetch("/api/control-stock/despacho", { cache: "no-store" })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j?.faltaMigracion || j?.error) {
        setD(null)
        setAviso(j?.error || `Error ${r.status}`)
      } else {
        setD(j)
        setAviso(null)
      }
    } catch {
      setD(null)
      setAviso("No se pudo cargar el control del despacho.")
    }
    setCargando(false)
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar, version])

  if (cargando && !d) return <div className="rounded border p-2 text-xs"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
  if (!d) return <div className="rounded border p-2 text-xs text-muted-foreground">Despacho contra Zomatik: {aviso}</div>

  const dias = d.plantas[0]?.m3.dias.map((x) => x.fecha) || []
  const s = SEMAFORO[d.semaforo.estado]
  const temprano = !d.lectura.alDia && new Date(Date.now() - 3 * 3600_000).getUTCHours() < 6

  return (
    <div className={`space-y-2 rounded border p-2 text-xs ${temprano ? "text-muted-foreground" : ""}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>Despacho contra Zomatik · {ddmm(d.desde)} al {ddmm(d.hasta)}</span>
        <span className="text-muted-foreground">· Zomatik leído {hora(d.lectura.leidoAt, d.hoy)}</span>
        <span className="ml-auto flex items-center gap-1">
          <span className={`inline-block h-2 w-2 rounded-full ${temprano ? "bg-slate-400" : s.punto}`} />
          {s.texto}
        </span>
        <span className="cursor-help text-muted-foreground" title={AYUDA}>
          (?)
        </span>
      </div>
      {temprano && <div>Zomatik se lee solo a las 5:45: hasta entonces la tarjeta queda en gris.</div>}
      {!d.lectura.alDia && !temprano && (
        <div className="text-amber-700">
          Sin leer hoy: {d.lectura.sinLeer.join(", ")}
          {d.lectura.produccion.error && !d.lectura.produccion.alDia ? ` (reporte de producción: ${d.lectura.produccion.error})` : ""}
        </div>
      )}
      {d.semaforo.avisos.map((a) => (
        <div key={a} className="text-muted-foreground">
          {a}
        </div>
      ))}

      <div className="overflow-x-auto">
        <div className="text-muted-foreground">m³ despachados / con OF</div>
        <table className="border-collapse">
          <thead>
            <tr className="border-b text-right text-muted-foreground">
              <th className="px-1.5 py-1 text-left font-normal">Planta</th>
              {dias.map((f) => (
                <th key={f} className="px-1.5 py-1 font-normal">
                  {ddmm(f)}
                </th>
              ))}
              <th className="border-l px-1.5 py-1 font-normal">Semana</th>
              <th className="px-1.5 py-1 text-left font-normal"></th>
              <th className="border-l px-1.5 py-1 font-normal">Hoy</th>
            </tr>
          </thead>
          <tbody>
            {d.plantas.map((p) => {
              const k = `m3:${p.plantaId}`
              const sem = p.m3.semana
              return (
                <Fragment key={k}>
                  <tr className="cursor-pointer border-b hover:bg-muted/50" onClick={() => setAbierta(abierta === k ? null : k)}>
                    <td className="px-1.5 py-1">{p.planta}</td>
                    {p.m3.dias.map((x) => (
                      <CeldaM3 key={x.fecha} s={x.sistema} z={x.zomatik} estado={x.estado} />
                    ))}
                    <td className={`border-l px-1.5 py-1 text-right ${color(sem.estado)}`}>{Math.abs(sem.sistema - sem.zomatik) < 0.5 ? m3(sem.zomatik) : `${m3(sem.sistema)} / ${m3(sem.zomatik)}`}</td>
                    <td className={`px-1.5 py-1 ${color(sem.estado)}`}>{sem.texto || ""}</td>
                    <td className="border-l px-1.5 py-1 text-right text-muted-foreground">{!p.m3.hoy.sistema && !p.m3.hoy.zomatik ? "-" : `${m3(p.m3.hoy.sistema)} / ${m3(p.m3.hoy.zomatik)}`}</td>
                  </tr>
                  {abierta === k && (
                    <tr className="border-b bg-muted/30">
                      <td colSpan={dias.length + 4} className="px-2 py-2">
                        <DetalleProductos p={p} dias={[...dias, d.hoy]} hoy={d.hoy} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto">
        <div className="text-muted-foreground">Materia prima descontada en la semana (t)</div>
        <table className="border-collapse">
          <thead>
            <tr className="border-b text-right text-muted-foreground">
              <th className="px-1.5 py-1 text-left font-normal">Planta</th>
              <th className="px-1.5 py-1 text-left font-normal">Grupo</th>
              <th className="px-1.5 py-1 font-normal">Sistema</th>
              <th className="px-1.5 py-1 font-normal">Zomatik</th>
              <th className="px-1.5 py-1 text-left font-normal">Diferencia</th>
            </tr>
          </thead>
          <tbody>
            {d.plantas.flatMap((p) =>
              p.grupos.map((g) => {
                const k = `mp:${p.plantaId}:${g.grupo}`
                const gris = g.estado === "gris"
                return (
                  <Fragment key={k}>
                    <tr className={`cursor-pointer border-b hover:bg-muted/50 ${color(g.estado)} ${g.estado === "rojo" ? "bg-red-50/60" : ""}`} onClick={() => setAbierta(abierta === k ? null : k)}>
                      <td className="px-1.5 py-1">{p.planta}</td>
                      <td className="px-1.5 py-1">{g.nombre}</td>
                      <td className="px-1.5 py-1 text-right">{n1(g.sistema)}</td>
                      <td className="px-1.5 py-1 text-right">{gris ? "-" : n1(g.zomatik)}</td>
                      <td className="px-1.5 py-1">
                        {gris
                          ? `Zomatik sin leer hoy (última: ${hora(g.lectura?.leidoAt, d.hoy)})${g.lectura?.error ? ` · ${g.lectura.error}` : ""}`
                          : `${g.texto}${g.nota ? ` · ${g.nota}` : ""}`}
                        {!gris && g.movido > 0.05 && <span className="text-muted-foreground"> · {n1(g.movido)} t se descontaron otro día y se pasaron al día del despacho</span>}
                      </td>
                    </tr>
                    {abierta === k && (
                      <tr className="border-b bg-muted/30">
                        <td colSpan={5} className="px-2 py-2">
                          <DetalleGrupo g={g} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              }),
            )}
          </tbody>
        </table>
      </div>

      <div>
        <div className={d.ofSinMp.length ? "text-red-700" : "text-muted-foreground"}>OF sin materia prima descontada ({d.ofSinMp.length})</div>
        {d.ofSinMp.map((o, i) => (
          <div key={`${o.of}-${i}`}>{[ddmm(o.fecha), o.planta, o.of ? `OF ${o.of}` : "OF sin número", `${m3(o.m3)} m³`, o.formula, o.motivo].filter(Boolean).join(" · ")}</div>
        ))}
      </div>
    </div>
  )
}

function DetalleProductos({ p, dias, hoy }: { p: Planta; dias: string[]; hoy: string }) {
  if (!p.m3.productos.length) return <div className="text-muted-foreground">Sin despachos ni OF en estos días.</div>
  return (
    <div className="space-y-1">
      <div className="text-muted-foreground">Por producto: sistema / Zomatik (informativo; el color lo da el total de la planta)</div>
      <table className="border-collapse">
        <thead>
          <tr className="border-b text-right text-muted-foreground">
            <th className="px-1.5 py-0.5 text-left font-normal">Artículo</th>
            {dias.map((f) => (
              <th key={f} className="px-1.5 py-0.5 font-normal">
                {f === hoy ? "Hoy" : ddmm(f)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {p.m3.productos.map((x) => (
            <tr key={x.clave} className="border-b text-right">
              <td className="px-1.5 py-0.5 text-left" title={x.formulas.join(" · ")}>
                {x.nombre}
                {x.formulas.length > 1 ? <span className="text-muted-foreground"> ({x.formulas.length} fórmulas)</span> : null}
              </td>
              {x.dias.map((y) => (
                <td key={y.fecha} className={`px-1.5 py-0.5 ${y.fecha === hoy ? "text-muted-foreground" : Math.abs(y.sistema - y.zomatik) >= 0.5 ? "text-amber-700" : ""}`}>
                  {!y.sistema && !y.zomatik ? "" : Math.abs(y.sistema - y.zomatik) < 0.5 ? m3(y.zomatik) : `${m3(y.sistema)} / ${m3(y.zomatik)}`}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DetalleGrupo({ g }: { g: Grupo }) {
  return (
    <div className="space-y-2">
      {g.grupo === "arenas" && Math.abs(g.sistema - g.seco) > 0.05 && (
        <div className="text-muted-foreground">
          En seco: {n1(g.seco)} t (el sistema descuenta la arena con humedad; Zomatik, seca).
        </div>
      )}
      <div className="text-muted-foreground">Por material (informativo, sin color: las composiciones de Zomatik reparten distinto)</div>
      <table className="border-collapse text-muted-foreground">
        <thead>
          <tr className="border-b text-right">
            <th className="px-1.5 py-0.5 text-left font-normal">Material</th>
            <th className="px-1.5 py-0.5 font-normal">Sistema</th>
            <th className="px-1.5 py-0.5 font-normal">Zomatik</th>
          </tr>
        </thead>
        <tbody>
          {g.materiales.map((m) => (
            <tr key={m.nombre} className="border-b text-right">
              <td className="px-1.5 py-0.5 text-left">{m.nombre}</td>
              <td className="px-1.5 py-0.5">{n1(m.sistema)}</td>
              <td className="px-1.5 py-0.5">{m.zomatik === null ? "no está en Zomatik" : n1(m.zomatik)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="border-collapse">
        <thead>
          <tr className="border-b text-right text-muted-foreground">
            <th className="px-1.5 py-0.5 text-left font-normal">Día</th>
            <th className="px-1.5 py-0.5 font-normal">Sistema</th>
            <th className="px-1.5 py-0.5 font-normal" title="Lo del robot, pasado al día del despacho">
              Zomatik
            </th>
          </tr>
        </thead>
        <tbody>
          {g.porDia.map((x) => (
            <tr key={x.fecha} className={`border-b text-right ${x.sistema || x.zomatik ? "" : "text-muted-foreground"}`}>
              <td className="px-1.5 py-0.5 text-left">{ddmm(x.fecha)}</td>
              <td className="px-1.5 py-0.5">{x.sistema ? n1(x.sistema) : ""}</td>
              <td className="px-1.5 py-0.5">{x.zomatik ? n1(x.zomatik) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {g.ajustes.length > 0 && (
        <div className="text-muted-foreground">
          Ajustes (RS) de Zomatik en la semana, no cuentan: {g.ajustes.map((a) => `${ddmm(a.fecha)} ${a.material} ${a.t > 0 ? "+" : ""}${n1(a.t)} t`).join(" · ")}
        </div>
      )}
    </div>
  )
}
