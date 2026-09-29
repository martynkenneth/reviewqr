// Marketing pages and the customer-facing review page (/r/<slug>).
const express = require('express');
const config = require('../config');
const { db } = require('../db');
const { html, raw } = require('../html');
const { sitePage, barePage } = require('../views/layout');
const { icon } = require('../views/icons');
const { qrSvg } = require('../lib/qr');
const { recordVisit } = require('../lib/analytics');
const { qrIsLive } = require('../lib/account');

const router = express.Router();

const money = (n) => `${config.currencySymbol}${Number.isInteger(n) ? n : n.toFixed(2)}`;

function pricingCards() {
  return config.plans.map(
    (p) => html`<div class="price-card ${p.interval === 'year' ? 'is-highlight' : ''}">
      <h3>${p.name}</h3>
      <p class="price">${money(p.amount)}<span>/${p.interval}</span></p>
      <p class="muted">${p.blurb}</p>
      <ul class="ticks">
        <li>${icon('check')} ${config.trialDays}-day free trial</li>
        <li>${icon('check')} No card needed to start</li>
        <li>${icon('check')} Everything included</li>
      </ul>
      <a class="btn btn-block" href="/signup">Start free trial</a>
    </div>`,
  );
}

router.get('/', (req, res) => {
  const demo = raw(qrSvg(`${config.baseUrl}/r/demo`));
  const features = [
    ['star', 'Branded with your logo', 'Your name, logo and colour — not ours.'],
    ['qr', 'Permanent QR code', 'Change your Google link any time. Printed codes keep working.'],
    ['print', 'Download for invoices and cards', 'High-res PNG plus A6, A5 and A4 print-ready PDFs.'],
    ['share', 'Share by WhatsApp, SMS or email', 'Send your review link with a ready-written message.'],
    ['phone', 'Works on any phone', 'Save it to your home screen. It opens like an app.'],
    ['check', 'No app for customers', 'They scan with their camera. No sign-ups, no details asked.'],
  ];
  res.send(
    sitePage({
      title: 'Google review QR codes for tradespeople',
      description:
        'Create your branded review QR code, show it to your customer, and send them straight to your Google review page.',
      user: req.user,
      body: html`<main>
        <section class="hero">
          <div class="wrap hero-grid">
            <div>
              <p class="eyebrow">For plumbers, sparkies, builders and every trade</p>
              <h1>Get more Google reviews before you leave the job.</h1>
              <p class="lead">
                Create your branded review QR code, show it to your customer, and send them straight to your Google
                review page.
              </p>
              <div class="cta-row">
                <a class="btn btn-large" href="/signup">Create My Review QR</a>
                <a class="btn btn-large btn-ghost" href="#how">See How It Works</a>
              </div>
              <p class="muted small">${config.trialDays}-day free trial · No card needed · Set up in 2 minutes</p>
            </div>
            <div class="phone-mock" aria-label="A phone showing a large review QR code">
              <div class="phone">
                <div class="phone-screen">
                  <div class="mock-logo">AP</div>
                  <p class="mock-thanks">Thanks for choosing<br /><strong>ABC Plumbing</strong></p>
                  <p class="mock-ask">Would you mind leaving us a Google review?</p>
                  <div class="mock-qr">${demo}</div>
                  <p class="mock-hint">Scan with your phone camera</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="how" class="section">
          <div class="wrap">
            <h2>Get your customer to your Google review page in under 10 seconds</h2>
            <ol class="steps">
              <li>
                <span class="step-num">1</span>
                <h3>Finish the job</h3>
                <p>Open your review screen with one tap.</p>
              </li>
              <li>
                <span class="step-num">2</span>
                <h3>Show or share your QR</h3>
                <p>Your customer scans it with their phone camera.</p>
              </li>
              <li>
                <span class="step-num">3</span>
                <h3>Customer reviews you on Google</h3>
                <p>They write and submit the review directly on Google.</p>
              </li>
            </ol>
          </div>
        </section>

        <section class="section section-alt">
          <div class="wrap">
            <h2>Everything you need. Nothing you don't.</h2>
            <div class="features">
              ${features.map(
                ([i, t, d]) => html`<div class="feature">
                  <span class="feature-icon">${icon(i)}</span>
                  <div>
                    <h3>${t}</h3>
                    <p>${d}</p>
                  </div>
                </div>`,
              )}
            </div>
          </div>
        </section>

        <section id="pricing" class="section">
          <div class="wrap">
            <h2>Simple pricing</h2>
            <p class="lead center">Try it free for ${config.trialDays} days. Then one simple price.</p>
            <div class="pricing">${pricingCards()}</div>
          </div>
        </section>

        <section class="section section-alt">
          <div class="wrap narrow">
            <h2>Good to know</h2>
            <details class="faq">
              <summary>Does this post reviews for my customers?</summary>
              <p>
                No. Your customer is taken to your Google review page and writes and submits their own review with
                their own Google account. That's how Google wants it, and it keeps your reviews genuine.
              </p>
            </details>
            <details class="faq">
              <summary>What if my Google review link changes?</summary>
              <p>
                Just paste the new link in Settings. Your QR code points to your own permanent link, so cards, vans
                and signs you've already printed keep working.
              </p>
            </details>
            <details class="faq">
              <summary>Do my customers need an app?</summary>
              <p>No. They point their phone camera at the code. We never ask them for any details.</p>
            </details>
            <details class="faq">
              <summary>Can I see how many reviews I got?</summary>
              <p>
                We show how many people opened your review page and tapped through to Google. We don't claim those
                are reviews — only Google knows whether someone finished writing one.
              </p>
            </details>
          </div>
        </section>

        <section class="section cta-final">
          <div class="wrap center">
            <h2>Ready before your next job?</h2>
            <a class="btn btn-large" href="/signup">Create My Review QR</a>
          </div>
        </section>
      </main>`,
    }),
  );
});

