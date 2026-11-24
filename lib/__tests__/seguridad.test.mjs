// Fase 0c-2 · Seguridad en la base (docs/migracion-loop/fase-0c.md, "0c-2 · Especificación técnica").
// Sin base ni red: token para la base, freno de intentos, lectura de Concretus y controles sobre las migraciones
// (que toda escritura del navegador tenga su regla, que las tablas nuevas prendan la RLS y que las funciones del
// motor conserven el control de permisos).
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import * as J from "../auth/jwt-supabase.ts"
import * as I from "../auth/intentos.ts"
import * as C from "../concretus-lectura.ts"
import { SECCIONES, existeAccion } from "../permisos.ts"

const RAIZ = fileURLToPath(new URL("../../", import.meta.url))
const MIG = join(RAIZ, "supabase/migrations")
const MIG_RLS = "202611241900_seguridad_rls.sql"
const sqlRls = readFileSync(join(MIG, MIG_RLS), "utf8")

// ---------------------------------------------------------------- token para la base
const SECRETO = "s".repeat(40)
const AHORA = Date.UTC(2026, 10, 24, 12, 0, 0)

test("token: firma HS256 con los datos que espera la base (role, aud, iss, sub, v) y 8 horas", () => {
  const t = J.firmarTokenBase({ sub: "11111111-2222-3333-4444-555555555555", v: 3 }, SECRETO, AHORA)
  const [cab] = t.split(".")
  assert.deepEqual(JSON.parse(Buffer.from(cab, "base64url").toString()), { alg: "HS256", typ: "JWT" })
  const c = J.leerTokenBase(t, SECRETO, AHORA)
  assert.equal(c.role, "authenticated")
  assert.equal(c.aud, "authenticated")
  assert.equal(c.iss, "rebucret")
  assert.equal(c.sub, "11111111-2222-3333-4444-555555555555")
  assert.equal(c.v, 3)
  assert.equal(c.exp - c.iat, 8 * 3600)
  // sin permisos ni nombre en el token: la base los lee en el momento
  assert.equal("permisos" in c, false)
  assert.equal("tipo" in c, false)
})

test("token: lleva el id de la sesión del equipo (para que Salir lo corte), si lo hay", () => {
  const con = J.leerTokenBase(J.firmarTokenBase({ sub: "u1", v: 1, s: "abcdefgh123" }, SECRETO, AHORA), SECRETO, AHORA)
  assert.equal(con.s, "abcdefgh123")
  const sin = J.leerTokenBase(J.firmarTokenBase({ sub: "u1", v: 1 }, SECRETO, AHORA), SECRETO, AHORA)
  assert.equal("s" in sin, false)
})

test("token: adulterado, con otro secreto o vencido no vale", () => {
  const t = J.firmarTokenBase({ sub: "u1", v: 1 }, SECRETO, AHORA)
  const [a, b, f] = t.split(".")
  const otro = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(b, "base64url").toString()), sub: "u2" })).toString("base64url")
  assert.equal(J.leerTokenBase(`${a}.${otro}.${f}`, SECRETO, AHORA), null)
  assert.equal(J.leerTokenBase(t, "x".repeat(40), AHORA), null)
  assert.equal(J.leerTokenBase(t, SECRETO, AHORA + 8 * 3600 * 1000), null)
  assert.ok(J.leerTokenBase(t, SECRETO, AHORA + 8 * 3600 * 1000 - 1000))
  assert.equal(J.leerTokenBase("basura", SECRETO, AHORA), null)
  assert.equal(J.leerTokenBase(null, SECRETO, AHORA), null)
})

test("token: sin secreto (o corto) no hay token; datos incompletos tiran error", () => {
  assert.equal(J.secretoJwtBase({}), null)
  assert.equal(J.secretoJwtBase({ SUPABASE_JWT_SECRET: "corto" }), null)
  assert.equal(J.secretoJwtBase({ SUPABASE_JWT_SECRET: `  ${SECRETO}  ` }), SECRETO)
  assert.throws(() => J.firmarTokenBase({ sub: "", v: 1 }, SECRETO))
  assert.throws(() => J.firmarTokenBase({ sub: "u", v: 1.5 }, SECRETO))
  assert.throws(() => J.firmarTokenBase({ sub: "u", v: 1 }, ""))
})

// ---------------------------------------------------------------- freno de intentos
const headers = (h) => ({ get: (k) => h[k.toLowerCase()] ?? null })

