// End-to-end tests over HTTP against a throwaway database.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reviewqr-test-'));
Object.assign(process.env, {
  DATA_DIR: tmp,
  BASE_URL: 'https://reviews.example',
  ADMIN_EMAILS: 'boss@example.com',
  STRIPE_SECRET_KEY: 'sk_test_dummy',
  STRIPE_WEBHOOK_SECRET: 'whsec_test',
  STRIPE_PRICE_MONTHLY: 'price_monthly',
  STRIPE_PRICE_ANNUAL: 'price_annual',
  TRUST_PROXY: '0',
});

const sharp = require('sharp');
const jsQR = require('jsqr');
const Stripe = require('stripe');
const { createApp } = require('../src/server');
const { db } = require('../src/db');
const { normalizeReviewUrl } = require('../src/lib/google');
const { safeNext } = require('../src/security');

let server;
let base;
const PHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';

// A tiny browser: keeps cookies, doesn't follow redirects.
function client() {
  const jar = new Map();
  const c = {
    cookie: () => [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
    async req(method, url, { form, body, headers = {} } = {}) {
      const h = { 'user-agent': PHONE_UA, ...headers };
      if (jar.size) h.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
      let payload = body;
      if (form) {
        payload = new URLSearchParams(form).toString();
        h['content-type'] = 'application/x-www-form-urlencoded';
      }
      const res = await fetch(base + url, { method, headers: h, body: payload, redirect: 'manual' });
      for (const sc of res.headers.getSetCookie()) {
        const [pair] = sc.split(';');
        const i = pair.indexOf('=');
        const v = pair.slice(i + 1);
        if (v) jar.set(pair.slice(0, i), v);
        else jar.delete(pair.slice(0, i));
      }
      res.text_ = await res.text();
      return res;
    },
    get: (url, o) => c.req('GET', url, o),
    post: (url, o) => c.req('POST', url, o),
    async csrf(url = '/login') {
      const r = await c.get(url);
      const m = r.text_.match(/name="_csrf" value="([^"]+)"/);
      return m && m[1];
    },
    async signup(email, password = 'correct horse') {
      const _csrf = await c.csrf('/signup');
      return c.post('/signup', { form: { _csrf, email, password } });
    },
    async setup(fields = {}) {
      const _csrf = await c.csrf('/app/setup');
      const fd = new FormData();
      const all = { _csrf, name: 'ABC Plumbing', brand_colour: '#1d4ed8', google_review_url: 'https://g.page/r/Cabc123/review', ...fields };
      for (const [k, v] of Object.entries(all)) fd.append(k, v);
      return fetch(`${base}/app/setup`, { method: 'POST', body: fd, headers: cookieHeader(c), redirect: 'manual' });
    },
  };
  return c;
}

const slugOf = (userEmail) =>
  db.prepare('SELECT b.qr_slug FROM businesses b JOIN users u ON u.id = b.user_id WHERE u.email = ?').get(userEmail).qr_slug;

before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('Google review links: accepts Google, rejects everything else', () => {
  assert.equal(normalizeReviewUrl('g.page/r/CabcDEF/review').url, 'https://g.page/r/CabcDEF/review');
  assert.ok(normalizeReviewUrl('https://search.google.com/local/writereview?placeid=ChIJ123').url);
  assert.ok(normalizeReviewUrl('https://maps.app.goo.gl/abc').url);
  assert.ok(normalizeReviewUrl('https://www.google.co.uk/maps/place/x').url);
  assert.equal(
    normalizeReviewUrl('ChIJN1t_tDeuEmsRUsoyG83frY4').url,
    'https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4',
  );
  assert.ok(normalizeReviewUrl('https://evil.com/g.page').error);
  assert.ok(normalizeReviewUrl('https://google.com.evil.com/').error);
  assert.ok(normalizeReviewUrl('javascript:alert(1)').error);
  assert.ok(normalizeReviewUrl('').error);
});

test('login redirects only go to our own pages', () => {
  assert.equal(safeNext('/app/show'), '/app/show');
  assert.equal(safeNext('//evil.com'), '/app');
  assert.equal(safeNext('https://evil.com'), '/app');
  assert.equal(safeNext('/\\evil.com'), '/app');
});

test('landing page and PWA files are served', async () => {
  const c = client();
  const r = await c.get('/');
  assert.equal(r.status, 200);
  assert.match(r.text_, /Get more Google reviews before you leave the job\./);
  assert.match(r.text_, /£9\.99/);
  assert.equal((await c.get('/manifest.webmanifest')).status, 200);
  assert.equal((await c.get('/sw.js')).status, 200);
  assert.equal((await c.get('/icons/icon-512.png')).status, 200);
});

test('forms without a CSRF token are rejected', async () => {
  const c = client();
  const r = await c.post('/signup', { form: { email: 'x@example.com', password: 'longenough' } });
  assert.equal(r.status, 403);
});

