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

// When did access end? Used to give printed QR codes a grace period.
function accessEndedAt(user) {
  const ends = [user.trial_ends_at, user.current_period_end].filter(Boolean).map((d) => new Date(d));
  return new Date(Math.max(...ends.map(Number)));
}

// Should the public review page still send customers to Google?
function qrIsLive(user) {
  if (user.disabled_at) return false;
  if (hasAccess(user)) return true;
  return Date.now() - accessEndedAt(user) < config.qrGraceDays * 864e5;
}

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
