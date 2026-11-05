// Dirección y localidad de la obra a partir de lo que devuelve el mapa (05/11): Google, Photon y Nominatim.
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  direccionDeGoogle, direccionDeNominatim, direccionDePhoton,
  completarVacios, difiereDelMapa, usarDelMapa, textoDireccion, normalizarDireccion,
} from "../geo-direccion.ts"
import { normalizarLugarGoogle, normalizarTextSearchGoogle, normalizarOsm } from "../geo-lugares.ts"

const comp = (longText, ...types) => ({ longText, shortText: longText, types })

// ---------------------------------------------------------------- Google
const GOOGLE_CALLE = {
  displayName: { text: "Av. Mariano Castex 1277" },
  formattedAddress: "Av. Mariano Castex 1277, B1804 Canning, Provincia de Buenos Aires, Argentina",
  types: ["street_address"],
  addressComponents: [
    comp("1277", "street_number"),
    comp("Avenida Mariano Castex", "route"),
    comp("Canning", "locality"),
    comp("Partido de Esteban Echeverría", "administrative_area_level_2"),
    comp("Provincia de Buenos Aires", "administrative_area_level_1"),
    comp("Argentina", "country"),
    comp("B1804", "postal_code"),
  ],
}

test("Google: calle y número + localidad", () => {
  assert.deepEqual(direccionDeGoogle(GOOGLE_CALLE), { direccion: "Avenida Mariano Castex 1277", localidad: "Canning" })
})

test("Google: barrio cerrado sin número usa el nombre del lugar", () => {
  const d = {
    displayName: { text: "Santa Clara al Sur" },
    types: ["neighborhood", "political"],
    addressComponents: [comp("Santa Clara al Sur", "neighborhood"), comp("Canning", "locality"), comp("Partido de Ezeiza", "administrative_area_level_2")],
  }
  assert.deepEqual(direccionDeGoogle(d), { direccion: "Santa Clara al Sur", localidad: "Canning" })
})

test("Google: sin localidad usa el partido sin 'Partido de'", () => {
  const d = { displayName: { text: "Ruta 58 km 14" }, types: ["route"], addressComponents: [comp("Ruta Provincial 58", "route"), comp("Partido de San Vicente", "administrative_area_level_2")] }
  assert.deepEqual(direccionDeGoogle(d), { direccion: "Ruta 58 km 14", localidad: "San Vicente" })
})

test("Google: si el lugar es la localidad, no hay dirección", () => {
  const d = { displayName: { text: "Canning" }, types: ["locality", "political"], addressComponents: [comp("Canning", "locality"), comp("Partido de Esteban Echeverría", "administrative_area_level_2")] }
  assert.deepEqual(direccionDeGoogle(d), { direccion: null, localidad: "Canning" })
})

test("Google: sin addressComponents se arma con formattedAddress (sin código postal)", () => {
  assert.deepEqual(direccionDeGoogle({ formattedAddress: "Av. Mariano Castex 1277, B1804 Canning, Provincia de Buenos Aires, Argentina" }), { direccion: "Av. Mariano Castex 1277", localidad: "Canning" })
  assert.deepEqual(direccionDeGoogle({ formattedAddress: "Canning, Provincia de Buenos Aires, Argentina", displayName: { text: "Canning" } }), { direccion: null, localidad: "Canning" })
  assert.deepEqual(direccionDeGoogle({}), { direccion: null, localidad: null })
})

test("Google: los normalizadores pasan la dirección del mapa", () => {
  const lugar = normalizarLugarGoogle({ ...GOOGLE_CALLE, location: { latitude: -34.9, longitude: -58.5 } }, "abc")
  assert.deepEqual(lugar.direccionMapa, { direccion: "Avenida Mariano Castex 1277", localidad: "Canning" })
  const [sg] = normalizarTextSearchGoogle({ places: [{ id: "x1", ...GOOGLE_CALLE, location: { latitude: -34.9, longitude: -58.5 } }] })
  assert.deepEqual(sg.direccionMapa, { direccion: "Avenida Mariano Castex 1277", localidad: "Canning" })
})

// ---------------------------------------------------------------- Nominatim
test("Nominatim reverse: calle y número + localidad", () => {
  const d = { name: "", address: { house_number: "450", road: "Calle Sarmiento", town: "Canning", county: "Partido de Esteban Echeverría", state: "Buenos Aires", country: "Argentina" } }
  assert.deepEqual(direccionDeNominatim(d), { direccion: "Calle Sarmiento 450", localidad: "Canning" })
})

