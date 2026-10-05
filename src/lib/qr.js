// QR codes and the printable/downloadable review signs.
//
// The QR always encodes the business's permanent short link (/r/<slug>), never
// the Google URL itself, so the Google link can change without reprinting.
const QRCode = require('qrcode');
const sharp = require('sharp');
const PDFDocument = require('pdfkit');
const config = require('../config');
const storage = require('./storage');
const { textPath, fit } = require('./text');
const { textOn, qrColour } = require('./colour');

const reviewUrl = (slug) => `${config.baseUrl}/r/${slug}`;

// Draws the QR as one SVG path, merging runs of dark modules on each row.
function qrPath(text) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const { size, data } = qr.modules;
  let d = '';
  for (let y = 0; y < size; y++) {
    let x = 0;
    while (x < size) {
      if (!data[y * size + x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < size && data[y * size + x]) x++;
      d += `M${start} ${y}h${x - start}v1h${start - x}z`;
    }
  }
  return { size, d };
}

// Standalone QR SVG with the standard 4-module quiet zone.
function qrSvg(text, { colour = '#111827', px } = {}) {
  const { size, d } = qrPath(text);
  const total = size + 8;
  const dims = px ? ` width="${px}" height="${px}"` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}"${dims} shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="#fff"/>` +
    `<path transform="translate(4 4)" fill="${colour}" d="${d}"/></svg>`
  );
}

function qrPng(text, { px = 1200, colour } = {}) {
  return sharp(Buffer.from(qrSvg(text, { colour, px }))).png().toBuffer();
}

async function loadLogo(business) {
  if (!business.logo_file) return null;
  const buf = await storage.get(business.logo_file);
  if (!buf) return null;
  const meta = await sharp(buf).metadata();
  return { href: `data:image/png;base64,${buf.toString('base64')}`, w: meta.width, h: meta.height };
}

// The branded sign, laid out on a 1000-unit-wide canvas. Height decides the
// shape: 1250 for the square-ish social/digital card, 1414 for A-series paper.
async function signSvg(business, { height = 1414, pxWidth = 1000 } = {}) {
  const W = 1000;
  const H = height;
  const pad = 80;
  const brand = business.brand_colour;
  const onBrand = textOn(brand);
  const dark = '#111827';
  const grey = '#4b5563';
  const parts = [];

  // Brand band with the business name.
  const bandH = Math.round(H * 0.16);
  parts.push(`<rect width="${W}" height="${bandH}" fill="${brand}"/>`);
  const name = fit(business.name, { size: 76, minSize: 40, weight: 800, maxWidth: W - pad * 2, maxLines: 2 });
  const lineH = name.size * 1.15;
  let baseline = bandH / 2 - ((name.lines.length - 1) * lineH) / 2 + name.size * 0.36;
  for (const line of name.lines) {
    parts.push(textPath(line, { x: W / 2, y: baseline, size: name.size, weight: 800, fill: onBrand }));
    baseline += lineH;
  }

  let y = bandH + 56;
  const logo = await loadLogo(business);
  if (logo) {
    const maxW = 380;
    const maxH = H > 1300 ? 170 : 130;
    const s = Math.min(maxW / logo.w, maxH / logo.h);
    const lw = logo.w * s;
    const lh = logo.h * s;
    parts.push(`<image href="${logo.href}" x="${(W - lw) / 2}" y="${y}" width="${lw}" height="${lh}"/>`);
    y += lh + 64;
  } else y += 24;

  parts.push(textPath('How did we do?', { x: W / 2, y: y + 58, size: 68, weight: 800, fill: dark }));
  y += 58 + 62;
  parts.push(textPath('Scan to leave us a Google review.', { x: W / 2, y, size: 40, weight: 500, fill: grey }));
  y += 44;

  // QR fills whatever space is left above the footer.
  // Keep a white margin of 3 modules inside the frame so phones lock on fast.
  const { size, d } = qrPath(reviewUrl(business.qr_slug));
  const footerH = 130;
  const space = Math.min(W - pad * 2, H - y - footerH - 20);
  const qrSize = space / (1 + 6 / size);
  const m = qrSize / size;
  const frame = 3 * m;
  const qx = (W - qrSize) / 2;
  const qy = y + frame + 10;
  parts.push(
    `<rect x="${qx - frame}" y="${qy - frame}" width="${qrSize + frame * 2}" height="${qrSize + frame * 2}" rx="36" fill="#fff" stroke="${brand}" stroke-width="10"/>`,
  );
  parts.push(
    `<path transform="translate(${qx} ${qy}) scale(${m})" fill="${qrColour(brand)}" shape-rendering="crispEdges" d="${d}"/>`,
  );

  const fy = qy + qrSize + frame + 62;
  parts.push(textPath('Point your phone camera at the code', { x: W / 2, y: fy, size: 32, weight: 500, fill: grey }));
  parts.push(`<rect y="${H - 24}" width="${W}" height="24" fill="${brand}"/>`);

  const pxHeight = Math.round((pxWidth * H) / W);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${W} ${H}" width="${pxWidth}" height="${pxHeight}">` +
    `<rect width="${W}" height="${H}" fill="#fff"/>${parts.join('')}</svg>`
  );
}

async function signPng(business, opts) {
  return sharp(Buffer.from(await signSvg(business, opts))).png({ compressionLevel: 9 }).toBuffer();
}

// Paper sizes in PDF points and the pixel width that gives ~300dpi.
const PAPER = {
  a6: { label: 'A6 counter card', pt: [297.64, 419.53], px: 1240 },
  a5: { label: 'A5 printable sign', pt: [419.53, 595.28], px: 1748 },
  a4: { label: 'A4 printable sign', pt: [595.28, 841.89], px: 2480 },
};

async function signPdf(business, paper) {
  const p = PAPER[paper];
  const png = await signPng(business, { height: 1414, pxWidth: p.px });
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: p.pt, margin: 0, info: { Title: `${business.name} – Google review QR` } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.image(png, 0, 0, { width: p.pt[0], height: p.pt[1] });
    doc.end();
  });
}

module.exports = { reviewUrl, qrSvg, qrPng, signSvg, signPng, signPdf, PAPER };
