// Pruebas del programa puente de la PC de la planta (puente-carga/puente.mjs) con fetch simulado: nada sale de esta PC
// y nunca se le habla a 192.168.0.10. Cubren la revisión del 05/11: espera al arrancar (B1), mínimos de cadencia (B2),
// dos lecturas iguales y cortes en RECETAS (I2, I1, M3), clave rechazada (I3) y candado con hora (I4).
import { test, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as B from "../../puente-carga/puente.mjs"
import * as X from "../../puente-carga/indumix-xml.mjs"

const BASE = "http://192.168.0.10"
let dir
let indumix // estado simulado de Indumix
let escrituras // lo que el puente escribió
let lecturas // cuántas lecturas de la lista grande por número
let servidor // respuestas simuladas del servidor (status)

/** Indumix simulado: guarda neReporte/neReceta y arma la respuesta con `valores(n, i)` (i = lectura número i de ese n). */
function simular({ valores = () => ({}) } = {}) {
  globalThis.fetch = async (url, op = {}) => {
    const u = new URL(url)
    if (u.origin === X.SERVIDOR) return new Response(JSON.stringify({ ok: servidor === 200 }), { status: servidor })
    assert.equal(u.origin, BASE, `salió a ${url}`)
    if (u.pathname === X.RUTA_ESCRIBIR) {
      const [k, v] = decodeURIComponent(u.search.slice(1)).split("+")
      escrituras.push(`${k}=${v}`)
      indumix[k] = v
      return new Response(v)
    }
    const vars = [...String(op.body).matchAll(/<n>(.*?)<\/n>/g)].map((m) => m[1])
    let extra = {}
    // La lista grande (no la del número que había ni la de confirmar al final)
    if (vars.some((v) => !["Receta.neReporte", "Receta.neReceta", "Receta.Proceso"].includes(v))) {
      const n = Number(indumix["Receta.neReporte"] ?? 0) * 100 + Number(indumix["Receta.neReceta"] ?? 0)
      lecturas[n] = (lecturas[n] || 0) + 1
      extra = valores(indumix, lecturas[n])
    }
    const fuente = { ...indumix, ...extra }
    return new Response(`<body><item_list>${vars.map((n) => `<i><n>${n}</n><v>${fuente[n] ?? "var not found"}</v></i>`).join("")}</item_list></body>`)
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "puente-"))
  B.usarCarpeta(dir)
  B.reiniciar(Date.now())
  B.E.base = BASE
  B.E.clave = "rbp_CLAVEVIEJAxxxxxxxxxxxxxxxxxxxxxx"
  B.ajustes.esperaLecturaMs = 0
  B.ajustes.espera401Ms = 0
  B.ajustes.silencio = true
  indumix = { "Receta.neReporte": "3", "Receta.neReceta": "15", "Receta.Proceso": "Fin" }
  escrituras = []
  lecturas = {}
  servidor = 200
})

test("B2 · cadencias: la nube solo puede hacerlo más lento", () => {
  const c = B.cadenciasSeguras({ recetas_s: 10, reportes_s: 0, reporte_s: null, posponer_s: 5, quieto_navegando_s: 1, estado_ciclo_s: "x", totales_s: -4, recetas_x: 1 })
  assert.equal(c.recetas_s, 1800)
  assert.equal(c.reportes_s, 1800) // 0 → por defecto
  assert.equal(c.reporte_s, 300) // faltante → por defecto, nunca 60 ni 0
  assert.equal(c.posponer_s, 300)
  assert.equal(c.quieto_navegando_s, 120)
  assert.equal(c.estado_ciclo_s, 3)
  assert.equal(c.totales_s, 900)
  assert.equal(B.cadenciasSeguras({ reporte_s: 30 }).reporte_s, 60)
  assert.equal(B.cadenciasSeguras({ recetas_s: 7200 }).recetas_s, 7200) // más lento, sí
  assert.deepEqual(B.cadenciasSeguras(undefined), B.cadenciasSeguras({}))
  for (const k of Object.keys(B.POR_DEFECTO)) assert.ok(B.cadenciasSeguras({})[k] > 0)
})

