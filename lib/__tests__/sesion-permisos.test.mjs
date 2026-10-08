// Pruebas de la fase 0c-1: permisos, contraseñas, sesión firmada y reglas de ingreso.
// Sin base ni red. Los valores de contraseña son de prueba ("prueba123").
import { test } from "node:test"
import assert from "node:assert/strict"
import * as P from "../permisos.ts"
import * as C from "../auth/clave.ts"
import * as T from "../auth/token.ts"
import * as I from "../auth/ingreso.ts"

// ---------------------------------------------------------------- permisos
test("plantillas: gerencial todo, operario ve + agregar muestra, consulta solo ve", () => {
  const g = P.plantilla("gerencial")
  const o = P.plantilla("operario")
  const c = P.plantilla("consulta")
  for (const s of P.SECCIONES) {
    for (const a of P.ACCIONES) {
      const existe = s.acciones.includes(a)
      assert.equal(g[s.clave][a], existe, `gerencial ${s.clave}.${a}`)
      const verC = existe && a === "ver" && s.clave !== "usuarios"
      assert.equal(c[s.clave][a], verC, `consulta ${s.clave}.${a}`)
      assert.equal(o[s.clave][a], verC || (s.clave === "historial" && a === "cargar"), `operario ${s.clave}.${a}`)
    }
  }
})

test("gerencial puede todo aunque su matriz diga otra cosa", () => {
  const u = { tipo: "gerencial", permisos: {} }
  assert.equal(P.puedeCon(u, "historial", "borrar"), true)
  assert.equal(P.puedeCon(u, "usuarios", "ver"), true)
  assert.equal(P.puedeCon(u, "recuentos", "cargar"), true)
  // las acciones que no existen dan false igual
  assert.equal(P.puedeCon(u, "despacho", "editar"), false)
  assert.equal(P.puedeCon(u, "mantenimiento", "editar"), false)
})

test("usuarios no se habilita por persona", () => {
  const u = { tipo: "operario", permisos: { usuarios: { ver: true, cargar: true, editar: true, borrar: true } } }
  assert.equal(P.puedeCon(u, "usuarios", "ver"), false)
})

test("claves que faltan = false, acciones que no existen = false, basura normalizada", () => {
  assert.equal(P.puedeCon({ tipo: "operario", permisos: {} }, "programacion", "ver"), false)
  assert.equal(P.puedeCon({ tipo: "operario", permisos: { despacho: { editar: true } } }, "despacho", "editar"), false)
  assert.equal(P.puedeCon({ tipo: "operario", permisos: { laboratorio: { cargar: "true" } } }, "laboratorio", "cargar"), false)
  assert.equal(P.puedeCon(null, "programacion", "ver"), false)
  assert.equal(P.puedeCon({ tipo: "raro", permisos: P.plantilla("gerencial") }, "programacion", "borrar"), true, "tipo inválido = consulta, pero usa su matriz")
  for (const basura of [null, undefined, 3, "x", [], [1], { programacion: [] }, { programacion: null }]) {
    const n = P.normalizarPermisos(basura)
    assert.deepEqual(Object.keys(n), P.SECCIONES.map((s) => s.clave))
    for (const s of P.SECCIONES) for (const a of P.ACCIONES) assert.equal(n[s.clave][a], false)
  }
  // cargar implica ver
  const n = P.normalizarPermisos({ laboratorio: { cargar: true } })
  assert.equal(n.laboratorio.ver, true)
  // recuentos no tiene "ver"
  assert.equal(P.normalizarPermisos({ recuentos: { ver: true, cargar: true } }).recuentos.ver, false)
})

test("cambiarPermiso: tildar cargar tilda ver; destildar ver destilda todo", () => {
  let p = P.plantilla("consulta")
  p = P.cambiarPermiso(p, "historial", "editar", true)
  assert.equal(p.historial.ver, true)
  assert.equal(p.historial.editar, true)
  p = P.cambiarPermiso(p, "historial", "ver", false)
  assert.deepEqual(p.historial, { ver: false, cargar: false, editar: false, borrar: false })
  p = P.cambiarPermiso(p, "recuentos", "cargar", true)
  assert.equal(p.recuentos.cargar, true)
  assert.equal(p.recuentos.ver, false)
})

