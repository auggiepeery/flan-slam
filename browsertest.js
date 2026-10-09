// Browser test through public URL: desktop (w/ +100ms simulated RTT) creates, phone joins via link, play, screenshot.
const { chromium } = require('playwright-core');
const URL = require('fs').readFileSync(__dirname + '/url.txt', 'utf8').trim();
const LAG = `(() => { const N = window.WebSocket; window.WebSocket = class extends N {
  constructor(u){ super(u); const add = this.addEventListener.bind(this);
    let h=null; Object.defineProperty(this,'onmessage',{set(f){h=f;},get(){return h;}});
    add('message', e => setTimeout(() => h && h({data:e.data}), 50)); }
  send(d){ setTimeout(() => super.send(d), 50); } }; })();`;
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const errs = [];
  const dctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await dctx.addInitScript(LAG);
  const d = await dctx.newPage(); d.on('pageerror', e => errs.push('desk: ' + e.message));
  await d.goto(URL);
  await d.screenshot({ path: 'shots/landing.png' });
  await d.fill('#name', 'Desk Dan'); await d.click('#btn-create');
  await d.waitForSelector('#lobby.show'); const code = await d.textContent('#lb-code');
  const link = await d.inputValue('#lb-link'); console.log('room', code, 'link', link);
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const m = await mctx.newPage(); m.on('pageerror', e => errs.push('mobile: ' + e.message));
  await m.goto(link); await m.screenshot({ path: 'shots/mobile-landing.png' });
  await m.fill('#name', 'Phone Pia'); await m.click('#btn-joinlink');
  await m.waitForSelector('#lobby.show');
  await d.waitForTimeout(500); await d.screenshot({ path: 'shots/lobby.png' }); await m.screenshot({ path: 'shots/mobile-lobby.png' });
  const WebSocket = require('ws'); const bots = [];
  for (const n of ['Bot Bea', 'Bot Bo']) { const w = new WebSocket(URL.replace(/^http/, 'ws') + '/ws'); await new Promise(r => w.on('open', r)); w.send(JSON.stringify({ t: 'join', name: n, code })); bots.push(w);
    let a = Math.random() * 6; setInterval(() => { a += 0.3; w.readyState === 1 && w.send(JSON.stringify({ t: 'input', x: Math.cos(a) * .6, y: Math.sin(a) * .6 })); }, 100); }
  await d.waitForTimeout(800);
  await d.click('#btn-start');
  await m.waitForTimeout(3800); await m.screenshot({ path: 'shots/play-mobile-early.png' });
  await d.waitForTimeout(1500); await d.screenshot({ path: 'shots/countdown.png' });
  
  // desktop: hold right+down, dash; mobile: joystick via CDP touch
  await d.keyboard.down('KeyD'); await d.waitForTimeout(400); await d.keyboard.press('Space'); await d.waitForTimeout(300);
  await d.screenshot({ path: 'shots/play-desktop.png' });
  const cdp = await mctx.newCDPSession(m);
  const tp = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  await tp('touchStart', 100, 600); for (let i = 1; i <= 6; i++) { await tp('touchMove', 100 - i * 10, 600); await m.waitForTimeout(30); }
  await m.waitForTimeout(500); await m.screenshot({ path: 'shots/play-mobile.png' });
  await tp('touchEnd'); await d.keyboard.up('KeyD');
  // Dan drives off the edge to end the round
  await d.keyboard.down('KeyA'); await d.waitForSelector('#over.show', { timeout: 30000 }); await d.keyboard.up('KeyA');
  await d.waitForTimeout(800); await d.screenshot({ path: 'shots/over-desktop.png' }); await m.screenshot({ path: 'shots/over-mobile.png' });
  console.log('over title (desk):', (await d.textContent('#ov-title')).trim(), '| mobile:', (await m.textContent('#ov-title')).trim());
  console.log('errors:', errs.length ? errs : 'none');
  await browser.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
