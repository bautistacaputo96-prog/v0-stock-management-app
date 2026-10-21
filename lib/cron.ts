/**
 * ¿La llamada viene del cron de Vercel?
 *   - Con CRON_SECRET cargado en Vercel: solo si trae `Authorization: Bearer <CRON_SECRET>` (Vercel lo manda solo).
 *   - Sin CRON_SECRET: como hasta ahora, por el header x-vercel-cron o el user-agent vercel-cron (se pueden
 *     falsificar: por eso las rutas igual tienen freno).
 */
export function esLlamadaDeCron(req: Request): boolean {
  const secreto = process.env.CRON_SECRET
  if (secreto) return req.headers.get("authorization") === `Bearer ${secreto}`
  return req.headers.has("x-vercel-cron") || /vercel-cron/i.test(req.headers.get("user-agent") || "")
}
