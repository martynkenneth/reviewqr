// Brand colour helpers. We never trust a brand colour to be readable, so text
// and QR colours are chosen by contrast rather than copied blindly.
const DEFAULT_COLOUR = '#0f766e';

function normalizeHex(input) {
  const s = String(input || '').trim();
  let m = s.match(/^#?([0-9a-f]{6})$/i);
  if (m) return `#${m[1].toLowerCase()}`;
  m = s.match(/^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (m) return `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`.toLowerCase();
  return null;
}

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

// White or near-black text, whichever reads better on the colour.
const textOn = (hex) => (contrast(hex, '#ffffff') >= contrast(hex, '#111827') ? '#ffffff' : '#111827');

// QR codes need strong contrast to scan reliably in poor light.
const qrColour = (hex) => (contrast(hex, '#ffffff') >= 5 ? hex : '#111827');

module.exports = { DEFAULT_COLOUR, normalizeHex, contrast, textOn, qrColour };
