// Airport departures/arrivals: Aviationstack and/or AeroDataBox when keys are configured,
// otherwise (Bristol only) a realistic sample timetable so the board can be built and tested.
import { getJson } from '../lib/http.js';
import { distanceKm } from '../lib/geo.js';
import { zonedParts, zonedTime } from '../lib/time.js';
import { fetchAviationstack, REQUESTS_PER_REFRESH as AVIATIONSTACK_COST } from './aviationstack.js';

const MIN = 60_000;
const DONE_STATUSES = new Set(['Departed', 'Arrived', 'Canceled', 'CanceledUncertain', 'Diverted']);

const parseTime = (t) => (t?.utc ? Date.parse(t.utc.replace(' ', 'T')) : null);

function adbAirport(a) {
  if (!a) return null;
  return {
    iata: a.iata || null, icao: a.icao || null, name: a.name || null,
    city: a.municipalityName || a.shortName || a.name || null,
    lat: a.location?.lat ?? null, lon: a.location?.lon ?? null,
  };
}

function flightCode(number, airline) {
  const [prefix, digits] = String(number || '').split(/\s+/);
  if (!digits) return (number || '').replace(/\s+/g, '');
  return `${airline?.icao || prefix}${digits}`;
}

function normaliseAdb(item, direction) {
  // withLeg=true gives departure/arrival objects; otherwise a single "movement".
  const here = item.movement ?? (direction === 'dep' ? item.departure : item.arrival);
  const there = item.movement ? null : direction === 'dep' ? item.arrival : item.departure;
  const other = adbAirport(item.movement ? item.movement.airport : there?.airport);
  const airline = item.airline ? { name: item.airline.name, iata: item.airline.iata || null, icao: item.airline.icao || null } : null;
  return {
    id: `${direction}:${item.number}:${here?.scheduledTime?.utc}`,
    direction,
    number: item.number,
    code: flightCode(item.number, airline),
    callsign: item.callSign ? item.callSign.replace(/\s+/g, '') : null,
    airline,
    other,
    scheduled: parseTime(here?.scheduledTime),
    revised: parseTime(here?.revisedTime) ?? parseTime(here?.predictedTime),
    runway: parseTime(here?.runwayTime),
    otherScheduled: parseTime(there?.scheduledTime),
    otherRevised: parseTime(there?.revisedTime) ?? parseTime(there?.predictedTime),
    status: item.status || 'Unknown',
    aircraft: item.aircraft ? { reg: item.aircraft.reg || null, modeS: item.aircraft.modeS?.toLowerCase() || null, model: item.aircraft.model || null } : null,
    gate: here?.gate || null,
    terminal: here?.terminal || null,
  };
}

// ---------------------------------------------------------------------------
// Sample timetable (used until an AeroDataBox key is added)

const AIRLINES = {
  EZY: { name: 'easyJet', iata: 'U2', icao: 'EZY' },
  RYR: { name: 'Ryanair', iata: 'FR', icao: 'RYR' },
  TOM: { name: 'TUI Airways', iata: 'BY', icao: 'TOM' },
  KLM: { name: 'KLM', iata: 'KL', icao: 'KLM' },
  EIN: { name: 'Aer Lingus', iata: 'EI', icao: 'EIN' },
};

