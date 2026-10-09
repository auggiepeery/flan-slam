// Multiplayer + server-side AI bots, through the public URL.
const WebSocket = require('ws');
const BASE = (process.argv[2] || require('fs').readFileSync(__dirname + '/url.txt', 'utf8')).trim();
const WS = BASE.replace(/^http/, 'ws') + '/ws';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const res = []; const ok = (c, m) => { res.push(c); console.log((c ? 'PASS ' : 'FAIL ') + m); };
function client(name) {
  return new Promise(r => { const ws = new WebSocket(WS); const c = { ws, room: null, overs: [], errors: [], snaps: 0, falls: [], chat: [],
    send: m => ws.send(JSON.stringify(m)), wait: async (f, ms = 20000) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error(name + ' timeout'); await sleep(50); } } };
    ws.on('message', d => { const m = JSON.parse(d); if (m.t === 'welcome') { c.id = m.id; c.code = m.code; } else if (m.t === 'room') c.room = m; else if (m.t === 'over') c.overs.push(m); else if (m.t === 'error') c.errors.push(m.msg); else if (m.t === 'chat') c.chat.push(m.msg);
      else if (m.t === 's') { c.snaps++; c.last = m; for (const e of m.ev) if (e[0] === 'fall') c.falls.push(e); } });
    ws.on('open', () => r(c)); });
}
const bots = c => c.room.players.filter(p => p.bot);
(async () => {
  console.log('Testing via', WS);
  const H = await client('Host'); H.send({ t: 'create', name: 'Hosty' }); await H.wait(() => H.room && H.id);
  const G = await client('Guest'); G.send({ t: 'join', name: 'Guesty', code: H.code }); await H.wait(() => H.room.players.length === 2);
  G.send({ t: 'addbot', diff: 'hard' }); await sleep(700); ok(bots(H).length === 0, 'non-host cannot add bots');
  H.send({ t: 'addbot', diff: 'easy' }); H.send({ t: 'addbot', diff: 'normal' }); H.send({ t: 'addbot', diff: 'hard' });
  await H.wait(() => bots(H).length === 3);
  ok(bots(G).length === 3 && bots(H).every(b => b.name.startsWith('🤖')), 'host added 3 bots (easy/normal/hard), names have 🤖, guest sees them: ' + bots(H).map(b => `${b.name}[${b.diff}]`).join(', '));
  const rm = bots(H)[0].id; H.send({ t: 'removebot', id: rm }); await H.wait(() => !H.room.players.some(p => p.id === rm));
  ok(bots(H).length === 2, 'host removed a bot');
  H.send({ t: 'addbot', diff: 'normal', n: 7 }); await H.wait(() => H.room.players.length === 8);
  ok(H.room.players.length === 8, 'room fills to 8 with bots (extra requests capped)');
  const L = await client('Late'); L.send({ t: 'join', name: 'Lately', code: H.code }); await L.wait(() => L.room);
  ok(L.room.players.length === 8 && L.room.players.some(p => p.id === L.id), 'a human joining a full room bumps a bot');
  // both humans stay put; host starts
  H.send({ t: 'start' }); await H.wait(() => H.room.state === 'playing', 8000); ok(true, 'round with 3 humans + 5 bots started');
  await H.wait(() => H.overs.length >= 1, 120000);
  const o = H.overs[0];
  const wasBot = H.room.players.find(p => p.id === o.winner)?.bot;
  ok(!!o.winner, `round ended; winner ${o.name}${wasBot ? ' (bot)' : ''}; ${H.falls.length} falls, ${H.falls.filter(f => f[2]).length} credited knockouts`);
  await H.wait(() => [G, L].every(c => c.overs.length), 3000).catch(() => {});
  ok([G, L].every(c => c.overs[0] && c.overs[0].winner === o.winner), 'all clients agree on winner');
  console.log('  scoreboard:', H.room.players.map(p => `${p.name}=${p.score}`).join(', '));
  // round 2: humans dash around randomly
  H.send({ t: 'start' }); await H.wait(() => H.room.state === 'playing', 8000);
  const iv = setInterval(() => { for (const c of [H, G, L]) c.send({ t: 'input', x: Math.random() * 2 - 1, y: Math.random() * 2 - 1, d: Math.random() < .1 ? 1 : 0 }); }, 200);
  await H.wait(() => H.overs.length >= 2, 120000); clearInterval(iv);
  ok(true, `round 2 ended; winner ${H.overs[1].name}`);
  ok(H.room.round === 2 && H.room.players.some(p => p.score > 0), 'scores carry across rounds');
  // humans leave -> room should be disposed even though bots remain
  for (const c of [H, G, L]) c.ws.close(); await sleep(800);
  const health = await (await fetch(BASE + '/health')).json();
  ok(health.rooms === 0, 'room with only bots left is cleaned up (rooms=' + health.rooms + ')');
  console.log(`\n${res.filter(Boolean).length}/${res.length} checks passed`); process.exit(res.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
