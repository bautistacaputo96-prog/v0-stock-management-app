// Fase 0c-2 · Prueba de las migraciones de seguridad DENTRO DE UNA TRANSACCIÓN QUE SE DESHACE (BEGIN … ROLLBACK).
// No deja nada grabado: al final siempre hace ROLLBACK y controla que la base quedó como estaba.
//
//   PGCONN="postgres://..." node scripts/probar-seguridad-rls.mjs
//
// PGCONN = POSTGRES_URL_NON_POOLING de .env.rebucret (sin imprimirla). Ver supabase/migrations/README.md.
//
// OJO: mientras corre, la transacción tiene tomadas las tablas (ALTER TABLE / CREATE POLICY): el sistema queda en
// espera unos segundos. Correrla de noche o sin despachos, con el OK de Bautista.
//
// Qué prueba (criterios de aceptación de la especificación, punto 11):
//   - corre la A (si falta) y la B dos veces (que se pueda volver a correr);
//   - con la clave pública (anon) no se lee nada ni se llama registrar_despacho;
//   - con un token de consulta se lee todo y no se escribe nada;
//   - con un token de operario se escribe solo en sus áreas;
//   - con un token de gerencial se escribe;
//   - un token con otra versión de sesión no ve nada;
//   - Actividad guarda el nombre de la sesión aunque se mande otro;
//   - la vuelta atrás deja leer de nuevo con la clave pública.
import fs from "node:fs"
import pg from "pg"

if (!process.env.PGCONN) {
  console.error("Falta la variable PGCONN (POSTGRES_URL_NON_POOLING de .env.rebucret).")
  process.exit(1)
}
const corte = setTimeout(() => {
  console.error("Se cortó: la base no respondió a tiempo.")
  process.exit(2)
}, 180_000)

const MIG = new URL("../supabase/migrations/", import.meta.url)
const leer = (nombre) =>
  fs.readFileSync(new URL(nombre, MIG), "utf8")
    // cada archivo trae su BEGIN/COMMIT: acá va todo dentro de una sola transacción
    .replace(/^BEGIN;\s*$/m, "")
    .replace(/^COMMIT;\s*$/m, "")

const cliente = new pg.Client({
  connectionString: process.env.PGCONN.replace(/[?&]sslmode=[^&]*/, ""),
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15_000,
})
// Sin parámetros va por el protocolo simple (deja correr varias sentencias juntas, como un archivo de migración)
const q = async (sql, params) => (params && params.length ? await cliente.query(sql, params) : await cliente.query(sql)).rows

let ok = 0
let mal = 0
function control(nombre, cumple, detalle = "") {
  if (cumple) ok++
  else mal++
  console.log(`${cumple ? "OK  " : "MAL "} ${nombre}${detalle ? ` (${detalle})` : ""}`)
}

/** Corre `fn` como `rol` con esos datos de token, en un SAVEPOINT (un error no corta la prueba). */
async function como(rol, claims, fn) {
  await q("SAVEPOINT p")
  try {
    await q("SELECT set_config('request.jwt.claims', $1, true)", [claims ? JSON.stringify(claims) : ""])
    await q(`SET LOCAL ROLE ${rol}`)
    const r = await fn()
    await q("RESET ROLE")
    await q("RELEASE SAVEPOINT p")
    return { ok: true, r }
  } catch (e) {
    await q("ROLLBACK TO SAVEPOINT p")
    await q("RESET ROLE")
    return { ok: false, error: e.message }
  }
}

const token = (u, v) => ({ role: "authenticated", aud: "authenticated", iss: "rebucret", sub: u, v })

