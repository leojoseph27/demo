#!/bin/bash
# Auto-restarting Next.js production server
# Restarts the server if it crashes, ensuring continuous availability

LOG="/tmp/next-server-watchdog.log"
echo "[$(date)] Server watchdog started" >> "$LOG"

while true; do
    cd /home/z/my-project
    
    # Check if port 3000 is already in use
    if curl -s --max-time 2 http://localhost:3000/api/auth/check > /dev/null 2>&1; then
        echo "[$(date)] Server already running on port 3000" >> "$LOG"
        sleep 5
        continue
    fi
    
    echo "[$(date)] Starting Next.js production server..." >> "$LOG"
    node node_modules/.bin/next start -p 3000 >> "$LOG" 2>&1
    EXIT_CODE=$?
    echo "[$(date)] Server exited with code $EXIT_CODE, restarting in 3s..." >> "$LOG"
    sleep 3
done
