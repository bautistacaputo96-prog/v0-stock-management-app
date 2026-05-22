const XLSX = require('xlsx');
const path = require('path');

const filePath = path.join('C:', 'Users', 'Hugo', 'Downloads', 'planilla_mantenimiento_autoelevadores.xlsx');

const wb = XLSX.readFile(filePath);
console.log('Sheets:', wb.SheetNames);
wb.SheetNames.forEach(name => {
  const ws = wb.Sheets[name];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  console.log('\n=== Sheet:', name, '===');
  data.slice(0, 50).forEach((row, i) => {
    if (row.some(c => c !== '')) console.log(i, JSON.stringify(row));
  });
});
