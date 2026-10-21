// Zomatik Z0 · Primera carga de vínculos: clientes, fórmulas y proyectos abiertos (spec 11, 6.7 y 17.7.5).
//
// Se corre AL PUBLICAR, después de aplicar la migración 202610211800_zomatik_z0_lecturas.sql y de la primera
// lectura de Zomatik (/api/zomatik/leer: las copias zomatik_* tienen que estar llenas). No toca Zomatik.
//
// Usa las mismas reglas que la pantalla "Vínculos con Zomatik" (lib/zomatik/vinculos.ts):
//   - clientes: CUIT válido igual, o nombre igual sin tildes ni S.A./ARQ/ING/FIDEICOMISO, único de los dos lados;
//   - fórmulas: nombre igual, o igual con las reglas (sufijo de planta, 6/12 → 612, GUN → GUNITADO, PELQUE);
//   - proyectos: obra del cliente vinculado con el mismo nombre.
// Solo graba los SEGUROS, con vínculo 'auto'. Los dudosos quedan para confirmar a mano en la pantalla.
// Nunca pisa un vínculo que ya existe (ni un "sin par" que puso una persona).
//
//   PARTE A (solo lectura, por defecto): muestra los conteos y la lista de dudosos.
//   PARTE B (--escribir): graba los seguros y TERMINA EN ROLLBACK (no queda nada grabado).
//   Recién con el OK de Bautista: --escribir --commit.
//
// Uso (desde la raíz del repo):
//   export PGCONN=$(grep '^POSTGRES_URL_NON_POOLING=' .env.rebucret | cut -d= -f2- | tr -d '"')   # sin imprimirla
//   node --experimental-strip-types --no-warnings --import ./lib/__tests__/alias.mjs scripts/zomatik-primera-carga.mjs
//   node --experimental-strip-types --no-warnings --import ./lib/__tests__/alias.mjs scripts/zomatik-primera-carga.mjs --escribir
//   node --experimental-strip-types --no-warnings --import ./lib/__tests__/alias.mjs scripts/zomatik-primera-carga.mjs --escribir --commit

import { proponerClientes, proponerFormulas, proponerProyectos } from "../lib/zomatik/vinculos.ts"

const USUARIO = "Primera carga Zomatik"
const corto = (s, n = 28) => {
  const t = String(s ?? "")
  return t.length > n ? t.slice(0, n - 1) + "…" : t
}

/**
 * Calcula (y si `escribir`, graba) los vínculos seguros. `q(sql, params)` devuelve las filas.
 * La transacción la maneja quien llama. Devuelve los conteos.
 */
