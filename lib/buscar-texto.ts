/**
 * Búsqueda tolerante para listas cortas (fórmulas del pedido): sin mayúsculas, tildes, guiones, espacios ni paréntesis,
 * por partes y en cualquier orden. "h21 620", "h21-620-10", "620 10 c" y "h2162010" encuentran "H21-620-10 C (CAN)".
 * Sin imports: se prueba con node --test.
 */
const plano = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()

export function coincideBusqueda(consulta: string, ...textos: unknown[]): boolean {
  const q = plano(consulta)
  if (!q) return true
  const texto = plano(textos.join(" "))
  const junto = texto.replace(/ /g, "")
  const tokens = q.split(" ")
  if (tokens.every((t) => texto.includes(t) || junto.includes(t))) return true
  return junto.includes(q.replace(/ /g, ""))
}
