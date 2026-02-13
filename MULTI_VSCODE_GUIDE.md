# Multi-VS Code Agent Coordination - User Guide

**Date**: February 10, 2026  
**Status**: Implementation Complete  
**Architecture**: Distributed Multi-Agent with File-Based Communication

---

## Overview

This system allows multiple VS Code instances to act as coordinated agents, each with its own role, workspace, and context. Agents communicate through a shared directory using file-based messaging with support for offline/sleeping agents.

### Key Features

✅ **Persistent Agents** - Agents live for project lifetime, not destroyed after each purpose  
✅ **Offline Support** - Agents can be sleeping; messages queue and deliver on wake-up  
✅ **Asynchronous Operation** - Agents work independently, coordinate when needed  
✅ **File-Based Communication** - Simple, debuggable, no network setup required  
✅ **Automatic Discovery** - Agents register themselves, find each other automatically  
✅ **Visual Separation** - Each agent in its own VS Code window

---

## Architecture

```
┌─────────────────────────────────────┐
│  VS Code 1: Supervisor              │
│  Role: Coordination                 │
│  Workspace: /project                │
│  Status: ONLINE                     │
└─────────────┬───────────────────────┘
              │
              │  Shared Directory
              │  /project/.society-agent/
              │    ├── registry.jsonl
              │    ├── messages.jsonl
              │    ├── tasks.jsonl
              │    └── deliveries.jsonl
              │
    ┌─────────┴─────────┬─────────────┬─────────────┐
    │                   │             │             │
┌───▼──────────┐  ┌─────▼───────┐  ┌─▼──────────┐  ┌─▼──────────┐
│ VS Code 2    │  │ VS Code 3   │  │ VS Code 4  │  │ VS Code 5  │
│ Backend      │  │ Frontend    │  │ Testing    │  │ DevOps     │
│ ONLINE       │  │ ONLINE      │  │ OFFLINE    │  │ ONLINE     │
└──────────────┘  └─────────────┘  └────────────┘  └────────────┘
```

**Important**: Agent 4 (Testing) is OFFLINE. Messages sent to it are queued. When it wakes up, it processes all missed messages automatically.

---

## Setup

### Quick Setup (Automated)

```bash
# Navigate to your project
cd /path/to/your/project

# Run setup script
pnpm setup:multi-vscode

# This creates:
# - .society-agent/ shared directory
# - .vscode/settings.json for each workspace
# - Launch scripts for each agent
# - README with instructions
```

### Manual Setup

If you prefer manual configuration:

#### 1. Create Shared Directory

```bash
mkdir -p /path/to/project/.society-agent
touch /path/to/project/.society-agent/{registry,messages,tasks,deliveries}.jsonl
```

#### 2. Configure Each Workspace

For each VS Code instance (supervisor, workers), create `.vscode/settings.json`:

**Supervisor** (`/project/.vscode/settings.json`):

```json
{
	"kilo-code.societyAgent.agentId": "supervisor-abc123",
	"kilo-code.societyAgent.role": "supervisor",
	"kilo-code.societyAgent.sharedDir": "/project/.society-agent",
	"kilo-code.societyAgent.capabilities": ["coordination", "planning"],
	"kilo-code.societyAgent.workingDirectory": "/project"
}
```

**Backend Worker** (`/project/backend/.vscode/settings.json`):

```json
{
	"kilo-code.societyAgent.agentId": "backend-xyz789",
	"kilo-code.societyAgent.role": "backend-developer",
	"kilo-code.societyAgent.sharedDir": "/project/.society-agent",
	"kilo-code.societyAgent.capabilities": ["api", "database"],
	"kilo-code.societyAgent.workingDirectory": "/project/backend"
}
```

**Frontend Worker** (`/project/frontend/.vscode/settings.json`):

```json
{
	"kilo-code.societyAgent.agentId": "frontend-def456",
	"kilo-code.societyAgent.role": "frontend-developer",
	"kilo-code.societyAgent.sharedDir": "/project/.society-agent",
	"kilo-code.societyAgent.capabilities": ["ui", "react"],
	"kilo-code.societyAgent.workingDirectory": "/project/frontend"
}
```

#### 3. Launch VS Code Instances

```bash
# Launch each workspace
code /project
code /project/backend
code /project/frontend
code /project/tests
```

Each instance will auto-detect its configuration and register as an agent.

---

## Agent Identification & Discovery

### On Launch (Automatic)

When VS Code opens with `societyAgent.sharedDir` configured:

1. **Read Configuration**

    - agentId (auto-generate if empty)
    - role (supervisor/worker type)
    - capabilities
    - sharedDir path

