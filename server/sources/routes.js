// Origin/destination by callsign, and airline details.
// Primary: adsb.im route set (has a plausibility check). Fallback: adsbdb.
import { getJson, TtlCache } from '../lib/http.js';

const routeCache = new TtlCache(6 * 3600_000);
const airlineCache = new TtlCache(7 * 24 * 3600_000);

const fromRouteset = (a) => a && {
  iata: a.iata || null, icao: a.icao || null, name: a.name || null, city: a.location || null,
  lat: a.lat, lon: a.lon, country: a.countryiso2 || null,
};

const fromAdsbdb = (a) => a && {
  iata: a.iata_code || null, icao: a.icao_code || null, name: a.name || null, city: a.municipality || null,
  lat: a.latitude, lon: a.longitude, country: a.country_iso_name || null,
};

/** Choose the leg that involves our airport from a multi-stop route. */
function pickLeg(airports, airportIcao, climbing) {
  if (airports.length <= 2) return [airports[0], airports.at(-1)];
  const i = airports.findIndex((a) => a.icao === airportIcao);
  if (i === -1) return [airports[0], airports.at(-1)];
  if (i === 0) return [airports[0], airports[1]];
  if (i === airports.length - 1) return [airports[i - 1], airports[i]];
  return climbing ? [airports[i], airports[i + 1]] : [airports[i - 1], airports[i]];
}

async function routesetLookup(callsign, lat, lon) {
  const data = await getJson('https://adsb.im/api/0/routeset', {
    method: 'POST',
    body: { planes: [{ callsign, lat, lng: lon }] },
    timeoutMs: 8000,
  });
  const r = Array.isArray(data) ? data[0] : null;
  if (!r || !r._airports?.length || r.plausible === false) return null;
  return { airports: r._airports.map(fromRouteset), airlineIcao: r.airline_code || null, source: 'adsb.im' };
}

async function adsbdbLookup(callsign) {
  const data = await getJson(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(callsign)}`, { timeoutMs: 8000 });
  const fr = data?.response?.flightroute;
  if (!fr?.origin || !fr?.destination) return null;
  return {
    airports: [fromAdsbdb(fr.origin), fromAdsbdb(fr.destination)],
    airlineIcao: fr.airline?.icao || null,
    airline: fr.airline ? { name: fr.airline.name, icao: fr.airline.icao, iata: fr.airline.iata } : null,
    source: 'adsbdb',
  };
}

export function lookupAirline(icao) {
  if (!icao || !/^[A-Z]{3}$/.test(icao)) return Promise.resolve(null);
  return airlineCache.wrap(icao, async () => {
    const data = await getJson(`https://api.adsbdb.com/v0/airline/${icao}`, { timeoutMs: 8000 });
    const a = Array.isArray(data?.response) ? data.response[0] : data?.response;
    return a?.name ? { name: a.name, icao: a.icao || icao, iata: a.iata || null } : null;
  });
}

/**
 * Route for a callsign as { origin, destination, airline, source } or null.
 * `airportIcao` and `climbing` help pick the right leg of multi-stop routes.
 */
export function lookupRoute(callsign, { lat, lon, airportIcao, climbing } = {}) {
  if (!callsign) return Promise.resolve(null);
  return routeCache.wrap(`${callsign}|${climbing ? 'c' : 'd'}`, async () => {
    let raw = null;
    try {
      raw = await routesetLookup(callsign, lat, lon);
    } catch (err) {
      console.warn(`[route adsb.im] ${err.message}`);
    }
    if (!raw) raw = await adsbdbLookup(callsign);
    if (!raw) return null;
    const [origin, destination] = pickLeg(raw.airports, airportIcao, climbing);
    const airline = raw.airline ?? (await lookupAirline(raw.airlineIcao).catch(() => null));
    return { origin, destination, airline, source: raw.source };
  });
}
