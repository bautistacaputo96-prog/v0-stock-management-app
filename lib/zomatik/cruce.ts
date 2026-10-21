/**
 * Zomatik Z0 · Cruce por fechas y m³ (idea de Bautista, 21/10/2026). Funciones puras.
 *
 * Si un cliente nuestro tuvo despachos ciertos días y un cliente de Zomatik tuvo remitos esos mismos días, con m³
 * parecidos y en la misma planta (Canning = depósito 116, Hudson = REBUCRET 113), son el mismo cliente. Lo mismo
 * para un proyecto (sus remitos) y una obra nuestra (sus despachos), y para una fórmula (qué artículo llevan los
 * remitos de ese cliente esos días).
 *
 * Zomatik a veces remite atrasado y junta días: cada remito-día se compara con nuestros despachos de 3 días antes
 * a 1 después, y se comparan los m³ sumados. Se cuenta desde el 13/04/2026 (cuando arrancaron nuestros despachos).
 *
 * Confianza:
 *   - alta: 2 o más días en común, misma planta, m³ parecidos (85–90 % o más) y que cubra la mayoría de nuestros
 *     días; o nombre igual y único (lo "seguro"), salvo que los días lo contradigan;
 *   - media: algún día en común con m³ parecidos, o un nombre muy parecido sin datos para cruzar;
 *   - baja: poca evidencia, o los dos tienen movimiento y no coinciden nunca.
 */
import { nombreNormalizado, parecidoNombres, tokensNombre, soloDigitos, cuitValido, esHormigon, type RenglonRemito } from "@/lib/zomatik/parseo"
import { proponerClientes, proponerFormulas, sufijoPlanta, type ArticuloZomatik } from "@/lib/zomatik/vinculos"

export const DESDE_CRUCE = "2026-04-13"

export type Confianza = "alta" | "media" | "baja"
export type Planta = "Canning" | "Hudson" | "otro"
/** "AAAA-MM-DD|Planta" → m³ */
export type DiasPlanta = Map<string, number>

export type Evidencia = {
  /** días (con planta) de Zomatik desde el 13/04 */
  zd: number
  /** días (con planta) nuestros desde el 13/04 */
  nd: number
  /** días de Zomatik con despacho nuestro en la ventana, en la misma planta */
  comunes: number
  /** parecido de los m³ sumados de esos días (0 a 1) */
  pct: number
  /** comunes ÷ días de Zomatik */
  ratio: number
  /** qué parte de nuestros días quedó cubierta */
  cubre: number
  /** días de Zomatik que solo coinciden en la otra planta */
  otraPlanta: number
  zSum: number
  nSum: number
  /** días de Zomatik en común ("fecha|planta") → nuestros días que los cubren */
  pares: [string, string[]][]
}

const r1 = (n: number) => Math.round(n * 10) / 10

export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

/** Depósito de Zomatik → nuestra planta: Canning (116) = Canning, REBUCRET (113) = Hudson. */
export function plantaDeDeposito(deposito: unknown): Planta {
  const d = String(deposito ?? "")
  if (/canning/i.test(d)) return "Canning"
  if (/rebucret|hudson/i.test(d)) return "Hudson"
  return "otro"
}

export function agregarDia(m: DiasPlanta, fecha: string, planta: string, m3: number) {
  const k = `${fecha}|${planta}`
  m.set(k, (m.get(k) || 0) + (Number(m3) || 0))
}

