/**
 * Sesión firmada (fase 0c-1). SOLO servidor.
 *
 * El valor de la cookie es base64url(json).base64url(hmacSHA256) con `SESION_SECRETO`.
 * Contenido: { u: id del usuario, v: sesion_version, e: vencimiento (ms) }. Sin nombre ni permisos: los
 * permisos se leen de la base en cada `GET /api/sesion`.
 *
 * Sin imports de otros archivos del proyecto (se prueba con `node --test`).
 */
import { createHmac, timingSafeEqual } from "crypto"

export type DatosSesion = { u: string; v: number; e: number }

export const DURACION_SESION_MS = 30 * 24 * 60 * 60 * 1000
/** Se renueva sola cuando le quedan menos de 15 días. */
export const RENOVAR_SI_QUEDAN_MS = 15 * 24 * 60 * 60 * 1000

/** Falta SESION_SECRETO (o es corto): las rutas lo devuelven como 500 {codigo: "sin_secreto"}. */
export class SinSecretoError extends Error {
  codigo = "sin_secreto"
  constructor() {
    super("Falta SESION_SECRETO (o tiene menos de 32 caracteres)")
    this.name = "SinSecretoError"
  }
}

function secreto(): string {
  const s = process.env.SESION_SECRETO || ""
  if (s.length < 32) throw new SinSecretoError()
  return s
}

/** Tira SinSecretoError si falta el secreto (para frenar antes de grabar nada). */
export function exigirSecreto(): void {
  secreto()
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function desdeB64url(texto: string): Buffer {
  const b64 = texto.replace(/-/g, "+").replace(/_/g, "/")
  return Buffer.from(b64 + "=".repeat((4 - (b64.length % 4)) % 4), "base64")
}

function firma(cuerpo: string, clave: string): Buffer {
  return createHmac("sha256", clave).update(cuerpo).digest()
}

export function firmarSesion(datos: DatosSesion): string {
  const clave = secreto()
  const cuerpo = b64url(Buffer.from(JSON.stringify({ u: datos.u, v: datos.v, e: datos.e })))
  return `${cuerpo}.${b64url(firma(cuerpo, clave))}`
}

/** Datos de la sesión si la firma es buena y no venció; si no, null. Sin secreto, tira SinSecretoError. */
export function leerSesion(valor: string | null | undefined, ahora: number = Date.now()): DatosSesion | null {
  const clave = secreto()
  if (typeof valor !== "string" || !valor) return null
  const partes = valor.split(".")
  if (partes.length !== 2 || !partes[0] || !partes[1]) return null
  try {
    const esperada = firma(partes[0], clave)
    const recibida = desdeB64url(partes[1])
    if (recibida.length !== esperada.length || !timingSafeEqual(recibida, esperada)) return null
    const d = JSON.parse(desdeB64url(partes[0]).toString("utf8"))
    if (!d || typeof d.u !== "string" || !d.u || !Number.isInteger(d.v) || typeof d.e !== "number") return null
    if (d.e <= ahora) return null
    return { u: d.u, v: d.v, e: d.e }
  } catch {
    return null
  }
}
