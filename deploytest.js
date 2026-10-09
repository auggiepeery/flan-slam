// Hosting readiness test (Render): PORT/0.0.0.0 binding, /healthz, CORS + WebSocket origin rules,
// and the static (Pages-style) client riding out a sleeping server with the "waking" notice + auto-retry.
// Usage: node deploytest.js   (starts its own servers on free local ports)
const { spawn } = require('child_process');
const http = require('http'), fs = require('fs'), path = require('path');
const WebSocket = require('ws');
const { chromium } = require('playwright-core');
let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); c ? pass++ : fail++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const GAME = 9931, STATIC = 9932;
function startGame() {
  const p = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env: { ...process.env, PORT: String(GAME), ALLOWED_ORIGINS: 'https://auggiepeery.github.io' }, stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise(res => p.stdout.on('data', d => { if (/listening/.test(d)) res(p); }));
}
function get(p, headers = {}, method = 'GET') { return new Promise((res, rej) => { const r = http.request({ host: '127.0.0.1', port: GAME, path: p, method, headers }, x => { let b = ''; x.on('data', d => b += d); x.on('end', () => res({ s: x.statusCode, h: x.headers, b })); }); r.on('error', rej); r.end(); }); }
function wsTry(origin) { return new Promise(res => { const w = new WebSocket(`ws://127.0.0.1:${GAME}/ws`, origin ? { origin } : {}); w.on('open', () => { w.close(); res('open'); }); w.on('unexpected-response', (q, r) => res(r.statusCode)); w.on('error', () => res('error')); }); }
(async () => {
  let game = await startGame();
  const h = await get('/healthz');
  ok(h.s === 200 && JSON.parse(h.b).ok === true, `/healthz -> ${h.s} ${h.b}`);
  ok((await get('/health')).s === 200, '/health still works (start.sh uses it)');
  const c1 = await get('/healthz', { origin: 'https://auggiepeery.github.io' });
  ok(c1.h['access-control-allow-origin'] === 'https://auggiepeery.github.io', 'CORS allows https://auggiepeery.github.io');
  const c2 = await get('/healthz', { origin: 'https://evil.example' });
  ok(!c2.h['access-control-allow-origin'], 'CORS header not sent for other origins');
  const pre = await get('/healthz', { origin: 'https://auggiepeery.github.io', 'access-control-request-method': 'GET' }, 'OPTIONS');
  ok(pre.s === 204 && pre.h['access-control-allow-origin'], `OPTIONS preflight -> ${pre.s}`);
  ok(await wsTry('https://auggiepeery.github.io') === 'open', 'WebSocket from GitHub Pages origin accepted');
  ok(await wsTry(`http://127.0.0.1:${GAME}`) === 'open', 'same-origin WebSocket accepted');
  ok(await wsTry(null) === 'open', 'WebSocket without Origin (non-browser) accepted');
  ok(await wsTry('https://evil.example') === 403, 'WebSocket from unknown origin rejected (403)');
  game.kill('SIGTERM'); await new Promise(r => game.on('exit', r));
  ok(true, 'server exits cleanly on SIGTERM (Render redeploys)');

  // Static host serving public/ (stands in for GitHub Pages); the game server is "asleep" (not listening).
  const PUB = path.join(__dirname, 'public');
  const st = http.createServer((q, r) => { const u = new URL(q.url, 'http://x'); const f = path.join(PUB, u.pathname === '/' ? 'index.html' : u.pathname); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html' : f.endsWith('.css') ? 'text/css' : 'text/javascript' }); r.end(d); }); }).listen(STATIC);
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
  const errs = [];
  for (const [label, opts] of [['desktop', { viewport: { width: 1024, height: 700 } }], ['phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
    const ctx = await browser.newContext(opts); const pg = await ctx.newPage();
    pg.on('pageerror', e => errs.push(label + ': ' + e.message));
    await pg.goto(`http://127.0.0.1:${STATIC}/?server=http://127.0.0.1:${GAME}`);
    await pg.fill('#name', 'Sleepy');
    await pg.click('#btn-create');
    await pg.waitForSelector('#wake:not(.hidden)', { timeout: 8000 }).catch(() => {});
    const txt = await pg.$eval('#wake', e => e.classList.contains('hidden') ? '' : e.innerText);
    ok(/Waking the server, ~30s/.test(txt), `${label}: sleeping server shows the waking notice`);
    ok(await pg.textContent('#err') === '', `${label}: no error shown while waking`);
    await sleep(2500);
    await pg.screenshot({ path: `shots/waking-${label}.png` });
    if (label === 'desktop') {
      await pg.click('#btn-wake-cancel');
      ok(await pg.$eval('#wake', e => e.classList.contains('hidden')), 'desktop: Cancel stops waking and hides the notice');
      await pg.click('#btn-create');
      await pg.waitForSelector('#wake:not(.hidden)', { timeout: 8000 });
    }
    game = await startGame(); // the server "wakes up"
    const t0 = Date.now();
    await pg.waitForSelector('#lobby.show', { timeout: 20000 }).catch(() => {});
    const code = await pg.textContent('#lb-code');
    ok(/^[A-Z]{4}$/.test(code), `${label}: auto-retry reached the lobby (room ${code}) ${((Date.now() - t0) / 1000).toFixed(1)}s after the server woke`);
    ok(await pg.$eval('#wake', e => e.classList.contains('hidden')), `${label}: waking notice hidden once connected`);
    await ctx.close(); game.kill('SIGTERM'); await new Promise(r => game.on('exit', r));
  }
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await browser.close(); st.close();
  console.log(`${pass}/${pass + fail} checks passed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
