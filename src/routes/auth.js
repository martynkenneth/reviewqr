// Sign up, log in, log out, confirm email, forgot/reset password.
// Supabase Auth does the password checking and sends the emails.
const express = require('express');
const config = require('../config');
const { html } = require('../html');
const { sitePage } = require('../views/layout');
const auth = require('../lib/auth');
const wrap = require('../wrap');
const sec = require('../security');

const router = express.Router();

const limiter = sec.rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });
const emailLimiter = sec.rateLimit({ windowMs: 60 * 60 * 1000, max: 5 });

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const cleanEmail = (e) => String(e || '').trim().toLowerCase().slice(0, 254);

function authPage(req, { title, heading, intro, form, below }) {
  return sitePage({
    title,
    user: req.user,
    bodyClass: 'auth',
    body: html`<main class="wrap auth-wrap">
      <div class="card auth-card">
        <h1>${heading}</h1>
        ${intro ? html`<p class="muted">${intro}</p>` : ''} ${form}
      </div>
      ${below ? html`<p class="center">${below}</p>` : ''}
    </main>`,
  });
}

const errorBox = (msg) => (msg ? html`<p class="alert alert-error" role="alert">${msg}</p>` : '');
const noticeBox = (msg) => (msg ? html`<p class="alert alert-ok" role="status">${msg}</p>` : '');

function signupForm(req, { error, email = '' } = {}) {
  return authPage(req, {
    title: 'Create your account',
    heading: 'Create your account',
    intro: `Free for ${config.trialDays} days. No card needed.`,
    form: html`${errorBox(error)}
      <form method="post" action="/signup" class="stack">
        <input type="hidden" name="_csrf" value="${req.csrfToken}" />
        <label>Email<input type="email" name="email" value="${email}" autocomplete="email" inputmode="email" required /></label>
        <label
          >Password<input type="password" name="password" autocomplete="new-password" minlength="8" required />
          <small class="muted">At least 8 characters.</small></label
        >
        <button class="btn btn-block btn-large" type="submit">Create account</button>
        <p class="muted small">By continuing you agree to our <a href="/terms">terms</a> and <a href="/privacy">privacy policy</a>.</p>
      </form>`,
    below: html`Already have an account? <a href="/login">Log in</a>`,
  });
}

function loginForm(req, { error, notice, email = '' } = {}) {
  return authPage(req, {
    title: 'Log in',
    heading: 'Welcome back',
    form: html`${errorBox(error)} ${noticeBox(notice)}
      <form method="post" action="/login" class="stack">
        <input type="hidden" name="_csrf" value="${req.csrfToken}" />
        <input type="hidden" name="next" value="${sec.safeNext(req.query.next || req.body?.next)}" />
        <label>Email<input type="email" name="email" value="${email}" autocomplete="email" inputmode="email" required /></label>
        <label>Password<input type="password" name="password" autocomplete="current-password" required /></label>
        <button class="btn btn-block btn-large" type="submit">Log in</button>
        <p class="center"><a href="/forgot">Forgot password?</a></p>
      </form>`,
    below: html`New here? <a href="/signup">Create an account</a>`,
  });
}

router.get('/signup', (req, res) => (req.user ? res.redirect('/app') : res.send(signupForm(req))));

// Where Supabase's emailed links send people back to.
const confirmUrl = () => `${config.baseUrl}/auth/confirm`;

function checkEmailPage(req, email, what) {
  return authPage(req, {
    title: 'Check your email',
    heading: 'Check your email',
    intro: `We've sent a link to ${email}. ${what} You can open it on this phone or any other device.`,
    form: html`<p class="muted small">Can't see it? Check your spam or junk folder. The link works for 1 hour.</p>`,
    below: html`<a href="/login">Back to log in</a>`,
  });
}

router.post(
  '/signup',
  limiter,
  wrap(async (req, res) => {
    const email = cleanEmail(req.body.email);
    const password = String(req.body.password || '');
    if (!EMAIL.test(email)) return res.status(400).send(signupForm(req, { error: 'Please enter a valid email address.', email }));
    const problem = sec.passwordProblem(password);
    if (problem) return res.status(400).send(signupForm(req, { error: problem, email }));

    const r = await auth.signUp(email, password, confirmUrl());
    if (r.error) return res.status(400).send(signupForm(req, { error: r.error, email }));
    if (r.existing && !r.user) {
      return res
        .status(400)
        .send(signupForm(req, { error: 'That email already has an account. Try logging in instead.', email }));
    }
    if (!r.session) {
      // Email confirmation is switched on in Supabase. (When the email is
      // already registered Supabase doesn't say so; this page is the same.)
      return res.send(checkEmailPage(req, email, 'Tap it to confirm your email and finish setting up.'));
    }
    await sec.profileFor(r.user);
    sec.setSessionCookies(res, r.session, { newLogin: true });
    res.redirect('/app/setup');
  }),
);

router.get('/login', (req, res) => (req.user ? res.redirect('/app') : res.send(loginForm(req))));

router.post(
  '/login',
  limiter,
  wrap(async (req, res) => {
    const email = cleanEmail(req.body.email);
    const r = await auth.signIn(email, String(req.body.password || ''));
    if (r.error === 'unconfirmed') {
      return res.status(401).send(loginForm(req, { error: 'Please confirm your email first — check your inbox for our link.', email }));
    }
    if (r.error) return res.status(401).send(loginForm(req, { error: "That email and password don't match.", email }));
    const profile = await sec.profileFor(r.user);
    if (profile.disabled_at) {
      await auth.signOut(r.session.access_token);
      return res
        .status(403)
        .send(loginForm(req, { error: `This account has been disabled. Please contact ${config.supportEmail}.`, email }));
    }
    sec.setSessionCookies(res, r.session, { newLogin: true });
    res.redirect(sec.safeNext(req.body.next));
  }),
);