export async function primeraCarga(q, { escribir = false, log = console.log } = {}) {
  const clientes = await q(`select id, name, razon_social, cuit, zomatik_codigo, zomatik_vinculo from clients where active is not false`)
  const zcli = await q(`select codigo, razon_social, cuit, remitos_r_12m + remitos_x_12m as remitos_12m from zomatik_clientes where estado is null or estado ilike 'activ%'`)
  const formulas = await q(`select f.id, f.name, f.code, coalesce(p.name, '') as planta, f.zomatik_articulo_codigo, f.zomatik_vinculo from formulas f left join plants p on p.id = f.plant_id`)
  const arts = await q(`select codigo, nombre, linea from zomatik_articulos`)
  const proys = await q(`select codigo, numero, cliente_codigo, cliente_nombre, obra, construction_site_id, vinculo from zomatik_proyectos where estado = 'abierto'`)
  const obras = await q(`select id, name, client_id from construction_sites`)
  if (zcli.length === 0 || arts.length === 0) {
    log("⚠ Las copias de Zomatik están vacías: primero hay que correr la lectura (/api/zomatik/leer).")
    return null
  }
  const usados = new Set(clientes.filter((c) => c.zomatik_codigo != null).map((c) => Number(c.zomatik_codigo)))
  const zLibres = zcli.map((z) => ({ ...z, remitos_12m: Number(z.remitos_12m) || 0 })).filter((z) => !usados.has(Number(z.codigo)))

  // ── Clientes ──
  const sinRevisar = clientes.filter((c) => c.zomatik_vinculo == null)
  const pc = proponerClientes(sinRevisar, zLibres)
  const cSeg = [...pc.entries()].filter(([, p]) => p.certeza === "seguro")
  const cDud = [...pc.entries()].filter(([, p]) => p.certeza === "dudoso")
  const nombreC = new Map(clientes.map((c) => [c.id, c.name]))
  log(`\nCLIENTES (${clientes.length} activos; ${clientes.length - sinRevisar.length} ya revisados; copia de Zomatik: ${zcli.length})`)
  log(`  seguros: ${cSeg.length} (por CUIT ${cSeg.filter(([, p]) => p.motivo === "CUIT igual").length}, por nombre ${cSeg.filter(([, p]) => p.motivo === "Nombre igual").length})`)
  log(`  dudosos (confirmar a mano): ${cDud.length}`)
  log(`  sin par: ${sinRevisar.length - pc.size}`)
  for (const [id, p] of cDud) log(`    ? ${corto(nombreC.get(id))}  ~  ${corto(p.candidato.razon_social)} (${p.candidato.codigo}) · ${p.motivo} ${p.puntaje}`)

  // ── Fórmulas ──
  const fSin = formulas.filter((f) => f.zomatik_vinculo == null)
  const pf = proponerFormulas(fSin, arts)
  const fSeg = [...pf.entries()].filter(([, p]) => p.certeza === "seguro")
  const fDud = [...pf.entries()].filter(([, p]) => p.certeza === "dudoso")
  const nombreF = new Map(formulas.map((f) => [f.id, `${f.planta}: ${f.name}`]))
  log(`\nFÓRMULAS (${formulas.length}; ${formulas.length - fSin.length} ya revisadas; artículos de Zomatik: ${arts.length})`)
  log(`  seguras: ${fSeg.length} (nombre igual ${fSeg.filter(([, p]) => p.motivo === "Nombre igual").length}, con reglas ${fSeg.filter(([, p]) => p.motivo !== "Nombre igual").length})`)
  log(`  dudosas (confirmar a mano): ${fDud.length}`)
  log(`  sin par: ${fSin.length - pf.size}`)
  for (const [id, p] of fDud) log(`    ? ${corto(nombreF.get(id), 32)}  ~  ${p.candidato.nombre} · ${p.puntaje}`)

  // ── Proyectos ──  (con los clientes ya vinculados más los seguros de esta corrida)
  const clientePorCodigo = new Map(clientes.filter((c) => c.zomatik_codigo != null).map((c) => [Number(c.zomatik_codigo), c.id]))
  for (const [id, p] of cSeg) if (!clientePorCodigo.has(p.candidato.codigo)) clientePorCodigo.set(p.candidato.codigo, id)
  const pSin = proys.filter((p) => p.vinculo == null)
  const pp = proponerProyectos(pSin, obras, clientePorCodigo)
  const pSeg = [...pp.entries()].filter(([, p]) => p.certeza === "seguro")
  const pDud = [...pp.entries()].filter(([, p]) => p.certeza === "dudoso")
  const sinCliente = pSin.filter((p) => !clientePorCodigo.has(Number(p.cliente_codigo))).length
  log(`\nPROYECTOS ABIERTOS (${proys.length}; ${proys.length - pSin.length} ya revisados)`)
  log(`  seguros: ${pSeg.length}`)
  log(`  dudosos (confirmar a mano): ${pDud.length}`)
  log(`  sin propuesta: ${pSin.length - pp.size} (de ellos, ${sinCliente} con el cliente sin vincular)`)
  const numeroP = new Map(proys.map((p) => [p.codigo, `${p.numero} ${corto(p.obra || p.cliente_nombre, 30)}`]))
  for (const [cod, p] of pDud) log(`    ? ${numeroP.get(cod)}  ~  obra ${corto(p.candidato.name)} · ${p.motivo}`)

  // Clientes de Zomatik con remitos en el año que no quedarían vinculados (se traen con "Traer de Zomatik")
  const vinculadosZ = new Set([...usados, ...cSeg.map(([, p]) => p.candidato.codigo)])
  const delAnioSinPar = zcli.filter((z) => Number(z.remitos_12m) > 0 && !vinculadosZ.has(Number(z.codigo))).length
  log(`\nClientes de Zomatik con remitos en el último año sin cliente en Rebucret (después de los seguros): ${delAnioSinPar}`)

  const conteos = {
    clientes: { seguros: cSeg.length, dudosos: cDud.length, sinPar: sinRevisar.length - pc.size },
    formulas: { seguras: fSeg.length, dudosas: fDud.length, sinPar: fSin.length - pf.size },
    proyectos: { seguros: pSeg.length, dudosos: pDud.length, sinPropuesta: pSin.length - pp.size },
    zomatikDelAnioSinPar: delAnioSinPar,
  }
  if (!escribir) return conteos

  // ── PARTE B: graba solo los seguros, sin pisar nada (tres UPDATE, para que la transacción sea corta) ──
  const n = { clientes: 0, formulas: 0, proyectos: 0 }
  const jc = JSON.stringify(cSeg.map(([id, p]) => ({ id, codigo: p.candidato.codigo })))
  n.clientes = (
    await q(
      `update clients c set zomatik_codigo = x.codigo, zomatik_vinculo = 'auto', zomatik_vinculado_por = $2, zomatik_vinculado_at = now()
         from json_to_recordset($1::json) as x(id uuid, codigo int)
        where c.id = x.id and c.zomatik_vinculo is null and c.zomatik_codigo is null
          and not exists (select 1 from clients o where o.zomatik_codigo = x.codigo) returning c.id`,
      [jc, USUARIO],
    )
  ).length
  const jf = JSON.stringify(fSeg.map(([id, p]) => ({ id, codigo: p.candidato.codigo, nombre: p.candidato.nombre })))
  n.formulas = (
    await q(
      `update formulas f set zomatik_articulo_codigo = x.codigo, zomatik_articulo_nombre = x.nombre, zomatik_vinculo = 'auto',
              zomatik_vinculado_por = $2, zomatik_vinculado_at = now()
         from json_to_recordset($1::json) as x(id uuid, codigo int, nombre text)
        where f.id = x.id and f.zomatik_vinculo is null and f.zomatik_articulo_codigo is null returning f.id`,
      [jf, USUARIO],
    )
  ).length
  const jp = JSON.stringify(pSeg.map(([cod, p]) => ({ codigo: cod, obra: p.candidato.id })))
  n.proyectos = (
    await q(
      `update zomatik_proyectos z set construction_site_id = x.obra, vinculo = 'auto', vinculado_por = $2, vinculado_at = now()
         from json_to_recordset($1::json) as x(codigo int, obra uuid)
        where z.codigo = x.codigo and z.vinculo is null and z.construction_site_id is null returning z.codigo`,
      [jp, USUARIO],
    )
  ).length
  log(`\nPARTE B · grabados: clientes ${n.clientes}, fórmulas ${n.formulas}, proyectos ${n.proyectos}`)
  const desp = await q(`select (select count(*) from clients where zomatik_codigo is not null)::int as clientes,
                               (select count(*) from formulas where zomatik_articulo_codigo is not null)::int as formulas,
                               (select count(*) from zomatik_proyectos where construction_site_id is not null)::int as proyectos`)
  log(`  vinculados en total después: ${JSON.stringify(desp[0])}`)
  return { ...conteos, grabados: n }
}

