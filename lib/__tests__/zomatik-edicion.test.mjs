// Pruebas de la edición de la NP cuando el pedido cambia de m³ (docs/specs/2026-11-18-editar-np-al-cambiar-pedido.md,
// secciones 5, 6 y 9): el robot (lib/zomatik/edicion-servidor.ts) con el `ajustarCantidadNp` de verdad, un navegador
// SIMULADO (lib/__fixtures__/zomatik-ajuste y zomatik-np, la NP 157704 = NP 0001-00001176) y una base simulada en
// memoria. Sin red, sin Zomatik, sin la base real.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import * as A from "../zomatik/ajuste.ts"
import * as N from "../zomatik/np.ts"
import * as R from "../zomatik/np-robot.ts"
import * as W from "../zomatik/web.ts"
import * as S from "../zomatik/np-servidor.ts"
import * as E from "../zomatik/edicion-servidor.ts"

const fxA = (f) => readFileSync(new URL(`../__fixtures__/zomatik-ajuste/${f}`, import.meta.url), "latin1")
const fxN = (f) => readFileSync(new URL(`../__fixtures__/zomatik-np/${f}`, import.meta.url), "latin1")
const latin1 = (u8) => Buffer.from(u8).toString("latin1")
const resp = (html, status = 200, location = null) => ({ status, location, html })
const conSuc = (suc, html) => resp(`<form method="post" action="" name="frm_selsuc"><select name="selsuc"><option value="${suc}" selected>S</option></select></form>${html}`)
const CAN = "11111111-1111-4111-8111-111111111111"
const PED = "1a2b3c4d-0000-4000-8000-000000000001"
const OTRO = "9f9f9f9f-0000-4000-8000-000000000002"
const MARCA_NP = N.marcaNp(PED, 1)
const COD = 157704
const r3 = (n) => Math.round(Number(n) * 1000) / 1000

// ===========================================================================
// Base simulada (lo que usan np-servidor, ajuste-servidor, z1-servidor y edicion-servidor)
// ===========================================================================

