/**
 * ¿La llamada viene del cron de Vercel (o de pg_cron con el mismo secreto)?
 *   - Solo si trae `Authorization: Bearer <CRON_SECRET>` (Vercel lo manda solo cuando la variable está cargada).
 *   - Sin CRON_SECRET: NO (fase 0c-2). Antes se aceptaba el header x-vercel-cron o el user-agent vercel-cron, que
 *     cualquiera puede mandar. Queda un error en el log para que se note que falta la variable.
 *
 * Sin imports (lo usa también lib/armado-dia.ts, que va al navegador; se prueba con `node --test`).
 */
export function esLlamadaDeCron(req: Request): boolean {
  const secreto = process.env.CRON_SECRET
  if (secreto) return igualSeguro(req.headers.get("authorization"), `Bearer ${secreto}`)
  if (req.headers.has("x-vercel-cron") || /vercel-cron/i.test(req.headers.get("user-agent") || "")) {
    console.error("[cron] falta CRON_SECRET en Vercel: la llamada del cron se rechaza")
  }
  return false
}

/**
 * Compara dos textos sin cortar en el primer carácter distinto (el tiempo no dice cuántos acertó). Para secretos
 * de headers. Sin `crypto` para poder usarse desde un archivo que también va al navegador.
 */
export function igualSeguro(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false
  // Recorre siempre el largo de `b` (el esperado); fuera de rango charCodeAt da NaN y `| 0` lo vuelve 0
  let dif = a.length ^ b.length
  for (let i = 0; i < b.length; i++) dif |= (a.charCodeAt(i) | 0) ^ b.charCodeAt(i)
  return dif === 0
}