// ── Ejecución directa ──
if (import.meta.url === `file://${process.argv[1]}`) {
  const escribir = process.argv.includes("--escribir")
  const commit = process.argv.includes("--commit")
  if (!process.env.PGCONN) {
    console.error("Falta la variable PGCONN (POSTGRES_URL_NON_POOLING de .env.rebucret).")
    process.exit(1)
  }
  const pg = (await import("pg")).default
  const corte = setTimeout(() => {
    console.error("Se cortó: la base no respondió a tiempo.")
    process.exit(2)
  }, 120_000)
  const cliente = new pg.Client({ connectionString: process.env.PGCONN.replace(/[?&]sslmode=[^&]*/, ""), ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15_000 })
  await cliente.connect()
  const q = async (sql, params = []) => (await cliente.query(sql, params)).rows
  try {
    await cliente.query(escribir ? "BEGIN" : "BEGIN READ ONLY")
    await cliente.query("SET LOCAL lock_timeout = '2s'")
    await cliente.query("SET LOCAL statement_timeout = '60s'")
    console.log(escribir ? `PARTE B (escribe) · termina en ${commit ? "COMMIT" : "ROLLBACK"}` : "PARTE A (solo lectura)")
    await primeraCarga(q, { escribir })
    if (escribir && commit) {
      await cliente.query("COMMIT")
      console.log("\nCOMMIT: los vínculos seguros quedaron grabados.")
    } else {
      await cliente.query("ROLLBACK")
      if (escribir) console.log("\nROLLBACK: no quedó nada grabado. Para grabar, con el OK de Bautista: --escribir --commit")
    }
  } catch (e) {
    await cliente.query("ROLLBACK").catch(() => {})
    console.error("Error:", e.message)
    process.exitCode = 1
  } finally {
    clearTimeout(corte)
    await cliente.end()
  }
}
