// Login sessions, CSRF protection and rate limiting.
//
// Logging in gives the browser two httpOnly cookies from Supabase Auth: a
// short-lived access token and a refresh token. Each request checks the
// access token and quietly refreshes it when it has expired.
const crypto = require('crypto');
const config = require('./config');
const { query, one } = require('./db');
const auth = require('./lib/auth');

const ACCESS_COOKIE = 'qr_at';
const REFRESH_COOKIE = 'qr_rt';
const CSRF_COOKIE = 'qr_csrf';

const cookieOpts = (maxAge) => ({ httpOnly: true, secure: config.secureCookies, sameSite: 'lax', path: '/', maxAge });

function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < 8) return 'Use at least 8 characters for your password.';
  if (password.length > 72) return 'That password is too long (72 characters at most).';
  return null;
}

const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

// The visitor's real IP. Netlify passes it in its own header.
const clientIp = (req) => req.get('x-nf-client-connection-ip') || req.ip;

// newLogin: also issue a fresh CSRF token. Only for real logins (which then
// redirect), never for a background refresh mid-page.
function setSessionCookies(res, session, { newLogin = false } = {}) {
  res.cookie(ACCESS_COOKIE, session.access_token, cookieOpts((session.expires_in || 3600) * 1000));
  res.cookie(REFRESH_COOKIE, session.refresh_token, cookieOpts(config.sessionDays * 864e5));
  if (newLogin) res.cookie(CSRF_COOKIE, randomToken(24), cookieOpts(undefined));
}

function clearSessionCookies(res) {
  res.clearCookie(ACCESS_COOKIE, { path: '/' });
  res.clearCookie(REFRESH_COOKIE, { path: '/' });
}

async function logOut(req, res) {
  const token = req.cookies[ACCESS_COOKIE];
  if (token) await auth.signOut(token);
  clearSessionCookies(res);
}

// Every business owner has a profile row holding their trial and
// subscription. It is created the first time they're seen.
async function profileFor(authUser) {
  let p = await one('SELECT * FROM profiles WHERE id = $1', [authUser.id]);
  if (!p) {
    const trialEnds = new Date(Date.now() + config.trialDays * 864e5).toISOString();
    const isAdmin = config.adminEmails.includes(String(authUser.email).toLowerCase());
    await query(
      'INSERT INTO profiles (id, email, trial_ends_at, is_admin) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING',
      [authUser.id, authUser.email, trialEnds, isAdmin],
    );
    p = await one('SELECT * FROM profiles WHERE id = $1', [authUser.id]);
  } else if (authUser.email && p.email !== authUser.email) {
    // They changed their email through a confirmation link.
    await query('UPDATE profiles SET email = $1 WHERE id = $2', [authUser.email, p.id]);
    p.email = authUser.email;
  }
  if (!p.is_admin && config.adminEmails.includes(String(p.email).toLowerCase())) {
    await query('UPDATE profiles SET is_admin = true WHERE id = $1', [p.id]);
    p.is_admin = true;
  }
  return p;
}

// Loads req.user (the profile) and req.business for every request.
async function loadSession(req, res, next) {
  try {
    req.user = null;
    req.business = null;
    let access = req.cookies[ACCESS_COOKIE];
    let refresh = req.cookies[REFRESH_COOKIE];
    let authUser = access ? await auth.getUserFromToken(access) : null;
    if (!authUser && refresh) {
      const r = await auth.refresh(refresh);
      if (r) {
        setSessionCookies(res, r.session);
        ({ access_token: access, refresh_token: refresh } = r.session);
        authUser = r.user;
      } else clearSessionCookies(res);
    }
    if (authUser) {
      const profile = await profileFor(authUser);
      if (profile.disabled_at) clearSessionCookies(res);
      else {
        req.user = profile;
        req.tokens = { access_token: access, refresh_token: refresh };
        req.business = await one('SELECT * FROM businesses WHERE user_id = $1', [profile.id]);
      }
    }

    // CSRF: a random value in an httpOnly cookie, repeated in every form.
    // Another site can neither read the cookie nor guess the value.
    let csrf = req.cookies[CSRF_COOKIE];
    if (!csrf || csrf.length < 20) {
      csrf = randomToken(24);
      res.cookie(CSRF_COOKIE, csrf, cookieOpts(undefined));
    }
    req.csrfToken = csrf;
    res.locals.csrfToken = csrf;
    next();
  } catch (e) {
    next(e);
  }
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

// --- Rate limiting -----------------------------------------------------------
// In memory, so on Netlify each running copy of the app counts separately.
// Supabase Auth has its own limits on logins and emails behind this.
function rateLimit({ windowMs, max, key = clientIp }) {
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
  passwordProblem,
  randomToken,
  clientIp,
  setSessionCookies,
  clearSessionCookies,
  logOut,
  profileFor,
  loadSession,
  verifyCsrf,
  requireUser,
  requireBusiness,
  requireAdmin,
  rateLimit,
  safeNext,
};
