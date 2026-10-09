// FLAN SLAM — shared game core (rooms, physics, scoring, AI bots).
// Used by the Node server (multiplayer, authoritative) AND the browser (offline solo mode).
(function (root, factory) {
  const m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m; else root.FlanCore = m;
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';
const C = { TICK: 60, SNAP: 30, MAX_PLAYERS: 8, R: 26, ACC: 1500, FRICTION: 2.4, MAXV: 330,
  DASH_V: 720, DASH_CD: 1.6, DASH_T: 0.22, ARENA_START: 430, ARENA_MIN: 120, SHRINK_DELAY: 5, SHRINK_TIME: 40, SUDDEN_RATE: 5, COUNTDOWN: 3 };
const DT = 1 / C.TICK;
const COLORS = ['#ff4d6d', '#3ec1ff', '#ffd23f', '#7cff6b', '#c77dff', '#ff9f1c', '#2ef2c8', '#ff7ae0'];
const BOT_NAMES = ['Wobbles', 'Jiggles', 'Blorp', 'Squish', 'Gloop', 'Pudding', 'Mochi', 'Custard', 'Boing', 'Gummy', 'Splodge', 'Caramel', 'Wibble', 'Panna'];
const BOT_MARK = '🤖 ';
// Difficulty: react = seconds between decisions, aim = aim noise (px), aggro = dash eagerness,
// margin = how far from the edge it tries to stay, dodge = chance to dodge an incoming dash,
// speed = input strength, look = edge look-ahead seconds, safeDash = checks that a dash won't fling it off.
const DIFF = {
  easy:   { react: 0.42, aim: 50, aggro: 0.35, margin: 40, dodge: 0.15, speed: 0.72, look: 0.22, safeDash: 0.5 },
  normal: { react: 0.2,  aim: 18, aggro: 0.7,  margin: 60, dodge: 0.55, speed: 0.95, look: 0.32, safeDash: 0.9 },
  hard:   { react: 0.07, aim: 4,  aggro: 0.4,  margin: 55, dodge: 0.9,  speed: 1.0,  look: 0.3, safeDash: 1.0 },
};
let nextId = 1;

function cleanName(n) { n = String(n || '').replace(/[^\p{L}\p{N} _\-!?.'♥★]/gu, '').trim().slice(0, 14); return n || 'Flan' + Math.floor(Math.random() * 100); }

function createRoom(code, io) {
  return { code, io, players: new Map(), hostId: null, state: 'lobby', round: 0, t: 0, arenaR: C.ARENA_START, timer: 0, winner: null, events: [], startCount: 0 };
}
function humans(room) { return [...room.players.values()].filter(p => !p.bot); }
function bcast(room, msg) { for (const p of room.players.values()) if (!p.bot) room.io.send(p, msg); }
function pickColor(room) { const used = new Set([...room.players.values()].map(p => p.color)); return COLORS.find(c => !used.has(c)) || COLORS[Math.floor(Math.random() * 8)]; }

function roomInfo(room) {
  return { t: 'room', code: room.code, host: room.hostId, state: room.state, round: room.round,
    players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, color: p.color, score: p.score, wins: p.wins, kos: p.kos, playing: p.inRound, bot: !!p.bot, diff: p.diff || null })) };
}
function sync(room) { bcast(room, roomInfo(room)); }

function newPlayer(room, name, extra) {
  const p = Object.assign({ id: nextId++, name, color: pickColor(room), score: 0, wins: 0, kos: 0,
    x: 0, y: 0, vx: 0, vy: 0, ix: 0, iy: 0, alive: false, inRound: false, dashCd: 0, dashT: 0, wantDash: false,
    lastHit: null, lastHitT: 0, bot: false }, extra || {});
  room.players.set(p.id, p);
  return p;
}
// returns player or an error string
function join(room, name, conn) {
  if (room.players.size >= C.MAX_PLAYERS) {
    // a human may bump a bot out of a full room
    const bot = [...room.players.values()].reverse().find(p => p.bot && !(p.inRound && p.alive && room.state === 'playing')) || [...room.players.values()].reverse().find(p => p.bot);
    if (!bot) return 'Room is full (8 max)';
    removeBot(room, bot.id, true);
  }
  const p = newPlayer(room, cleanName(name), { conn });
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
  const b = newPlayer(room, nm, { bot: true, diff, thinkT: 0, wander: null });
  return b;
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
  const n = ps.length, off = Math.random() * Math.PI * 2;
  // shuffle spawn order
  for (let i = ps.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ps[i], ps[j]] = [ps[j], ps[i]]; }
  ps.forEach((p, i) => {
    const a = off + (i / n) * Math.PI * 2, d = n === 1 ? 0 : C.ARENA_START * 0.55;
    Object.assign(p, { x: Math.cos(a) * d, y: Math.sin(a) * d, vx: 0, vy: 0, ix: 0, iy: 0, alive: true, inRound: true, dashCd: 0, dashT: 0, wantDash: false, lastHit: null, thinkT: Math.random() * 0.3, wander: null });
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

// ---------- AI ----------
function botThink(room, b, alive) {
  const D = DIFF[b.diff] || DIFF.normal;
  const R = C.R, ar = room.arenaR;
  b.thinkT -= DT;
  if (b.thinkT <= 0) {
    b.thinkT = D.react * (0.7 + Math.random() * 0.6);
    decide(room, b, alive, D);
  }
  // edge safety (every tick): look ahead along current velocity; steer back toward the middle
  const marginK = Math.min(1, ar / 320);
  const px = b.x + b.vx * D.look, py = b.y + b.vy * D.look, pd = Math.hypot(px, py);
  const safe = ar - R - D.margin * marginK;
  if (pd > safe && pd > 1) {
    const w = Math.min(1, (pd - safe) / 35);
    let ix = b.ix * (1 - w) - (px / pd) * w, iy = b.iy * (1 - w) - (py / pd) * w;
    const l = Math.hypot(ix, iy) || 1; b.ix = ix / l; b.iy = iy / l;
    if (pd > ar - R * 0.6 && Math.random() < D.safeDash) {
      // emergency: if a dash toward the centre is available, use it (better players save themselves)
      if (b.dashCd <= 0 && D.safeDash >= 0.9 && Math.hypot(b.vx, b.vy) > 150) { b.ix = -px / pd; b.iy = -py / pd; b.wantDash = true; }
      else if (b.wantDash) b.wantDash = false;
    }
  }
}
function decide(room, b, alive, D) {
  const R = C.R, ar = room.arenaR;
  b.wantDash = false;
  const others = alive.filter(o => o !== b);
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
      if (nx * -b.x + ny * -b.y < 0) { nx = -nx; ny = -ny; }   // choose side toward the centre
      b.ix = nx * D.speed; b.iy = ny * D.speed;
      if (b.dashCd <= 0 && D.dodge > 0.8 && t < 0.25 && Math.hypot(b.x + nx * 160, b.y + ny * 160) < ar - R) b.wantDash = true;
      return;
    }
  }
  // 2) pick a target: close + near the edge = juicy
  let best = null, bs = Infinity;
  for (const o of others) {
    const d = Math.hypot(o.x - b.x, o.y - b.y), edge = ar - Math.hypot(o.x, o.y);
    const s = d + edge * 0.8 + Math.random() * 30 - (o.id === b.target ? 60 : 0);
    if (s < bs) { bs = s; best = o; }
  }
  const bd = Math.hypot(b.x, b.y);
  b.target = best ? best.id : null;
  if (!best) { // nobody left: hang near the middle
    if (bd > 30) { b.ix = -b.x / bd * 0.6; b.iy = -b.y / bd * 0.6; } else { b.ix = 0; b.iy = 0; }
    return;
  }
  // predicted target position
  const lead = 0.15 + Math.random() * 0.1;
  let tx = best.x + best.vx * lead + (Math.random() - 0.5) * D.aim * 2, ty = best.y + best.vy * lead + (Math.random() - 0.5) * D.aim * 2;
  const td = Math.hypot(tx, ty) || 1, ox = tx / td, oy = ty / td;  // outward direction at target
  // are we "inside" the target (between it and the centre)? if not, circle to get behind it
  const inside = (tx - b.x) * ox + (ty - b.y) * oy > 0;
  let ax = tx, ay = ty;
  if (!inside) { ax = tx - ox * R * 2.6; ay = ty - oy * R * 2.6; }
  // never aim at a point beyond the safe ring
  const ad = Math.hypot(ax, ay), lim = Math.max(10, ar - R - D.margin * 0.6);
  if (ad > lim) { ax = ax / ad * lim; ay = ay / ad * lim; }
  let dx = ax - b.x, dy = ay - b.y, dl = Math.hypot(dx, dy) || 1;
  const sp = D.speed * Math.min(1, dl / 40 + 0.3);
  b.ix = dx / dl * sp; b.iy = dy / dl * sp;
  // 3) dash into the target when lined up
  const ddx = tx - b.x, ddy = ty - b.y, dd = Math.hypot(ddx, ddy) || 1;
  const range = 120 + D.aggro * 70;
  // per-second dash eagerness, independent of how often this bot thinks
  const pDash = 1 - Math.pow(1 - (0.35 + D.aggro * 0.5), D.react / 0.2);
  if (b.dashCd <= 0 && dd < range && inside && Math.random() < pDash) {
    const ux = ddx / dd, uy = ddy / dd, travel = Math.min(170, dd + 30);
    const landing = Math.hypot(b.x + ux * travel, b.y + uy * travel);
    if (landing < ar - R * 0.8 || Math.random() > D.safeDash) { b.ix = ux; b.iy = uy; b.wantDash = true; }
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
  // sudden death: after the main shrink the cake keeps crumbling slowly until somebody falls
  const over = room.t - C.SHRINK_DELAY - C.SHRINK_TIME;
  if (over > 0) room.arenaR = Math.max(C.R * 0.6, C.ARENA_MIN - over * C.SUDDEN_RATE);
  const alive = [...room.players.values()].filter(p => p.alive);
  for (const p of alive) if (p.bot) botThink(room, p, alive);
  for (const p of alive) {
    p.dashCd = Math.max(0, p.dashCd - DT);
    p.dashT = Math.max(0, p.dashT - DT);
    if (p.wantDash && p.dashCd <= 0) {
      let dx = p.ix, dy = p.iy, m = Math.hypot(dx, dy);
      if (m < 0.1) { dx = p.vx; dy = p.vy; m = Math.hypot(dx, dy); }
      if (m > 0.01) { p.vx = dx / m * C.DASH_V; p.vy = dy / m * C.DASH_V; p.dashCd = C.DASH_CD; p.dashT = C.DASH_T; room.events.push(['dash', p.id]); }
    }
    p.wantDash = false;
    p.vx += p.ix * C.ACC * DT; p.vy += p.iy * C.ACC * DT;
    const f = Math.exp(-C.FRICTION * DT); p.vx *= f; p.vy *= f;
    const sp = Math.hypot(p.vx, p.vy), cap = p.dashT > 0 ? C.DASH_V : C.MAXV;
    if (sp > cap) { const s = cap + (sp - cap) * 0.9; p.vx = p.vx / sp * s; p.vy = p.vy / sp * s; }
    p.x += p.vx * DT; p.y += p.vy * DT;
  }
  for (let i = 0; i < alive.length; i++) for (let j = i + 1; j < alive.length; j++) {
    const a = alive[i], b = alive[j];
    let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
    if (d === 0) { a.x -= 1; continue; }
    if (d >= C.R * 2) continue;
    const nx = dx / d, ny = dy / d, overlap = C.R * 2 - d;
    const ma = a.dashT > 0 ? 2.2 : 1, mb = b.dashT > 0 ? 2.2 : 1;
    a.x -= nx * overlap * (mb / (ma + mb)); a.y -= ny * overlap * (mb / (ma + mb));
    b.x += nx * overlap * (ma / (ma + mb)); b.y += ny * overlap * (ma / (ma + mb));
    const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (rv < 0) {
      const e = 1.35, jimp = -(1 + e) * rv / (1 / ma + 1 / mb);
      a.vx -= jimp * nx / ma; a.vy -= jimp * ny / ma; b.vx += jimp * nx / mb; b.vy += jimp * ny / mb;
      a.lastHit = b.id; a.lastHitT = room.t; b.lastHit = a.id; b.lastHitT = room.t;
      if (-rv > 120) room.events.push(['bonk', (a.x + b.x) / 2, (a.y + b.y) / 2, Math.min(1, -rv / 700)]);
    }
  }
  for (const p of alive) {
    if (Math.hypot(p.x, p.y) > room.arenaR + C.R * 0.3) {
      p.alive = false;
      let by = null;
      if (p.lastHit && room.t - p.lastHitT < 3) { const k2 = room.players.get(p.lastHit); if (k2) { k2.score += 1; k2.kos++; by = k2.id; } }
      room.events.push(['fall', p.id, by]);
      if (room.onFall) room.onFall(p, by);
    }
  }
  const still = [...room.players.values()].filter(p => p.alive);
  if (room.startCount >= 2 && still.length <= 1) endRound(room, still[0] || null);
  else if (room.startCount < 2 && still.length === 0) endRound(room, null);
  // safety valve: players leaving can leave a round with nobody in it
  else if (!still.length) endRound(room, null);
}
function snapshot(room) {
  if (room.state !== 'playing' && room.state !== 'countdown' && !room.events.length) return;
  const ps = [];
  for (const p of room.players.values()) if (p.inRound) ps.push([p.id, Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, Math.round(p.vx), Math.round(p.vy), p.alive ? 1 : 0, p.dashT > 0 ? 1 : 0, Math.round(p.dashCd * 100) / 100]);
  bcast(room, { t: 's', ts: Date.now(), st: room.state, cd: Math.max(0, room.timer), ar: Math.round(room.arenaR * 10) / 10, rt: Math.round(room.t * 10) / 10, p: ps, ev: room.events });
  room.events = [];
}

return { C, DT, DIFF, COLORS, cleanName, createRoom, join, leave, handle, addBot, removeBot, startRound, step, snapshot, roomInfo, sync, humans };
});
