// Pruebas de "¿No está? Actualizar desde Zomatik" (lib/zomatik/actualizar-copia.ts): el candado de 2 min por tipo en
// `integraciones`, el turno del robot y el grabado de la copia con el mismo upsert de la lectura nocturna. Con una
// base SIMULADA en memoria y lecturas de Zomatik simuladas: sin red, sin Zomatik, sin la base real.
import { test } from "node:test"
import assert from "node:assert/strict"
import * as C from "../zomatik/actualizar-copia.ts"

/** Lo justo del cliente de Supabase: insert (clave única en integraciones), update/select/delete con eq y lt, upsert, rpc. */
function baseFalsa(tablas = {}, { rpcs = {}, fallaUpsert } = {}) {
  const db = JSON.parse(JSON.stringify(tablas))
  const llamadas = []
  class Q {
    constructor(t) { this.t = t; this.f = []; this.op = "select"; this.uno = false; this.devolver = false }
    select() { if (this.op !== "select") this.devolver = true; return this }
    eq(c, v) { this.f.push((r) => r[c] === v); return this }
    lt(c, v) { this.f.push((r) => Date.parse(r[c]) < Date.parse(v)); return this }
    gte(c, v) { this.f.push((r) => r[c] >= v); return this }
    not(c, op, v) { const vs = String(v).replace(/[()]/g, "").split(",").map(Number); this.f.push((r) => !vs.includes(Number(r[c]))); return this }
    limit() { return this }
    maybeSingle() { this.uno = true; return this }
    insert(v) { this.op = "insert"; this.vals = v; return this }
    update(v) { this.op = "update"; this.vals = v; return this }
    delete() { this.op = "delete"; return this }
    upsert(v, o) { this.op = "upsert"; this.vals = v; this.clave = o?.onConflict; return this }
    then(ok, mal) { return Promise.resolve(this.correr()).then(ok, mal) }
    correr() {
      const filas = (db[this.t] ||= [])
      const pasa = (r) => this.f.every((f) => f(r))
      llamadas.push({ t: this.t, op: this.op, vals: this.vals })
      if (this.op === "insert") {
        for (const v of [].concat(this.vals)) {
          if (this.t === "integraciones" && filas.some((r) => r.clave === v.clave)) return { data: null, error: { code: "23505", message: "duplicate" } }
          filas.push({ ...v })
        }
        return { data: null, error: null }
      }
      if (this.op === "upsert") {
        const e = fallaUpsert?.(this.t, this.vals)
        if (e) return { data: null, error: e }
        for (const v of [].concat(this.vals)) {
          const ks = String(this.clave).split(",")
          const ya = filas.find((r) => ks.every((k) => r[k] === v[k]))
          if (ya) Object.assign(ya, v)
          else filas.push({ ...v })
        }
        return { data: null, error: null }
      }
      if (this.op === "update") {
        const tocadas = filas.filter(pasa)
        for (const r of tocadas) Object.assign(r, this.vals)
        return { data: this.devolver ? tocadas.map((r) => ({ clave: r.clave })) : null, error: null }
      }
      if (this.op === "delete") {
        db[this.t] = filas.filter((r) => !pasa(r))
        return { data: null, error: null }
      }
      const r = filas.filter(pasa).map((x) => ({ ...x }))
      return { data: this.uno ? r[0] || null : r, error: null }
    }
  }
  const rpcsBase = {
    zomatik_robot_tomar: ({ p_quien }) => {
      const t = (db.integraciones ||= []).find((x) => x.clave === "zomatik_robot")
      if (t && t.conectado_por !== p_quien) return false
      if (!t) db.integraciones.push({ clave: "zomatik_robot", valor: "x", conectado_por: p_quien })
      return true
    },
    zomatik_robot_soltar: ({ p_quien }) => { db.integraciones = (db.integraciones || []).filter((x) => !(x.clave === "zomatik_robot" && x.conectado_por === p_quien)); return null },
    ...rpcs,
  }
  return {
    db,
    llamadas,
    from: (t) => new Q(t),
    rpc: (n, args) => {
      llamadas.push({ rpc: n, args })
      const f = rpcsBase[n]
      if (!f) return Promise.resolve({ data: null, error: { message: `function ${n} does not exist` } })
      return Promise.resolve({ data: f(args), error: null })
    },
  }
}

const CLI = (codigo, razon) => ({
  codigo, razon_social: razon, nombre_norm: razon.toUpperCase(), direccion: null, localidad: null, provincia: null, cp: null,
  telefono: null, email: null, vendedor: null, clasificacion: null, categoria: null, estado: "Activo", ultimo_pedido: null,
})
const ART = (codigo, nombre, codigo_sistema = `H${codigo}`) => ({ codigo, nombre, linea: "Hormigón", codigo_sistema })
const T0 = Date.parse("2026-11-16T15:00:00Z")

