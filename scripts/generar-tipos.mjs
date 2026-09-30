// Genera types/database.ts (tipos TypeScript de las tablas y funciones del esquema public) leyendo el
// catálogo de la base. Solo hace SELECT, dentro de una transacción de solo lectura.
//
// Uso (después de aplicar cada migración):
//   PGCONN="postgres://..." node scripts/generar-tipos.mjs [archivo-salida]   (por defecto types/database.ts)
//
// PGCONN = POSTGRES_URL_NON_POOLING de .env.rebucret (sin imprimirla). Ver supabase/migrations/README.md.
// El formato es el mismo que el de `supabase gen types typescript`: sirve para createClient<Database>().

import fs from "node:fs"
import path from "node:path"
import pg from "pg"

const salida = process.argv[2] ?? "types/database.ts"
if (!process.env.PGCONN) {
  console.error("Falta la variable PGCONN (POSTGRES_URL_NON_POOLING de .env.rebucret).")
  process.exit(1)
}

const corte = setTimeout(() => {
  console.error("Se cortó: la base no respondió a tiempo.")
  process.exit(2)
}, 120_000)

const ESQUEMA = "public"

const cliente = new pg.Client({
  connectionString: process.env.PGCONN.replace(/[?&]sslmode=[^&]*/, ""),
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15_000,
})
const q = async (sql, params = []) => (await cliente.query(sql, params)).rows

const clave = (s) => (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s) ? s : JSON.stringify(s))

const TIPOS_BASE = {
  bool: "boolean",
  int2: "number",
  int4: "number",
  int8: "number",
  float4: "number",
  float8: "number",
  numeric: "number",
  money: "number",
  oid: "number",
  json: "Json",
  jsonb: "Json",
  void: "undefined",
  record: "Record<string, unknown>",
}
const TIPOS_TEXTO = new Set([
  "text", "varchar", "bpchar", "char", "name", "citext", "uuid", "date", "time", "timetz", "timestamp",
  "timestamptz", "interval", "bytea", "inet", "cidr", "macaddr", "tsvector", "xml",
])

