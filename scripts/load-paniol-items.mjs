// Script para cargar todos los items del pañol en Supabase
// Usa la anon key + función RPC o REST API directa

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = 'https://ylffbbfffvhlpwrtalsp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlsZmZiYmZmZnZobHB3cnRhbHNwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgzOTU5ODcsImV4cCI6MjA4Mzk3MTk4N30.B2RzphcYT-3StqUd8S6sJAk-rCnHXBMJqi26t5RZNJk';

// Read the SQL file
const sqlContent = fs.readFileSync(
  path.join(__dirname, 'seed-paniol-items.sql'),
  'utf8'
);

// Split into blocks by category (split on ON CONFLICT DO NOTHING;)
const rawBlocks = sqlContent.split('ON CONFLICT DO NOTHING;');
const blocks = rawBlocks.slice(0, -1).map((b, i) => ({
  index: i,
  sql: b.trim() + ' ON CONFLICT DO NOTHING'
}));

// Extract category name from each block
function getCatName(sql) {
  const m = sql.match(/name='([^']+)' LIMIT/);
  return m ? m[1] : 'block_' + Math.random();
}

// Block 1 is Ropa EPP (index 1) - already loaded, skip it
// Use Supabase REST API to insert - we need to use rpc or direct table insert
// Since anon key may not allow raw SQL, we'll parse the SQL and use REST API

function parseSqlBlock(sql) {
  // Extract VALUES from INSERT statement
  const valuesMatch = sql.match(/VALUES\s*([\s\S]+)/i);
  if (!valuesMatch) return [];

  const valuesStr = valuesMatch[1].trim();
  // Remove trailing ON CONFLICT DO NOTHING
  const cleanValues = valuesStr.replace(/\s*ON CONFLICT DO NOTHING\s*$/i, '').trim();

  // Parse each row: ('silke', (SELECT...'CATNAME'...), 'ITEMNAME', 0, 0)
  const rows = [];
  // Use regex to match each row
  const rowRegex = /\('silke',\s*\(SELECT id FROM maintenance_categories WHERE plant='silke' AND name='([^']+)' LIMIT 1\),\s*'((?:[^'\\]|\\.|\\'|'')*)',\s*0,\s*0\)/g;
  let match;
  while ((match = rowRegex.exec(cleanValues)) !== null) {
    const catName = match[1];
    const itemName = match[2].replace(/''/g, "'");
    rows.push({ catName, itemName });
  }
  return rows;
}

async function getCategoryId(catName) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/maintenance_categories?plant=eq.silke&name=eq.${encodeURIComponent(catName)}&select=id&limit=1`,
    {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) {
    console.error(`Category not found: ${catName}`);
    return null;
  }
  return data[0].id;
}

async function insertItems(items) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/maintenance_inventory`,
    {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=ignore-duplicates,return=minimal'
      },
      body: JSON.stringify(items)
    }
  );
  return res.status;
}

async function main() {
  console.log(`Total blocks: ${blocks.length}`);
  let totalInserted = 0;

  for (const block of blocks) {
    if (block.index === 1) {
      console.log(`Block 1 (Ropa EPP): SKIPPED (already loaded)`);
      continue;
    }

    const catName = getCatName(block.sql);
    console.log(`\nProcessing block ${block.index}: ${catName}`);

    // Get category ID
    const catId = await getCategoryId(catName);
    if (!catId) {
      console.error(`  ERROR: Category ID not found for "${catName}"`);
      continue;
    }
    console.log(`  Category ID: ${catId}`);

    // Parse items
    const rows = parseSqlBlock(block.sql);
    console.log(`  Parsed ${rows.length} items`);

    if (rows.length === 0) {
      console.error(`  WARNING: No items parsed from block`);
      continue;
    }

    // Build insert payload
    const payload = rows.map(r => ({
      plant: 'silke',
      category_id: catId,
      name: r.itemName,
      current_stock: 0,
      minimum_stock: 0
    }));

    // Insert in batches of 100
    const batchSize = 100;
    let inserted = 0;
    for (let i = 0; i < payload.length; i += batchSize) {
      const batch = payload.slice(i, i + batchSize);
      const status = await insertItems(batch);
      if (status === 201 || status === 200 || status === 204) {
        inserted += batch.length;
      } else {
        console.error(`  ERROR: HTTP ${status} on batch ${Math.floor(i/batchSize)+1}`);
      }
    }
    console.log(`  Inserted: ${inserted} / ${payload.length}`);
    totalInserted += inserted;
  }

  console.log(`\n=== DONE: Total items inserted: ${totalInserted} ===`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
