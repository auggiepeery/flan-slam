# 🍮 Flan Slam

**Wobbly flans. A shrinking cake. One winner.**
Flan Slam is a silly real-time party game for 1–8 players. Everyone is a squishy flan on a giant sprinkle cake floating in soup — dash into your friends to send them flying off the edge while the cake crumbles away beneath you. Rounds last under a minute; scores carry across rounds.

Play with friends by sharing one link, or solo against AI bots (works offline once the page has loaded).

## How to play
| | Desktop | Phone |
|---|---|---|
| Move | `WASD` / arrow keys, or hold the mouse button (you move toward the cursor) | Left thumb anywhere → floating joystick |
| Dash | `Space` / `Shift` / right-click (1.6 s cooldown, ring around your flan) | **DASH** button (or tap the right side) |

- Knock the others off the cake. The cake shrinks, then crumbles in sudden death until somebody falls.
- **Last flan standing: +3 points. Each knockout: +1** (if you were the last to bump them).
- Dashing makes you heavier: a dash into someone sends them flying… and a miss can send *you* into the soup.

### Multiplayer
1. Enter a nickname → **Create a room**. You get a 4-letter code and a share link (`…/?room=ABCD`).
2. Friends open the link (or type the code) → **Join**. Up to 8 players; late joiners hop in next round.
3. The host (👑) presses **Start**. After each round the host starts the next one.
4. The host can **＋ Add 🤖 bot** (easy / normal / hard) or ✕ remove bots in the lobby or between rounds to fill the room. If a human joins a full room, a bot makes way.

### Solo vs AI
On the landing page pick **1–7 bots** and **Easy / Normal / Hard**, then **🤖 Play vs AI**. Everything runs in your browser (same game code as the server), so it works without a server or network. If you're knocked out, the rest of the round fast-forwards.

**Bot brains:** bots chase whoever is nearest/closest to the edge, try to get *between* their target and the middle so their slam pushes outward, dash when lined up, check that a dash won't fling themselves off, keep a safety margin from the shrinking edge (look-ahead on their own velocity) and side-step incoming dashes. Difficulty changes reaction time (0.42 s / 0.2 s / 0.07 s), aim noise, speed, edge look-ahead, dodge chance and dash discipline.

## Running the server
Requires Node.js 18+.
```bash
npm install
npm start            # http://localhost:8787  (PORT env var to change)
```
The Node server serves the client (`public/`) and the WebSocket endpoint (`/ws`). It is server-authoritative: 60 Hz physics, 30 Hz snapshots, and clients interpolate other players about 110 ms in the past while extrapolating their own flan, so it plays fine at roughly 100 ms latency.

### Share it publicly (no account): `start.sh`
```bash
./start.sh           # (re)starts the server in the background + a Cloudflare quick tunnel, prints the public https URL
./start.sh server    # restart only the game server; tunnel URL unchanged
```
It downloads `cloudflared` to `bin/` if it's missing. Quick-tunnel URLs are **temporary**: you get a new one every time the tunnel restarts.

### Static client (GitHub Pages)
`.github/workflows/pages.yml` publishes `public/` to GitHub Pages. Solo vs AI always works there. For multiplayer, the static site connects to the server in `public/config.js` (`PAGES_SERVER`; `start.sh` rewrites it, then commit + push), or to a server you choose per visit: `https://<pages-site>/?server=https://your-server.example`. For multiplayer that's always on, host `server.js` somewhere permanent (any Node host that supports WebSockets, e.g. Render, Fly.io, Railway).

## Code layout
- `public/core.js`: shared game core (rooms, physics, scoring, AI bots). Used by both the server and the browser's solo mode.
- `server.js`: HTTP + WebSocket server (`ws`).
- `public/game.js`, `index.html`, `style.css`: canvas renderer, UI, input, sound, interpolation, solo mode.
- `public/sw.js`: network-first service worker so the game loads offline after one visit.
- Tests: `simtest.js` (headless AI rounds), `test.js` + `bottest.js` (multiplayer + bots over WebSockets; pass a URL), `solotest.js` + `browsertest.js` (headless Chrome via playwright-core; set the Chrome path inside).

MIT licensed.
