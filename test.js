// End-to-end test through the public tunnel: create/join, start, movement sync, round end, late join, round 2.
const WebSocket = require('ws');
const BASE = (process.argv[2] || require('fs').readFileSync(__dirname + '/url.txt', 'utf8')).trim();
const WS = BASE.replace(/^http/, 'ws') + '/ws';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const ok = (c, m) => { results.push([c, m]); console.log((c ? 'PASS ' : 'FAIL ') + m); };

function bot(name) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(WS);
    const b = { name, ws, id: null, code: null, room: null, snaps: [], overs: [], errors: [], seen: {}, rtts: [], aggressive: false,
      send: m => ws.send(JSON.stringify(m)), waitFor: async (fn, ms = 20000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error(name + ' timeout'); await sleep(50); } } };
    ws.on('open', () => res(b)); ws.on('error', rej);
    ws.on('message', d => {
      const m = JSON.parse(d);
      if (m.t === 'welcome') { b.id = m.id; b.code = m.code; }
      else if (m.t === 'room') b.room = m;
      else if (m.t === 's') { b.snaps.push(m); if (b.snaps.length > 400) b.snaps.shift(); for (const p of m.p) { (b.seen[p[0]] ||= []).push([p[1], p[2]]); } }
      else if (m.t === 'over') b.overs.push(m);
      else if (m.t === 'error') b.errors.push(m.msg);
      else if (m.t === 'pong') b.rtts.push(Date.now() - m.c);
    });
    // AI loop: chase the nearest opponent, dash when close
    b.loop = setInterval(() => {
      const s = b.snaps[b.snaps.length - 1]; if (!s || s.st !== 'playing') return;
      const mine = s.p.find(p => p[0] === b.id); if (!mine || !mine[5]) return;
      let best = null, bd = 1e9; for (const p of s.p) if (p[0] !== b.id && p[5]) { const d = Math.hypot(p[1] - mine[1], p[2] - mine[2]); if (d < bd) { bd = d; best = p; } }
      let x = 0, y = 0;
      if (best) { x = best[1] - mine[1]; y = best[2] - mine[2]; }
      const l = Math.hypot(x, y) || 1;
      b.send({ t: 'input', x: x / l, y: y / l, d: bd < 140 ? 1 : 0 });
    }, 50);
  });
}

(async () => {
  console.log('Testing via', WS);
  const A = await bot('Alice'); A.send({ t: 'create', name: 'Alice' });
  await A.waitFor(() => A.code && A.room);
  ok(/^[A-Z]{4}$/.test(A.code), `Alice created room ${A.code}; share link ${BASE}/?room=${A.code}`);
  const page = await fetch(`${BASE}/?room=${A.code}`); ok(page.status === 200, `share link page loads over HTTPS (${page.status})`);
  const Bb = await bot('Bob'); Bb.send({ t: 'join', name: 'Bob', code: A.code.toLowerCase() });
  const C = await bot('Cleo'); C.send({ t: 'join', name: 'Cleo', code: A.code });
  await A.waitFor(() => A.room.players.length === 3);
  ok(Bb.code === A.code && C.code === A.code, 'Bob and Cleo joined same room (code case-insensitive)');
  ok(A.room.host === A.id, 'Alice is host');
  const X = await bot('Xavier'); X.send({ t: 'join', name: 'X', code: 'ZZZZ' }); await X.waitFor(() => X.errors.length);
  ok(/not found/.test(X.errors[0]), 'bad code rejected: ' + X.errors[0]); X.ws.close();
  // non-host cannot start
  Bb.send({ t: 'start' }); await sleep(600); ok(A.room.state === 'lobby', 'non-host start ignored');
  // latency
  for (let i = 0; i < 5; i++) { A.send({ t: 'ping', c: Date.now() }); await sleep(150); }
  await A.waitFor(() => A.rtts.length >= 5);
  ok(true, `tunnel RTT ms: ${A.rtts.join(', ')}`);
  A.send({ t: 'start' });
  await A.waitFor(() => A.room.state === 'countdown');
  ok(true, 'host started round 1 -> countdown');
  await A.waitFor(() => A.room.state === 'playing', 6000);
  ok(true, 'countdown -> playing');
  const t0 = Date.now();
  await sleep(1200);
  // movement visibility: each client sees each other's position change
  for (const viewer of [A, Bb, C]) for (const other of [A, Bb, C]) if (viewer !== other) {
    const tr = viewer.seen[other.id] || []; const moved = tr.length > 5 && Math.hypot(tr[tr.length - 1][0] - tr[0][0], tr[tr.length - 1][1] - tr[0][1]) > 20;
    ok(moved, `${viewer.name} sees ${other.name} move (${tr.length} samples)`);
  }
  // snapshot rate
  const sn = A.snaps.filter(s => s.st === 'playing'); const span = (sn[sn.length - 1].ts - sn[0].ts) / 1000;
  ok(sn.length / span > 20, `snapshot rate ~${(sn.length / span).toFixed(1)}/s`);
  // late joiner mid-round
  const D = await bot('Dina'); D.send({ t: 'join', name: 'Dina', code: A.code });
  await D.waitFor(() => D.room);
  const dIn = D.room.players.find(p => p.id === D.id);
  ok(D.room.state === 'playing' && dIn && !dIn.playing, 'late joiner Dina waits as spectator mid-round');
  await A.waitFor(() => A.overs.length >= 1, 70000);
  const o = A.overs[0];
  ok(true, `round 1 ended after ${((Date.now() - t0) / 1000).toFixed(1)}s, winner: ${o.name || 'none (draw)'}`);
  await A.waitFor(() => [Bb, C, D].every(b => b.overs.length), 3000).catch(() => {});
  ok([Bb, C, D].every(b => b.overs.length && b.overs[0].winner === o.winner), 'all clients agree on winner');
  await sleep(300);
  console.log('Scoreboard after round 1:', A.room.players.map(p => `${p.name}=${p.score}pts(${p.wins}W/${p.kos}KO)`).join(' '));
  ok(!o.winner || A.room.players.find(p => p.id === o.winner).score >= 3, 'winner got +3');
  // round 2 incl. late joiner
  A.send({ t: 'start' }); await A.waitFor(() => A.room.state === 'playing', 8000);
  await sleep(800);
  ok(D.snaps[D.snaps.length - 1].p.some(p => p[0] === D.id && p[5]), 'Dina plays in round 2');
  // host leaves -> host migrates
  A.ws.close(); await Bb.waitFor(() => Bb.room.players.length === 3);
  ok(Bb.room.host !== A.id, 'host migrated after Alice left');
  await Bb.waitFor(() => Bb.overs.length >= 2, 70000);
  console.log('Round 2 winner:', Bb.overs[1].name, '| Scoreboard:', Bb.room.players.map(p => `${p.name}=${p.score}`).join(' '));
  ok(Bb.room.round === 2, 'round counter = 2, scores carried across rounds');
  for (const b of [Bb, C, D]) { clearInterval(b.loop); b.ws.close(); } clearInterval(A.loop);
  const fails = results.filter(r => !r[0]).length;
  console.log(`\n${results.length - fails}/${results.length} checks passed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ERROR', e); process.exit(1); });
