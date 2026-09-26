// Accounts for the multi-user edition, ported from ProcrastiMate (itself from GoatWoat):
//   - sign-up with email + password, confirmed by a 6-digit emailed code
//   - sign-in with password, or with an emailed code instead
//   - new accounts wait for the admin's approval (ADMIN_EMAIL is approved automatically)
// Hardening: PBKDF2 passwords, encrypted emails with an HMAC lookup index, decoy challenges so
// sign-up/sign-in never reveal whether an email is registered, equal-time password checks,
// per-IP rate limits, per-account lockout, capped code attempts, revocable signed sessions,
// and an audit log (user ids only).
import { HttpError, readJson, sendJson, parseCookies, clientIp } from '../web.js';
import { randomCode, randomId, safeEqual } from './crypto.js';
import { validateSettings } from '../settings.js';
import { findAirport } from '../airports.js';

const MIN = 60_000;
const CODE_TTL = 10 * MIN;
const MAX_CODE_ATTEMPTS = 5;
const SESSION_TTL = 30 * 24 * 60 * MIN;
const LOCK_MAX = 10;
const LOCK_MS = 15 * MIN;
const EMAIL_RE = /^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$/;

function requireStr(value, name, max) {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, `${name} is required`);
  if (value.length > max) throw new HttpError(400, `${name} is too long`);
  return value.trim();
}

function maskEmail(email) {
  const [user, domain] = email.split('@');
  return `${user.slice(0, 1)}***@${domain}`;
}