export function cruzar(z: DiasPlanta, n: DiasPlanta, desde: string = DESDE_CRUCE): Evidencia {
  const zk = [...z.keys()].filter((k) => k >= desde)
  const nk = [...n.keys()].filter((k) => k >= desde)
  let comunes = 0
  let zSum = 0
  let otraPlanta = 0
  const usados = new Set<string>()
  const pares: [string, string[]][] = []
  for (const k of zk) {
    const [f, pl] = k.split("|")
    let ok = false
    const cubren: string[] = []
    for (let i = -3; i <= 1; i++) {
      const kk = `${sumarDias(f, i)}|${pl}`
      if (n.has(kk)) {
        ok = true
        usados.add(kk)
        cubren.push(kk)
      }
    }
    if (ok) {
      pares.push([k, cubren])
      comunes++
      zSum += z.get(k) || 0
      continue
    }
    for (let i = -3; i <= 1 && !ok; i++) for (const p2 of ["Canning", "Hudson"]) if (p2 !== pl && n.has(`${sumarDias(f, i)}|${p2}`)) ok = true
    if (ok) otraPlanta++
  }
  const nSum = [...usados].reduce((a, k) => a + (n.get(k) || 0), 0)
  const pct = comunes && Math.max(zSum, nSum) > 0 ? Math.min(zSum, nSum) / Math.max(zSum, nSum) : 0
  return {
    zd: zk.length,
    nd: nk.length,
    comunes,
    pct,
    ratio: zk.length ? comunes / zk.length : 0,
    cubre: nk.length ? usados.size / nk.length : 0,
    otraPlanta,
    zSum: r1(zSum),
    nSum: r1(nSum),
    pares,
  }
}

/** Puntaje solo por fechas, m³ y planta (sin el nombre): para rankear todos los candidatos. */
export function puntajeFechas(e: Evidencia): number {
  if (e.comunes === 0) return 0
  return e.ratio * e.pct + Math.min(1, e.comunes / 5) * 0.5 + e.cubre * 0.5
}

/** Clientes genéricos de Zomatik (no se proponen): mostrador, consumidor final, varios, sin nombre. */
export function esGenerico(razonSocial: unknown): boolean {
  const t = String(razonSocial ?? "").trim()
  if (!t || tokensNombre(t).length === 0) return true
  return /CONSUMIDOR\s+FINAL|\bVARIOS\b|MOSTRADOR|\bCONTADO\b|GEN[EÉ]RICO|SIN\s+NOMBRE|CLIENTE\s+DE\s+PRUEBA|^PRUEBA\b/i.test(t)
}

const dias = (n: number) => `${n} ${n === 1 ? "día" : "días"}`

/** "20 días en común de 23, 93 % de los m³ (1195 contra 1284), misma planta" */
export function textoEvidencia(e: Evidencia): string {
  if (e.zd === 0 && e.nd === 0) return "sin movimientos desde abril para cruzar"
  if (e.zd === 0) return `sin remitos en Zomatik desde abril (acá ${dias(e.nd)} con despachos)`
  if (e.nd === 0) return `acá sin despachos desde abril (en Zomatik ${dias(e.zd)})`
  const m = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 1 })
  return `${dias(e.comunes)} en común de ${e.zd}, ${Math.round(e.pct * 100)} % de los m³ (${m(e.zSum)} contra ${m(e.nSum)})${e.otraPlanta ? `, ${dias(e.otraPlanta)} solo en la otra planta` : e.comunes ? ", misma planta" : ""}`
}

export const contradice = (e: Evidencia) => e.zd > 0 && e.nd > 0 && e.comunes === 0

/** Confianza de un par cliente nuestro ↔ cliente de Zomatik (o obra ↔ proyecto). */
export function confianza(e: Evidencia, parecido: number, tokensNuestro = 2): Confianza {
  const cubreBien = e.cubre >= 0.5 || e.nd <= 2
  if (e.comunes >= 3 && e.ratio >= 0.6 && e.pct >= 0.85 && cubreBien) return "alta"
  if (e.comunes >= 2 && e.pct >= 0.9 && parecido >= 0.5 && cubreBien) return "alta"
  if (contradice(e)) return "baja"
  if (e.comunes >= 1 && e.pct >= 0.6) return "media"
  if (parecido >= 0.99 && tokensNuestro >= 2) return "media"
  return "baja"
}

/** Puntaje para elegir el mejor candidato (evidencia + nombre). */
export function puntaje(e: Evidencia, parecido: number, seguro = false): number {
  return e.ratio * e.pct * 2 + Math.min(1, e.comunes / 3) + parecido + (contradice(e) ? -1 : 0) + (seguro ? 1 : 0)
}

// ---------------------------------------------------------------------------
// Armado de los mapas de días
// ---------------------------------------------------------------------------

