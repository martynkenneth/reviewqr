// Login through Supabase Auth. Supabase stores the passwords and sends the
// confirm / reset / change-email messages (set its email templates as in
// docs/SETUP.md so links come back to /auth/confirm).
const { admin, anon } = require('../supabase');

const session = (s) => (s ? { access_token: s.access_token, refresh_token: s.refresh_token, expires_in: s.expires_in } : null);
const who = (u) => (u ? { id: u.id, email: u.email } : null);

async function signUp(email, password, redirectTo) {
  const { data, error } = await anon().auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } });
  if (error) {
    if (error.code === 'user_already_exists' || error.code === 'email_exists') return { existing: true };
    return { error: error.message };
  }
  // With email confirmation on, Supabase hides whether the email was already
  // registered: it returns a user with no identities.
  const existing = data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0;
  return { user: who(data.user), session: session(data.session), existing };
}

async function signIn(email, password) {
  const { data, error } = await anon().auth.signInWithPassword({ email, password });
  if (error) return { error: error.code === 'email_not_confirmed' ? 'unconfirmed' : 'invalid' };
  return { user: who(data.user), session: session(data.session) };
}

// Checks an access token. With Supabase's signing keys this happens locally
// (the public keys are cached on this shared client), otherwise it asks Supabase.
let verifier = null;
async function getUserFromToken(accessToken) {
  if (!verifier) verifier = anon();
  try {
    const { data, error } = await verifier.auth.getClaims(accessToken);
    if (error || !data || !data.claims || !data.claims.sub) return null;
    return { id: data.claims.sub, email: data.claims.email };
  } catch {
    return null;
  }
}

async function refresh(refreshToken) {
  const { data, error } = await anon().auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session) return null;
  return { user: who(data.user), session: session(data.session) };
}

async function signOut(accessToken, scope = 'local') {
  await admin().auth.admin.signOut(accessToken, scope).catch(() => {});
}

async function sendPasswordReset(email, redirectTo) {
  await anon().auth.resetPasswordForEmail(email, { redirectTo });
}

// type: 'email' (sign-up), 'recovery' (reset) or 'email_change'
async function verifyOtp(tokenHash, type) {
  const { data, error } = await anon().auth.verifyOtp({ token_hash: tokenHash, type });
  if (error || !data.session) return { error: 'expired' };
  return { user: who(data.user), session: session(data.session) };
}

async function setPassword(userId, password) {
  const { error } = await admin().auth.admin.updateUserById(userId, { password });
  return { error: error && error.message };
}

async function requestEmailChange(tokens, newEmail, redirectTo) {
  const client = anon();
  const set = await client.auth.setSession(tokens);
  if (set.error) return { error: 'Please log in again and retry.' };
  const { error } = await client.auth.updateUser({ email: newEmail }, { emailRedirectTo: redirectTo });
  if (error) return { error: error.code === 'email_exists' ? 'That email is already used by another account.' : error.message };
  return {};
}

async function setBanned(userId, banned) {
  await admin().auth.admin.updateUserById(userId, { ban_duration: banned ? '876000h' : 'none' });
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
};
