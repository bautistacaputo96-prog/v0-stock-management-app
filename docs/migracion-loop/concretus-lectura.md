# Concretus: lectura propia de Rebucret (fase 0c-2, 24/11/2026)

Concretus (repo `v0-plant-production-control`) lee hoy la base de Rebucret con la **clave pública**, desde su
servidor. Cuando se corra la migración de RLS (`202611241900_seguridad_rls.sql`), la clave pública **no ve nada** y el
WhatsApp diario saldría vacío. Por eso Concretus pasa a pedirle los datos a Rebucret por una ruta propia, con secreto.

**Este cambio en Concretus tiene que estar publicado ANTES de correr la migración de RLS** (paso 4 del orden de
publicación en `fase-0c.md`).

## Qué lee hoy Concretus

| Archivo de Concretus | Qué lee | Para qué |
|---|---|---|
| `lib/rebucret.ts` → `getYesterdayDispatches()` | `dispatches` (m³, cliente, obra, fórmula, fecha; sin pruebas) + nombres de `clients`, `construction_sites`, `formulas` | "Producción de ayer" del WhatsApp |
| `lib/rebucret.ts` → `getTodaySchedule()` | `scheduled_dispatches` (m³, hora, urgente, estado, cliente, obra, fórmula; sin cancelados) + los mismos nombres | "Programación de hoy" del WhatsApp |
| `app/api/remito/[id]/route.ts` | **todo** el pedido o despacho, el cliente (CUIT, domicilio fiscal, condición de IVA), la obra, la fórmula y el camión | Una copia vieja del remito de Rebucret. **Está abierta** (cualquiera con un id ve los datos fiscales). |

## La ruta nueva (en Rebucret)

```
GET https://www.produccionrebucret.com/api/concretus/lectura?tipo=despachos&desde=2026-11-23T03:00:00Z&hasta=2026-11-24T03:00:00Z
GET https://www.produccionrebucret.com/api/concretus/lectura?tipo=programacion&desde=2026-11-24T03:00:00Z&hasta=2026-11-25T03:00:00Z
Authorization: Bearer <secreto>
```

- **Secreto:** el mismo que usa `/api/reparto/resumen`. En Rebucret se llama `REPARTO_RESUMEN_SECRET`; en Concretus,
  `REBUCRET_RESUMEN_SECRET`. Si todavía no existe en alguno de los dos Vercel, Bautista genera uno
  (`openssl rand -base64 32` en su terminal) y lo carga con ese nombre en los dos (Production). Nunca en el chat.
- Rango máximo: 3 días. Fechas ISO con zona.
- Respuesta: `{ tipo, desde, hasta, filas: [...] }`. Cada fila trae las mismas columnas que Concretus pedía antes
  **más** `cliente`, `obra` y `formula` (nombres; `null` si no tiene):
  - despachos: `quantity_m3, client_id, construction_site_id, formula_id, dispatch_date, is_test_dispatch, cliente, obra, formula` (ya sin los de prueba);
  - programación: `quantity_m3, scheduled_arrival_time, is_urgent, status, client_id, construction_site_id, formula_id, cliente, obra, formula` (ya sin los cancelados, ordenados por hora).
- No devuelve CUIT, domicilios ni precios. No escribe nada.

## Cambio exacto en Concretus

### 1. `lib/rebucret.ts`

Agregar arriba (debajo de `rebucretFetch`):

```ts
const REBUCRET_SITE = () => process.env.REBUCRET_SITE_URL || "https://www.produccionrebucret.com"

/** Lectura propia de Rebucret (fase 0c-2 de Rebucret): con el secreto de Concretus, sin la clave pública. */
async function rebucretLectura(tipo: "despachos" | "programacion", desde: string, hasta: string): Promise<any[]> {
  const secreto = process.env.REBUCRET_RESUMEN_SECRET
  if (!secreto) throw new Error("Falta REBUCRET_RESUMEN_SECRET")
  const url = `${REBUCRET_SITE()}/api/concretus/lectura?tipo=${tipo}&desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${secreto}` }, cache: "no-store" })
  if (!res.ok) throw new Error(`Rebucret lectura error: ${res.status}`)
  const d = await res.json()
  return Array.isArray(d?.filas) ? d.filas : []
}
```

En `getYesterdayDispatches()`, reemplazar el `Promise.all([...])` y los nombres por:

```ts
  const dispatches = await rebucretLectura("despachos", `${dateStr}T03:00:00Z`, `${nextDateStr}T03:00:00Z`)

  const groups: Record<string, DispatchSummary> = {}
  for (const d of dispatches as any[]) {
    const clientName = d.cliente || "Sin cliente"
    const obraName = d.obra || "Sin obra"
    const formulaName = d.formula || "Sin tipo"
    // … (el resto igual)
```

En `getTodaySchedule()`, igual:

```ts
  const scheduled = await rebucretLectura("programacion", `${todayStr}T03:00:00Z`, `${tomorrowStr}T03:00:00Z`)

  const groups: Record<string, ScheduledSummary> = {}
  for (const d of scheduled as any[]) {
    const clientName = d.cliente || "Sin cliente"
    const obraName = d.obra || "Sin obra"
    const formulaName = d.formula || "Sin tipo"
    // … (el resto igual)
```

Después se pueden borrar `getClients`, `getConstructionSites`, `getFormulas` y `rebucretFetch` si nadie más los usa
(buscar `rebucretFetch` en el repo).

### 2. `app/api/remito/[id]/route.ts` de Concretus

**Borrarlo.** Es una copia vieja del remito de Rebucret, abierta, que con la RLS deja de andar (devolvería "Despacho
no encontrado" siempre). El remito vive en Rebucret (`/api/remito/[id]`, ahora con sesión). Antes de borrarlo,
buscar en Concretus si algo lo llama (`/api/remito/`); hoy no se encontró ninguna pantalla que lo use.

### 3. Variables de Concretus

- Se suma (si no estaba): `REBUCRET_RESUMEN_SECRET` (y opcional `REBUCRET_SITE_URL`).
- `REBUCRET_SUPABASE_URL` y `REBUCRET_SUPABASE_ANON_KEY` dejan de hacer falta cuando no quede ningún `rebucretFetch`.
  Conviene borrarlas de Vercel de Concretus después de la migración de RLS (ya no sirven para nada).

## Cómo se controla

1. Con el cambio de Concretus publicado y **antes** de la RLS: que el WhatsApp del día siguiente llegue igual (mismos
   m³ y viajes que la pantalla de Rebucret).
2. Después de la RLS: que siga llegando. Si llega vacío, revisar en los logs de Vercel de Concretus
   "Rebucret lectura error: 401" (secreto distinto en los dos lados).
