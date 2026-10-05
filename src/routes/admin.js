// A deliberately small admin area: headline numbers, recent sign-ups, view an
// account, disable/enable it. Only users with is_admin = 1 can reach it.
const express = require('express');
const { query, one } = require('../db');
const auth = require('../lib/auth');
const wrap = require('../wrap');
const { html } = require('../html');
const { appPage } = require('../views/layout');
const account = require('../lib/account');
const { stats } = require('../lib/analytics');
const { reviewUrl } = require('../lib/qr');
const sec = require('../security');

const router = express.Router();
router.use(sec.requireAdmin);

const fmt = (d) => (d ? new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

const STATE_LABEL = { trial: 'Trial', active: 'Active', past_due: 'Payment failed', expired: 'Expired / cancelled' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get('/', wrap(async (req, res) => {
  const users = await query('SELECT * FROM profiles');
  const counts = { total: users.length, trial: 0, active: 0, past_due: 0, expired: 0, disabled: 0, canceled: 0 };
  for (const u of users) {
    counts[account.accessState(u)]++;
    if (u.disabled_at) counts.disabled++;
    if (u.subscription_status === 'canceled' || u.cancel_at_period_end) counts.canceled++;
  }
  const visits = (await one("SELECT count(*)::int AS n FROM qr_visits WHERE event = 'view'")).n;
  const recent = await query(
    `SELECT u.id, u.email, u.created_at, u.disabled_at, u.subscription_status, u.trial_ends_at, u.current_period_end,
            u.stripe_subscription_id, b.name
     FROM profiles u LEFT JOIN businesses b ON b.user_id = u.id ORDER BY u.created_at DESC LIMIT 50`,
  );
  const q = String(req.query.q || '').trim();
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const found = q
    ? await query(
        `SELECT u.id, u.email, b.name FROM profiles u LEFT JOIN businesses b ON b.user_id = u.id
         WHERE u.email ILIKE $1 OR b.name ILIKE $1 OR b.qr_slug = $2 LIMIT 20`,
        [like, q.toLowerCase()],
      )
    : null;

  const tile = (n, label) => html`<div class="card stat"><span class="stat-num">${n}</span><span class="stat-label">${label}</span></div>`;
  res.send(
    appPage({
      req,
      title: 'Admin',
      back: '/app',
      body: html`<div class="admin-grid">
          ${tile(counts.total, 'Total users')} ${tile(counts.active, 'Active subscriptions')} ${tile(counts.trial, 'On trial')}
          ${tile(counts.canceled, 'Cancelled')} ${tile(counts.past_due, 'Payment failed')} ${tile(visits, 'Total review page visits')}
        </div>
        <form class="row search" method="get">
          <input name="q" value="${q}" placeholder="Search email, business or QR code" aria-label="Search" />
          <button class="btn btn-small" type="submit">Search</button>
        </form>
        ${found
          ? html`<section class="card">
              <h2>Search results</h2>
              ${found.length
                ? html`<ul class="plain">
                    ${found.map((u) => html`<li><a href="/admin/users/${u.id}">${u.email}</a> ${u.name ? html`· ${u.name}` : ''}</li>`)}
                  </ul>`
                : html`<p class="muted">No matches.</p>`}
            </section>`
          : ''}
        <section class="card">
          <h2>Recently registered</h2>
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>Business</th><th>Email</th><th>Status</th><th>Joined</th></tr>
              </thead>
              <tbody>
                ${recent.map(
                  (u) => html`<tr>
                    <td><a href="/admin/users/${u.id}">${u.name || '(no business yet)'}</a></td>
                    <td>${u.email}</td>
                    <td>${u.disabled_at ? 'Disabled' : STATE_LABEL[account.accessState(u)]}</td>
                    <td>${fmt(u.created_at)}</td>
                  </tr>`,
                )}
              </tbody>
            </table>
          </div>
        </section>`,
    }),
  );
}));

router.get('/users/:id', wrap(async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(404).send('Not found');
  const u = await one('SELECT * FROM profiles WHERE id = $1', [req.params.id]);
  if (!u) return res.status(404).send('Not found');
  const b = await one('SELECT * FROM businesses WHERE user_id = $1', [u.id]);
  const s = b ? await stats(b.id) : null;
  const row = (k, v) => html`<dt>${k}</dt><dd>${v}</dd>`;
  res.send(
    appPage({
      req,
      title: 'Account',
      back: '/admin',
      body: html`<section class="card">
          <h2>${b ? b.name : u.email}</h2>
          <dl class="kv">
            ${row('Email', u.email)} ${row('Joined', fmt(u.created_at))}
            ${row('Access', u.disabled_at ? `Disabled ${fmt(u.disabled_at)}` : STATE_LABEL[account.accessState(u)])}
            ${row('Stripe status', u.subscription_status)} ${row('Plan', u.plan_id || '—')}
            ${row('Trial ends', fmt(u.trial_ends_at))} ${row('Period ends', fmt(u.current_period_end))}
            ${row('Cancels at period end', u.cancel_at_period_end ? 'Yes' : 'No')}
            ${row('Stripe customer', u.stripe_customer_id || '—')} ${row('Stripe subscription', u.stripe_subscription_id || '—')}
            ${b
              ? html`${row('Review page', html`<a href="${reviewUrl(b.qr_slug)}" target="_blank" rel="noopener">${reviewUrl(b.qr_slug)}</a>`)}
                ${row('Google link', html`<a href="${b.google_review_url}" target="_blank" rel="noopener noreferrer">${b.google_review_url}</a>`)}
                ${row('Visits', `${s.month} this month · ${s.allTime} all time`)}`
              : ''}
          </dl>
        </section>
        ${u.id === req.user.id
          ? ''
          : html`<form method="post" action="/admin/users/${u.id}/${u.disabled_at ? 'enable' : 'disable'}">
              <input type="hidden" name="_csrf" value="${req.csrfToken}" />
              <button class="btn btn-block ${u.disabled_at ? '' : 'btn-danger'}" type="submit" ${u.disabled_at ? '' : html`data-confirm="Disable this account? They'll be logged out and their QR page will stop working."`}>
                ${u.disabled_at ? 'Re-enable account' : 'Disable account'}
              </button>
            </form>`}
        <p class="muted small">Disabling doesn't cancel a Stripe subscription — do that in the Stripe dashboard if needed.</p>`,
    }),
  );
}));

// Disabling blocks their login (in Supabase too) and stops their QR page.
router.post('/users/:id/disable', wrap(async (req, res) => {
  const id = req.params.id;
  if (!UUID.test(id)) return res.status(404).send('Not found');
  if (id === req.user.id) return res.redirect(`/admin/users/${id}`);
  await query('UPDATE profiles SET disabled_at = now() WHERE id = $1', [id]);
  await auth.setBanned(id, true);
  res.redirect(`/admin/users/${id}`);
}));

router.post('/users/:id/enable', wrap(async (req, res) => {
  const id = req.params.id;
  if (!UUID.test(id)) return res.status(404).send('Not found');
  await query('UPDATE profiles SET disabled_at = NULL WHERE id = $1', [id]);
  await auth.setBanned(id, false);
  res.redirect(`/admin/users/${id}`);
}));

module.exports = { router };
