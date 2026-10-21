/**
 * Zomatik Z0 · Armado de la pantalla "Vínculos con Zomatik" (puro: sin red ni base). Lo usan
 * /api/zomatik/propuestas y /api/zomatik/dias, y se prueba con `npm run test:zomatik`.
 *
 * Clientes: la mejor propuesta (nombre + cruce por fechas, m³ y planta + señales: artículo del remito igual a la
 * fórmula, CUIT), los 3 mejores candidatos SOLO por fechas aunque el nombre no se parezca, y avisos de posible
 * duplicado. Al revés, para cada cliente de Zomatik con remitos en el año, cuál de los nuestros cubre sus días.
 * Fórmulas: el artículo que aparece en los remitos de los mismos días y clientes, con su %. Proyectos: la obra.
 * Los clientes genéricos de Zomatik (mostrador, consumidor final, varios) se marcan y no se proponen.
 */
import { nombreNormalizado, soloDigitos, cuitValido } from "@/lib/zomatik/parseo"
import { yaEstaEnRebucret, proponerFormulas } from "@/lib/zomatik/vinculos"
import {
  DESDE_CRUCE,
  agregarDia,
  confianza,
  cruzar,
  duplicadosNuestros,
  esGenerico,
  indexarDespachos,
  indexarRemitos,
  indiceArticulos,
  plantaDeDeposito,
  proponerClientesConCruce,
  proponerFormulasConCruce,
  proponerProyectosConCruce,
  puntajeFechas,
  sumarDias,
  textoEvidencia,
  votosArticulos,
  type Ajuste,
  type Confianza,
  type Despacho,
  type DiasPlanta,
  type Evidencia,
  type RemitoDia,
} from "@/lib/zomatik/cruce"

export type DespachoD = Despacho & { obra?: string | null; formula?: string | null }
export type DatosCruce = {
  clientes: { id: string; name: string; razon_social?: string | null; cuit?: string | null; active?: boolean | null; zomatik_codigo?: number | null; zomatik_vinculo?: string | null; zomatik_vinculado_por?: string | null }[]
  zcli: { codigo: number; razon_social: string; nombre_norm?: string | null; cuit?: string | null; tipo_iva?: string | null; localidad?: string | null; vendedor?: string | null; remitos_r_12m?: number | null; remitos_x_12m?: number | null; ultimo_remito?: string | null; estado?: string | null }[]
  despachos: DespachoD[]
  formulas: { id: string; name: string; code?: string | null; planta: string; zomatik_articulo_codigo?: number | null; zomatik_articulo_nombre?: string | null; zomatik_vinculo?: string | null; zomatik_vinculado_por?: string | null }[]
  articulos: { codigo: number; nombre: string; linea?: string | null }[]
  proyectos: { codigo: number; numero: string; cliente_codigo: number | null; cliente_nombre?: string | null; obra: string | null; ultima_entrega?: string | null; construction_site_id?: string | null; vinculo?: string | null }[]
  movimientos: { proyecto_numero: string; fecha: string; m3: number; deposito?: string | null; remito?: string | null; articulo?: string | null }[]
  obras: { id: string; name: string; client_id: string }[]
  remitosDia: RemitoDia[]
}

type Prop = { confianza: Confianza; motivo: string; evidencia: string }
const vacio: DiasPlanta = new Map()

const remitos12 = (z: DatosCruce["zcli"][number]) => (Number(z.remitos_r_12m) || 0) + (Number(z.remitos_x_12m) || 0)

function contexto(d: DatosCruce) {
  const porCliente = indexarDespachos(d.despachos, (x) => x.client_id)
  const porObra = indexarDespachos(d.despachos, (x) => x.construction_site_id)
  const remPorCliente = indexarRemitos(d.remitosDia)
  const idxArt = indiceArticulos(d.remitosDia)
  const zPorCod = new Map(d.zcli.map((z) => [z.codigo, z]))
  const activos = d.clientes.filter((c) => c.active !== false)
  const usados = new Set(d.clientes.filter((c) => c.zomatik_codigo != null).map((c) => c.zomatik_codigo as number))
  // Fórmula → artículo conocido: vinculada, o segura por la regla de nombre
  const artDeFormula = new Map<string, number>()
  for (const f of d.formulas) if (f.zomatik_articulo_codigo != null) artDeFormula.set(f.id, f.zomatik_articulo_codigo)
  for (const [id, p] of proponerFormulas(d.formulas.filter((f) => !f.zomatik_vinculo), d.articulos)) if (p.certeza === "seguro" && !artDeFormula.has(id)) artDeFormula.set(id, p.candidato.codigo)
  // Despachos por cliente|fecha|planta (para las señales)
  const despDia = new Map<string, DespachoD[]>()
  for (const x of d.despachos) {
    if (!x.client_id) continue
    const k = `${x.client_id}|${x.fecha}|${x.planta}`
    despDia.set(k, [...(despDia.get(k) || []), x])
  }
  return { porCliente, porObra, remPorCliente, idxArt, zPorCod, activos, usados, artDeFormula, despDia }
}

