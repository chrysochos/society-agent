# Society Agent Framework - Quick Start Guide

> **What We Built**: A multi-agent collaboration system for KiloCode where multiple AI agents can work together, coordinate tasks, request approvals, and communicate with each other.

---

## 🎯 What You'll Learn

This guide shows you how to:

1. **Start an agent** with identity and capabilities
2. **See agents in action** through the VS Code UI
3. **View agent logs** and message history
4. **Test multi-agent communication**
5. **Understand persistent storage** (workspace-local state)

---

## 📋 Prerequisites

Before starting, ensure you have:

- **VS Code** with KiloCode extension installed
- **Node.js** and **pnpm** installed
- **Built the project**: `pnpm install && pnpm run build`
- **Workspace open**: Open `c:\Dev\kilocode` in VS Code

---

## 🚀 Step-by-Step Tutorial

### Step 1: Build and Launch VS Code Extension

From `c:\Dev\kilocode` workspace in VS Code:

1. **Open the workspace** in VS Code (if not already open)
2. **Press F5** (or Run > Start Debugging)

This will:

- Build the extension in watch mode
- Launch a **new VS Code window** titled `[Extension Development Host]`
- Load KiloCode with Society Agent features from YOUR code

**What you'll see**:

```text
[Extension Host] Extension activated
[Extension Host] Society Agent services initialized (if configured)
```

**How to tell you're using your development code**:

- Window title shows: `[Extension Development Host] - Visual Studio Code`
- This is your guarantee you're running the modified code, not the published stable extension

**Troubleshooting**:

- If build fails: Run `pnpm install` first
- If extension doesn't load: Check `src/extension.ts` for errors
- If hot reload stops: Stop (Ctrl+C) and press F5 again

**Optional: Dev Container**

- If using the devcontainer (recommended for Windows), VS Code will prompt "Reopen in Container"
- Open Command Palette (F1 or Ctrl+Shift+P) → "Dev Containers: Reopen in Container"
- Wait for container to build, then press F5 inside the container

---

### Step 2: Verify Extension Development Host

After pressing F5, a **new VS Code window** opens with the title:

```
[Extension Development Host] - Visual Studio Code
```

**This window uses YOUR development code** from `c:\Dev\kilocode`, including all Society Agent features.

**In the Extension Development Host window**:

1. **Open Folder** → Navigate to any test workspace (e.g., `c:\Dev\test-workspace`)
2. **Open Command Palette** (Ctrl+Shift+P or F1)
3. **Type**: "KiloCode: Open in New Tab" or "KiloCode: Focus"
4. The KiloCode chat interface will appear

**Important**: The `[Extension Development Host]` title bar confirms you're using your modified code, not the published stable extension.

**What you're doing**: Opening the main KiloCode interface where agents will operate.

---

### Step 3: Start an Agent via CLI

