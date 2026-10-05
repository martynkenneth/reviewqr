// Netlify build step (see netlify.toml). Checks the settings are in place and
// writes public/_redirects, which:
//   - passes /u/<logo> straight through to the Supabase "logos" bucket, so
//     logos load fast from Netlify's CDN without waking the app up;
//   - sends every other request that isn't a static file to the app function.
const fs = require('fs');
const path = require('path');

const required = ['BASE_URL', 'SUPABASE_URL', 'DATABASE_URL'];
const missing = required.filter((k) => !process.env[k]);
if (!process.env.SUPABASE_ANON_KEY && !process.env.SUPABASE_PUBLISHABLE_KEY) missing.push('SUPABASE_ANON_KEY');
if (!process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.SUPABASE_SECRET_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
if (missing.length) {
  console.error(`\nMissing environment variables: ${missing.join(', ')}`);
  console.error('Add them in Netlify: Site configuration → Environment variables. See docs/SETUP.md.\n');
  process.exit(1);
}
if (!/^https:\/\//.test(process.env.BASE_URL)) {
  console.error('\nBASE_URL must start with https:// (e.g. https://qrreview.co.uk)\n');
  process.exit(1);
}

const supabase = process.env.SUPABASE_URL.replace(/\/$/, '');
const redirects = [
  `/u/*  ${supabase}/storage/v1/object/public/logos/:splat  200`,
  '/*  /.netlify/functions/app  200',
  '',
].join('\n');
fs.writeFileSync(path.join(__dirname, '..', 'public', '_redirects'), redirects);
console.log('Wrote public/_redirects');
