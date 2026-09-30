# QR Review — qrreview.co.uk

A mobile-first web app (installable PWA) for UK small businesses, starting with tradespeople. It gives each business a branded, **permanent** QR code that sends customers to its Google review page.

**Finish job → open app → Show QR → customer scans → Google review page.**

## Run it locally

Needs Node.js 22.13 or newer. There's no database server to install, because it uses SQLite built into Node.

```bash
git clone https://github.com/martynkenneth/reviewqr && cd reviewqr
npm install
npm run dev          # http://localhost:3000
npm test             # end-to-end tests (including decoding the generated QR codes)
```

Without SMTP settings, emails such as password resets are printed to the terminal. Without Stripe settings, the app still runs, the 14-day trial works, and the Plans screen says payments aren't switched on yet.

To make yourself an admin, put your email in `ADMIN_EMAILS` or run `npm run make-admin -- you@example.com`.

## Going live

1. The domain is **qrreview.co.uk**. Set `BASE_URL=https://qrreview.co.uk`. It's printed inside every QR code, so it must never change after people start printing, and the domain must never be allowed to lapse (keep auto-renew on).
2. Host it on anything that runs Node with a **persistent disk** for `DATA_DIR` (Render, Railway, Fly.io, a small VPS). A `Dockerfile` is included. Mount a volume at `/data`.
3. Copy `.env.example` to `.env` (or set the same variables in your host's dashboard).
4. **Stripe:**
   - Create a Product with two recurring Prices: £9.99/month and £99/year. Put their IDs in `STRIPE_PRICE_MONTHLY` and `STRIPE_PRICE_ANNUAL`.
   - Add a webhook endpoint `https://qrreview.co.uk/stripe/webhook` with these events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`. Put its signing secret in `STRIPE_WEBHOOK_SECRET`.
   - In **Settings → Billing → Customer portal**, turn on: cancel subscriptions, update payment methods, and switch plans (add both Prices). That gives you upgrade/downgrade with no extra code.
   - Turn on Stripe's automatic retry and failed-payment emails ("Smart Retries").
5. Back up `DATA_DIR` (the database plus uploaded logos) every day.

## How it works

| Piece | Where |
|---|---|
| Permanent short link `/r/<slug>` → branded customer page → `/r/<slug>/go` → 302 to Google | `src/routes/public.js` |
| QR, branded PNG, A6/A5/A4 PDFs (fonts bundled, so they look the same on any server) | `src/lib/qr.js`, `src/lib/text.js` |
| Sign-up, login, password reset | `src/routes/auth.js` |
| Setup, dashboard, Show QR, download, share, visits, settings | `src/routes/app.js` |
| Stripe Checkout, Billing Portal, cancel, webhooks | `src/routes/billing.js` |
| Admin | `src/routes/admin.js` |
| Tables: users, businesses, qr_visits, sessions, password_resets | `src/db.js` |
| Plans and prices (config, not hard-coded) | `src/config.js` |
| Offline "Show QR", installable app | `public/sw.js`, `public/manifest.webmanifest` |

### Product rules built in

- **No review gating.** Every customer gets the same page and the same button to Google. The app never asks for a star rating, and the wording is neutral throughout: "How did we do?", "We'd love to hear about your experience".
- **Honest numbers.** The app counts "Review page visits" and "Tapped through to Google", and never "reviews". Link-preview bots (WhatsApp, iMessage and similar) and the owner's own visits are not counted.
- **Customer privacy.** Customers never have to log in and are never asked for details. The app doesn't store IP addresses. A visitor code salted per day lets you spot repeat taps within a day, but it can't follow anyone across days.
- **Permanent QR codes.** Changing the Google link in Settings doesn't change the QR code.
- **Google-only redirects.** Only Google-owned review links are accepted, so nobody can use your trusted short links to send people to a scam site.

### Security

- Passwords are hashed with scrypt.
- The session cookie is httpOnly and SameSite, and only the token's hash is stored in the database.
- Every form has CSRF protection.
- Logins, sign-ups and resets are rate-limited.
- A strict Content Security Policy is set, and the app has no inline scripts.
- Uploaded logos are checked by their contents (JPG/PNG/WebP only), limited to 5MB, and re-encoded to clean PNGs.
- Every query is scoped to the logged-in user.
- Card details go only to Stripe.

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
