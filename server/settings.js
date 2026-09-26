// Validation for settings sent from the settings page.
import { findAirport } from './airports.js';

const MODES = ['visible', 'arrivals', 'departures', 'all'];

const num = (v, lo, hi, name) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < lo || n > hi) throw new Error(`${name} must be between ${lo} and ${hi}`);
  return n;
};

/** Returns clean settings { airport, home, view, mode } or throws with a readable message. */
export function validateSettings(body) {
  const airport = findAirport(body?.airport?.icao ?? '');
  if (!airport) throw new Error('Unknown airport');

  let home = null;
  if (body.home) {
    home = {
      lat: Math.round(num(body.home.lat, -90, 90, 'Latitude') * 1e5) / 1e5,
      lon: Math.round(num(body.home.lon, -180, 180, 'Longitude') * 1e5) / 1e5,
    };
  }

  const v = body.view ?? {};
  const view = {
    bearing: Math.round(num(v.bearing, 0, 360, 'View direction')) % 360,
    width: Math.round(num(v.width, 10, 360, 'View width')),
    rangeKm: Math.round(num(v.rangeKm, 1, 50, 'View distance') * 10) / 10,
    maxAltFt: Math.round(num(v.maxAltFt, 500, 45000, 'Maximum height')),
  };

  if (!MODES.includes(body.mode)) throw new Error('Unknown mode');
  if (body.mode === 'visible' && !home) throw new Error('"Planes I can see" needs your location');

  return { airport, home, view, mode: body.mode };
}
