/**
 * Carga de planta en el mail diario de control MP (spec 2026-11-05-puente-indumix, 8). Puro: arma la sección
 * "Carga de planta · Canning" con lo que junta lib/carga/control-servidor.ts. Sin puesto real, la sección no va y el
 * mail queda igual que hoy (lib/control-ingresos/mail.ts).
 */
import { desvio } from "@/lib/carga/auditoria"
import { cantidadPorM3, compararReceta, valoresReceta } from "@/lib/carga/receta"
import {
  INFO_SALIDA, SALIDAS, TOLERANCIAS_BASE, grupoDeSalida, nf,
  type FormulaSistema, type MaterialSistema, type RecetaPlanta, type Salida, type SalidaMapa, type Tolerancias,
} from "@/lib/carga/tipos"

export type MaterialCargaMail = { salida: Salida; receta_por_m3: number | null; teorico: number | null; teorico_corregido: number | null; real: number | null }

export type CargaMail = {
  id: string
  contador: number | null
  fin_at: string | null
  remito: string | null
  remito_tipo: string | null
  camion: string | null
  formula_id: string | null
  formula_code: string | null
  receta_numero: number | null
  receta_nombre: string | null
  /** m³ del remito (si se unió) */
  m3_remito: number | null
  /** m³ que dice Indumix */
  m3: number | null
  /** m³ estimados por el cemento */
  m3_cargados: number | null
  materiales: MaterialCargaMail[]
  agua_extra?: number | null
}

export type VersionReceta = { numero: number; nombre: string; salidas: RecetaPlanta["salidas"]; primera_lectura_at: string }

export type DatosCarga = {
  /** "Canning" */
  planta: string
  semanal?: boolean
  cargas: CargaMail[]
  formulas: FormulaSistema[]
  salidas: SalidaMapa[]
  materiales: MaterialSistema[]
  tolerancias?: Tolerancias
  /** despachos de la planta sin carga (solo de los días en que el puente mandó datos) */
  sinCarga?: { remito: string | null; camion: string | null; at: string | null }[]
  /** huecos del contador */
  perdidas?: { dia: string; texto: string }[]
  /** versiones de recetas del período, con la anterior de cada número (para el resumen de cambios) */
  versiones?: VersionReceta[]
  desde?: string
  /** avisos de humedad y Tolva 1 del período */
  avisos?: { titulo: string; at: string }[]
  ultimoLatidoAt?: string | null
  /** semanal: recetas de la planta que hoy no coinciden con su fórmula */
  recetasNoCoinciden?: { numero: number; nombre: string; formula: string; texto: string; frena: boolean }[]
}

