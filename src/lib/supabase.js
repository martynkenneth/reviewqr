// Supabase clients, created only when Supabase is configured.
const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

// The server keeps no session state inside the client: every request passes
// its own tokens, so one visitor's login can never leak into another's.
const OPTIONS = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

let adminClient = null;

// Full-access client (service key) for admin actions and logo storage.
function admin() {
  if (!adminClient) adminClient = createClient(config.supabase.url, config.supabase.serviceKey, OPTIONS);
  return adminClient;
}

// A fresh public client for one login action.
const anon = () => createClient(config.supabase.url, config.supabase.anonKey, OPTIONS);

module.exports = { admin, anon };