test("puedeAjustarPedido: editar todos; cargar solo los propios (respuesta 18.4)", () => {
  const titan = { name: "Titan Concretus", tipo: "operario", permisos: { programacion: { ver: true, cargar: true, editar: true } } }
  const felipe = { name: "Felipe Calvo", tipo: "operario", permisos: { programacion: { ver: true, cargar: true } } }
  const joaquin = { name: "Joaquin Graham", tipo: "consulta", permisos: P.plantilla("consulta") }
  const jefe = { name: "Bautista Caputo", tipo: "gerencial", permisos: {} }
  assert.equal(P.puedeAjustarPedido(titan, { created_by: "Felipe Calvo" }), true)
  assert.equal(P.puedeAjustarPedido(jefe, { created_by: null }), true)
  assert.equal(P.puedeAjustarPedido(felipe, { created_by: "Felipe Calvo" }), true)
  assert.equal(P.puedeAjustarPedido(felipe, { created_by: "  FELIPE  calvó " }), true, "normaliza como el login")
  assert.equal(P.puedeAjustarPedido(felipe, { created_by: "Titan Concretus" }), false)
  assert.equal(P.puedeAjustarPedido(felipe, { created_by: null }), false)
  assert.equal(P.puedeAjustarPedido(felipe, null), false)
  assert.equal(P.puedeAjustarPedido({ name: "Joaquin Graham", ...joaquin }, { created_by: "Joaquin Graham" }), false)
})

test("diferencias con la plantilla y cambios para Actividad", () => {
  const p = P.cambiarPermiso(P.plantilla("operario"), "laboratorio", "cargar", true)
  const d = P.diferenciasConPlantilla("operario", p)
  assert.deepEqual(d, [{ seccion: "laboratorio", accion: "cargar", valor: true, plantilla: false }])
  assert.deepEqual(P.diferenciasConPlantilla("gerencial", {}), [])
  assert.deepEqual(P.cambiosDePermisos(P.plantilla("operario"), p), { "Laboratorio · cargar": "no → sí" })
})

test("seccionDeRuta", () => {
  assert.equal(P.seccionDeRuta("/calidad"), "laboratorio")
  assert.equal(P.seccionDeRuta("/calidad?tab=rotura"), "laboratorio")
  assert.equal(P.seccionDeRuta("/historial-despachos"), "historial")
  assert.equal(P.seccionDeRuta("/plantista"), "despacho")
  assert.equal(P.seccionDeRuta("/actividad"), "usuarios")
  assert.equal(P.seccionDeRuta("/"), null)
  assert.equal(P.seccionDeRuta("/logistica/tiempos"), null)
  assert.equal(P.seccionDeRuta("/informes"), null)
})

// ---------------------------------------------------------------- contraseñas
test("hash y verificación", async () => {
  const h = await C.hashClave("prueba123")
  assert.match(h, /^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/)
  assert.ok(!h.includes("prueba123"))
  assert.equal(await C.verificarClave("prueba123", h), true)
  assert.equal(await C.verificarClave("Prueba123", h), false, "distingue mayúsculas")
  assert.equal(await C.verificarClave("otra", h), false)
  const h2 = await C.hashClave("prueba123")
  assert.notEqual(h, h2, "sal aleatoria")
})

test("hash con otro formato o basura: false sin tirar error", async () => {
  for (const malo of [null, undefined, "", "texto", "bcrypt$x$y", "scrypt$abc$8$1$AAAA$BBBB", "scrypt$16384$8$1$$", "scrypt$99999999$8$1$AAAA$BBBB"]) {
    assert.equal(await C.verificarClave("prueba123", malo), false, String(malo))
  }
  assert.equal(await C.verificarClave(undefined, await C.hashClave("prueba123")), false)
})

test("validación de la contraseña nueva", () => {
  assert.equal(C.validarClaveNueva("Ana Prueba", "prueba123"), null)
  assert.match(C.validarClaveNueva("Ana Prueba", "abc"), /al menos 6/)
  assert.match(C.validarClaveNueva("Ana Prueba", "ana prueba"), /tu nombre/)
  assert.match(C.validarClaveNueva("Ana Prueba", " prueba123 "), /espacios/)
  // la común de antes no sirve como contraseña nueva (sin escribirla acá: se arma con esClaveComun)
  assert.equal(C.esClaveComun("prueba123"), false)
})

