// Pruebas del lado del servidor de Z2 (lib/zomatik/np-servidor.ts) con una base SIMULADA en memoria y un navegador
// simulado: llave apagada (nunca se arma el navegador), carreras (dos robots, una NP que cambia mientras se genera),
// la elección del pedido validada, el tiempo y la lógica del trigger del despacho. Sin red, sin Zomatik, sin la base real.
import { test } from "node:test"
import assert from "node:assert/strict"
import * as S from "../zomatik/np-servidor.ts"
import * as N from "../zomatik/np.ts"
import * as R from "../zomatik/np-robot.ts"
import * as VS from "../zomatik/vincular-servidor.ts"
import * as W from "../zomatik/web.ts"
import { readFileSync } from "node:fs"

const CAN = "11111111-1111-4111-8111-111111111111"
const PED = "1a2b3c4d-0000-4000-8000-000000000001"

/** Base en memoria con lo justo del cliente de Supabase que usa np-servidor (select/update/insert/upsert + rpc). */
function baseFalsa(tablas, { antesDeUpdate, fallaAltaUso } = {}) {
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
  return {
    db,
    from: (t) => new Q(t),
    rpc: async (n, a) => {
      try {
        return { data: rpcs[n] ? rpcs[n](a) : null, error: null }
      } catch (e) {
        return { data: null, error: { message: e.message } }
      }
    },
  }
}

/** Cada NP de prueba con su uso por el pedido que la generó (como deja la migración 202610231000). */
const conUsos = (t) => ({ ...t, zomatik_np_uso: t.zomatik_np_uso?.length ? t.zomatik_np_uso : (t.zomatik_np || []).filter((n) => n.scheduled_dispatch_id).map((n, i) => ({ id: `uso-${i + 1}`, np_id: n.id, scheduled_dispatch_id: n.scheduled_dispatch_id, m3: n.m3, activo: true, motivo: null, created_at: n.created_at })) })
const tablas = (activo, extra = {}) => conUsos({
  plants: [{ id: CAN, name: "Canning" }],
  zomatik_np_config: activo === null ? [] : [{ plant_id: CAN, activo, desde: "2026-10-01T00:00:00.000Z", deposito: 116, exigir_np: "aviso", aviso_hasta: "2026-11-06" }],
  scheduled_dispatches: [{ id: PED, status: "scheduled", quantity_m3: 8, plant_id: CAN, client_id: "c1", construction_site_id: "o1", formula_id: "f1", scheduled_arrival_time: "2026-10-23T11:00:00.000Z", created_at: "2026-10-22T12:00:00.000Z", created_by: "Juan Oreguy" }],
  clients: [{ id: "c1", name: "OBRA PROPIA", zomatik_codigo: 15893 }, { id: "c2", name: "OTRO", zomatik_codigo: 999 }],
  formulas: [{ id: "f1", code: "H21", zomatik_articulo_codigo: 10090020, zomatik_articulo_nombre: "H21-620-10 C (CAN)" }],
  zomatik_articulos: [{ codigo: 10090020, nombre: "H21-620-10 C (CAN)", codigo_sistema: 1000015959 }],
  zomatik_proyectos: [{ codigo: 576, cliente_codigo: 15893, estado: "abierto" }, { codigo: 577, cliente_codigo: 999, estado: "abierto" }],
  zomatik_np: [], zomatik_np_uso: [], zomatik_np_pedido: [], zomatik_np_excepciones: [], zomatik_vendedores: [], app_users: [{ id: "u-juan", name: "Juan Oreguy" }],
  construction_sites: [{ id: "o1" }], activity_log: [], integraciones: [],
  ...extra,
})

const depFalsas = (nav) => {
  const llamadas = { navegador: 0, avisos: [] }
  return {
    llamadas,
    dep: {
      navegador: async () => { llamadas.navegador++; return nav },
      remitos: async () => false,
      avisar: async (_sb, t) => { llamadas.avisos.push(t); return { enviado: false } },
    },
  }
}

const npPendiente = (extra = {}) => ({
  id: "np-1", scheduled_dispatch_id: PED, n: 1, marca: N.marcaNp(PED, 1), tipo: "nueva", es_adicional: false, proyecto_codigo: null, plant_id: CAN, client_id: "c1", formula_id: "f1",
  fecha: "2026-10-23", m3: 8, estado: "pendiente", paso: null, mensaje: null, numero: null, zomatik_codigo: null, sucursal: null, disponible_m3: null, intentos: 0,
  proximo_intento: new Date(Date.now() - 1000).toISOString(), en_curso_desde: null, created_at: "2026-10-22T12:00:00.000Z", updated_at: "2026-10-22T12:00:00.000Z", ...extra,
})

test("llave apagada (o sin fila de config): sincronizar no crea NP y el robot nunca arma el navegador", async () => {
  for (const activo of [false, null]) {
    const sb = baseFalsa(tablas(activo, { zomatik_np: [npPendiente()] }))
    const s = await S.sincronizarPedido(PED, "Juan", { tipo: "nueva" }, sb)
    assert.equal(s.activo, false)
    const { dep, llamadas } = depFalsas({})
    const r = await S.procesarNp({ usuario: "test", inicio: Date.now(), sb, dep })
    assert.equal(llamadas.navegador, 0, "no se llamó a Zomatik")
    assert.equal(sb.db.zomatik_np[0].estado, "pendiente")
    assert.equal(r.hechas.length, 0) // con la llave apagada ni siquiera se toma el turno
    assert.equal((sb.db.integraciones || []).filter((x) => x.clave === "zomatik_robot").length, 0)
  }
})

test("sincronizar con la llave prendida: una NP pendiente con su marca; la segunda vez no se repite", async () => {
  const sb = baseFalsa(tablas(true))
  const a = await S.sincronizarPedido(PED, "Juan", { tipo: "nueva" }, sb)
  assert.equal(a.creadas, 1)
  const b = await S.sincronizarPedido(PED, "Juan", null, sb)
  assert.equal(b.creadas, 0)
  assert.equal(sb.db.zomatik_np.length, 1)
  assert.equal(sb.db.zomatik_np[0].marca, N.marcaNp(PED, 1))
  assert.ok(sb.db.activity_log.some((x) => x.entity === "zomatik_np"))
})

test("la elección se valida en el servidor: un proyecto de otro cliente no se guarda; uno del cliente, sí (en zomatik_np_pedido)", async () => {
  const sb = baseFalsa(tablas(true))
  const mal = await S.sincronizarPedido(PED, "Juan", { tipo: "proyecto", proyecto_codigo: 577 }, sb)
  assert.match(mal.error, /otro cliente/)
  assert.equal(sb.db.zomatik_np_pedido.length, 0)
  assert.equal(sb.db.zomatik_np.length, 0)
  const bien = await S.sincronizarPedido(PED, "Juan", { tipo: "proyecto", proyecto_codigo: 576 }, sb)
  assert.equal(bien.error, undefined)
  assert.deepEqual(sb.db.zomatik_np_pedido[0].tipo, "proyecto")
  assert.equal(sb.db.zomatik_np[0].tipo, "proyecto")
  assert.equal(sb.db.construction_sites[0].zomatik_proyecto_codigo, 576)
})

test("carrera: dos robots a la vez → el segundo queda 'ocupado' y no toca nada", async () => {
  const sb = baseFalsa(tablas(true, { zomatik_np: [npPendiente()] }))
  await sb.rpc("zomatik_robot_tomar", { p_quien: "otro", p_segundos: 60 })
  const { dep, llamadas } = depFalsas({})
  const r = await S.procesarNp({ usuario: "test", inicio: Date.now(), sb, dep })
  assert.equal(r.ocupado, true)
  assert.equal(llamadas.navegador, 0)
})

test("carrera: la NP se anula mientras el robot la genera → se corta antes de grabar y no se pisa", async () => {
  const sb = baseFalsa(tablas(true, { zomatik_np: [npPendiente()] }))
  const pedidos = []
  const nav = {
    sucursal: async () => { sb.db.zomatik_np[0].estado = "anulada"; return true }, // otro proceso la anula en el medio
    get: async (ruta) => { pedidos.push(ruta); return { status: 200, location: null, html: "<form name=\"frm_pedido\" action=\"grabar_pedidos.php?codigo=0\"></form>" } },
    post: async (ruta) => { pedidos.push(`POST ${ruta}`); return { status: 302, location: "listado_pedidos.php", html: "" } },
  }
  const { dep } = depFalsas(nav)
  const r = await S.procesarNp({ usuario: "test", inicio: Date.now(), sb, dep })
  assert.equal(sb.db.zomatik_np[0].estado, "anulada")
  assert.ok(!pedidos.some((p) => /^POST grabar_/.test(p)), "nunca se grabó")
  assert.equal(r.hechas[0].estado, "cambió")
})

test("tiempo: con menos de 30 s no se arranca ninguna NP; el turno se suelta", async () => {
  const sb = baseFalsa(tablas(true, { zomatik_np: [npPendiente()] }))
  const { dep, llamadas } = depFalsas({})
  const r = await S.procesarNp({ usuario: "test", inicio: Date.now() - 30_000, sb, dep })
  assert.equal(r.sinTiempo, true)
  assert.equal(llamadas.navegador, 0)
  assert.equal(sb.db.zomatik_np[0].estado, "pendiente")
  assert.equal(N.quedaTiempo(0, 24_000), true)
  assert.equal(N.quedaTiempo(0, 26_000), false)
})

test("revisar: si la NP ya no está para revisar (otro la resolvió), no se pisa", async () => {
  const sb = baseFalsa(tablas(true, { zomatik_np: [npPendiente({ estado: "ok", numero: "NP 0001-00001176" })] }))
  const r = await S.revisarNp("np-1", "otra", "Bautista", sb)
  assert.equal(r.ok, false)
  assert.equal(sb.db.zomatik_np[0].estado, "ok")
})

test("qué se trabaja: reintento llegado, colgadas de más de 3 min; sin fecha no; con el botón también las de error", () => {
  const ahora = Date.parse("2026-10-23T12:00:00Z")
  assert.equal(N.trabajoPendiente({ estado: "pendiente", proximo_intento: "2026-10-23T11:59:00Z" }, ahora, false), true)
  assert.equal(N.trabajoPendiente({ estado: "pendiente", proximo_intento: "2026-10-23T12:05:00Z" }, ahora, false), false)
  assert.equal(N.trabajoPendiente({ estado: "pendiente", proximo_intento: null }, ahora, false), false)
  assert.equal(N.trabajoPendiente({ estado: "error", proximo_intento: null }, ahora, false), false)
  assert.equal(N.trabajoPendiente({ estado: "error", proximo_intento: null }, ahora, true), true)
  assert.equal(N.trabajoPendiente({ estado: "generando", en_curso_desde: "2026-10-23T11:58:00Z" }, ahora, false), false)
  assert.equal(N.trabajoPendiente({ estado: "generando", en_curso_desde: "2026-10-23T11:56:00Z" }, ahora, false), true)
})

test("trigger del despacho (misma lógica que la migración): llave, manual, prueba, excepción, aviso y duro", () => {
  const base = { llave: true, manual: false, pedidoAntesDeLaLlave: false, tieneOk: false, prueba: false, excepcion: false, modo: "duro" }
  assert.equal(N.decisionTrigger({ ...base, llave: false }), "pasa")
  assert.equal(N.decisionTrigger({ ...base, manual: true }), "anota")
  assert.equal(N.decisionTrigger({ ...base, pedidoAntesDeLaLlave: true }), "pasa")
  assert.equal(N.decisionTrigger({ ...base, tieneOk: true }), "pasa")
  assert.equal(N.decisionTrigger({ ...base, prueba: true }), "anota")
  assert.equal(N.decisionTrigger({ ...base, excepcion: true }), "anota")
  assert.equal(N.decisionTrigger({ ...base, modo: "aviso" }), "anota")
  assert.equal(N.decisionTrigger(base), "frena")
})

