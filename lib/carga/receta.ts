/**
 * Control de receta (carga-planta.md 6, con 19.4: el agua resalta pero no frena).
 *
 * - Se compara por m³ la receta de Indumix (pasada a nuestra unidad: aditivo g → kg, agua L = kg) contra la fórmula
 *   del material que hoy tiene cada salida (mapa de salidas).
 * - Frenan: cemento, áridos, aditivo de planta, una salida que pesa sin material y la Tolva 1 con la piedra equivocada.
 * - El agua distinta (receta base, nunca el agua pesada) se resalta en ámbar y NO frena.
 * - Quedan afuera el aditivo de obra y la fibra (no pasan por Indumix). El nombre de la receta no se compara.
 */
import {
  INFO_SALIDA, SALIDAS, TOLERANCIAS_BASE, grupoDeMaterial, nf,
  type FormulaSistema, type Grupo, type MaterialSistema, type RecetaPlanta, type Salida, type SalidaMapa, type Tolerancias,
} from "@/lib/carga/tipos"

export type FilaComparacion = {
  material_id: string
  nombre: string
  grupo: Grupo
  /** fórmula, por m³ (unidad del sistema) */
  formula: number
  /** receta de la planta, por m³ (unidad del sistema) */
  receta: number
  dif: number
  pct: number | null
  tol: number
  ok: boolean
  agua: boolean
}

export type Comparacion = {
  filas: FilaComparacion[]
  /** salidas que pesan algo y no tienen material en el mapa */
  sueltas: Salida[]
  malNoAgua: FilaComparacion[]
  malAgua: FilaComparacion | null
  /** coincide en todo (agua incluida) */
  ok: boolean
}

/** Valores de la receta por salida (unidad de Indumix). */
export function valoresReceta(r: Pick<RecetaPlanta, "salidas"> | null | undefined): Partial<Record<Salida, number>> {
  const v: Partial<Record<Salida, number>> = {}
  for (const s of r?.salidas || []) v[s.salida] = (v[s.salida] || 0) + (Number(s.valor) || 0)
  return v
}

/**
 * Material que vale para cada salida en esta comparación. La Tolva 1 (con alternativas) se toma como el material que
 * pide la fórmula si es una de sus alternativas: así la piedra equivocada sale en su propio control ("Tolva 1") y no
 * como diferencia de receta.
 */
export function mapaEfectivo(salidas: SalidaMapa[], formula: FormulaSistema | null): Record<Salida, SalidaMapa | null> {
  const out = Object.fromEntries(SALIDAS.map((s) => [s, null])) as Record<Salida, SalidaMapa | null>
  const pide = new Set((formula?.materiales || []).filter((m) => m.cantidad > 0).map((m) => m.material_id))
  for (const s of salidas) {
    let mat = s.material_id
    if (s.alternativas?.length) {
      const alt = s.alternativas.find((a) => pide.has(a))
      if (alt) mat = alt
    }
    out[s.salida] = { ...s, material_id: mat }
  }
  return out
}