/**
 * Señales extra de un par: en los días en común, ¿el artículo del remito es el de la fórmula que despachamos? (solo
 * sube: en Zomatik el artículo a veces se carga distinto, así que que no coincida no baja la confianza);
 * y el CUIT válido de los dos lados (igual sube, distinto baja). Domicilio y obra del remito vienen vacíos en el
 * export de Zomatik de REBUCRET, así que no se usan.
 */
function senales(ctx: ReturnType<typeof contexto>, d: DatosCruce): Ajuste {
  const cuitDe = new Map(d.clientes.map((c) => [c.id, soloDigitos(c.cuit)]))
  return (clienteId, z, e, conf) => {
    const cn = nombreNormalizado(z.razon_social)
    let total = 0
    let iguales = 0
    for (const [zk, nks] of e.pares) {
      const arts = ctx.idxArt.get(`${cn}|${zk}`)
      if (!arts) continue
      const esperados = new Set<number>()
      for (const nk of nks) for (const x of ctx.despDia.get(`${clienteId}|${nk}`) || []) if (x.formula_id && ctx.artDeFormula.has(x.formula_id)) esperados.add(ctx.artDeFormula.get(x.formula_id)!)
      if (!esperados.size) continue
      total++
      if ([...esperados].some((a) => arts.has(a))) iguales++
    }
    const textos: string[] = []
    let c = conf
    if (total) {
      textos.push(`artículo igual a la fórmula en ${iguales} de ${total} días`)
      if (total >= 2 && iguales / total >= 0.8 && e.comunes >= 2 && e.pct >= 0.8 && c === "media") c = "alta"
    }
    const a = cuitDe.get(clienteId) || ""
    const b = soloDigitos(z.cuit)
    if (cuitValido(a) && cuitValido(b)) {
      if (a === b) {
        textos.push("CUIT igual")
        if (c === "media" && e.comunes >= 1) c = "alta"
      } else {
        textos.push("CUIT distinto")
        if (c === "alta") c = "media"
      }
    }
    return { confianza: c, texto: textos.length ? textos.join("; ") : null }
  }
}

export type Candidato = { codigo: number; nombre: string; evidencia: string; confianza: Confianza }

