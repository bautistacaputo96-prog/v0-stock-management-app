// Pruebas del WhatsApp por TextMeBot (lib/whatsapp.ts) y del aviso a Juan cuando al proyecto no le alcanza el hormigón
// o la fibra (lib/zomatik/np-servidor.ts). fetch SIMULADO y base en memoria: no sale ningún mensaje real.
import { test, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { mandarWhatsApp } from "../whatsapp.ts"
import * as S from "../zomatik/np-servidor.ts"

const PED = "1a2b3c4d-0000-4000-8000-000000000001"
const CLAVE = "clave-de-prueba"
const TEL = "5490000000000"

const fetchOriginal = globalThis.fetch
const errorOriginal = console.error
let llamadas
let respuesta
let errores

beforeEach(() => {
  llamadas = []
  errores = []
  respuesta = async () => new Response("Success! Message sent", { status: 200 })
  globalThis.fetch = async (url, init) => {
    llamadas.push({ url: String(url), init })
    return respuesta(url, init)
  }
  console.error = (...a) => errores.push(a.join(" "))
  process.env.TEXTMEBOT_API_KEY = CLAVE
  process.env.WHATSAPP_JUAN = TEL
})

afterEach(() => {
  globalThis.fetch = fetchOriginal
  console.error = errorOriginal
  delete process.env.TEXTMEBOT_API_KEY
  delete process.env.WHATSAPP_JUAN
})

/** Base en memoria con lo justo que usa el aviso (select/eq/gte/order/limit/maybeSingle e insert). */
function baseFalsa(tablas = {}, { fallaLectura } = {}) {
  const db = JSON.parse(JSON.stringify(tablas))
  const consultas = []
  class Q {
    constructor(t) { this.t = t; this.f = []; this.op = "select"; this.uno = false }
    select() { return this }
    eq(c, v) { this.f.push((r) => r[c] === v); return this }
    gte(c, v) { this.f.push((r) => r[c] >= v); return this }
    order() { return this }
    limit() { return this }
    maybeSingle() { this.uno = true; return this }
    insert(v) { this.op = "insert"; this.vals = v; return this }
    then(ok, mal) { return Promise.resolve(this.correr()).then(ok, mal) }
    correr() {
      consultas.push({ t: this.t, op: this.op })
      const filas = (db[this.t] ||= [])
      if (this.op === "insert") {
        for (const v of [].concat(this.vals)) filas.push({ created_at: new Date().toISOString(), ...v })
        return { data: null, error: null }
      }
      if (fallaLectura && this.t === "activity_log") return { data: null, error: { message: "sin conexión" } }
      const out = filas.filter((r) => this.f.every((f) => f(r)))
      return { data: this.uno ? out[0] || null : out, error: null }
    }
  }
  return { db, consultas, from: (t) => new Q(t) }
}

const PROYECTO = { codigo: 31, numero: "PRO 0001-00000031", cliente_nombre: "La Tercera", obra: "Plateas" }
const DATOS_FIBRA = { que: "fibra", queda: 0.8, necesita: 1.6, fibra: "MACRO FIBRA", proyecto: 31, cliente: "La Tercera SA", fecha: "2026-11-26", articulo: "H17-620-15 B", m3: 50 }
const aviso = (datos = DATOS_FIBRA, extra = {}) => ({ usuario: "Robot", pedidoId: PED, plantId: "p1", ref: `Pedido ${PED.slice(0, 8)}`, marca: "RBQ-1", proyectoCodigo: 31, datos, ...extra })
const filasWhatsApp = (sb) => (sb.db.activity_log || []).filter((x) => String(x.details?.["Qué pasó"] || "").startsWith("WhatsApp a Juan"))

// ── mandarWhatsApp ──

test("mandarWhatsApp: GET a TextMeBot con destinatario, clave y texto codificado, con timeout", async () => {
  const r = await mandarWhatsApp("+54 9 000 0000000", "Hola ⚠️ & listo")
  assert.deepEqual(r, { enviado: true })
  assert.equal(llamadas.length, 1)
  const u = new URL(llamadas[0].url)
  assert.equal(u.origin + u.pathname, "https://api.textmebot.com/send.php")
  assert.equal(u.searchParams.get("recipient"), "5490000000000")
  assert.equal(u.searchParams.get("apikey"), CLAVE)
  assert.equal(u.searchParams.get("text"), "Hola ⚠️ & listo")
  assert.ok(llamadas[0].init?.signal, "lleva timeout")
})

test("mandarWhatsApp: sin TEXTMEBOT_API_KEY no llama a nadie", async () => {
  delete process.env.TEXTMEBOT_API_KEY
  assert.deepEqual(await mandarWhatsApp(TEL, "hola"), { enviado: false, motivo: "falta TEXTMEBOT_API_KEY" })
  assert.equal(llamadas.length, 0)
})

test("mandarWhatsApp: si fetch falla o TextMeBot devuelve error, no tira y no expone la clave", async () => {
  respuesta = async () => { throw new TypeError(`fetch failed https://api.textmebot.com/send.php?apikey=${CLAVE}`) }
  const r1 = await mandarWhatsApp(TEL, "hola")
  assert.equal(r1.enviado, false)
  assert.ok(!String(r1.motivo).includes(CLAVE))
  respuesta = async () => new Response("Error: subscription expired", { status: 200 })
  const r2 = await mandarWhatsApp(TEL, "hola")
  assert.equal(r2.enviado, false)
  respuesta = async () => new Response("caído", { status: 500 })
  const r3 = await mandarWhatsApp(TEL, "hola")
  assert.equal(r3.enviado, false)
  assert.match(r3.motivo, /500/)
})

// ── Texto ──

test("texto del aviso de fibra", () => {
  assert.equal(
    S.textoFaltaProyecto({ ...DATOS_FIBRA, proyecto: "PRO 0001-00000031", cliente: "La Tercera", obra: "Plateas" }),
    "⚠️ Rebucret · La NP no salió: al proyecto PRO 31 (La Tercera – Plateas) le quedan 0,8 kg de MACRO FIBRA y el pedido del 26/11 (H17-620-15 B, 50 m³) necesita 1,6 kg. Agrandalo en Zomatik y tocá «Generar NP ahora» en el pedido.",
  )
})

test("texto del aviso de m³", () => {
  assert.equal(
    S.textoFaltaProyecto({ que: "m3", queda: 12.5, necesita: 50, proyecto: "PRO2 0001-00000013", cliente: "La Tercera", obra: "Plateas", fecha: "2026-11-26", articulo: "H17-620-15 B", m3: 50 }),
    "⚠️ Rebucret · La NP no salió: al proyecto PRO2 13 (La Tercera – Plateas) le quedan 12,5 m³ de H17-620-15 B y el pedido del 26/11 necesita 50 m³. Agrandalo en Zomatik y tocá «Generar NP ahora» en el pedido.",
  )
})

test("texto: sin datos opcionales no se rompe", () => {
  assert.equal(
    S.textoFaltaProyecto({ que: "fibra", queda: 0, necesita: 2 }),
    "⚠️ Rebucret · La NP no salió: al proyecto le quedan 0 kg de fibra y el pedido necesita 2 kg. Agrandalo en Zomatik y tocá «Generar NP ahora» en el pedido.",
  )
  assert.equal(
    S.textoFaltaProyecto({ que: "m3", queda: 3, necesita: 8, proyecto: 40 }),
    "⚠️ Rebucret · La NP no salió: al proyecto PRO 40 le quedan 3 m³ y el pedido necesita 8 m³. Agrandalo en Zomatik y tocá «Generar NP ahora» en el pedido.",
  )
})

// ── Aviso a Juan ──

test("aviso a Juan: manda con los datos del proyecto y deja la marca en Actividad", async () => {
  const sb = baseFalsa({ zomatik_proyectos: [PROYECTO] })
  const r = await S.avisarJuanFaltaProyecto(sb, aviso())
  assert.deepEqual(r, { enviado: true })
  assert.equal(llamadas.length, 1)
  const u = new URL(llamadas[0].url)
  assert.equal(u.searchParams.get("recipient"), TEL)
  assert.match(u.searchParams.get("text"), /PRO 31 \(La Tercera – Plateas\) le quedan 0,8 kg de MACRO FIBRA/)
  const filas = filasWhatsApp(sb)
  assert.equal(filas.length, 1)
  assert.equal(filas[0].details["Qué pasó"], S.QUE_WHATSAPP_JUAN.fibra)
  assert.equal(filas[0].entity_id, PED)
  assert.ok(!JSON.stringify(sb.db.activity_log).includes(TEL), "el teléfono no queda en Actividad")
})

test("aviso a Juan: sin WHATSAPP_JUAN (o sin la clave) no manda ni toca la base", async () => {
  delete process.env.WHATSAPP_JUAN
  const sb = baseFalsa({ zomatik_proyectos: [PROYECTO] })
  const r = await S.avisarJuanFaltaProyecto(sb, aviso())
  assert.equal(r.enviado, false)
  assert.equal(llamadas.length, 0)
  assert.equal(sb.consultas.length, 0)
  assert.ok(errores.some((e) => e.includes("WHATSAPP_JUAN")))
  process.env.WHATSAPP_JUAN = TEL
  delete process.env.TEXTMEBOT_API_KEY
  assert.equal((await S.avisarJuanFaltaProyecto(sb, aviso())).enviado, false)
  assert.equal(llamadas.length, 0)
})

test("aviso a Juan: una sola vez por pedido y motivo (el robot reintenta con NP adicionales)", async () => {
  const sb = baseFalsa({ zomatik_proyectos: [PROYECTO] })
  for (let n = 1; n <= 4; n++) await S.avisarJuanFaltaProyecto(sb, aviso(DATOS_FIBRA, { marca: `RBQ-${n}` }))
  assert.equal(llamadas.length, 1)
  assert.equal(filasWhatsApp(sb).length, 1)
  // Otro motivo (hormigón) en el mismo pedido sí sale, una vez
  const m3 = { que: "m3", queda: 10, necesita: 50, proyecto: 31, fecha: "2026-11-26", articulo: "H17-620-15 B", m3: 50 }
  await S.avisarJuanFaltaProyecto(sb, aviso(m3))
  await S.avisarJuanFaltaProyecto(sb, aviso(m3))
  assert.equal(llamadas.length, 2)
  // Otro pedido sí sale
  await S.avisarJuanFaltaProyecto(sb, aviso(DATOS_FIBRA, { pedidoId: "1a2b3c4d-0000-4000-8000-000000000002" }))
  assert.equal(llamadas.length, 3)
})

test("aviso a Juan: la marca vale 24 h", async () => {
  const viejo = new Date(Date.now() - S.VENTANA_WHATSAPP_JUAN_MS - 60_000).toISOString()
  const sb = baseFalsa({ zomatik_proyectos: [PROYECTO], activity_log: [{ entity: "zomatik_np", entity_id: PED, created_at: viejo, details: { "Qué pasó": S.QUE_WHATSAPP_JUAN.fibra } }] })
  assert.equal((await S.avisarJuanFaltaProyecto(sb, aviso())).enviado, true)
  assert.equal(llamadas.length, 1)
})

test("aviso a Juan: si fetch falla no tira, no deja marca y se vuelve a probar en el próximo error", async () => {
  const sb = baseFalsa({ zomatik_proyectos: [PROYECTO] })
  respuesta = async () => { throw new TypeError("fetch failed") }
  const r = await S.avisarJuanFaltaProyecto(sb, aviso())
  assert.equal(r.enviado, false)
  assert.equal(filasWhatsApp(sb).length, 0)
  respuesta = async () => new Response("Success!", { status: 200 })
  assert.equal((await S.avisarJuanFaltaProyecto(sb, aviso())).enviado, true)
  assert.equal(filasWhatsApp(sb).length, 1)
})

test("aviso a Juan: si no se puede leer la Actividad no manda (mejor uno menos que cuatro)", async () => {
  const sb = baseFalsa({ zomatik_proyectos: [PROYECTO] }, { fallaLectura: true })
  const r = await S.avisarJuanFaltaProyecto(sb, aviso())
  assert.equal(r.enviado, false)
  assert.equal(llamadas.length, 0)
})

test("aviso a Juan: sin el proyecto en la copia usa lo que vino del pedido", async () => {
  const sb = baseFalsa({})
  await S.avisarJuanFaltaProyecto(sb, aviso())
  assert.match(new URL(llamadas[0].url).searchParams.get("text"), /al proyecto PRO 31 \(La Tercera SA\) le quedan/)
})
