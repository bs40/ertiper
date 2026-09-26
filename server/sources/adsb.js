// Live aircraft positions from free community ADS-B networks (non-commercial use, ~1 request/second).
// airplanes.live is not used: it now requires emailing them for API approval.
import { getJson } from '../lib/http.js';

const FEEDS = [
  {
    name: 'adsb.lol',
    point: (lat, lon, nm) => `https://api.adsb.lol/v2/point/${lat}/${lon}/${nm}`,
    hex: (hex) => `https://api.adsb.lol/v2/hex/${hex}`,
  },
  {
    name: 'adsb.fi',
    point: (lat, lon, nm) => `https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${nm}`,
    hex: (hex) => `https://opendata.adsb.fi/api/v2/hex/${hex}`,
  },
];

function normalise(ac) {
  const lat = ac.lat ?? ac.lastPosition?.lat;
  const lon = ac.lon ?? ac.lastPosition?.lon;
  if (lat == null || lon == null || !ac.hex) return null;
  const onGround = ac.alt_baro === 'ground';
  const alt = typeof ac.alt_baro === 'number' ? ac.alt_baro : ac.alt_geom;
  return {
    hex: ac.hex.toLowerCase().replace(/^~/, ''),
    callsign: (ac.flight || '').trim() || null,
    reg: ac.r || null,
    icaoType: ac.t || null,
    lat,
    lon,
    altFt: onGround ? 0 : alt ?? null,
    onGround,
    gs: ac.gs ?? null,
    track: ac.track ?? ac.true_heading ?? ac.mag_heading ?? null,
    vs: ac.baro_rate ?? ac.geom_rate ?? 0,
    squawk: ac.squawk || null,
    seenPos: ac.seen_pos ?? ac.seen ?? 0,
  };
}

// Several boards can be active at once, so requests go through one queue spaced ~1.1 s apart
// (the community feeds allow about one request per second), and identical area queries made
// within a few seconds share one response.
const SPACING_MS = 1100;
const SHARE_MS = 4000;
let queue = Promise.resolve();
let lastRequestAt = 0;
const recent = new Map();

function throttled(fn) {
  const run = queue.then(async () => {
    const wait = lastRequestAt + SPACING_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
    return fn();
  });
  queue = run.catch(() => {});
  return run;
}

function shared(key, fn) {
  const hit = recent.get(key);
  if (hit && Date.now() - hit.at < SHARE_MS) return hit.promise;
  const promise = throttled(fn);
  recent.set(key, { at: Date.now(), promise });
  promise.catch(() => recent.delete(key));
  for (const [k, v] of recent) if (Date.now() - v.at > SHARE_MS * 3) recent.delete(k);
  return promise;
}

async function tryFeeds(buildUrl) {
  let lastErr;
  for (const feed of FEEDS) {
    try {
      const data = await getJson(buildUrl(feed), { timeoutMs: 8000 });
      const list = (data?.ac ?? data?.aircraft ?? []).map(normalise).filter(Boolean);
      return { feed: feed.name, aircraft: list };
    } catch (err) {
      console.warn(`[adsb ${feed.name}] ${err.message.slice(0, 120)}`);
      lastErr = err;
    }
  }
  throw lastErr ?? new Error('No ADS-B feed available');
}

export function fetchNearby(lat, lon, radiusNm) {
  const [la, lo, nm] = [lat.toFixed(3), lon.toFixed(3), Math.round(radiusNm)];
  return shared(`point:${la}:${lo}:${nm}`, () => tryFeeds((f) => f.point(la, lo, nm)));
}

export async function fetchByHex(hex) {
  const { aircraft } = await shared(`hex:${hex}`, () => tryFeeds((f) => f.hex(hex)));
  return aircraft[0] ?? null;
}