router.get('/privacy', (req, res) =>
  res.send(
    sitePage({
      title: 'Privacy',
      user: req.user,
      body: html`<main class="wrap narrow prose">
        <h1>Privacy</h1>
        <p><strong>Customers who scan a QR code:</strong> we don't ask for your name, email, phone number or any login. We record that the review page was opened, the time, and a short code made from your connection that changes every day, so a business can see roughly how many people visited. We don't store your IP address.</p>
        <p><strong>Businesses using ${config.appName}:</strong> we store your email, a secure hash of your password, your business name, logo, brand colour and Google review link. Payments are handled by Stripe; we never see or store your card details.</p>
        <p>Questions: <a href="mailto:${config.supportEmail}">${config.supportEmail}</a></p>
      </main>`,
    }),
  ),
);

router.get('/terms', (req, res) =>
  res.send(
    sitePage({
      title: 'Terms',
      user: req.user,
      body: html`<main class="wrap narrow prose">
        <h1>Terms</h1>
        <p>Use ${config.appName} to invite genuine customers to review your business on Google. Don't offer incentives for reviews, don't ask only happy customers, and don't write reviews yourself — these break Google's rules and can get reviews removed.</p>
        <p>You can cancel any time from Settings. Your subscription runs until the end of the period you've paid for.</p>
      </main>`,
    }),
  ),
);

// --- Customer review page ----------------------------------------------------

function findBySlug(slug) {
  return db
    .prepare(
      `SELECT b.*, u.subscription_status, u.trial_ends_at, u.current_period_end, u.disabled_at
       FROM businesses b JOIN users u ON u.id = b.user_id WHERE b.qr_slug = ?`,
    )
    .get(String(slug).toLowerCase());
}

function notActive(res, business, status, message) {
  res.status(status).set('Cache-Control', 'no-store').send(
    barePage({
      title: 'Review link',
      business,
      bodyClass: 'customer',
      body: html`<main class="customer-card">
        <h1>${message}</h1>
        <p class="muted">If you were trying to leave a review, please search for the business on Google Maps.</p>
      </main>`,
    }),
  );
}

const isOwner = (req, business) => req.business && req.business.id === business.id;

// The phone mock-up on the landing page links here.
router.get('/r/demo', (req, res) =>
  res.send(
    barePage({
      title: 'Demo review page',
      business: { brand_colour: '#1d4ed8' },
      bodyClass: 'customer',
      body: html`<p class="preview-bar">Demo — this is what your customers see. <a href="/signup">Create yours</a></p>
        <main class="customer-card">
          <div class="customer-initials">AP</div>
          <h1>Thanks for choosing ABC Plumbing</h1>
          <p class="customer-lead">We'd love to hear about your experience.</p>
          <a class="btn btn-brand btn-huge btn-block" href="/signup">${icon('star')} Leave a Google Review</a>
          <p class="muted small">You'll be taken to Google to write and submit your review.</p>
        </main>`,
    }),
  ),
);

router.get('/r/:slug', (req, res) => {
  const b = findBySlug(req.params.slug);
  if (!b) return notActive(res, null, 404, "We couldn't find that review link.");
  if (!qrIsLive(b)) return notActive(res, b, 410, "This review link isn't active right now.");

  const owner = isOwner(req, b);
  const source = typeof req.query.s === 'string' ? req.query.s : 'qr';
  if (!owner && req.method === 'GET') recordVisit(b.id, { source, ip: req.ip, ua: req.get('user-agent') });

  res.set('Cache-Control', 'no-store').send(
    barePage({
      title: `Review ${b.name}`,
      business: b,
      bodyClass: 'customer',
      body: html`${owner
          ? html`<p class="preview-bar">Preview — your own visits aren't counted. <a href="/app">Back to app</a></p>`
          : ''}
        <main class="customer-card">
          ${b.logo_file
            ? html`<img class="customer-logo" src="/u/${b.logo_file}" alt="${b.name} logo" />`
            : html`<div class="customer-initials">${initials(b.name)}</div>`}
          <h1>Thanks for choosing ${b.name}</h1>
          <p class="customer-lead">We'd love to hear about your experience.</p>
          <a class="btn btn-brand btn-huge btn-block" href="/r/${b.qr_slug}/go?s=${encodeURIComponent(source)}" rel="noopener"
            >${icon('star')} Leave a Google Review</a
          >
          <p class="muted small">You'll be taken to Google to write and submit your review.</p>
        </main>`,
    }),
  );
});

router.get('/r/:slug/go', (req, res) => {
  const b = findBySlug(req.params.slug);
  if (!b) return notActive(res, null, 404, "We couldn't find that review link.");
  if (!qrIsLive(b)) return notActive(res, b, 410, "This review link isn't active right now.");
  if (!isOwner(req, b) && req.method === 'GET') {
    recordVisit(b.id, { event: 'google', source: req.query.s, ip: req.ip, ua: req.get('user-agent') });
  }
  res.set('Cache-Control', 'no-store').set('Referrer-Policy', 'no-referrer').redirect(302, b.google_review_url);
});

function initials(name) {
  return String(name)
    .split(/\s+/)
    .filter((w) => /^[\p{L}\p{N}]/u.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

module.exports = { router, initials };