test("carrera al rehacer: la sincronización lee 'pendiente', el robot la toma, la sincronización anula → no crea otra", async () => {
  // El pedido pasó de 8 a 12 m³: la NP pendiente se rehace (anular + crear). Justo antes de anular, el robot la toma.
  const t = tablas(true, { zomatik_np: [npPendiente()] })
  t.scheduled_dispatches[0].quantity_m3 = 12
  const sb = baseFalsa(t, {
    antesDeUpdate: (tabla, vals, db) => {
      if (tabla === "zomatik_np" && vals.estado === "anulada") Object.assign(db.zomatik_np[0], { estado: "generando", en_curso_desde: new Date().toISOString() })
    },
  })
  const r = await S.sincronizarPedido(PED, "Juan", null, sb)
  assert.equal(r.creadas, 0, "no se crea la nueva")
  assert.equal(r.anuladas, 0)
  assert.equal(sb.db.zomatik_np.length, 1)
  assert.equal(sb.db.zomatik_np[0].estado, "generando")
  assert.match(r.avisos.join(" "), /próxima pasada/)
})

test("NP trabada: colgada en 'generando' por cuarta vez → 'revisar' con aviso, sin tocar Zomatik", async () => {
  const sb = baseFalsa(tablas(true, { zomatik_np: [npPendiente({ estado: "generando", en_curso_desde: new Date(Date.now() - 5 * 60_000).toISOString(), intentos: 3, paso: "grabar" })] }))
  const { dep, llamadas } = depFalsas({})
  const r = await S.procesarNp({ usuario: "test", inicio: Date.now(), sb, dep })
  assert.equal(sb.db.zomatik_np[0].estado, "revisar")
  assert.equal(r.hechas[0].estado, "revisar")
  assert.equal(llamadas.navegador, 0)
  assert.deepEqual(llamadas.avisos, ["NP trabada: para revisar"])
})

// ── Sección 25: cancelar no vacía, NP con saldo pendiente, reprogramar y devolver ──
const PED2 = "2b2b2b2b-0000-4000-8000-000000000002"
const npOk = (extra = {}) => npPendiente({ estado: "ok", numero: "NP 0001-00001176", zomatik_codigo: 157704, m3: 8, proximo_intento: null, ...extra })

test("cancelar el pedido: la NP NO se vacía; queda 'NP con saldo: pendiente' en Programación desde ese momento", async () => {
  const t = tablas(true, { zomatik_np: [npOk()] })
  t.scheduled_dispatches[0].status = "cancelled"
  const sb = baseFalsa(t)
  const r = await S.sincronizarPedido(PED, "Juan", null, sb)
  assert.equal(sb.db.zomatik_np[0].estado, "ok", "no se vacía")
  assert.ok(sb.db.zomatik_np[0].saldo_desde, "pendiente desde ahora")
  assert.match(r.avisos.join(" "), /queda pendiente en Programación/)
  const lista = await S.npsConSaldo({ sb })
  assert.equal(lista.length, 1)
  assert.equal(lista[0].libre, 8)
  assert.ok(lista[0].pendiente_desde)
})

test("reprogramar: el pedido nuevo usa la NP con saldo (no genera otra) y la NP deja de estar pendiente", async () => {
  const t = tablas(true, { zomatik_np: [npOk({ saldo_desde: "2026-10-20T10:00:00.000Z" })] })
  t.scheduled_dispatches[0].status = "cancelled"
  t.scheduled_dispatches.push({ ...t.scheduled_dispatches[0], id: PED2, status: "scheduled", quantity_m3: 6, scheduled_arrival_time: "2026-10-28T11:00:00.000Z", created_at: "2026-10-24T09:00:00.000Z" })
  const sb = baseFalsa(t)
  const r = await S.sincronizarPedido(PED2, "Juan", { tipo: "saldo", np_id: "np-1" }, sb)
  assert.equal(r.error, undefined)
  assert.equal(r.usadas, 1)
  assert.equal(r.creadas, 0)
  assert.equal(sb.db.zomatik_np.length, 1)
  assert.equal(sb.db.zomatik_np_uso.filter((u) => u.scheduled_dispatch_id === PED2 && u.activo)[0].m3, 6)
  assert.equal(sb.db.zomatik_np[0].saldo_desde, null)
  // otro cliente no puede usarla
  const t2 = tablas(true, { zomatik_np: [npOk({ client_id: "c2" })] })
  t2.scheduled_dispatches[0].status = "cancelled"
  t2.scheduled_dispatches.push({ ...t2.scheduled_dispatches[0], id: PED2, status: "scheduled" })
  const r2 = await S.sincronizarPedido(PED2, "Juan", { tipo: "saldo", np_id: "np-1" }, baseFalsa(t2))
  assert.match(r2.error, /otro cliente/)
})

test("devolver el saldo: sin despachos se vacía (robot); con despachos queda la devolución (DEVOL) a mano", async () => {
  const t = tablas(true, { zomatik_np: [npOk()] })
  t.scheduled_dispatches[0].status = "cancelled"
  const sb = baseFalsa(t)
  const a = await S.decidirSaldo("np-1", "devolver", "Juan", sb)
  assert.equal(a.ok, true)
  assert.equal(sb.db.zomatik_np[0].estado, "vaciar")
  const t2 = tablas(true, { zomatik_np: [npOk()] })
  Object.assign(t2.scheduled_dispatches[0], { status: "completed", dispatched_m3: 5 })
  const sb2 = baseFalsa(t2)
  const b = await S.decidirSaldo("np-1", "devolver", "Juan", sb2)
  assert.equal(sb2.db.zomatik_np[0].estado, "ok")
  assert.equal(sb2.db.zomatik_np[0].saldo_decision, "devolver")
  assert.match(b.mensaje, /DEVOL.*3 m³/)
  await S.decidirSaldo("np-1", "cerrada", "Juan", sb2)
  assert.equal((await S.npsConSaldo({ sb: sb2 })).length, 0)
  // con un pedido activo usándola, no se devuelve
  const sb3 = baseFalsa(tablas(true, { zomatik_np: [npOk()] }))
  assert.equal((await S.decidirSaldo("np-1", "devolver", "Juan", sb3)).ok, false)
})


test("decisión 16: con un ajuste a lo despachado en marcha la NP no va a 'NP con saldo' y no se devuelve ni se reserva", async () => {
  const MSJ = "La NP se está ajustando a lo despachado: esperá unos minutos."
  const conAjuste = (estado, extra = {}) => {
    const t = tablas(true, { zomatik_np: [npOk(extra.np || {})], zomatik_np_ajustes: [{ id: "aj-1", np_id: "np-1", scheduled_dispatch_id: PED, estado, paso: extra.paso ?? null }] })
    t.scheduled_dispatches[0].status = "completed"
    t.scheduled_dispatches.push({ ...t.scheduled_dispatches[0], id: PED2, status: "scheduled", quantity_m3: 2, scheduled_arrival_time: "2026-10-28T11:00:00.000Z", created_at: "2026-10-24T09:00:00.000Z" })
    return baseFalsa(t)
  }
  for (const estado of ["pendiente", "generando", "revisar"]) {
    const sb = conAjuste(estado)
    assert.equal((await S.npsConSaldo({ sb })).length, 0, estado)
    assert.deepEqual(await S.decidirSaldo("np-1", "devolver", "Juan", sb), { ok: false, error: MSJ })
    assert.equal(sb.db.zomatik_np[0].saldo_decision ?? null, null)
    const r = await S.sincronizarPedido(PED2, "Juan", { tipo: "saldo", np_id: "np-1" }, sb)
    assert.equal(r.error, MSJ)
    assert.equal(sb.db.zomatik_np_uso.filter((u) => u.scheduled_dispatch_id === PED2).length, 0)
  }
  // terminado (ok / nada / a_mano), o la NP que quedó sin uso (15.5, la decide una persona desde "NP con saldo"): como siempre
  for (const [estado, paso] of [["ok", "ok"], ["a_mano", "a_mano"], ["revisar", "np_sin_uso"]]) {
    const sb = conAjuste(estado, { paso })
    assert.equal((await S.npsConSaldo({ sb })).length, 1, `${estado}/${paso}`)
  }
  // ya "para devolver": sigue en la lista (falta «Ya la devolví»)
  assert.equal((await S.npsConSaldo({ sb: conAjuste("revisar", { np: { saldo_decision: "devolver" } }) })).length, 1)
})

// ── Revisión de 5548ecc ──
const PED3 = "3c3c3c3c-0000-4000-8000-000000000003"

test("B2: pedido de 10 con NP1 sin despachos, cambia la fórmula (NP2), se despachan 10 y se finaliza → NP1 10 libres, NP2 0", async () => {
  const t = tablas(true, { zomatik_np: [npOk({ m3: 10 })] })
  t.scheduled_dispatches[0].quantity_m3 = 10
  t.formulas.push({ id: "f2", code: "H30", zomatik_articulo_codigo: 10090027, zomatik_articulo_nombre: "H30-620-10 C (CAN)" })
  const sb = baseFalsa(t)
  t.scheduled_dispatches[0].formula_id = "f2"
  sb.db.scheduled_dispatches[0].formula_id = "f2"
  const r = await S.sincronizarPedido(PED, "Juan", null, sb)
  assert.equal(r.desvinculadas, 1)
  assert.equal(r.creadas, 1)
  const np2 = sb.db.zomatik_np.find((x) => x.id !== "np-1")
  Object.assign(np2, { estado: "ok", numero: "NP 0001-00001177" }) // el robot la generó
  Object.assign(sb.db.scheduled_dispatches[0], { dispatched_m3: 10, status: "completed" })
  const s = await S.saldosDe(sb, sb.db.zomatik_np)
  assert.equal(s.get("np-1").libre, 10)
  assert.equal(s.get(np2.id).libre, 0)
  assert.equal(sb.db.zomatik_np_uso.find((u) => u.np_id === "np-1").despachado_fijo, 0, "foto al desvincular")
})

test("B1: dos reprogramaciones de la misma NP con saldo → la segunda solo toma lo que queda y el resto va en NP nueva", async () => {
  const t = tablas(true, { zomatik_np: [npOk({ m3: 10 })] })
  t.scheduled_dispatches[0].status = "cancelled"
  for (const id of [PED2, PED3]) t.scheduled_dispatches.push({ ...t.scheduled_dispatches[0], id, status: "scheduled", quantity_m3: 8, created_at: "2026-10-24T09:00:00.000Z" })
  const sb = baseFalsa(t)
  const a = await S.sincronizarPedido(PED2, "Juan", { tipo: "saldo", np_id: "np-1" }, sb)
  const b = await S.sincronizarPedido(PED3, "Felipe", { tipo: "saldo", np_id: "np-1" }, sb)
  assert.equal(a.usadas, 1)
  assert.equal(b.usadas, 1)
  const usos = sb.db.zomatik_np_uso.filter((u) => u.np_id === "np-1" && u.activo && [PED2, PED3].includes(u.scheduled_dispatch_id))
  assert.deepEqual(usos.map((u) => u.m3), [8, 2], "nunca más que el saldo")
  assert.equal(b.creadas, 1)
  assert.equal(sb.db.zomatik_np.find((x) => x.scheduled_dispatch_id === PED3).m3, 6)
})

test("B1: reprogramar y devolver a la vez → si se reservó primero, devolver no deja; si se devolvió primero, reprogramar no toma nada", async () => {
  const base = () => {
    const t = tablas(true, { zomatik_np: [npOk({ m3: 10 })] })
    t.scheduled_dispatches[0].status = "cancelled"
    t.scheduled_dispatches.push({ ...t.scheduled_dispatches[0], id: PED2, status: "scheduled", quantity_m3: 8 })
    return baseFalsa(t)
  }
  const sb = base()
  await S.sincronizarPedido(PED2, "Juan", { tipo: "saldo", np_id: "np-1" }, sb)
  const d = await S.decidirSaldo("np-1", "devolver", "Fernando", sb)
  assert.equal(d.ok, false)
  assert.match(d.error, /pedido activo/)
  const sb2 = base()
  assert.equal((await S.decidirSaldo("np-1", "devolver", "Fernando", sb2)).ok, true)
  const r = await S.sincronizarPedido(PED2, "Juan", { tipo: "saldo", np_id: "np-1" }, sb2)
  assert.ok(r.error || r.usadas === 0, "no usa una NP que se está devolviendo")
  assert.equal(sb2.db.zomatik_np_uso.filter((u) => u.scheduled_dispatch_id === PED2).length, 0)
})

