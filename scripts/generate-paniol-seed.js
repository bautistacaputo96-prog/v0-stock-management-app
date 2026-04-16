const X = require('../node_modules/xlsx');
const fs = require('fs');
const wb = X.readFile('C:/Users/Hugo/Downloads/Hoja de c\u00e1lculo sin t\u00edtulo (2).xlsx');
const sheet = wb.Sheets['Validaciones'];
const rows = X.utils.sheet_to_json(sheet, {header:1});

const headers = rows[0];
const categories = [];
for (let i = 0; i < headers.length; i += 2) {
  if (headers[i]) categories.push({ idx: i, name: String(headers[i]) });
}

const catItems = {};
categories.forEach(c => { catItems[c.name] = []; });
for (let r = 1; r < rows.length; r++) {
  const row = rows[r];
  categories.forEach(c => {
    const val = row[c.idx];
    if (val && String(val).trim()) catItems[c.name].push(String(val).trim());
  });
}

const esc = s => s.replace(/'/g, "''");

let sql = '-- Seed inventario panel desde Excel\n-- ' + new Date().toISOString() + '\n\n';
sql += '-- 1. Insertar categorias del Excel\n';

const catInserts = categories.map(c => {
  const display = c.name.replace(/_/g, ' ').trim();
  return "  ('silke', '" + esc(display) + "', '" + esc(display) + "')";
});
sql += 'INSERT INTO maintenance_categories (plant, name, description) VALUES\n';
sql += catInserts.join(',\n') + '\nON CONFLICT DO NOTHING;\n\n';

sql += '-- 2. Insertar items de inventario\n';
sql += 'DO $$\nDECLARE\n  cat_id INTEGER;\nBEGIN\n';

categories.forEach(c => {
  const display = c.name.replace(/_/g, ' ').trim();
  const items = catItems[c.name];
  if (!items.length) return;
  sql += "  SELECT id INTO cat_id FROM maintenance_categories WHERE plant='silke' AND name='" + esc(display) + "' LIMIT 1;\n";
  items.forEach(item => {
    sql += "  INSERT INTO maintenance_inventory (plant, category_id, name, current_stock, minimum_stock) VALUES ('silke', cat_id, '" + esc(item) + "', 0, 0) ON CONFLICT DO NOTHING;\n";
  });
  sql += '\n';
});

sql += 'END $$;\n';

fs.writeFileSync('./scripts/seed-paniol-inventory.sql', sql);
console.log('SQL generado OK');
console.log('Total items:', Object.values(catItems).reduce(function(a,b){ return a+b.length; }, 0));
