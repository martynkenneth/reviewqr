// Makes an existing user an administrator: npm run make-admin -- you@example.com
// (Alternatively list admin emails in ADMIN_EMAILS; they're promoted on login.)
const { db } = require('../src/db');

const email = (process.argv[2] || '').trim().toLowerCase();
if (!email) {
  console.error('Usage: npm run make-admin -- you@example.com');
  process.exit(1);
}
const r = db.prepare('UPDATE users SET is_admin = 1 WHERE email = ?').run(email);
console.log(r.changes ? `${email} is now an admin.` : `No user with email ${email}. Sign up first.`);
