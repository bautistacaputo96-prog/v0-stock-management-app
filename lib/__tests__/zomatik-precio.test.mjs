// Pruebas del precio por m³ al programar (docs/specs/2026-11-16-precio-en-programacion.md): la lista de precios de
// Zomatik (export sin códigos, cruce por nombre), la lista cerrada de rutas, lo que se tipea en la pantalla y lo que
// acepta "sincronizar". Sin red ni base.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import * as XLSX from "xlsx"
import * as P from "../zomatik/parseo.ts"
import * as N from "../zomatik/np.ts"
import * as W from "../zomatik/web.ts"

const ruta = (f) => new URL(`../__fixtures__/zomatik-listas/${f}`, import.meta.url)
/** Igual que fetchListaXls (cliente.ts): la primera hoja como matriz. */
const matriz = (buf) => {
  const wb = XLSX.read(buf, { type: "buffer" })
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: "" })
}
const ARTICULOS = [
  { codigo: 10090010, nombre: "H13-620-10 C (CAN)" },
  { codigo: 10090020, nombre: "H21-620-10 C (CAN)" },
  { codigo: 10090120, nombre: "H25-620-15 B (HUD)" },
  { codigo: 10090030, nombre: "h30 -620-10 c (can)" },
  { codigo: 1, nombre: "SERVICIO DE BOMBEO" },
  { codigo: 2, nombre: "SERVICIO DE BOMBEO" }, // repetido: no se sabe cuál
]

test("lista 10248 (estructura real, sin códigos): H21-620-10 C (CAN) → 176.500; el título y las cabeceras no son precios", () => {
  const ps = P.preciosDeLista(matriz(readFileSync(ruta("lista-10248.xlsx"))))
  const de = (n) => ps.find((p) => p.articulo_nombre === n)?.precio
  assert.equal(de("H21-620-10 C (CAN)"), 176500)
  assert.equal(de("H13-620-10 C (CAN)"), 163000)
  assert.equal(de("H25-620-15 B (HUD)"), 184000)
  assert.equal(de("FIBRA SINTETICA KG"), 12500.5) // precio como texto con coma
  assert.equal(de("H30 -620-10 C (CAN)"), 199999) // espacios de más, normalizados
  assert.ok(!ps.some((p) => /Lista de precios|Hormigon|Servicios/i.test(p.articulo_nombre)))
  assert.equal(ps.length, 6)
})

test("cruce por nombre: exacto sin mayúsculas ni espacios de más; sin cruce o con dos artículos, no se usa", () => {
  const ps = P.preciosDeLista(matriz(readFileSync(ruta("lista-10248.xlsx"))))
  const c = P.cruzarPreciosLista(ps, ARTICULOS)
  const de = (cod) => c.find((x) => x.articulo_codigo === cod)?.precio
  assert.equal(de(10090020), 176500)
  assert.equal(de(10090030), 199999)
  assert.equal(c.some((x) => x.articulo_nombre === "SERVICIO DE BOMBEO"), false, "dos artículos con el mismo nombre")
  assert.equal(c.some((x) => x.articulo_nombre === "FIBRA SINTETICA KG"), false, "no está en los artículos")
  assert.equal(c.length, 4)
  // el mismo nombre con dos precios en la lista: no se usa
  assert.equal(P.cruzarPreciosLista([{ articulo_nombre: "H21-620-10 C (CAN)", precio: 1 }, { articulo_nombre: "h21-620-10 c (can)", precio: 2 }], ARTICULOS).length, 0)
})

test("listaActiva sobre la copia: la única activa (OCTUBRE 2026) vale para la NP (15) y la NP2 (16)", () => {
  const ls = N.listasDeListado(readFileSync(ruta("listado-listas.html"), "latin1"))
  assert.equal(ls.length, 3)
  for (const c of ["15", "16"]) {
    const r = N.listaActiva(ls, c)
    assert.ok("lista" in r)
    assert.equal(r.lista.codigo, 10248)
  }
  const dos = ls.map((l) => ({ ...l, estado: "Activo" }))
  assert.equal(N.listaActiva(dos, "15").lista.codigo, 10247) // "en 1"
  assert.equal(N.listaActiva(dos, "16").lista.codigo, 10243) // "en 2"
})

