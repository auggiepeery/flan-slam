// FLAN SLAM — server-authoritative multiplayer. Game logic lives in public/core.js (shared with the browser's solo mode).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const Core = require('./public/core.js');

const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '0.0.0.0';
// Browser origins allowed to use this server cross-origin (the GitHub Pages client). Same-origin pages
// (the client served by this server itself, e.g. through a tunnel) and local dev are always allowed.
// ALLOWED_ORIGINS="*" allows any origin (e.g. for ?server= experiments).
const ALLOWED = (process.env.ALLOWED_ORIGINS || 'https://auggiepeery.github.io').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);
function originOk(req) {
  const o = req.headers.origin;
  if (!o) return true; // non-browser clients (tests, health checks)
  if (ALLOWED.includes('*') || ALLOWED.includes(o)) return true;
  let h; try { h = new URL(o); } catch { return false; }
  const hosts = [req.headers.host, req.headers['x-forwarded-host']].filter(Boolean);
  if (hosts.includes(h.host)) return true; // same origin
  return h.hostname === 'localhost' || h.hostname === '127.0.0.1';
}
function cors(req, res) {
  const o = req.headers.origin;
  if (o && originOk(req)) { res.setHeader('Access-Control-Allow-Origin', o); res.setHeader('Vary', 'Origin'); res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS'); res.setHeader('Access-Control-Max-Age', '86400'); }
}
const PUB = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const rooms = new Map();
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (url.pathname === '/health' || url.pathname === '/healthz') { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); return res.end(JSON.stringify({ ok: true, rooms: rooms.size, uptime: Math.round(process.uptime()) })); }
  const p = url.pathname === '/' ? '/index.html' : url.pathname;
  const f = path.normalize(path.join(PUB, p));
  if (!f.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  });
});

const io = { send(p, msg) { const ws = p.conn; if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); } };
function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; let c;
  do { c = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join(''); } while (rooms.has(c));
  return c;
}
setInterval(() => { for (const r of rooms.values()) Core.step(r); }, 1000 / Core.C.TICK);
setInterval(() => { for (const r of rooms.values()) Core.snapshot(r); }, 1000 / Core.C.SNAP);

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024,
  verifyClient: (info, cb) => originOk(info.req) ? cb(true) : (console.log('rejected ws origin', info.req.headers.origin), cb(false, 403, 'Origin not allowed')) });
wss.on('connection', (ws) => {
  let room = null, me = null;
  ws.isAlive = true; ws.on('pong', () => ws.isAlive = true);
  const send = m => ws.readyState === 1 && ws.send(JSON.stringify(m));
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'ping') return send({ t: 'pong', c: m.c, ts: Date.now() });
    if (!room) {
      let r;
      if (m.t === 'create') { r = Core.createRoom(makeCode(), io); rooms.set(r.code, r); }
      else if (m.t === 'join') {
        const code = String(m.code || '').toUpperCase().trim();
        r = rooms.get(code);
        if (!r) return send({ t: 'error', msg: `Room ${code || '?'} not found` });
      } else return;
      const p = Core.join(r, m.name, ws, { char: m.char, color: m.color });
      if (typeof p === 'string') return send({ t: 'error', msg: p });
      room = r; me = p;
      send({ t: 'welcome', id: me.id, code: room.code });
      Core.sync(room);
      return;
    }
    Core.handle(room, me, m);
  });
  ws.on('close', () => { if (room && me && Core.leave(room, me)) rooms.delete(room.code); });
});
setInterval(() => { for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); } }, 15000);
server.listen(PORT, HOST, () => console.log(`Flan Slam listening on http://${HOST}:${PORT} (allowed origins: ${ALLOWED.join(', ')} + same-origin)`));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { for (const ws of wss.clients) try { ws.close(1012, 'server restarting'); } catch {} server.close(); setTimeout(() => process.exit(0), 500).unref(); });
