// End-to-end tests over HTTP against a throwaway database (PGlite in memory)
// and the local stand-in for Supabase Auth, which sends the same one-time
// email links that Supabase does.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reviewqr-test-'));
Object.assign(process.env, {
  DATA_DIR: tmp,
  DB_FILE: ':memory:',
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
const { query, one } = require('../src/db');
const localAuth = require('../src/lib/auth/local');
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
    drop: (name) => jar.delete(name),
    has: (name) => jar.has(name),
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

const slugOf = async (userEmail) =>
  (await one('SELECT b.qr_slug FROM businesses b JOIN profiles u ON u.id = b.user_id WHERE u.email = $1', [userEmail])).qr_slug;

// The most recent emailed link of a type for an address, as a path.
function lastLink(to, type) {
  const m = [...localAuth.outbox].reverse().find((e) => e.to === to && e.type === type);
  assert.ok(m, `no ${type} email for ${to}`);
  const u = new URL(m.link);
  return { path: u.pathname + u.search, token: u.searchParams.get('token_hash') };
}

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
  assert.match(r.text_, /<title>Google review QR codes for tradespeople · QR Review<\/title>/);
  assert.match(r.text_, /<link rel="canonical" href="https:\/\/reviews.example\/" \/>/);
  // The trades page is the same content, pointing search engines at the home page.
  const trades = await c.get('/trades');
  assert.equal(trades.status, 200);
  assert.match(trades.text_, /before you leave the job/);
  assert.match(trades.text_, /<link rel="canonical" href="https:\/\/reviews.example\/" \/>/);
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

  const slug = await slugOf('plumber@example.com');
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
  assert.equal(await slugOf('plumber@example.com'), slug);
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
  const file = (await one("SELECT logo_file FROM businesses WHERE name = 'Logo Co'")).logo_file;
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
  const page = await client().get(`/r/${await slugOf('xss@example.com')}`);
  assert.doesNotMatch(page.text_, /<script>alert/);
  assert.match(page.text_, /&lt;script&gt;/);
});

test('admin can see stats and disable an account, which stops its QR and login', async () => {
  const victim = client();
  await victim.signup('victim@example.com');
  await victim.setup({ name: 'Victim Roofing' });
  const boss = client();
  await boss.signup('boss@example.com');
  const home = await boss.get('/admin');
  assert.equal(home.status, 200);
  assert.match(home.text_, /Total users/);
  assert.match(home.text_, /Active subscriptions/);

  const victimId = (await one("SELECT id FROM profiles WHERE email = 'victim@example.com'")).id;
  const _csrf = await boss.csrf(`/admin/users/${victimId}`);
  await boss.post(`/admin/users/${victimId}/disable`, { form: { _csrf } });
  assert.equal((await client().get(`/r/${await slugOf('victim@example.com')}`)).status, 410);
  // Already-logged-in sessions stop working...
  assert.equal((await victim.get('/app')).status, 302);
  // ...and so does logging in again.
  const login = client();
  const t = await login.csrf('/login');
  const res = await login.post('/login', { form: { _csrf: t, email: 'victim@example.com', password: 'correct horse' } });
  assert.equal(res.status, 401);
  assert.equal((await boss.get('/admin/users/not-a-uuid')).status, 404);
});

test('expired trial: app points to billing and the QR stops working', async () => {
  const c = client();
  await c.signup('late@example.com');
  await c.setup({ name: 'Late Locksmiths' });
  const slug = await slugOf('late@example.com');
  await query("UPDATE profiles SET trial_ends_at = $1 WHERE email = 'late@example.com'", [new Date(Date.now() - 864e5).toISOString()]);
  assert.equal((await c.get('/app/show')).headers.get('location'), '/app/billing?expired=1');
  assert.match((await c.get('/app')).text_, /free trial has ended/);
  assert.equal((await client().get(`/r/${slug}`)).status, 410);
  assert.equal((await client().get(`/r/${slug}/go`)).status, 410);
  // Subscribing switches the same QR code back on.
  await query("UPDATE profiles SET subscription_status = 'active', stripe_subscription_id = 'sub_late' WHERE email = 'late@example.com'");
  assert.equal((await client().get(`/r/${slug}`)).status, 200);
});

