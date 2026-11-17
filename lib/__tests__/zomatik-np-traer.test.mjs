// Pruebas de "Traer NP de Zomatik" (docs/specs/2026-11-17-traer-np-de-zomatik.md, sección 12): las funciones puras, la
// lista cerrada de lectura, el robot de solo lectura con un navegador SIMULADO (lib/__fixtures__/zomatik-np-traer, ver su
// README: REAL / ARMADO) y el servidor con una base SIMULADA en memoria (la misma de zomatik-np-servidor.test.mjs).
// Sin red, sin Zomatik, sin la base real.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import * as N from "../zomatik/np.ts"
import * as R from "../zomatik/np-robot.ts"
import * as W from "../zomatik/web.ts"
import * as S from "../zomatik/np-servidor.ts"
import * as T from "../zomatik/np-traer-servidor.ts"
import { MSJ_NP_AJUSTANDOSE } from "../zomatik/ajuste.ts"

const fxT = (f) => readFileSync(new URL(`../__fixtures__/zomatik-np-traer/${f}`, import.meta.url), "latin1")
const fxN = (f) => readFileSync(new URL(`../__fixtures__/zomatik-np/${f}`, import.meta.url), "latin1")
const fxA = (f) => readFileSync(new URL(`../__fixtures__/zomatik-ajuste/${f}`, import.meta.url), "latin1")
const resp = (html, status = 200, location = null) => ({ status, location, html })
const conSuc = (suc, html) => resp(`<form method="post" action="" name="frm_selsuc"><select name="selsuc"><option value="${suc}" selected>S</option></select></form>${html}`)
/** Ninguna respuesta lleva montos (punto 4 de la spec). */
const sinMontos = (x) => {
  const j = JSON.stringify(x)
  assert.doesNotMatch(j, /total|costo|\$/i, `tiene montos: ${j.slice(0, 300)}`)
}

/** Base en memoria con lo justo del cliente de Supabase que usa np-servidor (select/update/insert/upsert + rpc). */
function baseFalsa(tablas, { antesDeUpdate, antesDeInsert, fallaAltaUso } = {}) {
  const db = JSON.parse(JSON.stringify(tablas))
  class Q {
    constructor(t) { this.t = t; this.f = []; this.op = "select"; this.vals = null; this.uno = false; this.devolver = false }
    select() { if (this.op !== "select") this.devolver = true; return this }
    // "details->>Marca": un campo de un jsonb, como PostgREST
    eq(c, v) { const [a, b] = c.split("->>"); this.f.push((r) => (b ? r[a]?.[b] : r[c]) === v); return this }
    neq(c, v) { this.f.push((r) => r[c] !== v); return this }
    in(c, vs) { this.f.push((r) => vs.includes(r[c])); return this }
    is(c, v) { this.f.push((r) => (r[c] ?? null) === v); return this }
    not(c, op, v) {
      if (op === "in") { const vs = String(v).replace(/[()]/g, "").split(","); this.f.push((r) => !vs.includes(r[c])); return this }
      this.f.push((r) => (r[c] ?? null) !== v); return this
    }
    gte(c, v) { this.f.push((r) => r[c] >= v); return this }
    // "a.is.null,a.eq.x": cualquiera de las condiciones, como PostgREST (lo mínimo para vincular-servidor.ts)
    // También "c.not.in.(a,b)" (las comas de adentro de los paréntesis no separan). Como SQL: NOT con un nulo no pasa.
    or(expr) {
      const partes = []
      let prof = 0, cur = ""
      for (const ch of String(expr)) {
        if (ch === "(") prof++
        if (ch === ")") prof--
        if (ch === "," && !prof) { partes.push(cur); cur = "" } else cur += ch
      }
      partes.push(cur)
      const conds = partes.map((x) => { const [c, ...resto] = x.split("."); const neg = resto[0] === "not"; const [op, ...v] = neg ? resto.slice(1) : resto; return { c, op, neg, v: v.join(".") } })
      const una = (r, { c, op, v }) => (op === "is" && v === "null" ? (r[c] ?? null) === null : op === "eq" ? String(r[c]) === v : op === "in" ? (r[c] ?? null) !== null && v.replace(/[()]/g, "").split(",").includes(String(r[c])) : false)
      this.f.push((r) => conds.some((k) => (k.neg ? ((r[k.c] ?? null) !== null || k.op === "is") && !una(r, k) : una(r, k))))
      return this
    }
    order(c, o) { this.orden = [c, o?.ascending !== false]; return this }
    limit() { return this }
    maybeSingle() { this.uno = true; return this }
    delete() { this.op = "delete"; return this }
    update(v) { this.op = "update"; this.vals = v; return this }
    insert(v) { this.op = "insert"; this.vals = v; return this }
    upsert(v, o) { this.op = "upsert"; this.vals = v; this.clave = o?.onConflict; return this }
    then(ok, mal) { return Promise.resolve(this.correr()).then(ok, mal) }
    correr() {
      const filas = (db[this.t] ||= [])
      const pasa = (r) => this.f.every((f) => f(r))
      if (this.op === "insert") {
        antesDeInsert?.(this.t, this.vals, db)
        const nuevas = []
        for (const v of [].concat(this.vals)) {
          if (this.t === "zomatik_np" && filas.some((r) => r.marca === v.marca)) return { data: null, error: { code: "23505", message: "duplicate" } }
          if (this.t === "integraciones" && filas.some((r) => r.clave === v.clave)) return { data: null, error: { code: "23505", message: "duplicate" } }
          const base = this.t === "zomatik_np"
            ? { id: `np-${filas.length + 1}`, intentos: 0, paso: null, mensaje: null, numero: null, zomatik_codigo: null, sucursal: null, disponible_m3: null, en_curso_desde: null, saldo_decision: null, saldo_desde: null }
            : this.t === "zomatik_np_uso" ? { id: `uso-${filas.length + 1}`, activo: true } : { id: `${this.t}-${filas.length + 1}` }
          const fila = { ...base, created_at: new Date(Date.now() + filas.length).toISOString(), updated_at: new Date().toISOString(), ...v }
          filas.push(fila)
          nuevas.push({ id: fila.id })
        }
        return { data: this.devolver ? nuevas : null, error: null }
      }
      if (this.op === "upsert") {
        const k = this.clave
        const ya = filas.find((r) => r[k] === this.vals[k])
        if (ya) Object.assign(ya, this.vals)
        else filas.push({ ...this.vals })
        return { data: null, error: null }
      }
      if (this.op === "update") {
        antesDeUpdate?.(this.t, this.vals, db)
        const tocadas = filas.filter(pasa)
        // El índice único clients_zomatik_codigo_key: un código de Zomatik, un solo cliente nuestro
        if (this.t === "clients" && this.vals.zomatik_codigo != null && tocadas.length && filas.some((r) => !tocadas.includes(r) && r.zomatik_codigo === this.vals.zomatik_codigo))
          return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint \"clients_zomatik_codigo_key\"" } }
        for (const r of tocadas) Object.assign(r, this.vals)
        return { data: this.devolver ? tocadas.map((r) => ({ id: r.id })) : null, error: null }
      }
      if (this.op === "delete") {
        const fuera = filas.filter(pasa)
        db[this.t] = filas.filter((r) => !fuera.includes(r))
        return { data: this.devolver ? fuera.map((x) => ({ ...x })) : null, error: null }
      }
      const r = filas.filter(pasa).map((x) => ({ ...x }))
      if (this.orden) {
        const [c, asc] = this.orden
        r.sort((a, b) => (String(a[c] ?? "") < String(b[c] ?? "") ? -1 : String(a[c] ?? "") > String(b[c] ?? "") ? 1 : 0) * (asc ? 1 : -1))
      }
      return { data: this.uno ? r[0] || null : r, error: null }
    }
  }
  const rpcs = {
    zomatik_robot_tomar: ({ p_quien, p_segundos }) => {
      const t = (db.integraciones ||= []).find((x) => x.clave === "zomatik_robot")
      if (t && t.conectado_por !== p_quien && Date.parse(t.valor) > Date.now()) return false
      if (t) Object.assign(t, { valor: new Date(Date.now() + p_segundos * 1000).toISOString(), conectado_por: p_quien })
      else db.integraciones.push({ clave: "zomatik_robot", valor: new Date(Date.now() + p_segundos * 1000).toISOString(), conectado_por: p_quien })
      return true
    },
    zomatik_robot_soltar: ({ p_quien }) => { db.integraciones = (db.integraciones || []).filter((x) => !(x.clave === "zomatik_robot" && x.conectado_por === p_quien)); return null },
    zomatik_np_tomar: ({ p_id, p_desde, p_a }) => {
      const r = db.zomatik_np.find((x) => x.id === p_id)
      if (!r) return []
      const colgada = ["generando", "vaciando"].includes(r.estado) && r.en_curso_desde && Date.now() - Date.parse(r.en_curso_desde) > 180_000
      if (!p_desde.includes(r.estado) && !colgada) return []
      const previo = { np_id: r.id, estado_anterior: r.estado, paso_anterior: r.paso }
      Object.assign(r, { estado: p_a, en_curso_desde: new Date().toISOString(), intentos: r.intentos + 1 })
      return [previo]
    },
    remito_tipo_para: () => ({ tipo: "R" }),
    // Las mismas reglas que las funciones SQL de la migración 202611161600 (en la base, con las NP del pedido bloqueadas)
    zomatik_np_precio_guardar: ({ p_pedido, p_precio, p_formula, p_lista, p_precio_lista, p_usuario }) => {
      if (p_precio !== null && !(p_precio > 0 && p_precio < 1e8)) return { ok: false, error: "El precio tiene que ser mayor a 0" }
      const filas = (db.zomatik_np_precio ||= [])
      const f = filas.find((x) => x.scheduled_dispatch_id === p_pedido)
      const antes = f && f.formula_id === p_formula ? f.precio_m3 : null
      const grabada = ["grabar", "verificar", "grabar_cortado", "buscar_marca"]
      if ((db.zomatik_np || []).some((n) => n.scheduled_dispatch_id === p_pedido && n.tipo === "nueva" && n.formula_id === p_formula && (!["pendiente", "error", "anulada"].includes(n.estado) || grabada.includes(n.paso || ""))))
        return { ok: true, bloqueado: true, cambio: false, antes }
      if ((!f && p_precio === null) || (f && f.formula_id === p_formula && f.precio_m3 === p_precio)) return { ok: true, bloqueado: false, cambio: false, antes }
      const v = { precio_m3: p_precio, origen: p_precio === null ? null : "manual", formula_id: p_formula, lista_codigo: p_lista, precio_lista_m3: p_precio_lista, updated_by: p_usuario }
      if (f) Object.assign(f, v)
      else filas.push({ scheduled_dispatch_id: p_pedido, proyecto_precio_m3: null, ...v })
      return { ok: true, bloqueado: false, cambio: true, antes }
    },
    zomatik_np_precio_congelar: ({ p_pedido, p_precio, p_formula, p_usuario }) => {
      if (!(p_precio > 0 && p_precio < 1e8)) return false
      const filas = (db.zomatik_np_precio ||= [])
      const f = filas.find((x) => x.scheduled_dispatch_id === p_pedido)
      if (!f) {
        filas.push({ scheduled_dispatch_id: p_pedido, precio_m3: p_precio, origen: "np", formula_id: p_formula, lista_codigo: null, precio_lista_m3: null, proyecto_precio_m3: null, updated_by: p_usuario })
        return true
      }
      if (f.precio_m3 !== null && f.formula_id === p_formula) return false
      Object.assign(f, { precio_m3: p_precio, origen: "np", formula_id: p_formula, updated_by: p_usuario })
      return true
    },
    // Las mismas cuentas que las funciones SQL de la migración 202610231000 (en la base van con la NP bloqueada)
    zomatik_np_reservar: ({ p_np, p_pedido, p_m3, p_usuario }) => {
      const np = db.zomatik_np.find((x) => x.id === p_np)
      if (!np || ["anulada", "vaciar", "vaciando", "vaciada"].includes(np.estado)) return 0
      const uso = db.zomatik_np_uso.find((u) => u.np_id === p_np && u.scheduled_dispatch_id === p_pedido && u.activo)
      const libre = saldoFalso(np).libre
      if (uso) {
        uso.m3 = r3(Math.max(0, p_m3 <= uso.m3 ? p_m3 : Math.min(p_m3, uso.m3 + Math.max(libre, 0))))
        return uso.m3
      }
      if (["devolver", "cerrada"].includes(np.saldo_decision)) return 0
      const m = r3(Math.min(Math.max(p_m3, 0), Math.max(libre, 0)))
      if (m > 0) {
        db.zomatik_np_uso.push({ id: `uso-${db.zomatik_np_uso.length + 1}`, np_id: p_np, scheduled_dispatch_id: p_pedido, m3: m, activo: true, motivo: null, despachado_fijo: null, created_at: new Date(Date.now() + db.zomatik_np_uso.length).toISOString(), created_by: p_usuario })
        Object.assign(np, { saldo_desde: null, saldo_decision: null, saldo_mensaje: null })
      }
      return m
    },
    // Como la función SQL: la NP y su uso en una sola transacción (si falla el uso, no queda la NP)
    zomatik_np_crear_con_uso: ({ p }) => {
      if (db.zomatik_np.some((x) => x.marca === p.marca || (x.scheduled_dispatch_id === p.scheduled_dispatch_id && x.n === p.n))) return null
      if (fallaAltaUso) throw new Error("falló el alta del uso")
      const id = `np-${db.zomatik_np.length + 1}`
      db.zomatik_np.push({ id, intentos: 0, paso: null, mensaje: null, numero: null, zomatik_codigo: null, sucursal: null, disponible_m3: null, en_curso_desde: null, saldo_decision: null, saldo_desde: null, estado: "pendiente", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...p })
      db.zomatik_np_uso.push({ id: `uso-${db.zomatik_np_uso.length + 1}`, np_id: id, scheduled_dispatch_id: p.scheduled_dispatch_id, m3: p.m3, activo: true, motivo: null, despachado_fijo: null, created_at: new Date(Date.now() + db.zomatik_np_uso.length).toISOString() })
      return id
    },
    zomatik_np_desvincular: ({ p_uso, p_motivo }) => {
      const u = db.zomatik_np_uso.find((x) => x.id === p_uso && x.activo)
      if (!u) return null
      const ped = db.scheduled_dispatches.find((x) => x.id === u.scheduled_dispatch_id)
      const delPedido = db.zomatik_np_uso.filter((x) => x.scheduled_dispatch_id === u.scheduled_dispatch_id)
      u.despachado_fijo = ped ? N.despachadoPorUso(delPedido, ped.dispatched_m3 || 0).get(u.id) || 0 : u.despachado_fijo || 0
      Object.assign(u, { activo: false, motivo: p_motivo })
      return null
    },
    // Como la función SQL zomatik_np_saldo (RETURNS TABLE: un arreglo con una fila)
    zomatik_np_saldo: ({ p_np }) => {
      const np = db.zomatik_np.find((x) => x.id === p_np)
      if (!np) return []
      const s = saldoFalso(np)
      return [{ libre: s.libre, comprometido: s.comprometido, con_pedido_activo: s.conPedidoActivo }]
    },
    zomatik_np_devolver: ({ p_np, p_usuario }) => {
      const np = db.zomatik_np.find((x) => x.id === p_np)
      if (!np || np.estado !== "ok") return { error: "La NP ya no está en Zomatik o se está trabajando. Actualizá la pantalla." }
      const sd = saldoFalso(np)
      if (sd.conPedidoActivo) return { error: "La NP la está usando un pedido activo." }
      if (sd.libre <= 0.001) return { error: "La NP no tiene saldo." }
      if (sd.comprometido > 0.001) {
        const mensaje = `Tuvo despachos: hace falta una devolución de pedido (DEVOL) por ${sd.libre} m³.`
        Object.assign(np, { saldo_decision: "devolver", saldo_decision_por: p_usuario, saldo_mensaje: mensaje })
        return { modo: "devol", libre: sd.libre, mensaje }
      }
      Object.assign(np, { estado: "vaciar", proximo_intento: new Date().toISOString(), saldo_decision: "devolver", saldo_mensaje: "Se vacía en Zomatik (sin despachos)." })
      return { modo: "vaciar", libre: sd.libre, mensaje: "Se vacía en Zomatik (sin despachos)." }
    },
  }
  const r3 = (n) => Math.round(Number(n) * 1000) / 1000
  /** Saldo de una NP con los datos de la base simulada (misma cuenta que zomatik_np_saldo). */
  function saldoFalso(np) {
    const deNp = db.zomatik_np_uso.filter((u) => u.np_id === np.id)
    const peds = new Set(deNp.map((u) => u.scheduled_dispatch_id).filter(Boolean))
    const usos = db.zomatik_np_uso.filter((u) => u.np_id === np.id || peds.has(u.scheduled_dispatch_id)).map((u) => {
      const p = db.scheduled_dispatches.find((x) => x.id === u.scheduled_dispatch_id)
      return { ...u, pedido: p ? { id: p.id, status: p.status, dispatched_m3: p.dispatched_m3 || 0 } : null }
    })
    return N.saldoNp({ id: np.id, m3: np.m3 }, usos)
  }
  const llamadas = []
  return {
    db,
    llamadas,
    from: (t) => new Q(t),
    rpc: async (n, a) => {
      llamadas.push(n)
      try {
        return { data: rpcs[n] ? rpcs[n](a) : null, error: null }
      } catch (e) {
        return { data: null, error: { message: e.message } }
      }
    },
  }
}

