// Screenshots of hazards in solo mode (desktop + phone) for visual QA.
const { chromium } = require('playwright-core');
const URL = (process.argv[2] || require('fs').readFileSync(__dirname + '/url.txt', 'utf8')).trim();
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
  const errs = [];
  for (const [label, opts] of [['desk', { viewport: { width: 1280, height: 800 } }], ['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }]]) {
    const p = await (await b.newContext(opts)).newPage(); p.on('pageerror', e => errs.push(label + ': ' + e.message));
    await p.goto(URL); await p.fill('#name', 'Tester');
    while (+(await p.textContent('#bot-n')) < 5) await p.click('#bot-plus');
    await p.click('#btn-solo');
    for (let i = 0; i < 9; i++) { await p.waitForTimeout(2000); await p.screenshot({ path: `shots/haz-${label}-${i}.png` }); if (await p.$('#over.show')) break; }
  }
  console.log('errors:', errs.length ? errs : 'none'); await b.close();
})();