test("B1 · al arrancar espera 2 minutos sin cambios de número antes de barrer", async () => {
  const t0 = Date.now()
  B.reiniciar(t0)
  B.E.base = BASE
  B.E.cad = B.cadenciasSeguras({ quieto_navegando_s: 1 })
  B.E.tiempos.push(900, 900, 900) // Indumix lento: los intervalos se duplican, la espera de 2 min no
  B.E.anterior = { ...indumix }
  assert.ok(B.navegando("Receta.neReporte", t0 + 60_000))
  assert.ok(B.navegando("Receta.neReceta", t0 + 119_000))
  assert.equal(B.navegando("Receta.neReporte", t0 + 121_000), null)
  // Recién arrancado, barrer los reportes o las recetas no escribe nada y se reprograma para cuando pasan los 2 min
  simular()
  B.E.config = { variables: { reporte: ["Receta.neReporte", "Receta.Reporte_WEB.NCarga"], receta: ["Receta.neReceta"] } }
  await B.tareaReportes([1, 2, 3])
  assert.deepEqual(escrituras, [])
  assert.equal(B.E.prox.reportes, t0 + 121_000)
  assert.equal(await B.tareaRecetas([1, 2], true), false)
  assert.deepEqual(escrituras, [])
  assert.equal(B.E.prox.recetas, t0 + 121_000)
})

test("I2 · una lectura de reporte vale recién con dos seguidas iguales; al final queda el número de antes", async () => {
  // N° 1: la primera lectura trae un dato viejo (a medio cambiar), después dos iguales
  simular({ valores: (st, i) => ({ "Receta.Reporte_WEB.NCarga": st["Receta.neReporte"] === "1" ? (i === 1 ? "12" : "13") : "11" }) })
  const { leidos, cortado } = await B.leerNumerados("Receta.neReporte", [1, 2], ["Receta.neReporte", "Receta.Reporte_WEB.NCarga"])
  assert.equal(cortado, null)
  assert.deepEqual(leidos.map((x) => [x.numero, x.variables["Receta.Reporte_WEB.NCarga"]]), [[1, "13"], [2, "11"]])
  assert.equal(lecturas[115], 3) // neReporte 1 (con neReceta 15)
  assert.equal(lecturas[215], 2)
  assert.deepEqual(escrituras, ["Receta.neReporte=1", "Receta.neReporte=2", "Receta.neReporte=3"])
  assert.equal(indumix["Receta.neReporte"], "3")
})

test("I2 · si nunca hay dos lecturas iguales, ese número no se sube", async () => {
  simular({ valores: (st, i) => ({ "Receta.Reporte_WEB.NCarga": String(i) }) })
  const { leidos } = await B.leerNumerados("Receta.neReporte", [1], ["Receta.neReporte", "Receta.Reporte_WEB.NCarga"])
  assert.deepEqual(leidos, [])
  assert.equal(indumix["Receta.neReporte"], "3")
})

test("I1 · recetas: corta si alguien edita en RECETAS o si arranca una carga, y deja el número como estaba", async () => {
  const lista = ["Receta.neReceta", "Receta.Receta_Editar.Cemento2", "Receta.beReceta"]
  simular({ valores: (st, i) => ({ "Receta.Receta_Editar.Cemento2": st["Receta.neReceta"] === "2" ? String(360 + i) : "365", "Receta.beReceta": "0" }) })
  let r = await B.leerNumerados("Receta.neReceta", [1, 2, 3], lista)
  assert.equal(r.cortado, "alguien está en RECETAS")
  assert.deepEqual(r.leidos.map((x) => x.numero), [1])
  assert.deepEqual(escrituras, ["Receta.neReceta=1", "Receta.neReceta=2", "Receta.neReceta=15"])
  assert.equal(indumix["Receta.neReceta"], "15")
  // Arranca una carga en el medio
  escrituras = []; lecturas = {}
  simular({ valores: (st) => ({ "Receta.Proceso": st["Receta.neReceta"] === "2" ? "Pesando" : "Fin" }) })
  r = await B.leerNumerados("Receta.neReceta", [1, 2, 3], lista)
  assert.equal(r.cortado, "arrancó una carga")
  assert.equal(indumix["Receta.neReceta"], "15")
  // Con una carga en curso de entrada: no escribe nada
  escrituras = []
  indumix["Receta.Proceso"] = "Pesando"
  simular()
  r = await B.leerNumerados("Receta.neReceta", [1], lista)
  assert.equal(r.cortado, "hay una carga en curso")
  assert.deepEqual(escrituras, [])
})