export function armarPropuestas(d: DatosCruce) {
  const ctx = contexto(d)
  const zValidos = d.zcli.filter((z) => !z.estado || /activ/i.test(z.estado))
  const zLibres = zValidos
    .filter((z) => !ctx.usados.has(z.codigo))
    .map((z) => ({ codigo: z.codigo, razon_social: z.razon_social, cuit: z.cuit, remitos_12m: remitos12(z) }))
  const zConRemitos = zLibres.filter((z) => z.remitos_12m > 0 && !esGenerico(z.razon_social))
  const ajuste = senales(ctx, d)

  // ── Clientes ──
  const sinRevisar = ctx.activos.filter((c) => !c.zomatik_vinculo)
  const propC = proponerClientesConCruce(sinRevisar, zLibres, ctx.porCliente, ctx.remPorCliente, ajuste)
  const dup = duplicadosNuestros(d.clientes)
  const nDesp = new Map<string, number>()
  for (const x of d.despachos) if (x.client_id && x.fecha >= DESDE_CRUCE) nDesp.set(x.client_id, (nDesp.get(x.client_id) || 0) + 1)
  /** Los 3 mejores clientes de Zomatik SOLO por fechas, m³ y planta (aunque el nombre no se parezca). */
  const porFechas = (clienteId: string, excluir: number | null): Candidato[] => {
    const n = ctx.porCliente.get(clienteId) || vacio
    if (n.size === 0) return []
    return zConRemitos
      .filter((z) => z.codigo !== excluir)
      .map((z) => {
        const e = cruzar(ctx.remPorCliente.get(nombreNormalizado(z.razon_social)) || vacio, n)
        return { z, e, p: puntajeFechas(e) }
      })
      .filter((x) => x.p > 0)
      .sort((a, b) => b.p - a.p)
      .slice(0, 3)
      .map(({ z, e }) => {
        const a = ajuste(clienteId, z, e, confianza(e, 0))
        return { codigo: z.codigo, nombre: z.razon_social, evidencia: a.texto ? `${textoEvidencia(e)}; ${a.texto}` : textoEvidencia(e), confianza: a.confianza }
      })
  }
  const filasC = ctx.activos.map((c) => {
    const z = c.zomatik_codigo != null ? ctx.zPorCod.get(c.zomatik_codigo) : null
    const p = propC.get(c.id)
    const pz = p ? ctx.zPorCod.get(p.candidato.codigo) : null
    return {
      id: c.id,
      name: c.name,
      cuit: c.cuit || null,
      despachos: nDesp.get(c.id) || 0,
      vinculo: c.zomatik_vinculo || null,
      vinculado_por: c.zomatik_vinculado_por || null,
      zomatik_codigo: c.zomatik_codigo ?? null,
      zomatik_nombre: z?.razon_social || null,
      duplicado: dup.get(c.id) || null,
      propuesta: p ? { codigo: p.candidato.codigo, nombre: p.candidato.razon_social, cuit: pz?.cuit || null, confianza: p.confianza, motivo: p.motivo, evidencia: p.evidencia } : null,
      candidatos: c.zomatik_vinculo ? [] : porFechas(c.id, p?.candidato.codigo ?? null),
    }
  })

  // ── Fórmulas ──
  const clienteNorm = new Map<string, string>()
  for (const c of d.clientes) if (c.zomatik_codigo != null && ctx.zPorCod.get(c.zomatik_codigo)) clienteNorm.set(c.id, nombreNormalizado(ctx.zPorCod.get(c.zomatik_codigo)!.razon_social))
  for (const [id, p] of propC) if (p.confianza === "alta" && !clienteNorm.has(id)) clienteNorm.set(id, nombreNormalizado(p.candidato.razon_social))
  const propF = proponerFormulasConCruce(d.formulas.filter((f) => !f.zomatik_vinculo), d.articulos, d.despachos, d.remitosDia, clienteNorm)
  const artPorCod = new Map(d.articulos.map((a) => [a.codigo, a]))
  const filasF = d.formulas.map((f) => {
    const p = propF.get(f.id)
    const { votos, base } = votosArticulos(f.id, d.despachos, ctx.idxArt, clienteNorm)
    const ranking = [...votos.entries()]
      .filter(([a]) => artPorCod.has(a))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([a, v]) => ({ codigo: a, nombre: artPorCod.get(a)!.nombre, pct: Math.round((v / base) * 100), dias: v, base }))
    return {
      id: f.id,
      name: f.name,
      planta: f.planta,
      vinculo: f.zomatik_vinculo || null,
      vinculado_por: f.zomatik_vinculado_por || null,
      codigo: f.zomatik_articulo_codigo ?? null,
      nombre: f.zomatik_articulo_nombre || null,
      propuesta: p ? { codigo: p.candidato.codigo, nombre: p.candidato.nombre, confianza: p.confianza, motivo: p.motivo, evidencia: p.evidencia } : null,
      ranking,
    }
  })

  // ── Proyectos ↔ obras ──
  const movPorProy = new Map<string, DiasPlanta>()
  for (const m of d.movimientos) {
    if (!movPorProy.has(m.proyecto_numero)) movPorProy.set(m.proyecto_numero, new Map())
    agregarDia(movPorProy.get(m.proyecto_numero)!, m.fecha, plantaDeDeposito(m.deposito), Number(m.m3) || 0)
  }
  const vinculadoPorCod = new Map(ctx.activos.filter((c) => c.zomatik_codigo != null).map((c) => [c.zomatik_codigo as number, c.id]))
  const propPorCod = new Map<number, { id: string; conf: string }>()
  for (const [id, p] of propC) if (p.confianza !== "baja" && !propPorCod.has(p.candidato.codigo)) propPorCod.set(p.candidato.codigo, { id, conf: p.confianza })
  const clientesDe = (p: DatosCruce["proyectos"][number]) => {
    const out: { id: string; origen: string }[] = []
    const v = p.cliente_codigo != null ? vinculadoPorCod.get(p.cliente_codigo) : undefined
    if (v) out.push({ id: v, origen: "vinculado" })
    const pr = p.cliente_codigo != null ? propPorCod.get(p.cliente_codigo) : undefined
    if (pr && pr.id !== v) out.push({ id: pr.id, origen: `propuesto (${pr.conf})` })
    const nn = nombreNormalizado(p.cliente_nombre)
    for (const c of ctx.activos) if (nn && nombreNormalizado(c.name) === nn && !out.some((o) => o.id === c.id)) out.push({ id: c.id, origen: "mismo nombre" })
    return out
  }
  const propP = proponerProyectosConCruce(d.proyectos.filter((p) => !p.vinculo), d.obras, clientesDe, movPorProy, ctx.porObra)
  const nombreC = new Map(d.clientes.map((c) => [c.id, c.name]))
  const filasP = [...d.proyectos]
    .sort((a, b) => String(b.ultima_entrega || "").localeCompare(String(a.ultima_entrega || "")))
    .map((p) => {
      const cs = clientesDe(p)
      const pr = propP.get(p.codigo)
      return {
        codigo: p.codigo,
        numero: p.numero,
        cliente_codigo: p.cliente_codigo,
        cliente_nombre: p.cliente_nombre || null,
        obra: p.obra,
        ultima_entrega: p.ultima_entrega || null,
        construction_site_id: p.construction_site_id || null,
        vinculo: p.vinculo || null,
        clientes: cs.map((c) => ({ id: c.id, name: nombreC.get(c.id) || "", origen: c.origen })),
        obras: d.obras.filter((o) => cs.some((c) => c.id === o.client_id)).map((o) => ({ id: o.id, name: o.name, cliente: nombreC.get(o.client_id) || "" })),
        propuesta: pr ? { id: pr.candidato.id, nombre: pr.candidato.name, cliente: nombreC.get(pr.candidato.client_id) || "", confianza: pr.confianza, motivo: pr.motivo, evidencia: pr.evidencia } : null,
      }
    })

  // ── Zomatik → Rebucret: para cada cliente de Zomatik con remitos en el año, cuál de los nuestros cubre sus días ──
  const vinculadoA = new Map(d.clientes.filter((c) => c.zomatik_codigo != null).map((c) => [c.zomatik_codigo as number, c]))
  const propuestoPara = new Map<number, string>()
  for (const [id, p] of propC) if (p.confianza !== "baja" && !propuestoPara.has(p.candidato.codigo)) propuestoPara.set(p.candidato.codigo, id)
  const zomatikAnio = zValidos
    .filter((z) => remitos12(z) > 0)
    .map((z) => {
      const generico = esGenerico(z.razon_social)
      const zd = ctx.remPorCliente.get(nombreNormalizado(z.razon_social)) || vacio
      let cubre: { id: string; name: string; evidencia: string; confianza: Confianza; libre: boolean } | null = null
      if (!generico && zd.size) {
        let mejor: { c: (typeof ctx.activos)[number]; e: Evidencia; p: number } | null = null
        for (const c of ctx.activos) {
          const e = cruzar(zd, ctx.porCliente.get(c.id) || vacio)
          const pz = puntajeFechas(e)
          if (pz > 0 && (!mejor || pz > mejor.p)) mejor = { c, e, p: pz }
        }
        if (mejor) {
          const zz = { codigo: z.codigo, razon_social: z.razon_social, cuit: z.cuit }
          const a = ajuste(mejor.c.id, zz, mejor.e, confianza(mejor.e, 0))
          cubre = { id: mejor.c.id, name: mejor.c.name, evidencia: a.texto ? `${textoEvidencia(mejor.e)}; ${a.texto}` : textoEvidencia(mejor.e), confianza: a.confianza, libre: !mejor.c.zomatik_vinculo }
        }
      }
      const v = vinculadoA.get(z.codigo)
      const pp = propuestoPara.get(z.codigo)
      return {
        codigo: z.codigo,
        razon_social: z.razon_social,
        cuit: z.cuit || null,
        localidad: z.localidad || null,
        tipo_iva: z.tipo_iva || null,
        vendedor: z.vendedor || null,
        remitos_12m: remitos12(z),
        ultimo_remito: z.ultimo_remito || null,
        generico,
        vinculado_a: v ? { id: v.id, name: v.name } : null,
        propuesto_para: pp ? { id: pp, name: nombreC.get(pp) || "" } : null,
        mismo_nombre: !v && !!yaEstaEnRebucret({ codigo: z.codigo, razon_social: z.razon_social }, d.clientes as any),
        cubre,
      }
    })
    .sort((a, b) => String(b.ultimo_remito || "").localeCompare(String(a.ultimo_remito || "")))

  const conteo = (xs: { vinculo: string | null; propuesta: { confianza: Confianza } | null }[]) => {
    const p = xs.filter((x) => !x.vinculo)
    return { faltan: p.length, alta: p.filter((x) => x.propuesta?.confianza === "alta").length, media: p.filter((x) => x.propuesta?.confianza === "media").length, baja: p.filter((x) => x.propuesta?.confianza === "baja").length, sin: p.filter((x) => !x.propuesta).length }
  }
  return {
    clientes: filasC,
    formulas: filasF,
    proyectos: filasP,
    zomatikAnio,
    zomatik: zValidos.map((z) => ({ codigo: z.codigo, razon_social: z.razon_social, cuit: z.cuit || null, localidad: z.localidad || null, remitos_12m: remitos12(z), vinculado: ctx.usados.has(z.codigo), generico: esGenerico(z.razon_social) })),
    articulos: d.articulos.filter((a) => !/servicio/i.test(a.linea || "")),
    sinCruce: d.remitosDia.length === 0,
    conteos: { clientes: conteo(filasC), formulas: conteo(filasF), proyectos: conteo(filasP) },
  }
}

