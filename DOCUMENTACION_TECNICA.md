# Documentacion Tecnica - Sistema de Gestion de Planta de Hormigon

## Resumen del Proyecto

Sistema web de gestion integral para plantas de hormigon elaborado, desarrollado con Next.js 16 y Supabase como backend.

---

## Stack Tecnologico

| Tecnologia | Version | Uso |
|------------|---------|-----|
| **Next.js** | 16 | Framework React con App Router |
| **React** | 19 | Libreria de UI |
| **TypeScript** | 5.x | Tipado estatico |
| **Tailwind CSS** | 4.x | Estilos utilitarios |
| **shadcn/ui** | Latest | Componentes de UI |
| **Supabase** | Latest | Base de datos PostgreSQL + Auth |
| **Recharts** | 2.x | Graficos y visualizaciones |
| **date-fns** | 3.x | Manejo de fechas |

---

## Estructura del Proyecto

\`\`\`
/
├── app/                          # Rutas de Next.js (App Router)
│   ├── page.tsx                  # Dashboard principal
│   ├── layout.tsx                # Layout global
│   ├── calidad/                  # Modulo de control de calidad
│   ├── camiones/                 # Gestion de camiones/mixers
│   ├── clientes/                 # Gestion de clientes y obras
│   ├── formulas/                 # Formulas de hormigon
│   ├── historial-despachos/      # Historial de despachos
│   ├── informes/                 # Reportes y documentos
│   ├── materias-primas/          # Stock e ingresos de materiales
│   ├── plantista/                # Vista operativa del plantista
│   └── programacion/             # Programacion de despachos
│
├── components/                   # Componentes React
│   ├── ui/                       # Componentes base (shadcn/ui)
│   ├── add-*.tsx                 # Dialogos para agregar entidades
│   ├── edit-*.tsx                # Dialogos para editar entidades
│   ├── view-*.tsx                # Dialogos para ver detalles
│   ├── *-table.tsx               # Tablas de datos
│   ├── *-management.tsx          # Componentes de gestion
│   └── *-dialog.tsx              # Dialogos varios
│
├── lib/
│   ├── supabase/
│   │   ├── client.ts             # Cliente Supabase (browser)
│   │   └── server.ts             # Cliente Supabase (server)
│   └── utils.ts                  # Utilidades (cn function)
│
├── hooks/                        # Custom hooks
│   ├── use-mobile.ts
│   └── use-toast.ts
│
└── scripts/                      # Scripts SQL de migracion
    ├── 001_create_tables.sql     # Creacion inicial de tablas
    ├── 002_seed_initial_data.sql # Datos semilla
    └── *.sql                     # Migraciones adicionales
\`\`\`

---

## Modulos Funcionales

### 1. Dashboard (`/`)
- Resumen de despachos del dia
- Graficos de evolucion (m3 despachados)
- Alertas de stock bajo
- Metricas principales por planta

### 2. Despacho Diario - Plantista (`/plantista`)
- Vista operativa para el operador de planta
- Registro rapido de despachos
- Control de humedad diaria de acopios
- Calculo automatico de materiales por formula

### 3. Programacion (`/programacion`)
- Programacion de despachos futuros
- Calendario de entregas
- Asignacion de camiones
- Estados: pendiente, en_camino, cargando, entregado, cancelado

### 4. Formulas (`/formulas`)
- Definicion de formulas de hormigon
- Composicion de materiales por m3
- Codigo y nombre de formula
- Vida util en minutos

### 5. Materias Primas (`/materias-primas`)
**Tab Evolucion Stock:**
- Grafico interactivo con evolucion del stock de cada material
- Selector de material y periodo (7, 30, 90 dias)
- Estadisticas: stock actual, total ingresos, total consumo, variacion
- Grafico combinado: area de stock + barras de ingresos/consumo
- Tabla de movimientos diarios

**Tab Ingresos:**
- Registro de ingresos de materiales
- Control de humedad en recepcion
- Toma de muestras para granulometria

**Tab Excedentes de Humedad:**
- Calculo de exceso de humedad por ingreso

### 7. Calidad (`/calidad`)
- Ensayos de granulometria
- Rotura de probetas de hormigon
- Calibracion de prensa
- Curvas granulometricas

### 8. Clientes (`/clientes`)
- Gestion de clientes
- Obras/construcciones por cliente
- Tiempos de viaje y descarga

### 9. Camiones (`/camiones`)
- Flota de camiones mixer
- Capacidad y estado
- Patentes y modelos

### 10. Historial (`/historial-despachos`)
- Consulta de despachos historicos
- Filtros por fecha, cliente, obra
- Graficos de m3 por dia

### 11. Informes (`/informes`)
- Reporte de produccion
- Informe de rotura de probetas

---

## Esquema de Base de Datos

### Tablas Principales

#### `plants`
Plantas de hormigon (multi-planta)
- `id` (uuid, PK)
- `name`, `code`

#### `materials`
Materiales (arena, cemento, piedra, etc.)
- `id` (uuid, PK)
- `plant_id` (FK -> plants)
- `name`, `unit`
- `current_stock`, `dry_stock`, `min_stock`
- `stockpile_humidity` - humedad actual del acopio
- `bulk_density` - densidad aparente
- `requires_humidity_control` - si requiere control de humedad

#### `formulas`
Formulas/recetas de hormigon
- `id` (uuid, PK)
- `plant_id` (FK -> plants)
- `code`, `name`, `description`
- `yield_m3` - rendimiento en m3
- `useful_life_minutes` - vida util

#### `formula_materials`
Composicion de formulas (relacion N:N)
- `formula_id` (FK -> formulas)
- `material_id` (FK -> materials)
- `quantity` - cantidad por m3

#### `clients`
Clientes
- `id` (uuid, PK)
- `plant_id` (FK -> plants)
- `name`, `cuit`, `contact`, `phone`, `email`

#### `construction_sites`
Obras/construcciones
- `id` (uuid, PK)
- `client_id` (FK -> clients)
- `name`, `address`
- `travel_time_minutes` - tiempo de viaje desde planta
- `unload_time_minutes` - tiempo de descarga
- `requires_pump` - si requiere bomba

#### `mixers`
Camiones mixer
- `id` (uuid, PK)
- `plant_id` (FK -> plants)
- `license_plate`, `brand`, `model`
- `capacity_m3`
- `status` - disponible, en_viaje, mantenimiento

#### `suppliers`
Proveedores de materiales
- `id` (uuid, PK)
- `name`, `contact`, `phone`

#### `stock_entries`
Ingresos de materiales
- `id` (uuid, PK)
- `material_id` (FK -> materials)
- `supplier_id` (FK -> suppliers)
- `entry_date`, `remito`
- `quantity`, `dry_quantity`, `original_quantity`
- `humidity_percentage`
- `sample_taken_granulometry`
- `granulometry_test_id` (FK -> granulometria_tests)

#### `dispatches`
Despachos realizados (manuales)
- `id` (uuid, PK)
- `formula_id` (FK -> formulas)
- `client_id` (FK -> clients)
- `construction_site_id` (FK -> construction_sites)
- `mixer_id` (FK -> mixers)
- `quantity_m3`, `dispatch_date`
- `remito`, `sample_taken`, `sample_number`
- `created_by` - quien registro el despacho

#### `scheduled_dispatches`
Despachos programados
- `id` (uuid, PK)
- `plant_id` (FK -> plants)
- `client_id`, `construction_site_id`, `formula_id`, `mixer_id`
- `quantity_m3`
- `scheduled_departure_time`, `scheduled_arrival_time`
- `actual_departure_time`, `actual_arrival_time`
- `status` - pending, loading, in_transit, delivered, cancelled
- `created_by` - quien programo

#### `dispatch_materials`
Materiales usados por despacho
- `dispatch_id` (FK -> dispatches)
- `material_id` (FK -> materials)
- `quantity`, `dry_quantity`, `wet_quantity`
- `humidity_at_dispatch`

#### `granulometria_tests`
Ensayos de granulometria
- `id` (uuid, PK)
- `material_id`, `supplier_id`, `plant_id`
- `remito`, `extraction_date`
- `sample_weight_grams`, `dry_weight_grams`
- `fineness_modulus` - modulo de finura calculado
- `aggregate_type` - tipo de agregado

#### `granulometria_sieve_results`
Resultados por tamiz
- `test_id` (FK -> granulometria_tests)
- `sieve_size` - tamano del tamiz (3/8", #4, #8, etc.)
- `retained_grams`, `percent_passing`, etc.

#### `test_cylinders`
Probetas de hormigon
- `dispatch_id` (FK -> dispatches)
- `cylinder_number`, `test_age_days`
- `scheduled_test_date`, `actual_test_date`
- `weight_grams`, `dial_reading`
- `strength_mpa` - resistencia calculada

#### `daily_stockpile_humidity`
Registro diario de humedad de acopios
- `plant_id`, `material_id`
- `reading_date`
- `humidity_percent`
- `wet_weight_grams`, `dry_weight_grams`

#### `app_users`
Usuarios del sistema (operadores)
- `id` (uuid, PK)
- `name`
- `active`

---

## Variables de Entorno

\`\`\`env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# PostgreSQL (generadas automaticamente por Supabase)
POSTGRES_URL=postgres://...
POSTGRES_HOST=...
POSTGRES_USER=...
POSTGRES_PASSWORD=...
POSTGRES_DATABASE=...
\`\`\`

---

## Conexion a Supabase

### Cliente (Browser)
\`\`\`typescript
// lib/supabase/client.ts
import { createBrowserClient } from "@supabase/ssr"

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
\`\`\`

### Servidor (Server Components / Route Handlers)
\`\`\`typescript
// lib/supabase/server.ts
import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        },
      },
    }
  )
}
\`\`\`

---

## Flujos Principales

### 1. Registro de Despacho (Plantista)
1. Usuario selecciona formula, cliente, obra, camion
2. Sistema calcula materiales necesarios segun formula
3. Sistema ajusta por humedad actual del acopio
4. Se descuenta stock de materiales
5. Se registra despacho con todos los materiales usados

### 2. Ingreso de Material
1. Se registra remito, proveedor, cantidad
2. Se ingresa humedad del material
3. Sistema calcula cantidad seca
4. Se actualiza stock (humedo y seco)
5. Opcionalmente se toma muestra para granulometria

### 3. Control de Humedad Diario
1. Al iniciar el dia, sistema solicita humedad de acopios
2. Usuario ingresa peso humedo y seco (o humedad directa)
3. Sistema actualiza humedad en materiales
4. Despachos del dia usan esta humedad para calculos

### 4. Ensayo de Granulometria
1. Se crea ensayo asociado a un remito/ingreso
2. Se ingresan pesos retenidos por cada tamiz
3. Sistema calcula % retenido, % acumulado, % pasa
4. Sistema calcula modulo de finura
5. Se genera curva granulometrica

---

## Comandos de Instalacion

\`\`\`bash
# Clonar e instalar dependencias
git clone <repo>
cd <proyecto>
npm install

# Configurar variables de entorno
cp .env.example .env.local
# Editar .env.local con credenciales de Supabase

# Ejecutar migraciones (en Supabase SQL Editor)
# Ejecutar scripts en orden: 001_create_tables.sql, 002_seed_initial_data.sql, etc.

# Iniciar desarrollo
npm run dev
\`\`\`

---

## Notas Importantes

1. **Zona Horaria**: El sistema esta configurado para Argentina (UTC-3). Las fechas se guardan con timezone `-03:00`.

2. **Multi-planta**: Todas las entidades principales tienen `plant_id` para soportar multiples plantas.

3. **Stock Dual**: Los materiales manejan `current_stock` (humedo) y `dry_stock` (seco) para control preciso.

4. **Sin Autenticacion**: Actualmente no hay sistema de login. Los usuarios se seleccionan manualmente (app_users).

5. **Calculo de Materiales**: Las formulas definen cantidades secas. El sistema ajusta por humedad al despachar.

---

## Contacto

Proyecto desarrollado con v0.dev (Vercel AI)
