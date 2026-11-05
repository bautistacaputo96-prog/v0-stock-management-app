/**
 * Turnos para descartar respuestas viejas: cada elección nueva toma un número y solo vale la respuesta del último;
 * después de cerrar (el componente se desmontó o el diálogo se cerró) no vale ninguna hasta volver a abrir.
 * Sin dependencias (se prueba en lib/__tests__/geo-direccion.test.mjs).
 */
export type Turnos = { nuevo: () => number; vigente: (n: number) => boolean; abrir: () => void; cerrar: () => void }

export function crearTurnos(): Turnos {
  let actual = 0
  let abierto = true
  return {
    nuevo: () => ++actual,
    vigente: (n) => abierto && n === actual,
    abrir: () => { abierto = true },
    cerrar: () => { abierto = false; actual++ },
  }
}
