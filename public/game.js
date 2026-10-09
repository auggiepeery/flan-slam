// FLAN SLAM client (multiplayer via WebSocket server, or fully offline solo vs AI using core.js)
(() => {
const Core = window.FlanCore;
const $ = id => document.getElementById(id);
const cv = $('c'), ctx = cv.getContext('2d');
const R = Core.C.R, ARENA_START = Core.C.ARENA_START;
let INTERP = 110;
let W = 0, H = 0, DPR = 1;
function resize() { DPR = Math.min(2, window.devicePixelRatio || 1); W = innerWidth; H = innerHeight; cv.width = W * DPR; cv.height = H * DPR; }
addEventListener('resize', resize); resize();

// ---------- state ----------
let ws = null, myId = null, room = null, roomCode = null;
let snaps = [];          // [{ts, st, cd, ar, p: Map(id->[...])}]
let offsets = [];        // server-client clock samples
let players = {};        // id -> {name,color,score,...}
let lastState = null, arenaR = ARENA_START, roundT = 0, curState = 'lobby';
const visuals = {};      // id -> {x,y,fall,trail:[],wob}
const particles = [], rings = [];
let shake = 0, camScale = 1, me = { x: 0, y: 0 };
let myDashCd = 0;
const isTouch = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;

// ---------- sound (tiny synth) ----------
let AC = null;
function audio() { if (!AC) try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch {} if (AC && AC.state === 'suspended') AC.resume(); return AC; }
function tone(f0, f1, dur, type = 'sine', vol = 0.2, delay = 0) {
  const a = AC; if (!a) return;
  const t = a.currentTime + delay, o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
}
const sfx = {
  bonk: s => { tone(320 + Math.random() * 80, 90, 0.18, 'sine', 0.15 + s * 0.25); tone(900, 300, 0.06, 'triangle', 0.06 * s); },
  dash: () => tone(200, 700, 0.15, 'sawtooth', 0.06),
  fall: () => { tone(600, 80, 0.5, 'sine', 0.18); tone(150, 60, 0.4, 'triangle', 0.1, 0.35); },
  beep: hi => tone(hi ? 880 : 440, hi ? 880 : 440, hi ? 0.35 : 0.15, 'square', 0.07),
  win: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, f, 0.22, 'triangle', 0.12, i * 0.12)),
};