const AIRPORTS = {
  AMS: ['EHAM', 'Amsterdam Schiphol', 'Amsterdam', 52.3086, 4.7639],
  FAO: ['LPFR', 'Faro', 'Faro', 37.0144, -7.9659],
  DUB: ['EIDW', 'Dublin', 'Dublin', 53.4213, -6.2701],
  EDI: ['EGPH', 'Edinburgh', 'Edinburgh', 55.95, -3.3725],
  TFS: ['GCTS', 'Tenerife South', 'Tenerife', 28.0445, -16.5725],
  PMI: ['LEPA', 'Palma de Mallorca', 'Palma de Mallorca', 39.5517, 2.7388],
  GVA: ['LSGG', 'Geneva', 'Geneva', 46.2381, 6.109],
  AGP: ['LEMG', 'Malaga', 'Málaga', 36.6749, -4.4991],
  BCN: ['LEBL', 'Barcelona El Prat', 'Barcelona', 41.2971, 2.0785],
  KRK: ['EPKK', 'Kraków John Paul II', 'Kraków', 50.0777, 19.7848],
  ACE: ['GCRR', 'Lanzarote', 'Arrecife', 28.9455, -13.6052],
  BFS: ['EGAA', 'Belfast International', 'Belfast', 54.6575, -6.2158],
  LPA: ['GCLP', 'Gran Canaria', 'Las Palmas', 27.9319, -15.3866],
  ALC: ['LEAL', 'Alicante', 'Alicante', 38.2822, -0.5582],
  FNC: ['LPMA', 'Madeira', 'Funchal', 32.6979, -16.7745],
  GLA: ['EGPF', 'Glasgow', 'Glasgow', 55.8719, -4.4331],
  NCE: ['LFMN', "Nice Côte d'Azur", 'Nice', 43.6584, 7.2159],
  LIS: ['LPPT', 'Lisbon Humberto Delgado', 'Lisbon', 38.7813, -9.1359],
  DLM: ['LTBS', 'Dalaman', 'Dalaman', 36.7131, 28.7925],
  RAK: ['GMMX', 'Marrakesh Menara', 'Marrakesh', 31.6069, -8.0363],
};

// [local time, airline, flight digits, destination, aircraft type, registration]
const SAMPLE_DEPARTURES = [
  ['06:00', 'EZY', '6401', 'FAO', 'Airbus A320neo', 'G-UZHF'],
  ['06:10', 'RYR', '8723', 'DUB', 'Boeing 737-800', 'EI-DYX'],
  ['06:25', 'EZY', '6001', 'EDI', 'Airbus A319', 'G-EZBI'],
  ['06:40', 'TOM', '6224', 'TFS', 'Boeing 737 MAX 8', 'G-TUMF'],
  ['06:55', 'EZY', '6205', 'PMI', 'Airbus A320', 'G-EZWX'],
  ['07:10', 'KLM', '1050', 'AMS', 'Embraer 190', 'PH-EZX'],
  ['07:30', 'EZY', '6093', 'GVA', 'Airbus A320', 'G-EZOT'],
  ['07:45', 'EIN', '3281', 'DUB', 'ATR 72-600', 'EI-FSK'],
  ['08:20', 'EZY', '6187', 'AGP', 'Airbus A321neo', 'G-UZMA'],
  ['09:05', 'EZY', '6135', 'BCN', 'Airbus A320', 'G-EZUR'],
  ['09:40', 'RYR', '5212', 'KRK', 'Boeing 737-800', 'EI-EBR'],
  ['10:15', 'EZY', '6027', 'ACE', 'Airbus A320', 'G-EZTK'],
  ['11:00', 'EZY', '6043', 'BFS', 'Airbus A319', 'G-EZIV'],
  ['11:45', 'TOM', '6230', 'LPA', 'Boeing 737-800', 'G-TAWI'],
  ['12:30', 'EZY', '6075', 'ALC', 'Airbus A320neo', 'G-UZHC'],
  ['13:15', 'KLM', '1054', 'AMS', 'Embraer 195', 'PH-EZI'],
  ['14:00', 'EZY', '6311', 'FNC', 'Airbus A320', 'G-EZPD'],
  ['14:50', 'EZY', '6009', 'GLA', 'Airbus A319', 'G-EZAT'],
  ['15:35', 'EZY', '6161', 'NCE', 'Airbus A320', 'G-EZOA'],
  ['16:20', 'RYR', '8725', 'DUB', 'Boeing 737 MAX 8', 'EI-HEA'],
  ['17:05', 'EZY', '6147', 'LIS', 'Airbus A320neo', 'G-UZHN'],
  ['17:45', 'EZY', '6017', 'AMS', 'Airbus A320', 'G-EZTJ'],
  ['18:30', 'EZY', '6211', 'PMI', 'Airbus A321neo', 'G-UZMB'],
  ['19:15', 'EZY', '6103', 'DLM', 'Airbus A321neo', 'G-UZMC'],
  ['20:05', 'KLM', '1058', 'AMS', 'Embraer 190', 'PH-EZY'],
  ['20:50', 'EZY', '6003', 'EDI', 'Airbus A319', 'G-EZBZ'],
  ['21:40', 'EZY', '6285', 'RAK', 'Airbus A320', 'G-EZWA'],
];