2. **Register in Registry**

    - Append registration to `registry.jsonl`
    - Include: agentId, role, workspace, PID, timestamp

3. **Catch Up on Missed Messages**

    - Read `messages.jsonl` and `deliveries.jsonl`
    - Process all undelivered messages
    - Mark as delivered

4. **Start Heartbeat**

    - Every 30 seconds, update `registry.jsonl`
    - Signals "I'm still alive"

5. **Watch for New Messages**
    - File watcher on `messages.jsonl`
    - Process messages addressed to this agent

### Agent Discovery

Any agent can discover others:

```typescript
// Get all registered agents
const agents = await agentRegistry.getAgents()

// Get only online agents (heartbeat < 2 minutes)
const online = await agentRegistry.getOnlineAgents()
```

---

## Communication Protocol

### Message Types

```typescript
interface AgentMessage {
	id: string // Unique message ID
	from: string // Sender agentId
	to: string // Recipient agentId or "broadcast"
	type: "task_assign" | "task_complete" | "message" | "question" | "status_update" | "shutdown"
	content: any // Message payload
	timestamp: string // ISO timestamp
	delivered: boolean // false if recipient offline
	deliveredAt?: string // When actually delivered
}
```

### Sending Messages

```typescript
// Send to specific agent
await agentRegistry.sendMessage(
	"backend-xyz789", // to
	"task_assign", // type
	{
		// content
		taskId: "task-001",
		description: "Implement auth endpoint",
		deadline: "2026-02-11T10:00:00Z",
	},
)

// Broadcast to all
await agentRegistry.sendMessage("broadcast", "status_update", { status: "Project build completed" })
```

### File Format (messages.jsonl)

```jsonl
{"id":"msg-001","from":"supervisor-abc123","to":"backend-xyz789","type":"task_assign","content":{"taskId":"task-001","desc":"Implement auth"},"timestamp":"2026-02-10T10:00:00Z","delivered":false}
{"id":"msg-002","from":"backend-xyz789","to":"supervisor-abc123","type":"task_complete","content":{"taskId":"task-001","status":"success"},"timestamp":"2026-02-10T10:30:00Z","delivered":true,"deliveredAt":"2026-02-10T10:30:01Z"}
```

---

## Offline/Sleeping Agents

### The Challenge

**Q**: What happens if Backend agent is offline when Supervisor sends a task?

**A**: Message is queued. When Backend wakes up, it processes all missed messages.

### How It Works

#### When Message Sent to Offline Agent:

