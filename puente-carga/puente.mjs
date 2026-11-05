// Puente Rebucret ↔ Indumix (Canning) · fase 1: SOLO LECTURA. Node 22, sin dependencias. No abre ningún puerto.
// Especificación: docs/specs/2026-11-05-puente-indumix.md. Cómo se instala: LEEME.md.
//
// Qué hace: lee Indumix (192.168.0.10) y sube lo leído, tal cual, a https://www.produccionrebucret.com/api/carga/puente.
// El puente es "tonto": no interpreta nada (eso lo hace el servidor). Habla SOLO con Indumix y con nuestro servidor.
// Lo único que escribe en Indumix es el número de reporte o de receta que quiere mirar (Receta.neReporte 1-10 y
// Receta.neReceta 1-20, lista cerrada en indumix-xml.mjs), y al terminar lo deja como estaba.
//
// Uso:  node puente.mjs                          (lo arranca iniciar.cmd)
//       node puente.mjs --guardar-clave rbp_…    (lo usa instalar.cmd)
import { appendFile, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import * as X from "./indumix-xml.mjs"

const VERSION = "1.0.0"
const DIR = dirname(fileURLToPath(import.meta.url))
const ARCHIVO_CONFIG = join(DIR, "config.json")
const ARCHIVO_CONFIG_NUBE = join(DIR, "config-nube.json")
const COLA = join(DIR, "cola")
const RECHAZADOS = join(COLA, "rechazados")
const REGISTRO = join(DIR, "registro")
const MAX_COLA = 50 * 1024 * 1024
const DIAS_REGISTRO = 14
const TIEMPO_INDUMIX_MS = 3000
const TIEMPO_SERVIDOR_MS = 20000

const espera = (ms) => new Promise((r) => setTimeout(r, ms))
const pad = (n) => String(n).padStart(2, "0")
const hoyLocal = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

// ───────────────────────────── Registro local (registro\AAAA-MM-DD.log, 14 días) ─────────────────────────────

async function log(texto) {
  const d = new Date()
  const linea = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${texto}`
  console.log(linea)
  try {
    await mkdir(REGISTRO, { recursive: true })
    await appendFile(join(REGISTRO, `${hoyLocal(d)}.log`), linea + "\n", "utf8")
  } catch { /* sin disco: igual sigue */ }
}

async function limpiarRegistro() {
  try {
    const limite = Date.now() - DIAS_REGISTRO * 86400_000
    for (const f of await readdir(REGISTRO)) {
      const m = f.match(/^(\d{4})-(\d{2})-(\d{2})\.log$/)
      if (m && new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() < limite) await unlink(join(REGISTRO, f)).catch(() => {})
    }
  } catch { /* nada */ }
}

// ───────────────────────────── Config local (config.json) ─────────────────────────────

async function leerJson(ruta) {
  try { return JSON.parse(await readFile(ruta, "utf8")) } catch { return null }
}

async function guardarClave(clave) {
  if (!/^rbp_[A-Za-z0-9_-]{20,}$/.test(String(clave || "").trim())) {
    console.error("Esa clave no parece la del puente (empieza con rbp_). Generala de nuevo en Carga de planta › Recetas de la planta › Puente.")
    process.exit(1)
  }
  const actual = (await leerJson(ARCHIVO_CONFIG)) || (await leerJson(join(DIR, "config.ejemplo.json"))) || { indumix: "http://192.168.0.10" }
  actual.clave = String(clave).trim()
  X.baseIndumix(actual.indumix) // que la dirección de Indumix sea válida
  await writeFile(ARCHIVO_CONFIG, JSON.stringify(actual, null, 2) + "\n", "utf8")
  console.log("Clave guardada en config.json.")
}

// ───────────────────────────── Pedidos (solo a Indumix y a nuestro servidor) ─────────────────────────────

let BASE = null // http://192.168.0.10, controlada (IPv4 privada)
let CLAVE = null

async function pedir(url, opciones, tiempoMs) {
  if (!X.direccionPermitida(url, BASE)) throw new Error(`Dirección no permitida: ${url}`)
  return fetch(url, { ...opciones, redirect: "error", signal: AbortSignal.timeout(tiempoMs) })
}

// Indumix: nunca más de un pedido a la vez (la cadena), 3 s como máximo cada uno, y la mediana de respuesta
let cadena = Promise.resolve()
function enIndumix(fn) {
  const p = cadena.then(fn, fn)
  cadena = p.catch(() => {})
  return p
}
const tiempos = []
let fallasSeguidas = 0
let sinRed = false
const mediana = () => { if (!tiempos.length) return null; const s = [...tiempos].sort((a, b) => a - b); return Math.round(s[Math.floor(s.length / 2)]) }
/** Si Indumix tarda (mediana > 500 ms), todos los intervalos se duplican solos. */
const factor = () => ((mediana() ?? 0) > 500 ? 2 : 1)

async function anotarFalla(e) {
  fallasSeguidas++
  if (fallasSeguidas === 3 && !sinRed) {
    sinRed = true
    await log(`Sin red con Indumix (${e?.message || e})`)
    await encolarEvento("sin_red_indumix", { error: String(e?.message || e) })
  }
}
async function anotarExito(ms) {
  tiempos.push(ms)
  if (tiempos.length > 50) tiempos.shift()
  fallasSeguidas = 0
  if (sinRed) {
    sinRed = false
    await log("Volvió la red con Indumix")
    await encolarEvento("red_indumix_ok", null)
  }
}

/** Lectura cruda (sin la cadena: la usa quien ya la tiene). */
async function leerCrudo(variables) {
  const t0 = Date.now()
  try {
    const r = await pedir(BASE + X.RUTA_LEER, { method: "POST", headers: { "Content-Type": "text/xml" }, body: X.armarPedido(variables) }, TIEMPO_INDUMIX_MS)
    if (!r.ok) throw new Error(`Indumix respondió ${r.status}`)
    const v = X.leerRespuesta(await r.text())
    if (!Object.keys(v).length) throw new Error("Indumix respondió vacío")
    await anotarExito(Date.now() - t0)
    return v
  } catch (e) {
    await anotarFalla(e)
    throw e
  }
}

/** Escritura cruda: SOLO la lista cerrada (urlEscritura tira error con cualquier otra cosa). */
async function escribirCrudo(variable, valor) {
  const url = X.urlEscritura(BASE, variable, valor)
  const t0 = Date.now()
  try {
    const r = await pedir(url, { method: "GET" }, TIEMPO_INDUMIX_MS)
    if (!r.ok) throw new Error(`Indumix respondió ${r.status} al escribir ${variable}`)
    await r.text()
    await anotarExito(Date.now() - t0)
  } catch (e) {
    await anotarFalla(e)
    throw e
  }
}

const leer = (variables) => enIndumix(() => leerCrudo(variables))

/**
 * Lee varios reportes o recetas: se fija el número que había, escribe cada número, lee y confirma que Indumix muestra
 * ese número, y al terminar lo deja como estaba (y lo vuelve a leer para confirmar). Todo dentro de la cadena: en el
 * medio no se lee nada más.
 */
function leerNumerados(variable, numeros, lista) {
  return enIndumix(async () => {
    const original = Number((await leerCrudo([variable]))[variable])
    const out = []
    try {
      for (const n of numeros) {
        await escribirCrudo(variable, n)
        let v = null
        for (let i = 0; i < 3 && !v; i++) {
          await espera(300)
          const x = await leerCrudo(lista)
          if (Number(x[variable]) === n) v = x
        }
        if (v) out.push({ numero: n, variables: v })
        else await log(`No se pudo leer ${variable} = ${n} (Indumix no cambió el número)`)
      }
    } finally {
      if (Number.isInteger(original) && X.escrituraPermitida(variable, original)) {
        try {
          await escribirCrudo(variable, original)
          await espera(200)
          const vuelta = Number((await leerCrudo([variable]))[variable])
          if (vuelta !== original) await log(`Ojo: ${variable} quedó en ${vuelta} y estaba en ${original}`)
        } catch (e) {
          await log(`Ojo: no se pudo dejar ${variable} como estaba (${original}): ${e?.message || e}`)
        }
      } else await log(`Ojo: ${variable} estaba en ${original}, fuera de rango: no se restituye`)
    }
    return out
  })
}

// ───────────────────────────── Cola para el servidor (cola\*.json) ─────────────────────────────

let secuencia = 0
let tamCola = null

async function medirCola() {
  let total = 0
  try { for (const f of await readdir(COLA)) if (f.endsWith(".json")) total += (await stat(join(COLA, f))).size } catch { /* vacía */ }
  tamCola = total
  return total
}

/** Lo que se sube nunca se pierde (reportes, recetas, totales); el muestreo crudo se descarta primero si la cola se llena. */
async function encolar(obj) {
  await mkdir(RECHAZADOS, { recursive: true })
  const cuerpo = JSON.stringify({ ...obj, at: obj.at || new Date().toISOString(), version: VERSION, pedido: obj.pedido || randomUUID() })
  const crudo = obj.tipo === "eventos" && obj.eventos?.every((e) => e.tipo === "vivo_crudo")
  if (tamCola == null) await medirCola()
  if (tamCola + cuerpo.length > MAX_COLA) {
    // Primero se borran los crudos más viejos
    const archivos = (await readdir(COLA)).filter((f) => f.endsWith("-crudo.json")).sort()
    for (const f of archivos) {
      if (tamCola + cuerpo.length <= MAX_COLA) break
      try { const s = (await stat(join(COLA, f))).size; await unlink(join(COLA, f)); tamCola -= s } catch { /* nada */ }
    }
    if (tamCola + cuerpo.length > MAX_COLA) {
      if (crudo) return
      await log("Ojo: la cola pasó los 50 MB (sin internet hace mucho). Lo importante se sigue guardando.")
    }
  }
  const nombre = `${Date.now()}-${String(++secuencia).padStart(6, "0")}-${crudo ? "crudo" : obj.tipo}.json`
  await writeFile(join(COLA, nombre), cuerpo, "utf8")
  tamCola += cuerpo.length
}

const encolarEvento = (tipo, detalle) => encolar({ tipo: "eventos", eventos: [{ tipo, at: new Date().toISOString(), detalle, pedido: randomUUID() }] })

let pausaServidorHasta = 0
let apagado = false
const recetasPedidas = new Set()

async function postServidor(cuerpoTexto) {
  return pedir(`${X.SERVIDOR}/api/carga/puente`, {
    method: "POST", headers: { Authorization: `Bearer ${CLAVE}`, "Content-Type": "application/json" }, body: cuerpoTexto,
  }, TIEMPO_SERVIDOR_MS)
}

/** Atiende la respuesta: 401 y 409 frenan 5 min; otro 4xx aparta el envío (no traba la cola). */
async function atender(r, que) {
  if (r.status === 401) { await log("La clave del puente no anda: generá una nueva y volvé a correr instalar.cmd."); pausaServidorHasta = Date.now() + 5 * 60_000; return "parar" }
  if (r.status === 409) { if (!apagado) await log("Puesto apagado en el sistema: el puente queda quieto y prueba cada 5 min."); apagado = true; pausaServidorHasta = Date.now() + 5 * 60_000; return "parar" }
  if (r.ok) {
    apagado = false
    const j = await r.json().catch(() => ({}))
    for (const n of Array.isArray(j?.leer_recetas) ? j.leer_recetas : []) if (Number.isInteger(n)) recetasPedidas.add(n)
    return "ok"
  }
  if (r.status >= 400 && r.status < 500) { await log(`El servidor rechazó ${que} (${r.status}): queda aparte en cola\\rechazados`); return "rechazado" }
  return "reintentar"
}

/** Sube la cola en orden. Sale de la cola solo lo que el servidor aceptó. */
async function subirCola() {
  if (!CLAVE || Date.now() < pausaServidorHasta) return
  let archivos
  try { archivos = (await readdir(COLA)).filter((f) => f.endsWith(".json")).sort() } catch { return }
  for (const f of archivos) {
    const ruta = join(COLA, f)
    let texto
    try { texto = await readFile(ruta, "utf8") } catch { continue }
    let r
    try { r = await postServidor(texto) } catch (e) { pausaServidorHasta = Date.now() + 10_000; return } // sin internet
    const que = await atender(r, f)
    if (que === "ok") { await unlink(ruta).catch(() => {}); tamCola = Math.max(0, (tamCola ?? 0) - texto.length) }
    else if (que === "rechazado") { await rename(ruta, join(RECHAZADOS, f)).catch(() => {}); tamCola = Math.max(0, (tamCola ?? 0) - texto.length) }
    else { if (que === "reintentar") pausaServidorHasta = Date.now() + 10_000; return }
  }
}

/** El latido no se encola: si no sale, vale el próximo (solo importa el último). */
async function mandarLatido(variables) {
  if (!CLAVE || Date.now() < pausaServidorHasta) return false
  const cuerpo = JSON.stringify({ tipo: "latido", at: new Date().toISOString(), version: VERSION, pedido: randomUUID(), variables, puente: { mediana_ms: mediana(), lento: factor() > 1, cola: tamCola } })
  try { return (await atender(await postServidor(cuerpo), "el latido")) === "ok" } catch { return false }
}

// ───────────────────────────── Config de la nube (cada 5 min) ─────────────────────────────

let config = null
let ultimoAvisoReloj = 0

async function bajarConfig() {
  try {
    const r = await pedir(`${X.SERVIDOR}/api/carga/puente`, { method: "GET", headers: { Authorization: `Bearer ${CLAVE}` } }, TIEMPO_SERVIDOR_MS)
    if (r.status === 401 || r.status === 409) { await atender(r, "la config"); return }
    if (!r.ok) throw new Error(`el servidor respondió ${r.status}`)
    const j = await r.json()
    if (!j?.variables?.estado?.length) throw new Error("config sin variables")
    if (!config) await log(`Config de la nube: puesto «${j.puesto?.nombre}» (${j.puesto?.etapa})`)
    apagado = false
    config = j
    await writeFile(ARCHIVO_CONFIG_NUBE, JSON.stringify(j), "utf8").catch(() => {})
    const dif = Date.parse(j.hora_servidor) - Date.now()
    if (Math.abs(dif) > 120_000 && Date.now() - ultimoAvisoReloj > 3600_000) {
      ultimoAvisoReloj = Date.now()
      await log(`El reloj de esta PC está corrido ${Math.round(dif / 1000)} s`)
      await encolarEvento("reloj_pc", { diferencia_s: Math.round(dif / 1000) })
    }
  } catch (e) {
    if (!config) {
      config = await leerJson(ARCHIVO_CONFIG_NUBE)
      await log(config ? "Sin internet: uso la última config guardada" : `No se pudo bajar la config (${e?.message || e}): se reintenta`)
    }
  }
}

// ───────────────────────────── Tareas ─────────────────────────────

const prox = { config: 0, estado: 0, reporte1: 0, reportes: 0, recetas: 0, totales: 0, crudo: 0, limpieza: 0 }
const cad = (k) => (config?.cadencias?.[k] ?? 60) * 1000 * factor()

let anterior = null // última lectura del estado
let ultimoLatidoMs = 0
let ultimaFirma = ""
const cambioNumero = { "Receta.neReporte": 0, "Receta.neReceta": 0 }
let cargaEnCurso = null
const vistos = [] // lo que se vio en vivo de cada carga: {contadores, inicio_at, fin_at, humedades}

const enCiclo = (v) => !!v && v["Receta.Proceso"] != null && String(v["Receta.Proceso"]).trim().toLowerCase() !== "fin"
const humedades = (v) => [1, 2, 3, 4].map((i) => v[`Receta.Parametros.HumedadArido${i}`] ?? null)

async function tareaEstado() {
  let v
  try { v = await leer(config.variables.estado) } catch (e) {
    prox.estado = Date.now() + (sinRed ? 10_000 : cad("estado_quieta_s"))
    return
  }
  const ahora = Date.now()
  const iso = new Date(ahora).toISOString()
  // ¿Alguien está mirando REPORTE o RECETAS en Indumix? (el número cambió)
  for (const k of Object.keys(cambioNumero)) if (anterior && v[k] !== anterior[k]) cambioNumero[k] = ahora
  // Inicio y fin de cada carga (para la hora real y la humedad con que se pesó)
  const ya = enCiclo(v), antes = enCiclo(anterior)
  if (anterior && !antes && ya) cargaEnCurso = { contadores: [v["@GV.Cont_Ciclo"]], inicio_at: iso, humedades: humedades(v) }
  if (anterior && antes && !ya) {
    if (cargaEnCurso) {
      cargaEnCurso.fin_at = iso
      cargaEnCurso.contadores.push(v["@GV.Cont_Ciclo"])
      vistos.push(cargaEnCurso)
      if (vistos.length > 12) vistos.shift()
      cargaEnCurso = null
    }
    prox.reporte1 = Math.min(prox.reporte1, ahora + cad("espera_fin_s") / factor())
    prox.totales = Math.min(prox.totales, ahora + cad("espera_fin_s") / factor())
  }
  if (anterior && Number(v["@GV.Cont_Ciclo"]) > Number(anterior["@GV.Cont_Ciclo"])) prox.reporte1 = Math.min(prox.reporte1, ahora + cad("espera_fin_s") / factor())
  anterior = v
  prox.estado = ahora + (ya ? cad("estado_ciclo_s") : cad("estado_quieta_s"))

  // Latido: con carga en curso cada 5 s; quieta, apenas cambia algo y si no, como mucho cada 60 s (el reloj)
  const ruido = new Set([...(config.ruido || []), "@GV.FechaHoraActual"])
  const firma = JSON.stringify(Object.entries(v).filter(([k]) => !ruido.has(k)))
  const toca = ya ? ahora - ultimoLatidoMs >= cad("latido_ciclo_s") : firma !== ultimaFirma || ahora - ultimoLatidoMs >= cad("latido_quieta_max_s")
  if (toca && (await mandarLatido(v))) { ultimoLatidoMs = ahora; ultimaFirma = firma }

  // Muestreo crudo para la fase 2 (7 días, con carga en curso, cada 30 s)
  const hasta = Date.parse(config.muestrear_crudo_hasta || "")
  if (ya && Number.isFinite(hasta) && ahora < hasta && ahora >= prox.crudo) {
    prox.crudo = ahora + cad("crudo_s")
    await encolar({ tipo: "eventos", eventos: [{ tipo: "vivo_crudo", at: iso, detalle: { variables: v }, pedido: randomUUID() }] })
  }
}

/** Se lee un número si nadie lo cambió en los últimos 2 min (si cambió, alguien está navegando esa pantalla). */
function navegando(variable) {
  if (!anterior || anterior[variable] === undefined) return "todavía no se leyó el estado"
  if (Date.now() - cambioNumero[variable] < cad("quieto_navegando_s") / factor()) return `alguien cambió ${variable} hace menos de 2 min`
  return null
}

async function tareaReportes(slots) {
  const ahora = Date.now()
  const motivo = navegando("Receta.neReporte")
  if (motivo) {
    await log(`Lectura de reportes pospuesta (${motivo})`)
    const t = ahora + cad("posponer_s")
    if (slots.length > 1) prox.reportes = t; else prox.reporte1 = t
    return
  }
  if (slots.length > 1) prox.reportes = ahora + cad("reportes_s")
  prox.reporte1 = ahora + cad("reporte_s")
  const leidos = await leerNumerados("Receta.neReporte", slots, config.variables.reporte)
  const reportes = leidos.map((x) => {
    const n = String(x.variables["Receta.Reporte_WEB.NCarga"] ?? "")
    const v = vistos.find((c) => c.fin_at && c.contadores.some((k) => String(k) === n))
    return { slot: x.numero, variables: x.variables, ...(v ? { visto: { inicio_at: v.inicio_at, fin_at: v.fin_at, humedades: v.humedades } } : {}) }
  })
  if (reportes.length) await encolar({ tipo: "reportes", reportes })
}

async function tareaRecetas(numeros, programada) {
  const ahora = Date.now()
  const motivo = enCiclo(anterior) ? "hay una carga en curso" : anterior && String(anterior["Receta.Proceso"] ?? "").trim() === "" ? "no se sabe si la planta está quieta" : navegando("Receta.neReceta")
  if (motivo) {
    await log(`Lectura de recetas pospuesta (${motivo})`)
    if (programada) prox.recetas = ahora + cad("posponer_s")
    return false
  }
  if (programada) prox.recetas = ahora + cad("recetas_s")
  const leidas = await leerNumerados("Receta.neReceta", numeros, config.variables.receta)
  if (leidas.length) await encolar({ tipo: "recetas", recetas: leidas, completa: numeros.length >= 20 && leidas.length === numeros.length })
  return true
}

async function tareaTotales() {
  prox.totales = Date.now() + cad("totales_s")
  try { await encolar({ tipo: "totales", variables: await leer(config.variables.totales) }) } catch { /* sin red: se reintenta */ }
}

// ───────────────────────────── Vuelta principal ─────────────────────────────

let recetasPedidasProx = 0

/** Un solo puente por PC: si ya hay otro andando (instalar.cmd dos veces), este espera y lo reemplaza si se cae. */
async function esperarTurno() {
  const lock = join(DIR, "puente.lock")
  let avisado = false
  for (;;) {
    const pid = Number(await readFile(lock, "utf8").catch(() => ""))
    let vivo = false
    if (pid && pid !== process.pid) { try { process.kill(pid, 0); vivo = true } catch { vivo = false } }
    if (!vivo) { await writeFile(lock, String(process.pid), "utf8"); return }
    if (!avisado) { avisado = true; await log(`Ya hay otro puente andando en esta PC (proceso ${pid}): este espera.`) }
    await espera(60_000)
  }
}

async function principal() {
  await esperarTurno()
  const local = await leerJson(ARCHIVO_CONFIG)
  if (!local?.clave) { console.error("Falta la clave en config.json: corré instalar.cmd."); process.exit(1) }
  BASE = X.baseIndumix(local.indumix || "http://192.168.0.10")
  CLAVE = String(local.clave).trim()
  await log(`Arranca el puente ${VERSION} (Node ${process.version}) · Indumix ${BASE} · servidor ${X.SERVIDOR}`)
  await encolarEvento("arranque", { version: VERSION, node: process.version })
  await limpiarRegistro()
  for (;;) {
    const ahora = Date.now()
    try {
      if (ahora >= prox.config) { prox.config = ahora + (config?.cadencias?.config_s ?? 300) * 1000; await bajarConfig() }
      if (config && !apagado) {
        if (ahora >= prox.estado) await tareaEstado()
        if (!sinRed && anterior) {
          if (ahora >= prox.reportes) await tareaReportes([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
          else if (ahora >= prox.reporte1) await tareaReportes([1])
          if (ahora >= prox.recetas) await tareaRecetas(Array.from({ length: 20 }, (_, i) => i + 1), true)
          else if (recetasPedidas.size && ahora >= recetasPedidasProx) {
            const lista = [...recetasPedidas].filter((n) => n >= 1 && n <= 20).sort((a, b) => a - b)
            if (await tareaRecetas(lista, false)) recetasPedidas.clear()
            else recetasPedidasProx = ahora + cad("posponer_s")
          }
          if (ahora >= prox.totales) await tareaTotales()
        }
      }
      await subirCola()
      if (ahora >= prox.limpieza) { prox.limpieza = ahora + 6 * 3600_000; await limpiarRegistro() }
    } catch (e) {
      await log(`Error: ${e?.message || e}`)
    }
    await espera(500)
  }
}

const i = process.argv.indexOf("--guardar-clave")
if (i >= 0) await guardarClave(process.argv[i + 1])
else await principal()