test("M3 · si el número que había es 0 o no vino, no barre", async () => {
  indumix["Receta.neReporte"] = "0"
  simular()
  const r = await B.leerNumerados("Receta.neReporte", [1, 2], ["Receta.neReporte"])
  assert.equal(r.cortado, "número inicial raro")
  assert.deepEqual(escrituras, [])
  delete indumix["Receta.neReceta"]
  const r2 = await B.leerNumerados("Receta.neReceta", [1], ["Receta.neReceta"])
  assert.equal(r2.cortado, "número inicial raro")
  assert.deepEqual(escrituras, [])
})

test("I3 · clave rechazada: relee config.json, toma una clave nueva o se cierra", async () => {
  const salidas = []
  B.ajustes.salir = (c) => salidas.push(c)
  writeFileSync(join(dir, "config.json"), JSON.stringify({ indumix: BASE, clave: B.E.clave }))
  const r401 = () => new Response("{}", { status: 401 })
  assert.equal(await B.atender(r401(), "x"), "parar")
  assert.deepEqual(salidas, [])
  assert.equal(await B.atender(r401(), "x"), "parar")
  assert.deepEqual(salidas, [3]) // sigue 401 con la misma clave: sale para que iniciar.cmd lo relance
  // Con una clave nueva en config.json (se volvió a correr instalar.cmd) la usa sin salir
  B.E.n401 = 0
  writeFileSync(join(dir, "config.json"), JSON.stringify({ indumix: BASE, clave: "rbp_CLAVENUEVAyyyyyyyyyyyyyyyyyyyyyy" }))
  assert.equal(await B.atender(r401(), "x"), "reintentar")
  assert.equal(B.E.clave, "rbp_CLAVENUEVAyyyyyyyyyyyyyyyyyyyyyy")
  // Un puente andando que ve otra clave en config.json se cierra (y suelta el candado)
  assert.equal(await B.tomarCandado(), true)
  writeFileSync(join(dir, "config.json"), JSON.stringify({ indumix: BASE, clave: "rbp_OTRACLAVEzzzzzzzzzzzzzzzzzzzzzzzz" }))
  await B.vigilarClave()
  assert.deepEqual(salidas, [3, 0])
  assert.equal(existsSync(join(dir, "puente.lock")), false)
  // La subida de la cola con 401 no borra nada
  servidor = 401
  simular()
  B.E.clave = "rbp_OTRACLAVEzzzzzzzzzzzzzzzzzzzzzzzz"
  B.E.n401 = 0
  await B.encolar({ tipo: "totales", variables: { a: "1" } })
  await B.subirCola()
  const { readdirSync } = await import("node:fs")
  assert.equal(readdirSync(join(dir, "cola")).filter((f) => f.endsWith(".json")).length, 1)
  B.ajustes.salir = (c) => process.exit(c)
})

test("I4 · candado con hora: se renueva y vence a los 2 minutos", async () => {
  const lock = join(dir, "puente.lock")
  const ahora = Date.now()
  writeFileSync(lock, JSON.stringify({ token: "otro", pid: 1, at: new Date(ahora - 30_000).toISOString() }))
  assert.equal(await B.candadoAjeno(ahora), true)
  assert.equal(await B.tomarCandado(ahora), false)
  // Vencido (no se renovó en 2 min): se toma, aunque el número de proceso exista
  writeFileSync(lock, JSON.stringify({ token: "otro", pid: process.pid, at: new Date(ahora - 130_000).toISOString() }))
  assert.equal(await B.tomarCandado(ahora), true)
  assert.equal(JSON.parse(readFileSync(lock, "utf8")).token, B.E.token)
  assert.equal(await B.candadoAjeno(ahora), false)
  // Se renueva
  assert.equal(await B.tomarCandado(ahora + 60_000), true)
  assert.equal(JSON.parse(readFileSync(lock, "utf8")).at, new Date(ahora + 60_000).toISOString())
  // Para otro puente, vigente hasta 2 min después de la última renovación
  const mio = B.E.token
  B.reiniciar()
  B.usarCarpeta(dir)
  assert.notEqual(B.E.token, mio)
  assert.equal(await B.candadoAjeno(ahora + 60_000 + 119_000), true)
  assert.equal(await B.candadoAjeno(ahora + 60_000 + 121_000), false)
})