// ---------------------------------------------------------------------------
// "Ver días": lado a lado, con los días que coinciden marcados
// ---------------------------------------------------------------------------

export type FilaNuestra = { fecha: string; m3: number; obra: string | null; formula: string | null; planta: string; cliente?: string | null; coincide: boolean }
export type FilaZomatik = { fecha: string; m3: number; articulo: string; deposito: string; cliente?: string | null; remito?: string | null; coincide: boolean }

const depositoDe = (planta: string) => (planta === "Canning" ? "Canning (116)" : planta === "Hudson" ? "REBUCRET (113)" : planta)

function marcar(e: Evidencia) {
  const z = new Set(e.pares.map(([k]) => k))
  const n = new Set(e.pares.flatMap(([, ks]) => ks))
  return { z, n }
}

export function diasCliente(d: DatosCruce, clienteId: string, codigo: number) {
  const z = d.zcli.find((x) => x.codigo === codigo)
  const cn = nombreNormalizado(z?.razon_social)
  const nDias: DiasPlanta = new Map()
  const nuestros = d.despachos.filter((x) => x.client_id === clienteId && x.fecha >= DESDE_CRUCE)
  for (const x of nuestros) agregarDia(nDias, x.fecha, x.planta, x.m3)
  const rem = d.remitosDia.filter((r) => r.cliente_norm === cn && r.fecha >= DESDE_CRUCE)
  const zDias: DiasPlanta = new Map()
  for (const r of rem) agregarDia(zDias, r.fecha, r.planta, r.m3)
  const e = cruzar(zDias, nDias)
  const m = marcar(e)
  const art = new Map(d.articulos.map((a) => [a.codigo, a.nombre]))
  return {
    evidencia: textoEvidencia(e),
    nuestros: nuestros
      .sort((a, b) => b.fecha.localeCompare(a.fecha))
      .map((x): FilaNuestra => ({ fecha: x.fecha, m3: x.m3, obra: x.obra || null, formula: x.formula || null, planta: x.planta, coincide: m.n.has(`${x.fecha}|${x.planta}`) })),
    zomatik: rem
      .sort((a, b) => b.fecha.localeCompare(a.fecha))
      .map((r): FilaZomatik => ({ fecha: r.fecha, m3: r.m3, articulo: r.articulos.map((a) => art.get(a) || String(a)).join(", "), deposito: depositoDe(r.planta), coincide: m.z.has(`${r.fecha}|${r.planta}`) })),
  }
}