export type Despacho = { client_id: string | null; construction_site_id: string | null; formula_id: string | null; planta: string; fecha: string; m3: number }
export type RemitoDia = { cliente_norm: string; fecha: string; planta: string; m3: number; articulos: number[] }

/** Los renglones de remito de Zomatik (solo hormigón) resumidos por cliente, día y planta. */
export function remitosPorDia(renglones: RenglonRemito[]): RemitoDia[] {
  const m = new Map<string, RemitoDia & { cliente: string; nros: Set<string> }>()
  for (const r of renglones) {
    if (!esHormigon(r.articulo)) continue
    const cn = nombreNormalizado(r.cliente)
    if (!cn) continue
    const planta = plantaDeDeposito(r.deposito)
    const k = `${cn}|${r.fecha}|${planta}`
    const x = m.get(k) || { cliente_norm: cn, cliente: r.cliente, fecha: r.fecha, planta, m3: 0, articulos: [], nros: new Set<string>() }
    x.m3 = Math.round((x.m3 + r.m3) * 1000) / 1000
    x.nros.add(r.remito)
    if (r.articulo_codigo && !x.articulos.includes(r.articulo_codigo)) x.articulos.push(r.articulo_codigo)
    m.set(k, x)
  }
  return [...m.values()].map(({ nros, ...x }) => ({ ...x, remitos: nros.size }))
}

export function indexarDespachos(despachos: Despacho[], clave: (d: Despacho) => string | null): Map<string, DiasPlanta> {
  const out = new Map<string, DiasPlanta>()
  for (const d of despachos) {
    const k = clave(d)
    if (!k) continue
    if (!out.has(k)) out.set(k, new Map())
    agregarDia(out.get(k)!, d.fecha, d.planta, d.m3)
  }
  return out
}

export function indexarRemitos(remitos: RemitoDia[]): Map<string, DiasPlanta> {
  const out = new Map<string, DiasPlanta>()
  for (const r of remitos) {
    if (!out.has(r.cliente_norm)) out.set(r.cliente_norm, new Map())
    agregarDia(out.get(r.cliente_norm)!, r.fecha, r.planta, r.m3)
  }
  return out
}

// ---------------------------------------------------------------------------
// Propuestas con evidencia
// ---------------------------------------------------------------------------

export type ClienteNuestroC = { id: string; name: string; razon_social?: string | null; cuit?: string | null; active?: boolean | null; zomatik_codigo?: number | null; zomatik_vinculo?: string | null }
export type ClienteZomatikC = { codigo: number; razon_social: string; cuit?: string | null; remitos_12m?: number; estado?: string | null }

export type PropuestaC<T> = { candidato: T; confianza: Confianza; motivo: string; evidencia: string; puntaje: number }

/** Señales extra para un par (artículo del remito igual a la fórmula, CUIT): pueden subir o bajar la confianza. */
export type Ajuste = (clienteId: string, z: ClienteZomatikC, e: Evidencia, conf: Confianza) => { confianza: Confianza; texto: string | null }

/** Clientes nuestros que parecen el mismo: mismo nombre normalizado o mismo CUIT válido. id → texto del aviso. */
export function duplicadosNuestros(clientes: ClienteNuestroC[]): Map<string, string> {
  const grupos = new Map<string, ClienteNuestroC[]>()
  const sumar = (k: string, c: ClienteNuestroC) => grupos.set(k, [...(grupos.get(k) || []), c])
  for (const c of clientes) {
    if (c.active === false) continue
    const k = nombreNormalizado(c.name)
    if (k) sumar(`n:${k}`, c)
    const d = soloDigitos(c.cuit)
    if (cuitValido(d)) sumar(`c:${d}`, c)
  }
  const out = new Map<string, string>()
  for (const g of grupos.values()) {
    if (g.length < 2) continue
    for (const c of g) {
      const otros = g.filter((o) => o.id !== c.id).map((o) => o.name)
      const prev = out.get(c.id)
      const txt = `posible duplicado de ${otros.map((o) => `«${o}»`).join(", ")}`
      out.set(c.id, prev && prev !== txt ? `${prev}; ${txt}` : txt)
    }
  }
  return out
}