// ===========================================================================
// 1. Funciones puras
// ===========================================================================

test("numeroNpTipeado: los 7 formatos de 8.1 y lo que no se entiende", () => {
  assert.deepEqual(N.numeroNpTipeado("1195"), { numero: "0001-00001195", comprobante: null })
  assert.deepEqual(N.numeroNpTipeado("0001-00001195"), { numero: "0001-00001195", comprobante: null })
  assert.deepEqual(N.numeroNpTipeado(" 1-1195 "), { numero: "0001-00001195", comprobante: null })
  assert.deepEqual(N.numeroNpTipeado("NP 0001-00001195"), { numero: "0001-00001195", comprobante: "15" })
  assert.deepEqual(N.numeroNpTipeado("NP1195"), { numero: "0001-00001195", comprobante: "15" })
  assert.deepEqual(N.numeroNpTipeado("np2 2086"), { numero: "0001-00002086", comprobante: "16" })
  assert.deepEqual(N.numeroNpTipeado("NP2 0001-00002086"), { numero: "0001-00002086", comprobante: "16" })
  // NP2 con guion o espacio (revisión del 17/11)
  assert.deepEqual(N.numeroNpTipeado("NP2-2086"), { numero: "0001-00002086", comprobante: "16" })
  assert.deepEqual(N.numeroNpTipeado("NP2 2086"), { numero: "0001-00002086", comprobante: "16" })
  assert.deepEqual(N.numeroNpTipeado("np2-0001-00002086"), { numero: "0001-00002086", comprobante: "16" })
  assert.deepEqual(N.numeroNpTipeado("2086"), { numero: "0001-00002086", comprobante: null })
  assert.deepEqual(N.numeroNpTipeado("NP-1195"), { numero: "0001-00001195", comprobante: "15" })
  // "NP2086" sin separador es la NP 2086 (NP2 lleva un espacio o un guion después)
  assert.deepEqual(N.numeroNpTipeado("NP2086"), { numero: "0001-00002086", comprobante: "15" })
  for (const malo of ["", "   ", "abc", "NP", "NP3 1", "123456789", "0000-00001195", "NP 12a", "1195-", null, undefined]) assert.equal(N.numeroNpTipeado(malo), null, String(malo))
})

test("esNpTraida / marcaTraida: las dos marcas sí (la de MERVA del 17/11 también); las del sistema no", () => {
  assert.equal(N.marcaTraida("15", "0001-00001195"), "Traida de Zomatik - NP 0001-00001195")
  assert.equal(N.marcaTraida("16", "0001-00002086"), "Traida de Zomatik - NP2 0001-00002086")
  assert.equal(N.esNpTraida(N.marcaTraida("15", "1195")), true)
  assert.equal(N.esNpTraida("A mano - NP 0001-00001195"), true)
  assert.equal(N.esNpTraida("Sistema Rebucret - pedido 1a2b3c4d - NP 1"), false)
  assert.equal(N.esNpTraida(N.marcaNp("1a2b3c4d-0000", 2)), false)
  assert.equal(N.esNpTraida(null), false)
  // ASCII, como las otras marcas (el "í" llegaba mal a Zomatik)
  assert.match(N.marcaTraida("15", "1195"), /^[\x20-\x7e]+$/)
})