test("intentos: IP de Vercel (x-real-ip, si no el primero de x-forwarded-for)", () => {
  assert.equal(I.ipDelPedido(headers({ "x-real-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9" })), "1.2.3.4")
  assert.equal(I.ipDelPedido(headers({ "x-forwarded-for": " 5.6.7.8 , 10.0.0.1" })), "5.6.7.8")
  assert.equal(I.ipDelPedido(headers({})), "desconocida")
  assert.equal(I.ipDelPedido(headers({ "x-real-ip": "a".repeat(200) })).length, 64)
})

test("intentos: mensaje con los minutos que faltan", () => {
  assert.match(I.errorDemasiadosIntentos(600), /Esperá 10 minutos/)
  assert.match(I.errorDemasiadosIntentos(61), /Esperá 2 minutos/)
  assert.match(I.errorDemasiadosIntentos(5), /Esperá 1 minuto /)
  assert.match(I.errorDemasiadosIntentos(NaN), /Esperá 15 minutos/)
})

test("intentos: lo que contesta ingreso_reservar (y sin la migración, sigue sin freno)", () => {
  assert.deepEqual(I.leerReserva([{ permitido: true, espera_seg: 0, intento_id: 7 }], null), { sinFreno: false, permitido: true, esperaSeg: 0, intentoId: 7 })
  assert.deepEqual(I.leerReserva({ permitido: false, espera_seg: 540, intento_id: null }, null), { sinFreno: false, permitido: false, esperaSeg: 540, intentoId: null })
  assert.equal(I.leerReserva(null, { code: "PGRST202", message: "Could not find the function public.ingreso_reservar" }).sinFreno, true)
  assert.equal(I.leerReserva(null, { code: "42883", message: "function does not exist" }).sinFreno, true)
  assert.throws(() => I.leerReserva(null, { code: "57014", message: "canceling statement due to statement timeout" }))
})

