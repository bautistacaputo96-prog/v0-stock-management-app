// Dirección y localidad de la obra a partir de lo que devuelve el mapa (05/11): Google, Photon y Nominatim.
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  direccionDeGoogle, direccionDeNominatim, direccionDePhoton,
  completarVacios, difiereDelMapa, usarDelMapa, textoDireccion, normalizarDireccion, redondearCoord, normalizarLocalidad,
} from "../geo-direccion.ts"
import { normalizarLugarGoogle, normalizarTextSearchGoogle, normalizarOsm } from "../geo-lugares.ts"
import { crearTurnos } from "../turnos.ts"

const comp = (longText, ...types) => ({ longText, shortText: longText, types })

// ---------------------------------------------------------------- Google
const GOOGLE_CALLE = {
  displayName: { text: "Av. Mariano Castex 1277" },
  formattedAddress: "Av. Mariano Castex 1277, B1804 Canning, Provincia de Buenos Aires, Argentina",
  types: ["street_address"],
  addressComponents: [
    comp("1277", "street_number"),
    { longText: "Avenida Mariano Castex", shortText: "Av. Mariano Castex", types: ["route"] },
    comp("Canning", "locality"),
    comp("Partido de Esteban Echeverría", "administrative_area_level_2"),
    comp("Provincia de Buenos Aires", "administrative_area_level_1"),
    comp("Argentina", "country"),
    comp("B1804", "postal_code"),
  ],
}

test("Google: calle y número + localidad", () => {
  assert.deepEqual(direccionDeGoogle(GOOGLE_CALLE), { direccion: "Av. Mariano Castex 1277", localidad: "Canning" })
})

test("Google: sin shortText usa longText para la calle", () => {
  const d = { types: ["street_address"], addressComponents: [{ longText: "Sarmiento", types: ["route"] }, comp("450", "street_number"), comp("Canning", "locality")] }
  assert.deepEqual(direccionDeGoogle(d), { direccion: "Sarmiento 450", localidad: "Canning" })
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
  assert.deepEqual(lugar.direccionMapa, { direccion: "Av. Mariano Castex 1277", localidad: "Canning" })
  const [sg] = normalizarTextSearchGoogle({ places: [{ id: "x1", ...GOOGLE_CALLE, location: { latitude: -34.9, longitude: -58.5 } }] })
  assert.deepEqual(sg.direccionMapa, { direccion: "Av. Mariano Castex 1277", localidad: "Canning" })
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

test("Nominatim reverse: si lo más cercano es un comercio con nombre y hay calle, va la calle", () => {
  const comercio = { category: "shop", type: "hardware", name: "Corralón El Tano", address: { shop: "Corralón El Tano", road: "Avenida Mariano Castex", town: "Canning" } }
  assert.deepEqual(direccionDeNominatim(comercio, { inversa: true }), { direccion: "Avenida Mariano Castex", localidad: "Canning" })
  const edificio = { category: "building", name: "Torre Uno", address: { house_number: "1277", road: "Avenida Mariano Castex", town: "Canning" } }
  assert.deepEqual(direccionDeNominatim(edificio, { inversa: true }), { direccion: "Avenida Mariano Castex 1277", localidad: "Canning" })
  // Sin calle queda el nombre (un barrio cerrado sin calles cargadas)
  assert.deepEqual(direccionDeNominatim({ name: "Santa Clara al Sur", address: { town: "Canning" } }, { inversa: true }), { direccion: "Santa Clara al Sur", localidad: "Canning" })
  // En la búsqueda normal, el nombre (barrio, club) sigue ganando sobre la calle sin número
  assert.deepEqual(direccionDeNominatim(comercio), { direccion: "Corralón El Tano", localidad: "Canning" })
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

test("normalizarDireccion: Av./Avenida, N°/Nº y Ruta Provincial/RP/Ruta son lo mismo", () => {
  const igual = (a, b) => assert.equal(normalizarDireccion(a), normalizarDireccion(b), `${a} = ${b}`)
  igual("Av. Mariano Castex 1277", "Avenida Mariano Castex 1277")
  igual("Sarmiento N° 450", "Sarmiento Nº 450")
  igual("Sarmiento N°450", "Sarmiento 450")
  igual("Ruta Provincial 58 km 14", "RP 58 km 14")
  igual("RP58 km 14", "Ruta 58 km 14")
  igual("R.P. 58", "Ruta 58")
  assert.notEqual(normalizarDireccion("Ruta 58"), normalizarDireccion("Ruta 6"))
  assert.notEqual(normalizarDireccion("Navarro 12"), normalizarDireccion("Avarro 12"))
  assert.equal(difiereDelMapa({ direccion: "avenida mariano castex 1277", localidad: "Canning" }, { direccion: "Av. Mariano Castex 1277", localidad: "Canning" }), false)
})

test("redondearCoord: 5 decimales", () => {
  assert.equal(redondearCoord(-34.9012345678), -34.90123)
  assert.equal(redondearCoord(-58.123456), -58.12346)
})

test("turnos: solo vale la respuesta de la última elección, y ninguna después de cerrar", () => {
  const t = crearTurnos()
  const a = t.nuevo()
  assert.equal(t.vigente(a), true)
  const b = t.nuevo()
  assert.equal(t.vigente(a), false, "la elección vieja no pisa la nueva")
  assert.equal(t.vigente(b), true)
  t.cerrar()
  assert.equal(t.vigente(b), false, "con el diálogo cerrado no vale ninguna")
  t.abrir()
  assert.equal(t.vigente(b), false, "al volver a abrir, la de antes sigue sin valer")
  const c = t.nuevo()
  assert.equal(t.vigente(c), true)
})

test("usarDelMapa reemplaza con lo que trae el mapa; textoDireccion", () => {
  assert.deepEqual(usarDelMapa({ direccion: "Lote 45", localidad: "Ezeiza" }, MAPA), { direccion: "Av. X 123", localidad: "Canning" })
  assert.deepEqual(usarDelMapa({ direccion: "Lote 45", localidad: "Ezeiza" }, { direccion: null, localidad: "Canning" }), { direccion: "Lote 45", localidad: "Canning" })
  assert.equal(textoDireccion(MAPA), "Av. X 123, Canning")
  assert.equal(textoDireccion({ direccion: null, localidad: "Canning" }), "Canning")
})

test("normalizarLocalidad: sin espacios de más y mayúscula inicial en cada palabra", () => {
  assert.equal(normalizarLocalidad("Berazategui "), "Berazategui")
  assert.equal(normalizarLocalidad("  san   vicente "), "San Vicente")
  assert.equal(normalizarLocalidad("SAN VICENTE"), "San Vicente")
  assert.equal(normalizarLocalidad("florencio varela"), "Florencio Varela")
  assert.equal(normalizarLocalidad("ñuñoa"), "Ñuñoa")
  assert.equal(normalizarLocalidad("ESTEBAN ECHEVERRÍA"), "Esteban Echeverría")
  assert.equal(normalizarLocalidad("   "), "")
  assert.equal(normalizarLocalidad(null), "")
})
