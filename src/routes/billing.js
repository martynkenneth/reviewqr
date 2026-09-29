// Subscriptions through Stripe. Card details only ever go to Stripe (Checkout
// and the Billing Portal are Stripe-hosted pages); we store IDs and status.
const express = require('express');
const Stripe = require('stripe');
const config = require('../config');
const { db, now } = require('../db');
const { html } = require('../html');
const { appPage } = require('../views/layout');
const { icon } = require('../views/icons');
const { sendMail } = require('../lib/mailer');
const account = require('../lib/account');
const sec = require('../security');

const router = express.Router();
const stripe = config.stripe.secretKey ? new Stripe(config.stripe.secretKey) : null;

const toIso = (unix) => (unix ? new Date(unix * 1000).toISOString() : null);
const planForPrice = (priceId) => config.plans.find((p) => p.priceId === priceId) || null;

// Copies a Stripe subscription onto our user row. Called from webhooks and
// straight after checkout, so the screen is right even if a webhook is slow.
function syncSubscription(sub) {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  let user = db.prepare('SELECT * FROM users WHERE stripe_customer_id = ?').get(customerId);
  if (!user && sub.metadata && sub.metadata.user_id) {
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(sub.metadata.user_id));
  }
  if (!user) return null;
  // An old, replaced subscription finishing shouldn't overwrite the new one.
  if (user.stripe_subscription_id && user.stripe_subscription_id !== sub.id && sub.status === 'canceled') return user;

  const item = sub.items && sub.items.data && sub.items.data[0];
  const plan = item ? planForPrice(item.price.id) : null;
  const periodEnd = sub.current_period_end || (item && item.current_period_end);
  db.prepare(
    `UPDATE users SET stripe_customer_id = ?, stripe_subscription_id = ?, subscription_status = ?, plan_id = ?,
       current_period_end = ?, cancel_at_period_end = ? WHERE id = ?`,
  ).run(
    customerId,
    sub.id,
    sub.status,
    plan ? plan.id : user.plan_id,
    toIso(periodEnd),
    sub.cancel_at_period_end || sub.cancel_at ? 1 : 0,
    user.id,
  );
  return user;
}

async function customerFor(user) {
  if (user.stripe_customer_id) return user.stripe_customer_id;
  const c = await stripe.customers.create({ email: user.email, metadata: { user_id: String(user.id) } });
  db.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?').run(c.id, user.id);
  return c.id;
}

const money = (n) => `${config.currencySymbol}${Number.isInteger(n) ? n : n.toFixed(2)}`;

router.get('/', sec.requireUser, (req, res) => {
  const u = req.user;
  const state = account.accessState(u);
  const subscribed = u.stripe_subscription_id && ['active', 'trialing', 'past_due'].includes(u.subscription_status);
  const trialLeft = state === 'trial' ? account.trialDaysLeft(u) : 0;
  res.send(
    appPage({
      req,
      title: 'Plans',
      active: 'settings',
      back: '/app/settings',
      body: html`${req.query.expired ? html`<p class="alert alert-warn">Your free trial has ended. Choose a plan to keep using your review QR.</p>` : ''}
        ${req.query.error ? html`<p class="alert alert-error">Something went wrong starting the payment. Please try again.</p>` : ''}
        <h1>Choose your plan</h1>
        ${subscribed
          ? html`<p>You're already subscribed. Change plan, update your card or cancel in the billing portal.</p>
              <form method="post" action="/app/billing/portal">
                <input type="hidden" name="_csrf" value="${req.csrfToken}" />
                <button class="btn btn-block btn-large" type="submit">Manage Subscription</button>
              </form>`
          : !config.billingEnabled
            ? html`<p class="alert alert-warn">Online payments aren't switched on yet. Please contact <a href="mailto:${config.supportEmail}">${config.supportEmail}</a>.</p>`
            : html`${trialLeft
                  ? html`<p class="muted">You won't be charged until your free trial ends in ${trialLeft} day${trialLeft === 1 ? '' : 's'}.</p>`
                  : ''}
                <div class="pricing">
                  ${config.plans
                    .filter((p) => p.priceId)
                    .map(
                      (p) => html`<form method="post" action="/app/billing/checkout" class="price-card ${p.interval === 'year' ? 'is-highlight' : ''}">
                        <input type="hidden" name="_csrf" value="${req.csrfToken}" />
                        <input type="hidden" name="plan" value="${p.id}" />
                        <h3>${p.name}</h3>
                        <p class="price">${money(p.amount)}<span>/${p.interval}</span></p>
                        <p class="muted">${p.blurb}</p>
                        <button class="btn btn-block" type="submit">Choose ${p.name}</button>
                      </form>`,
                    )}
                </div>
                <p class="muted small center">${icon('check')} Secure payment by Stripe. Cancel any time.</p>`}`,
    }),
  );
});