/**
 * La mejor propuesta para cada cliente nuestro sin revisar. Candidatos: el de la regla de nombre (seguro o
 * dudoso), los de nombre parecido y los que coinciden por fechas y m³ aunque el nombre no se parezca.
 * Si un mismo cliente de Zomatik sale para dos nuestros, queda en el de más evidencia y el otro baja.
 */
export function proponerClientesConCruce(
  nuestros: ClienteNuestroC[],
  deZomatik: ClienteZomatikC[],
  despachosPorCliente: Map<string, DiasPlanta>,
  remitosPorCliente: Map<string, DiasPlanta>,
  ajustar?: Ajuste,
): Map<string, PropuestaC<ClienteZomatikC>> {
  deZomatik = deZomatik.filter((z) => !esGenerico(z.razon_social))
  const regla = proponerClientes(nuestros, deZomatik)
  const vacio: DiasPlanta = new Map()
  const out = new Map<string, PropuestaC<ClienteZomatikC>>()
  for (const c of nuestros) {
    const n = despachosPorCliente.get(c.id) || vacio
    const cands = new Map<number, { z: ClienteZomatikC; parecido: number; motivo: string; seguro: boolean }>()
    const p = regla.get(c.id)
    if (p) cands.set(p.candidato.codigo, { z: p.candidato, parecido: p.puntaje, motivo: p.certeza === "seguro" ? p.motivo.toLowerCase() : p.motivo.toLowerCase(), seguro: p.certeza === "seguro" })
    for (const z of deZomatik) {
      if (cands.has(z.codigo)) continue
      const par = Math.max(parecidoNombres(c.name, z.razon_social), parecidoNombres(c.razon_social, z.razon_social))
      if (par >= 0.5) {
        cands.set(z.codigo, { z, parecido: par, motivo: "nombre parecido", seguro: false })
        continue
      }
      if (n.size >= 2 && (z.remitos_12m || 0) > 0) {
        const e = cruzar(remitosPorCliente.get(nombreNormalizado(z.razon_social)) || vacio, n)
        if (e.comunes >= 2 && e.pct >= 0.8 && e.ratio >= 0.5) cands.set(z.codigo, { z, parecido: par, motivo: "nombre distinto, mismos días y m³", seguro: false })
      }
    }
    const tokens = tokensNombre(c.name).filter((t) => t.length > 2).length
    let mejor: PropuestaC<ClienteZomatikC> | null = null
    for (const k of cands.values()) {
      const e = cruzar(remitosPorCliente.get(nombreNormalizado(k.z.razon_social)) || vacio, n)
      let conf = confianza(e, k.parecido, tokens)
      let motivo = k.motivo
      if (k.seguro) {
        conf = contradice(e) ? "media" : "alta"
        motivo = contradice(e) ? `${k.motivo} (pero los días no coinciden)` : k.motivo
      }
      let evidencia = textoEvidencia(e)
      if (ajustar) {
        const a = ajustar(c.id, k.z, e, conf)
        conf = a.confianza
        if (a.texto) evidencia = `${evidencia}; ${a.texto}`
      }
      const pz = puntaje(e, k.parecido, k.seguro) + (conf === "alta" ? 0.5 : 0)
      if (!mejor || pz > mejor.puntaje) mejor = { candidato: k.z, confianza: conf, motivo, evidencia, puntaje: pz }
    }
    if (mejor) out.set(c.id, mejor)
  }
  // El mismo cliente de Zomatik para dos nuestros: queda en el de más puntaje
  const porZ = new Map<number, string[]>()
  for (const [id, p] of out) porZ.set(p.candidato.codigo, [...(porZ.get(p.candidato.codigo) || []), id])
  for (const ids of porZ.values()) {
    if (ids.length < 2) continue
    ids.sort((a, b) => out.get(b)!.puntaje - out.get(a)!.puntaje)
    const primero = nuestros.find((c) => c.id === ids[0])?.name || ""
    for (const id of ids.slice(1)) {
      const p = out.get(id)!
      // La base no deja dos clientes nuestros con el mismo código (índice único): el segundo no se puede vincular
      out.set(id, {
        ...p,
        confianza: "baja",
        motivo: `${p.motivo}; ese cliente de Zomatik ya va con «${primero}» (mismo código): posible duplicado, unificar o cargar sus obras en «${primero}»`,
      })
    }
  }
  return out
}

