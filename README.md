# QR Review — qrreview.co.uk

A mobile-first web app (installable PWA) for UK small businesses, starting with tradespeople. It gives each business a branded, **permanent** QR code that sends customers to its Google review page.

**Finish job → open app → Show QR → customer scans → Google review page.**

Runs on **Netlify** (the app, as one serverless function, plus static files on the CDN) and **Supabase** (Postgres database, login, and logo storage).

**To put it online, follow [docs/SETUP.md](docs/SETUP.md).**

## Run it locally

Needs Node.js 22 or newer. You don't need Supabase to try it locally:
- If no `SUPABASE_*` settings are present, the app uses stand-ins: a Postgres that runs inside Node (PGlite), a local copy of Supabase's login flow, and a folder for logos.
- Emails, such as confirmation and reset links, are printed in the terminal.

```bash
git clone https://github.com/martynkenneth/reviewqr && cd reviewqr
npm install
npm run dev          # http://localhost:3000
npm test             # end-to-end tests, including decoding the generated QR codes
```

Without Stripe settings, the app still runs and the 14-day trial works. The Plans screen says payments aren't switched on yet.

To make yourself an admin, put your email in `ADMIN_EMAILS`. You're promoted the next time you log in.

## Stripe

- **Prices.** Create a Product with two recurring Prices: £9.99/month and £99/year. Put their IDs in `STRIPE_PRICE_MONTHLY` and `STRIPE_PRICE_ANNUAL`.
- **Webhook.** Add a webhook endpoint `https://qrreview.co.uk/stripe/webhook` with these events:
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.paid`
  - `invoice.payment_failed`

  Put its signing secret in `STRIPE_WEBHOOK_SECRET`.
- **Customer portal.** Under **Settings → Billing → Customer portal**, turn on cancelling subscriptions, updating payment methods, and switching plans (add both Prices). That gives upgrade and downgrade with no extra code.
- **Retries.** Turn on Stripe's automatic retry and failed-payment emails ("Smart Retries").

## Things that must never change or lapse

- **`BASE_URL` / the domain.** `https://qrreview.co.uk` is printed inside every QR code. Keep auto-renew on.
- **The `logos` bucket and the database.** Upgrade to Supabase Pro before taking paying customers. Free projects pause when idle, and Pro adds daily backups.

## How it works

| Piece | Where |
|---|---|
| Permanent short link `/r/<slug>` → branded customer page → `/r/<slug>/go` → 302 to Google | `src/routes/public.js` |
| QR, branded PNG, A6/A5/A4 PDFs (fonts bundled, so they look the same on any server) | `src/lib/qr.js`, `src/lib/text.js` |
| Sign-up, login, email links (confirm, reset, change email) via Supabase Auth | `src/routes/auth.js`, `src/lib/auth/` |
| Login cookies, CSRF, rate limits | `src/security.js` |
| Logo storage (Supabase Storage, served at `/u/…`) | `src/lib/storage.js` |
| Setup, dashboard, Show QR, download, share, visits, settings | `src/routes/app.js` |
| Stripe Checkout, Billing Portal, cancel, webhooks | `src/routes/billing.js` |
| Admin | `src/routes/admin.js` |
| Tables: profiles, businesses, qr_visits, stripe_events (locked with row level security) | `db/schema.sql`, `src/db.js` |
| Netlify function entry point, build step and settings | `netlify/functions/app.js`, `scripts/netlify-build.js`, `netlify.toml` |
| Plans and prices (config, not hard-coded) | `src/config.js` |
| Offline "Show QR", installable app | `public/sw.js`, `public/manifest.webmanifest` |

### Product rules built in

- **No review gating.** Every customer gets the same page and the same button to Google. The app never asks for a star rating, and the wording is neutral throughout: "How did we do?", "We'd love to hear about your experience".
- **Honest numbers.** The app counts "Review page visits" and "Tapped through to Google", and never "reviews". Link-preview bots (WhatsApp, iMessage and similar) and the owner's own visits are not counted.
- **Customer privacy.** Customers never have to log in and are never asked for details. The app doesn't store IP addresses. A visitor code salted per day lets you spot repeat taps within a day, but it can't follow anyone across days.
- **Permanent QR codes.** Changing the Google link in Settings doesn't change the QR code.
- **Google-only redirects.** Only Google-owned review links are accepted, so nobody can use your trusted short links to send people to a scam site.

### Security

- **Passwords** are held by Supabase Auth; the app never stores them.
- **Login cookies.** The Supabase login tokens sit in httpOnly, SameSite cookies, and expired tokens are refreshed quietly.
- **Email links** (confirm, reset, change email) open a page with a button rather than acting straight away. Email apps that preview links therefore can't use them up.
- **CSRF protection** on every form.
- **Rate limits** on logins and email-sending forms, on top of Supabase's own limits.
- **Database tables are locked** with row level security. Only the app's server can read or write them; browsers can't, even through Supabase's API.
- **Content Security Policy.** A strict one is set, and the app has no inline scripts.
- **Uploaded logos** are checked by their contents (JPG/PNG/WebP only) and re-encoded to clean PNGs. Large phone photos are shrunk in the browser first, and the server limit is 4MB.
- **Scoped queries.** Every query is limited to the logged-in user.
- **Card details** go only to Stripe.

### Decisions you may want to change

- **Trial without a card.** Signing up needs no card. If someone subscribes during the trial, Stripe doesn't charge them until the trial ends.
- **When the trial ends, the QR code stops.** Without a plan, the customer page says "This review link isn't active right now" (so do cancelled subscriptions once the paid period runs out, and disabled accounts). Subscribing switches the same code back on, so nothing needs reprinting. The dashboard warns in the last 3 days of the trial. A failed card payment does *not* stop the QR while Stripe retries.
- **Branded sign wording.** The branded sign says "How did we do? Scan to leave us a Google review." The suggested "Happy with our work?" was left out because it only invites happy customers, which goes against Google's policy on selectively asking for reviews.

## Landing pages for each industry

The app works the same for every business; only the marketing wording changes. Each industry's wording lives in `src/views/industries.js`:

- `trades` is the home page (`/`) and is also at `/trades`.
- To target a new group (hairdressers, cafés...), copy the `trades` entry, give it a new `slug` such as `hair-beauty`, and rewrite the wording. It appears at `/hair-beauty` automatically.
- To make a different industry the home page, set `DEFAULT_INDUSTRY` to its slug.

## Adding the future features

These are easy to add because of how the app is built:

- **NFC cards.** Write `https://qrreview.co.uk/r/<slug>?s=nfc` to the card. Visits are already tagged with a source.
- **Campaign tracking** (van, invoices, business cards). Use the same `?s=` source tag. A later version can add a `qr_codes` table with its own slugs that point at a business.
- **SMS / WhatsApp review requests.** The share message and link already exist. Add a sending provider behind a new route.
- **Google review monitoring, AI replies and a website widget.** Connect the Google Business Profile API with OAuth, then store reviews in a new table.
- **Team accounts and multiple locations.** `businesses.user_id` is currently unique. Add a membership table and remove that constraint.
