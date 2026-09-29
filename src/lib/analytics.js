// Review-page visit tracking.
//
// We count visits to OUR page (/r/<slug>) and taps through to Google. We can't
// see whether a review was actually posted, so nothing here claims that.
const crypto = require('crypto');
const { db, now } = require('../db');

const TZ = 'Europe/London';
const dayKey = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d); // YYYY-MM-DD

// Link previews (WhatsApp, iMessage, Facebook...) fetch the page when a link
// is shared. Those aren't people, so don't count them.
const BOT_UA =
  /bot|crawl|spider|preview|facebookexternalhit|whatsapp|telegram|slack|discord|skype|embedly|quora|pinterest|vkshare|bitly|curl|wget|python|headless|lighthouse/i;
const isBot = (ua) => !ua || BOT_UA.test(ua);

// Salted with the date, so the same phone is recognisable within a day (to
// spot repeat taps) but never across days, and we never store the IP itself.
let salt = { day: null, value: null };
function visitorHash(ip, ua) {
  const today = dayKey(new Date());
  if (salt.day !== today) salt = { day: today, value: crypto.randomBytes(16).toString('hex') };
  return crypto.createHash('sha256').update(`${salt.value}|${ip}|${ua}`).digest('hex').slice(0, 16);
}

const SOURCES = new Set(['qr', 'link', 'nfc', 'card', 'van', 'invoice', 'web', 'email']);

function recordVisit(businessId, { event = 'view', source, ip, ua }) {
  if (isBot(ua)) return false;
  const src = SOURCES.has(source) ? source : 'qr';
  db.prepare('INSERT INTO qr_visits (business_id, created_at, event, source, visitor_hash) VALUES (?, ?, ?, ?, ?)').run(
    businessId,
    now(),
    event,
    src,
    visitorHash(ip, ua),
  );
  return true;
}

function stats(businessId) {
  const today = dayKey(new Date());
  const month = today.slice(0, 7);
  const since = new Date(Date.now() - 32 * 864e5).toISOString();
  const rows = db
    .prepare('SELECT created_at, event FROM qr_visits WHERE business_id = ? AND created_at >= ?')
    .all(businessId, since);

  const days = [];
  for (let i = 29; i >= 0; i--) days.push({ day: dayKey(new Date(Date.now() - i * 864e5)), views: 0 });
  const byDay = new Map(days.map((d) => [d.day, d]));

  const s = { today: 0, month: 0, monthGoogle: 0 };
  for (const r of rows) {
    const k = dayKey(new Date(r.created_at));
    if (r.event === 'view') {
      if (k === today) s.today++;
      if (k.startsWith(month)) s.month++;
      if (byDay.has(k)) byDay.get(k).views++;
    } else if (r.event === 'google' && k.startsWith(month)) s.monthGoogle++;
  }
  const all = db
    .prepare(
      `SELECT SUM(event = 'view') AS views, SUM(event = 'google') AS google FROM qr_visits WHERE business_id = ?`,
    )
    .get(businessId);
  s.allTime = all.views || 0;
  s.allTimeGoogle = all.google || 0;
  s.days = days;
  return s;
}

module.exports = { recordVisit, stats, isBot, dayKey };
