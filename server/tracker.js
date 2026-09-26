// Decides which aircraft is "the one out of the window" and builds what the board shows.
import { fetchNearby, fetchByHex } from './sources/adsb.js';
import { lookupRoute, lookupAirline } from './sources/routes.js';
import { lookupAircraft, lookupPhoto } from './sources/aircraft.js';
import { getWeather } from './sources/weather.js';
import { distanceKm, distanceNm, bearingDeg, angleDiff, interpolate } from './lib/geo.js';
import { aircraftName, boardName, flapText } from './lib/names.js';
import { safe } from './lib/http.js';

const MIN = 60_000;

const STATUS = {
  Expected: ['ON TIME', 'good'],
  CheckIn: ['CHECK-IN', 'info'],
  Boarding: ['BOARDING', 'warn'],
  GateClosed: ['GATE CLOSED', 'warn'],
  Departed: ['DEPARTED', 'good'],
  EnRoute: ['EN ROUTE', 'good'],
  Approaching: ['APPROACHING', 'info'],
  Arrived: ['LANDED', 'good'],
  Delayed: ['DELAYED', 'warn'],
  Canceled: ['CANCELLED', 'bad'],
  CanceledUncertain: ['CANCELLED', 'bad'],
  Diverted: ['DIVERTED', 'bad'],
  Unknown: ['SCHEDULED', 'info'],
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const point = (a) => (a && a.lat != null && a.lon != null
  ? { iata: a.iata || a.icao || '', name: boardName(a), lat: a.lat, lon: a.lon }
  : null);
const airlineCallsign = (cs) => (cs && /^[A-Z]{3}\d/.test(cs) ? cs.slice(0, 3) : null);

/** Rough minutes to cover the remaining distance, for when there is no timetable ETA. */
function estimateMinutes(toGoNm, ac) {
  const speed = toGoNm > 150 ? 440 : Math.max(ac?.gs ?? 250, 160);
  return (toGoNm / speed) * 60 + (toGoNm > 60 ? 8 : 0);
}

export class Tracker {
  constructor(config, schedule) {
    this.config = config;
    this.schedule = schedule;
    this.focus = null;
    this.flight = null;
    this.weather = null;
    this.feed = null;
    this.feedError = null;
    this.lastPollAt = null;
    this.inViewCount = 0;
    this.busy = false;
  }

  get airport() {
    const a = this.config.airport;
    return { iata: a.iata, icao: a.icao, name: a.name, city: a.city, lat: a.lat, lon: a.lon };
  }

  /** Effective mode: "planes I can see" needs a home location, otherwise fall back to all flights. */
  get mode() {
    const { mode, home } = this.config;
    return mode === 'visible' && !home ? 'all' : mode;
  }

  start() {
    this.tick();
    this.timer = setInterval(() => this.tick(), this.config.pollSeconds * 1000);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Forget the current aircraft after settings change, and refresh straight away. */
  reset() {
    this.focus = null;
    this.flight = null;
    this.inViewCount = 0;
    this.tick();
  }

  /** Resolves once the first update has completed, so a new board doesn't start empty. */
  ready() {
    return this.firstTick ?? Promise.resolve();
  }

  tick() {
    const run = this.runTick();
    this.firstTick ??= run;
    return run;
  }

  async runTick() {
    if (this.busy) return;
    this.busy = true;
    const now = Date.now();
    try {
      this.schedule.maybeRefresh();
      const place = this.config.home ?? this.airport;
      this.weather = (await safe(getWeather(place.lat, place.lon), 'weather')) ?? this.weather;
      try {
        await this.pollAircraft(now);
      } catch (err) {
        this.feedError = err.message;
        console.warn(`[adsb] ${err.message}`);
      }
      this.flight = this.focus ? await this.describeLive(this.focus, now) : await this.describeNext(now);
    } catch (err) {
      console.error('[tracker]', err);
    } finally {
      this.busy = false;
    }
  }

  isInView(ac, distKm) {
    const { home, view } = this.config;
    if (distKm > view.rangeKm) return false;
    if (ac.altFt == null || ac.altFt > view.maxAltFt) return false;
    if (ac.onGround && (ac.gs ?? 0) < 40) return false; // ignore taxiing/parked aircraft
    return angleDiff(bearingDeg(home, ac), view.bearing) <= view.width / 2;
  }

  routeFor(ac, climbing) {
    return safe(lookupRoute(ac.callsign, { lat: ac.lat, lon: ac.lon, airportIcao: this.airport.icao, climbing }), 'route');
  }

  /** "Planes I can see": inside the view wedge from home, nearest first, flights to/from our airport preferred. */
  async visibleCandidates(aircraft, now) {
    const { home } = this.config;
    const inView = aircraft
      .map((ac) => ({ ac, distKm: distanceKm(home, ac) }))
      .filter(({ ac, distKm }) => this.isInView(ac, distKm))
      .sort((a, b) => a.distKm - b.distKm);
    const enriched = await Promise.all(inView.slice(0, 5).map(async (c) => {
      const route = await this.routeFor(c.ac, c.ac.vs > 0);
      const sched = this.schedule.match({ ...c.ac, route }, this.airport.icao, now);
      const local = !!sched || route?.origin?.icao === this.airport.icao || route?.destination?.icao === this.airport.icao;
      return { ...c, local };
    }));
    return { all: inView, ranked: [...enriched.filter((c) => c.local), ...enriched.filter((c) => !c.local)] };
  }

  /**
   * Airport modes: aircraft taking off from / landing at our airport right now.
   * `want` is 'arr', 'dep' or null for both. Nearest to the airport first.
   */
  async movementCandidates(aircraft, now, want) {
    const airport = this.airport;
    const near = aircraft
      .map((ac) => ({ ac, distKm: distanceKm(airport, ac) }))
      .filter(({ ac, distKm }) => {
        if (ac.altFt == null || distKm > 30 || ac.altFt > 10000) return false;
        if (ac.onGround) return (ac.gs ?? 0) >= 40 && distKm < 4; // take-off or landing roll only
        return true;
      })
      .sort((a, b) => a.distKm - b.distKm)
      .slice(0, 8);
    const out = [];
    for (const c of near) {
      const route = await this.routeFor(c.ac, c.ac.vs > 0);
      const sched = this.schedule.match({ ...c.ac, route }, airport.icao, now);
      const dir = this.classify(c.ac, route, sched);
      const ok =
        (dir === 'dep' && c.distKm <= 25 && (c.ac.onGround || c.ac.vs > -300)) ||
        (dir === 'arr' && c.distKm <= 30 && c.ac.altFt <= 8000 && (c.ac.onGround || c.ac.vs < 300));
      if (ok && (!want || dir === want)) out.push({ ...c, local: true });
    }
    return { all: out, ranked: out };
  }

  async pollAircraft(now) {
    const { home, searchRadiusNm, focusLingerSeconds } = this.config;
    const mode = this.mode;
    const center = mode === 'visible' ? home : this.airport;
    const { feed, aircraft } = await fetchNearby(center.lat, center.lon, searchRadiusNm);
    this.feed = feed;
    this.feedError = null;
    this.lastPollAt = now;

    const { all, ranked } = mode === 'visible'
      ? await this.visibleCandidates(aircraft, now)
      : await this.movementCandidates(aircraft, now, { arrivals: 'arr', departures: 'dep' }[mode] ?? null);
    this.inViewCount = all.length;

    // Stay with the current aircraft while it still qualifies.
    const current = this.focus && all.find((c) => c.ac.hex === this.focus.hex);
    if (current) {
      Object.assign(this.focus, { ac: current.ac, lastInView: now, lastSeen: now });
      return;
    }

    const pick = ranked[0];
    if (pick) {
      this.focus = { hex: pick.ac.hex, ac: pick.ac, climbing: pick.ac.vs > 0, since: now, lastInView: now, lastSeen: now };
      console.log(`[focus] ${pick.ac.callsign || pick.ac.hex} ${pick.distKm.toFixed(1)} km, ${pick.ac.altFt} ft`);
      return;
    }

    // Nothing new in view: keep following the last aircraft for a while.
    if (this.focus && now - this.focus.lastInView < focusLingerSeconds * 1000) {
      const ac = aircraft.find((a) => a.hex === this.focus.hex) ?? (await safe(fetchByHex(this.focus.hex), 'adsb hex'));
      if (ac) Object.assign(this.focus, { ac, lastSeen: now });
      return;
    }
    this.focus = null;
  }

  classify(ac, route, sched) {
    if (sched) return sched.direction;
    if (route?.origin?.icao === this.airport.icao) return 'dep';
    if (route?.destination?.icao === this.airport.icao) return 'arr';
    if (distanceKm(this.airport, ac) < 10 && ac.altFt < 5000) {
      if (ac.vs > 200) return 'dep';
      if (ac.vs < -200) return 'arr';
    }
    return 'over';
  }

  async describeLive(focus, now) {
    const { ac } = focus;
    const route = await this.routeFor(ac, focus.climbing);
    const sched = this.schedule.match({ callsign: ac.callsign, hex: ac.hex, reg: ac.reg, route }, this.airport.icao, now);
    const info = await safe(lookupAircraft(ac.hex), 'aircraft');
    const reg = ac.reg || info?.reg || sched?.aircraft?.reg || null;
    const photo = await safe(lookupPhoto({ hex: ac.hex, reg }, this.config.planespotters.contact), 'photo');
    const direction = this.classify(ac, route, sched);

    if (sched && ((direction === 'dep' && !ac.onGround) || (direction === 'arr' && ac.onGround))) {
      this.schedule.markCompleted(sched);
    }

    let from = null;
    let to = null;
    if (direction === 'dep') {
      from = this.airport;
      to = sched?.other ?? (route?.origin?.icao === this.airport.icao ? route.destination : null);
    } else if (direction === 'arr') {
      to = this.airport;
      from = sched?.other ?? (route?.destination?.icao === this.airport.icao ? route.origin : null);
    } else {
      from = route?.origin ?? null;
      to = route?.destination ?? null;
    }

    let progress = null;
    if (point(from) && point(to)) {
      const totalNm = distanceNm(from, to);
      const toGoNm = distanceNm(ac, to);
      let eta = null;
      if (sched && direction === 'dep') eta = sched.otherRevised ?? sched.otherScheduled;
      if (sched && direction === 'arr' && toGoNm > 40) eta = sched.revised ?? sched.scheduled;
      if (!eta || eta < now) eta = now + estimateMinutes(toGoNm, ac) * MIN;
      progress = { totalNm, toGoNm, pct: totalNm ? clamp(1 - toGoNm / totalNm, 0, 1) : 0, eta };
    }

    let status;
    if (direction === 'dep') status = ac.onGround ? ['TAKING OFF', 'good'] : ['DEPARTED', 'good'];
    else if (direction === 'arr') status = ac.onGround ? ['LANDED', 'good'] : ac.altFt < 2500 ? ['LANDING', 'info'] : ['APPROACHING', 'info'];
    else status = ['OVERHEAD', 'info'];

    const airline = sched?.airline ?? route?.airline ?? (await safe(lookupAirline(airlineCallsign(ac.callsign)), 'airline'));
    const place = direction === 'arr' ? from : to;
    const code = sched?.code || ac.callsign || reg || ac.hex.toUpperCase();

    return {
      key: `live:${ac.hex}`,
      mode: 'live',
      direction,
      label: { dep: 'DEPARTING', arr: 'ARRIVING', over: 'OVERHEAD' }[direction],
      code: flapText(code).replace(/\s/g, ''),
      airline,
      placeLabel: direction === 'arr' ? 'FROM' : 'TO',
      place: { name: place ? boardName(place) : '', iata: place?.iata || '' },
      from: point(from),
      to: point(to),
      times: {
        scheduled: sched?.scheduled ?? null,
        estimated: sched ? sched.runway ?? sched.revised ?? sched.scheduled : direction === 'arr' ? progress?.eta ?? null : null,
      },
      status: { text: status[0], tone: status[1] },
      aircraft: { name: info?.name ?? aircraftName(ac.icaoType) ?? sched?.aircraft?.model ?? null, reg },
      photo,
      live: { lat: ac.lat, lon: ac.lon, altFt: ac.altFt, gs: ac.gs, track: ac.track, vs: ac.vs, onGround: ac.onGround },
      progress,
      inView: now - focus.lastInView < 15_000,
      routeSource: sched ? this.schedule.source : route?.source ?? null,
    };
  }

  async describeNext(now) {
    const f = this.schedule.next(now, { arrivals: 'arr', departures: 'dep' }[this.mode] ?? null);
    if (!f) return null;
    let [text, tone] = STATUS[this.schedule.statusOf(f, now)] ?? STATUS.Unknown;
    if (text === 'ON TIME' && f.revised && f.revised > f.scheduled + 5 * MIN) [text, tone] = STATUS.Delayed;

    const id = f.aircraft?.modeS || f.aircraft?.reg;
    let info = id ? await safe(lookupAircraft(id), 'aircraft') : null;
    // Sample registrations are illustrative; ignore lookups that turn up a different aircraft type.
    if (f.sample && info?.name && f.aircraft?.model && info.name !== f.aircraft.model) info = null;
    const photo = info || (id && !f.sample)
      ? await safe(lookupPhoto({ hex: f.aircraft?.modeS || info?.hex, reg: f.aircraft?.reg || info?.reg }, this.config.planespotters.contact), 'photo')
      : null;

    const from = f.direction === 'dep' ? this.airport : f.other;
    const to = f.direction === 'dep' ? f.other : this.airport;
    const totalNm = point(from) && point(to) ? distanceNm(from, to) : null;
    const depTime = f.direction === 'dep' ? f.revised ?? f.scheduled : f.otherRevised ?? f.otherScheduled;
    const arrTime = f.direction === 'dep' ? f.otherRevised ?? f.otherScheduled : f.revised ?? f.scheduled;

    return {
      key: `next:${f.id}`,
      mode: 'next',
      direction: f.direction,
      label: f.direction === 'dep' ? 'NEXT DEPARTURE' : 'NEXT ARRIVAL',
      code: flapText(f.code).replace(/\s/g, ''),
      airline: f.airline,
      placeLabel: f.direction === 'dep' ? 'TO' : 'FROM',
      place: { name: boardName(f.other), iata: f.other?.iata || '' },
      from: point(from),
      to: point(to),
      times: { scheduled: f.scheduled, estimated: f.runway ?? f.revised ?? f.scheduled },
      status: { text, tone },
      aircraft: { name: f.aircraft?.model ?? info?.name ?? null, reg: f.aircraft?.reg ?? info?.reg ?? null },
      photo,
      live: null,
      progress: totalNm ? { totalNm, toGoNm: totalNm, pct: 0, eta: arrTime ?? null } : null,
      flightMinutes: depTime && arrTime ? Math.round((arrTime - depTime) / MIN) : null,
      inView: false,
      routeSource: this.schedule.source,
    };
  }

  /** A simulated departure matching the mockup, for checking the design at any hour. */
  async describeDemo(now) {
    const from = this.airport;
    const to = { iata: 'AMS', icao: 'EHAM', city: 'Amsterdam', lat: 52.3086, lon: 4.7639 };
    const cycle = 20 * MIN;
    const f = 0.02 + 0.96 * ((now % cycle) / cycle);
    const pos = interpolate(from, to, f);
    const totalNm = distanceNm(from, to);
    const toGoNm = totalNm * (1 - f);
    const altFt = Math.round(Math.min(f * 5, 1, (1 - f) * 4) * 37000);
    const reg = 'G-EZTJ';
    const [info, photo] = await Promise.all([
      safe(lookupAircraft(reg), 'aircraft'),
      safe(lookupPhoto({ reg }, this.config.planespotters.contact), 'photo'),
    ]);
    const departed = now - f * 70 * MIN;
    return {
      key: 'demo:EZY6017',
      mode: 'live',
      direction: 'dep',
      label: 'DEPARTING',
      code: 'EZY6017',
      airline: { name: 'easyJet', iata: 'U2', icao: 'EZY' },
      placeLabel: 'TO',
      place: { name: 'AMSTERDAM', iata: 'AMS' },
      from: point(from),
      to: point(to),
      times: { scheduled: departed - 1 * MIN, estimated: departed },
      status: { text: 'DEPARTED', tone: 'good' },
      aircraft: { name: info?.name ?? 'Airbus A320', reg },
      photo,
      live: { ...pos, altFt, gs: Math.round(180 + Math.min(f * 6, 1) * 260), track: 75, vs: 0, onGround: false },
      progress: { totalNm, toGoNm, pct: f, eta: now + estimateMinutes(toGoNm, { gs: 420 }) * MIN },
      inView: f < 0.1,
      routeSource: 'demo',
    };
  }

  async state({ demo = false } = {}) {
    const now = Date.now();
    return {
      now,
      version: this.config.version,
      mode: this.mode,
      airport: { iata: this.airport.iata, name: this.airport.name, city: this.airport.city },
      weather: this.weather,
      schedule: this.schedule.info(),
      feed: { name: this.feed, error: this.feedError, lastPollAt: this.lastPollAt, inView: this.inViewCount },
      demo,
      flight: demo ? await this.describeDemo(now) : this.flight,
    };
  }
}
