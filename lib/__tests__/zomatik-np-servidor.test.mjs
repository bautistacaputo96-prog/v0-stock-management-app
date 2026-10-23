// Pruebas del lado del servidor de Z2 (lib/zomatik/np-servidor.ts) con una base SIMULADA en memoria y un navegador
// simulado: llave apagada (nunca se arma el navegador), carreras (dos robots, una NP que cambia mientras se genera),
// la elección del pedido validada, el tiempo y la lógica del trigger del despacho. Sin red, sin Zomatik, sin la base real.
import { test } from "node:test"
import assert from "node:assert/strict"
import * as S from "../zomatik/np-servidor.ts"
import * as N from "../zomatik/np.ts"

const CAN = "11111111-1111-4111-8111-111111111111"
const PED = "1a2b3c4d-0000-4000-8000-000000000001"

/** Base en memoria con lo justo del cliente de Supabase que usa np-servidor (select/update/insert/upsert + rpc). */
function baseFalsa(tablas, { antesDeUpdate } = {}) {
  const db = JSON.parse(JSON.stringify(tablas))
  class Q {
    constructor(t) { this.t = t; this.f = []; this.op = "select"; this.vals = null; this.uno = false; this.devolver = false }
    select() { if (this.op !== "select") this.devolver = true; return this }
    eq(c, v) { this.f.push((r) => r[c] === v); return this }
    neq(c, v) { this.f.push((r) => r[c] !== v); return this }
    in(c, vs) { this.f.push((r) => vs.includes(r[c])); return this }
    is(c, v) { this.f.push((r) => (r[c] ?? null) === v); return this }
    not(c, op, v) {
      if (op === "in") { const vs = String(v).replace(/[()]/g, "").split(","); this.f.push((r) => !vs.includes(r[c])); return this }
      this.f.push((r) => (r[c] ?? null) !== v); return this
    }
    gte(c, v) { this.f.push((r) => r[c] >= v); return this }
    order() { return this }
    limit() { return this }
    maybeSingle() { this.uno = true; return this }
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
        for (const r of tocadas) Object.assign(r, this.vals)
        return { data: this.devolver ? tocadas.map((r) => ({ id: r.id })) : null, error: null }
      }
      const r = filas.filter(pasa).map((x) => ({ ...x }))
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
    rpc: async (n, a) => ({ data: rpcs[n] ? rpcs[n](a) : null, error: null }),
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