// ---------- landing ----------
const nameEl = $('name'), codeEl = $('code');
nameEl.value = (localStorage.getItem('fs-name') || localStorage.getItem('jj-name')) || '';
const urlRoom = (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
if (urlRoom) { $('joinbox-link').classList.remove('hidden'); $('linkcode').textContent = urlRoom; codeEl.value = urlRoom; $('btn-create').classList.add('ghost'); }
codeEl.addEventListener('input', () => codeEl.value = codeEl.value.toUpperCase().replace(/[^A-Z]/g, ''));
function err(m) { $('err').textContent = m || ''; }
function go(kind, code) {
  audio();
  const name = nameEl.value.trim();
  if (!name) { err('Pick a nickname first!'); nameEl.focus(); return; }
  localStorage.setItem('fs-name', name);
  if (kind === 'join' && (!code || code.length !== 4)) { err('Room codes are 4 letters'); return; }
  err('Connecting…');
  connect({ t: kind, name, code });
}
$('btn-create').onclick = () => go('create');
$('btn-join').onclick = () => go('join', codeEl.value);
$('btn-joinlink').onclick = () => go('join', urlRoom);
nameEl.addEventListener('keydown', e => { if (e.key === 'Enter') urlRoom ? go('join', urlRoom) : go('create'); });
codeEl.addEventListener('keydown', e => { if (e.key === 'Enter') go('join', codeEl.value); });

function shareLink() { const sv = new URLSearchParams(location.search).get('server'); return `${location.origin}${location.pathname}?room=${roomCode}` + (sv ? '&server=' + encodeURIComponent(sv) : ''); }
function toast(m) { const t = $('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 1800); }
async function copyLink() {
  const l = shareLink();
  if (navigator.share && isTouch) { try { await navigator.share({ title: 'Flan Slam', text: `Join my Flan Slam room ${roomCode}!`, url: l }); return; } catch {} }
  try { await navigator.clipboard.writeText(l); toast('Link copied! Send it to friends 🍮'); }
  catch { $('lb-link').select(); document.execCommand('copy'); toast('Link copied!'); }
}
$('btn-copy').onclick = copyLink; $('btn-lobby-copy').onclick = copyLink;
$('btn-start').onclick = () => { audio(); send({ t: 'start' }); };
$('btn-next').onclick = () => { audio(); send({ t: 'start' }); };

// ---------- network ----------
let solo = null, leaving = false;
function send(m) { if (solo) solo.recv(m); else if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }
// Server: same origin by default; a static host (e.g. GitHub Pages) can point at a game server via config.js or ?server=
function serverWsUrl() {
  const q = new URLSearchParams(location.search).get('server');
  const base = (q || window.FLAN_SERVER || '').trim().replace(/\/$/, '');
  if (base) return base.replace(/^http/, 'ws') + '/ws';
  return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
}
function connect(first) {
  stopSolo();
  if (ws) { leaving = true; try { ws.close(); } catch {} }
  leaving = false; INTERP = 110;
  ws = new WebSocket(serverWsUrl());
  ws.onopen = () => send(first);
  ws.onclose = () => { if (leaving) return; if (myId) { toast('Disconnected — reload to rejoin'); showScreen('landing'); err('Disconnected from server. Try joining again.'); myId = null; $('hud').classList.add('hidden'); } else err('Could not reach the multiplayer server — try “Play vs AI” instead!'); };
  ws.onmessage = e => onMsg(JSON.parse(e.data));
}
function onMsg(m) {
  if (m.t === 'error') { err(m.msg); return; }
  if (m.t === 'welcome') {
    myId = m.id; roomCode = m.code; err('');
    if (!solo) history.replaceState(null, '', `?room=${roomCode}` + (new URLSearchParams(location.search).get('server') ? '&server=' + encodeURIComponent(new URLSearchParams(location.search).get('server')) : ''));
    $('lb-code').textContent = roomCode; $('hud-code').textContent = roomCode; $('lb-link').value = shareLink();
    $('hud').classList.remove('hidden');
    if (isTouch) $('touch').classList.remove('hidden');
    return;
  }
  if (m.t === 'room') { onRoom(m); return; }
  if (m.t === 's') { onSnap(m); return; }
  if (m.t === 'over') { onOver(m); return; }
  if (m.t === 'chat') { feed(m.msg); return; }
}
function onRoom(m) {
  const prev = room; room = m;
  players = {}; for (const p of m.players) players[p.id] = p;
  const host = m.host === myId;
  const mine = players[myId];
  curState = m.state;
  if (m.state === 'lobby') showScreen('lobby');
  else if (m.state === 'over') showScreen('over');
  else showScreen(null);
  if (m.state === 'countdown' && (!prev || prev.state !== 'countdown')) { snaps = []; for (const k in visuals) delete visuals[k]; particles.length = 0; rings.length = 0; lastCount = null; }
  if (m.state === 'playing' && prev && prev.state === 'countdown') { center('SLAM!'); sfx.beep(true); }
  $('spectate').classList.toggle('hidden', !(mine && !mine.playing && (m.state === 'playing' || m.state === 'countdown')));
  $('btn-start').classList.toggle('hidden', !host); $('lb-wait').classList.toggle('hidden', host);
  $('btn-start').textContent = m.players.length < 2 ? '▶ Start (solo practice)' : `▶ Start round (${m.players.length} players)`;
  $('btn-next').classList.toggle('hidden', !host); $('ov-wait').classList.toggle('hidden', host);
  $('lb-count').textContent = `PLAYERS ${m.players.length}/8`;
  $('hud-round').textContent = m.round || 1;
  $('lb-players').innerHTML = m.players.map(p => li(p, false)).join('');
  for (const el of document.querySelectorAll('.botctl')) el.classList.toggle('hidden', !host || m.players.length >= 8);
  for (const el of document.querySelectorAll('.botfull')) el.classList.toggle('hidden', !(host && m.players.length >= 8));
  document.body.classList.toggle('solo', !!solo); document.body.classList.toggle('host', host);
  renderScores();
  if (m.state === 'over') $('ov-score').innerHTML = sorted().map((p, i) => li(p, true, i)).join('');
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function sorted() { return Object.values(players).sort((a, b) => b.score - a.score || b.wins - a.wins); }
function li(p, score, i) {
  const medal = score ? (['🥇', '🥈', '🥉'][i] || `${i + 1}.`) + ' ' : '';
  const kick = p.bot && room.host === myId ? `<button class="kick" data-kick="${p.id}" title="Remove bot">✕</button>` : '';
  const tag = p.bot ? `<span class="diff d-${p.diff}">${p.diff}</span>` : '';
  return `<li class="${p.id === myId ? 'me' : ''}"><span class="dot" style="background:${p.color}"></span><span class="nm">${medal}${esc(p.name)}${p.id === room.host ? ' 👑' : ''}${p.id === myId ? ' (you)' : ''}</span>${tag}` +
    (score ? `<span class="pts">${p.score} pts · ${p.wins}🏆 ${p.kos}💥</span>` : (p.score ? `<span class="pts">${p.score} pts</span>` : '')) + kick + '</li>';
}
function renderScores() {
  const last = snaps[snaps.length - 1];
  $('hud-score').innerHTML = sorted().map(p => {
    const s = last && last.p.get(p.id), dead = s && !s[5];
    return `<li class="${dead ? 'dead' : ''}"><span class="dot" style="background:${p.color}"></span><span class="nm">${esc(p.name)}</span><span>${p.score}</span></li>`;
  }).join('');
  if (last) { let a = 0; last.p.forEach(v => a += v[5]); $('hud-alive').textContent = `${a} alive`; }
  else $('hud-alive').textContent = '';
}
function showScreen(which) { if (which) { joyTouch = null; joy = { x: 0, y: 0 }; const st = document.getElementById('stick'); if (st) st.style.display = 'none'; } for (const s of ['landing', 'lobby', 'over']) $(s).classList.toggle('show', s === which); }
function feed(msg) { const d = document.createElement('div'); d.textContent = msg; $('feed').prepend(d); setTimeout(() => d.remove(), 4000); while ($('feed').children.length > 5) $('feed').lastChild.remove(); }
function center(txt) { const c = $('center'); c.textContent = txt; c.classList.remove('pulse'); void c.offsetWidth; c.classList.add('pulse'); clearTimeout(center.h); center.h = setTimeout(() => c.textContent = '', txt === 'SLAM!' ? 700 : 1100); }
function onOver(m) {
  const t = $('ov-title');
  if (m.winner) { t.innerHTML = `<span style="color:${m.color};text-shadow:0 3px 0 #2b1650">${esc(m.name)}</span><br>WINS THE ROUND! 🏆`; }
  else t.innerHTML = 'Everybody fell in! 🫠<br>No winner';
  if (m.winner === myId) { sfx.win(); confetti(); } else sfx.fall();
  setTimeout(() => {}, 0);
}
let lastCount = null;
function onSnap(m) {
  const now = Date.now();
  offsets.push([now, m.ts - now]); while (offsets.length && offsets[0][0] < now - 3000) offsets.shift();
  const map = new Map(); for (const p of m.p) map.set(p[0], p);
  snaps.push({ ts: m.ts, st: m.st, cd: m.cd, ar: m.ar, rt: m.rt, p: map, recv: performance.now() });
  if (snaps.length > 60) snaps.shift();
  if (m.st === 'countdown') { const c = Math.ceil(m.cd); if (c !== lastCount && c > 0) { lastCount = c; center(String(c)); sfx.beep(false); } }
  const mine = map.get(myId); if (mine) myDashCd = mine[7];
  for (const ev of m.ev) {
    if (ev[0] === 'bonk') { burst(ev[1], ev[2], ev[3]); sfx.bonk(ev[3]); shake = Math.max(shake, ev[3] * 10); }
    else if (ev[0] === 'dash') { if (ev[1] === myId || Math.random() < .5) sfx.dash(); }
    else if (ev[0] === 'fall') {
      const v = players[ev[1]], k = players[ev[2]];
      if (v) feed(k ? `💥 ${k.name} slammed ${v.name} into the soup!` : `🫠 ${v.name} slipped off!`);
      sfx.fall(); const s = map.get(ev[1]); if (s) splash(s[1], s[2], v ? v.color : '#fff');
      if (ev[1] === myId) shake = 16;
    }
  }
  renderScores();
}


// ---------- bots & solo (offline) mode ----------
let botN = Math.max(1, Math.min(7, +(localStorage.getItem('fs-bots') || 3))), botDiff = localStorage.getItem('fs-diff') || 'normal';
function syncSoloUI() {
  $('bot-n').textContent = botN;
  for (const b of document.querySelectorAll('#diffs button')) b.classList.toggle('sel', b.dataset.d === botDiff);
  localStorage.setItem('fs-bots', botN); localStorage.setItem('fs-diff', botDiff);
}
$('bot-minus').onclick = () => { botN = Math.max(1, botN - 1); syncSoloUI(); };
$('bot-plus').onclick = () => { botN = Math.min(7, botN + 1); syncSoloUI(); };
for (const b of document.querySelectorAll('#diffs button')) b.onclick = () => { botDiff = b.dataset.d; syncSoloUI(); };
syncSoloUI();
$('btn-solo').onclick = () => { audio(); startSolo(botN, botDiff); };
// host bot controls (lobby + round-over screens, multiplayer and solo)
for (const b of document.querySelectorAll('[data-addbot]')) b.onclick = () => { const sel = b.parentElement.querySelector('select'); send({ t: 'addbot', n: 1, diff: sel ? sel.value : 'normal' }); };
document.addEventListener('click', e => { const k = e.target.closest('[data-kick]'); if (k) send({ t: 'removebot', id: +k.dataset.kick }); });
for (const b of document.querySelectorAll('[data-leave]')) b.onclick = leaveGame;
function leaveGame() {
  stopSolo();
  if (ws) { leaving = true; try { ws.close(); } catch {} ws = null; }
  myId = null; room = null; snaps = []; $('hud').classList.add('hidden'); $('touch').classList.add('hidden');
  document.body.classList.remove('solo');
  showScreen('landing'); err('');
}
function startSolo(n, diff) {
  if (ws) { leaving = true; try { ws.close(); } catch {} ws = null; }
  stopSolo();
  const name = nameEl.value.trim() || 'You';
  if (nameEl.value.trim()) localStorage.setItem('fs-name', name);
  INTERP = 45; offsets = []; snaps = [];
  const q = [];
  const r = Core.createRoom('SOLO', { send: (p, msg) => q.push(msg) });
  const flush = () => { while (q.length) onMsg(q.shift()); };
  let acc = 0, lastT = performance.now(), snapAcc = 0;
  solo = {
    room: r,
    recv(m) { if (solo && soloMe) { Core.handle(r, soloMe, m); flush(); } },
    timer: setInterval(() => {
      const now = performance.now(), ff = soloMe && soloMe.inRound && !soloMe.alive && r.state === 'playing' ? 3 : 1; acc += Math.min(0.25, (now - lastT) / 1000) * ff; lastT = now;
      while (acc >= Core.DT) { Core.step(r); acc -= Core.DT; snapAcc += Core.DT; if (snapAcc >= 1 / Core.C.SNAP) { snapAcc = 0; Core.snapshot(r); } }
      flush();
    }, 1000 / 120),
  };
  const soloMe = Core.join(r, name, null);
  for (let i = 0; i < n; i++) Core.addBot(r, diff);
  onMsg({ t: 'welcome', id: soloMe.id, code: 'SOLO' });
  Core.startRound(r);
  flush();
}
function stopSolo() { if (solo) { clearInterval(solo.timer); solo = null; } }

// ---------- input ----------
const keys = {}; let mouseDown = false, mouseX = 0, mouseY = 0, joy = { x: 0, y: 0 }, dashQueued = false;
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  keys[e.code] = true;
  if (['Space', 'ShiftLeft', 'ShiftRight', 'KeyJ', 'KeyK'].includes(e.code)) { dashQueued = true; e.preventDefault(); }
  if (e.code === 'Enter' && room && room.host === myId && (curState === 'lobby' || curState === 'over')) send({ t: 'start' });
  if (e.code.startsWith('Arrow')) e.preventDefault();
});
addEventListener('keyup', e => keys[e.code] = false);
addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouseDown = false; });
cv.addEventListener('mousedown', e => { audio(); if (e.button === 2) dashQueued = true; else { mouseDown = true; mouseX = e.clientX; mouseY = e.clientY; } });
addEventListener('mousemove', e => { mouseX = e.clientX; mouseY = e.clientY; });
addEventListener('mouseup', e => { if (e.button !== 2) mouseDown = false; });
cv.addEventListener('contextmenu', e => e.preventDefault());
// touch joystick (floating, anywhere on left 60%)
let joyTouch = null, joyOrigin = null;
const stick = $('stick'), knob = $('knob');
addEventListener('touchstart', e => {
  audio();
  for (const t of e.changedTouches) {
    if (t.target.id === 'dashbtn') continue;
    if (joyTouch === null && t.clientX < W * 0.6 && !['lobby', 'over', 'landing'].some(s => $(s).classList.contains('show'))) {
      joyTouch = t.identifier; joyOrigin = { x: t.clientX, y: t.clientY };
      stick.style.display = 'block'; stick.style.left = (t.clientX - 65) + 'px'; stick.style.top = (t.clientY - 65) + 'px';
      knob.style.transform = ''; e.preventDefault();
    } else if (t.clientX >= W * 0.6 && !['lobby', 'over', 'landing'].some(s => $(s).classList.contains('show'))) { dashQueued = true; }
  }
}, { passive: false });
addEventListener('touchmove', e => {
  for (const t of e.changedTouches) if (t.identifier === joyTouch) {
    let dx = t.clientX - joyOrigin.x, dy = t.clientY - joyOrigin.y; const d = Math.hypot(dx, dy), mx = 55;
    if (d > mx) { dx = dx / d * mx; dy = dy / d * mx; }
    knob.style.transform = `translate(${dx}px,${dy}px)`;
    joy = { x: dx / mx, y: dy / mx }; if (Math.hypot(joy.x, joy.y) < 0.15) joy = { x: 0, y: 0 };
    e.preventDefault();
  }
}, { passive: false });
function endTouch(e) { for (const t of e.changedTouches) if (t.identifier === joyTouch) { joyTouch = null; joy = { x: 0, y: 0 }; stick.style.display = 'none'; } }
addEventListener('touchend', endTouch); addEventListener('touchcancel', endTouch);
$('dashbtn').addEventListener('touchstart', e => { dashQueued = true; e.preventDefault(); e.stopPropagation(); }, { passive: false });
$('dashbtn').addEventListener('mousedown', () => dashQueued = true);

