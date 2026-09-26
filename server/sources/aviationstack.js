// Timetable from Aviationstack (free plan: 100 requests/month, non-commercial).
// One refresh = 3 requests: upcoming departures, upcoming arrivals, arrivals already in the air.
//
// Aviationstack quirk: times are the airport's LOCAL wall-clock time but labelled "+00:00", so they
// are re-read in each airport's own time zone (departure.timezone / arrival.timezone).
import { getJson } from '../lib/http.js';
import { zonedTime } from '../lib/time.js';
import { findAirport } from '../airports.js';

export const REQUESTS_PER_REFRESH = 3;

function localTime(value, timeZone) {
  const m = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  if (!timeZone) return Date.parse(value);
  return zonedTime(timeZone, { year: +m[1], month: +m[2], day: +m[3] }, +m[4], +m[5]);
}

function airportFrom(leg) {
  const known = leg?.icao && findAirport(leg.icao);
  if (known) return known;
  return leg ? { iata: leg.iata || null, icao: leg.icao || null, name: leg.airport || null, city: leg.airport || null, lat: null, lon: null } : null;
}

const STATUS = {
  scheduled: () => 'Expected',
  active: (dir) => (dir === 'dep' ? 'Departed' : 'EnRoute'),
  landed: (dir) => (dir === 'dep' ? 'Departed' : 'Arrived'),
  cancelled: () => 'Canceled',
  diverted: () => 'Diverted',
  incident: () => 'Unknown',
};

function normalise(item, direction) {
  const here = direction === 'dep' ? item.departure : item.arrival;
  const there = direction === 'dep' ? item.arrival : item.departure;
  const scheduled = localTime(here?.scheduled, here?.timezone);
  if (!scheduled) return null;
  const revised = localTime(here?.estimated_runway || here?.estimated, here?.timezone);
  let status = (STATUS[item.flight_status] ?? (() => 'Unknown'))(direction);
  if (status === 'Expected' && (here?.delay ?? 0) > 5) status = 'Delayed';
  const airline = item.airline?.name ? { name: item.airline.name, iata: item.airline.iata || null, icao: item.airline.icao || null } : null;
  const icaoCode = item.flight?.icao || (airline?.icao && item.flight?.number ? `${airline.icao}${item.flight.number}` : null);
  return {
    id: `${direction}:${icaoCode || item.flight?.iata}:${scheduled}`,
    direction,
    number: item.flight?.iata ? `${item.airline?.iata ?? ''} ${item.flight.number}`.trim() : icaoCode,
    code: icaoCode || item.flight?.iata || '',
    callsign: null,
    airline,
    other: airportFrom(there),
    scheduled,
    revised,
    runway: localTime(here?.actual_runway || here?.actual, here?.timezone),
    otherScheduled: localTime(there?.scheduled, there?.timezone),
    otherRevised: localTime(there?.estimated_runway || there?.estimated, there?.timezone),
    status,
    aircraft: item.aircraft
      ? { reg: item.aircraft.registration || null, modeS: item.aircraft.icao24?.toLowerCase() || null, model: null }
      : null,
    gate: here?.gate || null,
    terminal: here?.terminal || null,
  };
}

async function query(key, params) {
  const qs = new URLSearchParams({ access_key: key, limit: '100', ...params });
  const data = await getJson(`https://api.aviationstack.com/v1/flights?${qs}`, { timeoutMs: 20000 });
  if (data?.error) throw new Error(`Aviationstack: ${data.error.code ?? ''} ${data.error.message ?? ''}`.trim());
  return (data?.data ?? []).filter((f) => !f.flight?.codeshared);
}

/** Fetch an airport's timetable. Costs REQUESTS_PER_REFRESH requests. */
export async function fetchAviationstack(key, airport) {
  const iata = airport.iata;
  if (!iata) throw new Error('Aviationstack needs an airport with an IATA code');
  const [deps, arrs, enRoute] = await Promise.all([
    query(key, { dep_iata: iata, flight_status: 'scheduled' }),
    query(key, { arr_iata: iata, flight_status: 'scheduled' }),
    query(key, { arr_iata: iata, flight_status: 'active' }),
  ]);
  return [
    ...deps.map((f) => normalise(f, 'dep')),
    ...[...arrs, ...enRoute].map((f) => normalise(f, 'arr')),
  ].filter(Boolean);
}