export function compararReceta(
  receta: Pick<RecetaPlanta, "salidas"> | null,
  formula: FormulaSistema | null,
  salidas: SalidaMapa[],
  materiales: MaterialSistema[],
  tol: Tolerancias = TOLERANCIAS_BASE,
): Comparacion {
  const porId = new Map(materiales.map((m) => [m.id, m]))
  const mapa = mapaEfectivo(salidas, formula)
  const v = valoresReceta(receta)
  const rec = new Map<string, number>()
  const sueltas: Salida[] = []
  for (const s of SALIDAS) {
    const x = Number(v[s] || 0)
    if (!(x > 0)) continue
    const m = mapa[s]
    if (!m || !m.material_id) { sueltas.push(s); continue }
    rec.set(m.material_id, (rec.get(m.material_id) || 0) + x * (m.factor || 1))
  }
  const form = new Map<string, number>()
  for (const fm of formula?.materiales || []) {
    const mat = porId.get(fm.material_id)
    if (!mat || !grupoDeMaterial(mat.tipo)) continue // aditivo de obra, fibra: no pasan por Indumix
    form.set(fm.material_id, (form.get(fm.material_id) || 0) + (Number(fm.cantidad) || 0))
  }
  const ids = [...new Set([...form.keys(), ...rec.keys()])].filter((id) => (form.get(id) || 0) > 0 || (rec.get(id) || 0) > 0)
  const ordenGrupo: Record<Grupo, number> = { arido: 0, cemento: 1, aditivo: 2, agua: 3 }
  const filas: FilaComparacion[] = ids.map((id) => {
    const mat = porId.get(id)
    const grupo = grupoDeMaterial(mat?.tipo) || "arido"
    const fv = form.get(id) || 0
    const rv = rec.get(id) || 0
    const t = tol.receta[grupo]
    const tolV = Math.max(t.rel * fv, t.abs)
    const d = rv - fv
    return { material_id: id, nombre: mat?.name || "?", grupo, formula: fv, receta: rv, dif: d, pct: fv ? d / fv : null, tol: tolV, ok: Math.abs(d) <= tolV + 1e-9, agua: grupo === "agua" }
  }).sort((a, b) => ordenGrupo[a.grupo] - ordenGrupo[b.grupo] || a.nombre.localeCompare(b.nombre))
  const malNoAgua = filas.filter((f) => !f.ok && !f.agua)
  const malAgua = filas.find((f) => !f.ok && f.agua) || null
  return { filas, sueltas, malNoAgua, malAgua, ok: !malNoAgua.length && !malAgua && !sueltas.length }
}

/** "1.234 kg", "2.805 g", "168 L" por m³ */
export function cantidadPorM3(grupo: Grupo, x: number): string {
  if (grupo === "aditivo") return `${nf(x * 1000)} g`
  return `${nf(x, Math.abs(x % 1) > 0.05 ? 1 : 0)} ${grupo === "agua" ? "L" : "kg"}`
}

export type ItemControl = {
  clave: "np" | "receta" | "agua" | "tolva" | "puente" | "alarma" | "libre" | "humedad"
  /** false = frena */
  ok: boolean
  /** ámbar: no frena pero se resalta */
  aviso?: boolean
  corto: string
  texto: string
}

export type ControlReceta = {
  numero: number | null
  recetaNombre: string | null
  cmp: Comparacion | null
  items: ItemControl[]
  frenaReceta: boolean
  frenaTolva: boolean
  /** cemento, áridos, aditivo o Tolva 1: la carga no arranca */
  frena: boolean
  aguaDistinta: boolean
  /** relación agua/cemento (receta, fórmula) cuando el agua es distinta */
  ac: { receta: number | null; formula: number | null } | null
  /** motivo en palabras (el primero que frena) */
  motivo: string | null
}

export type EntradaControl = {
  /** número asignado a la fórmula en el puesto (puesto_recetas); null = sin receta */
  numero: number | null
  receta: (Pick<RecetaPlanta, "salidas"> & { nombre?: string | null }) | null
  formula: FormulaSistema | null
  salidas: SalidaMapa[]
  materiales: MaterialSistema[]
  tolerancias?: Tolerancias
  /** "Autorizar solo esta carga" (vale para la receta, NO para la Tolva 1) */
  autorizada?: { por: string; motivo?: string | null } | null
}