test("MSJ_TRAER: textos de 3.3 sin montos; ajustandose es el mismo de ajuste.ts", () => {
  assert.equal(N.MSJ_TRAER.ajustandose, MSJ_NP_AJUSTANDOSE)
  assert.equal(N.MSJ_TRAER.ok("NP 0001-00001195", 25), "Lista: NP 0001-00001195, 25 m³ libres.")
  assert.equal(N.MSJ_TRAER.ya_estaba("NP 0001-00001195", 12.5), "Ya estaba en el sistema: NP 0001-00001195, 12,5 m³ libres.")
  assert.equal(N.MSJ_TRAER.otro_remito("X"), "Es NP2 (remito X) y el pedido dice R.")
  assert.equal(N.MSJ_TRAER.otro_remito("R"), "Es NP (remito R) y el pedido dice X.")
  assert.equal(N.MSJ_TRAER.con_remitos(["RM2 0099-00002758"]), "Ya tiene remitos en Zomatik (RM2 0099-00002758): por ahora no se puede traer.")
  for (const v of Object.values(N.MSJ_TRAER)) if (typeof v === "string") assert.doesNotMatch(v, /\$/)
})

const ART = { codigo: 10090014, nombre: "H30-620-10 C (HUD)" }
/** Lo leído de la NP 1195 (como lo devuelve el robot) y el pedido de MERVA en Hudson. */
const leida = (extra = {}) => ({
  fila: { codigo: 157919, numero: "NP 0001-00001195", cliente: "MERVA S.A.", estado: "PEN", autorizacion: { porAutorizar: false, conRemito: true }, ...(extra.fila || {}) },
  campos: { idcliente: "24644", numero: "0001-00001195", comprobante: "15", deposito: "113", depositoNombre: "REBUCRET", fecha_entrega: "2026-11-19", estado: "1", proyecto: 0, marcaSistema: false, ...(extra.campos || {}) },
  renglones: extra.renglones || [{ codigoArticulo: "10090014", nombreArticulo: "H30-620-10 C (HUD)", cantidad: 25 }],
  comprobantes: "comprobantes" in extra ? extra.comprobantes : { remitos: [], facturas: [] },
  pedido: { clienteCodigo: 24644, articulo: ART, depositoPlanta: 113, nombrePlanta: "Hudson", remito: null, ...(extra.pedido || {}) },
})

test("evaluarNpTraida: lista con los m³ del renglón y el R/X de la NP", () => {
  assert.deepEqual(N.evaluarNpTraida(leida()), { ok: true, m3: 25, avisos: [], remito: "R", proyecto: null })
  assert.deepEqual(N.evaluarNpTraida(leida({ campos: { comprobante: "16", numero: "0001-00002086" }, pedido: { remito: "X" } })).remito, "X")
})

test("evaluarNpTraida: un caso por motivo (8.3)", () => {
  const motivo = (x) => {
    const r = N.evaluarNpTraida(x)
    assert.equal(r.ok, false)
    return [r.motivo, r.error]
  }
  assert.deepEqual(motivo(leida({ fila: { estado: "ANU" } })), ["anulada", "Está anulada en Zomatik."])
  assert.deepEqual(motivo(leida({ campos: { estado: "0" } })), ["inactiva", "No está activa en Zomatik."])
  assert.deepEqual(motivo(leida({ campos: { estado: "" } }))[0], "inactiva") // sin el campo: falla cerrado
  assert.deepEqual(motivo(leida({ fila: { autorizacion: { porAutorizar: true, conRemito: false } } }))[0], "sin_autorizar")
  assert.deepEqual(motivo(leida({ fila: { autorizacion: { porAutorizar: false, conRemito: false } } }))[0], "sin_autorizar")
  assert.deepEqual(motivo(leida({ fila: { autorizacion: null } }))[0], "sin_autorizar")
  assert.deepEqual(motivo(leida({ campos: { idcliente: "99999" }, fila: { cliente: "OTRO SA" } })), ["otro_cliente", "Es de otro cliente: OTRO SA."])
  assert.deepEqual(motivo(leida({ renglones: [{ codigoArticulo: "10090020", nombreArticulo: "H21-620-10 C (CAN)", cantidad: 25 }] })), ["otro_articulo", "Es de otro hormigón: H21-620-10 C (CAN)."])
  assert.deepEqual(motivo(leida({ renglones: [{ codigoArticulo: "10090014", nombreArticulo: "H30-620-10 C (HUD)", cantidad: 10 }, { codigoArticulo: "10090014", nombreArticulo: "H30-620-10 C (HUD)", cantidad: 15 }] })), ["renglon_doble", "Tiene dos renglones de H30-620-10 C (HUD): no se puede traer."])
  assert.deepEqual(motivo(leida({ campos: { deposito: "104", depositoNombre: "PILAR" } })), ["otro_deposito", "Es del depósito PILAR y el pedido es de Hudson: corregilo en Zomatik."])
  assert.deepEqual(motivo(leida({ pedido: { depositoPlanta: null } }))[0], "otro_deposito")
  assert.deepEqual(motivo(leida({ campos: { comprobante: "16" }, pedido: { remito: "R" } })), ["otro_remito", "Es NP2 (remito X) y el pedido dice R."])
  assert.deepEqual(motivo(leida({ comprobantes: null })), ["comprobantes_ilegibles", "No se pudo saber si tiene remitos. Probá en un rato."])
  assert.deepEqual(motivo(leida({ comprobantes: { remitos: [{ numero: "RM 0099-00001000" }], facturas: [] } }))[0], "con_remitos")
  assert.deepEqual(motivo(leida({ renglones: [{ codigoArticulo: "10090014", nombreArticulo: "H30-620-10 C (HUD)", cantidad: 0 }] })), ["sin_m3", "No le quedan m³ en Zomatik."])
  assert.deepEqual(motivo(leida({ campos: { comprobante: "" } }))[0], "no_se_entiende")
  // Una NP del sistema (con su marca) no se trae, aunque todo lo demás esté bien
  assert.deepEqual(motivo(leida({ campos: { marcaSistema: true } })), ["del_sistema", N.MSJ_TRAER.del_sistema])
})

test("tieneMarcaDelSistema: la marca de hoy y la vieja con '·'; otras observaciones no", () => {
  assert.equal(N.tieneMarcaDelSistema(N.marcaNp("1a2b3c4d-0000-4000-8000-000000000001", 1)), true)
  assert.equal(N.tieneMarcaDelSistema("Obra X · Sistema Rebucret · pedido 1a2b3c4d · NP 2"), true)
  assert.equal(N.tieneMarcaDelSistema("Para facturar"), false)
  assert.equal(N.tieneMarcaDelSistema("Traida de Zomatik - NP 0001-00001195"), false)
  assert.equal(N.tieneMarcaDelSistema(null), false)
})

test("evaluarNpTraida: el orden (anulada gana a otro cliente; sin autorizar gana a otro hormigón)", () => {
  assert.equal(N.evaluarNpTraida(leida({ fila: { estado: "ANULADA" }, campos: { idcliente: "1" } })).motivo, "anulada")
  assert.equal(N.evaluarNpTraida(leida({ fila: { autorizacion: { porAutorizar: true, conRemito: false } }, renglones: [] })).motivo, "sin_autorizar")
  assert.equal(N.evaluarNpTraida(leida({ campos: { idcliente: "1", deposito: "104" } })).motivo, "otro_cliente")
})

test("evaluarNpTraida: avisos (proyecto, factura, otros renglones) y el alta sin cliente ni artículo", () => {
  const r = N.evaluarNpTraida(leida({
    campos: { proyecto: 576 },
    comprobantes: { remitos: [], facturas: [{ numero: "F2 0001-00002455" }] },
    renglones: [{ codigoArticulo: "10090014", nombreArticulo: "H30-620-10 C (HUD)", cantidad: 25 }, { codigoArticulo: "20010001", nombreArticulo: "BOMBA", cantidad: 1 }],
  }))
  assert.equal(r.ok, true)
  assert.equal(r.proyecto, 576)
  assert.equal(r.m3, 25)
  assert.deepEqual(r.avisos, ["Es de un proyecto.", "Tiene factura: al terminar, el ajuste lo hace Juan a mano.", "Tiene otros renglones: al terminar, el ajuste lo revisa una persona."])
  // Alta: sin cliente ni artículo se controla lo demás (y no hay m³ todavía)
  const alta = N.evaluarNpTraida(leida({ pedido: { clienteCodigo: null, articulo: null }, campos: { idcliente: "1" } }))
  assert.deepEqual([alta.ok, alta.m3], [true, null])
})

test("esLaNpTraida: mismo número y cliente; otro número, otro cliente o NP vs NP2 no", () => {
  const t = { clienteCodigo: 24644, numero: "NP 0001-00001195", comprobante: "15" }
  assert.equal(N.esLaNpTraida({ numero: "0001-00001195", idcliente: "24644", comprobante: "15" }, t), true)
  assert.equal(N.esLaNpTraida({ numero: "1-1195", idcliente: "24644" }, t), true) // sin comprobante en el form
  assert.equal(N.esLaNpTraida({ numero: "0001-00001196", idcliente: "24644", comprobante: "15" }, t), false)
  assert.equal(N.esLaNpTraida({ numero: "0001-00001195", idcliente: "15893", comprobante: "15" }, t), false)
  assert.equal(N.esLaNpTraida({ numero: "0001-00001195", idcliente: "24644", comprobante: "16" }, t), false)
  assert.equal(N.esLaNpTraida({ numero: "", idcliente: "24644" }, t), false)
})

test("textoOpcionElegida: el nombre del depósito elegido", () => {
  assert.equal(N.textoOpcionElegida(fxT("np-abierta-1195.html"), "deposito"), "REBUCRET")
  assert.equal(N.textoOpcionElegida(fxT("np-abierta-otro-deposito.html"), "deposito"), "PILAR")
  assert.equal(N.textoOpcionElegida(fxN("np-abierta.html"), "deposito"), "Canning")
  assert.equal(N.textoOpcionElegida("<html></html>", "deposito"), "")
})

// ===========================================================================
// 2. Lista cerrada (7.1 y 17): solo lectura y atada a una NP
// ===========================================================================

