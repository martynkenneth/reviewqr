const config = require('../config');
const { html } = require('../html');
const { icon } = require('./icons');
const { textOn } = require('../lib/colour');

const ASSET_VERSION = require('../../package.json').version;

function head({ title, description, noindex, canonical }) {
  return html`<meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${title ? `${title} · ${config.appName}` : config.appName}</title>
    ${description ? html`<meta name="description" content="${description}" />` : ''}
    ${noindex ? html`<meta name="robots" content="noindex" />` : ''}
    ${canonical ? html`<link rel="canonical" href="${canonical}" />` : ''}
    <meta name="theme-color" content="#0f766e" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="icon" href="/icons/icon-192.png" type="image/png" />
    <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="${config.appName}" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <link rel="stylesheet" href="/css/app.css?v=${ASSET_VERSION}" />
    <script src="/js/app.js?v=${ASSET_VERSION}" defer></script>`;
}

function brandStyle(business) {
  if (!business) return '';
  return `--brand:${business.brand_colour};--on-brand:${textOn(business.brand_colour)}`;
}

// Marketing and login pages.
function sitePage({ title, description, canonical, body, user, bodyClass = '' }) {
  return html`<!doctype html>
    <html lang="en-GB">
      <head>
        ${head({ title, description, canonical })}
      </head>
      <body class="site ${bodyClass}">
        <header class="site-header">
          <div class="wrap row">
            <a class="wordmark" href="/">${icon('qr')}<span>${config.appName}</span></a>
            <nav class="site-nav">
              ${user
                ? html`<a class="btn btn-small" href="/app">Open app</a>`
                : html`<a href="/login">Log in</a><a class="btn btn-small" href="/signup">Start free</a>`}
            </nav>
          </div>
        </header>
        ${body}
        <footer class="site-footer">
          <div class="wrap">
            <p>
              ${config.appName} is not affiliated with Google. Customers write and submit their own reviews on
              Google.
            </p>
            <p><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="mailto:${config.supportEmail}">Contact</a></p>
          </div>
        </footer>
      </body>
    </html>`;
}

// Logged-in app pages: slim header, content, bottom nav on mobile.
function appPage({ title, body, req, active = '', back }) {
  const { business, user } = req;
  const tab = (href, name, label, key) =>
    html`<a href="${href}" class="tab ${active === key ? 'is-active' : ''}" ${active === key ? html`aria-current="page"` : ''}
      >${icon(name)}<span>${label}</span></a
    >`;
  return html`<!doctype html>
    <html lang="en-GB">
      <head>
        ${head({ title, noindex: true })}
      </head>
      <body class="app" style="${brandStyle(business)}">
        <header class="app-header">
          <div class="wrap row">
            ${back
              ? html`<a class="icon-btn" href="${back}" aria-label="Back">${icon('back')}</a>`
              : business && business.logo_file
                ? html`<img class="header-logo" src="/u/${business.logo_file}" alt="" />`
                : html`<span class="header-mark">${icon('qr')}</span>`}
            <strong class="header-title">${title}</strong>
            ${user && user.is_admin ? html`<a class="header-link" href="/admin">Admin</a>` : ''}
          </div>
        </header>
        <main class="wrap app-main">${body}</main>
        ${business
          ? html`<nav class="tabbar" aria-label="Main">
              ${tab('/app', 'home', 'Home', 'home')} ${tab('/app/qr', 'qr', 'QR', 'qr')}
              <a href="/app/show" class="tab tab-show" aria-label="Show QR full screen"
                ><span class="tab-show-circle">${icon('show')}</span><span>Show QR</span></a
              >
              ${tab('/app/analytics', 'chart', 'Visits', 'analytics')} ${tab('/app/settings', 'settings', 'Settings', 'settings')}
            </nav>`
          : ''}
      </body>
    </html>`;
}

// No chrome at all: full-screen QR and the public customer page.
function barePage({ title, body, business, bodyClass = '', noindex = true }) {
  return html`<!doctype html>
    <html lang="en-GB">
      <head>
        ${head({ title, noindex })}
      </head>
      <body class="bare ${bodyClass}" style="${brandStyle(business)}">
        ${body}
      </body>
    </html>`;
}

// Pages are sent as plain strings (res.send would treat the SafeHtml object as JSON).
const toString = (fn) => (opts) => String(fn(opts));
module.exports = { sitePage: toString(sitePage), appPage: toString(appPage), barePage: toString(barePage) };
