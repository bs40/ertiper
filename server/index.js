// Ertiper flight board server. Two editions from one codebase:
//   single-user  (no DATABASE_URL)  settings in config.json, no sign-in. Used by the Windows installer.
//   multi-user   (DATABASE_URL set) email sign-up with admin approval, each user's settings stored
//                                   encrypted in Bunny Database. Used on bunny.net Magic Containers.
import http from 'node:http';
import path from 'node:path';
import { loadConfig, saveSettings as saveFileSettings, ROOT, CONFIG_FILE } from './config.js';
import { searchAirports } from './airports.js';
import { validateSettings } from './settings.js';
import { TimetableService } from './sources/schedule.js';
import { memoryStore } from './store/memory.js';
import { BoardManager } from './boards.js';
import { HttpError, securityHeaders, sendJson, readJson, redirect, serveStatic, assertSameOrigin } from './web.js';

const PUBLIC = path.join(ROOT, 'public');
const env = process.env;
const config = loadConfig();
const multiUser = Boolean(env.DATABASE_URL);
const secure = multiUser && env.COOKIE_SECURE !== 'false';

// Settings every board shares; per-user settings (airport, home, view, mode) are layered on top.
const boardBase = {
  pollSeconds: config.pollSeconds,
  searchRadiusNm: config.searchRadiusNm,
  focusLingerSeconds: config.focusLingerSeconds,
  timezone: config.timezone,
  planespotters: { contact: env.PLANESPOTTERS_CONTACT || config.planespotters.contact },
};

function timetableProviders() {
  return {
    aviationstack: {
      key: env.AVIATIONSTACK_KEY || config.aviationstack?.accessKey || '',
      cap: Number(env.AVIATIONSTACK_MONTHLY_CAP || config.aviationstack?.monthlyCap || 95),
      refreshHours: Number(env.AVIATIONSTACK_REFRESH_HOURS || config.aviationstack?.refreshHours || 12),
    },
    aerodatabox: {
      key: env.AERODATABOX_KEY || config.aerodatabox.rapidApiKey || '',
      cap: Number(env.AERODATABOX_MONTHLY_UNITS || config.aerodatabox.monthlyUnits || 4500),
      refreshMinutes: Number(config.aerodatabox.refreshMinutes || 30),
    },
  };
}

/** Plain-English description of where an airport's timetable comes from. */
function timetableNote(timetables, airport) {
  const labels = { aviationstack: 'Aviationstack', aerodatabox: 'AeroDataBox' };
  const enabled = timetables.enabledProviders();
  if (enabled.length) {
    const first = enabled[0];
    const every = first === 'aviationstack' ? `${timetables.config.aviationstack.refreshHours} hours` : `${timetables.config.aerodatabox.refreshMinutes} minutes`;
    return { source: first, text: `Timetable from ${enabled.map((p) => labels[p]).join(', then ')}, refreshed at most every ${every} while the board is open (shared monthly limit).` };
  }
  if (airport.icao === 'EGGD') return { source: 'sample', text: 'Using the sample Bristol timetable. Add a timetable API key for real times.' };
  return { source: 'none', text: 'No timetable for this airport without a timetable API key: the board will show live planes only.', warn: true };
}

// ---------------------------------------------------------------------------------------------
// Edition setup

let accounts = null;
let store = memoryStore();
let allowedOrigins = [`http://localhost:${config.port}`, `http://127.0.0.1:${config.port}`];

if (multiUser) {
  const required = ['DATABASE_URL', 'SESSION_SECRET', 'DATA_KEY', 'ADMIN_EMAIL', 'PUBLIC_URL'];
  if (secure) required.push('RESEND_API_KEY', 'EMAIL_FROM');
  const missing = required.filter((k) => !env[k]);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);

  const { openDatabase, databaseStore } = await import('./store/db.js');
  const { createCrypto } = await import('./auth/crypto.js');
  const { createMailer } = await import('./auth/email.js');
  const { createAccounts } = await import('./auth/accounts.js');
  const { findAirport } = await import('./airports.js');

  const db = await openDatabase(env.DATABASE_URL, env.DATABASE_AUTH_TOKEN);
  store = databaseStore(db);
  const publicUrl = env.PUBLIC_URL.replace(/\/$/, '');
  allowedOrigins = [new URL(publicUrl).origin, ...(secure ? [] : allowedOrigins)];
  accounts = createAccounts({
    db,
    crypto: createCrypto({ sessionSecret: env.SESSION_SECRET, dataKey: env.DATA_KEY }),
    mailer: createMailer({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM }),
    adminEmail: env.ADMIN_EMAIL.trim().toLowerCase(),
    publicUrl,
    secure,
    devEcho: env.AUTH_DEV_ECHO === 'true',
    defaultSettings: () => ({ airport: findAirport('EGGD'), home: null, view: { ...config.view }, mode: 'all' }),
  });
}

const timetables = new TimetableService({ timezone: config.timezone, store, providers: timetableProviders() });
const boards = new BoardManager(boardBase, timetables);