export function diasFormula(d: DatosCruce, formulaId: string, articulo: number, clienteNorm: Map<string, string>) {
  const idx = indiceArticulos(d.remitosDia)
  const { dias } = votosArticulos(formulaId, d.despachos, idx, clienteNorm)
  const conArt = new Set(dias.filter((x) => x.articulos.includes(articulo)).map((x) => `${x.cliente_id}|${x.fecha}|${x.planta}`))
  const contados = new Set(dias.map((x) => `${x.cliente_id}|${x.fecha}|${x.planta}`))
  const nombreC = new Map(d.clientes.map((c) => [c.id, c.name]))
  const nuestros = d.despachos
    .filter((x) => x.formula_id === formulaId && x.fecha >= DESDE_CRUCE)
    .sort((a, b) => b.fecha.localeCompare(a.fecha))
    .map((x): FilaNuestra & { cuenta: boolean } => ({ fecha: x.fecha, m3: x.m3, obra: x.obra || null, formula: x.formula || null, planta: x.planta, cliente: x.client_id ? nombreC.get(x.client_id) || null : null, coincide: conArt.has(`${x.client_id}|${x.fecha}|${x.planta}`), cuenta: contados.has(`${x.client_id}|${x.fecha}|${x.planta}`) }))
  // Remitos de Zomatik con ese artículo, de los clientes con par, en los días cruzados
  const normDe = new Set([...clienteNorm.values()])
  const ventanas = new Set<string>()
  for (const x of dias) for (let i = -1; i <= 3; i++) ventanas.add(`${clienteNorm.get(x.cliente_id)}|${sumarDias(x.fecha, i)}|${x.planta}`)
  const art = new Map(d.articulos.map((a) => [a.codigo, a.nombre]))
  const zomatik = d.remitosDia
    .filter((r) => r.fecha >= DESDE_CRUCE && normDe.has(r.cliente_norm) && r.articulos.includes(articulo))
    .sort((a, b) => b.fecha.localeCompare(a.fecha))
    .map((r): FilaZomatik => ({ fecha: r.fecha, m3: r.m3, articulo: r.articulos.map((a) => art.get(a) || String(a)).join(", "), deposito: depositoDe(r.planta), cliente: r.cliente_norm, coincide: ventanas.has(`${r.cliente_norm}|${r.fecha}|${r.planta}`) }))
  const base = contados.size
  return { evidencia: base ? `${conArt.size} de ${base} días (${Math.round((conArt.size / base) * 100)} %) los remitos de esos clientes llevan este artículo` : "sin despachos cruzables desde abril", nuestros, zomatik }
}

