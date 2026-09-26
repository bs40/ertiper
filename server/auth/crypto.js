// Cryptography for accounts, modelled on ProcrastiMate (PBKDF2 passwords, HMAC-signed sessions,
// AES-256-GCM field encryption, HMAC lookup index for emails) using Node's built-in crypto.
//
// Keys:
//   SESSION_SECRET  signs session cookies and emailed codes
//   DATA_KEY        32 random bytes (base64). Separate sub-keys are derived with HKDF for
//                   encryption and for the email lookup index. Losing it makes stored emails and
//                   home locations unreadable, so keep a safe copy.
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const pbkdf2 = promisify(crypto.pbkdf2);
const PBKDF2_ITERATIONS = 600_000; // OWASP 2023 guidance for PBKDF2-HMAC-SHA256
const b64url = (buf) => Buffer.from(buf).toString('base64url');
const unb64url = (s) => Buffer.from(s, 'base64url');

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function createCrypto({ sessionSecret, dataKey }) {
  if (!sessionSecret || Buffer.byteLength(sessionSecret) < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
  const master = Buffer.from(dataKey ?? '', 'base64');
  if (master.length < 32) throw new Error('DATA_KEY must be 32 random bytes, base64-encoded');

  const derive = (info) => Buffer.from(crypto.hkdfSync('sha256', master, Buffer.alloc(0), info, 32));
  const encKey = derive('ertiper/field-encryption/v1');
  const indexKey = derive('ertiper/lookup-index/v1');
  const signKey = Buffer.from(sessionSecret);
  const hmac = (key, value) => crypto.createHmac('sha256', key).update(String(value)).digest();

  return {
    /** AES-256-GCM. `context` is bound as associated data so a value can't be moved to another field. */
    encrypt(plain, context) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv);
      cipher.setAAD(Buffer.from(context));
      const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
      return `v1.${b64url(iv)}.${b64url(ct)}.${b64url(cipher.getAuthTag())}`;
    },

    decrypt(value, context) {
      const [v, iv, ct, tag] = String(value).split('.');
      if (v !== 'v1' || !iv || !ct || !tag) throw new Error('Unrecognised ciphertext');
      const decipher = crypto.createDecipheriv('aes-256-gcm', encKey, unb64url(iv));
      decipher.setAAD(Buffer.from(context));
      decipher.setAuthTag(unb64url(tag));
      return Buffer.concat([decipher.update(unb64url(ct)), decipher.final()]).toString('utf8');
    },

    /** Deterministic keyed hash for looking up an email without storing it in the clear. */
    emailIndex(email) {
      return `ix_${b64url(hmac(indexKey, String(email).trim().toLowerCase()))}`;
    },

    /** HMAC under SESSION_SECRET, used for emailed codes. */
    sign(value) {
      return b64url(hmac(signKey, value));
    },

    async hashPassword(password) {
      const salt = crypto.randomBytes(16);
      const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS, 32, 'sha256');
      return `pbkdf2$${PBKDF2_ITERATIONS}$${b64url(salt)}$${b64url(hash)}`;
    },

    async verifyPassword(password, stored) {
      const [scheme, iters, salt, hash] = String(stored).split('$');
      if (scheme !== 'pbkdf2' || !iters || !salt || !hash) return false;
      const expected = unb64url(hash);
      const actual = await pbkdf2(password, unb64url(salt), Number(iters), expected.length, 'sha256');
      return crypto.timingSafeEqual(actual, expected);
    },

    /** Stateless signed session token; `ver` lets the server revoke all of a user's sessions. */
    makeSession(uid, ver, ttlMs) {
      const body = b64url(JSON.stringify({ uid, ver, exp: Date.now() + ttlMs }));
      return `${body}.${b64url(hmac(signKey, `session:${body}`))}`;
    },

    readSession(token) {
      const [body, sig] = String(token ?? '').split('.');
      if (!body || !sig || !safeEqual(sig, b64url(hmac(signKey, `session:${body}`)))) return null;
      try {
        const data = JSON.parse(unb64url(body).toString('utf8'));
        return data.exp > Date.now() ? data : null;
      } catch {
        return null;
      }
    },
  };
}

/** Unbiased 6-digit code. */
export const randomCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
export const randomId = () => crypto.randomUUID();