// Per-user settings are read on every poll, so keep them briefly in memory.
const settingsCache = new Map();
async function settingsFor(user) {
  if (!multiUser) {
    const { airport, home, view, mode, version } = config;
    return { airport, home, view, mode, version };
  }
  const hit = settingsCache.get(user.id);
  if (hit && Date.now() - hit.at < 30_000) return hit.settings;
  const settings = await accounts.getSettings(user);
  settingsCache.set(user.id, { settings, at: Date.now() });
  return settings;
}

async function saveSettingsFor(user, body) {
  if (!multiUser) {
    saveFileSettings(config, validateSettings(body));
    return settingsFor(null);
  }
  const saved = await accounts.saveSettings(user, body);
  settingsCache.set(user.id, { settings: saved, at: Date.now() });
  return saved;
}

async function settingsResponse(user) {
  const s = await settingsFor(user);
  return {
    airport: s.airport, home: s.home, view: s.view, mode: s.mode, version: s.version,
    timezone: config.timezone,
    timetable: timetableNote(timetables, s.airport),
    multiUser,
    user: multiUser ? accounts.publicUser(user) : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Routing

const PAGES = new Set(['/', '/index.html', '/settings', '/settings.html', '/admin.html']);
const approved = (user) => !multiUser || user?.status === 'approved';
const isAdmin = (user) => multiUser && user?.status === 'approved' && Number(user.is_admin) === 1;

async function route(req, res, url) {
  const { pathname } = url;
  const user = multiUser ? await accounts.authenticate(req) : null;

  if (req.method === 'POST') assertSameOrigin(req, allowedOrigins);
  if (pathname === '/api/health') return sendJson(res, 200, { ok: true });

  if (multiUser && (pathname.startsWith('/api/auth/') || pathname.startsWith('/api/account/') || pathname.startsWith('/api/admin/users'))) {
    if (await accounts.handle(req, res, url, user)) return;
  }

  if (pathname.startsWith('/api/')) {
    if (multiUser && !user) throw new HttpError(401, 'Not signed in');
    if (!approved(user)) throw new HttpError(403, 'Your account is waiting for approval');

    if (pathname === '/api/state' && req.method === 'GET') {
      const s = await settingsFor(user);
      const board = await boards.get(s);
      return sendJson(res, 200, { ...(await board.state({ demo: url.searchParams.has('demo') })), version: s.version });
    }
    if ((pathname === '/api/config' || pathname === '/api/settings') && req.method === 'GET') {
      return sendJson(res, 200, await settingsResponse(user));
    }
    if (pathname === '/api/settings' && req.method === 'POST') {
      try {
        await saveSettingsFor(user, await readJson(req));
      } catch (err) {
        throw err instanceof HttpError ? err : new HttpError(400, err.message);
      }
      return sendJson(res, 200, await settingsResponse(user));
    }
    if (pathname === '/api/airports' && req.method === 'GET') {
      return sendJson(res, 200, searchAirports(url.searchParams.get('q') ?? ''));
    }
    if (pathname === '/api/admin/stats' && req.method === 'GET') {
      if (!isAdmin(user)) throw new HttpError(403, 'Admins only');
      return sendJson(res, 200, { boards: boards.stats(), quotas: await timetables.quotaStatus() });
    }
    throw new HttpError(404, 'Not found');
  }

  // Pages: sign-in required for everything except the sign-in page and its assets.
  if (multiUser && PAGES.has(pathname)) {
    if (!user) return redirect(res, '/auth.html');
    if (!approved(user)) return redirect(res, '/auth.html#pending');
    if (pathname === '/admin.html' && !isAdmin(user)) return redirect(res, '/');
  }
  if (!multiUser && pathname === '/admin.html') throw new HttpError(404, 'Not found');
  if (multiUser && pathname === '/auth.html' && approved(user) && user) return redirect(res, '/');

  const file = pathname === '/' ? '/index.html' : pathname === '/settings' ? '/settings.html' : pathname;
  return serveStatic(res, PUBLIC, decodeURIComponent(file));
}

const server = http.createServer(async (req, res) => {
  securityHeaders(res, { secure });
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
    await route(req, res, url);
  } catch (err) {
    if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
    console.error(`[error] ${req.method} ${url?.pathname ?? '?'}:`, err);
    sendJson(res, 500, { error: 'Something went wrong' });
  }
});
server.requestTimeout = 30_000;
server.headersTimeout = 15_000;

// The installed Windows service sets ERTIPER_HOST=127.0.0.1 so only IIS on the same PC can reach it;
// in a container it must listen on all interfaces.
const host = env.ERTIPER_HOST || undefined;
server.listen(config.port, host, () => {
  console.log(`Flight board (${multiUser ? 'multi-user' : 'single-user'}) on http://${host ?? 'localhost'}:${config.port}`);
  if (!multiUser) console.log(`Config: ${CONFIG_FILE}`);
  const enabled = timetables.enabledProviders();
  console.log(`Timetable: ${enabled.length ? enabled.join(', ') : 'sample (Bristol) / none'}`);
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    console.log(`${sig}: shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