test("rutaLecturaNp: acepta abrir la NP, su detalle y sus comprobantes (con ESA NP); nada más", () => {
  const N1 = 157919
  assert.equal(W.rutaLecturaNp("modificar_pedidos.php?codigo=157919", "GET", N1), true)
  assert.equal(W.rutaLecturaNp("/modificar_pedidos.php?codigo=157919", "GET", N1), true)
  assert.equal(W.rutaLecturaNp("manage_pedidos.php?pedidos=157919&fcomprobante=15&fcuit=30&pedidos_unico=1731850000123456789&fdeposito=113&fproyecto=0&fcliente=24644&facopio=&forigen=1&flista=10251&rnd=7", "GET", N1), true)
  assert.equal(W.rutaLecturaNp("_comprobantes.php?ftarget=pedidos&ftargetid=157919", "GET", N1), true)
  assert.equal(W.rutaLecturaNp("_comprobantes.php?ftarget=pedidos&ftargetid=157919&rnd=7", "GET", N1), true)
  const rechazadas = [
    ["modificar_pedidos.php?codigo=157920", "GET"], // otro N
    ["modificar_pedidos.php?codigo=1579190", "GET"],
    ["modificar_pedidos.php", "GET"],
    ["_comprobantes.php?ftarget=pedidos&ftargetid=157920", "GET"],
    ["manage_pedidos.php?pedidos=157920&pedidos_unico=1", "GET"],
    ["manage_pedidos.php?pedidos=157919&pedidos=157920&pedidos_unico=1", "GET"],
    ["manage_pedidos.php?pedidos=157919&pedidos_unico=abc", "GET"],
    ["manage_pedidos.php?pedidos=157919&pedidos_unico=1&codigo=157919", "GET"],
    ["manage_pedidos.php?pedidos=157919&pedidos_unico=1&fborrar=5349824", "GET"],
    ["manage_pedidos.php?pedidos=157919&pedidos_unico=1&farticulo=1000015959", "GET"],
    ["manage_pedidos.php?pedidos=157919&pedidos_unico=1&fautorizar=1", "GET"],
    ["manage_pedidos.php?pedidos=157919&pedidos_unico=1&faccion=1", "GET"],
    ["grabar_pedidos.php?codigo=157919", "GET"],
    ["grabar_pedidos.php?codigo=157919", "POST"],
    ["modificar_pedidos.php?codigo=157919", "POST"], // cualquier POST
    ["_comprobantes.php?ftarget=pedidos&ftargetid=157919", "POST"],
    [W.RUTA_AUTORIZAR_NP, "POST"],
    ["_autorizarpedido.php?autorizar=157919", "GET"],
    ["remitir_ordenfabricacion.php?codigo=157919", "GET"],
    ["listado_pedidosdevolucion.php?pedido=157919", "GET"],
    // Links de ACCIÓN de la fila del listado (REAL 17/11): un GET ejecuta
    ["set_pedidos_entregaaprobada.php?codigo=157919", "GET"],
    ["borrar_pedidos.php?codigo=157919", "GET"],
    ["generar_pedido.php?codigo=157919", "GET"],
    ["modificar_remitos.php?pedido=157919", "GET"],
    ["listado_pedidos.php?enviado=1", "POST"], // el listado va por la lectura de siempre, no por este grupo
  ]
  for (const [r, m] of rechazadas) assert.equal(W.rutaLecturaNp(r, m, N1), false, `${m} ${r}`)
  // Sin una NP válida, nada
  assert.equal(W.rutaLecturaNp("modificar_pedidos.php?codigo=0", "GET", 0), false)
  assert.equal(W.rutaLecturaNp("modificar_pedidos.php?codigo=1.5", "GET", 1.5), false)
  // Y la lectura de siempre sigue sin dejar ninguno de los links de acción
  for (const r of ["set_pedidos_entregaaprobada.php?codigo=157919", "borrar_pedidos.php?codigo=157919", "generar_pedido.php?codigo=157919", "remitir_ordenfabricacion.php?codigo=157919", "modificar_pedidos.php?codigo=157919"]) assert.equal(W.rutaPermitida(r, "GET"), false, r)
})

// ===========================================================================
// 3. Robot de solo lectura (navegador simulado)
// ===========================================================================

/** Navegador simulado: cada ruta tiene que pasar la lista cerrada (la lectura de siempre o, con `codigo`, la de esa NP). */
function navFalso(rutas, { codigo = null } = {}) {
  const nav = {
    suc: "18",
    llamadas: [],
    async sucursal(id) { nav.llamadas.push({ m: "SUC", ruta: id }); nav.suc = id; return true },
    async get(ruta) { return responder("GET", ruta) },
    async post(ruta, cuerpo) { return responder("POST", ruta, cuerpo ? Buffer.from(cuerpo).toString("latin1") : "") },
  }
  async function responder(m, ruta, cuerpo = null) {
    nav.llamadas.push({ m, ruta, suc: nav.suc, cuerpo })
    assert.ok(W.rutaPermitida(ruta, m) || (codigo !== null && W.rutaLecturaNp(ruta, m, codigo)), `ruta fuera de la lista cerrada: ${m} ${ruta}`)
    const r = rutas.find(([mm, re]) => mm === m && re.test(ruta))
    if (!r) throw new Error(`ruta no simulada: ${m} ${ruta}`)
    return typeof r[2] === "function" ? r[2]({ ruta, cuerpo, suc: nav.suc }) : r[2]
  }
  return nav
}
const navListado = (html) => navFalso([
  ["GET", /^listado_pedidos\.php$/, resp(fxN("listado-buscador.html"))],
  ["POST", /^listado_pedidos\.php\?enviado=1$/, typeof html === "function" ? html : resp(html)],
])
const navNp = (codigo, { pagina = fxT("np-abierta-1195.html"), detalle = fxT("detalle-1195.html"), comprobantes = fxA("comprobantes-sin-nada.html") } = {}) => navFalso([
  ["GET", new RegExp(`^modificar_pedidos\\.php\\?codigo=${codigo}$`), resp(pagina)],
  ["GET", /^manage_pedidos\.php\?/, resp(detalle)],
  ["GET", new RegExp(`^_comprobantes\\.php\\?ftarget=pedidos&ftargetid=${codigo}`), comprobantes === null ? resp("<html>Error</html>", 500) : resp(comprobantes)],
], { codigo })

test("buscarNpPorNumero: una fila (autorizada), sin total; el filtro es solo el número", async () => {
  const nav = navListado(fxT("listado-1195.html"))
  const r = await R.buscarNpPorNumero(nav, { numero: "0001-00001195", comprobante: null })
  assert.deepEqual(r.filas, [{ codigo: 157919, numero: "NP 0001-00001195", cliente: "MERVA S.A.", estado: "PEN", autorizacion: { porAutorizar: false, conRemito: true } }])
  sinMontos(r)
  const post = nav.llamadas.find((l) => l.m === "POST")
  const q = new URLSearchParams(post.cuerpo)
  assert.equal(q.get("bus_numero"), "0001-00001195")
  assert.equal(q.get("bus_sucursal"), "18")
  assert.equal(q.get("bus_fechad"), "")
  // Solo la sucursal 18 y lectura
  assert.ok(nav.llamadas.filter((l) => l.m === "SUC").every((l) => l.ruta === "18"))
  assert.ok(nav.llamadas.every((l) => l.m !== "GET" || !/set_|borrar_|generar_|remitir_/.test(l.ruta)))
})

test("buscarNpPorNumero: NP y NP2 con el mismo número (dos filas; con el prefijo, una); ninguna; sin autorizar", async () => {
  let r = await R.buscarNpPorNumero(navListado(fxT("listado-np-y-np2.html")), { numero: "0001-00002086", comprobante: null })
  assert.deepEqual(r.filas.map((f) => f.numero), ["NP2 0001-00002086", "NP 0001-00002086"])
  r = await R.buscarNpPorNumero(navListado(fxT("listado-np-y-np2.html")), { numero: "0001-00002086", comprobante: "16" })
  assert.deepEqual(r.filas.map((f) => [f.codigo, f.numero]), [[157767, "NP2 0001-00002086"]])
  r = await R.buscarNpPorNumero(navListado(fxN("listado-vacio.html").replace("<html>", `<html><form name="frm_selsuc"><select name="selsuc"><option value="18" selected>R</option></select></form>`)), { numero: "0001-00001195", comprobante: null })
  assert.deepEqual(r.filas, [])
  r = await R.buscarNpPorNumero(navListado(fxT("listado-sin-autorizar.html")), { numero: "0001-00001195", comprobante: null })
  assert.deepEqual(r.filas[0].autorizacion, { porAutorizar: true, conRemito: false })
  // Otro número en el listado (el filtro no anduvo): no se toma
  r = await R.buscarNpPorNumero(navListado(fxN("listado-1176.html").replace("<html>", `<html><form name="frm_selsuc"><select name="selsuc"><option value="18" selected>R</option></select></form>`)), { numero: "0001-00001195", comprobante: null })
  assert.deepEqual(r.filas, [])
})

test("buscarNpPorNumero: el listado de otra sucursal (frm_selsuc ≠ 18) o paginado → formato", async () => {
  await assert.rejects(R.buscarNpPorNumero(navListado(({ }) => conSuc("17", fxT("listado-1195.html").replace(/<form method="post" action="" name="frm_selsuc">[\s\S]*?<\/form>/, ""))), { numero: "0001-00001195", comprobante: null }), (e) => e.codigo === "formato" && /otra sucursal/.test(e.message))
  await assert.rejects(R.buscarNpPorNumero(navListado(fxT("listado-1195.html").replace("</table>", "</table>Pagina 1 de 3")), { numero: "0001-00001195", comprobante: null }), (e) => e.codigo === "formato")
  // Sin el buscador (Zomatik cambió la página): formato, no un error nuestro
  const sinBuscador = navFalso([["GET", /^listado_pedidos\.php$/, resp("<html><body>Mantenimiento</body></html>")]])
  await assert.rejects(R.buscarNpPorNumero(sinBuscador, { numero: "0001-00001195", comprobante: null }), (e) => e.codigo === "formato" && e.paso === "listado" && !("recorte" in e))
})

test("leerNpParaTraer: la NP abierta REAL (28/10) + su detalle + sin comprobantes → cliente, depósito, fecha y un renglón", async () => {
  const pagina = fxN("np-abierta.html").replaceAll("{{CODIGO}}", "157767").replace("{{OBS}}", "").replace("{{NUMERO}}", "0001-00002086").replace("{{RENGLONES}}", "")
  const nav = navNp(157767, { pagina, detalle: fxN("detalle-np-abierta.html") })
  const r = await R.leerNpParaTraer(nav, { codigo: 157767, numero: "NP2 0001-00002086", comprobante: "16" }, { azar: () => 7 })
  assert.deepEqual(r.campos, { idcliente: "15893", numero: "0001-00002086", comprobante: "15", deposito: "116", depositoNombre: "Canning", fecha_entrega: "2026-10-23", estado: "1", proyecto: 0, marcaSistema: false })
  assert.deepEqual(r.renglones, [{ codigoArticulo: "10090020", nombreArticulo: "H21-620-10 C (CAN)", cantidad: 1 }])
  assert.deepEqual(r.comprobantes, { remitos: [], facturas: [] })
  sinMontos(r)
  // El detalle se cargó como la página (pedidos=N), sin agregar ni borrar
  const man = nav.llamadas.find((l) => /^manage_pedidos/.test(l.ruta))
  assert.match(man.ruta, /^manage_pedidos\.php\?pedidos=157767&/)
  assert.doesNotMatch(man.ruta, /fborrar|farticulo|fautorizar/)
  assert.ok(nav.llamadas.every((l) => l.m !== "POST"))
})

