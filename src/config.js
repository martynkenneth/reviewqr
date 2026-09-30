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
  appName: env.APP_NAME || 'ReviewQR',
  supportEmail: env.SUPPORT_EMAIL || 'support@example.com',
  dataDir,
  dbFile: path.join(dataDir, 'app.db'),
  uploadDir: path.join(dataDir, 'uploads'),
  sessionDays: Number(env.SESSION_DAYS || 60),
  trialDays: Number(env.TRIAL_DAYS || 14),
  adminEmails: (env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),

  smtpUrl: env.SMTP_URL || '',
  mailFrom: env.MAIL_FROM || 'ReviewQR <no-reply@example.com>',

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

config.currencySymbol = env.CURRENCY_SYMBOL || '£';
config.billingEnabled = Boolean(config.stripe.secretKey && config.plans.some((p) => p.priceId));

module.exports = config;
