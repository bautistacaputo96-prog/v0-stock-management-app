// Puente Rebucret ↔ Indumix (Canning) · fase 1: SOLO LECTURA. Node 22, sin dependencias. No abre ningún puerto.
// Especificación: docs/specs/2026-11-05-puente-indumix.md. Cómo se instala: LEEME.md.
//
// Qué hace: lee Indumix (192.168.0.10) y sube lo leído, tal cual, a https://www.produccionrebucret.com/api/carga/puente.
// El puente es "tonto": no interpreta nada (eso lo hace el servidor). Habla SOLO con Indumix y con nuestro servidor.
// Lo único que escribe en Indumix es el número de reporte o de receta que quiere mirar (Receta.neReporte 1-10 y
// Receta.neReceta 1-20, lista cerrada en indumix-xml.mjs), y al terminar lo deja como estaba.
//
// Uso:  node puente.mjs              (lo arranca iniciar.cmd; uno solo por PC, con candado)
//       node puente.mjs --instalar   (lo usa instalar.cmd: pide la clave, la guarda en config.json y deja el arranque
//                                     en la carpeta Inicio)
//       node puente.mjs --hay-otro   (sale con 0 si ya hay un puente andando en esta carpeta: candado vigente y vivo)
//       node puente.mjs --esperar-arranque   (espera hasta 40 s a que haya un puente andando; 0 si arrancó)
import { appendFile, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { createInterface } from "node:readline/promises"
import { dirname, join, relative, sep } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import * as X from "./indumix-xml.mjs"

export const VERSION = "1.1.0"
const MAX_COLA = 50 * 1024 * 1024
const DIAS_REGISTRO = 14
const TIEMPO_INDUMIX_MS = 3000
const TIEMPO_SERVIDOR_MS = 20000
/** Candado: se renueva cada minuto y vence a los 2 minutos. */
const CANDADO_RENUEVA_MS = 60_000
const CANDADO_VENCE_MS = 120_000

const espera = (ms) => new Promise((r) => setTimeout(r, ms))
const pad = (n) => String(n).padStart(2, "0")
const hoyLocal = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

// ───────────────────────────── Cadencias: la nube solo puede hacerlo más lento ─────────────────────────────

/** Valores seguros (segundos): los que se usan si la nube no manda uno, manda 0 o algo que no es un número. */
export const POR_DEFECTO = Object.freeze({
  estado_ciclo_s: 3, estado_quieta_s: 15, latido_ciclo_s: 5, latido_quieta_max_s: 60, reporte_s: 300, reportes_s: 1800,
  recetas_s: 3600, totales_s: 900, crudo_s: 30, config_s: 300, espera_fin_s: 15, posponer_s: 900, quieto_navegando_s: 120,
})
/** Mínimos fijos en el código (segundos): por más que la nube mande menos, no se baja de acá. */
export const MINIMOS = Object.freeze({
  estado_ciclo_s: 3, estado_quieta_s: 10, latido_ciclo_s: 5, latido_quieta_max_s: 30, reporte_s: 60, reportes_s: 1800,
  recetas_s: 1800, totales_s: 300, crudo_s: 30, config_s: 60, espera_fin_s: 10, posponer_s: 300, quieto_navegando_s: 120,
})

/** Las cadencias de la nube, controladas: faltante, 0 o raro → por defecto; nunca menos que el mínimo. */
export function cadenciasSeguras(nube) {
  const out = {}
  for (const k of Object.keys(POR_DEFECTO)) {
    const x = Number(nube?.[k])
    out[k] = Math.max(Number.isFinite(x) && x > 0 ? x : POR_DEFECTO[k], MINIMOS[k])
  }
  return out
}

// ───────────────────────────── Carpetas ─────────────────────────────

function rutas(dir) {
  return {
    dir, config: join(dir, "config.json"), nube: join(dir, "config-nube.json"), cola: join(dir, "cola"),
    rechazados: join(dir, "cola", "rechazados"), registro: join(dir, "registro"), candado: join(dir, "puente.lock"),
  }
}
let P = rutas(dirname(fileURLToPath(import.meta.url)))
/** Para las pruebas: trabajar en otra carpeta. */
export function usarCarpeta(dir) { P = rutas(dir) }

/** Lo que se puede cambiar en las pruebas (salir del proceso y las esperas). */
export const ajustes = { salir: (codigo) => process.exit(codigo), esperaLecturaMs: 300, espera401Ms: 5 * 60_000, esperaTurnoMs: 30_000, silencio: false }

// ───────────────────────────── Estado ─────────────────────────────

function nuevoEstado(ahora = Date.now()) {
  return {
    base: null, clave: null, config: null, cad: cadenciasSeguras({}),
    token: randomUUID(),
    arranque: ahora,
    tiempos: [], fallasSeguidas: 0, sinRed: false,
    secuencia: 0, tamCola: null, pausaServidorHasta: 0, apagado: false, n401: 0,
    recetasPedidas: new Set(), recetasPedidasProx: 0, ultimoAvisoReloj: 0,
    anterior: null, ultimoLatidoMs: 0, ultimaFirma: "",
    // Al arrancar se espera igual los 2 minutos sin cambios antes de barrer (puede haber alguien en REPORTE o RECETAS)
    cambioNumero: { "Receta.neReporte": ahora, "Receta.neReceta": ahora },
    cargaEnCurso: null, vistos: [],
    prox: { config: 0, estado: 0, reporte1: 0, reportes: 0, recetas: 0, totales: 0, crudo: 0, limpieza: 0, candado: 0, clave: 0 },
  }
}
export const E = nuevoEstado()
let cadena = Promise.resolve()
/** Para las pruebas: empezar de cero. */
export function reiniciar(ahora = Date.now()) {
  Object.assign(E, nuevoEstado(ahora))
  cadena = Promise.resolve()
}

/** Cadencia en ms; si Indumix tarda (mediana > 500 ms) se duplica. La espera "nadie navegando" no se toca. */
const cad = (k) => E.cad[k] * 1000 * factor()
const esperaNavegandoMs = () => Math.max(MINIMOS.quieto_navegando_s, E.cad.quieto_navegando_s) * 1000

// ───────────────────────────── Registro local (registro\AAAA-MM-DD.log, 14 días) ─────────────────────────────

async function log(texto) {
  const d = new Date()
  const linea = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${texto}`
  if (!ajustes.silencio) console.log(linea)
  try {
    await mkdir(P.registro, { recursive: true })
    await appendFile(join(P.registro, `${hoyLocal(d)}.log`), linea + "\n", "utf8")
  } catch { /* sin disco: igual sigue */ }
}

async function limpiarRegistro() {
  try {
    const limite = Date.now() - DIAS_REGISTRO * 86400_000
    for (const f of await readdir(P.registro)) {
      const m = f.match(/^(\d{4})-(\d{2})-(\d{2})\.log$/)
      if (m && new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() < limite) await unlink(join(P.registro, f)).catch(() => {})
    }
  } catch { /* nada */ }
}

async function leerJson(ruta) {
  try { return JSON.parse(await readFile(ruta, "utf8")) } catch { return null }
}

// ───────────────────────────── Candado: un solo puente por carpeta ─────────────────────────────

/** ¿Hay otro puente con el candado vigente (renovado hace menos de 2 min)? */
export async function candadoAjeno(ahora = Date.now()) {
  const c = await leerJson(P.candado)
  return !!c && c.token !== E.token && Number.isFinite(Date.parse(c.at)) && ahora - Date.parse(c.at) < CANDADO_VENCE_MS
}

/** Toma (o renueva) el candado. false si lo tiene otro puente vigente. */
export async function tomarCandado(ahora = Date.now()) {
  if (await candadoAjeno(ahora)) return false
  await writeFile(P.candado, JSON.stringify({ token: E.token, pid: process.pid, at: new Date(ahora).toISOString() }), "utf8")
  const c = await leerJson(P.candado) // si dos lo tomaron a la vez, queda el último que escribió
  return c?.token === E.token
}

/** Suelta el candado (si es de este puente) y sale: así el que relanza iniciar.cmd no espera los 2 minutos. */
async function salirSoltando(codigo) {
  const c = await leerJson(P.candado)
  if (c?.token === E.token) await unlink(P.candado).catch(() => {})
  ajustes.salir(codigo)
}

/** ¿El proceso del candado sigue vivo? (un candado fresco de un puente que se colgó o se mató no cuenta) */
function procesoVivo(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (e) { return e?.code === "EPERM" }
}

/** Para instalar.cmd: ¿hay otro puente andando? Candado vigente Y su proceso vivo. */
export async function hayOtroAndando(ahora = Date.now()) {
  if (!(await candadoAjeno(ahora))) return false
  const c = await leerJson(P.candado)
  return procesoVivo(Number(c?.pid))
}

/**
 * Espera a tener el candado. Al tenerlo, el arranque cuenta desde ahí: la espera de 2 minutos sin cambios de número
 * (y "recién arranca") empieza cuando de verdad arranca este puente, no cuando se abrió.
 */
export async function esperarTurno() {
  let avisado = false
  while (!(await tomarCandado())) {
    if (!avisado) { avisado = true; await log("Ya hay otro puente andando en esta PC: este espera.") }
    await espera(ajustes.esperaTurnoMs)
  }
  const ahora = Date.now()
  E.arranque = ahora
  E.cambioNumero = { "Receta.neReporte": ahora, "Receta.neReceta": ahora }
}

/** Para instalar.cmd: espera hasta `ms` a que haya un puente andando (para que "Listo" sea cierto). */
async function esperarArranque(ms) {
  const hasta = Date.now() + ms
  while (Date.now() < hasta) {
    if (await hayOtroAndando()) return true
    await espera(1000)
  }
  return false
}

// ───────────────────────────── Pedidos (solo a Indumix y a nuestro servidor) ─────────────────────────────

async function pedir(url, opciones, tiempoMs) {
  if (!X.direccionPermitida(url, E.base)) throw new Error(`Dirección no permitida: ${url}`)
  return fetch(url, { ...opciones, redirect: "error", signal: AbortSignal.timeout(tiempoMs) })
}

// Indumix: nunca más de un pedido a la vez (la cadena), 3 s como máximo cada uno, y la mediana de respuesta
function enIndumix(fn) {
  const p = cadena.then(fn, fn)
  cadena = p.catch(() => {})
  return p
}
const mediana = () => { if (!E.tiempos.length) return null; const s = [...E.tiempos].sort((a, b) => a - b); return Math.round(s[Math.floor(s.length / 2)]) }
/** Si Indumix tarda (mediana > 500 ms), los intervalos se duplican solos. */
const factor = () => ((mediana() ?? 0) > 500 ? 2 : 1)

async function anotarFalla(e) {
  E.fallasSeguidas++
  if (E.fallasSeguidas === 3 && !E.sinRed) {
    E.sinRed = true
    await log(`Sin red con Indumix (${e?.message || e})`)
    await encolarEvento("sin_red_indumix", { error: String(e?.message || e) })
  }
}
async function anotarExito(ms) {
  E.tiempos.push(ms)
  if (E.tiempos.length > 50) E.tiempos.shift()
  E.fallasSeguidas = 0
  if (E.sinRed) {
    E.sinRed = false
    await log("Volvió la red con Indumix")
    await encolarEvento("red_indumix_ok", null)
  }
}

/** Lectura cruda (sin la cadena: la usa quien ya la tiene). */
async function leerCrudo(variables) {
  const t0 = Date.now()
  try {
    const r = await pedir(E.base + X.RUTA_LEER, { method: "POST", headers: { "Content-Type": "text/xml" }, body: X.armarPedido(variables) }, TIEMPO_INDUMIX_MS)
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
  const url = X.urlEscritura(E.base, variable, valor)
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

export const leer = (variables) => enIndumix(() => leerCrudo(variables))

const quieta = (v) => !!v && String(v["Receta.Proceso"] ?? "").trim().toLowerCase() === "fin"
const deEdicion = (k) => k.startsWith("Receta.Receta_Editar.") || k === "Receta.beReceta"
const iguales = (a, b) => { const ks = new Set([...Object.keys(a), ...Object.keys(b)]); for (const k of ks) if (a[k] !== b[k]) return false; return true }

/**
 * Una lectura vale recién cuando dos seguidas son iguales y muestran el número pedido. En RECETAS además: si deja de
 * decir "Fin" (arrancó una carga) o cambia algo de la edición (Receta_Editar.*, beReceta) entre dos lecturas, hay alguien
 * en RECETAS y se corta.
 */
async function lecturaEstable(variable, n, lista, receta) {
  let previa = null
  for (let i = 0; i < 6; i++) {
    await espera(ajustes.esperaLecturaMs)
    let x
    try { x = await leerCrudo(lista) } catch (e) { return { cortar: `Indumix no contestó (${e?.message || e})` } }
    if (receta && !quieta(x)) return { cortar: "arrancó una carga" }
    if (Number(x[variable]) !== n) { previa = null; continue }
    if (previa) {
      if (iguales(previa, x)) return { v: x }
      if (receta && Object.keys(x).some((k) => deEdicion(k) && x[k] !== previa[k])) return { cortar: "alguien está en RECETAS" }
    }
    previa = x
  }
  return { v: null }
}

/**
 * Lee varios reportes o recetas: se fija el número que había (si es raro, 0 o no vino, no barre), escribe cada número,
 * espera una lectura estable, y al terminar lo deja como estaba (y lo vuelve a leer para confirmar). Todo dentro de la
 * cadena: en el medio no se lee nada más. Devuelve {leidos, cortado}.
 */
export function leerNumerados(variable, numeros, lista, opciones = {}) {
  const receta = variable === "Receta.neReceta"
  const listaFinal = receta ? [...new Set([...lista, "Receta.Proceso"])] : lista
  return enIndumix(async () => {
    const actual = await leerCrudo([variable, "Receta.Proceso"])
    const original = Number(actual[variable])
    if (actual[variable] == null || !Number.isInteger(original) || !X.escrituraPermitida(variable, original)) {
      await log(`No se barre ${variable}: el número que había (${actual[variable]}) no se puede volver a dejar`)
      return { leidos: [], cortado: "número inicial raro" }
    }
    if (receta && !quieta(actual)) return { leidos: [], cortado: "hay una carga en curso" }
    const leidos = []
    let cortado = null
    try {
      for (const n of numeros) {
        await escribirCrudo(variable, n)
        const r = await lecturaEstable(variable, n, listaFinal, receta)
        if (r.cortar) { cortado = r.cortar; break }
        if (r.v) leidos.push({ numero: n, variables: r.v })
        else await log(`No se pudo leer ${variable} = ${n} (no hubo dos lecturas iguales)`)
      }
    } finally {
      try {
        await escribirCrudo(variable, original)
        await espera(200)
        const vuelta = Number((await leerCrudo([variable]))[variable])
        if (vuelta !== original) await log(`Ojo: ${variable} quedó en ${vuelta} y estaba en ${original}`)
      } catch (e) {
        await log(`Ojo: no se pudo dejar ${variable} como estaba (${original}): ${e?.message || e}`)
      }
    }
    if (cortado) E.cambioNumero[variable] = Date.now() // alguien está ahí: se espera de nuevo los 2 minutos
    return { leidos, cortado }
  })
}

// ───────────────────────────── Cola para el servidor (cola\*.json) ─────────────────────────────

async function medirCola() {
  let total = 0
  try { for (const f of await readdir(P.cola)) if (f.endsWith(".json")) total += (await stat(join(P.cola, f))).size } catch { /* vacía */ }
  E.tamCola = total
  return total
}

/** Lo que se sube nunca se pierde (reportes, recetas, totales); el muestreo crudo se descarta primero si la cola se llena. */
export async function encolar(obj) {
  await mkdir(P.rechazados, { recursive: true })
  const cuerpo = JSON.stringify({ ...obj, at: obj.at || new Date().toISOString(), version: VERSION, pedido: obj.pedido || randomUUID() })
  const crudo = obj.tipo === "eventos" && obj.eventos?.every((e) => e.tipo === "vivo_crudo")
  if (E.tamCola == null) await medirCola()
  if (E.tamCola + cuerpo.length > MAX_COLA) {
    for (const f of (await readdir(P.cola)).filter((x) => x.endsWith("-crudo.json")).sort()) {
      if (E.tamCola + cuerpo.length <= MAX_COLA) break
      try { const s = (await stat(join(P.cola, f))).size; await unlink(join(P.cola, f)); E.tamCola -= s } catch { /* nada */ }
    }
    if (E.tamCola + cuerpo.length > MAX_COLA) {
      if (crudo) return
      await log("Ojo: la cola pasó los 50 MB (sin internet hace mucho). Lo importante se sigue guardando.")
    }
  }
  const nombre = `${Date.now()}-${String(++E.secuencia).padStart(6, "0")}-${crudo ? "crudo" : obj.tipo}.json`
  await writeFile(join(P.cola, nombre), cuerpo, "utf8")
  E.tamCola += cuerpo.length
}

const encolarEvento = (tipo, detalle) => encolar({ tipo: "eventos", eventos: [{ tipo, at: new Date().toISOString(), detalle, pedido: randomUUID() }] })

async function postServidor(cuerpoTexto) {
  return pedir(`${X.SERVIDOR}/api/carga/puente`, {
    method: "POST", headers: { Authorization: `Bearer ${E.clave}`, "Content-Type": "application/json" }, body: cuerpoTexto,
  }, TIEMPO_SERVIDOR_MS)
}

/**
 * Clave rechazada (401): se vuelve a leer config.json. Si hay una clave nueva, se usa. Si es la misma y vuelve a dar
 * 401, el puente espera hasta 5 min (por si se corre instalar.cmd) y se cierra: iniciar.cmd lo vuelve a abrir.
 */
async function clave401() {
  const nueva = String((await leerJson(P.config))?.clave || "").trim()
  if (nueva && nueva !== E.clave) {
    E.clave = nueva
    E.n401 = 0
    await log("Clave nueva en config.json: se usa esa")
    return "reintentar"
  }
  E.n401++
  if (E.n401 < 2) {
    await log("La clave del puente no anda (401): se prueba una vez más")
    E.pausaServidorHasta = Date.now() + 30_000
    return "parar"
  }
  await log("La clave sigue sin andar: generá una nueva y corré instalar.cmd. El puente se cierra y vuelve a abrir.")
  const hasta = Date.now() + ajustes.espera401Ms
  while (Date.now() < hasta) {
    const c = String((await leerJson(P.config))?.clave || "").trim()
    if (c && c !== E.clave) break
    await espera(Math.min(5000, Math.max(0, hasta - Date.now())))
  }
  await salirSoltando(3)
  return "parar"
}

/** Atiende la respuesta: 401 lo de arriba; 409 frena 5 min; otro 4xx aparta el envío (no traba la cola). */
export async function atender(r, que) {
  if (r.status === 401) return clave401()
  if (r.status === 409) { if (!E.apagado) await log("Puesto apagado en el sistema: el puente queda quieto y prueba cada 5 min."); E.apagado = true; E.pausaServidorHasta = Date.now() + 5 * 60_000; return "parar" }
  if (r.ok) {
    E.apagado = false
    E.n401 = 0
    const j = await r.json().catch(() => ({}))
    for (const n of Array.isArray(j?.leer_recetas) ? j.leer_recetas : []) if (Number.isInteger(n)) E.recetasPedidas.add(n)
    return "ok"
  }
  if (r.status >= 400 && r.status < 500) { await log(`El servidor rechazó ${que} (${r.status}): queda aparte en cola\\rechazados`); return "rechazado" }
  return "reintentar"
}

/** Sube la cola en orden. Sale de la cola solo lo que el servidor aceptó. */
export async function subirCola() {
  if (!E.clave || Date.now() < E.pausaServidorHasta) return
  let archivos
  try { archivos = (await readdir(P.cola)).filter((f) => f.endsWith(".json")).sort() } catch { return }
  for (const f of archivos) {
    const ruta = join(P.cola, f)
    let texto
    try { texto = await readFile(ruta, "utf8") } catch { continue }
    let r
    try { r = await postServidor(texto) } catch { E.pausaServidorHasta = Date.now() + 10_000; return } // sin internet
    const que = await atender(r, f)
    if (que === "ok") { await unlink(ruta).catch(() => {}); E.tamCola = Math.max(0, (E.tamCola ?? 0) - texto.length) }
    else if (que === "rechazado") { await rename(ruta, join(P.rechazados, f)).catch(() => {}); E.tamCola = Math.max(0, (E.tamCola ?? 0) - texto.length) }
    else { if (que === "reintentar" && Date.now() >= E.pausaServidorHasta) E.pausaServidorHasta = Date.now() + 10_000; return }
  }
}

/** El latido no se encola: si no sale, vale el próximo (solo importa el último). */
async function mandarLatido(variables) {
  if (!E.clave || Date.now() < E.pausaServidorHasta) return false
  const cuerpo = JSON.stringify({ tipo: "latido", at: new Date().toISOString(), version: VERSION, pedido: randomUUID(), variables, puente: { mediana_ms: mediana(), lento: factor() > 1, cola: E.tamCola } })
  try { return (await atender(await postServidor(cuerpo), "el latido")) === "ok" } catch { return false }
}

// ───────────────────────────── Config de la nube (cada 5 min) ─────────────────────────────

export async function bajarConfig() {
  try {
    const r = await pedir(`${X.SERVIDOR}/api/carga/puente`, { method: "GET", headers: { Authorization: `Bearer ${E.clave}` } }, TIEMPO_SERVIDOR_MS)
    if (r.status === 401 || r.status === 409) { await atender(r, "la config"); return }
    if (!r.ok) throw new Error(`el servidor respondió ${r.status}`)
    const j = await r.json()
    if (!j?.variables?.estado?.length) throw new Error("config sin variables")
    if (!E.config) await log(`Config de la nube: puesto «${j.puesto?.nombre}» (${j.puesto?.etapa})`)
    E.apagado = false
    E.n401 = 0
    E.config = j
    E.cad = cadenciasSeguras(j.cadencias)
    await writeFile(P.nube, JSON.stringify(j), "utf8").catch(() => {})
    const dif = Date.parse(j.hora_servidor) - Date.now()
    if (Math.abs(dif) > 120_000 && Date.now() - E.ultimoAvisoReloj > 3600_000) {
      E.ultimoAvisoReloj = Date.now()
      await log(`El reloj de esta PC está corrido ${Math.round(dif / 1000)} s`)
      await encolarEvento("reloj_pc", { diferencia_s: Math.round(dif / 1000) })
    }
  } catch (e) {
    if (!E.config) {
      E.config = await leerJson(P.nube)
      if (E.config) E.cad = cadenciasSeguras(E.config.cadencias)
      await log(E.config ? "Sin internet: uso la última config guardada" : `No se pudo bajar la config (${e?.message || e}): se reintenta`)
    }
  }
}

// ───────────────────────────── Tareas ─────────────────────────────

const enCiclo = (v) => !!v && v["Receta.Proceso"] != null && String(v["Receta.Proceso"]).trim().toLowerCase() !== "fin"
const humedades = (v) => [1, 2, 3, 4].map((i) => v[`Receta.Parametros.HumedadArido${i}`] ?? null)

async function tareaEstado() {
  let v
  try { v = await leer(E.config.variables.estado) } catch {
    E.prox.estado = Date.now() + (E.sinRed ? 10_000 : cad("estado_quieta_s"))
    return
  }
  const ahora = Date.now()
  const iso = new Date(ahora).toISOString()
  // ¿Alguien está mirando REPORTE o RECETAS en Indumix? (el número cambió)
  for (const k of Object.keys(E.cambioNumero)) if (E.anterior && v[k] !== E.anterior[k]) E.cambioNumero[k] = ahora
  // Cualquier cambio en la receta que se está editando (Receta_Editar.*, beReceta) = alguien en RECETAS
  if (E.anterior && Object.keys(v).some((k) => deEdicion(k) && v[k] !== E.anterior[k])) E.cambioNumero["Receta.neReceta"] = ahora
  // Inicio y fin de cada carga (para la hora real y la humedad con que se pesó)
  const ya = enCiclo(v), antes = enCiclo(E.anterior)
  if (E.anterior && !antes && ya) E.cargaEnCurso = { inicio_at: iso, humedades: humedades(v) }
  if (E.anterior && antes && !ya) {
    if (E.cargaEnCurso) {
      // Se asocia al reporte solo por el contador del fin
      E.vistos.push({ ...E.cargaEnCurso, fin_at: iso, contador_fin: v["@GV.Cont_Ciclo"] })
      if (E.vistos.length > 12) E.vistos.shift()
      E.cargaEnCurso = null
    }
    E.prox.reporte1 = Math.min(E.prox.reporte1, ahora + E.cad.espera_fin_s * 1000)
    E.prox.totales = Math.min(E.prox.totales, ahora + E.cad.espera_fin_s * 1000)
  }
  if (E.anterior && Number(v["@GV.Cont_Ciclo"]) > Number(E.anterior["@GV.Cont_Ciclo"])) E.prox.reporte1 = Math.min(E.prox.reporte1, ahora + E.cad.espera_fin_s * 1000)
  E.anterior = v
  E.prox.estado = ahora + (ya ? cad("estado_ciclo_s") : cad("estado_quieta_s"))

  // Latido: con carga en curso cada 5 s; quieta, apenas cambia algo y si no, como mucho cada 60 s (el reloj)
  const ruido = new Set([...(E.config.ruido || []), "@GV.FechaHoraActual"])
  const firma = JSON.stringify(Object.entries(v).filter(([k]) => !ruido.has(k)))
  const toca = ya ? ahora - E.ultimoLatidoMs >= cad("latido_ciclo_s") : firma !== E.ultimaFirma || ahora - E.ultimoLatidoMs >= cad("latido_quieta_max_s")
  if (toca && (await mandarLatido(v))) { E.ultimoLatidoMs = ahora; E.ultimaFirma = firma }

  // Muestreo crudo para la fase 2 (7 días, con carga en curso, cada 30 s)
  const hasta = Date.parse(E.config.muestrear_crudo_hasta || "")
  if (ya && Number.isFinite(hasta) && ahora < hasta && ahora >= E.prox.crudo) {
    E.prox.crudo = ahora + cad("crudo_s")
    await encolar({ tipo: "eventos", eventos: [{ tipo: "vivo_crudo", at: iso, detalle: { variables: v }, pedido: randomUUID() }] })
  }
}

/**
 * Cuándo volver a probar si no se pudo barrer: si el puente recién arrancó, apenas pasan los 2 minutos sin cambios; si
 * alguien cambió el número (está navegando esa pantalla), dentro de 15 min (posponer_s).
 */
function cuandoReintentar(variable, ahora) {
  if (E.cambioNumero[variable] === E.arranque) return E.arranque + esperaNavegandoMs() + 1000
  return ahora + Math.max(cad("posponer_s"), esperaNavegandoMs())
}

/** Se lee un número solo si nadie lo cambió en los últimos 2 min (si cambió, alguien está navegando esa pantalla). */
export function navegando(variable, ahora = Date.now()) {
  if (!E.anterior || E.anterior[variable] === undefined) return "todavía no se leyó el estado"
  if (ahora - E.cambioNumero[variable] < esperaNavegandoMs()) return `${variable} cambió hace menos de 2 min (o el puente recién arranca)`
  return null
}

export async function tareaReportes(slots) {
  const ahora = Date.now()
  const todos = slots.length > 1
  const motivo = navegando("Receta.neReporte", ahora)
  if (motivo) {
    await log(`Lectura de reportes pospuesta (${motivo})`)
    const t = cuandoReintentar("Receta.neReporte", ahora)
    if (todos) E.prox.reportes = t
    E.prox.reporte1 = Math.max(E.prox.reporte1, t)
    return
  }
  if (todos) E.prox.reportes = ahora + cad("reportes_s")
  E.prox.reporte1 = ahora + cad("reporte_s")
  if (!(await candadoPropio())) return
  let r
  try { r = await leerNumerados("Receta.neReporte", slots, E.config.variables.reporte) } catch (e) { await log(`Lectura de reportes fallida: ${e?.message || e}`); return }
  const { leidos, cortado } = r
  if (cortado) await log(`Lectura de reportes cortada (${cortado})`)
  const reportes = leidos.map((x) => {
    const n = String(x.variables["Receta.Reporte_WEB.NCarga"] ?? "")
    const v = E.vistos.find((c) => String(c.contador_fin) === n)
    return { slot: x.numero, variables: x.variables, ...(v ? { visto: { inicio_at: v.inicio_at, fin_at: v.fin_at, humedades: v.humedades } } : {}) }
  })
  if (reportes.length) await encolar({ tipo: "reportes", reportes })
}

/**
 * Barre recetas. La próxima lectura se fija ANTES de barrer (programada: recetas_s; pedidas: posponer_s), así si
 * Indumix falla no se reintenta en la vuelta siguiente: como mucho un barrido por cadencia.
 */
export async function tareaRecetas(numeros, programada) {
  const ahora = Date.now()
  const motivo = enCiclo(E.anterior) ? "hay una carga en curso" : !quieta(E.anterior) ? "no se sabe si la planta está quieta" : navegando("Receta.neReceta", ahora)
  const posponer = () => cuandoReintentar("Receta.neReceta", ahora)
  if (motivo) {
    await log(`Lectura de recetas pospuesta (${motivo})`)
    if (programada) E.prox.recetas = posponer(); else E.recetasPedidasProx = posponer()
    return false
  }
  if (programada) E.prox.recetas = ahora + cad("recetas_s")
  else E.recetasPedidasProx = ahora + Math.max(cad("posponer_s"), esperaNavegandoMs())
  if (!(await candadoPropio())) return false
  let r
  try { r = await leerNumerados("Receta.neReceta", numeros, E.config.variables.receta) } catch (e) { await log(`Lectura de recetas fallida: ${e?.message || e}`); return false }
  const { leidos, cortado } = r
  if (leidos.length) await encolar({ tipo: "recetas", recetas: leidos, completa: !cortado && numeros.length >= 20 && leidos.length === numeros.length })
  if (cortado) {
    await log(`Lectura de recetas pospuesta (${cortado})`)
    // Se reintenta antes que la cadencia completa, pero nunca antes de posponer_s (5 min como mínimo)
    const t = Math.max(posponer(), ahora + MINIMOS.posponer_s * 1000)
    if (programada) E.prox.recetas = Math.min(E.prox.recetas, t); else E.recetasPedidasProx = t
    return false
  }
  return true
}

/** Justo antes de barrer: si otro puente tiene el candado, este no barre y se cierra. */
async function candadoPropio() {
  if (await tomarCandado()) return true
  await log("Otro puente tiene el candado: este no barre y se cierra.")
  ajustes.salir(0)
  return false
}

async function tareaTotales() {
  E.prox.totales = Date.now() + cad("totales_s")
  try { await encolar({ tipo: "totales", variables: await leer(E.config.variables.totales) }) } catch { /* sin red: se reintenta */ }
}

/** Si instalar.cmd dejó una clave nueva en config.json, este puente se cierra (iniciar.cmd lo abre con la nueva). */
export async function vigilarClave() {
  const c = String((await leerJson(P.config))?.clave || "").trim()
  if (c && E.clave && c !== E.clave) {
    await log("Hay una clave nueva en config.json: el puente se reinicia para usarla")
    await salirSoltando(0)
  }
}

// ───────────────────────────── Vuelta principal ─────────────────────────────

export async function principal() {
  await esperarTurno()
  const local = await leerJson(P.config)
  if (!local?.clave) { console.error("Falta la clave en config.json: corré instalar.cmd."); ajustes.salir(1); return }
  E.base = X.baseIndumix(local.indumix || "http://192.168.0.10")
  E.clave = String(local.clave).trim()
  await log(`Arranca el puente ${VERSION} (Node ${process.version}) · Indumix ${E.base} · servidor ${X.SERVIDOR}`)
  await encolarEvento("arranque", { version: VERSION, node: process.version })
  await limpiarRegistro()
  for (;;) {
    await paso()
    await espera(500)
  }
}

/** Una vuelta del ciclo principal (exportada para probarla). */
export async function paso() {
    const ahora = Date.now()
    try {
      if (ahora >= E.prox.candado) {
        E.prox.candado = ahora + CANDADO_RENUEVA_MS
        if (!(await tomarCandado(ahora))) { await log("Otro puente tomó el candado: este se cierra."); ajustes.salir(0) }
      }
      if (ahora >= E.prox.clave) { E.prox.clave = ahora + 10_000; await vigilarClave() }
      if (ahora >= E.prox.config) { E.prox.config = ahora + cad("config_s") / factor(); await bajarConfig() }
      if (E.config && !E.apagado) {
        if (ahora >= E.prox.estado) await tareaEstado()
        if (!E.sinRed && E.anterior) {
          if (ahora >= E.prox.reportes) await tareaReportes([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
          else if (ahora >= E.prox.reporte1) await tareaReportes([1])
          if (ahora >= E.prox.recetas) await tareaRecetas(Array.from({ length: 20 }, (_, i) => i + 1), true)
          else if (E.recetasPedidas.size && ahora >= E.recetasPedidasProx) {
            const lista = [...E.recetasPedidas].filter((n) => n >= 1 && n <= 20).sort((a, b) => a - b)
            if (await tareaRecetas(lista, false)) E.recetasPedidas.clear()
          }
          if (ahora >= E.prox.totales) await tareaTotales()
        }
      }
      await subirCola()
      if (ahora >= E.prox.limpieza) { E.prox.limpieza = ahora + 6 * 3600_000; await limpiarRegistro() }
    } catch (e) {
      await log(`Error: ${e?.message || e}`)
    }
}

// ───────────────────────────── Instalación (instalar.cmd) ─────────────────────────────

/**
 * Pide la clave (no va como argumento: no queda a la vista), la guarda en config.json y deja el arranque en la carpeta
 * Inicio. El archivo de Inicio usa %USERPROFILE% cuando se puede, así anda con usuarios con tildes o ñ.
 */
async function instalar() {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const clave = String(await rl.question("Pega la clave del puente (empieza con rbp_) y apreta Enter: ")).trim()
  rl.close()
  if (!/^rbp_[A-Za-z0-9_-]{20,}$/.test(clave)) {
    console.error("Esa clave no parece la del puente (empieza con rbp_). Generala de nuevo en Carga de planta › Recetas de la planta › Puente.")
    ajustes.salir(1)
    return
  }
  const actual = (await leerJson(P.config)) || (await leerJson(join(P.dir, "config.ejemplo.json"))) || { indumix: "http://192.168.0.10" }
  X.baseIndumix(actual.indumix) // que la dirección de Indumix sea válida
  actual.clave = clave
  await writeFile(P.config, JSON.stringify(actual, null, 2) + "\n", "utf8")
  console.log("Clave guardada en config.json.")
  const appdata = process.env.APPDATA
  if (!appdata) { console.log("No se encontró la carpeta Inicio: el puente no va a arrancar solo al prender la PC."); return }
  const inicio = join(appdata, "Microsoft", "Windows", "Start Menu", "Programs", "Startup")
  const perfil = process.env.USERPROFILE || ""
  const iniciar = join(P.dir, "iniciar.cmd")
  const rel = perfil ? relative(perfil, iniciar) : ""
  // %USERPROFILE% lo expande Windows (sin problemas de tildes); el resto del camino tiene que ser ASCII
  const camino = perfil && rel && !rel.startsWith("..") && /^[\x20-\x7e]+$/.test(rel) ? `%USERPROFILE%${sep}${rel}` : iniciar
  const ascii = /^[\x20-\x7e]+$/.test(camino)
  const lineas = ["@echo off", ...(ascii ? [] : ["chcp 65001 >nul"]), `start "PUENTE REBUCRET - NO CERRAR" /min cmd /c ""${camino}""`, ""]
  await mkdir(inicio, { recursive: true })
  await writeFile(join(inicio, "Puente Rebucret.cmd"), lineas.join("\r\n"), "utf8")
  console.log("Queda para que arranque solo al iniciar la sesión de Windows.")
}

const esPrincipal = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (esPrincipal) {
  if (process.argv.includes("--instalar")) await instalar()
  else if (process.argv.includes("--hay-otro")) ajustes.salir((await hayOtroAndando()) ? 0 : 1)
  else if (process.argv.includes("--esperar-arranque")) ajustes.salir((await esperarArranque(40_000)) ? 0 : 1)
  else await principal()
}