test("leerNpParaTraer: la 1195 (captura del 17/11) y con remito + factura", async () => {
  let r = await R.leerNpParaTraer(navNp(157919), { codigo: 157919, numero: "NP 0001-00001195", comprobante: "15" }, { azar: () => 7 })
  assert.deepEqual(r.campos, { idcliente: "24644", numero: "0001-00001195", comprobante: "15", deposito: "113", depositoNombre: "REBUCRET", fecha_entrega: "2026-11-19", estado: "1", proyecto: 0, marcaSistema: false })
  assert.deepEqual(r.renglones, [{ codigoArticulo: "10090014", nombreArticulo: "H30-620-10 C (HUD)", cantidad: 25 }])
  sinMontos(r)
  r = await R.leerNpParaTraer(navNp(157919, { comprobantes: fxA("comprobantes-con-factura.html") }), { codigo: 157919, numero: "NP 0001-00001195", comprobante: "15" })
  assert.deepEqual(r.comprobantes, { remitos: [{ numero: "RM2 0099-00002758" }], facturas: [{ numero: "F2 0001-00002455" }] })
  r = await R.leerNpParaTraer(navNp(157919, { comprobantes: fxT("comprobantes-solo-factura.html") }), { codigo: 157919, numero: "NP 0001-00001195", comprobante: "15" })
  assert.deepEqual(r.comprobantes, { remitos: [], facturas: [{ numero: "F2 0001-00002455" }] })
  r = await R.leerNpParaTraer(navNp(157919, { comprobantes: null }), { codigo: 157919, numero: "NP 0001-00001195", comprobante: "15" })
  assert.equal(r.comprobantes, null)
})

test("leerNpParaTraer: otra NP en la página, otro número, sin form o sin detalle → formato", async () => {
  const leer = (o, d = {}) => R.leerNpParaTraer(navNp(157919, o), { codigo: 157919, numero: "NP 0001-00001195", comprobante: "15", ...d })
  await assert.rejects(leer({ pagina: fxT("np-abierta-1195.html").replace('name="pedidos" value="157919"', 'name="pedidos" value="157920"') }), (e) => e.codigo === "formato")
  await assert.rejects(leer({}, { numero: "NP 0001-00001196" }), (e) => e.codigo === "formato" && /otro número/.test(e.message))
  await assert.rejects(leer({ pagina: "<html>Error</html>" }), (e) => e.codigo === "formato")
  await assert.rejects(leer({ detalle: "<html>Error</html>" }), (e) => e.codigo === "formato")
})

test("leerNpParaAjuste con NP traída (sin la marca): sigue si número y cliente coinciden; 'revisar' con otro cliente", async () => {
  const COD = 157919
  const nav = () => navFalso([
    ["GET", /^modificar_pedidos\.php\?codigo=157919$/, resp(fxT("np-abierta-1195.html"))],
    ["GET", /^manage_pedidos\.php\?/, resp(fxT("detalle-1195.html"))],
    ["GET", /^listado_pedidos\.php$/, resp(fxN("listado-buscador.html"))],
    ["POST", /^listado_pedidos\.php\?enviado=1$/, resp(fxT("listado-1195.html"))],
  ], { codigo: COD })
  const d = { codigo: COD, numero: "NP 0001-00001195", marca: "A mano - NP 0001-00001195", articuloCodigo: 10090014, articuloNombre: "H30-620-10 C (HUD)" }
  // Sin `traida`: como siempre, frena por la marca
  await assert.rejects(R.leerNpParaAjuste(nav(), d), /marca del sistema/)
  const l = await R.leerNpParaAjuste(nav(), { ...d, traida: { clienteCodigo: 24644, numero: "NP 0001-00001195", comprobante: "15" } })
  assert.equal(l.cantidad, 25)
  await assert.rejects(R.leerNpParaAjuste(nav(), { ...d, traida: { clienteCodigo: 15893, numero: "NP 0001-00001195", comprobante: "15" } }), /marca del sistema/)
  await assert.rejects(R.leerNpParaAjuste(nav(), { ...d, traida: { clienteCodigo: 24644, numero: "NP2 0001-00001195", comprobante: "16" } }), /marca del sistema/)
})

// ===========================================================================
// 4. Servidor: traerNp con la base simulada
// ===========================================================================

const HUD = "22222222-2222-4222-8222-222222222222"
const CAN = "11111111-1111-4111-8111-111111111111"
const PED = "1a2b3c4d-0000-4000-8000-000000000001"
const OTRO_PED = "9f9f9f9f-0000-4000-8000-000000000002"
const MERVA = "c-merva"

const tablasTraer = (extra = {}) => ({
  plants: [{ id: HUD, name: "Hudson" }, { id: CAN, name: "Canning" }],
  zomatik_np_config: [{ plant_id: HUD, activo: true, desde: "2026-10-01T00:00:00.000Z", deposito: 113, exigir_np: "aviso", aviso_hasta: null }, { plant_id: CAN, activo: true, desde: "2026-10-01T00:00:00.000Z", deposito: 116, exigir_np: "aviso", aviso_hasta: null }],
  clients: [{ id: MERVA, name: "MERVA S.A.", zomatik_codigo: 24644 }, { id: "c-sin", name: "SIN VINCULO", zomatik_codigo: null }, { id: "c-otro", name: "OTRO", zomatik_codigo: 99999 }],
  formulas: [
    { id: "f-hud", code: "H30 HUD", plant_id: HUD, zomatik_articulo_codigo: 10090014, zomatik_articulo_nombre: "H30-620-10 C (HUD)" },
    { id: "f-can", code: "H21 CAN", plant_id: CAN, zomatik_articulo_codigo: 10090020, zomatik_articulo_nombre: "H21-620-10 C (CAN)" },
    { id: "f-sin", code: "H8 HUD", plant_id: HUD, zomatik_articulo_codigo: null, zomatik_articulo_nombre: null },
  ],
  zomatik_articulos: [{ codigo: 10090014, nombre: "H30-620-10 C (HUD)", codigo_sistema: 1000016000 }],
  scheduled_dispatches: [{ id: PED, status: "scheduled", quantity_m3: 8, plant_id: HUD, client_id: MERVA, construction_site_id: "o1", formula_id: "f-hud", scheduled_arrival_time: "2026-11-20T11:00:00.000Z", created_at: "2026-11-17T12:00:00.000Z", created_by: "Titan" }],
  construction_sites: [{ id: "o1", name: "Las Lomas" }],
  zomatik_np: [], zomatik_np_uso: [], zomatik_np_pedido: [], zomatik_np_excepciones: [], zomatik_np_ajustes: [], activity_log: [], integraciones: [],
  ...extra,
})

/** Dependencias simuladas: Zomatik con la NP 1195 (o lo que se pase) y el reloj del turno. */
function depTraer({ listado = fxT("listado-1195.html"), pagina, detalle, comprobantes, alLeer, falla, demoraLogin = 0 } = {}) {
  const cuenta = { lectura: 0, lecturaNp: [], esperas: 0, requestsNp: 0 }
  let reloj = 1_000_000
  const dep = {
    navegadorLectura: async () => {
      cuenta.lectura++
      reloj += demoraLogin // un login lento (el reloj simulado avanza)
      if (falla) throw falla
      // listado null: Zomatik muestra la página sin el buscador
      return listado === null ? navFalso([["GET", /^listado_pedidos\.php$/, resp("<html><body>Mantenimiento</body></html>")]]) : navListado(listado)
    },
    navegadorLecturaNp: async (codigo) => {
      cuenta.lecturaNp.push(codigo)
      const nav = navNp(codigo, { pagina, detalle, comprobantes })
      const get = nav.get
      nav.get = async (r) => {
        cuenta.requestsNp++
        const x = await get(r)
        if (/^_comprobantes/.test(r)) alLeer?.()
        return x
      }
      return nav
    },
    robot: { buscarNpPorNumero: R.buscarNpPorNumero, leerNpParaTraer: R.leerNpParaTraer },
    ahora: () => reloj,
    esperar: async (ms) => { cuenta.esperas++; reloj += ms },
  }
  return { dep, cuenta }
}

const traer = (sb, dep, extra = {}) => T.traerNp({ numero: "1195", plantId: HUD, clientId: MERVA, formulaId: "f-hud", remito: null, usuario: "Titan", sb, dep, ...extra })

test("traerNp: registra la NP 1195 (fila de 6.8 exacta), Actividad sin montos, turno tomado y soltado", async () => {
  const sb = baseFalsa(tablasTraer())
  const { dep, cuenta } = depTraer()
  const r = await traer(sb, dep)
  assert.equal(r.ok, true, r.error)
  assert.equal(r.yaEstaba, false)
  assert.equal(r.remito, "R")
  assert.deepEqual(r.avisos, [])
  assert.deepEqual([r.np.numero, r.np.libre, r.np.m3, r.np.traida, r.np.remito, r.np.client_id, r.np.formula_id, r.np.plant_id], ["NP 0001-00001195", 25, 25, true, "R", MERVA, "f-hud", HUD])
  sinMontos(r)
  assert.equal(sb.db.zomatik_np.length, 1)
  const f = sb.db.zomatik_np[0]
  const { id, created_at, updated_at, ok_at, saldo_desde, ...resto } = f
  assert.ok(ok_at && saldo_desde)
  assert.deepEqual(resto, {
    scheduled_dispatch_id: null, n: 1, marca: "Traida de Zomatik - NP 0001-00001195", tipo: "nueva", proyecto_codigo: null, es_adicional: false,
    plant_id: HUD, client_id: MERVA, formula_id: "f-hud", fecha: "2026-11-19", fecha_zomatik: "2026-11-19", m3: 25,
    estado: "ok", paso: "autorizada", numero: "NP 0001-00001195", zomatik_codigo: 157919, sucursal: "18",
    created_by: "Titan", intentos: 0, proximo_intento: null, mensaje: null, vendedor_usuario_id: null,
    // los que pone la base simulada al insertar
    disponible_m3: null, en_curso_desde: null, saldo_decision: null,
  })
  // Actividad
  const act = sb.db.activity_log.filter((a) => a.details?.["Qué pasó"] === "NP traída de Zomatik")
  assert.equal(act.length, 1)
  assert.deepEqual(act[0].details, { "Qué pasó": "NP traída de Zomatik", NP: "NP 0001-00001195", Cliente: "MERVA S.A.", Hormigón: "H30-620-10 C (HUD)", "m³": 25, Entrega: "2026-11-19", Planta: "Hudson", Marca: "Traida de Zomatik - NP 0001-00001195" })
  assert.equal(act[0].action, "crear")
  assert.equal(act[0].entity_id, null)
  sinMontos(sb.db.activity_log)
  // Turno: tomado y soltado; Zomatik se leyó una vez, con la NP 157919
  assert.ok(sb.llamadas.includes("zomatik_robot_tomar"))
  assert.ok(sb.llamadas.includes("zomatik_robot_soltar"))
  assert.equal(sb.db.integraciones.filter((x) => x.clave === "zomatik_robot").length, 0)
  assert.deepEqual([cuenta.lectura, cuenta.lecturaNp], [1, [157919]])
})

