process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
const { Client } = require('pg')

const connectionString = "postgres://postgres.ylffbbfffvhlpwrtalsp:9kurBL4qKlXLTcrV@aws-1-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require"

// Mercedes → silke | Pilar → villa_rosa | Ranchos → ranchos
const equipment = [
  // SILKE (Mercedes)
  { plant: 'silke', nombre: 'Yale 25-1',    tipo: 'autoelevador', marca: 'Yale',    modelo: '25',       anio: 2009 },
  { plant: 'silke', nombre: 'Yale 25-2',    tipo: 'autoelevador', marca: 'Yale',    modelo: '25',       anio: 2010 },
  { plant: 'silke', nombre: 'Liangon 25',   tipo: 'autoelevador', marca: 'Liangon', modelo: '25',       anio: 2014 },
  { plant: 'silke', nombre: 'B-lift 25',    tipo: 'autoelevador', marca: 'B-lift',  modelo: '25',       anio: 2023 },
  { plant: 'silke', nombre: 'Toyota 35',    tipo: 'autoelevador', marca: 'Toyota',  modelo: '35',       anio: 2004 },
  { plant: 'silke', nombre: 'Heli 35',      tipo: 'autoelevador', marca: 'Heli',    modelo: '35',       anio: 2021 },
  { plant: 'silke', nombre: 'Heli 50',      tipo: 'autoelevador', marca: 'Heli',    modelo: '50',       anio: 2026 },
  { plant: 'silke', nombre: 'Pala 833',     tipo: 'pala',         marca: null,      modelo: '833',      anio: 2022 },

  // VILLA ROSA (Pilar)
  { plant: 'villa_rosa', nombre: 'Heli 30',        tipo: 'autoelevador', marca: 'Heli',    modelo: '30',       anio: 2017 },
  { plant: 'villa_rosa', nombre: 'Wecam 35',       tipo: 'autoelevador', marca: 'Wecam',   modelo: '35',       anio: 2021 },
  { plant: 'villa_rosa', nombre: 'Lonking 40',     tipo: 'autoelevador', marca: 'Lonking', modelo: '40',       anio: 2025 },
  { plant: 'villa_rosa', nombre: 'Pala JGM738K',   tipo: 'pala',         marca: null,      modelo: 'JGM738K',  anio: 2017 },

  // RANCHOS
  { plant: 'ranchos', nombre: 'Toyota 25',     tipo: 'autoelevador', marca: 'Toyota',  modelo: '25',       anio: 2011 },
  { plant: 'ranchos', nombre: 'Liangon 40',    tipo: 'autoelevador', marca: 'Liangon', modelo: '40',       anio: 2021 },
  { plant: 'ranchos', nombre: 'Lonking 40-1',  tipo: 'autoelevador', marca: 'Lonking', modelo: '40',       anio: 2022 },
  { plant: 'ranchos', nombre: 'Lonking 40-2',  tipo: 'autoelevador', marca: 'Lonking', modelo: '40',       anio: 2025 },
  { plant: 'ranchos', nombre: 'Pala LW300FN',  tipo: 'pala',         marca: null,      modelo: 'LW300FN',  anio: 2016 },
  { plant: 'ranchos', nombre: 'Pala ZL20G',    tipo: 'pala',         marca: null,      modelo: 'ZL20G',    anio: 2014 },
]

async function main() {
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } })
  await client.connect()
  console.log('Conectado a la base de datos\n')

  let inserted = 0
  let programs = 0

  for (const eq of equipment) {
    // Insert equipment
    const res = await client.query(
      `INSERT INTO maintenance_equipment (plant, nombre, tipo, marca, modelo, anio, horometro_actual, status)
       VALUES ($1, $2, $3, $4, $5, $6, 0, 'activo')
       RETURNING id`,
      [eq.plant, eq.nombre, eq.tipo, eq.marca, eq.modelo, eq.anio]
    )
    const id = res.rows[0].id
    inserted++
    console.log(`✓ [${eq.plant.padEnd(9)}] ${eq.tipo.padEnd(14)} → ${eq.nombre}`)

    // Auto-create 250hs service program for autoelevadores
    if (eq.tipo === 'autoelevador') {
      await client.query(
        `INSERT INTO maintenance_service_programs (equipment_id, nombre, intervalo_horas, modo, descripcion)
         VALUES ($1, 'Service 250hs', 250, 'horas', 'Service preventivo estándar cada 250 horas')`,
        [id]
      )
      programs++
    }
  }

  await client.end()

  console.log(`\n✅ ${inserted} equipos cargados`)
  console.log(`✅ ${programs} programas de service 250hs creados (autoelevadores)`)
}

main().catch(err => { console.error('Error:', err.message); process.exit(1) })