async function main() {
  await cliente.connect()
  await q("BEGIN")
  try {
    const antes = await q("SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relrowsecurity")

    if (!(await q("SELECT to_regclass('public.ingreso_intentos') t"))[0].t) {
      await q(leer("202611241800_seguridad_intentos_y_avisos.sql"))
      console.log("(se corrió la A dentro de la prueba)")
    }
    await q(leer("202611241900_seguridad_rls.sql"))
    await q(leer("202611241900_seguridad_rls.sql"))
    control("la B se puede correr dos veces", true)

    const sinRls = await q("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity")
    control("todas las tablas con RLS", sinRls.length === 0, sinRls.map((x) => x.relname).join(", "))
    const anonGrants = await q("SELECT count(*)::int n FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee = 'anon'")
    control("anon sin permisos en tablas", anonGrants[0].n === 0, String(anonGrants[0].n))

    // Personas de prueba (solo id, tipo y versión de sesión; con contraseña propia)
    const gente = await q(`SELECT u.id, u.name, u.tipo, c.sesion_version v, u.permisos
      FROM app_users u JOIN app_user_credenciales c ON c.user_id = u.id
      WHERE u.active IS NOT FALSE AND c.clave_hash IS NOT NULL AND NOT c.debe_cambiar`)
    const ger = gente.find((x) => x.tipo === "gerencial")
    const con = gente.find((x) => x.tipo === "consulta")
    const ope = gente.find((x) => x.tipo === "operario" && x.permisos?.mantenimiento?.cargar === true && x.permisos?.clientes?.cargar !== true)
    control("hay un gerencial y un operario de mantenimiento para probar", !!(ger && ope), [ger?.name, ope?.name].join(" / "))
    if (!con) console.log("(no hay ningún consulta con contraseña propia: se saltean las pruebas de consulta)")

    // anon
    let r = await como("anon", { role: "anon" }, () => q("SELECT count(*) FROM dispatches"))
    control("anon no lee despachos", !r.ok, r.error)
    r = await como("anon", { role: "anon" }, () => q("SELECT public.registrar_despacho('{}'::jsonb)"))
    control("anon no llama registrar_despacho", !r.ok, r.error)

    // consulta
    if (con) {
      const t = token(con.id, con.v)
      r = await como("authenticated", t, () => q("SELECT count(*)::int n FROM dispatches"))
      control("consulta lee despachos", r.ok && r.r[0].n > 0, r.error || String(r.r?.[0]?.n))
      r = await como("authenticated", t, () => q("SELECT count(*)::int n FROM clients"))
      control("consulta lee clientes", r.ok && r.r[0].n > 0, r.error)
      r = await como("authenticated", t, () => q("INSERT INTO clients (name) VALUES ('Prueba RLS') RETURNING id"))
      control("consulta NO agrega clientes", !r.ok, r.error)
      r = await como("authenticated", t, () => q("UPDATE plants SET name = name RETURNING id"))
      control("consulta NO cambia plantas", r.ok ? r.r.length === 0 : true, r.error || `${r.r?.length} filas`)
      r = await como("authenticated", t, () => q("DELETE FROM test_cylinders WHERE id = (SELECT id FROM test_cylinders LIMIT 1) RETURNING id"))
      control("consulta NO borra probetas", r.ok ? r.r.length === 0 : true, r.error || `${r.r?.length} filas`)
      r = await como("authenticated", t, () => q("SELECT public.anular_despacho((SELECT id FROM dispatches LIMIT 1), 'x', 'prueba')"))
      control("consulta NO anula despachos", !r.ok && /Sin permiso/.test(r.error), r.error)
      r = await como("authenticated", t, () => q("INSERT INTO activity_log (user_name, action, entity, details) VALUES ('Otro Nombre', 'crear', 'prueba', '{}') RETURNING user_name"))
      control("Actividad: el nombre es el de la sesión", r.ok && r.r[0].user_name === con.name, r.error || r.r?.[0]?.user_name)
      r = await como("authenticated", token(con.id, con.v + 1), () => q("SELECT count(*)::int n FROM dispatches"))
      control("token con otra versión de sesión no ve nada", r.ok && r.r[0].n === 0, r.error || String(r.r?.[0]?.n))
      r = await como("authenticated", { ...t, iss: "https://otro" }, () => q("SELECT count(*)::int n FROM dispatches"))
      control("token de otro emisor (Supabase Auth) no ve nada", r.ok && r.r[0].n === 0, r.error || String(r.r?.[0]?.n))
      r = await como("authenticated", t, () => q("SELECT count(*) FROM app_user_credenciales"))
      control("nadie con sesión lee las contraseñas", !r.ok, r.error)
      r = await como("authenticated", { ...t, s: "sesion-de-prueba-cerrada" }, async () => {
        await q("RESET ROLE")
        await q("INSERT INTO sesiones_cerradas (sid, user_id) VALUES ('sesion-de-prueba-cerrada', $1)", [con.id])
        await q("SET LOCAL ROLE authenticated")
        return q("SELECT count(*)::int n FROM dispatches")
      })
      control("una sesión cerrada con Salir no ve nada", r.ok && r.r[0].n === 0, r.error || String(r.r?.[0]?.n))
      r = await como("anon", { role: "anon" }, () => q("SELECT public.remito_tipo_para(NULL, NULL, NULL, NULL)"))
      control("anon no llama remito_tipo_para", !r.ok, r.error)
    }

    // operario de mantenimiento
    if (ope) {
      const t = token(ope.id, ope.v)
      r = await como("authenticated", t, () => q("INSERT INTO clients (name) VALUES ('Prueba RLS') RETURNING id"))
      control("operario sin Clientes NO agrega clientes", !r.ok, r.error)
      r = await como("authenticated", t, () => q("UPDATE maint_work_orders SET observaciones = observaciones WHERE id = (SELECT id FROM maint_work_orders LIMIT 1) RETURNING id"))
      control("operario de mantenimiento cambia una OT", r.ok && r.r.length === 1, r.error || `${r.r?.length} filas`)
    }

    // gerencial
    if (ger) {
      const t = token(ger.id, ger.v)
      r = await como("authenticated", t, () => q("UPDATE plants SET name = name WHERE id = (SELECT id FROM plants LIMIT 1) RETURNING id"))
      control("gerencial cambia plantas", r.ok && r.r.length === 1, r.error)
      r = await como("authenticated", t, () => q("INSERT INTO clients (name) VALUES ('Prueba RLS') RETURNING id"))
      control("gerencial agrega clientes", r.ok, r.error)
      r = await como("authenticated", t, () => q("SELECT public.rebucret_exigir('historial.borrar')"))
      control("gerencial pasa el control de las funciones", r.ok, r.error)
    }

    // Guardas puestas
    const guardas = await q(`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND position('v_permiso_0c2' in pg_get_functiondef(p.oid)) > 0`)
    control("11 funciones con control (10 del motor + remito_tipo_para)", guardas.length === 11, guardas.map((x) => x.proname).join(", "))

    // Vuelta atrás
    await q(fs.readFileSync(new URL("vuelta-atras/202611241900_seguridad_rls_VUELTA_ATRAS.sql", MIG), "utf8").replace(/^BEGIN;\s*$/m, "").replace(/^COMMIT;\s*$/m, ""))
    r = await como("anon", { role: "anon" }, () => q("SELECT count(*)::int n FROM dispatches"))
    control("después de la vuelta atrás, la clave pública lee como antes", r.ok && r.r[0].n > 0, r.error)
    const despues = await q("SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relrowsecurity")
    control("después de la vuelta atrás, RLS como antes (+ ingreso_intentos)", despues[0].n <= antes[0].n + 1, `${antes[0].n} → ${despues[0].n}`)
  } finally {
    await q("ROLLBACK")
  }
  const quedo = await q("SELECT to_regprocedure('public.rebucret_exigir(text[])') f, (SELECT count(*)::int FROM pg_namespace WHERE nspname = 'rebucret_respaldo') e")
  control("después del ROLLBACK la base quedó como estaba", !quedo[0].f && quedo[0].e === 0)
  await cliente.end()
  clearTimeout(corte)
  console.log(`\n${ok} OK, ${mal} MAL`)
  process.exit(mal ? 1 : 0)
}

main().catch(async (e) => {
  console.error("Error:", e.message)
  try { await q("ROLLBACK") } catch {}
  process.exit(1)
})