/** Control de receta de una fórmula en el puesto: lo usan la Entrega, la cola de carga y el servidor. */
export function controlReceta(e: EntradaControl): ControlReceta {
  const items: ItemControl[] = []
  const porId = new Map(e.materiales.map((m) => [m.id, m]))
  const nombreMat = (id: string | null | undefined) => (id ? porId.get(id)?.name || "?" : "vacía")
  const vacio: ControlReceta = { numero: e.numero, recetaNombre: e.receta?.nombre ?? null, cmp: null, items, frenaReceta: true, frenaTolva: false, frena: true, aguaDistinta: false, ac: null, motivo: null }
  if (!e.formula) {
    items.push({ clave: "receta", ok: false, corto: "Receta", texto: "No se encontró la fórmula" })
    return { ...vacio, motivo: items[0].texto }
  }
  if (e.numero == null || !e.receta || !(e.receta.salidas || []).some((s) => Number(s.valor) > 0)) {
    const t = e.numero == null ? `${e.formula.code} no tiene receta entre las 20 de la planta` : `La receta ${e.numero} de la planta está vacía`
    items.push({ clave: "receta", ok: false, corto: "Receta", texto: t })
    return { ...vacio, motivo: t }
  }
  const cmp = compararReceta(e.receta, e.formula, e.salidas, e.materiales, e.tolerancias)
  const okNoAgua = !cmp.malNoAgua.length && !cmp.sueltas.length
  const aut = e.autorizada || null
  const frenaReceta = !okNoAgua && !aut
  const partes = [
    ...cmp.malNoAgua.map((f) => `${f.nombre} ${cantidadPorM3(f.grupo, f.receta)} contra ${cantidadPorM3(f.grupo, f.formula)}`),
    ...cmp.sueltas.map((s) => `pesa en ${INFO_SALIDA[s].nombre}, sin material`),
  ]
  items.push({
    clave: "receta",
    ok: okNoAgua || !!aut,
    aviso: !okNoAgua && !!aut,
    corto: `Receta ${e.numero}`,
    texto: okNoAgua
      ? `Receta ${e.numero}: cemento, áridos y aditivo iguales a la fórmula`
      : aut
        ? `Receta ${e.numero} distinta · autorizada solo esta carga (${aut.por})`
        : `La receta ${e.numero} de la planta no coincide con ${e.formula.code}: ${partes.join(" · ")}`,
  })
  // Agua: resalta, no frena (19.4)
  let ac: ControlReceta["ac"] = null
  if (cmp.malAgua) {
    const cem = cmp.filas.filter((f) => f.grupo === "cemento")
    const cR = cem.reduce((s, f) => s + f.receta, 0), cF = cem.reduce((s, f) => s + f.formula, 0)
    ac = { receta: cR ? cmp.malAgua.receta / cR : null, formula: cF ? cmp.malAgua.formula / cF : null }
    items.push({
      clave: "agua", ok: true, aviso: true, corto: "Agua distinta",
      texto: `Agua de la receta ${nf(cmp.malAgua.receta)} contra ${nf(cmp.malAgua.formula)} L/m³ (a/c ${nf(ac.receta, 2)} contra ${nf(ac.formula, 2)}) · no frena, queda en la auditoría`,
    })
  } else items.push({ clave: "agua", ok: true, corto: "Agua", texto: "Agua igual a la fórmula" })
  // Tolva 1 (o cualquier salida con alternativas): la fórmula pide una y la tolva tiene otra
  let frenaTolva = false
  const v = valoresReceta(e.receta)
  const pide = new Set(e.formula.materiales.filter((m) => m.cantidad > 0).map((m) => m.material_id))
  for (const s of e.salidas) {
    if (!s.alternativas?.length || !(Number(v[s.salida] || 0) > 0)) continue
    const quiere = s.alternativas.find((a) => pide.has(a))
    if (!quiere) continue
    const nom = INFO_SALIDA[s.salida].nombre
    if (quiere !== s.material_id) {
      frenaTolva = true
      items.push({ clave: "tolva", ok: false, corto: nom, texto: `La fórmula pide ${nombreMat(quiere)} y la ${nom} tiene ${nombreMat(s.material_id)}` })
    } else items.push({ clave: "tolva", ok: true, corto: nom, texto: `${nom} con ${nombreMat(s.material_id)}` })
  }
  const frena = frenaReceta || frenaTolva
  const motivo = items.find((i) => !i.ok)?.texto || null
  return { numero: e.numero, recetaNombre: e.receta.nombre ?? null, cmp, items, frenaReceta, frenaTolva, frena, aguaDistinta: !!cmp.malAgua, ac, motivo }
}

/** Huella de una receta: cambia si cambia algún valor, el nombre o si se habilita/deshabilita. */
export function huellaReceta(r: RecetaPlanta): string {
  const partes = [String(r.numero), r.nombre.trim(), r.habilitada ? "1" : "0",
    ...[...r.salidas].sort((a, b) => a.salida.localeCompare(b.salida)).map((s) => `${s.salida}=${Math.round((Number(s.valor) || 0) * 1000) / 1000}@${s.orden ?? ""}`)]
  // FNV-1a de 32 bits, en hexa: alcanza para distinguir versiones de 20 recetas
  let h = 0x811c9dc5
  const txt = partes.join("|")
  for (let i = 0; i < txt.length; i++) {
    h ^= txt.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, "0")
}

