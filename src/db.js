// SQLite via Node's built-in driver: one file, no database server to run.
// Swap for Postgres later by reimplementing this module's functions.
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.uploadDir, { recursive: true });

const db = new DatabaseSync(process.env.DB_FILE || config.dbFile);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  disabled_at TEXT,
  trial_ends_at TEXT NOT NULL,
  -- trialing | active | past_due | canceled | unpaid | incomplete ... (Stripe's words)
  subscription_status TEXT NOT NULL DEFAULT 'trialing',
  plan_id TEXT,
  current_period_end TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS businesses (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  logo_file TEXT,
  brand_colour TEXT NOT NULL DEFAULT '#0f766e',
  google_review_url TEXT NOT NULL,
  -- Permanent: printed on cards and vans, so it must never change.
  qr_slug TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Visits to the public review page. No customer personal data: the visitor
-- hash is salted per day so it can't follow anyone across days.
CREATE TABLE IF NOT EXISTS qr_visits (
  id INTEGER PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  -- 'view' = review page opened; 'google' = tapped through to Google
  event TEXT NOT NULL DEFAULT 'view',
  -- 'qr' (scanned/opened directly), 'link' (shared link), later 'nfc', 'van'...
  source TEXT,
  visitor_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_visits_business_time ON qr_visits(business_id, created_at);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,           -- sha256 of the cookie value
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS stripe_events (
  id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL
);
`);

const now = () => new Date().toISOString();

function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { db, now, tx };