test('full journey: sign up → set up → QR → customer visit → stats', async () => {
  const c = client();
  const s = await c.signup('plumber@example.com');
  assert.equal(s.status, 302);
  assert.equal(s.headers.get('location'), '/app/setup');

  // Dashboard needs a business first.
  assert.equal((await c.get('/app')).headers.get('location'), '/app/setup');

  const bad = await c.setup({ google_review_url: 'https://not-google.com/x' });
  assert.equal(bad.status, 400);

  const ok = await c.setup();
  assert.equal(ok.status, 302);
  assert.equal(ok.headers.get('location'), '/app?welcome=1');

  const dash = await c.get('/app');
  assert.equal(dash.status, 200);
  assert.match(dash.text_, /Your Review QR/);
  assert.match(dash.text_, /Show QR/);
  assert.match(dash.text_, /Copy Review Link/);
  assert.doesNotMatch(dash.text_, /Reviews generated/i);

  const slug = slugOf('plumber@example.com');
  assert.match(slug, /^[a-z2-9]{7}$/);

  // The QR image decodes to our permanent short link, not the Google URL.
  const raw = await fetchBuffer(c, '/app/files/qr.png');
  const { data, info } = await sharp(raw).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const decoded = jsQR(new Uint8ClampedArray(data), info.width, info.height);
  assert.equal(decoded.data, `https://reviews.example/r/${slug}`);

  // Branded card also scans.
  const card = await fetchBuffer(c, '/app/files/card.png');
  const img = await sharp(card).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(jsQR(new Uint8ClampedArray(img.data), img.info.width, img.info.height).data, `https://reviews.example/r/${slug}`);

  for (const f of ['a6.pdf', 'a5.pdf', 'a4.pdf']) {
    const pdf = await fetchBuffer(c, `/app/files/${f}`);
    assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  }
  assert.match((await c.get('/app/files/qr.svg')).text_, /^<svg/);

  // Owner's own visit isn't counted.
  await c.get(`/r/${slug}`);

  // A customer on another phone, plus a WhatsApp link preview bot.
  const customer = client();
  const page = await customer.get(`/r/${slug}`);
  assert.equal(page.status, 200);
  assert.match(page.text_, /Thanks for choosing ABC Plumbing/);
  assert.match(page.text_, /Leave a Google Review/);
  assert.doesNotMatch(page.text_, /star rating|5[- ]star/i);
  await fetch(`${base}/r/${slug}`, { headers: { 'user-agent': 'WhatsApp/2.23.20.0 A' } });
  const go = await customer.get(`/r/${slug}/go?s=qr`);
  assert.equal(go.status, 302);
  assert.equal(go.headers.get('location'), 'https://g.page/r/Cabc123/review');

  const after = await c.get('/app');
  assert.match(after.text_, /<span class="stat-num">1<\/span><span class="stat-label">Today/);
  assert.match(after.text_, /1 tapped through to Google this month/);

  // Changing the Google link doesn't change the QR slug.
  const _csrf = await c.csrf('/app/settings');
  const fd = new FormData();
  Object.entries({ _csrf, name: 'ABC Plumbing', brand_colour: '#b91c1c', google_review_url: 'https://g.page/r/NEWLINK/review' }).forEach(
    ([k, v]) => fd.append(k, v),
  );
  const saved = await fetch(`${base}/app/settings/business`, { method: 'POST', body: fd, headers: cookieHeader(c), redirect: 'manual' });
  assert.equal(saved.status, 302);
  assert.equal(slugOf('plumber@example.com'), slug);
  const go2 = await customer.get(`/r/${slug}/go`);
  assert.equal(go2.headers.get('location'), 'https://g.page/r/NEWLINK/review');
});

test('logo upload: real images accepted, fakes rejected', async () => {
  const c = client();
  await c.signup('logo@example.com');
  const _csrf = await c.csrf('/app/setup');
  const send = async (buf, type, name) => {
    const fd = new FormData();
    Object.entries({ _csrf, name: 'Logo Co', brand_colour: '#0f766e', google_review_url: 'g.page/r/x/review' }).forEach(([k, v]) =>
      fd.append(k, v),
    );
    fd.append('logo', new Blob([buf], { type }), name);
    return fetch(`${base}/app/setup`, { method: 'POST', body: fd, headers: cookieHeader(c), redirect: 'manual' });
  };
  const fake = await send(Buffer.from('<svg onload=alert(1)>'), 'image/png', 'evil.png');
  assert.equal(fake.status, 400);
  const webp = await sharp({ create: { width: 300, height: 120, channels: 3, background: '#ff0000' } }).webp().toBuffer();
  const ok = await send(webp, 'image/webp', 'logo.webp');
  assert.equal(ok.status, 302);
  const file = db.prepare("SELECT logo_file FROM businesses WHERE name = 'Logo Co'").get().logo_file;
  assert.match(file, /^[0-9a-f]{24}\.png$/);
  const served = await fetch(`${base}/u/${file}`);
  assert.equal(served.headers.get('content-type'), 'image/png');
});

