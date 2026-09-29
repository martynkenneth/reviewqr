// Sign up, log in, log out, forgot/reset password.
const express = require('express');
const config = require('../config');
const { db, now } = require('../db');
const { html } = require('../html');
const { sitePage } = require('../views/layout');
const { sendMail } = require('../lib/mailer');
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

router.post('/signup', limiter, (req, res) => {
  const email = cleanEmail(req.body.email);
  const password = String(req.body.password || '');
  if (!EMAIL.test(email)) return res.status(400).send(signupForm(req, { error: 'Please enter a valid email address.', email }));
  const problem = sec.passwordProblem(password);
  if (problem) return res.status(400).send(signupForm(req, { error: problem, email }));
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    return res
      .status(400)
      .send(signupForm(req, { error: 'That email already has an account. Try logging in instead.', email }));
  }
  const trialEnds = new Date(Date.now() + config.trialDays * 864e5).toISOString();
  const { lastInsertRowid } = db
    .prepare('INSERT INTO users (email, password_hash, created_at, trial_ends_at, is_admin) VALUES (?, ?, ?, ?, ?)')
    .run(email, sec.hashPassword(password), now(), trialEnds, config.adminEmails.includes(email) ? 1 : 0);
  sec.createSession(res, Number(lastInsertRowid));
  res.redirect('/app/setup');
});

router.get('/login', (req, res) => (req.user ? res.redirect('/app') : res.send(loginForm(req))));

router.post('/login', limiter, (req, res) => {
  const email = cleanEmail(req.body.email);
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  const ok = sec.verifyPassword(String(req.body.password || ''), user ? user.password_hash : sec.DUMMY_HASH);
  if (!user || !ok) {
    return res.status(401).send(loginForm(req, { error: "That email and password don't match.", email }));
  }
  if (user.disabled_at) {
    return res
      .status(403)
      .send(loginForm(req, { error: `This account has been disabled. Please contact ${config.supportEmail}.`, email }));
  }
  if (config.adminEmails.includes(user.email) && !user.is_admin) {
    db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(user.id);
  }
  sec.createSession(res, user.id);
  res.redirect(sec.safeNext(req.body.next));
});

router.post('/logout', (req, res) => {
  sec.destroySession(req, res);
  // Wipe offline copies of private pages on this device.
  res.set('Clear-Site-Data', '"cache", "storage"');
  res.redirect('/');
});

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

router.post('/forgot', emailLimiter, async (req, res, next) => {
  try {
    const email = cleanEmail(req.body.email);
    const user = db.prepare('SELECT id, email FROM users WHERE email = ? AND disabled_at IS NULL').get(email);
    if (user) {
      const token = sec.randomToken();
      db.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
        sec.sha256(token),
        user.id,
        new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      );
      await sendMail({
        to: user.email,
        subject: `Reset your ${config.appName} password`,
        text: `Someone (hopefully you) asked to reset your ${config.appName} password.\n\nSet a new password here (link works for 1 hour):\n${config.baseUrl}/reset/${token}\n\nIf you didn't ask for this, you can ignore this email.`,
      });
    }
    // Same answer either way, so this can't be used to discover who has an account.
    res.send(
      authPage(req, {
        title: 'Check your email',
        heading: 'Check your email',
        intro: `If ${email} has an account, we've sent a link to reset the password. It works for 1 hour.`,
        form: '',
        below: html`<a href="/login">Back to log in</a>`,
      }),
    );
  } catch (e) {
    next(e);
  }
});

function validReset(token) {
  const row = db.prepare('SELECT * FROM password_resets WHERE token_hash = ?').get(sec.sha256(String(token)));
  return row && !row.used_at && row.expires_at > now() ? row : null;
}

function resetForm(req, error) {
  return authPage(req, {
    title: 'Choose a new password',
    heading: 'Choose a new password',
    form: html`${errorBox(error)}
      <form method="post" class="stack">
        <input type="hidden" name="_csrf" value="${req.csrfToken}" />
        <label>New password<input type="password" name="password" autocomplete="new-password" minlength="8" required /></label>
        <button class="btn btn-block btn-large" type="submit">Save password</button>
      </form>`,
  });
}

router.get('/reset/:token', (req, res) => {
  if (!validReset(req.params.token)) {
    return res.status(400).send(
      authPage(req, {
        title: 'Link expired',
        heading: 'That link has expired',
        intro: 'Reset links only work once, for 1 hour.',
        form: html`<a class="btn btn-block" href="/forgot">Send a new link</a>`,
      }),
    );
  }
  res.send(resetForm(req));
});

router.post('/reset/:token', limiter, (req, res) => {
  const row = validReset(req.params.token);
  if (!row) return res.redirect(`/reset/${encodeURIComponent(req.params.token)}`);
  const problem = sec.passwordProblem(req.body.password);
  if (problem) return res.status(400).send(resetForm(req, problem));
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(sec.hashPassword(req.body.password), row.user_id);
  db.prepare('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(now(), row.user_id);
  sec.destroyAllSessions(row.user_id); // log out everywhere else
  res.send(loginForm(req, { notice: 'Password changed. Please log in.' }));
});

module.exports = { router, EMAIL, cleanEmail, errorBox, noticeBox };