router.post('/checkout', sec.requireUser, async (req, res, next) => {
  try {
    const plan = config.plans.find((p) => p.id === req.body.plan && p.priceId);
    if (!stripe || !plan) return res.redirect('/app/billing?error=1');
    const customer = await customerFor(req.user);
    const subscription_data = { metadata: { user_id: String(req.user.id) } };
    // Keep the rest of their free trial: Stripe needs the end at least 48h away.
    const trialEnd = Math.floor(new Date(req.user.trial_ends_at) / 1000);
    if (trialEnd > Date.now() / 1000 + 48 * 3600 && !req.user.stripe_subscription_id) subscription_data.trial_end = trialEnd;
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer,
      client_reference_id: String(req.user.id),
      line_items: [{ price: plan.priceId, quantity: 1 }],
      subscription_data,
      allow_promotion_codes: true,
      success_url: `${config.baseUrl}/app/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${config.baseUrl}/app/billing`,
    });
    res.redirect(303, session.url);
  } catch (e) {
    next(e);
  }
});

router.get('/success', sec.requireUser, async (req, res, next) => {
  try {
    if (stripe && typeof req.query.session_id === 'string') {
      const s = await stripe.checkout.sessions.retrieve(req.query.session_id, { expand: ['subscription'] });
      if (s.client_reference_id === String(req.user.id) && s.subscription && typeof s.subscription === 'object') {
        syncSubscription(s.subscription);
      }
    }
    res.redirect(req.business ? '/app/settings?notice=subscribed' : '/app/setup');
  } catch (e) {
    next(e);
  }
});

router.post('/portal', sec.requireUser, async (req, res, next) => {
  try {
    if (!stripe || !req.user.stripe_customer_id) return res.redirect('/app/billing');
    const s = await stripe.billingPortal.sessions.create({
      customer: req.user.stripe_customer_id,
      return_url: `${config.baseUrl}/app/settings#subscription`,
    });
    res.redirect(303, s.url);
  } catch (e) {
    next(e);
  }
});

// Opens Stripe's own cancel screen, which confirms and handles it properly.
router.post('/cancel', sec.requireUser, async (req, res, next) => {
  try {
    if (!stripe || !req.user.stripe_subscription_id) return res.redirect('/app/billing');
    const s = await stripe.billingPortal.sessions.create({
      customer: req.user.stripe_customer_id,
      return_url: `${config.baseUrl}/app/settings#subscription`,
      flow_data: {
        type: 'subscription_cancel',
        subscription_cancel: { subscription: req.user.stripe_subscription_id },
        after_completion: { type: 'redirect', redirect: { return_url: `${config.baseUrl}/app/settings#subscription` } },
      },
    });
    res.redirect(303, s.url);
  } catch (e) {
    next(e);
  }
});

// --- Webhook (mounted before the body parsers; needs the raw body) ------------

async function handleEvent(event) {
  const obj = event.data.object;
  switch (event.type) {
    case 'checkout.session.completed':
      if (obj.mode === 'subscription' && obj.subscription) {
        const sub = await stripe.subscriptions.retrieve(obj.subscription);
        if (!sub.metadata.user_id && obj.client_reference_id) sub.metadata.user_id = obj.client_reference_id;
        syncSubscription(sub);
      }
      break;
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed':
      syncSubscription(obj);
      break;
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const subId =
        obj.subscription || (obj.parent && obj.parent.subscription_details && obj.parent.subscription_details.subscription);
      if (subId) syncSubscription(await stripe.subscriptions.retrieve(typeof subId === 'string' ? subId : subId.id));
      if (event.type === 'invoice.payment_failed' && obj.customer_email) {
        await sendMail({
          to: obj.customer_email,
          subject: `Your ${config.appName} payment didn't go through`,
          text: `We couldn't take your latest ${config.appName} payment. Your review QR keeps working for now.\n\nPlease update your card here:\n${config.baseUrl}/app/billing\n\nThanks!`,
        });
      }
      break;
    }
    default:
      break;
  }
}

async function webhook(req, res) {
  if (!stripe || !config.stripe.webhookSecret) return res.status(503).send('Billing not configured');
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.get('stripe-signature'), config.stripe.webhookSecret);
  } catch (e) {
    return res.status(400).send(`Webhook signature check failed`);
  }
  // Stripe may deliver an event more than once; handle each only once.
  if (db.prepare('SELECT 1 FROM stripe_events WHERE id = ?').get(event.id)) return res.json({ received: true });
  try {
    await handleEvent(event);
    db.prepare('INSERT OR IGNORE INTO stripe_events (id, received_at) VALUES (?, ?)').run(event.id, now());
    res.json({ received: true });
  } catch (e) {
    console.error('Stripe webhook failed', event.type, e);
    res.status(500).send('Webhook handler failed'); // Stripe will retry
  }
}

module.exports = { router, webhook, syncSubscription };