test('users cannot reach each other’s data; admin is locked down', async () => {
  const a = client();
  await a.signup('a@example.com');
  await a.setup({ name: 'Alpha Electrics' });
  const b = client();
  await b.signup('b@example.com');
  await b.setup({ name: 'Bravo Builders' });

  const dashB = await b.get('/app');
  assert.match(dashB.text_, /Bravo Builders/);
  assert.doesNotMatch(dashB.text_, /Alpha Electrics/);
  assert.equal((await b.get('/admin')).status, 404);

  const anon = client();
  assert.equal((await anon.get('/app/files/qr.png')).status, 302);

  // HTML in a business name is escaped everywhere.
  const x = client();
  await x.signup('xss@example.com');
  await x.setup({ name: '<script>alert(1)</script>' });
  const page = await client().get(`/r/${slugOf('xss@example.com')}`);
  assert.doesNotMatch(page.text_, /<script>alert/);
  assert.match(page.text_, /&lt;script&gt;/);
});

test('admin can see stats and disable an account, which stops its QR', async () => {
  const boss = client();
  await boss.signup('boss@example.com');
  const home = await boss.get('/admin');
  assert.equal(home.status, 200);
  assert.match(home.text_, /Total users/);
  assert.match(home.text_, /Active subscriptions/);

  const victimId = db.prepare("SELECT id FROM users WHERE email = 'a@example.com'").get().id;
  const _csrf = await boss.csrf(`/admin/users/${victimId}`);
  await boss.post(`/admin/users/${victimId}/disable`, { form: { _csrf } });
  const r = await client().get(`/r/${slugOf('a@example.com')}`);
  assert.equal(r.status, 410);
  const login = client();
  const t = await login.csrf('/login');
  const res = await login.post('/login', { form: { _csrf: t, email: 'a@example.com', password: 'correct horse' } });
  assert.equal(res.status, 403);
});

test('expired trial: app points to billing and the QR stops working', async () => {
  const c = client();
  await c.signup('late@example.com');
  await c.setup({ name: 'Late Locksmiths' });
  const slug = slugOf('late@example.com');
  db.prepare("UPDATE users SET trial_ends_at = ? WHERE email = 'late@example.com'").run(new Date(Date.now() - 864e5).toISOString());
  assert.equal((await c.get('/app/show')).headers.get('location'), '/app/billing?expired=1');
  assert.match((await c.get('/app')).text_, /free trial has ended/);
  assert.equal((await client().get(`/r/${slug}`)).status, 410);
  assert.equal((await client().get(`/r/${slug}/go`)).status, 410);
  // Subscribing switches the same QR code back on.
  db.prepare("UPDATE users SET subscription_status = 'active', stripe_subscription_id = 'sub_late' WHERE email = 'late@example.com'").run();
  assert.equal((await client().get(`/r/${slug}`)).status, 200);
});

test('Stripe webhook: signed events update the subscription; unsigned are refused', async () => {
  const c = client();
  await c.signup('payer@example.com');
  const user = db.prepare("SELECT id FROM users WHERE email = 'payer@example.com'").get();
  db.prepare("UPDATE users SET stripe_customer_id = 'cus_123' WHERE id = ?").run(user.id);
  const periodEnd = Math.floor(Date.now() / 1000) + 30 * 86400;
  const event = {
    id: 'evt_1',
    type: 'customer.subscription.updated',
    data: {
      object: {
        id: 'sub_123',
        object: 'subscription',
        customer: 'cus_123',
        status: 'active',
        cancel_at_period_end: false,
        metadata: {},
        items: { data: [{ price: { id: 'price_annual' }, current_period_end: periodEnd }] },
      },
    },
  };
  const payload = JSON.stringify(event);
  const unsigned = await fetch(`${base}/stripe/webhook`, { method: 'POST', body: payload, headers: { 'content-type': 'application/json' } });
  assert.equal(unsigned.status, 400);

  const sig = Stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_test' });
  const r = await fetch(`${base}/stripe/webhook`, {
    method: 'POST',
    body: payload,
    headers: { 'content-type': 'application/json', 'stripe-signature': sig },
  });
  assert.equal(r.status, 200);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  assert.equal(u.subscription_status, 'active');
  assert.equal(u.plan_id, 'annual');
  assert.equal(u.stripe_subscription_id, 'sub_123');
  assert.equal(u.current_period_end, new Date(periodEnd * 1000).toISOString());
});

test('forgot password never reveals whether an account exists', async () => {
  const c = client();
  const _csrf = await c.csrf('/forgot');
  const a = await c.post('/forgot', { form: { _csrf, email: 'nobody@example.com' } });
  const b = await c.post('/forgot', { form: { _csrf, email: 'plumber@example.com' } });
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  const strip = (t) => t.replace(/[\w.+-]+@example\.com/g, '');
  assert.equal(strip(a.text_), strip(b.text_));
});

function cookieHeader(c) {
  return { 'user-agent': PHONE_UA, cookie: c.cookie() };
}

async function fetchBuffer(c, url) {
  const r = await fetch(base + url, { headers: cookieHeader(c) });
  assert.equal(r.status, 200, `${url} → ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
