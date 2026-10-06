"use client"

/**
 * Tarjeta y panel de detalle de un indicador de logística (Fase 4a).
 * Todo lo que dice cada indicador sale de lib/kpis-logistica.ts.
 */
import { useMemo } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ChevronRight, Info } from "lucide-react"
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { cn } from "@/lib/utils"
import {
  NOMBRE_BANDA,
  banda,
  desglosar,
  formatear,
  peoresPrimero,
  porDia,
  textoBandas,
  type Banda,
  type DatosKpi,
  type Desglose,
  type KpiDef,
} from "@/lib/kpis-logistica"

const COLOR_BANDA: Record<Banda, { badge: string; barra: string }> = {
  bueno: { badge: "bg-emerald-50 text-emerald-800 border-emerald-300", barra: "#10b981" },
  normal: { badge: "bg-amber-50 text-amber-800 border-amber-300", barra: "#f59e0b" },
  a_mejorar: { badge: "bg-red-50 text-red-800 border-red-300", barra: "#ef4444" },
}
const SIN_BANDA = "#64748b"
const NOMBRE_DESGLOSE: Record<Desglose, string> = { camion: "Por camión", obra: "Por obra", cliente: "Por cliente", chofer: "Por chofer" }
const fechaCorta = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`

export function KpiTarjeta({ k, datos, onAbrir }: { k: KpiDef; datos: DatosKpi; onAbrir: () => void }) {
  const valor = useMemo(() => k.calcular(datos), [k, datos])
  const b = banda(k, valor)
  return (
    <button type="button" onClick={onAbrir} className="text-left group focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl">
      <Card className="h-full transition-colors group-hover:border-foreground/30">
        <CardContent className="p-3 md:p-4 space-y-1 h-full flex flex-col">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-medium text-muted-foreground">{k.titulo}</p>
            <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0 group-hover:text-foreground" aria-hidden />
          </div>
          <p className="text-2xl font-semibold tabular-nums">
            {formatear(k, valor)}
            {valor != null && <span className="text-sm font-normal text-muted-foreground ml-1">{k.unidad}</span>}
          </p>
          <p className="text-[11px] text-muted-foreground leading-snug flex-1">{k.corta}</p>
          <div className="flex items-center justify-between gap-2 pt-1">
            {b ? <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", COLOR_BANDA[b].badge)}>{NOMBRE_BANDA[b]}</Badge> : <span className="text-[10px] text-gray-400">Sin referencia</span>}
            <span className="text-[10px] text-muted-foreground group-hover:text-foreground flex items-center">Ver detalle<ChevronRight className="h-3 w-3" /></span>
          </div>
        </CardContent>
      </Card>
    </button>
  )
}

export function KpiDetalle({
  k,
  datos,
  periodo,
  onCerrar,
  onIrAViaje,
}: {
  k: KpiDef | null
  datos: DatosKpi
  periodo: string
  onCerrar: () => void
  onIrAViaje: (fecha: string, viajeKey: string) => void
}) {
  return (
    <Sheet open={!!k} onOpenChange={(o) => !o && onCerrar()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        {k && <Contenido k={k} datos={datos} periodo={periodo} onIrAViaje={onIrAViaje} />}
      </SheetContent>
    </Sheet>
  )
}

function Contenido({ k, datos, periodo, onIrAViaje }: { k: KpiDef; datos: DatosKpi; periodo: string; onIrAViaje: (fecha: string, viajeKey: string) => void }) {
  const valor = useMemo(() => k.calcular(datos), [k, datos])
  const b = banda(k, valor)
  const dias = useMemo(() => porDia(k, datos), [k, datos])
  const hayChofer = datos.viajes.some((v) => v.chofer) || datos.pedidos.some((p) => p.chofer)
  const desgloses = k.desgloses.filter((d) => d !== "chofer" || hayChofer)
  const items = useMemo(() => peoresPrimero(k, datos), [k, datos])
  const f = (x: number | null | undefined) => formatear(k, x)

  return (
    <>
      <SheetHeader className="pb-0">
        <SheetTitle className="text-lg">{k.titulo}</SheetTitle>
        <SheetDescription>{k.corta}</SheetDescription>
      </SheetHeader>
      <div className="px-4 pb-6 space-y-5">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-3xl font-semibold tabular-nums">{f(valor)}</span>
          {valor != null && <span className="text-muted-foreground">{k.unidad}</span>}
          {b && <Badge variant="outline" className={cn("ml-1", COLOR_BANDA[b].badge)}>{NOMBRE_BANDA[b]}</Badge>}
          <span className="text-xs text-muted-foreground">{periodo}</span>
        </div>

        {/* a) Qué mide y cómo se calcula */}
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Qué mide</h3>
          <p className="text-sm leading-relaxed">{k.queMide}</p>
          <h3 className="text-sm font-semibold pt-1">Cómo se calcula</h3>
          <p className="text-sm leading-relaxed text-muted-foreground">{k.comoSeCalcula}</p>
        </section>

        {/* b) Referencia y cómo leerla */}
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Cómo leerlo</h3>
          <p className="text-sm text-gray-500">{k.referencia}</p>
          {k.bandas ? (
            <div className="grid grid-cols-3 gap-2">
              {textoBandas(k).map((t) => (
                <div key={t.banda} className={cn("rounded-md border px-2 py-1.5 text-xs", t.banda === b ? COLOR_BANDA[t.banda].badge + " ring-2 ring-offset-1 ring-current" : "text-muted-foreground")}>
                  <p className="font-semibold">{NOMBRE_BANDA[t.banda]}</p>
                  <p>{t.texto}</p>
                  {t.banda === b && <p className="font-medium mt-0.5">← estamos acá ({f(valor)})</p>}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Sin bandas: se mira la evolución y se compara entre camiones u obras.</p>
          )}
          {k.bandas?.nota && <p className="text-xs text-muted-foreground">{k.bandas.nota}</p>}
        </section>

        {/* c) Evolución por día */}
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Evolución por día</h3>
          {dias.some((d) => d.valor != null) ? (
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dias.map((d) => ({ dia: fechaCorta(d.fecha), valor: d.valor == null ? null : Math.round(d.valor * 10 ** k.decimales) / 10 ** k.decimales }))} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="dia" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(x: any) => [`${String(x).replace(".", ",")} ${k.unidad}`, k.titulo]} />
                  {k.valorReferencia != null && (
                    <ReferenceLine y={k.valorReferencia} stroke="#9ca3af" strokeDasharray="4 4" label={{ value: `Loop ${String(k.valorReferencia).replace(".", ",")}`, fontSize: 10, fill: "#9ca3af", position: "insideTopRight" }} />
                  )}
                  <Bar dataKey="valor" radius={[3, 3, 0, 0]}>
                    {dias.map((d) => {
                      const bd = banda(k, d.valor)
                      return <Cell key={d.fecha} fill={bd ? COLOR_BANDA[bd].barra : SIN_BANDA} />
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Sin datos en el período.</p>
          )}
        </section>

        {/* d) Desglose */}
        {desgloses.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Desglose</h3>
            <Tabs defaultValue={desgloses[0]}>
              <TabsList className="h-auto flex-wrap">
                {desgloses.map((d) => <TabsTrigger key={d} value={d} className="text-xs">{NOMBRE_DESGLOSE[d]}</TabsTrigger>)}
              </TabsList>
              {desgloses.map((d) => {
                const filas = desglosar(k, datos, d)
                return (
                  <TabsContent key={d} value={d}>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{NOMBRE_DESGLOSE[d].replace("Por ", "").replace(/^./, (c) => c.toUpperCase())}</TableHead>
                          <TableHead className="text-right">{k.titulo}</TableHead>
                          <TableHead className="text-right">{k.id === "puntualidad" ? "Pedidos" : "Viajes"}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filas.slice(0, 40).map((x) => {
                          const bd = banda(k, x.valor)
                          return (
                            <TableRow key={x.id}>
                              <TableCell className="text-sm">{x.nombre}</TableCell>
                              <TableCell className={cn("text-right tabular-nums font-medium", bd === "a_mejorar" && "text-red-700", bd === "bueno" && "text-emerald-700")}>{f(x.valor)} {k.unidad}</TableCell>
                              <TableCell className="text-right tabular-nums text-muted-foreground">{x.n}</TableCell>
                            </TableRow>
                          )
                        })}
                        {filas.length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-sm text-muted-foreground py-4">Sin datos.</TableCell></TableRow>}
                      </TableBody>
                    </Table>
                  </TabsContent>
                )
              })}
            </Tabs>
          </section>
        )}

        {/* e) Los viajes detrás del número */}
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">{k.id === "puntualidad" ? "Los pedidos" : "Los viajes"} detrás del número <span className="font-normal text-muted-foreground">(peores primero{items.length > 50 ? ", los primeros 50" : ""})</span></h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Camión</TableHead>
                <TableHead>Remito</TableHead>
                <TableHead>Obra</TableHead>
                <TableHead className="text-right">{k.columnaItem}</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.slice(0, 50).map((it) => (
                <TableRow
                  key={it.key}
                  className={cn(it.viaje_key && "cursor-pointer hover:bg-muted/60")}
                  onClick={() => it.viaje_key && onIrAViaje(it.fecha, it.viaje_key)}
                >
                  <TableCell className="whitespace-nowrap tabular-nums">{fechaCorta(it.fecha)}</TableCell>
                  <TableCell className="whitespace-nowrap">{it.camion || "–"}{it.chofer && <span className="block text-[11px] text-muted-foreground">{it.chofer}</span>}</TableCell>
                  <TableCell className="whitespace-nowrap">{it.remito || "–"}</TableCell>
                  <TableCell className="text-sm">{it.obra || "–"}{it.cliente && <span className="block text-[11px] text-muted-foreground">{it.cliente}</span>}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{k.id === "puntualidad" && it.valor > 0 ? "+" : ""}{f(it.valor)}</TableCell>
                  <TableCell className="text-right">{it.viaje_key ? <span className="text-xs text-muted-foreground flex items-center justify-end">Ver viaje<ChevronRight className="h-3 w-3" /></span> : <span className="text-xs text-muted-foreground">sin viaje</span>}</TableCell>
                </TableRow>
              ))}
              {items.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-4">Sin datos en el período.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </section>
      </div>
    </>
  )
}
