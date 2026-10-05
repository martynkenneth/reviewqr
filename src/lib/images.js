// Logo uploads. We check the file really is a JPG/PNG/WebP by its contents
// (not its name), then re-encode it as a fresh PNG. Re-encoding throws away
// anything hidden in the original file and keeps every logo a sensible size.
const crypto = require('crypto');
const sharp = require('sharp');
const storage = require('./storage');

// 4MB: Netlify Functions accept requests up to 6MB, and uploads grow by a
// third on the way in, so this is the largest that's always safe.
const MAX_BYTES = 4 * 1024 * 1024;

function sniff(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

async function saveLogo(buf) {
  if (!buf || !buf.length) return { error: 'Please choose an image file.' };
  if (buf.length > MAX_BYTES) return { error: 'That image is too big. Please use one under 4MB.' };
  const type = sniff(buf);
  if (!type) return { error: 'Please upload a JPG, PNG or WebP image.' };
  let png;
  try {
    const img = sharp(buf, { limitInputPixels: 40e6 });
    const meta = await img.metadata();
    if (meta.format !== type && !(type === 'jpeg' && meta.format === 'jpg')) throw new Error('type mismatch');
    png = await img
      .rotate() // respect phone-camera orientation
      .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
  } catch {
    return { error: "We couldn't read that image. Please try a different file." };
  }
  try {
    // Crop plain borders so logos sit neatly. Fails on single-colour images,
    // which is fine — keep the untrimmed version.
    png = await sharp(png).trim({ threshold: 5 }).png().toBuffer();
  } catch {
    /* keep untrimmed */
  }
  if (!png) {
    return { error: "We couldn't read that image. Please try a different file." };
  }
  const name = `${crypto.randomBytes(12).toString('hex')}.png`;
  await storage.put(name, png);
  return { file: name };
}

async function deleteLogo(name) {
  if (!name) return;
  await storage.remove(name).catch(() => {}); // a leftover file is harmless
}

module.exports = { saveLogo, deleteLogo, MAX_BYTES };
