// FLAN SLAM — shared game core (rooms, physics, scoring, AI bots).
// Used by the Node server (multiplayer, authoritative) AND the browser (offline solo mode).
(function (root, factory) {
  const m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m; else root.FlanCore = m;
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';
// v2 tuning ("too easy to stay on"): icier movement, harder hits, faster shrink, hazards + power-ups.
const C = { TICK: 60, SNAP: 30, MAX_PLAYERS: 8, R: 26, ACC: 1350, FRICTION: 2.0, MAXV: 345,
  DASH_V: 760, DASH_CD: 1.5, DASH_T: 0.22, ARENA_START: 430, ARENA_MIN: 105, SHRINK_DELAY: 8, SHRINK_TIME: 40, SUDDEN_RATE: 9, COUNTDOWN: 3,
  RIM: 34, RIM_PULL: 260,             // frosting slope: outer band gently pulls you outward
  RESTITUTION: 1.0, HIT_SCALE: 0.0004, // bounce grows with impact speed
  SYRUP_FRICTION: 0.25, SYRUP_CONTROL: 0.4, WIND_F: 560, MEGA_T: 5, MEGA_MASS: 1.6,
  SPOON_W: 1.25, SPOON_HUB: 46, FIRST_EVENT: 4, FIRST_PICK: 8 };
const DT = 1 / C.TICK;
const COLORS = ['#ff4d6d', '#3ec1ff', '#ffd23f', '#7cff6b', '#c77dff', '#ff9f1c', '#2ef2c8', '#ff7ae0'];
// Selectable looks (purely cosmetic: every flan has the same size, speed and weight).
const CHARS = [
  { id: 'classic', name: 'Classic', desc: 'Caramel-topped original' },
  { id: 'king', name: 'King Wobble', desc: 'Crown, smug grin' },
  { id: 'ninja', name: 'Ninja', desc: 'Square-ish, headband' },
  { id: 'party', name: 'Party Animal', desc: 'Party hat, big grin' },
  { id: 'shades', name: 'Shades', desc: 'Too cool to fall' },
  { id: 'sprout', name: 'Sprout', desc: 'Jelly-mold, leafy & shy' },
];
const CHAR_IDS = CHARS.map(c => c.id);
const PALETTE = ['#ff4d6d', '#3ec1ff', '#ffd23f', '#7cff6b', '#c77dff', '#ff9f1c', '#2ef2c8', '#ff7ae0',
  '#ff3b30', '#4d7cff', '#b8f400', '#00d4a6', '#a66cff', '#ff6f91', '#ffe7b0', '#9aa7ff'];
function validColor(c) { return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c.toLowerCase() : null; }
function validChar(c) { return CHAR_IDS.includes(c) ? c : null; }
function rgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
function colorDist(a, b) { const x = rgb(a), y = rgb(b); return Math.hypot(x[0] - y[0], (x[1] - y[1]) * 1.3, x[2] - y[2]); }
const TOO_CLOSE = 70;
// Server-side colour assignment: keep the wanted colour unless it is (nearly) identical to someone else's,
// otherwise give the closest palette colour that is still clearly distinct.
function assignColor(room, wanted, selfId) {
  const others = [...room.players.values()].filter(p => p.id !== selfId).map(p => p.color);
  const free = c => others.every(o => colorDist(o, c) >= TOO_CLOSE);
  wanted = validColor(wanted);
  if (wanted && free(wanted)) return wanted;
  const cands = PALETTE.filter(free);
  if (!cands.length) return wanted || PALETTE[Math.floor(Math.random() * PALETTE.length)];
  if (!wanted) return cands[0];
  return cands.reduce((a, b) => colorDist(a, wanted) <= colorDist(b, wanted) ? a : b);
}
const BOT_NAMES = ['Wobbles', 'Jiggles', 'Blorp', 'Squish', 'Gloop', 'Pudding', 'Mochi', 'Custard', 'Boing', 'Gummy', 'Splodge', 'Caramel', 'Wibble', 'Panna'];
const BOT_MARK = '🤖 ';
// Difficulty: react = seconds between decisions, aim = aim noise (px), aggro = dash eagerness,
// margin = how far from the edge it tries to stay, dodge = chance to dodge an incoming dash,
// speed = input strength, look = edge look-ahead seconds, safeDash = checks that a dash won't fling it off.
const DIFF = {
  easy:   { react: 0.42, aim: 50, aggro: 0.35, margin: 40, dodge: 0.15, speed: 0.72, look: 0.22, safeDash: 0.5, aware: 0.45 },
  normal: { react: 0.2,  aim: 18, aggro: 0.7,  margin: 60, dodge: 0.55, speed: 0.95, look: 0.32, safeDash: 0.9, aware: 0.8 },
  hard:   { react: 0.07, aim: 4,  aggro: 0.4,  margin: 55, dodge: 0.9,  speed: 1.0,  look: 0.3, safeDash: 1.0, aware: 0.97 },
};
let nextId = 1;

function cleanName(n) { n = String(n || '').replace(/[^\p{L}\p{N} _\-!?.'♥★]/gu, '').trim().slice(0, 14); return n || 'Flan' + Math.floor(Math.random() * 100); }

function createRoom(code, io) {
  return { code, io, players: new Map(), hostId: null, state: 'lobby', round: 0, t: 0, arenaR: C.ARENA_START, timer: 0, winner: null, events: [], startCount: 0, hz: [], nextEv: 99, nextPick: 99 };
}
function humans(room) { return [...room.players.values()].filter(p => !p.bot); }
function bcast(room, msg) { for (const p of room.players.values()) if (!p.bot) room.io.send(p, msg); }
function pickColor(room) { return assignColor(room, null, -1); }

function roomInfo(room) {
  return { t: 'room', code: room.code, host: room.hostId, state: room.state, round: room.round,
    players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, color: p.color, char: p.char, score: p.score, wins: p.wins, kos: p.kos, playing: p.inRound, bot: !!p.bot, diff: p.diff || null })) };
}
function sync(room) { bcast(room, roomInfo(room)); }

function newPlayer(room, name, extra) {
  const p = Object.assign({ id: nextId++, name, color: pickColor(room), char: 'classic', score: 0, wins: 0, kos: 0,
    x: 0, y: 0, vx: 0, vy: 0, ix: 0, iy: 0, alive: false, inRound: false, dashCd: 0, dashT: 0, wantDash: false,
    lastHit: null, lastHitT: 0, bot: false }, extra || {});
  room.players.set(p.id, p);
  return p;
}
// returns player or an error string
function join(room, name, conn, look) {
  if (room.players.size >= C.MAX_PLAYERS) {
    // a human may bump a bot out of a full room
    const bot = [...room.players.values()].reverse().find(p => p.bot && !(p.inRound && p.alive && room.state === 'playing')) || [...room.players.values()].reverse().find(p => p.bot);
    if (!bot) return 'Room is full (8 max)';
    removeBot(room, bot.id, true);
  }
  const p = newPlayer(room, cleanName(name), { conn });
  look = look || {};
  p.char = validChar(look.char) || 'classic';
  p.color = assignColor(room, look.color, p.id);
  if (!room.hostId || !room.players.has(room.hostId)) room.hostId = p.id;
  sync(room);
  bcast(room, { t: 'chat', msg: `${p.name} joined` + (room.state === 'lobby' || room.state === 'over' ? '' : ' (plays next round)') });
  return p;
}
function addBot(room, diff) {
  if (room.players.size >= C.MAX_PLAYERS) return null;
  diff = DIFF[diff] ? diff : 'normal';
  const used = new Set([...room.players.values()].map(p => p.name));
  const pool = BOT_NAMES.filter(n => !used.has(BOT_MARK + n));
  const nm = BOT_MARK + (pool.length ? pool[Math.floor(Math.random() * pool.length)] : 'Bot' + nextId);
  const b = newPlayer(room, nm, { bot: true, diff, thinkT: 0, wander: null, char: pickBotChar(room) });
  const free = PALETTE.filter(c => [...room.players.values()].every(o => o === b || colorDist(o.color, c) >= TOO_CLOSE));
  if (free.length) b.color = free[Math.floor(Math.random() * free.length)];
  return b;
}
function pickBotChar(room) { // random, but prefer characters nobody is using yet
  const cnt = {}; for (const id of CHAR_IDS) cnt[id] = 0; for (const p of room.players.values()) if (cnt[p.char] != null) cnt[p.char]++;
  const min = Math.min(...Object.values(cnt)), pool = CHAR_IDS.filter(id => cnt[id] === min);
  return pool[Math.floor(Math.random() * pool.length)];
}
function removeBot(room, id, quiet) {
  const b = room.players.get(id);
  if (!b || !b.bot) return false;
  room.players.delete(id);
  if (!quiet) sync(room);
  return true;
}
// returns true if the room is now empty of humans (caller should dispose it)
function leave(room, p) {
  room.players.delete(p.id);
  if (!humans(room).length) return true;
  if (room.hostId === p.id) room.hostId = humans(room)[0].id;
  bcast(room, { t: 'chat', msg: `${p.name} left` });
  sync(room);
  return false;
}

function handle(room, p, m) {
  const isHost = p.id === room.hostId, between = room.state === 'lobby' || room.state === 'over';
  if (m.t === 'input') {
    let x = +m.x || 0, y = +m.y || 0; const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    p.ix = x; p.iy = y;
    if (m.d) p.wantDash = true;
  } else if (m.t === 'start') {
    if (isHost && between) startRound(room);
  } else if (m.t === 'reset') {
    if (isHost && room.state !== 'playing') { for (const q of room.players.values()) { q.score = 0; q.wins = 0; q.kos = 0; } room.round = 0; sync(room); }
  } else if (m.t === 'look') {
    // change character/colour between rounds (validated; colour kept distinct from others)
    if (!between) return;
    if (validChar(m.char)) p.char = m.char;
    if (m.color) p.color = assignColor(room, m.color, p.id);
    sync(room);
  } else if (m.t === 'addbot') {
    if (!isHost) return;
    const n = Math.max(1, Math.min(7, +m.n || 1));
    let added = 0; for (let i = 0; i < n; i++) if (addBot(room, m.diff)) added++;
    if (added) { sync(room); bcast(room, { t: 'chat', msg: `${added} ${m.diff || 'normal'} bot${added > 1 ? 's' : ''} joined` + (between ? '' : ' (next round)') }); }
    else room.io.send(p, { t: 'error', msg: 'Room is full (8 max)' });
  } else if (m.t === 'removebot') {
    if (!isHost) return;
    const id = m.id || [...room.players.values()].reverse().find(q => q.bot)?.id;
    if (id) removeBot(room, id);
  }
}

function startRound(room) {
  const ps = [...room.players.values()];
  if (!ps.length) return;
  room.round++; room.state = 'countdown'; room.timer = C.COUNTDOWN; room.t = 0; room.arenaR = C.ARENA_START; room.winner = null; room.events = [];
  room.hz = []; room.nextEv = C.FIRST_EVENT; room.nextPick = C.FIRST_PICK + Math.random() * 3; room.lastEv = null;
  const n = ps.length, off = Math.random() * Math.PI * 2;
  // shuffle spawn order
  for (let i = ps.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ps[i], ps[j]] = [ps[j], ps[i]]; }
  ps.forEach((p, i) => {
    const a = off + (i / n) * Math.PI * 2, d = n === 1 ? 0 : C.ARENA_START * 0.55;
    Object.assign(p, { x: Math.cos(a) * d, y: Math.sin(a) * d, vx: 0, vy: 0, ix: 0, iy: 0, alive: true, inRound: true, dashCd: 0, dashT: 0, wantDash: false, lastHit: null, thinkT: Math.random() * 0.3, wander: null, mega: 0, hazT: 0, spoonT: 0, aware: true });
  });
  room.startCount = n;
  sync(room);
}
function endRound(room, winner) {
  room.state = 'over';
  room.winner = winner ? winner.id : null;
  if (winner) { winner.score += 3; winner.wins++; }
  bcast(room, { t: 'over', winner: winner ? winner.id : null, name: winner ? winner.name : null, color: winner ? winner.color : null });
  sync(room);
}

// ---------- arena geometry & hazards ----------
function angDiff(a, b) { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }
// edge radius of the cake at angle a (crumbled "bites" make it smaller). includeWarn: treat warned bites as gone (AI caution)
function rimAt(room, a, includeWarn) {
  let r = room.arenaR;
  for (const h of room.hz) {
    if (h.k !== 'crumble' || (h.warn > 0 && !includeWarn)) continue;
    if (Math.abs(angDiff(a, h.a)) < h.w) r = Math.min(r, Math.max(room.arenaR * 0.5, room.arenaR - h.depth));
  }
  return r;
}
function inSyrup(room, x, y) { for (const h of room.hz) if (h.k === 'syrup' && h.grow >= 1 && Math.hypot(x - h.x, y - h.y) < h.r) return true; return false; }
function windVec(room) { for (const h of room.hz) if (h.k === 'wind' && h.warn <= 0) return [Math.cos(h.a) * C.WIND_F, Math.sin(h.a) * C.WIND_F]; return [0, 0]; }
function randInCake(room, frac) { const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * room.arenaR * frac; return [Math.cos(a) * r, Math.sin(a) * r]; }
function spawnEvent(room) {
  const has = k => room.hz.some(h => h.k === k);
  const bag = [];
  if (room.hz.filter(h => h.k === 'crumble').length < 6) bag.push('crumble', 'crumble');
  if (!has('spoon')) bag.push('spoon', 'spoon');
  if (room.hz.filter(h => h.k === 'syrup').length < 2) bag.push('syrup');
  if (!has('wind')) bag.push('wind', 'wind');
  if (!bag.length) return;
  let k = bag[Math.floor(Math.random() * bag.length)];
  if (k === room.lastEv && bag.some(x => x !== k)) k = bag.filter(x => x !== k)[Math.floor(Math.random() * bag.filter(x => x !== k).length)];
  room.lastEv = k;
  if (k === 'crumble') room.hz.push({ k, a: Math.random() * Math.PI * 2, w: 0.42 + Math.random() * 0.2, depth: 80 + Math.random() * 40, warn: 1.6 });
  else if (k === 'spoon') { const dir = Math.random() < .5 ? 1 : -1; room.hz.push({ k, ang: Math.random() * Math.PI * 2, dir, warn: 1.5, life: 3.6 }); }
  else if (k === 'syrup') { const [x, y] = randInCake(room, 0.75); room.hz.push({ k, x, y, r: 65 + Math.random() * 25, grow: 0, life: 9 }); }
  else if (k === 'wind') room.hz.push({ k, a: Math.random() * Math.PI * 2, warn: 1.4, life: 2.2 });
  room.events.push(['hz', k]);
}
function updateHazards(room, alive) {
  if (room.t >= room.nextEv) { spawnEvent(room); room.nextEv = room.t + 4 + Math.random() * 2.5; }
  if (room.t >= room.nextPick && !room.hz.some(h => h.k === 'star')) {
    const [x, y] = randInCake(room, 0.6); room.hz.push({ k: 'star', x, y, life: 7 }); room.nextPick = room.t + 11 + Math.random() * 4; room.events.push(['hz', 'star']);
  }
  for (let i = room.hz.length - 1; i >= 0; i--) {
    const h = room.hz[i];
    if (h.warn > 0) { h.warn -= DT; if (h.warn <= 0 && h.k === 'crumble') room.events.push(['crumbled', h.a]); continue; }
    if (h.k === 'crumble') continue;                      // permanent for the round
    if (h.k === 'syrup') h.grow = Math.min(1, h.grow + DT / 0.7);
    if (h.k === 'spoon') {
      h.ang += h.dir * C.SPOON_W * DT;
      const ux = Math.cos(h.ang), uy = Math.sin(h.ang), nx = -uy * h.dir, ny = ux * h.dir; // n = sweep direction
      for (const p of alive) {
        const along = p.x * ux + p.y * uy, perp = p.x * nx + p.y * ny;
        if (along < C.SPOON_HUB || along > room.arenaR + 40) continue;
        if (perp > -C.R - 6 && perp < C.R + 10) {
          p.x += nx * (C.R + 10 - perp); p.y += ny * (C.R + 10 - perp);   // shove in front of the spoon
          const tip = C.SPOON_W * along, vn = p.vx * nx + p.vy * ny, want = tip * 1.0 + 130;
          if (vn < want) { p.vx += nx * (want - vn); p.vy += ny * (want - vn); }
          p.vx += ux * 90 * DT * 60 * 0.05; p.vy += uy * 90 * DT * 60 * 0.05;
          if (!p.spoonT || room.t - p.spoonT > 0.4) room.events.push(['spoonhit', p.x, p.y]);
          p.spoonT = room.t; p.hazT = room.t;
        }
      }
    }
    if (h.k === 'wind') for (const p of alive) p.hazT = room.t;
    if (h.k === 'star') for (const p of alive) if (Math.hypot(p.x - h.x, p.y - h.y) < C.R + 20) {
      p.mega = C.MEGA_T; p.dashCd = 0; room.events.push(['mega', p.id]); h.life = 0; break;
    }
    h.life -= DT;
    if (h.life <= 0) room.hz.splice(i, 1);
  }
}

// ---------- AI ----------
function botThink(room, b, alive) {
  const D = DIFF[b.diff] || DIFF.normal;
  const R = C.R;
  b.thinkT -= DT;
  if (b.thinkT <= 0) {
    b.thinkT = D.react * (0.7 + Math.random() * 0.6);
    b.aware = Math.random() < D.aware;   // does it notice hazards this decision?
    decide(room, b, alive, D);
  }
  // edge safety (every tick): predict own position (velocity + wind + rim slope), compare to the rim at that angle
  const [wx, wy] = b.aware ? windVec(room) : [0, 0];
  const L = D.look * (inSyrup(room, b.x, b.y) ? 1.8 : 1);
  const px = b.x + b.vx * L + wx * L * L * 0.5, py = b.y + b.vy * L + wy * L * L * 0.5, pd = Math.hypot(px, py);
  const rim = rimAt(room, Math.atan2(py, px), b.aware) ;
  const marginK = Math.min(1, room.arenaR / 300);
  const safe = rim - R - D.margin * marginK - C.RIM * 0.5;
  if (pd > safe && pd > 1) {
    const w = Math.min(1, (pd - safe) / 30);
    let ix = b.ix * (1 - w) - (px / pd) * w, iy = b.iy * (1 - w) - (py / pd) * w;
    const l = Math.hypot(ix, iy) || 1; b.ix = ix / l; b.iy = iy / l;
    if (pd > rim - R * 0.4 && Math.random() < D.safeDash) {
      if (b.dashCd <= 0 && D.safeDash >= 0.9 && Math.hypot(b.vx, b.vy) > 150) { b.ix = -px / pd; b.iy = -py / pd; b.wantDash = true; }
      else if (b.wantDash) b.wantDash = false;
    }
  }
}
function decide(room, b, alive, D) {
  const R = C.R, ar = room.arenaR;
  b.wantDash = false;
  const others = alive.filter(o => o !== b);
  // 0) spoon coming? get to the hub (it can't reach the middle) or out of its path
  if (b.aware) for (const h of room.hz) if (h.k === 'spoon') {
    const ba = Math.atan2(b.y, b.x), ahead = angDiff(ba, h.ang) * h.dir;   // >0: spoon is heading toward us
    const eta = (h.warn > 0 ? h.warn : 0) + (ahead > 0 ? ahead / C.SPOON_W : 99);
    const bd0 = Math.hypot(b.x, b.y);
    if (eta < 0.9 && bd0 > C.SPOON_HUB - 10) {
      b.ix = -b.x / bd0; b.iy = -b.y / bd0;
      if (eta < 0.45 && b.dashCd <= 0 && bd0 > 120 && Math.random() < D.dodge) b.wantDash = true;
      return;
    }
  }
  // 1) dodge incoming dashes / fast bodies
  for (const o of others) {
    const ovs = Math.hypot(o.vx, o.vy);
    if (!(o.dashT > 0 || ovs > 420)) continue;
    const rx = b.x - o.x, ry = b.y - o.y, vx = o.vx - b.vx, vy = o.vy - b.vy, vv = vx * vx + vy * vy;
    if (vv < 1) continue;
    const t = Math.max(0, Math.min(0.5, (rx * vx + ry * vy) / vv));
    const cx = rx - vx * t, cy = ry - vy * t;
    if (Math.hypot(cx, cy) < R * 2 + 14 && (rx * vx + ry * vy) > 0 && Math.random() < D.dodge) {
      let nx = -o.vy / ovs, ny = o.vx / ovs;
      if (nx * -b.x + ny * -b.y < 0) { nx = -nx; ny = -ny; }
      b.ix = nx * D.speed; b.iy = ny * D.speed;
      if (b.dashCd <= 0 && D.dodge > 0.8 && t < 0.25 && Math.hypot(b.x + nx * 160, b.y + ny * 160) < rimAt(room, Math.atan2(b.y + ny * 160, b.x + nx * 160), true) - R) b.wantDash = true;
      return;
    }
  }
  // 2) grab a nearby mega-slam star if it's safe and closer than the fight
  if (b.aware) for (const h of room.hz) if (h.k === 'star') {
    const d = Math.hypot(h.x - b.x, h.y - b.y);
    if (d < 200) { b.ix = (h.x - b.x) / d * D.speed; b.iy = (h.y - b.y) / d * D.speed; return; }
  }
  // 3) pick a target: close + near the edge = juicy
  let best = null, bs = Infinity;
  for (const o of others) {
    const d = Math.hypot(o.x - b.x, o.y - b.y), edge = rimAt(room, Math.atan2(o.y, o.x)) - Math.hypot(o.x, o.y);
    const s = d + edge * 0.8 + Math.random() * 30 - (o.id === b.target ? 60 : 0) + (o.mega > 0 ? 120 : 0);
    if (s < bs) { bs = s; best = o; }
  }
  const bd = Math.hypot(b.x, b.y);
  b.target = best ? best.id : null;
  if (!best) { if (bd > 30) { b.ix = -b.x / bd * 0.6; b.iy = -b.y / bd * 0.6; } else { b.ix = 0; b.iy = 0; } return; }
  const lead = 0.15 + Math.random() * 0.1;
  let tx = best.x + best.vx * lead + (Math.random() - 0.5) * D.aim * 2, ty = best.y + best.vy * lead + (Math.random() - 0.5) * D.aim * 2;
  const td = Math.hypot(tx, ty) || 1, ox = tx / td, oy = ty / td;
  const inside = (tx - b.x) * ox + (ty - b.y) * oy > 0;
  let ax = tx, ay = ty;
  if (!inside) { ax = tx - ox * R * 2.6; ay = ty - oy * R * 2.6; }
  const ad = Math.hypot(ax, ay), lim = Math.max(10, rimAt(room, Math.atan2(ay, ax), b.aware) - R - D.margin * 0.6 - C.RIM * 0.5);
  if (ad > lim) { ax = ax / ad * lim; ay = ay / ad * lim; }
  // avoid walking into syrup
  if (b.aware) for (const h of room.hz) if (h.k === 'syrup' && Math.hypot(ax - h.x, ay - h.y) < h.r + R) { const hd = Math.hypot(ax - h.x, ay - h.y) || 1; ax = h.x + (ax - h.x) / hd * (h.r + R + 10); ay = h.y + (ay - h.y) / hd * (h.r + R + 10); }
  let dx = ax - b.x, dy = ay - b.y, dl = Math.hypot(dx, dy) || 1;
  const sp = D.speed * Math.min(1, dl / 40 + 0.3);
  b.ix = dx / dl * sp; b.iy = dy / dl * sp;
  const ddx = tx - b.x, ddy = ty - b.y, dd = Math.hypot(ddx, ddy) || 1;
  const range = 120 + D.aggro * 70 + (b.mega > 0 ? 60 : 0);
  const pDash = 1 - Math.pow(1 - (0.35 + D.aggro * 0.5 + (b.mega > 0 ? 0.3 : 0)), D.react / 0.2);
  if (b.dashCd <= 0 && dd < range && inside && Math.random() < pDash) {
    const ux = ddx / dd, uy = ddy / dd, travel = Math.min(150, dd + 30);
    const lx = b.x + ux * travel, ly = b.y + uy * travel;
    if (Math.hypot(lx, ly) < rimAt(room, Math.atan2(ly, lx), true) - R * 0.8 || Math.random() > D.safeDash) { b.ix = ux; b.iy = uy; b.wantDash = true; }
  }
}

// ---------- simulation ----------
function step(room) {
  if (room.state === 'countdown') {
    room.timer -= DT;
    if (room.timer <= 0) { room.state = 'playing'; room.t = 0; sync(room); }
    return;
  }
  if (room.state !== 'playing') return;
  room.t += DT;
  const k = Math.min(1, Math.max(0, (room.t - C.SHRINK_DELAY) / C.SHRINK_TIME));
  room.arenaR = C.ARENA_START - (C.ARENA_START - C.ARENA_MIN) * (k * (2 - k));
  const over = room.t - C.SHRINK_DELAY - C.SHRINK_TIME;
  if (over > 0) room.arenaR = Math.max(C.R * 0.6, C.ARENA_MIN - over * C.SUDDEN_RATE);
  const alive = [...room.players.values()].filter(p => p.alive);
  updateHazards(room, alive);
  for (const p of alive) if (p.bot) botThink(room, p, alive);
  const [wx, wy] = windVec(room);
  for (const p of alive) {
    p.dashCd = Math.max(0, p.dashCd - DT);
    p.dashT = Math.max(0, p.dashT - DT);
    if (p.mega > 0) p.mega = Math.max(0, p.mega - DT);
    if (p.wantDash && p.dashCd <= 0) {
      let dx = p.ix, dy = p.iy, m = Math.hypot(dx, dy);
      if (m < 0.1) { dx = p.vx; dy = p.vy; m = Math.hypot(dx, dy); }
      if (m > 0.01) { p.vx = dx / m * C.DASH_V; p.vy = dy / m * C.DASH_V; p.dashCd = p.mega > 0 ? C.DASH_CD * 0.5 : C.DASH_CD; p.dashT = C.DASH_T; room.events.push(['dash', p.id]); }
    }
    p.wantDash = false;
    const syr = inSyrup(room, p.x, p.y);
    const acc = C.ACC * (syr ? C.SYRUP_CONTROL : 1);
    p.vx += p.ix * acc * DT + wx * DT; p.vy += p.iy * acc * DT + wy * DT;
    // frosting slope near the rim
    const d = Math.hypot(p.x, p.y), rim = rimAt(room, Math.atan2(p.y, p.x));
    if (d > rim - C.RIM && d > 1) { const s = (d - (rim - C.RIM)) / C.RIM; p.vx += p.x / d * C.RIM_PULL * s * DT; p.vy += p.y / d * C.RIM_PULL * s * DT; }
    const f = Math.exp(-(syr ? C.SYRUP_FRICTION : C.FRICTION) * DT); p.vx *= f; p.vy *= f;
    const sp = Math.hypot(p.vx, p.vy), cap = p.dashT > 0 ? C.DASH_V : C.MAXV;
    if (sp > cap) { const s2 = cap + (sp - cap) * 0.93; p.vx = p.vx / sp * s2; p.vy = p.vy / sp * s2; }
    p.x += p.vx * DT; p.y += p.vy * DT;
  }
  for (let i = 0; i < alive.length; i++) for (let j = i + 1; j < alive.length; j++) {
    const a = alive[i], b = alive[j];
    let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
    if (d === 0) { a.x -= 1; continue; }
    if (d >= C.R * 2) continue;
    const nx = dx / d, ny = dy / d, overlap = C.R * 2 - d;
    const ma = (a.dashT > 0 ? 2.2 : 1) * (a.mega > 0 ? C.MEGA_MASS : 1), mb = (b.dashT > 0 ? 2.2 : 1) * (b.mega > 0 ? C.MEGA_MASS : 1);
    a.x -= nx * overlap * (mb / (ma + mb)); a.y -= ny * overlap * (mb / (ma + mb));
    b.x += nx * overlap * (ma / (ma + mb)); b.y += ny * overlap * (ma / (ma + mb));
    const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (rv < 0) {
      const e = C.RESTITUTION + Math.min(0.9, -rv * C.HIT_SCALE);     // harder hits bounce harder
      const jimp = -(1 + e) * rv / (1 / ma + 1 / mb);
      a.vx -= jimp * nx / ma; a.vy -= jimp * ny / ma; b.vx += jimp * nx / mb; b.vy += jimp * ny / mb;
      a.lastHit = b.id; a.lastHitT = room.t; b.lastHit = a.id; b.lastHitT = room.t;
      if (-rv > 120) room.events.push(['bonk', (a.x + b.x) / 2, (a.y + b.y) / 2, Math.min(1, -rv / 700), (a.mega > 0 || b.mega > 0) ? 1 : 0]);
    }
  }
  for (const p of alive) {
    const d = Math.hypot(p.x, p.y);
    if (d > rimAt(room, Math.atan2(p.y, p.x)) + C.R * 0.3) {
      p.alive = false; p.mega = 0;
      let by = null;
      if (p.lastHit && room.t - p.lastHitT < 3) { const k2 = room.players.get(p.lastHit); if (k2 && k2 !== p) { k2.score += 1; k2.kos++; by = k2.id; } }
      const cause = by ? 'ko' : (p.hazT && room.t - p.hazT < 2.5) ? 'hazard' : 'self';
      room.events.push(['fall', p.id, by, cause]);
      if (room.onFall) room.onFall(p, by, cause);
    }
  }
  const still = [...room.players.values()].filter(p => p.alive);
  if (room.startCount >= 2 && still.length <= 1) endRound(room, still[0] || null);
  else if (room.startCount < 2 && still.length === 0) endRound(room, null);
  else if (!still.length) endRound(room, null);
}
function hzSnap(room) {
  const r1 = x => Math.round(x * 10) / 10, r3 = x => Math.round(x * 1000) / 1000;
  return room.hz.map(h => h.k === 'crumble' ? ['c', r3(h.a), r3(h.w), Math.round(h.depth), r1(Math.max(0, h.warn))]
    : h.k === 'spoon' ? ['s', r3(h.ang), h.dir, r1(Math.max(0, h.warn)), r1(h.life)]
    : h.k === 'syrup' ? ['y', Math.round(h.x), Math.round(h.y), Math.round(h.r), r1(h.grow), r1(h.life)]
    : h.k === 'wind' ? ['w', r3(h.a), r1(Math.max(0, h.warn)), r1(h.life)]
    : ['p', Math.round(h.x), Math.round(h.y), r1(h.life)]);
}
function snapshot(room) {
  if (room.state !== 'playing' && room.state !== 'countdown' && !room.events.length) return;
  const ps = [];
  for (const p of room.players.values()) if (p.inRound) ps.push([p.id, Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, Math.round(p.vx), Math.round(p.vy), p.alive ? 1 : 0, p.dashT > 0 ? 1 : 0, Math.round(p.dashCd * 100) / 100, p.mega > 0 ? Math.round(p.mega * 10) / 10 : 0]);
  bcast(room, { t: 's', ts: Date.now(), st: room.state, cd: Math.max(0, room.timer), ar: Math.round(room.arenaR * 10) / 10, rt: Math.round(room.t * 10) / 10, p: ps, hz: hzSnap(room), ev: room.events });
  room.events = [];
}

return { rimAt, angDiff, C, DT, DIFF, COLORS, CHARS, CHAR_IDS, PALETTE, validColor, validChar, assignColor, colorDist, cleanName, createRoom, join, leave, handle, addBot, removeBot, startRound, step, snapshot, roomInfo, sync, humans };
});
