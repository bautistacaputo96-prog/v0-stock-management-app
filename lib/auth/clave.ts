/**
 * Contraseñas (fase 0c-1). SOLO servidor: usa `crypto` de Node y guarda la contraseña común de antes,
 * que no puede llegar nunca al navegador. No importar desde componentes.
 *
 * Hash: scrypt (N=16384, r=8, p=1, 64 bytes, sal aleatoria de 16 bytes) →
 * "scrypt$16384$8$1$<sal base64>$<hash base64>". Nunca se guarda ni se registra el texto.
 *
 * Sin imports de otros archivos del proyecto (se prueba con `node --test`).
 */
import { randomBytes, scrypt, timingSafeEqual } from "crypto"

const N = 16384
const R = 8
const P = 1
const LARGO = 64
const SAL = 16

/** Mínimo de caracteres de una contraseña nueva. */
export const MINIMO_CLAVE = 6

/**
 * Normaliza como el login de antes: minúsculas, sin tildes, sin espacios a los costados.
 * Solo se usa para la contraseña común (las propias distinguen mayúsculas).
 */
function normalizarComun(valor: string): string {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
}

/**
 * La contraseña común de antes de la fase 0c-1 (era la misma para todos y estaba en el código del login).
 * Vive SOLO acá. Sirve para el primer ingreso de los usuarios que ya existían, hasta que eligen la suya o
 * un gerencial cierra ese ingreso desde Usuarios.
 */
const CLAVE_COMUN = normalizarComun("Rebucret")

export function esClaveComun(texto: string): boolean {
  const a = Buffer.from(normalizarComun(texto))
  const b = Buffer.from(CLAVE_COMUN)
  return a.length === b.length && timingSafeEqual(a, b)
}

function scryptAsync(clave: string, sal: Buffer, largo: number, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(clave, sal, largo, { N: n, r, p, maxmem: 128 * n * r * 2 }, (err, key) => (err ? reject(err) : resolve(key)))
  })
}

export async function hashClave(clave: string): Promise<string> {
  const sal = randomBytes(SAL)
  const hash = await scryptAsync(String(clave), sal, LARGO, N, R, P)
  return `scrypt$${N}$${R}$${P}$${sal.toString("base64")}$${hash.toString("base64")}`
}

/** true si la contraseña coincide con el hash. Nunca tira error: con datos inválidos devuelve false. */
export async function verificarClave(clave: string, guardado: string | null | undefined): Promise<boolean> {
  try {
    if (typeof clave !== "string" || typeof guardado !== "string") return false
    const partes = guardado.split("$")
    if (partes.length !== 6 || partes[0] !== "scrypt") return false
    const n = Number(partes[1])
    const r = Number(partes[2])
    const p = Number(partes[3])
    if (![n, r, p].every((x) => Number.isInteger(x) && x > 0) || n > 1 << 20 || r > 32 || p > 16) return false
    const sal = Buffer.from(partes[4], "base64")
    const esperado = Buffer.from(partes[5], "base64")
    if (sal.length === 0 || esperado.length === 0) return false
    const hash = await scryptAsync(clave, sal, esperado.length, n, r, p)
    return hash.length === esperado.length && timingSafeEqual(hash, esperado)
  } catch {
    return false
  }
}

/** Texto del error para una contraseña nueva, o null si está bien. */
export function validarClaveNueva(nombre: string, clave: string): string | null {
  const c = typeof clave === "string" ? clave : ""
  if (c.trim().length < MINIMO_CLAVE) return `La contraseña tiene que tener al menos ${MINIMO_CLAVE} letras o números.`
  if (c !== c.trim()) return "La contraseña no puede empezar ni terminar con espacios."
  if (normalizarComun(c) === normalizarComun(nombre || "")) return "La contraseña no puede ser tu nombre."
  if (esClaveComun(c)) return "No uses la contraseña de antes (la que era igual para todos). Elegí una propia."
  return null
}
