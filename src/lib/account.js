// Subscription/trial status in plain terms, used by every screen that needs
// to know whether an account is paid up.
const crypto = require('crypto');
const config = require('../config');
const { db } = require('../db');

const PAID = new Set(['active']);
// Stripe keeps retrying failed payments for a while; don't lock people out
// the moment a card declines.
const GRACE = new Set(['past_due']);

function trialDaysLeft(user) {
  return Math.max(0, Math.ceil((new Date(user.trial_ends_at) - Date.now()) / 864e5));
}

// 'trial' | 'active' | 'past_due' | 'expired'
function accessState(user) {
  if (PAID.has(user.subscription_status)) return 'active';
  // Subscribed during the free trial: Stripe calls it 'trialing' until the
  // first payment, but they've committed, so treat it as a paid plan.
  if (user.stripe_subscription_id && user.subscription_status === 'trialing') return 'active';
  if (GRACE.has(user.subscription_status)) return 'past_due';
  if (user.subscription_status === 'trialing' && new Date(user.trial_ends_at) > new Date()) return 'trial';
  // A cancelled subscription keeps working until the end of the paid period.
  if (user.subscription_status === 'canceled' && user.current_period_end && new Date(user.current_period_end) > new Date()) {
    return 'active';
  }
  return 'expired';
}

const hasAccess = (user) => accessState(user) !== 'expired';

// Should the public review page send customers to Google? Only while the
// account is on its trial or paid up. When the trial ends without a plan,
// the QR code stops working until they subscribe.
const qrIsLive = (user) => !user.disabled_at && hasAccess(user);

const planById = (id) => config.plans.find((p) => p.id === id) || null;

// Short, permanent, easy to read aloud: no 0/O, 1/l/i.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
function newSlug() {
  for (;;) {
    let s = '';
    const bytes = crypto.randomBytes(7);
    for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
    if (!db.prepare('SELECT 1 FROM businesses WHERE qr_slug = ?').get(s)) return s;
  }
}

module.exports = { trialDaysLeft, accessState, hasAccess, qrIsLive, planById, newSlug };
