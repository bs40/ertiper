const EARTH_KM = 6371.0088;
export const KM_PER_NM = 1.852;

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export function distanceKm(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

export const distanceNm = (a, b) => distanceKm(a, b) / KM_PER_NM;

/** Initial compass bearing from a to b, 0-360. */
export function bearingDeg(a, b) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Smallest absolute difference between two bearings, 0-180. */
export function angleDiff(a, b) {
  return Math.abs((((a - b) % 360) + 540) % 360 - 180);
}

/** Point a fraction f of the way along the great circle from a to b. */
export function interpolate(a, b, f) {
  const φ1 = rad(a.lat), λ1 = rad(a.lon), φ2 = rad(b.lat), λ2 = rad(b.lon);
  const d = distanceKm(a, b) / EARTH_KM;
  if (d === 0) return { lat: a.lat, lon: a.lon };
  const A = Math.sin((1 - f) * d) / Math.sin(d);
  const B = Math.sin(f * d) / Math.sin(d);
  const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
  const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
  const z = A * Math.sin(φ1) + B * Math.sin(φ2);
  return { lat: deg(Math.atan2(z, Math.hypot(x, y))), lon: deg(Math.atan2(y, x)) };
}