/** "CP 40: 310 → 320 · Agua: 160 → 165" (lo que cambió entre dos versiones de una receta). */
export function diferenciasReceta(antes: RecetaPlanta | null, despues: RecetaPlanta): string {
  if (!antes) return "receta nueva"
  const va = valoresReceta(antes), vd = valoresReceta(despues)
  const nom = (s: Salida) => despues.salidas.find((x) => x.salida === s)?.nombre_planta || antes.salidas.find((x) => x.salida === s)?.nombre_planta || INFO_SALIDA[s].nombre
  const out: string[] = []
  for (const s of SALIDAS) {
    const a = Number(va[s] || 0), d = Number(vd[s] || 0)
    if (Math.abs(a - d) > 1e-9) out.push(`${nom(s)}: ${nf(a)} → ${nf(d)}`)
  }
  if (antes.nombre.trim() !== despues.nombre.trim()) out.push(`nombre: «${antes.nombre}» → «${despues.nombre}»`)
  if (antes.habilitada !== despues.habilitada) out.push(despues.habilitada ? "se habilitó" : "se deshabilitó")
  return out.join(" · ") || "sin cambios de valores"
}

/**
 * Cómo tendría que estar la receta de la planta para ser igual a la fórmula (por salida, unidad de Indumix).
 * Cada material va entero en UNA salida: la que ya lo pesa en la receta actual, si hay; si no, la fija (sin
 * alternativas, p. ej. 6/20 en la Tolva 4); si no, la primera que lo puede tener (la Tolva 1).
 */
export function valoresDeseados(
  formula: FormulaSistema,
  salidas: SalidaMapa[],
  materiales: MaterialSistema[],
  actual?: Pick<RecetaPlanta, "salidas"> | null,
): Partial<Record<Salida, number>> {
  const mapa = mapaEfectivo(salidas, formula)
  const v = valoresReceta(actual)
  const porId = new Map(materiales.map((m) => [m.id, m]))
  const out: Partial<Record<Salida, number>> = {}
  for (const fm of formula.materiales) {
    if (!(fm.cantidad > 0) || !grupoDeMaterial(porId.get(fm.material_id)?.tipo)) continue
    const cand = SALIDAS.filter((s) => mapa[s]?.material_id === fm.material_id)
    if (!cand.length) continue // sin salida (Espumígeno): no se puede poner
    const fija = (s: Salida) => !mapa[s]?.alternativas?.length
    const s = cand.find((x) => Number(v[x] || 0) > 0) || cand.find(fija) || cand[0]
    out[s] = (out[s] || 0) + Math.round((fm.cantidad / (mapa[s]!.factor || 1)) * 1000) / 1000
  }
  return out
}

/**
 * Ficha para cargar en Indumix (6.5, opción 1): lo que hay que cambiar en la receta de la planta para que quede igual
 * a la fórmula. El agua va solo si Grow la confirmó (19.4).
 */
export function fichaParaIndumix(
  receta: RecetaPlanta,
  formula: FormulaSistema,
  salidas: SalidaMapa[],
  materiales: MaterialSistema[],
  conAgua: boolean,
): { lineas: { salida: Salida; nombre_planta: string; antes: number; despues: number }[]; aguaPendiente: boolean } {
  const v = valoresReceta(receta)
  const quiero = valoresDeseados(formula, salidas, materiales, receta)
  const lineas: { salida: Salida; nombre_planta: string; antes: number; despues: number }[] = []
  let aguaPendiente = false
  for (const s of SALIDAS) {
    const antes = Number(v[s] || 0), despues = Number(quiero[s] || 0)
    if (Math.abs(antes - despues) < 1e-6) continue
    if (INFO_SALIDA[s].grupo === "agua" && !conAgua) { aguaPendiente = true; continue }
    const nom = receta.salidas.find((x) => x.salida === s)?.nombre_planta || salidas.find((x) => x.salida === s)?.nombre_planta || INFO_SALIDA[s].nombre
    lineas.push({ salida: s, nombre_planta: nom, antes, despues })
  }
  return { lineas, aguaPendiente }
}