function baseFalsa(tablas) {
  const db = JSON.parse(JSON.stringify(tablas))
  class Q {
    constructor(t) { this.t = t; this.f = []; this.op = "select"; this.vals = null; this.uno = false; this.devolver = false }
    select() { if (this.op !== "select") this.devolver = true; return this }
    eq(c, v) { const [a, b] = c.split("->>"); this.f.push((r) => (b ? r[a]?.[b] : r[c]) === v); return this }
    neq(c, v) { this.f.push((r) => r[c] !== v); return this }
    in(c, vs) { this.f.push((r) => vs.includes(r[c])); return this }
    is(c, v) { this.f.push((r) => (r[c] ?? null) === v); return this }
    not(c, op, v) {
      if (op === "in") { const vs = String(v).replace(/[()]/g, "").split(","); this.f.push((r) => !vs.includes(r[c])); return this }
      this.f.push((r) => (r[c] ?? null) !== v); return this
    }
    gte(c, v) { this.f.push((r) => String(r[c]) >= v); return this }
    lt(c, v) { this.f.push((r) => String(r[c]) < v); return this }
    or(expr) {
      const conds = String(expr).split(/,(?![^(]*\))/).map((x) => { const [c, ...resto] = x.split("."); const neg = resto[0] === "not"; const [op, ...v] = neg ? resto.slice(1) : resto; return { c, op, neg, v: v.join(".") } })
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
          if (["zomatik_np", "zomatik_np_ajustes"].includes(this.t) && filas.some((r) => r.marca === v.marca)) return { data: null, error: { code: "23505", message: "duplicate" } }
          if (this.t === "integraciones" && filas.some((r) => r.clave === v.clave)) return { data: null, error: { code: "23505", message: "duplicate" } }
          const abierta = (r) => ["pendiente", "generando", "revisar", "error"].includes(r.estado)
          if (this.t === "zomatik_np_ajustes" && v.origen === "pedido" && filas.some((r) => r.origen === "pedido" && r.np_id === v.np_id && abierta(r) && abierta(v))) return { data: null, error: { code: "23505", message: "duplicate" } }
          const base = this.t === "zomatik_np_ajustes"
            ? { id: `ed-${filas.length + 1}`, intentos: 0, paso: null, mensaje: null, aplicado_at: null, con_factura: null, factura_texto: null, en_curso_desde: null, aviso_juan_at: null, origen: "finalizar" }
            : { id: `${this.t}-${filas.length + 1}` }
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
        const tocadas = filas.filter(pasa)
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
  function saldoFalso(np) {
    const deNp = db.zomatik_np_uso.filter((u) => u.np_id === np.id)
    const peds = new Set(deNp.map((u) => u.scheduled_dispatch_id).filter(Boolean))
    const usos = db.zomatik_np_uso.filter((u) => u.np_id === np.id || peds.has(u.scheduled_dispatch_id)).map((u) => {
      const p = db.scheduled_dispatches.find((x) => x.id === u.scheduled_dispatch_id)
      return { ...u, pedido: p ? { id: p.id, status: p.status, dispatched_m3: p.dispatched_m3 || 0 } : null }
    })
    return N.saldoNp({ id: np.id, m3: np.m3 }, usos)
  }
  const ahora = () => new Date().toISOString()
  const rpcs = {
    zomatik_robot_tomar: () => true,
    zomatik_robot_soltar: () => null,
    remito_tipo_para: () => ({ tipo: "R" }),
    // Como la función SQL de la migración 202611061200
    zomatik_ajuste_tomar: ({ p_id, p_desde }) => {
      const r = db.zomatik_np_ajustes.find((x) => x.id === p_id)
      const colgada = r?.estado === "generando" && Date.now() - Date.parse(r.en_curso_desde) > 3 * 60_000
      if (!r || !(p_desde.includes(r.estado) || colgada)) return []
      const antes = { ajuste_id: r.id, estado_anterior: r.estado, paso_anterior: r.paso }
      Object.assign(r, { estado: "generando", en_curso_desde: ahora(), intentos: (r.intentos || 0) + 1 })
      return [antes]
    },
    // Como la función SQL de la migración 202611181400: la NP y la reserva juntas, sin cerrar el saldo
    zomatik_np_edicion_aplicar: ({ p_id, p_m3_objetivo = null, p_m3_uso = null }) => {
      db.llamadas_aplicar = (db.llamadas_aplicar || 0) + 1
      const a = db.zomatik_np_ajustes.find((x) => x.id === p_id)
      if (!a) return { error: "La edición no existe." }
      if (a.origen !== "pedido") return { error: "No es una edición de la NP por un cambio del pedido." }
      if (a.aplicado_at) { if (a.estado === "generando") Object.assign(a, { estado: "ok", paso: "ok" }); return { ok: true, ya: true } }
      if (a.estado !== "generando") return { error: "La edición cambió mientras se trabajaba." }
      if (db.falla_aplicar) return { error: "falló la base" }
      if ((p_m3_objetivo !== null && Math.abs(a.m3_objetivo - p_m3_objetivo) > 0.001) || (p_m3_uso !== null && Math.abs(a.m3_uso_objetivo - p_m3_uso) > 0.001)) return { error: "La edición cambió mientras se trabajaba." }
      if (a.m3_uso_objetivo > a.m3_objetivo + 0.001) return { error: "La reserva del pedido no entra en la NP." }
      const np = db.zomatik_np.find((x) => x.id === a.np_id)
      np.m3_original ??= np.m3
      np.m3 = a.m3_objetivo // saldo_desde no se toca
      for (const u of db.zomatik_np_uso.filter((u) => u.np_id === a.np_id && u.scheduled_dispatch_id === a.scheduled_dispatch_id && u.activo)) u.m3 = a.m3_uso_objetivo
      Object.assign(a, { estado: "ok", paso: "ok", aplicado_at: ahora(), ok_at: ahora(), en_curso_desde: null, proximo_intento: null, mensaje: null })
      return { ok: true }
    },
    // Como las de la migración 202610231000 (sincronizarPedido)
    zomatik_np_reservar: ({ p_np, p_pedido, p_m3 }) => {
      const np = db.zomatik_np.find((x) => x.id === p_np)
      if (!np || ["anulada", "vaciar", "vaciando", "vaciada"].includes(np.estado)) return 0
      const uso = db.zomatik_np_uso.find((u) => u.np_id === p_np && u.scheduled_dispatch_id === p_pedido && u.activo)
      const libre = saldoFalso(np).libre
      if (uso) {
        uso.m3 = r3(Math.max(0, p_m3 <= uso.m3 ? p_m3 : Math.min(p_m3, uso.m3 + Math.max(libre, 0))))
        return uso.m3
      }
      return 0
    },
    zomatik_np_crear_con_uso: ({ p }) => {
      if (db.zomatik_np.some((x) => x.marca === p.marca || (x.scheduled_dispatch_id === p.scheduled_dispatch_id && x.n === p.n))) return null
      const id = `np-${db.zomatik_np.length + 1}`
      db.zomatik_np.push({ id, intentos: 0, paso: null, mensaje: null, numero: null, zomatik_codigo: null, sucursal: null, disponible_m3: null, en_curso_desde: null, saldo_decision: null, saldo_desde: null, estado: "pendiente", created_at: ahora(), updated_at: ahora(), ...p })
      db.zomatik_np_uso.push({ id: `uso-${db.zomatik_np_uso.length + 1}`, np_id: id, scheduled_dispatch_id: p.scheduled_dispatch_id, m3: p.m3, activo: true, motivo: null, despachado_fijo: null, created_at: new Date(Date.now() + db.zomatik_np_uso.length).toISOString() })
      return id
    },
    zomatik_np_desvincular: ({ p_uso, p_motivo }) => {
      const u = db.zomatik_np_uso.find((x) => x.id === p_uso && x.activo)
      if (u) Object.assign(u, { activo: false, motivo: p_motivo, despachado_fijo: 0 })
      return null
    },
    // Como zomatik_remito_crear (Z1): la marca no se repite y un despacho no entra en dos remitos
    zomatik_remito_crear: ({ p: x }) => {
      if (db.zomatik_remitos.some((r) => r.marca === x.marca) || x.despachos.some((d) => db.zomatik_remito_despachos.some((l) => l.dispatch_id === d.id))) return null
      const id = `rem-${db.zomatik_remitos.length + 1}`
      db.zomatik_remitos.push({ id, ...x, despachos: undefined, estado: "pendiente", remito_estado: "pendiente", paso: null })
      for (const d of x.despachos) db.zomatik_remito_despachos.push({ remito_id: id, dispatch_id: d.id, m3: d.m3 })
      return id
    },
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

const NP1 = {
  id: "np1", scheduled_dispatch_id: PED, n: 1, marca: MARCA_NP, tipo: "nueva", es_adicional: false, proyecto_codigo: null, plant_id: CAN, client_id: "c1", formula_id: "f1",
  fecha: "2026-11-18", m3: 8, estado: "ok", paso: "autorizada", mensaje: null, numero: "NP 0001-00001176", zomatik_codigo: COD, sucursal: "18", disponible_m3: null, intentos: 0,
  proximo_intento: null, en_curso_desde: null, created_at: "2026-11-16T12:00:00.000Z", updated_at: "2026-11-16T12:00:00.000Z", saldo_decision: null, saldo_desde: null,
}

/** Cordones: pedido de La Tercera programado el 16/11 por 8 m³ con su NP en Zomatik; ahora pide `m3`. */
function cordones({ m3 = 9, np = {}, uso = 8, config = {}, pedido = {}, extra = {} } = {}) {
  return baseFalsa({
    plants: [{ id: CAN, name: "Canning" }],
    zomatik_np_config: [{ plant_id: CAN, activo: true, desde: "2026-10-01T00:00:00.000Z", deposito: 116, exigir_np: "aviso", aviso_hasta: "2026-11-06", editar_activo: true, remitir_activo: false, remitir_desde: null, ajustar_activo: false, ajustar_desde: null, ...config }],
    scheduled_dispatches: [{
      id: PED, status: "scheduled", quantity_m3: m3, plant_id: CAN, client_id: "c1", construction_site_id: "o1", formula_id: "f1", scheduled_arrival_time: "2026-11-18T11:00:00.000Z",
      created_at: "2026-11-16T12:00:00.000Z", created_by: "Titan Concretus", dispatched_m3: 0, clients: { name: "LA TERCERA" }, construction_sites: { name: "CORDONES", address: null, localidad: "CANNING" }, ...pedido,
    }],
    clients: [{ id: "c1", name: "LA TERCERA", zomatik_codigo: 15893 }],
    formulas: [{ id: "f1", code: "H21", zomatik_articulo_codigo: 10090020, zomatik_articulo_nombre: "H21-620-10 C (CAN)" }],
    zomatik_articulos: [{ codigo: 10090020, nombre: "H21-620-10 C (CAN)", codigo_sistema: 1000015959 }],
    zomatik_np: [{ ...NP1, ...np }],
    zomatik_np_uso: [{ id: "u1", np_id: "np1", scheduled_dispatch_id: PED, m3: uso, activo: true, motivo: null, despachado_fijo: null, created_at: "2026-11-16T12:00:00.000Z" }],
    zomatik_np_ajustes: [], zomatik_np_pedido: [], zomatik_np_excepciones: [], zomatik_vendedores: [], zomatik_proyectos: [],
    zomatik_remitos: [], zomatik_remito_despachos: [], dispatches: [], construction_sites: [{ id: "o1" }], app_users: [], activity_log: [], integraciones: [],
    ...extra,
  })
}

// ===========================================================================
// Zomatik simulado (la NP 157704) y el robot
// ===========================================================================

function navFalso(rutas) {
  const nav = {
    suc: "18",
    llamadas: [],
    async sucursal(id) { nav.llamadas.push({ m: "SUC", ruta: id }); nav.suc = id; return true },
    async get(ruta) { return responder("GET", ruta, null) },
    async post(ruta, cuerpo) { return responder("POST", ruta, cuerpo ? latin1(cuerpo) : "") },
  }
  async function responder(m, ruta, cuerpo) {
    nav.llamadas.push({ m, ruta, cuerpo })
    // Solo la lista cerrada del ajuste (atada a ESTA NP) o la lectura de siempre: nunca un link de acción
    assert.ok(W.rutaEscrituraAjuste(ruta, m, COD) || W.rutaPermitida(ruta, m), `ruta fuera de la lista cerrada: ${m} ${ruta}`)
    assert.doesNotMatch(ruta, /(^|\/)(set_|borrar_|generar_|remitir_|_autorizar)/i)
    const r = rutas.find(([mm, re]) => mm === m && re.test(ruta))
    if (!r) throw new Error(`ruta no simulada: ${m} ${ruta}`)
    return r[2]({ ruta, cuerpo, suc: nav.suc, nav })
  }
  return nav
}
const PRECIO = 176500
const pesos = (n) => `$ ${Math.round(n).toLocaleString("de-DE")}`
const fila = (total, estado, autorizar) =>
  `<tr height="20"><td class="itemlistado"><a href="modificar_pedidos.php?codigo=${COD}">2026-11-18</a></td><td class="itemlistado"><a href="modificar_pedidos.php?codigo=${COD}">NP 0001-00001176</a></td><td class="itemlistado"><a href="modificar_pedidos.php?codigo=${COD}">LA TERCERA</a></td><td class="itemlistado" align="right"><a href="modificar_pedidos.php?codigo=${COD}">${total}</a></td><td class="itemlistado"><b>${estado}</b></td>${autorizar ? `<td><a href="javascript:Autorizar(${COD})"><img src="ok.png"></a></td>` : ""}</tr>`

/** Zomatik con la NP 157704 en `cant` m³. `graba`: qué hace el Grabar; `porAutorizarDespues`: la NP vuelve a "por autorizar". */
function zomatik({ cant = 8, marca = MARCA_NP, detalleFx = "detalle-np.html", graba, porAutorizarDespues = false } = {}) {
  const estado = { cant, grabados: [] }
  return {
    estado,
    rutas: [
      ["GET", /^modificar_pedidos\.php\?codigo=157704$/, () => resp(fxN("np-abierta.html").replaceAll("{{CODIGO}}", String(COD)).replace("{{OBS}}", marca).replace("{{NUMERO}}", "0001-00001176").replace("{{RENGLONES}}", ""))],
      ["GET", /^manage_pedidos\.php\?/, () => resp(fxA(detalleFx).replace("{{CANT}}", N.cantidadTexto(estado.cant) + (String(estado.cant).includes(".") ? "" : ".000")).replace("{{TOTAL}}", "x"))],
      ["POST", /^grabar_pedidos\.php\?codigo=157704$/, ({ cuerpo }) => {
        const pedida = Number(cuerpo.match(/name="cantidad5349424"\r\n\r\n([^\r]*)\r\n/)?.[1])
        estado.grabados.push({ cuerpo, pedida })
        if (graba) return graba(pedida, estado)
        estado.cant = pedida
        return resp("", 302, "listado_pedidos.php")
      }],
      ["GET", /^listado_pedidos\.php$/, () => resp(fxN("listado-buscador.html"))],
      ["POST", /^listado_pedidos\.php\?enviado=1$/, ({ suc }) => conSuc(suc, `<table>${fila(pesos(estado.cant * PRECIO), "PEN", porAutorizarDespues && estado.grabados.length > 0)}</table>`)],
      ["GET", /^_comprobantes\.php\?ftarget=pedidos&ftargetid=157704(&rnd=\d+)?$/, () => resp(fxA("comprobantes-sin-nada.html"))],
    ],
  }
}

/** Las dependencias del robot: el `ajustarCantidadNp` de verdad con el navegador simulado; los mails, anotados. */
function robot(z) {
  const h = { navegador: [], errores: [] }
  const nav = navFalso(z.rutas)
  return {
    h, nav,
    dep: {
      navegador: async (llave, codigo) => (h.navegador.push([llave, codigo]), nav),
      robot: { ajustarCantidadNp: (n, d, o) => R.ajustarCantidadNp(n, d, { ...o, azar: () => 7, boundary: "XX" }) },
      avisarError: async (_s, t, l) => (h.errores.push([t, l]), { enviado: true }),
    },
  }
}
const grabar = (nav) => nav.llamadas.filter((l) => l.m === "POST" && /^grabar_/.test(l.ruta))
const edicionesDe = (sb) => sb.db.zomatik_np_ajustes.filter((x) => x.origen === "pedido")
const vencer = (sb) => edicionesDe(sb).forEach((x) => { if (x.estado === "pendiente") x.proximo_intento = new Date(Date.now() - 1000).toISOString() })
const procesar = (sb, f, extra = {}) => E.procesarEdiciones({ usuario: "sistema (pasada de NP)", inicio: Date.now(), sb, dep: f.dep, ...extra })
const que = (sb) => sb.db.activity_log.map((x) => x.details?.["Qué pasó"]).filter(Boolean)
/** Guardar el pedido (sincronizar) y esperar los 2 min. */
async function cambiar(sb) {
  await S.sincronizarPedido(PED, "Titan Concretus", null, sb)
  vencer(sb)
}
/** Una edición puesta a mano en la base (para los cortes). */
const filaEd = (extra = {}) => ({
  id: "ed-x", np_id: "np1", scheduled_dispatch_id: PED, plant_id: CAN, marca: A.marcaEdicion(PED, { numero: "NP 0001-00001176" }, 1), origen: "pedido", tipo: "editar",
  m3_np: 8, m3_objetivo: 9, m3_uso_objetivo: 9, m3_despachado: 0, con_factura: null, factura_texto: null, estado: "pendiente", paso: null, mensaje: null, intentos: 0,
  proximo_intento: new Date(Date.now() - 1000).toISOString(), en_curso_desde: null, aplicado_at: null, aviso_juan_at: null, created_at: "2026-11-18T10:00:00.000Z", updated_at: "2026-11-18T10:00:00.000Z", ...extra,
})
const colgada = () => new Date(Date.now() - 5 * 60_000).toISOString()

// ===========================================================================
// Pruebas
// ===========================================================================

test("Cordones 8 → 9: la MISMA NP pasa a 9 en Zomatik (cantidad 9, el costo leído sin tocar), NP 9 (original 8), reserva 9, sin NP adicional", async () => {
  const sb = cordones()
  const z = zomatik()
  const f = robot(z)
  await cambiar(sb)
  // antes de los 2 min la pasada no la toma
  edicionesDe(sb)[0].proximo_intento = new Date(Date.now() + 60_000).toISOString()
  assert.deepEqual((await procesar(sb, f)).hechas, [])
  vencer(sb)
  const r = await procesar(sb, f)
  assert.deepEqual(r.hechas.map((x) => x.estado), ["ok"], JSON.stringify(r))
  assert.deepEqual(f.h.navegador, [[{ ajustar: true, plantId: CAN }, COD]]) // la llave de la edición, atada a ESTA NP
  const g = grabar(f.nav)
  assert.equal(g.length, 1)
  assert.equal(g[0].ruta, "grabar_pedidos.php?codigo=157704")
  assert.match(g[0].cuerpo, /name="cantidad5349424"\r\n\r\n9\r\n/)
  assert.match(g[0].cuerpo, /name="costo5349424"\r\n\r\n176500\.000\r\n/)
  assert.match(g[0].cuerpo, /name="fparam"\r\n\r\n5349424,176500\.000,9,\|\|\|\r\n/)
  const np = sb.db.zomatik_np.find((x) => x.id === "np1")
  assert.deepEqual([np.m3, np.m3_original], [9, 8])
  assert.equal(sb.db.zomatik_np_uso[0].m3, 9)
  const [e] = edicionesDe(sb)
  assert.deepEqual([e.estado, e.tipo, e.m3_np, e.m3_objetivo, e.m3_uso_objetivo, e.con_factura], ["ok", "editar", 8, 9, 9, false])
  assert.ok(que(sb).includes("NP editada en Zomatik: NP 0001-00001176 8 → 9 m³ (el pedido pasó a 9)"), JSON.stringify(que(sb)))
  assert.equal(sb.db.zomatik_np.length, 1) // sin NP adicional (también después de volver a sincronizar)
  assert.equal(f.h.errores.length, 0)
  // otra pasada: nada más que hacer
  await S.sincronizarPedido(PED, "sistema", null, sb)
  assert.deepEqual([sb.db.zomatik_np.length, edicionesDe(sb).length], [1, 1])
})

test("8 → 9 → 10 en un minuto: una sola edición, a 10", async () => {
  const sb = cordones()
  await S.sincronizarPedido(PED, "Titan", null, sb)
  sb.db.scheduled_dispatches[0].quantity_m3 = 10
  await cambiar(sb)
  const z = zomatik()
  const f = robot(z)
  await procesar(sb, f)
  assert.deepEqual(z.estado.grabados.map((x) => x.pedida), [10])
  assert.deepEqual([sb.db.zomatik_np[0].m3, sb.db.zomatik_np_uso[0].m3, edicionesDe(sb).length], [10, 10, 1])
})

test("achica 9 → 6 sin despachos: la NP queda en 6 (sin saldo); con 7 despachados: en 7", async () => {
  for (const [desp, queda] of [[0, 6], [7, 7]]) {
    const sb = cordones({ m3: 6, np: { m3: 9 }, uso: 9, pedido: { dispatched_m3: desp } })
    const z = zomatik({ cant: 9 })
    const f = robot(z)
    await cambiar(sb)
    await procesar(sb, f)
    assert.deepEqual([z.estado.cant, sb.db.zomatik_np[0].m3, sb.db.zomatik_np_uso[0].m3], [queda, queda, 6])
    // no queda libre: no va a "NP con saldo"
    assert.equal((await S.saldosDe(sb, [sb.db.zomatik_np[0]])).get("np1").libre, 0)
  }
})

test("con factura y crece: no se toca; 'nada' (adicional) y la NP adicional por 1, como hoy; sin mail", async () => {
  const sb = cordones()
  const f = robot(zomatik({ detalleFx: "detalle-np-facturada.html" }))
  await cambiar(sb)
  await procesar(sb, f)
  assert.equal(grabar(f.nav).length, 0)
  const [e] = edicionesDe(sb)
  assert.deepEqual([e.estado, e.tipo, e.con_factura], ["nada", "adicional", true])
  assert.match(e.mensaje, /va una NP adicional por 1 m³/)
  const adicional = sb.db.zomatik_np.find((x) => x.id !== "np1")
  assert.deepEqual([adicional.m3, adicional.es_adicional, adicional.estado], [1, true, "pendiente"])
  assert.deepEqual([sb.db.zomatik_np[0].m3, sb.db.zomatik_np_uso[0].m3], [8, 8])
  assert.equal(f.h.errores.length, 0)
  // la NP ya no es editable: otro cambio no crea otra edición
  sb.db.scheduled_dispatches[0].quantity_m3 = 10
  await S.sincronizarPedido(PED, "Titan", null, sb)
  assert.equal(edicionesDe(sb).length, 1)
})

test("con factura y achica: no se toca; 'nada' (devol), la reserva baja a 6 y quedan 3 de saldo; sin mail (el de Juan, al finalizar)", async () => {
  const sb = cordones({ m3: 6, np: { m3: 9 }, uso: 9 })
  const f = robot(zomatik({ cant: 9, detalleFx: "detalle-np-facturada.html" }))
  await cambiar(sb)
  await procesar(sb, f)
  const [e] = edicionesDe(sb)
  assert.deepEqual([e.estado, e.tipo, e.con_factura, e.mensaje], ["nada", "devol", true, "Tiene factura: se ajusta al terminar."])
  assert.deepEqual([sb.db.zomatik_np[0].m3, sb.db.zomatik_np_uso[0].m3, sb.db.zomatik_np.length], [9, 6, 1])
  assert.equal(f.h.errores.length, 0)
})

test("Zomatik rechaza el Grabar sin hablar de factura: NP adicional automática y UN mail a Bautista con el texto de Zomatik", async () => {
  const sb = cordones()
  const f = robot(zomatik({ graba: () => resp(fxA("grabar-rechazo-remitido.html")) }))
  await cambiar(sb)
  await procesar(sb, f)
  const [e] = edicionesDe(sb)
  assert.deepEqual([e.estado, e.tipo, e.con_factura], ["nada", "adicional", false])
  assert.equal(sb.db.zomatik_np.filter((x) => x.es_adicional).length, 1)
  assert.equal(f.h.errores.length, 1)
  assert.match(f.h.errores[0][0], /Zomatik no dejó cambiar la NP/)
  assert.ok(f.h.errores[0][1].some((l) => /menor a la cantidad remitida/.test(l)))
})

test("corte en el Grabar: la NP ya en 9 → ok sin grabar de nuevo; corte en 'aplicar' → solo la base (no se abre Zomatik)", async () => {
  const sb = cordones()
  sb.db.zomatik_np_ajustes.push(filaEd({ estado: "generando", paso: "grabar_np", en_curso_desde: colgada(), intentos: 1 }))
  const f = robot(zomatik({ cant: 9 }))
  await procesar(sb, f)
  assert.equal(grabar(f.nav).length, 0)
  assert.deepEqual([edicionesDe(sb)[0].estado, sb.db.zomatik_np[0].m3, sb.db.zomatik_np_uso[0].m3], ["ok", 9, 9])
  // colgada en "aplicar" (Zomatik ya está): solo la base
  const b = cordones()
  b.db.zomatik_np_ajustes.push(filaEd({ estado: "generando", paso: "aplicar", en_curso_desde: colgada(), intentos: 1 }))
  const g = robot(zomatik({ cant: 9 }))
  await procesar(b, g)
  assert.equal(g.h.navegador.length, 0)
  assert.deepEqual([edicionesDe(b)[0].estado, b.db.zomatik_np[0].m3, b.db.zomatik_np_uso[0].m3], ["ok", 9, 9])
  // si falla la base al aplicar, queda "generando" en "aplicar" y el reintento solo repite eso
  const c = cordones()
  c.db.falla_aplicar = true
  const h = robot(zomatik())
  await cambiar(c)
  await procesar(c, h)
  assert.deepEqual([edicionesDe(c)[0].estado, edicionesDe(c)[0].paso, c.db.zomatik_np[0].m3], ["generando", "aplicar", 8])
})

test("sin la marca del sistema o con la cantidad tocada a mano en Zomatik → revisar sin grabar, un mail; el pedido NO saca adicional", async () => {
  for (const z of [zomatik({ marca: "Cargada a mano" }), zomatik({ cant: 7.5 })]) {
    const sb = cordones()
    const f = robot(z)
    await cambiar(sb)
    await procesar(sb, f)
    assert.equal(grabar(f.nav).length, 0)
    assert.equal(edicionesDe(sb)[0].estado, "revisar")
    assert.equal(f.h.errores.length, 1)
    await S.sincronizarPedido(PED, "sistema", null, sb)
    assert.equal(sb.db.zomatik_np.length, 1) // pudo haber quedado cambiada: no se hace adicional
  }
})

test("después de editarla la NP vuelve a 'por autorizar' → paso sin_autorizar (la autoriza la pasada de siempre)", async () => {
  const sb = cordones()
  const f = robot(zomatik({ porAutorizarDespues: true }))
  await cambiar(sb)
  await procesar(sb, f)
  assert.equal(edicionesDe(sb)[0].estado, "ok")
  assert.equal(sb.db.zomatik_np[0].paso, "sin_autorizar")
  // sin el ícono, sigue autorizada
  const b = cordones()
  await cambiar(b)
  await procesar(b, robot(zomatik()))
  assert.equal(b.db.zomatik_np[0].paso, "autorizada")
})

test("controlar: NP generando → espera; otra fila abierta de la NP (ajuste de otro pedido) → espera; sin abrir Zomatik", async () => {
  const sb = cordones({ np: { estado: "generando", zomatik_codigo: null, numero: null } })
  await cambiar(sb)
  const f = robot(zomatik())
  await procesar(sb, f)
  assert.deepEqual([edicionesDe(sb)[0].estado, edicionesDe(sb)[0].mensaje], ["pendiente", "Esperando que salga la NP."])
  assert.ok(Date.parse(edicionesDe(sb)[0].proximo_intento) > Date.now() + 9 * 60_000)
  const b = cordones()
  b.db.zomatik_np_ajustes.push({ ...filaEd({ id: "aj-otro", origen: "finalizar", scheduled_dispatch_id: OTRO, marca: "otro", estado: "revisar" }) })
  await cambiar(b)
  await procesar(b, f)
  assert.deepEqual([edicionesDe(b)[0].estado, edicionesDe(b)[0].mensaje], ["pendiente", "Esperando otro cambio de la NP."])
  assert.equal(f.h.navegador.length, 0)
})

test("controlar: pedido completo con el ajuste al finalizar prendido → anulado; cancelado → anulado; 3 cortes → revisar", async () => {
  const sb = cordones({ config: { remitir_activo: true, ajustar_activo: true } })
  await cambiar(sb)
  sb.db.scheduled_dispatches[0].status = "completed"
  const f = robot(zomatik())
  await procesar(sb, f)
  assert.deepEqual([edicionesDe(sb)[0].estado, edicionesDe(sb)[0].mensaje], ["anulado", "Lo deja justo el ajuste al finalizar."])
  const c = cordones()
  c.db.zomatik_np_ajustes.push(filaEd())
  c.db.scheduled_dispatches[0].status = "cancelled"
  await procesar(c, f)
  assert.equal(edicionesDe(c)[0].estado, "anulado")
  const t = cordones()
  t.db.zomatik_np_ajustes.push(filaEd({ estado: "generando", paso: "leer_np", en_curso_desde: colgada(), intentos: 3 }))
  const g = robot(zomatik())
  await procesar(t, g)
  assert.equal(edicionesDe(t)[0].estado, "revisar")
  assert.equal(g.h.errores.length, 1)
  assert.equal(f.h.navegador.length + g.h.navegador.length, 0)
})

test("la NP dejó de ser editable (factura conocida por el ajuste) → anulado y se sincroniza (sale la adicional)", async () => {
  const sb = cordones()
  await cambiar(sb)
  sb.db.zomatik_np_ajustes.push({ ...filaEd({ id: "aj-f", origen: "finalizar", scheduled_dispatch_id: OTRO, marca: "f", estado: "a_mano", con_factura: true }) })
  const f = robot(zomatik())
  await procesar(sb, f)
  assert.equal(edicionesDe(sb)[0].estado, "anulado")
  assert.equal(sb.db.zomatik_np.filter((x) => x.es_adicional).length, 1)
  assert.equal(f.h.navegador.length, 0)
})

test("llave apagada: no se arma la llave, el navegador del ajuste rechaza antes de salir y el robot no toma nada", async () => {
  assert.equal(S.llaveEdicion({ id: CAN, zomatik_np_activo: true, editar_activo: false }), null)
  assert.equal(S.llaveEdicion({ id: CAN, zomatik_np_activo: false, editar_activo: true }), null)
  assert.deepEqual(S.llaveEdicion({ id: CAN, zomatik_np_activo: true, editar_activo: true }), { ajustar: true, plantId: CAN })
  const { navegadorAjuste } = await import("../zomatik/cliente.ts")
  await assert.rejects(navegadorAjuste(S.llaveEdicion({ id: CAN, zomatik_np_activo: true, editar_activo: false }), COD), /apagado/)
  const sb = cordones({ config: { editar_activo: false } })
  sb.db.zomatik_np_ajustes.push(filaEd())
  const f = robot(zomatik())
  assert.deepEqual(await procesar(sb, f), { hechas: [] })
  assert.equal(f.h.navegador.length, 0)
})

test("'Generar NP ahora' (manual): sin esperar los 2 min y también una en error", async () => {
  const sb = cordones()
  await S.sincronizarPedido(PED, "Titan", null, sb)
  const f = robot(zomatik())
  assert.deepEqual((await procesar(sb, f)).hechas, []) // la pasada espera
  const r = await procesar(sb, f, { pedidoId: PED, manual: true })
  assert.deepEqual(r.hechas.map((x) => x.estado), ["ok"])
  const b = cordones()
  b.db.zomatik_np_ajustes.push(filaEd({ estado: "error", paso: "leer_np", mensaje: "formato", proximo_intento: null }))
  const g = robot(zomatik())
  assert.deepEqual((await procesar(b, g)).hechas, [])
  assert.deepEqual((await procesar(b, g, { pedidoId: PED, manual: true })).hechas.map((x) => x.estado), ["ok"])
})

test("gerencial: 'Reintentar cambio de NP' vuelve a pendiente; 'Dejar la NP como está' → a_mano y sale la NP adicional", async () => {
  const sb = cordones()
  sb.db.zomatik_np_ajustes.push(filaEd({ estado: "revisar", paso: "leer_np", mensaje: "La NP cambió en Zomatik", proximo_intento: null }))
  assert.deepEqual(await E.resolverEdicion({ pedidoId: PED, edicionId: "ed-x", decision: "reintentar", usuario: "Juan Oreguy" }, sb), { ok: true })
  assert.equal(edicionesDe(sb)[0].estado, "pendiente")
  assert.equal((await E.resolverEdicion({ pedidoId: PED, edicionId: "ed-x", decision: "dejar", usuario: "Juan Oreguy", motivo: "la miré" }, sb)).ok, false) // ya no está trabada
  edicionesDe(sb)[0].estado = "error"
  assert.deepEqual(await E.resolverEdicion({ pedidoId: PED, edicionId: "ed-x", decision: "dejar", usuario: "Juan Oreguy", motivo: "La revisé: queda en 8" }, sb), { ok: true })
  const [e] = edicionesDe(sb)
  assert.deepEqual([e.estado, e.tipo, e.resuelto_por, e.resuelto_motivo], ["a_mano", "adicional", "Juan Oreguy", "La revisé: queda en 8"])
  assert.deepEqual(sb.db.zomatik_np.filter((x) => x.es_adicional).map((x) => x.m3), [1])
  assert.ok(que(sb).includes("Dejar la NP como está (no se cambia en Zomatik)"))
})

test("despacho que había quedado afuera del remito: al aplicar la edición se vuelve a armar (Z1 prendido, el pedido ya remitía)", async () => {
  const hoy = N.hoyAR()
  const sb = cordones({ config: { remitir_activo: true }, pedido: { dispatched_m3: 9 } })
  const viaje = (id, m3, h) => ({ id, scheduled_dispatch_id: PED, quantity_m3: m3, remito: id, remito_tipo: "R", formula_id: "f1", plant_id: CAN, created_at: `${hoy}T${h}:00:00.000Z`, dispatch_date: `${hoy}T${h}:00:00.000Z`, is_test_dispatch: false, mixers: { license_plate: "AB1" } })
  // Un remito de otro día ya armado (el pedido ya remitía) y el camión de 9 de hoy que no entraba en la NP de 8
  sb.db.zomatik_remitos.push({ id: "rem-0", tipo: "pedido", scheduled_dispatch_id: PED, np_id: "np1", fecha: "2026-11-17", m3: 0, marca: "viejo", estado: "ok", remito_estado: "ok", paso: "ok" })
  sb.db.dispatches.push(viaje("3401", 9, "12"))
  const { prepararRemitos } = await import("../zomatik/z1-servidor.ts")
  const antes = await prepararRemitos(PED, null, "test", sb)
  assert.equal(antes.creados, 0)
  sb.db.zomatik_np_ajustes.push(filaEd({ estado: "pendiente", paso: null, proximo_intento: new Date(Date.now() + 60_000).toISOString() }))
  const conEd = await prepararRemitos(PED, null, "test", sb)
  assert.match(conEd.problemas[0], /Esperando que la NP pase a 9 m³ en Zomatik\.$/)
  vencer(sb)
  await procesar(sb, robot(zomatik()))
  assert.equal(edicionesDe(sb)[0].estado, "ok")
  const rm = sb.db.zomatik_remitos.filter((x) => x.id !== "rem-0")
  assert.deepEqual(rm.map((x) => [x.np_id, x.m3]), [["np1", 9]]) // un remito, contra la misma NP
})

test("import circular: edicion-servidor primero (en otro proceso, con los módulos sin cargar) no falla", async () => {
  const { spawnSync } = await import("node:child_process")
  const raiz = new URL("../../", import.meta.url).pathname
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "--import", "./lib/__tests__/alias.mjs", "--input-type=module", "-e",
    'const e = await import("./lib/zomatik/edicion-servidor.ts"); const z = await import("./lib/zomatik/z1-servidor.ts"); if (!e.DEPENDENCIAS_EDICION || !z.DEPENDENCIAS_Z1) process.exit(2); console.log("ok")'], { cwd: raiz, encoding: "utf8" })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /ok/)
})

// ── Observaciones del revisor (B1, B2, I1 y menores) ──

/** El pedido cambia (9 → 10) justo entre que la pasada lista la edición y la toma. */
function cambiaEnElMedio(sb, m3) {
  const rpc = sb.rpc
  let una = true
  sb.rpc = async (n, a) => {
    if (n === "zomatik_ajuste_tomar" && una) {
      una = false
      sb.db.scheduled_dispatches[0].quantity_m3 = m3
      await S.sincronizarPedido(PED, "Titan Concretus", null, sb)
    }
    return rpc(n, a)
  }
}

test("B1: el pedido pasa a 10 en medio de la pasada → la pasada la suelta sin tocar Zomatik ni sumar intento; después, una sola edición a 10 (NP 10, reserva 10)", async () => {
  const sb = cordones()
  await cambiar(sb) // edición a 9, vencida
  cambiaEnElMedio(sb, 10)
  const z = zomatik()
  const f = robot(z)
  const r = await procesar(sb, f)
  assert.deepEqual(r.hechas.map((x) => x.estado), ["esperando"])
  assert.equal(f.h.navegador.length, 0)
  const [e] = edicionesDe(sb)
  assert.deepEqual([e.estado, e.m3_objetivo, e.m3_uso_objetivo, e.intentos], ["pendiente", 10, 10, 0])
  assert.ok(Date.parse(e.proximo_intento) > Date.now() + 60_000) // la espera de 2 min vuelve a correr
  vencer(sb)
  await procesar(sb, f)
  assert.deepEqual(z.estado.grabados.map((x) => x.pedida), [10])
  assert.deepEqual([sb.db.zomatik_np[0].m3, sb.db.zomatik_np_uso[0].m3, edicionesDe(sb).length], [10, 10, 1])
})

test("B1: con 'Generar NP ahora' (manual) y el cambio en el medio, se trabaja con lo releído: 10 en Zomatik y en la base", async () => {
  const sb = cordones()
  await cambiar(sb)
  cambiaEnElMedio(sb, 10)
  const z = zomatik()
  await procesar(sb, robot(z), { pedidoId: PED, manual: true })
  assert.deepEqual(z.estado.grabados.map((x) => x.pedida), [10])
  const [e] = edicionesDe(sb)
  assert.deepEqual([e.estado, e.m3_objetivo, e.m3_uso_objetivo], ["ok", 10, 10])
  assert.deepEqual([sb.db.zomatik_np[0].m3, sb.db.zomatik_np_uso[0].m3], [10, 10])
})

test("B1: si la fila no dice lo que se grabó en Zomatik, la base no aplica nada (nunca NP 9 con reserva 10)", async () => {
  const sb = cordones()
  await cambiar(sb)
  const f = robot(zomatik())
  const ajustar = f.dep.robot.ajustarCantidadNp
  // alguien cambia la reserva de la fila después del Grabar (no hay camino en el código: es el control de la base)
  f.dep.robot.ajustarCantidadNp = async (n, d, o) => {
    const r = await ajustar(n, d, o)
    edicionesDe(sb)[0].m3_uso_objetivo = 10
    return r
  }
  await procesar(sb, f)
  const [e] = edicionesDe(sb)
  assert.deepEqual([e.estado, e.paso], ["generando", "aplicar"])
  assert.deepEqual([sb.db.zomatik_np[0].m3, sb.db.zomatik_np_uso[0].m3], [8, 8])
  // y la base nunca deja una reserva más grande que la NP
  e.m3_uso_objetivo = 10
  e.m3_objetivo = 9
  assert.deepEqual((await sb.rpc("zomatik_np_edicion_aplicar", { p_id: e.id })).data, { error: "La reserva del pedido no entra en la NP." })
})

test("B2: 'el total no cerró' → la edición queda 'revisar' con un mensaje SIN montos; los totales, en Actividad y en el mail", async () => {
  const sb = cordones()
  const z = zomatik()
  const rutas = z.rutas.map((r) => (r[1].source.includes("enviado") ? [r[0], r[1], ({ suc }) => conSuc(suc, `<table>${fila(z.estado.grabados.length ? "$ 1.500.000" : pesos(8 * PRECIO), "PEN", false)}</table>`)] : r))
  const f = robot({ ...z, rutas })
  await cambiar(sb)
  await procesar(sb, f)
  const [e] = edicionesDe(sb)
  assert.equal(e.estado, "revisar")
  assert.equal(e.mensaje, "Zomatik grabó la NP en 9 m³ pero el total no cerró: revisala.")
  assert.doesNotMatch(e.mensaje, /\$/)
  const act = sb.db.activity_log.find((x) => x.details?.["Qué pasó"] === "El cambio de la NP no salió")
  assert.deepEqual([act.details["Total antes"], act.details["Total después"]], ["$ 1.412.000", "$ 1.500.000"])
  assert.ok(f.h.errores[0][1].includes("Total después: $ 1.500.000"))
})

test("esperas (NP generando u otro cambio): no suman intentos y, pasada 1 hora, un aviso a Bautista (uno solo)", async () => {
  const sb = cordones({ np: { estado: "generando", zomatik_codigo: null, numero: null } })
  await cambiar(sb)
  const f = robot(zomatik())
  for (let i = 0; i < 3; i++) {
    vencer(sb)
    await procesar(sb, f)
  }
  assert.deepEqual([edicionesDe(sb)[0].estado, edicionesDe(sb)[0].intentos], ["pendiente", 0])
  assert.equal(f.h.errores.length, 0)
  edicionesDe(sb)[0].created_at = new Date(Date.now() - 2 * 3600_000).toISOString()
  for (let i = 0; i < 2; i++) {
    vencer(sb)
    await procesar(sb, f)
  }
  assert.equal(f.h.errores.length, 1)
  assert.match(f.h.errores[0][0], /Cambio de la NP pendiente hace más de 1 hora/)
})

test("I1: con la llave de la edición apagada, 'Reintentar cambio de NP' no se acepta (queda 'Dejar la NP como está')", async () => {
  const sb = cordones({ config: { editar_activo: false } })
  sb.db.zomatik_np_ajustes.push(filaEd({ estado: "revisar", paso: "verificar_np", proximo_intento: null }))
  const r = await E.resolverEdicion({ pedidoId: PED, edicionId: "ed-x", decision: "reintentar", usuario: "Juan Oreguy" }, sb)
  assert.match(r.error, /apagada/)
  assert.deepEqual(await E.resolverEdicion({ pedidoId: PED, edicionId: "ed-x", decision: "dejar", usuario: "Juan Oreguy", motivo: "La revisé en Zomatik" }, sb), { ok: true })
  assert.equal(edicionesDe(sb)[0].estado, "a_mano")
})

test("zomatik_np_edicion_aplicar (como la función SQL): la NP y la reserva juntas, sin pisar saldo_desde", async () => {
  const sb = cordones({ np: { saldo_desde: "2026-11-17T10:00:00.000Z" } })
  sb.db.zomatik_np_ajustes.push(filaEd({ estado: "generando", paso: "aplicar" }))
  assert.deepEqual((await sb.rpc("zomatik_np_edicion_aplicar", { p_id: "ed-x", p_m3_objetivo: 9, p_m3_uso: 9 })).data, { ok: true })
  assert.deepEqual([sb.db.zomatik_np[0].m3, sb.db.zomatik_np[0].m3_original, sb.db.zomatik_np_uso[0].m3, sb.db.zomatik_np[0].saldo_desde], [9, 8, 9, "2026-11-17T10:00:00.000Z"])
})
