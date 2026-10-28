// Buscador tolerante de fórmulas del pedido (28/10): por partes, sin guiones, espacios ni paréntesis.
import { test } from "node:test"
import assert from "node:assert/strict"
import { coincideBusqueda } from "../buscar-texto.ts"

const H21 = ["H21-620-10 C (CAN)", "H21-620-10 C (CAN)"]

test("encuentra H21-620-10 C (CAN) por partes y en cualquier formato", () => {
  for (const q of ["h21 620", "h21-620-10", "620 10 c", "H21", "h2162010", "(can) h21", "h21-620-10 c (can)", "  H21  620  "]) assert.equal(coincideBusqueda(q, ...H21), true, q)
})

test("no encuentra lo que no es", () => {
  for (const q of ["h30", "h21 612", "hud", "h21 620 15"]) assert.equal(coincideBusqueda(q, ...H21), false, q)
  assert.equal(coincideBusqueda("h35 612", "H35-612-10 C (CAN)"), true)
  assert.equal(coincideBusqueda("", "lo que sea"), true)
})