test("Nominatim: sin número queda la calle; sin ciudad, el barrio o el partido", () => {
  assert.deepEqual(direccionDeNominatim({ address: { road: "Camino de Cintura", suburb: "Barrio La Tercera" } }), { direccion: "Camino de Cintura", localidad: "Barrio La Tercera" })
  assert.deepEqual(direccionDeNominatim({ address: { road: "Ruta 6", county: "Partido de San Vicente" } }), { direccion: "Ruta 6", localidad: "San Vicente" })
  assert.deepEqual(direccionDeNominatim({ name: "Club de Campo El Carmen", address: { city: "Guernica" } }), { direccion: "Club de Campo El Carmen", localidad: "Guernica" })
})

test("Nominatim: el nombre que es la localidad no es dirección; vacío da null", () => {
  assert.deepEqual(direccionDeNominatim({ name: "Canning", address: { town: "Canning" } }), { direccion: null, localidad: "Canning" })
  assert.deepEqual(direccionDeNominatim({}), { direccion: null, localidad: null })
  assert.deepEqual(direccionDeNominatim(null), { direccion: null, localidad: null })
})

// ---------------------------------------------------------------- Photon
test("Photon: casa con número, calle, barrio y localidad", () => {
  assert.deepEqual(direccionDePhoton({ type: "house", street: "Sarmiento", housenumber: "450", city: "Canning" }), { direccion: "Sarmiento 450", localidad: "Canning" })
  assert.deepEqual(direccionDePhoton({ type: "street", name: "Camino de Cintura", city: "San Vicente" }), { direccion: "Camino de Cintura", localidad: "San Vicente" })
  assert.deepEqual(direccionDePhoton({ type: "district", name: "Santa Clara al Sur", county: "Partido de Esteban Echeverría" }), { direccion: "Santa Clara al Sur", localidad: "Esteban Echeverría" })
})

test("Photon: si el lugar es una ciudad, es la localidad", () => {
  assert.deepEqual(direccionDePhoton({ type: "city", name: "Hudson", county: "Partido de Berazategui" }), { direccion: null, localidad: "Hudson" })
})

test("OSM: normalizarOsm pasa la dirección del mapa", () => {
  const [sg] = normalizarOsm([{ nombre: "Sarmiento 450, Canning", lat: -34.9, lng: -58.5, localidad: "Canning", direccionMapa: { direccion: "Sarmiento 450", localidad: "Canning" } }])
  assert.deepEqual(sg.direccionMapa, { direccion: "Sarmiento 450", localidad: "Canning" })
  const [sin] = normalizarOsm([{ nombre: "X", lat: -34.9, lng: -58.5 }])
  assert.equal(sin.direccionMapa, null)
})

// ---------------------------------------------------------------- formulario
const MAPA = { direccion: "Av. X 123", localidad: "Canning" }

test("completarVacios: completa solo lo vacío", () => {
  assert.deepEqual(completarVacios({ direccion: "", localidad: "" }, MAPA), { direccion: "Av. X 123", localidad: "Canning" })
  assert.deepEqual(completarVacios({ direccion: "Lote 45", localidad: "  " }, MAPA), { direccion: "Lote 45", localidad: "Canning" })
  assert.deepEqual(completarVacios({ direccion: "", localidad: "" }, { direccion: null, localidad: "Canning" }), { direccion: "", localidad: "Canning" })
  assert.deepEqual(completarVacios({ direccion: "a", localidad: "b" }, null), { direccion: "a", localidad: "b" })
})

test("difiereDelMapa: ignora mayúsculas, tildes y puntos", () => {
  assert.equal(difiereDelMapa({ direccion: "Lote 45", localidad: "Canning" }, MAPA), true)
  assert.equal(difiereDelMapa({ direccion: "av x 123", localidad: "CANNING" }, MAPA), false)
  assert.equal(difiereDelMapa({ direccion: "Av. X 123", localidad: "San Vicente" }, MAPA), true)
  assert.equal(difiereDelMapa({ direccion: "Lote 45", localidad: "Canning" }, { direccion: null, localidad: "Canning" }), false)
  assert.equal(difiereDelMapa({ direccion: "a", localidad: "b" }, null), false)
  assert.equal(normalizarDireccion(" Echeverría,  Av. "), "echeverria av")
})

test("usarDelMapa reemplaza con lo que trae el mapa; textoDireccion", () => {
  assert.deepEqual(usarDelMapa({ direccion: "Lote 45", localidad: "Ezeiza" }, MAPA), { direccion: "Av. X 123", localidad: "Canning" })
  assert.deepEqual(usarDelMapa({ direccion: "Lote 45", localidad: "Ezeiza" }, { direccion: null, localidad: "Canning" }), { direccion: "Lote 45", localidad: "Canning" })
  assert.equal(textoDireccion(MAPA), "Av. X 123, Canning")
  assert.equal(textoDireccion({ direccion: null, localidad: "Canning" }), "Canning")
})
