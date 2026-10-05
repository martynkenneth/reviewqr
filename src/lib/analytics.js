// Review-page visit tracking.
//
// We count visits to OUR page (/r/<slug>) and taps through to Google. We can't
// see whether a review was actually posted, so nothing here claims that.
const crypto = require('crypto');
const config = require('../config');
const { query, one } = require('../db');

const TZ = 'Europe/London';
const dayKey = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d); // YYYY-MM-DD

// Link previews (WhatsApp, iMessage, Facebook...) fetch the page when a link
// is shared. Those aren't people, so don't count them.
const BOT_UA =
  /bot|crawl|spider|preview|facebookexternalhit|whatsapp|telegram|slack|discord|skype|embedly|quora|pinterest|vkshare|bitly|curl|wget|python|headless|lighthouse/i;
const isBot = (ua) => !ua || BOT_UA.test(ua);

// Salted with the date, so the same phone is recognisable within a day (to
// spot repeat taps) but not across days, and we never store the IP itself.
// The salt comes from a server secret, so every running copy of the app
// (Netlify runs several) works out the same value for the same day.
const SECRET =
  process.env.VISITOR_HASH_SECRET ||
  (config.supabase.serviceKey && crypto.createHash('sha256').update(`visitor|${config.supabase.serviceKey}`).digest('hex')) ||
  crypto.randomBytes(32).toString('hex');
function visitorHash(ip, ua) {
  const salt = crypto.createHmac('sha256', SECRET).update(dayKey(new Date())).digest('hex');
  return crypto.createHash('sha256').update(`${salt}|${ip}|${ua}`).digest('hex').slice(0, 16);
}

const SOURCES = new Set(['qr', 'link', 'nfc', 'card', 'van', 'invoice', 'web', 'email']);

async function recordVisit(businessId, { event = 'view', source, ip, ua }) {
  if (isBot(ua)) return false;
  const src = SOURCES.has(source) ? source : 'qr';
  await query('INSERT INTO qr_visits (business_id, event, source, visitor_hash) VALUES ($1, $2, $3, $4)', [
    businessId,
    event,
    src,
    visitorHash(ip, ua),
  ]);
  return true;
}

async function stats(businessId) {
  const today = dayKey(new Date());
  const month = today.slice(0, 7);
  const since = new Date(Date.now() - 32 * 864e5).toISOString();
  const rows = await query('SELECT created_at, event FROM qr_visits WHERE business_id = $1 AND created_at >= $2', [
    businessId,
    since,
  ]);

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
  const all = await one(
    `SELECT count(*) FILTER (WHERE event = 'view')::int AS views, count(*) FILTER (WHERE event = 'google')::int AS google
     FROM qr_visits WHERE business_id = $1`,
    [businessId],
  );
  s.allTime = all.views || 0;
  s.allTimeGoogle = all.google || 0;
  s.days = days;
  return s;
}

module.exports = { recordVisit, stats, isBot, dayKey };
