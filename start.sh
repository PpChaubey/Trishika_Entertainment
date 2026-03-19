#!/bin/bash
# ─── SAFE STARTUP SCRIPT ──────────────────────────────────
set -e
echo "🎬 Starting The Weight of Silence"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Load .env
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
  echo "✅ .env loaded"
else
  echo "⚠️  No .env found — using defaults"
fi

SERVICE_TOKEN=${SERVICE_TOKEN:-"thriller-secret-2026"}
PID_DIR=".pids"
mkdir -p $PID_DIR

# ─── SAFE STOP using PID files ────────────────────────────
stop_service() {
  local name=$1
  local pidfile="$PID_DIR/$name.pid"
  if [ -f "$pidfile" ]; then
    local pid=$(cat "$pidfile")
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid"
      echo "  🛑 Stopped $name (pid $pid)"
    fi
    rm -f "$pidfile"
  fi
}

stop_service "node"
stop_service "audio"
stop_service "image"
sleep 1

# ─── START OLLAMA ─────────────────────────────────────────
if ! curl -s http://localhost:11434 > /dev/null 2>&1; then
  echo "🤖 Starting Ollama..."
  ollama serve > logs/ollama.log 2>&1 &
  echo $! > $PID_DIR/ollama.pid
  sleep 3
fi
echo "✅ Ollama running"

mkdir -p logs

# ─── START AUDIO SERVER ───────────────────────────────────
echo "🔊 Starting Audio server (port 3001)..."
SERVICE_TOKEN=$SERVICE_TOKEN python3 audio_server.py > logs/audio.log 2>&1 &
echo $! > $PID_DIR/audio.pid
sleep 1

# ─── START IMAGE SERVER ───────────────────────────────────
echo "🖼️  Starting Image server (port 3002)..."
SERVICE_TOKEN=$SERVICE_TOKEN python3 image_server.py > logs/image.log 2>&1 &
echo $! > $PID_DIR/image.pid
sleep 1

# ─── START NODE SERVER ────────────────────────────────────
echo "⚡ Starting Main server (port 3000)..."
node server.js > logs/app.log 2>&1 &
echo $! > $PID_DIR/node.pid

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ All servers running!"
echo "🎬 Open: http://localhost:3000"
echo "📋 Logs: ./logs/"
echo "🛑 Stop: bash stop.sh"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Tail logs
tail -f logs/app.log