Open a **new terminal** in VS Code (Ctrl+Shift+`) and run:

```bash
# Start a worker agent
kilocode --agent-id=worker-1 --agent-name="Code Analyzer" --agent-role=worker --agent-capabilities=file-read,file-write,code-analysis
```

**What happens**:

1. Agent registers with ID `worker-1`
2. Capabilities: Can read/write files and analyze code
3. Logs start writing to `.society-agent/logs/worker-1.jsonl`
4. Agent registry updated in `.society-agent/registry.jsonl`

**What you'll see in terminal**:

```
[Society Agent] Initialized: worker-1
[Society Agent] Role: worker
[Society Agent] Capabilities: file-read, file-write, code-analysis
[Society Agent] Log path: .society-agent/logs/worker-1.jsonl
```

---

### Step 4: Start a Second Agent (Supervisor)

In another terminal:

```bash
# Start a supervisor agent
kilocode --agent-id=supervisor-1 --agent-name="Task Supervisor" --agent-role=supervisor --agent-capabilities=file-read,file-write,code-analysis,approval
```

**What's different**:

- Role is `supervisor` (can approve actions from workers)
- Has `approval` capability (can authorize risky operations)

**Now you have**:

- 2 agents running
- 2 log files in `.society-agent/logs/`
- 2 entries in `.society-agent/registry.jsonl`

---

### Step 5: View Agent Registry in UI

In the **Extension Development Host** KiloCode window:

1. **Open Command Palette** (F1)
2. **Type**: "Society Agent: Show Registry" (if available) OR
3. Look for the **Society Agent Panel** in the sidebar

**What you'll see**:

```
┌─────────────────────────────────────────┐
│ Society Agents                    [↻]   │
├─────────────────────────────────────────┤
│ [All] [Workers] [Supervisors]           │
├─────────────────────────────────────────┤
│ ● worker-1           [worker]           │
│   Code Analyzer                         │
│   [file-read] [file-write] [code-analysis]
│   Idle | Just now                       │
│   [Send Message] [View Logs]            │
├─────────────────────────────────────────┤
│ ● supervisor-1       [supervisor]       │
│   Task Supervisor                       │
│   [file-read] [file-write] [approval]   │
│   Idle | Just now                       │
│   [Send Message] [View Logs]            │
└─────────────────────────────────────────┘
│ Available: 2/2 | Total Tasks: 0         │
└─────────────────────────────────────────┘
```

**Key elements**:

- **Green dot** (●) = Agent available
- **Yellow dot** = Agent busy
- **Capabilities** = What the agent can do
- **Status** = Current activity (Idle, 2 tasks, etc.)
- **Last seen** = How recently agent sent heartbeat

---

### Step 6: Send a Message Between Agents

Click on `worker-1` to select it, then click **"Send Message"**.

**What happens**:

1. VS Code sends message to `worker-1`
2. Message stored in `.society-agent/messages.jsonl`
3. Worker agent receives notification
4. Message appears in Agent Message Viewer

**Message structure** (in messages.jsonl):

```json
{
	"timestamp": 1732723200000,
	"messageId": "msg-1732723200000-xyz123",
	"type": "notification",
	"fromAgentId": "vscode-extension",
	"toAgentId": "worker-1",
	"payload": { "content": "Hello from webview" }
}
```

---

### Step 7: View Agent Logs

**Option A: Via UI**

1. Click on an agent in the registry
2. Click **"View Logs"**
3. Log file opens in VS Code editor

**Option B: Via CLI**

```bash
# View logs for specific agent
kilocode /logs worker-1

# View all agents
kilocode /logs --all

# Limit to last 20 entries
kilocode /logs worker-1 --limit 20

# Verbose mode (shows full details)
kilocode /logs worker-1 --verbose
```

**What you'll see**:

```
=== Agent Logs: worker-1 ===
Log file: .society-agent/logs/worker-1.jsonl
Total actions: 5

[2m ago] tool_execution: read_file (success) - file: src/extension.ts
[5m ago] decision: analyze-code (success)
[10m ago] tool_execution: list_files (success) - pattern: src/**/*.ts
[15m ago] completion: task-complete (success)
[20m ago] tool_execution: search_files (success) - query: "function"
```

---

### Step 8: Test Agent Communication

In the **Agent Message Viewer** (if available in UI):

**What you'll see**:

```
┌──────────────────────────────────────────┐
│ Agent Messages           [↻] [🗑]        │
├──────────────────────────────────────────┤
│ [All] [Requests] [Responses] [Broadcasts]│
│ [Search messages...]                     │
│ ☑ Auto-scroll to new messages            │
├──────────────────────────────────────────┤
│ ┌────────────────────────────────────┐   │
│ │ [request] [high]      10:45 AM     │   │
│ │ worker-1 → supervisor-1            │   │
│ │ Action: request-approval           │   │
│ │ {"tool": "delete_file"}            │   │
│ │ Correlation: abc-123               │   │
│ └────────────────────────────────────┘   │
│ ┌────────────────────────────────────┐   │
│ │ [response]            10:46 AM     │   │
│ │ supervisor-1 → worker-1            │   │
│ │ {"approved": true}                 │   │
│ │ Correlation: abc-123               │   │
│ └────────────────────────────────────┘   │
└──────────────────────────────────────────┘
│ Showing: 2 / 2 | Latest: 10:46 AM        │
└──────────────────────────────────────────┘
```

**Message types**:

- **Request** (blue): Worker asks supervisor to do something
- **Response** (green): Reply to a request
- **Broadcast** (purple): Message to all agents
- **Notification** (yellow): Fire-and-forget alert

---

### Step 9: Test Approval Workflow

Have `worker-1` attempt a risky operation:

```bash
# In worker-1's terminal, try to delete a file
# (This requires approval from supervisor)
```

**What happens**:

1. **Worker** detects `delete_file` requires approval
2. **Request sent** to `supervisor-1`
3. **Supervisor** receives approval request
4. **User prompted** (or supervisor auto-approves)
5. **Result** returned to worker
6. **Action logged** in `.society-agent/approvals.jsonl`

**Approval entry**:

```json
{
	"timestamp": 1732723300000,
	"agentId": "worker-1",
	"tool": "delete_file",
	"params": { "path": "/test.txt" },
	"decision": "approved",
	"approvedBy": "supervisor-1",
	"reason": "User approved"
}
```

---

### Step 10: Inspect Persistent Storage

**Navigate to** `.society-agent/` in your workspace:

```
.society-agent/
├── logs/
│   ├── worker-1.jsonl          ← All actions by worker-1
│   └── supervisor-1.jsonl      ← All actions by supervisor-1
├── registry.jsonl              ← Agent registrations/status
├── messages.jsonl              ← Inter-agent messages
└── approvals.jsonl             ← Approval decisions
```

**View registry** (last 5 lines):

```bash
tail -n 5 .society-agent/registry.jsonl
```

**View messages**:

```bash
tail -n 10 .society-agent/messages.jsonl
```

**What's stored**:

- **Survives restarts**: All data persists between CLI/VS Code sessions
- **Shared state**: CLI and VS Code extension share the same files
- **JSONL format**: Append-only, one JSON object per line
- **Replay-able**: Can reconstruct agent state from history

---

## 🧪 Advanced Testing

### Test Task Delegation

Start 2 workers and 1 supervisor:

```bash
# Terminal 1: Worker specialized in testing
kilocode --agent-id=test-worker --agent-role=worker --agent-capabilities=test-execution,file-read

# Terminal 2: Worker specialized in documentation
kilocode --agent-id=doc-worker --agent-role=worker --agent-capabilities=file-write,code-analysis

# Terminal 3: Supervisor to coordinate
kilocode --agent-id=coordinator --agent-role=supervisor --agent-capabilities=file-read,file-write,approval
```

**What you can test**:

1. **Supervisor delegates** test task → `test-worker` handles it
2. **Supervisor delegates** doc task → `doc-worker` handles it
3. **Load balancing**: Both workers get tasks based on availability

---

### Test Permission Denial

Start a restricted worker:

```bash
# Worker with only read permission
kilocode --agent-id=reader --agent-role=worker --agent-capabilities=file-read
```

**Try to write a file** → Should be **denied** (lacks `file-write` capability)

**What happens**:

```
[Permission Denied] Agent reader (reader) lacks required capabilities to use write_to_file:
Missing: file-write
Current capabilities: file-read
```

---

### Test Multi-Agent Broadcast

In any agent's context, send a broadcast:

```javascript
// Example internal code
await agentMessaging.broadcast({
	type: "status-update",
	status: "idle",
	message: "All workers: new task available",
})
```

**Result**: All active agents receive the message.

---

## 📊 What We Built - Architecture

### 1. **Agent Identity & Configuration** (Phase 1)

- **Types**: `AgentIdentity`, `AgentRole`, `AgentCapability`
- **Config**: Agent metadata (id, name, role, domain, capabilities)
- **Logger**: JSONL logging to `.society-agent/logs/{agentId}.jsonl`

### 2. **Logging Integration** (Phase 2)

- **CLI**: `/logs` command to view agent action history
- **Injection Points**: Task.ts logs tool executions, decisions, errors
- **Format**: Structured JSONL with timestamps, action types, results

### 3. **Permission System** (Phase 3)

- **Capabilities**: 12 types (file-read, file-write, execute, etc.)
- **Tool Mapping**: 30+ tools mapped to required capabilities
- **Checker**: `PermissionChecker` validates agent permissions
- **Approval**: High-risk tools (delete, execute, git) require approval

### 4. **Supervisor Communication** (Phase 4)

- **Channel**: `SupervisorChannel` for worker ↔ supervisor messaging
- **Approval Flow**: Workers request, supervisors approve/deny
- **Messaging**: `AgentMessaging` for request/response/broadcast
- **Delegation**: `TaskDelegation` assigns tasks to capable agents
- **Registry**: `AgentRegistry` tracks agent status and availability

### 5. **Agent Messaging UI** (Phase 5)

- **SocietyAgentPanel**: React component showing agent registry
- **AgentMessageViewer**: React component showing message history
- **WebviewMessage Types**: 8 new message types for agent communication
- **Message Handlers**: ClineProvider handlers for UI ↔ Extension communication

### 6. **Persistent Storage** (Bonus)

- **Storage Service**: `SocietyAgentStorage` manages JSONL files
- **Singleton Pattern**: AgentRegistry, AgentMessaging, ApprovalManager
- **Workspace-local**: Shared between CLI and VS Code extension
- **Format**: JSONL (JSON Lines) for durability and replay-ability

---

## 🔍 Key Files to Understand

### Core Services

```
src/services/society-agent/
├── types.ts                  ← All type definitions
├── config.ts                 ← Configuration management
├── logger.ts                 ← JSONL logging
├── permissions.ts            ← Capability checking
├── approval.ts               ← Approval workflows
├── supervisor-channel.ts     ← Supervisor communication
├── agent-messaging.ts        ← Inter-agent messaging
├── delegation.ts             ← Task assignment
├── registry.ts               ← Agent tracking
└── storage.ts                ← Persistent storage
```

### Integration Points

```
src/core/task/Task.ts                        ← Logs tool executions
src/core/assistant-message/presentAssistantMessage.ts  ← Permission checks
src/core/webview/webviewMessageHandler.ts    ← UI message handlers
src/shared/WebviewMessage.ts                 ← UI message types
```

### CLI

```
cli/src/services/identity.ts   ← CLI agent identity
cli/src/commands/logs.ts       ← /logs command
```

### UI Components

```
webview-ui/src/components/society-agent/
├── SocietyAgentPanel.tsx      ← Agent registry viewer
├── AgentMessageViewer.tsx     ← Message history viewer
└── index.ts                   ← Component exports
```

---

## 🎓 What You Learned

By following this guide, you now understand:

1. **How to start agents** with identity and capabilities
2. **How agents communicate** via messages (request/response/broadcast)
3. **How permissions work** (capability-based access control)
4. **How approvals work** (supervisor must approve risky operations)
5. **How to view logs** (CLI and UI)
6. **How to view agent registry** (active agents and their status)
7. **How to view message history** (inter-agent communication)
8. **How persistent storage works** (workspace-local JSONL files)
9. **How task delegation works** (supervisor assigns tasks to workers)
10. **The full Society Agent architecture** (6 phases, 16 new files, ~4,546 lines)

---

## 🚀 Next Steps

### Implement Phase 6: Task Orchestration

- **Decompose tasks** into subtasks
- **Assign subtasks** to multiple agents
- **Track progress** across agents
- **Aggregate results** from multiple agents
- **Handle failures** and retry logic

### Production Enhancements

- **WebSocket channel** for multi-process supervision
- **Message queues** (Redis/RabbitMQ) for durability
- **Metrics & monitoring** (Prometheus/Grafana)
- **Security** (authentication, authorization)
- **UI improvements** (real-time updates, message composition)

---

## 🐛 Troubleshooting

### Agents not appearing in registry

- **Check**: `.society-agent/registry.jsonl` exists
- **Verify**: Agent started with `--agent-id` flag
- **Try**: Refresh the agent panel (click ↻)

### Messages not persisting

- **Check**: `.society-agent/messages.jsonl` exists
- **Verify**: Storage initialized in ClineProvider/CLI startup
- **Try**: Restart VS Code and agents

### Logs not showing

- **Check**: `.society-agent/logs/` directory exists
- **Verify**: Agent has write permissions
- **Try**: `kilocode /logs --all` to see if any logs exist

### Permission denied errors

- **Check**: Agent has required capability
- **Fix**: Add capability when starting agent (e.g., `--agent-capabilities=file-read,file-write`)

### Approval requests timing out

- **Check**: Supervisor agent is running
- **Verify**: Supervisor has `approval` capability
- **Try**: Restart supervisor agent

---

## 📚 Documentation References

- **AGENTS.md** - Coordination contract for agents
- **SOCIETY_AGENT_ANALYSIS_OVERVIEW.md** - High-level architecture
- **SOCIETY_AGENT_MODIFICATION_PLAN.md** - 6-phase implementation plan
- **analysis/PHASE_1_COMPLETE.md** - Phase 1 documentation
- **analysis/PHASE_2_COMPLETE.md** - Phase 2 documentation
- **analysis/PHASE_3_COMPLETE.md** - Phase 3 documentation
- **analysis/PHASE_4_COMPLETE.md** - Phase 4 documentation
- **analysis/PHASE_5_COMPLETE.md** - Phase 5 documentation
- **analysis/SOCIETY_AGENT_COMPLETE_SUMMARY.md** - Complete summary

---

## 🎉 Congratulations!

You've successfully explored the **Society Agent Framework** - a multi-agent collaboration system that enables AI agents to:

- **Work independently** with distinct capabilities
- **Coordinate together** through messaging and delegation
- **Request approvals** for risky operations
- **Maintain state** across sessions with persistent storage
- **Communicate** through a rich UI

**Total Implementation**: 16 new files, 10 modified files, ~4,546 lines of code

**Ready for Phase 6**: Task Orchestration and advanced multi-agent workflows! 🚀
