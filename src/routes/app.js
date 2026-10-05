// The logged-in app: setup, dashboard, Show QR, download, share, visits, settings.
const express = require('express');
const multer = require('multer');
const config = require('../config');
const { query } = require('../db');
const { html, raw } = require('../html');
const { appPage, barePage } = require('../views/layout');
const { icon } = require('../views/icons');
const { businessForm } = require('../views/businessForm');
const { normalizeReviewUrl } = require('../lib/google');
const { normalizeHex, qrColour } = require('../lib/colour');
const { saveLogo, deleteLogo, MAX_BYTES } = require('../lib/images');
const qr = require('../lib/qr');
const { stats } = require('../lib/analytics');
const account = require('../lib/account');
const { initials } = require('./public');
const { EMAIL, cleanEmail, errorBox, noticeBox } = require('./auth');
const sec = require('../security');
const auth = require('../lib/auth');
const wrap = require('../wrap');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1, fields: 20 } });

// Parses the logo upload, turning "file too large" into a friendly message,
// then checks the CSRF token (multipart bodies aren't parsed any earlier).
function withUpload(req, res, next) {
  upload.single('logo')(req, res, (err) => {
    if (err) {
      req.uploadError =
        err.code === 'LIMIT_FILE_SIZE' ? `That image is too big. Please use one under ${MAX_BYTES / 1024 / 1024}MB.` : 'Upload failed. Please try again.';
      req.body = req.body || {};
    }
    sec.verifyCsrf(req, res, next);
  });
}

// Expired trial/subscription: send them to billing rather than a broken screen.
function requireAccess(req, res, next) {
  if (account.hasAccess(req.user)) return next();
  res.redirect('/app/billing?expired=1');
}

const shareUrl = (b) => `${qr.reviewUrl(b.qr_slug)}?s=link`;
const shareMessage = (b) =>
  `Hi, thanks again for choosing ${b.name}. If you have a moment, we'd really appreciate a Google review: ${shareUrl(b)}`;
const fileBase = (b) =>
  (b.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'review').slice(0, 40) + '-qr-review';

// --- Business setup (first run) ----------------------------------------------

async function readBusinessForm(req, existing) {
  const b = req.body || {};
  const values = {
    name: String(b.name || '').trim().replace(/\s+/g, ' ').slice(0, 80),
    brand_colour:
      normalizeHex(b.brand_colour === 'custom' ? b.brand_colour_custom : b.brand_colour) ||
      (existing && existing.brand_colour) ||
      '#0f766e',
    google_review_url: String(b.google_review_url || '').trim(),
  };
  if (req.uploadError) return { values, error: req.uploadError };
  if (!values.name) return { values, error: 'Please enter your business name.' };
  const g = normalizeReviewUrl(values.google_review_url);
  if (g.error) return { values, error: g.error };
  values.google_review_url = g.url;

  values.logo_file = existing ? existing.logo_file : null;
  if (req.file) {
    const saved = await saveLogo(req.file.buffer);
    if (saved.error) return { values, error: saved.error };
    values.logo_file = saved.file;
  } else if (b.remove_logo) values.logo_file = null;
  return { values };
}

router.get('/setup', sec.requireUser, (req, res) => {
  if (req.business) return res.redirect('/app/settings');
  res.send(setupPage(req, {}));
});

function setupPage(req, { values = {}, error }) {
  return appPage({
    req,
    title: 'Set up your review QR',
    body: html`<div class="onboard">
      <p class="eyebrow">Step 1 of 1 · takes about a minute</p>
      <h1>Your business</h1>
      <p class="muted">This is what your customers will see when they scan your QR code.</p>
      ${businessForm(req, { action: '/app/setup', values, error, submitLabel: 'Create My Review QR' })}
    </div>`,
  });
}

