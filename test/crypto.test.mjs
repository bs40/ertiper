// Tests for the security-critical helpers. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createCrypto, randomCode, safeEqual } from '../server/auth/crypto.js';

const c = createCrypto({ sessionSecret: 'x'.repeat(40), dataKey: crypto.randomBytes(32).toString('base64') });

test('field encryption round-trips and is randomised', () => {
  const a = c.encrypt('someone@example.com', 'users.email:1');
  const b = c.encrypt('someone@example.com', 'users.email:1');
  assert.notEqual(a, b);
  assert.equal(c.decrypt(a, 'users.email:1'), 'someone@example.com');
  assert.ok(!a.includes('someone'));
});

test('ciphertext cannot be moved to another field or user', () => {
  const a = c.encrypt('secret', 'users.email:1');
  assert.throws(() => c.decrypt(a, 'users.email:2'));
  assert.throws(() => c.decrypt(a, 'user_settings:1'));
});

test('tampered ciphertext is rejected', () => {
  const [v, iv, ct, tag] = c.encrypt('secret', 'ctx').split('.');
  const flipped = Buffer.from(ct, 'base64url');
  flipped[0] ^= 1;
  assert.throws(() => c.decrypt([v, iv, flipped.toString('base64url'), tag].join('.'), 'ctx'));
});

test('a different DATA_KEY cannot decrypt', () => {
  const other = createCrypto({ sessionSecret: 'x'.repeat(40), dataKey: crypto.randomBytes(32).toString('base64') });
  assert.throws(() => other.decrypt(c.encrypt('secret', 'ctx'), 'ctx'));
});

test('email index is case-insensitive, stable and not the email', () => {
  assert.equal(c.emailIndex('A@B.com '), c.emailIndex('a@b.com'));
  assert.ok(!c.emailIndex('a@b.com').includes('a@b'));
});

test('passwords hash with PBKDF2 and verify', async () => {
  const h = await c.hashPassword('correct horse battery');
  assert.match(h, /^pbkdf2\$600000\$/);
  assert.equal(await c.verifyPassword('correct horse battery', h), true);
  assert.equal(await c.verifyPassword('wrong', h), false);
});

test('sessions verify, expire, and reject tampering', () => {
  const t = c.makeSession('u1', 3, 60_000);
  assert.deepEqual({ ...c.readSession(t), exp: 0 }, { uid: 'u1', ver: 3, exp: 0 });
  const [body, sig] = t.split('.');
  const forged = Buffer.from(JSON.stringify({ uid: 'admin', ver: 3, exp: Date.now() + 1e9 })).toString('base64url');
  assert.equal(c.readSession(`${forged}.${sig}`), null);
  assert.equal(c.readSession(`${body}.x${sig.slice(1)}`), null);
  assert.equal(c.readSession(c.makeSession('u1', 1, -1)), null);
});

test('weak secrets are refused', () => {
  assert.throws(() => createCrypto({ sessionSecret: 'short', dataKey: crypto.randomBytes(32).toString('base64') }));
  assert.throws(() => createCrypto({ sessionSecret: 'x'.repeat(40), dataKey: 'too-short' }));
});

test('codes are six digits; safeEqual compares correctly', () => {
  for (let i = 0; i < 200; i++) assert.match(randomCode(), /^\d{6}$/);
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
});