test("I1: la pasada no mira pedidos cancelados ni NP cerradas, y un aviso no se graba dos veces", async () => {
  const t = tablas(true, { zomatik_np: [npOk()] })
  t.scheduled_dispatches[0].status = "cancelled"
  const sb = baseFalsa(t)
  await S.sincronizarPedido(PED, "Juan", null, sb)
  await S.sincronizarPedido(PED, "Juan", null, sb)
  assert.equal(sb.db.activity_log.filter((x) => x.details?.Aviso).length, 1)
  const p = await S.pasadaNp("sistema", { inicio: Date.now(), sb })
  assert.equal(p.pedidos, 0)
})

test("I2: con todas las llaves apagadas el job no toma el turno (no tapa la lectura diaria)", async () => {
  const sb = baseFalsa(tablas(false, { zomatik_np: [npPendiente()] }))
  const { dep, llamadas } = depFalsas({})
  await S.procesarNp({ usuario: "cron", inicio: Date.now(), sb, dep })
  assert.equal((sb.db.integraciones || []).filter((x) => x.clave === "zomatik_robot").length, 0)
  assert.equal(llamadas.navegador, 0)
})

test("'Ya la devolví' solo si la NP espera la devolución; queda con el motivo", async () => {
  const t = tablas(true, { zomatik_np: [npOk()] })
  Object.assign(t.scheduled_dispatches[0], { status: "completed", dispatched_m3: 5 })
  const sb = baseFalsa(t)
  assert.equal((await S.decidirSaldo("np-1", "cerrada", "Bautista", sb, "DP 0001-00000003")).ok, false, "todavía no se pidió devolver")
  await S.decidirSaldo("np-1", "devolver", "Juan", sb)
  const r = await S.decidirSaldo("np-1", "cerrada", "Bautista", sb, "DP 0001-00000003")
  assert.equal(r.ok, true)
  assert.match(sb.db.zomatik_np[0].saldo_mensaje, /DP 0001-00000003/)
})

test("vendedor: la NP nueva guarda el usuario de la sesión que guarda el pedido (no created_by)", async () => {
  const sb = baseFalsa(tablas(true))
  await S.sincronizarPedido(PED, "Felipe Calvo", { tipo: "nueva" }, sb, { usuarioId: "u-felipe" })
  assert.equal(sb.db.zomatik_np[0].vendedor_usuario_id, "u-felipe")
})

test("I-1: falla el alta del uso → no queda la NP (va junta, en una función); y una NP propia sin uso no genera una NP2", async () => {
  // a) el alta es una sola transacción: si el uso falla, no queda ninguna NP
  const sb = baseFalsa(tablas(true), { fallaAltaUso: true })
  await assert.rejects(() => S.sincronizarPedido(PED, "Juan", { tipo: "nueva" }, sb))
  assert.equal(sb.db.zomatik_np.length, 0)
  // b) resguardo: una NP propia viva sin uso (un alta a medias de antes) cuenta como usada: no aparece NP2
  const t = tablas(true, { zomatik_np: [npPendiente({ m3: 8 })] })
  t.zomatik_np_uso = []
  const sb2 = baseFalsa(t)
  const r = await S.sincronizarPedido(PED, "Juan", null, sb2)
  assert.equal(r.creadas, 0)
  assert.equal(sb2.db.zomatik_np.length, 1, "no hay NP2")
  assert.equal(sb2.db.zomatik_np_uso.filter((u) => u.np_id === "np-1" && u.activo).length, 1, "se repuso el uso")
})

// ── Aviso de errores a Bautista (04/11): un mail por episodio ──
test("NP en 'error': un aviso a Bautista; otro error seguido (botón) no repite; un error después de salir de 'error', sí", async () => {
  // El cliente no está vinculado con Zomatik: el robot frena antes de tocar nada y la NP queda en "error"
  const t = tablas(true, { zomatik_np: [npPendiente({ client_id: "c3" })] })
  t.clients.push({ id: "c3", name: "SIN VINCULAR", zomatik_codigo: null })
  const sb = baseFalsa(t)
  const { dep, llamadas } = depFalsas({})
  const errores = []
  dep.avisarError = async (_sb, titulo, lineas) => { errores.push({ titulo, lineas }); return { enviado: true } }
  // 1) pendiente → error: un aviso, con el pedido, el mensaje, el paso y si se reintenta
  await S.procesarNp({ usuario: "test", inicio: Date.now(), sb, dep })
  assert.equal(sb.db.zomatik_np[0].estado, "error")
  assert.equal(errores.length, 1)
  assert.match(errores[0].titulo, /Zomatik no generó la NP · Pedido 1a2b3c4d/)
  const texto = errores[0].lineas.join("\n")
  assert.match(texto, /Pedido 1a2b3c4d · SIN VINCULAR · 8 m³ · 2026-10-23 · Canning/)
  assert.match(texto, /Mensaje: El cliente no está vinculado con Zomatik/)
  assert.match(texto, /Paso: inicio/)
  // Falta de vínculo (04/11): se vincula desde el pedido y la NP se reintenta
  assert.ok(texto.includes("Vinculalo desde el pedido (⋯ › Vincular con Zomatik) y la NP se reintenta sola; si lo vincula un gerencial en Vínculos, tocá Generar NP ahora."))
  assert.doesNotMatch(texto, /No se reintenta sola/)
  // 2) "Generar NP ahora" y vuelve a fallar: ya estaba en "error", no se repite el mail
  await S.procesarNp({ usuario: "test", inicio: Date.now(), pedidoId: PED, sb, dep })
  assert.equal(sb.db.zomatik_np[0].estado, "error")
  assert.equal(sb.db.zomatik_np[0].intentos, 2, "se reintentó")
  assert.equal(errores.length, 1)
  // 3) salió de "error" (por ejemplo, un reintento cortado la dejó pendiente) y vuelve a fallar: otro episodio, un aviso
  Object.assign(sb.db.zomatik_np[0], { estado: "pendiente", proximo_intento: new Date(Date.now() - 1000).toISOString() })
  await S.procesarNp({ usuario: "test", inicio: Date.now(), sb, dep })
  assert.equal(errores.length, 2)
  // los gerenciales no reciben nada por un "error" (solo por "revisar")
  assert.deepEqual(llamadas.avisos, [])
})

test("avisarErrorZomatik: solo a Bautista (por nombre en app_users) y nunca corta la operación", async (t) => {
  const sb = baseFalsa(tablas(true, { app_users: [
    { id: "u1", name: "Bautista Caputo", email: "bautista@x.com", active: true },
    { id: "u2", name: "Juan Oreguy", email: "juan@x.com", active: true },
    { id: "u3", name: "Fernando Maldonado", email: "fer@x.com", active: true },
  ] }))
  const antes = process.env.RESEND_API_KEY
  process.env.RESEND_API_KEY = "re_prueba"
  const mandados = []
  t.mock.method(globalThis, "fetch", async (_url, o) => { mandados.push(JSON.parse(o.body)); return { ok: true, status: 200 } })
  try {
    const r = await S.avisarErrorZomatik(sb, "Zomatik no generó la NP", ["Mensaje: <x>"])
    assert.equal(r.enviado, true)
    assert.deepEqual(mandados[0].to, ["bautista@x.com"])
    assert.match(mandados[0].from, /^Rebucret - Zomatik </)
    assert.equal(mandados[0].subject, "Rebucret · Zomatik no generó la NP")
    assert.match(mandados[0].html, /Mensaje: &lt;x&gt;/)
    // si Resend se cae, no tira: devuelve el motivo
    globalThis.fetch.mock.mockImplementation(async () => { throw new Error("sin red") })
    assert.deepEqual(await S.avisarErrorZomatik(sb, "x", []), { enviado: false, motivo: "sin red" })
    // sin Bautista con mail, tampoco
    const sb2 = baseFalsa(tablas(true, { app_users: [{ id: "u2", name: "Juan Oreguy", email: "juan@x.com", active: true }] }))
    assert.equal((await S.avisarErrorZomatik(sb2, "x", [])).enviado, false)
  } finally {
    if (antes === undefined) delete process.env.RESEND_API_KEY
    else process.env.RESEND_API_KEY = antes
  }
})

// ── Revisión del 04/11: caídas del robot, entrada a Zomatik y pendientes largos ──
const avisosA = (dep) => {
  const errores = []
  dep.avisarError = async (_sb, titulo, lineas) => { errores.push({ titulo, lineas }); return { enviado: true } }
  return errores
}
const vencerNp = (sb) => Object.assign(sb.db.zomatik_np[0], { proximo_intento: new Date(Date.now() - 1000).toISOString() })

test("caída del robot (vuelve a 'pendiente'): el mail dice el error interno real; mismo tipo y paso con otro texto no repite; otro tipo, sí", async (t) => {
  t.mock.method(console, "error", () => {})
  // recién creada (si no, al segundo intento también llega el de "más de 1 hora")
  const sb = baseFalsa(tablas(true, { zomatik_np: [npPendiente({ created_at: new Date().toISOString() })] }))
  const { dep, llamadas } = depFalsas({})
  const errores = avisosA(dep)
  let n = 0
  dep.navegador = async () => { n++; throw new TypeError(`x.y is not a function (${n})`) }
  // 1) se cae: queda pendiente y llega un aviso con el error interno (no "Error leyendo Zomatik")
  await S.procesarNp({ usuario: "cron", inicio: Date.now(), sb, dep })
  assert.equal(sb.db.zomatik_np[0].estado, "pendiente")
  assert.equal(sb.db.zomatik_np[0].mensaje, "Error interno: x.y is not a function (1)")
  assert.equal(errores.length, 1)
  assert.equal(errores[0].titulo, "El robot de Zomatik se cayó generando la NP · Pedido 1a2b3c4d")
  const texto = errores[0].lineas.join("\n")
  assert.match(texto, /Mensaje: Error interno: x\.y is not a function \(1\)/)
  assert.doesNotMatch(texto, /Error leyendo Zomatik/)
  assert.match(texto, /próxima pasada/)
  assert.equal(sb.db.activity_log.filter((x) => x.details?.Firma === "interno|inicio").length, 1)
  // 2) la pasada la vuelve a tomar y cae igual (mismo tipo y paso, otro texto): no se repite
  vencerNp(sb)
  await S.procesarNp({ usuario: "cron", inicio: Date.now(), sb, dep })
  assert.equal(sb.db.zomatik_np[0].intentos, 2, "se reintentó")
  assert.equal(errores.length, 1)
  // 3) otro tipo de falla: otro episodio, un aviso
  vencerNp(sb)
  dep.navegador = async () => { throw Object.assign(new Error("Zomatik cambió el buscador"), { codigo: "formato" }) }
  await S.procesarNp({ usuario: "cron", inicio: Date.now(), sb, dep })
  assert.equal(errores.length, 2)
  assert.deepEqual(llamadas.avisos, [], "a los gerenciales no")
})

test("no se puede entrar a Zomatik: varias pasadas con textos distintos → un solo mail para todo el robot, y uno de 'volvió' al entrar", async (t) => {
  t.mock.method(console, "error", () => {})
  // login() dejó el bloqueo de una entrada que falló de verdad (el login_bloqueado cuenta como falla de entrada)
  const t0 = tablas(true, { zomatik_np: [npPendiente({ client_id: "c3" })], integraciones: [{ clave: "zomatik_login_bloqueado", valor: new Date(Date.now() + 20 * 60_000).toISOString() }] })
  t0.clients.push({ id: "c3", name: "SIN VINCULAR", zomatik_codigo: null })
  const sb = baseFalsa(t0)
  const { dep } = depFalsas({})
  const errores = avisosA(dep)
  const fallas = [
    { codigo: "login_bloqueado", message: "Hace poco falló la entrada a Zomatik. No se reintenta hasta las 10:40" },
    { codigo: "login_bloqueado", message: "Hace poco falló la entrada a Zomatik. No se reintenta hasta las 10:50" },
    { codigo: "sin_respuesta", message: "No se pudo conectar con Zomatik" },
    { codigo: "login_rechazado", message: "Zomatik rechazó el usuario" },
  ]
  for (const f of fallas) {
    dep.navegador = async () => { throw Object.assign(new Error(f.message), { codigo: f.codigo }) }
    vencerNp(sb)
    await S.procesarNp({ usuario: "cron", inicio: Date.now(), sb, dep })
    assert.equal(sb.db.zomatik_np[0].estado, "pendiente")
  }
  assert.deepEqual(errores.map((x) => x.titulo), ["Zomatik: el robot no puede entrar"], "un solo mail, sin el de 'más de 1 hora' por fila")
  assert.ok(sb.db.integraciones.some((x) => x.clave === S.CLAVE_AVISO_ENTRADA))
  // vuelve a entrar: mail corto de "volvió" y se borra la marca (la NP sigue con su error de datos, aparte)
  dep.navegador = async () => ({})
  vencerNp(sb)
  await S.procesarNp({ usuario: "cron", inicio: Date.now(), sb, dep })
  assert.equal(errores[1].titulo, "Zomatik volvió a andar")
  assert.ok(!sb.db.integraciones.some((x) => x.clave === S.CLAVE_AVISO_ENTRADA))
  assert.equal(errores.filter((x) => x.titulo === "Zomatik volvió a andar").length, 1)
})

