# Putting QR Review online

Follow these steps in order. It takes about an hour the first time.

You'll need:
- your Supabase account
- your Netlify account
- your Namecheap login (for qrreview.co.uk)
- a Google Workspace account for `support@qrreview.co.uk` (step 4)

Keep a private note (for example, in a password manager) of the passwords and keys you create along the way. **Never paste the secret ones into a chat, email or document.**

---

## 1. Create the Supabase project

1. In Supabase, open the **same organisation as parentbridge** and click **New project**.
2. Fill in:
   - **Name:** `qrreview`
   - **Database password:** click *Generate*, then save it in your private note. You'll need it in step 6.
   - **Region:** **London (eu-west-2)**. This is closest to your customers, and keeps UK data in the UK.
3. Click **Create**, then wait a couple of minutes while it sets up.

## 2. Create the tables and logo storage

1. In the project, open **SQL Editor** and click **New query**.
2. Open [`db/schema.sql`](../db/schema.sql) in GitHub, copy all of it, paste it into the editor and click **Run**. It should say "Success".
3. Start another new query and do the same with [`db/storage.sql`](../db/storage.sql).

To check it worked:
- **Table Editor** should list `profiles`, `businesses`, `qr_visits` and `stripe_events`.
- **Storage** should have a bucket called `logos`.

## 3. Set up login (Authentication)

### URL settings
Go to **Authentication → URL Configuration**:
- **Site URL:** `https://qrreview.co.uk`
- **Redirect URLs:** add `https://qrreview.co.uk/**`

### Email sign-ups
Go to **Authentication → Sign In / Providers → Email**:
- **Confirm email:** leave it **on**. New users then confirm their email address before they can log in, which catches typos.
- **Minimum password length:** `8`

### Email templates
Go to **Authentication → Emails → Templates**. The links in these emails must come back to QR Review, so replace three of the templates.

For each one, replace the whole **Message body** with the text below. The `{{ ... }}` parts must be copied exactly.

**Confirm signup**. Subject: `Confirm your QR Review account`
```html
<h2>Confirm your email</h2>
<p>Tap the button to confirm your email and finish setting up QR Review.</p>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">Confirm my email</a></p>
<p>If you didn't sign up, you can ignore this email.</p>
```

**Reset password**. Subject: `Reset your QR Review password`
```html
<h2>Reset your password</h2>
<p>Tap the button to choose a new password. The link works for 1 hour.</p>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery">Choose a new password</a></p>
<p>If you didn't ask for this, you can ignore this email.</p>
```

**Change email address**. Subject: `Confirm your new email for QR Review`
```html
<h2>Confirm your new email</h2>
<p>Tap the button to confirm the change.</p>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email_change">Confirm new email</a></p>
```

Leave the other templates as they are.

## 4. Email through Google Workspace

1. Sign up for Google Workspace (Business Starter) using the domain **qrreview.co.uk**, and create the mailbox **support@qrreview.co.uk**.
2. Google asks you to add some records to the domain to prove you own it and to receive email:
   - In Namecheap, go to **Domain List → qrreview.co.uk → Advanced DNS**.
   - Add exactly what Google shows you: a TXT record for verification, MX records, plus the SPF and DKIM records Google gives you. These stop your emails landing in spam.
3. Turn on **2-Step Verification** for support@qrreview.co.uk.
4. Create an **app password**: in the Google Account, go to **Security → App passwords**, and name it "QR Review". Save the 16-character password in your private note.

Then connect Supabase to it. In Supabase, go to **Authentication → Emails → SMTP Settings** and turn on **custom SMTP**:

| Setting | Value |
|---|---|
| Sender email | `support@qrreview.co.uk` |
| Sender name | `QR Review` |
| Host | `smtp.gmail.com` |
| Port | `465` |
| Username | `support@qrreview.co.uk` |
| Password | the app password from step 4 |

Supabase's built-in email only works for testing, so this step is needed before real customers sign up.

## 5. Collect the Supabase keys

