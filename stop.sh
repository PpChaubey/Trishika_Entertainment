#!/bin/bash
PID_DIR=".pids"
echo "🛑 Stopping all services..."
for pidfile in $PID_DIR/*.pid; do
  [ -f "$pidfile" ] || continue
  pid=$(cat "$pidfile")
  name=$(basename "$pidfile" .pid)
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid"
    echo "  ✅ Stopped $name (pid $pid)"
  fi
  rm -f "$pidfile"
done
echo "✅ All stopped"