test("NP pendiente por red más de 1 hora: un aviso a Bautista, una sola vez; una NP recién creada, no", async (t) => {
  t.mock.method(console, "error", () => {})
  // El robot entra, pero Zomatik no responde en el medio: el robot devuelve "pendiente" (reintento)
  const nav = { sucursal: async () => { throw Object.assign(new Error("Zomatik no respondió a tiempo"), { codigo: "sin_respuesta" }) }, get: async () => ({}), post: async () => ({}) }
  const sb = baseFalsa(tablas(true, { zomatik_np: [npPendiente()] })) // creada hace días
  const { dep } = depFalsas(nav)
  const errores = avisosA(dep)
  for (let i = 0; i < 4; i++) {
    vencerNp(sb)
    await S.procesarNp({ usuario: "cron", inicio: Date.now(), sb, dep })
    assert.equal(sb.db.zomatik_np[0].estado, "pendiente")
  }
  assert.deepEqual(errores.map((x) => x.titulo), ["NP pendiente hace más de 1 hora · Pedido 1a2b3c4d"])
  assert.match(errores[0].lineas.join("\n"), /Último mensaje: Zomatik no respondió a tiempo/)
  // recién creada: aunque reintente, no avisa
  const sb2 = baseFalsa(tablas(true, { zomatik_np: [npPendiente({ created_at: new Date().toISOString() })] }))
  const d2 = depFalsas(nav)
  const e2 = avisosA(d2.dep)
  for (let i = 0; i < 3; i++) {
    vencerNp(sb2)
    await S.procesarNp({ usuario: "cron", inicio: Date.now(), sb: sb2, dep: d2.dep })
  }
  assert.deepEqual(e2, [])
})

// ── Revisión final del 04/11 ──
test("si el mail de la caída o del pendiente largo no sale, queda 'Avisado: no' y se vuelve a probar en el próximo intento", async (t) => {
  t.mock.method(console, "error", () => {})
  // caída: Resend falla la primera vez → la segunda (misma caída) se vuelve a mandar; la tercera ya no
  const sb = baseFalsa(tablas(true, { zomatik_np: [npPendiente({ created_at: new Date().toISOString() })] }))
  const { dep } = depFalsas({})
  const mandados = []
  let sale = false
  dep.avisarError = async (_sb, titulo) => { mandados.push({ titulo, sale }); return sale ? { enviado: true } : { enviado: false, motivo: "Resend respondió 500" } }
  dep.navegador = async () => { throw new TypeError("x.y is not a function") }
  await S.procesarNp({ usuario: "cron", inicio: Date.now(), sb, dep })
  assert.equal(sb.db.activity_log.filter((x) => x.details?.Firma).at(-1).details.Avisado, "no")
  sale = true
  vencerNp(sb)
  await S.procesarNp({ usuario: "cron", inicio: Date.now(), sb, dep })
  vencerNp(sb)
  await S.procesarNp({ usuario: "cron", inicio: Date.now(), sb, dep })
  assert.deepEqual(mandados.map((x) => x.sale), [false, true], "se reintentó una vez y después no se repitió")
  assert.equal(sb.db.activity_log.filter((x) => x.details?.Firma).at(-1).details.Avisado, "sí")
  // pendiente largo: lo mismo (una vez por fila, contando solo el que salió)
  const filas = { usuario: "cron", pedidoId: PED, plantId: CAN, ref: "Pedido 1a2b3c4d", marca: "M-1", titulo: "NP pendiente", lineas: [], creada: "2026-10-01T00:00:00Z", intentos: 5 }
  const sb2 = baseFalsa(tablas(true))
  sale = false
  mandados.length = 0
  assert.equal(await S.avisarPendienteLargo(sb2, dep.avisarError, filas), false)
  sale = true
  assert.equal(await S.avisarPendienteLargo(sb2, dep.avisarError, filas), true)
  assert.equal(await S.avisarPendienteLargo(sb2, dep.avisarError, filas), false)
  assert.equal(mandados.length, 2)
})

test("la marca de una fila se busca por Marca: muchas entradas del mismo pedido no la dejan afuera (un solo aviso por fila)", async () => {
  const otras = Array.from({ length: 150 }, (_, i) => ({ id: `a${i}`, entity: "zomatik_np", reference: "Pedido 1a2b3c4d", details: { "Qué pasó": "otra cosa", Marca: "M-2" }, created_at: new Date(Date.now() - 1000 + i).toISOString() }))
  const sb = baseFalsa(tablas(true, { activity_log: [
    { id: "viejo", entity: "zomatik_np", reference: "Pedido 1a2b3c4d", details: { "Qué pasó": S.QUE_PENDIENTE_LARGO, Marca: "M-1", Avisado: "sí" }, created_at: "2026-10-01T00:00:00Z" },
    ...otras,
  ] }))
  let n = 0
  const r = await S.avisarPendienteLargo(sb, async () => { n++; return { enviado: true } }, { usuario: "cron", pedidoId: PED, ref: "Pedido 1a2b3c4d", marca: "M-1", titulo: "x", lineas: [], creada: "2026-10-01T00:00:00Z", intentos: 9 })
  assert.equal(r, false)
  assert.equal(n, 0)
})

test("entrada a Zomatik: un error al grabar la clave que no es 'repetida' manda el mail igual; la repetida (23505), no", async () => {
  const llamadas = []
  const avisar = async (_sb, titulo) => { llamadas.push(titulo); return { enviado: true } }
  // la clave ya la grabó otro proceso en el medio: el insert choca (23505) → ya avisado
  const sb = baseFalsa(tablas(true))
  const orig = sb.from
  let primera = true
  sb.from = (t) => {
    const q = orig(t)
    if (t === "integraciones" && primera) { primera = false; const sel = q.select.bind(q); q.select = (...a) => { const r = sel(...a); r.maybeSingle = () => Promise.resolve({ data: null, error: null }); return r } }
    return q
  }
  sb.db.integraciones = [{ clave: S.CLAVE_AVISO_ENTRADA, valor: new Date().toISOString(), actualizado: new Date().toISOString() }]
  assert.equal(await S.avisarFallaAcceso(sb, avisar, { que: "x", mensaje: "No se pudo conectar", codigo: "sin_respuesta" }), "ya")
  assert.deepEqual(llamadas, [])
  // otro error de la base al grabar: el mail sale igual
  const sb2 = baseFalsa(tablas(true))
  const orig2 = sb2.from
  sb2.from = (t) => {
    const q = orig2(t)
    if (t === "integraciones") q.insert = () => ({ then: (ok) => Promise.resolve({ data: null, error: { code: "42501", message: "permission denied" } }).then(ok) })
    return q
  }
  assert.equal(await S.avisarFallaAcceso(sb2, avisar, { que: "x", mensaje: "No se pudo conectar", codigo: "sin_respuesta" }), "enviado")
  assert.deepEqual(llamadas, ["Zomatik: el robot no puede entrar"])
})