// ---------------------------------------------------------------- sesión firmada
test("token: firma, adulterado, vencido, sin secreto", () => {
  const viejo = process.env.SESION_SECRETO
  process.env.SESION_SECRETO = "x".repeat(48)
  const ahora = Date.now()
  const t = T.firmarSesion({ u: "u-1", v: 3, e: ahora + 60000 })
  assert.deepEqual(T.leerSesion(t, ahora), { u: "u-1", v: 3, e: ahora + 60000 })
  // adulterado: otro contenido con la misma firma
  const [cuerpo, firma] = t.split(".")
  const otro = Buffer.from(JSON.stringify({ u: "u-2", v: 3, e: ahora + 60000 })).toString("base64url")
  assert.equal(T.leerSesion(`${otro}.${firma}`, ahora), null)
  assert.equal(T.leerSesion(`${cuerpo}.${firma.slice(0, -2)}xx`, ahora), null)
  assert.equal(T.leerSesion("basura", ahora), null)
  assert.equal(T.leerSesion("", ahora), null)
  assert.equal(T.leerSesion(null, ahora), null)
  // vencido
  assert.equal(T.leerSesion(t, ahora + 60001), null)
  // otro secreto
  process.env.SESION_SECRETO = "y".repeat(48)
  assert.equal(T.leerSesion(t, ahora), null)
  // sin secreto (o corto)
  process.env.SESION_SECRETO = "corto"
  assert.throws(() => T.firmarSesion({ u: "u-1", v: 1, e: ahora + 1 }), (e) => e.codigo === "sin_secreto")
  delete process.env.SESION_SECRETO
  assert.throws(() => T.leerSesion(t, ahora), (e) => e.codigo === "sin_secreto")
  if (viejo !== undefined) process.env.SESION_SECRETO = viejo
})

// ---------------------------------------------------------------- reglas de ingreso
const AHORA = new Date("2026-10-07T10:00:00Z")
const cred = (o = {}) => ({ clave_hash: null, debe_cambiar: false, permite_clave_comun: false, intentos_fallidos: 0, bloqueado_hasta: null, ...o })
// Para las pruebas: la "común" es "comun-prueba" y el hash "H" corresponde a "prueba123"
const esComun = (c) => c === "comun-prueba"
const verificar = (c, h) => h === "H" && c === "prueba123"
const entrar = (credencial, clave, activo = true) => I.decidirIngreso({ credencial, activo, clave, ahora: AHORA, verificar, esComun })

test("1. inexistente o inactivo", async () => {
  const r = await entrar(cred({ clave_hash: "H" }), "prueba123", false)
  assert.equal(r.ok, false)
  assert.equal(r.error, I.ERROR_INCORRECTO)
  assert.equal(r.cambios, null)
})

test("2. bloqueado", async () => {
  const r = await entrar(cred({ clave_hash: "H", bloqueado_hasta: new Date(AHORA.getTime() + 4.2 * 60000).toISOString() }), "prueba123")
  assert.equal(r.ok, false)
  assert.match(r.error, /Esperá 5 minutos/)
  // bloqueo vencido: entra
  const r2 = await entrar(cred({ clave_hash: "H", bloqueado_hasta: new Date(AHORA.getTime() - 1000).toISOString() }), "prueba123")
  assert.equal(r2.ok, true)
  assert.equal(r2.cambios.bloqueado_hasta, null)
})

test("3. con contraseña propia vale solo esa (la común ya no, aunque siga permitida)", async () => {
  assert.equal((await entrar(cred({ clave_hash: "H", permite_clave_comun: true }), "prueba123")).ok, true)
  const r = await entrar(cred({ clave_hash: "H", permite_clave_comun: true }), "comun-prueba")
  assert.equal(r.ok, false)
  assert.equal(r.cambios.intentos_fallidos, 1)
})

