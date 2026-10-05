// Database access. In production this is Supabase Postgres (DATABASE_URL).
// Without DATABASE_URL — local development and tests — it uses PGlite, a real
// Postgres that runs inside Node, so the same SQL runs in both places.
const fs = require('fs');
const path = require('path');
const config = require('./config');

let dbPromise = null;

function readSql(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'db', name), 'utf8');
}

async function connect() {
  if (config.databaseUrl) {
    const { Pool } = require('pg');
    return new Pool({
      connectionString: config.databaseUrl,
      // Serverless functions are short-lived: keep few connections and let
      // Supabase's pooler do the pooling.
      max: 3,
      idleTimeoutMillis: 10000,
      ssl: config.databaseCa ? { ca: config.databaseCa } : { rejectUnauthorized: false },
    });
  }
  // The package name is kept out of a literal require so hosting bundlers
  // don't pack this development-only database into production.
  const pgliteName = '@electric-sql/pglite';
  const { PGlite } = require(pgliteName);
  const memory = process.env.DB_FILE === ':memory:';
  if (!memory) fs.mkdirSync(config.dataDir, { recursive: true });
  const db = new PGlite(memory ? undefined : path.join(config.dataDir, 'pglite'));
  await db.exec(readSql('local-auth.sql'));
  await db.exec(readSql('schema.sql'));
  return db;
}

function getDb() {
  if (!dbPromise) {
    dbPromise = connect().catch((e) => {
      dbPromise = null;
      throw e;
    });
  }
  return dbPromise;
}

// Dates come back as ISO strings, the same from both drivers.
function normalise(rows) {
  for (const row of rows) {
    for (const k of Object.keys(row)) if (row[k] instanceof Date) row[k] = row[k].toISOString();
  }
  return rows;
}

async function query(sql, params = []) {
  const db = await getDb();
  const r = await db.query(sql, params);
  return normalise(r.rows);
}

const one = async (sql, params) => (await query(sql, params))[0] || null;

const now = () => new Date().toISOString();

module.exports = { query, one, now, getDb };