function sampleAirport(iata) {
  const [icao, name, city, lat, lon] = AIRPORTS[iata];
  return { iata, icao, name, city, lat, lon };
}

function sampleDelay(code) {
  const h = [...code].reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) >>> 0, 7);
  if (h % 7 === 0) return 25 * MIN;
  if (h % 5 === 0) return 10 * MIN;
  return 0;
}

function buildSample(timeZone, home) {
  const day = zonedParts(timeZone);
  const flights = [];
  for (const [time, al, digits, dest, model, reg] of SAMPLE_DEPARTURES) {
    const [hh, mm] = time.split(':').map(Number);
    const airline = AIRLINES[al];
    const other = sampleAirport(dest);
    const blockMs = (distanceKm(home, other) / 796) * 3600_000 + 25 * MIN;
    const dep = zonedTime(timeZone, day, hh, mm);
    const code = `${al}${digits}`;
    const delay = sampleDelay(code);
    flights.push({
      id: `dep:${code}`, direction: 'dep', number: `${airline.iata} ${digits}`, code, callsign: code, airline, other,
      scheduled: dep, revised: dep + delay, runway: null,
      otherScheduled: dep + blockMs, otherRevised: dep + delay + blockMs,
      aircraft: { reg, modeS: null, model }, sample: true,
    });
    // The same aircraft's return flight, one number higher.
    const retDigits = String(Number(digits) + 1).padStart(digits.length, '0');
    const retCode = `${al}${retDigits}`;
    const retDep = dep + blockMs + 50 * MIN;
    const arr = retDep + blockMs;
    if (zonedParts(timeZone, new Date(arr)).day !== day.day) continue;
    const retDelay = sampleDelay(retCode);
    flights.push({
      id: `arr:${retCode}`, direction: 'arr', number: `${airline.iata} ${retDigits}`, code: retCode, callsign: retCode, airline, other,
      scheduled: arr, revised: arr + retDelay, runway: null,
      otherScheduled: retDep, otherRevised: retDep + retDelay,
      aircraft: { reg, modeS: null, model }, sample: true,
    });
  }
  return flights;
}

/** Sample statuses move on with the clock so the board behaves like the real thing. */
function sampleStatus(f, now) {
  const t = f.revised ?? f.scheduled;
  if (f.direction === 'dep') {
    if (now > t + 2 * MIN) return 'Departed';
    if (now > t - 10 * MIN) return 'GateClosed';
    if (now > t - 35 * MIN) return 'Boarding';
    if (now > t - 120 * MIN) return 'CheckIn';
    return f.revised > f.scheduled + 5 * MIN ? 'Delayed' : 'Expected';
  }
  if (now > t) return 'Arrived';
  if (now > t - 20 * MIN) return 'Approaching';
  if (now > f.otherRevised) return 'EnRoute';
  return f.revised > f.scheduled + 5 * MIN ? 'Delayed' : 'Expected';
}

// ---------------------------------------------------------------------------
// Timetable service: one Schedule per airport, shared by every board showing that airport.
// Providers in order of preference: Aviationstack, AeroDataBox, then the Bristol sample (only when
// no keys are configured). Monthly request caps are counted in the shared store, so a restart or
// more users can never overspend.

const PERIOD = () => new Date().toISOString().slice(0, 7); // YYYY-MM (UTC)

