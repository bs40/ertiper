// Aviationstack labels local times as UTC ("+00:00"); check they're re-read in the airport's zone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zonedTime } from '../server/lib/time.js';

test('BST wall time is converted to the right instant', () => {
  // 26 Sep 2026 13:30 in London (BST, UTC+1) is 12:30 UTC.
  const ms = zonedTime('Europe/London', { year: 2026, month: 9, day: 26 }, 13, 30);
  assert.equal(new Date(ms).toISOString(), '2026-09-26T12:30:00.000Z');
});

test('CEST wall time is converted to the right instant', () => {
  // 17:00 in Alicante (CEST, UTC+2) is 15:00 UTC.
  const ms = zonedTime('Europe/Madrid', { year: 2026, month: 9, day: 26 }, 17, 0);
  assert.equal(new Date(ms).toISOString(), '2026-09-26T15:00:00.000Z');
});

test('GMT wall time in winter', () => {
  const ms = zonedTime('Europe/London', { year: 2026, month: 12, day: 1 }, 9, 0);
  assert.equal(new Date(ms).toISOString(), '2026-12-01T09:00:00.000Z');
});