function deps(sb, o = {}) {
  let reloj = o.ahora ?? T0
  const leidas = { clientes: 0, articulos: 0, sesion: 0 }
  return {
    leidas,
    avanzar: (ms) => { reloj += ms },
    d: {
      sb,
      ahora: () => reloj,
      esperar: async (ms) => { reloj += ms },
      sesion: async () => { leidas.sesion++; if (o.fallaSesion) throw o.fallaSesion; return { cookie: "PHPSESSID=prueba" } },
      leerClientes: async () => { leidas.clientes++; return o.clientes ?? [CLI(1, "Uno"), CLI(2, "Pablo Fabián Regazzoni")] },
      leerArticulos: async () => { leidas.articulos++; return o.articulos ?? [ART(10, "H25 15 B"), ART(11, "H25-620-10 C (CAN)")] },
    },
  }
}

test("tipoDeCopia: solo clientes o articulos", () => {
  assert.equal(C.tipoDeCopia("clientes"), "clientes")
  assert.equal(C.tipoDeCopia("articulos"), "articulos")
  assert.equal(C.tipoDeCopia("proyectos"), null)
  assert.equal(C.tipoDeCopia(undefined), null)
})

test("clientes: lee, graba la copia con el upsert de la lectura y no toca los remitos del año", async () => {
  const sb = baseFalsa({ zomatik_clientes: [{ codigo: 1, razon_social: "Uno viejo", remitos_r_12m: 7, remitos_x_12m: 2, ultimo_remito: "2026-11-01" }] })
  const { d, leidas } = deps(sb)
  const r = await C.actualizarCopia("clientes", d)
  assert.deepEqual(r, { ok: true, reciente: false, cantidad: 2 })
  assert.equal(leidas.clientes, 1)
  assert.equal(leidas.articulos, 0)
  const uno = sb.db.zomatik_clientes.find((x) => x.codigo === 1)
  assert.equal(uno.razon_social, "Uno")
  assert.equal(uno.remitos_r_12m, 7, "sin leer los remitos no se pisan los R/X del año")
  assert.equal(uno.ultimo_remito, "2026-11-01")
  assert.ok(sb.db.zomatik_clientes.some((x) => x.codigo === 2), "el cliente nuevo queda en la copia")
  const up = sb.llamadas.find((x) => x.t === "zomatik_clientes" && x.op === "upsert")
  assert.ok(!("remitos_r_12m" in up.vals[0]))
  // Solo esa tabla: nada de proyectos, movimientos ni NP
  assert.deepEqual([...new Set(sb.llamadas.filter((x) => x.t && x.op !== "select").map((x) => x.t))].sort(), ["integraciones", "zomatik_clientes"])
  // Soltó el turno del robot y dejó el candado con la hora
  assert.ok(!sb.db.integraciones.some((x) => x.clave === "zomatik_robot"))
  assert.equal(sb.db.integraciones.find((x) => x.clave === "zomatik_copia_clientes").actualizado, new Date(T0).toISOString())
})

test("artículos: graba con codigo_sistema; sin la migración de Z2 graba como antes", async () => {
  const sb = baseFalsa()
  const r = await C.actualizarCopia("articulos", deps(sb).d)
  assert.equal(r.ok && !r.reciente && r.cantidad, 2)
  assert.equal(sb.db.zomatik_articulos.find((x) => x.codigo === 11).codigo_sistema, "H11")

  const sb2 = baseFalsa({}, { fallaUpsert: (t, v) => (t === "zomatik_articulos" && "codigo_sistema" in v[0] ? { message: 'column "codigo_sistema" does not exist' } : null) })
  const r2 = await C.actualizarCopia("articulos", deps(sb2).d)
  assert.equal(r2.ok, true)
  assert.ok(sb2.db.zomatik_articulos.every((x) => !("codigo_sistema" in x)))
})

test("límite: una vez cada 2 min por tipo; si se tocó hace poco no va a Zomatik", async () => {
  const sb = baseFalsa()
  const x = deps(sb)
  assert.equal((await C.actualizarCopia("clientes", x.d)).reciente, false)
  x.avanzar(60_000)
  const r = await C.actualizarCopia("clientes", x.d)
  assert.deepEqual(r, { ok: true, reciente: true, desde: new Date(T0).toISOString() })
  assert.equal(x.leidas.clientes, 1, "no volvió a leer")
  assert.equal(x.leidas.sesion, 1, "ni abrió sesión")
  // El otro tipo tiene su propio candado
  assert.equal((await C.actualizarCopia("articulos", x.d)).reciente, false)
  x.avanzar(61_000)
  const r3 = await C.actualizarCopia("clientes", x.d)
  assert.equal(r3.ok && r3.reciente, false, "pasados los 2 min vuelve a leer")
  assert.equal(x.leidas.clientes, 2)
})

test("candado: dos pedidos juntos, uno solo lo toma", async () => {
  const sb = baseFalsa({ integraciones: [{ clave: "zomatik_copia_clientes", valor: "v", actualizado: new Date(T0 - 10 * 60_000).toISOString() }] })
  const a = await C.tomarCandadoCopia(sb, "clientes", T0)
  const b = await C.tomarCandadoCopia(sb, "clientes", T0 + 5)
  assert.equal(a.ok, true)
  assert.equal(b.ok, false)
  assert.equal(b.desde, new Date(T0).toISOString())
})