const PROVIDERS = {
  aviationstack: {
    label: 'Aviationstack',
    cost: AVIATIONSTACK_COST,
    fetch: (key, airport) => fetchAviationstack(key, airport),
  },
  aerodatabox: {
    label: 'AeroDataBox',
    cost: 2,
    fetch: async (key, airport) => {
      const url = `https://aerodatabox.p.rapidapi.com/flights/airports/icao/${airport.icao}` +
        '?offsetMinutes=-120&durationMinutes=720&withLeg=true&direction=Both&withCancelled=true' +
        '&withCodeshared=false&withCargo=false&withPrivate=false&withLocation=true';
      const data = await getJson(url, {
        headers: { 'x-rapidapi-key': key, 'x-rapidapi-host': 'aerodatabox.p.rapidapi.com' },
        timeoutMs: 20000,
      });
      const deps = (data?.departures ?? []).map((f) => normaliseAdb(f, 'dep'));
      const arrs = (data?.arrivals ?? []).map((f) => normaliseAdb(f, 'arr'));
      return [...deps, ...arrs].filter((f) => f.scheduled);
    },
  },
};

export class TimetableService {
  /**
   * @param {object} opts
   * @param {string} opts.timezone
   * @param {object} opts.store       memoryStore() or databaseStore(db)
   * @param {object} opts.providers   { aviationstack: {key, cap, refreshHours}, aerodatabox: {key, cap, refreshMinutes} }
   */
  constructor({ timezone, store, providers }) {
    this.timezone = timezone;
    this.store = store;
    this.config = providers;
    this.schedules = new Map();
  }

  /** Providers with a key, in order of preference. */
  enabledProviders() {
    return ['aviationstack', 'aerodatabox'].filter((name) => this.config[name]?.key);
  }

  refreshMs(name) {
    const c = this.config[name];
    return name === 'aviationstack' ? (c.refreshHours ?? 12) * 3600_000 : (c.refreshMinutes ?? 30) * MIN;
  }

  forAirport(airport) {
    let s = this.schedules.get(airport.icao);
    if (!s) {
      s = new Schedule(this, airport);
      this.schedules.set(airport.icao, s);
    }
    return s;
  }

  /** Forget schedules no board is using any more (their data stays in the store). */
  release(icao) {
    this.schedules.delete(icao);
  }

  async quotaStatus() {
    const out = {};
    for (const name of this.enabledProviders()) {
      out[name] = { used: await this.store.usage(name, PERIOD()), cap: this.config[name].cap };
    }
    return out;
  }

  /** Spend quota for one refresh if it fits under the monthly cap. */
  async reserve(name) {
    const { cap } = this.config[name];
    const cost = PROVIDERS[name].cost;
    const used = await this.store.usage(name, PERIOD());
    if (used + cost > cap) return false;
    await this.store.addUsage(name, PERIOD(), cost);
    return true;
  }
}

export class Schedule {
  constructor(service, airport) {
    this.service = service;
    this.airport = airport;
    this.flights = [];
    this.source = 'none';
    this.fetchedAt = 0;
    this.lastAttempt = 0;
    this.sampleDay = null;
    this.error = null;
    this.loadedFromStore = false;
    this.refreshing = null;
    this.completed = new Set(); // flights we have watched depart/land ourselves
  }

  /** Called on every board tick; cheap unless a refresh is due. */
  maybeRefresh() {
    if (!this.refreshing) {
      this.refreshing = this.refresh().catch((err) => {
        this.error = err.message;
        console.warn(`[timetable ${this.airport.icao}] ${err.message}`);
      }).finally(() => { this.refreshing = null; });
    }
    return this.refreshing;
  }