let lastSent = { x: 0, y: 0 }, lastSendT = 0;
function readInput() {
  let x = 0, y = 0;
  if (keys.KeyA || keys.ArrowLeft) x -= 1; if (keys.KeyD || keys.ArrowRight) x += 1;
  if (keys.KeyW || keys.ArrowUp) y -= 1; if (keys.KeyS || keys.ArrowDown) y += 1;
  if (x || y) { const l = Math.hypot(x, y); x /= l; y /= l; }
  else if (joy.x || joy.y) { x = joy.x; y = joy.y; }
  else if (mouseDown) {
    const sx = W / 2 + (me.x - camX) * camScale, sy = H / 2 + (me.y - camY) * camScale;
    const dx = mouseX - sx, dy = mouseY - sy, d = Math.hypot(dx, dy);
    if (d > 8) { const k = Math.min(1, d / 80); x = dx / d * k; y = dy / d * k; }
  }
  const now = performance.now();
  const changed = Math.abs(x - lastSent.x) > 0.05 || Math.abs(y - lastSent.y) > 0.05;
  if (dashQueued || (changed && now - lastSendT > 33) || now - lastSendT > 250) {
    send({ t: 'input', x: +x.toFixed(2), y: +y.toFixed(2), d: dashQueued ? 1 : 0 });
    lastSent = { x, y }; lastSendT = now; dashQueued = false;
  }
}

