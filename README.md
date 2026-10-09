# 🍮 Flan Slam

**Wobbly flans. A shrinking beach island. One winner.**
Flan Slam is a silly real-time party game for 1–8 players. Everyone is a squishy flan on a little sandy beach island — dash into your friends to send them flying into the sea while the island shrinks and the sand collapses beneath you. Rounds last about 20–25 seconds and scores carry across rounds.

Play with friends by sharing one link, or solo against AI bots (works offline once the page has loaded).

## How to play
| | Desktop | Phone |
|---|---|---|
| Move | `WASD` / arrow keys, or hold the mouse button (you move toward the cursor) | Left thumb anywhere → floating joystick |
| Dash | `Space` / `Shift` / right-click (0.75 s cooldown, ring around your flan) | **DASH** button (or tap the right side) |

- Knock the others into the sea before the island (and its hazards) does it to you. Rounds last about 20–25 s.
- **Last flan standing: +3 points. Each knockout: +1** (if you were the last to bump them).
- Dashing makes you heavier: a dash into someone sends them flying… and a miss can send *you* into the sea.

### Hazards & power-ups (telegraphed, then live)
- ⚠️ **Collapsing sand**: a wedge of the shore flashes red with cracks for 1.6 s, then collapses into the water for the rest of the round.
- 🏖️ **Giant beach shovel**: a shadow arm and rotation arrow show for 1.5 s, then a shovel sweeps around the island for about 3.6 s and shoves anyone in its path. It can't reach the very middle (the hub).
- 🌿 **Seaweed slicks** (tide pools): inside one you have very little grip or control, and they last 9 s.
- 🌬️ **Sea breezes**: arrows show the direction for 1.4 s, then the wind blows everyone that way for 2.2 s.
- ⭐ **Mega-Slam starfish**: grab it for 5 s of extra slam weight and a half-length dash cooldown (you get a golden aura).
- The darker **wet-sand band** at the edge is a slope that pulls you toward the surf. The island starts shrinking at 8 s, and in **sudden death** it keeps eroding until somebody falls.

### Characters & colours
Pick your flan on the landing page: **Classic** (caramel top), **King Wobble** (crown, smug), **Ninja** (squarish, fluttering headband), **Party Animal** (party hat, big grin), **Shades** (sunglasses, smirk) and **Sprout** (jelly-mould shape, leaf, blush). Choose one of 16 palette colours or any colour with 🎨. Your choice is saved in your browser and synced to the room. The server checks every look and, if your colour is too close to someone else's, gives you the nearest clearly different one. Bots get random characters and colours. Looks are **cosmetic only**: every flan has the same size, speed and weight.

### Multiplayer
1. Enter a nickname → **Create a room**. You get a 4-letter code and a share link (`…/?room=ABCD`).
2. Friends open the link (or type the code) → **Join**. Up to 8 players; late joiners hop in next round. The code is shown big in the lobby (with a **Copy code** button) and stays in the corner during play and between rounds, so late joiners can hop in.
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

### Permanent server on Render (free)
The repo is ready for Render: `render.yaml` is a Blueprint for a free Node web service named `flan-slam`. It uses `npm ci` and `npm start` and health-checks `/healthz`. The server listens on `$PORT` and binds `0.0.0.0`.
1. In the Render dashboard choose **New → Blueprint**, connect GitHub, pick `auggiepeery/flan-slam` and **Apply**. Or choose **New → Web Service** with the same repo and settings.
2. When it's live, put its URL (e.g. `https://flan-slam.onrender.com`) in `PAGES_SERVER` in `public/config.js`, then commit and push.

The server accepts WebSocket and CORS requests only from `ALLOWED_ORIGINS` (default `https://auggiepeery.github.io`, comma-separated, `*` for any) and from its own origin. Free instances sleep after about 15 minutes idle. The Pages client starts waking the server when the page loads, shows a "Waking the server, ~30s" notice and keeps retrying for up to 100 s instead of failing. `node deploytest.js` tests all of this locally.

## Code layout
- `public/core.js`: shared game core (rooms, physics, scoring, AI bots). Used by both the server and the browser's solo mode.
- `server.js`: HTTP + WebSocket server (`ws`).
- `public/flans.js`: character art (shared by the game and the picker).
- `public/game.js`, `index.html`, `style.css`: canvas renderer, UI, input, sound, interpolation, solo mode.
- `public/sw.js`: network-first service worker so the game loads offline after one visit.
- Tests: `simtest.js` (headless AI rounds and pacing stats; `CORE=path` compares against another core), `looktest.js` (characters and colours), `hazshots.js` (hazard screenshots), `test.js` + `bottest.js` (multiplayer + bots over WebSockets; pass a URL), `solotest.js` + `browsertest.js` (headless Chrome via playwright-core; set the Chrome path inside).

MIT licensed.
