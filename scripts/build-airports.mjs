// Builds data/airports.json from the OurAirports airports.csv (public domain).
// Usage: node scripts/build-airports.mjs path/to/airports.csv
// Source: https://davidmegginson.github.io/ourairports-data/airports.csv
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = process.argv[2];
if (!input) {
  console.error('Usage: node scripts/build-airports.mjs path/to/airports.csv');
  process.exit(1);
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const [header, ...rows] = parseCsv(fs.readFileSync(input, 'utf8'));
const col = Object.fromEntries(header.map((h, i) => [h, i]));

const airports = rows
  .filter((r) => r.length === header.length)
  .filter((r) => ['large_airport', 'medium_airport'].includes(r[col.type]) && r[col.scheduled_service] === 'yes')
  .map((r) => ({
    icao: r[col.icao_code] || r[col.gps_code] || r[col.ident],
    iata: r[col.iata_code] || null,
    name: r[col.name],
    city: r[col.municipality] || null,
    country: r[col.iso_country],
    lat: Math.round(Number(r[col.latitude_deg]) * 1e5) / 1e5,
    lon: Math.round(Number(r[col.longitude_deg]) * 1e5) / 1e5,
    large: r[col.type] === 'large_airport' || undefined,
  }))
  .filter((a) => /^[A-Z0-9]{4}$/.test(a.icao) && a.iata);

fs.mkdirSync(path.join(root, 'data'), { recursive: true });
fs.writeFileSync(path.join(root, 'data', 'airports.json'), JSON.stringify(airports));
console.log(`Wrote ${airports.length} airports to data/airports.json`);
