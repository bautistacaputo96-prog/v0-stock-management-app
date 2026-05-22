const { Client } = require('pg')
const fs = require('fs')
const path = require('path')

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
const connectionString = "postgres://postgres.ylffbbfffvhlpwrtalsp:9kurBL4qKlXLTcrV@aws-1-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require"

async function main() {
  const sqlFile = path.join(__dirname, '041-create-maintenance-equipment-services.sql')
  const sql = fs.readFileSync(sqlFile, 'utf8')

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } })
  await client.connect()
  console.log('Connected to database')

  try {
    await client.query(sql)
    console.log('Migration executed successfully!')
  } catch (err) {
    console.error('Error executing migration:', err.message)
    process.exit(1)
  } finally {
    await client.end()
  }
}

main()
