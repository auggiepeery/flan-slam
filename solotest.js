// Headless test of offline solo-vs-AI mode on desktop + mobile.  Usage: node solotest.js [url]
const { chromium } = require('playwright-core');
const URL = (process.argv[2] || require('fs').readFileSync(__dirname + '/url.txt', 'utf8')).trim();
const WATCH = `addEventListener('DOMContentLoaded', () => { window.__feed = []; new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => n.textContent && window.__feed.push(n.textContent)))).observe(document.getElementById('feed'), { childList: true }); });`;
async function play(browser, label, ctxOpts, mobile) {
  const ctx = await browser.newContext(ctxOpts); await ctx.addInitScript(WATCH);
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(e.message)); page.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await page.goto(URL); await page.waitForTimeout(800);
  await ctx.setOffline(true);                       // prove solo needs no network once loaded
  await page.fill('#name', label.split(' ')[0]);
  await page.click('#bot-plus'); await page.click('#bot-minus');      // 3 bots
  await page.click('#diffs [data-d="normal"]');
  await page.screenshot({ path: `shots/solo-landing-${label.replace(/ /g, '-')}.png` });
  await page.click('#btn-solo');
  const t0 = Date.now(); let rounds = 0;
  const cdp = mobile ? await ctx.newCDPSession(page) : null;
  for (let r = 0; r < 3; r++) {
    await page.waitForFunction(() => document.getElementById('hud-alive').textContent.includes('alive'), null, { timeout: 15000 });
    // the human wanders a bit (keyboard on desktop, joystick on mobile), staying near the middle
    let shot = false;
    while (!(await page.$('#over.show'))) {
      if (Date.now() - t0 > 240000) throw new Error('timeout');
      const dir = ['KeyW', 'KeyA', 'KeyS', 'KeyD'][Math.floor(Math.random() * 4)];
      if (mobile) {
        const x = 100 + (Math.random() - .5) * 80, y = 600 + (Math.random() - .5) * 80;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 100, y: 600, id: 1 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] });
        await page.waitForTimeout(250);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else { await page.keyboard.down(dir); await page.waitForTimeout(200); await page.keyboard.up(dir); if (Math.random() < .2) await page.keyboard.press('Space'); }
      await page.waitForTimeout(300);
      if (!shot && r === 0) { shot = true; await page.waitForTimeout(6500); await page.screenshot({ path: `shots/solo-play-${label.replace(/ /g, '-')}.png` }); }
    }
    rounds++;
    const title = (await page.textContent('#ov-title')).replace(/\s+/g, ' ').trim();
    console.log(`  [${label}] round ${rounds}: ${title}`);
    if (r === 0) {
      await page.screenshot({ path: `shots/solo-over-${label.replace(/ /g, '-')}.png` });
      // add a hard bot from the round-over screen, then remove one easy... (exercise host bot controls)
      await page.selectOption('#over .botctl select', 'hard'); await page.click('#over [data-addbot]');
      await page.waitForTimeout(200);
    }
    await page.click('#btn-next');
  }
  await page.waitForSelector('#over.show', { timeout: 120000 }).catch(() => {});
  const players = await page.$$eval('#ov-score li', ls => ls.map(l => l.textContent.trim()));
  const feed = await page.evaluate(() => window.__feed);
  const ko = feed.filter(f => f.includes('slammed')).length, slip = feed.filter(f => f.includes('slipped off')).length;
  console.log(`  [${label}] scoreboard:`, players.join(' | '));
  console.log(`  [${label}] falls: ${ko} knockouts, ${slip} slipped off with nobody nearby; errors: ${errs.length ? errs.join('; ') : 'none'}`);
  await ctx.close();
  return { errs, ko, slip, rounds, players: players.length };
}
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
  const a = await play(browser, 'Desk', { viewport: { width: 1280, height: 800 } }, false);
  const b = await play(browser, 'Phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, true);
  await browser.close();
  const ok = !a.errs.length && !b.errs.length && a.players === 5 && b.players === 5;
  console.log(ok ? 'SOLO TEST PASS' : 'SOLO TEST FAIL'); process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
