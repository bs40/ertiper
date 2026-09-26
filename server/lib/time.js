/** Minutes east of UTC for a time zone at a given instant (e.g. +60 for BST). */
export function tzOffsetMinutes(timeZone, date = new Date()) {
  const name = new Intl.DateTimeFormat('en-GB', { timeZone, timeZoneName: 'shortOffset' })
    .formatToParts(date)
    .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!m) return 0;
  const mins = Number(m[2]) * 60 + Number(m[3] ?? 0);
  return m[1] === '-' ? -mins : mins;
}

/** Calendar parts {year, month, day, hour, minute} of an instant in a time zone. */
export function zonedParts(timeZone, date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date).map((p) => [p.type, p.value]),
  );
  return { year: +parts.year, month: +parts.month, day: +parts.day, hour: +parts.hour, minute: +parts.minute };
}

/** The instant (ms) of a wall-clock time in a time zone. */
export function zonedTime(timeZone, { year, month, day }, hour, minute) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const offset = tzOffsetMinutes(timeZone, new Date(guess));
  return guess - offset * 60_000;
}