router.post('/setup', sec.requireUser, withUpload, async (req, res, next) => {
  try {
    if (req.business) return res.redirect('/app');
    const { values, error } = await readBusinessForm(req, null);
    if (error) return res.status(400).send(setupPage(req, { values, error }));
    await query(
      `INSERT INTO businesses (user_id, name, logo_file, brand_colour, google_review_url, qr_slug)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [req.user.id, values.name, values.logo_file, values.brand_colour, values.google_review_url, await account.newSlug()],
    );
    res.redirect('/app?welcome=1');
  } catch (e) {
    next(e);
  }
});

// --- Dashboard -----------------------------------------------------------------

function accessBanner(user) {
  const state = account.accessState(user);
  if (state === 'trial') {
    const d = account.trialDaysLeft(user);
    const days = `${d} day${d === 1 ? '' : 's'}`;
    // In the last few days, spell out what happens so nobody is caught out.
    return d <= 3
      ? html`<a class="banner banner-warn" href="/app/billing"
          ><span>Your free trial ends in <strong>${days}</strong>. Your QR code will stop working unless you choose a plan.</span
          ><span class="banner-cta">Choose a plan</span></a
        >`
      : html`<a class="banner" href="/app/billing"
          ><span>Free trial: <strong>${days} left</strong></span><span class="banner-cta">Choose a plan</span></a
        >`;
  }
  if (state === 'past_due') {
    return html`<a class="banner banner-warn" href="/app/billing"
      ><span>Your last payment didn't go through.</span><span class="banner-cta">Update card</span></a
    >`;
  }
  if (state === 'expired') {
    return html`<a class="banner banner-warn" href="/app/billing"
      ><span>Your free trial has ended and <strong>your QR code has stopped working</strong>. Choose a plan to switch it back on.</span
      ><span class="banner-cta">Choose a plan</span></a
    >`;
  }
  return '';
}

function qrBlock(b, cls = '') {
  return html`<div class="qr-frame ${cls}">${raw(qr.qrSvg(qr.reviewUrl(b.qr_slug), { colour: qrColour(b.brand_colour) }))}</div>`;
}

router.get('/', sec.requireBusiness, wrap(async (req, res) => {
  const b = req.business;
  const s = await stats(b.id);
  const link = shareUrl(b);
  res.send(
    appPage({
      req,
      title: 'Home',
      active: 'home',
      body: html`${accessBanner(req.user)}
        ${req.query.welcome
          ? html`<p class="alert alert-ok" role="status">
              ${icon('check')} Your review QR is ready. It's permanent — print it, share it, put it anywhere your customers will see it.
            </p>`
          : ''}
        <section class="biz-head">
          ${b.logo_file
            ? html`<img class="biz-logo" src="/u/${b.logo_file}" alt="" />`
            : html`<div class="biz-initials">${initials(b.name)}</div>`}
          <div>
            <p class="biz-name">${b.name}</p>
            <h1>Your Review QR</h1>
          </div>
        </section>

        <a class="qr-card" href="/app/show" aria-label="Show QR full screen">${qrBlock(b)}</a>

        <div class="action-grid">
          <a class="btn btn-large btn-brand action action-primary" href="/app/show">${icon('show')} Show QR</a>
          <a class="btn btn-large btn-ghost action" href="/app/download">${icon('download')} Download QR</a>
          <a class="btn btn-large btn-ghost action" href="/app/share">${icon('share')} Share QR</a>
          <button class="btn btn-large btn-ghost action" type="button" data-copy="${link}" data-copied="Link copied">
            ${icon('copy')} <span>Copy Review Link</span>
          </button>
        </div>

        <section class="card stats-card">
          <div class="row-between">
            <h2>Review page visits</h2>
            <a class="small" href="/app/analytics">Details</a>
          </div>
          <div class="stat-row">
            <div class="stat"><span class="stat-num">${s.today}</span><span class="stat-label">Today</span></div>
            <div class="stat"><span class="stat-num">${s.month}</span><span class="stat-label">This month</span></div>
            <div class="stat"><span class="stat-num">${s.allTime}</span><span class="stat-label">All time</span></div>
          </div>
          <p class="muted small">
            Times your review page was opened. ${s.monthGoogle} tapped through to Google this month.
          </p>
        </section>

        <p class="center small"><a href="/r/${b.qr_slug}" target="_blank" rel="noopener">Preview your customer page ↗</a></p>`,
    }),
  );
}));

// --- Show QR (full screen) -----------------------------------------------------

router.get('/show', sec.requireBusiness, requireAccess, (req, res) => {
  const b = req.business;
  res.send(
    barePage({
      title: 'Show QR',
      business: b,
      bodyClass: 'show',
      body: html`<main class="show-main" data-wake-lock>
        ${b.logo_file ? html`<img class="show-logo" src="/u/${b.logo_file}" alt="" />` : ''}
        <p class="show-thanks">Thanks for choosing</p>
        <h1 class="show-name">${b.name}</h1>
        <p class="show-ask">Would you mind leaving us a Google review?</p>
        ${qrBlock(b, 'show-qr')}
        <p class="show-scan">Scan with your phone camera</p>
        <p class="show-small">It only takes a moment.</p>
        <a class="btn btn-large btn-brand show-done" href="/app">Done</a>
      </main>`,
    }),
  );
});

// --- Download ------------------------------------------------------------------

router.get('/download', sec.requireBusiness, requireAccess, (req, res) => {
  const b = req.business;
  const item = (title, desc, links) => html`<li class="dl-item">
    <div>
      <h3>${title}</h3>
      <p class="muted small">${desc}</p>
    </div>
    <div class="dl-links">
      ${links.map(([label, href]) => html`<a class="btn btn-small" href="${href}" download>${icon('download')} ${label}</a>`)}
    </div>
  </li>`;
  res.send(
    appPage({
      req,
      title: 'Download QR',
      active: 'qr',
      back: '/app',
      body: html`<img class="sign-preview" src="/app/files/card.png?v=${encodeURIComponent(b.updated_at)}" alt="Your branded review QR" width="600" height="750" />
        <ul class="dl-list">
          ${item('QR code only', 'Square, high resolution. For invoices, receipts, websites and email signatures.', [
            ['PNG', '/app/files/qr.png'],
            ['SVG', '/app/files/qr.svg'],
          ])}
          ${item('Branded QR', 'Your logo, name, QR and a short message. For social media, WhatsApp and screens.', [['PNG', '/app/files/card.png']])}
          ${item('A6 counter card', '105 × 148 mm. For your counter, reception desk, van dashboard or to leave behind.', [['PDF', '/app/files/a6.pdf']])}
          ${item('A5 printable sign', '148 × 210 mm. For reception desks and notice boards.', [['PDF', '/app/files/a5.pdf']])}
          ${item('A4 printable sign', '210 × 297 mm. For windows and walls.', [['PDF', '/app/files/a4.pdf']])}
        </ul>
        <p class="muted small">
          Tip: for business cards, shop windows, van livery or large signs, send the <strong>SVG</strong> to your printer or signwriter —
          it stays sharp at any size. Your QR code is permanent, so it's safe to print thousands.
        </p>
        <a class="btn btn-block btn-ghost" href="/app/share">${icon('share')} Share QR instead</a>`,
    }),
  );
});

const FILES = {
  'qr.png': async (b) => ['image/png', await qr.qrPng(qr.reviewUrl(b.qr_slug), { px: 2000, colour: qrColour(b.brand_colour) })],
  'qr.svg': async (b) => ['image/svg+xml', qr.qrSvg(qr.reviewUrl(b.qr_slug), { colour: qrColour(b.brand_colour) })],
  'card.png': async (b) => ['image/png', await qr.signPng(b, { height: 1250, pxWidth: 1200 })],
  'a6.pdf': async (b) => ['application/pdf', await qr.signPdf(b, 'a6')],
  'a5.pdf': async (b) => ['application/pdf', await qr.signPdf(b, 'a5')],
  'a4.pdf': async (b) => ['application/pdf', await qr.signPdf(b, 'a4')],
};
const FILE_SUFFIX = { 'qr.png': '.png', 'qr.svg': '.svg', 'card.png': '-branded.png', 'a6.pdf': '-A6.pdf', 'a5.pdf': '-A5.pdf', 'a4.pdf': '-A4.pdf' };

router.get('/files/:name', sec.requireBusiness, requireAccess, async (req, res, next) => {
  try {
    const make = FILES[req.params.name];
    if (!make) return res.status(404).send('Not found');
    const [type, body] = await make(req.business);
    res
      .type(type)
      .set('Cache-Control', 'private, max-age=300')
      .set('Content-Disposition', `${req.query.inline ? 'inline' : 'attachment'}; filename="${fileBase(req.business)}${FILE_SUFFIX[req.params.name]}"`)
      .send(body);
  } catch (e) {
    next(e);
  }
});

// --- Share ---------------------------------------------------------------------

router.get('/share', sec.requireBusiness, requireAccess, (req, res) => {
  const b = req.business;
  const msg = shareMessage(b);
  const enc = encodeURIComponent;
  res.send(
    appPage({
      req,
      title: 'Share QR',
      active: 'qr',
      back: '/app',
      body: html`<div class="stack" data-share data-title="${b.name}" data-file="/app/files/card.png" data-filename="${fileBase(b)}.png">
        <label
          >Message
          <textarea rows="4" data-share-message>${msg}</textarea>
          <small class="muted">You can edit this before sending.</small>
        </label>

        <button class="btn btn-large btn-brand btn-block" type="button" data-native-share>${icon('share')} Share</button>

        <div class="share-grid">
          <a class="btn btn-large btn-ghost" href="https://wa.me/?text=${enc(msg)}" target="_blank" rel="noopener" data-share-link="whatsapp">${icon('whatsapp')} WhatsApp</a>
          <a class="btn btn-large btn-ghost" href="sms:?&body=${enc(msg)}" data-share-link="sms">${icon('sms')} SMS</a>
          <a class="btn btn-large btn-ghost" href="mailto:?subject=${enc(`Thanks from ${b.name}`)}&body=${enc(msg)}" data-share-link="email">${icon('mail')} Email</a>
          <button class="btn btn-large btn-ghost" type="button" data-copy-message data-copied="Message copied">${icon('copy')} <span>Copy Message</span></button>
        </div>

        <div class="card">
          <h2>Your review link</h2>
          <p class="linkbox"><code>${shareUrl(b)}</code></p>
          <button class="btn btn-ghost btn-block" type="button" data-copy="${shareUrl(b)}" data-copied="Link copied">${icon('copy')} <span>Copy Review Link</span></button>
        </div>
        <a class="btn btn-block btn-ghost" href="/app/files/card.png">${icon('download')} Download QR image</a>
      </div>`,
    }),
  );
});

// --- Analytics -----------------------------------------------------------------

router.get('/analytics', sec.requireBusiness, wrap(async (req, res) => {
  const s = await stats(req.business.id);
  const max = Math.max(1, ...s.days.map((d) => d.views));
  const fmt = (k) => new Date(`${k}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  res.send(
    appPage({
      req,
      title: 'Visits',
      active: 'analytics',
      body: html`<h1>Review page visits</h1>
        <div class="stat-row stat-row-cards">
          <div class="card stat"><span class="stat-num">${s.today}</span><span class="stat-label">Today</span></div>
          <div class="card stat"><span class="stat-num">${s.month}</span><span class="stat-label">This month</span></div>
          <div class="card stat"><span class="stat-num">${s.allTime}</span><span class="stat-label">All time</span></div>
        </div>

        <section class="card">
          <h2>Last 30 days</h2>
          <div class="bars" role="img" aria-label="Review page visits per day over the last 30 days">
            ${s.days.map(
              (d) => html`<div class="bar" title="${fmt(d.day)}: ${d.views}">
                <span style="height:${Math.round((d.views / max) * 100)}%"></span>
              </div>`,
            )}
          </div>
          <div class="bars-axis muted small"><span>${fmt(s.days[0].day)}</span><span>Today</span></div>
        </section>

        <section class="card">
          <h2>Tapped through to Google</h2>
          <p><strong>${s.monthGoogle}</strong> this month · <strong>${s.allTimeGoogle}</strong> all time</p>
          <p class="muted small">People who pressed "Leave a Google Review" on your page.</p>
        </section>

        <section class="card muted small">
          <h2>What these numbers mean</h2>
          <p>
            <strong>Review page visits</strong> count how many times your review page was opened — from your QR code or
            shared link. <strong>Tapped through</strong> counts people who went on to Google.
          </p>
          <p>
            We can't see whether someone finished and posted a review — only Google knows that. Check your Google
            Business Profile for your actual reviews. Link previews from WhatsApp and other apps, and your own visits
            while logged in, aren't counted.
          </p>
        </section>`,
    }),
  );
}));

// --- Settings ------------------------------------------------------------------

const NOTICES = {
  saved: 'Saved. Your QR code hasn\'t changed — anything already printed keeps working.',
  email: 'Email updated.',
  email_sent: "Check your inbox: we've sent a link to confirm the change. If you also get one at your old address, tap both.",
  password: 'Password changed.',
  subscribed: "Thanks! You're subscribed.",
};

function settingsPage(req, { values, error, accountError } = {}) {
  const b = req.business;
  const u = req.user;
  const state = account.accessState(u);
  const plan = account.planById(u.plan_id);
  const dateFmt = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const notice = NOTICES[req.query.notice];
  return appPage({
    req,
    title: 'Settings',
    active: 'settings',
    body: html`${notice ? noticeBox(notice) : ''}
      <section class="card">
        <h2>Business details</h2>
        ${businessForm(req, {
          action: '/app/settings/business',
          values: values || b,
          error,
          submitLabel: 'Save changes',
          logoUrl: b.logo_file ? `/u/${b.logo_file}` : null,
        })}
      </section>

      <section class="card" id="subscription">
        <h2>Subscription</h2>
        <dl class="kv">
          <dt>Current plan</dt>
          <dd>
            ${state === 'trial'
              ? `Free trial (${account.trialDaysLeft(u)} days left)`
              : plan
                ? `${plan.name} — ${config.currencySymbol}${plan.amount}/${plan.interval}`
                : state === 'expired'
                  ? 'No active plan'
                  : 'Subscribed'}
          </dd>
          ${u.current_period_end && state !== 'trial'
            ? html`<dt>${u.cancel_at_period_end || u.subscription_status === 'canceled' ? 'Access until' : 'Next billing date'}</dt>
                <dd>${dateFmt(u.current_period_end)}</dd>`
            : ''}
          ${state === 'past_due' ? html`<dt>Status</dt><dd class="text-warn">Payment failed — please update your card</dd>` : ''}
        </dl>
        ${u.stripe_subscription_id && config.billingEnabled
          ? html`<form method="post" action="/app/billing/portal">
                <input type="hidden" name="_csrf" value="${req.csrfToken}" />
                <button class="btn btn-block" type="submit">Manage Subscription</button>
              </form>
              ${u.subscription_status !== 'canceled' && !u.cancel_at_period_end
                ? html`<form method="post" action="/app/billing/cancel">
                    <input type="hidden" name="_csrf" value="${req.csrfToken}" />
                    <button class="btn btn-block btn-ghost" type="submit">Cancel Subscription</button>
                  </form>`
                : ''}`
          : html`<a class="btn btn-block" href="/app/billing">Choose a plan</a>`}
      </section>

      <section class="card">
        <h2>Account</h2>
        ${accountError ? errorBox(accountError) : ''}
        <form method="post" action="/app/settings/email" class="stack">
          <input type="hidden" name="_csrf" value="${req.csrfToken}" />
          <label>Email<input type="email" name="email" value="${u.email}" required autocomplete="email" /></label>
          <label>Current password<input type="password" name="current_password" required autocomplete="current-password" /></label>
          <button class="btn btn-ghost btn-block" type="submit">Change email</button>
        </form>
        <hr />
        <form method="post" action="/app/settings/password" class="stack">
          <input type="hidden" name="_csrf" value="${req.csrfToken}" />
          <label>Current password<input type="password" name="current_password" required autocomplete="current-password" /></label>
          <label>New password<input type="password" name="new_password" minlength="8" required autocomplete="new-password" /></label>
          <button class="btn btn-ghost btn-block" type="submit">Change password</button>
        </form>
      </section>

      <form method="post" action="/logout" data-logout>
        <input type="hidden" name="_csrf" value="${req.csrfToken}" />
        <button class="btn btn-block btn-ghost" type="submit">${icon('logout')} Log out</button>
      </form>
      <p class="center muted small">Need help? <a href="mailto:${config.supportEmail}">${config.supportEmail}</a></p>`,
  });
}

router.get('/settings', sec.requireBusiness, (req, res) => res.send(settingsPage(req)));

router.post('/settings/business', sec.requireBusiness, withUpload, async (req, res, next) => {
  try {
    const b = req.business;
    const { values, error } = await readBusinessForm(req, b);
    if (error) return res.status(400).send(settingsPage(req, { values: { ...b, ...values }, error }));
    await query(
      `UPDATE businesses SET name = $1, logo_file = $2, brand_colour = $3, google_review_url = $4, updated_at = now()
       WHERE id = $5 AND user_id = $6`,
      [values.name, values.logo_file, values.brand_colour, values.google_review_url, b.id, req.user.id],
    );
    if (b.logo_file && b.logo_file !== values.logo_file) await deleteLogo(b.logo_file);
    res.redirect('/app/settings?notice=saved');
  } catch (e) {
    next(e);
  }
});

// Re-checks the current password with Supabase before account changes.
async function checkCurrentPassword(req, res) {
  const r = await auth.signIn(req.user.email, String(req.body.current_password || ''));
  if (!r.error) {
    await auth.signOut(r.session.access_token); // we only needed the check, not a new login
    return true;
  }
  res.status(400).send(settingsPage(req, { accountError: 'Your current password is wrong.' }));
  return false;
}

router.post(
  '/settings/email',
  sec.requireBusiness,
  wrap(async (req, res) => {
    const email = cleanEmail(req.body.email);
    if (!EMAIL.test(email)) return res.status(400).send(settingsPage(req, { accountError: 'Please enter a valid email address.' }));
    if (email === req.user.email) return res.redirect('/app/settings');
    if (!(await checkCurrentPassword(req, res))) return;
    // Supabase emails a confirmation link; the change happens when it's tapped.
    const r = await auth.requestEmailChange(req.tokens, email, `${config.baseUrl}/auth/confirm`);
    if (r.error) return res.status(400).send(settingsPage(req, { accountError: r.error }));
    res.redirect('/app/settings?notice=email_sent');
  }),
);

router.post(
  '/settings/password',
  sec.requireBusiness,
  wrap(async (req, res) => {
    const problem = sec.passwordProblem(req.body.new_password);
    if (problem) return res.status(400).send(settingsPage(req, { accountError: problem }));
    if (!(await checkCurrentPassword(req, res))) return;
    const r = await auth.setPassword(req.user.id, req.body.new_password);
    if (r.error) return res.status(400).send(settingsPage(req, { accountError: r.error }));
    await auth.signOut(req.tokens.access_token, 'others'); // stay logged in here, logged out elsewhere
    res.redirect('/app/settings?notice=password');
  }),
);

module.exports = { router, accessBanner };