test("lista cerrada: se leen listado_listas.php y exportar_lista.php?lista=N (y su xlsx); nada de modificar ni grabar", () => {
  assert.equal(W.rutaPermitida("listado_listas.php", "GET"), true)
  assert.equal(W.rutaPermitida("exportar_lista.php?lista=10248", "GET"), true)
  assert.equal(W.rutaPermitida("output/exportar_lista.xlsx", "GET"), true)
  assert.equal(W.rutaPermitida("exportar_lista.php?lista=abc", "GET"), false)
  assert.equal(W.rutaPermitida("exportar_lista.php?lista=10248&x=1", "GET"), false)
  assert.equal(W.rutaPermitida("exportar_lista.php?lista=10248", "POST"), false)
  assert.equal(W.rutaPermitida("listado_listas.php", "POST"), false)
  assert.equal(W.rutaPermitida("modificar_listas.php?codigo=10248", "GET"), false)
  assert.equal(W.rutaPermitida("grabar_listas.php", "GET"), false)
  assert.equal(W.rutaPermitida("grabar_listas.php", "POST"), false)
})

test("lo que se tipea: 170000, 170.000 y 170000,50; vacío = la lista; igual a la lista = vacío; 0 o negativo no", () => {
  assert.equal(N.precioDeTexto("170000"), 170000)
  assert.equal(N.precioDeTexto("170.000"), 170000)
  assert.equal(N.precioDeTexto("170000,50"), 170000.5)
  assert.equal(N.precioDeTexto(""), null)
  const f = (texto, extra = {}) => N.precioParaEnviar({ texto, tocado: true, editable: true, lista: 176500, ...extra })
  assert.deepEqual(f("170.000"), { valor: 170000 })
  assert.deepEqual(f(""), { valor: null })
  assert.deepEqual(f("176.500"), { valor: null }, "exactamente el de la lista: no queda puesto a mano")
  assert.deepEqual(f("0"), { error: N.MSJ_PRECIO_INVALIDO })
  assert.deepEqual(f("-5"), { error: N.MSJ_PRECIO_INVALIDO })
  assert.deepEqual(f("abc"), { error: N.MSJ_PRECIO_INVALIDO })
  assert.deepEqual(f("100.000.000"), { error: N.MSJ_PRECIO_INVALIDO })
  assert.deepEqual(f("170000", { tocado: false }), { valor: undefined }, "sin tocar no se manda")
  assert.deepEqual(f("170000", { editable: false }), { valor: undefined }, "no editable (ya salió la NP, proyecto, saldo) no se manda")
  assert.deepEqual(f("170000", { lista: null }), { valor: 170000 })
  assert.equal(N.textoPrecio(176500), "176.500")
  assert.equal(N.diferenciaConLista(170000, 176500), "−3,7 % de la lista")
  assert.equal(N.diferenciaConLista(176500, 176500), null)
})

test("sincronizar: precio_m3 sin el permiso se ignora; con el permiso, 0/negativo/texto → error (400); null = lista", () => {
  assert.deepEqual(N.precioDelCuerpo({ precio_m3: 170000 }, false), {})
  assert.deepEqual(N.precioDelCuerpo({ precio_m3: 0 }, false), {}, "sin permiso ni se valida: no cambia nada")
  assert.deepEqual(N.precioDelCuerpo({}, true), {})
  assert.deepEqual(N.precioDelCuerpo({ precio_m3: 170000 }, true), { precio: 170000 })
  assert.deepEqual(N.precioDelCuerpo({ precio_m3: null }, true), { precio: null })
  for (const v of [0, -1, "170000", 1e8, Number.NaN, {}]) assert.deepEqual(N.precioDelCuerpo({ precio_m3: v }, true), { error: N.MSJ_PRECIO_INVALIDO }, String(v))
})

test("bloqueado: la NP nueva de esa fórmula salió (ok, generando, revisar) o se cortó en Grabar; pendiente/error/anulada no", () => {
  const np = (x) => ({ tipo: "nueva", formula_id: "f1", estado: "pendiente", paso: null, ...x })
  assert.equal(N.precioBloqueado([np({})], "f1"), false)
  assert.equal(N.precioBloqueado([np({ estado: "error", paso: "lista" })], "f1"), false)
  assert.equal(N.precioBloqueado([np({ estado: "anulada" })], "f1"), false)
  for (const estado of ["ok", "generando", "revisar", "vaciar", "vaciada"]) assert.equal(N.precioBloqueado([np({ estado })], "f1"), true, estado)
  assert.equal(N.precioBloqueado([np({ estado: "pendiente", paso: "grabar_cortado" })], "f1"), true)
  assert.equal(N.precioBloqueado([np({ estado: "ok", formula_id: "f2" })], "f1"), false, "otra fórmula")
  assert.equal(N.precioBloqueado([np({ estado: "ok", tipo: "proyecto" })], "f1"), false, "la de proyecto no cuenta")
})
