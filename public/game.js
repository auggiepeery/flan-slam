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
  crumble: () => { tone(160, 40, 0.5, 'sawtooth', 0.08); tone(90, 30, 0.6, 'triangle', 0.12, 0.05); },
  clang: () => { tone(1400, 900, 0.25, 'triangle', 0.08); tone(2100, 1500, 0.2, 'sine', 0.05); },
  whoosh: () => tone(300, 900, 0.5, 'sawtooth', 0.04),
  warn: () => { tone(660, 660, 0.1, 'square', 0.05); tone(660, 660, 0.1, 'square', 0.05, 0.18); },
  mega: () => [660, 880, 1320].forEach((f, i) => tone(f, f * 1.5, 0.15, 'triangle', 0.1, i * 0.07)),

  bonk: s => { tone(320 + Math.random() * 80, 90, 0.18, 'sine', 0.15 + s * 0.25); tone(900, 300, 0.06, 'triangle', 0.06 * s); },
  dash: () => tone(200, 700, 0.15, 'sawtooth', 0.06),
  fall: () => { tone(600, 80, 0.5, 'sine', 0.18); tone(150, 60, 0.4, 'triangle', 0.1, 0.35); },
  beep: hi => tone(hi ? 880 : 440, hi ? 880 : 440, hi ? 0.35 : 0.15, 'square', 0.07),
  win: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, f, 0.22, 'triangle', 0.12, i * 0.12)),
};

