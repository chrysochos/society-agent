# Multi-VS Code Quick Reference Card

## Setup

```bash
# Automated setup
pnpm setup:multi-vscode /path/to/project

# Launch all agents
/path/to/project/.society-agent/launch-scripts/launch-all.sh

# Monitor agents
/workspace/scripts/monitor-agents.sh /path/to/project/.society-agent
```

## VS Code Settings (per workspace)

```json
{
	"kilo-code.societyAgent.sharedDir": "/project/.society-agent",
	"kilo-code.societyAgent.agentId": "backend-abc123",
	"kilo-code.societyAgent.role": "backend-developer",
	"kilo-code.societyAgent.capabilities": ["api", "database"]
}
```

## Agent Roles

- `supervisor` - Coordinates all work
- `backend-developer` - Server-side development
- `frontend-developer` - UI/UX development
- `tester` - Testing and QA
- `devops` - Deployment and infrastructure
- `security-reviewer` - Security auditing
- `custom` - User-defined

## Communication

### Send Message

```typescript
await agentRegistry.sendMessage(
	"backend-abc123", // to
	"task_assign", // type
	{ task: "..." }, // content
)
```

### Broadcast

```typescript
await agentRegistry.sendMessage("broadcast", "status_update", { status: "Build complete" })
```

## Monitoring

### Check Registry

```bash
cat .society-agent/registry.jsonl | jq -s 'group_by(.agentId) | map(.[0])'
```

### Watch Messages

```bash
tail -f .society-agent/messages.jsonl | jq '.'
```

### See Online Agents

```bash
node -e "
const fs = require('fs');
const lines = fs.readFileSync('.society-agent/registry.jsonl', 'utf-8').split('\n').filter(l => l);
const agents = new Map();
lines.forEach(l => {
  const entry = JSON.parse(l);
  if (entry.agentId) agents.set(entry.agentId, entry);
});
const now = Date.now();
Array.from(agents.values()).forEach(a => {
  const age = now - new Date(a.lastHeartbeat).getTime();
  const status = age < 120000 ? '🟢 online' : '🔴 offline';
  console.log(\`\${a.agentId}: \${status} (\${a.role})\`);
});
"
```

### Real-Time Monitor

```bash
watch -n 5 "cat .society-agent/registry.jsonl | tail -10"
```

## File Structure

```
.society-agent/
  registry.jsonl     - Agent registrations & heartbeats
  messages.jsonl     - Inter-agent messages
  tasks.jsonl        - Shared task list
  deliveries.jsonl   - Message delivery tracking
  README.md          - Setup documentation
  launch-scripts/    - Shell scripts to launch agents
```

## Troubleshooting

### Agent Not Registering

1. Check `sharedDir` setting
2. Verify path is accessible
3. Check Output panel (View → Output → "Kilo-Code")
4. Reload window (Cmd/Ctrl+R)

### Messages Not Received

1. Verify same `sharedDir` in both agents
2. Check file permissions
3. Restart recipient VS Code
4. Check deliveries.jsonl for delivery status

### Heartbeat Stopped

1. Check Developer Tools for errors
2. Restart VS Code
3. Verify extension is active

## Key Concepts

### Persistent Agents

✅ Agents live for project lifetime  
✅ Build expertise over time  
✅ Remember previous work

### Offline Support

✅ Messages queue when agent offline  
✅ Delivered on wake-up  
✅ No blocking or lost messages

### Asynchronous

✅ Agents work independently  
✅ Coordinate when needed  
✅ Natural workflow

## Common Commands

```bash
# Setup
pnpm setup:multi-vscode

# Launch all
.society-agent/launch-scripts/launch-all.sh

# Launch individual
code /project/backend

# Monitor
/workspace/scripts/monitor-agents.sh .society-agent

# Check online
cat .society-agent/registry.jsonl | grep lastHeartbeat | tail -5

# Watch messages
tail -f .society-agent/messages.jsonl

# Count messages
wc -l .society-agent/messages.jsonl

# Clean up (careful!)
rm .society-agent/*.jsonl && touch .society-agent/{registry,messages,tasks,deliveries}.jsonl
```

## Decision Tree

**When to use Multi-VS Code?**

- ✅ Complex projects with multiple components
- ✅ Want visual separation (see each agent's work)
- ✅ Need true parallelism (separate processes)
- ✅ Want persistent agents (build expertise)

**When to use Single-VS Code?**

- ✅ Simple projects
- ✅ All work tightly coupled
- ✅ Don't need visual separation
- ✅ Lower resource usage

## Getting Help

1. Read: [MULTI_VSCODE_GUIDE.md](MULTI_VSCODE_GUIDE.md) (comprehensive)
2. Read: [MULTI_VSCODE_ARCHITECTURE.md](MULTI_VSCODE_ARCHITECTURE.md) (technical)
3. Check: VS Code Output panel → "Kilo-Code"
4. Debug: `.society-agent/*.jsonl` files (human-readable)
5. Monitor: `scripts/monitor-agents.sh`

---

**Quick Start**: `pnpm setup:multi-vscode → launch-all.sh → Start coding!` 🚀