const esc = (t: unknown) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)
const hhmm = (t: string | null | undefined) => (t ? new Date(t).toLocaleTimeString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hour12: false }) : "—")
const m3 = (x: number | null | undefined) => (x == null ? "—" : nf(x, Math.round(x * 10) % 10 ? 1 : 0))
const signo = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${nf(Math.abs(x), 0)} %`
const ROJO = "#b91c1c", AMBAR = "#92400e"

const recetaDe = (ms: MaterialCargaMail[]): Pick<RecetaPlanta, "salidas"> => ({
  salidas: ms.map((m) => ({ salida: m.salida, nombre_planta: INFO_SALIDA[m.salida].nombre, valor: Number(m.receta_por_m3) || 0, unidad: INFO_SALIDA[m.salida].unidad })),
})

/** Lo pesado contra el teórico de una carga, por grupo (cemento y aditivo siempre; áridos y agua solo con humedad). */
function pesadoPorGrupo(c: CargaMail) {
  const out: Record<string, { teo: number; real: number; corr: boolean }> = {}
  for (const m of c.materiales) {
    const g = grupoDeSalida(m.salida)
    if (m.teorico_corregido == null || !(Number(m.teorico_corregido) > 0)) continue
    const x = (out[g] ||= { teo: 0, real: 0, corr: true })
    x.teo += Number(m.teorico_corregido)
    x.real += Number(m.real || 0)
  }
  return out
}

/** ¿Entra en "Cargas cortas o con desvío"? (desvío de pesaje 6.2, m³ 0,1 o más por debajo del remito, o parada) */
export function cargaCortaODesvio(c: CargaMail, tol: Tolerancias = TOLERANCIAS_BASE) {
  const desv = c.materiales.some((m) => desvio({ grupo: grupoDeSalida(m.salida), teorico_corregido: m.teorico_corregido, real: m.real }, tol.pesaje))
  const ref = c.m3_remito ?? c.m3
  const corta = ref != null && c.m3_cargados != null && c.m3_cargados <= ref - 0.1 + 1e-9
  const g = pesadoPorGrupo(c)
  const parada = !!g.cemento && g.cemento.teo > 0 && g.cemento.real < 0.95 * g.cemento.teo
  return { entra: desv || corta || parada, desv, corta, parada }
}

const NOMBRE_GRUPO: Record<string, string> = { cemento: "cemento", aditivo: "aditivo", arido: "áridos", agua: "agua" }
const UNIDAD_GRUPO: Record<string, string> = { cemento: "kg", aditivo: "g", arido: "kg", agua: "L" }

/** "Cambios de receta en Indumix": "Receta 15: agua 150 → 170 → 160 → 170 · aditivo 2.800 → 0 g (08:43) · cemento pasó a la rosca 2". */
export function resumenCambios(versiones: VersionReceta[], desde?: string): { numero: number; texto: string }[] {
  const porNumero = new Map<number, VersionReceta[]>()
  for (const v of [...versiones].sort((a, b) => a.primera_lectura_at.localeCompare(b.primera_lectura_at))) {
    if (!porNumero.has(v.numero)) porNumero.set(v.numero, [])
    porNumero.get(v.numero)!.push(v)
  }
  const out: { numero: number; texto: string }[] = []
  for (const [numero, vs] of [...porNumero.entries()].sort((a, b) => a[0] - b[0])) {
    if (vs.length < 2 || (desde && !vs.some((v) => v.primera_lectura_at >= desde))) continue
    const vals = vs.map((v) => valoresReceta(v))
    const partes: string[] = []
    const serie = (f: (x: Partial<Record<Salida, number>>) => number) => {
      const xs: { v: number; at: string }[] = []
      vals.forEach((x, i) => { const y = f(x); if (!xs.length || xs[xs.length - 1].v !== y) xs.push({ v: y, at: vs[i].primera_lectura_at }) })
      return xs
    }
    const agua = serie((x) => x.agua || 0)
    if (agua.length > 1) partes.push(`agua ${agua.map((x) => nf(x.v)).join(" → ")}`)
    const adit = serie((x) => (x.aditivo_1 || 0) + (x.aditivo_2 || 0))
    if (adit.length > 1) partes.push(`aditivo ${adit.map((x) => nf(x.v)).join(" → ")} g (${hhmm(adit[adit.length - 1].at)})`)
    const cem = serie((x) => (x.cemento_1 || 0) + (x.cemento_2 || 0))
    if (cem.length > 1) partes.push(`cemento ${cem.map((x) => nf(x.v)).join(" → ")} kg`)
    const rosca = serie((x) => ((x.cemento_1 || 0) > 0 ? 1 : 0) + ((x.cemento_2 || 0) > 0 ? 2 : 0))
    if (rosca.length > 1) { const u = rosca[rosca.length - 1].v; if (u === 1 || u === 2) partes.push(`cemento pasó a la rosca ${u}`) }
    for (const s of SALIDAS.filter((x) => grupoDeSalida(x) === "arido")) {
      const a = serie((x) => x[s] || 0)
      if (a.length > 1) partes.push(`${INFO_SALIDA[s].nombre} ${a.map((x) => nf(x.v)).join(" → ")}`)
    }
    if (partes.length) out.push({ numero, texto: `Receta ${numero}: ${partes.join(" · ")}` })
  }
  return out
}

const h3 = (t: string) => `<div style="font-size:13px;margin:8px 0 2px">${esc(t)}</div>`
const ul = (items: string[]) => `<ul style="margin:0 0 6px;padding-left:18px">${items.join("")}</ul>`
const li = (t: string, color?: string) => `<li style="margin:2px 0${color ? `;color:${color}` : ""}">${t}</li>`

/** La sección del mail. `n` = cuántas diferencias hay en las partes 1 a 3 (van al asunto). */
export function seccionCarga(d: DatosCarga): { html: string; n: number } {
  const tol = d.tolerancias || TOLERANCIAS_BASE
  const formulas = new Map(d.formulas.map((f) => [f.id, f]))
  const remitoTxt = (c: CargaMail) => (c.remito ? `${c.remito_tipo ? `${c.remito_tipo} ` : ""}${c.remito}` : "sin remito")

  // 1. Receta distinta de la fórmula, agrupada por receta, fórmula y diferencia
  const grupos = new Map<string, { numero: number | null; nombre: string | null; formula: string; texto: string; frena: boolean; remitos: string[] }>()
  for (const c of d.cargas) {
    const f = c.formula_id ? formulas.get(c.formula_id) : null
    if (!f || !c.materiales.length) continue
    const cmp = compararReceta(recetaDe(c.materiales), f, d.salidas, d.materiales, tol)
    if (cmp.ok) continue
    const filas = [...cmp.malNoAgua, ...(cmp.malAgua ? [cmp.malAgua] : [])]
    const texto = [
      ...filas.map((x) => `${x.nombre} ${cantidadPorM3(x.grupo, x.receta)} contra ${cantidadPorM3(x.grupo, x.formula)}`),
      ...cmp.sueltas.map((s) => `pesa en ${INFO_SALIDA[s].nombre}, sin material`),
    ].join(" · ")
    const k = `${c.receta_numero}|${f.id}|${texto}`
    const g = grupos.get(k) || { numero: c.receta_numero, nombre: c.receta_nombre, formula: f.code, texto, frena: cmp.malNoAgua.length > 0 || cmp.sueltas.length > 0, remitos: [] }
    g.remitos.push(c.remito || "s/n")
    grupos.set(k, g)
  }
  const p1 = [...grupos.values()].map((g) => {
    const rs = [...g.remitos].sort()
    const rango = rs.length > 1 ? `${rs[0]} a ${rs[rs.length - 1]}` : rs[0]
    return li(`Receta ${g.numero ?? "—"}${g.nombre ? ` (${esc(g.nombre)})` : ""} contra ${esc(g.formula)}: ${esc(g.texto)} · ${rs.length} carga${rs.length > 1 ? "s" : ""} (${esc(rango)})`, g.frena ? ROJO : AMBAR)
  })

  // 2. Cargas cortas o con desvío
  const p2: string[] = []
  for (const c of d.cargas) {
    const k = cargaCortaODesvio(c, tol)
    if (!k.entra) continue
    const g = pesadoPorGrupo(c)
    const partes: string[] = [
      `${esc(remitoTxt(c))}`, esc(c.camion || "—"), hhmm(c.fin_at), esc(c.formula_code || "sin fórmula"),
      `${c.m3_remito != null ? `${m3(c.m3_remito)} m³ del remito contra ` : ""}${m3(c.m3_cargados ?? c.m3)} m³ de Indumix${c.m3_cargados != null && c.m3 != null && c.m3_cargados < c.m3 ? " (estimado por el cemento)" : ""}`,
    ]
    for (const grupo of ["cemento", "aditivo", "arido", "agua"]) {
      const x = g[grupo]
      if (!x || !(x.teo > 0)) continue
      if (grupo !== "cemento" && Math.abs(x.real / x.teo - 1) <= tol.pesaje[grupo as "cemento"]) continue
      partes.push(`${NOMBRE_GRUPO[grupo]} ${nf(x.real)} de ${nf(x.teo)} ${UNIDAD_GRUPO[grupo]} (${signo((x.real / x.teo - 1) * 100)})`)
    }
    if (c.agua_extra) partes.push(`agua extra ${nf(c.agua_extra)} L`)
    p2.push(li(`N° ${c.contador ?? "—"} · ${partes.join(" · ")}`, k.desv || k.parada ? ROJO : AMBAR))
  }

  // 3. Sin remito / sin carga / perdidas
  const sinRemito = d.cargas.filter((c) => !c.remito)
  const sinCarga = d.sinCarga || []
  const perdidas = d.perdidas || []
  let p3 = ""
  if (sinRemito.length) p3 += h3(`Sin remito (${sinRemito.length})`) + ul(sinRemito.map((c) => li(`N° ${c.contador ?? "—"} · ${esc(c.camion || "sin camión")} · ${hhmm(c.fin_at)} · ${m3(c.m3)} m³ · receta ${c.receta_numero ?? "—"}`)))
  if (sinCarga.length) p3 += h3(`Despachos sin carga (${sinCarga.length})`) + ul(sinCarga.map((x) => li(`Remito ${esc(x.remito || "s/n")} · ${esc(x.camion || "—")} · ${hhmm(x.at)}`)))
  if (perdidas.length) p3 += h3(`Cargas perdidas (${perdidas.length})`) + ul(perdidas.map((x) => li(`${esc(x.dia.split("-").reverse().slice(0, 2).join("/"))}: ${esc(x.texto)}`)))

  const n = p1.length + p2.length + sinRemito.length + sinCarga.length + perdidas.length
  const cambios = resumenCambios(d.versiones || [], d.desde)
  const avisos = d.avisos || []
  const p4 = cambios.length ? h3("Cambios de receta en Indumix") + ul(cambios.map((x) => li(esc(x.texto)))) : ""
  const p5 = avisos.length ? h3("Humedad y Tolva 1") + ul(avisos.map((x) => li(`${hhmm(x.at)} · ${esc(x.titulo)}`))) : ""
  const semanal = d.semanal && d.recetasNoCoinciden?.length
    ? h3(`Recetas de la planta que hoy no coinciden con su fórmula (${d.recetasNoCoinciden.length})`) +
      ul(d.recetasNoCoinciden.map((r) => li(`Receta ${r.numero} (${esc(r.nombre)}) contra ${esc(r.formula)}: ${esc(r.texto)}`, r.frena ? ROJO : AMBAR)))
    : ""
  const pie = `<p style="color:#64748b;margin:6px 0 0">${d.cargas.length} carga${d.cargas.length === 1 ? "" : "s"} leída${d.cargas.length === 1 ? "" : "s"} · último dato del puente ${hhmm(d.ultimoLatidoAt)}</p>`
  const titulo = `<div style="font-size:14px;margin:14px 0 4px">Carga de planta · ${esc(d.planta)}</div>`
  if (!n) {
    const linea = `<p style="margin:14px 0 4px">Carga de planta: ${d.cargas.length} carga${d.cargas.length === 1 ? "" : "s"} leída${d.cargas.length === 1 ? "" : "s"}, sin diferencias</p>`
    return { html: p4 || p5 || semanal ? `${titulo}${linea}${p4}${p5}${semanal}${pie}` : linea, n: 0 }
  }
  const html = `${titulo}
    ${p1.length ? h3(`Receta distinta de la fórmula (${p1.length})`) + ul(p1) : ""}
    ${p2.length ? h3(`Cargas cortas o con desvío (${p2.length})`) + ul(p2) : ""}
    ${p3}${p4}${p5}${semanal}${pie}`
  return { html, n }
}

/** Si la sección no se pudo armar, el mail de remitos sale igual con esta línea. */
export const SECCION_CARGA_FALLO = { html: `<p style="margin:14px 0 4px;color:#92400e">Carga de planta: no se pudo armar</p>`, n: 0 }