test('Stripe webhook: signed events update the subscription; unsigned are refused', async () => {
  const c = client();
  await c.signup('payer@example.com');
  const user = await one("SELECT id FROM profiles WHERE email = 'payer@example.com'");
  await query("UPDATE profiles SET stripe_customer_id = 'cus_123' WHERE id = $1", [user.id]);
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
  const u = await one('SELECT * FROM profiles WHERE id = $1', [user.id]);
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

test('email confirmation and password reset work through one-time links', async () => {
  process.env.LOCAL_CONFIRM_EMAIL = '1'; // like Supabase with "Confirm email" on
  const c = client();
  const s = await c.signup('confirm@example.com');
  delete process.env.LOCAL_CONFIRM_EMAIL;
  assert.equal(s.status, 200);
  assert.match(s.text_, /Check your email/);

  // Can't log in until confirmed.
  let _csrf = await c.csrf('/login');
  const early = await c.post('/login', { form: { _csrf, email: 'confirm@example.com', password: 'correct horse' } });
  assert.equal(early.status, 401);
  assert.match(early.text_, /confirm your email/);

  // Opening the link only shows a button (email apps that preview links
  // can't use it up); pressing it confirms and logs in.
  const link = lastLink('confirm@example.com', 'email');
  const page = await c.get(link.path);
  assert.equal(page.status, 200);
  assert.match(page.text_, /Confirm my email/);
  await c.get(link.path);
  _csrf = page.text_.match(/name="_csrf" value="([^"]+)"/)[1];
  const done = await c.post('/auth/confirm', { form: { _csrf, token_hash: link.token, type: 'email' } });
  assert.equal(done.status, 302);
  assert.equal(done.headers.get('location'), '/app/setup');
  assert.equal((await c.get('/app/setup')).status, 200);
  // Links work once.
  _csrf = await c.csrf('/app/setup');
  const again = await c.post('/auth/confirm', { form: { _csrf, token_hash: link.token, type: 'email' } });
  assert.equal(again.status, 400);

  // Forgotten password: the emailed link logs them in to choose a new one.
  const other = client();
  _csrf = await other.csrf('/forgot');
  await other.post('/forgot', { form: { _csrf, email: 'confirm@example.com' } });
  const reset = lastLink('confirm@example.com', 'recovery');
  _csrf = (await other.get(reset.path)).text_.match(/name="_csrf" value="([^"]+)"/)[1];
  const r = await other.post('/auth/confirm', { form: { _csrf, token_hash: reset.token, type: 'recovery' } });
  assert.equal(r.headers.get('location'), '/reset-password');
  _csrf = await other.csrf('/reset-password');
  const saved = await other.post('/reset-password', { form: { _csrf, password: 'brand new pass' } });
  assert.equal(saved.status, 302);
  const fresh = client();
  _csrf = await fresh.csrf('/login');
  assert.equal((await fresh.post('/login', { form: { _csrf, email: 'confirm@example.com', password: 'correct horse' } })).status, 401);
  assert.equal((await fresh.post('/login', { form: { _csrf, email: 'confirm@example.com', password: 'brand new pass' } })).status, 302);
});

test('changing email needs the current password and a confirmation link', async () => {
  const c = client();
  await c.signup('old@example.com');
  await c.setup({ name: 'Mover Co' });
  let _csrf = await c.csrf('/app/settings');
  const wrong = await c.post('/app/settings/email', { form: { _csrf, email: 'new@example.com', current_password: 'nope nope' } });
  assert.equal(wrong.status, 400);
  const ok = await c.post('/app/settings/email', { form: { _csrf, email: 'new@example.com', current_password: 'correct horse' } });
  assert.equal(ok.headers.get('location'), '/app/settings?notice=email_sent');
  const link = lastLink('new@example.com', 'email_change');
  _csrf = (await c.get(link.path)).text_.match(/name="_csrf" value="([^"]+)"/)[1];
  await c.post('/auth/confirm', { form: { _csrf, token_hash: link.token, type: 'email_change' } });
  await c.get('/app/settings');
  assert.ok(await one("SELECT 1 FROM profiles WHERE email = 'new@example.com'"));
});

test('an expired login is refreshed quietly', async () => {
  const c = client();
  await c.signup('refresh@example.com');
  c.drop('qr_at'); // as if the 1-hour access token had expired
  const r = await c.get('/app/setup');
  assert.equal(r.status, 200);
  assert.ok(c.has('qr_at'));
  c.drop('qr_at');
  c.drop('qr_rt');
  assert.equal((await c.get('/app/setup')).status, 302);
});

test('the Netlify function serves pages and binary downloads', async () => {
  const { handler } = require('../netlify/functions/app');
  const event = (p, headers = {}) => ({
    httpMethod: 'GET',
    path: p,
    headers: { host: 'reviews.example', 'user-agent': PHONE_UA, ...headers },
    multiValueHeaders: {},
    queryStringParameters: {},
    body: null,
    isBase64Encoded: false,
  });
  const home = await handler(event('/'), {});
  assert.equal(home.statusCode, 200);
  assert.match(home.body, /before you leave the job/);
  const direct = await handler(event('/.netlify/functions/app/trades'), {});
  assert.equal(direct.statusCode, 200);

  const c = client();
  await c.signup('netlify@example.com');
  await c.setup({ name: 'Edge Electrics' });
  const png = await handler(event('/app/files/qr.png', { cookie: c.cookie() }), {});
  assert.equal(png.statusCode, 200);
  assert.equal(png.isBase64Encoded, true);
  assert.equal(Buffer.from(png.body, 'base64').subarray(1, 4).toString(), 'PNG');
  const pdf = await handler(event('/app/files/a4.pdf', { cookie: c.cookie() }), {});
  assert.equal(Buffer.from(pdf.body, 'base64').subarray(0, 4).toString(), '%PDF');
});

function cookieHeader(c) {
  return { 'user-agent': PHONE_UA, cookie: c.cookie() };
}

async function fetchBuffer(c, url) {
  const r = await fetch(base + url, { headers: cookieHeader(c) });
  assert.equal(r.status, 200, `${url} → ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
