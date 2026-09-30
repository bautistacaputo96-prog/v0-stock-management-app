// Vuelca el esquema `public` de la base (solo estructura, sin datos) a un archivo SQL.
// Solo hace SELECT, dentro de una transacción de solo lectura.
//
// Uso:
//   PGCONN="postgres://..." node scripts/volcar-esquema.mjs <archivo-salida.sql>
//
// PGCONN = POSTGRES_URL_NON_POOLING de .env.rebucret (sin imprimirla). Ver supabase/migrations/README.md.
// El esquema base (000000000000_esquema_base.sql) se generó con este script el 30/09/2026 y no se
// vuelve a pisar: para ver si la base se corrió del repo, volcar a otro archivo y comparar.

import fs from "node:fs"
import pg from "pg"

const salida = process.argv[2]
if (!salida) {
  console.error("Uso: PGCONN=... node scripts/volcar-esquema.mjs <archivo-salida.sql>")
  process.exit(1)
}
if (!process.env.PGCONN) {
  console.error("Falta la variable PGCONN (POSTGRES_URL_NON_POOLING de .env.rebucret).")
  process.exit(1)
}

const corte = setTimeout(() => {
  console.error("Se cortó: la base no respondió a tiempo.")
  process.exit(2)
}, 120_000)

const ESQUEMA = "public"
const ROLES = ["anon", "authenticated", "service_role"]

const cliente = new pg.Client({
  connectionString: process.env.PGCONN.replace(/[?&]sslmode=[^&]*/, ""),
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15_000,
})

