// Bunny Database (libSQL) access for the multi-user edition. Also works against a local file
// (DATABASE_URL=file:local.db) for development.
//
// Personal data is encrypted by the application before it reaches the database:
//   users.email_enc, auth_codes.payload_enc, user_settings.data_enc  AES-256-GCM (see auth/crypto.js)
//   users.email_index, auth_codes.email_index                         keyed HMAC, for lookups only
//   users.password_hash                                               PBKDF2, never reversible
// Remote databases (Bunny Database) use the pure-JavaScript HTTP client, as ProcrastiMate does, so
// no native module runs in the container; only local file databases need the full client.
async function createClient(opts) {
  const mod = opts.url.startsWith('file:') ? await import('@libsql/client') : await import('@libsql/client/web');
  return mod.createClient(opts);
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     id TEXT PRIMARY KEY,
     email_index TEXT NOT NULL UNIQUE,
     email_enc TEXT NOT NULL,
     password_hash TEXT NOT NULL,
     status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
     is_admin INTEGER NOT NULL DEFAULT 0,
     session_ver INTEGER NOT NULL DEFAULT 1,
     created_at INTEGER NOT NULL,
     approved_at INTEGER,
     last_login_at INTEGER
   )`,
  `CREATE TABLE IF NOT EXISTS auth_codes (
     id TEXT PRIMARY KEY,
     email_index TEXT NOT NULL,
     purpose TEXT NOT NULL CHECK (purpose IN ('register', 'login')),
     code_hash TEXT NOT NULL,
     payload_enc TEXT,
     decoy INTEGER NOT NULL DEFAULT 0,
     attempts INTEGER NOT NULL DEFAULT 0,
     expires_at INTEGER NOT NULL,
     created_at INTEGER NOT NULL
   )`,
  'CREATE INDEX IF NOT EXISTS auth_codes_email ON auth_codes (email_index)',
  `CREATE TABLE IF NOT EXISTS rate_limits (
     bucket TEXT PRIMARY KEY,
     count INTEGER NOT NULL,
     reset_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS user_settings (
     user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
     data_enc TEXT NOT NULL,
     version INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS quotas (
     name TEXT NOT NULL,
     period TEXT NOT NULL,
     used INTEGER NOT NULL,
     PRIMARY KEY (name, period)
   )`,
  `CREATE TABLE IF NOT EXISTS timetables (
     airport TEXT PRIMARY KEY,
     source TEXT NOT NULL,
     fetched_at INTEGER NOT NULL,
     data TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS audit_log (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     at INTEGER NOT NULL,
     user_id TEXT,
     action TEXT NOT NULL,
     detail TEXT
   )`,
];

export async function openDatabase(url, authToken) {
  const client = await createClient({ url, authToken });
  // Enforced per connection on local files; remote libSQL enforces foreign keys by default.
  await client.execute('PRAGMA foreign_keys = ON').catch(() => {});
  for (const sql of SCHEMA) await client.execute(sql);

  const db = {
    client,
    async all(sql, args = []) {
      return (await client.execute({ sql, args })).rows;
    },
    async one(sql, args = []) {
      return (await client.execute({ sql, args })).rows[0] ?? null;
    },
    async run(sql, args = []) {
      return (await client.execute({ sql, args })).rowsAffected;
    },
    async batch(statements) {
      return client.batch(statements.map(([sql, args]) => ({ sql, args })), 'write');
    },
    /** Audit trail of account events; holds user ids, never email addresses. */
    async audit(userId, action, detail = null) {
      await client.execute({ sql: 'INSERT INTO audit_log (at, user_id, action, detail) VALUES (?, ?, ?, ?)', args: [Date.now(), userId, action, detail] });
    },
  };
  return db;
}

/** Shared-state store for timetables and API quotas, backed by the database. */
export function databaseStore(db) {
  return {
    async usage(name, period) {
      return Number((await db.one('SELECT used FROM quotas WHERE name = ? AND period = ?', [name, period]))?.used ?? 0);
    },
    async addUsage(name, period, n) {
      await db.run(
        'INSERT INTO quotas (name, period, used) VALUES (?, ?, ?) ON CONFLICT (name, period) DO UPDATE SET used = used + excluded.used',
        [name, period, n],
      );
    },
    async getTimetable(airport) {
      const row = await db.one('SELECT source, fetched_at, data FROM timetables WHERE airport = ?', [airport]);
      return row ? { source: row.source, fetchedAt: Number(row.fetched_at), flights: JSON.parse(row.data) } : null;
    },
    async putTimetable(airport, source, fetchedAt, flights) {
      await db.run(
        `INSERT INTO timetables (airport, source, fetched_at, data) VALUES (?, ?, ?, ?)
         ON CONFLICT (airport) DO UPDATE SET source = excluded.source, fetched_at = excluded.fetched_at, data = excluded.data`,
        [airport, source, fetchedAt, JSON.stringify(flights)],
      );
    },
  };
}