  async refresh() {
    const { service, airport } = this;
    const now = Date.now();
    const providers = service.enabledProviders();

    if (!providers.length) {
      // No keys: Bristol gets the sample timetable, anywhere else has none.
      if (airport.icao !== 'EGGD') return;
      const today = zonedParts(service.timezone).day;
      if (today !== this.sampleDay) {
        this.flights = buildSample(service.timezone, airport);
        this.source = 'sample';
        this.sampleDay = today;
        this.fetchedAt = now;
      }
      return;
    }

    // After a restart, reuse the last timetable fetched for this airport instead of spending quota.
    if (!this.loadedFromStore) {
      this.loadedFromStore = true;
      const saved = await service.store.getTimetable(airport.icao);
      if (saved) Object.assign(this, { flights: saved.flights, source: saved.source, fetchedAt: saved.fetchedAt });
    }

    const name = providers.find((p) => p === this.source) ?? providers[0];
    if (now - this.fetchedAt < service.refreshMs(name)) return;
    if (now - this.lastAttempt < 30 * MIN) return; // back off after failures / an exhausted quota
    this.lastAttempt = now;

    for (const candidate of providers) {
      if (!(await service.reserve(candidate))) {
        this.error = `${PROVIDERS[candidate].label} monthly cap reached`;
        continue;
      }
      const flights = await PROVIDERS[candidate].fetch(service.config[candidate].key, airport);
      Object.assign(this, { flights, source: candidate, fetchedAt: now, error: null });
      await service.store.putTimetable(airport.icao, candidate, now, flights);
      console.log(`[timetable ${airport.icao}] ${PROVIDERS[candidate].label}: ${flights.length} flights`);
      return;
    }
  }
  statusOf(f, now = Date.now()) {
    if (this.completed.has(f.id)) return f.direction === 'dep' ? 'Departed' : 'Arrived';
    return f.sample ? sampleStatus(f, now) : f.status;
  }

  markCompleted(f) {
    if (f) this.completed.add(f.id);
  }

  bestTime(f) {
    return f.runway ?? f.revised ?? f.scheduled;
  }

  /** Next flight still to depart or arrive, optionally only 'dep' or 'arr'. */
  next(now = Date.now(), direction = null) {
    return this.flights
      .filter((f) => !direction || f.direction === direction)
      .filter((f) => !DONE_STATUSES.has(this.statusOf(f, now)) && this.bestTime(f) >= now - 10 * MIN)
      .sort((a, b) => this.bestTime(a) - this.bestTime(b))[0] ?? null;
  }

  /** Find the timetable entry for a live aircraft. */
  match({ callsign, hex, reg, route }, airportIcao, now = Date.now()) {
    const near = this.flights.filter((f) => Math.abs(this.bestTime(f) - now) < 4 * 3600_000);
    const cs = callsign?.toUpperCase();
    let hit = cs && near.find((f) => f.callsign === cs || f.code === cs);
    if (!hit && (hex || reg)) {
      hit = near
        .filter((f) => (hex && f.aircraft?.modeS === hex) || (reg && f.aircraft?.reg === reg))
        .sort((a, b) => Math.abs(this.bestTime(a) - now) - Math.abs(this.bestTime(b) - now))[0];
    }
    if (!hit && route && cs) {
      // Airlines often fly under ATC callsigns (e.g. EZY63CT) that differ from the flight number:
      // fall back to same airline + same other airport within an hour.
      const dir = route.origin?.icao === airportIcao ? 'dep' : route.destination?.icao === airportIcao ? 'arr' : null;
      const otherIcao = dir === 'dep' ? route.destination?.icao : route.origin?.icao;
      if (dir) {
        hit = near
          .filter((f) => f.direction === dir && f.other?.icao === otherIcao && f.airline?.icao === cs.slice(0, 3))
          .filter((f) => Math.abs(this.bestTime(f) - now) < 75 * MIN)
          .sort((a, b) => Math.abs(this.bestTime(a) - now) - Math.abs(this.bestTime(b) - now))[0];
      }
    }
    return hit ?? null;
  }

  info() {
    return { source: this.source, fetchedAt: this.fetchedAt || null, error: this.error, count: this.flights.length };
  }
}