const HZ_INFO = {
  crumble: { t: '⚠️ The sand is collapsing!', s: () => sfx.warn() },
  spoon: { t: '🏖️ Giant beach shovel incoming — hug the middle!', s: () => sfx.warn() },
  syrup: { t: '🌿 Seaweed slick — super slippery!', s: () => sfx.whoosh() },
  wind: { t: '🌬️ Sea breeze incoming!', s: () => sfx.whoosh() },
  star: { t: '⭐ A Mega-Slam starfish washed up!', s: () => sfx.mega() },
};
function banner(txt) { const b = $('banner'); b.textContent = txt; b.classList.remove('pulse'); void b.offsetWidth; b.classList.add('pulse'); clearTimeout(banner.h); banner.h = setTimeout(() => b.textContent = '', 1800); }
// ---------- landing ----------
const nameEl = $('name'), codeEl = $('code');
nameEl.value = (localStorage.getItem('fs-name') || localStorage.getItem('jj-name')) || '';
const urlRoom = (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
if (urlRoom) { $('joinbox-link').classList.remove('hidden'); $('linkcode').textContent = urlRoom; codeEl.value = urlRoom; $('btn-create').classList.add('ghost'); }
nameEl.addEventListener('input', () => { if (nameEl.value.trim()) localStorage.setItem('fs-name', nameEl.value.trim()); });
codeEl.addEventListener('input', () => codeEl.value = codeEl.value.toUpperCase().replace(/[^A-Z]/g, ''));
function err(m) { $('err').textContent = m || ''; }
function go(kind, code) {
  audio();
  const name = nameEl.value.trim();
  if (!name) { err('Pick a nickname first!'); nameEl.focus(); return; }
  localStorage.setItem('fs-name', name);
  if (kind === 'join' && (!code || code.length !== 4)) { err('Room codes are 4 letters'); return; }
  err('Connecting…');
  connect({ t: kind, name, code, char: look.char, color: look.color });
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
async function copyCode() { try { await navigator.clipboard.writeText(roomCode); toast(`Room code ${roomCode} copied!`); } catch { toast(`Room code: ${roomCode}`); } }
$('btn-copy-code').onclick = copyCode; $('btn-ov-copy-code').onclick = copyCode;
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
function serverHttpBase() { return serverWsUrl().replace(/^ws/, 'http').replace(/\/ws$/, ''); }
// Free hosts (Render) put the server to sleep when idle; the first connection can take ~30-60s while it boots.
// Instead of failing, keep poking /healthz and retrying the socket, with a friendly "waking" notice.
const WAKE_LIMIT = 100000, OPEN_TIMEOUT = 9000;
let conn = null;
function wakePing() { try { fetch(serverHttpBase() + '/healthz', { cache: 'no-store', mode: 'cors' }).catch(() => {}); } catch {} }
function cancelConnect(closeSock) {
  if (conn) { clearTimeout(conn.retry); clearInterval(conn.tick); conn = null; }
  $('wake').classList.add('hidden');
  if (closeSock && ws) { leaving = true; try { ws.close(); } catch {} ws = null; }
}
function showWaking() {
  const c = conn; if (!c || c.tick) return;
  $('wake').classList.remove('hidden'); err('');
  const upd = () => { const s = Math.round((Date.now() - c.start) / 1000); $('wake-t').textContent = s + 's'; };
  upd(); c.tick = setInterval(upd, 500);
}
function connect(first) {
  stopSolo(); cancelConnect(true);
  conn = { first, start: Date.now(), tries: 0, tick: null, retry: null };
  attempt(conn);
}
function attempt(c) {
  if (conn !== c) return;
  c.tries++; leaving = false; INTERP = 110;
  let opened = false, sock;
  try { sock = new WebSocket(serverWsUrl()); } catch { err('Bad server address'); cancelConnect(); return; }
  ws = sock;
  const hung = setTimeout(() => { if (!opened) try { sock.close(); } catch {} }, OPEN_TIMEOUT);
  sock.onopen = () => {
    opened = true; clearTimeout(hung);
    if (conn !== c) { try { sock.close(); } catch {} return; }
    cancelConnect(); send(c.first);
  };
  sock.onmessage = e => { if (ws === sock) onMsg(JSON.parse(e.data)); };
  sock.onclose = () => {
    clearTimeout(hung);
    if (!opened) {
      if (conn !== c) return;
      if (ws === sock) ws = null;
      if (Date.now() - c.start < WAKE_LIMIT) {
        if (!c.tick) showWaking();
        wakePing();
        c.retry = setTimeout(() => attempt(c), Math.min(1000 * c.tries, 4000));
      } else { cancelConnect(); err('The multiplayer server didn\u2019t wake up \u2014 try again in a minute, or “Play vs AI”!'); }
      return;
    }
    if (leaving || ws !== sock) return;
    if (myId) { toast('Disconnected — reload to rejoin'); showScreen('landing'); err('Disconnected from server. Try joining again.'); myId = null; $('hud').classList.add('hidden'); }
    else err('Lost the connection to the multiplayer server — try again, or “Play vs AI”!');
  };
}
$('btn-wake-cancel').onclick = () => { cancelConnect(true); err(''); };
// On a static host (GitHub Pages) start waking a sleeping server as soon as the page loads.
if (window.FLAN_SERVER && navigator.onLine !== false) setTimeout(wakePing, 300);
function onMsg(m) {
  if (m.t === 'error') { err(m.msg); return; }
  if (m.t === 'welcome') {
    myId = m.id; roomCode = m.code; err('');
    if (!solo) history.replaceState(null, '', `?room=${roomCode}` + (new URLSearchParams(location.search).get('server') ? '&server=' + encodeURIComponent(new URLSearchParams(location.search).get('server')) : ''));
    $('lb-code').textContent = roomCode; $('hud-code').textContent = roomCode; $('ov-code').textContent = roomCode; $('lb-link').value = shareLink();
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
  if (mine && !prev && mine.color !== look.color) toast('That colour was taken — you got a similar one!');
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
  return `<li class="${p.id === myId ? 'me' : ''}"><img class="ficon" alt="" src="${FlanArt.icon(p.char, p.color, 32)}"><span class="nm">${medal}${esc(p.name)}${p.id === room.host ? ' 👑' : ''}${p.id === myId ? ' (you)' : ''}</span>${tag}` +
    (score ? `<span class="pts">${p.score} pts · ${p.wins}🏆 ${p.kos}💥</span>` : (p.score ? `<span class="pts">${p.score} pts</span>` : '')) + kick + '</li>';
}
function renderScores() {
  const last = snaps[snaps.length - 1];
  $('hud-score').innerHTML = sorted().map(p => {
    const s = last && last.p.get(p.id), dead = s && !s[5];
    return `<li class="${dead ? 'dead' : ''}"><img class="ficon sm" alt="" src="${FlanArt.icon(p.char, p.color, 18)}"><span class="nm">${esc(p.name)}</span><span>${p.score}</span></li>`;
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
  snaps.push({ ts: m.ts, st: m.st, cd: m.cd, ar: m.ar, rt: m.rt, p: map, hz: m.hz || [], recv: performance.now() });
  if (snaps.length > 60) snaps.shift();
  if (m.st === 'countdown') { const c = Math.ceil(m.cd); if (c !== lastCount && c > 0) { lastCount = c; center(String(c)); sfx.beep(false); } }
  const mine = map.get(myId); if (mine) myDashCd = mine[7];
  for (const ev of m.ev) {
    if (ev[0] === 'bonk') { burst(ev[1], ev[2], ev[3]); sfx.bonk(ev[3]); shake = Math.max(shake, ev[3] * 10); }
    else if (ev[0] === 'hz') { const H = HZ_INFO[ev[1]]; if (H) { banner(H.t); H.s(); } }
    else if (ev[0] === 'crumbled') { shake = Math.max(shake, 9); sfx.crumble(); for (let i = 0; i < 26; i++) { const a = ev[1] + (Math.random() - .5) * 0.9, r = arenaR - Math.random() * 100; particles.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, vx: Math.cos(a) * (40 + Math.random() * 120), vy: Math.sin(a) * (40 + Math.random() * 120), life: .9, max: .9, c: i % 3 === 0 ? '#ffffff' : i % 2 ? '#c99e5e' : '#f3d79b', r: 3 + Math.random() * 6 }); } }
    else if (ev[0] === 'spoonhit') { burst(ev[1], ev[2], .5); sfx.clang(); shake = Math.max(shake, 5); }
    else if (ev[0] === 'mega') { const pl = players[ev[1]]; if (pl) feed(`⭐ ${pl.name} grabbed a Mega-Slam starfish!`); sfx.mega(); if (ev[1] === myId) banner('⭐ MEGA SLAM! You hit way harder for 5s'); }
    else if (ev[0] === 'dash') { if (ev[1] === myId || Math.random() < .5) sfx.dash(); }
    else if (ev[0] === 'fall') {
      const v = players[ev[1]], k = players[ev[2]];
      if (v) feed(k ? `💥 ${k.name} slammed ${v.name} into the sea!` : ev[3] === 'hazard' ? `🌊 The tide took ${v.name}!` : `🫠 ${v.name} slipped off!`);
      sfx.fall(); const s = map.get(ev[1]); if (s) splash(s[1], s[2], v ? v.color : '#fff');
      if (ev[1] === myId) shake = 16;
    }
  }
  renderScores();
}



// ---------- character + colour picker (remembered in localStorage) ----------
const look = {
  char: Core.validChar(localStorage.getItem('fs-char')) || Core.CHAR_IDS[Math.floor(Math.random() * Core.CHAR_IDS.length)],
  color: Core.validColor(localStorage.getItem('fs-color')) || Core.PALETTE[Math.floor(Math.random() * 8)],
};
function saveLook() { localStorage.setItem('fs-char', look.char); localStorage.setItem('fs-color', look.color); }
saveLook();
const charsEl = $('chars'), swEl = $('swatches'), customEl = $('custom-color');
charsEl.innerHTML = Core.CHARS.map(c => `<button type="button" class="chartile" data-char="${c.id}" title="${c.name}: ${c.desc}"><canvas width="112" height="112"></canvas></button>`).join('');
swEl.innerHTML = Core.PALETTE.map(c => `<button type="button" class="sw" data-color="${c}" style="background:${c}" title="${c}"></button>`).join('');
function renderLookUI() {
  for (const b of charsEl.querySelectorAll('.chartile')) b.classList.toggle('sel', b.dataset.char === look.char);
  for (const b of swEl.querySelectorAll('.sw')) b.classList.toggle('sel', b.dataset.color === look.color);
  customEl.value = look.color;
  $('custom-wrap').classList.toggle('sel', !Core.PALETTE.includes(look.color));
  $('custom-wrap').style.background = look.color;
  const c = Core.CHARS.find(c => c.id === look.char); $('char-name').textContent = c.name; $('char-desc').textContent = c.desc;
}
charsEl.addEventListener('click', e => { const b = e.target.closest('[data-char]'); if (b) { look.char = b.dataset.char; saveLook(); renderLookUI(); } });
swEl.addEventListener('click', e => { const b = e.target.closest('[data-color]'); if (b) { look.color = b.dataset.color; saveLook(); renderLookUI(); } });
customEl.addEventListener('input', () => { const c = Core.validColor(customEl.value); if (c) { look.color = c; saveLook(); renderLookUI(); } });
renderLookUI();
// animated previews (only while the landing screen is visible)
function drawPreviews(t) {
  if ($('landing').classList.contains('show')) {
    for (const b of charsEl.querySelectorAll('.chartile')) {
      const cv2 = b.firstChild, g = cv2.getContext('2d'), sel = b.dataset.char === look.char;
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, 112, 112);
      const wob = sel ? Math.sin(t / 160) * 0.05 : 0;
      g.translate(56, 70); g.scale(1.3 * (1 + wob), 1.3 * (1 - wob));
      const lx = sel ? Math.cos(t / 700) * 5 : 0;
      FlanArt.drawFlan(g, b.dataset.char, { color: look.color, R: 26, lx, ly: 0, t: t / 1000 });
    }
  }
  requestAnimationFrame(drawPreviews);
}
requestAnimationFrame(drawPreviews);

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
  stopSolo(); cancelConnect();
  if (ws) { leaving = true; try { ws.close(); } catch {} ws = null; }
  myId = null; room = null; snaps = []; $('hud').classList.add('hidden'); $('touch').classList.add('hidden');
  document.body.classList.remove('solo');
  showScreen('landing'); err('');
}
function startSolo(n, diff) {
  cancelConnect();
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
  const soloMe = Core.join(r, name, null, { char: look.char, color: look.color });
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
  // water splash: droplets thrown up (with gravity), a foam burst and expanding ripples
  for (let i = 0; i < 30; i++) { const a = Math.random() * 6.28, v = 50 + Math.random() * 200; particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.6 - 260 - Math.random() * 160, life: .9, max: .9, c: ['#ffffff', '#bff4ff', '#5fd3e8', c][i % 4], r: 2.5 + Math.random() * 5, g: 1 }); }
  for (let i = 0; i < 10; i++) { const a = Math.random() * 6.28; particles.push({ x: x + Math.cos(a) * 12, y: y + Math.sin(a) * 12, vx: Math.cos(a) * 60, vy: Math.sin(a) * 60, life: 1.2, max: 1.2, c: 'rgba(255,255,255,.9)', r: 7 + Math.random() * 6 }); }
  rings.push({ x, y, r: 8, life: .9, max: .9, c: '#ffffff' }); rings.push({ x, y, r: 2, life: 1.3, max: 1.3, c: '#bff4ff' }); rings.push({ x, y, r: 0, life: 1.6, max: 1.6, c: 'rgba(255,255,255,.6)' });
}
function confetti() { for (let i = 0; i < 120; i++) { const a = Math.random() * 6.28, v = 100 + Math.random() * 500; particles.push({ x: me.x, y: me.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 200, life: 1.5 + Math.random(), max: 2.5, c: `hsl(${Math.random() * 360},90%,60%)`, r: 4 + Math.random() * 5, g: 1 }); } }

