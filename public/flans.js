// FLAN SLAM — character art. drawFlan() draws one flan centred at (0,0) with body radius R.
(function () {
'use strict';
function shade(hex, f) { const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255; return `rgb(${Math.min(255, Math.round(r * f))},${Math.min(255, Math.round(g * f))},${Math.min(255, Math.round(b * f))})`; }
const INK = '#1b1446';
function bodyPath(g, shape, R) {
  g.beginPath();
  if (shape === 'squircle') {
    for (let i = 0; i <= 64; i++) { const a = i / 64 * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      const x = Math.sign(c) * Math.pow(Math.abs(c), 0.6) * R * 0.97, y = Math.sign(s) * Math.pow(Math.abs(s), 0.6) * R * 0.97; i ? g.lineTo(x, y) : g.moveTo(x, y); }
  } else if (shape === 'mold') {
    for (let i = 0; i <= 96; i++) { const a = i / 96 * Math.PI * 2, r = R * (0.95 + 0.07 * Math.cos(a * 8)); const x = Math.cos(a) * r, y = Math.sin(a) * r; i ? g.lineTo(x, y) : g.moveTo(x, y); }
  } else g.arc(0, 0, R, 0, Math.PI * 2);
  g.closePath();
}
const SHAPE = { classic: 'round', king: 'round', ninja: 'squircle', party: 'round', shades: 'squircle', sprout: 'mold' };
function eyes(g, lx, ly, o, style) {
  const pupil = o.fall ? 2 : 3.6;
  for (const ex of [-9, 9]) {
    const x = ex + lx * .5, y = -4 + ly * .5;
    if (style === 'smug') {
      g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill();
      g.fillStyle = INK; g.beginPath(); g.arc(ex + lx * .8, y + 1.5, pupil, 0, Math.PI * 2); g.fill();
      g.fillStyle = shade(o.color, .85); g.fillRect(x - 8, y - 8, 16, 7.5); // heavy lids
      g.strokeStyle = INK; g.lineWidth = 2; g.beginPath(); g.moveTo(x - 7.5, y - 0.5); g.lineTo(x + 7.5, y - 0.5); g.stroke();
    } else if (style === 'fierce') {
      g.fillStyle = '#fff'; g.beginPath(); g.ellipse(x, y, 7, 4.5, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = INK; g.beginPath(); g.arc(ex + lx * .8, y, pupil * .85, 0, Math.PI * 2); g.fill();
    } else if (style === 'sparkle') {
      g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, 8, 0, Math.PI * 2); g.fill();
      g.fillStyle = INK; g.beginPath(); g.arc(ex + lx * .8, y + ly * .3, pupil * 1.35, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(ex + lx * .8 - 2, y + ly * .3 - 2, 1.8, 0, Math.PI * 2); g.fill();
    } else {
      g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, 7.5, 0, Math.PI * 2); g.fill();
      g.fillStyle = INK; g.beginPath(); g.arc(ex + lx * .9, -4 + ly * .9, pupil, 0, Math.PI * 2); g.fill();
    }
  }
}
function mouth(g, lx, ly, o, style) {
  g.strokeStyle = INK; g.lineWidth = 2.5; g.lineCap = 'round'; g.beginPath();
  const mx = lx * .5, my = ly * .5;
  if (o.fall || o.dash) { g.arc(mx, 9 + my, 4, 0, Math.PI * 2); g.stroke(); return; }
  if (style === 'grin') { g.fillStyle = '#5a1030'; g.moveTo(mx - 8, 6 + my); g.quadraticCurveTo(mx, 18 + my, mx + 8, 6 + my); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#ff8fab'; g.beginPath(); g.arc(mx, 11 + my, 3, 0, Math.PI * 2); g.fill(); return; }
  if (style === 'smirk') { g.moveTo(mx - 6, 9 + my); g.quadraticCurveTo(mx + 2, 12 + my, mx + 8, 6 + my); g.stroke(); return; }
  if (style === 'flat') { g.moveTo(mx - 5, 9 + my); g.lineTo(mx + 5, 9 + my); g.stroke(); return; }
  if (style === 'tiny') { g.arc(mx, 7 + my, 3.5, 0.3, Math.PI - 0.3); g.stroke(); return; }
  g.arc(mx, 6 + my, 6, 0.2, Math.PI - 0.2); g.stroke();
}
// o: { color, R, lx, ly (look offset), fall, dash, t (time), vx, vy }
function drawFlan(g, char, o) {
  const R = o.R || 26, col = o.color || '#ff4d6d', shape = SHAPE[char] || 'round', t = o.t || 0;
  const lx = o.lx || 0, ly = o.ly || 0;
  // body
  const bg = g.createRadialGradient(-R * .35, -R * .45, 2, 0, 0, R * 1.1);
  bg.addColorStop(0, shade(col, 1.45)); bg.addColorStop(.6, col); bg.addColorStop(1, shade(col, .7));
  g.fillStyle = bg; bodyPath(g, shape, R); g.fill();
  if (char === 'classic') { // caramel cap with drips
    g.save(); bodyPath(g, shape, R); g.clip();
    g.fillStyle = '#9b4a12'; g.beginPath(); g.moveTo(-R, -R * .45);
    for (let i = 0; i <= 8; i++) { const x = -R + i * R / 4, d = (i % 2 ? 6 : 1) + (i % 3 === 0 ? 4 : 0); g.lineTo(x, -R * .45 + d); }
    g.lineTo(R, -R * 1.2); g.lineTo(-R, -R * 1.2); g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,200,120,.45)'; g.beginPath(); g.ellipse(-R * .25, -R * .75, R * .35, R * .1, -0.2, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  if (char === 'sprout') { // jelly-mould ridges
    g.save(); bodyPath(g, shape, R); g.clip(); g.strokeStyle = shade(col, .82); g.lineWidth = 2;
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2 + Math.PI / 8; g.beginPath(); g.moveTo(Math.cos(a) * R * .55, Math.sin(a) * R * .55); g.lineTo(Math.cos(a) * R, Math.sin(a) * R); g.stroke(); }
    g.restore();
  }
  bodyPath(g, shape, R); g.lineWidth = 3; g.strokeStyle = shade(col, .5); g.stroke();
  if (char !== 'classic') { g.fillStyle = 'rgba(255,255,255,.6)'; g.beginPath(); g.ellipse(-R * .38, -R * .45, R * .28, R * .15, -0.6, 0, Math.PI * 2); g.fill(); }
  // face + accessories
  if (char === 'king') { eyes(g, lx, ly, o, 'smug'); mouth(g, lx, ly, o, 'smirk');
    // crown
    g.fillStyle = '#ffd23f'; g.strokeStyle = '#a8740a'; g.lineWidth = 2; g.beginPath();
    const y0 = -R * .78, w = R * .75; g.moveTo(-w, y0); g.lineTo(-w, y0 - 14); g.lineTo(-w * .5, y0 - 6); g.lineTo(0, y0 - 18); g.lineTo(w * .5, y0 - 6); g.lineTo(w, y0 - 14); g.lineTo(w, y0); g.closePath(); g.fill(); g.stroke();
    for (const [x, c] of [[-w * .55, '#ff4d6d'], [0, '#3ec1ff'], [w * .55, '#7cff6b']]) { g.fillStyle = c; g.beginPath(); g.arc(x, y0 - 4, 2.6, 0, Math.PI * 2); g.fill(); }
  } else if (char === 'ninja') {
    // headband across the brow with tails that flutter behind
    g.save(); bodyPath(g, shape, R); g.clip(); g.fillStyle = '#26203f'; g.fillRect(-R, -R * .62, R * 2, 9); g.restore();
    g.fillStyle = '#e0193e'; g.fillRect(-4, -R * .62, 8, 9);
    const sp = Math.hypot(o.vx || 0, o.vy || 0), ba = sp > 20 ? Math.atan2(-(o.vy || 0), -(o.vx || 0)) : 2.6, fl = Math.sin(t * 14) * 4;
    g.strokeStyle = '#26203f'; g.lineWidth = 4; g.lineCap = 'round';
    for (const k of [-0.3, 0.25]) { const sx = Math.cos(ba) * R * .9, sy = -R * .5 + Math.sin(ba) * R * .3; g.beginPath(); g.moveTo(sx, sy); g.quadraticCurveTo(sx + Math.cos(ba + k) * 12, sy + Math.sin(ba + k) * 12 + fl, sx + Math.cos(ba + k) * 22, sy + Math.sin(ba + k) * 22 - fl); g.stroke(); }
    eyes(g, lx, ly, o, 'fierce');
    g.strokeStyle = INK; g.lineWidth = 2.5; for (const s of [-1, 1]) { g.beginPath(); g.moveTo(s * 15 + lx * .5, -12 + ly * .5); g.lineTo(s * 4 + lx * .5, -9 + ly * .5); g.stroke(); }
    mouth(g, lx, ly, o, 'flat');
  } else if (char === 'party') {
    eyes(g, lx, ly, o, 'normal'); mouth(g, lx, ly, o, 'grin');
    g.save(); g.translate(R * .2, -R * .8); g.rotate(0.35 + Math.sin(t * 6) * 0.06);
    g.fillStyle = '#7c4dff'; g.beginPath(); g.moveTo(-10, 4); g.lineTo(0, -26); g.lineTo(10, 4); g.closePath(); g.fill();
    g.save(); g.clip(); g.fillStyle = '#ffd23f'; for (let i = 0; i < 4; i++) g.fillRect(-12, -22 + i * 8, 24, 3); g.restore();
    g.fillStyle = '#ff7ae0'; g.beginPath(); g.arc(0, -27, 4.5, 0, Math.PI * 2); g.fill(); g.restore();
  } else if (char === 'shades') {
    mouth(g, lx, ly, o, 'smirk');
    const x = lx * .4, y = -5 + ly * .4;
    g.fillStyle = '#111'; g.strokeStyle = '#111'; g.lineWidth = 3;
    g.beginPath(); g.roundRect ? g.roundRect(x - 19, y - 6, 16, 11, 4) : g.rect(x - 19, y - 6, 16, 11); g.fill();
    g.beginPath(); g.roundRect ? g.roundRect(x + 3, y - 6, 16, 11, 4) : g.rect(x + 3, y - 6, 16, 11); g.fill();
    g.beginPath(); g.moveTo(x - 3, y - 2); g.lineTo(x + 3, y - 2); g.stroke();
    g.beginPath(); g.moveTo(x - 19, y - 3); g.lineTo(x - R * .95, y - 6); g.moveTo(x + 19, y - 3); g.lineTo(x + R * .95, y - 6); g.stroke();
    g.fillStyle = 'rgba(255,255,255,.55)'; g.beginPath(); g.moveTo(x - 16, y - 4); g.lineTo(x - 11, y - 4); g.lineTo(x - 15, y + 3); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(x + 6, y - 4); g.lineTo(x + 11, y - 4); g.lineTo(x + 7, y + 3); g.closePath(); g.fill();
  } else if (char === 'sprout') {
    eyes(g, lx, ly, o, 'sparkle'); mouth(g, lx, ly, o, 'tiny');
    g.fillStyle = 'rgba(255,90,130,.45)'; for (const s of [-1, 1]) { g.beginPath(); g.ellipse(s * 15 + lx * .5, 6 + ly * .5, 5, 3, 0, 0, Math.PI * 2); g.fill(); }
    // sprout
    const sw = Math.sin(t * 5) * 0.15; g.save(); g.translate(0, -R * .9); g.rotate(sw);
    g.strokeStyle = '#2f9e44'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, 2); g.lineTo(0, -10); g.stroke();
    g.fillStyle = '#51cf66'; g.beginPath(); g.ellipse(-7, -12, 8, 4.5, -0.5, 0, Math.PI * 2); g.fill(); g.beginPath(); g.ellipse(7, -14, 8, 4.5, 0.5, 0, Math.PI * 2); g.fill();
    g.restore();
  } else { eyes(g, lx, ly, o, 'normal'); mouth(g, lx, ly, o, 'smile'); }
}
const iconCache = new Map();
function icon(char, color, size) {
  const k = char + color + size; if (iconCache.has(k)) return iconCache.get(k);
  const c = document.createElement('canvas'); c.width = c.height = size * 2; const g = c.getContext('2d');
  g.scale(size * 2 / 80, size * 2 / 80); g.translate(40, 46); drawFlan(g, char, { color, R: 26 });
  const url = c.toDataURL(); iconCache.set(k, url); return url;
}
window.FlanArt = { drawFlan, icon, shade };
})();
