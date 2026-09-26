const DEFAULT_UA = 'Ertiper-FlightBoard/1.0 (personal flight display)';

/** Fetch JSON. Returns null for 404/empty bodies, throws on other failures. */
export async function getJson(url, { method = 'GET', headers = {}, body, timeoutMs = 10000, userAgent } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      'User-Agent': userAgent || DEFAULT_UA,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText} from ${new URL(url).host} ${text.slice(0, 160)}`.trim());
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/**
 * Promise cache with expiry. Concurrent callers share one in-flight request.
 * Failures are remembered briefly so a broken service is not hammered every poll.
 */
export class TtlCache {
  constructor(ttlMs, { failureTtlMs = 60_000, maxSize = 2000 } = {}) {
    this.ttl = ttlMs;
    this.failureTtl = failureTtlMs;
    this.max = maxSize;
    this.map = new Map();
  }

  wrap(key, fn, ttl = this.ttl) {
    const hit = this.map.get(key);
    if (hit && hit.expires > Date.now()) return hit.promise;
    const entry = { promise: Promise.resolve().then(fn), expires: Date.now() + ttl };
    entry.promise.catch(() => { entry.expires = Date.now() + this.failureTtl; });
    this.map.set(key, entry);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
    return entry.promise;
  }
}

/** Await a promise, returning null (and logging) instead of throwing. */
export async function safe(promise, label) {
  try {
    return await promise;
  } catch (err) {
    if (label) console.warn(`[${label}] ${err.message}`);
    return null;
  }
}