export function diasProyecto(d: DatosCruce, codigo: number, obraId: string) {
  const p = d.proyectos.find((x) => x.codigo === codigo)
  const movs = d.movimientos.filter((m) => m.proyecto_numero === p?.numero && m.fecha >= DESDE_CRUCE)
  const zDias: DiasPlanta = new Map()
  for (const m of movs) agregarDia(zDias, m.fecha, plantaDeDeposito(m.deposito), m.m3)
  const nuestros = d.despachos.filter((x) => x.construction_site_id === obraId && x.fecha >= DESDE_CRUCE)
  const nDias: DiasPlanta = new Map()
  for (const x of nuestros) agregarDia(nDias, x.fecha, x.planta, x.m3)
  const e = cruzar(zDias, nDias)
  const mk = marcar(e)
  return {
    evidencia: textoEvidencia(e),
    nuestros: nuestros.sort((a, b) => b.fecha.localeCompare(a.fecha)).map((x): FilaNuestra => ({ fecha: x.fecha, m3: x.m3, obra: x.obra || null, formula: x.formula || null, planta: x.planta, coincide: mk.n.has(`${x.fecha}|${x.planta}`) })),
    zomatik: movs
      .sort((a, b) => b.fecha.localeCompare(a.fecha))
      .map((m): FilaZomatik => ({ fecha: m.fecha, m3: m.m3, articulo: m.articulo || "", deposito: m.deposito || "", remito: m.remito || null, coincide: mk.z.has(`${m.fecha}|${plantaDeDeposito(m.deposito)}`) })),
  }
}

/** Clientes nuestros → nombre normalizado del par en Zomatik (vinculados + propuestos con confianza alta). */
export function clienteNormDe(d: DatosCruce, propuestas: ReturnType<typeof armarPropuestas>): Map<string, string> {
  const out = new Map<string, string>()
  const zPorCod = new Map(d.zcli.map((z) => [z.codigo, z]))
  for (const c of d.clientes) if (c.zomatik_codigo != null && zPorCod.get(c.zomatik_codigo)) out.set(c.id, nombreNormalizado(zPorCod.get(c.zomatik_codigo)!.razon_social))
  for (const c of propuestas.clientes) if (!out.has(c.id) && c.propuesta?.confianza === "alta") out.set(c.id, nombreNormalizado(c.propuesta.nombre))
  return out
}