test("traerNp: buscar dos veces la misma NP no crea dos filas (la segunda, 'ya estaba' sin leer Zomatik)", async () => {
  const sb = baseFalsa(tablasTraer())
  const a = depTraer()
  assert.equal((await traer(sb, a.dep)).ok, true)
  const b = depTraer()
  for (const numero of ["1195", "0001-00001195", "NP 0001-00001195"]) {
    const r = await traer(sb, b.dep, { numero })
    assert.deepEqual([r.ok, r.yaEstaba, r.np.libre], [true, true, 25], numero)
  }
  assert.equal(sb.db.zomatik_np.length, 1)
  assert.deepEqual([b.cuenta.lectura, b.cuenta.lecturaNp.length], [0, 0])
})

/** La fila de MERVA del 17/11 (antecedente de la spec), sin pedido. */
const filaMerva = (extra = {}) => ({
  id: "np-merva", scheduled_dispatch_id: null, n: 1, marca: "A mano - NP 0001-00001195", tipo: "nueva", es_adicional: false, proyecto_codigo: null, plant_id: HUD, client_id: MERVA, formula_id: "f-hud",
  fecha: "2026-11-19", m3: 25, estado: "ok", paso: "a_mano", mensaje: null, numero: "NP 0001-00001195", zomatik_codigo: 157919, sucursal: "18", disponible_m3: null, intentos: 0,
  proximo_intento: null, en_curso_desde: null, created_at: "2026-11-17T12:00:00.000Z", updated_at: "2026-11-17T12:00:00.000Z", saldo_decision: null, saldo_desde: null, fecha_zomatik: "2026-11-19", ...extra,
})

test("traerNp: la fila de MERVA del 17/11 se encuentra sin llamar a Zomatik; si otro pedido la usa entera, 'usada'", async () => {
  let sb = baseFalsa(tablasTraer({ zomatik_np: [filaMerva()] }))
  const { dep, cuenta } = depTraer()
  let r = await traer(sb, dep)
  assert.deepEqual([r.ok, r.yaEstaba, r.np.id, r.np.libre, r.np.traida], [true, true, "np-merva", 25, true])
  assert.deepEqual([cuenta.lectura, cuenta.lecturaNp.length], [0, 0])
  assert.ok(!sb.llamadas.includes("zomatik_robot_tomar"))
  // Otro pedido activo usa 10: se ofrece con 15 libres y el aviso
  sb = baseFalsa(tablasTraer({ zomatik_np: [filaMerva()], zomatik_np_uso: [{ id: "u1", np_id: "np-merva", scheduled_dispatch_id: PED, m3: 10, activo: true, motivo: null, despachado_fijo: null, created_at: "2026-11-17T13:00:00Z" }] }))
  r = await traer(sb, dep)
  assert.deepEqual([r.ok, r.np.libre, r.avisos], [true, 15, ["Otro pedido ya usa 10 m³."]])
  // La usa entera
  sb = baseFalsa(tablasTraer({ zomatik_np: [filaMerva()], zomatik_np_uso: [{ id: "u1", np_id: "np-merva", scheduled_dispatch_id: PED, m3: 25, activo: true, motivo: null, despachado_fijo: null, created_at: "2026-11-17T13:00:00Z" }] }))
  r = await traer(sb, dep)
  assert.deepEqual([r.ok, r.motivo, r.error], [false, "usada", "Ya la usa otro pedido y no le quedan m³ libres."])
  assert.deepEqual([cuenta.lectura, cuenta.lecturaNp.length], [0, 0])
})

test("traerNp: ya en el sistema pero no sirve (anulada, revisar, otra planta, otro cliente, cerrada, NP2 con el pedido en R)", async () => {
  const caso = async (fila, extra = {}) => {
    const sb = baseFalsa(tablasTraer({ zomatik_np: [filaMerva(fila)] }))
    const r = await traer(sb, depTraer().dep, extra)
    assert.equal(r.ok, false)
    return [r.motivo, r.error]
  }
  assert.deepEqual((await caso({ estado: "vaciada" }))[0], "anulada_sistema")
  assert.deepEqual((await caso({ estado: "anulada" }))[0], "anulada_sistema")
  assert.deepEqual((await caso({ estado: "revisar" }))[0], "revisar")
  assert.deepEqual(await caso({ plant_id: CAN }), ["otra_planta", "Es de otra planta."])
  assert.deepEqual(await caso({ client_id: "c-otro" }), ["otro_cliente", "Es de otro cliente: OTRO."])
  assert.deepEqual((await caso({ saldo_decision: "devolver" }))[0], "cerrada")
  assert.deepEqual(await caso({ numero: "NP2 0001-00001195", marca: "A mano - NP2 0001-00001195" }, { remito: "R" }), ["otro_remito", "Es NP2 (remito X) y el pedido dice R."])
  // NP y NP2 con ese número en el sistema y sin prefijo: ambigua
  const sb = baseFalsa(tablasTraer({ zomatik_np: [filaMerva(), filaMerva({ id: "np-2", numero: "NP2 0001-00001195", marca: "A mano - NP2 0001-00001195" })] }))
  assert.equal((await traer(sb, depTraer().dep)).motivo, "ambigua")
})

test("traerNp: si otro la trajo en el mismo momento (23505 por la marca), se usa esa como 'ya estaba'", async () => {
  let sb
  const { dep } = depTraer({ alLeer: () => sb.db.zomatik_np.push(filaMerva({ id: "np-otro", marca: "Traida de Zomatik - NP 0001-00001195", paso: "autorizada" })) })
  sb = baseFalsa(tablasTraer())
  const r = await traer(sb, dep)
  assert.deepEqual([r.ok, r.yaEstaba, r.np.id], [true, true, "np-otro"])
  assert.equal(sb.db.zomatik_np.length, 1)
  assert.equal(sb.db.activity_log.filter((a) => a.details?.["Qué pasó"] === "NP traída de Zomatik").length, 0)
})

test("traerNp: con el robot ocupado, espera hasta 15 s (reloj simulado) y dice 'ocupado' sin tocar Zomatik ni la base", async () => {
  const sb = baseFalsa(tablasTraer({ integraciones: [{ clave: "zomatik_robot", valor: new Date(Date.now() + 120_000).toISOString(), conectado_por: "otro·robot" }] }))
  const { dep, cuenta } = depTraer()
  const r = await traer(sb, dep)
  assert.deepEqual([r.ok, r.motivo, r.error], [false, "ocupado", "Zomatik está ocupado con otra tarea. Probá en un minuto."])
  assert.equal(cuenta.esperas, 5) // 3 s × 5 = 15 s
  assert.deepEqual([cuenta.lectura, cuenta.lecturaNp.length, sb.db.zomatik_np.length], [0, 0, 0])
  // el turno del otro sigue siendo del otro
  assert.equal(sb.db.integraciones.find((x) => x.clave === "zomatik_robot").conectado_por, "otro·robot")
})

test("traerNp: llave apagada, número de otra serie o mal escrito → sin Zomatik; datos que no sirven → 'datos' o sin vínculo", async () => {
  const apagada = tablasTraer()
  apagada.zomatik_np_config[0].activo = false
  let sb = baseFalsa(apagada)
  const { dep, cuenta } = depTraer()
  assert.deepEqual([(await traer(sb, dep)).motivo, (await traer(sb, dep)).error], ["apagada", "NP: se carga a mano en Zomatik."])
  sb = baseFalsa(tablasTraer())
  assert.deepEqual(await traer(sb, dep, { numero: "7706" }).then((r) => [r.motivo, r.error]), ["otra_serie", "Ese número no es de Rebucret (van del 1000 al 5999)."])
  assert.equal((await traer(sb, dep, { numero: "abc" })).motivo, "formato")
  assert.equal((await traer(sb, dep, { clientId: "c-sin" })).motivo, "cliente_sin_vinculo")
  assert.equal((await traer(sb, dep, { formulaId: "f-sin" })).motivo, "formula_sin_vinculo")
  assert.equal((await traer(sb, dep, { formulaId: "f-can" })).motivo, "datos") // fórmula de otra planta
  assert.equal((await traer(sb, dep, { plantId: "33333333-3333-4333-8333-333333333333" })).motivo, "datos")
  assert.deepEqual([cuenta.lectura, cuenta.lecturaNp.length, sb.db.zomatik_np.length], [0, 0, 0])
  assert.ok(!sb.llamadas.includes("zomatik_robot_tomar"))
})

test("traerNp: cada rechazo de Zomatik no registra nada y suelta el turno", async () => {
  const casos = [
    [{ listado: fxN("listado-vacio.html").replace("<html>", `<html><form name="frm_selsuc"><select name="selsuc"><option value="18" selected>R</option></select></form>`) }, {}, "no_existe"],
    [{ listado: fxT("listado-np-y-np2.html") }, { numero: "2086" }, "ambigua"],
    [{ pagina: fxT("np-abierta-otro-cliente.html") }, {}, "otro_cliente"],
    [{ pagina: fxT("np-abierta-otro-deposito.html") }, {}, "otro_deposito"],
    [{ listado: fxT("listado-sin-autorizar.html") }, {}, "sin_autorizar"],
    [{ comprobantes: fxA("comprobantes-con-factura.html") }, {}, "con_remitos"],
    [{ comprobantes: null }, {}, "comprobantes_ilegibles"],
    [{}, { remito: "X" }, "otro_remito"],
    [{ pagina: fxT("np-abierta-1195.html").replace('<option value="1" selected>Activo</option>', '<option value="1">Activo</option>').replace('<option value="0">Invisible</option>', '<option value="0" selected>Invisible</option>') }, {}, "inactiva"],
    [{ detalle: fxT("detalle-1195.html").replace("10090014", "10090020").replace("H30-620-10 C (HUD)", "H21-620-10 C (CAN)") }, {}, "otro_articulo"],
  ]
  for (const [z, extra, motivo] of casos) {
    const sb = baseFalsa(tablasTraer())
    const r = await traer(sb, depTraer(z).dep, extra)
    assert.equal(r.ok, false, motivo)
    assert.equal(r.motivo, motivo, `${motivo}: ${r.error}`)
    assert.equal(sb.db.zomatik_np.length, 0, motivo)
    assert.equal(sb.db.integraciones.filter((x) => x.clave === "zomatik_robot").length, 0, `${motivo}: turno sin soltar`)
    sinMontos(r)
  }
  const r = await traer(baseFalsa(tablasTraer()), depTraer({ pagina: fxT("np-abierta-otro-cliente.html") }).dep)
  assert.equal(r.error, "Es de otro cliente: MERVA S.A.") // la razón social de la fila del listado
})

