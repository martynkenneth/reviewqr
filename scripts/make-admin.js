// Makes an existing user an administrator: npm run make-admin -- you@example.com
// Needs DATABASE_URL (or runs against the local database). Easier option:
// put admin emails in ADMIN_EMAILS — they're promoted when they next log in.
const { query, getDb } = require('../src/db');

(async () => {
  const email = (process.argv[2] || '').trim().toLowerCase();
  if (!email) {
    console.error('Usage: npm run make-admin -- you@example.com');
    process.exit(1);
  }
  const rows = await query('UPDATE profiles SET is_admin = true WHERE lower(email) = $1 RETURNING id', [email]);
  console.log(rows.length ? `${email} is now an admin.` : `No user with email ${email}. Sign up first.`);
  const db = await getDb();
  await (db.end || db.close).call(db);
})();