test("robot ocupado: no va a Zomatik y suelta el candado para poder reintentar", async () => {
  const sb = baseFalsa({ integraciones: [{ clave: "zomatik_robot", valor: "x", conectado_por: "np·otro" }] })
  const x = deps(sb)
  const r = await C.actualizarCopia("clientes", x.d)
  assert.equal(r.ok, false)
  assert.match(r.error, /ocupado/)
  assert.equal(x.leidas.sesion, 0)
  assert.ok(!sb.db.integraciones.some((i) => i.clave === "zomatik_copia_clientes"), "soltó el candado")
  assert.ok(sb.db.integraciones.some((i) => i.clave === "zomatik_robot" && i.conectado_por === "np·otro"), "no tocó el turno ajeno")
  // Se libera el turno: ahora sí
  sb.db.integraciones = sb.db.integraciones.filter((i) => i.clave !== "zomatik_robot")
  assert.equal((await C.actualizarCopia("clientes", x.d)).ok, true)
})

test("sin la migración de Z2 (no existe zomatik_robot_tomar) lee igual", async () => {
  const sb = baseFalsa()
  sb.rpc = (n) => Promise.resolve({ data: null, error: { message: `function ${n} does not exist` } })
  const r = await C.actualizarCopia("articulos", deps(sb).d)
  assert.equal(r.ok, true)
})

test("Zomatik falla: devuelve el error, no graba nada, suelta el turno y el candado queda (no se martilla)", async () => {
  const sb = baseFalsa()
  const x = deps(sb, { fallaSesion: Object.assign(new Error("Zomatik rechazó el usuario"), { name: "ZomatikError" }) })
  const r = await C.actualizarCopia("clientes", x.d)
  assert.equal(r.ok, false)
  assert.match(r.error, /No se pudo actualizar desde Zomatik/)
  assert.equal((sb.db.zomatik_clientes || []).length, 0)
  assert.ok(!sb.db.integraciones.some((i) => i.clave === "zomatik_robot"))
  assert.ok(sb.db.integraciones.some((i) => i.clave === "zomatik_copia_clientes"))
  x.avanzar(30_000)
  assert.equal((await C.actualizarCopia("clientes", x.d)).reciente, true)
})


// ── Tipo "precios": las listas de precios (precio por m³ al programar, 16/11/2026) ──
const LECTURA_LISTAS = {
  listas: [{ codigo: 10248, nombre: "0 - Lista OCTUBRE 2026", desde: "2026-10-28", estado: "Activo" }, { codigo: 10247, nombre: "0 - Lista SEPTIEMBRE 26 en 1 (013)", desde: "2026-10-16", estado: "Invisible" }],
  precios: [{ lista: 10248, filas: [{ articulo_nombre: "H21-620-10 C (CAN)", precio: 176500 }, { articulo_nombre: "NO EXISTE", precio: 1 }] }],
}
const ANTES = "2026-11-15T06:00:00.000Z"

test("precios: graba las listas y los precios de la activa (cruce por nombre); borra los de listas que ya no están activas", async () => {
  const sb = baseFalsa({
    zomatik_articulos: [{ codigo: 10090020, nombre: "H21-620-10 C (CAN)" }],
    zomatik_listas: [{ codigo: 999, nombre: "VIEJA", estado: "Activo", leida_at: ANTES }],
    zomatik_lista_precios: [{ lista_codigo: 999, articulo_codigo: 10090020, precio: 1, leida_at: ANTES }, { lista_codigo: 10248, articulo_codigo: 10090020, precio: 170000, leida_at: ANTES }],
  })
  const r = await C.actualizarCopia("precios", { sb, sesion: async () => ({ cookie: "x" }), leerListas: async () => LECTURA_LISTAS })
  assert.deepEqual(r, { ok: true, reciente: false, cantidad: 1 })
  assert.deepEqual(sb.db.zomatik_listas.map((x) => x.codigo).sort(), [10247, 10248])
  assert.deepEqual(sb.db.zomatik_lista_precios.map((x) => [x.lista_codigo, x.articulo_codigo, x.precio]), [[10248, 10090020, 176500]])
})

test("precios: si la lista activa no cruza ningún nombre, quedan sus precios de antes y el botón avisa", async () => {
  const sb = baseFalsa({
    zomatik_articulos: [{ codigo: 1, nombre: "OTRA COSA" }],
    zomatik_lista_precios: [{ lista_codigo: 10248, articulo_codigo: 10090020, precio: 176500, leida_at: ANTES }],
  })
  const r = await C.actualizarCopia("precios", { sb, sesion: async () => ({ cookie: "x" }), leerListas: async () => LECTURA_LISTAS })
  assert.equal(r.ok, false)
  assert.match(r.error, /10248 no cruzó ningún artículo/)
  assert.deepEqual(sb.db.zomatik_lista_precios.map((x) => [x.lista_codigo, x.precio]), [[10248, 176500]])
  assert.equal(C.tipoDeCopia("precios"), "precios")
})
