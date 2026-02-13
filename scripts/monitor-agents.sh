#!/bin/bash
# kilocode_change - new file
# Monitor Society Agent registry in real-time

SHARED_DIR="${1:-.society-agent}"
REGISTRY="$SHARED_DIR/registry.jsonl"

if [ ! -f "$REGISTRY" ]; then
  echo "❌ Registry not found: $REGISTRY"
  echo "Usage: $0 [shared-dir]"
  exit 1
fi

echo "🤖 Society Agent Monitor"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Registry: $REGISTRY"
echo "Press Ctrl+C to exit"
echo ""

while true; do
  clear
  echo "🤖 Society Agent Monitor - $(date +'%Y-%m-%d %H:%M:%S')"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  
  # Process registry with jq if available, otherwise use awk
  if command -v jq &> /dev/null; then
    cat "$REGISTRY" | jq -r '
      {agentId, role, status, lastHeartbeat, workspace} |
      "\(.agentId // "unknown") | \(.role // "unknown") | \(.status // "unknown") | \(.lastHeartbeat // "unknown") | \(.workspace // "")"
    ' | awk -F' \\| ' '
    BEGIN {
      agents[0] = ""
      delete agents[0]
    }
    {
      # Update agent info (later entries override earlier ones)
      id = $1
      agents[id] = $0
    }
    END {
      # Print header
      printf "%-25s %-20s %-10s %-25s\n", "AGENT ID", "ROLE", "STATUS", "LAST HEARTBEAT"
      printf "%-25s %-20s %-10s %-25s\n", "─────────────────────────", "────────────────────", "──────────", "─────────────────────────"
      
      # Print agents with online status
      now = systime()
      for (id in agents) {
        split(agents[id], parts, " \\| ")
        agentId = parts[1]
        role = parts[2]
        status = parts[3]
        heartbeat = parts[4]
        
        # Parse heartbeat timestamp
        gsub(/[-:TZ]/, " ", heartbeat)
        split(heartbeat, hb)
        if (length(hb) >= 6) {
          hbTime = mktime(sprintf("%04d %02d %02d %02d %02d %02d", hb[1], hb[2], hb[3], hb[4], hb[5], hb[6]))
          age = now - hbTime
          
          # Determine online/offline
          if (age < 120) {
            statusIcon = "🟢 " status
          } else if (age < 300) {
            statusIcon = "🟡 stale"
          } else {
            statusIcon = "🔴 offline"
          }
        } else {
          statusIcon = "⚪ unknown"
        }
        
        printf "%-25s %-20s %-10s %-25s\n", substr(agentId, 1, 25), substr(role, 1, 20), statusIcon, substr(parts[4], 1, 25)
      }
    }
    '
  else
    # Fallback without jq
    echo "⚠️  jq not found - showing raw data:"
    echo ""
    tail -20 "$REGISTRY"
  fi
  
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  
  # Count messages
  if [ -f "$SHARED_DIR/messages.jsonl" ]; then
    MSG_COUNT=$(wc -l < "$SHARED_DIR/messages.jsonl")
    echo "📨 Messages: $MSG_COUNT"
  fi
  
  # Count tasks
  if [ -f "$SHARED_DIR/tasks.jsonl" ]; then
    TASK_COUNT=$(wc -l < "$SHARED_DIR/tasks.jsonl")
    echo "📋 Tasks: $TASK_COUNT"
  fi
  
  echo ""
  echo "Refreshing every 5 seconds..."
  sleep 5
done