You'll paste these into Netlify in step 6.

| What | Where in Supabase |
|---|---|
| Project URL | **Project Settings → Data API** (looks like `https://abcd1234.supabase.co`) |
| Publishable (anon) key | **Project Settings → API Keys**. It's safe-ish, but keep it tidy. |
| Secret (service_role) key | **Project Settings → API Keys**. **Secret: full access.** |
| Database connection string | Click **Connect** (top of the project), choose **Transaction pooler**, and copy the URI. Replace `[YOUR-PASSWORD]` with the database password from step 1. If the password has symbols like `@`, `#` or `/`, it's easiest to reset the database password to letters and numbers only. |

## 6. Create the Netlify site

1. In Netlify, click **Add new project → Import an existing project → GitHub**, and pick **martynkenneth/reviewqr**.
2. Netlify reads the build settings from the repository, so leave them as they are.
3. Before deploying, open **Environment variables** and add the variables below. Tick "Contains secret values" for the secret ones.

| Variable | Value |
|---|---|
| `BASE_URL` | `https://qrreview.co.uk` |
| `SUPABASE_URL` | Project URL from step 5 |
| `SUPABASE_ANON_KEY` | Publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret key (**secret**) |
| `DATABASE_URL` | Transaction pooler URI with your password (**secret**) |
| `ADMIN_EMAILS` | Your own email address. You get the admin area when you log in. |
| `SUPPORT_EMAIL` | `support@qrreview.co.uk` |
| `SMTP_URL` | `smtps://support%40qrreview.co.uk:APPPASSWORD@smtp.gmail.com:465`. Put the app password in place of APPPASSWORD and remove its spaces (**secret**). |
| `MAIL_FROM` | `QR Review <support@qrreview.co.uk>` |

4. Click **Deploy**.

If the deploy fails with "Missing environment variables", the message lists which ones to add.

## 7. Point qrreview.co.uk at Netlify

1. In Netlify, go to **Domain management → Add a domain** and enter `qrreview.co.uk`.
2. Netlify shows the DNS records to add. Add them in Namecheap under **Advanced DNS**:
   - usually an **A record** for `@`
   - a **CNAME** for `www`
   Use the values Netlify shows you, not ones from anywhere else.
3. Don't remove the Google email records you added in step 4.
4. Wait for HTTPS. Netlify sets up the padlock (SSL certificate) automatically once the records are found. This can take from a few minutes to a few hours.

## 8. Test it yourself

Use your phone for this:
1. Go to **https://qrreview.co.uk**, sign up with the email in `ADMIN_EMAILS`, and confirm it from the email you receive.
2. Set up a test business with a logo, and paste a real Google review link.
3. Try **Show QR**. Scan it with a *different* phone, tap **Leave a Google Review**, and check that it opens Google.
4. The visit should now show on your dashboard.
5. Try each download (PNG, the PDFs) and **Share**.
6. Log out, use **Forgot password**, and check that the email arrives and the link works.
7. Open **/admin**. You should see your account.

## 9. Before charging anyone

- **Stripe:** set it up as described in the README under "Stripe". The webhook address is `https://qrreview.co.uk/stripe/webhook`. Add the four `STRIPE_*` variables in Netlify, then redeploy (**Deploys → Trigger deploy**).
- **Supabase Pro:** upgrade before your first paying customer. Free projects pause after a week with no activity, and a paused project means printed QR codes stop working.
- **Domain:** check auto-renew is on for qrreview.co.uk in Namecheap.
- **Data protection:** as a UK business holding customers' details, you'll probably need to pay the ICO data protection fee. Check on ico.org.uk. It's usually around £40–60 a year.

---

### If something goes wrong

- **Netlify:** for errors, open **Logs → Functions → app**.
- **Supabase:** for login and email problems, open **Logs → Auth**.
- **Emails not arriving:** check the SMTP settings (step 4) and your spam folder. Supabase also has an email rate limit, under **Authentication → Rate Limits**.