export type FormulaC = { id: string; name: string; code?: string | null; planta: string }

/**
 * Fórmulas: la regla de nombre (seguro = alta) más la evidencia de qué artículo llevan los remitos de Zomatik
 * de los clientes ya vinculados (o propuestos con confianza alta) los días que despachamos esa fórmula.
 */
export function proponerFormulasConCruce(
  formulas: FormulaC[],
  articulos: ArticuloZomatik[],
  despachos: Despacho[],
  remitos: RemitoDia[],
  clienteNorm: Map<string, string>,
): Map<string, PropuestaC<ArticuloZomatik>> {
  const regla = proponerFormulas(formulas, articulos)
  const porCod = new Map(articulos.map((a) => [a.codigo, a]))
  const idx = indiceArticulos(remitos)
  const out = new Map<string, PropuestaC<ArticuloZomatik>>()
  for (const f of formulas) {
    const { votos, base } = votosArticulos(f.id, despachos, idx, clienteNorm)
    const suf = sufijoPlanta(f.planta)
    const deLaPlanta = (a: number) => {
      const n = porCod.get(a)?.nombre || ""
      return !suf || !/\((HUD|CAN)\)/.test(n) || n.includes(suf)
    }
    const porEv = [...votos.entries()].filter(([a]) => deLaPlanta(a) && porCod.has(a)).sort((a, b) => b[1] - a[1])[0]
    const p = regla.get(f.id)
    const ev = (a: number) => (base ? `${votos.get(a) || 0} de ${base} días los remitos llevan ese artículo` : "sin despachos cruzables desde abril")
    if (p && p.certeza === "seguro") {
      out.set(f.id, { candidato: p.candidato, confianza: "alta", motivo: p.motivo === "Nombre igual" ? "nombre igual" : "igual con las reglas (planta, 6/12, GUN)", evidencia: ev(p.candidato.codigo), puntaje: 3 })
      continue
    }
    const vp = p ? votos.get(p.candidato.codigo) || 0 : 0
    if (p && base >= 2 && vp / base >= 0.5 && !(porEv && porEv[0] !== p.candidato.codigo && porEv[1] > vp)) {
      out.set(f.id, { candidato: p.candidato, confianza: "alta", motivo: `nombre parecido`, evidencia: ev(p.candidato.codigo), puntaje: 2 + vp / base })
    } else if (porEv && base >= 3 && porEv[1] / base >= 0.6 && (!p || porEv[0] !== p.candidato.codigo)) {
      const a = porCod.get(porEv[0])!
      out.set(f.id, { candidato: a, confianza: "media", motivo: p ? `por los remitos (el nombre sugería ${p.candidato.nombre})` : "por los remitos", evidencia: ev(a.codigo), puntaje: 1 + porEv[1] / base })
    } else if (p) {
      out.set(f.id, { candidato: p.candidato, confianza: vp > 0 || base < 2 ? "media" : "baja", motivo: "nombre parecido", evidencia: ev(p.candidato.codigo), puntaje: 1 })
    }
  }
  return out
}

export type ProyectoC = { codigo: number; numero: string; cliente_codigo: number | null; cliente_nombre?: string | null; obra: string | null }
export type ObraC = { id: string; name: string; client_id: string }

/**
 * Proyecto ↔ obra: entre las obras de los clientes nuestros del proyecto (vinculado, propuesto o con el mismo
 * nombre), la que mejor cruza los remitos del proyecto con nuestros despachos a esa obra, más el nombre.
 * `clientes`: código de Zomatik → [{id, origen}] con origen "vinculado" | "propuesto (alta)" | "propuesto (media)".
 */