test("traerNp: Zomatik no responde → 'zomatik'; no se entiende → 'no_se_entiende' con el recorte en Actividad; nada registrado", async () => {
  let sb = baseFalsa(tablasTraer())
  let r = await traer(sb, depTraer({ falla: Object.assign(new Error("No se pudo conectar con Zomatik"), { codigo: "sin_respuesta" }) }).dep)
  assert.deepEqual([r.motivo, r.error, sb.db.zomatik_np.length], ["zomatik", "Zomatik no responde ahora. Probá en unos minutos.", 0])
  sb = baseFalsa(tablasTraer())
  const raro = "<html><body>Cambió todo $ 225.000</body></html>"
  r = await traer(sb, depTraer({ pagina: raro }).dep)
  assert.deepEqual([r.motivo, sb.db.zomatik_np.length], ["no_se_entiende", 0])
  const a = sb.db.activity_log.find((x) => /no se entendió/.test(x.details?.["Qué pasó"] || ""))
  // En Actividad, solo el paso y el largo: nunca el HTML (puede tener montos)
  assert.deepEqual(a.details, { "Qué pasó": "Traer NP de Zomatik: no se entendió la NP", Paso: "abrir_np", Mensaje: "Zomatik mostró la NP de una forma que no se entiende (no se abrió la NP).", "Largo de la respuesta": raro.length })
  sinMontos(sb.db.activity_log)
  assert.equal(sb.db.integraciones.filter((x) => x.clave === "zomatik_robot").length, 0)
  // Sin el buscador de pedidos: no_se_entiende (no un 500)
  sb = baseFalsa(tablasTraer())
  r = await traer(sb, depTraer({ listado: null }).dep)
  assert.deepEqual([r.motivo, sb.db.zomatik_np.length], ["no_se_entiende", 0])
  assert.equal(sb.db.activity_log.find((x) => /no se entendió/.test(x.details?.["Qué pasó"] || "")).details.Paso, "listado")
  // Una ruta fuera de la lista cerrada es nuestra: se tira (la ruta contesta 500 y avisa)
  sb = baseFalsa(tablasTraer())
  await assert.rejects(traer(sb, depTraer({ falla: Object.assign(new Error("Ruta de Zomatik no permitida"), { codigo: "ruta_no_permitida" }) }).dep), /no permitida/)
  assert.equal(sb.db.integraciones.filter((x) => x.clave === "zomatik_robot").length, 0)
})

test("traerNp: avisos con factura y con otros renglones (se trae igual)", async () => {
  const sb = baseFalsa(tablasTraer())
  const dosRenglones = fxT("detalle-1195.html").replace(/(<tr>\s*<td class="itemformulario" >[\s\S]*?<\/tr>)/, (x) => x + x.replaceAll("5349824", "5349825").replace("10090014", "20010001").replace("H30-620-10 C (HUD)", "SERVICIO DE BOMBA"))
  const r = await traer(sb, depTraer({ detalle: dosRenglones, comprobantes: fxT("comprobantes-solo-factura.html") }).dep)
  assert.equal(r.ok, true, r.error)
  assert.deepEqual(r.avisos, ["Tiene factura: al terminar, el ajuste lo hace Juan a mano.", "Tiene otros renglones: al terminar, el ajuste lo revisa una persona."])
  assert.equal(sb.db.zomatik_np[0].m3, 25) // solo el renglón del artículo de la fórmula
})

test("traerNp en el alta: el cliente y la fórmula salen de la NP; con dos fórmulas, elegir (sin registrar); cliente que no está", async () => {
  // Una sola fórmula de Hudson con ese artículo
  let sb = baseFalsa(tablasTraer())
  let r = await traer(sb, depTraer().dep, { clientId: null, formulaId: null })
  assert.equal(r.ok, true, r.error)
  assert.deepEqual([sb.db.zomatik_np[0].client_id, sb.db.zomatik_np[0].formula_id, r.remito], [MERVA, "f-hud", "R"])
  // Dos fórmulas: elegir, y nada registrado
  const t = tablasTraer()
  t.formulas.push({ id: "f-hud-b", code: "H30 HUD bombeable", plant_id: HUD, zomatik_articulo_codigo: 10090014, zomatik_articulo_nombre: "H30-620-10 C (HUD)" })
  sb = baseFalsa(t)
  r = await traer(sb, depTraer().dep, { clientId: null, formulaId: null })
  assert.deepEqual([r.ok, r.motivo, r.error, r.elegirFormula], [false, "elegir_formula", "¿Qué fórmula?", [{ id: "f-hud", code: "H30 HUD" }, { id: "f-hud-b", code: "H30 HUD bombeable" }]])
  assert.equal(sb.db.zomatik_np.length, 0)
  assert.equal(sb.db.integraciones.filter((x) => x.clave === "zomatik_robot").length, 0)
  // Elegida: se busca de nuevo con esa fórmula
  r = await traer(sb, depTraer().dep, { clientId: null, formulaId: "f-hud-b" })
  assert.equal(r.ok, true, r.error)
  assert.equal(sb.db.zomatik_np[0].formula_id, "f-hud-b")
  // Ninguna fórmula de la planta con ese artículo
  const sinF = tablasTraer()
  sinF.formulas = sinF.formulas.filter((f) => f.id !== "f-hud")
  r = await traer(baseFalsa(sinF), depTraer().dep, { clientId: null, formulaId: null })
  assert.deepEqual([r.motivo, r.error], ["sin_formula", "Ninguna fórmula de Hudson está vinculada con H30-620-10 C (HUD)."])
  // El cliente de la NP no está en el sistema
  const sinCli = tablasTraer()
  sinCli.clients = sinCli.clients.filter((c) => c.zomatik_codigo !== 99999)
  sb = baseFalsa(sinCli)
  r = await traer(sb, depTraer({ pagina: fxT("np-abierta-otro-cliente.html") }).dep, { clientId: null, formulaId: null })
  assert.deepEqual([r.motivo, r.error], ["cliente_no_esta", "El cliente de la NP (MERVA S.A.) no está en el sistema. Agregalo con «Traer de Zomatik»."])
  assert.equal(sb.db.zomatik_np.length, 0)
})

// ===========================================================================
// 5. Lo que ya existía, con la NP traída
// ===========================================================================

test("npUsable / validarSaldo: una NP con saldo de otra planta no sirve ('Esa NP es de otra planta.')", async () => {
  const sb = baseFalsa(tablasTraer({ zomatik_np: [filaMerva({ plant_id: CAN })] }))
  const u = await S.npUsable(sb, sb.db.zomatik_np[0], { client_id: MERVA, formula_id: "f-hud", plant_id: HUD })
  assert.deepEqual(u, { error: "Esa NP es de otra planta.", motivo: "otra_planta" })
  const ok = await S.npUsable(sb, { ...sb.db.zomatik_np[0], plant_id: HUD }, { client_id: MERVA, formula_id: "f-hud", plant_id: HUD })
  assert.deepEqual(ok, { libre: 25, comprometido: 0, conPedidoActivo: false })
  // Forzarla desde el pedido (sincronizar con la elección)
  const s = await S.sincronizarPedido(PED, "Titan", { tipo: "saldo", np_id: "np-merva" }, sb)
  assert.equal(s.error, "Esa NP es de otra planta.")
  assert.equal(sb.db.zomatik_np_uso.length, 0)
})

test("npsConSaldo: con planta solo las de esa planta (o sin planta); las traídas marcadas, con R/X", async () => {
  const sb = baseFalsa(tablasTraer({ zomatik_np: [filaMerva(), filaMerva({ id: "np-can", plant_id: CAN, numero: "NP2 0001-00002090", marca: N.marcaNp(OTRO_PED, 1) })] }))
  const todas = await S.npsConSaldo({ sb, clientId: MERVA })
  assert.deepEqual(todas.map((x) => [x.id, x.traida, x.remito]).sort(), [["np-can", false, "X"], ["np-merva", true, "R"]])
  const hud = await S.npsConSaldo({ sb, clientId: MERVA, plantId: HUD })
  assert.deepEqual(hud.map((x) => x.id), ["np-merva"])
})

test("sincronizarPedido con la NP traída: la usa (sin crear otra) y le pasa la fecha del pedido; pidiendo más, NP nueva por la diferencia", async () => {
  let sb = baseFalsa(tablasTraer({ zomatik_np: [filaMerva()] }))
  let s = await S.sincronizarPedido(PED, "Titan", { tipo: "saldo", np_id: "np-merva" }, sb)
  assert.equal(s.error, undefined)
  assert.deepEqual([s.creadas, s.usadas], [0, 1])
  assert.equal(sb.db.zomatik_np.length, 1)
  assert.deepEqual(sb.db.zomatik_np_uso.map((u) => [u.np_id, u.scheduled_dispatch_id, u.m3, u.activo]), [["np-merva", PED, 8, true]])
  assert.equal(sb.db.zomatik_np[0].fecha, "2026-11-20") // la del pedido (solo en el sistema)
  assert.equal(sb.db.zomatik_np[0].fecha_zomatik, "2026-11-19")
  assert.ok(sb.db.activity_log.some((a) => a.details?.["Qué pasó"] === "El pedido usa 8 m³ de la NP traída de Zomatik"))
  // La sincronización siguiente no pide decidir si se mueve
  s = await S.sincronizarPedido(PED, "Titan", null, sb)
  assert.deepEqual([s.creadas, s.usadas, s.avisos.filter((a) => /fecha/i.test(a))], [0, 0, []])
  // Pedido de 30 m³ con 25 libres: 25 de la traída y 5 en una NP nueva
  const t = tablasTraer({ zomatik_np: [filaMerva()] })
  t.scheduled_dispatches[0].quantity_m3 = 30
  sb = baseFalsa(t)
  s = await S.sincronizarPedido(PED, "Titan", { tipo: "saldo", np_id: "np-merva" }, sb)
  assert.deepEqual([s.creadas, s.usadas], [1, 1])
  const nueva = sb.db.zomatik_np.find((x) => x.id !== "np-merva")
  assert.deepEqual([nueva.m3, nueva.estado, nueva.scheduled_dispatch_id], [5, "pendiente", PED])
  assert.deepEqual(sb.db.zomatik_np_uso.filter((u) => u.np_id === "np-merva").map((u) => u.m3), [25])
})

