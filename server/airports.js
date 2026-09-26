// Airport search over data/airports.json (built from OurAirports by scripts/build-airports.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

let airports = [];
try {
  airports = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'airports.json'), 'utf8'))
    .map((a) => ({ ...a, _name: fold(a.name), _city: fold(a.city) }));
} catch (err) {
  console.warn(`[airports] data/airports.json missing or unreadable: ${err.message}`);
}

const pub = ({ _name, _city, large, ...a }) => a;

export function findAirport(icao) {
  const hit = airports.find((a) => a.icao === String(icao).toUpperCase());
  return hit ? pub(hit) : null;
}

export function searchAirports(query, limit = 12) {
  const q = fold(query).trim();
  if (q.length < 2) return [];
  const scored = [];
  for (const a of airports) {
    let score;
    if (a.iata === q || a.icao === q) score = 0;
    else if (a._city.startsWith(q) || a._name.startsWith(q)) score = 1;
    else if (a._city.includes(q) || a._name.includes(q)) score = 2;
    else continue;
    scored.push([score - (a.large ? 0.5 : 0), a]);
  }
  return scored.sort((x, y) => x[0] - y[0] || x[1].name.localeCompare(y[1].name)).slice(0, limit).map(([, a]) => pub(a));
}