// beach decorations (fixed world coords): shells, pebbles, footprints + a pre-rendered sand-grain tile
const deco = []; { let sd = 7; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 70; i++) { const r = Math.sqrt(rnd()) * ARENA_START * 0.95, a = rnd() * 6.28; deco.push({ k: i % 3 ? 'pebble' : 'shell', x: Math.cos(a) * r, y: Math.sin(a) * r, a: rnd() * 6.28, s: 0.7 + rnd() * 0.6, c: ['#fff4e0', '#ffd1c1', '#f7b89c', '#e9e2d0'][i % 4] }); }
  for (let t = 0; t < 3; t++) { let x = (rnd() - .5) * 500, y = (rnd() - .5) * 500, a = rnd() * 6.28;
    for (let i = 0; i < 12; i++) { a += (rnd() - .5) * 0.5; x += Math.cos(a) * 34; y += Math.sin(a) * 34; const side = i % 2 ? 1 : -1; deco.push({ k: 'foot', x: x - Math.sin(a) * 8 * side, y: y + Math.cos(a) * 8 * side, a }); } } }
const sandTile = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#f3d79b'; g.fillRect(0, 0, 128, 128); let sd = 3; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 900; i++) { const v = rnd(); g.fillStyle = v < .45 ? 'rgba(160,110,50,.22)' : v < .8 ? 'rgba(255,250,230,.45)' : 'rgba(120,80,40,.3)'; g.fillRect(rnd() * 128, rnd() * 128, 1 + rnd() * 1.6, 1 + rnd() * 1.6); }
  return c; })();
