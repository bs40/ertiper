// HTTP plumbing shared by both editions: security headers, JSON bodies, cookies, static files.
import fs from 'node:fs/promises';
import path from 'node:path';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Images come from the map tiles and the aircraft-photo and airline-logo services; everything
// else (scripts, styles, fonts, Leaflet) is served from this origin with no inline code.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: https://server.arcgisonline.com https://image.airport-data.com https://t.plnspttrs.net https://pics.avs.io",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

export function securityHeaders(res, { secure }) {
  res.setHeader('Content-Security-Policy', secure ? `${CSP}; upgrade-insecure-requests` : CSP);
  if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), interest-cohort=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.removeHeader('X-Powered-By');
}

export function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

export function redirect(res, location) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

/** JSON request body, max 32 KB, and only with a JSON content type (blocks simple cross-site form posts). */
export async function readJson(req, limit = 32 * 1024) {
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
    throw new HttpError(415, 'Expected application/json');
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Request too large');
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

export function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/**
 * Client address. The container is only reachable through bunny.net's CDN, which puts the visitor's
 * address first in X-Forwarded-For.
 */
export function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  return fwd || String(req.headers['x-real-ip'] ?? '') || req.socket.remoteAddress || 'unknown';
}

/**
 * Cross-site request protection for state-changing requests, on top of SameSite cookies and the
 * JSON-only bodies: the browser's Origin (or Sec-Fetch-Site) must say the request came from this site.
 */
export function assertSameOrigin(req, allowedOrigins) {
  const origin = req.headers.origin;
  if (origin) {
    if (!allowedOrigins.includes(origin)) throw new HttpError(403, 'Cross-site request refused');
    return;
  }
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') throw new HttpError(403, 'Cross-site request refused');
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

export async function serveStatic(res, root, pathname) {
  const file = path.normalize(path.join(root, pathname));
  const name = path.basename(file);
  if (!file.startsWith(root + path.sep) || name === 'web.config' || name.startsWith('.')) {
    return sendJson(res, 404, { error: 'Not found' });
  }
  try {
    const body = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch {
    sendJson(res, 404, { error: 'Not found' });
  }
}