router.post(
  '/logout',
  wrap(async (req, res) => {
    await sec.logOut(req, res);
    // Wipe offline copies of private pages on this device.
    res.set('Clear-Site-Data', '"cache", "storage"');
    res.redirect('/');
  }),
);

// --- Links from emails ---------------------------------------------------------
//
// Supabase emails a link to /auth/confirm?token_hash=...&type=...
// Opening it shows a button rather than acting straight away, because some
// email apps "preview" links automatically, which would use up the one-time
// link before the person ever taps it.

const CONFIRM_TYPES = {
  email: { heading: 'Confirm your email', button: 'Confirm my email', next: '/app/setup' },
  signup: { heading: 'Confirm your email', button: 'Confirm my email', next: '/app/setup', otpType: 'email' },
  recovery: { heading: 'Reset your password', button: 'Choose a new password', next: '/reset-password' },
  email_change: { heading: 'Confirm your new email', button: 'Confirm new email', next: '/app/settings?notice=email' },
};

const expiredPage = (req) =>
  authPage(req, {
    title: 'Link expired',
    heading: 'That link has expired',
    intro: 'Links from our emails only work once, for 1 hour.',
    form: html`<a class="btn btn-block" href="/forgot">Reset your password</a>`,
    below: html`<a href="/login">Back to log in</a>`,
  });

router.get('/auth/confirm', (req, res) => {
  const t = CONFIRM_TYPES[req.query.type];
  const token = typeof req.query.token_hash === 'string' ? req.query.token_hash : '';
  if (!t || !token) return res.status(400).send(expiredPage(req));
  res.send(
    authPage(req, {
      title: t.heading,
      heading: t.heading,
      form: html`<form method="post" action="/auth/confirm" class="stack">
        <input type="hidden" name="_csrf" value="${req.csrfToken}" />
        <input type="hidden" name="token_hash" value="${token}" />
        <input type="hidden" name="type" value="${req.query.type}" />
        <button class="btn btn-block btn-large" type="submit">${t.button}</button>
      </form>`,
    }),
  );
});

router.post(
  '/auth/confirm',
  limiter,
  wrap(async (req, res) => {
    const t = CONFIRM_TYPES[req.body.type];
    if (!t) return res.status(400).send(expiredPage(req));
    const r = await auth.verifyOtp(String(req.body.token_hash || ''), t.otpType || req.body.type);
    if (r.error) return res.status(400).send(expiredPage(req));
    const profile = await sec.profileFor(r.user);
    if (profile.disabled_at) return res.status(403).send(loginForm(req, { error: 'This account has been disabled.' }));
    sec.setSessionCookies(res, r.session, { newLogin: true });
    res.redirect(t.next);
  }),
);

// --- Forgot / reset password ---------------------------------------------------

router.get('/forgot', (req, res) =>
  res.send(
    authPage(req, {
      title: 'Reset password',
      heading: 'Reset your password',
      intro: "Enter your email and we'll send you a link to set a new password.",
      form: html`<form method="post" action="/forgot" class="stack">
        <input type="hidden" name="_csrf" value="${req.csrfToken}" />
        <label>Email<input type="email" name="email" autocomplete="email" inputmode="email" required /></label>
        <button class="btn btn-block btn-large" type="submit">Send reset link</button>
      </form>`,
      below: html`<a href="/login">Back to log in</a>`,
    }),
  ),
);

router.post(
  '/forgot',
  emailLimiter,
  wrap(async (req, res) => {
    const email = cleanEmail(req.body.email);
    if (EMAIL.test(email)) await auth.sendPasswordReset(email, confirmUrl());
    // Same answer either way, so this can't be used to discover who has an account.
    res.send(checkEmailPage(req, email, 'If there is an account for that email, the link lets you choose a new password.'));
  }),
);

function resetForm(req, error) {
  return authPage(req, {
    title: 'Choose a new password',
    heading: 'Choose a new password',
    form: html`${errorBox(error)}
      <form method="post" action="/reset-password" class="stack">
        <input type="hidden" name="_csrf" value="${req.csrfToken}" />
        <label>New password<input type="password" name="password" autocomplete="new-password" minlength="8" required /></label>
        <button class="btn btn-block btn-large" type="submit">Save password</button>
      </form>`,
  });
}

// Reached through the emailed reset link, which logs them in first.
router.get('/reset-password', sec.requireUser, (req, res) => res.send(resetForm(req)));

router.post(
  '/reset-password',
  sec.requireUser,
  limiter,
  wrap(async (req, res) => {
    const problem = sec.passwordProblem(req.body.password);
    if (problem) return res.status(400).send(resetForm(req, problem));
    const r = await auth.setPassword(req.user.id, req.body.password);
    if (r.error) return res.status(400).send(resetForm(req, r.error));
    await auth.signOut(req.tokens.access_token, 'others'); // log out everywhere else
    res.redirect(req.business ? '/app/settings?notice=password' : '/app/setup');
  }),
);

module.exports = { router, EMAIL, cleanEmail, errorBox, noticeBox };