test("B3 · con Indumix fallando una lectura sí y una no, como mucho un barrido por cadencia", async () => {
  B.reiniciar(Date.now() - 10 * 60_000) // arrancó hace rato: se puede barrer
  B.E.base = BASE
  B.E.clave = "rbp_CLAVEVIEJAxxxxxxxxxxxxxxxxxxxxxx"
  B.E.config = { variables: { estado: ["Receta.Proceso"], reporte: ["Receta.neReporte", "Receta.Reporte_WEB.NCarga"], receta: ["Receta.neReceta", "Receta.Receta_Editar.Nombre", "Receta.beReceta"], totales: ["Receta.ConsumoT.Agua"] } }
  indumix["Receta.neReceta"] = "3"
  B.E.anterior = { ...indumix }
  const lejos = Date.now() + 86400_000
  Object.assign(B.E.prox, { config: lejos, estado: lejos, reportes: lejos, reporte1: lejos, totales: lejos, recetas: 0, limpieza: lejos })
  let grandes = 0
  const base = globalThis.fetch
  simular()
  const simulado = globalThis.fetch
  globalThis.fetch = async (url, op = {}) => {
    const vars = [...String(op.body || "").matchAll(/<n>(.*?)<\/n>/g)].map((m) => m[1])
    if (vars.length > 2 && ++grandes % 2 === 1) return new Response("", { status: 500 }) // Indumix intermitente
    return simulado(url, op)
  }
  const t = Date.now()
  for (let i = 0; i < 20; i++) await B.paso()
  assert.equal(escrituras.filter((e) => e === "Receta.neReceta=1").length, 1)
  assert.equal(indumix["Receta.neReceta"], "3") // quedó como estaba
  assert.ok(B.E.prox.recetas >= t + 300_000, "la próxima lectura quedó como mínimo a 5 min")
  // Las recetas pedidas por el servidor: igual, una sola vez por espera
  escrituras = []
  B.E.prox.recetas = lejos
  B.E.cambioNumero["Receta.neReceta"] = Date.now() - 10 * 60_000
  B.E.recetasPedidas.add(15)
  for (let i = 0; i < 20; i++) await B.paso()
  assert.equal(escrituras.filter((e) => e === "Receta.neReceta=15").length, 1)
  assert.ok(B.E.recetasPedidasProx >= Date.now() + 250_000)
  globalThis.fetch = base
})

test("N1 · la espera de 2 minutos cuenta desde que el puente consigue el candado", async () => {
  const lock = join(dir, "puente.lock")
  writeFileSync(lock, JSON.stringify({ token: "otro", pid: process.pid, at: new Date(Date.now() - 119_700).toISOString() }))
  B.reiniciar(Date.now() - 10 * 60_000)
  B.ajustes.esperaTurnoMs = 200
  const antes = Date.now()
  await B.esperarTurno()
  assert.ok(B.E.arranque >= antes + 200)
  assert.equal(B.E.cambioNumero["Receta.neReporte"], B.E.arranque)
  assert.equal(B.E.cambioNumero["Receta.neReceta"], B.E.arranque)
  B.E.anterior = { ...indumix }
  assert.ok(B.navegando("Receta.neReporte"))
  assert.equal(JSON.parse(readFileSync(lock, "utf8")).token, B.E.token)
})

test("N2 · --hay-otro: candado vigente y además el proceso vivo", async () => {
  const lock = join(dir, "puente.lock")
  const ahora = Date.now()
  writeFileSync(lock, JSON.stringify({ token: "otro", pid: process.pid, at: new Date(ahora - 10_000).toISOString() }))
  assert.equal(await B.hayOtroAndando(ahora), true)
  writeFileSync(lock, JSON.stringify({ token: "otro", pid: 2147483646, at: new Date(ahora - 10_000).toISOString() }))
  assert.equal(await B.hayOtroAndando(ahora), false) // se colgó o lo mataron: instalar.cmd arranca otro
  writeFileSync(lock, JSON.stringify({ token: "otro", pid: process.pid, at: new Date(ahora - 130_000).toISOString() }))
  assert.equal(await B.hayOtroAndando(ahora), false)
})

