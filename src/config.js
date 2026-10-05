// All settings come from environment variables so the same code runs locally,
// on a test server and in production. See .env.example for the full list.
const path = require('path');
const fs = require('fs');

// Tiny .env loader so there's no extra dependency. Real env vars win.
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const env = process.env;
const isProd = env.NODE_ENV === 'production';
const dataDir = path.resolve(env.DATA_DIR || path.join(__dirname, '..', 'data'));

const config = {
  isProd,
  port: Number(env.PORT || 3000),
  // Public base URL, used inside QR codes and emails. Must be the real domain
  // in production, because it is printed on cards and vans.
  baseUrl: (env.BASE_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ''),
  appName: env.APP_NAME || 'QR Review',
  supportEmail: env.SUPPORT_EMAIL || 'support@qrreview.co.uk',
  // Only used when running without Supabase (local development and tests):
  // the stand-in database and logo folder live here.
  dataDir,
  uploadDir: path.join(dataDir, 'uploads'),
  sessionDays: Number(env.SESSION_DAYS || 60),

  // Supabase: Postgres database, login (Auth) and logo storage. When these
  // are blank the app falls back to local stand-ins so it still runs.
  supabase: {
    url: (env.SUPABASE_URL || '').replace(/\/$/, ''),
    // "anon"/"publishable" key — safe to be public, but we only use it on the server.
    anonKey: env.SUPABASE_ANON_KEY || env.SUPABASE_PUBLISHABLE_KEY || '',
    // "service_role"/"secret" key — full access. Server only, never in the browser.
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '',
  },
  // Supabase → Connect → "Transaction pooler" connection string.
  databaseUrl: env.DATABASE_URL || '',
  // Optional: Supabase's SSL certificate (Database settings → SSL), to fully
  // verify the database connection. Without it the connection is still encrypted.
  databaseCa: env.DATABASE_CA || '',
  trialDays: Number(env.TRIAL_DAYS || 14),
  adminEmails: (env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),

  smtpUrl: env.SMTP_URL || '',
  mailFrom: env.MAIL_FROM || 'QR Review <support@qrreview.co.uk>',

  stripe: {
    secretKey: env.STRIPE_SECRET_KEY || '',
    webhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
  },
};

// Plans are data, not code: change prices or add a plan here (or via env)
// without touching any screen. `priceId` is the Stripe Price to charge.
config.plans = [
  {
    id: 'monthly',
    name: 'Monthly',
    amount: Number(env.PLAN_MONTHLY_AMOUNT || 9.99),
    interval: 'month',
    priceId: env.STRIPE_PRICE_MONTHLY || '',
    blurb: 'Cancel any time',
  },
  {
    id: 'annual',
    name: 'Annual',
    amount: Number(env.PLAN_ANNUAL_AMOUNT || 99),
    interval: 'year',
    priceId: env.STRIPE_PRICE_ANNUAL || '',
    blurb: 'Two months free',
  },
].filter((p) => p.amount > 0);

config.useSupabase = Boolean(config.supabase.url && config.supabase.anonKey && config.supabase.serviceKey);
// Cookies are marked Secure whenever the site is served over https.
config.secureCookies = config.baseUrl.startsWith('https://');

config.currencySymbol = env.CURRENCY_SYMBOL || '£';
config.billingEnabled = Boolean(config.stripe.secretKey && config.plans.some((p) => p.priceId));

module.exports = config;
