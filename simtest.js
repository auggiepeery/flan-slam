// Headless AI tuning/regression: run many bot-only rounds with the shared core.
const Core = require('./public/core.js');
function run(diffs, rounds, idle) {
  const room = Core.createRoom('SIM', { send() {} });
  let self = 0, ko = 0, dur = 0, draws = 0, falls = 0, timeouts = 0;
  room.onFall = (p, by) => { falls++; by ? ko++ : self++; };
  if (idle) { const h = Core.join(room, 'Idle', null); }
  for (const d of diffs) Core.addBot(room, d);
  for (let r = 0; r < rounds; r++) {
    Core.startRound(room);
    let n = 0;
    while (room.state !== 'over' && n < 60 * 120) { Core.step(room); Core.snapshot(room); n++; }
    if (room.state !== 'over') timeouts++;
    dur += n / 60; if (room.winner == null) draws++;
  }
  const wins = {}; for (const p of room.players.values()) wins[p.name + '(' + (p.diff || 'human') + ')'] = p.wins;
  return { avgRound: +(dur / rounds).toFixed(1), selfFallPct: Math.round(100 * self / falls), koPct: Math.round(100 * ko / falls), draws, timeouts, wins };
}
const N = +process.argv[2] || 40;
for (const d of ['easy', 'normal', 'hard']) console.log(d, '4 bots:', JSON.stringify(run([d, d, d, d], N)));
console.log('mixed e/n/h:', JSON.stringify(run(['easy', 'normal', 'hard'], N * 2)));
console.log('1 normal bot vs idle human:', JSON.stringify(run(['normal'], N, true)));
console.log('7 normal bots:', JSON.stringify(run(Array(7).fill('normal'), N)));
