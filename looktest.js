// Headless check of the character/colour picker + rendering in solo and multiplayer (desktop + phone).
const { chromium } = require('playwright-core');
const WebSocket = require('ws');
const URL = (process.argv[2] || require('fs').readFileSync(__dirname + '/url.txt', 'utf8')).trim();
const SERVER = (process.argv[3] || URL).trim();
const out = (process.argv[4] || 'shots');
const res = []; const ok = (c, m) => { res.push(c); console.log((c ? 'PASS ' : 'FAIL ') + m); };
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
  const errs = [];
  // ---- desktop: pick character + colour, check persistence, solo render ----
  const dctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const d = await dctx.newPage(); d.on('pageerror', e => errs.push('desk: ' + e.message));
  await d.goto(URL); await d.waitForTimeout(600);
  ok(await d.$$eval('.chartile', l => l.length) === 6, 'desktop: 6 character tiles');
  ok(await d.$$eval('#swatches .sw', l => l.length) === 16, 'desktop: 16 palette swatches + custom picker');
  await d.click('[data-char="king"]'); await d.click('[data-color="#7c4dff"]').catch(() => {});
  await d.click('[data-color="#ffd23f"]');
  await d.fill('#name', 'Kingsley'); await d.waitForTimeout(400);
  await d.screenshot({ path: `${out}/picker-desktop.png` });
  await d.reload(); await d.waitForTimeout(500);
  const persisted = await d.evaluate(() => [localStorage.getItem('fs-char'), localStorage.getItem('fs-color'), document.querySelector('.chartile.sel').dataset.char]);
  ok(persisted.join() === 'king,#ffd23f,king', 'choice remembered after reload: ' + persisted.join(' '));
  // custom colour via <input type=color>
  await d.evaluate(() => { const i = document.getElementById('custom-color'); i.value = '#12abef'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  ok(await d.evaluate(() => localStorage.getItem('fs-color')) === '#12abef', 'custom colour picker works (#12abef)');
  await d.click('[data-color="#ffd23f"]');
  // solo with 5 bots
  await d.click('#bot-plus'); await d.click('#bot-plus'); while (+(await d.textContent('#bot-n')) < 5) await d.click('#bot-plus');
  while (+(await d.textContent('#bot-n')) > 5) await d.click('#bot-minus');
  await d.click('#btn-solo'); await d.waitForTimeout(3600);
  await d.screenshot({ path: `${out}/chars-solo-countdown.png` });
  await d.waitForTimeout(2500); await d.screenshot({ path: `${out}/chars-solo-play.png` });
  const hud = await d.$$eval('#hud-score img', l => l.length);
  ok(hud === 6, 'solo HUD shows character icons for all 6 flans');
  // ---- multiplayer: desktop creates, phone joins with different look, node client with bogus look ----
  await d.evaluate(() => document.querySelector('[data-leave]').click());
  await d.waitForSelector('#landing.show');
  await d.fill('#name', 'Kingsley'); await d.click('#btn-create'); await d.waitForSelector('#lobby.show', { timeout: 15000 }).catch(async e => { console.log('err text:', await d.textContent('#err'), await d.$eval('#landing', x => x.className)); throw e; }); const code = await d.textContent('#lb-code');
  const fsz = await d.$eval('#lb-code', e => parseFloat(getComputedStyle(e).fontSize));
  ok(/^[A-Z]{4}$/.test(code) && fsz >= 60, `lobby shows room code ${code} large (${fsz}px) with copy-code button: ${!!(await d.$('#btn-copy-code'))}`);
  ok(await d.evaluate(() => FlanCore.C.DASH_CD) === 0.75, 'client core has 0.75s dash cooldown');
  await d.screenshot({ path: `${out}/lobby-desktop.png` });
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const m = await mctx.newPage(); m.on('pageerror', e => errs.push('phone: ' + e.message));
  await m.goto(URL + '/?room=' + code); await m.waitForTimeout(500);
  await m.tap('[data-char="ninja"]'); await m.tap('[data-color="#ffd23f"]');   // same colour as host -> server must adjust
  await m.fill('#name', 'Nina'); await m.screenshot({ path: `${out}/picker-phone.png` });
  await m.tap('#btn-joinlink'); await m.waitForSelector('#lobby.show');
  await m.waitForTimeout(400); await m.screenshot({ path: `${out}/lobby-phone.png` });
  const mfs = await m.$eval('#lb-code', e => [e.textContent, parseFloat(getComputedStyle(e).fontSize), e.getBoundingClientRect().right <= innerWidth]);
  ok(mfs[0] === code && mfs[1] >= 50 && mfs[2], `phone lobby shows code ${mfs[0]} at ${mfs[1]}px, fits on screen`);
  const ws = new WebSocket(SERVER.replace(/^http/, 'ws') + '/ws'); await new Promise(r => ws.on('open', r));
  ws.send(JSON.stringify({ t: 'join', name: 'Hacker', code, char: '<img onerror=alert(1)>', color: 'javascript:red' }));
  await d.click('#lobby [data-addbot]'); await d.click('#lobby [data-addbot]'); await d.click('#lobby [data-addbot]');
  await d.waitForTimeout(1500);
  const room = await d.evaluate(() => window.__room = null) || null;
  const info = await m.evaluate(() => [...document.querySelectorAll('#lb-players li')].map(li => li.textContent.trim()));
  console.log('  lobby (seen by phone):', info.join(' | '));
  // read authoritative look data from a raw client
  const look = await new Promise(r => { const w2 = new WebSocket(SERVER.replace(/^http/, 'ws') + '/ws'); w2.on('open', () => w2.send(JSON.stringify({ t: 'join', name: 'Probe', code, char: 'sprout', color: '#2ef2c8' })));
    w2.on('message', x => { const msg = JSON.parse(x); if (msg.t === 'room' && msg.players.some(p => p.name === 'Probe')) { r(msg.players); w2.close(); } }); });
  console.log('  server looks:', look.map(p => `${p.name}:${p.char}:${p.color}`).join(', '));
  const host = look.find(p => p.name === 'Kingsley'), nina = look.find(p => p.name === 'Nina'), hk = look.find(p => p.name === 'Hacker');
  ok(host.char === 'king' && host.color === '#ffd23f', 'host look synced (king, #ffd23f)');
  ok(nina.char === 'ninja' && nina.color !== '#ffd23f' && /^#[0-9a-f]{6}$/.test(nina.color), `phone's clashing colour was swapped for a distinct one (${nina.color}), ninja kept`);
  ok(hk.char === 'classic' && /^#[0-9a-f]{6}$/.test(hk.color), 'invalid character/colour rejected by server -> classic + valid colour');
  const bots = look.filter(p => p.bot);
  ok(bots.length === 3 && new Set(bots.map(b => b.char)).size >= 2, 'bots got random characters: ' + bots.map(b => b.char).join(','));
  const cols = look.map(p => p.color); ok(new Set(cols).size === cols.length, 'all colours in room distinct');
  ws.close(); await d.waitForTimeout(800);
  await d.click('#btn-start'); await d.waitForTimeout(6500);
  await d.screenshot({ path: `${out}/chars-mp-desktop.png` }); await m.screenshot({ path: `${out}/chars-mp-phone.png` });
  ok(await m.$$eval('#hud-score img', l => l.length) >= 5, 'phone HUD renders character icons in multiplayer');
  const hudc = await m.$eval('#hud-room', e => [document.getElementById('hud-code').textContent, getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0]);
  ok(hudc[0] === code && hudc[1], `room code ${hudc[0]} visible in the in-game HUD (phone)`);
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join('; ') : ''));
  await browser.close();
  console.log(`\n${res.filter(Boolean).length}/${res.length} checks passed`); process.exit(res.every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
