// Headless AI tuning/regression: run many bot-only rounds with the shared core and report pacing stats.
const Core = require(process.env.CORE || './public/core.js');
function run(diffs, rounds, idle) {
  const room = Core.createRoom('SIM', { send() {} });
  let falls = 0, ko = 0, hazard = 0, self = 0, dur = 0, draws = 0, timeouts = 0, idleSurv = 0;
  room.onFall = (p, by, cause) => { falls++; if (p.hazT && room.t - p.hazT < 2.5) hazard++; if (by) ko++; else if (cause !== 'hazard') self++; };
  let h = null; if (idle) h = Core.join(room, 'Idle', null);
  for (const d of diffs) Core.addBot(room, d);
  for (let r = 0; r < rounds; r++) {
    Core.startRound(room); let n = 0;
    while (room.state !== 'over' && n < 60 * 120) { Core.step(room); Core.snapshot(room); n++; }
    if (room.state !== 'over') timeouts++;
    dur += (n / 60) - Core.C.COUNTDOWN; if (room.winner == null) draws++;
  }
  const play = dur;
  return { avgRoundSec: +(dur / rounds).toFixed(1), fallsPerMin: +(falls / (play / 60)).toFixed(1), koPct: Math.round(100 * ko / falls), hazardInvolvedPct: Math.round(100 * hazard / falls), unassistedSelfPct: Math.round(100 * self / falls), draws, timeouts };
}
const N = +process.argv[2] || 40;
const out = {};
for (const d of ['easy', 'normal', 'hard']) out[`4 ${d} bots`] = run([d, d, d, d], N);
out['mixed e/n/h'] = run(['easy', 'normal', 'hard'], N * 2);
out['7 normal bots'] = run(Array(7).fill('normal'), N);
out['normal bot vs idle human'] = run(['normal'], N, true);
// survival alone on the cake (no opponents): how long can you last just by staying put / wandering / being a bot?
function alone(kind, N) {
  const room = Core.createRoom('A', { send() {} }); let t = 0;
  const p = kind === 'bot' ? Core.addBot(room, 'normal') : Core.join(room, 'H', null);
  for (let r = 0; r < N; r++) { Core.startRound(room); let n = 0, a = Math.random() * 6;
    while (room.state !== 'over' && n < 60 * 120) { if (kind === 'wander' && n % 30 === 0) { a += (Math.random() - .5) * 2; const d = Math.hypot(p.x, p.y); const ix = Math.cos(a) * .7 - (d > 150 ? p.x / d * .5 : 0), iy = Math.sin(a) * .7 - (d > 150 ? p.y / d * .5 : 0); Core.handle(room, p, { t: 'input', x: ix, y: iy }); }
      Core.step(room); n++; }
    t += n / 60 - Core.C.COUNTDOWN; }
  return +(t / N).toFixed(1);
}
out['alone: idle human (s)'] = alone('idle', N); out['alone: normal bot (s)'] = alone('bot', N);
for (const [k, v] of Object.entries(out)) console.log(k.padEnd(28), JSON.stringify(v));
