// Turns text into SVG paths using a bundled font, so downloaded images and
// PDFs look identical on every server regardless of which fonts it has.
const fontkit = require('fontkit');

const fonts = {};
function font(weight) {
  if (!fonts[weight]) fonts[weight] = fontkit.openSync(require.resolve(`@fontsource/inter/files/inter-latin-${weight}-normal.woff`));
  return fonts[weight];
}

// Characters the font can't draw become "?" rather than an empty box.
function clean(text, f) {
  return Array.from(String(text).normalize('NFC'))
    .map((ch) => (f.hasGlyphForCodePoint(ch.codePointAt(0)) || ch === ' ' ? ch : '?'))
    .join('');
}

function measure(text, size, weight = 400) {
  const f = font(weight);
  const run = f.layout(clean(text, f));
  return (run.advanceWidth * size) / f.unitsPerEm;
}

// Returns an SVG <path> for one line of text. y is the baseline.
function textPath(text, { x, y, size, weight = 400, fill = '#111', anchor = 'middle' }) {
  const f = font(weight);
  const run = f.layout(clean(text, f));
  const scale = size / f.unitsPerEm;
  const width = run.advanceWidth * scale;
  let cx = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x;
  let d = '';
  run.glyphs.forEach((g, i) => {
    const pos = run.positions[i];
    d += g.path
      .scale(scale, -scale)
      .translate(cx + pos.xOffset * scale, y - pos.yOffset * scale)
      .toSVG();
    cx += pos.xAdvance * scale;
  });
  return `<path d="${d}" fill="${fill}"/>`;
}

// Greedy word wrap. Long single words are allowed to overflow onto their own
// line; callers shrink the font size if the result is too wide.
function wrap(text, size, weight, maxWidth) {
  const words = String(text).trim().split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (line && measure(test, size, weight) > maxWidth) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

// Finds the largest size (<= size) at which text fits in maxLines lines.
function fit(text, { size, minSize = size * 0.5, weight = 400, maxWidth, maxLines = 2 }) {
  for (let s = size; s >= minSize; s -= Math.max(1, size * 0.04)) {
    const lines = wrap(text, s, weight, maxWidth);
    if (lines.length <= maxLines && lines.every((l) => measure(l, s, weight) <= maxWidth)) return { size: s, lines };
  }
  const lines = wrap(text, minSize, weight, maxWidth).slice(0, maxLines);
  return { size: minSize, lines };
}

module.exports = { measure, textPath, wrap, fit };
