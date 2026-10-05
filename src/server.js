const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const config = require('./config');
const sec = require('./security');
const { html } = require('./html');
const { sitePage } = require('./views/layout');
const billing = require('./routes/billing');
const storage = require('./lib/storage');
const wrap = require('./wrap');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Behind a hosting proxy (Render, Fly, Railway, nginx) so req.ip and secure
  // cookies work. Set TRUST_PROXY=0 if the app is exposed directly.
  app.set('trust proxy', process.env.TRUST_PROXY === '0' ? false : 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"], // brand colours are set per page
          // Logos are served from /u/; outside Netlify that redirects to Supabase Storage.
          imgSrc: ["'self'", 'data:', 'blob:', ...(config.supabase.url ? [config.supabase.url] : [])],
          connectSrc: ["'self'"],
          formAction: ["'self'", 'https://checkout.stripe.com', 'https://billing.stripe.com'],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: config.secureCookies ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      hsts: config.secureCookies,
    }),
  );

  // Stripe needs the untouched body to verify the signature.
  app.post('/stripe/webhook', express.raw({ type: 'application/json', limit: '1mb' }), wrap(billing.webhook));

  const pub = path.join(__dirname, '..', 'public');
  app.get('/sw.js', (req, res) => {
    res.set('Cache-Control', 'no-cache').sendFile(path.join(pub, 'sw.js'));
  });
  // On Netlify these files are served by its CDN and never reach this code.
  app.use(express.static(pub, { maxAge: config.secureCookies ? '7d' : 0 }));
  // Logos have random names that change on every upload, so cache forever.
  if (storage.publicUrl) app.get('/u/:file', (req, res) => res.redirect(301, storage.publicUrl(req.params.file)));
  else app.use('/u', express.static(config.uploadDir, { maxAge: '365d', immutable: true, index: false }));

  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(sec.loadSession);
  // Multipart (logo upload) routes check CSRF themselves after parsing.
  app.use((req, res, next) => (req.is('multipart/form-data') ? next() : sec.verifyCsrf(req, res, next)));

  app.get('/healthz', (req, res) => res.send('ok'));
  app.use('/', require('./routes/public').router);
  app.use('/', require('./routes/auth').router);
  app.use('/app/billing', billing.router);
  app.use('/app', require('./routes/app').router);
  app.use('/admin', require('./routes/admin').router);

  app.use((req, res) => {
    res.status(404).send(
      sitePage({
        title: 'Not found',
        user: req.user,
        body: html`<main class="wrap narrow center section">
          <h1>Page not found</h1>
          <p><a class="btn" href="${req.user ? '/app' : '/'}">Go home</a></p>
        </main>`,
      }),
    );
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).send(
      sitePage({
        title: 'Something went wrong',
        user: req.user,
        body: html`<main class="wrap narrow center section">
          <h1>Sorry, something went wrong</h1>
          <p>Please try again in a moment.</p>
          <p><a class="btn" href="${req.user ? '/app' : '/'}">Go home</a></p>
        </main>`,
      }),
    );
  });
  return app;
}

if (require.main === module) {
  if (config.isProd && config.baseUrl.startsWith('http://localhost')) {
    console.warn('WARNING: BASE_URL is not set. QR codes will point at localhost!');
  }
  createApp().listen(config.port, () => console.log(`${config.appName} running on ${config.baseUrl} (port ${config.port})`));
}

module.exports = { createApp };
