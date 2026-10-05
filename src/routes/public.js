// Marketing pages and the customer-facing review page (/r/<slug>).
const express = require('express');
const config = require('../config');
const { one } = require('../db');
const { clientIp } = require('../security');
const wrap = require('../wrap');
const { html, raw } = require('../html');
const { sitePage, barePage } = require('../views/layout');
const { icon } = require('../views/icons');
const { qrSvg } = require('../lib/qr');
const { recordVisit } = require('../lib/analytics');
const { qrIsLive } = require('../lib/account');
const { industries, defaultIndustry } = require('../views/industries');

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

function landingPage(req, res, ind) {
  const demo = raw(qrSvg(`${config.baseUrl}/r/demo`));
  const ex = ind.example;
  const features = [
    ['star', 'Branded with your logo', 'Your name, logo and colour — not ours.'],
    ['qr', 'Permanent QR code', 'Change your Google link any time. Printed codes keep working.'],
    ['print', ...ind.printFeature],
    ['share', 'Share by WhatsApp, SMS or email', 'Send your review link with a ready-written message.'],
    ['phone', 'Works on any phone', 'Save it to your home screen. It opens like an app.'],
    ['check', 'No app for customers', 'They scan with their camera. No sign-ups, no details asked.'],
  ];
  res.send(
    sitePage({
      title: ind.title,
      description: ind.lead,
      // The default industry is served at both / and /<slug>; tell search engines / is the real one.
      canonical: ind === defaultIndustry ? `${config.baseUrl}/` : `${config.baseUrl}/${ind.slug}`,
      user: req.user,
      body: html`<main>
        <section class="hero">
          <div class="wrap hero-grid">
            <div>
              <p class="eyebrow">${ind.eyebrow}</p>
              <h1>${ind.headline}</h1>
              <p class="lead">${ind.lead}</p>
              <div class="cta-row">
                <a class="btn btn-large" href="/signup">Create My Review QR</a>
                <a class="btn btn-large btn-ghost" href="#how">See How It Works</a>
              </div>
              <p class="muted small">${config.trialDays}-day free trial · No card needed · Set up in 2 minutes</p>
            </div>
            <div class="phone-mock" aria-label="A phone showing a large review QR code">
              <div class="phone">
                <div class="phone-screen">
                  <div class="mock-logo" style="background:${ex.colour}">${ex.initials}</div>
                  <p class="mock-thanks">Thanks for choosing<br /><strong>${ex.name}</strong></p>
                  <p class="mock-ask">Would you mind leaving us a Google review?</p>
                  <div class="mock-qr" style="border-color:${ex.colour}">${demo}</div>
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
              ${ind.steps.map(
                ([h, p], i) => html`<li>
                  <span class="step-num">${i + 1}</span>
                  <h3>${h}</h3>
                  <p>${p}</p>
                </li>`,
              )}
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
                Just paste the new link in Settings. Your QR code points to your own permanent link, so
                ${ind.printedThings} you've already printed keep working.
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
            <h2>${ind.finalCta}</h2>
            <a class="btn btn-large" href="/signup">Create My Review QR</a>
          </div>
        </section>
      </main>`,
    }),
  );
}

router.get('/', (req, res) => landingPage(req, res, defaultIndustry));
for (const ind of Object.values(industries)) router.get(`/${ind.slug}`, (req, res) => landingPage(req, res, ind));

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
        <p>If your free trial ends without a plan, or your subscription ends, your QR code stops working until you subscribe again. It's the same code when it comes back, so nothing needs reprinting.</p>
      </main>`,
    }),
  ),
);

// --- Customer review page ----------------------------------------------------

function findBySlug(slug) {
  return one(
    `SELECT b.*, p.subscription_status, p.stripe_subscription_id, p.trial_ends_at, p.current_period_end, p.disabled_at
     FROM businesses b JOIN profiles p ON p.id = b.user_id WHERE b.qr_slug = $1`,
    [String(slug).toLowerCase()],
  );
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
      business: { brand_colour: defaultIndustry.example.colour },
      bodyClass: 'customer',
      body: html`<p class="preview-bar">Demo — this is what your customers see. <a href="/signup">Create yours</a></p>
        <main class="customer-card">
          <div class="customer-initials">${defaultIndustry.example.initials}</div>
          <h1>Thanks for choosing ${defaultIndustry.example.name}</h1>
          <p class="customer-lead">We'd love to hear about your experience.</p>
          <a class="btn btn-brand btn-huge btn-block" href="/signup">${icon('star')} Leave a Google Review</a>
          <p class="muted small">You'll be taken to Google to write and submit your review.</p>
        </main>`,
    }),
  ),
);

router.get('/r/:slug', wrap(async (req, res) => {
  const b = await findBySlug(req.params.slug);
  if (!b) return notActive(res, null, 404, "We couldn't find that review link.");
  if (!qrIsLive(b)) return notActive(res, b, 410, "This review link isn't active right now.");

  const owner = isOwner(req, b);
  const source = typeof req.query.s === 'string' ? req.query.s : 'qr';
  if (!owner && req.method === 'GET') await recordVisit(b.id, { source, ip: clientIp(req), ua: req.get('user-agent') });

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
}));

router.get('/r/:slug/go', wrap(async (req, res) => {
  const b = await findBySlug(req.params.slug);
  if (!b) return notActive(res, null, 404, "We couldn't find that review link.");
  if (!qrIsLive(b)) return notActive(res, b, 410, "This review link isn't active right now.");
  if (!isOwner(req, b) && req.method === 'GET') {
    await recordVisit(b.id, { event: 'google', source: req.query.s, ip: clientIp(req), ua: req.get('user-agent') });
  }
  res.set('Cache-Control', 'no-store').set('Referrer-Policy', 'no-referrer').redirect(302, b.google_review_url);
}));

function initials(name) {
  return String(name)
    .split(/\s+/)
    .filter((w) => /^[\p{L}\p{N}]/u.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

module.exports = { router, initials };