let sandPat = null;
const glints = Array.from({ length: 46 }, (_, i) => ({ a: i * 2.399, r: ARENA_START + 60 + ((i * 53) % 420), ph: i * 1.7 }));

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
    out.set(id, { x: pa[1] + (pb[1] - pa[1]) * t, y: pa[2] + (pb[2] - pa[2]) * t, vx: pa[3] + (pb[3] - pa[3]) * t, vy: pa[4] + (pb[4] - pa[4]) * t, alive: pb[5] && pa[5], dash: pb[6], mega: pb[8] || 0 });
  });
  // hazards: take the newer snapshot, but interpolate the spoon's angle
  const hz = b.hz.map(h => { if (h[0] !== 's') return h; const ha = (a.hz || []).find(x => x[0] === 's'); if (!ha) return h; let d = h[1] - ha[1]; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return ['s', ha[1] + d * t, h[2], h[3], h[4]]; });
  return { ar: a.ar + (b.ar - a.ar) * t, p: out, st: b.st, hz };
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
  // ocean background
  const g = ctx.createRadialGradient(W / 2, H / 2, 60, W / 2, H / 2, Math.max(W, H) * 0.8);
  g.addColorStop(0, '#22c3d6'); g.addColorStop(0.45, '#0d8fbf'); g.addColorStop(1, '#064b7a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.translate(W / 2 + sx, H / 2 + sy); ctx.scale(camScale, camScale); ctx.translate(-camX, -camY);
  // rolling wave crests + sun glints
  ctx.lineWidth = 4; ctx.lineCap = 'round';
  for (let i = 0; i < 9; i++) {
    const rr = ARENA_START + 50 + i * 75 + ((T * 22) % 75);
    ctx.strokeStyle = `rgba(220,250,255,${0.22 - i * 0.022})`; ctx.beginPath();
    for (let a = 0; a <= 6.3; a += 0.13) { const w = rr + Math.sin(a * 7 + T * 1.6 + i) * 8; a === 0 ? ctx.moveTo(Math.cos(a) * w, Math.sin(a) * w) : ctx.lineTo(Math.cos(a) * w, Math.sin(a) * w); }
    ctx.closePath(); ctx.stroke();
  }
  ctx.fillStyle = '#fff';
  for (const q of glints) { const al = Math.sin(T * 2.2 + q.ph); if (al < 0.55) continue; ctx.globalAlpha = (al - 0.55) * 2; const x = Math.cos(q.a + T * 0.02) * q.r, y = Math.sin(q.a + T * 0.02) * q.r; ctx.fillRect(x - 7, y - 1.5, 14, 3); ctx.fillRect(x - 1.5, y - 5, 3, 10); }
  ctx.globalAlpha = 1;
  // sand island (edge follows the shrinking radius and collapsed chunks)
  const ar = arenaR, hzs = (S && S.hz) || [];
  const fake = { arenaR: ar, hz: hzs.filter(h => h[0] === 'c').map(h => ({ k: 'crumble', a: h[1], w: h[2], depth: h[3], warn: h[4] })) };
  const rim = a => Core.rimAt(fake, a);
  const rims = new Float32Array(201); for (let i = 0; i <= 200; i++) rims[i] = rim(i / 200 * Math.PI * 2) + Math.sin(i / 200 * Math.PI * 2 * 11 + 1) * 3;
  const islandPath = (inset, dy, wob) => { ctx.beginPath(); for (let i = 0; i <= 200; i++) { const a = i / 200 * Math.PI * 2, w = rims[i] - inset + (wob ? Math.sin(a * 17 + T * 2.4) * wob : 0); const x = Math.cos(a) * w, y = Math.sin(a) * w + (dy || 0); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.closePath(); };
  ctx.fillStyle = 'rgba(120,235,225,.45)'; islandPath(-30, 0, 4); ctx.fill();          // shallow turquoise water
  ctx.fillStyle = 'rgba(190,250,240,.5)'; islandPath(-14, 0, 3); ctx.fill();
  ctx.fillStyle = '#c99e5e'; islandPath(0, 0); ctx.fill();                              // wet sand band (= the slippery slope)
  if (!sandPat) sandPat = ctx.createPattern(sandTile, 'repeat');
  ctx.fillStyle = sandPat; islandPath(Core.C.RIM * 0.8, 0); ctx.fill();               // dry sand
  ctx.save(); islandPath(0, 0); ctx.clip();
  const sg0 = ctx.createRadialGradient(-ar * .35, -ar * .35, 10, 0, 0, ar * 1.05); sg0.addColorStop(0, 'rgba(255,250,225,.35)'); sg0.addColorStop(1, 'rgba(150,100,40,.18)');
  ctx.fillStyle = sg0; ctx.fillRect(-ar - 40, -ar - 40, ar * 2 + 80, ar * 2 + 80);
  for (const d of deco) {
    if (Math.hypot(d.x, d.y) > rim(Math.atan2(d.y, d.x)) - Core.C.RIM) continue;
    ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.a);
    if (d.k === 'foot') { ctx.fillStyle = 'rgba(150,105,50,.28)'; ctx.beginPath(); ctx.ellipse(0, 0, 9, 5, 0, 0, 6.29); ctx.fill(); ctx.beginPath(); ctx.ellipse(10, 0, 3.5, 3, 0, 0, 6.29); ctx.fill(); }
    else if (d.k === 'pebble') { ctx.fillStyle = 'rgba(140,110,80,.45)'; ctx.beginPath(); ctx.ellipse(0, 0, 4 * d.s, 3 * d.s, 0, 0, 6.29); ctx.fill(); }
    else { ctx.scale(d.s, d.s); ctx.fillStyle = d.c; ctx.strokeStyle = 'rgba(150,90,60,.6)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(0, 6); ctx.arc(0, 6, 11, Math.PI * 1.15, Math.PI * 1.85); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); for (const k of [-0.5, -0.17, 0.17, 0.5]) { ctx.moveTo(0, 6); ctx.lineTo(Math.sin(k) * 10, 6 - Math.cos(k) * 10); } ctx.stroke(); }
    ctx.restore();
  }
  // seaweed slicks (tide pools)
  for (const h of hzs) if (h[0] === 'y') {
    const r = h[3] * Math.min(1, h[4] * 1.1 + 0.15), fade = Math.min(1, h[5] / 1.2);
    ctx.globalAlpha = 0.9 * fade; const tg = ctx.createRadialGradient(h[1], h[2], r * 0.2, h[1], h[2], r);
    tg.addColorStop(0, '#2fc4c9'); tg.addColorStop(0.75, '#1f9a8f'); tg.addColorStop(1, '#3f7a52'); ctx.fillStyle = tg; ctx.beginPath();
    for (let i = 0; i <= 36; i++) { const a = i / 36 * Math.PI * 2, rr = r * (1 + Math.sin(a * 5 + h[1]) * 0.08 + Math.sin(T * 2 + a * 3) * 0.02); i ? ctx.lineTo(h[1] + Math.cos(a) * rr, h[2] + Math.sin(a) * rr) : ctx.moveTo(h[1] + Math.cos(a) * rr, h[2] + Math.sin(a) * rr); }
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#3d8b3d'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    for (let k = 0; k < 6; k++) { const a = k * 1.05 + h[1], bx = h[1] + Math.cos(a) * r * 0.45, by = h[2] + Math.sin(a) * r * 0.45; ctx.beginPath(); ctx.moveTo(bx, by);
      for (let j = 1; j <= 4; j++) ctx.lineTo(bx + Math.cos(a) * j * r * 0.11 + Math.sin(T * 3 + j + k) * 4, by + Math.sin(a) * j * r * 0.11 + Math.cos(T * 3 + j + k) * 4); ctx.stroke(); }
    ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.ellipse(h[1] - r * .3, h[2] - r * .38, r * .28, r * .08, -0.5, 0, 6.29); ctx.fill(); ctx.globalAlpha = 1;
  }
  // crumble warnings: flashing wedge + cracks
  for (const h of hzs) if (h[0] === 'c' && h[4] > 0) {
    const r0 = Math.max(ar * 0.5, ar - h[3]), fl = 0.35 + 0.3 * Math.sin(T * (h[4] < 0.6 ? 30 : 14));
    ctx.fillStyle = `rgba(255,70,40,${fl})`; ctx.beginPath(); ctx.arc(0, 0, ar + 4, h[1] - h[2], h[1] + h[2]); ctx.arc(0, 0, r0, h[1] + h[2], h[1] - h[2], true); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#6b3d12'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, r0, h[1] - h[2], h[1] + h[2]); ctx.stroke();
    for (const e of [-1, 1]) { ctx.beginPath(); ctx.moveTo(Math.cos(h[1] + e * h[2]) * r0, Math.sin(h[1] + e * h[2]) * r0); ctx.lineTo(Math.cos(h[1] + e * h[2]) * ar, Math.sin(h[1] + e * h[2]) * ar); ctx.stroke(); }
    const mx = Math.cos(h[1]) * (r0 + ar) / 2, my = Math.sin(h[1]) * (r0 + ar) / 2;
    ctx.font = `900 ${34}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'; ctx.fillText('⚠', mx, my);
  }
  ctx.restore();
  // surf: foam lines lapping at the edge
  ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 6; islandPath(-3 - Math.sin(T * 1.8) * 2, 0, 2); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 4; ctx.setLineDash([26, 18]); ctx.lineDashOffset = -T * 30; islandPath(-13 - Math.sin(T * 1.8 + 1) * 3, 0, 3); ctx.stroke(); ctx.setLineDash([]);
  ctx.strokeStyle = `rgba(255,90,60,${0.25 + 0.2 * Math.sin(T * 8)})`; ctx.lineWidth = 3; ctx.setLineDash([14, 14]); ctx.lineDashOffset = T * 30; islandPath(Core.C.RIM * 0.8, 0); ctx.stroke(); ctx.setLineDash([]);
  // wind: arrows while warning, streaks while blowing
  for (const h of hzs) if (h[0] === 'w') {
    const ux = Math.cos(h[1]), uy = Math.sin(h[1]), px = -uy, py = ux;
    if (h[2] > 0) {
      ctx.globalAlpha = 0.45 + 0.35 * Math.sin(T * 12); ctx.fillStyle = '#e8f6ff';
      for (const o of [-1, 0, 1]) { const cx = px * o * ar * 0.45, cy = py * o * ar * 0.45; ctx.save(); ctx.translate(cx, cy); ctx.rotate(h[1]); ctx.beginPath(); ctx.moveTo(-60, -14); ctx.lineTo(20, -14); ctx.lineTo(20, -32); ctx.lineTo(62, 0); ctx.lineTo(20, 32); ctx.lineTo(20, 14); ctx.lineTo(-60, 14); ctx.closePath(); ctx.fill(); ctx.restore(); }
      ctx.globalAlpha = 1;
    } else {
      ctx.strokeStyle = 'rgba(230,248,255,.55)'; ctx.lineWidth = 4; ctx.lineCap = 'round';
      for (let i = 0; i < 26; i++) { const off = ((i * 97.3) % (ar * 2.4)) - ar * 1.2, ph = ((T * 900 + i * 173) % (ar * 3)) - ar * 1.5; const x = px * off + ux * ph, y = py * off + uy * ph; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - ux * 60, y - uy * 60); ctx.stroke(); }
    }
  }
  // giant beach shovel: ghost while warning, sweeping shovel while live
  for (const h of hzs) if (h[0] === 's') {
    const L = ar + 30, HUB = Core.C.SPOON_HUB;
    ctx.save(); ctx.rotate(h[1]);
    if (h[3] > 0) {
      ctx.globalAlpha = 0.3 + 0.25 * Math.sin(T * 14); ctx.fillStyle = '#063a55';
      ctx.fillRect(HUB, -12, L - HUB, 24);
      ctx.fillStyle = '#fff'; ctx.font = '900 40px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.save(); ctx.translate(L * 0.6, h[2] * 46); ctx.rotate(-h[1]); ctx.fillText(h[2] > 0 ? '↻' : '↺', 0, 0); ctx.restore();
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = 'rgba(90,60,20,.25)'; ctx.fillRect(HUB, 4, L - HUB - 60, 16);                 // shadow on the sand
      for (let k = 1; k <= 3; k++) { ctx.globalAlpha = 0.12; ctx.save(); ctx.rotate(-h[2] * 0.07 * k); ctx.fillStyle = '#ffe9b0'; ctx.fillRect(HUB, -8, L - HUB - 30, 16); ctx.restore(); }
      ctx.globalAlpha = 1;
      const wg = ctx.createLinearGradient(0, -8, 0, 8); wg.addColorStop(0, '#e2a35c'); wg.addColorStop(1, '#9a5b22');
      ctx.fillStyle = wg; ctx.strokeStyle = '#6b3d12'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(HUB, -7, L - HUB - 80, 14, 7) : ctx.rect(HUB, -7, L - HUB - 80, 14); ctx.fill(); ctx.stroke();
      // red plastic blade
      ctx.fillStyle = '#ff3b30'; ctx.strokeStyle = '#a3201a'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(L - 90, -16); ctx.lineTo(L - 10, -38); ctx.quadraticCurveTo(L + 12, 0, L - 10, 38); ctx.lineTo(L - 90, 16); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.beginPath(); ctx.moveTo(L - 80, -12); ctx.lineTo(L - 22, -28); ctx.lineTo(L - 26, -18); ctx.lineTo(L - 80, -6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(243,215,155,.9)'; ctx.beginPath(); ctx.ellipse(L - 40, 0, 16, 22, 0, 0, 6.29); ctx.fill();   // scoop of sand
    }
    ctx.restore();
    ctx.fillStyle = '#ffd23f'; ctx.strokeStyle = '#a8740a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 15, 0, 6.29); ctx.fill(); ctx.stroke();
  }
  // mega-slam star pickup
  for (const h of hzs) if (h[0] === 'p') {
    if (h[3] < 2 && Math.sin(T * 25) < 0) continue;
    const pulse = 1 + Math.sin(T * 6) * 0.12;
    const gg = ctx.createRadialGradient(h[1], h[2], 4, h[1], h[2], 50); gg.addColorStop(0, 'rgba(255,240,120,.85)'); gg.addColorStop(1, 'rgba(255,200,0,0)');
    ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(h[1], h[2], 50, 0, 6.29); ctx.fill();
    ctx.save(); ctx.translate(h[1], h[2]); ctx.rotate(Math.sin(T * 2) * 0.4); ctx.fillStyle = '#ff8a3d'; ctx.strokeStyle = '#b8461b'; ctx.lineWidth = 3; ctx.lineJoin = 'round'; drawStar(0, 0, 22 * pulse); ctx.stroke();
    ctx.fillStyle = '#ffd2a8'; for (let k = 0; k < 5; k++) { const a = k * Math.PI * 2 / 5 - Math.PI / 2; for (const d of [6, 11]) { ctx.beginPath(); ctx.arc(Math.cos(a) * d * pulse, Math.sin(a) * d * pulse, 1.8, 0, 6.29); ctx.fill(); } } ctx.restore();
  }

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
  if (!f) { ctx.fillStyle = 'rgba(110,70,20,.28)'; ctx.beginPath(); ctx.ellipse(4, R * .75, R * 1.0, R * .45, 0, 0, 6.29); ctx.fill(); }
  const sp = Math.hypot(v.vx, v.vy), ang = Math.atan2(v.vy, v.vx);
  const st = 1 + Math.min(.38, sp / 1400), wob = Math.sin(T * 10 + id) * 0.04;
  ctx.rotate(ang); ctx.scale(st * sc * (1 + wob), sc / st * (1 - wob)); ctx.rotate(-ang);
  const lx = sp > 20 ? Math.cos(ang) * 6 : 0, ly = sp > 20 ? Math.sin(ang) * 6 : 0;
  if (p.mega > 0 && !f) { ctx.save(); const gl = ctx.createRadialGradient(0, 0, R * .8, 0, 0, R * 1.9); gl.addColorStop(0, 'rgba(255,215,0,.85)'); gl.addColorStop(1, 'rgba(255,215,0,0)'); ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(0, 0, R * 1.9 + Math.sin(T * 20) * 3, 0, 6.29); ctx.fill(); ctx.restore(); }
  FlanArt.drawFlan(ctx, info.char, { color: col, R, lx, ly, fall: f, dash: p.dash, t: T + id * 0.37, vx: v.vx, vy: v.vy });
  ctx.restore();
  // name tag
  if (f < .5) {
    ctx.save(); ctx.globalAlpha = 1 - f * 2;
    const fs = 14 / camScale;
    ctx.font = `900 ${fs}px Trebuchet MS, sans-serif`; ctx.textAlign = 'center';
    const label = info.name + (id === myId ? ' (you)' : '');
    ctx.lineWidth = 4 / camScale; ctx.strokeStyle = 'rgba(27,20,70,.85)'; ctx.strokeText(label, v.x, v.y - R - 22);
    ctx.fillStyle = id === myId ? '#ffd23f' : '#fff'; ctx.fillText(label, v.x, v.y - R - 22);
    if (id === myId) {
      // dash cooldown ring
      const cdFrac = Math.max(0, Math.min(1, myDashCd / Core.C.DASH_CD));
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
