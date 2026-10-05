// A stand-in for Supabase Auth, used only for local development and tests
// (when SUPABASE_* isn't set). It behaves like Supabase from the app's point
// of view: same functions, same one-time email links to /auth/confirm.
const crypto = require('crypto');
const { query, one, now } = require('../../db');
const { sendMail } = require('../mailer');

const SECRET = process.env.LOCAL_AUTH_SECRET || crypto.randomBytes(32).toString('hex');
const ACCESS_SECONDS = 3600;
const REFRESH_SECONDS = 60 * 864e2;

// Every "email" this driver sends, so tests can follow the links.
const outbox = [];

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64);
  return `${salt.toString('base64')}$${key.toString('base64')}`;
}

function checkPassword(password, stored) {
  const [salt, key] = String(stored).split('$');
  const expected = Buffer.from(key || '', 'base64');
  const got = crypto.scryptSync(String(password), Buffer.from(salt || '', 'base64'), 64);
  return expected.length === got.length && crypto.timingSafeEqual(expected, got);
}

// Signed, self-contained tokens (like a JWT, simplified).
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verify(token, type) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const p = JSON.parse(Buffer.from(body, 'base64url').toString());
  return p.type === type && p.exp > Date.now() / 1000 ? p : null;
}

function makeSession(user) {
  const t = Math.floor(Date.now() / 1000);
  return {
    access_token: sign({ type: 'access', sub: user.id, email: user.email, exp: t + ACCESS_SECONDS }),
    refresh_token: sign({ type: 'refresh', sub: user.id, exp: t + REFRESH_SECONDS, n: crypto.randomBytes(8).toString('hex') }),
    expires_in: ACCESS_SECONDS,
  };
}

const who = (u) => ({ id: u.id, email: u.email });

async function sendLink(user, type, redirectTo, { to = user.email, newEmail = null } = {}) {
  const token = crypto.randomBytes(24).toString('base64url');
  await query('INSERT INTO auth.local_otps (token_hash, user_id, type, new_email, expires_at) VALUES ($1, $2, $3, $4, $5)', [
    sha256(token),
    user.id,
    type,
    newEmail,
    new Date(Date.now() + 3600e3).toISOString(),
  ]);
  const base = new URL(redirectTo).origin;
  const link = `${base}/auth/confirm?token_hash=${token}&type=${type}`;
  outbox.push({ to, type, link });
  await sendMail({ to, subject: `[local] ${type} link`, text: link });
}

async function signUp(email, password, redirectTo) {
  if (await one('SELECT 1 FROM auth.users WHERE email = $1', [email])) return { existing: true };
  const confirm = process.env.LOCAL_CONFIRM_EMAIL === '1';
  const user = await one(
    'INSERT INTO auth.users (email, password_hash, email_confirmed_at) VALUES ($1, $2, $3) RETURNING id, email',
    [email, hashPassword(password), confirm ? null : now()],
  );
  if (confirm) {
    await sendLink(user, 'email', redirectTo);
    return { user: who(user), session: null };
  }
  return { user: who(user), session: makeSession(user) };
}

async function signIn(email, password) {
  const user = await one('SELECT * FROM auth.users WHERE email = $1', [email]);
  if (!user || !checkPassword(password, user.password_hash) || user.banned) return { error: 'invalid' };
  if (!user.email_confirmed_at) return { error: 'unconfirmed' };
  return { user: who(user), session: makeSession(user) };
}

async function getUserFromToken(accessToken) {
  const p = verify(accessToken, 'access');
  return p ? { id: p.sub, email: p.email } : null;
}

async function refresh(refreshToken) {
  const p = verify(refreshToken, 'refresh');
  if (!p) return null;
  const user = await one('SELECT * FROM auth.users WHERE id = $1 AND NOT banned', [p.sub]);
  return user ? { user: who(user), session: makeSession(user) } : null;
}

// Local tokens can't be revoked early; they simply expire.
async function signOut() {}

async function sendPasswordReset(email, redirectTo) {
  const user = await one('SELECT * FROM auth.users WHERE email = $1', [email]);
  if (user) await sendLink(user, 'recovery', redirectTo);
}

async function verifyOtp(tokenHash, type) {
  const row = await one(
    'SELECT * FROM auth.local_otps WHERE token_hash = $1 AND type = $2 AND used_at IS NULL AND expires_at > now()',
    [sha256(String(tokenHash)), type],
  );
  if (!row) return { error: 'expired' };
  await query('UPDATE auth.local_otps SET used_at = now() WHERE token_hash = $1', [row.token_hash]);
  if (type === 'email') await query('UPDATE auth.users SET email_confirmed_at = now() WHERE id = $1', [row.user_id]);
  if (type === 'email_change') await query('UPDATE auth.users SET email = $1 WHERE id = $2', [row.new_email, row.user_id]);
  const user = await one('SELECT * FROM auth.users WHERE id = $1', [row.user_id]);
  return { user: who(user), session: makeSession(user) };
}

async function setPassword(userId, password) {
  await query('UPDATE auth.users SET password_hash = $1 WHERE id = $2', [hashPassword(password), userId]);
  return {};
}

async function requestEmailChange(tokens, newEmail, redirectTo) {
  const p = verify(tokens.access_token, 'access');
  if (!p) return { error: 'Please log in again and retry.' };
  if (await one('SELECT 1 FROM auth.users WHERE email = $1', [newEmail])) {
    return { error: 'That email is already used by another account.' };
  }
  await sendLink({ id: p.sub, email: p.email }, 'email_change', redirectTo, { to: newEmail, newEmail });
  return {};
}

async function setBanned(userId, banned) {
  await query('UPDATE auth.users SET banned = $1 WHERE id = $2', [banned, userId]);
}

module.exports = {
  signUp,
  signIn,
  getUserFromToken,
  refresh,
  signOut,
  sendPasswordReset,
  verifyOtp,
  setPassword,
  requestEmailChange,
  setBanned,
  outbox,
};