// ---------- effects ----------
function burst(x, y, s) {
  const n = 6 + Math.floor(s * 14);
  for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, v = 80 + Math.random() * 300 * s + 60; particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: .5 + Math.random() * .4, max: .9, c: ['#fff', '#ffd23f', '#ff7ae0'][i % 3], star: i % 2 === 0, r: 4 + Math.random() * 5 }); }
  rings.push({ x, y, r: 10, life: .35, max: .35, c: '#fff' });
}
function splash(x, y, c) {
  for (let i = 0; i < 24; i++) { const a = Math.random() * 6.28, v = 60 + Math.random() * 220; particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: .8, max: .8, c: i % 2 ? c : '#9be7ff', r: 3 + Math.random() * 6 }); }
  rings.push({ x, y, r: 10, life: .8, max: .8, c: '#bff' }); rings.push({ x, y, r: 4, life: 1.1, max: 1.1, c: c });
}
function confetti() { for (let i = 0; i < 120; i++) { const a = Math.random() * 6.28, v = 100 + Math.random() * 500; particles.push({ x: me.x, y: me.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 200, life: 1.5 + Math.random(), max: 2.5, c: `hsl(${Math.random() * 360},90%,60%)`, r: 4 + Math.random() * 5, g: 1 }); } }

// sprinkles on cake (fixed world coords)
const sprinkles = []; { let s = 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647; for (let i = 0; i < 520; i++) { const r = Math.sqrt(rnd()) * ARENA_START, a = rnd() * 6.28; sprinkles.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, a: rnd() * 6.28, c: ['#ff4d6d', '#3ec1ff', '#ffd23f', '#7cff6b', '#c77dff', '#fff'][i % 6] }); } }