test("sincronizarPedido: la traída que ya usa otro pedido no cambia de fecha", async () => {
  const sb = baseFalsa(tablasTraer({
    zomatik_np: [filaMerva()],
    scheduled_dispatches: [...tablasTraer().scheduled_dispatches, { id: OTRO_PED, status: "scheduled", quantity_m3: 5, plant_id: HUD, client_id: MERVA, construction_site_id: "o1", formula_id: "f-hud", scheduled_arrival_time: "2026-11-19T11:00:00.000Z", created_at: "2026-11-17T12:00:00.000Z", created_by: "Titan" }],
    zomatik_np_uso: [{ id: "u1", np_id: "np-merva", scheduled_dispatch_id: OTRO_PED, m3: 5, activo: true, motivo: null, despachado_fijo: null, created_at: "2026-11-17T13:00:00Z" }],
  }))
  const s = await S.sincronizarPedido(PED, "Titan", { tipo: "saldo", np_id: "np-merva" }, sb)
  assert.equal(s.usadas, 1)
  assert.equal(sb.db.zomatik_np[0].fecha, "2026-11-19")
})

test("decidirSaldo('devolver') con NP traída: nunca zomatik_np_devolver; queda 'devolver' con el aviso de hacerlo a mano", async () => {
  const sb = baseFalsa(tablasTraer({ zomatik_np: [filaMerva()] }))
  const r = await S.decidirSaldo("np-merva", "devolver", "Titan", sb)
  assert.deepEqual(r, { ok: true, mensaje: N.MSJ_TRAIDA_DEVOLVER })
  assert.ok(!sb.llamadas.includes("zomatik_np_devolver"))
  const np = sb.db.zomatik_np[0]
  assert.deepEqual([np.estado, np.saldo_decision, np.saldo_decision_por, np.saldo_mensaje], ["ok", "devolver", "Titan", N.MSJ_TRAIDA_DEVOLVER])
  // "Ya la devolví" sigue igual
  const c = await S.decidirSaldo("np-merva", "cerrada", "Bautista Caputo", sb, "DEVOL 0001-00000123")
  assert.equal(c.ok, true)
  assert.equal(sb.db.zomatik_np[0].saldo_decision, "cerrada")
  // Una NP del sistema sigue yendo por zomatik_np_devolver (se vacía)
  const sb2 = baseFalsa(tablasTraer({ zomatik_np: [filaMerva({ marca: N.marcaNp(OTRO_PED, 1) })] }))
  await S.decidirSaldo("np-merva", "devolver", "Titan", sb2)
  assert.ok(sb2.llamadas.includes("zomatik_np_devolver"))
  assert.equal(sb2.db.zomatik_np[0].estado, "vaciar")
})

test("decidirSaldo('devolver') con NP traída: con un pedido activo, sin saldo, o si un pedido la toma en el medio → no (y se deshace)", async () => {
  let sb = baseFalsa(tablasTraer({ zomatik_np: [filaMerva()], zomatik_np_uso: [{ id: "u1", np_id: "np-merva", scheduled_dispatch_id: PED, m3: 5, activo: true, motivo: null, despachado_fijo: null, created_at: "2026-11-17T13:00:00Z" }] }))
  assert.deepEqual(await S.decidirSaldo("np-merva", "devolver", "Titan", sb), { ok: false, error: "La NP la está usando un pedido activo." })
  sb = baseFalsa(tablasTraer({ zomatik_np: [filaMerva()], scheduled_dispatches: [{ ...tablasTraer().scheduled_dispatches[0], status: "completed", dispatched_m3: 25 }], zomatik_np_uso: [{ id: "u1", np_id: "np-merva", scheduled_dispatch_id: PED, m3: 25, activo: true, motivo: null, despachado_fijo: null, created_at: "2026-11-17T13:00:00Z" }] }))
  assert.deepEqual(await S.decidirSaldo("np-merva", "devolver", "Titan", sb), { ok: false, error: "La NP no tiene saldo." })
  // Un pedido la toma justo entre la lectura y el guardado
  let una = true
  sb = baseFalsa(tablasTraer({ zomatik_np: [filaMerva()] }), {
    antesDeUpdate: (t, v, db) => {
      if (t === "zomatik_np" && v.saldo_decision === "devolver" && una) {
        una = false
        db.zomatik_np_uso.push({ id: "u9", np_id: "np-merva", scheduled_dispatch_id: PED, m3: 8, activo: true, motivo: null, despachado_fijo: null, created_at: new Date().toISOString() })
      }
    },
  })
  const r = await S.decidirSaldo("np-merva", "devolver", "Titan", sb)
  assert.deepEqual(r, { ok: false, error: "Un pedido la tomó recién. Actualizá la pantalla." })
  assert.deepEqual([sb.db.zomatik_np[0].saldo_decision, sb.db.zomatik_np[0].saldo_mensaje], [null, null])
  assert.ok(!sb.llamadas.includes("zomatik_np_devolver"))
})

// ===========================================================================
// 6. Revisión del 17/11: duplicados, NP del sistema y tiempos
// ===========================================================================

test("traerNp: la NP ya está en el sistema por su CÓDIGO de Zomatik (sin número guardado): no se inserta otra", async () => {
  // Cortada en el medio: "revisar" con el código pero sin el número → mensaje claro, sin insertar
  let sb = baseFalsa(tablasTraer({ zomatik_np: [filaMerva({ id: "np-sis", marca: N.marcaNp(PED, 1), scheduled_dispatch_id: PED, estado: "revisar", numero: null, zomatik_codigo: 157919 })] }))
  let r = await traer(sb, depTraer().dep)
  assert.deepEqual([r.ok, r.motivo, r.error], [false, "revisar", "Esa NP es del sistema y está a revisar: avisale a un gerencial."])
  assert.equal(sb.db.zomatik_np.length, 1)
  assert.equal(sb.db.integraciones.filter((x) => x.clave === "zomatik_robot").length, 0)
  for (const estado of ["error", "generando", "pendiente"]) {
    sb = baseFalsa(tablasTraer({ zomatik_np: [filaMerva({ id: "np-sis", marca: N.marcaNp(PED, 1), estado, numero: null, zomatik_codigo: 157919 })] }))
    r = await traer(sb, depTraer().dep)
    assert.deepEqual([r.motivo, sb.db.zomatik_np.length], ["revisar", 1], estado)
  }
  // "ok" con el código: se usa esa (ya estaba), sin otra fila
  sb = baseFalsa(tablasTraer({ zomatik_np: [filaMerva({ id: "np-sis", numero: null, zomatik_codigo: 157919 })] }))
  r = await traer(sb, depTraer().dep)
  assert.deepEqual([r.ok, r.yaEstaba, r.np.id, sb.db.zomatik_np.length], [true, true, "np-sis", 1])
  // Anulada en el sistema con ese código: anulada_sistema
  sb = baseFalsa(tablasTraer({ zomatik_np: [filaMerva({ id: "np-sis", estado: "anulada", numero: null, zomatik_codigo: 157919 })] }))
  r = await traer(sb, depTraer().dep)
  assert.deepEqual([r.motivo, sb.db.zomatik_np.length], ["anulada_sistema", 1])
})

test("traerNp: la NP aparece en el sistema por su número mientras se leía Zomatik: se usa esa, no se inserta", async () => {
  let sb
  const { dep } = depTraer({ alLeer: () => sb.db.zomatik_np.push(filaMerva({ id: "np-sis", marca: N.marcaNp(PED, 1), zomatik_codigo: null })) })
  sb = baseFalsa(tablasTraer())
  const r = await traer(sb, dep)
  assert.deepEqual([r.ok, r.yaEstaba, r.np.id, sb.db.zomatik_np.length], [true, true, "np-sis", 1])
})

test("traerNp: una NP de Zomatik con la marca del sistema en las observaciones no se trae (ni se registra)", async () => {
  const sb = baseFalsa(tablasTraer())
  const pagina = fxT("np-abierta-1195.html").replace("Para facturar", N.marcaNp(OTRO_PED, 1))
  const r = await traer(sb, depTraer({ pagina }).dep)
  assert.deepEqual([r.ok, r.motivo, r.error], [false, "del_sistema", N.MSJ_TRAER.del_sistema])
  assert.equal(sb.db.zomatik_np.length, 0)
  assert.equal(sb.db.integraciones.filter((x) => x.clave === "zomatik_robot").length, 0)
})

test("traerNp: tiempos — con un login lento no se empieza otra lectura si quedan menos de 15 s (zomatik, turno suelto, nada registrado)", async () => {
  const sb = baseFalsa(tablasTraer())
  const { dep, cuenta } = depTraer({ demoraLogin: 40_000 })
  const r = await traer(sb, dep)
  assert.deepEqual([r.ok, r.motivo, r.error], [false, "zomatik", "Zomatik no responde ahora. Probá en unos minutos."])
  assert.equal(cuenta.requestsNp, 0)
  assert.equal(sb.db.zomatik_np.length, 0)
  assert.equal(sb.db.integraciones.filter((x) => x.clave === "zomatik_robot").length, 0)
  // Con 30 s de demora todavía alcanza
  const ok = await traer(baseFalsa(tablasTraer()), depTraer({ demoraLogin: 30_000 }).dep)
  assert.equal(ok.ok, true, ok.error)
  // Los topes
  assert.ok(T.PRESUPUESTO_TRAER_MS <= 50_000 && T.TIMEOUT_REQUEST_TRAER_MS <= 12_000 && T.MARGEN_REQUEST_MS >= T.TIMEOUT_REQUEST_TRAER_MS)
})

test("conLimite: si la lectura no termina a tiempo, corta como 'sin respuesta' (y lo que llegue después se descarta)", async () => {
  await assert.rejects(T.conLimite(new Promise(() => {}), 5), (e) => e.codigo === "sin_respuesta")
  assert.equal(await T.conLimite(Promise.resolve(7), 1000), 7)
  // Una lectura que falla después del corte no deja un rechazo sin manejar
  await assert.rejects(T.conLimite(new Promise((_, no) => setTimeout(() => no(new Error("tarde")), 20)), 5), (e) => e.codigo === "sin_respuesta")
  await new Promise((r) => setTimeout(r, 30))
})