test("N3 · un 500 del servidor (error de la base) se reintenta y no borra la cola", async () => {
  servidor = 500
  simular()
  assert.equal(await B.atender(new Response("{}", { status: 500 }), "x"), "reintentar")
  assert.equal(B.E.n401, 0)
  await B.encolar({ tipo: "reportes", reportes: [{ slot: 1, variables: {} }] })
  await B.subirCola()
  const { readdirSync } = await import("node:fs")
  assert.equal(readdirSync(join(dir, "cola")).filter((f) => f.endsWith(".json")).length, 1)
  assert.equal(readdirSync(join(dir, "cola", "rechazados")).length, 0)
  assert.ok(B.E.pausaServidorHasta > Date.now())
})

test("Candado de una ventana cerrada (proceso muerto): no cuenta, el puente nuevo arranca enseguida", async () => {
  const lock = join(dir, "puente.lock")
  const ahora = Date.now()
  writeFileSync(lock, JSON.stringify({ token: "otro", pid: 2147483646, at: new Date(ahora - 5_000).toISOString() }))
  assert.equal(await B.candadoAjeno(ahora), false)
  assert.equal(await B.tomarCandado(ahora), true)
  // esperarTurno no espera nada
  B.reiniciar()
  B.ajustes.esperaTurnoMs = 60_000
  writeFileSync(lock, JSON.stringify({ token: "otro", pid: 2147483646, at: new Date().toISOString() }))
  const t = Date.now()
  await B.esperarTurno()
  assert.ok(Date.now() - t < 1000)
})

test("Si no se pudo dejar el número como estaba, se reintenta una vez y no cuenta como un cambio de alguien", async () => {
  B.reiniciar(Date.now() - 10 * 60_000)
  B.E.base = BASE
  B.E.clave = "rbp_CLAVEVIEJAxxxxxxxxxxxxxxxxxxxxxx"
  B.E.config = { variables: { estado: ["Receta.neReporte", "Receta.neReceta", "Receta.Proceso"] }, ruido: [] }
  B.E.anterior = { ...indumix }
  simular({ valores: () => ({ "Receta.Reporte_WEB.NCarga": "13" }) })
  const simulado = globalThis.fetch
  let fallar = 1 // la escritura que vuelve al 3 falla una vez
  globalThis.fetch = async (url, op = {}) => {
    if (String(url).includes("writeVal.exe?Receta.neReporte+3") && fallar-- > 0) return new Response("", { status: 500 })
    return simulado(url, op)
  }
  const { leidos } = await B.leerNumerados("Receta.neReporte", [1], ["Receta.neReporte", "Receta.Reporte_WEB.NCarga"])
  assert.equal(leidos.length, 1)
  assert.equal(indumix["Receta.neReporte"], "1") // quedó en el que leyó
  assert.deepEqual(B.E.restituirPendiente, { variable: "Receta.neReporte", valor: 3 })
  // Mientras tanto el estado lo ve en 1: no es alguien en REPORTE
  const antes = B.E.cambioNumero["Receta.neReporte"]
  await B.tareaEstado()
  assert.equal(B.E.cambioNumero["Receta.neReporte"], antes)
  // En la vuelta siguiente se reintenta (una vez) y queda en 3; la vuelta tampoco cuenta como cambio
  B.E.prox = { ...B.E.prox, config: Infinity, estado: 0, reportes: Infinity, reporte1: Infinity, recetas: Infinity, totales: Infinity, limpieza: Infinity, clave: Infinity }
  await B.paso()
  assert.equal(indumix["Receta.neReporte"], "3")
  assert.equal(B.E.restituirPendiente, null)
  assert.equal(B.E.cambioNumero["Receta.neReporte"], antes)
  assert.equal(escrituras.filter((e) => e === "Receta.neReporte=3").length, 1) // la que falló no llegó a escribir
})

test("El candado se renueva entre número y número del barrido", async () => {
  simular({ valores: () => ({ "Receta.Receta_Editar.Nombre": "X", "Receta.beReceta": "0" }) })
  const lock = join(dir, "puente.lock")
  writeFileSync(lock, JSON.stringify({ token: B.E.token, pid: process.pid, at: new Date(Date.now() - 100_000).toISOString() }))
  const r = await B.leerNumerados("Receta.neReceta", [1, 2], ["Receta.neReceta", "Receta.Receta_Editar.Nombre", "Receta.beReceta"])
  assert.equal(r.leidos.length, 2)
  assert.ok(Date.now() - Date.parse(JSON.parse(readFileSync(lock, "utf8")).at) < 5_000)
})