// ---------- interpolation ----------
function serverNow() { let m = -Infinity; for (const o of offsets) m = Math.max(m, o[1]); return Date.now() + (m === -Infinity ? 0 : m); }
function sample() {
  if (!snaps.length) return null;
  const rt = serverNow() - INTERP;
  let a = snaps[0], b = snaps[0];
  for (let i = snaps.length - 1; i >= 0; i--) if (snaps[i].ts <= rt) { a = snaps[i]; b = snaps[i + 1] || snaps[i]; break; }
  const t = b.ts === a.ts ? 0 : Math.max(0, Math.min(1, (rt - a.ts) / (b.ts - a.ts)));
  const out = new Map();
  b.p.forEach((pb, id) => {
    const pa = a.p.get(id) || pb;
    out.set(id, { x: pa[1] + (pb[1] - pa[1]) * t, y: pa[2] + (pb[2] - pa[2]) * t, vx: pa[3] + (pb[3] - pa[3]) * t, vy: pa[4] + (pb[4] - pa[4]) * t, alive: pb[5] && pa[5], dash: pb[6] });
  });
  return { ar: a.ar + (b.ar - a.ar) * t, p: out, st: b.st };
}

// ---------- render ----------
let camX = 0, camY = 0, last = performance.now(), T = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now; T += dt;
  if (myId) readInput();
  const S = sample();
  if (S) arenaR = S.ar;
  // own player: low-latency extrapolation from newest snapshot
  const newest = snaps[snaps.length - 1];
  const fitD = Math.max(arenaR, 200) * 2 + 140, small = Math.min(W, H) < 600;
  const viewD = small ? Math.min(fitD, 640) : fitD, follow = viewD < fitD;
  const targetScale = Math.min(W, H) / viewD;
  camScale += (targetScale - camScale) * Math.min(1, dt * 3);
  if (!isFinite(camScale) || camScale <= 0) camScale = targetScale;
  shake *= Math.exp(-dt * 8);
  const sx = (Math.random() - .5) * shake, sy = (Math.random() - .5) * shake;

  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  // soup background
  const g = ctx.createRadialGradient(W / 2, H / 2, 50, W / 2, H / 2, Math.max(W, H));
  g.addColorStop(0, '#3a2a9c'); g.addColorStop(1, '#140d3a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.translate(W / 2 + sx, H / 2 + sy); ctx.scale(camScale, camScale); ctx.translate(-camX, -camY);
  // wavy soup rings
  ctx.lineWidth = 3;
  for (let i = 0; i < 9; i++) {
    const rr = ARENA_START + 40 + i * 70 + ((T * 25) % 70);
    ctx.strokeStyle = `rgba(140,200,255,${0.12 - i * 0.012})`;
    ctx.beginPath();
    for (let a = 0; a <= 6.3; a += 0.12) { const w = rr + Math.sin(a * 8 + T * 2 + i) * 6; a === 0 ? ctx.moveTo(Math.cos(a) * w, Math.sin(a) * w) : ctx.lineTo(Math.cos(a) * w, Math.sin(a) * w); }
    ctx.closePath(); ctx.stroke();
  }
  // cake
  const ar = arenaR;
  ctx.fillStyle = '#8a3b12'; ctx.beginPath(); ctx.arc(0, 14, ar + 4, 0, 6.29); ctx.fill();
  ctx.fillStyle = '#c66a2b'; ctx.beginPath(); ctx.arc(0, 8, ar + 2, 0, 6.29); ctx.fill();
  const cg = ctx.createRadialGradient(-ar * .3, -ar * .3, 10, 0, 0, ar);
  cg.addColorStop(0, '#ffd1e8'); cg.addColorStop(1, '#ff8cc6');
  ctx.fillStyle = cg; ctx.beginPath();
  for (let a = 0; a <= 6.30; a += 0.05) { const w = ar + Math.sin(a * 14 + 1) * 3; a === 0 ? ctx.moveTo(Math.cos(a) * w, Math.sin(a) * w) : ctx.lineTo(Math.cos(a) * w, Math.sin(a) * w); }
  ctx.closePath(); ctx.fill();
  ctx.save(); ctx.clip();
  for (const s of sprinkles) { if (s.x * s.x + s.y * s.y > (ar - 6) ** 2) continue; ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.a); ctx.fillStyle = s.c; ctx.fillRect(-6, -2, 12, 4); ctx.restore(); }
  ctx.restore();
  // danger edge
  const shrinking = S && S.st === 'playing' && roundT > 0;
  ctx.strokeStyle = `rgba(255,40,80,${0.35 + 0.3 * Math.sin(T * 8)})`; ctx.lineWidth = 6; ctx.setLineDash([18, 14]); ctx.lineDashOffset = -T * 40;
  ctx.beginPath(); ctx.arc(0, 0, ar - 4, 0, 6.29); ctx.stroke(); ctx.setLineDash([]);

  // rings / particles under players
  for (let i = rings.length - 1; i >= 0; i--) { const r = rings[i]; r.life -= dt; if (r.life <= 0) { rings.splice(i, 1); continue; } r.r += dt * 260; ctx.strokeStyle = r.c; ctx.globalAlpha = r.life / r.max; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, 6.29); ctx.stroke(); }
  ctx.globalAlpha = 1;

  if (S) {
    const list = [];
    S.p.forEach((p, id) => {
      let v = visuals[id]; if (!v) v = visuals[id] = { x: p.x, y: p.y, vx: 0, vy: 0, fall: 0, trail: [], sq: 0 };
      let tx = p.x, ty = p.y, tvx = p.vx, tvy = p.vy, alive = p.alive;
      if (id === myId && newest && newest.p.get(id)) {
        const n = newest.p.get(id), age = Math.min(0.1, (performance.now() - newest.recv) / 1000);
        if (n[5]) { tx = n[1] + n[3] * age; ty = n[2] + n[4] * age; tvx = n[3]; tvy = n[4]; }
        alive = alive && n[5];
      }
      const k = id === myId ? Math.min(1, dt * 25) : 1;
      v.x += (tx - v.x) * k; v.y += (ty - v.y) * k; v.vx = tvx; v.vy = tvy;
      if (!alive) v.fall = Math.min(1, v.fall + dt * 1.6); else v.fall = 0;
      if (p.dash && alive) v.trail.push({ x: v.x, y: v.y, l: .25 });
      list.push([id, v, p, alive]);
      if (id === myId) { me.x = v.x; me.y = v.y; }
    });
    // camera: center (follow me a bit on phones)
    let tcx = 0, tcy = 0;
    if (follow && myId && visuals[myId] && !visuals[myId].fall) { const lim = Math.max(0, (fitD - viewD) / 2); tcx = Math.max(-lim, Math.min(lim, me.x)); tcy = Math.max(-lim, Math.min(lim, me.y)); } camX += (tcx - camX) * Math.min(1, dt * 3); camY += (tcy - camY) * Math.min(1, dt * 3);
    list.sort((a, b) => a[1].y - b[1].y);
    for (const [id, v, p, alive] of list) drawJelly(id, v, p, alive, dt);
  }
  // particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const q = particles[i]; q.life -= dt; if (q.life <= 0) { particles.splice(i, 1); continue; }
    q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= .94; q.vy *= .94; if (q.g) q.vy += 600 * dt;
    ctx.globalAlpha = Math.min(1, q.life / q.max * 1.5); ctx.fillStyle = q.c;
    if (q.star) drawStar(q.x, q.y, q.r * 1.4); else { ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, 6.29); ctx.fill(); }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  // dash button cooldown
  const db = $('dashbtn'); if (db) db.classList.toggle('cd', myDashCd > 0.05);
  if (newest) roundT = newest.rt;
  requestAnimationFrame(frame);
}
function drawStar(x, y, r) { ctx.beginPath(); for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5 - Math.PI / 2, rr = i % 2 ? r * .45 : r; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } ctx.closePath(); ctx.fill(); }
function shade(hex, f) { const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255; r = Math.round(r * f); g = Math.round(g * f); b = Math.round(b * f); return `rgb(${Math.min(255, r)},${Math.min(255, g)},${Math.min(255, b)})`; }
function drawJelly(id, v, p, alive, dt) {
  const info = players[id] || { name: '?', color: '#ccc' };
  const col = info.color;
  // trail
  for (let i = v.trail.length - 1; i >= 0; i--) { const t = v.trail[i]; t.l -= dt; if (t.l <= 0) { v.trail.splice(i, 1); continue; } ctx.globalAlpha = t.l * 1.6; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(t.x, t.y, R * (0.5 + t.l * 2), 0, 6.29); ctx.fill(); }
  ctx.globalAlpha = 1;
  const f = v.fall; if (f >= 1) return;
  const sc = 1 - f * 0.85;
  ctx.save(); ctx.translate(v.x, v.y + f * 30);
  ctx.globalAlpha = 1 - f;
  // shadow
  if (!f) { ctx.fillStyle = 'rgba(80,0,40,.25)'; ctx.beginPath(); ctx.ellipse(4, R * .75, R * 1.0, R * .45, 0, 0, 6.29); ctx.fill(); }
  const sp = Math.hypot(v.vx, v.vy), ang = Math.atan2(v.vy, v.vx);
  const st = 1 + Math.min(.38, sp / 1400), wob = Math.sin(T * 10 + id) * 0.04;
  ctx.rotate(ang); ctx.scale(st * sc * (1 + wob), sc / st * (1 - wob)); ctx.rotate(-ang);
  // body
  const bg = ctx.createRadialGradient(-R * .35, -R * .45, 2, 0, 0, R * 1.1);
  bg.addColorStop(0, shade(col, 1.45)); bg.addColorStop(.6, col); bg.addColorStop(1, shade(col, .7));
  ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(0, 0, R, 0, 6.29); ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = shade(col, .5); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.beginPath(); ctx.ellipse(-R * .38, -R * .45, R * .28, R * .15, -0.6, 0, 6.29); ctx.fill();
  // face
  const lx = sp > 20 ? Math.cos(ang) * 6 : 0, ly = sp > 20 ? Math.sin(ang) * 6 : 0;
  for (const ex of [-9, 9]) {
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex + lx * .5, -4 + ly * .5, 7.5, 0, 6.29); ctx.fill();
    ctx.fillStyle = '#1b1446'; ctx.beginPath(); ctx.arc(ex + lx * .9, -4 + ly * .9, f ? 2 : 3.6, 0, 6.29); ctx.fill();
  }
  ctx.strokeStyle = '#1b1446'; ctx.lineWidth = 2.5; ctx.beginPath();
  if (f || p.dash) { ctx.arc(lx * .5, 9 + ly * .5, 4, 0, 6.29); } else ctx.arc(lx * .5, 6 + ly * .5, 6, 0.2, Math.PI - 0.2);
  ctx.stroke();
  ctx.restore();
  // name tag
  if (f < .5) {
    ctx.save(); ctx.globalAlpha = 1 - f * 2;
    const fs = 14 / camScale;
    ctx.font = `900 ${fs}px Trebuchet MS, sans-serif`; ctx.textAlign = 'center';
    const label = info.name + (id === myId ? ' (you)' : '');
    ctx.lineWidth = 4 / camScale; ctx.strokeStyle = 'rgba(27,20,70,.85)'; ctx.strokeText(label, v.x, v.y - R - 10);
    ctx.fillStyle = id === myId ? '#ffd23f' : '#fff'; ctx.fillText(label, v.x, v.y - R - 10);
    if (id === myId) {
      // dash cooldown ring
      const cdFrac = Math.max(0, Math.min(1, myDashCd / 1.6));
      ctx.lineWidth = 4; ctx.strokeStyle = cdFrac > 0 ? 'rgba(255,255,255,.35)' : 'rgba(255,210,63,.9)';
      ctx.beginPath(); ctx.arc(v.x, v.y, R + 8, -Math.PI / 2, -Math.PI / 2 + 6.283 * (1 - cdFrac)); ctx.stroke();
    }
    ctx.restore();
  }
}
requestAnimationFrame(frame);

// auto-focus
if (!isTouch) setTimeout(() => (nameEl.value ? (urlRoom ? $('btn-joinlink') : $('btn-create')).focus() : nameEl.focus()), 50);
})();