1. Message written to `messages.jsonl` with `delivered: false`
2. Supervisor continues (doesn't block)
3. Message sits in queue

#### When Agent Wakes Up:

```typescript
// In extension.ts, after registration:
await agentRegistry.catchUp()
```

This:

1. Reads all messages from `messages.jsonl`
2. Filters to messages for this agent
3. Checks `deliveries.jsonl` to see what's already delivered
4. Processes all undelivered messages
5. Marks each as delivered in `deliveries.jsonl`

### Delivery Tracking

**deliveries.jsonl** tracks which agent received which message:

```jsonl
{"messageId":"msg-001","deliveredTo":"backend-xyz789","deliveredAt":"2026-02-10T11:00:00Z"}
{"messageId":"msg-002","deliveredTo":"supervisor-abc123","deliveredAt":"2026-02-10T10:30:01Z"}
```

### Use Cases

✅ **Overnight Work**: Supervisor assigns tasks at 6pm, workers wake up at 9am, process tasks  
✅ **Intermittent Workers**: Test agent only runs during test phase  
✅ **Debugging**: Turn off Frontend agent to test Backend in isolation  
✅ **Resource Management**: Only run agents you need right now

---

## Agent Persistence

### Current Design: Persistent Agent Pool

Agents persist for project lifetime:

```typescript
// Project start: Create agent pool
// (automatic via settings.json in each workspace)

// Purpose 1: Agents execute
// Purpose 2: Same agents execute (with context from Purpose 1)
// Purpose 3: Same agents execute (accumulated knowledge)

// Project end: Optional cleanup
```

**Benefits:**

- ✅ Agents remember previous work
- ✅ Build expertise over time
- ✅ No re-initialization cost
- ✅ Context accumulates

**vs. Old Design (Ephemeral):**

- ❌ Agents created per purpose
- ❌ Destroyed after completion
- ❌ Lost all context
- ❌ High overhead

---

## Heartbeat & Online Status

### Heartbeat Mechanism

Every agent sends heartbeat every 30 seconds:

```jsonl
{"agentId":"backend-xyz789","status":"idle","lastHeartbeat":"2026-02-10T10:00:00Z"}
{"agentId":"backend-xyz789","status":"busy","lastHeartbeat":"2026-02-10T10:00:30Z"}
{"agentId":"backend-xyz789","status":"idle","lastHeartbeat":"2026-02-10T10:01:00Z"}
```

### Online Detection

Agent is considered **online** if:

- Last heartbeat < 2 minutes ago

Agent is considered **offline** if:

- Last heartbeat > 2 minutes ago
- OR no heartbeat at all

```typescript
// Supervisor can route work to online agents only
const online = await agentRegistry.getOnlineAgents()
for (const agent of online) {
	if (agent.role === "backend-developer") {
		await assignTask(agent.agentId, task)
	}
}
```

---

## Workspace Sharing Strategies

### Strategy 1: Monorepo with Subdirectories (Recommended)

```
/project/
  .society-agent/           # Shared coordination
  .vscode/                  # Supervisor settings
  README.md
  backend/                  # Backend agent workspace
    .vscode/                # Backend settings
    src/
  frontend/                 # Frontend agent workspace
    .vscode/                # Frontend settings
    src/
  tests/                    # Test agent workspace
    .vscode/                # Test settings
    src/
```

**Pros:**

- Simple structure
- Easy to navigate
- All code in one place
- Good for tightly coupled projects

### Strategy 2: Git Worktrees

```bash
# Main workspace
git worktree add ../project-backend feature/auth-backend
git worktree add ../project-frontend feature/auth-frontend

/project/                   # Supervisor (main branch)
/project-backend/           # Backend agent (auth-backend branch)
/project-frontend/          # Frontend agent (auth-frontend branch)
```

All share `.society-agent/` via symlink:

```bash
ln -s /project/.society-agent /project-backend/.society-agent
ln -s /project/.society-agent /project-frontend/.society-agent
```

**Pros:**

- Branch isolation
- Easy merge back
- Git-native
- Good for parallel feature development

---

## Settings Reference

### VS Code Settings (per workspace)

```json
{
	// Required for multi-VS Code mode
	"kilo-code.societyAgent.sharedDir": "/path/to/.society-agent",

	// Agent identification (auto-generated if empty)
	"kilo-code.societyAgent.agentId": "backend-abc123",

	// Agent role
	"kilo-code.societyAgent.role": "backend-developer",
	// Options: "supervisor", "backend-developer", "frontend-developer",
	//          "tester", "devops", "security-reviewer", "custom"

	// Additional capabilities for task routing
	"kilo-code.societyAgent.capabilities": ["api", "database", "auth"],

	// Working directory for file operations (optional)
	"kilo-code.societyAgent.workingDirectory": "/path/to/workspace"
}
```

### Shared Directory Structure

```
.society-agent/
  registry.jsonl          # Agent registrations and heartbeats
  messages.jsonl          # All inter-agent messages
  tasks.jsonl             # Shared task list
  deliveries.jsonl        # Message delivery tracking
  locks/                  # File locks (future: for task claiming)
  logs/                   # Per-agent detailed logs (future)
  README.md               # Setup documentation
  launch-scripts/         # Shell scripts to launch agents
    launch-all.sh
    launch-supervisor.sh
    launch-backend-worker.sh
    launch-frontend-worker.sh
```

---

## Debugging & Monitoring

### Check Agent Registry

```bash
# See all registered agents
cat .society-agent/registry.jsonl | jq -s 'group_by(.agentId) | map({agentId: .[0].agentId, role: .[0].role, lastHeartbeat: .[-1].lastHeartbeat, status: .[-1].status})'
```

Output:

```json
[
	{
		"agentId": "supervisor-abc123",
		"role": "supervisor",
		"lastHeartbeat": "2026-02-10T10:05:00Z",
		"status": "idle"
	},
	{
		"agentId": "backend-xyz789",
		"role": "backend-developer",
		"lastHeartbeat": "2026-02-10T10:04:30Z",
		"status": "busy"
	}
]
```

### Monitor Messages

```bash
# Watch messages in real-time
tail -f .society-agent/messages.jsonl | jq '.'
```

### Check Deliveries

```bash
# See which messages have been delivered
cat .society-agent/deliveries.jsonl | jq -s 'group_by(.messageId) | map({messageId: .[0].messageId, deliveredTo: map(.deliveredTo)})'
```

### VS Code Output Panel

Each VS Code instance logs to Output panel:

1. View → Output
2. Select "Kilo-Code" from dropdown
3. Look for lines:
    - `[Society Agent] Multi-VS Code mode enabled`
    - `[AgentRegistry] Agent {id} initialized`
    - `[AgentRegistry] Received message from {id}`

---

## Troubleshooting

### Agent Not Showing in Registry

**Symptom**: VS Code open but agent not in `registry.jsonl`

**Check**:

1. Settings: `kilo-code.societyAgent.sharedDir` configured?
2. Path: Is sharedDir path correct and accessible?
3. Output Panel: Any errors in "Kilo-Code" output?
4. Extension: Is KiloCode extension active?

**Fix**:

```json
// .vscode/settings.json
{
	"kilo-code.societyAgent.sharedDir": "/correct/path/.society-agent"
}
```

Reload VS Code (Cmd/Ctrl + R)

### Messages Not Being Received

**Symptom**: Message sent but recipient doesn't process it

**Check**:

1. Message file: Does message appear in `messages.jsonl`?
    ```bash
    tail .society-agent/messages.jsonl
    ```
2. Recipient ID: Is `to` field correct agentId?
3. File watcher: Is recipient VS Code frozen?

**Fix**:

- Restart recipient VS Code
- Check file permissions on `.society-agent/`
- Verify both agents have same sharedDir path

### Heartbeat Stopped

**Symptom**: Agent's lastHeartbeat is old (> 2 minutes)

**Possible Causes**:

- VS Code crashed
- Extension hung
- Process paused/suspended

**Fix**:

- Restart VS Code instance
- Check Developer Tools (Help → Toggle Developer Tools) for errors

### Undelivered Messages Piling Up

**Symptom**: Many messages in `messages.jsonl` with `delivered: false`

**Cause**: Recipient agent has been offline for extended period

**Fix**:

- Launch recipient VS Code
- Agent will automatically catch up on wake-up
- Check Output Panel for "Catch-up complete"

---

## Best Practices

### 1. Start Supervisor First

Always launch supervisor before workers:

```bash
# 1. Start supervisor
code /project

# Wait for "Society Agent active: supervisor" notification

# 2. Start workers
code /project/backend
code /project/frontend
```

This ensures coordinator is ready when workers register.

### 2. Verify Registration

After launching agents, verify they're registered:

```bash
cat .society-agent/registry.jsonl | grep agentId
```

Should see one line per agent.

### 3. Name Your Agents Clearly

Use descriptive agentIds:

- ✅ `backend-api-dev`
- ✅ `frontend-ui-worker`
- ❌ `agent-1`
- ❌ `worker-abc`

Makes debugging easier.

### 4. Monitor Heartbeats

During development, keep a terminal watching registry:

```bash
watch -n 5 "cat .society-agent/registry.jsonl | tail -10"
```

See agents' heartbeats updating every 30 seconds.

### 5. Clean Old Data

Periodically clean up old logs:

```bash
# Backup old data
tar -czf society-agent-backup-$(date +%Y%m%d).tar.gz .society-agent/

# Reset (careful: loses history)
rm .society-agent/*.jsonl
touch .society-agent/{registry,messages,tasks,deliveries}.jsonl
```

Restart all agents to re-register.

---

## Network Communication (Future)

Current implementation uses file-based communication. For distributed agents across machines, network-based communication can be added:

```typescript
// Future: HTTP/WebSocket server in each VS Code
interface AgentServer {
  port: number
  POST /api/task           // Receive task
  POST /api/message        // Receive message
  GET /api/status          // Report status
  WS /ws                   // Real-time updates
}
```

**Hybrid Mode**: File-based for same machine, network for remote agents.

Design document: [MULTI_VSCODE_ARCHITECTURE.md](MULTI_VSCODE_ARCHITECTURE.md)

---

## Summary

✅ **Setup**: Use `pnpm setup:multi-vscode` or manual `.vscode/settings.json`  
✅ **Identification**: Auto-generated agentId, configured role  
✅ **Discovery**: Agents register in `registry.jsonl`, find each other  
✅ **Communication**: Messages via `messages.jsonl`, file-watched  
✅ **Offline Support**: Messages queue, delivered on wake-up  
✅ **Persistence**: Agents live for project lifetime  
✅ **Asynchronous**: Agents work independently, coordinate when needed

---

## Next Steps

1. ✅ Run setup: `pnpm setup:multi-vscode`
2. ✅ Review generated README: `.society-agent/README.md`
3. ✅ Launch agents: `.society-agent/launch-scripts/launch-all.sh`
4. ✅ Verify in VS Code: Check notifications and Output panel
5. ✅ Test messaging: Send test message between agents
6. ✅ Start a purpose: Use supervisor to coordinate work

**Happy coding with your distributed agent team!** 🤖🤖🤖

---

**Document Version**: 1.0  
**Last Updated**: February 10, 2026  
**Author**: KiloCode Team
