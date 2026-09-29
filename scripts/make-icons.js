// Generates the app icons in public/icons from one SVG. Run: npm run make-icons
const path = require('path');
const sharp = require('sharp');

const out = path.join(__dirname, '..', 'public', 'icons');
const mark = (pad) => {
  // A simple QR-style mark with a star, on the brand teal.
  const s = 512 - pad * 2;
  const u = s / 7;
  const sq = (x, y) =>
    `<rect x="${pad + x * u}" y="${pad + y * u}" width="${u * 2.5}" height="${u * 2.5}" rx="${u * 0.5}" fill="none" stroke="#fff" stroke-width="${u * 0.6}"/>`;
  const star = `<path transform="translate(${pad + 4.1 * u} ${pad + 4.1 * u}) scale(${(u * 2.8) / 24})" fill="#fbbf24" d="m12 2 3 6.3 6.9 1-5 4.8 1.2 6.9L12 17.8 5.9 21l1.2-6.9-5-4.8 6.9-1z"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <rect width="512" height="512" rx="${pad ? 0 : 112}" fill="#0f766e"/>
    ${sq(0.6, 0.6)}${sq(3.9, 0.6)}${sq(0.6, 3.9)}${star}</svg>`;
};

(async () => {
  const normal = Buffer.from(mark(72));
  const maskable = Buffer.from(mark(120));
  await sharp(normal).resize(192).png().toFile(path.join(out, 'icon-192.png'));
  await sharp(normal).resize(512).png().toFile(path.join(out, 'icon-512.png'));
  await sharp(maskable).resize(512).png().toFile(path.join(out, 'maskable-512.png'));
  await sharp(normal).resize(180).flatten({ background: '#0f766e' }).png().toFile(path.join(out, 'apple-touch-icon.png'));
  console.log('Icons written to', out);
})();
