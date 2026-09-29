// Validates the Google review link a business pastes in.
//
// We only ever redirect customers to Google-owned addresses. That stops anyone
// using our trusted short links (/r/...) to bounce people to a scam site.
const GOOGLE_TLD = '(com|[a-z]{2}|co\\.[a-z]{2}|com\\.[a-z]{2})';
const GOOGLE_HOSTS = [
  /^g\.page$/,
  // Not plain goo.gl: old goo.gl short links could point anywhere.
  /^maps\.app\.goo\.gl$/,
  /^g\.co$/,
  /^search\.google\.com$/,
  /^business\.google\.com$/,
  // google.com, google.co.uk, google.ie, google.com.au... but never
  // google.com.evil.com — the domain must end right after Google's suffix.
  new RegExp(`^maps\\.google\\.${GOOGLE_TLD}$`),
  new RegExp(`^(www\\.)?google\\.${GOOGLE_TLD}$`),
];

// Google Place IDs look like "ChIJ..." — if someone pastes one we can build
// the official "write a review" link for them.
const PLACE_ID = /^(ChIJ|GhIJ|EiI|Ei[A-Za-z0-9])[A-Za-z0-9_-]{10,}$/;

function normalizeReviewUrl(input) {
  let s = String(input || '').trim();
  if (!s) return { error: 'Paste your Google review link.' };
  if (PLACE_ID.test(s)) return { url: `https://search.google.com/local/writereview?placeid=${s}` };
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let u;
  try {
    u = new URL(s);
  } catch {
    return { error: "That doesn't look like a web link. Copy the whole link from Google and paste it here." };
  }
  if (u.username || u.password) return { error: 'That link is not allowed.' };
  const host = u.hostname.toLowerCase();
  if (!GOOGLE_HOSTS.some((re) => re.test(host))) {
    return { error: 'That link isn\'t a Google link. It should start with something like "g.page/r/" or "search.google.com".' };
  }
  u.protocol = 'https:';
  if (u.href.length > 2000) return { error: 'That link is too long.' };
  return { url: u.href };
}

module.exports = { normalizeReviewUrl };
