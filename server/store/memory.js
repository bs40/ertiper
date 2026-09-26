// In-memory timetable/quota store for the single-user (Windows / local) edition.
// Kept separate from db.js so the single-user edition needs no npm packages.
export function memoryStore() {
  const quotas = new Map();
  const timetables = new Map();
  return {
    async usage(name, period) {
      return quotas.get(`${name}|${period}`) ?? 0;
    },
    async addUsage(name, period, n) {
      quotas.set(`${name}|${period}`, (quotas.get(`${name}|${period}`) ?? 0) + n);
    },
    async getTimetable(airport) {
      return timetables.get(airport) ?? null;
    },
    async putTimetable(airport, source, fetchedAt, flights) {
      timetables.set(airport, { source, fetchedAt, flights });
    },
  };
}
