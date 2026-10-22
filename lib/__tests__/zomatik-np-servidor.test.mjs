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
function baseFalsa(tablas) {
  const db = JSON.parse(JSON.stringify(tablas))
  class Q {
    constructor(t) { this.t = t; this.f = []; this.op = "select"; this.vals = null; this.uno = false; this.devolver = false }
    select() { if (this.op !== "select") this.devolver = true; return this }
    eq(c, v) { this.f.push((r) => r[c] === v); return this }
    neq(c, v) { this.f.push((r) => r[c] !== v); return this }
    in(c, vs) { this.f.push((r) => vs.includes(r[c])); return this }
    is(c, v) { this.f.push((r) => (r[c] ?? null) === v); return this }
    not(c, _op, v) { this.f.push((r) => (r[c] ?? null) !== v); return this }
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
        for (const v of [].concat(this.vals)) {
          if (this.t === "zomatik_np" && filas.some((r) => r.marca === v.marca)) return { data: null, error: { code: "23505", message: "duplicate" } }
          filas.push({ id: `np-${filas.length + 1}`, intentos: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), paso: null, mensaje: null, numero: null, zomatik_codigo: null, sucursal: null, disponible_m3: null, en_curso_desde: null, ...v })
        }
        return { data: null, error: null }
      }
      if (this.op === "upsert") {
        const k = this.clave
        const ya = filas.find((r) => r[k] === this.vals[k])
        if (ya) Object.assign(ya, this.vals)
        else filas.push({ ...this.vals })
        return { data: null, error: null }
      }
      if (this.op === "update") {
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
  }
  return {
    db,
    from: (t) => new Q(t),
    rpc: async (n, a) => ({ data: rpcs[n] ? rpcs[n](a) : null, error: null }),
  }
}

const tablas = (activo, extra = {}) => ({
  plants: [{ id: CAN, name: "Canning" }],
  zomatik_np_config: activo === null ? [] : [{ plant_id: CAN, activo, desde: "2026-10-01T00:00:00.000Z", deposito: 116, exigir_np: "aviso", aviso_hasta: "2026-11-06" }],
  scheduled_dispatches: [{ id: PED, status: "scheduled", quantity_m3: 8, plant_id: CAN, client_id: "c1", construction_site_id: "o1", formula_id: "f1", scheduled_arrival_time: "2026-10-23T11:00:00.000Z", created_at: "2026-10-22T12:00:00.000Z", created_by: "Juan Oreguy" }],
  clients: [{ id: "c1", name: "OBRA PROPIA", zomatik_codigo: 15893 }, { id: "c2", name: "OTRO", zomatik_codigo: 999 }],
  formulas: [{ id: "f1", code: "H21", zomatik_articulo_codigo: 10090020, zomatik_articulo_nombre: "H21-620-10 C (CAN)" }],
  zomatik_articulos: [{ codigo: 10090020, nombre: "H21-620-10 C (CAN)", codigo_sistema: 1000015959 }],
  zomatik_proyectos: [{ codigo: 576, cliente_codigo: 15893, estado: "abierto" }, { codigo: 577, cliente_codigo: 999, estado: "abierto" }],
  zomatik_np: [], zomatik_np_pedido: [], zomatik_np_excepciones: [], construction_sites: [{ id: "o1" }], activity_log: [], integraciones: [],
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
    assert.equal(sb.db.zomatik_np[0].proximo_intento, null) // no se reintenta sola mientras esté apagada
    assert.ok(r.hechas.length === 1)
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
  const sb = baseFalsa(tablas(true))
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
