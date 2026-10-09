#!/usr/bin/env bash
# Restart Flan Slam server + cloudflared quick tunnel, print the public URL.
# Usage: ./start.sh          restart server + tunnel (new URL)
#        ./start.sh server   restart only the game server (tunnel + URL unchanged)
set -u
cd "$(dirname "$0")"
PORT="${PORT:-8787}"
mkdir -p logs
if [ "${1:-}" = "server" ]; then
  pkill -f "^node $(pwd)/server.js" ; sleep 2
  curl -fs "http://localhost:$PORT/health" >/dev/null && echo "Server restarted. URL unchanged: $(cat url.txt 2>/dev/null)" || echo "Server not up; run ./start.sh"
  exit 0
fi
# stop previous instances
[ -f logs/server.pid ] && kill "$(cat logs/server.pid)" 2>/dev/null
[ -f logs/tunnel.pid ] && kill "$(cat logs/tunnel.pid)" 2>/dev/null
pkill -f "party-game/server.js" 2>/dev/null
pkill -f "cloudflared tunnel --url http://localhost:$PORT" 2>/dev/null
sleep 1
# download cloudflared if missing
if [ ! -x bin/cloudflared ]; then
  mkdir -p bin
  curl -sSL -o bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 && chmod +x bin/cloudflared
fi
[ -d node_modules/ws ] || npm install --silent
# server (auto-restarts if it crashes)
PORT=$PORT nohup bash -c "while true; do node $(pwd)/server.js; echo 'server exited, restarting' >&2; sleep 1; done" > logs/server.log 2>&1 &
echo $! > logs/server.pid
for i in $(seq 1 20); do curl -fs "http://localhost:$PORT/health" >/dev/null && break; sleep 0.5; done
curl -fs "http://localhost:$PORT/health" >/dev/null || { echo "Server failed to start; see logs/server.log"; exit 1; }
# tunnel
: > logs/tunnel.log
# Some networks hand out fake DNS answers (198.18.x) for Cloudflare's edge; then dial known edge IPs directly.
EDGE_ARGS=""
EDGE_IP=$(getent hosts region1.v2.argotunnel.com | awk '{print $1; exit}')
case "$EDGE_IP" in ""|198.18.*|198.19.*) EDGE_ARGS="--edge 198.41.192.67:7844 --edge 198.41.192.7:7844 --edge 198.41.200.13:7844 --edge 198.41.200.33:7844";; esac
nohup bin/cloudflared tunnel --url "http://localhost:$PORT" --no-autoupdate --protocol "${TUNNEL_PROTOCOL:-http2}" $EDGE_ARGS > logs/tunnel.log 2>&1 &
echo $! > logs/tunnel.pid
URL=""
for i in $(seq 1 60); do
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' logs/tunnel.log | head -1)
  [ -n "$URL" ] && break; sleep 1
done
if [ -z "$URL" ]; then echo "Tunnel failed; see logs/tunnel.log"; exit 1; fi
# wait until reachable through the tunnel
for i in $(seq 1 40); do curl -fs "$URL/health" >/dev/null && break; sleep 1.5; done
curl -fs "$URL/health" >/dev/null || { echo "Tunnel started ($URL) but is not reachable yet; see logs/tunnel.log"; }
echo "$URL" > url.txt
# point the static (GitHub Pages) build at the new server too (commit + push public/config.js to publish it)
sed -i -E "s#var PAGES_SERVER = '[^']*'#var PAGES_SERVER = '$URL'#" public/config.js
echo "Flan Slam is live at: $URL"