const q = async (sql, params = []) => (await cliente.query(sql, params)).rows
// Igual que quote_ident(): comillas si no es minúscula simple o si es palabra reservada.
let reservadas = new Set()
const qi = (s) => (/^[a-z_][a-z0-9_$]*$/.test(s) && !reservadas.has(s) ? s : `"${s.replace(/"/g, '""')}"`)
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`

async function main() {
  await cliente.connect()
  await cliente.query("BEGIN READ ONLY")
  // Igual que pg_dump: con search_path vacío todo sale calificado (public.tabla, extensions.fn()).
  await cliente.query("SET LOCAL search_path = ''")
  reservadas = new Set((await q(`select word from pg_get_keywords() where catcode <> 'U'`)).map((r) => r.word))

  const nsp = (await q(`select oid from pg_namespace where nspname = $1`, [ESQUEMA]))[0].oid

  // Objetos que no sabemos volcar: si aparecen, frenar para no dejar un volcado incompleto.
  const raros = await q(
    `select relname, relkind::text from pg_class
      where relnamespace = $1 and relkind not in ('r','i','S')
     union all
     select typname, typtype::text from pg_type t
      where typnamespace = $1 and typtype in ('d','c','r','m')
        and not exists (select 1 from pg_class c where c.oid = t.typrelid and c.relkind <> 'c')
     union all
     select proname, prokind::text from pg_proc p
      where pronamespace = $1 and prokind not in ('f','p')`,
    [nsp],
  )
  if (raros.length) throw new Error("Objetos no soportados por el volcado: " + JSON.stringify(raros))

  const defaultsConFuncionPropia = await q(
    `select c.relname || '.' || a.attname as col from pg_attrdef d
       join pg_class c on c.oid = d.adrelid join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
      where c.relnamespace = $1
        and exists (select 1 from pg_depend dp join pg_proc p on p.oid = dp.refobjid
                     where dp.classid = 'pg_attrdef'::regclass and dp.objid = d.oid and p.pronamespace = $1)`,
    [nsp],
  )
  if (defaultsConFuncionPropia.length)
    throw new Error("Defaults que usan funciones de public (habría que crear esas funciones antes de las tablas): " +
      defaultsConFuncionPropia.map((r) => r.col).join(", "))

  const extensiones = await q(
    `select extname, extversion, extnamespace::regnamespace::text as esquema from pg_extension order by extname`,
  )

  const enums = await q(
    `select t.typname, array_agg(e.enumlabel order by e.enumsortorder) as valores
       from pg_type t join pg_enum e on e.enumtypid = t.oid
      where t.typnamespace = $1 group by t.typname order by t.typname`,
    [nsp],
  )

  const secuencias = await q(
    `select c.relname, format_type(s.seqtypid, null) as tipo, s.seqstart, s.seqincrement, s.seqmin, s.seqmax,
            s.seqcache, s.seqcycle,
            (select quote_ident(t.relname) || '.' || quote_ident(a.attname)
               from pg_depend d join pg_class t on t.oid = d.refobjid
               join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
              where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'a') as duena,
            exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'i') as es_identity
       from pg_class c join pg_sequence s on s.seqrelid = c.oid
      where c.relnamespace = $1 and c.relkind = 'S' order by c.relname`,
    [nsp],
  )

  const funciones = await q(
    `select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args, pg_get_functiondef(p.oid) as def,
            p.proacl::text as acl, obj_description(p.oid, 'pg_proc') as comentario
       from pg_proc p
      where p.pronamespace = $1 and p.prokind in ('f','p')
        and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      order by p.proname, 3`,
    [nsp],
  )

  const tablas = await q(
    `select c.oid, c.relname, c.relrowsecurity, c.relforcerowsecurity, obj_description(c.oid, 'pg_class') as comentario
       from pg_class c where c.relnamespace = $1 and c.relkind = 'r' order by c.relname`,
    [nsp],
  )

  const columnas = await q(
    `select c.relname, a.attnum, a.attname, format_type(a.atttypid, a.atttypmod) as tipo, a.attnotnull,
            pg_get_expr(d.adbin, d.adrelid) as defecto, a.attidentity::text as identity, a.attgenerated::text as generada,
            case when a.attcollation <> t.typcollation then (select quote_ident(collname) from pg_collation where oid = a.attcollation) end as colacion,
            col_description(c.oid, a.attnum) as comentario
       from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_type t on t.oid = a.atttypid
       left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where c.relnamespace = $1 and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
      order by c.relname, a.attnum`,
    [nsp],
  )

  const restricciones = await q(
    `select c.relname, co.conname, co.contype::text as tipo, pg_get_constraintdef(co.oid) as def
       from pg_constraint co join pg_class c on c.oid = co.conrelid
      where c.relnamespace = $1 and c.relkind = 'r' and co.contype in ('p','u','c','x','f')
      order by case co.contype when 'p' then 1 when 'u' then 2 when 'x' then 3 when 'c' then 4 else 5 end,
               c.relname, co.conname`,
    [nsp],
  )

  const indices = await q(
    `select ci.relname as indice, ct.relname as tabla, pg_get_indexdef(i.indexrelid) as def
       from pg_index i join pg_class ci on ci.oid = i.indexrelid join pg_class ct on ct.oid = i.indrelid
      where ct.relnamespace = $1 and ct.relkind = 'r'
        and not exists (select 1 from pg_constraint co where co.conindid = i.indexrelid and co.conrelid = i.indrelid)
      order by ct.relname, ci.relname`,
    [nsp],
  )
  const totalIndices = (
    await q(
      `select count(*)::int as n from pg_index i join pg_class ct on ct.oid = i.indrelid
        where ct.relnamespace = $1 and ct.relkind = 'r'`,
      [nsp],
    )
  )[0].n

  const triggers = await q(
    `select t.tgname, c.relname, pg_get_triggerdef(t.oid, false) as def, t.tgenabled::text as estado
       from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where c.relnamespace = $1 and not t.tgisinternal order by c.relname, t.tgname`,
    [nsp],
  )

  const politicas = await q(
    `select c.relname, p.polname, p.polpermissive, p.polcmd::text as cmd,
            coalesce((select string_agg(case when r = 0 then 'public' else quote_ident(r::regrole::text) end, ', ')
                        from unnest(p.polroles) r), 'public') as roles,
            pg_get_expr(p.polqual, p.polrelid) as usando, pg_get_expr(p.polwithcheck, p.polrelid) as chequeo
       from pg_policy p join pg_class c on c.oid = p.polrelid
      where c.relnamespace = $1 order by c.relname, p.polname`,
    [nsp],
  )

  const acls = await q(
    `select c.relname, c.relkind::text as tipo, c.relowner::regrole::text as dueno,
            (select json_agg(json_build_object('rol', case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end,
                                               'priv', a.privilege_type) order by a.grantee, a.privilege_type)
               from aclexplode(c.relacl) a where a.grantee <> c.relowner) as permisos
       from pg_class c where c.relnamespace = $1 and c.relkind in ('r','S') order by c.relname`,
    [nsp],
  )
  const aclsFunciones = await q(
    `select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.proacl is null as por_defecto,
            (select json_agg(case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end order by a.grantee)
               from aclexplode(p.proacl) a where a.grantee <> p.proowner) as roles
       from pg_proc p
      where p.pronamespace = $1 and p.prokind in ('f','p')
        and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      order by p.proname, 2`,
    [nsp],
  )

  // Fuera de public, solo como referencia (lo administra Supabase).
  const buckets = await q(`select id, public from storage.buckets order by id`).catch(() => [])
  const politicasStorage = await q(
    `select tablename, policyname, cmd, roles::text, qual, with_check from pg_policies
      where schemaname = 'storage' order by tablename, policyname`,
  ).catch(() => [])
  const publicaciones = await q(
    `select p.pubname, coalesce(string_agg(pt.tablename, ', ' order by pt.tablename), '') as tablas
       from pg_publication p left join pg_publication_tables pt on pt.pubname = p.pubname and pt.schemaname = $1
      group by p.pubname order by p.pubname`,
    [ESQUEMA],
  )
  const version = (await q(`select current_setting('server_version') as v`))[0].v

  await cliente.query("ROLLBACK")
  await cliente.end()

  // ---------------------------------------------------------------- armado del archivo
  const L = []
  const seccion = (t) => L.push("", "-- " + "=".repeat(76), "-- " + t, "-- " + "=".repeat(76), "")
  const hoy = new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date())
  const nFks = restricciones.filter((r) => r.tipo === "f").length

  L.push(
    `-- Esquema de la base de Rebucret (esquema public): solo estructura, sin datos.`,
    `-- Generado el ${hoy} desde PRODUCCIÓN con scripts/volcar-esquema.mjs (consultas de solo lectura al`,
    `-- catálogo; PostgreSQL ${version}).`,
    `--`,
    `-- Refleja la base después de la fase 0b: ya incluye lo que hacen 202609291800_materiales_tipo.sql y`,
    `-- 202609291810_motor_despacho.sql. Es una FOTO, no una migración más: las migraciones con fecha`,
    `-- posterior a 202609291810 se aplican encima. Ver supabase/migrations/README.md.`,
    `--`,
    `-- Contenido: ${tablas.length} tablas, ${columnas.length} columnas, ${secuencias.length} secuencia(s), ${funciones.length} funciones,`,
    `-- ${triggers.length} triggers, ${totalIndices} índices (${totalIndices - indices.length} de PK/UNIQUE + ${indices.length} sueltos), ${nFks} claves foráneas,`,
    `-- ${restricciones.filter((r) => r.tipo === "c").length} checks, ${politicas.length} políticas RLS.`,
    `--`,
    `-- Para reconstruir: correr este archivo como el rol postgres (SQL editor de Supabase o psql) en un`,
    `-- proyecto Supabase nuevo. Los esquemas que administra Supabase (auth, storage, realtime, vault,`,
    `-- extensions, graphql) no se vuelcan. Todo pertenece al rol postgres; las funciones SECURITY DEFINER`,
    `-- corren como su dueño.`,
    "",
    "SET statement_timeout = 0;",
    "SET lock_timeout = 0;",
    "SET client_encoding = 'UTF8';",
    "SET standard_conforming_strings = on;",
    "-- Como pg_dump: no validar cuerpos de funciones (hay funciones SQL que nombran tablas creadas más abajo).",
    "SET check_function_bodies = false;",
    "SET client_min_messages = warning;",
  )

  seccion("Extensiones")
  const extensionesPropias = new Set(["pgcrypto", "uuid-ossp"])
  for (const e of extensiones) {
    if (e.extname === "plpgsql") continue
    const stmt = `CREATE EXTENSION IF NOT EXISTS ${qi(e.extname)} WITH SCHEMA ${qi(e.esquema)};`
    L.push(extensionesPropias.has(e.extname) ? stmt : `-- ${stmt}  -- (la instala Supabase; versión ${e.extversion})`)
  }

  if (enums.length) {
    seccion("Tipos")
    for (const t of enums) {
      L.push(`CREATE TYPE ${ESQUEMA}.${qi(t.typname)} AS ENUM (${t.valores.map(lit).join(", ")});`)
    }
  }

  const secuenciasSueltas = secuencias.filter((s) => !s.es_identity)
  if (secuenciasSueltas.length) {
    seccion("Secuencias")
    for (const s of secuenciasSueltas) {
      L.push(
        `CREATE SEQUENCE ${ESQUEMA}.${qi(s.relname)} AS ${s.tipo} START WITH ${s.seqstart} INCREMENT BY ${s.seqincrement}` +
          ` MINVALUE ${s.seqmin} MAXVALUE ${s.seqmax} CACHE ${s.seqcache}${s.seqcycle ? " CYCLE" : " NO CYCLE"};`,
      )
    }
  }

  seccion("Tablas")
  for (const t of tablas) {
    const cols = columnas.filter((c) => c.relname === t.relname)
    const lineas = cols.map((c) => {
      let s = `    ${qi(c.attname)} ${c.tipo}`
      if (c.colacion) s += ` COLLATE ${c.colacion}`
      if (c.generada === "s") s += ` GENERATED ALWAYS AS (${c.defecto}) STORED`
      else if (c.defecto != null) s += ` DEFAULT ${c.defecto}`
      if (c.identity === "a") s += " GENERATED ALWAYS AS IDENTITY"
      if (c.identity === "d") s += " GENERATED BY DEFAULT AS IDENTITY"
      if (c.attnotnull) s += " NOT NULL"
      return s
    })
    L.push(`CREATE TABLE ${ESQUEMA}.${qi(t.relname)} (`, lineas.join(",\n"), ");", "")
  }

  for (const s of secuenciasSueltas.filter((s) => s.duena)) {
    L.push(`ALTER SEQUENCE ${ESQUEMA}.${qi(s.relname)} OWNED BY ${ESQUEMA}.${s.duena};`)
  }

  // Las funciones van después de las tablas: alguna devuelve el tipo de fila de una tabla
  // (p. ej. _material_en_planta → public.materials). Los defaults de columna no pueden usar
  // funciones de public (frenamos arriba si pasara).
  seccion("Funciones (después de las tablas porque algunas usan sus tipos de fila)")
  for (const f of funciones) {
    L.push(f.def.trimEnd() + ";", "")
    if (f.comentario) L.push(`COMMENT ON FUNCTION ${ESQUEMA}.${qi(f.proname)}(${f.args}) IS ${lit(f.comentario)};`, "")
  }


  seccion("Claves primarias, UNIQUE y CHECK")
  for (const r of restricciones.filter((r) => r.tipo !== "f")) {
    L.push(`ALTER TABLE ONLY ${ESQUEMA}.${qi(r.relname)} ADD CONSTRAINT ${qi(r.conname)} ${r.def};`)
  }

  seccion("Índices (los de PK/UNIQUE los crea la restricción)")
  for (const i of indices) L.push(i.def + ";")

  seccion("Claves foráneas")
  for (const r of restricciones.filter((r) => r.tipo === "f")) {
    L.push(`ALTER TABLE ONLY ${ESQUEMA}.${qi(r.relname)} ADD CONSTRAINT ${qi(r.conname)} ${r.def};`)
  }

  seccion("Triggers")
  for (const t of triggers) {
    L.push(t.def + ";")
    if (t.estado === "D") L.push(`ALTER TABLE ${ESQUEMA}.${qi(t.relname)} DISABLE TRIGGER ${qi(t.tgname)};`)
  }

  seccion("Row Level Security (apagado en todas las tablas salvo las que figuran acá)")
  for (const t of tablas.filter((t) => t.relrowsecurity)) {
    L.push(`ALTER TABLE ${ESQUEMA}.${qi(t.relname)} ENABLE ROW LEVEL SECURITY;`)
    if (t.relforcerowsecurity) L.push(`ALTER TABLE ${ESQUEMA}.${qi(t.relname)} FORCE ROW LEVEL SECURITY;`)
    if (!politicas.some((p) => p.relname === t.relname)) L.push(`-- ${t.relname}: sin políticas (solo la lee service_role).`)
  }
  const cmds = { r: "SELECT", a: "INSERT", w: "UPDATE", d: "DELETE", "*": "ALL" }
  for (const p of politicas) {
    let s = `CREATE POLICY ${qi(p.polname)} ON ${ESQUEMA}.${qi(p.relname)} AS ${p.polpermissive ? "PERMISSIVE" : "RESTRICTIVE"}`
    s += ` FOR ${cmds[p.cmd]} TO ${p.roles}`
    if (p.usando) s += ` USING (${p.usando})`
    if (p.chequeo) s += ` WITH CHECK (${p.chequeo})`
    L.push(s + ";")
  }

  seccion("Comentarios")
  for (const t of tablas.filter((t) => t.comentario)) {
    L.push(`COMMENT ON TABLE ${ESQUEMA}.${qi(t.relname)} IS ${lit(t.comentario)};`)
  }
  for (const c of columnas.filter((c) => c.comentario)) {
    L.push(`COMMENT ON COLUMN ${ESQUEMA}.${qi(c.relname)}.${qi(c.attname)} IS ${lit(c.comentario)};`)
  }

  seccion("Permisos (exactos: primero se quitan los que pone Supabase por defecto y después se dan los reales)")
  const TODOS = {
    r: ["DELETE", "INSERT", "MAINTAIN", "REFERENCES", "SELECT", "TRIGGER", "TRUNCATE", "UPDATE"],
    S: ["SELECT", "UPDATE", "USAGE"],
  }
  const nombreTipo = { r: "TABLE", S: "SEQUENCE" }
  for (const o of acls) {
    const obj = `${nombreTipo[o.tipo]} ${ESQUEMA}.${qi(o.relname)}`
    L.push(`REVOKE ALL ON ${obj} FROM PUBLIC, ${ROLES.join(", ")};`)
    const porRol = new Map()
    for (const p of o.permisos ?? []) porRol.set(p.rol, [...(porRol.get(p.rol) ?? []), p.priv])
    const grupos = new Map()
    for (const [rol, privs] of porRol) {
      const todos = TODOS[o.tipo]
      const clave = todos.every((x) => privs.includes(x)) ? "ALL" : [...privs].sort().join(", ")
      grupos.set(clave, [...(grupos.get(clave) ?? []), rol === "PUBLIC" ? "PUBLIC" : qi(rol)])
    }
    for (const [privs, roles] of grupos) L.push(`GRANT ${privs} ON ${obj} TO ${roles.join(", ")};`)
  }
  L.push("")
  for (const f of aclsFunciones) {
    const obj = `FUNCTION ${ESQUEMA}.${qi(f.proname)}(${f.args})`
    if (f.por_defecto) continue // sin ACL propia: EXECUTE para PUBLIC, como cualquier función nueva
    L.push(`REVOKE ALL ON ${obj} FROM PUBLIC, ${ROLES.join(", ")};`)
    const roles = (f.roles ?? []).map((r) => (r === "PUBLIC" ? "PUBLIC" : qi(r)))
    if (roles.length) L.push(`GRANT EXECUTE ON ${obj} TO ${roles.join(", ")};`)
  }

  seccion("Referencia (no se ejecuta): objetos fuera de public que administra Supabase")
  L.push(`-- Buckets de storage: ${buckets.map((b) => `${b.id} (${b.public ? "público" : "privado"})`).join(", ") || "ninguno"}.`)
  for (const p of politicasStorage) {
    L.push(
      `-- Política storage.${p.tablename} "${p.policyname}": ${p.cmd} TO ${p.roles}` +
        (p.qual ? ` USING (${p.qual})` : "") +
        (p.with_check ? ` WITH CHECK (${p.with_check})` : ""),
    )
  }
  for (const p of publicaciones) {
    L.push(`-- Publicación ${p.pubname}: ${p.tablas ? "tablas de public: " + p.tablas : "sin tablas de public"}.`)
  }
  L.push("")

  fs.writeFileSync(salida, L.join("\n"))
  console.log(
    `Listo: ${salida} — ${tablas.length} tablas, ${funciones.length} funciones, ${triggers.length} triggers, ` +
      `${totalIndices} índices, ${nFks} FKs, ${secuencias.length} secuencias.`,
  )
}

main()
  .then(() => {
    clearTimeout(corte)
    process.exit(0)
  })
  .catch((e) => {
    console.error("Error:", e.message)
    process.exit(1)
  })