export function proponerProyectosConCruce(
  proyectos: ProyectoC[],
  obras: ObraC[],
  clientes: (p: ProyectoC) => { id: string; origen: string }[],
  movimientosPorProyecto: Map<string, DiasPlanta>,
  despachosPorObra: Map<string, DiasPlanta>,
): Map<number, PropuestaC<ObraC> & { sinCliente?: boolean }> {
  const vacio: DiasPlanta = new Map()
  const out = new Map<number, PropuestaC<ObraC>>()
  for (const p of proyectos) {
    const cs = clientes(p)
    const ids = new Set(cs.map((c) => c.id))
    const z = movimientosPorProyecto.get(p.numero) || vacio
    let mejor: (PropuestaC<ObraC> & { e: Evidencia; nom: number }) | null = null
    for (const o of obras.filter((o) => ids.has(o.client_id))) {
      const e = cruzar(z, despachosPorObra.get(o.id) || vacio)
      const nom = p.obra ? parecidoNombres(p.obra, o.name) : 0
      const pz = e.ratio * e.pct * 2 + Math.min(1, e.comunes / 3) + nom * 0.6 + (contradice(e) ? -0.5 : 0)
      if (!mejor || pz > mejor.puntaje) mejor = { candidato: o, confianza: "baja", motivo: "", evidencia: textoEvidencia(e), puntaje: pz, e, nom }
    }
    if (!mejor) continue
    const origen = cs.find((c) => c.id === mejor!.candidato.client_id)?.origen || ""
    const { e, nom } = mejor
    let conf: Confianza = "baja"
    if (e.comunes >= 2 && e.ratio >= 0.6 && e.pct >= 0.8 && origen && !/media/.test(origen)) conf = "alta"
    else if ((e.comunes >= 1 && e.pct >= 0.5) || nom >= 0.5) conf = "media"
    const motivo = [nom >= 0.99 ? "obra con el mismo nombre" : nom >= 0.5 ? "obra con nombre parecido" : "", origen ? `cliente ${origen}` : ""].filter(Boolean).join(" · ")
    out.set(p.codigo, { candidato: mejor.candidato, confianza: conf, motivo: motivo || "por los despachos", evidencia: mejor.evidencia, puntaje: mejor.puntaje })
  }
  return out
}

/** cliente|fecha|planta → artículos de los remitos de ese día. */
export function indiceArticulos(remitos: RemitoDia[]): Map<string, Set<number>> {
  const idx = new Map<string, Set<number>>()
  for (const r of remitos) {
    const k = `${r.cliente_norm}|${r.fecha}|${r.planta}`
    if (!idx.has(k)) idx.set(k, new Set())
    for (const a of r.articulos) idx.get(k)!.add(a)
  }
  return idx
}

/**
 * Para una fórmula: en los días que la despachamos a un cliente con par en Zomatik, qué artículos llevan los
 * remitos de ese cliente (ese día o hasta 3 después, misma planta). `base` = días con algún remito.
 */
export function votosArticulos(formulaId: string, despachos: Despacho[], idx: Map<string, Set<number>>, clienteNorm: Map<string, string>) {
  const votos = new Map<number, number>()
  let base = 0
  const vistos = new Set<string>()
  const dias: { fecha: string; planta: string; cliente_id: string; articulos: number[] }[] = []
  for (const d of despachos) {
    if (d.formula_id !== formulaId || d.fecha < DESDE_CRUCE || !d.client_id) continue
    const cn = clienteNorm.get(d.client_id)
    if (!cn) continue
    const k0 = `${d.client_id}|${d.fecha}|${d.planta}`
    if (vistos.has(k0)) continue
    vistos.add(k0)
    const s = new Set<number>()
    for (let i = -1; i <= 3; i++) for (const a of idx.get(`${cn}|${sumarDias(d.fecha, i)}|${d.planta}`) || []) s.add(a)
    if (!s.size) continue
    base++
    dias.push({ fecha: d.fecha, planta: d.planta, cliente_id: d.client_id, articulos: [...s] })
    for (const a of s) votos.set(a, (votos.get(a) || 0) + 1)
  }
  return { votos, base, dias }
}
