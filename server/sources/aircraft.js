// Aircraft details (type, registration) and photos of the actual airframe.
import { getJson, TtlCache } from '../lib/http.js';
import { aircraftName } from '../lib/names.js';

const aircraftCache = new TtlCache(24 * 3600_000);
const photoCache = new TtlCache(24 * 3600_000);

/** Look up by Mode-S hex or registration via adsbdb. */
export function lookupAircraft(id) {
  if (!id) return Promise.resolve(null);
  return aircraftCache.wrap(id.toUpperCase(), async () => {
    const data = await getJson(`https://api.adsbdb.com/v0/aircraft/${encodeURIComponent(id)}`, { timeoutMs: 8000 });
    const a = data?.response?.aircraft;
    if (!a) return null;
    return {
      hex: a.mode_s?.toLowerCase() || null,
      reg: a.registration || null,
      icaoType: a.icao_type || null,
      name: aircraftName(a.icao_type, a.manufacturer, a.type),
      owner: a.registered_owner || null,
      photo: a.url_photo ? { src: a.url_photo, credit: 'airport-data.com', link: null } : null,
    };
  });
}

async function planespotters(kind, id, contact) {
  const data = await getJson(`https://api.planespotters.net/pub/photos/${kind}/${encodeURIComponent(id)}`, {
    timeoutMs: 8000,
    userAgent: `Ertiper-FlightBoard/1.0 (+mailto:${contact})`,
  });
  const p = data?.photos?.[0];
  if (!p) return null;
  const src = p.thumbnail_large?.src || p.thumbnail?.src;
  return src ? { src, credit: `${p.photographer} / planespotters.net`, link: p.link || null } : null;
}

/**
 * Best available photo of the specific aircraft.
 * airport-data.com (via adsbdb) is full size, so it wins when it exists; Planespotters covers far more
 * aircraft but its API only offers ~500px thumbnails. Planespotters needs a contact address in the
 * User-Agent, so it is only used once one is configured.
 */
export function lookupPhoto({ hex, reg }, contact) {
  const key = `${hex || ''}|${reg || ''}`;
  if (key === '|') return Promise.resolve(null);
  return photoCache.wrap(key, async () => {
    const info = await lookupAircraft(hex || reg).catch(() => null);
    if (info?.photo) return info.photo;
    if (!contact) return null;
    try {
      return (hex && (await planespotters('hex', hex, contact))) || (reg && (await planespotters('reg', reg, contact))) || null;
    } catch (err) {
      console.warn(`[planespotters] ${err.message}`);
      return null;
    }
  });
}