export function createAccounts({ db, crypto, mailer, adminEmail, publicUrl, secure, defaultSettings, devEcho = false }) {
  // Local development only: return codes in the API response instead of needing email.
  if (devEcho && secure) throw new Error('AUTH_DEV_ECHO must never be used with secure (production) cookies');
  const cookieName = secure ? '__Host-ertiper' : 'ertiper_session';
  const adminIndex = crypto.emailIndex(adminEmail);
  const dummyHash = crypto.hashPassword('not-a-real-password-just-equal-timing');
  const userCache = new Map(); // id -> { user, at }

  // --- helpers --------------------------------------------------------------------------------

  async function rateLimit(bucket, max, windowMs) {
    const now = Date.now();
    const row = await db.one('SELECT count, reset_at FROM rate_limits WHERE bucket = ?', [bucket]);
    if (!row || Number(row.reset_at) <= now) {
      await db.run(
        'INSERT INTO rate_limits (bucket, count, reset_at) VALUES (?, 1, ?) ON CONFLICT (bucket) DO UPDATE SET count = 1, reset_at = excluded.reset_at',
        [bucket, now + windowMs],
      );
      return;
    }
    if (Number(row.count) >= max) throw new HttpError(429, 'Too many attempts. Please wait a few minutes and try again.');
    await db.run('UPDATE rate_limits SET count = count + 1 WHERE bucket = ?', [bucket]);
  }

  async function sweep() {
    const now = Date.now();
    await db.run('DELETE FROM rate_limits WHERE reset_at < ?', [now - 60 * MIN]);
    await db.run('DELETE FROM auth_codes WHERE expires_at < ?', [now - 60 * MIN]);
  }

  const codeHash = (id, code) => crypto.sign(`code:${id}:${code}`);

  function sessionCookie(token, maxAgeSec) {
    const parts = [`${cookieName}=${token}`, 'HttpOnly', 'Path=/', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
    if (secure) parts.push('Secure');
    return parts.join('; ');
  }

  function startSession(res, user) {
    const token = crypto.makeSession(user.id, Number(user.session_ver), SESSION_TTL);
    res.setHeader('Set-Cookie', sessionCookie(token, SESSION_TTL / 1000));
  }

  const clearSession = (res) => res.setHeader('Set-Cookie', sessionCookie('', 0));

  function publicUser(user) {
    return {
      email: crypto.decrypt(user.email_enc, `users.email:${user.id}`),
      status: user.status,
      isAdmin: Number(user.is_admin) === 1,
      createdAt: Number(user.created_at),
    };
  }

  /** Create a sign-up or sign-in challenge. Decoys look identical but send nothing and never verify. */
  async function startChallenge({ emailIndex, email, purpose, payload, decoy }) {
    const id = randomId();
    const code = randomCode();
    await db.run(
      `INSERT INTO auth_codes (id, email_index, purpose, code_hash, payload_enc, decoy, attempts, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [id, emailIndex, purpose, codeHash(id, code), payload ? crypto.encrypt(JSON.stringify(payload), `auth_codes.payload:${id}`) : null,
        decoy ? 1 : 0, Date.now() + CODE_TTL, Date.now()],
    );
    if (!decoy) await mailer.code(email, code);
    return { challengeId: id, email: maskEmail(email), ...(devEcho && !decoy ? { devCode: code } : {}) };
  }

  /** Settings are removed explicitly: foreign-key cascades aren't guaranteed over remote connections. */
  async function deleteUser(id) {
    const [, users] = await db.batch([['DELETE FROM user_settings WHERE user_id = ?', [id]], ['DELETE FROM users WHERE id = ?', [id]]]);
    return users.rowsAffected;
  }

  async function userByIndex(emailIndex) {
    return db.one('SELECT * FROM users WHERE email_index = ?', [emailIndex]);
  }

  // --- sessions ----------------------------------------------------------------------------------

  /** The signed-in user for a request, or null. Revoked (session_ver) and rejected users get null. */
  async function authenticate(req) {
    const session = crypto.readSession(parseCookies(req)[cookieName]);
    if (!session) return null;
    const cached = userCache.get(session.uid);
    let user = cached && Date.now() - cached.at < 15_000 ? cached.user : null;
    if (!user) {
      user = await db.one('SELECT * FROM users WHERE id = ?', [session.uid]);
      userCache.set(session.uid, { user, at: Date.now() });
    }
    if (!user || Number(user.session_ver) !== session.ver || user.status === 'rejected') return null;
    return user;
  }

  const forget = (id) => userCache.delete(id);

  // --- per-user board settings, encrypted (they include the home location) ---------------------------

  async function getSettings(user) {
    const row = await db.one('SELECT data_enc, version FROM user_settings WHERE user_id = ?', [user.id]);
    if (!row) return { ...defaultSettings(), version: 1 };
    const data = JSON.parse(crypto.decrypt(row.data_enc, `user_settings:${user.id}`));
    return { ...defaultSettings(), ...data, version: Number(row.version) };
  }

  async function saveSettings(user, body) {
    const clean = validateSettings(body);
    const enc = crypto.encrypt(JSON.stringify(clean), `user_settings:${user.id}`);
    await db.run(
      `INSERT INTO user_settings (user_id, data_enc, version, updated_at) VALUES (?, ?, 2, ?)
       ON CONFLICT (user_id) DO UPDATE SET data_enc = excluded.data_enc, version = user_settings.version + 1, updated_at = excluded.updated_at`,
      [user.id, enc, Date.now()],
    );
    return getSettings(user);
  }

  // --- route handlers ----------------------------------------------------------------------------------

  const routes = {
    'POST /api/auth/register/start': async (req, res) => {
      await rateLimit(`register:${clientIp(req)}`, 5, 60 * MIN);
      const body = await readJson(req);
      const email = requireStr(body.email, 'Email', 120).toLowerCase();
      const password = requireStr(body.password, 'Password', 200);
      if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Please enter a valid email address');
      if (password.length < 10) throw new HttpError(400, 'Password must be at least 10 characters');
      const emailIndex = crypto.emailIndex(email);
      const taken = await userByIndex(emailIndex);
      const passwordHash = await crypto.hashPassword(password); // always, so timing doesn't reveal "taken"
      const out = await startChallenge({
        emailIndex, email, purpose: 'register', decoy: !!taken,
        payload: taken ? null : { email, passwordHash },
      });
      sendJson(res, 200, out);
    },

    'POST /api/auth/login': async (req, res) => {
      await rateLimit(`login:${clientIp(req)}`, 10, 15 * MIN);
      const body = await readJson(req);
      const email = requireStr(body.email, 'Email', 120).toLowerCase();
      const password = requireStr(body.password, 'Password', 200);
      const emailIndex = crypto.emailIndex(email);
      const lock = await db.one('SELECT count, reset_at FROM rate_limits WHERE bucket = ?', [`lock:${emailIndex}`]);
      if (lock && Number(lock.count) >= LOCK_MAX && Number(lock.reset_at) > Date.now()) {
        throw new HttpError(429, 'Too many failed sign-ins for this account. Try again in 15 minutes, or sign in with an emailed code.');
      }
      const user = await userByIndex(emailIndex);
      const ok = await crypto.verifyPassword(password, user?.password_hash ?? (await dummyHash));
      if (!user || !ok) {
        await rateLimit(`lock:${emailIndex}`, Number.MAX_SAFE_INTEGER, LOCK_MS);
        throw new HttpError(401, 'Wrong email or password');
      }
      await db.run('DELETE FROM rate_limits WHERE bucket = ?', [`lock:${emailIndex}`]);
      if (user.status === 'rejected') throw new HttpError(403, 'This account has not been approved');
      await db.run('UPDATE users SET last_login_at = ? WHERE id = ?', [Date.now(), user.id]);
      await db.audit(user.id, 'login.password');
      startSession(res, user);
      sendJson(res, 200, { user: publicUser(user) });
    },

    'POST /api/auth/login/code': async (req, res) => {
      await rateLimit(`logincode:${clientIp(req)}`, 5, 15 * MIN);
      const body = await readJson(req);
      const email = requireStr(body.email, 'Email', 120).toLowerCase();
      if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Please enter a valid email address');
      const emailIndex = crypto.emailIndex(email);
      await rateLimit(`logincode-email:${emailIndex}`, 5, 60 * MIN); // don't let anyone flood an inbox
      const user = await userByIndex(emailIndex);
      const usable = user && user.status !== 'rejected';
      const out = await startChallenge({
        emailIndex, email, purpose: 'login', decoy: !usable, payload: usable ? { uid: user.id } : null,
      });
      sendJson(res, 200, out);
    },

    'POST /api/auth/verify': async (req, res) => {
      await rateLimit(`verify:${clientIp(req)}`, 30, 15 * MIN);
      const body = await readJson(req);
      const id = requireStr(body.challengeId, 'Challenge', 64);
      const code = requireStr(body.code, 'Code', 12).replace(/\s/g, '');
      const ch = await db.one('SELECT * FROM auth_codes WHERE id = ?', [id]);
      if (!ch) throw new HttpError(400, 'That code has expired. Please start again.');
      if (Number(ch.expires_at) < Date.now()) {
        await db.run('DELETE FROM auth_codes WHERE id = ?', [id]);
        throw new HttpError(400, 'That code has expired. Please start again.');
      }
      if (Number(ch.attempts) >= MAX_CODE_ATTEMPTS) {
        await db.run('DELETE FROM auth_codes WHERE id = ?', [id]);
        throw new HttpError(429, 'Too many wrong codes. Please start again.');
      }
      if (Number(ch.decoy) === 1 || !safeEqual(codeHash(id, code), ch.code_hash)) {
        await db.run('UPDATE auth_codes SET attempts = attempts + 1 WHERE id = ?', [id]);
        throw new HttpError(400, 'Incorrect code');
      }
      await db.run('DELETE FROM auth_codes WHERE id = ?', [id]);
      const payload = JSON.parse(crypto.decrypt(ch.payload_enc, `auth_codes.payload:${id}`));

      let user;
      if (ch.purpose === 'login') {
        user = await db.one('SELECT * FROM users WHERE id = ?', [payload.uid]);
        if (!user || user.status === 'rejected') throw new HttpError(403, 'This account has not been approved');
        await db.run('UPDATE users SET last_login_at = ? WHERE id = ?', [Date.now(), user.id]);
        await db.audit(user.id, 'login.code');
      } else {
        const emailIndex = crypto.emailIndex(payload.email);
        if (await userByIndex(emailIndex)) throw new HttpError(409, 'That email is already registered. Please sign in.');
        const isAdmin = emailIndex === adminIndex;
        const uid = randomId();
        const now = Date.now();
        await db.run(
          `INSERT INTO users (id, email_index, email_enc, password_hash, status, is_admin, session_ver, created_at, approved_at, last_login_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
          [uid, emailIndex, crypto.encrypt(payload.email, `users.email:${uid}`), payload.passwordHash,
            isAdmin ? 'approved' : 'pending', isAdmin ? 1 : 0, now, isAdmin ? now : null, now],
        );
        await db.audit(uid, 'account.created', isAdmin ? 'admin' : 'pending');
        user = await db.one('SELECT * FROM users WHERE id = ?', [uid]);
        if (!isAdmin) {
          mailer.approvalNeeded(adminEmail, payload.email, `${publicUrl}/admin.html#user=${uid}`)
            .catch((err) => console.warn(`[email] admin notification failed: ${err.message}`));
        }
      }
      startSession(res, user);
      sendJson(res, 200, { user: publicUser(user) });
    },

    'POST /api/auth/resend': async (req, res) => {
      await rateLimit(`resend:${clientIp(req)}`, 5, 60 * MIN);
      const body = await readJson(req);
      const id = requireStr(body.challengeId, 'Challenge', 64);
      const ch = await db.one('SELECT * FROM auth_codes WHERE id = ?', [id]);
      if (!ch || Number(ch.expires_at) < Date.now()) throw new HttpError(400, 'That code has expired. Please start again.');
      const code = randomCode();
      await db.run('UPDATE auth_codes SET code_hash = ?, attempts = 0, expires_at = ? WHERE id = ?', [codeHash(id, code), Date.now() + CODE_TTL, id]);
      if (Number(ch.decoy) !== 1) {
        const payload = JSON.parse(crypto.decrypt(ch.payload_enc, `auth_codes.payload:${id}`));
        const email = payload.email ?? crypto.decrypt((await db.one('SELECT email_enc FROM users WHERE id = ?', [payload.uid])).email_enc, `users.email:${payload.uid}`);
        await mailer.code(email, code);
      }
      sendJson(res, 200, { ok: true });
    },

    'POST /api/auth/logout': async (req, res, user) => {
      if (user) await db.audit(user.id, 'logout');
      clearSession(res);
      sendJson(res, 200, { ok: true });
    },

    'GET /api/auth/me': async (req, res, user) => {
      if (!user) throw new HttpError(401, 'Not signed in');
      sendJson(res, 200, { user: publicUser(user) });
    },

    /** Sign out everywhere: bumps the session version so every existing cookie stops working. */
    'POST /api/account/signout-all': async (req, res, user) => {
      if (!user) throw new HttpError(401, 'Not signed in');
      await db.run('UPDATE users SET session_ver = session_ver + 1 WHERE id = ?', [user.id]);
      forget(user.id);
      await db.audit(user.id, 'sessions.revoked');
      clearSession(res);
      sendJson(res, 200, { ok: true });
    },

    'POST /api/account/delete': async (req, res, user) => {
      if (!user) throw new HttpError(401, 'Not signed in');
      const body = await readJson(req);
      if (!(await crypto.verifyPassword(requireStr(body.password, 'Password', 200), user.password_hash))) {
        throw new HttpError(401, 'Wrong password');
      }
      await deleteUser(user.id);
      forget(user.id);
      await db.audit(user.id, 'account.deleted');
      clearSession(res);
      sendJson(res, 200, { ok: true });
    },
  };

  // --- admin ---------------------------------------------------------------------------------------------

  const adminRoutes = {
    'GET /api/admin/users': async (req, res) => {
      const rows = await db.all('SELECT * FROM users ORDER BY created_at DESC');
      sendJson(res, 200, {
        users: rows.map((u) => ({
          id: u.id,
          email: crypto.decrypt(u.email_enc, `users.email:${u.id}`),
          status: u.status,
          isAdmin: Number(u.is_admin) === 1,
          createdAt: Number(u.created_at),
          approvedAt: u.approved_at ? Number(u.approved_at) : null,
          lastLoginAt: u.last_login_at ? Number(u.last_login_at) : null,
        })),
      });
    },

    'POST /api/admin/users/approve': async (req, res, admin) => {
      const { id } = await readJson(req);
      const u = await db.one('SELECT * FROM users WHERE id = ?', [requireStr(id, 'User', 64)]);
      if (!u) throw new HttpError(404, 'No such user');
      await db.run("UPDATE users SET status = 'approved', approved_at = ? WHERE id = ?", [Date.now(), u.id]);
      forget(u.id);
      await db.audit(admin.id, 'admin.approve', u.id);
      mailer.approved(crypto.decrypt(u.email_enc, `users.email:${u.id}`), `${publicUrl}/`)
        .catch((err) => console.warn(`[email] approval email failed: ${err.message}`));
      sendJson(res, 200, { ok: true });
    },

    'POST /api/admin/users/reject': async (req, res, admin) => {
      const { id } = await readJson(req);
      if (id === admin.id) throw new HttpError(400, "You can't reject yourself");
      const n = await db.run("UPDATE users SET status = 'rejected', session_ver = session_ver + 1 WHERE id = ?", [requireStr(id, 'User', 64)]);
      if (!n) throw new HttpError(404, 'No such user');
      forget(id);
      await db.audit(admin.id, 'admin.reject', id);
      sendJson(res, 200, { ok: true });
    },

    'POST /api/admin/users/delete': async (req, res, admin) => {
      const { id } = await readJson(req);
      if (id === admin.id) throw new HttpError(400, "You can't delete your own account here");
      const n = await deleteUser(requireStr(id, 'User', 64));
      if (!n) throw new HttpError(404, 'No such user');
      forget(id);
      await db.audit(admin.id, 'admin.delete', id);
      sendJson(res, 200, { ok: true });
    },
  };

  /** Handle /api/auth, /api/account and /api/admin requests. Returns false if the route isn't ours. */
  async function handle(req, res, url, user) {
    if (Math.random() < 0.05) sweep().catch(() => {});
    const key = `${req.method} ${url.pathname}`;
    if (routes[key]) {
      await routes[key](req, res, user);
      return true;
    }
    if (adminRoutes[key]) {
      if (!user || Number(user.is_admin) !== 1 || user.status !== 'approved') throw new HttpError(403, 'Admins only');
      await adminRoutes[key](req, res, user);
      return true;
    }
    return false;
  }

  return { authenticate, handle, getSettings, saveSettings, publicUser, defaultAirport: () => findAirport('EGGD') };
}