test("entrada a Zomatik: con la clave de más de 24 h, un recordatorio y se renueva; antes de las 24 h, nada", async () => {
  const llamadas = []
  const avisar = async (_sb, titulo) => { llamadas.push(titulo); return { enviado: true } }
  const desde = new Date(Date.now() - 30 * 3600_000).toISOString()
  const sb = baseFalsa(tablas(true, { integraciones: [{ clave: S.CLAVE_AVISO_ENTRADA, valor: desde, actualizado: desde }] }))
  assert.equal(await S.avisarFallaAcceso(sb, avisar, { que: "generar la NP", mensaje: "Zomatik rechazó el usuario", codigo: "login_rechazado" }), "enviado")
  assert.equal(llamadas.length, 1)
  assert.match(llamadas[0], /^Zomatik sigue sin dejar entrar \(desde /)
  const fila = sb.db.integraciones.find((x) => x.clave === S.CLAVE_AVISO_ENTRADA)
  assert.equal(fila.valor, desde, "el 'desde' no cambia")
  assert.ok(Date.now() - Date.parse(fila.actualizado) < 60_000, "se renovó")
  // la próxima falla (antes de otras 24 h): nada
  assert.equal(await S.avisarFallaAcceso(sb, avisar, { que: "x", mensaje: "y", codigo: "sin_respuesta" }), "ya")
  assert.equal(llamadas.length, 1)
})

test("login_bloqueado solo por la espera de 10 min entre entradas (sin bloqueo de login ni clave): no es falla de entrada", async () => {
  const llamadas = []
  const avisar = async (_sb, titulo) => { llamadas.push(titulo); return { enviado: true } }
  const sb = baseFalsa(tablas(true))
  assert.equal(await S.avisarFallaAcceso(sb, avisar, { que: "x", mensaje: "Ya se intentó entrar a Zomatik hace menos de 10 min", codigo: "login_bloqueado" }), "no")
  assert.deepEqual(llamadas, [])
  assert.ok(!(sb.db.integraciones || []).some((x) => x.clave === S.CLAVE_AVISO_ENTRADA))
  // con el bloqueo de una entrada que falló de verdad, sí
  sb.db.integraciones = [{ clave: "zomatik_login_bloqueado", valor: new Date(Date.now() + 20 * 60_000).toISOString() }]
  assert.equal(await S.avisarFallaAcceso(sb, avisar, { que: "x", mensaje: "Hace poco falló la entrada", codigo: "login_bloqueado" }), "enviado")
})

// ── Vincular con Zomatik desde el pedido (04/11/2026, docs/specs/2026-11-04-vincular-al-programar.md) ──
const CLI_LIBRE = "c4c4c4c4-0000-4000-8000-000000000004"
const CLI_SINPAR = "c5c5c5c5-0000-4000-8000-000000000005"
const CLI_OTRO = "c6c6c6c6-0000-4000-8000-000000000006"
const FORM_LIBRE = "f2f2f2f2-0000-4000-8000-000000000002"
const PED_V = "5e5e5e5e-0000-4000-8000-000000000005"

const tablasVincular = (extra = {}) => {
  const t = tablas(true, extra)
  t.clients.push(
    { id: CLI_LIBRE, name: "LA TERCERA", cuit: null, zomatik_codigo: null, zomatik_vinculo: null },
    { id: CLI_SINPAR, name: "MARCADO SIN PAR", cuit: null, zomatik_codigo: null, zomatik_vinculo: "sin_par", zomatik_vinculado_por: "Bautista Caputo" },
    { id: CLI_OTRO, name: "Fideicomiso La Tercera", zomatik_codigo: 22812, zomatik_vinculo: "manual", zomatik_vinculado_por: "Bautista Caputo" },
  )
  t.formulas.push({ id: FORM_LIBRE, name: "H21-620-10 (CAN)", code: "H21-620-10 (CAN)", plant_id: CAN, zomatik_articulo_codigo: null, zomatik_articulo_nombre: null, zomatik_vinculo: null })
  t.zomatik_clientes = [
    { codigo: 22812, razon_social: "FIDEICOMISO LA TERCERA", cuit: null, estado: "Activo" },
    { codigo: 30000, razon_social: "LA TERCERA OBRAS", cuit: null, estado: "Activo" },
    { codigo: 30001, razon_social: "CONSUMIDOR FINAL", cuit: null, estado: "Activo" },
  ]
  t.zomatik_articulos.push({ codigo: 10090007, nombre: "H8-620-10 C (HUD)", codigo_sistema: 1000015000 }, { codigo: 10090030, nombre: "H21-620-10 B (CAN)", codigo_sistema: null })
  t.scheduled_dispatches.push({ id: PED_V, status: "scheduled", quantity_m3: 8, plant_id: CAN, client_id: CLI_LIBRE, construction_site_id: "o1", formula_id: FORM_LIBRE, scheduled_arrival_time: "2026-10-23T11:00:00.000Z", created_at: "2026-10-22T12:00:00.000Z", created_by: "Juan Oreguy" })
  return t
}
const vincular = (sb, tipo, id, codigo, pedidoId = null, accion = "vincular") => VS.aplicarDesdePedido({ tipo, id, accion, codigo }, { usuario: "Juan Oreguy", pedidoId }, sb)

test("esFaltaDeVinculo: los textos exactos del robot (sí) y otros errores de dato (no)", async () => {
  const sinTocar = { sucursal: async () => { throw new Error("no tenía que tocar Zomatik") }, get: async () => { throw new Error("no") }, post: async () => { throw new Error("no") } }
  const base = { marca: "m", tipo: "nueva", comprobante: "15", clienteCodigo: 15893, clienteNombre: "X", deposito: 116, fecha: "2026-10-23", m3: 8, articuloCodigoSistema: 1, articuloCodigo: 1, articuloNombre: "H8-620-15 (CAN)", proyectoCodigo: null, entrega: "", buscarAntes: false }
  const msj = async (d) => (await R.generarNp(sinTocar, { ...base, ...d }, { hoy: "2026-10-23" })).mensaje
  const sinCliente = await msj({ clienteCodigo: null })
  const sinArticulo = await msj({ articuloCodigoSistema: null })
  const sinArticuloNiNombre = await msj({ articuloCodigoSistema: null, articuloNombre: "" })
  assert.equal(sinCliente, "El cliente no está vinculado con Zomatik (Vínculos con Zomatik).")
  assert.equal(sinArticulo, "La fórmula no está vinculada con un artículo de Zomatik (H8-620-15 (CAN)).")
  assert.equal(sinArticuloNiNombre, "La fórmula no está vinculada con un artículo de Zomatik.")
  for (const m of [sinCliente, sinArticulo, sinArticuloNiNombre]) assert.equal(N.esFaltaDeVinculo(m), true, m)
  for (const m of [await msj({ deposito: null }), await msj({ comprobante: null }), "Zomatik dijo: cliente bloqueado", null, ""]) assert.equal(N.esFaltaDeVinculo(m), false, String(m))
})

test("modo pedido: solo vincular cliente o fórmula (quitar, sin_par y proyecto, no)", async () => {
  const sb = baseFalsa(tablasVincular())
  for (const [tipo, accion] of [["cliente", "quitar"], ["cliente", "sin_par"], ["formula", "quitar"], ["proyecto", "vincular"]]) {
    const r = await vincular(sb, tipo, CLI_LIBRE, 30000, null, accion)
    assert.equal(r.ok, false, `${tipo} ${accion}`)
    assert.match(r.error, /solo se vincula un cliente o una fórmula/)
  }
  assert.equal(sb.db.clients.find((c) => c.id === CLI_LIBRE).zomatik_codigo, null)
  assert.equal(sb.db.activity_log.length, 0)
})

test("modo pedido: no pisa un vínculo hecho (antes de leer o en el medio) y no cambia la base", async () => {
  const sb = baseFalsa(tablasVincular())
  const r = await vincular(sb, "cliente", CLI_OTRO, 30000)
  assert.equal(r.ok, false)
  assert.equal(r.error, "Ya lo vinculó Bautista Caputo: desde el pedido no se cambia. Si está mal, lo corrige un gerencial en Vínculos.")
  assert.equal(sb.db.clients.find((c) => c.id === CLI_OTRO).zomatik_codigo, 22812)
  // Otro lo vincula entre que se lee y se graba: la condición del UPDATE no deja pisarlo
  const sb2 = baseFalsa(tablasVincular(), {
    antesDeUpdate: (t, _v, db) => { if (t === "formulas") Object.assign(db.formulas.find((f) => f.id === FORM_LIBRE), { zomatik_articulo_codigo: 10090020, zomatik_vinculo: "manual", zomatik_vinculado_por: "Fernando Maldonado" }) },
  })
  const r2 = await vincular(sb2, "formula", FORM_LIBRE, 10090020)
  assert.equal(r2.ok, false)
  assert.match(r2.error, /^Ya lo vinculó Fernando Maldonado/)
  assert.equal(sb2.db.formulas.find((f) => f.id === FORM_LIBRE).zomatik_vinculado_por, "Fernando Maldonado")
  assert.equal(sb2.db.activity_log.length, 0)
})

test("modo pedido: un código que ya es de otro cliente se rechaza; un 23505 (dos a la vez) se contesta con texto claro", async () => {
  const sb = baseFalsa(tablasVincular())
  const r = await vincular(sb, "cliente", CLI_LIBRE, 22812)
  assert.equal(r.ok, false)
  assert.equal(r.error, "Ese cliente de Zomatik ya es «Fideicomiso La Tercera» acá: usá ese cliente en el pedido.")
  assert.equal(sb.db.clients.find((c) => c.id === CLI_LIBRE).zomatik_codigo, null)
  // Dos a la vez: el control previo no lo ve, pero otro lo grabó justo antes → el índice único
  const sb2 = baseFalsa(tablasVincular(), {
    antesDeUpdate: (t, v, db) => { if (t === "clients" && v.zomatik_codigo === 30000) db.clients.find((c) => c.id === CLI_SINPAR).zomatik_codigo = 30000 },
  })
  const r2 = await vincular(sb2, "cliente", CLI_LIBRE, 30000)
  assert.equal(r2.ok, false)
  assert.equal(r2.error, "Ese cliente de Zomatik ya es «MARCADO SIN PAR» acá: usá ese cliente en el pedido.")
  assert.equal(sb2.db.clients.find((c) => c.id === CLI_LIBRE).zomatik_codigo, null)
})

test("modo pedido: vincula sobre 'No está en Zomatik' (Antes: No está en Zomatik); genéricos, otra planta y sin código de sistema, no", async () => {
  const sb = baseFalsa(tablasVincular())
  const r = await vincular(sb, "cliente", CLI_SINPAR, 30000)
  assert.equal(r.ok, true, r.error)
  const c = sb.db.clients.find((x) => x.id === CLI_SINPAR)
  assert.deepEqual([c.zomatik_codigo, c.zomatik_vinculo, c.zomatik_vinculado_por], [30000, "manual", "Juan Oreguy"])
  const a = sb.db.activity_log.find((x) => x.entity === "cliente")
  assert.equal(a.details.Antes, "No está en Zomatik")
  assert.equal(a.details.Desde, "Programación · pedido nuevo")
  assert.match((await vincular(sb, "cliente", CLI_LIBRE, 30001)).error, /genérico/)
  assert.equal((await vincular(sb, "formula", FORM_LIBRE, 10090007)).error, "Es un artículo de Hudson: desde el pedido no se vincula.")
  assert.match((await vincular(sb, "formula", FORM_LIBRE, 10090030)).error, /no se puede usar en la NP/)
  assert.equal(sb.db.formulas.find((f) => f.id === FORM_LIBRE).zomatik_articulo_codigo, null)
})

test("modo pedido con pedido: dos entradas de Actividad; un pedido de otro cliente (o fórmula) se rechaza", async () => {
  const sb = baseFalsa(tablasVincular())
  const mal = await vincular(sb, "cliente", CLI_SINPAR, 30000, PED_V)
  assert.equal(mal.error, "Ese cliente no es el del pedido.")
  assert.equal((await vincular(sb, "formula", "f2f2f2f2-0000-4000-8000-0000000000ff", 10090020, PED_V)).error, "Esa fórmula no es la del pedido.")
  assert.equal(sb.db.clients.find((c) => c.id === CLI_SINPAR).zomatik_codigo, null)
  const r = await vincular(sb, "formula", FORM_LIBRE, 10090020, PED_V)
  assert.equal(r.ok, true, r.error)
  const f = sb.db.formulas.find((x) => x.id === FORM_LIBRE)
  assert.deepEqual([f.zomatik_articulo_codigo, f.zomatik_articulo_nombre, f.zomatik_vinculo, f.zomatik_vinculado_por], [10090020, "H21-620-10 C (CAN)", "manual", "Juan Oreguy"])
  const deFormula = sb.db.activity_log.filter((x) => x.entity === "formula")
  const delPedido = sb.db.activity_log.filter((x) => x.entity === "zomatik_np" && x.entity_id === PED_V)
  assert.equal(deFormula.length, 1)
  assert.equal(deFormula[0].details.Desde, "Programación · pedido 5e5e5e5e")
  assert.equal(deFormula[0].details.Antes, "Sin revisar")
  assert.equal(delPedido.length, 1)
  assert.equal(delPedido[0].details["Qué pasó"], "Vinculó la fórmula «H21-620-10 (CAN)» con H21-620-10 C (CAN) (10090020)")
})

// Zomatik simulado para una NP nueva (las mismas respuestas que zomatik-np.test.mjs, lib/__fixtures__/zomatik-np)
const fx = (f) => readFileSync(new URL(`../__fixtures__/zomatik-np/${f}`, import.meta.url), "latin1")
function navNpNueva() {
  const resp = (html, status = 200, location = null) => ({ status, location, html })
  const lst = (suc, html) => resp(`<form method="post" action="" name="frm_selsuc"><select name="selsuc"><option value="${suc}" selected>S</option></select></form>${html}`)
  const marca = N.marcaNp(PED, 1)
  const estado = { grabadaEn: null }
  const rutas = [
    ["GET", /^modificar_pedidos\.php$/, () => resp(fx("alta.html"))],
    ["GET", /^traerdatossecundarios\.php\?fcliente=15893/, () => resp(fx("secundarios.txt"))],
    ["GET", /^listado_listas\.php$/, () => resp(fx("listas.html"))],
    ["GET", /^manage_pedidos\.php\?.*farticulo=1000015959/, () => resp(fx("detalle-articulo.html"))],
    ["GET", /^manage_pedidos\.php\?/, () => resp(fx("detalle-vacio.html"))],
    ["GET", /^_getnumerofactura\.php\?fcomprobante=15/, ({ suc }) => resp(suc === "18" ? "0001-00001176" : "0001-00007707")],
    ["POST", /^grabar_pedidos\.php\?codigo=0$/, ({ suc }) => { estado.grabadaEn = suc; return resp("", 302, "listado_pedidos.php") }],
    ["GET", /^listado_pedidos\.php$/, () => resp(fx("listado-buscador.html"))],
    ["POST", /^listado_pedidos\.php\?enviado=1$/, ({ cuerpo, suc }) => lst(suc, fx(/bus_numero=0001-00001176/.test(cuerpo) && suc === "18" && estado.grabadaEn === "18" ? "listado-1176.html" : "listado-vacio.html"))],
    ["GET", /^modificar_pedidos\.php\?codigo=157704$/, () => resp(fx("np-abierta.html").replaceAll("{{CODIGO}}", "157704").replace("{{OBS}}", marca).replace("{{NUMERO}}", "0001-00001176").replace("{{RENGLONES}}", fx("renglon-np.html")))],
  ]
  const nav = {
    suc: "18",
    async sucursal(id) { nav.suc = id; return true },
    async get(ruta) { return responder("GET", ruta, null) },
    async post(ruta, cuerpo) { return responder("POST", ruta, cuerpo ? Buffer.from(cuerpo).toString("latin1") : "") },
  }
  function responder(m, ruta, cuerpo) {
    const r = rutas.find(([mm, re]) => mm === m && re.test(ruta))
    if (!r) throw new Error(`ruta no simulada: ${m} ${ruta}`)
    return r[2]({ ruta, cuerpo, suc: nav.suc })
  }
  return nav
}

test("NP en error por una fórmula sin vínculo: se vincula desde el pedido, 'Generar NP ahora' la deja ok y no hay un segundo mail", async () => {
  const t = tablasVincular({ zomatik_np: [npPendiente({ formula_id: FORM_LIBRE })] })
  t.scheduled_dispatches[0].formula_id = FORM_LIBRE
  const sb = baseFalsa(t)
  const { dep } = depFalsas(navNpNueva())
  const errores = []
  dep.avisarError = async (_sb, titulo, lineas) => { errores.push({ titulo, lineas }); return { enviado: true } }
  dep.autorizar = async () => ({ estado: "autorizada", mensaje: null })
  // 1) Guardar sin vincular: la NP queda en error con el mensaje de hoy y un mail con la línea nueva
  await S.procesarNp({ usuario: "test", inicio: Date.now(), sb, dep })
  assert.equal(sb.db.zomatik_np[0].estado, "error")
  assert.equal(sb.db.zomatik_np[0].mensaje, "La fórmula no está vinculada con un artículo de Zomatik (H21-620-10 (CAN)).")
  assert.equal(errores.length, 1)
  assert.match(errores[0].lineas.join("\n"), /Vinculalo desde el pedido/)
  // 2) Se vincula desde el pedido (⋯ › Vincular con Zomatik): la fila de la NP no se toca
  const v = await vincular(sb, "formula", FORM_LIBRE, 10090020, PED)
  assert.equal(v.ok, true, v.error)
  assert.equal(sb.db.zomatik_np[0].estado, "error")
  // 3) Al terminar, el cartel reintenta ("Generar NP ahora"): queda ok, sin otro mail
  const r = await S.procesarNp({ usuario: "Juan Oreguy", pedidoId: PED, inicio: Date.now(), sb, dep })
  assert.equal(sb.db.zomatik_np[0].estado, "ok", sb.db.zomatik_np[0].mensaje)
  assert.equal(r.hechas[0].numero, "NP 0001-00001176")
  assert.equal(errores.length, 1, "no hay un segundo mail")
  const quePaso = sb.db.activity_log.filter((x) => x.entity === "zomatik_np" && x.entity_id === PED).map((x) => x.details["Qué pasó"])
  assert.ok(quePaso.some((x) => /^Vinculó la fórmula «H21-620-10 \(CAN\)»/.test(x)))
  assert.ok(quePaso.includes("NP generada en Zomatik: NP 0001-00001176"))
})

// ── NP anulada que nunca llegó a Zomatik (10/11, A.A. ARQUITECTURA y SANTA RITA) ──
// En modo aviso se despacha con la NP pendiente. Si después se anula (rehacer, cancelar, revisar → otra), contra ella
// no se remitió nada: su uso queda con foto 0 y todo lo despachado del pedido es de la NP nueva.
const usoDe = (sb, npId) => sb.db.zomatik_np_uso.find((u) => u.np_id === npId)

test("anulada sin número (rehacer): el uso queda con foto 0 y la NP nueva ve todo lo despachado (caso A.A.: 6 → 7 m³)", async () => {
  const t = tablas(true, { zomatik_np: [npPendiente({ estado: "error", m3: 6, mensaje: "Falta el tipo de remito (R o X)" })] })
  Object.assign(t.scheduled_dispatches[0], { quantity_m3: 7, dispatched_m3: 3, status: "in_progress" }) // 3 m³ en modo aviso y el pedido pasa a 7
  const sb = baseFalsa(t)
  const r = await S.sincronizarPedido(PED, "Titan", null, sb)
  assert.equal(r.anuladas, 1)
  assert.equal(r.creadas, 1)
  assert.equal(sb.db.zomatik_np[0].estado, "anulada")
  const viejo = usoDe(sb, "np-1")
  assert.equal(viejo.activo, false)
  assert.equal(viejo.despachado_fijo, 0, "contra una NP que nunca existió no se remitió nada")
  assert.equal(viejo.motivo, "NP anulada")
  const np2 = sb.db.zomatik_np.find((x) => x.id !== "np-1")
  assert.equal(Number(np2.m3), 7)
  Object.assign(np2, { estado: "ok", numero: "NP2 0001-00002099", zomatik_codigo: 157800 }) // el robot la generó
  Object.assign(sb.db.scheduled_dispatches[0], { dispatched_m3: 7, status: "completed" })
  const s = await S.saldosDe(sb, sb.db.zomatik_np)
  assert.equal(s.get(np2.id).comprometido, 7, "la NP nueva ve los 7 m³ despachados")
  assert.equal(s.get(np2.id).libre, 0, "sin saldo falso")
  assert.equal(s.get("np-1").comprometido, 0)
  const desp = N.despachadoPorUso(sb.db.zomatik_np_uso.filter((u) => u.scheduled_dispatch_id === PED), 7)
  assert.equal(desp.get(usoDe(sb, np2.id).id), 7)
  // Ya no está en "NP con saldo"
  assert.equal((await S.npsConSaldo({ sb })).length, 0)
})

test("anulada sin número dos veces (caso SANTA RITA): 40 → 40 → 26,5 con 24 despachados en el medio, la última ve los 26,5", async () => {
  const t = tablas(true, { zomatik_np: [npPendiente({ estado: "error", m3: 40 })] })
  Object.assign(t.scheduled_dispatches[0], { quantity_m3: 40, dispatched_m3: 24, status: "in_progress", formula_id: "f2" }) // cambió la fórmula: se rehace
  t.formulas.push({ id: "f2", code: "H8", zomatik_articulo_codigo: null, zomatik_articulo_nombre: null })
  const sb = baseFalsa(t)
  await S.sincronizarPedido(PED, "Titan", null, sb)
  const np2 = sb.db.zomatik_np.find((x) => x.id !== "np-1")
  np2.estado = "error" // fórmula sin vincular
  Object.assign(sb.db.scheduled_dispatches[0], { quantity_m3: 26.5, dispatched_m3: 26.5, status: "completed" })
  // completado: no se rehace; el pedido se vuelve a abrir con 26,5 y se rehace
  sb.db.scheduled_dispatches[0].status = "in_progress"
  await S.sincronizarPedido(PED, "Titan", null, sb)
  for (const id of ["np-1", np2.id]) {
    assert.equal(sb.db.zomatik_np.find((x) => x.id === id).estado, "anulada")
    assert.equal(usoDe(sb, id).despachado_fijo, 0)
  }
  const np3 = sb.db.zomatik_np.find((x) => !["np-1", np2.id].includes(x.id))
  assert.equal(Number(np3.m3), 26.5)
  Object.assign(np3, { estado: "ok", numero: "NP 0001-00002110", zomatik_codigo: 157900 })
  sb.db.scheduled_dispatches[0].status = "completed"
  const s = await S.saldosDe(sb, [np3])
  assert.equal(s.get(np3.id).comprometido, 26.5)
  assert.equal(s.get(np3.id).libre, 0)
})

test("NP en Zomatik (con número) que el pedido deja de usar: la foto de lo despachado queda como siempre", async () => {
  const t = tablas(true, { zomatik_np: [npOk({ m3: 10 })] })
  Object.assign(t.scheduled_dispatches[0], { quantity_m3: 10, dispatched_m3: 3, status: "in_progress", formula_id: "f2" })
  t.formulas.push({ id: "f2", code: "H30", zomatik_articulo_codigo: 10090027, zomatik_articulo_nombre: "H30-620-10 C (CAN)" })
  const sb = baseFalsa(t)
  const r = await S.sincronizarPedido(PED, "Juan", null, sb)
  assert.equal(r.desvinculadas, 1)
  assert.equal(sb.db.zomatik_np[0].estado, "ok")
  assert.equal(usoDe(sb, "np-1").despachado_fijo, 3, "lo despachado contra la NP grabada")
})

test("revisar → 'se genera otra' de una NP sin número: su uso queda con foto 0 y la nueva ve todo lo despachado", async () => {
  const t = tablas(true, { zomatik_np: [npPendiente({ estado: "revisar", paso: "grabar_cortado" })] })
  Object.assign(t.scheduled_dispatches[0], { dispatched_m3: 3, status: "in_progress" })
  const sb = baseFalsa(t)
  const r = await S.revisarNp("np-1", "otra", "Bautista", sb)
  assert.equal(r.ok, true)
  assert.equal(sb.db.zomatik_np[0].estado, "anulada")
  assert.equal(usoDe(sb, "np-1").activo, false)
  assert.equal(usoDe(sb, "np-1").despachado_fijo, 0)
  const np2 = sb.db.zomatik_np.find((x) => x.id !== "np-1")
  assert.equal(Number(np2.m3), 8)
  Object.assign(np2, { estado: "ok", numero: "NP 0001-00001180", zomatik_codigo: 157810 })
  Object.assign(sb.db.scheduled_dispatches[0], { dispatched_m3: 8, status: "completed" })
  const s = await S.saldosDe(sb, [np2])
  assert.equal(s.get(np2.id).comprometido, 8)
  assert.equal(s.get(np2.id).libre, 0)
})

test("revisar → 'se genera otra' de una NP con número: el uso queda inactivo con lo REMITIDO por el sistema (no el reparto)", async () => {
  const rem = (id, m3, extra) => ({ id, np_id: "np-1", scheduled_dispatch_id: PED, m3, estado: "ok", remito_estado: "ok", paso: "ok", ...extra })
  const t = tablas(true, {
    zomatik_np: [npPendiente({ estado: "revisar", numero: "NP 0001-00001176", zomatik_codigo: 157704 })],
    zomatik_remitos: [
      rem("r1", 3), // grabado: cuenta
      rem("r2", 1, { estado: "revisar", remito_estado: "revisar", paso: "grabar_remito" }), // cortado en Grabar: puede estar, cuenta
      rem("r3", 2, { estado: "revisar", remito_estado: "revisar", paso: "formulario_remito" }), // no llegó a Grabar: no cuenta
      rem("r4", 5, { estado: "anulado", remito_estado: "ok" }), // anulado: no cuenta
      rem("r5", 4, { estado: "pendiente", remito_estado: "pendiente", paso: null }), // pendiente: no cuenta
      rem("r6", 7, { scheduled_dispatch_id: "otro-pedido" }), // de otro pedido: no cuenta
      rem("r7", 6, { np_id: "otra-np" }), // de otra NP: no cuenta
    ],
  })
  Object.assign(t.scheduled_dispatches[0], { dispatched_m3: 8, status: "in_progress" }) // el reparto le daría 8
  const sb = baseFalsa(t)
  const r = await S.revisarNp("np-1", "otra", "Bautista", sb)
  assert.equal(r.ok, true)
  assert.equal(usoDe(sb, "np-1").activo, false)
  assert.equal(usoDe(sb, "np-1").despachado_fijo, 4)
})

test("el pedido se cancela mientras la NP espera al robot: se anula y su uso queda con foto 0", async () => {
  const t = tablas(true, { zomatik_np: [npPendiente()] })
  Object.assign(t.scheduled_dispatches[0], { dispatched_m3: 2, status: "cancelled" })
  const sb = baseFalsa(t)
  const { dep, llamadas } = depFalsas({})
  await S.procesarNp({ usuario: "test", inicio: Date.now(), sb, dep })
  assert.equal(sb.db.zomatik_np[0].estado, "anulada")
  assert.equal(llamadas.navegador, 0, "no se abrió Zomatik")
  assert.equal(usoDe(sb, "np-1").activo, false)
  assert.equal(usoDe(sb, "np-1").despachado_fijo, 0)
})

test("autocorrección: un uso activo colgado de una NP anulada se suelta al sincronizar (sin número 0; con número, lo remitido)", async () => {
  const t = tablas(true, {
    zomatik_np: [
      npPendiente({ estado: "anulada", m3: 6 }),
      npPendiente({ id: "np-2", n: 2, marca: N.marcaNp(PED, 2), estado: "anulada", numero: "NP 0001-00001190", zomatik_codigo: 157750, m3: 4, created_at: "2026-10-22T12:00:01.000Z" }),
    ],
    zomatik_remitos: [{ id: "r1", np_id: "np-2", scheduled_dispatch_id: PED, m3: 2.5, estado: "ok", remito_estado: "ok", paso: "ok" }],
  })
  Object.assign(t.scheduled_dispatches[0], { quantity_m3: 10, dispatched_m3: 9, status: "in_progress" })
  const sb = baseFalsa(t)
  assert.equal(sb.db.zomatik_np_uso.filter((u) => u.activo).length, 2, "los dos usos colgados (activos)")
  const r = await S.sincronizarPedido(PED, "Juan", null, sb)
  assert.equal(usoDe(sb, "np-1").activo, false)
  assert.equal(usoDe(sb, "np-1").despachado_fijo, 0)
  assert.equal(usoDe(sb, "np-2").activo, false)
  assert.equal(usoDe(sb, "np-2").despachado_fijo, 2.5)
  assert.equal(r.creadas, 1)
  const np3 = sb.db.zomatik_np.find((x) => !["np-1", "np-2"].includes(x.id))
  assert.equal(Number(np3.m3), 10)
  const avisos = () => sb.db.activity_log.filter((x) => /estaba anulada y el pedido la seguía usando/.test(x.details?.["Qué pasó"] || ""))
  assert.equal(avisos().length, 2)
  // Otra vez: ya no hay nada colgado, no se repite
  await S.sincronizarPedido(PED, "Juan", null, sb)
  assert.equal(avisos().length, 2)
})

test("anular: una NP que el robot cortó en Grabar en el medio no se anula (puede estar en Zomatik) y no se crea otra", async () => {
  for (const paso of ["grabar", "verificar", "grabar_cortado", "buscar_marca"]) {
    const t = tablas(true, { zomatik_np: [npPendiente({ estado: "error", m3: 6 })] })
    t.scheduled_dispatches[0].quantity_m3 = 7 // se rehace
    const sb = baseFalsa(t, {
      // Entre que se planeó (paso nulo) y el update, el robot llegó a Grabar y se cortó
      antesDeUpdate: (tabla, vals, db) => { if (tabla === "zomatik_np" && vals.estado === "anulada") Object.assign(db.zomatik_np[0], { estado: "pendiente", paso }) },
    })
    const r = await S.sincronizarPedido(PED, "Juan", null, sb)
    assert.equal(r.anuladas, 0, paso)
    assert.equal(r.creadas, 0, paso)
    assert.equal(sb.db.zomatik_np[0].estado, "pendiente", paso)
    assert.equal(usoDe(sb, "np-1").activo, true, paso)
  }
  // Sin paso (nulo) o con un paso de antes de Grabar, sí se anula
  for (const paso of [null, "inicio"]) {
    const t = tablas(true, { zomatik_np: [npPendiente({ estado: "error", m3: 6, paso })] })
    t.scheduled_dispatches[0].quantity_m3 = 7
    const sb = baseFalsa(t)
    const r = await S.sincronizarPedido(PED, "Juan", null, sb)
    assert.equal(r.anuladas, 1, String(paso))
    assert.equal(r.creadas, 1, String(paso))
  }
})

test("cancelado con la NP cortada en Grabar: no se anula; va a 'revisar' (al sincronizar y con el robot)", async () => {
  const t = tablas(true, { zomatik_np: [npPendiente({ paso: "grabar_cortado" })] })
  t.scheduled_dispatches[0].status = "cancelled"
  const sb = baseFalsa(t, { antesDeUpdate: (tabla, vals) => assert.ok(!(tabla === "zomatik_np" && vals.estado === "anulada"), "nunca se anula") })
  await S.sincronizarPedido(PED, "Juan", null, sb)
  assert.equal(sb.db.zomatik_np[0].estado, "revisar")
  // Por el robot (la carrera: el pedido se canceló sin sincronizar)
  const t2 = tablas(true, { zomatik_np: [npPendiente({ paso: "grabar" })] })
  t2.scheduled_dispatches[0].status = "cancelled"
  const sb2 = baseFalsa(t2)
  const { dep, llamadas } = depFalsas({})
  await S.procesarNp({ usuario: "test", inicio: Date.now(), sb: sb2, dep })
  assert.equal(sb2.db.zomatik_np[0].estado, "revisar")
  assert.equal(llamadas.navegador, 0)
  assert.equal(usoDe(sb2, "np-1").activo, true, "el uso no se toca: puede estar en Zomatik")
})


// ---------------------------------------------------------------------------
// Control de NP eliminadas a mano en Zomatik (pasada de la noche, solo lectura)
// ---------------------------------------------------------------------------

/**
 * Zomatik simulado: el listado de pedidos de REBUCRET con estas filas [codigo, numero]. bus_numero filtra "contiene";
 * cualquier otro filtro con valor (fechas, Pendientes, depósito) no deja pasar nada. `ignoraNumero`: devuelve todo.
 * `exacta`: lo que devuelve la búsqueda por un número completo (si no, filtra igual que el bloque).
 */
function navListado(filas, { suc = "18", falla = null, buscador = fx("listado-buscador.html"), ignoraNumero = false, exacta = null } = {}) {
  const pedidos = []
  const cuerpos = []
  const resp = (html) => ({ status: 200, location: null, html })
  const fila = ([codigo, numero]) => `<tr><td class="itemlistado"><a href="modificar_pedidos.php?codigo=${codigo}">2026-11-01</a></td><td class="itemlistado"><a href="modificar_pedidos.php?codigo=${codigo}">${numero}</a></td><td class="itemlistado"><a href="modificar_pedidos.php?codigo=${codigo}">CLIENTE</a></td><td class="itemlistado">$ 176.500</td><td class="itemlistado"><b>PEN</b></td></tr>`
  const nav = {
    filas,
    async sucursal() { return true },
    async get(ruta) {
      pedidos.push(["GET", ruta])
      if (falla) throw falla
      if (/^listado_pedidos\.php$/.test(ruta)) return resp(buscador)
      throw new Error(`ruta no simulada: GET ${ruta}`)
    },
    async post(ruta, cuerpo) {
      pedidos.push(["POST", ruta])
      if (!/^listado_pedidos\.php\?enviado=1$/.test(ruta)) throw new Error(`ruta no simulada: POST ${ruta}`)
      const q = new URLSearchParams(Buffer.from(cuerpo).toString("latin1"))
      cuerpos.push(q)
      const busca = q.get("bus_numero") || ""
      const otros = [...q.entries()].some(([k, v]) => /^bus_/.test(k) && !["bus_numero", "bus_sucursal"].includes(k) && v && v !== "0")
      let suyas = otros ? [] : ignoraNumero ? nav.filas : nav.filas.filter(([, n]) => N.numeroNormalizado(n).includes(busca))
      if (exacta && busca.length === 13) suyas = exacta
      return resp(`<form method="post" action="" name="frm_selsuc"><select name="selsuc"><option value="${suc}" selected>S</option></select></form><table><tr><td>Fecha</td></tr>${suyas.map(fila).join("")}</table>`)
    },
  }
  return { nav, pedidos, cuerpos }
}

const hace = (dias) => new Date(Date.now() - dias * 86_400_000).toISOString().slice(0, 10)
const npEnZ = (extra = {}) => npPendiente({ estado: "ok", numero: "NP2 0001-00002095", zomatik_codigo: 157800, sucursal: "18", paso: "autorizada", fecha: hace(5), proximo_intento: null, ...extra })
/** Las vecinas de la serie que siguen en Zomatik (la 2095 no). */
const VECINAS = [[157799, "NP2 0001-00002094"], [157801, "NP2 0001-00002096"]]
const LLAVE_CONTROL = { clave: "np_control_eliminadas", valor: "1" }
/** Tablas con la llave del control prendida. */
const tablasCtl = (nps, extra = {}) => {
  const t = tablas(true, { zomatik_np: [].concat(nps), integraciones: [{ ...LLAVE_CONTROL }], ...extra })
  t.scheduled_dispatches[0].scheduled_arrival_time = `${hace(5)}T15:00:00.000Z` // el mismo día de la NP
  return t
}
const depControl = (nav, { falla = 0 } = {}) => {
  const mails = []
  let fallan = falla
  return { mails, dep: { navegador: async () => nav, avisarError: async (_sb, titulo, lineas) => { mails.push({ titulo, lineas }); if (fallan > 0) { fallan--; return { enviado: false, motivo: "Resend respondió 500" } } return { enviado: true } } } }
}
/** Pasa el tiempo: las lecturas anteriores quedan de otra pasada. */
const otraPasada = (sb) => sb.db.activity_log.forEach((x) => { x.created_at = new Date(Date.parse(x.created_at) - S.ENTRE_LECTURAS_MS - 60_000).toISOString() })
const controles = (sb) => sb.db.activity_log.filter((x) => x.details?.Control === S.CONTROL_ELIMINADA).map((x) => x.details.Lectura)
const controlar = (sb, dep, inicio = Date.now()) => S.controlarNpEliminadas("sistema (control de NP)", { inicio, sb, dep })
/** Dos pasadas en noches distintas. */
const dosPasadas = async (sb, dep) => { const a = await controlar(sb, dep); otraPasada(sb); const b = await controlar(sb, dep); return [a, b] }

test("control de NP eliminadas: sin la fila de la llave en integraciones no hace nada (arranca apagado)", async () => {
  const sb = baseFalsa(tablas(true, { zomatik_np: [npEnZ()] }))
  let abrio = 0
  const r = await controlar(sb, { navegador: async () => { abrio++; return navListado(VECINAS).nav } })
  assert.equal(r.apagado, true)
  assert.equal(abrio, 0)
  assert.deepEqual(controles(sb), [])
})

test("NP eliminada con el pedido completo: 1.ª lectura sospechosa, en otra pasada se anula, el uso queda con lo remitido y sin mail", async () => {
  const t = tablasCtl(npEnZ(), { zomatik_remitos: [{ id: "r1", np_id: "np-1", scheduled_dispatch_id: PED, m3: 3, estado: "ok", remito_estado: "ok", paso: "ok" }] })
  Object.assign(t.scheduled_dispatches[0], { status: "completed", dispatched_m3: 8 })
  const sb = baseFalsa(t)
  const { nav, pedidos } = navListado(VECINAS)
  const { dep, mails } = depControl(nav)
  const a = await controlar(sb, dep)
  assert.equal(a.sospechosas, 1)
  assert.equal(sb.db.zomatik_np[0].estado, "ok", "una sola lectura no alcanza")
  // La misma pasada repetida (o un reintento al rato): no confirma
  await controlar(sb, dep)
  assert.equal(sb.db.zomatik_np[0].estado, "ok")
  assert.deepEqual(controles(sb), ["sospecha"])
  otraPasada(sb)
  const b = await controlar(sb, dep)
  assert.equal(b.anuladas, 1)
  const np = sb.db.zomatik_np[0]
  assert.equal(np.estado, "anulada")
  assert.match(np.mensaje, /^Eliminada en Zomatik \(detectado el \d{2}\/\d{2}\)$/)
  assert.equal(np.mensaje, S.msjEliminadaAnulada(N.hoyAR()))
  assert.equal(usoDe(sb, "np-1").activo, false)
  assert.equal(usoDe(sb, "np-1").despachado_fijo, 3, "lo remitido de verdad, no el reparto (8)")
  assert.deepEqual(controles(sb), ["sospecha", "anulada"])
  assert.equal(mails.length, 0)
  // Solo lectura: la sucursal y el listado de pedidos, nada más
  assert.ok(pedidos.length > 0)
  for (const [m, ruta] of pedidos) assert.ok(W.rutaPermitida(ruta, m), `${m} ${ruta}`)
  assert.equal(sb.db.integraciones.filter((x) => x.clave === "zomatik_robot").length, 0, "el turno se soltó")
})

test("NP eliminada con el pedido activo: 'revisar' (no se anula ni se genera otra) y un solo mail a Bautista", async () => {
  const sb = baseFalsa(tablasCtl(npEnZ()))
  const { nav } = navListado(VECINAS)
  const { dep, mails } = depControl(nav)
  const [, r] = await dosPasadas(sb, dep)
  assert.equal(r.revisar, 1)
  assert.equal(r.avisos, 1)
  const np = sb.db.zomatik_np[0]
  assert.equal(np.estado, "revisar")
  assert.equal(np.mensaje, "La NP fue eliminada en Zomatik: ¿la hicieron a mano? Revisá antes de generar otra")
  assert.equal(usoDe(sb, "np-1").activo, true, "el pedido la sigue usando")
  assert.equal(mails.length, 1)
  assert.match(mails[0].titulo, /NP2 0001-00002095/)
  // El pedido no genera otra NP sola
  const s = await S.sincronizarPedido(PED, "sistema", null, sb)
  assert.equal(s.creadas, 0)
  assert.equal(sb.db.zomatik_np.length, 1)
  // Otra pasada con la NP en "revisar": no hay otro mail
  await controlar(sb, dep)
  assert.equal(mails.length, 1)
  // Si alguien la deja "buena" otra vez y sigue sin estar: vuelve a "revisar" sin otro mail
  sb.db.zomatik_np[0].estado = "ok"
  await dosPasadas(sb, dep)
  assert.equal(sb.db.zomatik_np[0].estado, "revisar")
  assert.equal(mails.length, 1, "uno solo por NP")
})

test("si el mail de 'revisar' no sale, se reintenta en la pasada siguiente (lo que salió se ve en Actividad)", async () => {
  const sb = baseFalsa(tablasCtl(npEnZ()))
  const { nav } = navListado(VECINAS)
  const { dep, mails } = depControl(nav, { falla: 1 })
  const [, r] = await dosPasadas(sb, dep)
  assert.equal(r.revisar, 1)
  assert.equal(r.avisos, 0)
  assert.equal(mails.length, 1)
  const avisos = () => sb.db.activity_log.filter((x) => x.details?.Lectura === "aviso").map((x) => x.details.Avisado)
  assert.deepEqual(avisos(), ["no"])
  const r2 = await controlar(sb, dep)
  assert.equal(r2.avisos, 1)
  assert.equal(mails.length, 2)
  assert.deepEqual(avisos(), ["no", "sí"])
  await controlar(sb, dep)
  assert.equal(mails.length, 2, "ya salió: no se repite")
})

test("NP con saldo cerrado: con un pedido activo que la usa va a 'revisar'; sin pedido activo, se anula", async () => {
  const sb = baseFalsa(tablasCtl(npEnZ({ saldo_decision: "cerrada" })))
  const { nav } = navListado(VECINAS)
  await dosPasadas(sb, depControl(nav).dep)
  assert.equal(sb.db.zomatik_np[0].estado, "revisar")
  const t = tablasCtl(npEnZ({ saldo_decision: "cerrada" }))
  t.scheduled_dispatches[0].status = "cancelled"
  const sb2 = baseFalsa(t)
  const { dep, mails } = depControl(navListado(VECINAS).nav)
  await dosPasadas(sb2, dep)
  assert.equal(sb2.db.zomatik_np[0].estado, "anulada")
  assert.equal(usoDe(sb2, "np-1").activo, false)
  assert.equal(mails.length, 0)
})

test("buscador precargado (fechas, Pendientes, depósito): todos los bus_* van en blanco salvo el número y la sucursal", async () => {
  const buscador = `<html><body><form method="post" action="" name="frm_selsuc"><select name="selsuc"><option value="18" selected>REBUCRET</option></select></form>
<form action="listado_pedidos.php?enviado=1" method="POST" name="formulario"><input type="hidden" name="nota_tabla" value="pedidos"><input type="hidden" name="exportar" value="0">
<input type="text" name="bus_numero" value=""><input type="text" name="bus_fechad" value="2026-11-01"><input type="text" name="bus_fechah" value="2026-11-12">
<select name="bus_pendrem"><option value="0">--Opiones--</option><option value="1" selected>Pendientes</option></select>
<select name="bus_deposito"><option value="">--</option><option value="116" selected>CANNING</option></select>
<select name="bus_sucursal"><option value="">--Sucursal--</option><option value="18">REBUCRET</option></select></form></body></html>`
  const sb = baseFalsa(tablasCtl(npEnZ()))
  const { nav, cuerpos } = navListado(VECINAS, { buscador })
  const r = await controlar(sb, depControl(nav).dep)
  assert.equal(r.sospechosas, 1, "con los filtros en blanco la búsqueda trae las vecinas")
  assert.ok(cuerpos.length >= 2)
  for (const q of cuerpos) {
    for (const k of ["bus_fechad", "bus_fechah", "bus_pendrem", "bus_deposito"]) assert.equal(q.get(k), "", k)
    assert.equal(q.get("bus_sucursal"), "18")
    assert.equal(q.get("nota_tabla"), "pedidos", "lo que no es bus_* queda como viene")
  }
  assert.deepEqual(cuerpos.map((q) => q.get("bus_numero")), ["0001-000020", "0001-00002095"])
})

test("listado ilegible (otra sucursal, sin NP de la serie, filtro ignorado, más de una página, sesión caída): no se concluye nada", async () => {
  const conPaginas = navListado(VECINAS).nav
  const post = conPaginas.post
  conPaginas.post = async (...a) => { const r = await post(...a); return { ...r, html: `${r.html}<a href="listado_pedidos.php?pagina=2">Siguiente</a>` } }
  const casos = [
    navListado(VECINAS, { suc: "17" }).nav, // el listado vino de RUTA 25
    navListado([]).nav, // la búsqueda no trae ninguna NP de esa serie
    navListado([[157799, "NP 0001-00002094"]]).nav, // trae del bloque pero de otro comprobante (NP, no NP2)
    navListado([...VECINAS, [150000, "NP2 0001-00001999"]], { ignoraNumero: true }).nav, // bus_numero se ignora: filas de otro bloque
    navListado(VECINAS, { exacta: [[157799, "NP2 0001-00002094"]] }).nav, // la búsqueda exacta trae otro número
    conPaginas,
    navListado(VECINAS, { falla: Object.assign(new Error("La sesión de Zomatik se cerró"), { codigo: "sesion_caida" }) }).nav,
  ]
  for (const nav of casos) {
    const sb = baseFalsa(tablasCtl(npEnZ()))
    const { dep, mails } = depControl(nav)
    const [a, b] = await dosPasadas(sb, dep)
    assert.equal(a.ilegibles + b.ilegibles, 2)
    assert.equal(sb.db.zomatik_np[0].estado, "ok")
    assert.deepEqual(controles(sb), [], "ni siquiera queda sospechosa")
    assert.equal(mails.length, 0)
  }
  // Sin navegador (no se pudo entrar): tampoco
  const sb = baseFalsa(tablasCtl(npEnZ()))
  const r = await controlar(sb, { navegador: async () => { throw Object.assign(new Error("Zomatik no respondió a tiempo"), { codigo: "sin_respuesta" }) } })
  assert.equal(r.ilegibles, 1)
  assert.equal(sb.db.zomatik_np[0].estado, "ok")
})

test("freno: si en una pasada faltan más de 2 NP no se marca ninguna y llega un mail de posible falla de lectura", async () => {
  const nps = ["2095", "2097", "2098"].map((n, i) => npEnZ({ id: `np-${i + 1}`, n: i + 1, marca: N.marcaNp(PED, i + 1), numero: `NP2 0001-0000${n}`, zomatik_codigo: 157900 + i }))
  const sb = baseFalsa(tablasCtl(nps))
  const { nav } = navListado(VECINAS)
  const { dep, mails } = depControl(nav)
  const [a, b] = await dosPasadas(sb, dep)
  assert.equal(a.freno, true)
  assert.equal(b.freno, true)
  assert.equal(a.ilegibles, 3)
  assert.deepEqual(controles(sb), [])
  assert.ok(sb.db.zomatik_np.every((x) => x.estado === "ok"))
  assert.equal(mails.length, 2)
  assert.match(mails[0].titulo, /posible falla de lectura/)
  assert.match(mails[0].lineas.join(" "), /NP2 0001-00002095.*NP2 0001-00002097.*NP2 0001-00002098/)
  // Con 2 que faltan, sí se marcan
  const sb2 = baseFalsa(tablasCtl(nps.slice(0, 2)))
  const r = await controlar(sb2, depControl(navListado(VECINAS).nav).dep)
  assert.equal(r.freno, undefined)
  assert.equal(r.sospechosas, 2)
})

test("3 noches seguidas con todo ilegible: un mail a Bautista, uno solo; una noche que lee bien vuelve a cero", async () => {
  const clave = S.CLAVE_CONTROL_ILEGIBLE
  const noches = [hace(2), hace(1)]
  const sb = baseFalsa(tablasCtl(npEnZ(), { integraciones: [{ ...LLAVE_CONTROL }, { clave, valor: JSON.stringify({ noches, avisado: false }) }] }))
  const ilegible = depControl(navListado(VECINAS, { suc: "17" }).nav)
  await controlar(sb, ilegible.dep)
  assert.equal(ilegible.mails.length, 1)
  assert.match(ilegible.mails[0].titulo, /no puede leer Zomatik/)
  assert.equal(JSON.parse(sb.db.integraciones.find((x) => x.clave === clave).valor).avisado, true)
  await controlar(sb, ilegible.dep)
  assert.equal(ilegible.mails.length, 1, "uno solo")
  // Lee bien: se borra la cuenta
  await controlar(sb, depControl(navListado(VECINAS).nav).dep)
  assert.equal(sb.db.integraciones.some((x) => x.clave === clave), false)
  // Con dos noches, todavía no
  const sb2 = baseFalsa(tablasCtl(npEnZ(), { integraciones: [{ ...LLAVE_CONTROL }, { clave, valor: JSON.stringify({ noches: [hace(1)], avisado: false }) }] }))
  const d2 = depControl(navListado(VECINAS, { suc: "17" }).nav)
  await controlar(sb2, d2.dep)
  assert.equal(d2.mails.length, 0)
  assert.deepEqual(JSON.parse(sb2.db.integraciones.find((x) => x.clave === clave).valor).noches, [hace(1), N.hoyAR()].sort())
})

test("tiempo: con menos de 25 s no se lee; las lecturas paran con 20 s de margen", async () => {
  const sb = baseFalsa(tablasCtl(npEnZ()))
  const { nav, pedidos } = navListado(VECINAS)
  const r = await controlar(sb, depControl(nav).dep, Date.now() - 31_000)
  assert.equal(r.sinTiempo, true)
  assert.equal(pedidos.length, 0)
  // El corte de las lecturas: `seguir` devuelve false con menos de 20 s
  let seguir = null
  const inicio = Date.now() - 29_000 // quedan 26 s: arranca
  const sb2 = baseFalsa(tablasCtl(npEnZ()))
  await S.controlarNpEliminadas("x", { inicio, sb: sb2, dep: { navegador: async () => nav, buscar: async (_n, _nps, o) => { seguir = o.seguir; return new Map() } } })
  const real = Date.now
  try {
    Date.now = () => inicio + 34_000 // quedan 21 s
    assert.equal(seguir(), true)
    Date.now = () => inicio + 35_500 // quedan 19,5 s
    assert.equal(seguir(), false)
  } finally {
    Date.now = real
  }
})

test("sospechosa que vuelve a aparecer: se cierra la sospecha y una nueva falta empieza de cero (no se anula)", async () => {
  const sb = baseFalsa(tablasCtl(npEnZ()))
  const { nav } = navListado(VECINAS)
  const { dep } = depControl(nav)
  await controlar(sb, dep) // sospecha
  otraPasada(sb)
  nav.filas = [...VECINAS, [157800, "NP2 0001-00002095"]]
  await controlar(sb, dep) // está: se cierra
  assert.deepEqual(controles(sb), ["sospecha", "aparece"])
  otraPasada(sb)
  nav.filas = VECINAS
  await controlar(sb, dep) // vuelve a faltar: sospecha nueva, no anulada
  assert.equal(sb.db.zomatik_np[0].estado, "ok")
  assert.deepEqual(controles(sb), ["sospecha", "aparece", "sospecha"])
  // La NP que aparece en el bloque no se busca otra vez por número; la que falta, sí (segunda mirada)
  const { nav: n2, pedidos } = navListado([...VECINAS, [157800, "NP2 0001-00002095"]])
  await controlar(baseFalsa(tablasCtl(npEnZ())), depControl(n2).dep)
  assert.equal(pedidos.filter(([m]) => m === "POST").length, 1)
})

test("solo NP 'ok' con número de REBUCRET de los últimos 60 días", async () => {
  const sb = baseFalsa(tablasCtl([
    npEnZ({ id: "np-1", fecha: hace(65) }), // vieja
    npEnZ({ id: "np-2", n: 2, marca: N.marcaNp(PED, 2), numero: "NP 0001-00007706", sucursal: "17" }), // RUTA 25
    npEnZ({ id: "np-3", n: 3, marca: N.marcaNp(PED, 3), estado: "revisar" }),
    npEnZ({ id: "np-4", n: 4, marca: N.marcaNp(PED, 4), numero: null }),
  ]))
  const { nav, pedidos } = navListado(VECINAS)
  const r = await controlar(sb, depControl(nav).dep)
  assert.equal(r.controladas, 0)
  assert.equal(pedidos.length, 0, "no se habló con Zomatik")
})
