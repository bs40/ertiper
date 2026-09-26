import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Installed as a service the settings live outside Program Files (ERTIPER_CONFIG), so they can be saved.
export const CONFIG_FILE = process.env.ERTIPER_CONFIG || path.join(ROOT, 'config.json');

const DEFAULTS = {
  port: 8080,
  timezone: 'Europe/London',
  airport: { icao: 'EGGD', iata: 'BRS', name: 'Bristol Airport', city: 'Bristol', lat: 51.3827, lon: -2.7191 },
  home: null,
  // 'visible' (planes I can see, needs home), 'arrivals', 'departures' or 'all'
  mode: 'visible',
  view: { bearing: 270, width: 120, rangeKm: 12, maxAltFt: 8000 },
  pollSeconds: 5,
  searchRadiusNm: 25,
  focusLingerSeconds: 240,
  aerodatabox: { rapidApiKey: '', refreshMinutes: 30, activeHours: [5, 23] },
  planespotters: { contact: '' },
};

function merge(base, override) {
  if (override === null) return null;
  if (Array.isArray(base) || typeof base !== 'object' || base === null) {
    return override === undefined ? base : override;
  }
  const out = { ...base };
  for (const [key, value] of Object.entries(override ?? {})) {
    out[key] = key in base ? merge(base[key], value) : value;
  }
  return out;
}

// Notepad and PowerShell may save UTF-8 with a byte-order mark, which JSON.parse rejects.
const readJsonFile = (file) => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));

export function loadConfig() {
  const file = CONFIG_FILE;
  let user = {};
  if (fs.existsSync(file)) {
    try {
      user = readJsonFile(file);
    } catch (err) {
      throw new Error(`config.json is not valid JSON: ${err.message}`);
    }
  }
  const config = merge(DEFAULTS, user);
  // Allow the key to come from the environment so it never has to live in a file.
  if (process.env.AERODATABOX_KEY) config.aerodatabox.rapidApiKey = process.env.AERODATABOX_KEY;
  // The installed service fixes its port (matching the IIS forwarding rule in web.config).
  if (process.env.ERTIPER_PORT) config.port = Number(process.env.ERTIPER_PORT);
  else if (process.env.PORT) config.port = Number(process.env.PORT); // containers
  config.version = 1;
  return config;
}

/**
 * Persist settings from the settings page. Only the given top-level keys are rewritten, so anything
 * else in config.json (such as the API key) is left exactly as the user wrote it.
 */
export function saveSettings(config, settings) {
  const file = CONFIG_FILE;
  const raw = fs.existsSync(file) ? readJsonFile(file) : {};
  Object.assign(raw, settings);
  fs.writeFileSync(file, `${JSON.stringify(raw, null, 2)}\n`);
  Object.assign(config, settings);
  config.version += 1;
}