async function main() {
  await cliente.connect()
  await cliente.query("BEGIN READ ONLY")
  const nsp = (await q(`select oid from pg_namespace where nspname = $1`, [ESQUEMA]))[0].oid

  const tipos = new Map(
    (
      await q(
        `select t.oid::int as oid, t.typname, t.typtype::text as typtype, t.typcategory::text as cat, t.typelem::int as elem,
                t.typnamespace = $1 as propio, c.relname as tabla, c.relkind::text as relkind
           from pg_type t left join pg_class c on c.oid = t.typrelid`,
        [nsp],
      )
    ).map((t) => [t.oid, t]),
  )
  const enums = await q(
    `select t.typname, array_agg(e.enumlabel order by e.enumsortorder) as valores
       from pg_type t join pg_enum e on e.enumtypid = t.oid where t.typnamespace = $1
      group by t.typname order by t.typname`,
    [nsp],
  )

  const tsTipo = (oid) => {
    const t = tipos.get(oid)
    if (!t) return "unknown"
    if (t.cat === "A" && t.elem) return `${envolver(tsTipo(t.elem))}[]`
    if (t.typtype === "e" && t.propio) return `Database["${ESQUEMA}"]["Enums"][${JSON.stringify(t.typname)}]`
    if (t.typtype === "c" && t.propio && t.relkind === "r")
      return `Database["${ESQUEMA}"]["Tables"][${JSON.stringify(t.tabla)}]["Row"]`
    if (TIPOS_BASE[t.typname]) return TIPOS_BASE[t.typname]
    if (TIPOS_TEXTO.has(t.typname)) return "string"
    return "unknown"
  }
  const envolver = (s) => (/[ |]/.test(s) ? `(${s})` : s)

  const tablas = await q(
    `select c.oid, c.relname from pg_class c where c.relnamespace = $1 and c.relkind = 'r' order by c.relname`,
    [nsp],
  )
  const columnas = await q(
    `select a.attrelid as tabla, a.attname, a.atttypid::int as tipo, a.attnotnull, a.atthasdef,
            a.attidentity::text as identity, a.attgenerated::text as generada
       from pg_attribute a join pg_class c on c.oid = a.attrelid
      where c.relnamespace = $1 and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
      order by c.relname, a.attname`,
    [nsp],
  )
  const fks = await q(
    `select co.conrelid as tabla, co.conname,
            (select array_agg(a.attname::text order by k.i) from unnest(co.conkey) with ordinality k(n, i)
               join pg_attribute a on a.attrelid = co.conrelid and a.attnum = k.n) as columnas,
            ct.relname as ref_tabla,
            (select array_agg(a.attname::text order by k.i) from unnest(co.confkey) with ordinality k(n, i)
               join pg_attribute a on a.attrelid = co.confrelid and a.attnum = k.n) as ref_columnas,
            exists (select 1 from pg_constraint u where u.conrelid = co.conrelid and u.contype in ('p','u')
                     and u.conkey @> co.conkey and u.conkey <@ co.conkey) as uno_a_uno
       from pg_constraint co join pg_class ct on ct.oid = co.confrelid
      where co.connamespace = $1 and co.contype = 'f' and ct.relnamespace = $1
      order by co.conname`,
    [nsp],
  )
  const funciones = await q(
    `select p.proname, p.prorettype::int as ret, p.proretset, p.pronargdefaults,
            p.proargtypes::oid[]::int[] as argtipos, p.proallargtypes::int[] as todos, p.proargmodes::text[] as modos,
            p.proargnames as nombres
       from pg_proc p
      where p.pronamespace = $1 and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
        and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      order by p.proname`,
    [nsp],
  )
  await cliente.query("ROLLBACK")
  await cliente.end()

  // ------------------------------------------------------------------- armado
  const I = (n) => "  ".repeat(n)
  const L = []
  const hoy = new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date())
  L.push(
    `// Tipos de la base de Rebucret (esquema public). ARCHIVO GENERADO: no editar a mano.`,
    `// Generado el ${hoy} desde la base con scripts/generar-tipos.mjs (ver supabase/migrations/README.md).`,
    ``,
    `export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]`,
    ``,
    `export type Database = {`,
    `${I(1)}${ESQUEMA}: {`,
    `${I(2)}Tables: {`,
  )
  for (const t of tablas) {
    const cols = columnas.filter((c) => c.tabla === t.oid)
    L.push(`${I(3)}${clave(t.relname)}: {`)
    const bloque = (nombre, fn) => {
      L.push(`${I(4)}${nombre}: {`)
      for (const c of cols) L.push(`${I(5)}${fn(c)}`)
      L.push(`${I(4)}}`)
    }
    const base = (c) => tsTipo(c.tipo) + (c.attnotnull ? "" : " | null")
    bloque("Row", (c) => `${clave(c.attname)}: ${base(c)}`)
    bloque("Insert", (c) => {
      if (c.generada === "s" || c.identity === "a") return `${clave(c.attname)}?: never`
      const opcional = !c.attnotnull || c.atthasdef || c.identity === "d"
      return `${clave(c.attname)}${opcional ? "?" : ""}: ${base(c)}`
    })
    bloque("Update", (c) =>
      c.generada === "s" || c.identity === "a" ? `${clave(c.attname)}?: never` : `${clave(c.attname)}?: ${base(c)}`,
    )
    const rel = fks.filter((f) => f.tabla === t.oid)
    if (!rel.length) L.push(`${I(4)}Relationships: []`)
    else {
      L.push(`${I(4)}Relationships: [`)
      for (const f of rel) {
        L.push(
          `${I(5)}{`,
          `${I(6)}foreignKeyName: ${JSON.stringify(f.conname)}`,
          `${I(6)}columns: [${f.columnas.map((x) => JSON.stringify(x)).join(", ")}]`,
          `${I(6)}isOneToOne: ${f.uno_a_uno}`,
          `${I(6)}referencedRelation: ${JSON.stringify(f.ref_tabla)}`,
          `${I(6)}referencedColumns: [${f.ref_columnas.map((x) => JSON.stringify(x)).join(", ")}]`,
          `${I(5)}},`,
        )
      }
      L.push(`${I(4)}]`)
    }
    L.push(`${I(3)}}`)
  }
  L.push(`${I(2)}}`, `${I(2)}Views: {`, `${I(3)}[_ in never]: never`, `${I(2)}}`, `${I(2)}Functions: {`)

  // Funciones sobrecargadas: se unen con "|" como hace supabase gen types.
  const porNombre = new Map()
  for (const f of funciones) porNombre.set(f.proname, [...(porNombre.get(f.proname) ?? []), f])
  for (const [nombre, variantes] of porNombre) {
    const partes = variantes.map((f) => {
      const tiposArgs = f.todos ?? f.argtipos
      const modos = f.modos ?? tiposArgs.map(() => "i")
      const nombres = f.nombres ?? []
      const entrada = []
      const salidaTabla = []
      tiposArgs.forEach((oid, i) => {
        const m = modos[i]
        if (m === "i" || m === "b" || m === "v") entrada.push({ nombre: nombres[i] || `arg${i + 1}`, oid })
        if (m === "t" || m === "o" || m === "b") salidaTabla.push({ nombre: nombres[i] || `col${i + 1}`, oid })
      })
      const conDefault = entrada.length - f.pronargdefaults
      const args = entrada.length
        ? `{ ${entrada
            .map((a, i) => `${clave(a.nombre)}${i >= conDefault ? "?" : ""}: ${tsTipo(a.oid)}`)
            .join("; ")} }`
        : "never"
      let ret
      if (modos.includes("t") || (modos.includes("o") && salidaTabla.length > 1)) {
        ret = `{ ${salidaTabla.map((c) => `${clave(c.nombre)}: ${tsTipo(c.oid)}`).join("; ")} }`
      } else ret = tsTipo(f.ret)
      if (f.proretset) ret = `${envolver(ret)}[]`
      return `{ Args: ${args}; Returns: ${ret} }`
    })
    L.push(`${I(3)}${clave(nombre)}: ${partes.join(" | ")}`)
  }
  L.push(`${I(2)}}`, `${I(2)}Enums: {`)
  if (!enums.length) L.push(`${I(3)}[_ in never]: never`)
  for (const e of enums) L.push(`${I(3)}${clave(e.typname)}: ${e.valores.map((v) => JSON.stringify(v)).join(" | ")}`)
  L.push(`${I(2)}}`, `${I(2)}CompositeTypes: {`, `${I(3)}[_ in never]: never`, `${I(2)}}`, `${I(1)}}`, `}`, ``)

  L.push(
    `type Esquema = Database["${ESQUEMA}"]`,
    ``,
    `/** Fila de una tabla, p. ej. \`Tables<"materials">\`. */`,
    `export type Tables<T extends keyof Esquema["Tables"]> = Esquema["Tables"][T]["Row"]`,
    `/** Objeto para insertar en una tabla (las columnas con default son opcionales). */`,
    `export type TablesInsert<T extends keyof Esquema["Tables"]> = Esquema["Tables"][T]["Insert"]`,
    `/** Objeto para actualizar una tabla (todo opcional). */`,
    `export type TablesUpdate<T extends keyof Esquema["Tables"]> = Esquema["Tables"][T]["Update"]`,
    `/** Argumentos y resultado de una función de la base llamada con supabase.rpc(). */`,
    `export type FunctionArgs<F extends keyof Esquema["Functions"]> = Esquema["Functions"][F]["Args"]`,
    `export type FunctionReturns<F extends keyof Esquema["Functions"]> = Esquema["Functions"][F]["Returns"]`,
    ``,
  )

  fs.mkdirSync(path.dirname(salida), { recursive: true })
  fs.writeFileSync(salida, L.join("\n"))
  console.log(`Listo: ${salida} — ${tablas.length} tablas, ${porNombre.size} funciones, ${enums.length} enums.`)
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