test("intentos: frenado con 5 suyos desde un lugar, o 50 de cualquiera desde su lugar; NO por persona sola", () => {
  const hace = (min) => new Date(AHORA - min * 60000).toISOString()
  const f = (u, ip, min) => ({ user_id: u, ip, creado_at: hace(min) })
  // 4 desde un lugar: todavía no
  assert.equal(I.esperaDePersona([1, 2, 3, 4].map((m) => f("a", "ip1", m)), "a", AHORA), 0)
  // 5 desde un lugar: frenado hasta que el 5.º (el más viejo, hace 5 min) cumpla 15 → 10 minutos
  const b5 = I.bloqueoDePersona([1, 2, 3, 4, 5].map((m) => f("a", "ip1", m)), "a", AHORA)
  assert.deepEqual(b5, { segundos: 600, motivo: "persona", ip: "ip1" })
  assert.match(I.textoBloqueo(b5), /frenado 10 min por intentos/)
  // Alguien de afuera probando con el id del plantista desde 10 lugares (o 4 + 4): el plantista NO queda frenado
  assert.equal(I.esperaDePersona([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((m) => f("a", `ip${m}`, m)), "a", AHORA), 0)
  assert.equal(I.esperaDePersona([...[1, 2, 3, 4].map((m) => f("a", "ip1", m)), ...[1, 2, 3, 4].map((m) => f("a", "ip2", m))], "a", AHORA), 0)
  // 50 errores de otros desde la conexión de la planta, donde él probó una vez: frenado "por su conexión"
  const planta = [...Array.from({ length: 49 }, (_, i) => f(`x${i}`, "planta", 1 + (i % 10))), f("a", "planta", 2)]
  const bl = I.bloqueoDePersona(planta, "a", AHORA)
  assert.equal(bl.motivo, "lugar")
  assert.equal(bl.ip, "planta")
  assert.match(I.textoBloqueo(bl), /IP planta/)
  // con 49 todavía no
  assert.equal(I.esperaDePersona(planta.slice(1), "a", AHORA), 0)
  // los de otra persona y los de hace más de 15 minutos no cuentan
  assert.equal(I.esperaDePersona([1, 2, 3, 4, 5].map((m) => f("b", "ip1", m)), "a", AHORA), 0)
  assert.equal(I.esperaDePersona([16, 17, 18, 19, 20].map((m) => f("a", "ip1", m)), "a", AHORA), 0)
  assert.equal(I.textoBloqueo({ segundos: 0, motivo: null, ip: null }), null)
})

test("intentos: la migración A usa los mismos límites que la pantalla", () => {
  const sqlA = readFileSync(join(MIG, "202611241800_seguridad_intentos_y_avisos.sql"), "utf8")
  assert.match(sqlA, new RegExp(`_ingreso_espera\\(${I.LIMITE_LUGAR}, ARRAY`))
  assert.match(sqlA, new RegExp(`_ingreso_espera\\(${I.LIMITE_PERSONA_LUGAR}, ARRAY`))
  // solo esos dos límites (sin uno por persona sola, que deja frenar al plantista desde afuera)
  assert.equal([...sqlA.matchAll(/_ingreso_espera\((\d+), ARRAY/g)].length, 2)
  assert.equal(I.LIMITE_PERSONA, undefined)
  // Desbloquear limpia también los lugares desde donde probó
  assert.match(sqlA, /OR ip IN \(SELECT i\.ip FROM public\.ingreso_intentos i WHERE i\.user_id = p_user_id\)/)
  assert.match(sqlA, new RegExp(`interval '${I.VENTANA_MIN} minutes'`))
  assert.match(sqlA, /pg_advisory_xact_lock/)
})

// ---------------------------------------------------------------- Concretus
const sp = (o) => new URLSearchParams(o)

test("Concretus: valida tipo, fechas ISO con zona y como mucho 3 días", () => {
  const ok = C.validarLectura(sp({ tipo: "despachos", desde: "2026-11-23T03:00:00Z", hasta: "2026-11-24T03:00:00Z" }))
  assert.equal(ok.ok, true)
  assert.equal(ok.params.desde, "2026-11-23T03:00:00.000Z")
  assert.equal(C.validarLectura(sp({ tipo: "clientes", desde: "2026-11-23T03:00:00Z", hasta: "2026-11-24T03:00:00Z" })).ok, false)
  assert.equal(C.validarLectura(sp({ tipo: "programacion", desde: "2026-11-23", hasta: "2026-11-24" })).ok, false)
  assert.equal(C.validarLectura(sp({ tipo: "programacion", desde: "2026-11-24T03:00:00Z", hasta: "2026-11-23T03:00:00Z" })).ok, false)
  assert.equal(C.validarLectura(sp({ tipo: "programacion", desde: "2026-11-01T03:00:00Z", hasta: "2026-11-24T03:00:00Z" })).ok, false)
  assert.equal(C.validarLectura(sp({ tipo: "programacion", desde: "2026-11-24T00:00:00-03:00", hasta: "2026-11-25T00:00:00-03:00" })).ok, true)
})

test("Concretus: solo las columnas del reporte, con nombres; sin pruebas ni cancelados", () => {
  const n = { clientes: new Map([["c1", "Cliente Uno"]]), obras: new Map([["o1", "Obra Uno"]]), formulas: new Map([["f1", "H21"]]) }
  const d = C.filasDespachos([
    { quantity_m3: "8", client_id: "c1", construction_site_id: "o1", formula_id: "f1", dispatch_date: "2026-11-23T12:00:00Z", is_test_dispatch: false, cuit: "20-1" },
    { quantity_m3: 1, is_test_dispatch: true },
  ], n)
  assert.equal(d.length, 1)
  assert.deepEqual(Object.keys(d[0]).sort(), ["client_id", "cliente", "construction_site_id", "dispatch_date", "formula", "formula_id", "is_test_dispatch", "obra", "quantity_m3"])
  assert.equal(d[0].quantity_m3, 8)
  assert.equal(d[0].cliente, "Cliente Uno")
  const p = C.filasProgramacion([
    { quantity_m3: 6, scheduled_arrival_time: "2026-11-24T14:00:00Z", status: "pending", client_id: "zz" },
    { quantity_m3: 6, scheduled_arrival_time: "2026-11-24T11:00:00Z", status: "completed", is_urgent: true, formula_id: "f1" },
    { quantity_m3: 6, scheduled_arrival_time: "2026-11-24T10:00:00Z", status: "cancelled" },
    { quantity_m3: 6, scheduled_arrival_time: "2026-11-24T09:00:00Z", status: null },
  ], n)
  assert.deepEqual(p.map((x) => x.scheduled_arrival_time), ["2026-11-24T11:00:00Z", "2026-11-24T14:00:00Z"])
  assert.equal(p[0].formula, "H21")
  assert.equal(p[0].is_urgent, true)
  assert.equal(p[1].cliente, null)
  assert.deepEqual(C.idsDe([{ a: "x" }, { a: "x" }, { a: null }, {}], "a"), ["x"])
})

// ---------------------------------------------------------------- migración B: permisos y reglas
/** Reglas de escritura de la migración B: Map tabla → Set de comandos (INSERT/UPDATE/DELETE). */
function reglasDeEscritura(sql) {
  const m = new Map()
  const add = (t, c) => (m.get(t) || m.set(t, new Set()).get(t)).add(c)
  for (const x of sql.matchAll(/\('([a-z_]+)',\s*'(INSERT|UPDATE|DELETE)',\s*ARRAY\[/g)) add(x[1], x[2])
  for (const x of sql.matchAll(/CREATE POLICY \w+ ON public\.([a-z_]+) FOR (INSERT|UPDATE|DELETE)/g)) add(x[1], x[2])
  return m
}

function clasificacion(sql) {
  const clases = {}
  for (const x of sql.matchAll(/SELECT unnest\(ARRAY\[([\s\S]*?)\]\), '([ABC])'/g)) {
    for (const t of x[1].match(/'([a-z_]+)'/g).map((s) => s.slice(1, -1))) clases[t] = x[2]
  }
  return clases
}

test("migración B: todos los permisos que usa existen ('seccion.accion' de lib/permisos.ts)", () => {
  const usados = new Set()
  for (const x of sqlRls.matchAll(/'([a-z_]+)\.([a-z]+)'/g)) {
    if (x[1] === "public" || x[1] === "storage" || x[1] === "seccion") continue
    usados.add(`${x[1]}.${x[2]}`)
  }
  assert.ok(usados.size > 20)
  const secciones = new Set(SECCIONES.map((s) => s.clave))
  for (const p of usados) {
    const [s, a] = p.split(".")
    assert.ok(secciones.has(s), `sección inexistente: ${p}`)
    assert.ok(existeAccion(s, a), `acción inexistente: ${p}`)
  }
})

test("migración B: toda tabla creada en las migraciones anteriores está clasificada (A, B o C)", () => {
  const clases = clasificacion(sqlRls)
  assert.ok(Object.keys(clases).length >= 85)
  const creadas = new Set()
  // Las de migraciones posteriores no se clasifican en la B: prenden su propia RLS (prueba siguiente)
  for (const f of readdirSync(MIG).filter((x) => x.endsWith(".sql") && x < MIG_RLS)) {
    for (const x of readFileSync(join(MIG, f), "utf8").matchAll(/create table (?:if not exists )?(?:([a-z_]+)\.)?"?([a-z_]+)"?/gi)) {
      if ((x[1] || "public").toLowerCase() === "public") creadas.add(x[2])
    }
  }
  for (const t of creadas) assert.ok(clases[t], `tabla sin clasificar en ${MIG_RLS}: ${t}`)
  // las que tienen reglas de escritura son de la clase A
  for (const t of reglasDeEscritura(sqlRls).keys()) assert.equal(clases[t], "A", `${t} tiene reglas de escritura y no es A`)
})

test("migraciones después de la B: toda tabla nueva prende la RLS", () => {
  for (const f of readdirSync(MIG).filter((x) => x.endsWith(".sql") && x > MIG_RLS)) {
    const sql = readFileSync(join(MIG, f), "utf8")
    for (const x of sql.matchAll(/create table (?:if not exists )?(?:([a-z_]+)\.)?"?([a-z_]+)"?/gi)) {
      if ((x[1] || "public").toLowerCase() !== "public") continue
      assert.match(sql, new RegExp(`alter table (?:public\\.)?${x[2]} enable row level security`, "i"), `${f}: la tabla ${x[2]} no prende la RLS`)
    }
  }
})

/** Trozo de la definición de `nombre` en un archivo SQL (o null si no la redefine). */
function definicion(sql, nombre, largo = 4000) {
  const re = new RegExp(`create (?:or replace )?function (?:public\\.)?${nombre}\\s*\\(`, "i")
  const desde = sql.search(re)
  return desde < 0 ? null : sql.slice(desde, desde + largo)
}

test("migraciones después de la B: las funciones con control lo conservan", () => {
  const guardadas = [...sqlRls.matchAll(/\('([a-z_]+)',\s*'(p|p_usuario|-)',\s*ARRAY\[/g)].map((x) => ({ nombre: x[1], usuario: x[2] }))
  assert.equal(guardadas.length, 11)
  assert.ok(guardadas.some((g) => g.nombre === "remito_tipo_para" && g.usuario === "-"))
  for (const f of readdirSync(MIG).filter((x) => x.endsWith(".sql") && x > MIG_RLS)) {
    const sql = readFileSync(join(MIG, f), "utf8")
    for (const g of guardadas) {
      const def = definicion(sql, g.nombre)
      if (!def) continue
      assert.match(def, /v_permiso_0c2 boolean := public\.rebucret_exigir(_sesion)?\(/, `${f}: ${g.nombre} perdió la línea v_permiso_0c2 (fase 0c-2)`)
      if (g.usuario !== "-") assert.match(def, /rebucret_usuario\(/, `${f}: ${g.nombre} perdió rebucret_usuario (fase 0c-2)`)
    }
  }
})

test("migraciones después de la B: los 11 triggers que la B pasa a SECURITY DEFINER no vuelven a INVOKER", () => {
  const m = sqlRls.match(/FOREACH f IN ARRAY ARRAY\[([\s\S]*?)\]/)
  assert.ok(m, "no se encontró la lista de triggers en la B")
  const triggers = m[1].match(/'([a-z_]+)'/g).map((x) => x.slice(1, -1))
  assert.equal(triggers.length, 11)
  for (const f of readdirSync(MIG).filter((x) => x.endsWith(".sql") && x > MIG_RLS)) {
    const sql = readFileSync(join(MIG, f), "utf8")
    for (const t of triggers) {
      const def = definicion(sql, t, 600)
      if (def) {
        const cabecera = def.slice(0, def.search(/\bAS\s+\$/i) >= 0 ? def.search(/\bAS\s+\$/i) : def.length)
        assert.match(cabecera, /SECURITY DEFINER/i, `${f}: ${t} se redefine sin SECURITY DEFINER (fase 0c-2)`)
      }
      assert.doesNotMatch(sql, new RegExp(`alter function (?:public\\.)?${t}\\s*\\([^)]*\\)\\s*security invoker`, "i"), `${f}: ${t} pasa a SECURITY INVOKER`)
    }
  }
})

test("migración B: frena si falta alguna migración anterior de la rama (con marcas que existen en esos archivos)", () => {
  const bloque = sqlRls.match(/DO \$previas\$([\s\S]*?)\$previas\$;/)
  assert.ok(bloque, "falta el bloque $previas$")
  const marcas = {
    "202611231200_ingreso_borrado_recuento.sql": ["v_corrige"],
    "202611231500_editar_despacho_probetas_super.sql": ["probetas_corridas"],
    "202611231600_pedido_estado_por_cantidad.sql": ["_pedido_estado_por_cantidad()"],
    "202611231700_sesion_app_users_activity_log.sql": ["REVOKE SELECT ON public.app_users FROM anon, authenticated", "REVOKE UPDATE, DELETE, TRUNCATE ON public.activity_log"],
    "202611241200_formula_sin_borrar_despachos.sql": ["dispatches_formula_id_fkey", "ON DELETE RESTRICT"],
    "202611241800_seguridad_intentos_y_avisos.sql": ["ingreso_reservar(p_user_id uuid, p_ip text)", "public.sesiones_cerradas"],
  }
  for (const [archivo, textos] of Object.entries(marcas)) {
    assert.ok(bloque[1].includes(archivo), `la B no controla ${archivo}`)
    const sql = readFileSync(join(MIG, archivo), "utf8")
    for (const t of textos) assert.ok(sql.includes(t), `la marca "${t}" ya no está en ${archivo}`)
  }
  for (const t of ["v_corrige", "probetas_corridas", "_pedido_estado_por_cantidad()", "'email', 'SELECT'", "'public.activity_log', 'DELETE'", "confdeltype = 'r'", "sesiones_cerradas"]) {
    assert.ok(bloque[1].includes(t), `la B no mira "${t}"`)
  }
})

test("migración B: lo que no usa el navegador no se le da, y las tablas futuras no le dan todo a una sesión", () => {
  assert.match(sqlRls, /REVOKE EXECUTE ON FUNCTION public\.cemento_para_replanteo\(uuid, uuid\) FROM authenticated/)
  assert.match(sqlRls, /IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated/)
  assert.match(sqlRls, /IN SCHEMA public REVOKE ALL ON TABLES FROM anon/)
  // el navegador no llama cemento_para_replanteo
  for (const dir of ["components", "app", "hooks"]) {
    let lista
    try { lista = archivosTs(join(RAIZ, dir)) } catch { continue }
    for (const p of lista) if (!relative(RAIZ, p).startsWith("app/api/")) assert.ok(!readFileSync(p, "utf8").includes("cemento_para_replanteo"), p)
  }
  // la sesión cerrada con Salir corta el token
  assert.match(sqlRls, /NOT EXISTS \(SELECT 1 FROM public\.sesiones_cerradas x WHERE x\.sid = auth\.jwt\(\) ->> 's'\)/)
})

// ---------------------------------------------------------------- el navegador no escribe donde no hay regla
// Código muerto (fase 0c-1, punto 3: no lo importa ninguna pantalla) y escrituras que hace el servidor con la
// clave de servicio (la RLS no le aplica) aunque el archivo esté en lib/ o components/.
const MUERTOS = new Set([
  "components/dispatches-table.tsx", "components/formulas-table.tsx", "components/materials-table.tsx",
  "components/materials-dashboard.tsx", "components/edit-material-dialog.tsx", "components/delete-material-dialog.tsx",
  "components/material-detail-dialog.tsx", "components/view-dispatch-dialog.tsx",
])
const SERVIDOR = [
  /^app\/api\//, /^lib\/auth\//, /^lib\/zomatik\//, /^lib\/control-[a-z]+\//, /^lib\/ingresos-zomatik\//, /^lib\/carga\/servidor\.ts$/,
  /^lib\/armado-dia-servidor\.ts$/, /^lib\/gps-reconstruir\.ts$/, /^lib\/alertas-stock-cero\.ts$/, /^lib\/wialon\.ts$/,
  /^lib\/gps-camiones\.ts$/, /^lib\/mail-servidor\.ts$/, /^lib\/__tests__\//, /^lib\/__fixtures__\//,
]
// (archivo, tabla) que escriben solo desde el servidor aunque el archivo lo use también el navegador para leer
const SERVIDOR_PARES = new Set([
  "lib/gps-viajes.ts viajes_gps", // guardarViajesCamion: solo /api/gps/reconstruir
])

function archivosTs(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) archivosTs(p, out)
    else if (/\.(ts|tsx)$/.test(f)) out.push(p)
  }
  return out
}

test("toda escritura del navegador (.from(tabla).insert/update/upsert/delete) tiene su regla en la migración B", () => {
  const reglas = reglasDeEscritura(sqlRls)
  const faltan = []
  for (const dir of ["components", "lib", "app", "hooks"]) {
    let lista
    try { lista = archivosTs(join(RAIZ, dir)) } catch { continue }
    for (const p of lista) {
      const rel = relative(RAIZ, p).split("\\").join("/")
      if (MUERTOS.has(rel) || SERVIDOR.some((r) => r.test(rel))) continue
      const s = readFileSync(p, "utf8")
      for (const m of s.matchAll(/\.from\(\s*["'`]([a-z_]+)["'`]\s*\)/g)) {
        if (SERVIDOR_PARES.has(`${rel} ${m[1]}`)) continue
        const resto = s.slice(m.index + m[0].length, m.index + m[0].length + 600)
        const corte = resto.search(/\.(from|rpc)\(/)
        const tramo = corte >= 0 ? resto.slice(0, corte) : resto
        const ops = []
        if (/\.insert\(/.test(tramo)) ops.push("INSERT")
        if (/\.update\(/.test(tramo)) ops.push("UPDATE")
        if (/\.delete\(/.test(tramo)) ops.push("DELETE")
        if (/\.upsert\(/.test(tramo)) ops.push("INSERT", "UPDATE")
        for (const op of ops) if (!reglas.get(m[1])?.has(op)) faltan.push(`${rel}: ${m[1]} ${op}`)
      }
      // maestro-lista.tsx escribe en la tabla que recibe (choferes / empresas_bombeo)
      if (rel === "components/maestro-lista.tsx") {
        for (const t of ["choferes", "empresas_bombeo"]) for (const op of ["INSERT", "UPDATE"]) if (!reglas.get(t)?.has(op)) faltan.push(`${rel}: ${t} ${op}`)
      }
    }
  }
  assert.deepEqual(faltan, [], "escrituras del navegador sin regla de RLS (agregarlas en la migración B y en la especificación)")
})