test("4. primer ingreso con la común: entra y tiene que elegir", async () => {
  const r = await entrar(cred({ permite_clave_comun: true, debe_cambiar: true }), "comun-prueba")
  assert.equal(r.ok, true)
  assert.equal(r.debeCambiar, true)
  const r2 = await entrar(cred({ permite_clave_comun: true, debe_cambiar: false }), "comun-prueba")
  assert.equal(r2.debeCambiar, true, "con la común siempre tiene que elegir")
})

test("5. sin contraseña ni primer ingreso (o sin fila)", async () => {
  assert.equal((await entrar(cred(), "comun-prueba")).error, I.ERROR_SIN_CLAVE)
  assert.equal((await entrar(null, "comun-prueba")).error, I.ERROR_SIN_CLAVE)
})

test("6. contraseña mal suma intentos; al quinto, 10 minutos de bloqueo", async () => {
  const r = await entrar(cred({ clave_hash: "H", intentos_fallidos: 3 }), "mal")
  assert.deepEqual(r.cambios, { intentos_fallidos: 4 })
  assert.equal(r.error, I.ERROR_INCORRECTO)
  const r5 = await entrar(cred({ clave_hash: "H", intentos_fallidos: 4 }), "mal")
  assert.equal(r5.ok, false)
  assert.equal(r5.cambios.intentos_fallidos, 0)
  assert.equal(r5.cambios.bloqueado_hasta, new Date(AHORA.getTime() + 10 * 60000).toISOString())
  assert.match(r5.error, /Esperá 10 minutos/)
})

test("7. bien: intentos a cero y último ingreso; alta o blanqueo pide cambiarla", async () => {
  const r = await entrar(cred({ clave_hash: "H", intentos_fallidos: 2 }), "prueba123")
  assert.equal(r.ok, true)
  assert.equal(r.debeCambiar, false)
  assert.deepEqual(r.cambios, { intentos_fallidos: 0, bloqueado_hasta: null, ultimo_ingreso_at: AHORA.toISOString() })
  const r2 = await entrar(cred({ clave_hash: "H", debe_cambiar: true }), "prueba123")
  assert.equal(r2.debeCambiar, true)
})

test("con las funciones reales: después de elegir la suya, la común ya no vale", async () => {
  const h = await C.hashClave("prueba123")
  const real = (credencial, clave) => I.decidirIngreso({ credencial, activo: true, clave, ahora: AHORA, verificar: C.verificarClave, esComun: C.esClaveComun })
  const elegida = cred({ clave_hash: h, permite_clave_comun: false })
  assert.equal((await real(elegida, "prueba123")).ok, true)
  // cualquier texto que no sea su contraseña falla, incluida la común (no la escribimos: probamos que
  // ninguna variante de mayúsculas de la propia entra)
  assert.equal((await real(elegida, "PRUEBA123")).ok, false)
})

test("mensaje después del intento fallido atómico (registrar_ingreso_fallido)", () => {
  const ahora = new Date("2026-10-07T10:00:00Z")
  assert.equal(I.errorTrasIntentoFallido({ intentos: 3, bloqueado: null, ya_bloqueado: false }, ahora), I.ERROR_INCORRECTO)
  // al 5.º la base deja 10 minutos de bloqueo
  const hasta = new Date(ahora.getTime() + 10 * 60000).toISOString()
  assert.match(I.errorTrasIntentoFallido({ intentos: 0, bloqueado: hasta, ya_bloqueado: false }, ahora), /Esperá 10 minutos/)
  // ya estaba bloqueado (pedido en paralelo): avisa lo que falta
  const falta = new Date(ahora.getTime() + 61000).toISOString()
  assert.match(I.errorTrasIntentoFallido({ intentos: 0, bloqueado: falta, ya_bloqueado: true }, ahora), /Esperá 2 minutos/)
  // bloqueo vencido o sin fila
  assert.equal(I.errorTrasIntentoFallido({ intentos: 1, bloqueado: new Date(ahora.getTime() - 1).toISOString(), ya_bloqueado: false }, ahora), I.ERROR_INCORRECTO)
  assert.equal(I.errorTrasIntentoFallido(null, ahora), I.ERROR_INCORRECTO)
})
