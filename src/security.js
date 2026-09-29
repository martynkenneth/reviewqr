// Passwords, sessions, CSRF protection and rate limiting.
const crypto = require('crypto');
const config = require('./config');
const { db, now } = require('./db');

const SESSION_COOKIE = 'rq_session';

// --- Passwords (scrypt, built into Node) ------------------------------------
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64');
  const key = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });
  return crypto.timingSafeEqual(key, expected);
}

// A fixed hash to compare against when the email doesn't exist, so a login
// attempt takes the same time whether or not the account is real.
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < 8) return 'Use at least 8 characters for your password.';
  if (password.length > 200) return 'That password is too long.';
  return null;
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

// --- Sessions ----------------------------------------------------------------
// The cookie holds a random token; the database stores only its hash, so a
// leaked database can't be used to log in.
function createSession(res, userId) {
  const token = randomToken();
  const expires = new Date(Date.now() + config.sessionDays * 864e5);
  db.prepare('INSERT INTO sessions (id, user_id, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').run(
    sha256(token),
    userId,
    randomToken(24),
    now(),
    expires.toISOString(),
  );
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'lax',
    expires,
    path: '/',
  });
}

function destroySession(req, res) {
  const token = req.cookies[SESSION_COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE id = ?').run(sha256(token));
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

function destroyAllSessions(userId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

// Loads req.user (and req.business) for every request that carries a session.
function loadSession(req, res, next) {
  req.user = null;
  req.business = null;
  const token = req.cookies[SESSION_COOKIE];
  if (token) {
    const row = db
      .prepare(
        `SELECT s.csrf_token, s.expires_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.id = ?`,
      )
      .get(sha256(token));
    if (row && row.expires_at > now() && !row.disabled_at) {
      const { csrf_token, expires_at, ...user } = row;
      req.user = user;
      req.csrfToken = csrf_token;
      req.business = db.prepare('SELECT * FROM businesses WHERE user_id = ?').get(user.id) || null;
    } else if (row) {
      db.prepare('DELETE FROM sessions WHERE id = ?').run(sha256(token));
      res.clearCookie(SESSION_COOKIE, { path: '/' });
    }
  }
  // Visitors without a session still need a CSRF token for login/signup forms.
  if (!req.csrfToken) {
    let anon = req.cookies.rq_csrf;
    if (!anon || anon.length < 20) {
      anon = randomToken(24);
      res.cookie('rq_csrf', anon, { httpOnly: true, secure: config.isProd, sameSite: 'lax', path: '/' });
    }
    req.csrfToken = anon;
  }
  res.locals.csrfToken = req.csrfToken;
  next();
}

// Every state-changing request must carry the CSRF token, either as a form
// field or an X-CSRF-Token header (used by fetch() calls).
function verifyCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const sent = String((req.body && req.body._csrf) || req.get('x-csrf-token') || '');
  const ok =
    sent.length === req.csrfToken.length && crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(req.csrfToken));
  if (ok) return next();
  res.status(403).send('This form has expired. Please go back, refresh the page and try again.');
}

function requireUser(req, res, next) {
  if (req.user) return next();
  if (req.accepts(['html', 'json']) === 'json') return res.status(401).json({ error: 'Not logged in' });
  res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
}

// Logged in AND has finished business setup.
function requireBusiness(req, res, next) {
  if (!req.user) return requireUser(req, res, next);
  if (!req.business) return res.redirect('/app/setup');
  next();
}

function requireAdmin(req, res, next) {
  if (req.user && req.user.is_admin) return next();
  res.status(404).send('Not found');
}

// --- Rate limiting (in memory; fine for a single server) ---------------------
function rateLimit({ windowMs, max, key = (req) => req.ip }) {
  const hits = new Map();
  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [k, v] of hits) if (v.start < cutoff) hits.delete(k);
  }, windowMs).unref();
  return (req, res, next) => {
    const k = key(req);
    const t = Date.now();
    let entry = hits.get(k);
    if (!entry || entry.start < t - windowMs) entry = { start: t, count: 0 };
    entry.count++;
    hits.set(k, entry);
    if (entry.count > max) return res.status(429).send('Too many attempts. Please wait a few minutes and try again.');
    next();
  };
}

// Only allow same-site relative paths after login, never "//evil.com".
function safeNext(next, fallback = '/app') {
  return typeof next === 'string' && /^\/(?!\/)[\w\-/?=&.%]*$/.test(next) ? next : fallback;
}

module.exports = {
  hashPassword,
  verifyPassword,
  DUMMY_HASH,
  passwordProblem,
  sha256,
  randomToken,
  createSession,
  destroySession,
  destroyAllSessions,
  loadSession,
  verifyCsrf,
  requireUser,
  requireBusiness,
  requireAdmin,
  rateLimit,
  safeNext,
};
